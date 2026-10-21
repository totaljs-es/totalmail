const Welcome = require('../../../lib/welcome');
// Whether the assistant exists, where its text goes and, if a knowledge base is connected, where a message is searched.
function aistatus() {
	var status = MODS.ai.status(MODS.instance.ai());
	if (status.configured)
		status.knowledge = MODS.knowledge.has();
	return status;
}
NEWACTION('Mailboxes|bootstrap', {
	name: 'Private mailboxes',
	user: true,
	route: '+API /api/ -bootstrap --> Mailboxes|bootstrap',
	action: function($) {
		var data = MODS.users.forUser($.user).snapshot();
		// Keep submitted records in storage to prevent duplicate sends, but do not list sent mail as drafts.
		data.drafts = data.drafts.filter((draft) => draft.status !== 'sent');
		data.messages = data.messages.map((item) => Welcome.decorate(item, $.language));
		$.callback({
			user: $.user,
			mode: data.accounts.some((a) => a.configured) ? 'configured' : 'empty',
			ai: aistatus(),
			...data
		});
	}
});
NEWACTION('Drafts|save', {
	name: 'Persist a local draft',
	user: true,
	route: '+API /api/ +draft_save --> Drafts|save',
	input: 'id:String(80), *accountId:String(80), from:String(254), to:String(500), cc:String(500), bcc:String(500), subject:String(500), body:String(50000), replyTo:String(80)',
	action: function($, model) {
		model.id = model.id || UID();
		FUNC.run($, () => MODS.users.forUser($.user).saveDraft(model), '@(Unable to save changes. Please try again.)');
	}
});
