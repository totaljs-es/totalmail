PLUGIN('access', function(exports) {
	var access = {
		name: '',
		email: '',
		password: '',
		code: '',
		language: document.documentElement.lang,
		languages: DEF.languageitems
	};
	exports.set('', access);
	var accessbusy = false,
		token = '';
	// What the card shows: the step (the password, then the code when the account asks for one), the message and the busy state.
	exports.set('step', 'password');
	exports.set('error', '');
	exports.set('busy', false);
	async function accesssubmit() {
		if (accessbusy)
			return;
		accessbusy = true;
		exports.set('busy', true);
		exports.set('error', '');
		try {
			// The model follows the keyboard a millisecond later: let the last key be in it (Enter can come right after it).
			await new Promise((resolve) => setTimeout(resolve, 20));
			var data = token ? { token, code: GET('access.code') } : { email: GET('access.email'), password: GET('access.password') };
			if (initialsetup && !token)
				data.name = GET('access.name');

			var result = await totalmailrequest.api(token ? 'user_totp' : initialsetup ? 'user_setup' : 'user_login', data);
			// The password was right and a code is awaited: the same card now asks for it.
			if (result.totp) {
				token = result.token;
				exports.set('step', 'code');
				exports.set('busy', false);
				accessbusy = false;
				return;
			}
			location.assign('/');
		} catch (error) {
			exports.set('error', error.message);
			exports.set('busy', false);
			accessbusy = false;
		}
	}
	WATCH('access.language', (language) => {
		if (!language || language === document.documentElement.lang)
			return;
		var url = new URL(location.href);
		url.searchParams.set('lang', language);
		location.assign(url.href);
	});
	exports.submit = accesssubmit;
	exports.restart = () => location.reload();
});
