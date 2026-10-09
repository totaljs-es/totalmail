exports.name = '@(Company users)';
exports.icon = 'ti ti-users';
exports.visible = (user) => user.role === 'admin';
