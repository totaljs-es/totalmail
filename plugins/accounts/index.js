exports.name = '@(Mail accounts)';
exports.icon = 'ti ti-cog';
exports.visible = function(user) { return !!user; };

// PLUGINS.accounts.discovery: the servers of an email address.
exports.discovery = require('./discovery');
