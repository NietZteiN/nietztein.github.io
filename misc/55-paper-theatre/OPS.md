# Paper Theatre op contract (vn.js)

Published by Agent A. `vn.js` is a UMD module: `window.VN` in the browser, `module.exports` in Node.
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
VN.FACES, VN.BACKGROUNDS, VN.PALETTES, VN.SLOTS, VN.HAIR  (constant lists / maps)
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
  hair: 'short'|'long'|'bun'|'curly'|'none'|'hood',
  glasses: bool, hat: bool,
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

| kind | fields |
|---|---|
| `say` | `who` (cast id as declared), `key` (lowercase), `face` (one of FACES or null), `text`, `ref`, `chips`, `refs` |
| `narrate` | `text`, `ref`, `chips`, `refs` |
| `bg` | `name` (one of BACKGROUNDS; unknown names are kept as written, lint warns, renderer falls back to `void`), `mod: 'night'|'dawn'|'dim'|null` |
| `show` | `who`, `key`, `slot: 'left'|'center'|'right'|null` (null = first free slot), `face: string|null` |
| `hide` | `who`, `key`, `all: bool` (`@hide all`) |
| `scene` | `title` |
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

Blocking stops: `say narrate menu scene card chart code withheld read end` (plus synthetic `error`).
Non-blocking: `bg show hide goto set add if label thumb`.

## Issues

```
Issue = { level: 'fatal'|'warn', line: number, msg: string, hint: string, code: string, file?: string }
```

Codes (fatal): `kind-missing`, `unknown-jump`, `option-no-target`, `show-undeclared`, `if-malformed`, `option-malformed`.
Codes (warn): `title-missing`, `cite-missing`, `speaker-undeclared`, `face-unknown`, `bg-unknown`, `numeric-literal`, `chip-in-branch`, `coauthor-unchipped`, `chart-literal`, `fact-no-ref`, `include-missing`, `placeholder-unknown`, `directive-unknown`, `status-unknown`, `palette-unknown`, `slot-unknown`, `links-extra`, `header-after-body`, `no-chips`, `unreachable-label`, `walk-loop`, `walk-cap`, `set-malformed`, `menu-empty`.

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
  faces: {[key]: face}, chosen: {['menuIndex:optionIndex']: true},
  history: [HistoryEntry], choiceLog: [{menuLine, menuKey, menuIndex, optionIndex}],
  label: string|null, stops: number         // stops = count of stops reached so far (1-based index of the current one)
}
HistoryEntry = {index, kind, who|null, text, refs, title?}  |  {kind:'choice', menuIndex, optionIndex, text}

run.advance()          -> Stop       executes non-blocking ops until a blocking op; at a menu it returns the same
                                     menu stop again (call choose); after `end` returns the end stop with done:true
run.choose(i)          -> Stop       i = index into stop.options (the visible list); records choiceLog, then advance()
run.back()             -> Stop|null  pops the snapshot stack (max 500) and returns the previous stop
run.jumpTo(labelOrIdx) -> Stop       sets pc (label name or op index), keeps vars, then advance(). On a fresh run
                                     (no stop yet, i.e. a ?at= deep link) it first applies every bg/show/hide/set
                                     op that precedes the target in file order, so the stage is dressed.
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
`set`/`add` -> vars (`add` on a missing or non-numeric var starts from 0).

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
