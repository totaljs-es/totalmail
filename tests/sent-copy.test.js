const { test } = require('node:test');
const Assert = require('node:assert/strict');
require('total5');
const Imap = require('../lib/imap');
const target = { address: '127.0.0.1', servername: 'localhost' },
	account = { id: 'a', imap: { port: 993, security: 'tls', username: 'fixture' } };
const id = '<fixture@totalmail.local>',
	source = 'Message-ID: ' + id + '\r\n\r\nBody\r\n';
function fixture(mode) {
	let appended = 0,
		existing = mode === 'existing';
	let client = {
		on() {},
		connect: async () => {},
		close() {},
		logout: async () => {},
		list: async () => (mode === 'missing' ? [] : [{ path: 'INBOX.Sent', specialUse: '\\Sent', flags: new Set() }]),
		mailbox: { uidValidity: 7n, readOnly: mode === 'readonly' },
		getMailboxLock: async () => ({ release() {} }),
		search: async () => (existing ? [42] : []),
		fetchOne: async (uid) => ({ uid, envelope: { messageId: id } }),
		append: async (path, content, flags) => {
			appended++;
			Assert.equal(path, 'INBOX.Sent');
			Assert.equal(content, source);
			Assert.deepEqual(flags, ['\\Seen']);
			if (mode === 'disconnect')
				throw Error('Disconnected');
			existing = mode !== 'unconfirmed';
			return true;
		}
	};
	return { engine: Imap.create(() => client), count: () => appended };
}
test('Sent copy confirms exact Message-ID and avoids an existing provider copy', async () => {
	for (let mode of ['new', 'existing']) {
		let f = fixture(mode);
		let saved = await f.engine.saveSent(account, 'secret', target, source, id);
		Assert.equal(saved.status, 'saved');
		Assert.equal(saved.uid, 42);
		Assert.equal(saved.uidValidity, '7');
		Assert.equal(f.count(), mode === 'existing' ? 0 : 1);
	}
});
test('missing, read-only and unconfirmed Sent folders never trigger automatic retries', async () => {
	let missing = fixture('missing');
	Assert.equal((await missing.engine.saveSent(account, 'secret', target, source, id)).status, 'unavailable');
	Assert.equal(missing.count(), 0);
	for (let mode of ['readonly', 'disconnect', 'unconfirmed']) {
		let f = fixture(mode);
		await Assert.rejects(f.engine.saveSent(account, 'secret', target, source, id));
		Assert.ok(f.count() <= 1);
	}
});
