const { test } = require('node:test');
const Assert = require('node:assert/strict');
const clientip = require('../lib/clientip');
test('behind a proxy the address it appended counts, not the one the client claimed', () => {
	Assert.equal(clientip({ 'x-forwarded-for': '203.0.113.9' }, '10.0.0.2'), '203.0.113.9');
	Assert.equal(clientip({ 'x-forwarded-for': '1.2.3.4, 203.0.113.9' }, '10.0.0.2'), '203.0.113.9', 'a forged first entry is ignored');
	Assert.equal(clientip({ 'x-forwarded-for': '1.2.3.4,  5.6.7.8 , 203.0.113.9 ' }, '10.0.0.2'), '203.0.113.9');
});
test('without the header the socket address is used, and trust can be switched off', () => {
	Assert.equal(clientip({}, '198.51.100.7'), '198.51.100.7');
	Assert.equal(clientip({ 'x-forwarded-for': '' }, '198.51.100.7'), '198.51.100.7');
	Assert.equal(clientip({ 'x-forwarded-for': '203.0.113.9' }, '198.51.100.7', false), '198.51.100.7');
	Assert.equal(clientip({}, undefined), 'unknown');
});
