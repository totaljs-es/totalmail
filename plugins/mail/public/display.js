// How things are shown in the window: escaped text, a size, a calendar invitation, a pasted image with a name. Pure on purpose, like
// quote.js and threads.js: the browser and the tests use the same code, and what depends on the page (the language, a translated
// text) comes from the caller.
var totalmaildisplay = {
	// Text for an HTML context.
	esc: function(value) {
		return String(value == null ? '' : value).replace(
			/[&<>"']/g,
			function(c) {
				return ({
					'&': '&amp;',
					'<': '&lt;',
					'>': '&gt;',
					'"': '&quot;',
					"'": '&#39;'
				})[c];
			}
		);
	},
	filesize: function(bytes) {

		if (!bytes)
			return '';
		if (bytes < 1024)
			return bytes + ' B';
		if (bytes < 1048576)
			return Math.round(bytes / 1024) + ' KB';
		return (bytes / 1048576).toFixed(1) + ' MB';
	},
	// A calendar invitation as the reader shows it. Times written with a zone are shown as written, with the zone.
	// `lang` is the language of the page and `untitled` the text for an invitation without a summary.
	invitecard: function(invite, lang, untitled) {

		function show(t, withdate) {

			if (!t)
				return '';
			if (t.allDay)
				return new Date(t.iso + 'T00:00:00').toLocaleDateString(lang, { dateStyle: 'full' });
			if (t.iso.endsWith('Z'))
				return new Date(t.iso).toLocaleString(
					lang,
					withdate === false ? { timeStyle: 'short' } : { dateStyle: 'full', timeStyle: 'short' }
				);
			var day = new Date(t.iso.slice(0, 10) + 'T00:00:00').toLocaleDateString(lang, { dateStyle: 'full' });
			return (withdate === false ? '' : day + ', ') + t.iso.slice(11, 16) + (t.tz && withdate !== false ? ' (' + t.tz + ')' : '');
		}
		var start = show(invite.start),
			end = '';
		if (invite.end && !(invite.start && invite.start.allDay))
			end = invite.end.iso.slice(0, 10) === invite.start.iso.slice(0, 10) ? show(invite.end, false) : show(invite.end);
		return {
			title: invite.summary || untitled,
			when: start + (end ? ' – ' + end : ''),
			where: invite.location,
			organizer: invite.organizer,
			cancelled: invite.cancelled
		};
	},
	// A pasted or dropped image has no name worth keeping: it gets one made of the moment (image-20261114-083015.png).
	stamp: function(file, now) {

		if (file.name && !/^image\.(png|jpe?g|gif|webp)$/i.test(file.name))
			return file;
		now = now || new Date();
		var pad = function(n) { return String(n).padStart(2, '0'); },
			extension = (file.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
		var name =
			'image-' +
			now.getFullYear() +
			pad(now.getMonth() + 1) +
			pad(now.getDate()) +
			'-' +
			pad(now.getHours()) +
			pad(now.getMinutes()) +
			pad(now.getSeconds()) +
			'.' +
			extension;
		return new File([file], name, { type: file.type });
	}
};

if (typeof module !== 'undefined' && module.exports)
	module.exports = totalmaildisplay;
