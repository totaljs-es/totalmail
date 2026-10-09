// OAuth sign-in to mail providers. Used as MODS.oauth; the logic is in lib/oauth.js.
const Lib = require('../lib/oauth');
exports.install = function() {
	Object.assign(exports, Lib.create());
};
exports.settings = Lib.settings;
exports.meta = Lib.meta;
exports.claims = Lib.claims;
exports.useInstance = Lib.useInstance;
// What a finished sign-in leads to: the account it was started for becomes (or stays) an OAuth account of the provider, or, when it
// was started from the account type list, a new account is added. Returns what the page tells the person: ok or mismatch.
exports.complete = async function(provider, grant) {
	var store = MODS.users.forUser({ id: grant.userId }),
		servers = MODS.providers.serversFor(provider, grant.email);
	if (grant.accountId) {
		var existing = store.account(grant.accountId);
		if (
			existing.email !== grant.email ||
			(grant.username !== existing.email && grant.username !== existing.imap.username.toLowerCase())
		)
			return 'mismatch';
		// Servers from the catalogue, username from the identity, no stored password.
		await store.saveAccount({
			id: existing.id,
			name: existing.name,
			email: existing.email,
			configured: true,
			status: 'pending',
			authType: 'oauth2',
			secret: null,
			oauth: grant.oauth,
			imap: { ...servers.imap, username: grant.username },
			smtp: { ...servers.smtp, username: grant.username }
		});
		exports.remember(existing.id, grant.access);
		return 'ok';
	}
	var account = await store.saveAccount({
		id: '',
		newId: UID(),
		name: grant.name,
		email: grant.email,
		initials: grant.name
			.split(/\s+/)
			.map((x) => x[0])
			.slice(0, 2)
			.join('')
			.toUpperCase(),
		color: '#4285F4',
		configured: true,
		status: 'pending',
		authType: 'oauth2',
		oauth: grant.oauth,
		imap: { ...servers.imap, username: grant.username },
		smtp: { ...servers.smtp, username: grant.username }
	});
	exports.remember(account.id, grant.access);
	return 'ok';
};
