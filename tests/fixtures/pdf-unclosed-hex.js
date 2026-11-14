// Run by tests/extract-hostile.test.js in its own process: a PDF whose hex strings never close.
require('total5');
var Extract = require('../../lib/extract');
var pdf = '%PDF-1.4\n1 0 obj\n<< /Type /Page /Contents 2 0 R >>\nendobj\n2 0 obj\n<< /Length 20 >>\nstream\nBT <41 Tj [<42 ] TJ ET\nendstream\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF';
try {
	Extract.read('a.pdf', Buffer.from(pdf, 'latin1'));
} catch (e) {}
process.exit(0);
