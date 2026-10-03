/* Bookshelf Planetarium: astronomy engine (no DOM). Works in the browser as window.Sky and under Node.
   Low-precision formulas: Meeus (sidereal time, Sun) and Paul Schlyter's simplified orbital
   elements (Moon, planets). Good to a degree or two, which is all a naked-eye chart needs. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Sky = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var D2R = Math.PI / 180, R2D = 180 / Math.PI;
  function wrap360(x) { x = x % 360; return x < 0 ? x + 360 : x; }
  function wrap180(x) { x = wrap360(x); return x >= 180 ? x - 360 : x; }
  function sind(x) { return Math.sin(x * D2R); }
  function cosd(x) { return Math.cos(x * D2R); }
  function tand(x) { return Math.tan(x * D2R); }
  function asind(x) { return Math.asin(Math.max(-1, Math.min(1, x))) * R2D; }
  function acosd(x) { return Math.acos(Math.max(-1, Math.min(1, x))) * R2D; }
  function atan2d(y, x) { return Math.atan2(y, x) * R2D; }

  function toJD(date) { return date.getTime() / 86400000 + 2440587.5; }
  function fromJD(jd) { return new Date((jd - 2440587.5) * 86400000); }

  // Greenwich mean sidereal time in degrees (Meeus 12.4)
  function gmst(jd) {
    var T = (jd - 2451545.0) / 36525;
    return wrap360(280.46061837 + 360.98564736629 * (jd - 2451545.0) + 0.000387933 * T * T - T * T * T / 38710000);
  }
  function lst(jd, lon) { return wrap360(gmst(jd) + lon); }

  // Equatorial (deg) -> horizontal. Azimuth from north through east.
  function toHoriz(ra, dec, lstDeg, lat) {
    var H = lstDeg - ra;
    var sinAlt = sind(dec) * sind(lat) + cosd(dec) * cosd(lat) * cosd(H);
    var alt = asind(sinAlt);
    var az = wrap360(atan2d(sind(H), cosd(H) * sind(lat) - tand(dec) * cosd(lat)) + 180);
    return { alt: alt, az: az };
  }
  function toEquatorial(alt, az, lstDeg, lat) {
    var A = az - 180;
    var sinDec = sind(lat) * sind(alt) - cosd(lat) * cosd(alt) * cosd(A);
    var dec = asind(sinDec);
    var H = atan2d(sind(A), cosd(A) * sind(lat) + tand(alt) * cosd(lat));
    return { ra: wrap360(lstDeg - H), dec: dec };
  }
  function angSep(ra1, dec1, ra2, dec2) {
    return acosd(sind(dec1) * sind(dec2) + cosd(dec1) * cosd(dec2) * cosd(ra1 - ra2));
  }

  function eclToEq(lon, lat, eps) {
    var x = cosd(lon) * cosd(lat), y = sind(lon) * cosd(lat), z = sind(lat);
    var ye = y * cosd(eps) - z * sind(eps), ze = y * sind(eps) + z * cosd(eps);
    return { ra: wrap360(atan2d(ye, x)), dec: asind(ze) };
  }

  // ---- Schlyter elements. d = days since 1999-12-31 0:00 UT.
  function dayNum(jd) { return jd - 2451543.5; }
  function obliquity(d) { return 23.4393 - 3.563e-7 * d; }
  function kepler(M, e) {
    var E = M + e * R2D * sind(M) * (1 + e * cosd(M));
    for (var i = 0; i < 10; i++) {
      var dE = (E - e * R2D * sind(E) - M) / (1 - e * cosd(E));
      E -= dE; if (Math.abs(dE) < 1e-6) break;
    }
    return E;
  }
  // true anomaly v and distance r from elements
  function orbit(el) {
    var E = kepler(el.M, el.e);
    var x = el.a * (cosd(E) - el.e), y = el.a * Math.sqrt(1 - el.e * el.e) * sind(E);
    return { v: atan2d(y, x), r: Math.sqrt(x * x + y * y) };
  }
  function helio(el) {
    var o = orbit(el), u = o.v + el.w;
    var xh = o.r * (cosd(el.N) * cosd(u) - sind(el.N) * sind(u) * cosd(el.i));
    var yh = o.r * (sind(el.N) * cosd(u) + cosd(el.N) * sind(u) * cosd(el.i));
    var zh = o.r * sind(u) * sind(el.i);
    return { lon: wrap360(atan2d(yh, xh)), lat: atan2d(zh, Math.sqrt(xh * xh + yh * yh)), r: o.r };
  }
  var ELEMENTS = {
    sun: function (d) { return { N: 0, i: 0, w: 282.9404 + 4.70935e-5 * d, a: 1, e: 0.016709 - 1.151e-9 * d, M: wrap360(356.0470 + 0.9856002585 * d) }; },
    moon: function (d) { return { N: 125.1228 - 0.0529538083 * d, i: 5.1454, w: 318.0634 + 0.1643573223 * d, a: 60.2666, e: 0.054900, M: wrap360(115.3654 + 13.0649929509 * d) }; },
    Mercury: function (d) { return { N: 48.3313 + 3.24587e-5 * d, i: 7.0047 + 5.0e-8 * d, w: 29.1241 + 1.01444e-5 * d, a: 0.387098, e: 0.205635 + 5.59e-10 * d, M: wrap360(168.6562 + 4.0923344368 * d) }; },
    Venus: function (d) { return { N: 76.6799 + 2.46590e-5 * d, i: 3.3946 + 2.75e-8 * d, w: 54.8910 + 1.38374e-5 * d, a: 0.723330, e: 0.006773 - 1.302e-9 * d, M: wrap360(48.0052 + 1.6021302244 * d) }; },
    Mars: function (d) { return { N: 49.5574 + 2.11081e-5 * d, i: 1.8497 - 1.78e-8 * d, w: 286.5016 + 2.92961e-5 * d, a: 1.523688, e: 0.093405 + 2.516e-9 * d, M: wrap360(18.6021 + 0.5240207766 * d) }; },
    Jupiter: function (d) { return { N: 100.4542 + 2.76854e-5 * d, i: 1.3030 - 1.557e-7 * d, w: 273.8777 + 1.64505e-5 * d, a: 5.20256, e: 0.048498 + 4.469e-9 * d, M: wrap360(19.8950 + 0.0830853001 * d) }; },
    Saturn: function (d) { return { N: 113.6634 + 2.38980e-5 * d, i: 2.4886 - 1.081e-7 * d, w: 339.3939 + 2.97661e-5 * d, a: 9.55475, e: 0.055546 - 9.499e-9 * d, M: wrap360(316.9670 + 0.0334442282 * d) }; }
  };

  // Sun: geocentric ecliptic longitude and equatorial position
  function sun(jd) {
    var d = dayNum(jd), el = ELEMENTS.sun(d), o = orbit(el);
    var lon = wrap360(o.v + el.w);
    var eq = eclToEq(lon, 0, obliquity(d));
    return { name: 'Sun', lon: lon, r: o.r, ra: eq.ra, dec: eq.dec, M: el.M, L: wrap360(el.M + el.w) };
  }

  // Moon: geocentric, with the main perturbation terms. Distance in Earth radii.
  function moon(jd) {
    var d = dayNum(jd), el = ELEMENTS.moon(d), s = ELEMENTS.sun(d);
    var h = helio(el);
    var Ms = s.M, Mm = el.M, Ls = wrap360(s.M + s.w), Lm = wrap360(el.M + el.w + el.N);
    var D = Lm - Ls, F = Lm - el.N;
    var dlon = -1.274 * sind(Mm - 2 * D) + 0.658 * sind(2 * D) - 0.186 * sind(Ms) - 0.059 * sind(2 * Mm - 2 * D)
      - 0.057 * sind(Mm - 2 * D + Ms) + 0.053 * sind(Mm + 2 * D) + 0.046 * sind(2 * D - Ms) + 0.041 * sind(Mm - Ms)
      - 0.035 * sind(D) - 0.031 * sind(Mm + Ms) - 0.015 * sind(2 * F - 2 * D) + 0.011 * sind(Mm - 4 * D);
    var dlat = -0.173 * sind(F - 2 * D) - 0.055 * sind(Mm - F - 2 * D) - 0.046 * sind(Mm + F - 2 * D) + 0.033 * sind(F + 2 * D) + 0.017 * sind(2 * Mm + F);
    var dr = -0.58 * cosd(Mm - 2 * D) - 0.46 * cosd(2 * D);
    var lon = wrap360(h.lon + dlon), lat = h.lat + dlat, r = h.r + dr;
    var eq = eclToEq(lon, lat, obliquity(d));
    var sunLon = sun(jd).lon;
    var elong = acosd(cosd(lat) * cosd(lon - sunLon));
    var illum = (1 - cosd(elong)) / 2;
    var age = wrap360(lon - sunLon); // 0 new, 180 full
    return { name: 'Moon', lon: lon, lat: lat, r: r, ra: eq.ra, dec: eq.dec, parallax: asind(1 / r),
      illum: illum, waxing: age < 180, age: age, phaseName: phaseName(age) };
  }
  function phaseName(age) {
    if (age < 11.25 || age >= 348.75) return 'new moon';
    if (age < 78.75) return 'waxing crescent';
    if (age < 101.25) return 'first quarter';
    if (age < 168.75) return 'waxing gibbous';
    if (age < 191.25) return 'full moon';
    if (age < 258.75) return 'waning gibbous';
    if (age < 281.25) return 'last quarter';
    return 'waning crescent';
  }

  var PLANET_STYLE = {
    Mercury: { color: '#d9c7a9' }, Venus: { color: '#fff4d2' }, Mars: { color: '#ff8458' },
    Jupiter: { color: '#f4dfb8' }, Saturn: { color: '#ead89d' }
  };
  function planets(jd) {
    var d = dayNum(jd), eps = obliquity(d);
    var s = ELEMENTS.sun(d), so = orbit(s), sunLon = wrap360(so.v + s.w);
    var xs = so.r * cosd(sunLon), ys = so.r * sind(sunLon);
    var Mj = ELEMENTS.Jupiter(d).M, Ms = ELEMENTS.Saturn(d).M;
    var out = [];
    ['Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn'].forEach(function (name) {
      var h = helio(ELEMENTS[name](d));
      var lon = h.lon, lat = h.lat;
      if (name === 'Jupiter') {
        lon += -0.332 * sind(2 * Mj - 5 * Ms - 67.6) - 0.056 * sind(2 * Mj - 2 * Ms + 21) + 0.042 * sind(3 * Mj - 5 * Ms + 21)
          - 0.036 * sind(Mj - 2 * Ms) + 0.022 * cosd(Mj - Ms) + 0.023 * sind(2 * Mj - 3 * Ms + 52) - 0.016 * sind(Mj - 5 * Ms - 69);
      } else if (name === 'Saturn') {
        lon += 0.812 * sind(2 * Mj - 5 * Ms - 67.6) - 0.229 * cosd(2 * Mj - 4 * Ms - 2) + 0.119 * sind(Mj - 2 * Ms - 3)
          + 0.046 * sind(2 * Mj - 6 * Ms - 69) + 0.014 * sind(Mj - 3 * Ms + 32);
        lat += -0.020 * cosd(2 * Mj - 4 * Ms - 2) + 0.018 * sind(2 * Mj - 6 * Ms - 49);
      }
      var xh = h.r * cosd(lon) * cosd(lat), yh = h.r * sind(lon) * cosd(lat), zh = h.r * sind(lat);
      var xg = xh + xs, yg = yh + ys, zg = zh;
      var R = Math.sqrt(xg * xg + yg * yg + zg * zg);
      var glon = wrap360(atan2d(yg, xg)), glat = atan2d(zg, Math.sqrt(xg * xg + yg * yg));
      var eq = eclToEq(glon, glat, eps);
      // phase angle and approximate visual magnitude (Schlyter)
      var FV = acosd((h.r * h.r + R * R - so.r * so.r) / (2 * h.r * R));
      var mag;
      if (name === 'Mercury') mag = -0.36 + 5 * Math.log10(h.r * R) + 0.027 * FV + 2.2e-13 * Math.pow(FV, 6);
      else if (name === 'Venus') mag = -4.34 + 5 * Math.log10(h.r * R) + 0.013 * FV + 4.2e-7 * Math.pow(FV, 3);
      else if (name === 'Mars') mag = -1.51 + 5 * Math.log10(h.r * R) + 0.016 * FV;
      else if (name === 'Jupiter') mag = -9.25 + 5 * Math.log10(h.r * R) + 0.014 * FV;
      else mag = -9.0 + 5 * Math.log10(h.r * R) + 0.044 * FV - 0.9; // ring term averaged
      out.push({ name: name, ra: eq.ra, dec: eq.dec, mag: mag, dist: R, color: PLANET_STYLE[name].color });
    });
    return out;
  }

  // Next rise / set / transit after jd for a fixed RA/Dec. h0 is the altitude that counts as "risen".
  function riseSet(ra, dec, lat, lon, jd, h0) {
    if (h0 == null) h0 = -0.5667;
    var rate = 360.98564736629, lstNow = lst(jd, lon);
    var transit = jd + wrap360(ra - lstNow) / rate;
    var cosH = (sind(h0) - sind(lat) * sind(dec)) / (cosd(lat) * cosd(dec));
    var alt = toHoriz(ra, dec, lstNow, lat).alt;
    if (cosH < -1) return { status: 'circumpolar', transit: transit, alt: alt };
    if (cosH > 1) return { status: 'never', transit: transit, alt: alt };
    var H0 = acosd(cosH);
    var rise = jd + wrap360(ra - H0 - lstNow) / rate;
    var set = jd + wrap360(ra + H0 - lstNow) / rate;
    return { status: alt > h0 ? 'up' : 'down', rise: rise, set: set, transit: transit, alt: alt, hoursUp: 2 * H0 / 15 };
  }

  function twilight(sunAlt) {
    if (sunAlt > 0) return 'day';
    if (sunAlt > -6) return 'civil twilight';
    if (sunAlt > -12) return 'nautical twilight';
    if (sunAlt > -18) return 'astronomical twilight';
    return 'night';
  }

  // Galactic (l, b) -> equatorial J2000, via the Hipparcos rotation matrix
  function galToEq(l, b) {
    var gx = cosd(l) * cosd(b), gy = sind(l) * cosd(b), gz = sind(b);
    var x = -0.0548755604 * gx + 0.4941094279 * gy - 0.8676661490 * gz;
    var y = -0.8734370902 * gx - 0.4448296300 * gy - 0.1980763734 * gz;
    var z = -0.4838350155 * gx + 0.7469822445 * gy + 0.4559837762 * gz;
    return { ra: wrap360(atan2d(y, x)), dec: asind(z) };
  }

  // tiny seeded RNG
  function hash32(str) {
    var h = 2166136261 >>> 0;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h >>> 0;
  }
  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  // A stippled Milky Way: points scattered around the galactic equator, wider and denser toward the centre.
  function milkyWay(n, seed) {
    var rng = mulberry32(hash32(seed || 'milky')), pts = [];
    while (pts.length < n) {
      var l = rng() * 360;
      var toward = 0.55 + 0.45 * cosd(l);           // 1 at the galactic centre, 0.1 at the anticentre
      if (rng() > toward) continue;
      var width = 4 + 6 * toward;                   // half-width in degrees
      var g = (rng() + rng() + rng() - 1.5) * 1.6;  // roughly gaussian
      var b = g * width;
      // Great Rift: a dark lane just above the plane from Cygnus to Sagittarius (l 0..80)
      if (l < 80 && b > 0.5 && b < 4 && rng() < 0.7) continue;
      var eq = galToEq(l, b);
      pts.push([eq.ra, eq.dec, 0.5 + rng() * toward, rng()]);
    }
    return pts;
  }

  return {
    wrap360: wrap360, wrap180: wrap180, toJD: toJD, fromJD: fromJD, gmst: gmst, lst: lst,
    toHoriz: toHoriz, toEquatorial: toEquatorial, angSep: angSep, sun: sun, moon: moon, planets: planets,
    riseSet: riseSet, twilight: twilight, galToEq: galToEq, milkyWay: milkyWay, hash32: hash32, mulberry32: mulberry32
  };
}));
