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

// 40 messages; UIDs 101..140. Message n replies to message n-1 and lists the earlier ones in References.
function envelope(n) {
	return (
		'("Thu, 08 Oct 2026 10:00:00 +0000" "Subject ' +
		n +
		'" (("Sender" NIL "sender" "example.test")) NIL NIL ((NIL NIL "me" "example.test")) NIL NIL ' +
		(n > 1 ? '"<m' + (n - 1) + '@example.test>"' : 'NIL') +
		' "<m' +
		n +
		'@example.test>")'
	);
}
function fetchLine(n, withHeaders) {
	var refs = Array.from({ length: Math.min(n - 1, 3) }, (_, i) => '<m' + (n - 1 - i) + '@example.test>')
		.reverse()
		.join('\r\n\t');
	var headers = n > 1 ? 'References: ' + refs + '\r\n\r\n' : '\r\n';
	return (
		'* ' +
		n +
		' FETCH (UID ' +
		(100 + n) +
		' FLAGS () RFC822.SIZE 100 INTERNALDATE "08-Oct-2026 10:00:00 +0000" ENVELOPE ' +
		envelope(n) +
		(withHeaders ? ' BODY[HEADER.FIELDS (REFERENCES)] {' + Buffer.byteLength(headers) + '}\r\n' + headers : '') +
		')\r\n'
	);
}
test(
	'real ImapFlow searches the server, returns the newest hits as headers with their thread links, and sends a valid command',
	{ timeout: 30000 },
	async (t) => {
		var dir = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'tm-search-'));
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
		var server = Tls.createServer({ cert, key: Fs.readFileSync(dir + '/key') }, (socket) => {
			sockets.add(socket);
			socket.on('error', () => {});
			var buffer = Buffer.alloc(0),
				authTag = '';
			socket.write('* OK Fixture IMAP\r\n');
			socket.on('data', (chunk) => {
				buffer = Buffer.concat([buffer, chunk]);
				var i;
				while ((i = buffer.indexOf('\r\n')) >= 0) {
					var line = buffer.slice(0, i).toString('utf8');
					buffer = buffer.slice(i + 2);
					if (authTag) {
						socket.write(authTag + ' OK authenticated\r\n');
						authTag = '';
						continue;
					}
					// A search with non-ASCII text is sent with a literal: read it before answering.
					var literal = /\{(\d+)\+?\}$/.exec(line);
					if (literal) {
						socket.write('+ go\r\n');
						var need = Number(literal[1]) + 2;
						while (buffer.length < need) /* the data event delivers the rest */
							break;
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
						socket.write('* FLAGS (\\Seen)\r\n* 40 EXISTS\r\n* OK [UIDVALIDITY 9] v\r\n' + tag + ' OK [READ-ONLY] opened\r\n');
					else if (verb === 'UID' && line.split(' ')[2] === 'SEARCH')
						socket.write('* SEARCH ' + [105, 118, 133, 140, 102].join(' ') + '\r\n' + tag + ' OK searched\r\n');
					else if (verb === 'UID' && line.split(' ')[2] === 'FETCH') {
						for (var uid of line.split(' ')[3].split(',').map(Number))
							socket.write(fetchLine(uid - 100, /HEADER\.FIELDS/.test(line)));
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
		var result = await engine.search(account, 'x', target, 'INBOX', 'factura', 3);
		Assert.equal(result.found, 5);
		Assert.deepEqual(
			result.messages.map((m) => m.uid),
			[140, 133, 118],
			'the newest hits, newest first'
		);
		Assert.equal(result.messages[0].messageId, '<m40@example.test>');
		Assert.equal(result.messages[0].inReplyTo, '<m39@example.test>');
		Assert.deepEqual(
			result.messages[0].references,
			['<m37@example.test>', '<m38@example.test>', '<m39@example.test>'],
			'folded References header is unfolded and validated'
		);
		var search = commands.find((c) => /UID SEARCH/.test(c));
		Assert.match(search, /OR/);
		for (var field of ['SUBJECT', 'FROM', 'TO', 'BODY'])
			Assert.match(search, new RegExp(field), field + ' is searched');
		Assert.ok(!commands.some((c) => /STORE|EXPUNGE|MOVE|APPEND/.test(c)), 'searching never modifies mail');
		// Text with accents or other non-ASCII letters is sent as UTF-8, which every IMAP server must accept.
		commands.length = 0;
		var accented = await engine.search(account, 'x', target, 'INBOX', '"camión ñandú"', 3);
		Assert.equal(accented.messages.length, 3);
		Assert.match(
			commands.find((c) => /UID SEARCH/.test(c)),
			/CHARSET UTF-8/
		);
		Assert.ok(
			commands.some((c) => c.includes('camión ñandú')),
			'the text travels intact'
		);
		// Operators become IMAP search keys; several words are ANDed, which ImapFlow expresses with a negated OR.
		commands.length = 0;
		await engine.search(account, 'x', target, 'INBOX', 'from:ana is:unread after:2026-10-01 before:2026-11-01 has:attachment', 3);
		var operators = commands.find((c) => /UID SEARCH/.test(c));
		for (var key of [/FROM ana/, /UNSEEN/, /SINCE 01-Oct-2026/, /BEFORE 01-Nov-2026/, /HEADER content-type multipart\/mixed/i])
			Assert.match(operators, key);
		commands.length = 0;
		await engine.search(account, 'x', target, 'INBOX', 'alpha beta gamma', 3);
		var words = commands.find((c) => /UID SEARCH/.test(c));
		Assert.match(words, /NOT/);
		for (var word of ['alpha', 'beta', 'gamma'])
			Assert.match(words, new RegExp(word));
		Assert.ok(!commands.some((c) => /STORE|EXPUNGE|MOVE|APPEND/.test(c)), 'still read only');
	}
);
