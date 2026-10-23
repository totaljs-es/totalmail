PLUGIN('providers', function(exports) {
	WAIT(
		function() {
			return !!PLUGINS.mail?.store && !!PLUGINS.accounts;
		},
		function() {

			var mailbox = PLUGINS.mail,
				state = mailbox.store,
				model = {},
				data = null,
				busy = false;
			function blank() {
				return {
					id: '',
					name: '',
					domains: '',
					imapHost: '',
					imapPort: 993,
					imapSecurity: 'tls',
					smtpHost: '',
					smtpPort: 465,
					smtpSecurity: 'tls',
					auth: 'password',
					summary: '',
					steps: '',
					note: ''
				};
			}
			model.authOptions = [
				{ id: 'password', name: TRANSLATE('@(Password)') },
				{ id: 'app-password', name: TRANSLATE('@(App password)') }
			];
			model.type = blank();
			model.ms = { clientId: '', tenant: '', clientSecret: '' };
			model.google = { clientId: '', clientSecret: '' };
			// Text and state of the window that the view binds to.
			model.error = '';
			model.heading = TRANSLATE('@(Add an account type)');
			model.msStatus = '';
			model.googleStatus = '';
			model.msReturn = '';
			model.googleReturn = '';
			model.msSecret = false;
			model.googleSecret = false;
			function error(text) {
				exports.set('error', text || '');
			}
			function render() {

				var ms = data.oauth.microsoft || {};
				SET('providers.ms', { clientId: ms.clientId, tenant: ms.tenant, clientSecret: '' });
				exports.set('msReturn', ms.returnUri || '');
				var parts = [];
				parts.push(
					ms.ready
						? TRANSLATE('@(Ready: people can sign in with Microsoft.)')
						: TRANSLATE('@(Not set up: add the application ID and the secret.)')
				);
				if (ms.secretSet)
					parts.push(TRANSLATE('@(A secret is saved.)'));
				exports.set('msStatus', parts.join(' '));
				exports.set('msSecret', !!ms.secretSet);
				var g = data.oauth.google || {},
					gparts = [];
				SET('providers.google', { clientId: g.clientId || '', clientSecret: '' });
				exports.set('googleReturn', g.returnUri || '');
				gparts.push(
					g.ready
						? TRANSLATE('@(Ready: people can sign in with Google.)')
						: TRANSLATE('@(Not set up: add the client ID and the secret.)')
				);
				if (g.secretSet)
					gparts.push(TRANSLATE('@(A secret is saved.)'));
				exports.set('googleStatus', gparts.join(' '));
				exports.set('googleSecret', !!g.secretSet);
				SET(
					'providers.items',
					data.types.map((t) => ({
						id: t.id,
						name: TRANSLATE(t.name),
						custom: t.custom,
						canHide: !t.locked,
						canDefault: !t.isDefault && !t.hidden,
						toggleLabel: TRANSLATE(t.hidden ? '@(Show)' : '@(Hide)'),
						defaultLabel: t.isDefault ? TRANSLATE('@(Default)') : '',
						hiddenLabel: t.hidden ? TRANSLATE('@(Hidden)') : '',
						customLabel: t.custom ? TRANSLATE('@(Added here)') : ''
					}))
				);
			}
			async function call(schema, payload) {

				if (busy)
					return null;
				busy = true;
				error('');
				try {
					data = await mailbox.api(schema, payload);
					render();
					// New accounts offer the types as configured here.
					PLUGINS.accounts.reloadtypes && PLUGINS.accounts.reloadtypes();
					return data;
				} catch (e) {
					error(e.message);
					return null;
				} finally {
					busy = false;
				}
			}
			async function open() {
				if (state.user.role !== 'admin')
					return;
				try {
					data = await mailbox.api('instance_get');
					render();
					SET('providers.type', blank());
					exports.set('heading', TRANSLATE('@(Add an account type)'));
					error('');
					SET('mail.window', 'providers');
				} catch (e) {
					mailbox.notify(e.message);
				}
			}
			function hiddenids(except, add) {

				var ids = data.types.filter((t) => t.hidden && t.id !== except).map((t) => t.id);
				if (add)
					ids.push(add);
				return ids.join(',');
			}
			exports.set('', model);
			exports.open = open;
			exports.saveoauth = () =>
				call('instance_oauth', {
					provider: 'microsoft',
					clientId: GET('providers.ms.clientId').trim(),
					tenant: GET('providers.ms.tenant').trim(),
					clientSecret: GET('providers.ms.clientSecret')
				});
			exports.clearsecret = () =>
				call('instance_oauth', {
					provider: 'microsoft',
					clientId: GET('providers.ms.clientId').trim(),
					tenant: GET('providers.ms.tenant').trim(),
					clearSecret: true
				});
			exports.savegoogle = () =>
				call('instance_oauth', {
					provider: 'google',
					clientId: GET('providers.google.clientId').trim(),
					clientSecret: GET('providers.google.clientSecret')
				});
			exports.cleargoogle = () =>
				call('instance_oauth', { provider: 'google', clientId: GET('providers.google.clientId').trim(), clearSecret: true });
			exports.toggle = (element) => {
				var id = element[0].dataset.id,
					type = data.types.find((t) => t.id === id);
				return call('instance_prefs', {
					hidden: hiddenids(type.hidden ? id : '', type.hidden ? '' : id),
					defaultProvider: type.isDefault ? '' : data.defaultProvider === 'other' ? '' : data.defaultProvider
				});
			};
			exports.makedefault = (element) => call('instance_prefs', { hidden: hiddenids(), defaultProvider: element[0].dataset.id });
			exports.edit = (element) => {

				var type = data.types.find((t) => t.id === element[0].dataset.id);
				if (!type)
					return;
				SET('providers.type', {
					id: type.id,
					name: type.name,
					domains: type.domains,
					imapHost: type.imapHost,
					imapPort: type.imapPort,
					imapSecurity: type.imapSecurity,
					smtpHost: type.smtpHost,
					smtpPort: type.smtpPort,
					smtpSecurity: type.smtpSecurity,
					auth: type.auth,
					summary: type.summary || '',
					steps: type.steps,
					note: type.note || ''
				});
				exports.set('heading', TRANSLATE('@(Edit account type)'));
			};
			exports.newtype = () => {

				SET('providers.type', blank());
				exports.set('heading', TRANSLATE('@(Add an account type)'));
				error('');
			};
			exports.remove = async (element) => {
				if (await call('instance_type_delete', { id: element[0].dataset.id }))
					exports.newtype();
			};
			exports.savetype = async () => {

				var payload = {};
				// `id` has no input: it belongs to the type being edited.
				for (var field of Object.keys(blank()))
					payload[field] = field === 'id' ? GET('providers.type.id') || '' : GET('providers.type.' + field);
				payload.imapPort = Number(payload.imapPort);
				payload.smtpPort = Number(payload.smtpPort);
				if (await call('instance_type', payload)) {
					exports.newtype();
					mailbox.notify(TRANSLATE('@(Account type saved.)'));
				}
			};
			// The return address of a provider (data-field is msReturn or googleReturn).
			exports.copy = async (element) => {
				try {
					await navigator.clipboard.writeText(exports.get(element?.[0]?.dataset.field || 'msReturn') || '');
					mailbox.notify(TRANSLATE('@(Link copied.)'));
				} catch {}
			};
		}
	);
});
