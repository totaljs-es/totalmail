PLUGIN('accounts', function(exports) {

	// What the window shows besides the form: it exists from the start, so the views can bind to it before the page is ready.
	function initialui() {
		return {
			known: false,
			appPassword: false,
			oauth: false,
			linkBlock: false,
			redirectUrl: '',
			redirectNote: '',
			startLabel: '',
			startIcon: 'ti ti-microsoft',
			linkButton: false,
			linkResult: false,
			linkUrl: '',
			start: false,
			again: false,
			signin: false,
			blocked: false,
			saving: false,
			verifying: false,
			diagnosing: false,
			// The account in the form has been saved: only then can it be verified or synced.
			saved: false,
			discovering: false,
			suggestion: false,
			suggestionText: '',
			discoveryStatus: TRANSLATE('@(Discovery uses only your domain. No password is sent.)'),
			oauthNote: false,
			assistant: true,
			assistantShown: false
		};
	}
	exports.set('ui', initialui());
	exports.set('error', '');
	WAIT(
		function() {
			return !!PLUGINS.mail?.store;
		},
		function() {

			var mailbox = PLUGINS.mail;
			var state = mailbox.store;
			var mail = mailbox.model;
			var accounts = {};
			accounts.form = {
				authType: 'password',
				id: '',
				name: '',
				email: '',
				imapHost: '',
				imapPort: 993,
				imapSecurity: 'tls',
				imapUsername: '',
				smtpHost: '',
				smtpPort: 465,
				smtpSecurity: 'tls',
				smtpUsername: '',
				password: '',
				signature: '',
				aliases: ''
			};
			mail.authOptions = [
				{
					id: 'password',
					name: TRANSLATE('@(Password)')
				},
				{
					id: 'oauth2',
					name: 'OAuth 2.0'
				}
			];
			mail.securityOptions = [
				{
					id: 'tls',
					name: 'TLS'
				},
				{
					id: 'starttls',
					name: 'STARTTLS'
				}
			];
			mail.setupOptions = [];
			// What the window shows besides the form. The view binds to accounts.ui and accounts.error; ui() changes some of it.
			accounts.error = '';
			// The result of the step-by-step check of the account, as the view draws it.
			accounts.diagnosis = null;
			accounts.ui = initialui();
			exports.busy = false;
			var discoverygeneration = 0,
				providers = [],
				selected = 'other',
				editing = null,
				defaultid = 'other',
				suggested = '',
				detecttimer = 0;
			function ui(patch) {
				exports.set('ui', Object.assign({}, exports.get('ui'), patch));
			}
			function error(text) {
				exports.set('error', text || '');
			}
			function provider(id) {
				return providers.find((p) => p.id === id);
			}
			async function loadproviders() {
				if (!providers.length) {
					var result = await mailbox.api('account_providers');
					providers = result.providers;
					defaultid = result.defaultProvider || 'other';
				}
			}
			function renderproviders() {

				SET(
					'accounts.providers',
					providers.map((p) => ({ id: p.id, icon: p.icon, name: TRANSLATE(p.name), active: p.id === selected }))
				);
				var p = provider(selected);
				SET('accounts.guide', {
					shown: !!p,
					summary: p ? TRANSLATE(p.summary) : '',
					note: p && p.note ? TRANSLATE(p.note) : '',
					steps: (p?.steps || []).map((s) => ({ text: TRANSLATE(s.text), url: s.url || '' }))
				});
			}
			// The type of an account can be chosen when it is created and changed later. An OAuth type needs a sign-in
			// until the account holds a grant; once it does, Save and Verify are available and Sign in again renews it.
			function setmode() {
				var p = provider(selected),
					known = !!p && !p.discover,
					oauth = !!p && p.auth === 'oauth2',
					granted = !!editing?.oauth,
					signin = oauth && p.available !== false && !granted;
				ui({
					known,
					appPassword: !!(p && p.auth === 'app-password'),
					oauth,
					linkBlock: oauth && p.available !== false,
					redirectUrl: (oauth && p.redirectUri) || '',
					// Each provider says what its button says, what to register, and whether an organization can approve it for everyone.
					redirectNote: (oauth && p.redirectNote && TRANSLATE(p.redirectNote)) || '',
					startLabel: (oauth && p.signin && TRANSLATE(p.signin)) || TRANSLATE('@(Sign in with Microsoft)'),
					startIcon: 'ti ti-' + ((oauth && p.icon) || 'microsoft'),
					linkButton: !!(oauth && p.adminConsent),
					linkResult: oauth && p.adminConsent ? exports.get('ui').linkResult : false,
					start: signin,
					again: oauth && p.available !== false && granted,
					signin,
					blocked: oauth && p.available === false && !granted
				});
			}
			// Which type an existing account corresponds to: its OAuth provider, or the catalogue entry with its servers.
			function guess(a) {

				if (!a)
					return providers.some((p) => p.id === defaultid) ? defaultid : 'other';
				if (a.oauth?.provider && provider(a.oauth.provider))
					return a.oauth.provider;
				return providers.find((p) => !p.discover && p.imap?.host === a.imap?.host)?.id || 'other';
			}
			function applyprovider(id) {

				var before = provider(selected);
				selected = id;
				var p = provider(id),
					email = GET('accounts.form.email').trim();
				ui({ suggestion: false });
				suggested = '';
				if (p && !p.discover)
					SET('accounts.form', {
						...accounts.form,
						authType: p.auth === 'oauth2' ? 'oauth2' : 'password',
						imapHost: p.imap.host,
						imapPort: p.imap.port,
						imapSecurity: p.imap.security,
						imapUsername: p.username === 'email' ? email : '',
						smtpHost: p.smtp.host,
						smtpPort: p.smtp.port,
						smtpSecurity: p.smtp.security,
						smtpUsername: p.username === 'email' ? email : '',
						email,
						name: GET('accounts.form.name'),
						id: editing ? editing.id : '',
						password: GET('accounts.form.password')
					});
				else if (p)
					if (before && !before.discover)
						// Back to discovery: servers that came from another provider must not linger.
						SET('accounts.form', {
							...accounts.form,
							authType: 'password',
							imapHost: '',
							imapPort: 993,
							imapSecurity: 'tls',
							imapUsername: '',
							smtpHost: '',
							smtpPort: 465,
							smtpSecurity: 'tls',
							smtpUsername: '',
							email,
							name: GET('accounts.form.name'),
							id: editing ? editing.id : '',
							password: GET('accounts.form.password')
						});
					else
						SET('accounts.form.authType', 'password');

				renderproviders();
				setmode();
			}
			async function detectprovider() {

				var email = GET('accounts.form.email').trim();
				if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email))
					return;
				var p = provider(selected);
				if (p && !p.discover) {
					// A chosen provider keeps its servers; only the sign-in name follows the address.
					if (p.username === 'email') {
						SET('accounts.form.imapUsername', email);
						SET('accounts.form.smtpUsername', email);
					}
					return;
				}
				try {
					var found = (await mailbox.api('account_detect', { email })).provider;
					if (GET('accounts.form.email').trim() !== email || selected !== 'other')
						return;
					var match = provider(found);
					suggested = match && !match.discover ? match.id : '';
					ui({
						suggestion: !!suggested,
						suggestionText: suggested
							? TRANSLATE('@(This address looks like it is hosted by {0}.)').format(match.name)
							: exports.get('ui').suggestionText
					});
				} catch (e) {}
			}
			function refreshaccountoptions() {
				SET(
					'mail.accountOptions',
					state.accounts.map((a) => ({
						id: a.id,
						name: a.name + ' · ' + a.email
					}))
				);
				SET(
					'mail.setupOptions',
					[{ id: '', name: TRANSLATE('@(New account)') }].concat(
						state.accounts
							.filter((a) => a.configured)
							.map((a) => ({
								id: a.id,
								name: a.name + ' · ' + a.email
							}))
					)
				);
			}
			function accountmodel(id) {

				var a = state.accounts.find((a) => a.id === id && a.configured);
				SET(
					'accounts.form',
					a
						? {
							authType: a.authType || 'password',
							id: a.id,
							name: a.name,
							email: a.email,
							imapHost: a.imap.host,
							imapPort: a.imap.port,
							imapSecurity: a.imap.security,
							imapUsername: a.imap.username,
							smtpHost: a.smtp.host,
							smtpPort: a.smtp.port,
							smtpSecurity: a.smtp.security,
							smtpUsername: a.smtp.username,
							password: '',
							signature: a.signature || '',
							aliases: (a.aliases || []).join(', ')
						}
						: {
							authType: 'password',
							id: '',
							name: '',
							email: '',
							imapHost: '',
							imapPort: 993,
							imapSecurity: 'tls',
							imapUsername: '',
							smtpHost: '',
							smtpPort: 465,
							smtpSecurity: 'tls',
							smtpUsername: '',
							password: '',
							signature: '',
							aliases: ''
						}
				);
				discoverygeneration++;
				setassistant(a ? a.assistant !== false : true);
				editing = a || null;
				selected = guess(a);
				if (providers.length) {
					renderproviders();
					setmode();
					// The administrator may have made another type the default for new accounts.
					if (!a && selected !== 'other')
						applyprovider(selected);
				}
				ui({ discoveryStatus: TRANSLATE('@(Discovery uses only your domain. No password is sent.)'), oauthNote: false });
				error('');
			}
			async function openaccountsetup() {

				try {
					await loadproviders();
				} catch (e) {
					mailbox.notify(e.message);
				}
				accountmodel('');
				SET('mail.window', 'account-setup');
			}
			async function discoveraccount() {

				if (exports.busy)
					return;
				exports.busy = true;
				var generation = ++discoverygeneration,
					email = GET('accounts.form.email').trim();
				ui({ discovering: true, discoveryStatus: TRANSLATE('@(Looking for your mail servers…)') });
				error('');
				try {
					var data = await mailbox.api('account_discover', {
						email
					});
					if (
						generation !== discoverygeneration ||
						mail.window !== 'account-setup' ||
						GET('accounts.form.email').trim() !== email
					)
						return;
					var model = {
						...accounts.form,
						authType: data.oauth ? 'oauth2' : 'password',
						email,
						name: GET('accounts.form.name') || email,
						imapHost: data.imap.host,
						imapPort: data.imap.port,
						imapSecurity: data.imap.security,
						imapUsername: data.imap.username,
						smtpHost: data.smtp.host,
						smtpPort: data.smtp.port,
						smtpSecurity: data.smtp.security,
						smtpUsername: data.smtp.username,
						password: GET('accounts.form.password')
					};
					SET('accounts.form', model);
					ui({
						discoveryStatus: TRANSLATE(
							data.detected
								? '@(Server settings found. Review them before saving.)'
								: '@(No published settings found. These suggestions need manual review.)'
						),
						oauthNote: !!data.oauth
					});
				} catch (e) {
					if (generation === discoverygeneration)
						error(e.message);
				} finally {
					exports.busy = false;
					ui({ discovering: false });
				}
			}
			// Sends the person to the provider's sign-in page; the callback creates or renews the account.
			async function startoauth(again) {

				if (exports.busy)
					return;
				var email = GET('accounts.form.email').trim(),
					id = editing ? editing.id : '',
					p = provider(selected);
				error('');
				if (!email || !p) {
					error(TRANSLATE('@(Enter your email address to sign in.)'));
					return;
				}
				exports.busy = true;
				try {
					var result = await mailbox.api('account_oauth_start', {
						provider: p.id,
						email,
						name: GET('accounts.form.name').trim(),
						accountId: id
					});
					location.assign(result.url);
				} catch (e) {
					error(e.message);
					exports.busy = false;
				}
			}
			async function saveaccount() {

				if (exports.busy)
					return;
				exports.busy = true;
				ui({ saving: true });
				error('');
				try {
					var model = {};
					for (var field of Object.keys(accounts.form))
						model[field] = GET('accounts.form.' + field);
					model.imapPort = Number(model.imapPort);
					model.smtpPort = Number(model.smtpPort);
					model.assistant = exports.get('ui').assistant;
					var account = await mailbox.api('account_save', model);
					var index = state.accounts.findIndex((a) => a.id === account.id);
					if (index < 0)
						state.accounts.push(account);
					else
						state.accounts[index] = account;
					var bootstrap = await mailbox.api('bootstrap');
					Object.assign(state, bootstrap);
					refreshaccountoptions();
					mailbox.refresh();
					SET('accounts.form.password', '');
					SET('accounts.form.id', account.id);
					// The saved account is now the one being edited.
					editing = state.accounts.find((a) => a.id === account.id) || null;
					selected = guess(editing);
					renderproviders();
					setmode();
					mailbox.notify(TRANSLATE('@(Account saved. Verify the connection to start reading.)'));
				} catch (e) {
					error(e.message);
				} finally {
					exports.busy = false;
					ui({ saving: false });
				}
			}
			// Whether the assistant may be used with this account's mail; only shown once the administrator turned it on.
			function setassistant(on) {
				ui({ assistant: on, assistantShown: !!state.ai?.configured });
			}
			exports.toggleassistant = function() {
				ui({ assistant: !exports.get('ui').assistant });
			};
			exports.adminlink = async function() {

				var email = GET('accounts.form.email').trim();
				error('');
				if (!email) {
					error(TRANSLATE('@(Enter your email address to sign in.)'));
					return;
				}
				try {
					var result = await mailbox.api('account_oauth_admin', { provider: selected, email });
					ui({ linkUrl: result.url, linkResult: true });
				} catch (e) {
					error(e.message);
				}
			};
			// The return address or the approval link (data-field is redirectUrl or linkUrl).
			exports.copylink = async function(element) {
				try {
					await navigator.clipboard.writeText(exports.get('ui')[element[0].dataset.field || 'linkUrl'] || '');
					mailbox.notify(TRANSLATE('@(Link copied.)'));
				} catch {}
			};
			exports.oauth = (element) => startoauth(element[0].dataset.again === '1');
			exports.pick = (element) => applyprovider(element[0].dataset.provider);
			// The administrator changed the account types: fetch them again the next time the window opens.
			exports.reloadtypes = () => {
				providers = [];
			};
			exports.suggest = () => suggested && applyprovider(suggested);
			exports.set('', accounts);
			exports.refresh = refreshaccountoptions;
			exports.open = openaccountsetup;
			// Support: the connection of the saved account, checked step by step, with what to do about each problem.
			var sections = {
				incoming: '@(Incoming mail, IMAP)',
				outgoing: '@(Outgoing mail, SMTP)',
				domain: '@(The domain of the address)'
			};
			var statuses = {
				ok: ['ti ti-check', '@(Fine)'],
				warn: ['ti ti-exclamation-triangle', '@(Warning)'],
				fail: ['ti ti-times-circle', '@(Problem)'],
				skip: ['ti ti-minus', '@(Not checked)']
			};
			exports.diagnose = async () => {

				var id = GET('accounts.form.id');
				if (!id || exports.get('ui').diagnosing)
					return;
				ui({ diagnosing: true });
				error('');
				SET('accounts.diagnosis', null);
				mailbox.say(TRANSLATE('@(Checking the connection step by step…)'));
				try {
					var report = await mailbox.api('account_diagnose', { accountId: id });
					SET('accounts.diagnosis', {
						summary: report.failed
							? TRANSLATE('@(Found {0} problems.)').format(report.failed)
							: report.warned
								? TRANSLATE('@(Everything works. {0} things could be better.)').format(report.warned)
								: TRANSLATE('@(Everything checked is fine.)'),
						groups: Object.keys(sections)
							.map((key) => ({
								title: TRANSLATE(sections[key]),
								items: report.checks
									.filter((c) => c.section === key)
									.map((c) => ({
										icon: statuses[c.status][0],
										label: TRANSLATE(statuses[c.status][1]),
										status: c.status,
										title: c.title,
										advice: c.advice
									}))
							}))
							.filter((group) => group.items.length)
					});
					mailbox.say(TRANSLATE('@(The check is ready.)'));
				} catch (e) {
					error(e.message);
				} finally {
					ui({ diagnosing: false });
				}
			};
			exports.discover = discoveraccount;
			exports.save = saveaccount;
			// Removing an account takes it, its cached mail and its drafts out of TotalMail; the mail server keeps its mailbox.
			exports.remove = async function() {

				var id = GET('accounts.form.id');
				if (exports.busy || !id)
					return;
				if (!window.confirm(TRANSLATE('@(Remove this account from TotalMail? Its saved mail and drafts are removed here. The mailbox on your mail server is not touched.)')))
					return;
				exports.busy = true;
				error('');
				try {
					await mailbox.api('account_delete', { id });
					Object.assign(state, await mailbox.api('bootstrap'));
					refreshaccountoptions();
					mailbox.refresh();
					SET('mail.window', '');
					mailbox.notify(TRANSLATE('@(Account removed.)'));
				} catch (e) {
					error(e.message);
				} finally {
					exports.busy = false;
				}
			};
			// A change of the id (the account chosen in the list) loads that account into the form.
			WATCH('accounts.form.id', (value, flags) => {

				SET('accounts.diagnosis', null);
				ui({ saved: !!value });
				SET('mail.ui.accountSaved', !!value);
				if (!exports.busy && flags.modified)
					accountmodel(value);
			});
			// Once the address is typed, the provider is looked up (the model follows the keyboard: every input has $delay:1).
			WATCH('accounts.form.email', () => {

				clearTimeout(detecttimer);
				ui({ suggestion: false });
				detecttimer = setTimeout(detectprovider, 700);
			});
			exports.ui = ui;
			exports.error = error;
		}
	);
});
