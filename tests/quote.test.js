const { test } = require('node:test');
const Assert = require('node:assert/strict');
const Quote = require('../plugins/mail/public/quote');
const Format = require('../plugins/mail/public/format');
const text = {
	wrote: (date, who) => 'On ' + date + ', ' + who + ' wrote:',
	forwarded: 'Forwarded message',
	from: 'From',
	date: 'Date',
	subject: 'Subject',
	to: 'To',
	format: (d) => String(d).slice(0, 10)
};
const message = {
	sender: 'Lucía Martín',
	email: 'lucia@cliente.es',
	date: '2026-10-09T10:00:00Z',
	subject: 'Re: Propuesta',
	body: 'Hola,\n\nTe adjunto la propuesta.\n\n\n\nUn abrazo',
	toRecipients: ['me@example.test', 'b@example.test']
};
test('a reply quotes the original under its attribution, before the signature', () => {
	var r = Quote('reply', message, '\n\n-- \nGera', text);
	Assert.equal(r.subject, 'Re: Propuesta', 'Re: is not repeated');
	Assert.equal(
		r.body,
		'\n\nOn 2026-10-09, Lucía Martín <lucia@cliente.es> wrote:\n> Hola,\n>\n> Te adjunto la propuesta.\n>\n> Un abrazo\n\n-- \nGera'
	);
});
test('the quote turns into a quotation and the signature stays last and unformatted when sent', () => {
	var r = Format.render(Quote('reply', message, '\n\n-- \nGera *G*', text).body.replace(/^\n\n/, 'Gracias **mil**\n\n'));
	Assert.match(r.html, /<strong>mil<\/strong>/);
	Assert.match(r.html, /<blockquote[^>]*>Hola,<br>\s*<br>Te adjunto|<blockquote[^>]*>Hola,<br>/);
	Assert.match(r.html, /Gera \*G\*/, 'the signature is not formatted');
	Assert.match(r.plain, /^Gracias mil\n\nOn 2026-10-09/);
});
test('a forward starts with the original headers and the quoted body, and Fwd: is not stacked', () => {
	var r = Quote('forward', { ...message, subject: 'Fwd: FW: Propuesta' }, '', text);
	Assert.equal(r.subject, 'Fwd: Propuesta');
	Assert.match(
		r.body,
		/^\n\n---------- Forwarded message ----------\nFrom: Lucía Martín <lucia@cliente.es>\nDate: 2026-10-09\nSubject: Fwd: FW: Propuesta\nTo: me@example.test, b@example.test\n\n> Hola,/
	);
});
test('very long or odd originals are cut, and nothing breaks without a sender or a body', () => {
	var long = Quote('reply', { ...message, body: Array.from({ length: 500 }, (_, i) => 'line ' + i).join('\n') }, '', text).body;
	Assert.equal(long.split('\n').filter((l) => l.startsWith('> ')).length, 201);
	Assert.match(long, /> …$/);
	var bare = Quote('reply', { subject: '', body: undefined, date: '' }, '', text);
	Assert.equal(bare.subject, 'Re: ');
	Assert.doesNotThrow(() => Quote('forward', { body: null }, null, text));
	Assert.equal(
		Quote('reply', { ...message, sender: 'A\r\nBcc: x@y.z' }, '', text).body.includes('\r'),
		false,
		'no line break can come from a name'
	);
});
