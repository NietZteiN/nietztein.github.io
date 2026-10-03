// By the Numbers: a scrolling data story about the library.
// Every figure is computed here from ../../assets/data/library.json; the
// charts are inline SVG strings sized to the container (re-drawn on resize).
// Counters count up when their section scrolls into view (instant under
// prefers-reduced-motion, ?instant=1 or ?thumb=1).
(function () {
  'use strict';

  var DATA_URL = '../../assets/data/library.json';
  var BOOK_URL = '../../#/bookshelf/';
  var params = new URLSearchParams(location.search);
  var THUMB = params.get('thumb') === '1';
  var reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var INSTANT = THUMB || reducedMotion || params.get('instant') === '1';

  // ---- Shelves and hues, copied from the site's bookshelf.js -----------------
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
    { k: 'Loose', name: 'Desk and floor', desc: 'Whatever was out being read when the photos were taken.', shelves: ['Floor', 'Held (photo 73)', 'Held (photo 96)'] },
  ];
  var UNIT_BY_KEY = {};
  UNITS.forEach(function (u) { UNIT_BY_KEY[u.k] = u; });

  var GENRE_HUE = {
    'Literature (English & European)': 214, 'Japanese literature': 354, 'Manga & comics': 322, 'Light novels': 282,
    'Writing, film & literary craft': 28, 'History & biography': 14, 'Philosophy & political theory': 248,
    'Religion & theology': 42, 'Society, culture & ideas': 186, 'Politics, law & current affairs': 168,
    'Psychology, self-help & business': 142, 'Art & visual culture': 76, 'Music & opera': 266,
    'Language study & reference': 104, 'Test prep & study guides': 56, 'Math, CS & engineering': 200,
    'Science': 178, 'Nursing & medical': 6, 'Magazines & catalogues': 90, 'Occult & folklore': 300,
    'Games & other objects': 0, 'Unidentified': 0,
  };
  var LANG_NAME = { EN: 'English', JA: 'Japanese', DE: 'German', IT: 'Italian', LA: 'Latin', VI: 'Vietnamese' };
  var AUTHOR_ALIAS = {
    '村上春樹': 'Haruki Murakami', '三島由紀夫': 'Yukio Mishima', 'Mishima Yukio': 'Yukio Mishima',
    '太宰治': 'Osamu Dazai', 'Dazai Osamu': 'Osamu Dazai', '夏目漱石': 'Natsume Sōseki', '芥川龍之介': 'Ryūnosuke Akutagawa',
    'ed. Charles W. Eliot': 'Charles W. Eliot (ed.)', '井浦秀夫 / 監修 小林茂和': '井浦秀夫', '渡航 ほか': '渡航',
  };
  var FREE_SOURCE = { gutenberg: 'Project Gutenberg', aozora: 'Aozora Bunko' };

  // ---- Physical and reading assumptions per type ----------------------------
  // pages, spine thickness in mm, weight in grams, words per page.
  var TYPE_ASSUME = {
    'Fiction': [320, 26, 340, 300], 'Manga': [200, 15, 190, 45], 'Anthology': [480, 34, 540, 380],
    'Light novel': [300, 18, 200, 240], 'History': [420, 32, 560, 330], 'Art': [240, 22, 1100, 180],
    'Nonfiction': [300, 24, 380, 300], 'Poetry': [160, 14, 220, 150], 'Religion': [360, 28, 420, 320],
    'Philosophy': [340, 26, 380, 350], 'Self-help': [260, 22, 320, 280], 'Writing craft': [280, 22, 340, 300],
    'Language study': [300, 20, 400, 200], 'Nursing & medical': [700, 40, 1100, 400], 'Test prep': [500, 32, 800, 350],
    'Literary criticism': [300, 24, 380, 350], 'Textbook': [650, 38, 1300, 420], 'Science': [320, 26, 400, 320],
    'Drama': [160, 14, 220, 200], 'Reference': [900, 50, 1400, 500], 'Magazine': [120, 6, 280, 250],
    'Comics': [160, 12, 320, 60], 'Film': [280, 22, 360, 300], 'Psychology': [300, 24, 380, 320],
    'Music': [260, 22, 420, 250], 'Politics': [320, 26, 400, 330], 'Essays': [260, 22, 320, 320],
    'Military': [360, 28, 480, 330], 'Sociology': [300, 24, 380, 340], 'Biography': [400, 30, 520, 330],
    'Memoir': [300, 24, 360, 300], 'Occult': [260, 22, 320, 300], 'Hymnal': [600, 36, 600, 150],
    'Picture book': [40, 8, 300, 50], "Children's": [120, 12, 250, 150], 'Calendar': [28, 6, 250, 20],
    'Documents': [60, 4, 120, 300], 'Technical': [500, 34, 900, 380], 'Linguistics': [320, 26, 400, 350],
    'Society & culture': [300, 24, 380, 320], 'Math journal': [120, 8, 250, 300],
  };
  var DEFAULT_ASSUME = [280, 24, 360, 300];
  var JA_THICK = 0.8, JA_WEIGHT = 0.7;       // bunko and tankōbon are smaller and lighter
  var WPM = 250;
  var STOREY_M = 3.3, PIANO_KG = 300, ADULT_KG = 70, PERSON_M = 1.75;

  // ---- Helpers ---------------------------------------------------------------
  function $(sel, r) { return (r || document).querySelector(sel); }
  function $$(sel, r) { return Array.prototype.slice.call((r || document).querySelectorAll(sel)); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fmt(n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function fmt1(n) { return (Math.round(n * 10) / 10).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }); }
  function pct(n, d) { return Math.round(1000 * n / d) / 10; }
  function plural(n, w, ws) { return fmt(n) + ' ' + (n === 1 ? w : (ws || w + 's')); }
  function hasCJK(s) { return /[぀-ヿ㐀-鿿豈-﫿ｦ-ﾟ]/.test(s); }
  function cpLen(s) { return Array.from(s).length; }
  function fold(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
  function genreColor(g, l) { var h = GENRE_HUE[g]; if (h == null || g === 'Games & other objects' || g === 'Unidentified') return 'hsl(40 6% ' + (l || 52) + '%)'; return 'hsl(' + h + ' 50% ' + (l || 62) + '%)'; }
  function langColor(code) { if (code === 'EN') return 'hsl(214 50% 62%)'; if (code === 'JA') return 'hsl(354 50% 62%)'; return 'hsl(42 55% 60%)'; }
  function langName(code) { if (!code) return 'Unknown'; return code.split('/').map(function (c) { return LANG_NAME[c] || c; }).join(' / '); }
  function ordinal(n) { var s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
  function yearLabel(y) { if (y == null) return 'undated'; return y < 0 ? fmt(-y) + ' BC' : String(y); }
  function authorName(a) { a = (a || '').trim(); if (!a) return ''; if (AUTHOR_ALIAS[a]) return AUTHOR_ALIAS[a]; return a.replace(/^ed\.\s+/i, '').replace(/\s*\((ed|eds|trans)\.\)$/i, ''); }
  function counts(list, key) { var m = {}; list.forEach(function (b) { var k = typeof key === 'function' ? key(b) : b[key]; m[k] = (m[k] || 0) + 1; }); return m; }
  function sortedEntries(m) { return Object.keys(m).map(function (k) { return { k: k, n: m[k] }; }).sort(function (a, b) { return b.n - a.n || (hasCJK(a.k) - hasCJK(b.k)) || a.k.localeCompare(b.k); }); }
  function entropy(m) { var tot = 0, h = 0, k; for (k in m) tot += m[k]; for (k in m) { var p = m[k] / tot; h -= p * Math.log2(p); } return h; }
  function shelfLabel(b) { var u = UNIT_BY_KEY[b.u]; return (u ? u.name : b.u) + ' · ' + (b.u === 'Loose' ? 'Loose' : b.s); }
  function bookLink(b) { return BOOK_URL + encodeURIComponent(b.id); }
  function assume(b) { var a = TYPE_ASSUME[b.ty] || DEFAULT_ASSUME; var ja = /^JA/.test(b.l || '') && b.ty !== 'Art' && b.ty !== 'Magazine'; return { pages: a[0], mm: a[1] * (ja ? JA_THICK : 1), g: a[2] * (ja ? JA_WEIGHT : 1), wpp: a[3] }; }
  function seedFromDate() { var d = new Date(); return d.getFullYear() * 372 + d.getMonth() * 31 + d.getDate(); }
  function mulberry(seed) { var t = seed >>> 0; return function () { t = (t + 0x6D2B79F5) >>> 0; var r = Math.imul(t ^ (t >>> 15), 1 | t); r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r; return ((r ^ (r >>> 14)) >>> 0) / 4294967296; }; }

  // ---- Statistics -------------------------------------------------------------
  function compute(data) {
    var books = data.books.slice();
    var objects = data.objects || [];
    var S = { generated: data.generated, computedAt: new Date().toISOString(), source: 'assets/data/library.json' };
    var i, b;

    // 1 headline
    var perUnit = UNITS.map(function (u) { return { k: u.k, name: u.name, n: books.filter(function (b) { return b.u === u.k; }).length }; }).sort(function (a, b) { return b.n - a.n; });
    var shelfKeys = {};
    books.forEach(function (b) { shelfKeys[b.u + '|' + b.s] = 1; });
    S.headline = { books: books.length, objects: objects.length, bookcases: UNITS.length, shelves: Object.keys(shelfKeys).length, booksPerUnit: perUnit, catalogueRows: data.counts && data.counts.rows, unreadable: data.counts && data.counts.unreadable };

    // 2 physical
    var pages = 0, mm = 0, g = 0, perType = {};
    books.forEach(function (b) { var a = assume(b); pages += a.pages; mm += a.mm; g += a.g; var t = perType[b.ty] || (perType[b.ty] = { type: b.ty, n: 0, pages: 0, mm: 0, g: 0, words: 0 }); t.n++; t.pages += a.pages; t.mm += a.mm; t.g += a.g; t.words += a.pages * a.wpp; });
    var metres = mm / 1000, kg = g / 1000;
    S.physical = {
      assumptions: { perType: TYPE_ASSUME, defaultType: DEFAULT_ASSUME, columns: ['pages', 'spine mm', 'grams', 'words per page'], japaneseModifier: { thickness: JA_THICK, weight: JA_WEIGHT }, storeyMetres: STOREY_M, grandPianoKg: PIANO_KG, adultKg: ADULT_KG },
      totalPages: pages, spineMetres: Math.round(metres * 10) / 10, kilograms: Math.round(kg), storeys: Math.round(metres / STOREY_M * 10) / 10,
      people: Math.round(metres / PERSON_M * 10) / 10, grandPianos: Math.round(kg / PIANO_KG * 100) / 100, adults: Math.round(kg / ADULT_KG * 10) / 10,
      heaviestType: null, perType: Object.keys(perType).map(function (k) { return perType[k]; }).sort(function (a, b) { return b.g - a.g; }),
    };
    S.physical.heaviestType = S.physical.perType[0] && S.physical.perType[0].type;

    // 3 reading time
    var words = 0;
    Object.keys(perType).forEach(function (k) { words += perType[k].words; });
    var minutes = words / WPM;
    S.reading = { wordsPerMinute: WPM, words: Math.round(words), minutes: Math.round(minutes), hours: Math.round(minutes / 60), days24h: Math.round(minutes / 1440 * 10) / 10,
      yearsAt: { 1: Math.round(minutes / 60 / 365.25 * 100) / 100, 2: Math.round(minutes / 120 / 365.25 * 100) / 100, 4: Math.round(minutes / 240 / 365.25 * 100) / 100, 8: Math.round(minutes / 480 / 365.25 * 100) / 100 },
      perType: Object.keys(perType).map(function (k) { var t = perType[k]; return { type: k, books: t.n, pages: t.pages, words: Math.round(t.words), hours: Math.round(t.words / WPM / 60 * 10) / 10 }; }).sort(function (a, b) { return b.hours - a.hours; }) };

    // 4 languages
    var lc = counts(books, 'l');
    var bilingual = [], other = [];
    Object.keys(lc).forEach(function (k) { if (k === 'EN' || k === 'JA') return; (k.indexOf('/') >= 0 ? bilingual : other).push({ code: k, name: langName(k), n: lc[k] }); });
    bilingual.sort(function (a, b) { return b.n - a.n; }); other.sort(function (a, b) { return b.n - a.n; });
    S.languages = { english: lc.EN || 0, japanese: lc.JA || 0, bilingual: bilingual, other: other, bilingualTotal: bilingual.reduce(function (s, x) { return s + x.n; }, 0), otherTotal: other.reduce(function (s, x) { return s + x.n; }, 0) };

    // 5 genres
    var gc = counts(books, 'g');
    S.genres = sortedEntries(gc).map(function (e) {
      var ac = counts(books.filter(function (b) { return b.g === e.k && authorName(b.a); }), function (b) { return authorName(b.a); });
      return { genre: e.k, books: e.n, share: pct(e.n, books.length), hue: GENRE_HUE[e.k], topAuthors: sortedEntries(ac).slice(0, 3).map(function (a) { return { author: a.k, books: a.n }; }) };
    });

    // 6 eras
    var dated = books.filter(function (b) { return typeof b.y === 'number'; }).sort(function (a, b) { return a.y - b.y; });
    var bins = {}, binOrder = [];
    function binOf(y) { if (y < 1500) return 'before 1500'; var s = Math.floor(y / 50) * 50; return s + '–' + String(s + 49).slice(2); }
    dated.forEach(function (b) { var k = binOf(b.y); if (!bins[k]) { bins[k] = { label: k, from: b.y < 1500 ? null : Math.floor(b.y / 50) * 50, n: 0 }; binOrder.push(k); } bins[k].n++; });
    for (var y = 1500; y <= 2000; y += 50) { var k = binOf(y); if (!bins[k]) { bins[k] = { label: k, from: y, n: 0 }; binOrder.push(k); } }
    var eraBins = binOrder.map(function (k) { return bins[k]; }).sort(function (a, b) { return (a.from == null ? -1e9 : a.from) - (b.from == null ? -1e9 : b.from); });
    var median = dated[Math.floor(dated.length / 2)].y;
    var decades = counts(dated.filter(function (b) { return b.y >= 1500; }), function (b) { return Math.floor(b.y / 10) * 10; });
    var topDecade = sortedEntries(decades)[0];
    S.eras = { dated: dated.length, undated: books.length - dated.length, medianYear: median, meanYearSince1500: Math.round(dated.filter(function (b) { return b.y >= 1500; }).reduce(function (s, b) { return s + b.y; }, 0) / dated.filter(function (b) { return b.y >= 1500; }).length),
      oldest: { id: dated[0].id, title: dated[0].t, year: dated[0].y }, newest: { id: dated[dated.length - 1].id, title: dated[dated.length - 1].t, year: dated[dated.length - 1].y },
      busiestDecade: { decade: +topDecade.k, books: topDecade.n }, thisCentury: dated.filter(function (b) { return b.y >= 2000; }).length, bins: eraBins };

    // 7 authors
    var attributed = books.filter(function (b) { return authorName(b.a); });
    var ac = counts(attributed, function (b) { return authorName(b.a); });
    var authors = sortedEntries(ac);
    var topK = Math.ceil(authors.length * 0.1);
    var topShare = authors.slice(0, topK).reduce(function (s, a) { return s + a.n; }, 0);
    S.authors = { distinct: authors.length, attributedBooks: attributed.length, noAuthor: books.length - attributed.length, appearOnce: authors.filter(function (a) { return a.n === 1; }).length,
      top10pct: { authors: topK, books: topShare, shareOfAttributed: pct(topShare, attributed.length) },
      top15: authors.slice(0, 15).map(function (a) { return { author: a.k, books: a.n }; }) };

    // 8 shelves
    var unitGenres = UNITS.map(function (u) { var list = books.filter(function (b) { return b.u === u.k; }); var m = counts(list, 'g'); return { key: u.k, name: u.name, books: list.length, genres: sortedEntries(m).map(function (e) { return { genre: e.k, books: e.n }; }), entropyBits: Math.round(entropy(m) * 100) / 100 }; }).sort(function (a, b) { return b.books - a.books; });
    var shelfStats = Object.keys(shelfKeys).map(function (k) { var u = k.split('|')[0], s = k.split('|')[1]; var list = books.filter(function (b) { return b.u === u && b.s === s; }); var m = counts(list, 'g'); var top = sortedEntries(m)[0]; return { unit: u, unitName: UNIT_BY_KEY[u] ? UNIT_BY_KEY[u].name : u, shelf: s, books: list.length, genres: Object.keys(m).length, entropyBits: Math.round(entropy(m) * 100) / 100, topGenre: top.k, topGenreBooks: top.n }; });
    var big = shelfStats.filter(function (s) { return s.books >= 8; });
    var mostMixed = big.slice().sort(function (a, b) { return b.entropyBits - a.entropyBits || b.books - a.books; })[0];
    var purest = big.slice().sort(function (a, b) { return a.entropyBits - b.entropyBits || b.books - a.books; })[0];
    var fullest = shelfStats.slice().sort(function (a, b) { return b.books - a.books; })[0];
    S.shelves = { units: unitGenres, shelves: shelfStats.sort(function (a, b) { return b.books - a.books; }), mostMixed: mostMixed, purest: purest, fullest: fullest };

    // 9 titles
    var byLen = books.slice().sort(function (a, b) { return cpLen(b.t) - cpLen(a.t) || a.t.localeCompare(b.t); });
    var longest = byLen[0], shortest = byLen[byLen.length - 1];
    var fw = {}, fwNoArt = {};
    var ARTICLES = { the: 1, a: 1, an: 1, of: 1, on: 1, in: 1, to: 1, and: 1 };
    books.forEach(function (b) { var w = b.t.trim().split(/\s+/)[0]; if (!w || hasCJK(w)) return; var k = w.replace(/[^\p{L}\p{N}']/gu, '').toLowerCase(); if (!k) return; fw[k] = (fw[k] || 0) + 1; if (!ARTICLES[k]) fwNoArt[k] = (fwNoArt[k] || 0) + 1; });
    var fwTop = sortedEntries(fw)[0], fwTop2 = sortedEntries(fwNoArt)[0];
    var theBooks = books.filter(function (b) { return /^the\s/i.test(b.t); });
    var cjkLen = function (t) { return Array.from(t).filter(function (c) { return /[぀-ヿ㐀-鿿豈-﫿ｦ-ﾟ]/.test(c); }).length; };
    var jaTitles = books.filter(function (b) { return hasCJK(b.t); }).sort(function (a, b) { return cjkLen(b.t) - cjkLen(a.t); });
    var lens = books.map(function (b) { return cpLen(b.t); });
    var lenHist = {};
    lens.forEach(function (n) { var k = Math.min(Math.floor(n / 10) * 10, 80); lenHist[k] = (lenHist[k] || 0) + 1; });
    var oneWord = books.filter(function (b) { return !hasCJK(b.t) && b.t.trim().split(/\s+/).length === 1; });
    S.titles = { longest: { id: longest.id, title: longest.t, chars: cpLen(longest.t) }, shortest: { id: shortest.id, title: shortest.t, chars: cpLen(shortest.t) },
      shortestLatin: (function () { var l = byLen.filter(function (b) { return !hasCJK(b.t); }); var s = l[l.length - 1]; return { id: s.id, title: s.t, chars: cpLen(s.t) }; })(),
      mostCommonFirstWord: { word: fwTop.k, titles: fwTop.n }, mostCommonFirstWordExcludingArticles: { word: fwTop2.k, titles: fwTop2.n }, startWithThe: theBooks.length,
      longestJapanese: jaTitles[0] ? { id: jaTitles[0].id, title: jaTitles[0].t, chars: cpLen(jaTitles[0].t), cjkChars: cjkLen(jaTitles[0].t) } : null, japaneseScriptTitles: jaTitles.length,
      meanChars: Math.round(lens.reduce(function (s, n) { return s + n; }, 0) / lens.length * 10) / 10, oneWordTitles: oneWord.length,
      lengthHistogram: Object.keys(lenHist).map(function (k) { return { from: +k, to: +k === 80 ? null : +k + 9, n: lenHist[k] }; }).sort(function (a, b) { return a.from - b.from; }) };
    S._theBooks = theBooks; S._oneWord = oneWord; S._jaTitles = jaTitles;

    // 10 copies and series
    var COPY_RE = /\s*\((?:hardcover|paperback|hc|pb)?,?\s*copy\s*\d+\)\s*$/i;
    var groups = {};
    books.forEach(function (b) { var k = fold(b.t.replace(COPY_RE, '')) + '|' + fold(authorName(b.a)); (groups[k] || (groups[k] = [])).push(b); });
    var copies = Object.keys(groups).filter(function (k) { return groups[k].length > 1; }).map(function (k) { var g = groups[k]; return { title: g[0].t.replace(COPY_RE, ''), author: authorName(g[0].a), copies: g.length, marked: g.some(function (b) { return COPY_RE.test(b.t); }), ids: g.map(function (b) { return b.id; }), shelves: g.map(shelfLabel) }; }).sort(function (a, b) { return b.copies - a.copies || a.title.localeCompare(b.title); });
    var VOL_RES = [
      /,?\s*\d+-in-1\s+edition,?\s*(vols?\.?|volumes?)\s*[\d]+\s*[-–]\s*\d+\s*$/i,
      /,?\s*(vols?\.?|volumes?|books?|levels?|parts?|tomes?)\s*[\dIVX]+(\s*[-–]\s*[\dIVX]+)?\s*$/i,
      /\s*[(（]\s*\d+\s*[)）]\s*$/, /\s*第?\s*[\d０-９]+\s*巻\s*$/, /\s*巻之[一二三四五六七八九十]+\s*$/, /\s+[\d０-９]+\s*$/,
    ];
    function stripVol(t) { var s = t; var hit = false; for (var i = 0; i < VOL_RES.length; i++) { if (VOL_RES[i].test(s)) { s = s.replace(VOL_RES[i], ''); hit = true; break; } } return hit ? s.trim().replace(/[,:：\-–]\s*$/, '').trim() : null; }
    function volNum(t) { var m = t.match(/(\d+)\s*(?:[-–]\s*(\d+))?\s*(?:\)|）|巻)?\s*$/); if (m) return +(m[2] || m[1]); var z = t.match(/巻之([一二三四五六七八九十]+)$/); if (z) return { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }[z[1]] || null; return null; }
    var series = {};
    books.filter(function (b) { return b.ty === 'Manga' || b.ty === 'Comics' || b.ty === 'Light novel'; }).forEach(function (b) {
      var base = stripVol(b.t); if (!base || cpLen(base) < 2) return; var k = fold(base);
      var s = series[k] || (series[k] = { title: base, type: b.ty, volumes: 0, maxVolume: 0, ids: [], books: [] });
      s.volumes++; s.ids.push(b.id); s.books.push(b); var v = volNum(b.t); if (v && v > s.maxVolume) s.maxVolume = v;
    });
    var seriesList = Object.keys(series).map(function (k) { return series[k]; }).filter(function (s) { return s.volumes > 1; }).sort(function (a, b) { return b.volumes - a.volumes || b.maxVolume - a.maxVolume; });
    var highestVol = Object.keys(series).map(function (k) { return series[k]; }).sort(function (a, b) { return b.maxVolume - a.maxVolume; })[0];
    S.copies = { duplicateTitles: copies.length, duplicateBooks: copies.reduce(function (s, c) { return s + c.copies; }, 0), extraCopies: copies.reduce(function (s, c) { return s + c.copies - 1; }, 0), explicitlyMarked: copies.filter(function (c) { return c.marked; }).length, list: copies };
    S.series = { detectedIn: ['Manga', 'Comics', 'Light novel'], seriesWithMultipleVolumes: seriesList.length, volumesInSeries: seriesList.reduce(function (s, x) { return s + x.volumes; }, 0),
      longestRun: seriesList[0] ? { title: seriesList[0].title, volumes: seriesList[0].volumes, maxVolume: seriesList[0].maxVolume } : null,
      highestVolumeNumber: highestVol && highestVol.maxVolume ? { title: highestVol.title, volume: highestVol.maxVolume } : null,
      list: seriesList.map(function (s) { return { title: s.title, type: s.type, volumes: s.volumes, maxVolume: s.maxVolume, ids: s.ids }; }) };
    S._series = seriesList;

    // 11 free e-texts
    var free = books.filter(function (b) { return b.free && b.free.url; });
    var fc = counts(free, function (b) { return b.free.src; });
    S.free = { books: free.length, share: pct(free.length, books.length), bySource: Object.keys(fc).map(function (k) { return { source: FREE_SOURCE[k] || k, key: k, books: fc[k] }; }).sort(function (a, b) { return b.books - a.books; }),
      list: free.map(function (b) { return { id: b.id, title: b.t, author: authorName(b.a), source: FREE_SOURCE[b.free.src] || b.free.src, url: b.free.url }; }) };
    S._free = free;

    // 12 did you know
    var facts = [];
    var top = S.authors.top15[0];
    var manga = books.filter(function (b) { return b.ty === 'Manga'; }).length;
    var partial = books.filter(function (b) { return b.st === 'Partial'; }).length;
    var hc = books.filter(function (b) { return /^HC /.test(b.s); }).length;
    var floor = books.filter(function (b) { return b.u === 'Loose'; }).length;
    var oldest = S.eras.oldest, newest = S.eras.newest;
    var bigUnit = perUnit[0];
    var yearNow = new Date().getFullYear();
    var thisYear = books.filter(function (b) { return b.y === yearNow; });
    var beforeOwner = dated.filter(function (b) { return b.y < 1900; }).length;
    facts.push({ html: 'The oldest text on the shelves was first written around <b>' + yearLabel(oldest.year) + '</b>: <a href="' + bookLink(oldest) + '">' + esc(oldest.title) + '</a>.' });
    facts.push({ html: 'One in every <b>' + Math.round(books.length / manga) + '</b> books is manga.' });
    facts.push({ html: '<b>' + esc(top.author) + '</b> appears ' + plural(top.books, 'time') + ', more than any other name.' });
    facts.push({ html: bigUnit.name + ' alone holds <b>' + pct(bigUnit.n, books.length) + '%</b> of the library.' });
    facts.push({ html: '<b>' + plural(S.authors.appearOnce, 'author') + '</b> appear exactly once.' });
    facts.push({ html: 'The Harvard Classics are <b>' + hc + '</b> volumes, ' + pct(hc, books.length) + '% of everything.' });
    facts.push({ html: '<b>' + plural(floor, 'book') + '</b> were on the desk or the floor when the photos were taken.' });
    facts.push({ html: '<b>' + plural(partial, 'spine') + '</b> could only be partly read; their records are marked Partial.' });
    facts.push({ html: 'Read for an hour a day and the whole library takes about <b>' + fmt1(S.reading.yearsAt[1]) + ' years</b>.' });
    facts.push({ html: 'Laid spine to spine, the books stretch <b>' + fmt1(metres) + ' m</b>, about ' + fmt1(S.physical.people) + ' people lying head to toe.' });
    facts.push({ html: '<b>' + plural(S.titles.startWithThe, 'title') + '</b> start with "The"; the pine library files every one of them after S.' });
    facts.push({ html: '<b>' + plural(beforeOwner, 'book') + '</b> were first published before 1900.' });
    facts.push({ html: 'The newest book was first published in <b>' + newest.year + '</b>: <a href="' + bookLink(newest) + '">' + esc(newest.title) + '</a>.' });
    if (thisYear.length) facts.push({ html: '<b>' + plural(thisYear.length, 'book') + '</b> came out this year.' });
    facts.push({ html: '<b>' + plural(S.free.books, 'book') + '</b> can be read free online right now, mostly on Project Gutenberg.' });
    facts.push({ html: 'The most mixed shelf is <b>' + esc(mostMixed.shelf) + '</b> in the ' + esc(mostMixed.unitName) + ', with ' + mostMixed.genres + ' genres on ' + plural(mostMixed.books, 'book') + '.' });
    if (seriesList[0]) facts.push({ html: 'The longest run is <b>' + esc(seriesList[0].title) + '</b>, ' + plural(seriesList[0].volumes, 'volume') + ' on the shelf.' });
    facts.push({ html: 'At ' + fmt(kg) + ' kg the library weighs about <b>' + fmt1(S.physical.adults) + ' adults</b>.' });
    facts.push({ html: 'The median book was first published in <b>' + median + '</b>; half the dated library is older, half newer.' });
    S.didYouKnow = facts.map(function (f) { return f.html.replace(/<[^>]+>/g, ''); });
    S._facts = facts;

    S._books = books;
    return S;
  }

  // ---- SVG chart helpers -------------------------------------------------------
  function svgOpen(w, h, extra) { return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + w + ' ' + h + '" width="' + w + '" height="' + h + '" role="img" ' + (extra || '') + '>'; }
  function tipAttr(html) { return ' data-tip="' + esc(html) + '"'; }
  function textW(s, size) { var n = 0; Array.from(s).forEach(function (c) { n += /[　-鿿豈-﫿＀-￯]/.test(c) ? 1 : (/[A-Z]/.test(c) ? 0.68 : (/[mw]/.test(c) ? 0.82 : 0.52)); }); return n * (size || 12); }
  function trunc(s, maxW, size) { if (textW(s, size) <= maxW) return s; var a = Array.from(s); while (a.length > 1 && textW(a.join('') + '…', size) > maxW) a.pop(); return a.join('') + '…'; }
  function ends(x, y, w, h, r) { // bar with rounded data end (right side), square at the baseline
    r = Math.min(r || 4, w / 2, h / 2);
    return 'M' + x + ' ' + y + 'h' + (w - r) + 'a' + r + ' ' + r + ' 0 0 1 ' + r + ' ' + r + 'v' + (h - 2 * r) + 'a' + r + ' ' + r + ' 0 0 1 -' + r + ' ' + r + 'h-' + (w - r) + 'z';
  }
  function capTop(x, y, w, h, r) { // column with rounded top
    r = Math.min(r || 4, w / 2, h / 2);
    return 'M' + x + ' ' + (y + h) + 'v-' + (h - r) + 'a' + r + ' ' + r + ' 0 0 1 ' + r + ' -' + r + 'h' + (w - 2 * r) + 'a' + r + ' ' + r + ' 0 0 1 ' + r + ' ' + r + 'v' + (h - r) + 'z';
  }

  // horizontal bars: rows [{label, value, color, tip, sub}]
  function hbars(rows, w, opts) {
    opts = opts || {};
    var labW = Math.min(opts.labelWidth || 200, Math.max(90, Math.round(w * 0.36)));
    var rowH = opts.rowH || 24, barH = Math.min(opts.barH || 14, rowH - 6), gap = 2;
    var valW = 44, max = Math.max.apply(null, rows.map(function (r) { return r.value; })) || 1;
    var plotW = w - labW - valW - 8;
    var h = rows.length * rowH + 4;
    var out = svgOpen(w, h);
    rows.forEach(function (r, i) {
      var y = 2 + i * rowH, bw = Math.max(2, plotW * r.value / max);
      var label = trunc(r.label, labW - 10, 12);
      out += '<g class="bar"' + tipAttr(r.tip || (r.label + ': ' + fmt(r.value))) + '>';
      out += '<rect x="0" y="' + y + '" width="' + w + '" height="' + rowH + '" fill="transparent"/>';
      out += '<text x="' + (labW - 8) + '" y="' + (y + rowH / 2 + 4) + '" text-anchor="end" class="v">' + esc(label) + '</text>';
      out += '<path d="' + ends(labW, y + (rowH - barH) / 2, bw, barH, 4) + '" fill="' + (r.color || 'var(--accent)') + '"/>';
      out += '<text x="' + (labW + bw + 8) + '" y="' + (y + rowH / 2 + 4) + '">' + esc(r.valueLabel || fmt(r.value)) + '</text>';
      out += '</g>';
    });
    return out + '</svg>';
  }

  // columns: bins [{label, value, tip, color}]
  function columns(bins, w, opts) {
    opts = opts || {};
    var h = opts.height || 150, padB = 22, padT = 18, padL = 0;
    var n = bins.length, slot = (w - padL) / n, cw = Math.min(opts.maxBarW || 24, slot - 2);
    var max = Math.max.apply(null, bins.map(function (b) { return b.value; })) || 1;
    var plotH = h - padB - padT;
    var out = svgOpen(w, h);
    var ticks = niceTicks(max, 3);
    ticks.forEach(function (t) { var y = padT + plotH - plotH * t / max; out += '<line class="grid" x1="' + padL + '" x2="' + w + '" y1="' + y + '" y2="' + y + '"/>'; if (t) out += '<text x="' + w + '" y="' + (y - 3) + '" text-anchor="end" class="k">' + fmt(t) + '</text>'; });
    out += '<line class="axis" x1="' + padL + '" x2="' + w + '" y1="' + (padT + plotH) + '" y2="' + (padT + plotH) + '"/>';
    var labelEvery = Math.max(1, Math.ceil(textW(bins[0].label, 11) / slot));
    bins.forEach(function (b, i) {
      var x = padL + i * slot + (slot - cw) / 2, bh = plotH * b.value / max, y = padT + plotH - bh;
      out += '<g class="bar"' + tipAttr(b.tip || (b.label + ': ' + fmt(b.value))) + '>';
      out += '<rect x="' + (padL + i * slot) + '" y="' + padT + '" width="' + slot + '" height="' + (plotH + padB) + '" fill="transparent"/>';
      if (b.value > 0) out += '<path d="' + capTop(x, y, cw, bh, 4) + '" fill="' + (b.color || 'var(--accent)') + '"/>';
      if (b.mark) out += '<text x="' + (x + cw / 2) + '" y="' + (y - 5) + '" text-anchor="middle" class="v">' + esc(b.mark) + '</text>';
      if (i % labelEvery === 0 || b.always) out += '<text x="' + (x + cw / 2) + '" y="' + (h - 6) + '" text-anchor="middle" class="k">' + esc(b.label) + '</text>';
      out += '</g>';
    });
    return out + '</svg>';
  }
  function niceTicks(max, count) { var raw = max / count, mag = Math.pow(10, Math.floor(Math.log10(raw))), step = [1, 2, 2.5, 5, 10].map(function (m) { return m * mag; }).filter(function (s) { return s >= raw; })[0]; var t = []; for (var v = 0; v <= max; v += step) t.push(v); return t; }

  // one stacked bar (part-to-whole) with 2px gaps: segs [{value, color, label, tip}]
  function stackedBar(segs, w, h, opts) {
    opts = opts || {};
    var total = segs.reduce(function (s, x) { return s + x.value; }, 0) || 1, gap = 2, x = 0;
    var out = svgOpen(w, h + (opts.labels ? 18 : 0));
    segs.forEach(function (s, i) {
      var sw = w * s.value / total; var inner = Math.max(0, sw - (i < segs.length - 1 ? gap : 0));
      out += '<g class="bar"' + tipAttr(s.tip || (s.label + ': ' + fmt(s.value) + ' (' + pct(s.value, total) + '%)')) + '>';
      out += '<rect x="' + x + '" y="0" width="' + Math.max(inner, 0.5) + '" height="' + h + '" fill="' + s.color + '" rx="' + (opts.rx == null ? 2 : opts.rx) + '"/>';
      if (opts.labels && inner > textW(s.label, 12) + 8) out += '<text x="' + (x + 2) + '" y="' + (h + 14) + '" class="v">' + esc(s.label) + '</text>';
      out += '</g>';
      x += sw;
    });
    return out + '</svg>';
  }

  // ---- Illustrations ---------------------------------------------------------
  function heightIllustration(S, w) {
    var metres = S.physical.spineMetres, storeys = Math.max(1, Math.floor(metres / STOREY_M));
    var h = Math.min(360, Math.max(240, Math.round(w * 0.42)));
    var padB = 26, padT = 24, ground = h - padB;
    var maxM = Math.max(metres, storeys * STOREY_M) * 1.04;
    var scale = (ground - padT) / maxM;
    var out = svgOpen(w, h);
    var cols = [0.17, 0.5, 0.8];
    // ground
    out += '<line class="axis" x1="0" x2="' + w + '" y1="' + ground + '" y2="' + ground + '"/>';
    // height ticks on the right
    niceTicks(maxM, 4).forEach(function (t) { if (!t) return; var y = ground - t * scale; out += '<line class="grid" x1="0" x2="' + w + '" y1="' + y + '" y2="' + y + '"/><text x="' + w + '" y="' + (y - 3) + '" text-anchor="end" class="k">' + t + ' m</text>'; });
    // the stack of books: alternating thin rectangles
    var sx = w * cols[0], stackW = Math.min(64, w * 0.12), stackH = metres * scale;
    var band = 0, y = ground, top = ground - stackH;
    var rnd = mulberry(7);
    out += '<g' + tipAttr('Every book stacked flat: ' + fmt1(metres) + ' m, ' + fmt1(metres / STOREY_M) + ' storeys') + '>';
    while (y - top > 0.8) {
      var bh = Math.min(y - top, 2 + rnd() * 5);
      var jitter = (rnd() - 0.5) * 8, bw = stackW - Math.abs(jitter) * 0.6;
      out += '<rect x="' + (sx - bw / 2 + jitter / 2) + '" y="' + (y - bh) + '" width="' + bw + '" height="' + Math.max(0.8, bh - 0.8) + '" fill="' + (band++ % 2 ? 'rgba(232,181,106,0.85)' : 'rgba(232,181,106,0.55)') + '"/>';
      y -= bh;
    }
    out += '<text x="' + sx + '" y="' + (ground - stackH - 8) + '" text-anchor="middle" class="big">' + fmt1(metres) + ' m</text>';
    out += '<text x="' + sx + '" y="' + (ground + 16) + '" text-anchor="middle" class="k">' + fmt(S.headline.books) + ' books, stacked</text></g>';
    // building
    var bx = w * cols[1], bW = Math.min(110, w * 0.2), bH = storeys * STOREY_M * scale;
    out += '<g' + tipAttr('A ' + storeys + '-storey building at ' + STOREY_M + ' m a floor: ' + fmt1(storeys * STOREY_M) + ' m') + '>';
    out += '<rect class="sil-fill" x="' + (bx - bW / 2) + '" y="' + (ground - bH) + '" width="' + bW + '" height="' + bH + '"/>';
    out += '<rect class="sil" x="' + (bx - bW / 2) + '" y="' + (ground - bH) + '" width="' + bW + '" height="' + bH + '"/>';
    for (var f = 1; f <= storeys; f++) {
      var fy = ground - f * STOREY_M * scale, fh = STOREY_M * scale;
      if (f < storeys) out += '<line class="grid" x1="' + (bx - bW / 2) + '" x2="' + (bx + bW / 2) + '" y1="' + fy + '" y2="' + fy + '"/>';
      var winN = 3, ww = bW / (winN * 2 + 1);
      for (var k = 0; k < winN; k++) { var wx = bx - bW / 2 + ww * (2 * k + 1); out += '<rect x="' + wx + '" y="' + (fy + fh * 0.25) + '" width="' + ww + '" height="' + (fh * 0.45) + '" fill="rgba(236,228,212,0.14)"/>'; }
    }
    out += '<text x="' + bx + '" y="' + (ground - bH - 8) + '" text-anchor="middle" class="big">' + storeys + ' storeys</text>';
    out += '<text x="' + bx + '" y="' + (ground + 16) + '" text-anchor="middle" class="k">' + STOREY_M + ' m a floor</text></g>';
    // person
    var px = w * cols[2], pH = PERSON_M * scale, headR = pH * 0.11;
    out += '<g' + tipAttr('A person, ' + PERSON_M + ' m') + '>';
    out += '<circle class="sil" cx="' + px + '" cy="' + (ground - pH + headR) + '" r="' + headR + '"/>';
    out += '<path class="sil" d="M' + px + ' ' + (ground - pH + headR * 2) + 'v' + (pH * 0.42) + 'm0 0l-' + (headR * 1.1) + ' ' + (pH * 0.36) + 'm' + (headR * 1.1) + ' -' + (pH * 0.36) + 'l' + (headR * 1.1) + ' ' + (pH * 0.36) + 'M' + (px - headR * 1.5) + ' ' + (ground - pH + headR * 2 + pH * 0.3) + 'l' + (headR * 1.5) + ' -' + (pH * 0.24) + 'l' + (headR * 1.5) + ' ' + (pH * 0.24) + '"/>';
    out += '<text x="' + px + '" y="' + (ground - pH - 8) + '" text-anchor="middle" class="big">' + PERSON_M + ' m</text>';
    out += '<text x="' + px + '" y="' + (ground + 16) + '" text-anchor="middle" class="k">one reader</text></g>';
    return out + '</svg>';
  }

  function pianoPath(x, y, s) { // a grand piano seen from above: keyboard along the bottom, straight bass side, curved treble side into the tail
    var h = s * 0.9, X = function (f) { return (x + s * f).toFixed(1); }, Y = function (f) { return (y + h * f).toFixed(1); };
    return 'M' + X(0) + ' ' + Y(1) + 'L' + X(1) + ' ' + Y(1) + 'C' + X(1) + ' ' + Y(0.6) + ' ' + X(0.84) + ' ' + Y(0.5) + ' ' + X(0.68) + ' ' + Y(0.4) + 'C' + X(0.55) + ' ' + Y(0.3) + ' ' + X(0.46) + ' ' + Y(0) + ' ' + X(0.3) + ' ' + Y(0) + 'L' + X(0) + ' ' + Y(0) + 'Z';
  }
  function weightIllustration(S, w) {
    var pianos = S.physical.kilograms / PIANO_KG, n = Math.ceil(pianos);
    var adults = S.physical.kilograms / ADULT_KG;
    var h = 120, size = Math.min(96, Math.floor((w - 8) / n) - 10), x = 0, y = 14;
    var out = svgOpen(w, h);
    out += '<defs><clipPath id="piano-clip"><rect x="0" y="0" width="' + (x + (n - 1) * (size + 10) + size * (pianos - (n - 1))) + '" height="' + h + '"/></clipPath></defs>';
    for (var i = 0; i < n; i++) {
      var px = x + i * (size + 10);
      out += '<g' + tipAttr('Grand piano ' + (i + 1) + ' of ' + fmt1(pianos) + ' at ' + PIANO_KG + ' kg each') + '>';
      out += '<path class="sil" d="' + pianoPath(px, y, size) + '"/>';
      out += '<path d="' + pianoPath(px, y, size) + '" fill="rgba(232,181,106,0.55)" clip-path="url(#piano-clip)"/>';
      out += '<rect x="' + (px + size * 0.04) + '" y="' + (y + size * 0.9 - size * 0.14) + '" width="' + (size * 0.92) + '" height="' + (size * 0.07) + '" fill="rgba(16,15,13,0.85)" rx="1"/>';
      out += '</g>';
    }
    out += '<text x="0" y="' + (y + size * 0.9 + 18) + '" class="k">' + fmt1(pianos) + ' grand pianos at ' + PIANO_KG + ' kg, or about ' + fmt1(adults) + ' adults at ' + ADULT_KG + ' kg</text>';
    return out + '</svg>';
  }

  function calendarStrip(S, w, hoursPerDay) {
    var days = S.reading.minutes / 60 / hoursPerDay;
    var start = new Date(); start.setHours(0, 0, 0, 0);
    var end = new Date(start.getTime() + days * 86400000);
    var y0 = start.getFullYear(), y1 = end.getFullYear();
    var years = y1 - y0 + 1;
    var labW = 44, cellGap = 2, cw = (w - labW - 11 * cellGap) / 12, ch = Math.max(10, Math.min(16, Math.floor(360 / Math.max(years, 1)))), rowH = ch + 4;
    var h = years * rowH + 22;
    var out = svgOpen(w, h);
    for (var y = y0; y <= y1; y++) {
      var ry = (y - y0) * rowH + 18;
      out += '<text x="0" y="' + (ry + ch - 2) + '" class="k">' + y + '</text>';
      for (var m = 0; m < 12; m++) {
        var ms = new Date(y, m, 1), me = new Date(y, m + 1, 1);
        var a = Math.max(ms.getTime(), start.getTime()), b = Math.min(me.getTime(), end.getTime());
        var frac = Math.max(0, Math.min(1, (b - a) / (me.getTime() - ms.getTime())));
        var cx = labW + m * (cw + cellGap);
        var tip = ms.toLocaleString('en-US', { month: 'long', year: 'numeric' }) + (frac >= 1 ? ': reading all month' : frac > 0 ? ': ' + Math.round(frac * 100) + '% of the month' : ': done');
        out += '<g' + tipAttr(tip) + '><rect x="' + cx + '" y="' + ry + '" width="' + cw + '" height="' + ch + '" rx="2" class="ink-soft"/>';
        if (frac > 0) out += '<rect x="' + cx + '" y="' + ry + '" width="' + (cw * frac) + '" height="' + ch + '" rx="2" class="acc"/>';
        out += '</g>';
      }
    }
    for (var mm = 0; mm < 12; mm++) out += '<text x="' + (labW + mm * (cw + cellGap) + cw / 2) + '" y="10" text-anchor="middle" class="k">' + 'JFMAMJJASOND'[mm] + '</text>';
    out += '<text x="' + w + '" y="' + (h - 2) + '" text-anchor="end" class="k">finishes ' + end.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) + '</text>';
    return out + '</svg>';
  }

  // ---- Page --------------------------------------------------------------------
  var S = null, charts = [];
  var SECTIONS = [
    { id: 'headline', nav: 'Headline' }, { id: 'physical', nav: 'Mass' }, { id: 'time', nav: 'Time' }, { id: 'languages', nav: 'Languages' },
    { id: 'genres', nav: 'Genres' }, { id: 'eras', nav: 'Eras' }, { id: 'authors', nav: 'Authors' }, { id: 'shelves', nav: 'Shelves' },
    { id: 'titles', nav: 'Titles' }, { id: 'copies', nav: 'Copies' }, { id: 'free', nav: 'Free' }, { id: 'know', nav: 'Did you know' },
  ];

  function num(v, opts) { // counter span
    opts = opts || {};
    var dec = opts.dec || 0;
    return '<span class="num" data-to="' + v + '" data-dec="' + dec + '"' + (opts.plain ? ' data-plain="1"' : '') + '>' + (INSTANT ? (dec ? fmt1(v) : (opts.plain ? String(v) : fmt(v))) : '0') + '</span>';
  }
  function fig(v, label, opts) { opts = opts || {}; return '<div class="fig"><div class="big">' + num(v, opts) + (opts.unit ? '<small>' + opts.unit + '</small>' : '') + '</div><div class="lab">' + label + '</div></div>'; }
  function chartBox(id) { return '<div class="chart" data-chart="' + id + '"></div>'; }
  function bookItem(b, extra) {
    var a = authorName(b.a);
    return '<li><a href="' + bookLink(b) + '"><span class="t">' + esc(b.t) + '</span> <span class="m">' + (a ? '<span class="x">' + esc(a) + '</span> · ' : '') + yearLabel(b.y) + ' · ' + esc(shelfLabel(b)) + '</span></a>' + (extra || '') + '</li>';
  }
  function showBooks(key) {
    var list = LISTS[key] ? LISTS[key].list : [];
    return '<details class="showbooks" data-list="' + key + '"><summary>show the books<span class="pill">' + fmt(list.length) + '</span></summary><div class="lb" data-key="' + key + '"></div></details>';
  }
  var LISTS = {};
  function defList(key, list, extraFn) { LISTS[key] = { list: list, extraFn: extraFn }; }
  function renderList(box, key, all) {
    var L = LISTS[key]; if (!L) return;
    var list = all ? L.list : L.list.slice(0, 80);
    box.innerHTML = '<ul class="booklist">' + list.map(function (b) { return bookItem(b, L.extraFn ? L.extraFn(b) : ''); }).join('') + '</ul>' +
      (L.list.length > list.length ? '<button class="small morebtn" data-more="' + key + '">show all ' + fmt(L.list.length) + '</button>' : '');
  }

  function sectionHtml(n, id, title, lede, body) {
    return '<section class="sec' + (id === 'headline' ? ' hero' : '') + '" id="s-' + id + '"><p class="eyebrow"><span class="n">' + n + '</span>' + SECTIONS[n - 1].nav + '</p><h2>' + title + '</h2>' + (lede ? '<p class="lede">' + lede + '</p>' : '') + body + '</section>';
  }

  function build() {
    var books = S._books, H = S.headline, P = S.physical, R = S.reading, Lg = S.languages, E = S.eras, A = S.authors, Sh = S.shelves, T = S.titles, C = S.copies, Sr = S.series, F = S.free;
    var html = '';

    // 1 headline
    defList('all', books.slice().sort(function (a, b) { return (hasCJK(a.t) - hasCJK(b.t)) || a.t.localeCompare(b.t); }));
    html += sectionHtml(1, 'headline', 'One library, counted.',
      'Every number on this page is computed from the catalogue the moment you open it. The catalogue was built from shelf photographs; ' + fmt(H.unreadable || 0) + ' spines could not be read at all and are not counted.',
      '<div class="figs">' + fig(H.books, 'books') + fig(H.objects, 'objects that are not books') + fig(H.bookcases, 'bookcases') + fig(H.shelves, 'shelves') + '</div>' +
      chartBox('units') + '<p class="mini">Books per bookcase. Hover a block for its name.</p>' + showBooks('all', 'show the books', books));

    // 2 physical
    defList('heavy', books.slice().sort(function (a, b) { return assume(b).g - assume(a).g; }), function (b) { var a = assume(b); return '<span class="m"> · ~' + fmt(a.g) + ' g</span>'; });
    html += sectionHtml(2, 'physical', 'About <span class="num" data-to="' + P.kilograms + '" data-dec="0">' + (INSTANT ? fmt(P.kilograms) : '0') + '</span> kilograms of paper.',
      'Nobody weighed the books. Each type gets an assumed page count, spine thickness and weight (Japanese bunko and tankōbon are counted lighter and thinner); the totals are the sums. Hover the figures for the scale.',
      '<div class="figs">' + fig(P.totalPages, 'pages, give or take') + fig(P.spineMetres, 'metres of spines, laid end to end', { dec: 1, unit: 'm' }) + fig(P.kilograms, 'kilograms, about ' + fmt1(P.grandPianos) + ' grand pianos', { unit: 'kg' }) + '</div>' +
      '<h3 class="mini" style="margin:0">Stacked flat, the library is ' + fmt1(P.spineMetres) + ' m tall: ' + (P.storeys >= 1 ? 'taller than a ' + (Math.ceil(P.storeys) - 1 > 0 ? ordinalWord(Math.ceil(P.storeys) - 1) + '-storey building' : 'single storey') : 'under one storey') + '.</h3>' +
      chartBox('height') +
      '<h3 class="mini" style="margin:12px 0 0">And at ' + fmt(P.kilograms) + ' kg it is heavier than ' + (P.grandPianos >= 1 ? Math.floor(P.grandPianos) + (Math.floor(P.grandPianos) === 1 ? ' grand piano' : ' grand pianos') : 'a grand piano') + '.</h3>' +
      chartBox('weight') +
      '<details class="assume"><summary>The assumptions, per type</summary><div class="wrap"><table><tr><th>type</th><th>books</th><th>pages</th><th>spine</th><th>weight</th><th>words/page</th></tr>' +
      P.perType.map(function (t) { var a = TYPE_ASSUME[t.type] || DEFAULT_ASSUME; return '<tr><td>' + esc(t.type) + '</td><td>' + t.n + '</td><td>' + a[0] + '</td><td>' + a[1] + ' mm</td><td>' + a[2] + ' g</td><td>' + a[3] + '</td></tr>'; }).join('') +
      '</table></div><p>Types not in the table use ' + DEFAULT_ASSUME[0] + ' pages, ' + DEFAULT_ASSUME[1] + ' mm, ' + DEFAULT_ASSUME[2] + ' g. Japanese-language books (except art books and magazines) are counted at ' + Math.round(JA_THICK * 100) + '% of the thickness and ' + Math.round(JA_WEIGHT * 100) + '% of the weight. A storey is ' + STOREY_M + ' m, a grand piano ' + PIANO_KG + ' kg, an adult ' + ADULT_KG + ' kg.</p></details>' +
      showBooks('heavy', 'show the books', books));

    // 3 time
    defList('long', books.slice().sort(function (a, b) { var x = assume(a), y = assume(b); return y.pages * y.wpp - x.pages * x.wpp; }), function (b) { var a = assume(b); return '<span class="m"> · ~' + fmt1(a.pages * a.wpp / WPM / 60) + ' h</span>'; });
    html += sectionHtml(3, 'time', 'Reading it all would take <span class="num" data-to="' + R.hours + '" data-dec="0">' + (INSTANT ? fmt(R.hours) : '0') + '</span> hours.',
      'At ' + WPM + ' words a minute, using each type\'s assumed pages and words per page. Manga pages carry about 45 words, so a volume takes under an hour; a Harvard Classic takes most of a weekend. Pick how many hours a day you can spare and the calendar fills in from today.',
      '<div class="figs">' + fig(R.words / 1e6, 'million words', { dec: 1 }) + fig(R.days24h, 'days of reading without sleep', { dec: 1 }) + fig(R.yearsAt[2], 'years at two hours a day', { dec: 1 }) + '</div>' +
      '<div class="row"><span class="mini">Hours a day</span><span class="seg" id="hpd"><button data-h="1">1</button><button data-h="2" class="on">2</button><button data-h="4">4</button><button data-h="8">8</button></span><span class="mini" id="hpd-note"></span></div>' +
      chartBox('calendar') +
      '<p class="mini">Where the hours go, by type:</p>' + chartBox('readtype') +
      showBooks('long', 'show the books', books));

    // 4 languages
    var biling = books.filter(function (b) { return (b.l || '').indexOf('/') >= 0; });
    var otherL = books.filter(function (b) { return b.l && b.l !== 'EN' && b.l !== 'JA' && b.l.indexOf('/') < 0; });
    defList('ja', books.filter(function (b) { return b.l === 'JA'; }));
    defList('bilingual', biling.concat(otherL));
    html += sectionHtml(4, 'languages', '<span class="num" data-to="' + pct(Lg.japanese, H.books) + '" data-dec="1">' + (INSTANT ? fmt1(pct(Lg.japanese, H.books)) : '0') + '</span>% of the library is in Japanese.',
      fmt(Lg.english) + ' books are in English and ' + fmt(Lg.japanese) + ' in Japanese. Between them sit ' + fmt(Lg.bilingualTotal) + ' bilingual books (dictionaries, parallel texts, study guides) and ' + fmt(Lg.otherTotal) + ' in ' + Lg.other.map(function (o) { return o.name; }).join(', ') + '.',
      chartBox('lang') + '<div class="legend"><span><i style="background:' + langColor('EN') + '"></i>English ' + fmt(Lg.english) + '</span><span><i style="background:' + langColor('JA') + '"></i>Japanese ' + fmt(Lg.japanese) + '</span><span><i style="background:' + langColor('X') + '"></i>bilingual and other ' + fmt(Lg.bilingualTotal + Lg.otherTotal) + '</span></div>' +
      '<div class="cols" style="margin-top:14px"><div><p class="h">Bilingual</p>' + Lg.bilingual.map(function (x) { return '<p class="mini">' + esc(x.name) + ' <b>' + x.n + '</b></p>'; }).join('') + '</div><div><p class="h">Other languages</p>' + Lg.other.map(function (x) { return '<p class="mini">' + esc(x.name) + ' <b>' + x.n + '</b></p>'; }).join('') + '</div></div>' +
      '<div class="row" style="margin-top:8px">' + showBooks('ja', '', []).replace('show the books', 'show the Japanese books') + showBooks('bilingual', '', []).replace('show the books', 'show the bilingual and other') + '</div>');

    // 5 genres
    S.genres.forEach(function (g) { defList('g:' + g.genre, books.filter(function (b) { return b.g === g.genre; })); });
    html += sectionHtml(5, 'genres', '<span class="num" data-to="' + S.genres.length + '">' + (INSTANT ? S.genres.length : '0') + '</span> genres, and literature takes <span class="num" data-to="' + S.genres[0].share + '" data-dec="1">' + (INSTANT ? fmt1(S.genres[0].share) : '0') + '</span>% of it.',
      'Sorted by count, coloured with the same hues the Bookshelf uses. Hover a bar for the genre\'s most frequent authors.',
      chartBox('genres') + '<div class="row"><label class="mini" for="genre-pick">show the books in</label><select id="genre-pick" class="mini" style="font:inherit;color:var(--ink);background:rgba(0,0,0,0.3);border:1px solid var(--line);border-radius:7px;padding:4px 8px;max-width:100%">' + S.genres.map(function (g) { return '<option value="' + esc(g.genre) + '">' + esc(g.genre) + ' (' + g.books + ')</option>'; }).join('') + '</select></div><details class="showbooks" id="genre-books"><summary>show the books<span class="pill" id="genre-count">' + S.genres[0].books + '</span></summary><div class="lb" data-key="g:' + esc(S.genres[0].genre) + '"></div></details>');

    // 6 eras
    var datedBooks = books.filter(function (b) { return typeof b.y === 'number'; }).sort(function (a, b) { return a.y - b.y; });
    defList('eras', datedBooks);
    defList('undated', books.filter(function (b) { return typeof b.y !== 'number'; }));
    html += sectionHtml(6, 'eras', 'The median book was first published in ' + num(E.medianYear, { plain: true }) + '.',
      'First-publication years, in half-century bins (everything before 1500, from Gilgamesh to Dante, shares one bin). ' + fmt(E.undated) + ' books have no usable year and are left out. The busiest decade is the ' + E.busiestDecade.decade + 's with ' + plural(E.busiestDecade.books, 'book') + '.',
      '<div class="figs">' + fig(E.oldest.year < 0 ? -E.oldest.year : E.oldest.year, 'oldest: <a href="' + bookLink(E.oldest) + '">' + esc(E.oldest.title) + '</a>', { plain: true, unit: E.oldest.year < 0 ? 'BC' : '' }) + fig(E.newest.year, 'newest: <a href="' + bookLink(E.newest) + '">' + esc(E.newest.title) + '</a>', { plain: true }) + fig(E.thisCentury, 'published since 2000') + '</div>' +
      chartBox('eras') + '<div class="row">' + showBooks('eras', '', []).replace('show the books', 'show the books, oldest first') + showBooks('undated', '', []).replace('show the books', 'show the undated') + '</div>');

    // 7 authors
    var topAuthorsSet = {}; A.top15.forEach(function (a) { topAuthorsSet[a.author] = 1; });
    defList('top15', books.filter(function (b) { return topAuthorsSet[authorName(b.a)]; }).sort(function (a, b) { return authorName(a.a).localeCompare(authorName(b.a)); }));
    html += sectionHtml(7, 'authors', '<span class="num" data-to="' + A.distinct + '">' + (INSTANT ? fmt(A.distinct) : '0') + '</span> authors, and <span class="num" data-to="' + A.appearOnce + '">' + (INSTANT ? fmt(A.appearOnce) : '0') + '</span> of them appear only once.',
      'Author names are taken as catalogued (with a few Japanese and romanised spellings merged); ' + fmt(A.noAuthor) + ' books list no author, mostly anthologies, reference books and magazines, and are left out here.',
      '<div class="figs">' + fig(A.top10pct.shareOfAttributed, 'percent of attributed books belong to the top 10% of authors (' + A.top10pct.authors + ' names)', { dec: 1, unit: '%' }) + fig(A.top15[0].books, 'books by ' + esc(A.top15[0].author) + ', the most of anyone') + fig(pct(A.appearOnce, A.distinct), 'percent of authors appear once', { dec: 1, unit: '%' }) + '</div>' +
      chartBox('authors') + showBooks('top15', '', []).replace('show the books', 'show the books by the top 15'));

    // 8 shelves
    defList('mixed', books.filter(function (b) { return b.u === Sh.mostMixed.unit && b.s === Sh.mostMixed.shelf; }));
    defList('pure', books.filter(function (b) { return b.u === Sh.purest.unit && b.s === Sh.purest.shelf; }));
    var legendGenres = S.genres.slice(0, 8);
    html += sectionHtml(8, 'shelves', 'The most mixed shelf is <span class="acc">' + esc(Sh.mostMixed.shelf) + '</span>; the purest is <span class="acc">' + esc(Sh.purest.shelf) + '</span>.',
      'Every bookcase as a stacked bar of its genres, largest first. ' + esc(Sh.mostMixed.shelf) + ' in the ' + esc(Sh.mostMixed.unitName) + ' holds ' + Sh.mostMixed.genres + ' genres across ' + plural(Sh.mostMixed.books, 'book') + '; ' + esc(Sh.purest.shelf) + ' in the ' + esc(Sh.purest.unitName) + ' is ' + pct(Sh.purest.topGenreBooks, Sh.purest.books) + '% ' + esc(Sh.purest.topGenre) + '. (Shelves with fewer than eight books are not ranked.)',
      '<div class="multi" id="multi">' + Sh.units.map(function (u) { return '<div class="u"><div class="nm" title="' + esc(u.name) + '">' + esc(u.name) + '</div><div class="ct">' + plural(u.books, 'book') + ' · ' + u.genres.length + ' genres</div>' + stackedBar(u.genres.map(function (g) { return { value: g.books, color: genreColor(g.genre), label: g.genre, tip: '<span class="sw" style="background:' + genreColor(g.genre) + '"></span>' + esc(g.genre) + ': ' + plural(g.books, 'book') + ' of ' + u.books + ' in the ' + esc(u.name) }; }), 100, 22, { rx: 1 }).replace('width="100"', 'width="100%"').replace('height="22"', 'height="22" preserveAspectRatio="none"') + '</div>'; }).join('') + '</div>' +
      '<div class="legend">' + legendGenres.map(function (g) { return '<span><i style="background:' + genreColor(g.genre) + '"></i>' + esc(g.genre) + '</span>'; }).join('') + '<span class="quiet">+ ' + (S.genres.length - legendGenres.length) + ' more, hover a segment</span></div>' +
      '<div class="row" style="margin-top:14px">' + showBooks('mixed', '', []).replace('show the books', 'show ' + esc(Sh.mostMixed.shelf)) + showBooks('pure', '', []).replace('show the books', 'show ' + esc(Sh.purest.shelf)) + '</div>');

    // 9 titles
    var longestB = books.filter(function (b) { return b.id === T.longest.id; })[0], shortestB = books.filter(function (b) { return b.id === T.shortest.id; })[0], jaB = T.longestJapanese && books.filter(function (b) { return b.id === T.longestJapanese.id; })[0];
    defList('the', S._theBooks); defList('oneword', S._oneWord);
    html += sectionHtml(9, 'titles', '<span class="num" data-to="' + T.startWithThe + '">' + (INSTANT ? T.startWithThe : '0') + '</span> titles start with "The".',
      'The most common first word is <b>' + esc(T.mostCommonFirstWord.word) + '</b> (' + plural(T.mostCommonFirstWord.titles, 'title') + '); after the articles and prepositions it is <b>' + esc(T.mostCommonFirstWordExcludingArticles.word) + '</b> (' + T.mostCommonFirstWordExcludingArticles.titles + '). The average title is ' + T.meanChars + ' characters long and ' + plural(T.oneWordTitles, 'English title') + ' are a single word.',
      '<div class="cols"><div><p class="h">Longest title, ' + T.longest.chars + ' characters</p><p class="fact"><a href="' + bookLink(longestB) + '">' + esc(T.longest.title) + '</a></p></div>' +
      '<div><p class="h">Shortest, ' + T.shortest.chars + '</p><p class="fact"><a href="' + bookLink(shortestB) + '">' + esc(T.shortest.title) + '</a>' + (T.shortestLatin.id !== T.shortest.id ? ' <span class="quiet">and in Latin letters <a href="' + bookLink(books.filter(function (b) { return b.id === T.shortestLatin.id; })[0]) + '">' + esc(T.shortestLatin.title) + '</a></span>' : '') + '</p></div>' +
      (jaB ? '<div><p class="h">Longest Japanese title, ' + T.longestJapanese.cjkChars + ' kana and kanji</p><p class="fact"><a href="' + bookLink(jaB) + '">' + esc(T.longestJapanese.title) + '</a></p></div>' : '') + '</div>' +
      '<p class="mini" style="margin-top:14px">Title length in characters:</p>' + chartBox('titlelen') +
      '<div class="row">' + showBooks('the', '', []).replace('show the books', 'show the "The" titles') + showBooks('oneword', '', []).replace('show the books', 'show the one-word titles') + '</div>');

    // 10 copies and series
    var dupIds = {}; C.list.forEach(function (c) { c.ids.forEach(function (id) { dupIds[id] = 1; }); });
    defList('dups', books.filter(function (b) { return dupIds[b.id]; }).sort(function (a, b) { return fold(a.t.replace(/\s*\(.*copy.*\)$/i, '')).localeCompare(fold(b.t.replace(/\s*\(.*copy.*\)$/i, ''))); }));
    var serIds = {}; S._series.forEach(function (s) { s.ids.forEach(function (id) { serIds[id] = 1; }); });
    defList('series', books.filter(function (b) { return serIds[b.id]; }).sort(function (a, b) { return (hasCJK(a.t) - hasCJK(b.t)) || a.t.localeCompare(b.t, undefined, { numeric: true }); }));
    html += sectionHtml(10, 'copies', '<span class="num" data-to="' + C.duplicateTitles + '">' + (INSTANT ? C.duplicateTitles : '0') + '</span> titles are on the shelves more than once.',
      'A duplicate is either marked "(copy 2)" in the catalogue or shares a title and author with another record. ' + C.explicitlyMarked + (C.explicitlyMarked === 1 ? ' is' : ' are') + ' marked outright; the rest are different editions, such as two Pride and Prejudices. Among manga, comics and light novels, volume numbers in titles reveal ' + plural(Sr.seriesWithMultipleVolumes, 'series', 'series') + ' with more than one volume on the shelf' + (Sr.longestRun ? '; the longest run is <b>' + esc(Sr.longestRun.title) + '</b> at ' + plural(Sr.longestRun.volumes, 'volume') + '.' : '.') + (Sr.highestVolumeNumber ? ' The highest volume number in the house is ' + Sr.highestVolumeNumber.volume + ', of ' + esc(Sr.highestVolumeNumber.title) + '.' : ''),
      '<div class="figs">' + fig(C.extraCopies, 'extra copies') + fig(Sr.seriesWithMultipleVolumes, 'series with 2+ volumes') + fig(Sr.volumesInSeries, 'volumes in those series') + '</div>' +
      '<p class="mini">The longest runs:</p>' + chartBox('series') +
      '<div class="row">' + showBooks('dups', '', []).replace('show the books', 'show the duplicates') + showBooks('series', '', []).replace('show the books', 'show the series volumes') + '</div>');

    // 11 free
    defList('free', S._free.slice().sort(function (a, b) { return (hasCJK(a.t) - hasCJK(b.t)) || a.t.localeCompare(b.t); }), function (b) { return '<a class="ext" href="' + esc(b.free.url) + '" target="_blank" rel="noopener">' + esc(FREE_SOURCE[b.free.src] || b.free.src) + ' ↗</a>'; });
    html += sectionHtml(11, 'free', '<span class="num" data-to="' + F.books + '">' + (INSTANT ? F.books : '0') + '</span> of the books are free to read online.',
      F.share + '% of the library is out of copyright and transcribed: ' + F.bySource.map(function (s) { return plural(s.books, 'book') + ' on ' + s.source; }).join(' and ') + '. The links open the e-text.',
      chartBox('free') + '<div class="legend">' + F.bySource.map(function (s) { return '<span><i style="background:' + (s.key === 'gutenberg' ? 'var(--accent)' : 'hsl(354 50% 62%)') + '"></i>' + esc(s.source) + ' ' + s.books + '</span>'; }).join('') + '<span><i style="background:rgba(236,228,212,0.14)"></i>no free e-text ' + fmt(H.books - F.books) + '</span></div>' + showBooks('free', '', []).replace('show the books', 'show the free books'));

    // 12 did you know
    html += sectionHtml(12, 'know', 'Did you know?', '',
      '<p class="fact" id="fact" aria-live="polite"></p><div class="row"><button class="small" id="fact-next">another</button><span class="quiet" id="fact-n"></span></div>' +
      '<div class="exports"><button id="dl-json">Download as JSON</button><button id="copy-summary">Copy summary</button><span class="ok" id="export-ok"></span></div>');

    $('#main').innerHTML = html;
    $('#toc-list').innerHTML = SECTIONS.map(function (s, i) { return '<li><a href="#s-' + s.id + '" data-sec="s-' + s.id + '"><span class="n">' + (i + 1) + '</span>' + s.nav + '</a></li>'; }).join('');
    drawCharts();
    wire();
    // the sections did not exist when the browser tried to honour the hash
    if (location.hash && /^#s-[a-z]+$/.test(location.hash)) { var target = $(location.hash); if (target) { animateSection(target); target.scrollIntoView({ block: 'start', behavior: 'instant' }); } }
    // ?from=<section> hides everything before that section (used for screenshots)
    var from = params.get('from');
    if (from && $('#s-' + from)) { var hide = true; $$('.sec').forEach(function (s) { if (s.id === 's-' + from) hide = false; if (hide) s.style.display = 'none'; }); if (params.get('open') === '1') $$('#s-' + from + ' details').forEach(function (d) { d.open = true; }); }
  }
  function ordinalWord(n) { return ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'][n] || String(n); }

  var hoursPerDay = 2;
  function drawCharts() {
    var P = S.physical, R = S.reading, Lg = S.languages, E = S.eras, A = S.authors, T = S.titles, Sr = S.series, F = S.free, H = S.headline;
    $$('[data-chart]').forEach(function (box) {
      var w = Math.max(240, Math.floor(box.clientWidth || box.parentNode.clientWidth || 600));
      var id = box.getAttribute('data-chart'), out = '';
      if (id === 'units') out = stackedBar(H.booksPerUnit.map(function (u) { return { value: u.n, label: u.name, color: 'rgba(232,181,106,' + (0.9 - 0.6 * H.booksPerUnit.indexOf(u) / H.booksPerUnit.length) + ')', tip: esc(u.name) + ': ' + plural(u.n, 'book') + ' (' + pct(u.n, H.books) + '%)' }; }), w, 28, { labels: true });
      else if (id === 'height') out = heightIllustration(S, w);
      else if (id === 'weight') out = weightIllustration(S, w);
      else if (id === 'calendar') out = calendarStrip(S, w, hoursPerDay);
      else if (id === 'readtype') out = hbars(R.perType.slice(0, 10).map(function (t) { return { label: t.type, value: t.hours, valueLabel: fmt(t.hours) + ' h', tip: esc(t.type) + ': ' + plural(t.books, 'book') + ', about ' + fmt(t.hours) + ' hours' }; }), w, { rowH: 22 });
      else if (id === 'lang') out = stackedBar([{ value: Lg.english, label: 'English', color: langColor('EN') }, { value: Lg.japanese, label: 'Japanese', color: langColor('JA') }].concat(Lg.bilingual.map(function (x) { return { value: x.n, label: x.name, color: langColor('X') }; })).concat(Lg.other.map(function (x) { return { value: x.n, label: x.name, color: 'hsl(42 25% 48%)' }; })), w, 34, { labels: true });
      else if (id === 'genres') out = hbars(S.genres.map(function (g) { return { label: g.genre, value: g.books, color: genreColor(g.genre), tip: '<span class="sw" style="background:' + genreColor(g.genre) + '"></span>' + esc(g.genre) + ': ' + plural(g.books, 'book') + ' (' + g.share + '%)' + (g.topAuthors.length ? '<div class="m">' + g.topAuthors.map(function (a) { return esc(a.author) + ' (' + a.books + ')'; }).join(', ') + '</div>' : '') }; }), w, { rowH: 24, labelWidth: 230 });
      else if (id === 'eras') out = columns(E.bins.map(function (b) { var isMed = b.from != null && E.medianYear >= b.from && E.medianYear < b.from + 50; return { label: b.from == null ? '<1500' : (b.from % 100 === 0 ? String(b.from) : "'" + String(b.from).slice(2)), value: b.n, tip: esc(b.label) + ': ' + plural(b.n, 'book'), color: isMed ? 'var(--accent)' : 'rgba(232,181,106,0.45)', mark: isMed ? 'median ' + E.medianYear : '', always: b.from == null || b.from % 100 === 0 }; }), w, { height: 170, maxBarW: 40 });
      else if (id === 'authors') out = hbars(A.top15.map(function (a) { return { label: a.author, value: a.books, tip: esc(a.author) + ': ' + plural(a.books, 'book') }; }), w, { rowH: 22, labelWidth: 220 });
      else if (id === 'titlelen') out = columns(T.lengthHistogram.map(function (b) { return { label: b.to == null ? '80+' : b.from + '–' + b.to, value: b.n, tip: (b.to == null ? '80 or more' : b.from + ' to ' + b.to) + ' characters: ' + plural(b.n, 'title'), always: true }; }), w, { height: 140, maxBarW: 40 });
      else if (id === 'series') out = hbars(Sr.list.slice(0, 10).map(function (s) { return { label: s.title, value: s.volumes, valueLabel: s.volumes + (s.maxVolume > s.volumes ? ' (to vol. ' + s.maxVolume + ')' : ''), tip: esc(s.title) + ': ' + plural(s.volumes, 'volume') + ' on the shelf' + (s.maxVolume ? ', highest numbered ' + s.maxVolume : '') + ' · ' + esc(s.type) }; }), w, { rowH: 22, labelWidth: 260 });
      else if (id === 'free') out = stackedBar(F.bySource.map(function (s) { return { value: s.books, label: s.source, color: s.key === 'gutenberg' ? 'var(--accent)' : 'hsl(354 50% 62%)', tip: esc(s.source) + ': ' + plural(s.books, 'book') }; }).concat([{ value: H.books - F.books, label: 'in copyright or not transcribed', color: 'rgba(236,228,212,0.14)', tip: plural(H.books - F.books, 'book') + ' without a free e-text' }]), w, 28, { labels: true });
      box.innerHTML = out;
    });
    var note = $('#hpd-note');
    if (note) note.textContent = fmt1(R.minutes / 60 / hoursPerDay / 365.25) + ' years';
  }

  // ---- Interaction ---------------------------------------------------------------
  var tip = $('#tip');
  function showTip(html, x, y) { tip.innerHTML = html; tip.classList.add('show'); moveTip(x, y); }
  function moveTip(x, y) { var r = tip.getBoundingClientRect(); var tx = Math.min(x + 14, window.innerWidth - r.width - 8), ty = y + 16; if (ty + r.height > window.innerHeight - 8) ty = y - r.height - 10; tip.style.left = Math.max(4, tx) + 'px'; tip.style.top = Math.max(4, ty) + 'px'; }
  function hideTip() { tip.classList.remove('show'); }
  function tipTarget(ev) { var t = ev.target; while (t && t !== document.body) { if (t.getAttribute && t.getAttribute('data-tip')) return t; t = t.parentNode; } return null; }

  var factIdx = 0, factTimer = null;
  function showFact(i) { var f = S._facts; factIdx = ((i % f.length) + f.length) % f.length; $('#fact').innerHTML = f[factIdx].html; $('#fact-n').textContent = (factIdx + 1) + ' of ' + f.length + ', starting point seeded by today\'s date'; }

  function wire() {
    document.addEventListener('mousemove', function (ev) { var t = tipTarget(ev); if (t) showTip(t.getAttribute('data-tip'), ev.clientX, ev.clientY); else hideTip(); });
    document.addEventListener('touchstart', function (ev) { var t = tipTarget(ev); if (t) { var p = ev.touches[0]; showTip(t.getAttribute('data-tip'), p.clientX, p.clientY); } else hideTip(); }, { passive: true });
    document.addEventListener('scroll', hideTip, { passive: true });

    // "show the books"
    $$('details.showbooks').forEach(function (d) { d.addEventListener('toggle', function () { if (d.open) { var box = $('.lb', d); if (box && !box.children.length) renderList(box, box.getAttribute('data-key'), false); } }); });
    document.addEventListener('click', function (ev) { var b = ev.target.closest && ev.target.closest('[data-more]'); if (b) renderList(b.parentNode, b.getAttribute('data-more'), true); });
    var gp = $('#genre-pick');
    gp.addEventListener('change', function () { var box = $('#genre-books .lb'); box.setAttribute('data-key', 'g:' + gp.value); box.innerHTML = ''; $('#genre-count').textContent = LISTS['g:' + gp.value].list.length; if ($('#genre-books').open) renderList(box, 'g:' + gp.value, false); });

    // hours per day
    $$('#hpd button').forEach(function (b) { b.addEventListener('click', function () { hoursPerDay = +b.getAttribute('data-h'); $$('#hpd button').forEach(function (x) { x.classList.toggle('on', x === b); }); drawCharts(); }); });

    // facts
    var seed = seedFromDate();
    showFact(Math.floor(mulberry(seed)() * S._facts.length));
    $('#fact-next').addEventListener('click', function () { showFact(factIdx + 1); restartFactTimer(); });
    restartFactTimer();

    // exports
    $('#dl-json').addEventListener('click', function () {
      var out = {}; Object.keys(S).forEach(function (k) { if (k.charAt(0) !== '_') out[k] = S[k]; });
      var blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
      var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'library-by-the-numbers.json'; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
      flash('saved library-by-the-numbers.json');
    });
    $('#copy-summary').addEventListener('click', function () {
      var text = summaryText();
      var done = function () { flash('summary copied'); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text); done(); });
      else { fallbackCopy(text); done(); }
    });

    // nav highlight and counters
    var navLinks = $$('#toc-list a');
    if ('IntersectionObserver' in window) {
      var cntObs = new IntersectionObserver(function (entries) { entries.forEach(function (e) { if (e.isIntersecting) { animateSection(e.target); cntObs.unobserve(e.target); } }); }, { rootMargin: '0px 0px -10% 0px' });
      $$('.sec').forEach(function (s) { cntObs.observe(s); });
    } else { $$('.sec').forEach(animateSection); }

    window.addEventListener('resize', debounce(drawCharts, 150));

    // sticky nav: the current section is the last one whose top has passed 40% of the viewport
    var navTick = false, navCurrent = '';
    function updateNav() {
      navTick = false;
      var line = window.innerHeight * 0.4, current = '';
      $$('.sec').forEach(function (s) { if (s.style.display !== 'none' && s.getBoundingClientRect().top <= line) current = s.id; });
      if (!current) current = 's-headline';
      if (current === navCurrent) return;
      navCurrent = current;
      navLinks.forEach(function (a) { var on = a.getAttribute('data-sec') === current; a.classList.toggle('on', on); if (on && a.scrollIntoView && !INSTANT) { try { a.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (err) {} } });
    }
    window.addEventListener('scroll', function () { if (!navTick) { navTick = true; requestAnimationFrame(updateNav); } }, { passive: true });
    updateNav();

    // search
    var q = $('#q'), drop = $('#drop');
    q.addEventListener('input', function () { search(q.value); });
    q.addEventListener('focus', function () { if (q.value) search(q.value); });
    document.addEventListener('click', function (ev) { if (!ev.target.closest('.search')) drop.classList.remove('show'); });
    q.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') { drop.classList.remove('show'); q.blur(); } if (ev.key === 'ArrowDown') { var f = $('a', drop); if (f) { f.focus(); ev.preventDefault(); } } });
  }
  function restartFactTimer() { if (factTimer) clearInterval(factTimer); if (INSTANT) return; factTimer = setInterval(function () { showFact(factIdx + 1); }, 9000); }
  function flash(msg) { var el = $('#export-ok'); el.textContent = msg; setTimeout(function () { if (el.textContent === msg) el.textContent = ''; }, 2500); }
  function fallbackCopy(text) { var ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch (e) {} ta.remove(); }
  function debounce(fn, ms) { var t; return function () { clearTimeout(t); t = setTimeout(fn, ms); }; }

  function summaryText() {
    var H = S.headline, P = S.physical, R = S.reading, Lg = S.languages, E = S.eras, A = S.authors, Sh = S.shelves, T = S.titles, C = S.copies, Sr = S.series, F = S.free;
    return 'Jack\'s library by the numbers (catalogue of ' + S.generated + '): ' + fmt(H.books) + ' books and ' + fmt(H.objects) + ' other objects on ' + H.shelves + ' shelves across ' + H.bookcases + ' bookcases. ' +
      'Estimated ' + fmt(P.totalPages) + ' pages, ' + fmt1(P.spineMetres) + ' m of spines (about ' + fmt1(P.storeys) + ' storeys stacked flat) and ' + fmt(P.kilograms) + ' kg (' + fmt1(P.grandPianos) + ' grand pianos). ' +
      'Reading everything at ' + WPM + ' words a minute would take about ' + fmt(R.hours) + ' hours, or ' + fmt1(R.yearsAt[2]) + ' years at two hours a day. ' +
      fmt(Lg.english) + ' books are in English and ' + fmt(Lg.japanese) + ' in Japanese (' + pct(Lg.japanese, H.books) + '%), with ' + fmt(Lg.bilingualTotal + Lg.otherTotal) + ' bilingual or in other languages. ' +
      'The largest genre is ' + S.genres[0].genre + ' (' + S.genres[0].books + '), then ' + S.genres[1].genre + ' (' + S.genres[1].books + ') and ' + S.genres[2].genre + ' (' + S.genres[2].books + '). ' +
      'The median book was first published in ' + E.medianYear + '; the oldest text dates to ' + yearLabel(E.oldest.year) + ' and ' + E.thisCentury + ' books are from this century. ' +
      fmt(A.distinct) + ' authors are named, ' + fmt(A.appearOnce) + ' of them once; the top 10% of authors account for ' + A.top10pct.shareOfAttributed + '% of attributed books, led by ' + A.top15[0].author + ' with ' + A.top15[0].books + '. ' +
      'The most mixed shelf is ' + Sh.mostMixed.shelf + ' (' + Sh.mostMixed.unitName + ', ' + Sh.mostMixed.genres + ' genres) and the purest is ' + Sh.purest.shelf + ' (' + Sh.purest.unitName + '). ' +
      T.startWithThe + ' titles start with "The"; the longest title runs ' + T.longest.chars + ' characters. ' +
      C.duplicateTitles + ' titles appear more than once' + (Sr.longestRun ? ', and the longest manga run is ' + Sr.longestRun.title + ' at ' + Sr.longestRun.volumes + ' volumes. ' : '. ') +
      F.books + ' books (' + F.share + '%) have a free e-text online.';
  }

  // ---- Counters -------------------------------------------------------------------
  function animateSection(sec) {
    $$('.num', sec).forEach(function (el) {
      if (el.getAttribute('data-done')) return;
      el.setAttribute('data-done', '1');
      var to = parseFloat(el.getAttribute('data-to')), dec = +el.getAttribute('data-dec') || 0, plain = el.getAttribute('data-plain');
      var render = function (v) { el.textContent = dec ? fmt1(v) : (plain ? String(Math.round(v)) : fmt(v)); };
      if (INSTANT) { render(to); return; }
      var dur = 1400, t0 = null;
      var step = function (ts) { if (!t0) t0 = ts; var p = Math.min(1, (ts - t0) / dur); var e = 1 - Math.pow(1 - p, 3); render(to * e); if (p < 1) requestAnimationFrame(step); else render(to); };
      requestAnimationFrame(step);
    });
  }

  // ---- Search ---------------------------------------------------------------------
  function search(qs) {
    var drop = $('#drop');
    var q = fold(qs.trim()); if (!q) { drop.classList.remove('show'); return; }
    var hits = S._books.filter(function (b) { return b._f.indexOf(q) >= 0; }).slice(0, 12);
    drop.innerHTML = hits.length ? hits.map(function (b) { var a = authorName(b.a); return '<a href="' + bookLink(b) + '"><span class="t">' + esc(b.t) + '</span><span class="m">' + (a ? esc(a) + ' · ' : '') + yearLabel(b.y) + ' · ' + esc(shelfLabel(b)) + '</span></a>'; }).join('') : '<div class="none">No book or author matches.</div>';
    drop.classList.add('show');
  }

  // ---- Boot --------------------------------------------------------------------------
  if (THUMB) document.body.classList.add('thumb');
  fetch(DATA_URL).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }).then(function (data) {
    data.books.forEach(function (b) { b._f = fold(b.t) + ' ' + fold(b.a) + ' ' + fold(authorName(b.a)); });
    S = compute(data);
    window.LibraryNumbers = S;
    build();
  }).catch(function (err) {
    var st = $('#status'); st.className = 'err'; st.textContent = 'The catalogue could not be loaded (' + err.message + '). This page reads ../../assets/data/library.json and needs to be served from the site.';
  });
})();
