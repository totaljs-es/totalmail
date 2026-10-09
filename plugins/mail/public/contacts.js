// Address suggestions built from the mail already on screen: people who wrote to you and people you wrote to.
// Pure on purpose: the browser and the tests use the same code. Nothing is stored or sent anywhere.
function totalmailcontacts(messages, own) {
	var mine = new Set((own || []).map((e) => String(e).toLowerCase())),
		found = new Map();
	var valid = /^[^@\s,;<>"]+@[^@\s,;<>"]+\.[^@\s,;<>"]+$/;
	function add(address, name, date, weight) {
		var email = String(address || '')
			.trim()
			.toLowerCase();
		if (!valid.test(email) || mine.has(email))
			return;
		var item = found.get(email) || { email, name: '', count: 0, last: 0 };
		item.count += weight;
		name = String(name || '').trim();
		if (name && !name.includes('@') && !item.name)
			item.name = name.slice(0, 80);
		// The moment, as a number: a date is text in the server's files and a Date once jComponent has parsed an answer.
		var moment = date ? new Date(date).getTime() || 0 : 0;
		if (moment > item.last)
			item.last = moment;
		found.set(email, item);
	}
	// People you write to count more than people who wrote to you.
	for (var m of messages)
		if (m.outgoing) {
			for (var to of String(m.to || '').split(/[,;]/))
				add(to, '', m.date, 3);
			for (var cc of String(m.cc || '').split(/[,;]/))
				add(cc, '', m.date, 2);
		} else {
			add(m.email, m.sender, m.date, 1);
			for (var other of [...(m.toRecipients || []), ...(m.ccRecipients || [])])
				add(other, '', m.date, 1);
		}

	return [...found.values()].sort((a, b) => b.count - a.count || b.last - a.last);
}
// Suggestions for the text being typed: the start of a name or address first, then any part of them.
totalmailcontacts.match = function(list, token, limit) {
	token = String(token || '')
		.trim()
		.toLowerCase();
	if (token.length < 2)
		return [];
	var rank = (c) =>
		c.email.startsWith(token) ||
		c.name.toLowerCase().startsWith(token) ||
		c.name
			.toLowerCase()
			.split(/\s+/)
			.some((w) => w.startsWith(token))
			? 0
			: 1;
	return list
		.filter((c) => c.email.includes(token) || c.name.toLowerCase().includes(token))
		.map((c, i) => ({ c, i }))
		.sort((a, b) => rank(a.c) - rank(b.c) || a.i - b.i)
		.map((x) => x.c)
		.slice(0, limit || 6);
};
if (typeof module !== 'undefined' && module.exports)
	module.exports = totalmailcontacts;
