PLUGIN('mail', function(exports) {
	var mail = {
		search: '',
		language: document.documentElement.lang,
		languageOptions: DEF.languageitems,
		window: '',
		folders: [],
		accounts: [],
		rows: [],
		listState: {
			empty: true,
			message: ''
		},
		reader: {
			empty: true
		},
		accountOptions: [],
		fromOptions: [],
		themeOptions: [],
		theme: 'auto',
		notifyOn: false,
		dropping: false,
		contacts: [],
		// What the window shows besides the lists: titles, counts, buttons that appear or switch off. The views bind to mail.ui.
		ui: {
			busy: false,
			folderTitle: '',
			folderSubtitle: '',
			accountScope: '',
			resultsCount: '',
			totalCount: 0,
			unreadCount: 0,
			filter: 'all',
			unreadOff: false,
			olderShown: false,
			olderCount: '',
			searchShown: false,
			searchLabel: '',
			trashShown: false,
			trashLabel: '',
			moreShown: false,
			moreLabel: '',
			listStatus: TRANSLATE('@(Add your first mail account to get started.)'),
			footerShown: true,
			hasReader: false,
			sendError: '',
			confirmOff: false,
			editSendOff: false,
			userName: '',
			userEmail: '',
			userInitials: '',
			admin: false,
			accountSaved: false,
			threads: true,
			notifications: false,
			announce: '',
			composeTitle: TRANSLATE('@(New message)'),
			draftStatus: TRANSLATE('@(Drafts saved on your server)'),
			draftError: false,
			aliasRow: false,
			ccLink: true,
			bccLink: true,
			locked: false,
			sendOff: false,
			undoShown: false,
			undoText: '',
			undoBusy: false,
			bulkShown: false,
			bulkCount: '',
			bulkAll: false,
			bulkSome: false,
			bulkDrafts: false,
			t: {
				archive: { off: true, label: TRANSLATE('@(Archive message)') },
				star: { off: true, starred: false },
				move: { off: true },
				trash: { off: true, label: TRANSLATE('@(Move to trash)') },
				unread: { off: true, label: TRANSLATE('@(Mark as unread)'), icon: 'ti ti-envelope' },
				print: { off: true },
				source: { off: true }
			}
		}
	};
	exports.set('', mail);
	// Changes some of what mail.ui holds.
	function ui(patch) {
		var next = Object.assign({}, exports.get('ui'), patch);
		// The footer of the list holds the way to load older mail, or what is needed to get started; nothing else.
		next.footerShown = !!(next.olderShown || next.listStatus);
		exports.set('ui', next);
	}
	var compose = {
		to: '',
		subject: '',
		body: '',
		accountId: ''
	};
	var syncfailures = {},
		retryafter = {},
		syncerrors = {};
	var reading = Promise.resolve(),
		networkbusy = false;
	// The one flag for 'a mail operation is running': the buttons that need the network follow it.
	function busy(on) {
		networkbusy = on;
		ui({ busy: on });
	}
	var state = {
		accounts: [],
		messages: [],
		drafts: [],
		folder: 'inbox',
		account: '',
		filter: 'all',
		selected: '',
		loading: true
	};
	var searchhits = null,
		plainview = false,
		imagesfor = new Set();
	// Conversations: messages are grouped by their Message-ID, In-Reply-To and References links.
	function isgrouping() {
		try {
			return localStorage.getItem('totalmail-threads-' + state.user?.id) !== '0';
		} catch {
			return true;
		}
	}
	function threadlabel() {
		ui({ threads: isgrouping() });
	}
	// The conversation of a message as shown to the reader: nothing from the trash unless the message is there too.
	function conversationin(threads, m) {
		return threads.members(m.id).filter((x) => x.folder !== 'trash' || x.folder === m.folder);
	}
	function conversation(m) {
		return conversationin(totalmailthreads(state.messages), m);
	}
	// One entry per line of the list: the newest message of each conversation present in this view.
	function entries(items) {
		if (!isgrouping() || state.folder === 'drafts')
			return items.map((m) => ({ m, members: [m], all: [m] }));
		var threads = totalmailthreads(state.messages),
			seen = new Map(),
			list = [];
		for (var m of items) {
			var key = threads.key(m.id);
			if (key === undefined) {
				list.push({ m, members: [m], all: [m] });
				continue;
			}
			var entry = seen.get(key);
			if (!entry) {
				// The index built above is reused: building it again for every conversation made a long list quadratic.
				entry = { m, members: [], all: conversationin(threads, m) };
				seen.set(key, entry);
				list.push(entry);
			}
			entry.members.push(m);
		}
		return list;
	}
	// The messages an action on the conversation applies to: those of the same folder, so nothing moves by surprise.
	function targets(m) {
		if (!isgrouping() || !m.remote)
			return [m];
		return totalmailthreads(state.messages)
			.members(m.id)
			.filter((x) => x.remote && x.accountId === m.accountId && x.folder === m.folder);
	}
	var draft = null,
		drafttimer,
		saving = Promise.resolve(),
		composeloading = false,
		dirty = false,
		pendingsaves = 0;
	function esc(value) {
		return String(value == null ? '' : value).replace(
			/[&<>"']/g,
			(c) =>
				({
					'&': '&amp;',
					'<': '&lt;',
					'>': '&gt;',
					'"': '&quot;',
					"'": '&#39;'
				})[c]
		);
	}
	function account(id) {
		return state.accounts.find((item) => item.id === id);
	}
	function toast(text) {
		SETTER('notify/info', esc(text));
	}
	function api(schema, data) {
		return totalmailrequest.api(schema, data);
	}
	function visible(filter = state.filter) {
		var query = (mail.search || '').trim().toLocaleLowerCase(),
			parsed = totalmailquery.parse(query);
		var source = state.folder === 'drafts' ? state.drafts : state.messages;
		var matches = source.filter(
			(item) =>
				item.status !== 'sent' &&
				(!state.account || item.accountId === state.account) &&
				(state.folder === 'drafts' || (state.folder === 'starred' ? item.starred : item.folder === state.folder)) &&
				(filter !== 'unread' || item.unread) &&
				(parsed.empty || totalmailquery.matches(parsed, item) || (searchhits?.query === query && searchhits.ids.has(item.id)))
		);
		// Newest first across accounts and loaded pages; drafts keep their saved order.
		return state.folder === 'drafts'
			? matches
			: matches.sort((a, b) => (b.date ? new Date(b.date).getTime() || 0 : 0) - (a.date ? new Date(a.date).getTime() || 0 : 0));
	}
	// Folders in the current view that still have server messages that are not loaded.
	function olderpairs() {
		if (['starred', 'drafts', 'sent-local'].includes(state.folder))
			return [];
		var pairs = [];
		for (var a of state.accounts.filter((a) => a.configured && (!state.account || a.id === state.account))) {
			var path = state.folder === 'inbox' ? 'INBOX' : a.mailboxes?.find((f) => f.id === state.folder)?.path;
			if (path && a.remaining?.[path] > 0)
				pairs.push({ accountId: a.id, path, remaining: a.remaining[path] });
		}
		return pairs;
	}
	function renderolder() {
		var pairs = olderpairs();
		ui({
			olderShown: !!pairs.length,
			olderCount: TRANSLATE('@({0} not loaded yet)').format(pairs.reduce((sum, p) => sum + p.remaining, 0))
		});
	}
	// Server folders in the current view that a text search can run on.
	function serverpairs() {
		if (['starred', 'drafts', 'sent-local'].includes(state.folder))
			return [];
		var pairs = [];
		for (var a of state.accounts.filter(
			(a) => a.configured && ['verified', 'synced'].includes(a.status) && (!state.account || a.id === state.account)
		)) {
			var path = state.folder === 'inbox' ? 'INBOX' : a.mailboxes?.find((f) => f.id === state.folder)?.path;
			if (path)
				pairs.push({ accountId: a.id, path });
		}
		return pairs;
	}
	function renderserversearch() {
		var query = (mail.search || '').trim();
		var show = query.length >= 2 && serverpairs().length > 0 && searchhits?.query !== query.toLocaleLowerCase();
		ui(
			show
				? { searchShown: true, searchLabel: TRANSLATE('@(Search the whole mailbox for “{0}”)').format(query) }
				: { searchShown: false }
		);
	}
	async function searchserver() {
		var query = (mail.search || '').trim(),
			pairs = serverpairs();
		if (query.length < 2 || !pairs.length)
			return;
		if (networkbusy) {
			toast(TRANSLATE('@(Mail synchronization is already running.)'));
			return;
		}
		busy(true);
		renderserversearch();
		try {
			await reading;
			var ids = new Set(),
				found = 0,
				limited = false;
			for (var p of pairs) {
				var result = await api('account_search', { accountId: p.accountId, path: p.path, query });
				for (var id of result.ids)
					ids.add(id);
				found += result.found;
				limited = limited || result.limited;
			}
			await reloadmail();
			searchhits = { query: query.toLocaleLowerCase(), ids };
			renderlist();
			toast(
				!found
					? TRANSLATE('@(Nothing found on the server.)')
					: limited
						? TRANSLATE('@(Found {0} on the server. Only the newest are shown.)').format(found)
						: TRANSLATE('@(Found {0} on the server.)').format(found)
			);
		} catch (e) {
			toast(e.message);
		} finally {
			busy(false);
			renderserversearch();
			renderreader();
		}
	}
	// Permanent deletion asks twice: the first press arms the button for five seconds.
	var armed = { key: '', until: 0 };
	function arm(key) {
		if (armed.key === key && Date.now() < armed.until) {
			armed = { key: '', until: 0 };
			return true;
		}
		armed = { key, until: Date.now() + 5000 };
		return false;
	}
	async function erasemessage(m) {
		if (!arm('erase')) {
			toast(TRANSLATE('@(Press again to delete permanently.)'));
			return;
		}
		var list = targets(m);
		await perform(async () => {
			try {
				for (var t of list)
					await api('message_erase', { id: t.id });
			} finally {
				state.selected = '';
				await reloadmail();
			}
		});
		toast(TRANSLATE('@(Message deleted permanently.)'));
	}
	// Accounts in the current view that have server messages in their trash.
	function trashaccounts() {
		if (state.folder !== 'trash')
			return [];
		return state.accounts.filter(
			(a) =>
				a.configured &&
				(!state.account || a.id === state.account) &&
				state.messages.some((m) => m.remote && m.accountId === a.id && m.folder === 'trash')
		);
	}
	function renderemptytrash() {
		ui({
			trashShown: !!trashaccounts().length,
			trashLabel: TRANSLATE(
				armed.key === 'empty' && Date.now() < armed.until ? '@(Press again to empty the trash)' : '@(Empty the trash)'
			)
		});
	}
	async function emptytrash() {
		var list = trashaccounts();
		if (!list.length)
			return;
		if (!arm('empty')) {
			renderemptytrash();
			setTimeout(renderemptytrash, 5100);
			return;
		}
		await perform(async () => {
			try {
				for (var a of list)
					await api('trash_empty', { accountId: a.id });
			} finally {
				state.selected = '';
				await reloadmail();
			}
		});
		toast(TRANSLATE('@(Trash emptied.)'));
	}
	async function oldermail() {
		var pairs = olderpairs();
		if (!pairs.length)
			return;
		if (networkbusy) {
			toast(TRANSLATE('@(Mail synchronization is already running.)'));
			return;
		}
		busy(true);
		renderolder();
		try {
			await reading;
			for (var p of pairs)
				await api('account_older', { accountId: p.accountId, path: p.path });
			await reloadmail();
		} catch (e) {
			toast(e.message);
		} finally {
			busy(false);
			renderolder();
			renderreader();
		}
	}
	function rendernavigation() {
		var scoped = state.messages.filter((item) => !state.account || item.accountId === state.account);
		var folders = [
			['inbox', 'inbox', TRANSLATE('@(Inbox)'), scoped.filter((m) => m.folder === 'inbox' && m.unread).length],
			['starred', 'star', TRANSLATE('@(Starred)'), scoped.filter((m) => m.starred).length],
			[
				'drafts',
				'file-alt',
				TRANSLATE('@(Drafts)'),
				state.drafts.filter((m) => m.status !== 'sent' && (!state.account || m.accountId === state.account)).length
			],
			['archive', 'archive', TRANSLATE('@(Archive)'), scoped.filter((m) => m.folder === 'archive').length],
			['trash', 'trash', TRANSLATE('@(Trash)'), scoped.filter((m) => m.folder === 'trash').length]
		];
		folders.push(['sent-local', 'envelope', TRANSLATE('@(Sent from TotalMail)'), 0]);
		if (state.account) {
			var a = account(state.account);
			for (var f of a?.mailboxes || [])
				if (!['inbox', 'archive', 'trash'].includes(f.id))
					folders.push([f.id, 'folder', f.name, 0]);
		}
		SET(
			'mail.folders',
			folders.map(([id, icon, label, count]) => ({
				id,
				icon,
				label,
				count,
				active: state.folder === id
			}))
		);
		SET(
			'mail.accounts',
			state.accounts.map((a) => ({
				...a,
				active: state.account === a.id,
				unreadCount: state.messages.filter((m) => m.accountId === a.id && m.folder === 'inbox' && m.unread && !m.welcome).length,
				syncFailed: !!syncfailures[a.id],
				// The reason the server gave, so the warning explains itself on hover.
				syncMessage: TRANSLATE('@(Automatic sync failed. Use Sync to retry.)') + (syncerrors[a.id] ? ' ' + syncerrors[a.id] : '')
			}))
		);
		var names = {
			inbox: TRANSLATE('@(Inbox)'),
			starred: TRANSLATE('@(Starred)'),
			drafts: TRANSLATE('@(Drafts)'),
			archive: TRANSLATE('@(Archive)'),
			trash: TRANSLATE('@(Trash)')
		};
		ui({
			folderTitle:
				names[state.folder] ||
				(state.folder === 'sent-local'
					? TRANSLATE('@(Sent from TotalMail)')
					: (account(state.account)?.mailboxes || []).find((f) => f.id === state.folder)?.name || TRANSLATE('@(Mail)')),
			accountScope: state.account ? account(state.account).name : TRANSLATE('@(All accounts)')
		});
	}
	// A long list is drawn in stretches: the first 150 lines, then more as the end comes near or on request. Everything else
	// (counts, select all, J and K) still sees the whole list.
	var stretch = 150,
		shown = stretch,
		viewkey = '';
	function renderlist() {
		rendernavigation();
		refreshcontacts();
		var items = visible(),
			matching = visible('all'),
			lines = entries(items);
		ui({
			resultsCount: TRANSLATE(
				lines.length === 1
					? '@({0} message)'
					: document.documentElement.lang === 'sk' && lines.length >= 2 && lines.length <= 4
						? '@(mail.messages.few)'
						: '@({0} messages)'
			).format(lines.length),
			totalCount: matching.length,
			unreadCount: matching.filter((m) => m.unread).length,
			filter: state.filter,
			unreadOff: state.folder === 'drafts',
			folderSubtitle:
				state.folder === 'drafts' ? TRANSLATE('@(Messages saved but not sent.)') : TRANSLATE('@(Messages in this folder.)')
		});
		renderolder();
		renderserversearch();
		renderemptytrash();
		var key = [state.folder, state.account, state.filter, mail.search].join('|');
		if (key !== viewkey) {
			viewkey = key;
			shown = stretch;
		}
		// What is open is always drawn, however far down it is.
		var open = lines.findIndex((line) => line.members.some((x) => x.id === state.selected));
		if (open >= shown)
			shown = open + 50;
		ui({
			moreShown: lines.length > shown,
			moreLabel: TRANSLATE('@(Show more)') + ' (' + (lines.length - Math.min(shown, lines.length)) + ')'
		});
		SET(
			'mail.rows',
			lines
				.slice(0, shown)
				.map(({ m, members, all }) => {
					var a = account(m.accountId);
					return {
						...m,
						count: all.length,
						threaded: all.length > 1,
						unread: members.some((x) => x.unread),
						selected: members.some((x) => x.id === state.selected),
						checked: checked.has(m.id),
						displaySender: m.sender || m.to || TRANSLATE('@(No recipient)'),
						displayTime: m.date
							? new Date(m.date).toLocaleDateString(document.documentElement.lang)
							: m.time || TRANSLATE('@(Draft)'),
						displaySubject: m.subject || TRANSLATE('@(No subject)'),
						preview: m.body.replace(/\n/g, ' '),
						accountName: a.name,
						color: a.color
					};
				})
				.map((row) => {
					// What a screen reader says for the line: the state first, then who, what, when and which account.
					row.speak = [
						row.unread ? TRANSLATE('@(Unread)') : '',
						row.starred ? TRANSLATE('@(Starred)') : '',
						row.threaded ? TRANSLATE('@(Messages in this conversation)') + ': ' + row.count : '',
						row.displaySender,
						row.displaySubject,
						row.displayTime,
						row.accountName
					]
						.filter(Boolean)
						.join(', ');
					return row;
				})
		);
		SET('mail.listState', {
			empty: !lines.length,
			setup: !state.accounts.length,
			search: !!(mail.search || '').trim(),
			message: !state.accounts.length
				? TRANSLATE('@(Add your first mail account to get started.)')
				: mail.search
					? TRANSLATE('@(No matches. Try another search.)')
					: TRANSLATE('@(No messages in this view.)')
		});
		renderbulk();
	}
	function filesize(bytes) {
		if (!bytes)
			return '';
		if (bytes < 1024)
			return bytes + ' B';
		if (bytes < 1048576)
			return Math.round(bytes / 1024) + ' KB';
		return (bytes / 1048576).toFixed(1) + ' MB';
	}
	// A calendar invitation as the reader shows it. Times written with a zone are shown as written, with the zone.
	function invitecard(invite) {
		var lang = document.documentElement.lang;
		function show(t, withdate) {
			if (!t)
				return '';
			if (t.allDay)
				return new Date(t.iso + 'T00:00:00').toLocaleDateString(lang, { dateStyle: 'full' });
			if (t.iso.endsWith('Z'))
				return new Date(t.iso).toLocaleString(
					lang,
					withdate === false ? { timeStyle: 'short' } : { dateStyle: 'full', timeStyle: 'short' }
				);
			var day = new Date(t.iso.slice(0, 10) + 'T00:00:00').toLocaleDateString(lang, { dateStyle: 'full' });
			return (withdate === false ? '' : day + ', ') + t.iso.slice(11, 16) + (t.tz && withdate !== false ? ' (' + t.tz + ')' : '');
		}
		var start = show(invite.start),
			end = '';
		if (invite.end && !invite.start?.allDay)
			end = invite.end.iso.slice(0, 10) === invite.start.iso.slice(0, 10) ? show(invite.end, false) : show(invite.end);
		return {
			title: invite.summary || TRANSLATE('@(No subject)'),
			when: start + (end ? ' – ' + end : ''),
			where: invite.location,
			organizer: invite.organizer,
			cancelled: invite.cancelled
		};
	}
	function renderreader() {
		var m = state.messages.find((item) => item.id === state.selected);
		// The buttons of the toolbar: switched off when there is nothing to do with them, labelled for what they do now.
		var off = (command) =>
			!m ||
			(m.outgoing && command !== 'print') ||
			(command !== 'print' && networkbusy) ||
			(['move', 'source'].includes(command) && !m.remote) ||
			(command === 'trash' && m.folder === 'trash' && !m.remote);
		ui({
			t: {
				archive: {
					off: off('archive'),
					label: TRANSLATE(m && ['archive', 'trash'].includes(m.folder) ? '@(Move to inbox)' : '@(Archive message)')
				},
				star: { off: off('star'), starred: !!m?.starred },
				move: { off: off('move') },
				trash: { off: off('trash'), label: TRANSLATE(m?.folder === 'trash' ? '@(Delete permanently)' : '@(Move to trash)') },
				unread: {
					off: off('unread'),
					label: TRANSLATE(m?.unread ? '@(Mark as read)' : '@(Mark as unread)'),
					icon: 'ti ti-' + (m?.unread ? 'envelope-open' : 'envelope')
				},
				print: { off: off('print') },
				source: { off: off('source') }
			}
		});

		if (!m) {
			SET('mail.reader', {
				empty: true,
				noaccounts: !state.accounts.length
			});
			return;
		}
		var a = account(m.accountId);
		var chain = conversation(m);
		SET('mail.reader', {
			...m,
			thread:
				isgrouping() && chain.length > 1
					? chain.map((x) => ({
						id: x.id,
						current: x.id === m.id,
						unread: !!x.unread,
						who: x.outgoing ? TRANSLATE('@(You)') : x.sender || x.email,
						when: x.date ? new Date(x.date).toLocaleDateString(document.documentElement.lang) : '',
						snippet: (x.body || '').replace(/\s+/g, ' ').slice(0, 90)
					}))
					: [],
			unsubscribe: m.unsubscribe || null,
			invite: m.invite ? invitecard(m.invite) : null,
			showHtml: !!m.hasHtml && !plainview,
			viewLabel: TRANSLATE(plainview ? '@(Show formatted)' : '@(Show plain text)'),
			frameSrc: '/html/' + encodeURIComponent(m.id) + '/' + (imagesfor.has(m.id) ? '?images=1' : ''),
			remoteBlocked: !!m.hasHtml && !plainview && m.remoteImages > 0 && !imagesfor.has(m.id),
			empty: false,
			color: a.color,
			accountName: a.name,
			accountEmail: m.outgoing ? m.to : a.email,
			messageKind: m.welcome ? TRANSLATE('@(Message)') : '',
			files: (m.attachments || []).map((f) => ({
				name: f.name,
				size: filesize(f.size),
				href: '/attachment/' + encodeURIComponent(m.id) + '/' + f.index + '/'
			})),
			body: m.remote && !m.bodyLoaded ? TRANSLATE('@(Loading message securely…)') : m.body,
			initials: m.sender
				.split(' ')
				.map((s) => s[0])
				.slice(0, 2)
				.join('')
		});
	}
	async function selectmessage(id) {
		if (state.folder === 'drafts') {
			await opencomposer(state.drafts.find((d) => d.id === id));
			return;
		}
		state.selected = id;
		ui({ hasReader: true });
		renderlist();
		renderreader();
		var m = state.messages.find((m) => m.id === id);
		if (m?.remote && (!m.bodyLoaded || m.hasHtml === undefined || (m.attachmentCount && !m.attachments))) {
			reading = reading
				.catch(() => {})
				.then(async () => {
					if (state.selected !== id)
						return;
					try {
						var body = await api('message_read', {
							id
						});
						Object.assign(m, body);
						if (state.selected === id)
							renderreader();
					} catch (e) {
						if (state.selected === id) {
							m.body = TRANSLATE('@(The message could not be loaded. Select it again to retry.)');
							m.bodyLoaded = false;
							SET('mail.reader.body', m.body);
							toast(e.message);
						}
					}
				});
			await reading;
		}
		if (m && m.unread && state.selected === id && (!m.remote || m.bodyLoaded))
			try {
				var operation = async () => api(m.remote ? 'message_seen' : 'message_change', { id, operation: 'read' });
				reading = reading.catch(() => {}).then(operation);
				var saved = await reading;
				m.unread = saved.unread;
				renderlist();
				renderreader();
			} catch (e) {
				toast(e.message);
			}
	}
	function searchmail() {
		if (searchhits && searchhits.query !== (mail.search || '').trim().toLocaleLowerCase())
			searchhits = null;
		if (state.selected && !visible().some((item) => item.id === state.selected)) {
			state.selected = '';
			renderreader();
			ui({ hasReader: false });
		}
		renderlist();
	}
	function draftstatus(text, error) {
		ui({ draftStatus: text, draftError: !!error });
	}
	function savedraft() {
		clearTimeout(drafttimer);
		if (!draft || !dirty)
			return saving;
		var current = draft;
		var data = {
			id: current.id,
			accountId: GET('mail.compose.accountId'),
			from: GET('mail.compose.from') || '',
			to: GET('mail.compose.to'),
			cc: GET('mail.compose.cc'),
			bcc: GET('mail.compose.bcc'),
			subject: GET('mail.compose.subject'),
			body: GET('mail.compose.body'),
			replyTo: current.replyTo || ''
		};
		dirty = false;
		pendingsaves++;
		draftstatus(TRANSLATE('@(Saving…)'));
		saving = saving
			.catch(() => {})
			.then(async () => {
				try {
					if (!data.id)
						data.id = current.id;
					var saved = await api('draft_save', data);
					Object.assign(current, saved);
					var i = state.drafts.findIndex((d) => d.id === saved.id);
					if (i < 0)
						state.drafts.unshift(saved);
					else
						state.drafts[i] = saved;
					renderlist();
					draftstatus(dirty ? TRANSLATE('@(Unsaved changes…)') : TRANSLATE('@(Saved on your server)'));
					return saved;
				} catch (e) {
					dirty = true;
					draftstatus(TRANSLATE('@(Not saved. Try again before closing.)'), true);
					throw e;
				} finally {
					pendingsaves--;
				}
			});
		return saving;
	}
	function changeddraft() {
		if (composeloading || !draft)
			return;
		dirty = true;
		draftstatus(TRANSLATE('@(Unsaved changes…)'));
		clearTimeout(drafttimer);
		drafttimer = setTimeout(() => savedraft().catch((e) => toast(e.message)), 650);
	}
	function draftfiles(source) {
		return (source?.attachments || []).map((f) => ({ id: f.id, name: f.name, size: filesize(f.size) }));
	}
	function draftchanged(saved) {
		Object.assign(draft, saved);
		var i = state.drafts.findIndex((d) => d.id === saved.id);
		if (i < 0)
			state.drafts.unshift(saved);
		else
			state.drafts[i] = saved;
		SET('mail.compose.files', draftfiles(draft));
		renderlist();
	}
	async function attachfiles(list) {
		if (!draft || ['sending', 'sent', 'unknown'].includes(draft.status))
			return;
		dirty = true;
		await savedraft();
		await saving;
		if (!draft?.id)
			return;
		for (var file of list) {
			if (!file.size || file.size > 15 * 1024 * 1024) {
				toast(TRANSLATE('@(Attachments can add up to 15 MB per message.)'));
				continue;
			}
			var body = new FormData();
			body.append('file', file, file.name);
			try {
				draftchanged(await totalmailrequest.upload('/upload/' + encodeURIComponent(draft.id) + '/', body));
			} catch (e) {
				toast(e.message);
			}
		}
		refreshsendbutton();
	}
	async function removeattachment(id) {
		if (!draft?.id)
			return;
		try {
			draftchanged(await api('draft_attachment_remove', { id: draft.id, attachmentId: id }));
		} catch (e) {
			toast(e.message);
		}
	}
	// The signature of an account, as it is added below a new message.
	function signature(accountid) {
		var text = account(accountid)?.signature;
		return text ? '\n\n-- \n' + text : '';
	}
	// Undo after moving mail out of the inbox. A server message gets a new id when it moves, so it is found again by its Message-ID.
	var undoitems = [],
		undotimer = null;
	function hideundo() {
		clearTimeout(undotimer);
		undoitems = [];
		ui({ undoShown: false });
	}
	function offerundo(items, text) {
		if (!items.length)
			return false;
		undoitems = items;
		ui({ undoText: text, undoShown: true });
		clearTimeout(undotimer);
		undotimer = setTimeout(hideundo, 9000);
		return true;
	}
	var undobusy = false;
	async function undomove() {
		var items = undoitems;
		if (!items.length || undobusy)
			return;
		// The bar stays up, saying what is happening, until the messages are back.
		undobusy = true;
		clearTimeout(undotimer);
		ui({ undoText: TRANSLATE('@(Putting it back…)'), undoBusy: true });
		try {
			await perform(async () => {
				try {
					for (var item of items) {
						var found = state.messages.find(
							(x) =>
								x.accountId === item.accountid &&
								x.folder === item.folder &&
								(item.messageid ? x.messageId === item.messageid : x.id === item.id)
						);
						if (found)
							await api('message_change', { id: found.id, operation: 'restore', enabled: false });
					}
				} finally {
					await reloadmail();
				}
			});
			toast(TRANSLATE('@(Moved back to the inbox.)'));
		} finally {
			undobusy = false;
			ui({ undoBusy: false });
			hideundo();
		}
	}
	exports.undo = () => undomove().catch((e) => toast(e.message));
	function undoentry(t, folder) {
		return { id: t.id, accountid: t.accountId, messageid: t.messageId || '', folder };
	}
	// Several messages at once: a real checkbox on every line (Shift for a range, Ctrl/⌘ to add one), and a bar with the
	// actions that make sense in bulk. The same operations as the single-message buttons, applied to every selected line.
	var checked = new Set(),
		anchor = '';
	function lineids() {
		return entries(visible()).map((line) => line.m.id);
	}
	function renderbulk() {
		var ids = lineids();
		for (var id of checked)
			if (!ids.includes(id))
				checked.delete(id);
		ui({
			bulkShown: checked.size > 0,
			bulkCount: TRANSLATE('@({count} selected)').replace('{count}', () => checked.size),
			bulkAll: ids.length > 0 && checked.size === ids.length,
			bulkSome: checked.size > 0 && checked.size < ids.length,
			// Drafts can only be thrown away; the other actions belong to received mail.
			bulkDrafts: state.folder === 'drafts'
		});
	}
	function togglecheck(id, range, refocus) {
		var ids = lineids();
		if (range && anchor && ids.includes(anchor) && ids.includes(id)) {
			var a = ids.indexOf(anchor),
				b = ids.indexOf(id);
			for (var i = Math.min(a, b); i <= Math.max(a, b); i++)
				checked.add(ids[i]);
		} else if (checked.has(id))
			checked.delete(id);
		else
			checked.add(id);
		anchor = id;
		renderlist();
		if (refocus)
			SETTER('page/focus', '.row-check[data-row="' + id + '"]');
	}
	function clearchecked() {
		if (!checked.size)
			return false;
		checked.clear();
		renderlist();
		return true;
	}
	async function discarddrafts(ids) {
		if (!arm('discard-drafts')) {
			toast(TRANSLATE('@(Press again to discard the selected drafts.)'));
			return;
		}
		var done = 0,
			left = 0;
		for (var id of ids)
			try {
				await api('draft_delete', { id });
				state.drafts = state.drafts.filter((d) => d.id !== id);
				checked.delete(id);
				done++;
			} catch {
				left++;
			}
		renderlist();
		toast(
			TRANSLATE(left ? '@({done} done, {left} could not be changed.)' : '@({done} done.)')
				.replace('{done}', () => done)
				.replace('{left}', () => left)
		);
	}
	async function bulk(op) {
		if (op === 'clear')
			return clearchecked();
		var lines = entries(visible()).filter((line) => checked.has(line.m.id));
		if (!lines.length)
			return;
		if (state.folder === 'drafts')
			return op === 'trash' ? discarddrafts(lines.map((line) => line.m.id)) : undefined;
		var list = [],
			seen = new Set();
		for (var line of lines)
			for (var t of op === 'star' ? [line.m] : targets(line.m))
				if (!seen.has(t.id)) {
					seen.add(t.id);
					list.push(t);
				}
		var erasing = op === 'trash' && state.folder === 'trash';
		if (erasing && !arm('erase-bulk')) {
			toast(TRANSLATE('@(Press again to delete permanently.)'));
			return;
		}
		var star = op === 'star' ? !list.every((t) => t.starred) : false,
			done = 0,
			left = 0,
			moved = [];
		await perform(async () => {
			try {
				for (var t of list) {
					var operation = op === 'archive' ? (['archive', 'trash'].includes(t.folder) ? 'restore' : 'archive') : op;
					if ((op === 'read' && !t.unread) || (op === 'unread' && t.unread))
						continue;
					// Without an Archive or Trash folder on the server there is nothing to move to: the single button asks which folder.
					if (
						!erasing &&
						t.remote &&
						['archive', 'trash'].includes(operation) &&
						!account(t.accountId).mailboxes?.some((f) => f.specialUse === (operation === 'archive' ? '\\Archive' : '\\Trash'))
					) {
						left++;
						continue;
					}
					try {
						await api(
							erasing ? 'message_erase' : 'message_change',
							erasing ? { id: t.id } : { id: t.id, operation, enabled: star }
						);
						done++;
						if (!erasing && ['archive', 'trash'].includes(operation) && t.folder === 'inbox')
							moved.push(undoentry(t, operation));
					} catch {
						left++;
					}
				}
			} finally {
				// Starring and marking keep the selection (more can follow); moving or deleting empties it.
				if (['archive', 'trash'].includes(op)) {
					checked.clear();
					state.selected = '';
				}
				await reloadmail();
			}
		});
		var text = TRANSLATE(left ? '@({done} done, {left} could not be changed.)' : '@({done} done.)')
			.replace('{done}', () => done)
			.replace('{left}', () => left);
		// What came out of the inbox can be put back.
		if (!offerundo(moved, text))
			toast(text);
	}
	function showmore() {
		shown += stretch;
		renderlist();
	}
	exports.showmore = showmore;
	// The list asks for more when its end comes near (the scrollend component).
	exports.scrolled = () => GET('mail.ui').moreShown && showmore();
	// The checkbox of a line (Shift for a range), the one that selects all, and the buttons of the bar.
	exports.check = (element, event) => togglecheck(element[0].dataset.row, !!event?.shiftKey, true);
	exports.bulkall = (element) => {
		if (element[0].checked)
			for (var id of lineids())
				checked.add(id);
		else
			checked.clear();
		renderlist();
	};
	exports.bulk = (element) => bulk(element[0].dataset.bulk).catch((e) => toast(e.message));
	// The select-all box is a tri-state: it has no attribute for 'some', only a property, so the binding calls this.
	exports.bulkstate = (value, path, element) => {
		var box = element.find('input')[0];
		if (box) {
			box.checked = !!value?.bulkAll;
			box.indeterminate = !!value?.bulkSome;
		}
	};
	// Keyboard: move through the list, act on the open message or, when some are selected, on all of them.
	async function movecurrent(delta) {
		var lines = entries(visible());
		if (!lines.length)
			return;
		var i = lines.findIndex((line) => line.members.some((x) => x.id === state.selected));
		var next = lines[Math.min(lines.length - 1, Math.max(0, i < 0 ? 0 : i + delta))];
		await selectmessage(next.m.id);
		SETTER('page/reveal', '.message-row.selected');
	}
	function shortcut(event) {
		var key = event.key,
			bulkable = { e: 'archive', '#': 'trash', Delete: 'trash', s: 'star', u: 'unread' };
		if (key === '?')
			SET('mail.window', 'shortcuts');
		else if (key === 'n' || key === 'c')
			command('compose');
		else if (key === '/')
			SETTER('page/focus', '.ui-searchinput input');
		else if (key === 'j' || key === 'k')
			movecurrent(key === 'j' ? 1 : -1);
		else if (key === 'z' && undoitems.length)
			undomove();
		else if (key === 'Escape') {
			if (!clearchecked())
				return false;
		} else if (key === 'x') {
			var line = entries(visible()).find((l) => l.members.some((x) => x.id === state.selected));
			if (line)
				togglecheck(line.m.id, false);
		} else if (bulkable[key] && checked.size)
			bulk(bulkable[key]);
		else if (['r', 'a', 'f'].includes(key) && state.selected)
			command(key === 'r' ? 'reply' : key === 'a' ? 'reply-all' : 'forward');
		else if (bulkable[key] && state.selected)
			command(bulkable[key] === 'trash' ? 'trash' : bulkable[key]);
		else
			return false;
		return true;
	}
	// Files dropped on the window or pasted from the clipboard (a screenshot, say) are attached like the button's files.
	function stamp(file) {
		if (file.name && !/^image\.(png|jpe?g|gif|webp)$/i.test(file.name))
			return file;
		var now = new Date(),
			pad = (n) => String(n).padStart(2, '0'),
			extension = (file.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
		var name =
			'image-' +
			now.getFullYear() +
			pad(now.getMonth() + 1) +
			pad(now.getDate()) +
			'-' +
			pad(now.getHours()) +
			pad(now.getMinutes()) +
			pad(now.getSeconds()) +
			'.' +
			extension;
		return new File([file], name, { type: file.type });
	}
	// Files dropped on the window (the dropfiles component): on the composer they are attached, on the mailbox they start a new message.
	exports.dropped = async (files) => {
		var list = files.map(stamp);
		if (!list.length || (mail.window && mail.window !== 'composer'))
			return;
		try {
			if (!mail.window)
				await command('compose');
			await attachfiles(list);
		} catch (e) {
			toast(e.message);
		}
	};
	// Files pasted into the message (the mailbody component).
	exports.pasted = (files) => attachfiles(files.map(stamp)).catch((e) => toast(e.message));
	// Address suggestions while typing in To, Cc and Bcc, from the mail already loaded. Nothing leaves the browser.
	var contactcache = { size: -1, list: [] };
	// The addresses of the mail already loaded and of the accounts: the list the suggestions draw from (mail.contacts).
	function refreshcontacts() {
		if (contactcache.size === state.messages.length)
			return;
		contactcache = {
			size: state.messages.length,
			list: totalmailcontacts(
				state.messages,
				state.accounts.flatMap((a) => [a.email, ...(a.aliases || [])])
			)
		};
		SET('mail.contacts', contactcache.list);
	}
	// Cc and Bcc stay out of the way until they are asked for or the message already has them.
	// The input component of a path, to give it the focus.
	function focusfield(path) {
		FIND('input', true)
			.find((c) => c.path?.path === path)
			?.autofocus();
	}
	// The window measures itself when it opens, before the assistant's box or a row of the form has appeared: it measures again,
	// and a window that is still taller than the screen moves up until its buttons are in view.
	function fitwindow(delay = 60) {
		var fit = () => {
			SETTER('modal', 'resize');
			setTimeout(() => {
				var element = document.querySelector('.ui-modal.composer');
				if (!element || GET('mail.window') !== 'composer')
					return;
				var box = element.getBoundingClientRect();
				if (box.bottom > innerHeight - 8)
					element.style.top = Math.max(8, innerHeight - box.height - 8) + 'px';
			}, 40);
		};
		// The window also measures itself once more when its opening animation ends (the first time it takes longer).
		for (var later of [0, 800, 1800])
			setTimeout(fit, delay + later);
	}
	exports.fitwindow = fitwindow;
	function revealextra(field, focus) {
		ui(field === 'cc' ? { ccLink: false } : { bccLink: false });
		fitwindow();
		if (focus)
			focusfield('mail.compose.' + field);
	}
	function resetextras(values) {
		ui({ ccLink: true, bccLink: true });
		for (var field of ['cc', 'bcc'])
			if (values[field])
				revealextra(field, false);
	}
	// The addresses an account can send from: its own and its aliases. The row to choose appears only when there are aliases.
	function fillfrom(accountid, chosen) {
		var a = account(accountid),
			list = a ? [a.email, ...(a.aliases || [])] : [];
		SET(
			'mail.fromOptions',
			list.map((address) => ({ id: address, name: address }))
		);
		ui({ aliasRow: list.length >= 2 });
		SET('mail.compose.from', list.includes(chosen) ? chosen : list[0] || '');
	}
	// A reply goes out from the alias the person wrote to, unless the main address was a recipient too.
	function replyfrom(message) {
		var a = account(message.accountId),
			wanted = [...(message.toRecipients || []), ...(message.ccRecipients || [])].map((x) => String(x).toLowerCase());
		if (!a || wanted.includes(a.email.toLowerCase()))
			return '';
		return (a.aliases || []).find((x) => wanted.includes(x)) || '';
	}
	// The labels of the quoted header, in the person's language.
	function quotetext() {
		return {
			wrote: (date, who) =>
				TRANSLATE('@(On {date}, {sender} wrote:)')
					.replace('{date}', () => date)
					.replace('{sender}', () => who),
			forwarded: TRANSLATE('@(Forwarded message)'),
			from: TRANSLATE('@(From)'),
			date: TRANSLATE('@(Date)'),
			subject: TRANSLATE('@(Subject)'),
			to: TRANSLATE('@(To)'),
			format: (value) => (value ? new Date(value).toLocaleString(document.documentElement.lang) : '')
		};
	}
	// A forward carries the original's attachments: the server copies them into the saved draft.
	async function forwardfiles(id) {
		dirty = true;
		await savedraft();
		await saving;
		if (!draft?.id)
			return;
		try {
			var { skippedFiles: skippedfiles, ...next } = await api('draft_forward_files', { id: draft.id, messageId: id });
			draftchanged(next);
			if (skippedfiles)
				toast(TRANSLATE('@(Some attachments were too large or too many to forward.)'));
		} catch (e) {
			toast(e.message);
		}
	}
	async function opencomposer(existing, reply, all, forward) {
		if (draft)
			try {
				await savedraft();
			} catch (e) {
				toast(e.message);
				return;
			}

		signedfor = null;
		var started =
			reply && !existing ? totalmailquote(forward ? 'forward' : 'reply', reply, signature(reply.accountId), quotetext()) : null;
		draft = existing
			? {
				...existing
			}
			: {
				id: '',
				accountId: reply ? reply.accountId : state.account || state.accounts[0].id,
				from: reply && !forward ? replyfrom(reply) : '',
				to: reply && !forward ? reply.replyAddress || reply.email : '',
				cc: '',
				bcc: '',
				subject: started ? started.subject : '',
				body: started ? started.body : signature(state.account || state.accounts[0].id),
				replyTo: reply && !forward ? reply.id : ''
			};
		if (all && reply && !existing) {
			var mine = account(reply.accountId),
				used = new Set([mine?.email.toLowerCase(), ...(mine?.aliases || [])]);
			function recipients(values) {
				return values
					.filter((value) => {
						if (!value || used.has(value.toLowerCase()))
							return false;
						used.add(value.toLowerCase());
						return true;
					})
					.join(', ');
			}
			draft.to = recipients([reply.replyAddress || reply.email, ...(reply.toRecipients || [])]);
			draft.cc = recipients(reply.ccRecipients || []);
		}
		composeloading = true;
		SET('mail.compose', {
			files: draftfiles(draft),
			to: draft.to,
			cc: draft.cc || '',
			bcc: draft.bcc || '',
			subject: draft.subject,
			body: draft.body,
			accountId: draft.accountId
		});
		fillfrom(draft.accountId, draft.from);
		resetextras(draft);
		ui({
			composeTitle:
				forward && !existing
					? TRANSLATE('@(Forward)')
					: reply || draft.replyTo
						? TRANSLATE('@(Your reply)')
						: TRANSLATE('@(New message)')
		});
		draftstatus(existing ? TRANSLATE('@(Saved on your server)') : TRANSLATE('@(Drafts saved on your server)'));
		dirty = false;
		composeloading = false;
		SET('mail.window', 'composer');
		refreshsendbutton();
		// The assistant's box and the Cc and Bcc rows appear a moment later.
		fitwindow(250);
		// A reply starts in the message, a new message in the recipient field.
		if (!existing)
			setTimeout(() => (reply && !forward ? SETTER('mailbody/focus', 0) : focusfield('mail.compose.to')), 150);
		if (forward && !existing)
			forwardfiles(reply.id);
	}
	async function closecomposer() {
		try {
			await savedraft();
			await saving;
			SET('mail.window', '');
			draft = null;
			dirty = false;
		} catch (e) {
			toast(e.message);
		}
	}
	// The draft in the composer is thrown away: its saved copy, its attachments and the window.
	async function discardcompose() {
		if (!draft)
			return;
		if (!arm('discard-compose')) {
			toast(TRANSLATE('@(Press again to discard this draft.)'));
			return;
		}
		clearTimeout(drafttimer);
		dirty = false;
		await saving.catch(() => {});
		var id = draft.id;
		if (id && state.drafts.some((d) => d.id === id)) {
			await api('draft_delete', { id });
			state.drafts = state.drafts.filter((d) => d.id !== id);
		}
		SET('mail.window', '');
		draft = null;
		renderlist();
		toast(TRANSLATE('@(Draft discarded.)'));
	}
	async function command(name) {
		if (state.loading)
			return;
		var m = state.messages.find((m) => m.id === state.selected);
		if (name === 'compose') {
			if (!state.accounts.length) {
				await PLUGINS.accounts.open();
				return;
			}
			await opencomposer();
		} else if (name === 'show-cc' || name === 'show-bcc')
			revealextra(name === 'show-cc' ? 'cc' : 'bcc', true);
		else if (name === 'attach')
			SETTER('filepicker/open', { multiple: true, callback: (files) => attachfiles(files).catch((e) => toast(e.message)) });
		else if (name === 'older')
			await oldermail();
		else if (name === 'server-search')
			await searchserver();
		else if (name === 'settings')
			SET('mail.window', 'settings');
		else if (name === 'account-setup')
			await PLUGINS.accounts.open();
		else if (name === 'users')
			await PLUGINS.users.open();
		else if (name === 'providers')
			await PLUGINS.providers.open();
		else if (name === 'ai')
			await PLUGINS.ai.open();
		else if (name === 'discover-account')
			await PLUGINS.accounts.discover();
		else if (name === 'save-account')
			await PLUGINS.accounts.save();
		else if (name === 'create-user')
			await PLUGINS.users.create();
		else if (name === 'close-settings') {
			SET('mail.window', '');
			SET('accounts.form.password', '');
			SET('users.form.password', '');
		} else if (name === 'logout') {
			if (draft) {
				await savedraft();
				await saving;
			}
			await api('user_logout');
			location.reload();
		} else if (name === 'sync')
			await syncmail(undefined, currentpath());
		else if (name === 'verify-account')
			await verifyaccount();
		else if (name === 'sync-account')
			await syncmail(GET('accounts.form.id'));
		else if (name === 'preview-send')
			await previewsend();
		else if (name === 'edit-send') {
			if (sendbusy)
				return;
			refreshsendbutton();
			SET('mail.window', 'composer');
		} else if (name === 'confirm-send')
			await confirmsend();
		else if (name === 'reply-all' && m && !m.welcome)
			await opencomposer(null, m, true);
		else if (name === 'reply' && m && !m.welcome)
			await opencomposer(null, m);
		else if (name === 'forward' && m && !m.welcome)
			await opencomposer(null, m, false, true);
		else if (name === 'close-compose')
			await closecomposer();
		else if (name === 'discard-compose')
			await discardcompose();
		else if (name === 'save-compose') {
			if (!dirty && draft && !draft.id)
				dirty = true;
			await savedraft();
			await saving;
			toast(TRANSLATE('@(Draft saved on your server.)'));
		} else if (name === 'print' && m)
			window.open(
				'/print/' +
					encodeURIComponent(m.id) +
					'/?images=' +
					(imagesfor.has(m.id) ? '1' : '0') +
					'&lang=' +
					encodeURIComponent(document.documentElement.lang),
				'_blank',
				'noopener'
			);
		else if (name === 'source' && m?.remote)
			SETTER('page/download', '/source/' + encodeURIComponent(m.id) + '/');
		else if (name === 'unsubscribe-mail' && m?.unsubscribe?.mail) {
			await opencomposer();
			SET('mail.compose.accountId', m.accountId);
			SET('mail.compose.to', m.unsubscribe.mail);
			SET('mail.compose.subject', m.unsubscribe.subject || 'unsubscribe');
			SET('mail.compose.body', '');
		} else if (name === 'close-shortcuts')
			SET('mail.window', '');
		else if (name === 'shortcuts')
			SET('mail.window', 'shortcuts');
		else if (name === 'back')
			ui({ hasReader: false });
		else if (name === 'next') {
			var lines = entries(visible());
			var i = lines.findIndex((line) => line.members.some((item) => item.id === state.selected));
			if (lines.length)
				await selectmessage(lines[(i + 1) % lines.length].m.id);
		} else if (name === 'move' && m?.remote)
			PLUGINS.folders.move(m.id);
		else if (name === 'trash' && m?.remote && m.folder === 'trash')
			await erasemessage(m);
		else if (name === 'empty-trash')
			await emptytrash();
		else if (['star', 'archive', 'trash', 'unread'].includes(name) && m) {
			var operation =
				name === 'archive' && ['archive', 'trash'].includes(m.folder)
					? 'restore'
					: name === 'unread'
						? m.unread
							? 'read'
							: 'unread'
						: name;
			if (
				m.remote &&
				['archive', 'trash'].includes(operation) &&
				!account(m.accountId).mailboxes?.some((f) => f.specialUse === (operation === 'archive' ? '\\Archive' : '\\Trash'))
			) {
				PLUGINS.folders.move(m.id);
				return;
			}
			var list = name === 'star' ? [m] : targets(m),
				origin = m.folder;
			await perform(async () => {
				try {
					for (var t of list)
						await api('message_change', { id: t.id, operation, enabled: !t.starred });
				} finally {
					// Even when one of them fails the screen shows what the server really holds.
					if (['archive', 'restore', 'trash', 'unread'].includes(operation))
						state.selected = '';
					await reloadmail();
				}
			});
			if (['archive', 'restore', 'trash'].includes(operation)) {
				var destination = operation === 'archive' ? 'archive' : 'trash';
				if (
					!(
						origin === 'inbox' &&
						operation !== 'restore' &&
						offerundo(
							list.map((t) => undoentry(t, destination)),
							TRANSLATE(operation === 'archive' ? '@(Archived.)' : '@(Moved to the trash.)')
						)
					)
				)
					toast(TRANSLATE('@(Message moved.)'));
				var next = entries(visible())[0]?.m;
				if (next)
					await selectmessage(next.id);
			}
		}
	}
	async function mailclick(element, event) {
		var el = element[0];
		if (el.disabled)
			return;
		try {
			if (el.dataset.command)
				await command(el.dataset.command);
			else if (el.dataset.folder) {
				state.folder = el.dataset.folder;
				state.selected = '';
				state.filter = 'all';
				renderlist();
				renderreader();
				ui({ hasReader: false });
				var f = account(state.account)?.mailboxes?.find((f) => f.id === state.folder);
				if (f)
					await syncmail(state.account, f.path);
			} else if (el.dataset.account) {
				state.account = state.account === el.dataset.account ? '' : el.dataset.account;
				if (!['inbox', 'archive', 'trash', 'starred', 'drafts', 'sent-local'].includes(state.folder))
					state.folder = 'inbox';
				state.selected = '';
				renderlist();
				renderreader();
				ui({ hasReader: false });
			} else if (el.dataset.filter) {
				state.filter = el.dataset.filter;
				renderlist();
			} else if (el.dataset.attachment)
				await removeattachment(el.dataset.attachment);
			else if (el.dataset.message)
				if (event && (event.metaKey || event.ctrlKey || event.shiftKey))
					// Ctrl, ⌘ or Shift add the line to the selection instead of opening it.
					togglecheck(el.dataset.message, event.shiftKey);
				else
					await selectmessage(el.dataset.message);
		} catch (e) {
			toast(e.message);
		}
	}
	// The account the open message was last signed for, so changing it twice still compares with what is on screen.
	var signedfor = null;
	WATCH('mail.compose.accountId', (next) => {
		var body = GET('mail.compose.body'),
			previous = signedfor || draft?.accountId;
		signedfor = next;
		// Another account has its own addresses; the first one is the account's own.
		if (draft && next && previous && next !== previous)
			fillfrom(next, '');
		// An untouched message keeps the signature of the account it is sent from.
		if (draft && next && previous && next !== previous && (!(body || '').trim() || body === signature(previous)))
			SET('mail.compose.body', signature(next));
		refreshsendbutton();
	});
	// Whether leaving the page would lose something (the beforeleave component asks).
	exports.pending = () => dirty || pendingsaves > 0;
	// Every key of the page (the keys component): shortcuts while no window is open, Escape while one is.
	exports.keys = function(event) {
		if (mail.window) {
			if (event.key !== 'Escape')
				return;
			event.preventDefault();
			if (mail.window === 'send-confirm') {
				if (!sendbusy)
					SET('mail.window', 'composer');
				return;
			}
			if (mail.window === 'composer')
				closecomposer();
			else {
				SET('mail.window', '');
				SET('accounts.form.password', '');
				SET('users.form.password', '');
			}
			return;
		}
		if (
			event.ctrlKey ||
			event.metaKey ||
			event.altKey ||
			(/INPUT|TEXTAREA|SELECT/.test(event.target.tagName) && !event.target.matches('.row-check, .bulk-bar input')) ||
			event.target.isContentEditable
		)
			return;
		if (shortcut(event))
			event.preventDefault();
	};
	WAIT(
		function() {
			return PLUGINS.accounts?.refresh && PLUGINS.users?.open;
		},
		async function() {
			WATCH('mail.language', async (language) => {
				if (!language || language === document.documentElement.lang)
					return;
				try {
					if (draft) {
						await savedraft();
						await saving;
					}
					var url = new URL(location.href);
					url.searchParams.set('lang', language);
					location.assign(url.href);
				} catch (e) {
					SET('mail.language', document.documentElement.lang);
					toast(e.message);
				}
			});
			WATCH('mail.compose.accountId', changeddraft);
			WATCH('mail.compose.from', changeddraft);
			WATCH('mail.compose.to', changeddraft);
			WATCH('mail.compose.cc', changeddraft);
			WATCH('mail.compose.bcc', changeddraft);
			WATCH('mail.compose.subject', changeddraft);
			WATCH('mail.compose.body', changeddraft);
			try {
				var data = await api('bootstrap');
				Object.assign(state, data);
				state.loading = false;
				ui({
					userName: state.user.name,
					userEmail: state.user.email,
					userInitials: state.user.name
						.split(/\s+/)
						.map((x) => x[0])
						.slice(0, 2)
						.join('')
						.toUpperCase(),
					admin: state.user.role === 'admin'
				});
				updatesyncstatus();
				PLUGINS.accounts.refresh();
				renderlist();
				// Nothing is opened (and nothing marked as read) until the person chooses a message.
				threadlabel();
				notifylabel();
				SET('mail.themeOptions', [
					{ id: 'auto', name: TRANSLATE('@(Match the system)') },
					{ id: 'light', name: TRANSLATE('@(Light)') },
					{ id: 'dark', name: TRANSLATE('@(Dark)') }
				]);
				try {
					SET('mail.theme', localStorage.getItem('totalmail-theme') || 'auto');
				} catch {
					SET('mail.theme', 'auto');
				}
				WATCH('mail.theme', (value) => {
					if (!value)
						return;
					try {
						value === 'auto' ? localStorage.removeItem('totalmail-theme') : localStorage.setItem('totalmail-theme', value);
					} catch {}
					window.totalmailtheme && window.totalmailtheme();
				});
				if (notificationsenabled())
					startnotifications();
				renderreader();
				var signin = new URLSearchParams(location.search).get('oauth');
				if (signin) {
					history.replaceState(null, '', location.pathname);
					var messages = {
						ok: TRANSLATE('@(Account saved. Verify the connection to start reading.)'),
						denied: TRANSLATE('@(The sign-in was cancelled.)'),
						approved: TRANSLATE('@(Administrator approval recorded. Sign in with Microsoft again.)'),
						exists: TRANSLATE('@(This mail account already exists.)'),
						mismatch: TRANSLATE('@(That account does not match the email address of this account.)')
					};
					toast(messages[signin] || TRANSLATE('@(The sign-in could not be completed. Try again.)'));
				}
			} catch (e) {
				SET('mail.listState', {
					empty: true,
					message: TRANSLATE('@(Mail could not be loaded. Reload to try again.)')
				});
				toast(e.message);
			}
		}
	);
	var sendbusy = false;
	mail.sendPreview = {
		from: '',
		to: '',
		subject: '',
		body: ''
	};
	function refreshsendbutton() {
		var selected = GET('mail.compose.accountId') || draft?.accountId;
		var a = account(selected);
		var locked = ['sending', 'sent', 'unknown'].includes(draft?.status);
		ui({ sendOff: !a?.configured || locked, locked });
		SETTER('#compose-account', 'reconfigure', { disabled: locked });
		SETTER('#compose-alias', 'reconfigure', { disabled: locked });
	}
	function updatesyncstatus() {
		ui({
			listStatus: state.accounts.some((a) => a.status === 'synced')
				? ''
				: TRANSLATE(
					state.accounts.some((a) => a.configured)
						? '@(Save credentials, then verify and sync)'
						: '@(Add your first mail account to get started.)'
				)
		});
	}
	// System notifications (Total.js j-NativeNotifications), only when the person turned them on in this browser.
	function notificationsenabled() {
		try {
			return localStorage.getItem('totalmail-notify-' + state.user?.id) === '1' && window.Notification?.permission === 'granted';
		} catch {
			return false;
		}
	}
	function notifylabel() {
		var denied = window.Notification?.permission === 'denied';
		ui({ notifications: notificationsenabled() });
		SET(
			'mail.notifyHint',
			TRANSLATE(
				!window.Notification
					? '@(This browser does not support notifications.)'
					: denied
						? '@(Blocked in the browser. Allow notifications for this site to turn them on.)'
						: '@(A system notice when new mail arrives while this window is not in front.)'
			)
		);
	}
	function startnotifications() {
		// The component asks for the permission when it is created, so it is created from the person's click.
		SET('mail.notifyOn', true);
	}
	function unreadinbox() {
		return new Set(state.messages.filter((m) => m.folder === 'inbox' && m.unread && !m.welcome).map((m) => m.id));
	}
	// Mail that arrived since the previous load is announced when the window is not in front of the person.
	// A screen reader hears new mail in a polite status line, with or without system notifications.
	function say(text) {
		ui({ announce: '' });
		setTimeout(() => ui({ announce: text }), 50);
	}
	function announce(before) {
		var fresh = state.messages.filter((m) => m.folder === 'inbox' && m.unread && !m.welcome && !before.has(m.id));
		if (!fresh.length)
			return;
		var first = fresh[0],
			text =
				fresh.length === 1
					? (first.sender || first.email || '') + (first.subject ? ' · ' + first.subject : '')
					: TRANSLATE('@(New messages)') + ': ' + fresh.length;
		say((fresh.length === 1 ? TRANSLATE('@(New message)') + ': ' : '') + text);
		if (!notificationsenabled() || (!document.hidden && document.hasFocus()))
			return;
		SETTER('nativenotifications/show', fresh.length === 1 ? TRANSLATE('@(New message)') : TRANSLATE('@(New mail)'), text, () => {
			if (fresh.length === 1)
				selectmessage(first.id);
		});
	}
	async function reloadmail() {
		var selected = state.selected,
			before = unreadinbox();
		Object.assign(state, await api('bootstrap'));
		announce(before);
		PLUGINS.accounts.refresh();
		if (!state.messages.some((m) => m.id === selected))
			state.selected = '';
		renderlist();
		renderreader();
		updatesyncstatus();
	}
	async function verifyaccount() {
		if (PLUGINS.accounts.busy)
			return;
		var id = GET('accounts.form.id');
		if (!id) {
			toast(TRANSLATE('@(Save the account before connecting.)'));
			return;
		}
		PLUGINS.accounts.busy = true;
		PLUGINS.accounts.ui({ verifying: true, discoveryStatus: TRANSLATE('@(Checking IMAP and SMTP securely…)') });
		PLUGINS.accounts.error('');
		try {
			await api('account_verify', {
				accountId: id
			});
			await reloadmail();
			PLUGINS.accounts.ui({ discoveryStatus: TRANSLATE('@(IMAP and SMTP authentication confirmed. You can sync the inbox.)') });
		} catch (e) {
			PLUGINS.accounts.error(e.message);
			PLUGINS.accounts.ui({ discoveryStatus: '' });
		} finally {
			PLUGINS.accounts.busy = false;
			PLUGINS.accounts.ui({ verifying: false });
		}
	}
	function currentpath() {
		return account(state.account)?.mailboxes?.find((f) => f.id === state.folder)?.path || '';
	}
	async function perform(fn) {
		if (networkbusy)
			throw Error(TRANSLATE('@(This mail account is busy. Wait for the current operation.)'));
		busy(true);
		renderreader();
		try {
			await reading;
			return await fn();
		} finally {
			busy(false);
			renderreader();
		}
	}
	async function syncmail(id, path = 'INBOX') {
		if (networkbusy) {
			toast(TRANSLATE('@(Mail synchronization is already running.)'));
			return;
		}
		var accounts = id ? [account(id)] : state.account ? [account(state.account)] : state.accounts.filter((a) => a.configured);
		if (!accounts.length || accounts.some((a) => !a?.configured)) {
			toast(TRANSLATE('@(Save the account before connecting.)'));
			return;
		}
		busy(true);

		try {
			await reading;
			for (var a of accounts) {
				var folderpath = path || a.mailboxes?.find((f) => f.id === state.folder)?.path || 'INBOX';
				await api('account_sync', { accountId: a.id, path: folderpath });
				delete syncfailures[a.id];
				delete retryafter[a.id];
				delete syncerrors[a.id];
			}
			await reloadmail();
			toast(TRANSLATE('@(Mail synchronized.)'));
		} catch (e) {
			if (mail.window === 'account-setup')
				PLUGINS.accounts.error(e.message);
			else
				toast(e.message);
		} finally {
			busy(false);
			renderreader();
		}
	}
	async function previewsend() {
		if (['sending', 'sent', 'unknown'].includes(draft?.status))
			return;
		dirty = true;
		await savedraft();
		await saving;
		if (!draft?.id)
			return;
		var a = account(draft.accountId);
		if (!a?.configured) {
			toast(TRANSLATE('@(Save the account before connecting.)'));
			return;
		}
		// What the recipient will get: the message formatted as it will be sent, from the address that was chosen.
		var rendered = totalmailformat.render(draft.body);
		SET('mail.sendPreview', {
			from: a.name + ' <' + (draft.from || a.email) + '>',
			to: draft.to,
			cc: draft.cc || '',
			bcc: draft.bcc || '',
			subject: draft.subject,
			files: draftfiles(draft),
			body: draft.body,
			html: rendered ? rendered.html : ''
		});
		ui({ sendError: '' });
		SET('mail.window', 'send-confirm');
	}
	async function confirmsend() {
		if (sendbusy || !draft?.id)
			return;
		sendbusy = true;
		ui({ confirmOff: true, editSendOff: true, sendError: '' });
		try {
			var result = await api('draft_send', {
				id: draft.id,
				confirmed: true,
				revision: draft.revision
			});
			draft = null;
			dirty = false;
			SET('mail.window', '');
			await reloadmail();
			toast(
				TRANSLATE(
					result.sentCopy === 'saved'
						? '@(Email sent and saved in your server Sent folder.)'
						: '@(Email sent. The server Sent copy is unconfirmed; a local copy is available. Do not resend.)'
				)
			);
		} catch (e) {
			ui({ sendError: e.message });
			await reloadmail();
			var saved = state.drafts.find((d) => d.id === draft?.id);
			if (saved)
				Object.assign(draft, saved);
			refreshsendbutton();
		} finally {
			sendbusy = false;
			// A message that was submitted cannot be sent again.
			ui({ editSendOff: false, confirmOff: ['unknown', 'sending', 'sent'].includes(draft?.status) });
		}
	}
	exports.backgroundReady = () =>
		!state.loading &&
		!!state.user &&
		!networkbusy &&
		!sendbusy &&
		!mail.window &&
		!PLUGINS.accounts?.busy &&
		state.accounts.some((a) => a.configured && ['verified', 'synced'].includes(a.status));
	exports.backgroundSync = async function() {
		if (!exports.backgroundReady())
			return;
		busy(true);
		try {
			await reading;
			for (var a of state.accounts.filter((a) => a.configured && ['verified', 'synced'].includes(a.status))) {
				if (retryafter[a.id] > Date.now())
					continue;
				try {
					await api('account_sync', { accountId: a.id, path: 'INBOX' });
					delete syncfailures[a.id];
					delete retryafter[a.id];
					delete syncerrors[a.id];
				} catch (err) {
					syncerrors[a.id] = String(err.message || '').slice(0, 200);
					syncfailures[a.id] = Math.min((syncfailures[a.id] || 0) + 1, 4);
					retryafter[a.id] = Date.now() + Math.min(900000, 60000 * Math.pow(2, syncfailures[a.id]));
				}
			}
			await reloadmail();
		} finally {
			busy(false);
			renderreader();
		}
	};
	// Formatted mail or plain text, for every message until the page is reloaded.
	exports.togglehtml = function() {
		plainview = !plainview;
		renderreader();
	};
	// Remote images load only for the message the reader asked about.
	exports.showimages = function() {
		if (state.selected)
			imagesfor.add(state.selected);
		renderreader();
	};
	exports.togglethreads = function() {
		try {
			localStorage.setItem('totalmail-threads-' + state.user.id, isgrouping() ? '0' : '1');
		} catch {}
		threadlabel();
		renderlist();
		renderreader();
	};
	exports.togglenotifications = async function() {
		if (!window.Notification)
			return notifylabel();
		var on = notificationsenabled();
		try {
			if (on)
				localStorage.setItem('totalmail-notify-' + state.user.id, '0');
			else {
				startnotifications();
				var permission = window.Notification.permission === 'granted' ? 'granted' : await window.Notification.requestPermission();
				localStorage.setItem('totalmail-notify-' + state.user.id, permission === 'granted' ? '1' : '0');
				if (permission !== 'granted')
					toast(TRANSLATE('@(Allow notifications for this site in the browser to turn them on.)'));
			}
		} catch {}
		notifylabel();
	};
	exports.operation = perform;
	exports.reload = reloadmail;
	exports.store = state;
	exports.api = api;
	exports.upload = (url, form) => totalmailrequest.upload(url, form);
	exports.notify = toast;
	// What the assistant writes goes into the composer only when the person chooses it.
	exports.say = say;
	exports.writebody = function(text) {
		SET('mail.compose.body', text);
		SETTER('mailbody/focus');
	};
	exports.replywith = async function(id, text) {
		var m = state.messages.find((x) => x.id === id);
		if (!m)
			return;
		await opencomposer(null, m);
		if (draft)
			SET('mail.compose.body', String(text).trim() + (GET('mail.compose.body') || ''));
	};
	exports.refresh = function() {
		renderlist();
		renderreader();
		updatesyncstatus();
		// The assistant depends on the accounts' settings, which may have just changed.
		PLUGINS.ai?.refresh?.();
	};
	// Formatting: the message stays plain text; the mailbody component writes the small markup the server turns into HTML on send.
	exports.format = function(element) {
		SETTER('mailbody/format', element[0].dataset.format);
	};
	exports.click = mailclick;
	exports.clearsearch = function() {
		SET('mail.search', '');
		SETTER('page/focus', '.ui-searchinput input');
	};
	exports.search = searchmail;
	exports.close = closecomposer;
});
