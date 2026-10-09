// Two-step verification codes (TOTP, RFC 6238: HMAC-SHA1, 30 seconds, 6 digits), the one every authenticator app speaks,
// and the recovery codes that stand in for the app. No state here; the identity store keeps what must be kept.
const Crypto = Total.Crypto;
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567',
	period = 30000;
function encode(buffer) {
	var bits = '',
		out = '';
	for (var byte of buffer)
		bits += byte.toString(2).padStart(8, '0');
	for (var i = 0; i < bits.length; i += 5)
		out += alphabet[parseInt(bits.slice(i, i + 5).padEnd(5, '0'), 2)];
	return out;
}
function decode(text) {
	var bits = '';
	for (var char of String(text)
		.toUpperCase()
		.replace(/[\s=-]/g, '')) {
		var index = alphabet.indexOf(char);
		if (index < 0)
			throw Error('Invalid secret');
		bits += index.toString(2).padStart(5, '0');
	}
	var bytes = [];
	for (var i = 0; i + 8 <= bits.length; i += 8)
		bytes.push(parseInt(bits.slice(i, i + 8), 2));
	return Buffer.from(bytes);
}
function hotp(key, counter) {
	var message = Buffer.alloc(8);
	message.writeBigUInt64BE(BigInt(counter));
	var digest = Crypto.createHmac('sha1', key).update(message).digest(),
		offset = digest[19] & 15;
	var value = ((digest[offset] & 127) << 24) | (digest[offset + 1] << 16) | (digest[offset + 2] << 8) | digest[offset + 3];
	return String(value % 1000000).padStart(6, '0');
}
exports.secret = () => encode(Crypto.randomBytes(20));
exports.encode = encode;
exports.decode = decode;
exports.code = (secret, time = Date.now()) => hotp(decode(secret), Math.floor(time / period));
// The step of the code when it is right and newer than the last accepted one (a code works once), otherwise 0.
// One step either side absorbs a clock that is a little off.
exports.verify = function(secret, code, time = Date.now(), last = 0, window = 1) {
	code = String(code || '').replace(/\s+/g, '');
	if (!/^\d{6}$/.test(code))
		return 0;
	var key = decode(secret),
		now = Math.floor(time / period),
		found = 0;
	for (var step = now - window; step <= now + window; step++) {
		var expected = hotp(key, step);
		// Every step is compared, whatever the answer, so the time taken says nothing.
		if (Crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(code)) && step > last && !found)
			found = step;
	}
	return found;
};
exports.uri = (secret, account, issuer) =>
	'otpauth://totp/' +
	encodeURIComponent(issuer + ':' + account) +
	'?' +
	new URLSearchParams({ secret, issuer, algorithm: 'SHA1', digits: '6', period: '30' }).toString();
// Ten letters and digits in two groups: about 50 bits, long enough to be kept as a plain hash.
const recovery = 'abcdefghjkmnpqrstuvwxyz23456789';
exports.normalizeRecovery = (code) =>
	String(code || '')
		.toLowerCase()
		.replace(/[^a-z0-9]/g, '');
exports.hashRecovery = (code) =>
	Crypto.createHash('sha256')
		.update('recovery:' + exports.normalizeRecovery(code))
		.digest('hex');
exports.recoveryCodes = function(count = 8) {
	return Array.from({ length: count }, () => {
		var raw = Array.from(Crypto.randomBytes(10), (b) => recovery[b % recovery.length]).join('');
		return raw.slice(0, 5) + '-' + raw.slice(5);
	});
};
