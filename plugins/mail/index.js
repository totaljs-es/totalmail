exports.name = '@(Mail)';
exports.icon = 'ti ti-envelope';
exports.visible = function(user) { return !!user; };

// What the rest of the application reads as PLUGINS.mail.<name>: the mail itself (live), the notifier of new mail (changes), the private
// mailbox of each person (mailboxes), the sanitizer of mail HTML, the attachments, the welcome message and the addresses of an account.
exports.live = require('./live');
exports.changes = require('./changes');
exports.mailboxes = require('./mailboxes');
exports.html = require('./html');
exports.files = require('./files');
exports.welcome = require('./welcome');
exports.aliases = require('./aliases');

exports.install = function() {
	exports.mailboxes.install();
	exports.live.install();
	exports.changes.install();
};
