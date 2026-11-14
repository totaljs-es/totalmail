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
var tables = function(spec, part) { return spec.table(spec.prefix + '_' + part); };

async function read(spec) {

	var state = {},
		found = false,
		orders = {};
	for (var items = Array.from(spec.lists || []), j = 0; j < items.length; j++) {
		var list = items[j];
		var rows = (await tables(spec, list).find().promise()).sort(function(a, b) { return (a._i || 0) - (b._i || 0); });
		orders[list] = new Map();
		for (var arr = Array.from(rows), i = 0; i < arr.length; i++) {
			var row = arr[i];
			orders[list].set(row.id, row._i || 0);
			delete row._i;
		}
		state[list] = spec.sort && spec.sort[list] ? rows.sort(spec.sort[list]) : rows;
		found = found || rows.length > 0;
	}
	if ((spec.values || []).length) {
		var pairs = await tables(spec, 'values').find().promise();
		for (var arr = Array.from(spec.values), i = 0; i < arr.length; i++) {
			var key = arr[i];
			var row = pairs.find(function(item) { return item.id === key; });
			if (row) {
				state[key] = row.value;
				found = true;
			}
		}
	}
	return { state, found, orders };
}

// Runs one operation after the other: what a store does to its state never overlaps with another change in flight.
// An operation that fails does not stop the ones behind it.
exports.serial = function() {

	var queue = Promise.resolve();
	return function(operation) {

		var result = queue.then(operation);
		queue = result.catch(function() {});
		return result;
	};
};

// The way every store changes: update(mutate) applies `mutate` to a copy of the state, writes the copy to the database and only then
// makes it the current state, so a write that fails changes nothing. The value that `mutate` returns is handed back as a copy.
// read() gives the current state and write(next) replaces it. hooks.before(next) runs after the mutation and before the write,
// hooks.after(next) after the write and before the swap, hooks.swapped() once the state is the new one.
exports.writer = function(storage, read, write, hooks) {

	hooks = hooks || {};
	var serial = exports.serial();
	return function(mutate) {
		return serial(async function() {

			var next = structuredClone(read());
			var value = mutate(next);
			if (hooks.before)
				hooks.before(next);
			await storage.mirror.save(next);
			if (hooks.after)
				hooks.after(next);
			write(next);
			if (hooks.swapped)
				hooks.swapped();
			return structuredClone(value);
		});
	};
};

exports.create = function(spec, state, persisted = true, saved = {}) {

	var signatures = {},
		keys = {},
		values = {},
		counters = {},
		numbers = {};
	function remember(source) {
		for (var items = Array.from(spec.lists || []), j = 0; j < items.length; j++) {
			var list = items[j];
			signatures[list] = new Map();
			keys[list] = new Map();
			numbers[list] = new Map(saved[list] || []);
			counters[list] = Array.from(numbers[list].values()).reduce(function(n, v) { return Math.max(n, v); }, 0);
			for (var arr = Array.from(source[list] || []), i = 0; i < arr.length; i++) {
				var record = arr[i];
				signatures[list].set(record.id, JSON.stringify(record));
				keys[list].set(record.id, Object.keys(record));
			}
		}
		for (var arr = Array.from(spec.values || []), i = 0; i < arr.length; i++) {
			var key = arr[i];
			values[key] = source[key] === undefined ? undefined : JSON.stringify(source[key]);
		}
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
		for (var items = Array.from(spec.lists || []), j = 0; j < items.length; j++) {
			var list = items[j];
			var table = tables(spec, list),
				seen = new Set();
			fresh[list] = new Map();
			freshkeys[list] = new Map();
			for (var arr = Array.from(next[list] || []), i = 0; i < arr.length; i++) {
				var record = arr[i];
				if (typeof record.id !== 'string' || !record.id || seen.has(record.id))
					throw Error('Every record needs its own text id.');
				seen.add(record.id);
				var signature = JSON.stringify(record),
					names = Object.keys(record);
				fresh[list].set(record.id, signature);
				freshkeys[list].set(record.id, names);
				if (!signatures[list].has(record.id))
					inserts.push({ table, record: Object.assign({}, record, { _i: number(list, record.id) }) });
				else if (signatures[list].get(record.id) !== signature)
					if (keys[list].get(record.id).every(function(name) { return names.includes(name); }))
						// A field that is gone from the record would stay in the database with a modify: that record is replaced.
						modifies.push({ table, record });
					else
						inserts.push({ table, record: Object.assign({}, record, { _i: number(list, record.id) }), replace: true });
			}
			for (var arr = Array.from(signatures[list].keys()), i = 0; i < arr.length; i++) {
				var id = arr[i];
				if (!seen.has(id))
					removes.push({ table, id });
			}
		}
		var valuetable = (spec.values || []).length ? tables(spec, 'values') : null;
		for (var arr = Array.from(spec.values || []), i = 0; i < arr.length; i++) {
			var key = arr[i];
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
			var replaced = inserts.filter(function(item) { return item.replace; });
			for (var arr = Array.from(replaced), i = 0; i < arr.length; i++) {
				var item = arr[i];
				await item.table.remove().where('id', item.record.id).promise();
			}
			await Promise.all(inserts.map(function(item) { return item.table.insert(item.record).promise(); }));
			await Promise.all(modifies.map(function(item) { return item.table.modify(item.record).where('id', item.record.id).promise(); }));
			await Promise.all(removes.map(function(item) { return item.table.remove().where('id', item.id).promise(); }));
			if (spec.clean && (modifies.length || removes.length || replaced.length))
				await Promise.all(
					Array.from(new Set(Array.from(modifies).concat(Array.from(removes), Array.from(replaced)).map(function(item) { return item.table; }))).map(function(table) { return table.clean().promise(); })
				);
		} catch (error) {
			await resync().catch(function() {});
			throw error;
		}
		for (var items = Array.from(spec.lists || []), j = 0; j < items.length; j++) {
			var list = items[j];
			for (var arr = Array.from(numbers[list].keys()), i = 0; i < arr.length; i++) {
				var id = arr[i];
				if (!fresh[list].has(id))
					numbers[list].delete(id);
			}
		}
		signatures = fresh;
		keys = freshkeys;
		values = freshvalues;
	}
	// The database appends a change and marks the old line as removed; this makes the files hold only what is current.
	async function clean() {
		for (var arr = Array.from(spec.lists || []), i = 0; i < arr.length; i++) {
			var list = arr[i];
			await tables(spec, list).clean().promise();
		}
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

	for (var arr = Array.from(spec.lists || []), i = 0; i < arr.length; i++) {
		var list = arr[i];
		if (!Array.isArray(state[list]))
			state[list] = structuredClone(defaults[list] || []);
	}
	for (var arr = Array.from(spec.values || []), i = 0; i < arr.length; i++) {
		var key = arr[i];
		if (state[key] === undefined && defaults[key] !== undefined)
			state[key] = structuredClone(defaults[key]);
	}
	// What is remembered as saved is what the database held, not what the seed filled in afterwards.
	var mirror = exports.create(spec, imported ? {} : persisted, true, loaded.orders);
	if (imported) {
		await mirror.save(state);
		Total.Fs.renameSync(options.legacy.file, options.legacy.file + '.migrated');
	}
	return { state, mirror };
};
