// Only administrators configure an installation. Every call checks the session owner and the request headers.
function overview($) {
	var catalogue = MODS.providers,
		hidden = MODS.instance.hidden(),
		defaultid = catalogue.defaultId();
	var oauth = {};
	for (var provider of catalogue.all().filter((p) => p.auth === 'oauth2')) {
		var own = MODS.instance.view().oauth[provider.id] || {};
		oauth[provider.id] = {
			name: provider.name,
			clientId: own.clientId || '',
			tenant: own.tenant || '',
			secretSet: !!own.secretSet,
			effectiveTenant: MODS.oauth.settings(provider.id).tenant,
			ready: MODS.oauth.configured(provider.id),
			returnUri: MODS.oauth.redirectUri($.controller || $, provider.id)
		};
	}
	return {
		oauth,
		defaultProvider: defaultid,
		types: catalogue.all().map((p) => ({
			id: p.id,
			name: p.name,
			custom: !!p.custom,
			auth: p.auth,
			hidden: p.id !== 'other' && hidden.includes(p.id),
			locked: p.id === 'other',
			isDefault: p.id === defaultid,
			summary: p.summary,
			note: p.note,
			domains: p.domains.join(', '),
			steps: p.steps.map((s) => (s.url ? s.text + ' | ' + s.url : s.text)).join('\n'),
			imapHost: p.imap?.host || '',
			imapPort: p.imap?.port || 993,
			imapSecurity: p.imap?.security || 'tls',
			smtpHost: p.smtp?.host || '',
			smtpPort: p.smtp?.port || 465,
			smtpSecurity: p.smtp?.security || 'tls'
		}))
	};
}
function slug(name) {
	return (
		String(name)
			.toLowerCase()
			.normalize('NFD')
			.replace(/[̀-ͯ]/g, '')
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '')
			.slice(0, 20) || 'custom'
	);
}
// One line per step: "text" or "text | https://link".
function steps(text) {
	return String(text || '')
		.split('\n')
		.map((line) => line.trim())
		.filter(Boolean)
		.slice(0, 8)
		.map((line) => {
			var [first, ...rest] = line.split('|');
			var link = rest.join('|').trim();
			return link ? { text: first.trim(), url: link } : { text: first.trim() };
		});
}
NEWACTION('Instance|get', {
	user: true,
	permissions: 'admin',
	route: '+API /api/ -instance_get --> Instance|get',
	action: ($) => FUNC.run($, () => overview($))
});
NEWACTION('Instance|oauth', {
	user: true,
	permissions: 'admin',
	route: '+API /api/ +instance_oauth --> Instance|oauth',
	input: '*provider:String(30), clientId:String(120), clientSecret:String(500), clearSecret:Boolean, tenant:String(40)',
	action: ($, model) =>
		FUNC.run($, async () => {
			if (!MODS.providers.all().some((p) => p.id === model.provider && p.auth === 'oauth2'))
				throw Error('@(Invalid operation.)');
			await MODS.instance.saveOAuth(model.provider, {
				clientId: (model.clientId || '').trim(),
				clientSecret: (model.clientSecret || '').trim(),
				clearSecret: model.clearSecret === true,
				tenant: (model.tenant || '').trim()
			});
			return overview($);
		})
});
NEWACTION('Instance|type', {
	user: true,
	permissions: 'admin',
	route: '+API /api/ +instance_type --> Instance|type',
	input: 'id:String(30), *name:String(80), summary:String(200), note:String(300), domains:String(1000), *imapHost:String(253), *imapPort:Number, *imapSecurity:{tls|starttls}, *smtpHost:String(253), *smtpPort:Number, *smtpSecurity:{tls|starttls}, auth:{password|app-password}, steps:String(2000)',
	action: ($, model) =>
		FUNC.run($, async () => {
			var catalogue = MODS.providers,
				existing = model.id ? catalogue.get(model.id) : null;
			if (model.id && !existing?.custom)
				throw Error('@(Account type not found.)');
			var id = model.id;
			if (!id) {
				id = slug(model.name);
				while (catalogue.get(id))
					id = slug(model.name).slice(0, 15) + '-' + Total.Crypto.randomBytes(2).toString('hex');
			}
			var raw = {
				id,
				order: 200,
				name: model.name.trim(),
				icon: 'server',
				auth: model.auth || 'password',
				summary: (model.summary || '').trim(),
				note: (model.note || '').trim(),
				username: 'email',
				domains: String(model.domains || '')
					.split(/[\s,;]+/)
					.filter(Boolean),
				imap: { host: model.imapHost.trim(), port: model.imapPort, security: model.imapSecurity },
				smtp: { host: model.smtpHost.trim(), port: model.smtpPort, security: model.smtpSecurity },
				steps: steps(model.steps)
			};
			for (var key of ['summary', 'note'])
				if (!raw[key])
					delete raw[key];
			try {
				MODS.providers.validate(raw);
			} catch {
				throw Error('@(Check the account type: name, servers, ports and https links.)');
			}
			await MODS.instance.saveProvider(raw);
			return overview($);
		})
});
NEWACTION('Instance|type_delete', {
	user: true,
	permissions: 'admin',
	route: '+API /api/ +instance_type_delete --> Instance|type_delete',
	input: '*id:String(30)',
	action: ($, model) =>
		FUNC.run($, async () => {
			if (!MODS.providers.get(model.id)?.custom)
				throw Error('@(Account type not found.)');
			await MODS.instance.deleteProvider(model.id);
			return overview($);
		})
});
NEWACTION('Instance|prefs', {
	user: true,
	permissions: 'admin',
	route: '+API /api/ +instance_prefs --> Instance|prefs',
	input: 'hidden:String(1000), defaultProvider:String(30)',
	action: ($, model) =>
		FUNC.run($, async () => {
			var known = MODS.providers.all().map((p) => p.id);
			var hidden = String(model.hidden || '')
				.split(/[\s,;]+/)
				.filter(Boolean);
			if (hidden.some((id) => id === 'other' || !known.includes(id)))
				throw Error('@(Account type not found.)');
			var chosen = model.defaultProvider || '';
			if (chosen && (!known.includes(chosen) || hidden.includes(chosen)))
				throw Error('@(Account type not found.)');
			await MODS.instance.savePrefs({ hidden, defaultProvider: chosen });
			return overview($);
		})
});
