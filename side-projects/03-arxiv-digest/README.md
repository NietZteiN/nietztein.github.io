# Daily arXiv digest (no LLM)

A small script that reads the arXiv RSS feeds for cs.CL, cs.LG, cs.SE and cs.CR, scores every new paper against a weighted keyword list in `config.json`, and writes a Markdown digest of the top ten with abstracts and links. It remembers what it has already shown so nothing repeats. Python 3.11 standard library only, no LLM, no API keys. A companion script collects paper titles into `data/titles.txt` for project 16 (the fake title generator).

## How to run

```bash
cd side-projects/03-arxiv-digest

# Fetch the live feeds, write digests/YYYY-MM-DD.md, remember the shown ids
python3 digest.py

# Look without touching anything (prints to stdout, seen.json untouched)
python3 digest.py --dry-run

# Try it without network, on the bundled sample feed
python3 digest.py --offline tests/sample_cs.CL.xml --dry-run

# Other flags
python3 digest.py --top 15 --min-score 3          # more papers, stricter cutoff
python3 digest.py --feeds cs.CL cs.AI              # different feeds (names or full URLs)
python3 digest.py --out ~/notes/arxiv --seen ~/.arxiv-seen.json
python3 digest.py --reset                          # forget every shown id
python3 digest.py --date 2026-09-21                # name the file for another day

# Collect titles for project 16 (appends, deduplicated)
python3 collect_titles.py
python3 collect_titles.py --offline tests/sample_cs.CL.xml

# Tests
python3 -m unittest discover -s tests -v
```

### Cron

Every weekday at 07:30 (arXiv announces new papers around 00:00 US Eastern, Sunday to Thursday nights, so a morning run in Germany sees the fresh list):

```
30 7 * * 1-5 cd /path/to/side-projects/03-arxiv-digest && /usr/bin/python3 digest.py >> digest.log 2>&1
```

Relative paths in `config.json` are resolved against the script folder, so the `cd` is only there to keep the log next to the script.

## Scoring

`config.json` holds:

- `terms`: a list of `{"term", "weight", "phrase"}`. Matching is case insensitive on title plus abstract. A plural `s` or `es` is allowed, and spaces and hyphens inside a term match a space, a hyphen or nothing (`cross-lingual` also finds `cross lingual` and `crosslingual`). `phrase` defaults to true, meaning the words must appear consecutively; with `phrase: false` every word must appear somewhere in the text, in any order.
- `title_bonus`: a term found in the title scores `weight * title_bonus`; a term found only in the abstract scores `weight`. Each term counts once per paper.
- `negative_terms`: same format, subtracted with the same rule.
- `announce_types`: which arXiv announcement types to consider (`new`, `cross`, `replace`). Replacements are excluded by default because they are mostly papers you have seen before.
- `top`, `min_score`, `max_authors`, `out_dir`, `seen_file`, `seen_days`, `feeds`, `feed_url_template`.

The digest prints the score and the matched terms for each paper (terms found in the title are marked `[title]`, negative terms carry a minus sign), so it is easy to see why something ranked where it did and to adjust weights.

## Output

`digests/YYYY-MM-DD.md` contains, for each of the top N papers: linked title, authors (first five, then "et al."), categories and announcement type, score with matched terms, arXiv id with abs and pdf links, and the abstract. A footer gives counts: items fetched, unique papers, new after filtering (unseen and of an allowed announcement type), shown. If nothing scores above `min_score`, no file is written.

`seen.json` maps arXiv ids to the date they were shown. Entries older than `seen_days` (90) are pruned on every run. `--dry-run` never writes it; `--reset` clears it.

## File layout

```
03-arxiv-digest/
  digest.py             the digest script (fetch, parse, score, render, remember)
  collect_titles.py     appends feed titles to data/titles.txt for project 16
  config.json           feeds, weights, terms, paths
  seen.json             ids already shown (created on first real run, gitignored)
  digests/2026-09-22.md example digest, produced from the bundled sample feed
  data/titles.txt       one title per line, deduplicated
  tests/sample_cs.CL.xml  a saved feed in the current arXiv RSS 2.0 layout (55 items)
  tests/test_scoring.py   unittest suite (parsing, scoring, memory, end to end)
```

## Feed format

arXiv switched its RSS feeds to RSS 2.0 in 2024 (`https://rss.arxiv.org/rss/cs.CL`). Each `<item>` has a `<title>`, `<link>`, a `<description>` of the form `arXiv:2409.12345v1 Announce Type: new \nAbstract: ...`, a `<guid>` like `oai:arXiv.org:2409.12345v1`, one `<category>` per category, `<arxiv:announce_type>` and `<dc:creator>` with comma separated authors. `parse_feed` handles this layout and also the older RSS 1.0 (RDF) layout and Atom, so a saved old feed or an arXiv API response can be passed with `--offline`.

## Assumptions

- **Live fetch was blocked while this was built.** The sandbox's egress proxy denied every request to `rss.arxiv.org` and `export.arxiv.org` (HTTP 403 on CONNECT), so the feed layout could not be re-verified against a live download. `tests/sample_cs.CL.xml` was written by hand in the documented RSS 2.0 layout. Its 55 titles and author lists are real papers, but the arXiv ids (`2609.000xx`) are placeholders and the abstracts are short paraphrases, not the published text. The example digest and `data/titles.txt` come from this sample. The first real run on a machine with network access (`python3 digest.py`, then `python3 collect_titles.py`) will replace them with live data. If the live feed layout has drifted, `parse_feed` in `digest.py` is the one place to fix.
- The keyword weights in `config.json` are a first guess at Jack's areas (interpretability, unlearning, steering, merging, code comprehension, cross-lingual, watermarking). Tune them by reading the "Matched" line in a digest and nudging numbers.
- Replacements (`announce_type: replace`) are skipped by default. Add `"replace"` to `announce_types` to include them.
- Daily digests are gitignored except the example, on the theory that they are reading notes, not source. Remove the `digests/*.md` line from `.gitignore` to keep them all.
- `seen.json` is gitignored because it is per machine state.

## Ideas for later

- Weight recency of the arXiv id inside a feed so a paper cross-listed days later does not outrank a fresh one.
- Add a `--format html` option and a tiny reader page, or pipe the Markdown to an email via `mail`.
- Learn weights from feedback: a `--like ID` flag that bumps the terms a paper matched.
- Group the digest by theme (interpretability, unlearning, code) using the matched terms.
- Pull the full author list and comments from the arXiv API for the top papers only.
