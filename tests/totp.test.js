require('total5');
const { test } = require('node:test');
const Assert = require('node:assert/strict');
const Totp = require('../lib/totp');
const RFC = Totp.encode(Buffer.from('12345678901234567890'));
test('the codes match the RFC 6238 test vectors, so any authenticator app agrees', () => {
	Assert.equal(RFC, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
	for (var [seconds, code] of [
		[59, '287082'],
		[1111111109, '081804'],
		[1111111111, '050471'],
		[1234567890, '005924'],
		[2000000000, '279037'],
		[20000000000, '353130']
	])
		Assert.equal(Totp.code(RFC, seconds * 1000), code, 'at ' + seconds + ' s');
});
test('base32 round-trips and refuses what is not base32', () => {
	for (var length of [1, 5, 10, 20, 32]) {
		var raw = require('node:crypto').randomBytes(length);
		Assert.deepEqual(Totp.decode(Totp.encode(raw)), raw);
	}
	Assert.deepEqual(Totp.decode('gezd gnbv-GY3TQOJQ'), Buffer.from('1234567890'), 'spaces, dashes and case are ignored');
	Assert.throws(() => Totp.decode('not*base32'), /Invalid secret/);
	Assert.equal(Totp.secret().length, 32);
	Assert.notEqual(Totp.secret(), Totp.secret());
});
test('a code is accepted within one step either side, only once, and never an older one', () => {
	var now = 1234567890000,
		step = Math.floor(now / 30000),
		good = Totp.code(RFC, now);
	Assert.equal(Totp.verify(RFC, good, now), step);
	Assert.equal(Totp.verify(RFC, Totp.code(RFC, now - 30000), now), step - 1, 'a clock a little behind');
	Assert.equal(Totp.verify(RFC, Totp.code(RFC, now + 30000), now), step + 1, 'a clock a little ahead');
	Assert.equal(Totp.verify(RFC, Totp.code(RFC, now - 90000), now), 0, 'three steps old');
	Assert.equal(Totp.verify(RFC, good, now, step), 0, 'the same code is spent');
	Assert.equal(Totp.verify(RFC, Totp.code(RFC, now - 30000), now, step), 0, 'an older code than the last accepted one');
	Assert.equal(Totp.verify(RFC, Totp.code(RFC, now + 30000), now, step), step + 1, 'the next one is fine');
	for (var bad of ['', '12345', '1234567', 'abcdef', '000000x', null, undefined])
		Assert.equal(Totp.verify(RFC, bad, now), 0, String(bad));
	Assert.equal(Totp.verify(RFC, good.slice(0, 3) + ' ' + good.slice(3), now), step, 'a code typed with a space');
});
test('the setup link has everything an app needs and nothing else', () => {
	var uri = new URL(Totp.uri('ABCDEFGH', 'ana@example.test', 'TotalMail'));
	Assert.equal(uri.protocol, 'otpauth:');
	Assert.equal(uri.host, 'totp');
	Assert.equal(decodeURIComponent(uri.pathname), '/TotalMail:ana@example.test');
	Assert.equal(uri.searchParams.get('secret'), 'ABCDEFGH');
	Assert.deepEqual(
		[uri.searchParams.get('issuer'), uri.searchParams.get('digits'), uri.searchParams.get('period'), uri.searchParams.get('algorithm')],
		['TotalMail', '6', '30', 'SHA1']
	);
});
test('recovery codes are distinct, readable, and match whatever way they are typed', () => {
	var codes = Totp.recoveryCodes(8);
	Assert.equal(new Set(codes).size, 8);
	for (var code of codes)
		Assert.match(code, /^[a-z2-9]{5}-[a-z2-9]{5}$/);
	Assert.equal(Totp.hashRecovery(codes[0]), Totp.hashRecovery(codes[0].toUpperCase().replace('-', ' ')));
	Assert.notEqual(Totp.hashRecovery(codes[0]), Totp.hashRecovery(codes[1]));
	Assert.match(Totp.hashRecovery('abcde-fghij'), /^[0-9a-f]{64}$/);
});
