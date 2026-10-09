const { test } = require('node:test');
const Assert = require('node:assert/strict');
const threads = require('../plugins/mail/public/threads');
const msg = (id, extra = {}) => ({
	id,
	accountId: 'a',
	date: '2026-10-0' + id.replace(/\D/g, '') + 'T10:00:00.000Z',
	messageId: '<' + id + '@x.test>',
	inReplyTo: '',
	references: [],
	...extra
});
const ids = (list) => list.map((m) => m.id);

test('replies join their parent by In-Reply-To and References, oldest first', () => {
	var all = [
		msg('3', { inReplyTo: '<2@x.test>', references: ['<1@x.test>', '<2@x.test>'] }),
		msg('1'),
		msg('2', { inReplyTo: '<1@x.test>', references: ['<1@x.test>'] }),
		msg('9')
	];
	var t = threads(all);
	Assert.deepEqual(ids(t.members('2')), ['1', '2', '3']);
	Assert.equal(t.key('1'), t.key('3'));
	Assert.notEqual(t.key('1'), t.key('9'));
	Assert.deepEqual(ids(t.members('9')), ['9']);
});
test('a reply links to an ancestor that is not cached, and two replies to it share one conversation', () => {
	var t = threads([
		msg('4', { inReplyTo: '<gone@x.test>', references: ['<gone@x.test>'] }),
		msg('5', { inReplyTo: '<gone@x.test>', references: ['<gone@x.test>'] })
	]);
	Assert.deepEqual(ids(t.members('4')), ['4', '5']);
});
test('a chain joined later by a bridging message becomes one conversation', () => {
	var t = threads([msg('1'), msg('2'), msg('3', { references: ['<1@x.test>', '<2@x.test>'] })]);
	Assert.deepEqual(ids(t.members('1')), ['1', '2', '3']);
});
test('the same identifier in two accounts never merges them', () => {
	var t = threads([
		msg('1', { accountId: 'a' }),
		msg('2', { accountId: 'b', messageId: '<1@x.test>' }),
		msg('3', { accountId: 'b', inReplyTo: '<1@x.test>' })
	]);
	Assert.deepEqual(ids(t.members('1')), ['1']);
	Assert.deepEqual(ids(t.members('3')), ['2', '3']);
});
test('messages without identifiers stay alone and unknown ids give an empty conversation', () => {
	var t = threads([msg('1', { messageId: '' }), msg('2', { messageId: '' })]);
	Assert.deepEqual(ids(t.members('1')), ['1']);
	Assert.deepEqual(t.members('nope'), []);
	Assert.deepEqual(threads([]).members('x'), []);
});
test('a large mailbox groups quickly', () => {
	var all = Array.from({ length: 5000 }, (_, i) =>
		msg(String(i), {
			date: '2026-10-01T10:00:' + String(i % 60).padStart(2, '0') + 'Z',
			messageId: '<m' + i + '@x.test>',
			inReplyTo: i % 5 ? '<m' + (i - 1) + '@x.test>' : ''
		})
	);
	var started = Date.now(),
		t = threads(all);
	Assert.equal(t.members('4').length, 5);
	Assert.ok(Date.now() - started < 1000);
});
test("dates that jComponent has already turned into Date objects sort the same as the text of the server's files", () => {
	let asdate = (m) => ({ ...m, date: new Date(m.date) });
	let list = [msg('3'), msg('1', { messageId: '<x>' }), msg('2', { inReplyTo: '<x>', messageId: '<y>' })];
	list[0].inReplyTo = '<y>';
	let text = threads(list),
		objects = threads(list.map(asdate));
	Assert.deepEqual(ids(objects.members('3')), ids(text.members('3')));
	Assert.deepEqual(ids(objects.members('3')), ['1', '2', '3']);
});
