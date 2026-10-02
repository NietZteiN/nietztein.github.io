/* Stacks — world generator.
   Turns library.json into a grid map: one aisle per bookcase unit, one wall
   face per shelf, and a deterministic book layout (spine widths, heights,
   colours) for each shelf. Pure data; no DOM. Also runs under Node. */
(function (root) {
  'use strict';

  var CELL_PX = 256;        // texture pixels per wall cell (both axes)
  var BOOKS_PER_CELL = 10;  // target density
  var MIN_LEN = 4, MAX_LEN = 17;
  var FLOOR_Y = 222;        // where spines stand, in texture px
  var MARGIN = 8;

  var SHORT = {
    'Religion & theology': 'Religion', 'Psychology, self-help & business': 'Self-help',
    'Art & visual culture': 'Art', 'Math, CS & engineering': 'Math & CS',
    'Language study & reference': 'Languages', 'Manga & comics': 'Manga',
    'Literature (English & European)': 'Literature', 'Society, culture & ideas': 'Society',
    'Magazines & catalogues': 'Magazines', 'History & biography': 'History',
    'Philosophy & political theory': 'Philosophy', 'Light novels': 'Light novels',
    'Japanese literature': 'Japanese lit.', 'Politics, law & current affairs': 'Politics',
    'Occult & folklore': 'Occult', 'Writing, film & literary craft': 'Craft & film',
    'Music & opera': 'Music', 'Science': 'Science', 'Test prep & study guides': 'Test prep',
    'Games & other objects': 'Games', 'Nursing & medical': 'Medicine', 'Unidentified': 'Misc'
  };

  function hash(str) {
    var h = 2166136261 >>> 0;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995) >>> 0; h ^= h >>> 15;
    return h >>> 0;
  }
  function unit01(h, k) { return (((h >>> (k * 5)) ^ (h << ((k * 7) % 31))) >>> 0 & 1023) / 1023; }
  function shortGenre(g) { return SHORT[g] || String(g || 'Misc').split(/[(,&]/)[0].trim(); }

  function hsl(h, s, l) {
    h = ((h % 360) + 360) % 360 / 360;
    var q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    function f(t) { t = (t + 1) % 1; if (t < 1 / 6) return p + (q - p) * 6 * t; if (t < 0.5) return q; if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6; return p; }
    return [Math.round(f(h + 1 / 3) * 255), Math.round(f(h) * 255), Math.round(f(h - 1 / 3) * 255)];
  }
  function hasCJK(s) { return /[　-ヿ㐀-鿿＀-￯]/.test(s); }

  // ---- per-book spine geometry (deterministic) ----
  function spineSpec(b) {
    var h = hash(b.id + '|' + b.t);
    var ty = b.ty || '';
    var wBase = 30, hBase = 0.62;
    if (/Manga/.test(ty)) { wBase = 22; hBase = 0.5; }
    else if (/Light novel/.test(ty)) { wBase = 24; hBase = 0.5; }
    else if (/Comics|Picture/.test(ty)) { wBase = 26; hBase = 0.78; }
    else if (/Magazine|Calendar|Documents/.test(ty)) { wBase = 16; hBase = 0.82; }
    else if (/Poetry|Drama|Essays/.test(ty)) { wBase = 22; hBase = 0.6; }
    else if (/Textbook|Technical|Math journal/.test(ty)) { wBase = 46; hBase = 0.78; }
    else if (/Reference|Anthology|Hymnal/.test(ty)) { wBase = 44; hBase = 0.72; }
    else if (/^Art$/.test(ty)) { wBase = 40; hBase = 0.86; }
    else if (/History|Biography|Philosophy|Religion|Politics/.test(ty)) { wBase = 34; hBase = 0.66; }
    var dl = Math.min((b.d || '').length, 260) / 260;
    var w = (wBase + dl * 14 + (unit01(h, 1) - 0.5) * 8) * (CELL_PX / 384);
    var hgt = hBase + (unit01(h, 2) - 0.5) * 0.12;
    var gh = hash(b.g || 'Misc');
    var hue = gh % 360;
    var ps = unit01(h, 3), pl = unit01(h, 4);
    var style = 'cloth';
    var r = unit01(h, 5);
    if (r < 0.09) style = 'cream';           // pale paperback
    else if (r < 0.17) style = 'black';
    else if (r < 0.25) style = 'white';
    var gloss = unit01(h, 6) < 0.09 ? (unit01(h, 7) < 0.6 ? 'gold' : 'silver') : null;
    var band = unit01(h, 8) < 0.3;
    var sat = 0.3 + ps * 0.35, lig = 0.26 + pl * 0.22;
    var hueVar = hue + (unit01(h, 9) - 0.5) * 36;
    var rgb;
    if (style === 'cream') rgb = hsl(40 + (unit01(h, 9) - 0.5) * 20, 0.35, 0.82);
    else if (style === 'black') rgb = hsl(hueVar, 0.15, 0.09 + pl * 0.06);
    else if (style === 'white') rgb = hsl(hueVar, 0.12, 0.86);
    else rgb = hsl(hueVar, sat, lig);
    var dark = style === 'cream' || style === 'white';
    var ink = dark ? [40, 32, 28] : (gloss === 'gold' ? [242, 206, 110] : gloss === 'silver' ? [230, 232, 238] : [236, 228, 210]);
    return {
      w: Math.max(10, Math.min(44, Math.round(w))), h: Math.max(0.42, Math.min(0.9, hgt)),
      rgb: rgb, ink: ink, style: style, gloss: gloss, band: band, cjk: hasCJK(b.t || ''),
      bandRGB: hsl(hue + 180 + (unit01(h, 10) - 0.5) * 60, 0.45, dark ? 0.35 : 0.72)
    };
  }

  function layoutShelf(shelf, catWanted) {
    var span = shelf.cells * CELL_PX;
    var specs = shelf.books.map(spineSpec);
    var total = 0, i;
    for (i = 0; i < specs.length; i++) total += specs[i].w + 1;
    var avail = span - MARGIN * 2 - (catWanted ? 70 : 0);
    var scale = 1;
    if (total > avail) scale = avail / total;
    var x = MARGIN, items = [];
    for (i = 0; i < specs.length; i++) {
      var w = Math.max(6, Math.floor(specs[i].w * scale));
      items.push({ book: shelf.books[i], x: x, w: w, hpx: Math.round(specs[i].h * (FLOOR_Y - 26)), spec: specs[i] });
      x += w + 1;
    }
    shelf.layout = items;
    shelf.texW = span;
    shelf.leftover = span - MARGIN - x;
    shelf.cat = !!catWanted;
    return shelf;
  }

  function build(books) {
    // group by unit, then shelf (keep data order)
    var unitOrder = [], unitMap = {};
    books.forEach(function (b) {
      var u = b.u || '?';
      if (!unitMap[u]) { unitMap[u] = { name: u, shelves: [], shelfMap: {}, genres: {}, count: 0 }; unitOrder.push(u); }
      var U = unitMap[u];
      var s = b.s || '?';
      if (!U.shelfMap[s]) { U.shelfMap[s] = { unit: u, name: s, books: [] }; U.shelves.push(U.shelfMap[s]); }
      U.shelfMap[s].books.push(b);
      U.genres[b.g || 'Misc'] = (U.genres[b.g || 'Misc'] || 0) + 1;
      U.count++;
    });
    unitOrder.sort(function (a, b) {
      var la = a.length === 1, lb = b.length === 1;
      if (la !== lb) return la ? -1 : 1; return a < b ? -1 : a > b ? 1 : 0;
    });
    var units = unitOrder.map(function (u) { return unitMap[u]; });

    // cells per shelf, split into two sides of an aisle
    var shelves = [], aisles = [];
    units.forEach(function (U, ui) {
      U.shelves.forEach(function (sh) {
        sh.books.sort(function (a, b) { return (a.p || 0) - (b.p || 0); });
        sh.cells = Math.max(1, Math.ceil(sh.books.length / BOOKS_PER_CELL));
      });
      var total = U.shelves.reduce(function (a, s) { return a + s.cells; }, 0);
      var L = Math.max(MIN_LEN, Math.min(MAX_LEN, Math.ceil(total / 2)));
      // greedy split: left side takes shelves until it would exceed L
      var left = [], right = [], acc = 0;
      U.shelves.forEach(function (sh) {
        if (acc + sh.cells <= L && right.length === 0) { left.push(sh); acc += sh.cells; } else right.push(sh);
      });
      function fit(side) {
        var sum = side.reduce(function (a, s) { return a + s.cells; }, 0);
        if (!side.length) return;
        if (sum > L) { // compress proportionally
          var f = L / sum; side.forEach(function (s) { s.cells = Math.max(1, Math.floor(s.cells * f)); });
          sum = side.reduce(function (a, s) { return a + s.cells; }, 0);
          while (sum > L) { var big = side.reduce(function (m, s) { return s.cells > m.cells ? s : m; }); big.cells--; sum--; }
        }
        while (sum < L) { // stretch: give the densest shelf another cell while it stays reasonably full
          var dens = side.reduce(function (m, s) { return (s.books.length / s.cells) > (m.books.length / m.cells) ? s : m; });
          if (dens.books.length / (dens.cells + 1) < 6) break;
          dens.cells++; sum++;
        }
      }
      fit(left); fit(right);
      var gl = Object.keys(U.genres).sort(function (a, b) { return U.genres[b] - U.genres[a]; });
      aisles.push({ unit: U.name, index: ui, len: L, left: left, right: right, count: U.count,
        genres: gl.slice(0, 3).map(shortGenre), topGenre: gl[0] || 'Misc', shelfCount: U.shelves.length });
      left.concat(right).forEach(function (s) { s.aisle = ui; shelves.push(s); });
    });

    // cat: the shelf with the most spare room after layout (forced on the roomiest)
    shelves.forEach(function (s) { layoutShelf(s, false); });
    var catShelf = null;
    shelves.forEach(function (s) { if (!catShelf || s.leftover > catShelf.leftover) catShelf = s; });
    if (catShelf) layoutShelf(catShelf, true);

    // ---- grid ----
    var n = aisles.length;
    var W = 2 * n + 3, maxL = aisles.reduce(function (m, a) { return Math.max(m, a.len); }, 0);
    var H = 3 + maxL + 2;
    var grid = new Uint8Array(W * H);
    grid.fill(1);
    var faces = new Int32Array(W * H * 4); faces.fill(-1);
    var faceList = [];
    function addFace(x, y, dir, f) { f.x = x; f.y = y; f.dir = dir; faceList.push(f); faces[(y * W + x) * 4 + dir] = faceList.length - 1; }
    // hall rows y=1,2 from x=1..W-2
    var x, y;
    for (y = 1; y <= 2; y++) for (x = 1; x <= W - 2; x++) grid[y * W + x] = 0;
    aisles.forEach(function (a, i) {
      a.x = 2 + 2 * i; a.y0 = 3; a.y1 = 3 + a.len - 1;
      for (y = a.y0; y <= a.y1; y++) grid[y * W + a.x] = 0;
      // left side = east faces (dir 1) of cells at x-1, viewer looks west; left-to-right = south -> north
      var yy = a.y0;
      a.left.forEach(function (sh) {
        sh.side = 'left'; sh.cy0 = yy; sh.cy1 = yy + sh.cells - 1; sh.x = a.x - 1;
        for (var k = 0; k < sh.cells; k++) addFace(a.x - 1, yy + k, 1, { kind: 'shelf', shelf: sh, span: sh.cells, idx: sh.cells - 1 - k, aisle: i });
        yy += sh.cells;
      });
      for (; yy <= a.y1; yy++) addFace(a.x - 1, yy, 1, { kind: 'empty', aisle: i, seed: hash(a.unit + 'L' + yy) });
      // right side = west faces (dir 3) of cells at x+1, viewer looks east; left-to-right = north -> south
      yy = a.y0;
      a.right.forEach(function (sh) {
        sh.side = 'right'; sh.cy0 = yy; sh.cy1 = yy + sh.cells - 1; sh.x = a.x + 1;
        for (var k = 0; k < sh.cells; k++) addFace(a.x + 1, yy + k, 3, { kind: 'shelf', shelf: sh, span: sh.cells, idx: k, aisle: i });
        yy += sh.cells;
      });
      for (; yy <= a.y1; yy++) addFace(a.x + 1, yy, 3, { kind: 'empty', aisle: i, seed: hash(a.unit + 'R' + yy) });
      // end wall sign (north face of the cell past the end)
      addFace(a.x, a.y1 + 1, 0, { kind: 'sign', aisle: i, unit: a.unit, genres: a.genres, count: a.count, shelfCount: a.shelfCount });
    });
    // plaques on the hall-facing end caps
    for (var i = 0; i <= n; i++) {
      var bx = 1 + 2 * i;
      var leftUnit = i > 0 ? aisles[i - 1].unit : null, rightUnit = i < n ? aisles[i].unit : null;
      addFace(bx, 3, 0, { kind: 'plaque', left: leftUnit, right: rightUnit });
    }

    // lamps
    var lamps = [];
    aisles.forEach(function (a) { for (y = a.y0 + 2; y <= a.y1; y += 3) lamps.push({ x: a.x + 0.5, y: y + 0.5, aisle: a.index }); });
    for (x = 2; x <= W - 2; x += 3) lamps.push({ x: x + 0.5, y: 2.0, aisle: -1 });

    // sprites: reading chairs in the hall, in front of the end caps
    var sprites = [];
    for (var i2 = 2; i2 < n; i2 += 3) sprites.push({ type: 'chair', x: 1 + 2 * i2 + 0.5, y: 1.42, flip: (i2 & 1) === 1 });
    sprites.push({ type: 'plant', x: 1.5, y: 1.5 });
    sprites.push({ type: 'plant', x: W - 1.5, y: 1.5 });

    // book lookup
    var bookLoc = {};
    shelves.forEach(function (s, si) { s.index = si; s.layout.forEach(function (it, li) { bookLoc[it.book.id] = { shelf: si, item: li }; }); });

    // spawn + photogenic spot: the longest aisle
    var longest = aisles.reduce(function (m, a) { return a.len > m.len ? a : m; });
    var spawn = { x: aisles[0].x + 0.6, y: 2.1, a: 0 };
    var thumb = { x: longest.x + 0.5, y: longest.y0 + 0.7, a: Math.PI / 2 };

    return { W: W, H: H, grid: grid, faces: faces, faceList: faceList, shelves: shelves, aisles: aisles,
      lamps: lamps, sprites: sprites, bookLoc: bookLoc, spawn: spawn, thumb: thumb, units: units,
      CELL_PX: CELL_PX, FLOOR_Y: FLOOR_Y };
  }

  // Where to stand to face a book squarely: returns {x, y, a} in map units.
  function standAt(world, bookId) {
    var loc = world.bookLoc[bookId]; if (!loc) return null;
    var sh = world.shelves[loc.shelf], it = sh.layout[loc.item];
    var U = (it.x + it.w / 2) / sh.texW;          // 0..1 left-to-right as the viewer sees it
    var n = sh.cells, idx = Math.floor(U * n), frac = U * n - idx;
    if (idx >= n) { idx = n - 1; frac = 1; }
    var a = world.aisles[sh.aisle];
    if (sh.side === 'left') return { x: a.x + 0.73, y: (sh.cy1 - idx) + (1 - frac), a: Math.PI, shelf: sh, item: it };
    return { x: a.x + 0.27, y: sh.cy0 + idx + frac, a: 0, shelf: sh, item: it };
  }

  var api = { build: build, standAt: standAt, hash: hash, shortGenre: shortGenre, CELL_PX: CELL_PX, FLOOR_Y: FLOOR_Y, MARGIN: MARGIN };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.StacksWorld = api;
})(typeof window !== 'undefined' ? window : globalThis);
