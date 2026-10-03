// Terminus: the simulation. No DOM in here; it runs in the browser as
// window.TerminusSim and under Node as module.exports (see test.js).
//
// Stations are bookcase units, passengers are real books that want to get
// home to the unit where they are shelved. The player's lines are arrays of
// station ids; trains shuttle back and forth along them. Routing is a tiny
// Dijkstra over (station, line) states so books transfer at interchanges.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TerminusSim = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function hashStr(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h >>> 0;
  }

  // ---- Geometry -----------------------------------------------------------

  // Octilinear path between two points: a diagonal leg, then an axis-aligned
  // leg. The endpoints are sorted first so both directions share one geometry
  // (lines on the same pair of stations then run parallel).
  function octiPath(a, b) {
    var flip = (b.x < a.x) || (b.x === a.x && b.y < a.y);
    var p = flip ? b : a, q = flip ? a : b;
    var dx = q.x - p.x, dy = q.y - p.y, ax = Math.abs(dx), ay = Math.abs(dy), d = Math.min(ax, ay);
    var sx = dx < 0 ? -1 : 1, sy = dy < 0 ? -1 : 1;
    var pts = [{ x: p.x, y: p.y }];
    if (d > 0.5 && Math.abs(ax - ay) > 0.5) pts.push({ x: p.x + sx * d, y: p.y + sy * d });
    pts.push({ x: q.x, y: q.y });
    if (flip) pts.reverse();
    var len = 0;
    for (var i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    return { pts: pts, len: len };
  }
  function pointAt(pts, s) {
    for (var i = 1; i < pts.length; i++) {
      var dx = pts[i].x - pts[i - 1].x, dy = pts[i].y - pts[i - 1].y, L = Math.hypot(dx, dy);
      if (s <= L || i === pts.length - 1) {
        var t = L ? Math.max(0, Math.min(1, s / L)) : 0;
        return { x: pts[i - 1].x + dx * t, y: pts[i - 1].y + dy * t, angle: Math.atan2(dy, dx) };
      }
      s -= L;
    }
    return { x: pts[0].x, y: pts[0].y, angle: 0 };
  }
  function orient(a, b, c) { return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x); }
  function segsCross(p1, p2, p3, p4) {
    var d1 = orient(p3, p4, p1), d2 = orient(p3, p4, p2), d3 = orient(p1, p2, p3), d4 = orient(p1, p2, p4);
    return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
  }
  function crossesRiver(pts, river) {
    if (!river || river.length < 2) return false;
    for (var i = 1; i < pts.length; i++)
      for (var j = 1; j < river.length; j++)
        if (segsCross(pts[i - 1], pts[i], river[j - 1], river[j])) return true;
    return false;
  }

  // ---- Rules ---------------------------------------------------------------

  var DEFAULT_RULES = {
    stationCap: 8,        // waiting books before a station starts to overcrowd
    interchangeCap: 14,
    overflowTime: 42,     // seconds of overcrowding before the game ends
    recoverTime: 18,
    trainCap: 6,          // per locomotive
    carriageCap: 6,       // per extra carriage
    dwell: 0.9,
    speed: 120,           // map units per second
    dayLen: 24,           // one sim second per hour
    daysPerWeek: 7,
    startLines: 3, maxLines: 6,
    startTrains: 3, startTunnels: 1,
    spawnBase: 4.2, spawnDecay: 0.9, spawnMin: 0.3,
    transferPenalty: 2, routeSlack: 1,
    ledgerMax: 120,
  };
  var UPGRADES = ['train', 'tunnel', 'carriage', 'interchange'];
  var DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

  // ---- Game ----------------------------------------------------------------

  function createGame(opts) {
    var rules = Object.assign({}, DEFAULT_RULES, opts.rules || {});
    var seed = typeof opts.seed === 'number' ? opts.seed : hashStr(String(opts.seed || 'terminus'));
    var rng = mulberry32(seed);
    var G = {
      rules: rules, seed: seed, river: opts.river || [],
      stations: {}, stationList: [], lines: [], trains: [],
      time: 0, day: 0, week: 0, score: 0, ledger: [], spawned: 0,
      over: false, overStation: null, pending: null, placing: null,
      tunnels: rules.startTunnels, linesUnlocked: rules.startLines,
      nextSpawn: 2.5, topo: 0, nextId: 1, events: [], queued: [],
    };
    opts.stations.forEach(function (s) {
      var st = { id: s.id, name: s.name, x: s.x, y: s.y, count: s.count || 0, shape: s.shape || 'circle',
        waiting: [], overflow: 0, interchange: false, delivered: 0, arrivals: 0 };
      G.stations[s.id] = st; G.stationList.push(st);
    });
    var books = (opts.books || []).filter(function (b) { return G.stations[b.u]; });
    var deck = books.slice();
    for (var i = deck.length - 1; i > 0; i--) { var j = Math.floor(rng() * (i + 1)); var t = deck[i]; deck[i] = deck[j]; deck[j] = t; }
    var deckPos = 0;
    var weights = G.stationList.map(function (s) { return Math.sqrt(s.count + 12); });
    var weightSum = weights.reduce(function (a, b) { return a + b; }, 0);

    for (i = 0; i < rules.maxLines; i++) G.lines.push({ id: i, stations: [], paths: [], trains: [] });
    for (i = 0; i < rules.startTrains; i++) G.trains.push(makeTrain());

    function makeTrain() {
      return { id: G.nextId++, line: -1, at: null, from: null, to: null, s: 0, len: 0, dir: 1, dwell: 0,
        passengers: [], carriages: 0, x: 0, y: 0, angle: 0, path: null, moving: false };
    }
    function capacity(tr) { return rules.trainCap + tr.carriages * rules.carriageCap; }
    function stationCap(st) { return st.interchange ? rules.interchangeCap : rules.stationCap; }
    function lineActive(ln) { return ln.stations.length >= 2; }
    function emit(ev) { G.events.push(ev); if (G.events.length > 200) G.events.shift(); }

    // ---- Lines --------------------------------------------------------------

    function buildPaths(ids) {
      var paths = [];
      for (var i = 1; i < ids.length; i++) {
        var a = G.stations[ids[i - 1]], b = G.stations[ids[i]];
        var p = octiPath(a, b);
        paths.push({ pts: p.pts, len: p.len, river: crossesRiver(p.pts, G.river), a: ids[i - 1], b: ids[i] });
      }
      return paths;
    }
    function tunnelsUsedBy(paths) { return paths.filter(function (p) { return p.river; }).length; }
    function tunnelsUsed(exceptLine) {
      var n = 0;
      G.lines.forEach(function (ln) { if (ln.id !== exceptLine) n += tunnelsUsedBy(ln.paths); });
      return n;
    }
    // Validate a proposed station list for a line slot without applying it.
    function checkLine(idx, ids) {
      if (idx < 0 || idx >= rules.maxLines) return { ok: false, reason: 'no such line' };
      if (idx >= G.linesUnlocked) return { ok: false, reason: 'line not unlocked yet' };
      var seen = {};
      for (var i = 0; i < ids.length; i++) {
        if (!G.stations[ids[i]]) return { ok: false, reason: 'unknown station' };
        if (seen[ids[i]]) return { ok: false, reason: 'a line cannot visit a station twice' };
        seen[ids[i]] = true;
      }
      var paths = buildPaths(ids);
      var need = tunnelsUsedBy(paths), have = G.tunnels - tunnelsUsed(idx);
      if (need > have) return { ok: false, reason: 'tunnel', need: need, have: have };
      return { ok: true, paths: paths };
    }
    function setLineStations(idx, ids) {
      var chk = checkLine(idx, ids);
      if (!chk.ok) return chk;
      var ln = G.lines[idx];
      ln.stations = ids.slice();
      ln.paths = chk.paths;
      G.topo++;
      if (!lineActive(ln)) {
        ln.stations = []; ln.paths = [];
        ln.trains.slice().forEach(function (tr) { detachTrain(tr); });
      } else {
        ln.trains.forEach(function (tr) { reanchor(tr); });
      }
      assignSpares();
      return { ok: true };
    }
    function removeLine(idx) { return setLineStations(idx, []); }
    function detachTrain(tr) {
      var ln = G.lines[tr.line];
      if (ln) ln.trains = ln.trains.filter(function (t) { return t !== tr; });
      // books aboard get off at the nearest station the train was touching
      var dropAt = G.stations[tr.at || tr.from || tr.to];
      if (dropAt) tr.passengers.forEach(function (p) { p.at = dropAt.id; dropAt.waiting.push(p); });
      tr.passengers = []; tr.line = -1; tr.at = tr.from = tr.to = null; tr.path = null; tr.moving = false;
    }
    function attachTrain(tr, idx) {
      var ln = G.lines[idx];
      tr.line = idx; ln.trains.push(tr);
      // start at the station of the line with the most waiting books
      var best = ln.stations[0], bestN = -1;
      ln.stations.forEach(function (id) { var n = G.stations[id].waiting.length; if (n > bestN) { bestN = n; best = id; } });
      tr.at = best; tr.from = tr.to = null; tr.s = 0; tr.dwell = rules.dwell * 0.5; tr.moving = false;
      tr.dir = ln.stations.indexOf(best) === ln.stations.length - 1 ? -1 : 1;
      tr.x = G.stations[best].x; tr.y = G.stations[best].y;
    }
    function reanchor(tr) {
      var ln = G.lines[tr.line];
      if (tr.moving && tr.from && tr.to) {
        var i = ln.stations.indexOf(tr.from), j = ln.stations.indexOf(tr.to);
        if (i >= 0 && j >= 0 && Math.abs(i - j) === 1) { tr.path = pathBetween(ln, tr.from, tr.to); tr.dir = j > i ? 1 : -1; return; }
        // snap to whichever endpoint survives (or the first station)
        var id = j >= 0 ? tr.to : (i >= 0 ? tr.from : ln.stations[0]);
        tr.at = id; tr.from = tr.to = null; tr.moving = false; tr.s = 0; tr.dwell = rules.dwell;
        tr.x = G.stations[id].x; tr.y = G.stations[id].y;
      } else if (tr.at && ln.stations.indexOf(tr.at) < 0) {
        var k = ln.stations[0];
        tr.at = k; tr.x = G.stations[k].x; tr.y = G.stations[k].y; tr.dwell = rules.dwell;
      }
      if (tr.at) { var ai = ln.stations.indexOf(tr.at); if (ai === ln.stations.length - 1) tr.dir = -1; if (ai === 0) tr.dir = 1; }
    }
    function pathBetween(ln, from, to) {
      var i = ln.stations.indexOf(from), j = ln.stations.indexOf(to);
      var p = ln.paths[Math.min(i, j)];
      return j > i ? p.pts : p.pts.slice().reverse();
    }
    function spares() { return G.trains.filter(function (t) { return t.line < 0; }); }
    function lineLoad(ln) {
      var n = 0; ln.stations.forEach(function (id) { n += G.stations[id].waiting.length; }); return n;
    }
    function assignSpares() {
      var sp = spares();
      G.lines.forEach(function (ln) { if (lineActive(ln) && ln.trains.length === 0 && sp.length) attachTrain(sp.shift(), ln.id); });
    }
    function busiestLine() {
      var best = null, bestLoad = -1;
      G.lines.forEach(function (ln) {
        if (!lineActive(ln)) return;
        var load = (lineLoad(ln) + ln.stations.length) / Math.max(1, ln.trains.length);
        if (load > bestLoad) { bestLoad = load; best = ln; }
      });
      return best;
    }

    // ---- Routing ------------------------------------------------------------

    var routeTopo = -1, routeCache = {};
    function key(st, li) { return st + '|' + li; }
    // distance from every (station, line) state to the destination
    function distTo(dest) {
      if (routeTopo !== G.topo) { routeTopo = G.topo; routeCache = {}; }
      if (routeCache[dest]) return routeCache[dest];
      var nodes = [], dist = {};
      G.lines.forEach(function (ln) {
        if (!lineActive(ln)) return;
        ln.stations.forEach(function (id) { var k = key(id, ln.id); nodes.push({ st: id, li: ln.id, k: k }); dist[k] = id === dest ? 0 : Infinity; });
      });
      var done = {};
      for (var iter = 0; iter < nodes.length; iter++) {
        var u = null, ud = Infinity;
        for (var i = 0; i < nodes.length; i++) if (!done[nodes[i].k] && dist[nodes[i].k] < ud) { ud = dist[nodes[i].k]; u = nodes[i]; }
        if (!u) break;
        done[u.k] = true;
        var ln = G.lines[u.li], idx = ln.stations.indexOf(u.st);
        // ride one stop along the same line (edges are symmetric, so relax neighbours)
        [idx - 1, idx + 1].forEach(function (n) {
          if (n < 0 || n >= ln.stations.length) return;
          var k = key(ln.stations[n], u.li);
          if (ud + 1 < dist[k]) dist[k] = ud + 1;
        });
        // change line at this station
        G.lines.forEach(function (ln2) {
          if (ln2.id === u.li || !lineActive(ln2) || ln2.stations.indexOf(u.st) < 0) return;
          var k = key(u.st, ln2.id);
          if (ud + rules.transferPenalty < dist[k]) dist[k] = ud + rules.transferPenalty;
        });
      }
      routeCache[dest] = dist;
      return dist;
    }
    // Options for a book waiting at station st: [{line, next, cost}]
    function optionsAt(st, dest) {
      var dist = distTo(dest), out = [];
      G.lines.forEach(function (ln) {
        if (!lineActive(ln)) return;
        var idx = ln.stations.indexOf(st);
        if (idx < 0) return;
        [idx - 1, idx + 1].forEach(function (n) {
          if (n < 0 || n >= ln.stations.length) return;
          var d = dist[key(ln.stations[n], ln.id)];
          if (d < Infinity) out.push({ line: ln.id, next: ln.stations[n], cost: 1 + d });
        });
      });
      return out;
    }
    function bestCost(st, dest) {
      var b = Infinity; optionsAt(st, dest).forEach(function (o) { if (o.cost < b) b = o.cost; }); return b;
    }
    function wantsBoard(p, lineId, next) {
      var opts2 = optionsAt(p.at, p.dest), best = Infinity, mine = Infinity;
      opts2.forEach(function (o) { if (o.cost < best) best = o.cost; if (o.line === lineId && o.next === next) mine = o.cost; });
      return mine < Infinity && mine <= best + rules.routeSlack;
    }
    function shouldStay(p, st, lineId, next) {
      if (!next) return false;
      var opts2 = optionsAt(st, p.dest), best = Infinity, mine = Infinity;
      opts2.forEach(function (o) {
        var c = o.line === lineId ? o.cost : o.cost + rules.transferPenalty;
        if (c < best) best = c;
        if (o.line === lineId && o.next === next) mine = o.cost;
      });
      return mine < Infinity && mine <= best + rules.routeSlack;
    }

    // ---- Trains -------------------------------------------------------------

    function nextStation(ln, st, dir) {
      var idx = ln.stations.indexOf(st);
      if (idx < 0 || ln.stations.length < 2) return { id: null, dir: dir };
      var n = idx + dir;
      if (n < 0 || n >= ln.stations.length) { dir = -dir; n = idx + dir; }
      return { id: ln.stations[n], dir: dir };
    }
    function exchange(tr, st) {
      var ln = G.lines[tr.line], station = G.stations[st];
      var nx = nextStation(ln, st, tr.dir);
      tr.dir = nx.dir;
      station.arrivals++;
      // alight
      var keep = [];
      tr.passengers.forEach(function (p) {
        if (p.dest === st) { deliver(p, station); return; }
        if (shouldStay(p, st, ln.id, nx.id)) keep.push(p);
        else { p.at = st; p.transfers++; station.waiting.push(p); }
      });
      tr.passengers = keep;
      // board, oldest first
      var cap = capacity(tr), rest = [];
      station.waiting.forEach(function (p) {
        if (tr.passengers.length < cap && nx.id && wantsBoard(p, ln.id, nx.id)) { tr.passengers.push(p); p.at = null; }
        else rest.push(p);
      });
      station.waiting = rest;
    }
    function deliver(p, station) {
      G.score++; station.delivered++;
      var entry = { t: G.time, day: G.day, book: p.book, dest: station.id, destName: station.name, from: p.from, wait: G.time - p.born, transfers: p.transfers };
      G.ledger.push(entry);
      if (G.ledger.length > rules.ledgerMax) G.ledger.shift();
      emit({ type: 'deliver', entry: entry, x: station.x, y: station.y });
    }
    function moveTrain(tr, dt) {
      var ln = G.lines[tr.line];
      if (!ln || !lineActive(ln)) return;
      if (!tr.moving) {
        tr.dwell -= dt;
        if (tr.dwell > 0) return;
        var nx = nextStation(ln, tr.at, tr.dir);
        if (!nx.id) { tr.dwell = rules.dwell; return; }
        tr.dir = nx.dir; tr.from = tr.at; tr.to = nx.id; tr.at = null; tr.s = 0;
        tr.path = pathBetween(ln, tr.from, tr.to); tr.moving = true;
        tr.len = 0; for (var i = 1; i < tr.path.length; i++) tr.len += Math.hypot(tr.path[i].x - tr.path[i - 1].x, tr.path[i].y - tr.path[i - 1].y);
      }
      tr.s += rules.speed * dt;
      if (tr.s >= tr.len) {
        tr.at = tr.to; tr.moving = false; tr.s = 0; tr.dwell = rules.dwell;
        var stn = G.stations[tr.at]; tr.x = stn.x; tr.y = stn.y;
        exchange(tr, tr.at);
        tr.from = null; tr.to = null;
        return;
      }
      var pt = pointAt(tr.path, tr.s); tr.x = pt.x; tr.y = pt.y; tr.angle = pt.angle;
    }

    // ---- Passengers ---------------------------------------------------------

    function pickOrigin(dest) {
      for (var tries = 0; tries < 20; tries++) {
        var r = rng() * weightSum, i = 0;
        while (i < weights.length - 1 && r > weights[i]) { r -= weights[i]; i++; }
        if (G.stationList[i].id !== dest) return G.stationList[i];
      }
      for (i = 0; i < G.stationList.length; i++) if (G.stationList[i].id !== dest) return G.stationList[i];
      return null;
    }
    function spawn(book, originId) {
      if (!book) { if (!deck.length) return null; book = deck[deckPos % deck.length]; deckPos++; }
      var origin = originId && G.stations[originId] ? G.stations[originId] : pickOrigin(book.u);
      if (!origin) return null;
      var p = { id: G.nextId++, book: book, dest: book.u, from: origin.id, at: origin.id, born: G.time, transfers: 0 };
      origin.waiting.push(p); G.spawned++;
      emit({ type: 'spawn', passenger: p, x: origin.x, y: origin.y });
      return p;
    }
    function spawnInterval() {
      var base = Math.max(rules.spawnMin, rules.spawnBase * Math.pow(rules.spawnDecay, G.day));
      return base * (0.7 + 0.6 * rng());
    }

    // ---- Week cycle and upgrades --------------------------------------------

    function dayTick() {
      var d = Math.floor(G.time / rules.dayLen);
      if (d === G.day) return;
      G.day = d;
      emit({ type: 'day', day: d });
      if (d % rules.daysPerWeek === 0) {
        G.week = d / rules.daysPerWeek;
        var pool = UPGRADES.slice(), choices = [];
        while (choices.length < 2 && pool.length) choices.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
        var newLine = G.linesUnlocked < rules.maxLines;
        if (newLine) G.linesUnlocked++;
        G.pending = { week: G.week, choices: choices, newLine: newLine };
        emit({ type: 'week', week: G.week });
      }
    }
    function choose(kind) {
      if (!G.pending || G.pending.choices.indexOf(kind) < 0) return false;
      G.pending = null;
      applyUpgrade(kind);
      return true;
    }
    function applyUpgrade(kind) {
      if (kind === 'train') {
        var tr = makeTrain(); G.trains.push(tr);
        assignSpares();
        if (tr.line < 0) { var ln = busiestLine(); if (ln) attachTrain(tr, ln.id); }
      } else if (kind === 'tunnel') {
        G.tunnels++;
      } else if (kind === 'carriage') {
        var target = null, bestLoad = -1;
        G.trains.forEach(function (t) {
          if (t.line < 0) return;
          var load = lineLoad(G.lines[t.line]) - t.carriages * 100;
          if (load > bestLoad) { bestLoad = load; target = t; }
        });
        if (!target) target = G.trains[0];
        target.carriages++;
      } else if (kind === 'interchange') {
        G.placing = 'interchange';
      }
      emit({ type: 'upgrade', kind: kind });
    }
    function placeInterchange(stationId) {
      var st = G.stations[stationId];
      if (!st || G.placing !== 'interchange') return false;
      st.interchange = true; G.placing = null;
      emit({ type: 'interchange', station: stationId });
      return true;
    }
    function busiestStation() {
      var best = G.stationList[0], n = -1;
      G.stationList.forEach(function (s) { var m = s.waiting.length + s.arrivals * 0.1; if (!s.interchange && m > n) { n = m; best = s; } });
      return best;
    }

    // ---- Overcrowding -------------------------------------------------------

    function overflowTick(dt) {
      for (var i = 0; i < G.stationList.length; i++) {
        var s = G.stationList[i];
        if (s.waiting.length > stationCap(s)) {
          var was = s.overflow;
          s.overflow = Math.min(1, s.overflow + dt / rules.overflowTime);
          if (was === 0) emit({ type: 'crowd', station: s.id });
          if (s.overflow >= 1) { G.over = true; G.overStation = s.id; emit({ type: 'over', station: s.id }); return; }
        } else if (s.overflow > 0) {
          s.overflow = Math.max(0, s.overflow - dt / rules.recoverTime);
        }
      }
    }

    // ---- Main step ----------------------------------------------------------

    function tick(dt) {
      if (G.over || G.pending || G.placing) return false;
      G.time += dt;
      dayTick();
      if (G.pending) return true;
      while (G.time >= G.nextSpawn) {
        spawn(G.queued.length ? G.queued.shift() : null);
        G.nextSpawn += spawnInterval();
      }
      for (var i = 0; i < G.trains.length; i++) moveTrain(G.trains[i], dt);
      overflowTick(dt);
      return true;
    }

    function waiting() { var n = 0; G.stationList.forEach(function (s) { n += s.waiting.length; }); return n; }
    function aboard() { var n = 0; G.trains.forEach(function (t) { n += t.passengers.length; }); return n; }

    return {
      state: G, rules: rules,
      tick: tick, checkLine: checkLine, setLineStations: setLineStations, removeLine: removeLine,
      choose: choose, placeInterchange: placeInterchange, busiestStation: busiestStation,
      spawn: spawn, queue: function (book) { G.queued.push(book); },
      lineActive: lineActive, spares: spares, capacity: capacity, stationCap: stationCap,
      tunnelsUsed: function () { return tunnelsUsed(-1); }, waiting: waiting, aboard: aboard,
      optionsAt: optionsAt, bestCost: bestCost, pathBetween: pathBetween,
      dayName: function () { return DAY_NAMES[G.day % rules.daysPerWeek]; },
      lineLoad: lineLoad, makeTrain: function () { var t = makeTrain(); G.trains.push(t); return t; },
    };
  }

  // A scripted layout used by the thumbnail and the Node test. Returns the
  // number of lines it managed to place.
  function demoLayout(game, extraTunnels) {
    var G = game.state;
    G.tunnels += extraTunnels == null ? 2 : extraTunnels;
    G.linesUnlocked = Math.max(G.linesUnlocked, 4);
    while (G.trains.length < 5) game.makeTrain();
    var plan = [
      ['H', 'I', 'K', 'Loose', 'L'],
      ['A', 'B', 'K', 'F', 'N'],
      ['G', 'B', 'K', 'M', 'D'],
      ['J', 'G', 'A', 'H'],
    ];
    var placed = 0;
    plan.forEach(function (ids, i) { if (game.setLineStations(i, ids).ok) placed++; });
    // spread the spare trains over the longest lines
    var sp = game.spares();
    while (sp.length) {
      var best = null, load = -1;
      G.lines.forEach(function (ln) { if (game.lineActive(ln)) { var l = ln.stations.length / ln.trains.length; if (l > load) { load = l; best = ln; } } });
      if (!best) break;
      var tr = sp.shift(); tr.line = best.id; best.trains.push(tr);
      tr.at = best.stations[Math.floor(best.stations.length / 2)]; tr.dwell = 0.3; tr.dir = -1;
      tr.x = G.stations[tr.at].x; tr.y = G.stations[tr.at].y;
    }
    return placed;
  }

  // Run the sim forward, auto-resolving week-end choices (used by the thumbnail).
  function fastForward(game, seconds, dt, choice) {
    var G = game.state, steps = Math.ceil(seconds / dt);
    for (var i = 0; i < steps && !G.over; i++) {
      if (G.pending) game.choose(G.pending.choices.indexOf(choice) >= 0 ? choice : G.pending.choices[0]);
      if (G.placing === 'interchange') game.placeInterchange(game.busiestStation().id);
      game.tick(dt);
    }
  }

  return {
    createGame: createGame, octiPath: octiPath, pointAt: pointAt, crossesRiver: crossesRiver,
    mulberry32: mulberry32, hashStr: hashStr, DEFAULT_RULES: DEFAULT_RULES, UPGRADES: UPGRADES, DAY_NAMES: DAY_NAMES,
    demoLayout: demoLayout, fastForward: fastForward,
  };
});
