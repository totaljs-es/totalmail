require('total5');
var { test } = require('node:test');
var assert = require('node:assert/strict');
var fs = require('node:fs');
var os = require('node:os');
var path = require('node:path');
var Db = require('./db');
function fixture(t, data) {
	let dir = fs.mkdtempSync(path.join(os.tmpdir(), 'totalmail-reads-'));
	t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
	return Db.store(dir, data);
}
var data = () => ({
	accounts: [
		{ id: 'a', name: 'A', email: 'a@example.test', configured: true, status: 'synced' },
		{ id: 'b', name: 'B', email: 'b@example.test', configured: true, status: 'pending' },
		{ id: 'c', name: 'C', email: 'c@example.test', configured: false, status: 'verified' }
	],
	messages: [
		{ id: 'm1', accountId: 'a', folder: 'inbox', remote: true, subject: 'One', html: '<p>big</p>' },
		{ id: 'm2', accountId: 'a', folder: 'trash', remote: true, subject: 'Two' },
		{ id: 'm3', accountId: 'a', folder: 'inbox', subject: 'Local only' },
		{ id: 'm4', accountId: 'b', folder: 'inbox', remote: true, subject: 'Other account' }
	],
	drafts: [{ id: 'd1', accountId: 'a', to: 'x@example.test', subject: 'Draft', body: 'B', status: 'draft' }]
});
test('only accounts that are set up and connected can be read', (t) => {
	assert.deepEqual(fixture(t, data()).accountIds(), ['a']);
});
test('a draft is read as a copy, and a missing one is undefined', (t) => {
	let store = fixture(t, data());
	let draft = store.draft('d1');
	assert.equal(draft.subject, 'Draft');
	draft.subject = 'Changed outside';
	assert.equal(store.draft('d1').subject, 'Draft', 'the copy does not reach the mailbox');
	assert.equal(store.draft('nope'), undefined);
});
test('the messages of a folder are those of the server in that account, without their HTML, as copies', (t) => {
	let store = fixture(t, data());
	let list = store.folderMessages('a', 'inbox');
	assert.deepEqual(list.map((m) => m.id), ['m1']);
	assert.equal('html' in list[0], false);
	list[0].subject = 'Changed outside';
	assert.equal(store.folderMessages('a', 'inbox')[0].subject, 'One');
	assert.equal(store.message('m1').html, '<p>big</p>', 'the stored message keeps it');
});
test('a folder can be narrowed before it is copied', (t) => {
	let store = fixture(t, data());
	assert.deepEqual(store.folderMessages('a', 'inbox', (m) => m.subject === 'One').map((m) => m.id), ['m1']);
	assert.deepEqual(store.folderMessages('a', 'inbox', () => false), []);
});
