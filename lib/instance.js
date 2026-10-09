// Settings that belong to one TotalMail installation (not to the shared code): the sign-in application of each
// OAuth provider, the account types the administrator added, which shipped ones are hidden and the default type.
// Kept in the instance_* tables of the NoSQL database, with the client secret encrypted like every other credential.
const Mirror = require('./mirror');
var tenantpattern = /^(common|organizations|consumers|[0-9a-f-]{36})$/i;
var defaults = { providers: [], oauth: {}, hidden: [], defaultProvider: '', ai: {}, aiUsage: {} };
exports.spec = (table) => ({
	table,
	prefix: 'instance',
	clean: true,
	lists: ['providers'],
	values: ['oauth', 'hidden', 'defaultProvider', 'ai', 'aiUsage']
});
// The store, opened on a database: options = { table, crypto, legacy: { file } } (the file an earlier version kept).
exports.open = async function(options) {
	return exports.create(options.crypto, await Mirror.open(exports.spec(options.table), { seed: defaults, legacy: options.legacy }));
};
// storage = { state, mirror } as Mirror.open() returns it.
exports.create = function(crypto, storage) {
	var state = { ...defaults, ...structuredClone(storage.state) };
	var queue = Promise.resolve();
	function update(mutate) {
		var result = queue.then(async () => {
			var next = structuredClone(state);
			var value = mutate(next);
			await storage.mirror.save(next);
			state = next;
			return structuredClone(value);
		});
		queue = result.catch(() => {});
		return result;
	}
	return {
		// Internal use only: includes the decrypted secret.
		oauth(provider) {
			var item = state.oauth[provider];
			if (!item)
				return {};
			var secret = '';
			try {
				if (item.secret)
					secret = crypto.decrypt(item.secret);
			} catch {}
			return { clientId: item.clientId || '', tenant: item.tenant || '', clientSecret: secret };
		},
		// What the administrator's window may see: whether a secret exists, never the secret.
		view() {
			var oauth = {};
			for (var [provider, item] of Object.entries(state.oauth))
				oauth[provider] = { clientId: item.clientId || '', tenant: item.tenant || '', secretSet: !!item.secret };
			return structuredClone({ oauth, providers: state.providers, hidden: state.hidden, defaultProvider: state.defaultProvider });
		},
		// Internal use only: includes the decrypted key.
		ai() {
			var item = state.ai || {},
				key = '';
			try {
				if (item.key)
					key = crypto.decrypt(item.key);
			} catch {}
			return {
				enabled: item.enabled === true,
				provider: item.provider === 'anthropic' ? 'anthropic' : 'openai',
				endpoint: item.endpoint || '',
				model: item.model || '',
				key,
				maxChars: item.maxChars || 12000
			};
		},
		// What the administrator's window may see: whether a key exists, never the key.
		aiView() {
			var item = state.ai || {},
				total = 0,
				tasks = {};
			for (var day of Object.values(state.aiUsage || {}))
				for (var [task, count] of Object.entries(day)) {
					total += count;
					tasks[task] = (tasks[task] || 0) + count;
				}
			return {
				enabled: item.enabled === true,
				provider: item.provider === 'anthropic' ? 'anthropic' : 'openai',
				endpoint: item.endpoint || '',
				model: item.model || '',
				keySet: !!item.key,
				maxChars: item.maxChars || 12000,
				usage: { total, tasks }
			};
		},
		saveAi: ({
			enabled = false,
			provider = 'openai',
			endpoint = '',
			model = '',
			key = '',
			clearKey: clearkey = false,
			maxChars: maxchars = 12000
		}) =>
			update((next) => {
				var current = next.ai || {};
				var item = {
					enabled: enabled === true,
					provider: provider === 'anthropic' ? 'anthropic' : 'openai',
					endpoint,
					model,
					maxChars: maxchars,
					key: current.key || null
				};
				if (clearkey)
					item.key = null;
				else if (key)
					item.key = crypto.encrypt(key);
				next.ai = item;
				return {};
			}),
		// Only how many times each task ran on each day, never what was in it; sixty days are kept.
		countAi: (task, now = new Date()) =>
			update((next) => {
				var usage = next.aiUsage || {},
					day = now.toISOString().slice(0, 10);
				usage[day] = usage[day] || {};
				usage[day][task] = (usage[day][task] || 0) + 1;
				for (var old of Object.keys(usage)
					.sort()
					.slice(0, Math.max(0, Object.keys(usage).length - 60)))
					delete usage[old];
				next.aiUsage = usage;
				return {};
			}),
		providers: () => structuredClone(state.providers),
		hidden: () => [...state.hidden],
		defaultProvider: () => state.defaultProvider,
		saveOAuth: (
			provider,
			{ clientId: clientid = '', clientSecret: clientsecret = '', clearSecret: clearsecret = false, tenant = '' }
		) =>
			update((next) => {
				var meta = require('./oauth').meta(provider);
				if (!meta)
					throw Error('@(Invalid operation.)');
				if (clientid && !meta.valid.test(clientid))
					throw Error(
						provider === 'google'
							? '@(The client ID is a code like 123456789012-abc123.apps.googleusercontent.com.)'
							: '@(The application ID is a code like 00000000-0000-0000-0000-000000000000.)'
					);
				if (meta.tenant && tenant && !tenantpattern.test(tenant))
					throw Error('@(Use common, organizations, consumers or the directory ID.)');
				if (!meta.tenant)
					tenant = '';
				var current = next.oauth[provider] || {};
				var item = { clientId: clientid, tenant, secret: current.secret || null };
				if (clearsecret)
					item.secret = null;
				else if (clientsecret)
					item.secret = crypto.encrypt(clientsecret);
				next.oauth[provider] = item;
				return { provider };
			}),
		saveProvider: (raw) =>
			update((next) => {
				var index = next.providers.findIndex((p) => p.id === raw.id);
				if (index < 0)
					next.providers.push(raw);
				else
					next.providers[index] = raw;
				return { id: raw.id };
			}),
		deleteProvider: (id) =>
			update((next) => {
				if (!next.providers.some((p) => p.id === id))
					throw Error('@(Account type not found.)');
				next.providers = next.providers.filter((p) => p.id !== id);
				next.hidden = next.hidden.filter((h) => h !== id);
				if (next.defaultProvider === id)
					next.defaultProvider = '';
				return { id };
			}),
		savePrefs: ({ hidden, defaultProvider: defaultprovider }) =>
			update((next) => {
				next.hidden = [...new Set(hidden)];
				next.defaultProvider = defaultprovider || '';
				return {};
			})
	};
};
