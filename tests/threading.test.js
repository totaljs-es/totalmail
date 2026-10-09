const { test } = require('node:test');
const Assert = require('node:assert/strict');
const Threading = require('../lib/threading');
test('invalid and injected parent IDs never become outgoing headers', () => {
	for (let id of ['bad', '<a@b>\r\nBcc: victim@example.test', '<a b@c>', '<a@b> <c@d>'])
		Assert.deepEqual(Threading.headers({ messageId: id }), {});
	Assert.deepEqual(Threading.headers({ messageId: '<parent@example.test>', inReplyTo: '<root@example.test>' }), {
		'In-Reply-To': '<parent@example.test>',
		References: '<root@example.test> <parent@example.test>'
	});
});
test('long reference chains retain root and parent within SMTP line limits', () => {
	let ids = Array.from({ length: 20 }, (_, i) => '<' + String(i).padEnd(200, 'x') + '@example.test>');
	let headers = Threading.headers({ messageId: ids.at(-1), references: ids });
	Assert.ok(headers.References.length <= 900);
	Assert.ok(headers.References.startsWith(ids[0]));
	Assert.ok(headers.References.endsWith(ids.at(-1)));
});
