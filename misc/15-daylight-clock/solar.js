/*
 * solar.js
 *
 * Sun position and sunrise / sunset times from the NOAA solar calculator
 * equations (the ones behind the NOAA "Solar Calculation Details"
 * spreadsheet, which in turn follow Meeus, Astronomical Algorithms).
 *
 * Works both in the browser (defines window.Solar) and in Node
 * (module.exports). No dependencies.
 *
 * Conventions:
 *   latitude   degrees, north positive
 *   longitude  degrees, east positive (Dallas is about -96.8)
 *   All returned instants are plain JavaScript Date objects in UTC.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.Solar = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var RAD = Math.PI / 180;
  var DEG = 180 / Math.PI;
  var MS_PER_DAY = 86400000;
  var MS_PER_MIN = 60000;

  // Altitude of the sun's centre that defines each event, in degrees.
  // Sunrise and sunset include refraction and the sun's radius (-0.833).
  // Civil twilight is the conventional -6 degrees.
  var HORIZON = -0.833;
  var CIVIL = -6;

  /** Julian Day for a given UTC instant (milliseconds since the epoch). */
  function julianDay(ms) {
    return ms / MS_PER_DAY + 2440587.5;
  }

  /**
   * Position of the sun for a Julian Day, following the NOAA sequence.
   * Returns declination (degrees) and equation of time (minutes).
   */
  function sunPosition(jd) {
    var T = (jd - 2451545.0) / 36525.0; // Julian centuries since J2000.0

    // Geometric mean longitude of the sun, degrees, reduced to [0, 360)
    var L0 = (280.46646 + T * (36000.76983 + T * 0.0003032)) % 360;
    if (L0 < 0) L0 += 360;

    // Geometric mean anomaly of the sun, degrees
    var M = 357.52911 + T * (35999.05029 - 0.0001537 * T);

    // Eccentricity of the Earth's orbit
    var e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);

    // Equation of centre, degrees
    var C =
      Math.sin(M * RAD) * (1.914602 - T * (0.004817 + 0.000014 * T)) +
      Math.sin(2 * M * RAD) * (0.019993 - 0.000101 * T) +
      Math.sin(3 * M * RAD) * 0.000289;

    // True longitude, then apparent longitude corrected for nutation
    // and aberration (omega is the longitude of the ascending node of
    // the Moon's mean orbit).
    var trueLong = L0 + C;
    var omega = 125.04 - 1934.136 * T;
    var lambda = trueLong - 0.00569 - 0.00478 * Math.sin(omega * RAD);

    // Mean obliquity of the ecliptic, then corrected obliquity
    var eps0 =
      23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
    var eps = eps0 + 0.00256 * Math.cos(omega * RAD);

    // Declination of the sun, degrees
    var decl = Math.asin(Math.sin(eps * RAD) * Math.sin(lambda * RAD)) * DEG;

    // Equation of time, minutes (apparent solar time minus mean solar time)
    var y = Math.tan((eps / 2) * RAD);
    y = y * y;
    var eqTime =
      4 * DEG *
      (y * Math.sin(2 * L0 * RAD) -
        2 * e * Math.sin(M * RAD) +
        4 * e * y * Math.sin(M * RAD) * Math.cos(2 * L0 * RAD) -
        0.5 * y * y * Math.sin(4 * L0 * RAD) -
        1.25 * e * e * Math.sin(2 * M * RAD));

    return { declination: decl, eqTime: eqTime };
  }

  /**
   * Hour angle (degrees, positive) at which the sun's centre reaches
   * `altitude` degrees, for the given latitude and declination.
   * Returns null when the sun never reaches that altitude on this day
   * (polar day or polar night), instead of taking acos of a value
   * outside [-1, 1].
   */
  function hourAngle(lat, decl, altitude) {
    var latR = lat * RAD;
    var declR = decl * RAD;
    var denom = Math.cos(latR) * Math.cos(declR);
    if (Math.abs(denom) < 1e-9) return null; // exactly at a pole
    var cosH =
      (Math.cos((90 - altitude) * RAD) - Math.sin(latR) * Math.sin(declR)) / denom;
    if (cosH > 1 || cosH < -1) return null;
    return Math.acos(cosH) * DEG;
  }

  /**
   * Compute sunrise, solar noon, sunset, civil dawn and civil dusk for
   * the calendar date given as (year, month, day), where month is 1..12.
   *
   * The date is interpreted the NOAA way: results belong to the solar day
   * whose solar noon falls on that UTC date at this longitude. For every
   * longitude this matches the local civil date, so passing the local
   * date of a city gives that city's sunrise and sunset for that date.
   *
   * Returns an object with Date fields (UTC instants) or null where the
   * event does not occur:
   *   { sunrise, solarNoon, sunset, dawn, dusk,
   *     dayLengthMinutes, declination, eqTime, polar }
   * `polar` is "day", "night" or null.
   */
  function solarEvents(year, month, day, lat, lon) {
    var midnightMs = Date.UTC(year, month - 1, day, 0, 0, 0);
    var jd0 = julianDay(midnightMs);

    // First pass at noon UT to get a good solar noon estimate.
    var pos = sunPosition(jd0 + 0.5);
    var noonMin = 720 - 4 * lon - pos.eqTime;

    // Refine with the sun position at the actual solar noon (NOAA does
    // the same). The change is a fraction of a minute but it is cheap.
    pos = sunPosition(jd0 + noonMin / 1440);
    noonMin = 720 - 4 * lon - pos.eqTime;

    function atMinutes(min) {
      return new Date(midnightMs + min * MS_PER_MIN);
    }

    // Evaluate an event at the given altitude on the morning (-1) or
    // evening (+1) side, re-evaluating the sun position at the event
    // time itself for a little extra accuracy.
    function event(altitude, side) {
      var ha = hourAngle(lat, pos.declination, altitude);
      if (ha === null) return null;
      var min = noonMin + side * 4 * ha;
      var p2 = sunPosition(jd0 + min / 1440);
      var ha2 = hourAngle(lat, p2.declination, altitude);
      if (ha2 === null) return null;
      min = 720 - 4 * lon - p2.eqTime + side * 4 * ha2;
      return atMinutes(min);
    }

    var sunrise = event(HORIZON, -1);
    var sunset = event(HORIZON, +1);
    var dawn = event(CIVIL, -1);
    var dusk = event(CIVIL, +1);

    var polar = null;
    if (sunrise === null) {
      // Sun is either up all day or down all day. Its altitude at solar
      // noon tells which.
      var noonAlt = altitude(atMinutes(noonMin), lat, lon);
      polar = noonAlt > HORIZON ? "day" : "night";
    }

    var dayLength = null;
    if (sunrise && sunset) dayLength = (sunset - sunrise) / MS_PER_MIN;
    else if (polar === "day") dayLength = 1440;
    else if (polar === "night") dayLength = 0;

    return {
      sunrise: sunrise,
      solarNoon: atMinutes(noonMin),
      sunset: sunset,
      dawn: dawn,
      dusk: dusk,
      dayLengthMinutes: dayLength,
      declination: pos.declination,
      eqTime: pos.eqTime,
      polar: polar
    };
  }

  /**
   * Altitude of the sun's centre in degrees (no refraction) at a given
   * instant for a given place. Used to draw the arc across the day.
   */
  function altitude(date, lat, lon) {
    var ms = date.getTime();
    var pos = sunPosition(julianDay(ms));
    var minutesUTC = ((ms % MS_PER_DAY) + MS_PER_DAY) % MS_PER_DAY / MS_PER_MIN;
    // True solar time in minutes, then hour angle in degrees
    var tst = (minutesUTC + pos.eqTime + 4 * lon) % 1440;
    if (tst < 0) tst += 1440;
    var ha = tst / 4 - 180;
    var latR = lat * RAD;
    var declR = pos.declination * RAD;
    var sinAlt =
      Math.sin(latR) * Math.sin(declR) +
      Math.cos(latR) * Math.cos(declR) * Math.cos(ha * RAD);
    return Math.asin(Math.max(-1, Math.min(1, sinAlt))) * DEG;
  }

  return {
    solarEvents: solarEvents,
    altitude: altitude,
    sunPosition: sunPosition,
    julianDay: julianDay,
    HORIZON: HORIZON,
    CIVIL: CIVIL
  };
});
