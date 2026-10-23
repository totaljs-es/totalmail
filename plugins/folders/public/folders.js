PLUGIN('folders', function(exports) {

	var mailbox,
		messageid = '',
		busy = false;
	exports.set('', { form: {}, error: '', busy: false });
	WAIT(
		() => !!PLUGINS.mail?.store,
		function() {
			mailbox = PLUGINS.mail;
		}
	);
	// The message, the busy state and the button of the window are bindings of the view.
	function error(text) {
		exports.set('error', text || '');
	}
	function parents(id) {
		var a = mailbox.store.accounts.find((a) => a.id === id);
		SET(
			'folders.parents',
			[{ id: '', name: TRANSLATE('@(Top level)') }].concat((a?.mailboxes || []).map((f) => ({ id: f.path, name: f.path })))
		);
	}
	WATCH('folders.form.accountId', (id) => {
		if (mailbox) {
			parents(id);
			SET('folders.form.parent', '');
		}
	});
	function close() {
		if (!busy)
			SET('mail.window', '');
	}
	function create() {

		if (!mailbox)
			return;
		var accounts = mailbox.store.accounts.filter((a) => a.configured);
		if (!accounts.length) {
			mailbox.notify(TRANSLATE('@(Save the account before connecting.)'));
			return;
		}
		messageid = '';
		SET(
			'folders.accounts',
			accounts.map((a) => ({ id: a.id, name: a.name + ' · ' + a.email }))
		);
		SET('folders.form', {
			accountId: accounts.some((a) => a.id === mailbox.store.account) ? mailbox.store.account : accounts[0].id,
			name: '',
			parent: ''
		});
		parents(GET('folders.form.accountId'));
		error();
		SET('folders.moving', false);
		SET('mail.window', 'folder-manager');
	}
	function move(id) {

		var m = mailbox.store.messages.find((m) => m.id === id);
		if (!m?.remote)
			return;
		var a = mailbox.store.accounts.find((a) => a.id === m.accountId);
		var options = (a.mailboxes || []).filter((f) => f.path !== m.mailboxPath).map((f) => ({ id: f.path, name: f.path }));
		messageid = id;
		SET('folders.destinations', options);
		SET('folders.form', { path: options[0]?.id || '' });
		SET('folders.moving', true);
		error();
		SET('mail.window', 'folder-manager');
	}
	async function save() {

		if (busy)
			return;
		busy = true;
		exports.set('busy', true);
		error();
		try {
			await mailbox.operation(async () => {

				if (messageid)
					await mailbox.api('message_move', { id: messageid, path: GET('folders.form.path') });
				else {
					var result = await mailbox.api('folder_create', {
						accountId: GET('folders.form.accountId'),
						name: GET('folders.form.name'),
						parent: GET('folders.form.parent') || ''
					});
					mailbox.store.account = result.accountId;
					mailbox.store.selected = '';
				}
				SET('mail.window', '');
				await mailbox.reload();
			});
			mailbox.notify(TRANSLATE(messageid ? '@(Message moved.)' : '@(Folder ready.)'));
		} catch (e) {
			error(e.message);
		} finally {
			busy = false;
			exports.set('busy', false);
		}
	}
	exports.create = create;
	exports.move = move;
	exports.save = save;
	exports.close = close;
});
