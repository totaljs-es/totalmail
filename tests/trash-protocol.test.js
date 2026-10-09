require('total5');
const { test } = require('node:test');
const Assert = require('node:assert/strict');
const Tls = require('node:tls'),
	Fs = require('node:fs'),
	Os = require('node:os'),
	Path = require('node:path');
const { execFileSync } = require('node:child_process');
const { ImapFlow } = require('imapflow');
const Imap = require('../lib/imap');

// A server with INBOX and Trash. Trash holds UIDs 5, 6 and 7; `uidplus` switches the capability on or off.
function build(t, { uidplus = true } = {}) {
	return new Promise((resolve) => {
		var dir = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'tm-trash-'));
		execFileSync(
			'openssl',
			[
				'req',
				'-x509',
				'-newkey',
				'rsa:2048',
				'-nodes',
				'-keyout',
				dir + '/key',
				'-out',
				dir + '/cert',
				'-days',
				'1',
				'-subj',
				'/CN=localhost',
				'-addext',
				'subjectAltName=DNS:localhost'
			],
			{ stdio: 'ignore' }
		);
		var cert = Fs.readFileSync(dir + '/cert'),
			commands = [],
			sockets = new Set();
		var boxes = { INBOX: new Set([1, 2]), Trash: new Set([5, 6, 7]) },
			flagged = new Set();
		var server = Tls.createServer({ cert, key: Fs.readFileSync(dir + '/key') }, (socket) => {
			sockets.add(socket);
			socket.on('error', () => {});
			var buffer = '',
				authTag = '',
				current = 'INBOX';
			var expunge = (path, uids) => {
				for (var u of uids)
					if (boxes[path].has(u))
						boxes[path].delete(u);
			};
			socket.write('* OK Fixture IMAP\r\n');
			socket.on('data', (chunk) => {
				buffer += chunk;
				var i;
				while ((i = buffer.indexOf('\r\n')) >= 0) {
					var line = buffer.slice(0, i);
					buffer = buffer.slice(i + 2);
					if (authTag) {
						socket.write(authTag + ' OK authenticated\r\n');
						authTag = '';
						continue;
					}
					commands.push(line);
					var [tag, verb, sub, set] = line.split(' ');
					var uids = (s) => (s === '1:*' ? [...boxes[current]] : String(s).split(',').map(Number));
					if (verb === 'CAPABILITY')
						socket.write(
							'* CAPABILITY IMAP4rev1 AUTH=PLAIN' + (uidplus ? ' UIDPLUS' : '') + '\r\n' + tag + ' OK capabilities\r\n'
						);
					else if (verb === 'AUTHENTICATE') {
						authTag = tag;
						socket.write('+ \r\n');
					} else if (verb === 'LIST' && /LIST "" ""$/.test(line))
						socket.write('* LIST (\\Noselect) "/" ""\r\n' + tag + ' OK listed\r\n');
					else if (verb === 'LIST')
						socket.write(
							'* LIST (\\HasNoChildren) "/" "INBOX"\r\n* LIST (\\HasNoChildren \\Trash) "/" "Trash"\r\n' +
								tag +
								' OK listed\r\n'
						);
					else if (verb === 'SELECT' || verb === 'EXAMINE') {
						current = /Trash/.test(line) ? 'Trash' : 'INBOX';
						socket.write(
							'* FLAGS (\\Seen \\Deleted)\r\n* ' +
								boxes[current].size +
								' EXISTS\r\n* OK [UIDVALIDITY 9] v\r\n' +
								tag +
								' OK [' +
								(verb === 'SELECT' ? 'READ-WRITE' : 'READ-ONLY') +
								'] opened\r\n'
						);
					} else if (verb === 'UID' && sub === 'FETCH') {
						for (var u of uids(set))
							if (boxes[current].has(u))
								socket.write('* 1 FETCH (UID ' + u + ')\r\n');
						socket.write(tag + ' OK fetched\r\n');
					} else if (verb === 'UID' && sub === 'SEARCH')
						socket.write('* SEARCH ' + [...boxes[current]].join(' ') + '\r\n' + tag + ' OK searched\r\n');
					else if (verb === 'UID' && sub === 'STORE') {
						for (var s of uids(set))
							flagged.add(current + s);
						socket.write(tag + ' OK stored\r\n');
					} else if (verb === 'UID' && sub === 'EXPUNGE') {
						expunge(
							current,
							uids(set).filter((x) => flagged.has(current + x))
						);
						socket.write(tag + ' OK expunged\r\n');
					} else if (verb === 'EXPUNGE') {
						expunge(
							current,
							[...boxes[current]].filter((x) => flagged.has(current + x))
						);
						socket.write(tag + ' OK expunged\r\n');
					} else if (verb === 'LOGOUT')
						socket.end('* BYE\r\n' + tag + ' OK bye\r\n');
					else
						socket.write(tag + ' OK done\r\n');
				}
			});
		});
		server.listen(0, '127.0.0.1', () => {
			t.after(async () => {
				for (var s of sockets)
					s.destroy();
				await new Promise((r) => server.close(r));
				Fs.rmSync(dir, { recursive: true, force: true });
			});
			resolve({
				boxes,
				commands,
				engine: Imap.create((options) => new ImapFlow({ ...options, tls: { ...options.tls, ca: cert.toString() } })),
				account: { id: 'a', imap: { port: server.address().port, security: 'tls', username: 'fixture' } },
				target: { address: '127.0.0.1', servername: 'localhost' }
			});
		});
	});
}
const message = (uid, path = 'Trash') => ({ id: 'imap-' + uid, accountId: 'a', mailboxPath: path, uidValidity: '9', uid });

test(
	'permanent deletion removes exactly the chosen message of the trash with UID EXPUNGE and confirms it',
	{ timeout: 30000 },
	async (t) => {
		var f = await build(t);
		await f.engine.erase(f.account, 'x', f.target, message(6));
		Assert.deepEqual([...f.boxes.Trash], [5, 7], 'only the chosen message is gone');
		Assert.deepEqual([...f.boxes.INBOX], [1, 2]);
		Assert.ok(
			f.commands.some((c) => /UID EXPUNGE 6$/.test(c)),
			'exactly that UID is expunged'
		);
		Assert.ok(!f.commands.some((c) => /^\S+ EXPUNGE/.test(c)), 'never a plain EXPUNGE');
		await f.engine.erase(f.account, 'x', f.target, message(6));
		Assert.deepEqual([...f.boxes.Trash], [5, 7], 'a message that is already gone is not an error');
	}
);
test(
	'permanent deletion refuses messages outside the trash, a changed mailbox and servers without UIDPLUS',
	{ timeout: 30000 },
	async (t) => {
		var f = await build(t);
		await Assert.rejects(f.engine.erase(f.account, 'x', f.target, message(1, 'INBOX')), /Only messages in the trash/);
		await Assert.rejects(f.engine.erase(f.account, 'x', f.target, { ...message(5), uidValidity: '8' }), /mailbox changed/);
		Assert.deepEqual([...f.boxes.INBOX], [1, 2]);
		Assert.deepEqual([...f.boxes.Trash], [5, 6, 7]);
		var old = await build(t, { uidplus: false });
		await Assert.rejects(old.engine.erase(old.account, 'x', old.target, message(5)), /safe deletion/);
		Assert.deepEqual([...old.boxes.Trash], [5, 6, 7]);
		Assert.ok(!old.commands.some((c) => /STORE|EXPUNGE/.test(c)), 'nothing was sent that could expunge');
	}
);
test('emptying the trash deletes everything in it and nothing in other folders', { timeout: 30000 }, async (t) => {
	var f = await build(t);
	var result = await f.engine.empty(f.account, 'x', f.target);
	Assert.deepEqual(result, { path: 'Trash', removed: 3 });
	Assert.equal(f.boxes.Trash.size, 0);
	Assert.deepEqual([...f.boxes.INBOX], [1, 2]);
	Assert.deepEqual(await f.engine.empty(f.account, 'x', f.target), { path: 'Trash', removed: 0 });
});
