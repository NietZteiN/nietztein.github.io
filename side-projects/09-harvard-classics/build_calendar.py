#!/usr/bin/env python3
"""Build data/calendar.json, the Fifteen Minutes a Day reading calendar.

Two sources, tried in this order:

1. data/fifteen_minutes_guide.txt: one line per day in the form
       Jan 1: FRANKLIN'S AUTOBIOGRAPHY Vol. I, pp. 79-85
   optionally followed by a line starting with ">" holding the guide's teaser
   sentence. Lines starting with "#" are comments. The bundled file holds the
   366 daily assignments of the 1930 Collier guide (see README.md for where
   they come from and how to add the teasers).
2. If that file is missing, a deterministic reconstruction: works from
   volumes.json in volume order, cycled so every day of the year has one.
   The output is then marked "source": "reconstructed".

Every entry also gets "work" and "gutenberg_id" fields: the work in
volumes.json that best matches the day's reading, so daily.py can find a
passage for it (gutenberg_id is null when that work has no known text).
"""
import json
import os
import re

from hc_common import CALENDAR_PATH, DATA_DIR, load_volumes, tokenize

GUIDE_PATH = os.path.join(DATA_DIR, "fifteen_minutes_guide.txt")
CALENDAR_JS_PATH = os.path.join(DATA_DIR, "calendar.js")
MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

LINE_RE = re.compile(r"^(?P<mon>[A-Z][a-z]{2})\.? (?P<day>\d{1,2}):\s*(?P<title>.+?)\s+Vol\.?\s*(?P<vol>[0-9IVXL]+)[.,]?\s*(?P<pages>.*)$")
PAGES_RE = re.compile(r"^(?:pp?\.)?\s*(.*)$")

ROMAN = {"I": 1, "II": 2, "III": 3, "IV": 4, "V": 5, "VI": 6, "VII": 7, "VIII": 8, "IX": 9, "X": 10}


def parse_volume(s):
    return int(s) if s.isdigit() else ROMAN.get(s, 0)


def nice_title(t):
    """The guide prints work titles in capitals; put them in title case but
    keep possessive forms like Franklin's as they are."""
    words = []
    for w in t.split():
        if w.isupper() and len(w) > 1:
            w = w.capitalize()
            w = re.sub(r"'S\b", "'s", w)
        words.append(w)
    small = {"of", "the", "and", "on", "to", "a", "in", "for", "with", "at", "by"}
    out = []
    for i, w in enumerate(words):
        after_possessive = i and words[i - 1].endswith("'s")
        out.append(w.lower() if (i and w.lower() in small and not after_possessive) else w)
    return " ".join(out)


def parse_guide(path):
    entries, last = [], None
    with open(path, encoding="utf-8") as f:
        for raw in f:
            line = raw.strip()
            if not line or line.startswith("#"):
                continue
            if line.startswith(">") and last is not None:
                last["teaser"] = line[1:].strip() or None
                continue
            m = LINE_RE.match(line)
            if not m:
                print("could not parse:", line)
                continue
            last = {"month": MONTHS.index(m.group("mon")) + 1, "day": int(m.group("day")),
                    "reading": nice_title(m.group("title")), "volume": parse_volume(m.group("vol")),
                    "pages": PAGES_RE.match(m.group("pages")).group(1).strip() or None, "teaser": None}
            entries.append(last)
    return entries


def reconstruct(volumes):
    works = [(v["volume"], w["title"]) for v in volumes for w in v["works"] if w.get("gutenberg_id")]
    entries, i = [], 0
    for m, ndays in enumerate(DAYS_IN_MONTH, start=1):
        for d in range(1, ndays + 1):
            vol, title = works[i % len(works)]
            entries.append({"month": m, "day": d, "reading": title, "volume": vol,
                            "pages": None, "teaser": None})
            i += 1
    return entries


def match_work(entry, volumes):
    """Pick the volumes.json work whose title and author share the most stems
    with the day's reading, within the same volume. None when nothing matches
    (anthology volumes, works without a Gutenberg text)."""
    vol = next((v for v in volumes if v["volume"] == entry["volume"]), None)
    if not vol or not vol["works"]:
        return None
    wanted = set(tokenize(entry["reading"]))
    best, best_score = None, 0
    for w in vol["works"]:
        have = set(tokenize(w["title"] + " " + w["author"]))
        score = len(wanted & have)
        if score > best_score:
            best, best_score = w, score
    if best is None:
        # Texts flagged whole_volume cover the entire Collier volume (the Aeneid,
        # Don Quixote, the Gutenberg edition of volume 38, ...).
        best = next((w for w in vol["works"] if w.get("whole_volume")), None)
    return best


def main():
    volumes = load_volumes()
    if os.path.exists(GUIDE_PATH):
        entries = parse_guide(GUIDE_PATH)
        source = "transcription of the 1930 Collier guide (daily assignments only, no teasers)"
    else:
        entries = reconstruct(volumes)
        source = "reconstructed"
    for e in entries:
        w = match_work(e, volumes)
        e["work"] = w["title"] if w else None
        e["gutenberg_id"] = w.get("gutenberg_id") if w else None
    seen = {(e["month"], e["day"]) for e in entries}
    missing = [(m, d) for m, n in enumerate(DAYS_IN_MONTH, 1) for d in range(1, n + 1) if (m, d) not in seen]
    out = {"source": source, "days": entries}
    with open(CALENDAR_PATH, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    # The same data as a script file, so index.html can read it from file:// too.
    with open(CALENDAR_JS_PATH, "w", encoding="utf-8") as f:
        f.write("window.CALENDAR = ")
        json.dump(out, f, ensure_ascii=False)
        f.write(";\n")
    matched = sum(1 for e in entries if e["gutenberg_id"])
    print(f"wrote {len(entries)} days to {CALENDAR_PATH} (source: {source})")
    print(f"{matched} days matched to a work with a Gutenberg id; {len(missing)} days missing: {missing[:5]}")


if __name__ == "__main__":
    main()
