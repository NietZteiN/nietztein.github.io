/*
 * Paper Theatre - painted scenery (pure string builders, no DOM).
 *
 * Backgrounds, event illustrations ("CGs") and particle layers. Loaded by
 * art.js (Node: require; browser: a <script> before art.js) and installed
 * into the VNArt kit, so callers only ever see VNArt.background / VNArt.cg /
 * VNArt.fx.
 *
 * Unlike the UI chrome, scenery does not follow the light/dark theme: every
 * scene is painted in its own time of day (day, dusk, dawn, night). Local
 * colours are multiplied by the ambient light of that hour and mixed toward
 * the haze colour with distance, so one drawing yields four moods.
 *
 * Soft edges come from a handful of shared SVG filters (VNArt.sharedDefs():
 * vnf-b2 .. vnf-b40 blurs, vnf-paint / vnf-cloud brush displacement). The
 * stage injects them once; nothing here animates a filter.
 */
(function (root, f) {
  if (typeof module === 'object' && module.exports) module.exports = f;
  else root.VNArtScenes = f;
})(typeof self !== 'undefined' ? self : this, function (K) {
  'use strict';

  var R = K.rect, Ci = K.circle, Pa = K.path, G = K.group, num = K.num, mix = K.mix, mul = K.mul;
  function El(cx, cy, rx, ry, a) { return '<ellipse' + K.attrs(K.merge({ cx: num(cx), cy: num(cy), rx: num(rx), ry: num(ry) }, a)) + '/>'; }
  function poly(pts, a) { return Pa('M' + pts.map(function (p) { return num(p[0]) + ' ' + num(p[1]); }).join('L') + 'Z', a); }
  function F(col, op, extra) { var o = { fill: col }; if (op != null && op !== 1) o.opacity = num(op); return extra ? K.merge(o, extra) : o; }
  function S(col, w, op, extra) { var o = { fill: 'none', stroke: col, 'stroke-width': w, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }; if (op != null && op !== 1) o.opacity = num(op); return extra ? K.merge(o, extra) : o; }
  function line(x1, y1, x2, y2, a) { return Pa('M' + num(x1) + ' ' + num(y1) + 'L' + num(x2) + ' ' + num(y2), a); }
  function dk(c, t) { return mix(c, '#000000', t); }
  function lt(c, t) { return mix(c, '#ffffff', t); }
  var B = function (n) { return 'url(#vnf-b' + n + ')'; };
  var MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

  /* ------------------------------------------------------------ light */

  var TOD = {
    day: { sky: ['#3f7fc6', '#7fb6e4', '#bfe0f2', '#eef6f4'], sun: '#fff6d8', amb: '#ffffff', key: '#fff1cf', shadow: '#56628a', haze: '#cddfee', cloud: '#ffffff', cloudSh: '#a9bfdc', rim: '#fff3d8' },
    dusk: { sky: ['#283673', '#7a4f8e', '#e2797a', '#ffb56e', '#ffe0a3'], sun: '#ffd58a', amb: '#eeb99a', key: '#ffad62', shadow: '#3a2c58', haze: '#e3967a', cloud: '#ffc396', cloudSh: '#7c5a90', rim: '#ffbe78' },
    dawn: { sky: ['#52699f', '#a99cc9', '#f3b9b7', '#ffe0c0', '#fff3dc'], sun: '#ffe9d0', amb: '#e6d2d8', key: '#ffd6bd', shadow: '#4f4a72', haze: '#ecc9cc', cloud: '#ffe6da', cloudSh: '#9f90ba', rim: '#ffd9cc' },
    night: { sky: ['#04071a', '#0b1638', '#1b2a5c', '#31407a'], sun: '#dfe6ff', amb: '#46558f', key: '#9cb3ff', shadow: '#060916', haze: '#1b2650', cloud: '#34437c', cloudSh: '#111a3c', rim: '#a8bfff' }
  };
  var MODS = ['night', 'dawn', 'dim', 'dusk', 'noon'];

  function Ctx(seed, tod) {
    this.seed = seed; this.tod = tod; this.P = TOD[tod]; this.night = tod === 'night'; this.warm = tod === 'dusk' || tod === 'dawn';
    this.pre = 'v' + K.hash(seed + '|' + tod).toString(36); this.n = 0; this.d = ''; this.post = '';
  }
  Ctx.prototype.grad = function (stops, o) { var id = this.pre + 'g' + (this.n++); this.d += K.gradient(id, stops, o); return 'url(#' + id + ')'; };
  Ctx.prototype.vg = function (a, b) { return this.grad([[0, a], [1, b]]); };
  Ctx.prototype.rg = function (col, op, r) { return this.grad([[0, col, op], [1, col, 0]], { radial: true, r: r || '50%' }); };
  Ctx.prototype.clip = function (shape) { var id = this.pre + 'c' + (this.n++); this.d += '<clipPath id="' + id + '">' + shape + '</clipPath>'; return 'url(#' + id + ')'; };
  Ctx.prototype.L = function (col, depth) { var x = mul(col, this.P.amb); return depth ? mix(x, this.P.haze, depth) : x; };
  Ctx.prototype.rnd = function (tag) { return K.rngFor(this.seed + ':' + tag); };
  Ctx.prototype.skyStops = function () { var s = this.P.sky; return s.map(function (col, i) { return [i / (s.length - 1), col]; }); };
  // a soft pool of light, drawn after everything else
  Ctx.prototype.pool = function (x, y, r, col, op, ry) { this.post += El(x, y, r, ry || r, { fill: this.rg(col, op) }); };

  /* ------------------------------------------------------------ sky */

  function stars(c, n, H, tag) {
    if (c.overcast) return '';                 // a closed sky: no stars, no moon
    var r = c.rnd(tag || 'stars'), o = '', big = '';
    for (var i = 0; i < n; i++) {
      var x = r() * 1600, y = r() * r() * H, rad = 0.5 + r() * 1.5, op = 0.35 + r() * 0.65;
      if (r() < 0.06) big += Ci(x, y, rad + 1.6, F('#eaf0ff', op));
      else o += Ci(x, y, rad, F(r() < 0.2 ? '#ffe9c4' : '#e8eeff', op));
    }
    return G(o) + G(big, { filter: B(2) });
  }
  function moon(c, x, y, r) {
    if (c.overcast) return Ci(x, y, r * 5, { fill: c.rg('#8f9cc8', 0.12) });   // only where the cloud is thinner
    return Ci(x, y, r * 7, { fill: c.rg('#b9c8ff', 0.28) }) + Ci(x, y, r * 2.2, { fill: c.rg('#eef2ff', 0.5) }) +
      Ci(x, y, r, { fill: '#f6f3e4' }) + Ci(x - r * 0.3, y - r * 0.2, r * 0.22, F('#cfcab4', 0.35)) + Ci(x + r * 0.28, y + r * 0.3, r * 0.3, F('#cfcab4', 0.28)) + Ci(x + r * 0.1, y - r * 0.5, r * 0.14, F('#cfcab4', 0.3));
  }
  function sun(c, x, y, scale) {
    var P = c.P, big = c.tod !== 'day', s = scale || 1;
    return Ci(x, y, (big ? 560 : 420) * s, { fill: c.grad([[0, P.sun, 0.95], [0.18, P.sun, 0.55], [0.5, P.sun, 0.16], [1, P.sun, 0]], { radial: true, r: '50%' }) }) +
      Ci(x, y, (big ? 46 : 30) * s, F('#fffdf2', 0.96, { filter: B(4) }));
  }
  function clouds(c, n, y0, y1, sc, tag) {
    var r = c.rnd(tag || 'clouds'), P = c.P, sh = '', li = '', up = c.warm ? -1 : 1;
    for (var i = 0; i < n; i++) {
      var cy = y0 + r() * (y1 - y0), t = (cy - y0) / Math.max(1, y1 - y0), cx = r() * 1800 - 100;
      var w = (150 + r() * 300) * (sc || 1) * (1.15 - t * 0.6), m = 4 + Math.floor(r() * 4);
      for (var j = 0; j < m; j++) {
        var u = m > 1 ? j / (m - 1) - 0.5 : 0, ex = cx + u * w + (r() - 0.5) * 30, rr = w * (0.15 + r() * 0.13) * (1 - Math.abs(u) * 1.1);
        sh += El(ex, cy + up * rr * 0.28, rr * 1.3, rr * 0.55);
        li += El(ex, cy - up * rr * 0.22, rr * 1.15, rr * 0.6);
      }
      sh += El(cx, cy + up * 6, w * 0.62, w * 0.07);
    }
    return G(sh, { fill: P.cloudSh, opacity: c.night ? 0.7 : 0.6, filter: 'url(#vnf-cloud)' }) + G(li, { fill: P.cloud, opacity: c.night ? 0.55 : 0.92, filter: 'url(#vnf-cloud)' });
  }
  function sky(c, H, o) {
    o = o || {};
    var out = R(0, 0, 1600, H, { fill: c.grad(c.skyStops()) });
    if (c.night) {
      out += stars(c, o.stars || 150, H * 0.95);
      if (o.moon !== false) { var m = o.moon || [1240, 150]; out += moon(c, m[0], m[1], o.moonR || 44); }
    } else if (o.sun !== false) {
      var sp = o.sun || (c.tod === 'day' ? [1230, 130] : [1060, H * 0.84]);
      out += sun(c, sp[0], sp[1], o.sunScale);
    }
    if (o.clouds !== 0) out += clouds(c, o.clouds || 7, o.cloudTop || 50, H * (o.cloudLow || 0.72), o.cloudScale || 1);
    return out;
  }

  /* ------------------------------------------------------------ land, city, trees */

  function hills(c, tag, baseY, amp, col, depth, bottom) {
    var r = c.rnd(tag), p1 = r() * 6, p2 = r() * 6, p3 = r() * 6, d = 'M0 ' + (bottom || 900);
    for (var x = 0; x <= 1600; x += 32) {
      var y = baseY - amp * (0.5 + 0.5 * Math.sin(x / 290 + p1)) * 0.65 - amp * 0.25 * Math.sin(x / 110 + p2) - amp * 0.1 * Math.sin(x / 41 + p3);
      d += 'L' + x + ' ' + num(y);
    }
    return Pa(d + 'L1600 ' + (bottom || 900) + 'Z', { fill: typeof col === 'string' && col.charAt(0) === 'u' ? col : c.L(col, depth) });
  }
  function city(c, tag, baseY, hmin, hmax, col, depth, o) {
    o = o || {};
    var r = c.rnd(tag), x = o.x0 == null ? -20 : o.x0, x1 = o.x1 == null ? 1620 : o.x1, d = 'M' + x + ' ' + baseY, wins = '', cool = '';
    var p = o.lights != null ? o.lights : (c.night ? 0.3 : c.tod === 'dusk' ? 0.16 : 0);
    while (x < x1) {
      var w = (o.w || 34) + r() * (o.w ? o.w * 1.6 : 70), h = hmin + r() * (hmax - hmin) * (r() < 0.14 ? 1.6 : 1);
      d += 'L' + num(x) + ' ' + num(baseY - h) + 'L' + num(x + w) + ' ' + num(baseY - h);
      if (r() < 0.25) d += 'L' + num(x + w) + ' ' + num(baseY - h * 0.7) + 'L' + num(x + w + 6) + ' ' + num(baseY - h * 0.7);
      if (p) {
        var gx = o.gx || 9, gy = o.gy || 12;
        for (var wy = baseY - h + 7; wy < baseY - 6; wy += gy) for (var wx = x + 4; wx < x + w - 5; wx += gx) {
          var q = r();
          if (q < p) wins += R(wx, wy, gx * 0.5, gy * 0.5); else if (q < p * 1.25) cool += R(wx, wy, gx * 0.5, gy * 0.5);
        }
      }
      x += w;
    }
    return Pa(d + 'L' + x1 + ' ' + baseY + 'Z', { fill: c.L(col, depth) }) + (wins ? G(wins, F('#ffd98c', 0.9 - depth * 0.5)) + G(cool, F('#cfe6ff', 0.8 - depth * 0.5)) : '');
  }
  // an irregular lobed dab, the unit a canopy is built from
  function clusterD(r, x, y, q) {
    var k = 5 + Math.floor(r() * 3), a0 = r() * 6.283, pts = [], i, d;
    for (i = 0; i < k; i++) { var an = a0 + i / k * 6.283, rad = q * (0.62 + r() * 0.6); pts.push([x + Math.cos(an) * rad, y + Math.sin(an) * rad * 0.82]); }
    d = 'M' + Math.round((pts[k - 1][0] + pts[0][0]) / 2) + ' ' + Math.round((pts[k - 1][1] + pts[0][1]) / 2);
    for (i = 0; i < k; i++) { var p = pts[i], nx = pts[(i + 1) % k]; d += 'Q' + Math.round(p[0]) + ' ' + Math.round(p[1]) + ' ' + Math.round((p[0] + nx[0]) / 2) + ' ' + Math.round((p[1] + nx[1]) / 2); }
    return d + 'Z';
  }
  // a canopy of leaves or blossom: many varied clusters in four tones (underside, body, lit, sunlit) with loose
  // dabs breaking the edge, brushed by the paint filter
  function foliage(c, tag, cx, cy, rx, ry, n, cols, depth, a) {
    var r = c.rnd(tag), s = ['', '', '', '', ''], m = Math.min(rx, ry), big = m > 60, N = Math.round(n * (big ? 1.7 : 1.1)), i;
    for (i = 0; i < N; i++) {
      var ang = r() * 6.283, rad = Math.pow(r(), 0.62), sy = Math.sin(ang), x = cx + Math.cos(ang) * rad * rx, y = cy + sy * rad * ry * (sy > 0 ? 0.72 : 1), q = (0.1 + r() * 0.15) * m + 5;
      var up = (cy - y) / ry;   // 1 at the top of the canopy, negative underneath
      s[0] += clusterD(r, x + q * 0.25, y + q * 0.45, q * 1.15);
      s[1] += clusterD(r, x, y, q);
      if (r() < 0.5 + up * 0.4) s[2] += clusterD(r, x - q * 0.3, y - q * 0.32, q * 0.62);
      if (up > -0.1 && r() < 0.3) s[3] += clusterD(r, x - q * 0.45, y - q * 0.5, q * 0.32);
    }
    for (i = 0; i < (big ? n * 1.2 : n * 0.5); i++) {
      var an2 = r() * 6.283, rd = 0.86 + r() * 0.34, px = cx + Math.cos(an2) * rd * rx, py = cy + Math.sin(an2) * rd * ry * (Math.sin(an2) > 0 ? 0.75 : 1), ps = 3 + r() * (big ? 9 : 4);
      s[4] += '<ellipse cx="' + Math.round(px) + '" cy="' + Math.round(py) + '" rx="' + num(ps) + '" ry="' + num(ps * 0.6) + '" transform="rotate(' + Math.round(r() * 180) + ' ' + Math.round(px) + ' ' + Math.round(py) + ')"/>';
    }
    return G(Pa(s[0], { fill: c.L(cols[0], depth) }) + Pa(s[1], { fill: c.L(cols[1], depth) }) + G(s[4], F(c.L(cols[1], depth), 0.9)) + Pa(s[2], F(c.L(cols[2], depth), 0.9)) + (s[3] ? Pa(s[3], F(c.L(lt(cols[2], 0.55), depth * 0.6), 0.85)) : ''), K.merge({ filter: 'url(#vnf-paint)' }, a));
  }
  var PINK = ['#d77f9f', '#f6b4c9', '#ffdbe7'], PINK_DEEP = ['#a85f84', '#cf86a4', '#eaa9c0'], GREEN = ['#2f5d43', '#4f8a5a', '#9bc77c'], PINE = ['#1f3f35', '#2f5f4a', '#5d8f66'];
  function trunk(c, x, y, h, w, depth, tag) {
    var r = c.rnd(tag), col = c.L('#3d2a26', depth), top = y - h;
    var d = 'M' + num(x - w) + ' ' + y + 'C' + num(x - w * 0.5) + ' ' + num(y - h * 0.4) + ' ' + num(x - w * 0.9) + ' ' + num(y - h * 0.7) + ' ' + num(x - w * 0.2) + ' ' + num(top) +
      'L' + num(x + w * 0.3) + ' ' + num(top) + 'C' + num(x + w * 0.8) + ' ' + num(y - h * 0.6) + ' ' + num(x + w * 0.6) + ' ' + num(y - h * 0.3) + ' ' + num(x + w * 1.2) + ' ' + y + 'Z';
    var br = '';
    for (var i = 0; i < 6; i++) {
      var by = y - h * (0.62 + r() * 0.38), side = i % 2 ? 1 : -1, len = h * (0.3 + r() * 0.45);
      br += Pa('M' + num(x) + ' ' + num(by) + 'Q' + num(x + side * len * 0.5) + ' ' + num(by - len * 0.15) + ' ' + num(x + side * len) + ' ' + num(by - len * (0.3 + r() * 0.4)), S(col, w * (0.22 + r() * 0.2)));
    }
    return Pa(d, { fill: col }) + br;
  }
  function cherry(c, tag, x, y, s, depth) {
    return trunk(c, x, y, 260 * s, 24 * s, depth, tag + 't') + (s < 0.6 ? '' : foliage(c, tag + 'b', x + 20 * s, y - 250 * s, 250 * s, 110 * s, Math.round(8 + 5 * s), PINK_DEEP, depth)) + foliage(c, tag, x, y - 310 * s, 250 * s, 150 * s, Math.round(22 + 12 * s), PINK, depth);
  }
  function tree(c, tag, x, y, s, depth, cols) {
    return trunk(c, x, y, 200 * s, 12 * s, depth, tag + 't') + foliage(c, tag, x, y - 250 * s, 160 * s, 130 * s, 22, cols || GREEN, depth);
  }
  function petalsStatic(c, n, tag, y0, y1) {
    var r = c.rnd(tag || 'petals'), o = '';
    for (var i = 0; i < n; i++) {
      var x = r() * 1600, y = (y0 || 0) + r() * ((y1 || 900) - (y0 || 0)), s = 3 + r() * 7, a = r() * 360;
      o += El(x, y, s, s * 0.55, F(r() < 0.5 ? '#ffe3ec' : '#f7bfd0', 0.6 + r() * 0.4, { transform: 'rotate(' + Math.round(a) + ' ' + num(x) + ' ' + num(y) + ')' }));
    }
    var near = '';
    for (var j = 0; j < Math.max(3, n / 9); j++) { var nx = r() * 1600, ny = (y0 || 0) + r() * ((y1 || 900) - (y0 || 0)), ns = 12 + r() * 16; near += El(nx, ny, ns, ns * 0.5, F('#ffd3e0', 0.5 + r() * 0.3, { transform: 'rotate(' + Math.round(r() * 360) + ' ' + num(nx) + ' ' + num(ny) + ')' })); }
    return G(o) + G(near, { filter: B(4) });
  }

  /* ------------------------------------------------------------ interiors */

  function wall(c, y, col, o) {
    o = o || {};
    return R(0, 0, 1600, y, { fill: c.vg(c.L(lt(col, 0.05)), c.L(dk(col, 0.12))) }) +
      (o.wainscot ? R(0, y - o.wainscot, 1600, o.wainscot, { fill: c.vg(c.L(o.wcol || dk(col, 0.18)), c.L(dk(o.wcol || col, 0.3))) }) + R(0, y - o.wainscot - 6, 1600, 8, { fill: c.L(lt(o.wcol || col, 0.1)) }) : '') +
      R(0, y - 12, 1600, 12, { fill: c.L(dk(col, 0.4)) });
  }
  function floor(c, y, col, o) {
    o = o || {};
    var vx = o.vx || 800, out = R(0, y, 1600, 900 - y, { fill: c.vg(c.L(dk(col, 0.22)), c.L(col)) }), seams = '';
    for (var i = -9; i <= 9; i++) seams += line(vx + i * 95, y, vx + i * 300, 900);
    for (var j = 1; j < 5; j++) seams += line(0, y + (900 - y) * j * j / 25, 1600, y + (900 - y) * j * j / 25);
    out += G(seams, S(c.L(dk(col, 0.5)), 1.5, 0.3));
    return out + R(0, y, 1600, 80, { fill: c.vg(c.L(lt(col, 0.5)), c.L(col)), opacity: 0.25 });
  }
  // a window onto the sky of this hour; throws light into the room after everything else is drawn
  function win(c, x, y, w, h, o) {
    o = o || {};
    var P = c.P, cp = c.clip(R(x, y, w, h)), frame = c.L(o.frame || '#e8e4dc'), fw = o.fw || 12, cols = o.cols || 2, rows = o.rows || 1, i;
    var st = c.skyStops().slice(1); st.forEach(function (s, k) { s[0] = k / (st.length - 1); });
    var view = R(x, y, w, h, { fill: c.grad(st) });
    if (c.night) { view += G(stars(c, 30, 900, 'w' + x), { transform: 'translate(0 ' + y + ')' }); if (o.moon) view += moon(c, x + w * o.moon[0], y + h * o.moon[1], 22); }
    else { view += G(clouds(c, 3, y + 20, y + h * 0.6, 0.55, 'wc' + x)); if (c.warm) view += Ci(x + w * 0.7, y + h * 0.95, h * 0.9, { fill: c.rg(P.sun, 0.75) }); }
    if (o.city) view += city(c, 'wcity' + x, y + h, h * 0.12, h * 0.4, '#7f8ba6', 0.45, { w: 22, gx: 6, gy: 8, x0: x, x1: x + w });
    if (o.trees) view += foliage(c, 'wt' + x, x + w * 0.5, y + h * 1.02, w * 0.6, h * 0.34, 22, o.trees === 'pink' ? PINK : GREEN, 0.25);
    var out = R(x - fw - 6, y - fw - 6, w + 2 * fw + 12, h + 2 * fw + 12, F(c.L('#3a3f4c'), 0.25, { filter: B(8) })) +
      R(x - fw, y - fw, w + 2 * fw, h + 2 * fw, { fill: frame }) + G(view, { 'clip-path': cp });
    out += R(x, y, w, h, { fill: c.grad([[0, '#ffffff', c.night ? 0.03 : 0.5], [0.6, '#ffffff', c.night ? 0 : 0.22], [1, '#ffffff', c.night ? 0 : 0.08]], { x1: 0, y1: 0, x2: 1, y2: 1 }) });
    for (i = 1; i < cols; i++) out += R(x + w * i / cols - fw * 0.3, y, fw * 0.6, h, { fill: frame });
    for (i = 1; i < rows; i++) out += R(x, y + h * i / rows - fw * 0.3, w, fw * 0.6, { fill: frame });
    if (o.sill !== false) out += R(x - fw - 14, y + h + fw - 2, w + 2 * fw + 28, 14, { fill: c.L(lt(o.frame || '#e8e4dc', 0.3)) }) + R(x - fw - 14, y + h + fw + 12, w + 2 * fw + 28, 6, F(c.L('#30323c'), 0.3));
    // light
    var k = c.night ? 0.12 : c.warm ? 0.68 : 0.5;
    c.post += R(x - 70, y - 70, w + 140, h + 140, F(P.key, k * 0.6, { filter: B(40) })) + (c.night ? '' : R(x, y, w, h, F('#ffffff', c.warm ? 0.16 : 0.3, { filter: B(16) })));
    if (o.shaft !== false) {
      var sx = o.sx == null ? -260 : o.sx, fy = o.fy || 900, sp = o.spread || 120;
      c.post += poly([[x, y], [x + w, y], [x + w + sx + sp, fy], [x + sx - sp, fy]], { fill: c.grad([[0, P.key, k * 0.5], [1, P.key, 0.02]]), filter: B(16) });
      for (i = 0; i < cols; i++) {
        var a = x + w * i / cols + 8, b = x + w * (i + 1) / cols - 8, t = 0.55;
        c.post += poly([[a + (sx - sp) * t, y + (fy - y) * t], [b + (sx + sp * 0.2) * t, y + (fy - y) * t], [b + sx + sp * 0.2, fy], [a + sx - sp, fy]], F(P.key, k * 0.22, { filter: B(8) }));
      }
    }
    return out;
  }
  function codeBars(c, x, y, w, h, tag, o) {
    o = o || {};
    var r = c.rnd(tag), out = '', lh = o.lh || 13, cols = o.cols || ['#7fd4ff', '#ffb3c8', '#ffe39a', '#b8c4dc', '#a6f0c6'];
    for (var i = 0; i * lh < h - lh; i++) {
      if (r() < 0.12) continue;
      var xx = x + Math.floor(r() * 4) * lh * 1.4, n = 1 + Math.floor(r() * 4);
      for (var j = 0; j < n && xx < x + w - 30; j++) { var len = Math.min(x + w - xx - 6, lh * (1.5 + r() * 6)); out += R(xx, y + i * lh, len, lh * 0.42, F(cols[Math.floor(r() * cols.length)], 0.5 + r() * 0.45, { rx: lh * 0.2 })); xx += len + lh * 0.7; }
    }
    return out;
  }
  function monitor(c, x, y, w, h, tag, o) {
    o = o || {};
    var out = R(x + w / 2 - w * 0.05, y + h, w * 0.1, h * 0.22, { fill: c.L('#2a2d36') }) + El(x + w / 2, y + h * 1.23, w * 0.22, h * 0.035, { fill: c.L('#2a2d36') }) +
      R(x - 8, y - 8, w + 16, h + 16, { fill: c.L('#1c1f28'), rx: 8 }) +
      R(x, y, w, h, { fill: c.grad([[0, '#16233f'], [1, '#0b1224']], { x1: 0, y1: 0, x2: 1, y2: 1 }), rx: 3 }) +
      codeBars(c, x + 12, y + 14, w - 24, h - 20, tag, { lh: o.lh || Math.max(8, h / 16) }) +
      poly([[x, y], [x + w * 0.55, y], [x + w * 0.25, y + h], [x, y + h]], F('#ffffff', 0.05));
    c.post += R(x - 50, y - 40, w + 100, h + 110, F('#79a8ff', c.night ? 0.3 : 0.1, { filter: B(40) }));
    return out;
  }
  function lamp(c, x, y, s, col) {
    s = s || 1;
    c.pool(x, y - 110 * s, 300 * s, '#ffd59a', c.night ? 0.55 : 0.22);
    c.post += El(x, y - 6, 190 * s, 26 * s, F('#ffdca8', c.night ? 0.4 : 0.14, { filter: B(8) }));
    return El(x, y - 4, 44 * s, 8 * s, { fill: c.L('#2c2f3a') }) + R(x - 4 * s, y - 110 * s, 8 * s, 108 * s, { fill: c.L('#3a3d48') }) +
      poly([[x - 26 * s, y - 150 * s], [x + 26 * s, y - 150 * s], [x + 44 * s, y - 104 * s], [x - 44 * s, y - 104 * s]], { fill: c.night ? '#ffe7bd' : c.L(col || '#e9dcc3') }) +
      El(x, y - 104 * s, 44 * s, 6 * s, { fill: '#fff4d6', opacity: c.night ? 1 : 0.7 });
  }
  function books(c, x, y, w, h, tag, spines, state) {
    var r = c.rnd(tag), out = '', xx = x;
    while (xx < x + w - 14) {
      var bw = 12 + Math.floor(r() * 20), bh = h * (0.68 + r() * 0.3), hue, title = '';
      if (spines && spines.length) { var sp = spines[state.i % spines.length]; state.i++; hue = typeof sp.genreHue === 'number' ? sp.genreHue : K.hash(sp.genre || sp.title || '') % 360; title = sp.title || ''; }
      else hue = Math.floor(r() * 360);
      var col = c.L(K.hslHex(hue, 18 + r() * 22, 30 + r() * 24));
      var lean = r() < 0.06 ? ' transform="rotate(' + num(4 + r() * 6) + ' ' + num(xx) + ' ' + num(y + h) + ')"' : '';
      var b = '<g' + lean + '>' + (title ? '<title>' + K.esc(title) + '</title>' : '') + R(xx, y + h - bh, bw, bh, { fill: col }) + R(xx, y + h - bh, bw * 0.3, bh, F('#ffffff', 0.12)) +
        R(xx + 2, y + h - bh + bh * 0.14, bw - 4, 3, F(c.L('#f1e2b8'), 0.7)) + R(xx + 2, y + h - bh * 0.2, bw - 4, 2, F(c.L('#f1e2b8'), 0.5)) + '</g>';
      out += b; xx += bw + 1 + (r() < 0.08 ? 12 : 0);
    }
    return out;
  }
  function bookcase(c, x, y, w, h, rows, tag, spines, state) {
    var wood = '#5b4032', out = R(x - 14, y - 14, w + 28, h + 28, { fill: c.L(wood) }) + R(x, y, w, h, { fill: c.vg(c.L(dk(wood, 0.55)), c.L(dk(wood, 0.4))) }), rh = h / rows;
    state = state || { i: 0 };
    for (var i = 0; i < rows; i++) {
      out += books(c, x + 6, y + i * rh + 8, w - 12, rh - 20, tag + i, spines, state);
      out += R(x, y + (i + 1) * rh - 12, w, 12, { fill: c.L(lt(wood, 0.12)) }) + R(x, y + i * rh, w, 16, F('#000000', 0.25));
    }
    return out;
  }
  function vignette(c, k) {
    return R(0, 0, 1600, 900, { fill: c.grad([[0, '#000000', 0], [0.6, '#000000', 0], [1, c.P.shadow, k || 0.5]], { radial: true, r: '78%' }) });
  }
  function persp(vx, vy, x, y, t) { return [x + (vx - x) * t, y + (vy - y) * t]; }

  /* ------------------------------------------------------------ backgrounds */

  var BG = {};
  var DEFAULT_TOD = { night: 'night', cafe: 'dusk', station: 'dusk', room: 'night', server: 'night', terminal: 'night', 'void': 'night', train: 'dusk', basement: 'night' };

  BG.lab = function (c) {
    var o = wall(c, 640, '#dde2e6', { wainscot: 90, wcol: '#b9c2c9' });
    o += win(c, 470, 110, 660, 300, { cols: 4, city: true, sx: -320, fy: 900 });
    // whiteboard
    o += R(84, 136, 320, 224, { fill: c.L('#9aa3ab'), rx: 4 }) + R(94, 146, 300, 204, { fill: c.L('#f7f8f6') });
    o += Pa('M120 190 h120 M120 214 h180 M120 238 h90 M250 286 q30 -40 60 0 t60 0', S(c.L('#3d63b8'), 3, 0.7)) + Pa('M130 290 l30 30 l50 -70', S(c.L('#c0504d'), 3, 0.7)) + Ci(330, 200, 26, S(c.L('#3d63b8'), 3, 0.6)) + R(180, 350, 60, 8, { fill: c.L('#6d7680') });
    // shelves with binders
    o += R(1212, 150, 320, 12, { fill: c.L('#b9a88d') }) + R(1212, 290, 320, 12, { fill: c.L('#b9a88d') }) + books(c, 1224, 62, 220, 88, 'sh1', null, {}) + books(c, 1262, 202, 250, 88, 'sh2', null, {});
    o += El(1490, 138, 26, 12, { fill: c.L('#4c7a5b') }) + foliage(c, 'pl', 1490, 104, 36, 30, 10, GREEN, 0) + R(1474, 126, 32, 24, { fill: c.L('#c98d6b'), rx: 3 });
    // bench
    o += R(0, 628, 1600, 300, F(c.P.shadow, 0.25, { filter: B(16) }));
    o += R(0, 560, 1600, 22, { fill: c.vg(c.L('#efe7d8'), c.L('#cdbfa6')) }) + R(0, 582, 1600, 318, { fill: c.vg(c.L('#8b96a3'), c.L('#5d6875')) }) + R(0, 582, 1600, 10, F('#000000', 0.22));
    for (var i = 0; i < 5; i++) o += R(40 + i * 320, 610, 280, 260, { fill: c.vg(c.L('#a1abb6'), c.L('#7b8693')), rx: 4 }) + R(160 + i * 320, 632, 44, 8, { fill: c.L('#56606c'), rx: 4 });
    o += monitor(c, 190, 356, 330, 190, 'm1') + monitor(c, 1050, 372, 290, 170, 'm2');
    o += R(560, 540, 210, 16, { fill: c.L('#2f333d'), rx: 4 }) + R(820, 526, 60, 34, { fill: c.L('#f2efe8'), rx: 6 }) + Pa('M880 534 q20 2 16 14 q-4 10 -16 8', S(c.L('#f2efe8'), 6));
    o += lamp(c, 940, 560, 0.9) + R(1370, 520, 120, 14, { fill: c.L('#b5544a') }) + R(1380, 506, 104, 14, { fill: c.L('#4a6a8f') }) + R(1376, 494, 96, 12, { fill: c.L('#d9c690') });
    return o;
  };

  BG.office = function (c) {
    var o = wall(c, 650, '#e4dccc', { wainscot: 150, wcol: '#8e6f55' }), st = { i: 0 };
    o += bookcase(c, 70, 90, 420, 470, 4, 'of', null, st);
    o += win(c, 1010, 100, 460, 380, { cols: 2, rows: 2, trees: 'green', sx: -420, spread: 80 });
    // blinds
    var bl = ''; for (var i = 0; i < 9; i++) bl += R(1010, 100 + i * 20, 460, 5, F(c.L('#f4eee0'), 0.85));
    o += bl;
    // frames
    o += R(590, 150, 150, 190, { fill: c.L('#5b4032') }) + R(602, 162, 126, 166, { fill: c.vg(c.L('#b9cfe0'), c.L('#e9e1c9')) }) + hillsMini(c, 602, 262, 126, 66) +
      R(780, 180, 130, 100, { fill: c.L('#2f3440') }) + R(790, 190, 110, 80, { fill: c.L('#efe9da') }) + Pa('M800 250 l22 -30 l18 18 l24 -34 l26 46', S(c.L('#7a8aa8'), 3));
    o += floor(c, 650, '#9a7758');
    // desk
    o += El(800, 742, 520, 40, F(c.P.shadow, 0.35, { filter: B(16) }));
    o += R(380, 560, 840, 26, { fill: c.vg(c.L('#a7805f'), c.L('#7c5a41')), rx: 3 }) + R(410, 586, 780, 170, { fill: c.vg(c.L('#6f4f3a'), c.L('#4f372a')) }) + R(410, 586, 780, 12, F('#000000', 0.25));
    o += monitor(c, 660, 400, 260, 150, 'om') + lamp(c, 470, 560, 1) + R(980, 536, 120, 24, { fill: c.L('#efe9dc') }) + R(990, 524, 110, 14, { fill: c.L('#dcd2bd') }) + R(1120, 520, 30, 40, { fill: c.L('#39445c'), rx: 4 });
    // plant
    o += R(1300, 560, 90, 90, { fill: c.vg(c.L('#c98d6b'), c.L('#9a644a')), rx: 6 }) + foliage(c, 'op', 1345, 480, 90, 100, 18, GREEN, 0);
    return o;
  };
  function hillsMini(c, x, y, w, h) { return Pa('M' + x + ' ' + (y + h) + 'L' + x + ' ' + (y + h * 0.5) + 'Q' + (x + w * 0.3) + ' ' + y + ' ' + (x + w * 0.55) + ' ' + (y + h * 0.5) + 'T' + (x + w) + ' ' + (y + h * 0.3) + 'L' + (x + w) + ' ' + (y + h) + 'Z', { fill: c.L('#6f9a7a') }); }

  function chalk(c, x, y, w, h, tag) {
    var r = c.rnd(tag), o = '', col = '#f1f0e6';
    for (var i = 0; i < 6; i++) { var yy = y + 30 + i * (h - 60) / 6, len = w * (0.25 + r() * 0.3); o += Pa('M' + num(x + 40 + r() * 30) + ' ' + num(yy) + 'h' + num(len) + 'M' + num(x + 60 + len + r() * 40) + ' ' + num(yy) + 'h' + num(len * 0.4), S(col, 3, 0.35 + r() * 0.4)); }
    o += Pa('M' + (x + w * 0.62) + ' ' + (y + h * 0.75) + 'v-' + h * 0.5 + 'M' + (x + w * 0.62) + ' ' + (y + h * 0.75) + 'h' + w * 0.3, S(col, 3, 0.7)) +
      Pa('M' + (x + w * 0.64) + ' ' + (y + h * 0.68) + 'q' + w * 0.08 + ' -' + h * 0.42 + ' ' + w * 0.14 + ' -' + h * 0.2 + 't' + w * 0.13 + ' -' + h * 0.18, S('#ffe9a0', 4, 0.8)) +
      Ci(x + w * 0.78, y + h * 0.48, 7, F('#ffb3c0', 0.9));
    return G(o, { filter: B(2) }) + R(x, y, w, h, F('#ffffff', 0.03));
  }
  // board: 'plot' (default: lines and a curve on axes), 'text' (lines of writing only), 'blank' (wiped)
  function chalkText(c, x, y, w, h, tag) {
    var r = c.rnd(tag + 't'), o = '', col = '#f1f0e6';
    o += Pa('M' + num(x + 44) + ' ' + num(y + 40) + 'h' + num(w * 0.34), S(col, 5, 0.75)) + Pa('M' + num(x + 44) + ' ' + num(y + 52) + 'h' + num(w * 0.34), S('#ffe9a0', 2, 0.6));
    for (var i = 0; i < 6; i++) {
      var yy = y + 84 + i * (h - 120) / 6, xx = x + 44 + (i % 3 === 2 ? 30 : 0), left = w - 110 - (i % 3 === 2 ? 30 : 0);
      while (left > 40) { var len = Math.min(left, 30 + r() * 110); o += Pa('M' + num(xx) + ' ' + num(yy) + 'h' + num(len), S(col, 3, 0.35 + r() * 0.4)); xx += len + 16; left -= len + 16; if (r() < 0.12) break; }
    }
    return G(o, { filter: B(2) }) + R(x, y, w, h, F('#ffffff', 0.03));
  }
  function blackboard(c, x, y, w, h, tag) {
    var board = (c.opts && c.opts.board) || 'plot';
    return R(x - 14, y - 14, w + 28, h + 34, { fill: c.L('#8a6a4c') }) + R(x, y, w, h, { fill: c.grad([[0, c.L('#2f5146')], [1, c.L('#223d35')]], { x1: 0, y1: 0, x2: 1, y2: 1 }) }) +
      (board === 'text' ? chalkText(c, x, y, w, h, tag) : board === 'blank' ? Pa('M' + num(x + 60) + ' ' + num(y + h * 0.5) + 'q' + num(w * 0.3) + ' -40 ' + num(w * 0.6) + ' 10', S('#f1f0e6', 60, 0.05, { filter: B(8) })) : chalk(c, x, y, w, h, tag)) + R(x, y + h + 4, w, 10, { fill: c.L('#b79670') }) + R(x + w * 0.2, y + h - 2, 34, 8, { fill: '#f4f2ea', rx: 2 }) + R(x + w * 0.26, y + h - 2, 26, 8, { fill: '#f3c1c9', rx: 2 });
  }

  BG.lecture = function (c) {
    var o = wall(c, 600, '#d9d3c5', { wainscot: 120, wcol: '#7c6450' });
    o += blackboard(c, 330, 110, 860, 330, 'lec');
    o += win(c, 1330, 60, 200, 430, { cols: 1, rows: 3, sx: -520, spread: 60, fy: 780 });
    o += R(60, 60, 200, 430, { fill: c.L('#cfc8b8') }) + R(74, 74, 172, 402, { fill: c.vg(c.L('#bdb5a4'), c.L('#a59c8a')) }) + Ci(232, 280, 8, { fill: c.L('#c8a560') });
    o += floor(c, 600, '#a58a6b');
    // podium
    o += poly([[1090, 600], [1110, 430], [1270, 430], [1290, 600]], { fill: c.vg(c.L('#7a5a43'), c.L('#553c2d')) }) + R(1098, 414, 184, 22, { fill: c.L('#8f6d52'), rx: 3 });
    // rows of seats, nearer rows larger and softer
    for (var row = 0; row < 3; row++) {
      var y = 690 + row * 70, s = 1 + row * 0.35, seats = '';
      for (var x = -40; x < 1640; x += 150 * s) seats += R(x, y, 120 * s, 240, { rx: 16 * s }) + R(x + 10 * s, y - 14 * s, 100 * s, 20 * s, { rx: 8 * s });
      o += G(seats, { fill: c.L(mix('#4b3a35', '#1b1620', row * 0.3)), filter: row ? B(row * 2) : null });
    }
    return o;
  };

  BG.classroom = function (c) {
    var o = wall(c, 610, '#e9e2d2', { wainscot: 130, wcol: '#b99f7f' });
    o += blackboard(c, 90, 150, 620, 280, 'cls');
    o += R(760, 170, 96, 96, { fill: c.L('#f6f2e6') }) + Ci(808, 218, 38, S(c.L('#3c4252'), 4)) + Pa('M808 218 v-24 M808 218 l16 10', S(c.L('#3c4252'), 4));
    for (var i = 0; i < 3; i++) o += win(c, 930 + i * 230, 90, 190, 400, { cols: 2, rows: 3, trees: i === 1 ? 'pink' : 'green', sx: -560 - i * 60, spread: 40, fy: 900, sill: i === 0 });
    o += floor(c, 610, '#b08f68', { vx: 500 });
    // desks in three rows, seen from the back of the room
    for (var row = 0; row < 3; row++) {
      var y = 620 + row * 78, s = 0.75 + row * 0.3, n = 5 - row, gap = 1600 / n, d = '';
      for (var k = 0; k < n; k++) {
        var x = gap * (k + 0.5) - 90 * s + (row % 2 ? 40 : 0);
        d += R(x, y, 180 * s, 12 * s, { fill: c.L('#d8b98c'), rx: 3 }) + R(x + 6 * s, y + 12 * s, 168 * s, 40 * s, { fill: c.L('#b99a70') }) +
          R(x + 10 * s, y + 52 * s, 6 * s, 150 * s, { fill: c.L('#7f8794') }) + R(x + 164 * s, y + 52 * s, 6 * s, 150 * s, { fill: c.L('#7f8794') }) +
          R(x + 40 * s, y - 60 * s, 100 * s, 50 * s, { fill: c.L('#c9a878'), rx: 8 * s }) + R(x, y + 12 * s, 180 * s, 5 * s, F('#000000', 0.18));
      }
      o += G(d, row === 2 ? { filter: B(2) } : null);
    }
    return o;
  };

  BG.server = function (c) {
    var vx = 800, vy = 400, o = R(0, 0, 1600, 900, { fill: c.grad([[0, '#0e1a2c'], [1, '#04070f']], { radial: true, r: '75%' }) }), i, k;
    o += poly([[0, 900], [1600, 900], [980, 470], [620, 470]], { fill: c.vg('#0b1422', '#172a44') }) + poly([[0, 0], [1600, 0], [980, 330], [620, 330]], { fill: '#0a111e' });
    for (i = 0; i < 6; i++) { var a = persp(vx, vy, 520, 0, i / 7), b = persp(vx, vy, 1080, 0, i / 7); o += poly([a, b, persp(vx, vy, 1080, 0, i / 7 + 0.03), persp(vx, vy, 520, 0, i / 7 + 0.03)], F('#bfe3ff', 0.75 - i * 0.1)); c.post += El(800, a[1] + 30, 400 - i * 50, 60, F('#8fc8ff', 0.1, { filter: B(30) })); }
    // racks left and right, receding
    for (var side = -1; side <= 1; side += 2) {
      for (i = 5; i >= 0; i--) {
        var t0 = i / 6.4, t1 = (i + 0.92) / 6.4, x0 = side < 0 ? -60 : 1660, r = c.rnd('rack' + side + i);
        var A = persp(vx, vy, x0, -80, t0), Bq = persp(vx, vy, x0, 980, t0), C = persp(vx, vy, x0, 980, t1), D = persp(vx, vy, x0, -80, t1);
        // face of the rack turned to the aisle
        o += poly([A, D, C, Bq], { fill: c.grad([[0, '#1a2942'], [1, '#0d1626']], side < 0 ? { x1: 0, y1: 0, x2: 1, y2: 0 } : { x1: 1, y1: 0, x2: 0, y2: 0 }) });
        var leds = '', bars = '';
        for (k = 1; k < 16; k++) {
          var u = k / 16, p0 = [A[0] + (D[0] - A[0]) * 0.12, A[1] + (Bq[1] - A[1]) * u], p1 = [A[0] + (D[0] - A[0]) * 0.88, D[1] + (C[1] - D[1]) * u];
          p0[1] = A[1] + (Bq[1] - A[1]) * u + (D[1] + (C[1] - D[1]) * u - (A[1] + (Bq[1] - A[1]) * u)) * 0.12;
          p1[1] = A[1] + (Bq[1] - A[1]) * u + (D[1] + (C[1] - D[1]) * u - (A[1] + (Bq[1] - A[1]) * u)) * 0.88;
          bars += line(p0[0], p0[1], p1[0], p1[1]);
          for (var q = 0; q < 4; q++) if (r() < 0.6) { var f = 0.2 + q * 0.18; leds += Ci(p0[0] + (p1[0] - p0[0]) * f, p0[1] + (p1[1] - p0[1]) * f - 6 * (1 - t0), 3.4 * (1 - t0 * 0.8), { fill: r() < 0.75 ? '#58f0c0' : r() < 0.5 ? '#ffb454' : '#6fb6ff', 'class': 'vn-led' }); }
        }
        o += G(bars, S('#2c4468', 1.5, 0.7)) + G(leds, { filter: B(2) }) + G(leds, { opacity: 0.9 });
      }
    }
    o += R(700, 330, 200, 140, { fill: '#050a14' }) + R(770, 360, 60, 110, { fill: '#0d1a2e' }) + Ci(800, 352, 5, { fill: '#58f0c0' });
    o += poly([[620, 470], [980, 470], [1250, 900], [350, 900]], { fill: c.grad([[0, '#6fd8ff', 0.05], [1, '#6fd8ff', 0.2]]), filter: B(8) });
    c.pool(800, 420, 520, '#3c7fd0', 0.22);
    return o;
  };

  BG.library = function (c, opts) {
    var spines = opts && opts.spines, st = { i: 0 }, o = wall(c, 660, '#cdbfa6');
    o += bookcase(c, 40, 60, 470, 590, 5, 'la', spines, st) + bookcase(c, 1090, 60, 470, 590, 5, 'lb', spines, st);
    // arched window between the cases
    var cp = c.clip(Pa('M620 600 V250 A180 180 0 0 1 980 250 V600 Z'));
    o += Pa('M600 610 V250 A200 200 0 0 1 1000 250 V610 Z', { fill: c.L('#efe6d2') }) + G(R(600, 40, 400, 580, { fill: c.grad(c.skyStops()) }) + (c.night ? stars(c, 40, 500, 'lw') + moon(c, 880, 190, 26) : clouds(c, 3, 120, 320, 0.6, 'lw')) + foliage(c, 'lt', 800, 640, 240, 130, 26, GREEN, 0.3), { 'clip-path': cp });
    o += R(794, 70, 12, 540, { fill: c.L('#efe6d2') }) + R(620, 330, 360, 10, { fill: c.L('#efe6d2') }) + R(620, 470, 360, 10, { fill: c.L('#efe6d2') });
    var k = c.night ? 0.11 : c.warm ? 0.6 : 0.42;
    c.post += poly([[620, 80], [980, 80], [820, 900], [240, 900]], { fill: c.grad([[0, c.P.key, k * 0.55], [1, c.P.key, 0.03]]), filter: B(16) }) + El(800, 330, 300, 340, F(c.P.key, k * 0.4, { filter: B(40) }));
    o += floor(c, 660, '#7d5a40');
    // reading table and a lamp
    o += El(800, 800, 520, 40, F(c.P.shadow, 0.3, { filter: B(16) })) + R(420, 690, 760, 22, { fill: c.vg(c.L('#8f6a4c'), c.L('#6a4c36')), rx: 3 }) + R(450, 712, 700, 14, F('#000000', 0.3)) + R(470, 712, 20, 188, { fill: c.L('#553c2b') }) + R(1110, 712, 20, 188, { fill: c.L('#553c2b') });
    o += lamp(c, 560, 690, 0.9, '#3f7a5c') + poly([[880, 688], [1000, 680], [1010, 690], [890, 698]], { fill: c.L('#f3ecd9') }) + poly([[760, 690], [880, 688], [890, 698], [770, 700]], { fill: c.L('#e6dcc3') }) + R(1030, 668, 90, 22, { fill: c.L('#7b3b3b') });
    return o;
  };

  BG.night = function (c) {
    var o = sky(c, 760, { stars: 230, moon: [1260, 150], moonR: 50, clouds: 4, cloudLow: 0.5, sun: [1100, 640] });
    var lit = c.night || c.tod === 'dusk';
    o += El(800, 700, 1100, 200, F(c.night ? '#4a62c4' : c.P.sun, 0.22, { filter: B(40) }));
    o += city(c, 'c3', 700, 60, 190, '#566186', 0.62, { w: 28, gx: 7, gy: 9 });
    o += city(c, 'c2', 730, 80, 280, '#3b4568', 0.38, { w: 44 });
    o += R(0, 640, 1600, 120, F(c.P.haze, 0.28, { filter: B(16) }));
    o += city(c, 'c1', 790, 60, 220, '#232a44', 0.12, { w: 70, gx: 12, gy: 15 });
    // river with reflections
    o += R(0, 786, 1600, 114, { fill: c.vg(c.L('#3a4a78', 0.3), c.L('#141b33')) });
    if (lit) { var r = c.rnd('refl'), s = ''; for (var i = 0; i < 70; i++) { var x = r() * 1600; s += R(x, 790 + r() * 30, 3, 20 + r() * 70, F(r() < 0.8 ? '#ffd98c' : '#cfe6ff', 0.25 + r() * 0.4)); } o += G(s, { filter: B(2) }); }
    // parapet in front
    o += R(0, 842, 1600, 58, { fill: c.L('#151a2c') }) + R(0, 836, 1600, 8, { fill: c.L('#2c3552') });
    return o;
  };

  BG.cafe = function (c) {
    var o = wall(c, 640, '#b98f6b', { wainscot: 170, wcol: '#5f4334' });
    // big street window with bokeh
    var cp = c.clip(R(120, 90, 760, 400)), r = c.rnd('bokeh'), bk = '';
    for (var i = 0; i < 26; i++) bk += Ci(120 + r() * 760, 250 + r() * 240, 14 + r() * 30, F(['#ffd98c', '#ffb3a0', '#cfe6ff', '#ffe9c4'][Math.floor(r() * 4)], 0.25 + r() * 0.4));
    o += R(100, 70, 800, 440, { fill: c.L('#3b2a22') }) + G(R(120, 90, 760, 400, { fill: c.grad(c.skyStops()) }) + city(c, 'cf', 500, 120, 330, '#59506f', 0.35, { w: 60, lights: c.tod === 'day' ? 0 : 0.3 }) + G(bk, { filter: B(4) }) + R(120, 430, 760, 60, F('#2a2233', 0.5)), { 'clip-path': cp });
    o += R(494, 90, 12, 400, { fill: c.L('#3b2a22') }) + R(120, 90, 760, 400, { fill: c.grad([[0, '#ffffff', 0.16], [1, '#ffffff', 0]], { x1: 0, y1: 0, x2: 1, y2: 1 }) });
    o += Pa('M240 150 q260 -70 520 0', S(c.L('#f4e9d2'), 5, 0.5)) + K.text(500, 190, 'café', { 'font-size': 64, 'font-style': 'italic', 'font-family': 'Georgia, serif', 'text-anchor': 'middle', fill: c.L('#f4e9d2'), opacity: 0.5 });
    c.post += R(60, 40, 880, 520, F(c.P.key, 0.22, { filter: B(40) }));
    // shelf with jars, menu board
    o += R(1010, 150, 500, 14, { fill: c.L('#4a3327') }) + R(1010, 310, 500, 14, { fill: c.L('#4a3327') });
    for (var j = 0; j < 7; j++) o += R(1030 + j * 68, 90 + (j % 2) * 10, 44, 60 - (j % 2) * 10, { fill: c.L(['#d9c9a3', '#8fa88a', '#c98d6b', '#e6dcc3'][j % 4]), rx: 6 }) + R(1030 + j * 68, 250, 44, 60, { fill: c.L(['#c98d6b', '#e6dcc3', '#6f8fa8', '#d9c9a3'][j % 4]), rx: 6 });
    o += R(1060, 370, 380, 180, { fill: c.L('#263a33'), rx: 4 }) + Pa('M1090 410 h200 M1090 450 h260 M1090 490 h170', S('#f1f0e6', 4, 0.5));
    // pendant lamps
    for (var p = 0; p < 3; p++) { var x = 300 + p * 480; o += line(x, 0, x, 120, S(c.L('#1e1814'), 3)) + Pa('M' + (x - 60) + ' 170 Q' + x + ' 90 ' + (x + 60) + ' 170 Z', { fill: c.L('#2c2420') }) + El(x, 170, 60, 9, { fill: '#ffe7b8' }); c.pool(x, 190, 330, '#ffc878', 0.4); }
    o += floor(c, 640, '#6b4a38');
    // table by the window
    o += El(800, 820, 620, 50, F(c.P.shadow, 0.35, { filter: B(16) })) + El(800, 730, 560, 60, { fill: c.vg(c.L('#a37652'), c.L('#7a553b')) }) + El(800, 722, 560, 56, { fill: c.L('#b98a62') }) + El(700, 716, 300, 30, F('#ffe2b0', 0.18));
    o += cup(c, 600, 700) + cup(c, 1010, 706) + R(770, 690, 90, 12, { fill: c.L('#efe6d2') }) + R(778, 680, 80, 12, { fill: c.L('#7b3b3b') });
    return o;
  };
  function cup(c, x, y) {
    return El(x, y + 18, 54, 12, { fill: c.L('#efe9dc') }) + Pa('M' + (x - 30) + ' ' + (y - 22) + 'h60 q0 40 -30 40 q-30 0 -30 -40z', { fill: c.L('#fbf7ee') }) + El(x, y - 22, 30, 7, { fill: c.L('#6b4530') }) +
      Pa('M' + (x + 30) + ' ' + (y - 14) + 'q18 0 16 12 q-2 10 -18 10', S(c.L('#fbf7ee'), 6)) + Pa('M' + (x - 8) + ' ' + (y - 40) + 'q-12 -18 0 -34 q12 -16 0 -32', S('#ffffff', 5, 0.25, { filter: B(4) }));
  }

  BG.terminal = function (c) {
    var o = R(0, 0, 1600, 900, { fill: c.grad([[0, '#0f2230'], [1, '#03070c']], { radial: true, r: '80%' }) }), glyphs = '01{}[]<>;=+-*/\\|_#$%&@:λ∑', layers = [[18, 16, 0.25, 8], [16, 24, 0.5, 2], [12, 34, 0.95, 0]];
    layers.forEach(function (Lr, li) {
      var r = c.rnd('term' + li), out = '', step = 1600 / Lr[0];
      for (var col = 0; col < Lr[0]; col++) {
        var x = step * (col + 0.2 + r() * 0.6), n = 6 + Math.floor(r() * 16), yy = r() * 500 - 80, spans = '';
        for (var i = 0; i < n; i++) spans += '<tspan x="' + num(x) + '" dy="' + (i ? num(Lr[1] * 1.25) : 0) + '" opacity="' + num(Math.pow((i + 1) / n, 2)) + '"' + (i === n - 1 ? ' fill="#eafff6"' : '') + '>' + K.esc(glyphs.charAt(Math.floor(r() * glyphs.length))) + '</tspan>';
        out += '<text' + K.attrs({ x: num(x), y: num(yy), 'font-family': MONO, 'font-size': Lr[1], fill: li === 2 ? '#62f0c2' : '#3fb7c8' }) + '>' + spans + '</text>';
      }
      o += G(out, { opacity: Lr[2], filter: Lr[3] ? B(Lr[3]) : null });
    });
    var sc = ''; for (var y = 0; y < 900; y += 6) sc += R(0, y, 1600, 2);
    o += G(sc, F('#000000', 0.16));
    c.pool(800, 380, 700, '#3fe0c0', 0.12);
    return o;
  };

  function pageSheet(c, x, y, w, h, rot, tag, o) {
    o = o || {};
    var r = c.rnd(tag), rules = '', ink = '', lh = o.lh || 46, mx = x + w * 0.14;
    for (var yy = y + lh * 2.2; yy < y + h - lh; yy += lh) {
      rules += line(x + 20, yy, x + w - 20, yy);
      if (o.text !== false && r() < 0.86) { var xx = mx + 14, end = x + w - 40 - (r() < 0.25 ? r() * w * 0.5 : 0); while (xx < end) { var len = 18 + r() * 70; ink += R(xx, yy - lh * 0.42, Math.min(len, end - xx), lh * 0.14, { rx: 3 }); xx += len + 12; } }
    }
    return G(R(x + 14, y + 18, w, h, F(c.P.shadow, 0.35, { filter: B(16) })) + R(x, y, w, h, { fill: c.grad([[0, c.L('#fdf8ea')], [1, c.L('#eadfc4')]], { x1: 0, y1: 0, x2: 1, y2: 1 }) }) +
      G(rules, S(c.L('#8ea1c0'), 1.5, 0.45)) + line(mx, y, mx, y + h, S(c.L('#d9707a'), 2.5, 0.7)) + G(ink, F(c.L('#2b3350'), 0.55)) +
      (o.title ? R(mx + 14, y + lh * 0.9, w * 0.42, lh * 0.3, F(c.L('#2b3350'), 0.8, { rx: 4 })) : ''), { transform: 'rotate(' + rot + ' ' + num(x + w / 2) + ' ' + num(y + h / 2) + ')' });
  }
  BG.paper = function (c) {
    var o = R(0, 0, 1600, 900, { fill: c.grad([[0, c.L('#8a6548')], [1, c.L('#5c4030')]], { x1: 0, y1: 0, x2: 1, y2: 1 }) }), g = '', r = c.rnd('grain');
    for (var i = 0; i < 26; i++) { var y = r() * 900; g += Pa('M0 ' + num(y) + 'q400 ' + num((r() - 0.5) * 60) + ' 800 0 t800 0', S(c.L('#3d2a20'), 1 + r() * 3, 0.12 + r() * 0.14)); }
    o += g;
    o += pageSheet(c, 980, 60, 640, 860, 7, 'p2', { text: true }) + pageSheet(c, 250, 30, 900, 1000, -2.5, 'p1', { title: true, lh: 50 });
    // pen and an ink bottle
    o += G(R(0, 0, 320, 14, { fill: c.L('#1f2433'), rx: 7 }) + poly([[320, 0], [352, 7], [320, 14]], { fill: c.L('#c8a560') }) + R(40, 0, 60, 14, { fill: c.L('#c8a560') }), { transform: 'translate(1150 560) rotate(-28)' });
    o += R(86, 380, 110, 110, { fill: c.L('#1c2440'), rx: 14 }) + R(112, 350, 58, 36, { fill: c.L('#11162a'), rx: 4 }) + R(96, 394, 26, 80, F('#ffffff', 0.14, { rx: 10 }));
    c.post += poly([[0, 0], [900, 0], [1400, 900], [300, 900]], { fill: c.grad([[0, c.P.key, 0.3], [1, c.P.key, 0]], { x1: 0, y1: 0, x2: 1, y2: 1 }), filter: B(40) });
    return o;
  };

  BG.train = function (c) {
    var o = R(0, 0, 1600, 900, { fill: c.vg(c.L('#d8d2c4'), c.L('#b3ab9a')) }), cp = c.clip(R(110, 150, 1380, 360, { rx: 26 }));
    // the passing land
    var view = R(110, 150, 1380, 360, { fill: c.grad(c.skyStops()) });
    if (c.night) view += stars(c, 60, 400, 'tw'); else view += Ci(1040, 440, 300, { fill: c.rg(c.P.sun, 0.9) }) + Ci(1040, 440, 34, F('#fffdf2', 0.95, { filter: B(4) })) + clouds(c, 4, 180, 330, 0.7, 'tw');
    view += hills(c, 'th1', 430, 90, '#6f7fa0', 0.5, 520) + hills(c, 'th2', 470, 60, '#4b5f6a', 0.25, 520) + city(c, 'tc', 500, 10, 50, '#39414f', 0.15, { w: 30, gx: 7, gy: 8 });
    var poles = ''; for (var i = 0; i < 5; i++) poles += R(190 + i * 330, 250, 8, 270) + R(160 + i * 330, 270, 70, 5);
    view += G(poles, { fill: c.L('#2a2d38'), opacity: 0.7, filter: B(2) }) + Pa('M110 262 q165 30 330 0 t330 0 t330 0 t330 0 t330 0', S(c.L('#2a2d38'), 2, 0.6));
    o += R(90, 130, 1420, 400, { fill: c.L('#8f8a80'), rx: 36 }) + G(view, { 'clip-path': cp }) + R(110, 150, 1380, 360, { fill: c.grad([[0, '#ffffff', 0.18], [0.5, '#ffffff', 0]], { x1: 0, y1: 0, x2: 1, y2: 1 }), rx: 26 });
    o += R(560, 150, 16, 360, { fill: c.L('#8f8a80') }) + R(1030, 150, 16, 360, { fill: c.L('#8f8a80') });
    c.post += R(60, 100, 1480, 460, F(c.P.key, c.night ? 0.1 : 0.3, { filter: B(40) })) + poly([[110, 510], [1490, 510], [1300, 900], [-100, 900]], { fill: c.grad([[0, c.P.key, c.night ? 0.08 : 0.3], [1, c.P.key, 0]]), filter: B(16) });
    // luggage rail, straps, lights
    o += R(0, 0, 1600, 60, { fill: c.vg(c.L('#efe9dc'), c.L('#cfc8b8')) }) + R(0, 78, 1600, 10, { fill: c.L('#9aa0a8'), rx: 5 }) + R(200, 26, 1200, 12, { fill: c.night ? '#fff7dc' : c.L('#f7f4ea'), rx: 6 });
    if (c.night) c.pool(800, 30, 800, '#ffeec0', 0.3, 200);
    for (var s = 0; s < 8; s++) { var x = 150 + s * 190; o += R(x - 3, 86, 6, 60, { fill: c.L('#d9d2c2') }) + Ci(x, 164, 18, S(c.L('#e9e3d4'), 7)); }
    // seats
    o += R(0, 560, 1600, 340, { fill: c.vg(c.L('#7f8794'), c.L('#565d69')) });
    o += R(60, 600, 1480, 130, { fill: c.vg(c.L('#3f6b5c'), c.L('#2c4f44')), rx: 30 }) + R(60, 700, 1480, 200, { fill: c.vg(c.L('#356052'), c.L('#22403a')), rx: 20 });
    for (var k = 1; k < 6; k++) o += R(60 + k * 246, 604, 3, 120, F('#000000', 0.18));
    o += R(60, 600, 1480, 16, F('#ffffff', 0.12, { rx: 8 }));
    return o;
  };

  BG.garden = function (c) {
    var o = sky(c, 520, { clouds: 5, sun: c.tod === 'day' ? [300, 110] : [420, 430] });
    o += hills(c, 'gh1', 470, 120, '#6d86a0', 0.6) + hills(c, 'gh2', 500, 70, '#4f7260', 0.35);
    for (var i = 0; i < 7; i++) o += foliage(c, 'gt' + i, 100 + i * 250, 470, 170, 80, 16, i % 3 === 1 ? PINE : GREEN, 0.3);
    // earthen wall with tiled cap
    o += R(0, 500, 1600, 90, { fill: c.vg(c.L('#e6dcc6'), c.L('#cbbf9f')) }) + R(0, 486, 1600, 20, { fill: c.L('#4a4f5c') }) + R(0, 480, 1600, 8, { fill: c.L('#6a7080') });
    // raked gravel
    o += R(0, 590, 1600, 310, { fill: c.vg(c.L('#d9d3c2'), c.L('#f0ebdc')) });
    var rk = ''; for (var j = 0; j < 14; j++) { var y = 610 + j * j * 1.5 + j * 6; rk += Pa('M0 ' + y + 'q400 -' + (6 + j) + ' 800 0 t800 0', S(c.L('#a79f8a'), 1.5 + j * 0.15, 0.5)); }
    o += rk;
    // stones with moss, rings in the gravel
    [[1040, 690, 150, 70], [1220, 720, 90, 44], [400, 760, 110, 50]].forEach(function (s, k) {
      o += El(s[0], s[1] + s[3] * 0.7, s[2] * 1.25, s[3] * 0.5, S(c.L('#a79f8a'), 2, 0.6)) + El(s[0], s[1] + s[3] * 0.7, s[2] * 1.5, s[3] * 0.68, S(c.L('#a79f8a'), 2, 0.4)) +
        El(s[0] + 14, s[1] + s[3] * 0.72, s[2], s[3] * 0.3, F(c.P.shadow, 0.3, { filter: B(8) })) +
        G(Pa('M' + (s[0] - s[2]) + ' ' + (s[1] + s[3] * 0.6) + 'q' + s[2] * 0.2 + ' -' + s[3] * 1.6 + ' ' + s[2] + ' -' + s[3] * 1.5 + 'q' + s[2] * 0.9 + ' ' + s[3] * 0.2 + ' ' + s[2] + ' ' + s[3] * 1.5 + 'z', { fill: c.vg(c.L('#8d9199'), c.L('#4c5059')) }) +
          Pa('M' + (s[0] - s[2] * 0.7) + ' ' + (s[1] - s[3] * 0.3) + 'q' + s[2] * 0.5 + ' -' + s[3] * 0.8 + ' ' + s[2] * 1.1 + ' -' + s[3] * 0.4 + 'q-' + s[2] * 0.5 + ' ' + s[3] * 0.1 + ' -' + s[2] * 1.1 + ' ' + s[3] * 0.4 + 'z', F(c.L('#6f9a5a'), 0.8)), { filter: 'url(#vnf-paint)' });
    });
    // pine and a stone lantern
    o += trunk(c, 210, 640, 330, 20, 0, 'gp') + foliage(c, 'gp1', 150, 300, 150, 50, 16, PINE, 0) + foliage(c, 'gp2', 300, 380, 130, 44, 14, PINE, 0) + foliage(c, 'gp3', 190, 220, 100, 40, 12, PINE, 0);
    o += R(1418, 520, 24, 120, { fill: c.L('#8d9199') }) + R(1390, 630, 80, 20, { fill: c.L('#7c8088'), rx: 4 }) + R(1392, 440, 76, 80, { fill: c.L('#9a9ea6'), rx: 6 }) + R(1408, 456, 44, 48, { fill: c.night || c.warm ? '#ffd98c' : c.L('#3c3f48'), rx: 4 }) + poly([[1370, 440], [1490, 440], [1450, 400], [1410, 400]], { fill: c.L('#6a6e78') }) + Ci(1430, 394, 10, { fill: c.L('#6a6e78') });
    if (c.night || c.warm) c.pool(1430, 480, 200, '#ffd98c', 0.5);
    return o;
  };

  BG['void'] = function (c) {
    var P = c.P, o = R(0, 0, 1600, 900, { fill: c.grad([[0, mix(P.sky[1], P.sky[2], 0.5)], [1, P.sky[0]]], { radial: true, cy: '42%', r: '85%' }) }), r = c.rnd('bokeh'), a = '', b = '';
    for (var i = 0; i < 34; i++) { var s = Ci(r() * 1600, r() * 900, 10 + r() * 70, F(i % 3 ? P.key : P.sun, 0.05 + r() * 0.12)); if (i % 2) a += s; else b += s; }
    o += G(a, { filter: B(16) }) + G(b, { filter: B(4) });
    c.pool(800, 380, 620, P.sun, c.night ? 0.12 : 0.3);
    return o;
  };

  BG.sakura = function (c) {
    var o = sky(c, 640, { clouds: 6, sun: c.tod === 'day' ? [1280, 120] : [1120, 520] });
    o += hills(c, 'sh1', 560, 150, '#7f95b8', 0.65) + city(c, 'st', 610, 8, 44, '#6f7c96', 0.5, { w: 26, gx: 6, gy: 7 }) + hills(c, 'sh2', 640, 80, '#5f8a68', 0.38);
    for (var i = 0; i < 6; i++) o += cherry(c, 'far' + i, 60 + i * 300 + (i % 2) * 60, 640, 0.42, 0.42);
    // the hill
    o += Pa('M0 900 L0 640 C300 560 520 520 800 560 C1100 600 1350 540 1600 600 L1600 900 Z', { fill: c.vg(c.L('#7fae6a'), c.L('#4f7f52')) });
    o += Pa('M0 900 L0 700 C300 640 600 620 900 660 C1200 700 1400 660 1600 690 L1600 900 Z', { fill: c.vg(c.L('#8fbd72'), c.L('#5d8f58')) });
    // path
    o += Pa('M700 900 C760 800 860 720 820 660 C800 620 860 590 900 572 L930 574 C900 600 880 630 900 668 C950 740 900 820 980 900 Z', { fill: c.vg(c.L('#e9dcc0'), c.L('#d2c2a0')) });
    o += cherry(c, 'mid1', 1130, 620, 0.8, 0.18) + cherry(c, 'mid2', 470, 610, 0.7, 0.2);
    o += El(330, 842, 420, 34, F(c.P.shadow, 0.3, { filter: B(16) })) + El(1340, 852, 440, 34, F(c.P.shadow, 0.3, { filter: B(16) }));
    o += cherry(c, 'near1', 240, 840, 1.7, 0) + cherry(c, 'near2', 1420, 860, 1.5, 0);
    // fallen petals and drifting ones
    var r = c.rnd('fallen'), f = ''; for (var k = 0; k < 120; k++) f += El(r() * 1600, 690 + r() * 210, 4 + r() * 5, 2 + r() * 2, F('#ffdbe6', 0.5 + r() * 0.4));
    o += f + petalsStatic(c, 60, 'air', 80, 800);
    c.post += poly([[900, 0], [1600, 0], [1200, 900], [200, 900]], { fill: c.grad([[0, c.P.key, 0.28], [1, c.P.key, 0]], { x1: 1, y1: 0, x2: 0, y2: 1 }), filter: B(40) });
    return o;
  };

  BG.rooftop = function (c) {
    var o = sky(c, 760, { clouds: 9, cloudLow: 0.8, sun: c.tod === 'day' ? [1180, 150] : [980, 600] });
    o += hills(c, 'rh', 690, 70, '#7f95b8', 0.7) + city(c, 'r3', 720, 30, 120, '#7684a6', 0.62, { w: 26, gx: 6, gy: 8 }) + city(c, 'r2', 750, 40, 170, '#56628a', 0.4, { w: 40 });
    o += R(0, 660, 1600, 110, F(c.P.haze, 0.35, { filter: B(16) }));
    // roof deck
    o += R(0, 760, 1600, 140, { fill: c.vg(c.L('#a9a9a4'), c.L('#c6c5be')) });
    var t = ''; for (var i = -8; i <= 8; i++) t += line(800 + i * 140, 760, 800 + i * 330, 900); t += line(0, 800, 1600, 800) + line(0, 856, 1600, 856);
    o += G(t, S(c.L('#7d7d78'), 1.5, 0.45));
    // water tank and stair house
    o += R(1180, 430, 300, 330, { fill: c.vg(c.L('#d8d5cc'), c.L('#aeaaa0')) }) + R(1180, 430, 60, 330, F('#000000', 0.12)) + R(1290, 560, 110, 200, { fill: c.L('#5c6b78') }) + R(1300, 572, 90, 80, F('#bfe0f2', 0.3)) + R(1170, 418, 320, 16, { fill: c.L('#8f8b82') });
    o += R(1230, 300, 150, 110, { fill: c.vg(c.L('#c9d3d6'), c.L('#8f9ca3')), rx: 10 }) + R(1250, 410, 8, 20, { fill: c.L('#6a6e78') }) + R(1352, 410, 8, 20, { fill: c.L('#6a6e78') }) + R(1230, 330, 150, 6, F('#000000', 0.12));
    // chain-link fence
    var id = c.pre + 'mesh';
    c.d += '<pattern id="' + id + '" width="26" height="26" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><path d="M0 0H26M0 0V26" fill="none" stroke="' + c.L('#4d5563') + '" stroke-width="1.6"/></pattern>';
    o += R(0, 470, 1600, 290, { fill: 'url(#' + id + ')', opacity: 0.6 });
    var posts = ''; for (var p = 0; p < 6; p++) posts += R(40 + p * 300, 450, 12, 316);
    o += G(posts + R(0, 462, 1600, 10) + R(0, 752, 1600, 12), { fill: c.L('#5a6270') });
    o += R(0, 752, 1600, 30, F(c.P.shadow, 0.25, { filter: B(8) }));
    return o;
  };

  BG.corridor = function (c) {
    var vx = 700, vy = 400, o = '', i;
    function q(x, y, t) { return persp(vx, vy, x, y, t); }
    var far = [q(0, 0, 0.8), q(1600, 0, 0.8), q(1600, 900, 0.8), q(0, 900, 0.8)];
    o += R(0, 0, 1600, 900, { fill: c.L('#e6dfd0') });
    o += poly([[0, 0], [1600, 0], far[1], far[0]], { fill: c.vg(c.L('#f1ece0'), c.L('#d6cfbf')) });                      // ceiling
    o += poly([[0, 900], [1600, 900], far[2], far[3]], { fill: c.vg(c.L('#8a6f55'), c.L('#b9997a')) });               // floor
    o += poly([[0, 0], far[0], far[3], [0, 900]], { fill: c.grad([[0, c.L('#cfc6b2')], [1, c.L('#ded6c4')]], { x1: 0, y1: 0, x2: 1, y2: 0 }) });   // left wall (doors)
    o += poly([[1600, 0], far[1], far[2], [1600, 900]], { fill: c.grad([[0, c.L('#efe9da')], [1, c.L('#dcd4c2')]], { x1: 1, y1: 0, x2: 0, y2: 0 }) }); // right wall (windows)
    o += poly(far, { fill: c.vg(c.L('#d9d2c2'), c.L('#c2baa8')) });
    var fw = far[1][0] - far[0][0], fh = far[3][1] - far[0][1];
    o += R(far[0][0] + fw * 0.3, far[0][1] + fh * 0.2, fw * 0.4, fh * 0.5, { fill: c.grad(c.skyStops().slice(1).map(function (s, k, a) { return [k / (a.length - 1), s[1]]; })) }) + R(far[0][0] + fw * 0.49, far[0][1] + fh * 0.2, fw * 0.02, fh * 0.5, { fill: c.L('#efe9da') });
    c.pool(vx, far[0][1] + fh * 0.45, 260, c.P.key, 0.5);
    // windows on the right, light pools on the floor
    var k = c.night ? 0.22 : c.warm ? 0.6 : 0.4, sk = c.skyStops().slice(1); sk.forEach(function (s, n) { s[0] = n / (sk.length - 1); });
    var skyFill = c.grad(sk);
    for (i = 0; i < 5; i++) {
      var t0 = i * 0.16 + 0.02, t1 = t0 + 0.11;
      var a = q(1600, 170, t0), b = q(1600, 170, t1), d = q(1600, 640, t1), e = q(1600, 640, t0);
      o += poly([a, b, d, e], { fill: skyFill }) + poly([a, b, d, e], S(c.L('#f7f3ea'), 10 * (1 - t0)));
      o += line((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (e[0] + d[0]) / 2, (e[1] + d[1]) / 2, S(c.L('#f7f3ea'), 6 * (1 - t0)));
      var f0 = q(1600, 900, t0), f1 = q(1600, 900, t1), reach = 620 * (1 - t0);
      c.post += poly([f0, f1, [f1[0] - reach, f1[1]], [f0[0] - reach * 1.15, f0[1]]], { fill: c.grad([[0, c.P.key, 0.05], [1, c.P.key, k * 0.75]], { x1: 0, y1: 0, x2: 1, y2: 0 }), filter: B(8) });
      c.post += poly([a, b, [b[0] - reach, f1[1]], [a[0] - reach * 1.15, f0[1]]], F(c.P.key, k * 0.13, { filter: B(16) }));
    }
    // doors and a notice board on the left
    for (i = 0; i < 4; i++) {
      var u0 = i * 0.2 + 0.05, u1 = u0 + 0.1, A = q(0, 250, u0), Bq = q(0, 250, u1), C = q(0, 900, u1), D = q(0, 900, u0);
      o += poly([A, Bq, C, D], { fill: c.L(i === 1 ? '#8fa6a0' : '#a98f70') }) + poly([q(0, 300, u0 + 0.02), q(0, 300, u1 - 0.02), q(0, 480, u1 - 0.02), q(0, 480, u0 + 0.02)], F(c.L('#dfe9ee'), 0.7));
    }
    o += poly([q(0, 300, 0.17), q(0, 300, 0.23), q(0, 520, 0.23), q(0, 520, 0.17)], { fill: c.L('#5f7f66') });
    // ceiling lamps, floor sheen
    for (i = 0; i < 5; i++) { var p = q(800, 0, i * 0.17 + 0.05), s = 1 - i * 0.17; o += R(p[0] - 70 * s, p[1] + 4 * s, 140 * s, 12 * s, { fill: c.night ? '#fff6dc' : c.L('#f8f5ee'), rx: 6 * s }); if (c.night) c.pool(p[0], p[1] + 20, 260 * s, '#ffeec0', 0.35); }
    o += poly([[500, 900], [900, 900], far[2], far[3]], { fill: c.grad([[0, '#ffffff', 0.25], [1, '#ffffff', 0.02]], { x1: 0, y1: 0, x2: 0, y2: 1 }), filter: B(8) });
    return o;
  };

  BG.station = function (c) {
    var o = sky(c, 700, { clouds: 7, sun: c.tod === 'day' ? [300, 140] : [420, 560] });
    o += hills(c, 'sth1', 600, 130, '#6f7fa8', 0.6) + hills(c, 'sth2', 650, 70, '#4b5f6a', 0.35) + city(c, 'stc', 680, 12, 60, '#3e4658', 0.3, { w: 30, gx: 7, gy: 8 });
    // tracks
    o += R(0, 680, 1600, 220, { fill: c.vg(c.L('#6a6258'), c.L('#4f4a44')) });
    var ties = ''; for (var i = 0; i < 40; i++) ties += R(i * 44 - 10, 716, 22, 34);
    o += G(ties, { fill: c.L('#3f3832') }) + R(0, 720, 1600, 5, { fill: c.L('#c9ccd2') }) + R(0, 742, 1600, 5, { fill: c.L('#c9ccd2') });
    // far platform with a small shelter
    o += R(0, 640, 1600, 44, { fill: c.vg(c.L('#b5b0a6'), c.L('#8f8a80')) }) + R(0, 640, 1600, 5, { fill: c.L('#e9d98c') });
    o += R(980, 520, 380, 120, { fill: c.L('#d9d2c2') }) + poly([[950, 520], [1390, 520], [1370, 492], [970, 492]], { fill: c.L('#51606a') }) + R(1020, 548, 120, 60, { fill: c.night || c.warm ? '#ffe2a3' : c.L('#a9c6d6') }) + R(1180, 548, 140, 92, { fill: c.L('#5b6570') });
    if (c.night || c.warm) c.pool(1080, 580, 180, '#ffd98c', 0.5);
    // poles and wires
    var pw = ''; for (var p = 0; p < 4; p++) { var x = 120 + p * 470; pw += R(x, 250, 12, 440) + R(x - 90, 290, 190, 8) + R(x - 90, 330, 190, 6); }
    o += G(pw, { fill: c.L('#2f3440', 0.15) }) + Pa('M0 300 q235 46 470 0 t470 0 t470 0 t470 0 M0 338 q235 40 470 0 t470 0 t470 0 t470 0', S(c.L('#2f3440', 0.15), 2.5));
    // signal
    o += R(770, 420, 10, 270, { fill: c.L('#2f3440') }) + R(752, 380, 46, 90, { fill: c.L('#1f232d'), rx: 8 }) + Ci(775, 404, 11, { fill: '#ff5a4a' }) + Ci(775, 444, 11, { fill: '#3a2a2a' });
    c.pool(775, 404, 70, '#ff5a4a', 0.6);
    // near platform: canopy, bench, tactile line
    o += R(0, 800, 1600, 100, { fill: c.vg(c.L('#cfc9bd'), c.L('#aaa498')) }) + R(0, 800, 1600, 10, { fill: c.L('#f1ead8') }) + R(0, 824, 1600, 14, { fill: c.L('#e6c84c') });
    o += poly([[-20, 0], [1620, 0], [1620, 120], [-20, 170]], { fill: c.vg(c.L('#3d4654'), c.L('#566170')) }) + poly([[-20, 170], [1620, 120], [1620, 134], [-20, 186]], { fill: c.L('#2a313c') });
    o += R(210, 150, 22, 660, { fill: c.L('#4a5462') }) + R(1330, 128, 22, 680, { fill: c.L('#4a5462') });
    o += R(520, 96, 300, 80, { fill: c.L('#22304a'), rx: 6 }) + R(536, 112, 268, 16, F('#ffd98c', 0.9, { rx: 3 })) + R(536, 140, 180, 12, F('#f1f0e6', 0.7, { rx: 3 }));
    c.pool(670, 136, 240, '#ffd98c', 0.25);
    return o;
  };

  BG.sea = function (c) {
    var H = 520, o = sky(c, H + 10, { clouds: 8, cloudLow: 0.9, sun: c.tod === 'day' ? [1100, 150] : [800, H - 30], sunScale: 1.2, moon: [800, 170], moonR: 50 });
    o += hills(c, 'cape', H + 6, 70, '#56688f', 0.55, H + 10).replace('<path', '<path transform="translate(-900 0)"');
    // water
    var sx = c.night ? 800 : c.tod === 'day' ? 1100 : 800;
    o += R(0, H, 1600, 260, { fill: c.grad([[0, c.L('#7fb3d9', 0.5)], [0.4, c.L('#3f7fb8', 0.15)], [1, c.L('#2f6f9e')]]) });
    var r = c.rnd('glit'), g = '', w = '';
    for (var i = 0; i < 150; i++) { var t = r(), y = H + 4 + t * t * 240, sp = 30 + t * 260; g += R(sx + (r() - 0.5) * sp * 2, y, 8 + t * 46, 1.5 + t * 3.5, F(c.P.sun, 0.35 + r() * 0.6, { rx: 2 })); }
    o += G(g) + G(g, { filter: B(4), opacity: 0.7 });
    for (var j = 0; j < 30; j++) { var tt = r(), yy = H + 10 + tt * 230; w += R(r() * 1600, yy, 60 + tt * 200, 1.5 + tt * 2, F('#ffffff', 0.12 + r() * 0.2, { rx: 2 })); }
    o += w;
    // surf and beach
    o += Pa('M0 780 C300 740 520 800 800 770 C1100 740 1300 790 1600 760 L1600 900 L0 900 Z', { fill: c.vg(c.L('#e9dcc0'), c.L('#d6c39c')) });
    o += Pa('M0 772 C300 732 520 792 800 762 C1100 732 1300 782 1600 752 L1600 770 C1300 800 1100 750 800 780 C520 810 300 750 0 790 Z', F(c.L('#ffffff'), 0.85, { filter: B(2) }));
    o += Pa('M0 792 C300 752 520 812 800 782 C1100 752 1300 802 1600 772 L1600 800 C1300 830 1100 780 800 810 C520 840 300 780 0 820 Z', F(c.L('#b9a47c'), 0.5, { filter: B(4) }));
    c.pool(sx, H, 520, c.P.sun, c.night ? 0.2 : 0.4, 160);
    return o;
  };

  BG.room = function (c) {
    var o = wall(c, 660, '#d9d0c4');
    o += win(c, 610, 110, 380, 320, { cols: 2, rows: 1, moon: [0.72, 0.3], city: true, sx: -200, spread: 60 });
    // curtains
    o += Pa('M560 84 h90 q-30 200 0 420 h-90 z', { fill: c.vg(c.L('#8fa3c4'), c.L('#62749a')) }) + Pa('M950 84 h90 v420 h-90 q30 -220 0 -420 z', { fill: c.vg(c.L('#8fa3c4'), c.L('#62749a')) }) + R(540, 76, 520, 12, { fill: c.L('#4a3a30'), rx: 6 });
    // shelf, posters
    o += R(90, 130, 380, 12, { fill: c.L('#7a5a43') }) + books(c, 100, 44, 250, 86, 'rs', null, {}) + R(380, 86, 60, 44, { fill: c.L('#c98d6b'), rx: 6 }) + foliage(c, 'rp', 410, 66, 40, 30, 8, GREEN, 0);
    o += R(120, 200, 170, 230, { fill: c.L('#2c3a5c') }) + Ci(205, 290, 50, { fill: c.L('#f0d98c') }) + Pa('M120 400 q85 -70 170 0 v30 h-170 z', { fill: c.L('#1c2640') }) + R(320, 230, 130, 170, { fill: c.L('#e9e1cf') }) + Pa('M340 270 h90 M340 300 h70 M340 330 h90 M340 360 h50', S(c.L('#7a8aa8'), 4, 0.6));
    o += floor(c, 660, '#8f6f55');
    // bed on the right
    o += R(1120, 520, 520, 60, { fill: c.L('#6a4c3a'), rx: 8 }) + R(1100, 580, 540, 200, { fill: c.vg(c.L('#e9e4dc'), c.L('#bdb6ac')), rx: 14 }) + R(1100, 640, 540, 150, { fill: c.vg(c.L('#6f86b8'), c.L('#4a5f8f')), rx: 12 }) + El(1230, 600, 90, 34, { fill: c.L('#f7f4ee') });
    // desk with a screen and a lamp
    o += El(420, 860, 420, 40, F(c.P.shadow, 0.4, { filter: B(16) }));
    o += R(90, 600, 680, 22, { fill: c.vg(c.L('#b08a66'), c.L('#8a6a4c')), rx: 3 }) + R(110, 622, 20, 278, { fill: c.L('#6a4c36') }) + R(730, 622, 20, 278, { fill: c.L('#6a4c36') }) + R(480, 622, 250, 150, { fill: c.vg(c.L('#8f6f52'), c.L('#6a4c36')) }) + R(580, 690, 50, 8, { fill: c.L('#3d2a20'), rx: 4 });
    o += monitor(c, 250, 420, 300, 170, 'rm') + lamp(c, 650, 600, 0.9, '#c9d6e6') + R(170, 580, 90, 20, { fill: c.L('#efe9dc') }) + R(180, 568, 80, 14, { fill: c.L('#7b3b3b') }) + R(300, 606, 190, 10, { fill: c.L('#2f333d'), rx: 4 });
    o += R(330, 700, 150, 200, { fill: c.L('#2c2f3a'), rx: 20 });
    return o;
  };

  BG.studio = function (c) {
    var o = wall(c, 650, '#e6e1d6');
    for (var i = 0; i < 3; i++) o += win(c, 110 + i * 300, 50, 230, 480, { cols: 2, rows: 4, trees: 'green', sx: 360 + i * 60, spread: 50, sill: false, frame: '#d9d4c8' });
    o += floor(c, 650, '#b39a7c');
    // paint spots on the floor
    var r = c.rnd('spots'), sp = ''; for (var k = 0; k < 30; k++) sp += El(r() * 1600, 700 + r() * 200, 6 + r() * 22, 3 + r() * 7, F(K.hslHex(r() * 360, 55, 60), 0.35));
    o += sp;
    // the large canvas on its easel
    o += El(1210, 840, 330, 34, F(c.P.shadow, 0.4, { filter: B(16) }));
    o += poly([[1010, 880], [1040, 880], [1120, 120], [1100, 120]], { fill: c.L('#7a5a43') }) + poly([[1390, 880], [1420, 880], [1330, 120], [1310, 120]], { fill: c.L('#7a5a43') }) + R(980, 720, 480, 18, { fill: c.L('#8f6d52') });
    o += R(960, 170, 520, 550, { fill: c.L('#d9cdb8') });
    var cp = c.clip(R(974, 184, 492, 522));
    o += G(R(974, 184, 492, 522, { fill: c.grad([[0, '#2a3f7a'], [0.5, '#c97a9a'], [1, '#ffd0a0']]) }) + Ci(1220, 600, 240, { fill: c.rg('#fff0c8', 0.8) }) +
      G(El(1220, 520, 190, 110) + El(1130, 470, 120, 80) + El(1320, 480, 110, 70) + El(1220, 420, 130, 80), { fill: '#f7c4d4', filter: 'url(#vnf-paint)' }) +
      G(El(1180, 440, 80, 44) + El(1290, 430, 60, 34), { fill: '#fff0f4', opacity: 0.8, filter: 'url(#vnf-paint)' }) +
      Pa('M1210 706 C1200 640 1230 600 1216 540 L1236 540 C1250 600 1230 650 1246 706 Z', { fill: '#2c1f2a' }) + Pa('M974 706 L974 660 Q1220 610 1466 660 L1466 706 Z', { fill: '#3a4f5c' }), { 'clip-path': cp, filter: B(2) });
    o += R(974, 184, 492, 522, { fill: c.grad([[0, '#ffffff', 0.18], [0.6, '#ffffff', 0]], { x1: 0, y1: 0, x2: 1, y2: 1 }) });
    // stool, jars, stacked canvases
    o += R(760, 700, 120, 14, { fill: c.L('#8f6d52'), rx: 6 }) + R(772, 714, 10, 180, { fill: c.L('#6a4c36') }) + R(858, 714, 10, 180, { fill: c.L('#6a4c36') });
    o += R(780, 650, 34, 50, { fill: c.L('#9fb8c9'), rx: 5 }) + R(822, 660, 30, 40, { fill: c.L('#c98d6b'), rx: 5 }) + Pa('M790 650 l-8 -50 M800 650 l2 -60 M808 650 l12 -46', S(c.L('#5b4032'), 4));
    o += poly([[40, 900], [40, 560], [300, 540], [300, 900]], { fill: c.L('#cfc5b2') }) + poly([[70, 900], [70, 590], [340, 572], [340, 900]], { fill: c.L('#e9e1cf') }) + poly([[70, 590], [340, 572], [340, 584], [70, 602]], F('#000000', 0.12));
    return o;
  };

  // a basement bar with an open mic: a strip of window at pavement level, a low stage, one microphone
  BG.basement = function (c) {
    var o = R(0, 0, 1600, 900, { fill: c.vg(c.L('#5b3f36'), c.L('#3a2925')) }), r = c.rnd('bricks'), i, br = '';
    // brick courses
    for (var row = 0; row < 16; row++) for (var col = 0; col < 14; col++) {
      var bx = col * 124 - (row % 2 ? 62 : 0), by = row * 42;
      br += R(bx + 3, by + 3, 118, 36, F(c.L(mix('#7a4f40', '#5a3a30', r())), 0.35 + r() * 0.35, { rx: 2 }));
    }
    o += G(br);
    // the pavement-level window: feet go by up there
    var cp = c.clip(R(160, 70, 620, 130)), legs = '';
    for (i = 0; i < 5; i++) { var lx = 220 + i * 120 + r() * 40; legs += R(lx, 70, 16, 130, { rx: 6 }) + R(lx + 26, 70, 16, 130, { rx: 6 }) + El(lx + 12, 196, 22, 8) + El(lx + 40, 196, 22, 8); }
    o += R(144, 54, 652, 162, { fill: c.L('#2a1d1a') }) + G(R(160, 70, 620, 130, { fill: c.grad(c.skyStops().slice(-2).map(function (st, k) { return [k, st[1]]; })) }) + R(160, 176, 620, 24, { fill: c.L('#6f6a70') }) + G(legs, { fill: c.L('#1d1826'), opacity: 0.7, filter: B(2) }), { 'clip-path': cp });
    for (i = 1; i < 4; i++) o += R(160 + i * 155 - 4, 70, 8, 130, { fill: c.L('#2a1d1a') });
    o += R(160, 70, 620, 130, { fill: c.grad([[0, '#ffffff', c.night ? 0.03 : 0.2], [1, '#ffffff', 0]], { x1: 0, y1: 0, x2: 1, y2: 1 }) });
    c.post += poly([[160, 200], [780, 200], [1000, 760], [220, 760]], { fill: c.grad([[0, c.P.key, c.night ? 0.1 : 0.24], [1, c.P.key, 0.01]]), filter: B(16) });
    // string lights along the ceiling
    var bulbs = '';
    for (i = 0; i < 14; i++) { var ux = 60 + i * 114, uy = 30 + Math.sin(i * 0.9) * 10 + (i % 2) * 8; bulbs += Ci(ux, uy, 7, { fill: '#ffe7b0' }); c.pool(ux, uy + 10, 90, '#ffc878', 0.22); }
    o += Pa('M0 26 Q400 60 800 28 T1600 30', S(c.L('#1e1814'), 2.5)) + bulbs;
    // bar shelf on the right with bottles, a chalk sign
    o += R(1120, 250, 420, 12, { fill: c.L('#2f211c') }) + R(1120, 370, 420, 12, { fill: c.L('#2f211c') });
    for (i = 0; i < 9; i++) { var bh = 60 + (i % 3) * 14; o += R(1140 + i * 44, 250 - bh, 22, bh, { fill: c.L(['#5d7a5a', '#8a5a3c', '#3f5a7a', '#b9a274'][i % 4]), rx: 5 }) + R(1147 + i * 44, 250 - bh - 16, 8, 18, { fill: c.L('#2a2420') }) + R(1140 + i * 44, 370 - bh + 8, 22, bh - 8, { fill: c.L(['#b9a274', '#5d7a5a', '#8a5a3c', '#6d3f46'][i % 4]), rx: 5 }); }
    o += R(880, 250, 190, 150, { fill: c.L('#22332d'), rx: 3 }) + R(872, 242, 206, 166, S(c.L('#7a5a43'), 8)) + Pa('M902 290 h130 M902 322 h100 M902 354 h140', S('#f1f0e6', 4, 0.5)) + Pa('M902 270 h60', S('#ffe9a0', 4, 0.7));
    // floor and the low stage
    o += R(0, 640, 1600, 260, { fill: c.vg(c.L('#3d2b25'), c.L('#231814')) }) + R(0, 640, 1600, 6, F('#000000', 0.3));
    o += poly([[250, 700], [1010, 700], [1090, 800], [170, 800]], { fill: c.vg(c.L('#6b4a38'), c.L('#4a3327')) }) + poly([[170, 800], [1090, 800], [1090, 836], [170, 836]], { fill: c.L('#2f211c') }) + Pa('M250 700 L1010 700', S(c.L('#a37652'), 3, 0.6));
    // stool and the microphone on its stand
    o += El(820, 742, 46, 12, { fill: c.L('#8f6d52') }) + R(786, 742, 8, 54, { fill: c.L('#5b4032') }) + R(846, 742, 8, 54, { fill: c.L('#5b4032') }) + R(790, 770, 60, 5, { fill: c.L('#5b4032') });
    o += El(620, 778, 64, 12, { fill: c.L('#16171d') }) + R(616, 420, 8, 360, { fill: c.L('#2a2d38') }) + Pa('M620 424 L652 392', S(c.L('#2a2d38'), 8)) + G(R(-34, -15, 68, 30, { fill: c.L('#3a3e4c'), rx: 15 }) + R(-34, -15, 30, 30, { fill: c.L('#8f95a8'), rx: 15 }) + Pa('M-24 -10 v20 M-16 -13 v26 M-8 -14 v28', S(c.L('#565c70'), 2)), { transform: 'translate(664 380) rotate(-44)' });
    // one warm spot on the microphone
    c.post += poly([[560, 0], [760, 0], [900, 800], [380, 800]], { fill: c.grad([[0, '#ffdca0', 0.26], [1, '#ffdca0', 0.05]]), filter: B(30) }) + El(640, 770, 300, 46, F('#ffdca0', 0.3, { filter: B(16) }));
    // the backs of two chairs, near and soft
    o += G(R(40, 720, 250, 260, { rx: 30 }) + R(1290, 740, 270, 240, { rx: 30 }), { fill: c.L('#17110f'), filter: B(4) });
    return o;
  };

  var BG_NAMES = ['lab', 'office', 'lecture', 'server', 'library', 'night', 'cafe', 'terminal', 'paper', 'train', 'garden', 'void',
    'sakura', 'classroom', 'rooftop', 'corridor', 'station', 'sea', 'room', 'studio', 'basement'];
  // rooms: weather is seen through their windows, not falling between the cast
  var INDOOR = { lab: 1, office: 1, lecture: 1, server: 1, library: 1, cafe: 1, train: 1, classroom: 1, corridor: 1, room: 1, studio: 1, basement: 1 };

  function timeOf(name, modifier) {
    if (modifier === 'night' || modifier === 'dawn' || modifier === 'dusk') return modifier;
    if (modifier === 'noon') return 'day';
    return DEFAULT_TOD[name] || 'day';
  }

  function finish(c, body, a, dim, vig) {
    var wash = G(El(260, 150, 760, 420, F(c.P.key, c.night ? 0.07 : 0.13)) + El(1380, 800, 760, 400, F(c.P.shadow, c.night ? 0.2 : 0.13)) + El(1250, 120, 520, 300, F(c.P.haze, 0.1)), { filter: 'url(#vnf-wash)' });
    var out = body + c.post + wash + vignette(c, vig == null ? 0.5 : vig) + (dim ? R(0, 0, 1600, 900, F('#0a0c18', 0.42)) : '');
    return K.svg('0 0 1600 900', K.defs(c.d) + out, K.merge({ preserveAspectRatio: 'xMidYMid slice' }, a));
  }

  // background(name, modifier, opts) -> <svg viewBox="0 0 1600 900">
  //   modifier: night | dawn | dusk | noon | dim (dim keeps the scene's own hour and lowers the light)
  //   opts: { spines: [{title, genreHue}] } for library; an array is taken as spines.
  //         { overcast: true } closes the sky (no moon, no stars); { board: 'plot'|'text'|'blank' } for the blackboards.
  function background(name, modifier, opts) {
    if (Array.isArray(opts)) opts = { spines: opts };
    name = String(name || 'void').toLowerCase();
    modifier = modifier ? String(modifier).toLowerCase() : '';
    if (!BG.hasOwnProperty(name)) name = 'void';
    if (MODS.indexOf(modifier) < 0) modifier = '';
    var tod = timeOf(name, modifier), c = new Ctx('bg:' + name, tod);
    opts = opts || {};
    c.opts = opts; c.overcast = !!opts.overcast;
    return finish(c, BG[name](c, opts), { 'class': 'vn-bg-svg', 'data-bg': name, 'data-mod': modifier || null, 'data-tod': tod, 'data-sky': c.overcast ? 'overcast' : null }, modifier === 'dim');
  }

  /* ------------------------------------------------------------ event illustrations (CGs) */

  var CG = {}, CG_TOD = { tree: 'dusk', 'desk-night': 'night', 'screen-code': 'night', 'hands-keyboard': 'night', 'two-chairs': 'dusk', 'corridor-light': 'dusk', 'sea-of-points': 'night', page: 'day', 'window-rain': 'night' };

  CG.tree = function (c) {
    var o = sky(c, 900, { clouds: 9, cloudLow: 0.7, sun: [520, 640], sunScale: 1.5 });
    o += hills(c, 'th1', 720, 120, '#7a5f8f', 0.55) + city(c, 'tt', 760, 8, 40, '#5a4a6f', 0.45, { w: 24, gx: 6, gy: 7, lights: 0.25 }) + hills(c, 'th2', 780, 60, '#4f4a62', 0.3);
    // the hill, dark against the light
    o += Pa('M0 900 L0 800 C300 740 620 640 900 660 C1200 680 1400 760 1600 780 L1600 900 Z', { fill: c.vg(c.L('#3f5a48'), c.L('#1f2f2c')) });
    var gr = '', r = c.rnd('grass'); for (var i = 0; i < 160; i++) { var x = r() * 1600, t = x / 1600, y = 800 - Math.sin(Math.min(1, t * 1.6) * 1.6) * 140 + (t > 0.56 ? (t - 0.56) * 270 : 0) + 6; gr += line(x, y + 14, x + (r() - 0.5) * 10, y - 6 - r() * 14); }
    o += G(gr, S(c.L('#6f8f5a'), 2, 0.5));
    // the tree
    var tx = 900, ty = 670, col = c.L('#1f1418');
    o += Pa('M' + (tx - 70) + ' ' + (ty + 20) + 'C' + (tx - 30) + ' ' + (ty - 60) + ' ' + (tx - 50) + ' ' + (ty - 200) + ' ' + (tx - 20) + ' ' + (ty - 330) + 'L' + (tx + 40) + ' ' + (ty - 330) + 'C' + (tx + 30) + ' ' + (ty - 200) + ' ' + (tx + 50) + ' ' + (ty - 70) + ' ' + (tx + 100) + ' ' + (ty + 26) + 'Z', { fill: col });
    [[-1, 260, 0.9], [1, 300, 1], [-1, 180, 0.6], [1, 200, 0.7], [-1, 330, 0.5], [1, 120, 0.5]].forEach(function (b, k) {
      var by = ty - 210 - k * 26;
      o += Pa('M' + tx + ' ' + by + 'Q' + (tx + b[0] * b[1] * 0.5) + ' ' + (by - 60) + ' ' + (tx + b[0] * b[1]) + ' ' + (by - 130 * b[2] - 40), S(col, 26 - k * 3));
    });
    o += foliage(c, 'big0', tx, 250, 560, 230, 70, ['#b0607f', '#e99ab5', '#ffd2dd'], 0) + foliage(c, 'big1', tx - 60, 200, 380, 140, 34, ['#e99ab5', '#ffc9d8', '#fff0f4'], 0, { opacity: 0.9 });
    o += El(tx - 180, 180, 300, 110, F(c.P.sun, 0.35, { filter: B(40) }));
    o += petalsStatic(c, 150, 'cgp', 60, 900);
    c.post += poly([[200, 400], [760, 520], [1600, 0], [600, 0]], { fill: c.grad([[0, c.P.sun, 0.3], [1, c.P.sun, 0]], { x1: 0, y1: 1, x2: 1, y2: 0 }), filter: B(40) });
    return o;
  };

  CG['desk-night'] = function (c) {
    var o = R(0, 0, 1600, 900, { fill: c.vg('#141b33', '#0b1022') });
    // window with the moon
    var cp = c.clip(R(980, 60, 500, 420));
    o += R(960, 40, 540, 460, { fill: '#232c4a' }) + G(R(980, 60, 500, 420, { fill: c.grad(c.skyStops()) }) + G(stars(c, 60, 480, 'dn'), { transform: 'translate(0 60)' }) + moon(c, 1340, 180, 40) + city(c, 'dn', 480, 30, 150, '#1b2444', 0.15, { w: 36, lights: 0.25 }), { 'clip-path': cp });
    o += R(1224, 60, 12, 420, { fill: '#232c4a' }) + R(980, 264, 500, 10, { fill: '#232c4a' });
    c.post += poly([[980, 60], [1480, 60], [1200, 900], [500, 900]], { fill: c.grad([[0, '#9cb3ff', 0.16], [1, '#9cb3ff', 0]]), filter: B(40) });
    // desk
    o += R(0, 640, 1600, 260, { fill: c.vg('#4a3628', '#241a16') }) + R(0, 640, 1600, 8, F('#ffd9a0', 0.25));
    // monitor, the brightest thing in the room
    o += R(250, 250, 560, 340, { fill: '#0e121c', rx: 12 }) + R(266, 266, 528, 308, { fill: c.grad([[0, '#1b2c50'], [1, '#0d1730']], { x1: 0, y1: 0, x2: 1, y2: 1 }) }) + codeBars(c, 290, 290, 480, 270, 'dnm', { lh: 17 }) + R(500, 590, 60, 40, { fill: '#0e121c' }) + El(530, 636, 120, 12, { fill: '#0e121c' });
    c.post += R(150, 170, 760, 520, F('#6f9fff', 0.16, { filter: B(40) })) + El(530, 700, 520, 70, F('#6f9fff', 0.22, { filter: B(16) }));
    // lamp
    o += El(1030, 642, 64, 11, { fill: '#2a2d38' }) + Pa('M1030 640L1056 500L940 396', S('#343846', 9)) + Ci(1056, 500, 9, { fill: '#4a4f60' }) + poly([[884, 352], [972, 396], [950, 474], [834, 428]], { fill: c.grad([[0, '#4a4f60'], [1, '#2a2d38']], { x1: 0, y1: 0, x2: 1, y2: 1 }) }) + El(892, 452, 60, 15, { fill: '#fff0cf', transform: 'rotate(21 892 452)' }) + El(892, 452, 90, 40, F('#ffdca0', 0.5, { filter: B(8), transform: 'rotate(21 892 452)' })) +
      // a stack of books at the edge of the light
      R(1130, 606, 150, 20, { fill: '#6d3f46', rx: 3 }) + R(1140, 588, 130, 18, { fill: '#3f5a7a', rx: 3 }) + R(1136, 572, 120, 16, { fill: '#b9a274', rx: 3 }) + R(1130, 624, 150, 4, F('#000000', 0.35));
    c.post += poly([[980, 640], [1480, 640], [1600, 900], [1100, 900]], { fill: c.grad([[0, '#9cb3ff', 0.12], [1, '#9cb3ff', 0]]), filter: B(8) });
    c.post += poly([[834, 428], [950, 474], [1120, 660], [560, 660]], { fill: c.grad([[0, '#ffd59a', 0.5], [1, '#ffd59a', 0.05]]), filter: B(16) }) + El(840, 670, 330, 60, F('#ffd59a', 0.4, { filter: B(16) }));
    // papers, mug, keyboard
    o += G(R(0, 0, 250, 160, { fill: '#e9e1cf' }) + Pa('M24 34 h190 M24 62 h160 M24 90 h200 M24 118 h120', S('#5a6480', 5, 0.6)), { transform: 'translate(900 690) rotate(-10) skewX(-20)' });
    o += G(R(0, 0, 250, 160, { fill: '#f4eedf' }) + Pa('M24 34 h170 M24 62 h200 M24 90 h130', S('#5a6480', 5, 0.6)), { transform: 'translate(1000 720) rotate(6) skewX(-20)' });
    o += R(360, 672, 380, 26, { fill: '#1c1f28', rx: 6 }) + R(372, 678, 356, 8, F('#6f9fff', 0.25, { rx: 3 }));
    o += R(1330, 590, 70, 70, { fill: '#d9d2c2', rx: 8 }) + El(1365, 592, 35, 9, { fill: '#3d2a20' }) + Pa('M1356 574 q-12 -18 0 -34 q12 -16 0 -32', S('#ffffff', 5, 0.2, { filter: B(4) }));
    return o;
  };

  CG['screen-code'] = function (c) {
    var o = R(0, 0, 1600, 900, { fill: '#05070e' });
    o += G(R(-60, -40, 1720, 980, { fill: c.grad([[0, '#14213f'], [1, '#0a1124']], { x1: 0, y1: 0, x2: 1, y2: 1 }), rx: 10 }) + codeScreen(c), { transform: 'rotate(-3 800 450)' });
    var sc = ''; for (var y = 0; y < 900; y += 5) sc += R(0, y, 1600, 1.5);
    o += G(sc, F('#000000', 0.2));
    o += poly([[0, 0], [700, 0], [300, 900], [0, 900]], F('#ffffff', 0.035));
    c.pool(820, 440, 620, '#ffd98c', 0.1);
    return o;
  };
  function codeScreen(c) {
    var r = c.rnd('sc'), out = '', lh = 62, cols = ['#7fd4ff', '#ffb3c8', '#b8c4dc', '#a6f0c6', '#8f9cc0'];
    for (var i = 0; i < 16; i++) {
      var y = -10 + i * lh, xx = 110 + [0, 1, 1, 2, 2, 2, 1, 1, 2, 3, 3, 2, 1, 1, 0, 0][i] * 70;
      out += K.text(40, y + 26, String(i + 14), { 'font-family': MONO, 'font-size': 26, fill: '#4a5a84' });
      var n = 2 + Math.floor(r() * 4);
      for (var j = 0; j < n && xx < 1500; j++) {
        var len = 60 + r() * 260;
        if (i === 7 && j === 1) {
          // the one identifier someone left readable
          var idt = String((c.opts && c.opts.text) || '_lastNSecs').slice(0, 28), idw = idt.length * 23 + 70;
          out += R(xx - 14, y - 6, idw, 46, { fill: '#ffd98c', opacity: 0.16, rx: 8 }) + R(xx - 14, y - 6, idw, 46, S('#ffd98c', 2.5, 0.9, { rx: 8 })) + K.text(xx, y + 28, idt, { 'font-family': MONO, 'font-size': 38, fill: '#ffe9b8', 'font-weight': 600 });
          c.post += G(El(xx + 136, y + 20, 260, 80, F('#ffd98c', 0.35, { filter: B(30) })), { transform: 'rotate(-3 800 450)' });
          xx += 320; continue;
        }
        out += R(xx, y, len, 26, F(cols[Math.floor(r() * cols.length)], 0.45 + r() * 0.4, { rx: 8 }));
        xx += len + 26;
      }
    }
    return out;
  }

  CG['hands-keyboard'] = function (c) {
    var o = R(0, 0, 1600, 900, { fill: c.vg('#101731', '#1c1a26') }), i, j;
    // screen glow from above
    o += R(160, -200, 1280, 330, { fill: c.grad([[0, '#1b2c50'], [1, '#22386a']]), rx: 16 }) + codeBars(c, 220, 0, 1160, 110, 'hk', { lh: 20 });
    c.post += El(800, 120, 900, 260, F('#6f9fff', 0.3, { filter: B(40) }));
    // desk plane
    o += poly([[0, 330], [1600, 330], [1600, 900], [0, 900]], { fill: c.vg('#2a2230', '#3d2c2a') });
    // keyboard in perspective
    var kb = poly([[250, 420], [1350, 420], [1500, 800], [100, 800]], { fill: c.vg('#1a1e2a', '#0f1219') });
    for (i = 0; i < 5; i++) {
      var t0 = i / 5, y0 = 436 + t0 * 350, y1 = y0 + 54 + i * 3, xl0 = 262 - t0 * 140, xr0 = 1338 + t0 * 140, xl1 = 262 - (t0 + 0.17) * 140, xr1 = 1338 + (t0 + 0.17) * 140, n = 14 - (i === 4 ? 6 : 0);
      for (j = 0; j < n; j++) {
        var a = j / n, b = (j + 0.86) / n;
        if (i === 4 && j === 2) b = (j + 3.86) / n;
        if (i === 4 && j > 2 && j < 6) continue;
        kb += poly([[xl0 + (xr0 - xl0) * a, y0], [xl0 + (xr0 - xl0) * b, y0], [xl1 + (xr1 - xl1) * b, y1], [xl1 + (xr1 - xl1) * a, y1]], { fill: c.vg('#39425a', '#262d40') });
      }
    }
    o += kb + poly([[250, 420], [1350, 420], [1500, 800], [100, 800]], { fill: c.grad([[0, '#6f9fff', 0.3], [1, '#6f9fff', 0]]) });
    // two hands, lit from the screen
    function hand(mx, flip) {
      // the back of a hand resting on the keys: a palm, four curved fingers and a thumb, lit cold from the screen
      var s = flip ? -1 : 1, skin = '#d6ae9c', dkS = '#6b4f60', out = '', hl = '', nails = '';
      function X(x) { return num(mx + s * x); }
      out += Pa('M' + X(-150) + ' 900C' + X(-150) + ' 800 ' + X(-128) + ' 708 ' + X(-96) + ' 646C' + X(-40) + ' 622 ' + X(40) + ' 624 ' + X(90) + ' 656C' + X(118) + ' 720 ' + X(128) + ' 800 ' + X(140) + ' 900Z', { fill: c.vg(skin, dkS) });
      [[-72, 654, -96, 590, -94, 524, 34], [-24, 640, -34, 566, -36, 498, 36], [24, 644, 28, 574, 28, 508, 34], [66, 662, 82, 606, 86, 552, 29]].forEach(function (f) {
        var d = 'M' + X(f[0]) + ' ' + f[1] + 'Q' + X(f[2]) + ' ' + f[3] + ' ' + X(f[4]) + ' ' + f[5];
        out += Pa(d, S(dkS, f[6] + 3)) + Pa(d, S(skin, f[6]));
        hl += 'M' + X(f[0] - 7) + ' ' + (f[1] - 10) + 'Q' + X(f[2] - 7) + ' ' + f[3] + ' ' + X(f[4] - 6) + ' ' + (f[5] + 6);
        nails += El(mx + s * f[4], f[5] + 2, f[6] * 0.3, f[6] * 0.36, {});
        out += Pa('M' + X(f[2] - f[6] * 0.34) + ' ' + (f[3] + 4) + 'q' + num(s * f[6] * 0.34) + ' 6 ' + num(s * f[6] * 0.68) + ' 0', S(dkS, 2, 0.45));
      });
      var th = 'M' + X(-104) + ' 730Q' + X(-150) + ' 700 ' + X(-178) + ' 642';
      out += Pa(th, S(dkS, 43)) + Pa(th, S(skin, 40)) + G(nails, F('#f3d9d2', 0.75)) + Pa(hl, S('#cfe0ff', 8, 0.4));
      out += Pa('M' + X(-96) + ' 646C' + X(-40) + ' 622 ' + X(40) + ' 624 ' + X(90) + ' 656', S('#cfe0ff', 3, 0.3));
      // the cuff of a sleeve
      out += Pa('M' + X(-176) + ' 900L' + X(-158) + ' 800Q' + X(-10) + ' 770 ' + X(142) + ' 806L' + X(164) + ' 900Z', { fill: c.vg('#3b4a78', '#1d2644') }) + Pa('M' + X(-158) + ' 800Q' + X(-10) + ' 770 ' + X(142) + ' 806', S('#8fa6e8', 4, 0.6));
      return out;
    }
    o += El(520, 800, 260, 60, F('#000000', 0.4, { filter: B(16) })) + El(1080, 800, 260, 60, F('#000000', 0.4, { filter: B(16) }));
    o += hand(520, false) + hand(1080, true);
    return o;
  };

  CG['two-chairs'] = function (c) {
    var o = R(0, 0, 1600, 900, { fill: c.vg(c.L('#b9a892'), c.L('#8a7a6a')) });
    // one tall window
    var cp = c.clip(R(420, 60, 760, 540));
    o += R(396, 36, 808, 588, { fill: c.L('#f1ead8') }) + G(R(420, 60, 760, 540, { fill: c.grad(c.skyStops()) }) + (c.night ? G(stars(c, 90, 520, 'tcs'), { transform: 'translate(0 60)' }) + moon(c, 1010, 190, 34) : c.tod === 'day' ? Ci(980, 170, 300, { fill: c.rg(c.P.sun, 0.8) }) + Ci(980, 170, 30, F('#fffdf2', 0.95, { filter: B(4) })) : Ci(900, 560, 420, { fill: c.rg(c.P.sun, 0.9) }) + Ci(900, 560, 40, F('#fffdf2', 0.95, { filter: B(4) }))) + clouds(c, 5, 100, 420, 0.8, 'tc') + city(c, 'tc', 600, 20, 110, '#4f4666', 0.35, { w: 30, lights: 0.2 }), { 'clip-path': cp });
    o += R(792, 60, 16, 540, { fill: c.L('#f1ead8') }) + R(420, 320, 760, 12, { fill: c.L('#f1ead8') });
    o += floor(c, 660, '#8f6f55');
    var tk = c.night ? 0.4 : 1;   // the moon throws less light than the sun
    c.post += R(340, 0, 920, 680, F(c.P.key, 0.3 * tk, { filter: B(40) })) + poly([[420, 600], [1180, 600], [1500, 900], [100, 900]], { fill: c.grad([[0, c.P.key, 0.55 * tk], [1, c.P.key, 0.1 * tk]]), filter: B(16) });
    // two chairs, backs to us, facing the light
    function chair(x, s, tilt) {
      var col = c.L('#2a1f24'), out = El(x + 60 * s, 866, 150 * s, 18 * s, F('#1a1220', 0.5, { filter: B(8) }));
      out += poly([[x - 90 * s, 880], [x - 60 * s, 880], [x + 220 * s, 740], [x + 200 * s, 730]], F('#1a1220', 0.25, { filter: B(8) }));
      out += G(R(-70 * s, -260 * s, 14 * s, 430 * s, { fill: col, rx: 6 }) + R(56 * s, -260 * s, 14 * s, 430 * s, { fill: col, rx: 6 }) + R(-70 * s, -260 * s, 140 * s, 24 * s, { fill: col, rx: 8 }) + R(-70 * s, -180 * s, 140 * s, 14 * s, { fill: col, rx: 6 }) +
        R(-48 * s, -240 * s, 10 * s, 70 * s, { fill: col }) + R(-5 * s, -240 * s, 10 * s, 70 * s, { fill: col }) + R(38 * s, -240 * s, 10 * s, 70 * s, { fill: col }) +
        R(-80 * s, -20 * s, 160 * s, 22 * s, { fill: col, rx: 6 }) + R(-56 * s, 0, 10 * s, 150 * s, { fill: col }) + R(46 * s, 0, 10 * s, 150 * s, { fill: col }) +
        R(-70 * s, -260 * s, 4 * s, 430 * s, F(c.P.rim, 0.7)) + R(-70 * s, -260 * s, 140 * s, 4 * s, F(c.P.rim, 0.7)), { transform: 'translate(' + x + ' 710) rotate(' + tilt + ')' });
      return out;
    }
    o += chair(600, 1, -2) + chair(1010, 1, 3);
    return o;
  };

  CG['corridor-light'] = function (c) {
    var o = BG.corridor(c);
    // a door at the end, open, and everything beyond it is light
    c.post += R(0, 0, 1600, 900, F(c.P.shadow, 0.45)) + Ci(700, 400, 700, { fill: c.grad([[0, '#fff6dc', 1], [0.12, '#ffe9b8', 0.85], [0.45, c.P.key, 0.3], [1, c.P.key, 0]], { radial: true, r: '50%' }) }) +
      poly([[640, 330], [760, 330], [1100, 900], [300, 900]], { fill: c.grad([[0, '#fff3cf', 0.7], [1, '#fff3cf', 0.05]]), filter: B(16) }) + R(650, 300, 100, 200, F('#fffdf2', 0.95, { filter: B(8) }));
    return o;
  };

  CG['sea-of-points'] = function (c) {
    var hy = 400, o = R(0, 0, 1600, 900, { fill: c.grad([[0, '#02040f'], [0.45, '#0b1740'], [0.5, '#27408f'], [0.56, '#0a1335'], [1, '#03050f']]) });
    o += stars(c, 220, hy, 'sp');
    o += El(800, hy, 900, 90, F('#6f9fff', 0.5, { filter: B(40) })) + El(800, hy, 420, 26, F('#dfe9ff', 0.8, { filter: B(16) }));
    // the lattice plane: rows receding to the horizon, a slow swell across it
    var r = c.rnd('pts'), far = '', mid = '', near = '', lines = '', rows = 26, prev = null;
    for (var i = 1; i <= rows; i++) {
      var t = i / rows, z = t * t, y = hy + 6 + z * 520, spread = 60 + z * 1500, n = 30, row = [];
      for (var j = 0; j <= n; j++) {
        var u = j / n - 0.5, x = 800 + u * spread * 2.4, yy = y + Math.sin(j * 0.7 + i * 0.55) * 14 * z - Math.cos(j * 0.23 + i * 0.3) * 30 * z;
        if (x < -40 || x > 1640) { row.push(null); continue; }
        row.push([x, yy]);
        var hot = r() < 0.07, rad = (0.8 + z * 5) * (hot ? 1.9 : 1), dot = Ci(x, yy, rad, F(hot ? '#fff1c9' : (j + i) % 5 === 0 ? '#bfe9ff' : '#8fb4ff', 0.5 + r() * 0.5));
        if (t < 0.4) far += dot; else if (t < 0.75) mid += dot; else near += dot;
        if (j && row[j - 1]) lines += '<path d="M' + num(row[j - 1][0]) + ' ' + num(row[j - 1][1]) + 'L' + num(x) + ' ' + num(yy) + '" stroke-opacity="' + num(0.08 + z * 0.3) + '" stroke-width="' + num(0.5 + z * 1.4) + '"/>';
        if (prev && prev[j]) lines += '<path d="M' + num(prev[j][0]) + ' ' + num(prev[j][1]) + 'L' + num(x) + ' ' + num(yy) + '" stroke-opacity="' + num(0.06 + z * 0.24) + '" stroke-width="' + num(0.5 + z * 1.4) + '"/>';
      }
      prev = row;
    }
    o += G(lines, { stroke: '#7fa6ff', fill: 'none' }) + G(far) + G(mid + near, { filter: B(4), opacity: 0.8 }) + G(mid) + G(near, { filter: B(2) });
    // a few filaments rising off the surface
    var fl = ''; for (var k = 0; k < 9; k++) { var fx = 200 + r() * 1200, fy = 520 + r() * 260; fl += Pa('M' + num(fx) + ' ' + num(fy) + 'C' + num(fx + (r() - 0.5) * 200) + ' ' + num(fy - 160) + ' ' + num(800 + (fx - 800) * 0.4) + ' ' + num(hy + 60) + ' ' + num(800 + (fx - 800) * 0.15) + ' ' + num(hy - 80 - r() * 200), S('#cfe0ff', 1.5, 0.35)); }
    o += G(fl, { filter: B(2) });
    c.pool(800, hy - 140, 360, '#9fbaff', 0.25);
    return o;
  };

  CG.page = function (c) {
    var o = R(0, 0, 1600, 900, { fill: c.grad([[0, c.L('#7a5a43')], [1, c.L('#4f3628')]], { x1: 0, y1: 0, x2: 1, y2: 1 }) });
    o += pageSheet(c, 230, -120, 1140, 1300, -4, 'cgpage', { lh: 62, title: true });
    // a fountain pen resting across the corner
    o += G(R(8, 10, 520, 26, F('#000000', 0.3, { filter: B(8), rx: 13 })) + R(0, 0, 420, 26, { fill: c.vg('#2c3350', '#141a2e'), rx: 13 }) + R(300, 0, 20, 26, { fill: '#c8a560' }) + poly([[420, 2], [500, 13], [420, 24]], { fill: '#d9b870' }) + line(440, 13, 496, 13, S('#3d2a20', 2)), { transform: 'translate(900 640) rotate(-24)' });
    c.post += poly([[0, 0], [1000, 0], [1500, 900], [200, 900]], { fill: c.grad([[0, c.P.key, 0.42], [1, c.P.key, 0]], { x1: 0, y1: 0, x2: 1, y2: 1 }), filter: B(40) });
    return o;
  };

  CG['window-rain'] = function (c) {
    // night by default; by day, dusk or dawn the glass takes that hour's (clouded) sky
    var sk = c.P.sky, o = R(0, 0, 1600, 900, { fill: c.night ? c.vg('#0d1428', '#1b2748') : c.vg(mix(sk[0], '#5a6274', 0.55), mix(sk[sk.length - 2], '#8a90a0', 0.5)) }), r = c.rnd('rain'), bk = '', i;
    // the city, out of focus behind wet glass
    for (i = 0; i < 60; i++) bk += Ci(r() * 1600, 300 + r() * 520, 16 + r() * 46, F(['#ffd98c', '#ff9f8a', '#9fd0ff', '#ffe9c4', '#c9a8ff'][Math.floor(r() * 5)], 0.18 + r() * 0.36));
    o += G(city(c, 'wr', 900, 200, 560, c.night ? '#0c1226' : '#3a4258', 0.2, { w: 90, lights: 0 }), { filter: B(8) }) + G(bk, { filter: B(8), opacity: c.night ? null : c.tod === 'day' ? 0.35 : 0.7 });
    // streaks and drops
    var st = '', dr = '';
    for (i = 0; i < 46; i++) { var x = r() * 1600, y = r() * 500, len = 120 + r() * 420; st += Pa('M' + num(x) + ' ' + num(y) + 'q' + num((r() - 0.5) * 16) + ' ' + num(len * 0.5) + ' ' + num((r() - 0.5) * 10) + ' ' + num(len), S('#dfe9ff', 2 + r() * 3, 0.1 + r() * 0.16)); dr += El(x + (r() - 0.5) * 8, y + len, 5 + r() * 5, 8 + r() * 8, F('#eaf2ff', 0.45 + r() * 0.3)); }
    for (i = 0; i < 160; i++) dr += El(r() * 1600, r() * 900, 1.5 + r() * 4, 2 + r() * 5, F('#eaf2ff', 0.2 + r() * 0.4));
    o += st + G(dr) + G(dr, { filter: B(4), opacity: 0.5 });
    // window frame, dark, close
    o += R(770, 0, 60, 900, { fill: '#0a0d18' }) + R(0, 560, 1600, 36, { fill: '#0a0d18' }) + R(0, 0, 1600, 30, { fill: '#0a0d18' }) + R(0, 846, 1600, 54, { fill: '#10141f' }) + R(0, 846, 1600, 5, F('#9fb6ff', 0.25));
    return o;
  };

  var CG_NAMES = ['tree', 'desk-night', 'screen-code', 'hands-keyboard', 'two-chairs', 'corridor-light', 'sea-of-points', 'page', 'window-rain'];

  function cgFallback(c) {
    var P = c.P, o = R(0, 0, 1600, 900, { fill: c.grad([[0, P.sky[1]], [1, P.sky[0]]], { x1: 0, y1: 0, x2: 1, y2: 1 }) }), r = c.rnd('fb'), a = '';
    for (var i = 0; i < 7; i++) a += Ci(300 + r() * 1000, 200 + r() * 500, 120 + r() * 260, F(i % 2 ? P.key : P.sun, 0.1 + r() * 0.12));
    o += G(a, { filter: B(40) });
    for (var k = 0; k < 5; k++) o += Ci(800, 450, 120 + k * 70, S('#ffffff', 1.5, 0.22 - k * 0.035));
    c.pool(800, 450, 420, P.sun, 0.3);
    return o;
  }

  // cg(name, modifier, opts) -> <svg viewBox="0 0 1600 900">; unknown names give an abstract fallback (data-cg="fallback")
  //   modifier: day | dusk | dawn | night repaints the hour for the CGs that have a sky (two-chairs, corridor-light,
  //   window-rain, tree); the others keep their own. opts: { overcast: true } (no moon, no stars),
  //   { text: 'identifier' } (the one readable name on screen-code).
  var CG_HOURS = { 'two-chairs': 1, 'corridor-light': 1, 'window-rain': 1, tree: 1 };
  function cg(name, modifier, opts) {
    name = String(name || '').toLowerCase();
    opts = opts || {};
    var known = CG.hasOwnProperty(name), tod = known ? CG_TOD[name] : 'night';
    if (known && CG_HOURS[name] && TOD[modifier]) tod = modifier;
    var c = new Ctx('cg:' + name, tod);
    c.opts = opts; c.overcast = !!opts.overcast && name !== 'sea-of-points';
    return finish(c, known ? CG[name](c) : cgFallback(c), { 'class': 'vn-cg-svg', 'data-cg': known ? name : 'fallback', 'data-tod': tod }, false, known && (name === 'sea-of-points' || name === 'screen-code') ? 0.7 : 0.55);
  }

  /* ------------------------------------------------------------ particles */

  var FX_NAMES = ['petals', 'snow', 'rain', 'dust', 'fireflies'];
  // One tile of falling things; the layer holds it twice so the loop is seamless.
  function tile(kind, seed, n, size) {
    var r = K.rngFor('fx:' + kind + ':' + seed), o = '';
    for (var i = 0; i < n; i++) {
      var x = r() * 1600, y = r() * 900, s = size * (0.6 + r() * 0.8);
      if (kind === 'petals') o += '<path d="M0 0 C' + num(s * 0.9) + ' ' + num(-s * 0.9) + ' ' + num(s * 2.2) + ' ' + num(-s * 0.3) + ' ' + num(s * 2.4) + ' ' + num(s * 0.2) + ' C' + num(s * 1.6) + ' ' + num(s * 0.9) + ' ' + num(s * 0.5) + ' ' + num(s * 0.7) + ' 0 0Z" fill="' + (r() < 0.5 ? '#ffd9e4' : r() < 0.5 ? '#f7b6ca' : '#fff0f4') + '" opacity="' + num(0.65 + r() * 0.35) + '" transform="translate(' + num(x) + ' ' + num(y) + ') rotate(' + Math.round(r() * 360) + ')"/>';
      else if (kind === 'snow') o += Ci(x, y, s, F('#ffffff', 0.55 + r() * 0.45));
      else o += line(x, y, x - s * 3, y + s * 16, S('#dce8ff', Math.max(1, s * 0.5), 0.25 + r() * 0.35));
    }
    return K.svg('0 0 1600 900', o, { preserveAspectRatio: 'xMidYMid slice' });
  }
  // fx(name) -> HTML for one persistent particle layer. Animation lives in vn.css; with no CSS
  // (or reduced motion) the first tile simply sits still, which is the settled frame.
  function fx(name) {
    name = String(name || '').toLowerCase();
    if (FX_NAMES.indexOf(name) < 0) return '';
    var out = '<div class="vn-fx vn-fx-' + name + '" data-fx="' + name + '" aria-hidden="true">', i, r = K.rngFor('fx:' + name);
    if (name === 'petals' || name === 'snow' || name === 'rain') {
      var spec = name === 'petals' ? [[26, 5, 26, 14], [16, 8, 17, 22], [7, 13, 11, 34]] : name === 'snow' ? [[90, 2, 30, 4], [50, 3.4, 20, 8], [18, 6, 13, 14]] : [[110, 1.6, 0.9, -6], [70, 2.4, 0.7, -9], [30, 3.4, 0.55, -12]];
      for (i = 0; i < 3; i++) {
        var t = tile(name, i, spec[i][0], spec[i][1]);
        out += '<div class="vn-fx-layer vn-fx-l' + i + '" style="--dur:' + spec[i][2] + 's;--dx:' + spec[i][3] + '%"><div class="vn-fx-tile">' + t + '</div><div class="vn-fx-tile vn-fx-tile2">' + t + '</div></div>';
      }
    } else {
      var n = name === 'dust' ? 46 : 22;
      for (i = 0; i < n; i++) {
        var s = name === 'dust' ? 2 + r() * 5 : 5 + r() * 5;
        out += '<i style="left:' + num(r() * 100) + '%;top:' + num((name === 'dust' ? 5 : 30) + r() * (name === 'dust' ? 80 : 60)) + '%;width:' + num(s) + 'px;height:' + num(s) + 'px;--d:' + num(6 + r() * 10) + 's;--t:' + num(-r() * 12) + 's;--x:' + num((r() - 0.5) * 90) + 'px;--y:' + num((r() - 0.7) * 70) + 'px;opacity:' + num(0.35 + r() * 0.6) + '"></i>';
      }
    }
    return out + '</div>';
  }

  return {
    background: background, BACKGROUNDS: BG_NAMES, MODIFIERS: MODS, timeOf: timeOf, TOD: TOD, INDOOR: INDOOR,
    cg: cg, CGS: CG_NAMES, fx: fx, FX: FX_NAMES
  };
});
