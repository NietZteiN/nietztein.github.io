# Poetry form checker

A single page that analyzes a pasted poem. Japanese text is counted in morae per line and checked against haiku (5-7-5) and tanka (5-7-5-7-7); English text gets syllable counts, a rough metrical scan (iambic, trochaic, anapestic, dactylic feet at 3 to 6 feet) and a rhyme scheme from the CMU Pronouncing Dictionary; German text gets syllable counts and a rhyme scheme from a vowel-group heuristic. The result is an annotated view of the poem with stress marks, foot bars, mora counts, and rhyme letters. Everything runs in the browser; the only data file is a compact dictionary built once by a standard-library Python script.

## How to run

Serve the repository (or this folder) and open the page:

    cd /home/user/side-projects
    python3 -m http.server 8000
    # then open http://localhost:8000/11-poetry-form-checker/index.html

Opening `index.html` directly from `file://` also works. The browser cannot fetch the dictionary in that mode, so the page shows a file picker: pick `cmudict.min.json` from this folder and English analysis switches from the fallback heuristic to the dictionary.

To rebuild the dictionary (about 2.6 MB, 126k words, committed in the repository):

    python3 build_dict.py            # download CMUdict and write cmudict.min.json
    python3 build_dict.py --top 40000  # smaller variant, first 40k entries

If the JSON comes out above 3 MB the script also writes `cmudict.min.json.gz`, and the page loads whichever file exists.

## File layout

    index.html         the whole tool (HTML, CSS, JS in one file)
    build_dict.py      downloads CMUdict and writes cmudict.min.json (standard library only)
    cmudict.min.json   word -> "STRESS:RHYME" (for example "poet" -> "10:lcT")
    screenshot.png     Sonnet 18 annotated, taken with Playwright
    README.md          this file

Dictionary format: STRESS has one digit per syllable (0 none, 1 primary, 2 secondary). RHYME is the pronunciation from the last stressed vowel onward with each ARPAbet phoneme encoded as a single letter (the table is `PHONE_CODES` in `build_dict.py`); two words rhyme when their RHYME parts are equal. Only the first pronunciation of each word is kept.

## What the page does

- Language is detected per text: any kana or kanji means Japanese; umlauts, ß, or a high share of common German function words means German; otherwise English. The selector can force a language.
- Japanese: each non-empty line is one unit (a single line with spaces is split on the spaces). Small ya, yu, yo and small vowels merge with the previous kana; small tsu, the long vowel mark, and ん each count one; punctuation, spaces, and Latin text are ignored. Readings written as 漢字《かんじ》, ｜漢字まじり《よみ》, or 漢字（かんじ） are used in place of the kanji. Lines that still contain kanji get an inline box for a kana reading. Three lines are checked as haiku, five as tanka, anything else is reported as free form; each line shows its count with a check mark, ji-amari (+n) or ji-tarazu (-n). Hovering a line shows the mora breakdown.
- English: syllables and stress come from the dictionary. Unknown words use a vowel-group heuristic with silent e, -es, -ed and -le handling, shown with a dotted underline, and can be corrected in the overrides box (`word = 3` for a syllable count, `word = 010` for a stress pattern). Monosyllables are unstressed when they are in a small function-word list, "either" for pronouns and a few adverbs, and stressed otherwise. Each line is matched against every foot type at 3 to 6 feet, allowing a feminine ending for rising meters and catalexis for falling meters; the fit is the share of syllables that agree with the template. The poem's meter is the most common best fit when at least half the lines share it, reported with the mean fit of those lines. Rhyme letters come from the dictionary rhyme tail, or from the last two letters for unknown words.
- German: vowel groups count one syllable each, with ei, ai, au, eu, äu, ie, ey, ay and doubled vowels counted once and other adjacent vowels counted separately (so Nation has three). The most common line length is highlighted. Rhyme keys run from the last vowel group to the end, a final h is dropped (Ruh, du), and a final unstressed e-syllable extends the key to the previous vowel (Walde, balde; Gipfeln, Wipfeln).

## Assumptions

- The dictionary is committed to the repository (2.6 MB, under the 5 MB limit), so the page works out of the box when served. Rebuild it with `build_dict.py` if a fresh copy is wanted.
- Secondary stress (2 in CMUdict) matches either a stressed or an unstressed template position without penalty. The same applies to the "either" monosyllables (I, thee, thou, not, more, all, and similar). Both lists are constants near the top of the script in `index.html` (`UNSTRESSED`, `EITHER`) and are easy to edit.
- Dictionary pronunciations are modern: "every" is three syllables, so line 7 of Sonnet 18 scans as 11 syllables until `every = 10` is added to the overrides. This is deliberate; the tool reports what the dictionary says and leaves elisions to the reader.
- Rhyme detection is by identical dictionary tails, so eye rhymes and historical rhymes (temperate, date) get different letters.
- The German rhyme key is a vowel-tail rule rather than a fixed two or three letters, because a fixed slice fails on common pairs like Ruh and du. The brief suggested the last two or three letters; the vowel-tail rule usually covers those letters and a little more.
- Japanese units are lines. A haiku typed on one line with spaces is split on the spaces; anything else stays one unit per line. Readings typed into the inline boxes live only in the page (they are kept while the text is edited, but not saved).
- Detection thresholds (German function-word share above 12 percent) and the sample poems are constants at the top of the script.

## Ideas for later

- Hyphenation data for English words so stress marks can sit over the exact syllable instead of centered above the word.
- Kigo (season word) detection for Japanese, and kireji (cutting word) marking.
- Save and load the furigana readings and English overrides as a small JSON file.
- Spondee and pyrrhic substitutions reported by name instead of as plain deviations.
- Vietnamese tone-pattern (bằng, trắc) checking for lục bát.
