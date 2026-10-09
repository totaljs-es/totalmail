require('total5');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Db = require('./db');
const seed = require('./fixtures/mail.json');
function fixture(t) {
	let dir = fs.mkdtempSync(path.join(os.tmpdir(), 'totalmail-test-'));
	t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
	return { store: Db.store(dir, seed), dir };
}
test('draft edits survive restart without creating duplicate drafts', async (t) => {
	let { store, dir } = fixture(t);
	let draft = {
		id: 'draft-one',
		accountId: 'studio',
		to: 'test@example.com',
		subject: 'Respuesta',
		body: 'Primera versión',
		replyTo: 'm1'
	};
	await store.saveDraft(draft);
	await store.saveDraft({ ...draft, body: 'Versión revisada' });
	let restored = (await Db.reopen(dir)).snapshot();
	assert.equal(restored.drafts.length, 1);
	assert.equal(restored.drafts[0].body, 'Versión revisada');
	assert.equal(restored.drafts[0].replyTo, 'm1');
});
test('concurrent writes preserve message changes and drafts', async (t) => {
	let { store, dir } = fixture(t);
	await Promise.all([
		store.changeMessage('m1', 'read'),
		store.changeMessage('m2', 'archive'),
		store.saveDraft({ id: 'd1', accountId: 'support', body: 'Hola' })
	]);
	let restored = (await Db.reopen(dir)).snapshot();
	assert.equal(restored.messages.find((m) => m.id === 'm1').unread, false);
	assert.equal(restored.messages.find((m) => m.id === 'm2').folder, 'archive');
	assert.equal(restored.drafts[0].id, 'd1');
	await store.changeMessage('m2', 'restore');
	assert.equal(store.snapshot().messages.find((m) => m.id === 'm2').folder, 'inbox');
});
test('invalid changes leave storage unchanged and do not stop future saves', async (t) => {
	let { store } = fixture(t);
	let before = store.snapshot();
	await assert.rejects(store.saveDraft({ id: 'd1', accountId: 'unknown' }), /Invalid account/);
	await assert.rejects(store.changeMessage('missing', 'read'), /Message not found/);
	assert.deepEqual(store.snapshot(), before);
	await store.changeMessage('m1', 'star');
	assert.equal(store.snapshot().messages[0].starred, true);
});
test('failed disk writes do not report a committed draft', async (t) => {
	fixture(t);
	let store = Db.failing(seed);
	await assert.rejects(store.saveDraft({ id: 'd1', accountId: 'studio', body: 'No perder' }), /disk unavailable/);
	assert.equal(store.snapshot().drafts.length, 0);
});
test('a draft that was never submitted can be discarded, one that was submitted cannot', async (t) => {
	let { store, dir } = fixture(t);
	await store.saveDraft({ id: 'draft-a', accountId: 'studio', to: 'a@example.com', subject: 'A', body: 'A' });
	await store.saveDraft({ id: 'draft-b', accountId: 'studio', to: 'b@example.com', subject: 'B', body: 'B' });
	let removed = await store.deleteDraft('draft-a');
	assert.equal(removed.id, 'draft-a');
	assert.deepEqual(
		store.snapshot().drafts.map((d) => d.id),
		['draft-b']
	);
	assert.deepEqual(
		(await Db.reopen(dir)).snapshot().drafts.map((d) => d.id),
		['draft-b']
	);
	await assert.rejects(() => store.deleteDraft('draft-a'), /Draft not found/);
	await store.beginSend('draft-b');
	await assert.rejects(() => store.deleteDraft('draft-b'), /already submitted/);
	assert.equal(store.snapshot().drafts.length, 1);
});
