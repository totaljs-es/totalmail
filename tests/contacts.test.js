const { test } = require('node:test');
const Assert = require('node:assert/strict');
const contacts = require('../plugins/mail/public/contacts');
const mail = [
	{
		email: 'lucia@cliente.es',
		sender: 'Lucía Martín',
		toRecipients: ['me@mine.test', 'petr@contoso.example'],
		ccRecipients: ['boss@cliente.es'],
		date: '2026-10-08T10:00:00Z'
	},
	{ email: 'lucia@cliente.es', sender: 'lucia@cliente.es', toRecipients: ['me@mine.test'], date: '2026-10-09T10:00:00Z' },
	{ outgoing: true, to: 'petr@contoso.example, ana@example.test', cc: 'boss@cliente.es', date: '2026-10-07T10:00:00Z' },
	{ email: 'noreply@github.com', sender: 'GitHub', toRecipients: ['me@mine.test'], date: '2026-10-09T11:00:00Z' },
	{ email: 'not an address', sender: 'Broken', date: '2026-10-09T12:00:00Z' }
];
test('contacts come from senders, recipients and sent mail, never include yourself and ignore junk', () => {
	var list = contacts(mail, ['ME@mine.test']);
	var emails = list.map((c) => c.email);
	Assert.ok(!emails.includes('me@mine.test'));
	Assert.ok(!emails.includes('not an address'));
	Assert.equal(new Set(emails).size, emails.length, 'one entry per address');
	Assert.equal(list.find((c) => c.email === 'lucia@cliente.es').name, 'Lucía Martín', 'a real name wins over the address used as a name');
	Assert.equal(list.find((c) => c.email === 'ana@example.test').name, '');
	Assert.equal(emails[0], 'petr@contoso.example', 'people you write to rank first');
});
test('matching starts with the beginning of a name or address and needs two characters', () => {
	var list = contacts(mail, ['me@mine.test']);
	Assert.deepEqual(contacts.match(list, 'l'), []);
	Assert.deepEqual(contacts.match(list, ''), []);
	Assert.equal(contacts.match(list, 'luc')[0].email, 'lucia@cliente.es');
	Assert.equal(contacts.match(list, 'MARTÍN')[0].email, 'lucia@cliente.es');
	Assert.equal(contacts.match(list, 'contoso')[0].email, 'petr@contoso.example');
	Assert.equal(contacts.match(list, 'zzzz').length, 0);
	var many = Array.from({ length: 20 }, (_, i) => ({ email: 'person' + i + '@x.test', name: '', count: 1, last: '' }));
	Assert.equal(contacts.match(many, 'person').length, 6);
	Assert.equal(contacts.match(many, 'person', 3).length, 3);
	var ranked = contacts(
		[
			{ email: 'ana@x.test', sender: 'Ana', date: '2026-01-01' },
			{ email: 'banana@x.test', sender: 'Banana Shop', date: '2026-01-02' }
		],
		[]
	);
	Assert.equal(contacts.match(ranked, 'ana')[0].email, 'ana@x.test', 'a prefix beats a match inside the word');
});
test('a large mailbox is processed quickly', () => {
	var big = Array.from({ length: 5000 }, (_, i) => ({
		email: 'p' + (i % 400) + '@x.test',
		sender: 'P' + (i % 400),
		toRecipients: ['q' + (i % 50) + '@x.test'],
		date: '2026-10-01T10:00:' + String(i % 60).padStart(2, '0') + 'Z'
	}));
	var started = Date.now(),
		list = contacts(big, []);
	Assert.equal(list.length, 450);
	Assert.ok(Date.now() - started < 1000);
});
test('the last time someone was written to is a moment, whether the date is text or a Date', () => {
	let text = [
		{ email: 'ana@x.test', sender: 'Ana', date: '2026-10-01T10:00:00.000Z' },
		{ email: 'bea@x.test', sender: 'Bea', date: '2026-10-05T10:00:00.000Z' }
	];
	let objects = text.map((m) => ({ ...m, date: new Date(m.date) }));
	Assert.deepEqual(
		contacts(text).map((c) => c.email),
		['bea@x.test', 'ana@x.test'],
		'the most recent first'
	);
	Assert.deepEqual(
		contacts(objects).map((c) => c.email),
		['bea@x.test', 'ana@x.test']
	);
	Assert.equal(contacts(objects)[0].last, new Date('2026-10-05T10:00:00.000Z').getTime());
});
