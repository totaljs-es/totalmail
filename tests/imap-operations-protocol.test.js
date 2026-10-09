const { test } = require('node:test');
const Assert = require('node:assert/strict'),
	Tls = require('node:tls'),
	Fs = require('node:fs'),
	Os = require('node:os'),
	Path = require('node:path');
const { execFileSync } = require('node:child_process');
require('total5');
const { ImapFlow } = require('imapflow'),
	Imap = require('../lib/imap');
test(
	'actual ImapFlow confirms flag removal, native UID MOVE/COPYUID and namespace folder creation over TLS',
	{ timeout: 30000 },
	async (t) => {
		var dir = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'tm-imap-operations-'));
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
		var mailboxes = new Map([
			[
				'INBOX',
				{
					validity: 123,
					messages: new Map([
						[42, new Set(['\\Answered'])],
						[99, new Set(['\\Deleted'])]
					])
				}
			],
			['INBOX.Archive', { validity: 456, special: '\\Archive', messages: new Map() }],
			['INBOX.Trash', { validity: 789, special: '\\Trash', messages: new Map() }]
		]);
		var server = Tls.createServer({ cert, key: Fs.readFileSync(dir + '/key') }, (socket) => {
			var buffer = '',
				selected = 'INBOX',
				authTag = '';
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
					var [tag, verb] = line.split(' '),
						box = mailboxes.get(selected);
					if (verb === 'CAPABILITY')
						socket.write('* CAPABILITY IMAP4rev1 AUTH=PLAIN NAMESPACE UIDPLUS MOVE\r\n' + tag + ' OK capabilities\r\n');
					else if (verb === 'AUTHENTICATE') {
						authTag = tag;
						socket.write('+ \r\n');
					} else if (verb === 'NAMESPACE')
						socket.write('* NAMESPACE (("INBOX." ".")) NIL NIL\r\n' + tag + ' OK namespace\r\n');
					else if (verb === 'LIST') {
						var inbox = /"INBOX"$/.test(line);
						for (var [path, value] of mailboxes)
							if (inbox ? path === 'INBOX' : path !== 'INBOX')
								socket.write(
									'* LIST (\\HasNoChildren' + (value.special ? ' ' + value.special : '') + ') "." "' + path + '"\r\n'
								);
						socket.write(tag + ' OK listed\r\n');
					} else if (verb === 'SELECT' || verb === 'EXAMINE') {
						selected = line.match(/(?:SELECT|EXAMINE) "?([^" ]+)"?/)[1];
						box = mailboxes.get(selected);
						socket.write(
							'* FLAGS (\\Seen \\Flagged \\Answered \\Deleted)\r\n* ' +
								box.messages.size +
								' EXISTS\r\n* OK [UIDVALIDITY ' +
								box.validity +
								'] validity\r\n* OK [PERMANENTFLAGS (\\Seen \\Flagged \\Answered \\Deleted)] flags\r\n' +
								tag +
								' OK [' +
								(verb === 'SELECT' ? 'READ-WRITE' : 'READ-ONLY') +
								'] opened\r\n'
						);
					} else if (verb === 'UID') {
						var match = line.match(/UID (FETCH|STORE|MOVE) (\d+)/),
							command = match[1],
							uid = Number(match[2]);
						if (command === 'FETCH') {
							if (box.messages.has(uid))
								socket.write('* 1 FETCH (UID ' + uid + ' FLAGS (' + [...box.messages.get(uid)].join(' ') + '))\r\n');
							socket.write(tag + ' OK fetched\r\n');
						} else if (command === 'STORE') {
							var flag = line.match(/\\(?:Seen|Flagged)/)[0];
							if (line.includes('+FLAGS'))
								box.messages.get(uid).add(flag);
							else
								box.messages.get(uid).delete(flag);
							socket.write(tag + ' OK stored\r\n');
						} else {
							var path = line.match(/MOVE \d+ "?([^" ]+)"?/)[1],
								destination = mailboxes.get(path);
							destination.messages.set(81, box.messages.get(uid));
							box.messages.delete(uid);
							socket.write('* 1 EXPUNGE\r\n' + tag + ' OK [COPYUID ' + destination.validity + ' ' + uid + ' 81] moved\r\n');
						}
					} else if (verb === 'CREATE') {
						var path = line.match(/CREATE "?([^" ]+)"?/)[1];
						mailboxes.set(path, { validity: 999, messages: new Map() });
						socket.write(tag + ' OK created\r\n');
					} else if (verb === 'LOGOUT')
						socket.end('* BYE\r\n' + tag + ' OK logout\r\n');
					else
						socket.write(tag + ' OK done\r\n');
				}
			});
		});
		server.on('connection', (s) => {
			sockets.add(s);
			s.on('error', () => {});
			s.on('close', () => sockets.delete(s));
		});
		await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
		t.after(async () => {
			for (var socket of sockets)
				socket.destroy();
			await new Promise((resolve) => server.close(resolve));
			Fs.rmSync(dir, { recursive: true, force: true });
		});
		var engine = Imap.create((options) => new ImapFlow({ ...options, tls: { ...options.tls, ca: cert } }));
		var account = { id: 'fixture', imap: { port: server.address().port, security: 'tls', username: 'fixture-user' } },
			target = { address: '127.0.0.1', servername: 'localhost' };
		var message = { mailboxPath: 'INBOX', uidValidity: '123', uid: 42, body: 'Cached body', remote: true };
		await engine.flags(account, 'fixture-password', target, message, '\\Seen', true);
		await engine.flags(account, 'fixture-password', target, message, '\\Flagged', true);
		await engine.flags(account, 'fixture-password', target, message, '\\Seen', false);
		var moved = await engine.move(account, 'fixture-password', target, message, '', '\\Archive');
		Assert.equal(moved.moved.uid, 81);
		Assert.equal(moved.moved.uidValidity, '456');
		Assert.equal(moved.moved.starred, true);
		Assert.equal(moved.moved.unread, true);
		Assert.ok(mailboxes.get('INBOX.Archive').messages.get(81).has('\\Answered'));
		Assert.ok(mailboxes.get('INBOX').messages.get(99).has('\\Deleted'));
		var created = await engine.createFolder(account, 'fixture-password', target, 'Clientes', 'INBOX.Archive');
		Assert.equal(created.path, 'INBOX.Archive.Clientes');
		Assert.ok(commands.some((c) => /UID STORE 42 -FLAGS/.test(c)));
		Assert.ok(commands.some((c) => /UID MOVE 42 "?INBOX.Archive"?/.test(c)));
		Assert.ok(commands.some((c) => /CREATE "?INBOX.Archive.Clientes"?/.test(c)));
		Assert.ok(commands.some((c) => /SUBSCRIBE "?INBOX.Archive.Clientes"?/.test(c)));
		Assert.ok(!commands.some((c) => /\b(?:COPY|DELETE|EXPUNGE)\b/.test(c)));
	}
);
