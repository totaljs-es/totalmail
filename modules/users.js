// The mailbox of each person, in the database and in memory: used as MODS.users.forUser(user). Everyone who exists is loaded when
// the module is installed; a person who is added later starts with an empty mailbox.
const Mailbox = require('../lib/store'),
	Mirror = require('../lib/mirror'),
	Tables = require('../lib/tables').in(PATH.root('database')),
	Files = require('../lib/files');

var stores = new Map(),
	database = PATH.root('database'),
	files = Files.create(Total.Path.join(database, 'attachments'));

const REG_ID = /^[a-f0-9]{32}$/;

var valid = (id) => REG_ID.test(id || '');

exports.install = function() {

	PAUSESERVER('users', true);
	var loading = MODS.security.ready
		.then(() =>
			Promise.all(
				MODS.security.identities.list().map(async (user) => {
					var mailbox = await Mailbox.open({
						table: Tables,
						id: user.id,
						legacy: { file: Total.Path.join(database, 'mail-' + user.id + '.json') }
					});
					stores.set(user.id, mailbox);
				})
			)
		)
		.then(() => PAUSESERVER('users', false));
	loading.catch((error) => Total.error(error, 'TotalMail mailboxes'));
	// Changed and removed messages are wiped from the files every six hours (the service runs every minute).
	ON('service', (minutes) => {
		if (minutes % 360 === 0)
			for (var store of stores.values())
				store.clean().catch((error) => Total.error(error, 'TotalMail mailbox clean'));
	});
};

exports.forUser = function(user) {

	if (!user || !valid(user.id))
		throw Error('Authentication required');
	let store = stores.get(user.id);
	if (store)
		return store;
	// Nobody has written to this mailbox yet, so nothing is in the database; a file an earlier version left is imported.
	let state = { accounts: [], messages: [], drafts: [] },
		file = Total.Path.join(database, 'mail-' + user.id + '.json'),
		imported = Promise.resolve();
	let mirror = Mirror.create(Mailbox.spec(Tables, user.id), state, false);
	if (Total.Fs.existsSync(file))
		try {
			Object.assign(state, JSON.parse(Total.Fs.readFileSync(file, 'utf8')));
			imported = mirror.save(state).then(() => Total.Fs.renameSync(file, file + '.migrated'));
			imported.catch((error) => Total.error(error, 'TotalMail mailbox import'));
		} catch {}
	// Nothing is written until the import has finished.
	store = Mailbox.create({
		state,
		mirror: { save: (next) => imported.then(() => mirror.save(next)), clean: () => imported.then(() => mirror.clean()) }
	});
	stores.set(user.id, store);
	return store;
};

// Removes everything a deleted user owned: mailbox data, outgoing attachments and the in-memory store.
exports.drop = async function(userid) {

	if (!valid(userid))
		throw Error('Authentication required');
	stores.delete(userid);
	var spec = Mailbox.spec(Tables, userid);
	for (var list of spec.lists)
		await spec
			.table(spec.prefix + '_' + list)
			.clear()
			.promise();
	await Total.Fs.promises.rm(Total.Path.join(database, 'mail-' + userid + '.json'), { force: true });
	await Total.Fs.promises.rm(Total.Path.join(database, 'mail-' + userid + '.json.migrated'), { force: true });
	await Total.Fs.promises.rm(Total.Path.join(database, 'attachments', userid), { recursive: true, force: true });
};

exports.files = function(user) {
	if (!user || !REG_ID.test(user.id))
		throw Error('Authentication required');
	return files;
};
