require('total5');
const { test } = require('node:test');
const Assert = require('node:assert/strict');
const Fs = require('node:fs'),
	Os = require('node:os'),
	Path = require('node:path');
const Sessions = require('../lib/sessions'),
	Db = require('./db');
function folder(t) {
	var dir = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'totalmail-sessions-'));
	t.after(() => Fs.rmSync(dir, { recursive: true, force: true }));
	return dir;
}
var open = (dir, now) => Sessions.open({ table: Db.table(dir), now });
test('a session survives a restart, and the table holds hashes only', async (t) => {
	var dir = folder(t),
		a = await open(dir);
	a.set('hash-1', { userId: 'u1', expires: Date.now() + 60000 });
	await a.flush();
	var b = await open(dir);
	Assert.equal(b.get('hash-1').userId, 'u1');
	Assert.doesNotMatch(Db.raw(dir, 'sessions_sessions'), /token|password/i);
});
test('expired sessions are not loaded and sweeping forgets them', async (t) => {
	var dir = folder(t),
		clock = 1000,
		a = await open(dir, () => clock);
	a.set('old', { userId: 'u1', expires: 1500 });
	a.set('new', { userId: 'u2', expires: 9000 });
	await a.flush();
	clock = 2000;
	Assert.equal((await open(dir, () => clock)).get('old'), undefined, 'not loaded after the restart');
	a.sweep();
	Assert.equal(a.get('old'), undefined);
	Assert.ok(a.get('new'));
});
test('revoking a person and signing out are written too', async (t) => {
	var dir = folder(t),
		a = await open(dir);
	a.set('h1', { userId: 'u1', expires: Date.now() + 60000 });
	a.set('h2', { userId: 'u1', expires: Date.now() + 60000 });
	a.set('h3', { userId: 'u2', expires: Date.now() + 60000 });
	await a.flush();
	a.revoke('u1');
	a.delete('h3');
	await a.flush();
	Assert.equal((await open(dir)).size(), 0);
	Assert.ok(!/u1|u2/.test(Db.raw(dir, 'sessions_sessions')), 'nothing about them is left in the file');
});
test('nothing signed in is the same as no database, and the sessions of an earlier version are imported once', async (t) => {
	var dir = folder(t),
		file = Path.join(dir, 'sessions.json');
	Assert.equal((await open(dir)).size(), 0);
	var other = folder(t),
		legacy = Path.join(other, 'sessions.json');
	Fs.writeFileSync(
		legacy,
		JSON.stringify({ x: { userId: 5, expires: Date.now() + 1000 }, y: null, z: { userId: 'u', expires: Date.now() + 1000 } })
	);
	var s = await Sessions.open({ table: Db.table(other), legacy: { file: legacy } });
	Assert.equal(s.size(), 1);
	Assert.ok(s.get('z'));
	Assert.ok(Fs.existsSync(legacy + '.migrated') && !Fs.existsSync(legacy));
});
