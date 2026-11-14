require('total5');
var { test } = require('node:test');
var assert = require('node:assert/strict');
var cp = require('node:child_process');
var Extract = require('../lib/extract');
test('a PDF with a hex string that never closes ends instead of looping forever', () => {

	// Run apart: the defect was an endless loop, which would hang the whole suite instead of failing.
	var result = cp.spawnSync(process.execPath, [require('node:path').join(__dirname, 'fixtures/pdf-unclosed-hex.js')], { timeout: 8000, killSignal: 'SIGKILL' });
	assert.equal(result.error, undefined, 'the reader must finish');
	assert.equal(result.status, 0);
});
test('a numeric entity beyond Unicode stays as it is instead of failing the document', () => {
	var out = Extract.read('page.html', Buffer.from('<p>a &#x110000; b</p>'));
	assert.ok(out.text.includes('a &#x110000; b'));
});
