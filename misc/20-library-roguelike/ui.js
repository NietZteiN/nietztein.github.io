/*
 * Library Roguelike - browser UI. All rules live in engine.js (window.LR);
 * this file only loads the catalogue, renders the run state and forwards
 * verbs from keys and buttons.
 */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var STORE_BEST = 'lr.best', STORE_HELP = 'lr.helpSeen';
  var CATALOGUE = '../../assets/data/library.json';

  var books = null;      // catalogue rows
  var dungeon = null, run = null;
  var recorded = false;  // whether the current run went to the leaderboard
  var catalogueNote = '';

  /* ------------------------------------------------------------ storage */

  function loadBest() {
    try { var v = JSON.parse(localStorage.getItem(STORE_BEST) || '[]'); return Array.isArray(v) ? v : []; }
    catch (e) { return []; }
  }
  function saveBest(list) {
    try { localStorage.setItem(STORE_BEST, JSON.stringify(list)); } catch (e) { /* storage blocked */ }
  }
  function helpSeen() {
    try { return localStorage.getItem(STORE_HELP) === '1'; } catch (e) { return false; }
  }
  function markHelpSeen() {
    try { localStorage.setItem(STORE_HELP, '1'); } catch (e) { /* ignore */ }
  }

  /* --------------------------------------------------------------- seed */

  function seedFromHash() {
    var m = /[#&]seed=([^&]+)/.exec(location.hash);
    return m ? decodeURIComponent(m[1]) : null;
  }
  function setHashSeed(seed) {
    var h = seed === LR.dailySeed() ? '' : '#seed=' + encodeURIComponent(seed);
    if (history.replaceState) history.replaceState(null, '', location.pathname + location.search + h);
    else location.hash = h;
  }

  function start(seed) {
    var daily = seed === LR.dailySeed();
    dungeon = LR.makeDungeon(books, seed, { daily: daily });
    run = LR.newRun(dungeon);
    recorded = false;
    setHashSeed(seed);
    renderAll();
  }

  function act(verb, idx) {
    if (!run) return;
    LR.step(run, verb, idx);
    if (run.over && !recorded) record();
    renderAll();
  }

  function record() {
    recorded = true;
    if (!dungeon.daily) return;
    var list = loadBest();
    list.push({
      seed: dungeon.seed, date: dungeon.date, score: LR.score(run), won: run.won,
      rooms: LR.roomsCleared(run), total: dungeon.rooms.length, defeated: run.defeated, turns: run.turns, ts: Date.now()
    });
    list.sort(function (a, b) { return b.score - a.score || a.ts - b.ts; });
    saveBest(list.slice(0, 20));
  }

  /* ------------------------------------------------------------ helpers */

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
  }
  function bar(cur, max, cells, cls) {
    var on = max > 0 ? Math.round(cells * Math.max(0, cur) / max) : 0;
    if (cur > 0 && on === 0) on = 1;
    var s = '';
    for (var i = 0; i < cells; i++) s += i < on ? '#' : '.';
    return '<span class="bar ' + (cls || '') + '">[<span class="on">' + s.slice(0, on) + '</span><span class="off">' + s.slice(on) + '</span>]</span> ' + cur + '/' + max;
  }
  function trunc(s, n) {
    s = String(s);
    return s.length > n ? s.slice(0, Math.max(1, n - 1)) + '…' : s;
  }
  // Display width in monospace cells: CJK and fullwidth characters take two.
  function cellWidth(ch) {
    var c = ch.codePointAt(0);
    return (c >= 0x1100 && (c <= 0x115f || (c >= 0x2e80 && c <= 0xa4cf) || (c >= 0xac00 && c <= 0xd7a3) ||
      (c >= 0xf900 && c <= 0xfaff) || (c >= 0xfe30 && c <= 0xfe4f) || (c >= 0xff00 && c <= 0xff60) ||
      (c >= 0xffe0 && c <= 0xffe6) || (c >= 0x20000 && c <= 0x3fffd))) ? 2 : 1;
  }
  // Cut a title to `cells` columns and pad it out, so spines line up.
  function fitCells(s, cells) {
    var chars = Array.from(String(s)), total = 0, i;
    for (i = 0; i < chars.length; i++) total += cellWidth(chars[i]);
    var out = '', used = 0;
    if (total <= cells) { out = chars.join(''); used = total; }
    else {
      for (i = 0; i < chars.length; i++) {
        var w = cellWidth(chars[i]);
        if (used + w > cells - 1) break;
        out += chars[i]; used += w;
      }
      out += '…'; used += 1;
    }
    while (used < cells) { out += ' '; used++; }
    return out;
  }

  /* ------------------------------------------------------------- render */

  function renderAll() {
    renderHeader(); renderRoom(); renderEnemy(); renderLog();
    renderVerbs(); renderStatus(); renderBag(); renderMap(); renderBoard();
  }

  function renderHeader() {
    var d = dungeon;
    var stir = 0;
    d.rooms.forEach(function (r) { stir += r.total; });
    $('sub').textContent = (d.daily ? 'Dungeon of ' + d.date : (d.date ? 'Dungeon of ' + d.date + ' (replay, does not count)' : 'Random run, seed ' + d.seed + ' (does not count for the daily)'))
      + ' · ' + d.rooms.length + ' shelves, ' + stir + ' books stir';
  }

  function renderRoom() {
    var r = LR.currentRoom(run);
    $('room-title').innerHTML = esc(r.label) + ' <span>· room ' + (r.index + 1) + '/' + dungeon.rooms.length + ' · ' + r.total + ' of its ' + r.shelfSize + ' books</span>';
    var box = $('spines');
    box.innerHTML = '';
    var closed = r.total - r.monsters.length;
    for (var i = 0; i < closed; i++) {
      var g = document.createElement('span');
      g.className = 'spine dead';
      g.textContent = '|' + '····' + '|';
      box.appendChild(g);
    }
    r.monsters.forEach(function (m, i) {
      var w = 6 + Math.min(14, Math.floor(m.maxHp / 2));
      var el = document.createElement('span');
      el.className = 'spine' + (i === 0 && !r.cleared && !r.fled ? ' current' : '') + (m.boss ? ' boss' : '');
      el.textContent = '|' + fitCells(m.title, w - 2) + '|';
      el.title = m.title + ' (' + m.arch.name + ', ' + m.hp + '/' + m.maxHp + ' HP)';
      box.appendChild(el);
    });
    if (!r.monsters.length) {
      var e = document.createElement('span');
      e.className = 'spine dead';
      e.textContent = r.fled ? '(you fled this shelf)' : '(empty shelf)';
      box.appendChild(e);
    }
    var line = '';
    for (var k = 0; k < 120; k++) line += '─';
    $('shelf-line').textContent = line;
  }

  function renderEnemy() {
    var m = LR.currentEnemy(run);
    var r = LR.currentRoom(run);
    if (!m) {
      $('enemy-name').innerHTML = run.over ? (run.won ? 'The exit.' : 'Your body, between the shelves.') : (r.fled ? 'Nothing. You fled.' : 'Nothing. The shelf is quiet.');
      $('enemy-meta').textContent = run.over ? '' : 'Read your bag for free, then press 4 to move on.';
      $('enemy-bar').innerHTML = '';
      $('enemy-desc').textContent = '';
      return;
    }
    var b = m.book;
    $('enemy-name').innerHTML = (m.boss ? '<span class="boss">BOSS </span>' : '') + esc(m.title);
    var meta = [m.arch.name, b.g, m.year ? String(m.year) : (b.yr || ''), b.l, b.a].filter(Boolean).join(' · ');
    $('enemy-meta').textContent = meta;
    var tags = [];
    if (m.stun) tags.push('bound ' + m.stun);
    if (m.armour) tags.push('armour ' + m.armour);
    if (m.senior) tags.push('seniority');
    if (m.key === 'chronicle' && m.lastVerb) tags.push('remembers: ' + m.lastVerb);
    if (m.sequel) tags.push('sequel');
    $('enemy-bar').innerHTML = bar(m.hp, m.maxHp, 20) + (tags.length ? '  <span class="status-tags">' + esc(tags.join(' · ')) + '</span>' : '');
    $('enemy-desc').textContent = 'It ' + m.arch.trait + '. ' + (b.d ? trunc(b.d, 160) : '');
  }

  function renderLog() {
    var box = $('log');
    var html = '';
    run.log.forEach(function (l) {
      html += '<div class="' + l.kind + '">' + esc(l.text) + '</div>';
    });
    box.innerHTML = html;
    box.scrollTop = box.scrollHeight;
  }

  var VERB_LABEL = { attack: 'Attack', skim: 'Skim', shelve: 'Shelve', flee: 'Flee' };

  function renderVerbs() {
    var box = $('verbs');
    box.innerHTML = '';
    box.className = run.over ? 'over' : '';
    if (run.over) {
      addButton(box, 'Copy summary', '', function (btn) { copySummary(btn); }, 'copy');
      addButton(box, run.won ? 'Another random run' : 'Try a random run', 'does not count', function () { start('r' + Math.floor(Math.random() * 1e9)); });
      addButton(box, dungeon.daily ? 'Replay today' : 'Back to the daily', '', function () { start(LR.dailySeed()); });
      return;
    }
    var m = LR.currentEnemy(run);
    var lastRoom = run.room === dungeon.rooms.length - 1;
    for (var k = 1; k <= 4; k++) {
      (function (k) {
        var verb = LR.verbForKey(run, k);
        var label = VERB_LABEL[verb], sub = '', cls = run.scramble ? 'scrambled' : '', disabled = false;
        if (!m) {
          if (k === 4) { label = 'Next shelf'; verb = 'next'; cls = 'next'; sub = lastRoom ? '' : 'walk on'; disabled = lastRoom; }
          else disabled = true;
        } else if (verb === 'attack') sub = LR.CFG.attackLo + '–' + LR.CFG.attackHi + ' dmg';
        else if (verb === 'skim') sub = '+' + (LR.CFG.skimGain + Math.min(2, run.skills.Plot || 0)) + ' Attention';
        else if (verb === 'shelve') {
          var p = LR.shelveChance(run);
          sub = m.key === 'damaged' ? 'unreadable' : Math.round(p * 100) + '% · ' + LR.CFG.shelveCost + ' AT';
          disabled = m.key === 'damaged' || run.at < LR.CFG.shelveCost;
        } else if (verb === 'flee') { sub = lastRoom ? 'no exit' : 'parting hit'; disabled = lastRoom; }
        addButton(box, label, sub, function () { act(verb); }, cls, k, disabled);
      })(k);
    }
    var top = run.bag[run.bag.length - 1];
    addButton(box, 'Read', top ? trunc(top.t, 14) : 'bag empty', function () { act('read'); }, '', 5, !top);
  }

  function addButton(box, label, sub, onClick, cls, key, disabled) {
    var b = document.createElement('button');
    b.className = cls || '';
    b.innerHTML = '<b>' + (key ? '<kbd>' + key + '</kbd>' : '') + esc(label) + '</b>' + (sub ? '<small>' + esc(sub) + '</small>' : '');
    b.disabled = !!disabled;
    b.addEventListener('click', function () { onClick(b); });
    box.appendChild(b);
    return b;
  }

  function renderStatus() {
    $('status').innerHTML = 'HP ' + bar(run.hp, run.maxHp, 20) + '\nAT ' + bar(run.at, run.maxAt, 10, 'at') +
      '\nturn ' + run.turns + ' · defeated ' + run.defeated + ' · score ' + LR.score(run) +
      (run.dazzled ? '\n<span class="status-tags">dazzled: next turn is lost</span>' : '') +
      (run.scramble ? '\n<span class="status-tags">verbs scrambled: read the buttons</span>' : '');
    var sk = $('skills');
    var names = Object.keys(run.skills);
    if (!names.length) { sk.innerHTML = '<span class="muted">No skills yet. Read a defeated book to learn one.</span>'; return; }
    var descs = {};
    Object.keys(LR.ARCH).forEach(function (k) { descs[LR.ARCH[k].skill] = LR.ARCH[k].skillDesc; });
    sk.innerHTML = names.map(function (n) {
      return '<div><span>' + esc(n) + ' ' + LR.roman(run.skills[n]) + '</span><span>' + esc(descs[n] || '') + '</span></div>';
    }).join('');
  }

  function renderBag() {
    var box = $('bag');
    box.innerHTML = '';
    if (!run.bag.length) { box.innerHTML = '<span class="muted">Empty. Defeated books land here.</span>'; return; }
    run.bag.forEach(function (b, i) {
      var row = document.createElement('div');
      var t = document.createElement('span');
      t.className = 'title';
      t.textContent = b.t;
      t.title = b.t + ' → ' + LR.ARCH[LR.archetypeFor(b)].skill;
      var btn = document.createElement('button');
      btn.textContent = 'Read → ' + LR.ARCH[LR.archetypeFor(b)].skill;
      btn.disabled = run.over;
      btn.addEventListener('click', function () { act('read', i); });
      row.appendChild(t); row.appendChild(btn);
      box.appendChild(row);
    });
  }

  // Tiny minimap: one line per bookcase unit, rooms in walking order.
  function renderMap() {
    var lines = [], byUnit = [], idx = {};
    dungeon.rooms.forEach(function (r) {
      if (!(r.unit in idx)) { idx[r.unit] = byUnit.length; byUnit.push({ unit: r.unit, rooms: [] }); }
      byUnit[idx[r.unit]].rooms.push(r);
    });
    byUnit.forEach(function (u) {
      var s = ' ' + esc(u.unit.length > 1 ? u.unit.slice(0, 1) : u.unit) + '  ';
      s += u.rooms.map(function (r) {
        var mark, cls;
        var last = r.index === dungeon.rooms.length - 1;
        if (r.index === run.room && !run.over) { mark = '@'; cls = 'cur'; }
        else if (r.cleared) { mark = '+'; cls = 'done'; }
        else if (r.fled) { mark = '~'; cls = 'fled'; }
        else if (r.index === run.room) { mark = run.won ? '+' : 'x'; cls = run.won ? 'done' : 'boss'; }
        else { mark = last ? 'B' : '?'; cls = last ? 'boss' : ''; }
        return '<span class="' + cls + '" title="' + esc(r.label) + '">[' + (r.index + 1) + mark + ']</span>';
      }).join('─');
      lines.push(s);
    });
    var cur = LR.currentRoom(run);
    lines.push('<span class="legend">@ you · + cleared · ~ fled\n? ahead · B boss' + (run.over ? '' : ' · at ' + esc(cur.unit + ' / ' + cur.shelf)) + '</span>');
    $('map').innerHTML = lines.join('\n');
  }

  function renderBoard() {
    var list = loadBest().slice(0, 6);
    var box = $('board');
    if (!list.length) { box.innerHTML = '<span class="muted">No daily runs recorded on this browser yet.</span>'; return; }
    var today = LR.dailySeed();
    box.innerHTML = list.map(function (e) {
      return '<div class="' + (e.seed === today ? 'today' : '') + '"><span>' + esc(e.date || e.seed) + ' · ' + (e.won ? 'escaped' : e.rooms + '/' + (e.total || 8) + ' shelves') + '</span><span>' + e.score + ' pts · ' + e.defeated + ' books</span></div>';
    }).join('');
  }

  function copySummary(btn) {
    var text = LR.summary(run);
    function done(ok) { btn.querySelector('b').textContent = ok ? 'Copied' : 'Copy failed'; }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(fallbackCopy(text)); });
    } else done(fallbackCopy(text));
  }
  function fallbackCopy(text) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      var ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (e) { return false; }
  }

  /* --------------------------------------------------------------- help */

  function showHelp(show) {
    $('help').classList.toggle('show', show);
    if (!show) markHelpSeen();
  }

  /* -------------------------------------------------------------- input */

  document.addEventListener('keydown', function (ev) {
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    var tag = (ev.target && ev.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if ($('help').classList.contains('show')) {
      if (ev.key === 'Escape' || ev.key === 'Enter' || ev.key === '?' || ev.key === 'h') { showHelp(false); ev.preventDefault(); }
      return;
    }
    if (ev.key === '?' || ev.key === 'h') { showHelp(true); return; }
    if (!run || run.over) return;
    var k = parseInt(ev.key, 10);
    if (k >= 1 && k <= 4) {
      var m = LR.currentEnemy(run);
      if (!m) { if (k === 4) act('next'); return; }
      act(LR.verbForKey(run, k));
      ev.preventDefault();
    } else if (k === 5) {
      act('read');
      ev.preventDefault();
    }
  });

  $('btn-help').addEventListener('click', function () { showHelp(true); });
  $('btn-help-close').addEventListener('click', function () { showHelp(false); });
  $('help').addEventListener('click', function (ev) { if (ev.target === $('help')) showHelp(false); });
  $('btn-daily').addEventListener('click', function () { if (books) start(LR.dailySeed()); });
  $('btn-random').addEventListener('click', function () { if (books) start('r' + Math.floor(Math.random() * 1e9)); });
  window.addEventListener('hashchange', function () {
    if (!books) return;
    var s = seedFromHash() || LR.dailySeed();
    if (s !== dungeon.seed) start(s);
  });

  /* --------------------------------------------------------------- boot */

  function boot() {
    $('source').textContent = catalogueNote;
    start(seedFromHash() || LR.dailySeed());
    if (!helpSeen()) showHelp(true);
  }

  function useSample(reason) {
    books = window.LR_SAMPLE || [];
    catalogueNote = books.length + ' invented books on ' + LR.shelfList(books).length + ' shelves (bundled sample).';
    $('note').textContent = 'The real catalogue could not be fetched (' + reason + '). Open the page from the website for the owner’s library.';
    boot();
  }

  function load() {
    if (location.protocol === 'file:') { useSample('opened from file://'); return; }
    if (typeof fetch !== 'function') { useSample('no fetch'); return; }
    fetch(CATALOGUE).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (d) {
      if (!d || !Array.isArray(d.books) || !d.books.length) throw new Error('unexpected shape');
      books = d.books;
      catalogueNote = books.length + ' books on ' + LR.shelfList(books).length + ' shelves, from assets/data/library.json' + (d.generated ? ' (built ' + d.generated + ')' : '') + '.';
      boot();
    }).catch(function (e) { useSample(e && e.message ? e.message : 'fetch failed'); });
  }

  load();
})();
