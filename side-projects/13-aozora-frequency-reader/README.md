# Aozora Bunko frequency reader

A command line tool that downloads an author's works from Aozora Bunko, tokenizes them locally with fugashi (MeCab with the unidic-lite dictionary), and ranks words and kanji by how specific they are to that author compared with a small general corpus of other Aozora authors. The score is the z-scored log odds ratio with an informative Dirichlet prior (Monroe, Colaresi and Quinn 2008). The output is a Markdown reading list of words, one of kanji, and a self-contained HTML view of a chosen text with the author-specific words highlighted (color intensity follows the score) and a hover tooltip with reading, part of speech and counts. Everything runs locally; the only network use is downloading static text files.

The repository ships with a finished example for 坂口安吾 (8 works against 12 general works) in `out/`, so the results can be read without running anything. `out/坂口安吾_堕落論.html` opens directly in a browser.

## How to run

```bash
cd 13-aozora-frequency-reader
pip install -r requirements.txt          # fugashi and unidic-lite; the rest is standard library

# 1. download and clean texts (polite: one request at a time, one second apart)
python3 aozora.py fetch --general --per-author 2         # comparison corpus, six authors
python3 aozora.py fetch --author 坂口安吾 --limit 8       # the author to study (0 = all works)

# 2. count, score, write the lists and one HTML view
python3 aozora.py analyze --author 坂口安吾 --work 堕落論 --min-count 3 --top 200

# 3. (optional, offline) render any text with the saved statistics
python3 aozora.py render --author 坂口安吾 --text sample/坂口安吾_堕落論.txt --title 堕落論
```

Outputs land in `out/`: `<author>_words.md`, `<author>_kanji.md`, `<author>_stats.json` (all scored items, used by `render`) and `<author>_<work>.html`. `--work` matches a title exactly or by a unique substring. `python3 aozora.py <subcommand> --help` lists every flag, including `--prior` (Dirichlet strength, default 500), `--zmin` (lowest z that gets highlighted, default 2) and `--source` (see below).

Sources. `fetch` first tries the official index (`list_person_all_extended_utf8.zip`) and each work's zipped text on www.aozora.gr.jp. If that host is unreachable it falls back to the GitHub mirror `levelevel/AozoraTxt`, which keeps the same Shift_JIS files and a title index. `--source aozora` or `--source mirror` forces one of them. Both paths decode cp932, strip ruby (《》 and ｜), annotations ［＃…］, the header block and the trailer notes, and cache the cleaned UTF-8 text in `cache/<author>/` (gitignored, recreated by `fetch`).

## File layout

```
aozora.py                  the whole tool: fetch, analyze, render
requirements.txt           fugashi, unidic-lite
sample/坂口安吾_堕落論.txt   one short cleaned work so render works offline
out/坂口安吾_words.md       example reading list (200 words)
out/坂口安吾_kanji.md       example kanji list (200 kanji)
out/坂口安吾_stats.json     example statistics for render
out/坂口安吾_堕落論.html    example HTML view
screenshot.png             the HTML view in Chromium
cache/                     downloaded texts and indexes (gitignored)
```

## Method notes

- Tokens are unidic base forms in the author's own orthography (`orthBase`), so 堕ちる stays distinct from 落ちる. Particles, auxiliaries, symbols, numerals, light verbs (いる, ある, しまう) and a few formal nouns (こと, もの, よう) are skipped; the lists are in the config block at the top of `aozora.py`.
- For each item, with counts y_a and y_g in the author and general corpora and totals n_a and n_g, the prior is alpha_w = alpha0 * (y_a + y_g) / (n_a + n_g). The score is delta = log((y_a + alpha_w)/(n_a + alpha0 - y_a - alpha_w)) minus the same for the general corpus, divided by sqrt(1/(y_a + alpha_w) + 1/(y_g + alpha_w)). Values above about 2 are reliable differences; rare items are shrunk toward zero.
- The example sentence for each item is the first medium-length sentence (15 to 90 characters) in the author corpus that contains it; the surface form is shown in bold.

## Assumptions

- General corpus. There is no true general corpus of the period bundled, so `GENERAL_AUTHORS` in `aozora.py` lists six authors (夏目漱石, 森鴎外, 芥川竜之介, 宮沢賢治, 樋口一葉, 島崎藤村) and `fetch --general` takes the first `--per-author` works of each (default 3, works under `--min-chars` 3000 characters are skipped). Replace the list, or drop your own cleaned UTF-8 texts into `cache/general/<name>/` with a `works.json`, for a different baseline. Two 樋口一葉 texts are in classical style, which unidic segments roughly; they still serve as a contrast.
- Example run. The shipped `out/` was produced with `--limit 8` for 坂口安吾 and `--per-author 2` for the general corpus (about 39k versus 77k tokens), so z values are modest and shift with more data.
- Work order. Works are taken in index order, new orthography first when the official index is available (the mirror index has no orthography column, so order is by work id).
- Author names are matched after removing spaces; 芥川龍之介 and 森鷗外 are mapped to the Aozora spellings.
- Network. The build machine could not reach www.aozora.gr.jp (proxy policy), so the shipped example was fetched through the mirror fallback. The official path is implemented and used first whenever the host answers.

## Ideas for later

- Vertical (縦書き) mode for the HTML view, and a ruby toggle that keeps the original readings.
- A `compare` mode with two authors on both sides instead of author versus general corpus.
- Bigram and collocation lists (the score works unchanged on any counts).
- Export the reading list to Anki (tab separated word, reading, example).
