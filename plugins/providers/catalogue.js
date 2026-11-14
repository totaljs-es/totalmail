// The catalogue of mail providers (the ones that ship in the plugins and the ones the administrator added). Used as
// PLUGINS.providers.catalogue.
// Mail provider catalogue. Each provider is a JSON file in plugins/<name>/providers/; copying a file adds a provider.
// Files are validated on load: an invalid file is skipped, never half-applied.
var Dns = Total.Dns.promises,
	Fs = Total.Fs,
	Path = Total.Path,
	Discovery = require('../accounts/discovery');

var auth = ['password', 'app-password', 'oauth2'];

function text(value, max) {
	if (typeof value !== 'string' || !value || value.length > max)
		throw Error('Invalid text');
	return value;
}

function server(value) {

	var port = Number((value && value.port));
	if (!Number.isInteger(port) || port < 1 || port > 65535 || !['tls', 'starttls'].includes(value.security))
		throw Error('Invalid server');
	return {
		host: Discovery.host(value.host),
		port,
		security: value.security
	};
}

function steps(list) {
	return (list || []).slice(0, 8).map(function(step) {

		var item = { text: text(step.text, 300) };
		if (step.url) {
			var url = new URL(step.url);
			if (url.protocol !== 'https:' || url.username || url.password)
				throw Error('Invalid link');
			item.url = url.href;
		}
		return item;
	});
}

function validate(raw) {

	if (!/^[a-z0-9-]{2,30}$/.test((raw && raw.id) || '') || !auth.includes(raw.auth))
		throw Error('Invalid provider');
	var provider = {
		id: raw.id,
		order: Number.isInteger(raw.order) ? raw.order : 100,
		name: text(raw.name, 80),
		icon: /^[a-z0-9-]{1,30}$/.test(raw.icon || '') ? raw.icon : 'envelope',
		auth: raw.auth,
		summary: raw.summary ? text(raw.summary, 200) : '',
		note: raw.note ? text(raw.note, 300) : '',
		discover: raw.discover === true,
		available: raw.available !== false,
		username: raw.username === 'email' ? 'email' : '',
		domains: (raw.domains || []).map(function(d) { return text(d, 253).toLowerCase(); }),
		mx: (raw.mx || []).map(function(d) { return text(d, 253).toLowerCase(); }),
		steps: steps(raw.steps),
		// Shown instead of the steps while an OAuth provider is not configured on this server.
		setup: steps(raw.setup),
		// OAuth providers: the text of the sign-in button, a line about the return address, and whether an administrator can approve for a whole organization.
		signin: raw.signin ? text(raw.signin, 60) : '',
		redirectNote: raw.redirectNote ? text(raw.redirectNote, 300) : '',
		adminConsent: raw.adminConsent === true
	};
	// Personal Outlook.com / Hotmail mailboxes use another outgoing server than work or school ones.
	if (raw.personal)
		provider.personal = {
			domains: (raw.personal.domains || []).map(function(d) { return text(d, 253).toLowerCase(); }),
			smtp: server(raw.personal.smtp)
		};
	if (raw.imap)
		provider.imap = server(raw.imap);
	if (raw.smtp)
		provider.smtp = server(raw.smtp);
	if (!provider.discover && (!provider.imap || !provider.smtp))
		throw Error('Servers required');
	return provider;
}

function load(root) {

	var list = [];
	for (var items = Array.from(Fs.existsSync(root) ? Fs.readdirSync(root) : []), j = 0; j < items.length; j++) {
		var plugin = items[j];
		var dir = Path.join(root, plugin, 'providers');
		if (!Fs.existsSync(dir))
			continue;
		for (var arr = Fs.readdirSync(dir).filter(function(name) { return name.endsWith('.json'); }), i = 0; i < arr.length; i++) {
			var file = arr[i];
			try {
				var provider = validate(JSON.parse(Fs.readFileSync(Path.join(dir, file), 'utf8')));
				if (!list.some(function(p) { return p.id === provider.id; }))
					list.push(provider);
			} catch (err) {
				if (typeof Total !== 'undefined')
					Total.error(err, 'TotalMail provider ' + file);
			}
		}
	}
	return list.sort(function(a, b) { return a.order - b.order || a.name.localeCompare(b.name); });
}

// `instance` (optional) supplies what the administrator of this installation added or changed:
// { providers(), hidden(), defaultProvider() }. Account types added there can use passwords only.
exports.create = function(root, resolvemx = Dns.resolveMx, instance = null) {

	var shipped = load(root);
	function added() {

		var list = [];
		for (var arr = Array.from((instance && instance.providers()) || []), i = 0; i < arr.length; i++) {
			var raw = arr[i];
			try {
				var provider = validate(raw);
				if (['password', 'app-password'].includes(provider.auth) && !shipped.some(function(s) { return s.id === provider.id; })) {
					provider.custom = true;
					list.push(provider);
				}
			} catch {}
		}
		return list;
	}
	function all() {
		return Array.from(shipped).concat(Array.from(added())).sort(function(a, b) { return a.order - b.order || a.name.localeCompare(b.name); });
	}
	function visible() {
		var hidden = (instance && instance.hidden()) || [];
		return all().filter(function(p) { return p.id === 'other' || !hidden.includes(p.id); });
	}
	function defaultid() {
		var id = (instance && instance.defaultProvider()) || '';
		return visible().some(function(p) { return p.id === id; }) ? id : 'other';
	}
	function match(domain) {
		return visible().find(function(p) { return p.domains.includes(domain); });
	}
	return {
		// What new accounts can choose from.
		list: function() { return structuredClone(visible().map(function(p) { return Object.assign({}, p, { isDefault: p.id === defaultid() }); })); },
		// Every type, including hidden ones: existing accounts keep theirs.
		all: function() { return structuredClone(all()); },
		defaultId: defaultid,
		get: function(id) { return all().find(function(p) { return p.id === id; }); },
		// Only the domain is looked up (published DNS). Returns a provider id, or '' when nothing is recognised.
		async detect(email) {

			var domain = String(email || '')
				.split('@')[1];
			domain = domain && domain.trim().toLowerCase().replace(/\.$/, '');
			if (!domain || domain.length > 253)
				return '';
			var known = match(domain);
			if (known)
				return known.id;
			var timer;
			try {
				var records = await Promise.race([
					resolvemx(domain),
					new Promise(function(resolve, reject) {
						timer = setTimeout(function() { return reject(Error('timeout')); }, 2500);
					})
				]);
				for (var list = Array.from(records), i = 0; i < list.length; i++) {
					var record = list[i];
					var exchange = String(record.exchange || '')
						.toLowerCase()
						.replace(/\.$/, '');
					var found = visible().find(function(p) { return p.mx.some(function(suffix) { return exchange === suffix.replace(/^\./, '') || exchange.endsWith(suffix); }); }
					);
					if (found)
						return found.id;
				}
			} catch {
			} finally {
				clearTimeout(timer);
			}
			return '';
		}
	};
};

// Servers for one mailbox of a provider: the provider's own, or the personal-account variant for its domains.
exports.serversFor = function(provider, email) {
	var domain = String(email || '')
		.split('@')[1];
	domain = domain && domain.toLowerCase();
	return {
		imap: provider.imap,
		smtp: (provider.personal && provider.personal.domains.includes(domain)) ? provider.personal.smtp : provider.smtp
	};
};

exports.validate = validate;
exports.load = load;

// ---- The singleton of the application (PLUGINS.providers.catalogue)
var Lazy = require('../../modules/lazy'),
	Lib = exports;

exports.install = function() {
	Object.assign(
		exports,
		Lib.create(
			PATH.plugins(),
			Total.Dns.promises.resolveMx,
			Lazy(function() { return MODS.instance; })
		)
	);
};

