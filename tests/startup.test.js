const { test } = require('node:test'),
	Assert = require('node:assert/strict');
const Fs = require('node:fs'),
	Path = require('node:path'),
	Os = require('node:os'),
	Net = require('node:net'),
	{ spawn } = require('node:child_process');
const root = Path.join(__dirname, '..');

async function start(t, mode) {
	var directory = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'totalmail-startup-'));
	Fs.copyFileSync(Path.join(root, 'index.js'), Path.join(directory, 'index.js'));
	Fs.mkdirSync(Path.join(directory, 'definitions'));
	Fs.writeFileSync(
		Path.join(directory, 'definitions/probe.js'),
		"ROUTE('GET /startup-test/', $ => $.json({ debug: DEBUG, name: CONF.name, port: CONF.$port, proxy: CONF.trust_proxy, env: process.env.NODE_ENV }));"
	);
	var socket = Net.createServer();
	await new Promise((resolve) => socket.listen(0, '127.0.0.1', resolve));
	var port = socket.address().port;
	await new Promise((resolve) => socket.close(resolve));
	var config = 'name : TotalMail startup test\n$ip : 127.0.0.1\ntrust_proxy (boolean) : false\n';
	if (mode === 'config')
		config += 'production (boolean) : true\n$port : ' + port + '\n';
	else
		config += 'production : false\n';
	if (mode !== 'missing')
		Fs.writeFileSync(Path.join(directory, 'config'), config);
	var env = { ...process.env, NODE_PATH: Path.join(root, 'node_modules') };
	delete env.PORT;
	delete env.NODE_ENV;
	var args = ['index.js'];
	if (mode === 'environment') {
		env.NODE_ENV = 'production';
		env.PORT = String(port);
	} else if (mode === 'release')
		args.push(String(port), '--release');
	else if (mode === 'missing') {
		env.NODE_ENV = 'production';
		args.push(String(port));
	}
	var child = spawn(process.execPath, args, { cwd: directory, env, stdio: ['ignore', 'pipe', 'pipe'] });
	var logs = '';
	child.stdout.on('data', (chunk) => (logs += chunk));
	child.stderr.on('data', (chunk) => (logs += chunk));
	t.after(async () => {
		child.kill('SIGTERM');
		if (child.exitCode === null)
			await new Promise((resolve) => child.once('exit', resolve));
		Fs.rmSync(directory, { recursive: true, force: true });
	});
	for (var i = 0; i < 80; i++) {
		if (child.exitCode !== null)
			throw Error('Startup failed: ' + logs);
		try {
			var response = await fetch('http://127.0.0.1:' + port + '/startup-test/');
			if (response.ok)
				return { state: await response.json(), logs };
		} catch {}
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	throw Error('Startup timed out: ' + logs);
}

for (let mode of ['config', 'environment', 'release', 'missing'])
	test('real Total.js startup: ' + mode, { timeout: 15000 }, async (t) => {
		var result = await start(t, mode);
		Assert.equal(result.state.debug, false, 'release must not run the debug watcher');
		Assert.equal(result.state.env, 'production');
		Assert.doesNotMatch(result.logs, /DEBUG PID|RELEASE PID/, 'one application process, without a watcher');
		if (mode !== 'missing') {
			Assert.equal(result.state.name, 'TotalMail startup test');
			Assert.equal(result.state.proxy, false, 'typed values use the native configuration parser');
		}
	});
