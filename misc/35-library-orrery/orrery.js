/* Library Orrery: the celestial mechanics, with no DOM.
   Loads as a plain script (window.Orrery) or as a CommonJS module for Node.

   Units: time t is a fractional Gregorian year (2026.75); distances are AU;
   periods are years. Kepler's third law with a one-solar-mass sun:
   T = r^1.5. A body's period is a function of how old the book is, and its
   radius follows from the period. New books hug the sun; Gilgamesh is out
   past the Kuiper belt. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Orrery = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var TAU = Math.PI * 2;
  var EPOCH = 2000; // phases are defined at 2000.0 so every viewer sees the same sky
  var MAX_MASS = 0.5;

  /* ---------- small deterministic helpers ---------- */
  function hash(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function unit(str, salt) { return (hash(str + '|' + (salt || '')) % 1000003) / 1000003; }
  function wrap(a) { a = a % TAU; if (a > Math.PI) a -= TAU; if (a <= -Math.PI) a += TAU; return a; }
  function jan1(y) { var d = new Date(2000, 0, 1); d.setFullYear(y, 0, 1); return d.getTime(); }
  function yearFloat(d) {
    d = d || new Date();
    var y = d.getFullYear();
    var start = jan1(y), end = jan1(y + 1);
    return y + (d.getTime() - start) / (end - start);
  }
  function dateFromYear(t) {
    var y = Math.floor(t);
    var start = jan1(y), end = jan1(y + 1);
    return new Date(start + (t - y) * (end - start));
  }

  /* ---------- the law of the system ---------- */
  function periodForAge(age) { age = Math.max(0, age); return 0.25 + 0.016 * Math.pow(age, 1.5); }
  function radiusForPeriod(T) { return Math.pow(T, 2 / 3); }
  function periodForRadius(r) { return Math.pow(r, 1.5); }
  function radiusForAge(age) { return radiusForPeriod(periodForAge(age)); }

  /* ---------- reading the catalogue ---------- */
  function yearFrom(book) {
    if (typeof book.y === 'number' && isFinite(book.y)) return { year: book.y, est: false, label: String(book.y) };
    var s = String(book.yr || '').trim();
    var m;
    if (!s) return { year: null, est: true, label: 'year unknown' };
    if ((m = s.match(/(\d{4})s\s*(?:to|-|–)\s*(\d{2,4})s/))) {
      var a = +m[1], b = +m[2]; if (b < 100) b = Math.floor(a / 100) * 100 + b;
      return { year: (a + b + 10) / 2, est: true, label: s };
    }
    if ((m = s.match(/(\d{4})s/))) return { year: +m[1] + 5, est: true, label: m[1] + 's' };
    if ((m = s.match(/(\d{1,2})(st|nd|rd|th)\s*c\.?\s*BC/i))) return { year: -(+m[1] * 100 - 50), est: true, label: m[1] + m[2] + ' c. BC' };
    if ((m = s.match(/(early|mid|late)?\s*(\d{1,2})(st|nd|rd|th)\s*c\./i))) {
      var c = +m[2] * 100 - 100, off = m[1] ? ({ early: 15, mid: 50, late: 85 })[m[1].toLowerCase()] : 50;
      return { year: c + off, est: true, label: (m[1] ? m[1].toLowerCase() + ' ' : '') + m[2] + m[3] + ' c.' };
    }
    if ((m = s.match(/(\d{4})/))) return { year: +m[1], est: true, label: 'c. ' + m[1] };
    return { year: null, est: true, label: 'year unknown' };
  }

  function isBook(book) {
    var ty = String(book.ty || '');
    if (ty === 'Calendar' || ty === 'Games' || ty === 'Media') return false;
    if (book.g === 'Games & other objects') return false;
    return true;
  }

  var FAMILIES = [
    { id: 'lit', name: 'Literature (English & European)', color: '#f3cd7a', genres: ['Literature (English & European)'] },
    { id: 'jlit', name: 'Japanese literature', color: '#ff8363', genres: ['Japanese literature'] },
    { id: 'manga', name: 'Manga & comics', color: '#ff6fc0', genres: ['Manga & comics'] },
    { id: 'ln', name: 'Light novels', color: '#c9a3ff', genres: ['Light novels'] },
    { id: 'phil', name: 'Philosophy, society & politics', color: '#8f90ff', genres: ['Philosophy & political theory', 'Society, culture & ideas', 'Politics, law & current affairs'] },
    { id: 'rel', name: 'Religion & folklore', color: '#ffa844', genres: ['Religion & theology', 'Occult & folklore'] },
    { id: 'hist', name: 'History & biography', color: '#b9d26a', genres: ['History & biography'] },
    { id: 'sci', name: 'Science, maths & medicine', color: '#5bd7e6', genres: ['Science', 'Math, CS & engineering', 'Nursing & medical'] },
    { id: 'art', name: 'Art, music & craft', color: '#73e4bd', genres: ['Art & visual culture', 'Music & opera', 'Writing, film & literary craft'] },
    { id: 'study', name: 'Study & self', color: '#8fb6dc', genres: ['Language study & reference', 'Test prep & study guides', 'Psychology, self-help & business'] },
    { id: 'misc', name: 'Magazines & unidentified', color: '#a2a3ae', genres: ['Magazines & catalogues', 'Unidentified'] }
  ];
  var familyByGenre = {};
  FAMILIES.forEach(function (f) { f.genres.forEach(function (g) { familyByGenre[g] = f; }); });
  function familyOf(genre) { return familyByGenre[genre] || FAMILIES[FAMILIES.length - 1]; }

  var ROLE = /(^|\s)(原作|原案|漫画|作画|監修|編著|編|訳|校注|選|著|小説|作|ほか|イラスト|intro\.)(\s|$)/g;
  function isTranslatorOnly(a) { return /^(tr\.|trans\.)\s/i.test(String(a || '').trim()); }
  function cleanAuthor(a) {
    a = String(a || '').trim().split(',')[0];
    a = a.replace(/^(ed\.|eds\.|tr\.|trans\.)\s*/i, '').replace(/\s*\(.*?\)\s*/g, ' ');
    a = a.split(/\s*(?:\/|×|&)\s*/)[0];
    a = a.replace(ROLE, ' ').replace(/\s+/g, ' ').trim();
    return a;
  }
  function authorKey(a) { return cleanAuthor(a).toLowerCase(); }
  function surname(a) {
    if (isTranslatorOnly(a)) return '';
    a = cleanAuthor(a);
    if (!a) return '';
    // several Japanese authors joined with a nakaguro: keep the first, unless it is one katakana name
    if (a.indexOf('\u30fb') > 0 && !/[\u30a0-\u30ff]/.test(a.split('\u30fb')[0])) a = a.split('\u30fb')[0];
    if (!/\s/.test(a)) return a;
    var parts = a.split(/\s+/).filter(function (p) { return !/^(jr\.?|sr\.?|iii?|iv)$/i.test(p); });
    return parts[parts.length - 1] || a;
  }
  function shortTitle(t, n) {
    t = String(t || '').replace(/\s*\(.*?\)\s*$/, '').trim();
    n = n || 28;
    return t.length > n ? t.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : t;
  }

  /* ---------- building the system ---------- */
  function prepare(books, now) {
    now = now || yearFloat();
    var bodies = [], skipped = 0, titleCount = {};
    books.forEach(function (b) {
      if (!isBook(b)) { skipped++; return; }
      var tk = (b.t || '') + '|' + (b.a || '');
      titleCount[tk] = (titleCount[tk] || 0) + 1;
      var yf = yearFrom(b);
      var fam = familyOf(b.g);
      var body = {
        id: b.id, title: b.t || '(untitled)', author: b.a || '', genre: b.g || '', type: b.ty || '', lang: b.l || '',
        year: yf.year, est: yf.est, yearLabel: yf.label, copy: titleCount[tk],
        family: fam, color: fam.color, desc: b.d || '',
        shortName: '', surname: surname(b.a), cluster: null, oort: yf.year === null
      };
      body.shortName = body.surname ? body.surname : shortTitle(body.title, 22);
      if (body.year !== null) {
        // publication month is unknown, so scatter same-year books a little along the year
        var yr = body.year + unit(body.id, 'm') * 0.9;
        if (yr > now - 0.05) yr = now - 0.05;
        body.pubT = yr;
        body.age = now - yr;
        body.T = periodForAge(body.age);
        body.r = radiusForPeriod(body.T);
      }
      body.theta0 = unit(body.id, 'th') * TAU;
      body.phi0 = unit(body.id, 'ph') * TAU;
      bodies.push(body);
    });

    // the Oort cloud: undated books, far out and faint
    var maxR = 0;
    bodies.forEach(function (b) { if (!b.oort && b.r > maxR) maxR = b.r; });
    var oortR = maxR * 1.3;
    bodies.forEach(function (b) {
      if (!b.oort) return;
      b.r = oortR * (1 + 0.35 * unit(b.id, 'oort'));
      b.T = periodForRadius(b.r);
      b.age = null; b.pubT = null;
    });

    // moon systems: an author with several dated books shares a mean orbit
    var byAuthor = {};
    bodies.forEach(function (b) {
      if (b.oort) return;
      var k = authorKey(b.author);
      if (!k) return;
      (byAuthor[k] = byAuthor[k] || []).push(b);
    });
    var clusters = [];
    Object.keys(byAuthor).forEach(function (k) {
      var list = byAuthor[k];
      if (list.length < 2) return;
      var years = list.map(function (b) { return b.pubT; });
      var spread = Math.max.apply(null, years) - Math.min.apply(null, years);
      if (spread > 80) return;
      var meanAge = list.reduce(function (s, b) { return s + b.age; }, 0) / list.length;
      var tr = isTranslatorOnly(list[0].author);
      var c = {
        id: 'c:' + k, name: (tr ? 'tr. ' : '') + cleanAuthor(list[0].author), surname: (tr ? 'tr. ' : '') + (surname(cleanAuthor(list[0].author)) || cleanAuthor(list[0].author)),
        n: list.length, members: list, age: meanAge, T: periodForAge(meanAge), color: list[0].color, family: list[0].family
      };
      c.r = radiusForPeriod(c.T);
      c.theta0 = unit(c.id, 'th') * TAU;
      c.mass = Math.min(MAX_MASS, 0.02 * list.length);
      list.sort(function (a, b) { return b.pubT - a.pubT || (a.id < b.id ? -1 : 1); });
      list.forEach(function (b, i) {
        b.cluster = c;
        b.a = c.r * (0.035 + 0.075 * (list.length > 1 ? i / (list.length - 1) : 0));
        b.Tm = Math.sqrt(b.a * b.a * b.a / c.mass);
      });
      clusters.push(c);
    });
    clusters.sort(function (a, b) { return b.n - a.n || a.r - b.r; });
    bodies.sort(function (a, b) { return a.r - b.r; });
    var byId = {};
    bodies.forEach(function (b) { byId[b.id] = b; });
    return { now: now, bodies: bodies, clusters: clusters, byId: byId, skipped: skipped, oortR: oortR, maxR: maxR, families: FAMILIES };
  }

  /* ---------- where things are ---------- */
  function clusterAngle(c, t) { return c.theta0 + TAU * (t - EPOCH) / c.T; }
  function positionAt(b, t) {
    if (b.cluster) {
      var c = b.cluster, th = clusterAngle(c, t);
      var ph = b.phi0 + TAU * (t - EPOCH) / b.Tm;
      return { x: c.r * Math.cos(th) + b.a * Math.cos(ph), y: c.r * Math.sin(th) + b.a * Math.sin(ph) };
    }
    var a = b.theta0 + TAU * (t - EPOCH) / b.T;
    return { x: b.r * Math.cos(a), y: b.r * Math.sin(a) };
  }
  function clusterPosition(c, t) { var th = clusterAngle(c, t); return { x: c.r * Math.cos(th), y: c.r * Math.sin(th) }; }
  function angleOf(target, t) {
    if (target.members) return wrap(clusterAngle(target, t));
    var p = positionAt(target, t);
    return Math.atan2(p.y, p.x);
  }
  function orbitsCompleted(b, t) {
    if (b.pubT === null || b.pubT === undefined) return null;
    var dt = t - b.pubT;
    if (dt < 0) return { helio: 0, moon: 0, unpublished: true, years: dt };
    var T = b.cluster ? b.cluster.T : b.T;
    return { helio: Math.floor(dt / T), moon: b.cluster ? Math.floor(dt / b.Tm) : null, years: dt, fraction: (dt / T) % 1 };
  }

  /* ---------- conjunctions ---------- */
  function basePeriod(x) { return x.members ? x.T : (x.cluster ? x.cluster.T : x.T); }
  function synodic(a, b) {
    var w = Math.abs(1 / basePeriod(a) - 1 / basePeriod(b));
    return w > 0 ? 1 / w : Infinity;
  }
  // step time forward from tFrom and return the next events where the two targets
  // line up (conjunction) or stand opposite (opposition) as seen from the sun
  function findConjunctions(a, b, tFrom, opts) {
    opts = opts || {};
    var want = opts.count || 5, span = opts.span || 6000, kinds = opts.kinds || ['conjunction', 'opposition'];
    if (a === b) return [];
    var syn = synodic(a, b);
    var dt = Math.min(syn / 90, 5);
    if (!a.members && a.cluster) dt = Math.min(dt, a.Tm / 16);
    if (!b.members && b.cluster) dt = Math.min(dt, b.Tm / 16);
    dt = Math.max(dt, 0.002);
    var out = [], steps = 0, maxSteps = 400000;
    var t = tFrom, prevC = wrap(angleOf(a, t) - angleOf(b, t)), prevO = wrap(prevC - Math.PI);
    var lastT = { conjunction: -Infinity, opposition: -Infinity };
    var sep = isFinite(syn) ? Math.min(syn * 0.25, 2) : 1;
    function refine(kind, t0, t1) {
      var off = kind === 'conjunction' ? 0 : Math.PI;
      var f0 = wrap(angleOf(a, t0) - angleOf(b, t0) - off);
      for (var i = 0; i < 40; i++) {
        var tm = (t0 + t1) / 2, fm = wrap(angleOf(a, tm) - angleOf(b, tm) - off);
        if ((fm < 0) === (f0 < 0)) { t0 = tm; f0 = fm; } else t1 = tm;
      }
      return (t0 + t1) / 2;
    }
    while (out.length < want && steps++ < maxSteps && t - tFrom < span) {
      var tn = t + dt;
      var c = wrap(angleOf(a, tn) - angleOf(b, tn)), o = wrap(c - Math.PI);
      if (kinds.indexOf('conjunction') >= 0 && (c < 0) !== (prevC < 0) && Math.abs(c - prevC) < Math.PI) {
        var tc = refine('conjunction', t, tn);
        if (tc - lastT.conjunction > sep) { out.push({ t: tc, kind: 'conjunction' }); lastT.conjunction = tc; }
      }
      if (kinds.indexOf('opposition') >= 0 && (o < 0) !== (prevO < 0) && Math.abs(o - prevO) < Math.PI) {
        var to = refine('opposition', t, tn);
        if (to - lastT.opposition > sep) { out.push({ t: to, kind: 'opposition' }); lastT.opposition = to; }
      }
      prevC = c; prevO = o; t = tn;
    }
    out.sort(function (p, q) { return p.t - q.t; });
    return out.slice(0, want);
  }

  /* ---------- the sky right now ---------- */
  // principal bodies: clusters count once, Oort bodies are left out
  function principals(sys) {
    var list = sys.clusters.slice();
    sys.bodies.forEach(function (b) { if (!b.cluster && !b.oort) list.push(b); });
    return list;
  }
  function displayName(x) { return x.members ? x.surname : (x.surname || shortTitle(x.title, 22)); }
  function sky(sys, t, opts) {
    opts = opts || {};
    var tol = (opts.tolDeg || 1.5) * Math.PI / 180, horizonTol = (opts.horizonDeg || 10) * Math.PI / 180;
    var items = principals(sys).map(function (x) { return { ref: x, ang: angleOf(x, t), T: basePeriod(x) }; });
    items.sort(function (p, q) { return p.ang - q.ang; });
    var n = items.length, conj = [], opp = [];
    for (var i = 0; i < n; i++) {
      for (var j = i + 1; j < n + i; j++) {
        var q = items[j % n];
        var d = Math.abs(wrap(q.ang - items[i].ang));
        if (d > tol) break;
        if (j % n === i) continue;
        conj.push({ a: items[i].ref, b: q.ref, sep: d, rarity: synodic(items[i].ref, q.ref) });
      }
    }
    // oppositions: compare each with the items nearest to its antipode
    for (var k = 0; k < n; k++) {
      var target = wrap(items[k].ang + Math.PI);
      var lo = 0, hi = n;
      while (lo < hi) { var mid = (lo + hi) >> 1; if (items[mid].ang < target) lo = mid + 1; else hi = mid; }
      for (var m = -2; m <= 2; m++) {
        var idx = ((lo + m) % n + n) % n;
        if (idx <= k) continue;
        var dd = Math.abs(wrap(items[idx].ang - target));
        if (dd <= tol) opp.push({ a: items[k].ref, b: items[idx].ref, sep: dd, rarity: synodic(items[k].ref, items[idx].ref) });
      }
    }
    conj.sort(function (p, q) { return q.rarity - p.rarity; });
    opp.sort(function (p, q) { return q.rarity - p.rarity; });
    // a horizon that turns once a day: east is where things rise
    var east = TAU * (t * 365.2425 % 1), west = east + Math.PI;
    var rising = [], setting = [];
    items.forEach(function (it) {
      var de = wrap(it.ang - east), dw = wrap(it.ang - west);
      if (Math.abs(de) < horizonTol) rising.push({ ref: it.ref, d: de, T: it.T });
      if (Math.abs(dw) < horizonTol) setting.push({ ref: it.ref, d: dw, T: it.T });
    });
    rising.sort(function (p, q) { return q.T - p.T; });
    setting.sort(function (p, q) { return q.T - p.T; });
    return { conjunctions: conj, oppositions: opp, rising: rising, setting: setting, east: east };
  }

  function findBodies(sys, query, limit) {
    var q = String(query || '').trim().toLowerCase();
    if (!q) return [];
    var hits = [];
    sys.clusters.forEach(function (c) {
      var nm = c.name.toLowerCase();
      if (nm.indexOf(q) >= 0) hits.push({ ref: c, score: nm.indexOf(q) === 0 ? 0 : 1 });
    });
    sys.bodies.forEach(function (b) {
      var t = b.title.toLowerCase(), a = b.author.toLowerCase();
      if (t.indexOf(q) >= 0 || a.indexOf(q) >= 0) hits.push({ ref: b, score: (t.indexOf(q) === 0 || a.indexOf(q) === 0) ? 2 : 3 });
    });
    hits.sort(function (p, q2) { return p.score - q2.score; });
    return hits.slice(0, limit || 12).map(function (h) { return h.ref; });
  }

  function describeDuration(years) {
    var a = Math.abs(years);
    if (!isFinite(a)) return 'never';
    if (a < 1 / 365) return Math.max(1, Math.round(a * 365 * 24)) + ' h';
    if (a < 1) return Math.round(a * 365.25) + ' days';
    if (a < 10) return (Math.round(a * 10) / 10) + ' yr';
    return Math.round(a).toLocaleString() + ' yr';
  }

  return {
    TAU: TAU, EPOCH: EPOCH, FAMILIES: FAMILIES,
    hash: hash, unit: unit, wrap: wrap, yearFloat: yearFloat, dateFromYear: dateFromYear,
    periodForAge: periodForAge, radiusForAge: radiusForAge, radiusForPeriod: radiusForPeriod, periodForRadius: periodForRadius,
    yearFrom: yearFrom, isBook: isBook, familyOf: familyOf, authorKey: authorKey, isTranslatorOnly: isTranslatorOnly, cleanAuthor: cleanAuthor, surname: surname, shortTitle: shortTitle,
    prepare: prepare, positionAt: positionAt, clusterPosition: clusterPosition, clusterAngle: clusterAngle, angleOf: angleOf,
    orbitsCompleted: orbitsCompleted, basePeriod: basePeriod, synodic: synodic, findConjunctions: findConjunctions, principals: principals, sky: sky,
    displayName: displayName, findBodies: findBodies, describeDuration: describeDuration
  };
}));
