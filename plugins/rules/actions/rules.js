// Rules belong to an account of the signed-in person: the account is always resolved from their own store.
function run($, fn) {
	FUNC.run($, function() { return fn(PLUGINS.mail.mailboxes.forUser($.user)); });
}

NEWACTION('Rules|save', {
	name: 'Save a rule',
	user: true,
	route: '+API /api/ +rule_save --> Rules|save',
	input: 'id:String(40), *accountId:String(80), *name:String(60), enabled:Boolean, *field:{from|to|subject}, *op:{contains|is}, *value:String(100), *action:{archive|trash|read|star|move}, path:String(500)',
	action: function($, model) {
		return run($, function(store) {

			var account = store.account(model.accountId);
			var rule = PLUGINS.rules.engine.validate(Object.assign({}, model, { id: model.id || UID() }), account);
			if (model.id && !(account.rules || []).some(function(r) { return r.id === model.id; }))
				throw Error('@(Rule not found.)');
			return store.saveRule(model.accountId, rule, PLUGINS.rules.engine.limits.rules);
		});
	}
});

NEWACTION('Rules|delete', {
	name: 'Delete a rule',
	user: true,
	route: '+API /api/ +rule_delete --> Rules|delete',
	input: '*accountId:String(80), *id:String(40)',
	action: function($, model) { return run($, function(store) { return store.deleteRule(model.accountId, model.id); }); }
});

// How many of the messages already in the inbox cache a rule would have matched: a way to check it before relying on it.
NEWACTION('Rules|test', {
	name: 'Test a rule',
	user: true,
	route: '+API /api/ +rule_test --> Rules|test',
	input: '*accountId:String(80), *field:{from|to|subject}, *op:{contains|is}, *value:String(100)',
	action: function($, model) {
		return run($, function(store) {

			var account = store.account(model.accountId);
			var rule = PLUGINS.rules.engine.validate({ name: 'test', field: model.field, op: model.op, value: model.value, action: 'read' }, account);
			var hits = store.folderMessages(model.accountId, 'inbox', function(m) { return PLUGINS.rules.engine.matches(rule, m); });
			return { matching: hits.length, sample: hits.slice(0, 5).map(function(m) { return String(m.subject || '').slice(0, 80); }) };
		});
	}
});
