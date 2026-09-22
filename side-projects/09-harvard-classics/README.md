# Harvard Classics oracle and Fifteen Minutes a Day

Two small tools over the public domain texts of the Collier Harvard Classics (the Five-Foot Shelf), fetched from Project Gutenberg and split into passages of 120 to 250 words. The oracle takes a question or a mood and returns the most relevant passage with its source (volume, work, author), scored by TF-IDF with a small mood lexicon. The daily reader follows the 1930 Collier guide "Fifteen Minutes a Day" and prints today's assignment with a taste of the assigned work. Everything is Python 3.11 standard library, plus one optional HTML page. A sample index of 340 passages from seven works is bundled, so both tools work before anything is downloaded.

## How to run

```
cd side-projects/09-harvard-classics

# Oracle (uses the bundled sample until you build a full index)
python3 oracle.py "I feel restless and want courage"
python3 oracle.py --n 3 "what is friendship"
python3 oracle.py --random                  # pure fortune cookie
python3 oracle.py --sample "fear of death"  # force the bundled sample

# Fifteen Minutes a Day
python3 daily.py
python3 daily.py --date 2026-10-03

# Build a bigger index (one request at a time, 1.5 s apart, retried once)
python3 fetch.py --limit 3        # first three works, a quick start
python3 fetch.py --volume 2       # Plato, Epictetus, Marcus Aurelius
python3 fetch.py                  # every work with a Gutenberg id (about 100 texts)
python3 fetch.py --sample         # rebuild data/sample_index.json (and .js)

# Rebuild the calendar (only needed after editing data/fifteen_minutes_guide.txt)
python3 build_calendar.py

# Optional web page with both modes over the sample
python3 serve.py                  # then open http://localhost:8765/
# or simply open index.html from the file system; it works there too
```

The oracle prefers `data/index.json` when fetch.py has built it and falls back to `data/sample_index.json`. The TF-IDF model is built on the first query and cached in `data/tfidf.json`; the cache is keyed on the index file and rebuilt when the index changes.

## File layout

```
volumes.json               hand-built index of the 51 volumes: works, authors, Gutenberg ids,
                           id_status (verified / unverified / null), GITenberg mirror names
fetch.py                   downloads texts, strips the Gutenberg header and footer, splits passages,
                           writes data/index.json (or the bundled sample with --sample)
oracle.py                  TF-IDF search with stemming, stopwords and the mood lexicon
daily.py                   today's Fifteen Minutes a Day reading plus a passage when text exists
build_calendar.py          turns data/fifteen_minutes_guide.txt into data/calendar.json (+ .js)
hc_common.py               shared paths, tokeniser, stemmer, stopwords, lexicon
index.html, serve.py       optional single page with both modes; serve.py is a thin http.server
data/fifteen_minutes_guide.txt   366 daily assignments of the reading guide (text, editable)
data/calendar.json, calendar.js  the parsed calendar (json for Python, js copy for the page)
data/sample_index.json, .js      bundled sample: 340 passages from 7 works, about 420 KB each
data/raw/                  downloaded Gutenberg texts (gitignored)
data/index.json            full passage index (gitignored)
data/tfidf.json            cached model (gitignored)
```

## Which volumes are covered

`volumes.json` lists 128 works over the 51 volumes. 101 of them carry a Gutenberg id that was verified (title and id checked against the GITenberg catalog of Project Gutenberg texts, and a handful downloaded and read: 148, 37311, 1656, 871, 2680, 575, 2944, 1279, 18269). Two ids are from memory and marked `"id_status": "unverified"` (1653 The Imitation of Christ, 4028 Cellini). 25 works have `null` because no reliable id was known; correctness was preferred over coverage. Volumes 27, 40, 41, 42, 50 and 51 (the English essay and poetry anthologies, the Reader's Guide, the Lectures) have no id at all, since Gutenberg does not carry the Collier compilations of those volumes. Five Collier volumes exist on Gutenberg as such and are listed as one work each: 28 (Essays, 21962), 35 (Chronicle and Romance, 13674), 38 (Scientific Papers, 5694), 39 (Famous Prefaces, 13182) and 49 (Epic and Saga, 14019). For several other volumes the Gutenberg text is a different translation or a fuller edition than the one Collier printed; the `note` field says so.

Not every Gutenberg id could be verified against gutenberg.org itself, because gutenberg.org and archive.org were unreachable from the build machine (network policy, HTTP 403 at the proxy). The catalog check is the next best thing: it maps each id to the title Gutenberg publishes under it. When gutenberg.org is reachable, `python3 fetch.py` uses it first, so any wrong id shows up as a download of the wrong title.

## The reading guide

The 366 daily assignments (title, volume, pages) come from a transcription of the 1930 Collier guide published at myharvardclassics.com and collected in the README of github.com/mutaphore/harvard-classics; they are stored in `data/fifteen_minutes_guide.txt`, one line per day. `calendar.json` therefore has `"source": "transcription ..."` rather than `"reconstructed"`. The guide's one-line teasers ("Franklin, ambitious boy of seventeen, ...") are not in that transcription, so `teaser` is `null` for every day.

To add the teasers from the original: get the plain text of "Fifteen Minutes a Day: The Reading Guide" (archive.org has scans under ids `harvardclassic0000unse` and `harvardclassicsf0000lldc`; the `_djvu.txt` file of either is what you want), then for each day add a line starting with `>` right after the day's line in `data/fifteen_minutes_guide.txt`, for example

```
Jan 1: FRANKLIN'S AUTOBIOGRAPHY Vol. I, pp. 79-85
> Franklin, ambitious boy of seventeen, runs away from home...
```

and run `python3 build_calendar.py`. If you would rather replace the whole file, keep the format `Mon D: TITLE Vol. N, pp. X-Y` (roman or arabic volume numbers both parse). If the file is deleted, build_calendar.py falls back to a deterministic calendar that cycles through the works of volumes.json in volume order and marks the output `"source": "reconstructed"`.

Each calendar day is also matched to a work in `volumes.json` (shared words between the day's title and the work title or author, inside the same volume; texts flagged `whole_volume` catch the rest). 266 of 366 days match a work that has a Gutenberg id, so `daily.py` can show a passage for them once that work is fetched. The others are mostly the poetry and essay anthologies.

## Assumptions

- Network. gutenberg.org was blocked during the build, so fetch.py tries gutenberg.org first and then the GITenberg mirror on raw.githubusercontent.com (a GitHub organisation that holds a git copy of each Gutenberg text; the repository name for each id is stored in `volumes.json` as `mirror_repo`). All test downloads went through the mirror. On a normal connection the gutenberg.org URLs will simply succeed first.
- Passage boundaries. Paragraphs are joined until at least 120 words, cut before 250; a single long paragraph is split at sentence ends. Blocks of short lines are kept as verse with their line breaks; blocks whose lines are mostly under five words are treated as tables of contents and dropped, as are all-capital headings and anything mentioning Project Gutenberg or a transcriber.
- Sample works. The bundle uses Marcus Aurelius, Epictetus, Bacon's Essays, Franklin, Pascal, Emerson and Burns, chosen for short quotable paragraphs. Change `SAMPLE_WORKS` in fetch.py and run `fetch.py --sample` to pick others; both files stay under 1 MB.
- Lexicon. The mood lexicon in hc_common.py (and the copy in index.html) is about 60 keys; expansion words get 0.35 of the weight of a typed word. Edit freely.
- Daily passage. For a given date the passage from the assigned work is chosen by a hash of the date, so a day always shows the same passage; it is a taste of the work, not the exact pages the guide names, since Gutenberg texts carry no Collier page numbers.
- Full index size. All 101 texts amount to roughly 60 MB of raw text and a multi-megabyte index.json; both are gitignored. `--limit` and `--volume` keep a first run short.

## Ideas for later

- Map Collier page numbers to text positions for the handful of whole-volume Gutenberg texts (28, 35, 38, 39, 49), so daily.py can show the actual assigned pages.
- A small evaluation set of mood queries with hand-picked expected passages, to tune the lexicon and stemmer.
- BM25 instead of plain TF-IDF, and a length prior that favours self-contained paragraphs.
- Let the web page load a full index.json that fetch.py produced, with a file picker.
- Fill in the missing ids (Penn, Browne, Walton, Carlyle, Locke's Education, Dekker, Massinger, the Cenci, Manfred) once gutenberg.org can be checked directly.
