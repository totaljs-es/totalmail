require('total5');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const imap = require('../lib/imap');
const live = require('../lib/live');
const account = { id: 'a', imap: { security: 'tls', port: 993, username: 'user' } };
const target = { address: '127.0.0.1', servername: 'localhost' };
const source = [
	'From: Sender <sender@example.test>',
	'To: me@example.test',
	'Subject: Files',
	'MIME-Version: 1.0',
	'Content-Type: multipart/mixed; boundary="b"',
	'',
	'--b',
	'Content-Type: text/plain; charset=utf-8',
	'',
	'See attached.',
	'',
	'--b',
	'Content-Type: application/pdf; name="..\\evil/report.pdf"',
	'Content-Disposition: attachment; filename="..\\evil/report.pdf"',
	'Content-Transfer-Encoding: base64',
	'',
	Buffer.from('PDFDATA').toString('base64'),
	'',
	'--b',
	'Content-Type: text/html',
	'Content-Disposition: attachment',
	'',
	'<script>alert(1)</script>',
	'',
	'--b--',
	''
].join('\r\n');
function engine(validity = 7n) {
	var client = {
		on() {},
		connect: async () => {},
		logout: async () => {},
		close() {},
		getMailboxLock: async () => ({ release() {} }),
		mailbox: { uidValidity: validity },
		download: async () => ({ content: Readable.from([source]) })
	};
	return imap.create(() => client);
}
const message = { mailboxPath: 'INBOX', uidValidity: '7', uid: 1, size: 3000000 };
test('reading lists attachment metadata with safe names and no content, beyond the old 2 MB limit', async () => {
	var result = await engine().read(account, 'x', target, message);
	assert.match(result.body, /See attached/);
	assert.equal(result.attachmentCount, 2);
	assert.deepEqual(
		result.attachments.map((a) => a.index),
		[0, 1]
	);
	assert.ok(!/[\\\/]/.test(result.attachments[0].name));
	assert.ok(result.attachments.every((a) => !('content' in a)));
	await assert.rejects(engine().read(account, 'x', target, { ...message, size: imap.maxmessage + 1 }));
});
test('attachment download returns the exact bytes, checks UIDVALIDITY and rejects unknown indexes', async () => {
	var file = await engine().attachment(account, 'x', target, message, 0);
	assert.equal(file.content.toString(), 'PDFDATA');
	assert.ok(!/[\\\/]/.test(file.name));
	await assert.rejects(engine().attachment(account, 'x', target, message, 9));
	await assert.rejects(engine().attachment(account, 'x', target, message, -1));
	await assert.rejects(engine(8n).attachment(account, 'x', target, message, 0));
});
test('live attachment refuses local messages and re-reads cached bodies that lack the attachment list', async () => {
	var calls = 0,
		stored = { id: 'm', accountId: 'a', remote: true, bodyLoaded: true, attachmentCount: 1 };
	var store = {
		message: (id) => (id === 'local' ? { id, remote: false } : stored),
		account: () => ({ id: 'a', authType: 'password', secret: {}, imap: { host: 'imap.example.test' } }),
		cacheBody: async (id, body) => ({ ...stored, ...body })
	};
	var l = live.create({
		resolve: async () => target,
		decrypt: () => 'x',
		imap: {
			read: async () => {
				calls++;
				return { bodyLoaded: true, attachmentCount: 1, attachments: [{ index: 0, name: 'a', size: 1 }] };
			},
			attachment: async () => ({ name: 'a', content: Buffer.from('x') })
		}
	});
	assert.throws(() => l.attachment({ id: 'u' }, store, 'local', 0));
	assert.equal((await l.read({ id: 'u' }, store, 'm')).attachments.length, 1);
	assert.equal(calls, 1);
	assert.equal((await l.attachment({ id: 'u' }, store, 'm', 0)).content.toString(), 'x');
});

test('outgoing files are private per user, addressed by random IDs and never escape their folder', async (t) => {
	let Fs = require('node:fs'),
		Os = require('node:os'),
		Path = require('node:path');
	let root = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'totalmail-files-'));
	t.after(() => Fs.rmSync(root, { recursive: true, force: true }));
	let files = require('../lib/files').create(root),
		user = 'a'.repeat(32),
		other = 'b'.repeat(32);
	let id = await files.put(user, Buffer.from('secret'));
	assert.equal((await files.get(user, id)).toString(), 'secret');
	await assert.rejects(files.get(other, id));
	await assert.rejects(files.get(user, '../' + id));
	await assert.rejects(files.get('../x', id));
	await files.remove(user, id);
	await assert.rejects(files.get(user, id));
	assert.equal(Fs.statSync(Path.join(root, user)).mode & 0o077, 0);
});
test('draft attachments enforce limits, change the revision and survive autosaves', async (t) => {
	let Fs = require('node:fs'),
		Os = require('node:os'),
		Path = require('node:path');
	let dir = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'totalmail-draft-'));
	t.after(() => Fs.rmSync(dir, { recursive: true, force: true }));
	let limits = require('../lib/files').limits;
	let store = require('./db').store(dir, { accounts: [{ id: 'a', configured: true }], messages: [], drafts: [] });
	let first = await store.saveDraft({ id: 'd', accountId: 'a', body: 'x' });
	let item = (n, size = 10) => ({ id: String(n).padStart(32, '0'), name: 'f' + n, type: 'text/plain', size });
	let added = await store.addAttachment('d', item(1), limits);
	assert.notEqual(added.revision, first.revision);
	let saved = await store.saveDraft({ id: 'd', accountId: 'a', body: 'edited' });
	assert.deepEqual(
		saved.attachments.map((a) => a.id),
		[item(1).id]
	);
	await assert.rejects(store.addAttachment('d', item(2, limits.total), limits));
	for (let n = 2; n <= limits.files; n++)
		await store.addAttachment('d', item(n), limits);
	await assert.rejects(store.addAttachment('d', item(99), limits));
	await assert.rejects(store.addAttachment('missing', item(1), limits));
	let removed = await store.removeAttachment('d', item(1).id);
	assert.equal(removed.attachments.length, limits.files - 1);
	await assert.rejects(store.removeAttachment('d', item(1).id));
	// A draft with attachments cannot be sent after they change.
	await assert.rejects(store.beginSend('d', { ...removed, attachments: saved.attachments }));
	await store.beginSend('d', removed);
});
