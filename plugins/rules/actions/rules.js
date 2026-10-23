const Rules = require('../../../lib/rules');

// Rules belong to an account of the signed-in person: the account is always resolved from their own store.
function run($, fn) {
	FUNC.run($, () => fn(MODS.users.forUser($.user)));
}

NEWACTION('Rules|save', {
	user: true,
	route: '+API /api/ +rule_save --> Rules|save',
	input: 'id:String(40), *accountId:String(80), *name:String(60), enabled:Boolean, *field:{from|to|subject}, *op:{contains|is}, *value:String(100), *action:{archive|trash|read|star|move}, path:String(500)',
	action: ($, model) =>
		run($, (store) => {

			var rule = Rules.validate({ ...model, id: model.id || UID() }, store.account(model.accountId));
			if (model.id && !(store.account(model.accountId).rules || []).some((r) => r.id === model.id))
				throw Error('@(Rule not found.)');
			return store.saveRule(model.accountId, rule, Rules.limits.rules);
		})
});

NEWACTION('Rules|delete', {
	user: true,
	route: '+API /api/ +rule_delete --> Rules|delete',
	input: '*accountId:String(80), *id:String(40)',
	action: ($, model) => run($, (store) => store.deleteRule(model.accountId, model.id))
});

// How many of the messages already in the inbox cache a rule would have matched: a way to check it before relying on it.
NEWACTION('Rules|test', {
	user: true,
	route: '+API /api/ +rule_test --> Rules|test',
	input: '*accountId:String(80), *field:{from|to|subject}, *op:{contains|is}, *value:String(100)',
	action: ($, model) =>
		run($, (store) => {

			var account = store.account(model.accountId);
			var rule = Rules.validate({ name: 'test', field: model.field, op: model.op, value: model.value, action: 'read' }, account);
			var hits = store
				.snapshot()
				.messages.filter((m) => m.remote && m.accountId === model.accountId && m.folder === 'inbox' && Rules.matches(rule, m));
			return { matching: hits.length, sample: hits.slice(0, 5).map((m) => String(m.subject || '').slice(0, 80)) };
		})
});
