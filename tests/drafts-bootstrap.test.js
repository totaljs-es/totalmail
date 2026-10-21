require('total5');
const { test } = require('node:test');
const Assert = require('node:assert/strict');
const Fs = require('node:fs'),
	Os = require('node:os'),
	Path = require('node:path'),
	Vm = require('node:vm');
const Db = require('./db');

test('bootstrap excludes sent drafts after restart while retaining pending drafts and duplicate-send protection', async (t) => {
	var directory = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'totalmail-draft-list-'));
	t.after(() => Fs.rmSync(directory, { recursive: true, force: true }));
	var store = Db.store(directory, { accounts: [{ id: 'a', name: 'Me', email: 'me@example.test' }], messages: [], drafts: [] });
	for (var id of ['editable', 'sending', 'unknown', 'sent']) {
		await store.saveDraft({ id, accountId: 'a', to: 'you@example.test', subject: 'S', body: 'B' });
		if (id !== 'editable')
			await store.beginSend(id);
		if (['unknown', 'sent'].includes(id))
			await store.finishSend(id, id);
	}
	store = await Db.reopen(directory);
	var actions = {},
		data;
	Vm.runInNewContext(Fs.readFileSync(Path.join(__dirname, '../plugins/mail/actions/mail.js'), 'utf8'), {
		require: require('node:module').createRequire(Path.join(__dirname, '../plugins/mail/actions/mail.js')),
		NEWACTION: (name, action) => (actions[name] = action),
		MODS: { users: { forUser: () => store }, ai: { status: () => ({ configured: false }) }, instance: { ai: () => ({}) } }
	});
	actions['Mailboxes|bootstrap'].action({ user: { id: 'u' }, language: 'en', callback: (value) => (data = value) });
	Assert.deepEqual(new Set(data.drafts.map((d) => d.id)), new Set(['editable', 'sending', 'unknown']));
	Assert.equal(data.messages.find((m) => m.sentDraftId === 'sent').body, 'B', 'the sent copy remains available');
	Assert.equal(store.snapshot().drafts.find((d) => d.id === 'sent').status, 'sent', 'the submission record is retained');
	await Assert.rejects(store.beginSend('sent'), /already submitted/);
	await Assert.rejects(store.saveDraft({ id: 'sent', accountId: 'a', body: 'Resend' }), /already submitted/);
	await Assert.rejects(store.deleteDraft('sending'), /already submitted/);
	await Assert.rejects(store.deleteDraft('unknown'), /already submitted/);
	await store.setSentCopy('sent', { status: 'unknown' });
	Assert.equal(store.message('sent-sent').sentCopy, 'unknown', 'copy failure does not return the message to drafts');
	Assert.equal((await store.deleteDraft('editable')).id, 'editable', 'real drafts can still be discarded');
});
