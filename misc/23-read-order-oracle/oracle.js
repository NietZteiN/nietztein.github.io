/*
 * Read-Order Oracle: the pure logic.
 *
 * Runs in three places with no changes:
 *   - the page (window.Oracle) for tokenising, shared keywords, k-NN and routes,
 *   - a Web Worker (new Worker('oracle.js')) for the all-pairs similarity matrix,
 *     so the page stays responsive while it grinds,
 *   - Node (require('./oracle.js')) for testing.
 *
 * Similarity = cosine of TF-IDF vectors over title + author + description
 *              + a small bonus for same genre and a shared language.
 * Path       = greedy nearest-neighbour tour from a chosen start, then 2-opt.
 */
(function (root) {
  'use strict';

  var STOP = ('a an the and or but of to in on at by for with from as is are was were be been being ' +
    'it its this that these those he she they them his her their we our you your i me my who whom whose ' +
    'which what when where why how not no nor so than then there here into onto over under about after ' +
    'before between through during without within against among around up down out off again further ' +
    'once all any both each few more most other some such only own same too very can will just should ' +
    'now also one two three four five six seven eight nine ten first second third new old ed edition ' +
    'vol volume volumes book books work works written writes writing author authors published edited ' +
    'including includes include across along via per et al de la le des du von der die das und').split(' ');
  var STOPSET = {};
  for (var i = 0; i < STOP.length; i++) STOPSET[STOP[i]] = true;

  /* Light stemmer: enough to fold plurals and simple inflections together. */
  function stem(w) {
    if (w.length > 5 && /ies$/.test(w)) return w.slice(0, -3) + 'y';
    if (w.length > 5 && /ing$/.test(w)) return w.slice(0, -3);
    if (w.length > 4 && /(ed|es)$/.test(w)) return w.slice(0, -2);
    if (w.length > 3 && /s$/.test(w) && !/ss$/.test(w)) return w.slice(0, -1);
    return w;
  }

  var CJK = /[぀-ヿ㐀-䶿一-鿿]+/g;
  var LATIN = /[a-zÀ-ɏ]+/g;

  /* Tokenise a string into stems; CJK runs become character bigrams. */
  function tokenize(text) {
    var out = [];
    var s = String(text || '').toLowerCase().normalize('NFKC');
    var m;
    CJK.lastIndex = 0;
    while ((m = CJK.exec(s))) {
      var run = m[0];
      if (run.length === 1) out.push(run);
      for (var k = 0; k + 1 < run.length; k++) out.push(run.slice(k, k + 2));
    }
    s = s.replace(CJK, ' ').normalize('NFD').replace(/[̀-ͯ]/g, '');
    LATIN.lastIndex = 0;
    while ((m = LATIN.exec(s))) {
      var w = m[0];
      if (w.length < 2 || STOPSET[w]) continue;
      var st = stem(w);
      if (st.length < 2 || STOPSET[st]) continue;
      out.push(st);
    }
    return out;
  }

  function langs(l) {
    return String(l || '').toUpperCase().split(/[\/,\s]+/).filter(Boolean);
  }

  /* Surface forms: for each raw word, remember which stem it maps to (for display). */
  function surfaceForms(text, surface) {
    var s = String(text || '').toLowerCase().normalize('NFKC').replace(CJK, ' ').normalize('NFD').replace(/[̀-ͯ]/g, '');
    var m;
    LATIN.lastIndex = 0;
    while ((m = LATIN.exec(s))) {
      var w = m[0];
      if (w.length < 2 || STOPSET[w]) continue;
      var st = stem(w);
      if (!surface[st] || (surface[st].length > w.length && w.length >= st.length)) surface[st] = w;
    }
  }

  /*
   * Build sparse TF-IDF vectors. Returns { terms, surface, docs, idf } where
   * docs[i] = { ids: Int32Array (sorted term ids), w: Float32Array (unit length) }
   * and surface[termId] is an unstemmed form of the term, for display.
   */
  function vectorize(books) {
    var vocab = {}, terms = [], df = [], surf = {};
    var docTerms = new Array(books.length);
    for (var i = 0; i < books.length; i++) {
      var b = books[i];
      // The title counts twice: it is the strongest short signal we have.
      var toks = tokenize(b.t).concat(tokenize(b.t), tokenize(b.a), tokenize(b.d));
      surfaceForms(b.t + ' ' + b.a + ' ' + b.d, surf);
      var counts = {};
      for (var j = 0; j < toks.length; j++) counts[toks[j]] = (counts[toks[j]] || 0) + 1;
      var list = [];
      for (var t in counts) {
        var id = vocab[t];
        if (id === undefined) { id = terms.length; vocab[t] = id; terms.push(t); df.push(0); }
        df[id]++;
        list.push([id, counts[t]]);
      }
      docTerms[i] = list;
    }
    var N = books.length;
    var idf = new Float32Array(terms.length);
    for (var k = 0; k < terms.length; k++) idf[k] = Math.log((N + 1) / (df[k] + 1)) + 1;
    var docs = new Array(N);
    for (i = 0; i < N; i++) {
      var lst = docTerms[i].filter(function (p) { return df[p[0]] > 1; }); // singletons match nothing
      lst.sort(function (a, b) { return a[0] - b[0]; });
      var ids = new Int32Array(lst.length), w = new Float32Array(lst.length), norm = 0;
      for (j = 0; j < lst.length; j++) {
        ids[j] = lst[j][0];
        w[j] = (1 + Math.log(lst[j][1])) * idf[lst[j][0]];
        norm += w[j] * w[j];
      }
      norm = Math.sqrt(norm) || 1;
      for (j = 0; j < w.length; j++) w[j] /= norm;
      docs[i] = { ids: ids, w: w };
    }
    var surface = terms.map(function (t) { return surf[t] || t; });
    return { terms: terms, surface: surface, docs: docs, idf: idf, df: df };
  }

  /* Sparse dot product on sorted id arrays (merge join). */
  function dot(a, b) {
    var i = 0, j = 0, s = 0, ai = a.ids, bi = b.ids;
    while (i < ai.length && j < bi.length) {
      if (ai[i] === bi[j]) { s += a.w[i] * b.w[j]; i++; j++; }
      else if (ai[i] < bi[j]) i++; else j++;
    }
    return s;
  }

  /* Terms shared by two docs, strongest first, as surface forms. */
  function shared(vec, a, b, limit) {
    var A = vec.docs[a], B = vec.docs[b], i = 0, j = 0, out = [];
    while (i < A.ids.length && j < B.ids.length) {
      if (A.ids[i] === B.ids[j]) { out.push([A.ids[i], A.w[i] * B.w[j]]); i++; j++; }
      else if (A.ids[i] < B.ids[j]) i++; else j++;
    }
    out.sort(function (x, y) { return y[1] - x[1]; });
    return out.slice(0, limit || 5).map(function (p) { return vec.surface[p[0]]; });
  }

  var GENRE_BONUS = 0.12, LANG_BONUS = 0.04;

  /*
   * Full similarity matrix as Float32Array(n*n). `onProgress(done, total)` is
   * called every few rows so a worker can report back.
   */
  function similarityMatrix(books, vec, onProgress) {
    var n = books.length, S = new Float32Array(n * n);
    var L = books.map(function (b) { return langs(b.l); });
    for (var i = 0; i < n; i++) {
      var gi = books[i].g, li = L[i], di = vec.docs[i];
      for (var j = i + 1; j < n; j++) {
        var s = dot(di, vec.docs[j]);
        if (gi && gi === books[j].g) s += GENRE_BONUS;
        var lj = L[j], sharedLang = false;
        for (var k = 0; k < li.length && !sharedLang; k++) sharedLang = lj.indexOf(li[k]) >= 0;
        if (sharedLang) s += LANG_BONUS;
        S[i * n + j] = s; S[j * n + i] = s;
      }
      if (onProgress && (i % 64 === 0 || i === n - 1)) onProgress(i + 1, n);
    }
    return S;
  }

  /* Greedy nearest-neighbour tour from `start`, then bounded 2-opt. */
  function tour(S, n, start, opts) {
    opts = opts || {};
    var maxPasses = opts.maxPasses || 25, t0 = Date.now(), budget = opts.timeMs || 1500;
    var path = new Int32Array(n), used = new Uint8Array(n);
    path[0] = start; used[start] = 1;
    var cur = start;
    for (var k = 1; k < n; k++) {
      var best = -1, bs = -Infinity, row = cur * n;
      for (var j = 0; j < n; j++) if (!used[j] && S[row + j] > bs) { bs = S[row + j]; best = j; }
      path[k] = best; used[best] = 1; cur = best;
    }
    var greedy = score(S, n, path);
    // 2-opt on an open path with a fixed start: reversing path[i..j] swaps edges
    // (i-1,i) and (j,j+1) for (i-1,j) and (i,j+1).
    var passes = 0, improved = true, moves = 0;
    while (improved && passes < maxPasses && Date.now() - t0 < budget) {
      improved = false; passes++;
      for (var i = 1; i < n - 1; i++) {
        var a = path[i - 1], b = path[i], ab = S[a * n + b];
        for (j = i + 1; j < n; j++) {
          var c = path[j], d = j + 1 < n ? path[j + 1] : -1;
          var gain = S[a * n + c] - ab;
          if (d >= 0) gain += S[b * n + d] - S[c * n + d];
          if (gain > 1e-6) {
            for (var lo = i, hi = j; lo < hi; lo++, hi--) { var tmp = path[lo]; path[lo] = path[hi]; path[hi] = tmp; }
            b = path[i]; ab = S[a * n + b]; improved = true; moves++;
          }
        }
      }
    }
    var sc = score(S, n, path);
    return { path: path, greedy: greedy, total: sc.total, mean: sc.mean, worst: sc.worst, worstAt: sc.worstAt,
      passes: passes, moves: moves, ms: Date.now() - t0 };
  }

  function score(S, n, path) {
    var total = 0, worst = Infinity, worstAt = -1;
    for (var k = 1; k < path.length; k++) {
      var s = S[path[k - 1] * n + path[k]];
      total += s;
      if (s < worst) { worst = s; worstAt = k; }
    }
    return { total: total, mean: path.length > 1 ? total / (path.length - 1) : 0, worst: worst, worstAt: worstAt };
  }

  /* k nearest neighbours of every book: array of arrays of indices, best first. */
  function knn(S, n, k) {
    var out = new Array(n);
    for (var i = 0; i < n; i++) {
      var row = i * n, cand = [];
      for (var j = 0; j < n; j++) if (j !== i) cand.push(j);
      cand.sort(function (a, b) { return S[row + b] - S[row + a]; });
      out[i] = cand.slice(0, k);
    }
    return out;
  }

  /* Dijkstra on the undirected k-NN graph; edge cost = 1.3 - sim (always > 0). */
  function route(S, n, nn, from, to) {
    if (from === to) return [from];
    var adj = new Array(n);
    for (var i = 0; i < n; i++) adj[i] = [];
    for (i = 0; i < n; i++) for (var q = 0; q < nn[i].length; q++) { var j = nn[i][q]; adj[i].push(j); adj[j].push(i); }
    var dist = new Float64Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1), done = new Uint8Array(n);
    dist[from] = 0;
    for (;;) {
      var u = -1, best = Infinity;
      for (i = 0; i < n; i++) if (!done[i] && dist[i] < best) { best = dist[i]; u = i; }
      if (u < 0 || u === to) break;
      done[u] = 1;
      for (q = 0; q < adj[u].length; q++) {
        var v = adj[u][q], nd = dist[u] + (1.3 - S[u * n + v]);
        if (nd < dist[v]) { dist[v] = nd; prev[v] = u; }
      }
    }
    if (dist[to] === Infinity) return null;
    var p = [];
    for (var x = to; x >= 0; x = prev[x]) p.push(x);
    return p.reverse();
  }

  /* Deterministic small PRNG so "today's start" is the same all day. */
  function seeded(seed) {
    var s = seed >>> 0;
    return function () {
      s = (s + 0x6D2B79F5) >>> 0;
      var t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  var Oracle = { tokenize: tokenize, stem: stem, vectorize: vectorize, similarityMatrix: similarityMatrix,
    shared: shared, tour: tour, score: score, knn: knn, route: route, seeded: seeded, langs: langs,
    GENRE_BONUS: GENRE_BONUS, LANG_BONUS: LANG_BONUS };

  root.Oracle = Oracle;
  if (typeof module !== 'undefined' && module.exports) module.exports = Oracle;

  /* Worker entry: {type:'matrix', books} in; progress ticks and the matrix out. */
  if (typeof importScripts === 'function' && typeof self !== 'undefined') {
    self.onmessage = function (e) {
      var msg = e.data;
      if (msg.type === 'matrix') {
        var vec = vectorize(msg.books);
        var S = similarityMatrix(msg.books, vec, function (d, t) { self.postMessage({ type: 'progress', done: d, total: t }); });
        self.postMessage({ type: 'matrix', S: S }, [S.buffer]);
      }
    };
  }
})(typeof self !== 'undefined' ? self : this);
