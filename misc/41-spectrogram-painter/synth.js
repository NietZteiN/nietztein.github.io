/* Spectrogram Painter engine. No DOM: runs in the page, in a Web Worker and under Node.
   Exposes: fft (radix-2), naiveDFT, createRenderJob (additive inverse spectrogram, chunked),
   analyze (STFT on a log-frequency grid), encodeWav (RIFF 16-bit PCM), a 5x7 bitmap font and
   paint helpers (dab, line, stampText, fitImage), and procedural sample images. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Synth = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var TWO_PI = Math.PI * 2;

  /* ---------- small deterministic RNG ---------- */
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ---------- frequency grid (log scale, row 0 at the top = fmax) ---------- */
  function rowFreq(r, H, fmin, fmax) {
    return fmin * Math.pow(fmax / fmin, (H - 1 - r) / (H - 1));
  }
  function freqToRow(f, H, fmin, fmax) {
    return (H - 1) - (H - 1) * Math.log(f / fmin) / Math.log(fmax / fmin);
  }

  /* ---------- windows ---------- */
  function hann(n) {              // periodic Hann: 50 % overlap-add sums to exactly 1
    var w = new Float64Array(n);
    for (var i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos(TWO_PI * i / n);
    return w;
  }

  /* ---------- FFT ---------- */
  var fftTables = {};
  function fftTable(n) {
    var t = fftTables[n];
    if (t) return t;
    var bits = 0; while ((1 << bits) < n) bits++;
    var rev = new Uint32Array(n);
    for (var i = 0; i < n; i++) {
      var x = i, r = 0;
      for (var b = 0; b < bits; b++) { r = (r << 1) | (x & 1); x >>= 1; }
      rev[i] = r;
    }
    var cos = new Float64Array(n / 2), sin = new Float64Array(n / 2);
    for (var k = 0; k < n / 2; k++) { cos[k] = Math.cos(TWO_PI * k / n); sin[k] = -Math.sin(TWO_PI * k / n); }
    t = { rev: rev, cos: cos, sin: sin };
    fftTables[n] = t;
    return t;
  }
  /* In-place iterative radix-2 Cooley-Tukey. re/im: arrays of equal power-of-two length. Forward transform
     (X[k] = sum x[n] e^{-2 pi i k n / N}); pass inverse=true for the unscaled inverse. */
  function fft(re, im, inverse) {
    var n = re.length;
    if (n < 2) return;
    if (n & (n - 1)) throw new Error('fft length must be a power of two');
    var t = fftTable(n), rev = t.rev, cosT = t.cos, sinT = t.sin;
    for (var i = 0; i < n; i++) {
      var j = rev[i];
      if (j > i) {
        var tr = re[i]; re[i] = re[j]; re[j] = tr;
        var ti = im[i]; im[i] = im[j]; im[j] = ti;
      }
    }
    var sgn = inverse ? -1 : 1;
    for (var size = 2; size <= n; size <<= 1) {
      var half = size >> 1, step = n / size;
      for (var start = 0; start < n; start += size) {
        for (var k = 0, tw = 0; k < half; k++, tw += step) {
          var wr = cosT[tw], wi = sgn * sinT[tw];
          var a = start + k, b = a + half;
          var xr = re[b] * wr - im[b] * wi;
          var xi = re[b] * wi + im[b] * wr;
          re[b] = re[a] - xr; im[b] = im[a] - xi;
          re[a] += xr; im[a] += xi;
        }
      }
    }
  }
  /* O(n^2) reference used by the test. */
  function naiveDFT(re, im) {
    var n = re.length, outR = new Float64Array(n), outI = new Float64Array(n);
    for (var k = 0; k < n; k++) {
      var sr = 0, si = 0;
      for (var t = 0; t < n; t++) {
        var ang = -TWO_PI * k * t / n, c = Math.cos(ang), s = Math.sin(ang);
        sr += re[t] * c - im[t] * s;
        si += re[t] * s + im[t] * c;
      }
      outR[k] = sr; outI[k] = si;
    }
    return { re: outR, im: outI };
  }

  /* ---------- synthesis: additive inverse spectrogram, overlap-add with a Hann window ----------
     img: Float32Array(W*H), row-major (index r*W + c), values 0..1 = amplitude.
     Column c owns frame c, which spans samples [c*hop - hop, c*hop + hop) under a periodic Hann
     window of length 2*hop, so neighbouring frames cross-fade and the sum of windows is 1.
     Every row has one fixed random phase; each sinusoid is phase-coherent across frames
     (angle = omega * absoluteSample + phase), so overlap-add is click-free. The job is chunked
     (step(nCols)) so a worker or an animation frame can drive it without freezing anything. */
  function createRenderJob(opts) {
    var img = opts.img, W = opts.W, H = opts.H, hop = opts.hop, sr = opts.sr;
    var fmin = opts.fmin || 100, fmax = opts.fmax || 8000;
    var rng = mulberry32(opts.seed === undefined ? 1234 : opts.seed);
    var total = W * hop, L = 2 * hop;
    var out = new Float64Array(total);
    var win = hann(L);
    var omega = new Float64Array(H), phase = new Float64Array(H);
    for (var r = 0; r < H; r++) {
      omega[r] = TWO_PI * rowFreq(r, H, fmin, fmax) / sr;
      phase[r] = rng() * TWO_PI;
    }
    var col = 0, active = 0;
    function renderColumn(c) {
      var t0 = c * hop - hop;
      var nStart = t0 < 0 ? -t0 : 0;
      var nEnd = Math.min(L, total - t0);
      if (nEnd <= nStart) return;
      for (var r = 0; r < H; r++) {
        var a = img[r * W + c];
        if (a <= 0.002) continue;
        active++;
        var w = omega[r];
        var th = w * (t0 + nStart) + phase[r];
        var cr = Math.cos(th), ci = Math.sin(th);
        var dr = Math.cos(w), di = Math.sin(w);
        var base = t0;
        for (var n = nStart; n < nEnd; n++) {
          out[base + n] += a * win[n] * cr;
          var nr = cr * dr - ci * di;
          ci = cr * di + ci * dr;
          cr = nr;
        }
      }
    }
    return {
      total: total,
      get progress() { return col / W; },
      get done() { return col >= W; },
      step: function (nCols) {
        var end = Math.min(W, col + (nCols || 16));
        for (; col < end; col++) renderColumn(col);
        return col / W;
      },
      finish: function () {
        while (col < W) renderColumn(col++);
        var peak = 0;
        for (var i = 0; i < total; i++) { var v = Math.abs(out[i]); if (v > peak) peak = v; }
        var gain = peak > 1e-9 ? 0.891 / peak : 1;   // normalise to -1 dBFS
        var f32 = new Float32Array(total);
        for (i = 0; i < total; i++) f32[i] = out[i] * gain;
        return { samples: f32, gain: gain, peak: peak, activeCells: active };
      }
    };
  }

  /* ---------- analysis: STFT on the same log-frequency grid ----------
     Returns Float32Array(W*H) of display values 0..1. ref is the magnitude a full-amplitude painted
     sinusoid produces (gain * N/4 for a Hann window), so the picture that comes back is in the same
     units as the one that went in; a painted value v shows up as roughly v^0.6 (brighter, so quiet
     detail is visible). */
  function analyze(samples, sr, W, H, opts) {
    opts = opts || {};
    var N = opts.N || 4096, fmin = opts.fmin || 100, fmax = opts.fmax || 8000;
    var gain = opts.gain || 1, curve = opts.curve || 0.6;
    var total = samples.length, hop = total / W;
    var win = hann(N);
    var re = new Float64Array(N), im = new Float64Array(N);
    var out = new Float32Array(W * H);
    var ref = gain * N / 4;
    var binHz = sr / N, half = N / 2;
    /* per-row band edges in bins */
    var lo = new Float64Array(H), hi = new Float64Array(H), centre = new Float64Array(H);
    for (var r = 0; r < H; r++) {
      centre[r] = rowFreq(r, H, fmin, fmax) / binHz;
      lo[r] = rowFreq(r + 0.5, H, fmin, fmax) / binHz;
      hi[r] = rowFreq(r - 0.5, H, fmin, fmax) / binHz;
    }
    var mag = new Float64Array(half + 1);
    for (var c = 0; c < W; c++) {
      var mid = Math.round(c * hop + hop / 2), start = mid - N / 2;
      for (var n = 0; n < N; n++) {
        var s = start + n;
        re[n] = (s >= 0 && s < total) ? samples[s] * win[n] : 0;
        im[n] = 0;
      }
      fft(re, im);
      for (var k = 0; k <= half; k++) mag[k] = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
      for (r = 0; r < H; r++) {
        var m;
        if (hi[r] - lo[r] < 1) {
          var b = centre[r], b0 = Math.floor(b), fr = b - b0;
          m = mag[b0] * (1 - fr) + mag[Math.min(half, b0 + 1)] * fr;
        } else {
          m = 0;
          var k0 = Math.max(0, Math.floor(lo[r])), k1 = Math.min(half, Math.ceil(hi[r]));
          for (k = k0; k <= k1; k++) if (mag[k] > m) m = mag[k];
        }
        var v = m / ref;
        if (v > 1) v = 1;
        out[r * W + c] = v <= 0 ? 0 : Math.pow(v, curve);
      }
    }
    return out;
  }

  /* ---------- WAV ---------- */
  function encodeWav(samples, sr) {
    var n = samples.length, buf = new ArrayBuffer(44 + n * 2), dv = new DataView(buf);
    function str(off, s) { for (var i = 0; i < s.length; i++) dv.setUint8(off + i, s.charCodeAt(i)); }
    str(0, 'RIFF'); dv.setUint32(4, 36 + n * 2, true); str(8, 'WAVE');
    str(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
    dv.setUint32(24, sr, true); dv.setUint32(28, sr * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
    str(36, 'data'); dv.setUint32(40, n * 2, true);
    for (var i = 0, off = 44; i < n; i++, off += 2) {
      var v = samples[i];
      if (v > 1) v = 1; else if (v < -1) v = -1;
      dv.setInt16(off, v < 0 ? v * 32768 : v * 32767, true);
    }
    return buf;
  }

  /* ---------- 5x7 bitmap font (rows top to bottom, 5 bits each, MSB on the left) ---------- */
  var FONT = {
    A: [0x0E,0x11,0x11,0x1F,0x11,0x11,0x11], B: [0x1E,0x11,0x11,0x1E,0x11,0x11,0x1E],
    C: [0x0E,0x11,0x10,0x10,0x10,0x11,0x0E], D: [0x1E,0x11,0x11,0x11,0x11,0x11,0x1E],
    E: [0x1F,0x10,0x10,0x1E,0x10,0x10,0x1F], F: [0x1F,0x10,0x10,0x1E,0x10,0x10,0x10],
    G: [0x0E,0x11,0x10,0x17,0x11,0x11,0x0F], H: [0x11,0x11,0x11,0x1F,0x11,0x11,0x11],
    I: [0x1F,0x04,0x04,0x04,0x04,0x04,0x1F], J: [0x07,0x02,0x02,0x02,0x02,0x12,0x0C],
    K: [0x11,0x12,0x14,0x18,0x14,0x12,0x11], L: [0x10,0x10,0x10,0x10,0x10,0x10,0x1F],
    M: [0x11,0x1B,0x15,0x15,0x11,0x11,0x11], N: [0x11,0x11,0x19,0x15,0x13,0x11,0x11],
    O: [0x0E,0x11,0x11,0x11,0x11,0x11,0x0E], P: [0x1E,0x11,0x11,0x1E,0x10,0x10,0x10],
    Q: [0x0E,0x11,0x11,0x11,0x15,0x12,0x0D], R: [0x1E,0x11,0x11,0x1E,0x14,0x12,0x11],
    S: [0x0F,0x10,0x10,0x0E,0x01,0x01,0x1E], T: [0x1F,0x04,0x04,0x04,0x04,0x04,0x04],
    U: [0x11,0x11,0x11,0x11,0x11,0x11,0x0E], V: [0x11,0x11,0x11,0x11,0x11,0x0A,0x04],
    W: [0x11,0x11,0x11,0x15,0x15,0x15,0x0A], X: [0x11,0x11,0x0A,0x04,0x0A,0x11,0x11],
    Y: [0x11,0x11,0x0A,0x04,0x04,0x04,0x04], Z: [0x1F,0x01,0x02,0x04,0x08,0x10,0x1F],
    '0': [0x0E,0x11,0x13,0x15,0x19,0x11,0x0E], '1': [0x04,0x0C,0x04,0x04,0x04,0x04,0x0E],
    '2': [0x0E,0x11,0x01,0x02,0x04,0x08,0x1F], '3': [0x1F,0x02,0x04,0x02,0x01,0x11,0x0E],
    '4': [0x02,0x06,0x0A,0x12,0x1F,0x02,0x02], '5': [0x1F,0x10,0x1E,0x01,0x01,0x11,0x0E],
    '6': [0x06,0x08,0x10,0x1E,0x11,0x11,0x0E], '7': [0x1F,0x01,0x02,0x04,0x08,0x08,0x08],
    '8': [0x0E,0x11,0x11,0x0E,0x11,0x11,0x0E], '9': [0x0E,0x11,0x11,0x0F,0x01,0x02,0x0C],
    ' ': [0,0,0,0,0,0,0],
    '.': [0,0,0,0,0,0x0C,0x0C], ',': [0,0,0,0,0x0C,0x04,0x08], '!': [0x04,0x04,0x04,0x04,0x04,0,0x04],
    '?': [0x0E,0x11,0x01,0x02,0x04,0,0x04], '-': [0,0,0,0x1F,0,0,0], "'": [0x0C,0x04,0x08,0,0,0,0],
    ':': [0,0x0C,0x0C,0,0x0C,0x0C,0], '+': [0,0x04,0x04,0x1F,0x04,0x04,0], '/': [0x01,0x02,0x02,0x04,0x08,0x08,0x10],
    '&': [0x0C,0x12,0x14,0x08,0x15,0x12,0x0D], '<': [0x02,0x04,0x08,0x10,0x08,0x04,0x02], '>': [0x08,0x04,0x02,0x01,0x02,0x04,0x08],
    '=': [0,0,0x1F,0,0x1F,0,0], '*': [0,0x15,0x0E,0x1F,0x0E,0x15,0], '#': [0x0A,0x0A,0x1F,0x0A,0x1F,0x0A,0x0A],
    '(': [0x02,0x04,0x08,0x08,0x08,0x04,0x02], ')': [0x08,0x04,0x02,0x02,0x02,0x04,0x08], '_': [0,0,0,0,0,0,0x1F]
  };
  function glyph(ch) {
    var u = ch.toUpperCase();
    return FONT[u] || FONT['?'];
  }
  function textWidthCells(text) { return text.length * 6 - 1; }   // 5 wide + 1 gap, no trailing gap

  /* ---------- painting helpers (all operate on a Float32Array image, values clamped 0..1) ---------- */
  function dab(img, W, H, cx, cy, radius, softness, value, erase) {
    var r = Math.max(0.5, radius);
    var x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(W - 1, Math.ceil(cx + r));
    var y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(H - 1, Math.ceil(cy + r));
    var hard = 1 - Math.min(0.999, Math.max(0, softness));
    for (var y = y0; y <= y1; y++) {
      var dy = (y - cy) / r;
      for (var x = x0; x <= x1; x++) {
        var dx = (x - cx) / r, d = Math.sqrt(dx * dx + dy * dy);
        if (d > 1) continue;
        var w = d <= hard ? 1 : (1 - d) / (1 - hard);
        w = w * w * (3 - 2 * w);
        var i = y * W + x;
        if (erase) img[i] = img[i] * (1 - w * value);
        else { var v = w * value; if (v > img[i]) img[i] = v; }
      }
    }
  }
  function line(img, W, H, x0, y0, x1, y1, radius, softness, value, erase) {
    var dx = x1 - x0, dy = y1 - y0, len = Math.sqrt(dx * dx + dy * dy);
    var spacing = Math.max(0.5, radius / 3), steps = Math.max(1, Math.ceil(len / spacing));
    for (var i = 0; i <= steps; i++) {
      var t = i / steps;
      dab(img, W, H, x0 + dx * t, y0 + dy * t, radius, softness, value, erase);
    }
  }
  /* Stamp a word in the chunky font, centred on (cx, cy), each font cell = scale pixels. */
  function stampText(img, W, H, text, cx, cy, scale, value) {
    text = String(text || '');
    if (!text) return null;
    var s = Math.max(1, scale), cells = textWidthCells(text);
    var left = Math.round(cx - cells * s / 2), top = Math.round(cy - 7 * s / 2);
    for (var i = 0; i < text.length; i++) {
      var g = glyph(text[i]);
      for (var row = 0; row < 7; row++) {
        var bits = g[row];
        for (var col = 0; col < 5; col++) {
          if (!(bits & (16 >> col))) continue;
          var px = left + (i * 6 + col) * s, py = top + row * s;
          for (var y = Math.max(0, py); y < Math.min(H, py + s); y++)
            for (var x = Math.max(0, px); x < Math.min(W, px + s); x++) {
              var k = y * W + x; if (value > img[k]) img[k] = value;
            }
        }
      }
    }
    return { x: left, y: top, w: cells * s, h: 7 * s };
  }
  /* Fit a greyscale source (Float32Array sw*sh, 0..1) into the image, aspect preserved, centred,
     area-averaged when shrinking. */
  function fitImage(img, W, H, src, sw, sh) {
    var scale = Math.min(W / sw, H / sh);
    var dw = Math.max(1, Math.round(sw * scale)), dh = Math.max(1, Math.round(sh * scale));
    var ox = Math.floor((W - dw) / 2), oy = Math.floor((H - dh) / 2);
    for (var y = 0; y < dh; y++) {
      var sy0 = Math.floor(y / scale), sy1 = Math.max(sy0 + 1, Math.floor((y + 1) / scale));
      for (var x = 0; x < dw; x++) {
        var sx0 = Math.floor(x / scale), sx1 = Math.max(sx0 + 1, Math.floor((x + 1) / scale));
        var sum = 0, cnt = 0;
        for (var yy = sy0; yy < Math.min(sh, sy1); yy++)
          for (var xx = sx0; xx < Math.min(sw, sx1); xx++) { sum += src[yy * sw + xx]; cnt++; }
        img[(oy + y) * W + ox + x] = cnt ? sum / cnt : 0;
      }
    }
  }

  /* ---------- procedural samples ---------- */
  function clear(img) { img.fill(0); }
  function noteRow(f, H, fmin, fmax) { return freqToRow(f, H, fmin, fmax); }
  var samples = {
    sine: function (img, W, H, fmin, fmax) {
      clear(img);
      var mid = noteRow(440, H, fmin, fmax), amp = H * 0.16;
      /* the fundamental, then the same curve an octave and a twelfth up, dimmer */
      [[1, 1, 2.2, 0.5], [2, 0.45, 1.6, 0.6], [3, 0.22, 1.4, 0.6]].forEach(function (h) {
        var px = 0, py = 0;
        for (var c = 0; c <= W; c += 2) {
          var y0 = mid + amp * Math.sin(TWO_PI * 2.5 * c / W);
          var y = noteRow(rowFreq(y0, H, fmin, fmax) * h[0], H, fmin, fmax);
          if (c > 0) line(img, W, H, px, py, c, y, h[2], h[3], h[1], false);
          px = c; py = y;
        }
      });
    },
    jvl: function (img, W, H, fmin, fmax) {
      clear(img);
      var scale = Math.floor(Math.min(H * 0.62 / 7, W * 0.7 / textWidthCells('JVL')));
      stampText(img, W, H, 'JVL', W / 2, H / 2, scale, 1);
    },
    staircase: function (img, W, H, fmin, fmax) {
      clear(img);
      var notes = [130.81, 164.81, 196.0, 246.94, 329.63, 392.0, 493.88, 659.26, 783.99, 987.77];
      var n = notes.length;
      for (var i = 0; i < n; i++) {
        var x0 = Math.round(W * (0.04 + 0.85 * i / n)), x1 = W - 1;
        var y = noteRow(notes[i], H, fmin, fmax);
        for (var c = x0; c <= x1; c++) {
          var env = Math.min(1, (c - x0) / 12) * (1 - 0.35 * (c - x0) / (x1 - x0));
          dab(img, W, H, c, y, 1.8, 0.6, env, false);
        }
      }
    },
    /* the thumbnail / landing composition: the initials plus a drawn melody and a slow vibrato */
    thumb: function (img, W, H, fmin, fmax) {
      clear(img);
      var scale = Math.floor(H * 0.46 / 7);
      stampText(img, W, H, 'JVL', W * 0.27, H * 0.38, scale, 1);
      /* a little pentatonic tune in the right half, each note a bright bar */
      var tune = [[523.25, 1], [659.26, 1], [783.99, 1], [659.26, 1], [880.0, 2], [783.99, 1], [659.26, 1], [523.25, 2], [392.0, 1], [440.0, 1], [523.25, 3]];
      var beats = 0; tune.forEach(function (t) { beats += t[1]; });
      var x = W * 0.52, span = W * 0.46 / beats;
      tune.forEach(function (t, i) {
        var x1 = x + span * t[1] - 2, y = noteRow(t[0], H, fmin, fmax);
        line(img, W, H, x + 1, y, x1, y, 2.4, 0.45, 1, false);
        line(img, W, H, x + 1, noteRow(t[0] * 2, H, fmin, fmax), x1, noteRow(t[0] * 2, H, fmin, fmax), 1.4, 0.6, 0.35, false);
        x += span * t[1];
      });
      /* a slow vibrato line underneath everything, like a bass drone */
      var px = 0, py = 0;
      for (var c = 0; c <= W; c += 2) {
        var f = 150 * Math.pow(2, 0.08 * Math.sin(TWO_PI * 3 * c / W));
        var y = noteRow(f, H, fmin, fmax);
        if (c > 0) line(img, W, H, px, py, c, y, 1.8, 0.6, 0.6, false);
        px = c; py = y;
      }
    }
  };

  return {
    mulberry32: mulberry32,
    rowFreq: rowFreq,
    freqToRow: freqToRow,
    hann: hann,
    fft: fft,
    naiveDFT: naiveDFT,
    createRenderJob: createRenderJob,
    analyze: analyze,
    encodeWav: encodeWav,
    FONT: FONT,
    textWidthCells: textWidthCells,
    dab: dab,
    line: line,
    stampText: stampText,
    fitImage: fitImage,
    samples: samples
  };
}));
