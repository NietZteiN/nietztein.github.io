/*
 * Paper Theatre - the opening movie (window.VNOp).
 *
 * About twenty seconds before the first line of a fresh story, in the manner of a visual novel's opening: black,
 * a line of light, the title set large, then cuts through the story's own pictures in script order with a
 * vertical column of the title and the cast roll, the chapter titles as a quick roll, the title once more over the
 * first picture, and the source as ORIGINAL WORK with "Dialogue is dramatized", as the end card says. It is built
 * from the parsed program only: nothing is written here that the script does not already say, and no co-author
 * is given a voice (co-authors are credited from meta.authors).
 *
 * Cuts fall on a beat: the audio's tempo when the audio object has one, else VNScore.theme(program) when the
 * score module has it, else a fixed 500 ms grid; when the audio is there the theme is started again with the
 * movie (VNAudio.sync), so that the two keep step. Skippable at any moment: a click or tap, Enter, Space, Escape,
 * or the Skip button. Under reduced motion it is one still title card for three seconds. A story needs a title
 * and at least two pictures to have an opening.
 *
 * Contract (OPS.md, Optional modules): available(program) -> bool; play(program, stageEl, {audio}) -> Promise
 * (resolves with 'done', 'skipped' or 'stopped' when it has finished, was skipped by the reader or was stopped by
 * the stage; #stage then carries the class op-done, and data-op goes from "playing" to that same word); stop().
 * plan(program, beatMs) is the pure timeline (no DOM), and debug() a read-only view for the harness.
 * The stage decides when it plays (Start on a fresh story; never under ?thumb=1, ?autoplay= or a deep link unless
 * ?op=1); this file only plays when it is asked to.
 */
(function (root, factory) {
  var api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.VNOp = api;
})(typeof window !== 'undefined' ? window : this, function (root) {
  'use strict';

  var DEFAULT_BEAT = 500;
  var SHOT_MS = 1700;          // a picture stays about this long: slow enough to be looked at
  var MAX_SHOTS = 8;
  var STILL_MS = 3000;         // reduced motion: one still card
  var GRACE_MS = 300;          // a second click of a double click on Start does not skip the movie

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  /* ------------------------------------------------------------------ what the program offers */

  // The pictures, in script order: every bg and cg op, one per distinct picture (name, hour and options),
  // the empty 'void' background left out.
  function pictures(program) {
    var out = [], seen = {};
    ((program && program.ops) || []).forEach(function (o) {
      if (o.kind !== 'bg' && o.kind !== 'cg') return;
      if (!o.name || (o.kind === 'bg' && o.name === 'void')) return;
      var key = o.kind + '|' + o.name + '|' + (o.mod || '') + '|' + JSON.stringify(o.opts || {});
      if (seen[key]) return;
      seen[key] = true;
      out.push({ kind: o.kind, name: o.name, mod: o.mod || null, opts: o.opts || null, line: o.line });
    });
    return out;
  }
  // The cast roll: display names as declared, in declaration order; a page (a document given a voice in the
  // script) is not a character, as on the end card.
  function castNames(program) {
    var cast = (program && program.cast) || {}, seen = {}, out = [];
    Object.keys(cast).forEach(function (k) {
      var c = cast[k];
      if (!c || c.page) return;
      var n = c.name || c.id;
      if (!n || seen[n]) return;
      seen[n] = true; out.push(n);
    });
    return out;
  }
  // The title, and a short form of it for the vertical column: the words up to the title's own first colon or
  // question mark, when there is more after it ("What Does an Embedding Mean?").
  function titleParts(title) {
    title = String(title || '').trim();
    var m = /^(.{6,}?[?:!])\s+(\S.*)$/.exec(title);
    if (m) return { main: m[1].replace(/:$/, ''), sub: m[2], short: m[1].replace(/:$/, '') };
    return { main: title, sub: '', short: title };
  }
  // ORIGINAL WORK: the citation as written, else the source as the title screen names it.
  function originalWork(meta) {
    meta = meta || {};
    if (meta.cite) return meta.cite;
    if (meta.kind === 'blog' || meta.sourceKind === 'blog') return 'A blog post on this site' + (meta.date ? ', ' + meta.date : '');
    if (meta.sourceKind === 'text' && meta.source) return meta.source;
    if (meta.sourceRef) return meta.sourceRef;
    return meta.source || '';
  }

  // The end card's line is only true of a story that was written as one: a post read straight through (@read,
  // no cast) is not dramatized, and is not told that it is.
  function dramatized(program) {
    var ops = (program && program.ops) || [], read = false;
    for (var i = 0; i < ops.length; i++) if (ops[i].kind === 'read') { read = true; break; }
    return !(read && !castNames(program).length);
  }

  // An opening cuts through the story's pictures: a story needs a title and at least two of them (a post read
  // straight through and a "coming soon" stub have one, and get none).
  function available(program) {
    if (!program || !program.meta || !program.meta.title) return false;
    return pictures(program).length > 1;
  }

  /* ------------------------------------------------------------------ the beat */

  function num(v) {
    if (typeof v === 'function') { try { v = v(); } catch (e) { return null; } }
    if (v && typeof v === 'object') v = v.bpm != null ? v.bpm : v.tempo != null ? v.tempo : null;
    v = parseFloat(v);
    return isFinite(v) && v > 0 ? v : null;
  }
  // milliseconds per beat: the audio's tempo, else the score's theme for this story, else 500 ms;
  // folded into 380..900 ms by halving or doubling, so a slow theme still cuts often enough
  function beatMs(program, audio) {
    var bpm = null, src = 'grid';
    try {
      if (audio && audio.tempo != null) { bpm = num(audio.tempo); if (bpm) src = 'audio'; }
      if (!bpm && root.VNScore && typeof root.VNScore.theme === 'function') {
        var th = root.VNScore.theme(program);
        bpm = num(th) || (th && num(th.theme));
        if (!bpm && th && th.beat) { var bm = parseFloat(th.beat); if (isFinite(bm) && bm > 0) bpm = 60000 / bm; }
        if (bpm) src = 'score';
      }
    } catch (e) { bpm = null; src = 'grid'; }
    var ms = bpm ? 60000 / bpm : DEFAULT_BEAT;
    var guard = 0;
    while (ms < 380 && guard++ < 8) ms *= 2;
    while (ms > 900 && guard++ < 16) ms /= 2;
    return { ms: ms, src: bpm ? src : 'grid' };
  }

  // The theme starts with the movie, so that the cuts fall on its beats and not merely at its tempo: the cue the
  // stage last sent (the title's) is handed to VNAudio.sync again, first with no track (the music lets go, the
  // ambience stays), then whole (the theme from its first bar). The cue is the one play() was given (o.cue), else
  // the stage's own record of it. Every step is optional: no audio object, no sync method or no cue, and the
  // music is left as it is.
  function startTheme(audio, given) {
    try {
      if (!audio || typeof audio.sync !== 'function') return false;
      var st = root.__vnStage, cue = given || (st && st.S && st.S.cue);
      if (!cue || typeof cue !== 'object' || !cue.track) return false;
      var rest = {}, k;
      for (k in cue) if (Object.prototype.hasOwnProperty.call(cue, k)) rest[k] = cue[k];
      rest.track = null;
      audio.sync(rest, { instant: true });
      audio.sync(cue, { instant: true });
      return true;
    } catch (e) { return false; }
  }

  /* ------------------------------------------------------------------ the timeline (pure) */

  // Every time is in milliseconds from the start and falls on the beat grid (whole beats; the credit cards on
  // half and quarter beats, the chapter roll on half beats, or quarter beats when a story has many chapters).
  // Each part has a length it aims for, which the grid rounds:
  //   black and a line of light (0.8 s), the title (2 s at least), black again for a breath (the title is gone
  //   before the first cut), the cuts (7.5 s), the chapter roll (2.8 s), the title over the first picture (2.4 s),
  //   a second of black, the source (2.6 s). About twenty-one seconds in all.
  function plan(program, beat) {
    beat = beat || DEFAULT_BEAT;
    var meta = (program && program.meta) || {};
    function q(ms) { return Math.max(1, Math.round(ms / beat)); }      // a length in whole beats
    var pics = pictures(program), chapters = ((program && program.chapters) || []).filter(function (c) { return c && (c.title || c.n); });
    var tp = titleParts(meta.title);
    var p = { beat: beat, title: tp, shots: [], credits: [], chapters: [] };

    var tIn = q(800), tOut = tIn + Math.max(1, Math.ceil(2000 / beat));
    p.titleIn = tIn * beat;
    p.titleOut = tOut * beat;
    var s0 = tOut + Math.max(1, Math.ceil(650 / beat));

    // the cuts: about SHOT_MS each (a whole number of beats, two at least), as many as the time allows, spread
    // over the script when the story has more pictures; a story with few pictures holds each one longer
    var room = chapters.length ? 7500 : 10300;
    var L = Math.max(2, Math.round(SHOT_MS / beat));
    var K = Math.min(pics.length, MAX_SHOTS, Math.max(1, Math.round(room / (L * beat))));
    var per = Math.max(L, Math.min(Math.round(room / Math.max(1, K) / beat), Math.round(3600 / beat)));
    var chosen = [];
    if (K === pics.length) chosen = pics.slice();
    else for (var i = 0; i < K; i++) chosen.push(pics[Math.round(i * (pics.length - 1) / Math.max(1, K - 1))]);
    var at = s0;
    chosen.forEach(function (pic, i) {
      p.shots.push({ kind: pic.kind, name: pic.name, mod: pic.mod, opts: pic.opts, at: at * beat, dur: per * beat, drift: i % 2 ? -1 : 1 });
      at += per;
    });
    var s1 = Math.max(at, s0 + 1);
    p.vertIn = s0 * beat;
    p.vertOut = s1 * beat;

    // the roll: the authors first (credited, never voiced), then the cast, one card per cut
    var items = [];
    if (meta.authors) {
      var who = String(meta.authors).replace(/\s*\(co-first\)/, '');
      items.push({ label: meta.kind === 'blog' ? 'Written by' : /,|\sand\s|&/.test(who) ? 'Authors' : 'Author', names: [who] });
    }
    var names = castNames(program);
    if (names.length) {
      var slots = Math.max(1, p.shots.length - items.length), perCard = Math.ceil(names.length / slots);
      for (var j = 0; j < names.length; j += perCard) items.push({ label: j === 0 ? 'Cast' : '', names: names.slice(j, j + perCard) });
    }
    items.slice(0, Math.max(1, p.shots.length)).forEach(function (it, k) {
      var sh = p.shots[k];
      if (sh) p.credits.push({ label: it.label, names: it.names, at: sh.at + beat / 2, out: sh.at + sh.dur - beat / 4 });
    });

    // the chapter titles: a quick roll over the first two thirds of their time, so that the last one is read too
    var cEnd = s1;
    if (chapters.length) {
      cEnd = s1 + q(2800);
      var span = (cEnd - s1) * beat, n = chapters.length;
      var g = span * 0.68 / n < beat / 2 ? beat / 4 : beat / 2, prev = -1;
      chapters.forEach(function (c, k) {
        var t = Math.round((k + 0.5) * span * 0.68 / n / g) * g;
        if (t <= prev) t = prev + g;
        prev = t;
        p.chapters.push({ n: String(c.n == null ? '' : c.n), title: c.title || '', at: s1 * beat + t });
      });
      p.chapterIn = s1 * beat;
      p.chapterOut = cEnd * beat;
    }

    // the title again over the first picture, then the source on black
    // (the title is gone before the source comes up: about a second of black between them)
    var fOut = cEnd + q(2400), cAt = fOut + q(800), cOut = cAt + q(2600);
    p.finale = { at: cEnd * beat, out: fOut * beat, pic: pics[0] || null };
    p.credit = { at: cAt * beat, out: cOut * beat, text: originalWork(meta), dramatized: dramatized(program) };
    p.end = p.credit.out + 900;      // the source has faded: the movie is over
    p.beats = cOut;
    return p;
  }

  /* ------------------------------------------------------------------ drawing */

  function art() { return root.VNArt || null; }
  function paintKey(kind, name, mod, opts) {
    var o = opts || {}, keys = Object.keys(o).sort();
    return kind + '|' + name + '|' + (mod || '') + '|' + keys.map(function (k) { return k + '=' + o[k]; }).join(',');
  }
  function svgFor(pic) {
    var A = art();
    if (!A || !pic) return '';
    try {
      return pic.kind === 'cg' ? (A.cg ? A.cg(pic.name, pic.mod, pic.opts || {}) : '') : (A.background ? A.background(pic.name, pic.mod, pic.opts || {}) : '');
    } catch (e) { return ''; }
  }
  // The same rule as the stage's: painted when the module is there and the reader has not switched it off; in a
  // capture or a test run (?thumb=1, ?autoplay=) only when ?paint=1 asks for it.
  function paintAllowed() {
    if (!root.VNPaint || typeof root.VNPaint.mount !== 'function') return false;
    try {
      var q = root.location.search;
      if (/[?&]paint=0(&|$)/.test(q)) return false;
      if (/[?&]paint=1(&|$)/.test(q)) return true;
      if (/[?&](thumb=1|autoplay=)/.test(q)) return false;
      var pr = JSON.parse(root.localStorage.getItem('vn:prefs') || '{}');
      return pr.paint !== false;
    } catch (e) { return true; }
  }
  // A picture layer for one cut, put into its parent (it must be in the page before it is painted: the painter
  // measures it). Painted when the paint module is there and wanted; the key is the stage's own, so a picture
  // painted here is already painted when the story reaches it.
  function shotEl(pic, parent) {
    var d = root.document.createElement('div');
    d.className = 'vn-op-shot' + (pic && pic.kind === 'cg' ? ' is-cg' : '');
    var svg = svgFor(pic);
    d.innerHTML = svg;
    if (parent) parent.appendChild(d);
    if (svg && paintAllowed()) {
      var key = paintKey(pic.kind, pic.name, pic.mod, pic.opts);
      d.setAttribute('data-paint', key);
      try {
        var r = root.VNPaint.mount(d, svg, key);
        if (r && typeof r.then === 'function') r.then(null, function () {});
      } catch (e) { /* the opening goes on with the drawn picture */ }
    }
    return d;
  }

  /* ------------------------------------------------------------------ playing */

  var cur = null;    // the one opening in progress

  function reduced() {
    try { return !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return false; }
  }

  function play(program, stageEl, o) {
    o = o || {};
    if (cur) finish(cur, 'stopped', true);
    if (!stageEl || !root.document || !program) return Promise.resolve();
    var doc = root.document;
    var still = reduced();
    var themed = still ? false : startTheme(o.audio || null, o.cue || null);
    var bt = beatMs(program, o.audio || null);
    var P = plan(program, bt.ms);
    var meta = program.meta || {};

    var run = { stage: stageEl, timers: [], done: false, t0: 0, plan: P, beat: bt, themed: themed, still: still, phase: 'start', resolve: null, el: null, listeners: [], later: [] };
    var promise = new Promise(function (res) { run.resolve = res; });
    cur = run;

    stageEl.classList.remove('op-done');
    stageEl.setAttribute('data-op', 'playing');

    var el = doc.createElement('div');
    el.className = 'vn-op' + (still ? ' is-still' : '');
    el.setAttribute('role', 'region');
    el.setAttribute('aria-label', 'Opening: ' + (meta.title || ''));
    el.style.setProperty('--op-beat', Math.round(bt.ms) + 'ms');
    var tp = P.title;
    var h = '';
    h += '<div class="vn-op-shots"></div>';
    h += '<div class="vn-op-veil"></div><div class="vn-op-light"></div><div class="vn-op-line"></div>';
    h += '<div class="vn-op-title"><h2>' + esc(tp.main) + '</h2>' + (tp.sub ? '<p>' + esc(tp.sub) + '</p>' : '') + '</div>';
    h += '<div class="vn-op-vert" aria-hidden="true"' + (tp.short.length > 34 ? ' data-long="1"' : '') + '>' + esc(tp.short) + '</div>';
    h += '<div class="vn-op-roll" aria-hidden="true"></div>';
    h += '<ol class="vn-op-chapters" aria-hidden="true">' + P.chapters.map(function (c) {
      return '<li><span class="n">' + esc(c.n) + '</span><span class="t">' + esc(c.title) + '</span></li>';
    }).join('') + '</ol>';
    h += '<div class="vn-op-final"><h2>' + esc(tp.main) + '</h2><i class="rule"></i>' + (tp.sub ? '<p>' + esc(tp.sub) + '</p>' : '') + '</div>';
    h += '<div class="vn-op-end"><small>Original work</small><p class="cite">' + esc(P.credit.text) + '</p>' + (P.credit.dramatized ? '<p class="dram">Dialogue is dramatized</p>' : '') + '</div>';
    h += '<button type="button" class="vn-op-skip" aria-label="Skip the opening">Skip</button>';
    el.innerHTML = h;
    run.el = el;
    stageEl.appendChild(el);

    var shots = el.querySelector('.vn-op-shots'), roll = el.querySelector('.vn-op-roll');
    var titleEl = el.querySelector('.vn-op-title'), vert = el.querySelector('.vn-op-vert'), line = el.querySelector('.vn-op-line');
    var light = el.querySelector('.vn-op-light'), chaps = el.querySelector('.vn-op-chapters'), finalEl = el.querySelector('.vn-op-final'), endEl = el.querySelector('.vn-op-end');

    // skipping: any click or tap on the movie, Enter, Space or Escape, the Skip button. Not the second click of
    // a double click on Start, and not the Enter that is still held down from pressing Start.
    function on(target, type, fn, opt) { target.addEventListener(type, fn, opt); run.listeners.push([target, type, fn, opt]); }
    function early() { return now() - run.t0 < GRACE_MS; }
    on(el, 'pointerdown', function (e) { e.stopPropagation(); if ((e.button === 0 || e.pointerType === 'touch') && !early()) skip(); });
    on(el, 'click', function (e) { e.stopPropagation(); e.preventDefault(); if (!early()) skip(); });
    on(el, 'contextmenu', function (e) { e.preventDefault(); e.stopPropagation(); });
    on(doc, 'keydown', function (e) {
      if (run.done || e.metaKey || e.ctrlKey || e.altKey) return;
      var k = e.key;
      if (k !== 'Enter' && k !== ' ' && k !== 'Spacebar' && k !== 'Escape') return;
      e.preventDefault();
      if (!e.repeat) skip();
    });
    function skip() { finish(run, 'skipped'); }

    function at(ms, fn) { run.timers.push({ at: ms, fn: fn }); }
    function cls(node, c, onoff) { if (node) node.classList.toggle(c, onoff !== false); }

    if (still) {
      // reduced motion: one still card, the title over the first picture; nothing moves
      var first = shotEl(P.finale.pic, shots);
      first.classList.add('on');
      cls(finalEl, 'on');
      run.phase = 'still';
      at(STILL_MS, function () { finish(run, 'done'); });
    } else {
      at(0, function () { run.phase = 'light'; cls(line, 'on'); });
      at(P.titleIn, function () { run.phase = 'title'; cls(titleEl, 'on'); });
      at(Math.max(P.titleIn + 1, P.titleOut - Math.round(P.beat)), function () { cls(line, 'on', false); });
      at(P.titleOut, function () { cls(titleEl, 'gone'); });
      // The cuts. Each picture is drawn (and handed to the painter) well ahead, one after another while the
      // title is up, so that it is ready when its beat comes; it waits unseen, cuts in on the beat and drifts
      // slowly for as long as it is up.
      var prev = null, lead = 0;
      function retire(old) { if (old) run.later.push(setTimeout(function () { if (old.parentNode) old.parentNode.removeChild(old); }, 700)); }
      P.shots.forEach(function (s, i) {
        var node = null;
        at(Math.max(0, Math.min(s.at - P.beat, 250 + 380 * lead++)), function () {
          node = shotEl(s, shots);
          node.style.setProperty('--op-dur', s.dur + 'ms');
          node.style.setProperty('--op-dx', (s.drift * 1.6) + '%');
        });
        at(s.at, function () {
          run.phase = 'shot-' + i;
          if (!node) return;
          void node.offsetWidth;
          cls(node, 'on');
          cls(node, 'go');
          // light on the cut: a breath of it, not a flash
          cls(light, 'flare', false); void light.offsetWidth; cls(light, 'flare');
          retire(prev); prev = node;
        });
      });
      // (the last picture of all is the first again, under the title: drawn ahead like the rest)
      var finalNode = null;
      at(Math.max(0, Math.min(P.finale.at - P.beat, 250 + 380 * lead)), function () {
        finalNode = shotEl(P.finale.pic, shots);
        finalNode.classList.add('final');
      });
      at(P.vertIn + Math.round(P.beat), function () { cls(vert, 'on'); });
      at(P.vertOut, function () { cls(vert, 'on', false); });
      P.credits.forEach(function (c) {
        at(c.at, function () {
          roll.innerHTML = (c.label ? '<small>' + esc(c.label) + '</small>' : '') + c.names.map(function (n) { return '<span>' + esc(n) + '</span>'; }).join('');
          cls(roll, 'on');
        });
        at(c.out, function () { cls(roll, 'on', false); });
      });
      if (P.chapters.length) {
        at(P.chapterIn, function () { run.phase = 'chapters'; cls(el, 'dim'); cls(chaps, 'on'); });
        P.chapters.forEach(function (c, k) { at(c.at, function () { var li = chaps.children[k]; cls(li, 'on'); }); });
        at(P.chapterOut - Math.round(P.beat / 2), function () { cls(chaps, 'on', false); });
      }
      at(P.finale.at, function () {
        run.phase = 'finale';
        cls(el, 'dim', false);
        var n = finalNode;
        if (n) {
          void n.offsetWidth;
          cls(n, 'on'); cls(n, 'go');
          run.later.push(setTimeout(function () { retire(prev); prev = n; }, 900));   // (it comes up slowly: 1.4 s)
        }
        cls(light, 'flare', false); void light.offsetWidth; cls(light, 'flare');
        cls(finalEl, 'on');
      });
      at(P.finale.out, function () { cls(finalEl, 'gone'); cls(shots, 'out'); });
      at(P.credit.at, function () { run.phase = 'credit'; cls(endEl, 'on'); });
      at(P.credit.out, function () { cls(endEl, 'on', false); });
      at(P.end, function () { finish(run, 'done'); });
    }

    // one clock for the whole movie: each event runs when its time has come, measured from the start
    run.timers.sort(function (a, b) { return a.at - b.at; });
    run.t0 = now();
    run.next = 0;
    tick(run);
    return promise;
  }

  function now() { return (root.performance && root.performance.now) ? root.performance.now() : Date.now(); }
  function tick(run) {
    if (run.done) return;
    var t = now() - run.t0;
    while (run.next < run.timers.length && run.timers[run.next].at <= t + 4) {
      var ev = run.timers[run.next++];
      try { ev.fn(); } catch (e) { /* a picture that will not draw must not stop the movie */ }
      if (run.done) return;
    }
    if (run.next < run.timers.length) run.handle = setTimeout(function () { tick(run); }, Math.max(0, run.timers[run.next].at - (now() - run.t0)));
  }

  // how: 'done' (played to the end), 'skipped' (the reader), 'stopped' (the stage moved on). The promise resolves
  // at once, so the first line is presented under the fading movie; the movie keeps swallowing clicks while it
  // fades (so a click cannot reach the title menu underneath) and is removed when it is gone.
  function finish(run, how, instant) {
    if (!run || run.done) return;
    run.done = true;
    clearTimeout(run.handle);
    run.later.forEach(function (h) { clearTimeout(h); });
    run.listeners.forEach(function (l) { if (l[0] !== run.el) l[0].removeEventListener(l[1], l[2], l[3]); });
    if (cur === run) cur = null;
    run.phase = how;
    var st = run.stage, el = run.el;
    st.setAttribute('data-op', how);
    st.classList.add('op-done');
    // the Skip button is about to go: the keys stay with the stage
    try { if (el.contains(root.document.activeElement) && typeof st.focus === 'function') st.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
    function remove() { if (el && el.parentNode) el.parentNode.removeChild(el); }
    if (instant || run.still) remove();
    else {
      el.classList.add('out');
      setTimeout(remove, 420);
    }
    run.resolve(how);
  }

  function stop() { if (cur) finish(cur, 'stopped', true); }

  function debug() {
    var r = cur;
    if (!r) return { playing: false };
    return { playing: true, phase: r.phase, t: Math.round(now() - r.t0), beat: r.beat.ms, beatSrc: r.beat.src, themed: r.themed, total: r.plan.end, shots: r.plan.shots.length, chapters: r.plan.chapters.length, still: r.still };
  }

  return { available: available, play: play, stop: stop, plan: plan, beatMs: beatMs, pictures: pictures, castNames: castNames, originalWork: originalWork, titleParts: titleParts, dramatized: dramatized, debug: debug };
});
