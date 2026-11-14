require('total5');
var { test } = require('node:test');
var Assert = require('node:assert/strict');
var Fs = require('node:fs'),
	Https = require('node:https'),
	Os = require('node:os'),
	Path = require('node:path'),
	{ execFileSync } = require('node:child_process');
var Discovery = require('../lib/discovery');
// A certificate for the name the test asks for, and the server that answers with `handler`.
function server(t, handler) {
	var dir = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'totalmail-pinned-'));
	t.after(() => Fs.rmSync(dir, { recursive: true, force: true }));
	execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', dir + '/key', '-out', dir + '/cert', '-days', '2', '-subj', '/CN=autoconfig.example.test', '-addext', 'subjectAltName=DNS:autoconfig.example.test'], { stdio: 'ignore' });
	var cert = Fs.readFileSync(dir + '/cert');
	var instance = Https.createServer({ key: Fs.readFileSync(dir + '/key'), cert }, handler);
	t.after(() => instance.close());
	return new Promise((resolve) => instance.listen(0, '127.0.0.1', () => resolve({ port: instance.address().port, ca: cert })));
}
function get(s, options) {
	// The name does not resolve anywhere: only the pinned address can make this work.
	return Discovery.pinnedget(new URL('https://autoconfig.example.test/config.xml'), { address: '127.0.0.1', family: 4 }, options || { limit: 64 * 1024, timeout: 3000 }, { port: s.port, ca: s.ca });
}
test('the request goes to the pinned address, not to wherever the name resolves', async (t) => {
	var s = await server(t, (req, res) => res.end('<config/>'));
	Assert.equal(await get(s), '<config/>');
});
test('an answer longer than the limit is refused', async (t) => {
	var s = await server(t, (req, res) => res.end('x'.repeat(70 * 1024)));
	await Assert.rejects(get(s), /too large/);
});
test('a redirect is not followed', async (t) => {
	var s = await server(t, (req, res) => (res.writeHead(302, { location: 'https://127.0.0.1/' }), res.end()));
	await Assert.rejects(get(s), /unavailable/);
});
test('a server that never answers ends at the timeout', async (t) => {
	var s = await server(t, () => {});
	await Assert.rejects(get(s, { limit: 1024, timeout: 300 }), /timeout/);
});
