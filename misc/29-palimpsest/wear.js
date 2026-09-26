/* wear.js — the wear map behind the Palimpsest page.
 *
 * Pure logic, no DOM: a coarse grid of cells over the leaf, each holding a
 * wear value in [0, 1]. Pointer handling adds a Gaussian brush; the page turns
 * the values into CSS masks. The same file runs under Node for tests, so it is
 * wrapped as a tiny UMD module: `Wear` in the browser, `module.exports` in Node.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Wear = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var VERSION = 1;
  var GRID_W = 48;
  var GRID_H = 64;

  /* ---- URL-safe base64 (no padding), written by hand so it is identical in
     Node and in the browser and safe inside a location.hash. ---- */
  var ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  var LOOKUP = (function () {
    var t = {};
    for (var i = 0; i < ALPHABET.length; i++) t[ALPHABET[i]] = i;
    return t;
  })();

  function bytesToB64(bytes) {
    var out = '';
    for (var i = 0; i < bytes.length; i += 3) {
      var b0 = bytes[i], b1 = i + 1 < bytes.length ? bytes[i + 1] : 0, b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
      var n = (b0 << 16) | (b1 << 8) | b2;
      out += ALPHABET[(n >> 18) & 63] + ALPHABET[(n >> 12) & 63];
      if (i + 1 < bytes.length) out += ALPHABET[(n >> 6) & 63];
      if (i + 2 < bytes.length) out += ALPHABET[n & 63];
    }
    return out;
  }

  function b64ToBytes(str) {
    str = String(str || '').replace(/[^A-Za-z0-9\-_]/g, '');
    var len = Math.floor(str.length * 3 / 4);
    var bytes = new Uint8Array(len);
    var j = 0;
    for (var i = 0; i < str.length; i += 4) {
      var c0 = LOOKUP[str[i]] || 0, c1 = LOOKUP[str[i + 1]] || 0, c2 = LOOKUP[str[i + 2]] || 0, c3 = LOOKUP[str[i + 3]] || 0;
      var n = (c0 << 18) | (c1 << 12) | (c2 << 6) | c3;
      if (j < len) bytes[j++] = (n >> 16) & 255;
      if (j < len && i + 2 < str.length) bytes[j++] = (n >> 8) & 255;
      if (j < len && i + 3 < str.length) bytes[j++] = n & 255;
    }
    return bytes;
  }

  /* ---- Byte packing. Cells are quantised to one byte (0..255). Untouched
     cells dominate a lightly handled leaf, so runs of zeros are collapsed to
     a pair [0, runLength]; every other byte is a literal. A three-byte header
     [version, width, height] leads. ---- */
  function packCells(cells, w, h) {
    var out = [VERSION, w, h];
    var i = 0, n = cells.length;
    while (i < n) {
      var q = Math.round(Math.min(1, Math.max(0, cells[i])) * 255);
      if (q === 0) {
        var run = 0;
        while (i < n && run < 255 && Math.round(Math.min(1, Math.max(0, cells[i])) * 255) === 0) { run++; i++; }
        out.push(0, run);
      } else {
        out.push(q);
        i++;
      }
    }
    return Uint8Array.from(out);
  }

  function unpackCells(bytes) {
    if (!bytes || bytes.length < 3 || bytes[0] !== VERSION) return null;
    var w = bytes[1], h = bytes[2];
    if (!w || !h) return null;
    var cells = new Float32Array(w * h);
    var i = 3, j = 0, n = w * h;
    while (i < bytes.length && j < n) {
      var b = bytes[i++];
      if (b === 0) {
        var run = bytes[i++];
        if (run === undefined) break;
        j += run;
      } else {
        cells[j++] = b / 255;
      }
    }
    return { w: w, h: h, cells: cells };
  }

  function smoothstep(a, b, x) {
    var t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  }

  /* ---- The map itself ---- */
  function WearMap(w, h) {
    this.w = w || GRID_W;
    this.h = h || GRID_H;
    this.cells = new Float32Array(this.w * this.h);
  }

  /* Add a Gaussian dab centred at normalised (u, v). `amount` is the peak
     increment; `su`/`sv` are the sigma in cell units along each axis (the
     page converts a pixel radius, so the brush stays round on any leaf). */
  WearMap.prototype.brush = function (u, v, amount, su, sv) {
    if (!(amount > 0)) return;
    su = Math.max(0.3, su || 1.5); sv = Math.max(0.3, sv || 1.5);
    var cx = u * this.w - 0.5, cy = v * this.h - 0.5;
    var rx = Math.ceil(su * 3), ry = Math.ceil(sv * 3);
    var x0 = Math.max(0, Math.floor(cx - rx)), x1 = Math.min(this.w - 1, Math.ceil(cx + rx));
    var y0 = Math.max(0, Math.floor(cy - ry)), y1 = Math.min(this.h - 1, Math.ceil(cy + ry));
    var inv2su = 1 / (2 * su * su), inv2sv = 1 / (2 * sv * sv);
    for (var y = y0; y <= y1; y++) {
      var dy = y - cy;
      for (var x = x0; x <= x1; x++) {
        var dx = x - cx;
        var g = Math.exp(-(dx * dx * inv2su + dy * dy * inv2sv));
        if (g < 0.01) continue;
        var i = y * this.w + x;
        var val = this.cells[i] + amount * g;
        this.cells[i] = val > 1 ? 1 : val;
      }
    }
  };

  WearMap.prototype.clear = function () { this.cells.fill(0); };

  /* Share of cells where the under-text is legible (wear at or past the
     threshold the renderer uses for full reveal). */
  WearMap.prototype.legibleShare = function (threshold) {
    var t = threshold === undefined ? 0.7 : threshold, n = 0;
    for (var i = 0; i < this.cells.length; i++) if (this.cells[i] >= t) n++;
    return n / this.cells.length;
  };

  /* Mean wear over the whole leaf, 0..1. */
  WearMap.prototype.mean = function () {
    var s = 0;
    for (var i = 0; i < this.cells.length; i++) s += this.cells[i];
    return s / this.cells.length;
  };

  WearMap.prototype.encode = function () { return bytesToB64(packCells(this.cells, this.w, this.h)); };

  WearMap.decode = function (str) {
    var parsed = unpackCells(b64ToBytes(str));
    if (!parsed) return null;
    var m = new WearMap(parsed.w, parsed.h);
    m.cells = parsed.cells;
    return m;
  };

  /* Copy a decoded map onto this grid, resampling if the sizes differ. */
  WearMap.prototype.adopt = function (other) {
    if (!other) return;
    if (other.w === this.w && other.h === this.h) { this.cells.set(other.cells); return; }
    for (var y = 0; y < this.h; y++) {
      var sy = Math.min(other.h - 1, Math.floor(y / this.h * other.h));
      for (var x = 0; x < this.w; x++) {
        var sx = Math.min(other.w - 1, Math.floor(x / this.w * other.w));
        this.cells[y * this.w + x] = other.cells[sy * other.w + sx];
      }
    }
  };

  return {
    VERSION: VERSION, GRID_W: GRID_W, GRID_H: GRID_H,
    WearMap: WearMap, smoothstep: smoothstep,
    bytesToB64: bytesToB64, b64ToBytes: b64ToBytes, packCells: packCells, unpackCells: unpackCells
  };
});
