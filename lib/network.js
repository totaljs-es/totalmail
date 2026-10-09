const dns = Total.Dns.promises,
	Discovery = require('./discovery');
exports.resolve = async function(host) {
	host = Discovery.host(host);
	let timer;
	try {
		var addresses = await Promise.race([
			dns.lookup(host, {
				all: true
			}),
			new Promise((resolve, reject) => {
				timer = setTimeout(() => reject(Error('@(Mail server lookup timed out.)')), 5000);
			})
		]);
		if (!addresses.length || !addresses.every((a) => Discovery.publicIP(a.address)))
			throw Error('@(Mail servers must resolve to public addresses.)');
		return {
			address: addresses[0].address,
			servername: host
		};
	} finally {
		clearTimeout(timer);
	}
};
