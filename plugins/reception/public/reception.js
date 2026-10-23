// The scheduler is shared with isolated tests; the UI lifecycle belongs to PLUGIN().
function totalmailreception(options) {
	var running = false,
		stopped = false,
		last = -Infinity;
	return {
		async tick() {

			var now = options.now();
			if (stopped || running || now - last < 60000 || !options.ready())
				return;
			running = true;
			last = now;
			try {
				await options.run();
			} finally {
				running = false;
			}
		},
		// A server notification skips the one-minute throttle; every other condition still applies.
		wake() {
			last = -Infinity;
			return this.tick();
		},
		stop() {
			stopped = true;
		}
	};
}

// Long-polls /changes/. The server holds each request until an IMAP IDLE connection reports a change.
totalmailreception.listen = function(options) {

	var stopped = false,
		since = 0,
		failures = 0;
	(async function() {
		while (!stopped) {
			if (!options.ready()) {
				await options.sleep(5000);
				continue;
			}
			try {
				var result = await options.poll(since);
				if (!result)
					return;
				if (since && result.changed.length)
					options.wake(result.changed);
				since = result.version;
				failures = 0;
			} catch {
				await options.sleep(Math.min(60000, 5000 * 2 ** Math.min(failures++, 4)));
			}
		}
	})();
	return {
		stop() {
			stopped = true;
		}
	};
};

if (typeof module !== 'undefined' && module.exports)
	module.exports = totalmailreception;
else
	PLUGIN('reception', function(exports) {

		var enabled = true,
			timer,
			scheduler,
			listener,
			tick = () => scheduler?.tick().catch(() => {});
		exports.set('', { enabled: true });
		// The switch of the settings window follows reception.enabled (a ui-bind in the view).
		function status() {
			exports.set('enabled', enabled);
		}
		// The window is shown, or the network is back (the pageevents component of the page).
		exports.tick = tick;
		exports.leaving = function() {

			clearInterval(timer);
			scheduler?.stop();
			listener?.stop();
		};
		exports.toggle = function() {

			enabled = !enabled;
			try {
				localStorage.setItem('totalmail-reception-' + PLUGINS.mail.store.user.id, enabled ? '1' : '0');
			} catch {}
			status();
		};
		WAIT(
			() => !!PLUGINS.mail?.store.user && !PLUGINS.mail.store.loading,
			function() {

				var user = PLUGINS.mail.store.user.id;
				try {
					enabled = localStorage.getItem('totalmail-reception-' + user) !== '0';
				} catch {}
				status();
				scheduler = totalmailreception({
					now: Date.now,
					ready: () => enabled && !document.hidden && navigator.onLine && PLUGINS.mail.backgroundReady(),
					run: async () => {
						if (navigator.locks)
							await navigator.locks.request('totalmail-reception-' + user, { ifAvailable: true }, (lock) =>
								lock ? PLUGINS.mail.backgroundSync() : undefined
							);
						else
							await PLUGINS.mail.backgroundSync();
					}
				});
				listener = totalmailreception.listen({
					ready: () => enabled && !document.hidden && navigator.onLine,
					sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
					wake: () => scheduler.wake().catch(() => {}),
					async poll(since) {

						var answer = await totalmailrequest.get('/changes/?since=' + since);
						if (answer.status === 401)
							return null;
						if (answer.status !== 200 || !answer.value || typeof answer.value !== 'object')
							throw new Error('changes');
						return answer.value;
					}
				});
				timer = setInterval(tick, 60000);
			}
		);
	});
