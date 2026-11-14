exports.name = '@(Rules)';
exports.icon = 'ti ti-filter';
exports.visible = function(user) { return !!user; };

// PLUGINS.rules.engine: validates a rule and tells whether it matches a message.
exports.engine = require('./engine');
