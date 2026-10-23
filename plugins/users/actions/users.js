const Totp = require('../../../lib/totp');

NEWACTION('Users|setup', {
	route: 'API /api/ +user_setup --> Users|setup',
	input: '*name:String(80), *email:Email, *password:String(128)',
	action: ($, model) =>
		FUNC.run($, async () => {

			if (MODS.security.identities.configured())
				throw Error('@(Setup has already been completed.)');
			if (!MODS.security.allowLogin($, 'initial-setup'))
				throw Error('@(Too many attempts. Try again in 15 minutes.)');
			var user = await MODS.security.identities.createUser(model, true);
			MODS.security.start($, user);
			return {
				success: true
			};
		})
});

NEWACTION('Users|login', {
	route: 'API /api/ +user_login --> Users|login',
	input: '*email:Email, *password:String(128)',
	action: ($, model) =>
		FUNC.run($, async () => {

			if (!MODS.security.allowLogin($, model.email))
				throw Error('@(Too many attempts. Try again in 15 minutes.)');
			var user = await MODS.security.identities.login(model.email, model.password);
			if (!user)
				throw Error('@(Email or password is incorrect.)');
			// With two-step verification the password is only the first step: no session until the code is right.
			if (user.totp)
				return { totp: true, token: MODS.security.pending.login(user.id) };
			MODS.security.loginSucceeded($, model.email);
			MODS.security.start($, user);
			return {
				success: true
			};
		})
});

NEWACTION('Users|totp', {
	route: 'API /api/ +user_totp --> Users|totp',
	input: '*token:String(80), *code:String(40)',
	action: ($, model) =>
		FUNC.run($, async () => {

			var pending = MODS.security.pending.attempt(model.token);
			if (!pending)
				throw Error('@(This sign-in took too long or had too many tries. Enter your password again.)');
			if (!MODS.security.allowLogin($, 'totp-' + pending.userId))
				throw Error('@(Too many attempts. Try again in 15 minutes.)');
			var result = await MODS.security.identities.checkSecond(pending.userId, model.code);
			if (!result.ok)
				throw Error('@(That code is not right.)');
			var user = MODS.security.identities.get(pending.userId);
			if (!user)
				throw Error('@(This sign-in took too long or had too many tries. Enter your password again.)');
			MODS.security.pending.done(model.token);
			MODS.security.loginSucceeded($, user.email);
			MODS.security.loginSucceeded($, 'totp-' + user.id);
			MODS.security.start($, user);
			return { success: true, via: result.via, left: result.left };
		})
});

// Two-step verification of the signed-in person. Every step asks for the password again: an open window is not proof of who is at it.
async function mine($, password) {
	if (!MODS.security.allowLogin($, 'totp-' + $.user.id))
		throw Error('@(Too many attempts. Try again in 15 minutes.)');
	if (!(await MODS.security.identities.verify($.user.id, password)))
		throw Error('@(Your current password is incorrect.)');
}

async function second($, password, code) {
	await mine($, password);
	if (!(await MODS.security.identities.checkSecond($.user.id, code)).ok)
		throw Error('@(That code is not right.)');
}

NEWACTION('Users|totpbegin', {
	user: true,
	route: '+API /api/ +user_totp_begin --> Users|totpbegin',
	input: '*password:String(128)',
	action: ($, model) =>
		FUNC.run($, async () => {

			await mine($, model.password);
			if (MODS.security.identities.get($.user.id).totp)
				throw Error('@(Two-step verification is already on.)');
			var secret = Totp.secret();
			MODS.security.pending.setup($.user.id, secret);
			return { secret, uri: Totp.uri(secret, $.user.email, 'TotalMail') };
		})
});

NEWACTION('Users|totpenable', {
	user: true,
	route: '+API /api/ +user_totp_enable --> Users|totpenable',
	input: '*code:String(40)',
	action: ($, model) =>
		FUNC.run($, async () => {

			if (!MODS.security.allowLogin($, 'totp-' + $.user.id))
				throw Error('@(Too many attempts. Try again in 15 minutes.)');
			var secret = MODS.security.pending.takeSetup($.user.id);
			if (!secret)
				throw Error('@(The setup took too long. Start again.)');
			var result = await MODS.security.identities.enableTotp($.user.id, secret, model.code);
			MODS.security.pending.finishSetup($.user.id);
			return { user: result.user, recovery: result.recovery };
		})
});

NEWACTION('Users|totpdisable', {
	user: true,
	route: '+API /api/ +user_totp_disable --> Users|totpdisable',
	input: '*password:String(128), *code:String(40)',
	action: ($, model) =>
		FUNC.run($, async () => {
			await second($, model.password, model.code);
			return { user: await MODS.security.identities.disableTotp($.user.id) };
		})
});

NEWACTION('Users|totprecovery', {
	user: true,
	route: '+API /api/ +user_totp_recovery --> Users|totprecovery',
	input: '*password:String(128), *code:String(40)',
	action: ($, model) =>
		FUNC.run($, async () => {
			await second($, model.password, model.code);
			return { recovery: await MODS.security.identities.newRecovery($.user.id) };
		})
});

NEWACTION('Users|logout', {
	user: true,
	route: '+API /api/ -user_logout --> Users|logout',
	action: ($) =>
		FUNC.run($, () => {
			MODS.security.logout($);
			return {
				success: true
			};
		})
});

NEWACTION('Users|list', {
	user: true,
	permissions: 'admin',
	route: '+API /api/ -user_list --> Users|list',
	action: ($) => {
		$.callback({
			users: MODS.security.identities.list()
		});
	}
});

NEWACTION('Users|create', {
	user: true,
	permissions: 'admin',
	route: '+API /api/ +user_create --> Users|create',
	input: '*name:String(80), *email:Email, *password:String(128)',
	action: ($, model) => {
		FUNC.run($, () => MODS.security.identities.createUser(model, false));
	}
});

NEWACTION('Users|profile', {
	user: true,
	route: '+API /api/ +user_profile --> Users|profile',
	input: '*name:String(80), *email:Email, *color:String(7), *language:String(35), currentPassword:String(128), newPassword:String(128), confirmPassword:String(128)',
	action: ($, model) =>
		FUNC.run($, async () => {

			if (!MODS.localization.languages.includes(model.language))
				throw Error('@(Choose an available language.)');
			if ((model.newPassword || '') !== (model.confirmPassword || ''))
				throw Error('@(The new passwords do not match.)');
			if (!MODS.security.allowLogin($, 'profile-' + $.user.id))
				throw Error('@(Too many attempts. Try again in 15 minutes.)');
			var result = await MODS.security.identities.updateProfile($.user.id, model);
			if (result.credentialsChanged) {
				MODS.security.revoke($.user.id);
				MODS.security.start($, result.user);
			}
			return result;
		})
});

// Managing other people needs an administrator who proves it is them: their own password is asked every time.
async function confirmed($, model) {
	if (!MODS.security.allowLogin($, 'admin-' + $.user.id))
		throw Error('@(Too many attempts. Try again in 15 minutes.)');
	if (!(await MODS.security.identities.verify($.user.id, model.adminPassword)))
		throw Error('@(Your current password is incorrect.)');
}

function others($, id) {
	if (id === $.user.id)
		throw Error('@(You cannot do this to your own account.)');
}

NEWACTION('Users|reset', {
	user: true,
	permissions: 'admin',
	route: '+API /api/ +user_reset --> Users|reset',
	input: '*id:String(32), *password:String(128), *adminPassword:String(128)',
	action: ($, model) => {
		FUNC.run($, async () => {

			await confirmed($, model);
			others($, model.id);
			var user = await MODS.security.identities.setPassword(model.id, model.password);
			MODS.security.revoke(model.id);
			return { user };
		});
	}
});

NEWACTION('Users|totpreset', {
	user: true,
	permissions: 'admin',
	route: '+API /api/ +user_totp_reset --> Users|totpreset',
	input: '*id:String(32), *adminPassword:String(128)',
	action: ($, model) => {
		FUNC.run($, async () => {

			await confirmed($, model);
			others($, model.id);
			var user = await MODS.security.identities.disableTotp(model.id);
			// Their open sessions end: whoever signs in next does it with the new situation.
			MODS.security.revoke(model.id);
			return { user };
		});
	}
});

NEWACTION('Users|role', {
	user: true,
	permissions: 'admin',
	route: '+API /api/ +user_role --> Users|role',
	input: '*id:String(32), *role:{admin|member}, *adminPassword:String(128)',
	action: ($, model) => {
		FUNC.run($, async () => {

			await confirmed($, model);
			others($, model.id);
			return { user: await MODS.security.identities.setRole(model.id, model.role) };
		});
	}
});

NEWACTION('Users|disable', {
	user: true,
	permissions: 'admin',
	route: '+API /api/ +user_disable --> Users|disable',
	input: '*id:String(32), disabled:Boolean, *adminPassword:String(128)',
	action: ($, model) => {
		FUNC.run($, async () => {

			await confirmed($, model);
			others($, model.id);
			var user = await MODS.security.identities.setDisabled(model.id, model.disabled === true);
			if (user.disabled) {
				MODS.security.revoke(model.id);
				MODS.changes.forget(model.id);
			}
			return { user };
		});
	}
});

NEWACTION('Users|remove', {
	user: true,
	permissions: 'admin',
	route: '+API /api/ +user_remove --> Users|remove',
	input: '*id:String(32), *adminPassword:String(128)',
	action: ($, model) => {
		FUNC.run($, async () => {

			await confirmed($, model);
			others($, model.id);
			var accounts = MODS.users.forUser({ id: model.id }).snapshot().accounts;
			var user = await MODS.security.identities.remove(model.id);
			MODS.security.revoke(model.id);
			MODS.changes.forget(model.id);
			for (var account of accounts)
				MODS.oauth.forget(account.id);
			await MODS.users.drop(model.id);
			return { user };
		});
	}
});
