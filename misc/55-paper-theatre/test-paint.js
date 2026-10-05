/*
 * Paper Theatre - tests for the pixel pipeline of paint.js (Node only, no DOM).
 *
 *   node misc/55-paper-theatre/test-paint.js
 *
 * VNPaint.filter(rgba, width, height, opts) is the pure half of the painted scenery: the browser side (mount,
 * the worker, the cache) is driven in a real browser by scratch scripts, not here. What is pinned here are the
 * properties the theatre relies on: a picture always paints the same (the noise is seeded from its key), the
 * size and the alpha channel are kept, the picture's overall colour is not shifted, and a flat fill really does
 * come out as something with texture while an edge stays an edge.
 */
'use strict';
var path = require('path');
var P = require(path.join(__dirname, 'paint.js'));

var passes = 0, failures = 0;
function ok(cond, name, detail) {
  if (cond) { passes++; console.log('PASS ' + name); }
  else { failures++; console.log('FAIL ' + name + (detail ? '  (' + detail + ')' : '')); }
}

/* ------------------------------------------------------------------ test pictures */

// a flat picture with one vertical edge: left colour a, right colour b
function edgeImage(w, h, a, b, alpha) {
  var d = new Uint8ClampedArray(w * h * 4), x, y, i;
  for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
    var c = x < w / 2 ? a : b; i = (y * w + x) * 4;
    d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = alpha == null ? 255 : alpha;
  }
  return d;
}
// a small "scene": a sky gradient, a hill, a dark trunk, a few lit windows
function sceneImage(w, h) {
  var d = new Uint8ClampedArray(w * h * 4), x, y, i;
  for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
    var t = y / h, r = 250 - 120 * t, g = 170 + 20 * t, b = 120 + 110 * t;
    if (y > h * 0.62 + Math.sin(x / w * 6) * h * 0.05) { r = 70; g = 120; b = 60; }
    if (x > w * 0.2 && x < w * 0.24 && y > h * 0.3) { r = 60; g = 36; b = 30; }
    if (x % 40 < 5 && y % 30 < 5 && y < h * 0.3 && x > w * 0.6) { r = 255; g = 236; b = 170; }
    i = (y * w + x) * 4; d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255;
  }
  return d;
}
function mean(d) {
  var s = [0, 0, 0], n = d.length / 4, i;
  for (i = 0; i < d.length; i += 4) { s[0] += d[i]; s[1] += d[i + 1]; s[2] += d[i + 2]; }
  return [s[0] / n, s[1] / n, s[2] / n];
}
function same(a, b) {
  if (a.length !== b.length) return false;
  for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
// variance of the luminance inside a rectangle
function lumVar(d, w, x0, y0, x1, y1) {
  var s = 0, q = 0, n = 0, x, y;
  for (y = y0; y < y1; y++) for (x = x0; x < x1; x++) {
    var i = (y * w + x) * 4, l = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
    s += l; q += l * l; n++;
  }
  return q / n - (s / n) * (s / n);
}
function rectMean(d, w, x0, y0, x1, y1) {
  var s = [0, 0, 0], n = 0, x, y;
  for (y = y0; y < y1; y++) for (x = x0; x < x1; x++) { var i = (y * w + x) * 4; s[0] += d[i]; s[1] += d[i + 1]; s[2] += d[i + 2]; n++; }
  return [s[0] / n, s[1] / n, s[2] / n];
}

/* ------------------------------------------------------------------ the tests */

var W = 320, H = 180;
var flat = edgeImage(W, H, [208, 120, 96], [70, 110, 150]);
var scene = sceneImage(W, H);

// the module's shape
ok(typeof P.filter === 'function', 'module.exports.filter is a function');
ok(P.DEFAULTS && typeof P.DEFAULTS === 'object', 'DEFAULTS are exported');
ok(typeof P.mount === 'undefined', 'no browser half in Node (no document): only the pure pipeline is exported');

// determinism
var a1 = P.filter(scene, W, H, { seed: 'bg|sakura|dusk|' });
var a2 = P.filter(scene, W, H, { seed: 'bg|sakura|dusk|' });
var a3 = P.filter(scene, W, H, { seed: 'bg|library||' });
ok(same(a1, a2), 'deterministic: the same picture and key give the same pixels, byte for byte');
ok(!same(a1, a3), 'the key seeds the noise: another key gives another painting');
ok(same(P.filter(scene, W, H), P.filter(scene, W, H)), 'deterministic without a seed too (no Math.random, no clock)');
(function () {
  var real = Math.random, called = 0;
  Math.random = function () { called++; return real(); };
  P.filter(flat, W, H, { seed: 'x' });
  Math.random = real;
  ok(called === 0, 'Math.random is never called');
})();

// size, type, alpha, purity
ok(a1 instanceof Uint8ClampedArray && a1.length === W * H * 4, 'returns a Uint8ClampedArray of width * height * 4');
(function () {
  var copy = new Uint8ClampedArray(scene);
  var out = P.filter(scene, W, H, { seed: 'pure' });
  ok(same(copy, scene), 'the input array is not modified');
  ok(out !== scene && out.buffer !== scene.buffer, 'the result is a new array');
  var allOpaque = true;
  for (var i = 3; i < out.length; i += 4) if (out[i] !== 255) { allOpaque = false; break; }
  ok(allOpaque, 'an opaque picture stays opaque');
})();
(function () {
  // alpha is passed through untouched, whatever it is
  var d = edgeImage(96, 64, [200, 180, 90], [40, 60, 120]), i, x, y;
  for (y = 0; y < 64; y++) for (x = 0; x < 96; x++) d[(y * 96 + x) * 4 + 3] = (x * 5 + y * 3) & 255;
  var out = P.filter(d, 96, 64, { seed: 'alpha' }), okA = true;
  for (i = 3; i < d.length; i += 4) if (out[i] !== d[i]) { okA = false; break; }
  ok(okA, 'alpha is preserved pixel for pixel');
})();
(function () {
  // odd sizes, tiny pictures and a plain Uint8Array must not throw
  var sizes = [[1, 1], [2, 3], [7, 5], [33, 17], [640, 2]], fine = true, why = '';
  sizes.forEach(function (s) {
    try {
      var d = new Uint8Array(s[0] * s[1] * 4);
      for (var i = 0; i < d.length; i++) d[i] = (i * 37) & 255;
      var out = P.filter(d, s[0], s[1], { seed: 'tiny' });
      if (out.length !== d.length) { fine = false; why = s.join('x') + ' length'; }
      for (var k = 0; k < out.length; k++) if (out[k] !== out[k]) { fine = false; why = s.join('x') + ' NaN'; }
    } catch (e) { fine = false; why = s.join('x') + ' threw ' + e.message; }
  });
  ok(fine, 'tiny and odd-sized pictures are handled (1x1, 2x3, 7x5, 33x17, 640x2)', why);
  var z = P.filter(new Uint8ClampedArray(0), 0, 0, { seed: 'zero' });
  ok(z.length === 0, 'an empty picture gives an empty picture');
})();

// the mean colour stays where it was
(function () {
  var TOL = 6;   // of 255, per channel
  [['flat picture with one edge', flat], ['small scene', scene]].forEach(function (p) {
    var m0 = mean(p[1]), worst = 0, seeds = ['bg|sea||', 'bg|night||', 'cg|tree||', 'bg|lab|night|'];
    seeds.forEach(function (s) {
      var m1 = mean(P.filter(p[1], W, H, { seed: s }));
      for (var c = 0; c < 3; c++) worst = Math.max(worst, Math.abs(m1[c] - m0[c]));
    });
    ok(worst <= TOL, 'mean colour of a ' + p[0] + ' moves by at most ' + TOL + ' of 255 per channel', 'worst ' + worst.toFixed(2));
  });
  // a dark and a light flat picture: not lifted, not dulled
  [[[18, 20, 44], 'dark'], [[236, 230, 214], 'light']].forEach(function (p) {
    var d = edgeImage(W, H, p[0], p[0]), m1 = mean(P.filter(d, W, H, { seed: 'flat-' + p[1] })), worst = 0;
    for (var c = 0; c < 3; c++) worst = Math.max(worst, Math.abs(m1[c] - p[0][c]));
    ok(worst <= TOL, 'a flat ' + p[1] + ' picture keeps its colour within ' + TOL, 'worst ' + worst.toFixed(2));
  });
})();

// a flat fill gets texture; the edge stays an edge
(function () {
  var out = P.filter(flat, W, H, { seed: 'bg|classroom||' });
  var v0 = lumVar(flat, W, 20, 20, 140, 160), v1 = lumVar(out, W, 20, 20, 140, 160);
  var v0r = lumVar(flat, W, 180, 20, 300, 160), v1r = lumVar(out, W, 180, 20, 300, 160);
  ok(v0 < 1e-6 && v0r < 1e-6, 'the test picture really is flat on both sides of its edge');
  ok(v1 > 0.5 && v1r > 0.5, 'local variance appears inside both flat areas', 'left ' + v1.toFixed(2) + ', right ' + v1r.toFixed(2));
  ok(v1 < 200 && v1r < 200, 'and stays calm: no heavy noise', 'left ' + v1.toFixed(2) + ', right ' + v1r.toFixed(2));
  var changed = 0, i;
  for (i = 0; i < out.length; i += 4) if (out[i] !== flat[i] || out[i + 1] !== flat[i + 1] || out[i + 2] !== flat[i + 2]) changed++;
  ok(changed > W * H * 0.5, 'more than half of the pixels changed', changed + ' of ' + W * H);
  // the two sides are still two colours: the means of the two halves stay close to the originals
  var l = rectMean(out, W, 10, 10, 130, 170), r = rectMean(out, W, 190, 10, 310, 170);
  var dl = Math.max(Math.abs(l[0] - 208), Math.abs(l[1] - 120), Math.abs(l[2] - 96));
  var dr = Math.max(Math.abs(r[0] - 70), Math.abs(r[1] - 110), Math.abs(r[2] - 150));
  ok(dl < 12 && dr < 12, 'each side keeps its own colour', 'left off by ' + dl.toFixed(1) + ', right by ' + dr.toFixed(1));
  // the edge is still there, within a few pixels of the middle, on every row (it may wobble: that is the warp)
  var worst = 0, lost = 0, y, x;
  for (y = 4; y < H - 4; y++) {
    var at = -1;
    for (x = 1; x < W; x++) {
      var p = (y * W + x) * 4;
      // red falls from ~208 to ~70 across the edge: where it first drops below the midpoint
      if (out[p] < 139) { at = x; break; }
    }
    if (at < 0) lost++; else worst = Math.max(worst, Math.abs(at - W / 2));
  }
  ok(lost === 0 && worst <= 8, 'the edge is kept on every row, within 8 px of where it was', 'lost on ' + lost + ' rows, worst offset ' + worst);
  // at full scale (a 1600-wide picture has scale 1; this small one is painted as a detail of one) the edge wobbles
  var full = P.filter(flat, W, H, { seed: 'bg|classroom||', scale: 1 }), wob = {}, n = 0;
  for (y = 4; y < H - 4; y++) for (x = 1; x < W; x++) if (full[(y * W + x) * 4] < 139) { wob[x] = 1; break; }
  for (var k in wob) n++;
  ok(n > 1 && n < 14, 'at full scale the edge is not ruler straight any more, and still one edge (it sits at ' + n + ' different columns)');
})();

// each stage can be switched off, and with everything off the picture comes through (nearly) untouched
(function () {
  var off = { seed: 'off', warp: 0, vary: 0, dab: 0, radius: 0, strokes: 0, edge: 0, grain: 0, bloom: 0, detail: 0, clarity: 0, saturation: 1 };
  var out = P.filter(scene, W, H, off), worst = 0, i;
  for (i = 0; i < out.length; i++) worst = Math.max(worst, Math.abs(out[i] - scene[i]));
  ok(worst <= 1, 'with every stage at zero the picture passes through', 'worst channel difference ' + worst);
  var names = ['warp', 'vary', 'dab', 'radius', 'strokes', 'grain', 'bloom'], dead = [];
  names.forEach(function (k) {
    var o = {}, j; for (j in off) o[j] = off[j];
    o[k] = P.DEFAULTS[k];
    if (same(P.filter(scene, W, H, o), out)) dead.push(k);
  });
  ok(dead.length === 0, 'each stage does something on its own: ' + names.join(', '), 'no effect: ' + dead.join(', '));
})();

// the overlay (the scene's text, kept crisp) is composited over the painting untouched
(function () {
  var ov = new Uint8ClampedArray(W * H * 4), x, y, i;
  for (y = 60; y < 80; y++) for (x = 100; x < 200; x++) { i = (y * W + x) * 4; ov[i] = 250; ov[i + 1] = 250; ov[i + 2] = 240; ov[i + 3] = 255; }
  for (y = 100; y < 110; y++) for (x = 100; x < 200; x++) { i = (y * W + x) * 4; ov[i] = 0; ov[i + 1] = 0; ov[i + 2] = 0; ov[i + 3] = 128; }
  var base = P.filter(scene, W, H, { seed: 'ov' }), out = P.filter(scene, W, H, { seed: 'ov', overlay: ov }), exact = true, half = true, rest = true;
  for (y = 0; y < H; y++) for (x = 0; x < W; x++) {
    i = (y * W + x) * 4;
    if (ov[i + 3] === 255) { if (out[i] !== 250 || out[i + 1] !== 250 || out[i + 2] !== 240) exact = false; }
    else if (ov[i + 3] === 128) { if (Math.abs(out[i] - base[i] * (1 - 128 / 255)) > 1.5) half = false; }
    else if (out[i] !== base[i] || out[i + 1] !== base[i + 1] || out[i + 2] !== base[i + 2]) rest = false;
  }
  ok(exact, 'opaque overlay pixels come out exactly as given (text stays crisp)');
  ok(half, 'half-transparent overlay pixels are blended over the painting');
  ok(rest, 'where the overlay is empty the painting is untouched');
})();

// scale: the same picture at two sizes is painted with proportionate strokes (not a byte comparison: a sanity check)
(function () {
  var big = sceneImage(640, 360), t = Date.now(), out = P.filter(big, 640, 360, { seed: 'bg|sakura|dusk|' }), ms = Date.now() - t;
  var m0 = mean(big), m1 = mean(out), worst = 0;
  for (var c = 0; c < 3; c++) worst = Math.max(worst, Math.abs(m1[c] - m0[c]));
  ok(out.length === big.length && worst <= 6, '640x360: size kept, mean colour within 6', 'worst ' + worst.toFixed(2) + ', ' + ms + ' ms');
})();

// hash: the seed of a key is stable (pinned: changing it repaints every picture differently)
ok(P.hash('bg|sakura|dusk|') === P.hash('bg|sakura|dusk|') && P.hash('a') !== P.hash('b'), 'hash is stable and separates keys');

console.log(passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
