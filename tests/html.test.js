require('total5');
const { test } = require('node:test');
const Assert = require('node:assert/strict');
const Module = require('node:module');
const Html = require('../lib/html');
const clean = (html, attachments) => Html.clean(html, attachments)?.html || '';

test('scripts, handlers, frames, forms and every other active construct disappear', () => {
	var attacks = [
		'<script>alert(1)</script>hello',
		'<img src=x onerror=alert(1)>',
		'<svg onload=alert(1)><circle/></svg>',
		'<iframe src="https://evil.test"></iframe>',
		'<object data="x.swf"></object>',
		'<embed src="x.swf">',
		'<form action="https://evil.test"><input name=p></form>',
		'<meta http-equiv="refresh" content="0;url=https://evil.test">',
		'<base href="https://evil.test/">',
		'<link rel="stylesheet" href="https://evil.test/x.css">',
		'<style>body{background:url(https://evil.test/x)}</style>',
		'<body onload=alert(1)>',
		'<math><mi xlink:href="javascript:alert(1)">x</mi></math>',
		'<details open ontoggle=alert(1)>',
		'<video src=x onerror=alert(1)></video>',
		'<a href="javascript:alert(1)">x</a>',
		'<a href="JaVaScRiPt:alert(1)">x</a>',
		'<a href="java\nscript:alert(1)">x</a>',
		'<a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">x</a>',
		'<a href="vbscript:msgbox(1)">x</a>',
		'<img src="javascript:alert(1)">',
		'<img src="data:text/html,<script>alert(1)</script>">',
		'<img src="data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+">',
		'<div style="background:url(javascript:alert(1))">x</div>',
		'<div style="width:expression(alert(1))">x</div>',
		'<div style="position:fixed;top:0;left:0;width:100%;height:100%">x</div>',
		'<div style="behavior:url(x.htc)">x</div>',
		'<p style="background-image:url(https://evil.test/p.png)">x</p>',
		'<img srcset="https://evil.test/a.png 1x" src="x">',
		'<noscript><img src=x onerror=alert(1)></noscript>',
		'<template><script>alert(1)</script></template>',
		'<textarea><script>alert(1)</script></textarea>',
		'<a href="//evil.test/x">x</a>'
	];
	for (var attack of attacks) {
		var out = clean('<p>before</p>' + attack + '<p>after</p>');
		Assert.ok(
			!/<script|<iframe|<object|<embed|<form|<input|<meta|<base|<link|<style|<svg|<math|<video|<template|<textarea|<noscript/i.test(
				out
			),
			'tag survived: ' + attack + ' => ' + out
		);
		Assert.ok(
			!/\son\w+\s*=|javascript:|vbscript:|data:text|expression\(|url\(|position\s*:|behavior|srcset|href="\/\//i.test(out),
			'unsafe value survived: ' + attack + ' => ' + out
		);
		Assert.ok(/before/.test(out) && /after/.test(out), 'the safe text around it stays: ' + attack);
	}
});
test('ordinary mail formatting is kept', () => {
	var out = clean(
		'<table style="width:100%;border-collapse:collapse"><tr><td style="color:#336699;font-size:14px;padding:4px 8px;text-align:center"><b>Hello</b> <i>there</i> <a href="https://example.test/p?a=1&b=2">link</a></td></tr></table><ul><li>one</li></ul><blockquote>quoted</blockquote><h2>Title</h2><br><hr>'
	);
	for (var piece of [
		'<table',
		'<td',
		'color:#336699',
		'font-size:14px',
		'text-align:center',
		'<b>Hello</b>',
		'<i>there</i>',
		'<ul>',
		'<li>one</li>',
		'<blockquote>',
		'<h2>Title</h2>',
		'https://example.test/p?a=1&amp;b=2'
	])
		Assert.ok(out.includes(piece), piece + ' => ' + out);
});
test('hidden pre-header text stays hidden and nothing positions content over the page', () => {
	var out = clean(
		'<div style="display:none;max-height:0;overflow:hidden;font-size:0;line-height:0;opacity:0;mso-hide:all">preheader</div><span style="visibility:hidden">x</span><p style="overflow:visible">shown</p><div style="overflow:scroll;position:absolute;display:flex">y</div>'
	);
	Assert.match(out, /display:none/);
	Assert.match(out, /max-height:0/);
	Assert.match(out, /overflow:hidden/);
	Assert.match(out, /opacity:0/);
	Assert.match(out, /visibility:hidden/);
	Assert.ok(!/mso-hide|position|overflow:scroll|display:flex/.test(out));
	Assert.ok(!/overflow-wrap:\s*anywhere/.test(Html.document(out, false)), 'narrow cells are not broken letter by letter');
});
test('links open elsewhere without sending where they came from', () => {
	var out = clean(
		'<a href="https://example.test/x" target="_self" rel="opener">go</a><a href="mailto:me@example.test">mail</a><a href="tel:+421900000000">call</a>'
	);
	Assert.equal((out.match(/target="_blank"/g) || []).length, 3);
	Assert.equal((out.match(/rel="noopener noreferrer nofollow"/g) || []).length, 3);
	Assert.ok(!out.includes('rel="opener"') && !out.includes('_self'));
	Assert.ok(out.includes('mailto:me@example.test') && out.includes('tel:+421900000000'));
});
test('remote images are neutralised and counted, inline ones are embedded, nothing else gets a source', () => {
	var png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
	var result = Html.clean(
		'<img src="https://tracker.example/pixel.gif" width="1" height="1"><img src="cid:logo@x"><img src="cid:missing"><img src="data:image/png;base64,AAAA"><img src="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=">',
		[
			{ cid: 'logo@x', contentType: 'image/png', content: png },
			{ cid: 'doc', contentType: 'application/pdf', content: Buffer.from('x') }
		]
	);
	Assert.equal(result.remoteImages, 1);
	Assert.ok(result.html.includes('data-remote-src="https://tracker.example/pixel.gif"'));
	Assert.ok(!/ src="https?:/i.test(result.html), 'no remote source is active');
	Assert.ok(result.html.includes('src="data:image/png;base64,' + png.toString('base64')));
	Assert.ok(!result.html.includes('cid:') && !result.html.includes('svg+xml'));
	var blocked = Html.document(result.html, false),
		allowed = Html.document(result.html, true);
	Assert.ok(!/ src="https:\/\/tracker/.test(blocked));
	Assert.ok(/ src="https:\/\/tracker\.example\/pixel\.gif"/.test(allowed));
	Assert.ok(
		blocked.startsWith('<!doctype html>') &&
			blocked.includes('<base target="_blank">') &&
			blocked.includes('name="referrer" content="no-referrer"')
	);
});
test('the frame policy blocks scripts and all network access, and images only when allowed', () => {
	var off = Html.headers(false)['content-security-policy'],
		on = Html.headers(true)['content-security-policy'];
	for (var policy of [off, on]) {
		Assert.match(policy, /^sandbox allow-popups allow-popups-to-escape-sandbox;/);
		Assert.ok(!/allow-scripts|allow-same-origin|allow-forms/.test(policy));
		Assert.match(policy, /default-src 'none'/);
		Assert.match(policy, /frame-ancestors 'self'/, 'falls back to self without an origin');
		Assert.ok(!/script-src/.test(policy));
	}
	var framed = Html.headers(false, 'https://mail.example.test')['content-security-policy'];
	Assert.match(framed, /frame-ancestors https:\/\/mail\.example\.test;/);
	Assert.ok(!framed.includes("frame-ancestors 'self'"));
	Assert.ok(!/https:/.test(off));
	Assert.match(on, /img-src data: https: http:/);
	Assert.equal(Html.headers(false)['x-frame-options'], undefined, 'framing is governed by frame-ancestors');
	Assert.equal(Html.headers(false)['referrer-policy'], 'no-referrer');
});
test('empty, oversized or script-only HTML gives nothing to show, so the plain text is used', () => {
	Assert.equal(Html.clean(''), null);
	Assert.equal(Html.clean(false), null);
	Assert.equal(Html.clean('<script>alert(1)</script>'), null);
	Assert.equal(Html.clean('<p>' + 'x'.repeat(Html.limits.output + 10) + '</p>'), null);
	Assert.equal(Html.clean('<p>' + 'x'.repeat(1024 * 1024 + 1) + '</p>'), null);
});
test('without the sanitizer library nothing is rendered', () => {
	var load = Module._load;
	Html.forget();
	Module._load = function(request, ...rest) {
		if (request === 'sanitize-html')
			throw Error('Cannot find module');
		return load.call(this, request, ...rest);
	};
	try {
		Assert.equal(Html.clean('<p>hello</p>'), null);
	} finally {
		Module._load = load;
		Html.forget();
	}
	Assert.ok(Html.clean('<p>hello</p>'));
});
test('a styled link (a button in most mail) keeps its safe styles and loses the unsafe ones', () => {
	var html = clean(
		'<a href="https://x.test" style="display:inline-block;background-color:#09f;padding:10px 20px;border-radius:4px;color:#fff;background-image:url(https://evil.test/p.png);position:fixed">Go</a>'
	);
	Assert.match(html, /<a [^>]*style="[^"]*display:inline-block/);
	Assert.match(html, /background-color:#09f/);
	Assert.match(html, /padding:10px 20px/);
	Assert.match(html, /border-radius:4px/);
	Assert.match(html, /rel="noopener noreferrer nofollow"/);
	Assert.doesNotMatch(html, /evil\.test|position|background-image/);
});
test('common layout styles survive; a background that is not a plain colour never does', () => {
	var html = clean(
		'<table style="background:#f4f4f4;table-layout:fixed;border-spacing:0"><tr><td style="border-width:1px;border-style:solid;font:14px/1.5 Arial,sans-serif;border-top-left-radius:4px">x</td></tr></table>'
	);
	for (var part of ['background:#f4f4f4', 'table-layout:fixed', 'border-width:1px', 'border-style:solid', 'border-top-left-radius:4px', 'font:14px/1.5 Arial,sans-serif'])
		Assert.ok(html.includes(part), part);
	for (var attack of [
		'background:url(https://evil.test/x.png)',
		'background:url(javascript:alert(1))',
		'background:linear-gradient(red,blue)',
		'font:14px Arial;x:url(https://evil.test)',
		'font:url(https://evil.test/f)'
	])
		Assert.doesNotMatch(clean('<div style="' + attack + '">x</div>'), /evil\.test|url\(|gradient|javascript/, attack);
});
