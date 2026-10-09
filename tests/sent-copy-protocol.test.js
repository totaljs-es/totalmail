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
	'actual ImapFlow appends the exact Seen MIME copy over TLS and finds its UID without duplicating it',
	{ timeout: 15000 },
	async (t) => {
		let dir = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'tm-sent-protocol-'));
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
		let cert = Fs.readFileSync(dir + '/cert'),
			sockets = new Set(),
			commands = [];
		let id = '<sent-fixture@totalmail.local>',
			source = 'Message-ID: ' + id + '\r\nSubject: Test\r\n\r\nBody\r\n';
		let stored = '',
			appends = 0;
		let server = Tls.createServer({ cert, key: Fs.readFileSync(dir + '/key') }, (socket) => {
			let buffer = '',
				auth = '',
				literal = null;
			socket.write('* OK Fixture IMAP\r\n');
			socket.on('data', (chunk) => {
				buffer += chunk;
				while (true) {
					if (literal) {
						if (buffer.length < literal.length + 2)
							return;
						stored = buffer.slice(0, literal.length);
						buffer = buffer.slice(literal.length + 2);
						socket.write('* 1 EXISTS\r\n' + literal.tag + ' OK [APPENDUID 7 42] appended\r\n');
						literal = null;
						continue;
					}
					let i = buffer.indexOf('\r\n');
					if (i < 0)
						return;
					let line = buffer.slice(0, i);
					buffer = buffer.slice(i + 2);
					if (auth) {
						socket.write(auth + ' OK authenticated\r\n');
						auth = '';
						continue;
					}
					commands.push(line);
					let [tag, verb] = line.split(' ');
					if (verb === 'CAPABILITY')
						socket.write('* CAPABILITY IMAP4rev1 AUTH=PLAIN UIDPLUS\r\n' + tag + ' OK capabilities\r\n');
					else if (verb === 'AUTHENTICATE') {
						auth = tag;
						socket.write('+ \r\n');
					} else if (verb === 'LIST')
						socket.write('* LIST (\\Sent) "/" "Sent"\r\n* LIST () "/" "INBOX"\r\n' + tag + ' OK list\r\n');
					else if (verb === 'SELECT')
						socket.write(
							'* FLAGS (\\Seen)\r\n* ' +
								(stored ? 1 : 0) +
								' EXISTS\r\n* OK [UIDVALIDITY 7] validity\r\n* OK [PERMANENTFLAGS (\\Seen)] flags\r\n' +
								tag +
								' OK [READ-WRITE] selected\r\n'
						);
					else if (verb === 'APPEND') {
						appends++;
						literal = { tag, length: Number(line.match(/\{(\d+)\}/)[1]) };
						socket.write('+ Ready\r\n');
					} else if (verb === 'UID' && line.includes(' SEARCH '))
						socket.write('* SEARCH' + (stored ? ' 42' : '') + '\r\n' + tag + ' OK search\r\n');
					else if (verb === 'UID' && line.includes(' FETCH '))
						socket.write(
							'* 1 FETCH (UID 42 ENVELOPE (NIL "Test" NIL NIL NIL NIL NIL NIL NIL "' +
								id +
								'"))\r\n' +
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
			Fs.rmSync(dir, { recursive: true, force: true });
		});
		let engine = Imap.create((options) => new ImapFlow({ ...options, tls: { ...options.tls, ca: cert } })),
			account = { id: 'fixture', imap: { port: server.address().port, security: 'tls', username: 'fixture' } },
			target = { address: '127.0.0.1', servername: 'localhost' };
		for (let i = 0; i < 2; i++) {
			let result = await engine.saveSent(account, 'fixture-password', target, source, id);
			Assert.equal(result.status, 'saved');
			Assert.equal(result.uid, 42);
		}
		Assert.equal(stored, source);
		Assert.equal(appends, 1);
		Assert.ok(commands.some((c) => /APPEND .*\\Seen/.test(c)));
	}
);
