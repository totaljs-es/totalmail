// The notifier of new mail (IDLE connections) that the page waits on. Used as MODS.changes
// Production wiring of the change notifier: IDLE connections use the same credentials, DNS checks and TLS rules as live.js.
var Lazy = require('./lazy'),
	Network = require('./network'),
	Watch = require('./watch');

exports.create = function(dependencies = {}) {
	var oauth = dependencies.oauth || Lazy(function() { return MODS.oauth; }),
		Users = dependencies.users || Lazy(function() { return MODS.users; }),
		decrypt = dependencies.decrypt || (function(value) { return MODS.security.identities.decrypt(value); });
	return Watch.create({
		imap: dependencies.imap || require('./imap').create(),
		resolve: dependencies.resolve || Network.resolve,
		sweep: dependencies.sweep,
		accounts: function(user) {
			return Users.forUser(user).accountIds();
		},
		async credential(user, id) {

			var store = Users.forUser(user),
				account = store.account(id);
			if (account.authType === 'oauth2')
				return { account, password: await oauth.accessToken(account, store) };
			if (!account.secret)
				throw Error('Account has no password credential');
			return {
				account,
				password: decrypt(account.secret)
			};
		}
	});
};

// ---- The singleton of the application (MODS.changes)
var Lib = exports;

exports.install = function() {
	Object.assign(exports, Lib.create());
};
