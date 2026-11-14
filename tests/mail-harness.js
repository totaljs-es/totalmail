// The browser side of the mail window (plugins/mail/public/mail.js) run in Node: the real files, in the order of views/index.html,
// against a small stand-in for jComponent (a tree for SET and GET, WATCH, timers that a test moves by hand) and an API that
// answers what the test says. It checks what the window does (the lists it draws, the calls it makes), not how it draws.
var Fs = require('node:fs'),
	Path = require('node:path'),
	Vm = require('node:vm');
var root = Path.join(__dirname, '..');
var order = [
	'plugins/mail/public/threads.js',
	'plugins/mail/public/contacts.js',
	'plugins/mail/public/quote.js',
	'plugins/mail/public/format.js',
	'plugins/mail/public/display.js',
	'plugins/mail/public/undo.js',
	'plugins/mail/public/notify.js',
	'plugins/mail/public/selection.js',
	'plugins/mail/public/composer.js',
	'plugins/mail/public/query.js',
	'plugins/mail/public/mail.js'
];

function walk(tree, path, create) {

	var parts = path ? path.split('.') : [];
	var node = tree;
	for (var i = 0; i < parts.length; i++) {
		if (node == null)
			return undefined;
		if (create && (node[parts[i]] == null || typeof node[parts[i]] !== 'object') )
			node[parts[i]] = {};
		node = node[parts[i]];
	}
	return node;
}

// options.api = { schema: (data) => answer }: what the server says. A schema nobody listed answers {}.
exports.create = async function(options) {

	options = options || {};
	var calls = [], toasts = [], setters = [], timers = [], watchers = {}, store = {}, plugins = {}, storage = {}, pending = [];
	var handlers = Object.assign({}, options.api);
	var clock = 0;
	var sandbox = {
		console,
		URL,
		URLSearchParams,
		File,
		Date,
		Promise,
		TRANSLATE: function(text) { return String(text).replace(/^@\(([\s\S]*)\)$/, '$1'); },
		DEF: { languageitems: [] },
		document: {
			documentElement: { lang: options.lang || 'en' },
			querySelector: () => null,
			querySelectorAll: () => [],
			getElementById: () => null,
			addEventListener() {},
			hidden: false
		},
		window: {},
		location: { href: 'http://localhost/', search: '', pathname: '/', assign() {} },
		history: { replaceState() {} },
		navigator: {},
		localStorage: {
			getItem: (key) => (key in storage ? storage[key] : null),
			setItem: (key, value) => (storage[key] = String(value)),
			removeItem: (key) => delete storage[key]
		},
		setTimeout: function(fn, ms) {
			timers.push({ id: ++clock, fn, ms: ms || 0 });
			return clock;
		},
		clearTimeout: function(id) { timers = timers.filter((t) => t.id !== id); },
		setInterval() { return 0; },
		clearInterval() {},
		ON() {},
		UPD() {},
		CHANGE() {},
		COMPILE() {},
		COMPONENT() {},
		FIND: () => [],
		SETTER: function() { setters.push(Array.from(arguments)); },
		GET: (path) => walk(store, path),
		SET: function(path, value) {

			var parts = path.split('.'),
				last = parts.pop();
			var parent = parts.length ? walk(store, parts.join('.'), true) : store;
			parent[last] = value;
			for (var list = Array.from(watchers[path] || []), i = 0; i < list.length; i++)
				list[i](value, path);
		},
		WATCH: function(path, fn) { (watchers[path] = watchers[path] || []).push(fn); },
		WAIT: function(condition, fn) {
			if (condition())
				fn();
			else
				pending.push([condition, fn]);
		},
		PLUGIN: function(name, fn) {

			var exports = {
				set: (path, value) => sandbox.SET(path ? name + '.' + path : name, value),
				get: (path) => sandbox.GET(path ? name + '.' + path : name),
				inc() {}
			};
			plugins[name] = exports;
			fn(exports);
		},
		PLUGINS: new Proxy({
			accounts: { refresh() {}, open() {}, ui() {}, error() {}, busy: false },
			users: { open() {} },
			ai: { refresh() {} }
		}, {
			get: (target, key) => (key in target ? target[key] : new Proxy(function() {}, { get: () => function() {}, apply: () => undefined }))
		}),
		totalmailrequest: {
			api: async function(schema, data) {

				calls.push({ schema, data: JSON.parse(JSON.stringify(data === undefined ? null : data)) });
				var handler = handlers[schema];
				var answer = typeof handler === 'function' ? await handler(data) : handler === undefined ? {} : handler;
				if (answer instanceof Error)
					throw answer;
				// The answer is made inside the page, as the browser makes it from JSON: its arrays have the methods of jComponent.
				return inside.parse(JSON.stringify(answer === undefined ? {} : answer));
			},
			upload: async function() { return {}; }
		}
	};
	// The toast is a notify component: the tests read what it was given.
	var context = Vm.createContext(sandbox);
	var inside = Vm.runInContext('JSON', context);
	sandbox.SETTER = function() {
		var args = Array.from(arguments);
		setters.push(args);
		if (args[0] === 'notify/info')
			toasts.push(args[1]);
	};
	// What jComponent adds to the language.
	Vm.runInContext(
		'String.prototype.format = function() { var a = arguments; return this.replace(/\\{(\\d+)\\}/g, function(m, i) { return a[i]; }); };' +
		'Array.prototype.findItem = function(key, value) { return this.find(function(x) { return x && x[key] === value; }); };',
		context
	);
	for (var i = 0; i < order.length; i++)
		Vm.runInContext(Fs.readFileSync(Path.join(root, order[i]), 'utf8'), context, { filename: order[i] });

	var harness = {
		calls,
		toasts,
		setters,
		storage,
		plugin: plugins.mail,
		mail: () => store.mail,
		// Values the window holds, as plain data (they were made inside the page, with its own Array and Object).
		plain: (value) => JSON.parse(JSON.stringify(value === undefined ? null : value)),
		get: sandbox.GET,
		set: sandbox.SET,
		// What the server will answer to a schema from now on.
		answer: (schema, value) => (handlers[schema] = value),
		called: (schema) => calls.filter((c) => c.schema === schema),
		// Lets every promise that is waiting move on.
		async settle() {
			for (var n = 0; n < 8; n++)
				await new Promise((resolve) => setImmediate(resolve));
		},
		// Runs the timers (the delay before a draft is saved, the retries) once, in order.
		async flush() {

			var run = timers;
			timers = [];
			for (var t of run)
				t.fn();
			await harness.settle();
		},
		// A click on an element of the window: <button data-command="compose"> and the like.
		async click(data, event) {
			await plugins.mail.click([{ dataset: data, disabled: false }], event);
			await harness.settle();
		}
	};
	await harness.settle();
	for (var p of pending.splice(0))
		if (p[0]())
			p[1]();
	await harness.settle();
	return harness;
};
