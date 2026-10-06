// node misc/56-theatre-studio/test.js : the Studio's pure helpers, the lint worker's job done in Node, and the files.
'use strict';
var fs = require('fs');
var path = require('path');
var H = require('./studio.js');
var VN = require('../55-paper-theatre/vn.js');

var pass = 0, fail = 0;
function ok(cond, name) { if (cond) { pass++; console.log('PASS ' + name); } else { fail++; console.log('FAIL ' + name); } }
function eq(a, b, name) { var A = JSON.stringify(a), B = JSON.stringify(b); ok(A === B, name + (A === B ? '' : '  got ' + A + ' want ' + B)); }

// ---- lines and offsets
var t = 'one\ntwo\n\nfour';
eq(H.lineCount(''), 1, 'lineCount empty');
eq(H.lineCount(t), 4, 'lineCount');
eq(H.lineCount('a\n'), 2, 'lineCount trailing newline');
eq(H.lineOfOffset(t, 0), 1, 'lineOfOffset start');
eq(H.lineOfOffset(t, 3), 1, 'lineOfOffset end of line 1');
eq(H.lineOfOffset(t, 4), 2, 'lineOfOffset start of line 2');
eq(H.lineOfOffset(t, 9), 4, 'lineOfOffset line 4');
eq(H.lineOfOffset(t, 999), 4, 'lineOfOffset clamped');
eq(H.lineStart(t, 1), 0, 'lineStart 1');
eq(H.lineStart(t, 3), 8, 'lineStart empty line');
eq(H.lineStart(t, 4), 9, 'lineStart 4');
eq(H.lineStart(t, 99), t.length, 'lineStart past end');
eq(H.lineEnd(t, 2), 7, 'lineEnd 2');
eq(H.lineEnd(t, 4), t.length, 'lineEnd last');
eq(H.getLine(t, 2), 'two', 'getLine');
eq(H.getLine(t, 3), '', 'getLine empty');
eq(H.getLine(t, 9), '', 'getLine past end');
for (var off = 0; off <= t.length; off++) {
	var l = H.lineOfOffset(t, off);
	if (!(H.lineStart(t, l) <= off && off <= H.lineEnd(t, l))) { ok(false, 'offset ' + off + ' inside its line'); break; }
	if (off === t.length) ok(true, 'every offset lies inside the line lineOfOffset gives');
}
eq(H.normalize('a\r\nb\rc'), 'a\nb\nc', 'normalize newlines');

// ---- edits
eq(H.replaceLine(t, 2, 'TWO').text, 'one\nTWO\n\nfour', 'replaceLine middle');
eq(H.replaceLine(t, 1, '').text, '\ntwo\n\nfour', 'replaceLine to empty');
eq(H.replaceLine(t, 4, 'x\ny').text, 'one\ntwo\n\nx\ny', 'replaceLine last with two lines');
eq(H.replaceLine('a', 3, 'c').text, 'a\n\nc', 'replaceLine past the end appends');
var r = H.replaceLine(t, 2, 'TWO');
eq([r.start, r.end], [4, 7], 'replaceLine range');
eq(H.insertAt('abc', 1, 1, 'X'), { text: 'aXbc', caret: 2 }, 'insertAt caret');
eq(H.insertAt('abc', 1, 3, 'X'), { text: 'aX', caret: 2 }, 'insertAt replaces a selection');
eq(H.insertAt('abc', 9, null, '!'), { text: 'abc!', caret: 4 }, 'insertAt clamps');
eq(H.findLine(t, 'four'), 4, 'findLine string');
eq(H.findLine(t, /^tw/), 2, 'findLine regexp');
eq(H.findLine(t, 'zzz'), 0, 'findLine none');

// ---- keys and drafts
eq(H.slugKey('Do Machines Struggle?'), 'do-machines-struggle', 'slugKey');
eq(H.slugKey('  '), 'draft', 'slugKey empty');
eq(H.slugKey('Ünïcode__x'), 'n-code-x', 'slugKey drops what is not a-z0-9');
ok(H.slugKey(new Array(60).join('ab')).length <= 40, 'slugKey at most 40 characters');
ok(/^[a-z0-9-]+$/.test(H.slugKey('a/b\\c:d?e#f%g')), 'slugKey is safe in a URL and a storage key');
eq(H.uniqueKey('obfuscation', []), 'obfuscation', 'uniqueKey free');
eq(H.uniqueKey('obfuscation', ['obfuscation', 'obfuscation-2']), 'obfuscation-3', 'uniqueKey numbered');
eq(H.reconcileDrafts([{ key: 'a', name: 'A' }, { key: 'gone', name: 'G' }, { key: 'a', name: 'dup' }], ['a', 'orphan', 'thumb']),
	[{ key: 'a', name: 'A', from: null, updated: 0 }, { key: 'orphan', name: 'orphan', from: null, updated: 0 }],
	'reconcileDrafts drops missing, keeps one per key, adopts orphans, skips the thumbnail draft');
eq(H.reconcileDrafts(null, []), [], 'reconcileDrafts with nothing stored');

// ---- issues
var iss = [{ level: 'warn', line: 9 }, { level: 'fatal', line: 3 }, { level: 'warn', line: 0 }];
eq(H.countIssues(iss), { fatal: 1, warn: 2, total: 3 }, 'countIssues');
eq(H.issueSummary([]), 'No issues', 'issueSummary none');
eq(H.issueSummary(iss), '1 fatal · 2 warnings', 'issueSummary both');
eq(H.issueSummary([{ level: 'warn', line: 1 }]), '1 warning', 'issueSummary singular');
eq(H.nextIssue(iss, 1).line, 3, 'nextIssue after line 1');
eq(H.nextIssue(iss, 3).line, 9, 'nextIssue after line 3');
eq(H.nextIssue(iss, 9).line, 3, 'nextIssue wraps');
eq(H.nextIssue([], 1), null, 'nextIssue none');
eq(H.nextIssue([{ level: 'fatal', line: 0, msg: 'x' }], 1).msg, 'x', 'nextIssue file-level only');

// ---- panels, layout, URLs
eq(H.sortPanels([{ id: 'b', order: 20 }, { id: 'a' }, { id: 'c', order: 20 }, { id: 'd', order: 5 }]).map(function (p) { return p.id; }), ['d', 'b', 'c', 'a'], 'sortPanels by order, then registration');
eq(H.clamp(90, 25, 75), 75, 'clamp high'); eq(H.clamp('x', 25, 75), 25, 'clamp junk');
eq(H.frameSrc('obfuscation'), '../55-paper-theatre/?src=draft:obfuscation&studio=1&drafts=1', 'frameSrc');
ok(/&theme=dark&audio=0&paint=0&live=0&camera=0&op=0$/.test(H.frameSrc('k', { theme: 'dark', still: true })), 'frameSrc still (thumbnail) rests every module');

// ---- examples: the published stories, and nothing else
var manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../55-paper-theatre/stories/index.json'), 'utf8'));
var ex = H.examples(manifest);
ok(ex.length > 0 && ex.length === manifest.filter(function (m) { return m.status === 'published'; }).length, 'examples lists every published story (' + ex.length + ')');
ok(ex.every(function (e) { return manifest.filter(function (m) { return m.id === e.id; })[0].status === 'published'; }), 'examples has no draft or embargoed story');
ok(ex.some(function (e) { return e.id === 'obfuscation'; }), 'the default example (obfuscation) is published');
ok(ex.every(function (e) { return fs.existsSync(path.join(__dirname, '../55-paper-theatre/stories', e.file)); }), 'every example file exists');
eq(H.examples([{ id: 'x', file: '../../etc.vn', status: 'published' }, { id: 'y', file: 'y.vn', status: 'embargo' }]), [], 'examples rejects paths and unpublished entries');

// ---- the worker's job in Node: the default example parses, lints and walks clean
var src = fs.readFileSync(path.join(__dirname, '../55-paper-theatre/stories/obfuscation.vn'), 'utf8');
var incName = '_facts/obfuscation.vn';
var includes = {}; includes[incName] = fs.readFileSync(path.join(__dirname, '../55-paper-theatre/stories', incName), 'utf8');
var prog = VN.parse(src, { id: 'src:draft:obfuscation', includes: includes });
var lint = VN.lint(prog);
eq(lint.filter(function (i) { return i.level === 'fatal'; }).length, 0, 'example has no fatal issue');
var walk = VN.walk(prog);
ok(walk.ok && walk.paths > 0, 'example walks to its endings (' + walk.paths + ' paths)');
ok(JSON.stringify(JSON.parse(JSON.stringify(prog))) === JSON.stringify(prog), 'a program survives JSON (what the worker posts)');
ok(H.findLine(src, 'And then there is Python.') > 0, 'the thumbnail line exists in the example');
var bad = VN.lint(VN.parse(src + '\n-> nowhere_at_all\n', { includes: includes }));
ok(bad.some(function (i) { return i.code === 'unknown-jump' && i.level === 'fatal'; }), 'a jump to an unknown label is a fatal unknown-jump');

// ---- files
var dir = __dirname;
var toy = JSON.parse(fs.readFileSync(path.join(dir, 'toy.json'), 'utf8'));
eq([toy.n, toy.slug, toy.title, toy.group, toy.added, toy.kit], [56, '56-theatre-studio', 'Theatre Studio', 'stories', '2026-10-05', true], 'toy.json fields');
eq(toy.surfaces, ['grid'], 'toy.json surfaces');
ok(toy.desc.length >= 60 && toy.desc.length <= 185, 'toy.json desc length ' + toy.desc.length);
var tv = toy.thumb.viewport; ok(tv[0] * 10 === tv[1] * 16, 'thumb viewport is 16:10');
var html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
var scripts = []; html.replace(/<script src="([^"]+)"/g, function (m, s) { scripts.push(s); return m; });
ok(scripts.every(function (s) { return fs.existsSync(path.join(dir, s)); }), 'every script tag points at a file (' + scripts.length + ')');
var order = ['../55-paper-theatre/vn.js', '../55-paper-theatre/art-scenes.js', '../55-paper-theatre/art-cast.js', '../55-paper-theatre/art.js', 'studio.js'];
eq(scripts.slice(1, 6), order, 'engine and art load in order, before studio.js');
['vn-highlight.js', 'editor.js', 'files.js', 'panels/issues.js', 'panels/map.js', 'panels/cast.js', 'panels/scenery.js', 'panels/facts.js', 'panels/board.js'].forEach(function (f) {
	ok(scripts.indexOf(f) > scripts.indexOf('studio.js'), f + ' loads after studio.js');
});
ok(/importScripts\('\.\.\/55-paper-theatre\/vn\.js'\)/.test(fs.readFileSync(path.join(dir, 'lint-worker.js'), 'utf8')), 'the worker imports the engine');
var js = fs.readFileSync(path.join(dir, 'studio.js'), 'utf8');
ok(!/console\.error/.test(js), 'studio.js never calls console.error');
ok(!/new AudioContext/.test(js), 'studio.js builds no AudioContext');

console.log((fail ? 'FAIL' : 'PASS') + ' ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
