/* Latentland Map: geometry and ink helpers.
 *
 * Pure functions only (no DOM), so the same code runs in the browser and in
 * the Node test script. Everything here works in "map units": a pointy-top
 * hex of radius S has centre (S*sqrt3*(q + r/2), S*1.5*r) in axial (q, r).
 *
 * Contents:
 *   hex geometry (centre, corners, edge directions)
 *   a seeded random generator (so the drawing is the same every visit)
 *   outline(): the boundary of a set of hex cells as closed loops
 *   wobble() / catmull(): hand-drawn jitter and smooth curves
 *   ribbon(): a tapering river polygon from a centreline
 *   glyphs: procedural 17th-century map symbols (mountains, trees, ruins,
 *           buildings, grass, waves, a sea serpent) as SVG path data
 *   placeLabels(): greedy label collision avoidance in screen space
 */
(function (root) {
  "use strict";

  var SQ3 = Math.sqrt(3);

  // ---------- hex geometry ----------
  function centre(q, r, S) { return { x: S * SQ3 * (q + r / 2), y: S * 1.5 * r }; }
  function corner(cx, cy, S, i) {
    var a = Math.PI / 180 * (60 * i - 30);
    return { x: cx + S * Math.cos(a), y: cy + S * Math.sin(a) };
  }
  function corners(cx, cy, S) { var p = []; for (var i = 0; i < 6; i++) p.push(corner(cx, cy, S, i)); return p; }
  // Neighbour across edge i, where edge i runs from corner i to corner i+1.
  var EDGE_DIRS = [{ q: 1, r: 0 }, { q: 0, r: 1 }, { q: -1, r: 1 }, { q: -1, r: 0 }, { q: 0, r: -1 }, { q: 1, r: -1 }];

  // ---------- seeded randomness ----------
  function rng(seed) { // mulberry32
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hashStr(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  // ---------- outlines ----------
  // Boundary of a set of axial cells, as an array of closed loops of points.
  // Every edge that faces a cell outside the set is a boundary edge; the
  // edges are chained end to end. Holes come out as separate loops.
  function outline(cells, S) {
    var set = {};
    cells.forEach(function (c) { set[c.q + "," + c.r] = true; });
    var edges = [];
    cells.forEach(function (c) {
      var ct = centre(c.q, c.r, S);
      for (var i = 0; i < 6; i++) {
        var d = EDGE_DIRS[i];
        if (set[(c.q + d.q) + "," + (c.r + d.r)]) continue;
        edges.push({ a: corner(ct.x, ct.y, S, i), b: corner(ct.x, ct.y, S, (i + 1) % 6), used: false });
      }
    });
    var key = function (p) { return Math.round(p.x * 10) + "," + Math.round(p.y * 10); };
    var byStart = {};
    edges.forEach(function (e) { var k = key(e.a); (byStart[k] = byStart[k] || []).push(e); });
    var loops = [];
    edges.forEach(function (e) {
      if (e.used) return;
      var loop = [], cur = e;
      while (cur && !cur.used) {
        cur.used = true;
        loop.push(cur.a);
        var cands = byStart[key(cur.b)] || [];
        cur = null;
        for (var j = 0; j < cands.length; j++) if (!cands[j].used) { cur = cands[j]; break; }
      }
      if (loop.length >= 3) loops.push(loop);
    });
    return loops;
  }

  // Hand-drawn jitter: subdivide each segment and push points along the normal.
  function wobble(pts, amp, rnd, closed, subdiv) {
    var out = [], n = pts.length;
    subdiv = subdiv || 2;
    for (var i = 0; i < n; i++) {
      var p = pts[i], q = pts[(i + 1) % n];
      if (!closed && i === n - 1) { out.push(p); break; }
      var dx = q.x - p.x, dy = q.y - p.y, len = Math.hypot(dx, dy) || 1, nx = -dy / len, ny = dx / len;
      out.push({ x: p.x + nx * (rnd() - 0.5) * amp, y: p.y + ny * (rnd() - 0.5) * amp });
      for (var s = 1; s < subdiv; s++) {
        var t = s / subdiv, w = (rnd() - 0.5) * amp * 1.6;
        out.push({ x: p.x + dx * t + nx * w, y: p.y + dy * t + ny * w });
      }
    }
    return out;
  }

  // Catmull-Rom spline sampled densely; returns points.
  function catmull(pts, closed, samples) {
    var n = pts.length, out = [];
    if (n < 2) return pts.slice();
    samples = samples || 6;
    var get = function (i) { return closed ? pts[((i % n) + n) % n] : pts[Math.max(0, Math.min(n - 1, i))]; };
    var segs = closed ? n : n - 1;
    for (var i = 0; i < segs; i++) {
      var p0 = get(i - 1), p1 = get(i), p2 = get(i + 1), p3 = get(i + 2);
      for (var s = 0; s < samples; s++) {
        var t = s / samples, t2 = t * t, t3 = t2 * t;
        out.push({
          x: 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
          y: 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3)
        });
      }
    }
    if (!closed) out.push(pts[n - 1]);
    return out;
  }

  function f1(v) { return Math.round(v * 10) / 10; }
  function pathOf(pts, closed) {
    if (!pts.length) return "";
    var d = "M" + f1(pts[0].x) + "," + f1(pts[0].y);
    for (var i = 1; i < pts.length; i++) d += "L" + f1(pts[i].x) + "," + f1(pts[i].y);
    return closed ? d + "Z" : d;
  }
  function pathLength(pts) {
    var L = 0;
    for (var i = 1; i < pts.length; i++) L += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    return L;
  }

  // A tapering ribbon (river body) around a dense centreline: width grows
  // from w0 at the start to w1 at the end. Returns a closed path.
  function ribbon(pts, w0, w1) {
    var n = pts.length, left = [], right = [];
    for (var i = 0; i < n; i++) {
      var a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
      var dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
      var nx = -dy / len, ny = dx / len, w = (w0 + (w1 - w0) * (i / (n - 1))) / 2;
      left.push({ x: pts[i].x + nx * w, y: pts[i].y + ny * w });
      right.push({ x: pts[i].x - nx * w, y: pts[i].y - ny * w });
    }
    return pathOf(left.concat(right.reverse()), true);
  }

  // ---------- glyphs ----------
  // Each generator returns an array of { d, k } where k is a style key:
  //   "body"  paper-coloured fill that hides what is behind the symbol
  //   "ink"   the outline stroke
  //   "hatch" lighter shading strokes
  // All glyphs are drawn inside a hex of radius S around (cx, cy) using a
  // seeded generator so the map is identical on every visit.

  // Scatter n points inside a disc, keeping them apart (dart throwing).
  function scatter(cx, cy, radius, n, minDist, rnd) {
    var pts = [], tries = 0;
    while (pts.length < n && tries < n * 40) {
      tries++;
      var a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * radius;
      var p = { x: cx + Math.cos(a) * d, y: cy + Math.sin(a) * d * 0.85 };
      var ok = true;
      for (var i = 0; i < pts.length; i++) if (Math.hypot(pts[i].x - p.x, pts[i].y - p.y) < minDist) { ok = false; break; }
      if (ok) pts.push(p);
    }
    return pts;
  }
  function P(x, y) { return f1(x) + "," + f1(y); }

  function mountains(cx, cy, S, imp, rnd) {
    var out = [], n = 2 + imp + (rnd() < 0.5 ? 1 : 0);
    var pts = scatter(cx, cy - S * 0.08, S * 0.42, n, S * 0.3, rnd);
    pts.sort(function (a, b) { return a.y - b.y; });
    pts.forEach(function (p, i) {
      var bw = S * (0.28 + rnd() * 0.16) * (i === pts.length - 1 ? 1.15 : 1), h = bw * (0.9 + rnd() * 0.5);
      var x = p.x, y = p.y;
      var kink = 0.15 + rnd() * 0.2;
      var ridge = "M" + P(x - bw, y) + "L" + P(x - bw * 0.35, y - h * (0.5 + rnd() * 0.15)) + "L" + P(x, y - h) +
        "L" + P(x + bw * kink, y - h * 0.8) + "L" + P(x + bw * 0.5, y - h * (0.35 + rnd() * 0.15)) + "L" + P(x + bw, y);
      out.push({ d: ridge + "Z", k: "body" });
      out.push({ d: ridge, k: "ink" });
      // shadow side: strokes from the sunward ridge down toward the foot
      var hatch = "";
      for (var f = 0.22; f < 0.95; f += 0.18) {
        var rx = x + bw * f, ry = y - h * (1 - f) * 0.92;
        hatch += "M" + P(rx, ry) + "L" + P(rx - bw * 0.22 * (1 - f) - bw * 0.05, y - h * (1 - f) * 0.25) ;
      }
      out.push({ d: hatch, k: "hatch" });
    });
    return out;
  }

  function forest(cx, cy, S, imp, rnd) {
    var out = [], n = 5 + imp * 2;
    var pts = scatter(cx, cy - S * 0.05, S * 0.44, n, S * 0.2, rnd);
    pts.sort(function (a, b) { return a.y - b.y; });
    pts.forEach(function (p) {
      var rc = S * (0.085 + rnd() * 0.04), t = rc * 1.1, x = p.x, y = p.y, ccy = y - t - rc * 0.8;
      // a scalloped crown: six bumps around the centre
      var crown = "", k = 6;
      for (var i = 0; i <= k; i++) {
        var a0 = Math.PI * 2 * (i / k) + 0.3, px = x + Math.cos(a0) * rc, py = ccy + Math.sin(a0) * rc * 0.9;
        if (i === 0) crown += "M" + P(px, py);
        else {
          var am = a0 - Math.PI / k, qx = x + Math.cos(am) * rc * 1.45, qy = ccy + Math.sin(am) * rc * 1.3;
          crown += "Q" + P(qx, qy) + " " + P(px, py);
        }
      }
      out.push({ d: crown + "Z", k: "body" });
      out.push({ d: crown + "Z", k: "ink" });
      out.push({ d: "M" + P(x, y) + "L" + P(x, ccy + rc * 0.6), k: "ink" });
      // a little shading on the lower right of the crown
      out.push({ d: "M" + P(x + rc * 0.25, ccy + rc * 0.75) + "l" + P(rc * 0.5, -rc * 0.35) + "M" + P(x + rc * 0.55, ccy + rc * 0.45) + "l" + P(rc * 0.4, -rc * 0.4), k: "hatch" });
    });
    return out;
  }

  function ruins(cx, cy, S, imp, rnd) {
    var out = [], n = 2 + Math.min(imp, 2);
    var pts = scatter(cx, cy - S * 0.02, S * 0.36, n, S * 0.26, rnd);
    pts.sort(function (a, b) { return a.y - b.y; });
    pts.forEach(function (p, i) {
      var cw = S * 0.045, h = S * (0.16 + rnd() * 0.22), x = p.x, y = p.y;
      var col = "M" + P(x - cw, y) + "L" + P(x - cw, y - h) + "L" + P(x - cw * 0.2, y - h * (0.85 + rnd() * 0.2)) +
        "L" + P(x + cw, y - h * (0.9 + rnd() * 0.15)) + "L" + P(x + cw, y) + "Z";
      out.push({ d: col, k: "body" });
      out.push({ d: col, k: "ink" });
      var drums = "";
      for (var dy = h * 0.3; dy < h * 0.95; dy += h * 0.3) drums += "M" + P(x - cw, y - dy) + "L" + P(x + cw, y - dy);
      out.push({ d: drums, k: "hatch" });
      out.push({ d: "M" + P(x + cw * 0.3, y - h * 0.15) + "L" + P(x + cw * 0.3, y - h * 0.85) + "M" + P(x + cw * 0.65, y - h * 0.1) + "L" + P(x + cw * 0.65, y - h * 0.8), k: "hatch" });
      if (i === 0) { // a fallen block and rubble beside the first column
        var bx = x + cw * 3.2, by = y - cw * 0.6;
        out.push({ d: "M" + P(bx, by) + "l" + P(cw * 2.2, -cw * 0.5) + "l" + P(cw * 0.3, cw * 1.0) + "l" + P(-cw * 2.2, cw * 0.5) + "Z", k: "ink" });
      }
    });
    var rub = "";
    scatter(cx, cy + S * 0.12, S * 0.4, 4 + imp, S * 0.12, rnd).forEach(function (r) { rub += "M" + P(r.x, r.y) + "l" + P(S * 0.03, -S * 0.01); });
    out.push({ d: rub, k: "ink" });
    // ground line
    out.push({ d: "M" + P(cx - S * 0.42, cy + S * 0.2) + "q" + P(S * 0.2, S * 0.05) + " " + P(S * 0.45, 0) + "q" + P(S * 0.2, -S * 0.04) + " " + P(S * 0.4, 0.01), k: "hatch" });
    return out;
  }

  function city(cx, cy, S, imp, rnd) {
    var out = [], n = 3 + imp;
    var pts = scatter(cx, cy - S * 0.02, S * 0.36, n, S * 0.2, rnd);
    pts.sort(function (a, b) { return a.y - b.y; });
    pts.forEach(function (p, i) {
      var w = S * (0.07 + rnd() * 0.04), h = S * (0.09 + rnd() * 0.07), rf = h * 0.6, x = p.x, y = p.y;
      var tower = imp >= 2 && i === pts.length - 1;
      if (tower) { w = S * 0.055; h = S * 0.3; rf = h * 0.35; }
      var house = "M" + P(x - w, y) + "L" + P(x - w, y - h) + "L" + P(x, y - h - rf) + "L" + P(x + w, y - h) + "L" + P(x + w, y) + "Z";
      out.push({ d: house, k: "body" });
      out.push({ d: house, k: "ink" });
      var det = "M" + P(x - w * 0.3, y) + "L" + P(x - w * 0.3, y - h * 0.45) + "L" + P(x + w * 0.3, y - h * 0.45) + "L" + P(x + w * 0.3, y);
      det += "M" + P(x + w * 0.35, y - h * 0.4) + "L" + P(x + w * 0.35, y - h) + "M" + P(x + w * 0.7, y - h * 0.3) + "L" + P(x + w * 0.7, y - h);
      if (tower) det += "M" + P(x, y - h - rf) + "L" + P(x, y - h - rf - S * 0.06) + "l" + P(S * 0.05, S * 0.02) + "l" + P(-S * 0.05, S * 0.02);
      out.push({ d: det, k: "hatch" });
    });
    return out;
  }

  function plain(cx, cy, S, imp, rnd) {
    var out = [], n = 5 + imp * 2, d = "";
    scatter(cx, cy - S * 0.04, S * 0.46, n, S * 0.17, rnd).forEach(function (p) {
      var s = S * (0.05 + rnd() * 0.03);
      d += "M" + P(p.x, p.y) + "l" + P(-s * 0.6, -s) + "M" + P(p.x + s * 0.1, p.y) + "l" + P(0.1 * s, -s * 1.25) + "M" + P(p.x + s * 0.25, p.y) + "l" + P(s * 0.7, -s * 0.9);
    });
    out.push({ d: d, k: "ink" });
    var dots = "";
    scatter(cx, cy, S * 0.5, 3 + imp, S * 0.15, rnd).forEach(function (p) { dots += "M" + P(p.x, p.y) + "l" + P(S * 0.02, 0); });
    out.push({ d: dots, k: "hatch" });
    return out;
  }

  function reeds(cx, cy, S, imp, rnd) {
    var out = [], d = "";
    scatter(cx, cy, S * 0.4, 3 + imp, S * 0.2, rnd).forEach(function (p) {
      var s = S * 0.06;
      d += "M" + P(p.x, p.y) + "l" + P(-s * 0.4, -s * 1.4) + "M" + P(p.x + s * 0.3, p.y) + "l" + P(0, -s * 1.7) + "M" + P(p.x + s * 0.6, p.y) + "l" + P(s * 0.45, -s * 1.3);
    });
    out.push({ d: d, k: "ink" });
    return out;
  }

  function waves(cx, cy, S, imp, rnd) {
    var out = [], d = "";
    scatter(cx, cy, S * 0.42, 3 + imp, S * 0.24, rnd).forEach(function (p) {
      var w = S * (0.1 + rnd() * 0.06);
      d += "M" + P(p.x - w, p.y) + "q" + P(w * 0.5, -w * 0.45) + " " + P(w, 0) + "q" + P(w * 0.5, w * 0.45) + " " + P(w, 0);
    });
    out.push({ d: d, k: "ink" });
    return out;
  }

  // A small sea serpent for the open sea (drawn once, not per hex).
  function serpent(cx, cy, S) {
    var out = [], body = "", w = S * 0.9, h = S * 0.16;
    body = "M" + P(cx - w * 0.5, cy) + "q" + P(w * 0.12, -h * 2) + " " + P(w * 0.25, 0) + "q" + P(w * 0.12, h * 2) + " " + P(w * 0.25, 0) + "q" + P(w * 0.12, -h * 2) + " " + P(w * 0.25, 0);
    out.push({ d: body, k: "ink" });
    // head at the right end, looking up
    var hx = cx + w * 0.25, hy = cy;
    var head = "M" + P(hx, hy) + "q" + P(h * 0.6, -h * 1.4) + " " + P(h * 1.6, -h * 1.5) + "l" + P(h * 0.5, -h * 0.4) + "l" + P(-h * 0.2, h * 0.7) + "q" + P(-h * 0.3, h * 0.9) + " " + P(-h * 1.9, h * 0.7);
    out.push({ d: head, k: "body" });
    out.push({ d: head, k: "ink" });
    out.push({ d: "M" + P(hx + h * 1.3, hy - h * 1.35) + "l" + P(h * 0.15, 0), k: "ink" });
    // fins on the humps
    out.push({ d: "M" + P(cx - w * 0.37, cy - h * 0.95) + "l" + P(h * 0.4, -h * 0.8) + "l" + P(h * 0.5, h * 0.9) + "M" + P(cx + w * 0.13, cy - h * 0.95) + "l" + P(h * 0.4, -h * 0.8) + "l" + P(h * 0.5, h * 0.9), k: "ink" });
    return out;
  }

  var GLYPHS = { mountain: mountains, forest: forest, ruin: ruins, city: city, plain: plain, river: reeds, sea: waves };
  function glyphsFor(terrain, cx, cy, S, imp, seed) {
    var gen = GLYPHS[terrain] || plain;
    return gen(cx, cy, S, imp, rng(hashStr(seed)));
  }

  // ---------- labels ----------
  // items: [{ x0, y0, x1, y1, priority }] in screen pixels. Returns an array
  // of booleans: true where the label may be shown. Greedy by priority.
  function placeLabels(items, pad) {
    pad = pad || 2;
    var order = items.map(function (it, i) { return i; }).sort(function (a, b) { return items[b].priority - items[a].priority; });
    var kept = [], show = items.map(function () { return false; });
    order.forEach(function (i) {
      var it = items[i];
      for (var j = 0; j < kept.length; j++) {
        var k = kept[j];
        if (it.x0 < k.x1 + pad && it.x1 > k.x0 - pad && it.y0 < k.y1 + pad && it.y1 > k.y0 - pad) return;
      }
      kept.push(it); show[i] = true;
    });
    return show;
  }

  // Split a place name into at most two balanced lines.
  function splitLabel(s, max) {
    max = max || 12;
    if (s.length <= max) return [s];
    var words = s.split(" "), best = null, bestDiff = 1e9;
    for (var i = 1; i < words.length; i++) {
      var a = words.slice(0, i).join(" "), b = words.slice(i).join(" ");
      var d = Math.abs(a.length - b.length);
      if (d < bestDiff) { bestDiff = d; best = [a, b]; }
    }
    return best || [s];
  }

  var G = {
    SQ3: SQ3, centre: centre, corner: corner, corners: corners, EDGE_DIRS: EDGE_DIRS,
    rng: rng, hashStr: hashStr, outline: outline, wobble: wobble, catmull: catmull,
    pathOf: pathOf, pathLength: pathLength, ribbon: ribbon, scatter: scatter,
    glyphsFor: glyphsFor, serpent: serpent, placeLabels: placeLabels, splitLabel: splitLabel
  };
  if (typeof module !== "undefined" && module.exports) module.exports = G;
  root.LLGEO = G;
})(typeof window !== "undefined" ? window : this);
