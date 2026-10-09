// The documents the assistant may read to draft a reply. Used as MODS.knowledge; the logic is in lib/knowledge.js.
const Lib = require('../lib/knowledge'),
	Extract = require('../lib/extract'),
	Tables = require('../lib/tables').in(PATH.root('database'));
exports.install = function() {
	PAUSESERVER('knowledge', true);
	Lib.open({ table: Tables, legacy: { file: PATH.root('database/knowledge.json') } })
		.then((store) => {
			Object.assign(exports, store);
			PAUSESERVER('knowledge', false);
		})
		.catch((error) => Total.error(error, 'TotalMail knowledge base'));
};
exports.limits = Lib.limits;
exports.tokens = Lib.tokens;
exports.chunks = Lib.chunks;
exports.block = Lib.block;
exports.query = Lib.query;
// Each uploaded file is read into text on the server and added to a collection. What was added and what could not be read, and
// why, comes back; the text itself never does.
exports.importFiles = async function(collectionid, files, language) {
	var added = [],
		failed = [];
	for (var file of files) {
		var name =
			String(file.filename || '')
				.replace(/[\x00-\x1f\x7f\\\/:*?"<>|]+/g, '_')
				.trim()
				.slice(0, 120) || 'document';
		try {
			if (file.size > 15 * 1024 * 1024)
				throw Error('@(This document is too long to add.)');
			// The temporary file can end with bytes of the next part of the upload: only the size the framework measured is the file.
			var content = (await file.read()).subarray(0, file.size);
			added.push(await exports.addDocument(collectionid, name, Extract.read(name, content).text));
		} catch (err) {
			failed.push({
				name,
				error: TRANSLATE(language, err.message?.startsWith('@(') ? err.message : '@(The operation could not be completed.)')
			});
		}
	}
	return { added, failed };
};
