const Tables = require('../lib/tables').in(PATH.root('database'));
var directory = PATH.root('database');
// The accounts and the sessions live in the database. They are opened when the module is installed and filled into these
// objects, so what other modules hold stays the same; nothing is served until they are ready.
var identities = {},
	sessions = {},
	devices = {},
	attempts = new Map();
exports.ready = Promise.resolve();
exports.install = function() {
	PAUSESERVER('security', true);
	// Everything the database holds is readable by the account that runs TotalMail, and by nobody else.
	try {
		Total.Fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
		Total.Fs.chmodSync(directory, 0o700);
	} catch {}
	exports.ready = Promise.all([
		require('../lib/identities').open({ directory, table: Tables, legacy: { file: Total.Path.join(directory, 'users.json') } }),
		require('../lib/sessions').open({ table: Tables, legacy: { file: Total.Path.join(directory, 'sessions.json') } }),
		require('../lib/devices').open({ table: Tables })
	]).then(([accounts, signedin, apps]) => {
		Object.assign(identities, accounts);
		Object.assign(sessions, signedin);
		Object.assign(devices, apps);
		PAUSESERVER('security', false);
	});
	exports.ready.catch((error) => Total.error(error, 'TotalMail security'));
};
// A restart (a new upload of the files, a reboot) must not sign everybody out.
ON('exit', () => sessions.flush && sessions.flush());
var digest = (value) => Total.Crypto.createHash('sha256').update(value).digest('hex');
exports.version = (() => {
	try {
		return JSON.parse(Total.Fs.readFileSync(PATH.root('package.json'), 'utf8')).version;
	} catch {
		return '';
	}
})();
exports.identities = identities;
exports.devices = devices;
// A password that was right but still needs its code, and setups not yet confirmed.
exports.pending = require('../lib/pending').create();
// jComponent compiles bindings with Function(), hence unsafe-eval. Everything else is restricted to self and the official CDN.
var cdn = 'https://cdn.componentator.com';
var headers = {
	'content-security-policy':
		"default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' " +
		cdn +
		"; style-src 'self' 'unsafe-inline' " +
		cdn +
		"; font-src 'self' data: " +
		cdn +
		"; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
	'x-frame-options': 'DENY',
	'x-content-type-options': 'nosniff',
	'referrer-policy': 'same-origin',
	'permissions-policy': 'camera=(), microphone=(), geolocation=()'
};
exports.headers = function($) {
	Object.assign($.response.headers, headers);
	if (($.controller || $).protocol === 'https')
		$.response.headers['strict-transport-security'] = 'max-age=31536000';
};
exports.checkRequest = function($) {
	var ctrl = $.controller || $;
	if (ctrl.headers['x-totalmail'] !== '1')
		return false;
	if (ctrl.headers.origin)
		try {
			var origin = new URL(ctrl.headers.origin);
			if (origin.host !== ctrl.headers.host || !['http:', 'https:'].includes(origin.protocol))
				return false;
		} catch {
			return false;
		}

	return true;
};
exports.session = function(ctrl) {
	var token = ctrl.cookie('totalmail-session');
	if (!token)
		return null;
	var record = sessions.get(digest(token));
	if (!record)
		return null;
	if (record.expires < Date.now()) {
		sessions.delete(digest(token));
		return null;
	}
	return identities.get(record.userId);
};
// An app signed in with a device token (Authorization: Bearer): the identity of its owner, with the device it came from.
exports.device = function(ctrl) {
	var header = ctrl.headers.authorization || '';
	if (!/^Bearer\s+tmd_/i.test(header))
		return null;
	var record = devices.find(header.replace(/^Bearer\s+/i, '').trim());
	var user = record && identities.get(record.userId);
	if (!user)
		return null;
	devices.touch(record.id, clientip(ctrl)).catch(() => {});
	return { ...user, deviceId: record.id };
};
exports.revoke = function(userid) {
	sessions.revoke(userid);
	// The apps of the person sign out with their sessions.
	devices.revokeUser(userid).catch((error) => Total.error(error, 'TotalMail devices'));
};
exports.start = function($, user) {
	var ctrl = $.controller || $,
		token = Total.Crypto.randomBytes(32).toString('base64url');
	var old = ctrl.cookie('totalmail-session');
	if (old)
		sessions.delete(digest(old));
	sessions.set(digest(token), {
		userId: user.id,
		expires: Date.now() + 8 * 3600000
	});
	ctrl.cookie('totalmail-session', token, '8 hours', {
		httpOnly: true,
		secure: ctrl.protocol === 'https',
		samesite: 'Strict'
	});
};
exports.logout = function($) {
	var ctrl = $.controller || $,
		token = ctrl.cookie('totalmail-session');
	if (token)
		sessions.delete(digest(token));
	ctrl.cookie('totalmail-session', '', '-1 day', {
		httpOnly: true,
		samesite: 'Strict'
	});
};
exports.address = ($) => clientip($);
var clientip = function($) {
	var ctrl = $.controller || $;
	return require('../lib/clientip')(ctrl.headers, ctrl.req?.connection?.remoteAddress, String(CONF.trust_proxy) !== 'false');
};
exports.allowLogin = function($, email) {
	var ip = clientip($);
	for (var [key, limit] of [
		[ip, 100],
		[ip + '|' + String(email).toLowerCase(), 15]
	]) {
		let entry = attempts.get(key);
		if (!entry || entry.until < Date.now()) {
			entry = {
				count: 0,
				until: Date.now() + 15 * 60000
			};
			attempts.set(key, entry);
		}
		if (++entry.count > limit)
			return false;
	}
	return true;
};
exports.loginSucceeded = function($, email) {
	var ip = clientip($);
	attempts.delete(ip + '|' + String(email).toLowerCase());
	var entry = attempts.get(ip);
	if (entry)
		entry.count = Math.max(0, entry.count - 1);
};
// Once a minute, on the framework's own timer.
ON('service', () => {
	var now = Date.now();
	sessions.sweep();
	for (var [k, v] of attempts)
		if (v.until < now)
			attempts.delete(k);
});
