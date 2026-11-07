exports.name = '@(AI assistant)';
exports.icon = 'ti ti-magic';
exports.visible = function(user) { return !!user && user.role === 'admin'; };
