require('total5');
const { test } = require('node:test');
const Assert = require('node:assert/strict');
const Fs = require('node:fs'),
	Os = require('node:os'),
	Path = require('node:path');
const Store = require('../lib/store'),
	Live = require('../lib/live');
const Db = require('./db');
const target = { address: '127.0.0.1', servername: 'localhost' };
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
	messageId: '<' + uid + '@x.test>',
	inReplyTo: '',
	references: [],
	...extra
});
function fixture(t) {
	var dir = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'totalmail-search-'));
	t.after(() => Fs.rmSync(dir, { recursive: true, force: true }));
	return Db.store(dir, { accounts: [{ id: 'a', configured: true, email: 'a@example.test' }], messages: [], drafts: [] });
}
test('server hits join the cache without duplicating, report every hit and recalculate what is unloaded', async (t) => {
	var s = fixture(t);
	await s.commitSync('a', { path: 'INBOX', uidValidity: '9', folders: [], total: 100, messages: [msg(100), msg(99)], kept: [] });
	var out = await s.commitFound(
		'a',
		{ path: 'INBOX', uidValidity: '9', folders: [], total: 100, found: 3, messages: [msg(99), msg(50), msg(10)] },
		5000
	);
	Assert.deepEqual(out.ids.sort(), ['imap-10', 'imap-50', 'imap-99']);
	Assert.equal(out.added, 2);
	Assert.equal(out.found, 3);
	Assert.equal(out.limited, false);
	var snapshot = s.snapshot();
	Assert.equal(snapshot.messages.filter((m) => m.remote).length, 4);
	Assert.equal(snapshot.accounts[0].remaining.INBOX, 96);
	await s.commitFound('a', { path: 'INBOX', uidValidity: '9', folders: [], total: 100, found: 1, messages: [msg(50)] }, 5000);
	Assert.equal(s.snapshot().messages.filter((m) => m.remote).length, 4, 'a repeated search adds nothing');
});
test('the cache limit is honoured and reported', async (t) => {
	var s = fixture(t);
	await s.commitSync('a', { path: 'INBOX', uidValidity: '9', folders: [], total: 50, messages: [msg(50), msg(49)], kept: [] });
	var out = await s.commitFound(
		'a',
		{ path: 'INBOX', uidValidity: '9', folders: [], total: 50, found: 3, messages: [msg(48), msg(47), msg(46)] },
		3
	);
	Assert.equal(out.added, 1);
	Assert.equal(out.limited, true);
	Assert.equal(s.snapshot().messages.filter((m) => m.remote).length, 3);
});
test('a thread link seen in the headers survives the next sync of a message that was opened', async (t) => {
	var s = fixture(t);
	await s.commitSync('a', {
		path: 'INBOX',
		uidValidity: '9',
		folders: [],
		total: 1,
		messages: [msg(5, { references: ['<1@x.test>'], inReplyTo: '<4@x.test>' })],
		kept: []
	});
	await s.cacheBody('imap-5', { body: 'Hi', bodyLoaded: true, references: [], inReplyTo: '' });
	await s.commitSync('a', {
		path: 'INBOX',
		uidValidity: '9',
		folders: [],
		total: 1,
		messages: [msg(5, { references: ['<1@x.test>'], inReplyTo: '<4@x.test>' })],
		kept: []
	});
	var m = s.snapshot().messages.find((x) => x.id === 'imap-5');
	Assert.deepEqual(m.references, ['<1@x.test>']);
	Assert.equal(m.inReplyTo, '<4@x.test>');
	Assert.equal(m.body, 'Hi');
});
test('a message opened before formatted mail existed is read again once, and one that was read since is not', async (t) => {
	var s = fixture(t),
		reads = 0;
	var a = {
		id: 'a',
		configured: true,
		authType: 'password',
		secret: {},
		imap: { host: 'imap.example.test' },
		mailboxes: [{ path: 'INBOX' }]
	};
	await s.commitSync('a', {
		path: 'INBOX',
		uidValidity: '9',
		folders: [],
		total: 2,
		messages: [msg(2, { bodyLoaded: true, body: 'old' }), msg(1, { bodyLoaded: true, body: 'new', hasHtml: false, unsubscribe: null })],
		kept: []
	});
	var store = { message: s.message, account: () => a, cacheBody: s.cacheBody };
	var live = Live.create({
		resolve: async () => target,
		decrypt: () => 'x',
		imap: {
			read: async () => {
				reads++;
				return {
					body: 'fresh',
					bodyLoaded: true,
					hasHtml: true,
					html: '<p>x</p>',
					remoteImages: 0,
					unsubscribe: null,
					invite: null
				};
			}
		}
	});
	var user = { id: 'u'.repeat(32) };
	Assert.equal((await live.read(user, store, 'imap-2')).body, 'fresh');
	Assert.equal(reads, 1);
	Assert.equal((await live.read(user, store, 'imap-1')).body, 'new');
	Assert.equal(reads, 1, 'a message that already knows its HTML and its mailing-list header is not read again');
	await s.commitSync('a', {
		path: 'INBOX',
		uidValidity: '9',
		folders: [],
		total: 1,
		messages: [msg(3, { bodyLoaded: true })],
		kept: [{ uid: 1, unread: true, starred: false }]
	});
	Assert.equal(s.snapshot().messages.find((m) => m.id === 'imap-1').hasHtml, false);
});
test('live search trims the text, refuses short or foreign folders and only talks to the requested account folder', async (t) => {
	var s = fixture(t),
		calls = [];
	var a = {
		id: 'a',
		configured: true,
		authType: 'password',
		secret: {},
		imap: { host: 'imap.example.test' },
		mailboxes: [{ path: 'INBOX' }, { path: 'Clients' }]
	};
	var store = { account: () => a, commitFound: s.commitFound };
	var live = Live.create({
		resolve: async () => target,
		decrypt: () => 'x',
		imap: {
			search: async (acc, pw, tg, path, query) => {
				calls.push([path, query]);
				return { path, uidValidity: '9', folders: [], total: 10, found: 1, messages: [msg(7)] };
			}
		}
	});
	var user = { id: 'u'.repeat(32) };
	await Assert.rejects(live.search(user, store, 'a', 'INBOX', ' x '), /at least two/);
	await Assert.rejects(live.search(user, store, 'a', 'INBOX', 'x'.repeat(201)), /at least two/);
	await Assert.rejects(live.search(user, store, 'a', 'Hidden', 'invoice'), /not available/);
	var out = await live.search(user, store, 'a', 'Clients', '  invoice\u0000 2026  ');
	Assert.deepEqual(calls, [['Clients', 'invoice  2026']]);
	Assert.deepEqual(out.ids, ['imap-7']);
});
test('deleting for good and emptying the trash clean the cache, the replies that pointed at them and the unloaded count', async (t) => {
	var s = fixture(t);
	await s.commitSync('a', {
		path: 'Trash',
		uidValidity: '9',
		folders: [],
		total: 10,
		messages: [msg(3, { mailboxPath: 'Trash', folder: 'trash' }), msg(2, { mailboxPath: 'Trash', folder: 'trash' })],
		kept: []
	});
	await s.commitSync('a', { path: 'INBOX', uidValidity: '9', folders: [], total: 1, messages: [msg(1)], kept: [] });
	await s.saveDraft({ id: 'd', accountId: 'a', replyTo: 'imap-3', body: 'x' });
	await s.commitErased('imap-3');
	var after = s.snapshot();
	Assert.deepEqual(
		after.messages
			.filter((m) => m.remote)
			.map((m) => m.id)
			.sort(),
		['imap-1', 'imap-2']
	);
	Assert.equal(after.drafts[0].replyTo, '');
	Assert.equal(after.accounts[0].remaining.Trash, 7);
	var out = await s.commitEmptied('a', 'Trash');
	Assert.equal(out.removed, 1);
	Assert.deepEqual(
		s
			.snapshot()
			.messages.filter((m) => m.remote)
			.map((m) => m.id),
		['imap-1'],
		'the inbox is untouched'
	);
	Assert.equal(s.snapshot().accounts[0].remaining.Trash, 0);
});
test('live refuses permanent deletion of anything that is not a server message in the trash', async (t) => {
	var s = fixture(t),
		calls = [];
	var live = Live.create({
		resolve: async () => target,
		decrypt: () => 'x',
		imap: {
			erase: async () => {
				calls.push('erase');
				return {};
			}
		}
	});
	await s.commitSync('a', { path: 'INBOX', uidValidity: '9', folders: [], total: 1, messages: [msg(1)], kept: [] });
	var user = { id: 'u'.repeat(32) };
	var store = {
		message: s.message,
		account: () => ({ id: 'a', configured: true, authType: 'password', secret: {}, imap: { host: 'imap.example.test' } }),
		commitErased: s.commitErased
	};
	Assert.throws(() => live.erase(user, store, 'imap-1'), /Only messages in the trash/);
	Assert.deepEqual(calls, []);
});
