const { test } = require('node:test');
const Assert = require('node:assert/strict');
const Query = require('../plugins/mail/public/query');
const item = {
	sender: 'Lucía Martín',
	email: 'lucia@cliente.es',
	to: 'info@totaljs.es',
	toRecipients: ['info@totaljs.es', 'boss@cliente.es'],
	subject: 'Propuesta del proyecto',
	body: 'Te adjunto la propuesta. Un abrazo',
	date: '2026-10-09T10:00:00Z',
	unread: true,
	starred: false,
	attachmentCount: 1
};
test('words, phrases and operators are told apart', () => {
	var q = Query.parse(
		'propuesta "un abrazo" from:lucia subject:"del proyecto" is:unread has:attachment after:2026-10-01 before:2026-10-10 nonsense:thing'
	);
	Assert.deepEqual(q.words, ['propuesta', 'un abrazo', 'nonsense:thing']);
	Assert.deepEqual(q.fields, [
		{ key: 'from', value: 'lucia' },
		{ key: 'subject', value: 'del proyecto' }
	]);
	Assert.deepEqual([q.is, q.has, q.after, q.before], [['unread'], ['attachment'], '2026-10-01', '2026-10-10']);
	Assert.equal(Query.parse('   ').empty, true);
	Assert.equal(Query.parse('is:maybe after:soon from:').words.length, 3, 'unknown values stay plain words');
});
test('a loaded message matches only when every part does', () => {
	var m = (text) => Query.matches(Query.parse(text), item);
	Assert.ok(m('propuesta abrazo'));
	Assert.ok(!m('propuesta factura'), 'all words are needed');
	Assert.ok(m('from:lucía') || m('from:lucia'));
	Assert.ok(m('from:cliente.es to:boss'), 'to also looks at the recipient list');
	Assert.ok(!m('subject:abrazo'), 'abrazo is in the body, not the subject');
	Assert.ok(m('body:abrazo is:unread has:attachment'));
	Assert.ok(!m('is:read') && !m('is:starred'));
	Assert.ok(m('after:2026-10-09') && !m('after:2026-10-10'), 'after includes the day');
	Assert.ok(m('before:2026-10-10') && !m('before:2026-10-09'), 'before does not');
	Assert.ok(!Query.matches(Query.parse('has:attachment'), { ...item, attachmentCount: 0 }));
});
test('the IMAP search keeps a single word exactly as before and ANDs the rest', () => {
	Assert.deepEqual(Query.toImap(Query.parse('invoice')), {
		or: [{ subject: 'invoice' }, { from: 'invoice' }, { to: 'invoice' }, { body: 'invoice' }]
	});
	var one = Query.toImap(Query.parse('from:ana is:unread has:attachment after:2026-10-01 before:2026-11-01'));
	Assert.deepEqual(one, {
		from: 'ana',
		seen: false,
		header: { 'content-type': 'multipart/mixed' },
		since: new Date('2026-10-01T00:00:00Z'),
		before: new Date('2026-11-01T00:00:00Z')
	});
	var two = Query.toImap(Query.parse('alpha beta'));
	Assert.deepEqual(two.or.length, 4);
	Assert.deepEqual(Object.keys(two).sort(), ['not', 'or'], 'the second word rides in a negated or');
	Assert.deepEqual(two.not.or[0], { not: { or: [{ subject: 'beta' }, { from: 'beta' }, { to: 'beta' }, { body: 'beta' }] } });
	var many = Query.toImap(Query.parse('from:a from:b is:starred'));
	Assert.equal(many.from, 'a');
	Assert.deepEqual(many.not.or.length, 2, 'a repeated operator goes to the negated or');
	Assert.deepEqual(Query.toImap(Query.parse('')), {});
});
test('after: and before: work on a Date as well as on text', () => {
	let q = Query.parse('after:2026-10-01 before:2026-10-10');
	Assert.equal(Query.matches(q, { date: '2026-10-05T10:00:00.000Z' }), true);
	Assert.equal(Query.matches(q, { date: new Date('2026-10-05T10:00:00.000Z') }), true);
	Assert.equal(Query.matches(q, { date: new Date('2026-09-30T10:00:00.000Z') }), false);
	Assert.equal(Query.matches(q, { date: new Date('2026-10-10T00:00:01.000Z') }), false);
});
