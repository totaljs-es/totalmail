// Accessible names for the form fields drawn by jComponent's input component. The component paints its label as a plain
// <div> that is not tied to the field, gives every text field role="combobox" and leaves dropdowns without a role, so
// a screen reader hears nothing useful. This runs for every window of every plugin, now and whenever one is rendered (the a11y component).
(function() {

	var counter = 0,
		queued = false;
	function identify(el, prefix) {
		if (!el.id)
			el.id = prefix + ++counter;
		return el.id;
	}
	function fix() {
		queued = false;
		for (var box of document.querySelectorAll('ui-component.ui-input')) {
			var label = box.querySelector(':scope > .ui-input-label'),
				dropdown = box.querySelector('.ui-input-value[tabindex]'),
				field = box.querySelector('input, textarea');
			if (dropdown) {
				// A dropdown is a button that opens a list; it is named by its label and read together with its value.
				if (!dropdown.getAttribute('role')) {
					dropdown.setAttribute('role', 'button');
					dropdown.setAttribute('aria-haspopup', 'listbox');
				}
				if (label && !dropdown.hasAttribute('aria-labelledby') && !dropdown.hasAttribute('data-named'))
					dropdown.setAttribute('aria-labelledby', identify(label, 'ui-label-') + ' ' + identify(dropdown, 'ui-value-'));
			}
			if (!field)
				continue;
			if (label && !field.hasAttribute('aria-labelledby') && !field.hasAttribute('aria-label'))
				field.setAttribute('aria-labelledby', identify(label, 'ui-label-'));
			// Plain text fields are text boxes; only the ones that own a list (aria-controls) stay combo boxes.
			if (field.getAttribute('role') === 'combobox' && !field.hasAttribute('aria-controls') && !dropdown) {
				field.removeAttribute('role');
				field.removeAttribute('aria-expanded');
				field.removeAttribute('aria-haspopup');
			}
		}
	}
	// A field that has no visible label of its own says what it is with data-label (the text) or data-labelledby (the id of the text
	// that is already on the page): the dropdown keeps its value in what is read out.
	function named() {
		for (var box of document.querySelectorAll('[data-label],[data-labelledby]')) {
			var dropdown = box.querySelector('.ui-input-value[tabindex]'),
				field = dropdown || box.querySelector('input');
			if (!field || field.hasAttribute('data-named'))
				continue;
			field.setAttribute('data-named', '1');
			var labelid = box.getAttribute('data-labelledby');
			if (!labelid) {
				var hidden = document.createElement('span');
				hidden.className = 'sr-only';
				hidden.id = 'ui-name-' + ++counter;
				hidden.textContent = box.getAttribute('data-label');
				if (dropdown)
					field.parentNode.insertBefore(hidden, field);
				else
					field.setAttribute('aria-label', box.getAttribute('data-label'));
				labelid = hidden.id;
			}
			if (dropdown) {
				field.setAttribute('role', 'button');
				field.setAttribute('aria-haspopup', 'listbox');
				field.removeAttribute('aria-label');
				field.setAttribute('aria-labelledby', labelid + ' ' + identify(field, 'ui-value-'));
			}
		}
	}
	function schedule() {

		if (queued)
			return;
		queued = true;
		setTimeout(() => {
			fix();
			named();
		}, 30);
	}
	COMPONENT('a11y', function(self) {

		self.singleton();
		self.readonly();
		self.nocompile && self.nocompile();
		self.make = function() {

			self.aclass('hidden');
			new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
			schedule();
		};
	});
})();
