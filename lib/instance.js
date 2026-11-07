// Settings that belong to one TotalMail installation (not to the shared code): the sign-in application of each
// OAuth provider, the account types the administrator added, which shipped ones are hidden and the default type.
// Kept in the instance_* tables of the NoSQL database, with the client secret encrypted like every other credential.
var Mirror = require('./mirror');
var tenantpattern = /^(common|organizations|consumers|[0-9a-f-]{36})$/i;
var defaults = { providers: [], oauth: {}, hidden: [], defaultProvider: '', ai: {}, aiUsage: {} };

exports.spec = function(table) {
	return {
		table,
		prefix: 'instance',
		clean: true,
		lists: ['providers'],
		values: ['oauth', 'hidden', 'defaultProvider', 'ai', 'aiUsage']
	};
};

// The store, opened on a database: options = { table, crypto, legacy: { file } } (the file an earlier version kept).
exports.open = async function(options) {
	return exports.create(options.crypto, await Mirror.open(exports.spec(options.table), { seed: defaults, legacy: options.legacy }));
};

// storage = { state, mirror } as Mirror.open() returns it.
exports.create = function(crypto, storage) {

	var state = Object.assign({}, defaults, structuredClone(storage.state));
	var queue = Promise.resolve();
	function update(mutate) {

		var result = queue.then(async function() {

			var next = structuredClone(state);
			var value = mutate(next);
			await storage.mirror.save(next);
			state = next;
			return structuredClone(value);
		});
		queue = result.catch(function() {});
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
			for (var list = Object.entries(state.oauth), i = 0; i < list.length; i++) {
				var provider = list[i][0],
					item = list[i][1];
				oauth[provider] = { clientId: item.clientId || '', tenant: item.tenant || '', secretSet: !!item.secret };
			}
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
			for (var arr = Object.values(state.aiUsage || {}), j = 0; j < arr.length; j++) {
				var day = arr[j];
				for (var list = Object.entries(day), i = 0; i < list.length; i++) {
					var task = list[i][0],
						count = list[i][1];
					total += count;
					tasks[task] = (tasks[task] || 0) + count;
				}
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
		saveAi: function(input) {

			var enabled = input.enabled === undefined ? false : input.enabled;
			var provider = input.provider === undefined ? 'openai' : input.provider;
			var endpoint = input.endpoint === undefined ? '' : input.endpoint;
			var model = input.model === undefined ? '' : input.model;
			var key = input.key === undefined ? '' : input.key;
			var clearkey = input.clearKey === undefined ? false : input.clearKey;
			var maxchars = input.maxChars === undefined ? 12000 : input.maxChars;

			return update(function(next) {

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
			});
		},
		// Only how many times each task ran on each day, never what was in it; sixty days are kept.
		countAi: function(task, now = new Date()) {
			return update(function(next) {

				var usage = next.aiUsage || {},
					day = now.toISOString().slice(0, 10);
				usage[day] = usage[day] || {};
				usage[day][task] = (usage[day][task] || 0) + 1;
				for (var list = Object.keys(usage)
						.sort()
						.slice(0, Math.max(0, Object.keys(usage).length - 60)), i = 0; i < list.length; i++) {
					var old = list[i];
					delete usage[old];
				}
				next.aiUsage = usage;
				return {};
			});
		},
		providers: function() { return structuredClone(state.providers); },
		hidden: function() { return Array.from(state.hidden); },
		defaultProvider: function() { return state.defaultProvider; },
		saveOAuth: function(provider, input) {

			var clientid = input.clientId === undefined ? '' : input.clientId;
			var clientsecret = input.clientSecret === undefined ? '' : input.clientSecret;
			var clearsecret = input.clearSecret === undefined ? false : input.clearSecret;
			var tenant = input.tenant === undefined ? '' : input.tenant;

			return update(function(next) {

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
			});
		},
		saveProvider: function(raw) {
			return update(function(next) {

				var index = next.providers.findIndex(function(p) { return p.id === raw.id; });
				if (index < 0)
					next.providers.push(raw);
				else
					next.providers[index] = raw;
				return { id: raw.id };
			});
		},
		deleteProvider: function(id) {
			return update(function(next) {

				if (!next.providers.some(function(p) { return p.id === id; }))
					throw Error('@(Account type not found.)');
				next.providers = next.providers.filter(function(p) { return p.id !== id; });
				next.hidden = next.hidden.filter(function(h) { return h !== id; });
				if (next.defaultProvider === id)
					next.defaultProvider = '';
				return { id };
			});
		},
		savePrefs: function(entry) {
			var hidden = entry.hidden, defaultprovider = entry.defaultProvider;
			return update(function(next) {

				next.hidden = Array.from(new Set(hidden));
				next.defaultProvider = defaultprovider || '';
				return {};
			});
		}
	};
};
