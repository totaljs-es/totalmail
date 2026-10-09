require('total5');
const { test } = require('node:test');
const Assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const Imap = require('../lib/imap');
const Live = require('../lib/live');
const Store = require('../lib/store');
const Db = require('./db');
const Fs = require('node:fs'),
	Os = require('node:os'),
	Path = require('node:path');
const account = { id: 'a', imap: { security: 'tls', port: 993, username: 'user' } };
const target = { address: '127.0.0.1', servername: 'localhost' };
const message = { mailboxPath: 'INBOX', uidValidity: '7', uid: 1, size: 3000 };
function mail(extraHeaders = [], calendar = true) {
	return [
		'From: News <news@example.test>',
		'To: me@example.test',
		'Subject: Weekly',
		'MIME-Version: 1.0',
		...extraHeaders,
		'Content-Type: multipart/mixed; boundary="b"',
		'',
		'--b',
		'Content-Type: text/plain; charset=utf-8',
		'',
		'Hello',
		'',
		...(calendar
			? [
				'--b',
				'Content-Type: text/calendar; method=REQUEST; charset=utf-8',
				'Content-Disposition: attachment; filename="invite.ics"',
				'',
				'BEGIN:VCALENDAR',
				'METHOD:REQUEST',
				'BEGIN:VEVENT',
				'SUMMARY:Planning',
				'DTSTART:20261010T080000Z',
				'LOCATION:Room 1',
				'END:VEVENT',
				'END:VCALENDAR',
				''
			]
			: []),
		'--b--',
		''
	].join('\r\n');
}
function engine(source) {
	var client = {
		on() {},
		connect: async () => {},
		logout: async () => {},
		close() {},
		getMailboxLock: async () => ({ release() {} }),
		mailbox: { uidValidity: 7n },
		download: async () => ({ content: Readable.from([source]) })
	};
	return Imap.create(() => client);
}
test('a mailing list offers its unsubscribe address only when it is safe to follow', async () => {
	var both = await engine(
		mail(['List-Unsubscribe: <https://example.test/u?id=1>, <mailto:stop@example.test?subject=unsubscribe%20me>'])
	).read(account, 'x', target, message);
	Assert.deepEqual(both.unsubscribe, { url: 'https://example.test/u?id=1', mail: 'stop@example.test', subject: 'unsubscribe me' });
	var none = await engine(mail([])).read(account, 'x', target, message);
	Assert.equal(none.unsubscribe, null);
	for (var unsafe of ['<http://example.test/u>', '<javascript:alert(1)>', '<https://user:pw@example.test/u>', '<ftp://example.test/u>']) {
		var r = await engine(mail(['List-Unsubscribe: ' + unsafe])).read(account, 'x', target, message);
		Assert.equal(r.unsubscribe, null, unsafe + ' is not offered');
	}
	var onlyMail = await engine(mail(['List-Unsubscribe: <mailto:stop@example.test>, <http://insecure.test/u>'])).read(
		account,
		'x',
		target,
		message
	);
	Assert.deepEqual(
		onlyMail.unsubscribe,
		{ url: '', mail: 'stop@example.test', subject: '' },
		'the unsafe link is dropped, the mailto kept'
	);
});
test('a calendar invitation is read from the attachment', async () => {
	var r = await engine(mail()).read(account, 'x', target, message);
	Assert.equal(r.invite.summary, 'Planning');
	Assert.equal(r.invite.location, 'Room 1');
	Assert.deepEqual(r.invite.start, { iso: '2026-10-10T08:00:00Z', allDay: false });
	Assert.equal((await engine(mail([], false)).read(account, 'x', target, message)).invite, null);
});
test('the original is returned byte for byte, and refused when the mailbox changed', async () => {
	var source = mail(['X-Test: ñ']);
	Assert.equal((await engine(source).raw(account, 'x', target, message)).toString(), source);
	await Assert.rejects(engine(source).raw(account, 'x', target, { ...message, uidValidity: '8' }), /mailbox changed/);
});
test('live source gives a safe file name and refuses local messages', async (t) => {
	var dir = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'totalmail-source-'));
	t.after(() => Fs.rmSync(dir, { recursive: true, force: true }));
	var acc = {
		id: 'a',
		name: 'Me',
		email: 'me@example.test',
		configured: true,
		authType: 'password',
		secret: {},
		imap: { host: 'imap.example.test' },
		smtp: { host: 'smtp.example.test' }
	};
	var remote = {
		id: 'imap-' + 'c'.repeat(64),
		accountId: 'a',
		remote: true,
		subject: 'Re: ../../etc/passwd: "x"|y',
		mailboxPath: 'INBOX',
		uidValidity: '7',
		uid: 1
	};
	var store = Db.store(dir, { accounts: [acc], messages: [remote, { id: 'sent-1', accountId: 'a', remote: false }], drafts: [] });
	var live = Live.create({ resolve: async () => target, decrypt: () => 'x', imap: { raw: async () => Buffer.from('RAW') } });
	var file = await live.source({ id: 'b'.repeat(32) }, store, remote.id);
	Assert.equal(file.content.toString(), 'RAW');
	Assert.match(file.name, /^[^\\/:*?"<>|%\x00-\x1f]+\.eml$/);
	Assert.ok(file.name.length <= 84);
	Assert.throws(() => live.source({ id: 'b'.repeat(32) }, store, 'sent-1'), /not found/);
});
