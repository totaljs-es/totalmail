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
			return localStorage.getItem('totalmail-threads-' + (state.user && state.user.id)) !== '0';
		} catch {
			return true;
		}
	}
	function threadlabel() {
		ui({ threads: isgrouping() });
	}
	// The conversation of a message as shown to the reader: nothing from the trash unless the message is there too.
	function conversationin(threads, m) {
		return threads.members(m.id).filter(function(x) { return x.folder !== 'trash' || x.folder === m.folder; });
	}
	function conversation(m) {
		return conversationin(totalmailthreads(state.messages), m);
	}
	// One entry per line of the list: the newest message of each conversation present in this view.
	function entries(items) {

		if (!isgrouping() || state.folder === 'drafts')
			return items.map(function(m) { return { m, members: [m], all: [m] }; });
		var threads = totalmailthreads(state.messages),
			seen = new Map(),
			list = [];
		for (var arr = Array.from(items), i = 0; i < arr.length; i++) {
			var m = arr[i];
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
			.filter(function(x) { return x.remote && x.accountId === m.accountId && x.folder === m.folder; });
	}
	var composer = totalmailcomposer({ mail, state, ui, api, toast, account, arm, command, reloadmail, renderlist });
	exports.pending = composer.pending;
	// Files dropped on the window or pasted into the message, and what the assistant writes (only when the person chooses it).
	exports.dropped = composer.dropped;
	exports.pasted = composer.pasted;
	exports.fitwindow = composer.fitwindow;
	exports.writebody = composer.writebody;
	exports.replywith = composer.replywith;
	exports.close = composer.close;
	function account(id) {
		return state.accounts.find(function(item) { return item.id === id; });
	}
	function toast(text) {
		SETTER('notify/info', totalmaildisplay.esc(text));
	}
	function api(schema, data) {
		return totalmailrequest.api(schema, data);
	}
	function visible(filter = state.filter) {

		var query = (mail.search || '').trim().toLocaleLowerCase(),
			parsed = totalmailquery.parse(query);
		var source = state.folder === 'drafts' ? state.drafts : state.messages;
		var matches = source.filter(
			function(item) {
				return item.status !== 'sent' &&
					(!state.account || item.accountId === state.account) &&
					(state.folder === 'drafts' || (state.folder === 'starred' ? item.starred : item.folder === state.folder)) &&
					(filter !== 'unread' || item.unread) &&
					(parsed.empty || totalmailquery.matches(parsed, item) || ((searchhits && searchhits.query) === query && searchhits.ids.has(item.id)));
			}
		);
		// Newest first across accounts and loaded pages; drafts keep their saved order.
		return state.folder === 'drafts'
			? matches
			: matches.sort(function(a, b) { return (b.date ? new Date(b.date).getTime() || 0 : 0) - (a.date ? new Date(a.date).getTime() || 0 : 0); });
	}
	// Folders in the current view that still have server messages that are not loaded.
	function olderpairs() {

		if (['starred', 'drafts', 'sent-local'].includes(state.folder))
			return [];
		var pairs = [];
		for (var list = state.accounts.filter(function(a) { return a.configured && (!state.account || a.id === state.account); }), i = 0; i < list.length; i++) {
			var a = list[i];
			var path = state.folder === 'inbox' ? 'INBOX' : (a.mailboxes && (a.mailboxes.findItem('id', state.folder) || {}).path);
			if (path && (a.remaining && a.remaining[path]) > 0)
				pairs.push({ accountId: a.id, path, remaining: a.remaining[path] });
		}
		return pairs;
	}
	function renderolder() {
		var pairs = olderpairs();
		ui({
			olderShown: !!pairs.length,
			olderCount: TRANSLATE('@({0} not loaded yet)').format(pairs.reduce(function(sum, p) { return sum + p.remaining; }, 0))
		});
	}
	// Server folders in the current view that a text search can run on.
	function serverpairs() {

		if (['starred', 'drafts', 'sent-local'].includes(state.folder))
			return [];
		var pairs = [];
		for (var list = state.accounts.filter(
				function(a) { return a.configured && ['verified', 'synced'].includes(a.status) && (!state.account || a.id === state.account); }
			), i = 0; i < list.length; i++) {
			var a = list[i];
			var path = state.folder === 'inbox' ? 'INBOX' : (a.mailboxes && (a.mailboxes.findItem('id', state.folder) || {}).path);
			if (path)
				pairs.push({ accountId: a.id, path });
		}
		return pairs;
	}
	function renderserversearch() {

		var query = (mail.search || '').trim();
		var show = query.length >= 2 && serverpairs().length > 0 && (searchhits && searchhits.query) !== query.toLocaleLowerCase();
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
			for (var arr = Array.from(pairs), j = 0; j < arr.length; j++) {
				var p = arr[j];
				var result = await api('account_search', { accountId: p.accountId, path: p.path, query });
				for (var list = Array.from(result.ids), i = 0; i < list.length; i++) {
					var id = list[i];
					ids.add(id);
				}
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
		await perform(async function() {
			try {
				for (var arr = Array.from(list), i = 0; i < arr.length; i++) {
					var t = arr[i];
					await api('message_erase', { id: t.id });
				}
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
			function(a) {
				return a.configured &&
					(!state.account || a.id === state.account) &&
					state.messages.some(function(m) { return m.remote && m.accountId === a.id && m.folder === 'trash'; });
			}
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
		await perform(async function() {
			try {
				for (var arr = Array.from(list), i = 0; i < arr.length; i++) {
					var a = arr[i];
					await api('trash_empty', { accountId: a.id });
				}
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
			for (var list = Array.from(pairs), i = 0; i < list.length; i++) {
				var p = list[i];
				await api('account_older', { accountId: p.accountId, path: p.path });
			}
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

		var scoped = state.messages.filter(function(item) { return !state.account || item.accountId === state.account; });
		var folders = [
			['inbox', 'inbox', TRANSLATE('@(Inbox)'), scoped.filter(function(m) { return m.folder === 'inbox' && m.unread; }).length],
			['starred', 'star', TRANSLATE('@(Starred)'), scoped.filter(function(m) { return m.starred; }).length],
			[
				'drafts',
				'file-alt',
				TRANSLATE('@(Drafts)'),
				state.drafts.filter(function(m) { return m.status !== 'sent' && (!state.account || m.accountId === state.account); }).length
			],
			['archive', 'archive', TRANSLATE('@(Archive)'), scoped.filter(function(m) { return m.folder === 'archive'; }).length],
			['trash', 'trash', TRANSLATE('@(Trash)'), scoped.filter(function(m) { return m.folder === 'trash'; }).length]
		];
		folders.push(['sent-local', 'envelope', TRANSLATE('@(Sent from TotalMail)'), 0]);
		if (state.account) {
			var a = account(state.account);
			for (var list = Array.from((a && a.mailboxes) || []), i = 0; i < list.length; i++) {
				var f = list[i];
				if (!['inbox', 'archive', 'trash'].includes(f.id))
					folders.push([f.id, 'folder', f.name, 0]);
			}
		}
		SET(
			'mail.folders',
			folders.map(function(entry) {
				var id = entry[0], icon = entry[1], label = entry[2], count = entry[3];
				return {
					id,
					icon,
					label,
					count,
					active: state.folder === id
				};
			})
		);
		SET(
			'mail.accounts',
			state.accounts.map(function(a) {
				return Object.assign({}, a, { active: state.account === a.id,
					unreadCount: state.messages.filter(function(m) { return m.accountId === a.id && m.folder === 'inbox' && m.unread && !m.welcome; }).length,
					syncFailed: !!syncfailures[a.id],
					// The reason the server gave, so the warning explains itself on hover.
					syncMessage: TRANSLATE('@(Automatic sync failed. Use Sync to retry.)') + (syncerrors[a.id] ? ' ' + syncerrors[a.id] : '') });
			})
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
					: (((account(state.account) || {}).mailboxes || []).findItem('id', state.folder) || {}).name || TRANSLATE('@(Mail)')),
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
			unreadCount: matching.filter(function(m) { return m.unread; }).length,
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
		var open = lines.findIndex(function(line) { return line.members.some(function(x) { return x.id === state.selected; }); });
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
				.map(function(entry) {
					var m = entry.m, members = entry.members, all = entry.all;
					var a = account(m.accountId);
					return Object.assign({}, m, { count: all.length,
						threaded: all.length > 1,
						unread: members.some(function(x) { return x.unread; }),
						selected: members.some(function(x) { return x.id === state.selected; }),
						checked: selection.has(m.id),
						displaySender: m.sender || m.to || TRANSLATE('@(No recipient)'),
						displayTime: m.date
							? new Date(m.date).toLocaleDateString(document.documentElement.lang)
							: m.time || TRANSLATE('@(Draft)'),
						displaySubject: m.subject || TRANSLATE('@(No subject)'),
						preview: m.body.replace(/\n/g, ' '),
						accountName: a.name,
						color: a.color });
				})
				.map(function(row) {
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
		selection.render();
	}
	function renderreader() {

		var m = state.messages.find(function(item) { return item.id === state.selected; });
		// The buttons of the toolbar: switched off when there is nothing to do with them, labelled for what they do now.
		var off = function(command) {
			return !m ||
				(m.outgoing && command !== 'print') ||
				(command !== 'print' && networkbusy) ||
				(['move', 'source'].includes(command) && !m.remote) ||
				(command === 'trash' && m.folder === 'trash' && !m.remote);
		};
		ui({
			t: {
				archive: {
					off: off('archive'),
					label: TRANSLATE(m && ['archive', 'trash'].includes(m.folder) ? '@(Move to inbox)' : '@(Archive message)')
				},
				star: { off: off('star'), starred: !!(m && m.starred) },
				move: { off: off('move') },
				trash: { off: off('trash'), label: TRANSLATE((m && m.folder) === 'trash' ? '@(Delete permanently)' : '@(Move to trash)') },
				unread: {
					off: off('unread'),
					label: TRANSLATE((m && m.unread) ? '@(Mark as read)' : '@(Mark as unread)'),
					icon: 'ti ti-' + ((m && m.unread) ? 'envelope-open' : 'envelope')
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
		SET('mail.reader', Object.assign({}, m, { thread:
				isgrouping() && chain.length > 1
					? chain.map(function(x) {
						return {
							id: x.id,
							current: x.id === m.id,
							unread: !!x.unread,
							who: x.outgoing ? TRANSLATE('@(You)') : x.sender || x.email,
							when: x.date ? new Date(x.date).toLocaleDateString(document.documentElement.lang) : '',
							snippet: (x.body || '').replace(/\s+/g, ' ').slice(0, 90)
						};
					})
					: [],
		unsubscribe: m.unsubscribe || null,
		invite: m.invite ? totalmaildisplay.invitecard(m.invite, document.documentElement.lang, TRANSLATE('@(No subject)')) : null,
		showHtml: !!m.hasHtml && !plainview,
		viewLabel: TRANSLATE(plainview ? '@(Show formatted)' : '@(Show plain text)'),
		frameSrc: '/html/' + encodeURIComponent(m.id) + '/' + (imagesfor.has(m.id) ? '?images=1' : ''),
		remoteBlocked: !!m.hasHtml && !plainview && m.remoteImages > 0 && !imagesfor.has(m.id),
		empty: false,
		color: a.color,
		accountName: a.name,
		accountEmail: m.outgoing ? m.to : a.email,
		messageKind: m.welcome ? TRANSLATE('@(Message)') : '',
		files: (m.attachments || []).map(function(f) {
			return {
				name: f.name,
				size: totalmaildisplay.filesize(f.size),
				href: '/attachment/' + encodeURIComponent(m.id) + '/' + f.index + '/'
			};
		}),
		body: m.remote && !m.bodyLoaded ? TRANSLATE('@(Loading message securely…)') : m.body,
		initials: m.sender
			.split(' ')
			.map(function(s) { return s[0]; })
			.slice(0, 2)
			.join('') }));
	}
	async function selectmessage(id) {

		if (state.folder === 'drafts') {
			await composer.open(state.drafts.find(function(d) { return d.id === id; }));
			return;
		}
		state.selected = id;
		ui({ hasReader: true });
		renderlist();
		renderreader();
		var m = state.messages.find(function(m) { return m.id === id; });
		if ((m && m.remote) && (!m.bodyLoaded || m.hasHtml === undefined || (m.attachmentCount && !m.attachments))) {
			reading = reading
				.catch(function() {})
				.then(async function() {
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
				var operation = async function() { return api(m.remote ? 'message_seen' : 'message_change', { id, operation: 'read' }); };
				reading = reading.catch(function() {}).then(operation);
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
		if (state.selected && !visible().some(function(item) { return item.id === state.selected; })) {
			state.selected = '';
			renderreader();
			ui({ hasReader: false });
		}
		renderlist();
	}
	// Undo after moving mail out of the inbox. A server message gets a new id when it moves, so it is found again by its Message-ID.
	var undo = totalmailundo({ state, ui, api, toast, perform, reloadmail });
	exports.undo = function() { return undo.undo().catch(function(e) { return toast(e.message); }); };
	var selection = totalmailselection({ state, ui, api, toast, perform, arm, entries, visible, targets, account, renderlist, undo, reloadmail });
	function showmore() {
		shown += stretch;
		renderlist();
	}
	exports.showmore = showmore;
	// The list asks for more when its end comes near (the scrollend component).
	exports.scrolled = function() { return GET('mail.ui').moreShown && showmore(); };
	// The checkbox of a line (Shift for a range), the one that selects all, and the buttons of the bar.
	exports.check = function(element, event) { return selection.toggle(element[0].dataset.row, !!(event && event.shiftKey), true); };
	exports.bulkall = function(element) { selection.all(!!element[0].checked); };
	exports.bulk = function(element) { return selection.bulk(element[0].dataset.bulk).catch(function(e) { return toast(e.message); }); };
	// The select-all box is a tri-state: it has no attribute for 'some', only a property, so the binding calls this.
	exports.bulkstate = function(value, path, element) {
		var box = element.find('input')[0];
		if (box) {
			box.checked = !!(value && value.bulkAll);
			box.indeterminate = !!(value && value.bulkSome);
		}
	};
	// Keyboard: move through the list, act on the open message or, when some are selected, on all of them.
	async function movecurrent(delta) {

		var lines = entries(visible());
		if (!lines.length)
			return;
		var i = lines.findIndex(function(line) { return line.members.some(function(x) { return x.id === state.selected; }); });
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
		else if (key === 'z' && undo.available())
			undo.undo();
		else if (key === 'Escape') {
			if (!selection.clear())
				return false;
		} else if (key === 'x') {
			var line = entries(visible()).find(function(l) { return l.members.some(function(x) { return x.id === state.selected; }); });
			if (line)
				selection.toggle(line.m.id, false);
		} else if (bulkable[key] && selection.size())
			selection.bulk(bulkable[key]);
		else if (['r', 'a', 'f'].includes(key) && state.selected)
			command(key === 'r' ? 'reply' : key === 'a' ? 'reply-all' : 'forward');
		else if (bulkable[key] && state.selected)
			command(bulkable[key] === 'trash' ? 'trash' : bulkable[key]);
		else
			return false;
		return true;
	}
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
				state.accounts.flatMap(function(a) { return [a.email].concat(Array.from(a.aliases || [])); })
			)
		};
		SET('mail.contacts', contactcache.list);
	}
	async function command(name) {

		if (state.loading)
			return;
		var m = state.messages.find(function(m) { return m.id === state.selected; });
		if (name === 'compose') {
			if (!state.accounts.length) {
				await PLUGINS.accounts.open();
				return;
			}
			await composer.open();
		} else if (name === 'show-cc' || name === 'show-bcc')
			composer.revealExtra(name === 'show-cc' ? 'cc' : 'bcc', true);
		else if (name === 'attach')
			SETTER('filepicker/open', { multiple: true, callback: function(files) { return composer.attach(files).catch(function(e) { return toast(e.message); }); } });
		else if (name === 'older')
			await oldermail();
		else if (name === 'server-search')
			await searchserver();
		else if (name === 'settings')
			SET('mail.window', 'settings');
		else if (name === 'account-setup')
			await PLUGINS.accounts.open();
		else if (name === 'logout') {
			await composer.flush();
			await api('user_logout');
			location.reload();
		} else if (name === 'sync')
			await syncmail(undefined, currentpath());
		else if (name === 'preview-send')
			await composer.preview();
		else if (name === 'edit-send') {
			if (composer.sending())
				return;
			composer.refreshSend();
			SET('mail.window', 'composer');
		} else if (name === 'confirm-send')
			await composer.confirm();
		else if (name === 'reply-all' && m && !m.welcome)
			await composer.open(null, m, true);
		else if (name === 'reply' && m && !m.welcome)
			await composer.open(null, m);
		else if (name === 'forward' && m && !m.welcome)
			await composer.open(null, m, false, true);
		else if (name === 'close-compose')
			await composer.close();
		else if (name === 'discard-compose')
			await composer.discard();
		else if (name === 'save-compose') {
			await composer.saveNow();
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
		else if (name === 'source' && (m && m.remote))
			SETTER('page/download', '/source/' + encodeURIComponent(m.id) + '/');
		else if (name === 'unsubscribe-mail' && (m && (m.unsubscribe && m.unsubscribe.mail))) {
			await composer.open();
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
			var i = lines.findIndex(function(line) { return line.members.some(function(item) { return item.id === state.selected; }); });
			if (lines.length)
				await selectmessage(lines[(i + 1) % lines.length].m.id);
		} else if (name === 'move' && (m && m.remote))
			PLUGINS.folders.move(m.id);
		else if (name === 'trash' && (m && m.remote) && m.folder === 'trash')
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
				!(account(m.accountId).mailboxes || []).some(function(f) { return f.specialUse === (operation === 'archive' ? '\\Archive' : '\\Trash'); })
			) {
				PLUGINS.folders.move(m.id);
				return;
			}
			var list = name === 'star' ? [m] : targets(m),
				origin = m.folder;
			await perform(async function() {
				try {
					for (var arr = Array.from(list), i = 0; i < arr.length; i++) {
						var t = arr[i];
						await api('message_change', { id: t.id, operation, enabled: !t.starred });
					}
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
						undo.offer(
							list.map(function(t) { return undo.entry(t, destination); }),
							TRANSLATE(operation === 'archive' ? '@(Archived.)' : '@(Moved to the trash.)')
						)
					)
				)
					toast(TRANSLATE('@(Message moved.)'));
				var next = (entries(visible())[0] || {}).m;
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
				var f = ((account(state.account) || {}).mailboxes || []).findItem('id', state.folder);
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
				await composer.removeAttachment(el.dataset.attachment);
			else if (el.dataset.message)
				if (event && (event.metaKey || event.ctrlKey || event.shiftKey))
					// Ctrl, ⌘ or Shift add the line to the selection instead of opening it.
					selection.toggle(el.dataset.message, event.shiftKey);
				else
					await selectmessage(el.dataset.message);
		} catch (e) {
			toast(e.message);
		}
	}
	// Every key of the page (the keys component): shortcuts while no window is open, Escape while one is.
	exports.keys = function(event) {

		if (mail.window) {
			if (event.key !== 'Escape')
				return;
			event.preventDefault();
			if (mail.window === 'send-confirm') {
				if (!composer.sending())
					SET('mail.window', 'composer');
				return;
			}
			if (mail.window === 'composer')
				composer.close();
			else
				closewindow();
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
			return (PLUGINS.accounts && PLUGINS.accounts.refresh) && (PLUGINS.users && PLUGINS.users.open);
		},
		async function() {

			WATCH('mail.language', async function(language) {
				if (!language || language === document.documentElement.lang)
					return;
				try {
					await composer.flush();
					var url = new URL(location.href);
					url.searchParams.set('lang', language);
					location.assign(url.href);
				} catch (e) {
					SET('mail.language', document.documentElement.lang);
					toast(e.message);
				}
			});
			WATCH('mail.compose.accountId', composer.changed);
			WATCH('mail.compose.from', composer.changed);
			WATCH('mail.compose.to', composer.changed);
			WATCH('mail.compose.cc', composer.changed);
			WATCH('mail.compose.bcc', composer.changed);
			WATCH('mail.compose.subject', composer.changed);
			WATCH('mail.compose.body', composer.changed);
			try {
				var data = await api('bootstrap');
				Object.assign(state, data);
				state.loading = false;
				ui({
					userName: state.user.name,
					userEmail: state.user.email,
					userInitials: state.user.name
						.split(/\s+/)
						.map(function(x) { return x[0]; })
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
				notify.label();
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
				WATCH('mail.theme', function(value) {

					if (!value)
						return;
					try {
						value === 'auto' ? localStorage.removeItem('totalmail-theme') : localStorage.setItem('totalmail-theme', value);
					} catch {}
					window.totalmailtheme && window.totalmailtheme();
				});
				if (notify.enabled())
					notify.start();
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
	mail.sendPreview = {
		from: '',
		to: '',
		subject: '',
		body: ''
	};
	function updatesyncstatus() {
		ui({
			listStatus: state.accounts.some(function(a) { return a.status === 'synced'; })
				? ''
				: TRANSLATE(
					state.accounts.some(function(a) { return a.configured; })
						? '@(Save credentials, then verify and sync)'
						: '@(Add your first mail account to get started.)'
				)
		});
	}
	var notify = totalmailnotify({ state, ui, toast, open: function(id) { return selectmessage(id); } });
	async function reloadmail() {

		var selected = state.selected,
			before = notify.unread();
		Object.assign(state, await api('bootstrap'));
		notify.announce(before);
		PLUGINS.accounts.refresh();
		if (!state.messages.some(function(m) { return m.id === selected; }))
			state.selected = '';
		renderlist();
		renderreader();
		updatesyncstatus();
	}
	function currentpath() {
		return (((account(state.account) || {}).mailboxes || []).findItem('id', state.folder) || {}).path || '';
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
		var accounts = id ? [account(id)] : state.account ? [account(state.account)] : state.accounts.filter(function(a) { return a.configured; });
		if (!accounts.length || accounts.some(function(a) { return !(a && a.configured); })) {
			toast(TRANSLATE('@(Save the account before connecting.)'));
			return;
		}
		busy(true);

		try {
			await reading;
			for (var list = Array.from(accounts), i = 0; i < list.length; i++) {
				var a = list[i];
				var folderpath = path || (a.mailboxes && (a.mailboxes.findItem('id', state.folder) || {}).path) || 'INBOX';
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
	exports.backgroundReady = function() {
		return !state.loading &&
			!!state.user &&
			!networkbusy &&
			!composer.sending() &&
			!mail.window &&
			!(PLUGINS.accounts && PLUGINS.accounts.busy) &&
			state.accounts.some(function(a) { return a.configured && ['verified', 'synced'].includes(a.status); });
	};
	exports.backgroundSync = async function() {

		if (!exports.backgroundReady())
			return;
		busy(true);
		try {
			await reading;
			for (var list = state.accounts.filter(function(a) { return a.configured && ['verified', 'synced'].includes(a.status); }), i = 0; i < list.length; i++) {
				var a = list[i];
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
	exports.togglenotifications = notify.toggle;
	exports.operation = perform;
	// Closes a window of the settings, and forgets the passwords that were typed in it.
	function closewindow() {
		SET('mail.window', '');
		SET('accounts.form.password', '');
		SET('users.form.password', '');
	}
	exports.closewindow = closewindow;
	exports.syncaccount = function(id) { return syncmail(id); };
	exports.reload = reloadmail;
	exports.store = state;
	exports.api = api;
	exports.upload = function(url, form) { return totalmailrequest.upload(url, form); };
	exports.notify = toast;
	// What the assistant writes goes into the composer only when the person chooses it.
	exports.say = notify.say;
	exports.refresh = function() {

		renderlist();
		renderreader();
		updatesyncstatus();
		// The assistant depends on the accounts' settings, which may have just changed.
		(PLUGINS.ai && (PLUGINS.ai.refresh && PLUGINS.ai.refresh()));
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
});
