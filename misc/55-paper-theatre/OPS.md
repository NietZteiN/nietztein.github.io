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
VN.interpolate(text, vars, cast) -> string     (render-time {var} / {Name} substitution)
VN.markup(text)             -> [{type:'text'|'em'|'code', text}]
VN.refs(op)                 -> ['§4', ...]     (unique chips on an op: trailing ref + fact chips)
VN.describeRef(ref)         -> 'quoted from the source, section 4'   (abbr title text)
VN.bibtex(meta)             -> string | ''     (needs meta.arxiv)
VN.hash(str)                -> uint32 fnv1a;  VN.hashHex(str) -> 8 hex chars
VN.rng(seed)                -> () => [0,1)    mulberry32; seed may be a number or a string (hashed)
VN.isThought(text)          -> bool            (the whole line is wrapped in ( ) or （ ）)
VN.FACES, VN.BACKGROUNDS, VN.BG_MODS, VN.PALETTES, VN.SLOTS, VN.HAIR, VN.CLOTHES, VN.TRANSITIONS, VN.DEFAULT_TRANSITION,
VN.FX, VN.FX_ONESHOT, VN.CGS, VN.TONES, VN.DISTANCES, VN.MODES  (constant lists / maps)
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

| kind | fields |
|---|---|
| `say` | `who` (cast id as declared), `key` (lowercase), `face` (one of FACES or null), `text`, `ref`, `chips`, `refs` |
| `narrate` | `text`, `ref`, `chips`, `refs` |
| `bg` | `name` (one of BACKGROUNDS; unknown names are kept as written, lint warns, renderer falls back to `void`), `mod: 'night'|'dawn'|'dusk'|'noon'|'dim'|null` |
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
| `cg` | `name: string|null` (null = `@cg off`; unknown names are kept, lint warns, the renderer draws an abstract fallback), `caption: string|null` |
| `pause` | `ms` (default 800, capped at 10000). A beat with no text; a stop that continues by itself. |
| `tone` | `name` (one of TONES: `none dusk night dawn noon memory cold`; unknown names become `none` with a warning) |
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
Non-blocking: `bg show move hide transition flashback mode page fx cg tone goto set add if label thumb`.
`walk()` treats every new op as a plain step (no branching); `pause` and `menu` stops are not recorded in `state.history`.

## Issues

```
Issue = { level: 'fatal'|'warn', line: number, msg: string, hint: string, code: string, file?: string }
```

Codes (fatal): `kind-missing`, `unknown-jump`, `option-no-target`, `show-undeclared` (also `@move` of an undeclared name), `show-malformed`, `move-malformed`, `if-malformed`, `option-malformed`.
Codes (warn): `title-missing`, `cite-missing`, `speaker-undeclared`, `face-unknown`, `bg-unknown`, `numeric-literal`, `chip-in-branch`, `coauthor-unchipped`, `chart-literal`, `fact-no-ref`, `include-missing`, `placeholder-unknown`, `directive-unknown`, `status-unknown`, `palette-unknown`, `slot-unknown`, `links-extra`, `header-after-body`, `no-chips`, `unreachable-label`, `walk-loop`, `walk-cap`, `set-malformed`, `menu-empty`, `bg-mod-unknown`, `transition-unknown`, `transition-malformed`, `fx-unknown`,
`fx-malformed`, `cg-unknown`, `cg-malformed`, `tone-unknown`, `mode-unknown`, `flashback-malformed`, `pause-malformed`, `chapter-malformed`.
The four `*-unknown` name warnings list the valid names in `hint`.

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
run = VN.createRun(program, {seen: number[] = [], instant: bool})
run.state = {
  pc: number, vars: {}, bg: {name, mod}|null,
  slots: {left: key|null, center: key|null, right: key|null},
  faces: {[key]: face}, dist: {[key]: 'near'|'far'},     // dist has no entry for the default distance
  chosen: {['menuIndex:optionIndex']: true},
  cg: {name, caption}|null,             // the event illustration on screen (hides background and sprites)
  transition: {name, ms}|null,          // armed by @transition, consumed by the next bg / cg op
  change: {bg?: {name, ms}, cg?: {name, ms}}|null,   // what changed on the way to THIS stop and with which transition
                                        // (dissolve 600 when none was armed); null when neither changed. A @bg and a @cg
                                        // between the same two stops each keep their own; the stage plays the cg's.
  flashback: {caption: string|null}|null,
  mode: 'adv'|'nvl', pageStart: number, // NVL page = say/narrate rows of history[pageStart..]; @page and @mode reset it
  fx: {[name]: true},                   // persistent particle layers that are on
  oneshot: string[],                    // shake/flash/pulse fired on the way to this stop (cleared at the next advance)
  tone: string,                         // 'none' by default
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
                                     (bg cg show move hide flashback mode page fx tone set label) that precedes the
                                     target in file order, so the stage is dressed; one-shots and transitions are dropped.
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
`state.faces[key]`; `say` with a face also updates `state.faces[key]`; `hide` clears slots; `label` -> state.label;
`set`/`add` -> vars (`add` on a missing or non-numeric var starts from 0). `show` also sets or clears `state.dist[key]`;
`move` re-slots without touching face or distance; `transition` -> state.transition; `bg`/`cg` -> state.bg / state.cg and
`state.change.bg` / `state.change.cg`; `flashback`, `tone` -> same-named state; `mode` -> state.mode (+ pageStart when it
changes); `page` -> pageStart; `fx` -> state.fx (persistent) or state.oneshot (one-shot); `fx none` empties state.fx.

## blog() output

`VN.blog(markdownText, meta, {max = 24, speaker = 'Page', who = 'Page'})` returns `ops[]` (`line: 0`):

- front matter dropped; a heading equal to `meta.title` dropped; other headings -> `scene{title}`
- paragraph -> `narrate{text, ref: '¶n'}` (n = 1-based block number in the post, the chip is the paragraph)
- first block shaped like an epigraph (quoted line + attribution line without terminal period) -> `say{who:'Page', key:'page', face:null}` for the quote and `narrate` for the attribution
- blockquote -> `say{who: 'Page', key: 'page'}`
- list (ordered or bulleted) -> `label{name:'read_n'}`, `menu` whose options (all `once`) jump to `read_n_i`; each
  section is `label`, one `narrate` per item (nested items joined into the item), `goto read_n`; a last option
  "Continue" jumps to `read_n_done`; `label{name:'read_n_done'}`
- image `![alt](src)` -> `card{title: 'Figure', cells: [{label: null, value: alt}], src}`
- fenced code blocks dropped, HTML comments and tags dropped, links reduced to their text, inline markdown stripped
- KaTeX delimiters (`$...$`, `$$...$$`, `\(...\)`, `\[...\]`) are left exactly as written
- after `max` blocking ops the rest is cut and a final `narrate` says the post continues (`truncated` flag on it)
- no `end` op is appended; the caller continues its own script after the expanded region

`VN.expand(program, markdownText, meta)` returns a copy of the program with every `read` op replaced by the blog ops,
`labels`/`menus`/`thumb` re-indexed. The cast gains a `page` decl (`key 'page'`) if the script has none.

## Stage contract (stage.js)

The stage reads only the Stop and its state. For each stop it: brings the painted world to `state` (background or CG,
sprites keyed by cast key with slot, distance, face and speaker light, particle layers from `state.fx`, `data-tone`,
flashback grade/bars/caption), plays `state.change` as a transition (the old picture is held on a layer above the new
one), fires `state.oneshot`, then shows the op: `say`/`narrate` in the ADV window or on the NVL page by `state.mode`,
`chapter`/`scene` cards, `pause` (auto-continues after `ms`), boards, menu, end.

Everything animated has a settled state: under `prefers-reduced-motion`, `?thumb=1`, `?autoplay=`, Skip, Back, Load
and with Config > Effects off, transitions are cuts, one-shots are skipped, the typewriter is instant and (reduced
motion / thumb) particles stand still.

Saves: `vn:<id>` is the autosave (`run.snapshot()` + `ts`), `vn:slots:<id>` is `{1..6, q}` of
`{hash, choiceLog, stopIndex, pc, ts, chapter, text}`; loading is `run.replay(choiceLog, stopIndex)`. `vn:prefs` is
`{cps, autoSpeed, opacity, effects, size, textOnly}`.

Test hooks (URL): `autoplay=N|end` (instant, no autosave), `pick=K` (option K at menus), `screen=save|load|config|log|chapters|title`,
`trans=<name>` (freeze that transition half-way into stop N), `thumb=1`, `cast=1`, `gallery=bg|cg` (`&mod=night`, `&only=a,b`).

Art entry points (art.js, with art-scenes.js and art-cast.js loaded first): `VNArt.background(name, mod)`,
`VNArt.cg(name)`, `VNArt.sprite(castDecl, face)`, `VNArt.fx(name)`, `VNArt.timeOf(name, mod)` -> `day|dusk|dawn|night`,
`VNArt.sharedDefs()` (the one hidden `<svg>` of filters every scene and sprite refers to; inject once per page).

Sprites (art-cast.js): `VNArt.sprite` reads `build` (or the flags `fem` / `masc`) and `hairhue` from the cast
declaration; `normCast` returns `build: 'fem'|'masc'|'neutral'` and the hair palette (`hairCol`, `hairDark`,
`hairLight`, `hairTip`, `hairLine`). A person sprite is `<svg class="vn-sprite" data-kind="person" data-build data-hair
data-clothes>` with one top-level `<g filter="url(#vnf-rim)">` (the stage swaps the filter for the hour: an inner rim
light on the edge that faces the light, a soft contact shadow, the hour's tint) and eight `<g data-face>` groups.
