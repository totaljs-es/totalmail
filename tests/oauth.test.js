require('total5');
const { test } = require('node:test');
const Assert = require('node:assert/strict');
const Crypto = require('node:crypto');
const Oauth = require('../lib/oauth'),
	Imap = require('../lib/imap'),
	Smtp = require('../lib/smtp');
const CLIENT = '00000000-0000-4000-8000-000000000001';
// The settings of the installation, as the administrator's window stores them.
var own = { clientId: CLIENT };
Oauth.useInstance({ oauth: () => own });
var jwt = (claims) => 'x.' + Buffer.from(JSON.stringify(claims)).toString('base64url') + '.y';
function service(responses, clock = { t: 1000000 }) {
	var calls = [];
	var oauth = Oauth.create({
		sweep: false,
		now: () => clock.t,
		encrypt: (v) => ({ sealed: v }),
		decrypt: (v) => v.sealed,
		request: async (host, path, params) => {
			calls.push({ host, path, params });
			var r = responses.shift();
			if (r instanceof Error)
				throw r;
			return typeof r === 'function' ? r(params) : r;
		}
	});
	return { oauth, calls, clock };
}
const redirectUri = 'https://mail.example.test/oauth/microsoft/callback';
const begin = (oauth, extra = {}) =>
	new URL(
		oauth.start({
			userId: 'u'.repeat(32),
			provider: 'microsoft',
			email: 'Jane@Contoso.example',
			name: 'Contoso',
			redirectUri,
			...extra
		})
	);

test('the authorization URL carries PKCE, a nonce, the mail scopes and only the public application ID', () => {
	var { oauth } = service([]);
	var url = begin(oauth),
		q = url.searchParams;
	Assert.equal(url.origin + url.pathname, 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize');
	Assert.equal(q.get('client_id'), CLIENT);
	Assert.equal(q.get('response_type'), 'code');
	Assert.equal(q.get('redirect_uri'), redirectUri);
	Assert.equal(q.get('code_challenge_method'), 'S256');
	Assert.ok(q.get('code_challenge').length >= 43 && q.get('state').length >= 30 && q.get('nonce'));
	Assert.equal(q.get('login_hint'), 'Jane@Contoso.example');
	for (var scope of ['IMAP.AccessAsUser.All', 'SMTP.Send', 'offline_access'])
		Assert.ok(q.get('scope').includes(scope));
	Assert.ok(!url.href.includes('client_secret'));
	Assert.ok(!url.href.includes('secret'));
});
test('an application that is not configured cannot start a sign-in', () => {
	var saved = own.clientId;
	own.clientId = '';
	try {
		var { oauth } = service([]);
		Assert.equal(oauth.configured('microsoft'), false);
		Assert.throws(() => begin(oauth), /not set up/);
		Assert.equal(oauth.configured('unknown'), false);
	} finally {
		own.clientId = saved;
	}
	Assert.equal(Oauth.settings('microsoft').tenant, 'common');
	own.tenant = 'not a tenant!';
	Assert.equal(Oauth.settings('microsoft').tenant, 'common');
	own.tenant = 'organizations';
	Assert.equal(Oauth.settings('microsoft').tenant, 'organizations');
	delete own.tenant;
});
test('redeeming the code sends the PKCE verifier, validates the identity and returns an encrypted grant', async () => {
	var responses = [],
		s = service(responses),
		q = begin(s.oauth).searchParams;
	responses.push({
		status: 200,
		body: {
			access_token: 'AT',
			refresh_token: 'RT',
			expires_in: 3600,
			id_token: jwt({ aud: CLIENT, nonce: q.get('nonce'), preferred_username: 'Jane.Doe@contoso.example' })
		}
	});
	var grant = await s.oauth.finish({ state: q.get('state'), code: 'CODE' });
	var call = s.calls[0];
	Assert.equal(call.host, 'login.microsoftonline.com');
	Assert.equal(call.path, '/common/oauth2/v2.0/token');
	Assert.equal(call.params.grant_type, 'authorization_code');
	Assert.equal(call.params.code, 'CODE');
	Assert.equal(call.params.redirect_uri, redirectUri);
	Assert.equal(Crypto.createHash('sha256').update(call.params.code_verifier).digest('base64url'), q.get('code_challenge'));
	Assert.equal(grant.username, 'jane.doe@contoso.example');
	Assert.equal(grant.email, 'jane@contoso.example');
	Assert.deepEqual(grant.oauth, { provider: 'microsoft', refresh: { sealed: 'RT' } });
	Assert.equal(grant.access.token, 'AT');
	await Assert.rejects(s.oauth.finish({ state: q.get('state'), code: 'CODE' }), /invalid_state/);
	Assert.equal(s.calls.length, 1, 'a replayed state never reaches the provider');
});
test('a bad state, replayed state, expired state, wrong audience, wrong nonce or missing refresh token is refused', async () => {
	for (var [name, make] of [
		[
			'wrong audience',
			(q) => ({
				status: 200,
				body: {
					access_token: 'AT',
					refresh_token: 'RT',
					id_token: jwt({ aud: 'someone-else', nonce: q.get('nonce'), preferred_username: 'a@b.sk' })
				}
			})
		],
		[
			'wrong nonce',
			() => ({
				status: 200,
				body: {
					access_token: 'AT',
					refresh_token: 'RT',
					id_token: jwt({ aud: CLIENT, nonce: 'forged', preferred_username: 'a@b.sk' })
				}
			})
		],
		[
			'no refresh token',
			(q) => ({
				status: 200,
				body: { access_token: 'AT', id_token: jwt({ aud: CLIENT, nonce: q.get('nonce'), preferred_username: 'a@b.sk' }) }
			})
		],
		['token error', () => ({ status: 400, body: { error: 'invalid_grant' } })]
	]) {
		var holder = [],
			s = service(holder),
			q = begin(s.oauth).searchParams;
		holder.push(make(q));
		await Assert.rejects(s.oauth.finish({ state: q.get('state'), code: 'CODE' }), undefined, name);
		await Assert.rejects(s.oauth.finish({ state: q.get('state'), code: 'CODE' }), /invalid_state/, name + ' consumes the state');
	}
	var s2 = service([]);
	await Assert.rejects(s2.oauth.finish({ state: 'forged', code: 'CODE' }), /invalid_state/);
	var q3 = begin(s2.oauth).searchParams;
	s2.clock.t += 11 * 60000;
	await Assert.rejects(s2.oauth.finish({ state: q3.get('state'), code: 'CODE' }), /invalid_state/);
	var q4 = begin(s2.oauth).searchParams;
	await Assert.rejects(s2.oauth.finish({ state: q4.get('state'), code: '' }), /invalid_state/);
	s2.oauth.cancel(q4.get('state'));
});
test('access tokens are cached, refreshed once for concurrent callers, rotated and expire into a re-login', async () => {
	var stored = [],
		store = {
			setOAuth: async (id, oauth, status) => {
				stored.push([id, oauth, status]);
			}
		};
	var account = { id: 'acc', oauth: { provider: 'microsoft', refresh: { sealed: 'RT0' } } };
	var ok = (n) => ({ status: 200, body: { access_token: 'AT' + n, refresh_token: 'RT' + n, expires_in: 3600 } });
	var s = service([ok(1), ok(2)]);
	var [a, b] = await Promise.all([s.oauth.accessToken(account, store), s.oauth.accessToken(account, store)]);
	Assert.deepEqual([a, b], ['AT1', 'AT1']);
	Assert.equal(s.calls.length, 1);
	Assert.equal(s.calls[0].params.grant_type, 'refresh_token');
	Assert.equal(s.calls[0].params.refresh_token, 'RT0');
	Assert.deepEqual(stored[0], ['acc', { provider: 'microsoft', refresh: { sealed: 'RT1' } }, undefined]);
	Assert.equal(await s.oauth.accessToken(account, store), 'AT1');
	Assert.equal(s.calls.length, 1);
	s.clock.t += 3600 * 1000 - 100000;
	Assert.equal(await s.oauth.accessToken({ ...account, oauth: stored[0][1] }, store), 'AT2');
	var dead = service([{ status: 400, body: { error: 'invalid_grant' } }]);
	await Assert.rejects(dead.oauth.accessToken(account, store), /expired/);
	Assert.equal(stored.at(-1)[2], 'reauth');
	var offline = service([Error('ENOTFOUND')]);
	await Assert.rejects(offline.oauth.accessToken(account, store), /Could not reach Microsoft/);
	await Assert.rejects(service([]).oauth.accessToken({ id: 'x' }, store), /Sign in with Microsoft/);
});
test('the client secret is read from the settings of the installation and goes only to the token request', async () => {
	own.clientSecret = 'from-settings';
	try {
		Assert.equal(Oauth.settings('microsoft').clientSecret, 'from-settings');
		var url = begin(service([]).oauth);
		Assert.ok(!url.href.includes('from-settings'), 'never in the authorization URL');
		var responses = [],
			s = service(responses),
			q = begin(s.oauth).searchParams;
		responses.push({
			status: 200,
			body: {
				access_token: 'AT',
				refresh_token: 'RT',
				expires_in: 3600,
				id_token: jwt({ aud: CLIENT, nonce: q.get('nonce'), preferred_username: 'a@outlook.com' })
			}
		});
		await s.oauth.finish({ state: q.get('state'), code: 'CODE' });
		Assert.equal(s.calls[0].params.client_secret, 'from-settings');
		own.clientSecret = '';
		var open = [],
			t = service(open),
			q2 = begin(t.oauth).searchParams;
		open.push({
			status: 200,
			body: {
				access_token: 'AT',
				refresh_token: 'RT',
				expires_in: 3600,
				id_token: jwt({ aud: CLIENT, nonce: q2.get('nonce'), preferred_username: 'a@outlook.com' })
			}
		});
		await t.oauth.finish({ state: q2.get('state'), code: 'CODE' });
		Assert.ok(!('client_secret' in t.calls[0].params), 'without a secret the public-client flow is attempted');
	} finally {
		own.clientSecret = '';
	}
});
test('the redirect address follows the request unless the administrator fixes it', () => {
	var { oauth } = service([]);
	var ctrl = { protocol: 'https', headers: { host: 'mail.example.com' } };
	Assert.equal(oauth.redirectUri(ctrl, 'microsoft'), 'https://mail.example.com/oauth/microsoft/callback');
	CONF.oauth_base_url = 'https://other.example/';
	try {
		Assert.equal(oauth.redirectUri(ctrl, 'microsoft'), 'https://other.example/oauth/microsoft/callback');
	} finally {
		delete CONF.oauth_base_url;
	}
});
test('IMAP authenticates OAuth accounts with the access token (XOAUTH2) and others with the password', async () => {
	var seen = [];
	var factory = (options) => {
		seen.push(options.auth);
		return { on() {}, connect: async () => {}, logout: async () => {}, close() {}, list: async () => [] };
	};
	var engine = Imap.create(factory),
		target = { address: '127.0.0.1', servername: 'localhost' };
	await engine.probe(
		{ id: 'a', authType: 'oauth2', imap: { port: 993, security: 'tls', username: 'me@contoso.example' } },
		'ACCESS',
		target
	);
	await engine.probe({ id: 'a', authType: 'password', imap: { port: 993, security: 'tls', username: 'me' } }, 'secret', target);
	Assert.deepEqual(seen, [
		{ user: 'me@contoso.example', accessToken: 'ACCESS' },
		{ user: 'me', pass: 'secret' }
	]);
});
test('an OAuth grant never reaches the browser', async () => {
	var Fs = require('node:fs'),
		Os = require('node:os'),
		Path = require('node:path');
	var dir = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'totalmail-oauth-'));
	try {
		var store = require('./db').store(dir, { accounts: [], messages: [], drafts: [] });
		var saved = await store.saveAccount({
			id: '',
			newId: 'A1',
			name: 'W',
			email: 'a@contoso.example',
			initials: 'W',
			configured: true,
			status: 'pending',
			authType: 'oauth2',
			oauth: { provider: 'microsoft', refresh: { sealed: 'RT' } },
			imap: {},
			smtp: {}
		});
		Assert.deepEqual(saved.oauth, { provider: 'microsoft' });
		Assert.ok(!JSON.stringify(store.snapshot()).includes('sealed'));
		Assert.equal(store.account('A1').oauth.refresh.sealed, 'RT');
		await store.setOAuth('A1', { provider: 'microsoft', refresh: { sealed: 'RT2' } }, 'reauth');
		Assert.equal(store.snapshot().accounts[0].status, 'reauth');
		await store.setOAuth('A1', { provider: 'microsoft', refresh: { sealed: 'RT3' } });
		Assert.equal(store.snapshot().accounts[0].status, 'pending');
	} finally {
		Fs.rmSync(dir, { recursive: true, force: true });
	}
});
