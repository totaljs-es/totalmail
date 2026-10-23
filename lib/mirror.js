// How a store keeps its data: in memory, so that reading is immediate, and in the embedded NoSQL database of Total.js,
// which every change reaches through QueryBuilder as an insert, a modify or a remove of the records that differ.
//
// spec = {
//   table: (name) => NOSQL(name)     which database table to talk to (a test points it at a temporary folder)
//   prefix: 'users'                  table names are prefix_list
//   lists: ['users']                 arrays of records, each with a string `id`: one table per list
//   clean: true                      a record that was changed or removed is wiped from the file at once, not later
//   values: ['ai']                   anything else (objects, text, numbers): one record each in the table prefix_values
// }
// The database does not keep the order of the records, so each one carries a counter (_i) that is stripped when it is read;
// a list comes back in the order it was created. `sort` (optional, by list) gives a list another order.
// A store works on a copy of its state, calls save(next) and only then swaps the copy in, so a failed write changes nothing.
var tables = (spec, part) => spec.table(spec.prefix + '_' + part);

async function read(spec) {

	var state = {},
		found = false,
		orders = {};
	for (var list of spec.lists || []) {
		var rows = (await tables(spec, list).find().promise()).sort((a, b) => (a._i || 0) - (b._i || 0));
		orders[list] = new Map();
		for (var row of rows) {
			orders[list].set(row.id, row._i || 0);
			delete row._i;
		}
		state[list] = spec.sort && spec.sort[list] ? rows.sort(spec.sort[list]) : rows;
		found = found || rows.length > 0;
	}
	if ((spec.values || []).length) {
		var pairs = await tables(spec, 'values').find().promise();
		for (var key of spec.values) {
			var row = pairs.find((item) => item.id === key);
			if (row) {
				state[key] = row.value;
				found = true;
			}
		}
	}
	return { state, found, orders };
}

exports.create = function(spec, state, persisted = true, saved = {}) {

	var signatures = {},
		keys = {},
		values = {},
		counters = {},
		numbers = {};
	function remember(source) {
		for (var list of spec.lists || []) {
			signatures[list] = new Map();
			keys[list] = new Map();
			numbers[list] = new Map(saved[list] || []);
			counters[list] = [...numbers[list].values()].reduce((n, v) => Math.max(n, v), 0);
			for (var record of source[list] || []) {
				signatures[list].set(record.id, JSON.stringify(record));
				keys[list].set(record.id, Object.keys(record));
			}
		}
		for (var key of spec.values || [])
			values[key] = source[key] === undefined ? undefined : JSON.stringify(source[key]);
	}
	if (persisted)
		remember(state);
	else
		remember({});
	// What is really in the database, after a write that failed half way.
	async function resync() {

		var again = await read(spec);
		saved = again.orders;
		remember(again.state);
	}
	// The counter of a record: the one it has, or the next one for a record that is new.
	function number(list, id) {
		if (!numbers[list].has(id))
			numbers[list].set(id, ++counters[list]);
		return numbers[list].get(id);
	}
	async function save(next) {

		var inserts = [],
			modifies = [],
			removes = [],
			fresh = {},
			freshkeys = {},
			freshvalues = {};
		for (var list of spec.lists || []) {
			var table = tables(spec, list),
				seen = new Set();
			fresh[list] = new Map();
			freshkeys[list] = new Map();
			for (var record of next[list] || []) {
				if (typeof record.id !== 'string' || !record.id || seen.has(record.id))
					throw Error('Every record needs its own text id.');
				seen.add(record.id);
				var signature = JSON.stringify(record),
					names = Object.keys(record);
				fresh[list].set(record.id, signature);
				freshkeys[list].set(record.id, names);
				if (!signatures[list].has(record.id))
					inserts.push({ table, record: { ...record, _i: number(list, record.id) } });
				else if (signatures[list].get(record.id) !== signature)
					if (keys[list].get(record.id).every((name) => names.includes(name)))
						// A field that is gone from the record would stay in the database with a modify: that record is replaced.
						modifies.push({ table, record });
					else
						inserts.push({ table, record: { ...record, _i: number(list, record.id) }, replace: true });
			}
			for (var id of signatures[list].keys())
				if (!seen.has(id))
					removes.push({ table, id });
		}
		var valuetable = (spec.values || []).length ? tables(spec, 'values') : null;
		for (var key of spec.values || []) {
			var text = next[key] === undefined ? undefined : JSON.stringify(next[key]);
			freshvalues[key] = text;
			if (text !== values[key])
				if (values[key] === undefined)
					inserts.push({ table: valuetable, record: { id: key, value: next[key] } });
				else if (text === undefined)
					removes.push({ table: valuetable, id: key });
				else
					modifies.push({ table: valuetable, record: { id: key, value: next[key] } });
		}
		try {
			// Replaced records leave first, then everything new arrives, then what changed is updated, then what went is removed.
			var replaced = inserts.filter((item) => item.replace);
			for (var item of replaced)
				await item.table.remove().where('id', item.record.id).promise();
			await Promise.all(inserts.map((item) => item.table.insert(item.record).promise()));
			await Promise.all(modifies.map((item) => item.table.modify(item.record).where('id', item.record.id).promise()));
			await Promise.all(removes.map((item) => item.table.remove().where('id', item.id).promise()));
			if (spec.clean && (modifies.length || removes.length || replaced.length))
				await Promise.all(
					[...new Set([...modifies, ...removes, ...replaced].map((item) => item.table))].map((table) => table.clean().promise())
				);
		} catch (error) {
			await resync().catch(() => {});
			throw error;
		}
		for (var list of spec.lists || [])
			for (var id of [...numbers[list].keys()])
				if (!fresh[list].has(id))
					numbers[list].delete(id);
		signatures = fresh;
		keys = freshkeys;
		values = freshvalues;
	}
	// The database appends a change and marks the old line as removed; this makes the files hold only what is current.
	async function clean() {
		for (var list of spec.lists || [])
			await tables(spec, list).clean().promise();
		if ((spec.values || []).length)
			await tables(spec, 'values').clean().promise();
	}
	return { save, clean };
};

// Opens a store's data: what the database holds, or (the first time) what an earlier version kept in a JSON file, which is
// imported and set aside as <file>.migrated (never deleted), or the seed. Returns { state, mirror }.
exports.open = async function(spec, options = {}) {

	var loaded = await read(spec),
		state = loaded.state,
		imported = false;
	var defaults = options.seed || {},
		persisted = structuredClone(state);
	if (!loaded.found && options.legacy && Total.Fs.existsSync(options.legacy.file))
		try {
			state = JSON.parse(Total.Fs.readFileSync(options.legacy.file, 'utf8'));
			if (options.legacy.convert)
				state = options.legacy.convert(state);
			imported = true;
		} catch {
			state = {};
		}

	for (var list of spec.lists || [])
		if (!Array.isArray(state[list]))
			state[list] = structuredClone(defaults[list] || []);
	for (var key of spec.values || [])
		if (state[key] === undefined && defaults[key] !== undefined)
			state[key] = structuredClone(defaults[key]);
	// What is remembered as saved is what the database held, not what the seed filled in afterwards.
	var mirror = exports.create(spec, imported ? {} : persisted, true, loaded.orders);
	if (imported) {
		await mirror.save(state);
		Total.Fs.renameSync(options.legacy.file, options.legacy.file + '.migrated');
	}
	return { state, mirror };
};
