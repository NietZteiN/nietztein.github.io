/*
 * score.js : the Paper Theatre's score, as pure data (window.VNScore, module.exports).
 *
 * No DOM, no Web Audio, no clock: the same inputs always give the same notes. audio.js plays what this file writes.
 *
 *   VNScore.TRACKS                       the eight tracks (VN.MUSIC)
 *   VNScore.theme(program)               the story's own motif: eight bars made from the letters of its title,
 *                                        in a key, mode, metre and tempo chosen from VN.rng(program.id || title)
 *   VNScore.cue(state, op, program, hints) -> cue | null   what should sound at this stop
 *   VNScore.bar(cue, i)                  -> [{t, d, midi, vel, voice}]   the notes of bar i (t, d in beats)
 *   VNScore.holdBar(cue, i)              a menu: an unresolved suspended chord, bar i of the wait
 *   VNScore.resolveBar(cue)              the menu is gone: the suspension resolves to the tonic
 *   VNScore.sting(cue, kind)             'chapter' (one low note) | 'end' (a V - I cadence)
 *
 * Every pitch is diatonic to the cue's scale (no chromatic passing tones at all) and lies in MIDI 33..96.
 */
(function (root, factory) {
  var VN = (typeof module === 'object' && module.exports) ? require('./vn.js') : root.VN;
  var api = factory(VN);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.VNScore = api;
}(typeof self !== 'undefined' ? self : this, function (VN) {
  'use strict';

  /* ------------------------------------------------------------------ seeded helpers */

  // the same fnv1a + mulberry32 as vn.js; used only when VN is not loaded
  function fnv1a(str) {
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return h >>> 0;
  }
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function rng(seed) {
    if (VN && VN.rng) return VN.rng(seed);
    return mulberry32(typeof seed === 'number' ? seed >>> 0 : fnv1a(seed));
  }
  function hash(str) { return (VN && VN.hash) ? VN.hash(str) : fnv1a(str); }
  function mod(a, n) { return ((a % n) + n) % n; }

  /* ------------------------------------------------------------------ constants */

  var TRACKS = ['theme', 'nocturne', 'tender', 'memory', 'cold', 'tension', 'bright', 'finale'];
  var AMBIENCE = ['rain', 'wind', 'sea', 'train', 'hum', 'crowd', 'night', 'room'];
  var VOICES = ['piano', 'pad', 'musicbox', 'pluck', 'bass', 'celesta'];

  var MODES = {
    ionian:     [0, 2, 4, 5, 7, 9, 11],
    dorian:     [0, 2, 3, 5, 7, 9, 10],
    aeolian:    [0, 2, 3, 5, 7, 8, 10],
    mixolydian: [0, 2, 4, 5, 7, 9, 10],
    lydian:     [0, 2, 4, 6, 7, 9, 11]
  };
  // weighted: mostly the minor-ish modes, as in the reference
  var MODE_BAG = ['aeolian', 'aeolian', 'aeolian', 'dorian', 'dorian', 'ionian', 'ionian', 'mixolydian', 'lydian'];

  // tempo of each track relative to the theme's tempo (bpm), then clamped to 56..76 (memory may sink to 52)
  var TEMPO = { theme: 1, nocturne: 0.9, tender: 0.95, memory: 0.84, cold: 0.88, tension: 1, bright: 1.08, finale: 0.97 };

  // melodic steps chosen by a letter (index = letter code mod 16): mostly steps, a few leaps of a third to a fifth
  var STEPS = [1, -1, 1, -1, 2, -2, 0, 1, -1, 3, -1, 1, -2, 2, -3, 4];

  // bar rhythms in beats; a negative number is a rest
  var RHYTHM = {
    4: { open: [[2, 2], [3, 1], [2, 1, 1], [1.5, 0.5, 2], [1, 1, 2], [2, -1, 1]],
         mid:  [[2, 2], [3, 1], [1, 1, 2], [2, 1, 1], [-1, 1, 2], [1.5, 0.5, 2], [4], [2, -1, 1], [-2, 2]],
         end:  [[4], [3, -1], [2, -2], [1, 3]] },
    3: { open: [[2, 1], [3], [1.5, 0.5, 1], [1, 2]],
         mid:  [[2, 1], [1, 1, 1], [1.5, 0.5, 1], [-1, 1, 1], [3], [1, 2]],
         end:  [[3], [2, -1], [1, 2]] }
  };

  var PHRASE = 8;          // bars of the theme
  var CYCLE = 10;          // the theme, then two bars of breath

  // places, for the ambience
  var INDOOR = { lab: 1, office: 1, lecture: 1, server: 1, library: 1, cafe: 1, train: 1, classroom: 1, corridor: 1, room: 1, studio: 1, basement: 1 };
  var HUM = { server: 1, lab: 1, terminal: 1, basement: 1 };
  var CROWD = { cafe: 1, lecture: 1, classroom: 1 };
  var TRAIN = { train: 1, station: 1 };
  var SILENT = { void: 1, paper: 1 };

  /* ------------------------------------------------------------------ the theme */

  function triadQuality(iv, r) {
    var a = iv[mod(r, 7)], b = iv[mod(r + 2, 7)] + (r + 2 >= 7 ? 12 : 0), c = iv[mod(r + 4, 7)] + (r + 4 >= 7 ? 12 : 0);
    var third = mod(b - a, 12), fifth = mod(c - a, 12);
    return fifth === 6 ? 'dim' : third === 4 ? 'maj' : 'min';
  }

  function deg2midi(th, d) {
    return th.tonicMidi + 12 * Math.floor(d / 7) + th.iv[mod(d, 7)];
  }

  // move a pitch by octaves into [lo, hi] (the range is at least an octave wide)
  function fit(m, lo, hi) {
    while (m < lo) m += 12;
    while (m > hi) m -= 12;
    return m;
  }

  var cache = {};

  function titleOf(program) {
    var p = program || {};
    return (p.meta && p.meta.title) || p.id || 'Paper Theatre';
  }

  function theme(program) {
    var p = program || {};
    var title = titleOf(p), id = p.id || title;
    var ck = id + '\n' + title;
    if (cache[ck]) return cache[ck];
    var r = rng(id);
    var modeName = MODE_BAG[Math.floor(r() * MODE_BAG.length)];
    var iv = MODES[modeName];
    var pc = Math.floor(r() * 12);
    var tonicMidi = 55 + mod(pc - 7, 12);                 // G3 .. F#4: the melody sits around middle C
    var beats = r() < 0.35 ? 3 : 4;
    var tempo = 58 + Math.floor(r() * 15);                 // 58..72
    var letters = String(title).toLowerCase().replace(/[^a-z]/g, '');
    if (letters.length < 4) letters = (letters + String(id).toLowerCase().replace(/[^a-z]/g, '') + 'paper').slice(0, 24);
    var li = Math.floor(r() * letters.length);
    function letter() { var c = letters.charCodeAt(li % letters.length); li++; return c; }

    var th = { id: id, title: title, mode: modeName, iv: iv, tonicPc: mod(tonicMidi, 12), tonicMidi: tonicMidi,
      scale: iv.map(function (x) { return mod(tonicMidi + x, 12); }), beats: beats, tempo: tempo, bars: [] };

    var R = RHYTHM[beats], leaps = 0, lastStep = 0;
    var d = [0, 2, 4, 2, 4][letter() % 5];               // the first note belongs to the tonic chord
    var bars = [];
    for (var b = 0; b < PHRASE; b++) {
      if (b === 4 || b === 5) { bars.push(copyBar(bars[b - 4])); d = bars[b].notes[bars[b].notes.length - 1].deg; continue; }
      var set = b === 0 ? R.open : (b === 3 || b === 7) ? R.end : R.mid;
      var rh = set[letter() % set.length];
      var notes = [], t = 0, first = true;
      for (var k = 0; k < rh.length; k++) {
        var dur = rh[k];
        if (dur < 0) { t += -dur; continue; }
        if (!(b === 0 && first)) {
          var step = STEPS[letter() % STEPS.length];
          if (Math.abs(step) >= 3) { if (leaps >= 2 || Math.abs(lastStep) >= 3) step = step > 0 ? 1 : -1; else leaps++; }
          if (Math.abs(lastStep) >= 3) step = lastStep > 0 ? -1 : 1;     // a leap is answered by a step back
          if (step === 0 && lastStep === 0) step = 1;
          if (d + step > 7 || d + step < -2) step = -step;
          d += step; lastStep = step;
        }
        first = false;
        notes.push({ t: t, d: dur, deg: d });
        t += dur;
      }
      if (!notes.length) notes.push({ t: 0, d: beats, deg: d });
      // phrase endings: the half cadence on the fifth or the second, the end on the second (it wants the tonic)
      if (b === 3 || b === 7) {
        var target = b === 3 ? (Math.abs(d - 4) <= Math.abs(d - 1) ? 4 : 1) : (d > 4 ? 6 : 1);
        var last = notes[notes.length - 1];
        last.deg = target;
        if (notes.length > 1) {
          var prev = notes[notes.length - 2];
          if (Math.abs(prev.deg - target) > 2) prev.deg = target + (prev.deg > target ? 1 : -1);
          else if (prev.deg === target) prev.deg = target + 1;     // lean into the last note, do not repeat it
        }
        d = target; lastStep = 0;
      }
      bars.push({ notes: notes, root: 0 });
    }
    // harmony: one chord per bar that holds the bar's first note, chosen by position
    var prefer = { 0: [0], 3: [4, 3, 1, 5], 4: [0], 7: [4, 1, 6, 3] };
    var order = [5, 3, 1, 2, 6, 4, 0], rot = Math.floor(r() * 7);
    var prevRoot = -1;
    for (b = 0; b < PHRASE; b++) {
      var deg = mod(bars[b].notes[0].deg, 7);
      var cands = [deg, mod(deg - 2, 7), mod(deg - 4, 7)].filter(function (x) { return triadQuality(iv, x) !== 'dim'; });
      var pref = prefer[b] || order.slice(rot).concat(order.slice(0, rot)), pick = -1, j;
      for (j = 0; j < pref.length && pick < 0; j++) if (cands.indexOf(pref[j]) >= 0 && (pref[j] !== prevRoot || prefer[b])) pick = pref[j];
      for (j = 0; j < order.length && pick < 0; j++) if (cands.indexOf(order[j]) >= 0) pick = order[j];
      if (pick < 0) pick = cands[0];
      bars[b].root = pick;
      prevRoot = pick;
    }
    th.bars = bars;
    // the octave: the melody's centre of gravity (weighted by length) sits as near the G above middle C as whole
    // octaves allow, so that every theme sings in the same warm register above its left hand
    var sum = 0, wsum = 0;
    bars.forEach(function (bb) { bb.notes.forEach(function (n) { sum += deg2midi(th, n.deg) * n.d; wsum += n.d; }); });
    th.tonicMidi += 12 * Math.round((67 - sum / wsum) / 12);
    th.top = bars.reduce(function (a, bb) { return bb.notes.reduce(function (c, n) { return Math.max(c, deg2midi(th, n.deg)); }, a); }, 0);   // its highest note
    cache[ck] = th;
    return th;
  }

  function copyBar(bar) {
    return { notes: bar.notes.map(function (n) { return { t: n.t, d: n.d, deg: n.deg }; }), root: bar.root };
  }

  /* ------------------------------------------------------------------ the cue */

  function hourOf(state, hints) {
    var tone = state.tone;
    if (tone === 'night' || tone === 'dusk' || tone === 'dawn') return tone;
    if (tone === 'noon') return 'day';
    if (hints && hints.hour) return hints.hour;
    var m = state.bg && state.bg.mod;
    if (m === 'night' || m === 'dusk' || m === 'dawn') return m;
    return 'day';
  }

  function isIndoor(state, hints) {
    if (hints && typeof hints.indoor === 'boolean') return hints.indoor;
    return !!(state.bg && INDOOR[state.bg.name]);
  }

  function autoAmbience(state, hints, hour) {
    var fx = state.fx || {}, out = [];
    var name = state.bg ? state.bg.name : 'void';
    var weather = fx.rain ? 'rain' : fx.snow ? 'wind' : null;
    var place;
    if (SILENT[name]) place = null;
    else if (name === 'sea') place = 'sea';
    else if (TRAIN[name]) place = 'train';
    else if (HUM[name]) place = 'hum';
    else if (CROWD[name]) place = hour === 'night' ? 'room' : 'crowd';     // an empty hall at night is only a room
    else if (isIndoor(state, hints)) place = 'room';
    else place = hour === 'night' ? 'night' : 'wind';
    if (weather) out.push(weather);
    if (place && (!weather || place === 'sea' || place === 'train' || place === 'hum') && out.indexOf(place) < 0) out.push(place);
    return out;
  }

  function cue(state, op, program, hints) {
    if (!state) return null;
    hints = hints || {};
    var th = theme(program);
    var kind = op && op.kind;
    var hour = hourOf(state, hints);
    var memory = !!state.flashback || state.tone === 'memory';
    var track, auto = !state.music || state.music === 'auto';
    if (state.music === 'off') track = null;
    else if (!auto) track = TRACKS.indexOf(state.music) >= 0 ? state.music : 'theme';
    else if (kind === 'end') track = 'finale';
    else if (hints.title || kind === 'title') track = 'theme';
    else if (memory) track = 'memory';
    else if (state.tone === 'cold') track = 'cold';
    else if (hour === 'night') track = 'nocturne';
    else if (hour === 'dusk' || hour === 'dawn') track = 'tender';
    else track = (!state.bg || isIndoor(state, hints)) ? 'theme' : 'bright';

    var amb;
    if (state.ambience === 'off') amb = [];
    else if (state.ambience && state.ambience !== 'auto') amb = AMBIENCE.indexOf(state.ambience) >= 0 ? [state.ambience] : [];
    else amb = autoAmbience(state, hints, hour);

    var intensity = 1;
    if (kind === 'chapter') intensity = 0.35;
    else if (kind === 'withheld') intensity = 0.15;
    else if (kind === 'scene') intensity = 0.7;
    // (the title screen states the theme whole: intensity 1)

    var filter = (memory || track === 'memory') ? 'tape' : 'none';
    var seed = track ? hash(th.id + '|' + track) : 0;
    var tempo = th.tempo;
    if (track) {
      tempo = Math.round(th.tempo * TEMPO[track]);
      tempo = Math.max(track === 'memory' ? 52 : 56, Math.min(76, tempo));
    }
    return {
      key: (track || '-') + '|' + amb.join('+') + '|' + filter + '|' + seed.toString(36),
      track: track,
      ambience: amb,
      seed: seed,
      tempo: tempo,
      tonic: th.tonicMidi,
      mode: th.mode,
      scale: th.scale.slice(),
      beats: th.beats,
      intensity: intensity,
      hold: kind === 'menu',
      filter: filter,
      theme: th
    };
  }

  /* ------------------------------------------------------------------ bars */

  function ev(t, d, midi, vel, voice) {
    return { t: t, d: d, midi: Math.max(33, Math.min(96, midi)), vel: Math.round(vel * 1000) / 1000, voice: voice };
  }

  function chord(th, rootDeg, lo, hi) {
    var r = fit(deg2midi(th, rootDeg), lo, hi);
    var third = r + mod(th.iv[mod(rootDeg + 2, 7)] - th.iv[mod(rootDeg, 7)], 12);
    var fifth = r + mod(th.iv[mod(rootDeg + 4, 7)] - th.iv[mod(rootDeg, 7)], 12);
    return { root: r, third: third, fifth: fifth, tenth: third + 12 };
  }

  function melody(th, bar, shift) {
    return bar.notes.map(function (n) { return { t: n.t, d: n.d, midi: deg2midi(th, n.deg) + (shift || 0) }; });
  }

  // the notes of bar i: pure
  function bar(c, i) {
    if (!c || !c.track || !c.theme) return [];
    var th = c.theme, B = th.beats, out = [];
    i = Math.max(0, Math.floor(i || 0));
    var pos = i % CYCLE, rep = Math.floor(i / CYCLE);
    var r = rng((c.seed ^ Math.imul(i + 1, 0x9E3779B1)) >>> 0);
    var track = c.track;
    var inten = c.intensity == null ? 1 : c.intensity;
    var tonicLow = chord(th, 0, 38, 50);

    if (pos >= PHRASE) {
      // the breath between two phrases: one open low fifth on the first of the two bars, then nothing
      if (pos === PHRASE && track !== 'cold' && inten > 0.2) {
        var v = track === 'memory' ? 'musicbox' : track === 'bright' ? 'pluck' : 'piano';
        var lo = track === 'memory' ? chord(th, 0, 60, 72) : tonicLow;
        out.push(ev(0, B * 2, lo.root, 0.2, v));
        if (track !== 'nocturne') out.push(ev(B / 2, B * 1.5, lo.fifth, 0.14, v));
        if (track === 'finale' || track === 'tender') { var pc = chord(th, 0, 48, 60); out.push(ev(0, B * 2, pc.root, 0.1, 'pad'), ev(0, B * 2, pc.fifth, 0.09, 'pad')); }
      }
      if (track === 'tension') out.push(ev(0, 0.9, fit(th.tonicMidi, 36, 47), 0.18, 'bass'), ev(2, 0.9, fit(th.tonicMidi, 36, 47), 0.14, 'bass'));
      return thin(out, inten, r, i);
    }

    var mb = th.bars[pos], rootDeg = mb.root;
    var full = melody(th, mb, 0);
    var lh = chord(th, rootDeg, 40, 52);
    // The long form: four passes of the ten bars make one period of forty, so nothing returns sooner than that.
    //   0  the theme
    //   1  its first half; the second half is the harmony alone, and only the last bar's question comes back
    //   2  the theme over the other left hand
    //   3  the harmony alone, with the first note of every other bar held above it
    // The finale is always the whole theme. nocturne, cold and tension have their own, already thin, patterns.
    var form = track === 'finale' ? 0 : rep % 4;
    var mel = form === 1 ? ((pos < 4 || pos === PHRASE - 1) ? full : [])
      : form === 3 ? (pos % 2 === 0 ? [{ t: 0, d: B, midi: full[0].midi }] : [])
      : full;
    var odd = form >= 2;
    // the accompaniment never climbs into the melody: a note that would reach the bar's lowest melody note
    // drops an octave, and where the tenth would, the left hand takes the fifth
    var lowMel = full.reduce(function (a, n) { return Math.min(a, n.midi); }, 127);
    function under(m) { while (m >= lowMel - 1 && m - 12 >= 33) m -= 12; return m; }
    var inner = lh.tenth < lowMel - 2 ? lh.tenth : (lh.root + 12 < lowMel - 1 ? lh.root + 12 : under(lh.fifth));   // else the octave
    var k;

    switch (track) {
      case 'theme':
        mel.forEach(function (n, j) { out.push(ev(n.t, n.d, n.midi, j === 0 ? 0.44 : 0.38, 'piano')); });
        out.push(ev(0, B, lh.root, 0.3, 'piano'));
        if ((pos % 2 === 0) !== odd) out.push(ev(2, B - 2, inner, 0.2, 'piano'));
        else out.push(ev(B === 4 ? 2 : 1.5, B === 4 ? 2 : 1.5, under(lh.fifth), 0.18, 'piano'));
        break;
      case 'nocturne':
        // A few notes of the theme over a tonic pedal. The night scenes are the longest, so this too has four
        // passes: the outline (one note a bar) with an inner fifth; the outline alone; the outline an octave
        // higher and softer; then almost nothing, only the pedal and the two phrase endings.
        var nf = rep % 4, up = (nf === 2 && th.top + 12 <= 88) ? 12 : 0, lastN = full[full.length - 1];
        if (nf !== 3) out.push(ev(0, B, full[0].midi + up, nf === 2 ? 0.3 : 0.36, 'piano'));
        if ((pos === 3 || pos === 7) && (full.length > 1 || nf === 3)) out.push(ev(lastN.t, lastN.d, lastN.midi + up, 0.3, 'piano'));
        if (pos % 2 === 0) out.push(ev(0, B * 2, tonicLow.root, 0.26, 'piano'));
        else if (nf % 2 === 0) out.push(ev(B / 2, B / 2 + 1, under(fit(lh.fifth, 55, 67)), 0.16, 'piano'));
        break;
      case 'tender':
        mel.forEach(function (n, j) { out.push(ev(n.t, n.d, n.midi, j === 0 ? 0.4 : 0.34, 'piano')); });
        out.push(ev(0, B, lh.root, 0.24, 'piano'));
        var pd = chord(th, rootDeg, 48, 60);
        out.push(ev(0, B, pd.root, 0.13, 'pad'), ev(0, B, pd.third, 0.11, 'pad'), ev(0, B, pd.fifth, 0.11, 'pad'));
        break;
      case 'memory':
        // the theme an octave up on a music box
        mel.forEach(function (n, j) { out.push(ev(n.t, n.d, fit(n.midi + 12, 60, 96), j === 0 ? 0.34 : 0.28, 'musicbox')); });
        if (pos % 2 === 0) out.push(ev(0, B, chord(th, rootDeg, 55, 66).root, 0.18, 'musicbox'));
        break;
      case 'cold':
        // high, sparse celesta over a quiet drone
        if (pos % 2 === 0) out.push(ev(0, B, fit(full[0].midi + 12, 72, 91), 0.26, 'celesta'));
        else if (pos % 4 === 1) out.push(ev(B / 2, B / 2, fit(chord(th, rootDeg, 72, 84).fifth, 72, 91), 0.17, 'celesta'));
        if (pos === 0 || pos === 4) { var dr = chord(th, 0, 45, 57); out.push(ev(0, B * 4, dr.root, 0.12, 'pad'), ev(0, B * 4, dr.fifth, 0.1, 'pad')); }
        break;
      case 'tension':
        // a low repeated pedal and unresolved seconds
        var ped = fit(th.tonicMidi, 36, 47);
        for (k = 0; k < B; k++) out.push(ev(k, 0.9, ped, k === 0 ? 0.26 : 0.19, 'bass'));
        if (pos % 2 === 0) {
          var sd = pos % 4 === 0 ? 4 : 1;
          var a = fit(deg2midi(th, sd), 55, 66), b2 = a + mod(th.iv[mod(sd + 1, 7)] - th.iv[mod(sd, 7)], 12);
          out.push(ev(0, B * 2, a, 0.18, 'piano'), ev(0.5, B * 2 - 0.5, b2, 0.15, 'piano'));
        } else out.push(ev(B - 1, 1, fit(full[0].midi, 62, 74), 0.2, 'piano'));
        break;
      case 'bright':
        mel.forEach(function (n, j) { out.push(ev(n.t, n.d, n.midi, j === 0 ? 0.42 : 0.36, 'pluck')); });
        var pl = chord(th, rootDeg, 48, 59);
        out.push(ev(0, 1, under(pl.root), 0.22, 'pluck'), ev(1, 1, under(pl.fifth), 0.18, 'pluck'));
        if (B === 4) out.push(ev(3, 1, under(pl.tenth < lowMel - 2 ? pl.tenth : pl.third), 0.16, 'pluck'));
        out.push(ev(0, 1, fit(lh.root, 36, 47), 0.2, 'bass'));          // one short low note: light on its feet
        break;
      case 'finale':
        var fp;
        if (pos === PHRASE - 1) {
          // the cadence: the second falls to the tonic over V - I
          var h = B / 2, top = deg2midi(th, 1);
          if (Math.abs(top - mel[0].midi) > 7) top = fit(top, mel[0].midi - 6, mel[0].midi + 6);
          var tonicTop = top - (th.iv[1] - th.iv[0]);
          var v5 = chord(th, 4, 40, 52), v1 = chord(th, 0, 40, 52);
          // the melody stays on top without leaving its register: the left hand's inner note keeps under it
          var in1 = v1.tenth < tonicTop - 2 ? v1.tenth : v1.fifth;
          while (in1 >= tonicTop - 1) in1 -= 12;
          while (tonicTop <= v1.root + 2) { tonicTop += 12; top += 12; }     // (never needed for a theme centred on G4)
          out.push(ev(0, h, top, 0.42, 'piano'), ev(h, h + B, tonicTop, 0.44, 'piano'));
          out.push(ev(0, h, v5.root, 0.26, 'piano'), ev(h, h + B, v1.root, 0.26, 'piano'), ev(h, h + B, in1, 0.2, 'piano'));
          var p5 = chord(th, 4, 48, 60), p1 = chord(th, 0, 48, 60);
          out.push(ev(0, h, p5.root, 0.12, 'pad'), ev(0, h, p5.third, 0.1, 'pad'), ev(h, B, p1.root, 0.12, 'pad'), ev(h, B, p1.third, 0.1, 'pad'), ev(h, B, p1.fifth, 0.1, 'pad'));
          out.push(ev(0, h, fit(v5.root, 33, 45), 0.2, 'bass'), ev(h, B, fit(v1.root, 33, 45), 0.22, 'bass'));
          break;
        }
        mel.forEach(function (n, j) { out.push(ev(n.t, n.d, n.midi, j === 0 ? 0.46 : 0.4, 'piano')); });
        out.push(ev(0, 1.2, lh.root, 0.25, 'piano'), ev(1, 1.2, under(lh.fifth), 0.19, 'piano'), ev(2, B - 2, inner, 0.19, 'piano'));
        fp = chord(th, rootDeg, 48, 60);
        out.push(ev(0, B, fp.root, 0.12, 'pad'), ev(0, B, fp.third, 0.1, 'pad'));
        if (pos % 4 === 0) out.push(ev(0, B * 2, fit(lh.root, 33, 45), 0.2, 'bass'));
        break;
    }
    return thin(out, inten, r, i);
  }

  // intensity below 1 thins a bar towards silence: the first event of the bar always stays (at very low
  // intensity only on every other bar), the others stay with probability = intensity
  function thin(out, inten, r, i) {
    if (inten >= 1 || !out.length) return out;
    var keep = [];
    for (var j = 0; j < out.length; j++) {
      var roll = r();
      if (j === 0) { if (inten >= 0.3 || i % 2 === 0) keep.push(out[j]); }
      else if (roll < inten) keep.push(out[j]);
    }
    return keep.map(function (e) { e.vel = Math.round(e.vel * (0.6 + 0.4 * inten) * 1000) / 1000; return e; });
  }

  /* ------------------------------------------------------------------ menus and stings */

  function themeOf(c) { return (c && c.theme) || theme(null); }

  // the wait at a menu: a suspended fourth over the fifth degree (V sus4), struck once and renewed every
  // other bar, with a lone high second ringing over it
  function holdBar(c, i) {
    var th = themeOf(c), B = th.beats, out = [];
    i = Math.max(0, Math.floor(i || 0));
    if (i % 2 !== 0) return out;
    var root = fit(deg2midi(th, 4), 48, 59);
    var fourth = root + mod(th.iv[0] - th.iv[4], 12);
    var fifthOf = root + 7;
    var top = fit(deg2midi(th, 1), 67, 79);
    out.push(ev(0, B * 2, root, 0.12, 'pad'), ev(0, B * 2, fourth, 0.1, 'pad'), ev(0, B * 2, fifthOf, 0.09, 'pad'));
    if (i === 0) out.push(ev(0, B * 2, fit(root, 40, 52), 0.2, 'piano'));
    out.push(ev(i === 0 ? 1 : 0, B, top, i === 0 ? 0.22 : 0.16, c && c.track === 'memory' ? 'musicbox' : 'piano'));
    return out;
  }

  // the suspension resolves: the tonic chord, softly
  function resolveBar(c) {
    var th = themeOf(c), B = th.beats;
    var p = chord(th, 0, 48, 60), low = chord(th, 0, 40, 52);
    return [ev(0, B * 2, p.root, 0.12, 'pad'), ev(0, B * 2, p.third, 0.1, 'pad'), ev(0, B * 2, p.fifth, 0.1, 'pad'),
      ev(0, B * 2, low.root, 0.24, 'piano'), ev(0.5, B * 1.5, fit(th.tonicMidi, 64, 76), 0.24, c && c.track === 'memory' ? 'musicbox' : 'piano')];
  }

  function sting(c, kind) {
    var th = themeOf(c), B = th.beats;
    if (kind === 'chapter') return [ev(0, B * 2, fit(th.tonicMidi, 36, 47), 0.36, 'piano'), ev(0, B * 2, fit(th.tonicMidi, 36, 47) + 12, 0.12, 'piano')];
    if (kind === 'end') {
      var v5 = chord(th, 4, 43, 55), v1 = chord(th, 0, 43, 55), top5 = fit(deg2midi(th, 1), 64, 76), top1 = fit(th.tonicMidi, 64, 76);
      return [ev(0, B, v5.root, 0.26, 'piano'), ev(0, B, v5.fifth, 0.2, 'piano'), ev(0, B, v5.tenth, 0.2, 'piano'), ev(0.02, B, top5, 0.3, 'piano'),
        ev(B, B * 3, v1.root, 0.28, 'piano'), ev(B, B * 3, v1.fifth, 0.2, 'piano'), ev(B, B * 3, v1.tenth, 0.2, 'piano'), ev(B + 0.02, B * 3, top1, 0.32, 'piano'),
        ev(B, B * 3, fit(th.tonicMidi, 33, 45), 0.2, 'bass')];
    }
    return [];
  }

  return {
    TRACKS: TRACKS,
    AMBIENCE: AMBIENCE,
    VOICES: VOICES,
    MODES: MODES,
    PHRASE: PHRASE,
    CYCLE: CYCLE,
    theme: theme,
    cue: cue,
    bar: bar,
    holdBar: holdBar,
    resolveBar: resolveBar,
    sting: sting,
    deg2midi: deg2midi,
    hourOf: hourOf
  };
}));
