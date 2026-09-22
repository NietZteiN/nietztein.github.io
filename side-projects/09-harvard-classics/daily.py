#!/usr/bin/env python3
"""Fifteen Minutes a Day: print today's Harvard Classics reading.

  python3 daily.py                    # today's assignment
  python3 daily.py --date 2026-10-03  # another day
  python3 daily.py --sample           # use the bundled sample index

The assignment comes from data/calendar.json (build_calendar.py). When the
passage index holds text for the assigned work, one passage from it is shown
as a taste; the passage is chosen deterministically from the date, so the
same day always shows the same passage.
"""
import argparse
import datetime as dt
import hashlib
import json
import sys
import textwrap

from hc_common import CALENDAR_PATH, find_index_path, load_index

MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July",
               "August", "September", "October", "November", "December"]


def load_calendar():
    try:
        with open(CALENDAR_PATH, encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        sys.exit("data/calendar.json is missing. Run: python3 build_calendar.py")


def pick_passage(entry, index, date):
    candidates = [e for e in index if e["volume"] == entry["volume"] and e["work"] == entry.get("work")]
    if not candidates:
        return None
    digest = hashlib.sha256(date.isoformat().encode()).hexdigest()
    return candidates[int(digest, 16) % len(candidates)]


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--date", help="YYYY-MM-DD (default: today)")
    ap.add_argument("--sample", action="store_true", help="use data/sample_index.json")
    args = ap.parse_args()

    try:
        date = dt.date.fromisoformat(args.date) if args.date else dt.date.today()
    except ValueError as e:
        sys.exit(f"Bad --date {args.date!r}: {e}. Use YYYY-MM-DD.")
    cal = load_calendar()
    entry = next((e for e in cal["days"] if e["month"] == date.month and e["day"] == date.day), None)
    if entry is None:
        sys.exit(f"No entry for {date}. Rebuild the calendar with build_calendar.py")

    print(f"Fifteen Minutes a Day: {MONTH_NAMES[date.month - 1]} {date.day}")
    print(f"  Reading:  {entry['reading']}")
    where = f"Harvard Classics vol. {entry['volume']}"
    if entry.get("pages"):
        where += f", pp. {entry['pages']}"
    print(f"  Where:    {where}")
    if entry.get("teaser"):
        print(f"  Guide:    {entry['teaser']}")
    if cal.get("source") == "reconstructed":
        print("  (calendar reconstructed from volumes.json, not the original guide)")

    index_path = find_index_path(prefer_sample=args.sample)
    passage = pick_passage(entry, load_index(index_path), date) if index_path else None
    print()
    if passage:
        text = passage["text"] if "\n" in passage["text"] else textwrap.fill(passage["text"], width=78)
        print(text)
        print(f"\n    -- {passage['author']}, {passage['work']} (passage {passage['passage_id']})")
    elif entry.get("gutenberg_id"):
        print(f"No passage text for this work yet. Fetch it with:\n  python3 fetch.py --volume {entry['volume']}")
    else:
        print("This reading has no Gutenberg text in volumes.json, so there is no passage to show.")


if __name__ == "__main__":
    main()
