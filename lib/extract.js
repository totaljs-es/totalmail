// Text extraction for the knowledge documents, with no dependencies:
//   text files, Word (.docx), OpenDocument (.odt), PowerPoint (.pptx), Excel (.xlsx) and PDF.
// Word, Excel, PowerPoint and OpenDocument files are ZIP archives of XML: a small ZIP reader is enough.
// PDF: the text of the usual PDFs (made by Word, a browser, LaTeX, a printer driver) is read from the page content,
// including fonts that map their codes with a ToUnicode table. Scanned PDFs are images and have no text to read:
// they need OCR, and the answer says so instead of adding an empty document.

const PLAIN =
	/\.(txt|md|markdown|html?|json|csv|tsv|xml|ya?ml|log|js|mjs|ts|css|sql|sh|py|rb|go|java|c|h|cpp|php|ini|conf|env|tpl|rst|tex)$/i;

// Simple PDF fonts without a ToUnicode table use a standard 8-bit encoding for the codes 128-255
const MACROMAN =
	'ÄÅÇÉÑÖÜáàâäãåçéèêëíìîïñóòôöõúùûü†°¢£§•¶ß®©™´¨≠ÆØ∞±≤≥¥µ∂∑∏π∫ªºΩæø¿¡¬√ƒ≈∆«»… ÀÃÕŒœ–—“”‘’÷◊ÿŸ⁄€‹›ﬁﬂ‡·‚„‰ÂÊÁËÈÍÎÏÌÓÔÒÚÛÙıˆ˜¯˘˙˚¸˝˛ˇ';

const WINANSI = '€�‚ƒ„…†‡ˆ‰Š‹Œ�Ž��‘’“”•–—˜™š›œ�žŸ';

function zlib() {
	return Total.Zlib;
}

function entities(text) {
	return text.replace(/&(#x?[0-9a-f]+|amp|lt|gt|quot|apos);/gi, function(all, code) {

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
		let n = code[1] === 'x' ? parseInt(code.substring(2), 16) : parseInt(code.substring(1), 10);
		return isNaN(n) ? all : String.fromCodePoint(n);
	});
}

// ==================================
// ZIP
// ==================================

function unzip(buffer) {

	let end = -1;

	for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--)
		if (buffer.readUInt32LE(i) === 0x06054b50) {
			end = i;
			break;
		}

	if (end === -1)
		throw new Error('@(It is not a valid Office file.)');

	let count = buffer.readUInt16LE(end + 10);
	let offset = buffer.readUInt32LE(end + 16);
	let files = {};

	for (let i = 0; i < count; i++) {
		if (buffer.readUInt32LE(offset) !== 0x02014b50)
			break;

		let method = buffer.readUInt16LE(offset + 10);
		let csize = buffer.readUInt32LE(offset + 20);
		let nlen = buffer.readUInt16LE(offset + 28);
		let elen = buffer.readUInt16LE(offset + 30);
		let clen = buffer.readUInt16LE(offset + 32);
		let local = buffer.readUInt32LE(offset + 42);
		let name = buffer.toString('utf8', offset + 46, offset + 46 + nlen);

		files[name] = { method: method, csize: csize, local: local };
		offset += 46 + nlen + elen + clen;
	}

	return {
		names: Object.keys(files),
		read: function(name) {

			let f = files[name];
			if (!f)
				return null;
			let nlen = buffer.readUInt16LE(f.local + 26);
			let elen = buffer.readUInt16LE(f.local + 28);
			let start = f.local + 30 + nlen + elen;
			let data = buffer.subarray(start, start + f.csize);
			if (f.method === 0)
				return data;
			if (f.method === 8)
				return zlib().inflateRawSync(data);
			throw new Error('@(The file uses an unsupported compression.)');
		}
	};
}

// ==================================
// Word, OpenDocument, PowerPoint, Excel
// ==================================

function docx(zip) {

	let xml = zip.read('word/document.xml');

	if (!xml)
		throw new Error('@(The Word file has no text.)');

	let out = [];

	for (let p of xml.toString('utf8').split('</w:p>')) {
		let style = (p.match(/<w:pStyle w:val="([^"]+)"/) || [])[1] || '';
		let text = '';

		p.replace(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\/>|<w:br\/>/g, function(all, t) {
			text += t != null ? t : all === '<w:tab/>' ? '\t' : '\n';
			return '';
		});

		text = entities(text).trim();

		if (!text)
			continue;

		let level = /^title$/i.test(style) ? 1 : (style.match(/^heading\s*(\d)/i) || [])[1];
		out.push(level ? '#'.repeat(Math.min(+level || 1, 6)) + ' ' + text : text);
	}

	return out.join('\n\n');
}

function odt(zip) {

	let xml = zip.read('content.xml');

	if (!xml)
		throw new Error('@(The OpenDocument file has no text.)');

	let body = xml
		.toString('utf8')
		.replace(/<text:s\/>/g, ' ')
		.replace(/<text:tab\/>/g, '\t')
		.replace(/<text:line-break\/>/g, '\n');
	let out = [];

	body.replace(/<text:(h|p)\b([^>]*)>([\s\S]*?)<\/text:\1>/g, function(all, kind, attrs, inner) {

		let text = entities(inner.replace(/<[^>]+>/g, '')).trim();
		if (text) {
			let level = kind === 'h' ? (attrs.match(/outline-level="(\d+)"/) || [])[1] : null;
			out.push(level ? '#'.repeat(Math.min(+level, 6)) + ' ' + text : text);
		}
		return '';
	});

	return out.join('\n\n');
}

function pptx(zip) {

	let slides = zip.names
		.filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
		.sort((a, b) => parseInt(a.match(/\d+/)[0]) - parseInt(b.match(/\d+/)[0]));
	let out = [];

	for (let i = 0; i < slides.length; i++) {
		let name = slides[i];
		let xml = zip.read(name).toString('utf8');
		let lines = [];
		for (let p of xml.split('</a:p>')) {
			let text = '';
			p.replace(/<a:t>([^<]*)<\/a:t>/g, (all, t) => (text += t));
			text = entities(text).trim();
			text && lines.push(text);
		}
		lines.length && out.push('## Slide ' + (i + 1) + '\n\n' + lines.join('\n\n'));
	}

	return out.join('\n\n');
}

function xlsx(zip) {

	let shared = [];
	let strings = zip.read('xl/sharedStrings.xml');

	if (strings)
		strings.toString('utf8').replace(/<si>([\s\S]*?)<\/si>/g, function(all, si) {

			let text = '';
			si.replace(/<t(?:\s[^>]*)?>([^<]*)<\/t>/g, (a, t) => (text += t));
			shared.push(entities(text));
			return '';
		});

	let sheets = zip.names
		.filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
		.sort((a, b) => parseInt(a.match(/\d+/)[0]) - parseInt(b.match(/\d+/)[0]));
	let out = [];

	for (let i = 0; i < sheets.length; i++) {
		let name = sheets[i];

		let rows = [];

		zip.read(name)
			.toString('utf8')
			.replace(/<row\b[^>]*>([\s\S]*?)<\/row>/g, function(all, row) {

				let cells = [];

				row.replace(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g, function(a, attrs, inner) {

					let type = (attrs.match(/\bt="(\w+)"/) || [])[1];
					let value = '';
					if (inner) {
						let v = (inner.match(/<v>([^<]*)<\/v>/) || [])[1];
						if (type === 's')
							value = shared[+v] || '';
						else if (type === 'inlineStr')
							value = entities((inner.match(/<t(?:\s[^>]*)?>([^<]*)<\/t>/) || [])[1] || '');
						else
							value = v || '';
					}
					cells.push(value);
					return '';
				});

				if (cells.some((n) => n !== ''))
					rows.push(cells.join('\t'));

				return '';
			});

		rows.length && out.push('## Sheet ' + (i + 1) + '\n\n' + rows.slice(0, 5000).join('\n'));
	}

	return out.join('\n\n');
}

// ==================================
// PDF
// ==================================

function balanced(src, index) {

	// Returns the end of the << >> or [ ] that starts at index
	let open = src[index];
	let close = open === '[' ? ']' : '>';
	let depth = 0;
	for (let i = index; i < src.length; i++)
		if (open === '[') {
			if (src[i] === '[')
				depth++;
			else if (src[i] === ']' && --depth === 0)
				return i + 1;
		} else if (src[i] === '<' && src[i + 1] === '<') {
			depth++;
			i++;
		} else if (src[i] === '>' && src[i + 1] === '>') {
			depth--;
			i++;
			if (!depth)
				return i + 1;
		}

	return src.length;
}

// The raw value of /Key in a dictionary text
function entry(dict, key) {

	if (!dict)
		return null;

	let m = new RegExp('/' + key + '(?![A-Za-z0-9])\\s*').exec(dict);

	if (!m)
		return null;

	let i = m.index + m[0].length;

	if (dict[i] === '<' && dict[i + 1] === '<')
		return dict.substring(i, balanced(dict, i));

	if (dict[i] === '[')
		return dict.substring(i, balanced(dict, i));

	let ref = dict.substring(i).match(/^(\d+)\s+\d+\s+R/);

	if (ref)
		return ref[0];

	return (dict.substring(i).match(/^\/?[^\s/<>\[\]()]+/) || [''])[0];
}

function refs(value) {

	let out = [];
	(value || '').replace(/(\d+)\s+\d+\s+R/g, (a, n) => out.push(+n));
	return out;
}

function inflate(data, dict) {
	if (!/\/FlateDecode|\/Fl\b/.test(dict || ''))
		return data;

	try {
		return zlib().inflateSync(data, { finishFlush: zlib().constants.Z_SYNC_FLUSH });
	} catch {
		try {
			return zlib().inflateRawSync(data.subarray(2), { finishFlush: zlib().constants.Z_SYNC_FLUSH });
		} catch {
			return null;
		}
	}
}

function parsecmap(text) {

	let map = new Map();
	let bytes = 0;

	function utf16(hex) {

		let s = '';
		for (let i = 0; i + 3 < hex.length + 1; i += 4)
			s += String.fromCharCode(parseInt(hex.substring(i, i + 4), 16));
		return s;
	}

	text.replace(/beginbfchar([\s\S]*?)endbfchar/g, function(all, body) {
		body.replace(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g, function(a, src, dst) {

			bytes = Math.max(bytes, src.length / 2);
			map.set(parseInt(src, 16), utf16(dst));
			return '';
		});
		return '';
	});

	text.replace(/beginbfrange([\s\S]*?)endbfrange/g, function(all, body) {
		body.replace(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(<[0-9a-fA-F]+>|\[[^\]]*\])/g, function(a, lo, hi, dst) {

			bytes = Math.max(bytes, lo.length / 2);
			let from = parseInt(lo, 16);
			let to = parseInt(hi, 16);
			if (dst[0] === '[') {
				let list = dst.match(/<([0-9a-fA-F]+)>/g) || [];
				for (let i = 0; i < list.length && from + i <= to; i++)
					map.set(from + i, utf16(list[i].slice(1, -1)));
			} else {
				let base = dst.slice(1, -1);
				let first = parseInt(base.substring(base.length - 4), 16);
				let prefix = utf16(base.substring(0, base.length - 4));
				for (let c = from; c <= to && c - from < 65536; c++)
					map.set(c, prefix + String.fromCharCode(first + (c - from)));
			}
			return '';
		});
		return '';
	});

	return { map: map, bytes: bytes || 1 };
}

function pdf(buffer) {

	let src = buffer.toString('latin1');
	let objects = new Map();

	if (/\/Encrypt\s/.test(src.substring(Math.max(0, src.length - 3000))))
		throw new Error('@(The PDF is encrypted. Remove the password and add it again.)');

	// 1. Objects and their streams
	let re = /(\d+)\s+(\d+)\s+obj\b/g;
	let m;

	while ((m = re.exec(src))) {
		let start = m.index + m[0].length;
		let end = src.indexOf('endobj', start);

		if (end === -1)
			break;

		let body = src.substring(start, end);
		let at = body.indexOf('stream');
		let item = { dict: body, data: null };

		if (at !== -1 && /^(\r\n|\n|\r)/.test(body.substring(at + 6))) {
			let from = start + at + 6 + body.substring(at + 6).match(/^(\r\n|\n|\r)/)[0].length;
			let stop = src.indexOf('endstream', from);
			if (stop !== -1) {
				item.dict = body.substring(0, at);
				item.data = buffer.subarray(from, stop);
			}
		}

		objects.set(+m[1], item);
		re.lastIndex = end + 6;
	}

	// 2. Objects inside object streams (PDF 1.5)
	for (let [num, o] of Array.from(objects.entries())) {
		if (!o.data || !/\/Type\s*\/ObjStm/.test(o.dict))
			continue;

		let data = inflate(o.data, o.dict);

		if (!data)
			continue;

		let n = parseInt(entry(o.dict, 'N')) || 0;
		let first = parseInt(entry(o.dict, 'First')) || 0;
		let text = data.toString('latin1');
		let head = text.substring(0, first).trim().split(/\s+/).map(Number);

		for (let i = 0; i < n; i++) {
			let id = head[i * 2];
			let off = head[i * 2 + 1];
			let next = i + 1 < n ? head[(i + 1) * 2 + 1] : text.length - first;
			if (!isNaN(id))
				objects.set(id, { dict: text.substring(first + off, first + next), data: null });
		}
	}

	function dictof(n) {
		let o = objects.get(n);
		return o ? o.dict : '';
	}

	function resolve(value) {
		let r = (value || '').match(/^(\d+)\s+\d+\s+R$/);
		return r ? dictof(+r[1]) : value || '';
	}

	// 3. Pages in order, following the page tree from the catalog
	let pages = [];
	let root = null;

	for (let [num, o] of objects)
		if (/\/Type\s*\/Catalog/.test(o.dict)) {
			root = refs(entry(o.dict, 'Pages'))[0];
			break;
		}

	function walk(n, inherited, depth) {

		if (depth > 30)
			return;

		let dict = dictof(n);
		let res = entry(dict, 'Resources') || inherited;

		if (/\/Type\s*\/Pages/.test(dict) || (/\/Kids/.test(dict) && !/\/Type\s*\/Page(?![s])/.test(dict)))
			for (let kid of refs(entry(dict, 'Kids')))
				walk(kid, res, depth + 1);
		else if (/\/Type\s*\/Page(?![s])/.test(dict))
			pages.push({ dict: dict, resources: res });
	}

	if (root)
		walk(root, null, 0);

	if (!pages.length)
		// No catalog found: every /Page object in file order
		for (let [num, o] of objects)
			if (/\/Type\s*\/Page(?![s])/.test(o.dict))
				pages.push({ dict: o.dict, resources: entry(o.dict, 'Resources') });

	// 4. Fonts
	let fontcache = new Map();

	function font(n) {

		if (fontcache.has(n))
			return fontcache.get(n);

		let dict = dictof(n);
		let f = { map: null, bytes: 1, type0: /\/Subtype\s*\/Type0/.test(dict), mac: false };
		let encoding = resolve(entry(dict, 'Encoding'));
		f.mac = /MacRomanEncoding/.test(encoding);
		let uni = refs(entry(dict, 'ToUnicode'))[0];
		let cmap = uni && objects.get(uni);

		if (cmap && cmap.data) {
			let text = inflate(cmap.data, cmap.dict);
			if (text) {
				let parsed = parsecmap(text.toString('latin1'));
				f.map = parsed.map;
				f.bytes = parsed.bytes;
			}
		}

		fontcache.set(n, f);
		return f;
	}

	function fontsof(page) {

		let res = resolve(page.resources);
		let fonts = resolve(entry(res, 'Font'));
		let out = {};

		fonts.replace(/\/([^\s/<>\[\]()]+)\s+(\d+)\s+\d+\s+R/g, function(all, name, n) {
			out[name] = font(+n);
			return '';
		});

		return out;
	}

	// 5. The text of a page from its content streams
	function pagetext(page) {

		let fonts = fontsof(page);
		let content = '';

		for (let n of refs(entry(page.dict, 'Contents'))) {
			let o = objects.get(n);
			let data = o && o.data ? inflate(o.data, o.dict) : null;
			data && (content += data.toString('latin1') + '\n');
		}

		let out = '';
		let current = null;
		let size = 12;
		let lasty = null;
		let stack = [];

		function show(raw) {
			if (current && current.map) {
				let step = current.type0 ? Math.max(current.bytes, 2) : current.bytes;
				for (let i = 0; i + step <= raw.length; i += step) {
					let code = 0;
					for (let k = 0; k < step; k++)
						code = code * 256 + raw.charCodeAt(i + k);
					let ch = current.map.get(code);
					if (ch != null)
						out += ch;
				}
			} else if (!current || !current.type0)
				// A simple font without a table: MacRoman or WinAnsi for the codes 128-255
				for (let k = 0; k < raw.length; k++) {
					let code = raw.charCodeAt(k);
					if (code >= 128 && current && current.mac)
						out += MACROMAN[code - 128];
					else if (code >= 128 && code < 160)
						out += WINANSI[code - 128] === '\uFFFD' ? '' : WINANSI[code - 128];
					else
						out += raw[k];
				}
		}

		function newline(dy) {

			if (!out || out.endsWith('\n\n'))
				return;
			out = out.replace(/ +$/, '');
			let big = Math.abs(dy) > size * 1.9;
			// Two moves in a row (a new line set by Td and Tm) are one line break
			if (out.endsWith('\n'))
				big && (out += '\n');
			else
				out += big ? '\n\n' : '\n';
		}

		// Tokens
		let i = 0;
		let len = content.length;

		while (i < len) {
			let c = content[i];

			if (c === ' ' || c === '\n' || c === '\r' || c === '\t' || c === '\f' || c === '\0')
				i++;
			else if (c === '%')
				while (i < len && content[i] !== '\n' && content[i] !== '\r')
					i++;
			else if (c === '(') {
				let depth = 1;
				let s = '';
				i++;

				while (i < len && depth) {
					let d = content[i];
					if (d === '\\') {
						let e = content[i + 1];
						if (e === 'n')
							s += '\n';
						else if (e === 'r')
							s += '\r';
						else if (e === 't')
							s += '\t';
						else if (e === 'b')
							s += '\b';
						else if (e === 'f')
							s += '\f';
						else if (/[0-7]/.test(e)) {
							let oct = content.substring(i + 1).match(/^[0-7]{1,3}/)[0];
							s += String.fromCharCode(parseInt(oct, 8) & 255);
							i += oct.length - 1;
						} else if (e === '\n' || e === '\r') {
							// line continuation
						} else
							s += e;
						i += 2;
						continue;
					}
					if (d === '(')
						depth++;
					else if (d === ')' && --depth === 0) {
						i++;
						break;
					}
					s += d;
					i++;
				}

				stack.push({ s: s });
			} else if (c === '<' && content[i + 1] !== '<') {
				let end = content.indexOf('>', i);
				let hex = content.substring(i + 1, end).replace(/\s+/g, '');
				let s = '';

				if (hex.length % 2)
					hex += '0';

				for (let k = 0; k < hex.length; k += 2)
					s += String.fromCharCode(parseInt(hex.substring(k, k + 2), 16));

				stack.push({ s: s });
				i = end + 1;
			} else if (c === '<' || c === '>')
				i += 2;
			else if (c === '[') {
				let arr = [];
				let depth = 0;
				let j = i;
				let save = stack;
				stack = [];
				i++;

				// Parse the array items with the same tokenizer on the next characters
				while (i < len && content[i] !== ']') {
					let d = content[i];
					if (d === '(') {
						let dd = 1;
						let s = '';
						i++;
						while (i < len && dd) {
							let e = content[i];
							if (e === '\\') {
								let f = content[i + 1];
								if (f === 'n')
									s += '\n';
								else if (/[0-7]/.test(f)) {
									let oct = content.substring(i + 1).match(/^[0-7]{1,3}/)[0];
									s += String.fromCharCode(parseInt(oct, 8) & 255);
									i += oct.length - 1;
								} else if (f !== '\n' && f !== '\r')
									s += f;
								i += 2;
								continue;
							}
							if (e === '(')
								dd++;
							else if (e === ')' && --dd === 0) {
								i++;
								break;
							}
							s += e;
							i++;
						}
						arr.push({ s: s });
					} else if (d === '<' && content[i + 1] !== '<') {
						let end = content.indexOf('>', i);
						let hex = content.substring(i + 1, end).replace(/\s+/g, '');
						if (hex.length % 2)
							hex += '0';
						let s = '';
						for (let k = 0; k < hex.length; k += 2)
							s += String.fromCharCode(parseInt(hex.substring(k, k + 2), 16));
						arr.push({ s: s });
						i = end + 1;
					} else if (/[-+.0-9]/.test(d)) {
						let num = content.substring(i).match(/^[-+]?[0-9]*\.?[0-9]+/);
						arr.push(num ? parseFloat(num[0]) : 0);
						i += num ? num[0].length : 1;
					} else
						i++;
				}

				i++;
				stack = save;
				stack.push({ a: arr });
			} else if (c === '/') {
				let name = content.substring(i + 1).match(/^[^\s/<>\[\]()%]*/)[0];
				stack.push({ n: name });
				i += name.length + 1;
			} else if (/[-+.0-9]/.test(c)) {
				let num = content.substring(i).match(/^[-+]?[0-9]*\.?[0-9]*/)[0];
				stack.push(parseFloat(num) || 0);
				i += num.length || 1;
			} else {
				let op = content.substring(i).match(/^[A-Za-z*'"0-9]+/);
				op = op ? op[0] : c;
				i += op.length;

				switch (op) {
					case 'Tf': {
						let name = stack.length > 1 ? stack[stack.length - 2] : null;
						let sz = stack[stack.length - 1];
						current = name && name.n != null ? fonts[name.n] || null : null;
						if (typeof sz === 'number' && sz > 0)
							size = sz;
						break;
					}
					case 'Td':
					case 'TD': {
						let dy = stack[stack.length - 1];
						if (typeof dy === 'number' && Math.abs(dy) > 0.01)
							newline(dy);
						else {
							let dx = stack[stack.length - 2];
							if (typeof dx === 'number' && dx > size * 0.2 && out && !/[\s\uFB00-\uFB06]$/.test(out))
								out += ' ';
						}
						break;
					}
					case 'Tm': {
						let y = stack[stack.length - 1];
						if (typeof y === 'number') {
							if (lasty != null && Math.abs(y - lasty) > 0.5)
								newline(y - lasty);
							lasty = y;
						}
						break;
					}
					case 'T*':
						newline(0);
						break;
					case 'BT':
						break;
					case 'ET':
						// A ligature is a piece of a word, not the end of one
						if (out && !/[\s\uFB00-\uFB06]$/.test(out))
							out += ' ';
						break;
					case 'Tj': {
						let t = stack[stack.length - 1];
						t && t.s != null && show(t.s);
						break;
					}
					case "'":
					case '"': {
						let t = stack[stack.length - 1];
						newline(0);
						t && t.s != null && show(t.s);
						break;
					}
					case 'TJ': {
						let t = stack[stack.length - 1];
						if (t && t.a)
							for (let part of t.a)
								if (part && part.s != null)
									show(part.s);
								else if (typeof part === 'number' && part < -250 && out && !/\s$/.test(out))
									out += ' ';

						break;
					}
				}

				stack = [];
			}
		}

		// Ligature glyphs back to letters
		out = out
			.replace(/\uFB00/g, 'ff')
			.replace(/\uFB01/g, 'fi')
			.replace(/\uFB02/g, 'fl')
			.replace(/\uFB03/g, 'ffi')
			.replace(/\uFB04/g, 'ffl')
			.replace(/[\uFB05\uFB06]/g, 'st');

		return out
			.replace(/[ \t]+\n/g, '\n')
			.replace(/\n{3,}/g, '\n\n')
			.replace(/[ \t]{2,}/g, ' ')
			.trim();
	}

	let text = [];

	for (let i = 0; i < pages.length; i++) {
		let page = pages[i];
		let t;
		try {
			t = pagetext(page);
		} catch {
			t = '';
		}
		t && text.push('## Page ' + (i + 1) + '\n\n' + t);
	}

	return { text: text.join('\n\n'), pages: pages.length };
}

// ==================================
// Entry point
// ==================================

// Returns { text, note }. Throws an Error with a message for the person when the file cannot be read.
exports.read = function(filename, buffer) {

	let name = filename.toLowerCase();

	if (PLAIN.test(name) || !/\.[a-z0-9]+$/.test(name)) {
		let text = buffer.toString('utf8');
		if (/\.html?$/.test(name))
			text = entities(
				text
					.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
					.replace(/<\/(p|div|h[1-6]|li|tr|br)>|<br\s*\/?>/gi, '\n\n')
					.replace(/<[^>]+>/g, '')
			);
		return { text: text.replace(/^﻿/, ''), note: '' };
	}

	if (/\.docx$/.test(name))
		return { text: docx(unzip(buffer)), note: '' };

	if (/\.odt$/.test(name))
		return { text: odt(unzip(buffer)), note: '' };

	if (/\.pptx$/.test(name))
		return { text: pptx(unzip(buffer)), note: '' };

	if (/\.xlsx$/.test(name))
		return { text: xlsx(unzip(buffer)), note: '' };

	if (/\.pdf$/.test(name)) {
		if (buffer.subarray(0, 5).toString('latin1') !== '%PDF-')
			throw new Error('@(It is not a valid PDF.)');

		let result = pdf(buffer);

		if (result.text.replace(/## Page \d+/g, '').trim().length < 20)
			throw new Error('@(This PDF has no text to read: it looks scanned, made of images. Run OCR on it first, or add it as text.)');

		return { text: result.text, note: result.pages + ' pages' };
	}

	if (/\.(doc|xls|ppt)$/.test(name))
		throw new Error('@(This is the old Office format. Save it as .docx, .xlsx or .pptx and add it again.)');

	throw new Error(
		'@(This type of file is not supported yet. Supported: text, Markdown, HTML, JSON, CSV, Word, OpenDocument, PowerPoint, Excel and PDF.)'
	);
};

exports.supported = '.txt,.md,.markdown,.html,.htm,.json,.csv,.tsv,.xml,.yml,.yaml,.log,.js,.ts,.css,.sql,.py,.docx,.odt,.pptx,.xlsx,.pdf';
