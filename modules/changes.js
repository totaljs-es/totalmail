// The notifier of new mail (IDLE connections) that the page waits on. Used as MODS.changes.
// Production wiring of the change notifier: IDLE connections use the same credentials, DNS checks and TLS rules as live.js.
var Credential = require('./credential'),
	Lazy = require('./lazy'),
	Network = require('./network'),
	Watch = require('./watch');

exports.create = function(dependencies = {}) {
	var oauth = dependencies.oauth || Lazy(function() { return MODS.oauth; }),
		Users = dependencies.users || Lazy(function() { return MODS.users; }),
		decrypt = dependencies.decrypt || (function(value) { return MODS.security.identities.decrypt(value); });
	var credential = Credential.create({ oauth, decrypt });
	return Watch.create({
		imap: dependencies.imap || require('./imap').create(),
		resolve: dependencies.resolve || Network.resolve,
		sweep: dependencies.sweep,
		accounts: function(user) {
			return Users.forUser(user).accountIds();
		},
		credential: function(user, id) { return credential(Users.forUser(user), id); }
	});
};

// ---- The singleton of the application (MODS.changes)
var Lib = exports;

exports.install = function() {
	Object.assign(exports, Lib.create());
};
