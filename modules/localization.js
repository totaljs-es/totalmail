Object.defineProperty(exports, 'languages', {
	get: () =>
		Object.keys(Total.resources)
			.filter((name) => /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/.test(name))
			.sort()
});
exports.options = function() {
	return exports.languages.map((id) => {
		var name = Total.resource(id, 'language_name');
		if (!name)
			try {
				name = new Intl.DisplayNames([id], { type: 'language' }).of(id);
			} catch {
				name = id;
			}

		return { id, name };
	});
};
exports.clientLanguages = function() {
	return JSON.stringify(exports.options()).replace(/</g, '\\u003c');
};
exports.resolve = function(requested, saved) {
	return exports.languages.includes(requested) ? requested : exports.languages.includes(saved) ? saved : 'en';
};
exports.clientResources = function(language) {
	language = exports.resolve(language);
	// Total.js has already loaded and parsed these resources at startup.
	// Deliver that state to jComponent; do not maintain another resource loader.
	var resources = {
		...Total.resources.default,
		...Total.resources.en,
		...Total.resources[language]
	};
	var text = Object.keys(resources)
		.map((key) => key + ' : ' + resources[key])
		.join('\n');
	return JSON.stringify(text)
		.replace(/</g, '\\u003c')
		.replace(/\u2028/g, '\\u2028')
		.replace(/\u2029/g, '\\u2029');
};
