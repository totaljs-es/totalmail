var Welcome = require('../../../modules/welcome');

// A message's sanitized HTML has its own route; no Action answer carries it.
function strip(value) {
	if (value && typeof value === 'object' && !Array.isArray(value) && 'html' in value) {
		var rest = Object.assign({}, value);
		delete rest.html;
		return rest;
	}
	return value;
}

function run($, fn) {
	FUNC.run(
		$,
		function() { return Promise.resolve(fn(MODS.users.forUser($.user))).then(strip); },
		'@(Mail connection failed. Check the server, TLS settings and app password.)'
	);
}

NEWACTION('Accounts|verify', {
	name: 'Verify a mail account',
	user: true,
	route: '+API /api/ +account_verify --> Accounts|verify',
	input: '*accountId:String(80)',
	action: function($, m) { return run($, function(store) { return MODS.live.verify($.user, store, m.accountId); }); }
});

// Support for an account that does not work: the checks, written in the person's language.
NEWACTION('Accounts|diagnose', {
	name: 'Diagnose a mail account',
	user: true,
	route: '+API /api/ +account_diagnose --> Accounts|diagnose',
	input: '*accountId:String(80)',
	action: function($, m) {
		return run($, async function(store) {
			var report = await MODS.live.diagnose($.user, store, m.accountId),
				say = function(text, args) { return TRANSLATE($.language, text).replace(/\{(\d)\}/g, function(found, index) { return args[index] === undefined ? found : args[index]; }); };
			return {
				failed: report.failed,
				warned: report.warned,
				checks: report.checks.map(function(c) {
					return {
						section: c.section,
						status: c.status,
						title: say(c.title, c.args),
						advice: c.advice ? say(c.advice, c.args) : ''
					};
				})
			};
		});
	}
});

NEWACTION('Drafts|forwardfiles', {
	name: 'Attach the files of a forwarded message',
	user: true,
	route: '+API /api/ +draft_forward_files --> Drafts|forwardfiles',
	input: '*id:String(80), *messageId:String(80)',
	action: function($, m) { return run($, function(store) { return MODS.live.forwardFiles($.user, store, m.id, m.messageId); }); }
});

NEWACTION('Accounts|sync', {
	name: 'Synchronize a mail account',
	user: true,
	route: '+API /api/ +account_sync --> Accounts|sync',
	input: '*accountId:String(80), path:String(500)',
	action: function($, m) { return run($, function(store) { return MODS.live.sync($.user, store, m.accountId, m.path || 'INBOX'); }); }
});

NEWACTION('Messages|erase', {
	name: 'Delete messages for good',
	user: true,
	route: '+API /api/ +message_erase --> Messages|erase',
	input: '*id:String(80)',
	action: function($, m) { return run($, function(store) { return MODS.live.erase($.user, store, m.id); }); }
});

NEWACTION('Folders|empty', {
	name: 'Empty a folder',
	user: true,
	route: '+API /api/ +trash_empty --> Folders|empty',
	input: '*accountId:String(80)',
	action: function($, m) { return run($, function(store) { return MODS.live.emptyTrash($.user, store, m.accountId); }); }
});

NEWACTION('Accounts|search', {
	name: 'Search a mail account on the server',
	user: true,
	route: '+API /api/ +account_search --> Accounts|search',
	input: '*accountId:String(80), *path:String(500), *query:String(200)',
	action: function($, m) { return run($, function(store) { return MODS.live.search($.user, store, m.accountId, m.path, m.query); }); }
});

NEWACTION('Accounts|older', {
	name: 'Load older messages',
	user: true,
	route: '+API /api/ +account_older --> Accounts|older',
	input: '*accountId:String(80), *path:String(500)',
	action: function($, m) { return run($, function(store) { return MODS.live.older($.user, store, m.accountId, m.path); }); }
});

NEWACTION('Messages|read', {
	name: 'Read a message',
	user: true,
	route: '+API /api/ +message_read --> Messages|read',
	input: '*id:String(80)',
	action: function($, m) { return run($, function(store) { return MODS.live.read($.user, store, m.id); }); }
});

// The text of a message as a person reads it (no hidden text, no invisible characters): what an app gives to a model on the
// device. The same filter as the assistant of the server, which needs no assistant to be turned on.
NEWACTION('Messages|text', {
	name: 'Read the text of a message',
	user: true,
	route: '+API /api/ +message_text --> Messages|text',
	input: '*id:String(80)',
	action: function($, m) {
		return run($, function(store) {

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
		});
	}
});

NEWACTION('Messages|seen', {
	name: 'Mark messages as read or unread',
	user: true,
	route: '+API /api/ +message_seen --> Messages|seen',
	input: '*id:String(80)',
	action: function($, m) { return run($, function(store) { return MODS.live.markRead($.user, store, m.id); }); }
});

NEWACTION('Drafts|send', {
	name: 'Send a draft',
	user: true,
	route: '+API /api/ +draft_send --> Drafts|send',
	input: '*id:String(80), confirmed:Boolean, *revision:String(80)',
	action: function($, m) { return run($, function(store) { return MODS.live.send($.user, store, m.id, m.confirmed === true, m.revision); }); }
});

NEWACTION('Messages|move', {
	name: 'Move messages',
	user: true,
	route: '+API /api/ +message_move --> Messages|move',
	input: '*id:String(80), *path:String(500)',
	action: function($, m) { return run($, function(store) { return MODS.live.move($.user, store, m.id, m.path); }); }
});

NEWACTION('Folders|create', {
	name: 'Create a folder',
	user: true,
	route: '+API /api/ +folder_create --> Folders|create',
	input: '*accountId:String(80), *name:String(80), parent:String(500)',
	action: function($, m) { return run($, function(store) { return MODS.live.createFolder($.user, store, m.accountId, m.name, m.parent || ''); }); }
});

NEWACTION('Messages|change', {
	name: 'Star or archive messages',
	user: true,
	route: '+API /api/ +message_change --> Messages|change',
	input: '*id:String(80), *operation:{read|unread|star|archive|restore|trash}, enabled:Boolean',
	action: function($, m) {
		return run($, async function(store) {
			var result = await MODS.live.change($.user, store, m.id, m.operation, m.enabled);
			return result.moved !== undefined ? result : Welcome.decorate(result, $.language);
		});
	}
});

NEWACTION('Drafts|unattach', {
	name: 'Remove an attachment from a draft',
	user: true,
	route: '+API /api/ +draft_attachment_remove --> Drafts|unattach',
	input: '*id:String(80), *attachmentId:String(32)',
	action: function($, m) {
		return run($, async function(store) {

			var draft = await store.removeAttachment(m.id, m.attachmentId);
			await MODS.users.files($.user).remove($.user.id, m.attachmentId);
			return draft;
		});
	}
});

NEWACTION('Drafts|delete', {
	name: 'Delete a draft',
	user: true,
	route: '+API /api/ +draft_delete --> Drafts|delete',
	input: '*id:String(80)',
	action: function($, m) {
		return run($, async function(store) {

			var draft = await store.deleteDraft(m.id);
			for (var list = Array.from(draft.attachments || []), i = 0; i < list.length; i++) {
				var item = list[i];
				await MODS.users.files($.user).remove($.user.id, item.id);
			}
			return { id: draft.id };
		});
	}
});
