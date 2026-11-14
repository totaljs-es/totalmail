// The apps a person is signed in with (device tokens). Only the owner sees and ends their devices.
function overview($) {
	var now = new Date();
	return {
		devices: PLUGINS.users.security.devices.list($.user.id, now).map(function(d) { return Object.assign({}, d, { current: d.id === $.user.deviceId }); })
	};
}

NEWACTION('Devices|list', {
	name: 'List the devices',
	user: true,
	route: '+API /api/ -device_list --> Devices|list',
	action: function($) { return FUNC.run($, function() { return overview($); }); }
});

// An app asks for its device token after the person signed in (password and two-step code). The password is asked again so that
// a session that was left open cannot be turned into a sign-in that outlives it. The token is in this answer and nowhere else.
NEWACTION('Devices|create', {
	name: 'Add a device',
	user: true,
	route: '+API /api/ +device_create --> Devices|create',
	input: '*name:String(60), platform:String(60), app:String(60), *password:String(128)',
	action: function($, model) {
		return FUNC.run($, async function() {

			if ($.user.deviceId)
				throw Error('@(Sign in with your password to add a device.)');
			if (!PLUGINS.users.security.allowAttempt($, 'device-' + $.user.id))
				throw Error('@(Too many attempts. Try again in 15 minutes.)');
			if (!(await PLUGINS.users.security.identities.verify($.user.id, model.password)))
				throw Error('@(Your current password is incorrect.)');
			PLUGINS.users.security.attemptSucceeded($, 'device-' + $.user.id);
			var made = await PLUGINS.users.security.devices.create($.user.id, {
				name: model.name,
				platform: model.platform,
				app: model.app,
				address: PLUGINS.users.security.address($)
			});
			return { token: made.token, device: Object.assign({}, made.record, { current: true }) };
		});
	}
});

NEWACTION('Devices|revoke', {
	name: 'Revoke a device',
	user: true,
	route: '+API /api/ +device_revoke --> Devices|revoke',
	input: '*id:String(16)',
	action: function($, model) {
		return FUNC.run($, async function() {
			await PLUGINS.users.security.devices.revoke(model.id, $.user.id);
			return overview($);
		});
	}
});
