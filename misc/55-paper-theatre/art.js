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
 * This file is the kit (primitives, colour maths, shared filters, palettes) and
 * the HTML boards. The painted scenery lives in art-scenes.js and the cast in
 * art-cast.js; both are installed here, so callers only use VNArt. In the
 * browser load art-scenes.js and art-cast.js BEFORE art.js.
 *
 * Scenery and sprites are painted in literal colours (each scene keeps its own
 * time of day whatever the UI theme); only the boards go through the --vn-*
 * custom properties.
 *
 * Coordinate systems
 *   backgrounds, CGs      viewBox 0 0 1600 900 (the stage)
 *   sprites               viewBox 0 0 600 1000 (knee-up figure, cut at the bottom edge)
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

  /* ------------------------------------------------------------ colour maths */

  function hex2rgb(h) {
    h = String(h).replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgb2hex(r) {
    return '#' + r.map(function (v) { v = Math.max(0, Math.min(255, Math.round(v))); return (v < 16 ? '0' : '') + v.toString(16); }).join('');
  }
  function mix(a, b, t) { var x = hex2rgb(a), y = hex2rgb(b); return rgb2hex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]); }
  function mul(a, b) { var x = hex2rgb(a), y = hex2rgb(b); return rgb2hex([x[0] * y[0] / 255, x[1] * y[1] / 255, x[2] * y[2] / 255]); }
  function hslHex(h, s, l) {
    h = ((h % 360) + 360) % 360; s = Math.max(0, Math.min(100, s)) / 100; l = Math.max(0, Math.min(100, l)) / 100;
    var c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2, r;
    r = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
    return rgb2hex([(r[0] + m) * 255, (r[1] + m) * 255, (r[2] + m) * 255]);
  }

  /* ------------------------------------------------------------ shared filters */

  // One hidden <svg> of filter definitions for the whole page. Scenery and sprites reference
  // these by id (url(#vnf-...)); the stage injects this once. vnf-rim[-dusk|-dawn|-night] light the figures.
  function sharedDefs() {
    function blur(n, m) { return '<filter id="vnf-b' + n + '" x="-' + m + '%" y="-' + m + '%" width="' + (100 + 2 * m) + '%" height="' + (100 + 2 * m) + '%"><feGaussianBlur stdDeviation="' + n + '"/></filter>'; }
    // rim light on the upper left edge, a soft contact shadow, and the hour's tint on the figure itself
    function rim(suffix, col, m) {
      return '<filter id="vnf-rim' + suffix + '" x="-12%" y="-6%" width="124%" height="112%" color-interpolation-filters="sRGB">' +
        (m ? '<feColorMatrix in="SourceGraphic" type="matrix" values="' + m[0] + ' 0 0 0 0  0 ' + m[1] + ' 0 0 0  0 0 ' + m[2] + ' 0 0  0 0 0 1 0" result="fig"/>' : '') +
        '<feGaussianBlur in="SourceAlpha" stdDeviation="12" result="sb"/><feOffset in="sb" dx="10" dy="8" result="so"/><feFlood flood-color="#080a18" flood-opacity="0.38"/><feComposite in2="so" operator="in" result="shadow"/>' +
        '<feOffset in="SourceAlpha" dx="-3" dy="-2" result="ro"/><feFlood flood-color="' + col + '" flood-opacity="0.85"/><feComposite in2="ro" operator="in" result="rim"/>' +
        '<feMerge><feMergeNode in="shadow"/><feMergeNode in="rim"/><feMergeNode in="' + (m ? 'fig' : 'SourceGraphic') + '"/></feMerge></filter>';
    }
    return '<svg class="vn-defs" width="0" height="0" aria-hidden="true" focusable="false" style="position:absolute;width:0;height:0;overflow:hidden"><defs>' +
      blur(2, 20) + blur(4, 25) + blur(8, 40) + blur(16, 60) + blur(30, 100) + blur(40, 100) +
      '<filter id="vnf-glow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>' +
      '<filter id="vnf-paint" x="-10%" y="-10%" width="120%" height="120%"><feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="3" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="16" xChannelSelector="R" yChannelSelector="G"/></filter>' +
      '<filter id="vnf-cloud" x="-10%" y="-20%" width="120%" height="140%"><feTurbulence type="fractalNoise" baseFrequency="0.012" numOctaves="3" seed="7" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="46" xChannelSelector="R" yChannelSelector="G" result="d"/><feGaussianBlur in="d" stdDeviation="5"/></filter>' +
      rim('', '#fff3d8', null) + rim('-dusk', '#ffbe78', [1.0, 0.86, 0.78]) + rim('-dawn', '#ffd9cc', [0.98, 0.92, 0.95]) + rim('-night', '#a8bfff', [0.74, 0.79, 0.98]) +
      '</defs></svg>';
  }

  /* ------------------------------------------------------------ scenery and cast (plugins) */

  var KIT = {
    rect: rect, circle: circle, path: path, text: text, gradient: gradient, group: group, svg: svg, defs: defs, esc: esc,
    num: num, attrs: attrs, merge: merge, rngFor: rngFor, hash: fnv1a, mix: mix, mul: mul, hslHex: hslHex
  };
  var NODE = typeof module === 'object' && module.exports;
  var G0 = typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : {});
  var installScenes = NODE ? require('./art-scenes.js') : G0.VNArtScenes;
  var installCast = NODE ? require('./art-cast.js') : G0.VNArtCast;
  var SC = installScenes ? installScenes(KIT) : null;
  var CA = installCast ? installCast(KIT) : null;
  var BG_NAMES = SC ? SC.BACKGROUNDS : [], MODIFIERS = SC ? SC.MODIFIERS : [];
  var FACES = CA ? CA.FACES : [], HAIR = CA ? CA.HAIR : [];
  function background(name, modifier, opts) { return SC.background(name, modifier, opts); }
  function sprite(decl, face) { return CA.sprite(decl, face); }
  function lattice(decl, face, opts) { return CA.lattice(decl, face, opts); }
  function player(decl) { return CA.player(decl); }
  function page(decl) { return CA.page(decl); }
  function normCast(decl) { return CA.normCast(decl); }

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
      decls.push({ name: 'Hair-' + HAIR[i], hair: HAIR[i], skin: 1 + (i % 5), hue: i * 55, clothes: CA.CLOTHES[i % CA.CLOTHES.length], glasses: i % 3 === 0, hat: i === 1 });
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
    background: background, BACKGROUNDS: BG_NAMES, MODIFIERS: MODIFIERS, timeOf: SC ? SC.timeOf : null, TOD: SC ? SC.TOD : null,
    cg: SC ? SC.cg : null, CGS: SC ? SC.CGS : [], fx: SC ? SC.fx : null, FX: SC ? SC.FX : [],
    sprite: sprite, lattice: lattice, player: player, page: page, normCast: normCast,
    FACES: FACES, HAIR: HAIR, CLOTHES: CA ? CA.CLOTHES : [], sharedDefs: sharedDefs,
    mix: mix, mul: mul, hslHex: hslHex,
    // boards
    card: card, chart: chart, code: code, scene: scene, endCard: endCard, bibtex: bibtex,
    castGrid: castGrid,
    baseCSS: baseCSS,
    COLORS: C
  };
});
