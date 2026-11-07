// Translations: finds every text written as @(...) in the code and the views, and checks that each language file has it.
//
//   node bin/translations.js              lists what is missing, per language
//   node bin/translations.js --add        adds the missing texts to every file (English as the text, to be translated)
//
// A key is made from the text itself (the same algorithm Total.js uses), so nothing has to be numbered. A text must not contain
// parentheses: the framework would cut it there.
var Fs = require('node:fs'),
	Path = require('node:path');

var root = Path.join(__dirname, '..');
var folders = ['views', 'plugins', 'modules', 'controllers', 'lib', 'definitions'];

exports.key = function(text) {

	var hash = 0;
	for (var i = 0; i < text.length; i++)
		hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
	return 'T' + (hash >>> 0).toString(36);
};

function walk(dir, found) {
	for (var arr = Fs.readdirSync(dir, { withFileTypes: true }), j = 0; j < arr.length; j++) {
		var entry = arr[j];
		if (entry.name === 'vendor' || entry.name === 'node_modules')
			continue;
		var path = Path.join(dir, entry.name);
		if (entry.isDirectory())
			walk(path, found);
		else if (/\.(html|js|json)$/.test(entry.name) && !/\.min\.js$/.test(entry.name))
			for (var list = Array.from(Fs.readFileSync(path, 'utf8').matchAll(/@\(([^()]*)\)/g)), i = 0; i < list.length; i++) {
				var match = list[i];
				if (match[1] !== "'")
					found.add(match[1]);
			}
	}
}

// The texts the application asks for.
exports.texts = function() {

	var found = new Set();
	for (var list = Array.from(folders), i = 0; i < list.length; i++) {
		var folder = list[i];
		if (Fs.existsSync(Path.join(root, folder)))
			walk(Path.join(root, folder), found);
	}
	return Array.from(found).sort();
};

exports.languages = function() {
	return Fs.readdirSync(Path.join(root, 'resources'))
		.filter(function(name) { return name.endsWith('.resource'); })
		.map(function(name) { return name.replace('.resource', ''); });
};

function keys(language) {

	var have = new Set();
	for (var list = Fs.readFileSync(Path.join(root, 'resources', language + '.resource'), 'utf8').split('\n'), i = 0; i < list.length; i++) {
		var line = list[i];
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
	for (var list = Array.from(exports.languages()), i = 0; i < list.length; i++) {
		var language = list[i];
		var have = keys(language);
		result[language] = texts.filter(function(text) { return !have.has(exports.key(text)); });
	}
	return result;
};

exports.add = function() {

	var result = exports.missing(),
		added = 0;
	for (var arr = Object.keys(result), j = 0; j < arr.length; j++) {
		var language = arr[j];
		if (!result[language].length)
			continue;
		var file = Path.join(root, 'resources', language + '.resource'),
			lines = Fs.readFileSync(file, 'utf8').replace(/\n+$/, '').split('\n');
		for (var list = Array.from(result[language]), i = 0; i < list.length; i++) {
			var text = list[i];
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
		for (var arr = Object.keys(result), k = 0; k < arr.length; k++) {
			var language = arr[k];
			total += result[language].length;
			console.log(language + ': ' + (result[language].length ? result[language].length + ' missing' : 'complete'));
			for (var list = Array.from(result[language]), j = 0; j < list.length; j++) {
				var text = list[j];
				console.log('  ' + text);
			}
		}
		process.exitCode = total ? 1 : 0;
	}
