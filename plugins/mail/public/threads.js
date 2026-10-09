// Groups messages into conversations from Message-ID, In-Reply-To and References, never across accounts.
// Pure on purpose: the browser and the tests use the same code.
function totalmailthreads(messages) {
	var parent = messages.map((_, i) => i);
	function find(i) {
		while (parent[i] !== i) {
			parent[i] = parent[parent[i]];
			i = parent[i];
		}
		return i;
	}
	var owner = new Map();
	for (var i = 0; i < messages.length; i++) {
		var m = messages[i];
		for (var token of [m.messageId, m.inReplyTo, ...(m.references || [])]) {
			if (!token)
				continue;
			var key = m.accountId + '\0' + token;
			if (owner.has(key)) {
				var a = find(owner.get(key)),
					b = find(i);
				if (a !== b)
					parent[b] = a;
			} else
				owner.set(key, i);
		}
	}
	var groups = new Map(),
		threadof = new Map();
	for (var j = 0; j < messages.length; j++) {
		var root = find(j);
		if (!groups.has(root))
			groups.set(root, []);
		groups.get(root).push(messages[j]);
	}
	for (var [root, members] of groups) {
		// A date is text in the server's files and a Date once jComponent has parsed an answer: compare the moments.
		members.sort((x, y) => (x.date ? new Date(x.date).getTime() || 0 : 0) - (y.date ? new Date(y.date).getTime() || 0 : 0));
		for (var m of members)
			threadof.set(m.id, root);
	}
	return {
		// Every message of the conversation the given one belongs to, oldest first.
		members: (id) => groups.get(threadof.get(id)) || [],
		key: (id) => threadof.get(id)
	};
}
if (typeof module !== 'undefined' && module.exports)
	module.exports = totalmailthreads;
