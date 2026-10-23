// Every request that changes something (and the long poll) must come from TotalMail's own page: the custom header cannot be
// sent by another site without permission, and an Origin, when there is one, must be this host.
var request = function(ctrl, next) {
	if ((ctrl.method !== 'GET' || ctrl.uri.pathname === '/changes/') && !MODS.security.checkRequest(ctrl))
		ctrl.invalid(403);
	else
		next();
};

NEWMIDDLEWARE('request', request);
// A middleware is assigned to the routes that exist, so it waits until all of them are registered.
ON('ready', () => NEWMIDDLEWARE('request', request, 'routes'));

// What the actions have in common: answer a request from a promise. A message that starts with @( is meant for the person and
// goes back as it is; anything else is logged and replaced by `fallback`.
FUNC.run = function($, fn, fallback) {
	Promise.resolve()
		.then(fn)
		.then((value) => $.callback(value))
		.catch((err) => {
			if (err.message?.startsWith('@(') || err.plain)
				$.invalid(err.message);
			else {
				Total.error(err, 'TotalMail');
				$.invalid(fallback || '@(The operation could not be completed.)');
			}
		});
};
