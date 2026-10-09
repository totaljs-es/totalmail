exports.name = '@(AI assistant)';
exports.icon = 'ti ti-magic';
exports.visible = (user) => !!user && user.role === 'admin';
