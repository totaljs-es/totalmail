// Several messages at once: a real checkbox on every line (Shift for a range, Ctrl/⌘ to add one), and a bar with the actions that make
// sense in bulk. The same operations as the single-message buttons, applied to every selected line.
// deps = { state, ui, api, toast, perform, arm, entries, visible, targets, account, renderlist, undo, reloadmail }.
function totalmailselection(deps) {

	var state = deps.state,
		ui = deps.ui,
		api = deps.api,
		toast = deps.toast,
		perform = deps.perform,
		arm = deps.arm,
		entries = deps.entries,
		visible = deps.visible,
		targets = deps.targets,
		account = deps.account,
		renderlist = deps.renderlist,
		undo = deps.undo,
		reloadmail = deps.reloadmail;
	var checked = new Set(),
		anchor = '';
	function lineids() {
		return entries(visible()).map(function(line) { return line.m.id; });
	}
	function renderbulk() {

		var ids = lineids();
		for (var list = Array.from(checked), i = 0; i < list.length; i++) {
			var id = list[i];
			if (!ids.includes(id))
				checked.delete(id);
		}
		ui({
			bulkShown: checked.size > 0,
			bulkCount: TRANSLATE('@({count} selected)').replace('{count}', function() { return checked.size; }),
			bulkAll: ids.length > 0 && checked.size === ids.length,
			bulkSome: checked.size > 0 && checked.size < ids.length,
			// Drafts can only be thrown away; the other actions belong to received mail.
			bulkDrafts: state.folder === 'drafts'
		});
	}
	function togglecheck(id, range, refocus) {

		var ids = lineids();
		if (range && anchor && ids.includes(anchor) && ids.includes(id)) {
			var a = ids.indexOf(anchor),
				b = ids.indexOf(id);
			for (var i = Math.min(a, b); i <= Math.max(a, b); i++)
				checked.add(ids[i]);
		} else if (checked.has(id))
			checked.delete(id);
		else
			checked.add(id);
		anchor = id;
		renderlist();
		if (refocus)
			SETTER('page/focus', '.row-check[data-row="' + id + '"]');
	}
	function clearchecked() {

		if (!checked.size)
			return false;
		checked.clear();
		renderlist();
		return true;
	}
	async function discarddrafts(ids) {

		if (!arm('discard-drafts')) {
			toast(TRANSLATE('@(Press again to discard the selected drafts.)'));
			return;
		}
		var done = 0,
			left = 0;
		for (var list = Array.from(ids), i = 0; i < list.length; i++) {
			var id = list[i];
			try {
				await api('draft_delete', { id });
				state.drafts = state.drafts.filter(function(d) { return d.id !== id; });
				checked.delete(id);
				done++;
			} catch {
				left++;
			}
		}
		renderlist();
		toast(
			TRANSLATE(left ? '@({done} done, {left} could not be changed.)' : '@({done} done.)')
				.replace('{done}', function() { return done; })
				.replace('{left}', function() { return left; })
		);
	}
	async function bulk(op) {

		if (op === 'clear')
			return clearchecked();
		var lines = entries(visible()).filter(function(line) { return checked.has(line.m.id); });
		if (!lines.length)
			return;
		if (state.folder === 'drafts')
			return op === 'trash' ? discarddrafts(lines.map(function(line) { return line.m.id; })) : undefined;
		var list = [],
			seen = new Set();
		for (var items = Array.from(lines), j = 0; j < items.length; j++) {
			var line = items[j];
			for (var arr = Array.from(op === 'star' ? [line.m] : targets(line.m)), i = 0; i < arr.length; i++) {
				var t = arr[i];
				if (!seen.has(t.id)) {
					seen.add(t.id);
					list.push(t);
				}
			}
		}
		var erasing = op === 'trash' && state.folder === 'trash';
		if (erasing && !arm('erase-bulk')) {
			toast(TRANSLATE('@(Press again to delete permanently.)'));
			return;
		}
		var star = op === 'star' ? !list.every(function(t) { return t.starred; }) : false,
			done = 0,
			left = 0,
			moved = [];
		await perform(async function() {
			try {
				for (var arr = Array.from(list), i = 0; i < arr.length; i++) {
					var t = arr[i];
					var operation = op === 'archive' ? (['archive', 'trash'].includes(t.folder) ? 'restore' : 'archive') : op;
					if ((op === 'read' && !t.unread) || (op === 'unread' && t.unread))
						continue;
					// Without an Archive or Trash folder on the server there is nothing to move to: the single button asks which folder.
					if (
						!erasing &&
						t.remote &&
						['archive', 'trash'].includes(operation) &&
						!(account(t.accountId).mailboxes || []).some(function(f) { return f.specialUse === (operation === 'archive' ? '\\Archive' : '\\Trash'); })
					) {
						left++;
						continue;
					}
					try {
						await api(
							erasing ? 'message_erase' : 'message_change',
							erasing ? { id: t.id } : { id: t.id, operation, enabled: star }
						);
						done++;
						if (!erasing && ['archive', 'trash'].includes(operation) && t.folder === 'inbox')
							moved.push(undo.entry(t, operation));
					} catch {
						left++;
					}
				}
			} finally {
				// Starring and marking keep the selection (more can follow); moving or deleting empties it.
				if (['archive', 'trash'].includes(op)) {
					checked.clear();
					state.selected = '';
				}
				await reloadmail();
			}
		});
		var text = TRANSLATE(left ? '@({done} done, {left} could not be changed.)' : '@({done} done.)')
			.replace('{done}', function() { return done; })
			.replace('{left}', function() { return left; });
		// What came out of the inbox can be put back.
		if (!undo.offer(moved, text))
			toast(text);
	}
	return {
		has: function(id) { return checked.has(id); },
		size: function() { return checked.size; },
		ids: lineids,
		render: renderbulk,
		toggle: togglecheck,
		clear: clearchecked,
		// The select-all box: every line of the list, or none.
		all: function(on) {
			if (on)
				for (var list = Array.from(lineids()), i = 0; i < list.length; i++)
					checked.add(list[i]);
			else
				checked.clear();
			renderlist();
		},
		bulk
	};
}
