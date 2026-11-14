var dns = Total.Dns.promises,
	Net = Total.Net;

var blocked = new Net.BlockList();

for (var list = [
		['0.0.0.0', 8],
		['10.0.0.0', 8],
		['100.64.0.0', 10],
		['127.0.0.0', 8],
		['169.254.0.0', 16],
		['172.16.0.0', 12],
		['192.0.0.0', 24],
		['192.0.2.0', 24],
		['192.168.0.0', 16],
		['198.18.0.0', 15],
		['198.51.100.0', 24],
		['203.0.113.0', 24],
		['224.0.0.0', 3]
	], i = 0; i < list.length; i++) {
	var ip = list[i][0],
		prefix = list[i][1];
	blocked.addSubnet(ip, prefix, 'ipv4');
}

for (var list = [
		['2001:db8::', 32],
		['2001::', 23],
		['2002::', 16]
	], i = 0; i < list.length; i++) {
	var ip = list[i][0],
		prefix = list[i][1];
	blocked.addSubnet(ip, prefix, 'ipv6');
}

function publicip(ip) {
	var family = Net.isIP(ip);
	return family === 4 ? !blocked.check(ip, 'ipv4') : family === 6 && /^[23][0-9a-f]{3}:/i.test(ip) && !blocked.check(ip, 'ipv6');
}

var numericpattern = /^[0-9]+$/;

function host(value) {

	value = String(value || '')
		.trim()
		.toLowerCase()
		.replace(/\.$/, '');
	// A top-level domain is never numeric, so this also refuses the IPv4 forms that Net.isIP() does not know and that the system
	// resolver reads in its own way (0127.0.0.1, 0x7f.0.0.1, 127.1): they are not mail server names.
	if (
		value.length > 253 ||
		Net.isIP(value) ||
		!value.includes('.') ||
		numericpattern.test(value.slice(value.lastIndexOf('.') + 1)) ||
		!value.split('.').every(function(x) { return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(x); })
	)
		throw Error('@(Enter a valid public server hostname.)');
	return value;
}

function bounded(promise, ms) {
	return new Promise(function(resolve, reject) {
		var timer = setTimeout(function() { return reject(Error('DNS timeout')); }, ms);
		promise.then(
			function(value) {
				clearTimeout(timer);
				resolve(value);
			},
			function(err) {
				clearTimeout(timer);
				reject(err);
			}
		);
	});
}

async function fetchconfig(url) {

	var target = new URL(url);
	if (target.protocol !== 'https:' || target.port)
		throw Error('Invalid configuration URL');
	var addresses = await bounded(
		dns.lookup(host(target.hostname), {
			all: true
		}),
		3000
	);
	if (!addresses.length || !addresses.every(function(a) { return publicip(a.address); }))
		throw Error('Private addresses are not allowed');
	return pinnedget(target, addresses[0], { limit: 64 * 1024, timeout: 4000 });
}

// One GET that connects only to `pinned` (the address that was just checked), whatever the name resolves to later: the
// certificate is still verified against the name. No redirects, and the answer may not be longer than `limit` bytes.
// (The RESTBuilder of total5@0.0.19 neither keeps a custom Agent nor applies maxlength, so this request is made directly.)
// `extra` is for tests: a port and a certificate authority of their own.
function pinnedget(target, pinned, options, extra) {
	return new Promise(function(resolve, reject) {
		var chunks = [], size = 0, finished = false, timer;
		var request = Total.Https.request(
			Object.assign({
				protocol: 'https:',
				hostname: target.hostname,
				servername: target.hostname,
				path: target.pathname + target.search,
				method: 'GET',
				agent: false,
				headers: { accept: 'application/xml, text/xml, */*', 'user-agent': 'TotalMail' },
				lookup: function(name, opts, cb) { return opts && opts.all ? cb(null, [{ address: pinned.address, family: pinned.family }]) : cb(null, pinned.address, pinned.family); }
			}, extra || {}),
			function(response) {
				if (response.statusCode !== 200)
					return finish(Error('Configuration unavailable'));
				response.on('data', function(chunk) {
					size += chunk.length;
					if (size > options.limit)
						return finish(Error('Configuration too large'));
					chunks.push(chunk);
				});
				response.on('end', function() { finish(null, Buffer.concat(chunks).toString('utf8')); });
				response.on('error', function() { finish(Error('Configuration unavailable')); });
			}
		);
		function finish(error, value) {
			if (finished)
				return;
			finished = true;
			clearTimeout(timer);
			request.destroy();
			if (error)
				reject(error);
			else
				resolve(value);
		}
		timer = setTimeout(function() { finish(Error('Discovery timeout')); }, options.timeout);
		request.on('error', function() { finish(Error('Discovery timeout')); });
		request.end();
	});
}

function parseconfig(xml, email) {

	if (/<!DOCTYPE|<!ENTITY/i.test(xml))
		throw Error('Unsupported XML');
	var tree = xml.parseXML2();
	function server(type) {

		var nodes = tree.find(type === 'imap' ? 'incomingServer' : 'outgoingServer');
		for (var list = Array.from(nodes), i = 0; i < list.length; i++) {
			var node = list[i];
			if (node.attr('type') !== type)
				continue;
			var socket = node.find('socketType').text().trim().toUpperCase();
			if (!['SSL', 'STARTTLS'].includes(socket))
				continue;
			var authentication = node.find('authentication').text().trim();
			var username = node
				.find('username')
				.text()
				.trim()
				.replace(/%EMAILADDRESS%/g, email)
				.replace(/%EMAILLOCALPART%/g, email.split('@')[0])
				.replace(/%EMAILDOMAIN%/g, email.split('@')[1]);
			try {
				var port = Number(node.find('port').text());
				if (!Number.isInteger(port) || port < 1 || port > 65535)
					continue;
				return {
					host: host(node.find('hostname').text()),
					port,
					security: socket === 'SSL' ? 'tls' : 'starttls',
					username: username || email,
					authentication
				};
			} catch {}
		}
		return null;
	}
	var imap = server('imap'),
		smtp = server('smtp');
	return imap && smtp
		? {
			imap,
			smtp
		}
		: null;
}

async function srv(name, security, email) {
	try {
		var records = (await bounded(dns.resolveSrv(name), 2000)).sort(function(a, b) { return a.priority - b.priority; });
		for (var list = Array.from(records), i = 0; i < list.length; i++) {
			var r = list[i];
			try {
				return {
					host: host(r.name),
					port: r.port,
					security,
					username: email,
					authentication: 'password'
				};
			} catch {}
		}
	} catch {}
	return null;
}

exports.discover = async function(email) {

	var domain = host(email.split('@')[1]);
	// Domain-only requests: discovery never transmits a password or the mailbox address.
	var urls = [
		'https://autoconfig.' + domain + '/mail/config-v1.1.xml',
		'https://' + domain + '/.well-known/autoconfig/mail/config-v1.1.xml',
		'https://autoconfig.thunderbird.net/v1.1/' + domain
	];
	var attempts = await Promise.all(
		urls.map(async function(url) {
			try {
				var settings = parseconfig(await fetchconfig(url), email);
				return settings
					? Object.assign({}, settings, { source: url })
					: null;
			} catch {
				return null;
			}
		})
	);
	var found = attempts.find(Boolean);
	if (found)
		return Object.assign({}, found, { detected: true,
			oauth: found.imap.authentication.toLowerCase().includes('oauth') || found.smtp.authentication.toLowerCase().includes('oauth') });
	var tmp = await Promise.all([srv('_imaps._tcp.' + domain, 'tls', email), srv('_submissions._tcp.' + domain, 'tls', email)]);
	var imap = tmp[0], smtp = tmp[1];
	var incoming = imap || (await srv('_imap._tcp.' + domain, 'starttls', email)),
		outgoing = smtp || (await srv('_submission._tcp.' + domain, 'starttls', email));
	if (incoming && outgoing)
		return {
			imap: incoming,
			smtp: outgoing,
			source: 'DNS SRV',
			detected: true,
			oauth: false
		};
	return {
		imap: {
			host: 'imap.' + domain,
			port: 993,
			security: 'tls',
			username: email
		},
		smtp: {
			host: 'smtp.' + domain,
			port: 465,
			security: 'tls',
			username: email
		},
		source: 'manual',
		detected: false,
		oauth: false
	};
};

exports.host = host;
exports.publicIP = publicip;
exports.pinnedget = pinnedget;
