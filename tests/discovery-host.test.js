require('total5');
const { test } = require('node:test');
const Assert = require('node:assert/strict');
const Discovery = require('../lib/discovery');

test('a mail server name is a plain hostname with a name as its last part', () => {
	Assert.equal(Discovery.host('imap.gmail.com'), 'imap.gmail.com');
	Assert.equal(Discovery.host(' Mail.Example.COM. '), 'mail.example.com');
	Assert.equal(Discovery.host('xn--mnchen-3ya.example.de'), 'xn--mnchen-3ya.example.de');
	Assert.equal(Discovery.host('mx1.3com.net'), 'mx1.3com.net');
});

test('addresses and numeric forms are not server names, however they are written', () => {
	for (let value of [
		'8.8.8.8',
		'::1',
		'2130706433',
		'127.1',
		'0127.0.0.1',
		'0x7f.0.0.1',
		'１２７.0.0.1',
		'1.2.3.4.5',
		'mail.example.123'
	])
		Assert.throws(() => Discovery.host(value), /valid public server hostname/, value);
});

test('a name with a NUL byte, a space or a shell character is refused', () => {
	for (let value of ['a.example\0.trusted.example', 'mail example.com', 'mail.example.com;ls', '$(id).example.com', '-f.example.com'])
		Assert.throws(() => Discovery.host(value), /valid public server hostname/, JSON.stringify(value));
});
