const Welcome = require('../../../lib/welcome');

// A message's sanitized HTML has its own route; no Action answer carries it.
function strip(value) {
	if (value && typeof value === 'object' && !Array.isArray(value) && 'html' in value) {
		var { html, ...rest } = value;
		return rest;
	}
	return value;
}

function run($, fn) {
	FUNC.run(
		$,
		() => Promise.resolve(fn(MODS.users.forUser($.user))).then(strip),
		'@(Mail connection failed. Check the server, TLS settings and app password.)'
	);
}

NEWACTION('Accounts|verify', {
	user: true,
	route: '+API /api/ +account_verify --> Accounts|verify',
	input: '*accountId:String(80)',
	action: ($, m) => run($, (store) => MODS.live.verify($.user, store, m.accountId))
});

// Support for an account that does not work: the checks, written in the person's language.
NEWACTION('Accounts|diagnose', {
	user: true,
	route: '+API /api/ +account_diagnose --> Accounts|diagnose',
	input: '*accountId:String(80)',
	action: ($, m) =>
		run($, async (store) => {
			var report = await MODS.live.diagnose($.user, store, m.accountId),
				say = (text, args) =>
					TRANSLATE($.language, text).replace(/\{(\d)\}/g, (found, index) => (args[index] === undefined ? found : args[index]));
			return {
				failed: report.failed,
				warned: report.warned,
				checks: report.checks.map((c) => ({
					section: c.section,
					status: c.status,
					title: say(c.title, c.args),
					advice: c.advice ? say(c.advice, c.args) : ''
				}))
			};
		})
});

NEWACTION('Drafts|forwardfiles', {
	user: true,
	route: '+API /api/ +draft_forward_files --> Drafts|forwardfiles',
	input: '*id:String(80), *messageId:String(80)',
	action: ($, m) => run($, (store) => MODS.live.forwardFiles($.user, store, m.id, m.messageId))
});

NEWACTION('Accounts|sync', {
	user: true,
	route: '+API /api/ +account_sync --> Accounts|sync',
	input: '*accountId:String(80), path:String(500)',
	action: ($, m) => run($, (store) => MODS.live.sync($.user, store, m.accountId, m.path || 'INBOX'))
});

NEWACTION('Messages|erase', {
	user: true,
	route: '+API /api/ +message_erase --> Messages|erase',
	input: '*id:String(80)',
	action: ($, m) => run($, (store) => MODS.live.erase($.user, store, m.id))
});

NEWACTION('Folders|empty', {
	user: true,
	route: '+API /api/ +trash_empty --> Folders|empty',
	input: '*accountId:String(80)',
	action: ($, m) => run($, (store) => MODS.live.emptyTrash($.user, store, m.accountId))
});

NEWACTION('Accounts|search', {
	user: true,
	route: '+API /api/ +account_search --> Accounts|search',
	input: '*accountId:String(80), *path:String(500), *query:String(200)',
	action: ($, m) => run($, (store) => MODS.live.search($.user, store, m.accountId, m.path, m.query))
});

NEWACTION('Accounts|older', {
	user: true,
	route: '+API /api/ +account_older --> Accounts|older',
	input: '*accountId:String(80), *path:String(500)',
	action: ($, m) => run($, (store) => MODS.live.older($.user, store, m.accountId, m.path))
});

NEWACTION('Messages|read', {
	user: true,
	route: '+API /api/ +message_read --> Messages|read',
	input: '*id:String(80)',
	action: ($, m) => run($, (store) => MODS.live.read($.user, store, m.id))
});

// The text of a message as a person reads it (no hidden text, no invisible characters): what an app gives to a model on the
// device. The same filter as the assistant of the server, which needs no assistant to be turned on.
NEWACTION('Messages|text', {
	user: true,
	route: '+API /api/ +message_text --> Messages|text',
	input: '*id:String(80)',
	action: ($, m) =>
		run($, (store) => {

			var message = store.message(m.id);
			if (!message || message.welcome)
				throw Error('@(Message not found.)');
			if (message.remote && !message.bodyLoaded)
				throw Error('@(Open the message first so it can be read.)');
			var read = MODS.ai.readable(message);
			return {
				id: message.id,
				subject: message.subject || '',
				from: message.sender || message.email || '',
				date: message.date || '',
				text: read.text.slice(0, 60000),
				hidden: read.hidden
			};
		})
});

NEWACTION('Messages|seen', {
	user: true,
	route: '+API /api/ +message_seen --> Messages|seen',
	input: '*id:String(80)',
	action: ($, m) => run($, (store) => MODS.live.markRead($.user, store, m.id))
});

NEWACTION('Drafts|send', {
	user: true,
	route: '+API /api/ +draft_send --> Drafts|send',
	input: '*id:String(80), confirmed:Boolean, *revision:String(80)',
	action: ($, m) => run($, (store) => MODS.live.send($.user, store, m.id, m.confirmed === true, m.revision))
});

NEWACTION('Messages|move', {
	user: true,
	route: '+API /api/ +message_move --> Messages|move',
	input: '*id:String(80), *path:String(500)',
	action: ($, m) => run($, (store) => MODS.live.move($.user, store, m.id, m.path))
});

NEWACTION('Folders|create', {
	user: true,
	route: '+API /api/ +folder_create --> Folders|create',
	input: '*accountId:String(80), *name:String(80), parent:String(500)',
	action: ($, m) => run($, (store) => MODS.live.createFolder($.user, store, m.accountId, m.name, m.parent || ''))
});

NEWACTION('Messages|change', {
	user: true,
	route: '+API /api/ +message_change --> Messages|change',
	input: '*id:String(80), *operation:{read|unread|star|archive|restore|trash}, enabled:Boolean',
	action: ($, m) =>
		run($, async (store) => {
			var result = await MODS.live.change($.user, store, m.id, m.operation, m.enabled);
			return result.moved !== undefined ? result : Welcome.decorate(result, $.language);
		})
});

NEWACTION('Drafts|unattach', {
	user: true,
	route: '+API /api/ +draft_attachment_remove --> Drafts|unattach',
	input: '*id:String(80), *attachmentId:String(32)',
	action: ($, m) =>
		run($, async (store) => {

			var draft = await store.removeAttachment(m.id, m.attachmentId);
			await MODS.users.files($.user).remove($.user.id, m.attachmentId);
			return draft;
		})
});

NEWACTION('Drafts|delete', {
	user: true,
	route: '+API /api/ +draft_delete --> Drafts|delete',
	input: '*id:String(80)',
	action: ($, m) =>
		run($, async (store) => {

			var draft = await store.deleteDraft(m.id);
			for (var item of draft.attachments || [])
				await MODS.users.files($.user).remove($.user.id, item.id);
			return { id: draft.id };
		})
});
