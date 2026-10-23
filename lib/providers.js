// Mail provider catalogue. Each provider is a JSON file in plugins/<name>/providers/; copying a file adds a provider.
// Files are validated on load: an invalid file is skipped, never half-applied.
const Dns = Total.Dns.promises,
	Fs = Total.Fs,
	Path = Total.Path,
	Discovery = require('./discovery');

var auth = ['password', 'app-password', 'oauth2'];

function text(value, max) {
	if (typeof value !== 'string' || !value || value.length > max)
		throw Error('Invalid text');
	return value;
}

function server(value) {

	var port = Number(value?.port);
	if (!Number.isInteger(port) || port < 1 || port > 65535 || !['tls', 'starttls'].includes(value.security))
		throw Error('Invalid server');
	return {
		host: Discovery.host(value.host),
		port,
		security: value.security
	};
}

function steps(list) {
	return (list || []).slice(0, 8).map((step) => {

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

	if (!/^[a-z0-9-]{2,30}$/.test(raw?.id || '') || !auth.includes(raw.auth))
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
		domains: (raw.domains || []).map((d) => text(d, 253).toLowerCase()),
		mx: (raw.mx || []).map((d) => text(d, 253).toLowerCase()),
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
			domains: (raw.personal.domains || []).map((d) => text(d, 253).toLowerCase()),
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
	for (var plugin of Fs.existsSync(root) ? Fs.readdirSync(root) : []) {
		var dir = Path.join(root, plugin, 'providers');
		if (!Fs.existsSync(dir))
			continue;
		for (var file of Fs.readdirSync(dir).filter((name) => name.endsWith('.json')))
			try {
				var provider = validate(JSON.parse(Fs.readFileSync(Path.join(dir, file), 'utf8')));
				if (!list.some((p) => p.id === provider.id))
					list.push(provider);
			} catch (err) {
				if (typeof Total !== 'undefined')
					Total.error(err, 'TotalMail provider ' + file);
			}
	}
	return list.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}

// `instance` (optional) supplies what the administrator of this installation added or changed:
// { providers(), hidden(), defaultProvider() }. Account types added there can use passwords only.
exports.create = function(root, resolvemx = Dns.resolveMx, instance = null) {

	var shipped = load(root);
	function added() {

		var list = [];
		for (var raw of instance?.providers() || [])
			try {
				var provider = validate(raw);
				if (['password', 'app-password'].includes(provider.auth) && !shipped.some((s) => s.id === provider.id)) {
					provider.custom = true;
					list.push(provider);
				}
			} catch {}
		return list;
	}
	function all() {
		return [...shipped, ...added()].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
	}
	function visible() {
		var hidden = instance?.hidden() || [];
		return all().filter((p) => p.id === 'other' || !hidden.includes(p.id));
	}
	function defaultid() {
		var id = instance?.defaultProvider() || '';
		return visible().some((p) => p.id === id) ? id : 'other';
	}
	function match(domain) {
		return visible().find((p) => p.domains.includes(domain));
	}
	return {
		// What new accounts can choose from.
		list: () => structuredClone(visible().map((p) => ({ ...p, isDefault: p.id === defaultid() }))),
		// Every type, including hidden ones: existing accounts keep theirs.
		all: () => structuredClone(all()),
		defaultId: defaultid,
		get: (id) => all().find((p) => p.id === id),
		// Only the domain is looked up (published DNS). Returns a provider id, or '' when nothing is recognised.
		async detect(email) {

			var domain = String(email || '')
				.split('@')[1]
				?.trim()
				.toLowerCase()
				.replace(/\.$/, '');
			if (!domain || domain.length > 253)
				return '';
			var known = match(domain);
			if (known)
				return known.id;
			var timer;
			try {
				var records = await Promise.race([
					resolvemx(domain),
					new Promise((resolve, reject) => {
						timer = setTimeout(() => reject(Error('timeout')), 2500);
					})
				]);
				for (var record of records) {
					var exchange = String(record.exchange || '')
						.toLowerCase()
						.replace(/\.$/, '');
					var found = visible().find((p) =>
						p.mx.some((suffix) => exchange === suffix.replace(/^\./, '') || exchange.endsWith(suffix))
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
		.split('@')[1]
		?.toLowerCase();
	return {
		imap: provider.imap,
		smtp: provider.personal?.domains.includes(domain) ? provider.personal.smtp : provider.smtp
	};
};

exports.validate = validate;
exports.load = load;
