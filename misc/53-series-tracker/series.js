/* Runs — series parser.
   Turns the flat library catalogue into numbered series: it reads the volume
   marker off each title ("Vol. 3", "第3巻", "(3)", "③", "III", "上/下", a bare
   trailing number...), strips it to get the series name, normalises the name
   for grouping, and merges groups that share author and publisher. Pure data,
   no DOM; works in the browser (window.Series) and under Node (module.exports)
   so the test file can print every group for eyeballing. */
(function (root) {
  'use strict';

  // ---- Manual overrides -----------------------------------------------------
  // Keyed by book id. series: the series name to file under; vol / volEnd: the
  // volume number(s), null for an unnumbered volume; label: text shown on the
  // spine instead of the number; skip: not a series volume at all.
  var OVERRIDES = {
    // Nisioisin's Monogatari novels in Vertical's publication order.
    'K-MtoO-08': { series: 'Monogatari (Vertical)', vol: 1, label: 'Bakemonogatari, Part 01' },
    'K-MtoO-09': { series: 'Monogatari (Vertical)', vol: 2, label: 'Bakemonogatari, Part 02' },
    'K-MtoO-10': { series: 'Monogatari (Vertical)', vol: 3, label: 'Bakemonogatari, Part 03' },
    'K-MtoO-07': { series: 'Monogatari (Vertical)', vol: 4, label: 'Kizumonogatari' },
    'K-MtoO-11': { series: 'Monogatari (Vertical)', vol: 5, label: 'Nisemonogatari, Part 01' },
    'K-MtoO-12': { series: 'Monogatari (Vertical)', vol: 6, label: 'Nisemonogatari, Part 02' },
    'K-MtoO-13': { series: 'Monogatari (Vertical)', vol: 7, label: 'Nekomonogatari (Black)' },
    'K-MtoO-14': { series: 'Monogatari (Vertical)', vol: 8, label: 'Nekomonogatari (White)' },
    'K-MtoO-15': { series: 'Monogatari (Vertical)', vol: 9, label: 'Kabukimonogatari' },
    // Two doujinshi catalogued as one row.
    'N-N2(Berlitz,Catan)-19': { series: '限界の空を奔る精霊', vol: 1, volEnd: 2, label: 'I and II' },
    // The Italian omnibus is marked ∞ on the spine.
    'N-N1(Uffizi)-11': { series: 'Bloom Into You (Italian)', vol: null, label: '∞' },
    // Two 篇 of the same gag series with inconsistent numbering.
    'N-N4(バガボンド,くず)-07': { series: 'いつも心に太陽を!', vol: null, label: '激浪篇' },
    'N-N4(バガボンド,くず)-08': { series: 'いつも心に太陽を!', vol: null, label: '時空篇 2' },
    // 山岸凉子's self-selected collection, unnumbered.
    'N-N5(手塚,吉田秋生)-27': { series: '山岸凉子 自選作品集', vol: null, label: '夜叉御前' },
    'N-N5(手塚,吉田秋生)-28': { series: '山岸凉子 自選作品集', vol: null, label: '天人唐草' },
    // GENKI workbooks: the roman numeral sits mid-title.
    'N-N1(Uffizi)-29': { series: 'GENKI Workbook', vol: 1 },
    'N-N1(Uffizi)-28': { series: 'GENKI Workbook', vol: 2 },
    // "Mathematics Level 2" is an SAT subject, not a volume.
    'H-H4-08': { skip: true },
    // "Japanese From Zero! 1" is a textbook series; keep it out of the manga shop.
    'H-H5-01': { skip: true },
  };

  // Types that never form series (issues are not volumes).
  var SKIP_TYPES = { Magazine: 1, 'Math journal': 1, Calendar: 1, Media: 1, Game: 1, Games: 1, Other: 1 };
  // "Level N" is only a volume marker for fiction-ish types.
  var LEVEL_TYPES = { 'Light novel': 1, Manga: 1, Fiction: 1, Comics: 1 };

  var WORD_NUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
  var ORD_NUM = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10 };
  var ROMAN = { I: 1, V: 5, X: 10, L: 50, C: 100 };
  var KANJI = { '〇': 0, '零': 0, '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10 };
  var CIRCLED_BASE = 0x2460; // ① .. ⑳
  var UROMAN_BASE = 0x2160;  // Ⅰ .. Ⅻ

  // ---- Number helpers -------------------------------------------------------

  function romanToInt(s) {
    s = s.toUpperCase();
    if (!/^[IVXLC]+$/.test(s)) return null;
    var n = 0;
    for (var i = 0; i < s.length; i++) {
      var v = ROMAN[s[i]], nx = ROMAN[s[i + 1]] || 0;
      n += v < nx ? -v : v;
    }
    return n > 0 && n <= 100 ? n : null;
  }

  function kanjiToInt(s) {
    // handles 一..九十九 (十, 十一, 二十, 二十三 ...)
    var n = 0, cur = 0, ok = false;
    for (var i = 0; i < s.length; i++) {
      var c = s[i];
      if (!(c in KANJI)) return null;
      var v = KANJI[c];
      ok = true;
      if (v === 10) { n += (cur || 1) * 10; cur = 0; }
      else cur = v;
    }
    n += cur;
    return ok && n > 0 ? n : null;
  }

  function anyToInt(s) {
    if (s == null) return null;
    s = String(s).trim();
    if (/^\d+$/.test(s)) return parseInt(s, 10);
    var lo = s.toLowerCase();
    if (lo in WORD_NUM) return WORD_NUM[lo];
    if (lo in ORD_NUM) return ORD_NUM[lo];
    var r = romanToInt(s);
    if (r != null) return r;
    if (s.length === 1) {
      var cp = s.charCodeAt(0);
      if (cp >= CIRCLED_BASE && cp < CIRCLED_BASE + 20) return cp - CIRCLED_BASE + 1;
      if (cp >= UROMAN_BASE && cp < UROMAN_BASE + 12) return cp - UROMAN_BASE + 1;
    }
    return kanjiToInt(s);
  }

  // ---- Text helpers ---------------------------------------------------------

  // Full-width ASCII and ideographic space to their half-width twins. One
  // character in, one character out, so indices still line up with the
  // original title.
  function foldWidth(s) {
    var out = '';
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c >= 0xFF01 && c <= 0xFF5E) out += String.fromCharCode(c - 0xFEE0);
      else if (c === 0x3000) out += ' ';
      else out += s[i];
    }
    return out;
  }

  var CJK_RE = /[぀-ヿ㐀-䶿一-鿿豈-﫿]/;
  function hasCJK(s) { return CJK_RE.test(s || ''); }

  function stripAccents(s) {
    return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '');
  }

  // Grouping key: width- and case-folded, accent-stripped, punctuation and
  // spaces removed.
  function keyOf(s) {
    return stripAccents(String(s || '').normalize('NFKC')).toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '');
  }

  function cleanBase(b) {
    b = b.replace(/[\s,:;\-–—・]+$/u, '');
    b = b.replace(/\s*\d+-in-\d+\s+edition$/i, '');
    b = b.replace(/\s+omnibus$/i, '');
    b = b.replace(/\s*(完全版|新装版|愛蔵版|文庫版)$/u, '');
    b = b.replace(/[\s,:;\-–—・]+$/u, '');
    return b.trim();
  }

  function cleanPub(p) {
    return String(p || '').replace(/\s*\([^()]*\)\s*$/, '').trim();
  }

  function cleanAuthor(a) {
    return String(a || '').replace(/\s*\((?:author|spine)[^()]*\)\s*$/i, '').trim();
  }

  // ---- The parser -----------------------------------------------------------

  // parseTitle(title, type) -> { base, vol, volEnd, label, total, note, how }
  //   base   the series name with the volume marker removed (original spelling)
  //   vol    first volume number (null when no marker was found)
  //   volEnd last volume number when the book binds several (omnibus)
  //   label  a volume subtitle or marker text ("上", "番外編", "Folk-Lore ...")
  //   total  declared length ("Vol. 1 (of four)") or null
  //   how    which rule fired, for the test printout
  function parseTitle(title, type) {
    var orig = String(title || '').trim();
    var t = foldWidth(orig);
    var res = { base: orig, vol: null, volEnd: null, label: '', total: null, note: '', how: '' };
    if (!t) return res;

    // A. trailing parentheticals: declared totals, bare "(3)", "(series N)", notes.
    var guard = 0, m;
    while (guard++ < 4 && (m = /\s*\(([^()]*)\)\s*$/.exec(t))) {
      var inner = m[1].trim(), cut = m.index;
      var mm;
      if ((mm = /^of\s+(\w+)$/i.exec(inner)) && anyToInt(mm[1])) {
        res.total = anyToInt(mm[1]);
        t = t.slice(0, cut); orig = orig.slice(0, cut); continue;
      }
      if ((mm = /^(上|中|下)巻?$/u.exec(inner))) {
        res.vol = { '上': 1, '中': 2, '下': 3 }[mm[1]]; res.label = mm[1]; res.jouge = mm[1]; res.how = 'paren-jouge';
        t = t.slice(0, cut); orig = orig.slice(0, cut);
        res.base = cleanBase(orig);
        return finish(res);
      }
      if ((mm = /^(\d{1,3})$/.exec(inner))) {
        res.vol = parseInt(mm[1], 10); res.how = 'paren-number';
        t = t.slice(0, cut); orig = orig.slice(0, cut);
        res.base = cleanBase(orig);
        return finish(res);
      }
      if ((mm = /^(.+?)\s+(\d{1,3})$/.exec(inner)) &&
        /(集|選|文庫|シリーズ|series|collection|library|works)/i.test(mm[1])) {
        // "(藤子・F・不二雄 異色短編集 4)": the parenthetical names the series.
        res.vol = parseInt(mm[2], 10); res.how = 'paren-series';
        res.label = cleanBase(orig.slice(0, cut));
        res.base = cleanBase(mm[1]);
        return finish(res);
      }
      // anything else is a note (omnibus, 番外編, edition, copy 2 ...)
      res.note = res.note ? inner + '; ' + res.note : inner;
      t = t.slice(0, cut); orig = orig.slice(0, cut);
    }

    // B. edition suffixes are not volumes.
    var ed = /(,?\s*\d+(?:st|nd|rd|th)\s+ed(?:ition)?\.?(?:\s+revised)?|,?\s*(?:Brief\s+)?Edition\s+\d+(?:\.\d+)?)\s*$/i.exec(t);
    if (ed) { t = t.slice(0, ed.index); orig = orig.slice(0, ed.index); }

    var rules = [
      // Vols. 1-3, Vols. I & II
      { how: 'vols-range', re: /[,\s]+Vols?\.?\s*([0-9]+|[IVXLC]+)\s*(?:-|–|&|and|to)\s*([0-9]+|[IVXLC]+)\s*$/i,
        f: function (x) { res.vol = anyToInt(x[1]); res.volEnd = anyToInt(x[2]); } },
      // Vol. 17: subtitle / Book 1 / Part 01 / Part One / Level 2 / Tome II
      { how: 'vol-word', re: /[,\s]+(Vol|Volume|Tome|Tomo|Book|Part|Level)\.?\s*([0-9]+|[IVXLC]+|One|Two|Three|Four|Five|Six|Seven|Eight|Nine|Ten)\b\s*(?:[:,]\s*(.+))?$/i,
        f: function (x) {
          if (/^level$/i.test(x[1]) && !LEVEL_TYPES[type]) return 'stop';
          res.vol = anyToInt(x[2]); res.label = (x[3] || '').trim();
        } },
      // First Canto, Chapters 1-8
      { how: 'ordinal-word', re: /[,\s]+(First|Second|Third|Fourth|Fifth|Sixth|Seventh|Eighth|Ninth|Tenth)\s+(Volume|Book|Part|Canto|Series)\b\s*(?:,\s*(.+))?$/i,
        f: function (x) { res.vol = ORD_NUM[x[1].toLowerCase()]; res.label = (x[1] + ' ' + x[2] + (x[3] ? ', ' + x[3] : '')).trim(); } },
      // 第3巻 / 第一巻 / 第2部 予言する鳥編
      { how: 'dai-kan', re: /\s*第\s*([0-9]+|[一二三四五六七八九十]+)\s*(巻|部|集)(?:\s+(.+))?$/u,
        f: function (x) { res.vol = anyToInt(x[1]); res.label = (x[3] || '').trim(); } },
      // 巻之一
      { how: 'kan-no', re: /\s*巻之([0-9]+|[一二三四五六七八九十]+)$/u,
        f: function (x) { res.vol = anyToInt(x[1]); } },
      // 上 / 中 / 下 (巻)
      { how: 'jouge', re: /\s+(上|中|下)巻?$/u,
        f: function (x) { res.vol = { '上': 1, '中': 2, '下': 3 }[x[1]]; res.label = x[1]; res.jouge = x[1]; } },
      // ③ / Ⅲ
      { how: 'circled', re: /\s*([①-⑳Ⅰ-Ⅻ])$/u,
        f: function (x) { res.vol = anyToInt(x[1]); } },
      // trailing roman numeral: "頼むから静かにしてくれ I"
      { how: 'roman', re: /\s+([IVX]{1,5})$/,
        f: function (x) { var n = romanToInt(x[1]); if (!n || n > 30) return false; res.vol = n; } },
      // trailing kanji numeral: "竹光侍 一"
      { how: 'kanji', re: /\s+([一二三四五六七八九十]{1,3})$/u,
        f: function (x) { res.vol = kanjiToInt(x[1]); } },
      // bare trailing number, optionally followed by a Japanese subtitle:
      // "バガボンド 3", "伊藤潤二傑作集 9 墓標の町"
      { how: 'trailing-number', re: /\s+(\d{1,3})(?:\s+([^\d\s][^\d]*))?$/u,
        f: function (x) {
          if (x[2] && !hasCJK(x[2])) return false;
          res.vol = parseInt(x[1], 10); res.label = (x[2] || '').trim();
        } },
    ];

    for (var i = 0; i < rules.length; i++) {
      var r = rules[i], x = r.re.exec(t);
      if (!x) continue;
      var base = orig.slice(0, x.index);
      if (!cleanBase(base)) continue;              // "1984": nothing left to be a series
      var verdict = r.f(x);
      if (verdict === 'stop') break;
      if (verdict === false) continue;
      res.how = r.how;
      res.base = cleanBase(base);
      return finish(res);
    }
    res.base = cleanBase(orig);
    return finish(res);
  }

  function finish(res) {
    if (res.vol != null && (!(res.vol > 0) || res.vol > 999)) { res.vol = null; res.volEnd = null; }
    if (res.volEnd != null && res.vol != null && res.volEnd < res.vol) res.volEnd = null;
    if (res.volEnd != null && res.vol != null && res.volEnd === res.vol) res.volEnd = null;
    if (res.note && /copy\s+\d+/i.test(res.note) && !res.label) res.label = '';
    return res;
  }

  // ---- Grouping -------------------------------------------------------------

  function majority(list, pick) {
    var c = {}, best = null, bestN = 0;
    for (var i = 0; i < list.length; i++) {
      var v = pick(list[i]);
      if (!v) continue;
      c[v] = (c[v] || 0) + 1;
      if (c[v] > bestN) { bestN = c[v]; best = v; }
    }
    return best;
  }

  function typeClass(ty) {
    if (ty === 'Manga') return 'manga';
    if (ty === 'Light novel') return 'ln';
    if (ty === 'Comics') return 'comics';
    if (ty === 'Anthology') return 'anthology';
    return 'other';
  }

  function hash(str) {
    var h = 2166136261 >>> 0;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995) >>> 0; h ^= h >>> 15;
    return h >>> 0;
  }

  // ranges([1,2,3,5,8,9]) -> "1–3, 5, 8–9"
  function ranges(nums) {
    var a = nums.slice().sort(function (p, q) { return p - q; }), out = [];
    for (var i = 0; i < a.length; i++) {
      var s = a[i], e = s;
      while (i + 1 < a.length && a[i + 1] === e + 1) { e = a[++i]; }
      out.push(s === e ? String(s) : s + '–' + e);
    }
    return out.join(', ');
  }

  // buildSeries(books) -> array of series objects (see below), every book with
  // a volume marker or an override, plus unnumbered groups of two or more.
  function buildSeries(books) {
    var items = [];
    for (var i = 0; i < books.length; i++) {
      var b = books[i];
      if (!b || !b.t) continue;
      if (/^\(not a book\)/.test(b.t)) continue;
      var ov = OVERRIDES[b.id];
      if (ov && ov.skip) continue;
      var p;
      if (ov) {
        p = { base: ov.series, vol: ov.vol == null ? null : ov.vol, volEnd: ov.volEnd || null, label: ov.label || '', total: ov.total || null, note: '', how: 'override' };
      } else {
        if (SKIP_TYPES[b.ty]) continue;
        p = parseTitle(b.t, b.ty);
      }
      items.push({ book: b, parse: p, key: keyOf(p.base), key2: keyOf(p.base.replace(/\s*[:：].*$/u, '').replace(/\s*\([^()]*\)\s*$/, '')), author: keyOf(cleanAuthor(b.a)) });
    }

    // group by key
    var groups = {}, order = [];
    items.forEach(function (it) {
      if (!groups[it.key]) { groups[it.key] = { items: [] }; order.push(it.key); }
      groups[it.key].items.push(it);
    });

    // merge groups that share the short key and the author
    var byShort = {};
    order.forEach(function (k) {
      var g = groups[k]; if (!g) return;
      var it = g.items[0];
      if (!it.key2 || !it.author) return;
      var sk = it.key2 + '|' + it.author;
      if (byShort[sk] && byShort[sk] !== k && groups[byShort[sk]]) {
        var tgt = groups[byShort[sk]];
        tgt.items = tgt.items.concat(g.items);
        tgt.merged = true;
        delete groups[k];
      } else byShort[sk] = k;
    });

    var out = [];
    order.forEach(function (k) {
      var g = groups[k]; if (!g) return;
      var its = g.items;
      if (g.merged) {
        // merged on the part before the colon: that part is the series name,
        // the rest of each title is the volume's label
        var short = null;
        its.forEach(function (it) {
          var head = it.parse.base.replace(/\s*[:：].*$/u, '').replace(/\s*\([^()]*\)\s*$/, '').trim();
          if (!short || head.length < short.length) short = head;
        });
        its.forEach(function (it) {
          var rest = it.parse.base.slice(short.length).replace(/^[\s:：]+/u, '').trim();
          if (rest && !it.parse.label) it.parse.label = rest;
          it.parse.base = short;
        });
      }
      var numbered = its.filter(function (it) { return it.parse.vol != null; });
      if (numbered.length === 0 && !g.merged && !its.every(function (it) { return it.parse.how === 'override'; })) return;
      if (numbered.length === 0 && its.length < 2) return;      // a lone, unnumbered book
      // an unnumbered book only belongs to a numbered run if the author agrees
      // (same title, different work: "La Divina Commedia" by Dante vs Go Nagai)
      if (numbered.length) {
        var mainAuthor = majority(numbered, function (it) { return it.author; });
        its = its.filter(function (it) {
          return it.parse.vol != null || it.parse.how === 'override' || !mainAuthor || it.author === mainAuthor;
        });
      }
      out.push(makeSeries(its));
    });
    return out;
  }

  function makeSeries(its) {
    var name = majority(its, function (it) { return it.parse.base; }) || its[0].parse.base;
    // 上/中/下: renumber 下 to 2 when there is no 中, and declare the total.
    var hasChu = its.some(function (it) { return it.parse.jouge === '中'; });
    var hasGe = its.some(function (it) { return it.parse.jouge === '下'; });
    var jougeTotal = null;
    its.forEach(function (it) {
      if (it.parse.jouge === '下' && !hasChu) it.parse.vol = 2;
    });
    if (hasGe) jougeTotal = hasChu ? 3 : 2;

    var vols = {}, unnumbered = [], total = jougeTotal;
    its.forEach(function (it) {
      var p = it.parse;
      if (p.total) total = Math.max(total || 0, p.total);
      if (p.vol == null) { unnumbered.push({ n: null, nEnd: null, label: p.label || p.note || it.book.t, books: [it.book], note: p.note }); return; }
      var key = p.vol + (p.volEnd ? '-' + p.volEnd : '');
      if (!vols[key]) vols[key] = { n: p.vol, nEnd: p.volEnd, label: p.label, note: p.note, books: [] };
      vols[key].books.push(it.book);
      if (!vols[key].label && p.label) vols[key].label = p.label;
    });
    var volumes = Object.keys(vols).map(function (k) { return vols[k]; })
      .sort(function (a, b) { return a.n - b.n || (a.nEnd || a.n) - (b.nEnd || b.n); });
    unnumbered.sort(function (a, b) { return String(a.label).localeCompare(String(b.label), 'ja'); });

    var covered = {}, maxSeen = 0;
    volumes.forEach(function (v) {
      var e = v.nEnd || v.n;
      for (var n = v.n; n <= e; n++) covered[n] = v;
      if (e > maxSeen) maxSeen = e;
    });
    var span = Math.max(maxSeen, total || 0);
    var missing = [];
    for (var n = 1; n <= span; n++) if (!covered[n]) missing.push(n);
    var ownedNums = Object.keys(covered).map(Number).sort(function (a, b) { return a - b; });
    // longest consecutive run
    var longest = 0, cur = 0, prev = 0;
    ownedNums.forEach(function (n) { cur = n === prev + 1 ? cur + 1 : 1; prev = n; if (cur > longest) longest = cur; });

    var books = [];
    its.forEach(function (it) { books.push(it.book); });
    var shelves = {}, units = {};
    books.forEach(function (b) {
      var sk = b.u + '|' + b.s;
      if (!shelves[sk]) shelves[sk] = { u: b.u, s: b.s, count: 0, ids: [] };
      shelves[sk].count++; shelves[sk].ids.push(b.id);
      units[b.u] = (units[b.u] || 0) + 1;
    });
    var shelfList = Object.keys(shelves).map(function (k) { return shelves[k]; }).sort(function (a, b) { return b.count - a.count; });
    var years = books.map(function (b) { return b.y; }).filter(function (y) { return y; });
    var ty = majority(books, function (b) { return b.ty; });
    var copies = 0;
    volumes.forEach(function (v) { if (v.books.length > 1) copies += v.books.length - 1; });

    var langs = {};
    books.forEach(function (b) { String(b.l || '?').split('/').forEach(function (c) { langs[c] = (langs[c] || 0) + 1; }); });

    return {
      name: name,
      key: keyOf(name),
      cjk: hasCJK(name),
      type: typeClass(ty),
      ty: ty,
      lang: majority(books, function (b) { return b.l; }) || '?',
      langs: langs,
      author: cleanAuthor(majority(books, function (b) { return b.a; }) || ''),
      pub: cleanPub(majority(books, function (b) { return cleanPub(b.pub); }) || ''),
      genre: majority(books, function (b) { return b.g; }) || '',
      hue: hash(keyOf(name)) % 360,
      shade: (hash('shade' + keyOf(name)) % 1000) / 1000,
      volumes: volumes,
      unnumbered: unnumbered,
      books: books,
      owned: ownedNums.length + unnumbered.length,
      ownedNums: ownedNums,
      maxSeen: maxSeen,
      total: total,
      span: span,
      missing: missing,
      longestRun: longest,
      copies: copies,
      shelves: shelfList,
      units: Object.keys(units),
      years: years.length ? [Math.min.apply(null, years), Math.max.apply(null, years)] : null,
    };
  }

  // "volumes 1–8 and 10 present; 9 missing"
  function describe(s) {
    if (!s.ownedNums.length) {
      return s.owned === 1 ? 'one unnumbered volume' : s.owned + ' unnumbered volumes';
    }
    var txt = (s.ownedNums.length === 1 ? 'volume ' : 'volumes ') + ranges(s.ownedNums).replace(/, ([^,]+)$/, ' and $1') + ' present';
    if (s.missing.length) txt += '; ' + ranges(s.missing).replace(/, ([^,]+)$/, ' and $1') + ' missing';
    else if (s.total) txt += '; all ' + s.total + ' declared volumes';
    else txt += '; no gaps up to ' + s.maxSeen;
    if (s.unnumbered.length) txt += '; plus ' + s.unnumbered.length + ' unnumbered';
    if (s.copies) txt += '; ' + s.copies + ' duplicate cop' + (s.copies === 1 ? 'y' : 'ies');
    return txt;
  }

  var API = {
    parseTitle: parseTitle, buildSeries: buildSeries, describe: describe, ranges: ranges,
    keyOf: keyOf, hasCJK: hasCJK, stripAccents: stripAccents, hash: hash, anyToInt: anyToInt,
    OVERRIDES: OVERRIDES,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.Series = API;
})(typeof window !== 'undefined' ? window : this);
