var { test } = require('node:test');
var Assert = require('node:assert/strict');
var Display = require('../plugins/mail/public/display');
test('text is escaped for HTML, and nothing becomes the word null', () => {
	Assert.equal(Display.esc('<a href="x">Tom & \'Jerry\'</a>'), '&lt;a href=&quot;x&quot;&gt;Tom &amp; &#39;Jerry&#39;&lt;/a&gt;');
	Assert.equal(Display.esc(null), '');
	Assert.equal(Display.esc(undefined), '');
	Assert.equal(Display.esc(0), '0');
});
test('a size is shown in the unit that reads best', () => {
	Assert.equal(Display.filesize(0), '');
	Assert.equal(Display.filesize(512), '512 B');
	Assert.equal(Display.filesize(2048), '2 KB');
	Assert.equal(Display.filesize(1572864), '1.5 MB');
});
test('an invitation shows its time as written, with the zone when it has no UTC mark', () => {
	var card = Display.invitecard(
		{ summary: 'Review', start: { iso: '2026-11-20T10:00', tz: 'Europe/Madrid' }, end: { iso: '2026-11-20T11:00' }, location: 'Room 2', organizer: 'ana@example.test' },
		'en',
		'No subject'
	);
	Assert.equal(card.title, 'Review');
	Assert.match(card.when, /Friday, November 20, 2026, 10:00 \(Europe\/Madrid\) – 11:00/);
	Assert.equal(card.where, 'Room 2');
	Assert.equal(Display.invitecard({ start: { iso: '2026-11-20', allDay: true } }, 'en', 'No subject').title, 'No subject');
	Assert.doesNotMatch(Display.invitecard({ start: { iso: '2026-11-20', allDay: true }, end: { iso: '2026-11-21' } }, 'en', 'x').when, /–/, 'an all-day event has no end time');
});
test('a pasted image gets a name made of the moment; a file with a real name is left alone', () => {
	var now = new Date(2026, 10, 14, 8, 30, 5);
	var pasted = Display.stamp(new File(['x'], 'image.png', { type: 'image/png' }), now);
	Assert.equal(pasted.name, 'image-20261114-083005.png');
	Assert.equal(Display.stamp(new File(['x'], 'image.jpeg', { type: 'image/jpeg' }), now).name, 'image-20261114-083005.jpg', 'jpeg becomes jpg');
	var named = new File(['x'], 'report.pdf', { type: 'application/pdf' });
	Assert.equal(Display.stamp(named, now), named);
});
