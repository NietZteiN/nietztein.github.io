# Writing a Paper Theatre story

Every file in this folder that ends in `.vn` is a story: a plain-text script the
engine at `misc/55-paper-theatre/` plays as a two-to-four-minute visual novel.
Papers and blog posts share one dramaturgy: a hook, a question, a bet the reader
makes, the result as the source printed it, a citation card.

`index.json` beside the scripts is **generated**. Do not edit it by hand except
in an emergency; run `scripts/build-vn-index.mjs` (below) or push and let the
Action rebuild it.

Files whose name starts with `_` (such as `_facts/obfuscation.vn`) are shared
fact tables pulled in with `@include`; they are not stories and never appear in
the picker.

## Quick start

```text
"C:\Program Files\nodejs\node.exe" scripts/build-vn-index.mjs --scaffold-post latentland
"C:\Program Files\nodejs\node.exe" scripts/build-vn-index.mjs --scaffold-paper unlearning --title "Router-Free Modular Storage for Knowledge Unlearning" --abstract abs.txt
```

Each writes a draft under `stories/` (`blog-latentland.vn`, `unlearning.vn`)
and refuses to overwrite a file that already exists. Open the draft in any
editor, preview it (see *Previewing*), read the in-page error panel, run
`test.js`, push.

## File shape

One statement per line. UTF-8, LF or CRLF, BOM tolerated. `#` starts a comment.
A line that begins with whitespace continues the previous line (joined with a
space), which is how long speeches stay readable. Header directives come first;
the first line that is not a directive or comment starts the body.

```text
@title Do Machines Struggle Where Humans Do?
@kind paper
@source paper:LLM and Human Comprehension of Obfuscated Code
@cite J. V. Le†, A. Nguyen†, T. Nguyen (2026). ... arXiv:2606.31725 [cs.SE]. Submitted to FSE.
@arxiv 2606.31725
@link https://arxiv.org/abs/2606.31725 Read the paper
@authors Jack V. Le† and Anh Nguyen† (co-first), Tien Nguyen
@status draft
@verify
@palette slate
@include _facts/obfuscation.vn
@cast Jack hue=210 glasses
@cast Model name="a reasoning-tuned model" lattice=sparse hue=192
@cast You player hue=20

@bg lab
@show Jack left
Jack: Obfuscation is almost always measured without people. ^§1
Jack (smile): Before the numbers, place a bet.
* Harder tier, lower accuracy. Always. -> bet_monotonic
* It depends on the language. -> bet_language

== bet_monotonic
You: More obfuscation, more pain.
-> humans

== bet_language
You: JavaScript and Python will not break the same way.
-> humans

== humans
Jack: Overall, accuracy fell from {human_l0} at L0 to {human_l3} at L3. ^§4
@end
```

## Directives

### Header (before the first body line)

| Directive | Meaning |
|---|---|
| `@title text` | Story title. Required. |
| `@kind paper` or `@kind blog` | Required. Drives the lint rules and the picker grouping. Missing `@kind` is fatal. |
| `@source paper:<substring>` | Provenance for a paper. The substring must appear in the title (`.pub-block .h5`) of one publication in `index.html`; `test.js` checks this, and the builder uses it to order papers the way the publication list does. |
| `@source blog:<slug>` | Provenance for a post. The engine fills title, date and a "Read the post" button from `../../blog/index.json`; an unindexed slug falls back to `@title` (and to `../../blog/posts/<file>` when `@file` is given). |
| `@source free text` | Anything else (shown verbatim). |
| `@cite text` | Citation printed verbatim on the end card. Required for `@kind paper` once the story is not a draft. Copy the venue string from `index.html` exactly ("Submitted to FSE"), never upgraded. |
| `@arxiv 2606.31725` | Enables "Copy BibTeX" (built client-side from `@title`, `@authors`, `@arxiv`, year). |
| `@link url [label]` | End-card button, up to two. Default labels "Read the paper" / "Read the post". |
| `@authors text` | Credits line in paper order, with `†` notes. Coauthors live here and are never voiced (see *Accuracy rules*). |
| `@note text` | End-card disclaimer. Default: "Dialogue is dramatized; coauthors did not say these lines. Figures marked § are quoted from the source." |
| `@status draft` / `embargo` / `published` | Lifecycle, see below. Default `draft`. |
| `@palette slate\|paper\|ink\|night\|ochre\|moss` or `@palette hue=210` | Colour family. Default hue is hashed from the story id. |
| `@cast Name [options]` | Declares a speaker, see *Cast*. |
| `@fact key = value ^§ref` | A sourced figure. `{key}` anywhere interpolates the value and attaches its chip. The end card lists every fact used under "Figures used". |
| `@include _facts/name.vn` | Merges another file's `@fact` lines. `test.js` parses included files too. |
| `@verify` | Marks every fact in the file unverified: the end card draws an "unverified draft" ribbon. Remove it only after checking each figure against the source. |

### Body

| Line | Meaning |
|---|---|
| `Name: text` | Speaker line. `Name` must be a declared `@cast` (case-insensitive); otherwise the line is treated as narration and the panel shouts `line 12: 'Result' is not in @cast; treated as narration`. |
| `Name (face): text` | Speaker line with a face: `neutral`, `smile`, `puzzled`, `worried`, `surprised`, `thinking`, `deadpan`, `laugh`. |
| `plain text` | Narration (italic box, no name tag). |
| `  continuation` | Indented: joined to the previous line. |
| `... ^§4` / `^p.2` / `^¶3` / `^para` | Trailing citation chip. `§`/`p.` point at a section or page of the source, `¶` at a paragraph of the post (¶1 is the epigraph when the post has one), `para` means "paraphrase of the source" (the only chip allowed on a coauthor's line besides `^§`). |
| `*em*`, `` `code` ``, `{key}`, `{Name}` | Inline markup. `{key}` resolves facts first, then variables; `{Name}` is a cast member's display name. |
| `@bg name [night\|dawn\|dim]` | Background, see *Backgrounds*. Unknown names fall back to `void` with a warning that lists the valid names. |
| `@show Name [left\|center\|right] [(face)]` | Puts a sprite in a slot (first free slot when omitted). Showing an undeclared name is fatal. |
| `@hide Name` / `@hide all` | Removes sprites. |
| `@scene Title` | Full-stage title board (chapter break). Slides in through the frame; cuts under reduced motion. |
| `@card Title \| cell \| cell` | Fact card. Cells may be `label: value` pairs. |
| `@chart bar\|range Title \| label=value \| label=lo..hi [unit=%]` | SVG chart from numbers in the script. Every value must be a `{fact}` or carry a chip. Renders with a visually hidden text table. |
| `@code lang \| line \| line` | Monospace code card. Only code the source itself shows. |
| `@set x = value` / `@add x 1` | Variables (strings or numbers). |
| `@if x == v -> label`, `@if x != v -> label`, `@if x -> label`, `@if !x -> label` | Conditional jump. Equality only; there is no expression evaluator. Malformed `@if` is fatal. |
| `* option text -> label` | Choice. Consecutive `*` lines form one menu. Prefix `(once)` hides an option after it was taken; `(if x == v)` shows it conditionally. A menu with no visible option is a runtime error; an option without a target is fatal. |
| `== label` | Section header. Falls through unless jumped over. The engine writes `#label` into the URL hash so a moment can be shared. |
| `-> label` / `-> end` | Jump. Unknown target is fatal. |
| `@thumb` | Marks the stop that `?thumb=1` jumps to for the thumbnail. One per story. |
| `@withheld [text]` | Shows the embargo card ("Results withheld until the paper is public"), then the end card. Used in `@status embargo` stories. |
| `@read post [max=N]` | Inlines the blog post as narration (Tier B). Headings become scene boards, lists become a hub menu. Default max 24 paragraphs. |
| `@end` | End card. End of file also ends the story. |

## Cast

```text
@cast Jack hue=210 glasses
@cast Model name="a reasoning-tuned model" lattice=sparse hue=192
@cast You player hue=20
@cast Schiller page name="Friedrich Schiller"
```

Options, all optional and in any order after the name:

- `name="Display Name"`: what the name tag shows; the bare name is what you type before the colon.
- `hue=N` (0-359): body colour. `skin=1-5`: a five-step neutral ramp (default hashed from the name).
- Hair: `short`, `long`, `bun`, `curly`, `none`, `hood`. Accessories: `glasses`, `hat`.
- `lattice=sparse` or `lattice=dense`: the model character, a head-and-shoulders silhouette of nodes and edges. `sparse` has fewer nodes with some long-range edges (the reasoning-tuned regime), `dense` a regular grid with short edges (coder- and instruction-tuned). Name it after its regime, never after a product.
- `player`: back-of-head silhouette, the reader ("You").
- `page`: a floating ruled sheet, for quotations and epigraphs.
- `coauthor`: opts a real coauthor in as a speaker; every line they say must then end with `^§x` or `^para` (see *Accuracy rules*).

Faces: `neutral`, `smile`, `puzzled`, `worried`, `surprised`, `thinking`, `deadpan`, `laugh`. Write them as `Jack (smile): ...` or `@show Jack left (thinking)`. There are no poses in v1 (a `(point)` flag is reserved but not implemented), no idle animation, no images.

## Backgrounds

`lab`, `office`, `lecture`, `server`, `library`, `night`, `cafe`, `terminal`,
`paper`, `train`, `garden`, `void`. Each takes an optional modifier: `night`,
`dawn`, `dim`. `paper` is the default for blog and philosophical stories.
`library` draws real spines from `../../assets/data/library.json` when it loads,
with a silent fallback. Everything is inline SVG coloured through CSS variables,
so backgrounds follow the story palette and the light/dark theme.

## Chips and facts

A chip is the small `§4` tag after a line. It tells the reader that the line
quotes the source at that location, and it is what lets a story make claims at
all. Two ways to attach one:

1. Trailing `^§4`, `^p.2`, `^¶3` or `^para` on the line.
2. Interpolating a fact: `{human_l0}` pulls the value from `@fact human_l0 = 40.5% ^§4`
   and attaches `§4` automatically.

Put figures in `@fact` lines (shared across stories via `_facts/*.vn` and
`@include`) rather than typing numbers into dialogue. The end card then lists
every figure with its reference, and the number is typed in exactly one place.

**The chip rule for branches:** a chipped line must not live in a section that
is reachable only through a menu or an `@if` and that ends before a label every
branch jumps to. Choices change reactions, never reported figures. Put the
reactions in the branches and the numbers after the reconverging `== label`.

## Lint rules

Fatal (playback stops; the in-page panel names the line): unknown jump target,
choice without a target, `@show` of an undeclared name, malformed `@if`,
missing `@kind`.

Warnings (the story still runs, the panel and `test.js` list them):

- undeclared speaker (demoted to narration),
- unknown background (falls back to `void`),
- **numeric literal without a chip** (paper kind): a `say` or narration line
  containing `%`, `ρ`/`rho`, `p <`, or an integer of 10 or more and no chip,
- **chip inside a choice-dependent branch** ("choices change reactions, never reported figures"),
  A hub is exempt: a `(once)` menu whose sections jump back to the menu's own
  label can carry chips in every section, because every option is visitable.
  Only a section that never returns to its menu counts as a branch.
- a `coauthor` line that does not end with `^§x` or `^para`.

`test.js` fails a `published` paper story on any of those warnings, on zero
chips, or on a missing `@cite`.

## Status lifecycle

| Status | In the picker | Playable | Publication link |
|---|---|---|---|
| `draft` (default) | hidden unless `?drafts=1` | yes | no |
| `embargo` | listed under "Coming soon" | up to `@withheld` | no |
| `published` | listed under Papers / Posts | yes | paper stories get `<a class="pub-play">` in `index.html` |

Rules of thumb:

- A paper without text in the repo (no PDF, no pasted abstract) ships as
  `@status embargo` with `@withheld` at the result beat. Never draft a result
  from memory.
- Flip `embargo` to `draft` once the figures are in `@fact` lines with chips,
  then read it through once in the browser and in `test.js`.
- Flip `draft` to `published` only after removing `@verify` (which means every
  figure was checked against the cited source) and adding the publication link:

  ```html
  <a class="pub-play" href="misc/55-paper-theatre/?story=obfuscation" target="_blank" rel="noopener">Play the visual novel</a>
  ```

  inside the matching `.pub-block .pub-congress` of `index.html`. The link
  check (`test-links.js`, run from `test.js`) fails when a published paper has
  no link, when a draft or embargo story has one, or when the link sits in the
  wrong block. Blog stories never need a link; the blog markup is left alone.
- The command palette (Ctrl/Cmd+K) lists every non-draft story automatically
  from `index.json`, so there is nothing to wire there.

## Previewing

The engine fetches `.vn` files, so `file://` does not work; serve the site
root. Any static server does:

```text
powershell -ExecutionPolicy Bypass -File <tools>\serve.ps1 -Port 8800     # the repo's helper, or
npx serve .                                                                 # or VS Code Live Server
```

Then open, from the site root:

- `misc/55-paper-theatre/?src=stories/blog-latentland.vn` — play a script that is
  not in the manifest yet (any same-origin path works, so a scratch file is fine).
- `misc/55-paper-theatre/?story=obfuscation` — a manifest story; add `&at=models`
  (a label) or `&at=12` (a 1-based stop) to jump; `&drafts=1` lists drafts in the picker.
- `?post=latentland` — Tier B auto-read of a post without a hand-written story.
- `?theme=light` / `?theme=dark` — force the theme; `?thumb=1` — the frozen
  thumbnail state at `@thumb`; `?cast=1` — a grid of every cast trait and face.
- `&autoplay=12` / `&autoplay=end` — test hook: advance that many stops instantly
  (option 1 at every menu) or run to the end card, without saving progress.

The panel at the top of the stage shows every parser and lint issue with line
numbers; it mirrors to the browser console. Keys while playing: Space/Enter
advance, Backspace back, `L` log, `T` text-only, `A` auto, `S` skip, `H` help.

## Testing

```text
"C:\Program Files\nodejs\node.exe" misc/55-paper-theatre/test.js
```

Node is not on the PATH on this machine; always use the full path. `test.js`
parses and lints every `stories/*.vn` (and `_facts/*`), walks every branch to
`@end`, runs the blog segmenter over every `blog/posts/*.md`, snapshot-checks
the art builders, and runs the `index.html` link check. To run only the link
check:

```text
"C:\Program Files\nodejs\node.exe" misc/55-paper-theatre/test-links.js
```

## The manifest and the builder

```text
"C:\Program Files\nodejs\node.exe" scripts/build-vn-index.mjs             # rewrite stories/index.json
"C:\Program Files\nodejs\node.exe" scripts/build-vn-index.mjs --dry-run   # print it instead
```

The builder reads each `.vn` header (`@title @kind @source @cite @arxiv @link
@authors @status @verify @withheld`), takes the first narration line as a blurb
(at most 140 characters) and counts chips, then writes one object per story:
papers first in the order of `index.html`'s publication list (matched through
`@source paper:`), then blog stories by post date, newest first. Output is LF
with two-space indentation. The GitHub Action `.github/workflows/build-blog.yml`
runs it on every push that touches `stories/**` and commits the result together
with `blog/index.json`, so you normally never run it by hand.

### `--scaffold-post <slug>`

Reads `blog/index.json` (falling back to the file name in `blog/posts/`) and
writes `stories/blog-<slug>.vn`: every paragraph as a narration line ending in
`^¶n`, headings as `@scene`, an epigraph-shaped first block (a quoted line
followed by an attribution without a final period) as a `page` speaker, lists
flagged with a TODO suggesting a `(once)` hub menu, blockquotes voiced by the
`Page` speaker, and a `# from:` comment above each line carrying the original
Markdown so rewrites can be checked against the post. `¶` numbers are the
same ones `@read post` would assign: blank-line-separated blocks counted in
order, headings included, fenced code and HTML comments dropped, loose list
items merged into one block. If you delete or merge lines while rewriting,
the chips keep pointing at the right paragraph.

### `--scaffold-paper <id> --title "..." [--abstract file.txt]`

Writes `stories/<id>.vn` as a seven-beat skeleton (hook, question, bet, method,
result, meaning, citation) with `@status embargo`, `@verify`, `@withheld` at the
result beat and `TODO` markers everywhere a figure or a citation goes. With
`--abstract`, the file's sentences are copied in as `# from:` comments to chip
against. The title should be the publication title as written in `index.html`;
the scaffolder warns when it does not match a `.pub-block`.

Both scaffolders refuse to overwrite an existing `.vn`.

## Accuracy rules

These are the rules the stories live by (ENGINE-DESIGN.md section 8); most of
them are enforced mechanically.

1. **Facts table.** Figures go in `@fact key = value ^§ref` lines; `{key}`
   attaches the chip; the end card lists "Figures used"; `@verify` draws the
   unverified ribbon until the owner removes it.
2. **Numeric-literal lint** (paper kind): a `say` or narration line with `%`,
   `ρ`/`rho`, `p <`, or an integer of 10 or more and no chip is a warning;
   `published` fails on it.
3. **Chip-in-branch rule:** a chipped line inside a menu- or `@if`-only section
   is a warning ("choices change reactions, never reported figures");
   `published` fails on it.
4. **Coauthors** are credited in `@authors` and on the end card only. Voicing
   one requires `@cast Name coauthor`, and then every line by that speaker must
   end with `^§x` or `^para`. Default casts are Jack, You and abstract roles
   (the Model, the Judge, the Proctor).
5. **Draft only from text in the repo** or supplied by the owner (PDFs under
   `assets/documents`, posts under `blog/posts`, pasted abstracts). Everything
   else ships `@status embargo` with `@withheld`.
6. **No invented code, datasets, quotes or anecdotes.** Illustrative examples
   are the source's own (`_lastNSecs`).
7. **Venue strings verbatim** from `index.html` ("Submitted to FSE"), never
   upgraded; `test.js` checks that `@source paper:` matches a `.pub-block` title.
8. **The end-card note** states that dialogue is dramatized and coauthors did
   not say these lines (the default `@note`).
