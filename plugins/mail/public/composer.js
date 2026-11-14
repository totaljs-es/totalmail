// The composer: the draft that is being written, saved a moment after every change, previewed and sent only when the person confirms.
// The window hands it what it needs: deps = { mail, state, ui, api, toast, account, arm, command, reloadmail, renderlist } (the model
// the views bind to, the state of the mailbox, the patch of mail.ui, the call to the server, the toast, the account of an id, the
// press-twice guard, the command of the window, the reload and the redraw of the list).
function totalmailcomposer(deps) {

	var mail = deps.mail,
		state = deps.state,
		ui = deps.ui,
		api = deps.api,
		toast = deps.toast,
		account = deps.account,
		arm = deps.arm,
		command = deps.command,
		reloadmail = deps.reloadmail,
		renderlist = deps.renderlist;

	var draft = null,
		drafttimer,
		saving = Promise.resolve(),
		composeloading = false,
		dirty = false,
		pendingsaves = 0;
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
			.catch(function() {})
			.then(async function() {
				try {
					if (!data.id)
						data.id = current.id;
					var saved = await api('draft_save', data);
					Object.assign(current, saved);
					var i = state.drafts.findIndex(function(d) { return d.id === saved.id; });
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
		drafttimer = setTimeout(function() { return savedraft().catch(function(e) { return toast(e.message); }); }, 650);
	}
	function draftfiles(source) {
		return ((source && source.attachments) || []).map(function(f) { return { id: f.id, name: f.name, size: totalmaildisplay.filesize(f.size) }; });
	}
	function draftchanged(saved) {

		Object.assign(draft, saved);
		var i = state.drafts.findIndex(function(d) { return d.id === saved.id; });
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
		if (!(draft && draft.id))
			return;
		for (var arr = Array.from(list), i = 0; i < arr.length; i++) {
			var file = arr[i];
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
		if (!(draft && draft.id))
			return;
		try {
			draftchanged(await api('draft_attachment_remove', { id: draft.id, attachmentId: id }));
		} catch (e) {
			toast(e.message);
		}
	}
	// The signature of an account, as it is added below a new message.
	function signature(accountid) {
		var text = (account(accountid) || {}).signature;
		return text ? '\n\n-- \n' + text : '';
	}
	// Files dropped on the window or pasted from the clipboard (a screenshot, say) are attached like the button's files.
	// Files dropped on the window (the dropfiles component): on the composer they are attached, on the mailbox they start a new message.
	var dropped = async function(files) {

		var list = files.map(function(f) { return totalmaildisplay.stamp(f); });
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
	var pasted = function(files) { return attachfiles(files.map(function(f) { return totalmaildisplay.stamp(f); })).catch(function(e) { return toast(e.message); }); };
	// Cc and Bcc stay out of the way until they are asked for or the message already has them.
	// The input component of a path, to give it the focus.
	function focusfield(path) {
		var field = FIND('input', true).find(function(c) { return (c.path && c.path.path) === path; });
		field && field.autofocus();
	}
	// The window measures itself when it opens, before the assistant's box or a row of the form has appeared: it measures again,
	// and a window that is still taller than the screen moves up until its buttons are in view.
	function fitwindow(delay = 60) {
		var fit = function() {
			SETTER('modal', 'resize');
			setTimeout(function() {

				var element = document.querySelector('.ui-modal.composer');
				if (!element || GET('mail.window') !== 'composer')
					return;
				var box = element.getBoundingClientRect();
				if (box.bottom > innerHeight - 8)
					element.style.top = Math.max(8, innerHeight - box.height - 8) + 'px';
			}, 40);
		};
		// The window also measures itself once more when its opening animation ends (the first time it takes longer).
		for (var list = [0, 800, 1800], i = 0; i < list.length; i++) {
			var later = list[i];
			setTimeout(fit, delay + later);
		}
	}
	function revealextra(field, focus) {

		ui(field === 'cc' ? { ccLink: false } : { bccLink: false });
		fitwindow();
		if (focus)
			focusfield('mail.compose.' + field);
	}
	function resetextras(values) {
		ui({ ccLink: true, bccLink: true });
		for (var list = ['cc', 'bcc'], i = 0; i < list.length; i++) {
			var field = list[i];
			if (values[field])
				revealextra(field, false);
		}
	}
	// The addresses an account can send from: its own and its aliases. The row to choose appears only when there are aliases.
	function fillfrom(accountid, chosen) {

		var a = account(accountid),
			list = a ? [a.email].concat(Array.from(a.aliases || [])) : [];
		SET(
			'mail.fromOptions',
			list.map(function(address) { return { id: address, name: address }; })
		);
		ui({ aliasRow: list.length >= 2 });
		SET('mail.compose.from', list.includes(chosen) ? chosen : list[0] || '');
	}
	// A reply goes out from the alias the person wrote to, unless the main address was a recipient too.
	function replyfrom(message) {

		var a = account(message.accountId),
			wanted = Array.from(message.toRecipients || []).concat(Array.from(message.ccRecipients || [])).map(function(x) { return String(x).toLowerCase(); });
		if (!a || wanted.includes(a.email.toLowerCase()))
			return '';
		return (a.aliases || []).find(function(x) { return wanted.includes(x); }) || '';
	}
	// The labels of the quoted header, in the person's language.
	function quotetext() {
		return {
			wrote: function(date, who) {
				return TRANSLATE('@(On {date}, {sender} wrote:)')
					.replace('{date}', function() { return date; })
					.replace('{sender}', function() { return who; });
			},
			forwarded: TRANSLATE('@(Forwarded message)'),
			from: TRANSLATE('@(From)'),
			date: TRANSLATE('@(Date)'),
			subject: TRANSLATE('@(Subject)'),
			to: TRANSLATE('@(To)'),
			format: function(value) { return value ? new Date(value).toLocaleString(document.documentElement.lang) : ''; }
		};
	}
	// A forward carries the original's attachments: the server copies them into the saved draft.
	async function forwardfiles(id) {

		dirty = true;
		await savedraft();
		await saving;
		if (!(draft && draft.id))
			return;
		try {
			var next = Object.assign({}, await api('draft_forward_files', { id: draft.id, messageId: id }));
			var skippedfiles = next.skippedFiles;
			delete next.skippedFiles;
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
			? Object.assign({}, existing)
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
				used = new Set([mine && mine.email.toLowerCase()].concat(Array.from((mine && mine.aliases) || [])));
			function recipients(values) {
				return values
					.filter(function(value) {

						if (!value || used.has(value.toLowerCase()))
							return false;
						used.add(value.toLowerCase());
						return true;
					})
					.join(', ');
			}
			draft.to = recipients([reply.replyAddress || reply.email].concat(Array.from(reply.toRecipients || [])));
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
			setTimeout(function() { return reply && !forward ? SETTER('mailbody/focus', 0) : focusfield('mail.compose.to'); }, 150);
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
		await saving.catch(function() {});
		var id = draft.id;
		if (id && state.drafts.some(function(d) { return d.id === id; })) {
			await api('draft_delete', { id });
			state.drafts = state.drafts.filter(function(d) { return d.id !== id; });
		}
		SET('mail.window', '');
		draft = null;
		renderlist();
		toast(TRANSLATE('@(Draft discarded.)'));
	}
	// The account the open message was last signed for, so changing it twice still compares with what is on screen.
	var signedfor = null;
	WATCH('mail.compose.accountId', function(next) {

		var body = GET('mail.compose.body'),
			previous = signedfor || (draft && draft.accountId);
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
	var pending = function() { return dirty || pendingsaves > 0; };
	var sendbusy = false;
	function refreshsendbutton() {

		var selected = GET('mail.compose.accountId') || (draft && draft.accountId);
		var a = account(selected);
		var locked = ['sending', 'sent', 'unknown'].includes((draft && draft.status));
		ui({ sendOff: !(a && a.configured) || locked, locked });
		SETTER('#compose-account', 'reconfigure', { disabled: locked });
		SETTER('#compose-alias', 'reconfigure', { disabled: locked });
	}
	async function previewsend() {

		if (['sending', 'sent', 'unknown'].includes((draft && draft.status)))
			return;
		dirty = true;
		await savedraft();
		await saving;
		if (!(draft && draft.id))
			return;
		var a = account(draft.accountId);
		if (!(a && a.configured)) {
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

		if (sendbusy || !(draft && draft.id))
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
			var saved = state.drafts.find(function(d) { return d.id === (draft && draft.id); });
			if (saved)
				Object.assign(draft, saved);
			refreshsendbutton();
		} finally {
			sendbusy = false;
			// A message that was submitted cannot be sent again.
			ui({ editSendOff: false, confirmOff: ['unknown', 'sending', 'sent'].includes((draft && draft.status)) });
		}
	}
	var writebody = function(text) {
		SET('mail.compose.body', text);
		SETTER('mailbody/focus');
	};
	var replywith = async function(id, text) {

		var m = state.messages.find(function(x) { return x.id === id; });
		if (!m)
			return;
		await opencomposer(null, m);
		if (draft)
			SET('mail.compose.body', String(text).trim() + (GET('mail.compose.body') || ''));
	};
	// What the rest of the window needs from the composer.
	return {
		draft: function() { return draft; },
		sending: function() { return sendbusy; },
		pending,
		changed: changeddraft,
		open: opencomposer,
		close: closecomposer,
		discard: discardcompose,
		preview: previewsend,
		confirm: confirmsend,
		attach: attachfiles,
		removeAttachment: removeattachment,
		revealExtra: revealextra,
		refreshSend: refreshsendbutton,
		fitwindow,
		dropped,
		pasted,
		writebody,
		replywith,
		// Saves what is pending and waits for it: before leaving the page or the language.
		flush: async function() {
			if (draft) {
				await savedraft();
				await saving;
			}
		},
		// The save button: a message that was never changed is still saved once.
		saveNow: async function() {
			if (!dirty && draft && !draft.id)
				dirty = true;
			await savedraft();
			await saving;
		}
	};
}
