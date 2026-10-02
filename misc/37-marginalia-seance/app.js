/* Marginalia Séance — the board, the planchette, the ledger. */
(function () {
  'use strict';
  var S = window.Seance;
  var NS = 'http://www.w3.org/2000/svg';
  var $ = function (id) { return document.getElementById(id); };
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var params = new URLSearchParams(location.search);
  var THUMB = params.get('thumb') === '1';

  // ---------- geometry of the board ----------
  var LENS_K = 2.0;
  var POS = {};               // char -> {x, y, rot}
  var REST = { x: 500, y: 405 };
  function arc(letters, cx, cy, r, spread) {
    var n = letters.length;
    for (var i = 0; i < n; i++) {
      var a = -spread + (2 * spread) * (i / (n - 1));
      var rad = a * Math.PI / 180;
      POS[letters[i]] = { x: cx + r * Math.sin(rad), y: cy - r * Math.cos(rad), rot: a };
    }
  }
  arc('ABCDEFGHIJKLM', 500, 880, 700, 33);
  arc('NOPQRSTUVWXYZ', 500, 990, 700, 35.5);
  (function () {
    var digits = '1234567890';
    for (var i = 0; i < 10; i++) POS[digits[i]] = { x: 262 + i * 52.9, y: 478, rot: 0 };
  }());
  POS.YES = { x: 212, y: 96, rot: 0 };
  POS.NO = { x: 788, y: 96, rot: 0 };
  POS.GOODBYE = { x: 500, y: 572, rot: 0 };

  var INK = '#e6d2a4';
  var BOARD_FONT = '"IM Fell English SC", "IM Fell English", "Palatino Linotype", Palatino, Georgia, serif';
  var SIZES = { glyph: 52, word: 44, num: 40, brand: 22 };
  function el(name, attrs, text) {
    var e = document.createElementNS(NS, name);
    if (attrs['class'] === 'frame') { e.setAttribute('fill', 'none'); e.setAttribute('stroke', INK); }
    if (name === 'text') {
      e.setAttribute('fill', attrs['class'] === 'brand' ? 'rgba(230,210,164,0.8)' : INK);
      e.setAttribute('font-family', BOARD_FONT);
      e.setAttribute('font-size', SIZES[attrs['class']] || 40);
      if (attrs['class'] === 'word') e.setAttribute('letter-spacing', '0.06em');
      if (attrs['class'] === 'brand') e.setAttribute('letter-spacing', '0.42em');
    }
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (text != null) e.textContent = text;
    return e;
  }
  function drawBoard() {
    var face = $('face');
    face.appendChild(el('rect', { x: 14, y: 14, width: 972, height: 612, rx: 10, 'class': 'frame', 'stroke-width': 2.4 }));
    face.appendChild(el('rect', { x: 26, y: 26, width: 948, height: 588, rx: 6, 'class': 'frame', 'stroke-width': 1, 'stroke-opacity': 0.6 }));
    // sun
    var sun = el('g', { transform: 'translate(96,96)' });
    sun.appendChild(el('circle', { r: 27, 'class': 'frame', 'stroke-width': 2.2 }));
    for (var i = 0; i < 16; i++) {
      var a = i * Math.PI / 8, r1 = 33, r2 = i % 2 ? 42 : 50;
      sun.appendChild(el('line', { x1: Math.cos(a) * r1, y1: Math.sin(a) * r1, x2: Math.cos(a) * r2, y2: Math.sin(a) * r2, stroke: '#e6d2a4', 'stroke-width': i % 2 ? 1.4 : 2, 'stroke-linecap': 'round' }));
    }
    sun.appendChild(el('circle', { cx: -9, cy: -5, r: 2.4, fill: '#e6d2a4' }));
    sun.appendChild(el('circle', { cx: 9, cy: -5, r: 2.4, fill: '#e6d2a4' }));
    sun.appendChild(el('path', { d: 'M -11,8 Q 0,18 11,8', 'class': 'frame', 'stroke-width': 1.8, 'stroke-linecap': 'round' }));
    face.appendChild(sun);
    // moon and a few stars
    var moon = el('g', { transform: 'translate(904,96)' });
    moon.appendChild(el('path', { d: 'M 6,-34 A 34,34 0 1,0 6,34 A 26,26 0 1,1 6,-34 Z', fill: 'rgba(230,210,164,0.12)', stroke: '#e6d2a4', 'stroke-width': 2.2, 'stroke-linejoin': 'round' }));
    moon.appendChild(el('circle', { cx: -4, cy: -4, r: 2.2, fill: '#e6d2a4' }));
    moon.appendChild(el('path', { d: 'M -14,10 Q -6,16 2,10', 'class': 'frame', 'stroke-width': 1.6, 'stroke-linecap': 'round' }));
    [[46, -30, 5], [56, 14, 3.5], [36, 40, 4]].forEach(function (s) {
      moon.appendChild(el('path', { d: 'M 0,-S L 1.3,-1.3 L S,0 L 1.3,1.3 L 0,S L -1.3,1.3 L -S,0 L -1.3,-1.3 Z'.replace(/S/g, s[2]), fill: '#e6d2a4', transform: 'translate(' + s[0] + ',' + s[1] + ')' }));
    });
    face.appendChild(moon);
    // words
    var t = function (txt, p, cls) {
      var e = el('text', { x: p.x, y: p.y, 'text-anchor': 'middle', 'dominant-baseline': 'central', 'class': cls });
      if (p.rot) e.setAttribute('transform', 'rotate(' + p.rot.toFixed(2) + ' ' + p.x.toFixed(1) + ' ' + p.y.toFixed(1) + ')');
      e.textContent = txt;
      return e;
    };
    face.appendChild(t('YES', POS.YES, 'word'));
    face.appendChild(t('NO', POS.NO, 'word'));
    face.appendChild(t('MARGINALIA', { x: 500, y: 92 }, 'brand'));
    face.appendChild(t('GOOD BYE', POS.GOODBYE, 'word'));
    face.appendChild(el('path', { d: 'M 300,572 Q 360,560 410,572', 'class': 'frame', 'stroke-width': 1.3, 'stroke-linecap': 'round' }));
    face.appendChild(el('path', { d: 'M 590,572 Q 640,560 700,572', 'class': 'frame', 'stroke-width': 1.3, 'stroke-linecap': 'round' }));
    for (var k in POS) {
      if (k.length !== 1) continue;
      face.appendChild(t(k, POS[k], /[0-9]/.test(k) ? 'num' : 'glyph'));
    }
  }

  // ---------- the planchette ----------
  var P = { x: REST.x, y: REST.y, rot: 0, shown: false };
  var gP, gLens, gBody;
  function renderP() {
    gP.setAttribute('transform', 'translate(' + P.x.toFixed(2) + ',' + P.y.toFixed(2) + ')');
    gLens.setAttribute('transform', 'scale(' + LENS_K + ') translate(' + (-P.x).toFixed(2) + ',' + (-P.y).toFixed(2) + ')');
    gBody.setAttribute('transform', 'rotate(' + P.rot.toFixed(2) + ')');
  }
  function showP(on) {
    P.shown = on;
    gP.style.display = on ? '' : 'none';
  }

  // ---------- timing helpers (cancellable per session) ----------
  var session = 0;              // bumps whenever the sitting is interrupted
  function wait(ms, tok) {
    return new Promise(function (res) {
      if (tok !== session) return res();
      setTimeout(res, reduced ? Math.min(ms, 420) : ms);
    });
  }
  function easeOutBack(t, s) { var u = t - 1; return 1 + u * u * ((s + 1) * u + s); }
  function easeInOut(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }
  function glide(target, tok, opts) {
    opts = opts || {};
    return new Promise(function (res) {
      if (tok !== session) return res();
      var from = { x: P.x, y: P.y };
      var dx = target.x - from.x, dy = target.y - from.y, dist = Math.hypot(dx, dy);
      if (dist < 0.5) return res();
      if (reduced && !opts.forceMotion) { P.x = target.x; P.y = target.y; P.rot = 0; renderP(); return res(); }
      var dur = opts.dur || Math.min(1300, Math.max(340, 260 + dist * 1.6)) * (0.85 + Math.random() * 0.3);
      var over = opts.overshoot != null ? opts.overshoot : 0.9 + Math.random() * 1.3;   // back-ease parameter
      var bulge = opts.bulge != null ? opts.bulge : (Math.random() - 0.5) * Math.min(60, dist * 0.22);
      var nx = -dy / dist, ny = dx / dist;
      var tilt = Math.max(-9, Math.min(9, dx / 40));
      var t0 = performance.now();
      function frame() {
        if (tok !== session) return res();
        var t = Math.max(0, Math.min(1, (performance.now() - t0) / dur));
        var e = opts.smooth ? easeInOut(t) : easeOutBack(t, over);
        var b = Math.sin(Math.PI * t) * bulge;
        P.x = from.x + dx * e + nx * b;
        P.y = from.y + dy * e + ny * b;
        P.rot = tilt * Math.sin(Math.PI * t);
        renderP();
        if (t < 1) requestAnimationFrame(frame); else { P.rot = 0; renderP(); res(); }
      }
      requestAnimationFrame(frame);
    });
  }
  // idle breathing while a spirit is present
  var idle = { on: false, t0: 0, base: null };
  function idleLoop() {
    if (!idle.on) return;
    if (!busy && !reduced && P.shown) {
      var t = (performance.now() - idle.t0) / 1000;
      P.x = idle.base.x + Math.sin(t * 0.7) * 3.5 + Math.sin(t * 1.9) * 1.2;
      P.y = idle.base.y + Math.cos(t * 0.55) * 2.5;
      P.rot = Math.sin(t * 0.4) * 1.5;
      renderP();
    }
    requestAnimationFrame(idleLoop);
  }
  function startIdle() {
    idle.base = { x: P.x, y: P.y };
    idle.t0 = performance.now();
    if (!idle.on) { idle.on = true; requestAnimationFrame(idleLoop); }
  }

  // ---------- sound ----------
  var audio = { on: false, ctx: null };
  function knock(strength) {
    if (!audio.on || !audio.ctx) return;
    var c = audio.ctx, t = c.currentTime, g = c.createGain();
    strength = strength || 0.5;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(strength, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    g.connect(c.destination);
    var o = c.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(55, t + 0.09);
    o.connect(g); o.start(t); o.stop(t + 0.18);
    // a short wooden click of filtered noise
    var len = Math.floor(c.sampleRate * 0.03), buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    var n = c.createBufferSource(); n.buffer = buf;
    var f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 0.8;
    var ng = c.createGain(); ng.gain.value = strength * 0.5;
    n.connect(f); f.connect(ng); ng.connect(c.destination); n.start(t); n.stop(t + 0.03);
  }
  function toggleKnock() {
    audio.on = !audio.on;
    $('btn-knock').classList.toggle('on', audio.on);
    if (audio.on) {
      try {
        if (!audio.ctx) audio.ctx = new (window.AudioContext || window.webkitAudioContext)();
        if (audio.ctx.state === 'suspended') audio.ctx.resume();
        knock(0.4);
      } catch (e) { audio.on = false; $('btn-knock').classList.remove('on'); }
    }
  }

  // ---------- state ----------
  var roster = [], spirit = null, chosenNear = false, asked = 0, possession = 0, sessions = 0;
  var busy = false, over = false, lastHand = null;
  var ledger = $('ledger');

  function timeNow() {
    var d = new Date();
    return [d.getHours(), d.getMinutes(), d.getSeconds()].map(function (n) { return (n < 10 ? '0' : '') + n; }).join(':');
  }
  function addEntry(q) {
    var empty = ledger.querySelector('.empty');
    if (empty) empty.remove();
    var li = document.createElement('li');
    var tm = document.createElement('time'); tm.textContent = timeNow();
    var qd = document.createElement('span'); qd.className = 'q'; qd.textContent = q;
    var head = document.createElement('div'); head.appendChild(tm); head.appendChild(qd);
    var a = document.createElement('div'); a.className = 'a';
    var caret = document.createElement('span'); caret.className = 'caret'; a.appendChild(caret);
    li.appendChild(head); li.appendChild(a);
    ledger.appendChild(li);
    ledger.scrollTop = ledger.scrollHeight;
    return { li: li, a: a, caret: caret };
  }
  function addNote(entry, text, plain) {
    var n = document.createElement('div'); n.className = 'note' + (plain ? ' plain' : ''); n.textContent = text;
    entry.li.appendChild(n);
    ledger.scrollTop = ledger.scrollHeight;
  }
  function addHandwritingNote(text) {
    var li = document.createElement('li'); li.className = 'handwriting'; li.textContent = text;
    ledger.appendChild(li);
    ledger.scrollTop = ledger.scrollHeight;
  }
  function pushChar(entry, ch) {
    var prev = entry.a.querySelector('.ch.last');
    if (prev) prev.classList.remove('last');
    var s = document.createElement('span'); s.className = 'ch last'; s.textContent = ch === ' ' ? ' ' : ch;
    if (ch === ' ') s.classList.remove('last');
    entry.a.insertBefore(s, entry.caret);
    ledger.scrollTop = ledger.scrollHeight;
    entry.text = (entry.text || '') + ch;
    setState(entry.text + '_', true);
  }
  function dropCarets() {
    ledger.querySelectorAll('.caret').forEach(function (c) { c.remove(); });
    ledger.querySelectorAll('.ch.last').forEach(function (c) { c.classList.remove('last'); });
  }
  function finishEntry(entry) {
    if (entry.caret.parentNode) entry.caret.remove();
    var prev = entry.a.querySelector('.ch.last');
    if (prev) prev.classList.remove('last');
  }

  function setSpiritLine() {
    var nameEl = $('spiritname'), countEl = $('spiritcount');
    if (!spirit) { nameEl.textContent = 'no one'; countEl.textContent = ''; return; }
    if (chosenNear && !over) { nameEl.textContent = 'someone'; countEl.textContent = '(unnamed until they leave)'; }
    else { nameEl.textContent = spirit.name; countEl.textContent = '· ' + spirit.count + (spirit.count === 1 ? ' book' : ' books'); }
  }
  function setState(text, live) {
    var s = $('state'); s.textContent = text; s.classList.toggle('live', !!live);
  }
  function setMeter() {
    var steps = S.POSSESSION_STEPS;
    $('meter').querySelector('.fill').style.width = (100 * possession / steps) + '%';
    $('meter').classList.toggle('full', possession >= steps);
    $('meterlabel').textContent = possession + ' / ' + steps;
  }

  function pickSpirit() {
    var v = $('spirit').value;
    chosenNear = (v === 'near');
    if (chosenNear) spirit = S.pickNear(roster, S.dateKey(), sessions);
    else spirit = roster[parseInt(v, 10)] || roster[0];
    lastHand = spirit;
    setSpiritLine();
  }

  // ---------- the sitting ----------
  function charPos(ch) {
    return POS[ch] || null;
  }
  function spell(result, entry, tok) {
    // returns a promise that resolves when the spelling is done (or interrupted)
    var seqs = [];
    if (result.kind === 'yes' || result.kind === 'no' || result.kind === 'goodbye') seqs = [result.words[0]];
    else seqs = result.words;
    return seqs.reduce(function (p, word, wi) {
      return p.then(function () {
        if (tok !== session) return;
        var chain = Promise.resolve();
        if (word === 'YES' || word === 'NO' || word === 'GOODBYE') {
          chain = chain.then(function () { return wait(200 + Math.random() * 300, tok); })
            .then(function () { return glide(POS[word], tok); })
            .then(function () { if (tok !== session) return; knock(0.55); for (var i = 0; i < word.length; i++) pushChar(entry, word[i]); return wait(900, tok); });
          return chain;
        }
        if (wi > 0) {
          // between words: a short drift toward the middle, a breath
          chain = chain.then(function () { return glide({ x: P.x + (500 - P.x) * 0.25 + (Math.random() - 0.5) * 30, y: P.y + (380 - P.y) * 0.25 + (Math.random() - 0.5) * 20 }, tok, { smooth: true, dur: 420, bulge: 0 }); })
            .then(function () { if (tok !== session) return; pushChar(entry, ' '); return wait(260 + Math.random() * 240, tok); });
        }
        for (var i = 0; i < word.length; i++) {
          (function (ch, idx) {
            chain = chain.then(function () {
              if (tok !== session) return;
              var pos = charPos(ch);
              if (!pos) { pushChar(entry, ch); return; }
              var pre = Promise.resolve();
              // hesitation: a pause, sometimes a false start in another direction
              pre = pre.then(function () { return wait(60 + Math.random() * 260 + (idx === 0 && wi === 0 ? 500 : 0), tok); });
              if (!reduced && Math.random() < 0.22) {
                pre = pre.then(function () {
                  var a = Math.random() * Math.PI * 2, d = 14 + Math.random() * 18;
                  return glide({ x: P.x + Math.cos(a) * d, y: P.y + Math.sin(a) * d }, tok, { smooth: true, dur: 260, bulge: 0 });
                }).then(function () { return wait(80 + Math.random() * 160, tok); });
              }
              return pre.then(function () { return glide(pos, tok); })
                .then(function () {
                  if (tok !== session) return;
                  knock(0.32 + Math.random() * 0.15);
                  pushChar(entry, ch);
                  return wait(380 + Math.random() * 320, tok);
                });
            });
          }(word[i], i));
        }
        return chain;
      });
    }, Promise.resolve());
  }

  function endSitting(entry, viaEscape) {
    over = true;
    busy = true;
    var tok = session;
    $('q').disabled = true; $('btn-ask').disabled = true; $('btn-bye').disabled = true;
    setState('the candle went out', false);
    var reveal = (chosenNear || lastHand !== spirit) ? 'the hand was ' + spirit.name + '’s.' : null;
    return wait(400, tok)
      .then(function () { return glide({ x: P.x + 40, y: 760 }, tok, { smooth: true, dur: 1500, bulge: 0, forceMotion: true }); })
      .then(function () {
        if (tok !== session) return;
        showP(false);
        $('boardwrap').classList.add('out');
        knock(0.5); setTimeout(function () { knock(0.5); }, 220); setTimeout(function () { knock(0.6); }, 440);
        if (entry) addNote(entry, 'The planchette slid off the board and the candle went out.' + (reveal ? ' ' + reveal : ''), !reveal);
        else if (reveal) addHandwritingNote(reveal);
        busy = false;
        chosenNear = false; setSpiritLine();
        $('relight').classList.add('show');
      });
  }

  function ask(question) {
    if (busy || over || !spirit) return;
    question = question.trim();
    if (!question) return;
    busy = true;
    session++;
    var tok = session;
    var result = S.ask(spirit, question, { date: S.dateKey(), asked: asked });
    asked++;
    var entry = addEntry(question);
    setState('spelling…', true);
    $('q').value = '';
    return spell(result, entry, tok).then(function () {
      if (tok !== session) return;
      finishEntry(entry);
      if (result.kind === 'recognise') addNote(entry, 'It recognises its own book: ' + result.book.t + (result.book.y ? ' (' + result.book.y + ')' : '') + '.');
      else if (result.kind === 'number') addNote(entry, 'A year. ' + result.book.t + '.', true);
      if (result.kind === 'goodbye') return endSitting(entry);
      possession = Math.min(S.POSSESSION_STEPS, possession + 1);
      setMeter();
      if (possession >= S.POSSESSION_STEPS) {
        // silently hand the planchette to someone else
        spirit = S.nextSpirit(roster, spirit, S.dateKey() + '|' + asked);
        possession = 0;
        setTimeout(function () { if (tok === session) { setMeter(); addHandwritingNote('— the handwriting has changed —'); } }, 900);
      }
      setState('listening', true);
      busy = false;
      return glide({ x: P.x + (REST.x - P.x) * 0.5 + (Math.random() - 0.5) * 40, y: P.y + (REST.y - P.y) * 0.5 + (Math.random() - 0.5) * 30 }, tok, { smooth: true, dur: 900, bulge: 0 })
        .then(function () { if (tok === session) startIdle(); });
    });
  }

  function sayGoodbye() {
    if (over || !spirit) return;
    session++;
    var tok = session;
    busy = true;
    dropCarets();
    var entry = addEntry('(goodbye)');
    setState('spelling…', true);
    return wait(300, tok).then(function () { return glide(POS.GOODBYE, tok); })
      .then(function () {
        if (tok !== session) return;
        knock(0.55);
        'GOODBYE'.split('').forEach(function (c) { pushChar(entry, c); });
        finishEntry(entry);
        return wait(700, tok);
      })
      .then(function () { if (tok === session) return endSitting(entry, true); });
  }

  function relight() {
    session++;
    over = false; busy = false; asked = 0; possession = 0; sessions++;
    $('boardwrap').classList.remove('out');
    $('relight').classList.remove('show');
    $('q').disabled = false; $('btn-ask').disabled = false; $('btn-bye').disabled = false;
    pickSpirit();
    P.x = REST.x; P.y = REST.y; P.rot = 0; renderP(); showP(true);
    setMeter();
    setState('listening', true);
    startIdle();
    $('q').focus();
  }

  // ---------- thumbnail state: mid-answer, lens over a letter ----------
  function thumbState() {
    var sp = roster.filter(function (s) { return s.name === 'Haruki Murakami'; })[0] || roster[1] || roster[0];
    spirit = sp; lastHand = sp; chosenNear = false;
    $('spirit').value = String(roster.indexOf(sp));
    setSpiritLine();
    var earlier = [['Is anyone there?', 'YES'], ['What did the wind say?', null]];
    earlier.forEach(function (e) {
      var r = e[1] ? { kind: 'yes', words: [e[1]] } : S.ask(sp, e[0], { date: '2026-10-02', asked: 1 });
      var en = addEntry(e[0]);
      r.words.join(' ').split('').forEach(function (c) { pushChar(en, c); });
      finishEntry(en);
      if (r.kind === 'recognise') addNote(en, 'It recognises its own book: ' + r.book.t + (r.book.y ? ' (' + r.book.y + ')' : '') + '.');
    });
    var q = 'What should I read tonight?';
    var r = S.ask(sp, q, { date: '2026-10-02', asked: 2 });
    if (r.words.length < 3) r = { kind: 'words', words: ['THE', 'WELL', 'BENEATH', 'THE', 'HOUSE'] };
    var text = r.words.join(' ');
    var upto = Math.min(text.length - 1, 16);
    while (upto > 0 && !POS[text[upto]]) upto--;
    var en = addEntry(q);
    for (var i = 0; i <= upto; i++) pushChar(en, text[i]);
    asked = 3; possession = 3; setMeter();
    var pos = POS[text[upto]];
    P.x = pos.x; P.y = pos.y; P.rot = -3; renderP(); showP(true);
    busy = true;
  }

  // ---------- wiring ----------
  function fillSelect() {
    var sel = $('spirit');
    sel.innerHTML = '';
    var near = document.createElement('option'); near.value = 'near'; near.textContent = 'whoever is near';
    sel.appendChild(near);
    roster.forEach(function (s, i) {
      var o = document.createElement('option'); o.value = String(i);
      o.textContent = s.name + ' — ' + s.count + (s.count === 1 ? ' book' : ' books');
      sel.appendChild(o);
    });
  }
  function wobbleLoop() {
    if (!ledger.classList.contains('auto') || reduced) return;
    var t = $('wobbleTurb');
    t.setAttribute('seed', String(1 + Math.floor(Math.random() * 60)));
    setTimeout(function () { requestAnimationFrame(wobbleLoop); }, 140);
  }
  function bind() {
    $('askform').addEventListener('submit', function (e) { e.preventDefault(); ask($('q').value); });
    $('spirit').addEventListener('change', function () {
      if (over) return;
      session++; busy = false;
      dropCarets();
      pickSpirit();
      asked = 0; possession = 0; setMeter();
      addHandwritingNote('— ' + (chosenNear ? 'someone else is near' : spirit.name + ' is called') + ' —');
      glide(REST, session, { smooth: true, dur: 800, bulge: 0 }).then(function () { startIdle(); });
    });
    $('btn-bye').addEventListener('click', function () { if (!over) sayGoodbye(); });
    $('btn-relight').addEventListener('click', relight);
    $('btn-knock').addEventListener('click', toggleKnock);
    $('btn-auto').addEventListener('click', function () {
      var on = ledger.classList.toggle('auto');
      $('btn-auto').classList.toggle('on', on);
      if (on) wobbleLoop();
    });
    $('btn-clear').addEventListener('click', function () {
      if (busy) return;
      ledger.innerHTML = '<li class="empty">Nothing has been asked yet.</li>';
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { if (!over && spirit) { e.preventDefault(); sayGoodbye(); } return; }
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
      if (e.key === 'a' || e.key === 'A') $('btn-auto').click();
      if (e.key === 'k' || e.key === 'K') $('btn-knock').click();
    });
  }

  function fontCheck() {
    // not a CDN script, just a courtesy note if the lettering did not arrive
    if (!document.fonts || !document.fonts.check) return;
    document.fonts.ready.then(function () {
      if (!document.fonts.check('16px "IM Fell English SC"')) {
        var w = $('cdnwarn'); w.textContent = 'The hand-lettered font did not load; the board is wearing a plain serif instead.'; w.classList.add('show');
      }
    }).catch(function () {});
  }

  function init() {
    gP = $('planchette'); gLens = $('lensInner'); gBody = $('pbody');
    drawBoard();
    renderP();
    bind();
    fontCheck();
    if (params.get('auto') === '1') $('btn-auto').click();
    fetch('../../assets/data/library.json').then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (lib) {
      roster = S.roster(lib.books || []);
      if (!roster.length) throw new Error('no authors');
      fillSelect();
      if (THUMB) { document.body.classList.add('thumb'); thumbState(); return; }
      pickSpirit();
      setMeter();
      showP(true);
      setState('listening', true);
      startIdle();
      var pre = (params.get('q') || '').slice(0, 160);
      if (pre) { $('q').value = pre; requestAnimationFrame(function () { ask(pre); }); }
    }).catch(function (err) {
      setState('the shelves could not be reached (' + err.message + ')', false);
      $('spirit').innerHTML = '<option>no spirits</option>';
      $('q').disabled = true; $('btn-ask').disabled = true;
    });
  }
  if (!S) {
    setState('seance.js failed to load', false);
    return;
  }
  init();
}());
