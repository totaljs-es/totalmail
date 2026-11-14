// The address of the client, for rate limiting. Behind a reverse proxy (the normal setup: HTTPS needs one) the proxy appends
// the address it saw to X-Forwarded-For, so the LAST entry is trustworthy while the first is whatever the client sent.
// With trust false the header is ignored, for an instance that is reached directly.
//
// The header counts only when the connection comes from a proxy of ours: the same machine, a private network, or an address
// that the configuration names (`trust_proxy_from`: addresses or IPv4 ranges such as 203.0.113.0/24, separated by commas, for a
// proxy that has a public address). A client that reaches the server directly could write any address in the header and get a new
// rate limit with every request.
var PRIVATE = /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)|^::1$|^f[cd][0-9a-f]{2}:/i;

function ipv4(text) {

	var parts = String(text).split('.');
	if (parts.length !== 4)
		return null;
	var value = 0;
	for (var i = 0; i < 4; i++) {
		if (!/^\d{1,3}$/.test(parts[i]) || Number(parts[i]) > 255)
			return null;
		value = value * 256 + Number(parts[i]);
	}
	return value;
}

// Whether `address` is one of `list` (a text of addresses and IPv4 ranges separated by commas).
function listed(address, list) {

	var plain = String(address || '').toLowerCase().replace(/^::ffff:/, '');
	for (var arr = String(list || '').split(','), i = 0; i < arr.length; i++) {
		var entry = arr[i].trim().toLowerCase().replace(/^::ffff:/, '');
		if (!entry)
			continue;
		var slash = entry.indexOf('/');
		if (slash < 0) {
			if (entry === plain)
				return true;
			continue;
		}
		var base = ipv4(entry.slice(0, slash)),
			bits = Number(entry.slice(slash + 1)),
			value = ipv4(plain);
		if (base === null || value === null || !Number.isInteger(bits) || bits < 0 || bits > 32)
			continue;
		var size = Math.pow(2, 32 - bits);
		if (Math.floor(base / size) === Math.floor(value / size))
			return true;
	}
	return false;
}

module.exports = function(headers, socketaddress, trust = true, proxies = '') {

	var proxied = PRIVATE.test(String(socketaddress || '').replace(/^::ffff:/i, '')) || listed(socketaddress, proxies);
	var forwarded = trust && proxied ? String(headers['x-forwarded-for'] || '') : '',
		last = forwarded.split(',').pop().trim();
	return last || socketaddress || 'unknown';
};
