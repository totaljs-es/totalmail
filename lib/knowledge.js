// The knowledge base of the installation: documents the administrator adds (Word, PDF, Excel, text...) so the assistant
// can draft a reply from them. Everything is internal to TotalMail: a JSON file next to the other data, no other service.
//
// Search is by words (BM25) over chunks of about 900 characters: no model, works offline, finds exact terms and names.
// A collection can be marked local only: then it is never read when the model that will see the passages is outside the
// organization's network.
const Mirror = require('./mirror');
var K1 = 1.2,
	B = 0.75,
	TARGET = 900,
	OVERLAP = 120;
exports.limits = { collections: 30, documents: 300, characters: 3000000, results: 6 };
function failure(message) {
	return Error(message);
}
// Words without accents and without a final plural s, so "propuestas" finds "propuesta".
function tokens(text) {
	var words =
		String(text || '')
			.toLowerCase()
			.normalize('NFD')
			.replace(/[̀-ͯ]/g, '')
			.match(/[\p{L}\p{N}]{2,}/gu) || [];
	return words.map((word) => (word.length > 3 && word.endsWith('s') ? word.slice(0, -1) : word));
}
exports.tokens = tokens;
// Splits a text into chunks of about 900 characters along paragraphs, remembering the last Markdown heading.
function chunks(text) {
	text = String(text || '')
		.replace(/\r\n/g, '\n')
		.trim();
	var out = [],
		cur = '',
		section = '',
		started = '';
	function flush() {
		if (cur.trim())
			out.push({ text: cur.trim(), section: started });
		cur = '';
	}
	for (var block of text.split(/\n{2,}/)) {
		block = block.trim();
		if (!block)
			continue;
		var heading = block.match(/^#{1,6}\s+(.+)$/m);
		if (heading && /^#{1,6}\s/.test(block)) {
			section = heading[1].trim();
			// A new heading starts a new chunk, so the section of a chunk is the one it talks about.
			if (cur.length > 250 || /^(Page|Slide|Sheet) \d+$/.test(section))
				flush();
		}
		// A very long block is cut in windows with a small overlap.
		while (block.length > TARGET * 1.6) {
			flush();
			var cut = block.lastIndexOf('. ', TARGET);
			cut = cut > TARGET / 2 ? cut + 1 : TARGET;
			started = section;
			cur = block.substring(0, cut);
			flush();
			block = block.substring(Math.max(0, cut - OVERLAP)).trim();
		}
		if (cur && cur.length + block.length > TARGET) {
			var tail = cur.length > OVERLAP ? cur.substring(cur.length - OVERLAP) : '';
			flush();
			cur = tail ? '... ' + tail + '\n\n' : '';
		}
		if (!cur.replace(/\.\.\. /, '').trim())
			started = section;
		cur += (cur ? '\n\n' : '') + block;
	}
	flush();
	return out;
}
exports.chunks = chunks;
function build(docs) {
	var index = { chunks: [], df: new Map(), avgdl: 0 },
		total = 0;
	for (var doc of docs)
		for (var item of doc.chunks) {
			var tf = new Map(),
				words = tokens(item.section + ' ' + doc.title + ' ' + item.text);
			for (var word of words)
				tf.set(word, (tf.get(word) || 0) + 1);
			for (var key of tf.keys())
				index.df.set(key, (index.df.get(key) || 0) + 1);
			index.chunks.push({ doc, item, tf, len: words.length });
			total += words.length;
		}
	index.avgdl = total / (index.chunks.length || 1);
	return index;
}
function rank(index, words) {
	var n = index.chunks.length,
		scores = [];
	for (var c of index.chunks) {
		var score = 0;
		for (var word of words) {
			var f = c.tf.get(word);
			if (!f)
				continue;
			var df = index.df.get(word);
			score += (Math.log(1 + (n - df + 0.5) / (df + 0.5)) * (f * (K1 + 1))) / (f + K1 * (1 - B + (B * c.len) / index.avgdl));
		}
		if (score > 0)
			scores.push({ c, score });
	}
	return scores.sort((a, b) => b.score - a.score);
}
exports.spec = (table) => ({ table, prefix: 'knowledge', lists: ['collections', 'docs'] });
// The store, opened on a database: options = { table, legacy: { file } } (the file an earlier version kept).
exports.open = async function(options) {
	return exports.create(await Mirror.open(exports.spec(options.table), { legacy: options.legacy }));
};
// storage = { state, mirror } as Mirror.open() returns it.
exports.create = function(storage) {
	var state = { collections: [], docs: [], ...structuredClone(storage.state) };
	var queue = Promise.resolve(),
		indexes = new Map();
	function update(mutate) {
		var result = queue.then(async () => {
			var next = structuredClone(state);
			var value = mutate(next);
			await storage.mirror.save(next);
			state = next;
			indexes.clear();
			return structuredClone(value);
		});
		queue = result.catch(() => {});
		return result;
	}
	function indexof(id) {
		if (!indexes.has(id))
			indexes.set(id, build(state.docs.filter((d) => d.collectionid === id)));
		return indexes.get(id);
	}
	return {
		// What the administrator sees: collections with their documents, never the text.
		view: () => ({
			collections: state.collections.map((c) => ({
				id: c.id,
				name: c.name,
				description: c.description || '',
				localonly: c.localonly === true,
				documents: state.docs
					.filter((d) => d.collectionid === c.id)
					.map((d) => ({ id: d.id, title: d.title, size: d.size, chunks: d.chunks.length, added: d.added }))
			}))
		}),
		has: () => state.docs.length > 0,
		saveCollection: ({ id = '', name, description = '', localonly = false }) =>
			update((next) => {
				name = String(name || '')
					.trim()
					.slice(0, 80);
				if (!name)
					throw failure('@(Give the collection a name.)');
				if (next.collections.some((c) => c.id !== id && c.name.toLowerCase() === name.toLowerCase()))
					throw failure('@(A collection with this name already exists.)');
				var item = next.collections.find((c) => c.id === id);
				if (id && !item)
					throw failure('@(Collection not found.)');
				if (!item) {
					if (next.collections.length >= exports.limits.collections)
						throw failure('@(There are too many collections.)');
					item = { id: UID(), created: new Date().toISOString() };
					next.collections.push(item);
				}
				Object.assign(item, { name, description: String(description).trim().slice(0, 200), localonly: localonly === true });
				return { id: item.id };
			}),
		removeCollection: (id) =>
			update((next) => {
				if (!next.collections.some((c) => c.id === id))
					throw failure('@(Collection not found.)');
				next.collections = next.collections.filter((c) => c.id !== id);
				next.docs = next.docs.filter((d) => d.collectionid !== id);
				return {};
			}),
		addDocument: (collectionid, title, text) =>
			update((next) => {
				if (!next.collections.some((c) => c.id === collectionid))
					throw failure('@(Collection not found.)');
				text = String(text || '');
				if (text.length > exports.limits.characters)
					throw failure('@(This document is too long to add.)');
				var list = chunks(text);
				if (!list.length)
					throw failure('@(The document has no text.)');
				if (next.docs.length >= exports.limits.documents)
					throw failure('@(There are too many documents.)');
				var doc = {
					id: UID(),
					collectionid,
					title: String(title || 'Untitled').slice(0, 200),
					size: text.length,
					added: new Date().toISOString(),
					chunks: list
				};
				next.docs.push(doc);
				return { id: doc.id, title: doc.title, chunks: list.length };
			}),
		removeDocument: (id) =>
			update((next) => {
				if (!next.docs.some((d) => d.id === id))
					throw failure('@(Document not found.)');
				next.docs = next.docs.filter((d) => d.id !== id);
				return {};
			}),
		// The passages that best match a text. `external` is true when the model that will read them is outside the network:
		// local-only collections are then left out and their names come back in `skipped`.
		search(query, { external = false, limit = 4 } = {}) {
			var words = tokens(query),
				pool = [],
				skipped = [];
			limit = Math.min(Math.max(+limit || 4, 1), exports.limits.results);
			for (var collection of state.collections) {
				if (collection.localonly && external) {
					skipped.push(collection.name);
					continue;
				}
				for (var hit of rank(indexof(collection.id), words).slice(0, 30))
					pool.push({
						collection: collection.name,
						title: hit.c.doc.title,
						section: hit.c.item.section,
						text: hit.c.item.text,
						score: hit.score
					});
			}
			pool.sort((a, b) => b.score - a.score);
			return {
				results: pool
					.slice(0, limit)
					.map((r) => ({ collection: r.collection, document: r.title, section: r.section, text: r.text.slice(0, 1400) })),
				skipped
			};
		}
	};
};
// What the model reads: numbered passages that cannot close their wrapper.
exports.block = function(passages, wrap) {
	return passages
		.map((p, i) => '[' + (i + 1) + '] ' + wrap([p.document, p.section].filter(Boolean).join(' — ')) + '\n' + wrap(p.text))
		.join('\n\n');
};
// The query: what the last message says, without quoted replies.
exports.query = function(subject, body) {
	var text = String(body || '')
		.split('\n')
		.filter((line) => !/^\s*>/.test(line))
		.join(' ')
		.replace(/\s+/g, ' ')
		.trim();
	return (String(subject || '').replace(/^(re|fwd?)\s*:\s*/gi, '') + '. ' + text).slice(0, 600);
};
