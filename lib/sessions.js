// Sign-in sessions, kept across restarts in the sessions_sessions table of the database. Only the SHA-256 of each token is
// stored, so the table cannot be used to sign in. Writes are debounced (a burst of sign-ins is one write); a session that has
// expired is not loaded.
var Mirror = require('./mirror');
exports.spec = function(table) { return { table, prefix: 'sessions', clean: true, lists: ['sessions'] }; };

// options = { table, now, legacy: { file } }: what an earlier version kept was { hash: { userId, expires } } in a JSON file.
exports.open = async function(options) {
	var legacy = options.legacy && Object.assign({}, options.legacy, { convert: function(parsed) {
		return {
			sessions: Object.entries(parsed || {})
				.filter(function(entry) {
					var record = entry[1];
					return record && typeof record.userId === 'string' && Number.isFinite(record.expires);
				})
				.map(function(entry) {
					var id = entry[0], record = entry[1];
					return { id, userId: record.userId, expires: record.expires };
				})
		};
	} });
	return exports.create(await Mirror.open(exports.spec(options.table), { seed: { sessions: [] }, legacy }), options.now);
};

// storage = { state, mirror } as Mirror.open() returns it.
exports.create = function(storage, now = function() { return Date.now(); }) {

	var map = new Map(),
		timer = null,
		writing = Promise.resolve();
	for (var list = Array.from(storage.state.sessions), i = 0; i < list.length; i++) {
		var record = list[i];
		if (record && typeof record.userId === 'string' && record.expires > now())
			map.set(record.id, { userId: record.userId, expires: record.expires });
	}
	function write() {

		timer = null;
		var sessions = [];
		for (var list = Array.from(map), i = 0; i < list.length; i++) {
			var id = list[i][0],
				record = list[i][1];
			sessions.push({ id, userId: record.userId, expires: record.expires });
		}
		writing = writing.then(function() { return storage.mirror.save({ sessions }).catch(function() {}); });
		return writing;
	}
	function changed() {

		if (timer)
			return;
		timer = setTimeout(write, 200);
		timer.unref();
	}
	return {
		get: function(key) { return map.get(key); },
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
			for (var list = Array.from(map), i = 0; i < list.length; i++) {
				var key = list[i][0],
					record = list[i][1];
				if (record.userId === userid) {
					map.delete(key);
					any = true;
				}
			}
			if (any)
				changed();
		},
		sweep() {

			var any = false,
				time = now();
			for (var list = Array.from(map), i = 0; i < list.length; i++) {
				var key = list[i][0],
					record = list[i][1];
				if (record.expires < time) {
					map.delete(key);
					any = true;
				}
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
		size: function() { return map.size; }
	};
};
