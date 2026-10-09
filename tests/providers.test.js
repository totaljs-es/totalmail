require('total5');
const { test } = require('node:test');
const Assert = require('node:assert/strict');
const Fs = require('node:fs'),
	Path = require('node:path');
const Providers = require('../lib/providers'),
	Live = require('../lib/live');
const root = Path.join(__dirname, '../plugins');
const shipped = Fs.readdirSync(Path.join(root, 'accounts/providers')).filter((n) => n.endsWith('.json'));

test('every shipped provider file is valid, unique and ordered, with Other first', () => {
	var list = Providers.create(root).list();
	Assert.equal(list.length, shipped.length);
	Assert.equal(list[0].id, 'other');
	Assert.equal(new Set(list.map((p) => p.id)).size, list.length);
	for (var p of list) {
		Assert.ok(p.discover || (p.imap && p.smtp), p.id);
		Assert.ok(
			p.steps.every((s) => !s.url || s.url.startsWith('https://')),
			p.id
		);
		Assert.ok(!JSON.stringify(p).match(/password"\s*:\s*"[^"]/i), 'no stored secrets');
	}
	Assert.equal(list.find((p) => p.id === 'microsoft').auth, 'oauth2');
	Assert.ok(list.find((p) => p.id === 'microsoft').setup.length > 0, 'unconfigured OAuth providers carry administrator steps');
	for (var id of ['gmail', 'icloud', 'yahoo'])
		Assert.equal(list.find((p) => p.id === id).auth, 'app-password');
});
test('personal Microsoft mailboxes get their own outgoing server, work mailboxes the shared one', () => {
	var catalogue = Providers.create(root),
		microsoft = catalogue.get('microsoft');
	Assert.equal(Providers.serversFor(microsoft, 'someone@outlook.com').smtp.host, 'smtp-mail.outlook.com');
	Assert.equal(Providers.serversFor(microsoft, 'Someone@HOTMAIL.com').smtp.host, 'smtp-mail.outlook.com');
	Assert.equal(Providers.serversFor(microsoft, 'jane@contoso.example').smtp.host, 'smtp.office365.com');
	Assert.equal(Providers.serversFor(microsoft, 'a@outlook.com').imap.host, 'outlook.office365.com');
	Assert.equal(Providers.serversFor(catalogue.get('gmail'), 'a@gmail.com').smtp.host, 'smtp.gmail.com');
	var good = JSON.parse(Fs.readFileSync(Path.join(root, 'accounts/providers/microsoft.json'), 'utf8'));
	Assert.throws(() =>
		Providers.validate({
			...good,
			personal: { domains: ['outlook.com'], smtp: { host: '127.0.0.1', port: 587, security: 'starttls' } }
		})
	);
});
test('invalid provider definitions are rejected instead of half applied', () => {
	var good = JSON.parse(Fs.readFileSync(Path.join(root, 'accounts/providers/gmail.json'), 'utf8'));
	Assert.ok(Providers.validate(good));
	for (var bad of [
		{ ...good, id: 'Bad Id' },
		{ ...good, auth: 'plaintext' },
		{ ...good, imap: { ...good.imap, host: '127.0.0.1' } },
		{ ...good, imap: { ...good.imap, port: 0 } },
		{ ...good, smtp: undefined },
		{ ...good, steps: [{ text: 'x', url: 'http://example.com' }] },
		{ ...good, steps: [{ text: 'x', url: 'javascript:alert(1)' }] },
		{ ...good, name: '' }
	])
		Assert.throws(() => Providers.validate(bad));
});
test('detection uses the domain, then the MX records, and falls back to nothing', async () => {
	var queried = [];
	var catalogue = Providers.create(root, async (domain) => {
		queried.push(domain);
		if (domain === 'contoso.example')
			return [{ exchange: 'contoso-example.mail.protection.outlook.com.', priority: 0 }];
		if (domain === 'empresa.es')
			return [{ exchange: 'aspmx.l.google.com', priority: 1 }];
		if (domain === 'slow.test')
			return new Promise(() => {});
		if (domain === 'broken.test')
			throw Error('ENOTFOUND');
		return [{ exchange: 'mail.hosting.example', priority: 10 }];
	});
	Assert.equal(await catalogue.detect('a@gmail.com'), 'gmail');
	Assert.equal(await catalogue.detect('a@ICLOUD.com'), 'icloud');
	Assert.deepEqual(queried, []);
	Assert.equal(await catalogue.detect('jane@contoso.example'), 'microsoft');
	Assert.equal(await catalogue.detect('x@empresa.es'), 'gmail');
	Assert.equal(await catalogue.detect('x@mi-hosting.test'), '');
	Assert.equal(await catalogue.detect('x@broken.test'), '');
	Assert.equal(await catalogue.detect('not-an-email'), '');
	Assert.equal(await catalogue.detect(''), '');
	Assert.ok(
		queried.every((d) => !d.includes('@')),
		'only domains are looked up'
	);
	var started = Date.now();
	Assert.equal(await catalogue.detect('x@slow.test'), '');
	Assert.ok(Date.now() - started < 4000);
});
test('a rejected sign-in names the kind of credential the provider needs', async () => {
	var catalogue = Providers.create(root, async (domain) =>
		domain === 'contoso.example' ? [{ exchange: 'x.mail.protection.outlook.com' }] : []
	);
	var account = (email) => ({
		id: 'a',
		email,
		authType: 'password',
		secret: {},
		imap: { host: 'imap.example.test' },
		smtp: { host: 'smtp.example.test' }
	});
	async function failing(email, error) {
		var store = { account: () => account(email), setConnection: async () => ({}) };
		var live = Live.create({
			providers: catalogue,
			resolve: async () => ({}),
			decrypt: () => 'x',
			imap: {
				probe: async () => {
					throw error;
				}
			},
			smtp: { options: () => ({}), verify: async () => {} }
		});
		return live.verify({ id: 'u' }, store, 'a').then(
			() => null,
			(err) => err.message
		);
	}
	var denied = Object.assign(Error('Command failed'), { authenticationFailed: true });
	Assert.match(await failing('g@contoso.example', denied), /requires OAuth/);
	Assert.match(await failing('g@gmail.com', denied), /app password/);
	Assert.match(await failing('g@mi-dominio.test', denied), /Check the username and password/);
	var network = Error('connect ETIMEDOUT');
	Assert.equal(await failing('g@gmail.com', network), 'connect ETIMEDOUT');
});
