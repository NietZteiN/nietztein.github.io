/* Book Exchange: the pricing engine.
   Pure functions, no DOM. Works in the browser (window.EXCHANGE) and in Node
   (module.exports) so the model can be tested headlessly.

   The model, in one paragraph (also shown in the page's help panel):
   every book is a listed security. Its BASE price comes from age and a page
   proxy (by type of book plus description length). Its DEMAND is the TF-IDF
   weighted overlap between the words of its title + description and the words
   of the owner's blog posts, so a rare word shared with a post counts for much
   more than "book" or "history". PRICE = BASE * (1 + K * DEMAND). The 90-day
   history attributes each post to its publish date: the books whose words the
   post uses jump on that day. A seeded, mean-reverting wobble (mulberry32,
   seeded from the ticker) is added and pinned to zero on day 0 so the last
   point is exactly the model price. */
(function (root) {
  'use strict';

  var K = 0.12;         // demand multiplier: PRICE = BASE * (1 + K * DEMAND)
  var DAYS = 90;        // trading days in the fake history (day 0 = today)
  var NOISE = 0.011;    // daily wobble amplitude (fraction of price)
  var MSDAY = 86400000;

  /* ---------- Stopwords: words that carry no demand ---------- */
  var STOP = {};
  ('the a an and or but of to in on at by for with from as is are was were be been being am it its this that these those ' +
   'he she they them his her their we our you your i me my mine not no nor so if then than too very can could would should ' +
   'will shall may might must do does did done have has had having into onto over under out up down off about above below ' +
   'between through during before after again further here there where when why how all any both each few more most other ' +
   'some such only own same just also ever never now one two three four five six seven eight nine ten first second third new ' +
   'old like get got make made much many what which who whom whose while because until against among within without via per ' +
   'yes well still even though although either neither around across along back way thing things something anything nothing ' +
   'everything someone anyone everyone people part parts kind kinds lot lots sort sorts vol volume volumes edition editions ' +
   'series book books novel novels story stories collection collected complete works work author authors writer written ' +
   'translation translated english japanese japan chapter chapters page pages published publisher press paperback hardcover ' +
   'text texts version versions include includes including based known also see seen use used using ' +
   'his hers ours theirs yours itself himself herself themselves myself yourself ourselves ' +
   'don doesn didn isn aren wasn weren won wouldn couldn shouldn let etc rather quite really always often sometimes almost ' +
   'another every whether since once twice per each less least own take took taken give given gives goes went come came ' +
   'say said says think thought know knew thing want wants need needs put set seems seem seemed find found look looks looked ' +
   'good bad big small long short high low right left last next end ends begin begins began start starts started ' +
   'man men woman women boy girl child children life lives world time times year years day days home house city ' +
   'young early late later long ago ever hand hands eyes eye head face war love god self mind body ' +
   'http https www com org html png jpg')
    .split(/\s+/).forEach(function (w) { STOP[w] = true; });

  /* ---------- Hashing and seeded randomness ---------- */
  // FNV-1a string hash to an unsigned 32-bit integer.
  function hashString(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  // mulberry32: tiny seeded PRNG returning floats in [0, 1).
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ---------- Text handling ---------- */
  // Reduce a markdown post to plain prose: drop frontmatter, code, tags, urls; keep link text.
  function stripMarkdown(md) {
    var s = String(md || '');
    s = s.replace(/^﻿/, '').replace(/^---[\s\S]*?\n---\s*\n/, '');
    s = s.replace(/```[\s\S]*?```/g, ' ').replace(/`[^`\n]*`/g, ' ');
    s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ');
    s = s.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
    s = s.replace(/<[^>]+>/g, ' ').replace(/https?:\/\/\S+/g, ' ');
    s = s.replace(/[#>*_~|]+/g, ' ');
    return s;
  }
  // Strip diacritics so Mallarmé and Mallarme are one term.
  function fold(s) {
    s = s.toLowerCase();
    if (s.normalize) s = s.normalize('NFD').replace(/[̀-ͯ]/g, '');
    return s;
  }
  // Light plural stemming: models -> model, but glass stays glass.
  function stem(w) {
    if (w.length > 4 && /s$/.test(w) && !/(ss|us|is|ous)$/.test(w)) w = w.slice(0, -1);
    if (w.length > 5 && /ies$/.test(w)) w = w.slice(0, -3) + 'y';
    return w;
  }
  // Tokens: Latin words of 3+ letters minus stopwords, and CJK character bigrams
  // (so Japanese titles can still overlap with a post that quotes a word).
  function tokenize(text) {
    var out = [];
    var s = fold(stripMarkdown(text));
    var re = /[a-z]+|[぀-ヿ一-鿿]+/g, m;
    while ((m = re.exec(s))) {
      var w = m[0];
      if (w.charCodeAt(0) < 128) {
        if (w.length < 3 || STOP[w]) continue;
        w = stem(w);
        if (w.length < 3 || STOP[w]) continue;
        out.push(w);
      } else {
        for (var i = 0; i + 1 < w.length; i++) out.push(w.slice(i, i + 2));
      }
    }
    return out;
  }
  function counts(tokens) {
    var c = {};
    for (var i = 0; i < tokens.length; i++) c[tokens[i]] = (c[tokens[i]] || 0) + 1;
    return c;
  }

  /* ---------- Ticker symbols ---------- */
  var MINOR = { the: 1, a: 1, an: 1, of: 1, and: 1, or: 1, in: 1, on: 1, to: 1, for: 1, at: 1, by: 1, with: 1, from: 1, vol: 1, ed: 1, no: 1 };
  function latinWords(s) {
    return fold(String(s || '')).replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(function (w) { return w && !MINOR[w]; });
  }
  // Ordered candidate symbols for one book: acronym of the title, the title's
  // first word, then the same from the author and the description.
  function symbolCandidates(book) {
    var out = [];
    function fromWords(words) {
      if (!words.length) return;
      var acr = words.map(function (w) { return w[0]; }).join('');
      if (acr.length >= 3) { out.push(acr.slice(0, 4)); out.push(acr.slice(0, 3)); if (acr.length >= 5) out.push(acr.slice(0, 5)); }
      var first = words[0];
      var cons = first.replace(/[aeiou]/g, '');
      if (first.length >= 4) out.push(first.slice(0, 4));
      if (cons.length >= 3) out.push(cons.slice(0, 4));
      if (first.length >= 3) out.push(first.slice(0, 3));
      if (first.length >= 5) out.push(first.slice(0, 5));
      if (words.length >= 2 && acr.length >= 2) out.push((acr.slice(0, 2) + words[1].slice(1, 3)).slice(0, 4));
    }
    fromWords(latinWords(book.t));
    fromWords(latinWords(book.a));
    fromWords(latinWords(book.d).filter(function (w) { return !STOP[w]; }));
    return out.map(function (s) { return s.toUpperCase(); }).filter(function (s) { return /^[A-Z]{3,5}$/.test(s); });
  }
  // Assign unique 3-5 letter symbols to every book, in a stable order (by id).
  function assignSymbols(books) {
    var used = {}, map = {};
    var order = books.slice().sort(function (a, b) { return String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0; });
    order.forEach(function (b) {
      var cands = symbolCandidates(b), sym = null, i;
      for (i = 0; i < cands.length; i++) if (!used[cands[i]]) { sym = cands[i]; break; }
      if (!sym) {
        // Fall back to a 3-letter stem plus a letter suffix cycling A..Z, then AA..ZZ.
        var base = (cands[0] || 'BKX').slice(0, 3);
        var A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        for (i = 0; i < 26 && !sym; i++) if (!used[base + A[i]]) sym = base + A[i];
        for (i = 0; i < 676 && !sym; i++) { var c = base + A[Math.floor(i / 26)] + A[i % 26]; if (!used[c]) sym = c; }
        if (!sym) { for (i = 0; !sym; i++) { var r = mulberry32(hashString(String(b.id)) + i), s = ''; for (var j = 0; j < 5; j++) s += A[Math.floor(r() * 26)]; if (!used[s]) sym = s; } }
      }
      used[sym] = true; map[b.id] = sym;
    });
    return map;
  }

  /* ---------- Base price ---------- */
  // Nobody counted the pages, so the type of book stands in for its thickness.
  var PAGES = { 'Manga': 190, 'Comics': 140, 'Light novel': 280, 'Fiction': 330, 'Poetry': 120, 'Drama': 140,
    'Anthology': 620, 'Textbook': 720, 'Reference': 560, 'Magazine': 110, 'Art': 260, 'History': 420, 'Nonfiction': 300,
    'Religion': 360, 'Philosophy': 320, 'Self-help': 250, 'Writing craft': 240, 'Language study': 300, 'Nursing & medical': 640,
    'Test prep': 380, 'Literary criticism': 300, 'Science': 360, 'Film': 260, 'Psychology': 300, 'Music': 220, 'Politics': 300,
    'Essays': 260, 'Sociology': 320, 'Military': 400, 'Media': 260, 'Biography': 420, 'Memoir': 300, 'Occult': 240,
    'Technical': 500, 'Picture book': 40, 'Math journal': 200, 'Linguistics': 340, 'Hymnal': 600, 'Games': 60,
    'Documents': 80, "Children's": 60, 'Calendar': 30 };
  function pageProxy(book) {
    var p = PAGES[book.ty] || 300;
    return p + Math.min(200, (book.d || '').length / 2);
  }
  function basePrice(book, todayYear) {
    var year = (typeof book.y === 'number' && book.y > 0) ? book.y : 2000;   // unknown year: treated as 2000
    var age = Math.max(0, Math.min(400, todayYear - year));
    return 12 + pageProxy(book) * 0.06 + age * 0.22;   // a thick, old book is a blue chip
  }

  /* ---------- Posts ---------- */
  // meta: {slug, title, date, file}; md: the markdown body.
  function parsePost(meta, md) {
    var text = stripMarkdown(md);
    var tokens = tokenize((meta.title || '') + ' ' + text);
    return { slug: meta.slug || '', title: meta.title || meta.slug || 'untitled', date: meta.date || '', file: meta.file || '',
      tokens: tokens, counts: counts(tokens), words: tokens.length };
  }
  function midnight(d) { var x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
  function daysAgo(dateStr, today) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateStr || ''));
    if (!m) return 9999;
    var d = new Date(+m[1], +m[2] - 1, +m[3]);
    return Math.round((midnight(today) - d) / MSDAY);
  }

  /* ---------- The market ---------- */
  // books: library rows. posts: parsed posts. today: Date (defaults to now).
  function buildMarket(books, posts, today) {
    today = today ? new Date(today) : new Date();
    var todayYear = today.getFullYear();
    var symbols = assignSymbols(books);

    // Document frequency over books + posts, for IDF.
    var df = {}, N = books.length + posts.length, i, t;
    var bookTerms = books.map(function (b) { return counts(tokenize((b.t || '') + ' ' + (b.d || ''))); });
    bookTerms.forEach(function (c) { for (t in c) df[t] = (df[t] || 0) + 1; });
    posts.forEach(function (p) { for (t in p.counts) df[t] = (df[t] || 0) + 1; });
    function idf(term) { return Math.log(N / (df[term] || 1)); }

    // Post events, oldest first, with their position on the 90-day axis.
    var events = posts.map(function (p) {
      var ago = daysAgo(p.date, today);
      return { post: p, ago: ago, day: DAYS - 1 - ago };     // day index in [0, 89], < 0 if older than the window
    }).sort(function (a, b) { return b.ago - a.ago; });

    var secs = books.map(function (b, bi) {
      var terms = bookTerms[bi], norm = Math.sqrt(Object.keys(terms).length || 1);
      var base = basePrice(b, todayYear);
      var termHits = {}, contrib = [], demand = 0;
      events.forEach(function (ev) {
        var c = 0, pc = ev.post.counts;
        for (t in terms) if (pc[t]) {
          var s = idf(t) * Math.log(1 + pc[t]) / norm;
          c += s;
          if (!termHits[t]) termHits[t] = { term: t, idf: idf(t), score: 0, posts: [] };
          termHits[t].score += s; termHits[t].posts.push({ title: ev.post.title, slug: ev.post.slug, count: pc[t] });
        }
        contrib.push(c); demand += c;
      });
      var top = Object.keys(termHits).map(function (k) { return termHits[k]; }).sort(function (a, b) { return b.score - a.score; });

      // History: cumulative post contributions plus a seeded wobble pinned to zero today.
      var rnd = mulberry32(hashString(symbols[b.id]));
      var raw = [], n = 0, d;
      for (d = 0; d < DAYS; d++) { n = n * 0.9 + (rnd() - 0.5) * 2 * NOISE; raw.push(n); }
      var hist = [], evs = [];
      for (d = 0; d < DAYS; d++) {
        var D = 0;
        events.forEach(function (ev, k) { if (ev.day <= d) D += contrib[k]; });
        var wobble = raw[d] - raw[DAYS - 1] * (d / (DAYS - 1));
        var p = base * (1 + K * D) * (1 + wobble);
        hist.push(Math.round(p * 100) / 100);
      }
      events.forEach(function (ev, k) { if (contrib[k] > 0 && ev.day >= 0) evs.push({ day: ev.day, title: ev.post.title, slug: ev.post.slug, date: ev.post.date, jump: contrib[k] * K }); });
      var price = hist[DAYS - 1];
      var y = hist[DAYS - 2], m = hist[Math.max(0, DAYS - 31)];
      return { id: b.id, sym: symbols[b.id], title: b.t || '(untitled)', author: b.a || '', sector: b.g || 'Unidentified',
        type: b.ty || '', year: b.y, lang: b.l || '', shelf: (b.u || '') + (b.s ? '-' + b.s : ''),
        base: Math.round(base * 100) / 100, demand: demand, price: price, history: hist, events: evs,
        volume: (b.d || '').length, terms: top, nterms: Object.keys(terms).length,
        chg1: price - y, pct1: y ? (price - y) / y * 100 : 0, chg30: price - m, pct30: m ? (price - m) / m * 100 : 0 };
    });

    // Ratings from demand percentile among covered books.
    var covered = secs.filter(function (s) { return s.demand > 0; }).map(function (s) { return s.demand; }).sort(function (a, b) { return a - b; });
    function pct(v) { var lo = 0, hi = covered.length; while (lo < hi) { var mid = (lo + hi) >> 1; if (covered[mid] < v) lo = mid + 1; else hi = mid; } return covered.length ? lo / covered.length : 0; }
    var volumes = secs.map(function (s) { return s.volume; }).sort(function (a, b) { return a - b; });
    var medianVolume = volumes.length ? volumes[volumes.length >> 1] : 0;
    secs.forEach(function (s) {
      if (s.demand <= 0) { s.rating = 'No coverage'; s.percentile = 0; return; }
      var q = pct(s.demand); s.percentile = q;
      s.rating = q >= 0.9 ? 'Strong buy' : q >= 0.7 ? 'Buy' : q >= 0.4 ? 'Hold' : q >= 0.2 ? 'Underweight' : 'Sell';
    });

    // Sector indices and the composite: equal-weight, each book indexed to 100 at day 0 of the window.
    var sectors = {};
    secs.forEach(function (s) { (sectors[s.sector] = sectors[s.sector] || []).push(s); });
    function index(list, name) {
      var series = [];
      for (var d = 0; d < DAYS; d++) {
        var sum = 0;
        list.forEach(function (s) { sum += s.history[d] / s.history[0] * 100; });
        series.push(list.length ? Math.round(sum / list.length * 100) / 100 : 100);
      }
      var last = series[DAYS - 1], m = series[Math.max(0, DAYS - 31)], y = series[DAYS - 2];
      return { name: name, count: list.length, series: series, level: last, pct30: m ? (last - m) / m * 100 : 0, pct1: y ? (last - y) / y * 100 : 0 };
    }
    var sectorIdx = Object.keys(sectors).sort().map(function (g) { return index(sectors[g], g); });
    var composite = index(secs, 'JACK ' + secs.length);

    var by30 = secs.slice().sort(function (a, b) { return b.pct30 - a.pct30; });
    secs.forEach(function (s) { s.note = analystNote(s, sectorIdx, medianVolume); });
    return { securities: secs, sectors: sectorIdx, composite: composite, posts: posts, events: events,
      gainers: by30.slice(0, 5), losers: by30.slice(-5).reverse(), medianVolume: medianVolume, K: K, days: DAYS, today: midnight(today) };
  }

  /* ---------- Analyst notes, assembled from templates ---------- */
  function analystNote(s, sectorIdx, medianVolume) {
    var rnd = mulberry32(hashString('note:' + s.sym));
    function pick(arr) { return arr[Math.floor(rnd() * arr.length)]; }
    function q(x) { return '‘' + x + '’'; }
    function times(n) { return n === 1 ? 'once' : n === 2 ? 'twice' : n + ' times'; }
    if (!s.terms.length) {
      return pick(['No coverage: none of this book’s words have appeared on the blog. Illiquid; trades by appointment only.',
        'No coverage: the desk has never heard the owner mention anything in this title. Held for sentimental reasons.',
        'No coverage: zero shared vocabulary with the blog. We would call it a value play if anyone were buying.']);
    }
    var t1 = s.terms[0], p1 = t1.posts[0];
    var lead = s.rating + ': ' + q(t1.term) + ' mentioned ' + times(p1.count) + ' in ' + q(p1.title) + '.';
    var extras = [];
    if (s.terms.length > 1) {
      var t2 = s.terms[1], p2 = t2.posts[0];
      extras.push(pick(['Also cited: ', 'Secondary driver: ', 'Supporting the thesis, ']) + q(t2.term) + ' in ' + q(p2.title) + '.');
    }
    var sec = null;
    for (var i = 0; i < sectorIdx.length; i++) if (sectorIdx[i].name === s.sector) sec = sectorIdx[i];
    if (sec) extras.push('The ' + s.sector + ' index is ' + (sec.pct30 >= 0 ? 'up ' : 'down ') + Math.abs(sec.pct30).toFixed(1) + '% over 30 days.');
    extras.push(s.volume >= medianVolume ? pick(['Volume (description length) runs above the exchange median.', 'Healthy liquidity: the catalog entry is longer than most.'])
      : pick(['Thin volume: the catalog says little about it.', 'Light trading; the description is shorter than the median.']));
    if (s.rating === 'Strong buy' || s.rating === 'Buy') extras.push(pick(['Further upside if the owner keeps posting about ' + q(t1.term) + '.', 'Price target: whatever the next post says.', 'We expect the theme to persist; the owner cannot stop talking about it.']));
    else if (s.rating === 'Sell' || s.rating === 'Underweight') extras.push(pick(['Awaiting a catalyst, i.e. a post that mentions it.', 'Reads as a stale position; the shared words are common ones.', 'Not a conviction call.']));
    else extras.push(pick(['Fairly valued against the blog.', 'Nothing to do here until the owner blogs again.', 'A patient hold.']));
    return lead + ' ' + extras.join(' ');
  }

  var API = { K: K, DAYS: DAYS, hashString: hashString, mulberry32: mulberry32, stripMarkdown: stripMarkdown, tokenize: tokenize,
    symbolCandidates: symbolCandidates, assignSymbols: assignSymbols, basePrice: basePrice, pageProxy: pageProxy,
    parsePost: parsePost, buildMarket: buildMarket, daysAgo: daysAgo };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  root.EXCHANGE = API;
})(typeof window !== 'undefined' ? window : globalThis);
