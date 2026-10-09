require('total5');
const { test } = require('node:test');
const Assert = require('node:assert/strict');
const Fs = require('node:fs'),
	Os = require('node:os'),
	Path = require('node:path');
const Store = require('../lib/store'),
	Live = require('../lib/live'),
	Rules = require('../lib/rules');
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
	sender: 'Someone',
	email: 'someone@example.test',
	toRecipients: [],
	ccRecipients: [],
	subject: 'Hello ' + uid,
	body: '',
	bodyLoaded: false,
	...extra
});
function fixture(t, rules) {
	var dir = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'totalmail-rules-'));
	t.after(() => Fs.rmSync(dir, { recursive: true, force: true }));
	var account = {
		id: 'a',
		name: 'A',
		email: 'a@example.test',
		configured: true,
		authType: 'password',
		secret: {},
		imap: { host: 'imap.example.test' },
		mailboxes: [{ path: 'INBOX' }, { path: 'Clients' }],
		rules
	};
	return Db.store(dir, { accounts: [account], messages: [], drafts: [] });
}
const r = (id, extra) => ({
	id,
	name: 'rule ' + id,
	enabled: true,
	field: 'from',
	op: 'contains',
	value: 'github',
	action: 'archive',
	...extra
});
const user = { id: 'u'.repeat(32) };
function live(calls, fail = {}) {
	return Live.create({
		resolve: async () => target,
		decrypt: () => 'x',
		imap: {
			sync: async (a, p, t, path) => ({
				path,
				uidValidity: '9',
				folders: [],
				total: 100,
				messages: [
					msg(103, { email: 'noreply@github.com' }),
					msg(102, { email: 'ana@example.test' }),
					msg(101, { email: 'noreply@github.com' }),
					msg(100, { email: 'noreply@github.com' })
				],
				kept: []
			}),
			flags: async (a, p, t, m, flag, on) => {
				calls.push(['flags', m.id, flag, on]);
				if (fail.flags)
					throw Error('@(The server did not confirm the message status. Sync and try again.)');
				return { unread: flag === '\\Seen' ? !on : m.unread, starred: flag === '\\Flagged' ? on : m.starred };
			},
			move: async (a, p, t, m, path, special) => {
				calls.push(['move', m.id, path, special]);
				if (fail.move)
					throw Error('boom');
				return {
					folders: [],
					moved: {
						...m,
						id: m.id + '-moved',
						folder: special === '\\Archive' ? 'archive' : 'inbox',
						mailboxPath: path || 'Archive',
						uid: 900
					},
					path: path || 'Archive'
				};
			}
		}
	});
}
test('only mail that arrived since the last sync is touched, by the first matching rule, with every outcome logged', async (t) => {
	var s = fixture(t, [r('off', { enabled: false, action: 'trash' }), r('news', { action: 'archive' }), r('later', { action: 'trash' })]);
	await s.commitSync('a', {
		path: 'INBOX',
		uidValidity: '9',
		folders: [],
		total: 100,
		messages: [msg(100, { email: 'noreply@github.com' })],
		kept: []
	});
	var calls = [],
		summary = await live(calls).sync(user, s, 'a', 'INBOX');
	Assert.deepEqual(summary.fresh.sort(), ['imap-101', 'imap-102', 'imap-103']);
	Assert.deepEqual(
		calls.map((c) => c.slice(0, 2).concat(c[3])).sort(),
		[
			['move', 'imap-101', '\\Archive'],
			['move', 'imap-103', '\\Archive']
		],
		'the old message and the unrelated one are left alone, the disabled and later rules never run'
	);
	var snapshot = s.snapshot();
	Assert.ok(snapshot.messages.some((m) => m.id === 'imap-103-moved' && m.folder === 'archive'));
	Assert.ok(snapshot.messages.some((m) => m.id === 'imap-100' && m.folder === 'inbox'));
	var log = snapshot.accounts[0].ruleLog;
	Assert.equal(log.length, 2);
	Assert.ok(log.every((l) => l.ok && l.rule === 'rule news' && l.action === 'archive' && l.at));
});
test('the first sync of an inbox, and one after the mailbox identity changed, never run rules', async (t) => {
	var first = fixture(t, [r('news')]),
		calls = [];
	var out = await live(calls).sync(user, first, 'a', 'INBOX');
	Assert.deepEqual(out.fresh, []);
	Assert.deepEqual(calls, []);
	var changed = fixture(t, [r('news')]);
	await changed.commitSync('a', {
		path: 'INBOX',
		uidValidity: '5',
		folders: [],
		total: 1,
		messages: [msg(500, { uidValidity: '5' })],
		kept: []
	});
	Assert.deepEqual((await live(calls).sync(user, changed, 'a', 'INBOX')).fresh, []);
	Assert.deepEqual(calls, []);
});
test('read, star and move to a folder use the same operations as the buttons; a failing action is logged and does not fail the sync', async (t) => {
	var s = fixture(t, [
		r('read', { value: 'github', action: 'read' }),
		r('clients', { field: 'from', value: 'ana@', action: 'move', path: 'Clients' })
	]);
	await s.commitSync('a', { path: 'INBOX', uidValidity: '9', folders: [], total: 100, messages: [msg(100)], kept: [] });
	var calls = [];
	await live(calls).sync(user, s, 'a', 'INBOX');
	Assert.ok(calls.some((c) => c[0] === 'flags' && c[1] === 'imap-101' && c[2] === '\\Seen' && c[3] === true));
	Assert.ok(
		calls.some((c) => c[0] === 'move' && c[1] === 'imap-102' && c[2] === 'Clients' && c[3] === ''),
		'a folder rule moves to that exact folder'
	);
	var starred = fixture(t, [r('star', { field: 'subject', value: 'hello 102', action: 'star' })]),
		starCalls = [];
	await starred.commitSync('a', { path: 'INBOX', uidValidity: '9', folders: [], total: 100, messages: [msg(100)], kept: [] });
	await live(starCalls).sync(user, starred, 'a', 'INBOX');
	Assert.deepEqual(starCalls, [['flags', 'imap-102', '\\Flagged', true]]);
	Assert.equal(starred.snapshot().messages.find((m) => m.id === 'imap-102').starred, true);
	var broken = fixture(t, [r('news')]);
	await broken.commitSync('a', { path: 'INBOX', uidValidity: '9', folders: [], total: 100, messages: [msg(100)], kept: [] });
	var summary = await live([], { move: true }).sync(user, broken, 'a', 'INBOX');
	Assert.equal(summary.count, 4, 'the sync itself succeeded');
	var log = broken.snapshot().accounts[0].ruleLog;
	Assert.equal(log.length, 2);
	Assert.ok(
		log.every((l) => l.ok === false && l.error === 'failed'),
		'unexpected errors are logged without their details'
	);
	Assert.equal(broken.snapshot().messages.filter((m) => m.remote && m.folder === 'inbox').length, 4, 'nothing moved');
});
test('no more than the per-sync limit of actions run, the log is bounded, and rules are bounded too', async (t) => {
	var many = Array.from({ length: 40 }, (_, i) => msg(200 + i, { email: 'noreply@github.com' }));
	var s = fixture(t, [r('news')]),
		calls = [];
	await s.commitSync('a', { path: 'INBOX', uidValidity: '9', folders: [], total: 100, messages: [msg(100)], kept: [] });
	var engine = live(calls);
	var l = Live.create({
		resolve: async () => target,
		decrypt: () => 'x',
		imap: {
			sync: async (a, p, t2, path) => ({ path, uidValidity: '9', folders: [], total: 200, messages: many, kept: [] }),
			move: async (a, p, t2, m) => {
				calls.push(m.id);
				return { folders: [], moved: { ...m, id: m.id + 'm', folder: 'archive', mailboxPath: 'Archive' }, path: 'Archive' };
			}
		}
	});
	await l.sync(user, s, 'a', 'INBOX');
	Assert.equal(calls.length, Rules.limits.actionsPerSync);
	for (var i = 0; i < 4; i++)
		await s.logRules(
			'a',
			Array.from({ length: 40 }, () => ({ at: 'x', rule: 'y', action: 'z', ok: true })),
			Rules.limits.log
		);
	Assert.equal(s.snapshot().accounts[0].ruleLog.length, Rules.limits.log);
	for (i = 0; i < 29; i++)
		await s.saveRule('a', r('x' + i), Rules.limits.rules);
	await Assert.rejects(s.saveRule('a', r('over'), Rules.limits.rules), /up to 30/);
	await s.deleteRule('a', 'x0');
	await Assert.rejects(s.deleteRule('a', 'x0'), /not found/);
});
