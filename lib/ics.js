// A calendar invitation (an .ics attachment) reduced to what the reader shows: what, when, where, who, and what it asks.
// Only the first event is read, nothing is executed or fetched, and every value is bounded.
const limits = { summary: 200, location: 200, description: 600, organizer: 120 };
function unescape(value) {
	return String(value).replace(/\\([nN,;\\])/g, (m, c) => (c === 'n' || c === 'N' ? '\n' : c));
}
function time(property) {
	if (!property)
		return null;
	var m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(property.value.trim());
	if (!m)
		return null;
	var date = m[1] + '-' + m[2] + '-' + m[3];
	if (m[4] === undefined)
		return { iso: date, allDay: true };
	var local = date + 'T' + m[4] + ':' + m[5] + ':' + (m[6] || '00');
	if (m[7])
		return { iso: local + 'Z', allDay: false };
	var tz = /(?:^|;)TZID=([^;:]+)/i.exec(property.params);
	// Without a time zone database the time is kept as written, with the zone it was written in.
	return { iso: local, allDay: false, tz: tz ? tz[1].replace(/^"|"$/g, '').slice(0, 60) : '' };
}
exports.parse = function(text) {
	text = String(text || '').slice(0, 200000);
	// Long lines are folded: a continuation starts with a space or a tab.
	var lines = text
		.replace(/\r\n?/g, '\n')
		.replace(/\n[ \t]/g, '')
		.split('\n');
	var method = '',
		event = null,
		props = {},
		done = false;
	for (var line of lines) {
		var upper = line.toUpperCase();
		if (upper === 'BEGIN:VEVENT' && !event && !done) {
			event = true;
			continue;
		}
		if (upper === 'END:VEVENT' && event) {
			done = true;
			event = false;
			continue;
		}
		var m = /^([A-Za-z-]+)((?:;[^:]*)?):(.*)$/.exec(line);
		if (!m)
			continue;
		var name = m[1].toUpperCase();
		if (name === 'METHOD' && !event && !method)
			method = m[3].trim().toUpperCase().slice(0, 20);
		else if (event && !(name in props))
			props[name] = { params: m[2], value: m[3] };
	}
	if (!done || !props.DTSTART)
		return null;
	var text1 = (name, max) =>
		props[name]
			? unescape(props[name].value)
				.replace(/[\x00-\x08\x0b-\x1f\x7f]+/g, ' ')
				.trim()
				.slice(0, max)
			: '';
	var org = props.ORGANIZER,
		cn = org && /(?:^|;)CN=("[^"]*"|[^;:]*)/i.exec(org.params);
	var address = org && /^mailto:(.*)$/i.exec(org.value.trim());
	var status = text1('STATUS', 20).toUpperCase();
	return {
		method: method || 'PUBLISH',
		cancelled: method === 'CANCEL' || status === 'CANCELLED',
		summary: text1('SUMMARY', limits.summary),
		start: time(props.DTSTART),
		end: time(props.DTEND),
		location: text1('LOCATION', limits.location),
		description: text1('DESCRIPTION', limits.description),
		organizer: ((cn && cn[1].replace(/^"|"$/g, '').trim()) || (address && address[1].split('?')[0]) || '').slice(0, limits.organizer)
	};
};
