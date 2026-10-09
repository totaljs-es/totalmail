const { test } = require('node:test'),
	assert = require('node:assert/strict'),
	tls = require('node:tls'),
	net = require('node:net'),
	fs = require('node:fs'),
	os = require('node:os'),
	path = require('node:path'),
	{ execFileSync } = require('node:child_process');
require('total5');
const { Mailer } = require('../lib/vendor/total5-mail'),
	smtp = require('../lib/smtp').create(Mailer);
async function fixture(t, { starttls = false, reply = '250 queued', auth = true } = {}) {
	let dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-smtp-'));
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
	let key = fs.readFileSync(dir + '/key'),
		cert = fs.readFileSync(dir + '/cert'),
		context = tls.createSecureContext({ key, cert });
	let commands = [],
		sockets = new Set(),
		tokens = [];
	let data = false,
		body = [],
		awaitingToken = false;
	function attach(socket, encrypted, greet) {
		sockets.add(socket);
		socket.on('error', () => {});
		socket.on('close', () => sockets.delete(socket));
		if (greet)
			socket.write('220 localhost ESMTP\r\n');
		let buffer = '';
		socket.on('data', (chunk) => {
			buffer += chunk;
			let i;
			while ((i = buffer.indexOf('\r\n')) >= 0) {
				let line = buffer.slice(0, i);
				buffer = buffer.slice(i + 2);
				if (data) {
					if (line === '.') {
						data = false;
						if (reply === 'disconnect')
							socket.end();
						else
							socket.write(reply + '\r\n');
					} else
						body.push(line);
					continue;
				}
				commands.push({ line, encrypted });
				if (awaitingToken) {
					awaitingToken = false;
					tokens.push(line);
					socket.write('235 Authenticated\r\n');
					continue;
				}
				if (/^EHLO|^HELO/.test(line))
					socket.write(
						encrypted
							? auth
								? '250-localhost\r\n250 AUTH ' + (auth === 'xoauth2' ? 'XOAUTH2' : 'PLAIN') + '\r\n'
								: '250 localhost\r\n'
							: '250-localhost\r\n250 STARTTLS\r\n'
					);
				else if (line === 'AUTH XOAUTH2') {
					awaitingToken = true;
					socket.write('334 \r\n');
				} else if (line === 'STARTTLS') {
					socket.write('220 Upgrade\r\n');
					socket.removeAllListeners('data');
					let secure = new tls.TLSSocket(socket, { isServer: true, secureContext: context });
					attach(secure, true, false);
					return;
				} else if (line.startsWith('AUTH PLAIN'))
					socket.write('235 Authenticated\r\n');
				else if (/^MAIL FROM|^RCPT TO/.test(line))
					socket.write('250 OK\r\n');
				else if (line === 'DATA') {
					data = true;
					socket.write('354 Send data\r\n');
				} else if (line === 'QUIT')
					socket.end('221 Bye\r\n');
				else if (line)
					socket.write('500 Unknown\r\n');
			}
		});
	}
	let server = starttls ? net.createServer((s) => attach(s, false, true)) : tls.createServer({ key, cert }, (s) => attach(s, true, true));
	server.on('connection', (s) => {
		sockets.add(s);
		s.on('close', () => sockets.delete(s));
	});
	await new Promise((r) => server.listen(0, '127.0.0.1', r));
	t.after(async () => {
		for (let s of sockets)
			s.destroy();
		await new Promise((r) => server.close(r));
		fs.rmSync(dir, { recursive: true, force: true });
	});
	let options = smtp.options(
		{ smtp: { port: server.address().port, security: starttls ? 'starttls' : 'tls', username: 'fixture-user' } },
		'fixture-password',
		{ address: '127.0.0.1', servername: 'localhost' }
	);
	options.ca = cert.toString();
	options.tls.ca = cert.toString();
	return { options, commands, body, tokens };
}
test('native SMTP verifies implicit TLS without sending DATA', async (t) => {
	let f = await fixture(t);
	await smtp.verify(f.options);
	assert.ok(f.commands.some((c) => c.line.startsWith('AUTH PLAIN') && c.encrypted));
	assert.ok(!f.commands.some((c) => c.line === 'DATA' || c.line === 'STARTTLS'));
});
test('native SMTP upgrades STARTTLS before disclosing credentials', async (t) => {
	let f = await fixture(t, { starttls: true });
	await smtp.verify(f.options);
	assert.ok(f.commands.some((c) => c.line === 'STARTTLS' && !c.encrypted));
	assert.ok(f.commands.some((c) => c.line.startsWith('AUTH') && c.encrypted));
	assert.ok(!f.commands.some((c) => c.line.startsWith('AUTH') && !c.encrypted));
});
test('native SMTP succeeds only after server confirmation of DATA', async (t) => {
	let f = await fixture(t);
	await smtp.send(f.options, { email: 'sender@example.test', name: 'Sender' }, { subject: 'Test', body: 'Hello\n.world' }, [
		'recipient@example.test'
	]);
	assert.equal(f.commands.filter((c) => c.line === 'DATA').length, 1);
	let parsed = await require('mailparser').simpleParser(f.body.join('\r\n'));
	assert.equal(parsed.text.trim(), 'Hello\n.world');
});
for (const reply of ['451 rejected', 'disconnect'])
	test('native SMTP rejects unconfirmed DATA: ' + reply, async (t) => {
		let f = await fixture(t, { reply });
		await assert.rejects(
			smtp.send(f.options, { email: 'sender@example.test', name: 'Sender' }, { subject: 'Test', body: 'Hello' }, [
				'recipient@example.test'
			])
		);
	});
test('native SMTP rejects missing authentication', async (t) => {
	let f = await fixture(t, { auth: false });
	await assert.rejects(smtp.verify(f.options));
});
test('native SMTP rejects untrusted certificate before authentication', async (t) => {
	let f = await fixture(t);
	delete f.options.ca;
	delete f.options.tls.ca;
	await assert.rejects(smtp.verify(f.options));
	assert.ok(!f.commands.some((c) => c.line.startsWith('AUTH')));
});

test('SMTP reply carries validated thread headers and preserves MIME content', async (t) => {
	let f = await fixture(t);
	await smtp.send(
		f.options,
		{ email: 'sender@example.test', name: 'Sender' },
		{ subject: 'Re: Original', body: 'Reply body' },
		['reply@example.test'],
		{
			messageId: '<parent@example.test>',
			references: ['<root@example.test>', '<parent@example.test>', 'bad\r\nBcc: stolen@example.test']
		}
	);
	let parsed = await require('mailparser').simpleParser(f.body.join('\r\n'));
	assert.equal(parsed.inReplyTo, '<parent@example.test>');
	assert.deepEqual(parsed.references, ['<root@example.test>', '<parent@example.test>']);
	assert.equal(parsed.to.value[0].address, 'reply@example.test');
	assert.equal(parsed.text.trim(), 'Reply body');
	assert.equal(parsed.bcc, undefined);
});

test('SMTP returns the exact MIME source for IMAP and includes reviewed Cc recipients', async (t) => {
	let f = await fixture(t);
	let result = await smtp.send(
		f.options,
		{ email: 'sender@example.test', name: 'Sender' },
		{ messageId: '<sent@totalmail.local>', subject: 'Sent copy', body: 'Hello\n.world' },
		['to@example.test'],
		null,
		['copy@example.test']
	);
	assert.equal(result.source, f.body.join('\r\n') + '\r\n');
	let parsed = await require('mailparser').simpleParser(result.source);
	assert.equal(parsed.messageId, '<sent@totalmail.local>');
	assert.equal(parsed.cc.value[0].address, 'copy@example.test');
	assert.ok(f.commands.some((c) => c.line === 'RCPT TO: <copy@example.test>'));
});

test('SMTP sends attachments as intact base64, sanitizes names and returns the exact MIME source', async (t) => {
	let f = await fixture(t);
	let bytes = Buffer.from(Array.from({ length: 200003 }, (_, i) => (i * 31 + 7) % 256));
	let result = await smtp.send(
		f.options,
		{ email: 'sender@example.test', name: 'Sender' },
		{ messageId: '<files@totalmail.local>', subject: 'Files', body: 'See attached' },
		['to@example.test'],
		null,
		[],
		[
			{ name: 'bad"\r\nBcc: stolen@example.test.bin', content: bytes },
			{ name: 'Informe ñ.txt', content: Buffer.from('hola') }
		]
	);
	assert.equal(result.source, f.body.join('\r\n') + '\r\n');
	for (let raw of [f.body.join('\r\n'), result.source]) {
		let parsed = await require('mailparser').simpleParser(raw);
		assert.equal(parsed.text.trim(), 'See attached');
		assert.equal(parsed.attachments.length, 2);
		assert.ok(parsed.attachments[0].content.equals(bytes));
		assert.ok(!/[\r\n"]/.test(parsed.attachments[0].filename));
		assert.equal(parsed.attachments[1].filename, 'Informe ñ.txt');
		assert.equal(parsed.attachments[1].content.toString(), 'hola');
		assert.equal(parsed.bcc, undefined);
	}
	assert.ok(f.body.every((line) => line.length <= 998));
});

test('SMTP signs in with XOAUTH2 and an access token for OAuth accounts, never a password', async (t) => {
	let f = await fixture(t, { auth: 'xoauth2' });
	let account = {
		authType: 'oauth2',
		email: 'me@example.test',
		smtp: { port: f.options.port, security: 'tls', username: 'me@example.test' }
	};
	let options = smtp.options(account, 'ACCESS-TOKEN', { address: '127.0.0.1', servername: 'localhost' });
	assert.equal(options.token, 'ACCESS-TOKEN');
	assert.equal(options.password, undefined);
	options.ca = f.options.ca;
	options.tls.ca = f.options.tls.ca;
	options.port = f.options.port;
	await smtp.verify(options);
	assert.equal(f.tokens.length, 1);
	assert.equal(Buffer.from(f.tokens[0], 'base64').toString(), 'user=me@example.test\x01auth=Bearer ACCESS-TOKEN\x01\x01');
	assert.ok(!f.commands.some((c) => c.line.startsWith('AUTH PLAIN') || c.line.startsWith('AUTH LOGIN')));
});

test('hidden recipients get the message through the envelope only: no Bcc header in the message or in the copy kept in Sent', async (t) => {
	let f = await fixture(t);
	let result = await smtp.send(
		f.options,
		{ email: 'sender@example.test', name: 'Sender' },
		{ messageId: '<blind@totalmail.local>', subject: 'Quiet', body: 'Hello' },
		['to@example.test'],
		null,
		['copy@example.test'],
		[],
		['hidden@example.test', 'other-hidden@example.test']
	);
	for (let address of ['to@example.test', 'copy@example.test', 'hidden@example.test', 'other-hidden@example.test'])
		assert.ok(
			f.commands.some((c) => c.line === 'RCPT TO: <' + address + '>'),
			address + ' is a recipient of the delivery'
		);
	let wire = f.body.join('\r\n');
	assert.ok(!/bcc/i.test(wire) && !wire.includes('hidden@example.test'), 'nothing on the wire names the hidden recipients');
	assert.ok(!/bcc/i.test(result.source) && !result.source.includes('hidden@example.test'), 'nor does the copy for Sent');
	let parsed = await require('mailparser').simpleParser(result.source);
	assert.equal(parsed.bcc, undefined);
	assert.equal(parsed.to.value[0].address, 'to@example.test');
	assert.equal(parsed.cc.value[0].address, 'copy@example.test');
});

test('formatted mail is one message with a plain and an HTML part, and attachments still ride along', async (t) => {
	let f = await fixture(t);
	let result = await smtp.send(
		f.options,
		{ email: 'sender@example.test', name: 'Sender' },
		{ messageId: '<fmt@totalmail.local>', subject: 'Formatted', body: 'Hola **Lucía**\n- uno\n- dos' },
		['to@example.test'],
		null,
		[],
		[{ name: 'a.txt', content: Buffer.from('adjunto') }]
	);
	let parsed = await require('mailparser').simpleParser(f.body.join('\r\n'));
	assert.equal(parsed.text.trim(), 'Hola Lucía\n- uno\n- dos');
	assert.match(parsed.html, /<strong>Lucía<\/strong>/);
	assert.match(parsed.html, /<li>uno<\/li>/);
	assert.equal(parsed.attachments.length, 1);
	assert.equal(parsed.attachments[0].filename, 'a.txt');
	let plain = await smtp.send(f.options, { email: 'sender@example.test', name: 'Sender' }, { subject: 'Plain', body: 'Nada especial' }, [
		'to@example.test'
	]);
	assert.doesNotMatch(plain.source, /multipart\/alternative|text\/html/);
	assert.match(result.source, /multipart\/alternative/);
});
