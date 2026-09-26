// Zipf Karaoke: the pure logic (tokenising, ranking, fade mapping, timing curves).
// No DOM here so the same file runs under Node for tests. Everything hangs off
// window.Zipf in the browser (module.exports under Node).
(function (root) {
  'use strict';
  var Z = {};

  /* ---------- words and keys ---------- */

  // Lookup key for a word: lowercase, curly apostrophes straightened, then every
  // non-alphanumeric character dropped, so "Don't" -> "dont" (Norvig's list has
  // no apostrophes) and "water'd" -> "waterd".
  Z.key = function (s) {
    return String(s).toLowerCase()
      .replace(/[‘’ʼ]/g, "'")
      .replace(/[^a-z0-9]/g, '');
  };

  // Split a raw token into leading punctuation, core, trailing punctuation.
  var CORE_RE = /^([^A-Za-z0-9À-ɏ]*)([\s\S]*?)([^A-Za-z0-9À-ɏ]*)$/;

  // Tokenise a text into paragraphs of lines of tokens, keeping the words in
  // reading order. A token is { text, key, parts, core, pre, post, kind, i }
  // where kind is 'word' or 'punct' (a token with no letters, e.g. a lone dash)
  // and i is the running word index (punct tokens have i = -1).
  Z.tokenize = function (text) {
    var paras = [];
    var words = [];
    // em/en dashes and ellipses detached from words become their own tokens
    var t = String(text).replace(/\r\n?/g, '\n').replace(/([—–]|\.\.\.)/g, ' $1 ');
    var rawParas = t.split(/\n[ \t]*\n+/);
    for (var p = 0; p < rawParas.length; p++) {
      var lines = rawParas[p].split('\n');
      var linesOut = [];
      for (var l = 0; l < lines.length; l++) {
        var raw = lines[l].trim();
        if (!raw) continue;
        var toks = raw.split(/\s+/);
        var lineOut = [];
        for (var k = 0; k < toks.length; k++) {
          var m = CORE_RE.exec(toks[k]);
          var core = m ? m[2] : toks[k];
          var key = Z.key(core);
          var tok = { text: toks[k], pre: m ? m[1] : '', core: core, post: m ? m[3] : '',
                      key: key, kind: key ? 'word' : 'punct', i: -1, parts: [] };
          if (key) {
            // hyphenated compounds are ranked by their rarest part
            var parts = core.split(/[-‐‑]/).map(Z.key).filter(Boolean);
            tok.parts = parts.length > 1 ? parts : [key];
            tok.i = words.length;
            words.push(tok);
          }
          lineOut.push(tok);
        }
        if (lineOut.length) linesOut.push(lineOut);
      }
      if (linesOut.length) paras.push(linesOut);
    }
    return { paras: paras, words: words };
  };

  /* ---------- corpora ---------- */

  // A corpus is anything with { id, label, note, size, rank(key), u(key) }.
  // rank: 1 = most common, null = not in the list. u: log-rank on a 0..1 scale
  // where unknown words sit at 1 (their rank is taken as twice the list size).
  Z.makeCorpus = function (opts) {
    var ranks = opts.ranks; // Map key -> rank
    var size = opts.size || ranks.size;
    var cap = Math.log10(size * 2);
    var c = {
      id: opts.id, label: opts.label, note: opts.note || '', size: size, cap: size * 2,
      rank: function (key) { var r = ranks.get(key); return r === undefined ? null : r; },
      u: function (key) {
        var r = ranks.get(key);
        if (r === undefined) return 1;
        return Math.min(1, Math.log10(Math.max(1, r)) / cap);
      },
      // rank corresponding to a given u (for the slider readout)
      rankAtU: function (u) { return Math.round(Math.pow(10, u * cap)); }
    };
    return c;
  };

  // The bundled list: a space-separated string of words in rank order.
  Z.corpusFromWordString = function (id, label, note, str) {
    var arr = str.split(' ');
    var ranks = new Map();
    for (var i = 0; i < arr.length; i++) if (!ranks.has(arr[i])) ranks.set(arr[i], i + 1);
    return Z.makeCorpus({ id: id, label: label, note: note, ranks: ranks, size: arr.length });
  };

  // Count word keys in a blob of plain text (used for runtime corpora and the plot).
  Z.countWords = function (text) {
    var counts = new Map();
    var lower = String(text).toLowerCase().replace(/[‘’ʼ]/g, "'");
    var re = /[a-z0-9][a-z0-9']*/g, m;
    while ((m = re.exec(lower))) {
      var k = m[0].replace(/'/g, '');
      if (!k) continue;
      counts.set(k, (counts.get(k) || 0) + 1);
    }
    return counts;
  };

  // Build a corpus from raw text at runtime: rank by count desc, ties alphabetical.
  Z.corpusFromText = function (id, label, note, text) {
    var counts = Z.countWords(text);
    var entries = Array.from(counts.entries()).sort(function (a, b) {
      return b[1] - a[1] || (a[0] < b[0] ? -1 : 1);
    });
    var ranks = new Map();
    var tokens = 0;
    for (var i = 0; i < entries.length; i++) { ranks.set(entries[i][0], i + 1); tokens += entries[i][1]; }
    var c = Z.makeCorpus({ id: id, label: label, note: note, ranks: ranks, size: entries.length });
    c.tokens = tokens;
    return c;
  };

  // Strip YAML frontmatter and the usual markdown furniture, leaving prose.
  Z.stripMarkdown = function (md) {
    return String(md)
      .replace(/^﻿/, '')
      .replace(/\r\n?/g, '\n')
      .replace(/^---[\s\S]*?\n---[ \t]*(\n|$)/, '')       // frontmatter
      .replace(/```[\s\S]*?```/g, ' ')                      // fenced code
      .replace(/`[^`\n]*`/g, ' ')                           // inline code
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')                // images
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')              // links -> text
      .replace(/<[^>]+>/g, ' ')                             // html tags
      .replace(/https?:\/\/\S+/g, ' ')                      // bare urls
      .replace(/^\s{0,3}#{1,6}\s+/gm, '')                   // headings
      .replace(/^\s{0,3}>\s?/gm, '')                        // blockquotes
      .replace(/^\s*([-*+]|\d+\.)\s+/gm, '')                // list markers
      .replace(/[*_~]{1,3}/g, '')                           // emphasis
      .replace(/\$[^$\n]*\$/g, ' ');                        // inline maths
  };

  /* ---------- per-word u, whichever lens ---------- */

  // Frequency u for a token: rarest hyphen part wins.
  Z.wordU = function (corpus, tok) {
    var u = 0;
    for (var i = 0; i < tok.parts.length; i++) u = Math.max(u, corpus.u(tok.parts[i]));
    return u;
  };

  // Token-count u: 1 token -> 0.05, 5+ tokens -> 1.
  Z.tokenU = function (n) {
    return 0.05 + 0.95 * Math.min(1, Math.max(0, (n - 1) / 4));
  };

  // Fallback when the BPE tokenizer cannot be loaded: guess a token count from
  // length and familiarity. Common short words are single tokens; rare long
  // words split into roughly 3-4 character pieces.
  Z.estimateTokens = function (core, u) {
    var len = Z.key(core).length;
    if (len === 0) return 1;
    if (u < 0.55) return len > 11 ? 2 : 1;
    if (u < 0.85) return Math.max(1, Math.ceil(len / 6));
    return Math.max(1, Math.ceil(len / 3.5));
  };

  /* ---------- the fade mapping ---------- */

  function smoothstep(e0, e1, x) {
    var t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
  }
  Z.smoothstep = smoothstep;

  var W = 0.12; // soft threshold half-width on the u scale (about 0.6 decades of rank)

  // Position of the soft threshold on the u scale for a slider value s in [-1, 1].
  Z.threshold = function (s) {
    if (s > 0) return -W + s * (0.86 + W);
    if (s < 0) return (1 + W) + s * (1 + W - 0.24);
    return null;
  };

  // Opacity of a word with log-rank u at slider position s.
  //  s > 0: words commoner than the threshold fade (rare words remain)
  //  s < 0: words rarer than the threshold fade (the grammar skeleton remains)
  //  s = 0: everything visible
  Z.fade = function (u, s) {
    if (s === 0) return 1;
    var t = Z.threshold(s);
    if (s > 0) return smoothstep(t - W, t + W, u);
    return 1 - smoothstep(t - W, t + W, u);
  };

  /* ---------- playback curves ---------- */

  // How long a word lingers once sung, in beats: common words go within a beat,
  // the rarest hold for a hundred-odd beats (the rest of most songs).
  Z.halfLife = function (u) { return 0.35 * Math.pow(2, u * 8.5); };

  // Opacity of a sung word `age` beats after it was reached.
  Z.decay = function (age, u) {
    if (age < 0) return 0;
    var hold = 0.25;
    if (age < hold) return 1;
    var o = Math.pow(0.5, (age - hold) / Z.halfLife(u));
    return o < 0.02 ? 0 : o;
  };

  // Pitch: u mapped onto four octaves of C major pentatonic, low for common words.
  var PENTA = [0, 2, 4, 7, 9];
  Z.midi = function (u) {
    var i = Math.round(Math.min(1, Math.max(0, u)) * 20);
    return 48 + 12 * Math.floor(i / 5) + PENTA[i % 5];
  };
  Z.hz = function (midi) { return 440 * Math.pow(2, (midi - 69) / 12); };

  /* ---------- stats ---------- */

  // Weight of a word for the "meaning retained" share: a surprisal proxy
  // (log rank), with a small floor so function words are not weightless.
  Z.weight = function (u) { return u + 0.05; };

  Z.stats = function (us, opacities) {
    var visible = 0, kept = 0, total = 0;
    for (var i = 0; i < us.length; i++) {
      var w = Z.weight(us[i]);
      total += w; kept += w * opacities[i];
      if (opacities[i] >= 0.5) visible++;
    }
    return { visible: visible, total: us.length, share: total ? kept / total : 0 };
  };

  // Rank-frequency series of the current text for the Zipf plot.
  Z.zipfSeries = function (words) {
    var counts = new Map();
    for (var i = 0; i < words.length; i++) counts.set(words[i].key, (counts.get(words[i].key) || 0) + 1);
    var series = Array.from(counts.entries()).sort(function (a, b) {
      return b[1] - a[1] || (a[0] < b[0] ? -1 : 1);
    }).map(function (e, i) { return { key: e[0], count: e[1], rank: i + 1 }; });
    var textRank = new Map();
    series.forEach(function (d) { textRank.set(d.key, d.rank); });
    return { series: series, textRank: textRank };
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Z;
  else root.Zipf = Z;
})(typeof window !== 'undefined' ? window : this);
