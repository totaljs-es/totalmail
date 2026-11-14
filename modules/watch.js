// Change notifications. One IMAP IDLE connection per watched account reports "something changed in INBOX"
// and wakes that user's long-poll requests. The client then syncs through the normal, protected Actions.
// Connections exist only while a signed-in client keeps polling, and are capped per user and in total.
var limits = {
	total: 20,
	user: 5,
	waiters: 5,
	idle: 90000,
	hold: 25000,
	debounce: 1500,
	backoff: [15000, 30000, 60000, 120000, 300000],
	authFailure: 30 * 60000
};

exports.limits = limits;

exports.create = function(dependencies) {

	var engine = dependencies.imap,
		resolve = dependencies.resolve,
		accounts = dependencies.accounts,
		credential = dependencies.credential,
		clock = dependencies.clock || { now: Date.now, set: setTimeout, clear: clearTimeout };
	var users = new Map();
	function user(id) {

		var item = users.get(id);
		if (!item) {
			item = { version: 1, changed: new Map(), watchers: new Map(), waiters: new Set() };
			users.set(id, item);
		}
		return item;
	}
	function release(item, waiter, result) {

		if (!item.waiters.delete(waiter))
			return;
		clock.clear(waiter.timer);
		waiter.resolve(result || answer(item, waiter.since));
	}
	function answer(item, since) {
		return {
			version: item.version,
			changed: Array.from(item.changed).filter(function(entry) {
				var version = entry[1];
				return version > since;
			}).map(function(entry) {
				var id = entry[0];
				return id;
			})
		};
	}
	function bump(item, accountid) {

		item.version++;
		item.changed.set(accountid, item.version);
		for (var list = Array.from(item.waiters), i = 0; i < list.length; i++) {
			var waiter = list[i];
			release(item, waiter);
		}
	}
	function stop(item, id) {

		var watcher = item.watchers.get(id);
		if (!watcher)
			return;
		item.watchers.delete(id);
		clock.clear(watcher.timer);
		clock.clear(watcher.debounce);
		watcher.stopped = true;
		try {
			(watcher.connection && watcher.connection.close());
		} catch {}
	}
	function retry(item, id, watcher, delay) {

		if (watcher.stopped)
			return;
		watcher.connection = null;
		watcher.timer = clock.set(function() { return connect(item, id, watcher); }, delay);
		(watcher.timer.unref && watcher.timer.unref());
	}
	async function connect(item, id, watcher) {

		if (watcher.stopped)
			return;
		if (clock.now() - watcher.seen > limits.idle)
			return stop(item, id);
		try {
			var tmp = await credential(watcher.owner, id);
			var account = tmp.account, password = tmp.password;
			var target = await resolve(account.imap.host);
			var connection = await engine.watch(account, password, target, function(event) {
				if (watcher.stopped || watcher.connection !== connection)
					return;
				if (event.type === 'change') {
					clock.clear(watcher.debounce);
					watcher.debounce = clock.set(function() { return bump(item, id); }, limits.debounce);
				} else {
					watcher.connection = null;
					try {
						connection.close();
					} catch {}
					retry(item, id, watcher, limits.backoff[Math.min(watcher.failures++, limits.backoff.length - 1)]);
				}
			});
			if (watcher.stopped)
				return connection.close();
			watcher.connection = connection;
			watcher.failures = 0;
		} catch (error) {
			retry(
				item,
				id,
				watcher,
				(error && error.authenticationFailed) ? limits.authFailure : limits.backoff[Math.min(watcher.failures++, limits.backoff.length - 1)]
			);
		}
	}
	function ensure(owner) {

		var item = user(owner.id),
			now = clock.now(),
			wanted = new Set(accounts(owner));
		for (var list = Array.from(item.watchers.keys()), i = 0; i < list.length; i++) {
			var id = list[i];
			var existing = item.watchers.get(id);
			if (!wanted.has(id) || now - existing.seen > limits.idle)
				stop(item, id);
		}
		for (var arr = Array.from(wanted), j = 0; j < arr.length; j++) {
			var id = arr[j];
			var watcher = item.watchers.get(id);
			if (watcher) {
				watcher.seen = now;
				continue;
			}
			var all = 0;
			for (var list = Array.from(users.values()), i = 0; i < list.length; i++) {
				var other = list[i];
				all += other.watchers.size;
			}
			if (item.watchers.size >= limits.user || all >= limits.total)
				continue;
			watcher = { owner, seen: now, failures: 0, connection: null, stopped: false };
			item.watchers.set(id, watcher);
			connect(item, id, watcher);
		}
		return item;
	}
	function sweep() {
		var now = clock.now();
		for (var arr = Array.from(users.values()), j = 0; j < arr.length; j++) {
			var item = arr[j];
			for (var list = Array.from(item.watchers), i = 0; i < list.length; i++) {
				var id = list[i][0],
					watcher = list[i][1];
				if (now - watcher.seen > limits.idle)
					stop(item, id);
			}
		}
	}
	if (dependencies.sweep !== false)
		ON('service', sweep);
	return {
		sweep,
		// since = 0 starts watching and answers immediately with the current version (versions start at 1).
		wait(owner, since, abort) {

			var item = ensure(owner);
			if (!since || item.version !== since)
				return Promise.resolve(answer(item, since));
			return new Promise(function(resolvepromise) {

				var waiter = { since, resolve: resolvepromise };
				if (item.waiters.size >= limits.waiters)
					release(item, item.waiters.values().next().value);
				waiter.timer = clock.set(function() { return release(item, waiter); }, limits.hold);
				(waiter.timer.unref && waiter.timer.unref());
				item.waiters.add(waiter);
				(abort && abort(function() { return release(item, waiter, { version: item.version, changed: [] }); }));
			});
		},
		// A removed user: close their IDLE connections and release their waiting requests.
		forget(userid) {

			var item = users.get(userid);
			if (!item)
				return;
			for (var list = Array.from(item.watchers.keys()), i = 0; i < list.length; i++) {
				var id = list[i];
				stop(item, id);
			}
			for (var list = Array.from(item.waiters), i = 0; i < list.length; i++) {
				var waiter = list[i];
				release(item, waiter);
			}
			users.delete(userid);
		},
		watching: function(owner) {
			var item = users.get(owner.id);
			return item ? Array.from(item.watchers.keys()) : [];
		},
		stopAll() {
			for (var arr = Array.from(users), j = 0; j < arr.length; j++) {
				var item = arr[j][1];
				for (var list = Array.from(item.watchers.keys()), i = 0; i < list.length; i++) {
					var id = list[i];
					stop(item, id);
				}
				for (var list = Array.from(item.waiters), i = 0; i < list.length; i++) {
					var waiter = list[i];
					release(item, waiter);
				}
			}
		}
	};
};
