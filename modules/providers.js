// The catalogue of mail providers (the ones that ship in the plugins and the ones the administrator added). Used as
// MODS.providers; the logic is in lib/providers.js.
var Lazy = require('../lib/lazy'),
	Lib = require('../lib/providers');

exports.install = function() {
	Object.assign(
		exports,
		Lib.create(
			PATH.plugins(),
			Total.Dns.promises.resolveMx,
			Lazy(function() { return MODS.instance; })
		)
	);
};

exports.serversFor = Lib.serversFor;
exports.validate = Lib.validate;
exports.load = Lib.load;
