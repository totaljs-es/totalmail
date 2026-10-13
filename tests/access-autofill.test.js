const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../plugins/access/public/access.js'), 'utf8');

for (const value of ['012345', 'abcd-efgh-ijkl', ''])
	test('OTP submission uses the visible autofilled value: ' + JSON.stringify(value), async () => {
		let state = {}, calls = [];
		let plugin;
		let input = { value };
		vm.runInNewContext(source, {
			PLUGIN(name, init) {
				plugin = { set(key, val) { state['access.' + key] = val; } };
				init(plugin);
			},
			document: { documentElement: { lang: 'en' }, querySelector(selector) {
				assert.equal(selector, '.access-form input[name="_auth_code"]');
				return input;
			} },
			DEF: { languageitems: [] }, WATCH() {},
			GET(key) { return key === 'access.code' ? '999999' : state[key]; },
			initialsetup: false, setTimeout(fn) { fn(); },
			location: { assign() {} },
			totalmailrequest: { async api(action, data) {
				calls.push({ action, data });
				return action === 'user_login' ? { totp: true, token: 'pending-test-token' } : {};
			} }
		});
		await plugin.submit();
		assert.equal(state['access.step'], 'code');
		await plugin.submit();
		assert.equal(calls[1].action, 'user_totp');
		assert.equal(calls[1].data.code, value);
		assert.equal(calls[1].data.token, 'pending-test-token');
	});
