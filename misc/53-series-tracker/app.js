/* Runs — the page. Loads library.json, asks series.js for the runs, and draws
   each as a shelf of numbered spines with dashed ghosts for the gaps. */
(function () {
  'use strict';

  var S = window.Series;
  var params = new URLSearchParams(location.search);
  var THUMB = params.get('thumb') === '1';

  // Unit names, copied from assets/js/bookshelf.js
  var UNIT_NAME = {
    K: 'Pine library', H: 'Black bookcase', N: 'Manga case', B: 'Cherry bookcase', G: 'Library-label shelves',
    I: 'Cream bookcase', L: 'Nursing case', M: 'Japanese literature shelf', A: 'Light-wood unit', D: 'Wire shelf',
    F: 'Headset shelf', J: 'Cubby', Loose: 'Desk and floor',
  };
  var LANG_NAME = { EN: 'English', JA: 'Japanese', DE: 'German', IT: 'Italian', LA: 'Latin', VI: 'Vietnamese' };
  var TYPE_NAME = { manga: 'manga', ln: 'light novel', comics: 'comics', anthology: 'anthology', other: 'other' };
  var GAP_COMPRESS = 5;   // ghost runs longer than this collapse into one wide block

  var $ = function (id) { return document.getElementById(id); };
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function langName(code) {
    if (!code || code === '?') return 'unknown language';
    return code.split('/').map(function (c) { return LANG_NAME[c] || c; }).join(' / ');
  }
  function fold(s) { return S.stripAccents(String(s || '').normalize('NFKC')).toLowerCase(); }
  function plural(n, w) { return n + ' ' + w + (n === 1 ? '' : 's'); }

  // ---- state ----------------------------------------------------------------
  var series = [], byKey = {}, bookById = {};
  var sort = params.get('sort') || 'size';
  var typeF = params.get('type') || '';
  var langF = params.get('lang') || '';
  var hideSingles = params.get('singles') === '0';
  var query = params.get('q') || '';
  var zoomed = params.get('zoom') === '1';
  var openKey = null, openBookId = null;
  var rowByKey = {};

  var runsEl = $('runs'), statusEl = $('status'), tilesEl = $('tiles'), panel = $('panel'), tip = $('tip');
  var qInput = $('q'), countEl = $('count');

  if (THUMB) { document.body.classList.add('thumb'); sort = 'size'; }
  if (zoomed) document.body.classList.add('zoomed');
  qInput.value = query;

  // ---- load -----------------------------------------------------------------
  fetch('../../assets/data/library.json')
    .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(function (data) {
      data.books.forEach(function (b) { bookById[b.id] = b; });
      series = S.buildSeries(data.books);
      series.forEach(function (s) { byKey[s.key] = s; });
      statusEl.style.display = 'none';
      renderTiles();
      syncChips();
      render();
      var want = params.get('s');
      if (want && byKey[want]) openSeries(byKey[want]);
      var wantBook = params.get('b');
      if (wantBook && bookById[wantBook]) openBook(bookById[wantBook]);
    })
    .catch(function (e) {
      statusEl.className = 'err';
      statusEl.textContent = 'Could not read the library catalogue (' + e.message + '). Open this page from the site, where ../../assets/data/library.json exists.';
    });

  // ---- summary tiles ----------------------------------------------------------
  function renderTiles() {
    tilesEl.textContent = '';
    var vols = series.reduce(function (n, s) { return n + s.books.length; }, 0);
    var gappy = series.filter(function (s) { return s.missing.length > 0; }).length;
    var longest = series.slice().sort(function (a, b) { return b.longestRun - a.longestRun || b.owned - a.owned; })[0];
    var scattered = series.slice().sort(function (a, b) {
      return b.units.length - a.units.length || b.shelves.length - a.shelves.length || b.owned - a.owned;
    })[0];
    function tile(k, v, d, small, onClick) {
      var t = el('div', 'tile');
      t.appendChild(el('div', 'k', k));
      var vv = el('div', 'v' + (small ? ' small' : ''), v);
      t.appendChild(vv);
      if (d) t.appendChild(el('div', 'd', d));
      if (onClick) { t.style.cursor = 'pointer'; t.addEventListener('click', onClick); t.title = 'open'; }
      tilesEl.appendChild(t);
    }
    tile('Series', String(series.length), plural(series.filter(function (s) { return s.type === 'manga'; }).length, 'manga run') + ', ' + series.filter(function (s) { return s.type === 'ln'; }).length + ' light novel');
    tile('Volumes', String(vols), 'books that belong to a run');
    tile('With gaps', String(gappy), plural(series.reduce(function (n, s) { return n + s.missing.length; }, 0), 'missing number') + ' in all');
    if (longest) tile('Longest run', longest.name, plural(longest.longestRun, 'consecutive volume'), true, function () { openSeries(longest); scrollToRow(longest); });
    if (scattered) tile('Most scattered', scattered.name, 'across ' + plural(scattered.units.length, 'unit') + ', ' + plural(scattered.shelves.length, 'shelf').replace('shelfs', 'shelves'), true, function () { openSeries(scattered); scrollToRow(scattered); });
  }

  // ---- filtering and sorting --------------------------------------------------
  function langClass(s) {
    if (s.lang === 'EN') return 'EN';
    if (s.lang === 'JA') return 'JA';
    return 'other';
  }
  function matches(s, q) {
    if (!q) return true;
    if (fold(s.name).indexOf(q) >= 0 || fold(s.author).indexOf(q) >= 0 || fold(s.pub).indexOf(q) >= 0) return true;
    return s.books.some(function (b) { return bookMatches(b, q); });
  }
  function bookMatches(b, q) {
    return fold(b.t).indexOf(q) >= 0 || fold(b.a).indexOf(q) >= 0;
  }
  function cmpName(a, b) {
    if (a.cjk !== b.cjk) return a.cjk ? 1 : -1;
    return a.name.localeCompare(b.name, a.cjk ? 'ja' : 'en');
  }
  function visible() {
    var q = fold(query.trim());
    var list = series.filter(function (s) {
      if (typeF && s.type !== typeF) return false;
      if (langF && langClass(s) !== langF) return false;
      if (hideSingles && s.owned < 2) return false;
      return matches(s, q);
    });
    var cmp = {
      size: function (a, b) { return b.owned - a.owned || b.span - a.span || cmpName(a, b); },
      gaps: function (a, b) { return b.missing.length - a.missing.length || b.owned - a.owned || cmpName(a, b); },
      name: cmpName,
      author: function (a, b) {
        var ac = S.hasCJK(a.author), bc = S.hasCJK(b.author);
        if (!a.author !== !b.author) return a.author ? -1 : 1;
        if (ac !== bc) return ac ? 1 : -1;
        return a.author.localeCompare(b.author, ac ? 'ja' : 'en') || cmpName(a, b);
      },
    }[sort] || cmpName;
    list.sort(cmp);
    if (THUMB) list = list.filter(function (s) { return s.ownedNums.length > 0; }).slice(0, 12);
    return list;
  }

  // ---- rendering --------------------------------------------------------------
  function render() {
    var list = visible();
    var q = fold(query.trim());
    runsEl.textContent = '';
    rowByKey = {};
    runsEl.classList.toggle('dim', !!q);
    list.forEach(function (s) { var row = makeRow(s, q); rowByKey[s.key] = row; runsEl.appendChild(row); });
    var shownVols = list.reduce(function (n, s) { return n + s.books.length; }, 0);
    countEl.textContent = list.length === series.length ? plural(series.length, 'series').replace('seriess', 'series') + ' · ' + plural(shownVols, 'volume')
      : list.length + ' of ' + series.length + ' series · ' + plural(shownVols, 'volume');
    if (!list.length) {
      var none = el('div', '', 'No run matches' + (query ? ' "' + query + '"' : '') + '.');
      none.id = 'status'; none.style.display = 'block'; none.style.color = 'var(--ink-2)'; none.style.padding = '20px 0';
      runsEl.appendChild(none);
    }
    syncUrl();
  }

  function spineVars(s) {
    return '--h:' + s.hue + ';--s:' + Math.round(38 + s.shade * 18) + '%;--l:' + Math.round(30 + s.shade * 12) + '%';
  }

  // Text standing on a zoomed spine: the series name, except for hand-filed
  // series (Monogatari) and unnumbered volumes, whose label is the real title.
  function shortTitle(s, v) {
    var handFiled = s.books.every(function (b) { return S.OVERRIDES[b.id]; });
    var t = (v.n == null || handFiled) && v.label ? v.label : s.name;
    return t.length > 22 ? t.slice(0, 21) + '…' : t;
  }

  function makeRow(s, q) {
    var row = el('div', 'run' + (s.key === openKey ? ' open' : ''));
    row.style.cssText = spineVars(s);
    row.dataset.key = s.key;

    var head = el('button', 'run-head');
    head.title = 'series summary';
    head.appendChild(el('span', 'name', s.name));
    var meta = [s.author, TYPE_NAME[s.type]];
    if (s.lang !== 'EN' && s.lang !== 'JA') meta.push(langName(s.lang));
    head.appendChild(el('span', 'meta', meta.filter(Boolean).join(' · ')));
    var badges = el('span', 'badges');
    if (s.ownedNums.length) {
      var b = el('span', 'badge ' + (s.missing.length ? 'gap' : 'full'), s.ownedNums.length + ' of ' + s.span + (s.total ? ' declared' : ' seen'));
      b.title = S.describe(s);
      badges.appendChild(b);
    } else {
      badges.appendChild(el('span', 'badge', plural(s.owned, 'volume') + ', unnumbered'));
    }
    if (s.missing.length) badges.appendChild(el('span', 'badge gap', plural(s.missing.length, 'gap')));
    if (s.units.length > 1) badges.appendChild(el('span', 'badge scat', 'scattered'));
    else if (s.shelves.length > 1) badges.appendChild(el('span', 'badge', s.shelves.length + ' shelves'));
    if (s.copies) badges.appendChild(el('span', 'badge', '+' + plural(s.copies, 'copy').replace('copys', 'copies')));
    head.appendChild(badges);
    head.addEventListener('click', function () { openSeries(s); });
    row.appendChild(head);

    var shelf = el('div', 'shelf');
    // walk 1..span, drawing owned spines and ghost blocks
    var n = 1, span = s.span;
    var volByStart = {};
    s.volumes.forEach(function (v) { volByStart[v.n] = v; });
    while (n <= span) {
      var v = volByStart[n];
      if (v) {
        shelf.appendChild(makeSpine(s, v, q));
        n = (v.nEnd || v.n) + 1;
      } else {
        var e = n;
        while (e + 1 <= span && !volByStart[e + 1]) e++;
        var len = e - n + 1;
        if (len > GAP_COMPRESS) shelf.appendChild(makeGhost(s, n, e));
        else for (var i = n; i <= e; i++) shelf.appendChild(makeGhost(s, i, i));
        n = e + 1;
      }
    }
    s.unnumbered.forEach(function (v) { shelf.appendChild(makeSpine(s, v, q)); });
    row.appendChild(shelf);
    return row;
  }

  function makeSpine(s, v, q) {
    var b = v.books[0];
    var sp = el('button', 'sp');
    var k = v.nEnd ? v.nEnd - v.n + 1 : 1;
    if (k > 1) { sp.classList.add('wide'); sp.style.setProperty('--k', k); }
    if (v.n == null) sp.classList.add('un');
    sp.appendChild(el('span', 't', shortTitle(s, v)));
    sp.appendChild(el('span', 'n', v.n == null ? v.label : (v.nEnd ? v.n + '–' + v.nEnd : String(v.n))));
    if (v.books.length > 1) sp.appendChild(el('span', 'c', '×' + v.books.length));
    if (q && v.books.some(function (bk) { return bookMatches(bk, q); })) sp.classList.add('hit');
    if (b.id === openBookId) sp.classList.add('sel');
    sp.dataset.id = b.id;
    sp.setAttribute('aria-label', b.t);
    sp.addEventListener('click', function () { openBook(b, s, v); });
    sp.addEventListener('mouseenter', function (ev) { showTip(ev, v); });
    sp.addEventListener('mousemove', moveTip);
    sp.addEventListener('mouseleave', hideTip);
    sp.addEventListener('focus', function (ev) { showTip(ev, v); });
    sp.addEventListener('blur', hideTip);
    return sp;
  }

  function makeGhost(s, from, to) {
    var g = el('div', 'sp ghost');
    var k = to - from + 1;
    if (k > 1) { g.classList.add('wide'); g.style.setProperty('--k', Math.min(k, 4)); }
    g.appendChild(el('span', 't', s.name.length > 22 ? s.name.slice(0, 21) + '…' : s.name));
    g.appendChild(el('span', 'n', k > 1 ? from + '–' + to : String(from)));
    g.title = (k > 1 ? 'volumes ' + from + '–' + to + ' are' : 'volume ' + from + ' is') + ' not in the library';
    g.setAttribute('aria-label', g.title);
    return g;
  }

  // ---- tooltip ----------------------------------------------------------------
  function showTip(ev, v) {
    var b = v.books[0];
    tip.textContent = '';
    tip.appendChild(el('b', '', b.t));
    var m = [b.a, b.y, UNIT_NAME[b.u] ? UNIT_NAME[b.u] + ' › ' + b.s : b.s].filter(Boolean).join(' · ');
    tip.appendChild(el('div', 'm', m));
    if (v.books.length > 1) tip.appendChild(el('div', 'm', v.books.length + ' copies'));
    tip.style.display = 'block';
    moveTip(ev);
  }
  function moveTip(ev) {
    var x = ev.clientX, y = ev.clientY;
    if (x == null || isNaN(x) || (x === 0 && y === 0)) {
      var r = ev.target.getBoundingClientRect(); x = r.left + r.width / 2; y = r.top;
    }
    var w = tip.offsetWidth, h = tip.offsetHeight;
    var left = Math.min(x + 14, window.innerWidth - w - 8), top = y - h - 12;
    if (top < 6) top = y + 18;
    tip.style.left = Math.max(6, left) + 'px'; tip.style.top = top + 'px';
  }
  function hideTip() { tip.style.display = 'none'; }

  // ---- panel ------------------------------------------------------------------
  function markOpen() {
    Object.keys(rowByKey).forEach(function (k) { rowByKey[k].classList.toggle('open', k === openKey); });
    Array.prototype.forEach.call(runsEl.querySelectorAll('.sp.sel'), function (n) { n.classList.remove('sel'); });
    if (openBookId) {
      var sp = runsEl.querySelector('.sp[data-id="' + CSS.escape(openBookId) + '"]');
      if (sp) sp.classList.add('sel');
    }
  }
  function closeBtn() {
    var c = el('button', 'close', '×'); c.title = 'close (Esc)'; c.setAttribute('aria-label', 'close');
    c.addEventListener('click', closePanel);
    return c;
  }
  function kv(dl, k, v) {
    if (!v) return;
    dl.appendChild(el('dt', '', k)); dl.appendChild(el('dd', '', v));
  }
  function openSeries(s) {
    openKey = s.key; openBookId = null;
    panel.textContent = '';
    panel.appendChild(closeBtn());
    var h = el('h2');
    var sw = el('span', 'swatch'); sw.style.background = 'hsl(' + s.hue + ' 50% 50%)';
    h.appendChild(sw); h.appendChild(document.createTextNode(s.name));
    panel.appendChild(h);
    var sentence = el('div', 'sentence' + (s.missing.length ? '' : ' full'));
    sentence.textContent = (s.ownedNums.length ? 'Owned ' + s.ownedNums.length + ' of ' + s.span + (s.total ? ' declared' : ' seen') + ': ' : '') + S.describe(s) + '.';
    panel.appendChild(sentence);
    var dl = el('dl', 'kv');
    kv(dl, 'author', s.author);
    kv(dl, 'publisher', s.pub);
    kv(dl, 'type', TYPE_NAME[s.type] + (s.ty && s.ty.toLowerCase() !== TYPE_NAME[s.type] ? ' (' + s.ty + ')' : ''));
    kv(dl, 'language', langName(s.lang));
    kv(dl, 'genre', s.genre);
    if (s.years) kv(dl, 'years', s.years[0] === s.years[1] ? String(s.years[0]) : s.years[0] + '–' + s.years[1]);
    panel.appendChild(dl);

    panel.appendChild(el('h3', '', 'Where'));
    var where = el('div', 'where');
    if (s.units.length > 1) {
      var f = el('div', 'flag', 'Scattered across ' + plural(s.units.length, 'unit') + ': ' + s.units.map(function (u) { return UNIT_NAME[u] || u; }).join(', '));
      where.appendChild(f);
    } else if (s.shelves.length > 1) {
      where.appendChild(el('div', '', 'Split across ' + s.shelves.length + ' shelves of the ' + (UNIT_NAME[s.units[0]] || s.units[0]) + '.'));
    } else {
      where.appendChild(el('div', '', 'All together on one shelf.'));
    }
    var ul = el('ul');
    s.shelves.forEach(function (sh) {
      var li = el('li');
      var bb = el('b', '', UNIT_NAME[sh.u] || sh.u);
      li.appendChild(bb);
      li.appendChild(el('span', '', ' › ' + sh.s + ' · ' + plural(sh.count, 'volume')));
      ul.appendChild(li);
    });
    where.appendChild(ul);
    panel.appendChild(where);

    panel.appendChild(el('h3', '', 'Volumes'));
    var vl = el('ul');
    var n = 1;
    var volByStart = {};
    s.volumes.forEach(function (v) { volByStart[v.n] = v; });
    while (n <= s.span) {
      var v = volByStart[n];
      var li = el('li');
      if (v) {
        li.appendChild(el('span', 'num', v.nEnd ? v.n + '–' + v.nEnd : String(v.n)));
        var bt = el('button', '', v.books[0].t + (v.books.length > 1 ? ' (×' + v.books.length + ')' : ''));
        (function (b, vv) { bt.addEventListener('click', function () { openBook(b, s, vv); }); })(v.books[0], v);
        li.appendChild(bt);
        n = (v.nEnd || v.n) + 1;
      } else {
        var e = n;
        while (e + 1 <= s.span && !volByStart[e + 1]) e++;
        li.appendChild(el('span', 'num', e > n ? n + '–' + e : String(n)));
        li.appendChild(el('span', 'mis', 'missing'));
        n = e + 1;
      }
      vl.appendChild(li);
    }
    s.unnumbered.forEach(function (v) {
      var li = el('li');
      li.appendChild(el('span', 'num', '—'));
      var bt = el('button', '', v.books[0].t);
      bt.addEventListener('click', function () { openBook(v.books[0], s, v); });
      li.appendChild(bt);
      vl.appendChild(li);
    });
    panel.appendChild(vl);
    panel.classList.add('show');
    markOpen();
    syncUrl();
  }

  function findSeriesOf(id) {
    for (var i = 0; i < series.length; i++) if (series[i].books.some(function (b) { return b.id === id; })) return series[i];
    return null;
  }
  function openBook(b, s, v) {
    s = s || findSeriesOf(b.id);
    openKey = s ? s.key : null; openBookId = b.id;
    panel.textContent = '';
    panel.appendChild(closeBtn());
    if (s) {
      var crumb = el('button', '', '‹ ' + s.name);
      crumb.style.cssText = 'align-self:flex-start;padding:2px 8px;font-size:12px';
      crumb.addEventListener('click', function () { openSeries(s); });
      panel.appendChild(crumb);
    }
    panel.appendChild(el('h2', '', b.t));
    var dl = el('dl', 'kv');
    kv(dl, 'author', b.a);
    kv(dl, 'publisher', b.pub);
    // yr is the raw year text; it is occasionally a shifted column, so trust it only when it carries digits
    kv(dl, 'year', b.y ? String(b.y) + (b.yr && /\d/.test(b.yr) && b.yr !== String(b.y) ? ' (' + b.yr + ')' : '') : (b.yr && /\d/.test(b.yr) ? b.yr : ''));
    kv(dl, 'type', [b.ty, b.g].filter(Boolean).join(' · '));
    kv(dl, 'language', langName(b.l));
    kv(dl, 'shelf', (UNIT_NAME[b.u] || b.u) + ' › ' + b.s + ' · position ' + b.p);
    if (b.st && b.st !== 'OK') kv(dl, 'catalogue', b.st);
    panel.appendChild(dl);
    if (b.d) panel.appendChild(el('p', 'desc', b.d));
    if (v && v.books.length > 1) {
      panel.appendChild(el('p', 'desc', v.books.length + ' copies of this volume: ' + v.books.map(function (x) { return (UNIT_NAME[x.u] || x.u) + ' › ' + x.s; }).join('; ') + '.'));
    }
    var a = el('a', 'link', 'Open on the Bookshelf →');
    a.href = '../../#/bookshelf/' + encodeURIComponent(b.id);
    panel.appendChild(a);
    if (b.free && b.free.url) {
      var fa = el('a', 'link', 'Free e-text (' + (b.free.src || 'online') + ') ↗');
      fa.href = b.free.url; fa.target = '_blank'; fa.rel = 'noopener';
      panel.appendChild(fa);
    }
    if (s && v && v.n != null) {
      var nav = el('div', 'nav');
      var idx = s.volumes.indexOf(v);
      if (idx > 0) { var pb = el('button', '', '‹ vol. ' + s.volumes[idx - 1].n); pb.addEventListener('click', function () { openBook(s.volumes[idx - 1].books[0], s, s.volumes[idx - 1]); }); nav.appendChild(pb); }
      if (idx >= 0 && idx < s.volumes.length - 1) { var nb = el('button', '', 'vol. ' + s.volumes[idx + 1].n + ' ›'); nb.addEventListener('click', function () { openBook(s.volumes[idx + 1].books[0], s, s.volumes[idx + 1]); }); nav.appendChild(nb); }
      if (nav.childNodes.length) panel.appendChild(nav);
    }
    panel.classList.add('show');
    markOpen();
    syncUrl();
  }
  function closePanel() {
    panel.classList.remove('show');
    openKey = null; openBookId = null;
    markOpen();
    syncUrl();
  }
  function scrollToRow(s) {
    var row = rowByKey[s.key];
    if (!row) { query = ''; qInput.value = ''; typeF = ''; langF = ''; hideSingles = false; syncChips(); render(); row = rowByKey[s.key]; }
    if (row) row.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  // ---- shopping list ----------------------------------------------------------
  function shoppingText() {
    var lines = ['Shopping list — missing volumes (below the highest number on the shelf)', ''];
    var multi = series.filter(function (s) { return s.missing.length && s.ownedNums.length > 1; });
    var single = series.filter(function (s) { return s.missing.length && s.ownedNums.length === 1; });
    var by = function (a, b) { return b.missing.length - a.missing.length || cmpName(a, b); };
    multi.sort(by); single.sort(by);
    var total = 0;
    multi.forEach(function (s) {
      total += s.missing.length;
      lines.push(s.name + (s.author ? ' (' + s.author + ')' : '') + ' — vol. ' + S.ranges(s.missing) + '  [' + s.ownedNums.length + ' of ' + s.span + ' here]');
    });
    if (single.length) {
      lines.push('', 'From one-volume runs (only the top number is known; these may never have been collected):');
      single.forEach(function (s) {
        total += s.missing.length;
        lines.push(s.name + (s.author ? ' (' + s.author + ')' : '') + ' — vol. ' + S.ranges(s.missing) + '  [have vol. ' + s.ownedNums[0] + ']');
      });
    }
    lines.push('', plural(total, 'volume') + ' across ' + plural(multi.length + single.length, 'series').replace('seriess', 'series') + '. Generated from library.json on ' + new Date().toISOString().slice(0, 10) + '.');
    return lines.join('\n');
  }
  function openList() {
    $('list-text').value = shoppingText();
    $('copied').textContent = '';
    $('list').classList.add('show');
  }
  $('btn-list').addEventListener('click', openList);
  $('btn-list-close').addEventListener('click', function () { $('list').classList.remove('show'); });
  $('btn-copy').addEventListener('click', function () {
    var ta = $('list-text');
    function done() { $('copied').textContent = 'copied'; }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(ta.value).then(done, function () { ta.select(); done(); });
    else { ta.select(); try { document.execCommand('copy'); } catch (e) { /* ignore */ } done(); }
  });

  // ---- controls ---------------------------------------------------------------
  function syncChips() {
    Array.prototype.forEach.call(document.querySelectorAll('#sorts .chip'), function (c) { c.classList.toggle('on', c.dataset.sort === sort); });
    Array.prototype.forEach.call(document.querySelectorAll('#types .chip'), function (c) { c.classList.toggle('on', c.dataset.type === typeF); });
    Array.prototype.forEach.call(document.querySelectorAll('#langs .chip'), function (c) { c.classList.toggle('on', c.dataset.lang === langF); });
    $('btn-singles').classList.toggle('on', hideSingles);
    $('btn-zoom').classList.toggle('on', zoomed);
  }
  $('sorts').addEventListener('click', function (e) { var c = e.target.closest('.chip'); if (!c) return; sort = c.dataset.sort; syncChips(); render(); });
  $('types').addEventListener('click', function (e) { var c = e.target.closest('.chip'); if (!c) return; typeF = c.dataset.type; syncChips(); render(); });
  $('langs').addEventListener('click', function (e) { var c = e.target.closest('.chip'); if (!c) return; langF = c.dataset.lang; syncChips(); render(); });
  $('btn-singles').addEventListener('click', function () { hideSingles = !hideSingles; syncChips(); render(); });
  function toggleZoom() { zoomed = !zoomed; document.body.classList.toggle('zoomed', zoomed); syncChips(); syncUrl(); }
  $('btn-zoom').addEventListener('click', toggleZoom);
  var qTimer = null;
  qInput.addEventListener('input', function () {
    clearTimeout(qTimer);
    qTimer = setTimeout(function () { query = qInput.value; render(); }, 120);
  });
  $('btn-help').addEventListener('click', function () { $('help').classList.add('show'); });
  $('btn-help-close').addEventListener('click', function () { $('help').classList.remove('show'); });
  Array.prototype.forEach.call(document.querySelectorAll('.overlay'), function (o) {
    o.addEventListener('click', function (e) { if (e.target === o) o.classList.remove('show'); });
  });
  document.addEventListener('keydown', function (e) {
    var typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
    if (e.key === 'Escape') {
      var open = document.querySelector('.overlay.show');
      if (open) open.classList.remove('show');
      else if (panel.classList.contains('show')) closePanel();
      else if (typing) document.activeElement.blur();
      return;
    }
    if (typing) return;
    if (e.key === '/') { e.preventDefault(); qInput.focus(); qInput.select(); }
    else if (e.key === 'z' || e.key === 'Z') toggleZoom();
    else if (e.key === 'l' || e.key === 'L') openList();
    else if (e.key === '?') $('help').classList.toggle('show');
  });

  function syncUrl() {
    var p = new URLSearchParams();
    if (sort !== 'size') p.set('sort', sort);
    if (typeF) p.set('type', typeF);
    if (langF) p.set('lang', langF);
    if (hideSingles) p.set('singles', '0');
    if (query.trim()) p.set('q', query.trim());
    if (zoomed) p.set('zoom', '1');
    if (openBookId) p.set('b', openBookId);
    else if (openKey) p.set('s', openKey);
    if (THUMB) p.set('thumb', '1');
    var qs = p.toString();
    try { history.replaceState(null, '', location.pathname + (qs ? '?' + qs : '')); } catch (err) { /* file:// */ }
  }
})();
