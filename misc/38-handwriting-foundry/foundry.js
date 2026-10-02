/* Handwriting Foundry engine: stroke smoothing, stroke-to-outline, glyph set
   assembly, OpenType font building (via an injected opentype.js) and an SVG
   sheet. Pure functions, no DOM, so it also runs under Node for testing.
   Coordinates are font units: 1000 per em, y up, baseline at 0. */
(function (root) {
  'use strict';

  var UPM = 1000, ASC = 800, DESC = -200, XH = 500, CAP = 700;
  var SB = 55;                 // side bearing added on both sides of the ink
  var MIN_ADV = 180;           // narrowest glyph (a dot still needs room)

  // Glyph roster with Adobe glyph names.
  var PUNCT = { '.': 'period', ',': 'comma', ';': 'semicolon', ':': 'colon', '!': 'exclam', '?': 'question',
    "'": 'quotesingle', '"': 'quotedbl', '-': 'hyphen', '(': 'parenleft', ')': 'parenright', ' ': 'space' };
  var DIGITS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
  var GLYPHS = [];
  var i;
  for (i = 0; i < 26; i++) GLYPHS.push({ c: String.fromCharCode(97 + i), n: String.fromCharCode(97 + i), g: 'lower' });
  for (i = 0; i < 26; i++) GLYPHS.push({ c: String.fromCharCode(65 + i), n: String.fromCharCode(65 + i), g: 'upper' });
  for (i = 0; i < 10; i++) GLYPHS.push({ c: String(i), n: DIGITS[i], g: 'digit' });
  '.,;:!?\'"-()'.split('').forEach(function (c) { GLYPHS.push({ c: c, n: PUNCT[c], g: 'punct' }); });
  GLYPHS.push({ c: ' ', n: 'space', g: 'punct' });

  /* ---------- small helpers ---------- */
  function hashStr(s) {
    var h = 2166136261;
    for (var k = 0; k < s.length; k++) { h ^= s.charCodeAt(k); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function rng(seed) {
    var a = (typeof seed === 'number' ? seed : hashStr(String(seed))) >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function dist(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1]); }
  function pres(p) { return (p[2] == null || isNaN(p[2])) ? 0.5 : Math.max(0, Math.min(1, p[2])); }

  /* ---------- smoothing ---------- */
  function dedupe(pts, minD) {
    var out = [];
    for (var k = 0; k < pts.length; k++) {
      var p = [+pts[k][0], +pts[k][1], pres(pts[k])];
      if (!out.length || dist(out[out.length - 1], p) >= minD) out.push(p);
      else out[out.length - 1][2] = (out[out.length - 1][2] + p[2]) / 2;
    }
    return out;
  }
  function average121(pts) {
    if (pts.length < 3) return pts;
    var out = [pts[0]];
    for (var k = 1; k < pts.length - 1; k++) {
      var a = pts[k - 1], b = pts[k], c = pts[k + 1];
      out.push([(a[0] + 2 * b[0] + c[0]) / 4, (a[1] + 2 * b[1] + c[1]) / 4, (a[2] + 2 * b[2] + c[2]) / 4]);
    }
    out.push(pts[pts.length - 1]);
    return out;
  }
  function catmull(pts) {
    if (pts.length < 3) return pts.slice();
    var out = [pts[0]];
    for (var k = 0; k < pts.length - 1; k++) {
      var p0 = pts[Math.max(k - 1, 0)], p1 = pts[k], p2 = pts[k + 1], p3 = pts[Math.min(k + 2, pts.length - 1)];
      var n = Math.max(1, Math.min(12, Math.round(dist(p1, p2) / 10)));
      for (var s = 1; s <= n; s++) {
        var t = s / n, t2 = t * t, t3 = t2 * t;
        var x = 0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3);
        var y = 0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3);
        out.push([x, y, p1[2] + (p2[2] - p1[2]) * t]);
      }
    }
    return out;
  }
  // Ramer-Douglas-Peucker on x/y, keeping pressure of retained points.
  function rdp(pts, eps) {
    if (pts.length < 3) return pts.slice();
    var keep = new Array(pts.length);
    keep[0] = keep[pts.length - 1] = true;
    var stack = [[0, pts.length - 1]];
    while (stack.length) {
      var seg = stack.pop(), a = seg[0], b = seg[1];
      var A = pts[a], B = pts[b], dx = B[0] - A[0], dy = B[1] - A[1], L = Math.hypot(dx, dy) || 1e-9;
      var best = -1, bestD = eps;
      for (var k = a + 1; k < b; k++) {
        var d = L < 1e-6 ? dist(pts[k], A) : Math.abs((pts[k][0] - A[0]) * dy - (pts[k][1] - A[1]) * dx) / L;
        if (d > bestD) { bestD = d; best = k; }
      }
      if (best > 0) { keep[best] = true; stack.push([a, best], [best, b]); }
    }
    var out = [];
    for (var m = 0; m < pts.length; m++) if (keep[m]) out.push(pts[m]);
    return out;
  }
  // Raw pointer samples -> smoothed, simplified polyline stored for the glyph.
  function smoothStroke(raw) {
    var pts = dedupe(raw, 3);
    if (!pts.length) return [];
    if (pts.length === 1) return [[Math.round(pts[0][0]), Math.round(pts[0][1]), round2(pts[0][2])]];
    pts = average121(pts);
    pts = catmull(pts);
    pts = rdp(pts, 1.5);
    return pts.map(function (p) { return [Math.round(p[0]), Math.round(p[1]), round2(p[2])]; });
  }
  function round2(v) { return Math.round(v * 100) / 100; }

  /* ---------- stroke -> closed outline ---------- */
  function halfWidth(width, p) { return (width / 2) * (0.55 + 0.9 * pres(p)); }
  function wrapAngle(a) { while (a > Math.PI) a -= 2 * Math.PI; while (a <= -Math.PI) a += 2 * Math.PI; return a; }
  function arcInto(out, c, r, a0, delta) {
    var steps = Math.max(1, Math.ceil(Math.abs(delta) / (Math.PI / 8)));
    for (var k = 1; k < steps; k++) {
      var a = a0 + delta * k / steps;
      out.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]);
    }
  }
  function circle(c, r, n) {
    var out = [];
    for (var k = 0; k < n; k++) { var a = -2 * Math.PI * k / n; out.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]); }
    return out;
  }
  function finishContour(out) {
    var res = [];
    for (var k = 0; k < out.length; k++) {
      var p = [Math.round(out[k][0]), Math.round(out[k][1])];
      if (res.length && res[res.length - 1][0] === p[0] && res[res.length - 1][1] === p[1]) continue;
      res.push(p);
    }
    if (res.length > 1 && res[0][0] === res[res.length - 1][0] && res[0][1] === res[res.length - 1][1]) res.pop();
    return res;
  }
  // Offsets a polyline on both sides, round joins on the outer side of each turn,
  // round caps at both ends. One closed contour, traversed clockwise (y up).
  function strokeOutline(pts, width) {
    var P = dedupe(pts, 0.5);
    if (!P.length) return null;
    if (P.length === 1) return finishContour(circle(P[0], halfWidth(width, P[0]), 14));
    var n = P.length, d = [], nr = [];
    for (var k = 0; k < n - 1; k++) {
      var dx = P[k + 1][0] - P[k][0], dy = P[k + 1][1] - P[k][1], L = Math.hypot(dx, dy);
      d.push([dx / L, dy / L]); nr.push([-dy / L, dx / L]);
    }
    var out = [], hw, cr, a0;
    var at = function (p, nv, h) { return [p[0] + nv[0] * h, p[1] + nv[1] * h]; };
    var ang = function (v) { return Math.atan2(v[1], v[0]); };
    // left side, forward
    out.push(at(P[0], nr[0], halfWidth(width, P[0])));
    for (k = 1; k < n - 1; k++) {
      hw = halfWidth(width, P[k]);
      cr = d[k - 1][0] * d[k][1] - d[k - 1][1] * d[k][0];
      out.push(at(P[k], nr[k - 1], hw));
      if (cr < -1e-9) { a0 = ang(nr[k - 1]); arcInto(out, P[k], hw, a0, wrapAngle(ang(nr[k]) - a0)); }
      out.push(at(P[k], nr[k], hw));
    }
    hw = halfWidth(width, P[n - 1]);
    out.push(at(P[n - 1], nr[n - 2], hw));
    arcInto(out, P[n - 1], hw, ang(nr[n - 2]), -Math.PI);              // end cap
    out.push([P[n - 1][0] - nr[n - 2][0] * hw, P[n - 1][1] - nr[n - 2][1] * hw]);
    // right side, backward
    for (k = n - 2; k >= 1; k--) {
      hw = halfWidth(width, P[k]);
      cr = d[k - 1][0] * d[k][1] - d[k - 1][1] * d[k][0];
      out.push(at(P[k], nr[k], -hw));
      if (cr > 1e-9) { a0 = ang([-nr[k][0], -nr[k][1]]); arcInto(out, P[k], hw, a0, wrapAngle(ang([-nr[k - 1][0], -nr[k - 1][1]]) - a0)); }
      out.push(at(P[k], nr[k - 1], -hw));
    }
    hw = halfWidth(width, P[0]);
    out.push(at(P[0], nr[0], -hw));
    arcInto(out, P[0], hw, ang([-nr[0][0], -nr[0][1]]), -Math.PI);      // start cap
    return finishContour(out);
  }
  function glyphContours(strokes, width) {
    var out = [];
    for (var k = 0; k < strokes.length; k++) {
      var c = strokeOutline(strokes[k], width);
      if (c && c.length >= 3) out.push(c);
    }
    return out;
  }
  function bbox(contours) {
    var b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    contours.forEach(function (c) { c.forEach(function (p) {
      if (p[0] < b.minX) b.minX = p[0]; if (p[0] > b.maxX) b.maxX = p[0];
      if (p[1] < b.minY) b.minY = p[1]; if (p[1] > b.maxY) b.maxY = p[1];
    }); });
    if (b.minX === Infinity) return null;
    return b;
  }
  function shiftContours(contours, dx, dy) {
    return contours.map(function (c) { return c.map(function (p) { return [p[0] + dx, p[1] + dy]; }); });
  }

  /* ---------- stroke transforms ---------- */
  function mapStrokes(strokes, f) {
    return strokes.map(function (s) { return s.map(function (p, idx, arr) { return f(p, idx, arr); }); });
  }
  function scaleStrokes(strokes, s) {
    return mapStrokes(strokes, function (p) { return [Math.round(p[0] * s), Math.round(p[1] * s), pres(p)]; });
  }
  // Smooth 1-D noise in [-1,1] along a stroke: random values every `period` points, cosine blended.
  function smoothNoise(rand, n, period) {
    var knots = [], m = Math.ceil(n / period) + 2, k;
    for (k = 0; k < m; k++) knots.push(rand() * 2 - 1);
    var out = [];
    for (k = 0; k < n; k++) {
      var t = k / period, i0 = Math.floor(t), f = t - i0, w = (1 - Math.cos(f * Math.PI)) / 2;
      out.push(knots[i0] * (1 - w) + knots[i0 + 1] * w);
    }
    return out;
  }
  // Small random perturbations: whole-stroke drift plus a slow wobble along the stroke.
  function jitterStrokes(strokes, seed, amp) {
    var rand = rng(seed);
    amp = amp == null ? 10 : amp;
    return strokes.map(function (s) {
      var ox = (rand() * 2 - 1) * amp, oy = (rand() * 2 - 1) * amp, rot = (rand() * 2 - 1) * 0.03;
      var nx = smoothNoise(rand, s.length, 6), ny = smoothNoise(rand, s.length, 6), np = smoothNoise(rand, s.length, 8);
      var cx = 0, cy = 0;
      s.forEach(function (p) { cx += p[0]; cy += p[1]; }); cx /= s.length; cy /= s.length;
      var cs = Math.cos(rot), sn = Math.sin(rot);
      return s.map(function (p, k) {
        var x = p[0] - cx, y = p[1] - cy;
        return [Math.round(cx + x * cs - y * sn + ox + nx[k] * amp * 0.6),
                Math.round(cy + x * sn + y * cs + oy + ny[k] * amp * 0.6),
                round2(Math.max(0.1, Math.min(1, pres(p) + np[k] * 0.08)))];
      });
    });
  }
  // The sample skeleton, written out "by hand": slant, wobble, pressure, a slightly bouncy baseline.
  function sampleHand(sample, seed) {
    var out = {}, rand = rng(seed == null ? 'nietztein' : seed);
    var slant = 0.11;
    Object.keys(sample.glyphs).forEach(function (c) {
      var bounce = (rand() * 2 - 1) * 8, sq = 1 + (rand() * 2 - 1) * 0.04;
      var strokes = sample.glyphs[c].map(function (s) {
        var raw = s.map(function (p) { return [p[0], p[1], 0.5]; });
        var sm = raw.length > 2 ? rdp(catmull(dedupe(raw, 1)), 1.5) : raw;
        var n = sm.length, nx = smoothNoise(rand, n, 5), ny = smoothNoise(rand, n, 5), np = smoothNoise(rand, n, 7);
        var phase = rand() * Math.PI * 2;
        return sm.map(function (p, k) {
          var x = p[0] * sq + slant * p[1] + nx[k] * 6, y = p[1] + bounce + ny[k] * 6;
          var pr = 0.5 + 0.14 * Math.sin(phase + k * 0.35) + np[k] * 0.12;
          return [Math.round(x), Math.round(y), round2(Math.max(0.2, Math.min(0.85, pr)))];
        });
      });
      out[c] = strokes;
    });
    return out;
  }

  /* ---------- glyph set ---------- */
  function hasInk(strokes) { return !!(strokes && strokes.length); }
  function findGlyph(c) { for (var k = 0; k < GLYPHS.length; k++) if (GLYPHS[k].c === c) return GLYPHS[k]; return null; }
  // opts: { width, fill, jitter, seed, space, sample }  (sample = strokes-by-char used to fill gaps)
  function buildGlyphSet(byChar, opts) {
    opts = opts || {};
    var width = opts.width || 60, seed = opts.seed || 'foundry';
    var glyphs = [], drawn = 0, filled = 0, missing = [];
    GLYPHS.forEach(function (g) {
      var c = g.c, strokes = byChar[c], source = 'drawn';
      if (c === ' ') {
        glyphs.push({ c: c, name: g.n, unicode: 32, advance: Math.round(opts.space || 320), contours: [], alts: [], source: 'space' });
        return;
      }
      if (!hasInk(strokes) && opts.fill) {
        var sib = null;
        if (g.g === 'lower' && hasInk(byChar[c.toUpperCase()])) sib = scaleStrokes(byChar[c.toUpperCase()], XH / CAP);
        else if (g.g === 'upper' && hasInk(byChar[c.toLowerCase()])) sib = scaleStrokes(byChar[c.toLowerCase()], CAP / XH);
        if (sib) { strokes = sib; source = 'sibling'; }
        else if (opts.sample && hasInk(opts.sample[c])) { strokes = opts.sample[c]; source = 'sample'; }
      }
      if (!hasInk(strokes)) { missing.push(c); return; }
      var contours = glyphContours(strokes, width);
      var b = bbox(contours);
      if (!b) { missing.push(c); return; }
      var dx = SB - b.minX;
      var advance = Math.max(MIN_ADV, Math.round(b.maxX - b.minX + 2 * SB));
      var alts = [];
      if (opts.jitter) {
        for (var k = 1; k <= 2; k++) alts.push(shiftContours(glyphContours(jitterStrokes(strokes, seed + '/' + c + '/' + k, 10), width), dx, 0));
      }
      if (source === 'drawn') drawn++; else filled++;
      glyphs.push({ c: c, name: g.n, unicode: c.charCodeAt(0), advance: advance, contours: shiftContours(contours, dx, 0), alts: alts, source: source });
    });
    return { glyphs: glyphs, drawn: drawn, filled: filled, missing: missing, width: width };
  }

  /* ---------- OpenType font ---------- */
  function toPath(opentype, contours) {
    var path = new opentype.Path();
    contours.forEach(function (c) {
      if (c.length < 3) return;
      path.moveTo(c[0][0], c[0][1]);
      for (var k = 1; k < c.length; k++) path.lineTo(c[k][0], c[k][1]);
      path.close();
    });
    return path;
  }
  function notdefContours() {
    // Hollow box: outer clockwise, inner counter-clockwise so nonzero leaves a hole.
    return [[[60, 0], [60, 700], [440, 700], [440, 0]], [[110, 50], [390, 50], [390, 650], [110, 650]]];
  }
  function safeFamily(name) {
    var s = String(name || '').replace(/[^\x20-\x7E]/g, '').replace(/[^A-Za-z0-9 \-]/g, '').trim();
    return (s || 'Foundry Hand').slice(0, 40);
  }
  function makeFont(opentype, set, familyName) {
    var fam = safeFamily(familyName);
    var glyphs = [new opentype.Glyph({ name: '.notdef', unicode: 0, advanceWidth: 500, path: toPath(opentype, notdefContours()) })];
    var altPairs = [];
    set.glyphs.forEach(function (g) {
      var idx = glyphs.length;
      glyphs.push(new opentype.Glyph({ name: g.name, unicode: g.unicode, advanceWidth: g.advance, path: toPath(opentype, g.contours) }));
      if (g.alts && g.alts.length) {
        var by = [];
        g.alts.forEach(function (alt, k) {
          by.push(glyphs.length);
          glyphs.push(new opentype.Glyph({ name: g.name + '.alt' + (k + 1), advanceWidth: g.advance, path: toPath(opentype, alt) }));
        });
        altPairs.push({ sub: idx, by: by });
      }
    });
    var font = new opentype.Font({
      familyName: fam, styleName: 'Regular', unitsPerEm: UPM, ascender: ASC, descender: DESC, glyphs: glyphs,
      designer: 'drawn in Handwriting Foundry', description: 'A hand-drawn font made in the browser with Handwriting Foundry (nietztein.github.io).'
    });
    var saltOk = false;
    if (altPairs.length) {
      try { altPairs.forEach(function (p) { font.substitution.addAlternate('salt', p); }); saltOk = true; }
      catch (e) { saltOk = false; }
    }
    return { font: font, family: fam, glyphCount: glyphs.length, salt: saltOk };
  }

  /* ---------- SVG sheet (works without opentype.js) ---------- */
  function pathData(contours) {
    return contours.map(function (c) {
      return 'M' + c.map(function (p) { return p[0] + ' ' + p[1]; }).join('L') + 'Z';
    }).join('');
  }
  function escapeXml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function svgSheet(set, title) {
    var cols = 10, cell = 110, pad = 12, k = 0.09;   // 1000 units -> 90 px, cell is 110 px square
    var items = set.glyphs.filter(function (g) { return g.c !== ' '; });
    var rows = Math.ceil(items.length / cols);
    var W = cols * cell + pad * 2, H = rows * cell + pad * 2 + 36;
    var s = '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">';
    s += '<rect width="100%" height="100%" fill="#f3ead8"/>';
    s += '<text x="' + pad + '" y="' + (pad + 18) + '" font-family="Georgia, serif" font-size="16" fill="#3a2f22">' + escapeXml(title || 'Handwriting Foundry') + '</text>';
    items.forEach(function (g, idx) {
      var cx = pad + (idx % cols) * cell, cy = pad + 30 + Math.floor(idx / cols) * cell;
      s += '<g transform="translate(' + cx + ',' + cy + ')">';
      s += '<rect width="' + cell + '" height="' + cell + '" fill="none" stroke="#d9c9a6" stroke-width="0.5"/>';
      var base = 8 + (ASC + 50) * k;  // baseline y within cell
      s += '<line x1="4" y1="' + base + '" x2="' + (cell - 4) + '" y2="' + base + '" stroke="#c9b48a" stroke-width="0.6"/>';
      s += '<text x="5" y="12" font-family="monospace" font-size="9" fill="#9a8866">' + escapeXml(g.c) + '</text>';
      var ox = (cell - g.advance * k) / 2;
      s += '<path transform="translate(' + ox.toFixed(1) + ',' + base.toFixed(1) + ') scale(' + k + ',' + (-k) + ')" d="' + pathData(g.contours) + '" fill="#1b1a2e" fill-rule="nonzero"/>';
      s += '</g>';
    });
    s += '</svg>';
    return s;
  }

  var F = {
    UPM: UPM, ASC: ASC, DESC: DESC, XH: XH, CAP: CAP, SB: SB, GLYPHS: GLYPHS,
    rng: rng, hashStr: hashStr,
    smoothStroke: smoothStroke, strokeOutline: strokeOutline, glyphContours: glyphContours, bbox: bbox,
    jitterStrokes: jitterStrokes, scaleStrokes: scaleStrokes, sampleHand: sampleHand,
    buildGlyphSet: buildGlyphSet, makeFont: makeFont, safeFamily: safeFamily,
    pathData: pathData, svgSheet: svgSheet, findGlyph: findGlyph
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = F;
  else root.FOUNDRY = F;
})(typeof window !== 'undefined' ? window : this);
