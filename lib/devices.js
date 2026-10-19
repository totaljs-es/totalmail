// The devices a person has signed in with: the native apps. A web browser signs in with a session that lasts hours; an app has to
// stay signed in, so after the password and the two-step code it gets a device token that belongs to that one device. Kept in the
// devices_devices table; only the SHA-256 of a token is stored, so a token is shown once, when the device is added. The person sees
// every device (name, system, app, when and from where it was last used) and can sign any of them out. A device that is not used for
// 180 days signs itself out.
const Mirror = require('./mirror');
exports.limits = { perUser: 20, text: 60, idle: 180 * 86400000 };
exports.spec = (table) => ({ table, prefix: 'devices', clean: true, lists: ['devices'] });
exports.open = async function(options) {
	return exports.create(await Mirror.open(exports.spec(options.table), { seed: { devices: [] } }));
};
var hash = (token) => Total.Crypto.createHash('sha256').update(token).digest('hex');
var text = (value, fallback = '') =>
	String(value || '')
		.replace(/[\x00-\x1f\x7f]+/g, ' ')
		.trim()
		.slice(0, exports.limits.text) || fallback;
// storage = { state, mirror } as Mirror.open() returns it.
exports.create = function(storage) {
	var state = structuredClone(storage.state);
	var queue = Promise.resolve();
	// Keep revocations effective while an older write is waiting on disk. The queued
	// removal persists them; only then can these temporary markers be forgotten.
	var revoked = new Set();
	function excludeRevoked(next) {
		next.devices = next.devices.filter((d) => !revoked.has(d.id));
	}
	function revokeWhere(matches) {
		var ids = state.devices.filter(matches).map((d) => d.id);
		for (var id of ids)
			revoked.add(id);
		excludeRevoked(state);
		return update((next) => {
			next.devices = next.devices.filter((d) => !matches(d));
			return {};
		}).then((result) => {
			for (var id of ids)
				revoked.delete(id);
			return result;
		});
	}
	function update(mutate) {
		var result = queue.then(async () => {
			var next = structuredClone(state);
			var value = mutate(next);
			excludeRevoked(next);
			await storage.mirror.save(next);
			excludeRevoked(next);
			state = next;
			return structuredClone(value);
		});
		queue = result.catch(() => {});
		return result;
	}
	// What a window may see: never the hash, never the token.
	function view(d) {
		return {
			id: d.id,
			userId: d.userId,
			name: d.name,
			platform: d.platform,
			app: d.app,
			created: d.created,
			last: d.last || '',
			address: d.address || '',
			uses: d.uses || 0
		};
	}
	var alive = (d, now) => now.getTime() - new Date(d.last || d.created).getTime() < exports.limits.idle;
	return {
		list: (userid, now = new Date()) => state.devices.filter((d) => d.userId === userid && alive(d, now)).map(view),
		// device = { name, platform, app, address }. The token itself is returned only here.
		create: (userid, device, now = new Date()) =>
			update((next) => {
				var name = text(device.name);
				if (!name)
					throw Error('@(Give the device a name.)');
				if (next.devices.filter((d) => d.userId === userid && alive(d, now)).length >= exports.limits.perUser)
					throw Error('@(There are too many devices. Sign one out that you no longer use.)');
				var id = Total.Crypto.randomBytes(4).toString('hex'),
					token = 'tmd_' + id + '_' + Total.Crypto.randomBytes(24).toString('base64url');
				var record = {
					id,
					userId: userid,
					name,
					platform: text(device.platform),
					app: text(device.app),
					hash: hash(token),
					created: now.toISOString(),
					last: now.toISOString(),
					address: text(device.address),
					uses: 0
				};
				next.devices.push(record);
				return { token, record: view(record) };
			}),
		// Signing out takes effect at once, in memory; the table follows. Waiting for the write would leave the device working
		// for a moment after the person ended it, or after the password changed.
		revoke(id, userid) {
			var found = state.devices.find((d) => d.id === id && d.userId === userid);
			if (!found)
				return Promise.reject(Error('@(Device not found.)'));
			return revokeWhere((d) => d.id === id && d.userId === userid);
		},
		revokeUser(userid) {
			return revokeWhere((d) => d.userId === userid);
		},
		// The record of a valid device, or null. The comparison takes the same time for every wrong token.
		find(token, now = new Date()) {
			var match = /^tmd_([0-9a-f]{8})_[A-Za-z0-9_-]{20,}$/.exec(String(token || ''));
			if (!match)
				return null;
			var record = state.devices.find((d) => d.id === match[1]);
			if (!record)
				return null;
			var given = Buffer.from(hash(token)),
				wanted = Buffer.from(record.hash);
			if (given.length !== wanted.length || !Total.Crypto.timingSafeEqual(given, wanted))
				return null;
			return alive(record, now) ? view(record) : null;
		},
		// Remembers when and from where it was last used (at most once a minute, so a busy app does not write for every request).
		touch(id, address, now = new Date()) {
			var record = state.devices.find((d) => d.id === id);
			if (!record)
				return Promise.resolve();
			if (record.last && now - new Date(record.last) < 60000) {
				record.uses = (record.uses || 0) + 1;
				return Promise.resolve();
			}
			return update((next) => {
				var item = next.devices.find((d) => d.id === id);
				if (item) {
					item.last = now.toISOString();
					item.address = text(address, item.address);
					item.uses = (item.uses || 0) + 1;
				}
				return {};
			});
		}
	};
};
