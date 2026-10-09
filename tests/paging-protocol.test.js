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

test('real ImapFlow pages by sequence, refreshes cached flags by UID list and sends valid commands', { timeout: 30000 }, async (t) => {
	var dir = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'tm-paging-'));
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
	var uids = Array.from({ length: 120 }, (_, i) => 1000 + i + 1).filter((u) => u !== 1007 && u !== 1040);
	var full = (seq) =>
		'* ' +
		seq +
		' FETCH (UID ' +
		uids[seq - 1] +
		' FLAGS (' +
		(uids[seq - 1] === 1050 ? '\\Seen' : '') +
		') RFC822.SIZE 100 INTERNALDATE "08-Oct-2026 10:00:00 +0000" ENVELOPE ("Thu, 08 Oct 2026 10:00:00 +0000" "Subject ' +
		seq +
		'" (("Sender" NIL "sender" "example.test")) NIL NIL ((NIL NIL "me" "example.test")) NIL NIL NIL "<m' +
		seq +
		'@example.test>"))\r\n';
	var server = Tls.createServer({ cert, key: Fs.readFileSync(dir + '/key') }, (socket) => {
		sockets.add(socket);
		socket.on('error', () => {});
		var buffer = '',
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
				var [tag, verb] = line.split(' ');
				if (verb === 'CAPABILITY')
					socket.write('* CAPABILITY IMAP4rev1 AUTH=PLAIN\r\n' + tag + ' OK capabilities\r\n');
				else if (verb === 'AUTHENTICATE') {
					authTag = tag;
					socket.write('+ \r\n');
				} else if (verb === 'LIST')
					socket.write('* LIST (\\HasNoChildren) "/" "INBOX"\r\n' + tag + ' OK listed\r\n');
				else if (verb === 'SELECT' || verb === 'EXAMINE')
					socket.write(
						'* FLAGS (\\Seen)\r\n* ' +
							uids.length +
							' EXISTS\r\n* OK [UIDVALIDITY 9] v\r\n' +
							tag +
							' OK [READ-ONLY] opened\r\n'
					);
				else if (verb === 'FETCH') {
					var [a, b] = line.split(' ')[2].split(':').map(Number);
					for (var seq = a; seq <= b; seq++)
						socket.write(full(seq));
					socket.write(tag + ' OK fetched\r\n');
				} else if (verb === 'UID') {
					var set = line.split(' ')[3].split(',').map(Number),
						wantsFlags = /FLAGS/.test(line);
					for (var uid of set) {
						var seq = uids.indexOf(uid) + 1;
						if (seq)
							socket.write(
								'* ' +
									seq +
									' FETCH (UID ' +
									uid +
									(wantsFlags ? ' FLAGS (' + (uid === 1050 ? '\\Seen' : '') + ')' : '') +
									')\r\n'
							);
					}
					socket.write(tag + ' OK fetched\r\n');
				} else if (verb === 'LOGOUT')
					socket.end('* BYE\r\n' + tag + ' OK bye\r\n');
				else
					socket.write(tag + ' OK done\r\n');
			}
		});
	});
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
	t.after(async () => {
		for (var s of sockets)
			s.destroy();
		await new Promise((resolve) => server.close(resolve));
		Fs.rmSync(dir, { recursive: true, force: true });
	});
	var engine = Imap.create((options) => new ImapFlow({ ...options, tls: { ...options.tls, ca: cert.toString() } }));
	var account = { id: 'a', imap: { port: server.address().port, security: 'tls', username: 'fixture' } },
		target = { address: '127.0.0.1', servername: 'localhost' };
	var sync = await engine.sync(
		account,
		'x',
		target,
		'INBOX',
		[1050, 1020, 1007].map((uid) => ({ uid, uidValidity: '9' }))
	);
	Assert.equal(sync.messages.length, 50);
	Assert.deepEqual(sync.kept.map((k) => [k.uid, k.unread]).sort(), [
		[1020, true],
		[1050, false]
	]);
	var page = await engine.older(account, 'x', target, 'INBOX', { uid: 1071, uidValidity: '9' });
	Assert.equal(page.messages.length, 50);
	Assert.equal(page.messages[0].uid, 1070);
	Assert.equal(page.messages[49].uid, 1020);
	Assert.ok(
		commands.some((c) => /^\S+ FETCH 19:68 /.test(c)),
		'sequence range 19:68 requested'
	);
	Assert.ok(
		commands.some((c) => /^\S+ UID FETCH 1050,1020,1007 \(UID FLAGS\)/.test(c)),
		'cached UIDs refreshed in one command'
	);
	// Only the References header is fetched for threading; message bodies are never requested while paging.
	Assert.ok(!commands.some((c) => /STORE|EXPUNGE|MOVE|APPEND|BODY(?!\.PEEK\[HEADER\.FIELDS)/.test(c)));
});
