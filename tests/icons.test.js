const { test } = require('node:test'),
	assert = require('node:assert/strict'),
	fs = require('node:fs'),
	path = require('node:path');
const root = path.join(__dirname, '..');
// The icons of the Total.js icon font that the page loads (cdn.componentator.com/spa.min@20.css), one name per line without "ti-".
// Refresh the list when the CDN version changes: every `.ti-name` rule of that stylesheet.
const exists = new Set(
	fs
		.readFileSync(path.join(__dirname, 'fixtures', 'icons.txt'), 'utf8')
		.split('\n')
		.filter(Boolean)
);
function walk(dir, found = []) {
	for (let entry of fs.readdirSync(dir, { withFileTypes: true })) {
		if (['node_modules', '.git', 'tests', 'docs', 'database', 'vendor'].includes(entry.name))
			continue;
		let file = path.join(dir, entry.name);
		if (entry.isDirectory())
			walk(file, found);
		else if (/\.(html|js|css|json)$/.test(entry.name) && !/\.min\.js$/.test(entry.name))
			found.push(file);
	}
	return found;
}
test('every icon the pages use exists in the icon font', () => {
	let missing = [];
	for (let file of walk(root)) {
		let text = fs.readFileSync(file, 'utf8'),
			lines = text.split('\n');
		for (let index = 0; index < lines.length; index++) {
			let line = lines[index];
			// "ti ti-name" in markup and strings, and the names given to components (licon:user, icon: 'server').
			let names = [...line.matchAll(/\bti ti-([a-z0-9][a-z0-9-]*)/g)].map((m) => m[1]);
			for (let m of line.matchAll(/\b(?:licon|ricon):\s*([a-z][a-z0-9-]*)/g))
				names.push(m[1]);
			for (let name of names)
				if (!exists.has(name))
					missing.push(path.relative(root, file) + ':' + (index + 1) + ' ti-' + name);
		}
	}
	assert.deepEqual(missing, [], 'icons that do not exist:\n' + missing.join('\n'));
});
test('the icons the sign-in providers choose exist too', () => {
	let missing = [];
	for (let name of fs.readdirSync(path.join(root, 'plugins/accounts/providers')).filter((n) => n.endsWith('.json'))) {
		let provider = JSON.parse(fs.readFileSync(path.join(root, 'plugins/accounts/providers', name), 'utf8'));
		if (provider.icon && !exists.has(provider.icon))
			missing.push(name + ' ti-' + provider.icon);
	}
	assert.deepEqual(missing, []);
});
