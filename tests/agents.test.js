// The files for agents: AGENTS.md and the pointers to it, the instructions of each area, the skills and the settings of Claude Code.
// They are only useful if they are true, so they are tested.
var { test, describe } = require('node:test');
var assert = require('node:assert/strict');
var Fs = require('node:fs');
var Path = require('node:path');

var root = Path.join(__dirname, '..');
var read = (file) => Fs.readFileSync(Path.join(root, file), 'utf8').replace(/\r\n/g, '\n');
var pkg = JSON.parse(read('package.json'));

// Every file and folder that git keeps, to check the paths that a text mentions
var everything = [];

(function walk(directory, prefix) {
	for (var entry of Fs.readdirSync(directory, { withFileTypes: true })) {
		if (['node_modules', '.git', 'database', 'logs', 'tmp'].includes(entry.name))
			continue;
		var path = prefix + entry.name;
		everything.push(path);
		if (entry.isDirectory())
			walk(Path.join(directory, entry.name), path + '/');
	}
})(root, '');

function exists(token) {
	var wanted = token.replace(/\/$/, '');
	return everything.some((path) => path === wanted || path.endsWith('/' + wanted));
}

// What exists while the application runs and is not in git
var GENERATED = ['database/', 'logs/', 'tmp/', 'index.pid', 'index.js.json', 'index.js.map', '.claude/settings.local.json'];

// The paths that a text mentions between backticks: `docs/storage.md`, `lib/`, `bin/admin.js`
function mentioned(text) {

	var found = new Set();

	for (var match of text.matchAll(/`([^`\n]+)`/g)) {

		var token = match[1].trim();

		if (/[\s<>*{}$()=:|,;@]/.test(token) || token.startsWith('-') || token.startsWith('node_modules') || GENERATED.includes(token) || token.startsWith('database/'))
			continue;

		if (/^[\w.\-/]+\.(md|js|json|html|yml|txt|cjs|resource|svg)$/.test(token) || /^[\w.\-]+(\/[\w.\-]+)*\/$/.test(token))
			found.add(token);
	}

	return [...found];
}

// The commands that a text mentions: npm run x, node bin/x.js, node --test tests/x.test.js
function commands(text) {

	var found = [];

	for (var match of text.matchAll(/npm run ([\w:-]+)/g))
		found.push({ script: match[1] });

	for (var match of text.matchAll(/node (?:--test )?((?:bin|tests)\/[\w./-]+\.js)/g))
		found.push({ file: match[1] });

	return found;
}

function check(file) {

	var text = read(file);

	for (var token of mentioned(text))
		assert.ok(exists(token) || (/^\.{1,2}\//.test(token) && Fs.existsSync(Path.join(root, Path.dirname(file), token))), file + ' mentions ' + token + ', which does not exist');

	for (var command of commands(text))
		if (command.script)
			assert.ok(pkg.scripts[command.script], file + ' runs "npm run ' + command.script + '", which is not a script of package.json');
		else
			assert.ok(Fs.existsSync(Path.join(root, command.file)), file + ' runs ' + command.file + ', which does not exist');

}

var SKILLS = Fs.readdirSync(Path.join(root, '.claude', 'skills'));
var AREAS = ['plugins', 'modules', 'tests'];

describe('AGENTS.md', () => {

	test('what it mentions exists: the paths and the commands', () => {
		check('AGENTS.md');
	});

	test('it says what an agent needs: how to run, where the code is and what the project does not do', () => {

		var text = read('AGENTS.md');

		for (var word of ['npm test', 'npm run lint', 'Total.js', 'NEWACTION', '@(Text)', 'database/', 'openssl', 'MCP', 'docs/total-js.md'])
			assert.ok(text.includes(word), 'AGENTS.md does not mention ' + word);

		assert.ok(text.includes('Node.js: ' + pkg.engines.node.replace('>=', '') + ' or newer'), 'the version of Node.js is not the one of package.json');
	});

	test('every folder of the layout that it describes exists, and so do the plugins that it names', () => {

		for (var folder of ['plugins/', 'modules/', 'private/', 'controllers/', 'definitions/', 'resources/', 'views/', 'public/', 'bin/', 'docs/', 'tests/'])
			assert.ok(Fs.existsSync(Path.join(root, folder)), folder);

		for (var plugin of read('plugins/AGENTS.md').match(/`(mail|accounts|users|providers|rules|ai|devices|reception|access)`/g))
			assert.ok(Fs.existsSync(Path.join(root, 'plugins', plugin.replace(/`/g, ''))), plugin);

		// Total.js loads a plugin only when its folder has an index.js.
		for (var folder of Fs.readdirSync(Path.join(root, 'plugins')).filter((name) => Fs.statSync(Path.join(root, 'plugins', name)).isDirectory()))
			assert.ok(Fs.existsSync(Path.join(root, 'plugins', folder, 'index.js')), 'plugins/' + folder + ' has no index.js');

		assert.deepEqual(Fs.readdirSync(Path.join(root, 'plugins')).sort(), ['access', 'accounts', 'ai', 'AGENTS.md', 'CLAUDE.md', 'devices', 'folders', 'mail', 'providers', 'reception', 'rules', 'users'].sort());
	});

	test('the conventions that it states are the ones that ESLint enforces', () => {

		var eslint = read('eslint.config.cjs');

		assert.ok(eslint.includes('forEach'), 'forEach is not forbidden');
		assert.ok(eslint.includes('No const: use var'));
		assert.ok(eslint.includes("'no-restricted-modules'"));

		for (var module of ['fs', 'path', 'crypto'])
			assert.ok(eslint.includes("'" + module + "'"), module + ' is not restricted');

		for (var ignored of ['private/vendor/**', 'public/**', 'node_modules/**'])
			assert.ok(eslint.includes(ignored), ignored + ' is not ignored by ESLint');

		assert.ok(Fs.existsSync(Path.join(root, 'private', 'vendor', 'total5-mail.js')));
	});

	test('the request header that the tests need is the one that the application checks', () => {
		assert.ok(read('plugins/users/security.js').includes("'x-totalmail'"));
		assert.ok(read('tests/AGENTS.md').includes('X-TotalMail: 1'));
	});

	test('what the project does not do is what CONTRIBUTING.md says', () => {

		var contributing = read('CONTRIBUTING.md');

		for (var rule of ['No AI that reads mail and acts', 'No sending without review', 'No outside services', 'No secrets'])
			assert.ok(contributing.includes('**' + rule), 'CONTRIBUTING.md lost: ' + rule);

		for (var rule of ['An AI that reads mail and acts', 'Sending without review', 'Outside services', 'Secrets in the repository'])
			assert.ok(read('AGENTS.md').includes('**' + rule), 'AGENTS.md lost: ' + rule);
	});

	test('it is for any agent: it does not carry the personal way of working of the maintainers', () => {
		for (var file of ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md', '.github/copilot-instructions.md', ...AREAS.map((area) => area + '/AGENTS.md'), ...SKILLS.map((name) => '.claude/skills/' + name + '/SKILL.md')])
			assert.ok(!/Co-Authored-By|Generated with|the owner|commit only when|never push/i.test(read(file)), file + ' has rules that are not about the project');
	});

});

describe('the files for each agent lead to AGENTS.md', () => {

	test('Claude Code and Gemini import it', () => {
		assert.match(read('CLAUDE.md'), /^@AGENTS\.md$/m);
		assert.match(read('GEMINI.md'), /^@AGENTS\.md$/m);
	});

	test('Copilot has the rules that matter most and says where the rest is', () => {

		var text = read('.github/copilot-instructions.md');

		assert.ok(text.includes('AGENTS.md'));
		assert.ok(text.includes('npm test'));
		check('.github/copilot-instructions.md');
	});

	test('CLAUDE.md names the skills that exist', () => {
		assert.deepEqual(SKILLS.sort(), ['totalmail-add-language', 'totalmail-add-operation', 'totalmail-verify-change']);
		assert.ok(read('CLAUDE.md').includes('.claude/skills/'));
		assert.ok(read('AGENTS.md').includes('three checklists'));
	});

});

describe('Codex repo-local skills', () => {

	test('each shared workflow is discoverable in .agents/skills with the same metadata', () => {

		assert.deepEqual(Fs.readdirSync(Path.join(root, '.agents', 'skills')).sort(), [...SKILLS].sort());

		for (var name of SKILLS) {
			var metadata = (text) => /^---\nname: (.+)\ndescription: (.+)\n---\n/.exec(text);
			var entry = read('.agents/skills/' + name + '/SKILL.md');
			var shared = read('.claude/skills/' + name + '/SKILL.md');

			assert.ok(metadata(entry), name + ' has no discovery metadata');
			assert.deepEqual(metadata(entry).slice(1), metadata(shared).slice(1), name + ' has different discovery metadata');
		}
	});

	test('Codex entries resolve to the maintained shared checklists', () => {

		for (var name of SKILLS) {

			var file = '.agents/skills/' + name + '/SKILL.md';
			var link = /\[Shared checklist\]\(([^)]+)\)/.exec(read(file));

			assert.ok(link, file + ' has no shared checklist link');

			var target = Path.resolve(root, Path.dirname(file), link[1]);

			assert.equal(target, Path.join(root, '.claude', 'skills', name, 'SKILL.md'));
			assert.ok(Fs.statSync(target).isFile(), file + ' links to a missing checklist');
		}
	});

});

describe('the instructions of each area of the repository', () => {

	test('every area has AGENTS.md, and a CLAUDE.md that imports it (Claude Code reads the CLAUDE.md of a folder, not its AGENTS.md)', () => {
		for (var area of AREAS) {
			assert.ok(Fs.existsSync(Path.join(root, area, 'AGENTS.md')), area + ' has no AGENTS.md');
			assert.match(read(area + '/CLAUDE.md'), /^@AGENTS\.md$/m, area + '/CLAUDE.md does not import AGENTS.md');
		}
	});

	test('what each one mentions exists, and it points to the instructions of the project', () => {
		for (var area of AREAS) {
			check(area + '/AGENTS.md');
			assert.ok(read(area + '/AGENTS.md').includes('../AGENTS.md'), area + '/AGENTS.md does not lead to the instructions of the project');
		}
	});

	test('none is longer than 200 lines, which is where instructions stop being followed', () => {
		for (var file of ['AGENTS.md', ...AREAS.map((area) => area + '/AGENTS.md')])
			assert.ok(read(file).split('\n').length <= 200, file + ' is too long');
	});

	test('the files that plugins/ and modules/ name exist', () => {
		for (var area of ['plugins', 'modules'])
			for (var name of read(area + '/AGENTS.md').match(/`(?:\w+\/)?\w+\.js`/g) || []) {
				var file = name.replace(/`/g, '');
				var found = Fs.existsSync(Path.join(root, area, file)) || Fs.existsSync(Path.join(root, 'private', 'vendor', file)) ||
					Fs.readdirSync(Path.join(root, 'plugins')).some((plugin) => Fs.existsSync(Path.join(root, 'plugins', plugin, file)) || Fs.existsSync(Path.join(root, 'plugins', plugin, 'public', file)));
				assert.ok(found, file + ' is not where ' + area + '/AGENTS.md says');
			}
	});

});

describe('the plugins', () => {

	test('modules/ loads only files without state from a plugin: what has an install() is read through PLUGINS', () => {
		for (var file of Fs.readdirSync(Path.join(root, 'modules')).filter((name) => name.endsWith('.js')))
			for (var match of read('modules/' + file).matchAll(/require\('\.\.\/plugins\/(\w+)\/([\w/-]+)'\)/g)) {
				var target = read('plugins/' + match[1] + '/' + match[2] + '.js');
				assert.ok(!/^exports\.install\b/m.test(target), 'modules/' + file + ' loads plugins/' + match[1] + '/' + match[2] + '.js, which has an install()');
			}
	});

	test('a plugin loads only files without state from another plugin: what has an install() is read through PLUGINS', () => {
		var plugins = Fs.readdirSync(Path.join(root, 'plugins')).filter((name) => Fs.statSync(Path.join(root, 'plugins', name)).isDirectory());
		for (var plugin of plugins)
			for (var file of Fs.readdirSync(Path.join(root, 'plugins', plugin)).filter((name) => name.endsWith('.js'))) {
				var text = read('plugins/' + plugin + '/' + file);
				for (var match of text.matchAll(/require\('\.\.\/(\w+)\/([\w/-]+)'\)/g)) {
					if (match[1] === plugin || !plugins.includes(match[1]))
						continue;
					var target = read('plugins/' + match[1] + '/' + match[2] + '.js');
					assert.ok(!/^exports\.install\b/m.test(target), 'plugins/' + plugin + '/' + file + ' loads plugins/' + match[1] + '/' + match[2] + '.js, which has an install(): read it as PLUGINS.' + match[1] + ' inside a function');
				}
			}
	});

});

describe('the skills', () => {

	test('every skill has a name that is its folder and a description that says when to use it', () => {
		for (var name of SKILLS) {

			var front = /^---\nname: (.+)\ndescription: (.+)\n---\n/.exec(read('.claude/skills/' + name + '/SKILL.md'));

			assert.ok(front, name + ' has no frontmatter with name and description');
			assert.equal(front[1], name);
			assert.match(front[2], /^Use (when|before)/, name + ': the description must say when to use it');
			assert.ok(front[2].length > 60, name + ': the description is too short');
		}
	});

	test('what the skills mention exists', () => {
		for (var name of SKILLS)
			check('.claude/skills/' + name + '/SKILL.md');
	});

	test('the plugins that the add-operation skill lists are the ones that exist', () => {
		for (var plugin of ['mail', 'accounts', 'users', 'providers', 'rules', 'ai', 'devices', 'reception', 'access'])
			assert.ok(read('.claude/skills/totalmail-add-operation/SKILL.md').includes('`' + plugin + '`') && Fs.existsSync(Path.join(root, 'plugins', plugin)), plugin);
	});

});

describe('the shared settings of Claude Code', () => {

	var settings = JSON.parse(read('.claude/settings.json'));

	test('they allow what is safe to run without asking, and the scripts exist', () => {

		assert.equal(settings.$schema, 'https://json.schemastore.org/claude-code-settings.json');
		assert.ok(settings.permissions.allow.length >= 5);

		for (var rule of settings.permissions.allow) {

			assert.match(rule, /^Bash\([^)]+\)$/, rule);

			var script = /^Bash\(npm run ([\w:-]+)\)$/.exec(rule);

			if (script)
				assert.ok(pkg.scripts[script[1]], rule + ' is not a script of package.json');
		}

		assert.ok(settings.permissions.allow.includes('Bash(npm test)'));
	});

	test('nothing that changes the world is allowed: no install, no publish, no push, no deletion', () => {
		for (var rule of settings.permissions.allow)
			assert.ok(!/publish|push|install|rm |curl|wget|sudo|checkout|reset|clean|\bsh\b|bash -c|--add|admin/.test(rule), rule + ' allows something that it should not');
	});

	test('secrets and the data of people are not read, and the personal settings are not committed', () => {
		assert.ok(settings.permissions.deny.includes('Read(./.env)'));
		assert.ok(settings.permissions.deny.includes('Read(./database/**)'));
		assert.match(read('.gitignore'), /^\.claude\/settings\.local\.json$/m);
	});

});
