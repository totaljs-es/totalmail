const Threading = require('./threading');
const Format = require('../plugins/mail/public/format');

exports.create = function(mailer) {
	var run = (options, message, bytes = 0) =>
		new Promise((resolve, reject) => {

			var before = new Set(Object.keys(mailer.connections || {}));
			let owned = [];
			var timer = setTimeout(() => {
				for (var id of owned) {
					var connection = mailer.connections[id];
					if (connection) {
						connection.callback = null;
						mailer.destroy(connection);
					}
				}
				reject(Error('@(SMTP could not confirm the operation. Check the account and Sent folder before retrying.)'));
			}, 30000);
			mailer.send(options, message, (error) => {
				clearTimeout(timer);
				error
					? reject(Error('@(SMTP could not confirm the operation. Check the account and Sent folder before retrying.)'))
					: resolve({
						confirmed: true,
						source: message?.$source,
						messageId: message?.$messageid
					});
			});
			owned = Object.keys(mailer.connections || {}).filter((id) => !before.has(id));
		});
	return {
		options(account, password, target) {
			return {
				server: target.address,
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
				user: account.smtp.username,
				// OAuth accounts authenticate with XOAUTH2 and an access token.
				...(account.authType === 'oauth2' ? { token: password } : { password }),
				timeout: 15000,
				keepalive: false
			};
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
			message.$messageid = draft.messageId || '<' + Total.Crypto.randomBytes(24).toString('hex') + '@totalmail.local>';
			message.headers = Threading.headers(parent);
			message.from(account.email, account.name);
			for (var recipient of recipients)
				message.to(recipient);
			for (var recipient of copies)
				message.cc(recipient);
			// Hidden recipients only travel in the envelope: the message and the copy kept in Sent carry no Bcc header.
			for (var recipient of blind)
				message.bcc(recipient);
			var bytes = 0;
			for (var file of attachments) {
				message.attachment(file.content, file.name);
				bytes += file.content.length;
			}
			return run(options, message, bytes);
		}
	};
};
