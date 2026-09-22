#!/usr/bin/env python3
"""Ask the Harvard Classics a question and get a passage back.

  python3 oracle.py "I feel restless and want courage"
  python3 oracle.py --n 3 "what is friendship"
  python3 oracle.py --random                 # a pure fortune cookie
  python3 oracle.py --sample "..."           # use the bundled sample even if the
                                             # full index exists

Scoring is TF-IDF cosine similarity over the passages, built on the first run
and cached in data/tfidf.json. Query words are stemmed and expanded with the
small mood lexicon in hc_common.py.
"""
import argparse
import json
import math
import os
import random
import sys
import textwrap
from collections import Counter

from hc_common import DATA_DIR, LEXICON, find_index_path, load_index, stem, tokenize

CACHE_PATH = os.path.join(DATA_DIR, "tfidf.json")
EXPANSION_WEIGHT = 0.35  # weight of a lexicon word relative to a typed word


# --- TF-IDF model -----------------------------------------------------------------

def build_model(index):
    docs = [Counter(tokenize(e["text"])) for e in index]
    df = Counter()
    for d in docs:
        df.update(d.keys())
    n = len(docs)
    idf = {t: math.log((n + 1) / (c + 1)) + 1.0 for t, c in df.items()}
    vectors = []
    for d in docs:
        # sublinear tf, then unit length so cosine is a plain dot product
        vec = {t: (1 + math.log(c)) * idf[t] for t, c in d.items()}
        norm = math.sqrt(sum(v * v for v in vec.values())) or 1.0
        vectors.append({t: v / norm for t, v in vec.items()})
    return {"idf": idf, "vectors": vectors}


def cache_key(path):
    st = os.stat(path)
    return f"{os.path.abspath(path)}|{st.st_size}|{int(st.st_mtime)}"


def load_model(index, index_path):
    key = cache_key(index_path)
    if os.path.exists(CACHE_PATH):
        try:
            with open(CACHE_PATH, encoding="utf-8") as f:
                cached = json.load(f)
            if cached.get("key") == key:
                return cached
        except (json.JSONDecodeError, OSError):
            pass
    model = build_model(index)
    model["key"] = key
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(CACHE_PATH, "w", encoding="utf-8") as f:
        json.dump(model, f)
    return model


def expand_query(query):
    """Stemmed query terms with weights; lexicon neighbours get a smaller weight."""
    weights = Counter()
    for t in tokenize(query):
        weights[t] += 1.0
    lexicon_stemmed = {stem(k): v for k, v in LEXICON.items()}
    for t in list(weights):
        for word in lexicon_stemmed.get(t, []):
            s = stem(word)
            if s != t:
                weights[s] += EXPANSION_WEIGHT
    return weights


def search(query, index, model, n):
    qw = expand_query(query)
    idf = model["idf"]
    qvec = {t: w * idf[t] for t, w in qw.items() if t in idf}
    if not qvec:
        return []
    qnorm = math.sqrt(sum(v * v for v in qvec.values()))
    typed = [t for t in set(tokenize(query)) if t in idf] or [None]
    scored = []
    for i, vec in enumerate(model["vectors"]):
        s = sum(v * vec[t] for t, v in qvec.items() if t in vec)
        if s > 0:
            # Cosine similarity, with a bonus for covering more of the typed
            # words (so a passage with both "restless" and "courage" beats one
            # that repeats only one of them).
            coverage = sum(1 for t in typed if t in vec) / len(typed)
            scored.append((s / qnorm * (1 + coverage), i))
    scored.sort(reverse=True)
    return [(score, index[i]) for score, i in scored[:n]]


# --- output ----------------------------------------------------------------------

def format_passage(entry, score=None):
    text = entry["text"]
    if "\n" in text:  # verse: keep the line breaks
        body = text
    else:
        body = textwrap.fill(text, width=78)
    line = f"{entry['author']}, {entry['work']} (Harvard Classics vol. {entry['volume']}, {entry['volume_title']})"
    tail = f"  [relevance {score:.2f}]" if score is not None else ""
    return f"{body}\n\n    -- {line}{tail}"


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("query", nargs="*", help="a question, a mood, a few words")
    ap.add_argument("--n", type=int, default=1, help="number of passages to show")
    ap.add_argument("--random", action="store_true", help="ignore the query, pick at random")
    ap.add_argument("--sample", action="store_true", help="use data/sample_index.json")
    ap.add_argument("--seed", type=int, help="seed for --random (for reproducible runs)")
    args = ap.parse_args()

    index_path = find_index_path(prefer_sample=args.sample)
    if not index_path:
        sys.exit("No index found. Run: python3 fetch.py --sample   (or fetch.py --limit 3)")
    index = load_index(index_path)

    if args.random or not args.query:
        if not args.random:
            print("(no query given, drawing at random; pass a question to search)\n")
        rng = random.Random(args.seed)
        for entry in rng.sample(index, min(args.n, len(index))):
            print(format_passage(entry))
            print()
        return

    query = " ".join(args.query)
    model = load_model(index, index_path)
    results = search(query, index, model, args.n)
    if not results:
        print("Nothing in the index matches those words. Try other words, or --random.")
        return
    print(f'Oracle for: "{query}"\n')
    for score, entry in results:
        print(format_passage(entry, score))
        print()


if __name__ == "__main__":
    main()
