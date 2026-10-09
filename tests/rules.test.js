const { test } = require('node:test');
const Assert = require('node:assert/strict');
const Rules = require('../lib/rules');
const mail = {
	sender: 'GitHub',
	email: 'noreply@github.com',
	toRecipients: ['me@mine.test', 'team@mine.test'],
	ccRecipients: ['boss@mine.test'],
	subject: 'Release v5.0.19 is out'
};
const rule = (extra) => ({
	id: 'r',
	name: 'x',
	enabled: true,
	field: 'from',
	op: 'contains',
	value: 'github',
	action: 'archive',
	...extra
});

test('conditions look at the sender, every recipient or the subject, ignoring case and spaces', () => {
	Assert.ok(Rules.matches(rule({ value: ' GitHub ' }), mail));
	Assert.ok(Rules.matches(rule({ field: 'from', op: 'is', value: 'NOREPLY@github.com' }), mail));
	Assert.ok(Rules.matches(rule({ field: 'from', op: 'is', value: 'github' }), mail), 'the sender name counts as a whole too');
	Assert.ok(!Rules.matches(rule({ field: 'from', op: 'is', value: 'git' }), mail), '"is" never matches part of a value');
	Assert.ok(Rules.matches(rule({ field: 'to', value: 'team@' }), mail));
	Assert.ok(Rules.matches(rule({ field: 'to', op: 'is', value: 'boss@mine.test' }), mail), 'Cc recipients count');
	Assert.ok(Rules.matches(rule({ field: 'subject', value: 'RELEASE' }), mail));
	Assert.ok(!Rules.matches(rule({ field: 'subject', value: 'invoice' }), mail));
});
test('an empty text, a missing field or a message without data never match', () => {
	Assert.ok(!Rules.matches(rule({ value: '' }), mail));
	Assert.ok(!Rules.matches(rule({ value: '   ' }), mail));
	Assert.ok(!Rules.matches(rule({ field: 'to' }), { email: 'a@b.test' }));
	Assert.ok(!Rules.matches(rule(), {}));
});
test('the first enabled rule that matches decides', () => {
	var rules = [rule({ id: 'off', enabled: false }), rule({ id: 'first', action: 'read' }), rule({ id: 'second', action: 'trash' })];
	Assert.equal(Rules.firstMatch(rules, mail).id, 'first');
	Assert.equal(Rules.firstMatch(rules, { email: 'x@y.test' }), undefined);
	Assert.equal(Rules.firstMatch(undefined, mail), undefined);
});
test('a stored rule is normalised and moves only go to existing folders other than the inbox', () => {
	var account = { mailboxes: [{ path: 'INBOX' }, { path: 'Clients' }] };
	var ok = Rules.validate(
		{ name: '  News  ', field: 'from', op: 'contains', value: ' news\u0000letter ', action: 'move', path: 'Clients' },
		account
	);
	Assert.deepEqual(ok, {
		id: undefined,
		name: 'News',
		enabled: true,
		field: 'from',
		op: 'contains',
		value: 'news letter',
		action: 'move',
		path: 'Clients'
	});
	Assert.equal(
		Rules.validate({ name: 'a', field: 'from', op: 'is', value: 'x', action: 'archive', path: 'ignored' }, account).path,
		undefined
	);
	for (var bad of [
		{ name: '', field: 'from', op: 'is', value: 'x', action: 'archive' },
		{ name: 'a', field: 'body', op: 'is', value: 'x', action: 'archive' },
		{ name: 'a', field: 'from', op: 'regex', value: 'x', action: 'archive' },
		{ name: 'a', field: 'from', op: 'is', value: 'x', action: 'forward' },
		{ name: 'a', field: 'from', op: 'is', value: '', action: 'archive' },
		{ name: 'a', field: 'from', op: 'is', value: 'x'.repeat(101), action: 'archive' },
		{ name: 'a', field: 'from', op: 'is', value: 'x', action: 'move', path: 'Missing' },
		{ name: 'a', field: 'from', op: 'is', value: 'x', action: 'move', path: 'INBOX' },
		{ name: 'a', field: 'from', op: 'is', value: 'x', action: 'move' }
	])
		Assert.throws(() => Rules.validate(bad, account), bad.action + '/' + bad.field);
});
