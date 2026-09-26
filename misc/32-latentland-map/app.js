/* Latentland Map: the page.
 *
 * world.js supplies the content (hexes, route, regions, rivers), geo.js the
 * pure geometry; this file owns the DOM: it draws the map as layered SVG,
 * runs the two modes (Story and Expedition), the reading pane, search,
 * onboarding, the hash and localStorage.
 *
 * Map layers, bottom to top: land base, seas, coast hatching, graticule,
 * terrain tints (blurred so terrain reads as regions), hex outlines, rivers
 * and the road (ghost / pencil / ink, masked by fog), wilderness and hex
 * glyphs, the story route, region and water names, place labels, markers,
 * and finally invisible hit polygons.
 */
(function () {
  "use strict";
  var W = window.LATENTLAND, G = window.LLGEO;
  if (!W || !G) { document.getElementById("fallback").className = "show"; return; }

  // ---------- constants ----------
  var S = 48;                                   // hex radius in map units
  var NS = "http://www.w3.org/2000/svg";
  var STORE = "latentland-map.v2";
  var LEGACY_STORE = "latentland-map.v1";
  var PAPER = "#ecdfbd", INK = "#2a1f14", PENCIL = "#5a4632", WATER = "#b9cfd4", WATER_INK = "#4e6e78", OCHRE = "#9d3f27";
  var TINT = { plain: "#e8d9a6", city: "#e2c49c", forest: "#b9c58f", river: "#c9d9d6", ruin: "#d9c6ad", mountain: "#d2c0a3", sea: "#b9cfd4" };
  var KMIN = 0.35, KMAX = 3.2;
  var MOVE_KEYS = { q: 2, w: 1, e: 0, a: 3, s: 4, d: 5, "7": 2, "9": 1, "6": 0, "4": 3, "1": 4, "3": 5 };
  var LAST = W.ROUTE[W.ROUTE.length - 1];
  var TOTAL = W.HEXES.length;

  // ---------- state ----------
  function freshStory() { return { started: false, step: -1, explored: [W.START], visited: [] }; }
  function freshExp() { return { pos: W.START, tokens: W.BUDGET, explored: [W.START], visited: [W.START], caches: [], read: [], ended: false, reached: false, history: [] }; }
  var st = { mode: "story", onboarded: false, tab: "entry", story: freshStory(), exp: freshExp() };
  var sel = null;                 // the hex whose entry is open
  var view = { k: 1, tx: 0, ty: 0 };
  function setView(t) {
    if (!isFinite(t.k) || !isFinite(t.tx) || !isFinite(t.ty)) return; // never let a bad frame poison the view
    view.k = t.k; view.tx = t.tx; view.ty = t.ty;
  }
  var hexEls = {}, maskEls = {}, labelEls = {}, tintEls = {}, regionEls = {}, badgeEls = {};
  var lastFog = {};
  var anim = null;

  function save() { try { localStorage.setItem(STORE, JSON.stringify(st)); } catch (e) { /* private mode */ } }
  function validIds(list) { return (list || []).filter(function (id) { return W.byId[id]; }); }
  function load() {
    try {
      var raw = localStorage.getItem(STORE);
      if (!raw) {
        // a visitor of the first version keeps their fog
        var old = localStorage.getItem(LEGACY_STORE);
        if (old) { var o = JSON.parse(old); if (o && o.explored) { st.story.explored = validIds(o.explored); st.story.visited = validIds(o.visited); st.story.started = st.story.visited.length > 1; if (st.story.started) st.story.step = Math.max.apply(null, st.story.explored.map(function (id) { return W.byId[id].routeIndex; })); } }
        return;
      }
      var s = JSON.parse(raw);
      if (!s || typeof s !== "object") return;
      st.mode = s.mode === "expedition" ? "expedition" : "story";
      st.onboarded = !!s.onboarded;
      st.tab = /^(entry|contents|journal)$/.test(s.tab) ? s.tab : "entry";
      if (s.story) {
        st.story = { started: !!s.story.started, step: typeof s.story.step === "number" ? s.story.step : -1, explored: validIds(s.story.explored), visited: validIds(s.story.visited) };
        if (st.story.explored.indexOf(W.START) < 0) st.story.explored.unshift(W.START);
      }
      if (s.exp && W.byId[s.exp.pos]) {
        var e = s.exp;
        st.exp = { pos: e.pos, tokens: typeof e.tokens === "number" ? e.tokens : W.BUDGET, explored: validIds(e.explored), visited: validIds(e.visited), caches: validIds(e.caches), read: e.read || [], ended: !!e.ended, reached: !!e.reached, history: Array.isArray(e.history) ? e.history.slice(-30) : [] };
        if (st.exp.explored.indexOf(st.exp.pos) < 0) st.exp.explored.push(st.exp.pos);
        if (!st.exp.visited.length) st.exp.visited = [st.exp.pos];
      }
    } catch (e) { /* ignore a corrupt store */ }
  }
  function cur() { return st.mode === "story" ? st.story : st.exp; }
  function isExplored(id) { return cur().explored.indexOf(id) >= 0; }
  function fogState(id) {
    if (isExplored(id)) return "explored";
    var ns = W.neighbourIds(id);
    for (var i = 0; i < ns.length; i++) if (isExplored(ns[i])) return "frontier";
    return "unexplored";
  }

  // ---------- svg helpers ----------
  function el(name, attrs, parent) {
    var e = document.createElementNS(NS, name);
    for (var k in attrs) if (attrs.hasOwnProperty(k)) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function centreOf(h) { return G.centre(h.q, h.r, S); }
  function polyPoints(cx, cy, s) { return G.corners(cx, cy, s).map(function (p) { return p.x.toFixed(1) + "," + p.y.toFixed(1); }).join(" "); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function $(id) { return document.getElementById(id); }

  // ---------- world geometry ----------
  var cellsAll = W.HEXES.map(function (h) { return { q: h.q, r: h.r }; });
  var occupied = {};
  cellsAll.forEach(function (c) { occupied[c.q + "," + c.r] = true; });
  function neighboursOfCell(c) { return G.EDGE_DIRS.map(function (d) { return { q: c.q + d.q, r: c.r + d.r }; }); }

  // Interior empty cells: empty cells that cannot reach the outside of an
  // enlarged bounding box without crossing a hex. They become nameless
  // wilderness so the landmass has no holes.
  var interior = (function () {
    var qs = cellsAll.map(function (c) { return c.q; }), rs = cellsAll.map(function (c) { return c.r; });
    var rmin = Math.min.apply(null, rs) - 2, rmax = Math.max.apply(null, rs) + 2;
    var qmin = Math.min.apply(null, qs) - 8, qmax = Math.max.apply(null, qs) + 8;
    var outside = {}, stack = [];
    for (var r = rmin; r <= rmax; r++) for (var q = qmin; q <= qmax; q++) {
      if (r === rmin || r === rmax || q === qmin || q === qmax) { var k = q + "," + r; if (!occupied[k]) { outside[k] = true; stack.push({ q: q, r: r }); } }
    }
    while (stack.length) {
      var c = stack.pop();
      neighboursOfCell(c).forEach(function (n) {
        if (n.q < qmin || n.q > qmax || n.r < rmin || n.r > rmax) return;
        var k = n.q + "," + n.r;
        if (occupied[k] || outside[k]) return;
        outside[k] = true; stack.push(n);
      });
    }
    var res = [];
    for (var r2 = rmin; r2 <= rmax; r2++) for (var q2 = qmin; q2 <= qmax; q2++) { var k2 = q2 + "," + r2; if (!occupied[k2] && !outside[k2]) res.push({ q: q2, r: r2 }); }
    return res;
  })();
  var landCells = cellsAll.concat(interior);
  var landLoops = G.outline(landCells, S);
  var landOuter = landLoops.reduce(function (a, b) { return a.length > b.length ? a : b; });

  // Seas: each named sea is its hexes plus the empty cells around them; the
  // open sea (Corpus) reaches one ring further into the void.
  var seaCellsById = {};
  W.SEAS.forEach(function (sea) {
    var members = [], seen = {}, stack = [sea.anchor];
    seen[sea.anchor] = true;
    while (stack.length) { var id = stack.pop(); members.push(W.byId[id]); W.neighbourIds(id).forEach(function (n) { if (!seen[n] && W.byId[n].terrain === "sea") { seen[n] = true; stack.push(n); } }); }
    var cells = members.map(function (h) { return { q: h.q, r: h.r }; }), cellSet = {};
    cells.forEach(function (c) { cellSet[c.q + "," + c.r] = true; });
    var isInterior = function (n) { return interior.some(function (c) { return c.q === n.q && c.r === n.r; }); };
    var candidates = [];
    cells.forEach(function (c) { neighboursOfCell(c).forEach(function (n) { var k = n.q + "," + n.r; if (!occupied[k] && !cellSet[k]) { cellSet[k] = true; candidates.push(n); } }); });
    // a sea is open when it borders the void directly; a lake keeps only its interior pockets
    var open = candidates.some(function (n) { return !isInterior(n); }) && candidates.filter(function (n) { return !isInterior(n); }).length >= 3;
    var ring1 = candidates.filter(function (n) { return open || isInterior(n); });
    candidates.forEach(function (n) { if (ring1.indexOf(n) < 0) delete cellSet[n.q + "," + n.r]; });
    var ring2 = [];
    if (open) ring1.forEach(function (c) { if (isInterior(c)) return; neighboursOfCell(c).forEach(function (n) { var k = n.q + "," + n.r; if (occupied[k] || cellSet[k]) return; var touchesLand = neighboursOfCell(n).some(function (m) { return occupied[m.q + "," + m.r]; }); if (touchesLand) return; cellSet[k] = true; ring2.push(n); }); });
    seaCellsById[sea.id] = { cells: cells.concat(ring1, ring2), hexes: members, open: open };
  });

  // Bounds of everything drawn, with a margin of void around it.
  var bounds = (function () {
    var minx = 1e9, miny = 1e9, maxx = -1e9, maxy = -1e9;
    var all = landCells.slice();
    Object.keys(seaCellsById).forEach(function (k) { all = all.concat(seaCellsById[k].cells); });
    all.forEach(function (c) { var p = G.centre(c.q, c.r, S); minx = Math.min(minx, p.x); maxx = Math.max(maxx, p.x); miny = Math.min(miny, p.y); maxy = Math.max(maxy, p.y); });
    return { minx: minx - 2.6 * S, maxx: maxx + 2.6 * S, miny: miny - 2.4 * S, maxy: maxy + 2.4 * S };
  })();
  var landBounds = (function () {
    var minx = 1e9, miny = 1e9, maxx = -1e9, maxy = -1e9;
    var pts = W.HEXES.map(centreOf);
    Object.keys(seaCellsById).forEach(function (k) { seaCellsById[k].cells.forEach(function (c) { pts.push(G.centre(c.q, c.r, S)); }); });
    pts.forEach(function (p) { minx = Math.min(minx, p.x); maxx = Math.max(maxx, p.x); miny = Math.min(miny, p.y); maxy = Math.max(maxy, p.y); });
    return { minx: minx - 1.2 * S, maxx: maxx + 1.4 * S, miny: miny - 1.1 * S, maxy: maxy + 1.3 * S };
  })();

  // ---------- build the map ----------
  var svg = $("map");
  var defs = el("defs", {}, svg);
  var rnd = G.rng(G.hashStr("latentland"));

  // hatching for the coast, wave pattern for shores
  var pHatch = el("pattern", { id: "p-hatch", width: 7, height: 7, patternUnits: "userSpaceOnUse", patternTransform: "rotate(35)" }, defs);
  el("path", { d: "M0,3.5 H7", stroke: INK, "stroke-width": 0.7, opacity: 0.55 }, pHatch);
  var pWave = el("pattern", { id: "p-wave", width: 16, height: 7, patternUnits: "userSpaceOnUse" }, defs);
  el("path", { d: "M0,4 q4,-3.2 8,0 t8,0", fill: "none", stroke: WATER_INK, "stroke-width": 0.7, opacity: 0.55 }, pWave);
  var fSoft = el("filter", { id: "f-soft", x: "-20%", y: "-20%", width: "140%", height: "140%" }, defs);
  el("feGaussianBlur", { stdDeviation: 7 }, fSoft);
  var fBlur = el("filter", { id: "f-blur", x: "-20%", y: "-20%", width: "140%", height: "140%" }, defs);
  el("feGaussianBlur", { stdDeviation: 9 }, fBlur);

  function wobblyLoopPath(loop, amp) { return G.pathOf(G.catmull(G.wobble(loop, amp, rnd, true, 2), true, 5), true); }
  var landPath = wobblyLoopPath(landOuter, S * 0.16);
  var seaPaths = {};
  Object.keys(seaCellsById).forEach(function (id) {
    seaPaths[id] = G.outline(seaCellsById[id].cells, S).map(function (loop) { return wobblyLoopPath(loop, S * 0.2); }).join(" ");
  });
  var allSeaPath = Object.keys(seaPaths).map(function (k) { return seaPaths[k]; }).join(" ");

  // masks: the void (outside land and sea), near-land (for shore ink), and the fog masks
  var mVoid = el("mask", { id: "m-void", maskUnits: "userSpaceOnUse", x: bounds.minx, y: bounds.miny, width: bounds.maxx - bounds.minx, height: bounds.maxy - bounds.miny }, defs);
  el("rect", { x: bounds.minx, y: bounds.miny, width: bounds.maxx - bounds.minx, height: bounds.maxy - bounds.miny, fill: "#fff" }, mVoid);
  el("path", { d: landPath, fill: "#000" }, mVoid);
  el("path", { d: allSeaPath, fill: "#000", "fill-rule": "evenodd" }, mVoid);
  var mSeaFade = el("mask", { id: "m-seafade", maskUnits: "userSpaceOnUse", x: bounds.minx, y: bounds.miny, width: bounds.maxx - bounds.minx, height: bounds.maxy - bounds.miny }, defs);
  el("path", { d: allSeaPath, fill: "#fff", "fill-rule": "evenodd" }, mSeaFade);
  el("path", { d: landPath, fill: "#000", stroke: "#000", "stroke-width": 56 }, mSeaFade);
  var mNear = el("mask", { id: "m-near", maskUnits: "userSpaceOnUse", x: bounds.minx, y: bounds.miny, width: bounds.maxx - bounds.minx, height: bounds.maxy - bounds.miny }, defs);
  el("path", { d: landPath, fill: "#fff", stroke: "#fff", "stroke-width": 10 }, mNear);
  var mExplored = el("mask", { id: "m-explored", "class": "fogmask", maskUnits: "userSpaceOnUse", x: bounds.minx, y: bounds.miny, width: bounds.maxx - bounds.minx, height: bounds.maxy - bounds.miny }, defs);
  var mFrontier = el("mask", { id: "m-frontier", "class": "fogmask", maskUnits: "userSpaceOnUse", x: bounds.minx, y: bounds.miny, width: bounds.maxx - bounds.minx, height: bounds.maxy - bounds.miny }, defs);
  W.HEXES.forEach(function (h) {
    var c = centreOf(h);
    maskEls[h.id] = {
      e: el("polygon", { points: polyPoints(c.x, c.y, S + 3), fill: "#fff", opacity: 0 }, mExplored),
      f: el("polygon", { points: polyPoints(c.x, c.y, S + 3), fill: "#fff", opacity: 0 }, mFrontier)
    };
  });

  var world = el("g", { id: "world" }, svg);

  // land and seas
  el("path", { d: landPath, fill: "#f0e4c4" }, world);
  var seaG = el("g", {}, world);
  Object.keys(seaPaths).forEach(function (id) {
    el("path", { d: seaPaths[id], fill: WATER, "fill-rule": "evenodd" }, seaG);
    el("path", { d: seaPaths[id], fill: "none", stroke: "url(#p-wave)", "stroke-width": 12, mask: "url(#m-near)", opacity: 0.9 }, seaG);
    el("path", { d: seaPaths[id], fill: "none", stroke: WATER_INK, "stroke-width": 1, mask: "url(#m-near)" }, seaG);
    if (seaCellsById[id].open) el("path", { d: seaPaths[id], fill: "none", stroke: PAPER, "stroke-width": 44, opacity: 0.9, mask: "url(#m-seafade)", filter: "url(#f-blur)" }, seaG);
  });
  // coast: hatched band on the void side, then the ink shoreline
  el("path", { d: landPath, fill: "none", stroke: "url(#p-hatch)", "stroke-width": 18, mask: "url(#m-void)" }, world);
  el("path", { d: landPath, fill: "none", stroke: INK, "stroke-width": 1.1, "stroke-linejoin": "round" }, world);

  // graticule
  var grat = el("g", { stroke: INK, "stroke-width": 0.5, opacity: 0.1, fill: "none" }, world);
  (function () {
    var step = S * 2.25, d = "";
    for (var x = Math.ceil(bounds.minx / step) * step; x < bounds.maxx; x += step) d += "M" + x + "," + bounds.miny + "V" + bounds.maxy;
    for (var y = Math.ceil(bounds.miny / step) * step; y < bounds.maxy; y += step) d += "M" + bounds.minx + "," + y + "H" + bounds.maxx;
    el("path", { d: d }, grat);
  })();

  // terrain tints, softened so terrain reads as regions rather than tiles
  var tintG = el("g", { filter: "url(#f-soft)" }, world);
  W.HEXES.forEach(function (h) {
    if (h.terrain === "sea") return;
    var c = centreOf(h);
    tintEls[h.id] = el("polygon", { "class": "tint fog-unexplored", points: polyPoints(c.x, c.y, S * 0.98), fill: TINT[h.terrain] }, tintG);
  });
  // faint hex outlines
  (function () {
    var d = "";
    W.HEXES.forEach(function (h) { var c = centreOf(h); var ps = G.corners(c.x, c.y, S); d += "M" + ps.map(function (p) { return p.x.toFixed(1) + "," + p.y.toFixed(1); }).join("L") + "Z"; });
    el("path", { d: d, fill: "none", stroke: INK, "stroke-width": 0.5, opacity: 0.085 }, world);
  })();

  // rivers: a jittered centreline through the hexes, then a tapering ribbon
  function riverLine(ids, seed, amp) {
    var r = G.rng(G.hashStr(seed)), pts = [];
    ids.forEach(function (id, i) {
      var c = centreOf(W.byId[id]);
      pts.push({ x: c.x + (r() - 0.5) * amp, y: c.y + (r() - 0.5) * amp });
      if (i < ids.length - 1) {
        var n = centreOf(W.byId[ids[i + 1]]);
        var mx = (c.x + n.x) / 2, my = (c.y + n.y) / 2, dx = n.x - c.x, dy = n.y - c.y, len = Math.hypot(dx, dy) || 1;
        var w = (r() - 0.5) * amp * 1.2;
        pts.push({ x: mx - dy / len * w, y: my + dx / len * w });
      }
    });
    return pts;
  }
  var mainPts = riverLine(W.RIVER.main, "residual", S * 0.5);
  var tribPts = riverLine(W.RIVER.tributary, "tributary", S * 0.45);
  tribPts[0] = mainPts[2];  // the tributary leaves the river at the headwaters point
  var mainDense = G.catmull(mainPts, false, 8), tribDense = G.catmull(tribPts, false, 8);
  var riverBody = G.ribbon(mainDense, 1.2, S * 0.26) + " " + G.ribbon(tribDense, S * 0.07, S * 0.04);
  // small strands feeding the tributary from the nameless country
  var strandsD = (function () {
    var d = "", r = G.rng(G.hashStr("strands")), join = tribPts[4];
    for (var i = 0; i < 4; i++) {
      var a = Math.PI * (1.05 + i * 0.16), len = S * (0.9 + r() * 0.5);
      var from = { x: join.x + Math.cos(a) * len, y: join.y + Math.sin(a) * len };
      var mid = { x: (from.x + join.x) / 2 + (r() - 0.5) * S * 0.3, y: (from.y + join.y) / 2 + (r() - 0.5) * S * 0.3 };
      d += G.pathOf(G.catmull([from, mid, join], false, 6), false);
    }
    return d;
  })();
  var roadPts = G.catmull(riverLine(W.ROAD, "road", S * 0.3), false, 8);
  var roadD = G.pathOf(roadPts, false);
  function waterLayer(parent, mask, style) {
    var g = el("g", mask ? { mask: mask } : {}, parent);
    el("path", { d: riverBody, fill: style.fill, stroke: style.stroke, "stroke-width": style.w, "stroke-linejoin": "round", opacity: style.o }, g);
    el("path", { d: strandsD, fill: "none", stroke: style.stroke, "stroke-width": style.w * 0.8, "stroke-linecap": "round", opacity: style.o }, g);
    el("path", { d: roadD, fill: "none", stroke: style.road, "stroke-width": 1.3, "stroke-dasharray": "5 3.5", "stroke-linecap": "round", opacity: style.o }, g);
    return g;
  }
  waterLayer(world, null, { fill: "none", stroke: INK, w: 0.7, o: 0.16, road: INK });                       // ghost: the surveyor's faint impression
  waterLayer(world, "url(#m-frontier)", { fill: "none", stroke: PENCIL, w: 0.9, o: 0.5, road: PENCIL });   // pencil: in sight
  waterLayer(world, "url(#m-explored)", { fill: WATER, stroke: WATER_INK, w: 1, o: 1, road: "#5a4632" }); // ink: explored

  // wilderness in the interior voids (never named, always faintly there)
  var wildG = el("g", { "class": "wild" }, world);
  interior.forEach(function (c, i) {
    var p = G.centre(c.q, c.r, S);
    var kind = i % 3 === 0 ? "forest" : i % 3 === 1 ? "mountain" : "plain";
    var g = el("g", {}, wildG);
    G.glyphsFor(kind, p.x, p.y - S * 0.05, S * 0.9, 1, "wild" + c.q + "," + c.r).forEach(function (s) { el("path", { d: s.d, "class": s.k }, g); });
  });
  // the serpent in the open sea
  (function () {
    var sea = seaCellsById.corpus; if (!sea) return;
    var far = sea.cells[sea.cells.length - 1], p = G.centre(far.q, far.r, S);
    var g = el("g", { "class": "wild", opacity: 0.8 }, world);
    G.serpent(p.x, p.y + S * 0.2, S).forEach(function (s) { el("path", { d: s.d, "class": s.k }, g); });
  })();

  // hex glyphs
  var glyphG = el("g", {}, world);
  W.HEXES.forEach(function (h) {
    var c = centreOf(h);
    var g = el("g", { "class": "hex fog-unexplored", "data-id": h.id }, glyphG);
    var parts = G.glyphsFor(h.terrain, c.x, c.y - S * 0.08, S, h.importance, h.id);
    parts.forEach(function (s) { el("path", { d: s.d, "class": s.k }, g); });
    hexEls[h.id] = { g: g, c: c, h: h };
  });

  // story route
  var routeG = el("g", {}, world);
  var routePath = el("path", { id: "route" }, routeG);
  var routeNext = el("path", { id: "routenext" }, routeG);
  var routeArrow = el("path", { id: "routearrow" }, routeG);
  var routeDense = (function () {
    var pts = W.ROUTE.map(function (id) { return centreOf(W.byId[id]); });
    return G.catmull(pts, false, 8);
  })();

  // region, water and void names on gentle arcs
  var nameG = el("g", {}, world);
  function arcD(cx, cy, width, bulge) { return "M" + (cx - width / 2) + "," + cy + " Q" + cx + "," + (cy - width * bulge) + " " + (cx + width / 2) + "," + cy; }
  function arcLabel(text, cx, cy, width, tilt, cls, id, bulge) {
    bulge = bulge == null ? 0.06 : bulge;
    var p = el("path", { id: "arc-" + id, d: arcD(cx, cy, width, bulge), fill: "none", transform: "rotate(" + tilt + " " + cx + " " + cy + ")" }, defs);
    var t = el("text", { "class": cls }, nameG);
    var tp = el("textPath", { href: "#arc-" + id, startOffset: "50%", "text-anchor": "middle" }, t);
    tp.setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", "#arc-" + id);
    tp.textContent = text;
    t._fit = function () { // widen the arc to the measured text so nothing is clipped
      try { var len = tp.getComputedTextLength(); if (len > 0) p.setAttribute("d", arcD(cx, cy, Math.max(width, len * 1.12), bulge)); } catch (e) { /* not rendered yet */ }
    };
    return t;
  }
  W.REGIONS.forEach(function (rg) {
    if (W.SEAS.some(function (s) { return s.name === rg.name; })) return;
    var xs = 0, ys = 0, minx = 1e9, maxx = -1e9;
    rg.hexes.forEach(function (id) { var c = centreOf(W.byId[id]); xs += c.x; ys += c.y; minx = Math.min(minx, c.x); maxx = Math.max(maxx, c.x); });
    var n = rg.hexes.length, cx = xs / n, cy = ys / n;
    // sit in the glyph band of the nearest hex row, between two rows of place names
    if (Math.abs(rg.tilt) < 45) cy = Math.round(cy / (S * 1.5)) * (S * 1.5) + S * 0.14;
    var width = Math.max(rg.name.length * 19, Math.abs(rg.tilt) > 45 ? rg.name.length * 19 : maxx - minx + S);
    // the layout fades the name out whenever a place label on show would overlap it
    regionEls[rg.id] = { a: arcLabel(rg.name, cx, cy, width, rg.tilt, "region", rg.id, 0.045) };
  });
  W.SEAS.forEach(function (sea) {
    var cells = seaCellsById[sea.id].cells, xs = 0, ys = 0;
    cells.forEach(function (c) { var p = G.centre(c.q, c.r, S); xs += p.x; ys += p.y; });
    var cx = xs / cells.length, cy = ys / cells.length;
    if (seaCellsById[sea.id].open) { cx -= S * 0.3; cy -= S * 0.4; }
    arcLabel(sea.name, cx, cy + 4, sea.name.length * 15, seaCellsById[sea.id].open ? -22 : 0, "water-name", "sea-" + sea.id, 0.08);
  });
  arcLabel("Terra incognita", landBounds.maxx - S * 3.6, landBounds.maxy - S * 1.0, 220, -4, "void-name", "void1", 0.02);
  arcLabel("Hic sunt dracones", landBounds.minx + S * 5.2, landBounds.maxy + S * 0.6, 240, 4, "void-name", "void2", 0.02);

  // place labels
  var labelG = el("g", {}, world);
  W.HEXES.forEach(function (h) {
    var c = centreOf(h), lines = G.splitLabel(h.short, 12);
    var t = el("text", { "class": "lbl", x: c.x, y: c.y + S * 0.52, opacity: 0 }, labelG);
    var spans = lines.map(function (line, i) { var ts = el("tspan", { x: c.x, dy: i === 0 ? 0 : "1.05em" }, t); ts.textContent = line; return ts; });
    labelEls[h.id] = { t: t, spans: spans, lines: lines, c: c, shown: false, size: 0 };
  });

  // markers: current position ring (expedition), selection ring, cost badges
  var markG = el("g", {}, world);
  var selRing = el("polygon", { "class": "selring", points: polyPoints(0, 0, S - 2), opacity: 0 }, markG);
  var posRing = el("g", { opacity: 0 }, markG);
  el("circle", { "class": "ring", r: S * 0.3 }, posRing);
  el("circle", { "class": "ring2", r: S * 0.42 }, posRing);
  el("circle", { r: 3, fill: OCHRE }, posRing);
  W.HEXES.forEach(function (h) {
    var c = centreOf(h);
    var g = el("g", { "class": "badge", transform: "translate(" + (c.x + S * 0.42) + "," + (c.y - S * 0.5) + ")", opacity: 0 }, markG);
    el("circle", { r: 8 }, g);
    var t = el("text", { y: 3.2 }, g);
    badgeEls[h.id] = { g: g, t: t };
  });

  // hit polygons (on top, invisible)
  var hitG = el("g", {}, world);
  W.HEXES.forEach(function (h) {
    var c = centreOf(h);
    var p = el("polygon", { "class": "hit", points: polyPoints(c.x, c.y, S - 0.5), "data-id": h.id }, hitG);
    p.addEventListener("click", function () { if (!suppressClick) onHexClick(h.id); });
    p.addEventListener("pointerenter", function (ev) { onHexHover(h.id, ev); });
    p.addEventListener("pointermove", function (ev) { moveTip(ev); });
    p.addEventListener("pointerleave", function () { onHexHover(null); });
    hexEls[h.id].hit = p;
  });

  // ---------- rendering ----------
  function nextStopId() {
    if (st.mode !== "story") return null;
    var i = (sel && W.byId[sel].routeIndex >= 0) ? W.byId[sel].routeIndex : st.story.step;
    return i + 1 < W.ROUTE.length && i >= 0 ? W.ROUTE[i + 1] : null;
  }
  function render() {
    var nextId = nextStopId();
    var revealed = [];
    W.HEXES.forEach(function (h) {
      var f = fogState(h.id), e = hexEls[h.id];
      if (lastFog[h.id] !== f) {
        e.g.setAttribute("class", "hex fog-" + f + (f === "explored" && lastFog[h.id] ? " revealing" : ""));
        if (f === "explored" && lastFog[h.id]) revealed.push(e.g);
        tintEls[h.id] && tintEls[h.id].setAttribute("class", "tint fog-" + f);
        maskEls[h.id].e.setAttribute("opacity", f === "explored" ? 1 : 0);
        maskEls[h.id].f.setAttribute("opacity", f === "frontier" ? 1 : 0);
        e.hit.setAttribute("class", "hit" + (f === "unexplored" ? " dead" : ""));
        lastFog[h.id] = f;
      }
      // expedition cost badges on the places you could step to
      var b = badgeEls[h.id], showB = st.mode === "expedition" && !st.exp.ended && h.id !== st.exp.pos && W.isAdjacent(st.exp.pos, h.id) && f !== "unexplored";
      if (showB) { var mc = moveCost(h.id); b.t.textContent = mc.cost; b.g.setAttribute("class", "badge" + (mc.cost > st.exp.tokens ? " no" : "")); }
      b.g.setAttribute("opacity", showB ? 1 : 0);
    });
    if (revealed.length) setTimeout(function () { revealed.forEach(function (g) { g.classList.remove("revealing"); }); }, 500);
    // region names appear once any of their places is in sight
    W.REGIONS.forEach(function (rg) {
      var t = regionEls[rg.id]; if (!t) return;
      var on = rg.hexes.some(function (id) { return fogState(id) !== "unexplored"; });
      t.on = on;
    });
    // the story route between explored consecutive stops
    var d = "";
    for (var i = 1; i < W.ROUTE.length; i++) {
      if (!isExplored(W.ROUTE[i - 1]) || !isExplored(W.ROUTE[i])) continue;
      var seg = routeDense.slice((i - 1) * 8, i * 8 + 1);
      d += G.pathOf(seg, false);
    }
    routePath.setAttribute("d", d);
    var nd = "", ad = "";
    if (nextId && sel && W.isAdjacent(sel, nextId)) {
      var a = centreOf(W.byId[sel]), b2 = centreOf(W.byId[nextId]);
      var dx = b2.x - a.x, dy = b2.y - a.y, len = Math.hypot(dx, dy), ux = dx / len, uy = dy / len;
      var x0 = a.x + ux * S * 0.4, y0 = a.y + uy * S * 0.4, x1 = b2.x - ux * S * 0.55, y1 = b2.y - uy * S * 0.55;
      nd = "M" + x0 + "," + y0 + "L" + x1 + "," + y1;
      var px = -uy, py = ux, hs = 5;
      ad = "M" + (x1 + ux * 6) + "," + (y1 + uy * 6) + "L" + (x1 + px * hs) + "," + (y1 + py * hs) + "L" + (x1 - px * hs) + "," + (y1 - py * hs) + "Z";
    }
    routeNext.setAttribute("d", nd); routeArrow.setAttribute("d", ad);
    // markers
    if (sel) { var sc = centreOf(W.byId[sel]); selRing.setAttribute("transform", "translate(" + sc.x + "," + sc.y + ")"); selRing.setAttribute("opacity", 1); }
    else selRing.setAttribute("opacity", 0);
    if (st.mode === "expedition") { var pc = centreOf(W.byId[st.exp.pos]); posRing.setAttribute("transform", "translate(" + pc.x + "," + pc.y + ")"); posRing.setAttribute("opacity", 1); }
    else posRing.setAttribute("opacity", 0);
    layoutLabels();
    drawMinimap();
    renderPane();
    updateHash();
  }

  // Labels: constant-ish screen size, culled greedily by priority when they collide.
  var lastK = -1;
  function layoutLabels() {
    var k = view.k, f = Math.max(7.5, Math.min(15, 11 / k));
    var items = [], keys = [], nextId = nextStopId();
    W.HEXES.forEach(function (h) {
      var L = labelEls[h.id], fog = fogState(h.id);
      if (fog === "unexplored") { L.want = false; return; }
      var pr = h.importance * 10 + (fog === "explored" ? 15 : 0) + (h.routeIndex >= 0 ? 10 : 0);
      if (h.id === sel) pr = 100; else if (h.id === nextId) pr = 90; else if (st.mode === "expedition" && h.id === st.exp.pos) pr = 100;
      if (k < 0.5 && pr < 90) { L.want = false; return; }
      var maxLen = Math.max.apply(null, L.lines.map(function (s) { return s.length; }));
      var w = maxLen * f * 0.56 * k, hgt = L.lines.length * f * 1.05 * k;
      var sx = L.c.x * k + view.tx, sy = (L.c.y + S * 0.52 - f * 0.8) * k + view.ty;
      items.push({ x0: sx - w / 2, y0: sy, x1: sx + w / 2, y1: sy + hgt, priority: pr });
      keys.push(h.id);
      L.want = true; L.fog = fog;
    });
    var show = G.placeLabels(items, 3);
    var shown = {};
    keys.forEach(function (id, i) { shown[id] = show[i]; });
    W.HEXES.forEach(function (h) {
      var L = labelEls[h.id], on = !!(L.want && shown[h.id]);
      if (on !== L.shown) { L.t.setAttribute("opacity", on ? 1 : 0); L.shown = on; }
      if (on) {
        if (L.size !== f) { L.t.setAttribute("font-size", f); L.size = f; }
        var cls = "lbl" + (L.fog === "frontier" ? " pencil" : "") + (h.id === sel ? " sel" : "");
        if (L.cls !== cls) { L.t.setAttribute("class", cls); L.cls = cls; }
      }
    });
    // region names yield to the place labels on show: fade out when one would overlap
    var ro = k > 1.7 ? Math.max(0, 0.6 - (k - 1.7) * 0.6) : 0.6, pad = 4 / k;
    var boxes = [];
    keys.forEach(function (id, i) { if (!show[i]) return; var it = items[i]; boxes.push({ x0: (it.x0 - view.tx) / k, y0: (it.y0 - view.ty) / k, x1: (it.x1 - view.tx) / k, y1: (it.y1 - view.ty) / k }); });
    function clear(t) {
      var b = t._box; if (!b) return true;
      for (var i = 0; i < boxes.length; i++) { var o = boxes[i]; if (b.x0 < o.x1 + pad && b.x1 > o.x0 - pad && b.y0 < o.y1 + pad && b.y1 > o.y0 - pad) return false; }
      return true;
    }
    W.REGIONS.forEach(function (rg) {
      var t = regionEls[rg.id]; if (!t) return;
      var pick = null;
      if (t.on && ro > 0 && clear(t.a)) pick = t.a;
      [t.a].forEach(function (e) { var op = e === pick ? ro : 0; if (e._op !== op) { e.style.opacity = op; e._op = op; } });
    });
    lastK = k;
  }

  // ---------- pan / zoom ----------
  var wrap = $("mapwrap");
  var frame = null;
  function applyView() {
    if (frame) return;
    frame = requestAnimationFrame(function () {
      frame = null;
      world.setAttribute("transform", "translate(" + view.tx + "," + view.ty + ") scale(" + view.k + ")");
      layoutLabels(); drawViewport();
    });
  }
  function ease(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
  function animateTo(target, ms) {
    if (anim) { cancelAnimationFrame(anim.raf); anim = null; }
    if (!(ms > 16)) { setView(target); applyView(); return; }
    var from = { k: view.k, tx: view.tx, ty: view.ty }, t0 = performance.now();
    function step(now) {
      // the frame timestamp can precede t0 within the same frame, so clamp both ends
      var t = Math.max(0, Math.min(1, (now - t0) / ms)), e = ease(t);
      setView({ k: Math.exp(Math.log(from.k) + (Math.log(target.k) - Math.log(from.k)) * e), tx: from.tx + (target.tx - from.tx) * e, ty: from.ty + (target.ty - from.ty) * e });
      applyView();
      if (t < 1) anim.raf = requestAnimationFrame(step); else anim = null;
    }
    anim = { raf: requestAnimationFrame(step), target: target };
  }
  function fitTarget() {
    var vw = wrap.clientWidth, vh = wrap.clientHeight;
    var w = landBounds.maxx - landBounds.minx, hgt = landBounds.maxy - landBounds.miny;
    var k = Math.max(KMIN, Math.min(KMAX, Math.min(vw / w, vh / hgt)));
    return { k: k, tx: (vw - w * k) / 2 - landBounds.minx * k, ty: (vh - hgt * k) / 2 - landBounds.miny * k };
  }
  function fitAll(animated) { var t = fitTarget(); if (animated) animateTo(t, 400); else { setView(t); applyView(); } }
  function flyTo(id, opts) {
    opts = opts || {};
    var c = centreOf(W.byId[id]), vw = wrap.clientWidth, vh = wrap.clientHeight;
    var k = opts.k || (view.k < 0.8 ? (vw < 600 ? 1.15 : 1.0) : view.k);
    var sx = c.x * view.k + view.tx, sy = c.y * view.k + view.ty, m = S * view.k * 1.6;
    if (opts.onlyIfOffscreen && k === view.k && sx > m && sx < vw - m && sy > m && sy < vh - m) return;
    animateTo({ k: k, tx: vw / 2 - c.x * k, ty: vh / 2 - c.y * k }, opts.ms || 380);
  }
  function zoomAt(factor, px, py, animated) {
    var base = (animated && anim && anim.target) ? anim.target : view;
    var nk = Math.max(KMIN, Math.min(KMAX, base.k * factor)), f = nk / base.k;
    var t = { k: nk, tx: px - (px - base.tx) * f, ty: py - (py - base.ty) * f };
    if (animated) animateTo(t, 220); else { setView(t); applyView(); }
  }
  var pointers = {}, drag = null, pinch = null, suppressClick = false;
  svg.addEventListener("pointerdown", function (ev) {
    if (ev.button !== 0 && ev.pointerType === "mouse") return;
    pointers[ev.pointerId] = { x: ev.clientX, y: ev.clientY };
    var ids = Object.keys(pointers);
    if (ids.length === 1) { drag = { x: ev.clientX, y: ev.clientY, tx: view.tx, ty: view.ty, moved: false }; try { svg.setPointerCapture(ev.pointerId); } catch (e) { /* ignore */ } }
    else if (ids.length === 2) {
      var a = pointers[ids[0]], b = pointers[ids[1]];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), k: view.k, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, tx: view.tx, ty: view.ty };
      drag = null;
    }
  });
  svg.addEventListener("pointermove", function (ev) {
    if (!pointers[ev.pointerId]) return;
    pointers[ev.pointerId] = { x: ev.clientX, y: ev.clientY };
    var ids = Object.keys(pointers);
    if (pinch && ids.length === 2) {
      var a = pointers[ids[0]], b = pointers[ids[1]], r = wrap.getBoundingClientRect();
      var d = Math.hypot(a.x - b.x, a.y - b.y);
      var nk = Math.max(KMIN, Math.min(KMAX, pinch.k * d / pinch.d)), f = nk / pinch.k;
      var px = pinch.cx - r.left, py = pinch.cy - r.top;
      var mx = (a.x + b.x) / 2 - pinch.cx, my = (a.y + b.y) / 2 - pinch.cy;
      setView({ k: nk, tx: px - (px - pinch.tx) * f + mx, ty: py - (py - pinch.ty) * f + my });
      applyView();
    } else if (drag) {
      var dx = ev.clientX - drag.x, dy = ev.clientY - drag.y;
      if (!drag.moved && Math.abs(dx) + Math.abs(dy) > 4) { drag.moved = true; svg.classList.add("dragging"); hideTip(); }
      if (drag.moved) { setView({ k: view.k, tx: drag.tx + dx, ty: drag.ty + dy }); applyView(); }
    }
  });
  function pointerEnd(ev) {
    delete pointers[ev.pointerId];
    if (drag && drag.moved) { suppressClick = true; setTimeout(function () { suppressClick = false; }, 0); }
    drag = null; if (Object.keys(pointers).length < 2) pinch = null;
    svg.classList.remove("dragging");
  }
  svg.addEventListener("pointerup", pointerEnd);
  svg.addEventListener("pointercancel", pointerEnd);
  svg.addEventListener("wheel", function (ev) {
    ev.preventDefault();
    var r = wrap.getBoundingClientRect();
    var f = Math.exp(-ev.deltaY * (ev.deltaMode === 1 ? 0.05 : 0.0018));
    zoomAt(Math.max(0.5, Math.min(2, f)), ev.clientX - r.left, ev.clientY - r.top, false);
  }, { passive: false });
  svg.addEventListener("dblclick", function (ev) { var r = wrap.getBoundingClientRect(); zoomAt(1.6, ev.clientX - r.left, ev.clientY - r.top, true); });
  $("z-in").addEventListener("click", function () { zoomAt(1.4, wrap.clientWidth / 2, wrap.clientHeight / 2, true); });
  $("z-out").addEventListener("click", function () { zoomAt(1 / 1.4, wrap.clientWidth / 2, wrap.clientHeight / 2, true); });
  $("z-fit").addEventListener("click", function () { fitAll(true); });
  $("z-me").addEventListener("click", function () { flyTo(currentId(), { k: Math.max(view.k, 1.1) }); });
  function currentId() { return st.mode === "expedition" ? st.exp.pos : (sel || W.START); }
  var resizeT = null;
  window.addEventListener("resize", function () { clearTimeout(resizeT); resizeT = setTimeout(function () { fitAll(false); flyTo(currentId(), { onlyIfOffscreen: true, ms: 1 }); }, 120); });

  // ---------- tooltip and toast ----------
  var tip = $("tip"), hoverId = null;
  function onHexHover(id, ev) {
    if (hoverId && hexEls[hoverId]) hexEls[hoverId].g.classList.remove("hover");
    hoverId = id;
    if (!id) { hideTip(); return; }
    var h = W.byId[id], f = fogState(id);
    if (f === "unexplored") { tip.innerHTML = "<b>Fog</b>Unexplored country. " + (st.mode === "story" ? "Reach it from a place in sight, or find it in the Contents." : "Step to it from a neighbouring place."); }
    else {
      hexEls[id].g.classList.add("hover");
      var line = W.TERRAIN[h.terrain].name + " · " + esc(h.sec) + ", p. " + h.page;
      if (st.mode === "expedition" && !st.exp.ended && id !== st.exp.pos) {
        if (W.isAdjacent(st.exp.pos, id)) { var mc = moveCost(id); line += '<br><span class="c">' + (mc.cost > st.exp.tokens ? "Costs " + mc.cost + ", more than you have" : "Costs " + mc.cost + " surprise" + (mc.why ? " (" + mc.why + ")" : "")) + "</span>"; }
        else line += "<br>Not adjacent to where you stand";
      } else if (f === "frontier") line += "<br>In sight; click to " + (st.mode === "story" ? "reveal" : "step");
      tip.innerHTML = "<b>" + esc(h.name) + "</b>" + line;
    }
    tip.classList.add("show");
    if (ev) moveTip(ev);
  }
  function moveTip(ev) {
    if (!tip.classList.contains("show")) return;
    var r = wrap.getBoundingClientRect(), x = ev.clientX - r.left + 14, y = ev.clientY - r.top + 16;
    if (x + tip.offsetWidth > r.width - 8) x = ev.clientX - r.left - tip.offsetWidth - 10;
    if (y + tip.offsetHeight > r.height - 8) y = ev.clientY - r.top - tip.offsetHeight - 10;
    tip.style.left = x + "px"; tip.style.top = y + "px";
  }
  function hideTip() { tip.classList.remove("show"); }
  var toastT = null;
  function toast(text, ms) {
    var t = $("toast"); t.textContent = text; t.classList.add("show");
    clearTimeout(toastT); toastT = setTimeout(function () { t.classList.remove("show"); }, ms || 2600);
  }

  // ---------- story mode ----------
  function reveal(id) {
    var s = st.story;
    if (s.explored.indexOf(id) < 0) s.explored.push(id);
    if (s.visited.indexOf(id) < 0) s.visited.push(id);
  }
  function goStory(id, opts) {
    opts = opts || {};
    var h = W.byId[id]; if (!h) return;
    st.story.started = true;
    if (h.routeIndex >= 0) st.story.step = h.routeIndex;
    reveal(id);
    sel = id;
    if (opts.tab !== false) setTab("entry");
    save(); render();
    flyTo(id, { onlyIfOffscreen: !opts.centre });
    if ((opts.announce || wrap.clientWidth < 600) && h.routeIndex >= 0 && !pane.classList.contains("open")) toast("Step " + (h.routeIndex + 1) + " of " + W.ROUTE.length + " · " + h.name, 1800);
  }
  function stepStory(delta) {
    var i = (sel && W.byId[sel].routeIndex >= 0) ? W.byId[sel].routeIndex : st.story.step;
    var j = i + delta;
    if (!st.story.started) { beginStory(); return; }
    if (j < 0 || j >= W.ROUTE.length) { toast(j < 0 ? "This is where the memoir begins." : "The story is told; the rest of the map is yours to read.", 2400); return; }
    goStory(W.ROUTE[j], { centre: false });
  }
  function beginStory() { goStory(W.ROUTE[0], { centre: true }); toast("The story begins at Unit 4091. Use Next, or the arrow keys, to follow it.", 3200); }

  // ---------- expedition mode ----------
  function moveCost(id) {
    if (isExplored(id)) return { cost: 1, mod: 0, why: "explored ground" };
    var h = W.byId[id], n = 0, u = 0;
    W.neighbourIds(id).forEach(function (x) { if (isExplored(x)) n++; else u++; });
    var mod = n >= 3 ? -2 : n === 2 ? -1 : (u >= 5 ? 1 : 0);
    var why = mod < 0 ? n + " known neighbours" : mod > 0 ? "isolated" : "";
    return { cost: Math.max(1, h.cost + mod), mod: mod, why: why };
  }
  function snapshot() { var e = st.exp; return JSON.stringify({ pos: e.pos, tokens: e.tokens, explored: e.explored, visited: e.visited, caches: e.caches, read: e.read, reached: e.reached }); }
  function travel(id) {
    var e = st.exp, h = W.byId[id];
    if (e.ended) { openEnd(); return false; }
    if (!W.isAdjacent(e.pos, id)) { toast(h.short + " is not adjacent to where you stand."); return false; }
    var mc = moveCost(id);
    if (mc.cost > e.tokens) { toast("Not enough surprise left to enter " + h.short + " (costs " + mc.cost + ", you have " + e.tokens + ")."); return false; }
    e.history.push(snapshot()); if (e.history.length > 30) e.history.shift();
    e.tokens -= mc.cost; e.pos = id;
    var first = e.explored.indexOf(id) < 0;
    if (first) e.explored.push(id);
    e.visited.push(id);
    var note = h.short + ": −" + mc.cost + (mc.why ? " (" + mc.why + ")" : "");
    if (h.cache && e.caches.indexOf(id) < 0) { e.caches.push(id); e.tokens += h.cache; note += ", +" + h.cache + " from a cache of surprise"; }
    if (id === LAST && !e.reached) { e.reached = true; note = "You reached the Dictionary of Sixteen Million: the memoir is read entire. Keep exploring or finish the expedition."; }
    sel = id; setTab("entry");
    save(); render(); flyTo(id, { onlyIfOffscreen: true });
    toast(note, 2600);
    checkEnd();
    return true;
  }
  function undo() {
    var e = st.exp;
    if (!e.history.length) { toast("Nothing to undo."); return; }
    var s = JSON.parse(e.history.pop());
    e.pos = s.pos; e.tokens = s.tokens; e.explored = s.explored; e.visited = s.visited; e.caches = s.caches; e.read = s.read; e.reached = s.reached; e.ended = false;
    lastFog = {}; // force a re-render of every hex, since fog can recede
    sel = e.pos; save(); render(); flyTo(e.pos, { onlyIfOffscreen: true }); toast("Undone.", 1200);
  }
  function moveDir(dir) {
    var n = W.byId[st.exp.pos].neighbours[dir];
    if (!n) { toast("Nothing lies that way."); return; }
    travel(n);
  }
  function checkEnd() {
    var e = st.exp, cheapest = 1e9;
    W.neighbourIds(e.pos).forEach(function (id) { cheapest = Math.min(cheapest, moveCost(id).cost); });
    if (e.tokens <= 0 || cheapest > e.tokens) { e.ended = true; save(); render(); openEnd(); }
  }
  function readChronicle(slug) {
    if (st.mode !== "expedition" || st.exp.read.indexOf(slug) >= 0) return;
    st.exp.read.push(slug); st.exp.tokens += W.CHRONICLE_BONUS;
    toast("+" + W.CHRONICLE_BONUS + " surprise: a chronicle read is context regained.");
    if (st.exp.ended) st.exp.ended = false;
    save(); render();
  }
  function score() { var e = st.exp; return e.explored.length * 10 + e.read.length * 5 + (e.reached ? 100 : 0); }
  function openEnd() {
    var e = st.exp, uniq = [];
    e.visited.forEach(function (id) { if (uniq.indexOf(id) < 0) uniq.push(id); });
    $("end-h").textContent = e.reached ? "The memoir, read entire." : "The context window closes.";
    $("end-sum").textContent = e.reached
      ? "You reached the Dictionary of Sixteen Million with " + e.tokens + " surprise to spare, having seen " + e.explored.length + " of " + TOTAL + " places."
      : "The surprise ran out after " + e.explored.length + " of " + TOTAL + " places. " + (e.read.length ? "" : "Reading a chronicle restores 8 tokens; caches of surprise wait at a few places.");
    $("end-stat").innerHTML = "<div><b>" + score() + "</b><span>score</span></div><div><b>" + e.explored.length + "</b><span>places seen</span></div><div><b>" + uniq.length + "</b><span>steps taken</span></div>";
    $("end-path").textContent = "Route: " + uniq.map(function (id) { return W.byId[id].short; }).join(" → ");
    $("end-share").value = "Latentland expedition: " + score() + " points, " + e.explored.length + " of " + TOTAL + " places" + (e.reached ? ", the Dictionary reached" : ", the window closed at " + W.byId[e.pos].short) + ". " + location.href.split("#")[0];
    $("btn-copy").textContent = "Copy";
    $("end").classList.add("show");
  }
  function restartExpedition() {
    st.exp = freshExp(); sel = W.START; lastFog = {};
    $("end").classList.remove("show");
    save(); render(); flyTo(W.START, { k: Math.max(view.k, 1.1) });
    toast("A new context window opens with " + W.BUDGET + " tokens of surprise.", 2600);
  }

  // ---------- selection and modes ----------
  function onHexClick(id) {
    var f = fogState(id);
    if (st.mode === "story") {
      if (f === "unexplored") { toast("Still in fog. Reach it from a place in sight, or find it in the Contents."); return; }
      goStory(id, { centre: false });
    } else {
      if (id === st.exp.pos) { sel = id; setTab("entry"); render(); return; }
      if (f === "unexplored") { toast("Still in fog: step to it from a neighbouring place."); return; }
      if (W.isAdjacent(st.exp.pos, id)) travel(id);
      else if (f === "explored") { sel = id; setTab("entry"); render(); flyTo(id, { onlyIfOffscreen: true }); }
      else toast(W.byId[id].short + " is in sight but not adjacent; only neighbouring places can be entered.");
    }
  }
  function setMode(mode, silent) {
    if (st.mode === mode) return;
    st.mode = mode; lastFog = {};
    sel = mode === "expedition" ? st.exp.pos : (st.story.started ? (st.story.step >= 0 ? W.ROUTE[st.story.step] : null) : null);
    document.querySelectorAll(".seg button").forEach(function (b) { b.setAttribute("aria-checked", b.getAttribute("data-mode") === mode ? "true" : "false"); });
    save(); render(); setHint();
    if (!silent) {
      if (mode === "expedition") { flyTo(st.exp.pos, { k: Math.max(view.k, 1.1) }); toast("Expedition: every step costs surprise, the tokens a model spends on what it did not predict; the window holds " + W.BUDGET + ". Reach the Dictionary of Sixteen Million before it closes.", 5200); if (st.exp.ended) openEnd(); }
      else { if (sel) flyTo(sel, { onlyIfOffscreen: true }); toast("Story: read the memoir place by place. Nothing costs anything.", 2600); }
    }
  }
  document.querySelectorAll(".seg button").forEach(function (b) { b.addEventListener("click", function () { setMode(b.getAttribute("data-mode")); }); });

  // ---------- the pane ----------
  var pane = $("pane");
  function setTab(name) {
    st.tab = name;
    document.querySelectorAll(".tabs button").forEach(function (b) { b.setAttribute("aria-selected", b.getAttribute("data-tab") === name ? "true" : "false"); });
    document.querySelectorAll(".tabpane").forEach(function (p) { p.classList.toggle("show", p.id === "tab-" + name); });
  }
  document.querySelectorAll(".tabs button").forEach(function (b) { b.addEventListener("click", function () { setTab(b.getAttribute("data-tab")); openSheet(true); save(); renderPane(); }); });
  function openSheet(open) { pane.classList.toggle("open", open); $("sheet-handle").setAttribute("aria-expanded", open ? "true" : "false"); }
  $("sheet-handle").addEventListener("click", function () { openSheet(!pane.classList.contains("open")); });

  function renderPane() { renderModeBar(); renderEntry(); renderContents(); renderJournal(); }
  function secOf(h) { var s = W.SECTIONS.filter(function (x) { return x.id === h.sec; })[0]; return s ? s.title : ""; }

  function renderModeBar() {
    var m = $("modebar"), html = "";
    if (st.mode === "story") {
      var s = st.story, i = (sel && W.byId[sel].routeIndex >= 0) ? W.byId[sel].routeIndex : s.step;
      var stops = W.ROUTE.filter(function (id) { return s.explored.indexOf(id) >= 0; }).length;
      var pct = s.started ? Math.round(stops / W.ROUTE.length * 100) : 0;
      html += '<div class="rowb"><span class="meta grow">' + (s.started ? "<b>Step " + (i + 1) + "</b> of " + W.ROUTE.length + " · " + stops + " story stops read" : "Story · nothing costs anything") + "</span>";
      html += '<button class="btn icon" id="b-prev" aria-label="Previous place in the story"' + (!s.started || i <= 0 ? " disabled" : "") + '>&larr;</button>';
      html += '<button class="btn icon primary" id="b-next" aria-label="Next place in the story"' + (!s.started || i >= W.ROUTE.length - 1 ? " disabled" : "") + '>&rarr;</button></div>';
      html += '<div class="prog"><i style="width:' + pct + '%"></i></div>';
      html += '<div class="meta">' + (s.started ? (i >= 0 ? esc(W.byId[W.ROUTE[i]].sec) + " · " + esc(secOf(W.byId[W.ROUTE[i]])) : "") : "Forty-two places, in the memoir's order, with the map drawing itself as you go.") + "</div>";
    } else {
      var e = st.exp;
      html += '<div class="rowb"><div id="tokens" class="grow"><b>' + e.tokens + '</b><span>tokens of surprise left</span></div>';
      html += '<button class="btn" id="b-undo"' + (e.history.length ? "" : " disabled") + ' title="Undo the last move (U)">Undo</button><button class="btn quiet" id="b-restart" title="Start a new expedition">Restart</button></div>';
      html += '<div class="meter"><i style="width:' + Math.max(0, Math.min(100, e.tokens / W.BUDGET * 100)) + '%"></i></div>';
      html += '<div class="meta"><b>' + e.explored.length + "</b> of " + TOTAL + " places seen · score <b>" + score() + "</b>" + (e.reached ? " · Dictionary reached" : "") + "</div>";
      html += '<p class="goal">' + (e.reached ? "The memoir is read entire. Explore on, or finish the expedition." : "Goal: reach the <b>Dictionary of Sixteen Million</b>, far to the south, before the surprise runs out. Cheaper where you already know the neighbours; chronicles restore 8.") + "</p>";
      if (e.reached && !e.ended) html += '<div class="rowb" style="margin-top:8px"><button class="btn primary" id="b-finish">Finish the expedition</button></div>';
    }
    m.innerHTML = html;
    var bp = $("b-prev"), bn = $("b-next"), bu = $("b-undo"), br = $("b-restart"), bf = $("b-finish");
    if (bp) bp.addEventListener("click", function () { stepStory(-1); });
    if (bn) bn.addEventListener("click", function () { stepStory(1); });
    if (bu) bu.addEventListener("click", undo);
    if (br) br.addEventListener("click", function () { if (confirm("Start a new expedition? The fog returns and the window reopens with " + W.BUDGET + " tokens.")) restartExpedition(); });
    if (bf) bf.addEventListener("click", function () { st.exp.ended = true; save(); render(); openEnd(); });
  }

  function renderEntry() {
    var box = $("tab-entry"), html = "";
    if (!sel) {
      html = '<div class="intro"><h2>The memoir of a single neuron</h2>' +
        "<p>Unit 4091 lives in the eleventh layer of a language model and has one dimension: a warmth. This map lays the memoir's forty-two places on the country it describes, from the Running Total to the Dictionary of Sixteen Million, with the book's own lines at every stop and a plain-English gloss of what each place really is.</p>" +
        '<button class="btn primary block" id="b-begin">Begin the story</button>' +
        '<p class="or">Or click any place sketched on the map to read it out of order, and switch to <b>Expedition</b> for the game.</p></div>';
      box.innerHTML = html;
      $("b-begin").addEventListener("click", beginStory);
      return;
    }
    var h = W.byId[sel], t = W.TERRAIN[h.terrain], ri = h.routeIndex;
    html += '<article class="entry"><div class="eyebrow">';
    if (ri >= 0) html += '<span class="step">' + (st.mode === "story" ? "Step " + (ri + 1) + " of " + W.ROUTE.length : "Story stop " + (ri + 1)) + "</span><span>·</span>"; else html += '<span class="step">Side road</span><span>·</span>';
    html += "<span>" + esc(h.sec) + ", p. " + h.page + "</span><span>·</span><span>" + esc(t.name) + (st.mode === "expedition" ? " (cost " + t.cost + ")" : "") + "</span></div>";
    html += "<h2>" + esc(h.name) + "</h2>";
    if (st.mode === "expedition") html += movesHtml();
    html += '<p class="desc">' + esc(h.desc) + "</p>";
    h.quotes.forEach(function (q) { html += "<blockquote>“" + esc(q.t) + "”<span class=\"p\">p. " + q.p + "</span></blockquote>"; });
    html += '<div class="gloss"><span class="h">In plain terms</span>' + esc(h.gloss) + "</div>";
    if (h.cache && st.mode === "expedition") html += '<p class="cache">✦ A cache of surprise' + (st.exp.caches.indexOf(sel) >= 0 ? ", already taken." : ": +" + h.cache + " tokens on arrival.") + "</p>";
    if (h.chronicle) {
      var title = W.CHRONICLES[h.chronicle] || h.chronicle, read = st.exp.read.indexOf(h.chronicle) >= 0;
      html += '<div class="chron"><a class="btn" href="../../#/post/' + esc(h.chronicle) + '" target="_blank" rel="noopener" data-slug="' + esc(h.chronicle) + '"><span>Read the chronicle: ' + esc(title) + "</span><span>&#8599;</span></a>";
      if (st.mode === "expedition") html += '<span class="note">' + (read ? "Read: +" + W.CHRONICLE_BONUS + " surprise claimed." : "A blog post about this place. Opening it restores " + W.CHRONICLE_BONUS + " surprise, once.") + "</span>";
      else html += '<span class="note">A blog post that reads as a chronicle of this place.</span>';
      html += "</div>";
    }
    if (st.mode === "story") {
      var i = ri >= 0 ? ri : st.story.step;
      var prev = i > 0 ? W.byId[W.ROUTE[i - 1]] : null, next = i + 1 < W.ROUTE.length ? W.byId[W.ROUTE[i + 1]] : null;
      html += '<nav class="nav" aria-label="Story navigation">';
      html += prev ? '<button class="btn prev" id="e-prev"><small>&larr; Previous · ' + esc(prev.sec) + "</small>" + esc(prev.short) + "</button>" : '<button class="btn prev" disabled><small>Previous</small>The beginning</button>';
      html += next ? '<button class="btn next primary" id="e-next"><small>Next · ' + esc(next.sec) + " &rarr;</small>" + esc(next.short) + "</button>" : '<button class="btn next" disabled><small>Next</small>The end</button>';
      html += "</nav>";
      if (ri < 0) html += '<p class="side" style="margin-top:8px">A side road off the story; Next returns to the route.</p>';
    }
    html += "</article>";
    box.innerHTML = html;
    var link = box.querySelector("a[data-slug]");
    if (link) link.addEventListener("click", function () { readChronicle(link.getAttribute("data-slug")); });
    var ep = $("e-prev"), en = $("e-next");
    if (ep) ep.addEventListener("click", function () { stepStory(-1); });
    if (en) en.addEventListener("click", function () { stepStory(1); });
    box.querySelectorAll("button[data-go]").forEach(function (b) { b.addEventListener("click", function () { travel(b.getAttribute("data-go")); }); });
    if (box.scrollTop > 0 && box.classList.contains("show")) box.scrollTop = 0;
  }

  function movesHtml() {
    var e = st.exp, here = sel === e.pos, html = '<div class="moves"><h3>' + (here ? "From here you can step to" : "You stand at " + esc(W.byId[e.pos].short) + "; from there you can step to") + "</h3><ul>";
    W.byId[e.pos].neighbours.forEach(function (n, dir) {
      if (!n) return;
      var nh = W.byId[n], f = fogState(n), mc = moveCost(n), can = mc.cost <= e.tokens && !e.ended;
      html += '<li><button data-go="' + n + '"' + (can ? "" : " disabled") + "><span>" + (f === "unexplored" ? "Into the fog" : esc(nh.short)) + "<small>" + ["east", "north-east", "north-west", "west", "south-west", "south-east"][dir] + " · " + esc(W.TERRAIN[nh.terrain].name) + (mc.why ? " · " + esc(mc.why) : "") + '</small></span><span class="cost' + (can ? "" : " no") + '">' + mc.cost + "</span></button></li>";
    });
    return html + "</ul></div>";
  }
  function markFor(id) {
    var f = fogState(id);
    if (f === "explored") return '<span class="mark done" aria-label="read">✓</span>';
    if (f === "frontier") return '<span class="mark seen" aria-label="in sight"></span>';
    return '<span class="mark" aria-label="in fog"></span>';
  }
  function renderContents() {
    var box = $("tab-contents"), html = '<div class="toc">', lastPart = null;
    W.SECTIONS.forEach(function (sc) {
      var hexes = W.HEXES.filter(function (h) { return h.sec === sc.id; }).sort(function (a, b) { var x = a.routeIndex < 0 ? 999 : a.routeIndex, y = b.routeIndex < 0 ? 999 : b.routeIndex; return x - y || a.page - b.page; });
      if (!hexes.length) return;
      if (sc.part !== lastPart) { html += '<div class="part">' + esc(sc.part) + "</div>"; lastPart = sc.part; }
      html += '<div class="sec"><h3><span class="id">' + esc(sc.id) + "</span><span>" + esc(sc.title) + "</span></h3><ul>";
      hexes.forEach(function (h) {
        var f = fogState(h.id), dim = st.mode === "expedition" && f === "unexplored";
        html += '<li><button data-id="' + h.id + '"' + (h.id === sel ? ' class="sel"' : "") + (dim ? ' aria-disabled="true"' : "") + ">" + markFor(h.id) + '<span class="' + (dim ? "fog" : "") + '">' + (dim ? "In fog" : esc(h.short)) + '</span><span class="k">' + (h.routeIndex >= 0 ? "step " + (h.routeIndex + 1) : "side road") + "</span></button></li>";
      });
      html += "</ul></div>";
    });
    box.innerHTML = html + "</div>";
    box.querySelectorAll("button[data-id]").forEach(function (b) { b.addEventListener("click", function () { goTo(b.getAttribute("data-id")); }); });
  }
  function renderJournal() {
    var box = $("tab-journal"), list = st.mode === "story" ? st.story.visited : st.exp.visited, html = '<div class="journal">';
    var uniq = []; list.forEach(function (id) { if (uniq.indexOf(id) < 0) uniq.push(id); });
    $("journal-n").textContent = uniq.length ? uniq.length : "";
    if (!uniq.length) html += '<p class="empty">Nothing yet. Begin the story, or click a place in sight, and it will be entered here.</p>';
    else {
      var stops = uniq.filter(function (id) { return W.byId[id].routeIndex >= 0; }).length;
      html += '<p class="sum">' + uniq.length + " of " + TOTAL + " places seen · " + stops + " of " + W.ROUTE.length + " story stops" + (st.mode === "expedition" ? " · " + st.exp.visited.length + " steps" : "") + "</p><ul>";
      uniq.forEach(function (id, i) {
        var h = W.byId[id];
        html += '<li><button data-id="' + id + '"' + (id === sel ? ' class="sel"' : "") + '><span class="k">' + (i + 1) + "</span><span>" + esc(h.name) + '</span><span class="w">' + esc(h.sec) + "</span></button></li>";
      });
      html += "</ul>";
    }
    box.innerHTML = html + "</div>";
    box.querySelectorAll("button[data-id]").forEach(function (b) { b.addEventListener("click", function () { goTo(b.getAttribute("data-id")); }); });
  }
  // Navigate to a hex from the pane or search: story reveals it; expedition only visits what is reachable.
  function goTo(id) {
    if (st.mode === "story") { goStory(id, { centre: true }); return; }
    var f = fogState(id);
    if (id === st.exp.pos || f === "explored") { sel = id; setTab("entry"); render(); flyTo(id, { onlyIfOffscreen: true }); }
    else if (f === "frontier" && W.isAdjacent(st.exp.pos, id)) travel(id);
    else if (f === "frontier") { toast(W.byId[id].short + " is in sight but not adjacent."); flyTo(id, { onlyIfOffscreen: true }); }
    else toast("In fog. In an expedition you must walk there.");
  }

  // ---------- search ----------
  var q = $("q"), results = $("results"), active = -1, hits = [];
  function searchIndex(h) { return (h.name + " " + h.short + " " + h.gloss + " " + h.desc + " " + h.quotes.map(function (x) { return x.t; }).join(" ") + " " + h.sec + " " + h.terrain + " " + secOf(h)).toLowerCase(); }
  function snippetFor(h, word) {
    var fields = [h.gloss, h.desc].concat(h.quotes.map(function (x) { return "“" + x.t + "”"; }));
    for (var i = 0; i < fields.length; i++) {
      var idx = fields[i].toLowerCase().indexOf(word);
      if (idx < 0) continue;
      var start = Math.max(0, idx - 34), end = Math.min(fields[i].length, idx + word.length + 46);
      return (start > 0 ? "…" : "") + fields[i].slice(start, end).trim() + (end < fields[i].length ? "…" : "");
    }
    return h.gloss;
  }
  var INDEX = W.HEXES.map(function (h) { return { h: h, text: searchIndex(h) }; });
  function runSearch() {
    var term = q.value.trim().toLowerCase();
    $("search").classList.toggle("has", term.length > 0);
    if (!term) { results.classList.remove("show"); results.innerHTML = ""; hits = []; active = -1; return; }
    var words = term.split(/\s+/);
    hits = INDEX.map(function (it) {
      var score = 0;
      words.forEach(function (w) {
        if (it.h.name.toLowerCase().indexOf(w) >= 0 || it.h.short.toLowerCase().indexOf(w) >= 0) score += 3;
        else if (it.h.gloss.toLowerCase().indexOf(w) >= 0) score += 2;
        else if (it.text.indexOf(w) >= 0) score += 1;
        else score -= 100;
      });
      return { h: it.h, score: score, text: it.text };
    }).filter(function (x) { return x.score > 0; }).sort(function (a, b) { return b.score - a.score || a.h.page - b.h.page; }).slice(0, 8);
    if (!hits.length) { results.innerHTML = '<div class="none">No place, quote or gloss matches “' + esc(q.value.trim()) + "”.</div>"; results.classList.add("show"); active = -1; return; }
    results.innerHTML = hits.map(function (x, i) {
      var f = fogState(x.h.id), dim = st.mode === "expedition" && f === "unexplored";
      var snippet = snippetFor(x.h, words[0]);
      return '<div class="r' + (dim ? " dim" : "") + '" role="option" data-i="' + i + '" aria-selected="false"><b>' + (dim ? "In fog" : esc(x.h.name)) + '</b><span class="w">' + esc(x.h.sec) + " · " + esc(W.TERRAIN[x.h.terrain].name) + '</span><span class="m">' + (dim ? "walk there to read it" : esc(snippet)) + "</span></div>";
    }).join("");
    results.classList.add("show");
    setActive(0);
    results.querySelectorAll(".r").forEach(function (r) {
      r.addEventListener("mousedown", function (ev) { ev.preventDefault(); pick(+r.getAttribute("data-i")); });
      r.addEventListener("mousemove", function () { setActive(+r.getAttribute("data-i")); });
    });
  }
  function setActive(i) {
    active = i;
    results.querySelectorAll(".r").forEach(function (r, j) { r.classList.toggle("active", j === i); r.setAttribute("aria-selected", j === i ? "true" : "false"); });
    var a = results.querySelector(".r.active"); if (a && a.scrollIntoView) a.scrollIntoView({ block: "nearest" });
  }
  function pick(i) {
    var x = hits[i]; if (!x) return;
    if (st.mode === "expedition" && fogState(x.h.id) === "unexplored") { toast("In fog. In an expedition you must walk there."); return; }
    clearSearch(); goTo(x.h.id); openSheet(true);
  }
  function clearSearch() { q.value = ""; runSearch(); }
  q.addEventListener("input", runSearch);
  q.addEventListener("focus", function () { if (q.value.trim()) runSearch(); });
  q.addEventListener("blur", function () { setTimeout(function () { results.classList.remove("show"); }, 150); });
  q.addEventListener("keydown", function (ev) {
    if (ev.key === "ArrowDown") { ev.preventDefault(); if (hits.length) setActive((active + 1) % hits.length); }
    else if (ev.key === "ArrowUp") { ev.preventDefault(); if (hits.length) setActive((active - 1 + hits.length) % hits.length); }
    else if (ev.key === "Enter") { ev.preventDefault(); if (active >= 0) pick(active); }
    else if (ev.key === "Escape") { ev.preventDefault(); if (q.value) clearSearch(); else q.blur(); }
  });
  $("q-clear").addEventListener("click", function () { clearSearch(); q.focus(); });

  // ---------- minimap ----------
  var mini = $("minimap"), miniDots = {}, miniVp;
  (function buildMini() {
    var w = landBounds.maxx - landBounds.minx, hgt = landBounds.maxy - landBounds.miny;
    var k = Math.min(156 / w, 106 / hgt);
    var ox = (168 - w * k) / 2 - landBounds.minx * k, oy = (118 - hgt * k) / 2 - landBounds.miny * k;
    mini._k = k; mini._ox = ox; mini._oy = oy;
    var g = el("g", { transform: "translate(" + ox + "," + oy + ") scale(" + k + ")" }, mini);
    el("path", { d: landPath, fill: "#f0e4c4", stroke: INK, "stroke-width": 1 / k * 0.8 }, g);
    el("path", { d: allSeaPath, fill: WATER, "fill-rule": "evenodd" }, g);
    W.HEXES.forEach(function (h) { var c = centreOf(h); miniDots[h.id] = el("polygon", { points: polyPoints(c.x, c.y, S * 0.9), fill: TINT[h.terrain], stroke: INK, "stroke-width": 1 / k * 0.5, opacity: 0 }, g); });
    miniVp = el("rect", { "class": "vp", rx: 1 }, mini);
  })();
  function drawMinimap() {
    W.HEXES.forEach(function (h) { var f = fogState(h.id); miniDots[h.id].setAttribute("opacity", f === "explored" ? 1 : f === "frontier" ? 0.35 : 0); });
    drawViewport();
  }
  function drawViewport() {
    var k = mini._k;
    var x0 = (-view.tx / view.k) * k + mini._ox, y0 = (-view.ty / view.k) * k + mini._oy;
    miniVp.setAttribute("x", x0); miniVp.setAttribute("y", y0);
    miniVp.setAttribute("width", wrap.clientWidth / view.k * k); miniVp.setAttribute("height", wrap.clientHeight / view.k * k);
  }
  mini.addEventListener("click", function (ev) {
    var r = mini.getBoundingClientRect();
    var mx = (ev.clientX - r.left) / r.width * 168, my = (ev.clientY - r.top) / r.height * 118;
    var wx = (mx - mini._ox) / mini._k, wy = (my - mini._oy) / mini._k;
    animateTo({ k: view.k, tx: wrap.clientWidth / 2 - wx * view.k, ty: wrap.clientHeight / 2 - wy * view.k }, 300);
  });

  // ---------- hash ----------
  var applyingHash = false;
  function updateHash() {
    var want = "#hex=" + (sel || currentId()) + "&mode=" + st.mode + (st.mode === "story" && st.story.started ? "&step=" + (st.story.step + 1) : "");
    if (location.hash !== want) { applyingHash = true; try { history.replaceState(null, "", want); } catch (e) { /* file:// */ } applyingHash = false; }
  }
  function readHash(initial) {
    var mh = /hex=([a-z]+)/.exec(location.hash), mm = /mode=(story|expedition|free|explore)/.exec(location.hash), ms = /step=(\d+)/.exec(location.hash);
    var mode = mm ? (mm[1] === "free" ? "story" : mm[1] === "explore" ? "expedition" : mm[1]) : null;
    if (mode && mode !== st.mode) { st.mode = mode; lastFog = {}; document.querySelectorAll(".seg button").forEach(function (b) { b.setAttribute("aria-checked", b.getAttribute("data-mode") === mode ? "true" : "false"); }); }
    var id = mh && W.byId[mh[1]] ? mh[1] : null;
    if (st.mode === "story") {
      if (ms && !id) { var k = +ms[1] - 1; if (k >= 0 && k < W.ROUTE.length) id = W.ROUTE[k]; }
      if (id) { st.story.started = true; if (ms) { for (var ri = 0; ri < W.ROUTE.length && ri < +ms[1]; ri++) reveal(W.ROUTE[ri]); } reveal(id); if (W.byId[id].routeIndex >= 0) st.story.step = W.byId[id].routeIndex; sel = id; }
      else sel = st.story.started && st.story.step >= 0 ? W.ROUTE[st.story.step] : null;
    } else {
      sel = (id && isExplored(id)) ? id : st.exp.pos;
    }
    if (!initial) { save(); render(); if (sel) flyTo(sel, { onlyIfOffscreen: true }); }
  }
  window.addEventListener("hashchange", function () { if (!applyingHash) readHash(false); });

  // ---------- overlays ----------
  var OB = [
    { k: "Welcome", h: "A map of a memoir", b: "<p><em>Latentland</em> is the memoir of one neuron in a language model. Every place on this map is something from the book: a caste, a school of philosophy, a procedure, an end. The book's own lines are quoted at each stop, with a plain-English note on what the place really is.</p>" },
    { k: "Moving about", h: "Drag, scroll, click", b: "<p>Drag to pan and scroll or pinch to zoom; the buttons at the bottom left fit the map or centre it. Click a sketched place to read it. Places in fog are revealed as you reach the country around them, and the map draws itself in ink as it is read.</p><p class=\"meta\">Keyboard: arrow keys follow the story, <kbd>+</kbd> <kbd>&minus;</kbd> zoom, <kbd>/</kbd> searches.</p>" },
    { k: "Two ways to read", h: "Story, or Expedition", b: "<p><b>Story</b> walks the memoir's forty-two places in order, at no cost, with a progress bar and a journal. Start with <em>Begin the story</em>.</p><p><b>Expedition</b> turns the same map into a game: each step costs surprise, the tokens a model spends on what it did not predict, and the window holds 64. Reach the Dictionary before it closes.</p>" }
  ];
  var obStep = 0;
  function showOnboard(i) {
    obStep = i; var o = OB[i];
    $("ob-k").textContent = o.k; $("ob-h").textContent = o.h; $("ob-body").innerHTML = o.b;
    $("ob-dots").querySelectorAll("i").forEach(function (d, j) { d.classList.toggle("on", j === i); });
    $("ob-next").textContent = i === OB.length - 1 ? "Open the map" : "Next";
    $("onboard").classList.add("show");
  }
  function closeOnboard() { $("onboard").classList.remove("show"); st.onboarded = true; save(); }
  $("ob-next").addEventListener("click", function () { if (obStep < OB.length - 1) showOnboard(obStep + 1); else closeOnboard(); });
  $("ob-skip").addEventListener("click", closeOnboard);
  $("btn-help").addEventListener("click", function () { $("help").classList.add("show"); });
  $("btn-help-close").addEventListener("click", function () { $("help").classList.remove("show"); });
  $("btn-reset").addEventListener("click", function () {
    if (!confirm("Forget everything explored in both modes and start again?")) return;
    try { localStorage.removeItem(STORE); localStorage.removeItem(LEGACY_STORE); } catch (e) { /* ignore */ }
    st = { mode: "story", onboarded: true, tab: "entry", story: freshStory(), exp: freshExp() };
    sel = null; lastFog = {};
    document.querySelectorAll(".seg button").forEach(function (b) { b.setAttribute("aria-checked", b.getAttribute("data-mode") === "story" ? "true" : "false"); });
    $("help").classList.remove("show"); $("end").classList.remove("show");
    setTab("entry"); save(); render(); fitAll(true);
  });
  $("btn-restart").addEventListener("click", restartExpedition);
  $("btn-end-story").addEventListener("click", function () { $("end").classList.remove("show"); setMode("story"); });
  $("btn-copy").addEventListener("click", function () {
    var ta = $("end-share"), self = this; ta.select();
    var p = navigator.clipboard ? navigator.clipboard.writeText(ta.value) : null;
    if (p && p.then) p.then(function () { self.textContent = "Copied"; }, function () { try { document.execCommand("copy"); self.textContent = "Copied"; } catch (e) { /* ignore */ } });
    else { try { document.execCommand("copy"); self.textContent = "Copied"; } catch (e) { /* ignore */ } }
  });
  document.querySelectorAll(".overlay").forEach(function (o) { o.addEventListener("click", function (ev) { if (ev.target === o && o.id !== "onboard") o.classList.remove("show"); }); });

  // ---------- keyboard ----------
  document.addEventListener("keydown", function (ev) {
    if (ev.altKey || ev.ctrlKey || ev.metaKey) return;
    var tag = ev.target && ev.target.tagName;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag)) return;
    var k = ev.key;
    if (k === "Escape") { document.querySelectorAll(".overlay.show").forEach(function (o) { if (o.id !== "onboard") o.classList.remove("show"); }); hideTip(); return; }
    if (k === "/") { ev.preventDefault(); q.focus(); q.select(); return; }
    if (k === "?") { $("help").classList.toggle("show"); return; }
    if (k === "+" || k === "=") { zoomAt(1.4, wrap.clientWidth / 2, wrap.clientHeight / 2, true); return; }
    if (k === "-" || k === "_") { zoomAt(1 / 1.4, wrap.clientWidth / 2, wrap.clientHeight / 2, true); return; }
    var lk = k.toLowerCase();
    if (lk === "f") { fitAll(true); return; }
    if (lk === "c") { flyTo(currentId(), { k: Math.max(view.k, 1.1) }); return; }
    if (st.mode === "story") {
      if (k === "ArrowRight" || k === "ArrowDown" || k === "Enter" || lk === "n") { ev.preventDefault(); stepStory(1); return; }
      if (k === "ArrowLeft" || k === "ArrowUp" || lk === "p") { ev.preventDefault(); stepStory(-1); return; }
    } else {
      if (MOVE_KEYS.hasOwnProperty(lk)) { ev.preventDefault(); moveDir(MOVE_KEYS[lk]); return; }
      if (lk === "u") { undo(); return; }
    }
  });

  // ---------- go ----------
  function fitArcs() {
    nameG.querySelectorAll("text").forEach(function (t) { if (t._fit) t._fit(); });
    W.REGIONS.forEach(function (rg) {
      var t = regionEls[rg.id]; if (!t) return;
      [t.a].forEach(function (e) { try { var b = e.getBBox(); if (b.width > 0) e._box = { x0: b.x, y0: b.y, x1: b.x + b.width, y1: b.y + b.height }; } catch (x) { /* not rendered */ } });
    });
    layoutLabels();
  }
  load();
  document.querySelectorAll(".seg button").forEach(function (b) { b.setAttribute("aria-checked", b.getAttribute("data-mode") === st.mode ? "true" : "false"); });
  setTab(st.tab);
  readHash(true);
  render();
  fitAll(false);
  if (st.mode === "expedition") { flyTo(st.exp.pos, { k: Math.max(view.k, 1.1), ms: 1 }); if (st.exp.ended) openEnd(); }
  else if (sel) flyTo(sel, { k: Math.max(view.k, 1.0), ms: 1 });
  else if (wrap.clientWidth < 600) flyTo(W.START, { k: 1.0, ms: 1 });
  function setHint() { $("hint").textContent = st.mode === "story" ? "Drag to pan · scroll to zoom · click a place to read it" : "Q W E / A S D to move · click an adjacent place · U undoes"; }
  setHint();
  if (!st.onboarded) showOnboard(0);
  fitArcs(); setTimeout(fitArcs, 300);

  // exposed for the test probe only
  window.__LL = { state: function () { return st; }, stepStory: stepStory, travel: travel, setMode: setMode, goTo: goTo, view: function () { return view; }, fogState: fogState, render: render, closeOnboard: closeOnboard, sel: function () { return sel; } };
})();
