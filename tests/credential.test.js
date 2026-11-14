require('total5');
var { test } = require('node:test');
var assert = require('node:assert/strict');
var Credential = require('../plugins/mail/credential');
function make() {
	var asked = [];
	var credential = Credential.create({
		oauth: { accessToken: async (account) => (asked.push(account.id), 'fresh-token') },
		decrypt: (value) => 'plain:' + value
	});
	return { credential, asked };
}
var store = (account) => ({ account: () => account });
test('an OAuth account is given a fresh access token, and its stored secret is never read', async () => {
	var { credential, asked } = make();
	var result = await credential(store({ id: 'a', authType: 'oauth2', secret: 'ignored' }), 'a');
	assert.equal(result.password, 'fresh-token');
	assert.equal(result.account.id, 'a');
	assert.deepEqual(asked, ['a']);
});
test('a password account is given its decrypted password', async () => {
	var { credential, asked } = make();
	var result = await credential(store({ id: 'b', authType: 'password', secret: 'abc' }), 'b');
	assert.equal(result.password, 'plain:abc');
	assert.deepEqual(asked, []);
});
test('an account with no password says what to do', async () => {
	var { credential } = make();
	await assert.rejects(credential(store({ id: 'c', authType: 'password' }), 'c'), /Save a mail password or app password/);
});
