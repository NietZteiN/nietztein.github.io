/*
 * Site Reverse Engineer: the pure, DOM-free half.
 *
 *   scan()             a small JavaScript tokenizer (strings, templates,
 *                      regexes and comments handled) used by everything below
 *   listFunctions()    find named functions in a file with a brace-matching
 *                      scanner and return standalone slices
 *   readability()      identifier entropy, average identifier length,
 *                      string-literal share and a 0-100 score
 *   tokenDistance()    normalised token-level edit distance
 *   runLadder()        applies a chain of transforms from the Obfuscation
 *                      Playground (misc/04) and also records the rename map
 *   makeRng()          the same seeded RNG the playground uses
 *
 * Works in the browser (window.SRE) and under Node (module.exports) so the
 * logic can be tested without a DOM.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.SRE = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // ----------------------------------------------------------------------- //
  // Seeded RNG. hashSeed / mulberry32 are copied from
  // misc/04-obfuscation-playground/js_transforms.js (not exported there) so
  // that a given seed produces the same rungs as the playground would.
  // ----------------------------------------------------------------------- //
  function hashSeed(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }
  function mulberry32(a) {
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function makeRng(seed) { return mulberry32(hashSeed(String(seed))); }
  function pick(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }
  function shuffle(rng, arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // ----------------------------------------------------------------------- //
  // Tokenizer. Token kinds: id, num, str, tpl, re, p (punctuation), cm.
  // Good enough for slicing and for token-level comparison; it is not a
  // parser. Regex-vs-division is decided from the previous significant token.
  // ----------------------------------------------------------------------- //
  const PUNCT = [">>>=", "===", "!==", "**=", "<<=", ">>=", ">>>", "...", "=>",
    "==", "!=", "<=", ">=", "&&", "||", "??", "?.", "++", "--", "+=", "-=", "*=",
    "/=", "%=", "&=", "|=", "^=", "**", "<<", ">>"];
  const REGEX_AFTER_WORD = new Set(["return", "typeof", "instanceof", "in", "of",
    "new", "delete", "void", "throw", "case", "do", "else", "yield", "await"]);
  const KEYWORDS = new Set(["break", "case", "catch", "class", "const", "continue",
    "debugger", "default", "delete", "do", "else", "export", "extends", "finally",
    "for", "function", "if", "import", "in", "instanceof", "new", "return", "super",
    "switch", "this", "throw", "try", "typeof", "var", "void", "while", "with",
    "yield", "let", "static", "async", "await", "of", "null", "true", "false",
    "undefined"]);

  function isIdStart(c) { return /[A-Za-z_$À-￿]/.test(c); }
  function isIdPart(c) { return /[A-Za-z0-9_$À-￿]/.test(c); }

  function scan(src) {
    const toks = [];
    const n = src.length;
    let i = 0;
    // Stack of template-expression brace depths so `${ ... }` resumes the
    // template when its closing brace arrives.
    const tplStack = [];
    let lastSig = null; // last non-comment token

    function push(t, s, e) {
      const tok = { t: t, v: src.slice(s, e), s: s, e: e };
      toks.push(tok);
      if (t !== "cm") lastSig = tok;
      return tok;
    }
    function regexAllowed() {
      if (!lastSig) return true;
      if (lastSig.t === "id") return REGEX_AFTER_WORD.has(lastSig.v);
      if (lastSig.t === "p") return !(lastSig.v === ")" || lastSig.v === "]" || lastSig.v === "}");
      return false; // number, string, template, regex
    }
    // Scan template text starting after the backtick (or after a `}` that
    // closes an expression); stops at the closing backtick or at `${`.
    function scanTemplate(start) {
      let j = start;
      while (j < n) {
        const c = src[j];
        if (c === "\\") { j += 2; continue; }
        if (c === "`") return { end: j + 1, open: false };
        if (c === "$" && src[j + 1] === "{") return { end: j + 2, open: true };
        j++;
      }
      return { end: n, open: false };
    }

    while (i < n) {
      const c = src[i];
      if (c === " " || c === "\t" || c === "\n" || c === "\r" || c === "\f" || c === "\v") { i++; continue; }
      // comments
      if (c === "/" && src[i + 1] === "/") {
        let j = i + 2;
        while (j < n && src[j] !== "\n") j++;
        push("cm", i, j); i = j; continue;
      }
      if (c === "/" && src[i + 1] === "*") {
        let j = src.indexOf("*/", i + 2);
        j = j < 0 ? n : j + 2;
        push("cm", i, j); i = j; continue;
      }
      // strings
      if (c === '"' || c === "'") {
        let j = i + 1;
        while (j < n && src[j] !== c && src[j] !== "\n") { if (src[j] === "\\") j++; j++; }
        push("str", i, Math.min(n, j + 1)); i = Math.min(n, j + 1); continue;
      }
      // template literal
      if (c === "`") {
        const r = scanTemplate(i + 1);
        push("tpl", i, r.end); i = r.end;
        if (r.open) tplStack.push(0);
        continue;
      }
      // identifiers / keywords
      if (isIdStart(c)) {
        let j = i + 1;
        while (j < n && isIdPart(src[j])) j++;
        push("id", i, j); i = j; continue;
      }
      // numbers
      if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(src[i + 1] || ""))) {
        let j = i + 1;
        while (j < n && /[0-9A-Za-z_.]/.test(src[j])) {
          if ((src[j] === "e" || src[j] === "E") && (src[j + 1] === "+" || src[j + 1] === "-")
              && !/^0[xX]/.test(src.slice(i, j))) j++;
          j++;
        }
        push("num", i, j); i = j; continue;
      }
      // regex literal
      if (c === "/" && regexAllowed()) {
        let j = i + 1, inClass = false;
        while (j < n && src[j] !== "\n") {
          const d = src[j];
          if (d === "\\") { j += 2; continue; }
          if (inClass) { if (d === "]") inClass = false; }
          else if (d === "[") inClass = true;
          else if (d === "/") break;
          j++;
        }
        j++; // closing slash
        while (j < n && /[a-z]/.test(src[j])) j++;
        push("re", i, Math.min(n, j)); i = Math.min(n, j); continue;
      }
      // template expression close
      if (c === "}" && tplStack.length && tplStack[tplStack.length - 1] === 0) {
        tplStack.pop();
        const r = scanTemplate(i + 1);
        push("tpl", i, r.end); i = r.end;
        if (r.open) tplStack.push(0);
        continue;
      }
      if (tplStack.length) {
        if (c === "{") tplStack[tplStack.length - 1]++;
        else if (c === "}") tplStack[tplStack.length - 1]--;
      }
      // punctuation
      let matched = null;
      for (const p of PUNCT) { if (src.startsWith(p, i)) { matched = p; break; } }
      const len = matched ? matched.length : 1;
      push("p", i, i + len); i += len;
    }
    return toks;
  }

  // ----------------------------------------------------------------------- //
  // Function listing.
  //
  // Finds `function name(...) {...}`, `var name = function (...) {...}` and
  // `name: function (...) {...}` anywhere in the file (any nesting depth) and
  // returns a standalone declaration slice for each one, with line numbers,
  // depth and the comment lines directly above it.
  // ----------------------------------------------------------------------- //
  function lineOf(src, pos) {
    let line = 1;
    for (let i = 0; i < pos; i++) if (src.charCodeAt(i) === 10) line++;
    return line;
  }
  function dedent(text) {
    const lines = text.split("\n");
    let common = null;
    lines.forEach((l, i) => {
      if (i === 0 || !l.trim()) return; // the first line starts mid-line
      const m = l.match(/^[ \t]*/)[0];
      if (common === null || m.length < common.length) common = m;
    });
    if (!common) return text;
    return lines.map((l, i) => (i === 0 ? l : l.startsWith(common) ? l.slice(common.length) : l.replace(/^[ \t]+/, ""))).join("\n");
  }
  function commentAbove(src, line0) {
    const lines = src.split("\n");
    const out = [];
    for (let k = line0 - 2; k >= 0; k--) {
      const t = lines[k].trim();
      if (t.startsWith("//")) out.unshift(t.replace(/^\/\/\s?/, ""));
      else break;
    }
    return out.join(" ").trim();
  }
  function humanise(name) {
    return name
      .replace(/^[_$]+/, "")
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/[_$]+/g, " ")
      .toLowerCase()
      .trim();
  }

  function listFunctions(src) {
    const toks = scan(src);
    const sig = toks.filter((t) => t.t !== "cm");
    const out = [];
    const seen = Object.create(null);
    // Matching bracket index for every opening bracket token.
    const stack = [];
    const match = new Map();
    sig.forEach((t, idx) => {
      if (t.t !== "p") return;
      if (t.v === "(" || t.v === "{" || t.v === "[") stack.push(idx);
      else if (t.v === ")" || t.v === "}" || t.v === "]") {
        const open = stack.pop();
        if (open !== undefined) match.set(open, idx);
      }
    });
    // Brace depth at each token (the nesting depth shown in the list).
    let depth = 0;
    const depthAt = new Int32Array(sig.length);
    sig.forEach((t, idx) => {
      depthAt[idx] = depth;
      if (t.t === "p" && t.v === "{") depth++;
      else if (t.t === "p" && t.v === "}") depth = Math.max(0, depth - 1);
    });

    for (let idx = 0; idx < sig.length; idx++) {
      const t = sig[idx];
      if (t.t !== "id" || t.v !== "function") continue;
      let name = null, kind = "declaration", parenIdx = -1, sliceStart = t.s;
      const next = sig[idx + 1];
      if (next && next.t === "id") { name = next.v; parenIdx = idx + 2; }
      else if (next && next.t === "p" && next.v === "*") continue; // generator: skip
      else {
        parenIdx = idx + 1;
        const p1 = sig[idx - 1], p2 = sig[idx - 2], p3 = sig[idx - 3];
        if (p1 && p1.t === "p" && p1.v === "=" && p2 && p2.t === "id" && p3 && p3.t === "id"
            && (p3.v === "var" || p3.v === "let" || p3.v === "const")) {
          name = p2.v; kind = "assignment"; sliceStart = p3.s;
        } else if (p1 && p1.t === "p" && p1.v === ":" && p2 && (p2.t === "id" || p2.t === "str")) {
          name = p2.t === "str" ? p2.v.slice(1, -1) : p2.v; kind = "method";
          if (!/^[A-Za-z_$][\w$]*$/.test(name)) continue;
        } else continue; // anonymous callback
      }
      const paren = sig[parenIdx];
      if (!paren || paren.t !== "p" || paren.v !== "(") continue;
      const closeParen = match.get(parenIdx);
      if (closeParen === undefined) continue;
      const brace = sig[closeParen + 1];
      if (!brace || brace.t !== "p" || brace.v !== "{") continue;
      const closeBrace = match.get(closeParen + 1);
      if (closeBrace === undefined) continue;
      const end = sig[closeBrace].e;
      const line0 = lineOf(src, sliceStart);
      const line1 = lineOf(src, end);
      let text;
      if (kind === "declaration") text = src.slice(t.s, end);
      else if (kind === "assignment") text = src.slice(sliceStart, end) + ";";
      else text = "function " + name + src.slice(paren.s, end);
      const key = name + "@" + line0;
      if (seen[key]) continue;
      seen[key] = true;
      out.push({
        name: name,
        kind: kind,
        line0: line0,
        line1: line1,
        lines: line1 - line0 + 1,
        depth: depthAt[idx],
        start: sliceStart,
        end: end,
        code: dedent(text),
        comment: commentAbove(src, line0),
        label: humanise(name),
      });
    }
    return out;
  }

  // ----------------------------------------------------------------------- //
  // Readability metrics.
  // ----------------------------------------------------------------------- //
  function entropyOf(chars) {
    const counts = Object.create(null);
    let total = 0;
    for (const ch of chars) { counts[ch] = (counts[ch] || 0) + 1; total++; }
    if (!total) return 0;
    let h = 0;
    for (const k in counts) { const p = counts[k] / total; h -= p * Math.log2(p); }
    return h;
  }
  const clamp01 = (x) => Math.max(0, Math.min(1, x));

  // `baseline` is the byte size of the original slice (for the growth term).
  function readability(code, baseline) {
    const toks = scan(code);
    const ids = toks.filter((t) => t.t === "id" && !KEYWORDS.has(t.v)).map((t) => t.v);
    const strs = toks.filter((t) => t.t === "str" || t.t === "tpl");
    const idChars = ids.join("");
    const entropy = entropyOf(idChars);
    const avgLen = ids.length ? idChars.length / ids.length : 0;
    // "Wordlike": three or more letters with a vowel, no digits, and not a
    // soup of l / I / O lookalikes.
    const wordlike = ids.filter((v) => /^[A-Za-z_$]{3,}$/.test(v) && /[aeiouyAEIOUY]/.test(v)
      && !/^[lIO01_]+$/.test(v)).length;
    const dictScore = ids.length ? wordlike / ids.length : 1;
    let strChars = 0, strWordlike = 0;
    strs.forEach((t) => {
      const body = t.v.slice(1, -1);
      strChars += body.length;
      const looksHuman = body.length === 0 || /[ \-.,:#\/]/.test(body)
        || (/^[a-z][a-z-]*$/i.test(body) && body.length < 24);
      if (looksHuman) strWordlike += body.length;
    });
    const strShare = code.length ? strChars / code.length : 0;
    const strScore = strChars ? strWordlike / strChars : 1;
    const sizeRatio = baseline ? clamp01(baseline / Math.max(1, code.length)) : 1;
    const lenScore = clamp01((avgLen - 2) / 7);
    const score = Math.round(100 * (0.4 * dictScore + 0.2 * lenScore + 0.2 * strScore + 0.2 * sizeRatio));
    return {
      score: score,
      entropy: entropy,
      avgIdLen: avgLen,
      identifiers: ids.length,
      wordlikeShare: dictScore,
      stringShare: strShare,
      bytes: code.length,
      growth: baseline ? code.length / baseline : 1,
    };
  }

  // ----------------------------------------------------------------------- //
  // Token-level edit distance (Levenshtein over token strings, comments and
  // whitespace ignored), normalised by the longer sequence.
  // ----------------------------------------------------------------------- //
  function tokenValues(code) {
    return scan(code).filter((t) => t.t !== "cm").map((t) => t.v);
  }
  function tokenDistance(a, b) {
    const A = tokenValues(a), B = tokenValues(b);
    const n = A.length, m = B.length;
    if (!n && !m) return { distance: 0, normalised: 0, a: 0, b: 0 };
    let prev = new Int32Array(m + 1), cur = new Int32Array(m + 1);
    for (let j = 0; j <= m; j++) prev[j] = j;
    for (let i = 1; i <= n; i++) {
      cur[0] = i;
      for (let j = 1; j <= m; j++) {
        const cost = A[i - 1] === B[j - 1] ? 0 : 1;
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      }
      const tmp = prev; prev = cur; cur = tmp;
    }
    const d = prev[m];
    return { distance: d, normalised: d / Math.max(n, m), a: n, b: m };
  }

  // ----------------------------------------------------------------------- //
  // Ladder runner. Mirrors ladderJS() in misc/04 (same per-rung seeds, so the
  // output matches the playground for the same seed and chain) and also
  // records which declared identifiers the rename step changed.
  // ----------------------------------------------------------------------- //
  const SKIP_KEYS = new Set(["type", "start", "end", "loc", "range", "raw"]);
  function collectIdentNodes(node, out) {
    if (node.type === "Identifier") out.push({ node: node, name: node.name });
    for (const k in node) {
      if (SKIP_KEYS.has(k)) continue;
      const v = node[k];
      if (Array.isArray(v)) v.forEach((c) => { if (c && typeof c.type === "string") collectIdentNodes(c, out); });
      else if (v && typeof v.type === "string") collectIdentNodes(v, out);
    }
    return out;
  }

  function runLadder(JSObf, source, specs, seed) {
    seed = seed || 0;
    let ast = JSObf._parse(source);
    const rungs = [{ name: "original", code: JSObf._generate(ast), spec: null }];
    let renameMap = null;
    specs.forEach((spec, i) => {
      const options = spec.options || {};
      const rng = makeRng(seed + ":" + i + ":" + spec.name);
      let before = null;
      if (spec.name === "rename_identifiers") before = collectIdentNodes(ast, []);
      JSObf.REGISTRY[spec.name].func(ast, rng, options);
      if (before) {
        renameMap = new Map();
        before.forEach((r) => { if (r.node.name !== r.name) renameMap.set(r.name, r.node.name); });
      }
      const code = JSObf._generate(ast);
      ast = JSObf._parse(code);
      const keys = Object.keys(options);
      let label = spec.name;
      if (keys.length) label = spec.name + " (" + keys.map((k) => k + "=" + options[k]).join(", ") + ")";
      rungs.push({ name: label, code: code, spec: spec });
    });
    return { rungs: rungs, renameMap: renameMap };
  }

  // ----------------------------------------------------------------------- //
  // Transform catalogue (names match the playground registry).
  // ----------------------------------------------------------------------- //
  const TRANSFORMS = [
    { name: "rename_identifiers", label: "Rename identifiers",
      desc: "Declared names become a1/b2, l/I/O lookalikes, or plausible wrong names." },
    { name: "control_flow_flatten", label: "Control-flow flatten",
      desc: "Each function body becomes a while loop with a state variable and if/else dispatch." },
    { name: "dead_code_insertion", label: "Dead-code insertion",
      desc: "Opaque always-false guards around junk, plus unused variables." },
    { name: "string_encoding", label: "String encoding",
      desc: "String literals become decode calls (base64 or XOR) through an injected helper." },
    { name: "expression_rewriting", label: "Expression rewriting",
      desc: "Small integers become arithmetic, n*2 becomes n<<1, tests get wrapped in !!." },
  ];

  // Build a deterministic chain of `count` transforms. `mustRename` forces the
  // rename step in (needed by questions about names).
  function chainFor(rng, count, mustRename) {
    const names = shuffle(rng, TRANSFORMS.map((t) => t.name));
    const chosen = names.slice(0, Math.max(1, Math.min(count, names.length)));
    if (mustRename && chosen.indexOf("rename_identifiers") < 0) chosen[chosen.length - 1] = "rename_identifiers";
    return chosen.map((name) => {
      const options = {};
      if (name === "rename_identifiers") {
        const r = rng();
        if (r < 0.45) { options.mode = "uninformative"; options.style = "sequential"; }
        else if (r < 0.7) { options.mode = "uninformative"; options.style = "lookalike"; }
        else { options.mode = "adversarial"; options.style = "sequential"; }
      } else if (name === "string_encoding") {
        options.method = rng() < 0.5 ? "base64" : "xor";
      } else if (name === "dead_code_insertion") {
        options.density = [0.3, 0.5, 0.7][Math.floor(rng() * 3)];
      }
      return { name: name, options: options };
    });
  }

  return {
    makeRng: makeRng, hashSeed: hashSeed, pick: pick, shuffle: shuffle,
    scan: scan, listFunctions: listFunctions, dedent: dedent, humanise: humanise,
    readability: readability, tokenDistance: tokenDistance, tokenValues: tokenValues,
    runLadder: runLadder, TRANSFORMS: TRANSFORMS, chainFor: chainFor, KEYWORDS: KEYWORDS,
  };
});
