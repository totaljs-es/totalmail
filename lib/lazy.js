// A stand-in for a module that the framework loads (MODS.name) and that may not exist yet when this file is read: every
// property is looked up the moment it is used. Lets a library name its default collaborators without requiring them.
module.exports = (get) =>
	new Proxy(
		{},
		{
			get: (target, key) => (typeof get()[key] === 'function' ? (...args) => get()[key](...args) : get()[key])
		}
	);
