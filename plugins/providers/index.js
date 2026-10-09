exports.name = '@(Account types and sign-in)';
exports.icon = 'ti ti-key';
exports.visible = (user) => user.role === 'admin';
