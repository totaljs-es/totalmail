require('total5');
const { test } = require('node:test');
const Assert = require('node:assert/strict');
const Crypto = require('node:crypto'),
	Fs = require('node:fs'),
	Os = require('node:os'),
	Path = require('node:path');
const Db = require('./db');
const password = 'first-administrator-pass-1';
function fixture(t) {
	var dir = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'totalmail-identities-'));
	t.after(() => Fs.rmSync(dir, { recursive: true, force: true }));
	return { dir, make: () => Db.identities(dir) };
}
test('the last active administrator can never be demoted, disabled or removed', async (t) => {
	var f = fixture(t),
		store = await f.make();
	var admin = await store.createUser({ name: 'Admin', email: 'admin@example.test', password }, true);
	var member = await store.createUser({ name: 'Member', email: 'member@example.test', password }, false);
	await Assert.rejects(store.setRole(admin.id, 'member'), /at least one active administrator/);
	await Assert.rejects(store.setDisabled(admin.id, true), /at least one active administrator/);
	await Assert.rejects(store.remove(admin.id), /at least one active administrator/);
	await store.setRole(member.id, 'admin');
	await store.setRole(admin.id, 'member');
	await Assert.rejects(store.setDisabled(member.id, true), /at least one active administrator/);
	await store.setDisabled(admin.id, true);
	Assert.equal(store.list().find((u) => u.id === admin.id).disabled, true);
	await store.setDisabled(admin.id, false);
	await Assert.rejects(store.setRole(member.id, 'owner'), /Invalid role/);
	await Assert.rejects(store.setRole('0'.repeat(32), 'member'), /not found/);
});
test('a disabled person has no identity and cannot sign in; enabling restores both', async (t) => {
	var f = fixture(t),
		store = await f.make();
	await store.createUser({ name: 'Admin', email: 'admin@example.test', password }, true);
	var member = await store.createUser({ name: 'Member', email: 'member@example.test', password }, false);
	Assert.ok(store.get(member.id));
	Assert.ok(await store.login('member@example.test', password));
	await store.setDisabled(member.id, true);
	Assert.equal(store.get(member.id), null);
	Assert.equal(await store.login('member@example.test', password), null);
	Assert.equal(await store.verify(member.id, password), false);
	await store.setDisabled(member.id, false);
	Assert.ok(store.get(member.id));
	Assert.ok(await store.login('member@example.test', password));
	Assert.equal((await f.make()).list().length, 2, 'changes survive a restart');
});
test('resetting a password replaces the salt and hash, validates length and never stores the text', async (t) => {
	var f = fixture(t),
		store = await f.make();
	var admin = await store.createUser({ name: 'Admin', email: 'admin@example.test', password }, true);
	var before = Db.rows(f.dir, 'users_users')[0];
	await Assert.rejects(store.setPassword(admin.id, 'short'), /12 to 128/);
	await Assert.rejects(store.setPassword(admin.id, 'x'.repeat(129)), /12 to 128/);
	await Assert.rejects(store.setPassword('0'.repeat(32), 'a-long-enough-password'), /not found/);
	await store.setPassword(admin.id, 'a-brand-new-password-2');
	var disk = Db.raw(f.dir, 'users_users'),
		after = Db.rows(f.dir, 'users_users')[0];
	Assert.notEqual(after.salt, before.salt);
	Assert.notEqual(after.password, before.password);
	Assert.ok(!disk.includes('a-brand-new-password-2'));
	Assert.equal(await store.login('admin@example.test', password), null);
	Assert.ok(await store.login('admin@example.test', 'a-brand-new-password-2'));
	Assert.equal(await store.verify(admin.id, 'a-brand-new-password-2'), true);
	Assert.equal(await store.verify(admin.id, 'wrong'), false);
	Assert.equal(await store.verify(admin.id, ''), false);
});
