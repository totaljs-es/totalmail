// The address of the client, for rate limiting. Behind a reverse proxy (the normal setup: HTTPS needs one) the proxy appends
// the address it saw to X-Forwarded-For, so the LAST entry is trustworthy while the first is whatever the client sent.
// With trust false the header is ignored, for an instance that is reached directly.
module.exports = function(headers, socketaddress, trust = true) {
	// The header counts only when it comes from a proxy of ours (loopback or private network): a client that reaches the
	// server directly could write any address in it and get a new rate limit with every request.
	var proxied = /^(::ffff:)?(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)|^::1$|^f[cd][0-9a-f]{2}:/i.test(String(socketaddress || ''));
	var forwarded = trust && proxied ? String(headers['x-forwarded-for'] || '') : '',
		last = forwarded.split(',').pop().trim();
	return last || socketaddress || 'unknown';
};
