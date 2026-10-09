// The one way the pages talk to the server: jComponent's own TAPI(), UPLOAD() and AJAX(), wrapped as promises. The header the
// server asks for and the address of the API are set once in DEF (views/head.html), and jComponent adds the language itself.
// jComponent hands a callback only the parsed answer; the HTTP status comes in the 'response' event that fires right before
// it, and is kept here against that callback.
var totalmailrequest = (function() {
	var statuses = new WeakMap();
	ON('response', function(o) {
		if (typeof o.callback === 'function')
			statuses.set(o.callback, o.status);
	});
	function call(run, progress) {
		return new Promise(function(resolve) {
			var done = function(value) {
				resolve({ status: statuses.get(done) || 0, value });
			};
			run(done, progress);
		});
	}
	// What the server answered when it said no: Total.js sends the reasons as a list of { error }.
	function reasons(value) {
		return Array.isArray(value)
			? value
				.map((item) => item.error || item.name)
				.filter(Boolean)
				.join(', ')
			: '';
	}
	return {
		// A schema of the API (POST /api/ with { schema, data }): the answer, or an Error with a message for the person.
		api: async function(schema, data) {
			var answer = await call((done) => TAPI(schema, data || {}, done));
			if (!answer.status)
				throw new Error(TRANSLATE('@(Cannot reach TotalMail. Check your connection and try again.)'));
			if (answer.status === 401)
				throw new Error(TRANSLATE('@(Your session has expired. Sign in again to continue.)'));
			if (answer.status >= 400 || Array.isArray(answer.value))
				throw new Error(reasons(answer.value) || TRANSLATE('@(The operation could not be completed.)'));
			if (typeof answer.value === 'string')
				throw new Error(TRANSLATE('@(TotalMail returned an unexpected response. Please try again.)'));
			return answer.value;
		},
		// Files (a FormData): the answer in the same way.
		upload: async function(url, form, progress) {
			var answer = await call((done) => UPLOAD('POST ' + url, form, done, progress));
			if (answer.status === 401)
				throw new Error(TRANSLATE('@(Your session has expired. Sign in again to continue.)'));
			if (!answer.status || answer.status >= 400 || Array.isArray(answer.value) || !answer.value || typeof answer.value !== 'object')
				throw new Error(reasons(answer.value) || TRANSLATE('@(The operation could not be completed.)'));
			return answer.value;
		},
		// A plain GET: { status, value }, the caller decides.
		get: (url) => call((done) => AJAX('GET ' + url, done))
	};
})();
