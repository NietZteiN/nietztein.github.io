/*
 * Paper Theatre - art snapshot tests (Node only, no DOM).
 *
 *   "C:\Program Files\nodejs\node.exe" misc/55-paper-theatre/test-art.js
 *   "C:\Program Files\nodejs\node.exe" misc/55-paper-theatre/test-art.js --update   (re-pin snapshots)
 *
 * Every builder is called with fixed inputs; the test pins the output length and
 * an fnv1a hash of the string, then checks a few structural invariants (eight
 * swappable faces, no literal colours outside var() fallbacks, a hidden table
 * under every chart, balanced tags). Written as a separate file because test.js
 * did not exist when the art landed; the ART SNAPSHOT TESTS block below can be
 * pasted into test.js verbatim.
 */
'use strict';
var path = require('path');
var fs = require('fs');
var A = require(path.join(__dirname, 'art.js'));

// ===================== ART SNAPSHOT TESTS =====================
var SNAPSHOTS = {
  'bg:lab': [7241, 'f5ed36b2'],
  'bg:office': [3430, '56d9df13'],
  'bg:lecture': [3720, 'bb34b1b0'],
  'bg:server': [31617, '2671c22a'],
  'bg:library': [37742, 'b7492a9e'],
  'bg:night': [18486, '7f5c8801'],
  'bg:cafe': [3562, '369946f1'],
  'bg:terminal': [34775, '5ed16fdf'],
  'bg:paper': [4031, 'ab61ad2d'],
  'bg:train': [6875, '5f87e89d'],
  'bg:garden': [6021, '290e6ec7'],
  'bg:void': [1323, 'ddfc043d'],
  'bg:lab:night': [7386, '3bdde200'],
  'bg:lab:dawn': [7443, 'df906335'],
  'bg:lab:dim': [7358, 'ed1a2fd1'],
  'bg:library:spines': [41885, '921dab9d'],
  'bg:unknown': [1323, 'ddfc043d'],
  'sprite:jack:neutral': [5839, 'ed503304'],
  'sprite:jack:smile': [5837, '5e1a92e3'],
  'sprite:jack:puzzled': [5839, '91ddb9db'],
  'sprite:jack:worried': [5839, '2f83bce3'],
  'sprite:jack:surprised': [5841, '6b7c7b50'],
  'sprite:jack:thinking': [5840, '11611afb'],
  'sprite:jack:deadpan': [5839, '73fbf484'],
  'sprite:jack:laugh': [5837, '3822bd74'],
  'sprite:hair:short': [5491, '36697e45'],
  'sprite:hair:long': [5873, 'a01b45f2'],
  'sprite:hair:bun': [5601, '7fc6ba77'],
  'sprite:hair:curly': [6523, '49fab6e3'],
  'sprite:hair:none': [5324, 'de020da6'],
  'sprite:hair:hood': [5636, '293e9d04'],
  'lattice:sparse': [30222, '1f706e48'],
  'lattice:dense': [72437, '91504599'],
  'player': [898, '4d3e05d9'],
  'page': [2311, 'f035cd49'],
  'card': [498, '309f3057'],
  'chart:bar': [4163, '4ce89530'],
  'chart:range': [5570, '6b8e34c3'],
  'code': [498, '6f443bd2'],
  'scene': [1048, 'c0fc2a7c'],
  'endCard': [1338, '236be0b2'],
  'castGrid': [293593, '8f3c2deb'],
  'palette:slate:light': [372, 'a873ef31'],
  'palette:hue:dark': [409, '6e38266c']
};

var CAST = {
  jack: { id: 'Jack', name: 'Jack', hue: 210, skin: 2, hair: 'short', glasses: true },
  model: { id: 'Model', name: 'a reasoning-tuned model', lattice: 'sparse', hue: 192 },
  obf: { id: 'Obfuscator', lattice: 'dense', hue: 330 },
  you: { id: 'You', player: true, hue: 20 },
  page: { id: 'Schiller', page: true, hue: 40 }
};

var CASES = {};
A.BACKGROUNDS.forEach(function (b) { CASES['bg:' + b] = function () { return A.background(b); }; });
A.MODIFIERS.forEach(function (m) { CASES['bg:lab:' + m] = function () { return A.background('lab', m); }; });
CASES['bg:library:spines'] = function () { return A.background('library', 'dim', [{ title: 'A', genreHue: 10 }, { title: 'B', genreHue: 120 }]); };
CASES['bg:unknown'] = function () { return A.background('attic'); };
A.FACES.forEach(function (f) { CASES['sprite:jack:' + f] = function () { return A.sprite(CAST.jack, f); }; });
A.HAIR.forEach(function (h) { CASES['sprite:hair:' + h] = function () { return A.sprite({ id: 'H-' + h, hair: h, hat: true, skin: 3 }, 'smile'); }; });
CASES['lattice:sparse'] = function () { return A.lattice(CAST.model, 'puzzled'); };
CASES['lattice:dense'] = function () { return A.lattice(CAST.obf, 'worried', { dense: true }); };
CASES['player'] = function () { return A.player(CAST.you); };
CASES['page'] = function () { return A.page(CAST.page); };
CASES['card'] = function () { return A.card('Five tiers', ['L0: original, name masked', 'L1: uninformative renaming', { label: 'L3', value: 'both' }]); };
CASES['chart:bar'] = function () {
  return A.chart({ type: 'bar', title: 'Adversarial renaming', unit: '%', series: [
    { label: 'L0 original', value: '40.5%', num: 40.5, ref: '§4' }, { label: 'L1b adversarial', value: '21%', num: 21, ref: '§4', highlight: true }] });
};
CASES['chart:range'] = function () {
  return A.chart({ type: 'range', title: 'Human accuracy by tier', unit: '%', series: [
    { label: 'all languages', lo: '40.5%', hi: '31.1%', loNum: 40.5, hiNum: 31.1, ref: '§4' },
    { label: 'Python under renaming', lo: '38%', hi: '53%', loNum: 38, hiNum: 53, ref: '§4' }] });
};
CASES['code'] = function () { return A.code('js', ['function f(_lastNSecs) {', '  return _lastNSecs < 3;', '}']); };
CASES['scene'] = function () { return A.scene('Open mic'); };
CASES['endCard'] = function () {
  return A.endCard({ title: 'Do Machines Struggle Where Humans Do?', kind: 'paper', authors: 'Jack V. Le† and Anh Nguyen† (co-first), Tien Nguyen',
    cite: 'J. V. Le†, A. Nguyen†, T. Nguyen (2026). arXiv:2606.31725 [cs.SE]. Submitted to FSE.', arxiv: '2606.31725', verify: true,
    links: [{ url: 'https://arxiv.org/abs/2606.31725', label: 'Read the paper' }] },
    [{ key: 'n_humans', value: 'Fifty', ref: '§3.2' }, { key: 'rho_cot', value: 'ρ = −0.52', ref: '§4' }]);
};
CASES['castGrid'] = function () { return A.castGrid([CAST.jack, CAST.model, CAST.you, CAST.page]); };
CASES['palette:slate:light'] = function () { return A.palette('slate').css('light'); };
CASES['palette:hue:dark'] = function () { return A.palette('hue=33').css('dark'); };

var failures = 0, passes = 0;
function fail(msg) { failures++; console.log('  FAIL ' + msg); }
function ok(cond, msg) { if (cond) passes++; else fail(msg); }

function hex(s) { return ('00000000' + A.hash(s).toString(16)).slice(-8); }

function checkInvariants(name, s) {
  ok(typeof s === 'string' && s.length > 0, name + ': non-empty string');
  // literal colours are allowed only as var() fallbacks or hsl(<hue> var(...)) spine fills
  var m = s.match(/(?:fill|stroke)="(?!var\(|none|url\(|hsl\(var\(|hsl\(\d+ var\(|currentColor)[^"]*"/g);
  ok(!m, name + ': literal colour ' + (m ? m[0] : ''));
  ok(!/NaN|undefined/.test(s), name + ': contains NaN/undefined');
  // balanced svg/g/div tags
  ['svg', 'g', 'div', 'figure', 'table'].forEach(function (t) {
    var open = (s.match(new RegExp('<' + t + '[\\s>]', 'g')) || []).length, close = (s.match(new RegExp('</' + t + '>', 'g')) || []).length;
    ok(open === close, name + ': unbalanced <' + t + '> ' + open + '/' + close);
  });
}

var update = process.argv.indexOf('--update') >= 0, fresh = {};
console.log('art snapshots (' + Object.keys(CASES).length + ' cases)');
Object.keys(CASES).forEach(function (name) {
  var s = CASES[name]();
  checkInvariants(name, s);
  fresh[name] = [s.length, hex(s)];
  var exp = SNAPSHOTS[name];
  if (!update) {
    if (!exp) fail(name + ': no pinned snapshot (run with --update)');
    else ok(exp[0] === s.length && exp[1] === hex(s), name + ': changed (' + exp[0] + '/' + exp[1] + ' -> ' + s.length + '/' + hex(s) + ')');
  }
});

// structural expectations
(function () {
  var sp = CASES['sprite:jack:smile']();
  ok((sp.match(/<g data-face="/g) || []).length === 8, 'sprite has 8 <g data-face> groups');
  ok(/data-face="smile" class="vn-face vn-face-smile is-on"/.test(sp), 'active face is marked is-on');
  ok(/--vn-h:210/.test(sp), 'sprite root carries --vn-h');
  ok(/var\(--vn-skin-2/.test(sp), 'skin=2 uses --vn-skin-2');
  var la = CASES['lattice:sparse']();
  ok((la.match(/<g data-face="/g) || []).length === 8, 'lattice has 8 face groups');
  ok(/data-lattice="sparse"/.test(la) && /data-lattice="dense"/.test(CASES['lattice:dense']()), 'lattice density attribute');
  ok((la.match(/id="vn-glow"/g) || []).length === 1 && /url\(#vn-glow\)/.test(la), 'one shared glow filter id');
  ok(CASES['lattice:dense']().length > la.length, 'dense lattice has more nodes than sparse');
  ok(A.sprite(CAST.model, 'smile').indexOf('data-lattice') > 0, 'sprite() dispatches lattice');
  ok(A.sprite(CAST.you).indexOf('data-kind="player"') > 0, 'sprite() dispatches player');
  ok(A.sprite(CAST.page).indexOf('data-kind="page"') > 0, 'sprite() dispatches page');
  var ch = CASES['chart:range']();
  ok(/<table class="vn-sr-only">/.test(ch) && /<th scope="row">Python under renaming<\/th>/.test(ch), 'chart has hidden table');
  ok(ch.indexOf('<legend') < 0 && /percent/.test(ch), 'chart: no legend, unit on the axis');
  ok(/40\.5%/.test(ch) && /53%/.test(ch), 'chart: direct labels keep source strings');
  ok(/role="img" aria-labelledby="vnc-/.test(ch), 'chart svg labelled');
  var cd = CASES['code']();
  ok((cd.match(/vn-code-ln/g) || []).length === 3 && /&lt; 3/.test(cd), 'code: line numbers and escaping');
  var ec = CASES['endCard']();
  ok(/vn-endcard-ribbon/.test(ec) && /data-action="bibtex"/.test(ec) && /Figures used/.test(ec) && /title="quoted from the source, section 3.2"/.test(ec), 'end card parts');
  ok(A.endCard({ title: 'x' }).indexOf('data-action="bibtex"') < 0, 'end card: no BibTeX without @arxiv');
  ok(/unknown|void/.test(A.background('attic').match(/data-bg="([a-z]+)"/)[1]), 'unknown background falls back to void');
  ok(A.background('library', null, [{ title: 'Only', genreHue: 5 }]).indexOf('<title>Only</title>') > 0, 'library spines carry titles');
  ok(A.background('lab', 'night').indexOf('data-mod="night"') > 0, 'modifier recorded');
  var p = A.palette('slate'), q = A.palette(undefined, 'obfuscation');
  ok(p.hue === 210 && A.palette('moss').hue === 120 && A.palette('hue=400').hue === 40 && q.hue === A.hash('obfuscation') % 360, 'palette hues');
  ['--vn-bg', '--vn-bg-2', '--vn-ink', '--vn-ink-2', '--vn-accent', '--vn-box', '--vn-skin-1', '--vn-skin-5', '--vn-art-dark', '--vn-art-light', '--vn-art-line'].forEach(function (k) {
    ok(p.light[k] && p.dark[k], 'palette defines ' + k + ' in both themes');
  });
  ok(A.hash('') === 0x811c9dc5 && A.hash('a') === 0xe40c292c, 'fnv1a vectors');
  var r = A.rng(1); var v = r();
  ok(v > 0 && v < 1 && A.rng(1)() === v, 'mulberry32 deterministic');
  ok(/@misc\{[a-z0-9]+,/.test(A.bibtex({ title: 'T', authors: 'Jack V. Le†', arxiv: '2606.31725' })), 'bibtex shape');
  ok(A.esc('<a href="x">&\'') === '&lt;a href=&quot;x&quot;&gt;&amp;&#39;', 'esc');
})();

if (update) {
  var lines = Object.keys(fresh).map(function (k) { return "  '" + k + "': [" + fresh[k][0] + ", '" + fresh[k][1] + "']"; });
  var src = fs.readFileSync(__filename, 'utf8');
  var start = src.indexOf('var SNAPSHOTS = {'), end = src.indexOf('};', start) + 2;
  src = src.slice(0, start) + 'var SNAPSHOTS = {\n' + lines.join(',\n') + '\n};' + src.slice(end);
  fs.writeFileSync(__filename, src.replace(/\r\n/g, '\n'));
  console.log('  pinned ' + lines.length + ' snapshots');
}
// =================== END ART SNAPSHOT TESTS ===================

console.log(passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
