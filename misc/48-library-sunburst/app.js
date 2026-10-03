// Sunburst: a zoomable hierarchy view of the library, hand-rolled on SVG.
//
// The catalogue (../../assets/data/library.json) is grouped into one of four
// trees (genre › type › author › book, bookcase › shelf › book, language ›
// genre › author › book, century › decade › genre › book). A partition layout
// gives every node an angular span [x0, x1] proportional to its book count;
// the same tree can be drawn as a sunburst (arcs), a squarified treemap
// (rects) or an icicle (rows). Zooming interpolates the geometry over ~600 ms;
// switching layout morphs arcs into rects point by point.

(function () {
  'use strict';

  var TAU = Math.PI * 2;
  var $ = function (id) { return document.getElementById(id); };
  var params = new URLSearchParams(location.search);
  var THUMB = params.get('thumb') === '1';
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var DUR = (reduced || THUMB) ? 0 : 600 * (parseFloat(params.get('slow')) || 1);
  var FREEZE = params.has('freeze') ? clamp(parseFloat(params.get('freeze')) || 0, 0, 1) : null; // debug: hold a transition at t
  var DATA_URL = '../../assets/data/library.json';
  var BG = '#0f1218';
  var FONT = '-apple-system, "Segoe UI", Helvetica, Arial, "Hiragino Sans", "Yu Gothic", "Noto Sans CJK JP", sans-serif';

  // ---- Physical layout and colours (copied from the site's bookshelf) --------

  var UNITS = [
    { k: 'K', name: 'Pine library', desc: 'Three pine folding bookcases. Alphabetical by title, with every "The" filed after S, the fifty-one Harvard Classics stacked beneath, and two shelves of Japanese books to the side.',
      shelves: ['A to D', 'D to I', 'H to L', 'M to O', 'O to S', 'S / The A-E', 'The F-O', 'The P-T', 'T-W', 'HC 1-16', 'HC 17-34', 'HC 35-51', 'JP-1 (Jump, Mill)', 'JP-2 (Ranpo, Witchcraft)', 'Top (VN boxes)'] },
    { k: 'H', name: 'Black bookcase', desc: 'Six shelves: the canon read for school, a writing-craft and screenwriting library, dictionaries, and old test prep.', shelves: ['H1', 'H2', 'H3', 'H4', 'H5', 'H6'] },
    { k: 'N', name: 'Manga case', desc: 'The manga library: 1970s and 80s shōjo and seinen in bunko, seinen runs, visual novels and CDs, plus an Italian shelf.', shelves: ['N-Top (VN boxes, CDs)', 'N1 (Uffizi)', 'N2 (Berlitz, Catan)', 'N3 (鈴木由美子)', 'N4 (バガボンド, くず)', 'N5 (手塚, 吉田秋生)'] },
    { k: 'B', name: 'Cherry bookcase', desc: 'Dark cherry shelves with library call-number labels. Almost entirely English humanities.', shelves: ['B1', 'B2', 'B3'] },
    { k: 'G', name: 'Library-label shelves', desc: 'Overflow shelves in the same dark cherry, with a nursing stack at one end.', shelves: ['G1', 'G2'] },
    { k: 'I', name: 'Cream bookcase', desc: 'English fiction and philosophy, with a visual-novel and illustration corner.', shelves: ['I1', 'I2'] },
    { k: 'L', name: 'Nursing case', desc: 'Drug guides, pathophysiology and review modules, with a Japanese manga shelf on top.', shelves: ['L0 (above sticky 16)', 'L1 (sticky 16)'] },
    { k: 'M', name: 'Japanese literature shelf', desc: 'Sōseki, Dazai, Mishima, Akutagawa and Murakami in the original, mostly bunko.', shelves: ['JP floor shelf'] },
    { k: 'A', name: 'Light-wood unit', desc: 'Two mixed shelves by the calligraphy wall.', shelves: ['A1', 'A2'] },
    { k: 'D', name: 'Wire shelf', desc: 'Japanese bunko and test prep.', shelves: ['D1', 'D2'] },
    { k: 'F', name: 'Headset shelf', desc: 'Manga and art catalogues, next to the VR headset.', shelves: ['F1'] },
    { k: 'J', name: 'Cubby', desc: 'A box of self-help paperbacks.', shelves: ['Cubby'] },
    { k: 'Loose', name: 'Desk and floor', desc: 'Whatever was out being read when the photos were taken.', shelves: [{ keys: ['Floor', 'Held (photo 73)', 'Held (photo 96)'], label: 'Loose' }] },
  ];
  var GENRE_HUE = {
    'Literature (English & European)': 214, 'Japanese literature': 354, 'Manga & comics': 322, 'Light novels': 282,
    'Writing, film & literary craft': 28, 'History & biography': 14, 'Philosophy & political theory': 248,
    'Religion & theology': 42, 'Society, culture & ideas': 186, 'Politics, law & current affairs': 168,
    'Psychology, self-help & business': 142, 'Art & visual culture': 76, 'Music & opera': 266,
    'Language study & reference': 104, 'Test prep & study guides': 56, 'Math, CS & engineering': 200,
    'Science': 178, 'Nursing & medical': 6, 'Magazines & catalogues': 90, 'Occult & folklore': 300,
    'Games & other objects': 0, 'Unidentified': 0,
  };
  var GREY_GENRES = { 'Games & other objects': 1, 'Unidentified': 1 };
  var LANG_NAME = { EN: 'English', JA: 'Japanese', DE: 'German', IT: 'Italian', LA: 'Latin', VI: 'Vietnamese' };

  var UNIT_INDEX = {}, UNIT_BY_KEY = {};
  UNITS.forEach(function (u, i) {
    UNIT_INDEX[u.k] = i; UNIT_BY_KEY[u.k] = u; u.shelfIndex = {};
    u.shelves.forEach(function (s, j) {
      if (typeof s === 'string') u.shelfIndex[s] = j; else s.keys.forEach(function (k) { u.shelfIndex[k] = j; });
    });
  });
  function unitName(k) { return UNIT_BY_KEY[k] ? UNIT_BY_KEY[k].name : k; }
  function shelfIdx(b) { var u = UNIT_BY_KEY[b.u]; var j = u ? u.shelfIndex[b.s] : null; return j == null ? 99 : j; }
  function shelfLabel(b) {
    var u = UNIT_BY_KEY[b.u]; if (!u) return b.s;
    var j = u.shelfIndex[b.s]; if (j == null) return b.s;
    var s = u.shelves[j]; return typeof s === 'string' ? s : s.label;
  }
  function shelfOrder(b) { var ui = UNIT_INDEX[b.u]; return (ui == null ? 99 : ui) * 1e6 + shelfIdx(b) * 1e3 + (b.p || 0); }
  function langName(code) {
    if (!code || code === '?') return 'Unknown language';
    return code.split('/').map(function (c) { return LANG_NAME[c] || c; }).join(' / ');
  }
  function ordinal(n) { var s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
  function fmt(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function pct(n, d) { var p = 100 * n / d; return (p >= 10 ? Math.round(p) : p >= 1 ? p.toFixed(1) : p.toFixed(2)) + '%'; }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function ease(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
  function isCJK(s) { return /[　-ヿ㐀-鿿豈-﫿＀-￯]/.test(s || ''); }
  function cmpName(a, b) {
    var ca = isCJK(a), cb = isCJK(b);
    if (ca !== cb) return ca ? 1 : -1;
    return a.localeCompare(b, ca ? 'ja' : 'en', { sensitivity: 'base' });
  }
  function cmpCount(a, b) { return b.value - a.value || cmpName(a.name, b.name); }
  function cmpOrder(a, b) { return a.order - b.order || cmpName(a.name, b.name); }
  function fold(s) { return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function yearText(b) { return b.y == null ? '' : (b.y < 0 ? (-b.y) + ' BC' : String(b.y)); }
  function centuryOf(y) { return y > 0 ? Math.floor((y - 1) / 100) + 1 : Math.floor((-y - 1) / 100) + 1; }
  function centuryKey(y) { return y == null ? 'Undated' : y > 0 ? 'c' + centuryOf(y) : 'b' + centuryOf(y); }
  function centuryLabel(y) { return y == null ? 'Undated' : ordinal(centuryOf(y)) + ' century' + (y > 0 ? '' : ' BC'); }
  function decadeKey(y) { return y == null ? 'Undated' : y > 0 ? 'd' + Math.floor(y / 10) : 'e' + Math.floor(-y / 10); }
  function decadeLabel(y) { return y == null ? 'Undated' : y > 0 ? Math.floor(y / 10) * 10 + 's' : Math.floor(-y / 10) * 10 + 's BC'; }
  function centuryOrder(y) { return y == null ? 1e9 : y > 0 ? centuryOf(y) : -centuryOf(y); }

  // ---- Hierarchy ---------------------------------------------------------------

  var LEVELS = {
    genre: { name: 'Genre', key: function (b) { return b.g || 'Unidentified'; }, cmp: cmpCount },
    type: { name: 'Type', key: function (b) { return (b.ty && b.ty !== '?') ? b.ty : 'Unknown type'; }, cmp: cmpCount },
    author: { name: 'Author', key: function (b) { return b.a || 'No author listed'; }, cmp: cmpCount },
    unit: { name: 'Bookcase', key: function (b) { return b.u; }, label: function (k) { return unitName(k); }, order: function (b) { var i = UNIT_INDEX[b.u]; return i == null ? 99 : i; }, cmp: cmpOrder },
    shelf: { name: 'Shelf', key: function (b) { return shelfLabel(b); }, order: function (b) { return shelfIdx(b); }, cmp: cmpOrder },
    lang: { name: 'Language', key: function (b) { return langName(b.l); }, cmp: cmpCount },
    century: { name: 'Century', key: function (b) { return centuryKey(b.y); }, label: function (k, b) { return centuryLabel(b.y); }, order: function (b) { return centuryOrder(b.y); }, cmp: cmpOrder },
    decade: { name: 'Decade', key: function (b) { return decadeKey(b.y); }, label: function (k, b) { return decadeLabel(b.y); }, order: function (b) { return b.y == null ? 1e9 : b.y; }, cmp: cmpOrder },
  };
  var PRESETS = {
    genre: { levels: ['genre', 'type', 'author'], leafSort: 'year' },
    shelf: { levels: ['unit', 'shelf'], leafSort: 'shelf' },
    lang: { levels: ['lang', 'genre', 'author'], leafSort: 'year' },
    era: { levels: ['century', 'decade', 'genre'], leafSort: 'year' },
  };

  function buildTree(bookList, preset) {
    var spec = PRESETS[preset];
    var root = { name: 'Library', level: 'Library', depth: 0, parent: null, children: [] };
    function leafCmp(a, b) {
      if (spec.leafSort === 'year') {
        var ya = a.book.y == null ? 1e9 : a.book.y, yb = b.book.y == null ? 1e9 : b.book.y;
        if (ya !== yb) return ya - yb;
      }
      return shelfOrder(a.book) - shelfOrder(b.book);
    }
    function grow(node, list, li) {
      if (li >= spec.levels.length) {
        node.children = list.map(function (b) { return { name: b.t, level: 'Book', parent: node, book: b, value: 1 }; });
        node.children.sort(leafCmp);
        return;
      }
      var L = LEVELS[spec.levels[li]], groups = {}, arr = [];
      list.forEach(function (b) {
        var k = L.key(b), g = groups[k];
        if (!g) {
          g = groups[k] = { name: L.label ? L.label(k, b) : k, level: L.name, parent: node, books: [], order: L.order ? L.order(b) : 0 };
          arr.push(g);
        }
        g.books.push(b);
      });
      arr.forEach(function (g) { g.value = g.books.length; });
      arr.sort(L.cmp);
      node.children = arr;
      arr.forEach(function (g) { grow(g, g.books, li + 1); delete g.books; });
    }
    grow(root, bookList, 0);
    // Lift a lone child that repeats its parent's name (Undated › Undated).
    (function collapse(n) {
      if (!n.children) return;
      while (n.children.length === 1 && n.children[0].children && n.children[0].name === n.name) {
        n.children = n.children[0].children;
        n.children.forEach(function (c) { c.parent = n; });
      }
      n.children.forEach(collapse);
    })(root);
    // Depth, value, height, dominant genre, DFS index, partition.
    var list = [];
    (function finish(n, depth) {
      n.depth = depth; n.i = list.length; list.push(n);
      if (!n.children) { n.value = 1; n.h = 0; n.genre = n.book.g || 'Unidentified'; n.leaves = 1; return; }
      var v = 0, h = 0, gc = {};
      n.children.forEach(function (c) {
        finish(c, depth + 1); v += c.value; h = Math.max(h, c.h + 1);
        var cg = c.gcount || {}; Object.keys(cg).forEach(function (g) { gc[g] = (gc[g] || 0) + cg[g]; });
        if (!c.children) gc[c.genre] = (gc[c.genre] || 0) + 1;
      });
      n.value = v; n.h = h;
      var best = null; Object.keys(gc).forEach(function (g) { if (best == null || gc[g] > gc[best]) best = g; });
      n.genre = best || 'Unidentified'; n.gcount = gc;
    })(root, 0);
    (function part(n, x0, x1) {
      n.x0 = x0; n.x1 = x1;
      if (!n.children) return;
      var x = x0, w = x1 - x0;
      n.children.forEach(function (c) { var cw = w * c.value / n.value; part(c, x, x + cw); x += cw; });
    })(root, 0, 1);
    var maxDepth = 0; list.forEach(function (n) { maxDepth = Math.max(maxDepth, n.depth); });
    list.forEach(function (n) { colourNode(n, maxDepth); });
    return { root: root, nodes: list, maxDepth: maxDepth };
  }

  function colourNode(n, maxDepth) {
    var hue = GENRE_HUE[n.genre]; if (hue == null) hue = 0;
    var grey = GREY_GENRES[n.genre];
    var t = maxDepth > 1 ? (n.depth - 1) / (maxDepth - 1) : 0;
    var l = 42 + 24 * t;
    var s = grey ? 6 : 58 - 10 * t;
    if (!n.children) l += (n.i % 2 ? 2.5 : -2.5);
    n.hsl = { h: hue, s: s, l: l };
    n.fill = 'hsl(' + hue + ' ' + s.toFixed(0) + '% ' + l.toFixed(1) + '%)';
    n.textFill = l >= 60 ? '#141414' : '#f4f2ea';
  }

  function isAncestor(a, n) { for (var p = n.parent; p; p = p.parent) if (p === a) return true; return false; }
  function ancestors(n) { var out = []; for (var p = n; p; p = p.parent) out.unshift(p); return out; }

  // ---- State ---------------------------------------------------------------------

  var books = [], TOTAL = 0;
  var tree = null, nodes = [];
  var preset = 'genre', layout = 'sunburst';
  var current = null;          // zoom node
  var selected = null;         // pinned node (leaf or current)
  var hovered = null;
  var hits = [];               // search hits (leaf nodes)
  var W = 600, H = 600, CX = 300, CY = 300, R = 290, RC = 64;
  var shapes = [], geom = [], displayed = [];
  var anim = null;
  var measureCtx = document.createElement('canvas').getContext('2d');

  var chartWrap = $('chart-wrap'), svg = $('chart'), badge = $('badge'), msg = $('msg'), tip = $('tip');
  var crumbs = $('crumbs'), panelHead = $('panel-head'), panelList = $('panel-list');
  var qInput = $('q'), results = $('results'), searchWrap = $('search-wrap');
  var gShapes, gLabels, defs;

  // ---- Geometry ----------------------------------------------------------------------

  function measureSize() {
    var w = chartWrap.clientWidth || 600;
    var narrow = window.innerWidth < 900;
    var room = Math.max(420, window.innerHeight - chartWrap.getBoundingClientRect().top - window.scrollY - 28);
    var h;
    if (layout === 'sunburst') h = Math.round(narrow ? w : Math.min(w, 760, room));
    else if (layout === 'treemap') h = Math.round(narrow ? w * 0.9 : Math.min(w * 0.68, 620, room));
    else h = Math.round(narrow ? w * 0.8 : Math.min(w * 0.6, 560, room));
    W = w; H = h; CX = W / 2; CY = H / 2;
    R = Math.min(W, H) / 2 - 4;
    RC = clamp(Math.round(R * 0.21), 34, 86);
    chartWrap.style.height = H + 'px';
    $('main').style.setProperty('--chart-h', H + 'px');
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    badge.style.width = badge.style.height = (RC * 2 - 6) + 'px';
  }

  function sunburstGeom(p) {
    var Hp = Math.max(1, p.h), ringW = (R - RC) / Hp, dx = p.x1 - p.x0, out = new Array(nodes.length);
    nodes.forEach(function (n) {
      var x0 = clamp((n.x0 - p.x0) / dx, 0, 1), x1 = clamp((n.x1 - p.x0) / dx, 0, 1);
      var y0 = n.depth - p.depth, r0, r1;
      if (y0 <= 0) { r0 = r1 = RC; } else { r0 = Math.min(R, RC + (y0 - 1) * ringW); r1 = Math.min(R, r0 + ringW); }
      var a0 = x0 * TAU, a1 = x1 * TAU;
      out[n.i] = { t: 'arc', a0: a0, a1: a1, r0: r0, r1: r1, vis: y0 >= 1 && (a1 - a0) * r1 >= 0.05 && r1 > r0 + 0.1 };
    });
    return out;
  }

  function squarify(children, rect) {
    var total = 0; children.forEach(function (c) { total += c.value; });
    var x = rect.x, y = rect.y, w = rect.w, h = rect.h;
    if (w <= 0 || h <= 0 || total <= 0) { children.forEach(function (c) { c.rect = { x: x, y: y, w: 0, h: 0 }; }); return; }
    var scale = w * h / total, i = 0;
    var items = children.map(function (c) { return { n: c, v: c.value * scale }; });
    while (i < items.length) {
      if (w <= 0.01 || h <= 0.01) { for (; i < items.length; i++) items[i].n.rect = { x: x, y: y, w: 0, h: 0 }; break; }
      var row = [], sum = 0, side = Math.min(w, h), worst = Infinity, rmax = 0, rmin = Infinity;
      while (i < items.length) {
        var v = items[i].v, nsum = sum + v, nmax = Math.max(rmax, v), nmin = Math.min(rmin, v);
        var r = Math.max(side * side * nmax / (nsum * nsum), nsum * nsum / (side * side * nmin));
        if (row.length && r > worst) break;
        row.push(items[i]); sum = nsum; worst = r; rmax = nmax; rmin = nmin; i++;
      }
      if (w >= h) {
        var cw = sum / h, cy = y;
        row.forEach(function (it) { var ch = it.v / cw; it.n.rect = { x: x, y: cy, w: cw, h: ch }; cy += ch; });
        x += cw; w -= cw;
      } else {
        var rh = sum / w, cx = x;
        row.forEach(function (it) { var cw2 = it.v / rh; it.n.rect = { x: cx, y: y, w: cw2, h: rh }; cx += cw2; });
        y += rh; h -= rh;
      }
    }
  }

  function treemapGeom(p) {
    var out = new Array(nodes.length);
    nodes.forEach(function (n) { out[n.i] = { t: 'rect', vis: false }; });
    (function lay(n, rect, rel) {
      if (n !== p) out[n.i] = { t: 'rect', x: rect.x, y: rect.y, w: rect.w, h: rect.h, vis: rect.w >= 0.4 && rect.h >= 0.4, strip: false };
      if (!n.children) return;
      var inner = rect;
      if (n !== p) {
        var strip = rel === 1 && rect.h >= 40 && rect.w >= 56;
        out[n.i].strip = strip;
        inner = { x: rect.x + 1.5, y: rect.y + 1.5 + (strip ? 15 : 0), w: rect.w - 3, h: rect.h - 3 - (strip ? 15 : 0) };
      } else {
        inner = { x: rect.x + 1, y: rect.y + 1, w: rect.w - 2, h: rect.h - 2 };
      }
      squarify(n.children, inner);
      n.children.forEach(function (c) { lay(c, c.rect, rel + 1); });
    })(p, { x: 0, y: 0, w: W, h: H }, 0);
    return out;
  }

  function icicleGeom(p) {
    var Hp = Math.max(1, p.h), rowH = H / Hp, dx = p.x1 - p.x0, out = new Array(nodes.length);
    nodes.forEach(function (n) {
      var x0 = clamp((n.x0 - p.x0) / dx, 0, 1), x1 = clamp((n.x1 - p.x0) / dx, 0, 1);
      var y0 = n.depth - p.depth;
      if (y0 <= 0) { out[n.i] = { t: 'rect', x: x0 * W, y: -rowH, w: (x1 - x0) * W, h: rowH, vis: false }; return; }
      var y = (y0 - 1) * rowH;
      out[n.i] = { t: 'rect', x: x0 * W, y: y, w: (x1 - x0) * W, h: Math.min(rowH, H - y), vis: (x1 - x0) * W >= 0.3 && y < H };
    });
    return out;
  }

  function layoutGeom(p) {
    return layout === 'sunburst' ? sunburstGeom(p) : layout === 'treemap' ? treemapGeom(p) : icicleGeom(p);
  }

  // ---- Path strings ----------------------------------------------------------------

  function f(v) { return Math.round(v * 100) / 100; }
  function arcPath(g) {
    var a0 = g.a0, a1 = g.a1, r0 = g.r0, r1 = g.r1;
    if (a1 - a0 <= 1e-6 || r1 - r0 <= 1e-6) return '';
    if (a1 - a0 >= TAU - 1e-6) {
      return 'M' + f(CX) + ',' + f(CY - r1) + 'A' + f(r1) + ',' + f(r1) + ' 0 1 1 ' + f(CX) + ',' + f(CY + r1) + 'A' + f(r1) + ',' + f(r1) + ' 0 1 1 ' + f(CX) + ',' + f(CY - r1) + 'Z' +
        (r0 > 0.01 ? 'M' + f(CX) + ',' + f(CY - r0) + 'A' + f(r0) + ',' + f(r0) + ' 0 1 0 ' + f(CX) + ',' + f(CY + r0) + 'A' + f(r0) + ',' + f(r0) + ' 0 1 0 ' + f(CX) + ',' + f(CY - r0) + 'Z' : '');
    }
    var large = a1 - a0 > Math.PI ? 1 : 0;
    var s0 = Math.sin(a0), c0 = Math.cos(a0), s1 = Math.sin(a1), c1 = Math.cos(a1);
    return 'M' + f(CX + r1 * s0) + ',' + f(CY - r1 * c0) +
      'A' + f(r1) + ',' + f(r1) + ' 0 ' + large + ' 1 ' + f(CX + r1 * s1) + ',' + f(CY - r1 * c1) +
      'L' + f(CX + r0 * s1) + ',' + f(CY - r0 * c1) +
      'A' + f(r0) + ',' + f(r0) + ' 0 ' + large + ' 0 ' + f(CX + r0 * s0) + ',' + f(CY - r0 * c0) + 'Z';
  }
  function rectPath(g) {
    if (g.w <= 0 || g.h <= 0) return '';
    return 'M' + f(g.x) + ',' + f(g.y) + 'h' + f(g.w) + 'v' + f(g.h) + 'h' + f(-g.w) + 'Z';
  }
  function pathFor(g) { return g.t === 'arc' ? arcPath(g) : rectPath(g); }

  // Polylines for morphing: K points along the outer/bottom edge, then K back along the inner/top edge.
  function polyArc(g, K) {
    var pts = [], i, a;
    for (i = 0; i < K; i++) { a = lerp(g.a0, g.a1, i / (K - 1)); pts.push(CX + g.r1 * Math.sin(a), CY - g.r1 * Math.cos(a)); }
    for (i = K - 1; i >= 0; i--) { a = lerp(g.a0, g.a1, i / (K - 1)); pts.push(CX + g.r0 * Math.sin(a), CY - g.r0 * Math.cos(a)); }
    return pts;
  }
  function polyRect(g, K) {
    var pts = [], i;
    for (i = 0; i < K; i++) pts.push(g.x + g.w * i / (K - 1), g.y + g.h);
    for (i = K - 1; i >= 0; i--) pts.push(g.x + g.w * i / (K - 1), g.y);
    return pts;
  }
  function polyPath(pts) {
    var s = 'M' + f(pts[0]) + ',' + f(pts[1]);
    for (var i = 2; i < pts.length; i += 2) s += 'L' + f(pts[i]) + ',' + f(pts[i + 1]);
    return s + 'Z';
  }

  // ---- SVG construction --------------------------------------------------------------

  function buildSvg() {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    defs = document.createElementNS(svg.namespaceURI, 'defs');
    gShapes = document.createElementNS(svg.namespaceURI, 'g');
    gShapes.setAttribute('class', 'shapes');
    gShapes.setAttribute('fill-rule', 'evenodd');
    gShapes.setAttribute('stroke', BG);
    gShapes.setAttribute('stroke-linejoin', 'round');
    gLabels = document.createElementNS(svg.namespaceURI, 'g');
    gLabels.setAttribute('class', 'labels');
    gLabels.setAttribute('font-family', FONT);
    svg.appendChild(defs); svg.appendChild(gShapes); svg.appendChild(gLabels);
    shapes = new Array(nodes.length);
    nodes.forEach(function (n) {
      if (n.depth === 0) return;
      var p = document.createElementNS(svg.namespaceURI, 'path');
      p.setAttribute('class', 'shape' + (n.children ? '' : ' leaf'));
      p.setAttribute('fill', n.fill);
      p.setAttribute('stroke-width', n.children ? '0.8' : '0.35');
      p.setAttribute('data-i', n.i);
      p.style.display = 'none';
      gShapes.appendChild(p);
      shapes[n.i] = p;
    });
  }

  function applyGeom(g) {
    geom = g; displayed = g.slice();
    nodes.forEach(function (n) {
      var el = shapes[n.i]; if (!el) return;
      var gg = g[n.i];
      if (!gg || !gg.vis) { el.style.display = 'none'; return; }
      el.style.display = ''; el.style.opacity = '';
      el.setAttribute('d', pathFor(gg));
    });
    drawLabels();
  }

  // ---- Labels ----------------------------------------------------------------------------

  function textWidth(s, size) { measureCtx.font = size + 'px ' + FONT; return measureCtx.measureText(s).width; }
  function fitText(s, size, avail) {
    if (avail < size * 1.2) return null;
    if (textWidth(s, size) <= avail) return s;
    var lo = 1, hi = s.length;
    while (lo < hi) { var mid = (lo + hi + 1) >> 1; if (textWidth(s.slice(0, mid) + '…', size) <= avail) lo = mid; else hi = mid - 1; }
    if (lo < 6) return null;
    return s.slice(0, lo).replace(/\s+$/, '') + '…';
  }

  function drawLabels() {
    while (gLabels.firstChild) gLabels.removeChild(gLabels.firstChild);
    while (defs.firstChild) defs.removeChild(defs.firstChild);
    var count = 0;
    nodes.forEach(function (n) {
      if (n.depth === 0 || count > 400) return;
      var g = geom[n.i]; if (!g || !g.vis) return;
      var size = n.children ? 12 : 11, text = null, el;
      if (g.t === 'arc') {
        var ringW = g.r1 - g.r0; if (ringW < size + 4) return;
        var rmid = (g.r0 + g.r1) / 2, span = g.a1 - g.a0, len = span * rmid;
        var full = span >= TAU - 1e-6;
        text = fitText(n.name, size, full ? len * 0.6 : len - 8); if (!text) return;
        var amid = (g.a0 + g.a1) / 2 % TAU, bottom = !full && amid > Math.PI / 2 && amid < Math.PI * 1.5;
        var rl = bottom ? rmid + size * 0.35 : rmid - size * 0.35;
        var a0 = g.a0, a1 = g.a1;
        if (full) { a0 = -Math.PI * 0.5; a1 = Math.PI * 0.5; }
        var lp = document.createElementNS(svg.namespaceURI, 'path');
        lp.setAttribute('id', 'lp' + n.i);
        var s0 = Math.sin(a0), c0 = Math.cos(a0), s1 = Math.sin(a1), c1 = Math.cos(a1), large = a1 - a0 > Math.PI ? 1 : 0;
        lp.setAttribute('d', bottom
          ? 'M' + f(CX + rl * s1) + ',' + f(CY - rl * c1) + 'A' + f(rl) + ',' + f(rl) + ' 0 ' + large + ' 0 ' + f(CX + rl * s0) + ',' + f(CY - rl * c0)
          : 'M' + f(CX + rl * s0) + ',' + f(CY - rl * c0) + 'A' + f(rl) + ',' + f(rl) + ' 0 ' + large + ' 1 ' + f(CX + rl * s1) + ',' + f(CY - rl * c1));
        defs.appendChild(lp);
        el = document.createElementNS(svg.namespaceURI, 'text');
        var tp = document.createElementNS(svg.namespaceURI, 'textPath');
        tp.setAttribute('href', '#lp' + n.i);
        tp.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', '#lp' + n.i);
        tp.setAttribute('startOffset', '50%');
        tp.setAttribute('text-anchor', 'middle');
        tp.textContent = text;
        el.appendChild(tp);
      } else {
        if (layout === 'treemap' && n.children && !g.strip) return;
        var avail = g.w - 8;
        if (g.strip) { if (g.h < 16) return; }
        else if (g.h < size + 4) return;
        text = fitText(n.name, size, avail); if (!text) return;
        el = document.createElementNS(svg.namespaceURI, 'text');
        if (g.strip) { el.setAttribute('x', f(g.x + 5)); el.setAttribute('y', f(g.y + 12)); }
        else if (layout === 'icicle' || !n.children) { el.setAttribute('x', f(g.x + g.w / 2)); el.setAttribute('y', f(g.y + g.h / 2 + size * 0.36)); el.setAttribute('text-anchor', 'middle'); }
        else { el.setAttribute('x', f(g.x + 5)); el.setAttribute('y', f(g.y + 12)); }
        el.textContent = text;
      }
      el.setAttribute('class', 'label');
      el.setAttribute('font-size', size);
      el.setAttribute('fill', n.textFill);
      el.setAttribute('data-i', n.i);
      if (n.children && g.t === 'arc') el.setAttribute('font-weight', '600');
      gLabels.appendChild(el);
      count++;
    });
    if (hovered) lightUp(hovered);
  }

  // ---- Transitions -----------------------------------------------------------------------

  function hasCoords(g) { return g && (g.t === 'arc' ? g.r1 != null : g.w != null); }

  function transitionTo(target, done) {
    if (anim) { cancelAnimationFrame(anim.raf); anim = null; }
    if (DUR === 0) { applyGeom(target); if (done) done(); return; }
    var from = displayed, items = [];
    nodes.forEach(function (n) {
      var el = shapes[n.i]; if (!el) return;
      var g0 = from[n.i], g1 = target[n.i];
      var v0 = !!(g0 && g0.vis), v1 = !!(g1 && g1.vis);
      if (!v0 && !v1) { el.style.display = 'none'; return; }
      if (!hasCoords(g0)) g0 = g1;
      if (!hasCoords(g1)) g1 = g0;
      var it = { el: el, g0: g0, g1: g1, fade: v0 && v1 ? 0 : (v1 ? 1 : -1), i: n.i };
      if (g0.t !== g1.t) {
        var arcG = g0.t === 'arc' ? g0 : g1;
        var K = clamp(Math.ceil((arcG.a1 - arcG.a0) * arcG.r1 / 7), 2, 72);
        it.p0 = g0.t === 'arc' ? polyArc(g0, K) : polyRect(g0, K);
        it.p1 = g1.t === 'arc' ? polyArc(g1, K) : polyRect(g1, K);
      }
      el.style.display = '';
      items.push(it);
    });
    gLabels.classList.add('off');
    var t0 = performance.now();
    var state = { raf: 0 };
    anim = state;
    function frame(now) {
      var t = FREEZE != null ? FREEZE : Math.min(1, (now - t0) / DUR), e = ease(t), cur = new Array(nodes.length);
      items.forEach(function (it) {
        var d, g;
        if (it.p0) {
          var pts = new Array(it.p0.length);
          for (var k = 0; k < pts.length; k++) pts[k] = lerp(it.p0[k], it.p1[k], e);
          d = polyPath(pts);
          g = e < 0.5 ? it.g0 : it.g1;
        } else if (it.g0.t === 'arc') {
          g = { t: 'arc', a0: lerp(it.g0.a0, it.g1.a0, e), a1: lerp(it.g0.a1, it.g1.a1, e), r0: lerp(it.g0.r0, it.g1.r0, e), r1: lerp(it.g0.r1, it.g1.r1, e), vis: true };
          d = arcPath(g);
        } else {
          g = { t: 'rect', x: lerp(it.g0.x, it.g1.x, e), y: lerp(it.g0.y, it.g1.y, e), w: lerp(it.g0.w, it.g1.w, e), h: lerp(it.g0.h, it.g1.h, e), vis: true };
          d = rectPath(g);
        }
        it.el.setAttribute('d', d);
        if (it.fade) it.el.style.opacity = it.fade > 0 ? e : 1 - e;
        cur[it.i] = g;
      });
      displayed = cur;
      if (FREEZE != null) return;
      if (t < 1) { state.raf = requestAnimationFrame(frame); return; }
      anim = null;
      applyGeom(target);
      gLabels.classList.remove('off');
      if (done) done();
    }
    state.raf = requestAnimationFrame(frame);
  }

  // ---- Zoom, hover, selection ------------------------------------------------------------

  function zoomTo(n) {
    if (!n || !n.children) return;
    if (n === current) return;
    current = n; selected = n;
    renderCrumbs(); renderBadge();
    transitionTo(layoutGeom(current));
    renderPanel(hovered || selected);
    markSelected();
    writeUrl();
  }
  function nodeByPath(path) {
    var n = tree.root;
    path.split('|').forEach(function (name) {
      if (!n || !n.children) { n = null; return; }
      var hit = null; n.children.forEach(function (c) { if (c.name === name) hit = c; });
      n = hit;
    });
    return n && n.children ? n : null;
  }
  function zoomUp() { if (current && current.parent) zoomTo(current.parent); }

  function selectLeaf(n) {
    selected = n;
    markSelected();
    renderPanel(n);
  }

  function markSelected() {
    var old = gShapes.querySelector('.shape.sel'); if (old) old.classList.remove('sel');
    if (selected && !selected.children && shapes[selected.i]) shapes[selected.i].classList.add('sel');
  }

  function lightUp(n) {
    svg.classList.add('hover');
    var lit = {};
    for (var p = n; p; p = p.parent) lit[p.i] = 1;
    (function mark(m) { lit[m.i] = 1; if (m.children) m.children.forEach(mark); })(n);
    var all = gShapes.children;
    for (var i = 0; i < all.length; i++) { var el = all[i]; el.classList.toggle('lit', !!lit[el.getAttribute('data-i')]); }
    var labs = gLabels.children;
    for (var j = 0; j < labs.length; j++) { var l = labs[j]; l.classList.toggle('lit', !!lit[l.getAttribute('data-i')]); }
  }
  function lightDown() {
    svg.classList.remove('hover');
    var lit = gShapes.querySelectorAll('.lit'); for (var i = 0; i < lit.length; i++) lit[i].classList.remove('lit');
    var ll = gLabels.querySelectorAll('.lit'); for (var j = 0; j < ll.length; j++) ll[j].classList.remove('lit');
  }

  var panelTimer = 0;
  function setHover(n, ev) {
    if (n === hovered) { if (ev) moveTip(ev); return; }
    hovered = n;
    if (n) { lightUp(n); showTip(n, ev); } else { lightDown(); hideTip(); }
    clearTimeout(panelTimer);
    panelTimer = setTimeout(function () { renderPanel(hovered || selected || current); }, n ? 60 : 120);
  }

  function nodeFromEvent(ev) {
    var el = ev.target; if (!el || !el.getAttribute) return null;
    var i = el.getAttribute('data-i'); if (i == null) return null;
    return nodes[+i] || null;
  }

  svg.addEventListener('mousemove', function (ev) { setHover(nodeFromEvent(ev), ev); });
  svg.addEventListener('mouseleave', function () { setHover(null); });
  svg.addEventListener('click', function (ev) {
    var n = nodeFromEvent(ev); if (!n) return;
    if (n.children) { zoomTo(n); hideTip(); }
    else { selectLeaf(n); if (ev.pointerType === 'touch' || !hovered) showTip(n, ev); }
  });
  svg.addEventListener('touchstart', function () { hideTip(); }, { passive: true });
  badge.addEventListener('click', function () { zoomUp(); });
  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape') {
      if (results.classList.contains('show')) { closeResults(); return; }
      if (document.activeElement === qInput) { qInput.blur(); return; }
      zoomUp();
    }
  });

  // ---- Tooltip ------------------------------------------------------------------------------

  function tipHtml(n) {
    var sw = '<span class="sw" style="background:' + n.fill + '"></span>';
    if (!n.children) {
      var b = n.book, bits = [];
      if (b.a) bits.push(esc(b.a));
      if (yearText(b)) bits.push(yearText(b));
      bits.push(esc(unitName(b.u)) + ' · ' + esc(shelfLabel(b)) + ' #' + b.p);
      return sw + '<b>' + esc(b.t) + '</b><br><span class="m">' + bits.join(' · ') + '</span>';
    }
    return sw + '<b>' + esc(n.name) + '</b><br><span class="m">' + esc(n.level) + ' · ' + fmt(n.value) + (n.value === 1 ? ' book' : ' books') + ' · ' + pct(n.value, TOTAL) + ' of the library' + (n.h > 0 && n.depth > 0 ? ' · ' + n.children.length + ' ' + n.children[0].level.toLowerCase() + (n.children.length === 1 ? '' : 's') : '') + '</span>';
  }
  function showTip(n, ev) { tip.innerHTML = tipHtml(n); tip.classList.add('show'); if (ev) moveTip(ev); }
  function moveTip(ev) {
    var x = ev.clientX + 14, y = ev.clientY + 16, r = tip.getBoundingClientRect();
    if (x + r.width > window.innerWidth - 8) x = ev.clientX - r.width - 10;
    if (y + r.height > window.innerHeight - 8) y = ev.clientY - r.height - 10;
    tip.style.left = Math.max(4, x) + 'px'; tip.style.top = Math.max(4, y) + 'px';
  }
  function hideTip() { tip.classList.remove('show'); }

  // ---- Breadcrumb, badge, panel ----------------------------------------------------------

  function renderCrumbs() {
    crumbs.innerHTML = '';
    var chain = ancestors(current);
    chain.forEach(function (n, i) {
      if (i) { var s = document.createElement('span'); s.className = 'sep'; s.textContent = '›'; crumbs.appendChild(s); }
      var b = document.createElement('button');
      b.className = 'c' + (n === current ? ' cur' : ''); b.textContent = n.name; b.title = n.name;
      if (n !== current) b.addEventListener('click', function () { zoomTo(n); });
      crumbs.appendChild(b);
    });
    var sp = document.createElement('span'); sp.className = 'spacer'; crumbs.appendChild(sp);
    var st = document.createElement('span'); st.id = 'stat';
    st.innerHTML = '<b>' + fmt(current.value) + '</b> ' + (current.value === 1 ? 'book' : 'books') + ' · ' + pct(current.value, TOTAL);
    crumbs.appendChild(st);
    if (current.parent) {
      var up = document.createElement('button'); up.id = 'up'; up.textContent = '↑ up'; up.title = 'go up a level (Esc)';
      up.addEventListener('click', zoomUp); crumbs.appendChild(up);
    }
  }

  function renderBadge() {
    badge.classList.toggle('hide', layout !== 'sunburst');
    badge.classList.toggle('can', !!current.parent);
    badge.innerHTML = '<div class="n">' + fmt(current.value) + '</div><div class="l">' + (current.value === 1 ? 'book' : 'books') + '</div><div class="s">' + pct(current.value, TOTAL) + '</div>' + (current.parent ? '<div class="up">↑ ' + esc(current.parent.name.length > 18 ? current.parent.name.slice(0, 17) + '…' : current.parent.name) + '</div>' : '');
    badge.title = current.parent ? 'go up to ' + current.parent.name : 'the whole library';
  }

  function leavesOf(n) { var out = []; (function walk(m) { if (!m.children) out.push(m); else m.children.forEach(walk); })(n); return out; }

  var listExpanded = false;
  function renderPanel(n, list) {
    if (!n) return;
    listExpanded = false;
    var sw = '<span class="sw" style="background:' + n.fill + '"></span>';
    var head;
    if (!n.children && !list) {
      var b = n.book;
      head = '<div class="kind">Book · ' + esc(b.ty || '') + (b.ty ? ' · ' : '') + esc(b.g) + '</div>' +
        '<h2>' + sw + esc(b.t) + '</h2>' +
        '<div class="meta">' + (b.a ? esc(b.a) : '<i>no author listed</i>') + (yearText(b) ? ' · ' + yearText(b) : '') + ' · ' + esc(langName(b.l)) + (b.pub ? ' · ' + esc(b.pub) : '') + '</div>' +
        '<div class="meta">' + esc(unitName(b.u)) + ' › ' + esc(shelfLabel(b)) + ', position ' + b.p + '</div>' +
        (b.d ? '<p class="desc">' + esc(b.d) + '</p>' : '') +
        '<a class="link" href="../../#/bookshelf/' + encodeURIComponent(b.id) + '">open on the bookshelf →</a>';
      panelHead.innerHTML = head;
      panelList.innerHTML = '';
      return;
    }
    var items = list || leavesOf(n).slice();
    items.sort(function (a, c) { return shelfOrder(a.book) - shelfOrder(c.book); });
    var title = list ? 'Search' : n.level;
    head = '<div class="kind">' + esc(title) + (n.parent && !list ? ' in ' + esc(n.parent.name) : '') + '</div>' +
      '<h2>' + sw + esc(list ? n.name : n.name) + '</h2>' +
      '<div class="share"><div class="bar"><i style="width:' + (100 * items.length / TOTAL).toFixed(2) + '%"></i></div><span>' + fmt(items.length) + (items.length === 1 ? ' book' : ' books') + ' · ' + pct(items.length, TOTAL) + '</span></div>';
    if (n.children && n.depth > 0 && !list) head += '<div class="meta">' + n.children.length + ' ' + n.children[0].level.toLowerCase() + (n.children.length === 1 ? '' : 's') + '</div>';
    if (n.level === 'Bookcase') { var u = null; UNITS.forEach(function (x) { if (x.name === n.name) u = x; }); if (u) head += '<p class="desc">' + esc(u.desc) + '</p>'; }
    panelHead.innerHTML = head;
    renderList(items);
  }

  function renderList(items) {
    var CAP = 320, show = listExpanded ? items : items.slice(0, CAP);
    var html = '', lastShelf = null;
    if (!items.length) html = '<div class="empty">No books here.</div>';
    show.forEach(function (n) {
      var b = n.book, key = b.u + '|' + shelfLabel(b);
      if (key !== lastShelf) { lastShelf = key; html += '<div class="shelf"><b>' + esc(unitName(b.u)) + '</b> · ' + esc(shelfLabel(b)) + '</div>'; }
      html += '<a class="b' + (n === selected ? ' cur' : '') + '" href="../../#/bookshelf/' + encodeURIComponent(b.id) + '" data-i="' + n.i + '" title="open on the bookshelf"><span class="p">' + b.p + '</span><span class="t"><span class="sw" style="background:' + n.fill + '"></span>' + esc(b.t) + '</span><span></span><span class="a">' + esc(b.a || '') + (b.a && yearText(b) ? ' · ' : '') + yearText(b) + '</span></a>';
    });
    if (show.length < items.length) html += '<button class="more" data-more="1">show all ' + fmt(items.length) + ' books</button>';
    panelList.innerHTML = html;
    panelList.scrollTop = 0;
    var more = panelList.querySelector('[data-more]');
    if (more) more.addEventListener('click', function () { listExpanded = true; renderList(items); });
  }
  panelList.addEventListener('mouseover', function (ev) {
    var a = ev.target.closest && ev.target.closest('.b'); if (!a) return;
    var n = nodes[+a.getAttribute('data-i')]; if (!n) return;
    if (shapes[n.i] && shapes[n.i].style.display !== 'none') lightUp(n);
  });
  panelList.addEventListener('mouseleave', function () { if (!hovered) lightDown(); });

  // ---- Search ---------------------------------------------------------------------------------

  var resultNodes = [], resultSel = -1;
  function searchBooks(q) {
    var fq = fold(q.trim()); if (!fq) return [];
    var terms = fq.split(/\s+/);
    var out = [];
    nodes.forEach(function (n) {
      if (n.children) return;
      var hay = n.fold;
      var ok = terms.every(function (t) { return hay.indexOf(t) >= 0; });
      if (!ok) return;
      var score = fold(n.book.t).indexOf(fq) === 0 ? 0 : fold(n.book.t).indexOf(fq) > 0 ? 1 : 2;
      out.push({ n: n, s: score });
    });
    out.sort(function (a, b) { return a.s - b.s || shelfOrder(a.n.book) - shelfOrder(b.n.book); });
    return out.map(function (o) { return o.n; });
  }
  function markHits(list) {
    hits.forEach(function (n) { if (shapes[n.i]) shapes[n.i].classList.remove('hit'); });
    hits = list;
    hits.forEach(function (n) { if (shapes[n.i]) shapes[n.i].classList.add('hit'); });
  }
  function onQuery() {
    var q = qInput.value;
    searchWrap.classList.toggle('has', !!q);
    if (!q.trim()) { markHits([]); closeResults(); if (!hovered) lightDown(); renderPanel(hovered || selected || current); return; }
    resultNodes = searchBooks(q);
    markHits(resultNodes);
    resultSel = -1;
    results.innerHTML = resultNodes.length ? resultNodes.slice(0, 10).map(function (n, i) {
      var b = n.book;
      return '<button class="r" data-r="' + i + '" role="option"><span class="t">' + esc(b.t) + '</span><span class="m">' + esc(b.a || '') + (b.a ? ' · ' : '') + esc(unitName(b.u)) + ' › ' + esc(shelfLabel(b)) + '</span></button>';
    }).join('') + (resultNodes.length > 10 ? '<div class="none">and ' + (resultNodes.length - 10) + ' more; the panel lists them all</div>' : '')
      : '<div class="none">No book or author matches.</div>';
    results.classList.add('show');
    renderPanel({ name: '“' + q.trim() + '”', fill: 'var(--accent)', children: true, level: 'Search' }, resultNodes);
  }
  function closeResults() { results.classList.remove('show'); }
  function goToBook(n) {
    closeResults();
    var target = n.parent && n.parent.parent ? n.parent.parent : n.parent;
    // If the parent alone holds many books, zoom to the parent instead so the book is big enough to see.
    if (n.parent.value > 40 && n.parent.children) target = n.parent;
    var finish = function () { selectLeaf(n); markHits([n]); lightUp(n); hovered = null; };
    if (target !== current) { zoomTo(target); if (DUR) setTimeout(finish, DUR + 20); else finish(); }
    else finish();
    renderPanel(n);
  }
  qInput.addEventListener('input', onQuery);
  qInput.addEventListener('focus', function () { if (qInput.value.trim() && resultNodes.length) results.classList.add('show'); });
  qInput.addEventListener('keydown', function (ev) {
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      var max = Math.min(10, resultNodes.length); if (!max) return;
      resultSel = (resultSel + (ev.key === 'ArrowDown' ? 1 : -1) + max) % max;
      var rs = results.querySelectorAll('.r'); for (var i = 0; i < rs.length; i++) rs[i].classList.toggle('sel', i === resultSel);
    } else if (ev.key === 'Enter') {
      ev.preventDefault();
      var pick = resultNodes[resultSel >= 0 ? resultSel : 0]; if (pick) goToBook(pick);
    }
  });
  results.addEventListener('click', function (ev) {
    var b = ev.target.closest && ev.target.closest('[data-r]'); if (!b) return;
    var n = resultNodes[+b.getAttribute('data-r')]; if (n) goToBook(n);
  });
  $('q-clear').addEventListener('click', function () { qInput.value = ''; onQuery(); qInput.focus(); });
  document.addEventListener('click', function (ev) { if (!searchWrap.contains(ev.target)) closeResults(); });

  // ---- Controls ---------------------------------------------------------------------------------

  function setPreset(p, keepUrl) {
    if (!PRESETS[p]) p = 'genre';
    preset = p; $('preset').value = p;
    var doBuild = function () {
      tree = buildTree(books, preset); nodes = tree.nodes;
      nodes.forEach(function (n) { if (!n.children) n.fold = fold(n.book.t) + ' ' + fold(n.book.a); });
      current = tree.root; selected = tree.root; hovered = null; hits = [];
      buildSvg(); measureSize();
      applyGeom(layoutGeom(current));
      renderCrumbs(); renderBadge(); renderPanel(current);
      if (qInput.value.trim()) onQuery();
      chartWrap.classList.remove('fade');
      setTimeout(function () { chartWrap.classList.remove('swap'); }, 200);
    };
    if (tree && DUR) { chartWrap.classList.add('swap'); chartWrap.classList.add('fade'); setTimeout(doBuild, 190); }
    else doBuild();
    if (!keepUrl) writeUrl();
  }
  function setLayout(l) {
    if (l === layout) return;
    layout = l;
    var segs = document.querySelectorAll('[data-layout]');
    for (var i = 0; i < segs.length; i++) segs[i].classList.toggle('on', segs[i].getAttribute('data-layout') === l);
    measureSize();
    renderBadge();
    transitionTo(layoutGeom(current));
    writeUrl();
  }
  function writeUrl() {
    var q = new URLSearchParams();
    if (preset !== 'genre') q.set('h', preset);
    if (layout !== 'sunburst') q.set('layout', layout);
    if (current && current.parent) q.set('node', ancestors(current).slice(1).map(function (n) { return n.name; }).join('|'));
    var s = q.toString();
    try { history.replaceState(null, '', location.pathname + (s ? '?' + s : '')); } catch (e) { /* file: urls */ }
  }
  $('preset').addEventListener('change', function () { setPreset(this.value); });
  Array.prototype.forEach.call(document.querySelectorAll('[data-layout]'), function (b) {
    b.addEventListener('click', function () { setLayout(b.getAttribute('data-layout')); });
  });

  // ---- Export ----------------------------------------------------------------------------------

  function exportSvg() {
    var clone = svg.cloneNode(true);
    clone.removeAttribute('class'); clone.removeAttribute('id'); clone.removeAttribute('role');
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
    clone.setAttribute('width', W); clone.setAttribute('height', H);
    var hidden = clone.querySelectorAll('path[style*="display: none"], path[style*="display:none"]');
    for (var i = 0; i < hidden.length; i++) hidden[i].parentNode.removeChild(hidden[i]);
    var all = clone.querySelectorAll('[style]'); for (var j = 0; j < all.length; j++) all[j].removeAttribute('style');
    var bg = document.createElementNS(svg.namespaceURI, 'rect');
    bg.setAttribute('width', W); bg.setAttribute('height', H); bg.setAttribute('fill', BG);
    clone.insertBefore(bg, clone.firstChild);
    var tg = document.createElementNS(svg.namespaceURI, 'g');
    tg.setAttribute('font-family', FONT); tg.setAttribute('text-anchor', 'middle'); tg.setAttribute('fill', '#e8e4d8');
    var lines = layout === 'sunburst'
      ? [{ y: CY - 4, s: fmt(current.value), size: Math.round(RC * 0.42), w: 700 }, { y: CY + 12, s: current.value === 1 ? 'book' : 'books', size: 10 }, { y: CY + 26, s: pct(current.value, TOTAL), size: 12, fill: '#f2c66d' }]
      : [];
    lines.forEach(function (ln) {
      var t = document.createElementNS(svg.namespaceURI, 'text');
      t.setAttribute('x', CX); t.setAttribute('y', ln.y); t.setAttribute('font-size', ln.size);
      if (ln.w) t.setAttribute('font-weight', ln.w); if (ln.fill) t.setAttribute('fill', ln.fill);
      t.textContent = ln.s; tg.appendChild(t);
    });
    var title = document.createElementNS(svg.namespaceURI, 'title');
    title.textContent = 'Library ' + layout + ': ' + ancestors(current).map(function (n) { return n.name; }).join(' › ') + ' (' + fmt(current.value) + ' books)';
    clone.insertBefore(title, clone.firstChild);
    clone.appendChild(tg);
    var xml = '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(clone);
    var blob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = 'library-' + layout + '-' + preset + (current.parent ? '-' + current.name.replace(/[^\w　-鿿]+/g, '_').slice(0, 40) : '') + '.svg';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }
  $('export').addEventListener('click', exportSvg);

  // ---- Resize ------------------------------------------------------------------------------------

  var resizeTimer = 0, lastW = 0;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      if (!tree) return;
      if (chartWrap.clientWidth === lastW) return;
      lastW = chartWrap.clientWidth;
      if (anim) { cancelAnimationFrame(anim.raf); anim = null; gLabels.classList.remove('off'); }
      measureSize(); applyGeom(layoutGeom(current)); renderBadge();
    }, 120);
  });

  // ---- Boot --------------------------------------------------------------------------------------

  function showMsg(html) { msg.innerHTML = html; msg.classList.add('show'); }

  function boot(data) {
    books = (data.books || []).filter(function (b) { return b && b.id; });
    TOTAL = books.length;
    if (!TOTAL) { showMsg('The catalogue is empty.'); return; }
    var h = params.get('h'), l = params.get('layout');
    if (l && (l === 'treemap' || l === 'icicle') && !THUMB) {
      layout = l;
      var segs = document.querySelectorAll('[data-layout]');
      for (var i = 0; i < segs.length; i++) segs[i].classList.toggle('on', segs[i].getAttribute('data-layout') === l);
    }
    lastW = chartWrap.clientWidth;
    setPreset(THUMB ? 'genre' : (h || 'genre'), true);
    var deep = params.get('node') && !THUMB ? nodeByPath(params.get('node')) : null;
    if (deep) { current = deep; selected = deep; applyGeom(layoutGeom(current)); renderCrumbs(); renderBadge(); renderPanel(current); }
    if (params.get('q') && !THUMB) { qInput.value = params.get('q'); onQuery(); }
    var demo = params.get('demo');
    if (demo && !THUMB) requestAnimationFrame(function () {
      if (demo === 'treemap' || demo === 'icicle' || demo === 'sunburst') setLayout(demo);
      else if (demo === 'zoom') zoomTo(current.children[0]);
      else if (demo === 'up') zoomUp();
      else if (demo.indexOf('find:') === 0) { qInput.value = demo.slice(5); onQuery(); if (resultNodes[0]) goToBook(resultNodes[0]); }
    });
    if (THUMB) {
      document.body.classList.add('thumb'); svg.classList.add('thumb');
      measureSize(); applyGeom(layoutGeom(current)); renderBadge();
      var big = tree.root.children[0];
      hovered = big; lightUp(big); renderPanel(big);
    }
  }

  fetch(DATA_URL).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(boot)
    .catch(function (e) { showMsg('Could not load the library catalogue (' + esc(e.message) + ').<br>This page reads <code>assets/data/library.json</code> from the site; open it from the site rather than as a bare file.'); });
})();
