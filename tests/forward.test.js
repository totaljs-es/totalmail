require('total5');
const { test } = require('node:test');
const Assert = require('node:assert/strict');
const Fs = require('node:fs'),
	Os = require('node:os'),
	Path = require('node:path');
const Store = require('../lib/store'),
	Live = require('../lib/live'),
	Files = require('../lib/files');
const Db = require('./db');
const user = { id: 'b'.repeat(32) };
function fixture(t, attachments) {
	var dir = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'totalmail-forward-'));
	t.after(() => Fs.rmSync(dir, { recursive: true, force: true }));
	var account = {
		id: 'a',
		name: 'Me',
		email: 'me@example.test',
		configured: true,
		authType: 'password',
		secret: {},
		imap: { host: 'imap.example.test' },
		smtp: { host: 'smtp.example.test' }
	};
	var message = { id: 'imap-' + 'a'.repeat(64), accountId: 'a', remote: true, folder: 'inbox', subject: 'Files', attachments };
	var local = { id: 'sent-1', accountId: 'a', remote: false, folder: 'sent-local', subject: 'Mine', attachments };
	var store = Db.store(dir, { accounts: [account], messages: [message, local], drafts: [] });
	var files = Files.create(Path.join(dir, 'files')),
		fetched = [];
	var live = Live.create({
		resolve: async () => ({ address: '127.0.0.1', servername: 'localhost' }),
		decrypt: () => 'x',
		files: () => files,
		imap: {
			attachment: async (a, p, target, m, index) => {
				fetched.push(index);
				return { name: attachments[index].name, content: Buffer.alloc(attachments[index].size, index + 1) };
			}
		}
	});
	return { store, live, message, local, fetched, files };
}
test('forwarding copies the original attachments into the draft', async (t) => {
	var f = fixture(t, [
		{ index: 0, name: 'report.pdf', type: 'application/pdf', size: 7 },
		{ index: 1, name: 'photo.png', type: 'image/png', size: 5 }
	]);
	var draft = await f.store.saveDraft({ id: 'd', accountId: 'a', to: '', subject: 'Fwd: Files', body: 'x' });
	var result = await f.live.forwardFiles(user, f.store, draft.id, f.message.id);
	Assert.deepEqual(
		result.attachments.map((a) => [a.name, a.size]),
		[
			['report.pdf', 7],
			['photo.png', 5]
		]
	);
	Assert.equal(result.skippedFiles, 0);
	Assert.equal((await f.files.get(user.id, result.attachments[0].id)).length, 7, 'the content is stored');
	Assert.equal(f.store.snapshot().drafts[0].attachments.length, 2, 'and the draft keeps them');
});
test('files over the limits are counted, not copied, and the rest still go', async (t) => {
	var big = Files.limits.file + 1;
	var f = fixture(t, [
		{ index: 0, name: 'huge.iso', type: 'x/y', size: big },
		{ index: 1, name: 'ok.txt', type: 'text/plain', size: 3 },
		{ index: 2, name: 'empty', type: 'x/y', size: 0 }
	]);
	var draft = await f.store.saveDraft({ id: 'd', accountId: 'a', to: '', subject: 'Fwd', body: 'x' });
	var result = await f.live.forwardFiles(user, f.store, draft.id, f.message.id);
	Assert.deepEqual(
		result.attachments.map((a) => a.name),
		['ok.txt']
	);
	Assert.equal(result.skippedFiles, 2);
	Assert.deepEqual(f.fetched, [1], 'the oversized and empty ones were never downloaded');
});
test('only remote messages have files to forward, and the draft must exist', async (t) => {
	var f = fixture(t, [{ index: 0, name: 'a.txt', type: 'text/plain', size: 1 }]);
	await Assert.rejects(f.live.forwardFiles(user, f.store, 'missing', f.message.id), /Draft not found/);
	var draft = await f.store.saveDraft({ id: 'd', accountId: 'a', to: '', subject: 'S', body: 'x' });
	var result = await f.live.forwardFiles(user, f.store, draft.id, f.local.id);
	Assert.equal((result.attachments || []).length, 0);
});
