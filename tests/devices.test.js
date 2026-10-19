require('total5');
const { test } = require('node:test');
const Assert = require('node:assert/strict');
const Fs = require('node:fs'),
	Os = require('node:os'),
	Path = require('node:path');
const Devices = require('../lib/devices'),
	Db = require('./db');
function folder(t) {
	var dir = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'totalmail-devices-'));
	t.after(() => Fs.rmSync(dir, { recursive: true, force: true }));
	return dir;
}
var open = (dir) => Devices.open({ table: Db.table(dir) });
var mac = { name: "Gera's MacBook Pro", platform: 'macOS 26.1', app: 'TotalMail 1.0', address: '203.0.113.7' };
test('a device token is shown once, stored only as a hash, and can be signed out', async (t) => {
	var dir = folder(t),
		store = await open(dir),
		now = new Date('2026-10-11T10:00:00Z');
	var made = await store.create('u1', mac, now);
	Assert.match(made.token, /^tmd_[0-9a-f]{8}_[A-Za-z0-9_-]{30,}$/);
	Assert.deepEqual(
		[made.record.name, made.record.platform, made.record.app, made.record.address],
		[mac.name, mac.platform, mac.app, mac.address]
	);
	Assert.ok(!JSON.stringify(store.list('u1', now)).includes(made.token), 'the list never shows the token');
	Assert.ok(!Db.raw(dir, 'devices_devices').includes(made.token), 'only a hash is on disk');
	Assert.equal(store.find(made.token, now).userId, 'u1');
	Assert.equal(store.find(made.token + 'x', now), null);
	Assert.equal(store.find(made.token.slice(0, -1) + (made.token.endsWith('A') ? 'B' : 'A'), now), null, 'one wrong character');
	Assert.equal(store.find('tmd_00000000_' + 'a'.repeat(32), now), null);
	Assert.equal(store.find('tm_' + made.token.slice(4), now), null, 'only device tokens');
	Assert.equal((await open(dir)).find(made.token, now).name, mac.name, 'survives a restart');
	await Assert.rejects(store.create('u1', { name: '  ' }, now), /Give the device a name/);
	await store.create('u2', { name: 'iPad' }, now);
	await Assert.rejects(store.revoke(made.record.id, 'u2'), /Device not found/, 'only the owner signs it out');
	await store.revoke(made.record.id, 'u1');
	Assert.equal(store.find(made.token, now), null);
	Assert.deepEqual(store.list('u1', now), []);
	await store.revokeUser('u2');
	Assert.deepEqual(store.list('u2', now), []);
});
test('a name is cleaned, the number of devices is limited and an idle device signs itself out', async (t) => {
	var store = await open(folder(t)),
		now = new Date('2026-10-11T10:00:00Z');
	var odd = await store.create('u1', { name: '  My\nMac\u0000 ' + 'x'.repeat(100), platform: 'a\tb' }, now);
	Assert.equal(odd.record.name.length, Devices.limits.text);
	Assert.ok(!/[\n\u0000]/.test(odd.record.name));
	Assert.equal(odd.record.platform, 'a b');
	for (var i = 1; i < Devices.limits.perUser; i++)
		await store.create('u1', { name: 'd' + i }, now);
	await Assert.rejects(store.create('u1', { name: 'one more' }, now), /too many devices/);
	var later = new Date(now.getTime() + Devices.limits.idle + 86400000);
	Assert.equal(store.find(odd.token, later), null, 'not used for 180 days');
	Assert.deepEqual(store.list('u1', later), []);
	await store.create('u1', { name: 'fresh' }, later);
});
test('use is remembered (when and from where) without writing for every request', async (t) => {
	var dir = folder(t),
		store = await open(dir),
		made = await store.create('u1', mac, new Date('2026-10-11T10:00:00Z'));
	var kept = new Date('2026-10-11T10:00:00Z');
	await store.touch(made.record.id, '198.51.100.2', new Date(kept.getTime() + 5000));
	Assert.equal(store.list('u1', kept)[0].uses, 1);
	Assert.equal(store.list('u1', kept)[0].address, mac.address, 'within a minute: counted, not written');
	var minute = new Date(kept.getTime() + 120000);
	await store.touch(made.record.id, '198.51.100.2', minute);
	var item = store.list('u1', minute)[0];
	Assert.deepEqual([item.address, item.last, item.uses], ['198.51.100.2', minute.toISOString(), 2]);
	Assert.equal((await open(dir)).list('u1', minute)[0].address, '198.51.100.2', 'and it was written');
	// The idle time counts from the last use, not from the creation.
	var almost = new Date(minute.getTime() + Devices.limits.idle - 86400000);
	Assert.equal(store.find(made.token, almost).id, made.record.id);
	Assert.equal(store.find(made.token, new Date(minute.getTime() + Devices.limits.idle + 86400000)), null);
});

for (let operation of ['revoke', 'revokeUser'])
	test(operation + ' stays revoked while an earlier activity write finishes, including after restart', async (t) => {
		var dir = folder(t),
			storage = await require('../lib/mirror').open(Devices.spec(Db.table(dir)), { seed: { devices: [] } }),
			store = Devices.create(storage),
			now = new Date('2026-10-11T10:00:00Z'),
			made = await store.create('u1', mac, now),
			other = await store.create('u2', { name: 'Other user' }, now);
		var enter, release;
		var entered = new Promise((resolve) => (enter = resolve)),
			gate = new Promise((resolve) => (release = resolve)),
			save = storage.mirror.save,
			blocked = true;
		storage.mirror.save = async (next) => {
			if (blocked) {
				blocked = false;
				enter();
				await gate;
			}
			await save(next);
			Assert.equal(store.find(made.token, now), null, 'revocation stays effective even before the stale write returns');
		};
		var activity = store.touch(made.record.id, mac.address, new Date(now.getTime() + 120000));
		await entered;
		var revocation = operation === 'revoke' ? store.revoke(made.record.id, 'u1') : store.revokeUser('u1');
		Assert.equal(store.find(made.token, now), null, 'revocation is immediate');
		release();
		await Promise.all([activity, revocation]);
		Assert.equal(store.find(made.token, now), null, 'the earlier write cannot resurrect the token');
		Assert.deepEqual(store.list('u1', now), []);
		var reopened = await open(dir);
		Assert.equal(reopened.find(made.token, now), null, 'revocation is persisted');
		Assert.equal(reopened.find(other.token, now).userId, 'u2', 'other users keep their devices');
	});

test('a failed revocation write cannot restore access and a later write persists the removal', async (t) => {
	var dir = folder(t),
		storage = await require('../lib/mirror').open(Devices.spec(Db.table(dir)), { seed: { devices: [] } }),
		store = Devices.create(storage),
		now = new Date('2026-10-11T10:00:00Z'),
		made = await store.create('u1', mac, now),
		save = storage.mirror.save;
	storage.mirror.save = async () => {
		throw Error('Disk unavailable');
	};
	await Assert.rejects(store.revoke(made.record.id, 'u1'), /Disk unavailable/);
	Assert.equal(store.find(made.token, now), null, 'failed persistence does not undo immediate revocation');
	storage.mirror.save = save;
	await store.create('u2', { name: 'Other user' }, now);
	Assert.equal((await open(dir)).find(made.token, now), null, 'the next successful write keeps the token revoked');
});
