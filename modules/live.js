// The mail itself: what is read from and sent to the mail servers. Used as MODS.live; the logic is in lib/live.js.
const Lib = require('../lib/live');
exports.install = function() {
	Object.assign(exports, Lib.create());
};
