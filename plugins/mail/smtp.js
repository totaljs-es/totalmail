var Threading = require('./threading');
var Format = require('./public/format');

exports.create = function(mailer) {
	var run = function(options, message) {
		return new Promise(function(resolve, reject) {

			var before = new Set(Object.keys(mailer.connections || {}));
			var owned = [];
			var timer = setTimeout(function() {
				for (var list = Array.from(owned), i = 0; i < list.length; i++) {
					var id = list[i];
					var connection = mailer.connections[id];
					if (connection) {
						connection.callback = null;
						mailer.destroy(connection);
					}
				}
				reject(Error('@(SMTP could not confirm the operation. Check the account and Sent folder before retrying.)'));
			}, 30000);
			mailer.send(options, message, function(error) {
				clearTimeout(timer);
				error
					? reject(Error('@(SMTP could not confirm the operation. Check the account and Sent folder before retrying.)'))
					: resolve({
						confirmed: true,
						source: (message && message.$source),
						messageId: (message && message.$messageid)
					});
			});
			owned = Object.keys(mailer.connections || {}).filter(function(id) { return !before.has(id); });
		});
	};
	return {
		options(account, password, target) {
			return Object.assign({ server: target.address,
				servername: target.servername,
				port: account.smtp.port,
				secure: account.smtp.security === 'tls',
				tls: {
					servername: target.servername,
					rejectUnauthorized: true,
					minVersion: 'TLSv1.2'
				},
				rejectUnauthorized: true,
				minVersion: 'TLSv1.2',
				user: account.smtp.username }, account.authType === 'oauth2' ? { token: password } : { password }, { timeout: 15000,
				keepalive: false });
		},
		verify(options) {
			return run(options, undefined);
		},
		send(options, account, draft, recipients, parent, copies = [], attachments = [], blind = []) {

			// Formatting (bold, links, lists…) adds an HTML part; the plain text part always goes with it.
			var formatted = Format.render(draft.body);
			var message = mailer.create(draft.subject, formatted ? formatted.plain : draft.body);
			message.type = 'plain';
			if (formatted)
				message.$html = formatted.html;
			message.$capture = true;
			message.$messageid = draft.messageId || '<' + Total.Crypto.randomBytes(24).toString('hex') + '@' + (String(account.email).split('@')[1] || 'totalmail.local') + '>';
			message.headers = Threading.headers(parent);
			message.from(account.email, account.name);
			for (var list = Array.from(recipients), i = 0; i < list.length; i++) {
				var recipient = list[i];
				message.to(recipient);
			}
			for (var list = Array.from(copies), i = 0; i < list.length; i++) {
				var recipient = list[i];
				message.cc(recipient);
			}
			// Hidden recipients only travel in the envelope: the message and the copy kept in Sent carry no Bcc header.
			for (var list = Array.from(blind), i = 0; i < list.length; i++) {
				var recipient = list[i];
				message.bcc(recipient);
			}
			for (var list = Array.from(attachments), i = 0; i < list.length; i++) {
				var file = list[i];
				message.attachment(file.content, file.name);
			}
			return run(options, message);
		}
	};
};
