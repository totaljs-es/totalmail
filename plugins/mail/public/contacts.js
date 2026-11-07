// Address suggestions built from the mail already on screen: people who wrote to you and people you wrote to.
// Pure on purpose: the browser and the tests use the same code. Nothing is stored or sent anywhere.
function totalmailcontacts(messages, own) {

	var mine = new Set((own || []).map(function(e) { return String(e).toLowerCase(); })),
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
	for (var arr = Array.from(messages), j = 0; j < arr.length; j++) {
		var m = arr[j];
		if (m.outgoing) {
			for (var list = String(m.to || '').split(/[,;]/), i = 0; i < list.length; i++) {
				var to = list[i];
				add(to, '', m.date, 3);
			}
			for (var list = String(m.cc || '').split(/[,;]/), i = 0; i < list.length; i++) {
				var cc = list[i];
				add(cc, '', m.date, 2);
			}
		} else {
			add(m.email, m.sender, m.date, 1);
			for (var list = Array.from(m.toRecipients || []).concat(Array.from(m.ccRecipients || [])), i = 0; i < list.length; i++) {
				var other = list[i];
				add(other, '', m.date, 1);
			}
		}
	}

	return Array.from(found.values()).sort(function(a, b) { return b.count - a.count || b.last - a.last; });
}

// Suggestions for the text being typed: the start of a name or address first, then any part of them.
totalmailcontacts.match = function(list, token, limit) {

	token = String(token || '')
		.trim()
		.toLowerCase();
	if (token.length < 2)
		return [];
	var rank = function(c) {
		return c.email.startsWith(token) ||
			c.name.toLowerCase().startsWith(token) ||
			c.name
				.toLowerCase()
				.split(/\s+/)
				.some(function(w) { return w.startsWith(token); })
			? 0
			: 1;
	};
	return list
		.filter(function(c) { return c.email.includes(token) || c.name.toLowerCase().includes(token); })
		.map(function(c, i) { return { c, i }; })
		.sort(function(a, b) { return rank(a.c) - rank(b.c) || a.i - b.i; })
		.map(function(x) { return x.c; })
		.slice(0, limit || 6);
};

if (typeof module !== 'undefined' && module.exports)
	module.exports = totalmailcontacts;
