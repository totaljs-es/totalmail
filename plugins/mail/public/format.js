// Formatting for outgoing mail. The composer stays a plain text box; a small, Markdown-like grammar is turned into
// HTML here, by this code, so nothing typed can ever become markup of its own:
//   **bold**   *italic*   [text](https://link)   - bullets   1. numbers   > quotes   bare links
// Mail that uses none of it (bare links alone do not count) is sent exactly as before, as plain text.
// The plain alternative always travels with the HTML, so any client can read the message.
// Pure and shared on purpose: the server builds the message with it and the review step shows the same result in the browser.
var totalmailformat = (function() {

	var inlinepattern =
		/\[([^\]\n]+)\]\((https?:\/\/[^\s()<>]+|mailto:[^\s()<>]+)\)|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])|\*\*(\S(?:[^\n]*?\S)?)\*\*|(?<![\w*])\*(\S(?:[^*\n]*?\S)?)\*(?![\w*])/g;
	var bullet = /^\s{0,3}[-*•]\s+(.*)$/,
		number = /^\s{0,3}(\d{1,3})[.)]\s+(.*)$/,
		quote = /^\s{0,3}>\s?(.*)$/;
	var signatureline = /^-- ?$/;
	var font =
		'font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.55;color:#1f2933';

	function escape(text) {
		return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
	}

	// One line of text as { html, plain, marked } (marked: it used bold, italic or a written link).
	function inline(text) {

		var html = '',
			plain = '',
			last = 0,
			marked = false;
		text.replace(inlinepattern, (match, label, url, bare, bold, italic, at) => {

			var gap = text.slice(last, at);
			html += escape(gap);
			plain += gap;
			last = at + match.length;
			if (label) {
				marked = true;
				html += '<a href="' + escape(url) + '" style="color:#1d4ed8">' + escape(label) + '</a>';
				plain += label === url ? url : label + ' (' + url + ')';
			} else if (bare) {
				html += '<a href="' + escape(bare) + '" style="color:#1d4ed8">' + escape(bare) + '</a>';
				plain += bare;
			} else {
				marked = true;
				var inner = inline(bold || italic);
				html += (bold ? '<strong>' : '<em>') + inner.html + (bold ? '</strong>' : '</em>');
				plain += inner.plain;
			}
			return match;
		});
		html += escape(text.slice(last));
		plain += text.slice(last);
		return { html, plain, marked };
	}

	// "> > text" -> { depth: 2, text: 'text' }: every ">" at the start of the line is one level of quoting.
	function quotelevel(line) {

		var found = /^\s{0,3}((?:>[ \t]?)+)(.*)$/.exec(line);
		return { depth: found[1].split('>').length - 1, text: found[2] };
	}

	// Lines with a depth -> blockquotes inside blockquotes, one per level, lines of the same level separated by a break.
	function nested(levels) {

		var html = '',
			open = 0,
			fresh = true;
		for (var level of levels) {
			var changed = level.depth !== open;
			while (open < level.depth) {
				html +=
					'<blockquote style="margin:' +
					(open ? '4px' : '0') +
					' 0 ' +
					(open ? '0' : '12px') +
					';padding:2px 0 2px 12px;border-left:3px solid #cbd2d9;color:#52606d">';
				open++;
			}
			while (open > level.depth) {
				html += '</blockquote>';
				open--;
			}
			if (!changed && !fresh)
				html += '<br>';
			html += level.html;
			fresh = false;
		}
		return html + '</blockquote>'.repeat(open);
	}

	// A signature is not formatted, but the addresses in it can be clicked: web links and email addresses.
	function signaturelinks(text) {

		var html = '',
			last = 0;
		text.replace(/(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])|([\w.+-]+@[\w-]+(?:\.[\w-]+)+)/g, (match, web, mail, at) => {

			html += escape(text.slice(last, at)) + '<a href="' + (web ? '' : 'mailto:') + escape(match) + '" style="color:#7b8794">' + escape(match) + '</a>';
			last = at + match.length;
			return match;
		});
		return html + escape(text.slice(last));
	}

	// Returns { html, plain } when the text uses formatting, otherwise null.
	function render(text) {

		text = String(text || '').replace(/\r\n?/g, '\n');
		var lines = text.split('\n'),
			signature = lines.findIndex((line) => signatureline.test(line));
		var tail = signature === -1 ? [] : lines.splice(signature);
		var blocks = [],
			plain = [],
			marked = false,
			i = 0;
		while (i < lines.length) {
			var line = lines[i],
				kind = bullet.test(line) ? 'ul' : number.test(line) ? 'ol' : quote.test(line) ? 'quote' : '';
			if (!line.trim()) {
				plain.push('');
				i++;
				continue;
			}
			var items = [];
			if (kind === 'quote') {
				marked = true;
				var levels = [];
				while (i < lines.length && quote.test(lines[i])) {
					var q = quotelevel(lines[i]),
						shown = inline(q.text);
					levels.push({ depth: q.depth, html: shown.html });
					plain.push('> '.repeat(q.depth) + shown.plain);
					i++;
				}
				blocks.push(nested(levels));
				continue;
			}
			if (kind) {
				marked = true;
				while (i < lines.length && (kind === 'ul' ? bullet : number).test(lines[i])) {
					var m = (kind === 'ul' ? bullet : number).exec(lines[i]);
					var rendered = inline(m[kind === 'ol' ? 2 : 1]);
					items.push(rendered.html);
					plain.push((kind === 'ul' ? '- ' : m[1] + '. ') + rendered.plain);
					i++;
				}
				blocks.push(
					'<' +
						kind +
						' style="margin:0 0 12px;padding-left:24px">' +
						items.map((item) => '<li>' + item + '</li>').join('') +
						'</' +
						kind +
						'>'
				);
				continue;
			}
			var rows = [];
			while (i < lines.length && lines[i].trim() && !bullet.test(lines[i]) && !number.test(lines[i]) && !quote.test(lines[i])) {
				var row = inline(lines[i]);
				marked = marked || row.marked;
				rows.push(row.html);
				plain.push(row.plain);
				i++;
			}
			blocks.push('<p style="margin:0 0 12px">' + rows.join('<br>') + '</p>');
		}
		if (!marked)
			return null;
		if (tail.length) {
			blocks.push('<div style="margin-top:16px;color:#7b8794">' + tail.map(signaturelinks).join('<br>') + '</div>');
			plain.push(...tail);
		}
		return {
			html: '<!doctype html><html><body><div style="' + font + '">' + blocks.join('') + '</div></body></html>',
			plain: plain.join('\n')
		};
	}
	// The text as the person sees it while writing: the same grammar, drawn as HTML that has exactly the characters of the text (so it
	// can sit behind the box without anything moving). The marks are dimmed, the words they mark are coloured; nothing changes width.
	function live(text) {

		var list = /^(\s{0,3}(?:[-*•]|\d{1,3}[.)])\s+)/,
			signature = false;
		function span(kind, value) {
			return '<span class="mk-' + kind + '">' + escape(value) + '</span>';
		}
		function words(line) {

			var html = '',
				last = 0;
			line.replace(inlinepattern, (match, label, url, bare, bold, italic, at) => {

				html += escape(line.slice(last, at));
				last = at + match.length;
				if (label)
					html += span('mark', '[') + span('link', label) + span('mark', match.slice(1 + label.length));
				else if (bare)
					html += span('link', bare);
				else {
					var mark = bold ? '**' : '*';
					html += span('mark', mark) + span(bold ? 'bold' : 'italic', bold || italic) + span('mark', mark);
				}
				return match;
			});
			return html + escape(line.slice(last));
		}
		return String(text || '')
			.replace(/\r\n?/g, '\n')
			.split('\n')
			.map((line) => {

				if (!signature && signatureline.test(line))
					signature = true;
				if (signature)
					return span('sig', line);
				var q = quote.exec(line);
				if (q) {
					var marker = line.slice(0, line.length - q[1].length);
					return '<span class="mk-quote">' + span('mark', marker) + escape(q[1]) + '</span>';
				}
				var l = list.exec(line);
				return l ? span('mark', l[1]) + words(line.slice(l[1].length)) : words(line);
			})
			.join('\n');
	}
	return { render: render, live: live };
})();

if (typeof module !== 'undefined' && module.exports)
	module.exports = totalmailformat;
