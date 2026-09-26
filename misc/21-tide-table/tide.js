/* Tide Table for Prose: the pure drift engine.
   Works in the browser (window.TIDE) and in Node (module.exports) so it can be tested headlessly.
   Nothing in here touches the DOM. */
(function (root) {
  'use strict';

  /* ---------- Bundled openings (all public domain) ---------- */
  var PARAGRAPHS = [
    { id: 'moby', title: 'Moby-Dick', author: 'Herman Melville, 1851',
      text: 'Call me Ishmael. Some years ago—never mind how long precisely—having little or no money in my purse, and nothing particular to interest me on shore, I thought I would sail about a little and see the watery part of the world. It is a way I have of driving off the spleen and regulating the circulation. Whenever I find myself growing grim about the mouth; whenever it is a damp, drizzly November in my soul; whenever I find myself involuntarily pausing before coffin warehouses, and bringing up the rear of every funeral I meet; and especially whenever my hypos get such an upper hand of me, that it requires a strong moral principle to prevent me from deliberately stepping into the street, and methodically knocking people’s hats off—then, I account it high time to get to sea as soon as I can.' },
    { id: 'pride', title: 'Pride and Prejudice', author: 'Jane Austen, 1813',
      text: 'It is a truth universally acknowledged, that a single man in possession of a good fortune, must be in want of a wife. However little known the feelings or views of such a man may be on his first entering a neighbourhood, this truth is so well fixed in the minds of the surrounding families, that he is considered the rightful property of some one or other of their daughters.' },
    { id: 'cities', title: 'A Tale of Two Cities', author: 'Charles Dickens, 1859',
      text: 'It was the best of times, it was the worst of times, it was the age of wisdom, it was the age of foolishness, it was the epoch of belief, it was the epoch of incredulity, it was the season of Light, it was the season of Darkness, it was the spring of hope, it was the winter of despair, we had everything before us, we had nothing before us, we were all going direct to Heaven, we were all going direct the other way—in short, the period was so far like the present period, that some of its noisiest authorities insisted on its being received, for good or for evil, in the superlative degree of comparison only.' },
    { id: 'genesis', title: 'Genesis 1', author: 'King James Bible, 1611',
      text: 'In the beginning God created the heaven and the earth. And the earth was without form, and void; and darkness was upon the face of the deep. And the Spirit of God moved upon the face of the waters. And God said, Let there be light: and there was light. And God saw the light, that it was good: and God divided the light from the darkness. And God called the light Day, and the darkness he called Night. And the evening and the morning were the first day.' },
    { id: 'walden', title: 'Walden', author: 'Henry David Thoreau, 1854',
      text: 'I went to the woods because I wished to live deliberately, to front only the essential facts of life, and see if I could not learn what it had to teach, and not, when I came to die, discover that I had not lived. I did not wish to live what was not life, living is so dear; nor did I wish to practise resignation, unless it was quite necessary. I wanted to live deep and suck out all the marrow of life, to live so sturdily and Spartan-like as to put to rout all that was not life, to cut a broad swath and shave close, to drive life into a corner, and reduce it to its lowest terms.' },
    { id: 'alice', title: 'Alice’s Adventures in Wonderland', author: 'Lewis Carroll, 1865',
      text: 'Alice was beginning to get very tired of sitting by her sister on the bank, and of having nothing to do: once or twice she had peeped into the book her sister was reading, but it had no pictures or conversations in it, “and what is the use of a book,” thought Alice, “without pictures or conversations?” So she was considering in her own mind (as well as she could, for the hot day made her feel very sleepy and stupid), whether the pleasure of making a daisy-chain would be worth the trouble of getting up and picking the daisies, when suddenly a White Rabbit with pink eyes ran close by her.' },
    { id: 'holmes', title: 'A Scandal in Bohemia', author: 'Arthur Conan Doyle, 1891',
      text: 'To Sherlock Holmes she is always the woman. I have seldom heard him mention her under any other name. In his eyes she eclipses and predominates the whole of her sex. It was not that he felt any emotion akin to love for Irene Adler. All emotions, and that one particularly, were abhorrent to his cold, precise but admirably balanced mind. He was, I take it, the most perfect reasoning and observing machine that the world has seen, but as a lover he would have placed himself in a false position. He never spoke of the softer passions, save with a gibe and a sneer.' },
    { id: 'jane', title: 'Jane Eyre', author: 'Charlotte Brontë, 1847',
      text: 'There was no possibility of taking a walk that day. We had been wandering, indeed, in the leafless shrubbery an hour in the morning; but since dinner (Mrs. Reed, when there was no company, dined early) the cold winter wind had brought with it clouds so sombre, and a rain so penetrating, that further out-door exercise was now out of the question.' }
  ];

  /* ---------- Small deterministic hashing / PRNG ---------- */
  // FNV-1a style string hash to a 32-bit integer.
  function hashString(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }
  // Mix two 32-bit integers into a well-scrambled 32-bit value (splitmix-like).
  function mix(a, b) {
    var x = (a ^ Math.imul(b + 1, 0x9E3779B9)) >>> 0;
    x = Math.imul(x ^ (x >>> 16), 0x85EBCA6B) >>> 0;
    x = Math.imul(x ^ (x >>> 13), 0xC2B2AE35) >>> 0;
    return (x ^ (x >>> 16)) >>> 0;
  }
  // mulberry32: tiny seeded generator returning [0,1).
  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ---------- Tokenising ---------- */
  // Split text into word tokens and everything-else tokens, preserving the original exactly.
  // A word is a run of letters; words with internal apostrophes or hyphens are kept whole and never replaced.
  var WORD_RE = /[A-Za-z]+(?:[’'\-][A-Za-z]+)*|[^A-Za-z]+/g;
  function tokenize(text) {
    var out = [], m, i = 0;
    var parts = text.match(WORD_RE) || [];
    var prevEndsSentence = true;   // the first word is sentence-initial
    for (var k = 0; k < parts.length; k++) {
      var s = parts[k];
      var isWord = /^[A-Za-z]/.test(s);
      if (isWord) {
        out.push({ i: i++, word: s, orig: s, initial: prevEndsSentence, isWord: true });
        prevEndsSentence = false;
      } else {
        out.push({ text: s, isWord: false });
        if (/[.!?]/.test(s)) prevEndsSentence = true;
      }
    }
    return out;
  }

  /* ---------- Morphology (deliberately naive) ---------- */
  function isVowel(c) { return 'aeiou'.indexOf(c) >= 0; }
  // Ends in consonant-vowel-consonant (stop -> stopped): we simply refuse to inflect these.
  function endsCVC(w) {
    if (w.length < 3) return false;
    var a = w[w.length - 3], b = w[w.length - 2], c = w[w.length - 1];
    return !isVowel(a) && isVowel(b) && !isVowel(c) && 'wxy'.indexOf(c) < 0;
  }
  // Attach a suffix to a base word; returns null when the naive rule would probably misspell it or when the
  // inflected form is not attested (forms[base] is a bitmask: 1 = takes -s, 2 = takes -ed, 4 = takes -ing).
  var SUFFIX_BIT = { s: 1, ed: 2, ing: 4 };
  function inflect(base, suffix, forms) {
    var last = base[base.length - 1], prev = base[base.length - 2] || '';
    if (suffix === '') return base;
    if (forms && !((forms[base] || 0) & SUFFIX_BIT[suffix])) return null;
    if (suffix === 's') {
      if (/(s|x|z|ch|sh)$/.test(base)) return base + 'es';
      if (last === 'y' && !isVowel(prev)) return base.slice(0, -1) + 'ies';
      return base + 's';
    }
    if (suffix === 'ed') {
      if (last === 'e') return base + 'd';
      if (last === 'y' && !isVowel(prev)) return base.slice(0, -1) + 'ied';
      if (endsCVC(base)) return null;
      return base + 'ed';
    }
    if (suffix === 'ing') {
      if (last === 'e' && prev !== 'e') return base.slice(0, -1) + 'ing';
      if (endsCVC(base)) return null;
      return base + 'ing';
    }
    return null;
  }
  // Guess (base, suffix) pairs for a surface word; the first pair whose base is in the thesaurus wins.
  function analyse(lower, table) {
    var tries = [[lower, '']];
    if (/ies$/.test(lower) && lower.length > 4) tries.push([lower.slice(0, -3) + 'y', 's']);
    if (/(ches|shes|sses|xes|zes)$/.test(lower)) tries.push([lower.slice(0, -2), 's']);
    if (/s$/.test(lower) && !/ss$/.test(lower) && lower.length > 3) tries.push([lower.slice(0, -1), 's']);
    if (/ied$/.test(lower) && lower.length > 4) tries.push([lower.slice(0, -3) + 'y', 'ed']);
    if (/ed$/.test(lower) && lower.length > 4) { tries.push([lower.slice(0, -2), 'ed']); tries.push([lower.slice(0, -1), 'ed']); }
    if (/ing$/.test(lower) && lower.length > 5) { tries.push([lower.slice(0, -3), 'ing']); tries.push([lower.slice(0, -3) + 'e', 'ing']); }
    for (var i = 0; i < tries.length; i++) {
      if (Object.prototype.hasOwnProperty.call(table, tries[i][0])) return { base: tries[i][0], suffix: tries[i][1] };
    }
    return null;
  }
  // Copy the capitalisation pattern of `model` onto `word`.
  function matchCase(word, model) {
    if (model.length > 1 && model === model.toUpperCase()) return word.toUpperCase();
    if (model[0] === model[0].toUpperCase()) return word[0].toUpperCase() + word.slice(1);
    return word;
  }

  /* ---------- The tide itself ---------- */
  // Can this token be replaced at all? Names (capitalised, not sentence-initial) and unknown words cannot.
  // The (base, suffix) analysis is cached on the token until its word changes.
  function replaceable(tok, data) {
    if (!tok.isWord) return false;
    if (tok.anFor === tok.word) return tok.an !== null;
    var w = tok.word, an = null;
    var isName = w.length > 1 && w[0] === w[0].toUpperCase() && !tok.initial;
    if (!/[’'\-]/.test(w) && !isName && w !== 'I') an = analyse(w.toLowerCase(), data.table);
    tok.anFor = w;
    tok.an = an;
    return an !== null;
  }

  // After replacing tokens[idx], make a preceding "a"/"an" agree with the new word's first letter.
  // Articles never count as turned words (see drift), they just follow.
  function fixArticle(tokens, idx) {
    for (var p = idx - 1; p >= 0; p--) {
      if (!tokens[p].isWord) { if (/[^\s]/.test(tokens[p].text)) return; continue; }
      var low = tokens[p].word.toLowerCase();
      if (low !== 'a' && low !== 'an') return;
      var want = /^[aeiou]/i.test(tokens[idx].word) ? 'an' : 'a';
      if (low !== want) tokens[p].word = matchCase(want, tokens[p].word);
      return;
    }
  }
  function isArticle(tok) {
    var a = tok.word.toLowerCase(), b = tok.orig.toLowerCase();
    return (a === 'a' || a === 'an') && (b === 'a' || b === 'an');
  }

  // Apply the replacement for one minute to the token list in place. Returns the index of the
  // changed token, or -1 when nothing in the paragraph could be replaced.
  function stepMinute(tokens, seedInt, minuteIndex, data) {
    var rand = rng(mix(seedInt, minuteIndex));
    var n = tokens.length;
    if (!n) return -1;
    var start = Math.floor(rand() * n);
    var synRoll = rand();
    for (var k = 0; k < n; k++) {
      var idx = (start + k) % n;
      var tok = tokens[idx];
      if (!replaceable(tok, data)) continue;
      var lower = tok.word.toLowerCase();
      var an = tok.an;
      var syns = data.table[an.base];
      var m = syns.length;
      var offset = Math.floor(synRoll * m);
      for (var j = 0; j < m; j++) {
        var syn = syns[(offset + j) % m];
        if (syn === an.base) continue;
        var formed = inflect(syn, an.suffix, data.forms);
        if (!formed || formed === lower) continue;
        tok.word = matchCase(formed, tok.word);
        tok.turns = (tok.turns || 0) + 1;
        fixArticle(tokens, idx);
        return idx;
      }
    }
    return -1;
  }

  // Build the seed integer from the date key, the paragraph id (or custom text) and the user seed.
  function makeSeed(dateKey, paragraphKey, userSeed) {
    return hashString(String(dateKey) + '|' + String(paragraphKey) + '|' + String(userSeed || ''));
  }

  // Render the state at `minute` (0..1439): `minute` replacements applied in order from midnight.
  // `data` is { table: TIDE_THESAURUS, forms: TIDE_FORMS }. An optional `prev` result at an earlier minute
  // of the same text and seed is continued instead of starting over (cheap scrubbing forward).
  // Returns { tokens, minute, last, changed, words, turns, depth } where depth (0..1) is the tide height:
  // the mean over turnable words of 1 - d^turns, with d chosen per paragraph so that the day's 1439 turns
  // bring the mean close to 1 at 23:59; it keeps rising all day with diminishing returns.
  function drift(text, seedInt, minute, data, prev) {
    var count = Math.max(0, Math.min(1439, minute | 0));
    var tokens, last, from;
    if (prev && prev.minute <= count && prev.seed === seedInt && prev.text === text) {
      tokens = prev.tokens; last = prev.last; from = prev.minute;
    } else {
      tokens = tokenize(text); last = -1; from = 0;
    }
    for (var m = from; m < count; m++) {
      var i = stepMinute(tokens, seedInt, m, data);
      if (i >= 0) last = i;
    }
    var changed = 0, words = 0, turns = 0, turnable = 0, k, t;
    for (k = 0; k < tokens.length; k++) {
      t = tokens[k];
      if (!t.isWord) continue;
      words++;
      if (t.word !== t.orig && !isArticle(t)) changed++;
      if (t.turns) turns += t.turns;
      if (t.turns || replaceable(t, data)) turnable++;
    }
    var depth = 0;
    if (turnable) {
      var d = Math.pow(0.03, turnable / 1439);   // per-word decay: ~0.97 mean depth after a full day's turns
      for (k = 0; k < tokens.length; k++) { t = tokens[k]; if (t.isWord && t.turns) depth += 1 - Math.pow(d, t.turns); }
      depth /= turnable;
    }
    return { tokens: tokens, minute: count, seed: seedInt, text: text, last: last, changed: changed, words: words,
      turns: turns, turnable: turnable, depth: depth };
  }

  function toText(tokens) {
    var s = '';
    for (var k = 0; k < tokens.length; k++) s += tokens[k].isWord ? tokens[k].word : tokens[k].text;
    return s;
  }

  var API = { PARAGRAPHS: PARAGRAPHS, tokenize: tokenize, drift: drift, stepMinute: stepMinute, makeSeed: makeSeed, hashString: hashString, toText: toText, analyse: analyse, inflect: inflect, replaceable: replaceable };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  root.TIDE = API;
})(typeof window !== 'undefined' ? window : globalThis);
