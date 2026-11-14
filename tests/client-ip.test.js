var { test } = require('node:test');
var Assert = require('node:assert/strict');
var clientip = require('../plugins/users/clientip');
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
test('the header is ignored when the connection does not come from a proxy of ours', () => {
	Assert.equal(clientip({ 'x-forwarded-for': '1.2.3.4' }, '198.51.100.7'), '198.51.100.7');
	Assert.equal(clientip({ 'x-forwarded-for': '203.0.113.9' }, '::ffff:127.0.0.1'), '203.0.113.9');
	Assert.equal(clientip({ 'x-forwarded-for': '203.0.113.9' }, '::1'), '203.0.113.9');
});
test('a proxy with a public address is trusted when the configuration names it', () => {
	var header = { 'x-forwarded-for': '1.2.3.4, 203.0.113.9' };
	Assert.equal(clientip(header, '198.51.100.7'), '198.51.100.7', 'not named: ignored');
	Assert.equal(clientip(header, '198.51.100.7', true, '198.51.100.7'), '203.0.113.9', 'an address');
	Assert.equal(clientip(header, '198.51.100.7', true, '192.0.2.1, 198.51.100.0/24'), '203.0.113.9', 'a range, among others');
	Assert.equal(clientip(header, '::ffff:198.51.100.7', true, '198.51.100.7'), '203.0.113.9', 'an IPv4 address seen as IPv6');
	Assert.equal(clientip(header, '198.51.101.7', true, '198.51.100.0/24'), '198.51.101.7', 'outside the range');
	Assert.equal(clientip(header, '198.51.100.7', false, '198.51.100.7'), '198.51.100.7', 'trust false still ignores the header');
	Assert.equal(clientip(header, '198.51.100.7', true, 'garbage, 1.2.3.4/99, /8'), '198.51.100.7', 'an entry that is not an address names nobody');
});
