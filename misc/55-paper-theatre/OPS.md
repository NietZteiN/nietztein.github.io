# Paper Theatre op contract (vn.js)

`vn.js` is a UMD module: `window.VN` in the browser, `module.exports` in Node.
It never touches the DOM. Everything below is plain JSON-able data.

```
VN.parse(text, opts)        -> program
VN.lint(program, opts)      -> issues[]        (parse issues + semantic issues, sorted by line)
VN.walk(program, opts)      -> walkReport
VN.blog(markdown, meta, o)  -> ops[]           (blog post -> story ops, Tier B)
VN.expand(program, mdText, meta, o) -> program (replaces the @read op with blog() ops, re-indexes labels)
VN.createRun(program, opts) -> run
VN.routeTo(program, target, {prefer, maxNodes}) -> {choiceLog, stopIndex} | null   (choices that lead to an op index or label)
VN.interpolate(text, vars, cast) -> string     (render-time {var} / {Name} substitution)
VN.markup(text)             -> [{type:'text'|'em'|'code', text}]
VN.refs(op)                 -> ['§4', ...]     (unique chips on an op: trailing ref + fact chips)
VN.describeRef(ref)         -> 'quoted from the source, section 4'   (abbr title text)
VN.bibtex(meta)             -> string | ''     (needs meta.arxiv)
VN.hash(str)                -> uint32 fnv1a;  VN.hashHex(str) -> 8 hex chars
VN.rng(seed)                -> () => [0,1)    mulberry32; seed may be a number or a string (hashed)
VN.isThought(text)          -> bool            (the whole line is wrapped in ( ) or （ ）)
VN.FACES, VN.BACKGROUNDS, VN.BG_MODS, VN.PALETTES, VN.SLOTS, VN.HAIR, VN.CLOTHES, VN.TRANSITIONS, VN.DEFAULT_TRANSITION,
VN.FX, VN.FX_ONESHOT, VN.CGS, VN.TONES, VN.DISTANCES, VN.MODES, VN.BG_OPTS, VN.CG_MODS, VN.HAIRTONES,
VN.MUSIC, VN.AMBIENCE, VN.SFX  (constant lists / maps)
```

```
VN.MUSIC    = ['theme', 'nocturne', 'tender', 'memory', 'cold', 'tension', 'bright', 'finale']
VN.AMBIENCE = ['rain', 'wind', 'sea', 'train', 'hum', 'crowd', 'night', 'room']
VN.SFX      = ['page', 'chime', 'door', 'keys', 'thud', 'bell', 'click']
```

## Program

```
program = {
  id:      string|null,                 // opts.id (story id from the manifest or ?src filename)
  hash:    string,                      // fnv1a hex of the source text (saves compare this)
  meta:    Meta,
  cast:    { [key: lowercase name]: CastDecl },   // insertion order = declaration order
  facts:   { [key]: {key, value, ref, line, file} },
  ops:     Op[],
  labels:  { [name]: opIndex },         // index of the `label` op
  menus:   number[],                    // indices of menu ops
  thumb:   number|null,                 // index of the `thumb` marker op (?thumb=1 replays to the stop after it)
  chapters: [{n, title, index, line}],  // one per @chapter, in file order; index = op index of the `chapter` op
  issues:  Issue[]                      // parse-time issues only; VN.lint() returns the full list
}

Meta = {
  title: string|null, kind: 'paper'|'blog'|null,
  source: string|null,                  // raw text after @source
  sourceKind: 'paper'|'blog'|'text'|null, sourceRef: string|null,   // 'paper:<substr>' -> 'paper', '<substr>'
  cite: string|null, arxiv: string|null,
  links: [{url, label}],                // max two; default labels 'Read the paper' / 'Read the post'
  authors: string|null,
  note: string,                         // default disclaimer when @note absent
  status: 'draft'|'embargo'|'published',   // default 'draft'
  palette: {name: string|null, hue: number},  // hue 0-359; default fnv1a(id||title) % 360
  verify: boolean,                      // @verify present
  includes: string[],                   // @include paths as written
  file: string|null                     // @file (optional, blog fallback)
}

CastDecl = {
  id: 'Jack',                           // as written in @cast
  key: 'jack',                          // lowercase lookup key
  name: 'Jack',                         // display name (name="..." or id)
  hue: number, skin: 1..5,
  hair: 'short'|'long'|'bob'|'ponytail'|'bun'|'curly'|'none'|'hood',
  clothes: 'coat'|'hoodie'|'cardigan'|'shirt'|'uniform'|null,   // null = the art picks one from the name
  glasses: bool, hat: bool,
  build: 'fem'|'masc'|null,             // null = the neutral figure
  hairhue: number|null,                 // 0-359; null = a natural dark tone hashed from the name
  hairtone?: 'dark'|'mid'|'light'|'fair', // absent unless written; depth of the hair colour (hairhue alone = 'light')
  lattice: null|'sparse'|'dense',
  player: bool, page: bool, coauthor: bool,
  line: number
}
```

## Ops

Every op has `kind` and `line` (1-based source line; blog ops have `line: 0`).
Text ops (`say`, `narrate`, `card`, `chart`) also carry:

- `text` already has `{fact}` and `{Name}` substituted at parse time; `{var}` placeholders remain for render time (`VN.interpolate`). Inline markup (`*em*`, `` `code` ``) is kept raw; use `VN.markup()`.
- `ref: string|null` the trailing citation chip without the caret (`'§4'`, `'p.2'`, `'¶3'`, `'para'`). If the line has no trailing chip but used a fact, `ref` is the first fact's ref.
- `chips: [{key, value, ref}]` one per interpolated fact, in order of appearance (may repeat a key).
- `refs: string[]` unique union of `ref` and `chips[].ref` (same as `VN.refs(op)`).
- `thought: bool` (`say` and `narrate` only) true when the whole text is wrapped in ASCII `( )` or full-width `（ ）`
  parentheses. The stage sets such lines in the thought style (italic, softer colour). No new syntax.

Any blocking op may also carry `note: string`, a presenter note. A comment line `# note: some text` attaches to the
NEXT blocking op in file order (non-blocking directives in between do not take it; a note before the first `*` of a
menu belongs to the menu, a note between two options to the stop after the menu; a note after the last line goes to the
implicit `end`). Several notes for one stop join with `\n`; `# note:` with no text keeps a blank line between two
notes. The key is absent when there is no note, and every other comment is ignored as before. `VN.expand()` moves a
note written above `@read` to the first stop of the post. The reader never sees a note: only `presenter.html` does.

```text
# note: Pause here. Ask who has read obfuscated code.
Jack: Obfuscation is almost always measured without people. ^§1
```

| kind | fields |
|---|---|
| `say` | `who` (cast id as declared), `key` (lowercase), `face` (one of FACES or null), `text`, `ref`, `chips`, `refs` |
| `narrate` | `text`, `ref`, `chips`, `refs` |
| `bg` | `name` (one of BACKGROUNDS; unknown names are kept as written, lint warns, renderer falls back to `void`), `mod: 'night'|'dawn'|'dusk'|'noon'|'dim'|null`, `opts?: {overcast?: true, board?: 'plot'|'text'|'blank'}` (the key is absent when no option was written) |
| `show` | `who`, `key`, `slot: 'left'|'center'|'right'|null` (null = first free slot), `face: string|null`, `dist: 'near'|'far'|null` |
| `move` | `who`, `key`, `slot: 'left'|'center'|'right'` (the sprite slides there; face and distance are kept) |
| `hide` | `who`, `key`, `all: bool` (`@hide all`) |
| `scene` | `title` (a light title board over the picture) |
| `chapter` | `n` (the first token, kept as a string: `1`, `II`), `title` (may be empty). A chapter card: black, large numeral, title, thin rule. Registered in `program.chapters`. |
| `transition` | `name` (one of TRANSITIONS: `fade` through black, `dissolve`, `white`, `wipe-left`, `wipe-right`, `iris`, `blinds`, `cut`; unknown names become `dissolve` with a warning), `ms` (default 600, capped at 10000). Arms the transition for the NEXT `bg` or `cg` change. |
| `flashback` | `on: bool`, `caption: string|null` (only with `on`) |
| `mode` | `mode: 'nvl'|'adv'` |
| `page` | (no fields) clears the NVL page |
| `fx` | `name` (one of FX: `petals snow rain dust fireflies`, or `none`, or one of FX_ONESHOT: `shake flash pulse`), `on: bool` (false only for `@fx name off`), `oneshot: bool`. Unknown names are dropped with a warning (no op). |
| `cg` | `name: string|null` (null = `@cg off`; unknown names are kept, lint warns, the renderer draws an abstract fallback), `caption: string|null`, `mod?: 'day'|'dusk'|'dawn'|'night'` (`noon` is stored as `day`), `opts?: {overcast?: true, text?: string}` (keys absent when not written; an unknown token after the name warns `cg-malformed`) |
| `pause` | `ms` (default 800, capped at 10000). A beat with no text; a stop that continues by itself. |
| `tone` | `name` (one of TONES: `none dusk night dawn noon memory cold`; unknown names become `none` with a warning) |
| `music` | `track` (one of MUSIC, or `auto`, or `off`; `@music` alone is `auto`; unknown names become `auto` with a warning). `@music nocturne` |
| `ambience` | `name` (one of AMBIENCE, or `auto`, or `off`; `@ambience` alone is `auto`; unknown names become `auto` with a warning). `@ambience rain` |
| `sfx` | `name` (one of SFX). A one-shot sound on the way to the next stop. Unknown names are dropped with a warning (no op). `@sfx door` |
| `card` | `title`, `cells: [{label: string|null, value: string, chips, ref}]`, `src: string|null` (image url, blog images only), `ref`, `chips`, `refs` |
| `chart` | `type: 'bar'|'range'`, `title`, `unit: string|null`, `series: [{label, value, num, lo, hi, loNum, hiNum, chips, ref}]`, `ref`, `chips`, `refs`. For `bar`: `value`/`num`; for `range`: `lo`/`hi` strings and `loNum`/`hiNum`. `num*` are parsed floats or null. |
| `code` | `lang: string`, `lines: string[]` |
| `menu` | `options: [{text, target, once: bool, cond: Cond|null, line}]`, `key` (8-hex fnv1a of the option texts + targets; stable under prose edits elsewhere, used to match saved choice logs) |
| `goto` | `target` (label name, or `'end'`) |
| `set` | `name`, `value: string|number` |
| `add` | `name`, `value: number` |
| `if` | `cond: Cond`, `target` |
| `withheld` | `text` (default 'Results withheld until the paper is public.') |
| `read` | `what: 'post'`, `max: number` (default 24). Replaced by `VN.expand()`; if still present at run time it is a stop of kind `read` and the stage decides. |
| `end` | `implicit: bool` (true for the end appended at EOF) |
| `label` | `name` (non-blocking marker; `program.labels[name]` points at it; the run reports it as `state.label`) |
| `thumb` | marker, non-blocking |

`Cond = {name: string, op: '=='|'!='|'truthy'|'falsy', value: string|number|null}`.
Values compare loosely as strings (`'1' == 1`).

Blocking stops: `say narrate menu scene chapter pause card chart code withheld read end` (plus synthetic `error`).
Non-blocking: `bg show move hide transition flashback mode page fx cg tone music ambience sfx goto set add if label thumb`.
`walk()` treats every new op as a plain step (no branching); `pause` and `menu` stops are not recorded in `state.history`.

With no `@music` and no `@ambience` in a script, `state.music` and `state.ambience` stay `'auto'` and the score is
chosen automatically from the scene: `VNScore.cue()` (score.js) is given the whole state of each stop (the background
and its hour, the weather, the tone, a flashback, the chapter) and decides. A script only writes these directives
where it wants something other than what the scene suggests: `@music off` for a silence, `@music tension` for a named
track, `@music auto` to hand the choice back.

## Issues

```
Issue = { level: 'fatal'|'warn', line: number, msg: string, hint: string, code: string, file?: string }
```

Codes (fatal): `kind-missing`, `unknown-jump`, `option-no-target`, `show-undeclared` (also `@move` of an undeclared name), `show-malformed`, `move-malformed`, `if-malformed`, `option-malformed`.
Codes (warn): `title-missing`, `cite-missing`, `speaker-undeclared`, `face-unknown`, `bg-unknown`, `numeric-literal`, `chip-in-branch`, `coauthor-unchipped`, `chart-literal`, `fact-no-ref`, `include-missing`, `placeholder-unknown`, `directive-unknown`, `status-unknown`, `palette-unknown`, `slot-unknown`, `links-extra`, `header-after-body`, `no-chips`, `unreachable-label`, `walk-loop`, `walk-cap`, `set-malformed`, `menu-empty`, `bg-mod-unknown`, `transition-unknown`, `transition-malformed`, `fx-unknown`,
`fx-malformed`, `cg-unknown`, `cg-malformed`, `tone-unknown`, `mode-unknown`, `flashback-malformed`, `pause-malformed`, `chapter-malformed`,
`music-unknown`, `ambience-unknown`, `sfx-unknown`.
The seven `*-unknown` name warnings (transition, fx, cg, tone, music, ambience, sfx) list the valid names in `hint`.

`lint(program, {kind})`: `kind` overrides `meta.kind` for the paper-only rules. A `published` paper story is
"publishable" only if lint has no fatal and none of: `numeric-literal`, `chip-in-branch`, `coauthor-unchipped`,
`cite-missing`, `no-chips`. `VN.publishBlockers(issues)` returns that subset.

Example wording (test.js asserts on these):
- `line 12: 'Result' is not in @cast; treated as narration` hint: `add "@cast Result" to the header or remove the colon`
- `line 9: unknown background 'attic'` hint lists the known names
- `line 31: jump to unknown label 'modles'`
- `line 20: figure without a citation chip: "40.5%"` hint: `use a {fact} or end the line with ^§n`
- `line 44: chipped figure inside a choice-dependent branch` hint: `choices change reactions, never reported figures`
- `line 50: coauthor 'Anh' speaks without ^§n or ^para`
- `line 7: unknown transition 'swirl'; using dissolve` hint: `transitions: fade, dissolve, white, wipe-left, wipe-right, iris, blinds, cut`
- `line 8: unknown fx 'confetti'; ignored` hint: `fx: petals, snow, rain, dust, fireflies, none; one-shot: shake, flash, pulse`
- `line 9: unknown cg 'dragon'; using an abstract fallback` hint: `known CGs: tree, desk-night, ...`
- `line 10: unknown tone 'sepia'; using none` hint: `tones: none, dusk, night, dawn, noon, memory, cold`
- `line 11: unknown music 'swing'; using auto` hint: `music: theme, nocturne, tender, memory, cold, tension, bright, finale, auto, off`
- `line 12: unknown ambience 'storm'; using auto` hint: `ambience: rain, wind, sea, train, hum, crowd, night, room, auto, off`
- `line 13: unknown sfx 'boom'; ignored` hint: `sfx: page, chime, door, keys, thud, bell, click`

Speaker detection: `Name: text` is a `say` only when `Name` is in `@cast`. Otherwise the line is narration; the
`speaker-undeclared` warning fires only when the prefix is a single capitalised word (`Result: ...`), so prose such as
`Nearly three: the rain ...` or `the short version: ...` passes silently. The numeric-literal lint ignores digits that
are part of a declared cast id or display name (`Participant 23`).

## walk

```
VN.walk(program, {maxSteps=20000}) -> {
  ok: bool,                    // no loops, no cap hit, every path ended in end/withheld
  paths: number,               // distinct complete paths explored (deduplicated by state)
  endings: {end: n, withheld: n},
  unreachable: string[],       // labels never visited
  loops: [{line, msg}],        // same (pc, vars, chosen) revisited on one path
  steps: number,
  issues: Issue[]              // unreachable-label / walk-loop / walk-cap, as warnings
}
```

## createRun

```
run = VN.createRun(program, {seen: number[] = [], instant: bool, trace: fn(opIndex, state)})   // trace: called for every op about to run
run.state = {
  pc: number, vars: {}, bg: {name, mod, opts?}|null,
  slots: {left: key|null, center: key|null, right: key|null},
  faces: {[key]: face}, dist: {[key]: 'near'|'far'},     // dist has no entry for the default distance
  chosen: {['menuIndex:optionIndex']: true},
  cg: {name, caption, mod?, opts?}|null, // the event illustration on screen (hides background, sprites and particles)
  transition: {name, ms}|null,          // armed by @transition, consumed by the next bg / cg op
  change: {bg?: {name, ms}, cg?: {name, ms}}|null,   // what changed on the way to THIS stop and with which transition
                                        // (dissolve 600 when none was armed); null when neither changed. A @bg and a @cg
                                        // between the same two stops each keep their own; the stage plays the cg's.
  flashback: {caption: string|null}|null,
  mode: 'adv'|'nvl', pageStart: number, // NVL page = say/narrate rows of history[pageStart..]; @page and @mode reset it
  fx: {[name]: true},                   // persistent particle layers that are on
  oneshot: string[],                    // shake/flash/pulse fired on the way to this stop (cleared at the next advance)
  tone: string,                         // 'none' by default
  music: string,                        // 'auto' (the default: the score decides), 'off', or one of MUSIC
  ambience: string,                     // 'auto' (the default), 'off', or one of AMBIENCE
  sfx: string[],                        // @sfx names fired on the way to this stop (cleared at the next advance, like oneshot)
  chapter: {n, title, index}|null,      // the last chapter card passed
  history: [HistoryEntry], choiceLog: [{menuLine, menuKey, menuIndex, optionIndex}],
  label: string|null, stops: number         // stops = count of stops reached so far (1-based index of the current one)
}
HistoryEntry = {index, kind, who|null, text, refs, title?, n? (chapter), thought?: true, nvl?: true}
             |  {kind:'choice', menuIndex, optionIndex, text}

run.advance()          -> Stop       executes non-blocking ops until a blocking op; at a menu it returns the same
                                     menu stop again (call choose); after `end` returns the end stop with done:true
run.choose(i)          -> Stop       i = index into stop.options (the visible list); records choiceLog, then advance()
run.back()             -> Stop|null  pops the snapshot stack (max 500) and returns the previous stop
run.jumpTo(labelOrIdx) -> Stop       sets pc (label name or op index), keeps vars, then advance(). On a fresh run
                                     (no stop yet, i.e. a ?at= deep link) it first applies every non-blocking stage op
                                     (bg cg show move hide flashback mode page fx tone music ambience set label) that
                                     precedes the target in file order, so the stage is dressed; one-shots (fx and
                                     sfx) and transitions are dropped.
run.replay(choiceLog, stopIndex?) -> Stop   rebuilds from the start by stepping; consumes log entries at menus
                                     (matched by menuKey, then menuLine, else by order); stops after `stopIndex`
                                     stops when given, otherwise at the first menu with no log entry or at the end
run.snapshot()         -> {hash, choiceLog, stopIndex, seen: number[], pc}
run.seen               -> Set of op indices reached as stops (for Skip)
run.current()          -> Stop|null  the last stop without advancing
run.visibleOptions()   -> [{index, text, target}] for the current menu stop

Stop = { op, index, state, done: bool, options?: [{index, text, target}] }
       op.kind 'error' is synthesized for runtime errors: {kind:'error', msg, hint, line}
       (menu with zero visible options, jump to unknown label at run time).
```

Non-blocking op effects: `bg` -> state.bg; `show` -> slot assignment (named slot, else first free, else `right`) and
`state.faces[key]` (the face given, else the one the character already wears if it is on stage, else `neutral`: a face does
not survive an exit); `say` with a face also updates `state.faces[key]`; `hide` clears slots; `label` -> state.label;
`set`/`add` -> vars (`add` on a missing or non-numeric var starts from 0). `show` also sets or clears `state.dist[key]`;
`move` re-slots without touching face or distance; `transition` -> state.transition; `bg`/`cg` -> state.bg / state.cg and
`state.change.bg` / `state.change.cg`; `flashback`, `tone` -> same-named state; `mode` -> state.mode (+ pageStart when it
changes); `page` -> pageStart; `fx` -> state.fx (persistent) or state.oneshot (one-shot); `fx none` empties state.fx;
`music` -> state.music; `ambience` -> state.ambience; `sfx` -> pushed onto state.sfx. `state.oneshot` and `state.sfx`
are emptied at every advance or choice, so each holds only what fired on the way to the current stop; `back()` and
`replay()` restore them with the rest of the state (the stage does not play them again there). Saves are unchanged:
`snapshot()` has the same keys as before and `program.hash` is still the hash of the source text.

## blog() output

`VN.blog(markdownText, meta, {max = 24, speaker = 'Page', who = 'Page'})` returns `ops[]` (`line: 0`):

- front matter dropped; a heading equal to `meta.title` dropped; other headings -> `scene{title}`
- paragraph -> `narrate{text, ref: '¶n'}` (n = 1-based block number in the post, the chip is the paragraph)
- first block shaped like an epigraph (quoted line + attribution line without terminal period) -> `say{who:'Page', key:'page', face:null}` for the quote and `narrate` for the attribution
- blockquote -> `say{who: 'Page', key: 'page'}`
- list (ordered or bulleted) -> `label{name:'read_n'}`, `menu` whose options (all `once`) jump to `read_n_i`; each
  section is `label`, a `narrate` for the item and one more for each nested item (`cont: true`, same chip), `goto read_n`; a last option
  "Continue" jumps to `read_n_done`; `label{name:'read_n_done'}`
- image `![alt](src)` -> `card{title: 'Figure', cells: [{label: null, value: alt}], src}`
- fenced code blocks dropped, HTML comments and tags dropped, links reduced to their text, inline markdown stripped
- KaTeX delimiters (`$...$`, `$$...$$`, `\(...\)`, `\[...\]`) are left exactly as written
- a paragraph, quote attribution, list item or table longer than about 375 characters is cut at sentence ends into pieces of
  at most ~300 (`opts.chunk`), never inside `$math$` and not after `e.g.`, `vs.`, `et al.` or an initial; the pieces after the
  first carry `cont: true` and the same `¶n` chip
- after `max` blocking ops the rest is cut and a final `narrate` says the post continues (`truncated` flag on it); `cont`
  pieces and nested items do not count toward `max`, so it still counts paragraphs
- no `end` op is appended; the caller continues its own script after the expanded region

`VN.expand(program, markdownText, meta)` returns a copy of the program with every `read` op replaced by the blog ops,
`labels`/`menus`/`thumb` re-indexed. The cast gains a `page` decl (`key 'page'`) if the script has none.

## routeTo

`VN.routeTo(program, target, {prefer = [], maxNodes = 600})` searches the choices depth-first from the top of the script
for a way to reach `target` (an op index, e.g. `program.chapters[i].index`, or a label name). It returns
`{choiceLog, stopIndex}` ready for `run.replay(choiceLog, stopIndex)`, or `null` when no sequence of choices gets there
(or the label is unknown). `stopIndex` is the stop at which the target op is reached: the op itself when it is blocking,
else the first stop after it. At each menu the option recorded in `prefer` (a saved choice log, matched by `menuKey`; the
n-th visit to a hub takes the n-th saved entry) is tried first, then the visible options in script order; states already
seen (same menu, vars and used `(once)` options) are not explored twice. The stage uses it for the Chapters menu and for
`?at=<label>`, so both land on a place that can be saved, quick-saved and rewound like any other.

## Stage contract (stage.js)

The stage reads only the Stop and its state. For each stop it: brings the painted world to `state` (background or CG,
sprites keyed by cast key with slot, distance, face and speaker light, particle layers from `state.fx`, `data-tone`,
flashback grade/bars/caption), plays `state.change` as a transition (the old picture is held on a layer above the new
one), fires `state.oneshot`, then shows the op: `say`/`narrate` in the ADV window or on the NVL page by `state.mode`,
`chapter`/`scene` cards, `pause` (auto-continues after `ms`), boards, menu, end.

Everything animated has a settled state: under `prefers-reduced-motion`, `?thumb=1`, `?autoplay=`, Skip, Back, Load
and with Config > Effects off, transitions are cuts, one-shots are skipped, the typewriter is instant and (reduced
motion / thumb) particles stand still.

Particles: `rain`, `snow`, `petals` go into `.vn-fxback` (behind the sprites, fainter) when `VNArt.INDOOR[state.bg.name]`, else
into `.vn-fxlayer`; `dust` and `fireflies` are always in front; with `.vn-world.has-cg` both layers are hidden. While
`state.fx.rain` or `state.fx.snow` is on the stage passes `{overcast: true}` to `VNArt.background` / `VNArt.cg` and repaints
in place (no transition). The menu is positioned by `placeMenu()` above the text window and `#stage.menu-up` dims the cast.

Deep links and chapter jumps: `?at=<label>` and the Chapters menu replay `VN.routeTo()`; a deep link sets `noSave` (the
autosave is the reader's own place) but leaves the slots on. Only a target that no choices reach falls back to
`run.jumpTo()` with `noSlots`, and then the backlog rewinds by `run.back()` (`data-hist`) instead of by replay. An unknown
label opens the title screen with a toast. `vn:seen:<id>` (`{hash, seen}`) keeps what has been read across Start-over.

Saves: `vn:<id>` is the autosave (`run.snapshot()` + `ts`), `vn:slots:<id>` is `{1..6, q}` of
`{hash, choiceLog, stopIndex, pc, ts, chapter, text}`; loading is `run.replay(choiceLog, stopIndex)`. `vn:prefs` is
`{cps, autoSpeed, opacity, effects, size, textOnly, music, ambience, sfx, voice, mute, paint, live, camera, opening,
babble}`: the volumes `music` 0.55, `ambience` 0.4, `sfx` 0.6, `voice` 0.35 (each 0 to 1), `mute` false, the switches
`paint`, `live`, `camera`, `opening` true and `babble` (Voices) false.

Test hooks (URL): `autoplay=N|end` (instant, no autosave), `pick=K` (option K at menus), `screen=save|load|config|log|chapters|title`,
`trans=<name>` (freeze that transition half-way into stop N), `thumb=1`, `cast=1`, `gallery=bg|cg` (`&mod=night`, `&only=a,b`),
`click=N` (Start, then N animated advances), and for the optional modules `audio=0|1`, `paint=1|0`, `live=1|0`,
`camera=1|0`, `op=1|0` (see *Optional modules*), and `paintwarm=1|0` (read by `paint.js` itself: painting ahead). `src=draft:<key>` and `studio=1` belong to the Studio (see *Studio preview*).

Test hook (JS): `window.__vnStage = {S, prefs, catalog(), mods}`, the live run state for the browser harness (read-only by
convention). `S.cue` is the last cue handed to the audio; `mods` is `{has, off, force}`: which modules were loaded at
boot, which the stage is not calling in this run, and what the URL hooks forced.

Art entry points (art.js, with art-scenes.js and art-cast.js loaded first): `VNArt.background(name, mod, opts)`
(`opts.overcast`, `opts.board`, `opts.spines`), `VNArt.cg(name, mod, opts)` (`mod` = hour for the CGs with a sky,
`opts.overcast`, `opts.text`), `VNArt.INDOOR` (map of room backgrounds), `VNArt.sprite(castDecl, face)`, `VNArt.fx(name)`, `VNArt.timeOf(name, mod)` -> `day|dusk|dawn|night`,
`VNArt.sharedDefs()` (the one hidden `<svg>` of filters every scene and sprite refers to; inject once per page).

Sprites (art-cast.js): `VNArt.sprite` reads `build` (or the flags `fem` / `masc`) and `hairhue` from the cast
declaration; `normCast` returns `build: 'fem'|'masc'|'neutral'` and the hair palette (`hairCol`, `hairDark`,
`hairLight`, `hairTip`, `hairLine`). A person sprite is `<svg class="vn-sprite" data-kind="person" data-build data-hair
data-clothes>` with one top-level `<g filter="url(#vnf-rim)">` holding one `<g class="vn-fig">` (the stage dims a listener on
`.vn-fig`, inside the lit group, so the rim light keeps its colour) (the stage swaps the filter for the hour: an inner rim
light on the edge that faces the light, a soft contact shadow, the hour's tint) and eight `<g data-face>` groups.

## The stage's DOM

What a module is handed and what it may look for (index.html; the names are stable):

```
#stage                      the stage element (what VNCamera.attach and VNOp.play are given)
                            classes: in-play | at-title, menu-up, no-window, ui-hidden, flashback, shake, pulse, op-playing
                            attributes: data-tod = day|dusk|dawn|night (the hour of the picture), data-tone
  .vn-world                 the painted world, z-index 1. Its `filter` carries @tone and the flashback grade, its
                            `animation` carries @fx shake / pulse (they animate `transform`), ::after is the canvas tooth
    .vn-bg                  background layer: <svg class="vn-bg-svg" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice">
                            [+ <img class="vn-painted">], attribute data-paint = <key>. At the title screen it carries a
                            slow CSS zoom (`#stage.at-title .vn-bg`, animation vn-ken)
    .vn-fxback              weather seen through a window (rain, snow, petals in a room): .vn-fx[data-fx=<name>]
    .vn-sprites             the cast layer (hidden while a CG is up)
      .vn-actor             one per character on stage: data-key = cast key, data-kind = person|player|page|lattice;
                            classes pos-left|pos-center|pos-right, near|far, speaking|dim, enter|exit;
                            holds one <svg class="vn-sprite"> whose faces are <g class="vn-face" data-face> (the one with is-on shows)
    .vn-cgart               event illustration layer (class show while one is up; then .vn-world has has-cg):
                            <svg class="vn-cg-svg"> [+ <img class="vn-painted">], attribute data-paint = <key>
    .vn-fxlayer             particles in front of the cast: .vn-fx[data-fx=<name>]
    .vn-tone                the colour grade
  .vn-trans                 z-index 2: holds a deep clone of .vn-world (the old picture) for the length of a transition
  .vn-memory .vn-bars (3)  .vn-flash (4)  .vn-caption (5)  .vn-boards (6)  .vn-nvl (7)  .vn-box (8)  .vn-menu (9)
  .vn-scene (10)  .vn-quick (11)  .vn-end (12)  .vn-titlescreen (13)  .vn-picker (14)  .vn-badges (15)  .vn-topbar (16)
  .vn-screen (20)  .vn-panel (21)  .vn-toast (22)            (z-index in brackets; every one is `position: absolute; inset: 0`
                                                              unless its own rule says otherwise)
```

`#stage`, `.vn-world` and `.vn-bars` are `overflow: clip` (with `hidden` as the fallback): the letterbox bars and the
title zoom reach past the frame, and a `hidden` box can still be scrolled by `scrollIntoView` or by focus, which
shifted the whole picture up.

The living cast's markup: inside `svg.vn-sprite` of a person, the player and the page, one `g.vn-breath` holds the
whole figure (the lattice has none). In each `g.vn-face` of a person: `g.vn-eye-open` (the open eye and its lower
lash line), `g.vn-blink` (`display="none"`; absent on `laugh`, whose eyes are already shut), `g.vn-mouth-shut` (the
mouth as drawn) and `g.vn-mouth` (`display="none"`, the same mouth open). The lattice has `g.vn-mouth-shut` and
`g.vn-mouth` in each face and the classes `vn-drift vn-drift-1|2|3` on up to nine circles in `g.vn-lattice-nodes`.
`live.js` sets on the `.vn-actor`: `data-live` (`""` while living, `"hold"` on a detached actor that is fading out),
`data-blink`, `data-mouth`, and the inline custom properties `--vn-breath` (period) and `--vn-breath-at` (delay).
`vn-live.css` does the rest.

The camera's markup: `camera.js` sets the class `vn-cam` on `#stage` and writes four registered custom properties
(`--cam-x`, `--cam-y`, `--cam-push`, `--cam-pan`, `@property ... inherits: false`) on `.vn-world` and on the clone
in `.vn-trans`; `camera.css` hands them down with `inherit` and transforms the `svg`/`img` inside `.vn-bg` and
`.vn-cgart` and the layers `.vn-fxback`, `.vn-sprites` (which gets `z-index: 1`) and `.vn-fxlayer`, each by its own
depth and scaled just enough that no edge shows. Every value is eased in script, never by a CSS transition, so the
snapshot is born with the same transform and nothing jumps.

The opening's markup: `op.js` puts one `.vn-op` overlay (z-index 18) into `#stage` while it plays, with
`.vn-op-shot` pictures, the title, the column `.vn-op-vert`, the cast roll `.vn-op-roll`, `.vn-op-chapters`, the
credit `.vn-op-end` and the button `.vn-op-skip`; `op.css` styles them.

## Optional modules

Six scripts are loaded before `stage.js`, in this order: `score.js`, `audio.js`, `paint.js`, `live.js`, `camera.js`,
`op.js` (and four stylesheets after `vn.css`: `vn-paint.css`, `vn-live.css`, `camera.css`, `op.css`). Each defines one
global. Every one is optional: it may be missing, an empty placeholder or half-built, and the theatre plays on. The
stage reaches a module only through `ext(mod, fn, ...args)`:

- a missing global or method answers `undefined`;
- a method that throws, or a returned promise that rejects, is reported once per (module, method) with
  `console.warn('[vn] VNPaint.mount failed; ...')` and otherwise ignored (never `console.error`);
- a returned promise is handed on as one that never rejects.

A module must do nothing until it is called. Whether a module "exists" is read once, at boot, from its global: that
decides which Config rows, buttons and keys are there.

```
VNScore  (score.js, pure)  cue(state, op, program, hints) -> cue object | null
VNAudio  (audio.js)        unlock()  sync(cue, {instant})  hold(on)  sting(kind)  sfx(name)  voice(castKey, ch)
                           volumes({music, ambience, sfx, voice, mute})  suspend()  resume()
VNPaint  (paint.js)        mount(layerEl, svgString, key) -> Promise   unmount(layerEl)   setEnabled(bool)
VNLive   (live.js)         attach(actorEl, castDecl)   detach(actorEl)   speak(castKey, on)   setEnabled(bool)
VNCamera (camera.js)       attach(stageEl)   present(state, op)   reset()   setEnabled(bool)
VNOp     (op.js)           available(program) -> bool   play(program, stageEl, {audio, cue}) -> Promise   [stop()]
```

What each module adds beyond the contract (tests and other modules may use these; the stage does not):

- **VNScore** (pure, UMD) also exports `TRACKS`, `AMBIENCE`, `VOICES`, `MODES`, `PHRASE` (8 bars), `CYCLE` (10),
  `theme(program)`, `bar(cue, i)`, `holdBar(cue, i)`, `resolveBar(cue)`, `sting(cue, kind)`, `deg2midi`, `hourOf`. A cue
  is `{key, track, ambience, tempo, scale, beats, theme, ...}`; `key` is `track|ambience layers joined by +|filter|seed`. The automatic
  choice beyond the script's `@music`/`@ambience`: the title is `theme` at full intensity; a crowded room at night is
  `room`; outdoors by day is `wind`; `void` and `paper` have no ambience; indoors by day the music is `theme`, outdoors
  `bright`.
- **VNAudio** restarts the music only when the track, filter or seed part of the key changes; a change of ambience
  alone fades its layers and leaves the phrase playing. An instant sync cuts at once and starts the wanted cue 0.22 s
  after the last such call, so Skip does not strike the first note of every scene. `VNAudio.tempo` (read-only) is the
  playing cue's tempo; `VNAudio._debug({meter})` returns the engine's state for tests, `VNAudio._Engine` builds the
  graph on any context. `test-audio.html` (`?story=`, `?bars=`, `?manual=1`, which puts every track, ambience, effect
  and sting on a button) is the page for listening.
- **VNPaint** also has `prepare(svgString, key[, layerEl]) -> Promise` (paints into its cache, shows nothing) and
  `stats()` for tests (`enabled, cached, keys, retired, queued, running, pending, fades, urlsMade, urlsDropped,
  urlsLive, images, workers, workersOff, warm, maxWidth`); `window.__vnPaintIdle()` resolves when nothing is being
  painted. `mount` resolves at once, and inserts its image synchronously, for a picture already in the cache. It
  paints ahead: it reads `__vnStage.S.program.ops`, `S.stop.index`, `S.stop.state.fx` and `S.mode` to find the next
  pictures, so those names must stay. Painting ahead is off under `?autoplay=` and `?thumb=1` unless `paintwarm=1`;
  `paintwarm=0` turns it off anywhere. Under `html.vn-paint-on` the layers `.vn-bg` and `.vn-cgart` get
  `isolation: isolate`, `::before` (grain) and `::after` (vignette).
- **VNLive** observes `.vn-trans` (childList) to give each cloned actor the pose of its original; the clone's
  animations are paused by `vn-live.css`. `VNLive._state()` returns `{enabled, actors, queue, timer, speaking}`.
- **VNCamera** has `debug()` (`{attached, world, enabled, active, hoverless, x, y, tx, ty, push, pan, panOn, long,
  held, running}`) and the constants `LONG` (a line of at least 90 characters gets the push-in) and `PUSH` (0.03).
- **VNOp** also exports the pure parts `plan(program, beatMs)`, `beatMs`, `pictures`, `castNames`, `originalWork`,
  `titleParts`, `dramatized`, and `debug()` (`{playing, phase, t, beat, beatSrc, themed, total, shots, chapters,
  still}`). `play` resolves with `'done'`, `'skipped'` or `'stopped'`; `#stage` then has the class `op-done` and
  `data-op` that word (`"playing"` while it runs).

### When each is called

**Sound.** *Reading forward* below means a stop reached by the reader's own advance, a choice, Start, a jump from the
Chapters menu or a `?at=` deep link. Everything else is *replayed*: Skip, Back, a load (Continue, a slot, quick load),
a rewind from the backlog, holding Space, a Studio `goto`. Reduced motion does not make a stop replayed: the picture
cuts, the sound does not.

- `VNScore.cue(state, op, program, hints)` then `VNAudio.sync(cue, {instant})`, once per stop, in `present()` right after
  the world is set. `hints = {hour, indoor}`: `hour` is `VNArt.timeOf(bg.name, bg.mod)` (`day|dusk|dawn|night`, or `null`
  without the art), `indoor` is true when `VNArt.INDOOR` has the background. `instant` is true for a replayed stop
  (cut, do not crossfade) and false when reading forward. The cue is opaque to the stage; it is kept in
  `__vnStage.S.cue`. A `null` cue (or no score module) is passed on as `null`.
- The title screen has a cue too: `cue(titleState, {kind: 'title', line: 0}, program, {hour, indoor, title: true})`,
  where `titleState` is the first background with no cast, `music: 'auto'`, `ambience: 'auto'`, then `sync(cue, {instant: false})`.
  It is sent again after the opening has been replayed from the title menu. `{kind: 'title'}` is not a script op: a
  score that only knows the script's kinds can treat it like any other stop.
- `VNAudio.sync(null, {instant: false})` when the story leaves the stage (the picker, a script that will not load or
  play): everything should fade out.
- `sync` can arrive before `unlock` (the title cue always does): keep the cue and start it when unlocked.
- `VNAudio.sfx(name)` for each name in `state.sfx`, after `sync`, only when reading forward.
- `VNAudio.sting('chapter')` at a chapter card and `VNAudio.sting('end')` at the end card, only when reading forward.
- `VNAudio.hold(true)` when a menu is shown, `hold(false)` when the reader chooses or the menu goes away any other way
  (Back, a load, the title screen). Never twice in a row with the same value.
- `VNAudio.unlock()` in the handler of a trusted event (`ev.isTrusted`) that leads into the story: the title menu's
  Start, Continue, Chapters, Load, Log and Opening, a slot or chapter picked from a full-screen menu, quick load, the key
  or click or swipe that advances the story, a choice. It is called on every such gesture, so it must be cheap when
  the sound is already running. Never under `?thumb=1`, `?autoplay=`, `click=` or `?audio=0`: such a run never causes an
  `AudioContext` to be constructed by the stage's doing.
- `VNAudio.voice(castKey, ch)` for each visible (non-space) character the typewriter types, only when the pref `babble`
  (Voices) is on, only for a `say` line that is not a thought. Never when the line appears at once.
- `VNAudio.volumes({music, ambience, sfx, voice, mute})` once at boot and at every change (the Config sliders, the Mute
  switch, the quick-menu button, the `M` key).
- `VNAudio.suspend()` when the tab is hidden, `resume()` when it is visible again.

**Painting.** `VNPaint.mount(layerEl, svgString, key)` right after the markup of `.vn-bg` or `.vn-cgart` is set (also at
the title screen), when the pref `paint` is on. `layerEl` is the layer itself, `svgString` the exact markup just put in
it, `key` names the picture: `<bg|cg>|<name>|<mod or empty>|<options>`, the options as `k=v` pairs sorted by key and
joined with commas, weather included: `bg|lab|night|`, `bg|room|night|overcast=true`, `bg|classroom|dusk|board=text,overcast=true`,
`cg|tree||`, `cg|screen-code||text=total_count`. The same key always means the same SVG. The layer also carries the key
as `data-paint`.

- The module puts one `<img class="vn-painted">` INSIDE the layer, after the SVG. `vn.css` already lays such an image
  exactly over the SVG (`position: absolute; inset: 0; width/height: 100%; object-fit: cover`, the same crop as the SVG's
  `xMidYMid slice`), so the transition snapshot (`world.cloneNode(true)`) carries it and the title zoom moves it.
- A new picture replaces the layer's markup, which removes the old image with it; a second `mount` on a layer supersedes
  the first. The promise must settle once the image is in place (or the work was abandoned). If it settles after its
  picture was replaced, cleared or switched off, the stage removes whatever painted image it left in the layer; a
  module should still compare its key with the layer's `data-paint` before inserting.
- `VNPaint.unmount(layerEl)` when a layer that had a painting is emptied (`@cg off`, the world cleared), and on both
  layers when the pref is switched off. Switching it on again mounts the pictures that are up.
- `VNPaint.setEnabled(bool)` at boot and when the pref changes. No `mount` is sent while it is off.

**Living cast.** `VNLive.attach(actorEl, castDecl)` whenever a `.vn-actor` is created or its sprite markup is replaced
(the element is already in `.vn-sprites` and has its classes); `castDecl` is `program.cast[key]`, the parsed `@cast`
declaration (see *Program*), or `{id, key, name, hue, skin: 3, hair: 'short'}` for a speaker that was never declared.
A change of face only toggles `is-on` on the `.vn-face` groups and is not announced. `VNLive.detach(actorEl)` when the
actor leaves (before its fade-out; the element is removed 520 ms later) and for every actor when the world is cleared.
`VNLive.speak(castKey, true)` when a `say` line that is not a thought starts typing, `speak(castKey, false)` when it
completes, is skipped or is replaced; never when the line appears at once. The clone of the world held by `.vn-trans`
during a transition is never attached.

**Camera.** `VNCamera.attach(stageEl)` once at boot. `VNCamera.present(state, op)` once per stop in `present()`, after
the world, the cue and the sound effects. `VNCamera.reset()` whenever the world is cleared (the title screen, a new run,
the picker) and when a full-screen menu opens; when that menu closes on the same stop, `present(state, op)` is sent
again between `setEnabled(false)` and `setEnabled(true)`, so the framing comes back without a move. Mind that
`.vn-world` already uses `transform` for `@fx shake` / `pulse` and `filter` for the grade (so the camera never
transforms `.vn-world` itself, only what is inside it).
What it does: the planes follow the pointer by a few pixels (eased, time constant 480 ms; the background least, the
cast more, the weather in front most); on a screen with no hover it drifts very slowly by itself (no sensor is read).
A `say` or `narrate` line of at least 90 characters gets a slow push-in to scale 1.03 over about nine seconds, which
settles back on the next line; a CG pans slowly across (28 s) and holds, and a second CG pans back the other way.
`reset()` holds the framing at rest until the next `present`.

**setEnabled, and the settled states.** `VNLive` and `VNCamera` are enabled when their pref is on and motion is wanted
at all: Config > Effects on, no `prefers-reduced-motion`, not the text-only transcript. Around a replayed stop they are
told to rest and then to move again: `setEnabled(false)`, then the calls of that stop (`attach`, `detach`, `present`),
then `setEnabled(true)`; during Skip they rest until Skip ends. The other calls always flow, enabled or not, so a
module can keep track; each module is told only when its value changes, and once at boot.

**Opening.** `VNOp.available(program)` when a title screen is drawn and when Start is pressed. `VNOp.play(program, stageEl,
{audio: window.VNAudio || null, cue: S.cue})` (`cue` is the title's cue, so the movie can start the theme from its
first bar; both are `null` under `audio=0`) when the reader presses Start (a fresh run: not Continue, not a load, not a deep
link, not Restart or Replay, not a test hook), the pref `opening` is on and `available` answered true; the first stop
is presented when the promise settles. The title menu gains an item "Opening" (`button[data-t="opening"]`, shown when
`available` answers true) that plays it again and returns to the title. A menu of more than six entries (Opening,
Continue and Chapters together, or Continue and Chapters alone) is set in two columns (`.ts-menu.is-tall`). It never plays in a settled state (reduced motion, Effects off), and
then the menu item is not shown.
While it plays: `#stage` has the class `op-playing`, the world is empty (Start) or the title screen is underneath
(replay), the stage's quick menu, top bar and toasts are hidden, and the stage ignores its own keys and pointer, so
the module handles its own skip. Three keys stay with the stage: `F` (fullscreen), `M` (mute) and `Escape`, which
always ends the wait: the stage calls the optional `VNOp.stop()` and goes on. `stop()` is also called if the stage
has to move on underneath a movie (a Studio reload). An overlay should sit above `.vn-titlescreen` (z-index 13) and
below `.vn-screen` (20).
What it plays (about 21 s, every cut on the beat of the story's theme): black and a line of light; the title set
large; four or five cuts through the story's own backgrounds and CGs in script order, with the title in a vertical
column and the cast roll from `program.cast`; the chapter titles; the title once more over the first picture; and the
source as ORIGINAL WORK with "Dialogue is dramatized" (left out for a story that is the post itself, `@read`). Only
type, pictures and light move (opacity, blur, a slow scale); nothing spins or bounces. A story needs a title and at
least two pictures. It is skipped by a click or tap, Enter, Space, Escape or the Skip button (a second click of the
double click that pressed Start, within 300 ms, does not count). Under reduced motion (only reachable with `op=1`)
it is one still card for three seconds. When the audio object can, the theme is restarted with the movie (`sync`
without a track, then the title cue) and the cuts fall on its beat; the first stop's cue takes over on the next bar
line after the movie ends. Pictures are painted ahead (`VNPaint.prepare`, same keys as the stage) when painting is on.

### Capture and test runs, and the URL hooks

Under `?thumb=1` and `?autoplay=` every module rests: `VNPaint`, `VNLive` and `VNCamera` are told `setEnabled(false)`
once at boot and then never called; `VNScore`, `VNAudio` and `VNOp` are not called at all. A thumbnail or an autoplay
run therefore looks and behaves as if no module were loaded, unless a hook says otherwise:

| Hook | Effect |
|---|---|
| `paint=1` `live=1` `camera=1` | That module is on whatever the prefs and the settled-state rule say: enabled, and called, under autoplay, thumb, reduced motion, Effects off, Skip, Back and Load too. |
| `op=1` | The opening plays whatever the pref and the settled-state rule say: at Start, under the `click=` hook, and before the first present of an `?autoplay=` or `?thumb=1` run. |
| `audio=1` | Under `?autoplay=` and `?thumb=1` the cue is computed and `sync`, `hold` and `volumes` are sent (always `instant: true`). The sound is still never unlocked there. |
| `paint=0` `live=0` `camera=0` `op=0` | That module is treated as absent: never called, no Config row, no title-menu item. |
| `audio=0` | No sound: `VNScore` and `VNAudio` are never called (so never unlocked), no Config rows, no mute button, `VNOp.play` gets `audio: null`. |

The Config rows and the quick-menu Mute button appear whenever the module is loaded, in a test run too, so
`?autoplay=5&screen=config` shows the full screen; there the switches change the prefs and call nothing.

### Config, quick menu, keys

Shown only when the module's global exists at boot: sliders `#cf-music`, `#cf-ambience`, `#cf-sfx` (Music, Ambience,
Sound effects) and the switches `button[data-sw="mute"]` (Mute) and `[data-sw="babble"]` (Voices) with `VNAudio`;
`[data-sw="paint"]` (Painted backgrounds) with `VNPaint`; `[data-sw="live"]` (Living cast) with `VNLive`;
`[data-sw="camera"]` (Camera) with `VNCamera`; `[data-sw="opening"]` (Opening movie) with `VNOp`. With the sound rows the
screen is set in two columns (`.vn-config-cols`); with no module it is exactly the one column it was. With `VNAudio`
the quick menu has `button[data-q="mute"]` and `M` toggles mute.

## Studio preview (`?src=draft:<key>`, `?studio=1`)

`?src=draft:<key>` reads the script from `localStorage['vn:studio:<key>']` instead of fetching a file. The program id
is `src:draft:<key>`; `@include` paths resolve against `stories/`; a missing key shows the same "Could not load the
story" panel as a missing file. It works with every other parameter (`at`, `autoplay`, `cast=1`).

`?studio=1` makes the stage a live preview for a Studio page on the same origin (another window, or the frame around
it). Nothing is kept: no autosave, no save slots, no memory of what was read; every chapter is open; and the stage never
takes the keyboard focus out of the page around it. It listens and answers on `BroadcastChannel('vn:studio')`:

| Message | Meaning |
|---|---|
| in `{type: 'reload'}` | Read the source again, parse it, and return to the source line the stage was on (the title screen if it was there). |
| in `{type: 'goto', line}` | Go to the first stop at or after that source line. A caret on a continuation line, or on any option of a menu, belongs to the statement it is part of. |
| in `{type: 'goto', label}` | Go to the first stop at or after that label. An unknown label only shows a toast. |
| out `{type: 'ready', title, issues}` | After every load and reload, before any stop. `issues` is `VN.lint(program)` as `[{level, line, msg, code}]`. A source that cannot be read gives `title: null` and one issue `{level: 'fatal', line: 0, msg, code: 'load-failed'}`. |
| out `{type: 'stop', line, index, kind}` | After every present: the source line, op index and kind of the stop on show. |

`goto` uses `VN.routeTo()` to the op index (the reader's own choices first) and `run.replay()`, so the moment is an
ordinary one; a stop that no choices reach falls back to `run.jumpTo()`. It presents the stop at once (as a replayed
stop). While a script has a fatal issue the stage shows its panel, posts `ready` and no `stop`, and ignores `goto`
until a reload parses.

## Presenter view (`presenter.html`, `P`)

`P` (a real key press, not while typing in a field) opens `presenter.html` in a window named `vn-presenter` with the
parameter this story was opened by: `?story=<id>`, `?src=<path>`, `?src=draft:<key>` or `?post=<slug>`. The stage and
the presenter talk on `BroadcastChannel('vn:presenter')`; the presenter rebuilds lines, notes (`op.note`) and what comes
next from the script itself (`VN.parse`, then `run.replay(choiceLog, stopIndex)`), so the stage sends positions, never text.

| Message | Meaning |
|---|---|
| out `{type: 'stop', id, src, hash, choiceLog, stopIndex, index, line, kind, done}` | After every present. `id` is the program id, `src` the `?src=` value or `null`, `hash` is `program.hash`, `choiceLog` and `stopIndex` are what `run.replay()` takes, `index` and `line` locate the op, `done` is true on the end card. |
| out `{type: 'title', id, src, hash}` | When the title screen opens. |
| in `{type: 'hello'}` | Answered with the latest `stop` or `title` message (nothing while no story is open). |
| in `{type: 'advance'}` | The reader's own advance: the first one completes a line that is still typing. Ignored at a menu, at the title screen, and while a full-screen menu is open. |
| in `{type: 'back'}` | One stop back. |
| in `{type: 'choose', i}` | At a menu: take visible option `i` (0-based). |

A message that carries an `id` is taken only by the stage playing that program, so two stages in one browser do not
both move. Remote messages never unlock the sound.

The presenter side: `presenter.js` loads `vn.js` and the same script by the stage's rule (manifest entry, `?src=`,
`?src=draft:<key>`, `?post=`; with no parameter it reads what the stage announces). It shows the stop on show, the
stop after it (looking through pauses; at a menu, where each option leads), `op.note`, chapter and position, a timer
that starts with the first advance (not with Start, not with a pause the stage passes itself) and the wall clock.
Keys: Right, Space, Enter or Page Down next; Left or Page Up back; 1 to 9 choose; R resets the timer. It sends
`hello` every 2 s while no stage answers and every 5 s, with the story id, while it follows one; 12 s of silence
means the stage is gone. When `hash` differs from its own it reads the script again once and then warns. Test hook:
`window.__vnPresenter = {P, render, load, fit}`.
