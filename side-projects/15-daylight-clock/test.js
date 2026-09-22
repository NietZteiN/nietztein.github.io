// Self-check for solar.js. Run with:  node test.js
//
// Computes sunrise and sunset for the three cities on the solstices of
// 2026 and asserts that they fall within 3 minutes of reference values
// taken from published sunrise and sunset tables (timeanddate style).
// Local times are produced with Intl, so Node needs its bundled ICU data
// (the default in Node 22).

"use strict";
const assert = require("node:assert");
const Solar = require("./solar.js");

const CITIES = {
  Dallas:      { lat: 32.7767, lon: -96.7970, tz: "America/Chicago" },
  Saarbrücken: { lat: 49.2354, lon: 6.9969,   tz: "Europe/Berlin" },
  Sendai:      { lat: 38.2682, lon: 140.8694, tz: "Asia/Tokyo" }
};

// [year, month, day, city, published sunrise, published sunset] in local time
const REFERENCE = [
  [2026, 6, 21,  "Dallas",      "06:20", "20:39"],
  [2026, 12, 21, "Dallas",      "07:25", "17:26"],
  [2026, 6, 21,  "Saarbrücken", "05:27", "21:41"],
  [2026, 12, 21, "Saarbrücken", "08:24", "16:36"],
  [2026, 6, 21,  "Sendai",      "04:13", "19:03"],
  [2026, 12, 21, "Sendai",      "06:49", "16:20"]
];

const TOLERANCE_MIN = 3;

// Minutes since local midnight of a UTC instant in a zone, with seconds
function localMinutes(date, tz) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz, hourCycle: "h23", hour: "numeric", minute: "numeric", second: "numeric"
  }).formatToParts(date);
  const get = (t) => parseInt(parts.find((p) => p.type === t).value, 10) || 0;
  return (get("hour") % 24) * 60 + get("minute") + get("second") / 60;
}
function hhmmToMinutes(s) {
  const [h, m] = s.split(":").map(Number);
  return h * 60 + m;
}
function fmt(min) {
  const h = Math.floor(min / 60), m = Math.floor(min % 60), s = Math.round((min % 1) * 60);
  return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
}

let failures = 0;
console.log("date        city          event    computed  published  diff");
for (const [y, m, d, name, riseRef, setRef] of REFERENCE) {
  const c = CITIES[name];
  const ev = Solar.solarEvents(y, m, d, c.lat, c.lon);
  for (const [label, date, ref] of [["sunrise", ev.sunrise, riseRef], ["sunset", ev.sunset, setRef]]) {
    assert.ok(date instanceof Date, `${name} ${label} should be a Date`);
    const got = localMinutes(date, c.tz);
    const want = hhmmToMinutes(ref);
    const diff = got - want;
    const ok = Math.abs(diff) <= TOLERANCE_MIN;
    if (!ok) failures++;
    const dateStr = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    console.log(
      `${dateStr}  ${name.padEnd(12)}  ${label.padEnd(8)} ${fmt(got)}  ${ref}      ${diff >= 0 ? "+" : ""}${diff.toFixed(1)} min ${ok ? "" : " FAIL"}`
    );
  }
}

// Polar edge cases: no exception, no NaN, sensible flags.
const polarDay = Solar.solarEvents(2026, 6, 21, 80, 0);
assert.strictEqual(polarDay.polar, "day");
assert.strictEqual(polarDay.sunrise, null);
assert.strictEqual(polarDay.dayLengthMinutes, 1440);
const polarNight = Solar.solarEvents(2026, 12, 21, 80, 0);
assert.strictEqual(polarNight.polar, "night");
assert.strictEqual(polarNight.dayLengthMinutes, 0);
const pole = Solar.solarEvents(2026, 3, 20, 90, 0);
assert.ok(pole.polar === "day" || pole.polar === "night");
assert.ok(Number.isFinite(Solar.altitude(new Date(), 90, 0)));
console.log("polar cases: ok");

if (failures) {
  console.error(`${failures} value(s) outside ${TOLERANCE_MIN} minutes`);
  process.exit(1);
}
console.log(`all values within ${TOLERANCE_MIN} minutes`);
