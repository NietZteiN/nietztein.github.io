# side-projects

A collection of small local tools and toys. Every project lives in its own folder with its own README that explains how to run it.

Ground rules shared by all projects:

- No external APIs of any kind. Everything runs locally. The only network use is downloading public static files (Project Gutenberg texts, Aozora Bunko texts, arXiv RSS feeds, CMUdict).
- Dependency-light. Most projects are a single HTML file or a Python script that needs only the standard library. Projects that need a package say so in a requirements.txt.
- Sample data only. Projects that read personal data (the library catalog, the application tracker) ship with sample files and document the expected columns. Replace the sample with your own export.

## Projects

| # | Folder | What it is | Runs as |
|---|--------|------------|---------|
| 1 | 01-virtual-library | Browse a library catalog as shelves of spines, find a book, stats, integrity checks | HTML + CSV |
| 2 | 02-application-tracker | Deadlines with countdowns, status and recommender status per application | HTML + CSV |
| 3 | 03-arxiv-digest | Daily keyword-scored digest of arXiv RSS feeds, no LLM | Python, cron |
| 4 | 04-obfuscation-playground | Stack code obfuscation transforms as a ladder with diffs | Python server + HTML |
| 5 | 05-obfuscation-game | Predict the output of obfuscated snippets, record correctness, time, confidence | HTML |
| 6 | 06-terminal-pet | ASCII creature whose mood follows your commit habits | Python + shell hook |
| 7 | 07-grokking-microscope | Train a tiny transformer on modular addition and watch it grok | PyTorch + HTML |
| 8 | 08-git-film-timeline | Render a git history as a film editing timeline | Python + HTML |
| 9 | 09-harvard-classics | Literary oracle and Fifteen Minutes a Day over the Harvard Classics | Python |
| 10 | 10-haiku-clock | The time as a haiku in four languages | HTML |
| 11 | 11-poetry-form-checker | Morae, syllables, meter and rhyme annotation | HTML + CMUdict |
| 12 | 12-translation-aligner | Side by side source and translation with manual realignment | HTML |
| 13 | 13-aozora-frequency-reader | Author-specific vocabulary from Aozora Bunko texts | Python |
| 14 | 14-bookshelf-poster | Printable SVG poster of the whole collection as spines | HTML |
| 15 | 15-daylight-clock | Local time, sunrise, sunset and daylight arcs for three cities | HTML |
| 16 | 16-fake-paper-titles | Markov chain paper titles and a cliché linter | Python + HTML |
| 17 | 17-bookshelf-tetris | Tetris where rows clear only in title-alphabetical order | HTML |

## Running the web projects

Most HTML projects open directly from the file system. The ones that load a data file with fetch work best from a tiny local server, started from this folder:

```
python3 -m http.server 8000
```

Then open http://localhost:8000/01-virtual-library/ and so on.

## Style

Prose in this repository avoids em dashes and keeps a calm, simple tone.

## Notes from the first build

These projects were built in a sandbox whose network policy blocked arxiv.org, gutenberg.org, aozora.gr.jp and archive.org. Each affected project ships with a bundled sample or uses a GitHub mirror, and its README says how the first real run refreshes the data:

- 03-arxiv-digest verified on a saved sample feed; the first cron run fetches the live feeds.
- 09-harvard-classics fetched texts through the GITenberg mirror; the Fifteen Minutes a Day calendar has the daily assignments but no teaser lines yet.
- 13-aozora-frequency-reader falls back to a GitHub mirror of Aozora Bunko when the main site is unreachable.
- 16-fake-paper-titles trains on a hand-curated seed list until collect_titles.py has gathered enough real titles.

Projects that read personal data (1, 2, 14, 17) run on invented sample catalogs. The expected columns are documented in each README and in a CONFIG block at the top of the code.
