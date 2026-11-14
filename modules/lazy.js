// A stand-in for a module that the framework loads (MODS.name) and that may not exist yet when this file is read: every
// property is looked up the moment it is used. Lets a library name its default collaborators without requiring them.
module.exports = function(get) {
	return new Proxy(
		{},
		{
			get: function(target, key) { return typeof get()[key] === 'function' ? function() { return get()[key].apply(get(), arguments); } : get()[key]; }
		}
	);
};
