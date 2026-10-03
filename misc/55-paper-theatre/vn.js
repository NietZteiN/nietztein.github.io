/*
 * Paper Theatre - story engine (pure logic, no DOM).
 *
 * parse  : .vn text -> program          (header directives, cast, facts, ops, labels)
 * lint   : program  -> issues           (fatal / warning taxonomy from ENGINE-DESIGN.md section 3 and 8)
 * walk   : program  -> report           (every branch reaches @end or @withheld; loops; unreachable labels)
 * blog   : markdown -> ops              (Tier B: a blog post read as narration, lists become menus)
 * interp : createRun(program)           (state machine, snapshots, deterministic replay)
 *
 * The same file runs in the browser (window.VN) and in Node (module.exports),
 * so test.js can parse and walk every story without a browser. The op shapes
 * are documented in OPS.md next to this file.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.VN = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ------------------------------------------------------------------ hash / rng */

  function fnv1a(str) {
    str = String(str == null ? '' : str);
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function hashHex(str) { return ('00000000' + fnv1a(str).toString(16)).slice(-8); }

  // mulberry32, as in misc/20-library-roguelike/engine.js
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function rng(seed) { return mulberry32(typeof seed === 'number' ? seed >>> 0 : fnv1a(seed)); }

  /* ------------------------------------------------------------------ constants */

  var FACES = ['neutral', 'smile', 'puzzled', 'worried', 'surprised', 'thinking', 'deadpan', 'laugh'];
  var BACKGROUNDS = ['lab', 'office', 'lecture', 'server', 'library', 'night', 'cafe', 'terminal', 'paper', 'train', 'garden', 'void',
    'sakura', 'classroom', 'rooftop', 'corridor', 'station', 'sea', 'room', 'studio', 'basement'];
  var BG_MODS = ['night', 'dawn', 'dim', 'dusk', 'noon'];
  var BG_OPTS = { board: ['plot', 'text', 'blank'] };          // @bg classroom board=text
  var CG_MODS = ['day', 'noon', 'dusk', 'dawn', 'night'];       // @cg two-chairs night | caption
  var HAIRTONES = ['dark', 'mid', 'light', 'fair'];
  var TRANSITIONS = ['fade', 'dissolve', 'white', 'wipe-left', 'wipe-right', 'iris', 'blinds', 'cut'];
  var DEFAULT_TRANSITION = { name: 'dissolve', ms: 600 };
  var FX = ['petals', 'snow', 'rain', 'dust', 'fireflies'];
  var FX_ONESHOT = ['shake', 'flash', 'pulse'];
  var CGS = ['tree', 'desk-night', 'screen-code', 'hands-keyboard', 'two-chairs', 'corridor-light', 'sea-of-points', 'page', 'window-rain'];
  var TONES = ['none', 'dusk', 'night', 'dawn', 'noon', 'memory', 'cold'];
  var DISTANCES = ['near', 'far'];
  var CLOTHES = ['coat', 'hoodie', 'cardigan', 'shirt', 'uniform'];
  var MODES = ['adv', 'nvl'];
  var PALETTES = { slate: 210, paper: 40, ink: 250, night: 230, ochre: 28, moss: 120 };
  var SLOTS = ['left', 'center', 'right'];
  var HAIR = ['short', 'long', 'bob', 'ponytail', 'bun', 'curly', 'none', 'hood'];
  var STATUSES = ['draft', 'embargo', 'published'];
  var BLOCKING = { say: 1, narrate: 1, menu: 1, scene: 1, chapter: 1, pause: 1, card: 1, chart: 1, code: 1, withheld: 1, read: 1, end: 1, error: 1 };
  var HEADER_ONLY = { title: 1, kind: 1, source: 1, cite: 1, arxiv: 1, link: 1, authors: 1, note: 1, status: 1, palette: 1, cast: 1, fact: 1, include: 1, verify: 1, file: 1 };
  var DEFAULT_NOTE = 'Dialogue is dramatized; coauthors did not say these lines. Figures marked § are quoted from the source.';
  var WITHHELD_TEXT = 'Results withheld until the paper is public.';
  var MAX_SNAPSHOTS = 500;
  var PUBLISH_BLOCKERS = { 'numeric-literal': 1, 'chip-in-branch': 1, 'coauthor-unchipped': 1, 'cite-missing': 1, 'no-chips': 1 };

  /* ------------------------------------------------------------------ small helpers */

  function issue(level, line, msg, hint, code, file) {
    var o = { level: level, line: line | 0, msg: (line > 0 ? 'line ' + (line | 0) + ': ' : '') + msg, hint: hint || '', code: code || '' };
    if (file) o.file = file;
    return o;
  }
  function trimEnd(s) { return s.replace(/\s+$/, ''); }
  function uniq(arr) {
    var out = [], seen = {};
    for (var i = 0; i < arr.length; i++) { var k = arr[i]; if (k != null && k !== '' && !seen[k]) { seen[k] = 1; out.push(k); } }
    return out;
  }
  function clone(x) {
    if (typeof structuredClone === 'function') { try { return structuredClone(x); } catch (e) { /* fall through */ } }
    return JSON.parse(JSON.stringify(x));
  }
  function parseNum(s) {
    if (s == null) return null;
    var m = /-?\d[\d,]*(?:\.\d+)?/.exec(String(s).replace(/−/g, '-'));
    if (!m) return null;
    var n = parseFloat(m[0].replace(/,/g, ''));
    return isFinite(n) ? n : null;
  }
  function numOrStr(s) {
    s = String(s).trim();
    if (/^-?\d+(?:\.\d+)?$/.test(s)) return parseFloat(s);
    if (/^"(.*)"$/.test(s) || /^'(.*)'$/.test(s)) return s.slice(1, -1);
    return s;
  }
  // Normalise input text: BOM, CRLF, tabs in the margin.
  function normalise(text) {
    text = String(text == null ? '' : text);
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    return text.split(/\r\n|\r|\n/);
  }
  // Join continuation lines (indented) onto the previous logical line.
  // Returns [{text, line}] with the 1-based line of the first physical line.
  function logicalLines(physical) {
    var out = [];
    for (var i = 0; i < physical.length; i++) {
      var raw = physical[i];
      var isCont = /^[ \t]+\S/.test(raw);
      if (isCont && out.length && !out[out.length - 1].blank) {
        out[out.length - 1].text += ' ' + raw.trim();
        continue;
      }
      var t = trimEnd(raw);
      if (!t.trim()) { out.push({ text: '', line: i + 1, blank: true }); continue; }
      out.push({ text: t.trim(), line: i + 1, blank: false });
    }
    return out.filter(function (l) { return !l.blank; });
  }

  /* ------------------------------------------------------------------ inline text */

  var CHIP_RE = /\s*\^(§[\w.\-:]+|p\.\s?[\w.\-]+|¶\d+|para)\s*$/;
  function splitChip(text) {
    var m = CHIP_RE.exec(text);
    if (!m) return { text: text, ref: null };
    return { text: text.slice(0, m.index).replace(/\s+$/, ''), ref: m[1].replace(/^p\.\s+/, 'p.') };
  }

  // {key}: facts first (chip attached), then cast display names; vars stay for render time.
  function interpolateFacts(text, facts, cast) {
    var chips = [];
    var out = String(text).replace(/\{([A-Za-z_][\w\-]*)\}/g, function (m, key) {
      var f = facts[key];
      if (f) { chips.push({ key: key, value: f.value, ref: f.ref }); return f.value; }
      var c = cast[key.toLowerCase()];
      if (c) return c.name;
      return m;
    });
    return { text: out, chips: chips };
  }

  function interpolate(text, vars, cast) {
    vars = vars || {}; cast = cast || {};
    return String(text == null ? '' : text).replace(/\{([A-Za-z_][\w\-]*)\}/g, function (m, key) {
      if (Object.prototype.hasOwnProperty.call(vars, key)) return String(vars[key]);
      var c = cast[key.toLowerCase()];
      if (c) return c.name;
      return m;
    });
  }

  // Inline markup tokens for the typewriter: *em*, `code`, plain text.
  function markup(text) {
    var out = [], buf = '', i = 0, s = String(text == null ? '' : text);
    function flush() { if (buf) { out.push({ type: 'text', text: buf }); buf = ''; } }
    while (i < s.length) {
      var ch = s[i];
      if (ch === '`') {
        var j = s.indexOf('`', i + 1);
        if (j > i + 1) { flush(); out.push({ type: 'code', text: s.slice(i + 1, j) }); i = j + 1; continue; }
      }
      if (ch === '*' && i + 1 < s.length && s[i + 1] !== ' ' && s[i + 1] !== '*') {
        var k = s.indexOf('*', i + 1);
        if (k > i + 1 && s[k - 1] !== ' ') { flush(); out.push({ type: 'em', text: s.slice(i + 1, k) }); i = k + 1; continue; }
      }
      buf += ch; i++;
    }
    flush();
    return out;
  }

  // A line wholly wrapped in ASCII or full-width parentheses is an inner thought.
  function isThought(text) {
    var t = String(text == null ? '' : text).trim();
    return t.length > 2 && ((t.charAt(0) === '(' && t.charAt(t.length - 1) === ')') || (t.charAt(0) === '\uff08' && t.charAt(t.length - 1) === '\uff09'));
  }

  function refsOf(op) {
    var r = [];
    if (op.ref) r.push(op.ref);
    if (op.chips) for (var i = 0; i < op.chips.length; i++) r.push(op.chips[i].ref);
    if (op.cells) for (var c = 0; c < op.cells.length; c++) if (op.cells[c].chips) for (var k = 0; k < op.cells[c].chips.length; k++) r.push(op.cells[c].chips[k].ref);
    if (op.series) for (var s = 0; s < op.series.length; s++) if (op.series[s].chips) for (var q = 0; q < op.series[s].chips.length; q++) r.push(op.series[s].chips[q].ref);
    return uniq(r);
  }
  function hasChip(op) { return refsOf(op).length > 0; }

  function describeRef(ref) {
    if (!ref) return '';
    if (ref === 'para') return 'paraphrase of the source';
    var m;
    if ((m = /^§(.+)$/.exec(ref))) return 'quoted from the source, section ' + m[1];
    if ((m = /^p\.(.+)$/.exec(ref))) return 'quoted from the source, page ' + m[1];
    if ((m = /^¶(\d+)$/.exec(ref))) return 'from the post, paragraph ' + m[1];
    return 'quoted from the source, ' + ref;
  }

  /* ------------------------------------------------------------------ parse */

  // Split a directive tail into tokens, honouring "double quotes".
  function tokens(s) {
    var out = [], re = /([^\s"]*)"([^"]*)"|(\S+)/g, m;
    while ((m = re.exec(s))) out.push(m[2] != null ? m[1] + m[2] : m[3]);
    return out;
  }

  function parseCastDecl(tail, line) {
    var toks = tokens(tail);
    if (!toks.length) return null;
    var decl = {
      id: toks[0], key: toks[0].toLowerCase(), name: toks[0],
      hue: fnv1a(toks[0].toLowerCase()) % 360, skin: 1 + fnv1a('skin:' + toks[0].toLowerCase()) % 5,
      hair: 'short', clothes: null, glasses: false, hat: false, lattice: null, player: false, page: false, coauthor: false,
      build: null, hairhue: null, line: line
    };
    var unknown = [];
    for (var i = 1; i < toks.length; i++) {
      var t = toks[i], kv = /^([a-z]+)=(.*)$/.exec(t);
      if (kv) {
        var k = kv[1], v = kv[2].replace(/^"|"$/g, '');
        if (k === 'name') decl.name = v;
        else if (k === 'hue') decl.hue = ((parseInt(v, 10) || 0) % 360 + 360) % 360;
        else if (k === 'skin') decl.skin = Math.min(5, Math.max(1, parseInt(v, 10) || 1));
        else if (k === 'hairhue') decl.hairhue = ((parseInt(v, 10) || 0) % 360 + 360) % 360;
        else if (k === 'hairtone' && HAIRTONES.indexOf(v) >= 0) decl.hairtone = v;
        else if (k === 'lattice') decl.lattice = v === 'dense' ? 'dense' : 'sparse';
        else unknown.push(t);
      } else if (HAIR.indexOf(t) >= 0) decl.hair = t;
      else if (CLOTHES.indexOf(t) >= 0) decl.clothes = t;
      else if (t === 'glasses') decl.glasses = true;
      else if (t === 'hat') decl.hat = true;
      else if (t === 'fem' || t === 'masc') decl.build = t;
      else if (t === 'player') decl.player = true;
      else if (t === 'page') decl.page = true;
      else if (t === 'coauthor') decl.coauthor = true;
      else if (t === 'lattice') decl.lattice = 'sparse';
      else unknown.push(t);
    }
    decl.unknown = unknown;
    return decl;
  }

  function parseCond(s) {
    s = s.trim();
    var m;
    if ((m = /^([A-Za-z_][\w\-]*)\s*(==|!=)(?!=)\s*([^=\s].*)$/.exec(s))) return { name: m[1], op: m[2], value: numOrStr(m[3]) };
    if ((m = /^!\s*([A-Za-z_][\w\-]*)$/.exec(s))) return { name: m[1], op: 'falsy', value: null };
    if ((m = /^([A-Za-z_][\w\-]*)$/.exec(s))) return { name: m[1], op: 'truthy', value: null };
    return null;
  }

  // Parse the @fact lines of an included file (one level deep, recursion capped).
  function collectFacts(text, facts, issues, file, opts, depth) {
    var lines = logicalLines(normalise(text));
    for (var i = 0; i < lines.length; i++) {
      var t = lines[i].text, ln = lines[i].line;
      if (t.charAt(0) === '#') continue;
      var m = /^@fact\s+(.+)$/.exec(t);
      if (m) { addFact(m[1], ln, facts, issues, file); continue; }
      var inc = /^@include\s+(\S+)/.exec(t);
      if (inc && depth < 4) resolveInclude(inc[1], facts, issues, opts, depth + 1, ln, file);
    }
  }
  function addFact(tail, ln, facts, issues, file) {
    var m = /^([A-Za-z_][\w\-]*)\s*=\s*(.*)$/.exec(tail);
    if (!m) { issues.push(issue('warn', ln, 'malformed @fact (expected "@fact key = value ^§ref")', 'write @fact n_humans = Fifty ^§3.2', 'fact-malformed', file)); return; }
    var sc = splitChip(m[2]);
    if (!sc.ref) issues.push(issue('warn', ln, "fact '" + m[1] + "' has no citation chip", 'end the fact with ^§n', 'fact-no-ref', file));
    facts[m[1]] = { key: m[1], value: sc.text, ref: sc.ref, line: ln, file: file || null };
  }
  function resolveInclude(path, facts, issues, opts, depth, ln, file) {
    var text = null;
    if (opts.includes && Object.prototype.hasOwnProperty.call(opts.includes, path)) text = opts.includes[path];
    else if (typeof opts.resolveInclude === 'function') { try { text = opts.resolveInclude(path); } catch (e) { text = null; } }
    if (text == null) { issues.push(issue('warn', ln, "include not found: '" + path + "'", 'paths are relative to stories/, e.g. @include _facts/obfuscation.vn', 'include-missing', file)); return; }
    collectFacts(text, facts, issues, path, opts, depth);
  }

  function parse(text, opts) {
    opts = opts || {};
    var lines = logicalLines(normalise(text));
    var issues = [];
    var meta = {
      title: null, kind: null, source: null, sourceKind: null, sourceRef: null, cite: null, arxiv: null,
      links: [], authors: null, note: DEFAULT_NOTE, status: 'draft', palette: { name: null, hue: 0 },
      verify: false, includes: [], file: null
    };
    var cast = {}, facts = {}, ops = [], labels = {}, menus = [], thumb = null, chapters = [];
    var i, t, ln, m;

    // Pass 1: header directives that later lines depend on (cast, facts, includes).
    for (i = 0; i < lines.length; i++) {
      t = lines[i].text; ln = lines[i].line;
      if (t.charAt(0) === '#') continue;
      if ((m = /^@cast\s+(.+)$/.exec(t))) {
        var decl = parseCastDecl(m[1], ln);
        if (!decl) { issues.push(issue('warn', ln, 'empty @cast', 'write @cast Name [hue=N] [glasses] ...', 'cast-malformed')); continue; }
        if (decl.unknown.length) issues.push(issue('warn', ln, "unknown @cast trait" + (decl.unknown.length > 1 ? 's' : '') + " '" + decl.unknown.join("', '") + "'", 'traits: name="..." hue=N hairhue=N skin=1-5 ' + HAIR.join('|') + ' ' + CLOTHES.join('|') + ' fem masc glasses hat lattice=sparse|dense player page coauthor', 'cast-trait-unknown'));
        delete decl.unknown;
        cast[decl.key] = decl;
      } else if ((m = /^@include\s+(\S+)/.exec(t))) {
        meta.includes.push(m[1]);
        resolveInclude(m[1], facts, issues, opts, 1, ln, null);
      }
    }
    for (i = 0; i < lines.length; i++) {
      t = lines[i].text; ln = lines[i].line;
      if ((m = /^@fact\s+(.+)$/.exec(t))) addFact(m[1], ln, facts, issues, null);
    }

    // Pass 2: everything, in order.
    var inBody = false, pendingMenu = null, paletteSet = false;
    function textOp(kind, body, ln) {
      var sc = splitChip(body);
      var ip = interpolateFacts(sc.text, facts, cast);
      var op = { kind: kind, text: ip.text, ref: sc.ref || (ip.chips.length ? ip.chips[0].ref : null), chips: ip.chips, line: ln };
      op.refs = refsOf(op);
      op.thought = isThought(ip.text);
      return op;
    }
    function cellOf(raw) {
      var sc = splitChip(raw.trim());
      var ip = interpolateFacts(sc.text, facts, cast);
      return { text: ip.text, chips: ip.chips, ref: sc.ref || (ip.chips.length ? ip.chips[0].ref : null) };
    }
    function closeMenu() { pendingMenu = null; }

    for (i = 0; i < lines.length; i++) {
      t = lines[i].text; ln = lines[i].line;
      if (t.charAt(0) === '#') continue;

      // choices
      if ((m = /^\*\s+(.*)$/.exec(t))) {
        var optText = m[1], once = false, cond = null, bad = false;
        for (;;) {
          var pm = /^\((once|if\s+[^)]*)\)\s*/.exec(optText);
          if (!pm) break;
          if (pm[1] === 'once') once = true;
          else { cond = parseCond(pm[1].replace(/^if\s+/, '')); if (!cond) { bad = true; } }
          optText = optText.slice(pm[0].length);
        }
        var arrow = /^(.*?)\s*->\s*(\S+)\s*$/.exec(optText);
        if (bad) issues.push(issue('fatal', ln, 'malformed option condition', 'use (if x == v), (if x != v), (if x) or (if !x)', 'option-malformed'));
        if (!arrow) { issues.push(issue('fatal', ln, 'choice without a target', 'end the option with -> label', 'option-no-target')); continue; }
        var opt = { text: interpolateFacts(arrow[1].trim(), facts, cast).text, target: arrow[2], once: once, cond: cond, line: ln };
        if (!pendingMenu) { pendingMenu = { kind: 'menu', options: [], line: ln }; menus.push(ops.length); ops.push(pendingMenu); }
        pendingMenu.options.push(opt);
        inBody = true;
        continue;
      }
      closeMenu();

      // section header
      if ((m = /^==\s*(\S+)\s*$/.exec(t))) {
        if (labels[m[1]] != null) issues.push(issue('warn', ln, "label '" + m[1] + "' declared twice", 'labels must be unique; the first one wins', 'label-duplicate'));
        else labels[m[1]] = ops.length;
        ops.push({ kind: 'label', name: m[1], line: ln });
        inBody = true;
        continue;
      }
      if (/^==/.test(t)) issues.push(issue('warn', ln, 'malformed section header; treated as narration', 'write "== label" with one word and no spaces', 'label-malformed'));
      // jump
      if ((m = /^->\s*(\S+)\s*$/.exec(t))) { ops.push({ kind: 'goto', target: m[1], line: ln }); inBody = true; continue; }

      // directives
      if (t.charAt(0) === '@') {
        var dm = /^@([a-z]+)\b\s*(.*)$/.exec(t);
        if (!dm) { issues.push(issue('warn', ln, "unknown directive '" + t.split(/\s/)[0] + "'", 'see stories/README.md for the directive list', 'directive-unknown')); continue; }
        var d = dm[1], tail = dm[2].trim();
        if (HEADER_ONLY[d] && inBody) issues.push(issue('warn', ln, '@' + d + ' after the first body line', 'header directives belong before the first spoken or narrated line', 'header-after-body'));
        switch (d) {
          case 'title': meta.title = tail || null; break;
          case 'kind':
            if (tail === 'paper' || tail === 'blog') meta.kind = tail;
            else issues.push(issue('fatal', ln, "@kind must be 'paper' or 'blog'" + (tail ? " (got '" + tail + "')" : ''), 'write @kind paper or @kind blog', 'kind-missing'));
            break;
          case 'source':
            meta.source = tail || null;
            if ((m = /^(paper|blog):\s*(.*)$/.exec(tail))) { meta.sourceKind = m[1]; meta.sourceRef = m[2].trim(); }
            else { meta.sourceKind = tail ? 'text' : null; meta.sourceRef = tail || null; }
            break;
          case 'cite': meta.cite = tail || null; break;
          case 'arxiv': meta.arxiv = tail.replace(/^arXiv:/i, '') || null; break;
          case 'link':
            var lt = /^(\S+)\s*(.*)$/.exec(tail);
            if (!lt) { issues.push(issue('warn', ln, '@link needs a url', '@link https://... Read the paper', 'link-malformed')); break; }
            if (meta.links.length >= 2) { issues.push(issue('warn', ln, 'more than two @link lines; extra link ignored', 'the end card shows at most two buttons', 'links-extra')); break; }
            meta.links.push({ url: lt[1], label: lt[2].trim() || (meta.kind === 'blog' ? 'Read the post' : 'Read the paper') });
            break;
          case 'authors': meta.authors = tail || null; break;
          case 'note': if (tail) meta.note = tail; break;
          case 'status':
            if (STATUSES.indexOf(tail) >= 0) meta.status = tail;
            else issues.push(issue('warn', ln, "unknown @status '" + tail + "'", 'draft | embargo | published (default draft)', 'status-unknown'));
            break;
          case 'palette':
            if ((m = /^hue\s*=\s*(-?\d+)$/.exec(tail))) { meta.palette = { name: null, hue: ((parseInt(m[1], 10) % 360) + 360) % 360 }; paletteSet = true; }
            else if (PALETTES.hasOwnProperty(tail)) { meta.palette = { name: tail, hue: PALETTES[tail] }; paletteSet = true; }
            else issues.push(issue('warn', ln, "unknown @palette '" + tail + "'", 'slate | paper | ink | night | ochre | moss | hue=N', 'palette-unknown'));
            break;
          case 'cast': case 'fact': case 'include': break; // pass 1
          case 'verify': meta.verify = true; break;
          case 'file': meta.file = tail || null; break;
          case 'thumb': thumb = ops.length; ops.push({ kind: 'thumb', line: ln }); break;
          case 'bg':
            var bt = tail.split(/\s+/).filter(Boolean);
            var bgop = { kind: 'bg', name: bt[0] || 'void', mod: null, line: ln };
            // after the name, in any order: one hour (night dawn dusk noon dim), `overcast`, `board=text`
            for (var bi = 1; bi < bt.length; bi++) {
              var bkv = /^([a-z]+)=([\w-]+)$/.exec(bt[bi]);
              if (BG_MODS.indexOf(bt[bi]) >= 0 && !bgop.mod) bgop.mod = bt[bi];
              else if (bt[bi] === 'overcast') (bgop.opts = bgop.opts || {}).overcast = true;
              else if (bkv && BG_OPTS[bkv[1]] && BG_OPTS[bkv[1]].indexOf(bkv[2]) >= 0) (bgop.opts = bgop.opts || {})[bkv[1]] = bkv[2];
              else issues.push(issue('warn', ln, "unknown background modifier '" + bt[bi] + "'", BG_MODS.join(' | ') + ' | overcast | board=plot|text|blank', 'bg-mod-unknown'));
            }
            if (BACKGROUNDS.indexOf(bgop.name) < 0) issues.push(issue('warn', ln, "unknown background '" + bgop.name + "'; using void", 'known backgrounds: ' + BACKGROUNDS.join(', '), 'bg-unknown'));
            ops.push(bgop); inBody = true;
            break;
          case 'show':
            var stoks = tail.split(/\s+/).filter(Boolean), sslot = null, sface = null, sdist = null, sbad = !stoks.length;
            for (var sti = 1; sti < stoks.length; sti++) {
              var stk = stoks[sti], sfm = /^\(([a-z]+)\)$/.exec(stk);
              if (sfm) sface = sfm[1];
              else if (SLOTS.indexOf(stk) >= 0) sslot = stk;
              else if (DISTANCES.indexOf(stk) >= 0) sdist = stk;
              else sbad = true;
            }
            var sm = sbad ? null : [tail, stoks[0], sslot, sface, null];
            if (!sm) { issues.push(issue('fatal', ln, 'malformed @show', '@show Name [left|center|right] [(face)] [near|far]', 'show-malformed')); break; }
            var who = sm[1], sdecl = cast[who.toLowerCase()];
            if (!sdecl) { issues.push(issue('fatal', ln, "@show of undeclared name '" + who + "'", 'add "@cast ' + who + '" to the header', 'show-undeclared')); break; }
            var face = sm[3] || null;
            if (face && FACES.indexOf(face) < 0) { issues.push(issue('warn', ln, "unknown face '" + face + "'; using neutral", 'faces: ' + FACES.join(', '), 'face-unknown')); face = 'neutral'; }
            ops.push({ kind: 'show', who: sdecl.id, key: sdecl.key, slot: sm[2] || sm[4] || null, face: face, dist: sdist, line: ln }); inBody = true;
            break;
          case 'hide':
            var hw = tail.split(/\s+/)[0] || 'all';
            if (hw === 'all') ops.push({ kind: 'hide', who: 'all', key: 'all', all: true, line: ln });
            else {
              var hdecl = cast[hw.toLowerCase()];
              if (!hdecl) issues.push(issue('warn', ln, "@hide of undeclared name '" + hw + "'", 'add "@cast ' + hw + '" to the header', 'hide-undeclared'));
              ops.push({ kind: 'hide', who: hdecl ? hdecl.id : hw, key: hw.toLowerCase(), all: false, line: ln });
            }
            inBody = true;
            break;
          case 'move': {
            var mvm = /^(\S+)\s+(\S+)\s*$/.exec(tail);
            if (!mvm) { issues.push(issue('fatal', ln, 'malformed @move', '@move Name left|center|right', 'move-malformed')); break; }
            var mdecl = cast[mvm[1].toLowerCase()];
            if (!mdecl) { issues.push(issue('fatal', ln, "@move of undeclared name '" + mvm[1] + "'", 'add "@cast ' + mvm[1] + '" to the header', 'show-undeclared')); break; }
            if (SLOTS.indexOf(mvm[2]) < 0) { issues.push(issue('warn', ln, "unknown slot '" + mvm[2] + "'; @move ignored", 'slots: ' + SLOTS.join(', '), 'slot-unknown')); break; }
            ops.push({ kind: 'move', who: mdecl.id, key: mdecl.key, slot: mvm[2], line: ln }); inBody = true;
            break;
          }
          case 'chapter': {
            var chm = /^(\S+)\s*(.*)$/.exec(tail);
            if (!chm) { issues.push(issue('warn', ln, 'empty @chapter', '@chapter 1 The Title', 'chapter-malformed')); break; }
            var chop2 = { kind: 'chapter', n: chm[1], title: interpolateFacts(chm[2].trim(), facts, cast).text, line: ln };
            chapters.push({ n: chop2.n, title: chop2.title, index: ops.length, line: ln });
            ops.push(chop2); inBody = true;
            break;
          }
          case 'transition': {
            var trt = tail.split(/\s+/).filter(Boolean);
            var trop = { kind: 'transition', name: trt[0] || DEFAULT_TRANSITION.name, ms: DEFAULT_TRANSITION.ms, line: ln };
            if (TRANSITIONS.indexOf(trop.name) < 0) {
              issues.push(issue('warn', ln, "unknown transition '" + trop.name + "'; using dissolve", 'transitions: ' + TRANSITIONS.join(', '), 'transition-unknown'));
              trop.name = DEFAULT_TRANSITION.name;
            }
            if (trt[1] != null) {
              if (/^\d+$/.test(trt[1])) trop.ms = Math.min(10000, parseInt(trt[1], 10));
              else issues.push(issue('warn', ln, "@transition duration must be milliseconds (got '" + trt[1] + "')", '@transition fade 800', 'transition-malformed'));
            }
            ops.push(trop); inBody = true;
            break;
          }
          case 'flashback': {
            var fbm = /^(on|off)\b\s*(.*)$/.exec(tail);
            if (!fbm) { issues.push(issue('warn', ln, 'malformed @flashback', '@flashback on [caption] | @flashback off', 'flashback-malformed')); break; }
            ops.push({ kind: 'flashback', on: fbm[1] === 'on', caption: fbm[1] === 'on' && fbm[2].trim() ? interpolateFacts(fbm[2].trim(), facts, cast).text : null, line: ln }); inBody = true;
            break;
          }
          case 'mode':
            if (MODES.indexOf(tail) < 0) { issues.push(issue('warn', ln, "unknown @mode '" + tail + "'", '@mode nvl | @mode adv', 'mode-unknown')); break; }
            ops.push({ kind: 'mode', mode: tail, line: ln }); inBody = true;
            break;
          case 'page': ops.push({ kind: 'page', line: ln }); inBody = true; break;
          case 'fx': {
            var fxt = tail.split(/\s+/).filter(Boolean), fxn = fxt[0] || '';
            if (fxn !== 'none' && FX.indexOf(fxn) < 0 && FX_ONESHOT.indexOf(fxn) < 0) {
              issues.push(issue('warn', ln, "unknown fx '" + fxn + "'; ignored", 'fx: ' + FX.join(', ') + ', none; one-shot: ' + FX_ONESHOT.join(', '), 'fx-unknown'));
              break;
            }
            var fxon = true;
            if (fxt[1] === 'off') fxon = false;
            else if (fxt[1] != null && fxt[1] !== 'on') issues.push(issue('warn', ln, "@fx takes on or off (got '" + fxt[1] + "')", '@fx petals on | @fx petals off', 'fx-malformed'));
            ops.push({ kind: 'fx', name: fxn, on: fxon, oneshot: FX_ONESHOT.indexOf(fxn) >= 0, line: ln }); inBody = true;
            break;
          }
          case 'cg': {
            var cgp = tail.split('|'), cgh = (cgp[0] || '').trim().split(/\s+/).filter(Boolean), cgn = cgh[0] || '';
            if (!cgn) { issues.push(issue('warn', ln, 'empty @cg', '@cg name [| caption] | @cg off', 'cg-malformed')); break; }
            if (cgn === 'off') { ops.push({ kind: 'cg', name: null, caption: null, line: ln }); inBody = true; break; }
            if (CGS.indexOf(cgn) < 0) issues.push(issue('warn', ln, "unknown cg '" + cgn + "'; using an abstract fallback", 'known CGs: ' + CGS.join(', '), 'cg-unknown'));
            var cgc = cgp.slice(1).join('|').trim();
            var cgop = { kind: 'cg', name: cgn, caption: cgc ? interpolateFacts(cgc, facts, cast).text : null, line: ln };
            // after the name: an hour (day dusk dawn night), `overcast`, `text=identifier` (screen-code)
            for (var ci = 1; ci < cgh.length; ci++) {
              var ckv = /^text=([\w$.]{1,28})$/.exec(cgh[ci]);
              if (CG_MODS.indexOf(cgh[ci]) >= 0 && !cgop.mod) cgop.mod = cgh[ci] === 'noon' ? 'day' : cgh[ci];
              else if (cgh[ci] === 'overcast') (cgop.opts = cgop.opts || {}).overcast = true;
              else if (ckv) (cgop.opts = cgop.opts || {}).text = ckv[1];
              else issues.push(issue('warn', ln, "unknown cg modifier '" + cgh[ci] + "'", '@cg name [day|dusk|dawn|night] [overcast] [text=identifier] [| caption]', 'cg-malformed'));
            }
            ops.push(cgop); inBody = true;
            break;
          }
          case 'pause': {
            var pms = /^(\d+)?$/.exec(tail);
            if (!pms) issues.push(issue('warn', ln, "@pause takes milliseconds (got '" + tail + "')", '@pause 800', 'pause-malformed'));
            ops.push({ kind: 'pause', ms: pms && pms[1] ? Math.min(10000, parseInt(pms[1], 10)) : 800, line: ln }); inBody = true;
            break;
          }
          case 'tone': {
            var tn = tail || 'none';
            if (TONES.indexOf(tn) < 0) { issues.push(issue('warn', ln, "unknown tone '" + tn + "'; using none", 'tones: ' + TONES.join(', '), 'tone-unknown')); tn = 'none'; }
            ops.push({ kind: 'tone', name: tn, line: ln }); inBody = true;
            break;
          }
          case 'scene': ops.push({ kind: 'scene', title: interpolateFacts(tail, facts, cast).text, line: ln }); inBody = true; break;
          case 'card': {
            var parts = tail.split('|').map(function (s) { return s.trim(); });
            var cop = { kind: 'card', title: cellOf(parts[0] || '').text, cells: [], src: null, ref: null, chips: [], line: ln };
            for (var c = 1; c < parts.length; c++) {
              if (!parts[c]) continue;
              var cc = cellOf(parts[c]), lv = /^([^:]{1,24}):\s+(.+)$/.exec(cc.text);
              cop.cells.push({ label: lv ? lv[1].trim() : null, value: lv ? lv[2].trim() : cc.text, chips: cc.chips, ref: cc.ref });
            }
            // a trailing chip on the last cell counts for the whole card
            var lastc = cop.cells[cop.cells.length - 1];
            if (lastc && lastc.ref && !lastc.chips.length) cop.ref = lastc.ref;
            cop.refs = refsOf(cop);
            ops.push(cop); inBody = true;
            break;
          }
          case 'chart': {
            var cparts = tail.split('|').map(function (s) { return s.trim(); });
            var head = /^(bar|range)\s*(.*)$/.exec(cparts[0] || '');
            if (!head) { issues.push(issue('warn', ln, "@chart needs a type: bar or range", '@chart bar Title | label=value | ...', 'chart-malformed')); break; }
            var unit = null;
            var chop = { kind: 'chart', type: head[1], title: head[2].trim(), unit: null, series: [], ref: null, chips: [], line: ln };
            for (var s = 1; s < cparts.length; s++) {
              var seg = cparts[s];
              var um = /\s*\bunit=(\S+)\s*/.exec(seg);
              if (um) { unit = um[1]; seg = seg.replace(um[0], ' ').trim(); }
              if (!seg) continue;
              var sc2 = splitChip(seg);
              var eq = sc2.text.indexOf('=');
              var label = eq >= 0 ? sc2.text.slice(0, eq).trim() : sc2.text.trim();
              var rawv = eq >= 0 ? sc2.text.slice(eq + 1).trim() : '';
              var ser = { label: interpolateFacts(label, facts, cast).text, value: null, num: null, lo: null, hi: null, loNum: null, hiNum: null, chips: [], ref: sc2.ref, raw: rawv };
              var rangeSplit = rawv.split('..');
              if (chop.type === 'range' && rangeSplit.length >= 2) {
                var lo = interpolateFacts(rangeSplit[0].trim(), facts, cast), hi = interpolateFacts(rangeSplit.slice(1).join('..').trim(), facts, cast);
                ser.lo = lo.text; ser.hi = hi.text; ser.loNum = parseNum(lo.text); ser.hiNum = parseNum(hi.text);
                ser.chips = lo.chips.concat(hi.chips);
              } else {
                var vv = interpolateFacts(rawv, facts, cast);
                ser.value = vv.text; ser.num = parseNum(vv.text); ser.chips = vv.chips;
              }
              if (!ser.ref && ser.chips.length) ser.ref = ser.chips[0].ref;
              chop.series.push(ser);
            }
            chop.unit = unit;
            // a trailing chip on the last segment with no value of its own is the chart's chip
            var tailm = CHIP_RE.exec(tail);
            if (tailm) chop.ref = tailm[1];
            chop.refs = refsOf(chop);
            ops.push(chop); inBody = true;
            break;
          }
          case 'code': {
            var kparts = tail.split('|');
            ops.push({ kind: 'code', lang: (kparts[0] || '').trim() || 'text', lines: kparts.slice(1).map(function (s) { return s.replace(/^ /, '').replace(/\s+$/, ''); }), line: ln });
            inBody = true;
            break;
          }
          case 'set': {
            var st = /^([A-Za-z_][\w\-]*)\s*=\s*(.*)$/.exec(tail) || /^([A-Za-z_][\w\-]*)\s+(\S.*)$/.exec(tail);
            if (!st) { issues.push(issue('warn', ln, 'malformed @set', '@set x = value', 'set-malformed')); break; }
            ops.push({ kind: 'set', name: st[1], value: numOrStr(st[2]), line: ln }); inBody = true;
            break;
          }
          case 'add': {
            var at = /^([A-Za-z_][\w\-]*)\s*=?\s*(-?\d+(?:\.\d+)?)?\s*$/.exec(tail);
            if (!at) { issues.push(issue('warn', ln, 'malformed @add', '@add x 1', 'set-malformed')); break; }
            ops.push({ kind: 'add', name: at[1], value: at[2] != null ? parseFloat(at[2]) : 1, line: ln }); inBody = true;
            break;
          }
          case 'if': {
            var im = /^(.*?)\s*->\s*(\S+)\s*$/.exec(tail);
            var icond = im ? parseCond(im[1]) : null;
            if (!im || !icond) { issues.push(issue('fatal', ln, 'malformed @if', '@if x == v -> label | @if x != v -> label | @if x -> label | @if !x -> label', 'if-malformed')); break; }
            ops.push({ kind: 'if', cond: icond, target: im[2], line: ln }); inBody = true;
            break;
          }
          case 'withheld': ops.push({ kind: 'withheld', text: tail || WITHHELD_TEXT, line: ln }); inBody = true; break;
          case 'read': {
            var rm = /^(post)?\s*(?:max\s*=\s*(\d+))?\s*$/.exec(tail);
            if (!rm) { issues.push(issue('warn', ln, 'malformed @read', '@read post [max=N]', 'read-malformed')); break; }
            ops.push({ kind: 'read', what: 'post', max: rm[2] ? parseInt(rm[2], 10) : 24, line: ln }); inBody = true;
            break;
          }
          case 'end': ops.push({ kind: 'end', implicit: false, line: ln }); inBody = true; break;
          default:
            issues.push(issue('warn', ln, "unknown directive '@" + d + "'", 'see stories/README.md for the directive list', 'directive-unknown'));
        }
        continue;
      }

      // speaker line or narration
      var sp = /^([A-Za-zÀ-ɏ][\wÀ-ɏ'.\-]*(?:\s+[A-Za-zÀ-ɏ][\wÀ-ɏ'.\-]*){0,2})\s*(?:\(([a-z]+)\))?:\s+(.*)$/.exec(t);
      if (sp && !/^https?$/i.test(sp[1])) {
        var cd = cast[sp[1].toLowerCase()];
        if (cd) {
          var sop = textOp('say', sp[3], ln);
          sop.who = cd.id; sop.key = cd.key; sop.face = sp[2] || null;
          if (sop.face && FACES.indexOf(sop.face) < 0) { issues.push(issue('warn', ln, "unknown face '" + sop.face + "'; using neutral", 'faces: ' + FACES.join(', '), 'face-unknown')); sop.face = 'neutral'; }
          ops.push(sop); inBody = true;
          continue;
        }
        // "Nearly three: the rain..." is prose. Only a single capitalised word before the colon looks
        // like a forgotten @cast, and only that is worth a loud warning.
        if (/^[A-Z][\wÀ-ɏ'.\-]*$/.test(sp[1])) issues.push(issue('warn', ln, "'" + sp[1] + "' is not in @cast; treated as narration", 'add "@cast ' + sp[1] + '" to the header or remove the colon', 'speaker-undeclared'));
      }
      ops.push(textOp('narrate', t, ln)); inBody = true;
    }

    var last = ops[ops.length - 1];
    if (!last || last.kind !== 'end') ops.push({ kind: 'end', implicit: true, line: lines.length ? lines[lines.length - 1].line + 1 : 1 });

    if (!meta.kind) issues.push(issue('fatal', 0, '@kind missing', 'write @kind paper or @kind blog in the header', 'kind-missing'));
    if (!meta.title) issues.push(issue('warn', 0, '@title missing', 'write @title ... in the header', 'title-missing'));
    if (!paletteSet) meta.palette = { name: null, hue: fnv1a(opts.id || meta.title || '') % 360 };
    for (var mi = 0; mi < menus.length; mi++) {
      var mop = ops[menus[mi]];
      mop.key = hashHex(mop.options.map(function (o) { return o.text + '>' + o.target; }).join('|'));
    }

    return {
      id: opts.id || null, hash: hashHex(text), meta: meta, cast: cast, facts: facts, ops: ops,
      labels: labels, menus: menus, thumb: thumb, chapters: chapters, issues: issues
    };
  }

  /* ------------------------------------------------------------------ flow helpers */

  function resolveTarget(program, target) {
    if (target === 'end') return program.ops.length - 1; // the last op is always `end`
    if (Object.prototype.hasOwnProperty.call(program.labels, target)) return program.labels[target];
    return -1;
  }
  // Successor op indices ignoring state (for reachability).
  function successors(program, i) {
    var op = program.ops[i], n = program.ops.length;
    if (!op) return [];
    switch (op.kind) {
      case 'end': return [];
      case 'goto': { var g = resolveTarget(program, op.target); return g < 0 ? [] : [g]; }
      case 'if': { var t = resolveTarget(program, op.target); var out = []; if (t >= 0) out.push(t); if (i + 1 < n) out.push(i + 1); return out; }
      case 'menu': return op.options.map(function (o) { return resolveTarget(program, o.target); }).filter(function (x) { return x >= 0; });
      default: return i + 1 < n ? [i + 1] : [];
    }
  }
  function reachableFrom(program, starts) {
    var seen = {}, stack = starts.slice();
    while (stack.length) {
      var i = stack.pop();
      if (i < 0 || seen[i]) continue;
      seen[i] = 1;
      var s = successors(program, i);
      for (var k = 0; k < s.length; k++) stack.push(s[k]);
    }
    return seen;
  }

  /* ------------------------------------------------------------------ lint */

  var NUM_RE = /%|ρ|\brho\b|\bp\s*[<>=]|(?<![\w.\-])\d{2,}(?![\w.]*[A-Za-z])/;
  function hasNumericLiteral(text) {
    var s = String(text).replace(/`[^`]*`/g, '');
    var m = NUM_RE.exec(s);
    return m ? m[0] : null;
  }
  function numericSnippet(text) {
    var s = String(text).replace(/`[^`]*`/g, '');
    var m = /\S*(?:%|ρ|rho|\bp\s*[<>=]\s*\S+|\d{2,}[\d.,]*%?)\S*/.exec(s);
    return m ? m[0].trim() : s.slice(0, 24);
  }

  function lint(program, opts) {
    opts = opts || {};
    var kind = opts.kind || program.meta.kind;
    var issues = program.issues.slice();
    var ops = program.ops, i, op;
    var paper = kind === 'paper';

    // header requirements
    if (paper && !program.meta.cite && program.meta.status !== 'draft') issues.push(issue('warn', 0, '@cite missing', 'paper stories need @cite before they leave draft', 'cite-missing'));

    // jumps
    function checkJump(target, line) {
      if (resolveTarget(program, target) < 0) issues.push(issue('fatal', line, "jump to unknown label '" + target + "'", 'declare it with "== ' + target + '" or fix the spelling', 'unknown-jump'));
    }
    for (i = 0; i < ops.length; i++) {
      op = ops[i];
      if (op.kind === 'goto' || op.kind === 'if') checkJump(op.target, op.line);
      else if (op.kind === 'menu') {
        if (!op.options.length) issues.push(issue('warn', op.line, 'menu with no options', 'add at least one "* text -> label" line', 'menu-empty'));
        for (var o = 0; o < op.options.length; o++) checkJump(op.options[o].target, op.options[o].line);
      }
    }

    // placeholders never set
    var setNames = {};
    for (i = 0; i < ops.length; i++) if (ops[i].kind === 'set' || ops[i].kind === 'add') setNames[ops[i].name] = 1;
    for (i = 0; i < ops.length; i++) {
      op = ops[i];
      var txt = op.kind === 'say' || op.kind === 'narrate' ? op.text : (op.kind === 'scene' || op.kind === 'chapter') ? op.title : null;
      if (txt == null) continue;
      var re = /\{([A-Za-z_][\w\-]*)\}/g, pm;
      while ((pm = re.exec(txt))) {
        if (!setNames[pm[1]] && !program.facts[pm[1]] && !program.cast[pm[1].toLowerCase()]) issues.push(issue('warn', op.line, "'{" + pm[1] + "}' is neither a fact, a variable nor a cast name", 'declare "@fact ' + pm[1] + ' = ..." or "@set ' + pm[1] + ' = ..."', 'placeholder-unknown'));
      }
    }

    // chip-in-branch: ops reachable from some but not all branches of a menu / @if
    var branchOnly = {};
    for (i = 0; i < ops.length; i++) {
      op = ops[i];
      var starts = null;
      if (op.kind === 'menu' && op.options.length > 1) starts = op.options.map(function (x) { return resolveTarget(program, x.target); });
      else if (op.kind === 'if') starts = [resolveTarget(program, op.target), i + 1];
      if (!starts) continue;
      var sets = starts.map(function (s) { return reachableFrom(program, [s]); });
      var union = {};
      sets.forEach(function (st) { Object.keys(st).forEach(function (k) { union[k] = 1; }); });
      Object.keys(union).forEach(function (k) {
        var inAll = sets.every(function (st) { return st[k]; });
        // A hub spoke (a section that returns to its own menu, e.g. a (once)
        // list) is not a branch: every option is visitable, so its chips are
        // not choice-dependent. Only sections that never come back are.
        if (!inAll && !(op.kind === 'menu' && reachableFrom(program, [+k])[i])) branchOnly[k] = 1;
      });
    }

    var chipCount = 0;
    for (i = 0; i < ops.length; i++) {
      op = ops[i];
      var chipped = (op.kind === 'say' || op.kind === 'narrate' || op.kind === 'card' || op.kind === 'chart') && hasChip(op);
      if (chipped) chipCount++;
      if (chipped && branchOnly[i]) issues.push(issue('warn', op.line, 'chipped figure inside a choice-dependent branch', 'choices change reactions, never reported figures', 'chip-in-branch'));
      if (op.kind === 'say' || op.kind === 'narrate') {
        if (paper && !chipped) {
          // a number inside a declared cast name ("Participant 23") is a name, not a figure
          var bare = op.text;
          for (var ck in program.cast) {
            var cn = program.cast[ck];
            if (/\d/.test(cn.name)) bare = bare.split(cn.name).join(' ');
            if (/\d/.test(cn.id)) bare = bare.split(cn.id).join(' ');
          }
          var lit = hasNumericLiteral(bare);
          if (lit) issues.push(issue('warn', op.line, 'figure without a citation chip: "' + numericSnippet(bare) + '"', 'use a {fact} or end the line with ^§n', 'numeric-literal'));
        }
        if (op.kind === 'say') {
          var cd = program.cast[op.key];
          if (cd && cd.coauthor && !(op.ref && (/^§|^p\./.test(op.ref) || op.ref === 'para'))) issues.push(issue('warn', op.line, "coauthor '" + cd.id + "' speaks without ^§n or ^para", 'coauthor lines must quote (^§n) or paraphrase (^para) the source', 'coauthor-unchipped'));
        }
      }
      if (op.kind === 'chart' && !op.ref) {
        for (var s = 0; s < op.series.length; s++) if (!op.series[s].chips.length && !op.series[s].ref) issues.push(issue('warn', op.line, "chart value '" + op.series[s].label + "' is neither a {fact} nor chipped", 'use {fact} values or end the chart line with ^§n', 'chart-literal'));
      }
    }
    if (paper && chipCount === 0 && program.meta.status !== 'draft') issues.push(issue('warn', 0, 'no citation chips in a paper story', 'quote figures with {fact} or ^§n', 'no-chips'));

    // de-duplicate and sort
    var seenKeys = {}, out = [];
    for (i = 0; i < issues.length; i++) { var k = issues[i].level + '|' + issues[i].line + '|' + issues[i].msg; if (!seenKeys[k]) { seenKeys[k] = 1; out.push(issues[i]); } }
    out.sort(function (a, b) { return (a.line - b.line) || (a.level === b.level ? 0 : a.level === 'fatal' ? -1 : 1); });
    return out;
  }

  function publishBlockers(issues) {
    return issues.filter(function (x) { return x.level === 'fatal' || PUBLISH_BLOCKERS[x.code]; });
  }

  /* ------------------------------------------------------------------ conditions / vars */

  function evalCond(cond, vars) {
    if (!cond) return false;
    var v = Object.prototype.hasOwnProperty.call(vars, cond.name) ? vars[cond.name] : undefined;
    switch (cond.op) {
      case '==': return String(v) === String(cond.value);
      case '!=': return String(v) !== String(cond.value);
      case 'truthy': return !!v && v !== '0' && v !== 'false';
      case 'falsy': return !v || v === '0' || v === 'false';
    }
    return false;
  }
  function optionVisible(opt, menuIndex, optIndex, state) {
    if (opt.once && state.chosen[menuIndex + ':' + optIndex]) return false;
    if (opt.cond && !evalCond(opt.cond, state.vars)) return false;
    return true;
  }

  /* ------------------------------------------------------------------ walk */

  function walk(program, opts) {
    opts = opts || {};
    var maxSteps = opts.maxSteps || 20000;
    var ops = program.ops, n = ops.length;
    var steps = 0, paths = 0, endings = { end: 0, withheld: 0 }, loops = [], capped = false;
    var visitedLabels = {}, exploredKeys = {};
    var issues = [];

    // state: pc, vars, chosen; a path is a sequence of such states.
    // The memo key counts the (once) options already taken per menu instead of
    // naming them: option visibility depends only on vars and on that menu's own
    // once-state, so every option is still explored at least once (option j at
    // depth <= j) while a hub of n options costs O(n^2) visits instead of 2^n.
    // Only menus still reachable from pc matter: a finished hub's once-state can
    // never change visibility again, so sequential hubs do not multiply states.
    var reachableMenus = {};
    function menusFrom(pc) {
      if (!reachableMenus[pc]) {
        var seen = reachableFrom(program, [pc]), set = {};
        for (var i = 0; i < program.menus.length; i++) if (seen[program.menus[i]]) set[program.menus[i]] = 1;
        reachableMenus[pc] = set;
      }
      return reachableMenus[pc];
    }
    function chosenKey(pc, chosen) {
      var counts = {}, live = menusFrom(pc);
      for (var k in chosen) { var mi = k.split(':')[0]; if (live[mi]) counts[mi] = (counts[mi] || 0) + 1; }
      return Object.keys(counts).sort().map(function (k) { return k + '=' + counts[k]; }).join(',');
    }
    function keyOf(pc, vars, chosen) { return pc + '|' + JSON.stringify(vars) + '|' + chosenKey(pc, chosen); }

    function run(pc, vars, chosen, onPath) {
      for (;;) {
        if (++steps > maxSteps) { capped = true; return; }
        if (pc < 0 || pc >= n) { endings.end++; paths++; return; }
        var op = ops[pc];
        var k = keyOf(pc, vars, chosen);
        if (onPath[k]) { loops.push({ line: op.line, msg: 'infinite loop through line ' + op.line }); return; }
        if (op.kind === 'menu' || op.kind === 'if' || op.kind === 'goto' || op.kind === 'label') {
          if (exploredKeys[k]) { paths++; return; } // merged with an already-explored continuation
          exploredKeys[k] = 1;
        }
        onPath[k] = 1;
        switch (op.kind) {
          case 'end': endings.end++; paths++; return;
          case 'withheld': endings.withheld++; // then continue to the end card
            pc++; break;
          case 'label': visitedLabels[op.name] = 1; pc++; break;
          case 'goto': { var g = resolveTarget(program, op.target); if (g < 0) return; pc = g; break; }
          case 'set': vars = clone(vars); vars[op.name] = op.value; pc++; break;
          case 'add': vars = clone(vars); vars[op.name] = (parseFloat(vars[op.name]) || 0) + op.value; pc++; break;
          case 'if': {
            var t = resolveTarget(program, op.target);
            if (evalCond(op.cond, vars)) { if (t < 0) return; pc = t; } else pc++;
            break;
          }
          case 'menu': {
            var any = false;
            for (var o = 0; o < op.options.length; o++) {
              var opt = op.options[o];
              if (!optionVisible(opt, pc, o, { vars: vars, chosen: chosen })) continue;
              any = true;
              var tg = resolveTarget(program, opt.target);
              if (tg < 0) continue;
              var chosen2 = clone(chosen); if (opt.once) chosen2[pc + ':' + o] = true;
              var onPath2 = {}; for (var pk in onPath) onPath2[pk] = 1;
              run(tg, vars, chosen2, onPath2);
              if (capped) return;
            }
            if (!any) issues.push(issue('warn', op.line, 'a path reaches this menu with no visible option', 'add an option without (once)/(if), or an exit', 'menu-empty'));
            return;
          }
          default: pc++;
        }
      }
    }
    run(0, {}, {}, {});

    var unreachable = Object.keys(program.labels).filter(function (l) { return !visitedLabels[l]; });
    unreachable.forEach(function (l) { issues.push(issue('warn', ops[program.labels[l]].line, "label '" + l + "' is unreachable", 'nothing jumps or falls through to it', 'unreachable-label')); });
    var seenLoop = {};
    loops.forEach(function (l) { if (!seenLoop[l.line]) { seenLoop[l.line] = 1; issues.push(issue('warn', l.line, l.msg, 'a path returns to the same state; add (once) or an exit option', 'walk-loop')); } });
    if (capped) issues.push(issue('warn', 0, 'walk stopped after ' + maxSteps + ' steps', 'the branch graph is too large or loops; add (once)/exits', 'walk-cap'));
    return { ok: issues.length === 0, paths: paths, endings: endings, unreachable: unreachable, loops: loops, steps: steps, issues: issues };
  }

  /* ------------------------------------------------------------------ blog segmenter */

  function decodeEntities(s) {
    return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
  }
  // Port of misc/42-blog-phonograph/app.js stripMarkdown, applied to one block's text
  // (links, emphasis, inline code, entities). Math spans are protected first.
  function protectMath(s, store) {
    return s.replace(/\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|\$[^$\n]+?\$/g, function (m) {
      store.push(m); return '\u0001' + (store.length - 1) + '\u0001';
    });
  }
  function restoreMath(s, store) {
    return s.replace(/\u0001(\d+)\u0001/g, function (m, i) { return store[+i]; });
  }
  function stripInline(s) {
    var math = [];
    s = protectMath(s, math);
    s = s.replace(/<[^>\n]+>/g, '');
    s = s.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1');
    s = s.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
    s = s.replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1');
    s = s.replace(/`([^`\n]*)`/g, '$1');
    s = s.replace(/(\*\*|__)([\s\S]*?)\1/g, '$2');
    s = s.replace(/(^|[^\w*])\*([^*\n]+)\*/g, '$1$2');
    s = s.replace(/(^|[^\w_])_([^_\n]+)_(?!\w)/g, '$1$2');
    s = s.replace(/~~([^~]*)~~/g, '$1');
    s = decodeEntities(s);
    s = s.replace(/[*_#]{2,}/g, '').replace(/\s+/g, ' ').trim();
    return restoreMath(s, math);
  }
  function stripFrontMatter(md) {
    var s = md.replace(/\r/g, '');
    if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1);
    if (s.slice(0, 3) === '---') {
      var m = s.indexOf('\n---', 3);
      if (m > 0) { var nl = s.indexOf('\n', m + 1); s = nl < 0 ? '' : s.slice(nl + 1); }
    }
    return s;
  }
  function optionLabel(text, limit) {
    var t = text.replace(/\u0001\d+\u0001/g, '').trim();
    var head = t, re = /[.!?:](\s|$)/g, m;
    while ((m = re.exec(t))) {
      if (m.index < 3) continue;
      var before = t.slice(Math.max(0, m.index - 4), m.index);
      if (m[0].charAt(0) === '.' && /(^|\s)(vs|e\.g|i\.e|etc|cf|al|[A-Z])$/.test(before)) continue;
      head = t.slice(0, m.index + 1); break;
    }
    head = head.replace(/[.:]$/, '');
    if (head.length > limit) { var cut = head.lastIndexOf(' ', limit - 1); head = head.slice(0, cut > limit / 2 ? cut : limit - 1).replace(/[,;:\s]+$/, '') + '…'; }
    return head;
  }

  // Cut a long paragraph into window-sized pieces at sentence ends (never inside $math$), so that an
  // auto-read stop fits the text window instead of scrolling inside it.
  var CHUNK = 300;
  function splitSentences(text) {
    var out = [], re = /[.!?\u2026]["\u201d\u2019)\]]*\s+(?=["\u201c\u2018(\[]?[A-Z0-9$])/g, last = 0, m;
    while ((m = re.exec(text))) {
      var end = m.index + m[0].length, head = text.slice(last, end);
      var before = text.slice(Math.max(0, m.index - 5), m.index);
      if (m[0].charAt(0) === '.' && /(^|[\s(])(vs|e\.g|i\.e|etc|cf|al|Fig|No|pp?|[A-Z])$/.test(before)) continue;   // abbreviations, initials
      if ((head.split('$').length - 1) % 2) continue;                                                              // inside math
      out.push(head.replace(/\s+$/, '')); last = end;
    }
    if (last < text.length) out.push(text.slice(last));
    return out;
  }
  function chunkText(text, limit) {
    limit = limit || CHUNK;
    if (text.length <= limit * 1.25) return [text];
    var parts = [];
    splitSentences(text).forEach(function (sn) {
      // a single sentence longer than the window: break at a clause, else at a space
      while (sn.length > limit * 1.25 && sn.indexOf('$') < 0) {
        var cut = Math.max(sn.lastIndexOf('; ', limit), sn.lastIndexOf(': ', limit), sn.lastIndexOf(', ', limit));
        if (cut < limit * 0.4) cut = sn.lastIndexOf(' ', limit) - 1;
        if (cut < limit * 0.4) break;
        parts.push(sn.slice(0, cut + 1)); sn = sn.slice(cut + 2);
      }
      parts.push(sn);
    });
    var out = [], cur = '';
    parts.forEach(function (pt) {
      if (cur && (cur + ' ' + pt).length > limit) { out.push(cur); cur = pt; }
      else cur = cur ? cur + ' ' + pt : pt;
    });
    if (cur) out.push(cur);
    // do not leave a few words alone on the last stop
    if (out.length > 1 && out[out.length - 1].length < 40 && (out[out.length - 2] + out[out.length - 1]).length < limit * 1.25) { var tail = out.pop(); out[out.length - 1] += ' ' + tail; }
    return out;
  }

  function blog(markdown, meta, opts) {
    opts = opts || {}; meta = meta || {};
    var max = opts.max || 24;
    var who = opts.who || 'Page', key = who.toLowerCase();
    var s = stripFrontMatter(String(markdown == null ? '' : markdown));
    s = s.replace(/<!--[\s\S]*?-->/g, '');
    s = s.replace(/```[\s\S]*?```/g, '');
    s = s.replace(/^[ \t]*\[[^\]]+\]:[ \t]*\S+.*$/gm, '');
    s = s.replace(/^[ \t]*([-*_])([ \t]*\1){2,}[ \t]*$/gm, '');
    var normTitle = (meta.title || '').trim().toLowerCase();
    var rawBlocks = s.split(/\n[ \t]*\n+/), blocks = [];
    // loose lists: merge consecutive blocks that are list items or indented continuations
    for (var rb = 0; rb < rawBlocks.length; rb++) {
      var blk = rawBlocks[rb], prev = blocks[blocks.length - 1];
      if (prev && /^([-*+]|\d+[.)])\s+/.test(prev) && (/^([-*+]|\d+[.)])\s+/.test(blk) || /^[ \t]+\S/.test(blk))) blocks[blocks.length - 1] = prev + '\n' + blk;
      else blocks.push(blk);
    }
    var ops = [], blocking = 0, listNo = 0, truncated = false;
    function push(op) { op.line = 0; if (BLOCKING[op.kind]) blocking++; ops.push(op); }
    // one paragraph may become several stops (window-sized pieces); only the first counts toward `max`
    function narrate(text, para, more) {
      chunkText(text, opts.chunk).forEach(function (t, i) {
        var op = { kind: 'narrate', text: t, ref: para ? '¶' + para : null, chips: [], refs: para ? ['¶' + para] : [] };
        if (i || more) { op.cont = true; op.line = 0; ops.push(op); } else push(op);
      });
    }
    function say(text, para) { push({ kind: 'say', who: who, key: key, face: null, text: text, ref: para ? '¶' + para : null, chips: [], refs: para ? ['¶' + para] : [] }); }

    for (var b = 0; b < blocks.length; b++) {
      if (blocking >= max) { truncated = true; break; }
      var rawLines = blocks[b].split('\n').filter(function (l) { return l.trim(); });
      if (!rawLines.length) continue;
      var para = b + 1;
      var first = rawLines[0].trim();

      // heading
      if (/^#{1,6}\s/.test(first)) {
        var h = stripInline(first.replace(/^#{1,6}\s+/, '').replace(/\s+#+$/, ''));
        if (h && h.toLowerCase() !== normTitle) push({ kind: 'scene', title: h });
        var rest = rawLines.slice(1);
        if (rest.length) { var txt = stripInline(rest.join(' ')); if (txt) narrate(txt, para); }
        continue;
      }
      // image alone
      var im = /^!\[([^\]]*)\]\(([^)\s]+)[^)]*\)\s*$/.exec(first);
      if (im && rawLines.length === 1) {
        push({ kind: 'card', title: 'Figure', cells: [{ label: null, value: stripInline(im[1]) || '', chips: [], ref: null }], src: im[2], ref: null, chips: [], refs: [] });
        continue;
      }
      // blockquote
      if (/^>/.test(first)) {
        var q = stripInline(rawLines.map(function (l) { return l.replace(/^\s*>\s?/, ''); }).join(' '));
        if (q) say(q, para);
        continue;
      }
      // list
      if (/^([-*+]|\d+[.)])\s+/.test(first)) {
        var items = [];
        for (var li = 0; li < rawLines.length; li++) {
          var l = rawLines[li];
          var top = /^([-*+]|\d+[.)])\s+(.*)$/.exec(l);
          if (top && !/^\s/.test(l)) items.push([top[2]]);
          else if (items.length) items[items.length - 1].push(l.replace(/^\s*([-*+]|\d+[.)])\s+/, '').trim());
          else items.push([l.trim()]);
        }
        // each item is [its own text, nested item, nested item, ...]: the nested ones become stops of their own
        var parts = items.map(function (it) {
          return it.map(function (x) { return stripInline(x.replace(/^\[[ xX]\]\s*/, '')); }).filter(Boolean).map(function (x) { return /[.!?:;,)]$/.test(x) ? x : x + '.'; });
        }).filter(function (it) { return it.length; });
        var texts = parts.map(function (it) { return it[0]; });
        function section(it) { it.forEach(function (x, xi) { narrate(x, para, xi > 0); }); }
        if (!texts.length) continue;
        if (texts.length === 1) { section(parts[0]); continue; }
        listNo++;
        var hub = 'read_' + listNo, done = hub + '_done';
        var menu = { kind: 'menu', options: [] };
        for (var ti = 0; ti < texts.length; ti++) menu.options.push({ text: optionLabel(texts[ti], 60), target: hub + '_' + (ti + 1), once: true, cond: null, line: 0 });
        menu.options.push({ text: 'Continue', target: done, once: false, cond: null, line: 0 });
        push({ kind: 'label', name: hub });
        push(menu);
        for (var si = 0; si < texts.length; si++) {
          push({ kind: 'label', name: hub + '_' + (si + 1) });
          section(parts[si]);
          push({ kind: 'goto', target: hub });
        }
        push({ kind: 'label', name: done });
        continue;
      }
      // table
      if (/^\|/.test(first)) {
        var cells = rawLines.filter(function (l) { return !/^\|[\s:|-]+\|$/.test(l.trim()); }).map(function (l) {
          return l.trim().replace(/^\||\|$/g, '').split('|').map(function (c) { return stripInline(c); }).filter(Boolean).join(', ');
        }).filter(Boolean).join(' ');
        if (cells) narrate(cells, para);
        continue;
      }
      // epigraph: quoted first line, attribution line without terminal period
      if (b === 0 && rawLines.length === 2 && /^["“«]/.test(first) && !/[.!?]$/.test(rawLines[1].trim())) {
        say(stripInline(first), para);
        narrate(stripInline(rawLines[1]), para);
        continue;
      }
      var text = stripInline(rawLines.join(' '));
      if (text) narrate(text, para);
    }
    if (truncated) {
      var tail = { kind: 'narrate', text: 'The post continues' + (meta.title ? ' in "' + meta.title + '"' : '') + '.', ref: null, chips: [], refs: [], truncated: true };
      push(tail);
    }
    return ops;
  }

  // Replace every `read` op with blog ops; re-index labels, menus, thumb.
  function expand(program, markdown, meta, opts) {
    var out = clone(program);
    var ops = [], mapping = [];
    for (var i = 0; i < out.ops.length; i++) {
      var op = out.ops[i];
      mapping.push(ops.length);
      if (op.kind === 'read') {
        var extra = blog(markdown, meta || {}, Object.assign({ max: op.max }, opts || {}));
        for (var k = 0; k < extra.length; k++) ops.push(extra[k]);
      } else ops.push(op);
    }
    out.ops = ops;
    out.labels = {}; out.menus = []; out.thumb = null; out.chapters = [];
    for (var j = 0; j < ops.length; j++) {
      if (ops[j].kind === 'label' && out.labels[ops[j].name] == null) out.labels[ops[j].name] = j;
      else if (ops[j].kind === 'menu') out.menus.push(j);
      else if (ops[j].kind === 'thumb') out.thumb = j;
      else if (ops[j].kind === 'chapter') out.chapters.push({ n: ops[j].n, title: ops[j].title, index: j, line: ops[j].line });
    }
    if (!out.cast.page) {
      var pageKey = Object.keys(out.cast).filter(function (k) { return out.cast[k].page; })[0];
      if (!pageKey) out.cast.page = { id: 'Page', key: 'page', name: 'the page', hue: fnv1a('page') % 360, skin: 3, hair: 'none', clothes: null, glasses: false, hat: false, lattice: null, player: false, page: true, coauthor: false, line: 0 };
    }
    return out;
  }

  /* ------------------------------------------------------------------ interp */

  function createRun(program, opts) {
    opts = opts || {};
    var ops = program.ops, n = ops.length;
    var state = freshState();
    var stack = [];      // snapshots of {state, stop}
    var seen = {};
    (opts.seen || []).forEach(function (i) { seen[i] = 1; });
    var current = null;
    var trace = typeof opts.trace === 'function' ? opts.trace : null;   // trace(opIndex, state): every op about to run

    function freshState() {
      return {
        pc: 0, vars: {}, bg: null, slots: { left: null, center: null, right: null }, faces: {}, dist: {}, chosen: {}, history: [], choiceLog: [], label: null, stops: 0,
        cg: null, transition: null, change: null, flashback: null, mode: 'adv', pageStart: 0, fx: {}, oneshot: [], tone: 'none', chapter: null
      };
    }
    function errorStop(msg, hint, line) {
      current = { op: { kind: 'error', msg: msg, hint: hint || '', line: line | 0 }, index: state.pc, state: state, done: true };
      return current;
    }
    function visibleOptions(op, idx) {
      var out = [];
      for (var o = 0; o < op.options.length; o++) if (optionVisible(op.options[o], idx, o, state)) out.push({ index: o, text: op.options[o].text, target: op.options[o].target });
      return out;
    }
    function record(op, idx) {
      var h = { index: idx, kind: op.kind, who: op.who || null, text: op.text || op.title || '', refs: op.refs || [] };
      if (op.title) h.title = op.title;
      if (op.kind === 'chapter') h.n = op.n;
      if (op.thought) h.thought = true;
      if (state.mode === 'nvl') h.nvl = true;
      state.history.push(h);
    }
    function pushSnapshot() {
      stack.push({ state: clone(state), stop: current ? { index: current.index, done: current.done } : null });
      if (stack.length > MAX_SNAPSHOTS) stack.shift();
    }
    function stopAt(idx) {
      var op = ops[idx];
      state.pc = idx;
      state.stops++;
      seen[idx] = 1;
      if (op.kind === 'say' && op.face) state.faces[op.key] = op.face;
      if (op.kind === 'chapter') state.chapter = { n: op.n, title: op.title, index: idx };
      if (op.kind !== 'menu' && op.kind !== 'end' && op.kind !== 'pause') record(op, idx);
      current = { op: op, index: idx, state: state, done: op.kind === 'end' };
      if (op.kind === 'menu') {
        current.options = visibleOptions(op, idx);
        if (!current.options.length) return errorStop('menu with no visible option (line ' + op.line + ')', 'every path needs an option without (once)/(if), or an exit', op.line);
      }
      return current;
    }
    function jump(target, line) {
      var t = resolveTarget(program, target);
      if (t < 0) { errorStop("jump to unknown label '" + target + "' (line " + line + ')', 'declare it with "== ' + target + '"', line); return -1; }
      return t;
    }
    // The transition armed by @transition is consumed by the next bg / cg change. A @bg and a @cg between
    // the same two stops each keep their own: state.change = {bg?: {name, ms}, cg?: {name, ms}}.
    function takeTransition(what) {
      var t = state.transition || DEFAULT_TRANSITION;
      if (!state.change) state.change = {};
      state.change[what] = { name: t.name, ms: t.ms };
      state.transition = null;
    }
    // Non-blocking, non-jumping ops: everything that only dresses the stage.
    function applyOp(op, dressing) {
      switch (op.kind) {
        case 'bg': state.bg = { name: op.name, mod: op.mod }; if (op.opts) state.bg.opts = op.opts; takeTransition('bg'); break;
        case 'cg':
          state.cg = op.name ? { name: op.name, caption: op.caption } : null;
          if (state.cg && op.mod) state.cg.mod = op.mod;
          if (state.cg && op.opts) state.cg.opts = op.opts;
          takeTransition('cg'); break;
        case 'transition': state.transition = { name: op.name, ms: op.ms }; break;
        case 'show': {
          var slot = op.slot;
          var onStage = SLOTS.some(function (s) { return state.slots[s] === op.key; });
          // already on stage in another slot: move it
          SLOTS.forEach(function (s) { if (state.slots[s] === op.key && slot && s !== slot) state.slots[s] = null; });
          if (!slot) { slot = SLOTS.filter(function (s) { return state.slots[s] === op.key; })[0] || SLOTS.filter(function (s) { return !state.slots[s]; })[0] || 'right'; }
          state.slots[slot] = op.key;
          // a face is kept only while the character stays on stage; an entrance without one is neutral
          if (op.face) state.faces[op.key] = op.face;
          else if (!onStage || !state.faces[op.key]) state.faces[op.key] = 'neutral';
          if (op.dist) state.dist[op.key] = op.dist; else delete state.dist[op.key];
          break;
        }
        case 'move': {
          var from = SLOTS.filter(function (s) { return state.slots[s] === op.key; })[0];
          if (from && from !== op.slot) state.slots[from] = null;
          state.slots[op.slot] = op.key;
          if (!state.faces[op.key]) state.faces[op.key] = 'neutral';
          break;
        }
        case 'hide':
          SLOTS.forEach(function (s) { if (op.all || state.slots[s] === op.key) state.slots[s] = null; });
          break;
        case 'flashback': state.flashback = op.on ? { caption: op.caption } : null; break;
        case 'mode': if (state.mode !== op.mode) { state.mode = op.mode; state.pageStart = state.history.length; } break;
        case 'page': state.pageStart = state.history.length; break;
        case 'fx':
          if (op.name === 'none') state.fx = {};
          else if (op.oneshot) { if (!dressing) state.oneshot.push(op.name); }
          else if (op.on) state.fx[op.name] = true;
          else delete state.fx[op.name];
          break;
        case 'tone': state.tone = op.name; break;
        case 'label': state.label = op.name; break;
        case 'set': state.vars[op.name] = op.value; break;
        case 'add': if (!dressing) state.vars[op.name] = (parseFloat(state.vars[op.name]) || 0) + op.value; break;
      }
    }
    function runFrom(pc) {
      state.oneshot = [];
      state.change = null;
      for (;;) {
        if (pc >= n) return stopAt(n - 1);
        var op = ops[pc];
        if (trace) trace(pc, state);
        if (BLOCKING[op.kind]) return stopAt(pc);
        switch (op.kind) {
          case 'goto': { var g = jump(op.target, op.line); if (g < 0) return current; pc = g; continue; }
          case 'if': {
            if (evalCond(op.cond, state.vars)) { var t = jump(op.target, op.line); if (t < 0) return current; pc = t; continue; }
            break;
          }
          default: applyOp(op, false);
        }
        pc++;
      }
    }

    var run = {
      program: program,
      get state() { return state; },
      get seen() { return seen; },
      current: function () { return current; },
      visibleOptions: function () { return current && current.op.kind === 'menu' ? visibleOptions(current.op, current.index) : []; },
      advance: function () {
        if (current && current.op.kind === 'menu') return current;
        if (current && (current.op.kind === 'end' || current.op.kind === 'error')) { current.done = true; return current; }
        pushSnapshot();
        return runFrom(current ? current.index + 1 : 0);
      },
      choose: function (i) {
        if (!current || current.op.kind !== 'menu') return current;
        var vis = visibleOptions(current.op, current.index);
        var pick = vis[i];
        if (!pick) return current;
        var opt = current.op.options[pick.index];
        pushSnapshot();
        state.choiceLog.push({ menuLine: current.op.line, menuKey: current.op.key || null, menuIndex: current.index, optionIndex: pick.index });
        if (opt.once) state.chosen[current.index + ':' + pick.index] = true;
        state.history.push({ kind: 'choice', menuIndex: current.index, optionIndex: pick.index, text: opt.text });
        var t = jump(opt.target, opt.line);
        if (t < 0) return current;
        return runFrom(t);
      },
      back: function () {
        if (!stack.length) return null;
        var snap = stack.pop();
        state = snap.state;
        if (!snap.stop) { current = null; return null; }
        current = { op: ops[snap.stop.index], index: snap.stop.index, state: state, done: snap.stop.done };
        if (current.op.kind === 'menu') current.options = visibleOptions(current.op, current.index);
        return current;
      },
      jumpTo: function (target) {
        var idx = typeof target === 'number' ? target : resolveTarget(program, String(target));
        if (idx < 0 || idx >= n) return errorStop("unknown label '" + target + "'", '', 0);
        pushSnapshot();
        // dress the stage: apply the non-blocking ops that precede the target in file order
        // (jumps ignored), so a deep link lands on a lit set rather than an empty one
        if (!current) {
          for (var d = 0; d < idx; d++) {
            var dop = ops[d];
            if (dop.kind === 'chapter') state.chapter = { n: dop.n, title: dop.title, index: d };
            else if (!BLOCKING[dop.kind] && dop.kind !== 'goto' && dop.kind !== 'if') applyOp(dop, true);
          }
          state.transition = null; state.change = null;
        }
        current = null;
        return runFrom(idx);
      },
      snapshot: function () {
        return { hash: program.hash, choiceLog: clone(state.choiceLog), stopIndex: state.stops, seen: Object.keys(seen).map(Number).sort(function (a, b) { return a - b; }), pc: current ? current.index : 0 };
      },
      replay: function (log, stopIndex) {
        log = log || [];
        state = freshState(); stack = []; current = null;
        var li = 0, guard = 0;
        var stop = run.advance();
        while (stop && !stop.done && guard++ < 100000) {
          if (stopIndex != null && state.stops >= stopIndex) break;
          if (stop.op.kind === 'menu') {
            var entry = null;
            // match by menuKey (stable under prose edits), then by menuLine, else take the next entry in order
            for (var k = li; k < log.length; k++) if (log[k].menuKey && log[k].menuKey === stop.op.key) { entry = log[k]; li = k + 1; break; }
            if (!entry) for (var k2 = li; k2 < log.length; k2++) if (log[k2].menuLine === stop.op.line) { entry = log[k2]; li = k2 + 1; break; }
            if (!entry && li < log.length && log[li].menuLine == null && log[li].menuKey == null) entry = log[li++];
            if (!entry) break;
            var vis = visibleOptions(stop.op, stop.index), vi = -1;
            for (var v = 0; v < vis.length; v++) if (vis[v].index === entry.optionIndex) vi = v;
            if (vi < 0) break;
            stop = run.choose(vi);
          } else if (stop.op.kind === 'error') break;
          else stop = run.advance();
        }
        return stop;
      }
    };
    return run;
  }

  /* ------------------------------------------------------------------ routes */

  // The choices that lead from the top of the script to the op at `target` (an op index or a label name):
  // {choiceLog, stopIndex} for run.replay(), or null when no sequence of choices gets there. Options named in
  // opts.prefer (a saved choice log, matched by menuKey) are tried first, then the options in script order, so
  // the route found is the reader's own where possible and the first-option one otherwise.
  function routeTo(program, target, opts) {
    opts = opts || {};
    var idx = typeof target === 'number' ? target : resolveTarget(program, String(target));
    if (!(idx >= 0) || idx >= program.ops.length) return null;
    var prefer = opts.prefer || [], budget = opts.maxNodes || 600, visited = {}, found = null;
    function preferred(menuKey, log) {
      // the n-th visit to a menu takes the n-th saved entry for that menu
      var nth = 0, k;
      for (k = 0; k < log.length; k++) if (log[k].menuKey === menuKey) nth++;
      for (k = 0; k < prefer.length; k++) if (prefer[k].menuKey && prefer[k].menuKey === menuKey && nth-- === 0) return prefer[k].optionIndex;
      return -1;
    }
    function visit(log) {
      if (found || budget-- <= 0) return;
      var hit = null;
      var run = createRun(program, { trace: function (pc, state) { if (pc === idx && hit == null) hit = state.stops + 1; } });
      var stop = run.replay(log);
      if (hit != null) { found = { choiceLog: log, stopIndex: hit }; return; }
      if (!stop || stop.op.kind !== 'menu') return;
      var st = run.state, key = stop.index + '|' + JSON.stringify(st.vars) + '|' + Object.keys(st.chosen).sort().join(',');
      if (visited[key]) return;
      visited[key] = 1;
      var vis = stop.options.slice(), want = preferred(stop.op.key, log);
      vis.sort(function (a, b) { return (a.index === want ? -1 : 0) - (b.index === want ? -1 : 0); });
      for (var v = 0; v < vis.length && !found; v++) {
        visit(log.concat([{ menuLine: stop.op.line, menuKey: stop.op.key || null, menuIndex: stop.index, optionIndex: vis[v].index }]));
      }
    }
    visit([]);
    return found;
  }

  /* ------------------------------------------------------------------ bibtex */

  function bibtex(meta) {
    if (!meta || !meta.arxiv) return '';
    var year = (/\b(20\d\d)\b/.exec(meta.cite || '') || /^(\d\d)/.exec(meta.arxiv.replace(/^arXiv:/i, '')) || [])[1] || '';
    if (year.length === 2) year = '20' + year;
    var authors = (meta.authors || '').replace(/†/g, '').replace(/\s*\(co-first\)/g, '').replace(/,\s*and\s+|,\s*|\s+and\s+/g, ' and ').trim();
    var first = (authors.split(' and ')[0] || 'paper').trim().split(/\s+/).pop().toLowerCase().replace(/[^a-z]/g, '') || 'paper';
    var k = first + year + meta.arxiv.replace(/[^0-9]/g, '').slice(-4);
    return '@misc{' + k + ',\n' +
      '  title = {' + (meta.title || '') + '},\n' +
      '  author = {' + authors + '},\n' +
      '  year = {' + year + '},\n' +
      '  eprint = {' + meta.arxiv + '},\n' +
      '  archivePrefix = {arXiv},\n' +
      '  url = {https://arxiv.org/abs/' + meta.arxiv + '}\n' +
      '}';
  }

  /* ------------------------------------------------------------------ export */

  return {
    parse: parse, lint: lint, walk: walk, blog: blog, expand: expand, createRun: createRun, routeTo: routeTo,
    interpolate: interpolate, markup: markup, refs: refsOf, describeRef: describeRef, bibtex: bibtex,
    publishBlockers: publishBlockers, evalCond: evalCond, isThought: isThought,
    hash: fnv1a, hashHex: hashHex, rng: rng, mulberry32: mulberry32,
    FACES: FACES, BACKGROUNDS: BACKGROUNDS, BG_MODS: BG_MODS, PALETTES: PALETTES, SLOTS: SLOTS, HAIR: HAIR,
    TRANSITIONS: TRANSITIONS, DEFAULT_TRANSITION: DEFAULT_TRANSITION, FX: FX, FX_ONESHOT: FX_ONESHOT, CGS: CGS, TONES: TONES,
    DISTANCES: DISTANCES, CLOTHES: CLOTHES, MODES: MODES, BG_OPTS: BG_OPTS, CG_MODS: CG_MODS, HAIRTONES: HAIRTONES,
    STATUSES: STATUSES, BLOCKING: BLOCKING, DEFAULT_NOTE: DEFAULT_NOTE, WITHHELD_TEXT: WITHHELD_TEXT
  };
});
