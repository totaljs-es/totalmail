function overview() {
	return MODS.instance.aiView();
}

NEWACTION('Assistant|get', {
	name: 'Read the settings of the assistant',
	user: true,
	permissions: 'admin',
	route: '+API /api/ -assistant_get --> Assistant|get',
	action: function($) { return FUNC.run($, overview); }
});

NEWACTION('Assistant|save', {
	name: 'Save the settings of the assistant',
	user: true,
	permissions: 'admin',
	route: '+API /api/ +assistant_save --> Assistant|save',
	input: 'enabled:Boolean, provider:{openai|anthropic}, endpoint:String(300), model:String(120), key:String(500), clearKey:Boolean, maxChars:Number',
	action: function($, model) {
		return FUNC.run($, async function() {

			var provider = model.provider || 'openai',
				endpoint = (model.endpoint || '').trim(),
				name = (model.model || '').trim();
				// Claude has one address; leaving it empty means the official one.
			if (!endpoint && provider === 'anthropic')
				endpoint = PLUGINS.ai.assistant.defaults.anthropic;
			if (endpoint)
				endpoint = PLUGINS.ai.assistant.parseendpoint(endpoint).url;
			if (model.enabled === true && (!endpoint || !name))
				throw Error('@(Enter the server address and the model before turning the assistant on.)');
			var key = (model.key || '').trim();
			// The saved key counts only for the server it was saved with.
			if (model.enabled === true && provider === 'anthropic' && !key && (!MODS.instance.keyFor(provider, endpoint) || model.clearKey === true))
				throw Error('@(Claude needs a key.)');
			var limit = Math.round(Number(model.maxChars) || PLUGINS.ai.assistant.defaults.maxChars);
			if (limit < 2000 || limit > 60000)
				throw Error('@(Enter a limit between 2000 and 60000 characters.)');
			await MODS.instance.saveAi({
				enabled: model.enabled === true,
				provider,
				endpoint,
				model: name,
				key,
				clearKey: model.clearKey === true,
				maxChars: limit
			});
			return overview();
		});
	}
});

// The knowledge base: collections of documents the assistant may read. Administrators only.
NEWACTION('Assistant|knowledge', {
	name: 'Read the knowledge base',
	user: true,
	permissions: 'admin',
	route: '+API /api/ -assistant_knowledge --> Assistant|knowledge',
	action: function($) { return FUNC.run($, function() { return Object.assign({}, PLUGINS.ai.knowledge.view(), { accept: PLUGINS.ai.extract.supported }); }); }
});

NEWACTION('Assistant|collection', {
	name: 'Add a collection of documents',
	user: true,
	permissions: 'admin',
	route: '+API /api/ +assistant_collection --> Assistant|collection',
	input: 'id:String(40), *name:String(80), description:String(200), localonly:Boolean',
	action: function($, model) {
		return FUNC.run($, async function() {
			await PLUGINS.ai.knowledge.saveCollection({
				id: model.id || '',
				name: model.name,
				description: model.description || '',
				localonly: model.localonly === true
			});
			return PLUGINS.ai.knowledge.view();
		});
	}
});

NEWACTION('Assistant|collection_delete', {
	name: 'Delete a collection of documents',
	user: true,
	permissions: 'admin',
	route: '+API /api/ +assistant_collection_delete --> Assistant|collection_delete',
	input: '*id:String(40)',
	action: function($, model) {
		return FUNC.run($, async function() {
			await PLUGINS.ai.knowledge.removeCollection(model.id);
			return PLUGINS.ai.knowledge.view();
		});
	}
});

NEWACTION('Assistant|document_delete', {
	name: 'Delete a document',
	user: true,
	permissions: 'admin',
	route: '+API /api/ +assistant_document_delete --> Assistant|document_delete',
	input: '*id:String(40)',
	action: function($, model) {
		return FUNC.run($, async function() {
			await PLUGINS.ai.knowledge.removeDocument(model.id);
			return PLUGINS.ai.knowledge.view();
		});
	}
});

// A short question to the model with the values on screen, before they are saved.
NEWACTION('Assistant|test', {
	name: 'Test the connection of the assistant',
	user: true,
	permissions: 'admin',
	route: '+API /api/ +assistant_test --> Assistant|test',
	input: 'provider:{openai|anthropic}, endpoint:String(300), *model:String(120), key:String(500)',
	action: function($, model) {
		return FUNC.run($, async function() {

			var provider = model.provider || 'openai';
			var target = PLUGINS.ai.assistant.parseendpoint(model.endpoint || (provider === 'anthropic' ? PLUGINS.ai.assistant.defaults.anthropic : ''));
			var started = Date.now(),
				settings = { provider, endpoint: target.url, model: model.model.trim(), key: (model.key || '').trim() || MODS.instance.keyFor(provider, target.url) };
			try {
				var text = await PLUGINS.ai.assistant.complete(settings, [{ role: 'user', content: 'Reply with the single word: ready' }], {
					maxTokens: 64,
					timeout: 60
				});
				return { ok: true, ms: Date.now() - started, scope: target.scope, host: target.host, sample: text.slice(0, 80) };
			} catch (err) {
				// The administrator sees the server's own reason: it is what tells a wrong model from a wrong key.
				var wrapped = Error(
					TRANSLATE($.language, err.message) +
							(err.detail ? ' (' + String(err.detail).replace(/\s+/g, ' ').slice(0, 200) + ')' : '')
				);
				wrapped.plain = true;
				throw wrapped;
			}
		});
	}
});

// The tasks every signed-in person can run. The conversation comes from the person's own mailbox, never from the request.
NEWACTION('Assistant|run', {
	name: 'Run a task of the assistant',
	user: true,
	route: '+API /api/ +assistant_run --> Assistant|run',
	input: '*task:{summarize|translate|reply|tone|proofread|compose}, id:String(80), accountId:String(80), instruction:String(500), style:{clearer|shorter|formal|friendly}, lang:{en|es|sk|cs|de|fr|it|pt|pl|el}, text:String(20000), knowledge:Boolean',
	action: function($, m) {
		FUNC.run(
			$,
			async function() {

				var settings = MODS.instance.ai();
				if (!PLUGINS.ai.assistant.status(settings).configured)
					throw Error('@(The assistant is not turned on.)');
				var store = PLUGINS.mail.mailboxes.forUser($.user),
					data = store.snapshot(),
					hidden = false;
				var input = {
					language: PLUGINS.ai.assistant.languagename($.language),
					instruction: (m.instruction || '').replace(/[\r\n]+/g, ' ').trim(),
					style: m.style,
					target: m.lang || $.language,
					text: m.text || ''
				};
				// The model reads what a person reads: never the plain part of a message that also has HTML, never what a reader cannot see.
				var visible = function(message) {

					var read = PLUGINS.ai.assistant.readable(store.message(message.id));
					hidden = hidden || read.hidden;
					return read.text;
				};
				var owner, message;
				if (m.task === 'compose') {
					// A new message from the person's own few words: no message is read at all.
					var asked = PLUGINS.ai.assistant.unhide(input.instruction);
					input.instruction = asked.text;
					if (!input.instruction.trim())
						throw Error('@(Write something first.)');
					owner = data.accounts.find(function(a) { return a.id === m.accountId; });
					if (!owner)
						throw Error('@(Invalid account.)');
				} else if (['tone', 'proofread'].includes(m.task) || (m.task === 'translate' && !m.id)) {
					var own = PLUGINS.ai.assistant.unhide(input.text);
					input.text = own.text;
					hidden = hidden || own.hidden;
					if (!input.text.trim())
						throw Error('@(Write something first.)');
					owner = data.accounts.find(function(a) { return a.id === m.accountId; });
					if (!owner)
						throw Error('@(Invalid account.)');
				} else {
					message = data.messages.find(function(x) { return x.id === m.id; });
					if (!message || message.welcome)
						throw Error('@(Message not found.)');
					if (message.remote && !message.bodyLoaded)
						throw Error('@(Open the message first so it can be read.)');
					owner = data.accounts.find(function(a) { return a.id === message.accountId; });
					// A translation is of the message that is open; a summary or a reply, of its conversation.
					input.context =
						m.task === 'translate'
							? PLUGINS.ai.assistant.excerpt(message, settings.maxChars, visible)
							: PLUGINS.ai.assistant.context(data.messages, message.id, settings.maxChars, visible);
					input.other = String(message.sender || message.email || '').replace(/[\r\n]+/g, ' ');
				}
				if ((owner && owner.assistant) === false)
					throw Error('@(The assistant is turned off for this account.)');
				input.me = String((owner && owner.name) || (owner && owner.email) || '').replace(/[\r\n]+/g, ' ');
				var sources = [],
					release = PLUGINS.ai.assistant.guard($.user.id);
				try {
					// A reply from the knowledge base: the passages related to the message are found first and handed to the model.
					if (m.task === 'reply' && m.knowledge === true) {
						var found = PLUGINS.ai.knowledge.search(PLUGINS.ai.knowledge.query(message.subject, visible(message)), {
							external: PLUGINS.ai.assistant.status(settings).scope === 'external'
						});
						if (!found.results.length)
							throw Error(
								found.skipped.length
									? '@(Nothing matches, and collections that are local only are not read by a model outside your network.)'
									: '@(Nothing in the knowledge base matches this message.)'
							);
						input.sources = PLUGINS.ai.knowledge.block(found.results, PLUGINS.ai.assistant.wrap);
						sources = found.results.map(function(p) { return { document: p.document, section: p.section, collection: p.collection }; });
					}
					var vetted = PLUGINS.ai.assistant.vet(
						PLUGINS.ai.assistant.tidy(m.task, await PLUGINS.ai.assistant.complete(settings, PLUGINS.ai.assistant.build(m.task, input))),
						[input.context, input.text, input.instruction, input.sources].join('\n')
					);
					MODS.instance.countAi(m.task).catch(function() {});
					var warnings = [];
					if (hidden)
						warnings.push('hidden');
					if (vetted.removed)
						warnings.push('links');
					return { task: m.task, text: vetted.text, sources, warnings };
				} finally {
					release();
				}
			},
			'@(The assistant could not answer.)'
		);
	}
});
