// Where a test keeps its database: a temporary folder, through the same NOSQL() the application uses.
const Fs = require('node:fs'),
	Path = require('node:path');
exports.table = require('../lib/tables').in;
// A mailbox store (the id is any name) that starts with `seed` and writes to the tables of `dir`. `name` makes it a different
// mailbox of the same folder; reopen() gives what a restart would find.
exports.store = function(dir, seed, name = 'test') {
	var Mailbox = require('../lib/store'),
		Mirror = require('../lib/mirror');
	let spec = Mailbox.spec(exports.table(dir), name),
		state = { accounts: [], messages: [], drafts: [], ...structuredClone(seed) };
	return Mailbox.create({ state, mirror: Mirror.create(spec, state, false) });
};
exports.reopen = (dir, name = 'test') => require('../lib/store').open({ table: exports.table(dir), id: name });
// What a table file holds, as text.
exports.raw = (dir, name) => Fs.readFileSync(Path.join(dir, name), 'utf8');
// The records a table file holds now (lines the database marked as removed or replaced are not counted), without their counter.
exports.rows = (dir, name) =>
	Fs.existsSync(Path.join(dir, name))
		? exports
			.raw(dir, name)
			.split('\n')
			.filter((line) => line.startsWith('{'))
			.map((line) => {
				let { _i, ...rest } = JSON.parse(line);
				return rest;
			})
		: [];
// The key-holding part of the accounts store, for a test that must decrypt what the application encrypted.
exports.keys = (dir) => require('../lib/identities').create(dir, { state: { users: [] }, mirror: { save: async () => {} } });
// A mailbox store whose database refuses every write, to see that a failed write changes nothing.
exports.failing = (seed) =>
	require('../lib/store').create({
		state: { accounts: [], messages: [], drafts: [], ...structuredClone(seed) },
		mirror: {
			save: async () => {
				throw new Error('disk unavailable');
			},
			clean: async () => {}
		}
	});
// The accounts store of a folder. With `flag`, its writes fail while flag.blocked is true.
exports.identities = async function(dir, flag) {
	var Identities = require('../lib/identities'),
		Mirror = require('../lib/mirror');
	let storage = await Mirror.open(Identities.spec(exports.table(dir)), { seed: { users: [] } }),
		real = storage.mirror;
	if (flag)
		storage.mirror = {
			save: (next) => (flag.blocked ? Promise.reject(new Error('Disk unavailable')) : real.save(next)),
			clean: real.clean
		};
	return Identities.create(dir, storage);
};
