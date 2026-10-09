// The address of the client, for rate limiting. Behind a reverse proxy (the normal setup: HTTPS needs one) the proxy appends
// the address it saw to X-Forwarded-For, so the LAST entry is trustworthy while the first is whatever the client sent.
// With trust false the header is ignored, for an instance that is reached directly.
module.exports = function(headers, socketaddress, trust = true) {
	var forwarded = trust ? String(headers['x-forwarded-for'] || '') : '',
		last = forwarded.split(',').pop().trim();
	return last || socketaddress || 'unknown';
};
