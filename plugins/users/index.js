exports.name = '@(Company users)';
exports.icon = 'ti ti-users';
exports.visible = function(user) { return !!user && user.role === 'admin'; };

// PLUGINS.users.security: the people, their sessions and devices, the two-step codes and the throttles of the sign-in (AUTH() reads it).
exports.security = require('./security');
exports.totp = require('./totp');

exports.install = function() {
	exports.security.install();
};
