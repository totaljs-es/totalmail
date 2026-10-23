const Aliases = require('../../../lib/aliases'),
	Discovery = require('../../../lib/discovery');

var running = new Map();

NEWACTION('Accounts|discover', {
	user: true,
	route: '+API /api/ +account_discover --> Accounts|discover',
	input: '*email:Email',
	action: ($, model) =>
		FUNC.run($, async () => {

			if (running.has($.user.id))
				throw Error('@(Discovery is already running.)');
			running.set($.user.id, true);
			try {
				return await Discovery.discover(model.email.toLowerCase());
			} finally {
				running.delete($.user.id);
			}
		})
});

NEWACTION('Accounts|save', {
	user: true,
	route: '+API /api/ +account_save --> Accounts|save',
	input: 'id:String(80), *name:String(80), *email:Email, *imapHost:String(253), *imapPort:Number, *imapSecurity:{tls|starttls}, *imapUsername:String(254), *smtpHost:String(253), *smtpPort:Number, *smtpSecurity:{tls|starttls}, *smtpUsername:String(254), authType:{password|oauth2}, password:String(500), signature:String(1000), aliases:String(1500), assistant:Boolean',
	action: ($, model) =>
		FUNC.run($, () => {

			for (var port of [model.imapPort, model.smtpPort])
				if (!Number.isInteger(port) || port < 1 || port > 65535)
					throw Error('@(Enter a port between 1 and 65535.)');
			var account = {
				id: model.id || '',
				name: model.name.trim(),
				email: model.email.toLowerCase(),
				initials: model.name
					.trim()
					.split(/\s+/)
					.map((x) => x[0])
					.slice(0, 2)
					.join('')
					.toUpperCase(),
				color: '#4285F4',
				configured: true,
				status: 'pending',
				authType: model.authType || 'password',
				imap: {
					host: Discovery.host(model.imapHost),
					port: model.imapPort,
					security: model.imapSecurity,
					username: model.imapUsername
				},
				smtp: {
					host: Discovery.host(model.smtpHost),
					port: model.smtpPort,
					security: model.smtpSecurity,
					username: model.smtpUsername
				}
			};
			// Left out when the request does not mention it, so an update from elsewhere keeps the saved signature.
			// (the schema fills a missing text with '', so the request itself tells whether it was sent)
			if (Object.prototype.hasOwnProperty.call($.body && typeof $.body === 'object' ? $.body.data || $.body : {}, 'signature'))
				account.signature = String(model.signature)
					.replace(/\r\n?/g, '\n')
					.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
					.trim();
			// Same for the aliases: only a request that mentions them changes them.
			if (Object.prototype.hasOwnProperty.call($.body && typeof $.body === 'object' ? $.body.data || $.body : {}, 'aliases')) {
				var parsed = Aliases.parse(model.aliases, account.email);
				if (parsed.error)
					throw Error('@(Other addresses must be plain email addresses, ten at most, separated by commas.)');
				account.aliases = parsed.list;
			}
			// Same for the assistant switch.
			if (Object.prototype.hasOwnProperty.call($.body && typeof $.body === 'object' ? $.body.data || $.body : {}, 'assistant'))
				account.assistant = model.assistant === true;
			// A generated ID is new; only explicit IDs can update a user's existing account.
			var store = MODS.users.forUser($.user);
			if (!model.id)
				account.newId = UID();
			if (account.authType === 'oauth2')
				account.secret = null;
			else if (model.password)
				account.secret = MODS.security.identities.encrypt(model.password);
			return store.saveAccount(account);
		})
});

// A person removes one of their own accounts: it leaves TotalMail with its cached mail and drafts. The mailbox on the mail
// server is never touched.
NEWACTION('Accounts|delete', {
	user: true,
	route: '+API /api/ +account_delete --> Accounts|delete',
	input: '*id:String(80)',
	action: ($, model) =>
		FUNC.run($, async () => {

			var removed = await MODS.users.forUser($.user).deleteAccount(model.id);
			for (var file of removed.files)
				await MODS.users.files($.user).remove($.user.id, file);
			return { id: removed.id };
		})
});

NEWACTION('Accounts|providers', {
	user: true,
	route: '+API /api/ -account_providers --> Accounts|providers',
	action: ($) => {
		// OAuth providers are usable only when this server has an application registered for them.
		var list = MODS.providers.list().map((p) => {

			if (p.auth !== 'oauth2')
				return p;
			var ready = MODS.oauth.configured(p.id);
			// The exact return address this server sends, to compare with the one registered at the provider.
			return {
				...p,
				available: ready,
				steps: ready ? p.steps : p.setup,
				note: ready ? '' : p.note,
				redirectUri: MODS.oauth.redirectUri($.controller || $, p.id)
			};
		});
		$.callback({ providers: list, defaultProvider: MODS.providers.defaultId() });
	}
});

NEWACTION('Accounts|detect', {
	user: true,
	route: '+API /api/ +account_detect --> Accounts|detect',
	input: '*email:Email',
	action: ($, model) => FUNC.run($, async () => ({ provider: await MODS.providers.detect(model.email) }))
});

NEWACTION('Accounts|adminlink', {
	user: true,
	route: '+API /api/ +account_oauth_admin --> Accounts|adminlink',
	input: '*provider:String(30), *email:Email',
	action: ($, model) =>
		FUNC.run($, async () => {

			var provider = MODS.providers.get(model.provider);
			if (!provider || provider.auth !== 'oauth2')
				throw Error('@(Invalid operation.)');
			return {
				url: MODS.oauth.adminConsentUrl(
					provider.id,
					model.email.split('@')[1],
					MODS.oauth.redirectUri($.controller || $, provider.id)
				)
			};
		})
});

NEWACTION('Accounts|oauth', {
	user: true,
	route: '+API /api/ +account_oauth_start --> Accounts|oauth',
	input: '*provider:String(30), *email:Email, name:String(80), accountId:String(80)',
	action: ($, model) =>
		FUNC.run($, async () => {

			var provider = MODS.providers.get(model.provider);
			if (!provider || provider.auth !== 'oauth2')
				throw Error('@(Invalid operation.)');
			if (model.accountId) {
				var existing = MODS.users.forUser($.user).account(model.accountId);
				if (existing.email !== model.email.toLowerCase())
					throw Error('@(That account does not match the email address of this account.)');
			}
			return {
				url: MODS.oauth.start({
					userId: $.user.id,
					provider: provider.id,
					email: model.email,
					name: (model.name || '').trim() || model.email,
					accountId: model.accountId,
					redirectUri: MODS.oauth.redirectUri($.controller || $, provider.id)
				})
			};
		})
});
