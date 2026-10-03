/*
 * Paper Theatre tests. Zero dependencies.
 *   "C:\Program Files\nodejs\node.exe" misc/55-paper-theatre/test.js
 *
 * Sections: engine fixtures (Agent A), art snapshots (Agent C, appended below the
 * marker), index.html link consistency (Agent D, appended below the marker), and
 * the loop over every stories/*.vn and blog/posts/*.md.
 */
'use strict';
var fs = require('fs');
var path = require('path');
var VN = require('./vn.js');

var HERE = __dirname;
var ROOT = path.resolve(HERE, '..', '..');
var STORIES = path.join(HERE, 'stories');
var POSTS = path.join(ROOT, 'blog', 'posts');

var passed = 0, failed = 0, section = '';
function ok(cond, msg) {
  if (cond) { passed++; return true; }
  failed++;
  console.log('  FAIL [' + section + '] ' + msg);
  return false;
}
function eq(a, b, msg) {
  var same = JSON.stringify(a) === JSON.stringify(b);
  return ok(same, msg + '\n        got      ' + JSON.stringify(a) + '\n        expected ' + JSON.stringify(b));
}
function has(issues, code, level) {
  return issues.some(function (x) { return x.code === code && (!level || x.level === level); });
}
function find(issues, code) { return issues.filter(function (x) { return x.code === code; })[0]; }
function codes(issues) { return issues.map(function (x) { return x.code; }); }
function kinds(ops) { return ops.map(function (o) { return o.kind; }); }
function parseLint(text, opts) { var p = VN.parse(text, opts); return { p: p, issues: VN.lint(p) }; }
function readInclude(file) {
  return function (rel) {
    var f = path.join(path.dirname(file), rel);
    return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null;
  };
}

var HEADER = '@title Fixture\n@kind paper\n@cite A. Author (2026). Fixture.\n@cast Jack hue=210 glasses\n@cast You player\n';

/* ------------------------------------------------------------------ hash / rng */
section = 'hash';
eq(VN.hash(''), 2166136261, 'fnv1a of empty string is the offset basis');
eq(VN.hash('a'), 0xe40c292c, 'fnv1a("a")');
eq(VN.hashHex('a'), 'e40c292c', 'hashHex pads to 8');
var r1 = VN.rng('seed'), r2 = VN.rng('seed'), r3 = VN.rng(42);
eq([r1(), r1(), r1()], [r2(), r2(), r2()], 'rng is deterministic for the same string seed');
ok(r3() >= 0 && r3() < 1, 'rng in [0,1)');
ok(VN.rng('a')() !== VN.rng('b')(), 'different seeds differ');

/* ------------------------------------------------------------------ parse: header */
section = 'parse-header';
(function () {
  var src = [
    '\ufeff@title The Title',
    '@kind paper',
    '@source paper:Some Pub Title',
    '@cite J. Doe (2026). The Title. arXiv:2601.00001.',
    '@arxiv 2601.00001',
    '@link https://example.org/a Read it',
    '@link ../../x.pdf',
    '@authors J. Doe\u2020, A. Nother',
    '@note Custom note.',
    '@status embargo',
    '@palette ochre',
    '@verify',
    '@fact n = 42 ^\u00a73',
    '@fact words = Fifty',
    '@cast Jack hue=210 glasses short',
    '@cast Model name="a reasoning-tuned model" lattice=sparse hue=192',
    '@cast You player hue=20',
    '@cast Page page',
    '@cast Anh coauthor curly skin=4',
    '',
    'Jack: hello'
  ].join('\r\n');
  var p = VN.parse(src, { id: 'fix' });
  eq(p.meta.title, 'The Title', 'BOM stripped, title read');
  eq(p.meta.kind, 'paper', 'kind');
  eq([p.meta.sourceKind, p.meta.sourceRef], ['paper', 'Some Pub Title'], 'source split');
  eq(p.meta.arxiv, '2601.00001', 'arxiv');
  eq(p.meta.links, [{ url: 'https://example.org/a', label: 'Read it' }, { url: '../../x.pdf', label: 'Read the paper' }], 'links with default label');
  eq(p.meta.note, 'Custom note.', 'note');
  eq(p.meta.status, 'embargo', 'status');
  eq(p.meta.palette, { name: 'ochre', hue: 28 }, 'palette by name');
  eq(p.meta.verify, true, 'verify flag');
  eq(p.facts.n, { key: 'n', value: '42', ref: '\u00a73', line: 13, file: null }, 'fact with chip');
  ok(has(p.issues, 'fact-no-ref', 'warn'), 'fact without chip warns');
  eq(p.cast.model.name, 'a reasoning-tuned model', 'quoted cast display name');
  eq([p.cast.model.lattice, p.cast.model.hue], ['sparse', 192], 'lattice + hue');
  eq([p.cast.jack.glasses, p.cast.jack.hair, p.cast.you.player, p.cast.page.page, p.cast.anh.coauthor, p.cast.anh.skin, p.cast.anh.hair], [true, 'short', true, true, true, 4, 'curly'], 'cast traits');
  ok(p.cast.jack.skin >= 1 && p.cast.jack.skin <= 5, 'default skin hashed into 1-5');
  eq(p.hash.length, 8, 'program hash');
  eq(p.ops[0].kind, 'say', 'CRLF body line parsed');
  eq(p.ops[p.ops.length - 1], { kind: 'end', implicit: true, line: 22 }, 'implicit end appended');
  ok(!has(p.issues, 'cast-trait-unknown'), 'no unknown trait warnings: ' + JSON.stringify(codes(p.issues)));
})();

(function () {
  var p = VN.parse('@title X\n@kind blog\n@palette hue=400\n@status weird\n@palette purple\n@foo bar\nhi', {});
  ok(has(p.issues, 'status-unknown'), 'unknown status warns');
  ok(has(p.issues, 'palette-unknown'), 'unknown palette warns');
  ok(has(p.issues, 'directive-unknown'), 'unknown directive warns');
  eq(p.meta.palette.hue, 40, 'hue=400 wraps to 40');
  var q = VN.parse('@title X\n@kind blog\nhi', { id: 'blog-x' });
  eq(q.meta.palette.hue, VN.hash('blog-x') % 360, 'default hue = fnv1a(id) % 360');
  eq(q.meta.note, VN.DEFAULT_NOTE, 'default note');
  eq(q.meta.status, 'draft', 'default status');
})();

/* ------------------------------------------------------------------ parse: body */
section = 'parse-body';
(function () {
  var src = HEADER + [
    '# a comment',
    '@include _facts/f.vn',
    '@bg lab night',
    '@show Jack left',
    '@show You right (thinking)',
    '@show Jack (smile)',
    'Jack: Plain line. ^\u00a71',
    'Jack (smile): Face line with {n_humans} people and {Jack} and {bet}.',
    'Narration with',
    '  a continuation',
    '  and another. ^p.2',
    '@card Five tiers | L0: original | plain cell ^\u00a72',
    '@chart bar Accuracy | a={human_l0} | b=12% ^\u00a74 unit=%',
    '@chart range R | x={human_l0}..{human_l3} unit=%',
    '@code js | let x = 1; | return x;',
    '@scene Act {n_humans}',
    '@set bet = monotonic',
    '@set n = 3',
    '@add n 2',
    '@add k',
    '@if bet == monotonic -> a',
    '@if bet != x -> a',
    '@if n -> a',
    '@if !k -> a',
    '@thumb',
    '* (once) First -> a',
    '* (if bet == monotonic) Second -> b',
    '* (once) (if !k) Third -> a',
    '* Plain -> end',
    '== a',
    '@hide You',
    '@hide all',
    '-> b',
    '== b',
    '@withheld Not yet.',
    '@read post max=5',
    '@end'
  ].join('\n');
  var p = VN.parse(src, { includes: { '_facts/f.vn': '@fact n_humans = Fifty ^\u00a73.2\n@fact human_l0 = 40.5% ^\u00a74\n@fact human_l3 = 31.1% ^\u00a74\n' } });
  var ops = p.ops, byKind = {};
  ops.forEach(function (o) { (byKind[o.kind] = byKind[o.kind] || []).push(o); });
  eq(byKind.bg[0], { kind: 'bg', name: 'lab', mod: 'night', line: 8 }, 'bg with modifier');
  eq(byKind.show.map(function (o) { return [o.who, o.slot, o.face]; }), [['Jack', 'left', null], ['You', 'right', 'thinking'], ['Jack', null, 'smile']], 'show slot/face variants');
  var say0 = byKind.say[0];
  eq([say0.who, say0.key, say0.face, say0.text, say0.ref, say0.refs], ['Jack', 'jack', null, 'Plain line.', '\u00a71', ['\u00a71']], 'say with trailing chip');
  var say1 = byKind.say[1];
  eq([say1.face, say1.text], ['smile', 'Face line with Fifty people and Jack and {bet}.'], 'facts and cast names interpolated, vars left');
  eq(say1.chips, [{ key: 'n_humans', value: 'Fifty', ref: '\u00a73.2' }], 'chip attached from the fact');
  eq(say1.ref, '\u00a73.2', 'op.ref falls back to the first fact chip');
  var nar = byKind.narrate[0];
  eq([nar.text, nar.ref], ['Narration with a continuation and another.', 'p.2'], 'continuation lines joined; p. chip');
  var card = byKind.card[0];
  eq(card.title, 'Five tiers', 'card title');
  eq(card.cells.map(function (c) { return [c.label, c.value]; }), [['L0', 'original'], [null, 'plain cell']], 'card cells with and without labels');
  eq(card.ref, '\u00a72', 'card chip from last cell');
  var bar = byKind.chart[0];
  eq([bar.type, bar.title, bar.unit], ['bar', 'Accuracy', '%'], 'bar chart head + unit');
  eq(bar.series.map(function (s) { return [s.label, s.value, s.num, s.ref]; }), [['a', '40.5%', 40.5, '\u00a74'], ['b', '12%', 12, '\u00a74']], 'bar series values, numbers, chips');
  var rng = byKind.chart[1];
  eq([rng.series[0].lo, rng.series[0].hi, rng.series[0].loNum, rng.series[0].hiNum, rng.series[0].chips.length], ['40.5%', '31.1%', 40.5, 31.1, 2], 'range series');
  eq(byKind.code[0], { kind: 'code', lang: 'js', lines: ['let x = 1;', 'return x;'], line: 20 }, 'code card');
  eq(byKind.scene[0].title, 'Act Fifty', 'scene title interpolated');
  eq(byKind.set.map(function (o) { return [o.name, o.value]; }), [['bet', 'monotonic'], ['n', 3]], 'set string and number');
  eq(byKind.add.map(function (o) { return [o.name, o.value]; }), [['n', 2], ['k', 1]], 'add with and without amount');
  eq(byKind['if'].map(function (o) { return o.cond; }), [{ name: 'bet', op: '==', value: 'monotonic' }, { name: 'bet', op: '!=', value: 'x' }, { name: 'n', op: 'truthy', value: null }, { name: 'k', op: 'falsy', value: null }], 'four @if forms');
  eq(p.thumb, ops.indexOf(byKind.thumb[0]), 'thumb index');
  var menu = byKind.menu[0];
  eq(menu.options.map(function (o) { return [o.text, o.target, o.once, o.cond && o.cond.op]; }), [['First', 'a', true, null], ['Second', 'b', false, '=='], ['Third', 'a', true, 'falsy'], ['Plain', 'end', false, null]], 'menu options with prefixes');
  eq(typeof menu.key, 'string', 'menu has a stable key');
  eq(p.menus, [ops.indexOf(menu)], 'menus index list');
  eq(p.labels, { a: ops.indexOf(byKind.label[0]), b: ops.indexOf(byKind.label[1]) }, 'labels map to label ops');
  eq(byKind.hide.map(function (o) { return [o.key, o.all]; }), [['you', false], ['all', true]], 'hide variants');
  eq(byKind.goto[0].target, 'b', 'goto');
  eq(byKind.withheld[0].text, 'Not yet.', 'withheld text');
  eq(byKind.read[0], { kind: 'read', what: 'post', max: 5, line: 41 }, 'read op');
  eq(byKind.end[0].implicit, false, 'explicit end');
  eq(p.meta.includes, ['_facts/f.vn'], 'include recorded');
  var issues = VN.lint(p);
  ok(!issues.some(function (x) { return x.level === 'fatal'; }), 'fixture has no fatal: ' + JSON.stringify(codes(issues)));
  ok(!has(issues, 'header-after-body'), '@include before the body is fine');
  ok(has(VN.parse(HEADER + 'Jack: hi\n@cast Bob\n@fact z = 1 ^§1').issues, 'header-after-body'), '@cast/@fact after the first body line warn');
})();

(function () {
  var p = VN.parse('@title X\n@kind blog\n@include missing.vn\n@cast Jack\nJack: {gone} and {Jack}\n', { resolveInclude: function () { return null; } });
  ok(has(p.issues, 'include-missing'), 'missing include warns');
  ok(has(VN.lint(p), 'placeholder-unknown'), 'unknown placeholder warns');
  var q = VN.parse('@title X\n@kind blog\n@include a.vn\nhi {x}', { includes: { 'a.vn': '@include b.vn\n@fact y = 1 ^\u00a71', 'b.vn': '@fact x = 2 ^\u00a72' } });
  eq([q.facts.x.value, q.facts.y.value, q.facts.x.file], ['2', '1', 'b.vn'], 'nested includes merge facts');
  eq(q.ops[0].text, 'hi 2', 'nested fact interpolated');
})();

/* ------------------------------------------------------------------ interpolate / markup / refs */
section = 'interp';
eq(VN.interpolate('{bet} and {Jack} and {none}', { bet: 'monotonic' }, { jack: { name: 'Jack L.' } }), 'monotonic and Jack L. and {none}', 'render-time interpolation');
eq(VN.markup('Python got *easier*? see `_lastNSecs` ok'), [{ type: 'text', text: 'Python got ' }, { type: 'em', text: 'easier' }, { type: 'text', text: '? see ' }, { type: 'code', text: '_lastNSecs' }, { type: 'text', text: ' ok' }], 'markup tokens');
eq(VN.markup('2 * 3 * 4'), [{ type: 'text', text: '2 * 3 * 4' }], 'lone asterisks stay text');
eq(VN.describeRef('\u00a74'), 'quoted from the source, section 4', 'describeRef section');
eq(VN.describeRef('\u00b63'), 'from the post, paragraph 3', 'describeRef paragraph');
eq(VN.describeRef('para'), 'paraphrase of the source', 'describeRef para');
eq(VN.refs({ ref: '\u00a74', chips: [{ ref: '\u00a74' }, { ref: '\u00a73.2' }] }), ['\u00a74', '\u00a73.2'], 'refs dedupe');
ok(/^@misc\{le2026/.test(VN.bibtex({ title: 'T', authors: 'Jack V. Le\u2020 and Anh Nguyen\u2020 (co-first), Tien Nguyen', arxiv: '2606.31725', cite: '(2026)' })), 'bibtex key');
eq(VN.bibtex({}), '', 'bibtex without arxiv is empty');

/* ------------------------------------------------------------------ lint: fatals */
section = 'lint-fatal';
(function () {
  var r = parseLint('@title X\nJack: hi');
  var f = find(r.issues, 'kind-missing');
  ok(f && f.level === 'fatal', '@kind missing is fatal');
  r = parseLint(HEADER + 'Jack: hi\n-> modles\n== models\n@end');
  f = find(r.issues, 'unknown-jump');
  ok(f && f.level === 'fatal' && f.msg === "line 7: jump to unknown label 'modles'", 'unknown jump wording: ' + (f && f.msg));
  r = parseLint(HEADER + '@if x == 1 -> nowhere\n* pick -> alsonowhere');
  eq(r.issues.filter(function (x) { return x.code === 'unknown-jump'; }).length, 2, 'unknown jump from @if and option');
  r = parseLint(HEADER + 'Jack: choose\n* no target here\n');
  f = find(r.issues, 'option-no-target');
  ok(f && f.level === 'fatal' && f.line === 7, 'choice without target is fatal');
  r = parseLint(HEADER + '@show Result left');
  f = find(r.issues, 'show-undeclared');
  ok(f && f.level === 'fatal' && /undeclared name 'Result'/.test(f.msg), '@show undeclared is fatal');
  r = parseLint(HEADER + '@if bet === 1 -> a\n== a');
  f = find(r.issues, 'if-malformed');
  ok(f && f.level === 'fatal', 'malformed @if is fatal');
  r = parseLint(HEADER + '* (if bet =) x -> a\n== a');
  ok(has(r.issues, 'option-malformed', 'fatal'), 'malformed option condition is fatal');
})();

/* ------------------------------------------------------------------ lint: warnings */
section = 'lint-warn';
(function () {
  var r = parseLint(HEADER + '\n\n\n\n\n\nResult: 40% of people');
  var w = find(r.issues, 'speaker-undeclared');
  ok(w && w.level === 'warn', 'undeclared speaker demoted to narration');
  eq(w && w.msg, "line 12: 'Result' is not in @cast; treated as narration", 'speaker wording');
  eq(w && w.hint, 'add "@cast Result" to the header or remove the colon', 'speaker hint');
  eq(r.p.ops[0].kind, 'narrate', 'demoted op is narration');
  ok(has(r.issues, 'numeric-literal'), 'and the figure without chip warns');

  r = parseLint(HEADER + '@bg attic\n@bg lab dusk');
  w = find(r.issues, 'bg-unknown');
  ok(w && w.level === 'warn' && w.msg === "line 6: unknown background 'attic'; using void", 'unknown bg wording: ' + (w && w.msg));
  ok(w && w.hint.indexOf('lab, office, lecture') >= 0, 'bg hint lists the names');
  eq(r.p.ops[0].name, 'attic', 'bg op keeps the name');
  ok(has(r.issues, 'bg-mod-unknown'), 'unknown bg modifier warns');

  r = parseLint(HEADER + 'Jack: accuracy fell to 40.5% at L3\nJack: Spearman rho 0.3\nJack: p < 0.005\nJack: 600 answers\nJack: 12 output questions and L0 code `n=100`\nJack: Twelve models, nine of them.');
  var nl = r.issues.filter(function (x) { return x.code === 'numeric-literal'; });
  eq(nl.map(function (x) { return x.line; }), [6, 7, 8, 9, 10], 'numeric literal lint: %, rho, p <, integer >= 10; words are fine');
  eq(nl[0].msg, 'line 6: figure without a citation chip: "40.5%"', 'numeric wording');
  eq(nl[0].hint, 'use a {fact} or end the line with ^\u00a7n', 'numeric hint');
  r = parseLint(HEADER + 'Jack: accuracy fell to 40.5% at L3 ^\u00a74\n@fact a = 40.5% ^\u00a74\nJack: fell to {a}');
  ok(!has(r.issues, 'numeric-literal'), 'chipped figures pass');
  r = parseLint(HEADER.replace('paper', 'blog') + 'Jack: 40.5% of readers');
  ok(!has(r.issues, 'numeric-literal'), 'blog kind skips numeric lint');
  ok(has(VN.lint(r.p, { kind: 'paper' }), 'numeric-literal'), 'lint kind override');

  var branchy = HEADER + 'Jack: bet?\n* a -> a\n* b -> b\n== a\nJack: in branch 40% ^\u00a74\n-> joint\n== b\nJack: reaction only\n-> joint\n== joint\nJack: reconverged 40% ^\u00a74\n@if x == 1 -> ifb\nJack: fallthrough 1% ^\u00a74\n== ifb\nJack: after if 2% ^\u00a74\n@end';
  r = parseLint(branchy);
  var cb = r.issues.filter(function (x) { return x.code === 'chip-in-branch'; });
  eq(cb.map(function (x) { return x.line; }), [10, 18], 'chip-in-branch: menu branch and @if fallthrough flagged, reconverged lines fine');
  eq(cb[0].msg, 'line 10: chipped figure inside a choice-dependent branch', 'chip-in-branch wording');
  eq(cb[0].hint, 'choices change reactions, never reported figures', 'chip-in-branch hint');

  r = parseLint(HEADER + '@cast Anh coauthor\nAnh: I said this\nAnh: quoted ^\u00a73\nAnh: roughly ^para\nAnh: page ^p.2');
  var co = r.issues.filter(function (x) { return x.code === 'coauthor-unchipped'; });
  eq(co.map(function (x) { return x.line; }), [7], 'coauthor rule: only the unchipped line');
  eq(co[0].msg, "line 7: coauthor 'Anh' speaks without ^\u00a7n or ^para", 'coauthor wording');

  r = parseLint(HEADER + '@chart bar T | a=12 | b=13\n@chart bar U | a=12 ^\u00a74\n@fact f = 3 ^\u00a71\n@chart bar V | a={f} | b=9 ^\u00a72');
  eq(r.issues.filter(function (x) { return x.code === 'chart-literal'; }).length, 2, 'chart values without chips warn per series');

  r = parseLint(HEADER + 'Jack (grin): hi\n@show Jack (frown)');
  eq(r.issues.filter(function (x) { return x.code === 'face-unknown'; }).length, 2, 'unknown faces warn');
  eq(r.p.ops[0].face, 'neutral', 'unknown face becomes neutral');

  r = parseLint('@title X\n@kind paper\n@status published\n@cast Jack\nJack: no figures here');
  ok(has(r.issues, 'cite-missing'), 'published paper without @cite');
  ok(has(r.issues, 'no-chips'), 'published paper without chips');
  eq(codes(VN.publishBlockers(r.issues)).sort(), ['cite-missing', 'no-chips'], 'publishBlockers');
  r = parseLint('@title X\n@kind paper\n@cast Jack\nJack: no figures here');
  ok(!has(r.issues, 'cite-missing') && !has(r.issues, 'no-chips'), 'draft paper is not nagged');

  r = parseLint(HEADER + '@link a\n@link b\n@link c');
  ok(has(r.issues, 'links-extra'), 'third link warns');
  r = parseLint(HEADER + '== two words\n');
  ok(has(r.issues, 'label-malformed'), 'malformed section header warns');
  r = parseLint(HEADER + 'See https://example.org: fine\nhttps: not a speaker');
  ok(!has(r.issues, 'speaker-undeclared'), 'urls are not speakers');
  ok(!has(r.issues, 'label-duplicate'), 'sanity');
  r = parseLint(HEADER + '== a\n== a');
  ok(has(r.issues, 'label-duplicate'), 'duplicate label warns');
})();

/* ------------------------------------------------------------------ walk */
section = 'walk';
(function () {
  var p = VN.parse(HEADER + 'Jack: q\n* a -> a\n* b -> b\n== a\n@set bet = 1\n-> j\n== b\n-> j\n== j\n@if bet == 1 -> r\nJack: x\n-> end\n== r\nJack: y\n@end\n== orphan\nJack: never');
  var w = VN.walk(p);
  eq([w.ok, w.paths, w.endings.end, w.unreachable], [false, 2, 2, ['orphan']], 'two paths, orphan label unreachable');
  ok(has(w.issues, 'unreachable-label'), 'unreachable label issue');
  p = VN.parse(HEADER + '== loop\nJack: again\n-> loop');
  w = VN.walk(p);
  ok(!w.ok && w.loops.length === 1 && has(w.issues, 'walk-loop'), 'infinite loop detected');
  p = VN.parse(HEADER + '== hub\nJack: pick\n* (once) one -> one\n* (once) two -> two\n* leave -> out\n== one\nJack: 1\n-> hub\n== two\nJack: 2\n-> hub\n== out\n@end');
  w = VN.walk(p);
  ok(w.ok && w.paths >= 3, 'once-hub terminates: paths=' + w.paths + ' steps=' + w.steps);
  p = VN.parse(HEADER + '== hub\nJack: pick\n* (once) one -> one\n== one\nJack: 1\n-> hub');
  w = VN.walk(p);
  ok(!w.ok && has(w.issues, 'menu-empty'), 'hub with only once options and no exit is reported');
  p = VN.parse(HEADER + '== loop\n@add n 1\n-> loop');
  w = VN.walk(p, { maxSteps: 500 });
  ok(!w.ok && has(w.issues, 'walk-cap'), 'counter loop hits the step cap');
  p = VN.parse(HEADER + '@withheld\n');
  w = VN.walk(p);
  eq([w.ok, w.endings.withheld, w.endings.end], [true, 1, 1], 'withheld then implicit end');
})();

/* ------------------------------------------------------------------ interp (createRun) */
section = 'run';
(function () {
  var src = HEADER + [
    '@bg lab', '@show Jack left', 'Jack: one', 'Jack (smile): two', '@show You', 'You: three',
    '* (once) A -> a', '* B -> b', '* (if bet == 1) C -> b',
    '== a', '@set bet = 1', '@add n 2', '@add n', 'Jack: in a', '-> back',
    '== b', '@hide all', 'Jack: in b', '-> back',
    '== back', '@if bet == 1 -> again', 'Jack: done', '@end',
    '== again', '@set bet = 0', '-> start_menu', '== start_menu', 'You: three again',
    '* (once) A -> a', '* B -> b', '* (if bet == 1) C -> b'
  ].join('\n');
  var p = VN.parse(src);
  var lintIssues = VN.lint(p);
  ok(!lintIssues.some(function (x) { return x.level === 'fatal'; }), 'run fixture lints: ' + JSON.stringify(codes(lintIssues)));
  var run = VN.createRun(p);
  var s = run.advance();
  eq([s.op.kind, s.op.text, s.index, s.done], ['say', 'one', 2, false], 'first stop after bg/show');
  eq(run.state.bg, { name: 'lab', mod: null }, 'bg applied');
  eq(run.state.slots, { left: 'jack', center: null, right: null }, 'slot applied');
  eq(run.state.faces.jack, 'neutral', 'default face');
  s = run.advance();
  eq(run.state.faces.jack, 'smile', 'say face applies at the stop');
  s = run.advance();
  eq(run.state.slots, { left: 'jack', center: 'you', right: null }, 'show without slot takes first free');
  eq(run.state.history.length, 3, 'history records stops');
  s = run.advance();
  eq(s.op.kind, 'menu', 'menu stop');
  eq(s.options.map(function (o) { return o.text; }), ['A', 'B'], 'conditional option hidden');
  eq(run.advance().op.kind, 'menu', 'advance at a menu stays');
  s = run.choose(0);
  eq([s.op.text, run.state.vars.bet, run.state.vars.n], ['in a', 1, 3], 'choose A: set/add ran');
  eq(run.state.choiceLog.length, 1, 'choice logged');
  eq(run.state.choiceLog[0].menuKey, p.ops[p.menus[0]].key, 'choice log carries the menu key');
  eq(run.state.history[run.state.history.length - 2], { kind: 'choice', menuIndex: p.menus[0], optionIndex: 0, text: 'A' }, 'choice in history');
  s = run.advance();
  eq(s.op.text, 'three again', 'if jumped to again -> start_menu');
  s = run.advance();
  eq(s.options.map(function (o) { return o.text; }), ['A', 'B'], 'second menu is a different op, so its (once) A is still visible; C hidden since bet=0');
  var snap = run.snapshot();
  eq(snap.stopIndex, run.state.stops, 'snapshot stopIndex');
  ok(snap.seen.indexOf(2) >= 0, 'seen contains first stop');
  var b = run.back();
  eq(b.op.text, 'three again', 'back returns to previous stop');
  b = run.back();
  eq(b.op.text, 'in a', 'back again');
  eq(run.state.vars.bet, 1, 'state restored with the snapshot');
  var r2 = VN.createRun(p);
  var s2 = r2.replay(snap.choiceLog, snap.stopIndex);
  eq([s2.index, r2.state.stops], [snap.pc, snap.stopIndex], 'replay reproduces the stop');
  var r3 = VN.createRun(p);
  var s3 = r3.replay([]);
  eq(s3.op.kind, 'menu', 'replay with an empty log stops at the first menu');
  var r4 = VN.createRun(p);
  var s4 = r4.jumpTo('b');
  eq([s4.op.text, r4.state.label], ['in b', 'b'], 'jumpTo label');
  eq(r4.state.bg && r4.state.bg.name, 'lab', 'jumpTo dresses the stage with preceding bg');
  eq(r4.jumpTo(2).op.text, 'one', 'jumpTo index');
  var r5 = VN.createRun(VN.parse(HEADER + 'Jack: q\n* (if x == 1) only -> a\n== a\n@end'));
  r5.advance();
  var e = r5.advance();
  eq([e.op.kind, e.done], ['error', true], 'menu with no visible options is an error stop');
  var r6 = VN.createRun(VN.parse(HEADER + 'Jack: a\nJack: b\n@end'));
  r6.advance(); r6.advance();
  var endStop = r6.advance();
  eq([endStop.op.kind, endStop.done], ['end', true], 'end stop is done');
  eq(r6.advance().op.kind, 'end', 'advance after end stays on end');
  eq(Object.keys(r6.seen).length, 3, 'seen has three stops');
  var r7 = VN.createRun(p, { seen: [7, 8] });
  ok(r7.seen[7] && r7.seen[8], 'seen restored from options');
  var r8 = VN.createRun(VN.parse(HEADER + 'Jack: a\n@withheld\nJack: never shown?\n@end'));
  r8.advance();
  eq(r8.advance().op.kind, 'withheld', 'withheld is a stop');
  eq(r8.advance().op.kind, 'say', 'and play continues after it');
})();

/* ------------------------------------------------------------------ blog segmenter */
section = 'blog';
(function () {
  var md = [
    '---', 'title: My Post', 'date: 2026-01-01', '---', '',
    '"A quote to open."', 'Some Author, Some Book', '',
    '# My Post', '', 'First paragraph with **bold**, _em_, `code`, a [link](http://x) and $\\Phi$ math and $$x_1 + y_2$$ display.', '',
    '## Second part', '', '> Quoted words.', '',
    '- **Alpha.** Alpha body, e.g. this.', '  - nested one', '', '- **Beta vs. Gamma.** Beta body.', '', '- Delta', '',
    '![An image](assets/img/x.png)', '',
    '```js', 'ignored();', '```', '', '<!-- hidden -->', '<small>Small print.</small>', '',
    '1. Only one item.', '', 'Last paragraph.'
  ].join('\n');
  var ops = VN.blog(md, { title: 'My Post' });
  var k = kinds(ops);
  eq(k.slice(0, 3), ['say', 'narrate', 'narrate'], 'epigraph becomes a page line + attribution; title heading dropped');
  eq([ops[0].who, ops[0].key, ops[0].ref], ['Page', 'page', '\u00b61'], 'page speaker and paragraph chip');
  eq(ops[2].text, 'First paragraph with bold, em, code, a link and $\\Phi$ math and $$x_1 + y_2$$ display.', 'inline markdown stripped, math intact');
  eq(ops[3], { kind: 'scene', title: 'Second part', line: 0 }, 'heading -> scene');
  eq([ops[4].kind, ops[4].who, ops[4].text], ['say', 'Page', 'Quoted words.'], 'blockquote -> page says');
  var mi = k.indexOf('menu');
  ok(mi > 0 && k[mi - 1] === 'label' && ops[mi - 1].name === 'read_1', 'list -> hub label + menu');
  eq(ops[mi].options.map(function (o) { return [o.text, o.target, o.once]; }), [['Alpha', 'read_1_1', true], ['Beta vs. Gamma', 'read_1_2', true], ['Delta', 'read_1_3', true], ['Continue', 'read_1_done', false]], 'menu options: first sentence, once, Continue');
  eq(ops[mi + 1].name, 'read_1_1', 'section label');
  eq(ops[mi + 2].text, 'Alpha. Alpha body, e.g. this. nested one.', 'nested item folded into the section');
  eq(ops[mi + 3], { kind: 'goto', target: 'read_1', line: 0 }, 'section returns to the hub');
  var card = ops.filter(function (o) { return o.kind === 'card'; })[0];
  eq([card.title, card.cells[0].value, card.src], ['Figure', 'An image', 'assets/img/x.png'], 'image -> card');
  ok(!ops.some(function (o) { return /ignored|hidden/.test(o.text || ''); }), 'code fences and comments dropped');
  ok(ops.some(function (o) { return o.text === 'Small print.'; }), 'html tags stripped to text');
  ok(ops.some(function (o) { return o.text === 'Only one item.'; }), 'single-item list is narration');
  eq(ops[ops.length - 1].text, 'Last paragraph.', 'last paragraph');
  ok(ops.every(function (o) { return o.line === 0; }), 'blog ops have line 0');
  var cut = VN.blog(md, { title: 'My Post' }, { max: 3 });
  ok(cut.filter(function (o) { return VN.BLOCKING[o.kind]; }).length <= 5 && cut[cut.length - 1].truncated === true, 'max truncates with a trailing note');

  // expand a @read op and walk it
  var p = VN.parse('@title My Post\n@kind blog\n@cast Jack\nJack: before\n@read post max=40\nJack: after\n@end');
  var x = VN.expand(p, md, { title: 'My Post' });
  ok(x.labels.read_1 != null && x.labels.read_1_done != null, 'expand re-indexes labels');
  eq(x.ops[0].text, 'before', 'expand keeps the preamble');
  ok(x.cast.page && x.cast.page.page, 'expand adds a page cast decl');
  var w = VN.walk(x);
  ok(w.ok, 'expanded program walks clean: ' + JSON.stringify(w.issues.map(function (i) { return i.msg; })));
  ok(!VN.lint(x).some(function (i) { return i.level === 'fatal'; }), 'expanded program lints clean');
  var run = VN.createRun(x), s = run.advance(), guard = 0, sawMenu = false;
  while (s && !s.done && guard++ < 200) { if (s.op.kind === 'menu') { sawMenu = true; s = run.choose(0); } else s = run.advance(); }
  ok(sawMenu && s.done, 'expanded program plays to the end choosing the first option');
  eq(VN.blog('', {}), [], 'empty post -> no ops');
  eq(VN.blog('\ufeffJust text.', {})[0].text, 'Just text.', 'BOM tolerated');
})();

/* ------------------------------------------------------------------ every blog post */
section = 'posts';
var postCount = 0;
(function () {
  if (!fs.existsSync(POSTS)) { ok(false, 'blog/posts missing'); return; }
  var index = [];
  try { index = JSON.parse(fs.readFileSync(path.join(ROOT, 'blog', 'index.json'), 'utf8')); } catch (e) { /* tolerated */ }
  fs.readdirSync(POSTS).filter(function (f) { return /\.md$/.test(f); }).forEach(function (f) {
    postCount++;
    var md = fs.readFileSync(path.join(POSTS, f), 'utf8');
    var meta = index.filter(function (x) { return x.file === f; })[0] || {};
    var ops = null, err = null;
    try { ops = VN.blog(md, meta, { max: 500 }); } catch (e) { err = e; }
    if (!ok(!err, 'blog() throws on ' + f + ': ' + (err && err.stack))) return;
    ok(ops.length > 0, f + ' yields ops');
    ok(ops.every(function (o) { return o.kind !== 'narrate' || (o.text && o.text.trim()); }), f + ' has no empty narration');
    var prog = VN.expand(VN.parse('@title ' + (meta.title || f) + '\n@kind blog\n@read post max=500\n@end'), md, meta);
    var w = VN.walk(prog);
    ok(w.ok, f + ' auto-read walks every branch: ' + JSON.stringify(w.issues.map(function (i) { return i.msg; })));
    ok(!VN.lint(prog).some(function (i) { return i.level === 'fatal'; }), f + ' auto-read has no fatal lint');
  });
})();

/* ------------------------------------------------------------------ every story */
section = 'stories';
var storyCount = 0, storyWarnings = 0;
var manifest = [];
try { manifest = JSON.parse(fs.readFileSync(path.join(STORIES, 'index.json'), 'utf8')); } catch (e) { ok(false, 'stories/index.json unreadable: ' + e.message); }
ok(Array.isArray(manifest) && manifest.length > 0, 'stories/index.json is a non-empty array');
(function () {
  var files = fs.readdirSync(STORIES).filter(function (f) { return /\.vn$/.test(f); }).sort();
  var factFiles = fs.existsSync(path.join(STORIES, '_facts')) ? fs.readdirSync(path.join(STORIES, '_facts')).filter(function (f) { return /\.vn$/.test(f); }) : [];
  factFiles.forEach(function (f) {
    var text = fs.readFileSync(path.join(STORIES, '_facts', f), 'utf8');
    var p = VN.parse('@title facts\n@kind paper\n' + text, { id: '_facts/' + f });
    ok(!p.issues.some(function (i) { return i.code === 'fact-malformed' || i.code === 'fact-no-ref'; }), '_facts/' + f + ' facts all well-formed and chipped: ' + JSON.stringify(codes(p.issues)));
    ok(Object.keys(p.facts).length > 0, '_facts/' + f + ' declares facts');
  });
  files.forEach(function (f) {
    storyCount++;
    var id = f.replace(/\.vn$/, '');
    var file = path.join(STORIES, f);
    var text = fs.readFileSync(file, 'utf8');
    var p = VN.parse(text, { id: id, resolveInclude: readInclude(file) });
    var issues = VN.lint(p);
    var fatals = issues.filter(function (i) { return i.level === 'fatal'; });
    var warns = issues.filter(function (i) { return i.level === 'warn'; });
    storyWarnings += warns.length;
    ok(fatals.length === 0, f + ' has fatal issues:\n        ' + fatals.map(function (i) { return i.msg + ' (' + i.hint + ')'; }).join('\n        '));
    warns.forEach(function (i) { console.log('  warn  ' + f + ' ' + i.msg + (i.hint ? '  [' + i.hint + ']' : '')); });
    ok(p.meta.title, f + ' has @title');
    ok(p.meta.kind, f + ' has @kind');
    var w = VN.walk(p);
    ok(w.ok, f + ' walk: ' + JSON.stringify(w.issues.map(function (i) { return i.msg; })));
    ok(w.paths >= 1, f + ' has at least one complete path');
    if (p.meta.status === 'published') {
      var blockers = VN.publishBlockers(issues);
      ok(blockers.length === 0, f + ' is published but has blockers: ' + blockers.map(function (i) { return i.msg; }).join('; '));
      if (p.meta.kind === 'paper') ok(p.meta.cite, f + ' published paper needs @cite');
    }
    if (p.meta.status === 'embargo') ok(p.ops.some(function (o) { return o.kind === 'withheld'; }), f + ' embargo story needs @withheld');
    if (p.meta.sourceKind === 'blog') {
      var idx = [];
      try { idx = JSON.parse(fs.readFileSync(path.join(ROOT, 'blog', 'index.json'), 'utf8')); } catch (e) { /* tolerated */ }
      var hit = idx.some(function (x) { return x.slug === p.meta.sourceRef; });
      if (!hit) console.log('  note  ' + f + " @source blog:" + p.meta.sourceRef + ' is not in blog/index.json (tolerated)');
    }
    // the manifest entry, when present, must agree with the header
    var entry = manifest.filter(function (m) { return m.id === id; })[0];
    if (entry) {
      eq([entry.file, entry.kind, entry.status, entry.title], [f, p.meta.kind, p.meta.status, p.meta.title], f + ' manifest entry matches the header');
    }
    // every @cast speaker is used or shown at least once (hygiene, not fatal)
    Object.keys(p.cast).forEach(function (k) {
      var used = p.ops.some(function (o) { return o.key === k; });
      if (!used) console.log('  note  ' + f + " cast '" + p.cast[k].id + "' is never shown or spoken");
    });
    // full play-through of every path with the interpreter (first option, then second, ...)
    var played = 0;
    for (var pick = 0; pick < 4; pick++) {
      var run = VN.createRun(p), s = run.advance(), guard = 0;
      while (s && !s.done && guard++ < 5000) { s = s.op.kind === 'menu' ? run.choose(Math.min(pick, s.options.length - 1)) : run.advance(); }
      if (s && s.op.kind === 'end') played++;
      else ok(false, f + ' play-through with option ' + pick + ' ended on ' + (s && s.op.kind) + (s && s.op.msg ? ': ' + s.op.msg : ''));
    }
    ok(played === 4, f + ' plays to @end');
  });
  // index.html pub-play links: a story needs status published to be linked (full check appended by Agent D)
  var html = fs.existsSync(path.join(ROOT, 'index.html')) ? fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8') : '';
  var linked = [], re = /class="pub-play"[^>]*href="misc\/55-paper-theatre\/\?story=([\w-]+)"/g, m;
  while ((m = re.exec(html))) linked.push(m[1]);
  linked.forEach(function (id) {
    var f = path.join(STORIES, id + '.vn');
    var okf = fs.existsSync(f) && VN.parse(fs.readFileSync(f, 'utf8'), { id: id }).meta.status === 'published';
    ok(okf, 'index.html links story ' + id + ' which is missing or not published');
  });
  // paper: sources must name a real .pub-block title
  files.forEach(function (f) {
    var p = VN.parse(fs.readFileSync(path.join(STORIES, f), 'utf8'), { id: f, resolveInclude: readInclude(path.join(STORIES, f)) });
    if (p.meta.sourceKind === 'paper' && html) {
      var titles = [], tre = /<div class="[^"]*\bh5\b[^"]*"[^>]*>([\s\S]*?)<\/div>/g, tm;
      while ((tm = tre.exec(html))) titles.push(tm[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim());
      var hit = titles.some(function (t) { return t.indexOf(p.meta.sourceRef) >= 0; });
      ok(hit, f + ' @source paper:' + p.meta.sourceRef + ' does not match any .pub-block .h5 title in index.html');
    }
  });
})();

/* ------------------------------------------------------------------ obfuscation specifics */
section = 'obfuscation';
(function () {
  var file = path.join(STORIES, 'obfuscation.vn');
  if (!fs.existsSync(file)) { ok(false, 'stories/obfuscation.vn missing'); return; }
  var p = VN.parse(fs.readFileSync(file, 'utf8'), { id: 'obfuscation', resolveInclude: readInclude(file) });
  eq(Object.keys(p.labels), ['bet_monotonic', 'bet_language', 'humans', 'react_monotonic', 'models'], 'labels');
  eq(p.cast.model.name, 'a reasoning-tuned model', 'Model display name');
  ok(p.thumb != null && p.ops[p.thumb + 1].text === 'Before the numbers, place a bet.', 'thumb precedes the bet');
  var chipped = p.ops.filter(function (o) { return VN.refs(o).length; }).length;
  eq(chipped, 9, 'nine chipped ops');
  var w = VN.walk(p);
  eq([w.ok, w.paths], [true, 2], 'two complete paths');
  var issues = VN.lint(p);
  eq(codes(issues), [], 'obfuscation lints clean');
  var chart = p.ops.filter(function (o) { return o.kind === 'chart'; })[0];
  eq(chart.series.map(function (s) { return [s.loNum, s.hiNum]; }), [[40.5, 31.1], [43, 16], [38, 53]], 'chart numbers from facts');
  eq(chart.unit, '%', 'chart unit');
})();

/* ============================================================== ART SNAPSHOTS (Agent C appends below) */

/* ============================================================== LINK CONSISTENCY (Agent D appends below) */
// Static "Play the visual novel" links in index.html must agree with each story's
// @status: every published paper story has an <a class="pub-play" href="...?story=<id>">
// inside its own .pub-block, and no draft/embargo (or missing) story has one.
// The check itself lives in test-links.js so it can also run on its own.
section = 'links';
(function () {
  var linkCheck;
  try { linkCheck = require('./test-links.js'); } catch (e) { ok(false, 'test-links.js failed to load: ' + e.message); return; }
  var lines = [];
  var clean = linkCheck.run({ log: function (m) { lines.push(String(m)); } });
  ok(clean, 'index.html pub-play links match story status\n        ' + lines.join('\n        '));
  var hits = lines.filter(function (l) { return /^  warn/.test(l); });
  if (hits.length) console.log('  note [links] ' + hits.join('\n  note [links] '));
})();

/* ------------------------------------------------------------------ summary */
var summary = 'test.js: ' + passed + ' passed, ' + failed + ' failed; ' + storyCount + ' stories (' + storyWarnings + ' warnings), ' + postCount + ' posts';
console.log(summary);
process.exit(failed ? 1 : 0);
