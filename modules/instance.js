// The settings of this installation: the sign-in application of each OAuth provider, the account types the administrator
// added, the writing assistant and what it costs. Used as MODS.instance; the logic is in lib/instance.js.
var Lib = require('../lib/instance'),
	Tables = require('../lib/tables').in(PATH.root('database'));

exports.install = function() {
	// Nothing is served until the settings are loaded.
	PAUSESERVER('instance', true);
	// The key that protects the secrets belongs to the accounts, which MODS.security opens.
	ON('ready', function() {
		return MODS.security.ready
			.then(function() {
				return Lib.open({
					table: Tables,
					crypto: {
						encrypt: function(value) { return MODS.security.identities.encrypt(value); },
						decrypt: function(value) { return MODS.security.identities.decrypt(value); }
					},
					legacy: { file: PATH.root('database/instance.json') }
				});
			}
			)
			.then(function(store) {
				Object.assign(exports, store);
				PAUSESERVER('instance', false);
			})
			.catch(function(error) { return Total.error(error, 'TotalMail instance settings'); });
	}
	);
};
