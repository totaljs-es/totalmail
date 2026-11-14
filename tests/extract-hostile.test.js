require('total5');
var { test } = require('node:test');
var assert = require('node:assert/strict');
var cp = require('node:child_process');
var Extract = require('../plugins/ai/extract');
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
test('the parts of one document together may not expand past the limit either, and the next document starts again', () => {
	var zero = Total.Zlib.deflateSync(Buffer.alloc(30 * 1024 * 1024));
	var parts = [Buffer.from('%PDF-1.4\n')];
	for (var n = 1; n <= 3; n++)
		parts.push(Buffer.from(n + ' 0 obj\n<< /Type /ObjStm /N 1 /First 4 /Filter /FlateDecode /Length ' + zero.length + ' >>\nstream\n'), zero, Buffer.from('\nendstream\nendobj\n'));
	parts.push(Buffer.from('trailer\n<< >>\n%%EOF'));
	assert.throws(() => Extract.read('bomb.pdf', Buffer.concat(parts)), /too long/, 'three parts of 30 MB are 90 MB');
	assert.equal(Extract.read('note.txt', Buffer.from('hello')).text, 'hello');
	var fs = require('node:fs'),
		path = require('node:path');
	assert.ok(Extract.read('handbook.docx', fs.readFileSync(path.join(__dirname, 'fixtures/documents/handbook.docx'))).text.length > 0, 'a real document after the bomb is read in full');
});
