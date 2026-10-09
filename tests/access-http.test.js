require('total5');
const { test } = require('node:test'),
	assert = require('node:assert/strict'),
	fs = require('node:fs'),
	path = require('node:path'),
	os = require('node:os'),
	net = require('node:net'),
	{ spawn } = require('node:child_process');
const root = path.join(__dirname, '..'),
	Db = require('./db');
test('native Actions enforce session, administrator privileges and private mailbox ownership', { timeout: 30000 }, async (t) => {
	let directory = fs.mkdtempSync(path.join(os.tmpdir(), 'totalmail-http-'));
	for (let name of ['plugins', 'controllers', 'definitions', 'modules', 'lib', 'views', 'resources'])
		fs.cpSync(path.join(root, name), path.join(directory, name), { recursive: true });
	fs.writeFileSync(path.join(directory, 'config'), 'name : TotalMail\n');
	fs.mkdirSync(path.join(directory, 'public'));
	for (let name of fs.readdirSync(path.join(root, 'public')).filter((n) => /^ui-ui-.*\.min\.js$/.test(n)))
		fs.copyFileSync(path.join(root, 'public', name), path.join(directory, 'public', name));
	fs.mkdirSync(path.join(directory, 'database'));
	fs.writeFileSync(path.join(directory, 'database/demo.json'), JSON.stringify(require('./fixtures/mail.json')));
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
	async function api(schema, data = {}, cookie = '', extra = {}) {
		let response = await fetch(base + '/api/?lang=en', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', 'X-TotalMail': '1', ...(cookie ? { Cookie: cookie } : {}), ...extra },
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
			cookieHeader: response.headers.get('set-cookie') || ''
		};
	}
	let password = 'isolated-fixture-password-26';
	let loginHtml = await (await fetch(base + '/?lang=sk')).text();
	assert.match(loginHtml, /Nastavenie TotalMail/);
	assert.match(loginHtml, /cdn\.componentator\.com\/spa\.min@20\.js/);
	assert.match(loginHtml, /\/_access\/access\.js/);
	let bundle = loginHtml.match(/src="([^"]*ui-ui-[^"]+\.js)"/)[1];
	assert.match(await (await fetch(base + bundle)).text(), /COMPONENT\('input'/);
	for (let schema of [
		'message_move',
		'folder_create',
		'user_profile',
		'bootstrap',
		'user_list',
		'account_save',
		'draft_save',
		'message_change',
		'account_discover',
		'account_verify',
		'account_sync',
		'message_read',
		'message_seen',
		'draft_send'
	])
		assert.equal((await api(schema)).status, 401, schema);
	assert.ok(
		Array.isArray(
			(await api('user_setup', { name: 'Rejected', email: 'wrong@example.test', password }, '', { 'X-TotalMail': '' })).body
		)
	);
	assert.ok(!loginHtml.includes('access.setupToken'));
	assert.ok(
		Array.isArray(
			(
				await api('user_setup', { name: 'Rejected', email: 'rejected@example.test', password }, '', {
					Origin: 'https://attacker.example'
				})
			).body
		)
	);
	let first = await api('user_setup', { name: 'Fixture Admin', email: 'admin@example.test', password }, '', {
		'X-Forwarded-For': '203.0.113.12'
	});
	assert.equal(first.body.success, true);
	assert.match(first.cookieHeader, /HttpOnly/i);
	assert.match(first.cookieHeader, /SameSite=Strict/i);
	let admin = first.cookie;
	assert.ok(Array.isArray((await api('user_setup', { name: 'Again', email: 'again@example.test', password })).body));
	let ownerMail = (await api('bootstrap', {}, admin)).body;
	assert.equal(ownerMail.user.role, 'admin');
	assert.deepEqual(ownerMail.accounts, []);
	assert.deepEqual(ownerMail.messages, []);
	assert.deepEqual(ownerMail.drafts, []);
	let ownerAccount = (
		await api(
			'account_save',
			{
				name: 'Owner mail',
				email: 'owner@example.test',
				imapHost: 'imap.example.com',
				imapPort: 993,
				imapSecurity: 'tls',
				imapUsername: 'owner@example.test',
				smtpHost: 'smtp.example.com',
				smtpPort: 465,
				smtpSecurity: 'tls',
				smtpUsername: 'owner@example.test',
				password: 'fixture-mail-secret'
			},
			admin
		)
	).body;
	await api(
		'draft_save',
		{
			id: 'preserved-draft',
			accountId: ownerAccount.id,
			to: 'fixture@example.test',
			subject: 'Existing draft',
			body: 'Original @(Inbox) content'
		},
		admin
	);
	assert.ok(
		Array.isArray(
			(
				await api('user_create', { name: 'Blocked', email: 'blocked@example.test', password }, admin, {
					Origin: 'https://attacker.example'
				})
			).body
		)
	);
	let memberCreated = (await api('user_create', { name: 'Member', email: 'member@example.test', password }, admin)).body;
	assert.equal(memberCreated.role, 'member');
	assert.equal((await api('user_list', {}, admin)).body.users.length, 2);
	assert.ok(Array.isArray((await api('user_login', { email: 'member@example.test', password: 'incorrect' })).body));
	let login = await api('user_login', { email: 'MEMBER@example.test', password });
	assert.equal(login.body.success, true);
	let member = login.cookie;
	let memberMail = (await api('bootstrap', {}, member)).body;
	assert.deepEqual(memberMail.accounts, []);
	assert.deepEqual(memberMail.messages, []);
	assert.deepEqual(memberMail.drafts, []);
	for (let schema of ['user_list', 'user_create'])
		assert.ok(Array.isArray((await api(schema, { name: 'Other', email: 'other@example.test', password }, member)).body));

	// Installation settings: administrators only, with the usual headers, and the client secret never comes back.
	let appId = '00000000-0000-4000-8000-000000000001',
		typeFields = {
			name: 'Acme mail',
			domains: 'acme.test',
			imapHost: 'imap.example.com',
			imapPort: 993,
			imapSecurity: 'tls',
			smtpHost: 'smtp.example.com',
			smtpPort: 465,
			smtpSecurity: 'tls',
			auth: 'password',
			steps: 'Ask IT for the password.'
		};
	assert.equal((await api('instance_get', {}, '')).status, 401);
	for (let [schema, input] of [
		['instance_get', {}],
		['instance_oauth', { provider: 'microsoft', clientId: appId, clientSecret: 'MEMBER-SECRET' }],
		['instance_type', typeFields],
		['instance_type_delete', { id: 'acme-mail' }],
		['instance_prefs', { hidden: 'gmail', defaultProvider: '' }]
	])
		assert.ok(Array.isArray((await api(schema, input, member)).body), schema + ' must be refused to a member');
	assert.ok(
		Array.isArray(
			(
				await api('instance_oauth', { provider: 'microsoft', clientId: appId, clientSecret: 'CSRF-SECRET' }, admin, {
					'X-TotalMail': ''
				})
			).body
		)
	);
	assert.ok(
		Array.isArray(
			(
				await api('instance_oauth', { provider: 'microsoft', clientId: appId, clientSecret: 'CSRF-SECRET' }, admin, {
					Origin: 'https://attacker.example'
				})
			).body
		)
	);
	assert.ok(
		Array.isArray((await api('instance_oauth', { provider: 'gmail', clientId: appId }, admin)).body),
		'only OAuth providers have an application'
	);
	assert.ok(Array.isArray((await api('instance_oauth', { provider: 'microsoft', clientId: 'nope' }, admin)).body));
	let overview = (await api('instance_get', {}, admin)).body;
	assert.equal(overview.defaultProvider, 'other');
	assert.ok(overview.types.some((t) => t.id === 'gmail' && !t.custom));
	assert.ok(overview.oauth.microsoft.returnUri.endsWith('/oauth/microsoft/callback'));
	let savedOauth = (
		await api('instance_oauth', { provider: 'microsoft', clientId: appId, tenant: 'common', clientSecret: 'ADMIN-SECRET-VALUE' }, admin)
	).body;
	assert.equal(savedOauth.oauth.microsoft.secretSet, true);
	assert.ok(!JSON.stringify(savedOauth).includes('ADMIN-SECRET-VALUE'));
	assert.ok(
		!Db.raw(path.join(directory, 'database'), 'instance_values').includes('ADMIN-SECRET-VALUE'),
		'the secret is encrypted at rest'
	);
	assert.ok(!JSON.stringify((await api('instance_get', {}, admin)).body).includes('ADMIN-SECRET-VALUE'));
	let created = (await api('instance_type', typeFields, admin)).body,
		acme = created.types.find((t) => t.custom);
	assert.ok(acme && acme.id.startsWith('acme'));
	assert.ok(
		Array.isArray((await api('instance_type', { ...typeFields, imapHost: '127.0.0.1' }, admin)).body),
		'private server addresses are refused'
	);
	assert.ok(
		Array.isArray((await api('instance_type', { ...typeFields, steps: 'Open | http://insecure.example' }, admin)).body),
		'only https links'
	);
	assert.ok(Array.isArray((await api('instance_type', { ...typeFields, id: 'gmail' }, admin)).body), 'shipped types cannot be edited');
	assert.ok(Array.isArray((await api('instance_prefs', { hidden: 'other', defaultProvider: '' }, admin)).body), 'Other cannot be hidden');
	assert.ok(Array.isArray((await api('instance_prefs', { hidden: '', defaultProvider: 'missing' }, admin)).body));
	await api('instance_prefs', { hidden: 'gmail', defaultProvider: acme.id }, admin);
	let offered = (await api('account_providers', {}, member)).body;
	assert.equal(offered.defaultProvider, acme.id);
	assert.ok(offered.providers.some((p) => p.id === acme.id));
	assert.ok(!offered.providers.some((p) => p.id === 'gmail'));
	assert.equal((await api('instance_type_delete', { id: acme.id }, admin)).body.defaultProvider, 'other');
	await api('instance_prefs', { hidden: '', defaultProvider: '' }, admin);

	// Managing people: administrators only, always confirmed with the administrator's own password.
	let extra = (await api('user_create', { name: 'Extra', email: 'extra@example.test', password }, admin)).body;
	assert.equal(extra.role, 'member');
	let frameId = 'imap-' + 'ab'.repeat(32);
	fs.writeFileSync(
		path.join(directory, 'database', 'mail-' + extra.id + '.json'),
		JSON.stringify({
			accounts: [],
			messages: [
				{
					id: frameId,
					accountId: 'seeded',
					remote: true,
					folder: 'inbox',
					mailboxPath: 'INBOX',
					uid: 1,
					uidValidity: '1',
					sender: 'Sender',
					email: 's@example.test',
					subject: 'Formatted <u>x</u>',
					date: '2026-10-09T10:00:00.000Z',
					body: 'plain text',
					bodyLoaded: true,
					hasHtml: true,
					remoteImages: 1,
					html: '<p>FRAME-MARKER</p><img data-remote-src="https://tracker.example/p.gif">',
					unread: false,
					starred: false
				}
			],
			drafts: []
		})
	);
	let extraSession = (await api('user_login', { email: 'extra@example.test', password })).cookie;
	assert.equal((await api('bootstrap', {}, extraSession)).status, 200);
	// Formatted mail: its own route and policy, only for the owner, images blocked unless asked for, and never inside the message list.
	let frameGet = (id, cookie, query = '') => fetch(base + '/html/' + id + '/' + query, { headers: cookie ? { Cookie: cookie } : {} });
	let framed = await frameGet(frameId, extraSession);
	assert.equal(framed.status, 200);
	let framedHtml = await framed.text();
	assert.match(framedHtml, /FRAME-MARKER/);
	assert.ok(framedHtml.includes('data-remote-src="https://tracker.example/p.gif"'));
	assert.ok(!/ src="https:\/\/tracker/.test(framedHtml), 'remote images are off by default');
	let policy = framed.headers.get('content-security-policy');
	assert.match(policy, /^sandbox allow-popups allow-popups-to-escape-sandbox;/);
	assert.match(policy, /default-src 'none'/);
	assert.ok(!/allow-scripts|allow-same-origin/.test(policy));
	assert.ok(!/https:/.test(policy));
	assert.equal(framed.headers.get('x-content-type-options'), 'nosniff');
	assert.match(policy, /frame-ancestors http:\/\/127\.0\.0\.1:\d+;/);
	assert.equal(framed.headers.get('x-frame-options'), null);
	assert.equal(framed.headers.get('referrer-policy'), 'no-referrer');
	assert.match(framed.headers.get('cache-control'), /no-store/);
	assert.match(framed.headers.get('content-type'), /text\/html/);
	let withImages = await frameGet(frameId, extraSession, '?images=1');
	assert.match(withImages.headers.get('content-security-policy'), /img-src data: https: http:/);
	assert.ok(/ src="https:\/\/tracker\.example\/p\.gif"/.test(await withImages.text()));
	let printed = await fetch(base + '/print/' + frameId + '/', { headers: { Cookie: extraSession } });
	assert.equal(printed.status, 200);
	let printedHtml = await printed.text();
	assert.match(printedHtml, /FRAME-MARKER/);
	assert.ok(printedHtml.includes('Formatted &lt;u&gt;x&lt;/u&gt;') && !printedHtml.includes('<u>x</u>'), 'the subject is escaped');
	assert.ok(!/ src="https:\/\/tracker/.test(printedHtml), 'remote images are off by default in print too');
	assert.match(printed.headers.get('content-security-policy'), /^sandbox /);
	assert.equal(
		(await fetch(base + '/print/' + frameId + '/', { headers: { Cookie: member } })).status,
		404,
		'another person cannot print it'
	);
	assert.equal((await frameGet(frameId, '')).status, 401, 'no session');
	assert.equal((await frameGet(frameId, member)).status, 404, 'another person has no such message');
	for (let id of ['imap-short', '../etc/passwd', 'imap-' + 'g'.repeat(64), 'imap-' + 'cd'.repeat(32)])
		assert.equal((await frameGet(id, extraSession)).status, 404, id);
	let listed = JSON.stringify((await api('bootstrap', {}, extraSession)).body);
	assert.ok(!listed.includes('FRAME-MARKER') && !listed.includes('tracker.example'), 'the HTML is not in the list of messages');
	assert.ok(listed.includes('"hasHtml":true'));
	let extraAccount = (
		await api(
			'account_save',
			{
				name: 'Extra mail',
				email: 'extra@mail.test',
				imapHost: 'imap.example.com',
				imapPort: 993,
				imapSecurity: 'tls',
				imapUsername: 'extra',
				smtpHost: 'smtp.example.com',
				smtpPort: 465,
				smtpSecurity: 'tls',
				smtpUsername: 'extra',
				password: 'x'
			},
			extraSession
		)
	).body;
	assert.ok(extraAccount.id);
	let extraTable = path.join(directory, 'database', 'mail_' + extra.id + '_accounts');
	assert.ok(Db.raw(path.join(directory, 'database'), 'mail_' + extra.id + '_accounts').includes('extra@mail.test'));
	let newer = 'replacement-password-2026';
	for (let [schema, input] of [
		['user_reset', { password: newer }],
		['user_role', { role: 'admin' }],
		['user_disable', { disabled: true }],
		['user_remove', {}]
	]) {
		assert.ok(
			Array.isArray((await api(schema, { id: extra.id, adminPassword: password, ...input }, member)).body),
			schema + ' must be refused to a member'
		);
		assert.ok(
			Array.isArray((await api(schema, { id: extra.id, adminPassword: 'wrong-password-123', ...input }, admin)).body),
			schema + ' needs the administrator password'
		);
		assert.ok(
			Array.isArray((await api(schema, { id: extra.id, adminPassword: password, ...input }, admin, { 'X-TotalMail': '' })).body)
		);
		assert.ok(
			Array.isArray(
				(await api(schema, { id: extra.id, adminPassword: password, ...input }, admin, { Origin: 'https://attacker.example' })).body
			)
		);
		assert.ok(
			Array.isArray((await api(schema, { id: ownerMail.user.id, adminPassword: password, ...input }, admin)).body),
			schema + ' is refused on the own account'
		);
		assert.equal((await api(schema, { id: extra.id, adminPassword: password, ...input }, '')).status, 401);
	}
	assert.equal((await api('bootstrap', {}, extraSession)).status, 200, 'nothing above changed the person');
	assert.ok(Array.isArray((await api('user_reset', { id: extra.id, adminPassword: password, password: 'short' }, admin)).body));
	assert.equal((await api('user_reset', { id: extra.id, adminPassword: password, password: newer }, admin)).body.user.id, extra.id);
	assert.equal((await api('bootstrap', {}, extraSession)).status, 401, 'a reset closes open sessions');
	assert.ok(Array.isArray((await api('user_login', { email: 'extra@example.test', password })).body), 'the old password stops working');
	let afterReset = (await api('user_login', { email: 'extra@example.test', password: newer })).cookie;
	assert.equal((await api('bootstrap', {}, afterReset)).status, 200);
	assert.ok(!Db.raw(path.join(directory, 'database'), 'users_users').includes(newer));
	assert.equal((await api('user_role', { id: extra.id, adminPassword: password, role: 'admin' }, admin)).body.user.role, 'admin');
	assert.equal((await api('user_list', {}, afterReset)).status, 200, 'a promoted person can list users');
	assert.equal((await api('user_role', { id: extra.id, adminPassword: password, role: 'member' }, admin)).body.user.role, 'member');
	assert.ok(Array.isArray((await api('user_list', {}, afterReset)).body), 'and loses it again');
	assert.equal((await api('user_disable', { id: extra.id, adminPassword: password, disabled: true }, admin)).body.user.disabled, true);
	assert.equal((await api('bootstrap', {}, afterReset)).status, 401, 'disabling closes sessions');
	assert.ok(
		Array.isArray((await api('user_login', { email: 'extra@example.test', password: newer })).body),
		'a disabled person cannot sign in'
	);
	assert.equal((await api('user_list', {}, admin)).body.users.find((u) => u.id === extra.id).disabled, true);
	assert.equal((await api('user_disable', { id: extra.id, adminPassword: password, disabled: false }, admin)).body.user.disabled, false);
	let back = (await api('user_login', { email: 'extra@example.test', password: newer })).cookie;
	assert.equal((await api('bootstrap', {}, back)).status, 200);
	assert.equal((await api('user_remove', { id: extra.id, adminPassword: password }, admin)).body.user.id, extra.id);
	assert.equal((await api('bootstrap', {}, back)).status, 401, 'a removed person has no session');
	assert.ok(Array.isArray((await api('user_login', { email: 'extra@example.test', password: newer })).body));
	assert.ok(
		!fs.existsSync(extraTable) && !fs.existsSync(path.join(directory, 'database', 'mail-' + extra.id + '.json.migrated')),
		'their mailbox data is deleted'
	);
	assert.ok(!(await api('user_list', {}, admin)).body.users.some((u) => u.id === extra.id));
	assert.ok(
		Array.isArray((await api('user_remove', { id: extra.id, adminPassword: password }, admin)).body),
		'an unknown person is not found'
	);
	// Server search: only the owner, with the usual headers, and a sensible text.
	assert.equal((await api('account_search', { accountId: ownerAccount.id, path: 'INBOX', query: 'invoice' }, '')).status, 401);
	assert.ok(
		Array.isArray((await api('account_search', { accountId: ownerAccount.id, path: 'INBOX', query: 'invoice' }, member)).body),
		'another person cannot search an account that is not theirs'
	);
	assert.ok(
		Array.isArray(
			(await api('account_search', { accountId: ownerAccount.id, path: 'INBOX', query: 'invoice' }, admin, { 'X-TotalMail': '' }))
				.body
		)
	);
	assert.ok(
		Array.isArray(
			(
				await api('account_search', { accountId: ownerAccount.id, path: 'INBOX', query: 'invoice' }, admin, {
					Origin: 'https://attacker.example'
				})
			).body
		)
	);
	assert.ok(
		Array.isArray((await api('account_search', { accountId: ownerAccount.id, path: 'INBOX', query: 'x' }, admin)).body),
		'a one-letter text is refused'
	);
	// Permanent deletion and emptying the trash: only the owner, with the usual headers, and only for the trash.
	assert.equal((await api('message_erase', { id: 'private-message' }, '')).status, 401);
	assert.equal((await api('trash_empty', { accountId: ownerAccount.id }, '')).status, 401);
	assert.ok(Array.isArray((await api('message_erase', { id: 'private-message' }, member)).body));
	assert.ok(
		Array.isArray((await api('trash_empty', { accountId: ownerAccount.id }, member)).body),
		'another person cannot empty an account that is not theirs'
	);
	assert.ok(Array.isArray((await api('trash_empty', { accountId: ownerAccount.id }, admin, { 'X-TotalMail': '' })).body));
	assert.ok(Array.isArray((await api('message_erase', { id: 'private-message' }, admin, { Origin: 'https://attacker.example' })).body));
	// Rules: only for the person's own accounts, with the usual headers, and only what Rules.validate accepts.
	let ruleInput = { accountId: ownerAccount.id, name: 'News', field: 'from', op: 'contains', value: 'github', action: 'archive' };
	assert.equal((await api('rule_save', ruleInput, '')).status, 401);
	for (let [schema, input] of [
		['rule_save', ruleInput],
		['rule_delete', { accountId: ownerAccount.id, id: 'x' }],
		['rule_test', { accountId: ownerAccount.id, field: 'from', op: 'is', value: 'x' }]
	])
		assert.ok(Array.isArray((await api(schema, input, member)).body), schema + ' must be refused for an account that is not theirs');
	assert.ok(Array.isArray((await api('rule_save', ruleInput, admin, { 'X-TotalMail': '' })).body));
	assert.ok(Array.isArray((await api('rule_save', ruleInput, admin, { Origin: 'https://attacker.example' })).body));
	for (let bad of [{ action: 'forward' }, { field: 'body' }, { value: '' }, { action: 'move', path: 'Nowhere' }, { name: '' }])
		assert.ok(Array.isArray((await api('rule_save', { ...ruleInput, ...bad }, admin)).body), JSON.stringify(bad));
	let savedRule = (await api('rule_save', ruleInput, admin)).body;
	assert.equal(savedRule.rules.length, 1);
	assert.equal(savedRule.rules[0].action, 'archive');
	assert.ok(savedRule.rules[0].id);
	assert.ok(
		Array.isArray((await api('rule_save', { ...ruleInput, id: 'not-a-rule' }, admin)).body),
		'a rule that does not exist cannot be edited'
	);
	assert.equal(
		(await api('rule_save', { ...ruleInput, id: savedRule.rules[0].id, enabled: false, value: 'gitlab' }, admin)).body.rules[0].enabled,
		false
	);
	assert.equal(
		(await api('rule_test', { accountId: ownerAccount.id, field: 'from', op: 'contains', value: 'gitlab' }, admin)).body.matching,
		0
	);
	assert.equal((await api('rule_delete', { accountId: ownerAccount.id, id: savedRule.rules[0].id }, admin)).body.rules.length, 0);
	assert.ok(Array.isArray((await api('message_change', { id: 'private-message', operation: 'archive' }, member)).body));
	assert.ok(Array.isArray((await api('message_read', { id: 'private-message' }, member)).body));
	assert.ok(Array.isArray((await api('message_seen', { id: 'private-message' }, member)).body));
	assert.ok(Array.isArray((await api('message_move', { id: 'private-message', path: 'INBOX' }, member)).body));
	assert.ok(Array.isArray((await api('folder_create', { accountId: ownerAccount.id, name: 'Foreign' }, member)).body));
	assert.ok(
		Array.isArray(
			(await api('folder_create', { accountId: ownerAccount.id, name: 'Blocked' }, admin, { Origin: 'https://attacker.example' }))
				.body
		)
	);
	assert.ok(Array.isArray((await api('message_move', { id: 'private-message', path: 'INBOX' }, admin, { 'X-TotalMail': '' })).body));
	assert.ok(Array.isArray((await api('account_verify', { accountId: ownerAccount.id }, member)).body));
	assert.ok(Array.isArray((await api('account_sync', { accountId: ownerAccount.id, path: 'INBOX' }, member)).body));
	assert.ok(
		Array.isArray((await api('draft_send', { id: 'preserved-draft', confirmed: true, revision: 'fixture-revision' }, member)).body)
	);
	assert.ok(Array.isArray((await api('draft_save', { id: 'preserved-draft', accountId: ownerAccount.id, body: 'attack' }, member)).body));
	let settings = {
		name: 'Member mail',
		email: 'mail@example.test',
		imapHost: 'imap.example.com',
		imapPort: 993,
		imapSecurity: 'tls',
		imapUsername: 'mail@example.test',
		smtpHost: 'smtp.example.com',
		smtpPort: 465,
		smtpSecurity: 'tls',
		smtpUsername: 'mail@example.test',
		password: 'fixture-mail-secret'
	};
	let account = (await api('account_save', settings, member)).body;
	assert.equal(account.configured, true);
	assert.ok(!('secret' in account));
	assert.ok(account.id);
	assert.ok(Array.isArray((await api('account_save', { ...settings, id: account.id }, admin)).body));
	assert.ok(Array.isArray((await api('account_save', { ...settings, imapHost: '127.0.0.1' }, member)).body));
	assert.ok(Array.isArray((await api('account_save', { ...settings, smtpPort: 65536 }, member)).body));
	await api('account_save', { ...settings, id: account.id, name: 'Edited', password: '' }, member);
	let data = (await api('bootstrap', {}, member)).body;
	assert.equal(data.accounts.length, 1);
	assert.equal(data.accounts[0].name, 'Edited');
	assert.ok(!('secret' in data.accounts[0]));
	let dbdir = path.join(directory, 'database'),
		disk = Db.raw(dbdir, 'mail_' + memberMail.user.id + '_accounts');
	assert.ok(!disk.includes(settings.password));
	let stored = Db.rows(dbdir, 'mail_' + memberMail.user.id + '_accounts')[0];
	assert.ok(stored.secret.tag);
	assert.equal(Db.keys(dbdir).decrypt(stored.secret), settings.password);
	await api('account_save', { ...settings, id: account.id, authType: 'oauth2', password: '' }, member);
	let oauthStored = Db.rows(dbdir, 'mail_' + memberMail.user.id + '_accounts')[0];
	assert.equal(oauthStored.authType, 'oauth2');
	assert.equal(oauthStored.secret, null);
	assert.equal((await api('bootstrap', {}, admin)).body.accounts.length, 1);
	assert.equal((await api('bootstrap', {}, admin)).body.drafts[0].body, 'Original @(Inbox) content');
	let identities = Db.raw(path.join(directory, 'database'), 'users_users');
	assert.ok(!identities.includes(password));
	assert.ok(Array.isArray((await api('draft_save', { accountId: account.id, subject: 'No CSRF' }, member, { 'X-TotalMail': '' })).body));
	let draft = (await api('draft_save', { accountId: account.id, subject: 'Private draft' }, member)).body;
	assert.ok(draft.id);
	let hidden = (
		await api('draft_save', { id: draft.id, accountId: account.id, subject: 'Private draft', bcc: 'quiet@example.test' }, member)
	).body;
	assert.equal(hidden.bcc, 'quiet@example.test');
	assert.ok(
		Array.isArray((await api('draft_save', { id: draft.id, accountId: account.id, bcc: 'x'.repeat(501) }, member)).body),
		'a hidden-recipient list is bounded'
	);
	// Signatures belong to the account and are cleaned.
	await api('account_save', { ...settings, id: account.id, signature: '  Gera\r\nTotal.js\u0000  ', password: '' }, member);
	assert.equal((await api('bootstrap', {}, member)).body.accounts.find((a) => a.id === account.id).signature, 'Gera\nTotal.js');
	assert.ok(
		Array.isArray((await api('account_save', { ...settings, id: account.id, signature: 'x'.repeat(1001), password: '' }, member)).body),
		'a signature is bounded'
	);
	await api('account_save', { ...settings, id: account.id, password: '' }, member);
	assert.equal(
		(await api('bootstrap', {}, member)).body.accounts.find((a) => a.id === account.id).signature,
		'Gera\nTotal.js',
		'an update that does not mention the signature keeps it'
	);
	let memberProfile = {
		name: 'Profile Member',
		email: 'member@example.test',
		color: '#225544',
		language: 'sk',
		id: ownerMail.user.id,
		role: 'admin'
	};
	assert.ok(Array.isArray((await api('user_profile', memberProfile, member, { Origin: 'https://attacker.example' })).body));
	assert.ok(Array.isArray((await api('user_profile', memberProfile, member, { 'X-TotalMail': '' })).body));
	let ownProfile = (await api('user_profile', memberProfile, member)).body;
	assert.equal(ownProfile.user.id, memberMail.user.id);
	assert.equal(ownProfile.user.role, 'member');
	assert.equal((await api('bootstrap', {}, admin)).body.user.name, 'Fixture Admin');
	let preferredHtml = await (await fetch(base + '/', { headers: { Cookie: member } })).text();
	assert.match(preferredHtml, /<html lang="sk"/);
	assert.match(preferredHtml, /--color: #225544/);
	let explicitHtml = await (await fetch(base + '/?lang=en', { headers: { Cookie: member } })).text();
	assert.match(explicitHtml, /<html lang="en"/);
	let secondAdmin = (await api('user_login', { email: 'admin@example.test', password })).cookie;
	let adminProfile = { name: 'Updated Admin', email: 'admin@example.test', color: '#663399', language: 'es' };
	for (let change of [
		{ email: 'updated@example.test' },
		{ email: 'updated@example.test', currentPassword: 'wrong' },
		{ color: 'bad' },
		{ language: 'zz' },
		{ newPassword: 'fixture-new-password-26', confirmPassword: 'different', currentPassword: password },
		{ email: 'member@example.test', currentPassword: password }
	])
		assert.ok(Array.isArray((await api('user_profile', { ...adminProfile, ...change }, admin)).body));
	let newPassword = 'fixture-new-password-26';
	let updated = await api(
		'user_profile',
		{ ...adminProfile, email: 'updated@example.test', currentPassword: password, newPassword, confirmPassword: newPassword },
		admin
	);
	assert.equal(updated.body.user.id, ownerMail.user.id);
	assert.equal(updated.body.user.role, 'admin');
	assert.equal(updated.body.credentialsChanged, true);
	assert.equal((await api('bootstrap', {}, secondAdmin)).status, 401);
	assert.equal((await api('bootstrap', {}, admin)).status, 401);
	let currentAdmin = updated.cookie;
	assert.equal((await api('bootstrap', {}, currentAdmin)).body.drafts[0].body, 'Original @(Inbox) content');
	assert.ok(Array.isArray((await api('user_login', { email: 'admin@example.test', password })).body));
	assert.ok(Array.isArray((await api('user_login', { email: 'updated@example.test', password })).body));
	assert.equal((await api('user_login', { email: 'updated@example.test', password: newPassword })).body.success, true);
	let updatedDisk = Db.raw(path.join(directory, 'database'), 'users_users');
	assert.ok(!updatedDisk.includes(newPassword));
	await api('user_logout', {}, member);
	assert.equal((await api('bootstrap', {}, member)).status, 401);
	assert.ok(!JSON.stringify((await api('bootstrap', {}, currentAdmin)).body).includes('Private draft'));
});
