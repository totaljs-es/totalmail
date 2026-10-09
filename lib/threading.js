// Accept bounded RFC-style identifiers only; received headers never become raw SMTP headers.
function identifier(value) {
	return typeof value === 'string' && value.length <= 254 && /^<[A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Za-z0-9.\[\]:-]+>$/.test(value)
		? value
		: '';
}
function references(value) {
	var items = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/\s+/) : [];
	var result = [...new Set(items.map(identifier).filter(Boolean))].slice(-20);
	while (result.join(' ').length > 900)
		result.splice(result.length > 2 ? 1 : 0, 1);
	return result;
}
exports.identifier = identifier;
exports.references = references;
exports.headers = function(parent) {
	var id = identifier(parent?.messageId);
	if (!id)
		return {};
	return {
		'In-Reply-To': id,
		References: references([...references(parent.references?.length ? parent.references : parent.inReplyTo), id]).join(' ')
	};
};
