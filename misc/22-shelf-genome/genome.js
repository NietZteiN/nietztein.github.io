/* Shelf Genome: pure logic (no DOM). Loaded by index.html and testable in Node.
   Everything here is deterministic given its inputs so the page can be
   reproduced from a hash and the tests can pin down exact outputs. */
(function (root) {
  'use strict';

  /* ---------- genre palette (stable, hand-picked for a dark background) ---------- */
  var GENRE_COLORS = {
    'Literature (English & European)': '#f2c14e',
    'Manga & comics': '#ff6b8a',
    'Writing, film & literary craft': '#ffa64d',
    'History & biography': '#c9a27e',
    'Japanese literature': '#ff4d4d',
    'Psychology, self-help & business': '#7dd3a3',
    'Art & visual culture': '#9b5cff',
    'Light novels': '#f06bd9',
    'Language study & reference': '#5ec8f2',
    'Religion & theology': '#e6d9a8',
    'Society, culture & ideas': '#3fbf9a',
    'Philosophy & political theory': '#8fa3ff',
    'Math, CS & engineering': '#45e0d0',
    'Nursing & medical': '#7bed7b',
    'Test prep & study guides': '#b7e05a',
    'Science': '#4f9ef7',
    'Magazines & catalogues': '#f0a08a',
    'Music & opera': '#e08cff',
    'Politics, law & current affairs': '#8fb3c7',
    'Games & other objects': '#d0d0d0',
    'Unidentified': '#6b7280',
    'Occult & folklore': '#6c4ee0'
  };
  var FALLBACK_COLOR = '#9aa0a6';

  /* Types that count as fiction for the "F-content" stat (the GC-content joke). */
  var FICTION_TYPES = {
    'Fiction': 1, 'Manga': 1, 'Comics': 1, 'Light novel': 1, 'Poetry': 1, 'Drama': 1,
    'Anthology': 1, "Children's": 1, 'Picture book': 1
  };

  /* Coarse type classes for the type marker row. */
  var TYPE_CLASS_OF = {
    'Fiction': 'prose', 'Light novel': 'prose', "Children's": 'prose', 'Picture book': 'prose',
    'Manga': 'comics', 'Comics': 'comics',
    'Poetry': 'verse', 'Drama': 'verse', 'Anthology': 'verse',
    'Language study': 'study', 'Test prep': 'study', 'Textbook': 'study', 'Reference': 'study',
    'Technical': 'study', 'Nursing & medical': 'study', 'Math journal': 'study', 'Documents': 'study',
    'Art': 'objects', 'Magazine': 'objects', 'Calendar': 'objects', 'Games': 'objects', '?': 'objects'
  };
  var TYPE_CLASSES = [
    { key: 'prose', label: 'prose fiction', color: '#ffb8c8' },
    { key: 'comics', label: 'comics', color: '#ff7a5c' },
    { key: 'verse', label: 'verse, drama, anthologies', color: '#e2c4ff' },
    { key: 'nonfic', label: 'nonfiction', color: '#8ecae6' },
    { key: 'study', label: 'study & reference', color: '#b5e48c' },
    { key: 'objects', label: 'art, magazines, objects', color: '#f4f1de' }
  ];
  var LANG_CLASSES = [
    { key: 'EN', label: 'English', color: '#7fb2ff' },
    { key: 'JA', label: 'Japanese (incl. bilingual)', color: '#ff7f7f' },
    { key: 'other', label: 'other / Latin / Italian', color: '#ffe08a' }
  ];

  /* Page proxy weights by type: how "long" a band of that type looks. */
  var TYPE_WEIGHT = {
    'Manga': 0.55, 'Comics': 0.6, 'Light novel': 0.7, 'Magazine': 0.7, 'Poetry': 0.75, 'Drama': 0.75,
    'Calendar': 0.5, 'Games': 0.6, 'Picture book': 0.5, "Children's": 0.6,
    'Textbook': 1.6, 'Reference': 1.5, 'Nursing & medical': 1.6, 'Art': 1.35, 'Anthology': 1.3,
    'History': 1.2, 'Philosophy': 1.1, 'Religion': 1.15, 'Technical': 1.4, 'Documents': 1.2
  };

  function typeClass(ty) { return TYPE_CLASS_OF[ty] || 'nonfic'; }
  function langClass(l) {
    l = String(l || '');
    if (l === 'EN') return 'EN';
    if (l.indexOf('JA') >= 0) return 'JA';
    return 'other';
  }
  function genreColor(g) { return GENRE_COLORS[g] || FALLBACK_COLOR; }

  /* ---------- year parsing: numeric y first, then a loose read of yr ---------- */
  function parseYear(y, yr) {
    if (typeof y === 'number' && isFinite(y)) return y;
    var s = String(yr || '').trim();
    if (!s) return null;
    var m;
    if ((m = s.match(/(\d{4})s/))) return parseInt(m[1], 10) + 5;
    if ((m = s.match(/(-?\d{3,4})/))) return parseInt(m[1], 10);
    if ((m = s.match(/(\d{2})(?:th|st|nd|rd)\s*c\.?(\s*BC)?/i))) {
      var c = parseInt(m[1], 10), mid = (c - 1) * 100 + 50;
      if (/early/i.test(s)) mid = (c - 1) * 100 + 15;
      else if (/late/i.test(s)) mid = (c - 1) * 100 + 85;
      return m[2] ? -mid : mid;
    }
    if ((m = s.match(/(\d)(?:th|st|nd|rd)\s*c\.?(\s*BC)?/i))) {
      var c1 = parseInt(m[1], 10), mid1 = (c1 - 1) * 100 + 50;
      return m[2] ? -mid1 : mid1;
    }
    if ((m = s.match(/(\d{4})s/))) return parseInt(m[1], 10) + 5;
    return null;
  }

  /* ---------- seeded PRNG (mulberry32) fed by a string hash (FNV-1a) ---------- */
  function hashString(str) {
    var h = 0x811c9dc5;
    str = String(str);
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
  }
  function makeRng(seed) {
    var a = (typeof seed === 'number' ? seed : hashString(seed)) >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ---------- ordering the library into one chromosome ---------- */
  function unitRank(u) {
    u = String(u || '');
    if (/^[A-Z]$/.test(u)) return u.charCodeAt(0);
    return 1000; /* "Loose" and anything odd goes last */
  }
  /* Sort by unit (letters, then the rest), shelf (order of first appearance
     inside the unit), then position. Returns a new array of "loci". */
  function orderLibrary(books) {
    var shelfFirst = {};
    for (var i = 0; i < books.length; i++) {
      var k = books[i].u + '|' + books[i].s;
      if (!(k in shelfFirst)) shelfFirst[k] = i;
    }
    var idx = books.map(function (b, i) { return i; });
    idx.sort(function (ia, ib) {
      var a = books[ia], b = books[ib];
      var d = unitRank(a.u) - unitRank(b.u);
      if (d) return d;
      if (a.u !== b.u) return a.u < b.u ? -1 : 1;
      d = shelfFirst[a.u + '|' + a.s] - shelfFirst[b.u + '|' + b.s];
      if (d) return d;
      d = (Number(a.p) || 0) - (Number(b.p) || 0);
      if (d) return d;
      return ia - ib;
    });
    return idx.map(function (i) { return books[i]; });
  }

  /* Band width in world units: a page proxy from title + description length
     weighted by type. Kept in a narrow range so the strip stays even-ish. */
  function bandWidth(b) {
    var tl = (b.t || '').length, dl = (b.d || '').length;
    var w = 0.9 + tl / 60 + dl / 300;
    w *= TYPE_WEIGHT[b.ty] || 1;
    return Math.max(0.45, Math.min(3.2, w));
  }

  /* Build the genome: loci with world x, width, colour, classes; unit and shelf
     spans; gaps between units (the centromeres). */
  function buildGenome(books, opts) {
    opts = opts || {};
    var gap = opts.unitGap || 9;
    var ordered = orderLibrary(books);
    var genreCount = {};
    ordered.forEach(function (b) { genreCount[b.g] = (genreCount[b.g] || 0) + 1; });

    var loci = [], units = [], shelves = [];
    var x = 0, curUnit = null, curShelf = null;
    for (var i = 0; i < ordered.length; i++) {
      var b = ordered[i];
      if (b.u !== curUnit) {
        if (curUnit !== null) x += gap;
        curUnit = b.u;
        units.push({ u: b.u, x0: x, x1: x, first: i, last: i });
        curShelf = null;
      }
      if (b.s !== curShelf) {
        curShelf = b.s;
        shelves.push({ u: b.u, s: b.s, x0: x, x1: x, first: i, last: i });
      }
      var w = bandWidth(b);
      var year = parseYear(b.y, b.yr);
      loci.push({
        i: i, id: b.id, book: b, x: x, w: w, year: year,
        genre: b.g, color: genreColor(b.g), lang: langClass(b.l), tclass: typeClass(b.ty),
        fiction: !!FICTION_TYPES[b.ty]
      });
      x += w;
      units[units.length - 1].x1 = x; units[units.length - 1].last = i;
      shelves[shelves.length - 1].x1 = x; shelves[shelves.length - 1].last = i;
    }
    return { loci: loci, units: units, shelves: shelves, length: x, gap: gap, genreCount: genreCount };
  }

  /* Brightness factor from year: old dark, new bright, unknown mid. */
  function yearBrightness(year) {
    if (year === null || year === undefined) return 0.62;
    var t = (year - 1880) / 145;
    if (t < 0) t = 0; if (t > 1) t = 1;
    return 0.38 + 0.62 * t;
  }

  /* ---------- hotspots: genre collision score between adjacent loci ---------- */
  function collisionScore(a, b) {
    var s = 0;
    if (a.genre !== b.genre) s += 1.0;
    if (a.lang !== b.lang) s += 0.7;
    if (a.tclass !== b.tclass) s += 0.3;
    if (a.year === null || b.year === null) s += 0.2;
    else s += Math.min(Math.abs(a.year - b.year), 120) / 120 * 0.8;
    return Math.round(s * 100) / 100;
  }
  function findHotspots(genome, threshold) {
    threshold = threshold === undefined ? 1.7 : threshold;
    var out = [], loci = genome.loci;
    for (var i = 0; i + 1 < loci.length; i++) {
      var a = loci[i], b = loci[i + 1];
      if (a.book.u !== b.book.u) continue; /* the centromere is not a collision */
      var s = collisionScore(a, b);
      if (s >= threshold) out.push({ i: i, j: i + 1, score: s, x: a.x + a.w });
    }
    out.sort(function (p, q) { return q.score - p.score || p.i - q.i; });
    return out;
  }

  /* ---------- crossover: a fake child of two books ---------- */
  function splitTitle(t, rng) {
    t = String(t || '').replace(/\s*\(.*?\)\s*$/, '').trim() || 'Untitled';
    var words = t.split(/\s+/);
    if (words.length >= 2) {
      var k = 1 + Math.floor(rng() * (words.length - 1));
      return { head: words.slice(0, k).join(' '), tail: words.slice(k).join(' '), spaced: true };
    }
    /* No spaces (Japanese, single-word titles): cut between characters. */
    var chars = Array.from(t);
    if (chars.length < 3) return { head: t, tail: t, spaced: false };
    var c = 1 + Math.floor(rng() * (chars.length - 2));
    return { head: chars.slice(0, c).join(''), tail: chars.slice(c).join(''), spaced: false };
  }
  /* Join two title halves: a space when either side of the seam is Latin script. */
  function glue(head, tail) {
    var latin = /[A-Za-z0-9À-ɏ]/;
    var h = Array.from(head), t = Array.from(tail);
    var seam = (h.length && latin.test(h[h.length - 1])) || (t.length && latin.test(t[0]));
    return head + (seam ? ' ' : '') + tail;
  }
  function fixCaps(s) {
    s = s.replace(/\s+/g, ' ').trim();
    if (!s) return s;
    var first = Array.from(s)[0];
    return first.toUpperCase() + s.slice(first.length);
  }
  function pieces(d) {
    d = String(d || '').trim();
    if (!d) return [];
    /* sentence split without lookbehind (older Safari): cut after . ! ? or 。 */
    var sents = [], cur = '';
    var chars = Array.from(d);
    for (var i = 0; i < chars.length; i++) {
      cur += chars[i];
      var end = /[.!?]/.test(chars[i]) && (i + 1 >= chars.length || /\s/.test(chars[i + 1]));
      if (end || chars[i] === '。') { if (cur.trim()) sents.push(cur.trim()); cur = ''; }
    }
    if (cur.trim()) sents.push(cur.trim());
    if (sents.length >= 2) return sents;
    /* one sentence: fall back to clauses */
    var cl = d.split(/,\s+|;\s+|、/).map(function (s) { return s.trim(); }).filter(Boolean);
    return cl.length >= 2 ? cl : [d];
  }
  function joinPieces(parts) {
    /* Sentences keep their full stop; clauses get a comma. A piece that follows
       a full stop is capitalised so the splice reads like prose. */
    var out = [], afterStop = true;
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i].replace(/[,;、]+$/, '');
      if (afterStop) p = fixCaps(p);
      var last = (i === parts.length - 1);
      if (!/[.!?。]$/.test(p)) p += (last ? '.' : ',');
      afterStop = /[.!?。]$/.test(p);
      out.push(p);
    }
    return fixCaps(out.join(' '));
  }

  function crossover(A, B, seed, genreCount) {
    genreCount = genreCount || {};
    var key = 'x|' + A.id + '|' + B.id + '|' + (seed || 0);
    var rng = makeRng(hashString(key));
    var ta = splitTitle(A.t, rng), tb = splitTitle(B.t, rng);
    var title = fixCaps(glue(ta.head, tb.tail));
    if (title.toLowerCase() === String(A.t).toLowerCase() || title.toLowerCase() === String(B.t).toLowerCase()) {
      title = fixCaps(glue(tb.head, ta.tail));
    }

    var pa = pieces(A.d), pb = pieces(B.d), parts = [];
    var n = Math.max(pa.length, pb.length);
    for (var i = 0; i < n && parts.length < 4; i++) {
      if (i < pa.length) parts.push(pa[i]);
      if (i < pb.length) parts.push(pb[i]);
    }
    var blurb = parts.length ? joinPieces(parts) : 'Neither parent came with a description, so the child inherits the family silence.';

    var ca = genreCount[A.g] || 0, cb = genreCount[B.g] || 0;
    var genre = ca === cb ? (rng() < 0.5 ? A.g : B.g) : (ca < cb ? A.g : B.g);

    var ya = parseYear(A.y, A.yr), yb = parseYear(B.y, B.yr), year;
    if (ya !== null && yb !== null) year = Math.round((ya + yb) / 2);
    else if (ya !== null) year = ya; else if (yb !== null) year = yb; else year = null;

    /* viability: kin are boring, strangers are fragile, the sweet spot is between. */
    var v = 50;
    var lang = (langClass(A.l) === langClass(B.l));
    if (A.g === B.g) v -= 12; else v += 8;
    v += lang ? 10 : -14;
    if (typeClass(A.ty) === typeClass(B.ty)) v += 6;
    if (ya !== null && yb !== null) v -= Math.min(Math.abs(ya - yb), 200) / 200 * 22; else v -= 6;
    if (pa.length && pb.length) v += 12; else v -= 10;
    var tl = Array.from(title).length;
    if (tl < 4 || tl > 60) v -= 10;
    v += Math.round((rng() - 0.5) * 16);
    v = Math.max(3, Math.min(97, Math.round(v)));
    var verdict = v >= 70 ? 'viable' : v >= 45 ? 'fragile' : v >= 25 ? 'sterile hybrid' : 'nonviable';

    var author = pickAuthor(A.a, B.a, rng);
    return { title: title, blurb: blurb, genre: genre, year: year, viability: v, verdict: verdict,
      author: author, parents: [A.id, B.id], seed: seed || 0 };
  }
  function pickAuthor(a, b, rng) {
    a = String(a || '').trim(); b = String(b || '').trim();
    if (!a && !b) return 'anon.';
    if (!a || !b) return (a || b);
    var wa = a.split(/\s+/), wb = b.split(/\s+/);
    if (wa.length === 1 || wb.length === 1) return rng() < 0.5 ? a : b;
    return wa[0] + ' ' + wb[wb.length - 1];
  }

  /* Ten random crossovers across the whole genome, deterministic per seed. */
  function shuffleGenome(genome, seed, count) {
    count = count || 10;
    var rng = makeRng(hashString('shuffle|' + seed));
    var loci = genome.loci, out = [];
    for (var k = 0; k < count && loci.length >= 2; k++) {
      var i = Math.floor(rng() * loci.length), j = Math.floor(rng() * (loci.length - 1));
      if (j >= i) j++;
      var child = crossover(loci[i].book, loci[j].book, seed * 100 + k, genome.genreCount);
      child.a = loci[i]; child.b = loci[j];
      out.push(child);
    }
    return out;
  }

  /* ---------- stats card ---------- */
  function computeStats(genome) {
    var loci = genome.loci, n = loci.length;
    var fiction = 0, best = null, bestG = null;
    for (var g in genome.genreCount) if (!best || genome.genreCount[g] > best) { best = genome.genreCount[g]; bestG = g; }
    var run = 0, runG = null, runStart = 0, longest = { len: 0, genre: null, first: 0, last: 0 };
    var oldest = null, newest = null;
    for (var i = 0; i < n; i++) {
      var L = loci[i];
      if (L.fiction) fiction++;
      if (L.genre === runG && i > 0 && loci[i - 1].book.u === L.book.u) run++;
      else { runG = L.genre; run = 1; runStart = i; }
      if (run > longest.len) longest = { len: run, genre: runG, first: runStart, last: i };
      if (L.year !== null) {
        if (!oldest || L.year < oldest.year) oldest = L;
        if (!newest || L.year > newest.year) newest = L;
      }
    }
    return {
      length: n, fiction: fiction, fictionShare: n ? fiction / n : 0,
      topGenre: bestG, topGenreCount: best || 0, genres: Object.keys(genome.genreCount).length,
      longestRun: longest, oldest: oldest, newest: newest,
      units: genome.units.length, shelves: genome.shelves.length
    };
  }

  var api = {
    GENRE_COLORS: GENRE_COLORS, FALLBACK_COLOR: FALLBACK_COLOR, TYPE_CLASSES: TYPE_CLASSES, LANG_CLASSES: LANG_CLASSES,
    genreColor: genreColor, typeClass: typeClass, langClass: langClass, parseYear: parseYear,
    hashString: hashString, makeRng: makeRng, orderLibrary: orderLibrary, bandWidth: bandWidth,
    buildGenome: buildGenome, yearBrightness: yearBrightness, collisionScore: collisionScore,
    findHotspots: findHotspots, crossover: crossover, shuffleGenome: shuffleGenome, computeStats: computeStats
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Genome = api;
})(typeof window !== 'undefined' ? window : this);
