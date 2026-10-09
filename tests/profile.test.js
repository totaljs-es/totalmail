const { test } = require('node:test');
const Assert = require('node:assert/strict');
const Fs = require('node:fs');
const Path = require('node:path');
const Os = require('node:os');
require('total5');
const Db = require('./db');
const Appearance = require('../modules/appearance');
async function fixture(t, flag) {
	var directory = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'totalmail-profile-'));
	t.after(() => Fs.rmSync(directory, { recursive: true, force: true }));
	return { store: await Db.identities(directory, flag), directory };
}
const initial = { name: 'Admin', email: 'admin@example.test', password: 'fixture-old-password-26' };
const preferences = { name: 'Updated Admin', email: initial.email, color: '#225544', language: 'sk' };
test('profile preferences persist without changing identity, role or mail encryption key', async (t) => {
	var { store, directory } = await fixture(t);
	var user = await store.createUser(initial, true);
	var secret = store.encrypt('fixture-mail-secret');
	var result = await store.updateProfile(user.id, { ...preferences, id: 'different', role: 'member' });
	Assert.equal(result.user.id, user.id);
	Assert.equal(result.user.role, 'admin');
	Assert.equal(result.credentialsChanged, false);
	var restarted = await Db.identities(directory);
	Assert.equal(restarted.get(user.id).color, preferences.color.toUpperCase());
	Assert.equal(restarted.get(user.id).language, 'sk');
	Assert.equal(restarted.decrypt(secret), 'fixture-mail-secret');
	Assert.ok(await restarted.login(initial.email, initial.password));
});
test('login changes verify the old password and never expose or store plaintext passwords', async (t) => {
	var { store, directory } = await fixture(t);
	var user = await store.createUser(initial, true);
	var model = { ...preferences, email: 'updated@example.test', newPassword: 'fixture-new-password-26' };
	await Assert.rejects(store.updateProfile(user.id, model), /current password/);
	await Assert.rejects(store.updateProfile(user.id, { ...model, currentPassword: 'wrong' }), /incorrect/);
	var result = await store.updateProfile(user.id, { ...model, currentPassword: initial.password });
	Assert.equal(result.credentialsChanged, true);
	Assert.equal(await store.login(initial.email, initial.password), null);
	Assert.equal(await store.login(model.email, initial.password), null);
	Assert.equal((await store.login(model.email.toUpperCase(), model.newPassword)).id, user.id);
	Assert.ok(!('password' in result.user));
	var raw = Db.raw(directory, 'users_users');
	Assert.ok(!raw.includes(initial.password));
	Assert.ok(!raw.includes(model.newPassword));
});
test('duplicate email and concurrent stale credentials reject without partial changes', async (t) => {
	var { store } = await fixture(t);
	var user = await store.createUser(initial, true);
	await store.createUser({ ...initial, email: 'member@example.test' }, false);
	await Assert.rejects(
		store.updateProfile(user.id, { ...preferences, email: 'member@example.test', currentPassword: initial.password }),
		/already exists/
	);
	Assert.equal(store.get(user.id).name, initial.name);
	var first = store.updateProfile(user.id, { ...preferences, newPassword: 'fixture-new-password-26', currentPassword: initial.password });
	var second = store.updateProfile(user.id, { ...preferences, email: 'stale@example.test', currentPassword: initial.password });
	await first;
	await Assert.rejects(second, /incorrect/);
	Assert.equal(store.get(user.id).email, initial.email);
});
test('failed profile write leaves the committed user unchanged and future saves still work', async (t) => {
	var flag = { blocked: false },
		{ store } = await fixture(t, flag);
	var user = await store.createUser(initial, true);
	flag.blocked = true;
	await Assert.rejects(store.updateProfile(user.id, preferences));
	Assert.equal(store.get(user.id).name, initial.name);
	flag.blocked = false;
	await store.updateProfile(user.id, preferences);
	Assert.equal(store.get(user.id).name, preferences.name);
});
test('personal accent colors reject CSS injection and keep text readable on light and dark colors', () => {
	Assert.deepEqual(Appearance.resolve('#ffffff'), { color: '#FFFFFF', foreground: '#000000' });
	Assert.deepEqual(Appearance.resolve('#000000'), { color: '#000000', foreground: '#FFFFFF' });
	Assert.deepEqual(Appearance.resolve('#225544'), { color: '#225544', foreground: '#FFFFFF' });
	Assert.equal(Appearance.resolve('red; } </style>').color, '#4285F4');
});
