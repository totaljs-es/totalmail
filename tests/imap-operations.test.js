const { test } = require('node:test');
const Assert = require('node:assert/strict');
const Fs = require('node:fs'),
	Os = require('node:os'),
	Path = require('node:path');
require('total5');
const Imap = require('../lib/imap'),
	Db = require('./db'),
	Live = require('../lib/live');
const account = {
	id: 'account',
	configured: true,
	authType: 'password',
	secret: {},
	imap: { host: 'imap.example.test', port: 993, security: 'tls', username: 'fixture' }
};
const target = { address: '127.0.0.1', servername: 'localhost' };
const message = {
	id: 'source',
	accountId: 'account',
	remote: true,
	folder: 'inbox',
	mailboxPath: 'INBOX',
	uidValidity: '123',
	uid: 42,
	unread: true,
	starred: false,
	body: 'Cached body',
	bodyLoaded: true
};
function fixture(overrides = {}) {
	var moved = false,
		current = 'INBOX',
		flags = new Set(['\\Answered']),
		writes = [],
		releases = 0;
	var listed = [
		{ path: 'INBOX', flags: new Set(), delimiter: '.' },
		{ path: 'INBOX.Archive', specialUse: '\\Archive', flags: new Set(), delimiter: '.' },
		{ path: 'INBOX.Trash', specialUse: '\\Trash', flags: new Set(), delimiter: '.' }
	];
	var client = {
		on() {},
		connect: async () => {},
		logout: async () => {},
		close() {},
		capabilities: new Set(['MOVE', 'UIDPLUS']),
		namespace: { prefix: 'INBOX.', delimiter: '.' },
		mailbox: { uidValidity: 123n, readOnly: false },
		list: async () => listed,
		getMailboxLock: async (path, options) => {
			current = path;
			client.mailbox = { uidValidity: path === 'INBOX' ? 123n : 456n, readOnly: !!options.readOnly };
			return {
				release() {
					releases++;
				}
			};
		},
		fetchOne: async (uid, query, options) => {
			Assert.equal(options.uid, true);
			if (current === 'INBOX' && moved)
				return false;
			return { uid, flags: new Set(flags) };
		},
		messageFlagsAdd: async (uid, values, options) => {
			Assert.equal(uid, 42);
			Assert.equal(options.uid, true);
			writes.push(values);
			for (var flag of values)
				flags.add(flag);
			return true;
		},
		messageFlagsRemove: async (uid, values, options) => {
			Assert.equal(uid, 42);
			Assert.equal(options.uid, true);
			writes.push(values);
			for (var flag of values)
				flags.delete(flag);
			return true;
		},
		messageMove: async (uid, path, options) => {
			Assert.equal(uid, 42);
			Assert.equal(options.uid, true);
			writes.push(path);
			moved = true;
			return { uidMap: new Map([[42, 81]]), uidValidity: 456n };
		},
		mailboxCreate: async (parts) => {
			writes.push(parts);
			var path = parts.join('.');
			if (!path.startsWith('INBOX.'))
				path = 'INBOX.' + path;
			listed.push({ path, flags: new Set(), delimiter: '.' });
			return { path, created: true };
		},
		...overrides
	};
	return { client, engine: Imap.create(() => client), writes, released: () => releases };
}
test('flag changes use explicit UID states, preserve other flags and confirm removals', async () => {
	var f = fixture();
	Assert.deepEqual(await f.engine.flags(account, 'fixture', target, message, '\\Seen', true), { unread: false, starred: false });
	await f.engine.flags(account, 'fixture', target, message, '\\Flagged', true);
	await f.engine.flags(account, 'fixture', target, message, '\\Seen', false);
	Assert.deepEqual(await f.engine.flags(account, 'fixture', target, message, '\\Flagged', false), { unread: true, starred: false });
	Assert.deepEqual(f.writes, [['\\Seen'], ['\\Flagged'], ['\\Seen'], ['\\Flagged']]);
	await Assert.rejects(f.engine.flags(account, 'fixture', target, message, '\\Deleted', true));
	var denied = fixture({ messageFlagsAdd: async () => false });
	await Assert.rejects(denied.engine.flags(account, 'fixture', target, message, '\\Seen', true));
	Assert.equal(denied.released(), 1);
});
test('native move checks source UIDVALIDITY, confirms source removal and remaps destination UID', async () => {
	var f = fixture(),
		result = await f.engine.move(account, 'fixture', target, message, '', '\\Archive');
	Assert.equal(result.moved.uid, 81);
	Assert.equal(result.moved.uidValidity, '456');
	Assert.equal(result.moved.id, Imap.messageId('account', 'INBOX.Archive', '456', 81));
	Assert.equal(result.moved.body, 'Cached body');
	Assert.equal(result.moved.folder, 'archive');
	Assert.equal(f.released(), 2);
	Assert.deepEqual(f.writes, ['INBOX.Archive']);
});
test('unsupported moves, nonexistent destinations, same folder and stale UID identities do not write', async () => {
	for (var [overrides, source, path] of [
		[{ capabilities: new Set(['UIDPLUS']) }, message, 'INBOX.Trash'],
		[{}, message, 'OtherAccount/Trash'],
		[{}, message, 'INBOX'],
		[{}, { ...message, uidValidity: '999' }, 'INBOX.Trash'],
		[{ fetchOne: async () => false }, message, 'INBOX.Trash']
	]) {
		var f = fixture(overrides);
		await Assert.rejects(f.engine.move(account, 'fixture', target, source, path));
		Assert.deepEqual(f.writes, []);
	}
});
test('ambiguous move and invalid destination mapping reject; no UIDPLUS still removes confirmed source', async () => {
	var f = fixture({ messageMove: async () => ({ uidMap: new Map([[42, 81]]), uidValidity: 456n }) });
	await Assert.rejects(f.engine.move(account, 'fixture', target, message, 'INBOX.Trash'), /could not be confirmed/);
	f = fixture({
		messageMove: async () => {
			f.client.fetchOne = async () => false;
			return { uidMap: new Map([[42, 81]]), uidValidity: 456n };
		}
	});
	await Assert.rejects(f.engine.move(account, 'fixture', target, message, 'INBOX.Trash'), /could not be confirmed/);
	f = fixture({
		messageMove: async () => {
			f.client.fetchOne = async () => false;
			return { destination: 'INBOX.Trash' };
		}
	});
	Assert.equal((await f.engine.move(account, 'fixture', target, message, 'INBOX.Trash')).moved, null);
});
test('folder creation respects the server namespace and rejects separators, controls and foreign parents', async () => {
	var f = fixture();
	var result = await f.engine.createFolder(account, 'fixture', target, 'Clientes', 'INBOX.Archive');
	Assert.equal(result.path, 'INBOX.Archive.Clientes');
	Assert.deepEqual(f.writes, [['INBOX.Archive', 'Clientes']]);
	for (var name of ['', 'a.b', 'a\r\nCREATE Other', '*', '%', 'x'.repeat(81)])
		await Assert.rejects(f.engine.createFolder(account, 'fixture', target, name));
	await Assert.rejects(f.engine.createFolder(account, 'fixture', target, 'Valid', 'Foreign'));
	Assert.equal(f.writes.length, 1);
});
test('live writes commit only confirmed states, preserve drafts and private accounts, and persist across restart', async (t) => {
	var dir = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'totalmail-move-'));
	t.after(() => Fs.rmSync(dir, { recursive: true, force: true }));
	var store = Db.store(dir, {
		accounts: [account],
		messages: [message],
		drafts: [{ id: 'draft', replyTo: message.id, body: 'Keep draft' }]
	});
	var f = fixture(),
		live = Live.create({ imap: f.engine, resolve: async () => target, decrypt: () => 'fixture' });
	await live.change({ id: 'user' }, store, 'source', 'star', true);
	Assert.equal(store.message('source').starred, true);
	await live.change({ id: 'user' }, store, 'source', 'unread');
	Assert.equal(store.message('source').unread, true);
	await Assert.rejects(live.move({ id: 'user' }, store, 'source', 'Foreign'));
	Assert.equal(store.message('source').id, 'source');
	var result = await live.change({ id: 'user' }, store, 'source', 'archive');
	Assert.throws(() => store.message('source'));
	Assert.equal(store.message(result.moved.id).body, 'Cached body');
	Assert.equal(store.snapshot().drafts[0].replyTo, result.moved.id);
	Assert.equal(store.snapshot().drafts[0].body, 'Keep draft');
	Assert.equal((await Db.reopen(dir)).message(result.moved.id).folder, 'archive');
	await live.createFolder({ id: 'user' }, store, account.id, 'Customers', '');
	Assert.ok(store.snapshot().accounts[0].mailboxes.some((f) => f.path === 'INBOX.Customers'));
	Assert.throws(() => live.move({ id: 'user' }, store, 'unknown', 'INBOX'));
});

test('server changes followed by disk failure keep the local snapshot and request reconciliation', async (t) => {
	var dir = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'totalmail-move-failure-'));
	t.after(() => Fs.rmSync(dir, { recursive: true, force: true }));
	var store = Db.failing({ accounts: [account], messages: [message], drafts: [] });
	var f = fixture(),
		live = Live.create({ imap: f.engine, resolve: async () => target, decrypt: () => 'fixture' });
	await Assert.rejects(live.change({ id: 'fixture' }, store, message.id, 'star', true), /server changed/);
	Assert.equal(store.message(message.id).starred, false);
	Assert.deepEqual(f.writes, [['\\Flagged']]);
});
