# The toy kit

The toys under `misc/` used to write the same page chrome and data loading by hand, and the copies drifted. A new toy loads this kit instead and gets the header, the back link, the theme, the help dialog, the footer, `?thumb=1`, reduced motion, a seeded random generator, namespaced storage, the library and blog loaders, a CDN script loader with a failure panel, and one shared AudioContext. The toys built before the kit do not use it and stay as they are.

| File | What it is |
| --- | --- |
| `kit.css` | The site's colour tokens, a body reset and the styles of everything the kit builds. |
| `kit.js` | `window.ToyKit`. Runs in `<head>`, before first paint. |
| `library.js` | The one copy of the bookshelf tables and helpers. `ToyKit.library()` loads it; a toy never needs a script tag for it. |
| `template/` | A small complete toy built on the kit (everything except the blog and CDN loaders). Copy it to start. |
| `test.js` | `node misc/_kit/test.js`: tests of the parts that run without a browser. |
| `../../scripts/check-tables.mjs` | `node scripts/check-tables.mjs`: fails when `library.js` differs from `assets/js/bookshelf.js`. |

## Start a new toy

1. Copy `misc/_kit/template/` to `misc/NN-name/` (`index.html`, `app.js`, `toy.json`).
2. In `index.html`, change the two kit paths from `../../_kit/` to `../_kit/`. The template sits one folder deeper than a toy does, so this is the one edit a copy always needs.
3. Fill in `toy.json` (its `slug` is the folder name), the `<title>`, the description and the `ToyKit.init({...})` call (its `id` is the slug too), then replace the drawing in `app.js`. The lines marked `KIT` are the ones to keep.
4. Check it: `node misc/_kit/test.js`, then the smoke test, `node scripts/qa/smoke.mjs --path misc/NN-name`.

## The page

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Toy Name</title>
<meta name="description" content="One or two sentences about what the toy does.">
<link rel="icon" href="data:,">
<link rel="stylesheet" href="../_kit/kit.css"><script src="../_kit/kit.js"></script>
<style>/* the toy's own styles, using the tokens */</style>
</head>
<body>
<main class="kit-main">
	<canvas id="stage" role="img" aria-label="What the picture shows"></canvas>
</main>
<footer class="kit-footer"><p><b>How it works.</b> A plain paragraph.</p></footer>
<template id="help-template"><p>What the help dialog says.</p></template>
<script src="app.js"></script>
</body>
</html>
```

The stylesheet and the script stay together, in that order, in the `<head>`. `kit.js` is not `defer` or `async`: it has to run before first paint. By the time the next tag is parsed it has set `<html data-theme="light|dark">` (from `?theme=`, then `localStorage.theme`, then the OS), added the class `is-thumb` under `?thumb=1` and `is-reduced` when motion should be reduced, and set `window.__toyReady = false`.

`ToyKit.init()` builds the header at the top of `<body>`: `header.kit-header` holding the `h1`, `.kit-sub`, a spacer, and `.kit-tools` with `button.kit-theme`, `button.kit-help` and `a.kit-back`. If the page already has a `<header class="kit-header">`, its own `<h1>` and `.kit-sub` are kept and anything else in it (a search box, a select) ends up in front of the kit's buttons.

## API

```js
ToyKit.init({ id: 'name', title: 'Toy Name', sub: 'One line.', back: 'misc', help: '#help-template', footer: null });
```

`id` names the toy's storage keys; use the toy's slug, which is its folder name (and the default when `id` is left out). `back` is `'misc'` ("← Jack V. Le", to `#/misc`) or `'bookshelf'` ("← Bookshelf", to `#/bookshelf`, for views of the library). `help` is the selector of a `<template>` (or `null` for no help button). `footer` is the selector of an element to style as the footer, or of a `<template>` to make one from; a `<footer class="kit-footer">` in the page needs no option. Calling `init` again changes what it built; it never builds a second header.

| Call | One-line example |
| --- | --- |
| `ToyKit.root` | `fetch(ToyKit.root + 'assets/data/ja.json')`: the site root as an absolute URL, whatever folder the page is in. |
| `ToyKit.thumb` | `var seed = ToyKit.thumb ? 'thumb' : ToyKit.daily();` |
| `ToyKit.params` | `var seed = ToyKit.params.get('seed');` (a `URLSearchParams`). |
| `ToyKit.reducedMotion` | `if (!ToyKit.reducedMotion) startLoop();` Read it each time: it is live, and always `true` under `?thumb=1`. |
| `ToyKit.onMotion(fn)` | `ToyKit.onMotion(function (reduced) { if (reduced) stopLoop(); });` Called now and on every change. Returns a function that unsubscribes. |
| `ToyKit.theme()` | `var dark = ToyKit.theme() === 'dark';` |
| `ToyKit.onTheme(fn)` | `ToyKit.onTheme(function (theme) { readColours(); draw(); });` Called on changes only (the toggle, another tab, the OS). Returns a function that unsubscribes. |
| `ToyKit.setTheme(t)` | `ToyKit.setTheme('dark');` Writes `localStorage.theme`, the site's own key. The header's toggle already does this. |
| `ToyKit.token(name)` | `ctx.fillStyle = ToyKit.token('--accent');` The value of a CSS token right now, for canvas drawing. |
| `ToyKit.hash(str)` | `var h = ToyKit.hash(book.id);` FNV-1a, an unsigned 32-bit integer. |
| `ToyKit.rng(seed)` | `var r = ToyKit.rng('2026-10-03'); r(); r.int(6); r.pick(list); r.shuffle(list);` mulberry32. `r()` is in [0, 1); `shuffle` returns a copy. |
| `ToyKit.daily(opts)` | `ToyKit.daily()` is `'2026-10-03'` in local time; `ToyKit.daily({ utc: true })` in UTC. Under `?thumb=1` it is a fixed day. |
| `ToyKit.store(key, value)` | `ToyKit.store('speed', 3);` JSON under `toy.<id>.speed`. `null` removes the key. Returns `false` if storage refused. |
| `ToyKit.load(key, fallback)` | `var speed = ToyKit.load('speed', 1);` |
| `ToyKit.library()` | `ToyKit.library().then(function (lib) { draw(lib.books); });` See below. |
| `ToyKit.posts()` | `ToyKit.posts().then(function (list) { list[0].slug; });` The entries of `blog/index.json`: `{ slug, title, date, summary, tags, file }`. |
| `ToyKit.post(slug)` | `ToyKit.post('latentland').then(function (p) { p.meta.title; p.markdown; p.text; });` See below. |
| `ToyKit.loadScript(url, opts)` | `ToyKit.loadScript('https://cdn.jsdelivr.net/npm/d3@7.9.0/dist/d3.min.js', { global: 'd3' }).then(useD3, fallBack);` |
| `ToyKit.fail(message, opts)` | `ToyKit.fail('The map could not be loaded, so this page shows the list.', { detail: err.detail });` or `ToyKit.fail(err)`. |
| `ToyKit.audio()` | `button.onclick = function () { ToyKit.audio().then(function (ctx) { if (ctx) beep(ctx); }); };` |
| `ToyKit.help.open()` / `.close()` | `ToyKit.help.open();` The help button already does this. |
| `ToyKit.toast(text)` | `ToyKit.toast('Copied.');` A short message, read out politely by screen readers. |
| `ToyKit.download(name, data, mime)` | `ToyKit.download('shelf.svg', svgText, 'image/svg+xml');` `data` is a string or a `Blob`. |
| `ToyKit.ready()` | `draw(); ToyKit.ready();` Sets `window.__toyReady = true`. Call it once the first real frame is drawn. |

Also there: `ToyKit.id` (the storage id), `ToyKit.frontMatter(text)` and `ToyKit.markdownToText(markdown)` (what `post()` uses, for text a reader pastes in).

**The library.** `ToyKit.library()` resolves with `{ books, objects, byId, generated, counts }` plus the bookshelf's tables (`UNITS`, `GENRE_HUE`, `LANG_HUE`, `LANG_NAME`, `AUTHOR_ALIAS`, `FREE_SOURCE`, `UNIT_BY_KEY`) and helpers (`authorKey(a)`, `langName(code)`, `langBucket(code)`, `eraLabel(y)`, `eraRank(label)`, `yearText(y)`, `unitName(k)`, `shelfLabel(key)`, `shelves()`, `spineColor(record, mode)`, `hsl(record, shift)`). A record has `id, u, s, p, t, a, pub, l, ty, g, st, y, yr, d`, sometimes `free { src, url, note }`, and the colour the bookshelf paints it with: `ch, cs, cl`, so `lib.hsl(book)` is its spine colour. The page makes one request however many times it calls; everyone gets the same object, so copy a list before sorting it (`lib.books.slice()`).

**A post.** `ToyKit.post(slug)` resolves with `meta` (the front matter and the index entry), `markdown` (the body, without the front matter and without HTML comments) and `text` (plain prose: no markup, no code blocks, one paragraph or list item per line). Text inside an HTML comment is text the author took out; it is in neither. A slug that is not in `blog/index.json` rejects, so a toy cannot reach an unpublished post or a draft. Always go through `posts()` and `post()`; never build a `blog/posts/...` URL yourself.

**Failures.** `library()`, `posts()`, `post()` and `loadScript()` reject with an `Error` whose `message` is a sentence a reader can be shown and whose `detail` is the technical part, so `.catch(function (err) { ToyKit.fail(err); ToyKit.ready(); })` is the whole failure path. `fail()` shows the `.kit-fail` panel under the header; it does not stop the page.

**Sound.** `ToyKit.audio()` resolves with the page's one `AudioContext`, running (it resumes a suspended one). It never builds one before the reader has clicked, tapped or pressed a key: called earlier, it waits for that first gesture. It resolves `null` under `?thumb=1` and where there is no Web Audio. Do not call `new AudioContext()` yourself and do not close the shared one.

## kit.css

Tokens, light on `:root` and dark on `:root[data-theme="dark"]`, with the site's names and values: `--bg --surface --surface-2 --text --text-2 --heading --border --border-strong --accent --accent-soft --accent-ring --shadow --font-body --font-mono --ease-out --dur-fast --dur --dur-slow`.

A toy's stylesheet comes after `kit.css` and may override any of them: light values on `:root`, dark values on `:root[data-theme="dark"]`. In the dark theme the kit's dark values win over anything set on plain `:root`, so write the dark half of a palette too; a token left out of it keeps the kit's dark value. A toy with one palette for both themes puts it on both selectors at once (`:root, :root[data-theme="dark"] { ... }`), adds `color-scheme`, and hides the toggle with `.kit-theme { display: none; }`. No fonts are loaded: the stack is Inter if installed, then the system font. A toy may add its own Google Fonts link.

Classes for the toy's own markup: `.kit-main` (the part between header and footer; it fills the space left), `.kit-pad` (the standard padding), `.kit-row` (a wrapping row of controls), `.kit-btn` (add `primary`, `small`, `on`; `aria-pressed="true"` also shows as on), `.kit-chip`, `.kit-input`, `.kit-note` (small muted text), `.kit-sr` (for screen readers only), `.kit-nothumb` (hidden under `?thumb=1`), `.kit-footer`. Built by the kit: `.kit-header`, `.kit-sub`, `.kit-theme`, `.kit-help`, `.kit-back`, `.kit-dialog` inside `.kit-backdrop`, `.kit-fail`, `.kit-toast`.

On `<html>`: `data-theme`, the classes `is-thumb` and `is-reduced`, and `data-toy`, `data-toy-ready`, `data-toy-failed`.

## The thumbnail protocol

`?thumb=1` must show one fixed, good-looking state, the same pixels on every load. The thumbnail is taken from that URL at the size given in `toy.json` (800 by 500), once `window.__toyReady === true` and `settleMs` more have passed.

- The kit hides the header, the footer, the help button, toasts and anything with class `kit-nothumb`. Make the toy fill the frame.
- Use a fixed seed: `ToyKit.thumb ? 'thumb' : ...`. Read nothing from storage, the clock, the network (other than the site's own data) or `Math.random()`.
- Do not depend on animation frames. Draw the finished state in the same task that has the data, then call `ToyKit.ready()`. `ToyKit.reducedMotion` is `true` under thumb, so the reduced-motion path is the thumbnail path.
- A simulation runs a fixed number of steps in a plain loop, then draws once.
- WebGL: run the N steps synchronously, then copy the GL canvas onto a 2D canvas (`ctx2d.drawImage(glCanvas, 0, 0)`) in the same task as the last draw, and show the 2D canvas. A GL drawing buffer is cleared once the frame has been presented, so a screenshot taken later can find it empty; the 2D copy keeps the pixels. Where there is no GL context at all, fall back to a pure-JavaScript reference that draws the same state. Only then call `ToyKit.ready()`.
- No sound: `ToyKit.audio()` is `null`.

## The reduced-motion rule

When `ToyKit.reducedMotion` is true, nothing moves by itself: no autoplay, no idle loop, no entrance tween, no parallax. Draw the finished state at once and apply a change the reader asks for at once. Motion that is the point of the toy (a simulation, a game) starts only when the reader starts it, and can be stopped.

The kit already finishes every CSS animation and transition instantly (`html.is-reduced`, and the `prefers-reduced-motion` media query) and sets the duration tokens to `0ms`. Script is the toy's job: check `ToyKit.reducedMotion` before starting a loop, and use `ToyKit.onMotion` to stop one that is running when the setting changes. Three things turn it on: the OS setting, `?motion=reduce` (for testing), and `?thumb=1`.

## The CDN rule

- Only `cdn.jsdelivr.net` and `cdnjs.cloudflare.com`.
- Exact versions: `d3@7.9.0`, never `d3@7` or `@latest`.
- Loaded with `ToyKit.loadScript`, never with a `<script src>` tag in the HTML: a tag that fails cannot be caught, and it blocks the page while it waits.
- Always with a working fallback. If the script does not arrive, the toy still does its job in a simpler way, says so with `ToyKit.fail('plain words')`, and still calls `ToyKit.ready()`.
- `loadScript(url, { global: 'd3', integrity: 'sha384-...', timeoutMs: 8000 })` resolves with `window.d3` once it exists, and rejects on a network error, a timeout, a wrong hash, or a script that loaded without defining the global. It never throws.
- Any other host a toy talks to (an API, say) is listed under `"origins"` in its `toy.json`.

## Accessibility basics

- Keyboard: everything works without a pointer. Use real `<button>`, `<a>`, `<input>` and `<select>`. What can be done on a canvas with a pointer needs a keyboard way too (the template's arrow buttons).
- Focus is visible. The kit draws a ring on `:focus-visible`; do not remove outlines.
- Labels: every control has visible text or an `aria-label`; a toggle has `aria-pressed`; a canvas or SVG picture has `role="img"` and an `aria-label` that says what it shows.
- Results are announced: put text that changes because of what the reader did in an element with `aria-live="polite"`, or use `ToyKit.toast`.
- Colour: use the tokens for text (`--text` and `--text-2` on `--bg` and `--surface` have enough contrast in both themes), and never let colour alone carry a meaning.
- Escape closes whatever is open on top.

## The phone rule

- It works at 360 px wide: the header wraps, controls wrap, nothing scrolls sideways.
- Pointer Events (`pointerdown`, `pointermove`, `pointerup`) rather than mouse-only or touch-only events, and nothing that needs hover.
- `touch-action` on every canvas: `none` if the canvas handles drags or pinches itself, `manipulation` or `pan-y` if it only takes taps, so the page still scrolls.
- Size a canvas from its wrapper, not the other way round: give the wrapper its size in CSS, make the canvas fill it, and set `canvas.width` and `canvas.height` from the wrapper's `clientWidth` and `clientHeight` times `devicePixelRatio` (capped at 2). The template does this.
- Touch targets are at least 44 px: `.kit-btn` and the header buttons grow by themselves on touch screens.

## Other house rules

- Storage: only through `ToyKit.store` and `ToyKit.load` (keys `toy.<id>.<key>`). `theme` belongs to the site.
- Home is "Texas". A toy never names a city for the site's owner.
- Browser code is old-style, like `assets/js/*.js`: one IIFE, `'use strict'`, `var` and `function`, no modules, no build step, tabs.
- The bookshelf tables live in `assets/js/bookshelf.js`. When they change there, copy the change into `library.js` and run `node scripts/check-tables.mjs`; a toy never keeps its own copy.
