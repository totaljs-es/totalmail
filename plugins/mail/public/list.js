// The list of messages: what is in view (folder, account, filter, search), drawn in stretches, with the counts, the navigation on the
// left, loading older mail, searching the mail server and emptying the trash.
// deps = { mail, state, ui, api, toast, account, entries, conversation, refreshcontacts, selection, perform, arm, armed, busy, isbusy,
// waiting, reloadmail, renderreader, syncfailures, syncerrors }: the model, the state of the mailbox and the parts of the window it
// uses (armed() is the press-twice guard that is waiting, isbusy() whether a mail operation runs, waiting() the read in progress).
function totalmaillist(deps) {

	var mail = deps.mail,
		state = deps.state,
		ui = deps.ui,
		api = deps.api,
		toast = deps.toast,
		account = deps.account,
		entries = deps.entries,
		conversation = deps.conversation,
		refreshcontacts = deps.refreshcontacts,
		selection = deps.selection,
		perform = deps.perform,
		arm = deps.arm,
		busy = deps.busy,
		reloadmail = deps.reloadmail,
		renderreader = deps.renderreader,
		syncfailures = deps.syncfailures,
		syncerrors = deps.syncerrors;
	var searchhits = null;
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
		if (deps.isbusy()) {
			toast(TRANSLATE('@(Mail synchronization is already running.)'));
			return;
		}
		busy(true);
		renderserversearch();
		try {
			await deps.waiting();
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
				deps.armed().key === 'empty' && Date.now() < deps.armed().until ? '@(Press again to empty the trash)' : '@(Empty the trash)'
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
		if (deps.isbusy()) {
			toast(TRANSLATE('@(Mail synchronization is already running.)'));
			return;
		}
		busy(true);
		renderolder();
		try {
			await deps.waiting();
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
	function showmore() {
		shown += stretch;
		renderlist();
	}
	return {
		visible,
		render: renderlist,
		search: searchmail,
		searchserver,
		emptytrash,
		older: oldermail,
		more: showmore
	};
}
