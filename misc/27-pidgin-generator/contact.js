/*
 * Pidgin Generator - the contact model.
 *
 * Pure functions, no DOM: runs in the browser (window.PidginContact) and in
 * Node (module.exports) so the model can be tested from the command line.
 *
 * generate(langs, {lex, sub, weight, seed, decreolise}) returns a language:
 *   - a target phonology (substrate inventory pruned to what the lexifier also
 *     has, substrate syllable template),
 *   - a lexicon: each concept takes the lexifier form with probability = weight,
 *     otherwise the substrate form, and is then filtered through the substrate
 *     phonology (segment mapping, cluster repair, coda repair, paragoge),
 *   - a grammar chosen by weighted vote with a bias toward SVO / analytic
 *     structure, TMA particles grammaticalised from lexifier words,
 *   - derived compounds, a name, a phrasebook, a small corpus and a sketch.
 *
 * Everything is deterministic in (lex, sub, weight, seed, decreolise).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PidginContact = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var ANY = '*';

  /* ---------------------------------------------------------------- */
  /* Segments                                                          */
  /* ---------------------------------------------------------------- */

  /* Multi-character segments, longest first, for the tokeniser. */
  var MULTI = ['tʃʰ', 'tsʰ', 'tsʼ', 'tʃ', 'dʒ', 'ts', 'dz', 'tʰ', 'pʰ', 'kʰ', 'kʼ'];
  var VOWELS = {};
  'a e i o u ə ɛ ɔ ɪ ʊ æ ʌ ɨ ɯ y ã ẽ ĩ õ ũ ɑ ɤ'.split(' ').forEach(function (v) { VOWELS[v] = true; });

  /* Nearest-neighbour chains: the first candidate the target inventory
   * contains wins. A candidate may be a sequence ('nj', 'an') or '' (delete). */
  var CHAIN = {
    p: ['p', 'b', 'f'], b: ['b', 'ɓ', 'p', 'v'], t: ['t', 'd'], d: ['d', 'ɗ', 't'], k: ['k', 'g', 'ʔ'], g: ['g', 'k', 'ɣ'],
    'ʔ': ['ʔ', ''], m: ['m', 'n'], n: ['n', 'm'], 'ŋ': ['ŋ', 'n', 'g'], 'ɲ': ['ɲ', 'nj', 'n'],
    f: ['f', 'ɸ', 'p', 'h', 'v'], v: ['v', 'b', 'w', 'f'], 'θ': ['θ', 't', 's', 'f'], 'ð': ['ð', 'd', 'z', 'v'],
    s: ['s', 'ʃ'], z: ['z', 's', 'dʒ'], 'ʃ': ['ʃ', 's', 'tʃ'], 'ʒ': ['ʒ', 'dʒ', 'z', 'ʃ', 'j'],
    'tʃ': ['tʃ', 'ts', 'tʃʰ', 'ʃ', 't'], 'dʒ': ['dʒ', 'dz', 'z', 'tʃ', 'j', 'd'], ts: ['ts', 'tʃ', 's', 't'], dz: ['dz', 'dʒ', 'z', 'd'],
    x: ['x', 'h', 'k'], 'ɣ': ['ɣ', 'g', 'h'], h: ['h', 'x', ''], l: ['l', 'r', 'ɾ'], r: ['r', 'ɾ', 'l'], 'ɾ': ['ɾ', 'r', 'l'],
    w: ['w', 'v', 'u'], j: ['j', 'i', 'dʒ'], 'ɓ': ['ɓ', 'b'], 'ɗ': ['ɗ', 'd'], 'kʼ': ['kʼ', 'k'], 'tsʼ': ['tsʼ', 'ts', 's'],
    'pʰ': ['pʰ', 'p'], 'tʰ': ['tʰ', 't'], 'kʰ': ['kʰ', 'k'], 'tsʰ': ['tsʰ', 'ts', 'tʃ', 's'], 'tʃʰ': ['tʃʰ', 'tʃ', 'ts'], 'ɸ': ['ɸ', 'f', 'h'],
    'ʎ': ['ʎ', 'lj', 'l', 'j'],
    a: ['a', 'ɑ', 'æ'], e: ['e', 'ɛ', 'i'], i: ['i', 'ɪ', 'e'], o: ['o', 'ɔ', 'u'], u: ['u', 'ʊ', 'o'],
    'ɪ': ['ɪ', 'i'], 'ʊ': ['ʊ', 'u'], 'æ': ['æ', 'a', 'e'], 'ʌ': ['ʌ', 'a', 'ə', 'o'], 'ɛ': ['ɛ', 'e'], 'ɔ': ['ɔ', 'o'],
    'ə': ['ə', 'a', 'e', 'u'], 'ã': ['ã', 'an', 'a'], 'ẽ': ['ẽ', 'en', 'e'], 'ĩ': ['ĩ', 'in', 'i'], 'õ': ['õ', 'on', 'o'], 'ũ': ['ũ', 'un', 'u'],
    'ɯ': ['ɯ', 'u'], 'ɨ': ['ɨ', 'ɯ', 'i', 'u'], 'ɤ': ['ɤ', 'ə', 'o', 'e'], 'ɑ': ['ɑ', 'a'], y: ['y', 'i', 'u']
  };

  /* Practical orthography for the generated language. */
  var ORTH = {
    'ŋ': 'ng', 'ɲ': 'ny', 'ʃ': 'sh', 'ʒ': 'zh', 'tʃ': 'ch', 'dʒ': 'j', 'θ': 'th', 'ð': 'dh', 'x': 'kh', 'ɣ': 'gh', 'ɸ': 'f',
    'ɾ': 'r', 'j': 'y', 'ʔ': "'", 'kʼ': 'ƙ', 'tsʼ': "ts'", 'tʃʰ': 'chʰ', 'ʎ': 'ly',
    'ɪ': 'i', 'ʊ': 'u', 'æ': 'a', 'ʌ': 'a', 'ɨ': 'ư', 'ɯ': 'u', 'y': 'ü', 'ɑ': 'a', 'ɤ': 'ə'
  };

  function isV(s) { return VOWELS[s] === true; }

  function tokenize(ipa) {
    var out = [], i = 0, s = ipa.replace(/[ˈˌ.]/g, '');
    while (i < s.length) {
      var hit = null;
      for (var m = 0; m < MULTI.length; m++) {
        if (s.substr(i, MULTI[m].length) === MULTI[m]) { hit = MULTI[m]; break; }
      }
      if (hit) { out.push(hit); i += hit.length; }
      else { var ch = s[i]; if (ch !== ' ' && ch !== '-') out.push(ch); i++; }
    }
    return out;
  }

  /* "orth|ipa" or "form", optional trailing "?" (author unsure). */
  function parseEntry(str) {
    if (!str) return null;
    var u = false;
    if (str.slice(-1) === '?') { u = true; str = str.slice(0, -1); }
    var parts = str.split('|');
    return { orth: parts[0], ipa: parts[1] || parts[0], u: u };
  }

  /* ---------------------------------------------------------------- */
  /* Deterministic randomness                                          */
  /* ---------------------------------------------------------------- */

  function fnv(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  /* One uniform number in [0,1) for (seed, key). */
  function u01(seed, key) { return mulberry32(fnv(String(seed) + '|' + key))(); }

  /* ---------------------------------------------------------------- */
  /* Target phonology                                                  */
  /* ---------------------------------------------------------------- */

  function toSet(arr) { var s = {}; (arr || []).forEach(function (x) { s[x] = true; }); return s; }
  function keys(set) { return Object.keys(set); }

  /* Segments common enough that a substrate never loses them, and substrate
   * segments that count as "the same" as a lexifier segment for pruning
   * (Vietnamese ɓ carries English b, Mandarin tʰ carries t, and so on). */
  var UNMARKED = toSet('p t k b d g m n s h l r w j a i u e o'.split(' '));
  var EQUIV = {
    'ɓ': ['b'], 'ɗ': ['d'], 'ɣ': ['g'], 'kʼ': ['k'], 'tsʼ': ['ts', 's'], 'pʰ': ['p'], 'tʰ': ['t'], 'kʰ': ['k'],
    'tsʰ': ['ts', 'tʃ'], 'tʃʰ': ['tʃ'], 'ɸ': ['f'], 'ɾ': ['r'], 'x': ['h', 'k'], 'ʎ': ['l'], 'ɲ': ['n'],
    'ə': ['ʌ'], 'ʌ': ['ə'], 'ɨ': ['ɯ'], 'ɯ': ['ɨ', 'u'], 'ɛ': ['e'], 'ɔ': ['o'], 'ɪ': ['i'], 'ʊ': ['u']
  };

  /* The pidgin's phonology = the substrate's system, pruned to segments the
   * lexifier also has (unless the mix is substrate-heavy). Codas that are
   * coda-only in the substrate (Vietnamese p) survive if the lexifier has them. */
  function buildTarget(sub, lex, keepSubOnly) {
    var P = sub.phon;
    var lexAll = toSet(lex.phon.cons.concat(lex.phon.codaOnly || [], lex.phon.vowels));
    var subAll = toSet(P.cons.concat(P.codaOnly || [], P.vowels));
    /* keep a substrate segment if the lexifier has it, it is unmarked, or it is the
     * substrate's stand-in for a lexifier segment the substrate itself lacks */
    var keep = function (s) {
      if (keepSubOnly || lexAll[s] === true || UNMARKED[s]) return true;
      return (EQUIV[s] || []).some(function (e) { return lexAll[e] === true && !subAll[e]; });
    };
    var cons = P.cons.filter(keep);
    var codaBase = P.coda.allowed === ANY ? P.cons.concat(P.codaOnly || []) : P.coda.allowed;
    var codas = codaBase.filter(keep);
    var vowels = P.vowels.filter(keep);
    if (vowels.length < 3) vowels = P.vowels.slice();
    if (cons.length < 6) cons = P.cons.slice();
    return {
      name: sub.name, lexName: lex.name, subHas: toSet(P.cons.concat(P.codaOnly || [], P.vowels)),
      cons: toSet(cons), codas: toSet(codas), vowels: toSet(vowels),
      consList: cons, codaList: codas, vowelList: vowels,
      onset: P.onset, codaMax: P.coda.max, codaSubst: !!P.codaSubst,
      geminates: !!P.geminates, longVowels: !!P.longVowels,
      map: P.map || {}, repairs: P.repairs || [], cluster: P.cluster, final: P.final,
      template: P.template
    };
  }

  /* A language's own full phonology as a target (used when decreolising). */
  function selfTarget(lang) { return buildTarget(lang, lang, true); }

  function allowedIn(T, kind) {
    if (kind === 'vowel') return T.vowels;
    if (kind === 'onset') return T.cons;
    if (kind === 'coda') return T.codas;
    var all = {}; keys(T.cons).forEach(function (c) { all[c] = true; }); keys(T.codas).forEach(function (c) { all[c] = true; });
    if (kind === 'any') { keys(T.vowels).forEach(function (v) { all[v] = true; }); }
    return all;
  }

  /* Nearest allowed replacement for a segment, or null. kind: vowel|onset|coda|cons. */
  function nearest(seg, T, kind, depth) {
    depth = depth || 0;
    var allowed = allowedIn(T, kind);
    var anyAll = allowedIn(T, 'any');
    var cands = (T.map[seg] || []).concat(CHAIN[seg] || []);
    for (var i = 0; i < cands.length; i++) {
      var c = cands[i];
      if (c === '') return [];
      var toks = tokenize(c);
      if (toks.length === 1) { if (allowed[toks[0]] || (kind === 'cons' && T.vowels[toks[0]])) return toks; }
      else if (kind !== 'coda' && toks.every(function (t) { return anyAll[t]; })) return toks;
    }
    if (depth < 1) {
      for (var j = 0; j < cands.length; j++) {
        var c2 = cands[j];
        if (c2 === '' || c2 === seg || tokenize(c2).length !== 1) continue;
        var r = nearest(c2, T, kind, depth + 1);
        if (r) return r;
      }
    }
    return null;
  }

  function legalOnset(run, T) {
    if (run.length === 0) return true;
    if (run.length === 1) return T.cons[run[0]] === true;
    if (run.length > T.onset.max) return false;
    if (!run.every(function (c) { return T.cons[c] === true; })) return false;
    var pairOK = function (a, b) {
      return T.onset.pairs.some(function (p) { return (p[0] === ANY || p[0].indexOf(a) >= 0) && p[1].indexOf(b) >= 0; });
    };
    if (run.length === 2) return pairOK(run[0], run[1]) || (run[0] === 's' && T.onset.sPlus.indexOf(run[1]) >= 0);
    if (run.length === 3) return run[0] === 's' && T.onset.sPlus.indexOf(run[1]) >= 0 && pairOK(run[1], run[2]);
    return false;
  }
  function legalCoda(run, T) {
    return run.length <= T.codaMax && run.every(function (c) { return T.codas[c] === true; });
  }
  /* Does a medial consonant run have a legal coda|onset split? */
  function hasSplit(run, T) {
    for (var k = 0; k <= run.length; k++) {
      if (legalCoda(run.slice(0, k), T) && legalOnset(run.slice(k), T)) return true;
    }
    return false;
  }

  function pickVowel(spec, T, prevC, nextV, prevV) {
    var v = null;
    if (spec.after && spec.after[prevC]) v = spec.after[prevC];
    else if (spec.copy) v = nextV || prevV || spec.vowel;
    else v = spec.vowel;
    if (!v) v = 'a';
    if (!T.vowels[v]) { var n = nearest(v, T, 'vowel'); v = (n && n[0]) || keys(T.vowels)[0]; }
    return v;
  }

  /* Sequence repairs such as Japanese ti > tʃi, only when the result stays inside the inventory. */
  function applyRepairs(segs, T, trace) {
    if (!T.repairs.length) return segs;
    var all = allowedIn(T, 'any');
    var out = segs.slice();
    for (var r = 0; r < T.repairs.length; r++) {
      var from = T.repairs[r][0], to = T.repairs[r][1];
      if (!to.every(function (t) { return all[t]; })) continue;
      for (var i = 0; i + from.length <= out.length; i++) {
        var match = true;
        for (var k = 0; k < from.length; k++) if (out[i + k] !== from[k]) { match = false; break; }
        if (match) {
          out.splice.apply(out, [i, from.length].concat(to));
          trace.push('sequence ' + from.join('') + ' → ' + to.join('') + ' (' + T.name + ' phonotactics)');
          i += to.length - 1;
        }
      }
    }
    return out;
  }

  /* Find the first illegal consonant run: {type, start, end}. */
  function findProblem(segs, T) {
    var i = 0, n = segs.length, seenV = false;
    while (i < n) {
      if (isV(segs[i])) { seenV = true; i++; continue; }
      var j = i; while (j < n && !isV(segs[j])) j++;
      var run = segs.slice(i, j);
      if (!T.geminates) {
        for (var g = 1; g < run.length; g++) if (run[g] === run[g - 1]) return { type: 'geminate', start: i + g, end: i + g + 1 };
      }
      var final = j >= n;
      if (!seenV) {
        if (final) return { type: 'final', start: i, end: j };   /* word of consonants only */
        if (!legalOnset(run, T)) return { type: 'onset', start: i, end: j };
      } else if (final) {
        if (!legalCoda(run, T)) return { type: 'final', start: i, end: j };
      } else if (!hasSplit(run, T)) {
        return { type: 'medial', start: i, end: j };
      }
      i = j;
    }
    return null;
  }

  function prevVowel(segs, idx) { for (var i = idx - 1; i >= 0; i--) if (isV(segs[i])) return segs[i]; return null; }
  function nextVowel(segs, idx) { for (var i = idx; i < segs.length; i++) if (isV(segs[i])) return segs[i]; return null; }

  var SONORANT = { l: 1, r: 1, 'ɾ': 1, w: 1, j: 1, m: 0.5, n: 0.5, 'ŋ': 0.5 };

  /* Repair one problem; returns the new segment array. */
  function fix(segs, p, T, trace) {
    var out = segs.slice(), run = out.slice(p.start, p.end), i;

    if (p.type === 'geminate') {
      trace.push('geminate ' + out[p.start] + out[p.start] + ' simplified');
      out.splice(p.start, 1); return out;
    }

    /* A consonant that cannot begin a syllable (coda-only, e.g. Vietnamese p). */
    if (p.type === 'onset' || p.type === 'medial') {
      for (i = 0; i < run.length; i++) {
        if (!T.cons[run[i]] && T.codas[run[i]]) {
          var canBeCoda = p.type === 'medial' && i === 0 && legalOnset(run.slice(1), T);
          if (!canBeCoda) {
            var rep = nearest(run[i], T, 'onset');
            trace.push(run[i] + ' → ' + (rep && rep.length ? rep.join('') : '∅') + ' (coda-only in ' + T.name + ')');
            out.splice.apply(out, [p.start + i, 1].concat(rep || []));
            return out;
          }
        }
      }
    }

    if (p.type === 'onset') {
      if (T.cluster.prothesis && run[0] === 's' && run.length >= 2) {
        var pv = pickVowel({ vowel: T.cluster.prothesis }, T);
        trace.push('prothesis ' + pv + '- before s-cluster (as in Spanish estrés)');
        out.splice(p.start, 0, pv); return out;
      }
      if (T.cluster.mode === 'epenthesis') {
        var ev = pickVowel(T.cluster, T, run[0], nextVowel(out, p.end), null);
        trace.push('epenthesis ' + ev + ' after ' + run[0] + ' (cluster ' + run.join('') + ')');
        out.splice(p.start + 1, 0, ev); return out;
      }
      /* deletion: drop s from sC, otherwise the most sonorous consonant */
      var di = (run[0] === 's' && run.length >= 2) ? 0 : mostSonorous(run);
      trace.push('cluster ' + run.join('') + ' simplified: ' + run[di] + ' dropped');
      out.splice(p.start + di, 1); return out;
    }

    if (p.type === 'medial') {
      /* try substituting the first consonant with something coda-legal */
      if (T.codaSubst && !T.codas[run[0]] && legalOnset(run.slice(1), T)) {
        var cs = nearest(run[0], T, 'coda');
        if (cs && cs.length) {
          trace.push(run[0] + ' → ' + cs[0] + ' in coda');
          out.splice(p.start, 1, cs[0]); return out;
        }
      }
      if (T.cluster.mode === 'epenthesis') {
        /* insert after the first consonant that cannot stay in coda */
        var at = 0;
        for (i = 0; i < run.length - 1; i++) { if (legalCoda(run.slice(0, i + 1), T)) at = i + 1; else break; }
        if (at >= run.length - 1) at = run.length - 2;
        if (at < 0) at = 0;
        var mv = pickVowel(T.cluster, T, run[at], nextVowel(out, p.end), prevVowel(out, p.start));
        trace.push('epenthesis ' + mv + ' after ' + run[at] + ' (cluster ' + run.join('') + ')');
        out.splice(p.start + at + 1, 0, mv); return out;
      }
      /* deletion: find one removal that yields a legal split, preferring sonorants and s */
      var order = run.map(function (c, idx) { return { idx: idx, s: (SONORANT[c] || 0) + (c === 's' ? 0.8 : 0) }; })
        .sort(function (a, b) { return b.s - a.s || b.idx - a.idx; });
      for (i = 0; i < order.length; i++) {
        var test = run.slice(); test.splice(order[i].idx, 1);
        if (hasSplit(test, T)) {
          trace.push('cluster ' + run.join('') + ' simplified: ' + run[order[i].idx] + ' dropped');
          out.splice(p.start + order[i].idx, 1); return out;
        }
      }
      trace.push('cluster ' + run.join('') + ' simplified: ' + run[run.length - 1] + ' dropped');
      out.splice(p.end - 1, 1); return out;
    }

    if (p.type === 'final') {
      var last = run[run.length - 1];
      if (T.codaSubst) {
        for (i = 0; i < run.length; i++) {
          if (!T.codas[run[i]]) {
            var fs = nearest(run[i], T, 'coda');
            if (fs && fs.length) {
              trace.push(run[i] + ' → ' + fs[0] + ' in final coda');
              out.splice(p.start + i, 1, fs[0]); return out;
            }
          }
        }
      }
      var F = T.final;
      if (F.mode === 'paragoge' || (F.paragogeFor && F.paragogeFor[last])) {
        var spec = F.mode === 'paragoge' ? F : { vowel: F.paragogeFor[last] };
        var fv = pickVowel(spec, T, last, null, prevVowel(out, p.start));
        trace.push('paragoge -' + fv + ' after final ' + last);
        out.push(fv); return out;
      }
      trace.push('final ' + last + ' dropped (not a licit coda in ' + T.name + ')');
      out.splice(p.end - 1, 1); return out;
    }
    return out;
  }

  function mostSonorous(run) {
    var best = run.length - 1, bs = -1;
    for (var i = 0; i < run.length; i++) { var s = SONORANT[run[i]] || 0; if (s > bs) { bs = s; best = i; } }
    return best;
  }

  /* Run one word (array of segments) through the target phonology. */
  function filterSegs(segs, T) {
    var trace = [], out = [], i;
    var anyAll = allowedIn(T, 'any');
    for (i = 0; i < segs.length; i++) {
      var s = segs[i];
      if (anyAll[s]) { out.push(s); continue; }
      var rep = nearest(s, T, isV(s) ? 'vowel' : 'cons');
      if (rep === null) rep = isV(s) ? ['a'] : [];
      var why = T.subHas && T.subHas[s] ? '/' + s + '/ pruned: ' + T.lexName + ' never supplies it' : 'no /' + s + '/ in ' + T.name;
      trace.push(s + ' → ' + (rep.length ? rep.join('') : '∅') + ' (' + why + ')');
      out = out.concat(rep);
    }
    if (!T.longVowels) out = collapseVowels(out, trace);
    for (var iter = 0; iter < 16; iter++) {
      out = applyRepairs(out, T, trace);
      var p = findProblem(out, T);
      if (!p) break;
      out = fix(out, p, T, trace);
    }
    out = applyRepairs(out, T, trace);
    if (!T.longVowels) out = collapseVowels(out, trace);
    if (!out.length) { out = [keys(T.vowels)[0]]; trace.push('word emptied; placeholder vowel'); }
    var seen = {};
    trace = trace.filter(function (r) { if (seen[r]) return false; seen[r] = true; return true; });
    return { segs: out, rules: trace };
  }

  function collapseVowels(segs, trace) {
    var out = [];
    for (var i = 0; i < segs.length; i++) {
      if (i > 0 && isV(segs[i]) && segs[i] === segs[i - 1]) { trace.push('long ' + segs[i] + segs[i] + ' shortened'); continue; }
      out.push(segs[i]);
    }
    return out;
  }

  function spell(segs, T) {
    var both = function (a, b) { return T.vowels[a] && T.vowels[b]; };
    return segs.map(function (s) {
      if (s === 'ɛ' && both('ɛ', 'e')) return 'è';
      if (s === 'ɔ' && both('ɔ', 'o')) return 'ò';
      if (s === 'æ' && both('æ', 'a')) return 'æ';
      if (s === 'ʌ' && both('ʌ', 'a')) return 'â';
      return ORTH[s] !== undefined ? ORTH[s] : s;
    }).join('');
  }

  /* Filter a (possibly multi-word) IPA string. */
  function filterForm(ipa, T) {
    var words = ipa.split(' ').filter(Boolean);
    var res = words.map(function (w) { return filterSegs(tokenize(w), T); });
    return {
      ipa: res.map(function (r) { return r.segs.join(''); }).join(' '),
      orth: res.map(function (r) { return spell(r.segs, T); }).join(' '),
      segs: res.reduce(function (a, r) { return a.concat(r.segs); }, []),
      rules: res.reduce(function (a, r) { return a.concat(r.rules); }, [])
    };
  }

  /* ---------------------------------------------------------------- */
  /* Generation                                                        */
  /* ---------------------------------------------------------------- */

  var COMPOUNDS = [
    ['tears', 'water', 'eye'], ['sweat', 'water', 'skin'], ['well', 'house', 'water'], ['kitchen', 'house', 'fire'],
    ['bedroom', 'house', 'sleep'], ['river', 'water', 'go'], ['lake', 'water', 'big'], ['ice', 'water', 'cold'],
    ['soup', 'water', 'meat'], ['son', 'child', 'man'], ['daughter', 'child', 'woman'], ['eyebrow', 'hair', 'eye'], ['beard', 'hair', 'mouth']
  ];

  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  function generate(L, opts) {
    var LANGS = L.LANGS, CONCEPTS = L.CONCEPTS;
    var lex = LANGS[opts.lex], sub = LANGS[opts.sub];
    if (!lex || !sub) throw new Error('unknown language');
    var w = Math.max(0, Math.min(1, +opts.weight));
    var seed = String(opts.seed == null ? 1 : opts.seed);
    var dec = !!opts.decreolise;
    var wEff = dec ? 0.5 + w / 2 : w;                       /* decreolisation pulls toward the lexifier */
    var keepSubOnly = (1 - wEff) >= 0.5;
    var T = buildTarget(sub, lex, keepSubOnly);
    var TL = selfTarget(lex);
    var same = lex.id === sub.id;

    var cache = {};
    /* Filter an entry; `key` seeds the decreolised "acrolectal" choice per word. */
    function form(entry, src, key) {
      var acro = dec && u01(seed, 'acro:' + key) < 0.5;
      var ck = entry.ipa + '|' + (acro ? 'L' : 'S');
      var f = cache[ck];
      if (!f) {
        f = filterForm(entry.ipa, acro ? TL : T);
        if (acro) f.rules = ['decreolised: kept in ' + lex.name + ' phonology'].concat(f.rules);
        cache[ck] = f;
      }
      return { orth: f.orth, ipa: f.ipa, segs: f.segs, rules: f.rules, src: src, from: entry, acro: acro };
    }
    function lexForm(concept) {
      var r = u01(seed, 'lex:' + concept);
      var fromLex = same || r < wEff;
      var src = fromLex ? lex : sub;
      var e = parseEntry(src.lex[concept]);
      var f = form(e, fromLex ? 'L' : 'S', concept);
      f.concept = concept;
      f.u = e.u;
      return f;
    }
    function fnForm(key, srcLang) {
      var s = srcLang || lex;
      var e = parseEntry(s.fn[key]);
      return form(e, s === lex ? 'L' : 'S', 'fn:' + key);
    }

    /* --- lexicon --- */
    var lexicon = CONCEPTS.map(function (c) {
      var f = lexForm(c[0]);
      f.pos = c[1];
      f.lexEntry = parseEntry(lex.lex[c[0]]);
      f.subEntry = parseEntry(sub.lex[c[0]]);
      return f;
    });
    var byConcept = {};
    lexicon.forEach(function (f) { byConcept[f.concept] = f; });

    /* --- grammar by weighted vote --- */
    var jit = function (key) { return (u01(seed, 'g:' + key) - 0.5); };
    function vote(param, options, bias) {
      var best = null, bs = -Infinity;
      options.forEach(function (o) {
        var s = wEff * (lex.gram[param] === o ? 1 : 0) + (1 - wEff) * (sub.gram[param] === o ? 1 : 0) + (bias[o] || 0) + jit(param + o) * 0.2;
        if (s > bs) { bs = s; best = o; }
      });
      return best;
    }
    function bool(param, thresh) {
      var s = wEff * (lex.gram[param] ? 1 : 0) + (1 - wEff) * (sub.gram[param] ? 1 : 0) + jit(param) * 0.3;
      return s > thresh;
    }
    var G = {};
    G.order = vote('order', ['SVO', 'SOV', 'VSO'], { SVO: 0.35 });
    G.adpos = vote('adpos', ['pre', 'post'], { pre: 0.1 });
    G.adj = vote('adj', ['pre', 'post'], {});
    G.dem = vote('dem', ['pre', 'post'], {});
    G.num = vote('num', ['pre', 'post'], { pre: 0.1 });
    G.gen = vote('gen', ['possessed-first', 'possessor-first'], {});
    G.neg = G.order === 'SOV' ? 'post' : vote('neg', ['pre', 'post'], { pre: 0.3 });
    G.wh = vote('wh', ['front', 'in-situ'], {});
    G.clusive = bool('clusive', 0.45);
    G.svc = bool('svc', 0.45);
    G.tmaPos = G.order === 'SOV' ? 'post' : 'pre';
    G.copula = dec ? form(parseEntry(lex.gram.copula), 'L', 'cop') : null;
    /* plural strategy */
    var redupScore = 0.25 + 0.6 * (wEff * (lex.gram.redup ? 1 : 0) + (1 - wEff) * (sub.gram.redup ? 1 : 0)) + jit('pl-redup') * 0.3;
    var allScore = 0.35 + jit('pl-all') * 0.3, thScore = 0.3 + jit('pl-3pl') * 0.3;
    G.plural = redupScore >= allScore && redupScore >= thScore ? 'redup' : (allScore >= thScore ? 'all' : '3pl');
    /* question particle */
    var qScore = wEff * (lex.gram.q ? 1 : 0) + (1 - wEff) * (sub.gram.q ? 1 : 0) + jit('q') * 0.2;
    G.qSource = qScore > 0.5 ? (lex.gram.q ? lex : sub) : null;

    /* --- function words, TMA, pronouns, numerals --- */
    var F = {};
    ['neg', 'where', 'what', 'who', 'loc', 'gen', 'and', 'all', 'many', 'this', 'that', 'here', 'there', 'yes', 'no', 'to', 'in'].forEach(function (k) { F[k] = fnForm(k); });
    F.q = G.qSource ? fnForm('q', G.qSource) : null;
    var TMA = {};
    ['ant', 'fut', 'prog', 'compl'].forEach(function (k) {
      var e = parseEntry(lex.tma[k].w);
      TMA[k] = form(e, 'L', 'tma:' + k); TMA[k].from = lex.tma[k].from;
    });
    var PRON = {};
    ['1sg', '2sg', '3sg', '1pl', '2pl', '3pl'].forEach(function (k) { PRON[k] = form(parseEntry(lex.pron[k]), 'L', 'pron:' + k); });
    if (parseEntry(lex.pron['2pl']).orth === parseEntry(lex.pron['2sg']).orth) {
      var e2 = { orth: parseEntry(lex.pron['2sg']).orth + '+' + parseEntry(lex.fn.all).orth, ipa: parseEntry(lex.pron['2sg']).ipa + parseEntry(lex.fn.all).ipa };
      PRON['2pl'] = form(e2, 'L', 'pron:2pl+'); PRON['2pl'].note = 'you + all';
    }
    if (G.clusive) {
      var ei = { orth: parseEntry(lex.pron['2sg']).orth + '+' + parseEntry(lex.pron['1sg']).orth, ipa: parseEntry(lex.pron['2sg']).ipa + parseEntry(lex.pron['1sg']).ipa };
      PRON['1pl.incl'] = form(ei, 'L', 'pron:1pl.incl'); PRON['1pl.incl'].note = 'you + me, cf. Tok Pisin yumi';
    }
    var NUM = lex.num.map(function (n, i) { return form(parseEntry(n), 'L', 'num:' + i); });
    var PL = G.plural === 'all' ? F.all : (G.plural === '3pl' ? PRON['3pl'] : null);

    /* --- compounds --- */
    var compounds = COMPOUNDS.map(function (c) {
      var head = byConcept[c[1]], mod = byConcept[c[2]];
      var headFirst = G.gen === 'possessed-first';
      var parts = headFirst ? [head, mod] : [mod, head];
      return { meaning: c[0], head: c[1], mod: c[2], orth: parts[0].orth + '-' + parts[1].orth, gloss: parts[0].concept + '-' + parts[1].concept };
    });

    /* --- name --- */
    var talk = form(parseEntry(lex.lex.talk), 'L', 'name:talk');
    var auto = form(parseEntry(lex.autonym), 'L', 'name:autonym');
    var name = cap(talk.orth.split(' ')[0]) + ' ' + cap(auto.orth.split(' ').slice(-1)[0]);

    var lang = {
      name: name, lex: lex, sub: sub, weight: w, weightEff: wEff, seed: seed, decreolise: dec, same: same,
      target: T, keepSubOnly: keepSubOnly, G: G, F: F, TMA: TMA, PRON: PRON, NUM: NUM, PL: PL,
      lexicon: lexicon, byConcept: byConcept, compounds: compounds, nameParts: { talk: talk, autonym: auto }
    };
    lang.phrasebook = buildPhrasebook(lang);
    lang.corpus = buildCorpus(lang);
    lang.sketch = buildSketch(lang);
    return lang;
  }

  /* ---------------------------------------------------------------- */
  /* Syntax: NP and clause linearisation                               */
  /* ---------------------------------------------------------------- */

  function tok(f, g, cls) { return { f: f, g: g, c: cls || 'lex' }; }

  function makeSyntax(lang) {
    var G = lang.G, F = lang.F, PRON = lang.PRON, NUM = lang.NUM, TMA = lang.TMA, C = lang.byConcept;
    var W = function (concept) { var e = C[concept]; return tok(e.orth, concept); };
    var GL = function (key, gloss) { return tok(F[key].orth, gloss || key.toUpperCase(), 'gram'); };
    var P = function (key, gloss) { return tok(PRON[key].orth, gloss || key.toUpperCase(), 'gram'); };
    var T = function (key) { return tok(TMA[key].orth, key.toUpperCase(), 'gram'); };

    function pluralise(head, concept) {
      if (G.plural === 'redup') return [tok(head + '-' + head, concept + '~PL')];
      return null; /* handled as a particle */
    }

    /* o: {n, pron, adj, dem, num, pl, poss (NP tokens), many} */
    function NP(o) {
      if (o.pron) {
        var g = o.pron === '1pl' && G.clusive ? '1PL.EXCL' : o.pron.toUpperCase();
        return [P(o.pron, g)];
      }
      var head = [W(o.n)], pre = [], post = [];
      var plPart = null;
      if (o.pl) {
        var r = pluralise(C[o.n].orth, o.n);
        if (r) head = r; else plPart = tok(lang.PL.orth, 'PL', 'gram');
      }
      var dem = o.dem ? [GL(o.dem, o.dem)] : [];
      var num = o.num ? [tok(NUM[o.num - 1].orth, String(o.num))] : [];
      var adj = o.adj ? [W(o.adj)] : [];
      var many = o.many ? [GL('many', 'many')] : [];
      if (G.dem === 'pre') pre = pre.concat(dem); else post = post.concat(dem);
      if (G.num === 'pre') pre = pre.concat(num, many); else post = post.concat(num, many);
      if (G.adj === 'pre') pre = pre.concat(adj); else post = adj.concat(post);
      if (plPart) { if (G.dem === 'pre') pre = [plPart].concat(pre); else post = post.concat([plPart]); }
      var core = pre.concat(head, post);
      if (o.poss) {
        core = G.gen === 'possessed-first' ? core.concat([GL('gen', 'GEN')], o.poss) : o.poss.concat([GL('gen', 'GEN')], core);
      }
      return core;
    }

    function PP(key, np) {
      var p = tok(F[key].orth, key, 'gram');
      return G.adpos === 'pre' ? [p].concat(np) : np.concat([p]);
    }

    /* o: {subj, imp, tma, compl, neg, verb (concept | [v1,v2] serial), obj, io, obl:{p, np}, adv, wh:'where', q, pred, loc, here} */
    function Clause(o) {
      var vg = [];
      var neg = o.neg ? [GL('neg', 'NEG')] : [];
      var tma = o.tma ? [T(o.tma)] : [];
      var compl = o.compl ? [T('compl')] : [];
      var core;
      if (o.pred) core = o.pred.slice();
      else if (o.loc) core = [GL('loc', 'LOC')];
      else if (Array.isArray(o.verb)) core = o.verb.map(W);
      else core = [W(o.verb)];
      if (o.loc && lang.G.copula && !o.wh) core = [tok(lang.G.copula.orth, 'COP', 'gram')].concat(core.slice(1));
      if (o.pred && lang.G.copula) core = [tok(lang.G.copula.orth, 'COP', 'gram')].concat(core);
      if (G.tmaPos === 'pre') vg = neg.concat(tma, core, compl);
      else vg = core.concat(compl, tma, neg);

      var obj = o.obj || [], io = o.io || [], adv = o.adv ? [W(o.adv)] : [];
      if (o.here) adv = [GL('here', 'here')];
      var obl = o.obl ? PP(o.obl.p, o.obl.np) : [];
      var wh = o.wh ? [GL(o.wh, o.wh)] : [];
      var subj = o.imp ? [] : (o.subj || []);
      var seq;
      /* serial "take X come": object between the verbs */
      if (o.svcObj && Array.isArray(o.verb)) {
        var v1 = [W(o.verb[0])], v2 = [W(o.verb[1])];
        seq = G.order === 'SOV' ? subj.concat(obj, v1, v2, adv) : subj.concat(neg, tma, v1, obj, v2, adv);
        if (G.order === 'SOV') seq = adv.length ? adv.concat(subj, obj, v1, v2) : seq;
        return finish(seq, o);
      }
      var whInSitu = wh.length && G.wh === 'in-situ';
      var whFront = wh.length && G.wh === 'front';
      var tail = whInSitu ? wh : obl;
      if (G.order === 'SVO') seq = subj.concat(vg, io, obj, tail, adv);
      else if (G.order === 'VSO') seq = vg.concat(subj, io, obj, tail, adv);
      else seq = adv.concat(subj, io, obj, tail, vg);
      if (whFront) seq = wh.concat(seq);
      return finish(seq, o);
    }
    function finish(seq, o) {
      if (o.q && F.q) seq = seq.concat([tok(F.q.orth, 'Q', 'gram')]);
      return { words: seq, punct: (o.q || o.wh) ? '?' : (o.imp ? '!' : '.') };
    }
    return { NP: NP, Clause: Clause, W: W, GL: GL, P: P };
  }

  function buildPhrasebook(lang) {
    var S = makeSyntax(lang), NP = S.NP, Cl = S.Clause, GL = S.GL, P = S.P;
    var G = lang.G;
    var incl = G.clusive ? '1pl.incl' : '1pl';
    var me = [P('1sg')], him = [P('3sg')];
    var mine = G.gen === 'possessed-first' ? [GL('gen', 'GEN')].concat(me) : me.concat([GL('gen', 'GEN')]);
    var items = [
      ['Where is the water?', Cl({ subj: NP({ n: 'water' }), loc: true, wh: 'where' })],
      ['I ate yesterday.', Cl({ subj: me, tma: 'ant', verb: 'eat', adv: 'yesterday' })],
      ['The big house is not mine.', Cl({ subj: NP({ n: 'house', adj: 'big' }), neg: true, pred: mine })],
      ['The dog bit the child.', Cl({ subj: NP({ n: 'dog' }), tma: 'ant', verb: 'bite', obj: NP({ n: 'child' }) })],
      ['I want to drink water.', Cl({ subj: me, verb: ['want', 'drink'], obj: NP({ n: 'water' }) })],
      ['We (you and I) will go to the mountain tomorrow.', Cl({ subj: NP({ pron: incl }), tma: 'fut', verb: 'go', obl: { p: 'to', np: NP({ n: 'mountain' }) }, adv: 'tomorrow' })],
      ['The children are sleeping.', Cl({ subj: NP({ n: 'child', pl: true }), tma: 'prog', verb: 'sleep' })],
      ['She gave me two fish.', Cl({ subj: him, tma: 'ant', verb: 'give', io: me, obj: NP({ n: 'fish', num: 2 }) })],
      ['Is this water good?', Cl({ subj: NP({ n: 'water', dem: 'this' }), pred: [S.W('good')], q: true })],
      ["My father's house is big.", Cl({ subj: NP({ n: 'house', poss: NP({ n: 'father', poss: me }) }), pred: [S.W('big')] })],
      ["Don't eat that meat!", Cl({ imp: true, neg: true, verb: 'eat', obj: NP({ n: 'meat', dem: 'that' }) })],
      ['Bring the water here.', G.svc
        ? Cl({ imp: true, verb: ['take', 'come'], svcObj: true, obj: NP({ n: 'water' }), here: true })
        : Cl({ imp: true, verb: 'take', obj: NP({ n: 'water' }), obl: { p: 'to', np: [GL('here', 'here')] } })],
      ['I have finished eating.', Cl({ subj: me, verb: 'eat', compl: true })],
      ["I don't know his name.", Cl({ subj: me, neg: true, verb: 'know', obj: NP({ n: 'name', poss: him }) })],
      ['There are many people in the house.', Cl({ subj: NP({ n: 'person', many: true }), loc: true, obl: { p: 'in', np: NP({ n: 'house' }) } })]
    ];
    return items.map(function (it) { return { en: it[0], words: it[1].words, punct: it[1].punct }; });
  }

  /* English verb forms for the corpus translations. */
  var EV = {
    see: ['sees', 'saw', 'seeing'], eat: ['eats', 'ate', 'eating'], bite: ['bites', 'bit', 'biting'], kill: ['kills', 'killed', 'killing'],
    take: ['takes', 'took', 'taking'], buy: ['buys', 'bought', 'buying'], make: ['makes', 'made', 'making'], hear: ['hears', 'heard', 'hearing'],
    want: ['wants', 'wanted', 'wanting'], sleep: ['sleeps', 'slept', 'sleeping'], sit: ['sits', 'sat', 'sitting'], stand: ['stands', 'stood', 'standing'],
    go: ['goes', 'went', 'going'], come: ['comes', 'came', 'coming'], swim: ['swims', 'swam', 'swimming'], walk: ['walks', 'walked', 'walking'],
    die: ['dies', 'died', 'dying'], fly: ['flies', 'flew', 'flying'], give: ['gives', 'gave', 'giving'], have: ['has', 'had', 'having'],
    drink: ['drinks', 'drank', 'drinking'], burn: ['burns', 'burned', 'burning']
  };
  var EN_SUBJ = { '1sg': ['I', 'I'], '3sg': ['she', 'she'] };

  function buildCorpus(lang) {
    var S = makeSyntax(lang), NP = S.NP, Cl = S.Clause;
    var rng = mulberry32(fnv('corpus|' + lang.seed + '|' + lang.lex.id + '|' + lang.sub.id));
    var pick = function (arr) { return arr[Math.floor(rng() * arr.length)]; };
    var subjects = ['dog', 'man', 'woman', 'child', 'friend', 'bird', 'mother', 'father'];
    var trans = ['see', 'eat', 'bite', 'kill', 'take', 'buy', 'make', 'hear', 'want'];
    var objects = ['fish', 'meat', 'rice', 'stone', 'water', 'egg', 'money', 'food', 'bird', 'dog'];
    var intr = ['sleep', 'sit', 'stand', 'go', 'come', 'swim', 'walk', 'fly'];
    var places = ['house', 'mountain', 'path', 'water'];
    var advs = ['today', 'yesterday', 'tomorrow', 'now'];
    var adjs = ['big', 'small', 'red', 'black', 'white', 'good', 'bad', 'new', 'hot', 'cold', 'dry'];
    var tmas = ['ant', 'fut', 'prog', null];
    var out = [], types = ['trans', 'neg', 'intr', 'pred', 'have', 'want', 'give', 'trans'];
    function enSubj(s) { return s.pron ? EN_SUBJ[s.pron][0] : 'the ' + s.n; }
    function enV(v, tma, s) {
      var f = EV[v], third = !s.pron;
      if (tma === 'ant') return f[1];
      if (tma === 'fut') return 'will ' + v;
      if (tma === 'prog') return (third || s.pron === '3sg' ? 'is ' : 'am ') + f[2];
      return third || s.pron === '3sg' ? f[0] : v;
    }
    function tmaFor(tma, adv) {
      if (adv === 'yesterday') return 'ant';
      if (adv === 'tomorrow') return 'fut';
      if (adv === 'now') return 'prog';
      return tma;
    }
    types.forEach(function (t) {
      var s = rng() < 0.3 ? { pron: pick(['1sg', '3sg']) } : { n: pick(subjects) };
      var subj = NP(s), en, cl;
      if (t === 'trans') {
        var v = pick(trans), o = pick(objects), adv = rng() < 0.6 ? pick(advs) : null, tma = tmaFor(pick(tmas), adv);
        cl = Cl({ subj: subj, tma: tma, verb: v, obj: NP({ n: o }), adv: adv });
        en = enSubj(s) + ' ' + enV(v, tma, s) + ' the ' + o + (adv ? ' ' + adv : '') + '.';
      } else if (t === 'neg') {
        var v2 = pick(trans), o2 = pick(objects);
        cl = Cl({ subj: subj, neg: true, verb: v2, obj: NP({ n: o2 }) });
        en = enSubj(s) + (s.pron === '1sg' ? ' do not ' : ' does not ') + v2 + ' the ' + o2 + '.';
      } else if (t === 'intr') {
        var v3 = pick(intr), adv3 = rng() < 0.5 ? pick(advs) : null, tma3 = tmaFor(pick(tmas), adv3);
        var prep = (v3 === 'go' || v3 === 'come' || v3 === 'walk' || v3 === 'fly') ? 'to' : 'in';
        var pl = prep === 'to' ? pick(places) : pick(['house', 'water', 'path']);
        cl = Cl({ subj: subj, tma: tma3, verb: v3, obl: { p: prep, np: NP({ n: pl }) }, adv: adv3 });
        en = enSubj(s) + ' ' + enV(v3, tma3, s) + ' ' + prep + ' the ' + pl + (adv3 ? ' ' + adv3 : '') + '.';
      } else if (t === 'pred') {
        var n4 = pick(objects.concat(places)), a4 = pick(adjs), dem = pick(['this', 'that']), neg4 = rng() < 0.3;
        cl = Cl({ subj: NP({ n: n4, dem: dem }), neg: neg4, pred: [S.W(a4)] });
        en = cap(dem) + ' ' + n4 + ' is ' + (neg4 ? 'not ' : '') + a4 + '.';
      } else if (t === 'have') {
        var n5 = pick(['dog', 'fish', 'house', 'child', 'egg', 'friend']), k = 2 + Math.floor(rng() * 4);
        cl = Cl({ subj: subj, verb: 'have', obj: NP({ n: n5, num: k, pl: true }) });
        en = enSubj(s) + ' ' + enV('have', null, s) + ' ' + ['two', 'three', 'four', 'five'][k - 2] + ' ' + n5 + (n5 === 'fish' ? '' : (n5 === 'child' ? 'ren' : 's')) + '.';
      } else if (t === 'want') {
        var v6 = pick(['eat', 'drink', 'buy', 'see', 'take']), o6 = pick(objects);
        cl = Cl({ subj: subj, verb: ['want', v6], obj: NP({ n: o6 }) });
        en = enSubj(s) + ' ' + enV('want', null, s) + ' to ' + v6 + ' the ' + o6 + '.';
      } else if (t === 'give') {
        var o7 = pick(objects), adv7 = pick(['yesterday', 'today']);
        cl = Cl({ subj: subj, tma: 'ant', verb: 'give', io: NP({ pron: '1sg' }), obj: NP({ n: o7, adj: pick(['big', 'small', 'new']) }), adv: adv7 });
        en = enSubj(s) + ' gave me the ' + cl.words.filter(function (x) { return ['big', 'small', 'new'].indexOf(x.g) >= 0; })[0].g + ' ' + o7 + ' ' + adv7 + '.';
      }
      out.push({ en: cap(en), words: cl.words, punct: cl.punct });
    });
    return out;
  }

  /* ---------------------------------------------------------------- */
  /* Grammar sketch (auto-written prose)                               */
  /* ---------------------------------------------------------------- */

  function buildSketch(lang) {
    var G = lang.G, T = lang.target, F = lang.F, lex = lang.lex, sub = lang.sub;
    var o = function (f) { return f.orth; };
    var b = [];
    var consOrth = T.consList.map(function (c) { return ORTH[c] || c; });
    var codaExtra = T.codaList.filter(function (c) { return !T.cons[c]; }).map(function (c) { return ORTH[c] || c; });
    b.push(['Phonology', T.consList.length + ' consonants /' + T.consList.join(' ') + '/' + (codaExtra.length ? ' (coda only: ' + codaExtra.join(' ') + ')' : '') +
      ' and ' + T.vowelList.length + ' vowels /' + T.vowelList.join(' ') + '/: the ' + sub.name + ' system, ' +
      (lang.keepSubOnly ? 'kept intact because the mix is substrate-heavy' : 'minus what ' + lex.name + ' words never bring in') +
      '. Spelt here in a practical orthography (' + consOrth.filter(function (c, i) { return c !== T.consList[i]; }).join(', ') + ').']);
    b.push(['Syllable', 'Template ' + T.template + ' as in ' + sub.name + '; codas limited to ' + (T.codaList.length ? T.codaList.join(' ') : 'none') +
      '. Illegal clusters are ' + (T.cluster.mode === 'epenthesis' ? 'broken with an epenthetic vowel' : 'simplified by deletion') +
      (T.cluster.prothesis ? ', initial s-clusters take a prothetic ' + T.cluster.prothesis + '-' : '') +
      '; a stray final consonant is ' + (T.final.mode === 'paragoge' ? 'rescued with a paragogic vowel' : 'dropped') + '. ' + sub.phon.note]);
    b.push(['Word order', G.order + (G.order === 'SVO' && lex.gram.order !== 'SVO' && sub.gram.order !== 'SVO' ? ' (neither source is SVO, but contact languages drift there)' : '') +
      '; ' + (G.adpos === 'pre' ? 'prepositions' : 'postpositions') + ' (' + o(F.to) + ' “to”, ' + o(F.in) + ' “in”); adjectives ' + (G.adj === 'pre' ? 'before' : 'after') +
      ' the noun, demonstratives ' + (G.dem === 'pre' ? 'before' : 'after') + ', numerals ' + (G.num === 'pre' ? 'before' : 'after') + '.']);
    b.push(['Possession', (G.gen === 'possessed-first' ? 'possessed + ' + o(F.gen) + ' + possessor' : 'possessor + ' + o(F.gen) + ' + possessed') +
      '; the linker ' + o(F.gen) + ' comes from ' + lex.name + ' ' + parseEntry(lex.fn.gen).orth + '. Compounds follow the same head order (' + lang.compounds[0].orth + ' “' + lang.compounds[0].meaning + '”).']);
    b.push(['Tense, mood, aspect', 'No inflection; analytic markers ' + (G.tmaPos === 'pre' ? 'before' : 'after') + ' the verb: ' +
      ['ant', 'fut', 'prog'].map(function (k) { return o(lang.TMA[k]) + ' ' + k.toUpperCase() + ' (< ' + lang.TMA[k].from + ')'; }).join(', ') +
      '; completive ' + o(lang.TMA.compl) + ' (< ' + lang.TMA.compl.from + ') follows the verb.']);
    b.push(['Negation', o(F.neg) + ' ' + (G.neg === 'pre' ? 'before' : 'after') + ' the predicate, from ' + lex.name + ' ' + parseEntry(lex.fn.neg).orth + '.']);
    b.push(['Copula', (lang.G.copula ? 'Decreolising: ' + o(lang.G.copula) + ' (< ' + lex.name + ' ' + parseEntry(lex.gram.copula).orth + ') appears with nominal and adjectival predicates.' :
      'None with adjectival or nominal predicates (adjectives are stative verbs).') + ' Location and existence use ' + o(F.loc) + ' (< ' + lex.name + ' ' + parseEntry(lex.fn.loc).orth + ').']);
    b.push(['Number', G.plural === 'redup' ? 'Plural by reduplication (' + lang.byConcept.child.orth + '-' + lang.byConcept.child.orth + ' “children”)' + (sub.gram.redup || lex.gram.redup ? ', a substrate pattern' : '') + '.' :
      'Plural particle ' + o(lang.PL) + ' (< ' + lex.name + ' ' + (G.plural === 'all' ? parseEntry(lex.fn.all).orth + ' “all”' : parseEntry(lex.pron['3pl']).orth + ' “they”') + '), ' + (G.dem === 'pre' ? 'before' : 'after') + ' the noun; otherwise number is unmarked.']);
    var pr = lang.PRON;
    b.push(['Pronouns', ['1sg', '2sg', '3sg'].map(function (k) { return k + ' ' + o(pr[k]); }).join(', ') + '; ' +
      (G.clusive ? '1pl.incl ' + o(pr['1pl.incl']) + ' (' + pr['1pl.incl'].note + '), 1pl.excl ' + o(pr['1pl']) : '1pl ' + o(pr['1pl'])) +
      ', 2pl ' + o(pr['2pl']) + (pr['2pl'].note ? ' (' + pr['2pl'].note + ')' : '') + ', 3pl ' + o(pr['3pl']) + '. No case, no gender.']);
    b.push(['Questions', 'Wh-words ' + (G.wh === 'front' ? 'are fronted' : 'stay in situ') + ' (' + o(F.where) + ' “where”, ' + o(F.what) + ' “what”, ' + o(F.who) + ' “who”); yes/no questions ' +
      (F.q ? 'take the final particle ' + o(F.q) + ' from ' + G.qSource.name : 'are marked by intonation alone') + '.']);
    b.push(['Serial verbs', G.svc ? 'Yes: directional and benefactive serialisation (' + lang.byConcept.take.orth + ' X ' + lang.byConcept.come.orth + ' “bring X”), a substrate feature.' :
      'None; “bring” is ' + lang.byConcept.take.orth + ' + ' + o(F.to) + '-phrase.']);
    b.push(['Lexicon', Math.round(100 * lang.lexicon.filter(function (f) { return f.src === 'L'; }).length / lang.lexicon.length) + '% of the core vocabulary is from ' + lex.name +
      ', the rest from ' + sub.name + '; all of it wears ' + sub.name + ' phonology' + (lang.decreolise ? ', except acrolectal forms kept in ' + lex.name + ' shape' : '') + '.']);
    return b;
  }

  return {
    generate: generate, filterForm: filterForm, buildTarget: buildTarget, selfTarget: selfTarget,
    tokenize: tokenize, parseEntry: parseEntry, spell: spell, isVowel: isV, CHAIN: CHAIN, ORTH: ORTH, u01: u01
  };
});
