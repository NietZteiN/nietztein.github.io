#!/usr/bin/env python3
"""Render a git repository's history as a film-editing timeline (single HTML file).

Usage:
    python3 git_timeline.py /path/to/repo -o timeline.html
        [--depth dir|file] [--max-commits N] [--branches all|current]
        [--tracks N] [--trailer-seconds S]

Only the Python standard library and the `git` command are needed. The output is
one self-contained HTML file with the history embedded as JSON; open it directly
from disk (file://) or serve it with any static server.
"""

import argparse
import colorsys
import hashlib
import json
import os
import re
import subprocess
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

TEMPLATE = Path(__file__).with_name("template.html")
HEADER_SEP = "\x1f"        # separates header fields
RECORD_SEP = "\x00"        # starts every commit record
MERGE_MSG = re.compile(r"""Merge\s+(?:remote-tracking\s+)?(?:branch|pull request\s+#?\d+\s+from)\s+['"]?([^'"\s]+)['"]?""")


# ---------------------------------------------------------------- git access

def run_git(repo, args):
    """Run a git command in `repo` and return stdout as text (errors raise)."""
    result = subprocess.run(
        ["git", "-C", repo] + args,
        capture_output=True, text=True, encoding="utf-8", errors="replace",
    )
    if result.returncode != 0:
        raise RuntimeError("git %s failed:\n%s" % (" ".join(args), result.stderr.strip()))
    return result.stdout


def clean_path(path):
    """Turn a numstat rename path like 'a/{old => new}/f.py' into the new path."""
    m = re.match(r"^(.*)\{(.*) => (.*)\}(.*)$", path)
    if m:
        return m.group(1) + m.group(3) + m.group(4)
    if " => " in path:
        return path.split(" => ", 1)[1]
    return path


def read_log(repo, branches, max_commits):
    """Return commits oldest first, each with parsed numstat."""
    scope = ["--all"] if branches == "all" else ["HEAD"]
    # git expands %x00 and %x1f itself (a literal NUL cannot be passed in argv)
    fmt = "%x00" + "%x1f".join(["%H", "%P", "%an", "%aI", "%s"])
    args = ["log", "--date-order", "--reverse", "--numstat", "--date=iso-strict",
            "--format=" + fmt] + scope
    if max_commits:
        args.insert(1, "-n%d" % max_commits)
    try:
        # first-parent diffs make merge commits carry the lines they brought in
        out = run_git(repo, args[:1] + ["--diff-merges=first-parent"] + args[1:])
    except RuntimeError:
        # older git: merges will simply have no numstat
        out = run_git(repo, args)

    commits = []
    for record in out.split(RECORD_SEP):
        if not record.strip():
            continue
        header, _, body = record.partition("\n")
        full, parents, author, date, subject = header.split(HEADER_SEP, 4)
        files = {}
        for line in body.splitlines():
            parts = line.split("\t")
            if len(parts) != 3:
                continue
            ins, dele, path = parts
            # "-" marks a binary file: it changed, but has no line counts
            ins = int(ins) if ins.isdigit() else 0
            dele = int(dele) if dele.isdigit() else 0
            files[clean_path(path)] = (ins, dele)
        commits.append({
            "hash": full,
            "parents": parents.split() if parents else [],
            "author": author,
            "date": date,
            "subject": subject,
            "files": files,
        })
    return commits


def read_refs(repo, branches):
    """Return [(commit hash, short ref name)] ordered by labelling priority."""
    current = run_git(repo, ["rev-parse", "--abbrev-ref", "HEAD"]).strip()
    head = run_git(repo, ["rev-parse", "HEAD"]).strip()
    if branches != "all":
        return [(head, current if current != "HEAD" else "HEAD")]
    out = run_git(repo, ["for-each-ref", "--format=%(objectname) %(refname:short)",
                         "refs/heads", "refs/remotes", "refs/tags"])
    refs = []
    for line in out.splitlines():
        h, _, name = line.partition(" ")
        if name.endswith("/HEAD"):
            continue
        refs.append((h, name))
    local = {name for _, name in refs if "/" not in name}

    def priority(item):
        h, name = item
        if name == current:
            return 0
        if name in ("main", "master"):
            return 1
        if "/" not in name:
            return 2
        # a remote branch shadowing a local one adds nothing, push it last
        return 4 if name.split("/", 1)[-1] in local else 3

    refs.sort(key=priority)
    return refs


# ---------------------------------------------------------------- analysis

def track_key(path, depth):
    if depth == "file":
        return path
    return path.split("/", 1)[0]


def build_tracks(commits, depth, max_tracks):
    """Group files into tracks; keep the busiest `max_tracks`, fold the rest into 'other'."""
    activity = defaultdict(int)
    for c in commits:
        for path, (ins, dele) in c["files"].items():
            activity[track_key(path, depth)] += ins + dele + 1  # +1 so binary-only tracks count
    ranked = sorted(activity, key=lambda k: (-activity[k], k))
    kept = ranked[:max_tracks]
    names = list(kept) + (["other"] if len(ranked) > max_tracks else [])
    index = {name: i for i, name in enumerate(names)}
    other = index.get("other")

    tracks = [{"name": n, "lines": 0, "commits": 0} for n in names]
    for c in commits:
        per = {}
        for path, (ins, dele) in c["files"].items():
            i = index.get(track_key(path, depth), other)
            if i is None:
                continue
            cur = per.setdefault(i, [0, 0, 0])
            cur[0] += ins
            cur[1] += dele
            cur[2] += 1
        c["per"] = per
        for i, (ins, dele, _) in per.items():
            tracks[i]["lines"] += ins + dele
            tracks[i]["commits"] += 1
    return tracks


def assign_lanes(commits):
    """Give every commit a lane index (like `git log --graph`), oldest first.

    Runs after assign_owners: a child on the same branch as its parent keeps the
    parent's lane, so a side branch that commits first does not steal it.
    """
    known = {c["hash"] for c in commits}
    by_hash = {c["hash"]: c for c in commits}
    remaining_children = defaultdict(int)
    same_owner_child = set()      # parents that still have a same-branch child coming
    for c in commits:
        for p in c["parents"]:
            if p in known:
                remaining_children[p] += 1
        if c["parents"] and c["parents"][0] in known and c["owner"] == by_hash[c["parents"][0]]["owner"]:
            same_owner_child.add(c["parents"][0])

    lanes = []          # lanes[i] = hash currently occupying lane i, or None
    lane_of = {}
    for c in commits:
        parents = [p for p in c["parents"] if p in known]
        lane = None
        p0 = parents[0] if parents else None
        continues = p0 is not None and lanes[lane_of[p0]] == p0 and (
            c["owner"] == by_hash[p0]["owner"] or p0 not in same_owner_child)
        if continues:
            lane = lane_of[p0]               # continue the first parent's lane
        else:
            free = [i for i, h in enumerate(lanes) if h is None]
            lane = free[0] if free else len(lanes)
            if lane == len(lanes):
                lanes.append(None)
        lanes[lane] = c["hash"]
        lane_of[c["hash"]] = lane
        c["lane"] = lane
        c["parent_lanes"] = [lane_of[p] for p in parents]
        for p in parents:
            remaining_children[p] -= 1
            if remaining_children[p] == 0 and lanes[lane_of[p]] == p:
                lanes[lane_of[p]] = None     # fully consumed: free the lane
    return len(lanes)


def assign_owners(commits, refs):
    """Label each commit with the branch it most plausibly belongs to."""
    by_hash = {c["hash"]: c for c in commits}
    owner = {}

    def claim(start, name):
        h = start
        while h in by_hash and h not in owner:
            owner[h] = name
            parents = by_hash[h]["parents"]
            h = parents[0] if parents else None

    for h, name in refs:
        claim(h, name)
    # merged-and-deleted branches: recover their name from the merge message
    for c in reversed(commits):
        if len(c["parents"]) > 1:
            m = MERGE_MSG.search(c["subject"])
            if m:
                claim(c["parents"][1], m.group(1))

    tips = defaultdict(list)
    for h, name in refs:
        if h in by_hash:
            tips[h].append(name)

    children = defaultdict(list)
    for c in commits:
        for p in c["parents"]:
            if p in by_hash:
                children[p].append(c["hash"])

    for c in commits:
        h = c["hash"]
        c["owner"] = owner.get(h)
        c["refs"] = tips.get(h, [])
        # a branch point: children that leave this commit's branch
        out = []
        for ch in children[h]:
            child_owner = owner.get(ch)
            if by_hash[ch]["parents"][0] == h and child_owner != c["owner"]:
                out.append(child_owner or "unnamed branch")
        c["branch_out"] = sorted(set(out))


def author_color(name):
    """Stable, readable color from a hash of the author's name."""
    digest = hashlib.sha1(name.encode("utf-8")).digest()
    hue = digest[0] / 255.0
    sat = 0.55 + (digest[1] / 255.0) * 0.25
    light = 0.52 + (digest[2] / 255.0) * 0.12
    r, g, b = colorsys.hls_to_rgb(hue, light, sat)
    return "#%02x%02x%02x" % (round(r * 255), round(g * 255), round(b * 255))


# ---------------------------------------------------------------- output

def build_payload(repo, commits, tracks, lane_count, args):
    authors = []
    author_index = {}
    for c in commits:
        if c["author"] not in author_index:
            author_index[c["author"]] = len(authors)
            authors.append({"name": c["author"], "color": author_color(c["author"])})

    short = {c["hash"]: c["hash"][:7] for c in commits}
    out_commits = []
    for c in commits:
        ins = sum(v[0] for v in c["files"].values())
        dele = sum(v[1] for v in c["files"].values())
        t = datetime.fromisoformat(c["date"]).timestamp()
        out_commits.append({
            "h": short[c["hash"]],
            "p": [short[p] for p in c["parents"] if p in short],
            "a": author_index[c["author"]],
            "d": c["date"],
            "t": t,
            "m": c["subject"],
            "f": len(c["files"]),
            "i": ins,
            "x": dele,
            "lane": c["lane"],
            "plane": c["parent_lanes"],
            "merge": len(c["parents"]) > 1,
            "refs": c["refs"],
            "out": c["branch_out"],
            "owner": c["owner"],
            "per": {str(k): v for k, v in c["per"].items()},
        })

    repo_name = os.path.basename(os.path.abspath(repo.rstrip("/"))) or repo
    return {
        "repo": repo_name,
        "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "depth": args.depth,
        "branches": args.branches,
        "trailerSeconds": args.trailer_seconds,
        "laneCount": lane_count,
        "tracks": tracks,
        "authors": authors,
        "commits": out_commits,
    }


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("repo", help="path to a git repository")
    ap.add_argument("-o", "--output", default="timeline.html", help="output HTML file")
    ap.add_argument("--depth", choices=["dir", "file"], default="dir",
                    help="one track per top-level directory (default) or per file")
    ap.add_argument("--max-commits", type=int, default=0,
                    help="only the N most recent commits (0 = all)")
    ap.add_argument("--branches", choices=["all", "current"], default="all",
                    help="history of all refs (default) or only the current branch")
    ap.add_argument("--tracks", type=int, default=12,
                    help="number of busiest tracks to keep before folding into 'other'")
    ap.add_argument("--trailer-seconds", type=float, default=30,
                    help="length of trailer mode in seconds")
    args = ap.parse_args(argv)

    if not os.path.isdir(args.repo):
        sys.exit("not a directory: %s" % args.repo)
    try:
        commits = read_log(args.repo, args.branches, args.max_commits)
        refs = read_refs(args.repo, args.branches)
    except (RuntimeError, FileNotFoundError) as e:
        sys.exit(str(e))
    if not commits:
        sys.exit("no commits found in %s" % args.repo)

    tracks = build_tracks(commits, args.depth, max(1, args.tracks))
    assign_owners(commits, refs)
    lane_count = assign_lanes(commits)
    payload = build_payload(args.repo, commits, tracks, lane_count, args)

    template = TEMPLATE.read_text(encoding="utf-8")
    data = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    data = data.replace("</", "<\\/")  # keep the JSON safe inside <script>
    html = template.replace("/*__DATA__*/null", data, 1)
    html = html.replace("__TITLE__", payload["repo"])
    Path(args.output).write_text(html, encoding="utf-8")
    print("wrote %s: %d commits, %d tracks, %d authors, %d lanes" % (
        args.output, len(commits), len(tracks), len(payload["authors"]), lane_count))


if __name__ == "__main__":
    main()
