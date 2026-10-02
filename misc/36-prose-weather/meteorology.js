// Prose Weather: the meteorology. Pure functions, no DOM, runs under Node for sanity checks.
// Every number produced here keeps a pointer back to the sentences that caused it.
(function (root) {
  'use strict';

  // ---------- closed-class word lists ----------
  const PRONOUNS = 'i me my mine myself you your yours yourself he him his himself she her hers herself it its itself we us our ours ourselves they them their theirs themselves this that these those who whom whose what which one ones someone something anyone anything everyone everything nobody nothing none there here'.split(' ');
  const ARTICLES = 'the a an some any every each either neither no another such both all half many much few several most'.split(' ');
  const CONJUNCTIONS = 'and but or nor so yet for because although though if unless until while whereas whether since once as than lest'.split(' ');
  const PREPOSITIONS = 'in on at by with from to of into onto upon about against across along among around before behind below beneath beside between beyond despite during except inside like near off out outside over past through throughout toward towards under underneath unlike via within without after'.split(' ');
  const ADVERBS = 'however then now also still often never always sometimes perhaps maybe first second third finally instead otherwise meanwhile again thus therefore hence indeed actually really just only even already soon later today yesterday tomorrow usually mostly probably certainly generally recently rarely seldom eventually suddenly obviously clearly apparently basically essentially simply mostly nowadays elsewhere somewhere anywhere everywhere nevertheless nonetheless moreover furthermore consequently similarly likewise conversely alternatively rather quite very too almost nearly roughly exactly literally honestly frankly luckily unfortunately fortunately interestingly ironically naturally presumably surely anyway besides afterwards'.split(' ');
  const AUX = 'am is are was were be been being have has had having do does did doing will would shall should can could may might must ought need dare'.split(' ');
  const OTHER_FUNCTION = 'not no yes nt n\'t s than that whether where when why how more less own same other if else etc'.split(' ');

  const FUNCTION_WORDS = new Set([].concat(PRONOUNS, ARTICLES, CONJUNCTIONS, PREPOSITIONS, ADVERBS, AUX, OTHER_FUNCTION));
  const OPENER = {};
  PRONOUNS.forEach(w => OPENER[w] = 'pronoun');
  ARTICLES.forEach(w => OPENER[w] = 'article');
  CONJUNCTIONS.forEach(w => OPENER[w] = 'conjunction');
  PREPOSITIONS.forEach(w => OPENER[w] = 'preposition');
  ADVERBS.forEach(w => OPENER[w] = 'adverb');
  // overlaps: "for" "as" "since" are more often prepositions when opening; "there/here" count as adverbs
  OPENER.for = 'preposition'; OPENER.as = 'preposition'; OPENER.since = 'preposition'; OPENER.after = 'conjunction';
  OPENER.there = 'adverb'; OPENER.here = 'adverb';
  const OPENER_KINDS = ['pronoun', 'article', 'conjunction', 'preposition', 'adverb', 'other'];

  const EMPH = ''; // marker prefix for words that were italic/bold in the source markdown
  const ABBREV = /\b(e\.g|i\.e|etc|vs|dr|mr|mrs|ms|prof|st|no|cf|al|fig|ch|pp|vol|jr|sr|inc|ltd|u\.s|a\.m|p\.m)\.$/i;

  // ---------- lexicon lookup with inflection folding ----------
  function lookup(lex, w) {
    if (lex[w] !== undefined) return lex[w];
    const c = [];
    if (w.endsWith('ies')) c.push(w.slice(0, -3) + 'y');
    if (w.endsWith('es')) c.push(w.slice(0, -2));
    if (w.endsWith('s')) c.push(w.slice(0, -1));
    if (w.endsWith('ied')) c.push(w.slice(0, -3) + 'y');
    if (w.endsWith('ed')) { c.push(w.slice(0, -2)); c.push(w.slice(0, -1)); c.push(w.slice(0, -3)); }
    if (w.endsWith('ing')) { c.push(w.slice(0, -3)); c.push(w.slice(0, -3) + 'e'); c.push(w.slice(0, -4)); }
    for (const b of c) if (b.length >= 3 && lex[b] !== undefined) return lex[b];
    return undefined;
  }

  // ---------- syllables (heuristic) ----------
  function syllables(word) {
    let w = word.toLowerCase().replace(/[^a-z]/g, '');
    if (!w) return 1;
    if (w.length <= 3) return 1;
    if (!/[^aeiouy]le$/.test(w)) w = w.replace(/e$/, '');
    w = w.replace(/([^tdaeiouy])ed$/, '$1').replace(/([^sxzaeiouy]|[^cs]h)es$/, '$1').replace(/^y/, '');
    const m = w.match(/[aeiouy]+/g);
    return Math.max(1, m ? m.length : 1);
  }

  // ---------- markdown -> prose paragraphs ----------
  // Returns [{text (with EMPH markers), kind:'para'|'item'}] ; headings, code, images, tables are dropped.
  function stripMarkdown(src) {
    let s = String(src || '').replace(/\r\n?/g, '\n');
    s = s.replace(/^﻿/, '');
    if (/^---\s*\n/.test(s)) { const end = s.indexOf('\n---', 3); if (end !== -1) s = s.slice(s.indexOf('\n', end + 1) + 1); }
    s = s.replace(/<!--[\s\S]*?-->/g, '');
    s = s.replace(/```[\s\S]*?```/g, '\n\n');
    s = s.replace(/~~~[\s\S]*?~~~/g, '\n\n');
    s = s.replace(/<\/?[a-zA-Z][^>\n]*>/g, '');
    const lines = s.split('\n');
    const paras = [];
    let buf = [];
    const flush = () => { if (buf.length) { paras.push({ text: buf.join(' '), kind: 'para' }); buf = []; } };
    for (let raw of lines) {
      const line = raw.replace(/\s+$/, '');
      if (!line.trim()) { flush(); continue; }
      if (/^\s{4,}\S/.test(raw) && !/^\s*([-*+]|\d+[.)])\s/.test(raw) && buf.length === 0) continue; // indented code
      if (/^#{1,6}\s/.test(line)) { flush(); continue; }
      if (/^\s*!\[/.test(line)) { continue; }
      if (/^\s*\|/.test(line) || /^\s*[-=*_]{3,}\s*$/.test(line)) { flush(); continue; }
      const item = line.match(/^\s*(?:[-*+]|\d+[.)])\s+(.*)$/);
      if (item) { flush(); paras.push({ text: item[1], kind: 'item' }); continue; }
      if (/^\s{2,}\S/.test(raw) && paras.length && paras[paras.length - 1].kind === 'item' && buf.length === 0) { paras[paras.length - 1].text += ' ' + line.trim(); continue; }
      buf.push(line.replace(/^\s*>\s?/, '').trim());
    }
    flush();
    return paras.map(p => ({ kind: p.kind, text: inlineClean(p.text) })).filter(p => /[A-Za-z]/.test(p.text));
  }

  function markEmph(inner) { return inner.replace(/[A-Za-z0-9][A-Za-z0-9'’-]*/g, m => EMPH + m); }
  function inlineClean(t) {
    t = t.replace(/!\[[^\]]*\]\([^)]*\)/g, '');
    t = t.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
    t = t.replace(/\[([^\]]*)\]\[[^\]]*\]/g, '$1');
    t = t.replace(/<https?:[^>]*>/g, '');
    t = t.replace(/`([^`]*)`/g, '$1');
    t = t.replace(/\*\*([^*]+)\*\*/g, (m, a) => markEmph(a));
    t = t.replace(/__([^_]+)__/g, (m, a) => markEmph(a));
    t = t.replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,;:!?]|$)/g, (m, pre, a) => pre + markEmph(a));
    t = t.replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,;:!?]|$)/g, (m, pre, a) => pre + markEmph(a));
    t = t.replace(/\\([*_`#])/g, '$1');
    return t.replace(/\s+/g, ' ').trim();
  }

  // ---------- sentences ----------
  function splitSentences(text) {
    const out = [];
    let start = 0;
    const re = /[.!?…]+["'”’)\]]*(?=\s|$)/g;
    let m;
    while ((m = re.exec(text))) {
      const end = m.index + m[0].length;
      const chunk = text.slice(start, end);
      if (ABBREV.test(chunk.trim()) && /^[.]/.test(m[0])) continue;
      const next = text.slice(end).match(/^\s*(\S)/);
      if (next && /^[a-z]/.test(next[1]) && /^[.]/.test(m[0]) && !/\.\.\.$/.test(chunk)) continue; // "e.g. this" / mid-sentence period
      if (chunk.trim()) out.push(chunk.trim());
      start = end;
    }
    const rest = text.slice(start).trim();
    if (rest) out.push(rest);
    return out;
  }

  const WORD_RE = /?[A-Za-z][A-Za-z'’-]*[A-Za-z]|?[A-Za-z]/g;

  function analyzeSentence(raw, lex) {
    const display = raw.replace(//g, '');
    const toks = raw.match(WORD_RE) || [];
    const words = [];
    let score = 0, nScored = 0, caps = 0, emph = 0, syl = 0, fn = 0;
    const scored = [], hot = [];
    for (const t of toks) {
      const isEmph = t.charCodeAt(0) === 0xE000;
      const w = isEmph ? t.slice(1) : t;
      const lw = w.toLowerCase().replace(/’/g, "'");
      words.push(lw);
      if (isEmph) { emph++; hot.push(lw); }
      if (w.length >= 2 && /^[A-Z][A-Z'’-]*[A-Z]$/.test(w) && !/^(I|AI|US|UK|TV|OK)$/.test(w)) { caps++; hot.push(lw); }
      syl += syllables(lw);
      if (FUNCTION_WORDS.has(lw) || /^(\w+)'(s|re|ve|ll|d|m)$/.test(lw) && FUNCTION_WORDS.has(lw.split("'")[0])) fn++;
      const sc = lookup(lex, lw);
      if (sc !== undefined) { score += sc; nScored++; scored.push({ w: lw, s: sc }); }
    }
    const n = words.length;
    const commas = (display.match(/,/g) || []).length;
    const semis = (display.match(/;/g) || []).length;
    const dashes = (display.match(/—|--|–/g) || []).length;
    const bangs = (display.match(/!/g) || []).length;
    const qs = (display.match(/\?/g) || []).length;
    const first = words[0] || '';
    const opener = n ? (OPENER[first] || (first === 'it' ? 'pronoun' : 'other')) : 'other';
    return { text: display, words, n, score, nScored, scored, hot, caps, emph, syl, fn, commas, semis, dashes, bangs, qs, opener };
  }

  // ---------- aggregate a set of sentences into a weather report ----------
  function tempF(sum, nScored) { return 60 + 10 * (sum / (nScored + 3)); }

  function mattr(words, win) {
    if (words.length === 0) return 0;
    if (words.length <= win) return new Set(words).size / words.length;
    const counts = new Map(); let types = 0, total = 0;
    for (let i = 0; i < words.length; i++) {
      const w = words[i]; const c = counts.get(w) || 0; if (c === 0) types++; counts.set(w, c + 1);
      if (i >= win) { const o = words[i - win]; const oc = counts.get(o) - 1; counts.set(o, oc); if (oc === 0) types--; }
      if (i >= win - 1) total += types / win;
    }
    return total / (words.length - win + 1);
  }

  function report(sents) {
    const n = sents.reduce((a, s) => a + s.n, 0);
    const words = [].concat(...sents.map(s => s.words));
    const sum = sents.reduce((a, s) => a + s.score, 0);
    const nScored = sents.reduce((a, s) => a + s.nScored, 0);
    const temp = tempF(sum, nScored);
    const lens = sents.map(s => s.n).filter(x => x > 0);
    const meanLen = lens.length ? lens.reduce((a, b) => a + b, 0) / lens.length : 0;
    const sd = lens.length ? Math.sqrt(lens.reduce((a, b) => a + (b - meanLen) ** 2, 0) / lens.length) : 0;
    const per100 = k => n ? 100 * k / n : 0;
    const commas = sents.reduce((a, s) => a + s.commas, 0), semis = sents.reduce((a, s) => a + s.semis, 0);
    const dashes = sents.reduce((a, s) => a + s.dashes, 0), bangs = sents.reduce((a, s) => a + s.bangs, 0), qs = sents.reduce((a, s) => a + s.qs, 0);
    const fn = sents.reduce((a, s) => a + s.fn, 0);
    const syl = sents.reduce((a, s) => a + s.syl, 0);
    const caps = sents.reduce((a, s) => a + s.caps, 0), emph = sents.reduce((a, s) => a + s.emph, 0);
    const ttr = n ? mattr(words, 100) : 0.72;
    const rose = {}; OPENER_KINDS.forEach(k => rose[k] = 0); sents.forEach(s => { if (s.n) rose[s.opener]++; });
    const meanSyl = n ? syl / n : 1;
    const r = {
      n, sentences: sents.length, sum, nScored,
      tempF: temp, tempC: (temp - 32) * 5 / 9,
      wind: meanLen, gust: meanLen + 2 * sd, sd,
      precip: { commas, semis, dashes, bangs, qs, commasR: per100(commas), semisR: per100(semis), dashesR: per100(dashes), bangsR: per100(bangs), qsR: per100(qs) },
      precipIn: per100(commas + semis + dashes + bangs + qs) / 10,
      humidity: n ? 100 * fn / n : 0,
      ttr, pressure: 1013 + (ttr - 0.72) * 500,
      meanSyl, visibility: Math.max(0.25, Math.min(10, 10 * (2.2 - meanSyl))),
      uv: n ? 100 * (caps + emph) / n : 0, caps, emph,
      rose
    };
    r.condition = condition(r);
    return r;
  }

  // Which icon. Order matters: the most violent thing wins.
  function condition(r) {
    if (r.n === 0) return 'clear';
    const p = r.precip;
    if (p.bangsR >= 0.8 || r.precip.bangs >= 4 && p.bangsR >= 0.4) return 'thunder';
    const wet = p.commasR + 2 * p.semisR + 2 * p.dashesR;
    if (r.tempF <= 32 && wet >= 4) return 'snow';
    if (p.qsR >= 1.6 || r.visibility < 3) return 'fog';
    if (wet >= 9) return 'rain';
    if (wet >= 6.5 || r.humidity >= 52) return 'cloudy';
    if (r.humidity >= 44 || r.tempF < 60) return 'partly';
    return 'clear';
  }

  const COND_LABEL = { clear: 'Sunny', partly: 'Partly cloudy', cloudy: 'Overcast', rain: 'Rain', snow: 'Snow', thunder: 'Thunderstorms', fog: 'Fog' };

  // ---------- the full analysis ----------
  function analyze(src, lex, opts) {
    opts = opts || {};
    const paras = opts.plain ? plainParagraphs(src) : stripMarkdown(src);
    const sents = [];
    const paraInfo = [];
    paras.forEach((p, pi) => {
      const ss = splitSentences(p.text).map(t => analyzeSentence(t, lex)).filter(s => s.n > 0);
      ss.forEach((s, si) => { s.para = pi; s.idx = sents.length; s.inPara = si; sents.push(s); });
      paraInfo.push({ i: pi, kind: p.kind, sents: ss, text: p.text.replace(//g, '') });
    });
    const total = report(sents);
    // 7 days, each a seventh of the words in reading order (sentences never split)
    const N = total.n; const days = [];
    let cursor = 0; let acc = 0;
    for (let d = 0; d < 7; d++) {
      const target = (d + 1) * N / 7; const ds = [];
      while (cursor < sents.length && (acc < target || ds.length === 0) && (d === 6 || acc + sents[cursor].n / 2 <= target || ds.length === 0)) { ds.push(sents[cursor]); acc += sents[cursor].n; cursor++; }
      if (d === 6) while (cursor < sents.length) { ds.push(sents[cursor]); acc += sents[cursor].n; cursor++; }
      const rep = report(ds);
      let hi = -Infinity, lo = Infinity, hiS = null, loS = null;
      ds.forEach(s => { const t = tempF(s.score, s.nScored); if (t > hi) { hi = t; hiS = s; } if (t < lo) { lo = t; loS = s; } });
      days.push({ d, sents: ds, rep, hi: ds.length ? hi : rep.tempF, lo: ds.length ? lo : rep.tempF, hiS, loS, paraFrom: ds.length ? ds[0].para : 0, paraTo: ds.length ? ds[ds.length - 1].para : 0 });
    }
    // paragraph valence, smoothed (moving average over 3) for the synoptic chart
    paraInfo.forEach(p => { p.rep = report(p.sents); p.n = p.rep.n; });
    const pv = paraInfo.map(p => p.rep.tempF);
    paraInfo.forEach((p, i) => { const a = pv[Math.max(0, i - 1)], b = pv[i], c = pv[Math.min(pv.length - 1, i + 1)]; p.smooth = (a + b + c) / 3; });
    const advisories = findAdvisories(total, sents, paraInfo);
    return { paras: paraInfo, sents, total, days, advisories, drama: drama(total, advisories) };
  }

  function plainParagraphs(src) {
    return String(src || '').replace(/\r\n?/g, '\n').split(/\n\s*\n/).map(t => ({ kind: 'para', text: inlineClean(t) })).filter(p => /[A-Za-z]/.test(p.text));
  }

  function drama(t, adv) {
    return Math.abs(t.tempF - 60) / 5 + t.precipIn * 4 + adv.filter(a => a.level !== 'info').length * 2 + (t.condition === 'thunder' ? 6 : 0) + (t.condition === 'fog' ? 3 : 0) + Math.min(5, t.uv);
  }

  // ---------- advisories (every one points at real sentences) ----------
  function findAdvisories(t, sents, paras) {
    const out = [];
    if (!t.n) return [{ level: 'info', title: 'No prose detected', text: 'the station is reading static', sents: [] }];
    const longest = sents.slice().sort((a, b) => b.n - a.n);
    if (longest.length && longest[0].n >= 45) {
      const s = longest[0];
      out.push({ level: 'warning', title: 'Run-on warning', text: `a ${s.n}-word sentence in paragraph ${s.para + 1}`, sents: longest.filter(x => x.n >= 45).slice(0, 5) });
    } else if (longest.length && longest[0].n >= 30) {
      const s = longest[0];
      out.push({ level: 'watch', title: 'Long-sentence advisory', text: `a ${s.n}-word sentence in paragraph ${s.para + 1}`, sents: [s] });
    }
    if (t.precip.semis >= 3) out.push({ level: 'watch', title: 'Semicolon watch in effect', text: `${t.precip.semis} semicolons sighted (${t.precip.semisR.toFixed(1)} per 100 words)`, sents: sents.filter(s => s.semis).slice(0, 8) });
    if (t.precip.dashesR >= 1.2 && t.precip.dashes >= 3) out.push({ level: 'warning', title: 'Hail warning', text: `em-dashes falling at ${t.precip.dashesR.toFixed(1)} per 100 words`, sents: sents.filter(s => s.dashes).sort((a, b) => b.dashes - a.dashes).slice(0, 6) });
    if (t.precip.bangs >= 2) out.push({ level: t.precip.bangsR >= 0.8 ? 'warning' : 'watch', title: t.precip.bangsR >= 0.8 ? 'Severe thunderstorm warning' : 'Thunderstorm watch', text: `${t.precip.bangs} exclamation marks detected`, sents: sents.filter(s => s.bangs).slice(0, 6) });
    if (t.precip.qs >= 3) out.push({ level: t.precip.qsR >= 1.6 ? 'warning' : 'watch', title: t.precip.qsR >= 1.6 ? 'Dense fog advisory' : 'Patchy fog', text: `${t.precip.qs} questions, ${t.precip.qsR.toFixed(1)} per 100 words`, sents: sents.filter(s => s.qs).slice(0, 8) });
    if (t.visibility < 3.5) out.push({ level: 'watch', title: 'Low visibility', text: `mean word length ${t.meanSyl.toFixed(2)} syllables; visibility ${t.visibility.toFixed(1)} mi`, sents: sents.slice().sort((a, b) => (b.syl / b.n) - (a.syl / a.n)).filter(s => s.n >= 6).slice(0, 5) });
    const warmest = sents.slice().sort((a, b) => tempF(b.score, b.nScored) - tempF(a.score, a.nScored));
    if (t.tempF >= 72) out.push({ level: 'watch', title: 'Heat advisory', text: `${Math.round(t.tempF)}°F of good feeling`, sents: warmest.slice(0, 5) });
    if (t.tempF <= 45) out.push({ level: t.tempF <= 32 ? 'warning' : 'watch', title: t.tempF <= 32 ? 'Hard freeze warning' : 'Frost advisory', text: `${Math.round(t.tempF)}°F; bring the adjectives inside`, sents: warmest.slice().reverse().slice(0, 5) });
    if (t.caps >= 3) out.push({ level: 'watch', title: 'UV alert', text: `${t.caps} words in ALL CAPS`, sents: sents.filter(s => s.caps).slice(0, 6) });
    if (t.uv >= 6) out.push({ level: 'watch', title: 'High UV index', text: `${t.uv.toFixed(1)} emphasised words per 100`, sents: sents.filter(s => s.emph + s.caps > 0).sort((a, b) => (b.emph + b.caps) - (a.emph + a.caps)).slice(0, 6) });
    const flood = paras.map(p => ({ p, c: p.sents.reduce((a, s) => a + s.commas, 0) })).sort((a, b) => b.c - a.c)[0];
    if (flood && flood.c >= 14) out.push({ level: 'warning', title: 'Flash flood warning', text: `${flood.c} commas in paragraph ${flood.p.i + 1}`, sents: flood.p.sents });
    if (t.sd >= 14 && t.sentences >= 6) out.push({ level: 'watch', title: 'Wind advisory', text: `sentence length swings ±${t.sd.toFixed(0)} words; gusts to ${Math.round(t.gust)}`, sents: [longest[0], longest[longest.length - 1]] });
    const frag = sents.filter(s => s.n <= 3);
    if (frag.length >= 4 && frag.length / sents.length >= 0.12) out.push({ level: 'watch', title: 'Small craft advisory', text: `${frag.length} sentence fragments of three words or fewer`, sents: frag.slice(0, 8) });
    // drought: a long dry stretch with no punctuation but full stops
    let dry = 0, dryStart = 0, bestDry = 0, bestStart = 0, bestEnd = 0;
    sents.forEach((s, i) => { if (s.commas + s.semis + s.dashes + s.bangs + s.qs === 0) { if (dry === 0) dryStart = i; dry += s.n; if (dry > bestDry) { bestDry = dry; bestStart = dryStart; bestEnd = i; } } else dry = 0; });
    if (bestDry >= 80) out.push({ level: 'watch', title: 'Drought conditions', text: `${bestDry} words without a single comma`, sents: sents.slice(bestStart, bestEnd + 1).slice(0, 8) });
    if (t.humidity >= 55) out.push({ level: 'watch', title: 'Humidity advisory', text: `${t.humidity.toFixed(0)}% function words; the air is thick with "the" and "of"`, sents: sents.filter(s => s.n >= 8).sort((a, b) => b.fn / b.n - a.fn / a.n).slice(0, 5) });
    if (t.pressure >= 1040) out.push({ level: 'info', title: 'High pressure system', text: `moving-average type/token ratio ${t.ttr.toFixed(2)}: hardly a word used twice`, sents: sents.slice().sort((a, b) => (new Set(b.words).size / b.n) - (new Set(a.words).size / a.n)).filter(s => s.n >= 8).slice(0, 5) });
    if (t.pressure <= 990) out.push({ level: 'watch', title: 'Low pressure system', text: `moving-average type/token ratio ${t.ttr.toFixed(2)}: the same words keep coming round`, sents: sents.slice().sort((a, b) => (new Set(a.words).size / a.n) - (new Set(b.words).size / b.n)).filter(s => s.n >= 8).slice(0, 5) });
    if (!out.length) out.push({ level: 'info', title: 'No advisories', text: 'mild prose expected through the weekend', sents: [] });
    return out;
  }

  // ---------- synoptic chart geometry ----------
  // Lay paragraphs on a snake grid; sample a Gaussian-weighted field of smoothed valence; marching squares.
  function synoptic(analysis, W, H) {
    const P = analysis.paras; const n = P.length;
    if (!n) return { stations: [], contours: [], fronts: [], cols: 1, rows: 1 };
    const cols = Math.max(1, Math.min(8, Math.ceil(Math.sqrt(n * (W / H) * 0.8))));
    const rows = Math.ceil(n / cols);
    const padX = W / (cols + 1) * 0.5, padY = H / (rows + 1) * 0.5;
    const stations = P.map((p, i) => {
      const r = Math.floor(i / cols); let c = i % cols; if (r % 2 === 1) c = cols - 1 - c;
      const x = padX + (c + 0.5) * (W - 2 * padX) / cols; const y = padY + (r + 0.5) * (H - 2 * padY) / rows;
      return { i, x, y, p, v: p.smooth, t: p.rep.tempF };
    });
    const gx = 48, gy = Math.max(12, Math.round(48 * H / W));
    const sig2 = 2 * Math.pow(Math.min(W / cols, H / rows) * 0.9, 2);
    const field = new Float64Array((gx + 1) * (gy + 1));
    for (let j = 0; j <= gy; j++) for (let i = 0; i <= gx; i++) {
      const x = i / gx * W, y = j / gy * H; let num = 0, den = 0;
      for (const s of stations) { const w = Math.exp(-((x - s.x) ** 2 + (y - s.y) ** 2) / sig2) + 1e-9; num += w * s.v; den += w; }
      field[j * (gx + 1) + i] = num / den;
    }
    let mn = Infinity, mx = -Infinity; field.forEach(v => { if (v < mn) mn = v; if (v > mx) mx = v; });
    const levels = []; const step = (mx - mn) > 12 ? 4 : (mx - mn) > 4 ? 2 : 1;
    for (let l = Math.ceil(mn / step) * step; l < mx; l += step) levels.push(l);
    const contours = levels.map(l => ({ level: l, segs: marching(field, gx, gy, W, H, l) }));
    let fronts = [];
    for (let i = 1; i < n; i++) {
      const d = P[i].rep.tempF - P[i - 1].rep.tempF;
      if (Math.abs(d) >= 6 && P[i].rep.nScored + P[i - 1].rep.nScored >= 2) fronts.push({ a: stations[i - 1], b: stations[i], kind: d < 0 ? 'cold' : 'warm', d });
    }
    fronts = fronts.sort((p, q) => Math.abs(q.d) - Math.abs(p.d)).slice(0, 5);
    let hi = stations[0], lo = stations[0]; stations.forEach(s => { if (s.v > hi.v) hi = s; if (s.v < lo.v) lo = s; });
    return { stations, contours, fronts, cols, rows, hi, lo, min: mn, max: mx };
  }

  function marching(f, gx, gy, W, H, lv) {
    const segs = [];
    const at = (i, j) => f[j * (gx + 1) + i];
    const lerp = (x1, y1, v1, x2, y2, v2) => { const t = (lv - v1) / ((v2 - v1) || 1e-9); return [x1 + (x2 - x1) * t, y1 + (y2 - y1) * t]; };
    for (let j = 0; j < gy; j++) for (let i = 0; i < gx; i++) {
      const x0 = i / gx * W, x1 = (i + 1) / gx * W, y0 = j / gy * H, y1 = (j + 1) / gy * H;
      const a = at(i, j), b = at(i + 1, j), c = at(i + 1, j + 1), d = at(i, j + 1);
      const idx = (a > lv ? 8 : 0) | (b > lv ? 4 : 0) | (c > lv ? 2 : 0) | (d > lv ? 1 : 0);
      if (idx === 0 || idx === 15) continue;
      const top = () => lerp(x0, y0, a, x1, y0, b), right = () => lerp(x1, y0, b, x1, y1, c), bottom = () => lerp(x0, y1, d, x1, y1, c), left = () => lerp(x0, y0, a, x0, y1, d);
      const push = (p, q) => segs.push([p, q]);
      switch (idx) {
        case 1: case 14: push(left(), bottom()); break;
        case 2: case 13: push(bottom(), right()); break;
        case 3: case 12: push(left(), right()); break;
        case 4: case 11: push(top(), right()); break;
        case 5: push(left(), top()); push(bottom(), right()); break;
        case 6: case 9: push(top(), bottom()); break;
        case 7: case 8: push(left(), top()); break;
        case 10: push(top(), right()); push(left(), bottom()); break;
      }
    }
    return segs;
  }

  const api = { analyze, report, tempF, condition, COND_LABEL, OPENER_KINDS, stripMarkdown, splitSentences, syllables, synoptic, lookup, FUNCTION_WORDS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ProseWeather = api;
})(typeof window !== 'undefined' ? window : this);
