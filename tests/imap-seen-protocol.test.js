const { test } = require('node:test'),
	assert = require('node:assert/strict'),
	tls = require('node:tls'),
	fs = require('node:fs'),
	os = require('node:os'),
	path = require('node:path'),
	{ execFileSync } = require('node:child_process');
require('total5');
const { ImapFlow } = require('imapflow'),
	imap = require('../lib/imap');
test('actual ImapFlow adds Seen by UID over verified TLS and preserves Flagged', async (t) => {
	let dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-imap-'));
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
	let cert = fs.readFileSync(dir + '/cert'),
		key = fs.readFileSync(dir + '/key'),
		commands = [],
		sockets = new Set();
	let seen = false;
	let server = tls.createServer({ key, cert }, (socket) => {
		socket.write('* OK Test IMAP server\r\n');
		let buffer = '';
		socket.on('data', (chunk) => {
			buffer += chunk;
			let i;
			while ((i = buffer.indexOf('\r\n')) >= 0) {
				let line = buffer.slice(0, i);
				buffer = buffer.slice(i + 2);
				commands.push(line);
				let [tag, verb] = line.split(' ');
				if (verb === 'CAPABILITY')
					socket.write('* CAPABILITY IMAP4rev1 AUTH=PLAIN NAMESPACE\r\n' + tag + ' OK capabilities\r\n');
				else if (verb === 'AUTHENTICATE') {
					socket.write('+ \r\n');
					socket.once('data', () => {});
					socket.authTag = tag;
				} else if (socket.authTag) {
					socket.write(socket.authTag + ' OK logged in\r\n');
					socket.authTag = '';
				} else if (verb === 'LOGIN')
					socket.write(tag + ' OK logged in\r\n');
				else if (verb === 'NAMESPACE')
					socket.write('* NAMESPACE (("INBOX." ".")) NIL NIL\r\n' + tag + ' OK namespace\r\n');
				else if (verb === 'LIST') {
					let inbox = /\"INBOX\"$/.test(line);
					socket.write('* LIST (\\HasNoChildren) "." "' + (inbox ? 'INBOX' : 'INBOX.Sent') + '"\r\n' + tag + ' OK list\r\n');
				} else if (verb === 'UID')
					if (line.includes(' STORE ')) {
						assert.match(line, /UID STORE 42 \+FLAGS/);
						assert.ok(line.includes('\\Seen'));
						seen = true;
						socket.write(tag + ' OK stored\r\n');
					} else
						socket.write('* 1 FETCH (UID 42 FLAGS (\\Flagged' + (seen ? ' \\Seen' : '') + '))\r\n' + tag + ' OK fetched\r\n');
				else if (verb === 'SELECT')
					socket.write(
						'* FLAGS (\\Seen \\Flagged)\r\n* 1 EXISTS\r\n* OK [UIDVALIDITY 123] validity\r\n* OK [PERMANENTFLAGS (\\Seen \\Flagged)] flags\r\n' +
							tag +
							' OK [READ-WRITE] opened\r\n'
					);
				else if (verb === 'FETCH')
					socket.write(
						'* 1 FETCH (UID 42 FLAGS () RFC822.SIZE 100 INTERNALDATE "08-Oct-2026 10:00:00 +0000" ENVELOPE ("Thu, 08 Oct 2026 10:00:00 +0000" "Fixture" (("Sender" NIL "sender" "example.test")) NIL NIL ((NIL NIL "me" "example.test")) NIL NIL NIL "<fixture@example.test>"))\r\n' +
							tag +
							' OK fetched\r\n'
					);
				else if (verb === 'LOGOUT')
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
	await new Promise((r) => server.listen(0, '127.0.0.1', r));
	t.after(async () => {
		for (let s of sockets)
			s.destroy();
		await new Promise((r) => server.close(r));
		fs.rmSync(dir, { recursive: true, force: true });
	});
	let engine = imap.create((options) => new ImapFlow({ ...options, tls: { ...options.tls, ca: cert } }));
	await engine.markRead(
		{ imap: { port: server.address().port, security: 'tls', username: 'fixture-user' } },
		'fixture-password',
		{ address: '127.0.0.1', servername: 'localhost' },
		{ mailboxPath: 'INBOX', uidValidity: '123', uid: 42 }
	);
	assert.equal(seen, true);
	assert.ok(commands.some((c) => c.includes(' SELECT ')));
	assert.equal(commands.filter((c) => c.includes(' UID STORE ')).length, 1);
	assert.equal(commands.filter((c) => c.includes(' UID FETCH ')).length, 2);
	assert.ok(!commands.some((c) => c.includes('EXPUNGE') || c.includes('DELETE') || c.includes('MOVE')));
});
