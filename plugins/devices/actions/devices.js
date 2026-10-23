// The apps a person is signed in with (device tokens). Only the owner sees and ends their devices.
function overview($) {
	var now = new Date();
	return {
		devices: MODS.security.devices.list($.user.id, now).map((d) => ({ ...d, current: d.id === $.user.deviceId }))
	};
}

NEWACTION('Devices|list', {
	user: true,
	route: '+API /api/ -device_list --> Devices|list',
	action: ($) => FUNC.run($, () => overview($))
});

// An app asks for its device token after the person signed in (password and two-step code). The password is asked again so that
// a session that was left open cannot be turned into a sign-in that outlives it. The token is in this answer and nowhere else.
NEWACTION('Devices|create', {
	user: true,
	route: '+API /api/ +device_create --> Devices|create',
	input: '*name:String(60), platform:String(60), app:String(60), *password:String(128)',
	action: ($, model) =>
		FUNC.run($, async () => {

			if ($.user.deviceId)
				throw Error('@(Sign in with your password to add a device.)');
			if (!MODS.security.allowLogin($, 'device-' + $.user.id))
				throw Error('@(Too many attempts. Try again in 15 minutes.)');
			if (!(await MODS.security.identities.verify($.user.id, model.password)))
				throw Error('@(Your current password is incorrect.)');
			var made = await MODS.security.devices.create($.user.id, {
				name: model.name,
				platform: model.platform,
				app: model.app,
				address: MODS.security.address($)
			});
			return { token: made.token, device: { ...made.record, current: true } };
		})
});

NEWACTION('Devices|revoke', {
	user: true,
	route: '+API /api/ +device_revoke --> Devices|revoke',
	input: '*id:String(16)',
	action: ($, model) =>
		FUNC.run($, async () => {
			await MODS.security.devices.revoke(model.id, $.user.id);
			return overview($);
		})
});
