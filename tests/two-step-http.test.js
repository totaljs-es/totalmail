require('total5');
// Two-step verification through the real server: the password alone is not a session, codes and recovery codes work once,
// five wrong tries spend a sign-in, and an administrator can remove it from someone who lost their phone.
const { test } = require('node:test'),
	assert = require('node:assert/strict');
const fs = require('node:fs'),
	path = require('node:path'),
	os = require('node:os'),
	net = require('node:net'),
	{ spawn } = require('node:child_process');
const Totp = require('../lib/totp');
const root = path.join(__dirname, '..');
test('two-step verification guards the sign-in end to end', { timeout: 60000 }, async (t) => {
	let directory = fs.mkdtempSync(path.join(os.tmpdir(), 'totalmail-2fa-http-'));
	for (let name of ['plugins', 'controllers', 'definitions', 'modules', 'lib', 'views', 'resources'])
		fs.cpSync(path.join(root, name), path.join(directory, name), { recursive: true });
	fs.writeFileSync(path.join(directory, 'config'), 'name : TotalMail\n');
	fs.mkdirSync(path.join(directory, 'public'));
	for (let name of fs.readdirSync(path.join(root, 'public')).filter((n) => /^ui-ui-.*\.min\.js$/.test(n)))
		fs.copyFileSync(path.join(root, 'public', name), path.join(directory, 'public', name));
	let socket = net.createServer();
	await new Promise((resolve) => socket.listen(0, '127.0.0.1', resolve));
	let port = socket.address().port;
	await new Promise((resolve) => socket.close(resolve));
	fs.writeFileSync(
		path.join(directory, 'index.cjs'),
		`require(${JSON.stringify(require.resolve('total5'))});Total.http({ip:'127.0.0.1',port:${port}});`
	);
	let child = spawn(process.execPath, ['index.cjs'], {
		cwd: directory,
		env: { ...process.env, NODE_PATH: path.join(root, 'node_modules') },
		stdio: ['ignore', 'pipe', 'pipe']
	});
	let logs = '';
	child.stdout.on('data', (c) => (logs += c));
	child.stderr.on('data', (c) => (logs += c));
	t.after(async () => {
		child.kill('SIGTERM');
		if (child.exitCode === null)
			await new Promise((resolve) => child.once('exit', resolve));
		fs.rmSync(directory, { recursive: true, force: true });
	});
	let base = 'http://127.0.0.1:' + port;
	for (let i = 0; i < 80; i++) {
		try {
			if ((await fetch(base + '/health/')).ok)
				break;
		} catch {}
		if (child.exitCode !== null)
			throw Error('Test server failed: ' + logs);
		await new Promise((resolve) => setTimeout(resolve, 100));
		if (i === 79)
			throw Error('Test server did not start: ' + logs);
	}
	async function api(schema, data = {}, cookie = '') {
		let response = await fetch(base + '/api/?lang=en', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-TotalMail': '1',
				...(cookie ? { Cookie: cookie } : {}),
				'X-Forwarded-For': '203.0.113.' + (1 + Math.floor(Math.random() * 250))
			},
			body: JSON.stringify({ schema, data })
		});
		let raw = await response.text();
		let body;
		try {
			body = JSON.parse(raw);
		} catch {
			body = raw;
		}
		return {
			status: response.status,
			body,
			cookie: (response.headers.get('set-cookie') || '').split(';')[0],
			failed: Array.isArray(body) ? body.map((e) => e.error).join(' ') : ''
		};
	}
	let password = 'isolated-fixture-password-26',
		ben = 'ben-fixture-password-2026';
	let admin = (await api('user_setup', { name: 'Ana', email: 'ana@example.test', password })).cookie;
	assert.ok(admin);
	// Setting it up: the password again, a secret, a code from the app.
	assert.match((await api('user_totp_begin', { password: 'wrong-password-123' }, admin)).failed, /password is incorrect/);
	let begin = (await api('user_totp_begin', { password }, admin)).body;
	assert.match(begin.uri, /^otpauth:\/\/totp\//);
	assert.ok(begin.secret && begin.uri.includes(begin.secret));
	assert.match((await api('user_totp_enable', { code: '000000' }, admin)).failed, /code is not right/);
	let enabled = (await api('user_totp_enable', { code: Totp.code(begin.secret) }, admin)).body;
	assert.equal(enabled.user.totp, true);
	let recovery = enabled.recovery;
	assert.equal(recovery.length, 8);
	assert.equal(
		(await api('user_totp_enable', { code: Totp.code(begin.secret) }, admin)).failed.includes('took too long'),
		true,
		'the setup is spent once it is confirmed'
	);
	// Signing in now has two steps and the first one gives nothing.
	let first = await api('user_login', { email: 'ana@example.test', password });
	assert.equal(first.body.totp, true);
	assert.ok(first.body.token && !first.cookie, 'no session after the password alone');
	assert.equal((await api('bootstrap', {}, '')).status, 401);
	assert.match((await api('user_totp', { token: first.body.token, code: '123456' })).failed, /not right/);
	let ahead = Totp.code(begin.secret, Date.now() + 30000);
	let done = await api('user_totp', { token: first.body.token, code: ahead });
	assert.equal(done.body.success, true);
	assert.ok(done.cookie, 'the right code opens the session');
	let signed = done.cookie;
	assert.equal((await api('bootstrap', {}, signed)).body.user.totp, true);
	// A code works once.
	let second = await api('user_login', { email: 'ana@example.test', password });
	assert.match((await api('user_totp', { token: second.body.token, code: ahead })).failed, /not right/, 'the same code twice');
	// A recovery code works once.
	let viaRecovery = await api('user_totp', { token: second.body.token, code: recovery[0].toUpperCase() });
	assert.equal(viaRecovery.body.via, 'recovery');
	assert.equal(viaRecovery.body.left, 7);
	let third = await api('user_login', { email: 'ana@example.test', password });
	assert.match((await api('user_totp', { token: third.body.token, code: recovery[0] })).failed, /not right/, 'a spent recovery code');
	// Five wrong tries spend the sign-in, even if the sixth would have been right.
	let fourth = await api('user_login', { email: 'ana@example.test', password });
	for (let i = 0; i < 5; i++)
		assert.match((await api('user_totp', { token: fourth.body.token, code: '00000' + i })).failed, /not right/);
	assert.match((await api('user_totp', { token: fourth.body.token, code: recovery[1] })).failed, /took too long|too many/);
	assert.match((await api('user_totp', { token: 'forged', code: recovery[1] })).failed, /took too long|too many/);
	// An administrator removes it from someone who lost the phone; that person can then sign in with the password.
	assert.equal((await api('user_create', { name: 'Ben', email: 'ben@example.test', password: ben }, signed)).status, 200);
	let benCookie = (await api('user_login', { email: 'ben@example.test', password: ben })).cookie;
	let benBegin = (await api('user_totp_begin', { password: ben }, benCookie)).body;
	await api('user_totp_enable', { code: Totp.code(benBegin.secret) }, benCookie);
	let benId =
		(await api('bootstrap', {}, signed)).body.user.id !== undefined &&
		(await api('user_list', {}, signed)).body.users.find((u) => u.email === 'ben@example.test').id;
	assert.equal((await api('user_login', { email: 'ben@example.test', password: ben })).body.totp, true);
	assert.equal((await api('user_totp_reset', { id: benId, adminPassword: 'wrong-password-123' }, signed)).status >= 400, true);
	assert.equal(
		(await api('user_totp_reset', { id: benId, adminPassword: password }, benCookie)).status,
		401,
		'only an administrator (the framework answers 401 to a missing permission)'
	);
	let reset = await api('user_totp_reset', { id: benId, adminPassword: password }, signed);
	assert.equal(reset.body.user.totp, false);
	assert.ok((await api('user_login', { email: 'ben@example.test', password: ben })).cookie, 'back to the password alone');
	// Turning it off asks for the password and a code.
	assert.match((await api('user_totp_disable', { password, code: '111111' }, signed)).failed, /not right/);
	assert.match(
		(await api('user_totp_disable', { password: 'wrong-password-123', code: recovery[2] }, signed)).failed,
		/password is incorrect/
	);
	let off = await api('user_totp_disable', { password, code: recovery[2] }, signed);
	assert.equal(off.body.user.totp, false);
	assert.ok((await api('user_login', { email: 'ana@example.test', password })).cookie, 'the password alone again');
});
