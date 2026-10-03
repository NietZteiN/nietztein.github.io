/*
 * Paper Theatre - art snapshot tests (Node only, no DOM).
 *
 *   "C:\Program Files\nodejs\node.exe" misc/55-paper-theatre/test-art.js
 *   "C:\Program Files\nodejs\node.exe" misc/55-paper-theatre/test-art.js --update   (re-pin snapshots)
 *
 * Every builder is called with fixed inputs; the test pins the output length and
 * an fnv1a hash of the string, then checks a few structural invariants (eight
 * swappable faces, shared filters referenced by id and never redefined, a
 * hidden table under every chart, balanced tags, no NaN). Scenery and sprites
 * are painted in literal colours on purpose (each scene keeps its own hour
 * whatever the UI theme), so only the HTML boards are checked for var() colours.
 * When the art changes deliberately, re-pin with --update and say so in the commit.
 */
'use strict';
var path = require('path');
var fs = require('fs');
var A = require(path.join(__dirname, 'art.js'));

// ===================== ART SNAPSHOT TESTS =====================
var SNAPSHOTS = {
  'bg:lab': [28103, '6df50513'],
  'bg:office': [61671, '51949c68'],
  'bg:lecture': [12447, '7795601f'],
  'bg:server': [76688, '3290f5a8'],
  'bg:library': [85878, 'ded82e81'],
  'bg:night': [163685, '4b82f76b'],
  'bg:cafe': [74285, '00da0574'],
  'bg:terminal': [46560, '674c0ce0'],
  'bg:paper': [23326, '5350b628'],
  'bg:train': [19298, '114c411c'],
  'bg:garden': [96721, '5d9acdae'],
  'bg:void': [3803, 'ce086acb'],
  'bg:sakura': [259793, 'c2ac627f'],
  'bg:classroom': [63150, '20024155'],
  'bg:rooftop': [13060, 'afa86013'],
  'bg:corridor': [8049, '5417f3e1'],
  'bg:station': [22184, 'c51befff'],
  'bg:sea': [39661, 'bab8d13a'],
  'bg:room': [35930, '4e63b45d'],
  'bg:studio': [58128, '1170da6d'],
  'bg:basement': [31162, '6badfea3'],
  'bg:lab:night': [45132, '11a19509'],
  'bg:lab:dawn': [28451, '3b071846'],
  'bg:lab:dim': [28193, '9c4d7a22'],
  'bg:lab:dusk': [37891, '9060bc0c'],
  'bg:lab:noon': [28119, 'e346ffc9'],
  'bg:library:spines': [88463, 'b7beef42'],
  'bg:unknown': [3803, 'ce086acb'],
  'bg:night:overcast': [146766, '0a6d3f19'],
  'bg:room:overcast': [33281, '69f61d10'],
  'bg:classroom:text': [65250, 'ba40cdcb'],
  'cg:two-chairs:night': [28076, '69a604ae'],
  'cg:corridor-light:day': [8931, '1152ec74'],
  'cg:window-rain:dusk': [48765, '55bbc5c6'],
  'cg:desk-night:overcast': [29400, 'b64224f9'],
  'cg:screen-code:text': [17266, '507bfd3a'],
  'sprite:masc:shirt:dark': [43099, 'd71d515a'],
  'sprite:jack:neutral': [42756, '4b2b3cc7'],
  'sprite:jack:smile': [42754, '79096cfa'],
  'sprite:jack:puzzled': [42756, '8af7c88a'],
  'sprite:jack:worried': [42756, '06f345c6'],
  'sprite:jack:surprised': [42758, '9e5ad9b5'],
  'sprite:jack:thinking': [42757, '95009cb4'],
  'sprite:jack:deadpan': [42756, '5d29d5c5'],
  'sprite:jack:laugh': [42754, '62a626bd'],
  'sprite:hair:short': [43555, '110eb009'],
  'sprite:hair:long': [44970, '78b9f31c'],
  'sprite:hair:bob': [41624, 'c741c51f'],
  'sprite:hair:ponytail': [45214, 'ff83004f'],
  'sprite:hair:bun': [43410, '51b1371c'],
  'sprite:hair:curly': [48075, '4af871fd'],
  'sprite:hair:none': [40806, '6b64e067'],
  'sprite:hair:hood': [42882, 'e7243994'],
  'sprite:clothes:coat': [42042, '70439673'],
  'sprite:clothes:hoodie': [41012, '172093f7'],
  'sprite:clothes:cardigan': [43877, 'fb84d1e1'],
  'sprite:clothes:shirt': [42365, 'f4bef444'],
  'sprite:clothes:uniform': [43621, '00f18155'],
  'cg:tree': [110707, '2d09d62c'],
  'cg:desk-night': [34203, '1b3b9c4d'],
  'cg:screen-code': [17271, 'afcf46cb'],
  'cg:hands-keyboard': [24193, '14fb4f1c'],
  'cg:two-chairs': [21179, 'e42c8f9e'],
  'cg:corridor-light': [9014, 'e318483f'],
  'cg:sea-of-points': [206180, '6af48e26'],
  'cg:page': [17918, 'e58c4066'],
  'cg:window-rain': [48747, '3d3e183d'],
  'cg:unknown': [2553, '68ade5b3'],
  'fx:petals': [16547, '1b9ed2a3'],
  'fx:snow': [24001, '564e3b77'],
  'fx:rain': [66558, 'dfefe0e0'],
  'fx:dust': [5744, '7e58836d'],
  'fx:fireflies': [2788, '1c532f67'],
  'sharedDefs': [4895, 'd4820fc4'],
  'lattice:sparse': [21725, 'b8c5815e'],
  'lattice:dense': [31129, 'd3fd2e43'],
  'player': [1090, '545a4782'],
  'page': [6110, 'c80485ac'],
  'card': [498, '309f3057'],
  'chart:bar': [4163, '4ce89530'],
  'chart:range': [5570, '6b8e34c3'],
  'code': [498, '6f443bd2'],
  'scene': [1048, 'c0fc2a7c'],
  'endCard': [1338, '236be0b2'],
  'castGrid': [524944, '04c9fa77'],
  'palette:slate:light': [372, 'a873ef31'],
  'palette:hue:dark': [409, '6e38266c']
};

var CAST = {
  jack: { id: 'Jack', name: 'Jack', hue: 210, skin: 2, hair: 'short', clothes: 'coat', glasses: true },
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
CASES['bg:night:overcast'] = function () { return A.background('night', null, { overcast: true }); };
CASES['bg:room:overcast'] = function () { return A.background('room', 'night', { overcast: true }); };
CASES['bg:classroom:text'] = function () { return A.background('classroom', null, { board: 'text' }); };
CASES['cg:two-chairs:night'] = function () { return A.cg('two-chairs', 'night'); };
CASES['cg:corridor-light:day'] = function () { return A.cg('corridor-light', 'day'); };
CASES['cg:window-rain:dusk'] = function () { return A.cg('window-rain', 'dusk'); };
CASES['cg:desk-night:overcast'] = function () { return A.cg('desk-night', null, { overcast: true }); };
CASES['cg:screen-code:text'] = function () { return A.cg('screen-code', null, { text: 'total' }); };
CASES['sprite:masc:shirt:dark'] = function () { return A.sprite({ id: 'M', hair: 'short', clothes: 'shirt', build: 'masc', skin: 2, hue: 210, hairhue: 25, hairtone: 'dark' }, 'neutral'); };
A.FACES.forEach(function (f) { CASES['sprite:jack:' + f] = function () { return A.sprite(CAST.jack, f); }; });
A.HAIR.forEach(function (h) { CASES['sprite:hair:' + h] = function () { return A.sprite({ id: 'H-' + h, hair: h, hat: true, skin: 3 }, 'smile'); }; });
A.CLOTHES.forEach(function (k) { CASES['sprite:clothes:' + k] = function () { return A.sprite({ id: 'C-' + k, hair: 'bob', clothes: k, skin: 2, hue: 200 }, 'neutral'); }; });
A.CGS.forEach(function (n) { CASES['cg:' + n] = function () { return A.cg(n); }; });
CASES['cg:unknown'] = function () { return A.cg('dragon'); };
A.FX.forEach(function (n) { CASES['fx:' + n] = function () { return A.fx(n); }; });
CASES['sharedDefs'] = function () { return A.sharedDefs(); };
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

var failures = 0, passes = 0, SHARED = A.sharedDefs();
function fail(msg) { failures++; console.log('  FAIL ' + msg); }
function ok(cond, msg) { if (cond) passes++; else fail(msg); }

function hex(s) { return ('00000000' + A.hash(s).toString(16)).slice(-8); }

function checkInvariants(name, s) {
  ok(typeof s === 'string' && s.length > 0, name + ': non-empty string');
  // every colour is a #rrggbb literal, a var(), a gradient/pattern reference or none
  var m = s.match(/(?:fill|stroke|stop-color|flood-color)="(?!#[0-9a-f]{6}"|var\(|none"|url\(#|currentColor")[^"]*"/g);
  ok(!m, name + ': malformed colour ' + (m ? m[0] : ''));
  // filters are shared: only sharedDefs may define one, everything else refers to vnf-* by id
  if (name !== 'sharedDefs') ok(s.indexOf('<filter') < 0, name + ': defines its own <filter>');
  var refs = s.match(/url\(#vnf-[a-z0-9-]+\)/g) || [];
  refs.forEach(function (r) { ok(SHARED.indexOf('id="' + r.slice(5, -1) + '"') >= 0, name + ': unknown shared filter ' + r); });
  ok(!/NaN|undefined/.test(s), name + ': contains NaN/undefined');
  // balanced svg/g/div tags
  ['svg', 'g', 'div', 'figure', 'table', 'filter', 'clipPath', 'linearGradient', 'radialGradient', 'text'].forEach(function (t) {
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
  ok(/#f4d5bc/.test(sp), 'skin=2 uses the second skin tone');
  ok(/viewBox="0 0 600 1000"/.test(sp) && /data-clothes="coat"/.test(sp) && /url\(#vnf-rim\)/.test(sp), 'person sprite: tall box, clothes recorded, rim-light filter');
  ok((sp.match(/class="vn-face[^"]*is-on/g) || []).length === 1 && (sp.match(/class="vn-face vn-face-[a-z]+" opacity="0"/g) || []).length === 7, 'exactly one face visible without CSS');
  ok(A.normCast({ id: 'x', hair: 'bob', clothes: 'uniform' }).clothes === 'uniform' && A.HAIR.indexOf('ponytail') >= 0 && A.CLOTHES.length === 5, 'cast options: hair and clothes lists');
  ok(/data-kind="person"/.test(A.sprite({ id: 'Old', hair: 'short', glasses: true, hat: true }, 'nope')) && /vn-face-neutral is-on/.test(A.sprite({ id: 'Old' }, 'nope')), 'old declarations still draw; unknown face falls back to neutral');
  var la = CASES['lattice:sparse']();
  ok((la.match(/<g data-face="/g) || []).length === 8, 'lattice has 8 face groups');
  ok(/data-lattice="sparse"/.test(la) && /data-lattice="dense"/.test(CASES['lattice:dense']()), 'lattice density attribute');
  ok(/url\(#vnf-glow\)/.test(la) && la.indexOf('<filter') < 0, 'lattice glows through the shared filter');
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
  ok(A.BACKGROUNDS.length === 21 && ['sakura', 'classroom', 'rooftop', 'corridor', 'station', 'sea', 'room', 'studio', 'basement'].every(function (n) { return A.BACKGROUNDS.indexOf(n) >= 0; }), 'twenty-one backgrounds');
  // options added in the QA pass: every default stays byte-identical, the options repaint
  ok(A.background('room', 'night', {}) === A.background('room', 'night') && A.cg('desk-night', null, {}) === A.cg('desk-night') && A.cg('two-chairs', 'dusk') === A.cg('two-chairs'), 'empty options and the default hour change nothing');
  ok(/data-sky="overcast"/.test(A.background('night', null, { overcast: true })) && A.background('night', null, { overcast: true }).length < A.background('night').length - 5000, 'overcast: the night sky loses its stars and moon');
  ok(A.background('lab', 'noon', { overcast: true }).replace(' data-sky="overcast"', '') === A.background('lab', 'noon'), 'overcast changes nothing where there is no moon or star to hide');
  ok(A.cg('desk-night', null, { overcast: true }) !== A.cg('desk-night') && A.cg('sea-of-points', null, { overcast: true }) === A.cg('sea-of-points'), 'overcast reaches the desk-night window, never the sea of points');
  ok(/data-tod="night"/.test(A.cg('two-chairs', 'night')) && /data-tod="day"/.test(A.cg('corridor-light', 'day')) && /data-tod="dusk"/.test(A.cg('window-rain', 'dusk')) && /data-tod="night"/.test(A.cg('screen-code', 'day')), 'cg hour: the CGs with a sky follow the modifier, the others keep their own');
  ok(/>total<\/text>/.test(A.cg('screen-code', null, { text: 'total' })) && !/_lastNSecs/.test(A.cg('screen-code', null, { text: 'total' })), 'screen-code shows the identifier it is given');
  ok(A.background('classroom', null, { board: 'text' }) !== A.background('classroom') && A.background('classroom', null, { board: 'plot' }) === A.background('classroom') && A.background('lecture', null, { board: 'blank' }) !== A.background('lecture'), 'blackboard options');
  ok(A.INDOOR.lab && A.INDOOR.basement && !A.INDOOR.sakura && !A.INDOOR.night && !A.INDOOR.station, 'indoor scenes are listed');
  (function () {
    var base = { id: 'T', hair: 'short', clothes: 'shirt', skin: 2, hue: 200 };
    var n = function (o) { return A.normCast(Object.assign({}, base, o)); };
    ok(n({ hairhue: 25 }).hairCol === A.hslHex(25, 40, 46), 'hairhue alone keeps the old bright tone');
    ok(n({ hairhue: 25, hairtone: 'dark' }).hairCol === A.hslHex(25, 30, 19) && n({ hairhue: 25, hairtone: 'fair' }).hairCol === A.hslHex(25, 46, 68), 'hairtone sets the depth of a hairhue');
    ok(n({ hairtone: 'dark' }).hairHue === n({}).hairHue && n({ hairtone: 'dark' }).hairCol !== n({ hairtone: 'fair' }).hairCol, 'hairtone alone keeps the hashed hue');
    ok(n({ hairtone: 'purple' }).hairCol === n({}).hairCol, 'unknown hairtone is ignored');
    var masc = A.sprite(Object.assign({ build: 'masc' }, base), 'neutral'), neutral = A.sprite(base, 'neutral');
    ok(masc.length > neutral.length && /class="vn-fig"/.test(masc), 'masc + shirt wears a tie; the figure has its own group inside the lit one');
  })();
  ok(A.background('lab').indexOf('data-tod="day"') > 0 && A.background('lab', 'night').indexOf('data-tod="night"') > 0 && A.background('room').indexOf('data-tod="night"') > 0 && A.background('lab', 'dim').indexOf('data-tod="day"') > 0, 'time of day: default, modifier, dim keeps the hour');
  ok(A.timeOf('station') === 'dusk' && A.timeOf('station', 'noon') === 'day' && A.timeOf('sea', 'dawn') === 'dawn', 'timeOf');
  ok(A.background('sakura') !== A.background('sakura', 'dusk') && A.background('sakura') === A.background('sakura'), 'modifiers repaint; same input, same output');
  ok(A.CGS.join() === 'tree,desk-night,screen-code,hands-keyboard,two-chairs,corridor-light,sea-of-points,page,window-rain', 'the nine named CGs');
  ok(/data-cg="tree"/.test(A.cg('tree')) && /data-cg="fallback"/.test(A.cg('dragon')) && /_lastNSecs/.test(A.cg('screen-code')), 'cg: known, fallback, the highlighted identifier');
  ok(A.FX.join() === 'petals,snow,rain,dust,fireflies' && A.fx('nope') === '' && /class="vn-fx vn-fx-petals" data-fx="petals"/.test(A.fx('petals')) && (A.fx('petals').match(/vn-fx-layer/g) || []).length === 3, 'fx layers');
  ['vnf-b2', 'vnf-b8', 'vnf-b40', 'vnf-glow', 'vnf-paint', 'vnf-cloud', 'vnf-rim', 'vnf-rim-dusk', 'vnf-rim-dawn', 'vnf-rim-night'].forEach(function (id) { ok(SHARED.indexOf('id="' + id + '"') > 0, 'sharedDefs defines ' + id); });
  ok(A.mix('#000000', '#ffffff', 0.5) === '#808080' && A.mul('#ff8000', '#808080') === '#804000' && A.hslHex(0, 100, 50) === '#ff0000', 'colour maths');
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
