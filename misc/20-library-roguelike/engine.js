/*
 * Library Roguelike - game engine (pure logic, no DOM).
 *
 * The dungeon is the owner's real library: every room is one shelf of one
 * bookcase (fields u + s in assets/data/library.json) and every monster is a
 * book that actually stands on that shelf. Genre picks the monster's
 * archetype, a page proxy (title + description length, weighted by type)
 * sets its HP, the publication year sets initiative, and attack flavour is
 * cut from the catalogue description.
 *
 * The same file runs in the browser (window.LR) and in Node (module.exports)
 * so the balance can be simulated with a script.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LR = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ------------------------------------------------------------------ RNG */

  // xmur3 string hash -> 32-bit seed, then mulberry32. Both are tiny and
  // deterministic, which is all a daily dungeon needs.
  function hashString(str) {
    var h = 1779033703 ^ str.length;
    for (var i = 0; i < str.length; i++) {
      h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  }

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function makeRng(seed) {
    var next = mulberry32(hashString(String(seed)));
    return {
      next: next,
      int: function (n) { return Math.floor(next() * n); },                       // 0..n-1
      range: function (lo, hi) { return lo + Math.floor(next() * (hi - lo + 1)); }, // lo..hi
      chance: function (p) { return next() < p; },
      pick: function (arr) { return arr[Math.floor(next() * arr.length)]; },
      shuffle: function (arr) {
        var a = arr.slice();
        for (var i = a.length - 1; i > 0; i--) {
          var j = Math.floor(next() * (i + 1));
          var t = a[i]; a[i] = a[j]; a[j] = t;
        }
        return a;
      }
    };
  }

  // Today's dungeon seed: UTC date as YYYYMMDD.
  function dailySeed(date) {
    var d = date || new Date();
    var y = d.getUTCFullYear(), m = d.getUTCMonth() + 1, day = d.getUTCDate();
    return String(y) + (m < 10 ? '0' : '') + m + (day < 10 ? '0' : '') + day;
  }
  function seedToDate(seed) {
    var m = /^(\d{4})(\d{2})(\d{2})$/.exec(String(seed));
    return m ? m[1] + '-' + m[2] + '-' + m[3] : null;
  }

  /* --------------------------------------------------- alphabet helpers */

  // Shelves want order. The library files "The X" between S and T, so the
  // Shelve verb (binding a book by sliding it back into place) succeeds
  // more often when the current title sits next to the previous one.
  function letterIndex(title) {
    var t = String(title || '').trim().toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '');
    t = t.replace(/^['"‘“(\[]+/, '');
    if (/^the\s/.test(t)) return 18.5;                 // between s (18) and t (19)
    var c = t.charCodeAt(0);
    if (c >= 97 && c <= 122) return c - 97;              // a..z -> 0..25
    if (c >= 48 && c <= 57) return -1;                   // digits before A
    if (c >= 0x3040 && c <= 0x9fff) return 40;           // kana / kanji: one far bucket
    return 60;                                           // anything else
  }
  function adjacency(prevTitle, title) {
    if (!prevTitle) return 0.3;                          // first book of the run
    var d = Math.abs(letterIndex(prevTitle) - letterIndex(title));
    if (d < 0.6) return 1;
    if (d <= 1) return 0.6;
    if (d <= 2) return 0.3;
    return 0;
  }

  /* ------------------------------------------------------------ archetypes */

  // Every genre value in library.json maps onto one of these. The 'skill'
  // is what reading a defeated book of that kind teaches you.
  var ARCH = {
    treatise:  { name: 'Treatise',  skill: 'Refute',  hits: 'lectures you on',
                 trait: 'drains 1 Attention per hit',
                 skillDesc: 'incoming damage -1 per level (max 2)' },
    textbook:  { name: 'Textbook',  skill: 'Prove',   hits: 'sets you a problem on',
                 trait: 'armoured; deals exact damage',
                 skillDesc: '+1 attack damage per level (max 3)' },
    verse:     { name: 'Verse',     skill: 'Scan',    hits: 'recites',
                 trait: 'wildly random damage, frequent crits',
                 skillDesc: '+10% crit chance per level (max 4)' },
    scripture: { name: 'Scripture', skill: 'Absolve', hits: 'preaches',
                 trait: 'heals itself when hurt',
                 skillDesc: 'heal 2 per level when a book is defeated (max 3)' },
    novel:     { name: 'Novel',     skill: 'Plot',    hits: 'narrates',
                 trait: 'summons a sequel when nearly beaten',
                 skillDesc: 'Skim gains +1 Attention per level (max 2)' },
    folio:     { name: 'Folio',     skill: 'Compose', hits: 'dazzles you with',
                 trait: 'may dazzle you into losing a turn',
                 skillDesc: 'immune to dazzle; +3 max HP per further level' },
    chronicle: { name: 'Chronicle', skill: 'Recall',  hits: 'recounts',
                 trait: 'remembers your last verb and counters a repeat',
                 skillDesc: 'Shelve +15% per level; level 2 ignores counters' },
    grammar:   { name: 'Grammar',   skill: 'Parse',   hits: 'conjugates',
                 trait: 'scrambles your verb keys',
                 skillDesc: 'immune to scrambling; +1 max Attention per further level' },
    panel:     { name: 'Panel',     skill: 'Flip',    hits: 'hits you across panels of',
                 trait: 'fast, weak multi-hit attacks',
                 skillDesc: '20% chance per level of a free extra action (max 3)' },
    damaged:   { name: 'Damaged',   skill: 'Mend',    hits: 'sheds loose pages of',
                 trait: 'unreadable: cannot be shelved, acts at random',
                 skillDesc: '+3 max HP per level' }
  };

  var GENRE_ARCH = {
    'Philosophy & political theory':      'treatise',
    'Society, culture & ideas':           'treatise',
    'Politics, law & current affairs':    'treatise',
    'Psychology, self-help & business':   'scripture',
    'Math, CS & engineering':             'textbook',
    'Science':                            'textbook',
    'Nursing & medical':                  'textbook',
    'Test prep & study guides':           'textbook',
    'Religion & theology':                'scripture',
    'Occult & folklore':                  'scripture',
    'Literature (English & European)':    'novel',
    'Japanese literature':                'novel',
    'Light novels':                       'novel',
    'Art & visual culture':               'folio',
    'Magazines & catalogues':             'folio',
    'Music & opera':                      'folio',
    'History & biography':                'chronicle',
    'Writing, film & literary craft':     'chronicle',
    'Language study & reference':         'grammar',
    'Manga & comics':                     'panel',
    'Games & other objects':              'damaged',
    'Unidentified':                       'damaged'
  };

  function archetypeFor(book) {
    if (book.st && book.st !== 'OK') return 'damaged';
    if (book.ty === 'Poetry' || book.ty === 'Drama') return 'verse';
    if (book.ty === 'Linguistics') return 'grammar';
    return GENRE_ARCH[book.g] || 'novel';
  }

  // Page proxy: we have no page counts, so title + description length,
  // weighted by the physical type, stands in for thickness.
  var TYPE_WEIGHT = {
    'Textbook': 1.6, 'Hymnal': 1.5, 'Art': 1.5, 'Reference': 1.5, 'Technical': 1.5,
    'Nursing & medical': 1.4, 'Anthology': 1.3, 'History': 1.2, 'Religion': 1.2,
    'Manga': 0.55, 'Comics': 0.7, 'Light novel': 0.7, 'Magazine': 0.6,
    'Picture book': 0.5, "Children's": 0.5, 'Calendar': 0.4, 'Poetry': 0.8, 'Drama': 0.8
  };
  function pageProxy(book) {
    var raw = (book.t || '').length + (book.d || '').length;
    if (!book.d) raw += 40;                              // undescribed books are still books
    return raw * (TYPE_WEIGHT[book.ty] || 1);
  }

  // Publication year, falling back to the first 4-digit number in `yr`
  // ("1980s to 90s" -> 1980).
  function bookYear(book) {
    if (typeof book.y === 'number') return book.y;
    var m = /(\d{4})/.exec(book.yr || '');
    return m ? parseInt(m[1], 10) : null;
  }

  /* ------------------------------------------------------------- monsters */

  var CFG = {
    playerHp: 30,
    playerAt: 3,
    maxAt: 10,
    attackLo: 4, attackHi: 6,
    skimLo: 1,  skimHi: 2,
    skimGain: 2,
    shelveCost: 2,
    stunTurns: 2,
    readHeal: 3,
    roomHeal: 2,
    seniorYear: 1970,
    rooms: 8,
    roomSizes: [3, 3, 4, 4, 4, 4, 5, 3]   // last room: boss + 2 escorts
  };

  function makeMonster(book, depth, rng, opts) {
    opts = opts || {};
    var key = archetypeFor(book);
    var hp = Math.round(4 + pageProxy(book) / 14) + depth;
    if (key === 'damaged') hp = Math.max(3, Math.round(hp * 0.6));
    if (opts.boss) hp = Math.round(hp * 1.5) + 4;
    if (opts.sequel) hp = Math.max(3, Math.round(hp * 0.5));
    var atk = 2 + Math.floor(depth / 2) + (opts.boss ? 1 : 0);
    var year = bookYear(book);
    return {
      book: book,
      key: key,
      arch: ARCH[key],
      title: opts.sequel ? book.t + ': The Sequel' : book.t,
      hp: hp, maxHp: hp,
      atk: atk,
      armour: key === 'textbook' ? (depth >= 4 ? 2 : 1) : 0,
      year: year,
      senior: year !== null && year <= CFG.seniorYear,
      stun: 0,
      lastVerb: null,       // chronicle memory
      sequelDone: !!opts.sequel,
      boss: !!opts.boss,
      sequel: !!opts.sequel,
      seniorUsed: false
    };
  }

  // Cut a clause out of the description for attack flavour.
  function flavourClause(book, rng) {
    var d = book.d || '';
    var parts = d.split(/[.;:()]\s*|,\s+(?:and|or|with|but)\s+/).map(function (s) {
      return s.trim().replace(/^(and|or|with|but)\s+/i, '').replace(/[.,;]+$/, '');
    }).filter(function (s) { return s.length >= 12 && s.length <= 90; });
    if (!parts.length) return null;
    return rng.pick(parts);
  }

  /* -------------------------------------------------------------- dungeon */

  // Shelves in walking order: units alphabetically, shelves in catalogue
  // order within a unit. "Loose" (held or on the floor) is not a room.
  function shelfList(books) {
    var order = [], byKey = {};
    books.forEach(function (b) {
      if (!b.u || !b.s || b.u === 'Loose') return;
      var k = b.u + '/' + b.s;
      if (!byKey[k]) { byKey[k] = { unit: b.u, shelf: b.s, key: k, books: [] }; order.push(byKey[k]); }
      byKey[k].books.push(b);
    });
    // Array.prototype.sort is stable, so shelves keep catalogue order inside a unit.
    order.sort(function (a, b) { return a.unit < b.unit ? -1 : a.unit > b.unit ? 1 : 0; });
    return order.filter(function (s) { return s.books.length >= 4; });
  }

  function shortShelf(s) {
    return String(s).replace(/\s*\(.*$/, '').trim();
  }

  function makeDungeon(books, seed, opts) {
    opts = opts || {};
    var rng = makeRng('dungeon:' + seed);
    var shelves = shelfList(books);
    var n = Math.min(CFG.rooms, shelves.length);
    var start = rng.int(shelves.length);
    var rooms = [];
    for (var i = 0; i < n; i++) {
      var sh = shelves[(start + i) % shelves.length];
      var last = i === n - 1;
      var size = CFG.roomSizes[i] || 4;
      var pool = sh.books.slice();
      var picked, boss = null;
      if (last) {
        // Boss: the thickest book on the final shelf.
        pool.sort(function (a, b) { return pageProxy(b) - pageProxy(a); });
        boss = pool.shift();
        picked = rng.shuffle(pool).slice(0, size - 1);
      } else {
        picked = rng.shuffle(pool).slice(0, size);
      }
      picked.sort(function (a, b) { return (a.p || 0) - (b.p || 0); });
      var monsters = picked.map(function (b) { return makeMonster(b, i, rng); });
      if (boss) monsters.push(makeMonster(boss, i, rng, { boss: true }));
      rooms.push({
        index: i, unit: sh.unit, shelf: sh.shelf, key: sh.key,
        label: 'Unit ' + sh.unit + ', shelf ' + sh.shelf,
        short: shortShelf(sh.shelf),
        shelfSize: sh.books.length,
        monsters: monsters, total: monsters.length,
        cleared: false, fled: false, visited: false
      });
    }
    return {
      seed: String(seed),
      daily: !!opts.daily,
      date: seedToDate(seed),
      rooms: rooms,
      shelfCount: shelves.length,
      bookCount: books.length
    };
  }

  /* ------------------------------------------------------------------ run */

  var VERBS = ['attack', 'skim', 'shelve', 'flee'];

  function newRun(dungeon) {
    var st = {
      dungeon: dungeon,
      rng: makeRng('combat:' + dungeon.seed),
      room: 0,
      hp: CFG.playerHp, maxHp: CFG.playerHp,
      at: CFG.playerAt, maxAt: CFG.maxAt,
      skills: {},          // skill name -> level
      bag: [],             // defeated books not yet read
      readCount: 0,
      defeated: 0,
      shelved: 0,
      turns: 0,
      lastTitle: null,     // previous book met, for the alphabet rule
      lastVerb: null,
      dazzled: false,
      scramble: null,      // permutation of VERBS for the next turn, or null
      over: false, won: false, cause: null, causeMonster: null,
      log: []
    };
    // Reset the dungeon so the same object can be replayed.
    dungeon.rooms.forEach(function (r) {
      r.cleared = false; r.fled = false; r.visited = false;
      r.monsters = r.monsters.filter(function (m) { return !m.sequel; });
      r.monsters.forEach(function (m) { m.hp = m.maxHp; m.stun = 0; m.lastVerb = null; m.seniorUsed = false; m.sequelDone = false; });
      r.total = r.monsters.length;
    });
    say(st, 'sys', 'Dungeon of ' + (dungeon.date || ('seed ' + dungeon.seed)) + (dungeon.daily ? '' : ' (random run, does not count for the daily)') + '. ' + dungeon.rooms.length + ' shelves stand between you and the exit.');
    enterRoom(st);
    return st;
  }

  function say(st, kind, text) {
    st.log.push({ kind: kind, text: text, turn: st.turns });
    if (st.log.length > 400) st.log.splice(0, st.log.length - 400);
  }

  function currentRoom(st) { return st.dungeon.rooms[st.room]; }
  function currentEnemy(st) {
    var r = currentRoom(st);
    return r && !r.cleared && !r.fled ? r.monsters[0] : null;
  }
  function skill(st, name) { return st.skills[name] || 0; }

  function enterRoom(st) {
    var r = currentRoom(st);
    r.visited = true;
    say(st, 'room', '== ' + r.label + ' (room ' + (r.index + 1) + '/' + st.dungeon.rooms.length + '). ' + r.monsters.length + ' of its ' + r.shelfSize + ' books stir.' + (r.index === st.dungeon.rooms.length - 1 ? ' The thickest one waits at the end.' : ''));
    meetEnemy(st);
  }

  function meetEnemy(st) {
    var m = currentEnemy(st);
    if (!m) return;
    say(st, 'meet', (m.boss ? 'BOSS: ' : '') + '"' + m.title + '" (' + m.arch.name + (m.year ? ', ' + m.year : '') + ', ' + m.maxHp + ' HP) faces you. It ' + m.arch.trait + '.');
    if (m.senior && !m.seniorUsed) {
      m.seniorUsed = true;
      say(st, 'enemy', 'Seniority: a book from ' + m.year + ' acts first.');
      enemyAct(st, m);
    }
  }

  // Shelve success chance for the current enemy, so the UI can show it.
  function shelveChance(st) {
    var m = currentEnemy(st);
    if (!m || m.key === 'damaged') return 0;
    var p = 0.3 + 0.5 * adjacency(st.lastTitle, m.title) + 0.15 * Math.min(3, skill(st, 'Recall'));
    return Math.min(0.95, p);
  }

  function damagePlayer(st, m, dmg, why) {
    dmg = Math.max(0, dmg - Math.min(2, skill(st, 'Refute')));
    st.hp -= dmg;
    if (why) say(st, 'enemy', why + (dmg > 0 ? ' for ' + dmg + '.' : ', but it glances off.'));
    if (st.hp <= 0) {
      st.hp = 0; st.over = true; st.won = false;
      st.cause = m ? m.title : 'exhaustion';
      st.causeMonster = m;
      say(st, 'death', 'You are killed by "' + st.cause + '".');
      say(st, 'summary', summary(st));
    }
  }

  function flavour(st, m) {
    var c = flavourClause(m.book, st.rng);
    return c ? '"' + m.title + '" ' + m.arch.hits + ' ‘' + c + '’'
             : '"' + m.title + '" swings its ' + (m.book.ty || 'cover').toLowerCase() + ' at you';
  }

  function enemyAct(st, m) {
    if (st.over || !m || m.hp <= 0) return;
    if (m.stun > 0) {
      m.stun--;
      say(st, 'enemy', '"' + m.title + '" is bound on the shelf' + (m.stun ? ' (' + m.stun + ' more turn' + (m.stun > 1 ? 's' : '') + ')' : ' and works itself loose') + '.');
      return;
    }
    var key = m.key;
    if (key === 'damaged') key = st.rng.pick(['treatise', 'textbook', 'verse', 'scripture', 'folio', 'grammar', 'panel']);
    var repeat = m.key === 'chronicle' && m.lastVerb && st.lastVerb === m.lastVerb && skill(st, 'Recall') < 2;
    var dmg = m.atk;
    switch (key) {
      case 'scripture':
        if (m.hp < m.maxHp / 2 && st.rng.chance(0.5)) {
          var heal = Math.min(3, m.maxHp - m.hp);
          m.hp += heal;
          say(st, 'enemy', '"' + m.title + '" recites a passage and heals ' + heal + '.');
          break;
        }
        damagePlayer(st, m, dmg, flavour(st, m));
        break;
      case 'novel':
        if (!m.sequelDone && m.hp <= m.maxHp / 3) {
          m.sequelDone = true;
          var seq = makeMonster(m.book, currentRoom(st).index, st.rng, { sequel: true });
          currentRoom(st).monsters.splice(1, 0, seq);
          currentRoom(st).total++;
          say(st, 'enemy', '"' + m.title + '" announces a sequel. "' + seq.title + '" joins the queue.');
          break;
        }
        damagePlayer(st, m, dmg, flavour(st, m));
        break;
      case 'treatise':
        var drained = Math.min(1, st.at);
        st.at -= drained;
        damagePlayer(st, m, dmg, flavour(st, m) + (drained ? ' and drains ' + drained + ' Attention' : ''));
        break;
      case 'textbook':
        damagePlayer(st, m, dmg + 1, flavour(st, m) + ' (exactly)');
        break;
      case 'verse':
        var v = st.rng.range(0, dmg * 2);
        if (st.rng.chance(0.25)) { v = dmg * 2 + 2; say(st, 'enemy', 'A line lands. Critical!'); }
        damagePlayer(st, m, v, flavour(st, m));
        break;
      case 'folio':
        damagePlayer(st, m, dmg, flavour(st, m));
        if (!st.over && !skill(st, 'Compose') && st.rng.chance(0.3)) {
          st.dazzled = true;
          say(st, 'enemy', 'The plates are dazzling. You lose your next turn.');
        }
        break;
      case 'chronicle':
        if (repeat) {
          say(st, 'enemy', '"' + m.title + '" has read this move before and counters.');
          damagePlayer(st, m, dmg + 2, flavour(st, m));
        } else {
          damagePlayer(st, m, dmg, flavour(st, m));
        }
        break;
      case 'grammar':
        damagePlayer(st, m, dmg, flavour(st, m));
        if (!st.over && !skill(st, 'Parse') && st.rng.chance(0.4)) {
          st.scramble = st.rng.shuffle(VERBS);
          say(st, 'enemy', 'Your verbs are conjugated out of order. Read the keys before you press them.');
        }
        break;
      case 'panel':
        var hits = st.rng.range(2, 3), total = 0, landed = 0;
        for (var i = 0; i < hits; i++) {
          if (st.rng.chance(0.8)) { total += st.rng.range(1, Math.max(1, Math.ceil(dmg / 2))); landed++; }
        }
        damagePlayer(st, m, total, flavour(st, m) + ' (' + landed + '/' + hits + ' panels)');
        break;
      default:
        damagePlayer(st, m, dmg, flavour(st, m));
    }
    m.lastVerb = st.lastVerb;
  }

  function hitEnemy(st, m, dmg, verb) {
    var repeat = m.key === 'chronicle' && m.lastVerb && m.lastVerb === verb && skill(st, 'Recall') < 2;
    if (repeat) { dmg = Math.floor(dmg / 2); say(st, 'you', '"' + m.title + '" saw that coming; half damage.'); }
    if (m.armour) dmg = Math.max(0, dmg - m.armour);
    m.hp -= dmg;
    return dmg;
  }

  function defeat(st, m) {
    var r = currentRoom(st);
    r.monsters.shift();
    st.defeated++;
    st.lastTitle = m.title;
    if (!m.sequel) st.bag.push(m.book);
    var heal = Math.min(3, skill(st, 'Absolve')) * 2;
    if (heal) st.hp = Math.min(st.maxHp, st.hp + heal);
    say(st, 'win', '"' + m.title + '" is closed' + (m.sequel ? '.' : ' and goes in your bag.') + (heal ? ' Absolve heals ' + heal + '.' : ''));
    if (!r.monsters.length) {
      r.cleared = true;
      st.hp = Math.min(st.maxHp, st.hp + CFG.roomHeal);
      if (r.index === st.dungeon.rooms.length - 1) {
        st.over = true; st.won = true;
        say(st, 'victory', 'The last shelf is quiet. You walk out of the library with ' + st.bag.length + ' unread books under your arm.');
        say(st, 'summary', summary(st));
      } else {
        say(st, 'room', 'Shelf cleared. You breathe the dust and recover ' + CFG.roomHeal + ' HP. Read your bag for free, then move on (4).');
      }
    } else {
      meetEnemy(st);
    }
  }

  // Skill from reading a book. Returns the skill name.
  function learn(st, book) {
    var key = archetypeFor(book), name = ARCH[key].skill;
    st.skills[name] = (st.skills[name] || 0) + 1;
    var lv = st.skills[name];
    if (name === 'Compose' && lv > 1) st.maxHp += 3;
    if (name === 'Mend') st.maxHp += 3;
    if (name === 'Parse' && lv > 1) st.maxAt += 1;
    return name;
  }

  // The verb the player actually performs when they press key k (1-4),
  // after any Grammar scrambling.
  function verbForKey(st, k) {
    var list = st.scramble || VERBS;
    return list[k - 1] || null;
  }

  /*
   * step(st, verb [, bookIndex]) - one player turn. verbs:
   *   attack | skim | shelve | flee | next | read
   * Everything the player needs to know goes to st.log.
   */
  function step(st, verb, bookIndex) {
    if (st.over) return;
    var r = currentRoom(st), m = currentEnemy(st);
    var lastRoom = st.room === st.dungeon.rooms.length - 1;

    if (verb === 'read') {
      if (!st.bag.length) { say(st, 'sys', 'Your bag is empty.'); return; }
      var idx = typeof bookIndex === 'number' && st.bag[bookIndex] ? bookIndex : st.bag.length - 1;
      var book = st.bag.splice(idx, 1)[0];
      var name = learn(st, book);
      st.readCount++;
      st.hp = Math.min(st.maxHp, st.hp + CFG.readHeal);
      st.at = Math.min(st.maxAt, st.at + 1);
      say(st, 'you', 'You read "' + book.t + '" and learn ' + name + ' ' + roman(st.skills[name]) + '. +' + CFG.readHeal + ' HP, +1 Attention.');
      if (m) { st.turns++; st.lastVerb = 'read'; st.scramble = null; enemyAct(st, m); }
      return;
    }

    if (verb === 'next' || (verb === 'flee' && !m)) {
      if (m || lastRoom) return;
      st.room++;
      enterRoom(st);
      return;
    }

    if (!m) { say(st, 'sys', 'The shelf is quiet. Read your bag (5) or move on (4).'); return; }
    if (VERBS.indexOf(verb) < 0) return;

    // Checks that do not use a turn.
    if (verb === 'shelve') {
      if (m.key === 'damaged') { say(st, 'sys', 'You cannot shelve what you cannot read. (No turn used.)'); return; }
      if (st.at < CFG.shelveCost) { say(st, 'sys', 'Shelve needs ' + CFG.shelveCost + ' Attention. (No turn used.)'); return; }
    }
    if (verb === 'flee' && lastRoom) { say(st, 'sys', 'The exit is behind the last shelf. There is nowhere to run. (No turn used.)'); return; }

    st.turns++;
    st.scramble = null;

    if (st.dazzled) {
      st.dazzled = false;
      st.lastVerb = verb;
      say(st, 'you', 'You stare at the plates of "' + m.title + '" and forget what you meant to do.');
      enemyAct(st, m);
      return;
    }

    if (verb === 'attack') {
      var dmg = st.rng.range(CFG.attackLo, CFG.attackHi) + Math.min(3, skill(st, 'Prove'));
      var crit = st.rng.chance(0.05 + 0.1 * Math.min(4, skill(st, 'Scan')));
      if (crit) dmg *= 2;
      var dealt = hitEnemy(st, m, dmg, verb);
      say(st, 'you', 'You read "' + m.title + '" aggressively' + (crit ? ' (critical!)' : '') + ' for ' + dealt + (m.armour ? ' (armour ' + m.armour + ')' : '') + '.');
    } else if (verb === 'skim') {
      var s = st.rng.range(CFG.skimLo, CFG.skimHi);
      var gain = CFG.skimGain + Math.min(2, skill(st, 'Plot'));
      var got = hitEnemy(st, m, s, verb);
      st.at = Math.min(st.maxAt, st.at + gain);
      say(st, 'you', 'You skim "' + m.title + '" for ' + got + ' and gather ' + gain + ' Attention.');
    } else if (verb === 'shelve') {
      st.at -= CFG.shelveCost;
      var p = shelveChance(st);
      if (st.rng.chance(p)) {
        m.stun = CFG.stunTurns;
        st.shelved++;
        say(st, 'you', 'You slide "' + m.title + '" back into place' + (st.lastTitle ? ' beside "' + st.lastTitle + '"' : '') + '. It is bound for ' + CFG.stunTurns + ' turns.');
      } else {
        say(st, 'you', '"' + m.title + '" will not sit' + (st.lastTitle ? ' next to "' + st.lastTitle + '"' : ' still') + ' (' + Math.round(p * 100) + '%). It slips out again.');
      }
    } else if (verb === 'flee') {
      st.lastVerb = verb;
      say(st, 'you', 'You back away from "' + m.title + '". It gets a parting shot.');
      enemyAct(st, m);
      if (st.over) return;
      r.fled = true;
      st.lastTitle = m.title;
      st.room++;
      enterRoom(st);
      return;
    }
    st.lastVerb = verb;

    if (m.hp <= 0) { defeat(st, m); return; }
    if (skill(st, 'Flip') && st.rng.chance(0.2 * Math.min(3, skill(st, 'Flip')))) {
      say(st, 'you', 'Flip: you turn the page before "' + m.title + '" can answer.');
      return;
    }
    enemyAct(st, m);
  }

  function roman(n) { return ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'][n] || String(n); }

  /* ---------------------------------------------------------- scoring */

  function roomsCleared(st) { return st.dungeon.rooms.filter(function (r) { return r.cleared; }).length; }
  function score(st) {
    return st.defeated * 10 + roomsCleared(st) * 25 + (st.won ? 100 + st.hp * 2 : 0);
  }
  function skillList(st) {
    return Object.keys(st.skills).map(function (k) { return k + ' ' + roman(st.skills[k]); }).join(', ') || 'none';
  }
  function summary(st) {
    var d = st.dungeon;
    var lines = [];
    lines.push('Library Roguelike, dungeon of ' + (d.date || ('seed ' + d.seed)) + (d.daily ? '' : ' (random run)'));
    lines.push((st.won ? 'Escaped the library' : 'Died in ' + currentRoom(st).label) + ' after ' + st.turns + ' turns.');
    lines.push('Shelves cleared ' + roomsCleared(st) + '/' + d.rooms.length + ', books defeated ' + st.defeated + ', read ' + st.readCount + ', shelved ' + st.shelved + '. Score ' + score(st) + '.');
    if (!st.won) lines.push('Killed by "' + st.cause + '"' + (st.causeMonster ? ' (' + st.causeMonster.arch.name + ', ' + currentRoom(st).label + ')' : '') + '.');
    lines.push('Skills: ' + skillList(st) + '.');
    return lines.join('\n');
  }

  return {
    CFG: CFG, ARCH: ARCH, GENRE_ARCH: GENRE_ARCH, VERBS: VERBS,
    makeRng: makeRng, hashString: hashString, dailySeed: dailySeed, seedToDate: seedToDate,
    letterIndex: letterIndex, adjacency: adjacency,
    archetypeFor: archetypeFor, pageProxy: pageProxy, bookYear: bookYear,
    shelfList: shelfList, makeDungeon: makeDungeon,
    newRun: newRun, step: step, currentRoom: currentRoom, currentEnemy: currentEnemy,
    shelveChance: shelveChance, verbForKey: verbForKey,
    score: score, summary: summary, skillList: skillList, roomsCleared: roomsCleared, roman: roman
  };
});
