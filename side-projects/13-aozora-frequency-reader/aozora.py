#!/usr/bin/env python3
"""Aozora Bunko frequency reader.

Downloads an author's works from Aozora Bunko, tokenizes them locally with
fugashi (MeCab with the unidic-lite dictionary), counts word and kanji
frequencies, and ranks them by how specific they are to that author compared
with a small general corpus of other Aozora authors. The specificity score is
the z-scored log odds ratio with an informative Dirichlet prior (Monroe,
Colaresi and Quinn 2008, "Fightin' Words").

Subcommands:
  fetch    download and clean texts into cache/ (author or --general corpus)
  analyze  count, score and write the Markdown reading lists (and one HTML view)
  render   make the HTML view for any cleaned text file from saved statistics

Run `python3 aozora.py --help` for the flags.
"""

import argparse
import csv
import html
import io
import json
import math
import re
import sys
import time
import urllib.error
import urllib.request
import zipfile
from collections import Counter, defaultdict
from pathlib import Path

BASE = Path(__file__).resolve().parent
CACHE = BASE / "cache"
OUT = BASE / "out"

USER_AGENT = "aozora-frequency-reader/0.1 (personal research tool; one request at a time)"

# ---------------------------------------------------------------------------
# Configuration. Change these lines to use different sources or authors.
# ---------------------------------------------------------------------------

# Official Aozora Bunko index (a static zip with one CSV inside).
AOZORA_INDEX_URL = "https://www.aozora.gr.jp/index_pages/list_person_all_extended_utf8.zip"

# Fallback mirror: levelevel/AozoraTxt on GitHub keeps the raw Shift_JIS text
# files that sit inside the official zips, plus a small title index. It is
# used when www.aozora.gr.jp is unreachable (for example behind a proxy).
MIRROR_RAW = "https://raw.githubusercontent.com/levelevel/AozoraTxt/master/"
MIRROR_INDEX_URL = MIRROR_RAW + "csv/title.csv"

# Stand-in for a general corpus: a few works each from these authors. Replace
# the list (or point GENERAL_DIR at your own cleaned texts) for a different
# baseline. Names are written the way Aozora spells them.
GENERAL_AUTHORS = ["夏目漱石", "森鴎外", "芥川竜之介", "宮沢賢治", "樋口一葉", "島崎藤村"]
GENERAL_DIR = CACHE / "general"

# Common alternative spellings mapped to the Aozora spelling.
AUTHOR_ALIASES = {"芥川龍之介": "芥川竜之介", "森鷗外": "森鴎外", "夏目漱石": "夏目漱石"}

# Parts of speech that carry little lexical meaning; skipped when counting.
SKIP_POS1 = {"助詞", "助動詞", "補助記号", "記号", "空白"}
SKIP_POS2 = {"数詞", "非自立可能"}          # numerals; light verbs like いる, ある, くる, しまう

# Formal nouns and light verbs that top every list without saying much about
# the author. Edit freely; an empty set keeps everything.
STOPWORDS = {"こと", "事", "もの", "物", "よう", "様", "ため", "為", "の", "ん", "する", "為る",
             "なる", "成る", "いう", "云う", "言う", "その", "この", "あの", "それ", "これ", "あれ"}


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------

def norm_author(name):
    """Remove spaces and apply aliases so 坂口 安吾 and 坂口安吾 match."""
    name = re.sub(r"[\s　]+", "", name)
    return AUTHOR_ALIASES.get(name, name)


def safe_name(title):
    """A file-name-safe version of a title."""
    return re.sub(r"[\\/:*?\"<>|\s　]+", "_", title)[:60]


def http_get(url, retries=2, delay=1.0, timeout=60):
    """Polite GET: user agent, a pause before each request, a couple of retries."""
    last = None
    for attempt in range(retries + 1):
        time.sleep(delay * (attempt + 1))
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return resp.read()
        except (urllib.error.URLError, urllib.error.HTTPError, OSError) as exc:
            last = exc
            print(f"  request failed ({exc}); attempt {attempt + 1} of {retries + 1}", file=sys.stderr)
    raise RuntimeError(f"could not download {url}: {last}")


def katakana_to_hiragana(s):
    return "".join(chr(ord(c) - 0x60) if "ァ" <= c <= "ヶ" else c for c in s or "")


def is_kanji(c):
    return ("一" <= c <= "鿿") or ("㐀" <= c <= "䶿") or ("豈" <= c <= "﫿") or c == "々"


# ---------------------------------------------------------------------------
# Aozora markup
# ---------------------------------------------------------------------------

RUBY_WITH_BAR = re.compile(r"｜([^《｜\n]*)《[^》]*》")
RUBY = re.compile(r"《[^》]*》")
ANNOTATION = re.compile(r"※?［＃[^］]*］")


def strip_aozora(raw):
    """Return (title, author, body) with Aozora Bunko markup removed.

    The header is the title and author lines plus the block between the two
    dashed lines that explains the notation. The trailer starts at the first
    line beginning with 底本 (source edition) and runs to the end.
    """
    lines = raw.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    head = [l.strip() for l in lines[:6] if l.strip()]
    title = head[0] if head else ""
    author = head[1] if len(head) > 1 else ""

    dashed = [i for i, l in enumerate(lines[:80]) if l.startswith("-----")]
    if len(dashed) >= 2:
        start = dashed[1] + 1
    else:
        # No notation block: skip the leading non-empty lines (title, author).
        start = 0
        while start < len(lines) and lines[start].strip():
            start += 1

    end = len(lines)
    for i in range(start, len(lines)):
        if lines[i].startswith(("底本：", "底本:")):
            end = i
            break

    body = "\n".join(lines[start:end])
    body = RUBY_WITH_BAR.sub(r"\1", body)
    body = RUBY.sub("", body)
    body = body.replace("｜", "")
    body = ANNOTATION.sub("", body)
    body = re.sub(r"\n{3,}", "\n\n", body).strip("\n")
    return title, author, body


# ---------------------------------------------------------------------------
# Indexes: which works exist for an author, and where their text lives
# ---------------------------------------------------------------------------

def load_official_index():
    """Rows of the official CSV (list of dicts), downloaded once into cache/index."""
    path = CACHE / "index" / "list_person_all_extended_utf8.csv"
    if not path.exists():
        print("downloading the official Aozora index ...")
        data = http_get(AOZORA_INDEX_URL)
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            name = [n for n in zf.namelist() if n.endswith(".csv")][0]
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(zf.read(name))
    with open(path, encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def official_works(author):
    """Works by `author` from the official index, new orthography first."""
    rows = load_official_index()
    works = {}
    for r in rows:
        if norm_author(r["姓"] + r["名"]) != author or r["役割フラグ"] != "著者":
            continue
        url = r["テキストファイルURL"].strip()
        if not url or r["作品ID"] in works:
            continue
        works[r["作品ID"]] = {
            "id": r["作品ID"].lstrip("0"),
            "title": r["作品名"],
            "author": author,
            "url": url,
            "card": r["図書カードURL"],
            "orthography": r["文字遣い種別"],
            "source": "aozora",
        }
    return sorted(works.values(), key=lambda w: (not w["orthography"].startswith("新字新仮名"), int(w["id"])))


def load_mirror_index():
    path = CACHE / "index" / "mirror_title.csv"
    if not path.exists():
        print("downloading the mirror index (levelevel/AozoraTxt csv/title.csv) ...")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(http_get(MIRROR_INDEX_URL))
    with open(path, encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def mirror_works(author):
    works = []
    for r in load_mirror_index():
        if norm_author(r["作家名"]) != author or r["訳者名"].strip():
            continue
        rel = r["ファイル名"].strip()          # 001095/42620_ruby_utf8_darakuron.txt
        person, fname = rel.split("/", 1)
        work_id = fname.split("_", 1)[0]
        works.append({
            "id": work_id,
            "title": r["作品名"],
            "author": author,
            "url": MIRROR_RAW + "person/" + person + "/" + fname.replace("_utf8", "", 1),
            "card": f"https://www.aozora.gr.jp/cards/{person}/card{work_id}.html",
            "orthography": "",
            "source": "mirror",
        })
    return sorted(works, key=lambda w: int(w["id"]))


_official_down = False


def list_works(author, source):
    """Try the official index, then the mirror, depending on --source."""
    global _official_down
    if source == "aozora" or (source == "auto" and not _official_down):
        try:
            return official_works(author)
        except RuntimeError as exc:
            if source == "aozora":
                raise
            _official_down = True
            print(f"official site unavailable ({exc}); falling back to the GitHub mirror", file=sys.stderr)
    return mirror_works(author)


def download_text(work, delay):
    """Fetch one work and return the cleaned body (Shift_JIS decoded as cp932)."""
    data = http_get(work["url"], delay=delay)
    if work["url"].endswith(".zip"):
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            names = [n for n in zf.namelist() if n.lower().endswith(".txt")]
            if not names:
                raise RuntimeError("zip without a .txt file: " + work["url"])
            data = zf.read(names[0])
    raw = data.decode("cp932", errors="replace")
    _, _, body = strip_aozora(raw)
    return body


# ---------------------------------------------------------------------------
# Corpus cache: cache/<author>/works.json + one cleaned .txt per work
# ---------------------------------------------------------------------------

def corpus_dir(author, general=False):
    return (GENERAL_DIR if general else CACHE) / author


def load_corpus(author, general=False):
    """List of (work dict, text) for the cached works of an author."""
    d = corpus_dir(author, general)
    meta = d / "works.json"
    if not meta.exists():
        return []
    out = []
    for w in json.loads(meta.read_text(encoding="utf-8")):
        p = d / w["file"]
        if p.exists():
            out.append((w, p.read_text(encoding="utf-8")))
    return out


def save_work(d, works_meta, work, text):
    fname = f"{work['id']}_{safe_name(work['title'])}.txt"
    d.mkdir(parents=True, exist_ok=True)
    (d / fname).write_text(text, encoding="utf-8")
    entry = dict(work, file=fname, chars=len(text))
    works_meta[:] = [m for m in works_meta if m["id"] != work["id"]] + [entry]
    (d / "works.json").write_text(json.dumps(works_meta, ensure_ascii=False, indent=1), encoding="utf-8")


def fetch_author(author, limit, source, delay, general=False, min_chars=0):
    """Download up to `limit` works. With min_chars, shorter texts are skipped."""
    works = list_works(author, source)
    if not works:
        print(f"no works found for {author}", file=sys.stderr)
        return
    d = corpus_dir(author, general)
    meta = json.loads((d / "works.json").read_text(encoding="utf-8")) if (d / "works.json").exists() else []
    have = {m["id"] for m in meta}
    print(f"{author}: {len(works)} works in the index, {len(have)} already cached")
    kept = len(have)
    attempts = 0
    for w in works:
        if limit and kept >= limit:
            break
        if w["id"] in have:
            continue
        if limit and attempts >= 4 * limit:
            break
        attempts += 1
        print(f"  {w['title']} ({w['source']}) ...", end=" ", flush=True)
        try:
            text = download_text(w, delay)
        except RuntimeError as exc:
            print(f"failed: {exc}")
            continue
        if len(text) < min_chars:
            print(f"skipped, only {len(text)} characters")
            continue
        save_work(d, meta, w, text)
        kept += 1
        print(f"{len(text)} characters")


# ---------------------------------------------------------------------------
# Tokenization and counting
# ---------------------------------------------------------------------------

_tagger = None


def tagger():
    global _tagger
    if _tagger is None:
        from fugashi import Tagger  # imported lazily so fetch works without it
        _tagger = Tagger()
    return _tagger


SENTENCE_END = re.compile(r"(?<=[。！？!?])")


def sentences(text):
    for para in text.split("\n"):
        for s in SENTENCE_END.split(para):
            s = s.strip("　 \t")
            if s:
                yield s


def word_key(feature):
    """Counting key: the base form in the author's own orthography.

    orthBase keeps 堕ちる apart from 落ちる, which matters for a reading list.
    unidic writes loanword lemmas as カタカナ-english; the English tail is cut.
    """
    key = feature.orthBase or feature.lemma
    if not key:
        return None
    if "-" in key and key.split("-", 1)[1].isascii():
        key = key.split("-", 1)[0]
    return key


def keep_token(w):
    f = w.feature
    if f.pos1 in SKIP_POS1 or f.pos2 in SKIP_POS2:
        return False
    if not any(ch.isalpha() for ch in w.surface):
        return False
    return (f.orthBase or f.lemma) not in STOPWORDS


def example_score(sentence):
    """Prefer medium-length sentences as examples: shorter than 90, longer than 15."""
    n = len(sentence)
    if 15 <= n <= 90:
        return 0
    return abs(n - 50)


def count_corpus(texts, want_examples=False):
    """Count words and kanji over a list of texts.

    Returns a dict with Counters and, for the author corpus, the best example
    sentence per word and per kanji, the reading and part of speech per word.
    """
    words, kanji = Counter(), Counter()
    info = {}
    ex_word, ex_kanji = {}, {}
    tg = tagger()
    for text in texts:
        for s in sentences(text):
            score = example_score(s)
            seen_here = set()
            for w in tg(s):
                if not keep_token(w):
                    continue
                key = word_key(w.feature)
                if not key:
                    continue
                words[key] += 1
                if key not in info:
                    f = w.feature
                    pos = f.pos1 + ("-" + f.pos2 if f.pos2 and f.pos2 != "*" else "")
                    info[key] = {"reading": katakana_to_hiragana(f.lForm or f.kana or ""), "pos": pos}
                if want_examples and key not in seen_here:
                    seen_here.add(key)
                    if key not in ex_word or score < ex_word[key][0]:
                        ex_word[key] = (score, s, w.surface)
            for c in s:
                if is_kanji(c):
                    kanji[c] += 1
            if want_examples:
                for c in set(s):
                    if is_kanji(c) and (c not in ex_kanji or score < ex_kanji[c][0]):
                        ex_kanji[c] = (score, s)
    return {"words": words, "kanji": kanji, "info": info, "ex_word": ex_word, "ex_kanji": ex_kanji}


# ---------------------------------------------------------------------------
# Specificity: log odds ratio with an informative Dirichlet prior
# ---------------------------------------------------------------------------

def log_odds_z(counts_a, counts_b, alpha0):
    """z-scored log odds of each item in corpus A versus corpus B.

    The prior for item w is alpha0 * (its pooled frequency), so rare items are
    shrunk toward zero and frequent items need a large imbalance to score high.
    See Monroe, Colaresi and Quinn (2008), equations 15 to 22.
    """
    n_a, n_b = sum(counts_a.values()), sum(counts_b.values())
    n_all = n_a + n_b
    z = {}
    for w in set(counts_a) | set(counts_b):
        ya, yb = counts_a.get(w, 0), counts_b.get(w, 0)
        aw = alpha0 * (ya + yb) / n_all
        delta = (math.log((ya + aw) / (n_a + alpha0 - ya - aw))
                 - math.log((yb + aw) / (n_b + alpha0 - yb - aw)))
        var = 1.0 / (ya + aw) + 1.0 / (yb + aw)
        z[w] = delta / math.sqrt(var)
    return z


# ---------------------------------------------------------------------------
# Output: Markdown lists, statistics JSON, HTML view
# ---------------------------------------------------------------------------

def md_cell(s):
    return s.replace("|", "｜").replace("\n", " ")


def bold_in(sentence, target):
    """Bold the first occurrence of target in the sentence (Markdown)."""
    i = sentence.find(target)
    if i < 0:
        return md_cell(sentence)
    return md_cell(sentence[:i]) + "**" + md_cell(target) + "**" + md_cell(sentence[i + len(target):])


def method_note(author, works, n_a, n_g, general_works, alpha0):
    titles = "、".join(w["title"] for w in works)
    return (
        f"Author corpus: {len(works)} works by {author} ({n_a:,} tokens): {titles}.\n\n"
        f"General corpus: {len(general_works)} works by "
        + "、".join(sorted({w['author'] for w in general_works}))
        + f" ({n_g:,} tokens). This is a small stand-in for a general corpus of the same period.\n\n"
        f"Score: z of the log odds ratio with an informative Dirichlet prior "
        f"(Monroe et al. 2008), prior strength alpha0 = {alpha0}. Positive z means the item is more "
        f"typical of {author} than of the general corpus; |z| above about 2 is a reliable difference. "
        f"Tokens are unidic base forms in the author's orthography; particles, auxiliaries, symbols, "
        f"numerals, light verbs and a few formal nouns are skipped.\n"
    )


def write_words_md(path, author, rows, note):
    lines = [f"# {author}: words to know\n", note, "",
             "| # | word | reading | pos | author | general | z | example |",
             "|---:|---|---|---|---:|---:|---:|---|"]
    for i, r in enumerate(rows, 1):
        ex = bold_in(r["example"], r["surface"]) if r["example"] else ""
        lines.append(f"| {i} | {r['word']} | {r['reading']} | {r['pos']} | {r['a']} | {r['g']} | {r['z']:.1f} | {ex} |")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def write_kanji_md(path, author, rows, note):
    lines = [f"# {author}: kanji to know\n", note, "",
             "| # | kanji | author | general | z | words | example |",
             "|---:|---|---:|---:|---:|---|---|"]
    for i, r in enumerate(rows, 1):
        ex = bold_in(r["example"], r["kanji"]) if r["example"] else ""
        lines.append(f"| {i} | {r['kanji']} | {r['a']} | {r['g']} | {r['z']:.1f} | {'、'.join(r['words'])} | {ex} |")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


HTML_TEMPLATE = """<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>__TITLE__</title>
<style>
:root {
  --bg: #15171c; --panel: #1d2027; --text: #e6e1d8; --muted: #8f8a80;
  --line: #2c3039; --accent: 255, 170, 90; --active: 120, 200, 255;
  --serif: "Noto Serif JP", "Hiragino Mincho ProN", "Yu Mincho", "YuMincho", "MS Mincho", serif;
  --sans: "Noto Sans JP", "Hiragino Sans", "Yu Gothic", system-ui, sans-serif;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font-family: var(--serif); }
header { padding: 28px 32px 16px; border-bottom: 1px solid var(--line); }
header h1 { margin: 0 0 4px; font-size: 26px; font-weight: 600; letter-spacing: .04em; }
header .meta { color: var(--muted); font-family: var(--sans); font-size: 13px; }
.layout { display: grid; grid-template-columns: minmax(0, 1fr) 300px; gap: 0; }
main { padding: 28px 40px 80px; max-width: 820px; margin: 0 auto; width: 100%; font-size: 18px; line-height: 2.05; }
main p { margin: 0 0 1em; text-indent: 1em; }
aside { border-left: 1px solid var(--line); background: var(--panel); padding: 20px 20px 60px;
        font-family: var(--sans); font-size: 13px; position: sticky; top: 0; height: 100vh; overflow-y: auto; }
aside h2 { margin: 0 0 6px; font-size: 13px; text-transform: uppercase; letter-spacing: .12em; color: var(--muted); font-weight: 500; }
aside .hint { color: var(--muted); margin: 0 0 14px; line-height: 1.5; }
aside label { display: block; color: var(--muted); margin-bottom: 6px; }
aside input[type=range] { width: 100%; accent-color: rgb(var(--accent)); }
aside ol { list-style: none; padding: 0; margin: 14px 0 0; }
aside li { display: flex; justify-content: space-between; align-items: baseline; padding: 5px 6px; border-radius: 5px; cursor: pointer; gap: 8px; }
aside li:hover, aside li.on { background: rgba(var(--active), .15); }
aside li .w { font-family: var(--serif); font-size: 16px; }
aside li .r { color: var(--muted); font-size: 11px; margin-left: 6px; }
aside li .n { color: var(--muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
.w { border-radius: 3px; padding: 0 1px; background: rgba(var(--accent), calc(var(--s) * .55)); cursor: help; transition: background .15s; }
.w.off { background: transparent; cursor: inherit; }
.w.on { background: rgba(var(--active), .55); }
#tip { position: fixed; pointer-events: none; background: #f2eee6; color: #1b1c20; font-family: var(--sans);
       font-size: 13px; line-height: 1.5; padding: 8px 11px; border-radius: 6px; box-shadow: 0 6px 20px rgba(0,0,0,.4);
       display: none; max-width: 280px; z-index: 10; }
#tip b { font-family: var(--serif); font-size: 16px; }
#tip .g { color: #6b665c; }
@media (max-width: 800px) { .layout { grid-template-columns: 1fr; } aside { position: static; height: auto; border-left: 0; border-top: 1px solid var(--line); } main { padding: 20px 16px 40px; } }
</style>
</head>
<body>
<header>
  <h1>__TITLE__</h1>
  <div class="meta">__AUTHOR__ · highlighted words are the ones most specific to this author against the general corpus (__NWORDS__ types in this text). Hover a word for its reading and counts.</div>
</header>
<div class="layout">
<main id="text">
__BODY__
</main>
<aside>
  <h2>Threshold</h2>
  <label>show words with z &ge; <span id="zval">__ZMIN__</span></label>
  <input type="range" id="zmin" min="__ZLO__" max="__ZHI__" step="0.1" value="__ZMIN__">
  <p class="hint">Color intensity follows z. Higher thresholds keep only the strongest author-specific words.</p>
  <h2>Top words in this text</h2>
  <p class="hint">Sorted by z; the number is occurrences here. Click to mark every occurrence and jump to the first.</p>
  <ol id="list">
__LIST__
  </ol>
</aside>
</div>
<div id="tip"></div>
<script>
(function () {
  var spans = Array.prototype.slice.call(document.querySelectorAll('.w'));
  var tip = document.getElementById('tip');
  var slider = document.getElementById('zmin');
  var zval = document.getElementById('zval');
  var list = document.getElementById('list');

  function applyThreshold() {
    var t = parseFloat(slider.value);
    zval.textContent = t.toFixed(1);
    spans.forEach(function (s) { s.classList.toggle('off', parseFloat(s.dataset.z) < t); });
    Array.prototype.forEach.call(list.children, function (li) {
      li.style.display = parseFloat(li.dataset.z) < t ? 'none' : '';
    });
  }
  slider.addEventListener('input', applyThreshold);
  applyThreshold();

  document.getElementById('text').addEventListener('mouseover', function (e) {
    var s = e.target.closest('.w');
    if (!s || s.classList.contains('off')) { tip.style.display = 'none'; return; }
    tip.innerHTML = '<b>' + s.dataset.w + '</b> <span class="g">' + s.dataset.r + '</span><br>' +
      '<span class="g">' + s.dataset.p + '</span><br>' +
      'author ' + s.dataset.a + ' · general ' + s.dataset.g + ' · z ' + parseFloat(s.dataset.z).toFixed(1);
    tip.style.display = 'block';
  });
  document.getElementById('text').addEventListener('mousemove', function (e) {
    var x = e.clientX + 14, y = e.clientY + 16;
    if (x + 290 > window.innerWidth) x = e.clientX - 290;
    if (y + 90 > window.innerHeight) y = e.clientY - 90;
    tip.style.left = x + 'px'; tip.style.top = y + 'px';
  });
  document.getElementById('text').addEventListener('mouseout', function () { tip.style.display = 'none'; });

  var current = null;
  list.addEventListener('click', function (e) {
    var li = e.target.closest('li');
    if (!li) return;
    var w = li.dataset.w;
    spans.forEach(function (s) { s.classList.toggle('on', s.dataset.w === w && current !== w); });
    Array.prototype.forEach.call(list.children, function (x) { x.classList.toggle('on', x === li && current !== w); });
    if (current === w) { current = null; return; }
    current = w;
    var first = spans.filter(function (s) { return s.dataset.w === w; })[0];
    if (first) first.scrollIntoView({ block: 'center', behavior: 'smooth' });
  });
})();
</script>
</body>
</html>
"""


def render_html(path, title, author, text, stats, top_n=40, zmin=2.0):
    """Write a self-contained HTML page of `text` with author-specific words marked."""
    words = stats["words"]
    zs = [v["z"] for v in words.values() if v["z"] >= zmin]
    z_hi = max(zs) if zs else zmin + 1
    tg = tagger()
    paras = []
    in_text = Counter()
    for para in text.split("\n"):
        if not para.strip():
            continue
        parts = []
        for w in tg(para):
            surface = html.escape(w.white_space + w.surface)
            key = word_key(w.feature) if keep_token(w) else None
            v = words.get(key) if key else None
            if v and v["z"] >= zmin:
                in_text[key] += 1
                s = min(1.0, 0.25 + 0.75 * (v["z"] - zmin) / max(z_hi - zmin, 1e-9))
                parts.append(
                    f'<span class="w" style="--s:{s:.2f}" data-w="{html.escape(key)}" data-z="{v["z"]:.2f}" '
                    f'data-r="{html.escape(v["reading"])}" data-p="{html.escape(v["pos"])}" '
                    f'data-a="{v["a"]}" data-g="{v["g"]}">{surface}</span>')
            else:
                parts.append(surface)
        paras.append("<p>" + "".join(parts) + "</p>")
    ranked = sorted(in_text, key=lambda k: -words[k]["z"])[:top_n]
    items = "\n".join(
        f'    <li data-w="{html.escape(k)}" data-z="{words[k]["z"]:.2f}"><span><span class="w">{html.escape(k)}</span>'
        f'<span class="r">{html.escape(words[k]["reading"])}</span></span><span class="n">{in_text[k]} · z {words[k]["z"]:.1f}</span></li>'
        for k in ranked)
    page = (HTML_TEMPLATE.replace("__TITLE__", html.escape(title)).replace("__AUTHOR__", html.escape(author))
            .replace("__NWORDS__", str(len(in_text))).replace("__BODY__", "\n".join(paras))
            .replace("__LIST__", items).replace("__ZMIN__", f"{zmin:.1f}")
            .replace("__ZLO__", f"{zmin:.1f}").replace("__ZHI__", f"{max(z_hi, zmin + 1):.1f}"))
    path.write_text(page, encoding="utf-8")


# ---------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------

def cmd_fetch(args):
    CACHE.mkdir(exist_ok=True)
    if args.general:
        for a in GENERAL_AUTHORS:
            fetch_author(a, args.per_author, args.source, args.delay, general=True, min_chars=args.min_chars)
    if args.author:
        fetch_author(norm_author(args.author), args.limit, args.source, args.delay)
    if not args.general and not args.author:
        print("nothing to do: give --author NAME and/or --general", file=sys.stderr)


def pick_work(corpus, name):
    exact = [(w, t) for w, t in corpus if w["title"] == name]
    if exact:
        return exact[0]
    partial = [(w, t) for w, t in corpus if name in w["title"]]
    if len(partial) == 1:
        return partial[0]
    titles = ", ".join(w["title"] for w, _ in corpus)
    raise SystemExit(f"--work {name!r} does not name one cached work. Cached: {titles}")


def cmd_analyze(args):
    author = norm_author(args.author)
    corpus = load_corpus(author)
    if not corpus:
        raise SystemExit(f"no cached texts for {author}; run: python3 aozora.py fetch --author {author}")
    general = []
    for a in GENERAL_AUTHORS:
        if a != author:
            general.extend(load_corpus(a, general=True))
    if not general:
        raise SystemExit("no general corpus cached; run: python3 aozora.py fetch --general")

    print(f"tokenizing {len(corpus)} works by {author} and {len(general)} general works ...")
    A = count_corpus([t for _, t in corpus], want_examples=True)
    G = count_corpus([t for _, t in general])
    z_words = log_odds_z(A["words"], G["words"], args.prior)
    z_kanji = log_odds_z(A["kanji"], G["kanji"], args.prior)
    n_a, n_g = sum(A["words"].values()), sum(G["words"].values())
    works_meta = [w for w, _ in corpus]
    general_meta = [w for w, _ in general]
    note = method_note(author, works_meta, n_a, n_g, general_meta, args.prior)

    # Statistics for every word that clears --min-count; saved so `render` works offline.
    stats = {"author": author, "tokens_author": n_a, "tokens_general": n_g, "prior": args.prior,
             "works": [w["title"] for w in works_meta], "words": {}, "kanji": {}}
    for k, c in A["words"].items():
        if c >= args.min_count:
            stats["words"][k] = {"z": round(z_words[k], 3), "a": c, "g": G["words"].get(k, 0),
                                 "reading": A["info"][k]["reading"], "pos": A["info"][k]["pos"]}
    for k, c in A["kanji"].items():
        if c >= args.min_count:
            stats["kanji"][k] = {"z": round(z_kanji[k], 3), "a": c, "g": G["kanji"].get(k, 0)}

    OUT.mkdir(exist_ok=True)
    top_words = sorted(stats["words"], key=lambda k: -stats["words"][k]["z"])[:args.top]
    rows = []
    for k in top_words:
        v = stats["words"][k]
        ex = A["ex_word"].get(k)
        rows.append(dict(word=k, reading=v["reading"], pos=v["pos"], a=v["a"], g=v["g"], z=v["z"],
                         example=ex[1] if ex else "", surface=ex[2] if ex else k))
    write_words_md(OUT / f"{author}_words.md", author, rows, note)

    top_kanji = sorted(stats["kanji"], key=lambda k: -stats["kanji"][k]["z"])[:args.top]
    by_kanji = defaultdict(list)
    for k, c in A["words"].most_common():
        for ch in set(k):
            if is_kanji(ch) and len(by_kanji[ch]) < 3:
                by_kanji[ch].append(k)
    rows = []
    for k in top_kanji:
        v = stats["kanji"][k]
        ex = A["ex_kanji"].get(k)
        rows.append(dict(kanji=k, a=v["a"], g=v["g"], z=v["z"], words=by_kanji.get(k, []), example=ex[1] if ex else ""))
    write_kanji_md(OUT / f"{author}_kanji.md", author, rows, note)

    (OUT / f"{author}_stats.json").write_text(json.dumps(stats, ensure_ascii=False), encoding="utf-8")
    print(f"wrote {OUT / (author + '_words.md')}, {OUT / (author + '_kanji.md')}, {OUT / (author + '_stats.json')}")

    if args.work:
        work, text = pick_work(corpus, args.work)
        out = OUT / f"{author}_{safe_name(work['title'])}.html"
        render_html(out, work["title"], author, text, stats, top_n=args.side, zmin=args.zmin)
        print(f"wrote {out}")


def cmd_render(args):
    author = norm_author(args.author)
    stats_path = OUT / f"{author}_stats.json"
    if not stats_path.exists():
        raise SystemExit(f"{stats_path} not found; run analyze first")
    stats = json.loads(stats_path.read_text(encoding="utf-8"))
    src = Path(args.text)
    raw = src.read_text(encoding="utf-8")
    title = args.title or src.stem.split("_", 1)[-1]
    if "《" in raw or "［＃" in raw:  # a raw Aozora file rather than a cleaned one
        t, _, raw = strip_aozora(raw)
        title = args.title or t
    out = Path(args.out) if args.out else OUT / f"{author}_{safe_name(title)}.html"
    render_html(out, title, author, raw, stats, top_n=args.side, zmin=args.zmin)
    print(f"wrote {out}")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    f = sub.add_parser("fetch", help="download and clean texts into cache/")
    f.add_argument("--author", help="author name as Aozora spells it, e.g. 坂口安吾")
    f.add_argument("--limit", type=int, default=0, help="cap the number of works (0 = all)")
    f.add_argument("--general", action="store_true", help="fetch the general comparison corpus")
    f.add_argument("--per-author", type=int, default=3, help="works per general author (default 3)")
    f.add_argument("--min-chars", type=int, default=3000, help="skip general works shorter than this")
    f.add_argument("--source", choices=["auto", "aozora", "mirror"], default="auto",
                   help="auto tries www.aozora.gr.jp and falls back to the GitHub mirror")
    f.add_argument("--delay", type=float, default=1.0, help="seconds to wait before each request")
    f.set_defaults(func=cmd_fetch)

    a = sub.add_parser("analyze", help="score words and kanji, write out/ lists")
    a.add_argument("--author", required=True)
    a.add_argument("--work", help="title of one cached work to render as HTML")
    a.add_argument("--min-count", type=int, default=3, help="minimum count in the author corpus")
    a.add_argument("--top", type=int, default=200, help="rows in each Markdown list")
    a.add_argument("--prior", type=float, default=500.0, help="Dirichlet prior strength alpha0")
    a.add_argument("--zmin", type=float, default=2.0, help="lowest z that gets highlighted in HTML")
    a.add_argument("--side", type=int, default=40, help="words in the HTML side list")
    a.set_defaults(func=cmd_analyze)

    r = sub.add_parser("render", help="HTML view of a text file using saved out/<author>_stats.json")
    r.add_argument("--author", required=True)
    r.add_argument("--text", required=True, help="a cleaned or raw Aozora text file (UTF-8)")
    r.add_argument("--title", help="title for the page (default: from the file)")
    r.add_argument("--out", help="output path (default: out/<author>_<title>.html)")
    r.add_argument("--zmin", type=float, default=2.0)
    r.add_argument("--side", type=int, default=40)
    r.set_defaults(func=cmd_render)

    args = ap.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
