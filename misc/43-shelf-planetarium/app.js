/* Bookshelf Planetarium: chart, interaction and the bookshelf relabelling. Needs sky.js. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var Sky = window.Sky;
  var canvas = $('sky'), ctx = canvas.getContext('2d');
  var D2R = Math.PI / 180;
  function sind(x) { return Math.sin(x * D2R); }
  function cosd(x) { return Math.cos(x * D2R); }
  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  var params = new URLSearchParams(location.search);
  var THUMB = params.get('thumb') === '1';
  var REDUCED = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (THUMB) document.body.classList.add('thumb');

  var state = {
    lat: 32.99, lon: -96.75, locName: 'Texas',
    anchor: null, offMin: 0, offDay: 0,
    mode: 'dome', labels: 'author', showMW: true, showLines: true, showSkyline: true,
    panoAz: 180, selected: null, hover: null, playing: false
  };
  var data = { stars: null, cons: null, byAuthor: null, assign: {}, mw: null, seed: '' };
  var view = { W: 0, H: 0, cx: 0, cy: 0, R: 0, ppd: 1, top: 0, s: 1 };
  var PANO_TOP = 90, PANO_BOT = -10;
  var hit = { segs: [], labels: [] };
  var last = { sun: null, twilight: '' };

  // ---------- URL options
  if (params.get('lat') && params.get('lon')) {
    var plat = parseFloat(params.get('lat')), plon = parseFloat(params.get('lon'));
    if (isFinite(plat) && isFinite(plon)) { state.lat = clamp(plat, -90, 90); state.lon = clamp(plon, -180, 180); state.locName = params.get('name') || (plat.toFixed(2) + ', ' + plon.toFixed(2)); }
  }
  if (params.get('mode') === 'pano') state.mode = 'pano';
  if (params.get('az')) state.panoAz = Sky.wrap360(parseFloat(params.get('az')) || 180);
  if (params.get('t')) { var pt = new Date(params.get('t')); if (!isNaN(pt)) state.anchor = pt; }
  if (THUMB) { state.anchor = tonight23(); state.labels = 'author'; state.mode = 'dome'; }

  function tonight23() { var d = new Date(); d.setHours(23, 0, 0, 0); return d; }
  function effectiveDate() {
    var base = state.anchor ? state.anchor.getTime() : Date.now();
    return new Date(base + state.offDay * 86400000 + state.offMin * 60000);
  }
  function isLive() { return !state.anchor && !state.offDay && !state.offMin && !state.playing; }

  // ---------- loading
  function showMsg(html) { var m = $('msg'); m.innerHTML = html; m.classList.add('show'); }
  function getJSON(url) { return fetch(url).then(function (r) { if (!r.ok) throw new Error(url + ' ' + r.status); return r.json(); }); }

  Promise.all([
    getJSON('stars.json'), getJSON('constellations.json'),
    getJSON('../../assets/data/library.json').catch(function () { return null; })
  ]).then(function (res) {
    prepStars(res[0].stars);
    prepCons(res[1].constellations);
    prepLibrary(res[2]);
    data.mw = Sky.milkyWay(3600, 'shelf');
    assignAuthors();
    initUI();
    resize();
    var sel = params.get('sel');
    if (sel && data.consById[sel] && !THUMB) select(sel); else render();
    startClock();
  }).catch(function (e) {
    showMsg('<div>The star catalogue could not be loaded (' + String(e.message || e).replace(/</g, '&lt;') + ').<br>This page needs its stars.json and constellations.json beside it.</div>');
  });

  function bvColor(bv) {
    if (bv == null) return '#ffffff';
    if (bv < -0.1) return '#a4b9ff'; if (bv < 0.2) return '#cfdbff'; if (bv < 0.5) return '#f7f6ff';
    if (bv < 0.8) return '#fff3dd'; if (bv < 1.2) return '#ffe1ae'; if (bv < 1.6) return '#ffc98c'; return '#ffb074';
  }
  function prepStars(arr) {
    data.stars = arr.map(function (s) {
      return { ra: s[0], dec: s[1], mag: s[2], bv: s[3], name: s[4] || null, color: bvColor(s[3]),
        cd: cosd(s[1]), sd: sind(s[1]) };
    });
  }
  function prepCons(arr) {
    data.cons = arr.map(function (c) {
      var x = 0, y = 0, z = 0, n = 0;
      c.lines.forEach(function (line) { line.forEach(function (p) { x += cosd(p[1]) * cosd(p[0]); y += cosd(p[1]) * sind(p[0]); z += sind(p[1]); n++; }); });
      var ra = Sky.wrap360(Math.atan2(y, x) / D2R), dec = Math.atan2(z, Math.sqrt(x * x + y * y)) / D2R;
      return { id: c.id, name: c.name, area: c.area, lines: c.lines, bright: c.bright, cra: ra, cdec: dec };
    });
    data.cons.sort(function (a, b) { return b.area - a.area; });
    data.consById = {};
    data.cons.forEach(function (c) { data.consById[c.id] = c; });
  }
  function prepLibrary(lib) {
    if (!lib || !lib.books) { data.byAuthor = null; return; }
    var by = {};
    lib.books.forEach(function (b) {
      var a = (b.a || '').trim();
      if (!a || /^(various|anonymous|anon\.?|unknown)$/i.test(a)) return;
      if (!by[a]) by[a] = [];
      by[a].push({ t: b.t, y: b.y, g: b.g, ty: b.ty, l: b.l });
    });
    data.byAuthor = by;
  }

  // Deal the constellations: weighted sampling without replacement (Efraimidis-Spirakis), seeded by the day.
  function assignAuthors() {
    data.assign = {};
    var d = new Date();
    data.seed = d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
    if (!data.byAuthor) return;
    var rng = Sky.mulberry32(Sky.hash32('planetarium:' + data.seed));
    var pool = Object.keys(data.byAuthor).map(function (a) {
      var n = data.byAuthor[a].length;
      return { author: a, n: n, key: Math.pow(rng(), 1 / n) };
    });
    pool.sort(function (a, b) { return b.key - a.key; });
    var chosen = pool.slice(0, Math.min(88, pool.length));
    chosen.sort(function (a, b) { return b.n - a.n || b.key - a.key; });
    data.cons.forEach(function (c, i) {
      if (chosen[i]) data.assign[c.id] = { author: chosen[i].author, books: data.byAuthor[chosen[i].author] };
    });
    var dl = $('authors');
    dl.innerHTML = '';
    chosen.slice().sort(function (a, b) { return a.author.localeCompare(b.author); }).forEach(function (a) {
      var o = document.createElement('option'); o.value = a.author; dl.appendChild(o);
    });
  }
  function labelFor(c) {
    if (state.labels === 'none') return null;
    if (state.labels === 'author' && data.assign[c.id]) return data.assign[c.id].author;
    return c.name;
  }

  // ---------- skyline profile (degrees of altitude as a function of azimuth)
  var skyline = (function () {
    var rng = Sky.mulberry32(Sky.hash32('shelf skyline'));
    var prof = new Float32Array(1440); // 0.25 deg steps
    function bump(a0, w, fn) {
      var i0 = Math.floor((a0 - w) * 4), i1 = Math.ceil((a0 + w) * 4);
      for (var i = i0; i <= i1; i++) {
        var az = i / 4, d = az - a0, k = ((i % 1440) + 1440) % 1440;
        var h = fn(d, w); if (h > prof[k]) prof[k] = h;
      }
    }
    var az = rng() * 6;
    while (az < 360) {
      var kind = rng();
      if (kind < 0.6) { // house: gable roof, sometimes a chimney
        var w = 3.0 + rng() * 2.6, wall = 1.6 + rng() * 0.9, peak = wall + 1.0 + rng() * 1.3, side = rng() < 0.5 ? -1 : 1;
        var a0 = az + w;
        bump(a0, w, function (d, w) { return Math.abs(d) < w ? wall + (peak - wall) * (1 - Math.abs(d) / w) : 0; });
        if (rng() < 0.6) bump(a0 + side * w * 0.5, 0.3, function (d) { return Math.abs(d) < 0.3 ? peak + 0.2 : 0; });
        az += 2 * w + 0.6 + rng() * 2.4;
      } else if (kind < 0.88) { // tree: a rounded crown on a trunk
        var tw = 1.0 + rng() * 1.3, th = 2.4 + rng() * 2.2;
        bump(az + tw, tw, function (d, w) { var u = d / w; return u * u < 1 ? th - tw * 0.8 + tw * 0.8 * Math.sqrt(1 - u * u) : 0; });
        az += 2 * tw + rng() * 1.6;
      } else { // a gap with a fence
        bump(az + 1.5, 1.5, function () { return 0.6; });
        az += 3 + rng() * 3;
      }
    }
    // an invented water tower: a stem, a round tank, a mast
    bump(208, 0.7, function (d) { return Math.abs(d) < 0.7 ? 6.0 : 0; });
    bump(208, 2.4, function (d, w) { var u = d / w; return u * u < 1 ? 5.6 + 3.0 * Math.sqrt(1 - u * u) : 0; });
    bump(208, 0.15, function () { return 9.4; });
    // low grass everywhere
    for (var i = 0; i < 1440; i++) if (prof[i] < 0.5) prof[i] = 0.5;
    return function (az) { var i = Math.round(Sky.wrap360(az) * 4) % 1440; return prof[i]; };
  })();

  // ---------- projection
  function project(alt, az) {
    if (state.mode === 'dome') {
      if (alt < -30) return null;
      var r = view.R * Math.tan((90 - alt) / 2 * D2R);
      return { x: view.cx - r * sind(az), y: view.cy - r * cosd(az), r: r };
    }
    var dx = Sky.wrap180(az - state.panoAz);
    return { x: view.cx + dx * view.ppd, y: view.top + (PANO_TOP - alt) * view.ppd, dx: dx };
  }
  function onScreen(p, alt) {
    if (!p) return false;
    if (state.mode === 'dome') return alt > -0.6;
    return alt > PANO_BOT && Math.abs(p.dx) * view.ppd < view.W / 2 + 20;
  }
  function horiz(ra, dec, L) { return Sky.toHoriz(ra, dec, L, state.lat); }

  function resize() {
    var stage = $('stage');
    var rect = stage.getBoundingClientRect();
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    view.W = Math.max(200, Math.round(rect.width)); view.H = Math.max(200, Math.round(rect.height));
    canvas.width = Math.round(view.W * dpr); canvas.height = Math.round(view.H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    view.cx = view.W / 2; view.cy = view.H / 2;
    var margin = THUMB ? 24 : (view.W < 480 ? 16 : 22);
    view.R = Math.min(view.W, view.H) / 2 - margin;
    view.ppd = view.H / (PANO_TOP - PANO_BOT); view.top = 0;
    view.s = state.mode === 'dome' ? view.R / 380 : view.H / 560;
  }

  // ---------- colours
  var SKY = [
    [-24, [5, 8, 20], [11, 16, 40]],
    [-18, [7, 11, 27], [18, 27, 60]],
    [-12, [12, 22, 54], [50, 72, 128]],
    [-6, [34, 66, 136], [150, 118, 128]],
    [0, [66, 124, 206], [255, 168, 108]],
    [8, [70, 138, 228], [192, 216, 246]]
  ];
  function skyColors(sunAlt) {
    var a = clamp(sunAlt, -24, 8), i = 0;
    while (i < SKY.length - 2 && SKY[i + 1][0] < a) i++;
    var t = (a - SKY[i][0]) / (SKY[i + 1][0] - SKY[i][0]);
    function mix(k) { var c = SKY[i][k], d = SKY[i + 1][k]; return 'rgb(' + Math.round(lerp(c[0], d[0], t)) + ',' + Math.round(lerp(c[1], d[1], t)) + ',' + Math.round(lerp(c[2], d[2], t)) + ')'; }
    return { zenith: mix(1), horizon: mix(2) };
  }
  function limitMag(sunAlt) {
    if (sunAlt <= -18) return 5.3;
    if (sunAlt <= -12) return lerp(5.3, 4.2, (sunAlt + 18) / 6);
    if (sunAlt <= -6) return lerp(4.2, 2.4, (sunAlt + 12) / 6);
    if (sunAlt <= 0) return lerp(2.4, 0.2, (sunAlt + 6) / 6);
    return lerp(0.2, -3.5, clamp(sunAlt / 10, 0, 1));
  }

  // ---------- render
  function render() {
    if (!data.stars) return;
    var date = effectiveDate(), jd = Sky.toJD(date), L = Sky.lst(jd, state.lon);
    var sun = Sky.sun(jd), sunH = horiz(sun.ra, sun.dec, L);
    var moon = Sky.moon(jd), moonH = horiz(moon.ra, moon.dec, L);
    moonH.alt -= moon.parallax * cosd(moonH.alt);
    var planets = Sky.planets(jd).map(function (p) { p.h = horiz(p.ra, p.dec, L); return p; });
    last.sun = sunH; last.moon = moon; last.moonH = moonH; last.planets = planets; last.L = L; last.date = date;

    var W = view.W, H = view.H, dome = state.mode === 'dome', s = view.s;
    var cols = skyColors(sunH.alt), lim = limitMag(sunH.alt);
    var nightness = clamp((-sunH.alt - 6) / 10, 0, 1);
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    if (dome) { ctx.beginPath(); ctx.arc(view.cx, view.cy, view.R, 0, Math.PI * 2); ctx.clip(); }

    // sky
    if (dome) {
      var g = ctx.createRadialGradient(view.cx, view.cy, 0, view.cx, view.cy, view.R);
      g.addColorStop(0, cols.zenith); g.addColorStop(0.75, cols.zenith); g.addColorStop(1, cols.horizon);
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    } else {
      var hy = view.top + PANO_TOP * view.ppd;
      var lg = ctx.createLinearGradient(0, 0, 0, hy);
      lg.addColorStop(0, cols.zenith); lg.addColorStop(0.6, cols.zenith); lg.addColorStop(1, cols.horizon);
      ctx.fillStyle = lg; ctx.fillRect(0, 0, W, hy);
      ctx.fillStyle = '#04060b'; ctx.fillRect(0, hy, W, H - hy);
    }
    // sun glow on the rim
    var sunP = project(Math.max(sunH.alt, dome ? -4 : PANO_BOT + 1), sunH.az);
    if (sunP && sunH.alt > -16) {
      var ga = clamp(1 - Math.abs(sunH.alt + 2) / 15, 0, 1);
      var gr = (dome ? view.R : H) * 0.75;
      var sg = ctx.createRadialGradient(sunP.x, sunP.y, 0, sunP.x, sunP.y, gr);
      sg.addColorStop(0, 'rgba(255,170,90,' + (0.75 * ga).toFixed(3) + ')');
      sg.addColorStop(0.4, 'rgba(255,140,100,' + (0.25 * ga).toFixed(3) + ')');
      sg.addColorStop(1, 'rgba(255,120,120,0)');
      ctx.fillStyle = sg; ctx.fillRect(0, 0, W, H);
    }

    // Milky Way haze
    if (state.showMW && nightness > 0) {
      ctx.fillStyle = 'rgba(205,214,255,' + (0.07 * nightness).toFixed(3) + ')';
      var mw = data.mw, dot = 1.9 * s;
      for (var i = 0; i < mw.length; i++) {
        var mh = horiz(mw[i][0], mw[i][1], L);
        if (mh.alt < 0) continue;
        var mp = project(mh.alt, mh.az);
        if (!onScreen(mp, mh.alt)) continue;
        var rr = dot * mw[i][2];
        ctx.beginPath(); ctx.arc(mp.x, mp.y, rr, 0, Math.PI * 2); ctx.fill();
      }
    }

    // constellation lines
    hit.segs = []; hit.labels = [];
    var cons = data.cons, placed = [];
    if (state.showLines || state.selected) {
      ctx.lineCap = 'round';
      for (var c = 0; c < cons.length; c++) {
        var con = cons[c], sel = con.id === state.selected;
        if (!state.showLines && !sel) continue;
        var alpha = sel ? 0.9 : 0.32 * nightness;
        if (alpha <= 0.01) continue;
        ctx.strokeStyle = sel ? 'rgba(255,230,168,' + alpha + ')' : 'rgba(143,200,216,' + alpha.toFixed(3) + ')';
        ctx.lineWidth = sel ? 1.6 * s : 0.9 * s;
        ctx.beginPath();
        for (var l = 0; l < con.lines.length; l++) {
          var line = con.lines[l], prev = null, prevAlt = 0;
          for (var v = 0; v < line.length; v++) {
            var vh = horiz(line[v][0], line[v][1], L), vp = project(vh.alt, vh.az);
            if (prev && vp && (vh.alt > -2 || prevAlt > -2) && (dome || Math.abs(vp.dx - prev.dx) < 180)) {
              ctx.moveTo(prev.x, prev.y); ctx.lineTo(vp.x, vp.y);
              hit.segs.push({ x1: prev.x, y1: prev.y, x2: vp.x, y2: vp.y, id: con.id });
            }
            prev = vp; prevAlt = vh.alt;
          }
        }
        ctx.stroke();
      }
    }

    // stars
    var stars = data.stars, cl = cosd(state.lat), sl = sind(state.lat);
    for (var k = 0; k < stars.length; k++) {
      var st = stars[k];
      if (st.mag > lim + 0.9) break; // sorted by magnitude
      var Hh = L - st.ra;
      var sinAlt = st.sd * sl + st.cd * cl * cosd(Hh);
      if (sinAlt < -0.012) continue;
      var alt = Math.asin(sinAlt) / D2R;
      var az = Sky.wrap360(Math.atan2(sind(Hh), cosd(Hh) * sl - (st.sd / st.cd) * cl) / D2R + 180);
      var p = project(alt, az);
      if (!onScreen(p, alt)) continue;
      var a = clamp((lim - st.mag) / 1.2 + 0.25, 0, 1);
      if (a <= 0.02) continue;
      var r = Math.max(0.55, (5.7 - st.mag) * 0.5 * s);
      if (st.mag < 1.6) {
        var gg = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 3.2);
        gg.addColorStop(0, 'rgba(255,255,255,' + (0.35 * a).toFixed(3) + ')'); gg.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = gg; ctx.beginPath(); ctx.arc(p.x, p.y, r * 3.2, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = a; ctx.fillStyle = st.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    }

    // planets, Moon, Sun
    ctx.font = (10.5 * Math.max(1, s)).toFixed(1) + 'px ' + getComputedStyle(document.body).fontFamily;
    ctx.textBaseline = 'middle';
    planets.forEach(function (pl) {
      if (pl.h.alt < -0.6) return;
      var pp = project(pl.h.alt, pl.h.az); if (!onScreen(pp, pl.h.alt)) return;
      var pa = clamp((lim - pl.mag) / 1.5 + 0.35, 0, 1); if (pa <= 0.02) return;
      var pr = Math.max(2.2 * s, (5.7 - pl.mag) * 0.5 * s);
      var pg = ctx.createRadialGradient(pp.x, pp.y, 0, pp.x, pp.y, pr * 3);
      pg.addColorStop(0, 'rgba(255,240,220,' + (0.3 * pa).toFixed(3) + ')'); pg.addColorStop(1, 'rgba(255,240,220,0)');
      ctx.fillStyle = pg; ctx.beginPath(); ctx.arc(pp.x, pp.y, pr * 3, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = pa; ctx.fillStyle = pl.color; ctx.beginPath(); ctx.arc(pp.x, pp.y, pr, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(233,228,214,0.85)'; ctx.textAlign = 'left'; ctx.fillText(pl.name, pp.x + pr + 4, pp.y);
      ctx.globalAlpha = 1;
    });
    if (moonH.alt > -0.8) {
      var mP = project(moonH.alt, moonH.az);
      if (onScreen(mP, moonH.alt)) drawMoon(mP, moon, project(Math.max(sunH.alt, -80), sunH.az) || sunP, s);
    }
    if (sunH.alt > -0.9) {
      var sP = project(sunH.alt, sunH.az);
      if (onScreen(sP, sunH.alt)) {
        var sr = 6.5 * s;
        var sgg = ctx.createRadialGradient(sP.x, sP.y, sr, sP.x, sP.y, sr * 6);
        sgg.addColorStop(0, 'rgba(255,250,220,0.5)'); sgg.addColorStop(1, 'rgba(255,250,220,0)');
        ctx.fillStyle = sgg; ctx.beginPath(); ctx.arc(sP.x, sP.y, sr * 6, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#fff7d6'; ctx.beginPath(); ctx.arc(sP.x, sP.y, sr, 0, Math.PI * 2); ctx.fill();
      }
    }

    // labels
    if (state.labels !== 'none' || state.selected) {
      var fsz = clamp(11.5 * s, 10.5, 15);
      var serif = getComputedStyle(document.body).getPropertyValue('--serif') || 'Georgia, serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (var q = 0; q < cons.length; q++) {
        var cc = cons[q], isSel = cc.id === state.selected;
        if (state.labels === 'none' && !isSel) continue;
        var text = isSel && state.labels === 'none' ? (data.assign[cc.id] ? data.assign[cc.id].author : cc.name) : labelFor(cc);
        if (!text) continue;
        var ch = horiz(cc.cra, cc.cdec, L);
        if (ch.alt < (dome ? 3 : 6)) continue;
        var cp = project(ch.alt, ch.az); if (!onScreen(cp, ch.alt)) continue;
        var la = isSel ? 1 : (0.3 + 0.7 * nightness) * clamp((ch.alt + 2) / 10, 0.35, 1);
        if (text.length > 26) text = text.slice(0, 25) + '…';
        ctx.font = (isSel ? 'italic ' : '') + (isSel ? fsz * 1.15 : fsz).toFixed(1) + 'px ' + serif;
        var tw = ctx.measureText(text).width;
        if (dome) { // keep the whole word inside the rim: slide it toward the zenith if needed
          var dxr = cp.x - view.cx, dyr = cp.y - view.cy, dist = Math.sqrt(dxr * dxr + dyr * dyr), fit = view.R - tw / 2 - 8;
          if (dist > fit) { if (fit < view.R * 0.45) continue; cp = { x: view.cx + dxr * fit / dist, y: view.cy + dyr * fit / dist }; }
        }
        var bx = { x: cp.x - tw / 2 - 3, y: cp.y - fsz * 0.7, w: tw + 6, h: fsz * 1.4, id: cc.id };
        var clash = false;
        if (!isSel) for (var b = 0; b < placed.length; b++) { var o = placed[b]; if (bx.x < o.x + o.w && bx.x + bx.w > o.x && bx.y < o.y + o.h && bx.y + bx.h > o.y) { clash = true; break; } }
        if (clash) continue;
        placed.push(bx); hit.labels.push(bx);
        ctx.globalAlpha = la;
        ctx.shadowColor = 'rgba(0,0,0,0.9)'; ctx.shadowBlur = 4;
        ctx.fillStyle = isSel ? '#ffe6a8' : (state.labels === 'author' ? '#f1dfb0' : '#b8c7d6');
        ctx.fillText(text, cp.x, cp.y);
        ctx.shadowBlur = 0; ctx.globalAlpha = 1;
      }
    }

    // ground and skyline
    drawGround(dome);
    ctx.restore();
    drawFrame(dome);
    updatePanel(date, sunH, moon, planets, L);
  }

  function drawMoon(p, moon, sunP, s) {
    var r = 6.5 * s, ang = Math.atan2(sunP.y - p.y, sunP.x - p.x);
    var gl = ctx.createRadialGradient(p.x, p.y, r, p.x, p.y, r * 4);
    gl.addColorStop(0, 'rgba(240,238,225,' + (0.12 + 0.25 * moon.illum).toFixed(3) + ')'); gl.addColorStop(1, 'rgba(240,238,225,0)');
    ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(p.x, p.y, r * 4, 0, Math.PI * 2); ctx.fill();
    ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(ang);
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = '#2b2f3c'; ctx.fillRect(-r, -r, 2 * r, 2 * r);
    ctx.fillStyle = '#f3efe2';
    ctx.beginPath(); ctx.arc(0, 0, r, -Math.PI / 2, Math.PI / 2); ctx.closePath(); ctx.fill();
    var a = r * Math.abs(2 * moon.illum - 1);
    ctx.fillStyle = moon.illum >= 0.5 ? '#f3efe2' : '#2b2f3c';
    ctx.beginPath(); ctx.ellipse(0, 0, Math.max(a, 0.01), r, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function drawGround(dome) {
    ctx.fillStyle = '#04060b';
    var edge = new Path2D();
    ctx.beginPath();
    if (dome) {
      for (var az = 0; az <= 360; az += 0.25) {
        var h = state.showSkyline ? skyline(az) : 0;
        var p = project(h, az);
        if (az === 0) { ctx.moveTo(p.x, p.y); edge.moveTo(p.x, p.y); } else { ctx.lineTo(p.x, p.y); edge.lineTo(p.x, p.y); }
      }
      ctx.lineTo(view.cx, view.cy - view.R * 1.3);
      ctx.lineTo(view.cx + view.R * 1.3, view.cy - view.R * 1.3); ctx.lineTo(view.cx + view.R * 1.3, view.cy + view.R * 1.3);
      ctx.lineTo(view.cx - view.R * 1.3, view.cy + view.R * 1.3); ctx.lineTo(view.cx - view.R * 1.3, view.cy - view.R * 1.3);
      ctx.lineTo(view.cx, view.cy - view.R * 1.3);
      ctx.closePath(); ctx.fill('evenodd');
    } else {
      var half = view.W / 2 / view.ppd + 1;
      ctx.moveTo(-5, view.H + 5);
      for (var d = -half; d <= half; d += 0.25) {
        var hh = state.showSkyline ? skyline(state.panoAz + d) : 0;
        var x = view.cx + d * view.ppd, y = view.top + (PANO_TOP - hh) * view.ppd;
        ctx.lineTo(x, y); if (d === -half) edge.moveTo(x, y); else edge.lineTo(x, y);
      }
      ctx.lineTo(view.W + 5, view.H + 5); ctx.closePath(); ctx.fill();
    }
    if (state.showSkyline) { ctx.strokeStyle = 'rgba(233,228,214,0.22)'; ctx.lineWidth = 0.8; ctx.stroke(edge); }
  }

  var CARD = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  function drawFrame(dome) {
    var sans = getComputedStyle(document.body).fontFamily;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (dome) {
      ctx.strokeStyle = 'rgba(233,228,214,0.35)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(view.cx, view.cy, view.R, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = 'rgba(233,228,214,0.3)';
      for (var t = 0; t < 360; t += 15) {
        var major = t % 90 === 0, mid = t % 45 === 0, len = major ? 0 : mid ? 7 : 4;
        if (major) continue;
        var ca = -sind(t), sa = -cosd(t);
        ctx.beginPath(); ctx.moveTo(view.cx + ca * (view.R + 2), view.cy + sa * (view.R + 2)); ctx.lineTo(view.cx + ca * (view.R + 2 + len), view.cy + sa * (view.R + 2 + len)); ctx.stroke();
      }
      var fs = clamp(13 * view.s, 11, 16);
      ctx.fillStyle = 'rgba(233,228,214,0.8)'; ctx.font = '600 ' + fs + 'px ' + sans;
      var off = view.R + fs * 0.85;
      for (var i = 0; i < 8; i++) {
        var az = i * 45;
        ctx.font = (i % 2 ? '400 ' + (fs * 0.72).toFixed(1) : '600 ' + fs) + 'px ' + sans;
        ctx.fillStyle = i % 2 ? 'rgba(233,228,214,0.45)' : 'rgba(233,228,214,0.85)';
        ctx.fillText(CARD[i], view.cx - sind(az) * off, view.cy - cosd(az) * off);
      }
    } else {
      var y = view.H - 13, fs2 = 12;
      ctx.font = '600 ' + fs2 + 'px ' + sans;
      for (var a2 = 0; a2 < 360; a2 += 15) {
        var dx = Sky.wrap180(a2 - state.panoAz) * view.ppd;
        if (Math.abs(dx) > view.W / 2 + 10) continue;
        var x = view.cx + dx, maj = a2 % 45 === 0;
        ctx.strokeStyle = 'rgba(233,228,214,0.35)'; ctx.beginPath(); ctx.moveTo(x, view.H); ctx.lineTo(x, view.H - (maj ? 24 : 5)); ctx.stroke();
        if (maj) { ctx.fillStyle = a2 % 90 ? 'rgba(233,228,214,0.5)' : 'rgba(233,228,214,0.85)'; ctx.font = (a2 % 90 ? '400 10px ' : '600 12px ') + sans; ctx.fillText(CARD[a2 / 45], x, y - 14); }
      }
    }
  }

  // ---------- side panel
  function fmtTime(d) { return pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }
  var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function fmtDate(d) { return DAYS[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear(); }
  function fmtWhen(d, ref) {
    var a = new Date(d), b = new Date(ref);
    var same = a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    if (same) return 'at ' + fmtTime(a);
    var tm = new Date(b); tm.setDate(tm.getDate() + 1);
    if (a.getFullYear() === tm.getFullYear() && a.getMonth() === tm.getMonth() && a.getDate() === tm.getDate()) return 'tomorrow at ' + fmtTime(a);
    return 'on ' + DAYS[a.getDay()] + ' ' + a.getDate() + ' ' + MONTHS[a.getMonth()] + ' at ' + fmtTime(a);
  }
  function compass(az) { var names = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW']; return names[Math.round(Sky.wrap360(az) / 22.5) % 16]; }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  var panelKey = '';
  function updatePanel(date, sunH, moon, planets, L) {
    if (THUMB) return;
    var mode = state.playing ? 'playing' : isLive() ? 'live' : 'set';
    var key = fmtTime(date) + fmtDate(date) + mode + state.locName + state.mode;
    if (key === panelKey) return;
    panelKey = key;
    $('hm').textContent = fmtTime(date); $('mode').textContent = mode; $('datestr').textContent = fmtDate(date);
    var tw = Sky.twilight(sunH.alt);
    var up = planets.filter(function (p) { return p.h.alt > 0; }).map(function (p) { return p.name; });
    var lstH = L / 15;
    $('facts').innerHTML =
      '<span>sidereal</span><b>' + pad2(Math.floor(lstH)) + ':' + pad2(Math.floor((lstH % 1) * 60)) + '</b>' +
      '<span>sun</span><b>' + (sunH.alt >= 0 ? '+' : '−') + Math.abs(sunH.alt).toFixed(0) + '°, ' + tw + '</b>' +
      '<span>moon</span><b>' + moon.phaseName + ', ' + Math.round(moon.illum * 100) + '%' + (last.moonH.alt > 0 ? ', up in the ' + compass(last.moonH.az) : ', below the horizon') + '</b>' +
      '<span>planets up</span><b>' + (up.length ? up.join(', ') : 'none') + '</b>';
    $('corner').innerHTML = '<b>' + esc(state.locName) + '</b> &middot; ' + Math.abs(state.lat).toFixed(2) + '°' + (state.lat >= 0 ? 'N' : 'S') + ' ' + Math.abs(state.lon).toFixed(2) + '°' + (state.lon >= 0 ? 'E' : 'W');
    $('corner-r').textContent = state.mode === 'dome' ? 'hold overhead: N up, E left' : 'facing ' + compass(state.panoAz) + ' · drag to turn';
    $('v-min').textContent = (state.offMin < 0 ? '−' : '+') + Math.floor(Math.abs(state.offMin) / 60) + ':' + pad2(Math.abs(state.offMin) % 60);
    $('v-day').textContent = (state.offDay < 0 ? '−' : '+') + Math.abs(state.offDay) + ' d';
    if (state.selected) renderCard(state.selected);
  }

  var MYTHS = [
    'Here the heavens placed {author}, who carried {title} across the river of the sky.',
    'When {author} finished {title} the gods, having nothing left to read, hung the book up here and called it {real}.',
    'The shelf-keepers say {real} is where {author} keeps the first draft of {title}, which no one is allowed to read.',
    '{author} climbed this way one winter looking for a quiet place to finish {title}; the stars are the pages left behind.',
    'Sailors steer by {author}, because {title} is the one book that never comes down.',
    'This is {author}, set among the stars for {title}; the brightest star is the lamp left burning over the last chapter.',
    'Every night {author} reads {title} aloud to the other constellations, which is why they all lean this way.',
    'Once a year {author} dips below the horizon to return {title} to the library, and comes back up still holding it.'
  ];
  function mythFor(con, as) {
    var h = Sky.hash32(data.seed + '|' + con.id);
    var book = as.books[h % as.books.length], tpl = MYTHS[(h >>> 8) % MYTHS.length];
    return tpl.replace('{author}', as.author).replace('{title}', '“' + book.t + '”').replace('{real}', con.name);
  }
  function renderCard(id) {
    var con = data.consById[id], as = data.assign[id];
    var body = $('sel-body'); $('sel-hint').textContent = con.id;
    var html = '';
    if (as) {
      html += '<div class="author">' + esc(as.author) + '</div><div class="real">tonight’s name for <b>' + esc(con.name) + '</b> · ' + con.area + ' square degrees</div>';
      html += '<p class="myth">' + esc(mythFor(con, as)) + '</p>';
      var books = as.books.slice(0, 7);
      html += '<ul>' + books.map(function (b) { return '<li><b>' + esc(b.t) + '</b>' + (b.y ? '<span class="y">' + esc(b.y) + '</span>' : '') + '</li>'; }).join('') + '</ul>';
      if (as.books.length > 7) html += '<div class="hint">and ' + (as.books.length - 7) + ' more on the shelf</div>';
    } else {
      html += '<div class="author">' + esc(con.name) + '</div><div class="real">' + (data.byAuthor ? 'no author drawn for this one today' : 'the library could not be loaded, so the sky keeps its old names') + '</div>';
    }
    html += '<div class="rise">' + riseText(con, as ? as.author : con.name) + '</div>';
    body.innerHTML = html;
    var jb = body.querySelector('[data-jump]');
    if (jb) jb.addEventListener('click', function () { jumpTo(parseFloat(jb.getAttribute('data-jump')), con); });
  }
  function riseText(con, who) {
    var b = con.bright, date = effectiveDate(), jd = Sky.toJD(date);
    var rs = Sky.riseSet(b[0], b[1], state.lat, state.lon, jd);
    var star = '<b>' + esc(b[3]) + '</b>, its brightest star,';
    if (rs.status === 'circumpolar') return esc(who) + ' never sets from ' + esc(state.locName) + ': ' + star + ' is circumpolar, highest ' + fmtWhen(Sky.fromJD(rs.transit), date) + '.';
    if (rs.status === 'never') return esc(who) + ' never rises from ' + esc(state.locName) + '; ' + star + ' stays ' + Math.abs(rs.alt).toFixed(0) + '° below the horizon.';
    var out;
    if (rs.status === 'up') out = esc(who) + ' is up now: ' + star + ' is ' + rs.alt.toFixed(0) + '° high in the ' + compass(Sky.toHoriz(b[0], b[1], Sky.lst(jd, state.lon), state.lat).az) + ' and sets ' + fmtWhen(Sky.fromJD(rs.set), date) + '.';
    else out = esc(who) + ' rises ' + fmtWhen(Sky.fromJD(rs.rise), date) + ' in the ' + compass(Sky.toHoriz(b[0], b[1], Sky.lst(rs.rise, state.lon), state.lat).az) + ', when ' + star + ' clears the horizon.';
    out += ' <button data-jump="' + (rs.status === 'up' ? rs.set - 0.5 / 24 : rs.rise + 0.75 / 24).toFixed(5) + '">' + (rs.status === 'up' ? 'see it setting' : 'see it rise') + '</button>';
    return out;
  }
  function jumpTo(jd, con) {
    stopPlay();
    state.anchor = Sky.fromJD(jd); state.offMin = 0; state.offDay = 0;
    $('sl-min').value = 0; $('sl-day').value = 0;
    if (con && state.mode === 'pano') state.panoAz = Sky.toHoriz(con.bright[0], con.bright[1], Sky.lst(jd, state.lon), state.lat).az;
    panelKey = ''; render();
  }

  function select(id) {
    state.selected = id;
    if (id) renderCard(id);
    else { $('sel-hint').textContent = 'click one on the chart'; $('sel-body').innerHTML = '<div class="empty">Every constellation up tonight is named after an author in the library. Click one.</div>'; }
    render();
  }

  // ---------- hit testing
  function hitTest(x, y) {
    var tol = 11 * view.s + 3, best = null, bd = tol * tol;
    for (var i = 0; i < hit.labels.length; i++) { var b = hit.labels[i]; if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return b.id; }
    for (var j = 0; j < hit.segs.length; j++) {
      var s = hit.segs[j], dx = s.x2 - s.x1, dy = s.y2 - s.y1, l2 = dx * dx + dy * dy;
      var t = l2 ? clamp(((x - s.x1) * dx + (y - s.y1) * dy) / l2, 0, 1) : 0;
      var px = s.x1 + t * dx - x, py = s.y1 + t * dy - y, d = px * px + py * py;
      if (d < bd) { bd = d; best = s.id; }
    }
    return best;
  }

  // ---------- time control
  var clockTimer = null, playRaf = null, playTimer = null, lastT = 0;
  function startClock() { clockTimer = setInterval(function () { if (isLive()) render(); }, 20000); }
  function startPlay() {
    if (state.playing) return;
    state.playing = true; $('btn-play').innerHTML = '&#10074;&#10074; pause'; $('btn-play').classList.add('on');
    if (!state.anchor) state.anchor = new Date();
    if (REDUCED) {
      playTimer = setInterval(function () { state.anchor = new Date(state.anchor.getTime() + 10 * 60000); render(); }, 600);
    } else {
      lastT = performance.now();
      var step = function (t) {
        var dt = Math.min(0.1, (t - lastT) / 1000); lastT = t;
        state.anchor = new Date(state.anchor.getTime() + dt * 3600 * 1000); // one hour per second
        render(); playRaf = requestAnimationFrame(step);
      };
      playRaf = requestAnimationFrame(step);
    }
  }
  function stopPlay() {
    if (!state.playing) return;
    state.playing = false; $('btn-play').innerHTML = '&#9654; play'; $('btn-play').classList.remove('on');
    if (playRaf) cancelAnimationFrame(playRaf); if (playTimer) clearInterval(playTimer);
    playRaf = null; playTimer = null; panelKey = ''; render();
  }
  function goNow() { stopPlay(); state.anchor = null; state.offMin = 0; state.offDay = 0; $('sl-min').value = 0; $('sl-day').value = 0; panelKey = ''; render(); }

  // ---------- UI
  function setMode(m) {
    state.mode = m; $('stage').classList.toggle('pano', m === 'pano');
    $('btn-dome').classList.toggle('on', m === 'dome'); $('btn-pano').classList.toggle('on', m === 'pano');
    canvas.classList.toggle('grab', m === 'pano');
    panelKey = ''; resize(); render();
  }
  function setLabels(l) {
    state.labels = l;
    ['author', 'real', 'none'].forEach(function (k) { $('lab-' + k).classList.toggle('on', k === l); });
    render();
  }
  function initUI() {
    if (THUMB) return;
    $('lat').value = state.lat; $('lon').value = state.lon; $('loc-name').textContent = state.locName;
    $('btn-dome').addEventListener('click', function () { setMode('dome'); });
    $('btn-pano').addEventListener('click', function () { setMode('pano'); });
    ['author', 'real', 'none'].forEach(function (k) { $('lab-' + k).addEventListener('click', function () { setLabels(k); }); });
    $('btn-now').addEventListener('click', goNow);
    $('btn-tonight').addEventListener('click', function () { stopPlay(); state.anchor = tonight23(); state.offMin = 0; state.offDay = 0; $('sl-min').value = 0; $('sl-day').value = 0; panelKey = ''; render(); });
    $('btn-play').addEventListener('click', function () { if (state.playing) stopPlay(); else startPlay(); });
    $('sl-min').addEventListener('input', function () { state.offMin = parseInt(this.value, 10) || 0; panelKey = ''; render(); });
    $('sl-day').addEventListener('input', function () { state.offDay = parseInt(this.value, 10) || 0; panelKey = ''; render(); });
    $('chk-mw').addEventListener('change', function () { state.showMW = this.checked; render(); });
    $('chk-lines').addEventListener('change', function () { state.showLines = this.checked; render(); });
    $('chk-skyline').addEventListener('change', function () { state.showSkyline = this.checked; render(); });
    $('btn-loc').addEventListener('click', function () {
      var la = parseFloat($('lat').value), lo = parseFloat($('lon').value);
      if (!isFinite(la) || !isFinite(lo)) return;
      state.lat = clamp(la, -89.9, 89.9); state.lon = clamp(lo, -180, 180);
      state.locName = la.toFixed(2) + '°, ' + lo.toFixed(2) + '°';
      if (Math.abs(la - 32.99) < 0.05 && Math.abs(lo + 96.75) < 0.05) state.locName = 'Texas';
      $('loc-name').textContent = state.locName; panelKey = ''; render();
    });
    $('btn-geo').addEventListener('click', function () {
      if (!navigator.geolocation) { $('loc-name').textContent = 'no geolocation here'; return; }
      $('loc-name').textContent = 'asking…';
      navigator.geolocation.getCurrentPosition(function (pos) {
        state.lat = pos.coords.latitude; state.lon = pos.coords.longitude; state.locName = 'your location';
        $('lat').value = state.lat.toFixed(4); $('lon').value = state.lon.toFixed(4); $('loc-name').textContent = state.locName; panelKey = ''; render();
      }, function () { $('loc-name').textContent = state.locName + ' (location refused)'; }, { timeout: 8000 });
    });
    $('btn-when').addEventListener('click', lookup);
    $('when').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); lookup(); } });
    $('when').addEventListener('change', lookup);
    $('btn-help').addEventListener('click', function () { $('help').classList.add('show'); });
    $('btn-close').addEventListener('click', function () { $('help').classList.remove('show'); });
    $('help').addEventListener('click', function (e) { if (e.target === this) this.classList.remove('show'); });

    // pointer: click to select, drag to look around
    var down = null, moved = false;
    canvas.addEventListener('pointerdown', function (e) {
      down = { x: e.clientX, y: e.clientY, az: state.panoAz }; moved = false; canvas.setPointerCapture(e.pointerId);
      if (state.mode === 'pano') canvas.classList.add('grabbing');
    });
    canvas.addEventListener('pointermove', function (e) {
      if (down) {
        var dx = e.clientX - down.x, dy = e.clientY - down.y;
        if (Math.abs(dx) + Math.abs(dy) > 4) moved = true;
        if (state.mode === 'pano' && moved) { state.panoAz = Sky.wrap360(down.az - dx / view.ppd); panelKey = ''; render(); }
        return;
      }
      if (e.pointerType === 'mouse') {
        var r = canvas.getBoundingClientRect(), id = hitTest(e.clientX - r.left, e.clientY - r.top);
        canvas.classList.toggle('point', !!id);
      }
    });
    function up(e) {
      if (!down) return;
      canvas.classList.remove('grabbing');
      if (!moved) {
        var r = canvas.getBoundingClientRect(), id = hitTest(e.clientX - r.left, e.clientY - r.top);
        select(id === state.selected ? null : id);
      }
      down = null;
    }
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', function () { down = null; canvas.classList.remove('grabbing'); });

    document.addEventListener('keydown', function (e) {
      var tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault(); stopPlay();
        var step = (e.shiftKey ? 60 : 10) * (e.key === 'ArrowLeft' ? -1 : 1);
        if (!state.anchor) state.anchor = new Date();
        state.anchor = new Date(state.anchor.getTime() + step * 60000); panelKey = ''; render();
      } else if (e.key === ' ') { e.preventDefault(); if (state.playing) stopPlay(); else startPlay(); }
      else if (e.key === 'n' || e.key === 'N') goNow();
      else if (e.key === 't' || e.key === 'T') $('btn-tonight').click();
      else if (e.key === 'v' || e.key === 'V') setMode(state.mode === 'dome' ? 'pano' : 'dome');
      else if (e.key === 'l' || e.key === 'L') setLabels(state.labels === 'author' ? 'real' : state.labels === 'real' ? 'none' : 'author');
      else if (e.key === '?') $('help').classList.toggle('show');
      else if (e.key === 'Escape') { $('help').classList.remove('show'); select(null); }
    });

    setMode(state.mode); setLabels(state.labels);
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(function () { resize(); render(); }).observe($('stage'));
    else window.addEventListener('resize', function () { resize(); render(); });
  }
  if (THUMB) window.addEventListener('resize', function () { resize(); render(); });

  function lookup() {
    var q = ($('when').value || '').trim().toLowerCase(), out = $('when-out');
    if (!q) return;
    var found = null;
    data.cons.forEach(function (c) {
      var as = data.assign[c.id], name = (as ? as.author : c.name).toLowerCase();
      if (!found && (name === q || name.indexOf(q) >= 0 || c.name.toLowerCase() === q)) found = c;
    });
    if (!found) { out.innerHTML = 'No constellation is called that today. The names change at midnight; pick one from the list.'; return; }
    state.selected = found.id; renderCard(found.id); render();
    out.innerHTML = riseText(found, data.assign[found.id] ? data.assign[found.id].author : found.name);
    var jb = out.querySelector('[data-jump]');
    if (jb) jb.addEventListener('click', function () { jumpTo(parseFloat(jb.getAttribute('data-jump')), found); });
  }
})();
