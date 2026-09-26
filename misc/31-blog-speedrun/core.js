/* Blog Post Speedrun: pure logic shared by the page and by the Node tests.
   No DOM access in here. Exposed as window.SpeedrunCore in the browser and
   as module.exports in Node. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SpeedrunCore = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var WR_WPM = 900;        // the fake world record reads at this pace
  var HUMAN_WPM = 250;     // a plausible attentive human
  var WR_OVERHEAD_MS = 1500;

  var ADJECTIVES = ['Nimble', 'Sleepy', 'Frantic', 'Velvet', 'Turbo', 'Humble', 'Feral', 'Polite',
    'Caffeinated', 'Quantum', 'Glitchy', 'Sonic', 'Bashful', 'Cosmic', 'Wobbly', 'Laminar',
    'Recursive', 'Marginal', 'Stochastic', 'Diligent', 'Nocturnal', 'Brisk', 'Lucid', 'Rapid'];
  var ANIMALS = ['Capybara', 'Axolotl', 'Heron', 'Wombat', 'Ferret', 'Otter', 'Tapir', 'Gecko',
    'Quokka', 'Ibex', 'Pangolin', 'Marmot', 'Kestrel', 'Newt', 'Lemur', 'Puffin',
    'Okapi', 'Stoat', 'Civet', 'Lynx', 'Numbat', 'Skink', 'Egret', 'Vole'];

  /* FNV-1a string hash, 32 bit. */
  function hash32(str) {
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
  }

  /* mulberry32 seeded RNG: returns a function giving floats in [0,1). */
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

  /* Strip a leading YAML frontmatter block. Returns {meta, body}. */
  function stripFrontmatter(md) {
    var meta = {};
    var text = String(md || '').replace(/^﻿/, '');
    var m = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?/.exec(text);
    if (!m) return { meta: meta, body: text };
    m[1].split(/\r?\n/).forEach(function (line) {
      var kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
      if (!kv) return;
      var v = kv[2].trim();
      if (/^\[.*\]$/.test(v)) v = v.slice(1, -1).split(',').map(function (s) { return s.trim().replace(/^["']|["']$/g, ''); }).filter(Boolean);
      else v = v.replace(/^["']|["']$/g, '');
      meta[kv[1]] = v;
    });
    return { meta: meta, body: text.slice(m[0].length) };
  }

  /* Drop a leading heading that merely repeats the post title. */
  function dropTitleHeading(body, title) {
    if (!title) return body;
    var m = /^\s*#{1,6}\s+(.+?)\s*#*\s*\r?\n/.exec(body);
    if (m && norm(m[1]) === norm(title)) return body.slice(m[0].length);
    return body;
  }
  function norm(s) { return String(s).toLowerCase().replace(/[^a-z0-9぀-ヿ一-鿿]+/g, ''); }

  /* Count words in markdown-ish text: runs of letters, with CJK characters counted individually. */
  function wordCount(text) {
    var t = String(text || '')
      .replace(/```[\s\S]*?```/g, ' code ')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/<[^>]+>/g, ' ');
    var cjk = (t.match(/[぀-ヿ一-鿿]/g) || []).length;
    var latin = (t.replace(/[぀-ヿ一-鿿]/g, ' ').match(/[A-Za-z0-9À-ɏ'’]+/g) || []).length;
    return latin + cjk;
  }

  /* The deterministic fake world record: words at 900 wpm plus 1.5 s, with +-8 % seeded jitter. */
  function fakeWR(words, slug) {
    var r = rng(hash32('wr:' + slug));
    var jitter = 0.92 + r() * 0.16;
    var ms = (words / WR_WPM) * 60000 * jitter + WR_OVERHEAD_MS;
    return Math.round(ms);
  }

  /* A clearly fake runner name, deterministic per slug. */
  function runnerName(slug) {
    var r = rng(hash32('runner:' + slug));
    return ADJECTIVES[Math.floor(r() * ADJECTIVES.length)] + ' ' + ANIMALS[Math.floor(r() * ANIMALS.length)];
  }

  function humanTime(words) { return Math.round((words / HUMAN_WPM) * 60000); }

  /* mm:ss.cc, with hours folded into minutes. Negative values get a sign. */
  function fmtTime(ms, opts) {
    var sign = ms < 0 ? '-' : (opts && opts.signed ? '+' : '');
    ms = Math.abs(Math.round(ms));
    var cs = Math.floor((ms % 1000) / 10);
    var s = Math.floor(ms / 1000) % 60;
    var m = Math.floor(ms / 60000);
    var pad = function (n) { return (n < 10 ? '0' : '') + n; };
    return sign + pad(m) + ':' + pad(s) + '.' + pad(cs);
  }
  /* Short delta form like -1.20 or +12.3 */
  function fmtDelta(ms) {
    var sign = ms < 0 ? '-' : '+';
    var a = Math.abs(ms) / 1000;
    return sign + (a >= 100 ? a.toFixed(0) : a >= 10 ? a.toFixed(1) : a.toFixed(2));
  }

  /* Plan the splits of a run.
     headings: [{text, top, words, ref}] positions relative to the article top (px), words = words up to that
     heading, ref = anything the caller wants back (the page passes the DOM element).
     height: article height in px; totalWords: words in the whole article.
     Returns [{name, top|null, endOfArticle, wordsAt, ref?|frac?}] where the last split's boundary is the end
     marker; heading splits carry the heading's ref, percentage splits carry frac (their share of the height).
     Headings within the first `minTop` px are ignored (they would fire at once). */
  function planSplits(headings, height, totalWords, minTop) {
    minTop = minTop == null ? 150 : minTop;
    var usable = (headings || []).filter(function (h) { return h.top > minTop && h.top < height - 40; });
    var out = [];
    if (usable.length >= 3) {
      usable.forEach(function (h, i) {
        out.push({ name: shortName(h.text, i), top: h.top, endOfArticle: false, wordsAt: h.words, ref: h.ref });
      });
    } else {
      [0.25, 0.5, 0.75].forEach(function (p) {
        out.push({ name: Math.round(p * 100) + '%', top: p * height, endOfArticle: false, wordsAt: Math.round(p * totalWords), frac: p });
      });
    }
    out.push({ name: 'End', top: null, endOfArticle: true, wordsAt: totalWords });
    return out;
  }
  function shortName(text, i) {
    var t = String(text || '').replace(/\s+/g, ' ').trim();
    if (!t) return 'Section ' + (i + 1);
    return t.length > 30 ? t.slice(0, 29).replace(/\s+\S*$/, '') + '…' : t;
  }

  /* Reference split times: a run of `totalMs` distributed proportionally to words. */
  function referenceSplits(plan, totalMs) {
    var total = plan.length ? plan[plan.length - 1].wordsAt || 1 : 1;
    return plan.map(function (s, i) {
      if (i === plan.length - 1) return totalMs;
      return Math.round(totalMs * Math.min(1, Math.max(0, s.wordsAt / total)));
    });
  }

  /* Advance the split state. `viewTop` is the article-relative y of the viewport top and `elapsed` the
     current run time in ms. Fires in order and never skips ahead past a boundary that has not been passed.
     The final (end-of-article) split is fired by the finish logic, not here. Returns `times` (mutated). */
  function advanceSplits(plan, times, viewTop, elapsed, threshold) {
    threshold = threshold == null ? 80 : threshold;
    for (var i = times.length; i < plan.length; i++) {
      var s = plan[i];
      if (s.endOfArticle) break;
      if (s.top - viewTop <= threshold) times.push(elapsed);
      else break;
    }
    return times;
  }

  /* Scroll-speed meter for Glitchless: keeps ~300 ms of samples and returns px/s over that window. */
  function speedMeter(windowMs) {
    windowMs = windowMs || 300;
    var samples = [];
    return {
      push: function (t, y) {
        samples.push({ t: t, y: y });
        while (samples.length > 2 && t - samples[0].t > windowMs) samples.shift();
        var span = t - samples[0].t;
        if (span < 60 || samples.length < 2) return 0;
        var dist = 0;
        for (var i = 1; i < samples.length; i++) dist += Math.abs(samples[i].y - samples[i - 1].y);
        return dist / (span / 1000);
      },
      reset: function () { samples = []; }
    };
  }

  /* Resolve a link or image URL found in a post against the site root as seen from misc/<toy>/. */
  function fixUrl(url, base) {
    base = base == null ? '../../' : base;
    if (!url) return url;
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(url)) return url;   // absolute
    if (url.charAt(0) === '#') return /^#\//.test(url) ? base + url : url; // #/post/x is a site route
    if (url.charAt(0) === '/') return url;                         // already site-root absolute
    return base + url.replace(/^\.\//, '');
  }

  /* Minimal markdown renderer used when the CDN copy of marked is unavailable.
     Headings, paragraphs, emphasis, links, images, lists (nested by indent), blockquotes, code, hr. */
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function inline(s) {
    var codes = [];
    s = s.replace(/`([^`]+)`/g, function (_, c) { codes.push('<code>' + esc(c) + '</code>'); return '\u0000' + (codes.length - 1) + '\u0000'; });
    s = esc(s);
    s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, '<img alt="$1" src="$2">');
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, '<a href="$2">$1</a>');
    s = s.replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, '<strong>$2</strong>');
    s = s.replace(/(^|[^\w*])\*(?=\S)([^*]*?\S)\*(?!\w)/g, '$1<em>$2</em>');
    s = s.replace(/(^|[^\w_])_(?=\S)([^_]*?\S)_(?!\w)/g, '$1<em>$2</em>');
    s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');
    s = s.replace(/\u0000(\d+)\u0000/g, function (_, i) { return codes[+i]; });
    return s;
  }
  function renderMarkdown(md) {
    var lines = String(md).replace(/\r\n?/g, '\n').split('\n');
    var out = [], para = [], listStack = [], quote = [], i, line, m;
    function flushPara() { if (para.length) { out.push('<p>' + inline(para.join(' ')) + '</p>'); para = []; } }
    function closeLists(toDepth) { while (listStack.length > toDepth) out.push('</li></' + listStack.pop() + '>'); }
    function flushQuote() { if (quote.length) { out.push('<blockquote>' + renderMarkdown(quote.join('\n')) + '</blockquote>'); quote = []; } }
    function flushAll() { flushPara(); closeLists(0); flushQuote(); }
    for (i = 0; i < lines.length; i++) {
      line = lines[i];
      if (/^```/.test(line)) {                       // fenced code
        flushAll();
        var buf = [];
        for (i++; i < lines.length && !/^```/.test(lines[i]); i++) buf.push(lines[i]);
        out.push('<pre><code>' + esc(buf.join('\n')) + '</code></pre>');
        continue;
      }
      if (/^\s*>/.test(line)) { flushPara(); closeLists(0); quote.push(line.replace(/^\s*>\s?/, '')); continue; }
      flushQuote();
      if (!line.trim()) { flushPara(); closeLists(0); continue; }
      if ((m = /^(#{1,6})\s+(.*?)\s*#*$/.exec(line))) { flushAll(); out.push('<h' + m[1].length + '>' + inline(m[2]) + '</h' + m[1].length + '>'); continue; }
      if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { flushAll(); out.push('<hr>'); continue; }
      if ((m = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line))) {
        flushPara();
        var depth = Math.floor(m[1].replace(/\t/g, '    ').length / 2) + 1;
        var tag = /^\d/.test(m[2]) ? 'ol' : 'ul';
        if (depth > listStack.length) {
          while (listStack.length < depth) { out.push('<' + tag + '><li>'); listStack.push(tag); }
          out[out.length - 1] += inline(m[3]);
        } else { closeLists(depth); out.push('</li><li>' + inline(m[3])); }
        continue;
      }
      if (listStack.length) { out.push(' ' + inline(line.trim())); continue; }  // lazy continuation
      if (/^\s*<\/?[a-zA-Z]/.test(line)) { flushPara(); out.push(line); continue; } // raw HTML passthrough
      para.push(line.trim());
    }
    flushAll();
    return out.join('\n');
  }

  return {
    WR_WPM: WR_WPM, HUMAN_WPM: HUMAN_WPM, WR_OVERHEAD_MS: WR_OVERHEAD_MS,
    hash32: hash32, rng: rng, stripFrontmatter: stripFrontmatter, dropTitleHeading: dropTitleHeading,
    wordCount: wordCount, fakeWR: fakeWR, runnerName: runnerName, humanTime: humanTime,
    fmtTime: fmtTime, fmtDelta: fmtDelta, planSplits: planSplits, referenceSplits: referenceSplits,
    advanceSplits: advanceSplits, speedMeter: speedMeter, fixUrl: fixUrl, renderMarkdown: renderMarkdown
  };
}));
