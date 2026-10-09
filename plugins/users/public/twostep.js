// Two-step verification window: turn it on (password, scan, confirm with a code, keep the recovery codes), and turn it off or
// renew the recovery codes (password and a code again). The server decides everything; this only walks through the steps.
// What the window shows is the model of the plugin (step, error, secret, qr, recovery, left, totp); the view binds to it.
PLUGIN('twostep', function(exports) {
	WAIT(
		function() {
			return !!PLUGINS.mail?.store?.user && !!PLUGINS.accounts && !!PLUGINS.users;
		},
		function() {
			var mailbox = PLUGINS.mail,
				state = mailbox.store,
				busy = false,
				codes = [];
			// Every step starts from a clean model; the window has nothing in it when it is closed.
			var blank = (step) => ({
				password: '',
				code: '',
				step: step,
				error: '',
				secret: '',
				qr: '',
				recovery: '',
				left: '',
				totp: !!state.user.totp,
				focuscodes: 0
			});
			exports.set('', blank('off'));
			function show(step) {
				exports.set('', blank(step));
			}
			function error(text) {
				exports.set('error', text || '');
			}
			// The profile window shows whether it is on.
			function link() {
				exports.set('totp', !!state.user.totp);
			}
			async function call(schema, data) {
				if (busy)
					return null;
				busy = true;
				error('');
				try {
					return await mailbox.api(schema, data);
				} catch (e) {
					error(e.message);
					return null;
				} finally {
					busy = false;
				}
			}
			function listing() {
				exports.set('recovery', codes.join('\n'));
			}
			exports.open = function() {
				show(state.user.totp ? 'on' : 'off');
				SET('mail.window', 'twostep');
			};
			exports.close = function() {
				// What was shown once is gone with the window.
				codes = [];
				listing();
				link();
				SET('mail.window', 'profile');
			};
			exports.begin = async function() {
				var result = await call('user_totp_begin', { password: GET('twostep.password') });
				if (!result)
					return;
				show('setup');
				exports.set('secret', result.secret.replace(/(.{4})/g, '$1 ').trim());
				SETTER('qrcode/create', { text: result.uri, width: 168, height: 168, callback: (src) => exports.set('qr', src) });
			};
			exports.cancel = () => show('off');
			exports.enable = async function() {
				var result = await call('user_totp_enable', { code: GET('twostep.code') });
				if (!result)
					return;
				state.user.totp = true;
				codes = result.recovery;
				show('codes');
				listing();
				link();
			};
			exports.disable = async function() {
				var result = await call('user_totp_disable', { password: GET('twostep.password'), code: GET('twostep.code') });
				if (!result)
					return;
				state.user.totp = false;
				show('off');
				link();
				mailbox.notify(TRANSLATE('@(Two-step verification is off.)'));
			};
			exports.recovery = async function() {
				var result = await call('user_totp_recovery', { password: GET('twostep.password'), code: GET('twostep.code') });
				if (!result)
					return;
				codes = result.recovery;
				show('codes');
				listing();
			};
			exports.copy = async function() {
				try {
					await navigator.clipboard.writeText(codes.join('\n'));
					mailbox.notify(TRANSLATE('@(Copied.)'));
				} catch {
					exports.inc('focuscodes', 1);
				}
			};
			exports.download = function() {
				var text =
					'TotalMail ' +
					TRANSLATE('@(recovery codes)') +
					' · ' +
					state.user.email +
					'\n' +
					TRANSLATE('@(Each code works once.)') +
					'\n\n' +
					codes.join('\n') +
					'\n';
				SETTER('page/save', 'totalmail-recovery-codes.txt', text);
			};
			exports.done = function() {
				codes = [];
				listing();
				show('on');
				exports.set('left', TRANSLATE('@(Recovery codes: 8 left.)'));
			};
			exports.refreshlink = link;
			link();
		}
	);
});
