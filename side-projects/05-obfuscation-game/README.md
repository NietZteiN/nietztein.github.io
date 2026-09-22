# Obfuscation Guessing Game

A browser game for studying code comprehension under obfuscation. The player
sees a short Python snippet that has been pushed through one or more of the
transforms from project 4 (identifier renaming, control-flow flattening,
dead-code insertion, string encoding, expression rewriting), predicts what it
prints, and rates their confidence. Every trial (correctness, response time
from the moment the code is revealed, confidence, the answer given) is stored
in the browser and can be exported as CSV or JSON, so the same page can serve
as a small pilot instrument. The snippet bank is generated offline by
`build_bank.py`, which verifies every obfuscated snippet against its clean
program before it is admitted.

## How to run

Play (the full bank loads with fetch, so serve the repository root):

    cd side-projects
    python3 -m http.server 8000
    # open http://localhost:8000/05-obfuscation-game/

Opening `index.html` directly from disk also works: the page then uses a
built-in fallback of 10 snippets, and the file picker on the settings screen
loads the full `bank.json` when wanted.

Rebuild the bank (needs project 4 next to this folder, standard library only):

    cd side-projects/05-obfuscation-game
    python3 build_bank.py                 # writes bank.json, refreshes the fallback in index.html
    python3 build_bank.py --import DIR    # also add an existing snippet set (see below)
    python3 -m unittest discover -s tests # every snippet reproduces its expected output

The last run produced 306 snippets from 23 programs (341 KB), difficulty
histogram 1:60, 2:90, 3:55, 4:13, 5:28, 6:14, 7:26, 8:20.

## Playing

1. Settings: free text or multiple choice, difficulty filter, number of rounds,
   whether transform names are shown during the round, an optional participant
   id (default `anonymous`).
2. Round: the code is blurred until you press Reveal (or Space). The timer
   starts at that moment. Type the exact output (Shift+Enter for a new line)
   or press 1 to 4 to pick an option, set your confidence (50 to 100 percent),
   and press Enter.
3. Feedback: verdict, your answer next to the true output, time, the
   transforms used, and toggles for the clean program and the obfuscated code.
4. Summary: accuracy, mean response time, a calibration table and SVG plot
   (stated confidence against observed accuracy), and accuracy per transform.

Answer matching trims each line, normalizes curly quotes and trailing
newlines, and then compares exactly. An answer that matches only after every
whitespace character is removed is still counted wrong but shown as a near
miss.

## Recorded data

Trials are appended to `localStorage` under the key `obgame_trials_v1`. The
export buttons download all stored trials; Clear deletes them. Each trial has:

| column | meaning |
|---|---|
| session_id | one id per Start button press |
| participant | the participant id field, default `anonymous` |
| item_id | bank item id, for example `collatz.ra+e.s1` (program, transform codes, seed) |
| program | name of the clean program |
| transforms | transform names joined by `+` in the CSV, an array in the JSON |
| mode | `text` or `choice` |
| correct | true or false |
| near_miss | true when only whitespace differed |
| response_ms | milliseconds from reveal to submit |
| confidence | 50 to 100 in steps of 10 |
| answer, expected | the answer given and the true output |
| timestamp | ISO 8601, local clock |

## The bank

`bank.json` has `programs` (name to clean source and output) and `items`, one
per snippet:

    {id, program, transforms: [names], seed, code, expected_output,
     distractors: [three wrong outputs], difficulty, language}

`transforms` lists only the transforms that actually changed the code (control
flow flattening is a no-op on programs without functions). `difficulty` is the
number of transforms plus a line-count band (0 up to 10 lines, 1 up to 25, 2
up to 50, 3 beyond); the page labels 1 to 2 easy, 3 to 4 medium, 5 and up hard.
Distractors are made by mutating the true output (off-by-one numbers, doubled
numbers, reversed words, swapped tokens or lines, changed case, flipped
booleans, shuffled list elements), always distinct from the truth and from each
other.

The transform stacks and seeds live in the `STACKS` block near the top of
`build_bank.py`: six single transforms, four pairs, and two full five-transform
stacks in opposite orders with two seeds each.

### Importing an existing snippet set

`python3 build_bank.py --import DIR` adds every `name.py` (or `name.js`) in
`DIR` that has a companion `name.out` file holding its expected stdout. Each
snippet is run first; if the output does not match the `.out` file it is
skipped with a message. An optional `name.meta.json` may supply
`{"transforms": [...], "program": "...", "seed": ...}`; without it the
snippet is stored with an empty transform list and shown as its own clean
program. JavaScript snippets need `node` on the path and appear with
`language: "javascript"`.

## File layout

    build_bank.py     generates bank.json and the fallback embedded in index.html
    bank.json         the snippet bank (committed, under 1 MB)
    index.html        the game, single file, no libraries
    programs/*.py     17 short clean programs added for this project
    tests/test_bank.py  unittest: every item and program reproduces its output
    screenshot.png    the round screen

The six Python examples of `../04-obfuscation-playground/examples/python` are
included in the bank as well; that folder is imported read-only.

## Assumptions

- Python only. The JavaScript transforms of project 4 run in the browser, so
  there is no offline way to generate verified JavaScript snippets. The import
  path accepts `.js` files with `.out` files if a JavaScript set exists.
- Confidence is a 50 to 100 percent slider in steps of 10, so calibration bins
  are the six slider positions. For multiple choice, chance is 25 percent; the
  floor of 50 was kept so the scale is the same in both modes.
- The difficulty score is the simple rule above. Thresholds for easy, medium
  and hard are in `difficultyClass` in `index.html`.
- A session prefers one snippet per clean program before repeating a program,
  so 10 rounds usually show 10 different programs.
- A near miss is recorded as incorrect. Change `judge` in `index.html` if it
  should count as correct.
- Multiple-choice options are shuffled with `Math.random`, so option order is
  not reproducible; the chosen text is recorded, which is what matters.
- The project 4 examples print several lines, so some items expect multi-line
  answers. They land in the higher difficulty bands.

## Ideas for later

- A "model vs human" overlay: feed the same bank to a local model and show its
  accuracy per transform next to the player's.
- Stack-interaction analysis in the summary: accuracy of pairs against what
  the single transforms would predict.
- A timed mode with a per-round limit, and a streak counter.
- Item-level statistics across sessions (which snippets fool everyone).
- Generate multiple-choice distractors by running slightly wrong programs
  instead of mutating strings, so every option is a real possible output.
