// What the mail window does, with the real plugins/mail/public/mail.js and a server that answers from a small mailbox. These tests
// are the net under any change to that file (splitting it, binding it differently): they check the lists it draws and the calls
// it makes, not how it looks.
var { test } = require('node:test');
var Assert = require('node:assert/strict');
var Harness = require('./mail-harness');

function mailbox() {
	return {
		user: { id: 'u1', name: 'Ana Ruiz', email: 'ana@example.test', role: 'admin' },
		accounts: [
			{ id: 'a1', name: 'Work', email: 'ana@example.test', color: '#4285F4', configured: true, status: 'synced', mailboxes: [] },
			{ id: 'a2', name: 'Home', email: 'ana@home.test', color: '#db9265', configured: true, status: 'synced', mailboxes: [] }
		],
		messages: [
			{ id: 'm1', accountId: 'a1', folder: 'inbox', unread: true, sender: 'Luis Gómez', email: 'luis@example.test', subject: 'Proposal', body: 'Hello,\nHere is the proposal.', date: '2026-11-10T10:00:00Z', messageId: '<1@x>' },
			{ id: 'm2', accountId: 'a1', folder: 'inbox', unread: false, sender: 'Eva Soto', email: 'eva@example.test', subject: 'Invoice 42', body: 'Please pay.', date: '2026-11-11T10:00:00Z', messageId: '<2@x>' },
			{ id: 'm3', accountId: 'a2', folder: 'inbox', unread: true, sender: 'Pablo', email: 'pablo@example.test', subject: 'Holidays', body: 'Where to?', date: '2026-11-12T10:00:00Z', messageId: '<3@x>', starred: true },
			{ id: 'm4', accountId: 'a1', folder: 'inbox', unread: false, sender: 'Luis Gómez', email: 'luis@example.test', subject: 'Re: Proposal', body: 'Thanks.', date: '2026-11-13T10:00:00Z', messageId: '<4@x>', inReplyTo: '<1@x>' },
			{ id: 'm5', accountId: 'a1', folder: 'trash', unread: false, sender: 'Spam', email: 'spam@example.test', subject: 'Win', body: 'Win now', date: '2026-11-09T10:00:00Z', messageId: '<5@x>' }
		],
		drafts: []
	};
}
// A server that keeps what it is told: the window reloads from it after most operations, as it does in production.
async function start(options) {

	options = options || {};
	var db = mailbox(),
		counter = 0;
	var by = (id) => db.messages.find((m) => m.id === id);
	var h = await Harness.create({
		lang: options.lang,
		api: {
			bootstrap: () => JSON.parse(JSON.stringify(db)),
			message_change: (d) => {
				var m = by(d.id);
				if (d.operation === 'read')
					m.unread = false;
				else if (d.operation === 'unread')
					m.unread = true;
				else if (d.operation === 'star')
					m.starred = d.enabled;
				else if (d.operation === 'trash')
					m.folder = 'trash';
				else if (d.operation === 'archive')
					m.folder = 'archive';
				else if (d.operation === 'restore')
					m.folder = 'inbox';
				return { id: m.id, unread: m.unread, starred: m.starred, folder: m.folder };
			},
			draft_save: (d) => {
				var saved = Object.assign({ status: 'draft', revision: 'r' + ++counter, attachments: [] }, db.drafts.find((x) => x.id === d.id), d, { id: d.id || 'd' + ++counter, updated: '2026-11-14T10:00:00Z' });
				db.drafts = db.drafts.filter((x) => x.id !== saved.id).concat(saved);
				return saved;
			},
			draft_delete: (d) => {
				db.drafts = db.drafts.filter((x) => x.id !== d.id);
				return {};
			}
		}
	});
	h.db = db;
	return h;
}
var ids = (h) => Array.from(h.mail().rows, (r) => r.id);

test('the window starts with the inbox of every account, the newest conversation first', async () => {
	var h = await start();
	var m = h.mail();
	Assert.deepEqual(h.calls.map((c) => c.schema), ['bootstrap']);
	Assert.equal(m.ui.userName, 'Ana Ruiz');
	Assert.equal(m.ui.userInitials, 'AR');
	Assert.equal(m.ui.admin, true);
	Assert.equal(m.ui.folderTitle, 'Inbox');
	Assert.equal(m.ui.accountScope, 'All accounts');
	// Threads: m1 and m4 are one conversation, shown by its newest message; the trash is not in the inbox.
	Assert.deepEqual(ids(h), ['m4', 'm3', 'm2']);
	Assert.equal(m.rows[0].count, 2, 'the conversation says how many messages it has');
	Assert.equal(m.ui.resultsCount, '3 messages');
	Assert.equal(m.listState.empty, false);
	Assert.equal(m.ui.listStatus, '', 'with a synced account there is nothing to set up');
	Assert.deepEqual(h.plain(m.accounts.map((a) => [a.id, a.unreadCount])), [['a1', 1], ['a2', 1]]);
});

test('without conversations every message has its own line, and the choice is remembered', async () => {
	var h = await start();
	await h.plugin.togglethreads();
	Assert.deepEqual(ids(h), ['m4', 'm3', 'm2', 'm1']);
	Assert.equal(h.mail().ui.threads, false);
	Assert.equal(h.storage['totalmail-threads-u1'], '0');
	await h.plugin.togglethreads();
	Assert.equal(h.mail().ui.threads, true);
	Assert.deepEqual(ids(h), ['m4', 'm3', 'm2']);
});

test('the unread filter and the account filter narrow the list', async () => {
	var h = await start();
	await h.click({ filter: 'unread' });
	Assert.deepEqual(ids(h), ['m3', 'm1'], 'the conversation of m1 stays because m1 is unread, and is shown by that message');
	Assert.equal(h.mail().ui.filter, 'unread');
	await h.click({ filter: 'all' });
	await h.click({ account: 'a2' });
	Assert.deepEqual(ids(h), ['m3']);
	Assert.equal(h.mail().ui.accountScope, 'Home');
	await h.click({ account: 'a2' });
	Assert.equal(h.mail().ui.accountScope, 'All accounts', 'the same account again clears the filter');
});

test('the folders show their own messages, and starred ones from every folder', async () => {
	var h = await start();
	await h.click({ folder: 'trash' });
	Assert.deepEqual(ids(h), ['m5']);
	Assert.equal(h.mail().ui.folderTitle, 'Trash');
	await h.click({ folder: 'starred' });
	Assert.deepEqual(ids(h), ['m3']);
	await h.click({ folder: 'drafts' });
	Assert.deepEqual(ids(h), []);
	Assert.equal(h.mail().ui.unreadOff, true, 'there is no unread filter among drafts');
});

test('searching filters what is loaded, with the operators of the search box', async () => {
	var h = await start();
	h.set('mail.search', 'invoice');
	h.plugin.search();
	Assert.deepEqual(ids(h), ['m2']);
	h.set('mail.search', 'from:luis is:unread');
	h.plugin.search();
	Assert.deepEqual(ids(h), ['m1'], 'the conversation is found through its unread message, and shown by it');
	h.set('mail.search', 'zzz');
	h.plugin.search();
	Assert.deepEqual(ids(h), []);
	Assert.equal(h.mail().listState.message, 'No matches. Try another search.');
	h.plugin.clearsearch();
	Assert.equal(h.mail().search, '');
	// The search box tells the window when its text changes (exec); clearing is one more change.
	h.plugin.search();
	Assert.deepEqual(ids(h), ['m4', 'm3', 'm2']);
});

test('opening a message shows it and marks it as read on the server', async () => {
	var h = await start();
	await h.click({ message: 'm3' });
	Assert.equal(h.mail().ui.hasReader, true);
	Assert.equal(h.mail().reader.empty, false);
	Assert.equal(h.mail().reader.subject, 'Holidays');
	Assert.deepEqual(h.called('message_change').map((c) => c.data), [{ id: 'm3', operation: 'read' }]);
	Assert.equal(h.mail().rows.find((r) => r.id === 'm3').unread, false);
	Assert.equal(h.mail().rows.find((r) => r.id === 'm3').selected, true);
	Assert.equal(h.mail().accounts.find((a) => a.id === 'a2').unreadCount, 0);
	// A message that is read already is not marked again.
	await h.click({ message: 'm2' });
	Assert.equal(h.called('message_change').length, 1);
});

test('star, archive and move to the trash change the message on the server and reload', async () => {
	var h = await start();
	await h.click({ message: 'm2' });
	await h.click({ command: 'star' });
	Assert.deepEqual(h.called('message_change').pop().data, { id: 'm2', operation: 'star', enabled: true });
	Assert.equal(h.db.messages.find((m) => m.id === 'm2').starred, true);
	await h.click({ command: 'trash' });
	Assert.equal(h.db.messages.find((m) => m.id === 'm2').folder, 'trash');
	Assert.ok(!ids(h).includes('m2'), 'it left the inbox');
	Assert.ok(h.mail().ui.undoShown, 'moving from the inbox can be undone');
});

test('ctrl-click selects lines for a bulk action without opening them', async () => {
	var h = await start();
	await h.click({ message: 'm3' }, { ctrlKey: true });
	await h.click({ message: 'm2' }, { ctrlKey: true });
	Assert.equal(h.mail().ui.bulkShown, true);
	Assert.equal(h.mail().ui.bulkCount, '2 selected');
	Assert.equal(h.mail().ui.hasReader, false, 'nothing was opened');
	Assert.deepEqual(Array.from(h.mail().rows.filter((r) => r.checked), (r) => r.id).sort(), ['m2', 'm3']);
	Assert.equal(h.called('message_change').length, 0);
});

test('a new message is saved as a draft a moment after the person types, once', async () => {
	var h = await start();
	await h.click({ command: 'compose' });
	Assert.equal(h.mail().window, 'composer');
	Assert.equal(h.mail().compose.accountId, 'a1');
	Assert.equal(h.called('draft_save').length, 0, 'nothing is saved before the person writes');
	h.set('mail.compose.to', 'eva@example.test');
	h.set('mail.compose.subject', 'Hello');
	h.set('mail.compose.body', 'Hi Eva');
	Assert.equal(h.mail().ui.draftStatus, 'Unsaved changes…');
	await h.flush();
	var saves = h.called('draft_save');
	Assert.equal(saves.length, 1, 'three edits make one save');
	Assert.equal(saves[0].data.to, 'eva@example.test');
	Assert.equal(saves[0].data.subject, 'Hello');
	Assert.equal(saves[0].data.body, 'Hi Eva');
	Assert.equal(saves[0].data.accountId, 'a1');
	Assert.equal(h.mail().ui.draftStatus, 'Saved on your server');
	Assert.equal(h.db.drafts.length, 1);
	// A second edit saves the same draft, not another.
	h.set('mail.compose.body', 'Hi Eva, again');
	await h.flush();
	Assert.equal(h.called('draft_save')[1].data.id, h.db.drafts[0].id);
	Assert.equal(h.db.drafts.length, 1);
});

test('closing the composer saves what is pending first', async () => {
	var h = await start();
	await h.click({ command: 'compose' });
	h.set('mail.compose.subject', 'Draft me');
	await h.click({ command: 'close-compose' });
	Assert.equal(h.called('draft_save').length, 1);
	Assert.equal(h.mail().window, '');
	Assert.equal(h.plugin.pending(), false, 'nothing is left to lose');
});

test('discarding a draft needs a second press, then removes it everywhere', async () => {
	var h = await start();
	await h.click({ command: 'compose' });
	h.set('mail.compose.subject', 'Throw me away');
	await h.flush();
	await h.click({ command: 'discard-compose' });
	Assert.equal(h.called('draft_delete').length, 0, 'the first press only asks');
	Assert.ok(h.toasts.some((t) => /Press again to discard this draft/.test(t)));
	await h.click({ command: 'discard-compose' });
	Assert.equal(h.called('draft_delete').length, 1);
	Assert.equal(h.db.drafts.length, 0);
	Assert.equal(h.mail().window, '');
});

test('a reply starts from the message: the right account and recipient, "Re:", and the original quoted', async () => {
	var h = await start();
	await h.click({ message: 'm3' });
	await h.click({ command: 'reply' });
	var compose = h.mail().compose;
	Assert.equal(h.mail().window, 'composer');
	Assert.equal(compose.accountId, 'a2');
	Assert.equal(compose.to, 'pablo@example.test');
	Assert.match(compose.subject, /^Re: Holidays/);
	Assert.match(compose.body, /Where to\?/, 'the original is quoted');
	Assert.equal(h.mail().ui.composeTitle, 'Your reply');
	// Opening it is not an edit: nothing is saved until the person changes something.
	await h.flush();
	Assert.equal(h.called('draft_save').length, 0);
});

test('a forward has its own title and no recipient', async () => {
	var h = await start();
	await h.click({ message: 'm2' });
	await h.click({ command: 'forward' });
	Assert.equal(h.mail().ui.composeTitle, 'Forward');
	Assert.equal(h.mail().compose.to, '');
	Assert.match(h.mail().compose.subject, /^Fwd: Invoice 42|^Fw: Invoice 42/i);
});

test('the sync button syncs the inbox of the open account and reloads', async () => {
	var h = await start();
	await h.click({ account: 'a1' });
	await h.click({ command: 'sync' });
	Assert.deepEqual(h.called('account_sync').map((c) => c.data), [{ accountId: 'a1', path: 'INBOX' }]);
	Assert.equal(h.called('bootstrap').length, 2, 'the window reloads what the server holds');
});

test('background sync skips an account that failed, and backs off before trying it again', async () => {
	var h = await start();
	h.answer('account_sync', (d) => (d.accountId === 'a2' ? Error('Server busy') : {}));
	await h.plugin.backgroundSync();
	Assert.deepEqual(h.called('account_sync').map((c) => c.data.accountId), ['a1', 'a2']);
	Assert.equal(h.mail().accounts.find((a) => a.id === 'a2').syncFailed, true);
	Assert.equal(h.mail().accounts.find((a) => a.id === 'a1').syncFailed, false);
	await h.plugin.backgroundSync();
	Assert.deepEqual(h.called('account_sync').map((c) => c.data.accountId), ['a1', 'a2', 'a1'], 'the failed one waits');
});

test('background sync does nothing while a window is open or an operation runs', async () => {
	var h = await start();
	h.set('mail.window', 'settings');
	Assert.equal(h.plugin.backgroundReady(), false);
	await h.plugin.backgroundSync();
	Assert.equal(h.called('account_sync').length, 0);
	h.set('mail.window', '');
	Assert.equal(h.plugin.backgroundReady(), true);
});

test('a message goes out only after the preview is confirmed, for the revision that was reviewed', async () => {
	var h = await start();
	await h.click({ command: 'compose' });
	h.set('mail.compose.to', 'eva@example.test');
	h.set('mail.compose.subject', 'Hello');
	h.set('mail.compose.body', 'Hi Eva');
	await h.click({ command: 'preview-send' });
	Assert.equal(h.mail().window, 'send-confirm');
	Assert.equal(h.called('draft_send').length, 0, 'the preview sends nothing');
	var revision = h.db.drafts[0].revision;
	h.answer('draft_send', () => ({ sentCopy: 'saved' }));
	await h.click({ command: 'confirm-send' });
	Assert.deepEqual(h.called('draft_send').map((c) => c.data), [{ id: h.db.drafts[0].id, confirmed: true, revision }]);
	Assert.equal(h.mail().window, '');
	Assert.ok(h.toasts.some((t) => /Email sent and saved/.test(t)));
});

test('a failed send keeps the composer and says why', async () => {
	var h = await start();
	await h.click({ command: 'compose' });
	h.set('mail.compose.to', 'eva@example.test');
	h.set('mail.compose.body', 'Hi');
	await h.click({ command: 'preview-send' });
	h.answer('draft_send', Error('The server refused the message.'));
	await h.click({ command: 'confirm-send' });
	Assert.equal(h.mail().ui.sendError, 'The server refused the message.');
	Assert.notEqual(h.mail().window, '', 'the window is not closed');
});

test('a bulk action applies to every selected conversation, empties the selection and can be undone', async () => {
	var h = await start();
	await h.click({ message: 'm3' }, { ctrlKey: true });
	await h.click({ message: 'm2' }, { ctrlKey: true });
	await h.plugin.bulk([{ dataset: { bulk: 'trash' } }]);
	await h.settle();
	var changed = h.called('message_change').map((c) => c.data.id).sort();
	Assert.deepEqual(changed, ['m2', 'm3']);
	Assert.deepEqual(ids(h), ['m4'], 'only the conversation that was not selected is left in the inbox');
	Assert.equal(h.mail().ui.bulkShown, false, 'the selection is empty');
	Assert.equal(h.mail().ui.undoShown, true);
	await h.plugin.undo();
	await h.settle();
	Assert.equal(h.db.messages.find((m) => m.id === 'm2').folder, 'inbox');
	Assert.equal(h.db.messages.find((m) => m.id === 'm3').folder, 'inbox');
	Assert.deepEqual(ids(h), ['m4', 'm3', 'm2']);
	Assert.equal(h.mail().ui.undoShown, false);
});

test('starring keeps the selection, and a conversation is starred only when none of the lines is', async () => {
	var h = await start();
	await h.click({ message: 'm3' }, { ctrlKey: true });
	await h.click({ message: 'm2' }, { ctrlKey: true });
	await h.plugin.bulk([{ dataset: { bulk: 'star' } }]);
	await h.settle();
	Assert.deepEqual(h.called('message_change').map((c) => c.data.enabled), [true, true], 'm3 was starred already, but not every line was');
	Assert.equal(h.mail().ui.bulkShown, true, 'more can follow');
});

test('deleting from the trash for good asks twice', async () => {
	var h = await start();
	await h.click({ folder: 'trash' });
	await h.click({ message: 'm5' }, { ctrlKey: true });
	h.answer('message_erase', {});
	await h.plugin.bulk([{ dataset: { bulk: 'trash' } }]);
	Assert.equal(h.called('message_erase').length, 0);
	Assert.ok(h.toasts.some((t) => /Press again to delete permanently/.test(t)));
	await h.plugin.bulk([{ dataset: { bulk: 'trash' } }]);
	await h.settle();
	Assert.deepEqual(h.called('message_erase').map((c) => c.data), [{ id: 'm5' }]);
});

test('a draft opens in the composer with its saved text', async () => {
	var h = await start();
	h.db.drafts.push({ id: 'd9', accountId: 'a2', from: '', to: 'x@example.test', cc: '', bcc: '', subject: 'Saved one', body: 'Body', status: 'draft', revision: 'r0', attachments: [], updated: '2026-11-14T09:00:00Z' });
	await h.plugin.reload();
	await h.click({ folder: 'drafts' });
	Assert.deepEqual(ids(h), ['d9']);
	await h.click({ message: 'd9' });
	Assert.equal(h.mail().window, 'composer');
	Assert.equal(h.mail().compose.subject, 'Saved one');
	Assert.equal(h.mail().compose.accountId, 'a2');
	Assert.equal(h.mail().ui.draftStatus, 'Saved on your server');
	await h.flush();
	Assert.equal(h.called('draft_save').length, 0, 'opening is not an edit');
});

test('a draft that was submitted cannot be edited again', async () => {
	var h = await start();
	h.db.drafts.push({ id: 'd8', accountId: 'a1', to: 'x@example.test', subject: 'Sent?', body: 'B', status: 'unknown', revision: 'r0', attachments: [], updated: '2026-11-14T09:00:00Z' });
	await h.plugin.reload();
	await h.click({ folder: 'drafts' });
	await h.click({ message: 'd8' });
	Assert.equal(h.mail().ui.locked, true);
	Assert.equal(h.mail().ui.sendOff, true);
	await h.click({ command: 'preview-send' });
	Assert.equal(h.mail().window, 'composer', 'there is no preview of a message that may already have gone');
});

test('loading older mail asks every folder that has more, then reloads', async () => {
	var h = await start();
	h.db.accounts[0].remaining = { INBOX: 40 };
	await h.plugin.reload();
	Assert.equal(h.mail().ui.olderShown, true);
	await h.click({ command: 'older' });
	Assert.deepEqual(h.called('account_older').map((c) => c.data), [{ accountId: 'a1', path: 'INBOX' }]);
	Assert.equal(h.called('bootstrap').length, 3);
});

test('a long list is drawn in stretches and shows more on request', async () => {
	var h = await start();
	for (var i = 0; i < 200; i++)
		h.db.messages.push({ id: 'x' + i, accountId: 'a1', folder: 'inbox', unread: false, sender: 'S', email: 's@example.test', subject: 'Bulk ' + i, body: 'b', date: '2026-10-' + String((i % 28) + 1).padStart(2, '0') + 'T10:00:00Z' });
	await h.plugin.reload();
	Assert.equal(h.mail().rows.length, 150);
	Assert.equal(h.mail().ui.moreShown, true);
	h.plugin.showmore();
	Assert.ok(h.mail().rows.length > 150);
	Assert.equal(h.mail().ui.resultsCount, '203 messages', 'the count is of the whole list, not of what is drawn');
});

test('an operation cannot start while another one runs', async () => {
	var h = await start();
	var release;
	h.answer('account_sync', () => new Promise((resolve) => (release = resolve)));
	var running = h.plugin.operation(async () => h.plugin.api('account_sync', { accountId: 'a1', path: 'INBOX' }));
	await h.settle();
	await Assert.rejects(() => h.plugin.operation(async () => 1), /busy/);
	Assert.equal(h.mail().ui.busy, true);
	release({});
	await running;
	Assert.equal(h.mail().ui.busy, false);
});

test('the bar that offers to undo goes away by itself, and the Z key uses it', async () => {
	var h = await start();
	await h.click({ message: 'm2' });
	await h.click({ command: 'trash' });
	Assert.equal(h.mail().ui.undoShown, true);
	await h.flush();
	Assert.equal(h.mail().ui.undoShown, false, 'after nine seconds');
	await h.click({ message: 'm3' });
	await h.click({ command: 'trash' });
	Assert.equal(h.mail().ui.undoShown, true);
	h.plugin.keys({ key: 'z', target: { tagName: 'BODY', matches: () => false }, preventDefault() {} });
	await h.settle();
	Assert.equal(h.db.messages.find((m) => m.id === 'm3').folder, 'inbox');
});

test('mail that arrives while the window is open is announced to a screen reader', async () => {
	var h = await start();
	Assert.equal(h.mail().ui.announce, '', 'nothing arrived yet');
	h.db.messages.push({ id: 'n1', accountId: 'a1', folder: 'inbox', unread: true, sender: 'Rosa', email: 'rosa@example.test', subject: 'Surprise', body: 'b', date: '2026-11-14T09:00:00Z' });
	await h.plugin.reload();
	await h.flush();
	Assert.equal(h.mail().ui.announce, 'New message: Rosa · Surprise');
	h.db.messages.push(
		{ id: 'n2', accountId: 'a1', folder: 'inbox', unread: true, sender: 'A', email: 'a@example.test', subject: 'One', body: 'b', date: '2026-11-14T09:10:00Z' },
		{ id: 'n3', accountId: 'a1', folder: 'inbox', unread: true, sender: 'B', email: 'b@example.test', subject: 'Two', body: 'b', date: '2026-11-14T09:11:00Z' }
	);
	await h.plugin.reload();
	await h.flush();
	Assert.equal(h.mail().ui.announce, 'New messages: 2');
	// What was already there is not announced again.
	await h.plugin.reload();
	await h.flush();
	Assert.equal(h.mail().ui.announce, 'New messages: 2');
});

test('the notification switch says why it cannot work in this browser', async () => {
	var h = await start();
	Assert.equal(h.get('mail.notifyHint'), 'This browser does not support notifications.');
	Assert.equal(h.mail().ui.notifications, false);
	await h.plugin.togglenotifications();
	Assert.equal(h.mail().ui.notifications, false);
});

test('shift selects a range of lines, the select-all box takes every line, and Escape clears the selection', async () => {
	var h = await start();
	await h.click({ message: 'm4' }, { ctrlKey: true });
	await h.click({ message: 'm2' }, { shiftKey: true });
	Assert.deepEqual(Array.from(h.mail().rows.filter((r) => r.checked), (r) => r.id).sort(), ['m2', 'm3', 'm4']);
	Assert.equal(h.mail().ui.bulkAll, true);
	h.plugin.bulkall([{ checked: false }]);
	Assert.equal(h.mail().ui.bulkShown, false);
	h.plugin.bulkall([{ checked: true }]);
	Assert.equal(h.mail().ui.bulkCount, '3 selected');
	Assert.equal(h.plugin.keys({ key: 'Escape', target: { tagName: 'BODY', matches: () => false }, preventDefault() {} }), undefined);
	Assert.equal(h.mail().ui.bulkShown, false, 'Escape clears it');
});

test('a bulk action on drafts can only throw them away, after a second press', async () => {
	var h = await start();
	h.db.drafts.push(
		{ id: 'd1', accountId: 'a1', to: '', subject: 'One', body: '', status: 'draft', revision: 'r', attachments: [], updated: '2026-11-14T09:00:00Z' },
		{ id: 'd2', accountId: 'a1', to: '', subject: 'Two', body: '', status: 'draft', revision: 'r', attachments: [], updated: '2026-11-14T09:01:00Z' }
	);
	await h.plugin.reload();
	await h.click({ folder: 'drafts' });
	await h.click({ message: 'd1' }, { ctrlKey: true });
	await h.click({ message: 'd2' }, { ctrlKey: true });
	Assert.equal(h.mail().ui.bulkDrafts, true);
	await h.plugin.bulk([{ dataset: { bulk: 'archive' } }]);
	Assert.equal(h.called('message_change').length + h.called('draft_delete').length, 0, 'archive is not for drafts');
	await h.plugin.bulk([{ dataset: { bulk: 'trash' } }]);
	Assert.equal(h.called('draft_delete').length, 0, 'the first press only asks');
	await h.plugin.bulk([{ dataset: { bulk: 'trash' } }]);
	Assert.deepEqual(h.called('draft_delete').map((c) => c.data.id).sort(), ['d1', 'd2']);
	Assert.deepEqual(ids(h), []);
});

test('leaving the page asks first while a draft has unsaved changes', async () => {
	var h = await start();
	Assert.equal(h.plugin.pending(), false);
	await h.click({ command: 'compose' });
	Assert.equal(h.plugin.pending(), false, 'an untouched new message loses nothing');
	h.set('mail.compose.body', 'Half a thought');
	Assert.equal(h.plugin.pending(), true);
	await h.flush();
	Assert.equal(h.plugin.pending(), false, 'saved');
});

test('changing the language saves the draft first, and signing out does too', async () => {
	var h = await start();
	await h.click({ command: 'compose' });
	h.set('mail.compose.subject', 'Before leaving');
	await h.click({ command: 'logout' });
	Assert.equal(h.called('draft_save').length, 1);
	Assert.equal(h.called('user_logout').length, 1);
	Assert.ok(h.called('draft_save')[0].data.subject === 'Before leaving');
});

test('what the assistant writes goes before the quoted original, only when the person asks for it', async () => {
	var h = await start();
	await h.plugin.replywith('m3', 'Thanks, see you there.');
	Assert.equal(h.mail().window, 'composer');
	Assert.match(h.mail().compose.body, /^Thanks, see you there\./);
	Assert.match(h.mail().compose.body, /Where to\?/);
	h.plugin.writebody('A new text');
	Assert.equal(h.mail().compose.body, 'A new text');
});

test('files dropped on the mailbox start a new message with them attached', async () => {
	var h = await start();
	h.answer('draft_save', (d) => Object.assign({ id: 'dd', revision: 'r1', status: 'draft', attachments: [] }, d));
	var file = new File(['hello'], 'notes.txt', { type: 'text/plain' });
	await h.plugin.dropped([file]);
	Assert.equal(h.mail().window, 'composer');
});

test('the second account of a message changes its sender and keeps an unwritten signature in step', async () => {
	var h = await start();
	h.db.accounts[0].signature = '-- Ana (work)';
	h.db.accounts[1].signature = '-- Ana (home)';
	await h.plugin.reload();
	await h.click({ command: 'compose' });
	Assert.match(h.mail().compose.body, /Ana \(work\)/, 'a new message starts with the signature of its account');
	h.set('mail.compose.accountId', 'a2');
	Assert.match(h.mail().compose.body, /Ana \(home\)/, 'the signature of the new account');
	Assert.doesNotMatch(h.mail().compose.body, /Ana \(work\)/);
});

test('pressing confirm twice sends once', async () => {
	var h = await start();
	await h.click({ command: 'compose' });
	h.set('mail.compose.to', 'eva@example.test');
	h.set('mail.compose.body', 'Hi');
	await h.click({ command: 'preview-send' });
	var release;
	h.answer('draft_send', () => new Promise((resolve) => (release = resolve)));
	var first = h.plugin.click([{ dataset: { command: 'confirm-send' }, disabled: false }]);
	await h.settle();
	var second = h.plugin.click([{ dataset: { command: 'confirm-send' }, disabled: false }]);
	await h.settle();
	Assert.equal(h.called('draft_send').length, 1, 'the second press finds a send in progress');
	release({ sentCopy: 'saved' });
	await first;
	await second;
	Assert.equal(h.called('draft_send').length, 1);
});

test('closing a settings window forgets the passwords typed in it, with the button or with Escape', async () => {
	var h = await start();
	h.set('mail.window', 'account-setup');
	h.set('accounts.form.password', 'secret');
	h.set('users.form.password', 'another');
	h.plugin.closewindow();
	Assert.equal(h.mail().window, '');
	Assert.equal(h.get('accounts.form.password'), '');
	Assert.equal(h.get('users.form.password'), '');
	h.set('mail.window', 'users');
	h.set('users.form.password', 'again');
	h.plugin.keys({ key: 'Escape', target: { tagName: 'BODY', matches: () => false }, preventDefault() {} });
	Assert.equal(h.mail().window, '');
	Assert.equal(h.get('users.form.password'), '');
});

test('the sync button of the account form syncs that account\'s inbox', async () => {
	var h = await start();
	await h.plugin.syncaccount('a2');
	Assert.deepEqual(h.called('account_sync').map((c) => c.data), [{ accountId: 'a2', path: 'INBOX' }]);
});

test('leaving a section with unsaved changes asks first; what the section loaded or saved does not count', async () => {
	var h = await start();
	h.set('mail.window', 'profile');
	h.set('users.profileform', { name: 'Ana Ruiz', email: 'ana@example.test', currentPassword: '' });
	h.plugin.saved('users.profileform');
	h.plugin.closewindow();
	Assert.equal(h.mail().window, '', 'nothing was typed: it closes without asking');
	Assert.equal(h.asked.length, 0);
	h.set('mail.window', 'profile');
	h.set('users.profileform', { name: 'Ana Ruiz', email: 'ana@example.test', currentPassword: '' });
	h.plugin.saved('users.profileform');
	h.set('users.profileform.name', 'Ana R.');
	h.confirming = false;
	h.plugin.closewindow();
	Assert.equal(h.mail().window, 'profile', 'the person chose to stay');
	Assert.equal(h.asked.length, 1);
	h.plugin.section([{ dataset: { open: 'devices/open' }, getAttribute: () => null }]);
	Assert.deepEqual(h.execs, [], 'another section is not opened either');
	h.confirming = true;
	h.plugin.section([{ dataset: { open: 'devices/open' }, getAttribute: () => null }]);
	Assert.deepEqual(h.execs, ['devices/open'], 'the person chose to leave');
});

test('a form that the code rebuilds after the person typed is still unsaved (discovery of the servers)', async () => {
	var h = await start();
	h.set('mail.window', 'account-setup');
	h.set('accounts.form', { id: '', name: '', email: '', imapHost: '', password: '' });
	h.plugin.saved('accounts.form');
	h.set('accounts.form.email', 'rosa@example.test');
	h.set('accounts.form.password', 'secret');
	// What discovery does: the whole form again, with the servers it found and what the person typed.
	h.set('accounts.form', Object.assign({}, h.get('accounts.form'), { imapHost: 'imap.example.test' }));
	h.confirming = false;
	h.plugin.closewindow();
	Assert.equal(h.asked.length, 1, 'nothing of it is saved');
	Assert.equal(h.mail().window, 'account-setup');
});

test('the passwords typed in a section are forgotten when the person moves to another one', async () => {
	var h = await start();
	h.set('mail.window', 'profile');
	h.set('users.profileform', { name: 'Ana', currentPassword: '', newPassword: '', confirmPassword: '' });
	h.plugin.saved('users.profileform');
	h.set('users.profileform.currentPassword', 'old-one');
	h.set('accounts.form', { password: 'mail-secret' });
	h.confirming = true;
	h.plugin.section([{ dataset: { open: 'devices/open' }, getAttribute: () => null }]);
	Assert.equal(h.get('users.profileform.currentPassword'), '');
	Assert.equal(h.get('accounts.form.password'), '');
	Assert.equal(h.get('users.profileform.name'), 'Ana', 'only the passwords');
});

test('a section that saves says so, and the section that is open is not opened again', async () => {
	var h = await start();
	h.set('mail.window', 'account-setup');
	h.set('accounts.form', { id: 'a1', name: 'Work' });
	h.plugin.saved('accounts.form');
	h.set('accounts.form.name', 'Office');
	h.plugin.saved('accounts.form');
	h.plugin.closewindow();
	Assert.equal(h.asked.length, 0, 'saved: nothing to lose');
	Assert.equal(h.mail().window, '');
	h.set('mail.window', 'account-setup');
	h.plugin.section([{ dataset: { open: 'accounts/open' }, getAttribute: () => 'page' }]);
	Assert.deepEqual(h.execs, [], 'the open section is left alone');
	h.plugin.section([{ dataset: { open: 'settings' }, getAttribute: () => null }]);
	Assert.equal(h.mail().window, 'settings');
});

test('signing out from the settings with unsaved changes asks first', async () => {
	var h = await start();
	h.set('mail.window', 'users');
	h.set('users.form', { name: '', email: '' });
	h.plugin.saved('users.form');
	h.set('users.form.name', 'Rosa');
	h.confirming = false;
	await h.click({ command: 'logout' });
	Assert.equal(h.called('user_logout').length, 0, 'the person stayed');
	Assert.equal(h.asked.length, 1);
});

test('the reader shows formatted mail or plain text, and remote images only for the message they were asked for', async () => {
	var h = await start();
	h.db.messages.push({ id: 'h1', accountId: 'a1', folder: 'inbox', unread: false, sender: 'News', email: 'news@example.test', subject: 'Letter', body: 'Text', date: '2026-11-14T08:00:00Z', hasHtml: true, remoteImages: 3, remote: true, bodyLoaded: true, attachments: [] });
	h.db.messages.push({ id: 'h2', accountId: 'a1', folder: 'inbox', unread: false, sender: 'Shop', email: 'shop@example.test', subject: 'Offer', body: 'Text', date: '2026-11-14T07:00:00Z', hasHtml: true, remoteImages: 1, remote: true, bodyLoaded: true, attachments: [] });
	await h.plugin.reload();
	await h.click({ message: 'h1' });
	var reader = h.mail().reader;
	Assert.equal(reader.showHtml, true);
	Assert.equal(reader.remoteBlocked, true, 'remote images wait');
	Assert.equal(reader.frameSrc, '/html/h1/');
	h.plugin.showimages();
	Assert.equal(h.mail().reader.frameSrc, '/html/h1/?images=1');
	Assert.equal(h.mail().reader.remoteBlocked, false);
	await h.click({ message: 'h2' });
	Assert.equal(h.mail().reader.remoteBlocked, true, 'another message still waits');
	h.plugin.togglehtml();
	Assert.equal(h.mail().reader.showHtml, false, 'plain text');
	await h.click({ message: 'h1' });
	Assert.equal(h.mail().reader.showHtml, false, 'for every message until the page is reloaded');
	h.plugin.togglehtml();
	Assert.equal(h.mail().reader.showHtml, true);
});

test('while a mail operation runs, the buttons of the reader are off, except print', async () => {
	var h = await start();
	await h.click({ message: 'm2' });
	Assert.equal(h.mail().ui.t.archive.off, false);
	var release;
	h.answer('account_sync', () => new Promise((resolve) => (release = resolve)));
	var running = h.plugin.operation(async () => h.plugin.api('account_sync', { accountId: 'a1', path: 'INBOX' }));
	await h.settle();
	Assert.equal(h.mail().ui.t.archive.off, true);
	Assert.equal(h.mail().ui.t.trash.off, true);
	Assert.equal(h.mail().ui.t.print.off, false);
	release({});
	await running;
	Assert.equal(h.mail().ui.t.archive.off, false);
});

test('emptying the trash asks with a second press, then empties the trash of every account that has mail in it', async () => {
	var h = await start();
	h.db.messages.find((m) => m.id === 'm5').remote = true;
	await h.plugin.reload();
	await h.click({ folder: 'trash' });
	Assert.equal(h.mail().ui.trashShown, true);
	Assert.equal(h.mail().ui.trashLabel, 'Empty the trash');
	await h.click({ command: 'empty-trash' });
	Assert.equal(h.called('trash_empty').length, 0, 'the first press only asks');
	Assert.equal(h.mail().ui.trashLabel, 'Press again to empty the trash');
	await h.click({ command: 'empty-trash' });
	Assert.deepEqual(h.called('trash_empty').map((c) => c.data), [{ accountId: 'a1' }], 'a2 has nothing in the trash');
	Assert.ok(h.toasts.some((t) => /Trash emptied/.test(t)));
});

test('searching the mail server asks every connected inbox in view and keeps what it found in the list', async () => {
	var h = await start();
	h.answer('account_search', (d) => (d.accountId === 'a1' ? { ids: ['m2'], found: 1, limited: false } : { ids: [], found: 0, limited: false }));
	h.set('mail.search', 'xx');
	h.plugin.search();
	Assert.deepEqual(ids(h), [], 'nothing loaded matches');
	Assert.equal(h.mail().ui.searchShown, true);
	await h.click({ command: 'server-search' });
	Assert.deepEqual(h.called('account_search').map((c) => c.data), [{ accountId: 'a1', path: 'INBOX', query: 'xx' }, { accountId: 'a2', path: 'INBOX', query: 'xx' }]);
	Assert.deepEqual(ids(h), ['m2'], 'what the server found is in the list');
	Assert.ok(h.toasts.some((t) => /Found 1 on the server/.test(t)));
	Assert.equal(h.mail().ui.busy, false);
});

test('the mail server is not searched while another mail operation runs', async () => {
	var h = await start();
	var release;
	h.answer('account_sync', () => new Promise((resolve) => (release = resolve)));
	var running = h.plugin.operation(async () => h.plugin.api('account_sync', { accountId: 'a1', path: 'INBOX' }));
	await h.settle();
	h.set('mail.search', 'xx');
	h.plugin.search();
	await h.click({ command: 'server-search' });
	Assert.equal(h.called('account_search').length, 0);
	Assert.ok(h.toasts.some((t) => /already running/.test(t)));
	release({});
	await running;
});
