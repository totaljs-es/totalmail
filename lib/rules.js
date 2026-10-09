// Rules for new mail: when a message arrives in the inbox and every condition of a rule matches, one action runs.
// Deliberately small and predictable: one condition, one action, first matching rule wins, never sends mail.
var fields = ['from', 'to', 'subject'],
	ops = ['contains', 'is'],
	actions = ['archive', 'trash', 'read', 'star', 'move'];
exports.limits = { rules: 30, actionsPerSync: 30, log: 100 };
exports.fields = fields;
function candidates(field, m) {
	var list =
		field === 'from' ? [m.email, m.sender] : field === 'to' ? [...(m.toRecipients || []), ...(m.ccRecipients || [])] : [m.subject];
	return list.filter((x) => typeof x === 'string' && x).map((x) => x.trim().toLowerCase());
}
exports.matches = function(rule, message) {
	var value = String(rule.value || '')
		.trim()
		.toLowerCase();
	if (!value)
		return false;
	return candidates(rule.field, message).some((text) => (rule.op === 'is' ? text === value : text.includes(value)));
};
// The first enabled rule that matches decides; later rules do not see the message.
exports.firstMatch = (rules, message) => (rules || []).find((rule) => rule.enabled !== false && exports.matches(rule, message));
// A rule as it may be stored. `account` supplies the folders a message can be moved to.
exports.validate = function(input, account) {
	var rule = {
		id: input.id,
		name: String(input.name || '')
			.trim()
			.slice(0, 60),
		enabled: input.enabled !== false,
		field: input.field,
		op: input.op,
		value: String(input.value || '')
			.replace(/[\x00-\x1f\x7f]+/g, ' ')
			.trim(),
		action: input.action
	};
	if (!rule.name)
		throw Error('@(Give the rule a name.)');
	if (!fields.includes(rule.field) || !ops.includes(rule.op) || !actions.includes(rule.action))
		throw Error('@(Invalid operation.)');
	if (!rule.value || rule.value.length > 100)
		throw Error('@(Enter the text to look for, up to 100 characters.)');
	if (rule.action === 'move') {
		var folder = (account.mailboxes || []).find((f) => f.path === input.path);
		if (!folder || folder.path.toUpperCase() === 'INBOX')
			throw Error('@(Choose an existing destination folder for this account.)');
		rule.path = folder.path;
	}
	return rule;
};
