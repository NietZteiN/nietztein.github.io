/*
 * Read-Order Oracle: the page.
 *
 * Everything that touches the DOM lives here: loading the catalogue, the
 * canvas map (pan, zoom, level of detail, label placement, selection,
 * journeys, the Grand Tour overlay, the minimap, the poster export), the
 * panel (search, station sheet, journey planner, lines, reading list), the
 * bottom sheet on phones, hash state and the theme. The pure logic is in
 * oracle.js (text similarity, tours) and network.js (lines, layout, journeys).
 */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var CELL = 26;                                   // px per grid cell at zoom 1
  var MIN_K = 0.12, MAX_K = 4;
  var STORE = { list: 'oracle.list', onboarded: 'oracle.onboarded', theme: 'oracle.theme' };

  /* Line colours: twelve categorical hues, one set per theme, validated with the
     dataviz palette checks (lightness band, chroma, adjacent CVD and normal-vision
     separation, 3:1 contrast on each map surface). Slot order is fixed: colour follows
     the line, never its rank. */
  var PALETTE = {
    dark: ['#00893c', '#a4469e', '#849c00', '#d95d94', '#386cd0', '#bf3f3d', '#009697', '#d96e00', '#009ccf', '#906b00', '#907aeb', '#00a883'],
    light: ['#007834', '#94368f', '#7b9200', '#cf548b', '#2a5dbf', '#ae2d2f', '#009697', '#cb6700', '#0093c2', '#7e5d00', '#8770e1', '#009e7a']
  };

  /* ---------- state ---------- */
  var books = [], n = 0, vec = null, S = null, net = null, byId = {};
  var usingSample = false;
  var sel = -1, fromIdx = -1, toIdx = -1, journey = null, lineSel = -1, hoverIdx = -1;
  var tour = null, tourOn = false;
  var list = [];
  var theme = 'dark';
  var view = { k: 0.5, tx: 0, ty: 0 };
  var canvas = $('map'), ctx = canvas.getContext('2d'), mini = $('minimap'), mctx = mini.getContext('2d');
  var dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  var needsDraw = false, anim = null;
  var linePts = [], stDir = null, stCellIdx = null, cellIndexOf = [], labelCache = { key: '', items: null, placed: null };
  var textW = {};

  /* ---------- helpers ---------- */
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function short(s, m) { s = String(s); return s.length > m ? s.slice(0, m - 1) + '…' : s; }
  function colour(li) { return PALETTE[theme][li % PALETTE[theme].length]; }
  function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; }
  function store(key, val) { try { if (val === undefined) return localStorage.getItem(key); localStorage.setItem(key, val); } catch (e) { return null; } }
  function bookLabel(b) { return b.t + (b.a ? ' — ' + b.a : ''); }
  function lineOfBook(i) { return net.lines[net.lineOf[i]]; }
  function chip(li) { var L = net.lines[li]; return '<span class="chip"><span class="code" style="background:' + colour(li) + '">' + L.code + '</span>' + esc(L.name) + '</span>'; }
  function isMobile() { return window.matchMedia('(max-width: 760px)').matches; }

  /* ---------- loading ---------- */
  function setLoading(text, frac) { $('loading-text').textContent = text; if (frac !== undefined) $('loading').querySelector('.bar i').style.width = Math.round(frac * 100) + '%'; }
  function note(t) { var e = $('mapnote'); e.textContent = t; e.classList.toggle('show', !!t); }

  function loadCatalogue() {
    return fetch('../../assets/data/library.json').then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (j) { if (!j || !j.books || !j.books.length) throw new Error('empty catalogue'); return j.books; })
      .catch(function (err) {
        usingSample = true;
        return new Promise(function (resolve) {
          var s = document.createElement('script');
          s.src = 'sample.js';
          s.onload = function () { resolve(window.ORACLE_SAMPLE.books); };
          s.onerror = function () { resolve([]); };
          document.head.appendChild(s);
        }).then(function (b) { note('The catalogue could not be loaded (' + err.message + '); this map is drawn from ' + b.length + ' invented books instead.'); return b; });
      });
  }

  function boot() {
    theme = store(STORE.theme) || (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
    applyTheme();
    loadList();
    setLoading('Loading the catalogue…', 0.1);
    loadCatalogue().then(function (raw) {
      if (!raw.length) { setLoading('No catalogue could be loaded.', 0); return; }
      books = raw.map(function (b) { return { id: b.id, t: b.t || '(untitled)', a: b.a || '', l: b.l || '', g: b.g || 'Unidentified', ty: b.ty || '', y: b.y, d: b.d || '', s: b.s || '', u: b.u || '' }; });
      n = books.length;
      books.forEach(function (b, i) { byId[b.id] = i; });
      setLoading('Comparing ' + n + ' descriptions…', 0.3);
      setTimeout(function () {
        vec = Oracle.vectorize(books);
        S = Oracle.similarityMatrix(books, vec, null);
        setLoading('Laying the lines…', 0.55);
        setTimeout(function () {
          net = Network.buildNetwork(books, vec, S, {});
          setLoading('Drawing the map…', 0.9);
          setTimeout(function () { ready(); }, 10);
        }, 10);
      }, 10);
    });
  }

  function ready() {
    prepareGeometry();
    resize();
    fitView(false);
    renderLines();
    renderInterchanges();
    renderList();
    $('q').disabled = false;
    $('loading').classList.add('hide');
    if (!store(STORE.onboarded)) $('onboard').classList.add('show');
    readHash(true);
    requestDraw();
  }

  /* ---------- geometry derived from the network ---------- */
  function prepareGeometry() {
    linePts = net.lines.map(function (L, li) { return Network.linePoints(net, li); });
    stDir = new Int8Array(n); stCellIdx = new Int32Array(n);
    cellIndexOf = net.paths.map(function (cells) { var m = {}; cells.forEach(function (c, i) { m[c[0] + ',' + c[1]] = i; }); return m; });
    for (var i = 0; i < n; i++) {
      var li = net.lineOf[i], cells = net.paths[li], idx = cellIndexOf[li][net.x[i] + ',' + net.y[i]];
      if (idx === undefined) idx = 0;
      stCellIdx[i] = idx;
      var a = cells[Math.max(0, idx - 1)], b = cells[Math.min(cells.length - 1, idx + 1)];
      var dx = Math.sign(b[0] - a[0]), dy = Math.sign(b[1] - a[1]);
      var d = -1; for (var k = 0; k < 8; k++) if (Network.DIRS[k][0] === dx && Network.DIRS[k][1] === dy) d = k;
      stDir[i] = d < 0 ? 0 : d;
    }
  }

  /* ---------- view transforms ---------- */
  function toScreen(wx, wy) { return [wx * CELL * view.k + view.tx, wy * CELL * view.k + view.ty]; }
  function toWorld(sx, sy) { return [(sx - view.tx) / (CELL * view.k), (sy - view.ty) / (CELL * view.k)]; }
  function cw() { return canvas.clientWidth; }
  function chh() { return canvas.clientHeight; }

  function resize() {
    var w = cw(), h = chh();
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    requestDraw();
  }

  function clampView(v) {
    v.k = Math.max(MIN_K, Math.min(MAX_K, v.k));
    var W = net.width * CELL * v.k, H = net.height * CELL * v.k, w = cw(), h = chh(), m = 80;
    v.tx = Math.min(w - m, Math.max(m - W, v.tx));
    v.ty = Math.min(h - m, Math.max(m - H, v.ty));
    return v;
  }

  function fitView(animate) {
    var w = cw(), h = chh(), pad = 24;
    var k = Math.min((w - 2 * pad) / (net.width * CELL), (h - 2 * pad) / (net.height * CELL));
    var target = { k: k, tx: (w - net.width * CELL * k) / 2, ty: (h - net.height * CELL * k) / 2 };
    if (animate) animateTo(target, 380); else { view = target; requestDraw(); }
  }

  function zoomAt(factor, sx, sy, animate) {
    var k2 = Math.max(MIN_K, Math.min(MAX_K, view.k * factor)), f = k2 / view.k;
    var target = { k: k2, tx: sx - (sx - view.tx) * f, ty: sy - (sy - view.ty) * f };
    clampView(target);
    if (animate) animateTo(target, 220); else { view = target; requestDraw(); }
  }

  function zoomToStation(i, k, ms) {
    var w = cw(), h = chh(), kk = k || Math.max(view.k, 1.6);
    var cx = w / 2, cy = h / 2;
    if (isMobile()) cy = h * 0.3;   // the sheet covers the bottom
    var target = { k: kk, tx: cx - net.x[i] * CELL * kk, ty: cy - net.y[i] * CELL * kk };
    animateTo(target, ms || 380);
  }

  function animateTo(target, ms) {
    var from = { k: view.k, tx: view.tx, ty: view.ty }, t0 = performance.now();
    if (anim) cancelAnimationFrame(anim);
    function step(now) {
      var u = Math.min(1, (now - t0) / ms), e = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
      // interpolate in log-zoom so the motion feels even
      var lk = Math.exp(Math.log(from.k) + (Math.log(target.k) - Math.log(from.k)) * e);
      view = { k: lk, tx: from.tx + (target.tx - from.tx) * e, ty: from.ty + (target.ty - from.ty) * e };
      draw();
      if (u < 1) anim = requestAnimationFrame(step); else anim = null;
    }
    anim = requestAnimationFrame(step);
  }

  function requestDraw() { if (needsDraw) return; needsDraw = true; requestAnimationFrame(function () { needsDraw = false; draw(); }); }

  /* ---------- painters: the same scene goes to the canvas and to the poster SVG ---------- */
  function CanvasPainter(c, scale) { this.c = c; this.s = scale || 1; }
  CanvasPainter.prototype = {
    line: function (pts, o) {
      var c = this.c, s = this.s; if (pts.length < 2) return;
      c.save(); c.globalAlpha = o.alpha === undefined ? 1 : o.alpha; c.strokeStyle = o.color; c.lineWidth = o.width * s; c.lineCap = o.cap || 'round'; c.lineJoin = 'round';
      if (o.dash) c.setLineDash(o.dash.map(function (d) { return d * s; }));
      c.beginPath(); c.moveTo(pts[0][0] * s, pts[0][1] * s); for (var i = 1; i < pts.length; i++) c.lineTo(pts[i][0] * s, pts[i][1] * s); c.stroke(); c.restore();
    },
    circle: function (x, y, r, o) {
      var c = this.c, s = this.s; c.save(); c.globalAlpha = o.alpha === undefined ? 1 : o.alpha; c.beginPath(); c.arc(x * s, y * s, r * s, 0, Math.PI * 2);
      if (o.fill) { c.fillStyle = o.fill; c.fill(); } if (o.stroke) { c.strokeStyle = o.stroke; c.lineWidth = (o.width || 1) * s; c.stroke(); } c.restore();
    },
    text: function (x, y, str, o) {
      var c = this.c, s = this.s; c.save(); c.globalAlpha = o.alpha === undefined ? 1 : o.alpha; c.font = (o.weight || 600) + ' ' + (o.size * s) + 'px ' + FONT; c.textAlign = o.align || 'left'; c.textBaseline = o.baseline || 'middle';
      c.translate(x * s, y * s); if (o.angle) c.rotate(o.angle);
      if (o.halo) { c.strokeStyle = o.halo; c.lineWidth = 3 * s; c.lineJoin = 'round'; c.strokeText(str, 0, 0); }
      c.fillStyle = o.color; c.fillText(str, 0, 0); c.restore();
    },
    rect: function (x, y, w, h, o) { var c = this.c, s = this.s; c.save(); c.globalAlpha = o.alpha === undefined ? 1 : o.alpha; if (o.fill) { c.fillStyle = o.fill; c.fillRect(x * s, y * s, w * s, h * s); } if (o.stroke) { c.strokeStyle = o.stroke; c.lineWidth = (o.width || 1) * s; c.strokeRect(x * s, y * s, w * s, h * s); } c.restore(); }
  };
  function SvgPainter() { this.out = []; }
  SvgPainter.prototype = {
    line: function (pts, o) { if (pts.length < 2) return; this.out.push('<polyline fill="none" stroke="' + o.color + '" stroke-width="' + r2(o.width) + '" stroke-linecap="' + (o.cap || 'round') + '" stroke-linejoin="round"' + (o.alpha !== undefined && o.alpha < 1 ? ' opacity="' + o.alpha + '"' : '') + (o.dash ? ' stroke-dasharray="' + o.dash.join(' ') + '"' : '') + ' points="' + pts.map(function (p) { return r2(p[0]) + ',' + r2(p[1]); }).join(' ') + '"/>'); },
    circle: function (x, y, r, o) { this.out.push('<circle cx="' + r2(x) + '" cy="' + r2(y) + '" r="' + r2(r) + '" fill="' + (o.fill || 'none') + '"' + (o.stroke ? ' stroke="' + o.stroke + '" stroke-width="' + r2(o.width || 1) + '"' : '') + (o.alpha !== undefined && o.alpha < 1 ? ' opacity="' + o.alpha + '"' : '') + '/>'); },
    text: function (x, y, str, o) {
      var anchor = o.align === 'center' ? 'middle' : o.align === 'right' ? 'end' : 'start', base = o.baseline === 'top' ? 'hanging' : o.baseline === 'bottom' ? 'auto' : 'middle';
      var attrs = ' x="0" y="0" font-family="' + FONT.replace(/"/g, "'") + '" font-size="' + o.size + '" font-weight="' + (o.weight || 600) + '" text-anchor="' + anchor + '" dominant-baseline="' + base + '"';
      var g = '<g transform="translate(' + r2(x) + ' ' + r2(y) + ')' + (o.angle ? ' rotate(' + r2(o.angle * 180 / Math.PI) + ')' : '') + '"' + (o.alpha !== undefined && o.alpha < 1 ? ' opacity="' + o.alpha + '"' : '') + '>';
      if (o.halo) g += '<text' + attrs + ' fill="' + o.halo + '" stroke="' + o.halo + '" stroke-width="3" stroke-linejoin="round">' + esc(str) + '</text>';
      g += '<text' + attrs + ' fill="' + o.color + '">' + esc(str) + '</text></g>';
      this.out.push(g);
    },
    rect: function (x, y, w, h, o) { this.out.push('<rect x="' + r2(x) + '" y="' + r2(y) + '" width="' + r2(w) + '" height="' + r2(h) + '"' + (o.fill ? ' fill="' + o.fill + '"' : ' fill="none"') + (o.stroke ? ' stroke="' + o.stroke + '" stroke-width="' + (o.width || 1) + '"' : '') + (o.rx ? ' rx="' + o.rx + '"' : '') + '/>'); }
  };
  function r2(v) { return Math.round(v * 100) / 100; }
  var FONT = '-apple-system, "Segoe UI", Helvetica, Arial, "Hiragino Sans", "Yu Gothic", "Noto Sans CJK JP", sans-serif';

  function measure(str, size, weight) {
    var key = size + '|' + (weight || 600) + '|' + str;
    if (textW[key] === undefined) { ctx.font = (weight || 600) + ' ' + size + 'px ' + FONT; textW[key] = ctx.measureText(str).width; }
    return textW[key];
  }

  /* ---------- the scene ---------- */
  function highlightSet() {
    // which lines are "in focus": the selected line, the journey's lines, or the selected station's line
    var hl = null;
    if (lineSel >= 0) { hl = {}; hl[lineSel] = 1; }
    else if (journey) { hl = {}; journey.legs.forEach(function (l) { hl[l.line] = 1; }); }
    else if (sel >= 0) { hl = {}; hl[net.lineOf[sel]] = 1; }
    return hl;
  }

  function journeyPolyline() {
    // world-coordinate polylines for each leg of the journey, following the line's cells
    if (!journey) return [];
    var out = [];
    journey.legs.forEach(function (leg) {
      if (leg.stations.length < 2) return;
      var li = leg.line, cells = net.paths[li], a = stCellIdx[leg.stations[0]], b = stCellIdx[leg.stations[leg.stations.length - 1]];
      var lo = Math.min(a, b), hi = Math.max(a, b), pts = [];
      for (var i = lo; i <= hi; i++) pts.push(cells[i]);
      out.push({ line: li, pts: Network.simplifyPath(pts) });
    });
    return out;
  }

  /*
   * Draw the whole scene with a painter. `v` is the view (k, tx, ty); `o.poster`
   * means every label that fits, no hover, no selection.
   */
  function drawScene(p, v, o) {
    o = o || {};
    var k = v.k, hl = o.poster ? null : highlightSet(), dimA = 0.16;
    var mapBg = cssVar('--map-bg'), inkC = cssVar('--ink'), ink2 = cssVar('--ink-2'), stationC = cssVar('--station'), ringC = cssVar('--station-ring');
    var lw = Math.max(3, Math.min(11, 6.5 * k));
    function sx(wx) { return wx * CELL * k + v.tx; }
    function sy(wy) { return wy * CELL * k + v.ty; }
    function pts(list) { return list.map(function (c) { return [sx(c[0]), sy(c[1])]; }); }
    var i, li, L;

    // lines (dimmed ones first, then focused ones on top)
    var order = net.lines.map(function (_, idx) { return idx; }).sort(function (a, b) { return (hl && hl[a] ? 1 : 0) - (hl && hl[b] ? 1 : 0); });
    order.forEach(function (li) {
      var alpha = hl && !hl[li] ? dimA : 1;
      p.line(pts(linePts[li]), { color: colour(li), width: lw, alpha: alpha });
    });

    // grand tour overlay
    if (tourOn && tour) {
      var tp = [];
      for (i = 0; i < n; i++) tp.push([sx(net.x[tour[i]]), sy(net.y[tour[i]])]);
      p.line(tp, { color: inkC, width: Math.max(1, 1.6 * k), alpha: 0.35, dash: [2 * Math.max(1, k), 5 * Math.max(1, k)], cap: 'round' });
    }

    // journey casing + legs
    var jl = journeyPolyline();
    jl.forEach(function (leg) { p.line(pts(leg.pts), { color: stationC, width: lw + 6 }); });
    jl.forEach(function (leg) { p.line(pts(leg.pts), { color: colour(leg.line), width: lw }); });

    // walking links
    net.inters.forEach(function (ic) {
      if (ic.kind !== 'walk') return;
      var alpha = hl && !(hl[net.lineOf[ic.a]] || hl[net.lineOf[ic.b]]) ? dimA : 0.9;
      p.line([[sx(net.x[ic.a]), sy(net.y[ic.a])], [sx(net.x[ic.b]), sy(net.y[ic.b])]], { color: ink2, width: Math.max(1.5, 2 * k), dash: [3 * Math.max(1, k), 4 * Math.max(1, k)], alpha: alpha, cap: 'butt' });
    });

    // stations
    var showTicks = k >= 0.42 || o.poster, inJourney = {};
    if (journey) journey.path.forEach(function (b) { inJourney[b] = 1; });
    var tickLen = Math.max(5, 5.5 * k), ringR = Math.max(3, 4.6 * k);
    var seen = {};
    for (i = 0; i < n; i++) {
      li = net.lineOf[i];
      var x = sx(net.x[i]), y = sy(net.y[i]);
      if (x < -40 || y < -40 || x > o.w + 40 || y > o.h + 40) continue;
      var focus = !hl || hl[li] || inJourney[i], alpha = focus ? 1 : dimA;
      var isInter = net.partner[i] >= 0 && net.inters.some(function (ic) { return (ic.a === i || ic.b === i) && ic.kind === 'merged'; });
      var key = net.x[i] + ',' + net.y[i];
      if (isInter) {
        if (seen[key]) continue; seen[key] = 1;
        var pa = net.partner[i], f2 = !hl || hl[net.lineOf[pa]] || inJourney[pa];
        p.circle(x, y, ringR + 1.5, { fill: stationC, stroke: ringC, width: Math.max(1.5, 2 * k), alpha: (focus || f2) ? 1 : dimA });
      } else if (showTicks) {
        var d = stDir[i], dir = Network.DIRS[d], nx = -dir[1], ny = dir[0], nl = Math.hypot(nx, ny) || 1;
        nx /= nl; ny /= nl;
        var isEnd = net.posInLine[i] === 0 || net.posInLine[i] === net.lines[li].stations.length - 1;
        if (isEnd) p.circle(x, y, ringR * 0.9, { fill: stationC, stroke: colour(li), width: Math.max(1.5, 2.2 * k), alpha: alpha });
        else p.line([[x + nx * lw * 0.35, y + ny * lw * 0.35], [x + nx * (lw * 0.35 + tickLen), y + ny * (lw * 0.35 + tickLen)]], { color: colour(li), width: Math.max(1.5, 2.2 * k), alpha: alpha, cap: 'butt' });
      }
    }
    // journey stations: rings on the path
    if (journey) journey.path.forEach(function (b) { p.circle(sx(net.x[b]), sy(net.y[b]), ringR * 0.8, { fill: stationC, stroke: ringC, width: Math.max(1.2, 1.6 * k) }); });
    // selection
    if (!o.poster && sel >= 0) {
      p.circle(sx(net.x[sel]), sy(net.y[sel]), ringR + 7, { stroke: cssVar('--accent'), width: 3, alpha: 0.95 });
      p.circle(sx(net.x[sel]), sy(net.y[sel]), ringR + 1.5, { fill: stationC, stroke: ringC, width: 2 });
    }
    if (!o.poster && hoverIdx >= 0 && hoverIdx !== sel) p.circle(sx(net.x[hoverIdx]), sy(net.y[hoverIdx]), ringR + 5, { stroke: inkC, width: 1.5, alpha: 0.7 });

    // line names along their longest straight run (zoomed out) or at the termini (zoomed in)
    drawLineNames(p, v, o, hl);

    // station labels
    var placed = labelsFor(v, o), items = labelCache.items;
    for (i = 0; i < items.length; i++) {
      var pl = placed[i]; if (!pl) continue;
      var it = items[i], lx = pl.x + v.tx, ly = pl.y + v.ty;
      if (lx + it.w < -10 || ly + it.h < -10 || lx > o.w + 10 || ly > o.h + 10) continue;
      var a2 = (!hl || hl[net.lineOf[it.b]] || inJourney[it.b] || it.b === sel) ? 1 : 0.3;
      var col = it.b === sel ? cssVar('--accent') : (it.strong ? inkC : ink2);
      for (var r = 0; r < it.lines.length; r++) p.text(lx, ly + it.lh * (r + 0.5), it.lines[r], { size: it.size, color: col, halo: mapBg, baseline: 'middle', align: 'left', alpha: a2, weight: it.strong ? 700 : 600 });
    }
  }

  function drawLineNames(p, v, o, hl) {
    var k = v.k, mapBg = cssVar('--map-bg');
    net.lines.forEach(function (L, li) {
      var pts = linePts[li], best = null, bl = 0;
      for (var s = 1; s < pts.length; s++) { var l = Math.hypot(pts[s][0] - pts[s - 1][0], pts[s][1] - pts[s - 1][1]); if (l > bl) { bl = l; best = s; } }
      if (best === null) return;
      var a = pts[best - 1], b = pts[best], ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
      if (ang > Math.PI / 2 || ang < -Math.PI / 2) ang += Math.PI;   // keep text upright
      var size = k < 0.5 ? 12 : 13, name = L.name.toUpperCase();
      if (bl * CELL * k < measure(name, size, 700) + 30) return;       // no room on the run
      var mx = (a[0] + b[0]) / 2 * CELL * k + v.tx, my = (a[1] + b[1]) / 2 * CELL * k + v.ty;
      var off = Math.max(2.2, Math.min(11, 6.5 * k)) / 2 + size * 0.75;
      p.text(mx - Math.sin(ang) * off, my + Math.cos(ang) * off, name, { size: size, weight: 700, color: colour(li), halo: mapBg, align: 'center', angle: ang, alpha: hl && !hl[li] ? 0.25 : 1 });
    });
    // terminus plates (zoomed out): the line's code at both ends, just beyond the last stop
    if (k < 0.8 && !o.poster) net.lines.forEach(function (L, li) {
      [L.stations[0], L.stations[L.stations.length - 1]].forEach(function (b, end) {
        var pts = linePts[li], e = end ? pts[pts.length - 1] : pts[0], q = end ? pts[pts.length - 2] : pts[1];
        if (!q) return;
        var dx = e[0] - q[0], dy = e[1] - q[1], l = Math.hypot(dx, dy) || 1;
        var px = e[0] * CELL * k + v.tx + dx / l * 12, py = e[1] * CELL * k + v.ty + dy / l * 12;
        p.text(px, py, L.code, { size: 10, weight: 700, color: colour(li), halo: mapBg, align: dx > 0.3 ? 'left' : dx < -0.3 ? 'right' : 'center', baseline: dy > 0.3 ? 'top' : dy < -0.3 ? 'bottom' : 'middle', alpha: hl && !hl[li] ? 0.25 : 0.9 });
      });
    });
  }

  /*
   * Label layout for a zoom level: computed in translation-free screen space (world
   * scaled by k) and cached, so panning never reshuffles labels. Priority: selected
   * and journey stations, then interchanges and termini, then everyone else.
   */
  function labelsFor(v, o) {
    var k = v.k, bucket = o.poster ? 'poster' : Math.round(Math.log(k) * 24), inJourney = {};
    if (journey) journey.path.forEach(function (b) { inJourney[b] = 1; });
    var key = bucket + '|' + sel + '|' + (journey ? journey.path.join('.') : '') + '|' + lineSel + '|' + theme;
    if (labelCache.key === key) return labelCache.placed;
    var items = [], size = o.poster ? 11 : k >= 1.6 ? 13 : k >= 0.8 ? 12 : 11, lh = size * 1.25, pad = k < 1.1 && !o.poster ? 12 : 4;
    var allLabels = k >= 0.8 || o.poster, midLabels = k >= 0.42;
    var seen = {};
    for (var i = 0; i < n; i++) {
      var li = net.lineOf[i], isEnd = net.posInLine[i] === 0 || net.posInLine[i] === net.lines[li].stations.length - 1;
      var pa = net.partner[i], merged = pa >= 0 && net.x[pa] === net.x[i] && net.y[pa] === net.y[i];
      var pri = 1;
      if (i === sel || inJourney[i]) pri = 10 + (i === sel ? 2 : 0) + (i === fromIdx || i === toIdx ? 1 : 0);
      else if (merged) pri = 5; else if (isEnd) pri = 4; else if (lineSel === li) pri = 3; else if (hl1(li)) pri = 2;
      if (!allLabels && pri < 4 && !(midLabels && pri >= 2)) continue;
      if (!midLabels && pri < 5 && !allLabels) continue;
      var keyc = net.x[i] + ',' + net.y[i];
      if (merged) { if (seen[keyc]) continue; seen[keyc] = 1; }
      var lines = merged ? [short(books[i].t, 34), short(books[pa].t, 34)] : [short(books[i].t, 36)];
      var w = 0; lines.forEach(function (s) { w = Math.max(w, measure(s, size, pri >= 4 ? 700 : 600)); });
      var h = lh * lines.length, x = net.x[i] * CELL * k, y = net.y[i] * CELL * k;
      // offsets from the mark: rb is the blocked radius around every station (below), the
      // tick of an ordinary station reaches a little further on its own side
      var d = stDir[i], rb = Math.max(4, 4.6 * k) + 2, tick = Math.max(5, 5.5 * k) + Math.max(2.2, Math.min(11, 6.5 * k)) * 0.35;
      var g2 = rb + 6 + pad / 2, gt = Math.max(g2, tick + 4 + pad / 2), sides;
      // a label sits beside its station; the box is centred vertically on the anchor
      if (merged) sides = [[g2, 0, 'start'], [-g2, 0, 'end'], [0, -g2 - h / 2, 'middle'], [0, g2 + h / 2, 'middle']];
      else if (d === 0 || d === 4) sides = [[0, -gt - h / 2, 'middle'], [0, gt + h / 2, 'middle'], [g2, 0, 'start'], [-g2, 0, 'end']];
      else if (d === 2 || d === 6) sides = [[gt, 0, 'start'], [-gt, 0, 'end'], [0, -g2 - h / 2, 'middle'], [0, g2 + h / 2, 'middle']];
      else if (d === 1 || d === 5) sides = [[g2 * 0.75, -g2 * 0.75 - h / 2, 'start'], [-g2 * 0.75, g2 * 0.75 + h / 2, 'end'], [gt, 0, 'start'], [-gt, 0, 'end']];
      else sides = [[g2 * 0.75, g2 * 0.75 + h / 2, 'start'], [-g2 * 0.75, -g2 * 0.75 - h / 2, 'end'], [gt, 0, 'start'], [-gt, 0, 'end']];
      items.push({ b: i, x: x, y: y, w: w, h: h, lh: lh, size: size, priority: pri + (merged ? 0 : ((i * 7919) % 13) / 100), sides: sides, lines: lines, strong: pri >= 4 });
    }
    // station marks are obstacles too
    var blocked = [];
    for (i = 0; i < n; i++) { var r = Math.max(4, 4.6 * k) + 2; blocked.push([net.x[i] * CELL * k - r, net.y[i] * CELL * k - r, 2 * r, 2 * r]); }
    var placed = Network.placeLabels(items.map(function (it) { return { x: it.x, y: it.y, w: it.w + pad, h: it.h + pad / 2, priority: it.priority, sides: it.sides }; }), blocked, 64);
    labelCache = { key: key, items: items, placed: placed };
    return placed;
  }
  function hl1(li) { var h = highlightSet(); return h && h[li]; }

  function draw() {
    if (!net) return;
    var w = cw(), h = chh();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = cssVar('--map-bg'); ctx.fillRect(0, 0, w, h);
    drawScene(new CanvasPainter(ctx, 1), view, { w: w, h: h });
    drawMini();
  }

  function drawMini() {
    var w = mini.width, h = mini.height, pad = 8;
    var k = Math.min((w - 2 * pad) / (net.width * CELL), (h - 2 * pad) / (net.height * CELL));
    var tx = (w - net.width * CELL * k) / 2, ty = (h - net.height * CELL * k) / 2;
    mctx.setTransform(1, 0, 0, 1, 0, 0);
    mctx.fillStyle = cssVar('--panel'); mctx.fillRect(0, 0, w, h);
    net.lines.forEach(function (L, li) {
      mctx.strokeStyle = colour(li); mctx.lineWidth = 2.2; mctx.lineJoin = 'round'; mctx.beginPath();
      linePts[li].forEach(function (c, i) { var x = c[0] * CELL * k + tx, y = c[1] * CELL * k + ty; if (i) mctx.lineTo(x, y); else mctx.moveTo(x, y); });
      mctx.stroke();
    });
    // viewport
    var vw = cw(), vh = chh(), a = toWorld(0, 0), b = toWorld(vw, vh);
    mctx.strokeStyle = cssVar('--ink'); mctx.lineWidth = 2; mctx.globalAlpha = 0.85;
    mctx.strokeRect(a[0] * CELL * k + tx, a[1] * CELL * k + ty, (b[0] - a[0]) * CELL * k, (b[1] - a[1]) * CELL * k);
    mctx.globalAlpha = 1;
    mini._k = k; mini._tx = tx; mini._ty = ty;
  }

  /* ---------- map interaction ---------- */
  var pointers = {}, dragStart = null, pinchStart = null, moved = false;
  function hitTest(sx, sy) {
    var best = -1, bd = 14 * 14;
    for (var i = 0; i < n; i++) { var p = toScreen(net.x[i], net.y[i]), dx = p[0] - sx, dy = p[1] - sy, d = dx * dx + dy * dy; if (d < bd) { bd = d; best = i; } }
    return best;
  }
  canvas.addEventListener('pointerdown', function (e) {
    canvas.setPointerCapture(e.pointerId);
    pointers[e.pointerId] = [e.clientX, e.clientY];
    var ids = Object.keys(pointers);
    if (ids.length === 1) { dragStart = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty }; moved = false; canvas.classList.add('dragging'); }
    else if (ids.length === 2) { var a = pointers[ids[0]], b = pointers[ids[1]]; pinchStart = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), k: view.k, cx: (a[0] + b[0]) / 2, cy: (a[1] + b[1]) / 2, tx: view.tx, ty: view.ty }; dragStart = null; }
    if (anim) { cancelAnimationFrame(anim); anim = null; }
  });
  canvas.addEventListener('pointermove', function (e) {
    var rect = canvas.getBoundingClientRect();
    if (pointers[e.pointerId]) pointers[e.pointerId] = [e.clientX, e.clientY];
    var ids = Object.keys(pointers);
    if (ids.length === 2 && pinchStart) {
      var a = pointers[ids[0]], b = pointers[ids[1]], d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      var k2 = Math.max(MIN_K, Math.min(MAX_K, pinchStart.k * d / pinchStart.d)), f = k2 / pinchStart.k;
      var cx = (a[0] + b[0]) / 2 - rect.left, cy = (a[1] + b[1]) / 2 - rect.top, ox = pinchStart.cx - rect.left, oy = pinchStart.cy - rect.top;
      view = clampView({ k: k2, tx: cx - (ox - pinchStart.tx) * f, ty: cy - (oy - pinchStart.ty) * f });
      moved = true; requestDraw(); return;
    }
    if (dragStart && ids.length === 1) {
      var dx = e.clientX - dragStart.x, dy = e.clientY - dragStart.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) moved = true;
      view = clampView({ k: view.k, tx: dragStart.tx + dx, ty: dragStart.ty + dy });
      requestDraw(); return;
    }
    if (!ids.length) {
      var hi = hitTest(e.clientX - rect.left, e.clientY - rect.top);
      if (hi !== hoverIdx) { hoverIdx = hi; canvas.classList.toggle('hover', hi >= 0); requestDraw(); }
      showTip(hi, e.clientX - rect.left, e.clientY - rect.top);
    }
  });
  function endPointer(e) {
    delete pointers[e.pointerId];
    var ids = Object.keys(pointers);
    if (!ids.length) {
      canvas.classList.remove('dragging');
      if (dragStart && !moved && e.type === 'pointerup') {
        var rect = canvas.getBoundingClientRect(), hi = hitTest(e.clientX - rect.left, e.clientY - rect.top);
        if (hi >= 0) { selectStation(hi, { pan: false }); }
        else if (lineSel >= 0) { selectLine(-1); }
      }
      dragStart = null; pinchStart = null;
    } else if (ids.length === 1) { var p = pointers[ids[0]]; dragStart = { x: p[0], y: p[1], tx: view.tx, ty: view.ty }; pinchStart = null; }
  }
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('pointerleave', function () { if (hoverIdx >= 0) { hoverIdx = -1; canvas.classList.remove('hover'); requestDraw(); } showTip(-1); });
  canvas.addEventListener('wheel', function (e) {
    e.preventDefault();
    var rect = canvas.getBoundingClientRect();
    zoomAt(Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0016)), e.clientX - rect.left, e.clientY - rect.top, false);
  }, { passive: false });
  canvas.addEventListener('dblclick', function (e) { var rect = canvas.getBoundingClientRect(); zoomAt(1.8, e.clientX - rect.left, e.clientY - rect.top, true); });
  mini.addEventListener('click', function (e) {
    var rect = mini.getBoundingClientRect(), mx = (e.clientX - rect.left) * (mini.width / rect.width), my = (e.clientY - rect.top) * (mini.height / rect.height);
    var wx = (mx - mini._tx) / (CELL * mini._k), wy = (my - mini._ty) / (CELL * mini._k);
    animateTo(clampView({ k: view.k, tx: cw() / 2 - wx * CELL * view.k, ty: chh() / 2 - wy * CELL * view.k }), 300);
  });
  $('z-in').addEventListener('click', function () { zoomAt(1.5, cw() / 2, chh() / 2, true); });
  $('z-out').addEventListener('click', function () { zoomAt(1 / 1.5, cw() / 2, chh() / 2, true); });
  $('z-fit').addEventListener('click', function () { fitView(true); });

  function showTip(i, x, y) {
    var tip = $('maptip');
    if (i < 0 || !net) { tip.style.display = 'none'; return; }
    var b = books[i], L = lineOfBook(i), pa = net.partner[i];
    var html = '<b>' + esc(b.t) + '</b><span class="m">' + esc(b.a || '') + (b.y ? (b.a ? ' · ' : '') + b.y : '') + '</span><div class="m" style="margin-top:4px"><span class="sw" style="background:' + colour(net.lineOf[i]) + ';width:10px;height:10px;vertical-align:-1px;margin-right:5px"></span>' + esc(L.name) + ' line, stop ' + (net.posInLine[i] + 1) + ' of ' + L.stations.length;
    if (pa >= 0) html += '<br>Interchange with ' + esc(short(books[pa].t, 40)) + ' (' + esc(lineOfBook(pa).name) + ')';
    html += '</div>';
    tip.innerHTML = html; tip.style.display = 'block';
    var w = cw(), tw = tip.offsetWidth, th = tip.offsetHeight;
    tip.style.left = Math.min(w - tw - 8, x + 14) + 'px'; tip.style.top = Math.max(8, y - th - 12) + 'px';
  }

  document.addEventListener('keydown', function (e) {
    if (e.target.matches('input, textarea')) { if (e.key === 'Escape') { e.target.blur(); } return; }
    if ($('help').classList.contains('show')) { if (e.key === 'Escape') closeHelp(); return; }
    var pan = 60;
    switch (e.key) {
      case '+': case '=': zoomAt(1.4, cw() / 2, chh() / 2, true); break;
      case '-': case '_': zoomAt(1 / 1.4, cw() / 2, chh() / 2, true); break;
      case 'ArrowLeft': view = clampView({ k: view.k, tx: view.tx + pan, ty: view.ty }); requestDraw(); break;
      case 'ArrowRight': view = clampView({ k: view.k, tx: view.tx - pan, ty: view.ty }); requestDraw(); break;
      case 'ArrowUp': view = clampView({ k: view.k, tx: view.tx, ty: view.ty + pan }); requestDraw(); break;
      case 'ArrowDown': view = clampView({ k: view.k, tx: view.tx, ty: view.ty - pan }); requestDraw(); break;
      case 'f': case 'F': fitView(true); break;
      case '/': e.preventDefault(); showTab('search'); $('q').focus(); break;
      case 'Escape': if (lineSel >= 0) selectLine(-1); else if (sel >= 0) { sel = -1; labelCache.key = ''; requestDraw(); writeHash(); } break;
      default: return;
    }
    e.preventDefault();
  });
  window.addEventListener('resize', function () { if (net) { resize(); view = clampView(view); requestDraw(); } });

  /* ---------- selection, lines, journeys ---------- */
  function selectStation(i, o) {
    o = o || {};
    sel = i; lineSel = -1; labelCache.key = '';
    showStation(i);
    showTab('station');
    if (o.pan !== false) zoomToStation(i, Math.max(view.k, o.k || 1.5));
    if (isMobile()) setSnap('half');
    requestDraw();
    writeHash();
  }

  function selectLine(li, o) {
    lineSel = li; labelCache.key = '';
    renderLines();
    if (li >= 0) { if (!(o && o.quiet)) showTab('lines'); fitLine(li); }
    requestDraw();
    writeHash();
  }

  function fitLine(li) {
    var pts = linePts[li], x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    pts.forEach(function (c) { x0 = Math.min(x0, c[0]); y0 = Math.min(y0, c[1]); x1 = Math.max(x1, c[0]); y1 = Math.max(y1, c[1]); });
    var w = cw(), h = chh(), pad = 60, k = Math.min(MAX_K, Math.max(MIN_K, Math.min((w - 2 * pad) / ((x1 - x0 + 2) * CELL), (h - 2 * pad) / ((y1 - y0 + 2) * CELL))));
    animateTo(clampView({ k: k, tx: w / 2 - (x0 + x1) / 2 * CELL * k, ty: (isMobile() ? h * 0.3 : h / 2) - (y0 + y1) / 2 * CELL * k }), 420);
  }

  function setFrom(i) { fromIdx = i; $('from-q').value = i >= 0 ? bookLabel(books[i]) : ''; $('f-from').classList.toggle('has', i >= 0); $('from-pin').style.borderColor = i >= 0 ? colour(net.lineOf[i]) : ''; plan(); }
  function setTo(i) { toIdx = i; $('to-q').value = i >= 0 ? bookLabel(books[i]) : ''; $('f-to').classList.toggle('has', i >= 0); $('to-pin').style.borderColor = i >= 0 ? colour(net.lineOf[i]) : ''; plan(); }

  function plan() {
    journey = (fromIdx >= 0 && toIdx >= 0) ? Network.journey(net, fromIdx, toIdx, 3) : null;
    lineSel = -1; labelCache.key = '';
    renderJourney();
    if (journey) {
      // fit the journey
      var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      journey.path.forEach(function (b) { x0 = Math.min(x0, net.x[b]); y0 = Math.min(y0, net.y[b]); x1 = Math.max(x1, net.x[b]); y1 = Math.max(y1, net.y[b]); });
      var w = cw(), h = chh(), pad = 70, k = Math.min(2.2, Math.max(MIN_K, Math.min((w - 2 * pad) / ((x1 - x0 + 3) * CELL), (h - 2 * pad) / ((y1 - y0 + 3) * CELL))));
      animateTo(clampView({ k: k, tx: w / 2 - (x0 + x1) / 2 * CELL * k, ty: (isMobile() ? h * 0.3 : h / 2) - (y0 + y1) / 2 * CELL * k }), 450);
    }
    requestDraw();
    writeHash();
  }

  /* ---------- panel: tabs and the bottom sheet ---------- */
  var TABS = ['search', 'station', 'journey', 'lines', 'list'];
  function showTab(name) {
    TABS.forEach(function (t) { $('tab-' + t).setAttribute('aria-selected', t === name ? 'true' : 'false'); $('v-' + t).classList.toggle('show', t === name); });
    if (isMobile() && $('panel').dataset.snap !== 'full' && $('panel').dataset.snap !== 'half') setSnap('half');
  }
  TABS.forEach(function (t) { $('tab-' + t).addEventListener('click', function () { showTab(t); }); });
  document.querySelectorAll('#tabs button').forEach(function (b, i, all) {
    b.addEventListener('keydown', function (e) { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { var j = (i + (e.key === 'ArrowRight' ? 1 : all.length - 1)) % all.length; all[j].focus(); all[j].click(); } });
  });

  function setSnap(s) { $('panel').dataset.snap = s; }
  (function sheet() {
    var panel = $('panel'), handle = $('handle'), start = null;
    function onDown(e) { if (!isMobile()) return; start = { y: e.clientY, top: panel.getBoundingClientRect().top, t: performance.now() }; panel.classList.add('dragging'); handle.setPointerCapture(e.pointerId); }
    function onMove(e) { if (!start) return; var dy = e.clientY - start.y, h = window.innerHeight, base = start.top + dy; panel.style.transform = 'translateY(' + Math.max(0, base - (h - panel.offsetHeight)) + 'px)'; }
    function onUp(e) {
      if (!start) return;
      var dy = e.clientY - start.y, fast = Math.abs(dy) / (performance.now() - start.t) > 0.5, cur = panel.dataset.snap || 'peek';
      var next = cur;
      if (dy < -40 || (fast && dy < 0)) next = cur === 'peek' ? 'half' : 'full';
      else if (dy > 40 || (fast && dy > 0)) next = cur === 'full' ? 'half' : 'peek';
      panel.style.transform = ''; panel.classList.remove('dragging'); setSnap(next); start = null;
    }
    handle.addEventListener('pointerdown', onDown); handle.addEventListener('pointermove', onMove); handle.addEventListener('pointerup', onUp); handle.addEventListener('pointercancel', onUp);
    handle.addEventListener('click', function () { if (!isMobile()) return; setSnap(panel.dataset.snap === 'peek' || !panel.dataset.snap ? 'half' : 'peek'); });
    $('tabs').addEventListener('click', function () { if (isMobile() && (!panel.dataset.snap || panel.dataset.snap === 'peek')) setSnap('half'); });
  })();

  /* ---------- typeahead ---------- */
  function searchBooks(q, limit) {
    q = q.trim().toLowerCase(); if (!q) return [];
    var words = q.split(/\s+/), out = [];
    for (var i = 0; i < n; i++) {
      var b = books[i], t = b.t.toLowerCase(), a = b.a.toLowerCase(), hay = t + ' ' + a + ' ' + b.id.toLowerCase();
      var ok = true; for (var w = 0; w < words.length && ok; w++) ok = hay.indexOf(words[w]) >= 0;
      if (!ok) continue;
      var score = t.indexOf(q) === 0 ? 0 : t.indexOf(' ' + q) >= 0 ? 1 : t.indexOf(q) >= 0 ? 2 : a.indexOf(q) === 0 ? 3 : 4;
      out.push([score, i]);
    }
    out.sort(function (x, y) { return x[0] - y[0] || books[x[1]].t.localeCompare(books[y[1]].t); });
    return out.slice(0, limit || 25).map(function (p) { return p[1]; });
  }
  function searchLines(q) {
    q = q.trim().toLowerCase(); if (!q) return [];
    return net.lines.map(function (L, li) { return li; }).filter(function (li) { var L = net.lines[li]; return L.name.toLowerCase().indexOf(q) >= 0 || L.code.toLowerCase() === q || L.genres.some(function (g) { return g.toLowerCase().indexOf(q) >= 0; }); });
  }

  function typeahead(input, listEl, o) {
    var items = [], hi = -1, field = input.parentNode;
    function close() { listEl.classList.remove('show'); listEl.innerHTML = ''; items = []; hi = -1; }
    function render() {
      var q = input.value;
      field.classList.toggle('has', !!q);
      items = []; listEl.innerHTML = '';
      if (!q.trim()) { close(); return; }
      var ls = o.lines ? searchLines(q) : [], bs = searchBooks(q, o.limit || 25);
      if (ls.length) { listEl.appendChild(el('li', 'h', 'Lines')); ls.forEach(function (li) { items.push({ line: li }); }); }
      var liEls = [];
      ls.forEach(function (li) { var L = net.lines[li], e = el('li', '', '<span class="sw" style="background:' + colour(li) + '"></span><span class="t">' + esc(L.name) + '</span><span class="a">' + L.stations.length + ' stops</span>'); e.setAttribute('role', 'option'); listEl.appendChild(e); liEls.push(e); });
      if (bs.length) { listEl.appendChild(el('li', 'h', ls.length ? 'Stations' : (bs.length === (o.limit || 25) ? 'Stations (first ' + bs.length + ')' : 'Stations'))); }
      bs.forEach(function (i) { items.push({ book: i }); var e = el('li', '', '<span class="sw" style="background:' + colour(net.lineOf[i]) + '"></span><span class="t">' + esc(books[i].t) + '</span><span class="a">' + esc(books[i].a) + '</span>'); e.setAttribute('role', 'option'); listEl.appendChild(e); liEls.push(e); });
      if (!items.length) listEl.appendChild(el('li', 'h', 'Nothing matches "' + esc(short(q, 30)) + '"'));
      liEls.forEach(function (e, idx) { e.addEventListener('mousedown', function (ev) { ev.preventDefault(); pick(idx); }); });
      listEl.classList.add('show'); hi = -1;
    }
    function pick(idx) { var it = items[idx]; if (!it) return; close(); o.onPick(it); }
    function highlight(d) {
      var opts = listEl.querySelectorAll('li[role=option]'); if (!opts.length) return;
      hi = (hi + d + opts.length) % opts.length;
      opts.forEach(function (e, i) { e.classList.toggle('hi', i === hi); });
      opts[hi].scrollIntoView({ block: 'nearest' });
    }
    input.addEventListener('input', render);
    input.addEventListener('focus', function () { if (input.value.trim()) render(); });
    input.addEventListener('blur', function () { setTimeout(close, 120); });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); if (!listEl.classList.contains('show')) render(); highlight(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); highlight(-1); }
      else if (e.key === 'Enter') { e.preventDefault(); if (hi >= 0) pick(hi); else if (items.length) pick(0); }
      else if (e.key === 'Escape') { if (listEl.classList.contains('show')) close(); else { input.value = ''; field.classList.remove('has'); if (o.onClear) o.onClear(); } }
    });
    field.querySelector('.clear').addEventListener('click', function () { input.value = ''; field.classList.remove('has'); close(); if (o.onClear) o.onClear(); input.focus(); });
  }

  typeahead($('q'), $('q-list'), { lines: true, onPick: function (it) { if (it.line !== undefined) selectLine(it.line); else selectStation(it.book); $('q').value = ''; $('f-search').classList.remove('has'); } });
  typeahead($('from-q'), $('from-list'), { onPick: function (it) { setFrom(it.book); }, onClear: function () { setFrom(-1); } });
  typeahead($('to-q'), $('to-list'), { onPick: function (it) { setTo(it.book); }, onClear: function () { setTo(-1); } });
  $('btn-swap').addEventListener('click', function () { var f = fromIdx, t = toIdx; fromIdx = -1; toIdx = -1; setFrom(t); setTo(f); });

  /* ---------- station sheet ---------- */
  function stopItem(i, o) {
    o = o || {};
    var b = books[i], li = net.lineOf[i], e = el('li');
    e.tabIndex = 0; e.setAttribute('role', 'button');
    var pa = net.partner[i], inter = pa >= 0 && net.x[pa] === net.x[i] && net.y[pa] === net.y[i];
    e.innerHTML = '<span class="dot' + (inter ? ' ring' : '') + '" style="border-color:' + (inter ? '' : colour(li)) + '"></span><div class="body"><div class="t">' + esc(b.t) + '</div><div class="a">' + esc(b.a) + (o.line ? (b.a ? ' · ' : '') + esc(net.lines[li].name) : '') + '</div>' + (o.words && o.words.length ? '<div class="k">shares: ' + esc(o.words.join(', ')) + '</div>' : '') + '</div>' + (o.right ? '<span class="s">' + esc(o.right) + '</span>' : '');
    if (o.here) { e.classList.add('here'); e.tabIndex = -1; }
    else { var go = function () { selectStation(i); }; e.addEventListener('click', go); e.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); go(); } }); }
    return e;
  }

  function showStation(i) {
    var b = books[i], li = net.lineOf[i], L = net.lines[li], pos = net.posInLine[i];
    $('st-empty').hidden = true; $('st-body').hidden = false;
    var chips = chip(li) + ' <span class="faint">stop ' + (pos + 1) + ' of ' + L.stations.length + '</span>';
    var pa = net.partner[i];
    if (pa >= 0) chips += ' <span class="chip" title="Interchange">⟷ ' + (net.x[pa] === net.x[i] && net.y[pa] === net.y[i] ? 'Interchange' : 'Walking link') + ' with ' + chip(net.lineOf[pa]) + '</span>';
    $('st-chips').innerHTML = chips;
    $('st-title').textContent = b.t;
    var meta = [];
    if (b.a) meta.push(b.a); if (b.y) meta.push(String(b.y)); if (b.g) meta.push(b.g); if (b.l) meta.push(b.l);
    $('st-meta').innerHTML = esc(meta.join(' · ')) + '<br><span class="faint">Shelf ' + esc(b.id) + (b.ty ? ' · ' + esc(b.ty) : '') + '</span>';
    $('st-desc').textContent = b.d || 'No description in the catalogue.';
    $('st-desc').classList.toggle('muted', !b.d);
    // along the line: three stops each way
    var ul = $('st-next'); ul.innerHTML = '';
    var back = [], fwd = [];
    for (var k = Math.max(0, pos - 3); k < pos; k++) back.push(L.stations[k]);
    for (k = pos + 1; k <= Math.min(L.stations.length - 1, pos + 3); k++) fwd.push(L.stations[k]);
    back.forEach(function (j, idx) { ul.appendChild(stopItem(j, { right: '−' + (back.length - idx) })); });
    ul.appendChild(stopItem(i, { here: true, right: 'here' }));
    fwd.forEach(function (j, idx) { ul.appendChild(stopItem(j, { right: '+' + (idx + 1) })); });
    $('st-next-h').textContent = 'Along the ' + L.name + ' line';
    // similar on other lines
    var sim = $('st-similar'); sim.innerHTML = '';
    var cand = [];
    for (var j = 0; j < n; j++) if (net.lineOf[j] !== li) cand.push(j);
    cand.sort(function (x, y) { return S[i * n + y] - S[i * n + x]; });
    var shown = 0;
    for (var c = 0; c < cand.length && shown < 5; c++) {
      var j2 = cand[c], words = Oracle.shared(vec, i, j2, 4);
      if (!words.length) break;
      sim.appendChild(stopItem(j2, { line: true, words: words }));
      shown++;
    }
    if (!shown) sim.appendChild(el('li', 'faint', 'No shared words with any book on another line.'));
    $('st-add').textContent = list.indexOf(b.id) >= 0 ? 'On the reading list' : 'Add to reading list';
  }
  $('st-from').addEventListener('click', function () { if (sel < 0) return; setFrom(sel); showTab('journey'); if (toIdx < 0) $('to-q').focus(); });
  $('st-to').addEventListener('click', function () { if (sel < 0) return; setTo(sel); showTab('journey'); if (fromIdx < 0) $('from-q').focus(); });
  $('st-add').addEventListener('click', function () { if (sel < 0) return; addToList([books[sel].id]); $('st-add').textContent = 'Added'; setTimeout(function () { if (sel >= 0) $('st-add').textContent = 'On the reading list'; }, 900); });

  /* ---------- journey ---------- */
  function renderJourney() {
    var body = $('j-body'), empty = $('j-empty');
    if (!journey) { body.hidden = true; empty.hidden = false; empty.textContent = (fromIdx >= 0 && toIdx >= 0) ? 'No route joins these two books.' : (fromIdx >= 0 || toIdx >= 0) ? 'Now pick the other end.' : 'Pick two books and the oracle finds the way along the lines, changing where books overlap.'; return; }
    body.hidden = false; empty.hidden = true;
    $('jsummary').innerHTML = '<span><b>' + journey.stops + '</b>stops</span><span><b>' + journey.changes + '</b>change' + (journey.changes === 1 ? '' : 's') + '</span><span><b>' + journey.legs.length + '</b>line' + (journey.legs.length === 1 ? '' : 's') + '</span>';
    var legs = $('j-legs'); legs.innerHTML = '';
    journey.legs.forEach(function (leg, idx) {
      var L = net.lines[leg.line], first = leg.stations[0], last = leg.stations[leg.stations.length - 1];
      if (idx > 0) {
        var prevLast = journey.legs[idx - 1].stations.slice(-1)[0], walk = !(net.x[prevLast] === net.x[first] && net.y[prevLast] === net.y[first]);
        legs.appendChild(el('div', 'change' + (walk ? ' walk' : ''), (walk ? 'Walk across to ' : 'Change to the ') + '<b>' + esc(L.name) + '</b>' + (walk ? '' : ' line')));
      }
      var d = el('div', 'leg'); d.style.setProperty('--leg', colour(leg.line));
      var stopsN = leg.stations.length - 1;
      d.innerHTML = '<h3>' + (idx === 0 ? 'Take the ' : 'Ride the ') + esc(L.name) + ' line</h3><div class="sum">' + (stopsN === 0 ? 'Start at ' : stopsN + ' stop' + (stopsN === 1 ? '' : 's') + ' to ') + '<b>' + esc(last === first ? books[first].t : books[last].t) + '</b></div>';
      var det = el('details'); det.innerHTML = '<summary>' + leg.stations.length + ' book' + (leg.stations.length === 1 ? '' : 's') + ' on this leg</summary>';
      var ul = el('ul', 'stops'); leg.stations.forEach(function (b, q) { ul.appendChild(stopItem(b, { right: q === 0 ? (idx === 0 ? 'from' : 'change') : q === leg.stations.length - 1 && idx === journey.legs.length - 1 ? 'to' : String(q) })); });
      det.appendChild(ul);
      var add = el('button', 'btn small', 'Add this leg to the list'); add.style.marginTop = '8px';
      add.addEventListener('click', function () { addToList(leg.stations.map(function (b) { return books[b].id; })); add.textContent = 'Added'; });
      det.appendChild(add);
      d.appendChild(det); legs.appendChild(d);
    });
  }
  $('j-add').addEventListener('click', function () { if (!journey) return; addToList(journey.path.map(function (b) { return books[b].id; })); $('j-add').textContent = 'Added'; setTimeout(function () { $('j-add').textContent = 'Add the journey to the list'; }, 1200); });
  $('j-clear').addEventListener('click', function () { fromIdx = -1; toIdx = -1; setFrom(-1); setTo(-1); });

  /* ---------- lines ---------- */
  function renderLines() {
    var ul = $('lines-list'); ul.innerHTML = '';
    net.lines.forEach(function (L, li) {
      var e = el('li', lineSel === li ? 'sel' : ''); e.style.setProperty('--lc', colour(li)); e.tabIndex = 0; e.setAttribute('role', 'button');
      e.innerHTML = '<span class="bar" style="background:' + colour(li) + '"></span><span class="name">' + esc(L.name) + '</span><span class="code">' + L.code + '</span><span class="n">' + L.stations.length + '</span>';
      var go = function () { selectLine(lineSel === li ? -1 : li); };
      e.addEventListener('click', go); e.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); go(); } });
      ul.appendChild(e);
    });
    var det = $('line-detail');
    if (lineSel < 0) { det.classList.remove('show'); ul.style.display = ''; return; }
    var L = net.lines[lineSel];
    det.classList.add('show'); ul.style.display = 'none';
    $('line-title').innerHTML = chip(lineSel) + ' ' + L.stations.length + ' stops';
    $('line-genres').textContent = 'Catalogue genres on this line: ' + L.genres.join('; ') + '.';
    var st = $('line-stops'); st.innerHTML = '';
    var frag = document.createDocumentFragment();
    L.stations.forEach(function (b, k) { frag.appendChild(stopItem(b, { right: String(k + 1) })); });
    st.appendChild(frag);
    var add = el('button', 'btn small', 'Add the whole line to the list'); add.style.marginTop = '10px';
    add.addEventListener('click', function () { addToList(L.stations.map(function (b) { return books[b].id; })); add.textContent = 'Added ' + L.stations.length + ' books'; });
    st.appendChild(add);
  }
  $('line-close').addEventListener('click', function () { selectLine(-1); });

  function renderInterchanges() {
    var ul = $('inter-list'); ul.innerHTML = '';
    var ics = net.inters.slice().sort(function (a, b) { return b.sim - a.sim; }).slice(0, 12);
    if (!ics.length) { ul.appendChild(el('li', 'faint', 'No two lines meet on this map.')); return; }
    ics.forEach(function (ic) {
      var e = el('li'); e.tabIndex = 0; e.setAttribute('role', 'button');
      e.innerHTML = '<span class="dot ring"></span><div class="body"><div class="t">' + esc(short(books[ic.a].t, 44)) + ' <span class="faint">⟷</span> ' + esc(short(books[ic.b].t, 44)) + '</div><div class="a"><span class="sw" style="background:' + colour(net.lineOf[ic.a]) + ';width:10px;height:10px"></span> ' + esc(net.lines[net.lineOf[ic.a]].name) + ' <span class="sw" style="background:' + colour(net.lineOf[ic.b]) + ';width:10px;height:10px"></span> ' + esc(net.lines[net.lineOf[ic.b]].name) + (ic.kind === 'walk' ? ' · walking link' : '') + '</div><div class="k">shares: ' + esc(Oracle.shared(vec, ic.a, ic.b, 4).join(', ')) + '</div></div>';
      var go = function () { selectStation(ic.a); };
      e.addEventListener('click', go); e.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); go(); } });
      ul.appendChild(e);
    });
  }

  /* ---------- reading list ---------- */
  function loadList() { try { list = JSON.parse(store(STORE.list) || '[]'); if (!Array.isArray(list)) list = []; } catch (e) { list = []; } }
  function saveList() { store(STORE.list, JSON.stringify(list)); renderList(); }
  function addToList(ids) { ids.forEach(function (id) { if (list.indexOf(id) < 0) list.push(id); }); saveList(); }
  function renderList() {
    var cnt = $('list-count'); cnt.textContent = list.length; cnt.hidden = !list.length;
    var body = $('rl-body'), empty = $('rl-empty'); body.hidden = !list.length; empty.hidden = !!list.length;
    if (!net) return;
    var ul = $('rl-list'); ul.innerHTML = '';
    list.forEach(function (id, idx) {
      var i = byId[id]; if (i === undefined) return;
      var b = books[i], e = el('li');
      e.innerHTML = '<div class="body"><div class="t">' + esc(b.t) + '</div><div class="a">' + esc(b.a) + (b.a ? ' · ' : '') + esc(lineOfBook(i).name) + '</div></div><div class="ctl"><button aria-label="Move up"' + (idx === 0 ? ' disabled' : '') + '>↑</button><button aria-label="Move down"' + (idx === list.length - 1 ? ' disabled' : '') + '>↓</button><button aria-label="Remove">×</button></div>';
      e.querySelector('.body').addEventListener('click', function () { selectStation(i); });
      var btns = e.querySelectorAll('button');
      btns[0].addEventListener('click', function () { list.splice(idx - 1, 0, list.splice(idx, 1)[0]); saveList(); });
      btns[1].addEventListener('click', function () { list.splice(idx + 1, 0, list.splice(idx, 1)[0]); saveList(); });
      btns[2].addEventListener('click', function () { list.splice(idx, 1); saveList(); });
      ul.appendChild(e);
    });
    if (sel >= 0) $('st-add').textContent = list.indexOf(books[sel].id) >= 0 ? 'On the reading list' : 'Add to reading list';
  }
  function listText(md) {
    var lines = md ? ['# Reading list', '', 'From the Read-Order Oracle, ' + new Date().toISOString().slice(0, 10), ''] : ['Reading list (Read-Order Oracle, ' + new Date().toISOString().slice(0, 10) + ')', ''];
    list.forEach(function (id, idx) { var i = byId[id]; if (i === undefined) return; var b = books[i]; lines.push((idx + 1) + '. ' + (md ? '**' + b.t + '**' : b.t) + (b.a ? ' — ' + b.a : '') + (b.y ? ' (' + b.y + ')' : '') + (md ? '  \n   _' + lineOfBook(i).name + ' line · shelf ' + b.id + '_' : ' [' + lineOfBook(i).name + ' line, shelf ' + b.id + ']')); });
    return lines.join('\n') + '\n';
  }
  function download(name, text, type) { var a = document.createElement('a'), url = URL.createObjectURL(new Blob([text], { type: type })); a.href = url; a.download = name; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 500); }
  $('rl-copy').addEventListener('click', function () {
    var t = listText(false), btn = $('rl-copy');
    function done(ok) { btn.textContent = ok ? 'Copied' : 'Copy failed'; setTimeout(function () { btn.textContent = 'Copy as text'; }, 1200); }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(function () { done(true); }, function () { done(false); }); else done(false);
  });
  $('rl-txt').addEventListener('click', function () { download('reading-list.txt', listText(false), 'text/plain'); });
  $('rl-md').addEventListener('click', function () { download('reading-list.md', listText(true), 'text/markdown'); });
  $('rl-clear').addEventListener('click', function () { if (list.length && confirm('Clear the reading list?')) { list = []; saveList(); } });

  /* ---------- random, today, tour, theme, help, onboarding ---------- */
  $('btn-random').addEventListener('click', function () { selectStation(Math.floor(Math.random() * n)); });
  $('btn-today').addEventListener('click', function () { var d = new Date(), seed = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(); selectStation(Math.floor(Oracle.seeded(seed)() * n)); });
  $('btn-tour').addEventListener('click', function () { toggleTour(!tourOn); });
  $('btn-tour2').addEventListener('click', function () { toggleTour(!tourOn); });
  function toggleTour(on) {
    tourOn = on;
    if (on && !tour) { var d = new Date(), seed = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(); tour = Oracle.tour(S, n, Math.floor(Oracle.seeded(seed)() * n), { maxPasses: 30, timeMs: 1200 }).path; }
    ['btn-tour', 'btn-tour2'].forEach(function (id) { $(id).setAttribute('aria-pressed', on ? 'true' : 'false'); $(id).classList.toggle('primary', on); });
    $('tourbadge').classList.toggle('show', on);
    requestDraw(); writeHash();
  }
  function applyTheme() { document.documentElement.setAttribute('data-theme', theme); $('btn-theme').setAttribute('aria-label', theme === 'dark' ? 'Switch to light' : 'Switch to dark'); labelCache.key = ''; if (net) { renderLines(); renderInterchanges(); if (sel >= 0) showStation(sel); renderJourney(); requestDraw(); } }
  $('btn-theme').addEventListener('click', function () { theme = theme === 'dark' ? 'light' : 'dark'; store(STORE.theme, theme); applyTheme(); });
  $('btn-help').addEventListener('click', function () { $('help').classList.add('show'); $('help-close').focus(); });
  function closeHelp() { $('help').classList.remove('show'); $('btn-help').focus(); }
  $('help-close').addEventListener('click', closeHelp);
  $('help').addEventListener('click', function (e) { if (e.target === $('help')) closeHelp(); });
  $('onboard-ok').addEventListener('click', function () { $('onboard').classList.remove('show'); store(STORE.onboarded, '1'); });

  /* ---------- poster export ---------- */
  $('btn-poster').addEventListener('click', function () {
    var k = 1.5, margin = 60, titleH = 110, legendW = 300;
    var W = net.width * CELL * k + 2 * margin, H = net.height * CELL * k + 2 * margin + titleH;
    var v = { k: k, tx: margin, ty: margin + titleH };
    var wasSel = sel, wasJ = journey, wasL = lineSel; sel = -1; journey = null; lineSel = -1;
    var svg = new SvgPainter();
    var saveKey = labelCache.key; labelCache.key = '';
    function posterScene(p) {
      p.rect(0, 0, W, H, { fill: cssVar('--map-bg') });
      drawScene(p, v, { w: W, h: H, poster: true });
      p.text(margin, 40, 'Read-Order Oracle', { size: 30, weight: 700, color: cssVar('--ink') });
      p.text(margin, 74, 'A transit map of the library: ' + n + ' books on ' + net.lines.length + ' lines, ' + net.inters.length + ' interchanges. Consecutive stops share words in their catalogue descriptions.', { size: 14, weight: 500, color: cssVar('--ink-2') });
      // legend
      var lx = W - margin - legendW, ly = H - margin - (net.lines.length * 22 + 28);
      p.rect(lx - 12, ly - 12, legendW + 12, net.lines.length * 22 + 36, { fill: cssVar('--panel'), stroke: cssVar('--line-2'), rx: 8 });
      p.text(lx, ly + 4, 'LINES', { size: 11, weight: 700, color: cssVar('--ink-3') });
      net.lines.forEach(function (L, li) {
        var yy = ly + 22 + li * 22;
        p.line([[lx, yy], [lx + 26, yy]], { color: colour(li), width: 7 });
        p.text(lx + 36, yy, L.name + '  ' + L.code, { size: 13, weight: 600, color: cssVar('--ink') });
        p.text(lx + legendW - 6, yy, L.stations.length + ' stops', { size: 12, weight: 500, color: cssVar('--ink-3'), align: 'right' });
      });
      p.text(margin, H - 22, 'nietztein.github.io · built in the browser from the catalogue, ' + new Date().toISOString().slice(0, 10), { size: 11, weight: 500, color: cssVar('--ink-3') });
    }
    posterScene(svg);
    var svgText = '<svg xmlns="http://www.w3.org/2000/svg" width="' + Math.round(W) + '" height="' + Math.round(H) + '" viewBox="0 0 ' + Math.round(W) + ' ' + Math.round(H) + '">' + svg.out.join('') + '</svg>';
    download('read-order-oracle-map.svg', svgText, 'image/svg+xml');
    // PNG at 2x
    try {
      var c2 = document.createElement('canvas'), s2 = Math.min(2, 4000 / Math.max(W, H)); c2.width = Math.round(W * s2); c2.height = Math.round(H * s2);
      var p2 = new CanvasPainter(c2.getContext('2d'), s2);
      labelCache.key = '';
      posterScene(p2);
      c2.toBlob(function (blob) { if (!blob) return; var a = document.createElement('a'), url = URL.createObjectURL(blob); a.href = url; a.download = 'read-order-oracle-map.png'; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 500); }, 'image/png');
    } catch (e) { /* the SVG is enough */ }
    sel = wasSel; journey = wasJ; lineSel = wasL; labelCache.key = ''; requestDraw();
  });

  /* ---------- hash state ---------- */
  var hashLock = false;
  function writeHash() {
    if (!net) return;
    var parts = [];
    if (fromIdx >= 0 && toIdx >= 0) parts.push('from=' + encodeURIComponent(books[fromIdx].id) + '&to=' + encodeURIComponent(books[toIdx].id));
    else if (sel >= 0) parts.push('book=' + encodeURIComponent(books[sel].id));
    if (lineSel >= 0) parts.push('line=' + net.lines[lineSel].code);
    if (tourOn) parts.push('tour=1');
    var h = parts.length ? '#' + parts.join('&') : '';
    if (h !== location.hash && !(h === '' && location.hash === '')) { hashLock = true; history.replaceState(null, '', location.pathname + location.search + h); setTimeout(function () { hashLock = false; }, 0); }
  }
  function readHash(initial) {
    if (hashLock || !net) return;
    var q = {}; location.hash.replace(/^#/, '').split('&').forEach(function (kv) { var p = kv.split('='); if (p[0]) q[p[0]] = decodeURIComponent(p[1] || ''); });
    if (q.tour === '1' && !tourOn) toggleTour(true);
    if (q.from !== undefined && q.to !== undefined && byId[q.from] !== undefined && byId[q.to] !== undefined) { fromIdx = -1; toIdx = -1; setFrom(byId[q.from]); setTo(byId[q.to]); showTab('journey'); }
    else if (q.book !== undefined && byId[q.book] !== undefined) selectStation(byId[q.book], { k: 1.8 });
    if (q.line) { var li = net.lines.findIndex(function (L) { return L.code === q.line; }); if (li >= 0) selectLine(li, { quiet: sel >= 0 }); }
    if (initial && !q.book && !q.from && !q.line) showTab('search');
  }
  window.addEventListener('hashchange', function () { readHash(false); });

  renderList();
  boot();
})();
