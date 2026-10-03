// Flows: the library catalogue as an alluvial diagram, hand-rolled on SVG.
//
// Every book is one unit of flow. The visitor picks an ordered list of facets
// (language, type, genre, bookcase, century, decade, author, publisher, free
// e-text, status); each facet is a column, each value a node, and each ribbon
// is the set of books that share every value along its path, so a ribbon's
// thickness is always a count. Nodes are ordered by a few passes of weighted
// barycentre sorting (keeping the arrangement with the fewest crossings), can
// be dragged vertically, and clicking one lights every path through it.
// Layout changes tween (nodes slide, ribbons reshape) unless reduced motion.
(function () {
  'use strict';

  var DATA_URL = '../../assets/data/library.json';
  var params = new URLSearchParams(location.search);
  var THUMB = params.get('thumb') === '1';
  var reduced = (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) || THUMB;
  if (THUMB) document.body.classList.add('thumb');

  // ---- Catalogue vocabulary (copied from the Bookshelf tab) ----------------

  var UNITS = [
    { k: 'K', name: 'Pine library' }, { k: 'H', name: 'Black bookcase' }, { k: 'N', name: 'Manga case' },
    { k: 'B', name: 'Cherry bookcase' }, { k: 'G', name: 'Library-label shelves' }, { k: 'I', name: 'Cream bookcase' },
    { k: 'L', name: 'Nursing case' }, { k: 'M', name: 'Japanese literature shelf' }, { k: 'A', name: 'Light-wood unit' },
    { k: 'D', name: 'Wire shelf' }, { k: 'F', name: 'Headset shelf' }, { k: 'J', name: 'Cubby' }, { k: 'Loose', name: 'Desk and floor' },
  ];
  var UNIT_NAME = {}, UNIT_RANK = {};
  UNITS.forEach(function (u, i) { UNIT_NAME[u.k] = u.name; UNIT_RANK[u.name] = i; });

  var GENRE_HUE = {
    'Literature (English & European)': 214, 'Japanese literature': 354, 'Manga & comics': 322, 'Light novels': 282,
    'Writing, film & literary craft': 28, 'History & biography': 14, 'Philosophy & political theory': 248,
    'Religion & theology': 42, 'Society, culture & ideas': 186, 'Politics, law & current affairs': 168,
    'Psychology, self-help & business': 142, 'Art & visual culture': 76, 'Music & opera': 266,
    'Language study & reference': 104, 'Test prep & study guides': 56, 'Math, CS & engineering': 200,
    'Science': 178, 'Nursing & medical': 6, 'Magazines & catalogues': 90, 'Occult & folklore': 300,
    'Games & other objects': -1, 'Unidentified': -1,
  };
  var HUES = [214, 354, 42, 168, 282, 76, 28, 186, 322, 104, 248, 14, 142, 56, 200, 300, 90, 6, 178, 266];
  var AUTHOR_ALIAS = {
    '村上春樹': 'Haruki Murakami', '三島由紀夫': 'Yukio Mishima', 'Mishima Yukio': 'Yukio Mishima',
    '太宰治': 'Osamu Dazai', 'Dazai Osamu': 'Osamu Dazai', '夏目漱石': 'Natsume Sōseki', '芥川龍之介': 'Ryūnosuke Akutagawa',
    'ed. Charles W. Eliot': 'Charles W. Eliot (ed.)', '井浦秀夫 / 監修 小林茂和': '井浦秀夫', '渡航 ほか': '渡航',
  };
  var GREY = 'hsl(220 8% 56%)';

  function isCJK(s) { return /[　-ヿ㐀-鿿豈-﫿＀-￯]/.test(s); }
  var collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });
  function natCompare(a, b) { return (isCJK(a) ? 1 : 0) - (isCJK(b) ? 1 : 0) || collator.compare(a, b); }
  function ordinal(n) { var s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
  function plural(n, w) { return n + ' ' + w + (n === 1 ? '' : 's'); }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function hsl(h, s, l) { return 'hsl(' + h + ' ' + s + '% ' + l + '%)'; }
  function norm(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function langGroup(l) {
    if (l === 'EN') return 'English';
    if (l === 'JA') return 'Japanese';
    if (l === 'EN/JA' || l === 'JA/EN') return 'English & Japanese';
    if (l === 'IT') return 'Italian';
    return 'Other / mixed';
  }
  function centuryOf(y) {
    if (y == null) return 'Year unknown';
    if (y <= 0) return 'Antiquity (BCE)';
    var c = Math.ceil(y / 100);
    if (c < 16) return 'Before 1500';
    return ordinal(c) + ' century';
  }
  function centuryRank(y) { return y == null ? 1e9 : y <= 0 ? -1 : y < 1500 ? 0 : Math.ceil(y / 100); }
  function decadeOf(y) {
    if (y == null) return 'Year unknown';
    if (y < 1800) return 'Before 1800';
    return Math.floor(y / 10) * 10 + 's';
  }
  function decadeRank(y) { return y == null ? 1e9 : y < 1800 ? 0 : Math.floor(y / 10); }

  // Facets. get(b) -> value label; rank(value, book) -> natural order key;
  // cap -> keep the top N values, fold the rest into `others`.
  var FACETS = {
    language: { label: 'Language', get: function (b) { return langGroup(b.l); },
      hue: { 'English': 214, 'Japanese': 354, 'English & Japanese': 42, 'Italian': 120, 'Other / mixed': 282 } },
    type: { label: 'Type', get: function (b) { return b.ty === '?' ? 'Unidentified type' : b.ty; }, cap: 18, others: 'Other types' },
    genre: { label: 'Genre', get: function (b) { return b.g; }, hue: GENRE_HUE },
    unit: { label: 'Bookcase', get: function (b) { return UNIT_NAME[b.u] || b.u; }, rank: function (v) { return UNIT_RANK[v]; }, pinned: true },
    century: { label: 'Century', get: function (b) { return centuryOf(b.y); }, rank: function (v, b) { return centuryRank(b.y); }, pinned: true },
    decade: { label: 'Decade', get: function (b) { return decadeOf(b.y); }, rank: function (v, b) { return decadeRank(b.y); }, pinned: true },
    author: { label: 'Author', get: function (b) { var a = AUTHOR_ALIAS[b.a] || b.a; return a || 'Uncredited'; }, cap: 30, others: 'Other authors' },
    publisher: { label: 'Publisher / series', get: function (b) { return b.pub || 'No publisher listed'; }, cap: 20, others: 'Other publishers' },
    free: { label: 'Free e-text', get: function (b) { return b.free ? 'Free e-text' : 'Print only'; }, rank: function (v) { return v === 'Free e-text' ? 0 : 1; }, pinned: true,
      hue: { 'Free e-text': 142, 'Print only': 214 } },
    status: { label: 'Catalogue status', get: function (b) { return b.st === 'OK' ? 'Catalogued OK' : 'Partial record'; }, rank: function (v) { return v === 'Catalogued OK' ? 0 : 1; }, pinned: true,
      hue: { 'Catalogued OK': 168, 'Partial record': 42 } },
  };
  var FACET_IDS = Object.keys(FACETS);

  // ---- State ---------------------------------------------------------------

  var books = [];
  var cols = ['language', 'type', 'genre', 'unit'];
  var colorMode = 'first';
  var orderMode = 'cross';
  var manual = {};          // facetId -> [valueIdx...] order fixed by dragging
  var L = null;             // current layout
  var sel = null;           // selection: {type:'node'|'flow'|'book'|'cell'|'legend', ...}
  var hover = null;         // {flow} | {node}
  var W = 900, H = 600;
  var nodeW = 12, top = 34, bottom = 10, leftM = 176, rightM = 176;

  var svg = document.getElementById('diagram');
  var wrap = document.getElementById('diagram-wrap');
  var statusEl = document.getElementById('status');
  var tip = document.getElementById('tip');
  var selEl = document.getElementById('sel');
  var legendEl = document.getElementById('legend');
  var colsEl = document.getElementById('cols');
  var addSel = document.getElementById('add');
  var colorSel = document.getElementById('color');
  var orderSel = document.getElementById('order');
  var searchEl = document.getElementById('search');
  var resultsEl = document.getElementById('results');
  var mxA = document.getElementById('mx-a'), mxB = document.getElementById('mx-b'), mxScroll = document.getElementById('mx-scroll');

  var SVGNS = 'http://www.w3.org/2000/svg';
  function sv(tag, attrs, parent) {
    var n = document.createElementNS(SVGNS, tag);
    if (attrs) for (var k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  // ---- Facet preparation ---------------------------------------------------

  function prepareFacet(id) {
    var f = FACETS[id];
    var counts = {}, firstBook = {};
    books.forEach(function (b, i) {
      var v = f.get(b);
      counts[v] = (counts[v] || 0) + 1;
      if (!(v in firstBook)) firstBook[v] = i;
    });
    var vals = Object.keys(counts).map(function (v) {
      return { label: v, count: counts[v], rank: f.rank ? f.rank(v, books[firstBook[v]]) : 0, others: false };
    });
    vals.sort(function (a, b) { return b.count - a.count || natCompare(a.label, b.label); });
    var kept = vals, folded = [];
    if (f.cap && vals.length > f.cap) {
      kept = vals.slice(0, f.cap); folded = vals.slice(f.cap);
      var n = folded.reduce(function (s, v) { return s + v.count; }, 0);
      kept.push({ label: f.others + ' (' + folded.length + ')', count: n, rank: 1e9, others: true });
    }
    var idx = {};
    kept.forEach(function (v, i) {
      v.vi = i; idx[v.label] = i;
      if (v.others) v.color = GREY;
      else if (f.hue) { var h = f.hue[v.label]; v.color = (h == null || h < 0) ? GREY : hsl(h, 62, 60); }
      else { var lap = Math.floor(i / HUES.length); v.color = hsl(HUES[i % HUES.length], 62 - lap * 12, 60 - lap * 14); }
    });
    folded.forEach(function (v) { idx[v.label] = kept.length - 1; });
    if (!f.rank) kept.forEach(function (v) { v.rank = v.others ? 1e9 : 0; });
    f.values = kept;
    f.val = books.map(function (b) { return idx[f.get(b)]; });
    f.id = id;
  }

  // ---- Layout --------------------------------------------------------------

  function flowColor(flow) {
    if (colorMode === 'genre') return FACETS.genre.values[FACETS.genre.val[flow.books[0]]].color;
    return FACETS[cols[0]].values[flow.vals[0]].color;
  }
  function flowColorKey(flow) {
    if (colorMode === 'genre') return FACETS.genre.val[flow.books[0]];
    return flow.vals[0];
  }

  function crossings(flows, pa, pb) {
    var list = flows.map(function (f) { return [pa[f.vals[0]], pb[f.vals[1]], f.n]; });
    list.sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
    var c = 0;
    for (var i = 0; i < list.length; i++) for (var j = i + 1; j < list.length; j++) {
      if (list[i][0] < list[j][0] && list[i][1] > list[j][1]) c += list[i][2] * list[j][2];
    }
    return c;
  }

  function computeLayout() {
    var C = cols.length;
    var facets = cols.map(function (id) { return FACETS[id]; });
    var genreCol = cols.indexOf('genre');
    // group books into flows
    var fmap = {}, flows = [];
    books.forEach(function (b, i) {
      var vals = facets.map(function (f) { return f.val[i]; });
      var key = vals.join('|');
      if (colorMode === 'genre' && genreCol < 0) key += '|g' + FACETS.genre.val[i];
      var fl = fmap[key];
      if (!fl) { fl = fmap[key] = { key: key, vals: vals, books: [], n: 0 }; flows.push(fl); }
      fl.books.push(i); fl.n++;
    });
    flows.forEach(function (fl) {
      fl.color = flowColor(fl); fl.ck = flowColorKey(fl);
      var parts = cols.map(function (id, i) { return id + ':' + fl.vals[i]; }).sort();
      fl.id = parts.join('|') + (colorMode === 'genre' && genreCol < 0 ? '|g' + fl.ck : '');
      fl.books.sort(function (a, b) { return natCompare(books[a].t, books[b].t); });
    });
    flows.sort(function (a, b) { return b.n - a.n || (a.key < b.key ? -1 : 1); });

    // nodes per column
    var columns = facets.map(function (f, ci) {
      var present = {};
      flows.forEach(function (fl) { present[fl.vals[ci]] = true; });
      var nodes = f.values.filter(function (v) { return present[v.vi]; }).map(function (v) {
        return { col: ci, facet: f, vi: v.vi, label: v.label, count: v.count, color: v.color, flows: [], key: f.id + ':' + v.vi, others: v.others };
      });
      var byVi = {};
      nodes.forEach(function (n) { byVi[n.vi] = n; });
      flows.forEach(function (fl) { byVi[fl.vals[ci]].flows.push(fl); });
      return { facet: f, nodes: nodes, byVi: byVi, ci: ci };
    });

    // ordering
    function sortNodes(col, mode) {
      if (mode === 'natural') col.nodes.sort(function (a, b) { return a.rank() - b.rank() || natCompare(a.label, b.label); });
      else col.nodes.sort(function (a, b) { return (a.others - b.others) || b.count - a.count || natCompare(a.label, b.label); });
    }
    columns.forEach(function (col) {
      col.nodes.forEach(function (n) { n.rank = function () { return col.facet.values[n.vi].rank; }; });
      var fixed = manual[col.facet.id];
      if (fixed) {
        var pos = {}; fixed.forEach(function (vi, i) { pos[vi] = i; });
        col.nodes.sort(function (a, b) { return (pos[a.vi] == null ? 1e9 : pos[a.vi]) - (pos[b.vi] == null ? 1e9 : pos[b.vi]); });
        col.fixed = true;
      } else if (orderMode === 'natural' || (orderMode === 'cross' && col.facet.pinned)) { sortNodes(col, 'natural'); col.fixed = orderMode !== 'cross' || col.facet.pinned; }
      else { sortNodes(col, 'size'); col.fixed = orderMode === 'size'; }
    });
    function positions(col) { var p = {}; col.nodes.forEach(function (n, i) { p[n.vi] = i; }); return p; }
    function totalCrossings() {
      var t = 0;
      for (var i = 0; i + 1 < C; i++) {
        var pa = positions(columns[i]), pb = positions(columns[i + 1]);
        t += crossings(flows.map(function (f) { return { vals: [f.vals[i], f.vals[i + 1]], n: f.n }; }), pa, pb);
      }
      return t;
    }
    if (orderMode === 'cross' && C > 1 && columns.some(function (c) { return !c.fixed; })) {
      var best = totalCrossings(), bestOrders = columns.map(function (c) { return c.nodes.slice(); });
      function sweep(ci, ref) {
        var col = columns[ci];
        if (col.fixed) return;
        var pos = positions(columns[ref]);
        col.nodes.forEach(function (n) {
          var s = 0, w = 0;
          n.flows.forEach(function (fl) { s += (pos[fl.vals[ref]] + 0.5) * fl.n; w += fl.n; });
          n.bary = w ? s / w : 0;
        });
        col.nodes.forEach(function (n, i) { n.prev = i; });
        col.nodes.sort(function (a, b) { return a.bary - b.bary || a.prev - b.prev; });
      }
      function consider() {
        var t = totalCrossings();
        if (t < best) { best = t; bestOrders = columns.map(function (c) { return c.nodes.slice(); }); }
      }
      for (var it = 0; it < 4; it++) {
        for (var i = 1; i < C; i++) { sweep(i, i - 1); consider(); }
        for (var j = C - 2; j >= 0; j--) { sweep(j, j + 1); consider(); }
      }
      columns.forEach(function (c, i) { c.nodes = bestOrders[i]; });
    }

    // geometry
    var total = books.length;
    var innerH = H - top - bottom;
    var scale = Infinity;
    columns.forEach(function (col) {
      col.gap = col.nodes.length > 16 ? 4 : col.nodes.length > 8 ? 7 : 10;
      scale = Math.min(scale, (innerH - col.gap * (col.nodes.length - 1)) / total);
    });
    var span = Math.max(1, C - 1);
    columns.forEach(function (col, ci) {
      col.x = leftM + (W - leftM - rightM - nodeW) * ci / span;
      var hc = total * scale + col.gap * (col.nodes.length - 1);
      var y = top + (innerH - hc) / 2;
      col.nodes.forEach(function (n, i) {
        n.x = col.x; n.y = y; n.h = n.count * scale; n.order = i;
        y += n.h + col.gap;
      });
    });
    var pos = columns.map(positions);
    function keyFor(fl, ci, dir) {
      // ordering of a flow within node ci: nearest column on the `dir` side first, then the others
      var k = [];
      for (var d = 1; d < C; d++) {
        var a = ci + dir * d, b = ci - dir * d;
        if (a >= 0 && a < C) k.push(pos[a][fl.vals[a]]);
        if (b >= 0 && b < C) k.push(pos[b][fl.vals[b]]);
      }
      k.push(fl.ck, -fl.n);
      return k;
    }
    function cmpKeys(a, b) { for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0; }
    flows.forEach(function (fl) { fl.outOff = []; fl.inOff = []; fl.h = fl.n * scale; });
    columns.forEach(function (col, ci) {
      col.nodes.forEach(function (n) {
        var out = n.flows.slice(), inn = n.flows.slice();
        var ko = {}, ki = {};
        out.forEach(function (fl) { ko[fl.key] = keyFor(fl, ci, 1); ki[fl.key] = keyFor(fl, ci, -1); });
        out.sort(function (a, b) { return cmpKeys(ko[a.key], ko[b.key]); });
        inn.sort(function (a, b) { return cmpKeys(ki[a.key], ki[b.key]); });
        var y = 0; out.forEach(function (fl) { fl.outOff[ci] = y; y += fl.h; });
        y = 0; inn.forEach(function (fl) { fl.inOff[ci] = y; y += fl.h; });
        n.bands = (ci === C - 1 ? inn : out);
      });
    });
    // segments
    var segs = [];
    flows.forEach(function (fl) {
      fl.segs = [];
      for (var ci = 0; ci + 1 < C; ci++) {
        var a = columns[ci].byVi[fl.vals[ci]], b = columns[ci + 1].byVi[fl.vals[ci + 1]];
        var s = { flow: fl, ci: ci, id: fl.id + '#' + cols[ci] + '>' + cols[ci + 1],
          x0: a.x + nodeW, x1: b.x, sy: a.y + fl.outOff[ci], ty: b.y + fl.inOff[ci + 1], h: fl.h };
        fl.segs.push(s); segs.push(s);
      }
    });
    // label positions (relaxed so they never overlap)
    columns.forEach(function (col) {
      var minGap = 13;
      var ys = col.nodes.map(function (n) { return n.y + n.h / 2; });
      for (var i = 1; i < ys.length; i++) ys[i] = Math.max(ys[i], ys[i - 1] + minGap);
      var over = ys[ys.length - 1] - (H - 6);
      if (over > 0) for (var j = ys.length - 1; j >= 0; j--) { ys[j] = Math.min(ys[j], (j === ys.length - 1 ? H - 6 : ys[j + 1] - minGap)); }
      col.nodes.forEach(function (n, k) { n.ly = Math.max(top + 6, ys[k]); });
    });
    var bookFlow = new Array(books.length);
    flows.forEach(function (fl) { fl.books.forEach(function (i) { bookFlow[i] = fl; }); });
    return { columns: columns, flows: flows, segs: segs, scale: scale, bookFlow: bookFlow, crossings: C > 1 ? totalCrossings() : null };
  }

  // ---- Rendering with tweens ----------------------------------------------

  var defs, gFlows, gNodes, gLabels, gHeads, styleEl, bgRect;
  var segEls = {}, bandEls = {}, nodeEls = {}, labelEls = {}, headEls = {}, gradEls = {};
  var anim = { items: [], raf: 0, t0: 0, dur: 650 };

  function initSvg() {
    svg.innerHTML = '';
    styleEl = sv('style', null, svg);
    styleEl.textContent =
      '.flow{fill-opacity:.55;stroke:rgba(0,0,0,0);stroke-width:2px;transition:fill-opacity .25s}' +
      '.flow.hot{fill-opacity:.95}.flow.dim{fill-opacity:.07}.flow.trace{stroke:#ffd98a;stroke-width:1.5px}' +
      '.band{transition:opacity .25s}.band.dim{opacity:.18}' +
      '.outline{fill:none;stroke:rgba(230,233,239,.35);stroke-width:1px}.node.sel .outline{stroke:#ffd98a;stroke-width:2px}' +
      '.lbl{font-size:12px;fill:#e6e9ef;paint-order:stroke;stroke:#0c1118;stroke-width:3px;stroke-linejoin:round}' +
      '.lbl .c{fill:#a3acba}.lbl.dim{opacity:.35}' +
      '.head{font-size:11px;letter-spacing:.08em;text-transform:uppercase;fill:#a3acba;font-weight:600}';
    bgRect = sv('rect', { fill: '#0c1118', x: 0, y: 0, width: W, height: H, 'data-bg': '1', 'fill-opacity': 0 }, svg);
    defs = sv('defs', null, svg);
    gFlows = sv('g', { id: 'g-flows' }, svg);
    gNodes = sv('g', { id: 'g-nodes' }, svg);
    gLabels = sv('g', { id: 'g-labels' }, svg);
    gHeads = sv('g', { id: 'g-heads' }, svg);
    segEls = {}; bandEls = {}; nodeEls = {}; labelEls = {}; headEls = {}; gradEls = {};
  }

  function segPath(g) {
    var xm = (g.x0 + g.x1) / 2;
    var h = Math.max(g.h, 0.4);
    return 'M' + g.x0.toFixed(1) + ',' + g.sy.toFixed(1) +
      'C' + xm.toFixed(1) + ',' + g.sy.toFixed(1) + ' ' + xm.toFixed(1) + ',' + g.ty.toFixed(1) + ' ' + g.x1.toFixed(1) + ',' + g.ty.toFixed(1) +
      'L' + g.x1.toFixed(1) + ',' + (g.ty + h).toFixed(1) +
      'C' + xm.toFixed(1) + ',' + (g.ty + h).toFixed(1) + ' ' + xm.toFixed(1) + ',' + (g.sy + h).toFixed(1) + ' ' + g.x0.toFixed(1) + ',' + (g.sy + h).toFixed(1) + 'Z';
  }
  var APPLY = {
    seg: function (e, g) { e.setAttribute('d', segPath(g)); e.setAttribute('opacity', g.o.toFixed(2)); },
    rect: function (e, g) { e.setAttribute('x', g.x.toFixed(1)); e.setAttribute('y', g.y.toFixed(1)); e.setAttribute('width', g.w.toFixed(1)); e.setAttribute('height', Math.max(0, g.h).toFixed(1)); e.setAttribute('opacity', g.o.toFixed(2)); },
    text: function (e, g) { e.setAttribute('x', g.x.toFixed(1)); e.setAttribute('y', g.y.toFixed(1)); e.setAttribute('opacity', g.o.toFixed(2)); },
  };
  function lerpG(a, b, t) { var g = {}; for (var k in b) g[k] = a[k] + (b[k] - a[k]) * t; return g; }
  function ease(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }

  function stage(e, to, kind, instant) {
    var from = e._g || Object.assign({}, to, { o: 0 });
    e._to = to; e._kind = kind;
    if (instant || reduced) { e._g = to; APPLY[kind](e, to); return; }
    anim.items.push({ e: e, from: from, to: to, kind: kind });
  }
  function retire(e, kind, instant) {
    if (!e._g || instant || reduced) { e.remove(); return; }
    var to = Object.assign({}, e._g, { o: 0 });
    anim.items.push({ e: e, from: e._g, to: to, kind: kind, remove: true });
  }
  function runAnim() {
    if (!anim.items.length) return;
    if (anim.raf) cancelAnimationFrame(anim.raf);
    anim.t0 = performance.now();
    var items = anim.items; anim.items = [];
    function frame(now) {
      var t = Math.min(1, (now - anim.t0) / anim.dur), k = ease(t);
      items.forEach(function (it) {
        var g = t >= 1 ? it.to : lerpG(it.from, it.to, k);
        it.e._g = g; APPLY[it.kind](it.e, g);
      });
      if (t < 1) anim.raf = requestAnimationFrame(frame);
      else { anim.raf = 0; items.forEach(function (it) { if (it.remove) it.e.remove(); }); }
    }
    anim.raf = requestAnimationFrame(frame);
  }

  function labelWidthFor(ci) {
    var C = cols.length;
    if (ci === 0) return leftM - 14;
    if (ci === C - 1) return rightM - 14;
    return (W - leftM - rightM - nodeW) / (C - 1) - nodeW - 22;
  }
  function fitLabel(s, px) {
    var w = 0, out = '';
    for (var i = 0; i < s.length; i++) {
      var ch = s[i], cw = isCJK(ch) ? 12 : /[A-Z]/.test(ch) ? 7.6 : /[mw]/.test(ch) ? 9 : /[ilj.,' ]/.test(ch) ? 3.4 : 6.4;
      if (w + cw > px - 8) return out.replace(/\s+$/, '') + '…';
      w += cw; out += ch;
    }
    return out;
  }

  function render(opts) {
    opts = opts || {};
    var instant = !!opts.instant;
    if (!gFlows) initSvg();
    if (!opts.pin) measure();
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.setAttribute('width', W); svg.setAttribute('height', H);
    bgRect.setAttribute('width', W); bgRect.setAttribute('height', H);
    L = computeLayout();
    if (opts.pin) {
      // a node being dragged follows the pointer; its ribbons follow it
      var pn = null;
      L.columns[opts.pin.col].nodes.forEach(function (n) { if (n.key === opts.pin.key) pn = n; });
      if (pn) {
        var dy = opts.pin.y - pn.y;
        pn.y += dy; pn.ly += dy;
        pn.flows.forEach(function (fl) { fl.segs.forEach(function (s) { if (s.ci === pn.col) s.sy += dy; if (s.ci + 1 === pn.col) s.ty += dy; }); });
      }
    }
    var C = cols.length;
    var seen = {};
    // segments (drawn big first, so thin ribbons sit on top and stay hoverable)
    L.segs.forEach(function (s) {
      seen[s.id] = true;
      var e = segEls[s.id];
      var gid = 'gr' + hashId(s.id);
      var grad = gradEls[s.id];
      if (!grad) {
        grad = sv('linearGradient', { id: gid, gradientUnits: 'userSpaceOnUse' }, defs);
        sv('stop', { offset: '0', 'stop-color': s.flow.color, 'stop-opacity': '1' }, grad);
        sv('stop', { offset: '1', 'stop-color': s.flow.color, 'stop-opacity': '0.55' }, grad);
        gradEls[s.id] = grad;
      }
      grad.setAttribute('x1', s.x0); grad.setAttribute('x2', s.x1); grad.setAttribute('y1', 0); grad.setAttribute('y2', 0);
      grad.children[0].setAttribute('stop-color', s.flow.color); grad.children[1].setAttribute('stop-color', s.flow.color);
      if (!e) {
        e = sv('path', { 'class': 'flow', fill: 'url(#' + gid + ')' });
        e._seg = s;
        segEls[s.id] = e;
      }
      e._seg = s;
      gFlows.appendChild(e);
      stage(e, { x0: s.x0, x1: s.x1, sy: s.sy, ty: s.ty, h: s.h, o: 1 }, 'seg', instant);
    });
    Object.keys(segEls).forEach(function (id) { if (!seen[id]) { retire(segEls[id], 'seg', instant); delete segEls[id]; if (gradEls[id]) { gradEls[id].remove(); delete gradEls[id]; } } });
    // nodes
    var seenN = {}, seenB = {};
    L.columns.forEach(function (col, ci) {
      col.nodes.forEach(function (n) {
        seenN[n.key] = true;
        var g = nodeEls[n.key];
        if (!g) {
          g = sv('g', { 'class': 'node', 'data-key': n.key });
          g._bands = sv('g', null, g);
          g._outline = sv('rect', { 'class': 'outline', rx: 2 }, g);
          nodeEls[n.key] = g;
        }
        g._node = n;
        gNodes.appendChild(g);
        var y = 0;
        n.bands.forEach(function (fl) {
          var bk = fl.id + '@' + n.key;
          seenB[bk] = true;
          var r = bandEls[bk];
          if (!r) { r = sv('rect', { 'class': 'band' }); bandEls[bk] = r; }
          r.setAttribute('fill', fl.color);
          r._flow = fl; r._node = n;
          g._bands.appendChild(r);
          stage(r, { x: n.x, y: n.y + y, w: nodeW, h: fl.h, o: 1 }, 'rect', instant);
          y += fl.h;
        });
        stage(g._outline, { x: n.x, y: n.y, w: nodeW, h: n.h, o: 1 }, 'rect', instant);
        // label
        var t = labelEls[n.key];
        if (!t) {
          t = sv('text', { 'class': 'lbl' });
          t._name = sv('tspan', null, t); t._cnt = sv('tspan', { 'class': 'c' }, t);
          labelEls[n.key] = t;
        }
        t._node = n;
        gLabels.appendChild(t);
        var right = ci > 0;
        t.setAttribute('text-anchor', right ? 'start' : 'end');
        t._name.textContent = fitLabel(n.label, labelWidthFor(ci) - 24) + ' ';
        t._cnt.textContent = String(n.count);
        stage(t, { x: right ? n.x + nodeW + 7 : n.x - 7, y: n.ly + 4, o: 1 }, 'text', instant);
      });
      // header
      var hk = col.facet.id;
      var h = headEls[hk];
      if (!h) { h = sv('text', { 'class': 'head' }); headEls[hk] = h; }
      gHeads.appendChild(h);
      h.textContent = col.facet.label;
      h.setAttribute('text-anchor', ci === 0 ? 'end' : ci === C - 1 ? 'end' : 'middle');
      stage(h, { x: ci === 0 ? col.x - 7 : ci === C - 1 ? col.x + nodeW : col.x + nodeW / 2, y: 20, o: 1 }, 'text', instant);
      seenN['#' + hk] = true;
    });
    Object.keys(nodeEls).forEach(function (k) { if (!seenN[k]) { retire(nodeEls[k], 'rect', true); delete nodeEls[k]; } });
    Object.keys(labelEls).forEach(function (k) { if (!seenN[k]) { retire(labelEls[k], 'text', instant); delete labelEls[k]; } });
    Object.keys(bandEls).forEach(function (k) { if (!seenB[k]) { retire(bandEls[k], 'rect', instant); delete bandEls[k]; } });
    Object.keys(headEls).forEach(function (k) { if (!seenN['#' + k]) { retire(headEls[k], 'text', instant); delete headEls[k]; } });
    runAnim();
    reconcileSelection();
    applyHighlight();
    if (!opts.keepPanel) renderPanel();
    renderLegend();
    if (!opts.skipMatrix) renderMatrix();
  }
  function hashId(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h.toString(36); }

  // ---- Selection and highlight --------------------------------------------

  function reconcileSelection() {
    if (!sel) return;
    if (sel.type === 'node') {
      var n = null;
      L.columns.forEach(function (c) { c.nodes.forEach(function (x) { if (x.key === sel.key) n = x; }); });
      if (!n) sel = null; else sel.node = n;
    } else if (sel.type === 'flow') {
      var f = null;
      L.flows.forEach(function (x) { if (x.id === sel.id) f = x; });
      if (!f) sel = null; else sel.flow = f;
    } else if (sel.type === 'cell') {
      if (cols.indexOf(sel.fa) < 0 || cols.indexOf(sel.fb) < 0) sel = null;
    }
  }
  function hotFlows() {
    // returns a Set of flow ids to light, or null for "everything normal"
    var s = null;
    if (hover && hover.flow) return new Set([hover.flow.id]);
    if (hover && hover.node) return new Set(hover.node.flows.map(function (f) { return f.id; }));
    if (!sel) return null;
    if (sel.type === 'node') return new Set(sel.node.flows.map(function (f) { return f.id; }));
    if (sel.type === 'flow') return new Set([sel.flow.id]);
    if (sel.type === 'book') { var fl = L.bookFlow[sel.idx]; return new Set(fl ? [fl.id] : []); }
    if (sel.type === 'legend') return new Set(L.flows.filter(function (f) { return f.ck === sel.ck; }).map(function (f) { return f.id; }));
    if (sel.type === 'cell') {
      var ia = cols.indexOf(sel.fa), ib = cols.indexOf(sel.fb);
      return new Set(L.flows.filter(function (f) { return f.vals[ia] === sel.va && f.vals[ib] === sel.vb; }).map(function (f) { return f.id; }));
    }
    return s;
  }
  function applyHighlight() {
    var hot = hotFlows();
    var traceFlow = sel && sel.type === 'book' ? L.bookFlow[sel.idx] : null;
    Object.keys(segEls).forEach(function (id) {
      var e = segEls[id], fl = e._seg.flow;
      e.classList.toggle('hot', !!hot && hot.has(fl.id));
      e.classList.toggle('dim', !!hot && !hot.has(fl.id));
      e.classList.toggle('trace', !!traceFlow && traceFlow.id === fl.id);
    });
    Object.keys(bandEls).forEach(function (k) {
      var r = bandEls[k];
      r.classList.toggle('dim', !!hot && !hot.has(r._flow.id));
    });
    var touched = {};
    if (hot) L.flows.forEach(function (fl) { if (hot.has(fl.id)) cols.forEach(function (id, i) { touched[id + ':' + fl.vals[i]] = true; }); });
    Object.keys(labelEls).forEach(function (k) { labelEls[k].classList.toggle('dim', !!hot && !touched[k]); });
    Object.keys(nodeEls).forEach(function (k) { nodeEls[k].classList.toggle('sel', !!sel && sel.type === 'node' && sel.key === k); });
  }

  // ---- Tooltip -------------------------------------------------------------

  function pathText(fl) {
    return cols.map(function (id, i) { return esc(FACETS[id].values[fl.vals[i]].label); }).join('<span class="sep">·</span>');
  }
  function showTip(html, x, y, above) {
    tip.innerHTML = html; tip.classList.add('show');
    var r = tip.getBoundingClientRect();
    var px = x + 16, py = above ? y - r.height - 14 : y + 16;
    if (px + r.width > window.innerWidth - 8) px = Math.max(8, x - r.width - 12);
    if (py + r.height > window.innerHeight - 8) py = Math.max(8, y - r.height - 12);
    tip.style.left = px + 'px'; tip.style.top = py + 'px';
  }
  function hideTip() { tip.classList.remove('show'); }
  function flowTip(fl) {
    var titles = fl.books.slice(0, 5).map(function (i) { return '<li>' + esc(books[i].t) + '</li>'; }).join('');
    return '<div class="n">' + plural(fl.n, 'book') + '</div><div class="path">' + pathText(fl) + '</div><ul>' + titles + '</ul>' +
      (fl.n > 5 ? '<div class="more">click to list all ' + fl.n + ' in the side panel</div>' : '<div class="more">click to list them in the side panel</div>');
  }
  function nodeTip(n) {
    var C = cols.length, ci = n.col;
    var ref = ci < C - 1 ? ci + 1 : ci - 1;
    var html = '<div class="n">' + esc(n.label) + '</div><div class="row"><span>' + esc(n.facet.label) + '</span><b>' + plural(n.count, 'book') + '</b></div>';
    if (ref >= 0 && ref !== ci) {
      var agg = {};
      n.flows.forEach(function (fl) { var v = fl.vals[ref]; agg[v] = (agg[v] || 0) + fl.n; });
      var rows = Object.keys(agg).sort(function (a, b) { return agg[b] - agg[a]; }).slice(0, 5);
      var rf = FACETS[cols[ref]];
      html += '<ul>' + rows.map(function (v) { return '<li>' + esc(rf.values[v].label) + ' <b>' + agg[v] + '</b></li>'; }).join('') + '</ul>';
      if (Object.keys(agg).length > 5) html += '<div class="more">and ' + (Object.keys(agg).length - 5) + ' more ' + esc(rf.label.toLowerCase()) + ' values</div>';
    }
    html += '<div class="more">click to light every path; drag to move</div>';
    return html;
  }

  // ---- Side panel ----------------------------------------------------------

  function shelfText(b) { return (UNIT_NAME[b.u] || b.u) + ', ' + b.s; }
  function bookLine(i) {
    var b = books[i];
    var meta = [b.a, b.y != null ? (b.y <= 0 ? Math.abs(b.y) + ' BCE' : b.y) : null, shelfText(b)].filter(Boolean).join(' · ');
    return '<li title="' + esc(b.t + ' · ' + meta) + '"><a href="../../#/bookshelf/' + encodeURIComponent(b.id) + '">' + esc(b.t) + '</a> <span class="m">' + esc(meta) + '</span></li>';
  }
  function bookList(idxs) {
    return '<ol>' + idxs.map(bookLine).join('') + '</ol>';
  }
  function breakdown(idxs, skipFacet) {
    var html = '';
    cols.forEach(function (id) {
      if (id === skipFacet) return;
      var f = FACETS[id], agg = {};
      idxs.forEach(function (i) { var v = f.val[i]; agg[v] = (agg[v] || 0) + 1; });
      var keys = Object.keys(agg).sort(function (a, b) { return agg[b] - agg[a]; }).slice(0, 6);
      var max = agg[keys[0]] || 1;
      html += '<div class="bd"><h4>' + esc(f.label) + '</h4>' + keys.map(function (v) {
        return '<div class="bar"><span class="f" style="width:' + Math.max(3, Math.round(70 * agg[v] / max)) + 'px;background:' + f.values[v].color + '"></span><span class="t">' + esc(f.values[v].label) + '</span><span class="n">' + agg[v] + '</span></div>';
      }).join('') + '</div>';
    });
    return html;
  }
  function renderPanel() {
    if (!sel) {
      selEl.innerHTML = '<span class="hint">Hover a ribbon to see which books it carries. Click a node to light every path through it; click a ribbon to list its books here. Type a title to trace a single book.</span>' +
        (L && L.crossings != null ? '<div class="hint" style="margin-top:8px">' + L.flows.length + ' ribbons · ' + L.crossings.toLocaleString() + ' weighted ribbon crossings' + (orderMode === 'cross' ? ' after barycentre sorting' : '') + '</div>' : '');
      return;
    }
    var html = '';
    if (sel.type === 'node') {
      var n = sel.node, idxs = [];
      n.flows.forEach(function (fl) { idxs = idxs.concat(fl.books); });
      idxs.sort(function (a, b) { return natCompare(books[a].t, books[b].t); });
      html = '<h3>' + esc(n.label) + '</h3><div class="path">' + esc(n.facet.label) + ' · <span class="count">' + plural(n.count, 'book') + '</span> · ' + plural(n.flows.length, 'ribbon') + '</div>' +
        breakdown(idxs, n.facet.id) + '<div class="actions"><button id="btn-list">List ' + plural(idxs.length, 'book') + '</button><button id="btn-clear">Clear</button></div><div id="list"></div>';
      selEl.innerHTML = html;
      document.getElementById('btn-list').addEventListener('click', function () { document.getElementById('list').innerHTML = bookList(idxs); this.disabled = true; });
    } else if (sel.type === 'flow') {
      var fl = sel.flow;
      html = '<h3>' + plural(fl.n, 'book') + '</h3><div class="path">' + pathText(fl) + '</div>' + bookList(fl.books) + '<div class="actions"><button id="btn-clear">Clear</button></div>';
      selEl.innerHTML = html;
    } else if (sel.type === 'book') {
      var b = books[sel.idx], f2 = L.bookFlow[sel.idx];
      html = '<div class="card"><h3>' + esc(b.t) + '</h3><div class="meta">' + esc([b.a, b.pub, b.yr || (b.y != null ? b.y : '')].filter(Boolean).join(' · ')) + '</div>' +
        '<div class="meta">' + esc(shelfText(b)) + ', position ' + b.p + '</div>' +
        (f2 ? '<div class="path" style="margin-top:6px">' + pathText(f2) + '</div><div class="hint">shares this exact path with ' + (f2.n - 1 === 0 ? 'no other book' : plural(f2.n - 1, 'other book')) + '</div>' : '') +
        (b.d ? '<p>' + esc(b.d) + '</p>' : '') +
        '<p><a class="open" href="../../#/bookshelf/' + encodeURIComponent(b.id) + '">open its card on the Bookshelf →</a>' + (b.free && b.free.url ? ' · <a class="open" href="' + esc(b.free.url) + '" rel="noopener">free e-text</a>' : '') + '</p>' +
        '<div class="actions">' + (f2 && f2.n > 1 ? '<button id="btn-flow">List its ribbon</button>' : '') + '<button id="btn-clear">Clear</button></div></div>';
      selEl.innerHTML = html;
      var bf = document.getElementById('btn-flow');
      if (bf) bf.addEventListener('click', function () { sel = { type: 'flow', id: f2.id, flow: f2 }; applyHighlight(); renderPanel(); });
    } else if (sel.type === 'cell') {
      var fa = FACETS[sel.fa], fb = FACETS[sel.fb];
      var ids = [];
      books.forEach(function (bk, i) { if (fa.val[i] === sel.va && fb.val[i] === sel.vb) ids.push(i); });
      ids.sort(function (a, b) { return natCompare(books[a].t, books[b].t); });
      html = '<h3>' + esc(fa.values[sel.va].label) + ' × ' + esc(fb.values[sel.vb].label) + '</h3><div class="path"><span class="count">' + plural(ids.length, 'book') + '</span></div>' + bookList(ids) + '<div class="actions"><button id="btn-clear">Clear</button></div>';
      selEl.innerHTML = html;
    } else if (sel.type === 'legend') {
      var fls = L.flows.filter(function (f) { return f.ck === sel.ck; });
      var ids2 = [];
      fls.forEach(function (f) { ids2 = ids2.concat(f.books); });
      ids2.sort(function (a, b) { return natCompare(books[a].t, books[b].t); });
      html = '<h3>' + esc(sel.label) + '</h3><div class="path"><span class="count">' + plural(ids2.length, 'book') + '</span> · ' + plural(fls.length, 'ribbon') + '</div>' + breakdown(ids2, colorMode === 'genre' ? 'genre' : cols[0]) +
        '<div class="actions"><button id="btn-list">List ' + plural(ids2.length, 'book') + '</button><button id="btn-clear">Clear</button></div><div id="list"></div>';
      selEl.innerHTML = html;
      document.getElementById('btn-list').addEventListener('click', function () { document.getElementById('list').innerHTML = bookList(ids2); this.disabled = true; });
    }
    var bc = document.getElementById('btn-clear');
    if (bc) bc.addEventListener('click', clearSelection);
  }
  function clearSelection() { sel = null; applyHighlight(); renderPanel(); renderLegend(); markMatrix(); }

  function renderLegend() {
    var items;
    if (colorMode === 'genre') {
      var agg = {};
      L.flows.forEach(function (f) { agg[f.ck] = (agg[f.ck] || 0) + f.n; });
      items = Object.keys(agg).map(function (k) { var v = FACETS.genre.values[k]; return { ck: +k, label: v.label, color: v.color, n: agg[k] }; });
      items.sort(function (a, b) { return b.n - a.n; });
      document.getElementById('legend-title').textContent = 'Colour: genre';
    } else {
      items = L.columns[0].nodes.map(function (n) { return { ck: n.vi, label: n.label, color: n.color, n: n.count }; });
      document.getElementById('legend-title').textContent = 'Colour: ' + L.columns[0].facet.label.toLowerCase();
    }
    legendEl.innerHTML = '';
    items.forEach(function (it) {
      var d = el('span', 'it');
      d.title = 'click to light these ribbons';
      if (sel && sel.type === 'legend' && sel.ck === it.ck) d.classList.add('on');
      var sw = el('span', 'sw'); sw.style.background = it.color;
      d.appendChild(sw); d.appendChild(el('span', null, it.label)); d.appendChild(el('span', 'c', String(it.n)));
      d.addEventListener('click', function () {
        if (sel && sel.type === 'legend' && sel.ck === it.ck) { clearSelection(); return; }
        sel = { type: 'legend', ck: it.ck, label: it.label }; applyHighlight(); renderPanel(); renderLegend(); markMatrix();
      });
      legendEl.appendChild(d);
    });
  }

  // ---- Matrix --------------------------------------------------------------

  function fillMatrixSelects() {
    [mxA, mxB].forEach(function (s, i) {
      var cur = s.value;
      s.innerHTML = '';
      cols.forEach(function (id) { var o = document.createElement('option'); o.value = id; o.textContent = FACETS[id].label; s.appendChild(o); });
      if (cols.indexOf(cur) >= 0) s.value = cur; else s.value = cols[Math.min(i, cols.length - 1)];
    });
    if (mxA.value === mxB.value && cols.length > 1) mxB.value = cols[cols.indexOf(mxA.value) === 0 ? 1 : 0];
  }
  function renderMatrix() {
    fillMatrixSelects();
    var fa = FACETS[mxA.value], fb = FACETS[mxB.value];
    if (!fa || !fb) return;
    var ca = L.columns[cols.indexOf(fa.id)], cb = L.columns[cols.indexOf(fb.id)];
    var rows = ca.nodes, colsN = cb.nodes;
    var m = {}, max = 1, rowTot = {}, colTot = {};
    books.forEach(function (b, i) {
      var k = fa.val[i] + ',' + fb.val[i];
      m[k] = (m[k] || 0) + 1; if (m[k] > max) max = m[k];
      rowTot[fa.val[i]] = (rowTot[fa.val[i]] || 0) + 1; colTot[fb.val[i]] = (colTot[fb.val[i]] || 0) + 1;
    });
    var html = '<table class="mx"><thead><tr><th class="row tot">' + esc(fa.label) + ' \\ ' + esc(fb.label) + '</th>';
    colsN.forEach(function (n) { html += '<th class="col" data-vb="' + n.vi + '" title="' + esc(n.label) + '">' + esc(fitLabel(n.label, 150)) + '</th>'; });
    html += '<th class="col tot">total</th></tr></thead><tbody>';
    rows.forEach(function (r) {
      html += '<tr><th class="row" data-va="' + r.vi + '" title="' + esc(r.label) + '">' + esc(r.label) + '</th>';
      colsN.forEach(function (c) {
        var v = m[r.vi + ',' + c.vi] || 0;
        var a = v ? 0.1 + 0.75 * Math.sqrt(v / max) : 0;
        html += '<td data-va="' + r.vi + '" data-vb="' + c.vi + '" class="' + (v ? 'v' : '') + '" style="background:rgba(143,211,192,' + a.toFixed(2) + ')" title="' + esc(r.label + ' × ' + c.label + ': ' + plural(v, 'book')) + '">' + (v || '') + '</td>';
      });
      html += '<td class="tot">' + (rowTot[r.vi] || 0) + '</td></tr>';
    });
    html += '<tr><th class="row tot">total</th>';
    colsN.forEach(function (c) { html += '<td class="tot">' + (colTot[c.vi] || 0) + '</td>'; });
    html += '<td class="tot">' + books.length + '</td></tr></tbody></table>';
    mxScroll.innerHTML = html;
    markMatrix();
  }
  function markMatrix() {
    var tds = mxScroll.querySelectorAll('td[data-va]');
    for (var i = 0; i < tds.length; i++) {
      var td = tds[i];
      td.classList.toggle('on', !!sel && sel.type === 'cell' && sel.fa === mxA.value && sel.fb === mxB.value && +td.dataset.va === sel.va && +td.dataset.vb === sel.vb);
    }
  }
  mxScroll.addEventListener('click', function (ev) {
    var td = ev.target.closest('td[data-va]');
    if (!td) return;
    var va = +td.dataset.va, vb = +td.dataset.vb;
    if (sel && sel.type === 'cell' && sel.va === va && sel.vb === vb && sel.fa === mxA.value && sel.fb === mxB.value) { clearSelection(); return; }
    sel = { type: 'cell', fa: mxA.value, fb: mxB.value, va: va, vb: vb };
    applyHighlight(); renderPanel(); renderLegend(); markMatrix();
    if (window.innerWidth < 1000) document.getElementById('panel').scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'nearest' });
  });
  mxA.addEventListener('change', function () { if (mxA.value === mxB.value) mxB.value = cols.filter(function (c) { return c !== mxA.value; })[0] || mxA.value; renderMatrix(); });
  mxB.addEventListener('change', function () { if (mxA.value === mxB.value) mxA.value = cols.filter(function (c) { return c !== mxB.value; })[0] || mxB.value; renderMatrix(); });

  // ---- Diagram interaction -------------------------------------------------

  var drag = null;
  svg.addEventListener('pointermove', function (ev) {
    if (drag) { dragMove(ev); return; }
    var t = ev.target;
    if (t.classList && t.classList.contains('flow')) {
      var fl = t._seg.flow;
      if (!hover || hover.flow !== fl) { hover = { flow: fl }; applyHighlight(); }
      showTip(flowTip(fl), ev.clientX, ev.clientY);
    } else if (t.classList && (t.classList.contains('band') || t.classList.contains('outline'))) {
      var n = t.parentNode._node || t.parentNode.parentNode._node;
      if (!n) return;
      if (!hover || hover.node !== n) { hover = { node: n }; applyHighlight(); }
      showTip(nodeTip(n), ev.clientX, ev.clientY);
    } else if (hover) { hover = null; applyHighlight(); hideTip(); }
  });
  svg.addEventListener('pointerleave', function () { if (hover && !drag) { hover = null; applyHighlight(); hideTip(); } });
  svg.addEventListener('click', function (ev) {
    if (drag && drag.moved) return;
    var t = ev.target;
    if (t.classList && t.classList.contains('flow')) {
      var fl = t._seg.flow;
      sel = { type: 'flow', id: fl.id, flow: fl };
      hover = null;
      applyHighlight(); renderPanel(); renderLegend(); markMatrix();
      if (window.innerWidth < 1000) document.getElementById('panel').scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'nearest' });
    } else if (t.classList && (t.classList.contains('band') || t.classList.contains('outline'))) {
      var n = t.parentNode._node || t.parentNode.parentNode._node;
      if (!n) return;
      if (sel && sel.type === 'node' && sel.key === n.key) { clearSelection(); return; }
      sel = { type: 'node', key: n.key, node: n };
      hover = null;
      applyHighlight(); renderPanel(); renderLegend(); markMatrix();
    } else if (sel) { clearSelection(); }
  });
  svg.addEventListener('pointerdown', function (ev) {
    var t = ev.target;
    if (!(t.classList && (t.classList.contains('band') || t.classList.contains('outline')))) return;
    var g = t.closest('.node'); if (!g || !g._node) return;
    var n = g._node;
    var rect = svg.getBoundingClientRect();
    var sy = (ev.clientY - rect.top) * H / rect.height;
    drag = { node: n, key: n.key, col: n.col, startY: sy, origY: n.y, moved: false, el: g, pointerId: ev.pointerId };
    try { svg.setPointerCapture(ev.pointerId); } catch (e) { /* not supported */ }
    ev.preventDefault();
  });
  function dragMove(ev) {
    var rect = svg.getBoundingClientRect();
    var sy = (ev.clientY - rect.top) * H / rect.height;
    var dy = sy - drag.startY;
    if (!drag.moved && Math.abs(dy) < 4) return;
    if (!drag.moved) {
      drag.moved = true; hideTip(); hover = null;
      drag.el.classList.add('dragging');
      // freeze every column's order so only the dragged node moves
      L.columns.forEach(function (c) { manual[c.facet.id] = c.nodes.map(function (x) { return x.vi; }); });
    }
    var col = L.columns[drag.col];
    var n = col.byVi[drag.node.vi];
    var y = clamp(drag.origY + dy, top, H - bottom - n.h);
    var centre = y + n.h / 2;
    var order = col.nodes.slice().sort(function (a, b) {
      var ca = a === n ? centre : a.y + a.h / 2, cb = b === n ? centre : b.y + b.h / 2;
      return ca - cb;
    }).map(function (x) { return x.vi; });
    manual[col.facet.id] = order;
    render({ instant: true, pin: { key: drag.key, col: drag.col, y: y }, keepPanel: true, skipMatrix: true });
  }
  svg.addEventListener('pointerup', endDrag);
  svg.addEventListener('pointercancel', endDrag);
  function endDrag(ev) {
    if (!drag) return;
    var d = drag;
    try { svg.releasePointerCapture(d.pointerId); } catch (e) { /* ignore */ }
    d.el.classList.remove('dragging');
    if (d.moved) {
      render({ keepPanel: true, skipMatrix: true });
      setTimeout(function () { drag = null; }, 0);
    } else drag = null;
  }

  // ---- Column chips --------------------------------------------------------

  function renderChips() {
    Array.prototype.slice.call(colsEl.querySelectorAll('.chip')).forEach(function (c) { c.remove(); });
    cols.forEach(function (id, i) {
      var c = el('span', 'chip'); c.tabIndex = 0; c.dataset.id = id; c.setAttribute('role', 'button');
      c.title = 'drag to reorder · ← → with the keyboard · Delete removes';
      c.appendChild(el('span', 'grip', '⋮⋮'));
      c.appendChild(el('span', null, FACETS[id].label));
      if (cols.length > 2) {
        var x = el('button', 'x', '×'); x.title = 'remove column'; x.setAttribute('aria-label', 'remove ' + FACETS[id].label);
        x.addEventListener('click', function (ev) { ev.stopPropagation(); setCols(cols.filter(function (c2) { return c2 !== id; })); });
        c.appendChild(x);
      }
      if (i < cols.length - 1) c.appendChild(el('span', 'arrow', '→'));
      c.addEventListener('pointerdown', chipDown);
      c.addEventListener('keydown', function (ev) {
        var k = cols.indexOf(id);
        if (ev.key === 'ArrowLeft' && k > 0) { var a = cols.slice(); a.splice(k, 1); a.splice(k - 1, 0, id); setCols(a, id); ev.preventDefault(); }
        else if (ev.key === 'ArrowRight' && k < cols.length - 1) { var b = cols.slice(); b.splice(k, 1); b.splice(k + 1, 0, id); setCols(b, id); ev.preventDefault(); }
        else if ((ev.key === 'Delete' || ev.key === 'Backspace') && cols.length > 2) { setCols(cols.filter(function (c2) { return c2 !== id; })); ev.preventDefault(); }
      });
      colsEl.insertBefore(c, addSel.parentNode === colsEl ? addSel : null);
    });
    addSel.innerHTML = '<option value="">+ add column…</option>';
    FACET_IDS.filter(function (id) { return cols.indexOf(id) < 0; }).forEach(function (id) {
      var o = document.createElement('option'); o.value = id; o.textContent = FACETS[id].label; addSel.appendChild(o);
    });
    addSel.disabled = cols.length >= 6;
    addSel.title = cols.length >= 6 ? 'six columns is the limit' : '';
  }
  var chipDrag = null;
  function chipDown(ev) {
    if (ev.target.classList.contains('x')) return;
    var chip = ev.currentTarget;
    chipDrag = { chip: chip, id: chip.dataset.id, startX: ev.clientX, moved: false, pointerId: ev.pointerId };
    chip.setPointerCapture(ev.pointerId);
    chip.addEventListener('pointermove', chipMove);
    chip.addEventListener('pointerup', chipUp);
    chip.addEventListener('pointercancel', chipUp);
  }
  function chipMove(ev) {
    if (!chipDrag) return;
    if (!chipDrag.moved && Math.abs(ev.clientX - chipDrag.startX) < 5) return;
    chipDrag.moved = true;
    chipDrag.chip.classList.add('dragging');
    var chips = Array.prototype.slice.call(colsEl.querySelectorAll('.chip')).filter(function (c) { return c !== chipDrag.chip; });
    var before = null;
    for (var i = 0; i < chips.length; i++) {
      var r = chips[i].getBoundingClientRect();
      if (ev.clientX < r.left + r.width / 2 && ev.clientY < r.bottom + 6 && ev.clientY > r.top - 6) { before = chips[i]; break; }
      if (ev.clientY < r.top - 6) { before = chips[i]; break; }
    }
    if (before) colsEl.insertBefore(chipDrag.chip, before);
    else colsEl.insertBefore(chipDrag.chip, chips.length ? chips[chips.length - 1].nextSibling : null);
  }
  function chipUp(ev) {
    if (!chipDrag) return;
    var chip = chipDrag.chip;
    chip.classList.remove('dragging');
    try { chip.releasePointerCapture(chipDrag.pointerId); } catch (e) { /* ignore */ }
    chip.removeEventListener('pointermove', chipMove); chip.removeEventListener('pointerup', chipUp); chip.removeEventListener('pointercancel', chipUp);
    var moved = chipDrag.moved; chipDrag = null;
    if (!moved) return;
    var order = Array.prototype.slice.call(colsEl.querySelectorAll('.chip')).map(function (c) { return c.dataset.id; });
    if (order.join() !== cols.join()) setCols(order); else renderChips();
  }
  addSel.addEventListener('change', function () {
    if (addSel.value && cols.indexOf(addSel.value) < 0 && cols.length < 6) setCols(cols.concat([addSel.value]));
    addSel.value = '';
  });
  function setCols(next, focusId) {
    cols = next;
    manual = {};
    hover = null; hideTip();
    if (sel && sel.type === 'flow') sel = null;
    renderChips();
    render();
    syncUrl();
    if (focusId) { var c = colsEl.querySelector('.chip[data-id="' + focusId + '"]'); if (c) c.focus(); }
  }
  colorSel.addEventListener('change', function () { colorMode = colorSel.value; if (sel && (sel.type === 'legend' || sel.type === 'flow')) sel = null; render(); syncUrl(); });
  orderSel.addEventListener('change', function () { orderMode = orderSel.value; manual = {}; render(); syncUrl(); });
  function syncUrl() {
    if (THUMB) return;
    var p = new URLSearchParams();
    p.set('cols', cols.join(','));
    if (colorMode !== 'first') p.set('color', colorMode);
    if (orderMode !== 'cross') p.set('order', orderMode);
    try { history.replaceState(null, '', location.pathname + '?' + p.toString() + location.hash); } catch (e) { /* ignore */ }
  }

  // ---- Search / trace ------------------------------------------------------

  var index = [];
  var resIdx = -1, resItems = [];
  function search(q) {
    q = norm(q).trim();
    if (!q) return [];
    var terms = q.split(/\s+/);
    var hits = [];
    for (var i = 0; i < index.length && hits.length < 200; i++) {
      var s = index[i].s, ok = true;
      for (var t = 0; t < terms.length; t++) if (s.indexOf(terms[t]) < 0) { ok = false; break; }
      if (ok) hits.push({ i: i, score: (index[i].t.indexOf(q) === 0 ? 0 : index[i].t.indexOf(q) >= 0 ? 1 : 2) });
    }
    hits.sort(function (a, b) { return a.score - b.score || natCompare(books[a.i].t, books[b.i].t); });
    return hits.slice(0, 8).map(function (h) { return h.i; });
  }
  function showResults(ids) {
    resultsEl.innerHTML = ''; resItems = []; resIdx = -1;
    if (!ids.length) { resultsEl.classList.remove('show'); return; }
    ids.forEach(function (i) {
      var b = books[i];
      var btn = el('button', null, '');
      btn.setAttribute('role', 'option');
      btn.innerHTML = esc(b.t) + ' <span class="m">' + esc([b.a, b.y != null ? b.y : ''].filter(Boolean).join(' · ')) + '</span>';
      btn.addEventListener('click', function () { traceBook(i); });
      resultsEl.appendChild(btn); resItems.push(btn);
    });
    resultsEl.classList.add('show');
  }
  searchEl.addEventListener('input', function () { showResults(search(searchEl.value)); });
  searchEl.addEventListener('focus', function () { if (searchEl.value) showResults(search(searchEl.value)); });
  searchEl.addEventListener('keydown', function (ev) {
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      if (!resItems.length) return;
      resIdx = (resIdx + (ev.key === 'ArrowDown' ? 1 : -1) + resItems.length) % resItems.length;
      resItems.forEach(function (b, i) { b.classList.toggle('sel', i === resIdx); });
      ev.preventDefault();
    } else if (ev.key === 'Enter') {
      if (resItems.length) resItems[Math.max(0, resIdx)].click();
      ev.preventDefault();
    } else if (ev.key === 'Escape') { resultsEl.classList.remove('show'); searchEl.blur(); }
  });
  document.addEventListener('click', function (ev) { if (!ev.target.closest('#search-wrap')) resultsEl.classList.remove('show'); });
  function traceBook(i) {
    resultsEl.classList.remove('show');
    searchEl.value = books[i].t;
    sel = { type: 'book', idx: i };
    hover = null;
    applyHighlight(); renderPanel(); renderLegend(); markMatrix();
    if (window.innerWidth < 1000) document.getElementById('panel').scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'nearest' });
  }

  // ---- Export --------------------------------------------------------------

  function svgText() {
    var c = svg.cloneNode(true);
    c.setAttribute('xmlns', SVGNS);
    c.setAttribute('width', W); c.setAttribute('height', H);
    c.setAttribute('font-family', 'system-ui, -apple-system, Segoe UI, Helvetica, Arial, Hiragino Sans, Yu Gothic, Noto Sans CJK JP, sans-serif');
    var bg = c.querySelector('rect[data-bg]'); bg.setAttribute('fill-opacity', '1');
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(c);
  }
  function download(blob, name) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  }
  function exportName(ext) { return 'library-flows-' + cols.join('-') + '.' + ext; }
  document.getElementById('btn-svg').addEventListener('click', function () {
    download(new Blob([svgText()], { type: 'image/svg+xml;charset=utf-8' }), exportName('svg'));
  });
  document.getElementById('btn-png').addEventListener('click', function () {
    var img = new Image();
    var url = URL.createObjectURL(new Blob([svgText()], { type: 'image/svg+xml;charset=utf-8' }));
    img.onload = function () {
      var k = 2, cv = document.createElement('canvas');
      cv.width = W * k; cv.height = H * k;
      var ctx = cv.getContext('2d');
      ctx.fillStyle = '#0c1118'; ctx.fillRect(0, 0, cv.width, cv.height);
      ctx.drawImage(img, 0, 0, cv.width, cv.height);
      URL.revokeObjectURL(url);
      cv.toBlob(function (blob) { if (blob) download(blob, exportName('png')); }, 'image/png');
    };
    img.onerror = function () { URL.revokeObjectURL(url); statusEl.textContent = 'PNG export failed in this browser; try SVG.'; statusEl.style.display = ''; setTimeout(function () { statusEl.style.display = 'none'; }, 3000); };
    img.src = url;
  });

  // ---- Sizing --------------------------------------------------------------

  function measure() {
    if (THUMB) { W = window.innerWidth; H = window.innerHeight; leftM = 190; rightM = 190; return; }
    var avail = wrap.clientWidth;
    W = Math.max(760, avail);
    H = clamp(Math.round(window.innerHeight - 250), 500, 740);
    leftM = rightM = W < 900 ? 150 : cols.length >= 5 ? 150 : 176;
    wrap.classList.toggle('scroll', W > avail + 2);
  }
  var resizeRaf = 0;
  window.addEventListener('resize', function () {
    if (resizeRaf) cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(function () {
      resizeRaf = 0;
      if (!books.length) return;
      var w = W, h = H; measure();
      if (W !== w || H !== h) { render({ instant: true, keepPanel: true, skipMatrix: true }); if (THUMB) thumbState(); }
    });
  });

  // ---- Boot ----------------------------------------------------------------

  function readUrl() {
    var c = (params.get('cols') || '').split(',').filter(function (id) { return FACETS[id]; });
    c = c.filter(function (id, i) { return c.indexOf(id) === i; }).slice(0, 6);
    if (c.length >= 2) cols = c;
    if (params.get('color') === 'genre') colorMode = 'genre';
    if (['cross', 'size', 'natural'].indexOf(params.get('order')) >= 0) orderMode = params.get('order');
    colorSel.value = colorMode; orderSel.value = orderMode;
  }

  function thumbState() {
    // the biggest ribbon, hovered, with its tooltip pinned beside it
    var fl = L.flows[0];
    if (!fl) return;
    hover = { flow: fl }; applyHighlight();
    var s = fl.segs[Math.min(1, fl.segs.length - 1)];
    var r = svg.getBoundingClientRect();
    var x = r.left + (s.x0 + s.x1) / 2 * r.width / W, y = r.top + Math.min(s.sy, s.ty) * r.height / H;
    showTip(flowTip(fl), x - 60, y, true);
  }

  fetch(DATA_URL).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }).then(function (data) {
    books = data.books || [];
    books.forEach(function (b, i) { index.push({ t: norm(b.t), s: norm(b.t + ' ' + b.a + ' ' + (AUTHOR_ALIAS[b.a] || '')) }); });
    FACET_IDS.forEach(prepareFacet);
    readUrl();
    statusEl.style.display = 'none';
    measure();
    renderChips();
    render({ instant: true });
    if (THUMB) requestAnimationFrame(thumbState);
    else {
      syncUrl();
      var want = params.get('book');
      if (want) books.some(function (b, i) { if (b.id === want) { traceBook(i); return true; } return false; });
    }
  }).catch(function (err) {
    statusEl.textContent = 'Could not load the catalogue (' + err.message + '). The diagram needs assets/data/library.json from the site.';
  });
})();
