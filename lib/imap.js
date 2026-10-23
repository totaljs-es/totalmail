// The search parser is shared with the browser, which filters the loaded list with the same rules.
const Query = require('../plugins/mail/public/query');
const Ics = require('./ics');

const Threading = require('./threading'),
	Html = require('./html');

const { ImapFlow } = require('imapflow'),
	{ simpleParser: SimpleParser } = require('mailparser');

var maxbody = 2 * 1024 * 1024,
	maxmessage = 25 * 1024 * 1024;

// Display names only: no path separators or control characters, bounded length.
function attachmentname(value, index) {
	var name = String(value || '')
		.replace(/[\x00-\x1f\x7f\\\/:*?"<>|]+/g, '_')
		.trim()
		.slice(0, 120);
	return name || 'attachment-' + (index + 1);
}

function folderid(accountid, path, specialuse) {

	if (path.toUpperCase() === 'INBOX')
		return 'inbox';
	if (specialuse === '\\Archive')
		return 'archive';
	if (specialuse === '\\Trash')
		return 'trash';
	return (
		'mailbox-' +
		Total.Crypto.createHash('sha256')
			.update(accountid + '\0' + path)
			.digest('hex')
			.slice(0, 24)
	);
}

function messageid(accountid, path, validity, uid) {
	return (
		'imap-' +
		Total.Crypto.createHash('sha256')
			.update([accountid, path, String(validity), String(uid)].join('\0'))
			.digest('hex')
	);
}

var page = 50,
	headers = {
		uid: true,
		envelope: true,
		flags: true,
		size: true,
		internalDate: true,
		// Message-ID and In-Reply-To come with the envelope; References is the only extra header fetched for threading.
		headers: ['references']
	};

// The References header of a fetched message as validated identifiers (unfolded, bounded).
function referencesof(m) {

	var raw = m.headers ? m.headers.toString('utf8').replace(/\r?\n[ \t]+/g, ' ') : '';
	var line = /^references:\s*(.*)$/im.exec(raw);
	return Threading.references(line ? line[1].split(/\s+/) : []);
}

// Header-only message record shared by sync and paging.
function header(m, a, folder, path, validity) {
	var from = m.envelope.from?.[0] || {},
		date = m.envelope.date || m.internalDate;
	return {
		id: messageid(a.id, path, validity, m.uid),
		accountId: a.id,
		folder: folder.id,
		uid: m.uid,
		uidValidity: validity,
		mailboxPath: path,
		remote: true,
		sender: (from.name || from.address || '').slice(0, 160),
		email: from.address || '',
		replyAddress: m.envelope.replyTo?.[0]?.address || from.address || '',
		toRecipients: (m.envelope.to || []).map((r) => r.address).filter(Boolean),
		ccRecipients: (m.envelope.cc || []).map((r) => r.address).filter(Boolean),
		subject: (m.envelope.subject || '').slice(0, 500),
		date: date ? new Date(date).toISOString() : '',
		time: '',
		body: '',
		bodyLoaded: false,
		size: m.size,
		unread: !m.flags.has('\\Seen'),
		starred: m.flags.has('\\Flagged'),
		messageId: Threading.identifier(m.envelope.messageId),
		inReplyTo: Threading.identifier(m.envelope.inReplyTo),
		references: referencesof(m)
	};
}

function clientoptions(account, password, target, extra) {
	return {
		host: target.address,
		servername: target.servername,
		port: account.imap.port,
		secure: account.imap.security === 'tls',
		doSTARTTLS: account.imap.security === 'starttls',
		tls: {
			rejectUnauthorized: true,
			minVersion: 'TLSv1.2'
		},
		// OAuth accounts pass an access token (XOAUTH2) instead of a password.
		auth:
			account.authType === 'oauth2'
				? { user: account.imap.username, accessToken: password }
				: { user: account.imap.username, pass: password },
		logger: false,
		emitLogs: false,
		logRaw: false,
		disableAutoIdle: true,
		disableCompression: true,
		connectionTimeout: 10000,
		greetingTimeout: 10000,
		socketTimeout: 15000,
		maxLiteralSize: maxmessage,
		maxResponseSize: maxmessage + 65536,
		...extra
	};
}

exports.create = function(factory = (options) => new ImapFlow(options), parser = SimpleParser) {

	async function withclient(account, password, target, fn) {

		var client = factory(clientoptions(account, password, target));
		client.on('error', () => {});
		var timer = setTimeout(() => client.close(), 90000);
		try {
			await client.connect();
			return await fn(client);
		} finally {
			clearTimeout(timer);
			try {
				await Promise.race([
					client.logout(),
					new Promise((resolve) => {
						var t = setTimeout(resolve, 1000);
						t.unref();
					})
				]);
			} catch {}
			client.close();
		}
	}
	async function rawsource(c, message) {

		if (message.size > maxmessage)
			throw Error('@(This message is larger than the 25 MB reading limit.)');
		var lock = await c.getMailboxLock(message.mailboxPath, {
			readOnly: true
		});
		try {
			if (String(c.mailbox.uidValidity) !== message.uidValidity)
				throw Error('@(The mailbox changed. Sync this folder again.)');
			var result = await c.download(message.uid, undefined, {
				uid: true,
				maxBytes: maxmessage + 1
			});
			if (!result.content)
				throw Error('@(Message not found.)');
			let length = 0;
			var chunks = [];
			for await (var chunk of result.content) {
				var bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
				length += bytes.length;
				if (length > maxmessage) {
					result.content.destroy();
					throw Error('@(This message is larger than the 25 MB reading limit.)');
				}
				chunks.push(bytes);
			}
			return Buffer.concat(chunks);
		} finally {
			lock.release();
		}
	}
	async function fetchsource(c, message) {
		return await parser(await rawsource(c, message), {
			skipImageLinks: true,
			skipTextLinks: true,
			skipTextToHtml: true,
			maxHtmlLengthToParse: maxbody
		});
	}
	// What the List-Unsubscribe header offers, kept only when it is safe to follow: an https address, or a plain mailto.
	function unsubscribe(mail) {

		var entry = mail.headers.get('list')?.unsubscribe;
		if (!entry)
			return null;
		var url = '',
			mailto = '',
			subject = '';
		try {
			var u = new URL(String(entry.url || ''));
			if (u.protocol === 'https:' && !u.username && !u.password && u.href.length <= 1000)
				url = u.href;
		} catch {}
		var m = /^([^@\s<>?:\/]+@[^@\s<>?:\/]+)(?:\?(.*))?$/.exec(String(entry.mail || ''));
		if (m && m[1].length <= 254) {
			mailto = m[1];
			try {
				subject = (new URLSearchParams(m[2] || '').get('subject') || '').replace(/[\r\n]+/g, ' ').slice(0, 200);
			} catch {}
		}
		return url || mailto ? { url, mail: mailto, subject } : null;
	}
	// The first calendar invitation among the attachments.
	function invitation(mail) {
		var item = mail.attachments.find((x) => /^text\/calendar/i.test(x.contentType || '') && Buffer.isBuffer(x.content));
		return item ? Ics.parse(item.content.toString('utf8')) : null;
	}
	async function folders(client, account) {
		return (
			// Full listing includes INBOX when the personal namespace is INBOX.
			// listOnly bypasses ImapFlow's extra INBOX lookup for these servers.
			(await client.list())
				.filter((f) => !f.flags.has('\\Noselect'))
				.slice(0, 200)
				.map((f) => ({
					id: folderid(account.id, f.path, f.specialUse),
					accountId: account.id,
					path: f.path,
					name: f.name || f.path,
					specialUse: f.specialUse || '',
					delimiter: f.delimiter || ''
				}))
		);
	}
	return {
		saveSent: (a, p, target, source, id) =>
			withclient(a, p, target, async (c) => {

				if (!Threading.identifier(id) || typeof source !== 'string' || Buffer.byteLength(source) > maxmessage)
					throw Error('Invalid sent MIME copy');
				var list = await folders(c, a),
					sent = list.find((f) => f.specialUse === '\\Sent');
				if (!sent)
					return { status: 'unavailable' };
				var lock = await c.getMailboxLock(sent.path, { readOnly: false });
				try {
					async function find() {

						var uids = await c.search({ header: { 'Message-ID': id } }, { uid: true });
						if (!Array.isArray(uids))
							throw Error('Sent search was not confirmed');
						for (var uid of uids.slice(-20)) {
							var item = await c.fetchOne(uid, { uid: true, envelope: true }, { uid: true });
							if (item?.uid === uid && item.envelope?.messageId === id)
								return uid;
						}
						return 0;
					}
					var uid = await find();
					if (!uid) {
						if (c.mailbox.readOnly)
							throw Error('Sent mailbox is read-only');
						if (!(await c.append(sent.path, source, ['\\Seen'])))
							throw Error('Sent append was not confirmed');
						uid = await find();
						if (!uid)
							throw Error('Sent copy was not found after append');
					}
					return { status: 'saved', path: sent.path, uid, uidValidity: String(c.mailbox.uidValidity) };
				} finally {
					lock.release();
				}
			}),
		// Long-lived INBOX connection that only reports that something changed. It never reads or modifies mail.
		watch: async (a, p, target, onevent) => {

			var client = factory(
				clientoptions(a, p, target, {
					disableAutoIdle: false,
					maxIdleTime: 5 * 60 * 1000,
					socketTimeout: 10 * 60 * 1000
				})
			);
			var closed = false;
			function emit(type, error) {
				if (!closed)
					onevent({ type, error });
			}
			client.on('error', (error) => emit('error', error));
			client.on('close', () => emit('close'));
			for (var type of ['exists', 'expunge', 'flags'])
				client.on(type, () => emit('change'));
			try {
				await client.connect();
				await client.mailboxOpen('INBOX', { readOnly: true });
			} catch (error) {
				closed = true;
				client.close();
				throw error;
			}
			return {
				close() {
					closed = true;
					client.close();
				}
			};
		},
		probe: (a, p, target) => withclient(a, p, target, (c) => folders(c, a)),
		// known: cached messages of this folder as [{uid, uidValidity}]. Older ones outside the latest window only get
		// their flags refreshed (one cheap fetch); the ones the server no longer has are reported as gone.
		sync: (a, p, target, path = 'INBOX', known = []) =>
			withclient(a, p, target, async (c) => {

				var list = await folders(c, a);
				var folder = list.find((f) => f.path === path);
				if (!folder)
					throw Error('@(This folder is not available on the server.)');
				var lock = await c.getMailboxLock(path, {
					readOnly: true
				});
				try {
					var validity = String(c.mailbox.uidValidity),
						messages = [],
						count = c.mailbox.exists;
					if (count)
						for await (var m of c.fetch(Math.max(1, count - page + 1) + ':' + count, headers))
							messages.push(header(m, a, folder, path, validity));
					var low = messages.reduce((min, m) => Math.min(min, m.uid), Infinity),
						older = known.filter((k) => k.uidValidity === validity && k.uid < low).map((k) => k.uid),
						kept = [];
					for (var i = 0; i < older.length; i += 400) {
						var chunk = older.slice(i, i + 400).join(',');
						for await (var m of c.fetch(chunk, { uid: true, flags: true }, { uid: true }))
							kept.push({ uid: m.uid, unread: !m.flags.has('\\Seen'), starred: m.flags.has('\\Flagged') });
					}
					return {
						folders: list,
						messages: messages.reverse(),
						kept,
						path,
						uidValidity: validity,
						total: count,
						limited: count > page
					};
				} finally {
					lock.release();
				}
			}),
		// Permanent deletion is only for messages that already are in the account's Trash. UID EXPUNGE (UIDPLUS) removes exactly
		// the chosen message; without it the server would also expunge anything else flagged as deleted, so it is refused.
		erase: (a, p, target, message) =>
			withclient(a, p, target, async (c) => {

				var list = await folders(c, a),
					trash = list.find((f) => f.specialUse === '\\Trash');
				if (!trash || trash.path !== message.mailboxPath)
					throw Error('@(Only messages in the trash can be deleted permanently.)');
				if (!c.capabilities.has('UIDPLUS'))
					throw Error('@(This server does not support safe deletion.)');
				var lock = await c.getMailboxLock(trash.path, { readOnly: false });
				try {
					if (String(c.mailbox.uidValidity) !== message.uidValidity)
						throw Error('@(The mailbox changed. Sync this folder again.)');
					if (c.mailbox.readOnly)
						throw Error('@(This folder is read-only.)');
					var before = await c.fetchOne(message.uid, { uid: true }, { uid: true });
					// Already gone on the server: nothing to delete, the cache is cleaned up the same way.
					if (!before || before.uid !== message.uid)
						return { path: trash.path };
					if (
						!(await c.messageDelete(message.uid, { uid: true })) ||
						(await c.fetchOne(message.uid, { uid: true }, { uid: true }))
					)
						throw Error('@(The deletion could not be confirmed. Sync this folder before trying again.)');
					return { path: trash.path };
				} finally {
					lock.release();
				}
			}),
		// Empties the account's Trash folder: everything in it is deleted, and nothing else.
		empty: (a, p, target) =>
			withclient(a, p, target, async (c) => {

				var list = await folders(c, a),
					trash = list.find((f) => f.specialUse === '\\Trash');
				if (!trash)
					throw Error('@(This account has no trash folder on the server.)');
				var lock = await c.getMailboxLock(trash.path, { readOnly: false });
				try {
					if (c.mailbox.readOnly)
						throw Error('@(This folder is read-only.)');
					var count = c.mailbox.exists;
					if (count)
						if (!(await c.messageDelete('1:*', { uid: true })) || (await c.search({ all: true }, { uid: true })).length)
							throw Error('@(The deletion could not be confirmed. Sync this folder before trying again.)');

					return { path: trash.path, removed: count };
				} finally {
					lock.release();
				}
			}),
		// Messages of one folder that match a query (words and operators, see plugins/mail/public/query.js), searched by the server.
		// The newest `size` matches come back as headers.
		search: (a, p, target, path, query, size = 100) =>
			withclient(a, p, target, async (c) => {

				var list = await folders(c, a);
				var folder = list.find((f) => f.path === path);
				if (!folder)
					throw Error('@(This folder is not available on the server.)');
				var lock = await c.getMailboxLock(path, {
					readOnly: true
				});
				try {
					var validity = String(c.mailbox.uidValidity),
						messages = [];
					var hits = await c.search(Query.toImap(Query.parse(query)), { uid: true });
					hits = Array.isArray(hits) ? hits.sort((x, y) => y - x) : [];
					var found = hits.length,
						wanted = hits.slice(0, size);
					for (var i = 0; i < wanted.length; i += 200)
						for await (var m of c.fetch(wanted.slice(i, i + 200).join(','), headers, { uid: true }))
							messages.push(header(m, a, folder, path, validity));
					messages.sort((x, y) => y.uid - x.uid);
					return {
						folders: list,
						messages,
						path,
						uidValidity: validity,
						total: c.mailbox.exists,
						found
					};
				} finally {
					lock.release();
				}
			}),
		// The next page of headers older than `before` ({uid, uidValidity} of the oldest cached message).
		older: (a, p, target, path, before, size = page) =>
			withclient(a, p, target, async (c) => {

				var list = await folders(c, a);
				var folder = list.find((f) => f.path === path);
				if (!folder)
					throw Error('@(This folder is not available on the server.)');
				var lock = await c.getMailboxLock(path, {
					readOnly: true
				});
				try {
					var validity = String(c.mailbox.uidValidity),
						messages = [];
					if (validity !== before.uidValidity)
						throw Error('@(The mailbox changed. Sync this folder again.)');
					var first = await c.fetchOne(String(before.uid), { uid: true }, { uid: true });
					if (!first || first.uid !== before.uid)
						throw Error('@(The mailbox changed. Sync this folder again.)');
					var end = first.seq - 1,
						start = Math.max(1, end - size + 1);
					if (end >= 1)
						for await (var m of c.fetch(start + ':' + end, headers))
							messages.push(header(m, a, folder, path, validity));
					return {
						folders: list,
						messages: messages.reverse(),
						path,
						uidValidity: validity,
						total: c.mailbox.exists
					};
				} finally {
					lock.release();
				}
			}),
		markRead: (a, p, target, message) =>
			withclient(a, p, target, async (c) => {
				var lock = await c.getMailboxLock(message.mailboxPath, { readOnly: false });
				try {
					if (String(c.mailbox.uidValidity) !== message.uidValidity)
						throw Error('@(The mailbox changed. Sync this folder again.)');
					var query = { uid: true, flags: true };
					var options = { uid: true };
					var before = await c.fetchOne(message.uid, query, options);
					if (!before || before.uid !== message.uid)
						throw Error('@(Message not found.)');
					if (!before.flags.has('\\Seen'))
						if (c.mailbox.readOnly || !(await c.messageFlagsAdd(message.uid, ['\\Seen'], options)))
							throw Error('@(The server did not confirm the read status. Sync and try again.)');

					var after = await c.fetchOne(message.uid, query, options);
					if (!after || after.uid !== message.uid || !after.flags.has('\\Seen'))
						throw Error('@(The server did not confirm the read status. Sync and try again.)');
				} finally {
					lock.release();
				}
			}),

		flags: (a, p, target, message, flag, enabled) =>
			withclient(a, p, target, async (c) => {

				if (!['\\Seen', '\\Flagged'].includes(flag) || typeof enabled !== 'boolean')
					throw Error('@(Invalid operation.)');
				var lock = await c.getMailboxLock(message.mailboxPath, { readOnly: false });
				try {
					if (String(c.mailbox.uidValidity) !== message.uidValidity)
						throw Error('@(The mailbox changed. Sync this folder again.)');
					var options = { uid: true },
						query = { uid: true, flags: true };
					var before = await c.fetchOne(message.uid, query, options);
					if (!before || before.uid !== message.uid)
						throw Error('@(Message not found.)');
					if (before.flags.has(flag) !== enabled)
						if (
							c.mailbox.readOnly ||
							!(await c[enabled ? 'messageFlagsAdd' : 'messageFlagsRemove'](message.uid, [flag], options))
						)
							throw Error('@(The server did not confirm the message status. Sync and try again.)');

					var after = await c.fetchOne(message.uid, query, options);
					if (!after || after.uid !== message.uid || after.flags.has(flag) !== enabled)
						throw Error('@(The server did not confirm the message status. Sync and try again.)');
					return { unread: !after.flags.has('\\Seen'), starred: after.flags.has('\\Flagged') };
				} finally {
					lock.release();
				}
			}),
		createFolder: (a, p, target, name, parent = '') =>
			withclient(a, p, target, async (c) => {

				var list = await folders(c, a),
					folder = parent ? list.find((f) => f.path === parent) : null;
				if (parent && !folder)
					throw Error('@(This folder is not available on the server.)');
				var delimiter = folder?.delimiter || c.namespace?.delimiter || '/';
				name = String(name || '').trim();
				if (!name || name.length > 80 || /[\x00-\x1f\x7f*%]/.test(name) || name.includes(delimiter))
					throw Error('@(Enter a folder name without separators or control characters.)');
				// Array paths let ImapFlow apply the server namespace and hierarchy delimiter.
				var result = await c.mailboxCreate(parent ? [parent, name] : [name]);
				if (!result)
					throw Error('@(The server did not confirm the new folder.)');
				var updated = await folders(c, a);
				if (!updated.some((f) => f.path === result.path))
					throw Error('@(The server did not confirm the new folder.)');
				return { folders: updated, path: result.path, created: !!result.created };
			}),
		move: (a, p, target, message, path, specialuse) =>
			withclient(a, p, target, async (c) => {

				var list = await folders(c, a);
				var destination = specialuse ? list.find((f) => f.specialUse === specialuse) : list.find((f) => f.path === path);
				if (!destination)
					throw Error('@(Choose an existing destination folder for this account.)');
				if (destination.path === message.mailboxPath)
					throw Error('@(The message is already in this folder.)');
				// Prevent ImapFlow's COPY/DELETE fallback, which can expunge unrelated deleted mail.
				if (
					!c.capabilities.has('MOVE') &&
					!c.enabled?.has('IMAP4REV2') &&
					!(c.capabilities.has('IMAP4rev2') && !c.capabilities.has('IMAP4rev1'))
				)
					throw Error('@(This server does not support safe message moves.)');
				var lock = await c.getMailboxLock(message.mailboxPath, { readOnly: false }),
					result,
					attempted = false;
				try {
					if (String(c.mailbox.uidValidity) !== message.uidValidity)
						throw Error('@(The mailbox changed. Sync this folder again.)');
					if (c.mailbox.readOnly)
						throw Error('@(This folder is read-only.)');
					var before = await c.fetchOne(message.uid, { uid: true, flags: true }, { uid: true });
					if (!before || before.uid !== message.uid)
						throw Error('@(Message not found.)');
					attempted = true;
					result = await c.messageMove(message.uid, destination.path, { uid: true });
					if (!result || (await c.fetchOne(message.uid, { uid: true }, { uid: true })))
						throw Error('@(The move could not be confirmed. Sync both folders before trying again.)');
				} catch (err) {
					if (attempted)
						throw Error('@(The move could not be confirmed. Sync both folders before trying again.)');
					throw err;
				} finally {
					lock.release();
				}
				var uid = result.uidMap?.get(message.uid),
					moved = null;
				if (Number.isSafeInteger(uid) && uid > 0 && result.uidValidity) {
					lock = null;
					try {
						lock = await c.getMailboxLock(destination.path, { readOnly: true });
						if (String(c.mailbox.uidValidity) !== String(result.uidValidity))
							throw Error('@(The move could not be confirmed. Sync both folders before trying again.)');
						var after = await c.fetchOne(uid, { uid: true, flags: true }, { uid: true });
						if (!after || after.uid !== uid)
							throw Error('@(The move could not be confirmed. Sync both folders before trying again.)');
						moved = {
							...message,
							id: messageid(a.id, destination.path, result.uidValidity, uid),
							uid,
							uidValidity: String(result.uidValidity),
							mailboxPath: destination.path,
							folder: destination.id,
							unread: !after.flags.has('\\Seen'),
							starred: after.flags.has('\\Flagged')
						};
					} catch (err) {
						throw Error('@(The move could not be confirmed. Sync both folders before trying again.)');
					} finally {
						lock?.release();
					}
				}
				return { folders: list, moved, path: destination.path };
			}),

		read: (a, p, target, message) =>
			withclient(a, p, target, async (c) => {

				var mail = await fetchsource(c, message);
				var shown = Html.clean(mail.html, mail.attachments);
				// Images embedded in the HTML are shown there, so they are not listed again as attachments.
				var embedded = (x) =>
					!!shown &&
					x.related === true &&
					!!(x.cid || x.contentId) &&
					String(mail.html).includes('cid:' + String(x.cid || x.contentId).replace(/^<|>$/g, ''));
				return {
					body: (mail.text || '').slice(0, 100000),
					bodyLoaded: true,
					html: shown ? shown.html : '',
					hasHtml: !!shown,
					remoteImages: shown ? shown.remoteImages : 0,
					unsubscribe: unsubscribe(mail),
					invite: invitation(mail),
					attachmentCount: mail.attachments.filter((x) => !embedded(x)).length,
					attachments: mail.attachments
						.map((x, index) => ({
							index,
							name: attachmentname(x.filename, index),
							type: String(x.contentType || '').slice(0, 100),
							size: Number.isSafeInteger(x.size) ? x.size : 0,
							embedded: embedded(x)
						}))
						.filter((x) => !x.embedded)
						.map(({ embedded, ...rest }) => rest),
					messageId: Threading.identifier(mail.messageId),
					references: Threading.references(mail.references),
					inReplyTo: Threading.identifier(mail.inReplyTo),
					replyAddress: mail.replyTo?.value?.[0]?.address || mail.from?.value?.[0]?.address || '',
					toRecipients: (mail.to?.value || []).map((r) => r.address).filter(Boolean),
					ccRecipients: (mail.cc?.value || []).map((r) => r.address).filter(Boolean)
				};
			}),
		// The message exactly as the server holds it, for saving as an .eml file.
		raw: (a, p, target, message) => withclient(a, p, target, (c) => rawsource(c, message)),
		attachment: (a, p, target, message, index) =>
			withclient(a, p, target, async (c) => {

				var mail = await fetchsource(c, message),
					item = Number.isInteger(index) ? mail.attachments[index] : null;
				if (!item || !Buffer.isBuffer(item.content))
					throw Error('@(Attachment not found.)');
				return {
					name: attachmentname(item.filename, index),
					content: item.content
				};
			})
	};
};

exports.messageId = messageid;
exports.maxmessage = maxmessage;
