/*
 * node misc/56-theatre-studio/test-scaffold.js
 * Checks scaffold.js: every paper scaffold parses with VN.parse, carries the title and authors verbatim, holds no digit
 * of its own and has a body made only of comments; the post scaffold matches the builder's shape; the small helpers.
 */
'use strict';
var fs = require('fs');
var path = require('path');
var VN = require('../55-paper-theatre/vn.js');
var SC = require('./scaffold.js');

var ROOT = path.join(__dirname, '..', '..');
var BOM = String.fromCharCode(0xfeff);
var pass = 0, fail = 0;
function ok(cond, name, detail) {
	if (cond) { pass++; console.log('PASS ' + name); }
	else { fail++; console.log('FAIL ' + name + (detail ? '\n     ' + detail : '')); }
}

var pubs = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/data/publications.json'), 'utf8'));
ok(Array.isArray(pubs) && pubs.length > 0, 'publications.json has entries (' + pubs.length + ')');

var HEADER_RE = /^@(title|kind|source|authors|status|verify|cast)\b/;
var CHAPTER_RE = /^# chapter \d+: /;

pubs.forEach(function (pub) {
	var tag = '[' + pub.id.slice(0, 32) + ']';
	var text = SC.paperScaffold(pub, { date: new Date(2026, 9, 3) });
	var lines = text.split('\n');
	var program = null, err = null;
	try { program = VN.parse(text, { id: 'test:' + pub.id }); } catch (e) { err = e; }
	ok(program && !err, tag + ' parses with VN.parse', err && err.message);
	if (!program) return;
	var lint = VN.lint(program);
	var fatal = lint.filter(function (i) { return i.level === 'fatal'; });
	ok(!fatal.length, tag + ' has no fatal lint', JSON.stringify(fatal));
	ok(program.meta && program.meta.title === pub.title, tag + ' @title is the title verbatim', program.meta && program.meta.title);
	ok(lines.indexOf('@title ' + pub.title) >= 0, tag + ' the @title line is the title byte for byte');
	ok(lines.indexOf('@source paper:' + pub.title) >= 0, tag + ' @source paper:<title>');
	ok(lines.indexOf('@authors ' + pub.authorsText) >= 0, tag + ' @authors is authorsText verbatim');
	ok(lines.indexOf('@kind paper') >= 0 && lines.indexOf('@status draft') >= 0 && lines.indexOf('@verify') >= 0, tag + ' @kind paper, @status draft, @verify');
	ok(lines.indexOf(SC.JACK_CAST) >= 0, tag + " Jack's cast line");
	ok(program.meta && program.meta.kind === 'paper', tag + ' parsed kind is paper');

	// the only non-comment lines are the header directives
	var bad = lines.filter(function (l) { return l.trim() && l.charAt(0) !== '#' && !HEADER_RE.test(l); });
	ok(!bad.length, tag + ' body lines are only comments', JSON.stringify(bad));
	var ops = (program.ops || []).filter(function (o) { return o && o.kind !== 'end'; });
	ok(ops.length === 0, tag + ' the parsed program has no body ops', JSON.stringify(ops.slice(0, 3)));

	// digits: only those of the title (and the authors, which are copied), plus the fixed cast line and the chapter numbers
	var allowed = {};
	(pub.title + pub.authorsText).replace(/\d/g, function (d) { allowed[d] = 1; return d; });
	var stray = [];
	lines.forEach(function (l, i) {
		if (l === SC.JACK_CAST) return;
		var s = l.replace(CHAPTER_RE, '# chapter : ');
		if (/^@authors /.test(l)) s = '';
		s.replace(/\d/g, function (d) { if (!allowed[d]) stray.push((i + 1) + ': ' + l); return d; });
	});
	ok(!stray.length, tag + ' no digit that is not in the title', stray.join(' | '));

	// no prose: the comments are the fixed template lines, whatever the paper
	var chapters = lines.filter(function (l) { return CHAPTER_RE.test(l); });
	ok(chapters.length === SC.CHAPTERS.length, tag + ' ' + SC.CHAPTERS.length + ' chapter headers');
	ok(lines.filter(function (l) { return l === '# from: paste a sentence of the paper here, then write the line under it'; }).length === SC.CHAPTERS.length, tag + ' one "# from:" placeholder per chapter');
	ok(text.indexOf(String(pub.year)) < 0 || pub.title.indexOf(String(pub.year)) >= 0, tag + ' the year is not written in');
	ok(!pub.venue || text.indexOf(pub.venue) < 0, tag + ' the venue is not written in');
});

// the template is the same for every paper apart from title, source, authors and id
(function () {
	var a = SC.paperScaffold({ id: 'x', title: 'Alpha', authorsText: 'A. B' }).split('\n');
	var b = SC.paperScaffold({ id: 'x', title: 'Beta', authorsText: 'C. D' }).split('\n');
	var diff = a.filter(function (l, i) { return l !== b[i]; });
	ok(a.length === b.length && diff.length === 3, 'only the title, source and authors lines differ between two papers', JSON.stringify(diff));
	var t = null; try { SC.paperScaffold({ id: 'x' }); } catch (e) { t = e; }
	ok(!!t, 'a publication without a title is refused');
	var noAuth = SC.paperScaffold({ id: 'x', title: 'Gamma' });
	ok(!/^@authors/m.test(noAuth) && /# @authors: publications.json lists no authors/.test(noAuth), 'no authors: a comment, not an invented @authors');
})();

// post scaffold: same shape as build-vn-index.mjs --scaffold-post
(function () {
	var md = [
		'"Man only plays when he is a man."',
		'Friedrich Schiller',
		'',
		'When I think about *research*, I keep returning to [play](https://example.org).',
		'',
		'## A heading',
		'',
		'- one',
		'- two',
		'',
		'> a quoted line',
		'',
		'```js',
		'var x = 1;',
		'```',
		'',
		'Last {braces} paragraph.'
	].join('\n');
	var r = SC.postScaffold({ slug: 'play', title: 'Play', date: '2026-08-27', file: '2026-08-27-play.md', summary: 'A summary.' }, md, { date: new Date(2026, 9, 3) });
	var t = r.text, L = t.split('\n');
	ok(L[0] === '@title Play' && L[1] === '@kind blog' && L[2] === '@source blog:play' && L[3] === '@link ../../#/post/play Read the post' && L[4] === '@status draft', 'post header lines');
	ok(L.indexOf(SC.JACK_CAST) >= 0 && L.indexOf('@cast You player hue=120') >= 0, 'post casts');
	ok(L.indexOf('@cast Schiller page name="Friedrich Schiller"') >= 0, 'epigraph becomes a page speaker');
	ok(L.indexOf('When I think about *research*, I keep returning to play. ^¶2') >= 0, 'paragraph 2 with its chip and inline markup');
	ok(L.indexOf('@scene A heading') >= 0, 'heading becomes @scene');
	ok(L.indexOf('one. ^¶4') >= 0 && L.indexOf('two. ^¶4') >= 0, 'list items share the list paragraph');
	ok(L.indexOf('Page: a quoted line ^¶5') >= 0 && L.indexOf('@cast Page page') >= 0, 'blockquote voiced by Page');
	ok(L.indexOf('Last (braces) paragraph. ^¶6') >= 0, 'a code fence is dropped from the count (as @read does), braces escaped');
	ok(L.indexOf('# from: When I think about *research*, I keep returning to [play](https://example.org).') >= 0, '"# from:" keeps the original Markdown');
	ok(L.indexOf('# summary: A summary.') >= 0, 'summary comment');
	ok(L[L.length - 2] === '@end', 'ends with @end');
	var p = VN.parse(t, { id: 'test:post' });
	var fatal = VN.lint(p).filter(function (i) { return i.level === 'fatal'; });
	ok(!fatal.length, 'post scaffold has no fatal lint', JSON.stringify(fatal));
	var w = VN.walk(p);
	ok(w && w.ok !== false, 'post scaffold walks', JSON.stringify(w && w.issues));
})();

// a real published post, if blog/index.json lists one, gives the same chip numbers as VN.blog
(function () {
	var idxFile = path.join(ROOT, 'blog/index.json');
	if (!fs.existsSync(idxFile) || typeof VN.blog !== 'function') { ok(true, 'real post check skipped (no blog index or VN.blog)'); return; }
	var idx = JSON.parse(fs.readFileSync(idxFile, 'utf8'));
	var entry = (Array.isArray(idx) ? idx : idx.posts || []).filter(function (e) { return e && e.slug && e.file; })[0];
	if (!entry) { ok(true, 'real post check skipped (no entry)'); return; }
	var raw = fs.readFileSync(path.join(ROOT, 'blog/posts', entry.file), 'utf8');
	if (raw.charAt(0) === BOM) raw = raw.slice(1);
	var body = raw.replace(/^---\s*\r?\n[\s\S]*?\r?\n---\s*\r?\n?/, '');
	var r = SC.postScaffold(entry, body);
	var p = VN.parse(r.text, { id: 'test:real' });
	var fatal = VN.lint(p).filter(function (i) { return i.level === 'fatal'; });
	ok(!fatal.length && r.paragraphs > 0, 'scaffold of the post "' + entry.slug + '" parses (' + r.paragraphs + ' blocks)', JSON.stringify(fatal));
})();

// helpers
ok(SC.hash('abc') === SC.hash('abc') && SC.hash('abc') !== SC.hash('abd') && /^[0-9a-f]{8}$/.test(SC.hash('')), 'hash is stable, 8 hex digits, tells texts apart');
ok(SC.byteLength('a') === 1 && SC.byteLength('é') === 2 && SC.byteLength('§') === 2 && SC.byteLength('紙') === 3 && SC.byteLength('😀') === 4, 'byteLength counts UTF-8');
ok(SC.formatBytes(512) === '512 B' && SC.formatBytes(2048) === '2.0 kB' && SC.formatBytes(22669) === '23 kB', 'formatBytes');
var now = new Date(2026, 9, 3, 12, 0, 0).getTime();
ok(SC.relTime(now - 10e3, now) === 'just now' && SC.relTime(now - 5 * 60e3, now) === '5 min ago' && SC.relTime(now - 3 * 3600e3, now) === '3 h ago', 'relTime minutes and hours');
ok(SC.relTime(new Date(2026, 9, 2, 9).getTime(), now) === 'yesterday' && SC.relTime(new Date(2026, 8, 1).getTime(), now) === '2026-09-01' && SC.relTime(0, now) === '', 'relTime days');
ok(SC.fileName('obfuscation') === 'obfuscation.vn' && SC.fileName('a/b:c?.vn') === 'a-b-c-.vn' && SC.fileName('') === 'draft.vn' && SC.fileName('..x') === 'x.vn', 'fileName');
ok(JSON.stringify(SC.vnFiles(['b.vn', 'a.txt', '_x.vn', 'a.vn', 'index.json'])) === '["a.vn","b.vn","_x.vn"]', 'vnFiles');
ok(SC.diskState(null, 'x') === 'none' && SC.diskState({ hash: SC.hash('x') }, 'x') === 'saved' && SC.diskState({ hash: SC.hash('x') }, 'y') === 'changed', 'diskState');
ok(SC.paperDraftName({ title: 'Do Machines Struggle Where Humans Do? Obfuscation as a Probe' }) === 'Do Machines Struggle Where Humans Do', 'paperDraftName');
ok(SC.paperDraftName({ title: 'Composing Obfuscation Specialists by Merging' }) === 'Composing Obfuscation Specialists by Merging', 'paperDraftName keeps a 44-character title whole');
ok(SC.paperDraftName({ title: new Array(30).join('word ') }).length <= 80, 'paperDraftName stops at 80 characters');

// the source holds no literal control character or BOM (the Write tool sometimes turns escapes into characters)
var src = fs.readFileSync(path.join(__dirname, 'scaffold.js'), 'utf8');
ok(!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(src) && src.indexOf(BOM) < 0,'scaffold.js has no literal control characters or BOM');

console.log((fail ? 'FAIL' : 'PASS') + ': ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
