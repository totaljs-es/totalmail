// What people type in the search box: words, "phrases" and a few operators.
//   from:ana  to:ana  subject:invoice  body:"kind regards"   a field must contain it
//   is:unread  is:read  is:starred                          state
//   has:attachment                                          a message with files
//   after:2026-09-01  before:2026-10-01                     dates (after includes the day, before does not)
// Anything else is a word that must appear somewhere (sender, recipients, subject or body); all of them must.
// Pure on purpose: the browser filters what is loaded with it and the server turns the same query into an IMAP search.
function totalmailquery() {}
totalmailquery.parse = function(text) {
	var q = { words: [], fields: [], is: [], has: [], after: null, before: null, empty: true };
	var token = /(\w+):("([^"]*)"|\S+)|"([^"]*)"|\S+/g,
		m,
		day = /^(\d{4})-(\d{2})-(\d{2})$/;
	while ((m = token.exec(String(text || '')))) {
		var key = m[1] && m[1].toLowerCase(),
			value = (m[3] !== undefined ? m[3] : m[2]) || '';
		if (key && ['from', 'to', 'subject', 'body'].includes(key) && value.trim())
			q.fields.push({ key, value: value.trim().toLowerCase() });
		else if (key === 'is' && ['unread', 'read', 'starred'].includes(value.toLowerCase()))
			q.is.push(value.toLowerCase());
		else if (key === 'has' && value.toLowerCase() === 'attachment')
			q.has.push('attachment');
		else if (
			(key === 'after' || key === 'before') &&
			day.test(value) &&
			!isNaN(Date.UTC(+value.slice(0, 4), +value.slice(5, 7) - 1, +value.slice(8, 10)))
		)
			q[key] = value;
		else {
			var word = (m[4] !== undefined ? m[4] : m[0]).trim().replace(/^"|"$/g, '').toLowerCase();
			if (word)
				q.words.push(word);
		}
	}
	q.empty = !q.words.length && !q.fields.length && !q.is.length && !q.has.length && !q.after && !q.before;
	return q;
};
// Does a loaded message match? `item` is what the list holds: sender, email, to, subject, body, date, unread, starred.
totalmailquery.matches = function(q, item) {
	var has = (value, needle) =>
		String(value || '')
			.toLowerCase()
			.includes(needle);
	var everywhere = [item.sender, item.email, item.to, item.subject, item.body].join(' ').toLowerCase();
	if (!q.words.every((word) => everywhere.includes(word)))
		return false;
	for (var f of q.fields) {
		var source =
			f.key === 'from' ? [item.sender, item.email] : f.key === 'to' ? [item.to, (item.toRecipients || []).join(' ')] : [item[f.key]];
		if (!source.some((value) => has(value, f.value)))
			return false;
	}
	if (q.is.includes('unread') && !item.unread)
		return false;
	if (q.is.includes('read') && item.unread)
		return false;
	if (q.is.includes('starred') && !item.starred)
		return false;
	if (q.has.includes('attachment') && !(item.attachmentCount > 0 || (item.attachments || []).length))
		return false;
	// A date arrives as text from the server's files and as a Date from jComponent's own requests.
	var time = item.date ? new Date(item.date).getTime() : NaN;
	if (q.after && !(time >= Date.parse(q.after + 'T00:00:00Z')))
		return false;
	if (q.before && !(time < Date.parse(q.before + 'T00:00:00Z')))
		return false;
	return true;
};
// The same query as an ImapFlow search object. ImapFlow takes one of each key (one `or`, one `not`), so what cannot share the
// top level goes into a single `not` that negates an `or` of negations (De Morgan): NOT (NOT a OR NOT b) is a AND b.
// "Has an attachment" has no IMAP search key; a multipart/mixed message is the nearest thing.
totalmailquery.toImap = function(q) {
	var plain = {},
		groups = [];
	var put = (key, value) => (key in plain ? groups.push({ [key]: value }) : (plain[key] = value));
	for (var f of q.fields)
		put(f.key, f.value);
	for (var word of q.words)
		groups.push({ or: [{ subject: word }, { from: word }, { to: word }, { body: word }] });
	if (q.is.includes('unread'))
		plain.seen = false;
	if (q.is.includes('read'))
		plain.seen = true;
	if (q.is.includes('starred'))
		plain.flagged = true;
	if (q.has.includes('attachment'))
		plain.header = { 'content-type': 'multipart/mixed' };
	if (q.after)
		plain.since = new Date(q.after + 'T00:00:00Z');
	if (q.before)
		plain.before = new Date(q.before + 'T00:00:00Z');
	if (groups.length && groups[0].or && !plain.or)
		plain.or = groups.shift().or;
	if (groups.length) {
		var negated = groups.map((g) => ({ not: g }));
		plain.not = { or: negated.length > 1 ? negated : [negated[0], negated[0]] };
	}
	return plain;
};
if (typeof module !== 'undefined' && module.exports)
	module.exports = totalmailquery;
