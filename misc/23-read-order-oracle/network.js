/*
 * Read-Order Oracle: the transit network.
 *
 * Pure logic, no DOM. Runs in the page (window.Network) and in Node
 * (require('./network.js')) so the whole build can be tested on the real
 * catalogue with timings. It relies on Oracle (oracle.js) for TF-IDF,
 * similarity and the similarity tour.
 *
 * Pipeline (buildNetwork):
 *   1. assignLines     22 genres -> 12 named lines with codes.
 *   2. orderLine       stations along each line = similarity tour within the line.
 *   3. findInterchanges cross-line pairs with high description similarity.
 *   4. embed           2-D force-directed embedding (PCA start, deterministic).
 *   5. schematic       octilinear routing of each line on a coarse grid; interchange
 *                      pairs merged into one station where the geometry allows,
 *                      otherwise joined by a short walking link.
 *   6. verify          the constraints the map promises (gaps, continuity, octilinearity).
 * Plus journey (Dijkstra with a change penalty) and placeLabels (greedy label
 * collision avoidance shared by the renderer and the tests).
 */
(function (root) {
  'use strict';

  var Oracle = root.Oracle || (typeof require === 'function' ? require('./oracle.js') : null);

  /* ---------- 1. Lines ---------- */

  /*
   * Fixed line definitions. Big genres are lines of their own; small genres ride
   * on the line whose books they are closest to, named so the merge is obvious.
   * Genres not listed here (Magazines, Games, Unidentified) are attached to the
   * line their books are most similar to, decided from the data in assignLines.
   */
  var LINE_DEFS = [
    { code: 'LIT', name: 'Fiction', genres: ['Literature (English & European)'] },
    { code: 'POE', name: 'Poetry & Drama', genres: [], types: { 'Literature (English & European)': ['Anthology', 'Poetry', 'Drama'] } },
    { code: 'MAN', name: 'Manga & Comics', genres: ['Manga & comics'] },
    { code: 'JPN', name: 'Japanese Literature', genres: ['Japanese literature', 'Light novels'] },
    { code: 'CRA', name: 'Writing & Film', genres: ['Writing, film & literary craft'] },
    { code: 'SCI', name: 'Science & Medicine', genres: ['Science', 'Math, CS & engineering', 'Nursing & medical'] },
    { code: 'LNG', name: 'Language & Study', genres: ['Language study & reference', 'Test prep & study guides'] },
    { code: 'ART', name: 'Art & Music', genres: ['Art & visual culture', 'Music & opera'] },
    { code: 'HIS', name: 'History & Biography', genres: ['History & biography'] },
    { code: 'PSY', name: 'Mind & Business', genres: ['Psychology, self-help & business'] },
    { code: 'PHI', name: 'Philosophy & Society', genres: ['Philosophy & political theory', 'Society, culture & ideas', 'Politics, law & current affairs'] },
    { code: 'REL', name: 'Religion & Folklore', genres: ['Religion & theology', 'Occult & folklore'] }
  ];

  /*
   * Assign every book to a line. Returns { lines, lineOf } where lines[i] =
   * { code, name, genres, members: [book indices] } and lineOf[book] = line index.
   * Unlisted genres go, as a group, to the line with the highest mean raw
   * similarity to their books (so the merge is data-driven but explainable).
   */
  function assignLines(books, vec) {
    var n = books.length, lines = LINE_DEFS.map(function (d) {
      return { code: d.code, name: d.name, genres: d.genres.slice(), types: d.types || null, members: [] };
    });
    var genreLine = {}, typeLine = {};
    lines.forEach(function (L, li) {
      L.genres.forEach(function (g) { genreLine[g] = li; });
      if (L.types) Object.keys(L.types).forEach(function (g) { L.types[g].forEach(function (ty) { typeLine[g + '|' + ty] = li; }); });
    });
    var lineOf = new Int32Array(n).fill(-1), leftovers = {};
    for (var i = 0; i < n; i++) {
      var li = typeLine[books[i].g + '|' + books[i].ty];
      if (li === undefined) li = genreLine[books[i].g];
      if (li === undefined) { (leftovers[books[i].g] = leftovers[books[i].g] || []).push(i); }
      else lineOf[i] = li;
    }
    Object.keys(leftovers).sort().forEach(function (g) {
      var idx = leftovers[g], sums = new Float64Array(lines.length), counts = new Float64Array(lines.length);
      for (var a = 0; a < idx.length; a++) for (var j = 0; j < n; j++) {
        if (lineOf[j] < 0) continue;
        sums[lineOf[j]] += Oracle.dot(vec.docs[idx[a]], vec.docs[j]); counts[lineOf[j]]++;
      }
      var best = 0, bs = -1;
      for (var l = 0; l < lines.length; l++) { var m = counts[l] ? sums[l] / counts[l] : 0; if (m > bs) { bs = m; best = l; } }
      lines[best].genres.push(g);
      for (a = 0; a < idx.length; a++) lineOf[idx[a]] = best;
    });
    for (i = 0; i < n; i++) lines[lineOf[i]].members.push(i);
    // a small catalogue (the sample fallback) may leave some lines empty: drop them
    var keep = lines.filter(function (L) { return L.members.length > 0; }), remap = {};
    lines.forEach(function (L, li) { remap[li] = keep.indexOf(L); });
    for (i = 0; i < n; i++) lineOf[i] = remap[lineOf[i]];
    return { lines: keep, lineOf: lineOf };
  }

  /* ---------- 2. Station order within a line ---------- */

  /*
   * Order the members of one line so that consecutive stops are related: a
   * similarity tour on the sub-matrix (greedy + 2-opt from Oracle.tour), started
   * from the member with the weakest ties (a natural terminus), keeping the
   * better of that and a second start from the far end of the first tour.
   */
  function orderLine(S, n, members) {
    var m = members.length;
    if (m <= 2) return members.slice();
    var sub = new Float32Array(m * m);
    for (var i = 0; i < m; i++) for (var j = 0; j < m; j++) sub[i * m + j] = S[members[i] * n + members[j]];
    var weakest = 0, ws = Infinity;
    for (i = 0; i < m; i++) { var s = 0; for (j = 0; j < m; j++) s += sub[i * m + j]; if (s < ws) { ws = s; weakest = i; } }
    var t1 = Oracle.tour(sub, m, weakest, { maxPasses: 40, timeMs: 400 });
    var t2 = Oracle.tour(sub, m, t1.path[m - 1], { maxPasses: 40, timeMs: 400 });
    var best = t2.total > t1.total ? t2 : t1;
    var out = new Array(m);
    for (i = 0; i < m; i++) out[i] = members[best.path[i]];
    return out;
  }

  /* ---------- 3. Interchanges ---------- */

  /*
   * Cross-line pairs with high raw description similarity (no genre bonus, so a
   * shared genre cannot manufacture a link). Top K by similarity above minSim,
   * each book in at most one pair, and no two pairs joining the same two line
   * segments within `spread` stops of each other (spreads the interchanges out).
   */
  function findInterchanges(vec, lineOf, posInLine, K, minSim, spread) {
    var n = lineOf.length, cand = [];
    for (var i = 0; i < n; i++) for (var j = i + 1; j < n; j++) {
      if (lineOf[i] === lineOf[j]) continue;
      var s = Oracle.dot(vec.docs[i], vec.docs[j]);
      if (s >= minSim) cand.push({ a: i, b: j, sim: s });
    }
    cand.sort(function (x, y) { return y.sim - x.sim; });
    var used = new Uint8Array(n), out = [], taken = [];
    for (var c = 0; c < cand.length && out.length < K; c++) {
      var p = cand[c];
      if (used[p.a] || used[p.b]) continue;
      var clash = false;
      for (var t = 0; t < taken.length && !clash; t++) {
        var q = taken[t];
        clash = (lineOf[q.a] === lineOf[p.a] && lineOf[q.b] === lineOf[p.b] && Math.abs(posInLine[q.a] - posInLine[p.a]) < spread && Math.abs(posInLine[q.b] - posInLine[p.b]) < spread) ||
                (lineOf[q.a] === lineOf[p.b] && lineOf[q.b] === lineOf[p.a] && Math.abs(posInLine[q.a] - posInLine[p.b]) < spread && Math.abs(posInLine[q.b] - posInLine[p.a]) < spread);
      }
      if (clash) continue;
      used[p.a] = 1; used[p.b] = 1; out.push(p); taken.push(p);
    }
    return out;
  }

  /* ---------- 4. Embedding ---------- */

  /* Top-2 principal components of the TF-IDF matrix by power iteration (deterministic). */
  function pca2(vec, n) {
    var T = vec.terms.length, comps = [], coords = [new Float64Array(n), new Float64Array(n)];
    function mulXt(y) { var v = new Float64Array(T); for (var i = 0; i < n; i++) { var d = vec.docs[i]; for (var k = 0; k < d.ids.length; k++) v[d.ids[k]] += d.w[k] * y[i]; } return v; }
    function mulX(v) { var y = new Float64Array(n); for (var i = 0; i < n; i++) { var d = vec.docs[i], s = 0; for (var k = 0; k < d.ids.length; k++) s += d.w[k] * v[d.ids[k]]; y[i] = s; } return y; }
    var rnd = Oracle.seeded(20260925);
    for (var c = 0; c < 2; c++) {
      var v = new Float64Array(T);
      for (var t = 0; t < T; t++) v[t] = rnd() - 0.5;
      for (var it = 0; it < 40; it++) {
        var y = mulX(v);
        // remove the mean (centre) and the previous component
        var mean = 0; for (var i = 0; i < n; i++) mean += y[i]; mean /= n;
        for (i = 0; i < n; i++) y[i] -= mean;
        if (c === 1) { var dp = 0, nn = 0; for (i = 0; i < n; i++) { dp += y[i] * coords[0][i]; nn += coords[0][i] * coords[0][i]; } for (i = 0; i < n; i++) y[i] -= coords[0][i] * dp / (nn || 1); }
        v = mulXt(y);
        var norm = 0; for (t = 0; t < T; t++) norm += v[t] * v[t]; norm = Math.sqrt(norm) || 1;
        for (t = 0; t < T; t++) v[t] /= norm;
      }
      y = mulX(v); mean = 0; for (i = 0; i < n; i++) mean += y[i]; mean /= n;
      for (i = 0; i < n; i++) coords[c][i] = y[i] - mean;
      comps.push(v);
    }
    return coords;
  }

  function rank(arr) { var idx = Array.from(arr, function (v, i) { return i; }).sort(function (a, b) { return arr[a] - arr[b]; }), r = new Float64Array(arr.length); idx.forEach(function (i, k) { r[i] = k; }); return r; }

  /*
   * Force-directed layout of the network graph: chain edges pull consecutive
   * stations to unit distance, interchange pairs pull tightly together, k-NN
   * edges pull weakly, and every pair repels. PCA initialisation, fixed
   * iteration count, no randomness beyond the seeded PCA start: deterministic.
   */
  /* Cells per station along a line: long lines are packed tighter than short ones. */
  function lineSpacing(m) { return Math.max(1.0, Math.min(2.0, 100 / m)); }

  /*
   * Force-directed layout of the network graph in map units (1 = one grid cell):
   * chain springs hold consecutive stations at the line's spacing, interchange
   * pairs are pulled tightly together, k-NN pairs weakly, every pair repels, and
   * every 25 iterations each chain is blended toward its own low-order
   * polynomial fit, so lines settle as gentle curves (the corridors the
   * schematic step then routes) while still meeting at their interchanges.
   * PCA initialisation and fixed iteration counts: deterministic.
   */
  function embed(n, chains, inters, knn, vec, opts) {
    opts = opts || {};
    var iters = opts.iters || 300, pc = pca2(vec, n);
    var x = new Float64Array(n), y = new Float64Array(n);
    // PCA of TF-IDF is heavy-tailed (a few clusters dominate), so the start uses the
    // rank of each coordinate: same ordering, spread evenly over a square.
    var side = Math.sqrt(n) * 2.4, rnd = Oracle.seeded(7), i;
    var rx = rank(pc[0]), ry = rank(pc[1]);
    for (i = 0; i < n; i++) { x[i] = (rx[i] / n - 0.5) * side + (rnd() - 0.5) * 0.5; y[i] = (ry[i] / n - 0.5) * side + (rnd() - 0.5) * 0.5; }
    var edges = [];
    chains.forEach(function (ch) { var sp = lineSpacing(ch.length); for (var k = 1; k < ch.length; k++) edges.push([ch[k - 1], ch[k], sp, 1.0]); });
    inters.forEach(function (p) { edges.push([p.a, p.b, 0.3, 4.0]); });
    for (i = 0; i < n; i++) for (var q = 0; q < knn[i].length; q++) edges.push([i, knn[i][q], 2.0, 0.03]);
    var dx = new Float64Array(n), dy = new Float64Array(n);
    function blend(strength) {
      chains.forEach(function (ch) {
        var deg = ch.length > 70 ? 3 : 2;   // short lines: one gentle bend; long lines may make an S
        var fx = polyFit(ch.map(function (b) { return x[b]; }), deg), fy = polyFit(ch.map(function (b) { return y[b]; }), deg);
        for (var k = 0; k < ch.length; k++) { x[ch[k]] += (fx[k] - x[ch[k]]) * strength; y[ch[k]] += (fy[k] - y[ch[k]]) * strength; }
      });
    }
    for (var it = 0; it < iters; it++) {
      var temp = 1.5 * (1 - it / iters) + 0.05;
      dx.fill(0); dy.fill(0);
      // repulsion (all pairs, capped range)
      for (i = 0; i < n; i++) for (var j = i + 1; j < n; j++) {
        var ex = x[i] - x[j], ey = y[i] - y[j], d2 = ex * ex + ey * ey + 0.01;
        if (d2 > 49) continue;
        var f = 3.0 / d2;
        dx[i] += ex * f; dy[i] += ey * f; dx[j] -= ex * f; dy[j] -= ey * f;
      }
      // a little gravity toward the centre: lines sweep through the middle and cross,
      // as on a real map, instead of drifting apart into parallel arcs
      var gx = 0, gy = 0;
      for (i = 0; i < n; i++) { gx += x[i]; gy += y[i]; }
      gx /= n; gy /= n;
      for (i = 0; i < n; i++) { dx[i] += (gx - x[i]) * 0.05; dy[i] += (gy - y[i]) * 0.05; }
      // springs
      for (var e = 0; e < edges.length; e++) {
        var a = edges[e][0], b = edges[e][1], L = edges[e][2], w = edges[e][3];
        ex = x[b] - x[a]; ey = y[b] - y[a]; var d = Math.sqrt(ex * ex + ey * ey) + 1e-6;
        f = w * (d - L) / d * 0.5;
        dx[a] += ex * f; dy[a] += ey * f; dx[b] -= ex * f; dy[b] -= ey * f;
      }
      for (i = 0; i < n; i++) {
        d = Math.sqrt(dx[i] * dx[i] + dy[i] * dy[i]) || 1;
        var step = Math.min(d, temp);
        x[i] += dx[i] / d * step; y[i] += dy[i] / d * step;
      }
      if (it % 25 === 24) blend(it < iters - 30 ? 0.5 : 0.9);   // lines settle as gentle curves
    }
    return { x: x, y: y };
  }

  /* ---------- 5. Schematic (octilinear) layout ---------- */

  var DIRS = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  var DLEN = [1, 1.4142, 1, 1.4142, 1, 1.4142, 1, 1.4142];
  function turn(a, b) { if (a < 0 || b < 0) return 0; var t = Math.abs(a - b) % 8; return t > 4 ? 8 - t : t; } // 0..4 (x45 degrees)
  function dirIndex(ddx, ddy) { for (var k = 0; k < 8; k++) if (DIRS[k][0] === ddx && DIRS[k][1] === ddy) return k; return -1; }

  /* Binary min-heap on [priority, payload] pairs. */
  function Heap() { this.a = []; }
  Heap.prototype.push = function (p, v) { var a = this.a; a.push([p, v]); var i = a.length - 1; while (i > 0) { var j = (i - 1) >> 1; if (a[j][0] <= a[i][0]) break; var t = a[j]; a[j] = a[i]; a[i] = t; i = j; } };
  Heap.prototype.pop = function () { var a = this.a, top = a[0], last = a.pop(); if (a.length) { a[0] = last; var i = 0; for (;;) { var l = 2 * i + 1, r = l + 1, m = i; if (l < a.length && a[l][0] < a[m][0]) m = l; if (r < a.length && a[r][0] < a[m][0]) m = r; if (m === i) break; var t = a[m]; a[m] = a[i]; a[i] = t; i = m; } } return top; };
  Heap.prototype.size = function () { return this.a.length; };

  /* Fit values[k] ~ p(k/(m-1)) with a degree-`deg` polynomial (normal equations); return the fitted values. */
  function polyFit(values, deg) {
    var m = values.length, N = deg + 1, A = [], rhs = new Float64Array(N), i, j, k;
    for (i = 0; i < N; i++) { A.push(new Float64Array(N)); }
    for (k = 0; k < m; k++) {
      var u = m > 1 ? k / (m - 1) : 0, pw = [1];
      for (i = 1; i < 2 * N; i++) pw.push(pw[i - 1] * u);
      for (i = 0; i < N; i++) { rhs[i] += pw[i] * values[k]; for (j = 0; j < N; j++) A[i][j] += pw[i + j]; }
    }
    for (i = 0; i < N; i++) {
      var piv = i; for (j = i + 1; j < N; j++) if (Math.abs(A[j][i]) > Math.abs(A[piv][i])) piv = j;
      var tmp = A[i]; A[i] = A[piv]; A[piv] = tmp; var tr = rhs[i]; rhs[i] = rhs[piv]; rhs[piv] = tr;
      for (j = i + 1; j < N; j++) { var f = A[i][i] ? A[j][i] / A[i][i] : 0; for (k = i; k < N; k++) A[j][k] -= f * A[i][k]; rhs[j] -= f * rhs[i]; }
    }
    var coef = new Float64Array(N);
    for (i = N - 1; i >= 0; i--) { var s = rhs[i]; for (j = i + 1; j < N; j++) s -= A[i][j] * coef[j]; coef[i] = A[i][i] ? s / A[i][i] : 0; }
    var out = new Float64Array(m);
    for (k = 0; k < m; k++) { var uu = m > 1 ? k / (m - 1) : 0, v = 0, p = 1; for (i = 0; i < N; i++) { v += coef[i] * p; p *= uu; } out[k] = v; }
    return out;
  }

  /* Simplify a cell polyline: drop points that continue the previous direction. */
  function simplifyPath(pts) {
    if (pts.length < 3) return pts.slice();
    var out = [pts[0]];
    for (var i = 1; i < pts.length - 1; i++) {
      var a = out[out.length - 1], b = pts[i], c = pts[i + 1];
      var d1x = Math.sign(b[0] - a[0]), d1y = Math.sign(b[1] - a[1]), d2x = Math.sign(c[0] - b[0]), d2y = Math.sign(c[1] - b[1]);
      if (d1x !== d2x || d1y !== d2y) out.push(b);
    }
    out.push(pts[pts.length - 1]);
    return out;
  }

  /*
   * Route the lines on an integer grid, longest first, then choose the
   * interchanges where the drawn lines actually meet.
   *
   * Each line's corridor is its embedded chain (already a gentle curve).
   * Anchors along the corridor (the ends and one every few stations) are
   * joined by A* paths on the 8-direction grid with bend penalties, so a line
   * is one continuous octilinear polyline that crosses other lines only
   * properly (never runs along them, at most two lines per cell) and keeps
   * clear of their stations. Stations are then spread evenly along the path.
   *
   * Where two lines share a cell, the pair of nearby stations (one on each
   * line, within a few stops of the crossing) with the strongest description
   * similarity becomes the interchange, if it clears `minSim`: both stations
   * move onto the crossing cell, and the other stations of each line are
   * re-spread between their fixed points. So an interchange ring is always a
   * real crossing, and always a real textual link.
   */
  function schematic(chains, emb, seeds, sim, opts) {
    opts = opts || {};
    var n = emb.x.length, L = chains.length, i, k, s;
    var partner = new Int32Array(n).fill(-1), placed = new Uint8Array(n);
    seeds.forEach(function (p) { if (partner[p.a] < 0 && partner[p.b] < 0) { partner[p.a] = p.b; partner[p.b] = p.a; } });
    var lineOf = new Int32Array(n), posIn = new Int32Array(n);
    chains.forEach(function (ch, li) { ch.forEach(function (b, kk) { lineOf[b] = li; posIn[b] = kk; }); });

    // corridors in cells: the embedding is already in cell units; a global scale fixes
    // the systematic shrink of the polynomial blend so every line has room for its stops
    var factors = [];
    chains.forEach(function (ch) {
      var m = ch.length, arc = 0;
      for (k = 1; k < m; k++) arc += Math.hypot(emb.x[ch[k]] - emb.x[ch[k - 1]], emb.y[ch[k]] - emb.y[ch[k - 1]]);
      if (arc > 0 && m > 2) factors.push((m - 1) * lineSpacing(m) * 1.25 / arc);
    });
    factors.sort(function (a, b) { return a - b; });
    var scale = (factors[Math.floor(factors.length / 2)] || 1) * (opts.spacing || 1);
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (i = 0; i < n; i++) { minX = Math.min(minX, emb.x[i]); maxX = Math.max(maxX, emb.x[i]); minY = Math.min(minY, emb.y[i]); maxY = Math.max(maxY, emb.y[i]); }
    var PAD = 12, W = Math.ceil((maxX - minX) * scale) + 2 * PAD, H = Math.ceil((maxY - minY) * scale) + 2 * PAD;
    var tx = new Float64Array(n), ty = new Float64Array(n);
    for (i = 0; i < n; i++) { tx[i] = (emb.x[i] - minX) * scale + PAD; ty[i] = (emb.y[i] - minY) * scale + PAD; }

    // grid state
    var stationAt = new Int32Array(W * H).fill(-1);     // cell -> a station on it, -1 free
    var pathLine = new Int8Array(W * H).fill(-1);        // cell -> line whose path uses it (-1 none, -2 two lines)
    var pathDir = new Int8Array(W * H).fill(-1);         // direction of the first path through the cell
    var nearStation = new Uint8Array(W * H);             // stations (any line) in the 8-neighbourhood
    var nearPath = new Uint8Array(W * H);                // path cells (any line) in the 8-neighbourhood
    var usedSeg = new Set();                             // "a:b" segments already drawn
    function cid(x, y) { return y * W + x; }
    function inside(x, y) { return x >= 1 && y >= 1 && x < W - 1 && y < H - 1; }
    function octile(x0, y0, x1, y1) { var dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0); return Math.max(dx, dy) + 0.4142 * Math.min(dx, dy); }

    // A* with (cell, direction) states, generation-stamped scratch arrays
    var gScore = new Float64Array(W * H * 8), stamp = new Int32Array(W * H * 8), cameFrom = new Int32Array(W * H * 8), gen = 0;
    function astar(sx, sy, sdir, txc, tyc, li, allowTarget) {
      gen++;
      var heap = new Heap(), sc = cid(sx, sy), t = cid(txc, tyc);
      (sdir < 0 ? [0, 1, 2, 3, 4, 5, 6, 7] : [sdir]).forEach(function (d) { var st = sc * 8 + d; gScore[st] = 0; stamp[st] = gen; cameFrom[st] = -1; heap.push(octile(sx, sy, txc, tyc), st); });
      var expanded = 0, best = -1;
      while (heap.size()) {
        var cur = heap.pop(), st = cur[1], cell = (st / 8) | 0, d0 = st % 8;
        if (cell === t) { best = st; break; }
        if (++expanded > 250000) break;
        var x = cell % W, y = (cell / W) | 0, g0 = gScore[st];
        for (var d = 0; d < 8; d++) {
          var tr = turn(d0, d);
          if (tr >= 3) continue;                                     // no U-turns or 135-degree bends
          var nx = x + DIRS[d][0], ny = y + DIRS[d][1];
          if (!inside(nx, ny)) continue;
          var nc = cid(nx, ny), isTarget = nc === t;
          var pinCell = isTarget && allowTarget;
          if (stationAt[nc] >= 0 && !pinCell) continue;               // never through another station
          var pl = pathLine[nc], cost = DLEN[d];
          if (pl === -2 && !pinCell) continue;                       // at most two lines per cell
          if (pl === li && !isTarget) cost += 8;                     // self-crossing: strongly discouraged
          if (pl >= 0 && pl !== li) {
            var cr = turn(d, pathDir[nc]);
            if (cr === 0) continue;                                  // never run along another line
            cost += cr === 1 ? 0.7 : 0.4;                            // a crossing costs a little
          }
          if (usedSeg.has(cell < nc ? cell + ':' + nc : nc + ':' + cell)) continue;
          if (tr === 1) cost += 1.6; else if (tr === 2) cost += 3.6;
          if (nearStation[nc]) cost += 2.5;
          cost += 0.08 * nearPath[nc];
          var ns = nc * 8 + d, ng = g0 + cost;
          if (stamp[ns] === gen && gScore[ns] <= ng) continue;
          stamp[ns] = gen; gScore[ns] = ng; cameFrom[ns] = st;
          heap.push(ng + octile(nx, ny, txc, tyc), ns);
        }
      }
      if (best < 0 && sdir >= 0 && expanded < 200) return astar(sx, sy, -1, txc, tyc, li, allowTarget);   // boxed in: any start direction
      if (best < 0) return null;
      var cells = [];
      for (var q = best; q >= 0; q = cameFrom[q]) cells.push((q / 8) | 0);
      cells.reverse();
      return cells;
    }
    /* Nearest cell to (x,y) with no station or path; beyond radius 4 a cell next to a station will do. */
    function nearestFree(x, y) {
      var loose = null;
      for (var r = 0; r <= 16; r++) for (var ddx = -r; ddx <= r; ddx++) for (var ddy = -r; ddy <= r; ddy++) {
        if (Math.max(Math.abs(ddx), Math.abs(ddy)) !== r) continue;
        var cx = x + ddx, cy = y + ddy;
        if (!inside(cx, cy)) continue;
        var c = cid(cx, cy);
        if (stationAt[c] >= 0 || pathLine[c] !== -1) continue;
        if (!nearStation[c]) return [cx, cy];
        if (!loose && r > 4) loose = [cx, cy];
      }
      return loose || [Math.min(W - 2, Math.max(1, x)), Math.min(H - 2, Math.max(1, y))];
    }

    var X = new Float64Array(n), Y = new Float64Array(n);
    var linePaths = new Array(L), fixedOf = new Array(L), stats = { skippedAnchors: 0, extended: 0, routeFails: 0 };
    var order = chains.map(function (ch, li) { return li; }).sort(function (a, b) { return chains[b].length - chains[a].length; });

    // ---- 5a. route every line
    var partnerCount = new Uint8Array(W * H);
    stats.pinsHonoured = 0; stats.pinsReleased = 0;
    for (var oi = 0; oi < order.length; oi++) {
      var li = order[oi], ch = chains[li], m = ch.length, every = Math.max(6, Math.round(m / 6));
      // corridor: the embedded chain lightly smoothed, then warped toward the cells of
      // partners already on the grid so the line bends to meet them
      var sxs = new Float64Array(m), sys = new Float64Array(m), win = Math.max(1, Math.round(m / 14)), wsig = Math.max(3, m / 8);
      for (k = 0; k < m; k++) {
        var c = 0, ax = 0, ay = 0;
        for (var w = -win; w <= win; w++) { var q = k + w; if (q < 0 || q >= m) continue; ax += tx[ch[q]]; ay += ty[ch[q]]; c++; }
        sxs[k] = ax / c; sys[k] = ay / c;
      }
      var wx = new Float64Array(m), wy = new Float64Array(m), ww = new Float64Array(m);
      for (k = 0; k < m; k++) {
        var pk = partner[ch[k]];
        if (pk < 0 || !placed[pk]) continue;
        var ox = X[pk] - sxs[k], oy = Y[pk] - sys[k];
        if (Math.hypot(ox, oy) > 20) continue;
        for (var q2 = 0; q2 < m; q2++) { var g = Math.exp(-0.5 * Math.pow((q2 - k) / wsig, 2)); wx[q2] += ox * g; wy[q2] += oy * g; ww[q2] += g; }
      }
      for (k = 0; k < m; k++) if (ww[k] > 0) { sxs[k] += wx[k] / Math.max(1, ww[k]); sys[k] += wy[k] / Math.max(1, ww[k]); }

      var released = {}, attempt = 0, result = null, MAXA = 5;
      while (attempt < MAXA && !result) {
        attempt++;
        if (attempt === MAXA) for (k = 0; k < m; k++) released[k] = true;
        // anchors in chain order: pins (partner already on the grid) and a free cell every few stations
        var anchors = [], lastK = -1e9, lastX = 0, lastY = 0;
        for (k = 0; k < m; k++) {
          var b = ch[k], p = partner[b], isPin = p >= 0 && placed[p] && !released[k] && k > 0 && k < m - 1, ax2, ay2;
          if (isPin) {
            ax2 = X[p]; ay2 = Y[p];
            var pc = cid(ax2, ay2);
            if (pathLine[pc] === -2 || partnerCount[pc] >= 2) { released[k] = true; stats.pinsReleased++; continue; }
          } else if (k === 0 || k === m - 1 || k - lastK >= every) { var f = nearestFree(Math.round(sxs[k]), Math.round(sys[k])); ax2 = f[0]; ay2 = f[1]; }
          else continue;
          if (anchors.length) {
            var gap = k - lastK, dist = octile(lastX, lastY, ax2, ay2);
            if (isPin && dist > 2.5 * gap + 3) { released[k] = true; stats.pinsReleased++; continue; }
            if (!isPin && k !== m - 1 && dist < 2) continue;
            if (!isPin && k === m - 1 && dist < 1) { var f2 = nearestFree(ax2 + 2, ay2); ax2 = f2[0]; ay2 = f2[1]; }
          }
          anchors.push({ k: k, x: ax2, y: ay2, pin: isPin });
          lastK = k; lastX = ax2; lastY = ay2;
        }
        var cells = [[anchors[0].x, anchors[0].y]], dir = -1, own = [], fixed = [[0, 0]];
        for (var a = 1; a < anchors.length; a++) {
          var A = cells[cells.length - 1], B = anchors[a];
          var seg = astar(A[0], A[1], dir, B.x, B.y, li, B.pin);
          if (!seg) { if (B.pin) { released[B.k] = true; stats.pinsReleased++; } else stats.skippedAnchors++; continue; }
          for (s = 1; s < seg.length; s++) { cells.push([seg[s] % W, (seg[s] / W) | 0]); if (s < seg.length - 1 && pathLine[seg[s]] < 0) { pathLine[seg[s]] = li; own.push(seg[s]); } }
          if (B.pin) fixed.push([B.k, cells.length - 1]);
          var e1 = cells[cells.length - 1], e0 = cells[cells.length - 2];
          dir = e0 ? dirIndex(e1[0] - e0[0], e1[1] - e0[1]) : -1;
        }
        // a route shorter than its station count is extended onward from the end
        var guard = 0;
        while (cells.length < m + 1 && guard++ < 4) {
          var need = m + 1 - cells.length, ex = cells[cells.length - 1][0], ey = cells[cells.length - 1][1], dd = dir >= 0 ? DIRS[dir] : [1, 0];
          var goal = nearestFree(ex + dd[0] * need, ey + dd[1] * need);
          var ext = astar(ex, ey, dir, goal[0], goal[1], li, false);
          if (!ext || ext.length < 2) break;
          for (s = 1; s < ext.length; s++) cells.push([ext[s] % W, (ext[s] / W) | 0]);
          e1 = cells[cells.length - 1]; e0 = cells[cells.length - 2]; dir = dirIndex(e1[0] - e0[0], e1[1] - e0[1]);
          stats.extended++;
        }
        own.forEach(function (cc) { pathLine[cc] = -1; });
        fixed.push([m - 1, cells.length - 1]);
        // every stretch between fixed points needs a cell per station, and not absurdly many
        var bad = false;
        for (var f3 = 1; f3 < fixed.length; f3++) {
          var dk = fixed[f3][0] - fixed[f3 - 1][0], dc = fixed[f3][1] - fixed[f3 - 1][1];
          if (dk > 0 && (dc < dk || dc > 3 * dk + 2)) {
            var rk = fixed[f3][0] < m - 1 ? fixed[f3][0] : fixed[f3 - 1][0];
            if (rk > 0 && rk < m - 1 && !released[rk]) { released[rk] = true; stats.pinsReleased++; bad = true; }
          }
        }
        if (bad) continue;
        result = { cells: cells, fixed: fixed };
      }
      if (!result || (result.cells.length < 2 && m > 1)) { stats.routeFails++; var f4 = nearestFree(Math.round(sxs[0]), Math.round(sys[0])); var cl = []; for (k = 0; k < m; k++) cl.push([f4[0] + k, f4[1]]); result = { cells: cl, fixed: [[0, 0], [m - 1, m - 1]] }; }
      cells = result.cells;
      linePaths[li] = cells;
      fixedOf[li] = result.fixed;
      // register the path
      for (s = 0; s < cells.length; s++) {
        var cc2 = cid(cells[s][0], cells[s][1]);
        if (pathLine[cc2] >= 0 && pathLine[cc2] !== li) pathLine[cc2] = -2; else if (pathLine[cc2] === -1) pathLine[cc2] = li;
        if (s > 0) {
          var pd = dirIndex(cells[s][0] - cells[s - 1][0], cells[s][1] - cells[s - 1][1]);
          if (pathDir[cc2] < 0) pathDir[cc2] = pd;
          var cp = cid(cells[s - 1][0], cells[s - 1][1]);
          usedSeg.add(cp < cc2 ? cp + ':' + cc2 : cc2 + ':' + cp);
        }
        for (var ddx = -1; ddx <= 1; ddx++) for (var ddy = -1; ddy <= 1; ddy++) { var nx2 = cells[s][0] + ddx, ny2 = cells[s][1] + ddy; if (inside(nx2, ny2)) nearPath[cid(nx2, ny2)]++; }
      }
      spread(li, result.fixed);
      for (k = 0; k < m; k++) {
        placed[ch[k]] = 1;
        var rc = cid(X[ch[k]], Y[ch[k]]);
        if (stationAt[rc] < 0) stationAt[rc] = ch[k];
        partnerCount[rc]++;
        var pp = partner[ch[k]];
        if (pp >= 0 && placed[pp] && X[pp] === X[ch[k]] && Y[pp] === Y[ch[k]]) stats.pinsHonoured++;
        for (ddx = -1; ddx <= 1; ddx++) for (ddy = -1; ddy <= 1; ddy++) { nx2 = X[ch[k]] + ddx; ny2 = Y[ch[k]] + ddy; if (inside(nx2, ny2)) nearStation[cid(nx2, ny2)]++; }
      }
      if (opts.onLine) opts.onLine(li, { m: m, cells: cells.length, anchors: anchors.length, pins: result.fixed.length - 2, released: Object.keys(released).length, attempt: attempt });
    }
    /* Put the stations of line li on its path cells, evenly between fixed [stationIndex, cellIndex] points. */
    function spread(li, fixed) {
      var ch = chains[li], cells = linePaths[li], m = ch.length, used = {};
      for (var f3 = 1; f3 < fixed.length; f3++) {
        var k0 = fixed[f3 - 1][0], k1 = fixed[f3][0], c0 = fixed[f3 - 1][1], c1 = fixed[f3][1];
        for (var kk = k0; kk <= k1; kk++) {
          var ci = k1 === k0 ? c0 : Math.round(c0 + (c1 - c0) * (kk - k0) / (k1 - k0));
          ci = Math.max(0, Math.min(cells.length - 1, ci));
          var pinned = kk === k0 || kk === k1;
          if (!pinned) {
            // an ordinary station must not sit on a crossing with another line, nor on a
            // cell already holding one of this line's stations; slide one cell along
            var tries = [ci, ci + 1, ci - 1, ci + 2, ci - 2];
            for (var q = 0; q < tries.length; q++) {
              var cj = tries[q]; if (cj <= c0 || cj >= c1) continue;
              var cc = cid(cells[cj][0], cells[cj][1]);
              if (used[cj] || (pathLine[cc] !== li && pathLine[cc] !== -1) || (stationAt[cc] >= 0 && lineOf[stationAt[cc]] !== li)) continue;
              ci = cj; break;
            }
          }
          used[ci] = 1;
          X[ch[kk]] = cells[ci][0]; Y[ch[kk]] = cells[ci][1];
        }
      }
    }

    // ---- 5b. interchanges at crossings
    var cellUsers = new Map();      // cell -> [[line, cellIndex], ...]
    linePaths.forEach(function (cells, li) { cells.forEach(function (pt, idx) { var c = cid(pt[0], pt[1]); if (!cellUsers.has(c)) cellUsers.set(c, []); cellUsers.get(c).push([li, idx]); }); });
    var sites = [];
    cellUsers.forEach(function (users, c) {
      if (users.length < 2) return;
      for (var u = 0; u < users.length; u++) for (var v = u + 1; v < users.length; v++) if (users[u][0] !== users[v][0]) sites.push({ cell: c, a: users[u], b: users[v] });
    });
    // candidate pairs per site: stations within `reach` stops of the crossing on each line
    var reach = opts.reach || 4, minSim = opts.minSim || 0.16, cands = [];
    sites.forEach(function (site) {
      var la = site.a[0], lb = site.b[0], ca = site.a[1], cb = site.b[1];
      var ka = nearestStation(la, ca), kb = nearestStation(lb, cb);
      var best = null;
      for (var da = -reach; da <= reach; da++) for (var db = -reach; db <= reach; db++) {
        var ia = ka + da, ib = kb + db;
        if (ia <= 0 || ib <= 0 || ia >= chains[la].length - 1 || ib >= chains[lb].length - 1) continue;   // termini stay termini
        var sv = sim(chains[la][ia], chains[lb][ib]);
        if (sv >= minSim && (!best || sv > best.sim)) best = { sim: sv, ka: ia, kb: ib };
      }
      if (best) cands.push({ cell: site.cell, la: la, lb: lb, ca: ca, cb: cb, ka: best.ka, kb: best.kb, sim: best.sim });
    });
    function nearestStation(li, cellIndex) {
      var ch = chains[li], cells = linePaths[li], bestK = 0, bd = Infinity;
      for (var kk = 0; kk < ch.length; kk++) { var d = Math.hypot(X[ch[kk]] - cells[cellIndex][0], Y[ch[kk]] - cells[cellIndex][1]); if (d < bd) { bd = d; bestK = kk; } }
      return bestK;
    }
    cands.sort(function (p, q) { return q.sim - p.sim; });
    // greedy: accept a pair if each line can still fit its stations between fixed points
    var usedStation = new Uint8Array(n), inters = [];
    // honoured pins first: they are the strong textual pairs the map was bent to join
    seeds.forEach(function (p) { if (partner[p.a] === p.b && X[p.a] === X[p.b] && Y[p.a] === Y[p.b]) { usedStation[p.a] = 1; usedStation[p.b] = 1; inters.push({ a: p.a, b: p.b, sim: p.sim, kind: 'merged' }); } });
    function fits(li, kk, ci) {
      var fx = fixedOf[li];
      for (var q = 1; q < fx.length; q++) {
        if (fx[q][0] === kk || fx[q][1] === ci) return false;
        if (fx[q - 1][0] < kk && kk < fx[q][0]) {
          if (!(fx[q - 1][1] < ci && ci < fx[q][1])) return false;   // must keep the order along the path
          var okL = (ci - fx[q - 1][1]) >= (kk - fx[q - 1][0]), okR = (fx[q][1] - ci) >= (fx[q][0] - kk);
          var evenL = (ci - fx[q - 1][1]) <= 3 * (kk - fx[q - 1][0]) + 2, evenR = (fx[q][1] - ci) <= 3 * (fx[q][0] - kk) + 2;
          return okL && okR && evenL && evenR;
        }
      }
      return false;
    }
    function insert(li, kk, ci) { var fx = fixedOf[li]; fx.push([kk, ci]); fx.sort(function (p, q) { return p[0] - q[0]; }); }
    cands.forEach(function (c) {
      var A2 = chains[c.la][c.ka], B2 = chains[c.lb][c.kb];
      if (usedStation[A2] || usedStation[B2]) return;
      if (!fits(c.la, c.ka, c.ca) || !fits(c.lb, c.kb, c.cb)) return;
      insert(c.la, c.ka, c.ca); insert(c.lb, c.kb, c.cb);
      usedStation[A2] = 1; usedStation[B2] = 1;
      inters.push({ a: A2, b: B2, sim: c.sim, kind: 'merged' });
    });
    for (li = 0; li < L; li++) spread(li, fixedOf[li]);

    // walking links: strong pairs that ended up close but not on one cell
    var walkMax = opts.walkMax || 4, walkMin = opts.walkMinSim || 0.2, walks = [];
    for (i = 0; i < n; i++) {
      if (usedStation[i]) continue;
      for (var j = i + 1; j < n; j++) {
        if (usedStation[j] || lineOf[i] === lineOf[j]) continue;
        var dxx = X[i] - X[j], dyy = Y[i] - Y[j];
        if (Math.abs(dxx) > walkMax || Math.abs(dyy) > walkMax) continue;
        var sv = sim(i, j);
        if (sv >= walkMin) walks.push({ a: i, b: j, sim: sv, kind: 'walk' });
      }
    }
    walks.sort(function (p, q) { return q.sim - p.sim; });
    walks.forEach(function (w) { if (!usedStation[w.a] && !usedStation[w.b]) { usedStation[w.a] = 1; usedStation[w.b] = 1; inters.push(w); } });

    // crop to content
    var bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
    linePaths.forEach(function (pth) { pth.forEach(function (pt) { bx0 = Math.min(bx0, pt[0]); by0 = Math.min(by0, pt[1]); bx1 = Math.max(bx1, pt[0]); by1 = Math.max(by1, pt[1]); }); });
    for (i = 0; i < n; i++) { X[i] -= bx0 - 1; Y[i] -= by0 - 1; }
    var paths = linePaths.map(function (pth) { return pth.map(function (pt) { return [pt[0] - bx0 + 1, pt[1] - by0 + 1]; }); });
    var merged = 0, walk = 0;
    inters.forEach(function (p) { if (p.kind === 'merged') merged++; else walk++; });
    return { x: X, y: Y, paths: paths, width: bx1 - bx0 + 2, height: by1 - by0 + 2, inters: inters,
      counts: { merged: merged, walk: walk, crossings: sites.length }, stats: stats };
  }

  /* ---------- 6. Verification ---------- */

  function verify(net) {
    var n = net.x.length, lineOf = net.lineOf, out = { stationOverlap: 0, crossLineAdjacent: 0, nonOctilinear: 0, longSteps: 0, minGap: Infinity };
    var cells = new Map();
    for (var i = 0; i < n; i++) {
      var k = Math.round(net.x[i]) * 100000 + Math.round(net.y[i]);
      if (!cells.has(k)) cells.set(k, []); cells.get(k).push(i);
    }
    cells.forEach(function (list) {
      // a cell with two stations is only legal as a merged interchange
      if (list.length > 1) { var ok = list.length === 2 && net.partner[list[0]] === list[1]; if (!ok) out.stationOverlap += list.length - 1; }
    });
    for (i = 0; i < n; i++) for (var ddx = -1; ddx <= 1; ddx++) for (var ddy = -1; ddy <= 1; ddy++) {
      if (!ddx && !ddy) continue;
      var l = cells.get((Math.round(net.x[i]) + ddx) * 100000 + Math.round(net.y[i]) + ddy);
      if (!l) continue;
      for (var q = 0; q < l.length; q++) if (lineOf[l[q]] !== lineOf[i] && l[q] > i) out.crossLineAdjacent++;
    }
    net.lines.forEach(function (L, li) {
      var pts = net.paths[li];
      for (var s = 1; s < pts.length; s++) {
        var dx = pts[s][0] - pts[s - 1][0], dy = pts[s][1] - pts[s - 1][1];
        if (!(dx === 0 || dy === 0 || Math.abs(dx) === Math.abs(dy))) out.nonOctilinear++;
      }
      for (var k = 1; k < L.stations.length; k++) {
        var a = L.stations[k - 1], b = L.stations[k];
        var d = Math.max(Math.abs(net.x[a] - net.x[b]), Math.abs(net.y[a] - net.y[b]));
        if (d > 3) out.longSteps++;
        var g = Math.hypot(net.x[a] - net.x[b], net.y[a] - net.y[b]);
        if (g > 0) out.minGap = Math.min(out.minGap, g);
      }
    });
    return out;
  }

  /* The drawn polyline of a line (bend points only) in grid coordinates. */
  function linePoints(net, li) { return simplifyPath(net.paths[li]); }

  /* ---------- Journey planner ---------- */

  /*
   * Dijkstra over stations: one stop along a line costs 1, changing at a merged
   * interchange costs `change` stops, a walking link a little more. Returns
   * { path, legs: [{ line, stations }], stops, changes } or null.
   */
  function journey(net, from, to, change) {
    change = change || 3;
    var n = net.x.length, adj = net.adj;
    if (from === to) return { path: [from], legs: [{ line: net.lineOf[from], stations: [from] }], stops: 0, changes: 0 };
    var dist = new Float64Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1), done = new Uint8Array(n);
    dist[from] = 0;
    for (;;) {
      var u = -1, best = Infinity;
      for (var i = 0; i < n; i++) if (!done[i] && dist[i] < best) { best = dist[i]; u = i; }
      if (u < 0 || u === to) break;
      done[u] = 1;
      for (var q = 0; q < adj[u].length; q++) {
        var e = adj[u][q], v = e[0], cost = e[1] === 0 ? 1 : e[1] === 1 ? change : change + 1;
        if (dist[u] + cost < dist[v]) { dist[v] = dist[u] + cost; prev[v] = u; }
      }
    }
    if (dist[to] === Infinity) return null;
    var path = [];
    for (var x = to; x >= 0; x = prev[x]) path.push(x);
    path.reverse();
    var legs = [], cur = null;
    for (i = 0; i < path.length; i++) {
      var li = net.lineOf[path[i]];
      if (!cur || cur.line !== li) { cur = { line: li, stations: [path[i]] }; legs.push(cur); }
      else cur.stations.push(path[i]);
    }
    return { path: path, legs: legs, stops: path.length - legs.length, changes: legs.length - 1 };
  }

  /* ---------- Label placement (shared by the renderer and the tests) ---------- */

  /*
   * Greedy collision avoidance on a hash grid. items: [{ x, y, w, h, priority,
   * sides: [[dx, dy, anchor], ...] }] in screen pixels; higher priority first.
   * Returns an array of { x, y, anchor } (top-left of the box) or null per item.
   * `blocked` are extra rectangles that labels must avoid (station rings etc.).
   */
  function placeLabels(items, blocked, cell) {
    cell = cell || 48;
    var grid = new Map(), out = new Array(items.length);
    function cellsOf(x, y, w, h) { var r = []; for (var gx = Math.floor(x / cell); gx <= Math.floor((x + w) / cell); gx++) for (var gy = Math.floor(y / cell); gy <= Math.floor((y + h) / cell); gy++) r.push(gx * 100003 + gy); return r; }
    function hits(x, y, w, h) {
      var cs = cellsOf(x, y, w, h);
      for (var c = 0; c < cs.length; c++) { var l = grid.get(cs[c]); if (!l) continue; for (var q = 0; q < l.length; q++) { var b = l[q]; if (x < b[0] + b[2] && x + w > b[0] && y < b[1] + b[3] && y + h > b[1]) return true; } }
      return false;
    }
    function add(x, y, w, h) { var cs = cellsOf(x, y, w, h); for (var c = 0; c < cs.length; c++) { if (!grid.has(cs[c])) grid.set(cs[c], []); grid.get(cs[c]).push([x, y, w, h]); } }
    (blocked || []).forEach(function (b) { add(b[0], b[1], b[2], b[3]); });
    var idx = items.map(function (it, i) { return i; }).sort(function (a, b) { return items[b].priority - items[a].priority || a - b; });
    for (var k = 0; k < idx.length; k++) {
      var i = idx[k], it = items[i]; out[i] = null;
      for (var s = 0; s < it.sides.length; s++) {
        var sd = it.sides[s], x = it.x + sd[0] - (sd[2] === 'end' ? it.w : sd[2] === 'middle' ? it.w / 2 : 0), y = it.y + sd[1] - it.h / 2;
        if (!hits(x - 2, y - 1, it.w + 4, it.h + 2)) { add(x - 2, y - 1, it.w + 4, it.h + 2); out[i] = { x: x, y: y, anchor: sd[2], side: s }; break; }
      }
    }
    return out;
  }

  /* ---------- Orchestration ---------- */

  function buildNetwork(books, vec, S, opts) {
    opts = opts || {};
    var n = books.length, timings = {}, t = now();
    var al = assignLines(books, vec), lines = al.lines, lineOf = al.lineOf;
    timings.lines = now() - t; t = now();
    var posInLine = new Int32Array(n);
    lines.forEach(function (L) { L.stations = orderLine(S, n, L.members); L.stations.forEach(function (b, k) { posInLine[b] = k; }); delete L.members; });
    timings.order = now() - t; t = now();
    // strong cross-line pairs seed the embedding (they pull their lines together)
    var seeds = findInterchanges(vec, lineOf, posInLine, opts.K || 120, opts.minSim || 0.25, opts.spread || 4);
    timings.interchanges = now() - t; t = now();
    var knn = Oracle.knn(S, n, opts.k || 4);
    var chains = lines.map(function (L) { return L.stations; });
    var emb = embed(n, chains, seeds, knn, vec, { iters: opts.iters || 300 });
    timings.embed = now() - t; t = now();
    var lay = schematic(chains, emb, seeds, function (i, j) { return Oracle.dot(vec.docs[i], vec.docs[j]); }, { spacing: opts.spacing, walkMax: opts.walkMax, minSim: opts.icMinSim });
    timings.schematic = now() - t; t = now();
    var partner = new Int32Array(n).fill(-1), kept = lay.inters;
    kept.forEach(function (p) { partner[p.a] = p.b; partner[p.b] = p.a; });
    // adjacency for the journey planner: [neighbour, kind] kind 0 = same line, 1 = merged interchange, 2 = walking link
    var adj = new Array(n);
    for (var i = 0; i < n; i++) adj[i] = [];
    lines.forEach(function (L) { for (var k = 1; k < L.stations.length; k++) { var a = L.stations[k - 1], b = L.stations[k]; adj[a].push([b, 0]); adj[b].push([a, 0]); } });
    kept.forEach(function (p) { var kind = p.kind === 'merged' ? 1 : 2; adj[p.a].push([p.b, kind]); adj[p.b].push([p.a, kind]); });
    // connectivity: if some lines are still islands, join each island to the rest by the
    // strongest cross-line pair available, as a (long) walking link, so every journey exists
    var joined = 0;
    for (var guard = 0; guard < lines.length; guard++) {
      var comp = components(n, adj);
      if (comp.count < 2) break;
      var best = null;
      for (var a = 0; a < n; a++) for (var b = a + 1; b < n; b++) {
        if (comp.of[a] === comp.of[b] || partner[a] >= 0 || partner[b] >= 0) continue;
        var d = Math.hypot(lay.x[a] - lay.x[b], lay.y[a] - lay.y[b]);
        if (d > 12) continue;
        var s = Oracle.dot(vec.docs[a], vec.docs[b]) - d * 0.01;
        if (!best || s > best.s) best = { a: a, b: b, s: s, sim: Oracle.dot(vec.docs[a], vec.docs[b]) };
      }
      if (!best) break;
      var link = { a: best.a, b: best.b, sim: best.sim, kind: 'walk', bridge: true };
      kept.push(link); partner[link.a] = link.b; partner[link.b] = link.a;
      adj[link.a].push([link.b, 2]); adj[link.b].push([link.a, 2]); joined++;
    }
    var net = { n: n, lines: lines, lineOf: lineOf, posInLine: posInLine, inters: kept, partner: partner, adj: adj, knn: knn,
      x: lay.x, y: lay.y, paths: lay.paths, width: lay.width, height: lay.height, emb: emb,
      counts: { merged: lay.counts.merged, walk: lay.counts.walk, bridges: joined, crossings: lay.counts.crossings, seeds: seeds.length, seedsMerged: lay.stats.pinsHonoured }, layoutStats: lay.stats };
    net.check = verify(net);
    timings.verify = now() - t;
    net.timings = timings;
    return net;
  }

  /* Connected components of the station graph. */
  function components(n, adj) {
    var of = new Int32Array(n).fill(-1), count = 0;
    for (var i = 0; i < n; i++) {
      if (of[i] >= 0) continue;
      var stack = [i]; of[i] = count;
      while (stack.length) { var u = stack.pop(); for (var q = 0; q < adj[u].length; q++) { var v = adj[u][q][0]; if (of[v] < 0) { of[v] = count; stack.push(v); } } }
      count++;
    }
    return { of: of, count: count };
  }

  function now() { return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now(); }

  var Network = { LINE_DEFS: LINE_DEFS, assignLines: assignLines, orderLine: orderLine, findInterchanges: findInterchanges,
    embed: embed, pca2: pca2, schematic: schematic, verify: verify, linePoints: linePoints, simplifyPath: simplifyPath, journey: journey,
    placeLabels: placeLabels, buildNetwork: buildNetwork, DIRS: DIRS };
  root.Network = Network;
  if (typeof module !== 'undefined' && module.exports) module.exports = Network;
})(typeof self !== 'undefined' ? self : this);
