// What the browser does by itself (a file dialog, a drop, a key, a scroll, the focus) is handled here, in components, so that the
// plugins never touch the page: they only receive what happened (exec) or read and write their model.

// Opens the file browser of the computer and hands the files over; one for the whole page: SETTER('filepicker/open', opt)
// with opt = { accept: '.txt,.md', multiple: true, callback: function(files) }.
COMPONENT('filepicker', function(self) {

	var input;
	self.readonly();
	self.nocompile && self.nocompile();
	self.singleton();
	self.make = function() {

		self.aclass('hidden');
		self.append('<input type="file" tabindex="-1" aria-hidden="true" />');
		input = self.find('input');
		input.on('change', function() {

			var files = [...input[0].files];
			input[0].value = '';
			files.length && self.opt && self.opt.callback && self.opt.callback(files);
		});
	};
	self.open = function(opt) {

		self.opt = opt;
		input.attr('accept', opt.accept || '*/*').prop('multiple', !!opt.multiple);
		input.trigger('click');
	};
});

// Files dragged over the window: its path is true while they are over it, and what is dropped goes to config.exec(files).
COMPONENT('dropfiles', function(self, config) {

	var has = (event) => [...(event.dataTransfer?.types || [])].includes('Files');
	self.singleton();
	self.nocompile && self.nocompile();
	self.make = function() {

		self.aclass('hidden');
		document.addEventListener('dragover', function(event) {

			if (!has(event))
				return;
			event.preventDefault();
			if (!self.get())
				self.set(true);
		});
		document.addEventListener('dragleave', function(event) {
			if (!event.relatedTarget)
				self.set(false);
		});
		document.addEventListener('drop', function(event) {

			if (!has(event))
				return;
			// The browser would otherwise leave the app to show the file.
			event.preventDefault();
			self.set(false);
			self.EXEC(config.exec, [...event.dataTransfer.files]);
		});
	};
});

// Every key pressed on the page goes to config.exec(event); the plugin decides what it means.
COMPONENT('keys', function(self, config) {

	self.singleton();
	self.readonly();
	self.nocompile && self.nocompile();
	self.make = function() {
		self.aclass('hidden');
		document.addEventListener('keydown', (event) => self.EXEC(config.exec, event));
	};
});

// A box that scrolls: config.exec() is called when its end comes near (config.offset pixels).
COMPONENT('scrollend', function(self, config) {
	self.readonly();
	self.make = function() {
		self.element.on('scroll', function() {
			if (this.scrollTop + this.clientHeight > this.scrollHeight - (+config.offset || 500))
				self.EXEC(config.exec);
		});
	};
});

// Small things only the page can do: SETTER('page/focus', selector), SETTER('page/reveal', selector) (scrolls it into view
// when it is out of it), SETTER('page/download', url) (a download that does not leave the page) and
// SETTER('page/save', filename, text) (a text the person keeps as a file).
COMPONENT('page', function(self) {

	self.singleton();
	self.readonly();
	self.nocompile && self.nocompile();
	self.make = () => self.aclass('hidden');
	self.focus = (selector) => document.querySelector(selector)?.focus();
	self.reveal = (selector) => document.querySelector(selector)?.scrollIntoView({ block: 'nearest' });
	self.download = function(url, name) {

		var link = document.createElement('a');
		link.href = url;
		link.download = name || '';
		link.click();
	};
	self.save = function(name, text) {

		var url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
		self.download(url, name);
		setTimeout(() => URL.revokeObjectURL(url), 1000);
	};
});

// The window and the network: config.visible is called when the window is shown or hidden, config.online when the network
// comes back and config.leaving when the page is closed (all plugin/method).
COMPONENT('pageevents', function(self, config) {

	self.singleton();
	self.readonly();
	self.nocompile && self.nocompile();
	self.make = function() {

		self.aclass('hidden');
		var call = (path, event) => path && self.EXEC(path, event);
		document.addEventListener('visibilitychange', (event) => call(config.visible, event));
		window.addEventListener('online', (event) => call(config.online, event));
		window.addEventListener('pagehide', (event) => !event.persisted && call(config.leaving, event));
	};
});

// Leaving the page: config.check (plugin/method) says whether something would be lost; the browser then asks.
COMPONENT('beforeleave', function(self, config) {

	self.singleton();
	self.readonly();
	self.nocompile && self.nocompile();
	self.make = function() {

		self.aclass('hidden');
		var path = config.check.split('/');
		window.addEventListener('beforeunload', function(event) {
			if (PLUGINS[path[0]][path[1]]()) {
				event.preventDefault();
				event.returnValue = '';
			}
		});
	};
});

// A window is open (its path is the name of the window): what is behind it cannot be reached, Tab stays inside it, the focus
// goes into it and comes back to where it was when it closes.
COMPONENT('modalguard', function(self, config) {

	var remembered = null;
	self.singleton();
	self.nocompile && self.nocompile();
	self.make = function() {
		self.aclass('hidden');
		document.addEventListener('keydown', function(event) {

			var name = self.get(),
				root = name && document.getElementById(name);
			if (!root || event.key !== 'Tab')
				return;
			var controls = [...root.querySelectorAll('button:not([disabled]),input,textarea,select,[tabindex="0"]')].filter(
				(el) => el.offsetParent !== null
			);
			var first = controls[0],
				last = controls[controls.length - 1];
			if (event.shiftKey && document.activeElement === first) {
				event.preventDefault();
				last?.focus();
			} else if (!event.shiftKey && document.activeElement === last) {
				event.preventDefault();
				first?.focus();
			}
		});
	};
	self.setter = function(name) {

		var shell = document.querySelector(config.shell || '.app-shell');
		if (!shell)
			return;
		if (name) {
			if (!shell.inert)
				remembered = document.activeElement;
			shell.inert = true;
			requestAnimationFrame(() => document.querySelector('#' + name + ' button')?.focus());
		} else {
			shell.inert = false;
			remembered?.focus();
		}
	};
});

// Suggestions of addresses while typing in a field of recipients (it wraps the input component). The addresses are the list
// at config.source (a path); nothing leaves the browser. The field says to assistive technology whether the list is open and
// which suggestion is active.
COMPONENT('addresssuggest', function(self, config) {

	var menu,
		items = [],
		active = -1,
		input = null;
	var parts = (value) => String(value || '').split(/[,;]/);
	function hide() {

		menu.attr('hidden', '');
		items = [];
		active = -1;
		combo();
	}
	function combo() {

		if (!input)
			return;
		var option = items.length && !menu[0].hasAttribute('hidden') ? menu.find('[role=option]')[active] : null;
		input.setAttribute('aria-expanded', option ? 'true' : 'false');
		if (option)
			input.setAttribute('aria-activedescendant', option.id);
		else
			input.removeAttribute('aria-activedescendant');
	}
	// The field is a combo box: it says so to assistive technology, whether the list is open and which suggestion is active.
	function prepare(el) {

		input = el;
		if (el.getAttribute('role') === 'combobox')
			return;
		el.setAttribute('autocomplete', 'off');
		el.setAttribute('role', 'combobox');
		el.setAttribute('aria-controls', menu.attr('id'));
		el.setAttribute('aria-autocomplete', 'list');
		el.setAttribute('aria-expanded', 'false');
		el.removeAttribute('aria-haspopup');
	}
	function pick(email) {

		var done = parts(input.value).map((v) => v.trim());
		done.pop();
		self.set([...done.filter(Boolean), email].join(', ') + ', ');
		hide();
		input.focus();
	}
	function show() {

		var chosen = new Set(
			parts(input.value)
				.slice(0, -1)
				.map((v) => v.trim().toLowerCase())
		);
		var found = totalmailcontacts.match(GET(config.source) || [], parts(input.value).pop()).filter((c) => !chosen.has(c.email));
		if (!found.length)
			return hide();
		items = found;
		active = 0;
		menu.html(
			found
				.map(
					(c, i) =>
						'<button type="button" role="option" id="' +
						menu.attr('id') +
						'-' +
						i +
						'" tabindex="-1" aria-selected="' +
						(i === 0) +
						'" class="contact-option' +
						(i === 0 ? ' active' : '') +
						'" data-email="' +
						Thelpers.encode(c.email) +
						'"><strong>' +
						Thelpers.encode(c.name || c.email) +
						'</strong>' +
						(c.name ? '<small>' + Thelpers.encode(c.email) + '</small>' : '') +
						'</button>'
				)
				.join('')
		);
		var box = input.getBoundingClientRect();
		menu.css({ left: box.left + 'px', top: box.bottom + 2 + 'px', width: box.width + 'px' });
		menu.removeAttr('hidden');
		combo();
	}
	function keys(event) {
		if (!items.length || menu[0].hasAttribute('hidden'))
			return;
		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			event.preventDefault();
			active = (active + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
			menu.find('[role=option]').each(function(i) {
				$(this)
					.tclass('active', i === active)
					.attr('aria-selected', String(i === active));
			});
			combo();
		} else if (event.key === 'Enter' || event.key === 'Tab') {
			event.preventDefault();
			pick(items[active].email);
		} else if (event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			hide();
		}
	}
	self.make = function() {

		// The list is drawn under the field, outside the window, so that nothing clips it.
		menu = $('<div class="contacts-menu" role="listbox" hidden></div>');
		menu.attr('id', 'contacts-menu-' + self.id).attr('aria-label', config.label || '');
		$(document.body).append(menu);
		menu.on('mousedown', '[data-email]', function(event) {
			event.preventDefault();
			pick(this.getAttribute('data-email'));
		});
		self.element.on('focusin', 'input', function() {
			prepare(this);
		});
		self.element.on('input', 'input', function() {
			prepare(this);
			show();
		});
		self.element.on('keydown', 'input', keys);
		self.element.on('focusout', 'input', () => setTimeout(hide, 150));
	};
	self.destroy = function() {
		menu && menu.remove();
	};
	// The list belongs to the composer: it must not outlive it.
	WATCH('mail.window', (value) => value !== 'composer' && menu && hide());
});

// The text of a message: the formatting buttons and keys write the small markup the server turns into HTML on send, files can
// be pasted, and the cursor can be put where it is needed. It wraps the input component of the body (a multiline one).
//   config.paste: function(files)  called with the files pasted from the clipboard (a screenshot, say)
COMPONENT('mailbody', function(self, config) {

	var area = () => self.find('textarea')[0];
	// The model follows the text: written by a command, it must be told.
	function changed(el) {
		el.focus();
		self.set(el.value);
	}
	self.focus = function(start) {

		var el = area();
		if (!el)
			return;
		el.focus();
		if (start === 0)
			el.setSelectionRange(0, 0);
	};
	self.format = function(kind) {

		var el = area();
		if (!el)
			return;
		var text = el.value,
			start = el.selectionStart,
			end = el.selectionEnd,
			selected = text.slice(start, end),
			insert;
		if (kind === 'bold' || kind === 'italic') {
			var mark = kind === 'bold' ? '**' : '*',
				label = selected || TRANSLATE(kind === 'bold' ? '@(bold text)' : '@(italic text)');
			var wrapped = text.slice(start - mark.length, start) === mark && text.slice(end, end + mark.length) === mark;
			if (wrapped && selected) {
				// The selection is already marked: unmark it.
				el.setRangeText(selected, start - mark.length, end + mark.length, 'select');
				return changed(el);
			}
			insert = mark + label + mark;
			el.setRangeText(insert, start, end, 'end');
			el.setSelectionRange(start + mark.length, start + mark.length + label.length);
		} else if (kind === 'link') {
			var linktext = selected || TRANSLATE('@(link text)');
			insert = '[' + linktext + '](https://)';
			el.setRangeText(insert, start, end, 'end');
			// The address is what comes next, so it is the part left selected.
			el.setSelectionRange(start + linktext.length + 3, start + insert.length - 1);
		} else {
			// Lists and quotes prefix every line of the selection; doing it again takes the prefix off.
			var first = text.lastIndexOf('\n', start - 1) + 1,
				last = text.indexOf('\n', end);
			if (last === -1)
				last = text.length;
			var lines = text.slice(first, last).split('\n'),
				number = 0;
			var pattern = kind === 'ul' ? /^- / : kind === 'quote' ? /^> / : /^\d+\. /;
			var prefix = () => (kind === 'ul' ? '- ' : kind === 'quote' ? '> ' : ++number + '. ');
			var all = lines.every((line) => !line.trim() || pattern.test(line));
			var result = lines.map((line) => (!line.trim() ? line : all ? line.replace(pattern, '') : prefix() + line)).join('\n');
			el.setRangeText(result, first, last, 'select');
		}
		changed(el);
	};
	// The marks drawn as what they make: behind the box (whose own text is transparent) there is a copy of the text with the marks
	// dimmed and the words coloured, in colour only so that no letter changes width and the cursor stays where the text is.
	var mirror = null;
	function sync() {

		var el = area();
		if (!el || !mirror)
			return;
		var style = getComputedStyle(el);
		for (var key of ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'wordSpacing', 'textIndent', 'tabSize', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'direction', 'textAlign'])
			mirror.style[key] = style[key];
		mirror.style.width = el.clientWidth + 'px';
		mirror.style.height = el.clientHeight + 'px';
		mirror.style.left = el.offsetLeft + 'px';
		mirror.style.top = el.offsetTop + 'px';
		mirror.scrollTop = el.scrollTop;
	}
	function paint() {

		var el = area();
		if (!el)
			return;
		if (!mirror || mirror.parentNode !== el.parentNode) {
			mirror = document.createElement('div');
			mirror.className = 'mailbody-mirror';
			mirror.setAttribute('aria-hidden', 'true');
			el.parentNode.classList.add('mailbody-live');
			el.parentNode.insertBefore(mirror, el);
			el.addEventListener('scroll', () => (mirror.scrollTop = el.scrollTop));
			if (window.ResizeObserver)
				new ResizeObserver(sync).observe(el);
		}
		// The last line break keeps the copy as tall as the box when the text ends with one.
		mirror.innerHTML = totalmailformat.live(el.value) + '\n';
		sync();
	}
	self.setter = function() {
		requestAnimationFrame(paint);
	};
	self.make = function() {

		setTimeout(paint, 60);
		self.element.on('input', 'textarea', paint);
		self.element.on('paste', 'textarea', function(event) {

			var data = (event.originalEvent || event).clipboardData,
				files = [...(data?.files || [])];
			// Text (even with a picture alongside, as Word and web pages put it) pastes as text; only a bare file is attached.
			if (!files.length || data.getData('text/plain'))
				return;
			event.preventDefault();
			self.EXEC(config.paste, files);
		});
		self.element.on('keydown', 'textarea', function(event) {

			var key = event.key.toLowerCase();
			if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey || !['b', 'i', 'k'].includes(key))
				return;
			event.preventDefault();
			self.format(key === 'b' ? 'bold' : key === 'i' ? 'italic' : 'link');
		});
	};
});
