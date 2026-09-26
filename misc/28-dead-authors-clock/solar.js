/* Solar position and sunrise/sunset, after the NOAA Solar Calculator equations
   (Meeus, Astronomical Algorithms, low-precision series). Works in the browser
   (window.Solar) and in Node (module.exports) so it can be unit-tested. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Solar = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var RAD = Math.PI / 180;
  var ZENITH = 90.833; // official sunrise/sunset: refraction + solar radius

  // Julian centuries since J2000.0 for a JS timestamp (ms since epoch, UTC)
  function centuries(ms) { return (ms / 86400000 + 2440587.5 - 2451545) / 36525; }

  // Sun's apparent position for a given Julian century: declination (deg) and equation of time (minutes)
  function sunParams(T) {
    var L0 = (280.46646 + T * (36000.76983 + T * 0.0003032)) % 360; if (L0 < 0) L0 += 360;
    var M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
    var e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
    var C = Math.sin(M * RAD) * (1.914602 - T * (0.004817 + 0.000014 * T)) +
            Math.sin(2 * M * RAD) * (0.019993 - 0.000101 * T) + Math.sin(3 * M * RAD) * 0.000289;
    var trueLong = L0 + C;
    var omega = 125.04 - 1934.136 * T;
    var lambda = trueLong - 0.00569 - 0.00478 * Math.sin(omega * RAD);
    var eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
    var eps = eps0 + 0.00256 * Math.cos(omega * RAD);
    var decl = Math.asin(Math.sin(eps * RAD) * Math.sin(lambda * RAD)) / RAD;
    var y = Math.tan(eps * RAD / 2); y *= y;
    var eqt = 4 / RAD * (y * Math.sin(2 * L0 * RAD) - 2 * e * Math.sin(M * RAD) + 4 * e * y * Math.sin(M * RAD) * Math.cos(2 * L0 * RAD) -
              0.5 * y * y * Math.sin(4 * L0 * RAD) - 1.25 * e * e * Math.sin(2 * M * RAD));
    return { decl: decl, eqt: eqt };
  }

  // Sun altitude in degrees above the horizon at time ms for lat/lon (deg, east positive)
  function altitude(ms, lat, lon) {
    var p = sunParams(centuries(ms));
    var utcMin = (ms / 60000) % 1440; if (utcMin < 0) utcMin += 1440;
    var tst = (utcMin + p.eqt + 4 * lon) % 1440; if (tst < 0) tst += 1440;
    var ha = tst / 4 - 180; // hour angle, degrees
    var sinAlt = Math.sin(lat * RAD) * Math.sin(p.decl * RAD) + Math.cos(lat * RAD) * Math.cos(p.decl * RAD) * Math.cos(ha * RAD);
    return Math.asin(Math.max(-1, Math.min(1, sinAlt))) / RAD;
  }

  // Sunrise and sunset (ms timestamps) for the UTC calendar day containing dayMs.
  // Returns null for either when the sun does not cross the horizon that day.
  function events(dayMs, lat, lon) {
    var midnight = Math.floor(dayMs / 86400000) * 86400000;
    var noon = midnight + 43200000;
    function solve(kind) {
      // iterate twice: parameters at local solar noon, then at the event itself
      var t = noon - lon * 240000; // approximate local solar noon in UTC
      for (var i = 0; i < 2; i++) {
        var p = sunParams(centuries(t));
        var cosH = Math.cos(ZENITH * RAD) / (Math.cos(lat * RAD) * Math.cos(p.decl * RAD)) - Math.tan(lat * RAD) * Math.tan(p.decl * RAD);
        if (cosH > 1 || cosH < -1) return null;
        var H = Math.acos(cosH) / RAD;
        var minutes = 720 - 4 * (lon + (kind === 'rise' ? H : -H)) - p.eqt; // UTC minutes from midnight
        t = midnight + minutes * 60000;
      }
      return t;
    }
    return { sunrise: solve('rise'), sunset: solve('set') };
  }

  // The sun's situation at time ms: altitude, last/next sunrise and sunset around now, and a state label.
  // Looks at yesterday, today and tomorrow (UTC days) so it works in any time zone.
  function situation(ms, lat, lon) {
    var rises = [], sets = [];
    for (var d = -1; d <= 1; d++) {
      var ev = events(ms + d * 86400000, lat, lon);
      if (ev.sunrise !== null) rises.push(ev.sunrise);
      if (ev.sunset !== null) sets.push(ev.sunset);
    }
    function around(list) {
      var last = null, next = null;
      for (var i = 0; i < list.length; i++) {
        if (list[i] <= ms && (last === null || list[i] > last)) last = list[i];
        if (list[i] > ms && (next === null || list[i] < next)) next = list[i];
      }
      return { last: last, next: next };
    }
    var alt = altitude(ms, lat, lon);
    var r = around(rises), s = around(sets);
    var state;
    if (alt > 0) state = 'day';
    else {
      // evening side if the last event was a sunset (or dusk twilight), morning side otherwise
      var sinceSet = s.last === null ? Infinity : ms - s.last;
      var toRise = r.next === null ? Infinity : r.next - ms;
      var evening = sinceSet < toRise;
      state = alt > -6 ? (evening ? 'dusk' : 'dawn') : 'night';
    }
    // minutes to the nearest sunset, negative when it has just passed
    var toSet = s.next === null ? Infinity : (s.next - ms) / 60000;
    var sinceSet2 = s.last === null ? Infinity : (ms - s.last) / 60000;
    var sunsetDelta = sinceSet2 < toSet ? -sinceSet2 : toSet;
    var toRiseMin = r.next === null ? Infinity : (r.next - ms) / 60000;
    var sinceRise = r.last === null ? Infinity : (ms - r.last) / 60000;
    var sunriseDelta = sinceRise < toRiseMin ? -sinceRise : toRiseMin;
    return { altitude: alt, state: state, sunsetDelta: sunsetDelta, sunriseDelta: sunriseDelta,
             nextSunset: s.next, lastSunset: s.last, nextSunrise: r.next, lastSunrise: r.last };
  }

  return { altitude: altitude, events: events, situation: situation, sunParams: sunParams, centuries: centuries };
}));
