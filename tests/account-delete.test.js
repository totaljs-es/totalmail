require('total5');
var { test } = require('node:test');
var Assert = require('node:assert/strict');
var Fs = require('node:fs'),
	Os = require('node:os'),
	Path = require('node:path');
var Db = require('./db');
function fixture(t, seed) {
	var dir = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'totalmail-account-delete-'));
	t.after(() => Fs.rmSync(dir, { recursive: true, force: true }));
	return { dir, store: Db.store(dir, seed) };
}
var seed = () => ({
	accounts: [
		{ id: 'a', name: 'Work', email: 'work@example.test', configured: true },
		{ id: 'b', name: 'Home', email: 'home@example.test', configured: true }
	],
	messages: [
		{ id: 'm1', accountId: 'a', folder: 'inbox' },
		{ id: 'm2', accountId: 'a', folder: 'archive' },
		{ id: 'm3', accountId: 'b', folder: 'inbox' }
	],
	drafts: [
		{ id: 'd1', accountId: 'a', attachments: [{ id: 'f1' }, { id: 'f2' }] },
		{ id: 'd2', accountId: 'b', attachments: [{ id: 'f3' }] }
	]
});
test('removing an account takes out its mail and drafts, and only those', async (t) => {
	var { store } = fixture(t, seed());
	var removed = await store.deleteAccount('a');
	Assert.deepEqual(removed, { id: 'a', files: ['f1', 'f2'] });
	var data = store.snapshot();
	Assert.deepEqual(
		data.accounts.map((a) => a.id),
		['b']
	);
	Assert.deepEqual(
		data.messages.map((m) => m.id),
		['m3']
	);
	Assert.deepEqual(
		data.drafts.map((d) => d.id),
		['d2']
	);
});
test('it survives a restart', async (t) => {
	var { dir, store } = fixture(t, seed());
	await store.deleteAccount('b');
	var again = await Db.reopen(dir);
	Assert.deepEqual(
		again.snapshot().accounts.map((a) => a.id),
		['a']
	);
	Assert.deepEqual(
		again.snapshot().messages.map((m) => m.id),
		['m1', 'm2']
	);
});
test('an account that is not there is refused', async (t) => {
	var { store } = fixture(t, seed());
	await Assert.rejects(() => store.deleteAccount('nope'), /Invalid account/);
	Assert.equal(store.snapshot().accounts.length, 2);
});
test('an account with a message being sent stays until that is known', async (t) => {
	var { store } = fixture(t, seed());
	await store.beginSend(store.snapshot().drafts[0].id);
	await Assert.rejects(() => store.deleteAccount('a'), /being sent/);
	Assert.equal(store.snapshot().accounts.length, 2);
	Assert.equal(store.snapshot().messages.length, 3);
});
test('a message that was being sent when the process stopped is of unknown delivery, and can be settled', async (t) => {
	var data = seed();
	data.drafts[0].status = 'sending';
	var { store } = fixture(t, data);
	Assert.equal(store.snapshot().drafts[0].status, 'unknown');
	await store.deleteAccount('a');
	Assert.equal(store.snapshot().accounts.length, 1, 'the account no longer stays forever because of it');
});
