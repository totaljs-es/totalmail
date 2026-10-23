// Sign-in sessions, kept across restarts in the sessions_sessions table of the database. Only the SHA-256 of each token is
// stored, so the table cannot be used to sign in. Writes are debounced (a burst of sign-ins is one write); a session that has
// expired is not loaded.
const Mirror = require('./mirror');
exports.spec = (table) => ({ table, prefix: 'sessions', clean: true, lists: ['sessions'] });

// options = { table, now, legacy: { file } }: what an earlier version kept was { hash: { userId, expires } } in a JSON file.
exports.open = async function(options) {
	var legacy = options.legacy && {
		...options.legacy,
		convert: (parsed) => ({
			sessions: Object.entries(parsed || {})
				.filter(([, record]) => record && typeof record.userId === 'string' && Number.isFinite(record.expires))
				.map(([id, record]) => ({ id, userId: record.userId, expires: record.expires }))
		})
	};
	return exports.create(await Mirror.open(exports.spec(options.table), { seed: { sessions: [] }, legacy }), options.now);
};

// storage = { state, mirror } as Mirror.open() returns it.
exports.create = function(storage, now = () => Date.now()) {

	var map = new Map(),
		timer = null,
		writing = Promise.resolve();
	for (var record of storage.state.sessions)
		if (record && typeof record.userId === 'string' && record.expires > now())
			map.set(record.id, { userId: record.userId, expires: record.expires });
	function write() {

		timer = null;
		var sessions = [];
		for (var [id, record] of map)
			sessions.push({ id, userId: record.userId, expires: record.expires });
		writing = writing.then(() => storage.mirror.save({ sessions }).catch(() => {}));
		return writing;
	}
	function changed() {

		if (timer)
			return;
		timer = setTimeout(write, 200);
		timer.unref();
	}
	return {
		get: (key) => map.get(key),
		set(key, record) {
			map.set(key, record);
			changed();
		},
		delete(key) {
			if (map.delete(key))
				changed();
		},
		revoke(userid) {

			var any = false;
			for (var [key, record] of map)
				if (record.userId === userid) {
					map.delete(key);
					any = true;
				}
			if (any)
				changed();
		},
		sweep() {

			var any = false,
				time = now();
			for (var [key, record] of map)
				if (record.expires < time) {
					map.delete(key);
					any = true;
				}
			if (any)
				changed();
		},
		// Writes now (and, in a test, waits for it).
		flush() {
			if (timer)
				clearTimeout(timer);
			return write();
		},
		size: () => map.size
	};
};
