# Fake paper title generator

A word-level Markov chain (order 2, backoff to order 1) trained on real arXiv titles, wrapped in a small structural model that learns how often titles have a colon, how many words come before it, and which two-word openers start the main clause. It prints plausible fake titles on demand and, in lint mode, scores how cliché a real title is (0 to 100) with a breakdown of the rules that fired. The same generator and linter exist in plain JavaScript in `index.html`, with the training titles inlined, so the page works from `file://` with no server and no network. Standard library only.

## How to run

```
cd 16-fake-paper-titles

# ten fake titles, reproducible with a seed
python3 titles.py generate --n 10 --seed 3 --temperature 0.9

# titles that mention a field (interp, unlearning, code, watermark), with cliché scores
python3 titles.py generate --topic interp --lint

# score one title
python3 titles.py lint "Towards Rethinking X: A Y Approach"

# rank every line of a file, most cliché first
python3 titles.py lint --file ../03-arxiv-digest/data/titles.txt

# what the structural model learned (colon rate, prefix lengths, top openers)
python3 titles.py stats

# rebuild index.html after collecting more titles
python3 titles.py build-page

# tests
python3 -m unittest discover -s tests -v
```

Open `index.html` directly in a browser, or serve the repository root with `python3 -m http.server 8000` and visit `/16-fake-paper-titles/`. The page has a Generate button, a topic selector, a temperature slider, an optional seed, and a lint box with a live score bar. Clicking a generated title sends it to the linter.

Training data is read from two files, merged and deduplicated (case and punctuation insensitive):

1. `../03-arxiv-digest/data/titles.txt`, written by project 3's `collect_titles.py`.
2. `data/seed_titles.txt`, a hand-curated list of well known NLP and ML titles.

Pass `--data FILE` (repeatable) before the subcommand to train on other files instead.

## Lint rules

Each rule adds points; the total is capped at 100. Opener words at the start of the title or right after a colon (Towards, Rethinking, Revisiting, Beyond, Unveiling, Demystifying, On the, A Simple, and a few question openers), and two stacked openers both count. Colon present, plus a bonus that depends on how many words come before it (a one-word name scores most). Cute acronyms with a capital letter inside a word (CodeBERT, SimCSE), or an all-caps coinage before the colon. Question mark. "All You Need" and the fuller "is All You Need". "Large Language Models", "A Survey", "Benchmark", "via", "Meets", "Approach". Buzzword density over LLM, Transformer, Efficient, Robust, Scalable, Unified, Novel, Foundation, Emergent. Length above 15 or 20 words, or a one or two word title. The verdict line is chosen by score bracket. Point values live in `OPENERS` and the `lint` function in `titles.py` and are mirrored in `page_template.html`.

## File layout

```
titles.py             generator, linter, stats, build-page (standard library)
page_template.html    single-page UI; the marker /*__TITLES__*/ is replaced at build time
index.html            built page with the training titles inlined (regenerate with build-page)
data/seed_titles.txt  hand-curated seed titles, one per line, # lines are comments
tests/test_titles.py  unittest for the linter rules and the chain
screenshot.png        the page as rendered by headless Chromium
```

## Assumptions

- The sandbox that built this could not reach arxiv.org, so project 3's `titles.txt` had 55 lines. The seed file fills the gap with about 560 real titles chosen from memory. Every title in it was checked to be a paper that exists, but a spelling slip in a long title is possible; the header explains that it is a stand-in until `collect_titles.py` has run for a while. Delete or shorten it at any time.
- `MAX_PREFIX_WORDS = 10`: a colon whose left side is longer than that is treated as part of the main clause, not as a name.
- The body of a title is capped at 14 words, and the END token is boosted from 9 words on. Constants at the top of `titles.py` and of the script in `page_template.html`.
- Topic keywords are substrings (see `TOPICS`); `--topic` biases the start state toward titles that mention the field and retries until one keyword appears.
- The Python and JavaScript generators use the same algorithm but different random number generators, so the same seed gives different (but equally reproducible) lists in the terminal and the page.
- A generated title is rejected if it reproduces a training title or the part of one after its colon, if brackets or quotes are unbalanced, or if the main clause is under three words. After 40 retries the last draft is emitted with brackets stripped.

## Ideas for later

- Add a `--format bibtex` that invents authors and a venue to match the title.
- Learn the opener patterns per category (cs.CL vs cs.SE) once project 3 has collected enough titles with category tags.
- Feed the linter the whole arXiv history for one year and plot the cliché score over time.
- A "reverse lint" that rewrites a plain title into its most cliché form using the same rule table.
