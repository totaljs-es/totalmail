require('total5');
const { test } = require('node:test');
const Assert = require('node:assert/strict');
const Fs = require('node:fs'),
	Os = require('node:os'),
	Path = require('node:path');
const Aliases = require('../lib/aliases');
const Store = require('../lib/store'),
	Live = require('../lib/live');
const Db = require('./db');
test('aliases are cleaned: lower case, no repeats, never the account address, bad input refused', () => {
	Assert.deepEqual(Aliases.parse('Ventas@Example.com, info@example.com;  ventas@example.com  soporte@example.com', 'info@example.com'), {
		list: ['ventas@example.com', 'soporte@example.com'],
		error: false
	});
	Assert.deepEqual(Aliases.parse('', 'a@example.com'), { list: [], error: false });
	for (var bad of ['not an address', 'a@b', 'a@b.c', '<x@example.com>', 'x@exa mple.com'])
		Assert.equal(Aliases.parse(bad, 'm@example.com').error, true, bad);
	Assert.equal(
		Aliases.parse(Array.from({ length: 11 }, (_, i) => 'a' + i + '@example.com').join(','), 'm@example.com').error,
		true,
		'ten at most'
	);
});
test('the sender is an alias the account really has, otherwise the account itself', () => {
	var account = { email: 'info@example.com', aliases: ['ventas@example.com'] };
	Assert.equal(Aliases.sender(account, 'Ventas@Example.com'), 'ventas@example.com');
	Assert.equal(Aliases.sender(account, 'info@example.com'), '', 'the main address is the default');
	Assert.equal(Aliases.sender(account, 'someone@else.test'), '', 'an address the account does not have is ignored');
	Assert.equal(Aliases.sender({ email: 'a@example.com' }, 'x@example.com'), '');
});
function fixture(t, aliases) {
	var dir = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'totalmail-alias-'));
	t.after(() => Fs.rmSync(dir, { recursive: true, force: true }));
	var account = {
		id: 'a',
		name: 'Me',
		email: 'me@example.test',
		aliases,
		configured: true,
		authType: 'password',
		secret: {},
		imap: { host: 'imap.example.test' },
		smtp: { host: 'smtp.example.test' }
	};
	return Db.store(dir, { accounts: [account], messages: [], drafts: [] });
}
test('a draft keeps the alias it was written for, and loses one the account no longer has', async (t) => {
	var store = fixture(t, ['sales@example.test']);
	var draft = await store.saveDraft({
		id: 'd',
		accountId: 'a',
		to: 'x@example.test',
		subject: 'S',
		body: 'B',
		from: 'Sales@Example.test'
	});
	Assert.equal(draft.from, 'sales@example.test');
	Assert.equal(
		(await store.saveDraft({ id: 'd', accountId: 'a', to: 'x@example.test', subject: 'S', body: 'B', from: 'stranger@example.test' }))
			.from,
		''
	);
	Assert.equal(
		(await store.saveDraft({ id: 'd', accountId: 'a', to: 'x@example.test', subject: 'S', body: 'B', from: 'me@example.test' })).from,
		'',
		'the main address is stored as no choice'
	);
});
test('the message goes out from the alias, the review is invalidated when it changes, and the Sent copy shows it', async (t) => {
	var store = fixture(t, ['sales@example.test']),
		sent = [];
	var live = Live.create({
		resolve: async () => ({ address: '127.0.0.1', servername: 'localhost' }),
		decrypt: () => 'x',
		imap: { saveSent: async () => ({ status: 'saved' }) },
		smtp: {
			options: () => ({}),
			send: async (options, account) => {
				sent.push(account.email);
				return { confirmed: true, source: 'Message-ID: <x@y>\r\n\r\nB' };
			}
		}
	});
	var draft = await store.saveDraft({
		id: 'd',
		accountId: 'a',
		to: 'x@example.test',
		subject: 'S',
		body: 'B',
		from: 'sales@example.test'
	});
	await Assert.rejects(store.beginSend('d', { ...draft, from: '' }), /draft changed/);
	await live.send({ id: 'b'.repeat(32) }, store, 'd', true, draft.revision);
	Assert.deepEqual(sent, ['sales@example.test']);
	Assert.equal(store.snapshot().messages.find((m) => m.sentDraftId === 'd').email, 'sales@example.test');
	// an alias removed after the draft was written: the account address is used
	var store2 = fixture(t, []),
		sent2 = [];
	var live2 = Live.create({
		resolve: async () => ({ address: '127.0.0.1', servername: 'localhost' }),
		decrypt: () => 'x',
		imap: { saveSent: async () => ({ status: 'saved' }) },
		smtp: {
			options: () => ({}),
			send: async (o, account) => {
				sent2.push(account.email);
				return { confirmed: true, source: 'x' };
			}
		}
	});
	var d2 = await store2.saveDraft({ id: 'd', accountId: 'a', to: 'x@example.test', subject: 'S', body: 'B', from: 'sales@example.test' });
	await live2.send({ id: 'b'.repeat(32) }, store2, 'd', true, d2.revision);
	Assert.deepEqual(sent2, ['me@example.test']);
});
test('the Message-ID carries the domain of the address the message goes out from', async (t) => {
	var store = fixture(t, ['sales@other.test']);
	await store.saveDraft({ id: 'd', accountId: 'a', to: 'x@example.test', subject: 'S', body: 'B' });
	Assert.match((await store.beginSend('d')).messageId, /^<[a-f0-9]{48}@example\.test>$/);
	var alias = fixture(t, ['sales@other.test']);
	await alias.saveDraft({ id: 'd', accountId: 'a', to: 'x@example.test', subject: 'S', body: 'B', from: 'sales@other.test' });
	Assert.match((await alias.beginSend('d')).messageId, /^<[a-f0-9]{48}@other\.test>$/);
});
