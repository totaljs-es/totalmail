// OAuth 2.0 authorization-code flow with PKCE for mail providers that no longer accept passwords.
// Only the refresh token is stored (encrypted, per account); access tokens live in memory until they expire.
// What differs between providers; the rest of the flow is the same. `valid` is the shape of an application ID.
var providers = {
	microsoft: {
		name: 'Microsoft',
		host: 'login.microsoftonline.com',
		authorize: (tenant) => '/' + tenant + '/oauth2/v2.0/authorize',
		token: (tenant) => '/' + tenant + '/oauth2/v2.0/token',
		// One token for IMAP and SMTP: both scopes belong to the same resource.
		scope: 'https://outlook.office.com/IMAP.AccessAsUser.All https://outlook.office.com/SMTP.Send offline_access openid email profile',
		valid: /^[0-9a-f-]{36}$/i,
		tenant: true,
		adminConsent: true,
		sendScope: true,
		params: { response_mode: 'query' }
	},
	google: {
		name: 'Google',
		host: 'accounts.google.com',
		tokenHost: 'oauth2.googleapis.com',
		authorize: () => '/o/oauth2/v2/auth',
		token: () => '/token',
		// Google has no narrower scope for IMAP and SMTP than the whole mailbox.
		scope: 'https://mail.google.com/ openid email',
		valid: /^[0-9]{6,}-[a-z0-9]+\.apps\.googleusercontent\.com$/i,
		tenant: false,
		adminConsent: false,
		// Google rejects a scope on the code exchange and the renewal; without prompt=consent a repeated sign-in brings no refresh token.
		sendScope: false,
		params: { access_type: 'offline', prompt: 'consent', include_granted_scopes: 'false' },
		verifiedEmail: true
	}
};
var ttl = 10 * 60000,
	maxstates = 200;
// The settings of each provider are the administrator's: stored per installation (the administrator's window).
var instance = null;
function stored(provider) {
	return (instance || MODS.instance).oauth(provider);
}
function settings(provider) {
	var meta = providers[provider] || { valid: /^[0-9a-f-]{36}$/i },
		own = stored(provider),
		clientid = own.clientId || '',
		tenant = own.tenant || 'common';
	return {
		clientId: meta.valid.test(clientid) ? clientid : '',
		clientSecret: own.clientSecret || '',
		tenant: /^(common|organizations|consumers|[0-9a-f-]{36})$/i.test(tenant) ? tenant : 'common'
	};
}
// The token endpoint: Total.js's own request (RESTBuilder), no redirects, a ceiling on the size of the answer.
function form(host, path, params) {
	return new Promise((resolve, reject) => {
		RESTBuilder.POST('https://' + host + path)
			.urlencoded(params)
			.header('accept', 'application/json')
			.timeout(10000)
			.maxlength(64)
			.redirect(false)
			.callback((err, response, output) => {
				var status = output?.status || 0;
				if (!status || status === 408)
					reject(Error(status === 408 ? 'Timeout' : String(err?.message || err || 'Unreachable')));
				else if (response && typeof response === 'object')
					resolve({ status, body: response });
				else
					reject(Error('Unexpected response'));
			});
	});
}
function claims(jwt) {
	var part = String(jwt || '').split('.')[1];
	if (!part)
		throw Error('Missing identity');
	return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
}
exports.create = function(dependencies = {}) {
	var request = dependencies.request || form,
		now = dependencies.now || Date.now,
		encrypt = dependencies.encrypt || ((value) => MODS.security.identities.encrypt(value)),
		decrypt = dependencies.decrypt || ((value) => MODS.security.identities.decrypt(value));
	var states = new Map(),
		cache = new Map(),
		refreshing = new Map();
	function sweep() {
		for (var [key, value] of states)
			if (value.expires < now())
				states.delete(key);
	}
	if (dependencies.sweep !== false)
		ON('service', sweep);
	function known(provider) {
		return Object.prototype.hasOwnProperty.call(providers, provider);
	}
	async function exchange(provider, params) {
		var config = settings(provider),
			meta = providers[provider];
		var body = { client_id: config.clientId, ...params };
		if (config.clientSecret)
			body.client_secret = config.clientSecret;
		var response = await request(meta.tokenHost || meta.host, meta.token(config.tenant), body);
		if (response.status !== 200 || !response.body.access_token) {
			var error = Error(response.body?.error || 'token_error');
			error.oauthError = response.body?.error || '';
			throw error;
		}
		return response.body;
	}
	return {
		known,
		configured: (provider) => known(provider) && !!settings(provider).clientId,
		// Returns the provider authorization URL. The state is bound to the signed-in user and works once.
		start({ userId: userid, provider, email, name, accountId: accountid, redirectUri: redirecturi }) {
			if (!known(provider) || !settings(provider).clientId)
				throw Error(
					provider === 'microsoft'
						? '@(Sign-in with Microsoft is not set up on this server. Ask the administrator to add the application ID.)'
						: '@(Sign-in with this provider is not set up on this server. Ask the administrator to add the application ID.)'
				);
			sweep();
			if (states.size >= maxstates)
				throw Error('@(Too many attempts. Try again in 15 minutes.)');
			var config = settings(provider),
				meta = providers[provider];
			var state = Total.Crypto.randomBytes(24).toString('base64url'),
				verifier = Total.Crypto.randomBytes(48).toString('base64url'),
				nonce = Total.Crypto.randomBytes(16).toString('base64url');
			states.set(state, {
				userId: userid,
				provider,
				email: email.toLowerCase(),
				name,
				accountId: accountid || '',
				verifier,
				nonce,
				redirectUri: redirecturi,
				expires: now() + ttl
			});
			var url = new URL('https://' + meta.host + meta.authorize(config.tenant));
			url.search = new URLSearchParams({
				client_id: config.clientId,
				response_type: 'code',
				redirect_uri: redirecturi,
				...meta.params,
				scope: meta.scope,
				state,
				nonce,
				code_challenge: Total.Crypto.createHash('sha256').update(verifier).digest('base64url'),
				code_challenge_method: 'S256',
				login_hint: email
			}).toString();
			return url.href;
		},
		cancel(state) {
			states.delete(state);
		},
		// Redeems the code. The state is consumed even when the exchange fails.
		async finish({ state, code }) {
			var pending = states.get(state);
			states.delete(state);
			if (!pending || pending.expires < now() || typeof code !== 'string' || !code)
				throw Error('invalid_state');
			var token = await exchange(pending.provider, {
				grant_type: 'authorization_code',
				code,
				redirect_uri: pending.redirectUri,
				code_verifier: pending.verifier,
				...(providers[pending.provider].sendScope ? { scope: providers[pending.provider].scope } : {})
			});
			if (!token.refresh_token)
				throw Error('missing_refresh_token');
			var identity = claims(token.id_token),
				config = settings(pending.provider);
			if (identity.aud !== config.clientId || identity.nonce !== pending.nonce)
				throw Error('invalid_identity');
			var username = String(identity.preferred_username || identity.email || '').toLowerCase();
			if (!username)
				throw Error('missing_identity');
			if (providers[pending.provider].verifiedEmail && identity.email_verified !== true)
				throw Error('unverified_identity');
			return {
				userId: pending.userId,
				provider: pending.provider,
				accountId: pending.accountId,
				email: pending.email,
				name: pending.name,
				username,
				oauth: { provider: pending.provider, refresh: encrypt(token.refresh_token) },
				access: { token: token.access_token, expires: now() + (token.expires_in || 3600) * 1000 }
			};
		},
		remember(accountid, access) {
			cache.set(accountid, access);
		},
		// A valid access token for the account, refreshed when it is about to expire.
		async accessToken(account, store) {
			var oauth = account.oauth;
			if (!oauth?.refresh || !known(oauth.provider))
				throw Error(
					oauth?.provider === 'google'
						? '@(Sign in with Google to use this account.)'
						: '@(Sign in with Microsoft to use this account.)'
				);
			var cached = cache.get(account.id);
			if (cached && cached.expires - now() > 120000)
				return cached.token;
			if (refreshing.has(account.id))
				return refreshing.get(account.id);
			var work = (async () => {
				try {
					var token = await exchange(oauth.provider, {
						grant_type: 'refresh_token',
						refresh_token: decrypt(oauth.refresh),
						...(providers[oauth.provider].sendScope ? { scope: providers[oauth.provider].scope } : {})
					});
					cache.set(account.id, { token: token.access_token, expires: now() + (token.expires_in || 3600) * 1000 });
					if (token.refresh_token)
						await store.setOAuth(account.id, { ...oauth, refresh: encrypt(token.refresh_token) });
					return token.access_token;
				} catch (error) {
					cache.delete(account.id);
					if (error.oauthError === 'invalid_grant' || error.oauthError === 'interaction_required') {
						await store.setOAuth(account.id, oauth, 'reauth').catch(() => {});
						throw Error(
							oauth.provider === 'google'
								? '@(Sign-in with Google expired. Sign in again from the account settings.)'
								: '@(Sign-in with Microsoft expired. Sign in again from the account settings.)'
						);
					}
					throw Error(
						oauth.provider === 'google'
							? '@(Could not reach Google to renew the sign-in. Try again.)'
							: '@(Could not reach Microsoft to renew the sign-in. Try again.)'
					);
				} finally {
					refreshing.delete(account.id);
				}
			})();
			refreshing.set(account.id, work);
			return work;
		},
		forget(accountid) {
			cache.delete(accountid);
		},
		// Link for a tenant administrator to approve the application for the whole organization (tenant: its domain).
		adminConsentUrl(provider, domain, redirecturi) {
			if (!known(provider) || !providers[provider].adminConsent)
				throw Error('@(Invalid operation.)');
			if (!settings(provider).clientId)
				throw Error('@(Sign-in with Microsoft is not set up on this server. Ask the administrator to add the application ID.)');
			var tenant = /^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?\.[a-z]{2,}$/i.test(domain || '') ? domain.toLowerCase() : 'organizations';
			var url = new URL('https://' + providers[provider].host + '/' + tenant + '/adminconsent');
			url.search = new URLSearchParams({ client_id: settings(provider).clientId, redirect_uri: redirecturi }).toString();
			return url.href;
		},
		redirectUri(ctrl, provider) {
			var base = CONF.oauth_base_url || ctrl.protocol + '://' + ctrl.headers.host;
			return base.replace(/\/+$/, '') + '/oauth/' + provider + '/callback';
		}
	};
};
exports.settings = settings;
// The shape of an application ID for a provider, and whether it has tenants, for the administrator's window.
exports.meta = (provider) =>
	providers[provider] ? { name: providers[provider].name, valid: providers[provider].valid, tenant: providers[provider].tenant } : null;
exports.useInstance = (value) => (instance = value);
exports.claims = claims;
