// New mail told to the person: a system notification when the window is not in front (only if they turned it on in this browser,
// Total.js j-NativeNotifications) and always a polite status line for a screen reader. deps = { state, ui, toast, open } where open(id)
// shows a message (the notification takes the person to it).
function totalmailnotify(deps) {

	var key = function() { return 'totalmail-notify-' + (deps.state.user && deps.state.user.id); };
	function enabled() {
		try {
			return localStorage.getItem(key()) === '1' && (window.Notification && window.Notification.permission) === 'granted';
		} catch {
			return false;
		}
	}
	// What the switch in the settings says, and what the line under it explains.
	function label() {

		var denied = (window.Notification && window.Notification.permission) === 'denied';
		deps.ui({ notifications: enabled() });
		SET(
			'mail.notifyHint',
			TRANSLATE(
				!window.Notification
					? '@(This browser does not support notifications.)'
					: denied
						? '@(Blocked in the browser. Allow notifications for this site to turn them on.)'
						: '@(A system notice when new mail arrives while this window is not in front.)'
			)
		);
	}
	function start() {
		// The component asks for the permission when it is created, so it is created from the person's click.
		SET('mail.notifyOn', true);
	}
	function say(text) {
		deps.ui({ announce: '' });
		setTimeout(function() { return deps.ui({ announce: text }); }, 50);
	}
	return {
		enabled,
		label,
		start,
		say,
		// The unread mail of the inbox, to compare with what arrives after the next load.
		unread: function() {
			return new Set(deps.state.messages.filter(function(m) { return m.folder === 'inbox' && m.unread && !m.welcome; }).map(function(m) { return m.id; }));
		},
		// Mail that arrived since `before` is announced; the system notification only when the window is not in front.
		announce: function(before) {

			var fresh = deps.state.messages.filter(function(m) { return m.folder === 'inbox' && m.unread && !m.welcome && !before.has(m.id); });
			if (!fresh.length)
				return;
			var first = fresh[0],
				text =
					fresh.length === 1
						? (first.sender || first.email || '') + (first.subject ? ' · ' + first.subject : '')
						: TRANSLATE('@(New messages)') + ': ' + fresh.length;
			say((fresh.length === 1 ? TRANSLATE('@(New message)') + ': ' : '') + text);
			if (!enabled() || (!document.hidden && document.hasFocus()))
				return;
			SETTER('nativenotifications/show', fresh.length === 1 ? TRANSLATE('@(New message)') : TRANSLATE('@(New mail)'), text, function() {
				if (fresh.length === 1)
					deps.open(first.id);
			});
		},
		// The switch of the settings.
		toggle: async function() {

			if (!window.Notification)
				return label();
			var on = enabled();
			try {
				if (on)
					localStorage.setItem(key(), '0');
				else {
					start();
					var permission = window.Notification.permission === 'granted' ? 'granted' : await window.Notification.requestPermission();
					localStorage.setItem(key(), permission === 'granted' ? '1' : '0');
					if (permission !== 'granted')
						deps.toast(TRANSLATE('@(Allow notifications for this site in the browser to turn them on.)'));
				}
			} catch {}
			label();
		}
	};
}
