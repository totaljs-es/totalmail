// The HTML part of a message, made safe to show. Nothing active survives (scripts, forms, frames, event handlers,
// javascript: links), remote images are neutralised until the reader asks for them and inline images become data URIs.
// The result is shown inside a sandboxed frame served with its own strict policy, so this is one of several layers.
var limits = { output: 300 * 1024, inline: 300 * 1024, inlineTotal: 1024 * 1024 };
var sanitizer;

function library() {
	if (sanitizer === undefined)
		try {
			sanitizer = require('sanitize-html');
		} catch {
			// Without the library messages are shown as plain text only; nothing unsafe is ever rendered.
			sanitizer = null;
			if (typeof Total !== 'undefined')
				Total.error(Error('sanitize-html is not installed: HTML mail is shown as plain text'), 'TotalMail');
		}

	return sanitizer;
}

var color = [/^#[0-9a-f]{3,8}$/i, /^rgba?\(\s*[\d.]+%?\s*,\s*[\d.]+%?\s*,\s*[\d.]+%?\s*(,\s*[\d.]+%?\s*)?\)$/i, /^[a-z]{3,25}$/i];
var length = /(-?\d+(\.\d+)?(px|em|rem|pt|%|ex|ch)?|auto)/.source;
var box = [new RegExp('^' + length + '(\\s+' + length + '){0,3}$', 'i')];
var size = [new RegExp('^' + length + '$', 'i'), /^(xx-small|x-small|small|medium|large|x-large|xx-large|smaller|larger)$/i];
var border = [/^[\w\s#.,()%-]{1,80}$/];

var styles = {
	color: color,
	'background-color': color,
	// Only a plain colour: a url() or a gradient never matches.
	background: color,
	'text-align': [/^(left|right|center|justify)$/],
	'font-size': size,
	'font-weight': [/^(normal|bold|bolder|lighter|[1-9]00)$/],
	'font-style': [/^(normal|italic|oblique)$/],
	'font-family': [/^[\w\s,"'-]{1,100}$/],
	font: [/^[\w\s,"'/.%-]{1,100}$/],
	'text-decoration': [/^(none|underline|line-through)(\s(none|underline|line-through))*$/],
	'text-transform': [/^(none|uppercase|lowercase|capitalize)$/],
	'line-height': [/^(\d+(\.\d+)?|\d+(\.\d+)?(px|em|rem|pt|%))$/],
	'letter-spacing': size,
	'vertical-align': [/^(top|middle|bottom|baseline|super|sub)$/],
	'white-space': [/^(normal|nowrap|pre|pre-wrap)$/],
	width: size,
	height: size,
	'max-width': size,
	'min-width': size,
	margin: box,
	'margin-top': size,
	'margin-bottom': size,
	'margin-left': size,
	'margin-right': size,
	padding: box,
	'padding-top': size,
	'padding-bottom': size,
	'padding-left': size,
	'padding-right': size,
	border: border,
	'border-top': border,
	'border-bottom': border,
	'border-left': border,
	'border-right': border,
	'border-color': color,
	'border-radius': box,
	'border-top-left-radius': size,
	'border-top-right-radius': size,
	'border-bottom-left-radius': size,
	'border-bottom-right-radius': size,
	'border-width': box,
	'border-style': [/^(none|solid|dashed|dotted|double)(\s(none|solid|dashed|dotted|double)){0,3}$/],
	'border-spacing': box,
	'table-layout': [/^(auto|fixed)$/],
	'border-collapse': [/^(collapse|separate)$/],
	// Hidden pre-header text is part of most newsletters: it has to stay hidden, as in every other client.
	display: [/^(none|block|inline|inline-block|table|table-cell|table-row)$/],
	visibility: [/^(visible|hidden)$/],
	opacity: [/^(0|1|0?\.\d+)$/],
	'max-height': size,
	overflow: [/^(hidden|visible)$/]
};

var tags = [
	'a',
	'abbr',
	'b',
	'blockquote',
	'br',
	'caption',
	'center',
	'cite',
	'code',
	'dd',
	'del',
	'div',
	'dl',
	'dt',
	'em',
	'font',
	'h1',
	'h2',
	'h3',
	'h4',
	'h5',
	'h6',
	'hr',
	'i',
	'img',
	'ins',
	'li',
	'ol',
	'p',
	'pre',
	's',
	'small',
	'span',
	'strike',
	'strong',
	'sub',
	'sup',
	'table',
	'tbody',
	'td',
	'tfoot',
	'th',
	'thead',
	'tr',
	'u',
	'ul'
];

var common = [
	'style',
	'align',
	'valign',
	'bgcolor',
	'width',
	'height',
	'colspan',
	'rowspan',
	'dir',
	'lang',
	'border',
	'cellpadding',
	'cellspacing',
	'color',
	'face',
	'size'
];

// Returns { html, remoteImages } or null when there is nothing safe to show.
exports.clean = function(html, attachments = []) {

	if (typeof html !== 'string' || !html.trim() || html.length > 1024 * 1024)
		return null;
	var lib = library();
	if (!lib)
		return null;
	var inline = new Map(),
		total = 0;
	for (var file of attachments) {
		var id = String(file.cid || file.contentId || '').replace(/^<|>$/g, '');
		if (
			id &&
			/^image\/(png|jpe?g|gif|webp)$/i.test(file.contentType || '') &&
			Buffer.isBuffer(file.content) &&
			file.content.length <= limits.inline &&
			total + file.content.length <= limits.inlineTotal
		) {
			total += file.content.length;
			inline.set(id, 'data:' + file.contentType.toLowerCase() + ';base64,' + file.content.toString('base64'));
		}
	}
	var remote = 0;
	var clean = lib(html, {
		allowedTags: tags,
		allowedAttributes: {
			'*': common,
			a: ['href', 'title', 'target', 'rel'],
			img: ['src', 'alt', 'title', 'width', 'height', 'data-remote-src', 'style']
		},
		allowedStyles: { '*': styles },
		allowedSchemes: ['http', 'https', 'mailto', 'tel'],
		allowedSchemesByTag: { img: ['data'] },
		allowProtocolRelative: false,
		disallowedTagsMode: 'discard',
		nonTextTags: [
			'script',
			'style',
			'textarea',
			'option',
			'noscript',
			'head',
			'title',
			'template',
			'iframe',
			'object',
			'embed',
			'svg',
			'math'
		],
		transformTags: {
			a: (tagname, attribs) => ({
				tagName: 'a',
				attribs: {
					href: attribs.href || '',
					title: attribs.title || '',
					style: attribs.style || '',
					target: '_blank',
					rel: 'noopener noreferrer nofollow'
				}
			}),
			img: (tagname, attribs) => {

				var src = String(attribs.src || '').trim(),
					out = {
						alt: attribs.alt || '',
						title: attribs.title || '',
						width: attribs.width || '',
						height: attribs.height || '',
						style: attribs.style || ''
					};
				if (/^https?:\/\//i.test(src)) {
					remote++;
					out['data-remote-src'] = src;
				} else if (/^cid:/i.test(src)) {
					var data = inline.get(src.slice(4).replace(/^<|>$/g, ''));
					if (data)
						out.src = data;
				} else if (/^data:image\/(png|jpe?g|gif|webp);base64,[a-z0-9+/=]+$/i.test(src) && src.length <= limits.inline * 1.4)
					out.src = src;
				for (var key of Object.keys(out))
					if (!out[key])
						delete out[key];
				return { tagName: 'img', attribs: out };
			}
		}
	});
	if (!clean.trim() || clean.length > limits.output)
		return null;
	return { html: clean, remoteImages: remote };
};

// Remote images are only switched on when asked for.
exports.display = (clean, images) => (images ? clean.replace(/ data-remote-src="/g, ' src="') : clean);

// The complete document for the sandboxed frame. Remote images are only switched on when asked for.
exports.document = function(clean, images) {
	var body = exports.display(clean, images);
	return (
		'<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><base target="_blank"><style>' +
		'body{margin:0;padding:16px;font:14px/1.6 Arial,sans-serif;color:#303030;background:#fff;overflow-wrap:break-word}' +
		'img{max-width:100%;height:auto}table{max-width:100%}a{color:#1a56b0}blockquote{margin:8px 0;padding-left:12px;border-left:3px solid #ddd;color:#555}pre{white-space:pre-wrap}' +
		'</style></head><body>' +
		body +
		'</body></html>'
	);
};

// Headers for that document: no scripts, no network except images when allowed, no cookies, and it can only be framed by
// this app. The framing origin is given explicitly: inside a sandboxed frame `'self'` does not match in every browser.
exports.headers = function(images, origin) {
	return {
		'content-security-policy':
			"sandbox allow-popups allow-popups-to-escape-sandbox; default-src 'none'; img-src data:" +
			(images ? ' https: http:' : '') +
			"; style-src 'unsafe-inline'; frame-ancestors " +
			(origin || "'self'") +
			"; base-uri 'none'; form-action 'none'",
		'x-content-type-options': 'nosniff',
		'referrer-policy': 'no-referrer',
		'cache-control': 'private, no-store'
	};
};

// ---- The text of a message as a person reads it. The writing assistant is given this and nothing else, so a message
// cannot say one thing to the reader and another to a model: text that a reader cannot see (display:none, hidden,
// transparent, a few pixels tall, the same colour as its background, white on white) is left out.
var voidtags = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'col', 'wbr', 'area', 'base']);

var blocktags = new Set([
	'p',
	'div',
	'br',
	'li',
	'tr',
	'h1',
	'h2',
	'h3',
	'h4',
	'h5',
	'h6',
	'blockquote',
	'hr',
	'table',
	'ul',
	'ol',
	'dl',
	'dd',
	'dt',
	'pre',
	'caption',
	'center',
	'section',
	'article',
	'header',
	'footer'
]);

var named = { white: [255, 255, 255], black: [0, 0, 0] };

function rgb(value) {

	value = String(value || '')
		.trim()
		.toLowerCase();
	if (named[value])
		return named[value];
	var hex = /^#([0-9a-f]{3}|[0-9a-f]{6})([0-9a-f]{2})?$/.exec(value);
	if (hex) {
		var h = hex[1].length === 3 ? hex[1].replace(/./g, (c) => c + c) : hex[1];
		return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
	}
	var fn = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(value);
	return fn ? [+fn[1], +fn[2], +fn[3]] : null;
}

function declarations(style) {

	var map = {};
	for (var part of String(style || '').split(';')) {
		var i = part.indexOf(':');
		if (i > 0)
			map[part.slice(0, i).trim().toLowerCase()] = part
				.slice(i + 1)
				.trim()
				.toLowerCase();
	}
	return map;
}

function tiny(value) {

	var m = /^(-?[\d.]+)(px|pt|em|rem|%|ex|ch)?$/.exec(value || '');
	if (!m)
		return false;
	var n = parseFloat(m[1]),
		unit = m[2] || 'px';
	return (
		n <= 0 ||
		(unit === 'px' && n <= 3) ||
		(unit === 'pt' && n <= 2) ||
		((unit === 'em' || unit === 'rem' || unit === 'ex' || unit === 'ch') && n <= 0.2) ||
		(unit === '%' && n <= 20)
	);
}

function zero(value) {
	return /^0(px|em|rem|pt|%)?$/.test(value || '');
}

function same(a, b) {
	return !!a && !!b && Math.abs(a[0] - b[0]) <= 16 && Math.abs(a[1] - b[1]) <= 16 && Math.abs(a[2] - b[2]) <= 16;
}

// Is this element, with the colours it inherits, something a reader cannot see?
function unseen(css, color, background) {

	if (css.display === 'none' || css.visibility === 'hidden' || css.visibility === 'collapse')
		return true;
	if (css.opacity !== undefined && parseFloat(css.opacity) <= 0.1)
		return true;
	if (css['font-size'] && tiny(css['font-size']))
		return true;
	if (css.overflow === 'hidden' && (zero(css.height) || zero(css['max-height']) || zero(css.width) || zero(css['max-width'])))
		return true;
	if (css.color === 'transparent')
		return true;
	return same(color, background);
}

function decode(text) {
	return text.replace(/&(#x?[0-9a-f]+|amp|lt|gt|quot|apos|nbsp);/gi, (all, code) => {

		code = code.toLowerCase();
		if (code === 'amp')
			return '&';
		if (code === 'lt')
			return '<';
		if (code === 'gt')
			return '>';
		if (code === 'quot')
			return '"';
		if (code === 'apos')
			return "'";
		if (code === 'nbsp')
			return ' ';
		var n = code[1] === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
		return isNaN(n) || n > 0x10ffff ? all : String.fromCodePoint(n);
	});
}

// Takes the cleaned HTML (what exports.clean returns). Returns { text, dropped }: `dropped` is how much text was left
// out because a reader could not see it.
exports.visibletext = function(html) {

	var out = [],
		dropped = 0,
		stack = [{ tag: '', hidden: false, color: [48, 48, 48], background: [255, 255, 255] }];
	var token = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>|[^<]+|</g,
		m;
	while ((m = token.exec(String(html || '')))) {
		var top = stack[stack.length - 1];
		if (m[0][0] !== '<' || m[0] === '<') {
			var text = decode(m[0]);
			if (top.hidden)
				dropped += text.replace(/\s+/g, '').length;
			else
				out.push(text);
			continue;
		}
		if (m[0].startsWith('<!--'))
			continue;
		var name = m[2].toLowerCase();
		if (m[1]) {
			for (var i = stack.length - 1; i > 0; i--)
				if (stack[i].tag === name) {
					stack.length = i;
					break;
				}
			if (blocktags.has(name) && !top.hidden)
				out.push('\n');
			continue;
		}
		var attrs = m[3] || '',
			style = /\sstyle\s*=\s*("([^"]*)"|'([^']*)')/i.exec(attrs),
			css = declarations(style && (style[2] !== undefined ? style[2] : style[3]));
		var bg = /\sbgcolor\s*=\s*("([^"]*)"|'([^']*)')/i.exec(attrs);
		var background =
			rgb(css['background-color'] || css.background) || (bg && rgb(bg[2] !== undefined ? bg[2] : bg[3])) || top.background;
		var font = /\scolor\s*=\s*("([^"]*)"|'([^']*)')/i.exec(attrs);
		var color = rgb(css.color) || (font && rgb(font[2] !== undefined ? font[2] : font[3])) || top.color;
		var hidden = top.hidden || unseen(css, color, background) || /\shidden(\s|=|$)/i.test(attrs);
		if (blocktags.has(name) && !hidden)
			out.push('\n');
		if (name === 'td' || name === 'th')
			out.push(' ');
		if (!voidtags.has(name) && !m[0].endsWith('/>'))
			stack.push({ tag: name, hidden, color, background });
	}
	return {
		text: out
			.join('')
			.replace(/[ \t ]+/g, ' ')
			.replace(/ ?\n ?/g, '\n')
			.replace(/\n{3,}/g, '\n\n')
			.trim()
			.slice(0, 100000),
		dropped
	};
};

exports.limits = limits;
exports.forget = () => (sanitizer = undefined);
