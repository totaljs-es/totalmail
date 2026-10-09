require('total5');
const { test } = require('node:test');
const Assert = require('node:assert/strict');
const Crypto = require('node:crypto'),
	Fs = require('node:fs'),
	Os = require('node:os'),
	Path = require('node:path');
const Db = require('./db'),
	Totp = require('../lib/totp'),
	Pending = require('../lib/pending');
async function fixture(t) {
	var dir = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'totalmail-2fa-'));
	t.after(() => Fs.rmSync(dir, { recursive: true, force: true }));
	var make = () => Db.identities(dir),
		store = await make();
	var user = await store.createUser({ name: 'Ana', email: 'ana@example.test', password: 'a-long-enough-password' }, true);
	return { dir, store, user, make };
}
test('turning two-step verification on needs a right code, keeps the secret encrypted and hands out recovery codes once', async (t) => {
	var f = await fixture(t),
		secret = Totp.secret(),
		now = 1700000000000;
	Assert.equal(f.user.totp, false);
	await Assert.rejects(f.store.enableTotp(f.user.id, secret, '000000', now), /code is not right/);
	var result = await f.store.enableTotp(f.user.id, secret, Totp.code(secret, now), now);
	Assert.equal(result.user.totp, true);
	Assert.equal(result.recovery.length, 8);
	var file = Db.raw(f.dir, 'users_users');
	Assert.ok(!file.includes(secret), 'the secret is not written in the clear');
	for (var code of result.recovery)
		Assert.ok(!file.includes(code), 'neither are the recovery codes');
	Assert.equal(f.store.totpRecovery(f.user.id), 8);
	await Assert.rejects(f.store.enableTotp(f.user.id, secret, Totp.code(secret, now + 30000), now + 30000), /already on/);
	Assert.equal((await f.make()).get(f.user.id).totp, true, 'survives a restart');
});
test('the second step accepts a code once, a recovery code once, and nothing else', async (t) => {
	var f = await fixture(t),
		secret = Totp.secret(),
		now = 1700000000000;
	var { recovery } = await f.store.enableTotp(f.user.id, secret, Totp.code(secret, now), now);
	var next = now + 60000;
	Assert.deepEqual(await f.store.checkSecond(f.user.id, Totp.code(secret, next), next), { ok: true, via: 'totp' });
	Assert.deepEqual(await f.store.checkSecond(f.user.id, Totp.code(secret, next), next), { ok: false }, 'the same code twice is refused');
	Assert.deepEqual(await f.store.checkSecond(f.user.id, Totp.code(secret, now), next), { ok: false }, 'and an older one');
	Assert.deepEqual(await f.store.checkSecond(f.user.id, recovery[0].toUpperCase(), next), { ok: true, via: 'recovery', left: 7 });
	Assert.deepEqual(await f.store.checkSecond(f.user.id, recovery[0], next), { ok: false }, 'a recovery code is spent');
	for (var wrong of ['', 'nonsense', '123456', 'abcde-fghij', 'abcdefghij'])
		Assert.equal((await f.store.checkSecond(f.user.id, wrong, next)).ok, false, wrong);
	Assert.equal(f.store.totpRecovery(f.user.id), 7);
	var other = await f.store.createUser({ name: 'Ben', email: 'ben@example.test', password: 'another-long-password' }, false);
	Assert.deepEqual(
		await f.store.checkSecond(other.id, Totp.code(secret, next + 30000), next + 30000),
		{ ok: false },
		'a user without two-step verification has no second step'
	);
	Assert.deepEqual(await f.store.checkSecond('missing', '123456'), { ok: false });
});
test('new recovery codes replace the old ones, and turning it off forgets everything', async (t) => {
	var f = await fixture(t),
		secret = Totp.secret(),
		now = 1700000000000;
	var first = (await f.store.enableTotp(f.user.id, secret, Totp.code(secret, now), now)).recovery;
	var fresh = await f.store.newRecovery(f.user.id);
	Assert.equal(fresh.length, 8);
	Assert.equal((await f.store.checkSecond(f.user.id, first[0], now + 60000)).ok, false, 'an old recovery code no longer works');
	Assert.equal((await f.store.checkSecond(f.user.id, fresh[0], now + 60000)).ok, true);
	var off = await f.store.disableTotp(f.user.id);
	Assert.equal(off.totp, false);
	Assert.equal(f.store.totpRecovery(f.user.id), null);
	Assert.ok(!Db.raw(f.dir, 'users_users').includes('"totp"'));
	await Assert.rejects(f.store.newRecovery(f.user.id), /not on/);
});
test('a pending sign-in allows five tries, expires, and is spent when done', () => {
	var clock = { t: 1000 },
		pending = Pending.create(() => clock.t);
	var token = pending.login('u1');
	for (var i = 0; i < 5; i++)
		Assert.deepEqual(pending.attempt(token), { userId: 'u1' });
	Assert.equal(pending.attempt(token), null, 'the sixth try finds nothing');
	var second = pending.login('u2');
	Assert.deepEqual(pending.attempt(second), { userId: 'u2' });
	pending.done(second);
	Assert.equal(pending.attempt(second), null);
	var third = pending.login('u3');
	clock.t += 5 * 60000 + 1;
	Assert.equal(pending.attempt(third), null, 'five minutes is all a sign-in waits');
	Assert.equal(pending.attempt('forged'), null);
	Assert.equal(pending.attempt(undefined), null);
});
test('a setup that was not confirmed belongs to its person and lapses', () => {
	var clock = { t: 1000 },
		pending = Pending.create(() => clock.t);
	pending.setup('u1', 'SECRET');
	Assert.equal(pending.takeSetup('u1'), 'SECRET');
	Assert.equal(pending.takeSetup('u2'), '', 'someone else has none');
	pending.finishSetup('u1');
	Assert.equal(pending.takeSetup('u1'), '');
	pending.setup('u1', 'SECRET2');
	clock.t += 15 * 60000 + 1;
	Assert.equal(pending.takeSetup('u1'), '');
});
