exports.name = '@(Account types and sign-in)';
exports.icon = 'ti ti-key';
exports.visible = function(user) { return !!user && user.role === 'admin'; };

// PLUGINS.providers.catalogue: the account types (the ones in plugins/accounts/providers and the ones the administrator added);
// PLUGINS.providers.oauth: the sign-in of OAuth providers.
exports.catalogue = require('./catalogue');
exports.oauth = require('./oauth');

exports.install = function() {
	exports.catalogue.install();
	exports.oauth.install();
};
