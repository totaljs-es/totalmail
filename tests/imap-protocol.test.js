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
test('actual ImapFlow authenticates over verified TLS, includes INBOX outside an INBOX. namespace and opens it read-only', async (t) => {
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
				} else if (verb === 'EXAMINE')
					socket.write(
						'* FLAGS (\\Seen \\Flagged)\r\n* 1 EXISTS\r\n* OK [UIDVALIDITY 123] validity\r\n' +
							tag +
							' OK [READ-ONLY] opened\r\n'
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
	let result = await engine.sync(
		{ id: 'real', imap: { port: server.address().port, security: 'tls', username: 'fixture-user' } },
		'fixture-password',
		{ address: '127.0.0.1', servername: 'localhost' },
		'INBOX'
	);
	assert.ok(result.folders.some((f) => f.path === 'INBOX'));
	assert.ok(result.folders.some((f) => f.path === 'INBOX.Sent'));
	assert.ok(commands.some((c) => c.includes(' LIST "INBOX." "*"')));
	assert.ok(commands.some((c) => c.includes(' LIST "" "INBOX"')));
	assert.equal(result.messages[0].uid, 42);
	assert.equal(result.messages[0].subject, 'Fixture');
	assert.equal(result.messages[0].uidValidity, '123');
	assert.ok(commands.some((c) => c.includes(' EXAMINE ')));
	assert.ok(!commands.some((c) => c.includes(' SELECT ') || c.includes('STORE') || c.includes('BODY[')));
});
