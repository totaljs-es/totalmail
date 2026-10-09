const { test } = require('node:test');
const Assert = require('node:assert/strict');
const Translations = require('../bin/translations');
test('every text of the application is in every language file', () => {
	var missing = Translations.missing();
	for (var language of Object.keys(missing))
		Assert.deepEqual(missing[language], [], language + ' is missing texts: run node bin/translations.js');
	Assert.ok(Translations.languages().length >= 3);
	Assert.ok(Translations.texts().length > 700, 'the texts were found');
});
test('a text has no parentheses and a key follows from the text alone', () => {
	Assert.equal(Translations.key('Mail'), 'T1f8if', 'the same key Total.js writes for it');
	Assert.equal(Translations.key('Folders'), 'Tg8aw85');
	for (var text of Translations.texts())
		Assert.ok(!/[()]/.test(text), text);
});
