const { test } = require('node:test');
const Assert = require('node:assert/strict');
const Fs = require('node:fs');
const Path = require('node:path');
const Os = require('node:os');
require('total5');
const Db = require('./db');
const Welcome = require('../lib/welcome');
for (var language of ['en', 'es', 'sk'])
	Total.loadresource(language, Fs.readFileSync(Path.join(__dirname, '../resources', language + '.resource'), 'utf8'));
test('welcome appears once per account after successful INBOX sync and survives restart', async (t) => {
	var directory = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'totalmail-welcome-'));
	t.after(() => Fs.rmSync(directory, { recursive: true, force: true }));
	var seed = {
		accounts: [
			{ id: 'one', configured: true },
			{ id: 'two', configured: true }
		],
		messages: [],
		drafts: []
	};
	var store = Db.store(directory, seed);
	Assert.equal(store.snapshot().messages.length, 0);
	var result = { path: 'Sent', messages: [], folders: [], limited: false, total: 0 };
	await store.commitSync('one', result);
	Assert.equal(store.snapshot().messages.length, 0);
	await store.commitSync('one', { ...result, path: 'INBOX' });
	await store.commitSync('one', { ...result, path: 'INBOX' });
	store = await Db.reopen(directory);
	await store.commitSync('one', { ...result, path: 'INBOX' });
	Assert.equal(store.snapshot().messages.length, 1);
	await store.changeMessage('welcome-one', 'read');
	await store.changeMessage('welcome-one', 'archive');
	await store.commitSync('one', { ...result, path: 'INBOX' });
	Assert.equal(store.snapshot().messages[0].folder, 'archive');
	Assert.equal(store.snapshot().messages[0].unread, false);
	await store.commitSync('two', { ...result, path: 'INBOX' });
	Assert.equal(store.snapshot().messages.length, 2);
	var message = store.snapshot().messages[0];
	Assert.equal(Welcome.decorate(message, 'es').subject, 'Bienvenido a TotalMail');
	Assert.match(Welcome.decorate(message, 'sk').body, /iba v TotalMail/);
	Assert.equal(message.remote, false);
});
