// Every request that changes something (and the long poll) must come from TotalMail's own page: the custom header cannot be
// sent by another site without permission, and an Origin, when there is one, must be this host.
var request = function(ctrl, next) {
	if ((ctrl.method !== 'GET' || ctrl.uri.pathname === '/changes/') && !PLUGINS.users.security.checkRequest(ctrl))
		ctrl.invalid(403);
	else
		next();
};

NEWMIDDLEWARE('request', request);
// A middleware is assigned to the routes that exist, so it waits until all of them are registered.
ON('ready', function() { return NEWMIDDLEWARE('request', request, 'routes'); });

// What the actions have in common: answer a request from a promise. A message that starts with @( is meant for the person and
// goes back as it is; anything else is logged and replaced by `fallback`.
FUNC.run = function($, fn, fallback) {
	Promise.resolve()
		.then(fn)
		.then(function(value) {
			// An error of the answer itself is logged. A request that got its answer is not answered again; one that did not (the
			// value could not be written) still gets one.
			try {
				$.callback(value);
			} catch (err) {
				Total.error(err, 'TotalMail');
				var ctrl = $.controller;
				if (!(ctrl && (ctrl.released || ctrl.destroyed)))
					$.invalid(fallback || '@(The operation could not be completed.)');
			}
		}, function(err) {
			if ((err.message && err.message.startsWith('@(')) || err.plain)
				$.invalid(err.message);
			else {
				Total.error(err, 'TotalMail');
				$.invalid(fallback || '@(The operation could not be completed.)');
			}
		});
};
