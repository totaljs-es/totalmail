// Short-lived things a sign-in needs between two requests, kept in memory only (a restart simply starts over):
// the password was right and a code is awaited, or a person is setting up two-step verification and has not confirmed yet.
const Crypto = Total.Crypto;

const lifetime = 5 * 60000,
	setup = 15 * 60000,
	tries = 5;

exports.create = function(now = () => Date.now()) {

	var logins = new Map(),
		setups = new Map();
	function sweep() {
		for (var [key, value] of logins)
			if (value.expires < now())
				logins.delete(key);
		for (var [key, value] of setups)
			if (value.expires < now())
				setups.delete(key);
	}
	return {
		// After a right password: a token that proves it, for the code that follows.
		login(userid) {

			sweep();
			var token = Crypto.randomBytes(24).toString('base64url');
			logins.set(token, { userId: userid, expires: now() + lifetime, tries: 0 });
			return token;
		},
		// One try with the token. It is spent after five tries or when the code was right (call done()).
		attempt(token) {

			var entry = logins.get(String(token || ''));
			if (!entry || entry.expires < now()) {
				logins.delete(String(token || ''));
				return null;
			}
			if (++entry.tries > tries) {
				logins.delete(token);
				return null;
			}
			return { userId: entry.userId };
		},
		done: (token) => logins.delete(String(token || '')),
		// A secret that was shown but not confirmed yet; only the person it was made for can confirm it.
		setup(userid, secret) {
			sweep();
			setups.set(userid, { secret, expires: now() + setup });
		},
		takeSetup(userid) {
			var entry = setups.get(userid);
			return entry && entry.expires >= now() ? entry.secret : '';
		},
		finishSetup: (userid) => setups.delete(userid),
		size: () => logins.size + setups.size
	};
};
