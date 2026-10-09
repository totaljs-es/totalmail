const Files = require('../lib/files');
const Html = require('../lib/html');
exports.install = function() {
	ROUTE('GET /', async function($) {
		if (MODS.localization.languages.includes($.query.lang))
			$.cookie('totalmail-language', $.language, '1 year', {
				httpOnly: true,
				samesite: 'Lax'
			});
		MODS.security.headers($);
		$.response.headers['cache-control'] = 'private, no-store';
		$.response.headers['content-language'] = $.language;
		var user = await $.authorize();
		$.view(user ? 'index' : 'login', {
			localization: MODS.localization.clientResources($.language),
			languages: MODS.localization.clientLanguages(),
			setup: !MODS.security.identities.configured(),
			...MODS.appearance.resolve(user?.color)
		});
	});
	// The sanitized HTML of a message, for the sandboxed frame of the reader. Own policy, own headers: remote images
	// stay blocked unless the reader asked for them with ?images=1.
	ROUTE('+GET /html/{id}/', function($) {
		if (!/^imap-[a-f0-9]{64}$/.test($.params.id))
			return $.invalid(404);
		var message;
		try {
			message = MODS.users.forUser($.user).message($.params.id);
		} catch {
			return $.invalid(404);
		}
		if (!message.html)
			return $.invalid(404);
		var images = $.query.images === '1';
		Object.assign($.response.headers, Html.headers(images, $.protocol + '://' + $.headers.host));
		$.response.minify = false;
		$.html(Html.document(message.html, images));
	});
	// A message laid out for paper in its own tab: the details, then the cleaned HTML or the plain text. No script runs here
	// (same policy as the frame), so printing is the browser's own command.
	ROUTE('+GET /print/{id}/', function($) {
		if (!/^[A-Za-z0-9_-]{1,100}$/.test($.params.id))
			return $.invalid(404);
		var message;
		try {
			message = MODS.users.forUser($.user).message($.params.id);
		} catch {
			return $.invalid(404);
		}
		var images = $.query.images === '1';
		Object.assign($.response.headers, Html.headers(images, "'none'"));
		$.response.minify = false;
		$.view('print', {
			subject: message.subject || TRANSLATE($.language, '@(No subject)'),
			from: message.sender && message.email ? message.sender + ' <' + message.email + '>' : message.email || message.sender,
			to: (message.toRecipients || []).join(', ') || message.to,
			cc: (message.ccRecipients || []).join(', ') || message.cc,
			date: message.date ? new Date(message.date).toLocaleString($.language || 'en') : '',
			html: message.html ? Html.display(message.html, images) : '',
			text: message.body
		});
	});
	// The original message as an .eml file, straight from the server.
	ROUTE('+GET /source/{id}/', function($) {
		if (!/^imap-[a-f0-9]{64}$/.test($.params.id))
			return $.invalid(404);
		Promise.resolve()
			.then(() => MODS.live.source($.user, MODS.users.forUser($.user), $.params.id))
			.then((file) => {
				$.response.headers['cache-control'] = 'private, no-store';
				$.response.headers['x-content-type-options'] = 'nosniff';
				$.response.headers['content-security-policy'] = "default-src 'none'; sandbox";
				$.binary(file.content, 'application/octet-stream', file.name);
			})
			.catch(() => $.invalid(404));
	});
	// Attachments leave the server only as opaque downloads of the signed-in user's own messages.
	ROUTE('+GET /attachment/{id}/{index}/', function($) {
		var index = /^\d{1,4}$/.test($.params.index) ? parseInt($.params.index) : -1;
		if (!/^imap-[a-f0-9]{64}$/.test($.params.id) || index < 0)
			return $.invalid(404);
		Promise.resolve()
			.then(() => MODS.live.attachment($.user, MODS.users.forUser($.user), $.params.id, index))
			.then((file) => {
				$.response.headers['cache-control'] = 'private, no-store';
				$.response.headers['x-content-type-options'] = 'nosniff';
				$.response.headers['content-security-policy'] = "default-src 'none'; sandbox";
				$.binary(file.content, 'application/octet-stream', file.name);
			})
			.catch(() => $.invalid(404));
	});
	// Outgoing attachments: stored privately per user and linked to one of the user's own drafts.
	ROUTE('+POST /upload/{draft}/ @upload <16mb', function($) {
		var file = $.files[0],
			files = MODS.users.files($.user),
			store = MODS.users.forUser($.user);
		if (!file || $.files.length !== 1 || !file.size)
			return $.invalid('@(Choose a file to attach.)');
		if (file.size > Files.limits.file)
			return $.invalid('@(Attachments can add up to 15 MB per message.)');
		var name =
			String(file.filename || '')
				.replace(/%22|%0[ad]/gi, '_')
				.replace(/[\x00-\x1f\x7f\\\/:*?"<>|]+/g, '_')
				.trim()
				.slice(0, 120) || 'attachment';
		var saved = '';
		// The framework's temporary file can end with bytes of the next part of the upload: only the size it measured is the file.
		file.read()
			.then((content) => files.put($.user.id, content.subarray(0, file.size)))
			.then((id) => {
				saved = id;
				return store.addAttachment(
					$.params.draft.slice(0, 80),
					{
						id,
						name,
						type: Total.TUtils.contentTypes[Total.TUtils.getExtension(name)] || 'application/octet-stream',
						size: file.size
					},
					Files.limits
				);
			})
			.then((draft) => $.json(draft))
			.catch((err) => {
				if (saved)
					files.remove($.user.id, saved);
				$.invalid(err.message?.startsWith('@(') ? err.message : '@(The operation could not be completed.)');
			});
	});
	// Documents for the knowledge base: administrators only. Each file is read into text on the server and added to a
	// collection; the answer says what was added and what could not be read and why.
	ROUTE('+POST /knowledge/upload/ @upload <40mb', async function($) {
		if (UNAUTHORIZED($, 'admin'))
			return;
		if (!$.files.length || $.files.length > 10)
			return $.invalid('@(Choose between one and ten files.)');
		var result = await MODS.knowledge.importFiles(String(($.body || {}).collectionid || '').slice(0, 40), $.files, $.language);
		$.json({ ...result, ...MODS.knowledge.view() });
	});
	// Long poll: answers when an IDLE connection reports a change in one of the user's inboxes, or after about 25 seconds.
	ROUTE('+GET /changes/ <40s', function($) {
		var since = /^\d{1,12}$/.test($.query.since || '') ? parseInt($.query.since) : 0;
		MODS.changes
			.wait($.user, since, (fn) => $.req.once('close', fn))
			.then((value) => {
				$.response.headers['cache-control'] = 'private, no-store';
				$.json(value);
			})
			.catch(() => $.invalid(500));
	});
	// The provider sends the browser back here. The session cookie (SameSite=Strict) does not travel with that
	// cross-site navigation, so the one-time state created by the signed-in user identifies who this belongs to,
	// and the page then returns to the app through a same-site navigation.
	ROUTE('GET /oauth/{provider}/callback/', function($) {
		var provider = MODS.providers.get($.params.provider);
		if (!provider || provider.auth !== 'oauth2')
			return $.invalid(404);
		function done(result) {
			MODS.security.headers($);
			$.response.headers['cache-control'] = 'private, no-store';
			$.response.headers['referrer-policy'] = 'no-referrer';
			$.view('oauth', { result });
		}
		var service = MODS.oauth,
			query = $.query;
		// Return from the administrator approval link: it carries no state and no code.
		if (query.admin_consent)
			return done(query.admin_consent === 'True' ? 'approved' : 'denied');
		if (query.error) {
			service.cancel(String(query.state || ''));
			return done('denied');
		}
		service
			.finish({ state: String(query.state || ''), code: String(query.code || '') })
			.then((grant) => service.complete(provider, grant))
			.then(done)
			.catch((err) => {
				var exists = /already exists/.test(err.message || '');
				if (!exists && err.message !== 'invalid_state')
					Total.error('OAuth sign-in failed: ' + (err.oauthError || err.message), 'TotalMail');
				done(exists ? 'exists' : 'error');
			});
	});
	ROUTE('GET /health/', function($) {
		// `api` grows when an app has to know about a change: the native apps compare it with the one they were made for.
		$.json({
			status: 'ok',
			mode: 'multiuser',
			version: MODS.security.version,
			api: 1
		});
	});
};
