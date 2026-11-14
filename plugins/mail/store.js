// Private mailbox storage of one person: accounts, cached messages and drafts, in the database (tables mail_<id>_accounts,
// mail_<id>_messages and mail_<id>_drafts) with the whole mailbox also in memory. Only committed writes replace the snapshot.
var Mirror = require('../../modules/mirror');
var Aliases = require('./aliases');

exports.spec = function(table, id) {
	return {
		table,
		prefix: 'mail_' + id,
		lists: ['accounts', 'messages', 'drafts'],
		// Drafts keep the order they were saved in: the most recent first.
		sort: { drafts: function(a, b) { return String(b.updated || '').localeCompare(String(a.updated || '')); } }
	};
};

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

	var state = storage.state;
	// A message that was being sent when the process stopped: nobody knows whether it left, which is what `unknown` says.
	for (var stale = Array.from(state.drafts || []), s = 0; s < stale.length; s++)
		if (stale[s].status === 'sending')
			stale[s].status = 'unknown';

	var update = Mirror.writer(storage, function() { return state; }, function(next) { state = next; });
	function message(next, id) {

		var value = next.messages.find(function(item) { return item.id === id; });
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
		var loaded = next.messages.filter(function(m) { return m.remote && m.accountId === account.id && m.mailboxPath === path; }).length;
		account.remaining = Object.assign({}, account.remaining, { [path]: Math.max(0, total - loaded) });
	}
	return {
		clean: function() { return storage.mirror.clean(); },
		account: function(id) {

			var value = state.accounts.find(function(a) { return a.id === id && a.configured; });
			if (!value)
				throw Error('@(Invalid account.)');
			return structuredClone(value);
		},
		message: function(id) { return structuredClone(message(state, id)); },
		setConnection: function(id, folders) {
			return update(function(next) {

				var a = next.accounts.find(function(a) { return a.id === id; });
				if (!a)
					throw Error('@(Invalid account.)');
				a.status = 'verified';
				a.verifiedAt = new Date().toISOString();
				a.mailboxes = folders;
				return {
					id,
					status: a.status
				};
			});
		},
		commitSync: function(accountid, result) {
			return update(function(next) {

				var a = next.accounts.find(function(a) { return a.id === accountid; });
				if (!a)
					throw Error('@(Invalid account.)');
				var old = next.messages.filter(function(m) { return m.accountId === accountid && m.mailboxPath === result.path; });
				for (var list = Array.from(result.messages), i = 0; i < list.length; i++) {
					var m = list[i];
					var previous = old.find(function(o) { return o.id === m.id; });
					if ((previous && previous.bodyLoaded)) {
						m.body = previous.body;
						m.html = previous.html || '';
						// undefined (opened before formatted mail existed) stays undefined so the message is read again once
						m.hasHtml = previous.hasHtml;
						m.remoteImages = previous.remoteImages || 0;
						m.bodyLoaded = true;
						m.attachmentCount = previous.attachmentCount;
						m.messageId = previous.messageId || m.messageId;
						// Headers fetched at sync time are kept when the body fetch did not provide any.
						m.references = (previous.references && previous.references.length) ? previous.references : m.references;
						m.inReplyTo = previous.inReplyTo || m.inReplyTo;
						m.toRecipients = previous.toRecipients || m.toRecipients;
						m.ccRecipients = previous.ccRecipients || m.ccRecipients;
						m.replyAddress = previous.replyAddress || m.replyAddress;
					}
				}
				// Messages that really arrived since the last sync of this inbox: a higher UID than anything cached, in the same
				// mailbox identity. The first sync of an inbox, or one after UIDVALIDITY changed, has no new mail by this definition.
				var newest = old.reduce(function(n, o) { return o.uidValidity === result.uidValidity ? Math.max(n, o.uid || 0) : n; }, 0);
				var fresh =
						newest > 0 && result.path.toUpperCase() === 'INBOX'
							? result.messages.filter(function(m) { return m.uid > newest; }).map(function(m) { return m.id; })
							: [];
					// Older cached pages survive a sync with refreshed flags; the ones the server dropped are gone.
				var kept = new Map((result.kept || []).map(function(k) { return [k.uid, k]; })),
					survivors = old
						.filter(function(o) { return o.uidValidity === result.uidValidity && kept.has(o.uid); })
						.map(function(o) {
							return Object.assign({}, o, { unread: kept.get(o.uid).unread,
								starred: kept.get(o.uid).starred });
						});
				next.messages = next.messages
					.filter(function(m) { return !(m.remote && m.accountId === accountid && m.mailboxPath === result.path); })
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
			});
		},
		// Cached remote messages of a folder, for the sync that refreshes them.
		known: function(accountid, path) {
			return state.messages
				.filter(function(m) { return m.remote && m.accountId === accountid && m.mailboxPath === path; })
				.map(function(m) { return { uid: m.uid, uidValidity: m.uidValidity }; });
		},
		// The oldest cached message of a folder: the page boundary the server pages from.
		oldest(accountid, path, limit) {

			var list = state.messages.filter(function(m) { return m.remote && m.accountId === accountid && m.mailboxPath === path; });
			if (!list.length)
				throw Error('@(Sync this folder before loading older messages.)');
			if (list.length >= limit)
				throw Error('@(This folder already holds the maximum of cached messages.)');
			var first = list.reduce(function(a, b) { return b.uid < a.uid ? b : a; });
			return { uid: first.uid, uidValidity: first.uidValidity };
		},
		commitOlder: function(accountid, result) {
			return update(function(next) {

				var a = next.accounts.find(function(a) { return a.id === accountid; });
				if (!a)
					throw Error('@(Invalid account.)');
				var ids = new Set(next.messages.map(function(m) { return m.id; }));
				var added = result.messages.filter(function(m) { return !ids.has(m.id); });
				Array.prototype.push.apply(next.messages, added);
				a.mailboxes = result.folders;
				remaining(next, a, result.path, result.total);
				return { accountId: accountid, count: added.length, remaining: a.remaining[result.path] };
			});
		},
		// Stores the (encrypted) OAuth grant of an account; status 'reauth' marks one that must sign in again.
		setOAuth: function(id, oauth, status) {
			return update(function(next) {

				var a = next.accounts.find(function(a) { return a.id === id; });
				if (!a)
					throw Error('@(Invalid account.)');
				a.oauth = oauth;
				if (status)
					a.status = status;
				else if (a.status === 'reauth')
					a.status = 'pending';
				return { id };
			});
		},
		// Rules of an account and the record of what they did.
		saveRule: function(accountid, rule, limit) {
			return update(function(next) {

				var a = next.accounts.find(function(a) { return a.id === accountid; });
				if (!a)
					throw Error('@(Invalid account.)');
				var rules = a.rules || [],
					index = rules.findIndex(function(r) { return r.id === rule.id; });
				if (index < 0 && rules.length >= limit)
					throw Error('@(An account can have up to 30 rules.)');
				if (index < 0)
					rules.push(rule);
				else
					rules[index] = rule;
				a.rules = rules;
				return { accountId: accountid, rules: a.rules, ruleLog: a.ruleLog || [] };
			});
		},
		deleteRule: function(accountid, id) {
			return update(function(next) {

				var a = next.accounts.find(function(a) { return a.id === accountid; });
				if (!a || !(a.rules || []).some(function(r) { return r.id === id; }))
					throw Error('@(Rule not found.)');
				a.rules = a.rules.filter(function(r) { return r.id !== id; });
				return { accountId: accountid, rules: a.rules, ruleLog: a.ruleLog || [] };
			});
		},
		logRules: function(accountid, entries, limit) {
			return update(function(next) {

				var a = next.accounts.find(function(a) { return a.id === accountid; });
				if (!a)
					throw Error('@(Invalid account.)');
				a.ruleLog = Array.from(entries).concat(Array.from(a.ruleLog || [])).slice(0, limit);
				return { accountId: accountid };
			});
		},
		// A message deleted for good, or a whole trash folder emptied: they leave the cache.
		commitErased: function(id) {
			return update(function(next) {

				var m = message(next, id);
				next.messages = next.messages.filter(function(x) { return x.id !== id; });
				for (var list = Array.from(next.drafts), i = 0; i < list.length; i++) {
					var draft = list[i];
					if (draft.replyTo === id)
						draft.replyTo = '';
				}
				var a = next.accounts.find(function(a) { return a.id === m.accountId; });
				if ((a && (a.remaining && a.remaining[m.mailboxPath])))
					a.remaining[m.mailboxPath] = Math.max(0, a.remaining[m.mailboxPath] - 1);
				return { id };
			});
		},
		commitEmptied: function(accountid, path) {
			return update(function(next) {

				var a = next.accounts.find(function(a) { return a.id === accountid; });
				if (!a)
					throw Error('@(Invalid account.)');
				var gone = new Set(
					next.messages.filter(function(m) { return m.remote && m.accountId === accountid && m.mailboxPath === path; }).map(function(m) { return m.id; })
				);
				next.messages = next.messages.filter(function(m) { return !gone.has(m.id); });
				for (var list = Array.from(next.drafts), i = 0; i < list.length; i++) {
					var draft = list[i];
					if (gone.has(draft.replyTo))
						draft.replyTo = '';
				}
				a.remaining = Object.assign({}, a.remaining, { [path]: 0 });
				return { accountId: accountid, removed: gone.size };
			});
		},
		// Server search hits join the cache like any older message; the folder's unloaded count is recalculated.
		commitFound: function(accountid, result, limit) {
			return update(function(next) {

				var a = next.accounts.find(function(a) { return a.id === accountid; });
				if (!a)
					throw Error('@(Invalid account.)');
				var ids = new Set(next.messages.map(function(m) { return m.id; }));
				var loaded = next.messages.filter(function(m) { return m.remote && m.accountId === accountid && m.mailboxPath === result.path; }).length;
				var added = [];
				for (var list = Array.from(result.messages), i = 0; i < list.length; i++) {
					var m = list[i];
					if (ids.has(m.id))
						continue;
					if (loaded + added.length >= limit)
						break;
					added.push(m);
				}
				Array.prototype.push.apply(next.messages, added);
				a.mailboxes = result.folders;
				remaining(next, a, result.path, result.total);
				return {
					accountId: accountid,
					ids: result.messages.map(function(m) { return m.id; }).filter(function(id) { return ids.has(id) || added.some(function(x) { return x.id === id; }); }),
					added: added.length,
					found: result.found,
					limited: added.length < result.messages.filter(function(m) { return !ids.has(m.id); }).length
				};
			});
		},
		setFolders: function(id, folders) {
			return update(function(next) {

				var a = next.accounts.find(function(a) { return a.id === id; });
				if (!a)
					throw Error('@(Invalid account.)');
				a.mailboxes = folders;
				return { accountId: id };
			});
		},
		setFlags: function(id, flags) {
			return update(function(next) {

				var m = message(next, id);
				m.unread = !!flags.unread;
				m.starred = !!flags.starred;
				return m;
			});
		},
		commitMove: function(id, result) {
			return update(function(next) {

				var m = message(next, id),
					a = next.accounts.find(function(a) { return a.id === m.accountId; });
				if (!m.remote || !a)
					throw Error('@(Invalid operation.)');
				next.messages = next.messages.filter(function(item) { return item.id !== id && item.id !== (result.moved && result.moved.id); });
				if (result.moved)
					next.messages.push(result.moved);
				a.mailboxes = result.folders;
				for (var list = Array.from(next.drafts), i = 0; i < list.length; i++) {
					var draft = list[i];
					if (draft.replyTo === id)
						draft.replyTo = (result.moved && result.moved.id) || '';
				}
				return { id, moved: result.moved, path: result.path };
			});
		},

		markRead: function(id) {
			return update(function(next) {

				var item = message(next, id);
				item.unread = false;
				return item;
			});
		},
		cacheBody: function(id, body) {
			return update(function(next) {

				var m = message(next, id);
				Object.assign(m, body);
				return m;
			});
		},
		beginSend: function(id, expected) {
			return update(function(next) {

				var draft = next.drafts.find(function(d) { return d.id === id; });
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
							(draft.attachments || []).map(function(a) { return a.id; })
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
								(expected.attachments || []).map(function(a) { return a.id; })
							])
				)
					throw Error('@(The draft changed. Review it again before sending.)');
				if (['sending', 'unknown', 'sent'].includes(draft.status))
					throw Error('@(This draft was already submitted. Check Sent before trying again.)');
					// The domain of the address the message goes out from, as mail servers expect of a Message-ID.
				var account = next.accounts.find(function(a) { return a.id === draft.accountId; });
				var domain = String((account && Aliases.sender(account, draft.from)) || (account && account.email) || '').split('@')[1];
				draft.messageId = '<' + Total.Crypto.randomBytes(24).toString('hex') + '@' + (domain || 'totalmail.local') + '>';
				draft.status = 'sending';
				return draft;
			});
		},
		finishSend: function(id, status) {
			return update(function(next) {

				var draft = next.drafts.find(function(d) { return d.id === id; });
				if (!draft)
					throw Error('@(Draft not found.)');
				draft.status = status;
				if (status === 'sent') {
					draft.sentAt = new Date().toISOString();
					var a = next.accounts.find(function(a) { return a.id === draft.accountId; });
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
						email: Aliases.sender(a, draft.from) || a.email,
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
			});
		},
		setSentCopy: function(id, result) {
			return update(function(next) {

				var draft = next.drafts.find(function(d) { return d.id === id; });
				if (!draft || draft.status !== 'sent')
					throw Error('@(Draft not found.)');
				draft.sentCopy = result;
				var sent = next.messages.find(function(m) { return m.sentDraftId === id; });
				if (sent)
					sent.sentCopy = result.status;
				return result;
			});
		},
		addAttachment: function(id, item, limits) {
			return update(function(next) {

				var draft = next.drafts.find(function(d) { return d.id === id; });
				if (!draft)
					throw Error('@(Draft not found.)');
				if (['sending', 'unknown', 'sent'].includes(draft.status))
					throw Error('@(This draft was already submitted. Check Sent before trying again.)');
				var list = draft.attachments || [];
				if (list.length >= limits.files)
					throw Error('@(A message can carry up to 10 attachments.)');
				if (list.reduce(function(sum, a) { return sum + a.size; }, item.size) > limits.total)
					throw Error('@(Attachments can add up to 15 MB per message.)');
				draft.attachments = Array.from(list).concat([item]);
				draft.revision = UID();
				return draft;
			});
		},
		removeAttachment: function(id, attachmentid) {
			return update(function(next) {

				var draft = next.drafts.find(function(d) { return d.id === id; });
				if (!draft)
					throw Error('@(Draft not found.)');
				if (['sending', 'unknown', 'sent'].includes(draft.status))
					throw Error('@(This draft was already submitted. Check Sent before trying again.)');
				if (!(draft.attachments || []).some(function(a) { return a.id === attachmentid; }))
					throw Error('@(Attachment not found.)');
				draft.attachments = draft.attachments.filter(function(a) { return a.id !== attachmentid; });
				draft.revision = UID();
				return draft;
			});
		},
		// What a caller needs of the mailbox without a copy of all of it (the whole snapshot is for the window that draws everything).
		// The ids of the accounts that can be read: set up and connected.
		accountIds: function() {
			return state.accounts
				.filter(function(a) { return a.configured && ['verified', 'synced'].includes(a.status); })
				.map(function(a) { return a.id; });
		},
		// One draft, copied, or undefined.
		draft: function(id) {
			var found = state.drafts.find(function(d) { return d.id === id; });
			return found ? structuredClone(found) : undefined;
		},
		// The messages of the server in one folder of one account, copied (with the sanitized HTML left out, as in the snapshot).
		folderMessages: function(accountid, folder) {
			return state.messages
				.filter(function(m) { return m.remote && m.accountId === accountid && m.folder === folder; })
				.map(function(m) {
					var copy = structuredClone(m);
					delete copy.html;
					return copy;
				});
		},
		snapshot: function() {

			var data = structuredClone(state);
			// The sanitized HTML of a message is served by its own route, never inside the list of messages.
			for (var list = Array.from(data.messages), i = 0; i < list.length; i++) {
				var message = list[i];
				delete message.html;
			}
			for (var list = Array.from(data.accounts), i = 0; i < list.length; i++) {
				var account = list[i];
				delete account.secret;
				if (account.oauth)
					account.oauth = { provider: account.oauth.provider };
			}
			return data;
		},
		saveAccount: function(account) {
			return update(function(next) {

				var existing = account.id ? next.accounts.find(function(a) { return a.id === account.id; }) : null;
				if (account.id && !existing)
					throw new Error('@(Invalid account.)');
				if (!existing && next.accounts.some(function(a) { return a.email.toLowerCase() === account.email.toLowerCase(); }))
					throw new Error('@(This mail account already exists.)');
				var saved = Object.assign({}, existing, account);
				if (account.newId) {
					saved.id = account.newId;
					delete saved.newId;
				}
				if (existing)
					Object.assign(existing, saved);
				else
					next.accounts.push(saved);
				var output = Object.assign({}, saved);
				delete output.secret;
				if (output.oauth)
					output.oauth = { provider: output.oauth.provider };
				return output;
			});
		},
		changeMessage: function(id, operation) {
			return update(function(next) {

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
			});
		},
		saveDraft: function(draft) {
			return update(function(next) {

				if (!next.accounts.some(function(item) { return item.id === draft.accountId; }))
					throw new Error('@(Invalid account.)');
				if (draft.replyTo && !next.messages.some(function(item) { return item.id === draft.replyTo && item.accountId === draft.accountId; }))
					throw new Error('@(Invalid thread.)');
				var current = next.drafts.find(function(d) { return d.id === draft.id; });
				if (current && ['sending', 'unknown', 'sent'].includes(current.status))
					throw Error('@(This draft was already submitted. Check Sent before trying again.)');
				var saved = {
					id: draft.id,
					revision: UID(),
					accountId: draft.accountId,
					// An alias the account really has; the main address is stored as no choice.
					from: Aliases.sender(
						next.accounts.find(function(item) { return item.id === draft.accountId; }),
						draft.from
					),
					to: draft.to || '',
					cc: draft.cc || '',
					bcc: draft.bcc || '',
					subject: draft.subject || '',
					body: draft.body || '',
					replyTo: draft.replyTo || '',
					attachments: (current && current.attachments) || [],
					updated: new Date().toISOString()
				};
				var index = next.drafts.findIndex(function(item) { return item.id === saved.id; });
				if (index < 0)
					next.drafts.unshift(saved);
				else
					next.drafts[index] = saved;
				return saved;
			});
		},
		// A draft that was never submitted can be thrown away; one on its way out or already sent is part of Sent.
		// Removes an account from TotalMail with the mail it cached and its drafts (the mailbox on the mail server is not touched).
		// Returns the ids of the files that its drafts had attached, for the caller to delete.
		deleteAccount: function(id) {
			return update(function(next) {

				var index = next.accounts.findIndex(function(a) { return a.id === id; });
				if (index < 0)
					throw new Error('@(Invalid account.)');
				var drafts = next.drafts.filter(function(d) { return d.accountId === id; });
				if (drafts.some(function(d) { return d.status === 'sending'; }))
					throw new Error('@(A message of this account is being sent. Check Sent before removing it.)');
				var files = drafts.flatMap(function(d) { return (d.attachments || []).map(function(item) { return item.id; }); });
				next.accounts.splice(index, 1);
				next.messages = next.messages.filter(function(m) { return m.accountId !== id; });
				next.drafts = next.drafts.filter(function(d) { return d.accountId !== id; });
				return { id, files };
			});
		},
		deleteDraft: function(id) {
			return update(function(next) {

				var index = next.drafts.findIndex(function(d) { return d.id === id; });
				if (index < 0)
					throw Error('@(Draft not found.)');
				// Discarding a draft whose delivery is unknown is how the person settles it once they have looked in Sent; it sends nothing.
				if (['sending', 'sent'].includes(next.drafts[index].status))
					throw Error('@(This draft was already submitted. Check Sent before trying again.)');
				return next.drafts.splice(index, 1)[0];
			});
		}
	};
};
