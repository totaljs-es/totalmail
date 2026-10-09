const { test } = require('node:test');
const Assert = require('node:assert/strict');
const Ics = require('../lib/ics');
const wrap = (event, method = 'REQUEST') =>
	['BEGIN:VCALENDAR', 'VERSION:2.0', 'METHOD:' + method, 'BEGIN:VEVENT', ...event, 'END:VEVENT', 'END:VCALENDAR', ''].join('\r\n');
test('an invitation gives what, when, where and who', () => {
	var e = Ics.parse(
		wrap([
			'SUMMARY:Reunión\\, importante',
			'DTSTART;TZID=Europe/Madrid:20261010T100000',
			'DTEND;TZID=Europe/Madrid:20261010T110000',
			'LOCATION:Sala 2\\nPlanta 1',
			'ORGANIZER;CN="Lucía Martín":mailto:lucia@cliente.es',
			'DESCRIPTION:Orden del día; punto uno'
		])
	);
	Assert.equal(e.summary, 'Reunión, importante');
	Assert.deepEqual(e.start, { iso: '2026-10-10T10:00:00', allDay: false, tz: 'Europe/Madrid' });
	Assert.deepEqual(e.end, { iso: '2026-10-10T11:00:00', allDay: false, tz: 'Europe/Madrid' });
	Assert.equal(e.location, 'Sala 2\nPlanta 1');
	Assert.equal(e.organizer, 'Lucía Martín');
	Assert.equal(e.description, 'Orden del día; punto uno');
	Assert.equal(e.method, 'REQUEST');
	Assert.equal(e.cancelled, false);
});
test('UTC times, all-day events, folded lines and cancellations', () => {
	var utc = Ics.parse(wrap(['SUMMARY:A very long title that the producer folded', ' onto a second line', 'DTSTART:20261010T080000Z']));
	Assert.equal(utc.summary, 'A very long title that the producer foldedonto a second line');
	Assert.deepEqual(utc.start, { iso: '2026-10-10T08:00:00Z', allDay: false });
	Assert.deepEqual(Ics.parse(wrap(['SUMMARY:Holiday', 'DTSTART;VALUE=DATE:20261224'])).start, { iso: '2026-12-24', allDay: true });
	Assert.equal(Ics.parse(wrap(['SUMMARY:Gone', 'DTSTART:20261010T080000Z'], 'CANCEL')).cancelled, true);
	Assert.equal(Ics.parse(wrap(['SUMMARY:Gone', 'STATUS:CANCELLED', 'DTSTART:20261010T080000Z'])).cancelled, true);
	Assert.equal(
		Ics.parse(wrap(['SUMMARY:X', 'DTSTART:20261010T080000Z', 'ORGANIZER:mailto:boss@example.test?subject=x'])).organizer,
		'boss@example.test'
	);
});
test('anything that is not a usable event gives nothing, and values are bounded', () => {
	Assert.equal(Ics.parse(''), null);
	Assert.equal(Ics.parse('BEGIN:VCALENDAR\r\nEND:VCALENDAR'), null);
	Assert.equal(Ics.parse(wrap(['SUMMARY:No start'])), null);
	Assert.equal(Ics.parse(wrap(['SUMMARY:Bad date', 'DTSTART:tomorrow'])).start, null);
	var big = Ics.parse(wrap(['SUMMARY:' + 'x'.repeat(5000), 'DTSTART:20261010T080000Z', 'DESCRIPTION:' + 'y'.repeat(5000)]));
	Assert.equal(big.summary.length, 200);
	Assert.equal(big.description.length, 600);
	Assert.equal(
		Ics.parse(wrap(['SUMMARY:First', 'DTSTART:20261010T080000Z']) + wrap(['SUMMARY:Second', 'DTSTART:20271010T080000Z'])).summary,
		'First',
		'only the first event'
	);
	Assert.ok(!/[\x00-\x08]/.test(Ics.parse(wrap(['SUMMARY:a\x01b', 'DTSTART:20261010T080000Z'])).summary));
});
