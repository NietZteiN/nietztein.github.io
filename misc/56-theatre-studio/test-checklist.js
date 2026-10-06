/*
 * node misc/56-theatre-studio/test-checklist.js
 * The publish checklist (panels/checklist.js) over every story in ../55-paper-theatre/stories, plus the facts table,
 * the board's join and one small script per rule. Prints PASS/FAIL lines; exit code 1 on any failure.
 */
'use strict';
var fs = require('fs');
var path = require('path');
var VN = require('../55-paper-theatre/vn.js');
var C = require('./panels/checklist.js');

var ROOT = path.join(__dirname, '..', '..');
var STORIES = path.join(__dirname, '..', '55-paper-theatre', 'stories');
var pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; } else { fail++; console.log('FAIL ' + msg); } }
function eq(a, b, msg) { var A = JSON.stringify(a), B = JSON.stringify(b); ok(A === B, msg + (A === B ? '' : '\n     got      ' + A + '\n     expected ' + B)); }

var pubs = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets', 'data', 'publications.json'), 'utf8'));
var index = JSON.parse(fs.readFileSync(path.join(STORIES, 'index.json'), 'utf8'));
var posts = JSON.parse(fs.readFileSync(path.join(ROOT, 'blog', 'index.json'), 'utf8'));

// the lint worker's job, in Node: includes from stories/, parse, lint, walk when there is no fatal
function includesFor(text) {
	var out = {};
	String(text).replace(/^\s*@include\s+(\S+)/gm, function (m, p) {
		var f = path.join(STORIES, p);
		if (fs.existsSync(f)) out[p] = fs.readFileSync(f, 'utf8');
		return m;
	});
	return out;
}
function lintText(text, id) {
	var program = VN.parse(text, { id: id || 'studio', includes: includesFor(text) });
	var issues = VN.lint(program);
	var walk = null;
	if (!issues.some(function (i) { return i.level === 'fatal'; })) {
		walk = VN.walk(program);
		var seen = {};
		issues.forEach(function (i) { seen[i.code + ':' + i.line + ':' + i.msg] = 1; });
		walk.issues.forEach(function (i) { if (!seen[i.code + ':' + i.line + ':' + i.msg]) issues.push(i); });
		issues.sort(function (a, b) { return a.line - b.line; });
	}
	return { program: JSON.parse(JSON.stringify(program)), issues: issues, walk: walk };
}
function run(text, id, extra) {
	var r = lintText(text, id);
	var opts = { text: text, walk: r.walk, publications: pubs };
	if (extra) Object.keys(extra).forEach(function (k) { opts[k] = extra[k]; });
	return C.check(r.program, r.issues, opts);
}
function itemOf(res, id) { return res.items.filter(function (i) { return i.id === id; })[0] || null; }
function failing(res) { return res.items.filter(function (i) { return i.state === 'fail'; }).map(function (i) { return i.id; }); }

/* ---- every story in the folder ---- */

var files = fs.readdirSync(STORIES).filter(function (f) { return /\.vn$/.test(f) && f[0] !== '_'; }).sort();
ok(files.length >= 16, 'at least 16 stories found (' + files.length + ')');
var byStatus = { published: 0, embargo: 0, draft: 0 };
files.forEach(function (f) {
	var id = f.replace(/\.vn$/, '');
	var text = fs.readFileSync(path.join(STORIES, f), 'utf8');
	var res = run(text, id);
	var again = run(text, id);
	eq(again, res, f + ': the checklist is stable (same result twice)');
	ok(res.items.every(function (i) { return /^(pass|fail|skip)$/.test(i.state) && typeof i.line === 'number' && i.label && i.rule; }), f + ': every item has a state, a line, a label and a rule');
	byStatus[res.status] = (byStatus[res.status] || 0) + 1;
	var kind = res.items.filter(function (i) { return i.id === 'cite'; }).length ? 'paper' : 'blog';
	var bad = failing(res);
	if (res.status === 'published') {
		var allowed = bad.filter(function (x) { return !(x === 'verify' && kind === 'paper'); });
		eq(allowed, [], f + ' (published ' + kind + '): no failing mechanical item except @verify on a paper');
		var v = itemOf(res, 'verify');
		if (kind === 'paper' && v.state === 'fail') ok(v.line > 0 && /^@verify/.test(text.split(/\r?\n/)[v.line - 1]), f + ': the @verify item names the @verify line (' + v.line + ')');
		ok(itemOf(res, 'status').state === 'pass', f + ': status passes');
		if (kind === 'paper') ok(itemOf(res, 'pub-link') && itemOf(res, 'pub-link').state === 'pass', f + ': index.html links it');
		console.log('  ok    ' + f + ' published ' + kind + ': ' + res.counts.pass + ' pass, ' + res.counts.fail + ' fail (' + (bad.join(', ') || 'none') + '), ' + res.counts.skip + ' skip');
	} else if (res.status === 'embargo') {
		var st = itemOf(res, 'status');
		ok(st.state === 'fail', f + ' (embargo): fails on status');
		ok(st.line > 0 && /^@status embargo/.test(text.split(/\r?\n/)[st.line - 1]), f + ': the status item names the @status line');
		ok(itemOf(res, 'withheld').state === 'pass', f + ': the embargo stops at @withheld');
		console.log('  ok    ' + f + ' embargo: fails ' + bad.join(', '));
	}
});
ok(byStatus.published >= 10, 'ten or more published stories (' + byStatus.published + ')');
ok(byStatus.embargo >= 6, 'six or more embargoed stories (' + byStatus.embargo + ')');

/* ---- one small script per rule ---- */

var BASE = '@title T\n@kind paper\n@source paper:Composing Obfuscation Specialists by Merging\n@cite J. V. Le, Tien Nguyen (2026). Composing Obfuscation Specialists by Merging. Submitted to ACM International Conference on the Foundations of Software Engineering (FSE).\n@authors Jack V. Le, Tien Nguyen\n@status published\n@fact acc = 40.5% ^§4\n@cast Jack\n';
var good = run(BASE + 'Jack: It was {acc}.\n@end\n', 'probe');
eq(failing(good), ['pub-link'], 'a clean published paper fails only on the missing index.html link (merging has no story)');
ok(itemOf(good, 'pub-link').detail.indexOf('no a.pub-play') >= 0, 'pub-link says why');

var r = run(BASE + 'Jack: It was 40.5% overall.\n@end\n', 'probe');
ok(itemOf(r, 'numeric').state === 'fail' && itemOf(r, 'numeric').line === 9, 'an unchipped figure fails rule 2 with its line (9)');
ok(itemOf(r, 'blockers').state === 'fail', 'and is a publish blocker');
eq(C.unchipped(lintText(BASE + 'Jack: It was 40.5% overall.\n@end\n').issues).map(function (i) { return i.line; }), [9], 'unchipped() lists that line');

r = run(BASE.replace('@status published', '@status published\n@verify') + 'Jack: {acc}.\n@end\n', 'probe');
ok(itemOf(r, 'verify').state === 'fail' && itemOf(r, 'verify').line === 7, '@verify fails with its line (7)');

r = run(BASE.replace(/@cite .*\n/, '') + 'Jack: {acc}.\n@end\n', 'probe');
ok(itemOf(r, 'cite').state === 'fail', 'missing @cite fails');
ok(itemOf(r, 'blockers').state === 'fail', 'missing @cite is a blocker for a published paper');

r = run(BASE.replace('Submitted to ACM', 'Accepted at ACM') + 'Jack: {acc}.\n@end\n', 'probe');
ok(itemOf(r, 'venue').state === 'fail' && itemOf(r, 'venue').line === 4, 'an upgraded venue fails with the @cite line');

r = run(BASE.replace('Composing Obfuscation Specialists by Merging\n@cite', 'No Such Paper Anywhere\n@cite') + 'Jack: {acc}.\n@end\n', 'probe');
ok(itemOf(r, 'source-match').state === 'fail' && itemOf(r, 'source-match').line === 3, '@source with no publication fails with its line');

r = run(BASE + '@cast Tien\nTien: We did it.\n@end\n', 'probe');
ok(itemOf(r, 'coauthor-cast').state === 'fail' && itemOf(r, 'coauthor-cast').line === 9, 'a cast member named after a coauthor fails rule 4 (line 9)');
r = run(BASE + '@cast Tien coauthor\nJack: {acc}.\nTien: We did it.\n@end\n', 'probe');
ok(itemOf(r, 'coauthor-cast').state === 'pass', 'declared coauthor passes the cast rule');
ok(itemOf(r, 'coauthor-lines').state === 'fail' && itemOf(r, 'coauthor-lines').line === 11, 'an unchipped coauthor line fails (line 11)');
r = run(BASE + '@cast Tien coauthor\nJack: {acc}.\nTien: We did it. ^para\n@end\n', 'probe');
ok(itemOf(r, 'coauthor-lines').state === 'pass', 'a ^para coauthor line passes');

r = run(BASE + '@fact bare = 12\nJack: {acc} and {bare}.\n@end\n', 'probe');
ok(itemOf(r, 'chip-refs').state === 'fail', 'a fact without a ref fails the chip-ref rule');

r = run(BASE + '* A -> a\n* B -> b\n== a\nJack: {acc}.\n-> done\n== b\nJack: no.\n-> done\n== done\n@end\n', 'probe');
ok(itemOf(r, 'branch').state === 'fail' && itemOf(r, 'branch').line === 12, 'a chip in a branch fails rule 3 (line 12)');

r = run(BASE + '@note Some note.\nJack: {acc}.\n@end\n', 'probe');
ok(itemOf(r, 'note').state === 'fail' && itemOf(r, 'note').line === 9, 'a @note that does not say the dialogue is dramatized fails rule 8');
r = run(BASE + '@note The frame is fiction.\nJack: {acc}.\n@end\n', 'probe');
ok(itemOf(r, 'note').state === 'fail', 'a two-author paper whose @note does not mention the coauthors fails rule 8');

r = run(BASE.replace('@status published', '@status embargo') + 'Jack: {acc}.\n@end\n', 'probe');
ok(itemOf(r, 'status').state === 'fail' && itemOf(r, 'withheld').state === 'fail', 'embargo without @withheld fails status and withheld');

r = run('@title T\n@kind blog\n@cast Jack\nJack: hi\n@end\n', 'probe');
ok(itemOf(r, 'source').state === 'fail' && itemOf(r, 'status').state === 'fail' && itemOf(r, 'status').line === 0, 'a blog with no @source and default draft status fails both; status has no line');
ok(!itemOf(r, 'cite') && !itemOf(r, 'source-match'), 'a blog has no paper-only items');

r = run('@title T\n@cast Jack\nJack: hi\n-> nowhere\n', 'probe');
ok(itemOf(r, 'fatal').state === 'fail' && itemOf(r, 'kind').state === 'fail', 'a fatal script fails "no fatal" and "kind"');
ok(!itemOf(r, 'walk'), 'no walk item while there is a fatal');

r = C.check(null, []);
ok(r.items.length === 1 && r.items[0].state === 'fail', 'no program yet gives one failing item');

ok(C.manual({ kind: 'paper' }).length === 7 && C.manual({ kind: 'blog' }).length === 5, 'manual reminders: 7 for a paper, 5 for a blog');
ok(C.check(lintText(BASE + 'Jack: {acc}.\n').program, []).items.every(function (i) { return i.id !== 'source-match' || i.state === 'skip'; }), 'source-match is skipped without the publication list');

/* ---- the facts table ---- */

var ob = lintText(fs.readFileSync(path.join(STORIES, 'obfuscation.vn'), 'utf8'), 'obfuscation');
var fu = C.factUsage(ob.program);
eq(fu.length, Object.keys(ob.program.facts).length, 'factUsage has one row per fact (' + fu.length + ')');
ok(fu.every(function (f) { return f.file === '_facts/obfuscation.vn' && f.line > 0 && f.ref; }), 'obfuscation facts come from the include, with lines and refs');
var used = fu.filter(function (f) { return f.uses.length; });
ok(used.length > 0, 'some facts are used (' + used.length + ' of ' + fu.length + ')');
var u0 = used[0];
ok(u0.uses.every(function (u) {
	var op = ob.program.ops[u.index];
	var chips = (op.chips || []).concat((op.cells || []).reduce(function (a, c) { return a.concat(c.chips || []); }, []), (op.series || []).reduce(function (a, s) { return a.concat(s.chips || []); }, []));
	return op.line === u.line && chips.some(function (c) { return c.key === u0.key; });
}), 'each use of ' + u0.key + ' is an op whose chips carry it');
var small = lintText('@title T\n@kind paper\n@fact a = 1 ^§1\n@fact b = 2 ^§2\n@cast Jack\nJack: {a} then {a}.\n@chart bar X | one={a} | two={b}\n@end\n');
var su = C.factUsage(small.program);
eq(su.map(function (f) { return f.key + ':' + f.uses.map(function (u) { return u.line; }).join(','); }), ['a:6,7', 'b:7'], 'factUsage counts a line once and reads chart series');
eq(C.directiveLines('﻿@title X\n@cast A\n@cast B\nA: hi').cast, [2, 3], 'directiveLines finds repeated directives (and skips a BOM)');
eq(Object.keys(C.coauthorWords('Jack V. Le† and Anh Nguyen† (co-first), Tien Nguyen')).sort(), ['anh', 'nguyen', 'tien'], 'coauthorWords leaves the owner out');

/* ---- the board ---- */

var b = C.boardRows(pubs, posts, index);
eq(b.pubs.length, 10, 'ten publication rows');
var pubStatus = b.pubs.map(function (r) { return r.status || 'none'; });
eq(pubStatus.filter(function (s) { return s === 'published'; }).length, 4, 'four publications have published stories');
eq(pubStatus.filter(function (s) { return s === 'embargo'; }).length, 5, 'five publications have embargoed stories');
eq(pubStatus.filter(function (s) { return s === 'none'; }).length, 1, 'one publication has no story yet');
ok(b.pubs.every(function (r, i) { return r.title === pubs[i].title && r.venue === pubs[i].venue; }), 'titles and venues are copied verbatim');
ok(b.pubs.filter(function (r) { return r.status === 'published'; }).every(function (r) { return r.linked === r.story; }), 'every published row is the one index.html links');
eq(b.posts.length, posts.length, 'one row per published post (' + posts.length + ')');
eq(b.posts.filter(function (r) { return r.story; }).length, index.filter(function (s) { return s.kind === 'blog' && posts.some(function (p) { return p.slug === s.slug; }); }).length, 'posts joined to their blog stories by slug');
eq(b.orphans.map(function (r) { return r.story; }), index.filter(function (s) { return !b.pubs.concat(b.posts).some(function (r) { return r.story === s.id; }); }).map(function (s) { return s.id; }), 'every story without a row is listed as an orphan');
ok(b.orphans.some(function (r) { return r.story === 'eto-map-of-science'; }), 'the ETO post story (press list, not a publication) is an orphan');
eq(C.boardRows(pubs, posts, index), b, 'the join is stable');
eq(C.boardRows(null, null, null), { pubs: [], posts: [], orphans: [] }, 'empty inputs give empty rows');

console.log((fail ? 'FAIL' : 'PASS') + ': ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
