# Writing a Paper Theatre story

Every file in this folder that ends in `.vn` is a story: a plain-text script the
engine at `misc/55-paper-theatre/` plays as a visual novel: a title screen, chapters,
a text window or full NVL pages, sprites, event illustrations, flashbacks, an ending.
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
| `plain text` | Narration (no name plate). A line with a colon whose prefix is not a cast name is still narration; only a single capitalised unknown word (`Result: ...`) is reported as a forgotten `@cast`. |
| `(text)` or `（text）` | An inner thought: a `Name:` line or narration whose whole text is wrapped in parentheses is set in the thought style (italic, softer colour). No new syntax. |
| `  continuation` | Indented: joined to the previous line. |
| `... ^§4` / `^p.2` / `^¶3` / `^para` | Trailing citation chip. `§`/`p.` point at a section or page of the source, `¶` at a paragraph of the post (¶1 is the epigraph when the post has one), `para` means "paraphrase of the source" (the only chip allowed on a coauthor's line besides `^§`). |
| `*em*`, `` `code` ``, `{key}`, `{Name}` | Inline markup. `{key}` resolves facts first, then variables; `{Name}` is a cast member's display name. |
| `@bg name [night\|dawn\|dusk\|noon\|dim] [overcast] [board=plot\|text\|blank]` | Background, see *Backgrounds*. The tokens after the name may come in any order. Unknown names fall back to `void` with a warning that lists the valid names. |
| `@show Name [left\|center\|right] [(face)] [near\|far]` | Puts a sprite in a slot (first free slot when omitted), optionally closer to or further from the camera. Tokens after the name may come in any order. Sprites fade and slide in. Showing an undeclared name is fatal. An entrance without a `(face)` is `neutral`: a face lasts only while the character stays on stage (see *Faces*). |
| `@move Name left\|center\|right` | Slides a sprite that is on stage to another slot (face and distance kept). |
| `@hide Name` / `@hide all` | Removes sprites (they fade out). |
| `@chapter <n> <Title>` | Chapter card: fade to black, large numeral, title, thin rule. A stop. Each chapter is listed in the title screen's *Chapters* menu once the reader has reached it. `n` is the first word (`1`, `II`). |
| `@scene Title` | A lighter title board laid over the picture (a scene break inside a chapter). |
| `@transition <kind> [ms]` | Sets the transition used by the NEXT `@bg` or `@cg` change: `fade` (through black), `dissolve` (crossfade), `white` (through white), `wipe-left`, `wipe-right`, `iris`, `blinds`, `cut`. Default `dissolve 600`. One `@transition` serves one change; when a `@bg` and a `@cg` both change before the next line, each uses its own (put the `@transition` directly before the change it belongs to) and the picture plays the CG's. |
| `@flashback on [caption]` / `@flashback off` | Memory mode: warm sepia grade, vignette, film grain, thin letterbox bars and an optional small caption (`@flashback on Spring, the study room`); a white flash on the way in and out. |
| `@mode nvl` / `@mode adv` | Text presentation. `adv` is the window at the bottom with a name plate; `nvl` is a full-screen page over the dimmed, blurred picture where lines accumulate, for monologue and essay passages. |
| `@page` | Clears the NVL page (a new page also starts at every `@mode nvl`). A page that overflows drops its oldest lines by itself. |
| `@fx <name> [on\|off]` | Persistent atmosphere layers: `petals` (sakura), `snow`, `rain`, `dust` (motes in light), `fireflies`; `@fx none` clears them all. See *Weather and particles* for where they are drawn. One-shot effects fire once on the next line: `@fx shake`, `@fx flash`, `@fx pulse`. |
| `@cg <name> [day\|dusk\|dawn\|night] [overcast] [text=identifier] [\| caption]` / `@cg off` | Full-screen event illustration that replaces background and sprites while shown: `tree`, `desk-night`, `screen-code`, `hands-keyboard`, `two-chairs`, `corridor-light`, `sea-of-points`, `page`, `window-rain`. The optional caption is shown small in a corner. An unknown name warns and draws an abstract fallback. The hour repaints the CGs that have a sky (`two-chairs`, `corridor-light`, `window-rain`, `tree`; their defaults are dusk, dusk, night, dusk); `overcast` takes the moon and stars out of the `desk-night` window; `text=` sets the one readable identifier on `screen-code` (default `_lastNSecs`; letters, digits, `_ $ .`, no spaces). |
| `@pause <ms>` | A beat with no text (default 800). Continues by itself; a click skips it; instant under Skip, autoplay and reduced motion. |
| `@tone <name>` | Colour grade for the whole picture until changed: `none`, `dusk`, `night`, `dawn`, `noon`, `memory`, `cold`. |
| `@music <track>` / `@music auto` / `@music off` | The music from here on: `theme`, `nocturne`, `tender`, `memory`, `cold`, `tension`, `bright`, `finale`. `auto` (the default) lets the score choose from the scene, `off` is a silence. See *Sound*. |
| `@ambience <name>` / `@ambience auto` / `@ambience off` | The air of the place under the music: `rain`, `wind`, `sea`, `train`, `hum`, `crowd`, `night`, `room`. `auto` is the default. |
| `@sfx <name>` | One sound as the next line appears: `page`, `chime`, `door`, `keys`, `thud`, `bell`, `click`. |
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
| `@read post [max=N]` | Inlines the blog post as narration (Tier B). Headings become scene boards, lists become a hub menu (nested items are stops of their own inside their section), and a paragraph too long for the text window is cut into several stops at sentence ends. Default max 24 paragraphs. |
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
- Hair: `short`, `long`, `bob`, `ponytail`, `bun`, `curly`, `none`, `hood`. Accessories: `glasses`, `hat` (a beret).
- `hairhue=N` (0-359): hair colour. Without it the hair is one of a few natural dark tones, always the same one for
  a given name. Brows and lashes follow the hair.
- `hairtone=dark|mid|light|fair`: how deep that colour is. `hairhue=N` alone is the bright `light` tone (hue 25 is
  ginger); for natural dark hair write `hairhue=25 hairtone=dark` (dark brown), `hairhue=25 hairtone=mid` (chestnut),
  `hairhue=45 hairtone=fair` (blond). `hairtone` without `hairhue` keeps the hue picked from the name.
- `fem` or `masc`: the figure. `fem` is slimmer with a waist, larger eyes, a skirt and a ribbon; `masc` is broader
  with narrower eyes, heavier brows, trousers and a tie (with `coat`, `uniform` and `shirt`; a hoodie or cardigan has none). Without either the figure is neutral (and, as before, wears
  a skirt only with `cardigan` or `uniform` and `long` / `bob` / `ponytail` / `bun` hair).
- Clothes: `coat` (a lab coat over shirt and tie), `hoodie`, `cardigan`, `shirt`, `uniform` (blazer and tie). When
  omitted, one of shirt / coat / cardigan / hoodie is picked from the name, always the same one. `hue=N` colours the
  hoodie, cardigan, tie or shirt, and the eyes. Each outfit has its own way of standing: hands in the coat or
  hoodie pockets, clasped in long cardigan sleeves, a sketchbook held to the uniform, behind the back or in a
  trouser pocket with a shirt.
- `lattice=sparse` or `lattice=dense`: the model character, a figure of light: a luminous body in the cast hue with
  nodes and filaments inside it and long strands of light for hair. `sparse` has fewer nodes with some long-range arcs
  (the reasoning-tuned regime), `dense` a regular lattice with short edges (coder- and instruction-tuned). Name it
  after its regime, never after a product.
- `player`: the back of a head, close to the camera at the bottom of the picture: the reader ("You").
- `page`: a floating ruled sheet, for quotations and epigraphs.
- `coauthor`: opts a real coauthor in as a speaker; every line they say must then end with `^§x` or `^para` (see *Accuracy rules*).

Faces: `neutral`, `smile`, `puzzled`, `worried`, `surprised`, `thinking`, `deadpan`, `laugh`. Write them as `Jack (smile): ...` or `@show Jack left (thinking)`. The speaker is lit and the others dim. Sprites are
thigh-up standing figures drawn in code (about 6.7 heads tall, turned a little to one side); there are no images.

## Backgrounds

`lab`, `office`, `lecture`, `server`, `library`, `night` (a city under the moon), `cafe`, `terminal`, `paper`
(a manuscript on a desk), `train`, `garden`, `void` (soft lights in the dark), `sakura` (a hill of cherry trees),
`classroom`, `rooftop`, `corridor`, `station` (a platform), `sea`, `room` (a student's room), `studio` (an atelier
with a large canvas), `basement` (a basement bar with an open mic: a strip of window at pavement level, a low stage,
one microphone; a night scene).

`classroom` and `lecture` have a blackboard: `board=plot` (the default: lines and a curve on axes), `board=text`
(lines of writing only) or `board=blank`, as in `@bg classroom dusk board=text`. `overcast` closes the sky of any
scene (no moon, no stars): `@bg room night overcast`.

Each scene is painted in its own time of day and takes an optional modifier: `night`, `dawn`, `dusk`, `noon`, or
`dim` (same hour, lights low). Without a modifier most scenes are daytime; `night`, `room`, `server`, `terminal` and
`void` are night scenes and `cafe`, `station` and `train` are dusk. Sprites take the light of the scene they stand in.
Scenery does not follow the light/dark theme (only the text window and the menus do). `library` draws real spines
from `../../assets/data/library.json` when it loads, with a silent fallback.

### Faces

A face set by `Name (face): text` or `@show Name (face)` stays while the character is on stage, through `@move` and
through a second `@show` that only changes the slot or the distance. It does not survive an exit: after `@hide Name`
(or `@hide all`), `@show Name` without a face brings the character back `neutral`, and a face on a line spoken while
off stage does not follow the character back on. Say the face on the `@show` when an entrance needs one.

### Weather and particles

- Outdoors (`night`, `garden`, `sakura`, `rooftop`, `station`, `sea`, and the abstract `void`, `terminal`, `paper`)
  every `@fx` layer falls in front of the cast.
- In a room (`lab`, `office`, `lecture`, `server`, `library`, `cafe`, `train`, `classroom`, `corridor`, `room`,
  `studio`, `basement`) the weather layers `rain`, `snow` and `petals` are drawn behind the cast and fainter, as
  something seen through the windows; `dust` and `fireflies` stay in front.
- While a `@cg` is up no particle layer is drawn; the layers come back by themselves at `@cg off`. The script does
  not need to switch them off and on around an illustration.
- While `@fx rain` or `@fx snow` is on, the sky is closed: backgrounds and the `desk-night` CG lose their moon and
  stars. To get the same sky without falling rain, write `@bg room night overcast` / `@cg desk-night overcast`.

### The reader's sprite and the choices

A `player` cast member is drawn from behind (head and shoulders); in a slot it stands in front of the others and its
head clears the text window. Choice bars are placed just above the text window, under the faces, and the cast is
dimmed a little while a question is up; a list too long for that space scrolls. A `near` sprite is lowered under the
`@flashback` letterbox so its head is not cut.

## Staging a scene

```text
@chapter 2 Seventy-Five Minutes
@transition fade 1200
@bg classroom dusk
@flashback on Spring, the study room
@fx dust on
@mode nvl
Dust in a bar of afternoon light. Rows of desks.
(I remember the dust more than the lesson.)
@page
Fifty people sat one supervised session each. ^§3.2
@mode adv
@show P23 center (worried) far
P23: It wasn't about seconds, was it?
@move P23 left
@show Jack right (thinking) near
Jack: I can't tell you that.
@pause 600
@flashback off
@hide all
@fx none
@transition white 900
@cg sea-of-points | The inside of the model
@tone cold
No floor. No walls. Points of light out to the horizon.
@cg off
@tone none
```

A script that uses every directive once is `_demo-effects.vn` in this folder
(`?src=stories/_demo-effects.vn`); it predates the sound directives below.

## Sound

A story needs no sound directives. With no `@music` and no `@ambience` in the script, the score is chosen
automatically from the scene: the engine hands the score the place, its hour, the weather, the tone, a flashback and
the chapter at every line, and the score decides. Write a directive only where the scene alone would choose wrong.

```text
@music nocturne
```

names a track until the next `@music` (`@music auto` hands the choice back, `@music off` is a silence).

```text
@ambience rain
```

sets the air of the place the same way (`auto`, `off`), for rain on a window that no `@fx rain` draws.

```text
@sfx door
```

is one sound, once, as the next line appears. It is not heard again when the reader goes Back, loads a save or skips.

`@music` and `@ambience` last until changed, like `@tone`; a deep link or a chapter jump lands with the right ones.
An unknown name is a warning that lists the valid ones: music and ambience fall back to `auto`, an unknown `@sfx` is
ignored. The sound itself is made by `score.js` and `audio.js` in the engine folder; while those are placeholders the
directives are parsed, linted and carried in the state, and nothing sounds. Sound never starts before the reader's
first click or key press.

## Presenter notes

A comment that starts with `# note:` is a note to yourself for a talk. It belongs to the next line that stops (a
spoken line, narration, a choice, a card, a chapter card), and the presenter view shows it beside that line. Several
notes in a row are joined, one per line. Readers never see them, and every other `#` comment is ignored as before.

```text
# note: Ask the room to bet before the numbers.
# note: Wait for hands.
Jack (smile): Before the numbers, place a bet.
```

`P` while a story is open (title screen or playing) opens the presenter view, `presenter.html`, in a second window:
it follows the stage and can advance it.

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
choice without a target, `@show` or `@move` of an undeclared name, a `@show` token
that is not a slot, a `(face)` or `near`/`far`, malformed `@if`, missing `@kind`.

Warnings (the story still runs, the panel and `test.js` list them):

- undeclared speaker (demoted to narration; only a single capitalised word before the colon is reported),
- unknown background (falls back to `void`) or background modifier,
- unknown `@transition`, `@fx`, `@cg` or `@tone` name; each warning lists the valid names
  (the transition becomes `dissolve`, the fx is ignored, the CG becomes an abstract fallback, the tone `none`),
- unknown `@music`, `@ambience` or `@sfx` name, again with the valid names (music and ambience become `auto`, the sfx
  is ignored),
- **numeric literal without a chip** (paper kind): a `say` or narration line
  containing `%`, `ρ`/`rho`, `p <`, or an integer of 10 or more and no chip (digits inside a declared cast
  name such as `Participant 23` do not count),
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
  (option 1 at every menu, or option K+1 with `&pick=K`) or run to the ending, without autosaving;
  `&screen=save|load|config|log|chapters|title` then opens that screen, `&trans=iris` freezes a transition half-way.
- `?gallery=bg` (`&mod=night|dawn|dusk|dim`, `&overcast=1`, `&board=text`, `&only=room,basement`) and `?gallery=cg`
  (`&mod=day|dusk|dawn|night`, `&overcast=1`, `&text=total`) — every background and every event illustration.
- `?src=draft:<key>` — a script kept in this browser by the Studio (`localStorage['vn:studio:<key>']`) instead of a
  file; `&studio=1` makes the stage a live preview that the Studio drives (nothing is saved; see OPS.md).
- `&audio=0`, `&paint=0`, `&live=0`, `&camera=0`, `&op=0` — switch one of the optional modules (sound, painted
  backgrounds, living cast, camera, opening movie) off; `=1` forces it on, also under `&autoplay=` and `?thumb=1`,
  where they otherwise rest.

A story opens on its title screen (Start, Continue, Chapters, Load, Log, Config, Back to stories) and then plays
full-bleed. With `?src=` (or `?drafts=1`) a `⚠ n` button at the top right lists every parser and lint issue with line
numbers; they are mirrored to the browser console, and a fatal issue replaces the stage with a panel that names the
line. Keys while playing: Space/Enter advance, Backspace back, `L` backlog, `A` auto, `S` skip, `H` or right-click hide
the window, `C` config, `F` fullscreen, `F5`/`F9` quick save and load, `T` text-only, `?` help, `Esc` title screen,
`P` presenter view, and `M` sound on or off once the sound module is there.

## Testing in a real browser

`test.js` never opens a browser. The end-to-end matrix drives headless Edge with real mouse, keyboard and touch
input over the DevTools protocol (no npm packages); it lives with the other scratch tools, outside the repository:

```text
powershell -ExecutionPolicy Bypass -File <tools>\serve.ps1 -Port 8851
"C:\Program Files\nodejs\node.exe" <tools>\vn-e2e.mjs                 # everything, about 25 minutes
"C:\Program Files\nodejs\node.exe" <tools>\vn-e2e.mjs "quick /" back  # only rows whose "group / name" contains a word
```

It reads the live run through `window.__vnStage` (`{S, prefs, catalog()}`, read-only by convention). Run it after any
change to `stage.js`, `vn.css` or `index.html`.

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
