/* Babel Hexagon: the reading room (all DOM work). The Library itself is in babel.js. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var B = window.Babel;
  var SVGNS = 'http://www.w3.org/2000/svg';
  var ROMAN = ['', 'I', 'II', 'III', 'IV'];
  var BM_KEY = 'babel-hexagon:bookmarks';
  var THUMB_LINE = 'the library is unlimited and cyclical';

  if (!B) {
    $('sheet').innerHTML = '<div class="msg">The Library script (babel.js) did not load, so no page can be opened. Reload the page to try again.</div>';
    return;
  }
  var WORDS = new Set((window.BABEL_WORDS || '').split(' ').filter(Boolean));

  var state = {
    addr: null,          // the current address (normalized)
    page: '',            // its 3200 characters
    hit: null,           // {offset, length, addr}: a search hit to highlight on this page
    english: true,       // highlight accidental English
    spans: [],           // [[start, end), ...] of English words on the current page
    elevationKey: ''     // hex:wall last drawn in the elevation
  };

  /* ---------- small helpers ---------- */
  function svg(tag, attrs, parent) {
    var e = document.createElementNS(SVGNS, tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function shortHex(h) { return h.length <= 16 ? h : h.slice(0, 9) + '…' + h.slice(-4); }
  function addrLabel(a) { return shortHex(a.hex) + ' · ' + ROMAN[a.wall] + ' · ' + a.shelf + ' · ' + a.volume + ' · p.' + a.page; }
  function fmt(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function escapeHtml(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function copyText(text, btn, done) {
    var label = btn ? btn.textContent : '';
    var flash = function (ok) {
      if (!btn) return;
      btn.textContent = ok ? (done || 'copied') : 'copy failed';
      setTimeout(function () { btn.textContent = label; }, 1300);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { flash(true); }, function () { flash(false); });
    } else {
      var ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      flash(ok);
    }
  }

  /* ---------- the plan of the hexagon ---------- */
  var CX = 220, CY = 118, R = 92;
  var verts = [];
  for (var i = 0; i < 6; i++) {
    var ang = (-90 + 60 * i) * Math.PI / 180;
    verts.push([CX + R * Math.cos(ang), CY + R * Math.sin(ang)]);
  }
  // walls: 1 top-left, 2 top-right, 3 bottom-right, 4 bottom-left; the vertical sides are vestibules
  var WALL_SIDES = { 1: [5, 0], 2: [0, 1], 3: [2, 3], 4: [3, 4] };
  var VESTIBULES = [[1, 2], [4, 5]];
  var wallGroups = {};

  function buildPlan() {
    var g = $('plan');
    var pts = function (arr) { return arr.map(function (p) { return p[0].toFixed(1) + ',' + p[1].toFixed(1); }).join(' '); };
    // neighbouring galleries, faint
    var dx = Math.sqrt(3) * R;
    [[CX - dx, CY], [CX + dx, CY]].forEach(function (c) {
      var vs = [];
      for (var i = 0; i < 6; i++) { var a = (-90 + 60 * i) * Math.PI / 180; vs.push([c[0] + R * Math.cos(a), c[1] + R * Math.sin(a)]); }
      svg('polygon', { 'class': 'ghost', points: pts(vs) }, g);
    });
    svg('polygon', { 'class': 'outline', points: pts(verts) }, g);
    // the lamp
    svg('circle', { 'class': 'lamp', cx: CX, cy: CY, r: 30 }, g);
    svg('circle', { 'class': 'lamp-core', cx: CX, cy: CY, r: 2.6 }, g);
    // vestibules: a doorway in each vertical side and a spiral stair beyond it
    VESTIBULES.forEach(function (side, idx) {
      var P = verts[side[0]], Q = verts[side[1]];
      var mx = (P[0] + Q[0]) / 2, my = (P[1] + Q[1]) / 2;
      svg('line', { 'class': 'door', x1: mx, y1: my - 11, x2: mx, y2: my + 11 }, g);
      var sx = mx + (idx === 0 ? 1 : -1) * 20, sy = my;
      var d = '';
      for (var t = 0; t <= 40; t++) { var a = t / 40 * Math.PI * 4, r = 1 + t / 40 * 8; d += (t ? 'L' : 'M') + (sx + r * Math.cos(a)).toFixed(1) + ' ' + (sy + r * Math.sin(a)).toFixed(1); }
      svg('path', { 'class': 'stair', d: d }, g);
      var cap = svg('text', { 'class': 'cap', x: sx, y: sy + 22, 'text-anchor': 'middle' }, g);
      cap.textContent = 'stair';
    });
    // the four walls of shelves
    for (var w = 1; w <= 4; w++) {
      var s = WALL_SIDES[w], P = verts[s[0]], Q = verts[s[1]];
      var len = Math.hypot(Q[0] - P[0], Q[1] - P[1]);
      var dir = [(Q[0] - P[0]) / len, (Q[1] - P[1]) / len];
      var mid = [(P[0] + Q[0]) / 2, (P[1] + Q[1]) / 2];
      var nl = Math.hypot(CX - mid[0], CY - mid[1]);
      var n = [(CX - mid[0]) / nl, (CY - mid[1]) / nl];
      var inset = 7;
      var P2 = [P[0] + dir[0] * inset, P[1] + dir[1] * inset], Q2 = [Q[0] - dir[0] * inset, Q[1] - dir[1] * inset];
      var L2 = len - 2 * inset;
      var off = function (p, k) { return [p[0] + n[0] * k, p[1] + n[1] * k]; };
      var wg = svg('g', { 'class': 'wall', 'data-wall': w, role: 'button', tabindex: 0, 'aria-label': 'wall ' + ROMAN[w] }, g);
      svg('polygon', { 'class': 'band', points: pts([off(P2, 3), off(Q2, 3), off(Q2, 17), off(P2, 17)]) }, wg);
      for (var k = 0; k < 32; k++) {
        var t = (k + 0.5) / 32;
        var pos = [P2[0] + dir[0] * L2 * t, P2[1] + dir[1] * L2 * t];
        var a = off(pos, 4.5), b = off(pos, 15.5);
        svg('line', { 'class': 'tick', x1: a[0].toFixed(1), y1: a[1].toFixed(1), x2: b[0].toFixed(1), y2: b[1].toFixed(1) }, wg);
      }
      var lp = off(mid, 29);
      var lbl = svg('text', { 'class': 'lbl', x: lp[0].toFixed(1), y: lp[1].toFixed(1), 'text-anchor': 'middle', 'dominant-baseline': 'middle' }, wg);
      lbl.textContent = ROMAN[w];
      wallGroups[w] = wg;
    }
    var cap1 = svg('text', { 'class': 'cap', x: CX, y: 232, 'text-anchor': 'middle' }, g);
    cap1.textContent = 'the gallery, from above: four walls of shelves, two vestibules';
  }

  /* ---------- the elevation of one wall ---------- */
  var EX = 28, EY = 268, EW = 400, ROWH = 40, SPINE_W = 11, SPINE_STEP = (EW - 8) / 32;
  var SPINE_COLORS = ['#5b2a1e', '#3f4a2d', '#2f3a52', '#6b4a22', '#4a2f3f', '#7a3a24', '#2f4a44', '#5d4a1f'];
  var shelfGroups = {}, spineRects = {};
  var elevTitle, elevSub;

  function buildElevation() {
    var g = $('elevation');
    elevTitle = svg('text', { 'class': 'lbl on', x: EX, y: 256 }, g);
    elevSub = svg('text', { 'class': 'cap', x: EX + EW, y: 256, 'text-anchor': 'end' }, g);
    for (var s = 1; s <= 5; s++) {
      var y = EY + (s - 1) * ROWH;
      var sg = svg('g', { 'class': 'shelf', 'data-shelf': s, role: 'button', tabindex: 0, 'aria-label': 'shelf ' + s }, g);
      svg('rect', { 'class': 'glow', x: EX, y: y, width: EW, height: ROWH, rx: 2 }, sg);
      var num = svg('text', { 'class': 'cap', x: EX - 8, y: y + ROWH - 7, 'text-anchor': 'end' }, sg);
      num.textContent = s;
      for (var v = 1; v <= 32; v++) {
        var r = svg('rect', { 'class': 'spine', 'data-volume': v, x: (EX + 4 + (v - 1) * SPINE_STEP).toFixed(1), width: SPINE_W, y: y + 10, height: ROWH - 14, rx: 1 }, sg);
        spineRects[s + ':' + v] = r;
      }
      svg('rect', { 'class': 'plank', x: EX, y: y + ROWH - 4, width: EW, height: 4 }, sg);
      shelfGroups[s] = sg;
    }
    var cap = svg('text', { 'class': 'cap', x: EX, y: EY + 5 * ROWH + 14 }, g);
    cap.textContent = 'click a wall, a shelf, a spine';
  }

  // the spines of one wall: heights and leathers drawn from a generator seeded by hexagon and wall
  function dressElevation(hex, wall) {
    var key = hex + ':' + wall;
    if (key === state.elevationKey) return;
    state.elevationKey = key;
    var r = B.rng('spines:' + key);
    for (var s = 1; s <= 5; s++) {
      var bottom = EY + (s - 1) * ROWH + ROWH - 4;
      for (var v = 1; v <= 32; v++) {
        var h = 20 + Math.floor(r() * 10);
        var rect = spineRects[s + ':' + v];
        rect.setAttribute('height', h);
        rect.setAttribute('y', bottom - h);
        rect.setAttribute('fill', SPINE_COLORS[Math.floor(r() * SPINE_COLORS.length)]);
      }
    }
    elevTitle.textContent = 'Wall ' + ROMAN[wall];
  }

  function renderRoom() {
    var a = state.addr;
    for (var w = 1; w <= 4; w++) {
      wallGroups[w].classList.toggle('on', w === a.wall);
      wallGroups[w].querySelector('.lbl').classList.toggle('on', w === a.wall);
    }
    dressElevation(a.hex, a.wall);
    for (var s = 1; s <= 5; s++) shelfGroups[s].classList.toggle('on', s === a.shelf);
    var prev = $('room').querySelector('.spine.on');
    if (prev) prev.classList.remove('on');
    spineRects[a.shelf + ':' + a.volume].classList.add('on');
    elevSub.textContent = 'shelf ' + a.shelf + ' · volume ' + a.volume + ' of 32 · page ' + a.page + ' of 410';
  }

  /* ---------- the page ---------- */
  function renderSheet() {
    var page = state.page, cls = new Uint8Array(page.length);
    var i, j;
    for (i = 0; i < state.spans.length; i++) for (j = state.spans[i][0]; j < state.spans[i][1]; j++) cls[j] = 1;
    if (state.hit) for (j = state.hit.offset; j < state.hit.offset + state.hit.length && j < page.length; j++) cls[j] = cls[j] === 1 ? 3 : 2;
    var MARK = { 1: '<mark>', 2: '<mark class="hit">', 3: '<mark class="hit en">' };
    var html = '';
    for (var ln = 0; ln < B.LINES; ln++) {
      var start = ln * B.COLS, end = start + B.COLS, cur = 0, seg = '';
      html += '<div class="ln"><span class="n">' + (ln + 1) + '</span><span class="t">';
      for (j = start; j <= end; j++) {
        var c = j < end ? cls[j] : -1;
        if (c !== cur) {
          if (cur > 0) html += MARK[cur] + seg + '</mark>';
          else html += seg;
          seg = ''; cur = c;
        }
        if (j < end) seg += page[j];
      }
      html += '</span></div>';
    }
    $('sheet').innerHTML = html;
  }

  function renderWords() {
    var count = state.spans.length;
    $('stats').innerHTML = state.english ? '<b>' + count + '</b> accidental ' + (count === 1 ? 'word' : 'words') : 'English finder off';
    var box = $('words');
    if (!state.english) { box.innerHTML = ''; return; }
    var seen = {}, list = [];
    state.spans.forEach(function (sp) {
      var w = state.page.slice(sp[0], sp[1]);
      if (!seen[w]) { seen[w] = 0; list.push(w); }
      seen[w]++;
    });
    list.sort(function (x, y) { return y.length - x.length || x.localeCompare(y); });
    box.innerHTML = list.length
      ? 'On this page: ' + list.slice(0, 60).map(function (w) { return '<span class="w">' + w + (seen[w] > 1 ? ' ×' + seen[w] : '') + '</span>'; }).join('')
      : '<span class="hint">No English of four letters or more on this page. Most pages have two or three words by accident.</span>';
  }

  function renderPlate() {
    var a = state.addr;
    $('plate-hex').textContent = shortHex(a.hex);
    $('plate-hexlen').textContent = a.hex.length > 16 ? fmt(a.hex.length) + ' characters' : '';
    $('plate-wall').textContent = ROMAN[a.wall];
    $('plate-shelf').textContent = a.shelf;
    $('plate-vol').textContent = a.volume;
    $('plate-page').textContent = a.page;
    $('pn').textContent = a.page;
    $('slider').value = a.page;
    if (!$('goto').hidden) fillGoto();
  }

  function renderAll() {
    renderRoom();
    renderPlate();
    state.spans = state.english ? B.findWords(state.page, WORDS) : [];
    renderSheet();
    renderWords();
    renderBookmarkState();
  }

  /* ---------- navigation ---------- */
  var settingHash = false;
  function go(addr, opts) {
    opts = opts || {};
    addr = B.normalizeAddress(addr);
    state.addr = addr;
    state.page = B.pageFromAddress(addr);
    if (opts.hit) state.hit = { offset: opts.hit.offset, length: opts.hit.length, addr: addr };
    else if (state.hit && !B.sameAddress(state.hit.addr, addr)) state.hit = null;
    var h = '#' + B.formatHash(addr);
    if (!opts.fromHash && location.hash !== h) {
      settingHash = true;
      try { location.hash = h; } catch (e) { /* ignore */ }
      settingHash = false;
    }
    renderAll();
    if (opts.scroll) $('page-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  window.addEventListener('hashchange', function () {
    if (settingHash) return;
    var a = B.parseHash(location.hash);
    if (a && !B.sameAddress(a, state.addr)) go(a, { fromHash: true });
  });

  $('btn-prev').addEventListener('click', function () { go(B.step(state.addr, -1)); });
  $('btn-next').addEventListener('click', function () { go(B.step(state.addr, 1)); });
  $('btn-prev-vol').addEventListener('click', function () { go(B.stepVolume(state.addr, -1)); });
  $('btn-next-vol').addEventListener('click', function () { go(B.stepVolume(state.addr, 1)); });
  $('btn-random').addEventListener('click', function () { go(B.randomAddress()); });
  $('slider').addEventListener('input', function () {
    var a = Object.assign({}, state.addr, { page: +this.value });
    go(a);
  });
  $('btn-link').addEventListener('click', function () {
    var url = location.href.split('#')[0].replace(/\?thumb=1$/, '') + '#' + B.formatHash(state.addr);
    copyText(url, this);
  });

  // the room
  $('room').addEventListener('click', function (e) {
    var t = e.target;
    var spine = t.closest('.spine'), shelf = t.closest('.shelf'), wall = t.closest('.wall');
    if (spine && shelf) {
      go(Object.assign({}, state.addr, { shelf: +shelf.getAttribute('data-shelf'), volume: +spine.getAttribute('data-volume'), page: 1 }));
    } else if (shelf) {
      go(Object.assign({}, state.addr, { shelf: +shelf.getAttribute('data-shelf'), volume: 1, page: 1 }));
    } else if (wall) {
      go(Object.assign({}, state.addr, { wall: +wall.getAttribute('data-wall'), shelf: 1, volume: 1, page: 1 }));
    }
  });
  $('room').addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.target.dispatchEvent(new MouseEvent('click', { bubbles: true })); }
  });

  // the go-to form
  function fillGoto() {
    var a = state.addr;
    $('goto-hex').value = a.hex; $('goto-wall').value = a.wall; $('goto-shelf').value = a.shelf;
    $('goto-vol').value = a.volume; $('goto-page').value = a.page;
  }
  $('btn-goto').addEventListener('click', function () {
    var f = $('goto');
    f.hidden = !f.hidden;
    if (!f.hidden) { fillGoto(); $('goto-hex').focus(); }
  });
  $('goto').addEventListener('submit', function (e) {
    e.preventDefault();
    var raw = $('goto-hex').value, hex = B.canonicalHexName(raw);
    var a = { hex: hex, wall: $('goto-wall').value, shelf: $('goto-shelf').value, volume: $('goto-vol').value, page: $('goto-page').value };
    var msg = '';
    if (hex.length > B.MAX_HEX_LEN) { a = B.canonicalAddress(a); msg = 'past the end of the Library: wrapped around'; }
    else if (raw.replace(/[^0-9a-z]/gi, '').replace(/^0+/, '') !== hex && raw.trim() !== '' && raw.trim() !== hex) msg = 'name folded to 0-9 and a-z';
    $('goto-msg').textContent = msg;
    go(a);
  });
  $('btn-copy-hex').addEventListener('click', function () { copyText(state.addr.hex, this); });

  /* ---------- search ---------- */
  var MODES = [
    { id: 'exact', k: 'Exact match', d: 'your text somewhere on a page of noise' },
    { id: 'title', k: 'Title match', d: 'your text at the top of the page' },
    { id: 'spaces', k: 'Only your text', d: 'then nothing but spaces' }
  ];
  function doSearch() {
    var raw = $('q').value, t = B.normalize(raw);
    var out = $('results');
    if (!t) { out.innerHTML = '<span class="hint">Nothing survives folding: use letters, spaces, commas and periods.</span>'; return; }
    var folded = t !== raw;
    $('q-hint').textContent = folded ? 'Folded to the Library’s 29 symbols: “' + (t.length > 60 ? t.slice(0, 57) + '…' : t) + '”' : 'Found. All three are real pages; open one.';
    out.innerHTML = '';
    MODES.forEach(function (m) {
      var r = B.search(t, m.id);
      var line0 = Math.floor(r.offset / B.COLS) * B.COLS;
      var lineText = r.page.substr(line0, B.COLS);
      var hs = r.offset - line0, he = Math.min(B.COLS, hs + r.length);
      var prev = escapeHtml(lineText.slice(0, hs)) + '<b>' + escapeHtml(lineText.slice(hs, he)) + '</b>' + escapeHtml(lineText.slice(he));
      var div = document.createElement('div');
      div.className = 'res';
      div.innerHTML = '<span class="k">' + m.k + ' — <span style="text-transform:none;letter-spacing:0;color:var(--ink-3)">' + m.d + '</span></span>' +
        '<button class="small">open</button>' +
        '<span class="prev">' + (r.offset >= B.COLS ? '… ' : '') + 'line ' + (line0 / B.COLS + 1) + ': ' + prev + '</span>' +
        '<span class="addr">hexagon <code>' + shortHex(r.address.hex) + '</code> (' + fmt(r.address.hex.length) + ' chars) · wall ' + ROMAN[r.address.wall] + ' · shelf ' + r.address.shelf + ' · volume ' + r.address.volume + ' · page ' + r.address.page + '</span>';
      div.querySelector('button').addEventListener('click', function () {
        go(r.address, { hit: { offset: r.offset, length: r.length }, scroll: window.innerWidth <= 900 });
      });
      out.appendChild(div);
    });
  }
  $('btn-search').addEventListener('click', doSearch);
  $('q').addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSearch(); } });

  /* ---------- bookmarks ---------- */
  function loadBookmarks() { try { return JSON.parse(localStorage.getItem(BM_KEY) || '[]') || []; } catch (e) { return []; } }
  function saveBookmarks(list) { try { localStorage.setItem(BM_KEY, JSON.stringify(list)); } catch (e) { /* storage blocked */ } }
  function currentHash() { return B.formatHash(state.addr); }
  function bookmarkLabel() {
    var t = state.hit ? state.page.substr(state.hit.offset, state.hit.length) : state.page.replace(/^[ ,.]+/, '');
    t = t.trim().slice(0, 48);
    return t || '(blank)';
  }
  function toggleBookmark() {
    var list = loadBookmarks(), h = currentHash();
    var idx = list.findIndex(function (b) { return b.h === h; });
    if (idx >= 0) list.splice(idx, 1); else list.unshift({ h: h, t: bookmarkLabel(), ts: Date.now() });
    saveBookmarks(list);
    renderBookmarks();
    renderBookmarkState();
  }
  function renderBookmarkState() {
    var h = currentHash(), on = loadBookmarks().some(function (b) { return b.h === h; });
    var btn = $('btn-bookmark');
    btn.classList.toggle('on', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    btn.innerHTML = on ? '&#9733;' : '&#9734;';
    var rows = $('bookmarks').querySelectorAll('.bm');
    for (var i = 0; i < rows.length; i++) rows[i].classList.toggle('now', rows[i].getAttribute('data-h') === h);
  }
  function renderBookmarks() {
    var list = loadBookmarks(), box = $('bookmarks');
    box.innerHTML = '';
    if (!list.length) { box.innerHTML = '<span class="hint">Nothing marked yet. Press the star above the page, or <kbd>B</kbd>.</span>'; return; }
    list.forEach(function (b) {
      var a = B.parseHash(b.h);
      if (!a) return;
      var row = document.createElement('div');
      row.className = 'bm'; row.setAttribute('data-h', b.h); row.setAttribute('role', 'button'); row.tabIndex = 0;
      row.innerHTML = '<span class="t"></span><button class="x" title="remove">×</button><span class="a"></span>';
      row.querySelector('.t').textContent = b.t;
      row.querySelector('.a').textContent = addrLabel(a);
      row.addEventListener('click', function (e) {
        if (e.target.closest('.x')) {
          saveBookmarks(loadBookmarks().filter(function (x) { return x.h !== b.h; }));
          renderBookmarks(); renderBookmarkState();
        } else go(a);
      });
      row.addEventListener('keydown', function (e) { if (e.key === 'Enter') go(a); });
      box.appendChild(row);
    });
  }
  $('btn-bookmark').addEventListener('click', toggleBookmark);

  /* ---------- the English finder ---------- */
  $('btn-english').addEventListener('click', function () {
    state.english = !state.english;
    this.classList.toggle('on', state.english);
    state.spans = state.english ? B.findWords(state.page, WORDS) : [];
    renderSheet(); renderWords();
  });

  var mining = false;
  function mine() {
    if (mining) return;
    mining = true;
    var btn = $('btn-mine'), out = $('mine-out'), bar = $('mine-bar').firstElementChild;
    btn.disabled = true;
    $('mine-bar').classList.add('on');
    var start = Date.now(), DURATION = 2000, count = 0, best = null, bestScore = -1;
    var r = B.rng(start);
    var MAX_PAGES = 20000;
    var slice = function () {
      var sliceEnd = Date.now() + 40, n = 0;
      while (n++ < 60 && count < MAX_PAGES && Date.now() < sliceEnd) {
        var a = B.randomAddress(r), page = B.pageFromAddress(a), spans = B.findWords(page, WORDS);
        var letters = 0;
        for (var i = 0; i < spans.length; i++) letters += spans[i][1] - spans[i][0];
        var score = spans.length * 100 + letters;
        if (score > bestScore) { bestScore = score; best = { addr: a, spans: spans, page: page }; }
        count++;
      }
      var elapsed = Date.now() - start;
      bar.style.width = Math.min(100, elapsed / DURATION * 100) + '%';
      out.innerHTML = 'Read <b>' + fmt(count) + '</b> pages… best so far: <b>' + best.spans.length + '</b> words';
      if (elapsed < DURATION && count < MAX_PAGES) setTimeout(slice, 0);
      else finish();
    };
    var finish = function () {
      mining = false; btn.disabled = false; bar.style.width = '0';
      $('mine-bar').classList.remove('on');
      var words = best.spans.map(function (sp) { return best.page.slice(sp[0], sp[1]); });
      out.innerHTML = 'Read <b>' + fmt(count) + '</b> pages in two seconds. The most English one has <b>' + best.spans.length + '</b> words (' +
        words.slice(0, 8).join(', ') + (words.length > 8 ? ', …' : '') + ') at ' + addrLabel(best.addr) + '. ';
      var open = document.createElement('button');
      open.className = 'small'; open.textContent = 'open it';
      open.addEventListener('click', function () { go(best.addr, { scroll: window.innerWidth <= 900 }); });
      out.appendChild(open);
    };
    setTimeout(slice, 0);
  }
  $('btn-mine').addEventListener('click', mine);

  /* ---------- fit the 80 columns to the sheet ---------- */
  var charRatio = 0.6;
  function measureRatio() {
    var probe = document.createElement('span');
    probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre;font-family:' + getComputedStyle($('sheet')).fontFamily + ';font-size:100px';
    probe.textContent = 'mmmmmmmmmmmmmmmmmmmm';
    document.body.appendChild(probe);
    var w = probe.getBoundingClientRect().width;
    document.body.removeChild(probe);
    if (w > 0) charRatio = w / 20 / 100;
  }
  function fitFont() {
    var wrap = $('sheet-wrap'), cs = getComputedStyle(wrap);
    var avail = wrap.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    var fs = avail / (B.COLS * charRatio + 3.5);
    fs = Math.max(5.2, Math.min(12.5, fs));
    document.documentElement.style.setProperty('--page-fs', fs.toFixed(2) + 'px');
  }
  window.addEventListener('resize', fitFont);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { measureRatio(); fitFont(); });

  /* ---------- keys ---------- */
  document.addEventListener('keydown', function (e) {
    var tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea') { if (e.key === 'Escape') e.target.blur(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    switch (e.key) {
      case 'ArrowLeft': e.preventDefault(); go(e.shiftKey ? B.stepVolume(state.addr, -1) : B.step(state.addr, -1)); break;
      case 'ArrowRight': e.preventDefault(); go(e.shiftKey ? B.stepVolume(state.addr, 1) : B.step(state.addr, 1)); break;
      case 'r': case 'R': go(B.randomAddress()); break;
      case 'b': case 'B': toggleBookmark(); break;
      case 'e': case 'E': $('btn-english').click(); break;
      case '/': e.preventDefault(); $('q').focus(); break;
    }
  });

  /* ---------- start ---------- */
  buildPlan();
  buildElevation();
  measureRatio();
  fitFont();
  renderBookmarks();
  var params = new URLSearchParams(location.search);
  var fromHash = B.parseHash(location.hash);
  if (fromHash) {
    go(fromHash, { fromHash: true });
  } else if (params.get('thumb') === '1') {
    var r = B.search(THUMB_LINE, 'exact');
    $('q').value = THUMB_LINE;
    doSearch();
    go(r.address, { hit: { offset: r.offset, length: r.length } });
  } else {
    // today's page: a fresh gallery each day, the same for everyone
    var d = new Date(), iso = d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
    go(B.randomAddress(B.rng('day:' + iso), 6), { fromHash: true });
  }
})();
