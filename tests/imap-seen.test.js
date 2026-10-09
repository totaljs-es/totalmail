const { test } = require('node:test');
const Assert = require('node:assert/strict');
const Imap = require('../lib/imap');
const Fs = require('node:fs');
const Os = require('node:os');
const Path = require('node:path');
require('total5');
const Db = require('./db');
const Live = require('../lib/live');

function fixture(overrides = {}) {
	var seen = false,
		stores = 0,
		released = false;
	var client = {
		on() {},
		connect: async () => {},
		logout: async () => {},
		close() {},
		mailbox: { uidValidity: 123n, readOnly: false },
		getMailboxLock: async (path, options) => {
			Assert.equal(path, 'INBOX');
			Assert.equal(options.readOnly, false);
			return {
				release() {
					released = true;
				}
			};
		},
		fetchOne: async (uid, query, options) => {
			Assert.equal(uid, 42);
			Assert.equal(options.uid, true);
			return { uid: 42, flags: new Set(seen ? ['\\Flagged', '\\Seen'] : ['\\Flagged']) };
		},
		messageFlagsAdd: async (uid, flags, options) => {
			stores++;
			Assert.equal(uid, 42);
			Assert.deepEqual(flags, ['\\Seen']);
			Assert.equal(options.uid, true);
			seen = true;
			return true;
		},
		...overrides
	};
	return { engine: Imap.create(() => client), count: () => stores, released: () => released };
}
const account = { imap: { port: 993, security: 'tls', username: 'fixture' } };
const target = { address: '127.0.0.1', servername: 'localhost' };
const message = { mailboxPath: 'INBOX', uidValidity: '123', uid: 42 };

test('read status uses UID, adds only Seen, confirms it and is idempotent', async () => {
	var f = fixture();
	await f.engine.markRead(account, 'fixture', target, message);
	await f.engine.markRead(account, 'fixture', target, message);
	Assert.equal(f.count(), 1);
	Assert.equal(f.released(), true);
});

test('stale mailbox, missing UID, read-only and unconfirmed flags reject read status', async () => {
	var cases = [
		{ mailbox: { uidValidity: 999n } },
		{ fetchOne: async () => false },
		{ mailbox: { uidValidity: 123n, readOnly: true } },
		{ messageFlagsAdd: async () => false },
		{ messageFlagsAdd: async () => true }
	];
	for (var override of cases) {
		var f = fixture(override);
		await Assert.rejects(f.engine.markRead(account, 'fixture', target, message));
		Assert.equal(f.count(), 0);
		Assert.equal(f.released(), true);
	}
});

test('local unread state changes only after server confirmation and persists', async (t) => {
	var directory = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'totalmail-seen-'));
	t.after(() => Fs.rmSync(directory, { recursive: true, force: true }));
	var store = Db.store(directory, {
		accounts: [{ id: 'test', configured: true, authType: 'password', secret: {}, imap: { host: 'imap.example.test' } }],
		messages: [{ ...message, id: 'mail', accountId: 'test', remote: true, unread: true, starred: true }],
		drafts: []
	});
	var confirmed = false;
	var live = Live.create({
		imap: {
			markRead: async () => {
				if (!confirmed)
					throw Error('Unconfirmed');
			}
		},
		resolve: async () => target,
		decrypt: () => 'fixture'
	});
	await Assert.rejects(live.markRead({ id: 'user' }, store, 'mail'));
	Assert.equal(store.message('mail').unread, true);
	confirmed = true;
	await live.markRead({ id: 'user' }, store, 'mail');
	Assert.equal(store.message('mail').unread, false);
	Assert.equal(store.message('mail').starred, true);
	Assert.equal((await Db.reopen(directory)).message('mail').unread, false);
});
