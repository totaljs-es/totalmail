require('total5');
const { test } = require('node:test');
const Assert = require('node:assert/strict');
const Crypto = require('node:crypto'),
	Fs = require('node:fs'),
	Os = require('node:os'),
	Path = require('node:path');
const Store = require('../lib/identities'),
	Sessions = require('../lib/sessions'),
	Db = require('./db'),
	Totp = require('../lib/totp'),
	Tool = require('../bin/admin');
test('the server tool lists people, resets a password and removes two-step verification, and ends the open sessions', async (t) => {
	var dir = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'totalmail-admin-'));
	t.after(() => Fs.rmSync(dir, { recursive: true, force: true }));
	var open = () => Store.open({ directory: dir, table: Db.table(dir) });
	var store = await open();
	var ana = await store.createUser({ name: 'Ana', email: 'ana@example.test', password: 'the-old-password-123' }, true);
	var secret = Totp.secret();
	await store.enableTotp(ana.id, secret, Totp.code(secret));
	var sessions = await Sessions.open({ table: Db.table(dir) });
	sessions.set('x', { userId: ana.id, expires: Date.now() + 1e6 });
	await sessions.flush();
	var lines = [],
		out = (l) => lines.push(l);
	await Tool.main(['list', '--database', dir], out);
	Assert.deepEqual(lines, ['ana@example.test  admin  two-step']);
	process.env.TOTALMAIL_NEW_PASSWORD = 'a-brand-new-password-9';
	t.after(() => delete process.env.TOTALMAIL_NEW_PASSWORD);
	await Tool.main(['reset-password', 'ANA@example.test', '--database', dir], out);
	var fresh = await open();
	Assert.ok(await fresh.login('ana@example.test', 'a-brand-new-password-9'), 'the new password works');
	Assert.equal(await fresh.login('ana@example.test', 'the-old-password-123'), null, 'the old one does not');
	Assert.equal(fresh.get(ana.id).totp, true, 'a password reset keeps two-step verification');
	Assert.equal((await Sessions.open({ table: Db.table(dir) })).size(), 0, 'open sessions end');
	await Tool.main(['remove-two-step', 'ana@example.test', '--database', dir], out);
	Assert.equal((await open()).get(ana.id).totp, false);
	await Assert.rejects(Tool.main(['reset-password', 'nobody@example.test', '--database', dir], out), /No user with that email/);
	await Assert.rejects(Tool.main(['launch-rockets', '--database', dir], out), /Commands:/);
	await Assert.rejects(Tool.main(['list', '--database', Path.join(dir, 'missing')], out), /No users found/);
	process.env.TOTALMAIL_NEW_PASSWORD = 'short';
	await Assert.rejects(Tool.main(['reset-password', 'ana@example.test', '--database', dir], out), /12 to 128/);
});
