// The OAuth providers that TotalMail knows: what differs between them (the rest of the flow is in oauth.js). A file without state,
// so the settings of the installation (modules/instance.js) can check an application ID without loading the sign-in itself.
// What differs between providers; the rest of the flow is the same. `valid` is the shape of an application ID.
var providers = {
	microsoft: {
		name: 'Microsoft',
		host: 'login.microsoftonline.com',
		authorize: function(tenant) { return '/' + tenant + '/oauth2/v2.0/authorize'; },
		token: function(tenant) { return '/' + tenant + '/oauth2/v2.0/token'; },
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
		authorize: function() { return '/o/oauth2/v2/auth'; },
		token: function() { return '/token'; },
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

exports.providers = providers;

// What the administrator's window needs to check an application ID.
exports.meta = function(provider) { return providers[provider] ? { name: providers[provider].name, valid: providers[provider].valid, tenant: providers[provider].tenant } : null; };
