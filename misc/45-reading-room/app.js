/* Reading Room: an isometric model of the library, drawn on one canvas.
 *
 * Pieces (bookcases, desk, chair...) are rendered once each into an offscreen
 * canvas at the current zoom; the per-frame loop only composites those images,
 * the avatar, the cat, the clock hands and the lighting. layout.js holds the
 * furniture catalogue and the default floor plan; sprites.js draws the props.
 */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var RL = window.ReadingRoomLayout, SPR = window.ReadingRoomSprites;
  var params = new URLSearchParams(location.search);
  var THUMB = params.get('thumb') === '1';
  var REDUCED = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var STORE = 'readingroom.layout.v1';

  var TW = 80, TH = 40, HZ = 36;        // tile width/height and one height unit, in scene px at zoom 1
  var WALL_H = 6.4;
  var ZMIN = 0.45, ZMAX = 4;

  if (!RL || !SPR) { showMsg('The room scripts did not load.'); return; }
  if (window.CanvasRenderingContext2D && !CanvasRenderingContext2D.prototype.roundRect) {
    CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h) { this.rect(x, y, w, h); };
  }
  var SPECS = RL.SPECS, UNITS = RL.UNITS, GENRE_HUE = RL.GENRE_HUE, DEFAULT = RL.DEFAULT_LAYOUT;

  // ---- DOM ------------------------------------------------------------------
  var stage = $('stage'), view = $('view'), ctx = view.getContext('2d');
  var whereEl = $('where'), keysEl = $('keys'), tipEl = $('tip'), legendEl = $('legend');
  var shelfEl = $('shelf'), shelvesEl = $('shelves'), cutin = $('cutin');
  var cardEl = $('card'), shadeEl = $('shade');
  var findEl = $('find'), resultsEl = $('results');
  var arrbar = $('arrbar');

  // ---- state ----------------------------------------------------------------
  var books = [], objects = [], byId = {}, shelfItems = {}, unitCounts = {}, searchIndex = [];
  var layout, pieces = [], pieceById = {}, pieceByUnit = {};
  var cols = DEFAULT.room.cols, rows = DEFAULT.room.rows, obs;
  var W = 1280, H = 800, dpr = 1;
  var cam = { x: 0, y: 0, z: 1.3 };
  var cacheZ = 1.3, zoomTimer = 0;
  var follow = true, fly = null;
  var mode = 'walk', night = false, labels = THUMB, arranging = false, paint = 'genre';
  var caches = {};
  var keys = {};
  var hover = null, nearPiece = null;
  var motes = [];
  var shelfOpenFor = null, lastFocus = null;
  var undoStack = [];
  var selected = null, drag = null, pointers = {}, pinch = null;
  var nightCanvas = document.createElement('canvas'), nightCtx = nightCanvas.getContext('2d');
  var now = 0, lastT = 0;

  var avatar = { x: 4.5, y: 2.6, dx: 0, dy: 1, walk: 0, moving: false, path: [] };
  var cat = { x: 12, y: 3.5, dx: 1, dy: 0, state: 'sleep', t: 0, path: [], spot: 1, walk: 0 };

  // ---- utilities --------------------------------------------------------------
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function hash(s) { return SPR.hash(String(s)); }
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function fmt(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function plural(n, w) { return fmt(n) + ' ' + w + (n === 1 ? '' : 's'); }
  function showMsg(t) { var m = $('msg'); m.textContent = t; m.classList.add('show'); }
  function store(key, val) { try { if (val == null) localStorage.removeItem(key); else localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* private mode */ } }
  function load(key) { try { var v = localStorage.getItem(key); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
  function norm(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
      .replace(/[ァ-ヶ]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0x60); })
      .replace(/[！-～]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xfee0); });
  }
  function P(gx, gy, z) { return { x: (gx - gy) * TW / 2, y: (gx + gy) * TH / 2 - (z || 0) * HZ }; }
  function toScreen(sx, sy) { return { x: (sx - cam.x) * cam.z + W / 2, y: (sy - cam.y) * cam.z + H / 2 }; }
  function toScene(X, Y) { return { x: (X - W / 2) / cam.z + cam.x, y: (Y - H / 2) / cam.z + cam.y }; }
  function toTile(X, Y) { var s = toScene(X, Y); return { x: s.x / TW + s.y / TH, y: s.y / TH - s.x / TW }; }

  // ---- books: sizes and colours --------------------------------------------------
  var SIZES = {
    Manga: [0.04, 0.38], 'Light novel': [0.04, 0.38], Comics: [0.06, 0.55], Fiction: [0.05, 0.47], Poetry: [0.045, 0.5],
    Drama: [0.045, 0.5], Essays: [0.05, 0.5], Anthology: [0.07, 0.52], Art: [0.07, 0.72], Magazine: [0.05, 0.7],
    Textbook: [0.1, 0.62], Reference: [0.09, 0.6], 'Language study': [0.06, 0.52], 'Test prep': [0.07, 0.65],
    'Nursing & medical': [0.09, 0.6], History: [0.07, 0.56], Philosophy: [0.06, 0.52], Religion: [0.06, 0.5], Hymnal: [0.07, 0.52],
    Science: [0.07, 0.58], 'Picture book': [0.03, 0.6], Calendar: [0.05, 0.4], Documents: [0.03, 0.7], 'Math journal': [0.04, 0.65],
    Technical: [0.09, 0.6], 'Writing craft': [0.055, 0.5], 'Self-help': [0.055, 0.5], 'Literary criticism': [0.06, 0.52],
  };
  function spineSize(b) {
    var s = SIZES[b.ty] || [0.055, 0.5];
    var w = s[0], h = s[1];
    if (b.l === 'JA' && /^(Fiction|Essays|Poetry|Philosophy|Light novel|Manga|History|Self-help)$/.test(b.ty)) { w = 0.035; h = 0.37; }
    w *= 0.85 + 0.3 * clamp((b.d || '').length / 320, 0, 1);
    h *= 0.96 + (hash(b.id) % 9) / 100;
    return [w, h];
  }
  function eraHue(y) {
    if (!y) return -1;
    if (y < 1800) return 20; if (y < 1900) return 36; if (y < 1950) return 52; if (y < 1980) return 140;
    if (y < 2000) return 190; if (y < 2010) return 230; if (y < 2020) return 270; return 310;
  }
  function langHue(l) { if (l === 'JA') return 354; if (/^EN(\/|$)/.test(l) && l !== 'EN/JA') return 214; return 42; }
  function colorOf(it) {
    var c = it.col[paint];
    if (c) return c;
    var b = it.b, hue, h = hash(b.id);
    if (it.obj) hue = -1;
    else if (paint === 'lang') hue = langHue(b.l);
    else if (paint === 'era') hue = eraHue(b.y);
    else { hue = GENRE_HUE[b.g]; if (hue == null || b.g === 'Unidentified' || b.g === 'Games & other objects') hue = -1; }
    var sat = hue < 0 ? 6 : 46 + h % 14, light = 40 + (h >> 4) % 18;
    c = 'hsl(' + (hue < 0 ? 30 : hue) + ',' + sat + '%,' + light + '%)';
    it.col[paint] = c;
    return c;
  }
  function prepItems() {
    books.forEach(function (b) { addItem(b, false); });
    objects.forEach(function (o) { addItem(o, true); });
    Object.keys(shelfItems).forEach(function (k) { shelfItems[k].sort(function (a, b) { return (a.b.p || 0) - (b.b.p || 0); }); });
    var ALIAS = { '村上春樹': 'Haruki Murakami', '三島由紀夫': 'Yukio Mishima', '太宰治': 'Osamu Dazai', '夏目漱石': 'Natsume Soseki', '芥川龍之介': 'Ryunosuke Akutagawa', '江戸川乱歩': 'Edogawa Ranpo', '手塚治虫': 'Osamu Tezuka', '吉田秋生': 'Akimi Yoshida', '井上雄彦': 'Takehiko Inoue' };
    searchIndex = books.concat(objects).map(function (b) {
      var extra = '';
      Object.keys(ALIAS).forEach(function (k) { if ((b.a || '').indexOf(k) >= 0 || b.t.indexOf(k) >= 0) extra += ' ' + ALIAS[k]; });
      return { b: b, key: norm(b.t + ' ' + (b.a || '') + extra), tkey: norm(b.t) };
    });
  }
  function addItem(b, obj) {
    var it = { b: b, obj: obj, col: {} };
    if (obj) { it.kind = SPR.kindOf(b); var s = SPR.SIZE[it.kind]; it.w = s[0]; it.h = s[1]; }
    else { var z = spineSize(b); it.w = z[0]; it.h = z[1]; }
    byId[b.id] = it;
    var key = b.u + '\n' + b.s;
    (shelfItems[key] = shelfItems[key] || []).push(it);
    var c = unitCounts[b.u] = unitCounts[b.u] || { books: 0, objects: 0 };
    if (obj) c.objects++; else c.books++;
  }
  function itemsOf(u, s) { return shelfItems[u + '\n' + s] || []; }

  // ---- layout -----------------------------------------------------------------------
  function validLayout(lay) {
    return lay && lay.room && lay.room.cols >= 8 && lay.room.rows >= 8 && lay.room.cols <= 40 && lay.room.rows <= 40 && Array.isArray(lay.pieces);
  }
  function applyLayout(lay) {
    cols = lay.room.cols | 0; rows = lay.room.rows | 0;
    pieces = []; pieceById = {}; pieceByUnit = {};
    lay.pieces.forEach(function (q) {
      if (!SPECS[q.id] || pieceById[q.id]) return;
      var p = { id: q.id, x: q.x | 0, y: q.y | 0, r: (q.r | 0) & 3, spec: SPECS[q.id] };
      pieces.push(p); pieceById[q.id] = p;
    });
    DEFAULT.pieces.forEach(function (q) {           // anything missing comes back from the default
      if (pieceById[q.id]) return;
      var p = { id: q.id, x: q.x, y: q.y, r: q.r, spec: SPECS[q.id] };
      pieces.push(p); pieceById[q.id] = p;
    });
    pieces.forEach(function (p) { if (p.spec.unit) pieceByUnit[p.spec.unit] = p; });
    layout = { version: 1, room: { cols: cols, rows: rows }, pieces: pieces.map(function (p) { return { id: p.id, x: p.x, y: p.y, r: p.r }; }) };
    rebuildObstacles();
    unstick(avatar); unstick(cat);
  }
  function snapshot() { return { version: 1, room: { cols: cols, rows: rows }, pieces: pieces.map(function (p) { return { id: p.id, x: p.x, y: p.y, r: p.r }; }) }; }
  function saveLayout() { layout = snapshot(); store(STORE, layout); }
  function fw(p) { return p.spec.wall ? (p.r % 2 ? 0 : p.spec.w) : (p.r % 2 ? p.spec.d : p.spec.w); }
  function fd(p) { return p.spec.wall ? (p.r % 2 ? p.spec.w : 0) : (p.r % 2 ? p.spec.w : p.spec.d); }
  function footprint(p) {
    if (p.spec.wall) return p.r % 2 ? { x0: 0, y0: p.y, x1: 0, y1: p.y + p.spec.w } : { x0: p.x, y0: 0, x1: p.x + p.spec.w, y1: 0 };
    return { x0: p.x, y0: p.y, x1: p.x + fw(p), y1: p.y + fd(p) };
  }
  function rebuildObstacles() {
    obs = new Uint8Array(cols * rows);
    pieces.forEach(function (p) {
      if (p.spec.wall || p.spec.flat) return;
      var f = footprint(p);
      for (var y = f.y0; y < f.y1; y++) for (var x = f.x0; x < f.x1; x++) if (x >= 0 && y >= 0 && x < cols && y < rows) obs[y * cols + x] = 1;
    });
  }
  function free(x, y) { return x >= 0 && y >= 0 && x < cols && y < rows && !obs[(y | 0) * cols + (x | 0)]; }
  function walkableAt(x, y, r) { return free(x - r, y - r) && free(x + r, y - r) && free(x - r, y + r) && free(x + r, y + r); }
  function unstick(who) {
    if (walkableAt(who.x, who.y, 0.2)) return;
    var best = null, bd = 1e9;
    for (var y = 0; y < rows; y++) for (var x = 0; x < cols; x++) if (free(x, y)) {
      var d = (x + 0.5 - who.x) * (x + 0.5 - who.x) + (y + 0.5 - who.y) * (y + 0.5 - who.y);
      if (d < bd) { bd = d; best = { x: x + 0.5, y: y + 0.5 }; }
    }
    if (best) { who.x = best.x; who.y = best.y; who.path = []; }
  }
  function validPlace(p, x, y, r) {
    var s = p.spec;
    if (s.wall) {
      var len = r % 2 ? rows : cols, pos = r % 2 ? y : x;
      if (pos < 0 || pos + s.w > len) return false;
      return !pieces.some(function (q) {
        if (q === p || !q.spec.wall || q.r % 2 !== r % 2) return false;
        var qp = q.r % 2 ? q.y : q.x;
        return pos < qp + q.spec.w && qp < pos + s.w;
      });
    }
    var w = r % 2 ? s.d : s.w, d = r % 2 ? s.w : s.d;
    if (x < 0 || y < 0 || x + w > cols || y + d > rows) return false;
    if (s.flat) return true;
    return !pieces.some(function (q) {
      if (q === p || q.spec.wall || q.spec.flat) return false;
      var f = footprint(q);
      return x < f.x1 && f.x0 < x + w && y < f.y1 && f.y0 < y + d;
    });
  }
  // a piece's own local coordinates, rotated into the room
  function local(p, lx, ly) {
    var s = p.spec;
    switch (p.r) {
      case 1: return { x: p.x + s.d - ly, y: p.y + lx };
      case 2: return { x: p.x + s.w - lx, y: p.y + s.d - ly };
      case 3: return { x: p.x + ly, y: p.y + s.w - lx };
      default: return { x: p.x + lx, y: p.y + ly };
    }
  }
  function frontTile(p) {              // the tile to stand on to browse it
    var f = footprint(p), cx = (f.x0 + f.x1) / 2, cy = (f.y0 + f.y1) / 2, cand;
    switch (p.r) {
      case 1: cand = [f.x1 + 0.5, cy]; break;
      case 2: cand = [cx, f.y0 - 0.5]; break;
      case 3: cand = [f.x0 - 0.5, cy]; break;
      default: cand = [cx, f.y1 + 0.5];
    }
    var t = { x: Math.floor(cand[0]) + 0.5, y: Math.floor(cand[1]) + 0.5 };
    if (free(t.x, t.y)) return t;
    return nearestFree(cand[0], cand[1]);
  }
  function nearestFree(x, y) {
    var best = null, bd = 1e9;
    for (var ty = 0; ty < rows; ty++) for (var tx = 0; tx < cols; tx++) if (free(tx, ty)) {
      var d = (tx + 0.5 - x) * (tx + 0.5 - x) + (ty + 0.5 - y) * (ty + 0.5 - y);
      if (d < bd) { bd = d; best = { x: tx + 0.5, y: ty + 0.5 }; }
    }
    return best;
  }

  // ---- A* on the tile grid ------------------------------------------------------------
  function findPath(sx, sy, tx, ty) {
    var s = (sy | 0) * cols + (sx | 0), t = (ty | 0) * cols + (tx | 0);
    if (!free(tx, ty) || s === t) return [];
    var open = [s], came = {}, g = {}, f = {};
    g[s] = 0; f[s] = 0;
    var closed = new Uint8Array(cols * rows);
    while (open.length) {
      var bi = 0;
      for (var i = 1; i < open.length; i++) if (f[open[i]] < f[open[bi]]) bi = i;
      var cur = open.splice(bi, 1)[0];
      if (cur === t) {
        var path = [];
        while (cur !== s) { path.push({ x: cur % cols + 0.5, y: Math.floor(cur / cols) + 0.5 }); cur = came[cur]; }
        return path.reverse();
      }
      closed[cur] = 1;
      var cx = cur % cols, cy = Math.floor(cur / cols);
      for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        var nx = cx + dx, ny = cy + dy;
        if (!free(nx, ny)) continue;
        if (dx && dy && (!free(cx + dx, cy) || !free(cx, cy + dy))) continue;   // no corner cutting
        var n = ny * cols + nx;
        if (closed[n]) continue;
        var ng = g[cur] + (dx && dy ? 1.414 : 1);
        if (g[n] == null || ng < g[n]) {
          came[n] = cur; g[n] = ng;
          var hx = Math.abs(nx - (tx | 0)), hy = Math.abs(ny - (ty | 0));
          f[n] = ng + Math.max(hx, hy) + 0.414 * Math.min(hx, hy);
          if (open.indexOf(n) < 0) open.push(n);
        }
      }
    }
    return [];
  }

  // ---- drawing helpers -------------------------------------------------------------------
  var WOOD = {
    pine: { top: '#dcbf85', side: '#b8945c', side2: '#a8864f', frame: '#d4b57a', shelf: '#c7a56a', back: '#8a6a40' },
    black: { top: '#3a3632', side: '#26231f', side2: '#1d1b18', frame: '#2d2a26', shelf: '#34302b', back: '#17151300' },
    cherry: { top: '#7a3d2e', side: '#5a2b22', side2: '#4a2319', frame: '#6b3328', shelf: '#7b4030', back: '#3a1d15' },
    cream: { top: '#efe4cc', side: '#d8c9ad', side2: '#c7b89b', frame: '#e8dcc2', shelf: '#e2d4b8', back: '#9d8f76' },
    white: { top: '#f3f1ec', side: '#dad7d0', side2: '#c8c4bb', frame: '#ebe8e2', shelf: '#e6e3dc', back: '#9c9890' },
    lightwood: { top: '#e3c9a0', side: '#c6a87c', side2: '#b4966b', frame: '#d9bc8f', shelf: '#d2b48c', back: '#8f7452' },
    wire: { top: '#b8bac0', side: '#9a9ca3', side2: '#85878e', frame: '#a3a5ab', shelf: '#b0b2b8', back: 'rgba(0,0,0,0)' },
    cardboard: { top: '#c9a36f', side: '#ad8656', side2: '#9a7548', frame: '#b89060', shelf: '#b08a5a', back: '#7a5c38' },
  };
  WOOD.black.back = '#171513';

  function faceLeft(c, fw_, fd_, z) { var o = P(0, fd_, z || 0); c.transform(TW / 2, TH / 2, 0, -HZ, o.x, o.y); }
  function faceRight(c, fw_, fd_, z) { var o = P(fw_, fd_, z || 0); c.transform(TW / 2, -TH / 2, 0, -HZ, o.x, o.y); }
  function rect(c, x, y, w, h, color) { c.fillStyle = color; c.fillRect(x, y, w, h); }
  function polyAt(c, pts, color) {
    c.fillStyle = color; c.beginPath(); c.moveTo(pts[0].x, pts[0].y);
    for (var i = 1; i < pts.length; i++) c.lineTo(pts[i].x, pts[i].y);
    c.closePath(); c.fill();
  }
  // a box standing on tile offset (gx,gy), footprint w x d, from height z0 to z1
  function box(c, gx, gy, w, d, z0, z1, col) {
    polyAt(c, [P(gx, gy, z1), P(gx + w, gy, z1), P(gx + w, gy + d, z1), P(gx, gy + d, z1)], col.top);
    polyAt(c, [P(gx, gy + d, z0), P(gx + w, gy + d, z0), P(gx + w, gy + d, z1), P(gx, gy + d, z1)], col.side);
    polyAt(c, [P(gx + w, gy + d, z0), P(gx + w, gy, z0), P(gx + w, gy, z1), P(gx + w, gy + d, z1)], col.side2);
  }
  function shade(hex, k) {               // darken/lighten a #rrggbb by factor k
    var n = parseInt(hex.slice(1), 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    r = clamp(Math.round(r * k), 0, 255); g = clamp(Math.round(g * k), 0, 255); b = clamp(Math.round(b * k), 0, 255);
    return 'rgb(' + r + ',' + g + ',' + b + ')';
  }

  function drawShelfItems(c, items, u, width, cap, lod, bottom) {
    if (!items || !items.length) return;
    var gap = 0.004, total = 0, i;
    for (i = 0; i < items.length; i++) total += items[i].w;
    total += gap * (items.length - 1);
    var sc = total > width ? width / total : 1, x = u;
    for (i = 0; i < items.length; i++) {
      var it = items[i], w = it.w * sc, h = Math.min(it.h, cap);
      c.save(); c.translate(x, bottom);
      if (it.obj) SPR.draw(c, it.kind, w, h, lod, it.b);
      else drawSpine(c, it, w, h, lod);
      c.restore();
      x += w + gap;
    }
  }
  function drawSpine(c, it, w, h, lod) {
    rect(c, 0, 0, w, h, colorOf(it));
    var px = lod * w;
    if (px > 3) {
      rect(c, 0, 0, w * 0.18, h, 'rgba(255,255,255,0.16)');
      rect(c, w * 0.82, 0, w * 0.18, h, 'rgba(0,0,0,0.22)');
      rect(c, 0, h - 0.012, w, 0.012, 'rgba(255,255,255,0.25)');
    }
    if (px > 7) {
      rect(c, w * 0.22, h * 0.12, w * 0.56, h * 0.07, 'rgba(255,250,235,0.55)');
      if (h > 0.4) rect(c, w * 0.28, h * 0.78, w * 0.44, h * 0.03, 'rgba(255,250,235,0.35)');
    }
  }

  // the front of a bookcase, in face coordinates (u in tiles, v in height units)
  function drawFront(c, s, len, h, lod, wood) {
    var post = 0.05, base = 0.08, rail = 0.1;
    rect(c, 0, 0, len, h, wood.back);
    var ncols = s.cols.length, cw = len / ncols;
    for (var ci = 0; ci < ncols; ci++) {
      var u0 = ci * cw + post, u1 = (ci + 1) * cw - post, shelves = s.cols[ci], n = shelves.length;
      var avail = h - base - rail, sh = avail / n;
      for (var i = 0; i < n; i++) {
        var bottom = base + (n - 1 - i) * sh;
        if (i < n - 1 || true) rect(c, u0, bottom - 0.07, u1 - u0, 0.07, wood.shelf);
        rect(c, u0, bottom - 0.07, u1 - u0, 0.015, 'rgba(0,0,0,0.25)');
        drawShelfItems(c, itemsOf(s.unit, shelves[i]), u0 + 0.02, u1 - u0 - 0.04, sh - 0.1, lod, bottom);
      }
    }
    for (ci = 1; ci < ncols; ci++) rect(c, ci * cw - post, 0, post * 2, h, wood.frame);
    rect(c, 0, 0, post, h, wood.frame); rect(c, len - post, 0, post, h, wood.frame);
    rect(c, 0, h - rail, len, rail, wood.frame); rect(c, 0, 0, len, base, wood.frame);
    rect(c, 0, h - rail, len, 0.02, 'rgba(255,255,255,0.25)');
  }
  function drawWireFront(c, s, len, h, lod, wood) {
    var base = 0.12, rail = 0.05, shelves = s.cols[0], n = shelves.length, sh = (h - base - rail) / n;
    for (var i = 0; i < n; i++) {
      var bottom = base + (n - 1 - i) * sh;
      rect(c, 0, bottom - 0.04, len, 0.04, wood.shelf);
      for (var u = 0; u < len; u += 0.08) rect(c, u, bottom - 0.04, 0.012, 0.04, 'rgba(0,0,0,0.3)');
      drawShelfItems(c, itemsOf(s.unit, shelves[i]), 0.03, len - 0.06, sh - 0.08, lod, bottom);
    }
  }
  function drawCase(c, p, lod) {
    var s = p.spec, w = fw(p), d = fd(p), h = s.h, wood = WOOD[s.wood] || WOOD.pine;
    var frontVisible = p.r === 0 || p.r === 1;
    if (s.wood === 'wire') {
      var post = 0.03;
      [[0, 0], [w, 0], [0, d], [w, d]].forEach(function (q, i) {
        if (i === 3) return;
        polyAt(c, [P(q[0] - post, q[1], 0), P(q[0] + post, q[1], 0), P(q[0] + post, q[1], h), P(q[0] - post, q[1], h)], wood.side2);
      });
      c.save(); if (p.r === 1) faceRight(c, w, d); else faceLeft(c, w, d);
      drawWireFront(c, s, s.w, h, lod, wood); c.restore();
      polyAt(c, [P(w - post, d, 0), P(w + post, d, 0), P(w + post, d, h), P(w - post, d, h)], wood.side);
      return;
    }
    box(c, 0, 0, w, d, 0, h, { top: wood.top, side: p.r === 0 ? wood.back : wood.side, side2: p.r === 1 ? wood.back : wood.side2 });
    if (frontVisible) {
      c.save();
      if (p.r === 0) faceLeft(c, w, d); else faceRight(c, w, d);
      drawFront(c, s, s.w, h, lod, wood);
      c.restore();
    } else {
      // back panel toward us: a plain board with a faint cross-brace
      c.save(); if (p.r === 2) faceLeft(c, w, d); else faceRight(c, w, d);
      rect(c, 0, 0, s.w, h, shade(wood.side, 0.92)); rect(c, 0.04, 0.04, s.w - 0.08, h - 0.08, shade(wood.side, 0.85)); c.restore();
    }
    if (s.top) {
      c.save();
      if (p.r === 1) faceRight(c, w * 0.5, d, h); else faceLeft(c, w, d * 0.5, h);
      drawShelfItems(c, itemsOf(s.unit, s.top), 0.06, s.w - 0.12, 1.1, lod, 0);
      c.restore();
    }
  }
  function drawDesk(c, p, lod) {
    var s = p.spec, w = fw(p), d = fd(p), h = s.h, wood = { top: '#b57b4a', side: '#8a5a34', side2: '#7a4d2c' };
    var legs = [[0.1, 0.1], [s.w - 0.22, 0.1], [0.1, s.d - 0.22], [s.w - 0.22, s.d - 0.22]];
    legs.forEach(function (q) { var l = local(p, q[0], q[1]); box(c, l.x - p.x - (p.r % 2 ? 0.12 : 0), l.y - p.y - (p.r >= 2 ? 0.12 : 0), 0.12, 0.12, 0, h - 0.12, { top: wood.top, side: wood.side, side2: wood.side2 }); });
    box(c, 0, 0, w, d, h - 0.12, h, wood);
    // loose books lying on the desk, in piles
    function pile(items, lx, ly, bw, bd, z0) {
      var z = z0;
      items.forEach(function (it, i) {
        var l = local(p, lx + (i % 2) * 0.03, ly + (i % 3) * 0.02), col = colorOf(it);
        var ww = p.r % 2 ? bd : bw, dd = p.r % 2 ? bw : bd;
        box(c, l.x - p.x - (p.r % 2 ? ww : 0), l.y - p.y - (p.r >= 2 ? dd : 0), ww, dd, z, z + 0.06, { top: col, side: shade('#c8b89a', 0.95), side2: shade('#c8b89a', 0.85) });
        z += 0.06;
      });
    }
    pile(itemsOf('Loose', 'Held (photo 96)').filter(function (it) { return !it.obj; }), 0.25, 0.3, 0.5, 0.65, h);
    pile(itemsOf('Loose', 'Held (photo 73)'), 1.15, 0.9, 0.55, 0.75, h);
    pile(itemsOf('Loose', 'Floor'), 2.3, 1.3, 0.55, 0.6, 0);
    var paper = itemsOf('Loose', 'Held (photo 96)').filter(function (it) { return it.obj; });
    if (paper.length) { var l = local(p, 1.0, 0.25); box(c, l.x - p.x, l.y - p.y, 0.3, 0.42, h, h + 0.08, { top: '#f2f2f2', side: '#1f6fc0', side2: '#185a9c' }); }
    // desk lamp
    var lp = local(p, 2.5, 0.4), lx = lp.x - p.x, ly = lp.y - p.y;
    var b = P(lx, ly, h);
    c.fillStyle = '#2b2b2f'; c.beginPath(); c.ellipse(b.x, b.y, 8, 4, 0, 0, Math.PI * 2); c.fill();
    c.strokeStyle = '#3a3a3f'; c.lineWidth = 3; c.beginPath(); c.moveTo(b.x, b.y); c.lineTo(b.x - 6, b.y - 34); c.lineTo(b.x + 8, b.y - 44); c.stroke();
    var g = c.createRadialGradient(b.x + 8, b.y - 36, 2, b.x + 8, b.y - 36, 48);
    g.addColorStop(0, 'rgba(255,214,140,0.45)'); g.addColorStop(1, 'rgba(255,214,140,0)');
    c.fillStyle = g; c.beginPath(); c.arc(b.x + 8, b.y - 36, 48, 0, Math.PI * 2); c.fill();
    polyAt(c, [{ x: b.x - 4, y: b.y - 46 }, { x: b.x + 20, y: b.y - 46 }, { x: b.x + 24, y: b.y - 32 }, { x: b.x - 8, y: b.y - 32 }], '#3f6b3a');
    rect(c, b.x - 6, b.y - 33, 28, 2, '#ffe6b0');
  }
  function drawChair(c, p) {
    var wood = { top: '#8a5a34', side: '#6e4528', side2: '#5e3a20' };
    [[0.15, 0.15], [0.75, 0.15], [0.15, 0.75], [0.75, 0.75]].forEach(function (q) { box(c, q[0], q[1], 0.1, 0.1, 0, 0.95, wood); });
    box(c, 0.1, 0.1, 0.8, 0.8, 0.95, 1.1, { top: '#a8714a', side: '#7a4f2c', side2: '#6a4324' });
    var back = [[0.1, 0.78, 0.8, 0.12], [0.78, 0.1, 0.12, 0.8], [0.1, 0.1, 0.8, 0.12], [0.1, 0.1, 0.12, 0.8]][p.r];
    box(c, back[0], back[1], back[2], back[3], 1.1, 2.2, wood);
    box(c, back[0] + (back[2] > 0.5 ? 0.1 : 0), back[1] + (back[3] > 0.5 ? 0.1 : 0), back[2] > 0.5 ? 0.6 : 0.12, back[3] > 0.5 ? 0.6 : 0.12, 1.5, 1.95, { top: '#7a2f2b', side: '#8f3a34', side2: '#6a2824' });
  }
  function drawLamp(c, p) {
    var b = P(0.5, 0.5, 0);
    c.fillStyle = '#2b2b2f'; c.beginPath(); c.ellipse(b.x, b.y, 14, 7, 0, 0, Math.PI * 2); c.fill();
    rect(c, b.x - 2, b.y - 3.3 * HZ, 4, 3.3 * HZ, '#3a3a3f');
    var top = b.y - 3.8 * HZ;
    var g = c.createRadialGradient(b.x, top + 22, 4, b.x, top + 22, 70);
    g.addColorStop(0, 'rgba(255,214,140,0.5)'); g.addColorStop(1, 'rgba(255,214,140,0)');
    c.fillStyle = g; c.beginPath(); c.arc(b.x, top + 22, 70, 0, Math.PI * 2); c.fill();
    polyAt(c, [{ x: b.x - 14, y: top }, { x: b.x + 14, y: top }, { x: b.x + 20, y: top + 30 }, { x: b.x - 20, y: top + 30 }], '#e8d2a8');
    c.fillStyle = '#f5e4c0'; c.beginPath(); c.ellipse(b.x, top + 30, 20, 6, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#d9c094'; c.beginPath(); c.ellipse(b.x, top, 14, 4, 0, 0, Math.PI * 2); c.fill();
  }
  function drawPlant(c, p) {
    box(c, 0.25, 0.25, 0.5, 0.5, 0, 0.6, { top: '#5a3a28', side: '#b5693d', side2: '#9a5731' });
    var b = P(0.5, 0.5, 0.6);
    var leaves = [[-18, -30, 14, 24, -0.5], [16, -36, 14, 26, 0.5], [0, -48, 12, 30, 0], [-26, -14, 12, 18, -1.1], [24, -16, 12, 18, 1.1], [4, -22, 14, 20, 0.2]];
    leaves.forEach(function (l, i) {
      c.fillStyle = i % 2 ? '#3e7a44' : '#4f9452'; c.beginPath(); c.ellipse(b.x + l[0], b.y + l[1], l[2], l[3], l[4], 0, Math.PI * 2); c.fill();
    });
  }
  function drawRug(c, p) {
    var w = fw(p), d = fd(p);
    polyAt(c, [P(0, 0), P(w, 0), P(w, d), P(0, d)], '#7d3b3a');
    polyAt(c, [P(0.25, 0.25), P(w - 0.25, 0.25), P(w - 0.25, d - 0.25), P(0.25, d - 0.25)], '#a04e48');
    polyAt(c, [P(0.6, 0.6), P(w - 0.6, 0.6), P(w - 0.6, d - 0.6), P(0.6, d - 0.6)], '#c9876a');
    polyAt(c, [P(w / 2, 0.9), P(w - 0.9, d / 2), P(w / 2, d - 0.9), P(0.9, d / 2)], '#8f3f3c');
    c.strokeStyle = 'rgba(255,230,200,0.35)'; c.lineWidth = 1;
    for (var i = 0; i < w; i += 0.14) { var a = P(i, 0), b2 = P(i, -0.12); c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b2.x, b2.y); c.stroke(); a = P(i, d); b2 = P(i, d + 0.12); c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b2.x, b2.y); c.stroke(); }
  }
  function wallFace(c, p) { if (p.r % 2) faceRight(c, 0, p.spec.w); else faceLeft(c, p.spec.w, 0); }
  function drawWindow(c, p) {
    var w = p.spec.w, v0 = 2.2, v1 = 5.0;
    c.save(); wallFace(c, p);
    rect(c, 0.1, v0 - 0.12, w - 0.2, 0.12, '#efe6d4');                              // sill
    rect(c, 0.15, v0, w - 0.3, v1 - v0, '#f2ebdc');                                 // frame
    var g = c.createLinearGradient(0, v0, 0, v1);
    if (night) { g.addColorStop(0, '#0d1430'); g.addColorStop(1, '#1d2a52'); } else { g.addColorStop(0, '#8fc3ea'); g.addColorStop(1, '#d9ecf7'); }
    rect(c, 0.25, v0 + 0.1, w - 0.5, v1 - v0 - 0.2, g);
    if (night) {
      c.fillStyle = '#f6f0d8'; c.beginPath(); c.ellipse(w * 0.68, v1 - 0.7, 0.14, 0.16, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#1d2a52'; c.beginPath(); c.ellipse(w * 0.72, v1 - 0.66, 0.12, 0.14, 0, 0, Math.PI * 2); c.fill();
      for (var i = 0; i < 14; i++) { var hx = hash('star' + i); rect(c, 0.3 + (hx % 100) / 100 * (w - 0.6), v0 + 0.2 + ((hx >> 8) % 100) / 100 * (v1 - v0 - 0.4), 0.02, 0.02, 'rgba(255,255,255,0.8)'); }
    } else {
      c.fillStyle = 'rgba(255,255,255,0.35)'; c.beginPath(); c.ellipse(w * 0.3, v0 + 0.9, 0.5, 0.35, 0, 0, Math.PI * 2); c.fill();
    }
    rect(c, w / 2 - 0.03, v0, 0.06, v1 - v0, '#f2ebdc'); rect(c, 0.15, (v0 + v1) / 2 - 0.03, w - 0.3, 0.06, '#f2ebdc');   // mullions
    rect(c, 0.15, v1 - 0.06, w - 0.3, 0.06, '#e0d6c2');
    c.restore();
  }
  function drawCalligraphy(c, p) {
    var w = p.spec.w;
    c.save(); wallFace(c, p);
    for (var i = 0; i < 3; i++) {
      var u = 0.2 + i * (w - 0.4) / 3 + 0.12, sw = (w - 0.4) / 3 - 0.24, v0 = 2.6 + (i === 1 ? 0.3 : 0), v1 = 5.3 + (i === 1 ? 0.15 : 0);
      rect(c, u - 0.03, v1 - 0.03, sw + 0.06, 0.08, '#3a2a22'); rect(c, u - 0.03, v0 - 0.05, sw + 0.06, 0.08, '#3a2a22');
      rect(c, u, v0, sw, v1 - v0, '#f1e9d6');
      rect(c, u + 0.04, v0 + 0.08, sw - 0.08, v1 - v0 - 0.16, '#faf5e8');
      c.strokeStyle = '#1a1612'; c.lineCap = 'round';
      var seed = hash('scroll' + i);
      for (var k = 0; k < 4; k++) {
        var cx = u + sw * 0.5, top = v1 - 0.35 - k * (v1 - v0 - 0.6) / 4, bot = top - (v1 - v0 - 0.6) / 4 + 0.08;
        var r1 = ((seed >> (k * 3)) % 7 - 3) / 40, r2 = ((seed >> (k * 5 + 1)) % 7 - 3) / 40;
        c.lineWidth = 0.028 + (k % 2) * 0.012;
        c.beginPath(); c.moveTo(cx + r1, top); c.bezierCurveTo(cx - 0.08 + r2, top - 0.1, cx + 0.08, bot + 0.1, cx + r2, bot); c.stroke();
        c.lineWidth = 0.018; c.beginPath(); c.moveTo(cx - 0.08, top - 0.05 + r2); c.lineTo(cx + 0.09 + r1, top - 0.08); c.stroke();
      }
      rect(c, u + sw - 0.12, v0 + 0.2, 0.06, 0.08, '#b8342c');                         // the red seal
    }
    c.restore();
  }
  function drawClock(c, p) {
    c.save(); wallFace(c, p);
    var ru = 14 / (TW / 2), rv = 14 / HZ, cx = p.spec.w / 2, cy = 4.4;
    c.fillStyle = '#2b2520'; c.beginPath(); c.ellipse(cx, cy, ru + 0.04, rv + 0.045, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#f4efe2'; c.beginPath(); c.ellipse(cx, cy, ru, rv, 0, 0, Math.PI * 2); c.fill();
    for (var i = 0; i < 12; i++) { var a = i / 12 * Math.PI * 2; rect(c, cx + Math.sin(a) * ru * 0.82 - 0.012, cy + Math.cos(a) * rv * 0.82 - 0.012, 0.024, 0.024, '#2b2520'); }
    c.restore();
  }
  function drawClockHands(c, p) {
    c.save(); wallFace(c, p);
    var ru = 14 / (TW / 2), rv = 14 / HZ, cx = p.spec.w / 2, cy = 4.4, d = new Date();
    var hr = (d.getHours() % 12 + d.getMinutes() / 60) / 12 * Math.PI * 2, mn = (d.getMinutes() + d.getSeconds() / 60) / 60 * Math.PI * 2, sc = d.getSeconds() / 60 * Math.PI * 2;
    c.strokeStyle = '#2b2520'; c.lineCap = 'round';
    c.lineWidth = 0.03; c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx + Math.sin(hr) * ru * 0.5, cy + Math.cos(hr) * rv * 0.5); c.stroke();
    c.lineWidth = 0.02; c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx + Math.sin(mn) * ru * 0.75, cy + Math.cos(mn) * rv * 0.75); c.stroke();
    c.strokeStyle = '#b8342c'; c.lineWidth = 0.01; c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx + Math.sin(sc) * ru * 0.8, cy + Math.cos(sc) * rv * 0.8); c.stroke();
    c.restore();
  }

  function drawPiece(c, p, lod) {
    switch (p.spec.kind) {
      case 'case': drawCase(c, p, lod); break;
      case 'desk': drawDesk(c, p, lod); break;
      case 'chair': drawChair(c, p); break;
      case 'lamp': drawLamp(c, p); break;
      case 'plant': drawPlant(c, p); break;
      case 'rug': drawRug(c, p); break;
      case 'window': drawWindow(c, p); break;
      case 'calligraphy': drawCalligraphy(c, p); break;
      case 'clock': drawClock(c, p); break;
    }
  }
  function pieceBBox(p) {              // in scene px relative to the piece's tile origin
    var s = p.spec;
    if (s.wall) {
      var w = s.w, v1 = 6.2, v0 = 0;
      return p.r % 2 ? { x0: -w * TW / 2 - 2, y0: -v1 * HZ, x1: 2, y1: w * TH / 2 - v0 * HZ + 2 } : { x0: -2, y0: -v1 * HZ, x1: w * TW / 2 + 2, y1: w * TH / 2 + 2 };
    }
    var fw_ = fw(p), fd_ = fd(p), h = (s.h || 0) + (s.top ? 1.2 : 0) + 0.4;
    if (s.kind === 'lamp') h = 4.6;
    if (s.kind === 'rug') return { x0: -fd_ * TW / 2 - 2, y0: -8, x1: fw_ * TW / 2 + 2, y1: (fw_ + fd_) * TH / 2 + 8 };
    return { x0: -fd_ * TW / 2 - 2, y0: -h * HZ - 2, x1: fw_ * TW / 2 + 2, y1: (fw_ + fd_) * TH / 2 + 2 };
  }
  function getCache(p) {
    var key = p.id + '|' + p.r + '|' + cacheZ.toFixed(3) + '|' + paint + '|' + (night ? 1 : 0);
    var cc = caches[p.id];
    if (cc && cc.key === key) return cc;
    var bb = pieceBBox(p), cz = cacheZ * dpr;
    var cw = Math.ceil((bb.x1 - bb.x0) * cz) + 2, ch = Math.ceil((bb.y1 - bb.y0) * cz) + 2;
    var cv = (cc && cc.canvas) || document.createElement('canvas');
    cv.width = cw; cv.height = ch;
    var c = cv.getContext('2d');
    c.setTransform(cz, 0, 0, cz, -bb.x0 * cz + 1, -bb.y0 * cz + 1);
    drawPiece(c, p, TW / 2 * cz);
    cc = { key: key, canvas: cv, ctx: c, z: cz, ox: bb.x0 - 1 / cz, oy: bb.y0 - 1 / cz };
    caches[p.id] = cc;
    return cc;
  }
  function invalidateCaches() { caches = {}; }

  // ---- draw order --------------------------------------------------------------------------
  function drawOrder(ents) {
    var n = ents.length, indeg = new Array(n).fill(0), adj = [], i, j;
    for (i = 0; i < n; i++) adj.push([]);
    for (i = 0; i < n; i++) for (j = 0; j < n; j++) {
      if (i === j) continue;
      var a = ents[i].f, b = ents[j].f;
      var ovx = a.x0 < b.x1 && b.x0 < a.x1, ovy = a.y0 < b.y1 && b.y0 < a.y1;
      if ((a.x1 <= b.x0 && ovy) || (a.y1 <= b.y0 && ovx)) { adj[i].push(j); indeg[j]++; }
    }
    var out = [], ready = [];
    for (i = 0; i < n; i++) if (!indeg[i]) ready.push(i);
    var done = new Uint8Array(n);
    while (out.length < n) {
      if (!ready.length) { for (i = 0; i < n; i++) if (!done[i]) { ready.push(i); break; } }
      ready.sort(function (x, y) { return (ents[x].f.x0 + ents[x].f.y0) - (ents[y].f.x0 + ents[y].f.y0); });
      var k = ready.shift(); if (done[k]) continue;
      done[k] = 1; out.push(ents[k]);
      adj[k].forEach(function (m) { if (--indeg[m] === 0 && !done[m]) ready.push(m); });
    }
    return out;
  }

  // ---- the room, per frame -------------------------------------------------------------------
  function sceneTransform() { ctx.setTransform(dpr * cam.z, 0, 0, dpr * cam.z, dpr * (W / 2 - cam.x * cam.z), dpr * (H / 2 - cam.y * cam.z)); }
  function drawFloorAndWalls() {
    var floorA = night ? '#4a3626' : '#b98a5a', floorB = night ? '#3b2a1e' : '#a67a4c';
    var g = ctx.createLinearGradient(P(cols, 0).x, P(cols, 0).y, P(0, rows).x, P(0, rows).y);
    g.addColorStop(0, floorA); g.addColorStop(1, floorB);
    polyAt(ctx, [P(0, 0), P(cols, 0), P(cols, rows), P(0, rows)], g);
    ctx.strokeStyle = night ? 'rgba(0,0,0,0.3)' : 'rgba(60,30,10,0.22)'; ctx.lineWidth = 1 / cam.z;
    for (var gy = 0.5; gy < rows; gy += 0.5) { var a = P(0, gy), b = P(cols, gy); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
    ctx.strokeStyle = night ? 'rgba(0,0,0,0.25)' : 'rgba(60,30,10,0.16)';
    for (var k = 0; k < cols * rows / 2; k++) {
      var hx = hash('plank' + k), px = (hx % (cols * 10)) / 10, py = Math.floor(((hx >> 10) % (rows * 2))) / 2;
      var a2 = P(px, py), b2 = P(px, py + 0.5); ctx.beginPath(); ctx.moveTo(a2.x, a2.y); ctx.lineTo(b2.x, b2.y); ctx.stroke();
    }
    if (arranging) {
      ctx.strokeStyle = 'rgba(255,240,210,0.18)';
      for (var x = 1; x < cols; x++) { var a3 = P(x, 0), b3 = P(x, rows); ctx.beginPath(); ctx.moveTo(a3.x, a3.y); ctx.lineTo(b3.x, b3.y); ctx.stroke(); }
      for (var y = 1; y < rows; y++) { var a4 = P(0, y), b4 = P(cols, y); ctx.beginPath(); ctx.moveTo(a4.x, a4.y); ctx.lineTo(b4.x, b4.y); ctx.stroke(); }
    }
    var wallA = night ? '#2e2a36' : '#e6dbc7', wallB = night ? '#262230' : '#d6c9b2', base = night ? '#1b1820' : '#c9b89c';
    var g1 = ctx.createLinearGradient(0, P(0, 0, WALL_H).y, 0, P(cols, 0, 0).y); g1.addColorStop(0, wallA); g1.addColorStop(1, wallB);
    polyAt(ctx, [P(0, 0), P(cols, 0), P(cols, 0, WALL_H), P(0, 0, WALL_H)], g1);
    var g2 = ctx.createLinearGradient(0, P(0, 0, WALL_H).y, 0, P(0, rows, 0).y); g2.addColorStop(0, shade(wallA, 0.93)); g2.addColorStop(1, shade(wallB, 0.9));
    polyAt(ctx, [P(0, 0), P(0, rows), P(0, rows, WALL_H), P(0, 0, WALL_H)], g2);
    polyAt(ctx, [P(0, 0), P(cols, 0), P(cols, 0, 0.18), P(0, 0, 0.18)], base);
    polyAt(ctx, [P(0, 0), P(0, rows), P(0, rows, 0.18), P(0, 0, 0.18)], shade(base, 0.9));
    ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 1.5 / cam.z;
    ctx.beginPath(); ctx.moveTo(P(0, 0, WALL_H).x, P(0, 0, WALL_H).y); ctx.lineTo(P(0, 0).x, P(0, 0).y); ctx.stroke();
  }
  function windowBeam(p) {
    if (night || !p) return;
    var pts = p.r % 2 ? [P(0, p.y + 0.2, 2.2), P(0, p.y + 2.8, 2.2), P(4.6, p.y + 3.4, 0), P(4.6, p.y - 0.4, 0)]
      : [P(p.x + 0.2, 0, 2.2), P(p.x + 2.8, 0, 2.2), P(p.x + 3.4, 4.6, 0), P(p.x - 0.4, 4.6, 0)];
    var g = ctx.createLinearGradient(pts[0].x, pts[0].y, pts[3].x, pts[3].y);
    g.addColorStop(0, 'rgba(255,244,214,0.26)'); g.addColorStop(1, 'rgba(255,244,214,0)');
    polyAt(ctx, pts, g);
  }
  function drawMotes(p) {
    if (night || !p || REDUCED) return;
    ctx.fillStyle = 'rgba(255,248,225,0.7)';
    for (var i = 0; i < motes.length; i++) {
      var m = motes[i], t = (m.t + now * m.v) % 1, a = m.a + Math.sin(now * 0.7 + m.ph) * 0.05;
      var gx, gy, z = (1 - t) * 2.2 + 0.1 + Math.sin(now * 0.5 + m.ph) * 0.1;
      if (p.r % 2) { gx = t * 4.4; gy = p.y + 0.2 + a * 2.6 + t * 0.4; } else { gx = p.x + 0.2 + a * 2.6 + t * 0.4; gy = t * 4.4; }
      var q = P(gx, gy, z);
      ctx.globalAlpha = 0.35 + 0.5 * Math.sin(t * Math.PI);
      ctx.beginPath(); ctx.arc(q.x, q.y, 1.2, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  function drawCachedPiece(p) {
    var cc = getCache(p), o = P(p.x, p.y, 0);
    ctx.drawImage(cc.canvas, o.x + cc.ox, o.y + cc.oy, cc.canvas.width / cc.z, cc.canvas.height / cc.z);
  }
  function drawFootprintOutline(p, color, fill) {
    var f = footprint(p);
    if (p.spec.wall) {
      var pts = p.r % 2 ? [P(0, f.y0), P(0, f.y1), P(0, f.y1, 6), P(0, f.y0, 6)] : [P(f.x0, 0), P(f.x1, 0), P(f.x1, 0, 6), P(f.x0, 0, 6)];
      ctx.fillStyle = fill; ctx.beginPath(); pts.forEach(function (q, i) { i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y); }); ctx.closePath(); ctx.fill(); ctx.strokeStyle = color; ctx.lineWidth = 2 / cam.z; ctx.stroke();
      return;
    }
    var pts2 = [P(f.x0, f.y0), P(f.x1, f.y0), P(f.x1, f.y1), P(f.x0, f.y1)];
    ctx.fillStyle = fill; ctx.beginPath(); pts2.forEach(function (q, i) { i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y); }); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = color; ctx.lineWidth = 2 / cam.z; ctx.stroke();
  }

  function drawAvatar() {
    var o = P(avatar.x, avatar.y, 0), facingCam = avatar.dx + avatar.dy > 0, right = avatar.dx - avatar.dy > 0;
    ctx.save(); ctx.translate(o.x, o.y); ctx.scale(0.72, 0.72);
    ctx.fillStyle = 'rgba(0,0,0,0.28)'; ctx.beginPath(); ctx.ellipse(0, 2, 16, 8, 0, 0, Math.PI * 2); ctx.fill();
    if (!right) ctx.scale(-1, 1);
    var step = avatar.moving ? Math.sin(avatar.walk) * 7 : 0;
    rect(ctx, -11, -36 + step, 9, 36 - step, '#2f3a52'); rect(ctx, 2, -36 - step, 9, 36 + step, '#2f3a52');   // legs
    rect(ctx, -12, -40, 9, 6, '#1e1e24'); rect(ctx, 1, -40, 9, 6, '#1e1e24');                                // shoes
    ctx.fillStyle = '#5d7fa6'; ctx.beginPath(); ctx.roundRect(-16, -84, 32, 50, 7); ctx.fill();               // sweater
    rect(ctx, -19, -80 - step * 0.6, 6, 32, '#5d7fa6'); rect(ctx, 13, -80 + step * 0.6, 6, 32, '#5d7fa6');  // arms
    rect(ctx, -19, -50 - step * 0.6, 6, 6, '#f1c9a5'); rect(ctx, 13, -50 + step * 0.6, 6, 6, '#f1c9a5');    // hands
    rect(ctx, -6, -90, 12, 8, '#f1c9a5');                                                                     // neck
    ctx.fillStyle = '#f1c9a5'; ctx.beginPath(); ctx.arc(0, -106, 19, 0, Math.PI * 2); ctx.fill();            // head
    ctx.fillStyle = '#2a1d16'; ctx.beginPath(); ctx.arc(0, -110, 19.5, Math.PI * 1.05, Math.PI * 1.95); ctx.fill();
    if (facingCam) {
      rect(ctx, -12, -116, 8, 10, '#2a1d16');
      rect(ctx, 3, -108, 3, 4, '#2a2024'); rect(ctx, 11, -108, 3, 4, '#2a2024');
      rect(ctx, 3, -111, 11, 1.5, '#2a2024');                                                                 // glasses bar
      ctx.strokeStyle = '#2a2024'; ctx.lineWidth = 1.2; ctx.strokeRect(1.5, -110, 6, 6); ctx.strokeRect(9.5, -110, 6, 6);
      rect(ctx, 6, -99, 6, 1.5, '#b0756a');
    } else {
      ctx.fillStyle = '#2a1d16'; ctx.beginPath(); ctx.arc(0, -104, 19, Math.PI * 1.0, Math.PI * 2.0); ctx.fill();
      rect(ctx, -19, -112, 38, 10, '#2a1d16'); rect(ctx, -17, -104, 34, 8, '#2a1d16');
    }
    ctx.restore();
  }
  function drawCat() {
    var o = P(cat.x, cat.y, 0), right = cat.dx - cat.dy > 0;
    ctx.save(); ctx.translate(o.x, o.y);
    ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.ellipse(0, 0, 15, 7, 0, 0, Math.PI * 2); ctx.fill();
    if (!right) ctx.scale(-1, 1);
    var fur = '#6b6670', dark = '#4b4650';
    if (cat.state === 'sleep') {
      ctx.fillStyle = fur; ctx.beginPath(); ctx.ellipse(0, -7, 16, 9, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = dark; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(-10, -6); ctx.quadraticCurveTo(-18, -12, -16, -2); ctx.quadraticCurveTo(-14, 4, -4, 1); ctx.stroke();
      ctx.fillStyle = fur; ctx.beginPath(); ctx.arc(9, -11, 7, 0, Math.PI * 2); ctx.fill();
      polyAt(ctx, [{ x: 4, y: -16 }, { x: 6, y: -22 }, { x: 10, y: -17 }], fur); polyAt(ctx, [{ x: 12, y: -17 }, { x: 15, y: -22 }, { x: 15, y: -15 }], fur);
      rect(ctx, 6, -12, 3, 1, dark); rect(ctx, 11, -12, 3, 1, dark);
      if (!REDUCED) {
        ctx.fillStyle = 'rgba(240,228,207,' + (0.5 + 0.4 * Math.sin(now * 1.5)) + ')'; ctx.font = 'bold 10px sans-serif';
        var zz = (now * 0.8) % 1; ctx.save(); if (!right) ctx.scale(-1, 1); ctx.fillText('z', right ? 16 + zz * 6 : -22 - zz * 6, -22 - zz * 14); ctx.restore();
      }
    } else {
      var step = cat.state === 'walk' ? Math.sin(cat.walk) * 3 : 0;
      rect(ctx, -10, -8, 3, 8 + step, dark); rect(ctx, -4, -8, 3, 8 - step, dark); rect(ctx, 3, -8, 3, 8 - step, dark); rect(ctx, 8, -8, 3, 8 + step, dark);
      ctx.fillStyle = fur; ctx.beginPath(); ctx.ellipse(0, -12, 14, 7, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = dark; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(-12, -12); ctx.quadraticCurveTo(-20, -16, -18, -28 + step); ctx.stroke();
      ctx.fillStyle = fur; ctx.beginPath(); ctx.arc(12, -18, 7, 0, Math.PI * 2); ctx.fill();
      polyAt(ctx, [{ x: 7, y: -23 }, { x: 8, y: -30 }, { x: 13, y: -24 }], fur); polyAt(ctx, [{ x: 14, y: -24 }, { x: 18, y: -30 }, { x: 18, y: -22 }], fur);
      rect(ctx, 11, -19, 2, 2, '#d7c04a'); rect(ctx, 15, -19, 2, 2, '#d7c04a');
    }
    ctx.restore();
  }
  function lampSources() {
    var out = [];
    var d = pieceById.desk; if (d) { var l = local(d, 2.6, 0.45); out.push({ p: P(l.x, l.y, d.spec.h + 1.0), r: 210, warm: true }); }
    var f = pieceById.lamp; if (f) out.push({ p: P(f.x + 0.5, f.y + 0.5, 3.2), r: 290, warm: true });
    var w = pieceById.window; if (w) { var q = w.r % 2 ? P(0.2, w.y + 1.5, 3.4) : P(w.x + 1.5, 0.2, 3.4); out.push({ p: q, r: 190, warm: false }); }
    return out;
  }
  function drawNight() {
    nightCanvas.width = view.width; nightCanvas.height = view.height;
    var c = nightCtx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = 'rgba(8,10,30,0.8)'; c.fillRect(0, 0, nightCanvas.width, nightCanvas.height);
    c.globalCompositeOperation = 'destination-out';
    lampSources().forEach(function (l) {
      var s = toScreen(l.p.x, l.p.y), r = l.r * cam.z;
      var g = c.createRadialGradient(s.x * dpr, s.y * dpr, 0, s.x * dpr, s.y * dpr, r * dpr);
      g.addColorStop(0, l.warm ? 'rgba(0,0,0,0.95)' : 'rgba(0,0,0,0.45)'); g.addColorStop(0.45, l.warm ? 'rgba(0,0,0,0.55)' : 'rgba(0,0,0,0.25)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = g; c.beginPath(); c.arc(s.x * dpr, s.y * dpr, r * dpr, 0, Math.PI * 2); c.fill();
    });
    c.globalCompositeOperation = 'source-over';
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(nightCanvas, 0, 0);
    lampSources().forEach(function (l) {
      if (!l.warm) return;
      var s = toScreen(l.p.x, l.p.y), r = l.r * 0.6 * cam.z;
      var g = ctx.createRadialGradient(s.x * dpr, s.y * dpr, 0, s.x * dpr, s.y * dpr, r * dpr);
      g.addColorStop(0, 'rgba(255,200,120,0.22)'); g.addColorStop(1, 'rgba(255,200,120,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(s.x * dpr, s.y * dpr, r * dpr, 0, Math.PI * 2); ctx.fill();
    });
  }
  function drawLabels() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.font = '600 12px ' + getComputedStyle(document.body).fontFamily; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    pieces.forEach(function (p) {
      var s = p.spec, sel = arranging && p === selected;
      if (!sel && (!labels || (s.kind !== 'case' && s.kind !== 'desk'))) return;
      var f = footprint(p), top = s.wall ? P((f.x0 + f.x1) / 2, (f.y0 + f.y1) / 2, 6.4) : P((f.x0 + f.x1) / 2, (f.y0 + f.y1) / 2, (s.h || 0) + (s.top ? 1.4 : 0.6) + (s.w === 1 ? 0.9 : 0));
      var q = toScreen(top.x, top.y);
      var text = sel ? s.name + ' · ' + (s.wall ? 'R to switch wall' : 'R to rotate') : s.name, tw = ctx.measureText(text).width + 14;
      ctx.fillStyle = sel ? '#ffcf7a' : 'rgba(14,11,9,0.78)'; ctx.beginPath(); ctx.roundRect(q.x - tw / 2, q.y - 10, tw, 20, 10); ctx.fill();
      ctx.fillStyle = sel ? '#1a120a' : (p === hover ? '#ffcf7a' : '#efe4cf'); ctx.fillText(text, q.x, q.y + 0.5);
    });
  }

  function render() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = night ? '#07060a' : '#0d0a08'; ctx.fillRect(0, 0, view.width, view.height);
    sceneTransform();
    drawFloorAndWalls();
    var win = pieceById.window;
    pieces.forEach(function (p) { if (p.spec.wall) drawCachedPiece(p); });
    if (pieceById.clock) drawClockHands(ctx, pieceById.clock);
    pieces.forEach(function (p) { if (p.spec.flat) drawCachedPiece(p); });
    windowBeam(win);
    var ents = pieces.filter(function (p) { return !p.spec.wall && !p.spec.flat; }).map(function (p) { return { p: p, f: footprint(p) }; });
    if (mode === 'walk' && !arranging) ents.push({ avatar: true, f: { x0: avatar.x - 0.25, y0: avatar.y - 0.25, x1: avatar.x + 0.25, y1: avatar.y + 0.25 } });
    ents.push({ cat: true, f: { x0: cat.x - 0.25, y0: cat.y - 0.25, x1: cat.x + 0.25, y1: cat.y + 0.25 } });
    drawOrder(ents).forEach(function (e) {
      if (e.avatar) drawAvatar();
      else if (e.cat) drawCat();
      else {
        if (arranging && e.p === selected) {
          var ok = drag ? drag.valid : true;
          drawFootprintOutline(e.p, ok ? 'rgba(127,196,138,0.95)' : 'rgba(224,106,90,0.95)', ok ? 'rgba(127,196,138,0.25)' : 'rgba(224,106,90,0.3)');
        }
        drawCachedPiece(e.p);
        if (arranging && (e.p === selected || e.p === hover)) {
          ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = e.p === selected ? 0.3 : 0.1; drawCachedPiece(e.p); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
          if (e.p === selected) {
            var f2 = footprint(e.p), ok2 = drag ? drag.valid : true;
            ctx.strokeStyle = ok2 ? '#ffcf7a' : '#e06a5a'; ctx.lineWidth = 3 / cam.z; ctx.setLineDash([8 / cam.z, 5 / cam.z]);
            ctx.beginPath(); [P(f2.x0, f2.y0), P(f2.x1, f2.y0), P(f2.x1, f2.y1), P(f2.x0, f2.y1)].forEach(function (q, i) { i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y); }); ctx.closePath(); ctx.stroke();
            ctx.setLineDash([]);
          }
        }
        if (!arranging && e.p === hover && (e.p.spec.kind === 'case' || e.p.spec.kind === 'desk')) {
          ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.12; drawCachedPiece(e.p); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
        }
      }
    });
    if (arranging && selected && selected.spec.wall) drawFootprintOutline(selected, drag && !drag.valid ? 'rgba(224,106,90,0.95)' : 'rgba(127,196,138,0.95)', 'rgba(127,196,138,0.15)');
    drawMotes(win);
    if (mode === 'walk' && !arranging && avatar.path.length) {
      var t = avatar.path[avatar.path.length - 1], q = P(t.x, t.y, 0);
      ctx.strokeStyle = 'rgba(255,207,122,0.8)'; ctx.lineWidth = 1.5 / cam.z;
      ctx.beginPath(); ctx.moveTo(q.x, q.y - TH / 2); ctx.lineTo(q.x + TW / 2, q.y); ctx.lineTo(q.x, q.y + TH / 2); ctx.lineTo(q.x - TW / 2, q.y); ctx.closePath(); ctx.stroke();
    }
    if (night) drawNight();
    if (labels || (arranging && selected)) drawLabels();
  }

  // ---- simulation --------------------------------------------------------------------------------
  function moveWith(who, vx, vy, dt, r) {
    var nx = who.x + vx * dt, ny = who.y + vy * dt;
    if (walkableAt(nx, who.y, r)) who.x = nx;
    if (walkableAt(who.x, ny, r)) who.y = ny;
  }
  function followPath(who, speed, dt, r) {
    if (!who.path.length) return false;
    var t = who.path[0], dx = t.x - who.x, dy = t.y - who.y, dist = Math.hypot(dx, dy);
    if (dist < 0.08) { who.path.shift(); return who.path.length > 0; }
    who.dx = dx / dist; who.dy = dy / dist;
    moveWith(who, who.dx * speed, who.dy * speed, dt, r);
    return true;
  }
  function updateAvatar(dt) {
    if (mode !== 'walk' || arranging || shelfOpenFor || THUMB) { avatar.moving = false; return; }
    var vx = 0, vy = 0;
    if (keys.w || keys.ArrowUp) { vx -= 1; vy -= 1; }
    if (keys.s || keys.ArrowDown) { vx += 1; vy += 1; }
    if (keys.a || keys.ArrowLeft) { vx -= 1; vy += 1; }
    if (keys.d || keys.ArrowRight) { vx += 1; vy -= 1; }
    var moving = false;
    if (vx || vy) {
      var l = Math.hypot(vx, vy); vx /= l; vy /= l;
      avatar.dx = vx; avatar.dy = vy; avatar.path = [];
      moveWith(avatar, vx * 3.2, vy * 3.2, dt, 0.22);
      moving = true; follow = true;
    } else if (avatar.path.length) { moving = followPath(avatar, 3.2, dt, 0.22); follow = true; }
    avatar.moving = moving;
    if (moving) avatar.walk += dt * 11;
    // who is near?
    var best = null, bd = 1.05;
    pieces.forEach(function (p) {
      if (p.spec.kind !== 'case' && p.spec.kind !== 'desk') return;
      var f = footprint(p), dx = Math.max(f.x0 - avatar.x, 0, avatar.x - f.x1), dy = Math.max(f.y0 - avatar.y, 0, avatar.y - f.y1), d = Math.hypot(dx, dy);
      if (d < bd) { bd = d; best = p; }
    });
    nearPiece = best;
  }
  function catSpots() {
    var m = pieceById.M, ch = pieceById.chair, out = [];
    if (m) { var t = frontTile(m); if (t) out.push(t); }
    if (ch) { var s = nearestFree(ch.x + (ch.r === 1 ? 1.5 : ch.r === 3 ? -0.5 : 0.5), ch.y + (ch.r === 0 ? 1.5 : ch.r === 2 ? -0.5 : 0.5)); if (s) out.push(s); }
    if (!out.length) out.push({ x: cols / 2, y: rows / 2 });
    return out;
  }
  function updateCat(dt) {
    cat.t -= dt;
    if (REDUCED || THUMB) { cat.state = 'sleep'; return; }
    if (cat.state === 'sleep' && cat.t <= 0) {
      var spots = catSpots(); cat.spot = (cat.spot + 1) % spots.length;
      var target = spots[cat.spot];
      cat.path = findPath(cat.x, cat.y, target.x, target.y);
      if (cat.path.length) { cat.state = 'walk'; } else { cat.t = 6; }
    } else if (cat.state === 'walk') {
      cat.walk += dt * 14;
      if (!followPath(cat, 1.6, dt, 0.15)) { cat.state = 'sit'; cat.t = 2 + (hash('sit' + (now | 0)) % 3); }
    } else if (cat.state === 'sit' && cat.t <= 0) { cat.state = 'sleep'; cat.t = 10 + (hash('nap' + (now | 0)) % 12); }
  }
  function updateCamera(dt) {
    if (fly) {
      fly.frames = (fly.frames || 0) + 1;
      var t = Math.min(1, Math.max((now - fly.t0) / fly.dur, fly.frames / (REDUCED ? 1 : 45))), e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      cam.x = lerp(fly.x0, fly.x1, e); cam.y = lerp(fly.y0, fly.y1, e); cam.z = lerp(fly.z0, fly.z1, e);
      if (t >= 1) { var cb = fly.cb; fly = null; cacheZ = cam.z; if (cb) cb(); }
      return;
    }
    if (mode === 'walk' && follow && !arranging) {
      var o = P(avatar.x, avatar.y, 0), tx = o.x, ty = o.y - 50;
      var k = REDUCED ? 1 : 1 - Math.pow(0.001, dt);
      cam.x = lerp(cam.x, tx, k); cam.y = lerp(cam.y, ty, k);
    }
    clampCam();
  }
  function clampCam() {
    var x0 = P(0, rows).x - 60, x1 = P(cols, 0).x + 60, y0 = P(0, 0, WALL_H).y - 40, y1 = P(cols, rows).y + 60;
    cam.x = clamp(cam.x, x0, x1); cam.y = clamp(cam.y, y0, y1);
  }
  function updateHud() {
    var t;
    if (arranging) t = 'arrange: drag a piece, R rotates';
    else if (mode === 'walk' && nearPiece) t = '<b>' + esc(nearPiece.spec.name) + '</b> · press E or click to browse';
    else if (mode === 'walk') t = 'Reading room · ' + plural(books.length, 'book') + ' on ' + (Object.keys(unitCounts).length - 1) + ' cases';
    else t = 'drag to pan · wheel to zoom · click a case to browse it';
    if (t !== whereEl.innerHTML) whereEl.innerHTML = t;
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function frame(ts) {
    now = ts / 1000; var dt = Math.min(0.05, lastT ? now - lastT : 0.016); lastT = now;
    updateAvatar(dt); updateCat(dt); updateCamera(dt);
    render(); updateHud();
    requestAnimationFrame(frame);
  }

  // ---- input --------------------------------------------------------------------------------------
  function hitPiece(X, Y, includeFlat) {
    var ents = pieces.filter(function (p) { return includeFlat || (!p.spec.wall && !p.spec.flat); }).map(function (p) { return { p: p, f: footprint(p) }; });
    var order = drawOrder(ents.filter(function (e) { return !e.p.spec.wall && !e.p.spec.flat; }));
    var flats = ents.filter(function (e) { return e.p.spec.wall || e.p.spec.flat; });
    order = flats.concat(order);
    var sc = toScene(X, Y);
    for (var i = order.length - 1; i >= 0; i--) {
      var p = order[i].p, cc = getCache(p), o = P(p.x, p.y, 0);
      var lx = (sc.x - (o.x + cc.ox)) * cc.z, ly = (sc.y - (o.y + cc.oy)) * cc.z;
      if (lx < 0 || ly < 0 || lx >= cc.canvas.width || ly >= cc.canvas.height) continue;
      if (cc.ctx.getImageData(lx | 0, ly | 0, 1, 1).data[3] > 40) return p;
    }
    return null;
  }
  function pos(e) { var r = view.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  function zoomAt(X, Y, factor) {
    var before = toScene(X, Y);
    cam.z = clamp(cam.z * factor, ZMIN, ZMAX);
    var after = toScene(X, Y);
    cam.x += before.x - after.x; cam.y += before.y - after.y;
    clampCam();
    clearTimeout(zoomTimer); zoomTimer = setTimeout(function () { cacheZ = cam.z; }, 160);
  }
  view.addEventListener('wheel', function (e) {
    if (shelfOpenFor) return;
    e.preventDefault();
    var q = pos(e); zoomAt(q.x, q.y, Math.pow(1.0015, -e.deltaY * (e.deltaMode === 1 ? 20 : 1)));
  }, { passive: false });

  view.addEventListener('pointerdown', function (e) {
    if (shelfOpenFor) return;
    view.setPointerCapture(e.pointerId);
    var q = pos(e);
    pointers[e.pointerId] = q;
    var ids = Object.keys(pointers);
    if (ids.length === 2) { var a = pointers[ids[0]], b = pointers[ids[1]]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) }; drag = null; return; }
    hideTip();
    if (arranging) {
      var hp = hitPiece(q.x, q.y, true);
      selected = hp;
      updateArrSel();
      if (hp) { var t = toTile(q.x, q.y); drag = { kind: 'piece', p: hp, ox: hp.x, oy: hp.y, gx: t.x - (hp.spec.wall ? (hp.r % 2 ? 0 : hp.x) : hp.x), gy: t.y - (hp.spec.wall ? (hp.r % 2 ? hp.y : 0) : hp.y), valid: true, moved: false, start: q }; }
      else drag = { kind: 'pan', start: q, cx: cam.x, cy: cam.y, moved: false };
      return;
    }
    drag = { kind: 'pan', start: q, cx: cam.x, cy: cam.y, moved: false, t: performance.now() };
  });
  view.addEventListener('pointermove', function (e) {
    var q = pos(e);
    if (pointers[e.pointerId]) pointers[e.pointerId] = q;
    if (pinch) {
      var ids = Object.keys(pointers); if (ids.length < 2) return;
      var a = pointers[ids[0]], b = pointers[ids[1]], d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch.d > 0) zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, d / pinch.d);
      pinch.d = d; return;
    }
    if (drag) {
      if (Math.hypot(q.x - drag.start.x, q.y - drag.start.y) > 6) drag.moved = true;
      if (drag.kind === 'pan' && drag.moved) {
        cam.x = drag.cx - (q.x - drag.start.x) / cam.z; cam.y = drag.cy - (q.y - drag.start.y) / cam.z; follow = false; clampCam();
        view.className = 'grab';
      } else if (drag.kind === 'piece' && drag.moved) {
        var t = toTile(q.x, q.y), p = drag.p, nx, ny;
        if (p.spec.wall) { if (p.r % 2) { nx = 0; ny = Math.round(t.y - drag.gy); } else { nx = Math.round(t.x - drag.gx); ny = 0; } }
        else { nx = Math.round(t.x - drag.gx); ny = Math.round(t.y - drag.gy); }
        p.x = nx; p.y = ny; drag.valid = validPlace(p, nx, ny, p.r);
        view.className = 'move';
      }
      return;
    }
    if (shelfOpenFor) return;
    var hp = hitPiece(q.x, q.y, arranging);
    hover = hp;
    if (hp && (arranging || hp.spec.kind === 'case' || hp.spec.kind === 'desk')) {
      view.className = 'pointer';
      var c = unitCounts[hp.spec.unit];
      showTip(q.x, q.y, '<b>' + esc(hp.spec.name) + '</b>' + (c ? '<br><span>' + plural(c.books, 'book') + (c.objects ? ' · ' + plural(c.objects, 'object') : '') + '</span>' : (arranging ? '<br><span>drag to move · R to rotate</span>' : '')));
    } else { view.className = mode === 'pan' ? 'grab' : ''; hideTip(); }
  });
  function endPointer(e) {
    var q = pos(e);
    delete pointers[e.pointerId];
    if (pinch) { if (Object.keys(pointers).length < 2) pinch = null; drag = null; return; }
    if (!drag) return;
    var d = drag; drag = null;
    view.className = mode === 'pan' ? 'grab' : '';
    if (d.kind === 'piece') {
      if (d.moved) {
        var p = d.p, nx = p.x, ny = p.y; p.x = d.ox; p.y = d.oy;
        if (d.valid && (nx !== d.ox || ny !== d.oy)) commit(function () { p.x = nx; p.y = ny; });
      }
      updateArrSel();
      return;
    }
    if (d.moved) return;
    // a tap or click
    if (arranging) return;
    var hp = hitPiece(q.x, q.y, false);
    if (hp && (hp.spec.kind === 'case' || hp.spec.kind === 'desk')) { openShelf(hp); return; }
    if (mode === 'walk') {
      var t = toTile(q.x, q.y);
      if (free(t.x, t.y)) { avatar.path = findPath(avatar.x, avatar.y, t.x, t.y); follow = true; }
    }
  }
  view.addEventListener('pointerup', endPointer);
  view.addEventListener('pointercancel', function (e) { delete pointers[e.pointerId]; drag = null; pinch = null; });
  view.addEventListener('pointerleave', function () { if (!drag) { hover = null; hideTip(); } });
  view.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  function showTip(x, y, html) {
    tipEl.innerHTML = html; tipEl.classList.add('show');
    var r = stage.getBoundingClientRect(), tw = tipEl.offsetWidth, th = tipEl.offsetHeight;
    tipEl.style.left = clamp(x + 14, 4, r.width - tw - 4) + 'px';
    tipEl.style.top = clamp(y + 16, 4, r.height - th - 4) + 'px';
  }
  function hideTip() { tipEl.classList.remove('show'); }

  document.addEventListener('keydown', function (e) {
    var tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea') { if (e.key === 'Escape') { e.target.blur(); resultsEl.classList.remove('show'); } return; }
    if (e.key === 'Escape') {
      if (cardEl.classList.contains('show')) closeCard();
      else if (shelfOpenFor) closeShelf();
      else if ($('help').classList.contains('show')) $('help').classList.remove('show');
      else if (arranging) setArrange(false);
      return;
    }
    if (shelfOpenFor || cardEl.classList.contains('show')) return;
    if (e.key === 'Tab' && !e.ctrlKey) { e.preventDefault(); setMode(mode === 'walk' ? 'pan' : 'walk'); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { if (arranging) { e.preventDefault(); undo(); } return; }
    var k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (['w', 'a', 's', 'd', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].indexOf(k) >= 0) { keys[k] = true; e.preventDefault(); return; }
    if (k === 'e' && !arranging && mode === 'walk' && nearPiece) openShelf(nearPiece);
    else if (k === 'l') setLabels(!labels);
    else if (k === 'n') setNight(!night);
    else if (k === 'r' && arranging) rotateSelected();
    else if (k === '?' || k === 'h') $('help').classList.toggle('show');
    else if (k === '+' || k === '=') zoomAt(W / 2, H / 2, 1.2);
    else if (k === '-') zoomAt(W / 2, H / 2, 1 / 1.2);
  });
  document.addEventListener('keyup', function (e) { var k = e.key.length === 1 ? e.key.toLowerCase() : e.key; keys[k] = false; });
  window.addEventListener('blur', function () { keys = {}; });

  // ---- toggles ----------------------------------------------------------------------------------------
  function setMode(m) {
    mode = m; follow = true;
    $('btn-mode').textContent = m === 'walk' ? 'walk' : 'pan';
    $('btn-mode').classList.toggle('on', m === 'pan');
    keysEl.innerHTML = m === 'walk' ? '<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> walk · click the floor to go there · <kbd>E</kbd> browse the case you are facing · wheel to zoom'
      : 'drag to pan · wheel to zoom · <kbd>Tab</kbd> back to walking';
    view.className = m === 'pan' ? 'grab' : '';
  }
  function setNight(v) { night = v; $('btn-night').classList.toggle('on', v); invalidateCaches(); }
  function setLabels(v) { labels = v; $('btn-labels').classList.toggle('on', v); }
  function setPaint(v) { paint = v; invalidateCaches(); Array.prototype.forEach.call(legendEl.children, function (b) { b.classList.toggle('on', b.dataset.paint === v); }); if (shelfOpenFor) buildShelfView(shelfOpenFor); }
  $('btn-mode').addEventListener('click', function () { setMode(mode === 'walk' ? 'pan' : 'walk'); });
  $('btn-night').addEventListener('click', function () { setNight(!night); });
  $('btn-labels').addEventListener('click', function () { setLabels(!labels); });
  $('btn-help').addEventListener('click', function () { $('help').classList.toggle('show'); });
  $('btn-close').addEventListener('click', function () { $('help').classList.remove('show'); });
  $('help').addEventListener('click', function (e) { if (e.target === $('help')) $('help').classList.remove('show'); });
  [['genre', 'genre'], ['lang', 'language'], ['era', 'era']].forEach(function (pr) {
    var b = el('button', pr[0] === 'genre' ? 'on' : '', pr[1]); b.dataset.paint = pr[0]; b.title = 'colour the spines by ' + pr[1];
    b.addEventListener('click', function () { setPaint(pr[0]); }); legendEl.appendChild(b);
  });

  // ---- arrange mode -------------------------------------------------------------------------------------
  function setArrange(v) {
    arranging = v; selected = null; drag = null;
    stage.classList.toggle('arranging', v); arrbar.classList.toggle('show', v);
    $('btn-arrange').classList.toggle('on', v);
    if (v) { closeShelf(); follow = false; keysEl.innerHTML = 'drag a piece · <kbd>R</kbd> rotate · <kbd>Ctrl</kbd>+<kbd>Z</kbd> undo · <kbd>Esc</kbd> done'; }
    else { unstick(avatar); unstick(cat); cat.path = []; follow = true; setMode(mode); }
    updateArrSel();
  }
  function updateArrSel() {
    $('arr-sel').textContent = selected ? selected.spec.name + ' (' + (selected.spec.wall ? (selected.r % 2 ? 'left wall, ' + selected.y : 'back wall, ' + selected.x) : selected.x + ', ' + selected.y + ', r' + selected.r) + ')' : 'click a piece';
    $('arr-undo').disabled = !undoStack.length;
  }
  function commit(fn) {
    undoStack.push(snapshot()); if (undoStack.length > 60) undoStack.shift();
    fn(); rebuildObstacles(); saveLayout(); unstick(avatar); unstick(cat); cat.path = []; updateArrSel();
  }
  function undo() {
    var s = undoStack.pop(); if (!s) return;
    var sel = selected && selected.id;
    applyLayout(s); saveLayout(); selected = sel ? pieceById[sel] : null; updateArrSel();
  }
  function rotateSelected() {
    var p = selected; if (!p) return;
    var nr = (p.r + 1) & 3;
    if (p.spec.wall) {
      var len = nr % 2 ? rows : cols, posv = clamp(nr % 2 ? p.y : p.x, 0, len - p.spec.w), nx = nr % 2 ? 0 : posv, ny = nr % 2 ? posv : 0;
      if (validPlace(p, nx, ny, nr)) commit(function () { p.r = nr; p.x = nx; p.y = ny; }); else flashSel();
      return;
    }
    if (validPlace(p, p.x, p.y, nr)) commit(function () { p.r = nr; });
    else {
      // try nudging so the rotated footprint fits
      var w = nr % 2 ? p.spec.d : p.spec.w, d = nr % 2 ? p.spec.w : p.spec.d, placed = false;
      for (var dy = 0; dy >= -(d - 1) && !placed; dy--) for (var dx = 0; dx >= -(w - 1) && !placed; dx--) {
        if (validPlace(p, p.x + dx, p.y + dy, nr)) { placed = true; commit(function () { p.r = nr; p.x += dx; p.y += dy; }); }
      }
      if (!placed) flashSel();
    }
  }
  function flashSel() { $('arr-sel').textContent = 'no room to rotate'; setTimeout(updateArrSel, 900); }
  $('btn-arrange').addEventListener('click', function () { setArrange(!arranging); });
  $('arr-done').addEventListener('click', function () { setArrange(false); });
  $('arr-rotate').addEventListener('click', rotateSelected);
  $('arr-undo').addEventListener('click', undo);
  $('arr-reset').addEventListener('click', function () { commit(function () { applyLayout(JSON.parse(JSON.stringify(DEFAULT))); }); selected = null; updateArrSel(); });
  $('arr-export').addEventListener('click', function () {
    var blob = new Blob([JSON.stringify(snapshot(), null, 2)], { type: 'application/json' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'reading-room-layout.json'; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  });
  $('arr-import').addEventListener('click', function () { $('arr-file').click(); });
  $('arr-file').addEventListener('change', function () {
    var f = this.files && this.files[0]; if (!f) return;
    var rd = new FileReader();
    rd.onload = function () {
      try {
        var lay = JSON.parse(rd.result);
        if (!validLayout(lay)) throw new Error('shape');
        commit(function () { applyLayout(lay); }); selected = null; updateArrSel();
      } catch (err) { $('arr-sel').textContent = 'not a layout file'; setTimeout(updateArrSel, 1500); }
    };
    rd.readAsText(f); this.value = '';
  });

  // ---- shelf view -----------------------------------------------------------------------------------------
  function openShelf(p, pulseId) {
    if (!p) return;
    shelfOpenFor = p; lastFocus = document.activeElement;
    hideTip(); hover = null; keys = {};
    buildShelfView(p, pulseId);
    shelfEl.classList.add('show');
    $('shelf-close').focus();
  }
  function closeShelf() {
    if (!shelfOpenFor) return;
    shelfOpenFor = null; shelfEl.classList.remove('show');
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  $('shelf-close').addEventListener('click', closeShelf);
  var SV = { u: 300, v: 170 };            // px per tile and per height unit in the close-up
  function buildShelfView(p, pulseId) {
    var s = p.spec, u = s.unit, unit = UNITS[u];
    $('shelf-title').textContent = s.name;
    $('shelf-desc').textContent = unit.desc;
    var c = unitCounts[u] || { books: 0, objects: 0 };
    $('shelf-count').textContent = plural(c.books, 'book') + (c.objects ? ' · ' + plural(c.objects, 'object') : '') + ' · unit ' + u;
    shelvesEl.innerHTML = '';
    var boardCls = s.kind === 'desk' ? 'desk' : (s.wood || 'pine');
    function shelfRow(name, label) {
      var items = itemsOf(u, name), row = el('div', 'shelfrow');
      var nm = el('div', 'name'); nm.appendChild(el('b', '', label || name)); nm.appendChild(el('small', '', plural(items.filter(function (i) { return !i.obj; }).length, 'book') + (items.some(function (i) { return i.obj; }) ? ' · ' + plural(items.filter(function (i) { return i.obj; }).length, 'object') : '')));
      row.appendChild(nm);
      var board = el('div', 'board ' + boardCls);
      items.forEach(function (it) { board.appendChild(itemEl(it, name)); });
      row.appendChild(board);
      return row;
    }
    if (s.kind === 'desk') {
      unit.shelves.forEach(function (nm) { shelvesEl.appendChild(shelfRow(nm)); });
    } else {
      if (s.top) { shelvesEl.appendChild(el('div', 'col-title', 'on top')); shelvesEl.appendChild(shelfRow(s.top)); }
      s.cols.forEach(function (col, ci) {
        if (s.cols.length > 1) shelvesEl.appendChild(el('div', 'col-title', 'case ' + (ci + 1) + ' of ' + s.cols.length));
        col.forEach(function (nm) { shelvesEl.appendChild(shelfRow(nm)); });
      });
    }
    shelvesEl.scrollTop = 0;
    drawCutin(p);
    if (pulseId) {
      var target = shelvesEl.querySelector('[data-id="' + CSS.escape(pulseId) + '"]');
      if (target) {
        target.classList.add('pulse');
        var board = target.parentNode;
        board.scrollLeft = Math.max(0, target.offsetLeft - board.clientWidth / 2);
        setTimeout(function () { target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: REDUCED ? 'auto' : 'smooth' }); }, 30);
        setTimeout(function () { target.classList.remove('pulse'); target.classList.add('hit'); }, 3800);
      }
    }
  }
  function itemEl(it, shelfName) {
    var b = it.b, node;
    if (it.obj) {
      node = el('div', 'prop');
      var cv = document.createElement('canvas'), pw = Math.max(14, Math.round(it.w * SV.u)), ph = Math.round(it.h * SV.v);
      cv.width = pw * 2; cv.height = ph * 2; cv.style.width = pw + 'px'; cv.style.height = ph + 'px';
      var c = cv.getContext('2d'); c.setTransform(pw * 2 / it.w, 0, 0, -ph * 2 / it.h, 0, ph * 2);
      SPR.draw(c, it.kind, it.w, it.h, 2000, b);
      node.appendChild(cv); node.appendChild(el('small', '', SPR.LABEL[it.kind] || 'object'));
      node.setAttribute('role', 'button'); node.tabIndex = 0;
    } else {
      node = el('button', 'spine', b.t);
      node.style.width = Math.max(13, Math.round(it.w * SV.u)) + 'px';
      node.style.height = Math.round(it.h * SV.v) + 'px';
      node.style.background = colorOf(it);
      node.style.color = 'rgba(255,255,255,0.92)';
    }
    node.dataset.id = b.id;
    node.setAttribute('aria-label', b.t);
    node.addEventListener('mouseenter', function (e) { showTip(e.clientX - stage.getBoundingClientRect().left, e.clientY - stage.getBoundingClientRect().top, tipHtml(b, shelfName)); });
    node.addEventListener('mousemove', function (e) { var r = stage.getBoundingClientRect(); showTip(e.clientX - r.left, e.clientY - r.top, tipHtml(b, shelfName)); });
    node.addEventListener('mouseleave', hideTip);
    node.addEventListener('click', function () { hideTip(); openCard(it); });
    node.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openCard(it); } });
    return node;
  }
  function tipHtml(b, shelfName) {
    var bits = [];
    if (b.a) bits.push(esc(b.a));
    if (b.y) bits.push(b.y);
    bits.push(esc(shelfName) + ' · ' + b.p);
    return '<b>' + esc(cleanTitle(b)) + '</b><br><span>' + bits.join(' · ') + '</span>';
  }
  function cleanTitle(b) { return b.t.replace(/^\(not a book\)\s*/i, ''); }
  function drawCutin(p) {
    var c = cutin.getContext('2d'), cw = cutin.width, ch = cutin.height;
    c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, cw, ch);
    var sw = (cols + rows) * TW / 2, sh = (cols + rows) * TH / 2 + 2.5 * HZ, k = Math.min(cw / sw, ch / sh) * 0.92;
    c.setTransform(k, 0, 0, k, cw / 2, ch / 2 - (P(0, 0).y + P(cols, rows).y) / 2 * k + 1.2 * HZ * k);
    polyAt(c, [P(0, 0), P(cols, 0), P(cols, rows), P(0, rows)], 'rgba(185,138,90,0.55)');
    pieces.forEach(function (q) {
      if (q.spec.wall || q.spec.flat) return;
      var f = footprint(q), h = q === p ? (q.spec.h || 1) : 0.25;
      box(c, f.x0, f.y0, f.x1 - f.x0, f.y1 - f.y0, 0, h, q === p ? { top: '#ffcf7a', side: '#d9a84a', side2: '#b88a30' } : { top: 'rgba(239,228,207,0.5)', side: 'rgba(239,228,207,0.3)', side2: 'rgba(239,228,207,0.2)' });
    });
    var a = P(avatar.x, avatar.y, 0);
    c.fillStyle = '#e06a5a'; c.beginPath(); c.arc(a.x, a.y - 8, 10, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#ffd9d2'; c.beginPath(); c.arc(a.x, a.y - 8, 4, 0, Math.PI * 2); c.fill();
  }

  // ---- book card ---------------------------------------------------------------------------------------------
  function openCard(it) {
    var b = it.b;
    $('card-spine').style.background = it.obj ? '#8a7a66' : colorOf(it);
    $('card-title').textContent = cleanTitle(b);
    $('card-by').textContent = it.obj ? 'not a book' + (b.a ? ' · ' + b.a : '') : (b.a || 'author not recorded') + (b.pub ? ' · ' + b.pub : '');
    var meta = $('card-meta'); meta.innerHTML = '';
    function m(label, val) { if (!val) return; var sp = el('span'); sp.appendChild(document.createTextNode(label + ' ')); sp.appendChild(el('b', '', val)); meta.appendChild(sp); }
    m('year', b.yr || b.y); m('genre', b.g); m('type', b.ty); m('language', b.l);
    $('card-desc').textContent = b.d || '';
    var loc = $('card-loc'); loc.innerHTML = '';
    loc.appendChild(el('span', '', (UNITS[b.u] ? UNITS[b.u].name : b.u) + ' · ' + b.s + ' · position ' + b.p));
    var a = el('a', '', 'open on the Bookshelf →'); a.href = '../../#/bookshelf/' + encodeURIComponent(b.id); loc.appendChild(a);
    if (b.free && b.free.url) { var f = el('a', '', 'free e-text (' + (b.free.src === 'aozora' ? 'Aozora Bunko' : 'Project Gutenberg') + ')'); f.href = b.free.url; f.target = '_blank'; f.rel = 'noopener'; loc.appendChild(f); }
    shadeEl.classList.add('show'); cardEl.classList.add('show'); cardEl.scrollTop = 0;
    $('card-close').focus();
  }
  function closeCard() { shadeEl.classList.remove('show'); cardEl.classList.remove('show'); if (shelfOpenFor) $('shelf-close').focus(); }
  $('card-close').addEventListener('click', closeCard);
  shadeEl.addEventListener('click', closeCard);

  // ---- search ------------------------------------------------------------------------------------------------
  var resIndex = -1, results = [];
  function search(q) {
    var n = norm(q).trim(); if (!n) return [];
    var words = n.split(/\s+/), out = [];
    for (var i = 0; i < searchIndex.length; i++) {
      var e = searchIndex[i], ok = true, score = 0;
      for (var w = 0; w < words.length; w++) { var ix = e.key.indexOf(words[w]); if (ix < 0) { ok = false; break; } score += ix === 0 ? 3 : (e.tkey.indexOf(words[w]) >= 0 ? 2 : 1); }
      if (ok) out.push({ e: e, score: score + (e.tkey.indexOf(n) === 0 ? 4 : 0) });
    }
    out.sort(function (a, b) { return b.score - a.score || a.e.b.t.localeCompare(b.e.b.t); });
    return out.slice(0, 8).map(function (r) { return r.e; });
  }
  function renderResults() {
    resultsEl.innerHTML = '';
    results.forEach(function (e, i) {
      var b = e.b, it = byId[b.id], d = el('div', i === resIndex ? 'sel' : '');
      var sw = el('i'); sw.style.background = it.obj ? '#8a7a66' : colorOf(it); d.appendChild(sw);
      d.appendChild(el('b', '', cleanTitle(b)));
      d.appendChild(el('small', '', (b.a ? b.a + ' · ' : '') + (UNITS[b.u] ? UNITS[b.u].name : b.u)));
      d.addEventListener('mousedown', function (ev) { ev.preventDefault(); goTo(b); });
      resultsEl.appendChild(d);
    });
    resultsEl.classList.toggle('show', results.length > 0);
  }
  findEl.addEventListener('input', function () { results = search(findEl.value); resIndex = results.length ? 0 : -1; renderResults(); });
  findEl.addEventListener('focus', function () { if (results.length) resultsEl.classList.add('show'); });
  findEl.addEventListener('blur', function () { setTimeout(function () { resultsEl.classList.remove('show'); }, 120); });
  findEl.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); resIndex = Math.min(results.length - 1, resIndex + 1); renderResults(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); resIndex = Math.max(0, resIndex - 1); renderResults(); }
    else if (e.key === 'Enter') { e.preventDefault(); if (results[resIndex]) goTo(results[resIndex].b); }
  });
  function goTo(b) {
    var p = pieceByUnit[b.u]; if (!p) return;
    resultsEl.classList.remove('show'); findEl.blur();
    closeShelf(); closeCard();
    if (arranging) setArrange(false);
    var f = footprint(p), s = p.spec, centre = P((f.x0 + f.x1) / 2, (f.y0 + f.y1) / 2, (s.h || 1) / 2);
    var z = Math.max(cam.z, 1.7);
    fly = { t0: now, dur: REDUCED ? 0.01 : 0.75, x0: cam.x, y0: cam.y, z0: cam.z, x1: centre.x, y1: centre.y, z1: z, cb: function () { openShelf(p, b.id); } };
    follow = false;
    if (mode === 'walk') { var t = frontTile(p); if (t) avatar.path = findPath(avatar.x, avatar.y, t.x, t.y); }
  }

  // ---- sizing and start ------------------------------------------------------------------------------------------
  function resize() {
    var r = stage.getBoundingClientRect();
    W = Math.max(1, Math.round(r.width)); H = Math.max(1, Math.round(r.height));
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    view.width = Math.round(W * dpr); view.height = Math.round(H * dpr);
    invalidateCaches();
  }
  function fitZoom() {
    var sw = (cols + rows) * TW / 2 + 60, sh = (cols + rows) * TH / 2 + WALL_H * HZ + 60;
    return clamp(Math.min(W / sw, H / sh), ZMIN, ZMAX);
  }
  function init() {
    resize();
    window.addEventListener('resize', function () { resize(); if (THUMB) placeThumb(); });
    var saved = load(STORE);
    applyLayout(validLayout(saved) ? saved : JSON.parse(JSON.stringify(DEFAULT)));
    var k = pieceById.K;
    if (k) { var t = frontTile(k); if (t) { avatar.x = t.x + 1; avatar.y = t.y + 0.3; if (!free(avatar.x, avatar.y)) { avatar.x = t.x; avatar.y = t.y; } } }
    avatar.dx = -0.7; avatar.dy = -0.7;
    var spots = catSpots(); cat.x = spots[spots.length - 1].x; cat.y = spots[spots.length - 1].y; cat.t = 6; cat.spot = spots.length - 1;
    for (var i = 0; i < 40; i++) motes.push({ a: (hash('ma' + i) % 1000) / 1000, t: (hash('mt' + i) % 1000) / 1000, v: 0.02 + (hash('mv' + i) % 100) / 4000, ph: (hash('mp' + i) % 628) / 100 });
    if (THUMB) placeThumb();
    else {
      cam.z = cacheZ = clamp(Math.min(1.45, fitZoom() * 1.5), 0.7, 1.6);
      var o = P(avatar.x, avatar.y, 0); cam.x = o.x; cam.y = o.y - 50; clampCam();
    }
    setMode(params.get('pan') === '1' ? 'pan' : 'walk'); setLabels(labels);
    if (params.get('night') === '1') setNight(true);
    requestAnimationFrame(frame);
    // deep links, also handy for screenshots: ?shelf=K opens a case, ?arrange=1 the editor
    var open = params.get('shelf'), find = params.get('find'), card = params.get('card');
    requestAnimationFrame(function () {
      if (open && pieceByUnit[open]) openShelf(pieceByUnit[open], params.get('pulse') || '');
      if (card && byId[card]) { if (!shelfOpenFor && pieceByUnit[byId[card].b.u]) openShelf(pieceByUnit[byId[card].b.u], card); openCard(byId[card]); }
      if (find) { findEl.value = find; results = search(find); if (results.length) goTo(results[0].b); }
      if (params.get('arrange') === '1') { setArrange(true); selected = pieceById[params.get('select') || 'H'] || null; updateArrSel(); }
    });
  }
  function placeThumb() {
    cam.z = cacheZ = fitZoom() * 1.16; follow = false;
    cam.x = (P(0, rows).x + P(cols, 0).x) / 2 + 20;
    cam.y = Math.min((P(0, 0, WALL_H).y + P(cols, rows).y) / 2, P(0, 0, WALL_H).y - 52 + H / (2 * cam.z));   // keep the wall tops and labels in frame; the empty front corner may crop
    labels = true; keysEl.style.display = 'none';
    avatar.dx = -0.7; avatar.dy = -0.7;
    var sp = catSpots(); cat.x = sp[sp.length - 1].x; cat.y = sp[sp.length - 1].y; cat.state = 'sleep';
  }

  fetch('../../assets/data/library.json').then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }).then(function (d) {
    books = d.books || []; objects = d.objects || [];
    prepItems();
    init();
  }).catch(function (err) {
    showMsg('The catalogue (assets/data/library.json) could not be loaded, so the room is empty. ' + (err && err.message ? '(' + err.message + ')' : ''));
    whereEl.textContent = 'no catalogue';
  });
})();
