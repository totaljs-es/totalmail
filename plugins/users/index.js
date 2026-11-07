exports.name = '@(Company users)';
exports.icon = 'ti ti-users';
exports.visible = function(user) { return user.role === 'admin'; };
