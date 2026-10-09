// Translations: finds every text written as @(...) in the code and the views, and checks that each language file has it.
//
//   node bin/translations.js              lists what is missing, per language
//   node bin/translations.js --add        adds the missing texts to every file (English as the text, to be translated)
//
// A key is made from the text itself (the same algorithm Total.js uses), so nothing has to be numbered. A text must not contain
// parentheses: the framework would cut it there.
const Fs = require('node:fs'),
	Path = require('node:path');
const root = Path.join(__dirname, '..');
const folders = ['views', 'plugins', 'modules', 'controllers', 'lib', 'definitions'];
exports.key = function(text) {
	var hash = 0;
	for (var i = 0; i < text.length; i++)
		hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
	return 'T' + (hash >>> 0).toString(36);
};
function walk(dir, found) {
	for (var entry of Fs.readdirSync(dir, { withFileTypes: true })) {
		if (entry.name === 'vendor' || entry.name === 'node_modules')
			continue;
		var path = Path.join(dir, entry.name);
		if (entry.isDirectory())
			walk(path, found);
		else if (/\.(html|js|json)$/.test(entry.name) && !/\.min\.js$/.test(entry.name))
			for (var match of Fs.readFileSync(path, 'utf8').matchAll(/@\(([^()]*)\)/g))
				if (match[1] !== "'")
					found.add(match[1]);
	}
}
// The texts the application asks for.
exports.texts = function() {
	var found = new Set();
	for (var folder of folders)
		if (Fs.existsSync(Path.join(root, folder)))
			walk(Path.join(root, folder), found);
	return [...found].sort();
};
exports.languages = () =>
	Fs.readdirSync(Path.join(root, 'resources'))
		.filter((name) => name.endsWith('.resource'))
		.map((name) => name.replace('.resource', ''));
function keys(language) {
	var have = new Set();
	for (var line of Fs.readFileSync(Path.join(root, 'resources', language + '.resource'), 'utf8').split('\n')) {
		var match = /^(\S+) : /.exec(line);
		if (match)
			have.add(match[1]);
	}
	return have;
}
// { language: [texts without a translation] }
exports.missing = function() {
	var texts = exports.texts(),
		result = {};
	for (var language of exports.languages()) {
		var have = keys(language);
		result[language] = texts.filter((text) => !have.has(exports.key(text)));
	}
	return result;
};
exports.add = function() {
	var result = exports.missing(),
		added = 0;
	for (var language of Object.keys(result)) {
		if (!result[language].length)
			continue;
		var file = Path.join(root, 'resources', language + '.resource'),
			lines = Fs.readFileSync(file, 'utf8').replace(/\n+$/, '').split('\n');
		for (var text of result[language]) {
			lines.push(exports.key(text) + ' : ' + text);
			added++;
		}
		Fs.writeFileSync(file, lines.join('\n') + '\n');
	}
	return added;
};
if (require.main === module)
	if (process.argv.includes('--add'))
		console.log('Added ' + exports.add() + ' lines. Translate them in each file (they start in English).');
	else {
		var result = exports.missing(),
			total = 0;
		for (var language of Object.keys(result)) {
			total += result[language].length;
			console.log(language + ': ' + (result[language].length ? result[language].length + ' missing' : 'complete'));
			for (var text of result[language])
				console.log('  ' + text);
		}
		process.exitCode = total ? 1 : 0;
	}
