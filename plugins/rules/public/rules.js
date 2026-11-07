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
			var blank = function() { return { id: '', name: '', field: 'from', op: 'contains', value: '', action: 'archive', path: '' }; };
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
			var account = function() { return state.accounts.find(function(a) { return a.id === GET('rules.accountId'); }); };
			function error(text) {
				exports.set('error', text || '');
			}
			function describe(r) {
				var field = model.fieldOptions.find(function(f) { return f.id === r.field; })?.name,
					op = model.opOptions.find(function(o) { return o.id === r.op; })?.name,
					action = model.actionOptions.find(function(o) { return o.id === r.action; })?.name;
				return field + ' ' + op + ' “' + r.value + '” → ' + action + (r.path ? ' (' + r.path + ')' : '');
			}
			function render() {

				var a = account(),
					rules = a?.rules || [],
					log = a?.ruleLog || [];
				SET(
					'rules.items',
					rules.map(function(r) {
						return {
							id: r.id,
							name: r.name,
							summary: describe(r),
							offLabel: r.enabled === false ? TRANSLATE('@(Off)') : '',
							toggleLabel: TRANSLATE(r.enabled === false ? '@(Turn on)' : '@(Turn off)')
						};
					})
				);
				SET(
					'rules.log',
					log.slice(0, 10).map(function(l) {
						return {
							rule: l.rule,
							action: l.action,
							failed: l.ok === false ? TRANSLATE('@(Failed)') : '',
							subject: l.subject || '',
							when: new Date(l.at).toLocaleString(document.documentElement.lang)
						};
					})
				);
				SET(
					'rules.folderOptions',
					(a?.mailboxes || []).filter(function(f) { return f.path.toUpperCase() !== 'INBOX'; }).map(function(f) { return { id: f.path, name: f.name }; })
				);
			}
			function merge(result) {

				var a = state.accounts.find(function(x) { return x.id === result.accountId; });
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

				if (!state.accounts.some(function(a) { return a.configured; })) {
					mailbox.notify(TRANSLATE('@(Add your first mail account to get started.)'));
					return;
				}
				SET('rules.accountId', state.account || state.accounts.find(function(a) { return a.configured; }).id);
				render();
				clear();
				SET('mail.window', 'rules');
			}
			var form = function() {

				var payload = { accountId: GET('rules.accountId') };
				for (var field of ['name', 'field', 'op', 'value', 'action', 'path'])
					payload[field] = GET('rules.form.' + field);
				payload.id = GET('rules.form.id') || '';
				return payload;
			};
			exports.set('', model);
			exports.open = open;
			exports.clear = clear;
			exports.save = async function() {

				var payload = form();
				if (payload.action !== 'move')
					payload.path = '';
				var enabled = (account()?.rules || []).find(function(r) { return r.id === payload.id; })?.enabled;
				var result = await call('rule_save', { ...payload, enabled: enabled !== false });
				if (result) {
					merge(result);
					clear();
					mailbox.notify(TRANSLATE('@(Rule saved.)'));
				}
			};
			exports.test = async function() {

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
			exports.edit = function(element) {

				var r = (account()?.rules || []).find(function(x) { return x.id === element[0].dataset.id; });
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
			exports.toggle = async function(element) {

				var r = (account()?.rules || []).find(function(x) { return x.id === element[0].dataset.id; });
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
			exports.remove = async function(element) {
				var result = await call('rule_delete', { accountId: GET('rules.accountId'), id: element[0].dataset.id });
				if (result) {
					merge(result);
					clear();
				}
			};
			WATCH('rules.accountId', function() {
				if (mailbox.model.window === 'rules') {
					render();
					clear();
				}
			});
		}
	);
});
