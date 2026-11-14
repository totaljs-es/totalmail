require('total5');
var { test } = require('node:test');
var assert = require('node:assert/strict');
var Security = require('../modules/security');
test('a signed-in person gets 15 password tries per purpose, and a success starts the count again', () => {
	for (let i = 0; i < 15; i++)
		assert.equal(Security.allowAttempt('t-1'), true);
	assert.equal(Security.allowAttempt('t-1'), false, 'the 16th is refused');
	assert.equal(Security.allowAttempt('t-2'), true, 'another person is not affected');
	Security.attemptSucceeded('t-1');
	assert.equal(Security.allowAttempt('t-1'), true);
});
test('these tries never use the places of the sign-in page of an address', () => {
	let $ = { headers: {}, req: { socket: { remoteAddress: '198.51.100.7' } } };
	for (let i = 0; i < 60; i++)
		Security.allowAttempt('t-3', 1000);
	for (let i = 0; i < 100; i++)
		assert.equal(Security.allowLogin($, 'a' + i + '@example.test'), true, 'sign-in from the same address still has all of its places');
});
