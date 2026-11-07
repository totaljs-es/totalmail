// Groups messages into conversations from Message-ID, In-Reply-To and References, never across accounts.
// Pure on purpose: the browser and the tests use the same code.
function totalmailthreads(messages) {

	var parent = messages.map(function(_, i) { return i; });
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
		for (var list = [m.messageId, m.inReplyTo].concat(Array.from(m.references || [])), k = 0; k < list.length; k++) {
			var token = list[k];
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
	for (var arr = Array.from(groups), l = 0; l < arr.length; l++) {
		var root = arr[l][0],
			members = arr[l][1];
		// A date is text in the server's files and a Date once jComponent has parsed an answer: compare the moments.
		members.sort(function(x, y) { return (x.date ? new Date(x.date).getTime() || 0 : 0) - (y.date ? new Date(y.date).getTime() || 0 : 0); });
		for (var list = Array.from(members), k = 0; k < list.length; k++) {
			var m = list[k];
			threadof.set(m.id, root);
		}
	}
	return {
		// Every message of the conversation the given one belongs to, oldest first.
		members: function(id) { return groups.get(threadof.get(id)) || []; },
		key: function(id) { return threadof.get(id); }
	};
}

if (typeof module !== 'undefined' && module.exports)
	module.exports = totalmailthreads;
