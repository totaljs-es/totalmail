// The open message as the reader shows it: the toolbar (what can be done to it now), the header, the conversation, the body (formatted or
// plain text, remote images only when asked for) and the invitation or attachments it carries.
// deps = { state, ui, account, conversation, isgrouping, isbusy } (isbusy() says whether a mail operation is running).
function totalmailreader(deps) {

	var state = deps.state,
		ui = deps.ui,
		account = deps.account,
		conversation = deps.conversation,
		isgrouping = deps.isgrouping;
	// Formatted mail or plain text for every message until the page is reloaded, and the messages whose remote images were asked for.
	var plainview = false,
		imagesfor = new Set();
	function renderreader() {

		var m = state.messages.find(function(item) { return item.id === state.selected; });
		// The buttons of the toolbar: switched off when there is nothing to do with them, labelled for what they do now.
		var off = function(command) {
			return !m ||
				(m.outgoing && command !== 'print') ||
				(command !== 'print' && deps.isbusy()) ||
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
	return {
		render: renderreader,
		togglehtml: function() {
			plainview = !plainview;
			renderreader();
		},
		showimages: function(id) {
			if (id)
				imagesfor.add(id);
			renderreader();
		},
		// Whether the remote images of a message were asked for (printing keeps the choice).
		images: function(id) { return imagesfor.has(id); }
	};
}
