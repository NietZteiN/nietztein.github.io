// Terminus: the page. Rendering, input, sidebar, service map and search.
// The game rules live in sim.js; the map in map.js.
(function () {
  'use strict';

  var M = window.TerminusMap, Sim = window.TerminusSim;
  var params = new URLSearchParams(location.search);
  var THUMB = params.get('thumb') === '1';
  var REDUCED = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var W = M.W, H = M.H;
  var UNIT_BY_ID = {};
  M.UNITS.forEach(function (u) { UNIT_BY_ID[u.id] = u; });

  var PAPER = '#f4ecd9', INK = '#1e2436', RIVER_FILL = '#cfe2ea', RIVER_EDGE = '#a9cbd8';
  var LINE_W = 8, SVC_W = 6;

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function fold(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }
  function genreColor(g, l) { var h = M.GENRE_HUE[g]; if (h == null || g === 'Unidentified' || g === 'Games & other objects') return l > 50 ? '#9a9385' : '#6b655a'; return 'hsl(' + h + ',62%,' + (l || 42) + '%)'; }
  function lineColor(i) { return M.LINE_COLORS[i].hex; }
  function stationRadius(count) { return 9 + Math.sqrt(count) * 0.75; }
  function todaySeed() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }

  // ---- DOM --------------------------------------------------------------------

  var stage = $('stage'), canvas = $('map'), ctx = canvas.getContext('2d');
  var tip = $('tip'), flashEl = $('flash'), banner = $('banner'), badge = $('badge'), msg = $('msg');
  var aside = document.querySelector('aside');

  // ---- State ------------------------------------------------------------------

  var books = [], counts = {}, byId = {};
  var game = null, seed = params.get('seed') || todaySeed();
  var mode = 'play';
  var speed = 1, speedBeforePause = 1;
  var scale = 1, ox = 0, oy = 0, cw = 0, ch = 0;
  var pointer = { x: -1, y: -1, down: false }, hover = null, hoverLine = -1, drag = null, pinnedTip = false;
  var selectedLine = -1;
  var highlight = null;      // { book, until }
  var fx = [];
  var flashTimer = 0;
  var svc = null, svcGenre = null, svcHoverGenre = null;
  var dirty = true, lastFrame = 0, acc = 0;
  var tapStart = null;

  // ---- Boot -------------------------------------------------------------------

  fetch('../../assets/data/library.json')
    .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(function (data) {
      books = (data.books || []).filter(function (b) { return UNIT_BY_ID[b.u]; });
      books.forEach(function (b) { counts[b.u] = (counts[b.u] || 0) + 1; byId[b.id] = b; });
      buildService();
      init();
    })
    .catch(function (err) {
      msg.textContent = 'The catalogue could not be loaded (' + err.message + '). The map needs assets/data/library.json.';
      msg.classList.add('show');
      fit(); drawPaper(); drawRiver();
    });

  function init() {
    if (THUMB) document.body.classList.add('thumb');
    fit();
    window.addEventListener('resize', function () { fit(); dirty = true; });
    buildDial();
    newGame(seed);
    bindUI();
    if (params.get('view') === 'service') setMode('service');
    if (THUMB) {
      Sim.demoLayout(game);
      Sim.fastForward(game, 400, 1 / 30, 'train');
      drainEvents();
      speed = 1;
    } else if (params.get('help') !== '0' && !localStorage.getItem('terminus.seen')) {
      try { localStorage.setItem('terminus.seen', '1'); } catch (e) { /* private mode */ }
      $('help').classList.add('show');
    }
    requestAnimationFrame(frame);
    // a small hook for the console (and the self-test)
    window.Terminus = { game: function () { return game; }, toClient: function (x, y) { var r = canvas.getBoundingClientRect(); return { x: r.left + ox + x * scale, y: r.top + oy + y * scale }; }, units: M.UNITS, mode: function () { return mode; } };
  }

  function newGame(s) {
    seed = s;
    game = Sim.createGame({ stations: M.stationsFor(counts), river: M.RIVER, books: books, seed: s });
    selectedLine = -1; drag = null; highlight = null; fx = [];
    $('ledger').innerHTML = '<li class="empty">Nothing delivered yet. Drag between two stations to open a line.</li>';
    $('seedinfo').textContent = 'Timetable: ' + s + '.';
    $('gameover').classList.remove('show'); $('upgrade').classList.remove('show');
    banner.classList.remove('show');
    setSpeed(1);
    renderSidebar(); updateStatus();
    dirty = true;
  }

  // ---- Layout -----------------------------------------------------------------

  function fit() {
    var rect = stage.getBoundingClientRect();
    var narrow = window.innerWidth <= 900;
    if (!THUMB && !narrow) {
      var want = Math.round(rect.width * 0.64);
      var maxH = Math.max(380, window.innerHeight - 180);
      var h = Math.min(want, maxH);
      stage.style.height = h + 'px';
      aside.style.height = h + 'px';
      rect = stage.getBoundingClientRect();
    } else if (narrow && !THUMB) {
      stage.style.height = ''; aside.style.height = '';
      rect = stage.getBoundingClientRect();
    } else {
      rect = stage.getBoundingClientRect();
    }
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    cw = rect.width; ch = rect.height;
    canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    scale = Math.min(cw / W, ch / H);
    ox = (cw - W * scale) / 2; oy = (ch - H * scale) / 2;
  }
  function toMap(cx, cy) { return { x: (cx - ox) / scale, y: (cy - oy) / scale }; }

  // ---- Main loop ---------------------------------------------------------------

  function frame(now) {
    requestAnimationFrame(frame);
    var dt = Math.min(0.1, (now - lastFrame) / 1000 || 0);
    lastFrame = now;
    if (mode === 'play' && game) {
      if (speed > 0 && !game.state.over && !game.state.pending && !game.state.placing) {
        acc += dt * speed;
        var step = 1 / 60, n = 0;
        while (acc >= step && n < 12) { game.tick(step); acc -= step; n++; }
        if (acc > step * 12) acc = 0;
        dirty = true;
      }
      drainEvents();
      if (fx.length) { fx = fx.filter(function (f) { return f.until > now; }); dirty = true; }
      if (highlight && highlight.until < now) { highlight = null; dirty = true; }
      else if (highlight && !REDUCED) dirty = true;
      if (flashTimer && now > flashTimer) { flashTimer = 0; flashEl.classList.remove('show'); }
      updateDial();
    }
    if (dirty) { draw(now); dirty = false; }
  }

  function drainEvents() {
    var G = game.state, evs = G.events;
    if (!evs.length) return;
    for (var i = 0; i < evs.length; i++) {
      var e = evs[i];
      if (e.type === 'deliver') { addLedger(e.entry); if (!REDUCED) fx.push({ x: e.x, y: e.y, until: performance.now() + 700, start: performance.now(), color: genreColor(e.entry.book.g, 48) }); }
      else if (e.type === 'week') { showUpgrade(); }
      else if (e.type === 'crowd') { flash(G.stations[e.station].name + ' is overcrowding', true); }
      else if (e.type === 'over') { showGameOver(); }
      else if (e.type === 'day') { updateStatus(); }
      else if (e.type === 'upgrade') { renderSidebar(); if (e.kind === 'interchange') showPlacing(); }
      else if (e.type === 'interchange') { banner.classList.remove('show'); flash(G.stations[e.station].name + ' is now an interchange'); renderSidebar(); }
    }
    evs.length = 0;
    updateStatus();
  }

  // ---- Drawing -----------------------------------------------------------------

  function draw(now) {
    ctx.save();
    drawPaper();
    ctx.translate(ox, oy); ctx.scale(scale, scale);
    drawRiver();
    if (mode === 'service') drawService(now); else drawGame(now);
    ctx.restore();
  }

  function drawPaper() {
    ctx.fillStyle = PAPER; ctx.fillRect(0, 0, cw, ch);
    ctx.fillStyle = 'rgba(70,50,30,0.09)';
    var step = 40 * scale, x0 = ox % step, y0 = oy % step;
    for (var x = x0; x < cw; x += step) for (var y = y0; y < ch; y += step) ctx.fillRect(x - 0.5, y - 0.5, 1.2, 1.2);
  }

  function drawRiver() {
    var r = M.RIVER;
    ctx.save();
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(r[0].x, r[0].y);
    for (var i = 1; i < r.length; i++) ctx.lineTo(r[i].x, r[i].y);
    ctx.strokeStyle = RIVER_EDGE; ctx.lineWidth = 50; ctx.stroke();
    ctx.strokeStyle = RIVER_FILL; ctx.lineWidth = 42; ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 2; ctx.setLineDash([6, 10]); ctx.stroke();
    ctx.restore();
    ctx.save();
    ctx.fillStyle = 'rgba(40,70,90,0.55)'; ctx.font = 'italic 11px Cabin, sans-serif'; ctx.textAlign = 'center';
    ctx.translate(729, 60); ctx.rotate(Math.PI / 2 - 0.16); ctx.fillText('the river', 0, 4);
    ctx.restore();
    ctx.fillStyle = 'rgba(60,45,30,0.4)'; ctx.font = '600 10px Cabin, sans-serif'; ctx.textAlign = 'left';
    ctx.fillText('EAST BANK · THE JAPANESE CASES', 775, 625);
  }

  // Parallel offset of an octilinear path (2 or 3 points) by `off` map units.
  function offsetPath(pts, off) {
    if (!off) return pts;
    var canon = pts, flip = (pts[pts.length - 1].x < pts[0].x) || (pts[pts.length - 1].x === pts[0].x && pts[pts.length - 1].y < pts[0].y);
    if (flip) canon = pts.slice().reverse();
    var out = [];
    if (canon.length === 2) {
      var n = normal(canon[0], canon[1]);
      out = [{ x: canon[0].x + n.x * off, y: canon[0].y + n.y * off }, { x: canon[1].x + n.x * off, y: canon[1].y + n.y * off }];
    } else {
      var n1 = normal(canon[0], canon[1]), n2 = normal(canon[1], canon[2]);
      var a = { x: canon[0].x + n1.x * off, y: canon[0].y + n1.y * off };
      var c = { x: canon[2].x + n2.x * off, y: canon[2].y + n2.y * off };
      var d1 = { x: canon[1].x - canon[0].x, y: canon[1].y - canon[0].y }, d2 = { x: canon[2].x - canon[1].x, y: canon[2].y - canon[1].y };
      var den = d1.x * d2.y - d1.y * d2.x, b;
      if (Math.abs(den) < 1e-6) b = { x: canon[1].x + n1.x * off, y: canon[1].y + n1.y * off };
      else { var t = ((c.x - a.x) * d2.y - (c.y - a.y) * d2.x) / den; b = { x: a.x + d1.x * t, y: a.y + d1.y * t }; }
      out = [a, b, c];
    }
    return flip ? out.reverse() : out;
  }
  function normal(a, b) { var dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1; return { x: -dy / L, y: dx / L }; }
  function tracePath(pts) {
    ctx.moveTo(pts[0].x, pts[0].y);
    if (pts.length === 3) {
      var l1 = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y), l2 = Math.hypot(pts[2].x - pts[1].x, pts[2].y - pts[1].y);
      ctx.arcTo(pts[1].x, pts[1].y, pts[2].x, pts[2].y, Math.min(18, l1 / 2, l2 / 2));
    }
    ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
  }
  function pairKey(a, b) { return a < b ? a + '|' + b : b + '|' + a; }

  // Which lines share which station pair, so parallel runs fan out.
  function pairGroups(lineList) {
    var groups = {};
    lineList.forEach(function (ln) {
      for (var i = 1; i < ln.stations.length; i++) {
        var k = pairKey(ln.stations[i - 1], ln.stations[i]);
        (groups[k] = groups[k] || []).push(ln.key);
      }
    });
    return groups;
  }
  function offsetFor(groups, a, b, key, gap) {
    var g = groups[pairKey(a, b)] || [key], i = g.indexOf(key);
    return (i - (g.length - 1) / 2) * gap;
  }

  function drawLines(lineList, width, alphaFn) {
    var groups = pairGroups(lineList);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    lineList.forEach(function (ln) {
      ctx.globalAlpha = alphaFn ? alphaFn(ln) : 1;
      ctx.strokeStyle = ln.color; ctx.lineWidth = width;
      ctx.beginPath();
      ln.paths.forEach(function (p) {
        var pts = offsetPath(p.pts, offsetFor(groups, p.a, p.b, ln.key, width + 1.5));
        tracePath(pts);
      });
      ctx.stroke();
      if (ln.ends) {
        [0, ln.stations.length - 1].forEach(function (idx, which) {
          if (drag && drag.line === ln.id && drag.end === (which ? 'head' : 'tail')) return;
          var h = handleAt(ln, which ? 'head' : 'tail');
          if (!h) return;
          ctx.beginPath();
          ctx.lineWidth = width * 0.8;
          ctx.moveTo(h.x - h.nx * 9, h.y - h.ny * 9); ctx.lineTo(h.x + h.nx * 9, h.y + h.ny * 9);
          ctx.stroke();
        });
      }
    });
    ctx.globalAlpha = 1;
  }
  // End-tab position for a line end (beyond the last station, along the last leg).
  function handleAt(ln, end) {
    if (ln.stations.length < 2) return null;
    var pts = end === 'head' ? ln.paths[ln.paths.length - 1].pts : ln.paths[0].pts.slice().reverse();
    var last = pts[pts.length - 1], prev = pts[pts.length - 2];
    var dx = last.x - prev.x, dy = last.y - prev.y, L = Math.hypot(dx, dy) || 1;
    var st = game.state.stations[end === 'head' ? ln.stations[ln.stations.length - 1] : ln.stations[0]];
    var r = stationRadius(st.count) + 12;
    return { x: last.x + dx / L * r, y: last.y + dy / L * r, nx: -dy / L, ny: dx / L };
  }

  function drawShape(shape, x, y, r) {
    ctx.beginPath();
    var i, a;
    switch (shape) {
      case 'square': ctx.rect(x - r, y - r, 2 * r, 2 * r); break;
      case 'triangle': r *= 1.2; ctx.moveTo(x, y - r); ctx.lineTo(x + r * 0.9, y + r * 0.6); ctx.lineTo(x - r * 0.9, y + r * 0.6); ctx.closePath(); break;
      case 'diamond': r *= 1.2; ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath(); break;
      case 'pentagon': r *= 1.1; for (i = 0; i < 5; i++) { a = -Math.PI / 2 + i * 2 * Math.PI / 5; ctx.lineTo(x + r * Math.cos(a), y + r * Math.sin(a)); } ctx.closePath(); break;
      case 'hexagon': r *= 1.08; for (i = 0; i < 6; i++) { a = i * Math.PI / 3; ctx.lineTo(x + r * Math.cos(a), y + r * Math.sin(a)); } ctx.closePath(); break;
      case 'octagon': r *= 1.05; for (i = 0; i < 8; i++) { a = Math.PI / 8 + i * Math.PI / 4; ctx.lineTo(x + r * Math.cos(a), y + r * Math.sin(a)); } ctx.closePath(); break;
      case 'star': r *= 1.25; for (i = 0; i < 10; i++) { a = -Math.PI / 2 + i * Math.PI / 5; var rr = i % 2 ? r * 0.5 : r; ctx.lineTo(x + rr * Math.cos(a), y + rr * Math.sin(a)); } ctx.closePath(); break;
      case 'cross': { var t = r * 0.4; ctx.moveTo(x - t, y - r); ctx.lineTo(x + t, y - r); ctx.lineTo(x + t, y - t); ctx.lineTo(x + r, y - t); ctx.lineTo(x + r, y + t); ctx.lineTo(x + t, y + t); ctx.lineTo(x + t, y + r); ctx.lineTo(x - t, y + r); ctx.lineTo(x - t, y + t); ctx.lineTo(x - r, y + t); ctx.lineTo(x - r, y - t); ctx.lineTo(x - t, y - t); ctx.closePath(); break; }
      case 'lozenge': ctx.moveTo(x - r * 1.3, y); ctx.lineTo(x - r * 0.5, y - r * 0.8); ctx.lineTo(x + r * 1.3, y); ctx.lineTo(x + r * 0.5, y + r * 0.8); ctx.closePath(); break;
      case 'semicircle': ctx.moveTo(x - r * 1.15, y + r * 0.45); ctx.arc(x, y + r * 0.45, r * 1.15, Math.PI, 0); ctx.closePath(); break;
      case 'bar': { var h = r * 0.55, w = r * 1.35; ctx.moveTo(x - w + h, y - h); ctx.arcTo(x + w, y - h, x + w, y + h, h); ctx.arcTo(x + w, y + h, x - w, y + h, h); ctx.arcTo(x - w, y + h, x - w, y - h, h); ctx.arcTo(x - w, y - h, x + w, y - h, h); ctx.closePath(); break; }
      case 'ring': ctx.arc(x, y, r, 0, Math.PI * 2); ctx.moveTo(x + r * 0.45, y); ctx.arc(x, y, r * 0.45, 0, Math.PI * 2, true); break;
      default: ctx.arc(x, y, r, 0, Math.PI * 2);
    }
  }

  function drawStation(st, u, r, opts) {
    var x = st.x, y = st.y;
    if (st.interchange || u.terminus) {
      drawShape(u.shape, x, y, r + 5);
      ctx.fillStyle = PAPER; ctx.fill();
      ctx.lineWidth = 2.5; ctx.strokeStyle = INK; ctx.stroke();
    }
    drawShape(u.shape, x, y, r);
    ctx.fillStyle = opts && opts.fill ? opts.fill : '#fffaf0'; ctx.fill('evenodd');
    ctx.lineWidth = opts && opts.lw ? opts.lw : 3.5; ctx.strokeStyle = opts && opts.stroke ? opts.stroke : INK; ctx.stroke();
  }

  function drawLabel(u, r, name, sub) {
    var fs = Math.max(13, 11 / scale);
    ctx.font = fs + 'px "Hammersmith One", "Gill Sans", sans-serif';
    ctx.textAlign = u.la; ctx.textBaseline = 'middle';
    var x = u.x + u.lx, y = u.y + u.ly;
    if (u.la === 'center' && u.ly > 0) y += (r - 14);
    if (u.la === 'center' && u.ly < 0) y -= (r - 14);
    ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(244,236,217,0.9)'; ctx.lineJoin = 'round';
    ctx.strokeText(name, x, y);
    ctx.fillStyle = INK; ctx.fillText(name, x, y);
    if (sub) {
      ctx.font = '600 9px Cabin, sans-serif'; ctx.fillStyle = 'rgba(30,36,54,0.7)';
      ctx.strokeText(sub, x, y + 12); ctx.fillText(sub, x, y + 12);
    }
  }

  function drawGame(now) {
    var G = game.state, lines = [];
    G.lines.forEach(function (ln) {
      if (drag && drag.line === ln.id) return;
      if (ln.stations.length >= 2) lines.push({ id: ln.id, key: 'L' + ln.id, color: lineColor(ln.id), stations: ln.stations, paths: ln.paths, ends: true });
    });
    // preview of the line being dragged
    if (drag && drag.working.length >= 2) {
      var chk = game.checkLine(drag.line, drag.working);
      lines.push({ id: drag.line, key: 'L' + drag.line, color: lineColor(drag.line), stations: drag.working, paths: chk.ok ? chk.paths : buildPreviewPaths(drag.working), ends: false, preview: true });
    }
    drawLines(lines, LINE_W, function (ln) { return ln.preview ? 0.55 : 1; });
    if (drag && drag.ghost) {
      ctx.save(); ctx.setLineDash([10, 8]); ctx.lineWidth = LINE_W * 0.8; ctx.lineCap = 'round';
      ctx.strokeStyle = drag.bad ? '#d8232a' : lineColor(drag.line); ctx.globalAlpha = 0.7;
      var gp = Sim.octiPath(drag.ghost.from, drag.ghost.to).pts;
      ctx.beginPath(); tracePath(gp); ctx.stroke();
      ctx.restore();
    }

    // stations
    G.stationList.forEach(function (st) {
      var u = UNIT_BY_ID[st.id], r = stationRadius(st.count);
      var cap = game.stationCap(st), crowded = st.waiting.length > cap;
      if (st.overflow > 0) {
        ctx.beginPath(); ctx.arc(st.x, st.y, r + 11, -Math.PI / 2, -Math.PI / 2 + st.overflow * Math.PI * 2);
        ctx.strokeStyle = '#d8232a'; ctx.lineWidth = 5; ctx.lineCap = 'butt'; ctx.stroke();
        ctx.beginPath(); ctx.arc(st.x, st.y, r + 11, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(216,35,42,0.18)'; ctx.lineWidth = 5; ctx.stroke();
      }
      var isHover = hover === st.id, placing = G.placing === 'interchange';
      var opts = {};
      if (placing) { opts.stroke = isHover ? '#e8b33a' : INK; opts.lw = isHover ? 5 : 3.5; }
      else if (isHover || (drag && drag.target === st.id)) { opts.lw = 5; }
      if (crowded) opts.fill = '#ffe3dc';
      drawStation(st, u, r, opts);
      // waiting books
      drawQueue(st, u, r);
    });
    // trains on top
    G.trains.forEach(function (tr) { if (tr.line >= 0) drawTrain(tr); });
    // labels
    G.stationList.forEach(function (st) {
      var u = UNIT_BY_ID[st.id], r = stationRadius(st.count);
      drawLabel(u, r, scale < 0.75 ? u.short : u.name, u.terminus ? 'TERMINUS' : null);
    });
    // effects and highlight
    fx.forEach(function (f) {
      var t = (now - f.start) / 700;
      ctx.beginPath(); ctx.arc(f.x, f.y, 14 + t * 26, 0, Math.PI * 2);
      ctx.strokeStyle = f.color; ctx.globalAlpha = 1 - t; ctx.lineWidth = 3; ctx.stroke(); ctx.globalAlpha = 1;
    });
    if (highlight) drawHighlight(now);
    if (G.placing === 'interchange' && !THUMB) {
      ctx.font = '600 13px Cabin, sans-serif'; ctx.fillStyle = INK; ctx.textAlign = 'center';
      ctx.fillText('Choose a station to become an interchange', W / 2, 24);
    }
  }
  function buildPreviewPaths(ids) {
    var out = [];
    for (var i = 1; i < ids.length; i++) { var p = Sim.octiPath(game.state.stations[ids[i - 1]], game.state.stations[ids[i]]); out.push({ pts: p.pts, a: ids[i - 1], b: ids[i] }); }
    return out;
  }

  function drawQueue(st, u, r) {
    var q = st.waiting; if (!q.length) return;
    var small = scale < 0.75, dir = u.px < 0 ? -1 : 1, perRow = 7, size = small ? 6.5 : 5.2, gap = small ? 15.5 : 12.5;
    var x0 = st.x + (u.px < 0 ? u.px - size : u.px + size), y0 = st.y + u.py;
    if (u.px > 0 && u.px < r) x0 = st.x + r + 8;
    if (u.px < 0 && -u.px < r) x0 = st.x - r - 8;
    var shown = Math.min(q.length, 21);
    for (var i = 0; i < shown; i++) {
      var p = q[i], row = Math.floor(i / perRow), col = i % perRow;
      var x = x0 + dir * col * gap, y = y0 + row * 12.5;
      var dest = UNIT_BY_ID[p.dest];
      drawShape(dest.shape, x, y, size);
      ctx.fillStyle = genreColor(p.book.g, 46); ctx.fill('evenodd');
      ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(20,24,40,0.55)'; ctx.stroke();
    }
    if (q.length > shown) {
      ctx.font = '600 10px Cabin, sans-serif'; ctx.fillStyle = INK; ctx.textAlign = dir > 0 ? 'left' : 'right';
      ctx.fillText('+' + (q.length - shown), x0 + dir * 7 * gap, y0 + 2 * 12.5 + 3);
    }
  }

  function drawTrain(tr) {
    var color = lineColor(tr.line), cap = game.capacity(tr);
    var len = 30, h = 13, cars = 1 + tr.carriages;
    ctx.save();
    ctx.translate(tr.x, tr.y); ctx.rotate(tr.angle);
    if (!tr.moving) ctx.rotate(0);
    for (var c = 0; c < cars; c++) {
      var x0 = -len / 2 - c * (len + 4);
      // coupling
      if (c > 0) { ctx.fillStyle = INK; ctx.fillRect(x0 + len, -1.5, 4, 3); }
      roundRect(x0, -h / 2, len, h, 3.5);
      ctx.fillStyle = color; ctx.fill();
      ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(20,24,40,0.85)'; ctx.stroke();
      // roof stripe
      ctx.fillStyle = 'rgba(255,250,235,0.55)'; ctx.fillRect(x0 + 3, -h / 2 + 1.5, len - 6, 1.5);
      // lit windows: six per car, warm yellow, tinted by the book sitting there
      for (var w = 0; w < 6; w++) {
        var pi = c * 6 + w, p = tr.passengers[pi];
        var wx = x0 + 3.5 + w * (len - 7) / 6, ww = (len - 7) / 6 - 1.5;
        ctx.fillStyle = '#ffe9a3'; ctx.fillRect(wx, -h / 2 + 4, ww, h - 7);
        if (p) { ctx.fillStyle = genreColor(p.book.g, 50); ctx.fillRect(wx + 0.6, -h / 2 + 5.5, ww - 1.2, h - 10); }
      }
      if (c === 0) { ctx.fillStyle = '#fff6c8'; ctx.beginPath(); ctx.arc(len / 2 - 1, 0, 1.6, 0, Math.PI * 2); ctx.fill(); }
    }
    ctx.restore();
    if (tr.passengers.length >= cap) {
      ctx.font = '600 9px Cabin, sans-serif'; ctx.fillStyle = INK; ctx.textAlign = 'center';
      ctx.fillText('FULL', tr.x, tr.y - 12);
    }
  }
  function roundRect(x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  function drawHighlight(now) {
    var b = highlight.book, u = UNIT_BY_ID[b.u], r = stationRadius(counts[b.u] || 0);
    var pulse = REDUCED ? 0 : (Math.sin(now / 220) + 1) / 2;
    ctx.beginPath(); ctx.arc(u.x, u.y, r + 16 + pulse * 4, 0, Math.PI * 2);
    ctx.strokeStyle = genreColor(b.g, 42); ctx.lineWidth = 3; ctx.setLineDash([6, 5]); ctx.stroke(); ctx.setLineDash([]);
    var text = b.t.length > 34 ? b.t.slice(0, 33) + '…' : b.t;
    ctx.font = '600 12px Cabin, sans-serif';
    var tw = ctx.measureText(text).width + 16, bx = clamp(u.x - tw / 2, 6, W - tw - 6);
    var above = u.ly > 0 || u.la !== 'center';
    var by = above ? u.y - r - 50 : u.y + r + 28;
    if (by < 6) by = u.y + r + 28; if (by > H - 28) by = u.y - r - 50;
    var col = genreColor(b.g, 40);
    roundRect(bx, by, tw, 22, 6); ctx.fillStyle = col; ctx.fill();
    ctx.beginPath();
    if (by < u.y) { ctx.moveTo(u.x - 6, by + 22); ctx.lineTo(u.x + 6, by + 22); ctx.lineTo(u.x, by + 30); }
    else { ctx.moveTo(u.x - 6, by); ctx.lineTo(u.x + 6, by); ctx.lineTo(u.x, by - 8); }
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(text, bx + 8, by + 11);
  }

  // ---- Service map -------------------------------------------------------------

  function buildService() {
    var perGenre = {};
    books.forEach(function (b) {
      var g = perGenre[b.g] = perGenre[b.g] || { name: b.g, total: 0, units: {} };
      g.total++;
      (g.units[b.u] = g.units[b.u] || []).push(b);
    });
    var genres = Object.keys(perGenre).map(function (k) { return perGenre[k]; });
    genres.sort(function (a, b) { return b.total - a.total; });
    var lines = [];
    genres.forEach(function (g, gi) {
      g.color = genreColor(g.name, 42);
      g.stops = Object.keys(g.units).filter(function (u) { return g.units[u].length >= 3; });
      g.key = 'G' + gi;
      if (g.stops.length >= 2) {
        // nearest-neighbour chain from the westernmost stop
        var rest = g.stops.slice().sort(function (a, b) { return UNIT_BY_ID[a].x - UNIT_BY_ID[b].x; });
        var order = [rest.shift()];
        while (rest.length) {
          var last = UNIT_BY_ID[order[order.length - 1]], bi = 0, bd = Infinity;
          rest.forEach(function (id, i) { var d = Math.hypot(UNIT_BY_ID[id].x - last.x, UNIT_BY_ID[id].y - last.y); if (d < bd) { bd = d; bi = i; } });
          order.push(rest.splice(bi, 1)[0]);
        }
        g.order = order;
        var paths = [];
        for (var i = 1; i < order.length; i++) { var p = Sim.octiPath(UNIT_BY_ID[order[i - 1]], UNIT_BY_ID[order[i]]); paths.push({ pts: p.pts, a: order[i - 1], b: order[i] }); }
        g.paths = paths;
        lines.push({ id: gi, key: g.key, color: g.color, stations: order, paths: paths, ends: false, genre: g });
      }
    });
    svc = { genres: genres, lines: lines };
  }

  function drawService() {
    var sel = svcHoverGenre || svcGenre;
    drawLines(svc.lines, SVC_W, function (ln) { return !sel ? 0.92 : (ln.genre.name === sel ? 1 : 0.1); });
    var selG = sel ? svc.genres.find(function (g) { return g.name === sel; }) : null;
    M.UNITS.forEach(function (u) {
      var total = counts[u.id] || 0, r = stationRadius(total);
      var st = { x: u.x, y: u.y, interchange: false };
      var here = selG ? (selG.units[u.id] || []).length : 0;
      var opts = { lw: hover === u.id ? 5 : 3.5 };
      if (selG) { opts.fill = here ? genreColor(sel, 92) : '#fffaf0'; if (here < 3) opts.stroke = 'rgba(30,36,54,0.35)'; }
      drawStation(st, u, r, opts);
      ctx.font = '600 ' + (r > 14 ? 11 : 9.5) + 'px Cabin, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = selG ? (here ? genreColor(sel, 30) : 'rgba(30,36,54,0.4)') : INK;
      var ty = u.shape === 'triangle' ? u.y + 3 : (u.shape === 'semicircle' ? u.y + 4 : u.y);
      ctx.fillText(selG ? here : total, u.x, ty);
      if (selG && here >= 3) {
        // bubble sized by this genre's count
        var br = 8 + Math.sqrt(here) * 2.4;
        ctx.beginPath(); ctx.arc(u.x, u.y, r + 6 + br * 0.3, 0, Math.PI * 2);
        ctx.strokeStyle = genreColor(sel, 42); ctx.lineWidth = 2 + br * 0.25; ctx.globalAlpha = 0.35; ctx.stroke(); ctx.globalAlpha = 1;
      }
    });
    M.UNITS.forEach(function (u) { drawLabel(u, stationRadius(counts[u.id] || 0), scale < 0.75 ? u.short : u.name, u.terminus ? 'TERMINUS' : null); });
    if (highlight) drawHighlight(performance.now());
    ctx.font = '600 11px Cabin, sans-serif'; ctx.fillStyle = 'rgba(30,36,54,0.6)'; ctx.textAlign = 'left';
    ctx.fillText(sel ? sel.toUpperCase() + ' · ' + selG.total + ' BOOKS' : 'SERVICE MAP · WHERE EACH GENRE LIVES', 16, 22);
  }

  // ---- Hit testing -------------------------------------------------------------

  function stationAt(p, extra) {
    var best = null, bd = Infinity;
    M.UNITS.forEach(function (u) {
      var r = stationRadius(counts[u.id] || 0) + 10 + (extra || 0);
      var d = Math.hypot(p.x - u.x, p.y - u.y);
      if (d < r && d < bd) { bd = d; best = u.id; }
    });
    return best;
  }
  function handleHit(p) {
    var G = game.state, out = null;
    G.lines.forEach(function (ln) {
      if (ln.stations.length < 2) return;
      ['head', 'tail'].forEach(function (end) {
        var h = handleAt(ln, end);
        if (h && Math.hypot(p.x - h.x, p.y - h.y) < 14) out = { line: ln.id, end: end };
      });
    });
    return out;
  }
  function distToSeg(p, a, b) {
    var dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy || 1;
    var t = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / L2, 0, 1);
    return Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t);
  }
  function segmentHit(p, lineList, tol) {
    var out = null, bd = tol || 9;
    lineList.forEach(function (ln) {
      ln.paths.forEach(function (path, si) {
        for (var i = 1; i < path.pts.length; i++) {
          var d = distToSeg(p, path.pts[i - 1], path.pts[i]);
          if (d < bd) { bd = d; out = { line: ln.id, seg: si, key: ln.key, genre: ln.genre }; }
        }
      });
    });
    return out;
  }

  // ---- Input -------------------------------------------------------------------

  function bindUI() {
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('pointerleave', function () { if (!drag) { pointer.x = -1; hover = null; hoverLine = -1; svcHoverGenre = null; if (!pinnedTip) hideTip(); dirty = true; } });

    $('sp-0').addEventListener('click', function () { setSpeed(speed === 0 ? speedBeforePause : 0); });
    $('sp-1').addEventListener('click', function () { setSpeed(1); });
    $('sp-2').addEventListener('click', function () { setSpeed(2); });
    $('btn-new').addEventListener('click', function () { newGame(seed); });
    $('tab-play').addEventListener('click', function () { setMode('play'); });
    $('tab-service').addEventListener('click', function () { setMode('service'); });
    $('btn-help').addEventListener('click', function () { $('help').classList.add('show'); });
    $('btn-close').addEventListener('click', function () { $('help').classList.remove('show'); });
    $('go-again').addEventListener('click', function () { newGame(seed); });
    $('go-shuffle').addEventListener('click', function () { newGame('shuffle-' + Math.random().toString(36).slice(2, 8)); });
    $('go-service').addEventListener('click', function () { $('gameover').classList.remove('show'); setMode('service'); });
    document.querySelectorAll('.overlay').forEach(function (o) {
      o.addEventListener('click', function (e) { if (e.target === o && o.id === 'help') o.classList.remove('show'); });
    });
    document.addEventListener('keydown', onKey);
    document.addEventListener('visibilitychange', function () { if (document.hidden && speed > 0) setSpeed(0); });
    var q = $('q');
    q.addEventListener('input', function () { runSearch(q.value); });
    q.addEventListener('focus', function () { if (q.value) runSearch(q.value); });
    q.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { q.value = ''; $('results').classList.remove('show'); q.blur(); }
      if (e.key === 'Enter') { var first = $('results').querySelector('button'); if (first) first.click(); }
      if (e.key === 'ArrowDown') { var f = $('results').querySelector('button'); if (f) { f.focus(); e.preventDefault(); } }
    });
    document.addEventListener('click', function (e) { if (!e.target.closest('.search')) $('results').classList.remove('show'); });
  }

  function onKey(e) {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    if (e.key === 'Escape') {
      if (drag) { drag = null; dirty = true; canvas.classList.remove('grab'); return; }
      $('help').classList.remove('show'); $('results').classList.remove('show');
      if (pinnedTip) { pinnedTip = false; hideTip(); }
      return;
    }
    if (mode !== 'play') { if (e.key === 's' || e.key === 'S') setMode('play'); return; }
    if (e.key === ' ' || e.key === 'p' || e.key === 'P') { e.preventDefault(); setSpeed(speed === 0 ? speedBeforePause : 0); }
    else if (e.key === '1') setSpeed(1);
    else if (e.key === '2') setSpeed(2);
    else if (e.key === 's' || e.key === 'S') setMode('service');
    else if (e.key === '?') $('help').classList.toggle('show');
  }

  function setSpeed(s) {
    if (s === 0 && speed > 0) speedBeforePause = speed;
    speed = s;
    [0, 1, 2].forEach(function (i) { $('sp-' + i).classList.toggle('on', speed === i); });
    $('sp-0').innerHTML = speed === 0 ? '&#9654; resume' : '&#10074;&#10074; pause';
    $('sp-0').setAttribute('aria-pressed', speed === 0 ? 'true' : 'false');
    dirty = true;
  }

  function setMode(m) {
    mode = m;
    document.body.classList.toggle('svc', m === 'service');
    $('tab-play').classList.toggle('on', m === 'play'); $('tab-service').classList.toggle('on', m === 'service');
    $('tab-play').setAttribute('aria-selected', m === 'play'); $('tab-service').setAttribute('aria-selected', m === 'service');
    $('legend').classList.toggle('show', m === 'service');
    if (m === 'service') { renderLegend(); if (speed > 0) setSpeed(0); }
    hideTip(); pinnedTip = false; hover = null; drag = null;
    fit(); dirty = true;
  }

  function onDown(e) {
    canvas.setPointerCapture(e.pointerId);
    var rect = canvas.getBoundingClientRect();
    var p = toMap(e.clientX - rect.left, e.clientY - rect.top);
    pointer.x = p.x; pointer.y = p.y; pointer.down = true;
    tapStart = { x: e.clientX, y: e.clientY, t: performance.now(), station: stationAt(p, e.pointerType === 'touch' ? 8 : 0) };
    if (mode !== 'play') return;
    var G = game.state;
    if (G.over || G.pending) return;
    if (G.placing === 'interchange') {
      var sid = stationAt(p, 6);
      if (sid) game.placeInterchange(sid);
      return;
    }
    var touchExtra = e.pointerType === 'touch' ? 8 : 0;
    var h = handleHit(p);
    if (h) {
      var ln = G.lines[h.line];
      drag = { mode: 'extend', line: h.line, end: h.end, working: ln.stations.slice(), orig: ln.stations.slice(), ghost: null, bad: false, target: null };
    } else {
      var st = stationAt(p, touchExtra);
      if (st) {
        var free = -1;
        for (var i = 0; i < G.linesUnlocked; i++) if (G.lines[i].stations.length < 2) { free = i; break; }
        if (free < 0) { flash('All ' + G.linesUnlocked + ' lines are in use. Extend one, or delete one from the sidebar.', true); return; }
        drag = { mode: 'new', line: free, end: 'head', working: [st], orig: [], ghost: null, bad: false, target: null };
      } else {
        var lineList = G.lines.filter(function (l) { return l.stations.length >= 2; }).map(function (l) { return { id: l.id, key: 'L' + l.id, paths: l.paths }; });
        var sh = segmentHit(p, lineList, 10 + touchExtra);
        if (sh) drag = { mode: 'insert', line: sh.line, seg: sh.seg, working: G.lines[sh.line].stations.slice(), orig: G.lines[sh.line].stations.slice(), ghost: null, bad: false, target: null };
      }
    }
    if (drag) { canvas.classList.add('grab'); selectedLine = drag.line; renderSidebar(); hideTip(); pinnedTip = false; }
    dirty = true;
  }

  function onMove(e) {
    var rect = canvas.getBoundingClientRect();
    var p = toMap(e.clientX - rect.left, e.clientY - rect.top);
    pointer.x = p.x; pointer.y = p.y;
    var touchExtra = e.pointerType === 'touch' ? 8 : 0;
    if (drag) { dragMove(p, touchExtra); dirty = true; return; }
    var st = stationAt(p, touchExtra);
    if (st !== hover) { hover = st; dirty = true; }
    if (mode === 'service') {
      var seg = st ? null : segmentHit(p, svc.lines, 8);
      var g = seg ? seg.genre.name : null;
      if (g !== svcHoverGenre) { svcHoverGenre = g; dirty = true; renderLegend(); }
    } else {
      var hh = handleHit(p); var hl = hh ? hh.line : -1;
      if (hl !== hoverLine) { hoverLine = hl; dirty = true; }
    }
    canvas.classList.toggle('point', !!st || (mode === 'play' && hoverLine >= 0) || (mode === 'service' && !!svcHoverGenre));
    if (!pinnedTip) {
      if (st && e.pointerType !== 'touch') showTip(st, e.clientX - rect.left, e.clientY - rect.top);
      else if (mode === 'play' && !st && e.pointerType !== 'touch') { var tr = trainAt(p); if (tr) showTrainTip(tr, e.clientX - rect.left, e.clientY - rect.top); else hideTip(); }
      else if (!st) hideTip();
    }
  }
  function trainAt(p) {
    var best = null, bd = 16;
    game.state.trains.forEach(function (tr) { if (tr.line < 0) return; var d = Math.hypot(tr.x - p.x, tr.y - p.y); if (d < bd) { bd = d; best = tr; } });
    return best;
  }

  function dragMove(p, extra) {
    var G = game.state, st = stationAt(p, extra), w = drag.working;
    drag.bad = false;
    if (drag.mode === 'insert') {
      var at = drag.seg + 1;
      var next = drag.orig.slice();
      if (st && drag.orig.indexOf(st) < 0) {
        next.splice(at, 0, st);
        var chk = game.checkLine(drag.line, next);
        if (chk.ok) { drag.working = next; drag.target = st; drag.ghost = null; }
        else { drag.bad = true; drag.working = drag.orig.slice(); drag.target = null; drag.ghost = null; if (chk.reason === 'tunnel') flash('No tunnel left for that crossing', true); }
      } else { drag.working = drag.orig.slice(); drag.target = null; }
      return;
    }
    var endIdx = drag.end === 'head' ? w.length - 1 : 0;
    var endSt = w[endIdx], prevSt = drag.end === 'head' ? w[w.length - 2] : w[1];
    if (st && st === prevSt && w.length > 1) {
      // dragged back over the previous station: shorten
      if (drag.end === 'head') w.pop(); else w.shift();
      drag.target = null;
    } else if (st && w.indexOf(st) < 0) {
      var next2 = w.slice();
      if (drag.end === 'head') next2.push(st); else next2.unshift(st);
      var chk2 = game.checkLine(drag.line, next2);
      if (chk2.ok) { drag.working = next2; drag.target = st; }
      else { drag.bad = true; if (chk2.reason === 'tunnel') flash('No tunnel left: ' + (chk2.have === 0 ? 'the river needs a tunnel upgrade' : 'all tunnels are in use'), true); }
    }
    w = drag.working; endIdx = drag.end === 'head' ? w.length - 1 : 0; endSt = w[endIdx];
    var from = G.stations[endSt];
    drag.ghost = (st === endSt) ? null : { from: { x: from.x, y: from.y }, to: { x: p.x, y: p.y } };
  }

  function onUp(e) {
    pointer.down = false;
    var rect = canvas.getBoundingClientRect();
    var p = toMap(e.clientX - rect.left, e.clientY - rect.top);
    var moved = tapStart && Math.hypot(e.clientX - tapStart.x, e.clientY - tapStart.y) > 6;
    if (drag) {
      var changed = (drag.working.length >= 2 || drag.orig.length >= 2) && drag.working.join() !== drag.orig.join();
      if (changed && drag.working.length >= 2) {
        var res = game.setLineStations(drag.line, drag.working);
        if (!res.ok) flash(res.reason === 'tunnel' ? 'That crossing needs a tunnel' : res.reason, true);
        else if (drag.mode === 'new') flash(M.LINE_COLORS[drag.line].name + ' line opened' + (game.state.lines[drag.line].trains.length ? '' : ' — no spare train yet'));
      } else if (changed && drag.working.length < 2 && drag.orig.length >= 2) {
        game.removeLine(drag.line); flash(M.LINE_COLORS[drag.line].name + ' line closed');
      }
      drag = null; canvas.classList.remove('grab'); renderSidebar(); updateStatus(); dirty = true;
      if (moved || changed) { tapStart = null; return; }
    }
    // tap on a station (touch) pins the tooltip
    if (!moved && tapStart && tapStart.station && (e.pointerType === 'touch' || pinnedTip)) {
      pinnedTip = true; showTip(tapStart.station, e.clientX - rect.left, e.clientY - rect.top); tip.classList.add('pinned');
    } else if (!moved && pinnedTip) { pinnedTip = false; hideTip(); }
    if (!moved && mode === 'service') {
      var seg = segmentHit(p, svc.lines, 10);
      if (seg) { svcGenre = svcGenre === seg.genre.name ? null : seg.genre.name; renderLegend(); dirty = true; }
      else if (!tapStart.station) { svcGenre = null; renderLegend(); dirty = true; }
    }
    tapStart = null;
  }

  // ---- Tooltips ----------------------------------------------------------------

  function bookLine(b, extra) {
    var li = el('li'); var dot = el('i'); dot.style.background = genreColor(b.g, 48); li.appendChild(dot);
    var a = el('a', null, b.t); a.href = '../../#/bookshelf/' + encodeURIComponent(b.id); li.appendChild(a);
    var m = [b.a, b.y, extra || b.s].filter(Boolean).join(' · ');
    li.appendChild(el('span', 'm', m));
    return li;
  }
  function showTip(sid, cx, cy) {
    var u = UNIT_BY_ID[sid];
    tip.innerHTML = '';
    var head = el('div'); head.appendChild(el('b', null, u.name));
    head.appendChild(el('span', 'n', ' · ' + (counts[sid] || 0) + ' books'));
    tip.appendChild(head);
    var ul = el('ul'), more = null;
    if (mode === 'play') {
      var st = game.state.stations[sid];
      var q = st.waiting;
      tip.appendChild(el('div', 'n', q.length ? q.length + ' waiting (limit ' + game.stationCap(st) + ')' + (st.interchange ? ' · interchange' : '') + ' · ' + st.delivered + ' delivered here' : 'No one waiting · ' + st.delivered + ' delivered here'));
      q.slice(0, 10).forEach(function (p) { ul.appendChild(bookLine(p.book, '→ ' + UNIT_BY_ID[p.dest].name)); });
      if (q.length > 10) more = '+' + (q.length - 10) + ' more waiting';
    } else {
      var sel = svcHoverGenre || svcGenre;
      if (sel) {
        var g = svc.genres.find(function (x) { return x.name === sel; }), list = (g.units[sid] || []).slice().sort(function (a, b) { return (a.s + a.p).localeCompare(b.s + b.p); });
        tip.appendChild(el('div', 'n', list.length + ' of ' + sel));
        list.slice(0, 40).forEach(function (b) { ul.appendChild(bookLine(b)); });
        if (list.length > 40) more = '+' + (list.length - 40) + ' more';
      } else {
        tip.appendChild(el('div', 'n', u.desc));
        var gs = svc.genres.filter(function (g2) { return g2.units[sid]; }).map(function (g2) { return { g: g2, n: g2.units[sid].length }; }).sort(function (a, b) { return b.n - a.n; });
        gs.slice(0, 9).forEach(function (x) {
          var li = el('li'); var dot = el('i'); dot.style.background = x.g.color; li.appendChild(dot);
          li.appendChild(el('span', null, x.g.name)); li.appendChild(el('span', 'm', x.n + (x.n >= 3 ? '' : ' (no line)'))); ul.appendChild(li);
        });
        if (gs.length > 9) more = '+' + (gs.length - 9) + ' more genres';
      }
    }
    if (ul.children.length) tip.appendChild(ul);
    if (more) tip.appendChild(el('div', 'more', more));
    placeTip(cx, cy);
  }
  function showTrainTip(tr, cx, cy) {
    tip.innerHTML = '';
    var head = el('div'); head.appendChild(el('b', null, M.LINE_COLORS[tr.line].name + ' line train'));
    head.appendChild(el('span', 'n', ' · ' + tr.passengers.length + ' / ' + game.capacity(tr) + ' aboard'));
    tip.appendChild(head);
    var ul = el('ul');
    tr.passengers.forEach(function (p) { ul.appendChild(bookLine(p.book, '→ ' + UNIT_BY_ID[p.dest].name)); });
    if (ul.children.length) tip.appendChild(ul);
    placeTip(cx, cy);
  }
  function placeTip(cx, cy) {
    tip.style.display = 'block';
    var tw = tip.offsetWidth, th = tip.offsetHeight;
    var x = cx + 16, y = cy + 16;
    if (x + tw > cw - 8) x = cx - tw - 12;
    if (y + th > ch - 8) y = Math.max(8, ch - th - 8);
    if (x < 8) x = 8;
    tip.style.left = x + 'px'; tip.style.top = y + 'px';
  }
  function hideTip() { tip.style.display = 'none'; tip.classList.remove('pinned'); }

  function flash(text, bad) {
    flashEl.textContent = text;
    flashEl.classList.toggle('bad', !!bad);
    flashEl.classList.add('show');
    flashTimer = performance.now() + (bad ? 2600 : 1800);
  }

  // ---- Sidebar -------------------------------------------------------------------

  function renderSidebar() {
    var G = game.state, sw = $('swatches');
    sw.innerHTML = '';
    G.lines.forEach(function (ln, i) {
      var b = el('button', 'sw'); b.style.setProperty('--c', lineColor(i));
      var active = ln.stations.length >= 2, locked = i >= G.linesUnlocked;
      b.classList.toggle('active', active); b.classList.toggle('locked', locked); b.classList.toggle('sel', selectedLine === i);
      b.classList.toggle('notrain', active && ln.trains.length === 0);
      b.appendChild(el('i'));
      if (active) b.appendChild(el('span', 'n', String(ln.stations.length)));
      b.title = locked ? M.LINE_COLORS[i].name + ' line: unlocks at the end of week ' + (i - G.rules.startLines + 1)
        : active ? M.LINE_COLORS[i].name + ' line: ' + ln.stations.length + ' stops, ' + ln.trains.length + ' train' + (ln.trains.length === 1 ? '' : 's')
        : M.LINE_COLORS[i].name + ' line: drag between two stations to open it';
      b.setAttribute('aria-label', b.title);
      b.disabled = locked;
      b.addEventListener('click', function () { selectedLine = selectedLine === i ? -1 : i; renderSidebar(); dirty = true; });
      sw.appendChild(b);
    });
    var ed = $('line-editor'); ed.innerHTML = '';
    var trainsN = G.trains.length, spare = game.spares().length, used = game.tunnelsUsed();
    $('line-info').textContent = trainsN + ' train' + (trainsN === 1 ? '' : 's') + (spare ? ' (' + spare + ' spare)' : '') + ' · ' + used + '/' + G.tunnels + ' tunnel' + (G.tunnels === 1 ? '' : 's');
    if (selectedLine < 0) { ed.appendChild(el('span', 'hint', 'Drag from a station to open a line; drag an end tab to extend it. Pick a colour to edit its stops.')); return; }
    var ln = G.lines[selectedLine], name = M.LINE_COLORS[selectedLine].name;
    if (ln.stations.length < 2) { ed.appendChild(el('span', 'hint', name + ' line is not open yet. Drag between two stations to open it.')); return; }
    var carriages = ln.trains.reduce(function (n, t) { return n + t.carriages; }, 0);
    ed.appendChild(el('span', null, name + ' line · ' + ln.trains.length + ' train' + (ln.trains.length === 1 ? '' : 's') + (carriages ? ' +' + carriages + ' carriage' + (carriages === 1 ? '' : 's') : '') + (ln.trains.length ? '' : ' (waiting for a spare train)')));
    var chips = el('div', 'chips');
    ln.stations.forEach(function (id) {
      var c = el('span', 'chip'); c.appendChild(document.createTextNode(UNIT_BY_ID[id].short));
      var x = el('button', null, '×'); x.title = 'remove ' + UNIT_BY_ID[id].name + ' from the ' + name + ' line'; x.setAttribute('aria-label', x.title);
      x.addEventListener('click', function () {
        var next = ln.stations.filter(function (s) { return s !== id; });
        var res = next.length >= 2 ? game.setLineStations(selectedLine, next) : game.removeLine(selectedLine);
        if (!res.ok) flash(res.reason === 'tunnel' ? 'Removing that stop would need another tunnel' : res.reason, true);
        renderSidebar(); updateStatus(); dirty = true;
      });
      c.appendChild(x); chips.appendChild(c);
    });
    ed.appendChild(chips);
    var row = el('div', 'row');
    var del = el('button', null, 'delete line');
    del.addEventListener('click', function () { game.removeLine(selectedLine); flash(name + ' line closed'); selectedLine = -1; renderSidebar(); updateStatus(); dirty = true; });
    row.appendChild(del);
    ed.appendChild(row);
  }

  function updateStatus() {
    var G = game.state;
    $('score').textContent = G.score;
    $('dayname').textContent = game.dayName();
    $('weekno').textContent = 'Week ' + (G.week + 1) + ' · Day ' + (G.day + 1);
    $('ledger-count').textContent = G.score ? G.score + ' delivered · ' + game.waiting() + ' waiting' : '';
    if (THUMB) badge.textContent = game.dayName() + ' · week ' + (G.week + 1) + ' · ' + G.score + ' books delivered';
  }

  function buildDial() {
    var g = $('dial-ticks');
    for (var i = 0; i < 12; i++) {
      var a = i * Math.PI / 6, r1 = i % 3 === 0 ? 20 : 22.5, r2 = 25;
      var l = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      l.setAttribute('x1', 27 + Math.sin(a) * r1); l.setAttribute('y1', 27 - Math.cos(a) * r1);
      l.setAttribute('x2', 27 + Math.sin(a) * r2); l.setAttribute('y2', 27 - Math.cos(a) * r2);
      g.appendChild(l);
    }
  }
  var lastDial = -1;
  function updateDial() {
    var G = game.state, f = (G.time % G.rules.dayLen) / G.rules.dayLen;
    var deg = Math.round(f * 360);
    if (deg === lastDial) return;
    lastDial = deg;
    $('dial-hand').setAttribute('transform', 'rotate(' + deg + ' 27 27)');
    // week progress arc
    var wf = ((G.day % G.rules.daysPerWeek) + f) / G.rules.daysPerWeek, a = wf * Math.PI * 2 - Math.PI / 2, r = 21.5;
    var x = 27 + Math.cos(a) * r, y = 27 + Math.sin(a) * r;
    $('dial-week').setAttribute('d', wf < 0.002 ? '' : 'M 27 ' + (27 - r) + ' A ' + r + ' ' + r + ' 0 ' + (wf > 0.5 ? 1 : 0) + ' 1 ' + x.toFixed(2) + ' ' + y.toFixed(2));
  }

  function addLedger(entry) {
    var ol = $('ledger'), empty = ol.querySelector('.empty'); if (empty) empty.remove();
    var li = el('li', REDUCED ? '' : 'new');
    var dot = el('i'); dot.style.background = genreColor(entry.book.g, 48); li.appendChild(dot);
    var span = el('span'); span.appendChild(document.createTextNode('Delivered: '));
    var a = el('a', null, entry.book.t); a.href = '../../#/bookshelf/' + encodeURIComponent(entry.book.id); a.title = (entry.book.a ? entry.book.a + ' · ' : '') + (entry.book.y || '') + ' · ' + entry.book.s + (entry.transfers ? ' · changed trains ' + entry.transfers + '×' : '');
    span.appendChild(a); span.appendChild(document.createTextNode(' → '));
    span.appendChild(el('span', 'to', entry.destName)); li.appendChild(span);
    ol.insertBefore(li, ol.firstChild);
    while (ol.children.length > 60) ol.removeChild(ol.lastChild);
  }

  // ---- Upgrades --------------------------------------------------------------------

  var UPG = {
    train: { name: 'Locomotive', blurb: 'One more train, sent to the busiest line.', icon: '<rect x="4" y="8" width="36" height="14" rx="4" fill="#e8b33a"/><rect x="9" y="12" width="5" height="6" fill="#fff6c8"/><rect x="17" y="12" width="5" height="6" fill="#fff6c8"/><rect x="25" y="12" width="5" height="6" fill="#fff6c8"/><circle cx="12" cy="25" r="3" fill="#ece5d4"/><circle cx="32" cy="25" r="3" fill="#ece5d4"/>' },
    tunnel: { name: 'Tunnel', blurb: 'One more crossing of the river between the English and Japanese cases.', icon: '<path d="M4 26 Q22 -6 40 26" fill="none" stroke="#9fc4d0" stroke-width="5"/><rect x="14" y="16" width="16" height="10" rx="2" fill="#e8b33a"/>' },
    carriage: { name: 'Carriage', blurb: 'Six more seats, coupled to the most crowded train.', icon: '<rect x="2" y="9" width="18" height="12" rx="3" fill="#e8b33a"/><rect x="24" y="9" width="18" height="12" rx="3" fill="#e8b33a"/><rect x="20" y="13" width="4" height="4" fill="#ece5d4"/>' },
    interchange: { name: 'Interchange', blurb: 'Choose a station: it holds fourteen books before overcrowding.', icon: '<circle cx="22" cy="15" r="11" fill="none" stroke="#ece5d4" stroke-width="2.5"/><circle cx="22" cy="15" r="6.5" fill="none" stroke="#ece5d4" stroke-width="2.5"/>' },
  };
  function showUpgrade() {
    var P = game.state.pending; if (!P) return;
    if (THUMB) return;
    $('upgrade-title').textContent = 'End of week ' + P.week;
    $('upgrade-text').textContent = game.state.score + ' books delivered so far. Choose one for the coming week.';
    var box = $('choices'); box.innerHTML = '';
    P.choices.forEach(function (k) {
      var b = el('button'); var d = UPG[k];
      b.innerHTML = '<svg viewBox="0 0 44 30" aria-hidden="true">' + d.icon + '</svg><b>' + d.name + '</b><span>' + d.blurb + '</span>';
      b.addEventListener('click', function () { game.choose(k); $('upgrade').classList.remove('show'); drainEvents(); renderSidebar(); dirty = true; });
      box.appendChild(b);
    });
    $('upgrade-note').textContent = P.newLine ? 'A new line colour has also been unlocked: ' + M.LINE_COLORS[game.state.linesUnlocked - 1].name + '.' : 'All six lines are already unlocked.';
    $('upgrade').classList.add('show');
    setTimeout(function () { var f = box.querySelector('button'); if (f) f.focus(); }, 0);
  }
  function showPlacing() {
    if (THUMB) return;
    banner.innerHTML = '';
    banner.appendChild(document.createTextNode('Choose a station to become an interchange'));
    var auto = el('button', null, 'let the game pick');
    auto.addEventListener('click', function () { game.placeInterchange(game.busiestStation().id); drainEvents(); dirty = true; });
    banner.appendChild(auto);
    banner.classList.add('show');
    dirty = true;
  }
  function showGameOver() {
    var G = game.state, st = G.stations[G.overStation];
    if (THUMB) return;
    $('go-text').textContent = st.name + ' overflowed on ' + game.dayName().toLowerCase() + ' of week ' + (G.week + 1) + ' with ' + st.waiting.length + ' books waiting.';
    $('go-score').textContent = G.score + ' books delivered';
    var stats = $('go-stats'); stats.innerHTML = '';
    var top = G.stationList.slice().sort(function (a, b) { return b.delivered - a.delivered; }).slice(0, 3);
    var rows = [['Days run', G.day + 1], ['Books that boarded', G.spawned], ['Still waiting', game.waiting() + ' at stations, ' + game.aboard() + ' on trains'], ['Trains', G.trains.length + ' · ' + G.tunnels + ' tunnel' + (G.tunnels === 1 ? '' : 's')], ['Busiest arrivals', top.map(function (s) { return s.name + ' (' + s.delivered + ')'; }).join(', ')]];
    if (G.ledger.length) { var last = G.ledger[G.ledger.length - 1]; rows.push(['Last delivered', last.book.t + ' → ' + last.destName]); }
    rows.forEach(function (r) { stats.appendChild(el('b', null, r[0])); stats.appendChild(el('span', null, String(r[1]))); });
    $('gameover').classList.add('show');
    setTimeout(function () { $('go-again').focus(); }, 0);
  }

  // ---- Legend (service map) ------------------------------------------------------

  function renderLegend() {
    var list = $('legend-list'); list.innerHTML = '';
    var sel = svcHoverGenre || svcGenre;
    $('legend-info').textContent = svc.lines.length + ' lines · ' + books.length + ' books';
    svc.genres.forEach(function (g) {
      var b = el('button', 'g'); b.style.setProperty('--c', g.color);
      b.classList.toggle('on', svcGenre === g.name); b.classList.toggle('dim', !!sel && sel !== g.name);
      b.appendChild(el('i'));
      b.appendChild(el('span', 'nm', g.name));
      b.appendChild(el('span', 'ct', g.total + (g.stops.length >= 2 ? '' : g.stops.length === 1 ? ' · one stop' : ' · no stop')));
      b.title = g.name + ': ' + g.total + ' books' + (g.stops.length ? ', on ' + g.stops.map(function (u) { return UNIT_BY_ID[u].name + ' (' + g.units[u].length + ')'; }).join(', ') : '');
      b.addEventListener('click', function () { svcGenre = svcGenre === g.name ? null : g.name; renderLegend(); dirty = true; });
      list.appendChild(b);
    });
  }

  // ---- Search ----------------------------------------------------------------------

  var searchIndex = null;
  function runSearch(q) {
    var box = $('results');
    var f = fold(q.trim());
    if (!f) { box.classList.remove('show'); return; }
    if (!searchIndex) searchIndex = books.map(function (b) { return { b: b, t: fold(b.t), a: fold(b.a) }; });
    var hits = [];
    for (var i = 0; i < searchIndex.length && hits.length < 60; i++) {
      var e = searchIndex[i], ti = e.t.indexOf(f), ai = e.a.indexOf(f);
      if (ti >= 0 || ai >= 0) hits.push({ b: e.b, score: (ti === 0 ? 0 : ti > 0 ? 1 : 2) + (e.t.length / 1000) });
    }
    hits.sort(function (a, b) { return a.score - b.score; });
    box.innerHTML = '';
    if (!hits.length) { box.appendChild(el('div', 'none', 'No book matches "' + q.trim() + '".')); box.classList.add('show'); return; }
    hits.slice(0, 8).forEach(function (h) {
      var b = h.b, btn = el('button');
      btn.appendChild(document.createTextNode(b.t));
      btn.appendChild(el('span', 'm', [b.a, b.y, UNIT_BY_ID[b.u].name + ' · ' + b.s].filter(Boolean).join(' · ')));
      btn.addEventListener('click', function () { focusBook(b); box.classList.remove('show'); });
      box.appendChild(btn);
    });
    if (hits.length > 8) box.appendChild(el('div', 'none', '+' + (hits.length - 8) + ' more; keep typing.'));
    box.classList.add('show');
  }
  function focusBook(b) {
    highlight = { book: b, until: performance.now() + 7000 };
    if (mode === 'play') {
      if (!game.state.over) { game.queue(b); flash('Next passenger: ' + b.t + ' → ' + UNIT_BY_ID[b.u].name); }
      else flash(b.t + ' lives on the ' + UNIT_BY_ID[b.u].name);
    } else {
      svcGenre = b.g; renderLegend();
      flash(b.t + ' · ' + UNIT_BY_ID[b.u].name + ' · ' + b.s);
    }
    dirty = true;
  }
})();
