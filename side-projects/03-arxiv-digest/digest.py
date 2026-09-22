#!/usr/bin/env python3
"""Daily arXiv digest without an LLM.

Fetches the arXiv RSS feeds listed in config.json, scores every paper against
a weighted keyword list, and writes a Markdown digest of the top N papers that
have not been shown before. Standard library only.

Typical use (from cron or by hand):

    python3 digest.py                 # fetch, score, write digests/YYYY-MM-DD.md
    python3 digest.py --dry-run       # print to stdout, remember nothing
    python3 digest.py --offline tests/sample_cs.CL.xml --dry-run

See README.md for the full list of flags and the config format.
"""

import argparse
import datetime as dt
import html
import json
import re
import sys
import time
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from pathlib import Path

HERE = Path(__file__).resolve().parent
DEFAULT_CONFIG = HERE / "config.json"
USER_AGENT = "arxiv-digest/1.0 (personal reading script, Python urllib)"

# XML namespaces used by the arXiv feeds (RSS 2.0 today, RSS 1.0 before 2024).
NS = {
    "dc": "http://purl.org/dc/elements/1.1/",
    "arxiv": "http://arxiv.org/schemas/atom",
    "rss1": "http://purl.org/rss/1.0/",
    "atom": "http://www.w3.org/2005/Atom",
}

ARXIV_ID_RE = re.compile(r"(\d{4}\.\d{4,5}|[a-z\-]+(?:\.[A-Z]{2})?/\d{7})(v\d+)?")
TAG_RE = re.compile(r"<[^>]+>")
WS_RE = re.compile(r"\s+")


@dataclass
class Paper:
    """One arXiv entry, merged across feeds by arXiv id."""

    arxiv_id: str
    title: str
    authors: list
    abstract: str
    link: str
    categories: list
    announce_type: str = "new"
    feeds: list = field(default_factory=list)
    score: float = 0.0
    matches: list = field(default_factory=list)


# ---------------------------------------------------------------------------
# Config and paths
# ---------------------------------------------------------------------------

def load_config(path):
    with open(path, encoding="utf-8") as fh:
        config = json.load(fh)
    config.setdefault("feeds", ["cs.CL", "cs.LG", "cs.SE", "cs.CR"])
    config.setdefault("feed_url_template", "https://rss.arxiv.org/rss/{category}")
    config.setdefault("announce_types", ["new", "cross"])
    config.setdefault("out_dir", "digests")
    config.setdefault("seen_file", "seen.json")
    config.setdefault("seen_days", 90)
    config.setdefault("top", 10)
    config.setdefault("min_score", 1.0)
    config.setdefault("title_bonus", 2.0)
    config.setdefault("max_authors", 5)
    config.setdefault("terms", [])
    config.setdefault("negative_terms", [])
    return config


def resolve_path(value, base=HERE):
    """Relative paths in the config are taken relative to the script folder,
    so cron can run the script from any working directory."""
    path = Path(value).expanduser()
    return path if path.is_absolute() else base / path


def feed_url(name, template):
    """Accept either a category name (cs.CL) or a full URL."""
    if name.startswith("http://") or name.startswith("https://"):
        return name
    return template.format(category=name)


# ---------------------------------------------------------------------------
# Fetching and parsing
# ---------------------------------------------------------------------------

def fetch_url(url, retries=3, timeout=30, log=print):
    """Download a URL with a few retries and exponential backoff."""
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    delay = 2.0
    last_error = None
    for attempt in range(1, retries + 1):
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return response.read()
        except (urllib.error.URLError, urllib.error.HTTPError, OSError) as exc:
            last_error = exc
            log(f"  attempt {attempt}/{retries} failed for {url}: {exc}")
            if attempt < retries:
                time.sleep(delay)
                delay *= 2
    raise RuntimeError(f"could not fetch {url}: {last_error}")


def _text(elem, path, default=""):
    found = elem.find(path, NS)
    return (found.text or "").strip() if found is not None and found.text else default


def _clean(text):
    """Strip HTML tags, unescape entities and collapse whitespace."""
    text = html.unescape(TAG_RE.sub(" ", text or ""))
    text = WS_RE.sub(" ", text).strip()
    return re.sub(r"\s+([.,;:!?)])", r"\1", text)  # no space left behind a closing tag


def _extract_id(*candidates):
    """Pull a bare arXiv id (no version) out of a guid, a link or a description."""
    for text in candidates:
        if not text:
            continue
        match = ARXIV_ID_RE.search(text)
        if match:
            return match.group(1)
    return ""


def _split_authors(text):
    """Feeds give 'A, B, C' (RSS 2.0) or HTML links (RSS 1.0)."""
    text = _clean(text)
    parts = re.split(r",\s*|\s+and\s+", text)
    return [p.strip() for p in parts if p.strip()]


def _clean_abstract(description):
    """The RSS 2.0 description looks like
    'arXiv:2409.12345v1 Announce Type: new \\nAbstract: ...'. Keep the abstract."""
    text = _clean(description)
    text = re.sub(r"^arXiv:\S+\s+Announce Type:\s*\S+\s*", "", text)
    text = re.sub(r"^Abstract:\s*", "", text)
    return text


def _parse_rss2(root):
    channel = root.find("channel")
    items = channel.findall("item") if channel is not None else []
    papers = []
    for item in items:
        description = _text(item, "description")
        guid = _text(item, "guid")
        link = _text(item, "link")
        arxiv_id = _extract_id(guid, link, description)
        if not arxiv_id:
            continue
        announce = _text(item, "arxiv:announce_type")
        if not announce:
            found = re.search(r"Announce Type:\s*(\S+)", description)
            announce = found.group(1) if found else "new"
        papers.append(Paper(
            arxiv_id=arxiv_id,
            title=_clean(_text(item, "title")),
            authors=_split_authors(_text(item, "dc:creator")),
            abstract=_clean_abstract(description),
            link=link or f"https://arxiv.org/abs/{arxiv_id}",
            categories=[_clean(c.text) for c in item.findall("category") if c.text],
            announce_type=announce.lower(),
        ))
    return papers


def _parse_rss1(root):
    """The pre-2024 RDF layout. Kept so a saved old feed still parses."""
    papers = []
    for item in root.findall("rss1:item", NS):
        link = _text(item, "rss1:link")
        arxiv_id = _extract_id(link, item.get(f"{{{NS['rss1']}}}about", ""))
        if not arxiv_id:
            continue
        title = _clean(_text(item, "rss1:title"))
        # Old titles ended with "(arXiv:2301.00001v1 [cs.CL])"; drop that suffix.
        title = re.sub(r"\s*\(arXiv:[^)]*\)\s*$", "", title)
        papers.append(Paper(
            arxiv_id=arxiv_id,
            title=title,
            authors=_split_authors(_text(item, "dc:creator")),
            abstract=_clean(_text(item, "rss1:description")),
            link=link or f"https://arxiv.org/abs/{arxiv_id}",
            categories=[],
            announce_type="replace" if "UPDATED" in title else "new",
        ))
    return papers


def _parse_atom(root):
    """Atom, as served by the arXiv API (export.arxiv.org/api/query)."""
    papers = []
    for entry in root.findall("atom:entry", NS):
        entry_id = _text(entry, "atom:id")
        arxiv_id = _extract_id(entry_id)
        if not arxiv_id:
            continue
        papers.append(Paper(
            arxiv_id=arxiv_id,
            title=_clean(_text(entry, "atom:title")),
            authors=[_clean(_text(a, "atom:name")) for a in entry.findall("atom:author", NS)],
            abstract=_clean(_text(entry, "atom:summary")),
            link=entry_id or f"https://arxiv.org/abs/{arxiv_id}",
            categories=[c.get("term") for c in entry.findall("atom:category", NS) if c.get("term")],
        ))
    return papers


def parse_feed(data):
    """Parse feed bytes (or str) into a list of Paper, whatever the layout."""
    if isinstance(data, str):
        data = data.encode("utf-8")
    root = ET.fromstring(data)
    tag = root.tag.split("}")[-1].lower()
    if tag == "rss":
        return _parse_rss2(root)
    if tag == "rdf":
        return _parse_rss1(root)
    if tag == "feed":
        return _parse_atom(root)
    raise ValueError(f"unrecognized feed root element: {root.tag}")


def merge_papers(batches):
    """Merge per-feed lists into one dict keyed by arXiv id. The same paper is
    often listed in several category feeds; we keep one copy and remember
    which feeds carried it."""
    merged = {}
    for feed_name, papers in batches:
        for paper in papers:
            existing = merged.get(paper.arxiv_id)
            if existing is None:
                paper.feeds = [feed_name]
                merged[paper.arxiv_id] = paper
            else:
                if feed_name not in existing.feeds:
                    existing.feeds.append(feed_name)
                for cat in paper.categories:
                    if cat not in existing.categories:
                        existing.categories.append(cat)
                # "new" beats "cross" beats "replace" when feeds disagree.
                rank = {"new": 0, "cross": 1, "replace": 2}
                if rank.get(paper.announce_type, 3) < rank.get(existing.announce_type, 3):
                    existing.announce_type = paper.announce_type
    return merged


# ---------------------------------------------------------------------------
# Scoring
# ---------------------------------------------------------------------------

def term_regex(term, phrase=True):
    """Build a case-insensitive regex for a config term.

    Words are matched on word boundaries with an optional plural s/es, and
    spaces or hyphens inside a term match a space, a hyphen or nothing
    (so 'cross-lingual' also finds 'cross lingual' and 'crosslingual').
    For phrase=False, every word gets its own regex (returned as a list).
    """
    words = [w for w in re.split(r"[\s\-]+", term.strip()) if w]
    if not words:
        raise ValueError("empty term in config")

    def word_pattern(word):
        return re.escape(word.lower()) + r"(?:s|es)?"

    if phrase:
        pattern = r"\b" + r"[\s\-]*".join(word_pattern(w) for w in words) + r"\b"
        return [re.compile(pattern, re.IGNORECASE)]
    return [re.compile(r"\b" + word_pattern(w) + r"\b", re.IGNORECASE) for w in words]


def compile_terms(entries):
    """Turn config entries into (label, weight, [regex...]) tuples."""
    compiled = []
    for entry in entries:
        if isinstance(entry, str):
            entry = {"term": entry}
        term = entry["term"]
        weight = float(entry.get("weight", 1.0))
        phrase = bool(entry.get("phrase", True))
        compiled.append((term, weight, term_regex(term, phrase)))
    return compiled


def _matches(regexes, text):
    return all(r.search(text) for r in regexes)


def score_paper(paper, terms, negative_terms, title_bonus=2.0):
    """Score a paper and record which terms matched and where.

    A term found in the title counts weight * title_bonus; a term found only in
    the abstract counts weight. Each term counts once. Negative terms subtract
    with the same rule. Returns (score, matches) where matches is a list of
    (term, location, points) with location 'title' or 'abstract'.
    """
    score = 0.0
    matches = []
    for sign, entries in ((1.0, terms), (-1.0, negative_terms)):
        for term, weight, regexes in entries:
            if _matches(regexes, paper.title):
                points = sign * weight * title_bonus
                where = "title"
            elif _matches(regexes, paper.abstract):
                points = sign * weight
                where = "abstract"
            else:
                continue
            score += points
            matches.append((term, where, points))
    matches.sort(key=lambda m: -abs(m[2]))
    return score, matches


# ---------------------------------------------------------------------------
# Memory of what was shown
# ---------------------------------------------------------------------------

def load_seen(path):
    try:
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
        return data if isinstance(data, dict) else {}
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def prune_seen(seen, today, max_days):
    """Drop ids shown more than max_days ago so the file stays small."""
    kept = {}
    for arxiv_id, shown in seen.items():
        try:
            shown_date = dt.date.fromisoformat(shown)
        except (TypeError, ValueError):
            continue
        if (today - shown_date).days <= max_days:
            kept[arxiv_id] = shown
    return kept


def save_seen(path, seen):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(dict(sorted(seen.items())), fh, indent=1)
        fh.write("\n")


# ---------------------------------------------------------------------------
# Rendering
# ---------------------------------------------------------------------------

def format_authors(authors, limit=5):
    if len(authors) <= limit:
        return ", ".join(authors)
    return ", ".join(authors[:limit]) + " et al."


def format_matches(matches):
    parts = []
    for term, where, points in matches:
        suffix = " [title]" if where == "title" else ""
        sign = "-" if points < 0 else ""
        parts.append(f"{sign}{term}{suffix}")
    return ", ".join(parts) if parts else "none"


def render_digest(papers, today, counts, feeds, min_score, max_authors=5):
    lines = [f"# arXiv digest, {today.isoformat()}", ""]
    lines.append(
        f"Feeds: {', '.join(feeds)}. Showing {len(papers)} of {counts['new']} new papers "
        f"with score at least {min_score:g}."
    )
    lines.append("")
    if not papers:
        lines.append("Nothing new above the score threshold today.")
        lines.append("")
    for rank, paper in enumerate(papers, 1):
        pdf = paper.link.replace("/abs/", "/pdf/")
        lines.append(f"## {rank}. [{paper.title}]({paper.link})")
        lines.append("")
        lines.append(f"**Authors:** {format_authors(paper.authors, max_authors)}  ")
        lines.append(f"**Categories:** {', '.join(paper.categories) or 'n/a'} ({paper.announce_type})  ")
        lines.append(f"**Score:** {paper.score:g}. Matched: {format_matches(paper.matches)}  ")
        lines.append(f"**arXiv:** {paper.arxiv_id} ([abs]({paper.link}), [pdf]({pdf}))")
        lines.append("")
        lines.append(paper.abstract or "(no abstract in feed)")
        lines.append("")
    lines.append("---")
    lines.append("")
    lines.append(
        f"Fetched {counts['fetched']} items ({counts['unique']} unique papers), "
        f"{counts['new']} new after filtering, {counts['shown']} shown. "
        f"Generated {dt.datetime.now().strftime('%Y-%m-%d %H:%M')} by digest.py."
    )
    lines.append("")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def build_parser():
    parser = argparse.ArgumentParser(description="Daily arXiv digest without an LLM.")
    parser.add_argument("--config", default=str(DEFAULT_CONFIG), help="path to config.json")
    parser.add_argument("--out", help="digest folder (overrides config out_dir)")
    parser.add_argument("--seen", help="seen.json path (overrides config seen_file)")
    parser.add_argument("--top", type=int, help="how many papers to show (default from config)")
    parser.add_argument("--min-score", type=float, help="minimum score to show (default from config)")
    parser.add_argument("--feeds", nargs="+", help="category names or feed URLs, replaces the config list")
    parser.add_argument("--offline", action="append", metavar="FILE",
                        help="parse a saved feed file instead of fetching (repeatable)")
    parser.add_argument("--dry-run", action="store_true",
                        help="print the digest to stdout, write no files")
    parser.add_argument("--reset", action="store_true", help="forget every seen id first")
    parser.add_argument("--date", help="date for the digest file, YYYY-MM-DD (default today)")
    return parser


def collect_papers(args, config, log):
    """Return (batches, fetch_errors) where batches is [(feed_name, [Paper])]."""
    batches = []
    errors = []
    if args.offline:
        for path in args.offline:
            with open(path, "rb") as fh:
                papers = parse_feed(fh.read())
            batches.append((Path(path).name, papers))
            log(f"parsed {len(papers)} items from {path}")
        return batches, errors

    feeds = args.feeds or config["feeds"]
    for name in feeds:
        url = feed_url(name, config["feed_url_template"])
        log(f"fetching {url}")
        try:
            papers = parse_feed(fetch_url(url, log=log))
        except (RuntimeError, ET.ParseError, ValueError) as exc:
            errors.append((name, str(exc)))
            log(f"  skipped {name}: {exc}")
            continue
        batches.append((name, papers))
        log(f"  {len(papers)} items")
    return batches, errors


def main(argv=None):
    args = build_parser().parse_args(argv)
    config = load_config(args.config)
    log = lambda msg: print(msg, file=sys.stderr)  # noqa: E731

    today = dt.date.fromisoformat(args.date) if args.date else dt.date.today()
    out_dir = resolve_path(args.out or config["out_dir"])
    seen_path = resolve_path(args.seen or config["seen_file"])
    top = args.top if args.top is not None else int(config["top"])
    min_score = args.min_score if args.min_score is not None else float(config["min_score"])
    allowed_types = {t.lower() for t in config["announce_types"]}

    # Memory of what was already shown.
    seen = {} if args.reset else load_seen(seen_path)
    seen = prune_seen(seen, today, int(config["seen_days"]))
    if args.reset and not args.dry_run:
        save_seen(seen_path, seen)
        log(f"reset {seen_path}")

    batches, errors = collect_papers(args, config, log)
    if not batches:
        log("no feed could be read; nothing to do")
        return 1

    merged = merge_papers(batches)
    fetched = sum(len(papers) for _, papers in batches)

    terms = compile_terms(config["terms"])
    negative_terms = compile_terms(config["negative_terms"])
    title_bonus = float(config["title_bonus"])

    candidates = []
    for paper in merged.values():
        if paper.announce_type not in allowed_types or paper.arxiv_id in seen:
            continue
        paper.score, paper.matches = score_paper(paper, terms, negative_terms, title_bonus)
        candidates.append(paper)
    candidates.sort(key=lambda p: (-p.score, p.arxiv_id))
    shown = [p for p in candidates if p.score >= min_score][:top]

    counts = {"fetched": fetched, "unique": len(merged), "new": len(candidates), "shown": len(shown)}
    feed_names = [name for name, _ in batches]
    text = render_digest(shown, today, counts, feed_names, min_score, int(config["max_authors"]))
    if errors:
        text += "\nFeeds that could not be read: " + "; ".join(f"{n} ({e})" for n, e in errors) + "\n"

    if args.dry_run:
        sys.stdout.write(text)
        log(f"dry run: {counts['shown']} shown, seen.json untouched")
        return 0

    if not shown:
        log(f"nothing new above score {min_score:g}; no digest written")
        return 0

    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"{today.isoformat()}.md"
    with open(out_path, "w", encoding="utf-8") as fh:
        fh.write(text)
    for paper in shown:
        seen[paper.arxiv_id] = today.isoformat()
    save_seen(seen_path, seen)
    log(f"wrote {out_path} ({counts['shown']} papers); {len(seen)} ids in {seen_path.name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
