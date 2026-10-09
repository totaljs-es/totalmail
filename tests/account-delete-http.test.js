require('total5');
const { test } = require('node:test'),
	assert = require('node:assert/strict'),
	fs = require('node:fs'),
	path = require('node:path'),
	os = require('node:os'),
	net = require('node:net'),
	{ spawn } = require('node:child_process');
const root = path.join(__dirname, '..');
test('a person removes one of their accounts with its mail and drafts, and nothing of anyone else', { timeout: 40000 }, async (t) => {
	let directory = fs.mkdtempSync(path.join(os.tmpdir(), 'totalmail-http-'));
	for (let name of ['plugins', 'controllers', 'definitions', 'modules', 'lib', 'views', 'resources'])
		fs.cpSync(path.join(root, name), path.join(directory, name), { recursive: true });
	fs.copyFileSync(path.join(root, 'package.json'), path.join(directory, 'package.json'));
	fs.writeFileSync(path.join(directory, 'config'), 'name : TotalMail\n');
	fs.mkdirSync(path.join(directory, 'public'));
	for (let name of fs.readdirSync(path.join(root, 'public')).filter((n) => /^ui-ui-.*\.min\.js$/.test(n)))
		fs.copyFileSync(path.join(root, 'public', name), path.join(directory, 'public', name));
	fs.mkdirSync(path.join(directory, 'database'));
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
	child.stdout.on('data', (chunk) => (logs += chunk));
	child.stderr.on('data', (chunk) => (logs += chunk));
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
	// cookie: a browser session; bearer: an app. Both send the header the page sends.
	async function api(schema, data = {}, { cookie = '', bearer = '', header = true } = {}) {
		let response = await fetch(base + '/api/?lang=en', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				...(header ? { 'X-TotalMail': '1' } : {}),
				...(cookie ? { Cookie: cookie } : {}),
				...(bearer ? { Authorization: 'Bearer ' + bearer } : {})
			},
			body: JSON.stringify({ schema, data })
		});
		let raw = await response.text(),
			body;
		try {
			body = JSON.parse(raw);
		} catch {
			body = raw;
		}
		return { status: response.status, body, cookie: (response.headers.get('set-cookie') || '').split(';')[0] };
	}
	let password = 'isolated-fixture-password-26';
	let setup = await api('user_setup', { name: 'Fixture Admin', email: 'admin@example.test', password });
	assert.equal(setup.body.success, true);
	let session = setup.cookie;
	let account = (name, email) => ({
		name,
		email,
		imapHost: 'imap.example.test',
		imapPort: 993,
		imapSecurity: 'tls',
		imapUsername: email,
		smtpHost: 'smtp.example.test',
		smtpPort: 465,
		smtpSecurity: 'tls',
		smtpUsername: email,
		password: 'secret-' + name
	});
	let work = (await api('account_save', account('Work', 'work@example.test'), { cookie: session })).body;
	let home = (await api('account_save', account('Home', 'home@example.test'), { cookie: session })).body;
	assert.ok(work.id && home.id && work.id !== home.id);
	await api('draft_save', { accountId: work.id, to: 'a@example.test', subject: 'S', body: 'B' }, { cookie: session });
	await api('draft_save', { accountId: home.id, to: 'b@example.test', subject: 'S2', body: 'B2' }, { cookie: session });
	let before = (await api('bootstrap', {}, { cookie: session })).body;
	assert.equal(before.accounts.filter((a) => a.configured).length, 2);
	assert.equal(before.drafts.length, 2);

	// Without the page's header, or without signing in, nothing is removed.
	assert.equal((await api('account_delete', { id: work.id }, { cookie: session, header: false })).status, 403);
	assert.equal((await api('account_delete', { id: work.id })).status, 401);

	let removed = await api('account_delete', { id: work.id }, { cookie: session });
	assert.equal(removed.status, 200);
	assert.equal(removed.body.id, work.id);
	let after = (await api('bootstrap', {}, { cookie: session })).body;
	assert.deepEqual(
		after.accounts.filter((a) => a.configured).map((a) => a.id),
		[home.id]
	);
	assert.deepEqual(
		after.drafts.map((d) => d.accountId),
		[home.id],
		'the drafts of the other account stay'
	);

	let again = await api('account_delete', { id: work.id }, { cookie: session });
	assert.equal(again.status, 400, 'an account that is gone cannot be removed again');
	let nobody = await api('account_delete', { id: 'x'.repeat(40) }, { cookie: session });
	assert.equal(nobody.status, 400);
});
