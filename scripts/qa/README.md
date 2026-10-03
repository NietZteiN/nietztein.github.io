# QA harness

Everything here runs on Node 24 built-ins and an installed Chrome (or Edge). There is no `package.json` and nothing to install. Every command starts its own server on a free port and its own headless browser, so any number of them can run at once.

| Command | What it does |
| --- | --- |
| `node scripts/serve.mjs` | Static server that behaves like GitHub Pages. Prints its URL. |
| `node scripts/qa/smoke.mjs <slug...>` | The gate: load toys in a browser, fail on errors. |
| `node scripts/qa/smoke.mjs --all` | The gate over every toy that is not `wip`. |
| `node scripts/qa/smoke.mjs --site` | Load the site shell on three routes, in light and dark. |
| `node scripts/qa/shot.mjs <slug...>` | Take 800x500 card thumbnails. |
| `node scripts/qa/shot.mjs --url <url> --out <file>` | Screenshot any page, for looking at. |
| `node scripts/qa/drive.mjs <script.mjs>` | Run a scripted interaction (click, type, assert). |
| `node scripts/test-all.mjs` | Every test in the repo, one table. `--smoke` adds the browser run. |
| `node scripts/qa/report.mjs` | Write `scripts/qa/out/report.html`, one row per toy. |
| `node scripts/qa/jpeg.mjs <file...>` | Print the pixel size and weight of JPEGs. |

Generated files go to `scripts/qa/out/` (gitignored). Give browser commands a generous timeout (ten minutes for `--all`): when more than four browsers are wanted at once, the extra ones wait their turn.

Building one toy, the loop is:

```
node scripts/qa/smoke.mjs 61-my-toy              must print PASS
node scripts/qa/shot.mjs 61-my-toy               writes assets/img/misc/61-my-toy.jpg
node scripts/qa/drive.mjs C:\scratch\check.mjs   optional: click through it
node scripts/test-all.mjs                        before handing over
```

Run the smoke test on your own toy by name. `--all` also loads everyone else's half-built work. Keep `"status": "wip"` in `toy.json` until the toy passes; `--all` skips `wip` toys.

Take thumbnails by name too, or with `--missing`. `shot.mjs --all` retakes every thumbnail in the repo and is for the integrator only.

## serve.mjs

```
node scripts/serve.mjs [--port N] [--quiet] [--root <dir>] [--mount <url path>=<dir>]
```

Prints exactly one line on stdout, `http://127.0.0.1:<port>/`. The default port is 0, meaning the OS picks a free one, so read the line. Requests are logged to stderr unless `--quiet`.

It differs from a naive static server where GitHub Pages does:

- Paths are case-exact. `/Misc/44-text-tartan/` is a 404 here as it is in production, although Windows would open the folder.
- A directory serves its `index.html`; a directory without the trailing slash redirects to it (301).
- Unknown paths serve `404.html` with status 404.
- Underscore folders (`misc/_kit/`) are served like any other.

It never serves `.git/`, `blog/drafts/`, any `*.xlsx`, or anything under `blog/` that git does not track. It binds 127.0.0.1 only and sends `Cache-Control: no-store`.

`--mount misc/99-probe=C:\scratch\probe` serves a folder from outside the repo under a URL path. That is how a test page is checked without ever putting it in the repo. `smoke.mjs`, `shot.mjs` and `drive.mjs` take the same option.

In-process: `import { startServer } from '../serve.mjs'`, then `const server = await startServer({ port: 0 })` gives `{ url, port, root, resolve(pathname), close() }`.

## smoke.mjs

```
node scripts/qa/smoke.mjs 44-text-tartan 18        named toys (a bare number works)
node scripts/qa/smoke.mjs --all                    every toy whose toy.json is not "wip"
node scripts/qa/smoke.mjs --path misc/_kit/template   any folder with an index.html
node scripts/qa/smoke.mjs --site                   the site shell
```

Flags: `--json`, `--update-baseline`, `--concurrency N` (pages in parallel inside the one browser, default 4), `--verbose`, `--mount`, `--root`. Exit code 0 when everything passed, 1 when something failed, 2 for a bad command line.

Each toy is loaded in fresh browser contexts:

| Pass | What is loaded |
| --- | --- |
| `default` | the page at 1280x800 |
| `thumb` | the thumbnail URL (`?thumb=1`) at the thumbnail viewport |
| `reduced-motion` | the page with `prefers-reduced-motion: reduce` |
| `mobile` (kit) | 390x844, mobile emulation; fails on horizontal overflow |
| `theme-dark`, `theme-light` (kit) | `localStorage.theme` seeded, the OS preference set to the opposite |
| `cdn-blocked` (kit) | `cdn.jsdelivr.net` and `cdnjs.cloudflare.com` blocked |

A toy fails on:

- an uncaught exception or unhandled promise rejection;
- a `console.error` (or a browser-level error such as a CSP violation);
- a local file that answers 400 or more, or fails to load (`/favicon.ico` is ignored);
- a request to a host outside the allowlist (the local server, `cdn.jsdelivr.net`, `cdnjs.cloudflare.com`, `fonts.googleapis.com`, `fonts.gstatic.com`, plus the toy's `origins`);
- `window.__toyReady` being defined and not becoming `true` within 20 s.

Kit toys (`"kit": true`) are also checked for: `window.__toyReady` being defined at all; `a.kit-back` existing and resolving to the site root with `#/misc` or `#/bookshelf`; `<html data-theme>` following `localStorage.theme`; `button.kit-help`, if present, opening `.kit-dialog` and Escape closing it; `<html class="is-thumb">` under the thumbnail URL; and the blocked-CDN pass, which must throw nothing uncaught (console errors are tolerated there) and still reach `__toyReady === true` or show `.kit-fail`.

If a toy fails in a run where an outside host it is allowed to use did not answer (a CDN hiccup), or by timing out, it is run once more and the second result counts. The line then says `retried`.

A page that hangs (no load event within 30 s, or `__toyReady` stuck at `false` for 20 s) fails after its first pass; the remaining passes are skipped, because they would only hang again. With the one retry, a toy that really hangs costs about a minute.

Output is one line per toy as it finishes, details under a failure, and a summary:

```
PASS 44-text-tartan 5168 ms
FAIL misc/99-broken 4734 ms
     exception: Uncaught Error: deliberate failure on load  (/misc/99-broken/:16)  [default, thumb, reduced-motion]
     host: example.com  (https://example.com/x.js)  [default, thumb, reduced-motion]
     request: HTTP 404 /misc/99-broken/does-not-exist.js  [default, thumb, reduced-motion]
2 toys: 1 passed, 1 failed in 9.9 s
```

`--json` prints one document instead: `{ ok, startedAt, ms, browser, counts, toys: [{ slug, path, kit, ok, ms, passes, failures, tolerated, warnings, hosts, retried? }], site }`. `--all` also writes it to `scripts/qa/out/smoke-last.json`.

### The baseline

Toys that predate the kit (no `toy.json`, or `"kit": false`) have known noise. `node scripts/qa/smoke.mjs --all --update-baseline` records, per toy, the set of normalised error messages and outside hosts into `scripts/qa/baseline.json`. From then on such a toy fails only on something that is not in its entry. Kit toys never get an entry; neither do `--path` targets, and it cannot be combined with `--root`.

Only what a page logs can be baselined: exceptions, console errors, failed local requests and outside hosts. A page that hangs or does not load fails regardless, and its entry is left as it was. Messages are compared after removing the server's address and any run of six or more digits (timestamps), so the same error matches from run to run. With toy names instead of `--all`, only those toys' entries are replaced.

Updating the baseline hides whatever is wrong at that moment, so it is the integrator's call, not a way to make a red toy green.

### --site

Loads `index.html` at `#/about`, `#/misc` and `#/bookshelf`, each in light and dark, and writes `scripts/qa/out/site-<route>-<theme>.png`. It fails on an uncaught exception, on a local file that is missing, and on a card whose page or thumbnail does not exist on disk with that exact spelling. It reports the count of `#miscContent .misc-card[href]` and `#bs-views .misc-card[href]`. `api.open-meteo.com`, `api.github.com`, `avatars.githubusercontent.com`, `github.com` and `giscus.app` are allowed here, and their failures are not errors.

## shot.mjs

Thumbnails:

```
node scripts/qa/shot.mjs 44-text-tartan            retake (overwrites assets/img/misc/44-text-tartan.jpg)
node scripts/qa/shot.mjs --missing                 only toys with no thumbnail yet
node scripts/qa/shot.mjs --all                     retake all
node scripts/qa/shot.mjs 44 --out C:\scratch\t.jpg   write somewhere else (a .jpg file, or a folder)
```

The toy is loaded at its thumbnail URL in its thumbnail viewport at device pixel ratio 1, waited for (the ready contract, then `settleMs`), and captured as JPEG quality 82. The result must be exactly 800x500 and between 6 KB and 150 KB. Over 150 KB the quality drops step by step (74, 66, 58, 50, 42, 34) before giving up; under 6 KB the page is taken for blank. A capture that fails is not written, and the exit code is 1.

An existing thumbnail is replaced only when its toy is named or `--all` is given. `--all` and `--missing` skip `wip` toys; `--all` also skips the old hand-made thumbnails (`thumb.legacy`).

The default viewport is 800x500, which lays a page out narrower than the 1280x800 the older thumbnails were taken at. A toy that looks cramped there can ask for a larger 16:10 viewport in `toy.json` (`"viewport": [1600, 1000]`, or `[1280, 800]`); the capture is scaled down to 800x500.

Any page:

```
node scripts/qa/shot.mjs --url "index.html#/misc" --out misc-dark.png --theme dark
node scripts/qa/shot.mjs --url "misc/44-text-tartan/?x=1" --out t.jpg --width 1600 --height 1000 --wait 1500
```

Options: `--width 1280 --height 800 --theme dark|light --full-page --wait <ms> --mobile --reduced-motion --dpr N --quality N`. The URL is relative to the site root. PNG or JPEG by file extension. Uncaught exceptions on the page are reported on stderr but do not stop the capture.

## drive.mjs

```
node scripts/qa/drive.mjs [--mount ...] [--root ...] [--timeout <seconds>] <script.mjs> [args...]
```

Starts the server and a browser, imports the script, calls its default export, and cleans up. Keep such scripts in a scratch folder, not in the repo.

```js
export default async function ({ browser, baseUrl, newPage, args, assert, outDir }) {
	const page = await newPage({ width: 1280, height: 800, theme: 'dark' });
	await page.goto(baseUrl + 'misc/44-text-tartan/');
	await page.click('#btn-drawer');
	await page.type('textarea', 'Hello');
	await page.screenshot(outDir + '/tartan-drawer.png');
	assert.equal(await page.eval(() => document.title), 'Text Tartan');
	assert.deepEqual(page.errors, []);
	assert.deepEqual(page.badRequests, []);
}
```

Throwing fails the run: the error and its stack are printed together with what every open page logged, and the exit code is 1. A forgotten `await` that rejects later fails the run too. The default time limit is 300 s.

## test-all.mjs

```
node scripts/test-all.mjs [--smoke] [--site]
```

Runs, in order, each as a child process: `scripts/build-cards.mjs --check`, `scripts/test-cards.mjs`, `scripts/check-tables.mjs`, `misc/_kit/test.js`, `misc/55-paper-theatre/test.js`, then every other `misc/*/test.js`, `misc/_*/test*.js` and `scripts/**/test*.mjs`. Then it checks that every `misc/*/toy.json` parses and that its `slug` is its folder name. A file that does not exist is reported as `skipped: not present`. It prints a table and exits 1 on any failure. `--smoke` adds `smoke.mjs --all`; `--site` adds the site check.

## The page API (cdp.mjs)

```js
import { launch } from './cdp.mjs';

const browser = await launch();          // waits for a free browser slot
const page = await browser.newPage({
	width: 1280, height: 800, deviceScaleFactor: 1, mobile: false,
	theme: 'dark',            // 'dark' | 'light' | null
	colorScheme: null,        // override prefers-color-scheme alone
	reducedMotion: false,
	storage: { key: 'value' },
	blockHosts: [],
	extraAllowedHosts: [],
});
await page.goto(url, { waitReady: true, settleMs: 800, timeoutMs: 30000 });
```

Every page is its own browser context (own storage, cookies and cache) in its own window, so pages do not throttle each other.

`theme` seeds `localStorage.theme` and sets `prefers-color-scheme` to match. With `theme: null` nothing is seeded and the page sees the operating system's preference (dark on the machine this was built on). `storage` is seeded into `localStorage` before any page script runs, and only where the key is not already set, so a value the page stores survives a reload. `blockHosts` makes requests to those hosts fail. The analytics hosts (`googletagmanager.com`, `google-analytics.com`, `gc.zgo.at`, `goatcounter.com` and their subdomains) are always blocked.

`goto` waits for the load event, then (with `waitReady`) for 500 ms without network activity, for `document.fonts.ready`, for the `__toyReady` contract, and finally `settleMs`. It throws if the page does not load (`err.code === 'LOAD_TIMEOUT'`) or if `__toyReady` is defined and still not `true` after 20 s (`err.code === 'TOY_NOT_READY'`). A `goto` to the URL the page is already on, `#fragment` included, does not reload the document (that is how browsers treat it): the site's hash routes change in place. Use `page.reload()` for a fresh document; it takes the same options and waits the same way.

| Call | Notes |
| --- | --- |
| `page.reload({ waitReady, settleMs, timeoutMs })` | A fresh document at the same URL; `localStorage` survives. |
| `page.eval(expressionOrFunction, ...args)` | Returns a JSON-serialisable value; awaits promises. Functions are sent as source, so they cannot close over Node variables: pass values as `args`. An exception in the page is thrown to the caller and is not added to `page.errors`. Runs with a user gesture. |
| `page.click(selector)` | Scrolls the first match into view and clicks its centre with a real mouse event. `{ button, clickCount }`. |
| `page.clickAt(x, y)` | Same at viewport coordinates. `clickCount: 2` is a double click, `button: 'right'` a context click. |
| `page.type(selector, text)` | Focuses the match (`null` keeps the focus) and presses key after key. |
| `page.key('Escape')` | Named keys, single characters, and chords: `'Shift+Tab'`, `'Control+a'`. |
| `page.drag(x1, y1, x2, y2, { steps })` | Press, move in steps, release. |
| `page.wheel(x, y, deltaY, deltaX)` | Mouse wheel; waits until the page has seen the event. |
| `page.moveTo(x, y)`, `page.tapAt(x, y)` | Hover; touch tap. |
| `page.waitFor(selectorOrFunction, { timeoutMs, visible, hidden, args })` | Resolves with the truthy value; throws on timeout (default 10 s). |
| `page.isVisible(selector)` | Rendered, not `display: none`, not `visibility: hidden`, not fully transparent. |
| `page.waitNetworkIdle({ idleMs, timeoutMs })` | `true` once quiet, `false` on timeout. |
| `page.waitToyReady({ timeoutMs })` | The ready contract alone. |
| `page.setViewport({ width, height, deviceScaleFactor, mobile })` | Resize without reloading. |
| `page.screenshot(file, { format, quality, clip, fullPage })` | `format` defaults to the file extension. `clip` is `{ x, y, width, height, scale }`. Returns the image as a Buffer; `file` may be `null`. |
| `page.close()`, `browser.close()` | `browser.close()` never throws and may be called twice. |

What a page recorded:

- `page.errors`: `[{ type: 'exception' | 'console.error' | 'log.error', text, url, line }]`. `log.error` entries are the browser's own (failed resources, CSP) and carry a `source`; errors from a worker or iframe carry `target`. A missing local file therefore shows up here and in `badRequests`. Left out: what the harness blocked, and the browser's own `/favicon.ico` probe.
- `page.requests`: `[{ url, host, status, failed, resourceType, method, errorText, canceled, blocked }]`. `status` is 0 when there was no answer. `data:` URLs are not recorded.
- `page.badRequests`: the subset that should not have happened, each with a `reason`: local requests that answered 400 or more or failed (canceled ones and `/favicon.ico` excepted), and requests to hosts outside the allowlist.
- `page.externalHosts`: every other host contacted, sorted. Requests the harness blocked are not counted; they are in `page.requests` with `blocked: true`.
- `page.dialogs`: `alert`, `confirm` and `prompt` calls. They are accepted at once so they cannot hang a run.
- `page.downloads`: `[{ url, filename, path, state, bytes }]`. Downloads land in the throwaway profile and vanish with it.
- `page.warnings`, `page.ready` (`{ contract, ms }`).

`withBrowser(async (browser) => { ... })` launches, runs and always closes.

### How the browser is run

- Chrome, else Edge; `QA_BROWSER` overrides with a full path.
- Headless (`--headless=new`) over `--remote-debugging-pipe`: no port to collide on, and the browser exits by itself when the node process dies, even when it is killed outright.
- A fresh `--user-data-dir` per launch under `<tmp>/nietztein-qa/`, deleted on close. Chrome 136 and later ignore the debugging switches on the default profile.
- At most `QA_MAX_BROWSERS` (default 4) browsers at once across all node processes on the machine. Each holds a lock file `<tmp>/nietztein-qa/browser-N.lock` with its PID. A lock whose process is gone, or which has not been refreshed for two minutes, is taken over. Waiters poll; after 20 s they say so on stderr, after 15 minutes they give up.
- The browser is killed and its profile removed on normal exit, on an uncaught error and on Ctrl+C. When node itself is killed outright (a tool timeout), the browser exits on its own and the next launch, from any process, clears the stale lock and profile.
- Never stop `chrome.exe` or `node.exe` by name to clean up: other runs are using them. There is nothing to clean up by hand.

Environment: `QA_BROWSER`, `QA_MAX_BROWSERS`, `QA_HEADFUL=1` (show the window), `QA_DEBUG=1` (pass the browser's stderr through), `QA_LOCK_TIMEOUT_MS`.

## Contracts

`misc/<NN-slug>/toy.json`, the fields this harness reads:

| Field | Meaning |
| --- | --- |
| `slug` | The folder name. `test-all.mjs` checks that it matches. |
| `status` | `"live"` or `"wip"`. `--all` and `--missing` skip `wip`. |
| `kit` | `true` turns on the kit checks and turns off the baseline. |
| `origins` | Extra hostnames this toy may contact (`"api.github.com"`; `"*.example.org"` for subdomains). |
| `thumb.query` | Default `"?thumb=1"`. |
| `thumb.viewport` | Default `[800, 500]`. Must be 16:10. |
| `thumb.settleMs` | Default 800. |
| `thumb.legacy` | An old hand-made thumbnail that is not 800x500. |

Ready: a kit toy sets `window.__toyReady = false` while loading and `true` once its first meaningful frame is drawn. A page that never defines it is an old toy and is given load, network idle and a settle time instead.

Kit markup: `a.kit-back` (href ends in `#/misc` or `#/bookshelf`), optional `button.kit-help` opening `.kit-dialog` (Escape closes it), `.kit-fail` when a CDN script cannot load, `<html data-theme="light|dark">` following `localStorage.theme`, `<html class="is-thumb">` under `?thumb=1`.

## What this headless setup can do

Measured on 2026-10-03 with Chrome 154 on the machine this was built on:

- **WebGL**: `getContext('webgl2')` and `getContext('webgl')` both return a context, on the real GPU through ANGLE/Direct3D 11. `--enable-unsafe-swiftshader` is the software fallback for a machine without one. `navigator.gpu` exists too.
- **Web Audio**: `new OfflineAudioContext(1, 44100, 44100)` renders (one second in about 3 ms) and the samples are right. A live `AudioContext` created at load is `suspended`, as for a real visitor, and runs after `page.click()`; `--mute-audio` only silences it.
- **requestAnimationFrame**: full rate, about 120 frames a second (the display's rate), on one page and on four at once, also while the harness is only waiting. Timers are not throttled. A toy that advances a fixed step per frame runs twice as fast here as at 60 Hz.

## Pitfalls met while building this

- **A `fetch()` whose body is never read never finishes.** Chrome sends no `Network.loadingFinished` for it, so "no request in flight" would wait forever. Idle here means: every request has been answered and no bytes have arrived for 500 ms.
- **A worker's script is announced on the page and answered on the worker.** Requests are matched by request id alone, across sessions.
- **A 404 script or stylesheet shows up as canceled.** Chrome answers 404 and then aborts the body (`net::ERR_ABORTED`). The status is checked before a cancel is forgiven.
- **Under mobile emulation `window.innerWidth` grows to fit an overflowing page.** `scrollWidth > innerWidth` is then never true. The overflow check compares against `documentElement.clientWidth`.
- **A wheel event arrives after the protocol call returns.** `page.wheel()` waits for it. Mouse and key events are delivered before their call returns.
- **`fs.rm` with `maxRetries` did not get past a just-closed browser's locked profile.** The removal is retried by hand.
- **`Network.setBlockedURLs`: `urls` is deprecated, and `urlPatterns` wants the port spelled out.** `*://host/*` matches the default port only; `*://host:*/*` matches any. A glob in `urlPatterns` is a hard error. Both spellings are sent, and analytics is also blocked by a resolver rule.
- **`Input.insertText` goes to the text selection, not to the focused element.** Characters with no key on a US keyboard are typed that way.
- **`page.eval` counts as a user gesture.** Audio started from `eval` runs although a visitor would have to click first. Use `page.click()` when the gesture is what is being tested.
- **Bash heredocs on this machine strip backslashes from JavaScript.** Write scripts with an editor or the Write tool.
- **A Unicode escape written through an agent's Write tool can arrive as the character itself.** A byte-order-mark escape became an invisible character in the source. Build such characters with `String.fromCharCode`.
- **`goto` to the same `#fragment` URL does not reload**, and a 404 for `/favicon.ico` is the browser asking on its own (a page without `<link rel="icon">`), not the page.
- **Run node with forward slashes or quoted paths from Git Bash**, and prefer absolute paths for `--out` and `--mount`.

## Limits

- `page.click()` and friends use `document.querySelector`: no shadow DOM, no elements inside iframes.
- A popup opened by the page (`window.open`, `target="_blank"`) is not followed; its requests and errors are not recorded.
- `fullPage` captures are bounded by the GPU's largest texture (16384 px here).
- The semaphore limits load; it is not a lock. A lost race lets one extra browser run.
- Smoke only loads pages. It does not click anything except the kit's help button. Interaction is what `drive.mjs` is for.
- Smoke cannot tell a blank canvas from a drawn one. The 6 KB floor on a thumbnail is the only check of that kind; look at the picture.
- A toy's "copy" button writes to the real clipboard of the machine, headless or not.
- The first tab of the browser (`about:blank`) is never used; every page lives in its own context.
