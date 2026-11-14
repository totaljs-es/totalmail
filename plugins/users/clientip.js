// The address of the client, for rate limiting. Behind a reverse proxy (the normal setup: HTTPS needs one) the proxy appends
// the address it saw to X-Forwarded-For, so the LAST entry is trustworthy while the first is whatever the client sent.
// With trust false the header is ignored, for an instance that is reached directly.
//
// The header counts only when the connection comes from a proxy of ours: the same machine, a network that is not reachable from
// the internet (private, carrier-grade NAT and Tailscale, link-local), or what the configuration names (`trust_proxy_from`: addresses
// or ranges, IPv4 or IPv6, separated by commas, for a proxy with a public address). A client that reaches the server directly could
// write any address in the header and get a new rate limit with every request.
var OURS = [['127.0.0.0', 8], ['10.0.0.0', 8], ['172.16.0.0', 12], ['192.168.0.0', 16], ['100.64.0.0', 10], ['169.254.0.0', 16], ['::1', 128], ['fc00::', 7], ['fe80::', 10]];

var lists = new Map();

// The addresses trusted as a proxy, built once for each value of the configuration.
function trusted(extra) {

	var key = String(extra || '');
	if (lists.has(key))
		return lists.get(key);
	var list = new Total.Net.BlockList();
	var entries = OURS.map(function(pair) { return pair[0] + '/' + pair[1]; }).concat(key.split(','));
	for (var i = 0; i < entries.length; i++) {
		var entry = entries[i].trim().toLowerCase();
		if (!entry)
			continue;
		var parts = entry.split('/'),
			type = Total.Net.isIP(parts[0]);
		// An entry that is not an address names nobody.
		if (!type || parts.length > 2)
			continue;
		try {
			if (parts.length === 2)
				list.addSubnet(parts[0], Number(parts[1]), type === 4 ? 'ipv4' : 'ipv6');
			else
				list.addAddress(parts[0], type === 4 ? 'ipv4' : 'ipv6');
		} catch (e) {
			continue;
		}
	}
	lists.set(key, list);
	return list;
}

function ours(address, extra) {

	// BlockList matches an IPv4 address written as IPv6 (::ffff:10.0.0.1) against the IPv4 ranges by itself.
	var plain = String(address || '').toLowerCase(),
		type = Total.Net.isIP(plain);
	return !!type && trusted(extra).check(plain, type === 4 ? 'ipv4' : 'ipv6');
}

module.exports = function(headers, socketaddress, trust = true, proxies = '') {

	var forwarded = trust && ours(socketaddress, proxies) ? String(headers['x-forwarded-for'] || '') : '',
		last = forwarded.split(',').pop().trim();
	return last || socketaddress || 'unknown';
};
