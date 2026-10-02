/* Library Orrery: drawing and interaction. The mechanics live in orrery.js. */
(function () {
  'use strict';
  var O = window.Orrery;
  var $ = function (id) { return document.getElementById(id); };
  var qs = new URLSearchParams(location.search);
  var THUMB = qs.get('thumb') === '1';
  var reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  var TAU = Math.PI * 2;
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var SPEEDS = { rt: 1 / 31557600, hour: 1 / 8766, day: 1 / 365.25, week: 7 / 365.25, month: 1 / 12, year: 1, decade: 10, century: 100 };
  var MAX_OFFSET = 5000;

  var canvas = $('sky'), ctx = canvas.getContext('2d');
  var W = 0, H = 0, dpr = 1;
  var sys = null, now = O.yearFloat();
  var st = {
    t: now, live: true, playing: true, speed: 'month', follow: null,
    selected: null, hover: null, pinned: [], pairA: null, pairB: null, events: [], eventsFrom: null,
    family: null, labels: [], labelsAt: 0, labelsKey: '', skyAt: -1, dirty: true
  };
  var cam = { x: 0, y: 0, s: 60 };
  var flight = null, lastMs = 0, frameT = 0, lastSync = 0;
  var sideEl = $('side'), tipEl = $('tip'), stripBody = $('strip-body');

  /* ---------- canvas plumbing ---------- */
  var starLayer = null, starPattern = null, twinkles = [], orbitLayer = null, orbitKey = '';
  var sprites = {};
  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    buildStars();
    orbitKey = '';
    st.dirty = true;
  }
  function viewCenter() {
    var cx = W / 2, cy = H / 2;
    if (!THUMB) {
      if (W > 760) cx = (W - 324 - 24) / 2;
      else if (sideEl.classList.contains('open')) cy = Math.max(H * 0.22, (H - Math.min(H * 0.6, sideEl.offsetHeight)) / 2);
    }
    return { x: cx, y: cy };
  }
  function toScreen(x, y) { var c = viewCenter(); return { x: c.x + (x - cam.x) * cam.s, y: c.y - (y - cam.y) * cam.s }; }
  function toWorld(sx, sy) { var c = viewCenter(); return { x: cam.x + (sx - c.x) / cam.s, y: cam.y - (sy - c.y) / cam.s }; }

  function buildStars() {
    var size = 1024;
    starLayer = document.createElement('canvas');
    starLayer.width = size; starLayer.height = size;
    var g = starLayer.getContext('2d');
    var n = 900;
    for (var i = 0; i < n; i++) {
      var x = O.unit('sx' + i) * size, y = O.unit('sy' + i) * size, m = O.unit('sm' + i);
      var r = m < 0.85 ? 0.6 : (m < 0.97 ? 1.0 : 1.5);
      var a = 0.25 + 0.6 * O.unit('sa' + i);
      var tint = O.unit('st' + i);
      g.fillStyle = tint < 0.15 ? 'rgba(255,220,180,' + a + ')' : (tint < 0.3 ? 'rgba(180,205,255,' + a + ')' : 'rgba(232,230,223,' + a + ')');
      g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
    }
    starPattern = ctx.createPattern(starLayer, 'repeat');
    twinkles = [];
    for (var k = 0; k < 70; k++) twinkles.push({ x: O.unit('tx' + k), y: O.unit('ty' + k), f: 0.4 + O.unit('tf' + k) * 1.2, p: O.unit('tp' + k) * TAU, r: 0.9 + O.unit('tr' + k) * 1.1 });
  }
  function sprite(color) {
    if (sprites[color]) return sprites[color];
    var c = document.createElement('canvas'); c.width = 64; c.height = 64;
    var g = c.getContext('2d');
    var grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, hexA(color, 0.55)); grad.addColorStop(0.35, hexA(color, 0.18)); grad.addColorStop(1, hexA(color, 0));
    g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
    sprites[color] = c;
    return c;
  }
  function hexA(hex, a) {
    var r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
  }

  /* ---------- time ---------- */
  function fmtDate(t, withDay) {
    if (Math.abs(t) > 200000) return 'year ' + Math.round(t).toLocaleString();
    var d = O.dateFromYear(t), y = d.getFullYear();
    var ys = y <= 0 ? (1 - y) + ' BC' : (y < 1000 ? y + ' AD' : String(y));
    if (!withDay) return ys;
    return d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + ys;
  }
  function fmtOffset(dy) {
    var a = Math.abs(dy);
    var s = a < 1 / 365 ? Math.round(a * 365.25 * 24) + ' h' : (a < 1 ? Math.round(a * 365.25) + ' days' : (a < 10 ? a.toFixed(1) + ' yr' : Math.round(a).toLocaleString() + ' yr'));
    return (dy < 0 ? '−' : '+') + s;
  }
  function sliderFromOffset(off) { var v = Math.cbrt(Math.min(1, Math.abs(off) / MAX_OFFSET)) * 1000; return Math.round(off < 0 ? -v : v); }
  function offsetFromSlider(v) { var u = Math.abs(v) / 1000; var off = MAX_OFFSET * u * u * u; return v < 0 ? -off : off; }
  function setTime(t, opts) {
    opts = opts || {};
    t = Math.max(now - MAX_OFFSET, Math.min(now + MAX_OFFSET, t));
    st.t = t;
    st.live = false;
    if (opts.pause) { st.playing = false; }
    st.dirty = true;
    syncTimeUI();
  }
  function goLive() {
    now = O.yearFloat();
    st.t = now; st.live = true; st.playing = true;
    st.dirty = true;
    syncTimeUI();
  }
  function syncTimeUI() {
    var off = st.t - now;
    $('ts').value = sliderFromOffset(off);
    var big = $('clock-date');
    big.textContent = fmtDate(st.t, Math.abs(off) < 400);
    big.classList.toggle('live', st.live);
    $('clock-off').textContent = st.live ? 'live · real time' : (fmtOffset(off) + ' from now' + (st.playing ? ' · ' + $('speed').options[$('speed').selectedIndex].text : ' · paused'));
    $('btn-play').textContent = st.playing ? 'pause' : 'play';
    $('t-hint').textContent = st.live ? 'the real clock' : (st.playing ? 'playing' : 'scrubbed');
  }

  /* ---------- camera ---------- */
  function fitRadius(r, animate) {
    var c = viewCenter();
    var room = Math.min(W > 760 && !THUMB ? (W - 348) : W, H) * 0.46;
    flyTo(0, 0, Math.max(0.4, room / r), animate);
  }
  function flyTo(x, y, s, animate) {
    s = Math.max(0.4, Math.min(6000, s));
    if (!animate || reduced) { cam.x = x; cam.y = y; cam.s = s; flight = null; st.dirty = true; return; }
    flight = { x0: cam.x, y0: cam.y, s0: cam.s, x1: x, y1: y, s1: s, t0: performance.now(), dur: 900 };
  }
  function stepFlight(ms) {
    if (!flight) return;
    var u = Math.min(1, (ms - flight.t0) / flight.dur);
    var e = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
    cam.x = flight.x0 + (flight.x1 - flight.x0) * e;
    cam.y = flight.y0 + (flight.y1 - flight.y0) * e;
    cam.s = Math.exp(Math.log(flight.s0) + (Math.log(flight.s1) - Math.log(flight.s0)) * e);
    if (u >= 1) flight = null;
    st.dirty = true;
  }
  function posOf(ref, t) { return ref.members ? O.clusterPosition(ref, t) : O.positionAt(ref, t); }
  function scaleFor(ref) {
    if (ref.members) return Math.max(60 / ref.members[ref.members.length - 1].a, 30);
    if (ref.cluster) return Math.max(70 / ref.cluster.members[ref.cluster.members.length - 1].a, 30);
    return Math.max(20, Math.min(1500, 90 / (0.03 * ref.r + 0.02)));
  }
  function flyToRef(ref) {
    var p = posOf(ref, st.t);
    flyTo(p.x, p.y, Math.max(cam.s, scaleFor(ref)), true);
    st.follow = ref;
  }

  /* ---------- drawing ---------- */
  function ringVisible(sunS, rs) {
    var dx = Math.max(0, Math.max(-sunS.x, sunS.x - W)), dy = Math.max(0, Math.max(-sunS.y, sunS.y - H));
    var dmin = Math.hypot(dx, dy);
    var fx = Math.max(sunS.x, W - sunS.x), fy = Math.max(sunS.y, H - sunS.y);
    var dmax = Math.hypot(fx, fy);
    return rs + 2 >= dmin && rs - 2 <= dmax;
  }
  function famAlpha(b) { return st.family && b.family !== st.family ? 0.14 : 1; }

  function drawOrbitLayer() {
    var key = [cam.x, cam.y, cam.s, W, H, st.family && st.family.id].join('|');
    if (key === orbitKey && orbitLayer) return;
    orbitKey = key;
    if (!orbitLayer) orbitLayer = document.createElement('canvas');
    if (orbitLayer.width !== canvas.width || orbitLayer.height !== canvas.height) { orbitLayer.width = canvas.width; orbitLayer.height = canvas.height; }
    var g = orbitLayer.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    if (!sys) return;
    var sun = toScreen(0, 0);
    g.lineWidth = 1;
    var i, b, rs;
    for (i = 0; i < sys.bodies.length; i++) {
      b = sys.bodies[i];
      if (b.cluster) continue;
      rs = b.r * cam.s;
      if (rs < 1.5 || !ringVisible(sun, rs)) continue;
      var a = (b.oort ? 0.035 : 0.085) * Math.min(1, rs / 60) * famAlpha(b);
      g.strokeStyle = hexA(b.color, a);
      if (b.oort) g.setLineDash([2, 6]); else g.setLineDash([]);
      g.beginPath(); g.arc(sun.x, sun.y, rs, 0, TAU); g.stroke();
    }
    g.setLineDash([]);
    for (i = 0; i < sys.clusters.length; i++) {
      var c = sys.clusters[i];
      rs = c.r * cam.s;
      if (rs < 1.5 || !ringVisible(sun, rs)) continue;
      g.strokeStyle = hexA(c.color, 0.16 * Math.min(1, rs / 60) * famAlpha(c));
      g.lineWidth = 1.2;
      g.beginPath(); g.arc(sun.x, sun.y, rs, 0, TAU); g.stroke();
    }
  }

  function drawStars(ms) {
    ctx.fillStyle = '#070b14';
    ctx.fillRect(0, 0, W, H);
    // a little deep-space gradient so the middle glows
    var c = viewCenter();
    var grad = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, Math.max(W, H) * 0.7);
    grad.addColorStop(0, 'rgba(26, 34, 64, 0.55)'); grad.addColorStop(1, 'rgba(7, 11, 20, 0)');
    ctx.fillStyle = grad; ctx.fillRect(0, 0, W, H);
    if (starPattern) {
      ctx.save();
      ctx.translate(-cam.x * cam.s * 0.015, cam.y * cam.s * 0.015);
      ctx.fillStyle = starPattern;
      ctx.fillRect(cam.x * cam.s * 0.015 - 1024, -cam.y * cam.s * 0.015 - 1024, W + 2048, H + 2048);
      ctx.restore();
    }
    var tw = reduced ? 0 : ms / 1000;
    for (var i = 0; i < twinkles.length; i++) {
      var s = twinkles[i];
      var a = reduced ? 0.7 : 0.45 + 0.35 * Math.sin(tw * s.f + s.p);
      ctx.fillStyle = 'rgba(232,230,223,' + a.toFixed(3) + ')';
      ctx.beginPath(); ctx.arc(s.x * W, s.y * H, s.r, 0, TAU); ctx.fill();
    }
  }

  function drawSun(sun) {
    var gr = 26 + 9 * Math.log10(Math.max(1, cam.s));
    var grad = ctx.createRadialGradient(sun.x, sun.y, 0, sun.x, sun.y, gr * 2.2);
    grad.addColorStop(0, 'rgba(243,205,122,0.5)'); grad.addColorStop(0.3, 'rgba(243,205,122,0.14)'); grad.addColorStop(1, 'rgba(243,205,122,0)');
    ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(sun.x, sun.y, gr * 2.2, 0, TAU); ctx.fill();
    ctx.fillStyle = '#fff3d0'; ctx.beginPath(); ctx.arc(sun.x, sun.y, 5.5, 0, TAU); ctx.fill();
    ctx.fillStyle = '#f3cd7a'; ctx.beginPath(); ctx.arc(sun.x, sun.y, 3.5, 0, TAU); ctx.fill();
  }

  function drawHorizon(sun, east) {
    var L = Math.max(W, H) * 1.2;
    var dx = Math.cos(east), dy = -Math.sin(east);
    ctx.save();
    ctx.strokeStyle = 'rgba(232,230,223,0.09)'; ctx.setLineDash([3, 9]); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(sun.x - dx * L, sun.y - dy * L); ctx.lineTo(sun.x + dx * L, sun.y + dy * L); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(232,230,223,0.3)'; ctx.font = '10px ' + sansFont();
    var ex = sun.x + dx * Math.min(L, Math.min(W, H) * 0.44), ey = sun.y + dy * Math.min(L, Math.min(W, H) * 0.44);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('rising', ex, ey); ctx.fillText('setting', sun.x - (ex - sun.x), sun.y - (ey - sun.y));
    ctx.restore();
  }
  function sansFont() { return '-apple-system, "Segoe UI", Helvetica, Arial, "Hiragino Sans", "Yu Gothic", sans-serif'; }

  // screen positions this frame
  var SX = [], SY = [], VIS = [];
  function drawBodies(t, ms) {
    var sun = toScreen(0, 0);
    var speed = st.playing ? SPEEDS[st.speed] : 0;
    var n = sys.bodies.length;
    var coreR = Math.min(4.2, 2.0 + 0.55 * Math.log2(Math.max(1, cam.s / 40)));
    var i, b, p;
    // moon orbits first, under everything
    for (i = 0; i < sys.clusters.length; i++) {
      var c = sys.clusters[i], cp = O.clusterPosition(c, t), cs = toScreen(cp.x, cp.y);
      var span = c.members[c.members.length - 1].a * cam.s;
      if (span < 3 || cs.x < -span || cs.x > W + span || cs.y < -span || cs.y > H + span) continue;
      var strong = st.selected === c || st.hover === c;
      ctx.strokeStyle = hexA(c.color, (strong ? 0.5 : 0.16 * Math.min(1, Math.sqrt(3 / c.n))) * famAlpha(c));
      ctx.lineWidth = 1;
      for (var m = 0; m < c.members.length; m++) {
        var ar = c.members[m].a * cam.s;
        if (ar < 2) continue;
        ctx.beginPath(); ctx.arc(cs.x, cs.y, ar, 0, TAU); ctx.stroke();
      }
      ctx.fillStyle = hexA(c.color, 0.5 * famAlpha(c));
      ctx.beginPath(); ctx.arc(cs.x, cs.y, 1.6, 0, TAU); ctx.fill();
    }
    for (i = 0; i < n; i++) {
      b = sys.bodies[i];
      p = O.positionAt(b, t);
      var sx = sun.x + p.x * cam.s, sy = sun.y - p.y * cam.s;
      SX[i] = sx; SY[i] = sy;
      var vis = sx > -20 && sx < W + 20 && sy > -20 && sy < H + 20;
      VIS[i] = vis;
      if (!vis) continue;
      var fa = famAlpha(b);
      var unpub = b.pubT !== null && t < b.pubT;
      var strongB = st.selected === b || st.hover === b || b.pinnedIdx >= 0 || (b.cluster && (st.selected === b.cluster || st.hover === b.cluster));
      var col = b.color;
      var alpha = (b.oort ? 0.5 : 1) * fa * (unpub ? 0.45 : 1);
      // trail: a short arc of the orbit behind the body, longer for fast movers
      if (!unpub && !b.oort && (!reduced || speed > 0) && fa > 0.5) {
        var T = b.cluster ? b.cluster.T : b.T;
        var span2 = Math.min(1.4, 0.22 / T + (speed > 0 ? TAU * speed * 0.35 / T : 0));
        if (b.cluster) {
          var TmS = Math.min(2.2, 0.08 / b.Tm + (speed > 0 ? TAU * speed * 0.35 / b.Tm : 0));
          if (b.a * cam.s > 4) trail(b, t, TmS, col, alpha, sun, true);
          trail(b.cluster, t, span2, col, alpha * 0.5, sun, false);
        } else if (b.r * cam.s > 6) trail(b, t, span2, col, alpha, sun, false);
      }
      var cr = b.oort ? 1.3 : (b.cluster ? coreR * (b.cluster.n > 10 ? 0.55 : 0.8) : coreR);
      if (strongB) cr += 1.2;
      if (!b.oort || strongB) {
        var gsz = (strongB ? 34 : 20) + cr * 2;
        ctx.globalAlpha = alpha * (strongB ? 1 : (b.cluster && b.cluster.n > 4 ? 0.35 : 0.8));
        ctx.drawImage(sprite(col), sx - gsz / 2, sy - gsz / 2, gsz, gsz);
        ctx.globalAlpha = 1;
      }
      if (unpub) {
        ctx.strokeStyle = hexA(col, alpha); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(sx, sy, cr, 0, TAU); ctx.stroke();
      } else {
        ctx.fillStyle = hexA(col, alpha);
        ctx.beginPath(); ctx.arc(sx, sy, cr, 0, TAU); ctx.fill();
        if (strongB) { ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.beginPath(); ctx.arc(sx, sy, cr * 0.45, 0, TAU); ctx.fill(); }
      }
    }
  }
  function trail(ref, t, span, col, alpha, sun, isMoon) {
    var cx, cy, r, ang;
    if (isMoon) {
      var cp = O.clusterPosition(ref.cluster, t);
      cx = sun.x + cp.x * cam.s; cy = sun.y - cp.y * cam.s; r = ref.a * cam.s;
      ang = ref.phi0 + TAU * (t - O.EPOCH) / ref.Tm;
    } else {
      cx = sun.x; cy = sun.y; r = ref.r * cam.s;
      ang = ref.members ? O.clusterAngle(ref, t) : ref.theta0 + TAU * (t - O.EPOCH) / ref.T;
    }
    var segs = 3;
    ctx.lineWidth = 1.4;
    for (var k = 0; k < segs; k++) {
      var a0 = ang - span * (k + 1) / segs, a1 = ang - span * k / segs;
      ctx.strokeStyle = hexA(col, alpha * (0.55 - 0.16 * k));
      // canvas y is flipped: angles run clockwise on screen, so negate
      ctx.beginPath(); ctx.arc(cx, cy, r, -a1, -a0); ctx.stroke();
    }
  }

  function drawPair(t, sun) {
    if (!st.pairA || !st.pairB) return;
    var refs = [st.pairA, st.pairB];
    var angs = [];
    for (var i = 0; i < 2; i++) {
      var ref = refs[i], p = posOf(ref, t);
      var ang = O.angleOf(ref, t); angs.push(ang);
      var sx = sun.x + p.x * cam.s, sy = sun.y - p.y * cam.s;
      var L = Math.max(W, H) * 1.5;
      ctx.strokeStyle = hexA(ref.color, 0.42); ctx.lineWidth = 1; ctx.setLineDash([4, 5]);
      ctx.beginPath(); ctx.moveTo(sun.x, sun.y); ctx.lineTo(sun.x + Math.cos(ang) * L, sun.y - Math.sin(ang) * L); ctx.stroke();
      ctx.setLineDash([]);
      ctx.strokeStyle = hexA(ref.color, 0.9); ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(sx, sy, 7, 0, TAU); ctx.stroke();
    }
    var d = O.wrap(angs[1] - angs[0]);
    ctx.strokeStyle = 'rgba(243,205,122,0.6)'; ctx.lineWidth = 1.5;
    ctx.beginPath();
    if (d >= 0) ctx.arc(sun.x, sun.y, 22, -angs[1], -angs[0]); else ctx.arc(sun.x, sun.y, 22, -angs[0], -angs[1]);
    ctx.stroke();
  }

  /* labels */
  function computeLabels() {
    var key = [Math.round(cam.x * 10), Math.round(cam.y * 10), Math.round(cam.s * 10), Math.round(st.t * 12)].join('|');
    if (key === st.labelsKey && frameT - st.labelsAt < 600) return;
    st.labelsKey = key; st.labelsAt = frameT;
    var out = [], anchors = [];
    var i;
    function far(x, y, d) { for (var k = 0; k < anchors.length; k++) if (Math.hypot(anchors[k].x - x, anchors[k].y - y) < d) return false; return true; }
    // clusters with a visible moon system
    for (i = 0; i < sys.clusters.length; i++) {
      var c = sys.clusters[i], cp = O.clusterPosition(c, st.t), cs = toScreen(cp.x, cp.y);
      var span = c.members[c.members.length - 1].a * cam.s;
      if (cs.x < 0 || cs.x > W || cs.y < 0 || cs.y > H) continue;
      if (span < (c.n >= 5 ? 9 : 16)) continue;
      if (!far(cs.x, cs.y, 40)) continue;
      out.push({ ref: c, text: c.surname + ' · ' + c.n, kind: 'auto', x: cs.x, y: cs.y - span - 4, align: 'center' });
      anchors.push({ x: cs.x, y: cs.y });
    }
    // sparse single bodies, oldest first, so the outer rings get names
    var cand = [];
    for (i = 0; i < sys.bodies.length; i++) {
      var b = sys.bodies[i];
      if (!VIS[i] || b.cluster || b.oort) continue;
      if (st.family && b.family !== st.family) continue;
      cand.push(i);
    }
    cand.sort(function (p, q) { return sys.bodies[q].r - sys.bodies[p].r; });
    var max = THUMB ? 10 : 14, minD = THUMB ? 110 : 95;
    for (i = 0; i < cand.length && out.length < max + sys.clusters.length; i++) {
      var bi = cand[i], bb = sys.bodies[bi];
      if (bb.r * cam.s < 40) break;
      if (!far(SX[bi], SY[bi], minD)) continue;
      out.push({ ref: bb, text: bb.shortName, kind: 'auto', x: SX[bi], y: SY[bi] });
      anchors.push({ x: SX[bi], y: SY[bi] });
      if (out.length >= max) break;
    }
    // when zoomed right in, name everything in view
    if (cand.length <= 36) {
      for (i = 0; i < cand.length; i++) {
        var ci = cand[i], cb = sys.bodies[ci];
        if (!far(SX[ci], SY[ci], 18)) continue;
        out.push({ ref: cb, text: cb.shortName, kind: 'auto', x: SX[ci], y: SY[ci] });
        anchors.push({ x: SX[ci], y: SY[ci] });
      }
      for (i = 0; i < sys.bodies.length; i++) {
        var mb = sys.bodies[i];
        if (!VIS[i] || !mb.cluster || mb.a * cam.s < 14) continue;
        if (st.family && mb.family !== st.family) continue;
        if (!far(SX[i], SY[i], 18)) continue;
        out.push({ ref: mb, text: O.shortTitle(mb.title, 26), kind: 'auto', x: SX[i], y: SY[i] });
        anchors.push({ x: SX[i], y: SY[i] });
      }
    }
    st.labels = out;
  }
  function labelFor(ref) {
    if (ref.members) return ref.name + ' · ' + ref.n + ' books';
    var s = O.shortTitle(ref.title, 34);
    if (ref.copy > 1) s += ' (copy ' + ref.copy + ')';
    if (ref.surname) s += ' — ' + ref.surname;
    s += ', ' + ref.yearLabel;
    return s;
  }
  function drawLabels(t, sun) {
    var placed = [];
    ctx.font = '12px ' + sansFont();
    ctx.textBaseline = 'middle';
    function overlaps(rx, ry, rw, rh) {
      for (var k = 0; k < placed.length; k++) {
        var r = placed[k];
        if (rx < r.x + r.w + 4 && rx + rw + 4 > r.x && ry < r.y + r.h && ry + rh > r.y) return true;
      }
      return false;
    }
    var RB = (W > 760 && !THUMB) ? W - 348 : W; // keep labels out from under the side panel
    function put(text, x, y, color, strong, align, leader, fromX, fromY) {
      ctx.textAlign = align || 'left';
      var w = ctx.measureText(text).width;
      var rx = align === 'center' ? x - w / 2 : x, ry = y - 8, rw = w, rh = 16;
      if (strong && leader) {
        // try the quadrants around the anchor before accepting an overlap
        var cands = [[14, -14], [14, 14], [-w - 14, -14], [-w - 14, 14], [14, -30], [-w - 14, -30], [14, 30]];
        for (var q = 0; q < cands.length; q++) {
          var cx = fromX + cands[q][0], cy = fromY + cands[q][1];
          if (cx < 2 || cx + w > RB - 2 || cy - 8 < 2 || cy + 8 > H - 2) continue;
          if (!overlaps(cx, cy - 8, w, 16)) { x = cx; y = cy; rx = cx; ry = cy - 8; break; }
        }
      }
      if (rx < 2) { rx = 2; x = align === 'center' ? rx + w / 2 : rx; }
      if (rx + rw > RB - 2) { rx = RB - 2 - rw; x = align === 'center' ? rx + w / 2 : rx; }
      if (ry < 2 || ry + rh > H - 2) return false;
      if (!strong && overlaps(rx, ry, rw, rh)) return false;
      placed.push({ x: rx, y: ry, w: rw, h: rh });
      if (leader) { ctx.strokeStyle = 'rgba(232,230,223,0.35)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(fromX, fromY); ctx.lineTo(rx - 3, y); ctx.stroke(); }
      ctx.lineWidth = 3.5; ctx.strokeStyle = 'rgba(7,11,20,0.9)'; ctx.lineJoin = 'round';
      ctx.strokeText(text, x, y);
      ctx.fillStyle = color; ctx.fillText(text, x, y);
      return true;
    }
    function screenOf(ref) { var p = posOf(ref, t); return { x: sun.x + p.x * cam.s, y: sun.y - p.y * cam.s }; }
    // pinned and selected: always, with a leader
    var strongRefs = st.pinned.slice();
    if (st.selected && strongRefs.indexOf(st.selected) < 0) strongRefs.push(st.selected);
    if (st.pairA && strongRefs.indexOf(st.pairA) < 0) strongRefs.push(st.pairA);
    if (st.pairB && strongRefs.indexOf(st.pairB) < 0) strongRefs.push(st.pairB);
    ctx.font = '12px ' + sansFont();
    strongRefs.forEach(function (ref, idx) {
      var s = screenOf(ref);
      if (s.x < -300 || s.x > W + 300 || s.y < -100 || s.y > H + 100) return;
      var dir = (idx % 2 === 0) ? 1 : -1;
      put(labelFor(ref), s.x + 14, s.y - 14 * dir, ref === st.selected ? '#f3cd7a' : '#e8e6df', true, 'left', true, s.x, s.y);
    });
    if (st.hover && strongRefs.indexOf(st.hover) < 0 && !THUMB) {
      var hs = screenOf(st.hover);
      put(st.hover.members ? st.hover.name : st.hover.shortName, hs.x + 10, hs.y - 10, '#e8e6df', true);
    }
    ctx.font = '11px ' + sansFont();
    for (var i = 0; i < st.labels.length; i++) {
      var L = st.labels[i];
      if (strongRefs.indexOf(L.ref) >= 0) continue;
      var s2 = L.ref.members ? { x: L.x, y: L.y } : screenOf(L.ref);
      var col = hexA(L.ref.color, 0.85);
      if (L.align === 'center') put(L.text, s2.x, s2.y, col, false, 'center');
      else put(L.text, s2.x + 7, s2.y - 7, col, false, 'left');
    }
    // the sun's name
    ctx.font = '10px ' + sansFont(); ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(243,205,122,0.55)';
    if (sun.x > 0 && sun.x < W && sun.y > 0 && sun.y < H - 20) ctx.fillText('you, today', sun.x, sun.y + 16);
  }

  function draw(ms) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawStars(ms);
    if (!sys) { drawSun(toScreen(0, 0)); return; }
    drawOrbitLayer();
    ctx.drawImage(orbitLayer, 0, 0, W, H);
    var sun = toScreen(0, 0);
    var skyNow = st.skyCache;
    if (skyNow) drawHorizon(sun, skyNow.east);
    if (st.selected) {
      var hl = st.selected.members ? st.selected : (st.selected.cluster || st.selected);
      ctx.strokeStyle = hexA(hl.color, 0.55); ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(sun.x, sun.y, hl.r * cam.s, 0, TAU); ctx.stroke();
    }
    drawBodies(st.t, ms);
    drawPair(st.t, sun);
    drawSun(sun);
    computeLabels();
    drawLabels(st.t, sun);
  }

  /* ---------- the sky strip ---------- */
  function nameBtn(ref) {
    return '<button class="lnk" data-ref="' + ref.id + '">' + esc(O.displayName(ref)) + '</button>';
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function updateSky(force) {
    if (!sys) return;
    if (!force && Math.abs(st.t - st.skyAt) < 1 / 8766 && frameT - st.skyMs < 2500) return;
    st.skyAt = st.t; st.skyMs = frameT;
    var s = O.sky(sys, st.t, { tolDeg: 1.5, horizonDeg: 9 });
    st.skyCache = s;
    var parts = [];
    var r = s.rising[0], w = s.setting[0];
    if (r && w) parts.push(nameBtn(r.ref) + ' is rising, ' + nameBtn(w.ref) + ' is setting');
    else if (r) parts.push(nameBtn(r.ref) + ' is rising');
    else if (w) parts.push(nameBtn(w.ref) + ' is setting');
    s.conjunctions.slice(0, 2).forEach(function (p) {
      parts.push(nameBtn(p.a) + ' <span class="sym" title="conjunction">☌</span> ' + nameBtn(p.b) + ' <span class="dim">' + (p.sep * 180 / Math.PI).toFixed(1) + '° apart, every ' + O.describeDuration(p.rarity) + '</span>');
    });
    s.oppositions.slice(0, 1).forEach(function (p) {
      parts.push(nameBtn(p.a) + ' <span class="sym" title="opposition">☍</span> ' + nameBtn(p.b) + ' <span class="dim">opposed, every ' + O.describeDuration(p.rarity) + '</span>');
    });
    stripBody.innerHTML = parts.length ? parts.join('<span class="sep">·</span>') : 'a quiet sky';
    // orbit stat
    var never = 0, dated = 0;
    sys.bodies.forEach(function (b) { if (b.oort) return; dated++; var oc = O.orbitsCompleted(b, st.t); if (oc && oc.helio === 0) never++; });
    $('orbit-stat').textContent = (dated - never) + ' of ' + dated + ' dated books have completed at least one orbit; ' + (never === 0 ? 'every one of them has' : never + (never === 1 ? ' is' : ' are') + ' still on the first lap');
    // pair separation
    if (st.pairA && st.pairB) {
      var d = Math.abs(O.wrap(O.angleOf(st.pairA, st.t) - O.angleOf(st.pairB, st.t))) * 180 / Math.PI;
      $('pair-stat').textContent = 'now ' + d.toFixed(1) + '° apart · they line up every ' + O.describeDuration(O.synodic(st.pairA, st.pairB));
      if (st.events.length && (st.t > st.events[0].t + 0.01 || st.t < st.eventsFrom - 0.01)) computeEvents();
    }
  }

  /* ---------- conjunction panel ---------- */
  function computeEvents() {
    if (!st.pairA || !st.pairB) { st.events = []; renderEvents(); return; }
    st.eventsFrom = st.t;
    st.events = O.findConjunctions(st.pairA, st.pairB, st.t, { count: 6, span: 6000 });
    renderEvents();
  }
  function renderEvents() {
    var ul = $('events');
    if (!st.pairA || !st.pairB) { ul.innerHTML = '<li class="muted">pick two bodies</li>'; return; }
    if (!st.events.length) { ul.innerHTML = '<li class="muted">nothing within 6,000 years (or the same body twice)</li>'; return; }
    ul.innerHTML = st.events.map(function (e, i) {
      return '<li><span class="k" title="' + e.kind + '">' + (e.kind === 'conjunction' ? '☌' : '☍') + '</span><span class="d">' + esc(fmtDate(e.t, true)) + '</span><span class="in">in ' + O.describeDuration(e.t - st.t) + '</span><button class="small" data-ev="' + i + '">go</button></li>';
    }).join('');
  }
  $('events').addEventListener('click', function (ev) {
    var b = ev.target.closest('button[data-ev]');
    if (!b) return;
    var e = st.events[+b.dataset.ev];
    if (!e) return;
    setTime(e.t, { pause: true });
    var rA = st.pairA.members ? st.pairA.r : (st.pairA.cluster ? st.pairA.cluster.r : st.pairA.r);
    var rB = st.pairB.members ? st.pairB.r : (st.pairB.cluster ? st.pairB.cluster.r : st.pairB.r);
    var room = Math.min(W > 760 ? W - 348 : W, H) * 0.44;
    var need = room / Math.max(rA, rB);
    if (cam.s > need * 1.05 || cam.s < need * 0.35 || Math.hypot(cam.x, cam.y) > 0.2 * Math.max(rA, rB)) flyTo(0, 0, need, true);
    st.follow = null;
    updateSky(true);
  });

  /* ---------- pickers ---------- */
  function makePicker(input, list, onPick) {
    var items = [], sel = -1;
    function render() {
      list.innerHTML = items.map(function (ref, i) {
        var t = ref.members ? esc(ref.name) : esc(ref.title);
        var m = ref.members ? ref.n + ' books, shared orbit · period ' + O.describeDuration(ref.T) : esc((ref.author ? ref.author + ' · ' : '') + ref.yearLabel + (ref.oort ? ' · Oort cloud' : ''));
        return '<li role="option" data-i="' + i + '" class="' + (i === sel ? 'sel' : '') + '"><span class="t"><span class="dot" style="color:' + ref.color + ';background:' + ref.color + '"></span>' + t + '</span><span class="m">' + m + '</span></li>';
      }).join('');
      list.classList.toggle('show', items.length > 0);
    }
    function pick(i) { var ref = items[i]; if (!ref) return; items = []; sel = -1; render(); input.value = ref.members ? ref.name : ref.title; input.blur(); onPick(ref); }
    input.addEventListener('input', function () { if (!sys) return; items = O.findBodies(sys, input.value, 10); sel = items.length ? 0 : -1; render(); });
    input.addEventListener('focus', function () { if (items.length) list.classList.add('show'); });
    input.addEventListener('keydown', function (ev) {
      if (ev.key === 'ArrowDown') { sel = Math.min(items.length - 1, sel + 1); render(); ev.preventDefault(); }
      else if (ev.key === 'ArrowUp') { sel = Math.max(0, sel - 1); render(); ev.preventDefault(); }
      else if (ev.key === 'Enter') { if (sel >= 0) pick(sel); ev.preventDefault(); }
      else if (ev.key === 'Escape') { items = []; render(); input.blur(); }
      ev.stopPropagation();
    });
    list.addEventListener('mousedown', function (ev) { var li = ev.target.closest('li'); if (li) { ev.preventDefault(); pick(+li.dataset.i); } });
    document.addEventListener('pointerdown', function (ev) { if (!list.contains(ev.target) && ev.target !== input) { if (items.length) { items = []; render(); } } });
    return { set: function (ref) { input.value = ref ? (ref.members ? ref.name : ref.title) : ''; } };
  }

  /* ---------- selection, pins ---------- */
  function select(ref) {
    st.selected = ref;
    var row = $('sel-row');
    if (ref) {
      row.style.display = '';
      $('sel-chip').innerHTML = '<span class="dot" style="color:' + ref.color + ';background:' + ref.color + '"></span>' + esc(labelFor(ref));
      flyToRef(ref);
    } else { row.style.display = 'none'; st.follow = null; }
    st.dirty = true;
  }
  function togglePin(ref) {
    var i = st.pinned.indexOf(ref);
    if (i >= 0) st.pinned.splice(i, 1); else st.pinned.push(ref);
    sys.bodies.forEach(function (b) { b.pinnedIdx = -1; });
    st.pinned.forEach(function (r, k) { if (!r.members) r.pinnedIdx = k; });
    renderPins();
    st.dirty = true;
  }
  function renderPins() {
    var card = $('pin-card');
    card.style.display = st.pinned.length ? '' : 'none';
    $('pins').innerHTML = st.pinned.map(function (ref, i) {
      var oc = ref.members ? null : O.orbitsCompleted(ref, st.t);
      var orb = ref.members ? 'period ' + O.describeDuration(ref.T) : (oc ? (oc.unpublished ? 'not yet published' : oc.helio + ' orbit' + (oc.helio === 1 ? '' : 's')) : 'Oort');
      return '<li><span class="dot" style="color:' + ref.color + ';background:' + ref.color + '"></span><button class="lnk n" data-pin="' + i + '" title="fly there">' + esc(ref.members ? ref.name : O.shortTitle(ref.title, 30)) + '</button><span class="dim">' + orb + '</span><button class="small" data-unpin="' + i + '" title="unpin">&times;</button></li>';
    }).join('');
  }
  $('pins').addEventListener('click', function (ev) {
    var b = ev.target.closest('button');
    if (!b) return;
    if (b.dataset.pin !== undefined) select(st.pinned[+b.dataset.pin]);
    else if (b.dataset.unpin !== undefined) togglePin(st.pinned[+b.dataset.unpin]);
  });

  /* ---------- tooltip ---------- */
  function tipHtml(ref) {
    if (ref.members) {
      return '<div class="t">' + esc(ref.name) + '</div><div class="a">' + ref.n + ' books on a shared orbit · moon system</div>' +
        '<div class="st">mean orbit <b>' + ref.r.toFixed(2) + ' AU</b> · period <b>' + O.describeDuration(ref.T) + '</b></div>' +
        '<div class="st">' + esc(ref.members.map(function (m) { return O.shortTitle(m.title, 30); }).slice(0, 6).join(' · ')) + (ref.n > 6 ? ' …' : '') + '</div><div class="hint">click to pin</div>';
    }
    var oc = O.orbitsCompleted(ref, st.t);
    var T = ref.cluster ? ref.cluster.T : ref.T;
    var h = '<div class="t">' + esc(ref.title) + (ref.copy > 1 ? ' <span class="a">(copy ' + ref.copy + ')</span>' : '') + '</div>';
    if (ref.author) h += '<div class="a">' + esc(ref.author) + '</div>';
    h += '<div class="g"><span class="dot" style="color:' + ref.color + ';background:' + ref.color + '"></span>' + esc(ref.genre) + ' · ' + esc(ref.yearLabel) + (ref.est && !ref.oort ? ' <span class="dim">(estimated)</span>' : '') + '</div>';
    if (ref.oort) h += '<div class="st">Oort cloud · ' + ref.r.toFixed(0) + ' AU out · period <b>' + O.describeDuration(T) + '</b></div><div class="st">no date, so it drifts in the dark</div>';
    else {
      h += '<div class="st">orbit <b>' + ref.r.toFixed(2) + ' AU</b> · period <b>' + O.describeDuration(T) + '</b>' + (ref.cluster ? ' · moon of ' + esc(ref.cluster.surname) + ' (' + O.describeDuration(ref.Tm) + ')' : '') + '</div>';
      if (oc.unpublished) h += '<div class="st">not yet written: <b>' + O.describeDuration(-oc.years) + '</b> before publication</div>';
      else h += '<div class="st">orbits since publication: <b>' + oc.helio + '</b>' + (oc.helio < 3 ? ' <span class="dim">(' + Math.round(oc.fraction * 100) + '% into the next)</span>' : '') + (ref.cluster ? ' · moon laps: <b>' + oc.moon + '</b>' : '') + '</div>';
    }
    h += '<div class="hint">click to ' + (st.pinned.indexOf(ref) >= 0 ? 'unpin' : 'pin') + '</div>';
    return h;
  }
  function showTip(ref, x, y) {
    if (!ref) { tipEl.classList.remove('show'); return; }
    tipEl.innerHTML = tipHtml(ref);
    tipEl.classList.add('show');
    var r = tipEl.getBoundingClientRect();
    var tx = x + 16, ty = y + 16;
    if (tx + r.width > W - 8) tx = x - r.width - 12;
    if (ty + r.height > H - 8) ty = y - r.height - 12;
    tipEl.style.left = Math.max(4, tx) + 'px'; tipEl.style.top = Math.max(4, ty) + 'px';
  }
  function hitTest(x, y) {
    if (!sys) return null;
    var best = null, bd = 9;
    for (var i = 0; i < sys.bodies.length; i++) {
      if (!VIS[i]) continue;
      var d = Math.hypot(SX[i] - x, SY[i] - y);
      if (d < bd) { bd = d; best = sys.bodies[i]; }
    }
    if (best) return best;
    for (var k = 0; k < sys.clusters.length; k++) {
      var c = sys.clusters[k], p = O.clusterPosition(c, st.t), s = toScreen(p.x, p.y);
      var span = c.members[c.members.length - 1].a * cam.s;
      if (span < 4) continue;
      var dc = Math.hypot(s.x - x, s.y - y);
      if (dc < Math.max(10, span * 0.5) && dc < 60) return c;
    }
    return null;
  }

  /* ---------- pointer input ---------- */
  var pointers = {}, drag = null, pinch = null;
  canvas.addEventListener('pointerdown', function (ev) {
    try { canvas.setPointerCapture(ev.pointerId); } catch (e) { /* synthetic or already-released pointer */ }
    pointers[ev.pointerId] = { x: ev.clientX, y: ev.clientY };
    var keys = Object.keys(pointers);
    if (keys.length === 1) drag = { x: ev.clientX, y: ev.clientY, cx: cam.x, cy: cam.y, moved: false };
    else if (keys.length === 2) {
      var a = pointers[keys[0]], b = pointers[keys[1]];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), s: cam.s, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, cx: cam.x, cy: cam.y };
      drag = null;
    }
  });
  canvas.addEventListener('pointermove', function (ev) {
    if (pointers[ev.pointerId]) pointers[ev.pointerId] = { x: ev.clientX, y: ev.clientY };
    if (pinch) {
      var keys = Object.keys(pointers);
      if (keys.length >= 2) {
        var a = pointers[keys[0]], b = pointers[keys[1]];
        var d = Math.hypot(a.x - b.x, a.y - b.y);
        var mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        var ns = Math.max(0.4, Math.min(6000, pinch.s * d / Math.max(10, pinch.d)));
        // keep the world point under the pinch midpoint fixed, and follow the midpoint's drift
        var c = viewCenter();
        var wx = pinch.cx + (pinch.mx - c.x) / pinch.s, wy = pinch.cy - (pinch.my - c.y) / pinch.s;
        cam.s = ns;
        cam.x = wx - (mx - c.x) / ns; cam.y = wy + (my - c.y) / ns;
        flight = null; st.follow = null; st.dirty = true;
      }
      return;
    }
    if (drag) {
      var dx = ev.clientX - drag.x, dy = ev.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) > 4) { drag.moved = true; canvas.classList.add('drag'); }
      if (drag.moved) {
        cam.x = drag.cx - dx / cam.s; cam.y = drag.cy + dy / cam.s;
        flight = null; st.follow = null; st.dirty = true;
      }
      return;
    }
    if (ev.pointerType === 'mouse') {
      var h = hitTest(ev.clientX, ev.clientY);
      if (h !== st.hover) { st.hover = h; st.dirty = true; canvas.classList.toggle('hit', !!h); }
      if (h) showTip(h, ev.clientX, ev.clientY); else showTip(null);
    }
  });
  function endPointer(ev) {
    delete pointers[ev.pointerId];
    var keys = Object.keys(pointers);
    if (keys.length < 2) pinch = null;
    if (drag && keys.length === 0) {
      if (!drag.moved) {
        var h = hitTest(ev.clientX, ev.clientY);
        if (h) { togglePin(h); if (ev.pointerType !== 'mouse') { st.hover = h; showTip(h, ev.clientX, ev.clientY); } }
        else { if (ev.pointerType !== 'mouse') { st.hover = null; showTip(null); } }
      }
      drag = null; canvas.classList.remove('drag');
    }
    if (keys.length === 1) { var p = pointers[keys[0]]; drag = { x: p.x, y: p.y, cx: cam.x, cy: cam.y, moved: true }; }
  }
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('pointerleave', function () { if (!drag) { st.hover = null; showTip(null); canvas.classList.remove('hit'); st.dirty = true; } });
  canvas.addEventListener('wheel', function (ev) {
    ev.preventDefault();
    var f = Math.exp(-ev.deltaY * (ev.deltaMode === 1 ? 0.05 : 0.0016));
    zoomAt(ev.clientX, ev.clientY, f);
  }, { passive: false });
  canvas.addEventListener('dblclick', function (ev) { zoomAt(ev.clientX, ev.clientY, 2.2); });
  function zoomAt(sx, sy, f) {
    var w = toWorld(sx, sy);
    var ns = Math.max(0.4, Math.min(6000, cam.s * f));
    f = ns / cam.s;
    cam.x = w.x - (w.x - cam.x) / f; cam.y = w.y - (w.y - cam.y) / f; cam.s = ns;
    flight = null; st.follow = null; st.dirty = true;
  }

  /* ---------- UI wiring ---------- */
  $('ts').addEventListener('input', function () { st.playing = false; setTime(now + offsetFromSlider(+this.value)); });
  $('ts').addEventListener('change', function () { computeEvents(); updateSky(true); });
  $('btn-play').addEventListener('click', function () { st.playing = !st.playing; if (!st.playing) st.live = false; syncTimeUI(); });
  $('speed').addEventListener('change', function () { st.speed = this.value; if (st.playing) st.live = false; syncTimeUI(); });
  $('btn-now').addEventListener('click', function () { goLive(); computeEvents(); updateSky(true); });
  function step(dir) {
    var sp = SPEEDS[st.speed];
    var dt = st.speed === 'rt' ? 1 / 365.25 : sp * 10;
    setTime(st.t + dir * dt, { pause: true }); computeEvents(); updateSky(true);
  }
  $('btn-back').addEventListener('click', function () { step(-1); });
  $('btn-fwd').addEventListener('click', function () { step(1); });
  Array.prototype.forEach.call(document.querySelectorAll('.zoomto'), function (b) {
    b.addEventListener('click', function () { st.follow = null; fitRadius(+b.dataset.r, true); });
  });
  $('sel-clear').addEventListener('click', function () { select(null); });
  function setSheet(open) {
    sideEl.classList.toggle('open', open);
    document.body.classList.toggle('sheet', open);
    st.dirty = true;
  }
  $('btn-panels').addEventListener('click', function () { setSheet(!sideEl.classList.contains('open')); });
  $('btn-sheet-close').addEventListener('click', function () { setSheet(false); });
  $('strip').addEventListener('click', onNameClick);
  function onNameClick(ev) {
    var b = ev.target.closest('button[data-ref]');
    if (!b || !sys) return;
    var ref = sys.byId[b.dataset.ref] || sys.clusters.filter(function (c) { return c.id === b.dataset.ref; })[0];
    if (ref) select(ref);
  }
  document.addEventListener('keydown', function (ev) {
    if (ev.target && /input|select|textarea/i.test(ev.target.tagName)) return;
    if (ev.key === ' ') { ev.preventDefault(); $('btn-play').click(); }
    else if (ev.key === 'ArrowLeft') { step(-1); }
    else if (ev.key === 'ArrowRight') { step(1); }
    else if (ev.key === 'n' || ev.key === 'N') { $('btn-now').click(); }
    else if (ev.key === 'Escape') { select(null); }
    else if (ev.key === '+' || ev.key === '=') { zoomAt(viewCenter().x, viewCenter().y, 1.4); }
    else if (ev.key === '-') { zoomAt(viewCenter().x, viewCenter().y, 1 / 1.4); }
  });
  window.addEventListener('resize', resize);

  var pickA, pickB;
  function buildLegend() {
    var counts = {};
    sys.bodies.forEach(function (b) { counts[b.family.id] = (counts[b.family.id] || 0) + 1; });
    var el = $('legend');
    el.innerHTML = O.FAMILIES.map(function (f) {
      return '<button data-fam="' + f.id + '" title="' + esc(f.genres.join(', ')) + '"><span class="dot" style="color:' + f.color + ';background:' + f.color + '"></span><span>' + esc(f.name) + '</span><span class="c">' + (counts[f.id] || 0) + '</span></button>';
    }).join('');
    el.addEventListener('click', function (ev) {
      var b = ev.target.closest('button[data-fam]');
      if (!b) return;
      var f = O.FAMILIES.filter(function (x) { return x.id === b.dataset.fam; })[0];
      st.family = st.family === f ? null : f;
      Array.prototype.forEach.call(el.querySelectorAll('button'), function (x) { x.classList.toggle('off', !!st.family && x.dataset.fam !== st.family.id); });
      orbitKey = ''; st.labelsKey = ''; st.dirty = true;
    });
  }

  /* ---------- boot ---------- */
  function boot(books) {
    sys = O.prepare(books, now);
    sys.bodies.forEach(function (b) { b.pinnedIdx = -1; });
    buildLegend();
    pickA = makePicker($('pa'), $('pa-list'), function (ref) { st.pairA = ref; computeEvents(); updateSky(true); st.dirty = true; });
    pickB = makePicker($('pb'), $('pb-list'), function (ref) { st.pairB = ref; computeEvents(); updateSky(true); st.dirty = true; });
    makePicker($('q'), $('q-list'), function (ref) { select(ref); });
    // default pair: two famous authors, else the two biggest moon systems
    var a = O.findBodies(sys, 'nietzsche', 3).filter(function (r) { return !r.oort; })[0];
    var b = O.findBodies(sys, 'dostoevsky', 3).filter(function (r) { return !r.oort; })[0];
    if (!a || !b) { a = sys.clusters[0]; b = sys.clusters[1]; }
    st.pairA = a; st.pairB = b; pickA.set(a); pickB.set(b);
    computeEvents();
    // URL state
    if (qs.get('t')) setTime(parseFloat(qs.get('t')), { pause: true });
    if (qs.get('s')) cam.s = Math.max(0.4, Math.min(6000, parseFloat(qs.get('s'))));
    if (qs.get('x')) cam.x = parseFloat(qs.get('x'));
    if (qs.get('y')) cam.y = parseFloat(qs.get('y'));
    if (qs.get('pin')) qs.get('pin').split(',').forEach(function (id) { var ref = sys.byId[id]; if (ref) togglePin(ref); });
    if (qs.get('fam')) { var fb = $('legend').querySelector('button[data-fam="' + qs.get('fam') + '"]'); if (fb) fb.click(); }
    if (qs.get('q')) { var hit = O.findBodies(sys, qs.get('q'), 1)[0]; if (hit) { st.selected = hit; select(hit); flight = null; var hp = posOf(hit, st.t); cam.x = hp.x; cam.y = hp.y; cam.s = Math.max(cam.s, scaleFor(hit)); } }
    if (THUMB) {
      document.body.classList.add('thumb');
      st.playing = false;
      fitRadius(14.5, false);
      ['Moby Dick', 'Critique of Pure Reason', 'Zarathustra', 'Brothers Karamazov', 'War and Peace', 'Paradise Lost', 'Charles W. Eliot', 'Haruki Murakami', 'Pride and Prejudice', 'Great Expectations'].forEach(function (q) {
        var hit = O.findBodies(sys, q, 2).filter(function (r) { return r.members || !r.oort; })[0];
        if (hit && st.pinned.indexOf(hit) < 0) togglePin(hit);
      });
    } else if (!qs.get('s')) fitRadius(6.2, false);
    updateSky(true);
    syncTimeUI();
  }

  function loop(ms) {
    frameT = ms;
    var dt = lastMs ? Math.min(0.1, (ms - lastMs) / 1000) : 0;
    lastMs = ms;
    if (st.playing && sys) {
      if (st.live) { st.t = O.yearFloat(); }
      else {
        st.t += SPEEDS[st.speed] * dt;
        if (st.t > now + MAX_OFFSET || st.t < now - MAX_OFFSET) { st.t = Math.max(now - MAX_OFFSET, Math.min(now + MAX_OFFSET, st.t)); st.playing = false; }
      }
      if (!st.live) st.dirty = true;
      if (ms - lastSync > (st.live ? 1000 : 200)) { lastSync = ms; syncTimeUI(); }
      if (st.follow && !flight) { var fp = posOf(st.follow, st.t); cam.x = fp.x; cam.y = fp.y; }
    }
    stepFlight(ms);
    if (!reduced) st.dirty = true;
    if (sys) updateSky(false);
    if (st.dirty) { draw(ms); st.dirty = false; }
    requestAnimationFrame(loop);
  }

  window.__orrery = { state: st, cam: cam, system: function () { return sys; }, flying: function () { return !!flight; }, screenOf: function (ref) { var p = posOf(ref, st.t); return toScreen(p.x, p.y); }, hitTest: hitTest };
  resize();
  requestAnimationFrame(loop);
  fetch('../../assets/data/library.json').then(function (r) {
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }).then(function (d) {
    boot(d.books || []);
  }).catch(function (err) {
    $('fallback-msg').textContent = 'Could not load the library catalogue (../../assets/data/library.json): ' + (err && err.message ? err.message : err);
    $('fallback').classList.add('show');
    stripBody.textContent = 'no catalogue, no sky';
  });
})();
