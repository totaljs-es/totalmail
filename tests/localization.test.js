const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
require('total5');
const localization = require('../modules/localization');
const root = path.join(__dirname, '..');
for (const language of fs
	.readdirSync(path.join(root, 'resources'))
	.filter((name) => name.endsWith('.resource'))
	.map((name) => name.slice(0, -9)))
	Total.loadresource(language, fs.readFileSync(path.join(root, 'resources', language + '.resource'), 'utf8'));

test('English is the base; only supported preferences are accepted', () => {
	assert.equal(localization.resolve(), 'en');
	assert.equal(localization.resolve(undefined, 'es'), 'es');
	assert.equal(localization.resolve('en', 'es'), 'en');
	assert.equal(localization.resolve('sk'), 'sk');
	assert.equal(localization.resolve('de'), 'de');
	assert.equal(localization.resolve('fr'), 'fr');
	assert.equal(localization.resolve('it'), 'it');
	assert.equal(localization.resolve('pt'), 'pt');
	assert.equal(localization.resolve('el'), 'el');
	assert.equal(localization.resolve('../secrets', 'es'), 'es');
	assert.equal(localization.resolve('nl', 'unknown'), 'en');
});

test('every UI marker has matching English, Spanish, Slovak, German, French, Italian, Portuguese and Greek resources', () => {
	let files = [];
	function scan(dir) {
		for (let item of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
			let file = path.join(dir, item.name);
			if (item.isDirectory() && item.name !== 'vendor')
				scan(file);
			else if (/\.(html|js|json)$/.test(item.name))
				files.push(file);
		}
	}
	for (let dir of ['views', 'plugins', 'modules', 'lib'])
		scan(dir);
	let phrases = new Set(
		files.flatMap((file) =>
			Array.from(fs.readFileSync(path.join(root, file), 'utf8').matchAll(/@\(([^()]*)\)/g), (match) => match[1]).filter(
				(phrase) => phrase !== "'"
			)
		)
	);
	assert.ok(phrases.size > 0);
	for (let phrase of phrases) {
		let key = 'T' + phrase.hash(true).toString(36);
		assert.equal(Total.resource('en', key), phrase === 'mail.messages.few' ? '{0} messages' : phrase, 'English: ' + phrase);
		assert.ok(Total.resource('es', key), 'Spanish: ' + phrase);
	}
	for (let language of ['en', 'es', 'sk', 'de', 'fr', 'it', 'pt', 'el']) {
		assert.deepEqual(Object.keys(Total.resources.en).sort(), Object.keys(Total.resources[language]).sort());
		for (let phrase of phrases)
			assert.ok(Total.resource(language, 'T' + phrase.hash(true).toString(36)), language + ': ' + phrase);
	}
});

test('native translation handles fallback, counts and Action errors', () => {
	assert.equal(TRANSLATE('en', '@(Inbox)'), 'Inbox');
	assert.equal(TRANSLATE('sk', '@(Inbox)'), 'Doručené');
	assert.equal(TRANSLATE('sk', '@(mail.messages.few)').format(2), '2 správy');
	assert.equal(TRANSLATE('es', '@(Inbox)'), 'Entrada');
	assert.equal(TRANSLATE('de', '@(Inbox)'), 'Posteingang');
	assert.equal(TRANSLATE('fr', '@(Inbox)'), 'Boîte de réception');
	assert.equal(TRANSLATE('it', '@(Inbox)'), 'Posta in arrivo');
	assert.equal(TRANSLATE('pt', '@(Inbox)'), 'Caixa de entrada');
	assert.equal(TRANSLATE('el', '@(Inbox)'), 'Εισερχόμενα');
	assert.equal(TRANSLATE('es', '@({0} messages)').format(2), '2 mensajes');
	assert.equal(TRANSLATE('en', '@({0} message)').format(1), '1 message');
	assert.equal(TRANSLATE('es', '@(An untranslated phrase)'), 'An untranslated phrase');
	let error = new ErrorBuilder();
	error.push('@(Invalid account.)');
	assert.equal(error.output('es')[0].error, 'Cuenta no válida.');
	assert.equal(error.output('en')[0].error, 'Invalid account.');
});

test('client delivery uses the resources managed by Total.js, with safe serialization', () => {
	let english = Total.resources.en,
		spanish = Total.resources.es,
		defaults = Total.resources.default;
	try {
		Total.loadresource('default', 'Tdefault : Default value');
		Total.loadresource('en', 'Tbase : Base phrase\nTtest : English');
		Total.loadresource('es', 'Ttest : </script>\u2028separator\u2029end');
		let serialized = localization.clientResources('es');
		assert.ok(!serialized.includes('</script>'));
		assert.ok(!serialized.includes('\u2028'));
		assert.ok(!serialized.includes('\u2029'));
		assert.equal(JSON.parse(serialized), 'Tdefault : Default value\nTbase : Base phrase\nTtest : </script>\u2028separator\u2029end');
		// Runtime resource updates must also reach the browser without re-reading files.
		Total.loadresource('es', 'Ttest : Updated translation');
		assert.ok(JSON.parse(localization.clientResources('es')).includes('Ttest : Updated translation'));
	} finally {
		Total.resources.en = english;
		Total.resources.es = spanish;
		if (defaults)
			Total.resources.default = defaults;
		else
			delete Total.resources.default;
	}
});

test('new native resource languages are discovered with their own names and English fallback', () => {
	try {
		Total.loadresource('de', 'language_name : Deutsch\nTfixture : Beispiel');
		assert.ok(localization.languages.includes('de'));
		assert.equal(localization.resolve('de'), 'de');
		assert.equal(localization.options().find((item) => item.id === 'de').name, 'Deutsch');
		assert.ok(JSON.parse(localization.clientLanguages()).some((item) => item.id === 'de'));
		assert.ok(JSON.parse(localization.clientResources('de')).includes('Tfixture : Beispiel'));
		assert.ok(JSON.parse(localization.clientResources('de')).includes('T' + 'Inbox'.hash(true).toString(36) + ' : Inbox'));
		assert.ok(!localization.languages.includes('default'));
	} finally {
		delete Total.resources.de;
	}
});
