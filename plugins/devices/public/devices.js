PLUGIN('devices', function(exports) {
	// The model exists from the start: the views bind to it before the rest of the page is ready.
	exports.set('', { items: [], error: '' });
	WAIT(
		function() {
			return !!PLUGINS.mail?.store;
		},
		function() {

			var mailbox = PLUGINS.mail,
				busy = false;
			var set = (path, value) => exports.set(path, value);
			var when = (iso) => (iso ? new Date(iso).toLocaleString(document.documentElement.lang, { dateStyle: 'medium', timeStyle: 'short' }) : '');
			function render(data) {
				set(
					'items',
					data.devices.map((d) => ({
						id: d.id,
						name: d.name,
						current: d.current,
						detail: [d.platform, d.app].filter(Boolean).join(' · '),
						lastUsed: TRANSLATE('@(Last used {0})').format(when(d.last)) + (d.address ? ' · ' + d.address : '')
					}))
				);
			}
			async function call(schema, payload) {

				if (busy)
					return null;
				busy = true;
				set('error', '');
				try {
					return await mailbox.api(schema, payload);
				} catch (e) {
					set('error', e.message);
					return null;
				} finally {
					busy = false;
				}
			}
			exports.open = async function() {
				try {
					render(await mailbox.api('device_list'));
					set('error', '');
					SET('mail.window', 'devices');
				} catch (e) {
					mailbox.notify(e.message);
				}
			};
			exports.revoke = async (element) => {
				var data = await call('device_revoke', { id: element[0].dataset.id });
				if (data)
					render(data);
			};
		}
	);
});
