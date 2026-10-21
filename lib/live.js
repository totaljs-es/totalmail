const Lazy = require('./lazy'),
	Network = require('./network'),
	Rules = require('./rules'),
	Diagnose = require('./diagnose'),
	imap = require('./imap').create(),
	smtp = require('./smtp').create(require('./vendor/total5-mail').Mailer);
var active = new Set();
exports.create = function(dependencies = {}) {
	var engine = dependencies.imap || imap,
		sender = dependencies.smtp || smtp,
		resolve = dependencies.resolve || Network.resolve,
		oauth = dependencies.oauth || Lazy(() => MODS.oauth),
		providers = dependencies.providers || Lazy(() => MODS.providers),
		files = dependencies.files || ((user) => MODS.users.files(user)),
		decrypt = dependencies.decrypt || ((value) => MODS.security.identities.decrypt(value));
	// For OAuth accounts the "password" handed to IMAP and SMTP is a fresh access token.
	async function credential(store, id) {
		var account = store.account(id);
		if (account.authType === 'oauth2')
			return {
				account,
				password: await oauth.accessToken(account, store)
			};
		if (!account.secret)
			throw Error('@(Save a mail password or app password before connecting.)');
		return {
			account,
			password: decrypt(account.secret)
		};
	}
	// A rejected sign-in usually means the provider needs another kind of credential: say which.
	async function explain(account, err) {
		if (!err?.authenticationFailed)
			return err;
		var provider = providers.get(await providers.detect(account.email));
		if (provider?.auth === 'oauth2')
			return Error(
				'@(The server rejected the sign-in. This mailbox is hosted by a provider that requires OAuth. Choose it as the account type and follow its guide.)'
			);
		if (provider?.auth === 'app-password')
			return Error(
				'@(The server rejected the sign-in. This provider needs an app password. Choose it as the account type and follow its guide.)'
			);
		return Error('@(The server rejected the sign-in. Check the username and password.)');
	}
	// Runs the account's rules on new inbox messages, using the same operations as the buttons. Called while the account
	// is already locked by the sync. Every outcome is written to the account's rule log.
	async function applyrules(store, accountid, password, target, ids) {
		var account = store.account(accountid),
			rules = (account.rules || []).filter((r) => r.enabled !== false),
			log = [],
			done = 0;
		if (!rules.length)
			return;
		for (var messageid of ids) {
			if (done >= Rules.limits.actionsPerSync)
				break;
			var message = store.message(messageid),
				rule = Rules.firstMatch(rules, message);
			if (!rule || !message.remote)
				continue;
			done++;
			var entry = {
				at: new Date().toISOString(),
				rule: rule.name,
				action: rule.action + (rule.path ? ': ' + rule.path : ''),
				subject: String(message.subject || '').slice(0, 80),
				from: message.email || '',
				ok: true
			};
			try {
				if (rule.action === 'read' || rule.action === 'star') {
					var flags = await engine.flags(
						account,
						password,
						target,
						message,
						rule.action === 'read' ? '\\Seen' : '\\Flagged',
						true
					);
					await store.setFlags(messageid, flags);
				} else {
					var moved = await engine.move(
						account,
						password,
						target,
						message,
						rule.action === 'move' ? rule.path : '',
						rule.action === 'archive' ? '\\Archive' : rule.action === 'trash' ? '\\Trash' : ''
					);
					await store.commitMove(messageid, moved);
				}
			} catch (err) {
				entry.ok = false;
				entry.error = String(err.message || '').startsWith('@(') ? err.message : 'failed';
			}
			log.push(entry);
		}
		if (log.length)
			await store.logRules(accountid, log.reverse(), Rules.limits.log);
	}
	async function exclusive(userid, id, fn) {
		var key = userid + ':' + id;
		if (active.has(key))
			throw Error('@(This mail account is busy. Wait for the current operation.)');
		active.add(key);
		try {
			return await fn();
		} finally {
			active.delete(key);
		}
	}
	function attachment(user, store, id, index) {
		var message = store.message(id);
		if (!message.remote)
			throw Error('@(Attachment not found.)');
		return exclusive(user.id, message.accountId, async () => {
			var { account, password } = await credential(store, message.accountId);
			return engine.attachment(account, password, await resolve(account.imap.host), message, index);
		});
	}
	async function commit(fn) {
		try {
			return await fn();
		} catch (err) {
			throw Error('@(The server changed but TotalMail could not save it. Sync this account.)');
		}
	}
	return {
		verify: (user, store, id) =>
			exclusive(user.id, id, async () => {
				var { account, password } = await credential(store, id),
					incoming = await resolve(account.imap.host),
					outgoing = await resolve(account.smtp.host);
				var folders;
				try {
					folders = await engine.probe(account, password, incoming);
				} catch (err) {
					throw await explain(account, err);
				}
				try {
					await sender.verify(sender.options(account, password, outgoing));
				} catch (err) {
					// Reading worked, so for OAuth the likely cause is the organization's SMTP AUTH setting.
					if (account.authType === 'oauth2')
						throw Error(
							account.oauth?.provider === 'google'
								? '@(The sign-in worked for reading but the server refused it for sending. Check that sending is allowed for this mailbox.)'
								: '@(Microsoft accepted the sign-in for reading but not for sending. The organization may have SMTP AUTH disabled for this mailbox; ask its administrator to enable it.)'
						);
					throw err;
				}
				return store.setConnection(id, folders);
			}),
		// Support: what a technician would check on this account, with the saved password but never changing anything.
		diagnose: (user, store, id) =>
			exclusive(user.id, id, async () => {
				var account = store.account(id),
					password = '';
				try {
					password = (await credential(store, id)).password;
				} catch (err) {
					// An OAuth account whose sign-in cannot be renewed says why; a password account without one is only reported.
					if (account.authType === 'oauth2')
						throw err;
				}
				var provider = providers.get(await providers.detect(account.email));
				return Diagnose.create({
					resolve,
					imap: (a, p, target) => engine.probe(a, p, target),
					smtp: (a, p, target) => sender.verify(sender.options(a, p, target))
				}).run(account, password, provider?.auth || '');
			}),
		sync: (user, store, id, path) =>
			exclusive(user.id, id, async () => {
				var { account, password } = await credential(store, id);
				if (path !== 'INBOX' && !account.mailboxes?.some((f) => f.path === path))
					throw Error('@(This folder is not available on the server.)');
				var target = await resolve(account.imap.host);
				var summary = await store.commitSync(id, await engine.sync(account, password, target, path, store.known(id, path)));
				// Rules only look at mail that arrived since the last sync; a failure never fails the sync itself.
				if (summary.fresh?.length)
					await applyrules(store, id, password, target, summary.fresh).catch(() => {});
				return summary;
			}),
		// Permanent deletion: only for remote messages that already are in the trash.
		erase: (user, store, id) => {
			var message = store.message(id);
			if (!message.remote || message.folder !== 'trash')
				throw Error('@(Only messages in the trash can be deleted permanently.)');
			return exclusive(user.id, message.accountId, async () => {
				var { account, password } = await credential(store, message.accountId);
				await engine.erase(account, password, await resolve(account.imap.host), message);
				return commit(() => store.commitErased(id));
			});
		},
		emptyTrash: (user, store, id) =>
			exclusive(user.id, id, async () => {
				var { account, password } = await credential(store, id);
				var result = await engine.empty(account, password, await resolve(account.imap.host));
				await commit(() => store.commitEmptied(id, result.path));
				return { accountId: id, removed: result.removed };
			}),
		// Searches one folder on the server and caches the hits so they can be opened like any other message.
		search: (user, store, id, path, query) =>
			exclusive(user.id, id, async () => {
				query = String(query || '')
					.replace(/[\x00-\x1f\x7f]+/g, ' ')
					.trim();
				if (query.length < 2 || query.length > 200 || require('../plugins/mail/public/query').parse(query).empty)
					throw Error('@(Type at least two characters to search.)');
				var { account, password } = await credential(store, id);
				if (path !== 'INBOX' && !account.mailboxes?.some((f) => f.path === path))
					throw Error('@(This folder is not available on the server.)');
				var result = await engine.search(account, password, await resolve(account.imap.host), path, query);
				return store.commitFound(id, result, 5000);
			}),
		older: (user, store, id, path) =>
			exclusive(user.id, id, async () => {
				var { account, password } = await credential(store, id);
				if (path !== 'INBOX' && !account.mailboxes?.some((f) => f.path === path))
					throw Error('@(This folder is not available on the server.)');
				var before = store.oldest(id, path, 5000);
				return store.commitOlder(id, await engine.older(account, password, await resolve(account.imap.host), path, before));
			}),
		read: (user, store, id) => {
			var message = store.message(id);
			if (
				!message.remote ||
				(message.bodyLoaded &&
					message.hasHtml !== undefined &&
					message.unsubscribe !== undefined &&
					!(message.attachmentCount && !message.attachments))
			)
				return Promise.resolve(message);
			return exclusive(user.id, message.accountId, async () => {
				var { account, password } = await credential(store, message.accountId);
				return store.cacheBody(id, await engine.read(account, password, await resolve(account.imap.host), message));
			});
		},
		attachment,
		source: (user, store, id) => {
			var message = store.message(id);
			if (!message.remote)
				throw Error('@(Message not found.)');
			return exclusive(user.id, message.accountId, async () => {
				var { account, password } = await credential(store, message.accountId);
				var name =
					String(message.subject || 'message')
						.replace(/[\x00-\x1f\x7f\\\/:*?"<>|%]+/g, '_')
						.trim()
						.slice(0, 80) || 'message';
				return { name: name + '.eml', content: await engine.raw(account, password, await resolve(account.imap.host), message) };
			});
		},
		// Forward: copies the original's attachments into the draft, as far as the limits allow; the rest are counted.
		forwardFiles: async (user, store, draftid, messageid) => {
			var message = store.message(messageid),
				skipped = 0;
			var draft = store.snapshot().drafts.find((d) => d.id === draftid);
			if (!draft)
				throw Error('@(Draft not found.)');
			var Files = require('./files');
			for (var item of message.remote ? message.attachments || [] : []) {
				var used = (draft.attachments || []).reduce((sum, a) => sum + a.size, 0);
				if (
					!item.size ||
					item.size > Files.limits.file ||
					used + item.size > Files.limits.total ||
					(draft.attachments || []).length >= Files.limits.files
				) {
					skipped++;
					continue;
				}
				var file = await attachment(user, store, messageid, item.index),
					id = await files(user).put(user.id, file.content);
				try {
					draft = await store.addAttachment(
						draftid,
						{ id, name: file.name || item.name, type: item.type || 'application/octet-stream', size: file.content.length },
						Files.limits
					);
				} catch {
					await files(user).remove(user.id, id);
					skipped++;
				}
			}
			return { ...draft, skippedFiles: skipped };
		},
		markRead: (user, store, id) => {
			var message = store.message(id);
			if (!message.remote)
				return store.markRead(id);
			return exclusive(user.id, message.accountId, async () => {
				var { account, password } = await credential(store, message.accountId);
				await engine.markRead(account, password, await resolve(account.imap.host), message);
				return store.markRead(id);
			});
		},

		change: (user, store, id, operation, enabled) => {
			var message = store.message(id);
			if (!message.remote)
				return store.changeMessage(id, operation);
			if (!['read', 'unread', 'star', 'archive', 'restore', 'trash'].includes(operation))
				throw Error('@(Invalid operation.)');
			return exclusive(user.id, message.accountId, async () => {
				message = store.message(id);
				var { account, password } = await credential(store, message.accountId),
					target = await resolve(account.imap.host);
				if (['read', 'unread', 'star'].includes(operation)) {
					if (operation === 'star' && typeof enabled !== 'boolean')
						throw Error('@(Invalid operation.)');
					var flags = await engine.flags(
						account,
						password,
						target,
						message,
						operation === 'star' ? '\\Flagged' : '\\Seen',
						operation === 'star' ? enabled : operation === 'read'
					);
					return commit(() => store.setFlags(id, flags));
				}
				var result = await engine.move(
					account,
					password,
					target,
					message,
					operation === 'restore' ? 'INBOX' : '',
					operation === 'archive' ? '\\Archive' : operation === 'trash' ? '\\Trash' : ''
				);
				return commit(() => store.commitMove(id, result));
			});
		},
		move: (user, store, id, path) => {
			var message = store.message(id);
			if (!message.remote)
				throw Error('@(Only server messages can be moved between server folders.)');
			return exclusive(user.id, message.accountId, async () => {
				message = store.message(id);
				var { account, password } = await credential(store, message.accountId);
				var result = await engine.move(account, password, await resolve(account.imap.host), message, path);
				return commit(() => store.commitMove(id, result));
			});
		},
		createFolder: (user, store, id, name, parent) =>
			exclusive(user.id, id, async () => {
				var { account, password } = await credential(store, id);
				var result = await engine.createFolder(account, password, await resolve(account.imap.host), name, parent);
				await commit(() => store.setFolders(id, result.folders));
				return { accountId: id, path: result.path, created: result.created };
			}),

		send: (user, store, id, confirmed, revision) => {
			if (!confirmed)
				throw Error('@(Confirm the recipients and message before sending.)');
			var snapshot = store.snapshot(),
				draft = snapshot.drafts.find((d) => d.id === id);
			if (!draft)
				throw Error('@(Draft not found.)');
			if (!revision || revision !== draft.revision)
				throw Error('@(The draft changed. Review it again before sending.)');
			return exclusive(user.id, draft.accountId, async () => {
				var { account, password } = await credential(store, draft.accountId);
				var recipients = draft.to
					.split(/[,;]/)
					.map((v) => v.trim())
					.filter(Boolean);
				var copies = (draft.cc || '')
					.split(/[,;]/)
					.map((v) => v.trim())
					.filter(Boolean);
				var blind = (draft.bcc || '')
					.split(/[,;]/)
					.map((v) => v.trim())
					.filter(Boolean);
				if (
					!recipients.length ||
					recipients.length + copies.length + blind.length > 10 ||
					[...recipients, ...copies, ...blind].some((v) => !v.isEmail())
				)
					throw Error('@(Enter up to 10 plain email addresses separated by commas.)');
				if (!draft.subject.trim() || !draft.body.trim())
					throw Error('@(Add a subject and message before sending.)');
				var parent = draft.replyTo ? store.message(draft.replyTo) : null;
				if (parent && parent.accountId !== draft.accountId)
					throw Error('@(Invalid thread.)');
				if (parent?.remote && !parent.bodyLoaded)
					parent = await store.cacheBody(
						parent.id,
						await engine.read(account, password, await resolve(account.imap.host), parent)
					);
				var target = await resolve(account.smtp.host);
				var attachments = [];
				for (var item of draft.attachments || [])
					attachments.push({ name: item.name, content: await files(user).get(user.id, item.id) });
				var sending = await store.beginSend(id, draft);
				var delivered;
				try {
					// The alias is looked at again here: it may have been removed from the account since the draft was written.
					var from = require('./aliases').sender(account, sending.from);
					delivered = await sender.send(
						sender.options(account, password, target),
						from ? { ...account, email: from } : account,
						sending,
						recipients,
						parent,
						copies,
						attachments,
						blind
					);
				} catch (e) {
					await store.finishSend(id, 'unknown');
					throw e;
				}
				// SMTP acceptance is terminal even if saving its IMAP copy fails.
				await commit(() => store.finishSend(id, 'sent'));
				for (var file of draft.attachments || [])
					await files(user).remove(user.id, file.id);
				var copy;
				try {
					copy = delivered?.source
						? await engine.saveSent(account, password, await resolve(account.imap.host), delivered.source, sending.messageId)
						: { status: 'unavailable' };
				} catch {
					copy = { status: 'unknown' };
				}
				await commit(() => store.setSentCopy(id, copy));
				return { id, status: 'sent', sentCopy: copy.status };
			});
		}
	};
};
