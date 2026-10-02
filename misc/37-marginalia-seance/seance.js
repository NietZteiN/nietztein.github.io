/* Marginalia Séance — the answer engine.
   No DOM. Works in the browser (window.Seance) and under Node (module.exports).
   A word-level Markov chain (order 2, backing off to order 1) over one author's
   book descriptions and titles, seeded by a hash of the question and the date,
   and steered toward the words of the question. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Seance = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MIN_CORPUS = 30;       // latin tokens an author needs to be summonable
  var MAX_WORDS = 12;
  var MIN_WORDS = 3;
  var POSSESSION_STEPS = 6;

  // ---------- hashing and randomness ----------
  function hash(str) {            // FNV-1a, 32 bit
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }
  function rng(seed) {            // mulberry32
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function dateKey(d) {
    d = d || new Date();
    var m = d.getMonth() + 1, day = d.getDate();
    return d.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
  }

  // ---------- text ----------
  function fold(s) {              // strip diacritics
    s = String(s || '');
    try { s = s.normalize('NFD'); } catch (e) { /* old engines */ }
    return s.replace(/[̀-ͯ]/g, '');
  }
  function boardWord(w) {         // what the planchette can actually spell
    return fold(w).toUpperCase().replace(/[^A-Z0-9]/g, '');
  }
  var STOP = {};
  ('the a an and or but of to in on at by for with from as is are was were be been being it its this that these those ' +
   'he she they them his her their we you i me my our your who whom which what when where why how not no nor so than then ' +
   'too very can will would should could may might must do does did has have had into onto over under about after before ' +
   'up down out off also just only own same such more most some any all each both few other if while because until ' +
   'through during between against without within s t').split(' ').forEach(function (w) { STOP[w] = true; });

  function stem(w) {
    w = fold(w).toLowerCase().replace(/[^a-z0-9]/g, '');
    if (w.length <= 3) return w;
    var rules = [[/ies$/, 'y'], [/sses$/, 'ss'], [/ness$/, ''], [/ments?$/, ''], [/ings?$/, ''], [/ers?$/, ''],
                 [/ed$/, ''], [/ly$/, ''], [/es$/, ''], [/s$/, '']];
    for (var i = 0; i < rules.length; i++) {
      if (rules[i][0].test(w)) {
        var r = w.replace(rules[i][0], rules[i][1]);
        if (r.length >= 3) return r;
      }
    }
    return w;
  }
  function tokenize(text) {
    var out = [];
    var raw = fold(text).split(/\s+/);
    for (var i = 0; i < raw.length; i++) {
      var w = raw[i].replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '');
      if (!w) continue;
      if (!/[A-Za-z0-9]/.test(w)) continue;
      if (/[^A-Za-z0-9'’\-]/.test(w)) continue;   // drop CJK, symbols
      var end = /[.!?;:]$/.test(raw[i]);
      out.push({ w: w.toLowerCase(), end: end });
    }
    return out;
  }
  function sentences(text) {
    return String(text || '').replace(/([.!?])\s+/g, '$1\u0003').split('\u0003').filter(function (s) { return s.trim(); });
  }
  function questionStems(q) {
    var set = {};
    tokenize(q).forEach(function (t) {
      var w = t.w.replace(/[’']s$/, '');
      if (STOP[w] || w.length < 3) return;
      set[stem(w)] = true;
    });
    return set;
  }

  // ---------- roster ----------
  function roster(books) {
    var by = {};
    books.forEach(function (b) {
      if (!b.a) return;
      var k = b.a.trim();
      if (!by[k]) by[k] = { name: k, books: [] };
      by[k].books.push(b);
    });
    var list = [];
    Object.keys(by).forEach(function (k) {
      var s = by[k];
      var n = 0;
      s.books.forEach(function (b) { n += tokenize(b.t || '').length + tokenize(b.d || '').length; });
      s.tokens = n;
      s.count = s.books.length;
      if (n >= MIN_CORPUS) list.push(s);
    });
    list.sort(function (a, b) { return b.count - a.count || a.name.localeCompare(b.name); });
    return list;
  }

  // ---------- chain ----------
  function bump(map, key, next) {
    var m = map[key];
    if (!m) m = map[key] = { total: 0, next: {} };
    m.next[next] = (m.next[next] || 0) + 1;
    m.total++;
  }
  function build(spirit) {
    if (spirit.chain) return spirit.chain;
    var n1 = {}, n2 = {}, starts = { total: 0, next: {} }, vocab = {};
    var titleWords = {};
    function feed(text, isTitle) {
      var toks = tokenize(text);
      if (!toks.length) return;
      var prev1 = null, prev2 = null;
      for (var i = 0; i < toks.length; i++) {
        var w = toks[i].w;
        vocab[w] = (vocab[w] || 0) + 1;
        if (isTitle) titleWords[w] = true;
        if (i === 0) { starts.next[w] = (starts.next[w] || 0) + 1; starts.total++; }
        if (prev1) bump(n1, prev1, w);
        if (prev2) bump(n2, prev2 + '\u0001' + prev1, w);
        if (toks[i].end || i === toks.length - 1) {
          bump(n1, w, '\u0002');
          if (prev1) bump(n2, prev1 + '\u0001' + w, '\u0002');
          prev1 = null; prev2 = null;
        } else { prev2 = prev1; prev1 = w; }
      }
    }
    spirit.books.forEach(function (b) {
      if (b.t) feed(b.t, true);
      if (b.d) sentences(b.d).forEach(function (s) { feed(s, false); });
    });
    var stems = {};
    Object.keys(vocab).forEach(function (w) {
      var s = stem(w);
      if (!stems[s]) stems[s] = [];
      stems[s].push(w);
    });
    spirit.chain = { n1: n1, n2: n2, starts: starts, vocab: vocab, stems: stems, titleWords: titleWords };
    return spirit.chain;
  }

  function pickWeighted(entries, rnd) {
    var total = 0, i;
    for (i = 0; i < entries.length; i++) total += entries[i][1];
    if (total <= 0) return null;
    var r = rnd() * total;
    for (i = 0; i < entries.length; i++) {
      r -= entries[i][1];
      if (r <= 0) return entries[i][0];
    }
    return entries[entries.length - 1][0];
  }

  function generate(chain, qs, rnd) {
    var target = MIN_WORDS + Math.floor(rnd() * (MAX_WORDS - MIN_WORDS + 1));
    var words = [], used = {};
    // choose a start: a word sharing a stem with the question, else a sentence start
    var hooks = [];
    Object.keys(qs).forEach(function (s) { if (chain.stems[s]) hooks = hooks.concat(chain.stems[s]); });
    var first = null;
    if (hooks.length && rnd() < 0.7) first = hooks[Math.floor(rnd() * hooks.length)];
    else if (rnd() < 0.45) first = pickWeighted(Object.keys(chain.starts.next).map(function (w) { return [w, chain.starts.next[w]]; }), rnd);
    else first = pickWeighted(Object.keys(chain.vocab).filter(function (w) { return !STOP[w]; }).map(function (w) { return [w, chain.vocab[w]]; }), rnd);
    if (!first) return words;
    words.push(first); used[first] = true;
    var prev2 = null, prev1 = first;
    while (words.length < target) {
      var m = chain.n2[prev2 + '\u0001' + prev1];
      if (!m || Object.keys(m.next).length < 2 && rnd() < 0.5) m = chain.n1[prev1];
      if (!m) break;
      var entries = [];
      Object.keys(m.next).forEach(function (w) {
        var c = m.next[w];
        if (w === '\u0002') {
          if (words.length < MIN_WORDS) return;
          entries.push([w, c * (words.length >= target - 1 ? 3 : 1)]);
          return;
        }
        var wt = c;
        if (qs[stem(w)] && !STOP[w]) wt *= 3.5;
        if (used[w]) wt *= STOP[w] ? 0.6 : 0.15;
        entries.push([w, wt]);
      });
      var next = pickWeighted(entries, rnd);
      if (!next || next === '\u0002') break;
      words.push(next); used[next] = true;
      prev2 = prev1; prev1 = next;
    }
    // trim a trailing function word
    while (words.length > 1 && STOP[words[words.length - 1]]) words.pop();
    return words;
  }

  function cleanWords(words) {
    var out = [];
    words.forEach(function (w) { var b = boardWord(w); if (b) out.push(b); });
    return out;
  }

  // ---------- recognition of titles ----------
  function titleKeys(t) {
    var keys = [];
    var full = fold(t).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (full.length >= 4) keys.push(full);
    var head = fold(t).split(/[:(,—–-]/)[0].toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (head.length >= 6 && head !== full && head.split(' ').length >= 2) keys.push(head);
    return keys;
  }
  function recognise(spirit, question) {
    var q = ' ' + fold(question).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() + ' ';
    var best = null, bestLen = 0;
    spirit.books.forEach(function (b) {
      if (!b.t) return;
      titleKeys(b.t).forEach(function (k) {
        if (k.length > bestLen && q.indexOf(' ' + k + ' ') >= 0) { best = b; bestLen = k.length; }
      });
    });
    return best;
  }
  function fragment(book, qs, rnd) {
    var sents = sentences(book.d || '');
    if (!sents.length) {
      var tw = cleanWords(tokenize(book.t).map(function (t) { return t.w; }));
      if (book.y) tw.push(String(book.y));
      return tw.slice(0, MAX_WORDS);
    }
    // prefer a sentence that shares a stem with the question
    var scored = sents.map(function (s) {
      var n = 0; tokenize(s).forEach(function (t) { if (qs[stem(t.w)] && !STOP[t.w]) n++; });
      return [s, n];
    });
    scored.sort(function (a, b) { return b[1] - a[1]; });
    var pool = scored.filter(function (x) { return x[1] === scored[0][1]; });
    var sent = pool[Math.floor(rnd() * pool.length)][0];
    var toks = tokenize(sent).map(function (t) { return t.w; });
    var len = Math.min(toks.length, 5 + Math.floor(rnd() * (MAX_WORDS - 5 + 1)));
    var start = 0;
    if (toks.length > len) {
      // start at a question word if one occurs, else at a random clause-ish offset
      var at = -1;
      for (var i = 0; i < toks.length - 2; i++) if (qs[stem(toks[i])] && !STOP[toks[i]]) { at = i; break; }
      start = at >= 0 ? Math.max(0, Math.min(at, toks.length - len)) : Math.floor(rnd() * (toks.length - len + 1));
    }
    var w = toks.slice(start, start + len);
    while (w.length > 1 && STOP[w[w.length - 1]]) w.pop();
    return cleanWords(w);
  }

  // ---------- the oracle ----------
  var YESNO = /^(is|are|am|do|does|did|will|would|can|could|should|shall|was|were|has|have|had|may|might|must)\b/;

  function ask(spirit, question, opts) {
    opts = opts || {};
    var date = opts.date || dateKey();
    var asked = opts.asked || 0;
    var qn = fold(question).toLowerCase().replace(/\s+/g, ' ').trim();
    var seed = hash(date + '|' + spirit.name + '|' + qn);
    var rnd = rng(seed);
    var qs = questionStems(question);
    var chain = build(spirit);
    var result = { kind: 'words', words: [], seed: seed, spirit: spirit.name };

    if (/\b(good ?bye|farewell|leave us|go away|be gone)\b/.test(qn)) {
      result.kind = 'goodbye'; result.words = ['GOODBYE']; return result;
    }
    var book = recognise(spirit, question);
    if (book) {
      result.kind = 'recognise';
      result.book = book;
      result.words = fragment(book, qs, rnd);
      if (result.words.length >= MIN_WORDS) return result;
      result.kind = 'words';
    }
    var r = rnd();
    var pGoodbye = asked >= 3 ? 0.06 + Math.min(asked - 3, 6) * 0.015 : 0.015;
    var yesno = YESNO.test(qn);
    var pYes = yesno ? 0.18 : 0.06, pNo = yesno ? 0.16 : 0.05, pNum = 0.07;
    if (r < pGoodbye) { result.kind = 'goodbye'; result.words = ['GOODBYE']; return result; }
    r -= pGoodbye;
    if (r < pYes) { result.kind = 'yes'; result.words = ['YES']; return result; }
    r -= pYes;
    if (r < pNo) { result.kind = 'no'; result.words = ['NO']; return result; }
    r -= pNo;
    var years = spirit.books.filter(function (b) { return b.y; });
    if (r < pNum && years.length) {
      var yb = years[Math.floor(rnd() * years.length)];
      result.kind = 'number'; result.words = [String(yb.y)]; result.book = yb; return result;
    }
    var words = [];
    for (var attempt = 0; attempt < 6 && words.length < MIN_WORDS; attempt++) {
      words = cleanWords(generate(chain, qs, rnd));
    }
    if (words.length < MIN_WORDS) {
      result.kind = rnd() < 0.5 ? 'yes' : 'no';
      result.words = [result.kind.toUpperCase()];
      return result;
    }
    result.words = words.slice(0, MAX_WORDS);
    return result;
  }

  function pickNear(list, date, session) {
    if (!list.length) return null;
    var r = rng(hash('near|' + (date || dateKey()) + '|' + (session || 0)));
    // weight by sqrt(book count) so the big shelves are a little more present
    var entries = list.map(function (s) { return [s, Math.sqrt(s.count)]; });
    return pickWeighted(entries, r);
  }
  function nextSpirit(list, current, salt) {
    var others = list.filter(function (s) { return s !== current; });
    if (!others.length) return current;
    var r = rng(hash('possess|' + (current ? current.name : '') + '|' + (salt || '')));
    return others[Math.floor(r() * others.length)];
  }

  return {
    hash: hash, rng: rng, dateKey: dateKey, stem: stem, tokenize: tokenize, boardWord: boardWord,
    roster: roster, build: build, ask: ask, recognise: recognise, pickNear: pickNear, nextSpirit: nextSpirit,
    POSSESSION_STEPS: POSSESSION_STEPS, MAX_WORDS: MAX_WORDS, MIN_WORDS: MIN_WORDS
  };
}));
