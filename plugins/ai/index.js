exports.name = '@(AI assistant)';
exports.icon = 'ti ti-magic';
exports.visible = function(user) { return !!user && user.role === 'admin'; };

// PLUGINS.ai.assistant: what is asked of the model; PLUGINS.ai.knowledge: the documents it may read; PLUGINS.ai.extract: text out of files.
exports.assistant = require('./assistant');
exports.knowledge = require('./knowledge');
exports.extract = require('./extract');

exports.install = function() {
	exports.knowledge.install();
};
