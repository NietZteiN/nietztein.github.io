/*
 * ToyKit tests. Node built-ins only; run from anywhere:
 *     node misc/_kit/test.js
 * Prints one PASS or FAIL line per check and exits 1 if any check failed.
 *
 * What is covered: the pure half of kit.js (hash, rng, daily, front matter,
 * comment stripping, markdown to text, root and id derivation), agreement of
 * hash and rng with misc/55-paper-theatre/vn.js, the published blog posts
 * (found through blog/index.json only, never by listing a folder), library.js
 * against assets/js/bookshelf.js (the logic of scripts/check-tables.mjs), and
 * the template's static contract. The browser half (header, dialog, theme,
 * audio) needs a browser: see README.md.
 */
'use strict';
var fs = require('fs');
var path = require('path');
var url = require('url');
var vm = require('vm');

var HERE = __dirname;
var ROOT = path.resolve(HERE, '..', '..');
var Kit = require('./kit.js');
var Lib = require('./library.js');

var passed = 0, failed = 0, skipped = 0, section = '';
function ok(cond, msg) {
	if (cond) { passed++; console.log('PASS  ' + section + ': ' + msg); return true; }
	failed++;
	console.log('FAIL  ' + section + ': ' + msg);
	return false;
}
function eq(got, expected, msg) {
	var same = JSON.stringify(got) === JSON.stringify(expected);
	return ok(same, same ? msg : msg + '\n        got      ' + JSON.stringify(got) + '\n        expected ' + JSON.stringify(expected));
}
function skip(msg) { skipped++; console.log('SKIP  ' + section + ': ' + msg); }
function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }
function words(s) { return (s.match(/[A-Za-z\u00C0-\u024F][A-Za-z\u00C0-\u024F'\u2019-]*/g) || []); }

var TICK = '`';

/* ------------------------------------------------------------------ hash */
section = 'hash';
eq(Kit.hash(''), 2166136261, 'the empty string hashes to the FNV offset basis');
eq(Kit.hash('a'), 0xe40c292c, 'fnv1a("a")');
eq(Kit.hash('foobar'), 0xbf9cf968, 'fnv1a("foobar")');
eq(Kit.hash(null), Kit.hash(''), 'null hashes like the empty string');
eq(Kit.hash(123), Kit.hash('123'), 'a number hashes like its text');
eq(Kit.hash('template'), Kit.hash('template'), 'the same text gives the same hash');
ok(Kit.hash('template') !== Kit.hash('Template'), 'different text gives a different hash');
(function () {
	var all = ['', 'a', 'template', '2026-10-03', '\u65e5\u672c\u8a9e', new Array(500).join('long ')].every(function (s) {
		var h = Kit.hash(s);
		return h === Math.floor(h) && h >= 0 && h <= 0xffffffff;
	});
	ok(all, 'every hash is an unsigned 32-bit integer');
})();
eq(Lib.hash('A-A1-02'), Kit.hash('A-A1-02'), 'library.js hashes like kit.js');

/* ------------------------------------------------------------------ rng */
section = 'rng';
(function () {
	var a = Kit.rng('seed'), b = Kit.rng('seed'), i;
	var xs = [], ys = [];
	for (i = 0; i < 50; i++) { xs.push(a()); ys.push(b()); }
	eq(xs, ys, 'the same string seed gives the same 50 numbers');
	ok(xs.every(function (x) { return x >= 0 && x < 1; }), 'every number is in [0, 1)');
	ok(Kit.rng('a')() !== Kit.rng('b')(), 'different seeds give different numbers');
	var r = Kit.rng(42);
	eq([r(), r(), r()], [0.6011037519201636, 0.44829055899754167, 0.8524657934904099], 'rng(42) starts with the known mulberry32 numbers');
	eq(Kit.rng('template')(), 0.019083645893260837, 'rng("template") starts with its known number');
	eq(Kit.rng()(), Kit.rng('')(), 'no seed is the empty seed (still deterministic)');

	var d = Kit.rng('dice'), ints = [];
	for (i = 0; i < 300; i++) ints.push(d.int(6));
	ok(ints.every(function (n) { return n === Math.floor(n) && n >= 0 && n < 6; }), 'int(6) stays in 0..5');
	eq([0, 1, 2, 3, 4, 5].filter(function (n) { return ints.indexOf(n) !== -1; }).length, 6, 'int(6) reaches all six values in 300 throws');
	eq(Kit.rng('x').int(0), 0, 'int(0) is 0');
	var list = ['a', 'b', 'c', 'd'];
	ok(list.indexOf(Kit.rng('p').pick(list)) !== -1, 'pick returns an item of the list');
	eq(Kit.rng('p').pick([]), undefined, 'pick from an empty list is undefined');
	var deck = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
	var s1 = Kit.rng('shuffle').shuffle(deck), s2 = Kit.rng('shuffle').shuffle(deck);
	eq(s1, s2, 'shuffle is deterministic for a seed');
	eq(deck, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 'shuffle leaves the list it was given alone');
	eq(s1.slice().sort(function (x, y) { return x - y; }), deck, 'shuffle returns a permutation');
	ok(JSON.stringify(s1) !== JSON.stringify(deck), 'shuffle changes the order');
})();

/* ------------------------------------------------------------------ agreement with the Paper Theatre engine */
section = 'vn';
(function () {
	var VN = null;
	try { VN = require('../55-paper-theatre/vn.js'); } catch (e) { VN = null; }
	if (!VN || typeof VN.hash !== 'function' || typeof VN.rng !== 'function') {
		skip('misc/55-paper-theatre/vn.js did not load under Node, so agreement was not checked');
		return;
	}
	var seeds = ['', 'a', 'template', '2026-10-03', 'latentland', '\u65e5\u672c\u8a9e', 'A long seed, with punctuation!'];
	seeds.forEach(function (s) {
		eq(Kit.hash(s), VN.hash(s), 'hash(' + JSON.stringify(s) + ') agrees with VN.hash');
	});
	seeds.concat([0, 1, 42, 2026, 4294967295, -1, 3.7]).forEach(function (s) {
		var a = Kit.rng(s), b = VN.rng(s), xs = [], ys = [];
		for (var i = 0; i < 20; i++) { xs.push(a()); ys.push(b()); }
		eq(xs, ys, 'rng(' + JSON.stringify(s) + ') agrees with VN.rng for 20 numbers');
	});
})();

/* ------------------------------------------------------------------ daily */
section = 'daily';
eq(Kit.daily({ date: new Date(2026, 9, 3, 12, 0, 0) }), '2026-10-03', 'a local date is YYYY-MM-DD');
eq(Kit.daily({ date: new Date(2026, 0, 5, 0, 0, 1) }), '2026-01-05', 'month and day are zero-padded');
eq(Kit.daily({ utc: true, date: new Date(Date.UTC(2026, 0, 5, 23, 59, 0)) }), '2026-01-05', 'utc: true reads the UTC day');
eq(Kit.daily({ utc: true, date: new Date(Date.UTC(2026, 11, 31, 0, 0, 0)) }), '2026-12-31', 'utc: true at the start of a UTC day');
ok(/^\d{4}-\d{2}-\d{2}$/.test(Kit.daily()), 'daily() with no argument is today, as YYYY-MM-DD');
ok(/^\d{4}-\d{2}-\d{2}$/.test(Kit.THUMB_DAY), 'the fixed thumbnail day is a date');

/* ------------------------------------------------------------------ root, id, storage key */
section = 'root';
[
	['https://nietztein.github.io/misc/_kit/kit.js', 'https://nietztein.github.io/'],
	['http://localhost:8765/misc/_kit/kit.js', 'http://localhost:8765/'],
	['http://127.0.0.1:8123/misc/_kit/kit.js?v=3', 'http://127.0.0.1:8123/'],
	['https://example.org/some/site/misc/_kit/kit.js#x', 'https://example.org/some/site/'],
	['file:///C:/Users/x/site/misc/_kit/kit.js', 'file:///C:/Users/x/site/'],
	['https://example.org/misc/misc/_kit/kit.js', 'https://example.org/misc/'],
	['https://example.org/a/b/kit.js', 'https://example.org/'],
	['', ''],
	['kit.js', '']
].forEach(function (pair) {
	eq(Kit.rootFromScript(pair[0]), pair[1], 'root of ' + JSON.stringify(pair[0]));
});
[
	['/misc/56-some-toy/index.html', '56-some-toy'],
	['/misc/56-some-toy/', '56-some-toy'],
	['/misc/_kit/template/', 'template'],
	['/misc/_kit/template/index.html', 'template'],
	['/misc/a%20b/', 'a-b'],
	['/', 'toy'],
	['', 'toy']
].forEach(function (pair) {
	eq(Kit.idFromPath(pair[0]), pair[1], 'folder id of ' + JSON.stringify(pair[0]));
});
eq(Kit.storageKey('template', 'count'), 'toy.template.count', 'storage keys are toy.<id>.<key>');

/* ------------------------------------------------------------------ front matter and markdown: fixtures */
section = 'markdown';
(function () {
	var fence = TICK + TICK + TICK;
	var md = [
		'---', 'title: A "quoted" title', 'date: 2026-01-02', 'tags: [one, "two", three]', 'empty:', '---', '',
		'# Heading One #', '',
		'A paragraph with **bold**, *em*, ***both***, ~~struck~~, _under_ and __strong__.',
		'A [link](https://example.org/a_(b)) and an ![image](pic.png) and <https://example.org>.',
		'Snake_case_name stays, 2 * 3 * 4 stays, a\\*b stays literal.', '',
		'<!-- hidden', '- still hidden -->', '- item one', '  - nested ' + TICK + 'code_span' + TICK + ' here', '1. first', '2) second', '- [x] done', '',
		'> quoted *text*', '> > deeper', '',
		'| a | b |', '|---|---|', '| 1 | 2 |', '',
		fence + 'js', 'var hidden = 1; // <!-- not a comment -->', fence, '',
		'Text after <b>bold tag</b> &amp; entity&nbsp;here.[^1] Keep ' + TICK + '<!-- this -->' + TICK + ' code.', '',
		'[^1]: A footnote.', '[ref]: https://example.org', 'Setext', '======', '', '***', 'end <!-- unclosed', 'gone'
	].join('\r\n');

	var fm = Kit.frontMatter(md);
	eq(fm.meta, { title: 'A "quoted" title', date: '2026-01-02', tags: ['one', 'two', 'three'], empty: '' }, 'front matter: keys, a list, an empty value');
	ok(fm.body.indexOf('title:') === -1 && /^\s*# Heading One/.test(fm.body), 'front matter: the body starts after the block');
	eq(Kit.frontMatter('no front matter\n---\nhere').meta, {}, 'front matter: a file without one has empty meta');
	eq(Kit.frontMatter('no front matter').body, 'no front matter', 'front matter: a file without one keeps its whole body');
	eq(Kit.frontMatter('\ufeff---\ntitle: BOM\n---\nbody').meta, { title: 'BOM' }, 'front matter: a byte-order mark is ignored');
	eq(Kit.frontMatter("---\ntitle: 'single'\n---\n").meta, { title: 'single' }, 'front matter: quotes around a value are dropped');

	eq(Kit.markdownToText(md), [
		'Heading One', '',
		'A paragraph with bold, em, both, struck, under and strong.',
		'A link and an and https://example.org.',
		'Snake_case_name stays, 2 * 3 * 4 stays, a*b stays literal.', '',
		'item one', 'nested code_span here', 'first', 'second', 'done', '',
		'quoted text', 'deeper', '',
		'a b', '1 2', '',
		'Text after bold tag & entity here. Keep <!-- this --> code.', '',
		'A footnote.', 'Setext', '',
		'end'
	].join('\n'), 'markdown to text: every construct of the fixture');
	eq(Kit.markdownToText(''), '', 'markdown to text: empty in, empty out');
	eq(Kit.markdownToText(null), '', 'markdown to text: null in, empty out');
	eq(Kit.markdownToText('**[Read *This: A Title* (PDF)](a/b.pdf)**'), 'Read This: A Title (PDF)', 'markdown to text: emphasis around and inside a link');
	eq(Kit.markdownToText('U(A(D), D_f) == A(D \\ D_f) and L_retain'), 'U(A(D), D_f) == A(D \\ D_f) and L_retain', 'markdown to text: underscores inside words and a lone backslash stay');
	eq(Kit.markdownToText('for $5? a < b > c'), 'for $5? a < b > c', 'markdown to text: a dollar sign and loose angle brackets stay');
	var C = String.fromCharCode;
	eq(Kit.markdownToText('a&mdash;b &ndash; c&hellip; &#8212; &#x2014; &copy; &lt;b&gt;'), 'a' + C(0x2014) + 'b ' + C(0x2013) + ' c' + C(0x2026) + ' ' + C(0x2014) + ' ' + C(0x2014) + ' &copy; <b>',
		'markdown to text: named and numbered entities are decoded, unknown ones are left');
	eq(Kit.markdownToText('a' + C(0xA0) + C(0xA0) + ' b\tc'), 'a b c', 'markdown to text: no-break spaces and tabs collapse into one space');
	eq(Kit.markdownToText('x' + C(0xE000) + 'y ' + C(96) + 'z*' + C(96) + ' \\_w\\_'), 'xy z* _w_', 'markdown to text: code and escaped marks survive; stray private-use characters go');

	eq(Kit.stripComments('a <!-- x --> b'), 'a  b', 'comments: one inside a line');
	eq(Kit.stripComments('top\n<!-- one\ntwo -->\nbottom'), 'top\nbottom', 'comments: one across lines goes with its lines');
	eq(Kit.stripComments('kept\nd <!-- open\nlost\nlost too'), 'kept\nd ', 'comments: an unclosed one runs to the end');
	eq(Kit.stripComments('c ' + TICK + '<!-- kept -->' + TICK), 'c ' + TICK + '<!-- kept -->' + TICK, 'comments: a code span is left alone');
	eq(Kit.stripComments(fence + '\n<!-- kept -->\n' + fence + '\n<!-- gone -->'), fence + '\n<!-- kept -->\n' + fence, 'comments: a fenced block is left alone');
	eq(Kit.stripComments('<!-- a --><!-- b -->x<!-- c -->'), 'x', 'comments: several in one line');
})();

/* ------------------------------------------------------------------ the published posts */
section = 'posts';
(function () {
	var index;
	try { index = JSON.parse(read('blog/index.json')); } catch (e) { ok(false, 'blog/index.json could not be read: ' + e.message); return; }
	ok(Array.isArray(index) && index.length > 0, 'blog/index.json lists ' + (index && index.length) + ' published posts');
	index.forEach(function (entry) {
		var name = entry.slug;
		if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\.md$/.test(String(entry.file))) { ok(false, name + ': unexpected file name ' + JSON.stringify(entry.file)); return; }
		var raw;
		try { raw = read('blog/posts/' + entry.file); } catch (e) { ok(false, name + ': ' + entry.file + ' could not be read'); return; }
		var fm = Kit.frontMatter(raw);
		var text = Kit.markdownToText(raw);
		var body = fm.body.replace(/\r\n?/g, '\n');

		eq({ title: fm.meta.title, date: fm.meta.date, summary: fm.meta.summary, tags: fm.meta.tags },
			{ title: entry.title, date: entry.date, summary: entry.summary, tags: entry.tags },
			name + ': front matter agrees with blog/index.json');
		ok(!/^---/.test(body) && body.indexOf('\nsummary:') === -1, name + ': the body has no front matter left');

		ok(text.length > 0 && text.indexOf('\r') === -1, name + ': the text is not empty and has no carriage returns');
		ok(text.indexOf('<!--') === -1 && text.indexOf('-->') === -1, name + ': no comment marks in the text');
		ok(!/^(title|date|summary|tags):/m.test(text) && !/^---$/m.test(text), name + ': no front matter in the text');
		ok(text.indexOf('](') === -1 && !/https?:\/\/\S+\)/.test(text), name + ': no link syntax in the text');
		ok(text.indexOf('**') === -1 && text.indexOf(TICK) === -1 && !/^\s*#{1,6}\s/m.test(text) && !/^\s*[-*+]\s/m.test(text) && !/^\s*\d+[.)]\s/m.test(text),
			name + ': no emphasis, code, heading or list marks in the text');
		ok(!/(^|[\s(])_[A-Za-z][^_\n]*_(?=[\s).,;:!?]|$)/m.test(text), name + ': no _underscore emphasis_ left in the text');
		ok(!/\n{3,}/.test(text) && !/[ \t]{2,}/.test(text) && text === text.trim(), name + ': tidy whitespace');

		// Nothing an HTML comment hides may reach the text.
		var comments = body.match(/<!--[\s\S]*?(?:-->|$)/g) || [];
		var visible = body.replace(/<!--[\s\S]*?(?:-->|$)/g, '\n');
		var leaked = [];
		comments.forEach(function (c) {
			c.replace(/^<!--|-->$/g, '').split('\n').forEach(function (line) {
				var w = words(line.replace(/\]\([^)]*\)/g, ' ')).slice(0, 4).join(' ');
				if (w.split(' ').length < 3) return;
				var inText = words(text).join(' ').indexOf(w) !== -1;
				var alsoVisible = words(visible).join(' ').indexOf(w) !== -1;
				if (inText && !alsoVisible) leaked.push(w);
			});
		});
		ok(leaked.length === 0, name + ': ' + comments.length + ' HTML comment(s), nothing from inside them in the text' + (leaked.length ? ' (leaked: ' + leaked.join(' | ') + ')' : ''));

		// Nothing is invented, and little is lost: the text's words come from the
		// visible body, and most of the visible body's words are in the text.
		var prose = visible.replace(/\]\((?:[^()\s]|\([^()]*\))*\)/g, '] ');
		var source = {}, got = words(text), want = words(prose), strange = [];
		want.forEach(function (w) { source[w] = true; });
		got.forEach(function (w) { if (!source[w] && strange.length < 5) strange.push(w); });
		ok(strange.length === 0, name + ': every word of the text is in the post' + (strange.length ? ' (not in it: ' + strange.join(', ') + ')' : ''));
		ok(got.length >= 0.97 * want.length, name + ': the text keeps the words of the post (' + got.length + ' of ' + want.length + ')');

		// Underscores inside words are not emphasis.
		var snake = (prose.match(/\b[A-Za-z]+_[A-Za-z]+\b/g) || []).filter(function (w) { return text.indexOf(w) === -1; });
		ok(snake.length === 0, name + ': words with an underscore inside keep it' + (snake.length ? ' (lost: ' + snake.join(', ') + ')' : ''));
	});
})();

/* ------------------------------------------------------------------ library.js on its own */
section = 'library';
(function () {
	eq(Lib.TABLES, ['UNITS', 'GENRE_HUE', 'LANG_HUE', 'LANG_NAME', 'AUTHOR_ALIAS', 'FREE_SOURCE'], 'library.js lists the six tables it carries');
	eq(Lib.authorKey('Dazai Osamu'), 'Osamu Dazai', 'authorKey follows an alias');
	eq(Lib.authorKey('Thomas Mann'), 'Thomas Mann', 'authorKey keeps a name with no alias');
	eq(Lib.authorKey(''), '', 'authorKey of nothing is the empty string');
	eq([Lib.langName('EN/JA'), Lib.langName('DE'), Lib.langName(''), Lib.langName('XX')], ['English / Japanese', 'German', 'Unknown language', 'XX'], 'langName');
	eq([Lib.langBucket('JA'), Lib.langBucket('EN'), Lib.langBucket('EN/IT'), Lib.langBucket('EN/JA'), Lib.langBucket('DE')],
		['Japanese', 'English', 'English', 'Bilingual & other', 'Bilingual & other'], 'langBucket');
	eq([Lib.eraLabel(null), Lib.eraLabel(-400), Lib.eraLabel(1799), Lib.eraLabel(1874), Lib.eraLabel(1900), Lib.eraLabel(1999), Lib.eraLabel(2024)],
		['Undated', 'Before 1800', 'Before 1800', '1800s', '1900s', '1990s', '2020s'], 'eraLabel');
	ok(Lib.eraRank('Before 1800') < Lib.eraRank('1800s') && Lib.eraRank('1800s') < Lib.eraRank('1990s') && Lib.eraRank('1990s') < Lib.eraRank('Undated'), 'eraRank sorts oldest first, undated last');
	eq([Lib.unitName('K'), Lib.unitName('Loose'), Lib.unitName('zz')], ['Pine library', 'Desk and floor', 'unit zz'], 'unitName');
	eq(Lib.shelfLabel('N3 (\u9234\u6728\u7531\u7f8e\u5b50)'), { label: 'N3', sub: '\u9234\u6728\u7531\u7f8e\u5b50' }, 'shelfLabel splits a note off');
	eq(Lib.hsl({ h: 10, s: 20, l: 30 }), 'hsl(10 20% 30%)', 'hsl of a colour');
	eq(Lib.hsl({ ch: 10, cs: 20, cl: 95 }, 12), 'hsl(10 20% 100%)', 'hsl of a record, with a clamped lightness shift');

	var data;
	try { data = JSON.parse(read('assets/data/library.json')); } catch (e) { ok(false, 'assets/data/library.json could not be read: ' + e.message); return; }
	var all = data.books.concat(data.objects || []);
	Lib.decorate(all);
	ok(all.every(function (b) { return b.ch >= 0 && b.ch < 360 && b.cs >= 0 && b.cs <= 100 && b.cl >= 0 && b.cl <= 100; }),
		'decorate gives all ' + all.length + ' records a colour (ch, cs, cl) in range');
	var again = Lib.spineColor(all[0], 'genre');
	eq([all[0].ch, all[0].cs, all[0].cl], [again.h, again.s, again.l], 'the colour fields are the genre spine colour');
	var rows = Lib.shelves();
	var lost = all.filter(function (b) { return !rows.some(function (r) { return r.unit === b.u && r.keys.indexOf(b.s) !== -1; }); });
	ok(lost.length === 0, 'every record sits on a shelf the tables know' + (lost.length ? ' (' + lost.length + ' do not, e.g. ' + lost[0].id + ')' : ''));
	var genres = all.filter(function (b) { return !(b.g in Lib.GENRE_HUE); });
	ok(genres.length === 0, 'every genre in the catalogue has a hue' + (genres.length ? ' (missing: ' + genres[0].g + ')' : ''));
})();

/* ------------------------------------------------------------------ the browser files compile */
section = 'syntax';
['misc/_kit/kit.js', 'misc/_kit/library.js', 'misc/_kit/template/app.js'].forEach(function (rel) {
	try { new vm.Script(read(rel), { filename: rel }); ok(true, rel + ' compiles'); }
	catch (e) { ok(false, rel + ' does not compile: ' + e.message); }
});

/* ------------------------------------------------------------------ the template's static contract */
section = 'template';
(function () {
	var dir = path.join(HERE, 'template');
	var page;
	try { page = fs.readFileSync(path.join(dir, 'index.html'), 'utf8'); } catch (e) { ok(false, 'template/index.html could not be read'); return; }
	var head = (/<head>([\s\S]*?)<\/head>/.exec(page) || ['', ''])[1];
	var m = /<link rel="stylesheet" href="([^"]*kit\.css)"><script src="([^"]*kit\.js)"><\/script>/.exec(head);
	ok(!!m, 'the head has the kit stylesheet immediately followed by the kit script');
	if (m) {
		eq(path.resolve(dir, m[1]), path.join(HERE, 'kit.css'), 'the stylesheet path leads to misc/_kit/kit.css');
		eq(path.resolve(dir, m[2]), path.join(HERE, 'kit.js'), 'the script path leads to misc/_kit/kit.js');
		ok(m[1].indexOf('../_kit/kit.css') !== -1 && m[2].indexOf('../_kit/kit.js') !== -1, 'both paths end in ../_kit/kit.css and ../_kit/kit.js');
	}
	ok(/<meta name="description" content="[^"]{20,}">/.test(head), 'the head has a description');
	ok(head.indexOf('<link rel="icon" href="data:,">') !== -1, 'the head has the empty icon');
	ok(/<template id="help-template">/.test(page), 'the page has a help <template>');
	ok(/<(canvas|svg)\b/.test(page), 'the page has a canvas or SVG stage');
	ok(/<script src="app\.js"><\/script>/.test(page), 'the page loads app.js');
	ok(!/<script[^>]+src="https?:/.test(page) && !/<link[^>]+href="https?:/.test(page), 'the page loads nothing from another host');
	var toy;
	try { toy = JSON.parse(fs.readFileSync(path.join(dir, 'toy.json'), 'utf8')); } catch (e) { ok(false, 'template/toy.json is not valid JSON: ' + e.message); return; }
	eq(toy, {
		n: 0, slug: 'template', title: 'Template', desc: 'A starting point for new toys.', group: 'art', tags: [], added: '2026-10-03',
		surfaces: [], status: 'wip', kit: true, data: ['library'], origins: [], thumb: { query: '?thumb=1', viewport: [800, 500], settleMs: 300 }
	}, 'toy.json is the agreed record');
})();

/* ------------------------------------------------------------------ library.js against bookshelf.js */
section = 'tables';
import(url.pathToFileURL(path.join(ROOT, 'scripts', 'check-tables.mjs')).href).then(function (check) {
	var result = check.checkKit();
	result.tables.forEach(function (t) { ok(t.ok, t.name + ': ' + t.note); });
	result.helpers.forEach(function (h) {
		if (h.skipped) skip(h.name + ': ' + h.note);
		else ok(h.ok, h.name + ': ' + h.note);
	});
	ok(result.ok, 'library.js is the same as assets/js/bookshelf.js');
}, function (err) {
	ok(false, 'scripts/check-tables.mjs could not be loaded: ' + err.message);
}).then(null, function (err) {
	ok(false, 'the table check threw: ' + (err && err.stack ? err.stack : err));
}).then(function () {
	console.log('\n' + passed + ' passed, ' + failed + ' failed' + (skipped ? ', ' + skipped + ' skipped' : ''));
	process.exitCode = failed ? 1 : 0;
});
