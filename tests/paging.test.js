require('total5');
const { test } = require('node:test');
const Assert = require('node:assert/strict');
const Fs = require('node:fs'),
	Os = require('node:os'),
	Path = require('node:path');
const Imap = require('../lib/imap'),
	Store = require('../lib/store'),
	Live = require('../lib/live');
const Db = require('./db');
const account = { id: 'a', imap: { security: 'tls', port: 993, username: 'u' } };
const target = { address: '127.0.0.1', servername: 'localhost' };

// A mailbox of 120 messages: seq n has UID 1000 + n; UIDs 1000+7 and 1000+40 were deleted elsewhere.
function mailbox(total = 120, gone = [7, 40], seen = new Set()) {
	var uids = Array.from({ length: total }, (_, i) => 1000 + i + 1).filter((u) => !gone.includes(u - 1000));
	var calls = [];
	var item = (seq) => ({
		seq,
		uid: uids[seq - 1],
		envelope: { from: [{ address: 'x@example.test', name: 'X' }], subject: 'm' + seq, date: new Date(2026, 0, 1, 0, seq) },
		flags: new Set(seen.has(uids[seq - 1]) ? ['\\Seen'] : []),
		size: 10
	});
	var client = {
		on() {},
		connect: async () => {},
		logout: async () => {},
		close() {},
		list: async () => [{ path: 'INBOX', flags: new Set(), delimiter: '/' }],
		getMailboxLock: async () => ({ release() {} }),
		mailbox: { uidValidity: 9n, exists: uids.length },
		fetchOne: async (id, query, options) => {
			calls.push(['one', id, options]);
			var seq = uids.indexOf(Number(id)) + 1;
			return seq ? { uid: Number(id), seq } : false;
		},
		fetch: (range, query, options) => {
			calls.push(['fetch', range, options]);
			return (async function* () {
				if (options?.uid) {
					for (var u of range.split(',').map(Number))
						if (uids.includes(u))
							yield { uid: u, flags: new Set(seen.has(u) ? ['\\Seen'] : []) };
				} else {
					var [a, b] = range.split(':').map(Number);
					for (var s = a; s <= b; s++)
						yield item(s);
				}
			})();
		}
	};
	return { engine: Imap.create(() => client), calls, uids };
}
test('sync fetches the latest page and only refreshes flags of cached older messages', async () => {
	var f = mailbox(120, [7, 40], new Set([1050]));
	var known = [1050, 1020, 1007, 1002, 1100].map((uid) => ({ uid, uidValidity: '9' })).concat({ uid: 1030, uidValidity: '8' });
	var result = await f.engine.sync(account, 'x', target, 'INBOX', known);
	Assert.equal(result.messages.length, 50);
	Assert.equal(result.messages[0].uid, 1120);
	Assert.equal(result.total, 118);
	Assert.deepEqual(result.kept.map((k) => k.uid).sort(), [1002, 1020, 1050]);
	Assert.equal(result.kept.find((k) => k.uid === 1050).unread, false);
	Assert.equal(result.kept.find((k) => k.uid === 1020).unread, true);
	Assert.ok(!result.kept.some((k) => k.uid === 1007), 'a message deleted on the server is not kept');
	Assert.ok(!result.kept.some((k) => k.uid === 1030), 'a stale UIDVALIDITY identity is not kept');
	Assert.ok(!f.calls.some((c) => c[0] === 'fetch' && !c[2]?.uid && !/^\d+:\d+$/.test(c[1])));
});
test('older pages by sequence from the oldest cached UID, checks UIDVALIDITY and stops at the start', async () => {
	var f = mailbox(120, [7, 40]);
	var page = await f.engine.older(account, 'x', target, 'INBOX', { uid: 1071, uidValidity: '9' });
	Assert.equal(page.messages.length, 50);
	Assert.equal(page.messages[0].uid, 1070);
	Assert.equal(page.messages[49].uid, 1020);
	Assert.ok(page.messages.every((m) => m.uid < 1071));
	Assert.equal(page.total, 118);
	var last = await f.engine.older(account, 'x', target, 'INBOX', { uid: 1001, uidValidity: '9' });
	Assert.deepEqual(last.messages, []);
	await Assert.rejects(f.engine.older(account, 'x', target, 'INBOX', { uid: 1071, uidValidity: '8' }));
	await Assert.rejects(f.engine.older(account, 'x', target, 'INBOX', { uid: 1007, uidValidity: '9' }));
});
function store(t) {
	var dir = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'totalmail-paging-'));
	t.after(() => Fs.rmSync(dir, { recursive: true, force: true }));
	return Db.store(dir, { accounts: [{ id: 'a', configured: true, email: 'a@example.test' }], messages: [], drafts: [] });
}
const msg = (uid, extra = {}) => ({
	id: 'imap-' + uid,
	accountId: 'a',
	remote: true,
	mailboxPath: 'INBOX',
	uidValidity: '9',
	uid,
	folder: 'inbox',
	unread: true,
	starred: false,
	body: '',
	bodyLoaded: false,
	...extra
});
test('store keeps older pages across syncs, drops what the server removed and tracks what is left to load', async (t) => {
	var s = store(t);
	await s.commitSync('a', { path: 'INBOX', uidValidity: '9', folders: [], total: 5, messages: [msg(105), msg(104), msg(103)], kept: [] });
	Assert.equal(s.snapshot().accounts[0].remaining.INBOX, 2);
	Assert.deepEqual(s.oldest('a', 'INBOX', 100), { uid: 103, uidValidity: '9' });
	var added = await s.commitOlder('a', {
		path: 'INBOX',
		uidValidity: '9',
		folders: [],
		total: 5,
		messages: [msg(102), msg(101), msg(103)]
	});
	Assert.equal(added.count, 2);
	Assert.equal(added.remaining, 0);
	Assert.equal(s.snapshot().messages.filter((m) => m.remote).length, 5);
	// A later sync: the latest window moved on, 102 was deleted, 101 was read elsewhere, 103 vanished from the window.
	await s.commitSync('a', {
		path: 'INBOX',
		uidValidity: '9',
		folders: [],
		total: 5,
		messages: [msg(106), msg(105), msg(104)],
		kept: [{ uid: 101, unread: false, starred: true }]
	});
	var after = s.snapshot().messages.filter((m) => m.remote);
	Assert.deepEqual(after.map((m) => m.uid).sort(), [101, 104, 105, 106]);
	Assert.equal(after.find((m) => m.uid === 101).unread, false);
	Assert.equal(after.find((m) => m.uid === 101).starred, true);
	Assert.equal(s.snapshot().accounts[0].remaining.INBOX, 1);
	Assert.deepEqual(
		s
			.known('a', 'INBOX')
			.map((k) => k.uid)
			.sort(),
		[101, 104, 105, 106]
	);
	Assert.throws(() => s.oldest('a', 'INBOX', 4), /maximum/);
	Assert.throws(() => s.oldest('a', 'Other', 100), /Sync this folder/);
});
test('live older pages from the oldest cached message of the requested folder only', async (t) => {
	var s = store(t),
		calls = [];
	await s.commitSync('a', { path: 'INBOX', uidValidity: '9', folders: [], total: 3, messages: [msg(105), msg(104)], kept: [] });
	var live = Live.create({
		resolve: async () => target,
		decrypt: () => 'x',
		imap: {
			older: async (acc, pw, tg, path, before) => {
				calls.push([path, before]);
				return { path, uidValidity: '9', folders: [], total: 3, messages: [msg(103)] };
			}
		}
	});
	var a = s.snapshot().accounts[0];
	var wrapped = {
		account: () => ({ ...a, authType: 'password', secret: {}, imap: { host: 'imap.example.test' } }),
		oldest: s.oldest,
		commitOlder: s.commitOlder
	};
	var out = await live.older({ id: 'u' }, wrapped, 'a', 'INBOX');
	Assert.deepEqual(calls, [['INBOX', { uid: 104, uidValidity: '9' }]]);
	Assert.equal(out.remaining, 0);
	await Assert.rejects(live.older({ id: 'u' }, wrapped, 'a', 'Hidden'));
});
