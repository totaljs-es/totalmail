require('total5');
const { test } = require('node:test');
const Assert = require('node:assert/strict');
const Fs = require('node:fs'),
	Os = require('node:os'),
	Path = require('node:path'),
	Db = require('./db');
const Instance = require('../lib/instance'),
	Providers = require('../lib/providers'),
	Oauth = require('../lib/oauth');
const root = Path.join(__dirname, '../plugins');
const sealer = {
	encrypt: (v) => ({ sealed: Buffer.from(v).toString('base64') }),
	decrypt: (v) => Buffer.from(v.sealed, 'base64').toString()
};
const ID = '00000000-0000-4000-8000-000000000001';
function fixture(t) {
	var dir = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'totalmail-instance-'));
	t.after(() => Fs.rmSync(dir, { recursive: true, force: true }));
	return { dir, make: () => Instance.open({ table: Db.table(dir), crypto: sealer }) };
}
const good = {
	id: 'acme',
	order: 200,
	name: 'Acme mail',
	icon: 'server',
	auth: 'password',
	domains: ['acme.test'],
	username: 'email',
	imap: { host: 'imap.acme.test', port: 993, security: 'tls' },
	smtp: { host: 'smtp.acme.test', port: 465, security: 'tls' },
	steps: [{ text: 'Ask IT for a password.' }]
};

test('the sign-in secret is stored encrypted, never shown, kept when left empty and removable', async (t) => {
	var f = fixture(t),
		store = await f.make();
	await store.saveOAuth('microsoft', { clientId: ID, clientSecret: 'TOP-SECRET', tenant: 'common' });
	Assert.deepEqual(store.view().oauth.microsoft, { clientId: ID, tenant: 'common', secretSet: true });
	Assert.ok(!JSON.stringify(store.view()).includes('TOP-SECRET'));
	var onDisk = Fs.readdirSync(f.dir)
		.map((name) => Fs.readFileSync(Path.join(f.dir, name), 'utf8'))
		.join('');
	Assert.ok(onDisk.includes('microsoft') && !onDisk.includes('TOP-SECRET'), 'encrypted at rest');
	Assert.equal(store.oauth('microsoft').clientSecret, 'TOP-SECRET');
	await store.saveOAuth('microsoft', { clientId: ID, tenant: 'organizations' });
	Assert.equal(store.oauth('microsoft').clientSecret, 'TOP-SECRET', 'an empty secret keeps the saved one');
	Assert.equal(store.oauth('microsoft').tenant, 'organizations');
	Assert.equal((await f.make()).oauth('microsoft').clientSecret, 'TOP-SECRET', 'survives a restart');
	await store.saveOAuth('microsoft', { clientId: ID, clearSecret: true });
	Assert.equal(store.oauth('microsoft').clientSecret, '');
	Assert.equal(store.view().oauth.microsoft.secretSet, false);
	await Assert.rejects(store.saveOAuth('microsoft', { clientId: 'not-an-id' }));
	await Assert.rejects(store.saveOAuth('microsoft', { clientId: ID, tenant: 'evil/../x' }));
	Assert.deepEqual(store.oauth('unknown'), {});
});
test('the sign-in application of a provider is what the administrator saved, and nothing else', async (t) => {
	var f = fixture(t),
		store = await f.make();
	Oauth.useInstance(store);
	try {
		Assert.deepEqual(Oauth.settings('microsoft'), { clientId: '', clientSecret: '', tenant: 'common' });
		await store.saveOAuth('microsoft', { clientId: ID, clientSecret: 'from-window', tenant: 'consumers' });
		Assert.deepEqual(Oauth.settings('microsoft'), { clientId: ID, clientSecret: 'from-window', tenant: 'consumers' });
		await store.saveOAuth('microsoft', { clientId: '', clearSecret: true });
		Assert.deepEqual(Oauth.settings('microsoft'), { clientId: '', clientSecret: '', tenant: 'common' });
	} finally {
		Oauth.useInstance({ oauth: () => ({}) });
	}
});
test('account types added here join the catalogue, can be hidden or made the default, and never override shipped ones', async (t) => {
	var f = fixture(t),
		store = await f.make();
	var catalogue = Providers.create(root, async () => [], store);
	Assert.equal(catalogue.defaultId(), 'other');
	await store.saveProvider(good);
	await store.saveProvider({ ...good, id: 'gmail', name: 'Impostor' });
	await store.saveProvider({ ...good, id: 'evil-oauth', auth: 'oauth2' });
	await store.saveProvider({ ...good, id: 'bad-host', imap: { host: '127.0.0.1', port: 993, security: 'tls' } });
	var ids = catalogue.list().map((p) => p.id);
	Assert.ok(ids.includes('acme'));
	Assert.ok(!ids.includes('evil-oauth') && !ids.includes('bad-host'), 'invalid or OAuth-only entries are ignored');
	Assert.equal(catalogue.get('gmail').name, 'Gmail', 'shipped types cannot be replaced');
	Assert.equal(catalogue.get('acme').custom, true);
	Assert.equal(await catalogue.detect('someone@acme.test'), 'acme');
	await store.savePrefs({ hidden: ['gmail', 'other'], defaultProvider: 'acme' });
	var visible = catalogue.list().map((p) => p.id);
	Assert.ok(!visible.includes('gmail'), 'hidden types are not offered');
	Assert.ok(visible.includes('other'), 'Other can never be hidden');
	Assert.ok(catalogue.get('gmail'), 'but existing accounts still resolve them');
	Assert.equal(catalogue.defaultId(), 'acme');
	Assert.equal(catalogue.list().find((p) => p.id === 'acme').isDefault, true);
	Assert.equal(await catalogue.detect('x@gmail.com'), '', 'a hidden type is not suggested');
	await store.deleteProvider('acme');
	Assert.equal(catalogue.defaultId(), 'other', 'deleting the default falls back to Other');
	await Assert.rejects(store.deleteProvider('acme'));
	Assert.equal((await f.make()).providers().length, 3, 'stored entries survive a restart');
});
