/*
 * paint.js (VNPaint): turns Paper Theatre's flat vector scenery into a painted picture.
 *
 * Two parts:
 *  - filter(rgba, width, height, opts) -> rgba : the pure pixel pipeline (no DOM). Node loads it through
 *    module.exports (test-paint.js); paint-worker.js runs the very same function off the main thread.
 *  - mount / unmount / setEnabled (and prepare, stats) : the browser side. The scene's SVG is made a standalone
 *    document (explicit size, the shared vnf- filters inlined, the text kept out), rasterised off the main thread
 *    (createImageBitmap) and handed to a worker, which paints and encodes it; the result is put in the layer as
 *    <img class="vn-painted"> over the SVG, with the scene's text drawn back crisp on top. One painting per key,
 *    cached in memory (14 at most, blob URLs revoked as they leave). A cached picture is mounted in the same
 *    frame as its SVG; a new one fades in when it is ready. The pictures that come next in the script are
 *    painted ahead of time, so a new scene normally opens painted.
 *
 * The pipeline, in order:
 *   1. irregularity: a slight low-frequency warp of every edge, then colour variation (a broad drift of value and
 *      warmth, and a brush-sized mottle), because a flat fill gives a paint filter nothing to work with;
 *   2. a smooth (weighted four-quadrant) Kuwahara pass: areas become dabs, edges stay;
 *   3. brush strokes: soft strokes stamped along the picture's own edges (and along a slow noise field in open
 *      areas), each loaded with slightly different paint; broad in open areas, small and plain where the picture
 *      is busy, fainter on pale greys, and never carried across an edge onto another colour;
 *   4. the fine detail the dabs wiped out (thin lines, lit windows, stars) drawn back in; pigment pooling at the
 *      edges; a little bloom from the highlights; a canvas tooth.
 * Everything random is seeded from opts.seed (the picture's key), so a scene always paints the same.
 * The mean colour of the picture is kept (test-paint.js pins that), so the painting sits where the SVG sat.
 */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.VNPaint = api;
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  /* ------------------------------------------------------------------ seeded noise */

  function hashStr(s) {
    s = String(s == null ? '' : s);
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function rngFrom(seed) {
    var a = (typeof seed === 'number' ? seed : hashStr(seed)) >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  // Smooth value noise in [-1, 1] over the whole picture, `cell` pixels per lattice step, `oct` octaves.
  function noiseField(w, h, cell, oct, rng) {
    var out = new Float32Array(w * h), amp = 1, total = 0, o, x, y;
    for (o = 0; o < oct; o++) {
      var c = Math.max(2, cell), gw = Math.ceil(w / c) + 2, gh = Math.ceil(h / c) + 2, g = new Float32Array(gw * gh), i;
      for (i = 0; i < g.length; i++) g[i] = rng() * 2 - 1;
      var ox = rng() * c, oy = rng() * c;
      // precompute per column / per row lattice index and smooth weight
      var xi = new Int32Array(w), xf = new Float32Array(w), yi, yf;
      for (x = 0; x < w; x++) { var fx = (x + ox) / c, ix = Math.floor(fx), tx = fx - ix; xi[x] = ix; xf[x] = tx * tx * (3 - 2 * tx); }
      for (y = 0; y < h; y++) {
        var fy = (y + oy) / c; yi = Math.floor(fy); var ty = fy - yi; yf = ty * ty * (3 - 2 * ty);
        var r0 = yi * gw, r1 = r0 + gw, row = y * w;
        for (x = 0; x < w; x++) {
          var k = xi[x], sx = xf[x];
          var a = g[r0 + k] + (g[r0 + k + 1] - g[r0 + k]) * sx;
          var b = g[r1 + k] + (g[r1 + k + 1] - g[r1 + k]) * sx;
          out[row + x] += (a + (b - a) * yf) * amp;
        }
      }
      total += amp; amp *= 0.5; cell = cell / 2;
    }
    for (x = 0; x < out.length; x++) out[x] /= total;
    return out;
  }

  /* ------------------------------------------------------------------ helpers */

  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  // box blur of a single float channel, separable, `passes` times (three passes come close to a gaussian)
  function boxBlur(src, w, h, r, passes) {
    var a = src, b = new Float32Array(w * h), x, y, i, acc, n = 2 * r + 1, p;
    if (r < 1) return src;
    for (p = 0; p < passes; p++) {
      for (y = 0; y < h; y++) {
        var row = y * w; acc = 0;
        for (i = -r; i <= r; i++) acc += a[row + (i < 0 ? 0 : i >= w ? w - 1 : i)];
        for (x = 0; x < w; x++) {
          b[row + x] = acc / n;
          var add = x + r + 1, sub = x - r;
          acc += a[row + (add >= w ? w - 1 : add)] - a[row + (sub < 0 ? 0 : sub)];
        }
      }
      if (a === src) a = new Float32Array(w * h);   // never write into the caller's array
      for (x = 0; x < w; x++) {
        acc = 0;
        for (i = -r; i <= r; i++) acc += b[(i < 0 ? 0 : i >= h ? h - 1 : i) * w + x];
        for (y = 0; y < h; y++) {
          a[y * w + x] = acc / n;
          var add2 = y + r + 1, sub2 = y - r;
          acc += b[(add2 >= h ? h - 1 : add2) * w + x] - b[(sub2 < 0 ? 0 : sub2) * w + x];
        }
      }
    }
    return a;
  }

  /* ------------------------------------------------------------------ the stages */

  // 1a. warp: every pixel is read from a slightly displaced place (bilinear), so straight vector edges wobble
  function warp(R, G, B, w, h, amt, cell, rng) {
    if (amt <= 0) return [R, G, B];
    var dx = noiseField(w, h, cell, 2, rng), dy = noiseField(w, h, cell, 2, rng);
    var r2 = new Float32Array(w * h), g2 = new Float32Array(w * h), b2 = new Float32Array(w * h), x, y;
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
      var i = y * w + x, sx = x + dx[i] * amt, sy = y + dy[i] * amt;
      if (sx < 0) sx = 0; else if (sx > w - 1) sx = w - 1;
      if (sy < 0) sy = 0; else if (sy > h - 1) sy = h - 1;
      var x0 = sx | 0, y0 = sy | 0, x1 = x0 < w - 1 ? x0 + 1 : x0, y1 = y0 < h - 1 ? y0 + 1 : y0, fx = sx - x0, fy = sy - y0;
      var a = y0 * w + x0, b = y0 * w + x1, c = y1 * w + x0, d = y1 * w + x1;
      var w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
      r2[i] = R[a] * w00 + R[b] * w10 + R[c] * w01 + R[d] * w11;
      g2[i] = G[a] * w00 + G[b] * w10 + G[c] * w01 + G[d] * w11;
      b2[i] = B[a] * w00 + B[b] * w10 + B[c] * w01 + B[d] * w11;
    }
    return [r2, g2, b2];
  }

  // 1b. colour variation: broad value and warmth drifts, and a finer mottle; mean-free by construction
  // `amt` is the broad drift (hundreds of pixels); `dab` is a mottle a few brush-widths across, which the Kuwahara
  // pass after it turns into separate dabs of slightly different value and warmth
  function vary(R, G, B, w, h, amt, dab, s, rng) {
    if (amt <= 0 && dab <= 0) return;
    var big = noiseField(w, h, 420 * s, 3, rng), warm = noiseField(w, h, 300 * s, 2, rng);
    var mid = noiseField(w, h, 30 * s, 2, rng), midWarm = noiseField(w, h, 44 * s, 2, rng);
    for (var i = 0; i < R.length; i++) {
      var l = (R[i] * 0.299 + G[i] * 0.587 + B[i] * 0.114);
      // a pale wall or a sheet of paper takes far less broken colour than a sky or the sea: on grey it reads as dirt
      var mx = R[i] > G[i] ? (R[i] > B[i] ? R[i] : B[i]) : (G[i] > B[i] ? G[i] : B[i]), mn = R[i] < G[i] ? (R[i] < B[i] ? R[i] : B[i]) : (G[i] < B[i] ? G[i] : B[i]);
      var d = dab * (0.3 + 0.7 * clamp01((mx - mn - 0.06) * 3.2));
      var m = 1 + amt * big[i] * 0.9 + d * mid[i];
      var t = (amt * warm[i] + d * 0.7 * midWarm[i]) * (0.35 + 0.65 * l);   // warmth shift, stronger in the light
      R[i] = R[i] * m + t * 0.6; G[i] = G[i] * m + t * 0.1; B[i] = B[i] * m - t * 0.7;
    }
  }

  // 2. smooth Kuwahara: the mean of four overlapping quadrants around each pixel, weighted towards the calmest
  // (lowest variance) ones; summed-area tables make it cost the same for any radius
  // mean over the (r+1) x (r+1) window whose top-left corner is the pixel (edges replicated): sliding sums
  function cornerMean(src, w, h, r) {
    var tmp = new Float32Array(w * h), out = new Float32Array(w * h), n = r + 1, x, y, acc;
    for (y = 0; y < h; y++) {
      var row = y * w; acc = 0;
      for (x = 0; x < n; x++) acc += src[row + (x < w ? x : w - 1)];
      for (x = 0; x < w; x++) {
        tmp[row + x] = acc;
        var add = x + n; acc += src[row + (add < w ? add : w - 1)] - src[row + x];
      }
    }
    var inv = 1 / (n * n);
    for (x = 0; x < w; x++) {
      acc = 0;
      for (y = 0; y < n; y++) acc += tmp[(y < h ? y : h - 1) * w + x];
      for (y = 0; y < h; y++) {
        out[y * w + x] = acc * inv;
        var add2 = y + n; acc += tmp[(add2 < h ? add2 : h - 1) * w + x] - tmp[y * w + x];
      }
    }
    return out;
  }
  function kuwahara(R, G, B, w, h, r, q) {
    if (r < 1) return [R, G, B];
    var n = w * h, Q = new Float32Array(n), i, x, y;
    for (i = 0; i < n; i++) Q[i] = R[i] * R[i] + G[i] * G[i] + B[i] * B[i];
    var mR = cornerMean(R, w, h, r), mG = cornerMean(G, w, h, r), mB = cornerMean(B, w, h, r), mQ = cornerMean(Q, w, h, r);
    var oR = new Float32Array(n), oG = new Float32Array(n), oB = new Float32Array(n);
    for (y = 0; y < h; y++) {
      var y0 = (y - r < 0 ? 0 : y - r) * w, y1 = y * w;
      for (x = 0; x < w; x++) {
        var x0 = x - r < 0 ? 0 : x - r;
        // the four quadrants: up-left, up-right, down-left, down-right
        var a = y0 + x0, b = y0 + x, c = y1 + x0, d = y1 + x, tw = 0, tr = 0, tg = 0, tb = 0, k, v, wt, mr, mg, mb;
        for (k = 0; k < 4; k++) {
          var j = k === 0 ? a : k === 1 ? b : k === 2 ? c : d;
          mr = mR[j]; mg = mG[j]; mb = mB[j];
          v = (mQ[j] - (mr * mr + mg * mg + mb * mb)) * q;
          if (v < 0) v = 0;
          wt = 1 / (1 + v * v * v);
          tw += wt; tr += mr * wt; tg += mg * wt; tb += mb * wt;
        }
        i = y1 + x;
        oR[i] = tr / tw; oG[i] = tg / tw; oB[i] = tb / tw;
      }
    }
    return [oR, oG, oB];
  }

  // 3. brush strokes along the structure. The direction is the tangent of the (blurred) luminance edges where
  // there are any, else a slow noise field that leans horizontal; each stroke carries the colour at its centre.
  function strokes(R, G, B, w, h, s, amt, jitter, size, rng) {
    if (amt <= 0) return;
    var L = new Float32Array(w * h), i, x, y;
    for (i = 0; i < L.length; i++) L[i] = R[i] * 0.299 + G[i] * 0.587 + B[i] * 0.114;
    var Lb = boxBlur(L, w, h, Math.max(1, Math.round(3 * s)), 2);
    var field = noiseField(w, h, 260 * s, 2, rng), tone = noiseField(w, h, 60 * s, 2, rng);
    // how busy the neighbourhood is (edges per area): a painter takes a small brush and plain paint for the
    // bookshelf and the lit windows, a broad brush and broken colour for the sky and the wall
    var busy = new Float32Array(w * h);
    for (y = 1; y < h - 1; y++) for (x = 1; x < w - 1; x++) {
      i = y * w + x;
      var bx = Lb[i + 1] - Lb[i - 1], by = Lb[i + w] - Lb[i - w];
      busy[i] = Math.sqrt(bx * bx + by * by);
    }
    busy = boxBlur(busy, w, h, Math.max(2, Math.round(16 * s)), 2);
    var z = size > 0 ? size : 1, sp = Math.max(3, 5.5 * s * z), cols = Math.ceil(w / sp), rows = Math.ceil(h / sp), cx, cy;
    for (cy = 0; cy < rows; cy++) for (cx = 0; cx < cols; cx++) {
      var px = (cx + rng()) * sp, py = (cy + rng()) * sp, ix = px | 0, iy = py | 0;
      if (ix >= w || iy >= h) continue;
      var xm = ix > 0 ? ix - 1 : ix, xp = ix < w - 1 ? ix + 1 : ix, ym = iy > 0 ? iy - 1 : iy, yp = iy < h - 1 ? iy + 1 : iy;
      var gx = Lb[iy * w + xp] - Lb[iy * w + xm], gy = Lb[yp * w + ix] - Lb[ym * w + ix], gm = Math.sqrt(gx * gx + gy * gy);
      var c0 = iy * w + ix;
      // open areas: a gentle drift around horizontal; near an edge: along it
      var ang = -0.12 + field[c0] * 0.55 + (rng() - 0.5) * 0.3, e = clamp01(gm * 40), calm = 1 - clamp01(busy[c0] * 14);
      if (gm > 1e-5) {
        var ta = Math.atan2(gx, -gy);
        // blend the two directions on the unit circle (doubled angles: a stroke has no head or tail)
        var cxa = Math.cos(2 * ang) * (1 - e) + Math.cos(2 * ta) * e, sya = Math.sin(2 * ang) * (1 - e) + Math.sin(2 * ta) * e;
        ang = Math.atan2(sya, cxa) / 2;
      }
      // fine detail (a thin branch, a petal) is left alone: strokes there are short and faint
      var det = clamp01(gm * 90);
      // every stroke is loaded with slightly different paint: a touch lighter or darker, warmer or cooler
      var r0 = R[c0], g0 = G[c0], b0 = B[c0];
      var cmx = r0 > g0 ? (r0 > b0 ? r0 : b0) : (g0 > b0 ? g0 : b0), cmn = r0 < g0 ? (r0 < b0 ? r0 : b0) : (g0 < b0 ? g0 : b0);
      // broken colour belongs to open, coloured areas: less of it in busy places and on pale greys
      var sat = 0.3 + 0.7 * clamp01((cmx - cmn - 0.06) * 3.2), zz = 1 + (z - 1) * calm, jj = jitter * (0.25 + 0.75 * calm) * sat;
      var len = (12 + rng() * 16) * s * zz * (1 - 0.6 * det), wid = (3.5 + rng() * 4) * s * zz, shade = 1 + tone[c0] * 0.045 * (0.5 + 0.5 * calm) * sat + (rng() - 0.5) * jj;
      var temp = (rng() - 0.5) * jj * 0.8;
      var sr = r0 * shade * (1 + temp), sg = g0 * shade, sb = b0 * shade * (1 - temp), alpha = amt * (1 - 0.7 * det);
      var ca = Math.cos(ang), sa = Math.sin(ang), half = len / 2, hw = wid / 2, t, u, bi;
      // bristles: each stroke is a few parallel hairs of slightly different value
      var nb = Math.max(3, Math.round(5 * zz)), br = [];
      for (bi = 0; bi < nb; bi++) br.push(1 + (rng() - 0.5) * 0.025);
      for (t = -half; t <= half; t += 1) {
        var taper = 1 - Math.abs(t / half); taper = taper < 0.4 ? taper / 0.4 : 1;
        for (u = -hw; u <= hw; u += 0.9) {
          var xx = (px + ca * t - sa * u + 0.5) | 0, yy = (py + sa * t + ca * u + 0.5) | 0;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          var uf = (u + hw) / (2 * hw), hb = br[(uf * (nb - 0.001)) | 0];
          var j = yy * w + xx, dr = R[j] - r0, dg = G[j] - g0, db = B[j] - b0;
          // the brush stays on its own colour: over a different one (the far side of an edge) it leaves next to nothing
          var a = alpha * taper * (1 - Math.abs(u / hw) * 0.5) / (1 + (dr * dr + dg * dg + db * db) * 320);
          R[j] += (sr * hb - R[j]) * a; G[j] += (sg * hb - G[j]) * a; B[j] += (sb * hb - B[j]) * a;
        }
      }
    }
  }

  // what a channel has above its local mean: the detail finer than r
  function highpass(ch, w, h, r) {
    return ch.map(function (c) { var b = boxBlur(c, w, h, r, 2), o = new Float32Array(c.length); for (var i = 0; i < c.length; i++) o[i] = c[i] - b[i]; return o; });
  }

  // 4d. finish: a little local contrast (clarity) and saturation back, which the smoothing took away
  function finish(R, G, B, w, h, s, clarity, sat) {
    var n = w * h, L = new Float32Array(n), i;
    for (i = 0; i < n; i++) L[i] = R[i] * 0.299 + G[i] * 0.587 + B[i] * 0.114;
    var Lb = clarity > 0 ? boxBlur(L, w, h, Math.max(2, Math.round(24 * s)), 2) : L;
    for (i = 0; i < n; i++) {
      var l = L[i], d = clarity * (l - Lb[i]);
      var r = l + (R[i] - l) * sat + d, g = l + (G[i] - l) * sat + d, b = l + (B[i] - l) * sat + d;
      R[i] = r; G[i] = g; B[i] = b;
    }
  }

  // 4a. pigment pools where a region meets a lighter one: darken the dark side of every edge a little
  function edges(R, G, B, w, h, s, amt) {
    if (amt <= 0) return;
    var L = new Float32Array(w * h), i;
    for (i = 0; i < L.length; i++) L[i] = R[i] * 0.299 + G[i] * 0.587 + B[i] * 0.114;
    var Lb = boxBlur(L, w, h, Math.max(1, Math.round(2.5 * s)), 2);
    for (i = 0; i < L.length; i++) {
      var d = Lb[i] - L[i];            // > 0: this pixel is darker than its surroundings, i.e. on the dark side of an edge
      if (d > 0) { var f = 1 - amt * clamp01(d * 6); R[i] *= f; G[i] *= f; B[i] *= f; }
    }
  }

  // 4b. canvas tooth: a fine weave and paper fibre, strongest in the mid tones
  function grain(R, G, B, w, h, s, amt, rng) {
    if (amt <= 0) return;
    var per = Math.max(2.4, 3.2 * s), k = 2 * Math.PI / per, fib = noiseField(w, h, 3 * s, 1, rng), slow = noiseField(w, h, 90 * s, 1, rng), x, y;
    var sx = new Float32Array(w);
    for (x = 0; x < w; x++) sx[x] = Math.sin(x * k);
    for (y = 0; y < h; y++) {
      var sy = Math.sin(y * k);
      for (x = 0; x < w; x++) {
        var i = y * w + x, weave = sx[x] * sy;
        var l = R[i] * 0.299 + G[i] * 0.587 + B[i] * 0.114, mid = 0.35 + 2.6 * l * (1 - l);
        var v = amt * mid * (weave * (0.6 + 0.4 * slow[i]) * 0.75 + fib[i] * 0.45);
        R[i] += v; G[i] += v; B[i] += v * 0.92;
      }
    }
  }

  // 4c. bloom: the highlights, blurred wide at a quarter of the size, screened back over the picture
  function bloom(R, G, B, w, h, s, amt, thr) {
    if (amt <= 0) return;
    var f = 4, sw = Math.max(1, Math.ceil(w / f)), sh = Math.max(1, Math.ceil(h / f)), x, y;
    var br = new Float32Array(sw * sh), bg = new Float32Array(sw * sh), bb = new Float32Array(sw * sh), cnt = new Float32Array(sw * sh);
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
      var i = y * w + x, l = R[i] * 0.299 + G[i] * 0.587 + B[i] * 0.114, k = clamp01((l - thr) / (1 - thr));
      k = k * k;
      var j = ((y / f) | 0) * sw + ((x / f) | 0);
      br[j] += R[i] * k; bg[j] += G[i] * k; bb[j] += B[i] * k; cnt[j] += 1;
    }
    for (x = 0; x < br.length; x++) { br[x] /= cnt[x] || 1; bg[x] /= cnt[x] || 1; bb[x] /= cnt[x] || 1; }
    var rad = Math.max(2, Math.round(9 * s));
    br = boxBlur(br, sw, sh, rad, 3); bg = boxBlur(bg, sw, sh, rad, 3); bb = boxBlur(bb, sw, sh, rad, 3);
    for (y = 0; y < h; y++) {
      var fy = Math.min(sh - 1.001, Math.max(0, y / f - 0.5)), y0 = fy | 0, ty = fy - y0;
      for (x = 0; x < w; x++) {
        var fx = Math.min(sw - 1.001, Math.max(0, x / f - 0.5)), x0 = fx | 0, tx = fx - x0;
        var a = y0 * sw + x0, b = a + 1, c = a + sw, d = c + 1;
        if (x0 + 1 >= sw) { b = a; d = c; }
        if (y0 + 1 >= sh) { c = a; d = b; }
        var w00 = (1 - tx) * (1 - ty), w10 = tx * (1 - ty), w01 = (1 - tx) * ty, w11 = tx * ty, o = y * w + x;
        var vr = (br[a] * w00 + br[b] * w10 + br[c] * w01 + br[d] * w11) * amt;
        var vg = (bg[a] * w00 + bg[b] * w10 + bg[c] * w01 + bg[d] * w11) * amt;
        var vb = (bb[a] * w00 + bb[b] * w10 + bb[c] * w01 + bb[d] * w11) * amt;
        R[o] = 1 - (1 - R[o]) * (1 - vr); G[o] = 1 - (1 - G[o]) * (1 - vg); B[o] = 1 - (1 - B[o]) * (1 - vb);
      }
    }
  }

  var DEFAULTS = {
    seed: 'vn', scale: 0,        // scale 0: width / 1600
    warp: 2.6, warpCell: 70,     // edge wobble in px at 1600 wide, and its wavelength
    vary: 0.035, dab: 0.03,      // colour variation: the broad drift, and the brush-sized mottle
    radius: 5, sharp: 220,       // Kuwahara radius at 1600 wide; how strongly calm quadrants win
    strokes: 0.42, strokeJitter: 0.06, strokeSize: 2,   // brush stroke opacity, how much the paint differs from stroke to stroke, brush size
    edge: 0.1, grain: 0.022, bloom: 0.28, bloomThreshold: 0.7,
    detail: 0.8, sparkle: 0.45, clarity: 0, saturation: 1.08,
    overlay: null                // optional rgba (same size, straight alpha) drawn over the result untouched: the text
  };

  // The whole pipeline. rgba: Uint8ClampedArray or Uint8Array of width*height*4. Returns a new Uint8ClampedArray
  // of the same size; alpha is passed through unchanged (then the overlay, if any, is composited over).
  function filter(rgba, width, height, opts) {
    var o = {}, k;
    for (k in DEFAULTS) o[k] = DEFAULTS[k];
    if (opts) for (k in opts) if (opts[k] !== undefined) o[k] = opts[k];
    var w = width | 0, h = height | 0, n = w * h, i;
    var out = new Uint8ClampedArray(n * 4);
    if (!w || !h || rgba.length < n * 4) { out.set(rgba.subarray ? rgba.subarray(0, n * 4) : rgba); return out; }
    var s = o.scale || w / 1600, rng = rngFrom(o.seed);
    var R = new Float32Array(n), G = new Float32Array(n), B = new Float32Array(n);
    for (i = 0; i < n; i++) { R[i] = rgba[i * 4] / 255; G[i] = rgba[i * 4 + 1] / 255; B[i] = rgba[i * 4 + 2] / 255; }
    var c = warp(R, G, B, w, h, o.warp * s, o.warpCell * s, rng);
    R = c[0]; G = c[1]; B = c[2];
    vary(R, G, B, w, h, o.vary, o.dab, s, rng);
    c = kuwahara(R, G, B, w, h, o.radius > 0 ? Math.max(1, Math.round(o.radius * s)) : 0, o.sharp);
    // the fine detail the dabs wiped out (a thin line, a lit window, a star): the high frequencies of what the
    // Kuwahara pass took away, to be drawn back in after the strokes. Edges it kept are not sharpened twice.
    var hp = null;
    if (o.detail > 0) {
      var lost = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
      for (i = 0; i < n; i++) { lost[0][i] = R[i] - c[0][i]; lost[1][i] = G[i] - c[1][i]; lost[2][i] = B[i] - c[2][i]; }
      hp = highpass(lost, w, h, Math.max(1, Math.round(o.radius * s)));
    }
    R = c[0]; G = c[1]; B = c[2];
    strokes(R, G, B, w, h, s, o.strokes, o.strokeJitter, o.strokeSize, rng);
    // lights (a lit window, a star) come back whole, dark detail (a line, a branch) a little softer
    if (hp) for (i = 0; i < n; i++) {
      var hl = hp[0][i] * 0.299 + hp[1][i] * 0.587 + hp[2][i] * 0.114, dk = hl > 0 ? 1 + o.sparkle * clamp01((hl - 0.03) * 10) : o.detail;
      R[i] += hp[0][i] * dk; G[i] += hp[1][i] * dk; B[i] += hp[2][i] * dk;
    }
    edges(R, G, B, w, h, s, o.edge);
    finish(R, G, B, w, h, s, o.clarity, o.saturation);
    bloom(R, G, B, w, h, s, o.bloom, o.bloomThreshold);
    grain(R, G, B, w, h, s, o.grain, rng);
    var ov = o.overlay;
    for (i = 0; i < n; i++) {
      var p = i * 4, r = R[i] * 255, g = G[i] * 255, b = B[i] * 255;
      if (ov) {
        var a = ov[p + 3] / 255;
        if (a > 0) { r += (ov[p] - r) * a; g += (ov[p + 1] - g) * a; b += (ov[p + 2] - b) * a; }
      }
      out[p] = r; out[p + 1] = g; out[p + 2] = b; out[p + 3] = rgba[p + 3];
    }
    return out;
  }

  var api = { filter: filter, DEFAULTS: DEFAULTS, hash: hashStr };


  /* ================================================================== browser side */

  var doc = root && root.document;
  if (!doc || typeof doc.createElement !== 'function') return api;   // Node, or the worker

  var nav = root.navigator || {};
  // a small device paints smaller (the image is scaled up): little memory, or a phone-sized touch screen
  var scr = root.screen || {}, small = nav.maxTouchPoints > 0 && Math.min(scr.width || 9999, scr.height || 9999) < 820;
  var MAX_W = nav.deviceMemory && nav.deviceMemory < 4 ? 1120 : small ? 1280 : 1600;
  var MIN_W = 480, STEP_W = 160, MAIN_W = 960, CACHE_MAX = 14, FADE_MS = 520, WARM_AHEAD = 2, WORKER_PATIENCE = 30000;
  var POOL_MAX = (nav.hardwareConcurrency || 2) >= 4 ? 2 : 1;
  var QS = (root.location && root.location.search) || '';
  // pictures that come next in the script are painted ahead of time, so they are ready when their scene opens;
  // not in a capture or a test run (?autoplay=, ?thumb=1) unless ?paintwarm=1 asks for it
  var warmOn = /[?&]paintwarm=1\b/.test(QS) || (!/[?&](autoplay|thumb)=/.test(QS) && !/[?&]paintwarm=0\b/.test(QS));
  var REDUCED = !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);
  var scriptSrc = (doc.currentScript && doc.currentScript.src) || '';

  var enabled = true;
  var cache = {};            // key -> { key, url, img, w, h, used }: one finished painting per picture
  var retired = [];          // blob URLs of replaced paintings that were still on screen when they were replaced
  var tasks = {};            // key -> the painting of that picture that is queued or running
  var queue = [];            // tasks not started yet
  var running = 0, useCount = 0;
  var pending = 0, fades = 0, idleWaiters = [];
  var urlsMade = 0, urlsDropped = 0;

  function warn(msg, err) { try { console.warn('[vn-paint] ' + msg, err || ''); } catch (e) { /* ignore */ } }
  function settleIdle() {
    if (pending > 0 || fades > 0) return;
    var w = idleWaiters; idleWaiters = [];
    w.forEach(function (f) { f(); });
  }
  // for captures and tests: resolves when no picture on stage is being painted or fading in
  root.__vnPaintIdle = function () {
    return new Promise(function (res) { idleWaiters.push(res); settleIdle(); });
  };

  function supported() {
    return typeof root.Blob === 'function' && !!root.URL && typeof root.URL.createObjectURL === 'function' && typeof root.Promise === 'function' && !!doc.createElement('canvas').getContext;
  }
  function makeUrl(blob) { urlsMade++; return root.URL.createObjectURL(blob); }
  function dropUrl(url) { urlsDropped++; try { root.URL.revokeObjectURL(url); } catch (e) { /* ignore */ } }

  /* ---------- the light stage: a bloom filter for the SVG layers (vn-paint.css refers to it) */
  function injectDefs() {
    if (doc.getElementById('vnp-defs') || !doc.body) return;
    var svg = '<svg id="vnp-defs" width="0" height="0" aria-hidden="true" focusable="false" style="position:absolute;width:0;height:0;overflow:hidden">' +
      '<filter id="vnp-bloom" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">' +
      // the highlights alone, blurred wide, screened back over the picture
      '<feColorMatrix in="SourceGraphic" type="matrix" values="0.299 0.587 0.114 0 0  0.299 0.587 0.114 0 0  0.299 0.587 0.114 0 0  0 0 0 1 0" result="lum"/>' +
      '<feComponentTransfer in="lum" result="mask"><feFuncR type="linear" slope="2.2" intercept="-1.2"/><feFuncG type="linear" slope="2.2" intercept="-1.2"/><feFuncB type="linear" slope="2.2" intercept="-1.2"/></feComponentTransfer>' +
      '<feComposite in="SourceGraphic" in2="mask" operator="arithmetic" k1="1" k2="0" k3="0" k4="0" result="hi"/>' +
      '<feGaussianBlur in="hi" stdDeviation="22" edgeMode="duplicate" result="glow"/>' +
      '<feComponentTransfer in="glow" result="soft"><feFuncR type="linear" slope="0.55"/><feFuncG type="linear" slope="0.55"/><feFuncB type="linear" slope="0.55"/></feComponentTransfer>' +
      '<feBlend in="SourceGraphic" in2="soft" mode="screen"/>' +
      '</filter></svg>';
    doc.body.insertAdjacentHTML('beforeend', svg);
  }

  /* ---------- rasterising */

  var sharedInner = null;
  function sharedDefsInner() {
    if (sharedInner != null) return sharedInner;
    var src = '';
    try { if (root.VNArt && root.VNArt.sharedDefs) src = root.VNArt.sharedDefs(); } catch (e) { src = ''; }
    if (!src) { var el = doc.querySelector('svg.vn-defs'); if (el) src = el.outerHTML; }
    var m = /<defs>([\s\S]*)<\/defs>/.exec(src || '');
    sharedInner = m ? m[1] : '';
    return sharedInner;
  }
  // A standalone SVG document of the picture: explicit size, namespaces, the shared vnf- defs inlined, and
  // either the text hidden (the picture to paint) or everything but the text hidden (the crisp overlay).
  function standalone(svg, w, h, textOnly) {
    var m = /<svg\b[^>]*>/i.exec(svg);
    if (!m) return null;
    var tag = m[0].replace(/\s(width|height)\s*=\s*("[^"]*"|'[^']*')/gi, '');
    if (!/\sxmlns\s*=/.test(tag)) tag = tag.replace(/^<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"');
    if (/xlink:/.test(svg) && !/xmlns:xlink/.test(tag)) tag = tag.replace(/^<svg/i, '<svg xmlns:xlink="http://www.w3.org/1999/xlink"');
    tag = tag.replace(/^<svg/i, '<svg width="' + w + '" height="' + h + '"');
    var style = textOnly ? '<style>svg{visibility:hidden}text,text *{visibility:visible}</style>' : '<style>text{visibility:hidden}</style>';
    var inner = svg.slice(m.index + m[0].length);
    return tag + style + '<defs>' + sharedDefsInner() + '</defs>' + inner;
  }
  function viewSize(svg) {
    var vb = /viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(svg);
    var w = vb ? parseFloat(vb[1]) : 1600, h = vb ? parseFloat(vb[2]) : 900;
    return { w: w > 0 ? w : 1600, h: h > 0 ? h : 900 };
  }
  function loadImage(markup) {
    return new Promise(function (res, rej) {
      if (!markup) { rej(new Error('no <svg> root')); return; }
      var url = makeUrl(new Blob([markup], { type: 'image/svg+xml' }));
      var img = new Image();
      img.onload = function () { dropUrl(url); res(img); };   // the image holds what it loaded; the address can go
      img.onerror = function () { dropUrl(url); rej(new Error('svg did not rasterise')); };
      img.src = url;
    });
  }
  // the scene (and its text, when it has any) as images of w x h
  function loadPicture(svg, w, h) {
    var list = [loadImage(standalone(svg, w, h, false))];
    if (/<text\b/i.test(svg)) list.push(loadImage(standalone(svg, w, h, true)));
    return Promise.all(list);
  }
  // off the main thread where the browser can: createImageBitmap rasterises an SVG image in the background
  function bitmaps(imgs, w, h) {
    // (the worker reads a bitmap through an OffscreenCanvas: without one the pixels are read here instead)
    if (typeof root.createImageBitmap !== 'function' || typeof root.OffscreenCanvas !== 'function') return Promise.reject(new Error('no createImageBitmap'));
    try {
      return Promise.all(imgs.map(function (im) { return root.createImageBitmap(im, { resizeWidth: w, resizeHeight: h }); }));
    } catch (e) { return Promise.reject(e); }
  }
  function pixels(img, w, h) {
    var c = doc.createElement('canvas'); c.width = w; c.height = h;
    var g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0, w, h);
    return g.getImageData(0, 0, w, h).data;
  }
  function isOpaque(data) {
    for (var i = 3; i < data.length; i += 4) if (data[i] < 255) return false;
    return true;
  }
  function encodeOnMain(rgba, w, h, opaque) {
    var c = doc.createElement('canvas'); c.width = w; c.height = h;
    c.getContext('2d').putImageData(new ImageData(rgba, w, h), 0, 0);
    return new Promise(function (res, rej) {
      c.toBlob(function (b) { if (b) res(b); else rej(new Error('toBlob gave nothing')); }, opaque ? 'image/jpeg' : 'image/png', 0.93);
    });
  }

  /* ---------- the workers (two at most), with a main-thread fallback */

  var pool = [], workersOff = typeof root.Worker !== 'function', jobSeq = 0;
  function workerUrl() { return scriptSrc ? scriptSrc.replace(/paint\.js(\?[^#]*)?(#.*)?$/, 'paint-worker.js') : 'paint-worker.js'; }
  function spawn() {
    if (workersOff) return null;
    try {
      var slot = { w: new Worker(workerUrl()), job: null };
      slot.w.onmessage = function (ev) {
        var d = ev.data || {}, j = slot.job;
        if (!j || j.id !== d.id) return;
        slot.job = null;
        j.settle(d);
      };
      slot.w.onerror = function (ev) {
        // the worker could not start or died: not an error of the page; everything goes to the main thread from here
        if (ev && ev.preventDefault) ev.preventDefault();
        workersOff = true;
        var all = pool; pool = [];
        all.forEach(function (s) {
          var j = s.job; s.job = null;
          try { s.w.terminate(); } catch (e) { /* ignore */ }
          if (j) j.settle({ dead: true });
        });
      };
      pool.push(slot);
      return slot;
    } catch (e) { workersOff = true; return null; }
  }
  function freeSlot() {
    for (var i = 0; i < pool.length; i++) if (!pool[i].job) return pool[i];
    return pool.length < POOL_MAX ? spawn() : null;
  }
  // the fallback: rasterise, paint and encode on the main thread, at a smaller size so the stall stays short
  function paintOnMain(svg, key, w, h) {
    if (w > MAIN_W) { h = Math.max(1, Math.round(h * MAIN_W / w)); w = MAIN_W; }
    return loadPicture(svg, w, h).then(function (imgs) {
      var data = pixels(imgs[0], w, h), overlay = imgs[1] ? pixels(imgs[1], w, h) : null;
      return new Promise(function (res) { setTimeout(res, 0); }).then(function () {
        return encodeOnMain(filter(data, w, h, { seed: key, overlay: overlay }), w, h, isOpaque(data));
      });
    }).then(function (blob) { return { blob: blob, w: w, h: h }; });
  }
  function paintInWorker(svg, key, w, h) {
    var slot = freeSlot();
    if (!slot) return paintOnMain(svg, key, w, h);
    var id = ++jobSeq, settle = null;
    var answer = new Promise(function (res, rej) {
      settle = function (d) {
        if (d.dead) paintOnMain(svg, key, w, h).then(res, rej);
        else if (d.error) rej(new Error(d.error));
        else if (d.blob) res({ blob: d.blob, w: w, h: h });
        else if (d.rgba) encodeOnMain(d.rgba, w, h, d.opaque).then(function (b) { res({ blob: b, w: w, h: h }); }, rej);
        else rej(new Error('the worker sent nothing'));
      };
    });
    // a worker that never answers is as good as dead: it is let go and the picture is painted here
    var dog = setTimeout(function () {
      if (!slot.job || slot.job.id !== id) return;
      slot.job = null;
      var at = pool.indexOf(slot);
      if (at >= 0) pool.splice(at, 1);
      try { slot.w.terminate(); } catch (e) { /* ignore */ }
      settle({ dead: true });
    }, WORKER_PATIENCE);
    slot.job = { id: id, settle: function (d) { clearTimeout(dog); settle(d); } };   // the slot is taken now, before anything asynchronous
    function send(msg, transfer) {
      if (slot.job && slot.job.id === id) {
        try { slot.w.postMessage(msg, transfer || []); } catch (e) { fail(e); }
      }
    }
    function fail(err) {
      if (!slot.job || slot.job.id !== id) return;
      var j = slot.job; slot.job = null;
      j.settle({ error: err && err.message ? err.message : String(err) });
    }
    loadPicture(svg, w, h).then(function (imgs) {
      return bitmaps(imgs, w, h).then(function (b) {
        send({ id: id, w: w, h: h, seed: key, bmp: b[0], ovBmp: b[1] || null }, b);
      }, function () {
        // no background rasterising here: read the pixels on the main thread, paint them in the worker
        var data = pixels(imgs[0], w, h), overlay = imgs[1] ? pixels(imgs[1], w, h) : null;
        send({ id: id, w: w, h: h, seed: key, rgba: data, overlay: overlay });
      });
    }).then(null, fail);
    return answer;
  }

  /* ---------- the cache */

  function inUse(url) {
    var imgs = doc.querySelectorAll('img.vn-painted');
    for (var i = 0; i < imgs.length; i++) if (imgs[i].getAttribute('src') === url) return true;
    return false;
  }
  function evict() {
    var i;
    for (i = retired.length - 1; i >= 0; i--) if (!inUse(retired[i])) { dropUrl(retired[i]); retired.splice(i, 1); }
    var keys = Object.keys(cache), n = keys.length;
    if (n <= CACHE_MAX) return;
    keys.sort(function (a, b) { return cache[a].used - cache[b].used; });
    for (i = 0; i < keys.length && n > CACHE_MAX; i++) {
      var e = cache[keys[i]];
      if (inUse(e.url)) continue;
      dropUrl(e.url);
      delete cache[keys[i]];
      n--;
    }
  }
  // A finished painting becomes a cache entry. The entry keeps a decoded image of its own: while that lives, any
  // new <img> with the same address is complete at once, which is what lets a cached picture be mounted in the
  // same frame as its SVG.
  function keep(key, done) {
    var url = makeUrl(done.blob), img = new Image();
    img.decoding = 'sync';
    img.src = url;
    var ready = typeof img.decode === 'function' ? img.decode() : new Promise(function (res, rej) { img.onload = res; img.onerror = function () { rej(new Error('the painting did not load')); }; });
    return ready.then(function () {
      var old = cache[key], e = { key: key, url: url, img: img, w: done.w, h: done.h, used: ++useCount };
      cache[key] = e;
      if (old) { if (inUse(old.url)) retired.push(old.url); else dropUrl(old.url); }
      evict();
      return e;
    }, function (err) { dropUrl(url); throw err; });
  }

  /* ---------- the queue: pictures on stage first, pictures painted ahead only when nothing else is going on */

  function pump() {
    for (;;) {
      var pick = -1, i;
      for (i = 0; i < queue.length; i++) if (queue[i].live) { pick = i; break; }
      if (pick < 0) {
        if (!queue.length || running > 0) return;
        pick = 0;
      } else if (running >= (workersOff ? 1 : POOL_MAX)) return;
      start(queue.splice(pick, 1)[0]);
    }
  }
  function start(t) {
    running++;
    var w = t.tw, h = Math.max(1, Math.round(t.tw * t.vh / t.vw)), p;
    try { p = workersOff ? paintOnMain(t.svg, t.key, w, h) : paintInWorker(t.svg, t.key, w, h); } catch (e) { p = Promise.reject(e); }
    function fin() { running--; if (tasks[t.key] === t) delete tasks[t.key]; t.svg = null; }
    p.then(function (done) { return keep(t.key, done); }).then(function (e) { fin(); t.res(e); pump(); }, function (err) { fin(); t.rej(err); pump(); });
  }
  function request(svg, key, tw, live) {
    var e = cache[key];
    if (e && e.w >= tw * 0.8) { e.used = ++useCount; return Promise.resolve(e); }
    var t = tasks[key];
    if (t && t.tw >= tw * 0.8) {
      if (live && !t.live) { t.live = true; pump(); }
      return t.promise;
    }
    var size = viewSize(svg);
    t = { key: key, svg: svg, tw: tw, vw: size.w, vh: size.h, live: !!live, res: null, rej: null, promise: null };
    t.promise = new Promise(function (res, rej) { t.res = res; t.rej = rej; });
    tasks[key] = t;
    queue.push(t);
    pump();
    return t.promise;
  }

  // the width to paint at: the layer's own size in device pixels, in steps, so that a picture is painted at few sizes
  function targetWidth(layer, vw, vh) {
    var cw = layer ? layer.offsetWidth : 0, ch = layer ? layer.offsetHeight : 0, dpr = root.devicePixelRatio || 1;
    if (!cw || !ch) { var b = doc.querySelector('.vn-bg'); cw = b ? b.offsetWidth : 0; ch = b ? b.offsetHeight : 0; }
    if (!cw || !ch) return MAX_W;
    // the picture covers the layer (xMidYMid slice): the drawn width is the larger of the two fits
    var need = Math.ceil(Math.max(cw, ch * vw / vh) * dpr / STEP_W) * STEP_W;
    return Math.max(MIN_W, Math.min(MAX_W, need));
  }

  /* ---------- putting a painting in a layer */

  function clearLayer(layer) {
    var imgs = layer.querySelectorAll('img.vn-painted');
    for (var i = 0; i < imgs.length; i++) imgs[i].parentNode.removeChild(imgs[i]);
  }
  function imageFor(e, key) {
    var img = new Image();
    img.className = 'vn-painted';
    img.alt = '';
    img.setAttribute('aria-hidden', 'true');
    img.setAttribute('data-key', key);
    img.draggable = false;
    img.decoding = 'sync';
    img.src = e.url;
    return img;
  }
  // a picture that was already painted cuts in with its SVG; one that comes late fades in over it
  function place(layer, e, key, fade) {
    clearLayer(layer);
    var img = imageFor(e, key);
    if (!fade) { layer.appendChild(img); return; }
    img.classList.add('vn-painted-in');
    img.style.opacity = '0';
    layer.appendChild(img);
    fades++;
    var ended = false, end = function () {
      if (ended) return;
      ended = true;
      img.classList.remove('vn-painted-in');
      img.style.removeProperty('opacity');
      fades--; settleIdle();
    };
    void img.offsetWidth;   // let the browser see opacity 0 before the transition to 1
    img.style.opacity = '1';
    img.addEventListener('transitionend', end);
    setTimeout(end, FADE_MS + 200);
  }
  // The transition layer holds a clone of the world as it was. If that clone was taken before its picture was
  // painted, it gets the painting too, so the old picture does not leave as a vector while the new one arrives painted.
  function patchClones(e, key) {
    var els = doc.querySelectorAll('.vn-trans [data-paint]');
    for (var i = 0; i < els.length; i++) {
      if (els[i].getAttribute('data-paint') !== key || els[i].querySelector('img.vn-painted')) continue;
      els[i].appendChild(imageFor(e, key));
    }
  }

  /* ---------- painting ahead */

  var warmTimer = 0;
  function warmSoon() {
    if (!warmOn || workersOff || warmTimer) return;
    warmTimer = setTimeout(function () {
      warmTimer = 0;
      if (typeof root.requestIdleCallback === 'function') root.requestIdleCallback(lookAhead, { timeout: 1500 });
      else lookAhead();
    }, 400);
  }
  // The next pictures of the script, read from the stage's own state (window.__vnStage) and drawn with VNArt
  // exactly as the stage will draw them. If any of that is not there, nothing is painted ahead; nothing else changes.
  function lookAhead() {
    if (!enabled || workersOff) return;
    try {
      var st = root.__vnStage, S = st && st.S, prog = S && S.program, art = root.VNArt;
      if (!prog || !prog.ops || !art) return;
      var stop = S.mode === 'play' ? S.stop : null, from = stop && typeof stop.index === 'number' ? stop.index + 1 : 0;
      var fx = (stop && stop.state && stop.state.fx) || {}, overcast = !!(fx.rain || fx.snow), ops = prog.ops, found = 0;
      for (var i = from; i < ops.length && found < WARM_AHEAD; i++) {
        var op = ops[i];
        if ((op.kind !== 'bg' && op.kind !== 'cg') || !op.name) continue;
        var o = {}, k;
        for (k in (op.opts || {})) o[k] = op.opts[k];
        if (overcast) o.overcast = true;
        var key = op.kind + '|' + op.name + '|' + (op.mod || '') + '|' + Object.keys(o).sort().map(function (n) { return n + '=' + o[n]; }).join(',');
        found++;
        if (cache[key] || tasks[key]) continue;
        var svg = op.kind === 'bg' ? art.background(op.name, op.mod, o) : art.cg(op.name, op.mod, o);
        if (svg) prepare(svg, key);
      }
    } catch (e) { /* not the stage this was written for: no painting ahead */ }
  }

  /* ---------- the contract */

  function mount(layer, svg, key) {
    if (!enabled || !layer || !svg || !key) return Promise.resolve();
    if (!supported()) return Promise.resolve();
    injectDefs();
    var tok = (layer.__vnPaintTok || 0) + 1;
    layer.__vnPaintTok = tok;
    var size = viewSize(svg), tw = targetWidth(layer, size.w, size.h), hit = cache[key];
    if (hit && hit.w >= tw * 0.8) {
      // painted before: it goes in now, in the same frame as the SVG
      hit.used = ++useCount;
      place(layer, hit, key, false);
      evict();
      warmSoon();
      return Promise.resolve();
    }
    var t0 = Date.now();
    pending++;
    function current() { return enabled && layer.__vnPaintTok === tok && layer.getAttribute('data-paint') === key && layer.isConnected !== false; }
    return request(svg, key, tw, true).then(function (e) {
      if (current()) place(layer, e, key, Date.now() - t0 > 90 && !REDUCED);
      patchClones(e, key);
      evict();
    }).then(function () {
      pending--; settleIdle(); warmSoon();
    }, function (err) {
      pending--; settleIdle();
      warn('could not paint ' + key + '; the vector picture stays', err && err.message ? err.message : err);
    });
  }

  function unmount(layer) {
    if (!layer) return;
    layer.__vnPaintTok = (layer.__vnPaintTok || 0) + 1;
    clearLayer(layer);
  }

  // Paint a picture ahead of time (nothing is shown): resolves when it is in the cache, or at once when it cannot be.
  function prepare(svg, key, layer) {
    if (!enabled || !svg || !key || workersOff || !supported()) return Promise.resolve();
    var size = viewSize(svg);
    return request(svg, key, targetWidth(layer || null, size.w, size.h), false).then(function () { /* cached */ }, function () { /* a miss costs nothing */ });
  }

  function setEnabled(on) {
    enabled = !!on;
    var de = doc.documentElement;
    if (de && de.classList) de.classList.toggle('vn-paint-on', enabled);
    if (enabled) { if (doc.body) injectDefs(); else doc.addEventListener('DOMContentLoaded', injectDefs); return; }
    // switched off: what was only being painted ahead is dropped
    var keepQ = [];
    queue.forEach(function (t) {
      if (t.live) { keepQ.push(t); return; }
      if (tasks[t.key] === t) delete tasks[t.key];
      t.promise.then(null, function () { /* nobody waits for it */ });
      t.rej(new Error('painting was switched off'));
    });
    queue = keepQ;
  }

  // for tests: what is held right now
  function stats() {
    var keys = Object.keys(cache);
    return {
      enabled: enabled, cached: keys.length, keys: keys, retired: retired.length, queued: queue.length, running: running,
      pending: pending, fades: fades, urlsMade: urlsMade, urlsDropped: urlsDropped, urlsLive: urlsMade - urlsDropped,
      images: doc.querySelectorAll('img.vn-painted').length, workers: pool.length, workersOff: workersOff, warm: warmOn, maxWidth: MAX_W
    };
  }

  api.mount = mount;
  api.unmount = unmount;
  api.setEnabled = setEnabled;
  api.prepare = prepare;
  api.stats = stats;
  api._standalone = standalone;   // for tests: the SVG document that is rasterised
  return api;
});
