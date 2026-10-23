// The starting text of a reply or a forward: the original, quoted, so the reader sees what is being answered.
// Pure on purpose: the browser and the tests use the same code. The labels and the date format come from the caller.
//
// A reply is   (your text) / "On <date>, <sender> wrote:" / the original, every line starting with "> " / signature.
// The quote goes before the signature because everything after the "-- " line is a signature and is never formatted.
function totalmailquote(kind, message, signature, text) {

	var maxlines = 200,
		chars = 20000;
	function quoted(body) {

		var lines = String(body || '')
			.replace(/\r\n?/g, '\n')
			.slice(0, chars)
			.split('\n')
			.map((line) => line.replace(/\s+$/, ''));
		// Runs of blank lines collapse to one; blank lines at both ends go.
		lines = lines.filter((line, i) => line || (i > 0 && lines[i - 1]));
		while (lines.length && !lines[lines.length - 1])
			lines.pop();
		while (lines.length && !lines[0])
			lines.shift();
		var cut = lines.length > maxlines;
		lines = lines.slice(0, maxlines).map((line) => (line ? '> ' + line : '>'));
		if (cut)
			lines.push('> …');
		return lines.join('\n');
	}
	function person() {
		return (
			message.sender && message.email ? message.sender + ' <' + message.email + '>' : message.email || message.sender || ''
		).replace(/[\r\n]+/g, ' ');
	}
	var subject = String(message.subject || '').replace(/[\r\n]+/g, ' ');
	if (kind === 'forward') {
		var head = [
			'---------- ' + text.forwarded + ' ----------',
			text.from + ': ' + person(),
			text.date + ': ' + text.format(message.date),
			text.subject + ': ' + subject,
			(message.toRecipients || []).length ? text.to + ': ' + message.toRecipients.join(', ') : ''
		].filter(Boolean);
		return {
			subject: 'Fwd: ' + subject.replace(/^(?:(?:fwd?|rv|wg|tr|enc)\s*:\s*)+/i, ''),
			body: '\n\n' + head.join('\n') + '\n\n' + quoted(message.body) + (signature || '')
		};
	}
	return {
		subject: 'Re: ' + subject.replace(/^(?:re\s*:\s*)+/i, ''),
		body: '\n\n' + text.wrote(text.format(message.date), person()) + '\n' + quoted(message.body) + (signature || '')
	};
}

if (typeof module !== 'undefined' && module.exports)
	module.exports = totalmailquote;
