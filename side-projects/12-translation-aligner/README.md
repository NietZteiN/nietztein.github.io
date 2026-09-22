# Translation alignment viewer

A single page tool for reading a Japanese source and its English translation side by side. Paste both texts, split them by lines (poetry) or sentences (prose), and the page aligns them automatically: one to one when the counts match, otherwise with a Gale and Church style length based dynamic programme. Rows that come out wrong can be fixed by dragging segments up or down across row boundaries, or with small move, split, merge and insert buttons. Alignments can be saved to a JSON file and loaded back, exported as a Markdown table or a TSV, and the latest state is kept in localStorage so a refresh does not lose work. An optional "dropped-word nudge" highlights source words that may not be reflected in the aligned target.

## How to run

Open the file directly:

    xdg-open 12-translation-aligner/index.html

or serve the repository root and visit the page:

    python3 -m http.server 8000
    # then open http://localhost:8000/12-translation-aligner/index.html

Everything is inline; there are no dependencies and no network requests. A Chromium based browser is recommended because the nudge uses `Intl.Segmenter` for Japanese word segmentation (Firefox and Safari also support it in recent versions; older browsers fall back to character bigrams).

To rerun the automated check (Playwright with the preinstalled Chromium):

    pip install playwright
    python3 12-translation-aligner/verify.py

## File layout

    index.html      the whole app: styles, markup, and script
    verify.py       Playwright check that exercises alignment, editing, save, load and the nudge
    screenshot.png  screenshot produced by verify.py
    README.md       this file

## Using the page

- **Split by.** "lines" uses one segment per non empty line. "sentences" splits Japanese at 。！？ (keeping a closing 」 or 』 attached) and English at . ! ? followed by a space or the end, with a small guard for abbreviations such as Mr., Dr., e.g. and single capital initials. Blank lines are paragraph boundaries in both modes.
- **Automatic alignment.** Equal counts align one to one. Otherwise the length based DP allows 1-1, 1-0, 0-1, 2-1 and 1-2 beads, using the Gale and Church cost with character counts on the Japanese side and English characters divided by 2.2. The priors are the ones from the paper (0.89 for 1-1, 0.0099 for 1-0 and 0-1, 0.089 for 2-1 and 1-2).
- **Manual realignment.** Drag any segment onto another row on the same side, or onto the thin gap between rows to make a new row. Hovering a segment shows arrows to move it one row up or down and a split button that moves it (and the segments after it) into a new row. The middle column has "merge with the row below" and "insert an empty row below"; an empty row shows a delete button. Undo keeps the last 50 edits (button or Ctrl+Z).
- **Save and load.** "Save JSON" downloads `{title, source_text, target_text, split_mode, beads, covered, glossary, nudge, saved_at}`; "Load JSON" restores it exactly. Markdown and TSV exports write one row per bead.
- **Dropped-word nudge.** When enabled, content like tokens in each source segment are checked against the target text of the same row. A token counts as reflected if the glossary maps it (or a kanji prefix of it) to an English word that begins a word in the target, if it is a number that appears in the target as digits or a number word, if it was left in Japanese, or if it is a kana word whose romaji loosely resembles an English word in the target (phonetic normalisation plus edit distance). Anything else is shown as "possibly dropped". Click a highlighted word to mark it as covered; shift-click to add a glossary entry. The glossary is a JSON object in the side panel and travels with the saved file.

## Assumptions

- The sample is the first two stanzas of Nakahara Chuya's "Yogoretchimatta kanashimi ni" (1934). He died in 1937, so the text is in the public domain in Japan. The English next to it is a literal gloss written for this demo, not a published translation. Change `SAMPLE` at the top of the script to use a different text.
- There is no dictionary, so the nudge is deliberately modest. Kanji words are only recognised through the glossary; proper nouns written in kanji cannot be matched by romaji without readings, and the UI says "possibly dropped" rather than "missing".
- Tokens that are skipped by the nudge: particles, copulas, light verbs and pronouns in a small stop list (`STOP` in the script), punctuation, and single kana. Historical kana spellings from the sample (つちまつた, さへ, たとへば) were added to the stop list or glossary by hand.
- "Covered" marks are stored by token string, not by row, so marking 狐 as covered in one row covers it everywhere in the document.
- The English to Japanese character ratio is 2.2 (`EN_CHARS_PER_JA_CHAR`). Poetry with very short lines makes the length signal weak, so line mode with equal counts is the expected path for poems; the DP is meant for prose.
- The autosave key in localStorage is `translation-aligner:v1`; the page restores it on load and otherwise shows the sample.

## Ideas for later

- A real dictionary layer (for example a small JMdict subset loaded from a local JSON file) so kanji words can be matched without a hand written glossary.
- Inline editing of segment text, and a way to split a segment in the middle of a sentence rather than only at existing boundaries.
- Multiple translations side by side (three or more columns) for comparing drafts.
- Per row notes for translator's comments, exported with the Markdown table.
- A print stylesheet for a facing page layout.
