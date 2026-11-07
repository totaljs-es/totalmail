// The notifier of new mail (IDLE connections) that the page waits on. Used as MODS.changes; the logic is in lib/changes.js.
var Lib = require('../lib/changes');

exports.install = function() {
	Object.assign(exports, Lib.create());
};
