require('total5');
const { test } = require('node:test');
const Assert = require('node:assert/strict');
const Tls = require('node:tls'),
	Fs = require('node:fs'),
	Os = require('node:os'),
	Path = require('node:path');
const { execFileSync } = require('node:child_process');
const { ImapFlow } = require('imapflow');
const Imap = require('../lib/imap'),
	Watch = require('../lib/watch');

function clock() {
	var now = 0,
		timers = new Set();
	return {
		now: () => now,
		set(fn, ms) {
			var t = { fn, at: now + ms, unref() {} };
			timers.add(t);
			return t;
		},
		clear(t) {
			timers.delete(t);
		},
		advance(ms) {
			var end = now + ms;
			for (;;) {
				var due = [...timers].filter((t) => t.at <= end).sort((a, b) => a.at - b.at)[0];
				if (!due)
					break;
				timers.delete(due);
				now = due.at;
				due.fn();
			}
			now = end;
		}
	};
}
function fixture(ids = ['a']) {
	var time = clock(),
		connections = [],
		failures = [];
	var engine = {
		watch: async (account, password, target, onevent) => {
			if (failures.length)
				throw failures.shift();
			var connection = {
				account: account.id,
				password,
				onevent,
				closed: false,
				close() {
					this.closed = true;
				}
			};
			connections.push(connection);
			return connection;
		}
	};
	var watch = Watch.create({
		imap: engine,
		clock: time,
		sweep: false,
		resolve: async () => ({ address: '127.0.0.1', servername: 'localhost' }),
		accounts: () => ids,
		credential: (user, id) => ({ account: { id, imap: { host: 'imap.example.test' } }, password: 'secret-' + id })
	});
	return { watch, time, connections, failures, user: { id: 'u'.repeat(32) } };
}
const flush = () => new Promise((resolve) => setImmediate(resolve));

test('waiting starts one IDLE connection per verified account with the account credentials', async () => {
	var f = fixture(['a', 'b']);
	Assert.deepEqual(await f.watch.wait(f.user, 0), { version: 1, changed: [] });
	await flush();
	Assert.deepEqual(
		f.connections.map((c) => [c.account, c.password]),
		[
			['a', 'secret-a'],
			['b', 'secret-b']
		]
	);
	await f.watch.wait(f.user, 0);
	await flush();
	Assert.equal(f.connections.length, 2);
});
test('a change wakes the long poll once, debounced, naming only the changed account', async () => {
	var f = fixture(['a', 'b']);
	Assert.deepEqual(await f.watch.wait(f.user, 0), { version: 1, changed: [] });
	await flush();
	var done = false,
		held = f.watch.wait(f.user, 1).then((value) => {
			done = true;
			return value;
		});
	f.connections[1].onevent({ type: 'change' });
	f.time.advance(1000);
	f.connections[1].onevent({ type: 'change' });
	f.time.advance(1499);
	await flush();
	Assert.equal(done, false);
	f.time.advance(1);
	Assert.deepEqual(await held, { version: 2, changed: ['b'] });
	Assert.deepEqual(await f.watch.wait(f.user, 1), { version: 2, changed: ['b'] });
});
test('a held request ends after the hold time or when the client disconnects, and restarts resync immediately', async () => {
	var f = fixture(['a']);
	await f.watch.wait(f.user, 0);
	await flush();
	var held = f.watch.wait(f.user, 1);
	f.time.advance(Watch.limits.hold);
	Assert.deepEqual(await held, { version: 1, changed: [] });
	var abort,
		aborted = f.watch.wait(f.user, 1, (fn) => (abort = fn));
	abort();
	Assert.deepEqual(await aborted, { version: 1, changed: [] });
	Assert.deepEqual(await f.watch.wait(f.user, 99), { version: 1, changed: [] });
});
test('limits per user and in total, idle shutdown and reconnect with backoff', async () => {
	var ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
		f = fixture(ids);
	await f.watch.wait(f.user, 0);
	await flush();
	Assert.equal(f.connections.length, Watch.limits.user);
	f.time.advance(Watch.limits.idle + 1);
	f.watch.sweep();
	Assert.ok(f.connections.every((c) => c.closed));
	Assert.deepEqual(f.watch.watching(f.user), []);
	var g = fixture(['a']);
	await g.watch.wait(g.user, 0);
	await flush();
	g.connections[0].onevent({ type: 'close' });
	Assert.ok(g.connections[0].closed);
	g.time.advance(Watch.limits.backoff[0] - 1);
	await flush();
	Assert.equal(g.connections.length, 1);
	g.time.advance(1);
	await flush();
	Assert.equal(g.connections.length, 2);
	var h = fixture(['a']);
	h.failures.push(Object.assign(Error('auth'), { authenticationFailed: true }));
	await h.watch.wait(h.user, 0);
	await flush();
	h.time.advance(Watch.limits.authFailure - 1);
	await flush();
	Assert.equal(h.connections.length, 0);
});
test('real ImapFlow reports an IDLE EXISTS notification without reading or changing mail', { timeout: 40000 }, async (t) => {
	var dir = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'tm-idle-'));
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
		sockets = new Set(),
		idling = null;
	var server = Tls.createServer({ cert, key: Fs.readFileSync(dir + '/key') }, (socket) => {
		sockets.add(socket);
		socket.on('error', () => {});
		var buffer = '',
			authTag = '',
			idleTag = '';
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
				if (line === 'DONE') {
					socket.write(idleTag + ' OK idle done\r\n');
					idling = null;
					continue;
				}
				var [tag, verb] = line.split(' ');
				if (verb === 'CAPABILITY')
					socket.write('* CAPABILITY IMAP4rev1 AUTH=PLAIN IDLE\r\n' + tag + ' OK capabilities\r\n');
				else if (verb === 'AUTHENTICATE') {
					authTag = tag;
					socket.write('+ \r\n');
				} else if (verb === 'SELECT' || verb === 'EXAMINE')
					socket.write(
						'* FLAGS (\\Seen)\r\n* 1 EXISTS\r\n* OK [UIDVALIDITY 5] v\r\n* OK [UIDNEXT 2] n\r\n' +
							tag +
							' OK [READ-ONLY] opened\r\n'
					);
				else if (verb === 'IDLE') {
					idleTag = tag;
					idling = socket;
					socket.write('+ idling\r\n');
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
	var events = [];
	var account = { id: 'a', imap: { port: server.address().port, security: 'tls', username: 'fixture' } };
	var connection = await engine.watch(account, 'fixture', { address: '127.0.0.1', servername: 'localhost' }, (event) =>
		events.push(event.type)
	);
	t.after(() => connection.close());
	for (var waited = 0; !idling && waited < 30000; waited += 100)
		await new Promise((resolve) => setTimeout(resolve, 100));
	Assert.ok(idling, 'ImapFlow entered IDLE');
	idling.write('* 2 EXISTS\r\n');
	for (waited = 0; !events.includes('change') && waited < 5000; waited += 50)
		await new Promise((resolve) => setTimeout(resolve, 50));
	Assert.ok(events.includes('change'));
	Assert.ok(
		commands.some((c) => /EXAMINE/.test(c)),
		'mailbox opened read-only'
	);
	Assert.ok(!commands.some((c) => /STORE|EXPUNGE|MOVE|APPEND|FETCH/.test(c)));
});
