require('total5');
const { test } = require('node:test');
const Assert = require('node:assert/strict');
const Fs = require('node:fs'),
	Net = require('node:net'),
	Os = require('node:os'),
	Path = require('node:path'),
	Tls = require('node:tls'),
	{ execFileSync } = require('node:child_process');
const Diagnose = require('../lib/diagnose');
// A certificate for localhost that lives `days` days, and a trusted copy of it for the connections that verify.
function certificate(t, days = 30) {
	var dir = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'totalmail-diagnose-'));
	t.after(() => Fs.rmSync(dir, { recursive: true, force: true }));
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
			String(days),
			'-subj',
			'/CN=localhost',
			'-addext',
			'subjectAltName=DNS:localhost'
		],
		{ stdio: 'ignore' }
	);
	return { key: Fs.readFileSync(dir + '/key'), cert: Fs.readFileSync(dir + '/cert') };
}
// An SMTP server: `mode` is tls (encrypted from the start) or starttls (plain until STARTTLS, which `offer` may leave out).
// `answer` is the reply to AUTH. `seen` collects the commands it received, so a test can see that no password was sent.
function smtp(t, pair, { mode = 'tls', offer = true, answer = '235 2.7.0 Accepted', auth = 'PLAIN LOGIN' } = {}) {
	var seen = [];
	function talk(socket, encrypted) {
		var buffer = '';
		socket.on('error', () => {});
		socket.on('data', (chunk) => {
			buffer += chunk;
			var i;
			while ((i = buffer.indexOf('\r\n')) >= 0) {
				var line = buffer.slice(0, i);
				buffer = buffer.slice(i + 2);
				seen.push(line.split(' ')[0]);
				if (/^EHLO/i.test(line))
					socket.write(
						'250-localhost\r\n' +
							(encrypted || mode === 'tls' ? '250-AUTH ' + auth + '\r\n' : '') +
							(!encrypted && mode === 'starttls' && offer ? '250-STARTTLS\r\n' : '') +
							'250 SIZE 1000\r\n'
					);
				else if (/^STARTTLS/i.test(line)) {
					socket.write('220 Go ahead\r\n');
					socket.removeAllListeners('data');
					var secure = new Tls.TLSSocket(socket, { isServer: true, ...pair });
					talk(secure, true);
				} else if (/^AUTH/i.test(line))
					socket.write(answer + '\r\n');
				else if (/^QUIT/i.test(line))
					socket.end('221 Bye\r\n');
			}
		});
	}
	var server =
		mode === 'tls'
			? Tls.createServer(pair, (socket) => {
				socket.write('220 localhost ESMTP\r\n');
				talk(socket, true);
			})
			: Net.createServer((socket) => {
				socket.write('220 localhost ESMTP\r\n');
				talk(socket, false);
			});
	return new Promise((resolve) =>
		server.listen(0, '127.0.0.1', () => {
			t.after(() => server.close());
			resolve({ port: server.address().port, seen });
		})
	);
}
function imap(t, pair) {
	var server = Tls.createServer(pair, (socket) => {
		socket.on('error', () => {});
		socket.write('* OK ready\r\n');
		socket.on('data', (chunk) => {
			var tag = String(chunk).split(' ')[0];
			socket.write('* CAPABILITY IMAP4rev1 IDLE AUTH=PLAIN\r\n' + tag + ' OK done\r\n');
		});
	});
	return new Promise((resolve) =>
		server.listen(0, '127.0.0.1', () => {
			t.after(() => server.close());
			resolve({ port: server.address().port });
		})
	);
}
var good = { dns: null };
// What the tests hand to the diagnosis: everything resolves to this machine, certificates are trusted when `trust` is given.
function tool(options = {}) {
	var real = Tls;
	var tls = options.trust ? { ...real, connect: (o) => real.connect({ ...o, ca: options.trust }), TLSSocket: real.TLSSocket } : real;
	var dns = {
		resolveMx: async () => [{ exchange: 'mx.example.test', priority: 10 }],
		resolveTxt: async (name) => (name.startsWith('_dmarc.') ? [['v=DMARC1; p=reject']] : [['v=spf1 include:_spf.example.test ~all']]),
		...options.dns
	};
	return Diagnose.create({
		tls,
		dns,
		timeout: options.timeout || 3000,
		resolve:
			options.resolve ||
			(async (host) => {
				if (host.startsWith('missing.'))
					throw Object.assign(Error('queryA ENOTFOUND ' + host), { code: 'ENOTFOUND' });
				return { address: '127.0.0.1', servername: 'localhost' };
			}),
		imap: options.imapLogin || (async () => {}),
		smtp: options.smtpLogin || (async () => {})
	});
}
var account = (over = {}) => ({
	email: 'me@example.test',
	authType: 'password',
	imap: { host: 'imap.example.test', port: 993, security: 'tls', username: 'me@example.test' },
	smtp: { host: 'smtp.example.test', port: 465, security: 'tls', username: 'me@example.test' },
	...over
});
var find = (report, section, status) => report.checks.filter((c) => c.section === section && c.status === status);
var titles = (list) => list.map((c) => c.title).join(' | ');
test('a healthy account passes every step, over TLS and over STARTTLS', async (t) => {
	var pair = certificate(t),
		incoming = await imap(t, pair);
	for (var mode of ['tls', 'starttls']) {
		var outgoing = await smtp(t, pair, { mode });
		var report = await tool({ trust: pair.cert }).run(
			account({
				imap: { host: 'imap.example.test', port: incoming.port, security: 'tls', username: 'me@example.test' },
				smtp: { host: 'smtp.example.test', port: outgoing.port, security: mode, username: 'me@example.test' }
			}),
			'secret'
		);
		Assert.equal(report.failed, 0, mode + ': ' + JSON.stringify(report.checks.filter((c) => c.status === 'fail')));
		Assert.equal(report.warned, 0);
		Assert.ok(
			find(report, 'outgoing', 'ok').some((c) => /sign-in is accepted/.test(c.title)),
			mode
		);
		Assert.ok(
			find(report, 'incoming', 'ok').some((c) => /sign-in is accepted/.test(c.title)),
			mode
		);
		Assert.ok(find(report, 'domain', 'ok').length >= 3);
	}
});
test('a certificate nobody vouches for is reported and the password is never sent to that server', async (t) => {
	var pair = certificate(t),
		outgoing = await smtp(t, pair);
	var report = await tool().run(
		account({ smtp: { host: 'smtp.example.test', port: outgoing.port, security: 'tls', username: 'u' } }),
		'secret'
	);
	var failed = find(report, 'outgoing', 'fail');
	Assert.match(titles(failed), /self-signed/);
	Assert.match(failed[0].advice, /password could be sent to someone else/);
	Assert.ok(find(report, 'outgoing', 'skip').length, 'the sign-in is not tried');
	Assert.ok(!outgoing.seen.includes('AUTH'), 'no AUTH was ever sent');
});
test('a wrong password, an app password and a temporary refusal are told apart', async (t) => {
	var pair = certificate(t);
	var verdict = async (answer) => {
		var outgoing = await smtp(t, pair, { answer });
		var report = await tool({ trust: pair.cert }).run(
			account({ smtp: { host: 'smtp.example.test', port: outgoing.port, security: 'tls', username: 'u' } }),
			'secret'
		);
		return report.checks.find((c) => c.section === 'outgoing' && /sign-in|password|try again/.test(c.title) && c.status !== 'ok');
	};
	var wrong = await verdict('535 5.7.8 Authentication failed');
	Assert.equal(wrong.status, 'fail');
	Assert.match(wrong.title, /rejected the user name or password/);
	var app = await verdict('534 5.7.9 Application-specific password required');
	Assert.match(app.title, /app password/);
	var later = await verdict('454 4.7.0 Too many login attempts');
	Assert.equal(later.status, 'warn');
	Assert.match(later.title, /try again later/);
});
test('a server that does not offer STARTTLS is refused without sending anything private', async (t) => {
	var pair = certificate(t),
		outgoing = await smtp(t, pair, { mode: 'starttls', offer: false });
	var report = await tool({ trust: pair.cert }).run(
		account({ smtp: { host: 'smtp.example.test', port: outgoing.port, security: 'starttls', username: 'u' } }),
		'secret'
	);
	Assert.match(titles(find(report, 'outgoing', 'fail')), /does not offer STARTTLS/);
	Assert.ok(!outgoing.seen.includes('AUTH'));
});
test('a closed port, a missing name and settings that cannot work together say what to change', async (t) => {
	var closed = await new Promise((resolve) => {
		var s = Net.createServer();
		s.listen(0, '127.0.0.1', () => {
			var port = s.address().port;
			s.close(() => resolve(port));
		});
	});
	var report = await tool().run(account({ smtp: { host: 'smtp.example.test', port: closed, security: 'tls', username: 'u' } }), 'secret');
	var refused = find(report, 'outgoing', 'fail')[0];
	Assert.match(refused.title, /Nothing answers on port/);
	Assert.deepEqual(refused.args, ['smtp.example.test', closed]);
	var missing = await tool().run(
		account({ imap: { host: 'missing.example.test', port: 993, security: 'tls', username: 'u' } }),
		'secret'
	);
	Assert.match(titles(find(missing, 'incoming', 'fail')), /name \{0\} does not exist/);
	Assert.deepEqual(find(missing, 'incoming', 'fail')[0].args, ['missing.example.test']);
	var calls = 0;
	var mismatch = await tool({
		resolve: async () => {
			calls++;
			return { address: '127.0.0.1', servername: 'localhost' };
		}
	}).run(
		account({
			smtp: { host: 'smtp.example.test', port: 587, security: 'tls', username: 'u' },
			imap: { host: 'imap.example.test', port: 993, security: 'starttls', username: 'u' }
		}),
		'secret'
	);
	Assert.match(titles(find(mismatch, 'outgoing', 'fail')), /Port \{0\} normally uses STARTTLS/);
	Assert.match(titles(find(mismatch, 'incoming', 'fail')), /Port \{0\} normally uses TLS from the start/);
	Assert.equal(calls, 0, 'nothing was resolved or connected: it is the settings');
	var open25 = await tool().run(
		account({ smtp: { host: 'missing.example.test', port: 25, security: 'starttls', username: 'u' } }),
		'secret'
	);
	Assert.match(titles(find(open25, 'outgoing', 'warn')), /Port 25/);
});
test('a certificate close to its end is a warning', async (t) => {
	var pair = certificate(t, 5),
		outgoing = await smtp(t, pair);
	var report = await tool({ trust: pair.cert }).run(
		account({ smtp: { host: 'smtp.example.test', port: outgoing.port, security: 'tls', username: 'u' } }),
		'secret'
	);
	var warning = find(report, 'outgoing', 'warn')[0];
	Assert.match(warning.title, /expires in \{0\} days/);
	Assert.ok(Number(warning.args[0]) <= 5);
});
test('the sign-in of an account that uses OAuth, and of the incoming server, are explained', async (t) => {
	var pair = certificate(t),
		incoming = await imap(t, pair),
		outgoing = await smtp(t, pair);
	var base = {
		trust: pair.cert,
		smtpLogin: async () => {
			throw Error('refused');
		},
		imapLogin: async () => {
			throw Object.assign(Error('no'), { authenticationFailed: true });
		}
	};
	var report = await tool(base).run(
		account({
			authType: 'oauth2',
			imap: { host: 'imap.example.test', port: incoming.port, security: 'tls', username: 'u' },
			smtp: { host: 'smtp.example.test', port: outgoing.port, security: 'tls', username: 'u' }
		}),
		'token'
	);
	Assert.match(find(report, 'outgoing', 'fail')[0].advice, /SMTP AUTH/);
	Assert.match(find(report, 'incoming', 'fail')[0].title, /rejected the user name or password/);
	var apphint = await tool(base).run(
		account({
			imap: { host: 'imap.example.test', port: incoming.port, security: 'tls', username: 'u' },
			smtp: { host: 'missing.example.test', port: 465, security: 'tls', username: 'u' }
		}),
		'secret',
		'app-password'
	);
	Assert.match(find(apphint, 'incoming', 'fail')[0].advice, /needs an app password/);
	var nopass = await tool({ trust: pair.cert }).run(
		account({
			imap: { host: 'imap.example.test', port: incoming.port, security: 'tls', username: 'u' },
			smtp: { host: 'missing.example.test', port: 465, security: 'tls', username: 'u' }
		}),
		''
	);
	Assert.match(titles(find(nopass, 'incoming', 'skip')), /no saved password/);
});
test('the domain is checked for MX, SPF and DMARC without failing the account', async () => {
	var none = async () => {
		throw Object.assign(Error('no'), { code: 'ENODATA' });
	};
	var report = await tool({ dns: { resolveMx: none, resolveTxt: none }, resolve: async () => Promise.reject(Error('no')) }).run(
		account(),
		'x'
	);
	var domain = report.checks.filter((c) => c.section === 'domain');
	Assert.deepEqual(
		domain.map((c) => c.status),
		['warn', 'warn', 'warn']
	);
	Assert.match(titles(domain), /no MX record/);
	Assert.match(titles(domain), /no SPF record/);
	Assert.match(titles(domain), /no DMARC record/);
	var open = await tool({
		dns: { resolveTxt: async (name) => (name.startsWith('_dmarc.') ? [['v=DMARC1; p=none']] : [['v=spf1 +all']]) },
		resolve: async () => Promise.reject(Error('no'))
	}).run(account(), 'x');
	Assert.match(titles(open.checks.filter((c) => c.status === 'warn')), /lets any server send/);
	Assert.match(titles(open.checks), /only monitors/);
});
