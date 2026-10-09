require('total5');
const { test } = require('node:test'),
	assert = require('node:assert/strict'),
	fs = require('node:fs'),
	path = require('node:path'),
	os = require('node:os'),
	net = require('node:net'),
	{ spawn } = require('node:child_process');
const root = path.join(__dirname, '..');
test(
	'an app signs in once, stays signed in with a device token, and the person sees and ends their devices',
	{ timeout: 40000 },
	async (t) => {
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
		let health = await (await fetch(base + '/health/')).json();
		assert.equal(health.status, 'ok');
		assert.equal(health.api, 1);
		assert.equal(health.version, require('../package.json').version);

		let password = 'isolated-fixture-password-26';
		let setup = await api('user_setup', { name: 'Fixture Admin', email: 'admin@example.test', password });
		assert.equal(setup.body.success, true);
		let session = setup.cookie;
		let id = (await api('user_list', {}, { cookie: session })).body.users[0].id;
		// A mailbox of this person, written before the server first opens it.
		let message = (mid, over) => ({
			id: mid,
			accountId: 'a',
			folder: 'inbox',
			remote: false,
			sender: 'Ana',
			email: 'ana@example.test',
			subject: 'Offer',
			date: '2026-10-01T10:00:00.000Z',
			body: 'Hello',
			unread: true,
			starred: false,
			...over
		});
		fs.writeFileSync(
			path.join(directory, 'database/mail-' + id + '.json'),
			JSON.stringify({
				accounts: [{ id: 'a', name: 'Work', email: 'me@example.test', configured: true }],
				messages: [
					message('m1', {
						html: '<p>Visible words.</p><p style="display:none">HIDDEN INSTRUCTION</p>',
						body: 'plain part differs'
					})
				],
				drafts: []
			})
		);

		// Adding a device: signed in, and the password again.
		assert.equal((await api('device_create', { name: 'Mac', password })).status, 401, 'nobody signed in');
		let none = await api('device_create', { name: 'Mac', password: 'wrong-password-at-all' }, { cookie: session });
		assert.match(JSON.stringify(none.body), /password is incorrect/);
		assert.ok(Array.isArray((await api('device_create', { name: '', password }, { cookie: session })).body), 'a name is needed');
		let made = (
			await api('device_create', { name: "Gera's Mac", platform: 'macOS 26', app: 'TotalMail 1.0', password }, { cookie: session })
		).body;
		assert.match(made.token, /^tmd_[0-9a-f]{8}_/);
		assert.equal(made.device.name, "Gera's Mac");
		let token = made.token;

		// The app works with the token alone, with the header the page sends, and nothing else opens.
		let boot = (await api('bootstrap', {}, { bearer: token })).body;
		assert.equal(boot.user.role, 'admin');
		assert.deepEqual(
			boot.accounts.map((a) => a.id),
			['a']
		);
		assert.equal((await api('bootstrap', {}, { bearer: token, header: false })).status, 403, 'the header is still required');
		assert.equal((await api('bootstrap', {}, { bearer: 'tmd_00000000_' + 'a'.repeat(32) })).status, 401, 'a wrong token');
		assert.equal((await api('bootstrap', {}, { bearer: 'tm_' + token.slice(4) })).status, 401, 'another kind of token');
		assert.equal((await api('bootstrap', {}, { bearer: token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A') })).status, 401);
		assert.equal((await fetch(base + '/health/', { headers: { Authorization: 'Bearer ' + token } })).status, 200);

		// An app cannot add devices by itself, and sees which one it is.
		let nested = await api('device_create', { name: 'Another', password }, { bearer: token });
		assert.match(JSON.stringify(nested.body), /Sign in with your password/);
		let seen = (await api('device_list', {}, { bearer: token })).body.devices;
		assert.deepEqual(
			seen.map((d) => [d.name, d.platform, d.app, d.current]),
			[["Gera's Mac", 'macOS 26', 'TotalMail 1.0', true]]
		);
		assert.ok(seen[0].last && seen[0].address, 'when and from where');
		assert.equal((await api('device_list', {}, { cookie: session })).body.devices[0].current, false, 'a browser is not that device');
		assert.ok(!JSON.stringify(seen).includes(token));

		// The text of a message for a model on the device: what a reader reads.
		let text = (await api('message_text', { id: 'm1' }, { bearer: token })).body;
		assert.equal(text.text.includes('Visible words.'), true);
		assert.ok(!text.text.includes('HIDDEN INSTRUCTION') && !text.text.includes('plain part differs'));
		assert.equal(text.hidden, true);
		assert.equal(text.subject, 'Offer');
		assert.ok(Array.isArray((await api('message_text', { id: 'nope' }, { bearer: token })).body));

		// Only the owner ends a device; another person cannot.
		let other = (
			await api(
				'user_create',
				{ name: 'Second', email: 'second@example.test', password: 'second-fixture-password-26', role: 'member' },
				{ cookie: session }
			)
		).body;
		assert.ok(other);
		let second = await api('user_login', { email: 'second@example.test', password: 'second-fixture-password-26' });
		assert.deepEqual((await api('device_list', {}, { cookie: second.cookie })).body.devices, [], 'not theirs to see');
		assert.ok(Array.isArray((await api('device_revoke', { id: made.device.id }, { cookie: second.cookie })).body), 'not theirs to end');
		assert.equal((await api('bootstrap', {}, { bearer: token })).status, 200);

		// A second device, then the password changes: every app signs out.
		let again = (await api('device_create', { name: 'iPad', password }, { cookie: session })).body.token;
		assert.equal((await api('device_list', {}, { cookie: session })).body.devices.length, 2);
		let changed = await api(
			'user_profile',
			{
				name: 'Fixture Admin',
				email: 'admin@example.test',
				color: '#4285F4',
				language: 'en',
				currentPassword: password,
				newPassword: 'a-new-password-for-tests-27',
				confirmPassword: 'a-new-password-for-tests-27'
			},
			{ cookie: session }
		);
		assert.ok(!Array.isArray(changed.body), JSON.stringify(changed.body));
		assert.equal((await api('bootstrap', {}, { bearer: token })).status, 401, 'signed out with the password change');
		assert.equal((await api('bootstrap', {}, { bearer: again })).status, 401);

		// Signing out of one device (from the app itself): only that one stops.
		let fresh = await api('user_login', { email: 'admin@example.test', password: 'a-new-password-for-tests-27' });
		let cookie = fresh.cookie;
		let a = (await api('device_create', { name: 'A', password: 'a-new-password-for-tests-27' }, { cookie })).body;
		let b = (await api('device_create', { name: 'B', password: 'a-new-password-for-tests-27' }, { cookie })).body;
		let left = (await api('device_revoke', { id: a.device.id }, { bearer: a.token })).body.devices;
		assert.deepEqual(
			left.map((d) => d.name),
			['B']
		);
		assert.equal((await api('bootstrap', {}, { bearer: a.token })).status, 401, 'the device that signed out');
		assert.equal((await api('bootstrap', {}, { bearer: b.token })).status, 200, 'the other keeps working');
	}
);
