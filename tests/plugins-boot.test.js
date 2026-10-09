const { test } = require('node:test');
const Assert = require('node:assert/strict');
const Fs = require('node:fs'),
	Path = require('node:path'),
	Vm = require('node:vm');
const root = Path.join(__dirname, '..');
const files = [
	'plugins/mail/public/a11y.js',
	'plugins/mail/public/behaviors.js',
	'plugins/mail/public/threads.js',
	'plugins/mail/public/contacts.js',
	'plugins/mail/public/mail.js',
	'plugins/accounts/public/accounts.js',
	'plugins/users/public/users.js',
	'plugins/folders/public/folders.js',
	'plugins/providers/public/providers.js',
	'plugins/ai/public/ai.js',
	'plugins/rules/public/rules.js',
	'plugins/devices/public/devices.js',
	'plugins/reception/public/reception.js',
	'plugins/access/public/access.js'
];
// A value that accepts any property access or call, so browser globals can be faked without a DOM.
function dummy() {
	var d = new Proxy(function() {}, {
		get(target, key) {
			if (key === 'then')
				return undefined;
			if (key === Symbol.toPrimitive)
				return () => '';
			if (key === 'length')
				return 0;
			return d;
		},
		apply: () => d,
		construct: () => d,
		set: () => true,
		has: () => true
	});
	return d;
}
// Syntax checks cannot see a plugin that throws while it starts (a mistyped arrow, an unknown variable): the browser then
// shows no accounts and no mail. Running each plugin's startup against fake globals catches that.
// `const`, not `var`: each test body runs later and must see its own file.
for (const file of files)
	test('the browser plugin starts without errors: ' + file, () => {
		var D = dummy(),
			errors = [],
			exportsStub = { set() {}, get() {}, inc() {} };
		var sandbox = {
			PLUGIN: (name, fn) => fn(exportsStub),
			WAIT: (condition, callback) => {
				try {
					callback();
				} catch (error) {
					errors.push(error.message);
				}
			},
			PLUGINS: new Proxy({}, { get: () => D }),
			document: D,
			window: D,
			MutationObserver: D,
			localStorage: D,
			location: D,
			navigator: D,
			history: D,
			fetch: D,
			SET: D,
			GET: D,
			WATCH: D,
			SETTER: D,
			LOCALIZE: D,
			COMPONENT: D,
			DEF: D,
			$: D,
			UPD: D,
			CHANGE: D,
			COMPILE: D,
			TRANSLATE: String,
			URLSearchParams,
			console,
			setInterval() {},
			clearInterval() {},
			setTimeout() {},
			clearTimeout() {},
			initialsetup: false
		};
		Vm.runInNewContext(Fs.readFileSync(Path.join(root, file), 'utf8'), sandbox, { filename: file });
		Assert.deepEqual(errors, []);
	});
