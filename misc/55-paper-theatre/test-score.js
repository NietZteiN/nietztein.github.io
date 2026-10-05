/*
 * node misc/55-paper-theatre/test-score.js : tests for score.js (VNScore), the pure half of the sound.
 * Prints PASS / FAIL lines and a summary; exit code 1 on any failure.
 *
 * Passing tones: none are allowed. Every note score.js writes (bars, menu holds, resolutions, stings) must be a
 * pitch class of the cue's diatonic scale, and lie in MIDI 33..96.
 */
'use strict';
var fs = require('fs');
var path = require('path');
var HERE = __dirname;
var VN = require('./vn.js');
var ART = require('./art.js');
var SC = require('./score.js');

var passed = 0, failed = 0, section = '';
function ok(cond, msg) {
  if (cond) { passed++; return true; }
  failed++; console.log('FAIL [' + section + '] ' + msg); return false;
}
function eq(a, b, msg) { return ok(JSON.stringify(a) === JSON.stringify(b), msg + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); }
function pass(msg) { console.log('PASS [' + section + '] ' + msg); }

function load(id, file) {
  var full = path.join(HERE, 'stories', file);
  return VN.parse(fs.readFileSync(full, 'utf8'), { id: id, resolveInclude: function (rel) {
    var f = path.join(path.dirname(full), rel); return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null;
  } });
}
function hintsFor(state, extra) {
  var bg = state.bg || { name: 'void', mod: null };
  var h = { hour: ART.timeOf(bg.name, bg.mod) || null, indoor: !!ART.INDOOR[bg.name] };
  if (extra) for (var k in extra) h[k] = extra[k];
  return h;
}
function baseState(over) {
  var s = { pc: 0, vars: {}, bg: { name: 'room', mod: null }, slots: {}, faces: {}, dist: {}, chosen: {}, cg: null, transition: null,
    change: null, flashback: null, mode: 'adv', pageStart: 0, fx: {}, oneshot: [], tone: 'none', music: 'auto', ambience: 'auto',
    sfx: [], chapter: null, history: [], choiceLog: [], label: null, stops: 1 };
  for (var k in over) s[k] = over[k];
  return s;
}
var SAY = { kind: 'say', who: 'Jack', key: 'jack', text: 'x', line: 1 };
var manifest = JSON.parse(fs.readFileSync(path.join(HERE, 'stories', 'index.json'), 'utf8'));
var published = manifest.filter(function (m) { return m.status === 'published'; });
var programs = published.map(function (m) { return load(m.id, m.file); });

// every note of a list must be well-formed, in range and diatonic
function checkNotes(notes, c, where) {
  var bad = notes.filter(function (n) {
    return !(typeof n.t === 'number' && n.t >= 0 && n.t < c.beats + 1e-9 && n.d > 0 && n.midi >= 33 && n.midi <= 96 &&
      n.midi === Math.round(n.midi) && n.vel > 0 && n.vel <= 1 && SC.VOICES.indexOf(n.voice) >= 0 && c.scale.indexOf(n.midi % 12) >= 0);
  });
  return ok(bad.length === 0, where + ': bad notes ' + JSON.stringify(bad.slice(0, 3)));
}

/* ------------------------------------------------------------------ constants */
section = 'api';
eq(SC.TRACKS, ['theme', 'nocturne', 'tender', 'memory', 'cold', 'tension', 'bright', 'finale'], 'TRACKS');
eq(SC.TRACKS, VN.MUSIC, 'TRACKS equal VN.MUSIC');
eq(SC.AMBIENCE, VN.AMBIENCE, 'AMBIENCE equal VN.AMBIENCE');
['theme', 'cue', 'bar', 'holdBar', 'resolveBar', 'sting'].forEach(function (f) { ok(typeof SC[f] === 'function', f + ' is a function'); });
ok(SC.cue(null, SAY, programs[0], {}) === null, 'cue(null state) is null');
eq(SC.bar(null, 0), [], 'bar(null) is empty');
pass('api');

/* ------------------------------------------------------------------ themes */
section = 'theme';
ok(programs.length === 10, 'ten published stories (got ' + programs.length + ')');
var sigs = programs.map(function (p) {
  var th = SC.theme(p);
  ok(th.bars.length === 8, p.id + ': eight bars');
  ok(th.tempo >= 56 && th.tempo <= 76, p.id + ': tempo 56..76 (' + th.tempo + ')');
  ok(th.beats === 3 || th.beats === 4, p.id + ': three or four beats');
  ok(SC.MODES[th.mode], p.id + ': known mode');
  // mostly stepwise: count leaps (more than a third) between consecutive melody notes inside the eight bars
  var degs = [];
  th.bars.forEach(function (b) { b.notes.forEach(function (n) { degs.push(n.deg); }); });
  var leaps = 0, steps = 0;
  for (var i = 1; i < degs.length; i++) { var dd = Math.abs(degs[i] - degs[i - 1]); if (dd > 2) leaps++; else if (dd >= 1) steps++; }
  // the generator allows two free leaps; the return to the opening at bar 5 and the two cadence approaches may add
  // up to three more, so five is the bound over all consecutive notes of the eight bars
  ok(leaps <= 5, p.id + ': at most five leaps larger than a third, counting the recall and the cadences (' + leaps + ')');
  ok(steps >= leaps, p.id + ': more steps than leaps');
  var last = th.bars[7].notes[th.bars[7].notes.length - 1].deg;
  ok([1, 6, 4].indexOf(((last % 7) + 7) % 7) >= 0, p.id + ': ends on the second, seventh or fifth degree (a note that wants to resolve)');
  ok(th.bars[0].root === 0, p.id + ': begins on the tonic chord');
  ok(th.bars.every(function (b) { return b.notes.length >= 1 && b.notes.length <= 4; }), p.id + ': one to four melody notes per bar');
  // determinism: a fresh parse gives the same theme
  var again = SC.theme(load(p.id, published.filter(function (m) { return m.id === p.id; })[0].file));
  eq(JSON.stringify(again), JSON.stringify(th), p.id + ': same theme twice');
  return JSON.stringify([th.tonicMidi, th.mode, th.beats, th.bars.map(function (b) { return b.notes.map(function (n) { return n.deg + '@' + n.t; }); })]);
});
var distinct = {};
sigs.forEach(function (s) { distinct[s] = 1; });
eq(Object.keys(distinct).length, 10, 'the ten published stories have ten different themes');
var keysUsed = {};
programs.forEach(function (p) { keysUsed[SC.theme(p).tonicPc + SC.theme(p).mode] = 1; });
ok(Object.keys(keysUsed).length >= 6, 'at least six different keys and modes among the ten (' + Object.keys(keysUsed).length + ')');
// a program with no id falls back to the title, and still works with nothing at all
ok(SC.theme({ meta: { title: 'A' } }).bars.length === 8, 'a one-letter title still makes eight bars');
ok(SC.theme(null).bars.length === 8, 'theme(null) works');
pass('themes');

/* ------------------------------------------------------------------ bars: determinism, range, scale, density */
section = 'bars';
var MAX_PER_VOICE = 7, MAX_PER_BAR = 14, MAX_MEAN = 7.5;
programs.forEach(function (p) {
  SC.TRACKS.forEach(function (track) {
    var c = SC.cue(baseState({ music: track }), SAY, p, hintsFor(baseState({})));
    ok(c && c.track === track, p.id + ' ' + track + ': cue names the track');
    var total = 0, worstVoice = 0, worstBar = 0, i;
    for (i = 0; i < 40; i++) {
      var notes = SC.bar(c, i);
      eq(SC.bar(c, i), notes, p.id + ' ' + track + ' bar ' + i + ' deterministic');
      checkNotes(notes, c, p.id + ' ' + track + ' bar ' + i);
      var per = {};
      notes.forEach(function (n) { per[n.voice] = (per[n.voice] || 0) + 1; });
      for (var v in per) worstVoice = Math.max(worstVoice, per[v]);
      worstBar = Math.max(worstBar, notes.length);
      total += notes.length;
    }
    ok(worstVoice <= MAX_PER_VOICE, p.id + ' ' + track + ': at most ' + MAX_PER_VOICE + ' notes per voice per bar (' + worstVoice + ')');
    ok(worstBar <= MAX_PER_BAR, p.id + ' ' + track + ': at most ' + MAX_PER_BAR + ' notes per bar (' + worstBar + ')');
    ok(total / 40 <= MAX_MEAN, p.id + ' ' + track + ': at most ' + MAX_MEAN + ' notes per bar on average (' + (total / 40).toFixed(2) + ')');
    // the two bars of breath after each phrase are nearly empty
    ok(SC.bar(c, 8).length <= 5 && SC.bar(c, 9).length <= 2, p.id + ' ' + track + ': bars 8 and 9 breathe');
    // not a two-bar loop: bars 0..7 are not all equal to bars 2 apart
    var two = true;
    for (i = 0; i < 6; i++) if (JSON.stringify(SC.bar(c, i)) !== JSON.stringify(SC.bar(c, i + 2))) two = false;
    ok(!two, p.id + ' ' + track + ': does not repeat every two bars');
    checkNotes(SC.holdBar(c, 0).concat(SC.holdBar(c, 1), SC.holdBar(c, 2)), c, p.id + ' ' + track + ' hold');
    checkNotes(SC.resolveBar(c), c, p.id + ' ' + track + ' resolve');
    checkNotes(SC.sting(c, 'chapter'), c, p.id + ' ' + track + ' chapter sting');
    checkNotes(SC.sting(c, 'end').map(function (n) { return { t: n.t % c.beats, d: n.d, midi: n.midi, vel: n.vel, voice: n.voice }; }), c, p.id + ' ' + track + ' end sting');
  });
});
// finale ends with a real cadence: bar 7's last melody note is the tonic, over the tonic chord
programs.forEach(function (p) {
  var c = SC.cue(baseState({ music: 'finale' }), SAY, p, {});
  var b7 = SC.bar(c, 7).filter(function (n) { return n.voice === 'piano'; });
  var top = b7.reduce(function (a, n) { return n.midi > a.midi ? n : a; }, b7[0]);
  // the highest piano note that starts after the downbeat is the melody's last note
  var lastTop = b7.filter(function (n) { return n.t > 0; }).reduce(function (a, n) { return n.midi > a.midi ? n : a; }, { midi: 0 });
  ok(lastTop.midi % 12 === c.tonic % 12, p.id + ': finale cadence lands on the tonic');
  ok(top, p.id + ': finale bar 7 has piano notes');
});
// memory is the theme an octave up on the music box, slower
programs.forEach(function (p) {
  var th = SC.theme(p);
  var cm = SC.cue(baseState({ music: 'memory' }), SAY, p, {}), ct = SC.cue(baseState({ music: 'theme' }), SAY, p, {});
  ok(cm.tempo < ct.tempo, p.id + ': memory is slower than the theme');
  var mel = SC.bar(cm, 0).filter(function (n) { return n.voice === 'musicbox'; })[0];
  ok(mel && mel.midi > SC.deg2midi(th, th.bars[0].notes[0].deg), p.id + ': memory melody above the theme');
  eq(cm.filter, 'tape', p.id + ': memory goes through the tape');
});
// the register: every theme's melody is centred near the G above middle C, and the left hand stays under it
programs.forEach(function (p) {
  var th = SC.theme(p), sum = 0, w = 0, lo = 127, hi = 0;
  th.bars.forEach(function (b) { b.notes.forEach(function (n) { var m = SC.deg2midi(th, n.deg); sum += m * n.d; w += n.d; lo = Math.min(lo, m); hi = Math.max(hi, m); }); });
  ok(Math.abs(sum / w - 67) <= 6, p.id + ': melody centred within a tritone of G4 (mean ' + (sum / w).toFixed(1) + ')');
  ok(lo >= 52 && hi <= 84, p.id + ': melody between E3 and C6 (' + lo + '..' + hi + ')');
  ['theme', 'finale', 'bright'].forEach(function (track) {
    var c = SC.cue(baseState({ music: track }), SAY, p, {}), crossed = [];
    for (var i = 0; i < 7; i++) {
      var notes = SC.bar(c, i), mel = th.bars[i].notes.map(function (n) { return SC.deg2midi(th, n.deg); });
      var low = Math.min.apply(null, mel);
      notes.forEach(function (n) { if (mel.indexOf(n.midi) < 0 && n.voice !== 'pad' && n.midi >= low) crossed.push(i + ':' + n.midi); });
    }
    eq(crossed, [], p.id + ' ' + track + ': the accompaniment never reaches the melody\'s lowest note in a bar');
  });
});
// the long form: forty bars before anything returns, for the tracks that carry the melody
programs.forEach(function (p) {
  var th = SC.theme(p);
  ['theme', 'tender', 'memory', 'bright'].forEach(function (track) {
    var c = SC.cue(baseState({ music: track }), SAY, p, {}), i, same40 = true, same10 = true, same20 = true;
    for (i = 0; i < 40; i++) {
      if (JSON.stringify(SC.bar(c, i)) !== JSON.stringify(SC.bar(c, i + 40))) same40 = false;
      if (JSON.stringify(SC.bar(c, i)) !== JSON.stringify(SC.bar(c, (i + 10) % 40))) same10 = false;
      if (JSON.stringify(SC.bar(c, i)) !== JSON.stringify(SC.bar(c, (i + 20) % 40))) same20 = false;
    }
    ok(same40, p.id + ' ' + track + ': the form returns after forty bars');
    ok(!same10 && !same20, p.id + ' ' + track + ': and not after ten or twenty');
    var voice = track === 'memory' ? 'musicbox' : track === 'bright' ? 'pluck' : 'piano';
    function top(i) { return SC.bar(c, i).filter(function (n) { return n.voice === voice && n.midi >= (track === 'memory' ? 67 : SC.deg2midi(th, -2)) && n.midi > 59; }).length; }
    // second pass: bars 14, 15, 16 carry no melody (fewer notes than the same bars of the first pass)
    ok(SC.bar(c, 14).length < SC.bar(c, 4).length && SC.bar(c, 15).length < SC.bar(c, 5).length, p.id + ' ' + track + ': the second pass leaves the answer to the harmony');
    ok(JSON.stringify(SC.bar(c, 17)) === JSON.stringify(SC.bar(c, 7)) || SC.bar(c, 17).length === SC.bar(c, 7).length, p.id + ' ' + track + ': but its last bar comes back');
    ok(SC.bar(c, 31).length <= SC.bar(c, 1).length && top(31) <= top(1), p.id + ' ' + track + ': the fourth pass is the harmony with single held notes');
  });
  var cf = SC.cue(baseState({ music: 'finale' }), SAY, p, {});
  eq(SC.bar(cf, 12), SC.bar(cf, 2), p.id + ': the finale is the whole theme on every pass');
  // the nocturne (the track the night scenes spend longest in) has four passes too
  var cn = SC.cue(baseState({ music: 'nocturne' }), SAY, p, {});
  function pass(k) { var s = []; for (var i = 0; i < 10; i++) s.push(SC.bar(cn, k * 10 + i)); return JSON.stringify(s); }
  ok(pass(0) !== pass(1) && pass(0) !== pass(2) && pass(0) !== pass(3) && pass(1) !== pass(2) && pass(1) !== pass(3) && pass(2) !== pass(3), p.id + ' nocturne: four different passes');
  eq(pass(4), pass(0), p.id + ' nocturne: the fifth pass is the first again');
  var n3 = 0, n0 = 0;
  for (var j = 0; j < 10; j++) { n3 += SC.bar(cn, 30 + j).length; n0 += SC.bar(cn, j).length; }
  ok(n3 < n0 && n3 <= 10, p.id + ' nocturne: the fourth pass is almost silence (' + n3 + ' notes in ten bars, ' + n0 + ' in the first pass)');
});
// intensity thins the bars
(function () {
  var p = programs[0];
  var full = SC.cue(baseState({}), SAY, p, { hour: 'night', indoor: true });
  var thin = SC.cue(baseState({}), { kind: 'chapter', n: '1', title: '', line: 1 }, p, { hour: 'night', indoor: true });
  var nf = 0, nt = 0;
  for (var i = 0; i < 20; i++) { nf += SC.bar(full, i).length; nt += SC.bar(thin, i).length; }
  ok(nt < nf, 'a chapter card thins the music (' + nt + ' < ' + nf + ')');
  eq(thin.key, full.key, 'a chapter card keeps the key (no crossfade, only thinner)');
  var wh = SC.cue(baseState({}), { kind: 'withheld', text: '', line: 1 }, p, { hour: 'night', indoor: true });
  var nw = 0;
  for (i = 0; i < 20; i++) nw += SC.bar(wh, i).length;
  ok(nw < nt, 'a withheld ending is thinner still (' + nw + ')');
})();
pass('bars');

/* ------------------------------------------------------------------ the auto rules, as a table */
section = 'auto';
var P = programs[0];
var MENU = { kind: 'menu', options: [], key: 'x', line: 1 };
var END = { kind: 'end', implicit: true, line: 1 };
var TABLE = [
  // [what, state overrides, op, hints, track, ambience]
  ['room at night', { bg: { name: 'room', mod: 'night' } }, SAY, null, 'nocturne', ['room']],
  ['lab at night', { bg: { name: 'lab', mod: 'night' }, tone: 'night' }, SAY, null, 'nocturne', ['hum']],
  ['server', { bg: { name: 'server', mod: null } }, SAY, null, 'nocturne', ['hum']],
  ['server, tone cold', { bg: { name: 'server', mod: null }, tone: 'cold' }, SAY, null, 'cold', ['hum']],
  ['terminal', { bg: { name: 'terminal', mod: null } }, SAY, null, 'nocturne', ['hum']],
  ['basement', { bg: { name: 'basement', mod: null } }, SAY, null, 'nocturne', ['hum']],
  ['lab by day', { bg: { name: 'lab', mod: null } }, SAY, null, 'theme', ['hum']],
  ['lecture by day', { bg: { name: 'lecture', mod: null } }, SAY, null, 'theme', ['crowd']],
  ['cafe at dusk (still full)', { bg: { name: 'cafe', mod: null } }, SAY, null, 'tender', ['crowd']],
  ['classroom at dusk', { bg: { name: 'classroom', mod: 'dusk' } }, SAY, null, 'tender', ['crowd']],
  ['classroom by day', { bg: { name: 'classroom', mod: null } }, SAY, null, 'theme', ['crowd']],
  ['lecture at night (empty hall)', { bg: { name: 'lecture', mod: 'night' } }, SAY, null, 'nocturne', ['room']],
  ['office at night', { bg: { name: 'office', mod: 'night' } }, SAY, null, 'nocturne', ['room']],
  ['studio at dusk', { bg: { name: 'studio', mod: 'dusk' } }, SAY, null, 'tender', ['room']],
  ['rooftop at dawn', { bg: { name: 'rooftop', mod: 'dawn' } }, SAY, null, 'tender', ['wind']],
  ['rooftop by day', { bg: { name: 'rooftop', mod: null } }, SAY, null, 'bright', ['wind']],
  ['sakura by day', { bg: { name: 'sakura', mod: null } }, SAY, null, 'bright', ['wind']],
  ['garden at dusk', { bg: { name: 'garden', mod: 'dusk' } }, SAY, null, 'tender', ['wind']],
  ['night street', { bg: { name: 'night', mod: null } }, SAY, null, 'nocturne', ['night']],
  ['rooftop at night, cold', { bg: { name: 'rooftop', mod: 'night' }, tone: 'cold' }, SAY, null, 'cold', ['night']],
  ['sea at dusk', { bg: { name: 'sea', mod: 'dusk' } }, SAY, null, 'tender', ['sea']],
  ['sea by day', { bg: { name: 'sea', mod: null } }, SAY, null, 'bright', ['sea']],
  ['sea at night with snow', { bg: { name: 'sea', mod: 'night' }, fx: { snow: true } }, SAY, null, 'nocturne', ['wind', 'sea']],
  ['train', { bg: { name: 'train', mod: null } }, SAY, null, 'tender', ['train']],
  ['station', { bg: { name: 'station', mod: null } }, SAY, null, 'tender', ['train']],
  ['room with rain', { bg: { name: 'room', mod: 'night' }, fx: { rain: true } }, SAY, null, 'nocturne', ['rain']],
  ['lab with rain', { bg: { name: 'lab', mod: 'night' }, fx: { rain: true } }, SAY, null, 'nocturne', ['rain', 'hum']],
  ['garden with snow', { bg: { name: 'garden', mod: null }, fx: { snow: true } }, SAY, null, 'bright', ['wind']],
  ['petals and dust are silent', { bg: { name: 'room', mod: 'night' }, fx: { petals: true, dust: true } }, SAY, null, 'nocturne', ['room']],
  ['void', { bg: { name: 'void', mod: null } }, SAY, null, 'nocturne', []],
  ['no background at all', { bg: null }, SAY, { hour: null, indoor: false }, 'theme', []],
  ['paper', { bg: { name: 'paper', mod: null } }, SAY, null, 'bright', []],
  ['library, dim, tone dusk (the tone sets the hour)', { bg: { name: 'library', mod: 'dim' }, tone: 'dusk' }, SAY, null, 'tender', ['room']],
  ['library, tone noon', { bg: { name: 'library', mod: 'night' }, tone: 'noon' }, SAY, null, 'theme', ['room']],
  ['flashback', { bg: { name: 'room', mod: 'night' }, flashback: { caption: null } }, SAY, null, 'memory', ['room']],
  ['tone memory', { bg: { name: 'room', mod: 'night' }, tone: 'memory' }, SAY, null, 'memory', ['room']],
  ['flashback beats cold', { bg: { name: 'terminal', mod: null }, tone: 'cold', flashback: { caption: 'x' } }, SAY, null, 'memory', ['hum']],
  ['a CG keeps the place: window-rain in the lab', { bg: { name: 'lab', mod: 'night' }, cg: { name: 'window-rain', caption: null }, fx: { rain: true } }, SAY, null, 'nocturne', ['rain', 'hum']],
  ['a CG keeps the place: two-chairs by the sea', { bg: { name: 'sea', mod: 'night' }, cg: { name: 'two-chairs', caption: null } }, SAY, null, 'nocturne', ['sea']],
  ['menu keeps the track', { bg: { name: 'room', mod: 'night' } }, MENU, null, 'nocturne', ['room']],
  ['the end', { bg: { name: 'room', mod: 'night' } }, END, null, 'finale', ['room']],
  ['the end in a flashback is still the finale', { bg: { name: 'room', mod: 'night' }, flashback: {} }, END, null, 'finale', ['room']],
  ['title screen', { bg: { name: 'room', mod: 'night' } }, { kind: 'title', line: 0 }, { title: true }, 'theme', ['room']],
  ['@music off', { bg: { name: 'room', mod: 'night' }, music: 'off' }, SAY, null, null, ['room']],
  ['@music off at the end', { bg: { name: 'room', mod: 'night' }, music: 'off' }, END, null, null, ['room']],
  ['@music tension', { bg: { name: 'room', mod: 'night' }, music: 'tension' }, SAY, null, 'tension', ['room']],
  ['@music tension at the end stays', { bg: { name: 'room', mod: 'night' }, music: 'tension' }, END, null, 'tension', ['room']],
  ['@music bright in a flashback', { bg: { name: 'room', mod: 'night' }, music: 'bright', flashback: {} }, SAY, null, 'bright', ['room']],
  ['@ambience off', { bg: { name: 'sea', mod: 'night' }, ambience: 'off' }, SAY, null, 'nocturne', []],
  ['@ambience rain', { bg: { name: 'sea', mod: 'night' }, ambience: 'rain' }, SAY, null, 'nocturne', ['rain']],
  ['@ambience crowd at night', { bg: { name: 'room', mod: 'night' }, ambience: 'crowd' }, SAY, null, 'nocturne', ['crowd']]
];
TABLE.forEach(function (row) {
  var st = baseState(row[1]);
  var h = row[3] && row[3].hour !== undefined ? row[3] : hintsFor(st, row[3]);
  var c = SC.cue(st, row[2], P, h);
  ok(c !== null, row[0] + ': a cue');
  eq(c.track, row[4], row[0] + ': track');
  eq(c.ambience, row[5], row[0] + ': ambience');
});
eq(SC.cue(baseState({}), { kind: 'title', line: 0 }, P, { title: true }).intensity, 1, 'the title screen states the theme whole');
ok(SC.cue(baseState({}), { kind: 'chapter', n: '1', title: '', line: 1 }, P, {}).intensity < SC.cue(baseState({}), { kind: 'scene', title: '', line: 1 }, P, {}).intensity, 'a chapter card is thinner than a scene card');
ok(SC.cue(baseState({}), { kind: 'withheld', text: '', line: 1 }, P, {}).intensity < SC.cue(baseState({}), { kind: 'chapter', n: '1', title: '', line: 1 }, P, {}).intensity, 'a withheld ending is the thinnest');
ok(SC.cue(baseState({}), MENU, P, {}).hold === true, 'a menu sets hold');
ok(SC.cue(baseState({}), SAY, P, {}).hold === false, 'a line does not');
eq(SC.cue(baseState({ flashback: {} }), SAY, P, {}).filter, 'tape', 'a flashback goes through the tape');
eq(SC.cue(baseState({ flashback: {}, music: 'bright' }), SAY, P, {}).filter, 'tape', 'a named track in a flashback still goes through the tape');
eq(SC.cue(baseState({}), SAY, P, {}).filter, 'none', 'no filter otherwise');
var off = SC.cue(baseState({ music: 'off' }), SAY, P, {});
eq(SC.bar(off, 0), [], "@music off: no notes");
ok(off.track === null, "@music off: track null");
pass('auto rules (' + TABLE.length + ' rows)');

/* ------------------------------------------------------------------ the key */
section = 'key';
(function () {
  var states = [
    baseState({ bg: { name: 'room', mod: 'night' } }),
    baseState({ bg: { name: 'room', mod: 'night' }, tone: 'night' }),           // same sound
    baseState({ bg: { name: 'office', mod: 'night' } }),                         // same sound: room ambience, nocturne
    baseState({ bg: { name: 'room', mod: 'night' }, fx: { rain: true } }),       // ambience changes
    baseState({ bg: { name: 'room', mod: 'dusk' } }),                            // track changes
    baseState({ bg: { name: 'room', mod: 'night' }, flashback: {} }),            // track and filter change
    baseState({ bg: { name: 'room', mod: 'night' }, music: 'memory' }),          // filter tape, no flashback
    baseState({ bg: { name: 'room', mod: 'night' }, music: 'memory', flashback: {} }),
    baseState({ bg: { name: 'lab', mod: 'night' } }),
    baseState({ bg: { name: 'room', mod: 'night' }, music: 'off' }),
    baseState({ bg: { name: 'room', mod: 'night' }, music: 'off', ambience: 'off' }),
    baseState({ bg: { name: 'sea', mod: 'night' }, music: 'nocturne' })
  ];
  var ops = [SAY, MENU, { kind: 'chapter', n: '1', title: 't', line: 1 }, { kind: 'scene', title: 't', line: 1 }];
  var cues = [];
  [programs[0], programs[1]].forEach(function (p) {
    states.forEach(function (s) { ops.forEach(function (o) { cues.push(SC.cue(s, o, p, hintsFor(s))); }); });
  });
  var mism = 0, pairs = 0;
  for (var a = 0; a < cues.length; a++) for (var b = a + 1; b < cues.length; b++) {
    var A = cues[a], B = cues[b];
    var same = A.track === B.track && A.ambience.join() === B.ambience.join() && A.filter === B.filter && A.seed === B.seed;
    pairs++;
    if (same !== (A.key === B.key)) mism++;
  }
  eq(mism, 0, 'key equal exactly when track, ambience, filter and seed are equal, over ' + pairs + ' pairs');
  ok(cues[0].seed !== cues[cues.length / 2].seed, 'two stories, two seeds for the same track');
  eq(SC.cue(states[0], SAY, P, {}).key, SC.cue(states[0], MENU, P, {}).key, 'a menu does not change the key');
  ok(SC.cue(states[0], SAY, P, hintsFor(states[0])).key !== SC.cue(states[3], SAY, P, hintsFor(states[3])).key, 'rain changes the key');
})();
pass('key');

/* ------------------------------------------------------------------ every published story, stop by stop */
section = 'walk';
published.forEach(function (m, idx) {
  var p = programs[idx], run = VN.createRun(p), s = run.advance(), n = 0, err = null, tracks = {}, ambs = {}, keys = 0, lastKey = null;
  var bad = [];
  try {
    while (s && n++ < 6000) {
      var st = s.state, h = hintsFor(st);
      var c = SC.cue(st, s.op, p, h);
      if (!c) bad.push(n + ': null cue');
      else {
        if (c.track !== null && SC.TRACKS.indexOf(c.track) < 0) bad.push(n + ': track ' + c.track);
        if (c.track === null && st.music !== 'off') bad.push(n + ': silent without @music off');
        if (!c.ambience.every(function (a) { return SC.AMBIENCE.indexOf(a) >= 0; })) bad.push(n + ': ambience ' + c.ambience);
        if (s.op.kind === 'menu' && !c.hold) bad.push(n + ': menu without hold');
        if (s.op.kind === 'end' && (st.music === 'auto') && c.track !== 'finale') bad.push(n + ': end without the finale');
        if (c.tempo < 52 || c.tempo > 76) bad.push(n + ': tempo ' + c.tempo);
        var notes = SC.bar(c, n % 10);
        notes.forEach(function (x) { if (c.scale.indexOf(x.midi % 12) < 0 || x.midi < 33 || x.midi > 96) bad.push(n + ': note ' + x.midi); });
        tracks[c.track] = (tracks[c.track] || 0) + 1;
        ambs[c.ambience.join('+') || '-'] = (ambs[c.ambience.join('+') || '-'] || 0) + 1;
        if (c.key !== lastKey) { keys++; lastKey = c.key; }
      }
      if (s.done) break;
      s = s.op.kind === 'menu' ? run.choose(0) : run.advance();
    }
  } catch (e) { err = e; }
  ok(!err, m.id + ': the walk throws ' + (err && err.stack));
  ok(s && s.done, m.id + ': reached the end');
  eq(bad.slice(0, 5), [], m.id + ': a sensible cue at every stop');
  ok(keys <= Math.max(6, n / 3), m.id + ': the music does not change at every line (' + keys + ' changes over ' + n + ' stops)');
  console.log('  ' + m.id + ': ' + n + ' stops, ' + keys + ' cue changes; tracks ' + JSON.stringify(tracks) + '; ambience ' + JSON.stringify(ambs));
});
pass('walk');

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
