// The session of the request, or the device token of an app. Administrators carry the permission that actions ask for with
// `permissions: 'admin'`.
AUTH(function($) {
	var user = PLUGINS.users.security.session($.controller) || PLUGINS.users.security.device($.controller);
	$.callback(user ? Object.assign({}, user, { permissions: user.role === 'admin' ? ['admin'] : [] }) : null);
});
