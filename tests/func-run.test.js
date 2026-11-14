require('total5');
var { test } = require('node:test');
var assert = require('node:assert/strict');
require('../definitions/request');
function fake(callback) {
	var answers = [];
	return { answers, $: { callback: (value) => (answers.push(['ok', value]), callback && callback()), invalid: (text) => answers.push(['invalid', text]) } };
}
var settle = () => new Promise((resolve) => setImmediate(resolve));
test('an action answers once: with its value, with a message for the person, or with the fallback', async () => {
	var a = fake();
	FUNC.run(a.$, () => 42);
	var b = fake();
	FUNC.run(b.$, () => { throw Error('@(Shown to the person.)'); });
	var c = fake();
	var logged = Total.error;
	Total.error = () => {};
	try {
		FUNC.run(c.$, () => { throw Error('internal detail'); }, '@(Fallback.)');
		await settle();
	} finally {
		Total.error = logged;
	}
	assert.deepEqual(a.answers, [['ok', 42]]);
	assert.deepEqual(b.answers, [['invalid', '@(Shown to the person.)']]);
	assert.deepEqual(c.answers, [['invalid', '@(Fallback.)']]);
});
test('an error while answering is not answered a second time', async () => {
	var d = fake(() => { throw Error('the answer failed'); });
	var logged = Total.error;
	Total.error = () => {};
	try {
		FUNC.run(d.$, () => 'value');
		await settle();
	} finally {
		Total.error = logged;
	}
	assert.deepEqual(d.answers, [['ok', 'value']]);
});
