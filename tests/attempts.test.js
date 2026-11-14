require('total5');
var { test } = require('node:test');
var assert = require('node:assert/strict');
var Security = require('../plugins/users/security');
var at = (address) => ({ headers: {}, req: { socket: { remoteAddress: address } } });
var here = at('198.51.100.1');
test('a signed-in person gets 15 password tries per purpose, and a success starts the count again', () => {
	for (let i = 0; i < 15; i++)
		assert.equal(Security.allowAttempt(here, 't-1'), true);
	assert.equal(Security.allowAttempt(here, 't-1'), false, 'the 16th is refused');
	assert.equal(Security.allowAttempt(here, 't-2'), true, 'another person is not affected');
	Security.attemptSucceeded(here, 't-1');
	assert.equal(Security.allowAttempt(here, 't-1'), true);
});
test('these tries never use the places of the sign-in page of an address', () => {
	let $ = { headers: {}, req: { socket: { remoteAddress: '198.51.100.7' } } };
	for (let i = 0; i < 60; i++)
		Security.allowAttempt(here, 't-3', 1000);
	for (let i = 0; i < 100; i++)
		assert.equal(Security.allowLogin($, 'a' + i + '@example.test'), true, 'sign-in from the same address still has all of its places');
});
test('the address of the sign-in buckets follows trust_proxy_from in config', () => {
	let $ = { headers: { 'x-forwarded-for': '203.0.113.9' }, req: { socket: { remoteAddress: '198.51.100.7' } } };
	let before = CONF.trust_proxy_from;
	try {
		delete CONF.trust_proxy_from;
		assert.equal(Security.address($), '198.51.100.7', 'a public proxy that is not named is the client');
		CONF.trust_proxy_from = '198.51.100.0/24';
		assert.equal(Security.address($), '203.0.113.9', 'once named, the address it appended counts');
	} finally {
		CONF.trust_proxy_from = before;
	}
});
test('a person who failed from one address still has their tries from another', () => {
	var thief = at('203.0.113.66');
	for (let i = 0; i < 15; i++)
		Security.allowAttempt(thief, 't-4');
	assert.equal(Security.allowAttempt(thief, 't-4'), false, 'the address that guessed is stopped');
	assert.equal(Security.allowAttempt(at('198.51.100.20'), 't-4'), true, 'the person, elsewhere, is not locked out');
});
