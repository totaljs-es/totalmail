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
