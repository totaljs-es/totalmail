const { test } = require('node:test');
const Assert = require('node:assert/strict');
const Format = require('../plugins/mail/public/format');

test('text without formatting stays plain text, even with bare links', () => {
	Assert.equal(Format.render('Hola,\n\nmira https://totaljs.es y 2 * 3 = 6\n\nUn abrazo'), null);
	Assert.equal(Format.render('snake_case_name y a*b*c'), null);
	Assert.equal(Format.render(''), null);
});
test('bold, italic and links become tags and the plain part stays readable', () => {
	var r = Format.render('Hola **Lucía**, *mira* [esto](https://totaljs.es/x?a=1&b=2).');
	Assert.match(r.html, /<strong>Lucía<\/strong>/);
	Assert.match(r.html, /<em>mira<\/em>/);
	Assert.match(r.html, /<a href="https:\/\/totaljs\.es\/x\?a=1&amp;b=2"[^>]*>esto<\/a>/);
	Assert.equal(r.plain, 'Hola Lucía, mira esto (https://totaljs.es/x?a=1&b=2).');
});
test('lists and quotes are grouped, numbered lists keep their numbers in the plain part', () => {
	var r = Format.render('Pasos:\n- uno\n- **dos**\n\n1. primero\n2. segundo\n\n> cita\n> más');
	Assert.match(r.html, /<ul[^>]*><li>uno<\/li><li><strong>dos<\/strong><\/li><\/ul>/);
	Assert.match(r.html, /<ol[^>]*><li>primero<\/li><li>segundo<\/li><\/ol>/);
	Assert.match(r.html, /<blockquote[^>]*>cita<br>más<\/blockquote>/);
	Assert.equal(r.plain, 'Pasos:\n- uno\n- dos\n\n1. primero\n2. segundo\n\n> cita\n> más');
});
test('nothing typed can become markup or an unsafe link', () => {
	var r = Format.render(
		'**<img src=x onerror=alert(1)>** <script>x</script> [clic](javascript:alert) [dato](data:text/html,x) [ok](https://a.test/"onmouseover="x)'
	);
	Assert.doesNotMatch(r.html, /<img|<script|href="(javascript|data):/i);
	Assert.match(r.html, /\[clic\]\(javascript:alert\)/);
	Assert.match(r.html, /&lt;img src=x onerror=alert\(1\)&gt;/);
	Assert.doesNotMatch(r.html, /href="https:\/\/a\.test\/"onmouseover/);
	Assert.doesNotMatch(r.html, /"onmouseover="/);
});
test('the signature below "-- " is kept as written and never formatted', () => {
	var r = Format.render('**Hola**\n\n-- \nGera *Güiles*\nTotal.js · totaljs.es');
	Assert.match(r.html, /<strong>Hola<\/strong>/);
	Assert.match(r.html, /Gera \*Güiles\*<br>Total\.js/);
	Assert.equal(r.plain, 'Hola\n\n-- \nGera *Güiles*\nTotal.js · totaljs.es');
});
test('a long line of asterisks is handled quickly', () => {
	var start = Date.now();
	Format.render('*'.repeat(20000) + ' ' + '**a '.repeat(3000));
	Assert.ok(Date.now() - start < 1000);
});

test('the live view has exactly the characters of the text, with the marks apart from the words', () => {
	var text = 'Hola **Lucía**, *mira* [esto](https://totaljs.es) y https://example.test.\n- uno\n1. dos\n> cita\n-- \nAna **Gómez**';
	var html = Format.live(text);
	// Taking the tags away gives the text back: nothing is added, lost or moved.
	var plain = html
		.replace(/<[^>]*>/g, '')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&amp;/g, '&');
	Assert.equal(plain, text);
	Assert.match(html, /<span class="mk-bold">Lucía<\/span>/);
	Assert.match(html, /<span class="mk-italic">mira<\/span>/);
	Assert.match(html, /<span class="mk-link">esto<\/span>/);
	Assert.match(html, /<span class="mk-link">https:\/\/example\.test<\/span>/);
	Assert.match(html, /<span class="mk-mark">- <\/span>uno/);
	Assert.match(html, /<span class="mk-quote"><span class="mk-mark">&gt; <\/span>cita<\/span>/);
	Assert.match(html, /<span class="mk-sig">-- <\/span>\n<span class="mk-sig">Ana \*\*Gómez\*\*<\/span>/);
});
test('the live view escapes what the person writes', () => {
	var html = Format.live('<script>alert(1)</script> **<b>x</b>**');
	Assert.ok(!/<script|<b>/.test(html));
	Assert.match(html, /&lt;script&gt;/);
});
