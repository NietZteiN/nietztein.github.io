# Builder brief

For an agent building one new toy (or one shared module) on this site, usually while a dozen other agents build theirs in the same working tree. Read this, then `misc/_kit/README.md` (the kit's API and page rules), then `scripts/qa/README.md` (the test harness). Your task message tells you the folder you own, the toy's number and slug, its group and what it must do.

## What you own

- Exactly the folder (or files) named in your task, plus the thumbnail `assets/img/misc/<slug>.jpg` that `shot.mjs` writes for you.
- Everything else is read-only: `index.html`, `assets/**`, `scripts/**`, `misc/_kit/**` and the other underscore folders, every other toy, `blog/**`.
- If the kit or the harness lacks something, work around it inside your folder and say so in your report. Do not patch shared files.
- No state-changing git command, ever: no add, commit, stash, checkout, restore, reset, clean, pull, push. Other agents have uncommitted work in this tree and one of those commands would destroy it. Read-only git (status, diff, log, show) is fine.
- Never run `scripts/build-cards.mjs` (without `--check`), `scripts/toys-extract.mjs`, `scripts/test-all.mjs`, `scripts/test-cards.mjs`, `smoke.mjs --all` or `shot.mjs --all`. They touch or judge files that belong to everyone; the integrator runs them.
- Never run `scripts/build-blog-index.mjs` or `scripts/build-library-json.ps1`.
- Stop only processes you started. Never stop `chrome.exe` or `node.exe` by name.
- Temporary files go in the scratch folder named in your task, not in the repo.

## Ground rules

1. **Static only.** No backend, no accounts, no build step, no npm. External code comes only from `cdn.jsdelivr.net` or `cdnjs.cloudflare.com`, at an exact version, through `ToyKit.loadScript`, with a fallback that still does the job. Anything heavy (more than about 2 MB) or from any other host waits behind a button that says what will be downloaded and from where, and the host goes in `origins` in `toy.json`.
2. **The blog is the owner's own writing.** Never write, generate, index or commit a post, and never change blog markup. A toy may read published posts, and only through `ToyKit.posts()` and `ToyKit.post(slug)`.
3. **Private files.** Never open `assets/Jack_library_catalog.xlsx`, anything in `blog/drafts/`, `blog/posts/2026-09-08-i-am-an-ai-loop.md`, or any file outside the repo and your scratch folder.
4. **Privacy.** The owner's home is "Texas" at 32.99, -96.75. No city name for the owner appears in code, copy, data or comments. Requests your build scripts make (Wikidata, Gutenberg and so on) identify themselves by the site URL only, never by an email address.
5. **Research accuracy.** Never invent a result. Statements about the owner's papers may come only from `misc/55-paper-theatre/stories/_facts/obfuscation.vn`, the published `.vn` stories in that folder, and `assets/documents/publications/2026SPLASH-SRC.pdf`, and each one says where it comes from. Six papers are under embargo (paired training and attribution, unlearning, dual-process, extreme summarization, code as embedding, merging): do not describe their methods or results, and do not build a demo of them. A toy that demonstrates a technique uses the textbook version and says on the page that it is not the method of any paper on this site. No percentiles, norms, leaderboards or comparisons with other visitors: there is no data behind them.
6. **Languages.** Do not write sentences of your own in Japanese, German or Vietnamese. Use public-domain texts and dictionary data, quoted exactly. Japanese texts must be by authors who died before 1946 or published before 1931.
7. **Vendored data.** Every dataset you add gets an entry in a `LICENSES.md` in your folder (source URL, licence, date fetched, SHA-256 of what you fetched, what you changed) and a credit in the page's "How it works" footer. Fetch it with a script you keep in your folder (`build-*.mjs`), so the data can be rebuilt. Keep it small: trim to what the toy uses.
8. **Not wanted** (the owner removed or rejected these): a Projects section, blog search, tag chips, table of contents, copy buttons, pager, reading time, RSS, share pages, Cite buttons, a dot-field research map.
9. **Sensors.** Camera, microphone and device motion start only after the reader presses a clearly labelled button, never on load, and the toy works without them (a bundled sample, a pointer fallback). Nothing recorded leaves the page.
10. **Tone.** This is an academic's site. Toy pages may be strange and ambitious; they are never cute about the owner's honours, money, press or peer review, and they never put words in the mouths of co-authors.

## What to deliver

```
misc/NN-slug/
  index.html     the page (kit head, <main class="kit-main">, a help <template>, a "How it works" footer)
  app.js         DOM, drawing, input: one IIFE
  <name>.js      the logic that needs no browser, as UMD (window.X and module.exports)
  test.js        node misc/NN-slug/test.js : prints PASS/FAIL lines, exit code 1 on failure
  toy.json       the manifest (below)
  LICENSES.md    only if you vendored data or code
assets/img/misc/NN-slug.jpg   written by shot.mjs
```

Start from `misc/_kit/template/`. In your copy change the two kit paths from `../../_kit/` to `../_kit/`; a forgotten edit shows as `ToyKit is not defined`.

Split the logic from the page. Simulation, parsing, scoring, generators and anything with a right answer live in the UMD file and are tested in Node, including the properties that make the toy honest (a seeded run gives the same result twice; the solver's answer really solves the puzzle; the dataset has the entries the page claims).

`toy.json`:

```json
{
	"n": 58,
	"slug": "58-grokking-furnace",
	"title": "Grokking Furnace",
	"desc": "One or two concrete sentences: what the reader does and what happens.",
	"note": "",
	"group": "ml",
	"tags": ["training", "webgl"],
	"added": "2026-10-03",
	"surfaces": ["grid"],
	"status": "wip",
	"kit": true,
	"data": [],
	"origins": [],
	"thumb": { "query": "?thumb=1", "viewport": [800, 500], "settleMs": 300 }
}
```

- `n`, `slug`, `group`, `added` and `surfaces` are given in your task. Groups: `stories`, `ml`, `lab`, `code`, `language`, `library`, `art`, `time`. Leave out `order`.
- `title`: at most 24 characters. `desc`: 60 to 185 characters, plain text, in the voice of the existing cards (see `misc/toys.json`): concrete, a little dry, no hype, no exclamation marks. `note` is for a caveat a visitor needs before clicking ("Asks for the camera."), usually empty.
- `status` stays `"wip"` until your tests pass, the smoke gate passes and the thumbnail exists; then set it to `"live"`.
- `thumb.viewport` must be 16:10; ask for `[1600, 1000]` if the page looks cramped at 800 by 500.

## The bar

- **The first ten seconds.** The page does something worth looking at as soon as it opens, with a sensible default already loaded. Nobody reads instructions first.
- **Real, not mocked.** Buttons do what they say. What the page claims to compute, it computes. If a part is missing, the page does not pretend, and your report says so.
- **Both themes** where sensible (override the kit's tokens on `:root` and on `:root[data-theme="dark"]`); a toy with one deliberate palette follows the README's note on that.
- **360 px wide**, touch through Pointer Events, nothing scrolls sideways, targets at least 44 px.
- **Keyboard**: every control reachable and operable; a pointer-only canvas action has a keyboard way too; focus visible; results announced through `aria-live` or `ToyKit.toast`.
- **Reduced motion**: nothing moves by itself; the finished state is drawn at once.
- **`?thumb=1`**: one fixed, good-looking, deterministic state that fills 800 by 500 (follow "The thumbnail protocol" in the kit README).
- **Time-based animation.** The test browser runs `requestAnimationFrame` at 120 Hz; a fixed step per frame runs at double speed there. Use elapsed time.
- **WebGL** needs a fallback: a visitor may have none. Keep a plain-JavaScript reference that draws the same state, which is also what your Node test checks.
- **Failures are plain words**: `.catch(function (err) { ToyKit.fail(err); ToyKit.ready(); })`. No `console.error` in normal use (the gate fails on it).
- **Storage** only through `ToyKit.store` and `ToyKit.load`.
- **"How it works" footer**: what is computed and how, where the data came from with its licence, and "Nothing leaves your browser." only when that is true.
- **Weight**: keep the first load light; fetch large data after the first paint and show that it is loading.

## Data you can use

| What | How |
| --- | --- |
| The library, 889 books and 53 objects | `ToyKit.library()` |
| Published blog posts | `ToyKit.posts()`, `ToyKit.post(slug)` |
| Publications as listed on the site | `ToyKit.root + 'assets/data/publications.json'` (title, authors, year, section, venue verbatim, links, story) |
| Places | `ToyKit.root + 'assets/data/places.json'` |
| All toys | `ToyKit.root + 'misc/toys.json'` |
| Paper Theatre stories and engine | `misc/55-paper-theatre/stories/index.json`, `vn.js` (UMD, pure), `art*.js` |
| Cited figures from the obfuscation study | `misc/55-paper-theatre/stories/_facts/obfuscation.vn` (`@fact key = value ^ref`) |
| English word frequencies | `misc/18-zipf-karaoke/freq.js` |
| Pronunciation (stress and rhyme tails) | `misc/11-poetry-form-checker/cmudict.min.json` |
| Six-language lexicon | `misc/26-homophone-bridge/lexicon.js` |
| Authors matched to Wikidata | `misc/28-dead-authors-clock/authors.js` |
| Latentland's places, glosses and quotes | `misc/32-latentland-map/world.js` |
| JavaScript obfuscation transforms and a parser | `misc/04-obfuscation-playground/` (`js_transforms.js`, `vendor/`) |

Load another folder's file by relative path (`../18-zipf-karaoke/freq.js`) and name the dependency in your report; do not copy it.

## Check your work

```
node misc/NN-slug/test.js
node scripts/qa/smoke.mjs NN-slug        must print PASS (seven loads for a kit toy)
node scripts/qa/shot.mjs NN-slug         writes the thumbnail; fails if it is blank or the wrong size
node scripts/qa/shot.mjs --url "misc/NN-slug/" --out <scratch>/dark.png --theme dark
node scripts/qa/shot.mjs --url "misc/NN-slug/" --out <scratch>/phone.png --theme light --width 390 --height 844 --mobile
node scripts/qa/drive.mjs <scratch>/check.mjs    click through the main path and assert on what happens
```

Look at every picture you take with the Read tool, the thumbnail included, and fix what looks wrong: clipped text, an empty canvas, unreadable contrast, a layout that wastes the frame. The gate cannot see any of that. Give browser commands a ten-minute timeout; they queue when many agents test at once.

## Pitfalls already met

- Bash heredocs on this machine strip backslashes from JavaScript. Write files with the Write and Edit tools.
- A `\uXXXX` escape typed through the Write tool can arrive as the literal character (once as an invisible byte-order mark). Build such characters with `String.fromCharCode`, or check the file afterwards.
- `ToyKit.onTheme` fires on changes only; read the colours once yourself at start. `ToyKit.onMotion` fires at once and on changes.
- In the dark theme the kit's dark tokens beat anything set on plain `:root`; write the dark half of your palette.
- `ToyKit.audio()` waits for a real gesture and is `null` under `?thumb=1`. Never call `new AudioContext()` yourself.
- `page.eval` in the harness counts as a gesture; use `page.click` when the gesture is what you are testing.
- A `fetch()` whose body is never read keeps the page "busy" for the harness. Read or cancel every response.
- GitHub Pages is case-sensitive; the test server is too. `Data.js` and `data.js` are different files.

## Your report

End with a report the integrator can act on without opening your files:

- Files created (paths) and what each is.
- Every check you ran with its real result (counts, PASS or FAIL). If something failed or was not run, say so plainly.
- What the toy does, in three sentences, and what you cut or could not finish.
- Data and code you vendored, with licences.
- Dependencies on other folders.
- Anything about the kit or the harness that got in your way.
