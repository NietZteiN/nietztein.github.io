#!/usr/bin/env python3
"""Append every title from the arXiv feeds to data/titles.txt.

The file is a plain list, one title per line, deduplicated, kept in the repo
so that project 16 (the fake paper title generator) has real titles to train
on. Run it whenever you want more titles; it only adds lines it has not seen.

    python3 collect_titles.py                       # fetch the feeds in config.json
    python3 collect_titles.py --offline feed.xml    # read a saved feed instead

If every feed fetch fails (no network, proxy in the way), the script falls
back to the bundled sample feed in tests/ and says so.
"""

import argparse
import sys
from pathlib import Path

from digest import DEFAULT_CONFIG, HERE, feed_url, fetch_url, load_config, parse_feed

SAMPLE_FEED = HERE / "tests" / "sample_cs.CL.xml"
DEFAULT_OUT = HERE / "data" / "titles.txt"


def normalize(title):
    return " ".join(title.split())


def read_titles(path):
    """Existing titles, in file order, plus a set for fast membership tests."""
    if not path.exists():
        return [], set()
    with open(path, encoding="utf-8") as fh:
        titles = [normalize(line) for line in fh if line.strip()]
    return titles, set(titles)


def gather(sources, log):
    """sources is a list of (label, bytes-producing callable). Returns
    (titles, labels_that_worked)."""
    titles = []
    worked = []
    for label, load in sources:
        try:
            papers = parse_feed(load())
        except Exception as exc:  # network, XML or HTTP errors all mean "skip"
            log(f"skipped {label}: {exc}")
            continue
        worked.append(label)
        titles.extend(normalize(p.title) for p in papers if p.title)
        log(f"{label}: {len(papers)} items")
    return titles, worked


def main(argv=None):
    parser = argparse.ArgumentParser(description="Collect arXiv titles for project 16.")
    parser.add_argument("--config", default=str(DEFAULT_CONFIG))
    parser.add_argument("--out", default=str(DEFAULT_OUT), help="titles file (default data/titles.txt)")
    parser.add_argument("--feeds", nargs="+", help="category names or URLs, replaces the config list")
    parser.add_argument("--offline", action="append", metavar="FILE", help="read a saved feed file (repeatable)")
    args = parser.parse_args(argv)
    log = lambda msg: print(msg, file=sys.stderr)  # noqa: E731

    config = load_config(args.config)
    if args.offline:
        sources = [(path, (lambda p=path: Path(p).read_bytes())) for path in args.offline]
    else:
        feeds = args.feeds or config["feeds"]
        sources = [
            (name, (lambda u=feed_url(name, config["feed_url_template"]): fetch_url(u, log=log)))
            for name in feeds
        ]

    titles, worked = gather(sources, log)
    used_fallback = False
    if not worked:
        log(f"no feed could be read; falling back to the bundled sample {SAMPLE_FEED.name}")
        titles, worked = gather([(SAMPLE_FEED.name, SAMPLE_FEED.read_bytes)], log)
        used_fallback = True
        if not worked:
            log("the sample feed could not be read either; giving up")
            return 1

    out_path = Path(args.out)
    existing, known = read_titles(out_path)
    added = []
    for title in titles:
        if title not in known:
            known.add(title)
            added.append(title)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as fh:
        for title in existing + added:
            fh.write(title + "\n")

    note = " (from the bundled sample, not a live fetch)" if used_fallback else ""
    log(f"added {len(added)} new titles{note}; {len(existing) + len(added)} total in {out_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
