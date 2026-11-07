// The session of the request, or the device token of an app. Administrators carry the permission that actions ask for with
// `permissions: 'admin'`.
AUTH(function($) {
	var user = MODS.security.session($.controller) || MODS.security.device($.controller);
	$.callback(user ? Object.assign({}, user, { permissions: user.role === 'admin' ? ['admin'] : [] }) : null);
});
