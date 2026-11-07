var dns = Total.Dns.promises,
	Discovery = require('./discovery');

exports.resolve = async function(host) {

	host = Discovery.host(host);
	var timer;
	try {
		var addresses = await Promise.race([
			dns.lookup(host, {
				all: true
			}),
			new Promise(function(resolve, reject) {
				timer = setTimeout(function() { return reject(Error('@(Mail server lookup timed out.)')); }, 5000);
			})
		]);
		if (!addresses.length || !addresses.every(function(a) { return Discovery.publicIP(a.address); }))
			throw Error('@(Mail servers must resolve to public addresses.)');
		return {
			address: addresses[0].address,
			servername: host
		};
	} finally {
		clearTimeout(timer);
	}
};
