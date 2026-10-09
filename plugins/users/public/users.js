PLUGIN('users', function(exports) {
	WAIT(
		function() {
			return !!PLUGINS.mail?.store;
		},
		function() {
			var mailbox = PLUGINS.mail;
			var state = mailbox.store;
			var users = {};
			users.form = {
				name: '',
				email: '',
				password: ''
			};
			users.languages = DEF.languageitems;
			users.roleOptions = [
				{ id: 'member', name: TRANSLATE('@(Member)') },
				{ id: 'admin', name: TRANSLATE('@(Administrator)') }
			];
			users.manage = { password: '', role: 'member', adminPassword: '' };
			// Texts and states of the windows that the views bind to.
			users.error = '';
			users.createBusy = false;
			users.panel = false;
			users.manageTitle = '';
			users.toggleLabel = '';
			users.removeLabel = TRANSLATE('@(Delete user)');
			users.totpReset = false;
			users.profileError = '';
			users.profileBusy = false;
			var listing = [],
				chosen = null,
				confirming = 0;
			users.profileform = {};
			var profilebusy = false;
			function openprofile() {
				if (!state.user)
					return;
				SET('users.profileform', {
					name: state.user.name,
					email: state.user.email,
					color: state.user.color || '#4285F4',
					language: state.user.language || document.documentElement.lang,
					currentPassword: '',
					newPassword: '',
					confirmPassword: ''
				});
				exports.set('profileError', '');
				PLUGINS.twostep?.refreshlink && PLUGINS.twostep.refreshlink();
				SET('mail.window', 'profile');
			}
			function closeprofile() {
				if (profilebusy)
					return;
				SET('users.profileform.currentPassword', '');
				SET('users.profileform.newPassword', '');
				SET('users.profileform.confirmPassword', '');
				SET('mail.window', '');
			}
			async function saveprofile() {
				if (profilebusy)
					return;
				profilebusy = true;
				exports.set('profileBusy', true);
				exports.set('profileError', '');
				try {
					var model = {};
					for (var field of ['name', 'email', 'currentPassword', 'newPassword', 'confirmPassword'])
						model[field] = GET('users.profileform.' + field);
					model.color = GET('users.profileform.color');
					model.language = GET('users.profileform.language');
					if (model.newPassword !== model.confirmPassword)
						throw Error(TRANSLATE('@(The new passwords do not match.)'));
					await mailbox.api('user_profile', model);
					SET('users.profileform', {});
					location.assign('/');
				} catch (e) {
					exports.set('profileError', e.message);
				} finally {
					profilebusy = false;
					exports.set('profileBusy', false);
				}
			}
			var userbusy = false;
			async function openusers() {
				if (state.user.role !== 'admin')
					return;
				SET('users.form', {
					name: '',
					email: '',
					password: ''
				});
				exports.set('error', '');
				var result = await mailbox.api('user_list');
				listing = result.users;
				SET(
					'users.items',
					result.users.map((u) => ({
						...u,
						roleLabel: TRANSLATE(u.role === 'admin' ? '@(Administrator)' : '@(Member)'),
						disabledLabel: u.disabled ? TRANSLATE('@(Disabled)') : '',
						twostepLabel: u.totp ? TRANSLATE('@(Two-step verification)') : '',
						canManage: u.id !== state.user.id
					}))
				);
				if (chosen && !listing.some((u) => u.id === chosen.id))
					hidemanage();
				SET('mail.window', 'users');
			}
			function hidemanage() {
				chosen = null;
				exports.set('panel', false);
			}
			function managetoggle() {
				exports.set('toggleLabel', TRANSLATE(chosen?.disabled ? '@(Enable user)' : '@(Disable user)'));
			}
			function manage(element) {
				chosen = listing.find((u) => u.id === element[0].dataset.id) || null;
				if (!chosen)
					return;
				confirming = 0;
				exports.set('removeLabel', TRANSLATE('@(Delete user)'));
				SET('users.manage', { password: '', role: chosen.role, adminPassword: '' });
				exports.set('manageTitle', TRANSLATE('@(Manage {0})').format(chosen.name));
				exports.set('error', '');
				managetoggle();
				exports.set('totpReset', !!chosen.totp);
				exports.set('panel', true);
			}
			// Every change to another person asks for the administrator's own password.
			async function act(schema, extra, done) {
				if (userbusy || !chosen)
					return;
				userbusy = true;
				exports.set('error', '');
				try {
					await mailbox.api(schema, { id: chosen.id, adminPassword: GET('users.manage.adminPassword'), ...extra });
					SET('users.manage.password', '');
					SET('users.manage.adminPassword', '');
					userbusy = false;
					await openusers();
					if (chosen)
						chosen = listing.find((u) => u.id === chosen.id) || null;
					managetoggle();
					exports.set('totpReset', !!chosen?.totp);
					mailbox.notify(done);
					return true;
				} catch (e) {
					exports.set('error', e.message);
				} finally {
					userbusy = false;
				}
			}
			async function resetpassword() {
				var password = GET('users.manage.password');
				if (!password) {
					exports.set('error', TRANSLATE('@(Use a password of 12 to 128 characters.)'));
					return;
				}
				await act('user_reset', { password }, TRANSLATE('@(Password changed. Their open sessions were closed.)'));
			}
			async function resettwostep() {
				await act('user_totp_reset', {}, TRANSLATE('@(Two-step verification removed. Their open sessions were closed.)'));
			}
			async function saverole() {
				await act('user_role', { role: GET('users.manage.role') }, TRANSLATE('@(Role saved.)'));
			}
			async function toggleuser() {
				if (!chosen)
					return;
				await act(
					'user_disable',
					{ disabled: !chosen.disabled },
					TRANSLATE(chosen.disabled ? '@(User enabled.)' : '@(User disabled. Their sessions were closed.)')
				);
			}
			// Deleting asks twice: the first press arms the button for five seconds.
			async function removeuser() {
				if (!chosen)
					return;
				if (Date.now() > confirming) {
					confirming = Date.now() + 5000;
					exports.set('removeLabel', TRANSLATE('@(Press again to delete)'));
					setTimeout(() => {
						if (Date.now() >= confirming)
							exports.set('removeLabel', TRANSLATE('@(Delete user)'));
					}, 5100);
					return;
				}
				confirming = 0;
				exports.set('removeLabel', TRANSLATE('@(Delete user)'));
				var name = chosen.name;
				if (await act('user_remove', {}, TRANSLATE('@(User deleted.)'))) {
					hidemanage();
					if (name)
						exports.set('error', '');
				}
			}
			async function createuser() {
				if (userbusy)
					return;
				userbusy = true;
				exports.set('createBusy', true);
				exports.set('error', '');
				try {
					var model = {};
					for (var field of ['name', 'email', 'password'])
						model[field] = GET('users.form.' + field);
					await mailbox.api('user_create', model);
					await openusers();
					mailbox.notify(TRANSLATE('@(User created with a private workspace.)'));
				} catch (e) {
					exports.set('error', e.message);
				} finally {
					userbusy = false;
					exports.set('createBusy', false);
				}
			}
			exports.set('', users);
			exports.open = openusers;
			exports.create = createuser;
			exports.manage = manage;
			exports.reset = resetpassword;
			exports.saverole = saverole;
			exports.resettwostep = resettwostep;
			exports.toggle = toggleuser;
			exports.remove = removeuser;
			exports.profile = openprofile;
			exports.closeprofile = closeprofile;
			exports.saveprofile = saveprofile;
		}
	);
});
