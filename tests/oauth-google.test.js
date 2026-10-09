require('total5');
const { test } = require('node:test');
const Assert = require('node:assert/strict');
const Crypto = require('node:crypto');
const Fs = require('node:fs'),
	Os = require('node:os'),
	Path = require('node:path');
const Oauth = require('../lib/oauth'),
	Instance = require('../lib/instance'),
	Providers = require('../lib/providers');
const CLIENT = '123456789012-abc123def456.apps.googleusercontent.com';
var own = { clientId: CLIENT, clientSecret: 'GOCSPX-test' };
Oauth.useInstance({ oauth: () => own });
var jwt = (claims) => 'x.' + Buffer.from(JSON.stringify(claims)).toString('base64url') + '.y';
function service(responses) {
	var calls = [];
	var oauth = Oauth.create({
		sweep: false,
		now: () => 1000000,
		encrypt: (v) => ({ sealed: v }),
		decrypt: (v) => v.sealed,
		request: async (host, path, params) => {
			calls.push({ host, path, params });
			return responses.shift();
		}
	});
	return { oauth, calls };
}
const redirectUri = 'https://mail.example.test/oauth/google/callback';
const begin = (oauth) =>
	new URL(oauth.start({ userId: 'u'.repeat(32), provider: 'google', email: 'Ana@Gmail.com', name: 'Ana', redirectUri }));
test('the Google authorization URL asks for offline access and the whole mailbox, with PKCE', () => {
	var url = begin(service([]).oauth),
		q = url.searchParams;
	Assert.equal(url.origin + url.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
	Assert.equal(q.get('client_id'), CLIENT);
	Assert.equal(q.get('access_type'), 'offline');
	Assert.equal(q.get('prompt'), 'consent', 'a refresh token comes with every consent');
	Assert.ok(q.get('scope').split(' ').includes('https://mail.google.com/'));
	Assert.equal(q.get('response_mode'), null, 'no Microsoft-only parameter');
	Assert.equal(q.get('code_challenge_method'), 'S256');
	Assert.equal(q.get('login_hint'), 'Ana@Gmail.com');
	Assert.ok(!url.href.includes('GOCSPX'), 'the secret never travels in the browser');
});
test('the code is redeemed at Google, without a scope, and only a verified address of the right application is accepted', async () => {
	var holder = [],
		s = service(holder),
		q = begin(s.oauth).searchParams;
	holder.push({
		status: 200,
		body: {
			access_token: 'AT',
			refresh_token: 'RT',
			expires_in: 3599,
			id_token: jwt({ aud: CLIENT, nonce: q.get('nonce'), email: 'ana@gmail.com', email_verified: true })
		}
	});
	var grant = await s.oauth.finish({ state: q.get('state'), code: 'CODE' });
	Assert.equal(s.calls[0].host, 'oauth2.googleapis.com');
	Assert.equal(s.calls[0].path, '/token');
	Assert.equal(s.calls[0].params.client_secret, 'GOCSPX-test');
	Assert.equal(s.calls[0].params.scope, undefined, 'Google refuses a scope here');
	Assert.equal(Crypto.createHash('sha256').update(s.calls[0].params.code_verifier).digest('base64url'), q.get('code_challenge'));
	Assert.equal(grant.username, 'ana@gmail.com');
	Assert.deepEqual(grant.oauth, { provider: 'google', refresh: { sealed: 'RT' } });
	for (var [name, claims] of [
		['unverified', { email_verified: false }],
		['no flag', {}],
		['other application', { aud: 'x.apps.googleusercontent.com', email_verified: true }]
	]) {
		var h2 = [],
			s2 = service(h2),
			q2 = begin(s2.oauth).searchParams;
		h2.push({
			status: 200,
			body: {
				access_token: 'AT',
				refresh_token: 'RT',
				id_token: jwt({ aud: CLIENT, nonce: q2.get('nonce'), email: 'ana@gmail.com', ...claims })
			}
		});
		await Assert.rejects(s2.oauth.finish({ state: q2.get('state'), code: 'CODE' }), undefined, name);
	}
});
test('renewal goes to Google without a scope, keeps the refresh token Google does not rotate, and a revoked grant asks for a new sign-in naming Google', async () => {
	var stored = [],
		store = {
			setOAuth: async (id, oauth, status) => {
				stored.push([id, status]);
			}
		};
	var account = { id: 'g1', oauth: { provider: 'google', refresh: { sealed: 'RT0' } } };
	var s = service([{ status: 200, body: { access_token: 'AT1', expires_in: 3599 } }]);
	Assert.equal(await s.oauth.accessToken(account, store), 'AT1');
	Assert.equal(s.calls[0].host, 'oauth2.googleapis.com');
	Assert.deepEqual(
		[s.calls[0].params.grant_type, s.calls[0].params.refresh_token, s.calls[0].params.scope],
		['refresh_token', 'RT0', undefined]
	);
	Assert.deepEqual(stored, [], 'no new refresh token, nothing rewritten');
	var gone = service([{ status: 400, body: { error: 'invalid_grant' } }]);
	await Assert.rejects(gone.oauth.accessToken({ id: 'g2', oauth: { provider: 'google', refresh: { sealed: 'RT' } } }, store), /Google/);
	Assert.deepEqual(stored, [['g2', 'reauth']]);
});
test('application IDs are checked in their own shape, and only Microsoft has tenants and administrator approval', () => {
	var s = service([]);
	Assert.equal(s.oauth.configured('google'), true);
	Assert.equal(Oauth.settings('google').clientId, CLIENT);
	var saved = own.clientId;
	own.clientId = '00000000-0000-4000-8000-000000000001';
	Assert.equal(Oauth.settings('google').clientId, '', 'a Microsoft-style ID is not a Google client ID');
	own.clientId = saved;
	Assert.throws(() => s.oauth.adminConsentUrl('google', 'gmail.com', redirectUri), /Invalid operation/);
	Assert.equal(Oauth.meta('google').tenant, false);
	Assert.equal(Oauth.meta('nonsense'), null);
});
test('the administrator can save a Google client with its secret, and a bad ID is refused', async (t) => {
	var dir = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'totalmail-google-'));
	t.after(() => Fs.rmSync(dir, { recursive: true, force: true }));
	var store = await Instance.open({
		table: require('./db').table(dir),
		crypto: {
			encrypt: (v) => ({ sealed: Buffer.from(v).toString('base64') }),
			decrypt: (v) => Buffer.from(v.sealed, 'base64').toString()
		}
	});
	await store.saveOAuth('google', { clientId: CLIENT, clientSecret: 'TOP', tenant: 'organizations' });
	Assert.deepEqual(store.view().oauth.google, { clientId: CLIENT, tenant: '', secretSet: true }, 'tenants do not exist for Google');
	await Assert.rejects(store.saveOAuth('google', { clientId: '00000000-0000-4000-8000-000000000001' }), /client ID is a code/);
	await Assert.rejects(store.saveOAuth('nonsense', { clientId: CLIENT }), /Invalid operation/);
});
test('Google is offered as an account type that signs in with OAuth, next to the app-password Gmail', () => {
	var catalogue = Providers.create(Path.join(__dirname, '../plugins'));
	var google = catalogue.get('google'),
		gmail = catalogue.get('gmail');
	Assert.equal(google.auth, 'oauth2');
	Assert.equal(gmail.auth, 'app-password');
	Assert.equal(google.adminConsent, false);
	Assert.deepEqual([google.imap.host, google.smtp.host, google.username], ['imap.gmail.com', 'smtp.gmail.com', 'email']);
	Assert.equal(catalogue.get('microsoft').adminConsent, true);
	Assert.deepEqual(google.domains, [], 'an address is never detected as this type: Gmail stays the default for gmail.com');
});
