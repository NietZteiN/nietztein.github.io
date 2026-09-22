# Three-city daylight clock

A single page that shows Dallas, Saarbrücken and Sendai side by side: the local time (ticking every second), the local date, sunrise, sunset and day length, and a horizon strip that draws the sun's altitude across the 24 hours of the local day, with daylight in a warm tone, civil twilight in a cooler tone and night dark. A thin strip underneath places all three cities on one UTC axis so the overlap of waking hours is easy to see. Everything is computed in the browser from latitude, longitude and the NOAA solar equations. Time zones come from the browser's built in Intl data. No network, no libraries.

## How to run

Open the page directly:

    xdg-open index.html        # or double-click it

Or serve the repository and visit the folder:

    cd /home/user/side-projects
    python3 -m http.server 8000
    # then open http://localhost:8000/15-daylight-clock/

Self-check of the solar equations (Node 22, no packages):

    node test.js

Test mode in the browser: add `?test=1` to the URL. A panel at the bottom prints computed civil dawn, sunrise, solar noon, sunset, civil dusk and day length for 21 June 2026 and 21 December 2026 in each city's local time. The same rows are logged to the console as JSON.

Browser check with Playwright (optional, needs `pip install playwright` and a Chromium build):

    python3 verify.py
    # if Playwright's own Chromium is not installed:
    CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome python3 verify.py

## Settings

Two toggles in the header, remembered per browser:

- 24 hour time (default on). Off gives 12 hour time with am and pm.
- Show solar noon. Adds a fourth value next to sunrise, sunset and day length.

Each column changes tint with the local phase: night (blue), dawn (rose), day (amber) and dusk (copper). Backgrounds stay dark so the page can sit on a second monitor.

## Adding a city

Edit the `CONFIG.cities` array near the top of the script in `index.html`:

    { name: "Hanoi", lat: 21.0285, lon: 105.8542, tz: "Asia/Ho_Chi_Minh" }

Longitude is east positive. `tz` is an IANA time zone name. The grid adds a column (or a row on narrow screens) and the UTC strip adds a row. `CONFIG.wakingHours` sets the local hours drawn as the "waking hours" line on the UTC strip (default 8 to 22).

## Accuracy check

Computed with `solar.js` (NOAA equations, sunrise and sunset at an altitude of -0.833 degrees) against values as published in timeanddate style tables for the same dates. Local time, hh:mm.

| Date       | City        | Sunrise (computed) | Sunrise (published) | Sunset (computed) | Sunset (published) |
|------------|-------------|--------------------|---------------------|-------------------|--------------------|
| 2026-06-21 | Dallas      | 06:19:39           | 06:20               | 20:38:28          | 20:39              |
| 2026-12-21 | Dallas      | 07:25:38           | 07:25               | 17:25:09          | 17:26              |
| 2026-06-21 | Saarbrücken | 05:26:30           | 05:27               | 21:41:09          | 21:41              |
| 2026-12-21 | Saarbrücken | 08:24:21           | 08:24               | 16:35:47          | 16:36              |
| 2026-06-21 | Sendai      | 04:13:15           | 04:13               | 19:03:15          | 19:03              |
| 2026-12-21 | Sendai      | 06:49:22           | 06:49               | 16:19:25          | 16:20              |

All differences are under one minute. `node test.js` asserts each value within 3 minutes and also checks that polar day and polar night at 80 degrees north return `null` events with a `polar` flag instead of failing. Published tables round to the minute and use a slightly different city reference point, so agreement within a minute or two is the expected level.

## File layout

    index.html      the page: layout, styles, clocks, horizon strips, UTC strip, settings, test mode
    solar.js        NOAA solar calculator (Julian day, mean longitude and anomaly, equation of
                    centre, obliquity, equation of time, declination, hour angles) plus a sun
                    altitude function; loaded by the page and required by test.js
    test.js         node test.js: asserts sunrise and sunset against the reference table
    verify.py       Playwright check from file:// (console errors, ticking clocks, arcs, layout)
    screenshot.png  page as rendered by verify.py

## Assumptions

- The brief asked for a single HTML file and also for the solar function to be extracted into `solar.js` so Node can test it. The page is `index.html` plus `solar.js` in the same folder, loaded with a relative `<script src>`; there are no other dependencies. The two files can be merged by pasting `solar.js` into a `<script>` tag if a single file is ever needed.
- City coordinates are the ones given in the brief (city centres). Published sunrise tables may use a slightly different reference point, which is one reason for sub-minute differences.
- Civil twilight (-6 degrees) is the only twilight drawn. Nautical and astronomical twilight were left out to keep the strips calm.
- "Waking hours" on the UTC strip are 08:00 to 22:00 local. Change `CONFIG.wakingHours` if a different window is more useful.
- Time zone abbreviations vary by browser and language (CDT in one, GMT-5 in another), so each column shows the current UTC offset instead.
- The reference values in the accuracy table are the commonly published minute-rounded values for these dates and places; if a different source is used, `test.js` has the table in one place and a 3 minute tolerance.

## Ideas for later

- Moon phase and moonrise as a second, fainter arc.
- A "meeting finder" that highlights the hours where all waking-hour windows overlap.
- Nautical and astronomical twilight bands as an option.
- A tiny "share as image" button that exports the page as a PNG for a status message.
