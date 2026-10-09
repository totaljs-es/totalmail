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
function fixture(t) {
	var dir = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'totalmail-compose-'));
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
	return Db.store(dir, { accounts: [account], messages: [], drafts: [] });
}
function send(store, calls) {
	return Live.create({
		resolve: async () => target,
		decrypt: () => 'x',
		imap: { saveSent: async () => ({ status: 'saved' }) },
		smtp: {
			options: () => ({}),
			send: async (options, account, draft, recipients, parent, copies, attachments, blind) => {
				calls.push({ recipients, copies, blind });
				return { confirmed: true, source: 'MIME', messageId: draft.messageId };
			}
		}
	});
}
const user = { id: 'u'.repeat(32) };
test('the hidden recipients of a draft are kept, count towards the limit and reach the sender separately', async (t) => {
	var store = fixture(t),
		calls = [],
		live = send(store, calls);
	var draft = await store.saveDraft({
		id: 'd',
		accountId: 'a',
		to: 'a@example.test',
		cc: 'b@example.test',
		bcc: 'c@example.test, d@example.test',
		subject: 'S',
		body: 'B'
	});
	Assert.equal(draft.bcc, 'c@example.test, d@example.test');
	var result = await live.send(user, store, 'd', true, draft.revision);
	Assert.equal(result.status, 'sent');
	Assert.deepEqual(calls[0], { recipients: ['a@example.test'], copies: ['b@example.test'], blind: ['c@example.test', 'd@example.test'] });
	var sent = store.snapshot().messages.find((m) => m.sentDraftId === 'd');
	Assert.equal(sent.bcc, 'c@example.test, d@example.test', 'the local sent copy remembers who was hidden');
});
test('changing the hidden recipients after the review invalidates it, and bad or too many addresses are refused', async (t) => {
	var store = fixture(t),
		calls = [],
		live = send(store, calls);
	var draft = await store.saveDraft({ id: 'd', accountId: 'a', to: 'a@example.test', bcc: 'c@example.test', subject: 'S', body: 'B' });
	await Assert.rejects(store.beginSend('d', { ...draft, bcc: 'someone-else@example.test' }), /draft changed/);
	var many = await store.saveDraft({
		id: 'many',
		accountId: 'a',
		to: 'a@example.test',
		cc: 'b@example.test',
		bcc: Array.from({ length: 9 }, (_, i) => 'h' + i + '@example.test').join(','),
		subject: 'S',
		body: 'B'
	});
	await Assert.rejects(live.send(user, store, 'many', true, many.revision), /up to 10/);
	var bad = await store.saveDraft({ id: 'bad', accountId: 'a', to: 'a@example.test', bcc: 'not an address', subject: 'S', body: 'B' });
	await Assert.rejects(live.send(user, store, 'bad', true, bad.revision), /up to 10/);
	Assert.equal(calls.length, 0, 'nothing was sent');
});
