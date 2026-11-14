exports.name = '@(Account types and sign-in)';
exports.icon = 'ti ti-key';
exports.visible = function(user) { return !!user && user.role === 'admin'; };
