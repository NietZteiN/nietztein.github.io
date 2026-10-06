# Theatre Studio: the frame and the panel interface

Toy 56 is a writing room for Paper Theatre `.vn` scripts: the editor on the left, the live stage on the right
(`../55-paper-theatre/` in preview mode, inside an iframe), panels as tabs under the editor, a status line at the
bottom. This file is for whoever writes a panel. The frame (the "shell") is `studio.js`, `studio.css`,
`lint-worker.js` and `index.html`; everything in `../55-paper-theatre/` is read-only.

The Studio is a tool. It never writes prose, dialogue or figures for the author: a panel may insert *syntax* the author
chose (a `@cast` line built from the author's picks, a `@bg` name from the list, a `{fact}` key that exists), never
sentences of its own.

## Files

| File | Owner | What it is |
| --- | --- | --- |
| `index.html`, `studio.js`, `studio.css`, `lint-worker.js`, `toy.json`, `test.js`, this README | the shell | the frame, the bus, the lint worker, the tests |
| `vn-highlight.js` | editor builder | syntax colouring for the editor (loaded before `editor.js`; suggested global `window.VNHighlight`) |
| `editor.js` | editor builder | a panel with id `editor` that **replaces** the built-in textarea |
| `files.js` | files builder | opening and saving `.vn` files on disk, the draft list beyond the toolbar (id `files`) |
| `panels/issues.js` | issues builder | id `issues`: **replaces** the built-in issue list |
| `panels/map.js` | map builder | id `map`: the branch map |
| `panels/cast.js` | cast builder | id `cast`: the cast designer |
| `panels/scenery.js` | scenery builder | id `scenery`: backgrounds, CGs, weather, tones |
| `panels/facts.js` | facts builder | id `facts`: facts and the publish checklist |
| `panels/board.js` | board builder | id `board`: the status board |

Each of those files is a one-line placeholder today. Replace it with your file; do not touch the shell's files. If you
need something from the shell, say so in your report (file, function, what).

Load order (end of `<body>`): `vn.js`, `art-scenes.js`, `art-cast.js`, `art.js` (so `window.VN` and `window.VNArt` exist),
`studio.js` (defines `window.Studio`), then `vn-highlight.js`, `editor.js`, `files.js` and the six `panels/*.js`. A panel
file runs after `studio.js` and before the shell boots (the shell boots on `DOMContentLoaded`), so it can simply call
`Studio.registerPanel(...)` at the top level. `VNArt.sharedDefs()` (the SVG filters every scene and sprite refers to) is
injected once by the shell; do not inject it again.

Browser code follows the house style: one IIFE, `'use strict'`, `var` and `function`, tabs, no modules.

## window.Studio

```js
window.Studio = {
	registerPanel({ id, title, order, mount(el, api) }),   // -> true when accepted
	bus: { on(evt, fn), off(evt, fn), emit(evt, data) },
	api,                                                    // the same object mount() receives
	version: '1.0'
}
```

### registerPanel

```js
Studio.registerPanel({
	id: 'cast',                 // unique; also names the pane: <div id="st-pane-cast" class="st-pane" role="tabpanel">
	title: 'Cast',              // the tab's label
	order: 30,                  // tabs sort by order (default 100), then by registration
	mount: function (el, api) { // el is the pane, empty, already in the page (hidden unless it is the active tab)
		...
		return { show: fn, hide: fn, resize: fn, unmount: fn };   // all optional; or return nothing
	}
});
```

- `mount` runs once, when the shell boots (or at once if the shell is already up). It may return a Promise of that
  object; a rejected Promise counts as a failure.
- A panel whose `mount` throws (or rejects) is shown as failed: its tab turns red and its pane says "This panel failed to
  start" with the message. Every other panel, the editor and the stage go on working. A handler on the bus that throws
  is caught and logged with `console.warn`, never `console.error`.
- `show()` is called when the tab becomes active (and when the narrow-screen switcher shows the panels), `hide()` when
  another tab takes its place, `resize()` after a divider drag. Panes are mounted while hidden, so measure in `show()`,
  not in `mount()`.
- Suggested orders: `issues` 10, `map` 20, `cast` 30, `scenery` 40, `facts` 50, `board` 60, `files` 70.
- A second registration with an id already taken is ignored (with a warning), except that `issues` replaces the
  shell's built-in issue list and `editor` replaces the built-in editor.
- `Alt+1` to `Alt+9` open the first nine tabs in order.

### The editor panel (id `editor`)

An editor panel replaces the built-in plain `<textarea>`. Its `mount` gets a **third argument**, `host`, and must
**return the editor implementation** synchronously:

```js
Studio.registerPanel({
	id: 'editor', title: 'Editor',
	mount: function (el, api, host) {
		// el is the editor pane (#st-editor), not a tab pane; fill it (it is position:relative, overflow:hidden).
		// Call host.changed() after every edit the author makes, and host.cursor(line) when the caret moves to another line.
		return {
			getText: function () { ... },            // required: the whole text, '\n' line ends
			setText: function (text) { ... },        // required: replace everything, caret to line 1, do NOT call host.changed()
			insertAtCursor: function (text) { ... }, // required: insert or replace the selection; keep undo if you can
			replaceLine: function (line, text) { ... }, // required: 1-based; a line past the end is appended
			getCursorLine: function () { ... },      // required: 1-based
			gotoLine: function (n) { ... },          // required: caret to the start of line n, scroll it into view, focus
			focus: function () { ... },              // optional: used by F6
			setIssues: function (issues) { ... },    // optional: called with every new issue list, to mark lines
			element: someFocusableElement            // optional: what F6 focuses
		};
	}
});
```

- The shell owns the version counter, the 150 ms debounce (at most 1.5 s while the author types without a pause), the autosave, the lint and the stage. The editor never emits
  `doc:change` itself; `host.changed()` is all it does. Calling it once too often is harmless.
- `insertAtCursor` and `replaceLine` reach the editor through `api.*`, and the shell reports those edits itself; if the
  editor's own input events also call `host.changed()`, nothing breaks.
- If the panel throws in `mount`, or returns an object missing a required method, the shell keeps the plain textarea and
  says so in the status line.
- `host.cursor(line)` drives the `cursor:line` event and "Follow cursor". Report only real line changes.
- `StudioHelpers` (below) has the line arithmetic the plain editor uses.

## api

Every panel gets the same object (`Studio.api`).

| Call | Does |
| --- | --- |
| `getText()` | the whole script as it is in the editor now (may be up to 150 ms ahead of the last `doc:change`) |
| `setText(text, { silent })` | replaces the whole text (CRLF becomes LF). Without `silent` it commits at once: autosave, `doc:change`, lint, stage reload. With `silent: true` nothing is emitted, saved or linted until the next edit; use it only when you will commit some other way. |
| `insertAtCursor(text)` | inserts at the caret (replacing a selection); committed after the debounce like typing |
| `replaceLine(line, text)` | replaces line `line` (1-based) without its newline; `text` may hold `\n`; committed after the debounce |
| `getCursorLine()` | the caret's 1-based line |
| `getProgram()` | the last program from the lint worker (`VN.parse` output, plain JSON; see `../55-paper-theatre/OPS.md`), or `null` before the first one |
| `getIssues()` | a copy of the last issue list: `VN.lint(program)` plus, when there is no fatal, `VN.walk(program).issues`, sorted by line. Each is `{level: 'fatal'|'warn', line, msg, hint, code}`; `line` 0 is file-level |
| `gotoLine(n)` | caret to line n in the editor, `cursor:line`, and the stage goes to the stop at or after that line (always, whether or not "Follow cursor" is on) |
| `getDraftKey()` | the draft on show; its text is `localStorage['vn:studio:' + key]` |
| `isReadOnly()` | `true` while another Studio tab holds this draft (see Storage): `setText`, `insertAtCursor` and `replaceLine` then do nothing but say so in the status line |
| `setStatus(text)` | a message in the status line (cleared after 8 s) |
| `toast(text)` | `ToyKit.toast` |
| `root` | the site root as an absolute URL (`ToyKit.root`) |

## Bus events

`Studio.bus.on(evt, fn)`, `off(evt, fn)`, `emit(evt, data)`. Handlers run synchronously in registration order.

| Event | Data | When |
| --- | --- | --- |
| `doc:change` | `{ text, version }` | about 150 ms after the last edit (debounced; at least every 1.5 s during steady typing), after `setText` without `silent`, when a draft is opened, and in a read-only tab when the tab holding the draft saved. The text is already saved. `version` grows with every edit. |
| `program:ready` | `{ program, issues, walk, version }` | from the lint worker after each `doc:change`; `version` is the text it was computed from. Late answers for older text are dropped. `walk` is `null` while there is a fatal issue. |
| `cursor:line` | `{ line }` | the caret moved to another line (also on `gotoLine` and when a draft opens) |
| `preview:stop` | `{ line, index, kind }` | the stage presented a stop: its source line, op index and op kind |
| `preview:ready` | `{ title, issues }` | the stage (re)loaded the draft; `issues` are `{level, line, msg, code}` (the stage's own lint, without walk issues). A draft it could not read gives `title: null` and one issue with code `load-failed`. |
| `preview:goto` | `{ line }` or `{ label }` | **emit** this to send the stage somewhere without moving the caret |
| `file:opened` | `{ name, text }` | **emit** this after reading a file from disk: the shell creates a new draft named after the file (key from `StudioHelpers.slugKey`), opens it and commits. Do not also call `setText`. |
| `file:saved` | `{ name }` | **emit** this after writing a file; the shell shows it in the status line |

Panels may add their own events; prefix them with the panel id (`map:select`).

## The stage

The iframe loads `../55-paper-theatre/?src=draft:<key>&studio=1&drafts=1&theme=<light|dark>` and talks to the shell over
`BroadcastChannel('vn:studio')` (the full protocol is in OPS.md, "Studio preview"). The shell sends `reload` once typing
pauses (700 ms after the last key; saving and lint do not wait), after `setText`, Ctrl+S and Reload stage, and `goto {line}` on `gotoLine`, `preview:goto`, Ctrl+Enter and (with "Follow cursor") on caret moves (a caret moved by
typing waits for that reload, which lands on the caret); a freshly loaded frame is sent to the caret's line. Panels never post on that channel themselves: use `preview:goto`.
Only the stage in this page's own frame is driven: the shell hooks the frame document's `BroadcastChannel.prototype.postMessage`
(same origin), adopts the stage's channel at its first post and from then on passes messages directly between the page and
its frame, so a second Studio tab neither moves this stage nor is heard here. Until that first post the broadcast is used,
with `id: 'src:draft:<key>'` on outgoing messages. The same hook logs the stage's `[vn]` lint lines with `console.warn`
instead of as errors (a fatal issue in a draft is ordinary while writing).
The shell hides the theatre's own header, footer and issue list inside the frame with an injected stylesheet. While the
script has a fatal issue the stage shows its panel and ignores `goto` until the next good reload.

Under `?thumb=1` the frame gets `&audio=0&paint=0&live=0&camera=0&op=0`, so the picture is the plain one.

## Storage

- `localStorage['vn:studio:<key>']`: the draft text, raw (this is what the stage reads).
- Through `ToyKit.store` / `ToyKit.load` (`toy.56-theatre-studio.*`): `drafts` (`[{key, name, from, updated}]`),
  `active`, `cursor` (`{key: line}`), `split`, `edit`, `follow`, `tab`, and `lock.<key>` (`{tab, at}`).
- One writer per draft. The tab that opens a draft claims `lock.<key>` and renews it every 2 s; it checks the record
  before every save and hears other tabs' writes through the `storage` event. A tab that opens a draft another live
  tab holds shows it read-only (`#st-lock` notice with "Take over") and follows that tab's saves. A tab whose draft
  is taken stops saving at once and says so; text it had not saved yet can be kept as a copy. A record not renewed
  for 9 s (a crashed or long-asleep tab) is free, and `pagehide` lets go. Deleting a draft another tab holds is refused.
- A panel keeps its own settings with `ToyKit.store('panel.<id>.<name>', value)`. Nothing under `?thumb=1`
  (`ToyKit.thumb`): read no storage there and draw one fixed state.

## Page structure and styles

```
main.studio#studio
  .st-bar               toolbar: draft select, New, Duplicate, Rename, Delete, Open example, Follow cursor, Stage at cursor, Reload stage
  .st-switch            Script / Stage / Panels (only under 900 px)
  .st-work#st-work      grid: .st-left | .st-vsplit | .st-right    (data-show = script|stage|panels on narrow screens;
                        class is-tall when the window is tall enough: #st-panels then moves under the stage)
    .st-left            grid: #st-editor | .st-hsplit | #st-panels (#st-tabs, #st-panes > .st-pane#st-pane-<id>)
    .st-right           #st-stagebox > iframe#st-frame, .st-stageinfo
  .st-status            #st-count (issue summary; click goes to the next issue), #st-msg, #st-pos, #st-saved
```

- Use the kit's tokens (`--bg --surface --surface-2 --text --text-2 --heading --border --border-strong --accent
  --accent-soft --accent-ring --font-mono`) and the shell's `--st-fatal`, `--st-warn`, `--st-ok`, so both themes work.
- Scope your CSS under `#st-pane-<id>` (or a class of your own). A panel that needs a stylesheet adds it from its
  script (`var l = document.createElement('link'); l.rel = 'stylesheet'; l.href = 'panels/cast.css'; document.head.appendChild(l);`)
  because `index.html` is the shell's.
- A pane is `position: absolute; inset: 0; overflow: auto; padding: 8px 10px; font-size: 13px`. Panels are dense:
  13 px text, compact rows, no hero headings. The page has to survive 390 px wide (stacked, one part at a time).
- Keys the shell already uses: `Ctrl+Enter` (stage at the caret), `Ctrl+S` (save now), `Ctrl+Shift+F` (Follow cursor),
  `Alt+1`..`Alt+9` (tabs), `F6` / `Shift+F6` (editor, tabs, stage bar). Keys inside a focused pane are yours.

## StudioHelpers

`window.StudioHelpers` (and `require('./studio.js')` in Node): `normalize`, `lineCount`, `lineOfOffset`, `lineStart`,
`lineEnd`, `getLine`, `replaceLine(text, line, repl) -> {text, start, end}`, `insertAt(text, start, end, ins) -> {text, caret}`,
`findLine(text, stringOrRegExp)`, `slugKey`, `uniqueKey`, `countIssues`, `issueSummary`, `nextIssue`, `sortPanels`,
`clamp`, `frameSrc`, `examples(manifest)`, `reconcileDrafts`. Lines are 1-based everywhere.

## Testing a panel

```
node misc/56-theatre-studio/test.js        (and test-*.js beside it: test-cast-line, test-checklist, test-highlight,
                                           test-lock, test-map, test-scaffold; scripts/test-all.mjs runs misc/*/test*.js)
node scripts/qa/smoke.mjs 56-theatre-studio
node scripts/qa/drive.mjs --mount misc/56-theatre-studio/panels/cast.js=C:\scratch\cast.js C:\scratch\check.mjs
```

`--mount` with a single file serves your scratch copy in place of the placeholder, so you can test before your file is
in the repo. In a drive script, `Studio.api` and `Studio.bus` are reachable through `page.eval`; the iframe's document is
`document.querySelector('#st-frame').contentDocument` (same origin). A script with a fatal issue makes the stage mirror
it with a `[vn]` log line inside the frame; the shell's frame hook sends it to `console.warn`, so `page.errors` stays
empty. (If the very first load of a frame beats the hook, which has not been seen, that one line is an error again.)

## Known limits of the frame

- The isolation between Studio tabs rests on the frame hook above; the stage itself does not yet filter by program id.
- Blog stories that use `@read` are linted unexpanded (the worker does not fetch the post); the stage expands them.
- `@include` files are fetched once per session from `../55-paper-theatre/stories/`.
