// Production wiring of the change notifier: IDLE connections use the same credentials, DNS checks and TLS rules as live.js.
const Lazy = require('./lazy'),
	Network = require('./network'),
	Watch = require('./watch');
exports.create = function(dependencies = {}) {
	var oauth = dependencies.oauth || Lazy(() => MODS.oauth),
		Users = dependencies.users || Lazy(() => MODS.users),
		decrypt = dependencies.decrypt || ((value) => MODS.security.identities.decrypt(value));
	return Watch.create({
		imap: dependencies.imap || require('./imap').create(),
		resolve: dependencies.resolve || Network.resolve,
		sweep: dependencies.sweep,
		accounts: (user) =>
			Users.forUser(user)
				.snapshot()
				.accounts.filter((a) => a.configured && ['verified', 'synced'].includes(a.status))
				.map((a) => a.id),
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
