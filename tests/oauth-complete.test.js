require('total5');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Oauth = require('../modules/oauth');
function fixture(existing) {
	let saved = [],
		remembered = [];
	MODS.users = {
		forUser: (user) => ({
			user,
			account: () => existing,
			saveAccount: async (account) => (saved.push(account), { id: account.newId || account.id })
		})
	};
	MODS.providers = {
		serversFor: () => ({
			imap: { host: 'imap.example.test', port: 993, security: 'tls' },
			smtp: { host: 'smtp.example.test', port: 465, security: 'tls' }
		})
	};
	Oauth.remember = (id, access) => remembered.push([id, access]);
	return { saved, remembered };
}
let grant = {
	userId: 'u1',
	email: 'ana@example.test',
	username: 'ana@example.test',
	name: 'Ana Ruiz',
	oauth: { provider: 'google' },
	access: 'token'
};
test('a sign-in started from the account type list adds an account without a stored password', async () => {
	let f = fixture();
	assert.equal(await Oauth.complete({ id: 'google' }, grant), 'ok');
	assert.equal(f.saved.length, 1);
	let account = f.saved[0];
	assert.equal(account.authType, 'oauth2');
	assert.equal(account.initials, 'AR');
	assert.equal(account.imap.username, 'ana@example.test');
	assert.ok(account.newId && !('secret' in account));
	assert.deepEqual(f.remembered, [[account.newId, 'token']]);
});
test('a sign-in started for an existing account turns it into an OAuth account and drops its password', async () => {
	let f = fixture({ id: 'a1', name: 'Mine', email: 'ana@example.test', imap: { username: 'ana@example.test' } });
	assert.equal(await Oauth.complete({ id: 'google' }, { ...grant, accountId: 'a1' }), 'ok');
	assert.equal(f.saved[0].id, 'a1');
	assert.equal(f.saved[0].secret, null);
	assert.equal(f.saved[0].name, 'Mine');
	assert.deepEqual(f.remembered, [['a1', 'token']]);
});
test('a sign-in with another address than the account is refused and saves nothing', async () => {
	let f = fixture({ id: 'a1', name: 'Mine', email: 'other@example.test', imap: { username: 'other@example.test' } });
	assert.equal(await Oauth.complete({ id: 'google' }, { ...grant, accountId: 'a1' }), 'mismatch');
	assert.equal(f.saved.length, 0);
	assert.equal(f.remembered.length, 0);
});
