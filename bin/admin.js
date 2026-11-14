#!/usr/bin/env node
// Getting back in when the way in is lost, from the server itself (anyone who can run this can already read `database/`).
//
//   node bin/admin.js list
//   node bin/admin.js reset-password ana@example.com     asks for the new password (or TOTALMAIL_NEW_PASSWORD)
//   node bin/admin.js remove-two-step ana@example.com    forgets her authenticator app and recovery codes
//
// Stop TotalMail first and start it again afterwards: the running process keeps its own copy of the people in memory and
// would write that copy back over this change. `--database <folder>` points at another data folder (default: ./database).
require('total5');

var Store = require('../plugins/users/identities'),
	Tables = require('../modules/tables');

async function ask(text) {

	if (process.env.TOTALMAIL_NEW_PASSWORD)
		return process.env.TOTALMAIL_NEW_PASSWORD;
	if (!process.stdin.isTTY)
		throw Error('Run this in a terminal, or set TOTALMAIL_NEW_PASSWORD.');
	var rl = Total.require('readline').createInterface({ input: process.stdin, output: process.stdout, terminal: true });
	rl._writeToOutput = function(value) { return value.includes(text) ? process.stdout.write(value) : process.stdout.write(''); };
	return new Promise(function(resolve) { return rl.question(text, function(answer) { return rl.close(), process.stdout.write('\n'), resolve(answer); }); });
}

exports.main = async function(argv, out = function(line) { return console.log(line); }) {

	var args = Array.from(argv),
		index = args.indexOf('--database'),
		directory = Total.Path.resolve(__dirname, '../database');
	if (index >= 0) {
		directory = Total.Path.resolve(args[index + 1] || '');
		args.splice(index, 2);
	}
	var tmp = args;
	var command = tmp[0], email = tmp[1];
	var table = Tables.in(directory);
	// The people live in the database (or, before the first start of a newer version, in users.json).
	if (!Total.Fs.existsSync(Total.Path.join(directory, 'users.json')) && !Total.Fs.existsSync(Total.Path.join(directory, 'users_users')))
		throw Error('No users found in ' + directory);
	var store = await Store.open({ directory, table, legacy: { file: Total.Path.join(directory, 'users.json') } }),
		users = store.list();
	// A password reset or a removed code should end the sessions that were opened before: they are forgotten here.
	var signout = function() {
		return Promise.all([
			table('sessions_sessions').remove().where('id', '!=', '').promise(),
			table('devices_devices').remove().where('id', '!=', '').promise()
		]);
	};
	if (command === 'list') {
		for (var arr = Array.from(users), i = 0; i < arr.length; i++) {
			var u = arr[i];
			out([u.email, u.role, u.disabled ? 'disabled' : '', u.totp ? 'two-step' : ''].filter(Boolean).join('  '));
		}
		return;
	}
	var user = users.find(
		function(u) {
			return u.email ===
				String(email || '')
					.trim()
					.toLowerCase();
		}
	);
	if (!['reset-password', 'remove-two-step'].includes(command))
		throw Error('Commands: list, reset-password <email>, remove-two-step <email>');
	if (!user)
		throw Error('No user with that email. Try: node bin/admin.js list');
	if (command === 'reset-password') {
		var password = await ask('New password for ' + user.email + ' (12 to 128 characters): ');
		await store.setPassword(user.id, password);
		await signout();
		out('Password changed for ' + user.email + '. Everyone is signed out. Start TotalMail again.');
	} else {
		await store.disableTotp(user.id);
		await signout();
		out('Two-step verification removed for ' + user.email + '. Start TotalMail again.');
	}
};

if (require.main === module)
	// The database keeps the process alive, so it ends when the command is done.
	exports.main(process.argv.slice(2)).then(
		function() { return process.exit(0); },
		function(error) {
			console.error(error.message.replace(/^@\(|\)$/g, ''));
			process.exit(1);
		}
	);
