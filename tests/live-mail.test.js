const { test } = require('node:test'),
	assert = require('node:assert/strict'),
	fs = require('node:fs'),
	path = require('node:path'),
	os = require('node:os');
require('total5');
const Db = require('./db'),
	{ create } = require('../lib/live'),
	imap = require('../lib/imap');
function fixture(t) {
	let dir = fs.mkdtempSync(path.join(os.tmpdir(), 'totalmail-live-'));
	t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
	let account = {
		id: 'real',
		configured: true,
		email: 'sender@example.test',
		name: 'Sender',
		authType: 'password',
		secret: { data: 'test' },
		imap: { host: 'imap.example.com', port: 993, security: 'tls', username: 'test' },
		smtp: { host: 'smtp.example.com', port: 465, security: 'tls', username: 'test' }
	};
	return { account, store: Db.store(dir, { accounts: [account], messages: [], drafts: [] }) };
}
const user = { id: 'fixture' },
	resolve = async (host) => ({ address: '8.8.8.8', servername: host }),
	decrypt = () => 'fixture-secret';
test('read-only IMAP sync selects stable UIDs and limits the header window without source fetch', async () => {
	let options, query, range, opened;
	let fake = {
		on() {},
		connect: async () => {},
		close() {},
		logout: async () => {},
		list: async () => [
			{ path: 'INBOX', name: 'Inbox', flags: new Set() },
			{ path: 'Trash', name: 'Trash', flags: new Set(['\\Noselect']) }
		],
		getMailboxLock: async (p, o) => {
			opened = o;
			return { release() {} };
		},
		mailbox: { uidValidity: 99n, exists: 70 },
		async *fetch(r, q) {
			range = r;
			query = q;
			yield {
				uid: 42,
				envelope: {
					from: [{ name: 'Sender', address: 'from@example.test' }],
					subject: '<script>example</script>',
					date: new Date()
				},
				flags: new Set(),
				size: 100
			};
		}
	};
	let engine = imap.create((o) => {
		options = o;
		return fake;
	});
	let result = await engine.sync(
		{ id: 'a', imap: { host: 'imap.example.com', port: 993, security: 'starttls', username: 'user' } },
		'test',
		await resolve('imap.example.com'),
		'INBOX'
	);
	assert.equal(options.doSTARTTLS, true);
	assert.equal(options.logger, false);
	assert.equal(options.tls.rejectUnauthorized, true);
	assert.equal(opened.readOnly, true);
	assert.equal(range, '21:70');
	assert.ok(!query.source);
	assert.equal(result.messages[0].uidValidity, '99');
	assert.equal(result.folders.length, 1);
	assert.equal(result.limited, true);
	assert.notEqual(imap.messageId('a', 'INBOX', 99, 42), imap.messageId('a', 'INBOX', 100, 42));
});
test('MIME reading decodes plain text, never returns active HTML, and checks UIDVALIDITY', async () => {
	let { Readable } = require('node:stream');
	let fake = {
		on() {},
		connect: async () => {},
		logout: async () => {},
		close() {},
		getMailboxLock: async () => ({ release() {} }),
		mailbox: { uidValidity: 7n },
		download: async () => ({
			content: Readable.from([
				'From: Sender <sender@example.test>\r\nTo: me@example.test\r\nSubject: Test\r\nMessage-ID: <parent@example.test>\r\nReferences: <root@example.test>\r\nReply-To: replies@example.test\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<p>Hello</p><img src="https://external.example/pixel"><script>alert(1)</script>'
			])
		})
	};
	let engine = imap.create(() => fake);
	let account = { imap: { security: 'tls', port: 993, username: 'user' } };
	let body = await engine.read(account, 'test', await resolve('imap.example.com'), {
		mailboxPath: 'INBOX',
		uidValidity: '7',
		uid: 1,
		size: 200
	});
	assert.match(body.body, /Hello/);
	assert.equal(body.messageId, '<parent@example.test>');
	assert.deepEqual(body.references, ['<root@example.test>']);
	assert.equal(body.replyAddress, 'replies@example.test');
	assert.equal(body.hasHtml, true);
	assert.equal(body.remoteImages, 1);
	assert.match(body.html, /Hello/);
	assert.ok(!/<script|alert\(1\)| src="https/.test(body.html), 'the HTML that is returned is sanitized and keeps remote images off');
	assert.ok(!body.body.includes('<img'));
	await assert.rejects(
		engine.read(account, 'test', await resolve('imap.example.com'), { mailboxPath: 'INBOX', uidValidity: '8', uid: 1, size: 200 })
	);
});
test('sync replaces a mailbox window while preserving bodies for unchanged UID identities', async (t) => {
	let { store } = fixture(t);
	let folder = { id: 'inbox', path: 'INBOX', accountId: 'real' },
		msg = { id: 'one', accountId: 'real', remote: true, mailboxPath: 'INBOX', uidValidity: '1', uid: 1, body: '', bodyLoaded: false };
	await store.commitSync('real', { messages: [msg], folders: [folder], path: 'INBOX', limited: false, total: 1 });
	await store.cacheBody('one', { body: 'Original body', bodyLoaded: true });
	await store.commitSync('real', { messages: [{ ...msg }], folders: [folder], path: 'INBOX', limited: false, total: 1 });
	assert.equal(store.snapshot().messages.find((m) => m.remote).body, 'Original body');
	await store.commitSync('real', {
		messages: [{ ...msg, id: 'new-validity', uidValidity: '2' }],
		folders: [folder],
		path: 'INBOX',
		limited: false,
		total: 1
	});
	assert.equal(store.snapshot().messages.filter((m) => m.remote).length, 1);
	assert.equal(store.snapshot().messages.find((m) => m.remote).body, '');
	await assert.rejects(store.changeMessage('new-validity', 'archive'));
});
test('send requires explicit confirmation, uses stored recipients, and blocks duplicate/unknown sends', async (t) => {
	let { store } = fixture(t);
	await store.saveDraft({ id: 'draft', accountId: 'real', to: 'recipient@example.test', subject: 'Test', body: 'Body' });
	let count = 0;
	let smtp = {
		options: () => ({}),
		send: async () => {
			count++;
			throw Error('SMTP disconnected');
		}
	};
	let live = create({ smtp, imap: {}, resolve, decrypt });
	assert.throws(() => live.send(user, store, 'draft', false));
	await assert.rejects(live.send(user, store, 'draft', true, store.snapshot().drafts[0].revision));
	assert.equal(store.snapshot().drafts[0].status, 'unknown');
	await assert.rejects(live.send(user, store, 'draft', true, store.snapshot().drafts[0].revision));
	assert.equal(count, 1);
	await assert.rejects(store.saveDraft({ id: 'draft', accountId: 'real', to: 'other@example.test', subject: 'Edited', body: 'Edited' }));
});
test('concurrent account operations and edits during send preparation are rejected', async (t) => {
	let { store } = fixture(t);
	await store.saveDraft({ id: 'draft', accountId: 'real', to: 'recipient@example.test', subject: 'Test', body: 'Body' });
	let proceed;
	let live = create({
		smtp: { options: () => ({}), send: async () => {} },
		imap: {},
		resolve: () => new Promise((r) => (proceed = r)),
		decrypt
	});
	let pending = live.send(user, store, 'draft', true, store.snapshot().drafts[0].revision);
	await assert.rejects(live.sync(user, store, 'real', 'INBOX'));
	await store.saveDraft({ id: 'draft', accountId: 'real', to: 'new@example.test', subject: 'New', body: 'New' });
	proceed({ address: '8.8.8.8', servername: 'smtp.example.com' });
	await assert.rejects(pending);
	assert.ok(!store.snapshot().drafts[0].status);
});

test('confirmation rejects a draft edited in another window before sending', async (t) => {
	let { store } = fixture(t);
	let shown = await store.saveDraft({ id: 'draft', accountId: 'real', to: 'recipient@example.test', subject: 'Test', body: 'Shown' });
	await store.saveDraft({ ...shown, body: 'Changed elsewhere' });
	let live = create({ resolve, decrypt });
	assert.throws(() => live.send(user, store, 'draft', true, shown.revision), /draft changed/);
});

test('reply context comes from the same-account store, never client supplied headers', async (t) => {
	let { store } = fixture(t);
	await store.commitSync('real', {
		messages: [
			{
				id: 'parent',
				accountId: 'real',
				remote: true,
				mailboxPath: 'INBOX',
				uidValidity: '1',
				uid: 1,
				messageId: '<old@example.test>',
				bodyLoaded: false
			}
		],
		folders: [],
		path: 'INBOX',
		total: 1
	});
	await store.saveDraft({
		id: 'reply',
		accountId: 'real',
		replyTo: 'parent',
		to: 'recipient@example.test',
		subject: 'Re: Test',
		body: 'Reply'
	});
	let captured;
	let live = create({
		resolve,
		decrypt,
		imap: {
			read: async () => ({
				body: 'Original',
				bodyLoaded: true,
				messageId: '<parent@example.test>',
				references: ['<root@example.test>']
			})
		},
		smtp: {
			options: () => ({}),
			send: async (options, account, draft, recipients, parent) => {
				captured = parent;
			}
		}
	});
	await live.send(user, store, 'reply', true, store.snapshot().drafts[0].revision);
	assert.equal(captured.messageId, '<parent@example.test>');
	assert.deepEqual(captured.references, ['<root@example.test>']);
	await store.commitSync('real', {
		messages: [{ id: 'parent', accountId: 'real', remote: true, mailboxPath: 'INBOX', uidValidity: '1', uid: 1, bodyLoaded: false }],
		folders: [],
		path: 'INBOX',
		total: 1
	});
	assert.deepEqual(store.message('parent').references, ['<root@example.test>']);
});

test('a draft cannot attach another account message as its reply parent', async (t) => {
	let { store, account } = fixture(t);
	await store.commitSync('real', {
		messages: [{ id: 'parent', accountId: 'real', remote: true, mailboxPath: 'INBOX', uidValidity: '1', uid: 1 }],
		folders: [],
		path: 'INBOX',
		total: 1
	});
	await store.saveAccount({ ...account, id: '', newId: 'other', email: 'other@example.test' });
	await assert.rejects(
		store.saveDraft({
			id: 'foreign-reply',
			accountId: 'other',
			replyTo: 'parent',
			to: 'recipient@example.test',
			subject: 'Re: Test',
			body: 'Reply'
		}),
		/Invalid thread/
	);
});

test('sending refreshes the confirmed Sent folder without resubmitting if that refresh fails', async (t) => {
	for (var fails of [false, true]) {
		let { store } = fixture(t),
			submissions = 0,
			refreshes = 0;
		let draft = await store.saveDraft({ id: 'sent-refresh', accountId: 'real', to: 'recipient@example.test', subject: 'Test', body: 'Body' });
		let live = create({
			resolve,
			decrypt,
			smtp: { options: () => ({}), send: async () => { submissions++; return { source: 'MIME' }; } },
			imap: {
				saveSent: async () => ({ status: 'saved', path: 'INBOX.Sent', uid: 42, uidValidity: '7' }),
				sync: async (account, password, target, path, known) => {
					refreshes++;
					assert.equal(path, 'INBOX.Sent');
					assert.deepEqual(known, []);
					if (fails)
						throw Error('Refresh disconnected');
					return {
						path,
						uidValidity: '7',
						total: 1,
						folders: [{ id: 'sent-folder', path, specialUse: '\\Sent' }],
						messages: [{ id: 'remote-sent', accountId: account.id, folder: 'sent-folder', mailboxPath: path, remote: true, uid: 42, uidValidity: '7' }]
					};
				}
			}
		});
		assert.equal((await live.send(user, store, draft.id, true, draft.revision)).sentCopy, 'saved');
		assert.equal(refreshes, 1);
		assert.equal(store.snapshot().messages.some((m) => m.id === 'remote-sent'), !fails);
		assert.equal(store.snapshot().drafts[0].status, 'sent');
		await assert.rejects(live.send(user, store, draft.id, true, draft.revision));
		assert.equal(submissions, 1);
	}
});

test('confirmed SMTP remains sent when its server copy fails, and cannot be resubmitted', async (t) => {
	let { store } = fixture(t);
	await store.saveDraft({
		id: 'sent-copy',
		accountId: 'real',
		to: 'recipient@example.test',
		cc: 'copy@example.test',
		subject: 'Test',
		body: 'Body'
	});
	let submissions = 0;
	let live = create({
		resolve,
		decrypt,
		imap: {
			saveSent: async () => {
				throw Error('IMAP disconnected');
			}
		},
		smtp: {
			options: () => ({}),
			send: async (options, account, draft, to, parent, cc) => {
				submissions++;
				assert.deepEqual(cc, ['copy@example.test']);
				return { source: 'MIME', messageId: draft.messageId };
			}
		}
	});
	let result = await live.send(user, store, 'sent-copy', true, store.snapshot().drafts[0].revision);
	assert.equal(result.status, 'sent');
	assert.equal(result.sentCopy, 'unknown');
	assert.equal(store.snapshot().drafts[0].status, 'sent');
	assert.equal(store.snapshot().messages.find((m) => m.sentDraftId === 'sent-copy').sentCopy, 'unknown');
	await assert.rejects(live.send(user, store, 'sent-copy', true, store.snapshot().drafts[0].revision));
	assert.equal(submissions, 1);
});
