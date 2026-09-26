/* Grammar Fossil Dig: tokeniser, lookup and stemmer. Pure logic, no DOM, so the same file runs
   in the page and in a Node self-test (see the module.exports tail). */
var FossilDig = (function () {
  'use strict';

  // Strata in reading order, with their dig layer. Layer 0 is the topsoil, layer 4 the bedrock.
  var STRATA = {
    m: { key: 'm', name: 'Modern coinage', short: 'modern', layer: 0 },
    o: { key: 'o', name: 'Loan from elsewhere', short: 'other loan', layer: 0 },
    k: { key: 'k', name: 'Greek', short: 'Greek', layer: 1 },
    l: { key: 'l', name: 'Latin', short: 'Latin', layer: 1 },
    f: { key: 'f', name: 'Norman French', short: 'French', layer: 2 },
    n: { key: 'n', name: 'Old Norse', short: 'Norse', layer: 3 },
    g: { key: 'g', name: 'Old English', short: 'Old English', layer: 4 },
    u: { key: 'u', name: 'Unknown', short: 'unknown', layer: -1 }
  };
  var LAYERS = [
    { id: 'topsoil', name: 'Topsoil', dates: 'c. 1600 to now', blurb: 'Modern coinages, trade names, acronyms, and loans from beyond the old European core: Dutch, Italian, Spanish, Arabic, Hindi, Japanese and hundreds more.', strata: ['m', 'o'] },
    { id: 'clay', name: 'Clay', dates: 'c. 1400 to 1900', blurb: 'Learned borrowings taken straight from Latin and Greek, mostly by scholars, physicians and scientists from the Renaissance on.', strata: ['l', 'k'] },
    { id: 'sandstone', name: 'Sandstone', dates: '1066 to c. 1500', blurb: 'The Norman French flood after the Conquest: law, court, cuisine, church and most of the abstract vocabulary. Much of it is Latin at one remove.', strata: ['f'] },
    { id: 'shale', name: 'Shale', dates: 'c. 800 to 1100', blurb: 'Old Norse from the Viking settlements of the Danelaw, thin but deep: they, their, sky, egg, knife, take, window, law.', strata: ['n'] },
    { id: 'bedrock', name: 'Bedrock', dates: 'c. 450 to 1100', blurb: 'The Old English core: nearly all function words and the plain vocabulary of the body, the farm, the weather and the family.', strata: ['g'] }
  ];

  var dict = null;   // word -> entry
  var langs = [];

  // ---- data loading: decode the compact strata strings (see the header comment in strata.js)
  function load(data) {
    dict = new Map();
    langs = data.langs || [];
    ['g', 'n', 'f', 'l', 'k', 'o', 'm'].forEach(function (s) {
      var str = data[s] || '';
      if (!str) return;
      str.split('\n').forEach(function (line) {
        if (!line) return;
        var eq = line.indexOf('=');
        var word = eq < 0 ? line : line.slice(0, eq);
        var e = { s: s, lang: '', form: '', deep: null, via: null, note: '', rel: false };
        if (eq >= 0) {
          var rest = line.slice(eq + 1);
          if (rest[0] === '+') e.via = rest.slice(1);
          else if (rest[0] === '~') e.note = rest.slice(1);
          else {
            if (rest[0] === '?') { e.rel = true; rest = rest.slice(1); }
            var tilde = rest.indexOf('~');
            if (tilde >= 0) { e.note = rest.slice(tilde + 1); rest = rest.slice(0, tilde); }
            var parts = rest.split('<');
            var a = parts[0].split(':');
            e.lang = langs[parseInt(a[0], 36)] || '';
            e.form = a[1] || '';
            if (parts[1]) {
              var b = parts[1].split(':');
              e.deep = { lang: langs[parseInt(b[0], 36)] || '', form: b[1] || '' };
            }
          }
        }
        dict.set(word, e);
      });
    });
    return dict.size;
  }
  function hasData() { return !!dict && dict.size > 0; }

  // ---- irregular inflections that the suffix stripper cannot reach
  var IRREG = {
    did: 'do', done: 'do', does: 'do', doth: 'do', was: 'be', were: 'be', been: 'be', being: 'be', am: 'be', is: 'be', are: 'be', wast: 'be', wert: 'be',
    had: 'have', has: 'have', hath: 'have', hast: 'have', went: 'go', gone: 'go', goes: 'go', made: 'make', said: 'say', came: 'come', took: 'take', taken: 'take',
    gave: 'give', given: 'give', saw: 'see', seen: 'see', knew: 'know', known: 'know', got: 'get', gotten: 'get', thought: 'think', brought: 'bring',
    bought: 'buy', caught: 'catch', taught: 'teach', fought: 'fight', sought: 'seek', found: 'find', held: 'hold', told: 'tell', sold: 'sell',
    felt: 'feel', kept: 'keep', left: 'leave', met: 'meet', led: 'lead', fed: 'feed', built: 'build', sent: 'send', spent: 'spend', lost: 'lose',
    meant: 'mean', stood: 'stand', understood: 'understand', sat: 'sit', ran: 'run', began: 'begin', begun: 'begin', sang: 'sing', sung: 'sing',
    drank: 'drink', drunk: 'drink', swam: 'swim', wrote: 'write', written: 'write', drove: 'drive', driven: 'drive', rose: 'rise', risen: 'rise',
    chose: 'choose', chosen: 'choose', spoke: 'speak', spoken: 'speak', broke: 'break', broken: 'break', woke: 'wake', fell: 'fall', fallen: 'fall',
    befell: 'befall', flew: 'fly', flown: 'fly', grew: 'grow', grown: 'grow', threw: 'throw', thrown: 'throw', drew: 'draw', drawn: 'draw', wore: 'wear',
    worn: 'wear', tore: 'tear', torn: 'tear', bore: 'bear', born: 'bear', borne: 'bear', swore: 'swear', sworn: 'swear', ate: 'eat', eaten: 'eat',
    forgot: 'forget', forgotten: 'forget', hid: 'hide', hidden: 'hide', bit: 'bite', bitten: 'bite', struck: 'strike', stuck: 'stick', hung: 'hang',
    won: 'win', shone: 'shine', slept: 'sleep', wept: 'weep', swept: 'sweep', crept: 'creep', dealt: 'deal', dug: 'dig', lain: 'lie', laid: 'lay',
    paid: 'pay', sped: 'speed', heard: 'hear', shod: 'shoe', clad: 'clothe', lent: 'lend', bent: 'bend', bled: 'bleed', bred: 'breed', wrung: 'wring', sank: 'sink', sunk: 'sink', shrank: 'shrink', stank: 'stink', rang: 'ring', rung: 'ring', dove: 'dive', forsook: 'forsake', forsaken: 'forsake', trod: 'tread', trodden: 'tread', abode: 'abide', awoke: 'awake', arose: 'arise', arisen: 'arise', overcame: 'overcome', undertook: 'undertake', withdrew: 'withdraw', withdrawn: 'withdraw', foresaw: 'foresee', foreseen: 'foresee', rebuilt: 'rebuild', misled: 'mislead', overthrew: 'overthrow', overthrown: 'overthrow', beheld: 'behold', befallen: 'befall', throve: 'thrive', thriven: 'thrive', shook: 'shake', shaken: 'shake', stole: 'steal', stolen: 'steal', froze: 'freeze',
    frozen: 'freeze', beat: 'beat', became: 'become', become: 'become', begat: 'beget', slew: 'slay', slain: 'slay', bade: 'bid', clung: 'cling',
    spun: 'spin', sprang: 'spring', sprung: 'spring', stung: 'sting', strove: 'strive', striven: 'strive', swung: 'swing', wound: 'wind', bound: 'bind',
    ground: 'grind', shot: 'shoot', lit: 'light', sheared: 'shear', shorn: 'shear', children: 'child', men: 'man', women: 'woman', feet: 'foot',
    teeth: 'tooth', mice: 'mouse', geese: 'goose', oxen: 'ox', lice: 'louse', brethren: 'brother', better: 'good', best: 'good', worse: 'bad',
    worst: 'bad', elder: 'old', eldest: 'old', these: 'this', those: 'that', an: 'a', mine: 'my', thine: 'thy', ye: 'you', hers: 'her', ours: 'our',
    theirs: 'their', yours: 'your', whom: 'who', whose: 'who'
  };

  // ---- suffix stripping. Each rule: [ending, replacements...]; a candidate counts if it is in the data.
  var INFLECT = [
    ['ies', 'y'], ['ied', 'y'], ['ier', 'y'], ['iest', 'y'], ['ily', 'y'],
    ['sses', 'ss'], ['shes', 'sh'], ['ches', 'ch'], ['xes', 'x'], ['zes', 'z'], ['oes', 'o'],
    ['es', 'e', ''], ['s', ''], ['ed', 'e', '', 'D'], ['ing', 'e', '', 'D'], ['eth', 'e', '', 'D'], ['est', 'e', '', 'D'],
    ['er', 'e', '', 'D'], ['th', ''], ['st', '']
  ];
  var DERIVE = [
    ['ly', '', 'le'], ['ness', ''], ['iness', 'y'], ['ful', ''], ['less', ''], ['ers', '', 'e', 'D'], ['ings', '', 'e', 'D'],
    ['ments', ''], ['ment', ''], ['ations', 'ate', 'e'], ['ation', 'ate', 'e'], ['ations', ''], ['ation', ''], ['ized', 'ize', 'e', ''], ['izes', 'ize', ''], ['ize', ''],
    ['ised', 'ise', 'e', ''], ['ise', ''], ['ity', 'e', ''], ['able', 'e', ''], ['ible', ''], ['ive', 'e', ''], ['ous', ''], ['al', '', 'e'], ['ic', ''],
    ['ist', ''], ['ism', ''], ['ward', ''], ['wards', ''], ['ship', ''], ['hood', ''], ['dom', ''], ['some', ''], ['ish', ''], ['en', ''], ['y', '', 'e']
  ];
  var PREFIX = ['un', 're', 'non', 'pre', 'dis', 'mis', 'over', 'out', 'under', 'fore', 'in', 'im', 'sub', 'inter', 'super', 'anti', 'de', 'co', 'semi', 'multi', 'cross', 'self', 'trans', 'auto', 'micro'];

  function candidates(w, rules) {
    var out = [];
    rules.forEach(function (r) {
      var end = r[0];
      if (w.length - end.length < 3 || !w.endsWith(end)) return;
      var stem = w.slice(0, -end.length);
      for (var i = 1; i < r.length; i++) {
        if (r[i] === 'D') { // undouble: stopped -> stop
          if (stem.length > 2 && stem[stem.length - 1] === stem[stem.length - 2] && !/[aeiou]/.test(stem[stem.length - 1])) out.push(stem.slice(0, -1));
        } else out.push(stem + r[i]);
      }
    });
    return out;
  }

  // ---- heuristics for words outside the data. Returns a stratum key or null. Everything here is a guess.
  var GREEK = /(ology|ologies|ologist|ological|graphy|graphic|graphies|phobia|phobic|philia|osis|itis|oma|iasis|metry|scope|scopy|cracy|crat|gram|grams|nomy|nomic|pathy|therapy|tomy|genic|genesis|lysis|lytic|plasm|sphere|morph|phone|phonic|phony|synthesis|tropic|archy|logue|logy|ectomy|emia|kinesis|onym|onyms)$/;
  var GREEKPRE = /^(hyper|hypo|micro|macro|tele|photo|psych|bio|geo|auto|poly|mono|neo|proto|pseudo|thermo|electro|cyber|techno|chrono|crypto|hydro|xeno|eco|homo|hetero|meta|para|dia|syn|sym|anthrop|cardio|neuro|astro|cosmo|demo|ortho|iso|phil|theo|zoo|chloro|ethno|holo|kilo)/;
  var LATIN = /(tion|tions|sion|sions|ity|ities|ment|ments|ance|ances|ence|ences|ancy|ency|ous|ive|ives|ize|izes|ized|izing|ise|ises|ised|ising|ization|isation|ate|ates|ated|ating|ation|ator|ators|ible|able|ability|ibility|ular|ial|ual|ary|ory|ery|ent|ents|ant|ants|ure|ures|ture|ical|ify|ifies|ified|fication|itude|ism|ist|ists|esque|ique|ology|al|als|ics|ium|ia|us|um|or|ors)$/;
  var GERMANIC = /(ness|ship|hood|dom|ful|less|ward|wards|some|fold|ly|ing|ed|s)$/;
  function guess(w) {
    if (w.length < 4) return null;
    if (GREEK.test(w) || (GREEKPRE.test(w) && w.length > 6)) return 'k';
    if (LATIN.test(w) && w.length > 5) return 'l';
    if (GERMANIC.test(w) && w.length > 5) return 'g';
    return null;
  }

  // ---- lookup. Returns an info object for a lowercase word.
  var cache = new Map();
  function direct(w) {
    if (!dict) return null;
    var e = dict.get(w);
    if (!e) return null;
    var info = { s: e.s, lang: e.lang, form: e.form, deep: e.deep, note: e.note, rel: e.rel, via: null, chain: [] };
    var hops = 0, root = e;
    while (root.via && hops < 6) { // formed from an English root: report the root's origin
      var r = dict.get(root.via);
      if (!r) break;
      info.chain.push(root.via); root = r; hops++;
      info.s = r.s; info.lang = r.lang; info.form = r.form; info.deep = r.deep; info.note = r.note || info.note; info.rel = r.rel;
    }
    if (info.chain.length) info.via = info.chain[info.chain.length - 1];
    return info;
  }
  function lookup(word) {
    var w = word.toLowerCase();
    if (cache.has(w)) return cache.get(w);
    var info = null, i, cands;
    // irregular forms first: "sent", "found", "left" also exist as unrelated headwords
    if (Object.prototype.hasOwnProperty.call(IRREG, w)) { info = direct(IRREG[w]); if (info) info.stem = IRREG[w]; }
    if (!info) info = direct(w);
    if (!info) {
      cands = candidates(w, INFLECT);
      for (i = 0; i < cands.length && !info; i++) { info = direct(cands[i]); if (info) info.stem = cands[i]; }
    }
    if (!info) {
      cands = candidates(w, DERIVE);
      for (i = 0; i < cands.length && !info; i++) { info = direct(cands[i]); if (info) { info.stem = cands[i]; info.derived = true; } }
    }
    if (!info) { // two-step: inflection then derivation (e.g. "tokenizations" -> "tokenization" -> "tokenize")
      cands = candidates(w, INFLECT);
      for (i = 0; i < cands.length && !info; i++) {
        var c2 = candidates(cands[i], DERIVE);
        for (var j = 0; j < c2.length && !info; j++) { info = direct(c2[j]); if (info) { info.stem = c2[j]; info.derived = true; } }
      }
    }
    if (!info) {
      for (i = 0; i < PREFIX.length && !info; i++) {
        var p = PREFIX[i];
        if (w.length > p.length + 3 && w.startsWith(p)) {
          var rest = w.slice(p.length);
          var sub = direct(rest) || (Object.prototype.hasOwnProperty.call(IRREG, rest) && direct(IRREG[rest]));
          if (!sub) { cands = candidates(rest, INFLECT); for (var k = 0; k < cands.length && !sub; k++) sub = direct(cands[k]); }
          if (sub) { info = sub; info.stem = rest; info.prefix = p; info.derived = true; }
        }
      }
    }
    if (!info) {
      var g = guess(w);
      info = g ? { s: g, guessed: true, lang: '', form: '', deep: null, note: '', via: null, chain: [] } : { s: 'u', lang: '', form: '', deep: null, note: '', via: null, chain: [] };
    }
    cache.set(w, info);
    return info;
  }

  // ---- tokeniser. Yields {t: text, w: lowercase word or null}. Hyphens split compounds; apostrophes are handled.
  var CONTRACT = { "can't": 'can', "won't": 'will', "shan't": 'shall', "ain't": 'be' };
  function tokenize(text) {
    var out = [], re = /[A-Za-z]+(?:['’][A-Za-z]+)?|[^A-Za-z]+/g, m;
    while ((m = re.exec(text)) !== null) {
      var t = m[0];
      if (!/[A-Za-z]/.test(t)) { out.push({ t: t, w: null }); continue; }
      var w = t.toLowerCase().replace(/’/g, "'");
      if (w.indexOf("'") >= 0) {
        if (Object.prototype.hasOwnProperty.call(CONTRACT, w)) w = CONTRACT[w];
        else if (/n't$/.test(w)) w = w.slice(0, -3);
        else w = w.split("'")[0];
      }
      out.push({ t: t, w: w });
    }
    return out;
  }

  // ---- analysis of a whole text: tokens with info, counts per stratum, share per layer
  function analyze(text) {
    var tokens = tokenize(text);
    var counts = { g: 0, n: 0, f: 0, l: 0, k: 0, o: 0, m: 0, u: 0 }, total = 0, guessed = 0;
    tokens.forEach(function (tok) {
      if (!tok.w) return;
      tok.info = lookup(tok.w);
      counts[tok.info.s]++; total++;
      if (tok.info.guessed) guessed++;
    });
    var known = total - counts.u;
    var pct = {};
    Object.keys(counts).forEach(function (k) { pct[k] = total ? counts[k] / total : 0; });
    var germanic = known ? (counts.g + counts.n) / known : 0; // Germanic index: share of classified words that are OE or Norse
    return { tokens: tokens, counts: counts, total: total, known: known, guessed: guessed, pct: pct, germanic: germanic };
  }

  return { STRATA: STRATA, LAYERS: LAYERS, load: load, hasData: hasData, lookup: lookup, tokenize: tokenize, analyze: analyze, langs: function () { return langs; } };
})();
if (typeof module !== 'undefined') module.exports = FossilDig;
