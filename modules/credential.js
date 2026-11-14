// The password that IMAP and SMTP are given for an account: a fresh access token for an OAuth account, otherwise the decrypted mail
// password. dependencies = { oauth, decrypt }; the result is credential(store, id) -> { account, password }.
exports.create = function(dependencies) {
	return async function(store, id) {

		var account = store.account(id);
		if (account.authType === 'oauth2')
			return {
				account,
				password: await dependencies.oauth.accessToken(account, store)
			};
		if (!account.secret)
			throw Error('@(Save a mail password or app password before connecting.)');
		return {
			account,
			password: dependencies.decrypt(account.secret)
		};
	};
};
