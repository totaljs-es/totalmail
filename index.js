// Total.js v5: one process, with the framework's own configuration and startup.
require('total5');

// Read the same config the framework loads before choosing its watcher. Use its parser so typed values, comments and
// the normal Total.js configuration syntax have the same meaning here and after the application is loaded.
try {
	LOADCONFIG(Total.Fs.readFileSync(PATH.root('config'), 'utf8'));
} catch (err) {
	if (err.code !== 'ENOENT')
		throw err;
}

var production = CONF.production === true || process.env.NODE_ENV === 'production' || process.argv.includes('--release');

var options = {
	watcher: !production,
	servicemode: process.argv.includes('--service') || process.argv.includes('--servicemode')
};

if (production)
	process.env.NODE_ENV = 'production';

Total.run(options);
