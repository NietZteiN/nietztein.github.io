/*
 * Paper Theatre - procedural art (pure string builders, no DOM).
 *
 * Everything here returns SVG or HTML as a string so test.js can snapshot it
 * under Node. Colour never appears as a literal: every fill and stroke goes
 * through a CSS custom property (--vn-bg, --vn-bg-2, --vn-ink, --vn-ink-2,
 * --vn-accent, --vn-box, --vn-skin-1..5, plus --vn-art-dark / --vn-art-light / --vn-art-line,
 * which stay dark / pale / dark in both themes) with a sensible var() fallback, so
 * theme and story palette are pure CSS. Per-sprite hue lands as --vn-h on the
 * sprite's own <svg> root and is consumed through hsl(var(--vn-h) s l).
 *
 * Same file runs in the browser (window.VNArt) and in Node (module.exports).
 * It does not depend on vn.js: fnv1a and mulberry32 are implemented locally.
 *
 * Coordinate systems
 *   backgrounds, boards   viewBox 0 0 1600 900 (the stage)
 *   sprites               viewBox 0 0 480 720 (one slot; feet at y=720)
 *
 * Class names used by the HTML boards (styled by vn.css; VNArt.baseCSS is a
 * fallback sheet with the same names): .vn-card .vn-card-title .vn-card-cells
 * .vn-cell-label .vn-cell-value .vn-chart .vn-chart-title .vn-code
 * .vn-code-head .vn-code-ln .vn-scene-board .vn-endcard .vn-endcard-title
 * .vn-endcard-authors .vn-endcard-cite .vn-endcard-links .vn-endcard-facts
 * .vn-endcard-note .vn-endcard-ribbon .vn-endcard-actions .vn-btn
 * .vn-sr-only .vn-cast-grid .vn-sprite .vn-bg-svg
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.VNArt = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ------------------------------------------------------------ hashing */

  // FNV-1a 32-bit over UTF-16 code units. Same algorithm as VN.hash.
  function fnv1a(str) {
    var h = 0x811c9dc5;
    str = String(str == null ? '' : str);
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
  }

  function mulberry32(a) {
    a = a >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function rngFor(seed) { return mulberry32(typeof seed === 'number' ? seed : fnv1a(seed)); }

  /* --------------------------------------------------------- utilities */

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function num(n) { return Math.round(n * 100) / 100; }

  function attrs(a) {
    if (!a) return '';
    var out = '';
    for (var k in a) {
      if (!Object.prototype.hasOwnProperty.call(a, k)) continue;
      var v = a[k];
      if (v === null || v === undefined || v === false) continue;
      out += ' ' + k + '="' + esc(v) + '"';
    }
    return out;
  }

  function merge(a, b) {
    var o = {}, k;
    for (k in a) if (Object.prototype.hasOwnProperty.call(a, k)) o[k] = a[k];
    for (k in b) if (Object.prototype.hasOwnProperty.call(b, k)) o[k] = b[k];
    return o;
  }

  // Colour tokens. Every colour in the kit is one of these strings.
  var C = {
    bg: 'var(--vn-bg, #f4f1ea)',
    bg2: 'var(--vn-bg-2, #e2ddd0)',
    ink: 'var(--vn-ink, #1e2430)',
    ink2: 'var(--vn-ink-2, #5a6170)',
    accent: 'var(--vn-accent, #3b6ea5)',
    box: 'var(--vn-box, #fffdf8)',
    // tokens that keep their polarity in both themes
    shade: 'var(--vn-art-dark, #141a26)',
    glow: 'var(--vn-art-light, #f7f5ef)',
    line: 'var(--vn-art-line, #1a1f2a)',
    skin: function (n) {
      var fb = ['#f6dcc8', '#e8bf9e', '#c9956a', '#9a6442', '#5c3a26'][n - 1] || '#c9956a';
      return 'var(--vn-skin-' + n + ', ' + fb + ')';
    },
    // per-sprite hue (set as --vn-h on the sprite root)
    body: 'hsl(var(--vn-h, 210) var(--vn-body-s, 42%) var(--vn-body-l, 50%))',
    bodyDark: 'hsl(var(--vn-h, 210) var(--vn-body-s, 42%) var(--vn-body-l2, 38%))',
    hair: 'hsl(var(--vn-hair-h, 28) var(--vn-hair-s, 22%) var(--vn-hair-l, 24%))',
    spine: function (h) { return 'hsl(' + h + ' var(--vn-spine-s, 36%) var(--vn-spine-l, 50%))'; }
  };

  var FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
  var MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace';

  /* -------------------------------------------------------- primitives */

  function rect(x, y, w, h, a) {
    return '<rect' + attrs(merge({ x: num(x), y: num(y), width: num(w), height: num(h) }, a)) + '/>';
  }
  function circle(cx, cy, r, a) {
    return '<circle' + attrs(merge({ cx: num(cx), cy: num(cy), r: num(r) }, a)) + '/>';
  }
  function path(d, a) {
    return '<path' + attrs(merge({ d: d }, a)) + '/>';
  }
  function text(x, y, str, a) {
    return '<text' + attrs(merge({ x: num(x), y: num(y), 'font-family': FONT }, a)) + '>' + esc(str) + '</text>';
  }
  // stops: [[offset(0-1), colour, opacity?], ...]; opts: {x1,y1,x2,y2} or {radial:true, cx,cy,r}
  function gradient(id, stops, opts) {
    opts = opts || {};
    var s = '';
    for (var i = 0; i < stops.length; i++) {
      var st = stops[i];
      s += '<stop' + attrs({ offset: Math.round(st[0] * 100) + '%', 'stop-color': st[1], 'stop-opacity': st[2] == null ? null : st[2] }) + '/>';
    }
    if (opts.radial) {
      return '<radialGradient' + attrs({ id: id, cx: opts.cx == null ? '50%' : opts.cx, cy: opts.cy == null ? '50%' : opts.cy, r: opts.r == null ? '60%' : opts.r }) + '>' + s + '</radialGradient>';
    }
    return '<linearGradient' + attrs({ id: id, x1: opts.x1 == null ? '0' : opts.x1, y1: opts.y1 == null ? '0' : opts.y1, x2: opts.x2 == null ? '0' : opts.x2, y2: opts.y2 == null ? '1' : opts.y2 }) + '>' + s + '</linearGradient>';
  }
  function group(children, a) {
    return '<g' + attrs(a) + '>' + (Array.isArray(children) ? children.join('') : (children || '')) + '</g>';
  }

  function svg(viewBox, inner, a) {
    return '<svg' + attrs(merge({ xmlns: 'http://www.w3.org/2000/svg', viewBox: viewBox, 'aria-hidden': 'true', focusable: 'false' }, a)) + '>' + inner + '</svg>';
  }
  function defs(inner) { return inner ? '<defs>' + inner + '</defs>' : ''; }

  // ink/paper washes: the whole background vocabulary is tints of two tokens
  function ink(op, extra) { return merge({ fill: C.ink, opacity: op }, extra); }
  function paper(op, extra) { return merge({ fill: C.bg, opacity: op }, extra); }
  function acc(op, extra) { return merge({ fill: C.accent, opacity: op }, extra); }
  function shade(op, extra) { return merge({ fill: C.shade, opacity: op }, extra); }
  function glow(op, extra) { return merge({ fill: C.glow, opacity: op }, extra); }
  function stroke(col, w, op, extra) { return merge({ fill: 'none', stroke: col, 'stroke-width': w, opacity: op, 'stroke-linecap': 'round' }, extra); }
  function line(x1, y1, x2, y2, a) { return path('M' + num(x1) + ' ' + num(y1) + 'L' + num(x2) + ' ' + num(y2), a); }

  /* ---------------------------------------------------------- palettes */

  var PALETTES = { slate: 210, paper: 40, ink: 250, night: 230, ochre: 28, moss: 120 };
  var SKIN_LIGHT = ['#f6dcc8', '#e8bf9e', '#c9956a', '#9a6442', '#5c3a26'];
  var SKIN_DARK = ['#efd2bd', '#ddb08c', '#bf8a5f', '#8f5c3c', '#5a3a28'];

  function paletteHue(spec, fallbackId) {
    if (typeof spec === 'number' && isFinite(spec)) return ((spec % 360) + 360) % 360;
    if (spec && typeof spec === 'object' && typeof spec.hue === 'number') return paletteHue(spec.hue);
    var s = String(spec || '').trim().toLowerCase();
    if (PALETTES.hasOwnProperty(s)) return PALETTES[s];
    var m = /^hue\s*=\s*(-?\d+(?:\.\d+)?)$/.exec(s);
    if (m) return paletteHue(parseFloat(m[1]));
    if (/^-?\d+(?:\.\d+)?$/.test(s)) return paletteHue(parseFloat(s));
    return fnv1a(fallbackId == null ? s : fallbackId) % 360;
  }

  // Returns {name, hue, light:{--vn-*}, dark:{--vn-*}, css(theme) -> "k:v;..."}.
  // Light: paper-white stage with tinted shadows. Dark: deep tinted stage, pale ink.
  function palette(spec, fallbackId) {
    var h = paletteHue(spec, fallbackId);
    var name = typeof spec === 'string' && PALETTES.hasOwnProperty(spec.trim().toLowerCase()) ? spec.trim().toLowerCase() : 'hue=' + h;
    function hsl(s, l) { return 'hsl(' + h + ' ' + s + '% ' + l + '%)'; }
    function hsla(s, l, a) { return 'hsl(' + h + ' ' + s + '% ' + l + '% / ' + a + ')'; }
    var light = {
      '--vn-h': String(h),
      '--vn-bg': hsl(28, 95),
      '--vn-bg-2': hsl(24, 86),
      '--vn-ink': hsl(30, 14),
      '--vn-ink-2': hsl(14, 40),
      '--vn-accent': hsl(52, 40),
      '--vn-box': hsla(30, 99, 0.94),
      '--vn-art-dark': hsl(30, 12),
      '--vn-art-light': hsl(30, 97),
      '--vn-art-line': hsl(30, 16)
    };
    var dark = {
      '--vn-h': String(h),
      '--vn-bg': hsl(22, 11),
      '--vn-bg-2': hsl(20, 18),
      '--vn-ink': hsl(18, 92),
      '--vn-ink-2': hsl(10, 68),
      '--vn-accent': hsl(60, 70),
      '--vn-box': hsla(24, 7, 0.88),
      '--vn-art-dark': hsl(28, 7),
      '--vn-art-light': hsl(20, 94),
      '--vn-art-line': hsl(30, 12),
      '--vn-body-l': '54%',
      '--vn-hair-l': '20%',
      '--vn-spine-l': '44%'
    };
    for (var i = 0; i < 5; i++) {
      light['--vn-skin-' + (i + 1)] = SKIN_LIGHT[i];
      dark['--vn-skin-' + (i + 1)] = SKIN_DARK[i];
    }
    function css(theme) {
      var set = theme === 'dark' ? dark : light, out = [];
      for (var k in set) if (Object.prototype.hasOwnProperty.call(set, k)) out.push(k + ':' + set[k]);
      return out.join(';');
    }
    return { name: name, hue: h, light: light, dark: dark, css: css };
  }

  /* ------------------------------------------------------- backgrounds */

  var BG_NAMES = ['lab', 'office', 'lecture', 'server', 'library', 'night', 'cafe', 'terminal', 'paper', 'train', 'garden', 'void'];
  var MODIFIERS = ['night', 'dawn', 'dim'];

  // hashed code bars inside a monitor
  function codeBars(x, y, w, h, seed, colour) {
    var r = rngFor(seed), out = '', rows = Math.floor(h / 14);
    for (var i = 0; i < rows; i++) {
      var indent = Math.floor(r() * 3) * 16;
      var len = 30 + r() * (w - 60 - indent);
      out += rect(x + 10 + indent, y + 8 + i * 14, len, 6, { fill: colour, opacity: 0.35 + r() * 0.4, rx: 3 });
    }
    return out;
  }

  function monitor(x, y, w, h, seed) {
    return group([
      rect(x + w / 2 - 14, y + h, 28, 42, ink(0.35)),
      rect(x + w / 2 - 60, y + h + 40, 120, 10, ink(0.4, { rx: 4 })),
      rect(x, y, w, h, shade(0.8, { rx: 10 })),
      rect(x + 10, y + 10, w - 20, h - 20, shade(0.92, { rx: 4 })),
      codeBars(x + 10, y + 10, w - 20, h - 20, seed, C.accent),
      rect(x + 10, y + 10, w - 20, (h - 20) * 0.35, paper(0.06, { rx: 4 }))
    ]);
  }

  function windowPane(x, y, w, h, id) {
    return group([
      rect(x - 14, y - 14, w + 28, h + 28, ink(0.18, { rx: 6 })),
      rect(x, y, w, h, { fill: 'url(#' + id + ')' }),
      rect(x + w / 2 - 5, y, 10, h, ink(0.22)),
      rect(x, y + h / 2 - 5, w, 10, ink(0.22))
    ]);
  }

  function floor(y) {
    return group([
      rect(0, y, 1600, 900 - y, ink(0.08)),
      line(0, y, 1600, y, stroke(C.ink, 3, 0.25))
    ]);
  }

  var BG = {
    lab: function (g) {
      return [
        windowPane(560, 110, 480, 300, g.sky),
        rect(0, 560, 1600, 36, ink(0.22)),
        rect(0, 596, 1600, 8, ink(0.35)),
        floor(604),
        rect(120, 604, 24, 260, ink(0.3)),
        rect(1456, 604, 24, 260, ink(0.3)),
        monitor(230, 300, 360, 240, 'lab-left'),
        monitor(1020, 320, 320, 210, 'lab-right'),
        rect(700, 500, 200, 34, ink(0.5, { rx: 6 })),
        rect(930, 520, 110, 46, acc(0.75, { rx: 8 })),
        path('M1040 532 q30 0 30 18 q0 18 -30 18', stroke(C.accent, 8, 0.75)),
        rect(160, 440, 90, 120, ink(0.25, { rx: 4 })),
        rect(174, 456, 62, 10, paper(0.5)),
        rect(174, 476, 62, 10, paper(0.5)),
        rect(174, 496, 62, 10, paper(0.5))
      ].join('');
    },
    office: function (g) {
      return [
        rect(0, 0, 1600, 560, ink(0.04)),
        rect(0, 560, 1600, 40, ink(0.2)),
        floor(600),
        windowPane(1060, 120, 400, 300, g.sky),
        rect(170, 150, 420, 300, ink(0.14, { rx: 4 })),
        rect(190, 170, 380, 260, paper(0.7)),
        rect(220, 200, 160, 120, acc(0.35)),
        rect(400, 200, 140, 40, ink(0.3)),
        rect(400, 260, 140, 10, ink(0.3)),
        rect(400, 290, 100, 10, ink(0.3)),
        rect(220, 340, 320, 10, ink(0.25)),
        rect(220, 370, 260, 10, ink(0.25)),
        rect(700, 420, 260, 200, ink(0.45, { rx: 14 })),
        rect(720, 440, 220, 100, ink(0.3, { rx: 10 })),
        rect(650, 620, 360, 24, ink(0.5, { rx: 8 })),
        rect(1200, 460, 120, 150, ink(0.3, { rx: 6 })),
        circle(1260, 430, 60, acc(0.55)),
        circle(1225, 470, 44, acc(0.45)),
        circle(1300, 465, 40, acc(0.5))
      ].join('');
    },
    lecture: function () {
      var chalk = '', r = rngFor('lecture-chalk');
      for (var i = 0; i < 7; i++) {
        var x = 300 + r() * 140, y = 180 + i * 46, len = 200 + r() * 560;
        chalk += line(x, y, x + len, y + (r() - 0.5) * 6, stroke(C.glow, 5, 0.45 + r() * 0.3));
      }
      chalk += path('M900 170 q40 60 0 120 t0 120', stroke(C.glow, 4, 0.6));
      chalk += circle(1000, 230, 26, stroke(C.glow, 4, 0.6));
      return [
        rect(0, 0, 1600, 640, ink(0.03)),
        rect(220, 110, 1160, 420, ink(0.3)),
        rect(240, 130, 1120, 380, shade(0.8)),
        chalk,
        rect(240, 510, 1120, 22, ink(0.45)),
        rect(560, 505, 60, 10, glow(0.8, { rx: 3 })),
        rect(0, 640, 1600, 16, ink(0.3)),
        floor(656),
        path('M1200 656 L1230 420 L1420 420 L1450 656 Z', ink(0.55)),
        rect(1220, 400, 210, 30, ink(0.7, { rx: 4 })),
        rect(1250, 410, 140, 8, acc(0.6))
      ].join('');
    },
    server: function () {
      var racks = '';
      for (var i = 0; i < 5; i++) {
        var x = 110 + i * 290, r = rngFor('rack' + i);
        racks += rect(x, 120, 230, 600, shade(0.82, { rx: 8 }));
        racks += rect(x + 12, 132, 206, 576, shade(0.5, { rx: 4 }));
        for (var j = 0; j < 12; j++) {
          var y = 150 + j * 46;
          racks += rect(x + 20, y, 190, 34, shade(0.55, { rx: 3 }));
          racks += rect(x + 30, y + 14, 90, 6, glow(0.15, { rx: 3 }));
          for (var k = 0; k < 3; k++) {
            var on = r() > 0.35;
            racks += circle(x + 160 + k * 18, y + 17, 5, { fill: C.accent, opacity: on ? 0.95 : 0.25, 'class': on ? 'vn-led' : null });
          }
        }
      }
      return [
        rect(0, 0, 1600, 900, shade(0.35)),
        rect(0, 0, 1600, 60, shade(0.5)),
        rect(300, 0, 1000, 24, glow(0.5, { rx: 0 })),
        racks,
        rect(0, 720, 1600, 180, shade(0.45)),
        rect(0, 720, 1600, 6, glow(0.25)),
        rect(0, 740, 1600, 160, { fill: 'url(#' + 'vnbg-refl' + ')', opacity: 0.5 })
      ].join('');
    },
    library: function (g, opts) {
      var spines = opts && opts.spines, out = '', r = rngFor(opts && opts.seed != null ? opts.seed : 'library');
      var shelves = [160, 300, 440, 580];
      var bookcases = [[60, 520], [600, 520], [1140, 400]];
      var si = 0;
      for (var b = 0; b < bookcases.length; b++) {
        var bx = bookcases[b][0], bw = bookcases[b][1];
        out += rect(bx - 16, 100, bw + 32, 560, ink(0.42, { rx: 6 }));
        out += rect(bx, 116, bw, 530, ink(0.18));
        for (var s = 0; s < shelves.length; s++) {
          var sy = shelves[s], x = bx + 10;
          while (x < bx + bw - 24) {
            var w = 16 + Math.floor(r() * 26), hgt = 84 + Math.floor(r() * 40);
            var hue, title = '';
            if (spines && spines.length) {
              var sp = spines[si % spines.length]; si++;
              hue = typeof sp.genreHue === 'number' ? sp.genreHue : fnv1a(sp.genre || sp.title || '') % 360;
              title = sp.title || '';
            } else {
              hue = Math.floor(r() * 360);
            }
            var spine = rect(x, sy + 120 - hgt, w, hgt, { fill: C.spine(hue), rx: 2 }) + rect(x + 3, sy + 120 - hgt + 10, w - 6, 5, paper(0.5));
            out += title ? group('<title>' + esc(title) + '</title>' + spine) : spine;
            x += w + 3 + (r() < 0.1 ? 14 : 0);
          }
          out += rect(bx, sy + 120, bw, 14, ink(0.5));
        }
      }
      return [
        rect(0, 0, 1600, 900, ink(0.05)),
        out,
        rect(0, 660, 1600, 20, ink(0.3)),
        floor(680),
        rect(760, 60, 80, 14, ink(0.25, { rx: 7 })),
        rect(790, 0, 20, 60, ink(0.3)),
        circle(800, 110, 44, acc(0.22)),
        circle(800, 100, 26, { fill: C.box, opacity: 0.9 })
      ].join('');
    },
    night: function () {
      var r = rngFor('night-stars'), stars = '';
      for (var i = 0; i < 90; i++) {
        var x = r() * 1600, y = r() * 520, rad = 1 + r() * 2.2;
        stars += circle(x, y, rad, glow(0.35 + r() * 0.6));
      }
      var skyline = 'M0 640 L0 560 L120 560 L120 500 L220 500 L220 540 L330 540 L330 420 L380 420 L380 540 L470 540 L470 580 L600 580 L600 470 L690 470 L690 520 L820 520 L820 460 L870 440 L920 460 L920 560 L1040 560 L1040 480 L1130 480 L1130 530 L1260 530 L1260 440 L1310 440 L1310 530 L1420 530 L1420 570 L1600 570 L1600 640 Z';
      var lights = '', r2 = rngFor('night-windows');
      for (var j = 0; j < 60; j++) {
        lights += rect(40 + r2() * 1500, 470 + r2() * 150, 8, 10, acc(0.3 + r2() * 0.6));
      }
      return [
        rect(0, 0, 1600, 900, shade(0.8)),
        stars,
        circle(1240, 170, 70, { fill: C.glow, opacity: 0.9 }),
        circle(1210, 150, 62, shade(0.6)),
        path(skyline, shade(0.92)),
        lights,
        rect(0, 640, 1600, 260, shade(0.96)),
        rect(0, 640, 1600, 3, glow(0.2))
      ].join('');
    },
    cafe: function (g) {
      return [
        rect(0, 0, 1600, 580, ink(0.05)),
        rect(0, 300, 1600, 280, ink(0.1)),
        line(0, 300, 1600, 300, stroke(C.ink, 6, 0.3)),
        windowPane(170, 100, 440, 320, g.sky),
        line(1120, 0, 1120, 170, stroke(C.ink, 4, 0.6)),
        path('M1040 170 L1200 170 L1160 260 L1080 260 Z', ink(0.7)),
        path('M1080 260 L1160 260 L1300 900 L940 900 Z', acc(0.12)),
        circle(1120, 262, 14, acc(0.9)),
        rect(0, 580, 1600, 30, ink(0.25)),
        floor(610),
        path('M300 640 L1300 640 L1250 700 L350 700 Z', ink(0.55)),
        rect(360, 700, 880, 14, ink(0.35)),
        rect(760, 714, 80, 186, ink(0.4)),
        rect(560, 596, 86, 56, { fill: C.box, opacity: 0.95, rx: 8 }),
        path('M646 610 q30 0 30 18 q0 20 -30 18', stroke(C.box, 9, 0.95)),
        rect(540, 648, 126, 10, { fill: C.box, opacity: 0.9, rx: 5 }),
        path('M580 585 q-14 -20 0 -40 q14 -18 0 -36', stroke(C.ink, 4, 0.3)),
        path('M612 580 q-14 -20 0 -40 q14 -18 0 -36', stroke(C.ink, 4, 0.22))
      ].join('');
    },
    terminal: function () {
      var r = rngFor('terminal'), glyphs = '01{}[]<>;=+-*/\\|_#$%&@:', out = '';
      for (var col = 0; col < 32; col++) {
        var x = 30 + col * 49, n = 8 + Math.floor(r() * 22), yy = 20 + r() * 180, spans = '';
        for (var i = 0; i < n; i++) {
          var ch = glyphs.charAt(Math.floor(r() * glyphs.length));
          spans += '<tspan x="' + x + '" dy="' + (i ? 34 : 0) + '" opacity="' + num(0.3 + r() * 0.6) + '">' + esc(ch) + '</tspan>';
        }
        out += '<text' + attrs({ x: x, y: num(yy), 'font-family': MONO, 'font-size': 26, fill: C.accent }) + '>' + spans + '</text>';
      }
      return [
        rect(0, 0, 1600, 900, shade(0.9)),
        out,
        rect(0, 0, 1600, 900, { fill: 'url(#vnbg-scan)', opacity: 0.35 }),
        rect(0, 0, 1600, 900, { fill: 'url(#vnbg-vig)' })
      ].join('');
    },
    paper: function () {
      var rules = '';
      for (var y = 150; y < 900; y += 48) rules += line(80, y, 1520, y, stroke(C.ink, 2, 0.12));
      return [
        rect(0, 0, 1600, 900, ink(0.1)),
        rect(50, 40, 1500, 860, ink(0.18)),
        rect(40, 30, 1500, 870, { fill: C.bg, opacity: 0.97 }),
        rules,
        line(220, 30, 220, 900, stroke(C.accent, 3, 0.55)),
        circle(130, 160, 18, ink(0.14)),
        circle(130, 450, 18, ink(0.14)),
        circle(130, 740, 18, ink(0.14)),
        rect(1300, 60, 180, 30, acc(0.12, { rx: 4 }))
      ].join('');
    },
    train: function (g) {
      var r = rngFor('train-lights'), lights = '';
      for (var i = 0; i < 26; i++) {
        var x = 220 + r() * 1160, y = 200 + r() * 180, w = 20 + r() * 90;
        lights += rect(x, y, w, 8 + r() * 10, acc(0.25 + r() * 0.6, { rx: 5, 'class': 'vn-train-light' }));
      }
      return [
        rect(0, 0, 1600, 900, ink(0.1)),
        rect(0, 0, 1600, 90, ink(0.3)),
        rect(0, 560, 1600, 100, ink(0.22)),
        rect(180, 120, 1240, 420, ink(0.3, { rx: 28 })),
        rect(200, 140, 1200, 380, { fill: 'url(#' + g.sky + ')', rx: 22 }),
        rect(200, 140, 1200, 380, shade(0.6, { rx: 22 })),
        lights,
        rect(200, 430, 1200, 90, shade(0.7)),
        rect(200, 140, 1200, 380, stroke(C.ink, 10, 0.5, { rx: 22 })),
        line(0, 120, 1600, 120, stroke(C.glow, 6, 0.35)),
        rect(300, 112, 1000, 14, paper(0.6, { rx: 7 })),
        floor(660),
        path('M0 900 L0 700 Q0 680 20 680 L420 680 Q440 680 440 700 L440 900 Z', ink(0.5)),
        path('M1160 900 L1160 700 Q1160 680 1180 680 L1580 680 Q1600 680 1600 700 L1600 900 Z', ink(0.5)),
        rect(20, 700, 400, 40, ink(0.25, { rx: 10 })),
        rect(1180, 700, 400, 40, ink(0.25, { rx: 10 }))
      ].join('');
    },
    garden: function () {
      var r = rngFor('garden'), rake = '', canopy = '';
      for (var i = 0; i < 9; i++) {
        var y = 640 + i * 28;
        rake += path('M0 ' + y + ' q400 -20 800 0 t800 0', stroke(C.ink, 2, 0.14));
      }
      for (var j = 0; j < 14; j++) {
        var cx = 190 + (r() - 0.5) * 260, cy = 215 + (r() - 0.5) * 130, rad = 30 + r() * 50;
        canopy += circle(cx, cy, rad, acc(0.4 + r() * 0.4));
      }
      return [
        rect(0, 0, 1600, 900, ink(0.04)),
        rect(0, 470, 1600, 150, ink(0.12)),
        line(0, 470, 1600, 470, stroke(C.ink, 4, 0.3)),
        rect(0, 600, 1600, 300, ink(0.07)),
        rake,
        path('M210 620 L196 500 Q190 380 200 300', stroke(C.ink, 16, 0.7)),
        path('M200 420 Q260 360 300 290', stroke(C.ink, 9, 0.65)),
        path('M198 440 Q130 390 110 320', stroke(C.ink, 8, 0.65)),
        canopy,
        path('M900 620 q-70 -10 -140 -30 q20 -70 120 -80 q90 10 110 80 q-40 25 -90 30 Z', ink(0.45)),
        path('M1120 610 q-50 -5 -80 -40 q30 -50 90 -40 q50 20 50 60 q-30 20 -60 20 Z', ink(0.4)),
        path('M1180 622 q-30 0 -50 -16 q10 -30 50 -28 q30 10 36 28 q-16 14 -36 16 Z', ink(0.3)),
        rect(1360, 150, 6, 110, ink(0.6)),
        rect(1330, 258, 66, 12, ink(0.6, { rx: 3 })),
        rect(1324, 270, 78, 130, { fill: C.box, opacity: 0.92, rx: 30 }),
        rect(1324, 270, 78, 130, acc(0.3, { rx: 30 })),
        line(1340, 300, 1386, 300, stroke(C.ink, 3, 0.3)),
        line(1340, 370, 1386, 370, stroke(C.ink, 3, 0.3)),
        rect(1330, 400, 66, 12, ink(0.6, { rx: 3 })),
        rect(1340, 150, 46, 10, ink(0.6, { rx: 3 }))
      ].join('');
    },
    'void': function () {
      return rect(0, 0, 1600, 900, { fill: 'url(#vnbg-vig)' });
    }
  };

  // background(name, modifier, opts) -> <svg viewBox="0 0 1600 900">.
  //   name: lab office lecture server library night cafe terminal paper train garden void
  //   modifier: 'night' | 'dawn' | 'dim' | undefined
  //   opts: { spines: [{title, genreHue}], seed } for library; an array is taken as spines.
  // Unknown names fall back to void (the renderer owns the warning).
  function background(name, modifier, opts) {
    if (Array.isArray(opts)) opts = { spines: opts };
    name = String(name || 'void').toLowerCase();
    modifier = modifier ? String(modifier).toLowerCase() : '';
    if (!BG.hasOwnProperty(name)) name = 'void';
    if (MODIFIERS.indexOf(modifier) < 0) modifier = '';
    var sky = 'vnbg-sky-' + name + (modifier ? '-' + modifier : '');
    var skyStops = modifier === 'night' ? [[0, C.shade, 0.92], [1, C.shade, 0.55]]
      : modifier === 'dawn' ? [[0, C.bg2, 1], [0.55, C.accent, 0.4], [1, C.bg, 1]]
        : [[0, C.bg2, 1], [1, C.bg, 1]];
    var d = defs(
      gradient(sky, skyStops) +
      gradient('vnbg-vig', [[0, C.bg2, 0], [1, C.ink, 0.35]], { radial: true, r: '75%' }) +
      gradient('vnbg-refl', [[0, C.accent, 0.25], [1, C.accent, 0]]) +
      gradient('vnbg-scan', [[0, C.shade, 0], [0.5, C.shade, 0.5], [1, C.shade, 0]], { y2: '0.02' })
    );
    var body = BG[name]({ sky: sky }, opts || {});
    var overlay = modifier === 'night' ? rect(0, 0, 1600, 900, shade(0.5))
      : modifier === 'dawn' ? rect(0, 0, 1600, 900, acc(0.14))
        : modifier === 'dim' ? rect(0, 0, 1600, 900, ink(0.28)) : '';
    return svg('0 0 1600 900', d + rect(0, 0, 1600, 900, { fill: 'url(#' + sky + ')' }) + body + overlay,
      { 'class': 'vn-bg-svg', 'data-bg': name, 'data-mod': modifier || null, preserveAspectRatio: 'xMidYMid slice' });
  }

  /* ----------------------------------------------------------- sprites */

  var FACES = ['neutral', 'smile', 'puzzled', 'worried', 'surprised', 'thinking', 'deadpan', 'laugh'];
  var HAIR = ['short', 'long', 'bun', 'curly', 'none', 'hood'];

  // Accepts the parser's cast declaration in any of these spellings:
  //   {name, display|name, hue, skin, hair:'short', glasses:true, hat:true, lattice:'sparse'|'dense'|true, player, page}
  //   or flags: {short:true}, {lattice:'dense'}, {traits:['glasses','hat']}
  function normCast(decl) {
    decl = decl || {};
    if (typeof decl === 'string') decl = { name: decl };
    var name = decl.id || decl.name || 'Someone';
    var traits = decl.traits || decl.flags || [];
    function has(t) { return decl[t] === true || traits.indexOf(t) >= 0; }
    var hair = decl.hair;
    if (!hair) for (var i = 0; i < HAIR.length; i++) if (has(HAIR[i])) { hair = HAIR[i]; break; }
    if (!hair) hair = HAIR[fnv1a(name + ':hair') % 4];
    var lattice = decl.lattice;
    if (lattice === true) lattice = 'sparse';
    if (!lattice && has('lattice')) lattice = 'sparse';
    var hue = typeof decl.hue === 'number' ? ((decl.hue % 360) + 360) % 360 : fnv1a(name) % 360;
    var skin = decl.skin >= 1 && decl.skin <= 5 ? Math.round(decl.skin) : 1 + (fnv1a(name + ':skin') % 5);
    return {
      name: name,
      display: decl.display || decl.label || decl.name || name,
      hue: hue,
      skin: skin,
      hair: HAIR.indexOf(hair) >= 0 ? hair : 'short',
      glasses: has('glasses'),
      hat: has('hat'),
      lattice: lattice === 'sparse' || lattice === 'dense' ? lattice : null,
      player: has('player'),
      page: has('page'),
      coauthor: has('coauthor'),
      hairHue: [20, 28, 34, 40, 215][fnv1a(name + ':hh') % 5]
    };
  }

  function normFace(face) {
    face = String(face || 'neutral').toLowerCase();
    return FACES.indexOf(face) >= 0 ? face : 'neutral';
  }

  function spriteRoot(c, inner, a) {
    return svg('0 0 480 720', inner, merge({
      'class': 'vn-sprite',
      'data-name': c.name,
      'data-kind': c.lattice ? 'lattice' : c.player ? 'player' : c.page ? 'page' : 'person',
      style: '--vn-h:' + c.hue + ';--vn-hair-h:' + c.hairHue
    }, a));
  }

  // Face feature geometry (person): eyes y=240 at x=205/275, brows y=208, mouth y=300.
  var EYE = { lx: 205, rx: 275, y: 242 };
  function dots(r) {
    return circle(EYE.lx, EYE.y, r, { fill: C.line }) + circle(EYE.rx, EYE.y, r, { fill: C.line });
  }
  var FACE_PATHS = {
    neutral: function () { return dots(7) + line(222, 302, 258, 302, stroke(C.line, 6, 1)); },
    smile: function () { return dots(7) + path('M216 296 q24 26 48 0', stroke(C.line, 6, 1)); },
    puzzled: function () {
      return dots(7) + path('M258 204 q18 -14 36 2', stroke(C.line, 6, 1)) + line(186, 214, 222, 212, stroke(C.line, 6, 1)) +
        path('M224 304 q20 -10 40 4', stroke(C.line, 6, 1));
    },
    worried: function () {
      return dots(7) + line(186, 210, 222, 220, stroke(C.line, 6, 1)) + line(258, 220, 294, 210, stroke(C.line, 6, 1)) +
        path('M220 310 q20 -16 40 0', stroke(C.line, 6, 1));
    },
    surprised: function () {
      return circle(EYE.lx, EYE.y, 11, { fill: C.line }) + circle(EYE.rx, EYE.y, 11, { fill: C.line }) +
        circle(EYE.lx - 3, EYE.y - 3, 3, { fill: C.glow }) + circle(EYE.rx - 3, EYE.y - 3, 3, { fill: C.glow }) +
        path('M188 200 q17 -12 34 0', stroke(C.line, 6, 1)) + path('M258 200 q17 -12 34 0', stroke(C.line, 6, 1)) +
        circle(240, 306, 11, { fill: C.line });
    },
    thinking: function () {
      return circle(EYE.lx + 6, EYE.y - 6, 7, { fill: C.line }) + circle(EYE.rx + 6, EYE.y - 6, 7, { fill: C.line }) +
        path('M258 204 q18 -12 36 0', stroke(C.line, 6, 1)) + line(226, 304, 254, 300, stroke(C.line, 6, 1));
    },
    deadpan: function () {
      return line(190, 242, 220, 242, stroke(C.line, 7, 1)) + line(260, 242, 290, 242, stroke(C.line, 7, 1)) +
        line(220, 304, 260, 304, stroke(C.line, 6, 1));
    },
    laugh: function () {
      return path('M190 246 q15 -18 30 0', stroke(C.line, 7, 1)) + path('M260 246 q15 -18 30 0', stroke(C.line, 7, 1)) +
        path('M214 292 q26 36 52 0 Z', { fill: C.line }) + path('M224 296 q16 14 32 0 Z', { fill: C.glow, opacity: 0.9 });
    }
  };

  // All eight faces as <g data-face> so the renderer can crossfade by toggling
  // opacity; the active one has class "is-on". Lattice faces reuse this.
  function faceGroups(active, builder) {
    var out = '';
    for (var i = 0; i < FACES.length; i++) {
      var f = FACES[i], on = f === active;
      out += group(builder(f), { 'data-face': f, 'class': 'vn-face vn-face-' + f + (on ? ' is-on' : ''), style: 'opacity:' + (on ? 1 : 0) + ';transition:opacity .16s' });
    }
    return out;
  }

  function hairBack(c) {
    if (c.hair === 'long') return rect(132, 230, 216, 300, { fill: C.hair, rx: 60 });
    if (c.hair === 'hood') return path('M110 720 L110 420 Q110 230 240 110 Q370 230 370 420 L370 720 Z', { fill: C.bodyDark });
    return '';
  }
  function hairFront(c) {
    var cap = path('M135 250 A105 105 0 0 1 345 250 L345 232 Q300 196 240 206 Q180 196 135 232 Z', { fill: C.hair });
    switch (c.hair) {
      case 'none': return '';
      case 'short': return cap;
      case 'long': return cap + path('M135 250 L135 340 Q150 280 160 236 Z', { fill: C.hair }) + path('M345 250 L345 340 Q330 280 320 236 Z', { fill: C.hair });
      case 'bun': return cap + circle(240, 150, 40, { fill: C.hair });
      case 'curly': {
        var o = '';
        for (var i = 0; i < 9; i++) {
          var ang = Math.PI + (i / 8) * Math.PI, x = 240 + Math.cos(ang) * 104, y = 250 + Math.sin(ang) * 104;
          o += circle(x, y, 30, { fill: C.hair });
        }
        return o + cap;
      }
      case 'hood': return path('M135 262 A105 112 0 0 1 345 262 L370 262 Q370 120 240 108 Q110 120 110 262 Z', { fill: C.bodyDark });
    }
    return cap;
  }
  function glasses() {
    return group([
      circle(EYE.lx, EYE.y, 24, stroke(C.line, 5, 1)),
      circle(EYE.rx, EYE.y, 24, stroke(C.line, 5, 1)),
      line(229, EYE.y, 251, EYE.y, stroke(C.line, 5, 1)),
      line(140, 236, 181, 240, stroke(C.line, 4, 1)),
      line(299, 240, 340, 236, stroke(C.line, 4, 1))
    ], { 'class': 'vn-glasses' });
  }
  function hat() {
    return group([
      path('M110 190 Q240 150 370 190 L370 204 Q240 170 110 204 Z', { fill: C.line, opacity: 0.85 }),
      path('M160 190 Q160 90 240 86 Q320 90 320 190 Z', { fill: C.line, opacity: 0.85 }),
      rect(160, 172, 160, 14, acc(0.9))
    ], { 'class': 'vn-hat' });
  }

  function person(c, face) {
    var inner = [
      hairBack(c),
      path('M118 720 L128 440 Q136 376 200 364 L280 364 Q344 376 352 440 L362 720 Z', { fill: C.body }),
      path('M200 364 L240 430 L280 364 Z', { fill: C.bodyDark }),
      rect(214, 316, 52, 64, { fill: C.skin(c.skin) }),
      circle(240, 250, 105, { fill: C.skin(c.skin) }),
      circle(140, 258, 14, { fill: C.skin(c.skin) }),
      circle(340, 258, 14, { fill: C.skin(c.skin) }),
      faceGroups(face, function (f) { return FACE_PATHS[f](); }),
      c.glasses ? glasses() : '',
      hairFront(c),
      c.hat ? hat() : ''
    ].join('');
    return spriteRoot(c, inner, { 'data-face': face });
  }

  // Back-of-head silhouette, closer to the viewer so it reads as "You".
  function player(decl) {
    var c = normCast(decl);
    var inner = [
      path('M40 720 L60 520 Q80 440 190 424 L290 424 Q400 440 420 520 L440 720 Z', { fill: C.body }),
      path('M190 424 L240 470 L290 424 Z', { fill: C.bodyDark }),
      rect(200, 370, 80, 70, { fill: C.skin(c.skin) }),
      circle(240, 280, 140, { fill: C.skin(c.skin) }),
      c.hair === 'none' ? '' : (c.hair === 'hood'
        ? path('M70 720 L70 400 Q90 170 240 140 Q390 170 410 400 L410 720 Z', { fill: C.bodyDark })
        : path('M100 300 A140 140 0 0 1 380 300 L380 ' + (c.hair === 'long' ? 520 : 330) + ' Q300 ' + (c.hair === 'long' ? 540 : 360) + ' 240 ' + (c.hair === 'long' ? 560 : 356) + ' Q180 ' + (c.hair === 'long' ? 540 : 360) + ' 100 ' + (c.hair === 'long' ? 520 : 330) + ' Z', { fill: C.hair })),
      c.hair === 'bun' ? circle(240, 150, 46, { fill: C.hair }) : '',
      c.hat ? path('M60 230 Q240 180 420 230 L420 246 Q240 200 60 246 Z M130 232 Q130 100 240 96 Q350 100 350 232 Z', { fill: C.line, opacity: 0.9 }) : '',
      c.glasses ? group([line(104, 262, 124, 250, stroke(C.line, 5, 1)), line(376, 262, 356, 250, stroke(C.line, 5, 1))]) : ''
    ].join('');
    return spriteRoot(c, inner, { 'data-face': 'back' });
  }

  // A floating ruled sheet: the speaker for quotations.
  function page(decl) {
    var c = normCast(decl);
    var rules = '';
    for (var i = 0; i < 9; i++) rules += line(130, 230 + i * 36, 350, 230 + i * 36, stroke(C.ink, 2.5, 0.22));
    var inner = group([
      rect(112, 150, 270, 400, ink(0.18, { rx: 6 })),
      rect(96, 136, 270, 400, { fill: C.box, stroke: C.ink2, 'stroke-width': 2, rx: 4 }),
      path('M366 456 L366 536 L286 536 Q320 520 326 496 Q332 470 366 456 Z', { fill: C.bg2 }),
      path('M366 456 Q330 470 320 500 Q310 526 286 536', stroke(C.ink2, 2, 1)),
      rect(130, 170, 120, 10, acc(0.8, { rx: 4 })),
      rules,
      rect(130, 226, 180, 6, ink(0.6, { rx: 3 })),
      rect(130, 262, 220, 6, ink(0.6, { rx: 3 })),
      rect(130, 298, 150, 6, ink(0.6, { rx: 3 }))
    ], { transform: 'rotate(-5 240 340)', 'class': 'vn-page' });
    return spriteRoot(c, inner, { 'data-face': 'page' });
  }

  // Head-and-shoulders silhouette filled with a seeded node graph.
  //   sparse: fewer nodes, jittered, some long-range edges (reasoning regime)
  //   dense : regular grid, short edges only (coder / instruction regime)
  function latticePoints(c, dense) {
    var r = rngFor(c.name + ':lattice'), pts = [], step = dense ? 30 : 50, jit = dense ? 5 : 18;
    function inside(x, y) {
      var dx = x - 240, dy = y - 250;
      if (dx * dx + dy * dy <= 112 * 112) return true;
      if (y >= 380 && y <= 720) {
        var half = 90 + (y - 380) * 0.16;
        if (y < 440) half = 60 + (y - 380) * 0.9;
        return Math.abs(dx) <= half;
      }
      return false;
    }
    for (var y = 130; y <= 712; y += step) {
      for (var x = 100; x <= 380; x += step) {
        var px = x + (r() - 0.5) * 2 * jit, py = y + (r() - 0.5) * 2 * jit;
        if (inside(px, py)) pts.push([px, py]);
      }
    }
    var edges = [], thr = dense ? step * 1.45 : step * 1.5;
    for (var i = 0; i < pts.length; i++) {
      for (var j = i + 1; j < pts.length; j++) {
        var ddx = pts[i][0] - pts[j][0], ddy = pts[i][1] - pts[j][1];
        if (Math.sqrt(ddx * ddx + ddy * ddy) <= thr) edges.push([i, j, 1]);
      }
    }
    if (!dense) {
      for (var k = 0; k < 7 && pts.length > 2; k++) {
        var a = Math.floor(r() * pts.length), b = Math.floor(r() * pts.length);
        if (a !== b) edges.push([a, b, 0.45]);
      }
    }
    return { pts: pts, edges: edges };
  }

  var LATTICE_FACE = {
    neutral: { pts: [[205, 242], [275, 242], [226, 302], [254, 302]] },
    smile: { pts: [[205, 242], [275, 242], [216, 296], [228, 310], [240, 314], [252, 310], [264, 296]] },
    puzzled: { pts: [[205, 242], [275, 242], [262, 206], [296, 204], [226, 306], [258, 300]], ring: true },
    worried: { pts: [[205, 242], [275, 242], [222, 308], [240, 298], [258, 308]], hollow: [[196, 212], [284, 212]] },
    surprised: { pts: [[205, 242], [275, 242], [240, 306]], big: true },
    thinking: { pts: [[211, 236], [281, 236], [262, 206], [240, 304]] },
    deadpan: { pts: [[195, 242], [215, 242], [265, 242], [285, 242], [222, 304], [240, 304], [258, 304]] },
    laugh: { pts: [[196, 246], [205, 236], [214, 246], [266, 246], [275, 236], [284, 246], [222, 294], [240, 318], [258, 294]] }
  };

  function lattice(decl, face, opts) {
    var c = normCast(decl);
    face = normFace(face);
    var dense = opts && typeof opts.dense === 'boolean' ? opts.dense : c.lattice === 'dense';
    var L = latticePoints(c, dense), pts = L.pts, edges = L.edges, out = '';
    var nodeR = dense ? 3.4 : 5.5;
    for (var e = 0; e < edges.length; e++) {
      var p = pts[edges[e][0]], q = pts[edges[e][1]];
      out += line(p[0], p[1], q[0], q[1], stroke(C.accent, dense ? 1.4 : 2, 0.3 * edges[e][2] + 0.08));
    }
    var nodes = '';
    for (var i = 0; i < pts.length; i++) nodes += circle(pts[i][0], pts[i][1], nodeR, { fill: C.accent, opacity: 0.85 });
    out += group(nodes, { 'class': 'vn-lattice-nodes', filter: 'url(#vn-glow)' });
    out += faceGroups(face, function (f) {
      var spec = LATTICE_FACE[f], s = '';
      if (spec.ring) s += circle(240, 250, 150, stroke(C.accent, 3, 0.5, { 'class': 'vn-ripple' }));
      for (var k = 0; k < spec.pts.length; k++) {
        s += circle(spec.pts[k][0], spec.pts[k][1], spec.big ? 13 : 9, { fill: C.accent, opacity: 1 });
        s += circle(spec.pts[k][0], spec.pts[k][1], spec.big ? 13 : 9, stroke(C.bg, 3, 0.9));
      }
      if (spec.hollow) for (var h = 0; h < spec.hollow.length; h++) s += circle(spec.hollow[h][0], spec.hollow[h][1], 9, stroke(C.accent, 3, 0.9));
      return s;
    });
    var inner = defs(
      '<filter id="vn-glow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>'
    ) + path('M240 138 a112 112 0 1 0 0.1 0 Z M180 380 L300 380 L330 440 Q350 520 360 720 L120 720 Q130 520 150 440 Z', acc(0.07)) + out;
    return spriteRoot(c, inner, { 'data-face': face, 'data-lattice': dense ? 'dense' : 'sparse' });
  }

  // sprite(castDecl, face) dispatches on the declaration: lattice | player | page | person.
  function sprite(decl, face) {
    var c = normCast(decl);
    if (c.lattice) return lattice(c, face);
    if (c.player) return player(c);
    if (c.page) return page(c);
    return person(c, normFace(face));
  }

  // Shared <defs> (the glow filter) for a page that wants to define it once.
  function sharedDefs() {
    return '<svg width="0" height="0" aria-hidden="true" style="position:absolute"><defs><filter id="vn-glow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs></svg>';
  }

  /* ------------------------------------------------------------ boards */

  function splitCell(cell) {
    if (cell && typeof cell === 'object') return { label: cell.label || '', value: cell.value == null ? '' : String(cell.value) };
    var s = String(cell == null ? '' : cell), m = /^([^:]{1,40}):\s+(.+)$/.exec(s);
    return m ? { label: m[1], value: m[2] } : { label: '', value: s };
  }

  // Inline markup inside cells: *em* and `code`, text otherwise escaped.
  function inline(s) {
    return esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*([^*]+)\*/g, '<em>$1</em>');
  }

  function chips(refs) {
    return (refs || []).map(function (r) {
      return ' <abbr class="vn-chip" title="quoted from the source, ' + esc(refTitle(r)) + '">' + esc(r) + '</abbr>';
    }).join('');
  }

  // card(title, cells) or card(op) where op = {title, cells:[{label, value, ref}], refs}
  function card(title, cells) {
    var refs = null;
    if (title && typeof title === 'object') { cells = title.cells; refs = title.refs; title = title.title; }
    var items = '';
    (cells || []).forEach(function (cell) {
      var c = splitCell(cell);
      items += '<li class="vn-cell">' + (c.label ? '<span class="vn-cell-label">' + inline(c.label) + '</span>' : '') +
        '<span class="vn-cell-value">' + inline(c.value) + (cell && cell.ref ? chips([cell.ref]) : '') + '</span></li>';
    });
    return '<div class="vn-card vn-board" role="group" aria-label="' + esc(title) + '">' +
      '<h2 class="vn-card-title">' + inline(title) + chips(refs) + '</h2>' +
      '<ul class="vn-card-cells" data-count="' + (cells || []).length + '">' + items + '</ul></div>';
  }

  function parseNum(v) {
    if (typeof v === 'number') return v;
    var m = /-?\d+(?:[.,]\d+)?/.exec(String(v == null ? '' : v).replace(/,/g, ''));
    return m ? parseFloat(m[0].replace(',', '.')) : NaN;
  }
  function niceStep(span) {
    var raw = span / 4, mag = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10)), n = raw / mag;
    return (n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10) * mag;
  }
  function fmt(n, unit) {
    var s = Math.abs(n) >= 1000 ? Math.round(n).toLocaleString('en-US') : String(Math.round(n * 100) / 100);
    return s + (unit === '%' ? '%' : '');
  }

  // chart({type:'bar'|'range', title, series:[{label, value}|{label, lo, hi}], unit, highlight})
  //   Horizontal marks, direct labels at the data end, no legend (one series per
  //   board, the row label is the identity), unit on the axis, hairline grid,
  //   plus a visually hidden table so the numbers are never colour-only.
  function chart(spec) {
    spec = spec || {};
    var type = spec.type === 'range' ? 'range' : 'bar';
    var unit = spec.unit || '';
    var rows = (spec.series || []).map(function (s) {
      s = s || {};
      // the parser pre-parses num/loNum/hiNum; strings are parsed here as a fallback
      var lo = type === 'range' ? (typeof s.loNum === 'number' ? s.loNum : parseNum(s.lo != null ? s.lo : s.from)) : 0;
      var hi = type === 'range' ? (typeof s.hiNum === 'number' ? s.hiNum : parseNum(s.hi != null ? s.hi : s.to))
        : (typeof s.num === 'number' ? s.num : parseNum(s.value));
      if (!unit && /%/.test(String(type === 'range' ? s.hi : s.value))) unit = '%';
      return { label: String(s.label || ''), lo: lo, hi: hi, loText: s.lo != null ? String(s.lo) : (s.from != null ? String(s.from) : ''), hiText: String(type === 'range' ? (s.hi != null ? s.hi : s.to) : s.value), ref: s.ref || '', highlight: !!s.highlight };
    }).filter(function (r) { return isFinite(r.hi); });
    var anyHighlight = rows.some(function (r) { return r.highlight; });

    var max = 0, min = 0;
    rows.forEach(function (r) { max = Math.max(max, r.hi, r.lo); min = Math.min(min, r.hi, r.lo); });
    if (unit === '%' && max <= 100 && max > 60) max = 100;
    if (max === min) max = min + 1;
    var step = niceStep(max - min);
    max = Math.ceil(max / step) * step;
    min = Math.floor(min / step) * step;

    var W = 1600, left = 420, right = 1500, top = 150, rowH = type === 'range' ? 104 : 92;
    var H = Math.min(900, top + rows.length * rowH + 110);
    var plotW = right - left;
    function sx(v) { return left + (v - min) / (max - min) * plotW; }

    var g = '';
    g += text(80, 84, spec.title || '', { 'font-size': 44, 'font-weight': 600, fill: C.ink, 'class': 'vn-chart-title' });
    // axis grid, hairline, recessive
    for (var v = min; v <= max + 1e-9; v += step) {
      var x = sx(v);
      g += line(x, top - 20, x, top + rows.length * rowH, stroke(C.ink, 1.5, v === min ? 0.4 : 0.12));
      g += text(x, top + rows.length * rowH + 40, fmt(v, unit), { 'font-size': 24, fill: C.ink2, 'text-anchor': 'middle' });
    }
    g += text(right, top + rows.length * rowH + 84, unit === '%' ? 'percent' : unit, { 'font-size': 24, fill: C.ink2, 'text-anchor': 'end', 'font-style': 'italic' });

    rows.forEach(function (r, i) {
      var cy = top + i * rowH + rowH / 2;
      var strong = !anyHighlight || r.highlight;
      g += text(left - 28, cy + 10, r.label, { 'font-size': 30, fill: C.ink, 'text-anchor': 'end' });
      if (type === 'bar') {
        var x0 = sx(Math.min(0, r.hi) < min ? min : Math.max(min, Math.min(0, r.hi))), x1 = sx(r.hi), w = Math.max(2, x1 - x0), th = 34, rr = 6;
        // square at the baseline, 4px-ish rounding at the data end
        var d = 'M' + num(x0) + ' ' + num(cy - th / 2) + ' h' + num(w - rr) + ' a' + rr + ' ' + rr + ' 0 0 1 ' + rr + ' ' + rr + ' v' + num(th - 2 * rr) + ' a' + rr + ' ' + rr + ' 0 0 1 -' + rr + ' ' + rr + ' h-' + num(w - rr) + ' Z';
        g += path(d, { fill: C.accent, opacity: strong ? 0.9 : 0.4 });
        g += text(x1 + 16, cy + 10, r.hiText, { 'font-size': 28, fill: C.ink, 'font-weight': strong ? 600 : 400 });
      } else {
        var xa = sx(r.lo), xb = sx(r.hi), rising = r.hi > r.lo;
        g += line(xa, cy, xb, cy, stroke(C.accent, 10, strong ? 0.5 : 0.25));
        g += circle(xa, cy, 14, { fill: C.bg2, stroke: C.accent, 'stroke-width': 5, opacity: strong ? 1 : 0.5 });
        g += circle(xb, cy, 14, { fill: C.accent, stroke: C.box, 'stroke-width': 4, opacity: strong ? 1 : 0.5 });
        var la = { 'font-size': 26, fill: C.ink2, 'text-anchor': rising ? 'end' : 'start' };
        var lb = { 'font-size': 28, fill: C.ink, 'font-weight': strong ? 600 : 400, 'text-anchor': rising ? 'start' : 'end' };
        g += text(xa + (rising ? -24 : 24), cy + 9, r.loText, la);
        g += text(xb + (rising ? 24 : -24), cy + 9, r.hiText, lb);
      }
    });

    var tbl = '<table class="vn-sr-only"><caption>' + esc(spec.title || '') + '</caption><thead><tr><th scope="col">Series</th>' +
      (type === 'range' ? '<th scope="col">From</th><th scope="col">To</th>' : '<th scope="col">Value</th>') +
      '<th scope="col">Source</th></tr></thead><tbody>';
    rows.forEach(function (r) {
      tbl += '<tr><th scope="row">' + esc(r.label) + '</th>' + (type === 'range' ? '<td>' + esc(r.loText) + '</td>' : '') +
        '<td>' + esc(r.hiText) + '</td><td>' + esc(r.ref) + '</td></tr>';
    });
    tbl += '</tbody></table>';

    var id = 'vnc-' + fnv1a((spec.title || '') + type + rows.length).toString(36);
    return '<figure class="vn-chart vn-board" data-type="' + type + '">' +
      svg('0 0 ' + W + ' ' + H, '<title id="' + id + '">' + esc(spec.title || '') + '</title>' + g, { role: 'img', 'aria-labelledby': id, 'aria-hidden': null, 'class': 'vn-chart-svg' }) +
      tbl + '</figure>';
  }

  // code(lang, lines) or code(op) where op = {lang, lines}
  function code(lang, lines) {
    if (lang && typeof lang === 'object') { lines = lang.lines; lang = lang.lang; }
    lines = Array.isArray(lines) ? lines : String(lines == null ? '' : lines).split(/\r?\n/);
    var body = '';
    for (var i = 0; i < lines.length; i++) {
      body += '<span class="vn-code-line"><span class="vn-code-ln" aria-hidden="true">' + (i + 1) + '</span>' + esc(lines[i]) + '</span>';
    }
    return '<div class="vn-code vn-board" role="group" aria-label="code example' + (lang ? ' in ' + esc(lang) : '') + '">' +
      '<div class="vn-code-head">' + esc(lang || 'code') + '</div>' +
      '<pre class="vn-code-body" tabindex="0"><code data-lang="' + esc(lang || '') + '">' + body + '</code></pre></div>';
  }

  // scene(title) or scene(op) where op = {title}
  function scene(title) {
    if (title && typeof title === 'object') title = title.title;
    var orn = svg('0 0 1600 900', [
      defs(gradient('vnsc-vig', [[0, C.bg2, 0], [1, C.ink, 0.35]], { radial: true, r: '75%' })),
      rect(0, 0, 1600, 900, { fill: C.bg }),
      rect(0, 0, 1600, 900, { fill: 'url(#vnsc-vig)' }),
      line(500, 330, 1100, 330, stroke(C.accent, 3, 0.8)),
      line(500, 570, 1100, 570, stroke(C.accent, 3, 0.8)),
      circle(800, 330, 7, { fill: C.accent }),
      circle(800, 570, 7, { fill: C.accent })
    ].join(''), { 'class': 'vn-scene-svg', preserveAspectRatio: 'xMidYMid slice' });
    return '<div class="vn-scene-board vn-board" role="group" aria-label="scene">' + orn +
      '<h2 class="vn-scene-title">' + inline(title || '') + '</h2></div>';
  }

  // endCard(meta, factsUsed)
  //   meta: {title, authors, cite, arxiv, links:[{url,label}|string], note, verify, kind, status, id}
  //   factsUsed: [{key, value, ref}]
  function endCard(meta, factsUsed) {
    meta = meta || {};
    var links = (meta.links || []).slice(0, 2).map(function (l, i) {
      if (typeof l === 'string') l = { url: l };
      var label = l.label || (meta.kind === 'blog' ? 'Read the post' : 'Read the paper');
      if (!l.label && i === 1) label = 'Source';
      return '<a class="vn-btn vn-link" href="' + esc(l.url) + '" target="_blank" rel="noopener">' + esc(label) + '</a>';
    }).join('');
    var facts = '';
    if (factsUsed && factsUsed.length) {
      facts = '<section class="vn-endcard-facts"><h3>Figures used</h3><dl>';
      factsUsed.forEach(function (f) {
        facts += '<div class="vn-fact"><dt>' + esc(f.key) + '</dt><dd>' + esc(f.value) + (f.ref ? ' <abbr class="vn-chip" title="quoted from the source, ' + esc(refTitle(f.ref)) + '">' + esc(f.ref) + '</abbr>' : '') + '</dd></div>';
      });
      facts += '</dl></section>';
    }
    var note = meta.note || 'Dialogue is dramatized; coauthors did not say these lines. Figures marked § are quoted from the source.';
    return '<div class="vn-endcard vn-board" role="group" aria-label="end of story">' +
      (meta.verify ? '<div class="vn-endcard-ribbon" role="note">unverified draft</div>' : '') +
      (meta.status === 'embargo' ? '<div class="vn-endcard-ribbon vn-ribbon-embargo" role="note">coming soon</div>' : '') +
      '<h2 class="vn-endcard-title">' + inline(meta.title || 'The end') + '</h2>' +
      (meta.authors ? '<p class="vn-endcard-authors">' + inline(meta.authors) + '</p>' : '') +
      (meta.cite ? '<p class="vn-endcard-cite">' + inline(meta.cite) + '</p>' : '') +
      (links ? '<div class="vn-endcard-links">' + links + '</div>' : '') +
      facts +
      '<p class="vn-endcard-note">' + inline(note) + '</p>' +
      '<div class="vn-endcard-actions">' +
      (meta.arxiv ? '<button type="button" class="vn-btn" data-action="bibtex" data-arxiv="' + esc(meta.arxiv) + '">Copy BibTeX</button>' : '') +
      '<button type="button" class="vn-btn" data-action="replay">Replay</button>' +
      '<button type="button" class="vn-btn" data-action="stories">Other stories</button>' +
      '</div></div>';
  }

  function refTitle(ref) {
    ref = String(ref || '');
    if (/^§/.test(ref)) return 'section ' + ref.slice(1);
    if (/^p\./i.test(ref)) return 'page ' + ref.slice(2);
    if (/^¶/.test(ref)) return 'paragraph ' + ref.slice(1);
    if (/^para/i.test(ref)) return 'paraphrase';
    return ref;
  }

  // BibTeX from the header fields (client-side helper for the Copy button).
  function bibtex(meta) {
    meta = meta || {};
    var year = (String(meta.cite || '').match(/\((\d{4})\)/) || [])[1] || (meta.arxiv ? '20' + String(meta.arxiv).slice(0, 2) : '');
    var first = String(meta.authors || '').replace(/†/g, '').split(/,|\band\b/)[0].trim().split(/\s+/).pop() || 'le';
    var key = (first + year + String(meta.title || '').split(/\s+/)[0]).toLowerCase().replace(/[^a-z0-9]/g, '');
    var out = ['@misc{' + key + ','];
    if (meta.title) out.push('  title = {' + meta.title + '},');
    if (meta.authors) out.push('  author = {' + String(meta.authors).replace(/†/g, '').replace(/\(co-first\)/g, '').replace(/,/g, ' and') + '},');
    if (year) out.push('  year = {' + year + '},');
    if (meta.arxiv) { out.push('  eprint = {' + meta.arxiv + '},'); out.push('  archivePrefix = {arXiv},'); }
    out.push('}');
    return out.join('\n');
  }

  /* ------------------------------------------------------- cast grid */

  function defaultCast() {
    var decls = [];
    for (var i = 0; i < HAIR.length; i++) {
      decls.push({ name: 'Hair-' + HAIR[i], hair: HAIR[i], skin: 1 + (i % 5), hue: i * 55, glasses: i % 2 === 0, hat: i === 1 || i === 4 });
    }
    for (var s = 1; s <= 5; s++) decls.push({ name: 'Skin-' + s, skin: s, hair: 'short', hue: 200 + s * 20 });
    decls.push({ name: 'Model', lattice: 'sparse', hue: 192 });
    decls.push({ name: 'Obfuscator', lattice: 'dense', hue: 330 });
    decls.push({ name: 'You', player: true, hue: 20 });
    decls.push({ name: 'Schiller', page: true, hue: 40 });
    return decls;
  }

  // Every declaration x every face, for ?cast=1.
  function castGrid(decls) {
    decls = decls && decls.length ? decls : defaultCast();
    var out = '<div class="vn-cast-grid">';
    decls.forEach(function (d) {
      var c = normCast(d);
      out += '<section class="vn-cast-row"><h3>' + esc(c.display) + ' <small>' + esc(c.lattice ? 'lattice ' + c.lattice : c.player ? 'player' : c.page ? 'page' : c.hair + (c.glasses ? ' glasses' : '') + (c.hat ? ' hat' : '') + ' skin ' + c.skin) + ' hue ' + c.hue + '</small></h3><div class="vn-cast-faces">';
      var faces = (c.player || c.page) ? ['neutral'] : FACES;
      faces.forEach(function (f) {
        out += '<figure><div class="vn-slot">' + sprite(c, f) + '</div><figcaption>' + f + '</figcaption></figure>';
      });
      out += '</div></section>';
    });
    return out + '</div>';
  }

  /* ---------------------------------------------------------- base CSS */

  // Minimal styles for the HTML boards, keyed to the class names above.
  // vn.css owns the real look; this keeps boards legible when loaded alone.
  var baseCSS = [
    '.vn-sr-only{position:absolute!important;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}',
    '.vn-board{box-sizing:border-box;font-family:' + FONT + ';color:var(--vn-ink,#1e2430);background:var(--vn-box,#fffdf8);border:1px solid var(--vn-ink-2,#5a6170);border-radius:12px;padding:1.4em 1.6em;max-width:100%}',
    '.vn-card-title,.vn-scene-title,.vn-endcard-title{margin:0 0 .6em;font-size:1.4em;font-weight:600;letter-spacing:.01em}',
    '.vn-card-cells{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fit,minmax(10em,1fr));gap:.6em 1.2em}',
    '.vn-cell{border-left:3px solid var(--vn-accent,#3b6ea5);padding-left:.6em}',
    '.vn-cell-label{display:block;font-size:.8em;color:var(--vn-ink-2,#5a6170);text-transform:uppercase;letter-spacing:.06em}',
    '.vn-cell-value{display:block;font-size:1.05em}',
    '.vn-chart{margin:0;padding:1em}.vn-chart-svg{display:block;width:100%;height:auto}',
    '.vn-code{padding:0;overflow:hidden}.vn-code-head{font-family:' + MONO + ';font-size:.8em;padding:.5em 1em;background:var(--vn-bg-2,#e2ddd0);color:var(--vn-ink-2,#5a6170)}',
    '.vn-code-body{margin:0;padding:1em 1.2em;font-family:' + MONO + ';font-size:.95em;line-height:1.5;overflow:auto;tab-size:4}',
    '.vn-code-line{display:block;white-space:pre}.vn-code-ln{display:inline-block;width:2.4em;color:var(--vn-ink-2,#5a6170);opacity:.7;user-select:none;text-align:right;padding-right:1em}',
    '.vn-scene-board{position:relative;padding:0;border:0;background:transparent;aspect-ratio:16/9;display:grid;place-items:center;overflow:hidden}',
    '.vn-scene-svg{position:absolute;inset:0;width:100%;height:100%}.vn-scene-title{position:relative;font-size:2.4em;text-align:center;margin:0;padding:0 1em}',
    '.vn-endcard{position:relative;overflow:hidden}.vn-endcard-authors{color:var(--vn-ink-2,#5a6170);margin:0 0 .6em}.vn-endcard-cite{font-size:.9em;margin:0 0 1em}',
    '.vn-endcard-facts h3{font-size:.8em;text-transform:uppercase;letter-spacing:.06em;color:var(--vn-ink-2,#5a6170);margin:1em 0 .4em}',
    '.vn-endcard-facts dl{margin:0;display:grid;grid-template-columns:repeat(auto-fit,minmax(14em,1fr));gap:.3em 1em;font-size:.9em}.vn-fact{display:flex;gap:.6em}.vn-fact dt{color:var(--vn-ink-2,#5a6170)}.vn-fact dd{margin:0}',
    '.vn-chip{font-family:' + MONO + ';font-size:.75em;color:var(--vn-accent,#3b6ea5);text-decoration:none;border-bottom:1px dotted currentColor}',
    '.vn-endcard-note{font-size:.85em;color:var(--vn-ink-2,#5a6170);font-style:italic}',
    '.vn-endcard-links,.vn-endcard-actions{display:flex;flex-wrap:wrap;gap:.6em;margin:.8em 0 0}',
    '.vn-btn{font:inherit;min-height:44px;padding:.5em 1.1em;border-radius:999px;border:1px solid var(--vn-accent,#3b6ea5);background:transparent;color:var(--vn-ink,#1e2430);cursor:pointer;text-decoration:none;display:inline-flex;align-items:center}',
    '.vn-btn:hover,.vn-btn:focus-visible{background:var(--vn-accent,#3b6ea5);color:var(--vn-bg,#f4f1ea);outline:none}',
    '.vn-endcard-ribbon{position:absolute;top:1.2em;right:-3em;transform:rotate(35deg);background:var(--vn-accent,#3b6ea5);color:var(--vn-bg,#f4f1ea);padding:.3em 3.5em;font-size:.75em;letter-spacing:.1em;text-transform:uppercase}',
    '.vn-cast-grid{font-family:' + FONT + ';color:var(--vn-ink,#1e2430)}.vn-cast-row h3{font-weight:600;margin:1.2em 0 .4em}.vn-cast-row small{font-weight:400;color:var(--vn-ink-2,#5a6170)}',
    '.vn-cast-faces{display:flex;flex-wrap:wrap;gap:.6em}.vn-cast-faces figure{margin:0;text-align:center;font-size:.75em}.vn-cast-faces .vn-slot{width:120px;height:180px;background:var(--vn-bg-2,#e2ddd0);border-radius:8px}.vn-cast-faces svg{width:100%;height:100%}',
    '@media (prefers-reduced-motion:reduce){.vn-face{transition:none!important}}'
  ].join('\n');

  return {
    // primitives
    rect: rect, circle: circle, path: path, text: text, gradient: gradient, group: group,
    svg: svg, defs: defs, esc: esc,
    // seeds
    hash: fnv1a, rng: mulberry32,
    // palettes
    palette: palette, PALETTES: PALETTES,
    // scenery and cast
    background: background, BACKGROUNDS: BG_NAMES, MODIFIERS: MODIFIERS,
    sprite: sprite, lattice: lattice, player: player, page: page, normCast: normCast,
    FACES: FACES, HAIR: HAIR, sharedDefs: sharedDefs,
    // boards
    card: card, chart: chart, code: code, scene: scene, endCard: endCard, bibtex: bibtex,
    castGrid: castGrid,
    baseCSS: baseCSS,
    COLORS: C
  };
});
