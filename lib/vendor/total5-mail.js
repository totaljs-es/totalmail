// TotalMail compatibility copy of total5@0.0.19 mail.js. See docs/live-mail.md.
// Total.js SMTP sender
// The MIT License
// Copyright 2016-2023 (c) Peter Širka <petersirka@gmail.com>

const CRLF = '\r\n';
const REG_ESMTP = /\besmtp\b/i;
const REG_STATE = /\d+/;
const REG_WINLINE = /\r\n/g;
const REG_NEWLINE = /\n/g;
const REG_AUTH = /(AUTH LOGIN|AUTH PLAIN|PLAIN LOGIN|XOAUTH2|XOAUTH)/i;
const REG_TLS = /TLS/;
const REG_STARTTLS = /STARTTLS/;
const ATTACHMENT = { encoding: 'base64' };

var INDEXATTACHMENT = 0;

const CRLF_BUFFER = Buffer.from(CRLF);
const CONCAT = [null, null];

var Mailer = {};
Mailer.debug = false;
Mailer.Message = Message;
Mailer.Mail = Message;
Mailer.connections = {};
Mailer.create = (subject, body) => new Message(subject, body);
F.TUtils.EventEmitter2.extend(Mailer);

function Message(subject, body) {
	var self = this;
	self.subject = subject || '';
	self.body = body || '';
	self.type = 'html';
	// self.files;
	self.email_to = [];
	// self.email_reply;
	// self.email_cc;
	// self.email_bcc;
	self.email_from = '';
	self.closed = false;
	self.tls = false;
	// self.$callback;

	// t.headers;
	// t.$unsubscribe;
}

Message.prototype.preview = function (val) {
	this.$preview = val;
	return this;
};

Message.prototype.unsubscribe = function (url) {
	var tmp = url.substring(0, 6);
	this.$unsubscribe = url ? (tmp === 'http:/' || tmp === 'https:' ? '<' + url + '>' : '<mailto:' + url + '>') : null;
	return this;
};

Message.prototype.callback = function (fn) {
	this.$callback = fn;
	return this;
};

Message.prototype.sender = Message.prototype.from = function (email, name) {
	this.email_from = email;
	this.email_from_name = name;
	return this;
};

Message.prototype.high = function () {
	this.$priority = 1;
	return this;
};

Message.prototype.low = function () {
	this.$priority = 5;
	return this;
};

Message.prototype.confidential = function () {
	this.$confidential = true;
	return this;
};

Message.prototype.to = function (value, clear) {
	var self = this;
	if (clear) self.email_to.length = 0;
	self.email_to.push(value);
	return self;
};

Message.prototype.cc = function (value, clear) {
	var self = this;
	if (clear || !self.email_cc) self.email_cc = [];
	self.email_cc.push(value);
	return self;
};

Message.prototype.bcc = function (value, clear) {
	var self = this;
	if (clear || !self.email_bcc) self.email_bcc = [];
	self.email_bcc.push(value);
	return self;
};

Message.prototype.reply = function (value, clear) {
	var self = this;
	if (clear || !self.email_reply) self.email_reply = [];
	self.email_reply.push(value);
	return self;
};

Message.prototype.attachment = function (filename, name, contentid) {
	var self = this;
	var type;
	var ext;

	if (name) {
		ext = F.TUtils.getExtension(name);
		type = F.TUtils.contentTypes[ext] || 'application/octet-stream';
	}

	var obj = {};
	obj.name = name;
	obj.filename = filename;
	obj.type = type;
	obj.ext = ext;

	if (contentid) {
		obj.disposition = 'inline';
		obj.contentid = contentid;
	}

	if (!self.files) self.files = [];

	self.files.push(obj);
	return self;
};

Message.prototype.attachmentfs = function (storage, id, name, contentid) {
	var self = this;
	var ext;
	var type;

	if (name) {
		ext = F.TUtils.getExtension(name);
		type = F.TUtils.contentTypes[ext];
	}

	var obj = {};
	obj.storage = storage;
	obj.name = name;
	obj.filename = id;
	obj.type = type;
	obj.ext = ext;

	if (contentid) {
		obj.disposition = 'inline';
		obj.contentid = contentid;
	}

	if (!self.files) self.files = [];

	self.files.push(obj);
	return self;
};

Message.prototype.manually = function () {
	this.$sending && clearImmediate(this.$sending);
	return this;
};

Message.prototype.send2 = function (callback) {
	var self = this;

	if (F.config.$tapi && F.config.$tapimail) {
		var data = {};

		data.to = [];

		for (let m of self.email_to) data.to.push(m);

		if (self.email_cc && self.email_cc.length) {
			data.cc = [];
			for (let m of self.email_cc) data.cc.push(m);
		}

		if (self.email_bcc && self.email_bcc.length) {
			data.bcc = [];
			for (let m of self.email_bcc) data.bcc.push(m);
		}

		if (self.email_reply && self.email_reply.length) {
			data.reply = [];
			for (let m of self.email_reply) data.reply.push(m);
		}

		data.from = self.email_from;
		data.subject = self.subject;
		data.type = self.type;
		data.body = self.body;
		data.priority = self.$priority;
		data.unsubscribe = self.$unsubscribe;
		data.confidential = self.$confidential;

		F.api('TAPI/mail', data).callback(callback || NOOP);
		return;
	}

	for (let key in F.temporary.smtp) {
		if (!F.config.smtp || F.config.smtp.server !== key) Mailer.destroy(F.temporary.smtp[key]);
	}

	Mailer.send(F.config.smtp, self, callback);
};

Message.prototype.send = function (options, callback) {
	var self = this;
	self.$callback2 = callback;
	Mailer.send(options, self, callback);
	return self;
};

Mailer.tls = function (obj, opt) {
	var self = this;

	obj.tls = true;
	obj.socket.removeAllListeners();

	var tlsoptions = {
		socket: obj.socket,
		servername: opt.servername,
		rejectUnauthorized: true,
		minVersion: 'TLSv1.2'
	};

	for (let key in opt.tls) tlsoptions[key] = opt.tls[key];

	obj.socket2 = F.Tls.connect(tlsoptions, () => self.$send(obj, opt, true));

	obj.socket2.on('error', function (err) {
		Mailer.destroy(obj);
		obj.closed = true;
		obj.callback && obj.callback(err);
		obj.callback = null;
		if (obj.try || err.stack.indexOf('ECONNRESET') !== -1) return;
		Mailer.$events.error && Mailer.emit('error', err, obj);
	});

	obj.socket2.on('clientError', function (err) {
		Mailer.destroy(obj);
		obj.callback && obj.callback(err);
		obj.callback = null;
		Mailer.$events.error && !obj.try && Mailer.emit('error', err, obj);
	});

	obj.socket2.on('connect', () => !opt.secure && self.$send(obj, opt));
};

Mailer.destroy = function (obj) {
	var self = this;

	if (obj.destroyed) return self;

	obj.destroyed = true;
	obj.closed = true;

	if (obj.socket) {
		obj.socket.removeAllListeners();
		obj.socket.end();
		obj.socket.destroy();
		obj.socket = null;
	}

	if (obj.socket2) {
		obj.socket2.removeAllListeners();
		obj.socket2.end();
		obj.socket2.destroy();
		obj.socket2 = null;
	}

	if (obj === F.temporary.smtp[obj.server]) delete F.temporary.smtp[obj.server];

	delete self.connections[obj.id];
	return self;
};

Mailer.$writeattachment = function (obj) {
	var attachment = obj.files ? obj.files.shift() : false;
	if (!attachment) {
		// TotalMail: the captured MIME copy ends with the closing boundary, before SMTP framing.
		if (obj.capture) obj.instance.$source = obj.capture.join('') + '--' + obj.boundary + '--' + CRLF;
		Mailer.$writeline(obj, '--' + obj.boundary + '--', '', '.');

		if (obj.messagecallback) {
			obj.messagecallback(null, obj.instance);
			obj.messagecallback = null;
		}

		if (obj.messagecallback2) {
			obj.messagecallback2(null, obj.instance);
			obj.messagecallback2 = null;
		}

		return this;
	}

	var stream;

	if (attachment.storage) {
		FILESTORAGE(attachment.storage).readbase64(attachment.filename, function (err, meta) {
			if (err) {
				F.error(err, 'Mail.filestorage()', attachment.filename);
				Mailer.$writeattachment(obj);
			} else {
				if (!attachment.name) {
					attachment.name = meta.name;
					attachment.type = meta.type;
					attachment.extension = meta.ext;
				}

				writeattachemnt_stream(attachment, obj, meta.stream);
			}
		});
	} else {
		if (attachment.filename instanceof Buffer) {
			writeattachemnt_stream(attachment, obj, attachment.filename);
		} else {
			F.stats.performance.open++;
			stream = F.Fs.createReadStream(attachment.filename, ATTACHMENT);
			writeattachemnt_stream(attachment, obj, stream);
		}
	}

	return this;
};

// TotalMail: sanitized filename (quotes/CRLF cannot break the header), RFC 2231 name for non-ASCII
// and 57-byte chunks so every 76-character base64 line is complete and unpadded.
function attachmentheader(name) {
	name = String(name || 'attachment').replace(/[\x00-\x1f\x7f"\\\/]+/g, '_');
	var ascii = name.replace(/[^\x20-\x7e]/g, '_');
	return 'filename="' + ascii + '"' + (ascii !== name ? '; filename*=UTF-8\'\'' + encodeURIComponent(name) : '');
}

function writeattachemnt_stream(attachment, obj, stream) {
	var isCalendar = attachment.extension === 'ics';
	var message = [];

	message.push('--' + obj.boundary);

	if (!isCalendar) {
		if (attachment.contentid) {
			message.push('Content-Disposition: inline; ' + attachmentheader(attachment.name));
			message.push('Content-ID: <' + attachment.contentid + '>');
		} else message.push('Content-Disposition: attachment; ' + attachmentheader(attachment.name));
	}

	message.push('Content-Type: ' + attachment.type + ';' + (isCalendar ? ' charset="utf-8"; method=REQUEST' : ''));
	message.push('Content-Transfer-Encoding: base64');
	message.push('');
	message.push('');

	var header = message.join(CRLF);
	Mailer.$writeline(obj, header);

	if (stream instanceof Buffer) {
		if (obj.capture) obj.capture.push(header + CRLF);
		writeattachmentbytesinline(obj, stream);
		Mailer.$writeline(obj, CRLF);
		if (obj.capture) obj.capture.push(CRLF + CRLF);
		Mailer.$writeattachment(obj);
	} else {
		// Streamed attachments are not part of the captured copy.
		obj.capture = null;
		stream.$mailerdata = obj;
		stream.on('data', writeattachmentbytes);
		F.cleanup(stream, function () {
			Mailer.$writeline(obj, CRLF);
			Mailer.$writeattachment(obj);
		});
	}
}

function writeattachmentbytes(chunk) {
	writeattachmentbytesinline(this.$mailerdata, chunk);
}

function writeattachmentbytesinline(mailerdata, chunk) {
	for (var beg = 0; beg < chunk.length; beg += 57) {
		var line = chunk.slice(beg, beg + 57).toString('base64');
		Mailer.$writeline(mailerdata, line);
		if (mailerdata.capture) mailerdata.capture.push(line + CRLF);
	}
}

Mailer.try = function (options, callback) {
	var self = this;
	if (callback) self.send(options, undefined, callback);
	else
		return new Promise((resolve, reject) =>
			self.send(options, undefined, (err) => (err ? reject(err) : resolve()))
		);
};

Mailer.send2 = function (messages, callback) {
	return this.send(F.config.smtp, messages, callback);
};

Mailer.send = function (opt, messages, callback) {
	var cache = opt.keepalive;
	var cached = cache ? F.temporary.smtp[opt.server] : null;

	if (cached) {
		if (messages instanceof Array) {
			var count = messages.length;
			F.stats.performance.mail += count;
			for (var i = 0; i < count; i++) cached.messages.push(messages[i]);
		} else if (messages) {
			F.stats.performance.mail++;
			cached.messages.push(messages);
		}
		cached.trytosend();
		return;
	}

	var self = this;
	var id = F.TUtils.guid();

	self.connections[id] = {};
	var obj = self.connections[id];

	obj.id = id;
	obj.buffer = [];
	obj.try = messages === undefined;
	obj.messages = obj.try ? F.EMPTYARRAY : messages instanceof Array ? messages : [messages];

	F.stats.performance.mail += obj.messages.length;

	obj.callback = callback;
	obj.closed = false;
	obj.message = null;
	obj.files = null;
	obj.count = 0;
	obj.socket;
	obj.tls = false;
	obj.date = new Date();

	if (opt.secure && !opt.port) opt.port = 465;

	if (!opt.server) {
		const err = new Error('No SMTP server configuration.');
		let iscallback = false;

		if (callback) {
			iscallback = true;
			callback(err);
		}

		for (let m of obj.messages) {
			if (m.$callback) {
				iscallback = true;
				m.$callback(err);
			}
		}

		if (!iscallback) F.error(err, 'mail_smtp');

		return self;
	}

	if (opt.secure) {
		let internal = F.TUtils.copy(opt);
		internal.host = opt.server;
		obj.socket = F.Tls.connect(internal, () => Mailer.$send(obj, opt));
	} else obj.socket = F.Net.createConnection(opt.port, opt.server);

	if (cache) {
		obj.trytosend = function () {
			if (!obj.sending && obj.messages && obj.messages.length) {
				obj.sending = true;
				obj.buffer = [];
				Mailer.$writemessage(obj, obj.buffer);
				Mailer.$writeline(obj, obj.buffer.shift());
			}
		};
		obj.TS = NOW.add(cache === true ? '10 minutes' : typeof cache === 'number' ? cache + ' minutes' : cache);
		F.temporary.smtp[opt.server] = obj;
	}

	obj.cached = cache;
	obj.smtp = opt;
	obj.socket.$host = opt.server;
	obj.host = opt.server.substring(opt.server.lastIndexOf('.', opt.server.lastIndexOf('.') - 1) + 1);

	obj.socket.on('error', function (err) {
		Mailer.destroy(obj);

		var is = obj.callback ? true : false;

		obj.callback && obj.callback(err);
		obj.callback = null;

		if (obj.try || err.stack.indexOf('ECONNRESET') !== -1) return;

		if (!obj.try && !is) {
			let iscallback = false;
			for (let m of obj.messages) {
				if (m.$callback) {
					iscallback = true;
					m.$callback(err);
				}
			}
			if (!iscallback) F.error(err, 'mail_smtp', opt.server);
		}

		if (obj === F.temporary.smtp[opt.server]) delete F.temporary.smtp[opt.server];

		Mailer.$events.error && Mailer.emit('error', err, obj);
	});

	obj.socket.on('clientError', function (err) {
		Mailer.destroy(obj);

		if (!obj.try && !obj.callback) {
			let iscallback = false;
			for (let m of obj.messages) {
				if (m.$callback) {
					iscallback = true;
					m.$callback(err);
				}
			}
			if (!iscallback) F.error(err, 'mail_smtp', opt.server);
		}

		obj.callback && obj.callback(err);
		obj.callback = null;

		if (obj === F.temporary.smtp[opt.server]) delete F.temporary.smtp[opt.server];

		if (Mailer.$events.error && !obj.try) Mailer.emit('error', err, obj);
	});

	if (!cache) {
		obj.socket.setTimeout(opt.timeout || 60000, function () {
			var err = F.TUtils.httpstatus(408);
			Mailer.destroy(obj);

			if (!obj.try && !obj.callback) {
				let iscallback = false;
				for (let m of obj.messages) {
					if (m.$callback) {
						iscallback = true;
						m.$callback(err);
					}
				}
				if (!iscallback) F.error(err, 'mail_smtp', opt.server);
			}

			obj.callback && obj.callback(err);
			obj.callback = null;

			if (obj === F.temporary.smtp[opt.server]) delete F.temporary.smtp[opt.server];

			if (Mailer.$events.error && !obj.try) Mailer.emit('error', err, obj);
		});
	}

	obj.sending = true;
	obj.socket.on('connect', () => !opt.secure && Mailer.$send(obj, opt));
};

Mailer.$writemessage = function (obj, buffer) {
	var self = this;
	var msg = obj.messages.shift();
	var message = [];

	F.stats.other.mail++;
	F.$events.$mail && F.emit('$mail', msg);

	var dt = obj.date.getTime();

	obj.boundary = '--total5' + dt;
	obj.files = msg.files;
	obj.count++;

	message.push('MIME-Version: 1.0');
	buffer.push('MAIL FROM: <' + msg.email_from + '>');

	if (!Mailer.domain) Mailer.domain = msg.email_from.substring(msg.email_from.lastIndexOf('@'));

	message.push(
		'Message-ID: ' + (msg.$messageid || '<total5X' + dt.toString(36) + 'X' + INDEXATTACHMENT++ + 'X' + INDEXATTACHMENT + Mailer.domain + '>')
	);

	self.$priority && message.push('X-Priority: ' + self.$priority);
	self.$confidential && message.push('Sensitivity: Company-Confidential');

	message.push(
		'From: ' +
			(msg.email_from_name ? unicode_encode(msg.email_from_name) + ' <' + msg.email_from + '>' : msg.email_from)
	);

	if (msg.headers) {
		for (let key in msg.headers) message.push(key + ': ' + msg.headers[key]);
	}

	var builder = '';
	var mail;

	if (msg.email_to.length) {
		for (let item of msg.email_to) {
			mail = '<' + item + '>';
			buffer.push('RCPT TO: ' + mail);
			builder += (builder ? ', ' : '') + mail;
		}
		message.push('To: ' + builder);
		builder = '';
	}

	if (msg.email_cc) {
		for (let item of msg.email_cc) {
			mail = '<' + item + '>';
			buffer.push('RCPT TO: ' + mail);
			builder += (builder ? ', ' : '') + mail;
		}
		message.push('Cc: ' + builder);
		builder = '';
	}

	if (msg.email_bcc) {
		for (let item of msg.email_bcc) buffer.push('RCPT TO: <' + item + '>');
	}

	buffer.push('DATA');
	buffer.push('');

	message.push('Date: ' + obj.date.toUTCString());
	message.push('Subject: ' + unicode_encode(msg.subject));

	if (msg.$unsubscribe) {
		message.push('List-Unsubscribe: ' + msg.$unsubscribe);
		message.push('List-Unsubscribe-Post: List-Unsubscribe=One-Click');
	}

	if (msg.email_reply) {
		for (let item of msg.email_reply) builder += (builder !== '' ? ', ' : '') + '<' + item + '>';
		message.push('Reply-To: ' + builder);
		builder = '';
	}

	message.push('Content-Type: multipart/mixed; boundary="' + obj.boundary + '"');
	message.push('');
	message.push('--' + obj.boundary);
	var encode = (text) => prepareBASE64(Buffer.from(text.replace(REG_WINLINE, '\n').replace(REG_NEWLINE, CRLF)).toString('base64'));
	if (msg.$html) {
		// TotalMail: formatted mail is a plain text part and an HTML part of the same message.
		var alternative = obj.boundary + '_alt';
		message.push('Content-Type: multipart/alternative; boundary="' + alternative + '"');
		message.push('');
		message.push('--' + alternative);
		message.push('Content-Type: text/plain; charset="utf-8"');
		message.push('Content-Transfer-Encoding: base64');
		message.push('');
		message.push(encode(msg.body));
		message.push('--' + alternative);
		message.push('Content-Type: text/html; charset="utf-8"');
		message.push('Content-Transfer-Encoding: base64');
		message.push('');
		message.push(encode(msg.$html));
		message.push('--' + alternative + '--');
	} else {
		message.push('Content-Type: text/' + msg.type + '; charset="utf-8"');
		message.push('Content-Transfer-Encoding: base64');
		message.push('');
		message.push(encode(msg.body));
	}

	// if (msg.type === 'html' && msg.$preview) {
	// 	message.push('--' + obj.boundary);
	// 	message.push('Content-Type: text/plain; charset="utf-8"; format="fixed"');
	// 	message.push('Content-Transfer-Encoding: base64');
	// 	message.push('');
	// 	message.push(prepareBASE64(Buffer.from(msg.$preview.replace(REG_WINLINE, '\n').replace(REG_NEWLINE, CRLF)).toString('base64')));
	// }

	obj.message = message.join(CRLF);
	// TotalMail captures its plain MIME copy before transport framing.
	if (msg.$capture) {
		if (msg.files?.length) obj.capture = [obj.message + CRLF];
		else msg.$source = obj.message + CRLF + '--' + obj.boundary + '--' + CRLF;
	}
	obj.messagecallback = msg.$callback;
	obj.messagecallback2 = msg.$callback2;
	obj.instance = msg;

	message = null;
	return self;
};

Mailer.$writeline = function (obj) {
	if (obj.closed) return false;

	var socket = obj.socket2 ? obj.socket2 : obj.socket;

	for (var i = 1; i < arguments.length; i++) {
		var line = arguments[i];
		if (line) {
			Mailer.debug && console.log('SEND', line);
			socket.write(line + CRLF);
		}
	}

	return true;
};

Mailer.$send = function (obj, options, autosend) {
	var self = this;
	var isAuthorized = false;
	var isAuthorization = false;
	var command = '';
	var auth = [];
	var socket = obj.socket2 ? obj.socket2 : obj.socket;
	var host = obj.host;
	var line = null;
	var isAttach = !options.tls || (obj.tls && options.tls);

	isAttach && Mailer.$events.send && Mailer.emit('send', obj);
	socket.setEncoding('utf8');

	socket.on('end', function () {
		Mailer.destroy(obj);
		obj.callback && obj.callback(new Error('SMTP connection ended without confirmation.'));
		obj.callback = null;
		if (obj.cached) delete F.temporary.smtp[obj.server];
		line = null;
	});

	socket.on('data', function (data) {
		if (obj.closed) return;

		while (true) {
			var index = data.indexOf(CRLF_BUFFER);
			if (index === -1) {
				if (line) {
					line = line + data;
				} else line = data;
				break;
			}

			var tmp = (line || '') + data.slice(0, index).toString('utf8');
			line = null;
			data = data.slice(index + CRLF_BUFFER.length);
			tmp && socket && socket.emit('line', tmp);
		}
	});

	socket.on('line', function (line) {
		line = line.toUpperCase();
		Mailer.debug && console.log('<---', line);

		var state = line.match(REG_STATE);
		if (!state) return;
		var code = +state[0];
		if (code === 235) obj.authenticated = true;
		if (code === 250 && !isAuthorization) {
			if (REG_AUTH.test(line) && options.user && (options.password || options.token)) {
				isAuthorization = true;
				if (options.token && line.indexOf('XOAUTH2') !== -1) {
					auth.push('AUTH XOAUTH2');
					auth.push(
						Buffer.from('user=' + options.user + '\x01auth=Bearer ' + options.token + '\x01\x01').toString(
							'base64'
						)
					);
				} else if (line.includes('LOGIN')) {
					auth.push('AUTH LOGIN');
					auth.push(Buffer.from(options.user).toString('base64'));
					auth.push(Buffer.from(options.password).toString('base64'));
				} else
					auth.push(
						'AUTH PLAIN ' + Buffer.from('\0' + options.user + '\0' + options.password).toString('base64')
					);
			}
		}

		// help
		if (line.substring(3, 4) === '-') return;

		if (!isAuthorized && isAuthorization) {
			isAuthorized = true;
			code = 334;
		}

		switch (code) {
			case 220:
				if (!options.secure && obj.isTLS) {
					Mailer.tls(obj, options);
				} else {
					obj.secured = REG_ESMTP.test(line);
					command = options.heloid
						? options.heloid
						: obj.isTLS || (options.user && options.password) || obj.secured
							? 'EHLO'
							: 'HELO';
					Mailer.$writeline(obj, command + ' ' + host);
				}

				return;

			case 250: // OPERATION
			case 251: // FORWARD
			case 235: // VERIFY
			case 999: // Total.js again
				if (!options.secure && obj.secured && !obj.isTLS && !obj.logged && obj.smtp.user && obj.smtp.password) {
					// maybe TLS
					obj.isTLS = true;
					Mailer.$writeline(obj, 'STARTTLS');
					return;
				}

				Mailer.$writeline(obj, obj.buffer.shift());

				if (obj.buffer.length) return;

				// NEW MESSAGE
				if (obj.messages.length) {
					obj.buffer = [];
					Mailer.$writemessage(obj, obj.buffer);
					Mailer.$writeline(obj, obj.buffer.shift());
				} else {
					obj.sending = false;

					// end
					if (obj.cached) obj.trytosend();
					else Mailer.$writeline(obj, 'QUIT');
				}

				return;

			case 221: // BYE
				if (options.user && !obj.authenticated) {
					var failure = obj.callback;
					obj.callback = null;
					Mailer.destroy(obj);
					failure && failure(new Error('SMTP authentication was not confirmed.'));
					return;
				}

				if (!obj.cached) Mailer.destroy(obj);

				obj.callback && obj.callback(null, obj.try ? true : obj.count);
				obj.callback = null;

				return;

			case 334: // LOGIN
				if (!options.secure && !obj.tls && !obj.isTLS && options.tls) {
					obj.isTLS = true;
					Mailer.$writeline(obj, 'STARTTLS');
					return;
				}

				var value = auth.shift();
				if (value) {
					obj.logged = true;
					Mailer.$writeline(obj, value);
				} else {
					const err2 = new Error('Forbidden.');
					Mailer.destroy(obj);
					obj.callback && obj.callback(err2);
					obj.callback = null;
					for (let m of obj.messages) {
						if (m.$callback) m.$callback(err2);
					}
					Mailer.$events.error && !obj.try && Mailer.emit('error', err2, obj);
				}

				return;

			case 354:
				Mailer.$writeline(obj, obj.message);
				Mailer.$writeattachment(obj);
				obj.message = null;
				return;

			default:
				if (code < 400) return;

				if (!obj.isTLS && code === 530 && REG_STARTTLS.test(line)) {
					obj.isTLS = true;
					Mailer.$writeline(obj, 'STARTTLS');
					return;
				}

				const err = line;
				let iscallback = false;

				Mailer.$events.error && !obj.try && Mailer.emit('error', err, obj);

				if (obj.messagecallback) {
					iscallback = true;
					obj.messagecallback(err, obj.instance);
					obj.messagecallback = null;
				}

				if (obj.messagecallback2) {
					iscallback = true;
					obj.messagecallback2(err, obj.instance);
					obj.messagecallback2 = null;
				}

				if (obj.messages.length) {
					for (let m of obj.messages) {
						if (m.$callback) {
							iscallback = true;
							m.$callback(err);
						}
					}

					if (!iscallback) F.error(err, 'SMTP error');

					// a problem
					obj.buffer = [];
					obj.count--;
					socket.emit('line', '999 TRY NEXT MESSAGE');
				} else {
					Mailer.destroy(obj);
					obj.callback && obj.callback(err);
					obj.callback = null;
				}

				return;
		}
	});

	autosend && self.$writeline(obj, 'EHLO ' + host);
};

Mailer.restart = function () {
	var self = this;
	self.off();
	self.debug = false;
	INDEXATTACHMENT = 0;
};

// Split Base64 to lines with 68 characters
function prepareBASE64(value) {
	var index = 0;
	var output = '';
	var length = value.length;

	while (index < length) {
		var max = index + 68;
		if (max > length) max = length;
		output += value.substring(index, max) + CRLF;
		index = max;
	}

	return output;
}

function unicode_encode(val) {
	return val ? '=?utf-8?B?' + Buffer.from(val.toString()).toString('base64') + '?=' : '';
}

// ======================================================
// EXPORTS
// ======================================================

exports.Mailer = Mailer;
exports.Message = Message;
exports.refresh = function () {
	for (let key in F.temporary.smtp) {
		let conn = F.temporary.smtp[key];
		if (conn.TS < NOW && (!conn.messages || !conn.messages.length)) Mailer.destroy(F.temporary.smtp[key]);
	}
};
