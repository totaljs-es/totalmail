PLUGIN('rules', function(exports) {
	WAIT(
		function() {
			return !!PLUGINS.mail?.store && !!PLUGINS.accounts;
		},
		function() {
			var mailbox = PLUGINS.mail,
				state = mailbox.store,
				model = {},
				busy = false;
			var blank = () => ({ id: '', name: '', field: 'from', op: 'contains', value: '', action: 'archive', path: '' });
			model.fieldOptions = [
				{ id: 'from', name: TRANSLATE('@(From)') },
				{ id: 'to', name: TRANSLATE('@(To or Cc)') },
				{ id: 'subject', name: TRANSLATE('@(Subject)') }
			];
			model.opOptions = [
				{ id: 'contains', name: TRANSLATE('@(contains)') },
				{ id: 'is', name: TRANSLATE('@(is exactly)') }
			];
			model.actionOptions = [
				{ id: 'archive', name: TRANSLATE('@(Archive)') },
				{ id: 'trash', name: TRANSLATE('@(Move to trash)') },
				{ id: 'read', name: TRANSLATE('@(Mark as read)') },
				{ id: 'star', name: TRANSLATE('@(Star)') },
				{ id: 'move', name: TRANSLATE('@(Move to folder)') }
			];
			model.folderOptions = [];
			model.form = blank();
			model.accountId = '';
			// Text of the window that the view binds to.
			model.error = '';
			model.test = '';
			model.heading = TRANSLATE('@(New rule)');
			var account = () => state.accounts.find((a) => a.id === GET('rules.accountId'));
			function error(text) {
				exports.set('error', text || '');
			}
			function describe(r) {
				var field = model.fieldOptions.find((f) => f.id === r.field)?.name,
					op = model.opOptions.find((o) => o.id === r.op)?.name,
					action = model.actionOptions.find((o) => o.id === r.action)?.name;
				return field + ' ' + op + ' “' + r.value + '” → ' + action + (r.path ? ' (' + r.path + ')' : '');
			}
			function render() {
				var a = account(),
					rules = a?.rules || [],
					log = a?.ruleLog || [];
				SET(
					'rules.items',
					rules.map((r) => ({
						id: r.id,
						name: r.name,
						summary: describe(r),
						offLabel: r.enabled === false ? TRANSLATE('@(Off)') : '',
						toggleLabel: TRANSLATE(r.enabled === false ? '@(Turn on)' : '@(Turn off)')
					}))
				);
				SET(
					'rules.log',
					log.slice(0, 10).map((l) => ({
						rule: l.rule,
						action: l.action,
						failed: l.ok === false ? TRANSLATE('@(Failed)') : '',
						subject: l.subject || '',
						when: new Date(l.at).toLocaleString(document.documentElement.lang)
					}))
				);
				SET(
					'rules.folderOptions',
					(a?.mailboxes || []).filter((f) => f.path.toUpperCase() !== 'INBOX').map((f) => ({ id: f.path, name: f.name }))
				);
			}
			function merge(result) {
				var a = state.accounts.find((x) => x.id === result.accountId);
				if (a) {
					a.rules = result.rules;
					a.ruleLog = result.ruleLog;
				}
				render();
			}
			async function call(schema, payload) {
				if (busy)
					return null;
				busy = true;
				error('');
				try {
					return await mailbox.api(schema, payload);
				} catch (e) {
					error(e.message);
					return null;
				} finally {
					busy = false;
				}
			}
			function clear() {
				SET('rules.form', blank());
				exports.set('heading', TRANSLATE('@(New rule)'));
				exports.set('test', '');
				error('');
			}
			function open() {
				if (!state.accounts.some((a) => a.configured)) {
					mailbox.notify(TRANSLATE('@(Add your first mail account to get started.)'));
					return;
				}
				SET('rules.accountId', state.account || state.accounts.find((a) => a.configured).id);
				render();
				clear();
				SET('mail.window', 'rules');
			}
			var form = () => {
				var payload = { accountId: GET('rules.accountId') };
				for (var field of ['name', 'field', 'op', 'value', 'action', 'path'])
					payload[field] = GET('rules.form.' + field);
				payload.id = GET('rules.form.id') || '';
				return payload;
			};
			exports.set('', model);
			exports.open = open;
			exports.clear = clear;
			exports.save = async () => {
				var payload = form();
				if (payload.action !== 'move')
					payload.path = '';
				var enabled = (account()?.rules || []).find((r) => r.id === payload.id)?.enabled;
				var result = await call('rule_save', { ...payload, enabled: enabled !== false });
				if (result) {
					merge(result);
					clear();
					mailbox.notify(TRANSLATE('@(Rule saved.)'));
				}
			};
			exports.test = async () => {
				var payload = form();
				var result = await call('rule_test', {
					accountId: payload.accountId,
					field: payload.field,
					op: payload.op,
					value: payload.value
				});
				if (!result)
					return;
				exports.set(
					'test',
					result.matching
						? TRANSLATE('@({0} messages in the inbox would match.)').format(result.matching) + ' ' + result.sample.join(' · ')
						: TRANSLATE('@(No message in the inbox matches this today.)')
				);
			};
			exports.edit = (element) => {
				var r = (account()?.rules || []).find((x) => x.id === element[0].dataset.id);
				if (!r)
					return;
				SET('rules.form', {
					id: r.id,
					name: r.name,
					field: r.field,
					op: r.op,
					value: r.value,
					action: r.action,
					path: r.path || ''
				});
				exports.set('heading', TRANSLATE('@(Edit rule)'));
			};
			exports.toggle = async (element) => {
				var r = (account()?.rules || []).find((x) => x.id === element[0].dataset.id);
				if (!r)
					return;
				var result = await call('rule_save', {
					...r,
					path: r.path || '',
					accountId: GET('rules.accountId'),
					enabled: r.enabled === false
				});
				if (result)
					merge(result);
			};
			exports.remove = async (element) => {
				var result = await call('rule_delete', { accountId: GET('rules.accountId'), id: element[0].dataset.id });
				if (result) {
					merge(result);
					clear();
				}
			};
			WATCH('rules.accountId', () => {
				if (mailbox.model.window === 'rules') {
					render();
					clear();
				}
			});
		}
	);
});
