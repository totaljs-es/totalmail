// The bar that offers to put back what was just archived or moved to the trash from the inbox (nine seconds, or Z).
// The window hands it what it needs: deps = { state, ui, api, toast, perform, reloadmail } (the state of the mailbox, the function that
// patches mail.ui, the call to the server, the toast, the one-operation-at-a-time wrapper and the reload).
function totalmailundo(deps) {

	var items = [],
		timer = null,
		busy = false;
	function hide() {

		clearTimeout(timer);
		items = [];
		deps.ui({ undoShown: false });
	}
	return {
		// What is needed to find a message again after the reload: the server may give it another id, so the Message-ID is kept.
		entry: function(t, folder) {
			return { id: t.id, accountid: t.accountId, messageid: t.messageId || '', folder };
		},
		// Shows the bar for these messages. Returns false (and shows nothing) when there is nothing to put back.
		offer: function(list, text) {

			if (!list.length)
				return false;
			items = list;
			deps.ui({ undoText: text, undoShown: true });
			clearTimeout(timer);
			timer = setTimeout(hide, 9000);
			return true;
		},
		available: function() { return items.length > 0; },
		hide,
		undo: async function() {

			var list = items;
			if (!list.length || busy)
				return;
			// The bar stays up, saying what is happening, until the messages are back.
			busy = true;
			clearTimeout(timer);
			deps.ui({ undoText: TRANSLATE('@(Putting it back…)'), undoBusy: true });
			try {
				await deps.perform(async function() {
					try {
						for (var arr = Array.from(list), i = 0; i < arr.length; i++) {
							var item = arr[i];
							var found = deps.state.messages.find(
								function(x) {
									return x.accountId === item.accountid &&
										x.folder === item.folder &&
										(item.messageid ? x.messageId === item.messageid : x.id === item.id);
								}
							);
							if (found)
								await deps.api('message_change', { id: found.id, operation: 'restore', enabled: false });
						}
					} finally {
						await deps.reloadmail();
					}
				});
				deps.toast(TRANSLATE('@(Moved back to the inbox.)'));
			} finally {
				busy = false;
				deps.ui({ undoBusy: false });
				hide();
			}
		}
	};
}
