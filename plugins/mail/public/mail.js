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
	// The list of messages (list.js). It draws the selection, so it is made once the selection exists, further down.
	var list;
	function visible(filter) {
		return list.visible(filter);
	}
	function renderlist() {
		list.render();
	}
	function searchmail() {
		list.search();
	}
	function searchserver() {
		return list.searchserver();
	}
	function emptytrash() {
		return list.emptytrash();
	}
	function oldermail() {
		return list.older();
	}
	function showmore() {
		list.more();
	}
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
	var reader = totalmailreader({ state, ui, account, conversation, isgrouping, isbusy: function() { return networkbusy; } });
	function renderreader() {
		reader.render();
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
	// Undo after moving mail out of the inbox. A server message gets a new id when it moves, so it is found again by its Message-ID.
	var undo = totalmailundo({ state, ui, api, toast, perform, reloadmail });
	exports.undo = function() { return undo.undo().catch(function(e) { return toast(e.message); }); };
	var selection = totalmailselection({ state, ui, api, toast, perform, arm, entries, visible, targets, account, renderlist, undo, reloadmail });
	list = totalmaillist({ mail, state, ui, api, toast, account, entries, conversation, refreshcontacts, selection, perform, arm, armed: function() { return armed; }, busy, isbusy: function() { return networkbusy; }, waiting: function() { return reading; }, reloadmail, renderreader, syncfailures, syncerrors });
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
			if (!leave())
				return;
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
					(reader.images(m.id) ? '1' : '0') +
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
	exports.togglehtml = reader.togglehtml;
	// Remote images load only for the message the reader asked about.
	exports.showimages = function() { reader.showimages(state.selected); };
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
	// The sections of the settings that have a form. Each section says when its form holds what is saved (it has just been loaded or
	// saved: PLUGINS.mail.saved(path)); what differs from that was typed by the person and is not saved yet. A form that never said
	// so is never in the way.
	var forms = {
		'account-setup': ['accounts.form'],
		profile: ['users.profileform'],
		users: ['users.form'],
		ai: ['ai.form'],
		rules: ['rules.form'],
		providers: ['providers.ms', 'providers.google', 'providers.type']
	};
	var baselines = {};
	function baseline(path) {
		baselines[path] = JSON.stringify(GET(path) || null);
	}
	function unsaved(name) {
		return (forms[name] || []).some(function(path) { return path in baselines && JSON.stringify(GET(path) || null) !== baselines[path]; });
	}
	// Whether the open section may be left: nothing typed is unsaved, or the person agrees to lose it.
	function leave() {
		return !unsaved(mail.window) || window.confirm(TRANSLATE('@(This section has changes that are not saved. Leave without saving them?)'));
	}
	exports.leave = leave;
	// What is in the form at `path` now is what is saved (the section has just loaded or saved it).
	exports.saved = baseline;
	// The passwords typed in a section are forgotten when the person leaves it, whichever way.
	function forget() {
		SET('accounts.form.password', '');
		SET('users.form.password', '');
		if (GET('users.profileform'))
			SET('users.profileform', Object.assign({}, GET('users.profileform'), { currentPassword: '', newPassword: '', confirmPassword: '' }));
	}
	// Another section of the list on the left (data-open is what opens it).
	exports.section = function(element) {

		var target = element[0].dataset.open;
		// The section that is open already is not opened again (and what was typed in it stays).
		if (element[0].getAttribute('aria-current') === 'page' || !leave())
			return;
		forget();
		if (target === 'settings')
			SET('mail.window', 'settings');
		else
			EXEC(target);
	};
	// Closes a window of the settings, and forgets the passwords that were typed in it.
	function closewindow() {
		if (!leave())
			return;
		SET('mail.window', '');
		forget();
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
