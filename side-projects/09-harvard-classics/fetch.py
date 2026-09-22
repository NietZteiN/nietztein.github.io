#!/usr/bin/env python3
"""Download Harvard Classics works from Project Gutenberg and build the passage index.

Usage:
  python3 fetch.py                 # every work in volumes.json that has an id
  python3 fetch.py --limit 3       # only the first 3 works (quick start)
  python3 fetch.py --volume 2      # only the works of one volume
  python3 fetch.py --sample        # build data/sample_index.json (and .js) from a
                                   # fixed handful of works, capped per work
  python3 fetch.py --no-download   # rebuild the index from files already in data/raw

Text sources, tried in order for each work:
  1. https://www.gutenberg.org/cache/epub/ID/pgID.txt
  2. https://www.gutenberg.org/files/ID/ID-0.txt (then ID-8.txt, ID.txt)
  3. the GITenberg mirror on raw.githubusercontent.com (mirror_repo in volumes.json)
Each URL is requested once and retried once after a pause. Requests are made one
at a time with a small delay and an identifying user agent.
"""
import argparse
import json
import os
import re
import statistics
import sys
import time
import urllib.error
import urllib.request

from hc_common import DATA_DIR, INDEX_PATH, SAMPLE_INDEX_PATH, load_volumes

RAW_DIR = os.path.join(DATA_DIR, "raw")
USER_AGENT = "harvard-classics-oracle/0.1 (personal side project; python urllib)"
DELAY_SECONDS = 1.5
TIMEOUT_SECONDS = 60
MIN_WORDS, TARGET_WORDS, MAX_WORDS = 120, 180, 250

# Works used for the bundled sample: (gutenberg id, passages kept per work).
# They are short, quotable, and spread over several volumes.
SAMPLE_WORKS = [(2680, 70), (871, 45), (575, 55), (148, 45), (18269, 55), (2944, 40), (1279, 30)]
SAMPLE_JS_PATH = os.path.join(DATA_DIR, "sample_index.js")


# --- downloading ---------------------------------------------------------------

def candidate_urls(work):
    gid = work["gutenberg_id"]
    urls = [f"https://www.gutenberg.org/cache/epub/{gid}/pg{gid}.txt",
            f"https://www.gutenberg.org/files/{gid}/{gid}-0.txt",
            f"https://www.gutenberg.org/files/{gid}/{gid}-8.txt",
            f"https://www.gutenberg.org/files/{gid}/{gid}.txt"]
    repo = work.get("mirror_repo")
    if repo:
        # Prefer the UTF-8 file (-0), then Latin-1 (-8), then the plain ASCII one.
        files = sorted(work.get("mirror_files", []),
                       key=lambda f: (0 if f.endswith("-0.txt") else 1 if f.endswith("-8.txt") else 2))
        urls += [f"https://raw.githubusercontent.com/GITenberg/{repo}/master/{f}" for f in files]
    return urls


def get_once(url):
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=TIMEOUT_SECONDS) as resp:
        return resp.read()


def decode(raw):
    for enc in ("utf-8", "latin-1"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace")


def download_work(work, delay):
    """Return the text of the work, or None. Tries each URL, once plus one retry."""
    for url in candidate_urls(work):
        for attempt in (1, 2):
            try:
                time.sleep(delay)
                raw = get_once(url)
                text = decode(raw)
                if len(text) > 2000 and "Project Gutenberg" in text[:5000] + text[-5000:]:
                    print(f"    ok   {url}")
                    return text
                print(f"    skip {url} (does not look like a Gutenberg text)")
                break
            except urllib.error.HTTPError as e:
                print(f"    http {e.code} {url}")
                if e.code == 404:
                    break  # no point retrying a missing file
            except Exception as e:  # network errors, timeouts, proxy refusals
                print(f"    fail {url} ({type(e).__name__}: {str(e)[:60]})")
            if attempt == 1:
                time.sleep(delay * 2)
    return None


# --- cleaning and splitting ------------------------------------------------------

START_RE = re.compile(r"^\*\*\* ?START OF (THE|THIS) PROJECT GUTENBERG.*$|^\*END\*THE SMALL PRINT.*$", re.M)
END_RE = re.compile(r"^\*\*\* ?END OF (THE|THIS) PROJECT GUTENBERG.*$|^End of (the )?Project Gutenberg.*$", re.M | re.I)
JUNK_RE = re.compile(r"project gutenberg|produced by|transcriber|e-?text|\bhttp|www\.|\[illustration", re.I)


def strip_gutenberg(text):
    """Cut away the licence header and footer. Falls back to the whole text."""
    m = START_RE.search(text)
    body = text[m.end():] if m else text
    m = END_RE.search(body)
    if m:
        body = body[: m.start()]
    return body.replace("\r\n", "\n").replace("\r", "\n")


def is_verse(lines):
    lengths = [len(l) for l in lines if l.strip()]
    return len(lengths) >= 3 and statistics.median(lengths) < 50


def clean_paragraph(par):
    lines = [l.rstrip() for l in par.split("\n")]
    if is_verse(lines):
        return "\n".join(l.strip() for l in lines if l.strip())
    return re.sub(r"\s+", " ", par).strip()


def looks_like_heading(par):
    words = par.split()
    if not words:
        return True
    lines = par.split("\n")
    if len(lines) >= 3 and statistics.median(len(l.split()) for l in lines) <= 4:
        return True  # a table of contents or a list of titles, not verse
    letters = re.sub(r"[^A-Za-z]", "", par)
    if len(words) <= 12 and letters and letters.upper() == letters:
        return True  # CHAPTER I, ACT II SCENE 3, etc.
    if len(words) <= 6:
        return True
    digits = sum(c.isdigit() for c in par)
    return digits > len(par) * 0.08  # tables of contents, page lists


def split_sentences(par):
    return [s for s in re.split(r"(?<=[.!?])\s+", par) if s]


def passages_from_text(body):
    """Split a cleaned text into passages of roughly MIN_WORDS to MAX_WORDS words,
    joining short paragraphs and cutting long ones at sentence boundaries."""
    out, buf, buf_words = [], [], 0

    def flush():
        nonlocal buf, buf_words
        if buf and buf_words >= MIN_WORDS:
            out.append("\n\n".join(buf))
        buf, buf_words = [], 0

    for raw_par in re.split(r"\n\s*\n", body):
        par = clean_paragraph(raw_par)
        if not par or looks_like_heading(par) or JUNK_RE.search(par):
            flush()  # a heading is a natural passage boundary
            continue
        n = len(par.split())
        if n > MAX_WORDS:
            flush()
            piece, piece_words = [], 0
            for sent in split_sentences(par.replace("\n", " ")):
                piece.append(sent)
                piece_words += len(sent.split())
                if piece_words >= TARGET_WORDS:
                    out.append(" ".join(piece))
                    piece, piece_words = [], 0
            if piece_words >= MIN_WORDS:
                out.append(" ".join(piece))
            continue
        if buf_words + n > MAX_WORDS:
            flush()
        buf.append(par)
        buf_words += n
        if buf_words >= TARGET_WORDS:
            flush()
    flush()
    return out


# --- index building -----------------------------------------------------------------

def raw_path(gid):
    return os.path.join(RAW_DIR, f"{gid}.txt")


def build_entries(work, volume, cap=None):
    with open(raw_path(work["gutenberg_id"]), encoding="utf-8") as f:
        body = strip_gutenberg(f.read())
    passages = passages_from_text(body)
    if cap and len(passages) > cap:
        # Keep an evenly spread selection rather than the first pages only.
        step = len(passages) / cap
        passages = [passages[int(i * step)] for i in range(cap)]
    gid = work["gutenberg_id"]
    return [{"volume": volume["volume"], "volume_title": volume["title"],
             "work": work["title"], "author": work["author"], "gutenberg_id": gid,
             "passage_id": f"{gid}-{i}", "text": p} for i, p in enumerate(passages)]


def iter_works(volumes, only_volume=None):
    for vol in volumes:
        if only_volume and vol["volume"] != only_volume:
            continue
        for w in vol["works"]:
            if w.get("gutenberg_id"):
                yield vol, w


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--limit", type=int, default=0, help="fetch only the first N works")
    ap.add_argument("--volume", type=int, default=0, help="fetch only this volume")
    ap.add_argument("--sample", action="store_true", help="build the bundled sample index")
    ap.add_argument("--no-download", action="store_true", help="only rebuild the index from data/raw")
    ap.add_argument("--force", action="store_true", help="download again even if the raw file exists")
    ap.add_argument("--delay", type=float, default=DELAY_SECONDS, help="seconds between requests")
    args = ap.parse_args()

    os.makedirs(RAW_DIR, exist_ok=True)
    volumes = load_volumes()
    todo = list(iter_works(volumes, args.volume or None))
    caps = {}
    if args.sample:
        wanted = dict(SAMPLE_WORKS)
        todo = [(v, w) for v, w in todo if w["gutenberg_id"] in wanted]
        caps = wanted
    if args.limit:
        todo = todo[: args.limit]

    # Download stage: one request at a time.
    fetched, failed = [], []
    for vol, work in todo:
        gid = work["gutenberg_id"]
        path = raw_path(gid)
        if os.path.exists(path) and not args.force:
            print(f"[{gid}] cached: {work['title']}")
            fetched.append((vol, work))
            continue
        if args.no_download:
            continue
        print(f"[{gid}] fetching: {work['title']} ({work['author']})")
        text = download_work(work, args.delay)
        if text is None:
            failed.append(work["title"])
            continue
        with open(path, "w", encoding="utf-8") as f:
            f.write(text)
        fetched.append((vol, work))

    # Index stage.
    entries = []
    for vol, work in fetched:
        e = build_entries(work, vol, caps.get(work["gutenberg_id"]))
        print(f"    {len(e):5d} passages  {work['title']}")
        entries.extend(e)

    if args.sample:
        out_path = SAMPLE_INDEX_PATH
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(entries, f, ensure_ascii=False, indent=0)
        # Same data as a script file, so index.html works when opened from file://
        with open(SAMPLE_JS_PATH, "w", encoding="utf-8") as f:
            f.write("window.SAMPLE_INDEX = ")
            json.dump(entries, f, ensure_ascii=False)
            f.write(";\n")
    else:
        out_path = INDEX_PATH
        # Merge with an existing index so partial runs add up.
        old = []
        if os.path.exists(out_path):
            with open(out_path, encoding="utf-8") as f:
                old = json.load(f)
        new_ids = {e["gutenberg_id"] for e in entries}
        entries = [e for e in old if e["gutenberg_id"] not in new_ids] + entries
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(entries, f, ensure_ascii=False, indent=0)
        cache = os.path.join(DATA_DIR, "tfidf.json")
        if os.path.exists(cache):
            os.remove(cache)  # the oracle rebuilds it on the next run

    print(f"\nwrote {len(entries)} passages to {out_path}")
    if failed:
        print("could not download:", "; ".join(failed))
        sys.exit(1)


if __name__ == "__main__":
    main()
