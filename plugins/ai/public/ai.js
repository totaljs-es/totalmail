// The AI assistant. The administrator's window (settings, knowledge base), the card under a message and the box of the composer
// all show the model of this plugin: the views bind to ai.card, ai.composer, ai.library and the rest; nothing is drawn by hand.
// The card under a message and the box of the composer sit in the mail window, which is compiled before this plugin starts:
// their models exist from the moment the script is read.
var aicard = () => ({
	shown: false,
	where: '',
	knowledge: false,
	busy: false,
	working: '',
	resultShown: false,
	text: '',
	warnHidden: false,
	warnLinks: false,
	sourcesShown: false,
	sources: [],
	canReply: false
});
var aicomposer = () => ({
	shown: false,
	where: '',
	busy: false,
	working: '',
	resultShown: false,
	text: '',
	warnHidden: false,
	warnLinks: false,
	replaced: false
});
SET('ai.card', aicard());
SET('ai.composer', aicomposer());
PLUGIN('ai', function(exports) {
	// The model exists from the start: the views bind to it before the rest of the page is ready.
	var model = {};
	// What a person can translate into: the names of the languages are their own, not translated.
	var languagenames = {
		en: 'English',
		es: 'Español',
		sk: 'Slovenčina',
		cs: 'Čeština',
		de: 'Deutsch',
		fr: 'Français',
		it: 'Italiano',
		pt: 'Português',
		el: 'Ελληνικά',
		pl: 'Polski'
	};
	function remembered() {
		var saved = '';
		try {
			saved = localStorage.getItem('totalmail-translate') || '';
		} catch {}
		return languagenames[saved] ? saved : languagenames[document.documentElement.lang] ? document.documentElement.lang : 'en';
	}
	model.providerOptions = [
		{ id: 'openai', name: TRANSLATE('@(OpenAI-compatible)') },
		{ id: 'anthropic', name: 'Claude (Anthropic)' }
	];
	model.form = { provider: 'openai', endpoint: '', model: '', key: '', maxChars: 12000, cname: '' };
	model.languages = Object.keys(languagenames).map((id) => ({ id, name: languagenames[id] }));
	model.lang = remembered();
	model.instruction = '';
	// What a new message should say, in the person's own words.
	model.idea = '';
	// Administration
	model.enabled = false;
	model.keySet = false;
	model.usage = '';
	model.status = '';
	model.error = '';
	model.localonly = false;
	model.library = [];
	model.libraryStatus = '';
	// The card under a message and the box of the composer
	model.card = aicard();
	model.composer = aicomposer();
	exports.set('', model);
	WAIT(
		function() {
			return !!PLUGINS.mail?.store && !!PLUGINS.accounts;
		},
		function() {
			var mailbox = PLUGINS.mail,
				state = mailbox.store,
				data = null,
				busy = false,
				results = new Map(),
				working = false,
				library = { collections: [], accept: '' },
				before = '';
			var set = (path, value) => exports.set(path, value);
			// The box of the composer grows and shrinks: the window measures itself again, or it ends up off the screen.
			var patch = (path, values) => {
				set(path, Object.assign({}, exports.get(path), values));
				if (path === 'composer')
					mailbox.fitwindow();
			};
			// ---- Administration
			function error(text) {
				set('error', text || '');
			}
			function status(text) {
				set('status', text || '');
			}
			function renderadmin() {
				SET('ai.form', {
					provider: data.provider,
					endpoint: data.endpoint,
					model: data.model,
					key: '',
					maxChars: data.maxChars,
					cname: ''
				});
				var u = data.usage || { total: 0, tasks: {} };
				set('enabled', !!data.enabled);
				set('keySet', !!data.keySet);
				set(
					'usage',
					TRANSLATE('@(Used {count} times so far: {summarize} summaries, {reply} replies, {tone} tone adjustments.)')
						.replace('{count}', () => u.total)
						.replace('{summarize}', () => u.tasks.summarize || 0)
						.replace('{reply}', () => u.tasks.reply || 0)
						.replace('{tone}', () => u.tasks.tone || 0)
				);
			}
			function fields() {
				return {
					provider: GET('ai.form.provider') || 'openai',
					endpoint: GET('ai.form.endpoint').trim(),
					model: GET('ai.form.model').trim(),
					key: GET('ai.form.key'),
					// The field may show 12.000 or 12 000: only its digits count.
					maxChars: Number(String(GET('ai.form.maxChars')).replace(/\D/g, '')) || 12000
				};
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
			async function open() {
				if (state.user.role !== 'admin')
					return;
				try {
					data = await mailbox.api('assistant_get');
					renderadmin();
					status('');
					error('');
					SET('mail.window', 'ai');
					library = await mailbox.api('assistant_knowledge');
					drawlibrary();
				} catch (e) {
					mailbox.notify(e.message);
				}
			}
			async function save(extra) {
				var next = await call('assistant_save', { enabled: exports.get('enabled') === true, ...fields(), ...extra });
				if (next) {
					data = next;
					renderadmin();
					state.ai = (await mailbox.api('bootstrap')).ai;
					refresh();
				}
				return next;
			}
			exports.open = open;
			exports.toggle = () => set('enabled', !exports.get('enabled'));
			exports.preset = (element) => {
				SET('ai.form.provider', element[0].dataset.provider);
				SET('ai.form.endpoint', element[0].dataset.endpoint);
				status('');
			};
			exports.save = async () => {
				if (await save())
					mailbox.notify(TRANSLATE('@(Assistant settings saved.)'));
			};
			exports.clearkey = async () => {
				if (await save({ clearKey: true }))
					mailbox.notify(TRANSLATE('@(Saved key removed.)'));
			};
			// ---- The knowledge base: collections of documents, kept on this server
			function fail(text) {
				set('libraryStatus', text || '');
			}
			async function change(schema, payload) {
				var next = await call(schema, payload);
				if (next) {
					library = { ...next, accept: library.accept };
					drawlibrary();
				}
				return next;
			}
			// The list the view shows: the collections, with the texts that need translating already in place.
			function drawlibrary() {
				set(
					'library',
					library.collections.map((c) => ({
						id: c.id,
						name: c.name,
						localonly: c.localonly,
						localLabel: TRANSLATE(c.localonly ? '@(Allow outside models)' : '@(Keep local only)'),
						documents: c.documents.map((d) => ({
							id: d.id,
							title: d.title,
							label: d.title + ' · ' + TRANSLATE('@(Passages: {count})').replace('{count}', () => d.chunks)
						}))
					}))
				);
			}
			async function upload(collectionid, chosen) {
				var files = [],
					lines = [];
				// Total.js refuses a whole upload that carries a real image, so what cannot be read is set aside here, with its reason.
				var allowed = String(library.accept || '').split(',');
				for (var file of chosen)
					if (allowed.includes((file.name.match(/\.[A-Za-z0-9]+$/) || [''])[0].toLowerCase()))
						files.push(file);
					else
						lines.push(
							file.name +
								': ' +
								TRANSLATE(
									'@(This type of file is not supported yet. Supported: text, Markdown, HTML, JSON, CSV, Word, OpenDocument, PowerPoint, Excel and PDF.)'
								)
						);

				if (!files.length) {
					fail(lines.join(' '));
					return;
				}
				fail(TRANSLATE('@(Reading the documents…)'));
				var body = new FormData();
				body.append('collectionid', collectionid);
				for (var item of files)
					body.append('file', item, item.name);
				try {
					var result = await mailbox.upload('/knowledge/upload/', body);
					library = { collections: result.collections, accept: library.accept };
					drawlibrary();
					if (result.added.length)
						lines.push(TRANSLATE('@(Documents added: {count}.)').replace('{count}', () => result.added.length));
					for (var failed of result.failed)
						lines.push(failed.name + ': ' + failed.error);
					fail(lines.join(' '));
					mailbox.say(lines.join(' '));
				} catch (e) {
					fail(e.message);
				}
			}
			var collection = (element) => library.collections.find((c) => c.id === element[0].dataset.id);
			exports.adddocs = (element) => {
				var id = element[0].dataset.id;
				SETTER('filepicker/open', { accept: library.accept, multiple: true, callback: (files) => upload(id, files) });
			};
			exports.removedoc = (element) => change('assistant_document_delete', { id: element[0].dataset.id });
			exports.togglecollection = (element) => {
				var c = collection(element);
				c && change('assistant_collection', { id: c.id, name: c.name, description: c.description, localonly: !c.localonly });
			};
			exports.removecollection = (element) => {
				var c = collection(element);
				if (!c)
					return;
				if (c.documents.length && !window.confirm(TRANSLATE('@(Delete this collection and its documents?)')))
					return;
				change('assistant_collection_delete', { id: c.id });
			};
			exports.togglelocal = () => set('localonly', !exports.get('localonly'));
			exports.addcollection = async () => {
				var name = GET('ai.form.cname').trim();
				if (!name) {
					error(TRANSLATE('@(Give the collection a name.)'));
					return;
				}
				if (await change('assistant_collection', { name, description: '', localonly: exports.get('localonly') === true })) {
					SET('ai.form.cname', '');
					fail('');
				}
			};
			exports.test = async () => {
				var f = fields();
				status(TRANSLATE('@(Testing…)'));
				var result = await call('assistant_test', { provider: f.provider, endpoint: f.endpoint, model: f.model, key: f.key });
				if (!result) {
					status('');
					return;
				}
				status(
					TRANSLATE('@(The model answered in {seconds} s. It runs {where}.)')
						.replace('{seconds}', () => (result.ms / 1000).toFixed(1))
						.replace(
							'{where}',
							() =>
								TRANSLATE(result.scope === 'network' ? '@(inside your own network)' : '@(outside your own network)') +
								' (' +
								result.host +
								')'
						)
				);
			};
			// ---- What people see: a card under the message and a box in the composer
			function available() {
				return !!state.ai?.configured;
			}
			function where(draft) {
				var inside = state.ai.scope === 'network';
				return TRANSLATE(
					draft
						? inside
							? '@(The text you are writing is sent to {host}, inside your own network.)'
							: '@(The text you are writing is sent to {host}, outside your own network.)'
						: inside
							? '@(The text of this conversation is sent to {host}, inside your own network.)'
							: '@(The text of this conversation is sent to {host}, outside your own network.)'
				).replace('{host}', () => state.ai.host);
			}
			function current() {
				return state.messages.find((m) => m.id === state.selected);
			}
			function accountoff(accountid) {
				return mailbox.store.accounts.find((a) => a.id === accountid)?.assistant === false;
			}
			async function run(payload) {
				if (working)
					return null;
				working = true;
				mailbox.say(TRANSLATE('@(The assistant is working…)'));
				try {
					return await mailbox.api('assistant_run', payload);
				} catch (e) {
					mailbox.notify(e.message);
					return null;
				} finally {
					working = false;
				}
			}
			// The language picked for a translation is remembered.
			WATCH('ai.lang', (value) => {
				try {
					localStorage.setItem('totalmail-translate', value);
				} catch {}
			});
			// What the person is told besides the suggestion: the message hides text, or the model tried to add a link.
			var flags = (answer) => ({
				warnHidden: !!answer.warnings?.includes('hidden'),
				warnLinks: !!answer.warnings?.includes('links')
			});
			// ---- The card: its state follows the message that is open
			var cardkey = '';
			function showresult(key) {
				var m = current(),
					found = key && m && results.get(m.id + ':' + key);
				cardkey = found ? key : '';
				if (!found) {
					patch('card', {
						resultShown: false,
						text: '',
						sources: [],
						sourcesShown: false,
						canReply: false,
						warnHidden: false,
						warnLinks: false
					});
					return;
				}
				patch('card', {
					resultShown: true,
					text: found.text,
					...flags(found),
					sources: (found.sources || []).map((s) => [s.document, s.section].filter(Boolean).join(' — ')),
					sourcesShown: !!found.sources?.length,
					canReply: key.replace(/k$/, '') === 'reply'
				});
			}
			function drawcard() {
				var m = current();
				if (!available() || !m || m.welcome || accountoff(m.accountId)) {
					patch('card', { shown: false });
					return;
				}
				patch('card', { shown: true, where: where(), knowledge: state.ai.knowledge === true, working: '' });
				showresult(['replyk', 'reply', 'translate', 'summarize'].find((k) => results.has(m.id + ':' + k)) || null);
			}
			// task is summarize, translate, reply or replyk (a reply from the knowledge base)
			exports.go = async (element) => {
				var m = current(),
					task = element[0].dataset.task,
					withknowledge = task === 'replyk';
				if (!m)
					return;
				task = task.replace(/k$/, '');
				var key = task + (withknowledge ? 'k' : '');
				var fresh = state.messages.find((x) => x.id === m.id) || m;
				if (fresh.remote && !fresh.bodyLoaded) {
					mailbox.notify(TRANSLATE('@(Open the message first so it can be read.)'));
					return;
				}
				patch('card', { busy: true, working: TRANSLATE('@(The assistant is working…)') });
				var answer = await run({
					task,
					id: m.id,
					instruction: task === 'reply' ? exports.get('instruction') : '',
					knowledge: withknowledge,
					lang: task === 'translate' ? exports.get('lang') : undefined
				});
				patch('card', { busy: false, working: '' });
				if (answer) {
					results.set(m.id + ':' + key, answer);
					mailbox.say(TRANSLATE('@(The assistant has a suggestion.)'));
				}
				showresult(key);
			};
			exports.use = () => {
				var m = current();
				m && mailbox.replywith(m.id, exports.get('card.text'));
			};
			exports.copy = async () => {
				try {
					await navigator.clipboard.writeText(exports.get('card.text'));
					mailbox.notify(TRANSLATE('@(Copied.)'));
				} catch {}
			};
			exports.dismiss = () => {
				var m = current();
				m && results.delete(m.id + ':' + cardkey);
				showresult(null);
			};
			// ---- The composer
			// The part of the composer the person wrote: before the quoted original and before the signature.
			function mine(text) {
				var lines = text.split('\n'),
					cut = lines.length;
				for (var i = 0; i < lines.length; i++)
					if (/^-- ?$/.test(lines[i]) || /^\s*>/.test(lines[i])) {
						cut = i;
						if (/^\s*>/.test(lines[i]) && i > 0 && lines[i - 1].trim() && lines[i - 1].trim().endsWith(':'))
							cut = i - 1;
						break;
					}
				return { head: lines.slice(0, cut).join('\n'), tail: lines.slice(cut).join('\n') };
			}
			function drawcomposer() {
				var accountid = GET('mail.compose.accountId');
				if (!available() || accountoff(accountid)) {
					patch('composer', { shown: false });
					return;
				}
				patch('composer', { shown: true, where: where(true) });
			}
			// task is tone, proofread, translate or compose; a tone also carries data-style, a compose is written from ai.idea
			exports.write = async (element) => {
				var task = element[0].dataset.task,
					extra = {},
					text = '';
				if (task === 'tone')
					extra.style = element[0].dataset.style;
				if (task === 'translate')
					extra.lang = exports.get('lang');
				if (task === 'compose')
					extra.instruction = String(exports.get('idea') || '').trim();
				else {
					text = mine(GET('mail.compose.body') || '').head.trim();
					extra.text = text;
				}
				if (!(task === 'compose' ? extra.instruction : text)) {
					mailbox.notify(TRANSLATE(task === 'compose' ? '@(Write what the message should say.)' : '@(Write something first.)'));
					return;
				}
				patch('composer', { busy: true, working: TRANSLATE('@(The assistant is working…)'), resultShown: false, replaced: false });
				var answer = await run({ task, ...extra, accountId: GET('mail.compose.accountId') });
				patch('composer', { busy: false, working: '' });
				if (!answer)
					return;
				mailbox.say(TRANSLATE('@(The assistant has a suggestion.)'));
				patch('composer', { resultShown: true, text: answer.text, ...flags(answer), replaced: false });
			};
			exports.replace = () => {
				before = GET('mail.compose.body') || '';
				var again = mine(before);
				mailbox.writebody(exports.get('composer.text') + (again.tail ? '\n\n' + again.tail : ''));
				patch('composer', { replaced: true, resultShown: false });
			};
			exports.restore = () => {
				mailbox.writebody(before);
				patch('composer', { replaced: false });
			};
			exports.cdismiss = () => patch('composer', { resultShown: false, replaced: false });
			function refresh() {
				drawcard();
				drawcomposer();
			}
			exports.refresh = refresh;
			// The card follows the message that is open (the reader is set again at every selection).
			WATCH('mail.reader', () => setTimeout(drawcard, 0));
			WATCH('mail.window', (next) => {
				if (next === 'composer')
					setTimeout(drawcomposer, 0);
			});
			WATCH('mail.compose.accountId', () => setTimeout(drawcomposer, 0));
			refresh();
		}
	);
});
