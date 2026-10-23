// Support for a mail account that does not work: it walks through what a technician would check, one step at a time, and says in
// plain words what is wrong and what to do about it. For each server (incoming and outgoing): are the settings coherent, does the
// name exist, does it answer, is the encryption modern and the certificate valid, does it accept the sign-in. Then the domain of the
// address: MX, SPF and DMARC. The password only goes to the configured server, over a connection whose certificate was verified.
// The messages are written as translatable texts and translated by the caller; {0}, {1} are filled in by it.
var ports = {
	imap: { tls: [993], starttls: [143] },
	smtp: { tls: [465], starttls: [587, 25] }
};

var certificate = {
	CERT_HAS_EXPIRED: '@(The server certificate has expired.)',
	DEPTH_ZERO_SELF_SIGNED_CERT: '@(The server certificate is self-signed: nobody vouches for it.)',
	SELF_SIGNED_CERT_IN_CHAIN: '@(The server certificate chain contains a self-signed certificate.)',
	UNABLE_TO_VERIFY_LEAF_SIGNATURE:
		'@(The server certificate is not signed by an authority this server trusts, or the chain is incomplete.)',
	UNABLE_TO_GET_ISSUER_CERT_LOCALLY:
		'@(The server certificate is not signed by an authority this server trusts, or the chain is incomplete.)',
	ERR_TLS_CERT_ALTNAME_INVALID: '@(The server certificate was issued for another name, not for {0}.)',
	CERT_NOT_YET_VALID: '@(The server certificate is not valid yet. Check the date of the server.)'
};

exports.create = function(dependencies) {

	var Net = dependencies.net || Total.Net,
		Tls = dependencies.tls || Total.Tls,
		Dns = dependencies.dns || Total.Dns.promises,
		resolve = dependencies.resolve,
		now = dependencies.now || (() => Date.now()),
		timeout = dependencies.timeout || 10000;
	// ---- Talking to a server
	// Reads what a server sends as lines; each waiter gets the next reply (SMTP: lines up to "250 ..."; IMAP: up to the tagged answer).
	function reader(socket) {

		var buffer = '',
			waiting = null,
			ended = null;
		function check() {

			if (!waiting)
				return;
			var lines = buffer.split('\r\n'),
				done = -1;
			for (var i = 0; i < lines.length - 1; i++)
				if (waiting.finished(lines[i])) {
					done = i;
					break;
				}
			if (done < 0)
				return ended ? waiting.fail(ended) : null;
			var text = lines.slice(0, done + 1);
			buffer = lines.slice(done + 1).join('\r\n');
			var current = waiting;
			waiting = null;
			clearTimeout(current.timer);
			current.resolve(text);
		}
		var onData = (chunk) => {
			buffer += chunk;
			check();
		};
		var onEnd = () => {

			ended = Error('closed');
			ended.code = 'ECONNRESET';
			check();
		};
		var onError = (error) => {
			ended = error;
			check();
		};
		socket.setEncoding('utf8');
		socket.on('data', onData);
		socket.on('end', onEnd);
		socket.on('close', onEnd);
		socket.on('error', onError);
		return {
			// finished(line) says whether the line closes the reply.
			wait: (finished) =>
				new Promise((resolve, reject) => {

					var fail = (error) => {

						waiting = null;
						clearTimeout(timer);
						reject(error);
					};
					var timer = setTimeout(() => {

						var error = Error('timeout');
						error.code = 'ETIMEDOUT';
						fail(error);
					}, timeout);
					waiting = { finished, resolve, fail, timer };
					check();
				}),
			stop() {

				socket.removeListener('data', onData);
				socket.removeListener('end', onEnd);
				socket.removeListener('close', onEnd);
				socket.removeListener('error', onError);
			}
		};
	}
	var smtpend = (line) => /^\d{3} /.test(line);
	var code = (lines) => parseInt(lines[lines.length - 1].slice(0, 3));
	// A connection, encrypted from the start (security tls) or plain until STARTTLS.
	function connect(target, port, secure, verify) {
		return new Promise((resolve, reject) => {

			var socket,
				timer = setTimeout(() => {

					var error = Error('timeout');
					error.code = 'ETIMEDOUT';
					socket.destroy();
					reject(error);
				}, timeout);
			var options = { host: target.address, port };
			if (secure)
				socket = Tls.connect({
					...options,
					servername: target.servername,
					rejectUnauthorized: verify,
					// A server on an old version is reported, not refused, unless the account is going to use it.
					minVersion: verify ? 'TLSv1.2' : 'TLSv1'
				});
			else
				socket = Net.connect(options);
			socket.once('error', (error) => {
				clearTimeout(timer);
				reject(error);
			});
			socket.once(secure ? 'secureConnect' : 'connect', () => {

				clearTimeout(timer);
				socket.removeAllListeners('error');
				socket.on('error', () => {});
				resolve(socket);
			});
		});
	}
	function upgrade(socket, target, verify) {
		return new Promise((resolve, reject) => {

			var secure = Tls.connect({
				socket,
				servername: target.servername,
				rejectUnauthorized: verify,
				minVersion: verify ? 'TLSv1.2' : 'TLSv1'
			});
			secure.once('error', reject);
			secure.once('secureConnect', () => {

				secure.removeAllListeners('error');
				secure.on('error', () => {});
				resolve(secure);
			});
		});
	}
	// What the encryption of an open connection is like.
	function secrecy(socket, target) {

		var cert = socket.getPeerCertificate && socket.getPeerCertificate();
		var info = {
			version: socket.getProtocol && socket.getProtocol(),
			authorized: socket.authorized === true,
			error: socket.authorizationError
		};
		if (cert && cert.valid_to)
			info.days = Math.floor((new Date(cert.valid_to).getTime() - now()) / 86400000);
		info.name = target.servername;
		return info;
	}
	// The conversation up to an encrypted connection. Returns { socket, talk, ehlo, secure: info, offered } or throws.
	async function session(kind, target, config, verify) {

		var secure = config.security === 'tls',
			socket = await connect(target, config.port, secure, verify),
			talk = reader(socket),
			offered = { starttls: false, auth: [], capability: [] };
		try {
			if (kind === 'smtp') {
				var greeting = await talk.wait(smtpend);
				if (code(greeting) !== 220)
					throw Object.assign(Error('greeting'), { reply: greeting.join(' ') });
				var ehlo = async () => {

					socket.write('EHLO totalmail.local\r\n');
					var lines = await talk.wait(smtpend);
					for (var line of lines) {
						var word = line.slice(4).toUpperCase();
						if (word === 'STARTTLS')
							offered.starttls = true;
						if (word.startsWith('AUTH '))
							offered.auth = word.slice(5).split(/[ =]+/);
					}
					return lines;
				};
				await ehlo();
				if (!secure) {
					if (!offered.starttls)
						throw Object.assign(Error('nostarttls'), { offered });
					socket.write('STARTTLS\r\n');
					var go = await talk.wait(smtpend);
					if (code(go) !== 220)
						throw Object.assign(Error('starttls'), { reply: go.join(' ') });
					talk.stop();
					socket = await upgrade(socket, target, verify);
					talk = reader(socket);
					offered.auth = [];
					await ehlo();
				}
			} else {
				var hello = await talk.wait((line) => /^\* (OK|PREAUTH|BYE|NO|BAD)/i.test(line));
				if (!/^\* OK/i.test(hello[0]))
					throw Object.assign(Error('greeting'), { reply: hello[0] });
				socket.write('a1 CAPABILITY\r\n');
				var caps = await talk.wait((line) => /^a1 (OK|NO|BAD)/i.test(line));
				offered.capability = (caps.find((line) => /^\* CAPABILITY/i.test(line)) || '').toUpperCase().split(' ').slice(2);
				offered.starttls = offered.capability.includes('STARTTLS');
				if (!secure) {
					if (!offered.starttls)
						throw Object.assign(Error('nostarttls'), { offered });
					socket.write('a2 STARTTLS\r\n');
					var ok = await talk.wait((line) => /^a2 (OK|NO|BAD)/i.test(line));
					if (!/^a2 OK/i.test(ok[ok.length - 1]))
						throw Object.assign(Error('starttls'), { reply: ok.join(' ') });
					talk.stop();
					socket = await upgrade(socket, target, verify);
					talk = reader(socket);
				}
			}
		} catch (error) {
			talk.stop();
			socket.destroy();
			throw error;
		}
		return { socket, talk, offered, secure: secrecy(socket, target) };
	}
	// ---- The report
	function checks() {
		var list = [];
		return {
			list,
			// The texts may hold {0}, {1}...: args fills them in (the caller translates first).
			add(section, status, title, args, advice) {
				list.push({ section, status, title, args: Array.isArray(args) ? args : args ? [args] : [], advice: advice || '' });
			}
		};
	}
	// What a failed connection usually means.
	function reason(error, host, port) {

		var c = error && error.code;
		if (c === 'ECONNREFUSED')
			return ['@(Nothing answers on port {1}.)', '@(Check the port: the server is not listening there, or the service is off.)'];
		if (c === 'ETIMEDOUT' || c === 'EHOSTUNREACH' || c === 'ENETUNREACH')
			return [
				'@(The server does not answer at {0}:{1}.)',
				'@(A firewall may be blocking the port, the port may be wrong, or the server may be down. Ask the provider, and check that this server is allowed to reach it.)'
			];
		if (c === 'ECONNRESET' || c === 'EPIPE')
			return [
				'@(The server closed the connection.)',
				'@(The connection mode may be wrong for this port: port 465 and 993 expect TLS from the start, 587 and 143 expect STARTTLS.)'
			];
		if (c === 'ERR_SSL_WRONG_VERSION_NUMBER' || /wrong version number/i.test(error && error.message))
			return [
				'@(The server does not speak TLS on this port.)',
				'@(Choose STARTTLS for this port, or use the port the provider gives for TLS.)'
			];
		if (c === 'ERR_SSL_TLSV1_ALERT_PROTOCOL_VERSION' || /protocol version|unsupported protocol/i.test(error && error.message))
			return [
				'@(The server only offers an outdated TLS version.)',
				'@(TotalMail needs TLS 1.2 or newer. The provider must update the server.)'
			];
		return ['@(The connection failed.)', '@(Check the host name, the port and the connection mode.)'];
	}
	// Settings that cannot work together, found without touching the network.
	function sanity(out, kind, config) {

		var section = kind === 'imap' ? 'incoming' : 'outgoing',
			normal = ports[kind];
		if (config.security === 'tls' && !normal.tls.includes(config.port) && normal.starttls.includes(config.port)) {
			out.add(
				section,
				'fail',
				'@(Port {0} normally uses STARTTLS, not TLS from the start.)',
				[config.port],
				'@(Change the connection mode to STARTTLS, or use the TLS port.)'
			);
			return false;
		}
		if (config.security === 'starttls' && !normal.starttls.includes(config.port) && normal.tls.includes(config.port)) {
			out.add(
				section,
				'fail',
				'@(Port {0} normally uses TLS from the start, not STARTTLS.)',
				[config.port],
				'@(Change the connection mode to TLS, or use the STARTTLS port.)'
			);
			return false;
		}
		if (kind === 'smtp' && config.port === 25)
			out.add(
				section,
				'warn',
				'@(Port 25 is for mail between servers.)',
				[],
				'@(Most providers and networks block it for people: use 587 with STARTTLS, or 465 with TLS.)'
			);
		return true;
	}
	function classifysmtp(lines) {

		var text = lines.join(' ').toLowerCase(),
			c = code(lines);
		if (c === 235)
			return ['ok'];
		if (c === 534 || /app.?specific|application.?specific|app password/.test(text))
			return [
				'fail',
				'@(The server asks for an app password, not your normal password.)',
				'@(Create an app password in your account security settings and use it here.)'
			];
		if (c === 535 || c === 530 || c === 538)
			return [
				'fail',
				'@(The server rejected the user name or password.)',
				'@(Check the user name, often the full address, and the password. If two-step verification is on, an app password is needed.)'
			];
		if (c >= 400 && c < 500)
			return [
				'warn',
				'@(The server asked to try again later.)',
				'@(Too many attempts, or a temporary problem. Wait a few minutes before trying again.)'
			];
		return [
			'fail',
			'@(The server refused the sign-in.)',
			'@(Check that sending is allowed for this mailbox and that the settings are right.)'
		];
	}
	async function outgoingauth(out, account, password, target) {

		// OAuth is signed in by the same code that sends, so its own answer is what counts.
		if (account.authType === 'oauth2')
			try {
				await dependencies.smtp(account, password, target);
				return out.add('outgoing', 'ok', '@(The sign-in is accepted.)');
			} catch {
				return out.add(
					'outgoing',
					'fail',
					'@(The server refused the sign-in for sending.)',
					'',
					'@(The organization may have SMTP AUTH turned off for this mailbox: ask its administrator to enable it.)'
				);
			}

		if (!password)
			return out.add('outgoing', 'skip', '@(Sign-in not tried: there is no saved password.)');
		var s;
		try {
			s = await session('smtp', target, account.smtp, true);
		} catch (error) {
			return out.add(
				'outgoing',
				'skip',
				'@(Sign-in not tried.)',
				'',
				error.code || error.message === 'nostarttls' || error.message === 'starttls'
					? '@(Fix the connection problems above first.)'
					: ''
			);
		}
		try {
			var offered = s.offered.auth;
			if (!offered.length)
				return out.add(
					'outgoing',
					'fail',
					'@(The server does not offer sign-in.)',
					'',
					'@(Check the port and the connection mode: this may be a server that only receives mail.)'
				);
			if (!offered.includes('PLAIN') && !offered.includes('LOGIN'))
				return out.add(
					'outgoing',
					'warn',
					'@(The server only offers sign-in methods TotalMail does not use: {0}.)',
					offered.join(', '),
					'@(Ask the provider for the settings to use with a mail program.)'
				);
			var secret = Buffer.from('\0' + account.smtp.username + '\0' + password).toString('base64');
			s.socket.write('AUTH PLAIN ' + secret + '\r\n');
			var answer = await s.talk.wait(smtpend);
			var verdict = classifysmtp(answer);
			out.add('outgoing', verdict[0], verdict[0] === 'ok' ? '@(The sign-in is accepted.)' : verdict[1], '', verdict[2]);
			try {
				s.socket.write('QUIT\r\n');
			} catch {}
		} catch (error) {
			out.add('outgoing', 'warn', '@(The sign-in could not be checked.)', '', '@(The server stopped answering.)');
		} finally {
			s.talk.stop();
			s.socket.destroy();
		}
	}
	async function incomingauth(out, account, password, target, hint) {
		if (!password && account.authType !== 'oauth2')
			return out.add('incoming', 'skip', '@(Sign-in not tried: there is no saved password.)');
		try {
			await dependencies.imap(account, password, target);
			out.add('incoming', 'ok', '@(The sign-in is accepted.)');
		} catch (error) {
			if (error && error.authenticationFailed)
				return out.add(
					'incoming',
					'fail',
					'@(The server rejected the user name or password.)',
					'',
					hint === 'oauth2'
						? '@(This provider requires OAuth: choose it as the account type and follow its guide.)'
						: hint === 'app-password'
							? '@(This provider needs an app password: choose it as the account type and follow its guide.)'
							: '@(Check the user name, often the full address, and the password. If two-step verification is on, an app password is needed.)'
				);
			var why = reason(error);
			out.add('incoming', 'fail', why[0], [account.imap.host, account.imap.port], why[1]);
		}
	}
	// One server: settings, name, connection, encryption, then the sign-in.
	async function server(out, kind, account, password, hint) {

		var section = kind === 'imap' ? 'incoming' : 'outgoing',
			config = account[kind],
			host = config.host,
			port = config.port;
		var logged = (status, title, detail, advice) => out.add(section, status, title, detail, advice);
		if (!sanity(out, kind, config))
			return;
		var target;
		try {
			target = await resolve(host);
			logged('ok', '@(The name {0} exists and points to {1}.)', [host, target.address]);
		} catch (error) {
			var message = error && error.message && error.message.startsWith('@(') ? error.message : '';
			return logged(
				'fail',
				message || '@(The name {0} does not exist.)',
				[host],
				message ? '' : '@(Check the spelling of the host name, or ask the provider for it.)'
			);
		}
		var verified = false;
		try {
			var probe = await session(kind, target, config, false);
			try {
				var s = probe.secure;
				logged('ok', '@(The server answers and the connection is encrypted with {0}.)', [s.version]);
				if (/^TLSv1(\.1)?$/.test(s.version || '') || /^SSL/.test(s.version || ''))
					logged(
						'fail',
						'@(The server uses an outdated TLS version: {0}.)',
						s.version,
						'@(TotalMail needs TLS 1.2 or newer. The provider must update the server.)'
					);
				if (s.authorized)
					verified = true;
				else if (certificate[s.error])
					logged(
						'fail',
						certificate[s.error],
						[host],
						'@(Do not use this server until its certificate is fixed: your password could be sent to someone else.)'
					);
				else if (s.error)
					logged(
						'fail',
						'@(The server certificate cannot be verified.)',
						String(s.error),
						'@(Do not use this server until its certificate is fixed.)'
					);
				if (s.authorized && s.days !== undefined)
					if (s.days < 0)
						logged('fail', certificate.CERT_HAS_EXPIRED, '', '@(The provider must renew it.)');
					else if (s.days < 14)
						logged(
							'warn',
							'@(The server certificate expires in {0} days.)',
							String(s.days),
							'@(The provider should renew it soon.)'
						);
					else
						logged('ok', '@(The certificate is valid and matches the name; it expires in {0} days.)', [s.days]);

				if (kind === 'smtp' && probe.offered.auth.length)
					logged('ok', '@(Sign-in methods offered: {0}.)', probe.offered.auth.join(', '));
			} finally {
				probe.talk.stop();
				probe.socket.destroy();
			}
		} catch (error) {
			if (error.message === 'nostarttls')
				return logged(
					'fail',
					'@(The server does not offer STARTTLS on this port.)',
					'',
					'@(Without encryption TotalMail will not send your password. Use the TLS port, 465 or 993, or ask the provider.)'
				);
			if (error.reply)
				return logged(
					'fail',
					'@(The server answered something unexpected: {0}.)',
					String(error.reply).slice(0, 120),
					'@(This may not be a mail server, or the connection mode may be wrong for this port.)'
				);
			var why = reason(error);
			return logged('fail', why[0], [host, port], why[1]);
		}
		if (!verified)
			return logged(
				'skip',
				'@(Sign-in not tried.)',
				'',
				'@(It is only tried once the certificate can be verified, so your password is never sent to an unverified server.)'
			);
		if (kind === 'imap')
			await incomingauth(out, account, password, target, hint);
		else
			await outgoingauth(out, account, password, target);
	}
	// MX, SPF and DMARC of the address's domain: they decide whether what you send arrives, not whether the account connects.
	async function domain(out, email) {

		var name = String(email).split('@')[1];
		if (!name)
			return;
		var lookup = async (fn, ...args) => {
			try {
				return await fn(...args);
			} catch {
				return [];
			}
		};
		var mx = await lookup(Dns.resolveMx, name);
		if (!mx.length)
			out.add(
				'domain',
				'warn',
				'@(The domain {0} has no MX record.)',
				[name],
				'@(It cannot receive mail until its provider gives it one.)'
			);
		else
			out.add('domain', 'ok', '@(The domain receives mail through {0}.)', mx.sort((a, b) => a.priority - b.priority)[0].exchange);
		var txt = (await lookup(Dns.resolveTxt, name)).map((x) => x.join(''));
		var spf = txt.find((x) => /^v=spf1\b/i.test(x));
		if (!spf)
			out.add(
				'domain',
				'warn',
				'@(The domain has no SPF record.)',
				'',
				'@(Without it, mail you send may be marked as spam. Add the one your provider gives you.)'
			);
		else if (/[+?]all\b/i.test(spf))
			out.add(
				'domain',
				'warn',
				'@(The SPF record lets any server send for this domain.)',
				spf.slice(0, 120),
				'@(End it with ~all or -all so only your provider can send.)'
			);
		else
			out.add('domain', 'ok', '@(The domain has an SPF record.)');
		var dmarc = (await lookup(Dns.resolveTxt, '_dmarc.' + name)).map((x) => x.join('')).find((x) => /^v=DMARC1/i.test(x));
		if (!dmarc)
			out.add(
				'domain',
				'warn',
				'@(The domain has no DMARC record.)',
				'',
				'@(Large providers increasingly ask for it. Your provider can tell you what to publish.)'
			);
		else if (/\bp=none\b/i.test(dmarc))
			out.add(
				'domain',
				'ok',
				'@(The domain has a DMARC record that only monitors.)',
				'',
				'@(Later, you can ask your provider to enforce it.)'
			);
		else
			out.add('domain', 'ok', '@(The domain has a DMARC record.)');
	}
	return {
		// hint: 'oauth2', 'app-password' or '' for the provider of the address.
		async run(account, password, hint = '') {

			var out = checks();
			await server(out, 'imap', account, password, hint);
			await server(out, 'smtp', account, password, hint);
			await domain(out, account.email);
			var failed = out.list.filter((c) => c.status === 'fail').length,
				warned = out.list.filter((c) => c.status === 'warn').length;
			return { checks: out.list, failed, warned };
		}
	};
};
