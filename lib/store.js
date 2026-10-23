// Private mailbox storage of one person: accounts, cached messages and drafts, in the database (tables mail_<id>_accounts,
// mail_<id>_messages and mail_<id>_drafts) with the whole mailbox also in memory. Only committed writes replace the snapshot.
const Mirror = require('./mirror');

exports.spec = (table, id) => ({
	table,
	prefix: 'mail_' + id,
	lists: ['accounts', 'messages', 'drafts'],
	// Drafts keep the order they were saved in: the most recent first.
	sort: { drafts: (a, b) => String(b.updated || '').localeCompare(String(a.updated || '')) }
});

// options = { table, id, legacy: { file } }: what an earlier version kept as one JSON file per person is imported once.
exports.open = async function(options) {
	return exports.create(
		await Mirror.open(exports.spec(options.table, options.id), {
			seed: { accounts: [], messages: [], drafts: [] },
			legacy: options.legacy
		})
	);
};

// storage = { state, mirror } as Mirror.open() returns it.
exports.create = function(storage) {

	let state = storage.state;
	let queue = Promise.resolve();
	function update(mutate) {

		var result = queue.then(async function() {

			var next = structuredClone(state);
			var value = mutate(next);
			await storage.mirror.save(next);
			state = next;
			return structuredClone(value);
		});
		queue = result.catch(function() {});
		return result;
	}
	function message(next, id) {

		var value = next.messages.find((item) => item.id === id);
		if (!value)
			throw new Error('@(Message not found.)');
		return value;
	}
	function welcome(next, account) {

		if (account.welcomeAt)
			return;
		account.welcomeAt = new Date().toISOString();
		next.messages.unshift({
			id: 'welcome-' + account.id,
			accountId: account.id,
			folder: 'inbox',
			welcome: true,
			remote: false,
			unread: true,
			starred: false,
			sender: 'TotalMail',
			email: '',
			subject: 'Welcome to TotalMail',
			body: '',
			bodyLoaded: true,
			date: account.welcomeAt
		});
	}
	// How many server messages of a folder are not cached yet.
	function remaining(next, account, path, total) {
		var loaded = next.messages.filter((m) => m.remote && m.accountId === account.id && m.mailboxPath === path).length;
		account.remaining = { ...account.remaining, [path]: Math.max(0, total - loaded) };
	}
	return {
		clean: () => storage.mirror.clean(),
		account: (id) => {

			var value = state.accounts.find((a) => a.id === id && a.configured);
			if (!value)
				throw Error('@(Invalid account.)');
			return structuredClone(value);
		},
		message: (id) => structuredClone(message(state, id)),
		setConnection: (id, folders) =>
			update((next) => {

				var a = next.accounts.find((a) => a.id === id);
				if (!a)
					throw Error('@(Invalid account.)');
				a.status = 'verified';
				a.verifiedAt = new Date().toISOString();
				a.mailboxes = folders;
				return {
					id,
					status: a.status
				};
			}),
		commitSync: (accountid, result) =>
			update((next) => {

				var a = next.accounts.find((a) => a.id === accountid);
				if (!a)
					throw Error('@(Invalid account.)');
				var old = next.messages.filter((m) => m.accountId === accountid && m.mailboxPath === result.path);
				for (var m of result.messages) {
					var previous = old.find((o) => o.id === m.id);
					if (previous?.bodyLoaded) {
						m.body = previous.body;
						m.html = previous.html || '';
						// undefined (opened before formatted mail existed) stays undefined so the message is read again once
						m.hasHtml = previous.hasHtml;
						m.remoteImages = previous.remoteImages || 0;
						m.bodyLoaded = true;
						m.attachmentCount = previous.attachmentCount;
						m.messageId = previous.messageId || m.messageId;
						// Headers fetched at sync time are kept when the body fetch did not provide any.
						m.references = previous.references?.length ? previous.references : m.references;
						m.inReplyTo = previous.inReplyTo || m.inReplyTo;
						m.toRecipients = previous.toRecipients || m.toRecipients;
						m.ccRecipients = previous.ccRecipients || m.ccRecipients;
						m.replyAddress = previous.replyAddress || m.replyAddress;
					}
				}
				// Messages that really arrived since the last sync of this inbox: a higher UID than anything cached, in the same
				// mailbox identity. The first sync of an inbox, or one after UIDVALIDITY changed, has no new mail by this definition.
				var newest = old.reduce((n, o) => (o.uidValidity === result.uidValidity ? Math.max(n, o.uid || 0) : n), 0);
				var fresh =
					newest > 0 && result.path.toUpperCase() === 'INBOX'
						? result.messages.filter((m) => m.uid > newest).map((m) => m.id)
						: [];
				// Older cached pages survive a sync with refreshed flags; the ones the server dropped are gone.
				var kept = new Map((result.kept || []).map((k) => [k.uid, k])),
					survivors = old
						.filter((o) => o.uidValidity === result.uidValidity && kept.has(o.uid))
						.map((o) => ({
							...o,
							unread: kept.get(o.uid).unread,
							starred: kept.get(o.uid).starred
						}));
				next.messages = next.messages
					.filter((m) => !(m.remote && m.accountId === accountid && m.mailboxPath === result.path))
					.concat(result.messages, survivors);
				remaining(next, a, result.path, result.total);
				a.mailboxes = result.folders;
				a.status = 'synced';
				a.syncedAt = new Date().toISOString();
				a.syncLimited = result.limited;
				if (result.path.toUpperCase() === 'INBOX')
					welcome(next, a);
				return {
					accountId: accountid,
					count: result.messages.length,
					fresh,
					total: result.total,
					limited: result.limited
				};
			}),
		// Cached remote messages of a folder, for the sync that refreshes them.
		known: (accountid, path) =>
			state.messages
				.filter((m) => m.remote && m.accountId === accountid && m.mailboxPath === path)
				.map((m) => ({ uid: m.uid, uidValidity: m.uidValidity })),
		// The oldest cached message of a folder: the page boundary the server pages from.
		oldest(accountid, path, limit) {

			var list = state.messages.filter((m) => m.remote && m.accountId === accountid && m.mailboxPath === path);
			if (!list.length)
				throw Error('@(Sync this folder before loading older messages.)');
			if (list.length >= limit)
				throw Error('@(This folder already holds the maximum of cached messages.)');
			var first = list.reduce((a, b) => (b.uid < a.uid ? b : a));
			return { uid: first.uid, uidValidity: first.uidValidity };
		},
		commitOlder: (accountid, result) =>
			update((next) => {

				var a = next.accounts.find((a) => a.id === accountid);
				if (!a)
					throw Error('@(Invalid account.)');
				var ids = new Set(next.messages.map((m) => m.id));
				var added = result.messages.filter((m) => !ids.has(m.id));
				next.messages.push(...added);
				a.mailboxes = result.folders;
				remaining(next, a, result.path, result.total);
				return { accountId: accountid, count: added.length, remaining: a.remaining[result.path] };
			}),
		// Stores the (encrypted) OAuth grant of an account; status 'reauth' marks one that must sign in again.
		setOAuth: (id, oauth, status) =>
			update((next) => {

				var a = next.accounts.find((a) => a.id === id);
				if (!a)
					throw Error('@(Invalid account.)');
				a.oauth = oauth;
				if (status)
					a.status = status;
				else if (a.status === 'reauth')
					a.status = 'pending';
				return { id };
			}),
		// Rules of an account and the record of what they did.
		saveRule: (accountid, rule, limit) =>
			update((next) => {

				var a = next.accounts.find((a) => a.id === accountid);
				if (!a)
					throw Error('@(Invalid account.)');
				var rules = a.rules || [],
					index = rules.findIndex((r) => r.id === rule.id);
				if (index < 0 && rules.length >= limit)
					throw Error('@(An account can have up to 30 rules.)');
				if (index < 0)
					rules.push(rule);
				else
					rules[index] = rule;
				a.rules = rules;
				return { accountId: accountid, rules: a.rules, ruleLog: a.ruleLog || [] };
			}),
		deleteRule: (accountid, id) =>
			update((next) => {

				var a = next.accounts.find((a) => a.id === accountid);
				if (!a || !(a.rules || []).some((r) => r.id === id))
					throw Error('@(Rule not found.)');
				a.rules = a.rules.filter((r) => r.id !== id);
				return { accountId: accountid, rules: a.rules, ruleLog: a.ruleLog || [] };
			}),
		logRules: (accountid, entries, limit) =>
			update((next) => {

				var a = next.accounts.find((a) => a.id === accountid);
				if (!a)
					throw Error('@(Invalid account.)');
				a.ruleLog = [...entries, ...(a.ruleLog || [])].slice(0, limit);
				return { accountId: accountid };
			}),
		// A message deleted for good, or a whole trash folder emptied: they leave the cache.
		commitErased: (id) =>
			update((next) => {

				var m = message(next, id);
				next.messages = next.messages.filter((x) => x.id !== id);
				for (var draft of next.drafts)
					if (draft.replyTo === id)
						draft.replyTo = '';
				var a = next.accounts.find((a) => a.id === m.accountId);
				if (a?.remaining?.[m.mailboxPath])
					a.remaining[m.mailboxPath] = Math.max(0, a.remaining[m.mailboxPath] - 1);
				return { id };
			}),
		commitEmptied: (accountid, path) =>
			update((next) => {

				var a = next.accounts.find((a) => a.id === accountid);
				if (!a)
					throw Error('@(Invalid account.)');
				var gone = new Set(
					next.messages.filter((m) => m.remote && m.accountId === accountid && m.mailboxPath === path).map((m) => m.id)
				);
				next.messages = next.messages.filter((m) => !gone.has(m.id));
				for (var draft of next.drafts)
					if (gone.has(draft.replyTo))
						draft.replyTo = '';
				a.remaining = { ...a.remaining, [path]: 0 };
				return { accountId: accountid, removed: gone.size };
			}),
		// Server search hits join the cache like any older message; the folder's unloaded count is recalculated.
		commitFound: (accountid, result, limit) =>
			update((next) => {

				var a = next.accounts.find((a) => a.id === accountid);
				if (!a)
					throw Error('@(Invalid account.)');
				var ids = new Set(next.messages.map((m) => m.id));
				var loaded = next.messages.filter((m) => m.remote && m.accountId === accountid && m.mailboxPath === result.path).length;
				var added = [];
				for (var m of result.messages) {
					if (ids.has(m.id))
						continue;
					if (loaded + added.length >= limit)
						break;
					added.push(m);
				}
				next.messages.push(...added);
				a.mailboxes = result.folders;
				remaining(next, a, result.path, result.total);
				return {
					accountId: accountid,
					ids: result.messages.map((m) => m.id).filter((id) => ids.has(id) || added.some((x) => x.id === id)),
					added: added.length,
					found: result.found,
					limited: added.length < result.messages.filter((m) => !ids.has(m.id)).length
				};
			}),
		setFolders: (id, folders) =>
			update((next) => {

				var a = next.accounts.find((a) => a.id === id);
				if (!a)
					throw Error('@(Invalid account.)');
				a.mailboxes = folders;
				return { accountId: id };
			}),
		setFlags: (id, flags) =>
			update((next) => {

				var m = message(next, id);
				m.unread = !!flags.unread;
				m.starred = !!flags.starred;
				return m;
			}),
		commitMove: (id, result) =>
			update((next) => {

				var m = message(next, id),
					a = next.accounts.find((a) => a.id === m.accountId);
				if (!m.remote || !a)
					throw Error('@(Invalid operation.)');
				next.messages = next.messages.filter((item) => item.id !== id && item.id !== result.moved?.id);
				if (result.moved)
					next.messages.push(result.moved);
				a.mailboxes = result.folders;
				for (var draft of next.drafts)
					if (draft.replyTo === id)
						draft.replyTo = result.moved?.id || '';
				return { id, moved: result.moved, path: result.path };
			}),

		markRead: (id) =>
			update((next) => {

				var item = message(next, id);
				item.unread = false;
				return item;
			}),
		cacheBody: (id, body) =>
			update((next) => {

				var m = message(next, id);
				Object.assign(m, body);
				return m;
			}),
		beginSend: (id, expected) =>
			update((next) => {

				var draft = next.drafts.find((d) => d.id === id);
				if (!draft)
					throw Error('@(Draft not found.)');
				if (
					expected &&
					JSON.stringify([
						draft.accountId,
						draft.from || '',
						draft.to,
						draft.subject,
						draft.body,
						draft.replyTo,
						draft.cc,
						draft.bcc || '',
						(draft.attachments || []).map((a) => a.id)
					]) !==
						JSON.stringify([
							expected.accountId,
							expected.from || '',
							expected.to,
							expected.subject,
							expected.body,
							expected.replyTo,
							expected.cc,
							expected.bcc || '',
							(expected.attachments || []).map((a) => a.id)
						])
				)
					throw Error('@(The draft changed. Review it again before sending.)');
				if (['sending', 'unknown', 'sent'].includes(draft.status))
					throw Error('@(This draft was already submitted. Check Sent before trying again.)');
				draft.messageId = '<' + Total.Crypto.randomBytes(24).toString('hex') + '@totalmail.local>';
				draft.status = 'sending';
				return draft;
			}),
		finishSend: (id, status) =>
			update((next) => {

				var draft = next.drafts.find((d) => d.id === id);
				if (!draft)
					throw Error('@(Draft not found.)');
				draft.status = status;
				if (status === 'sent') {
					draft.sentAt = new Date().toISOString();
					var a = next.accounts.find((a) => a.id === draft.accountId);
					next.messages.push({
						id: 'sent-' + draft.id,
						sentDraftId: draft.id,
						accountId: draft.accountId,
						folder: 'sent-local',
						outgoing: true,
						remote: false,
						unread: false,
						starred: false,
						sender: a.name,
						email: require('./aliases').sender(a, draft.from) || a.email,
						to: draft.to,
						cc: draft.cc || '',
						bcc: draft.bcc || '',
						messageId: draft.messageId,
						sentCopy: 'pending',
						subject: draft.subject,
						body: draft.body,
						date: draft.sentAt,
						time: ''
					});
				}
				return {
					id,
					status
				};
			}),
		setSentCopy: (id, result) =>
			update((next) => {

				var draft = next.drafts.find((d) => d.id === id);
				if (!draft || draft.status !== 'sent')
					throw Error('@(Draft not found.)');
				draft.sentCopy = result;
				var sent = next.messages.find((m) => m.sentDraftId === id);
				if (sent)
					sent.sentCopy = result.status;
				return result;
			}),
		addAttachment: (id, item, limits) =>
			update((next) => {

				var draft = next.drafts.find((d) => d.id === id);
				if (!draft)
					throw Error('@(Draft not found.)');
				if (['sending', 'unknown', 'sent'].includes(draft.status))
					throw Error('@(This draft was already submitted. Check Sent before trying again.)');
				var list = draft.attachments || [];
				if (list.length >= limits.files)
					throw Error('@(A message can carry up to 10 attachments.)');
				if (list.reduce((sum, a) => sum + a.size, item.size) > limits.total)
					throw Error('@(Attachments can add up to 15 MB per message.)');
				draft.attachments = [...list, item];
				draft.revision = UID();
				return draft;
			}),
		removeAttachment: (id, attachmentid) =>
			update((next) => {

				var draft = next.drafts.find((d) => d.id === id);
				if (!draft)
					throw Error('@(Draft not found.)');
				if (['sending', 'unknown', 'sent'].includes(draft.status))
					throw Error('@(This draft was already submitted. Check Sent before trying again.)');
				if (!(draft.attachments || []).some((a) => a.id === attachmentid))
					throw Error('@(Attachment not found.)');
				draft.attachments = draft.attachments.filter((a) => a.id !== attachmentid);
				draft.revision = UID();
				return draft;
			}),
		snapshot: () => {

			var data = structuredClone(state);
			// The sanitized HTML of a message is served by its own route, never inside the list of messages.
			for (var message of data.messages)
				delete message.html;
			for (var account of data.accounts) {
				delete account.secret;
				if (account.oauth)
					account.oauth = { provider: account.oauth.provider };
			}
			return data;
		},
		saveAccount: (account) =>
			update((next) => {

				var existing = account.id ? next.accounts.find((a) => a.id === account.id) : null;
				if (account.id && !existing)
					throw new Error('@(Invalid account.)');
				if (!existing && next.accounts.some((a) => a.email.toLowerCase() === account.email.toLowerCase()))
					throw new Error('@(This mail account already exists.)');
				var saved = {
					...existing,
					...account
				};
				if (account.newId) {
					saved.id = account.newId;
					delete saved.newId;
				}
				if (existing)
					Object.assign(existing, saved);
				else
					next.accounts.push(saved);
				var output = {
					...saved
				};
				delete output.secret;
				if (output.oauth)
					output.oauth = { provider: output.oauth.provider };
				return output;
			}),
		changeMessage: (id, operation) =>
			update((next) => {

				var item = message(next, id);
				if (item.remote)
					throw Error('@(Changes to server messages are made through the mail server.)');
				if (operation === 'read')
					item.unread = false;
				else if (operation === 'unread')
					item.unread = true;
				else if (operation === 'trash')
					item.folder = 'trash';
				else if (operation === 'star')
					item.starred = !item.starred;
				else if (operation === 'archive')
					item.folder = 'archive';
				else if (operation === 'restore')
					item.folder = 'inbox';
				else
					throw new Error('@(Invalid operation.)');
				return item;
			}),
		saveDraft: (draft) =>
			update((next) => {

				if (!next.accounts.some((item) => item.id === draft.accountId))
					throw new Error('@(Invalid account.)');
				if (draft.replyTo && !next.messages.some((item) => item.id === draft.replyTo && item.accountId === draft.accountId))
					throw new Error('@(Invalid thread.)');
				var current = next.drafts.find((d) => d.id === draft.id);
				if (current && ['sending', 'unknown', 'sent'].includes(current.status))
					throw Error('@(This draft was already submitted. Check Sent before trying again.)');
				var saved = {
					id: draft.id,
					revision: UID(),
					accountId: draft.accountId,
					// An alias the account really has; the main address is stored as no choice.
					from: require('./aliases').sender(
						next.accounts.find((item) => item.id === draft.accountId),
						draft.from
					),
					to: draft.to || '',
					cc: draft.cc || '',
					bcc: draft.bcc || '',
					subject: draft.subject || '',
					body: draft.body || '',
					replyTo: draft.replyTo || '',
					attachments: current?.attachments || [],
					updated: new Date().toISOString()
				};
				var index = next.drafts.findIndex((item) => item.id === saved.id);
				if (index < 0)
					next.drafts.unshift(saved);
				else
					next.drafts[index] = saved;
				return saved;
			}),
		// A draft that was never submitted can be thrown away; one on its way out or already sent is part of Sent.
		// Removes an account from TotalMail with the mail it cached and its drafts (the mailbox on the mail server is not touched).
		// Returns the ids of the files that its drafts had attached, for the caller to delete.
		deleteAccount: (id) =>
			update((next) => {

				var index = next.accounts.findIndex((a) => a.id === id);
				if (index < 0)
					throw new Error('@(Invalid account.)');
				var drafts = next.drafts.filter((d) => d.accountId === id);
				if (drafts.some((d) => ['sending', 'unknown'].includes(d.status)))
					throw new Error('@(A message of this account is being sent. Check Sent before removing it.)');
				var files = drafts.flatMap((d) => (d.attachments || []).map((item) => item.id));
				next.accounts.splice(index, 1);
				next.messages = next.messages.filter((m) => m.accountId !== id);
				next.drafts = next.drafts.filter((d) => d.accountId !== id);
				return { id, files };
			}),
		deleteDraft: (id) =>
			update((next) => {

				var index = next.drafts.findIndex((d) => d.id === id);
				if (index < 0)
					throw Error('@(Draft not found.)');
				if (['sending', 'unknown', 'sent'].includes(next.drafts[index].status))
					throw Error('@(This draft was already submitted. Check Sent before trying again.)');
				return next.drafts.splice(index, 1)[0];
			})
	};
};
