#!/usr/bin/env python3
"""Build the snippet bank for the obfuscation guessing game.

For every clean program (programs/*.py plus the Python examples of project 4)
and every transform stack in STACKS, the script:

  1. builds the obfuscation ladder with the ``obfusc`` package of project 4,
  2. runs the obfuscated code in a subprocess with a timeout to obtain the
     ground-truth output,
  3. checks that this output equals the output of the clean program,
  4. derives three plausible distractor outputs for the multiple-choice mode,
  5. writes one entry to bank.json.

It also refreshes the small built-in fallback bank that is embedded in
index.html between the BANK_FALLBACK markers, so the page works from file://.

Usage:
    python3 build_bank.py                    # rebuild bank.json and the fallback
    python3 build_bank.py --import my_set/   # add an existing snippet set
    python3 build_bank.py --no-fallback      # leave index.html alone

An imported snippet set is a folder of ``name.py`` (or ``name.js``) files, each
with a companion ``name.out`` holding the expected stdout. An optional
``name.meta.json`` may carry ``{"transforms": [...], "program": "...",
"seed": ...}``. Imported snippets are run to confirm the .out file before they
are added.
"""

from __future__ import annotations

import argparse
import glob
import json
import os
import random
import re
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
PLAYGROUND = os.path.join(os.path.dirname(HERE), "04-obfuscation-playground")
sys.path.insert(0, PLAYGROUND)

import obfusc  # noqa: E402  (project 4 package)

PROGRAM_DIRS = [
    os.path.join(HERE, "programs"),
    os.path.join(PLAYGROUND, "examples", "python"),
]

# --------------------------------------------------------------------------- #
# Configuration: which transform stacks and seeds go into the bank.
# Each stack is (list of transform specs, list of seeds). Specs use the short
# "name:mode" spelling accepted by obfusc.ladder.
# --------------------------------------------------------------------------- #
SINGLES = [
    "rename:uninformative",
    "rename:adversarial",
    "flatten",
    "dead_code",
    "strings:base64",
    "expr",
]
PAIRS = [
    ["rename:adversarial", "expr"],
    ["flatten", "dead_code"],
    ["strings:base64", "rename:uninformative"],
    ["expr", "dead_code"],
]
FULL = [
    ["rename:adversarial", "expr", "strings:base64", "dead_code", "flatten"],
    ["flatten", "dead_code", "strings:base64", "expr", "rename:adversarial"],
]
STACKS = (
    [([s], [0]) for s in SINGLES]
    + [(p, [1]) for p in PAIRS]
    + [(f, [0, 3]) for f in FULL]
)

# Short codes used in item ids so they stay readable.
SHORT = {
    "rename_identifiers:uninformative": "ru",
    "rename_identifiers:adversarial": "ra",
    "control_flow_flatten": "f",
    "dead_code_insertion": "d",
    "string_encoding:base64": "s",
    "expression_rewriting": "e",
}

RUN_TIMEOUT = 5          # seconds per subprocess
MAX_BANK_BYTES = 1_000_000
FALLBACK_COUNT = 10
FALLBACK_START = "// BANK_FALLBACK_START"
FALLBACK_END = "// BANK_FALLBACK_END"


# --------------------------------------------------------------------------- #
# Running code
# --------------------------------------------------------------------------- #
def run_code(code, language="python", timeout=RUN_TIMEOUT):
    """Run a snippet in a fresh subprocess. Returns (stdout, error_or_None)."""
    if language == "python":
        cmd = [sys.executable, "-I", "-"]
    elif language == "javascript":
        node = shutil.which("node")
        if not node:
            return "", "node is not installed"
        cmd = [node, "-"]
    else:
        return "", "unsupported language {}".format(language)
    try:
        proc = subprocess.run(cmd, input=code, capture_output=True, text=True,
                              timeout=timeout)
    except subprocess.TimeoutExpired:
        return "", "timeout after {}s".format(timeout)
    if proc.returncode != 0:
        return proc.stdout, proc.stderr.strip().splitlines()[-1:] or "non-zero exit"
    return proc.stdout, None


def canonical_name(spec):
    """'rename:adversarial' -> 'rename_identifiers:adversarial'."""
    base, _, arg = spec.partition(":")
    name = obfusc.resolve_name(base)
    return "{}:{}".format(name, arg) if arg else name


def line_band(code):
    """0 for short snippets up to 3 for long ones."""
    n = code.count("\n") + 1
    if n <= 10:
        return 0
    if n <= 25:
        return 1
    if n <= 50:
        return 2
    return 3


# --------------------------------------------------------------------------- #
# Distractors
# --------------------------------------------------------------------------- #
_NUM = re.compile(r"-?\d+")
_WORD = re.compile(r"[A-Za-z]{3,}")


def _replace_span(text, match, replacement):
    return text[:match.start()] + replacement + text[match.end():]


def mutate_candidates(truth, rng):
    """Yield plausible wrong outputs derived from the true one."""
    out = []
    nums = list(_NUM.finditer(truth))
    words = list(_WORD.finditer(truth))
    lines = truth.rstrip("\n").split("\n")

    # Off-by-one and other number nudges.
    for m in nums:
        v = int(m.group())
        for delta in (1, -1, 2, 10):
            out.append(_replace_span(truth, m, str(v + delta)))
        if v not in (0, 1):
            out.append(_replace_span(truth, m, str(v * 2)))
    # Reversed words and reversed whole line.
    for m in words:
        out.append(_replace_span(truth, m, m.group()[::-1]))
    if len(lines) == 1 and len(truth.strip()) > 3:
        out.append(truth.strip()[::-1] + "\n")
    # Changed case.
    for m in words:
        w = m.group()
        for variant in (w.upper(), w.lower(), w.capitalize(), w.swapcase()):
            if variant != w:
                out.append(_replace_span(truth, m, variant))
    # Swapped order of two tokens on a line, or of two lines.
    for li, line in enumerate(lines):
        tokens = line.split(" ")
        if len(tokens) >= 2:
            for a in range(len(tokens) - 1):
                t = list(tokens)
                t[a], t[a + 1] = t[a + 1], t[a]
                new_lines = list(lines)
                new_lines[li] = " ".join(t)
                out.append("\n".join(new_lines) + "\n")
    if len(lines) >= 2:
        for a in range(len(lines) - 1):
            new_lines = list(lines)
            new_lines[a], new_lines[a + 1] = new_lines[a + 1], new_lines[a]
            out.append("\n".join(new_lines) + "\n")
    # Boolean flips and list element swaps inside brackets.
    for a, b in (("True", "False"), ("False", "True")):
        if a in truth:
            out.append(truth.replace(a, b, 1))
    for m in re.finditer(r"\[([^\[\]]+)\]", truth):
        parts = [p.strip() for p in m.group(1).split(",")]
        if len(parts) >= 2:
            p = list(parts)
            i = rng.randrange(len(p) - 1)
            p[i], p[i + 1] = p[i + 1], p[i]
            out.append(_replace_span(truth, m, "[" + ", ".join(p) + "]"))
            out.append(_replace_span(truth, m, "[" + ", ".join(parts[:-1]) + "]"))
    return out


def make_distractors(truth, rng, count=3):
    """Three wrong outputs that differ from the truth and from each other."""
    candidates = mutate_candidates(truth, rng)
    rng.shuffle(candidates)
    chosen = []
    seen = {truth.strip()}
    for c in candidates:
        key = c.strip()
        if key and key not in seen:
            seen.add(key)
            chosen.append(c)
        if len(chosen) == count:
            break
    # Very short outputs may not yield enough variants; pad deterministically.
    filler = 0
    while len(chosen) < count:
        filler += 1
        c = truth.rstrip("\n") + " " + str(filler) + "\n"
        if c.strip() not in seen:
            seen.add(c.strip())
            chosen.append(c)
    return chosen


# --------------------------------------------------------------------------- #
# Bank generation
# --------------------------------------------------------------------------- #
def load_programs():
    programs = {}
    for folder in PROGRAM_DIRS:
        for path in sorted(glob.glob(os.path.join(folder, "*.py"))):
            name = os.path.splitext(os.path.basename(path))[0]
            if name in programs:
                print("warning: duplicate program name {} in {}".format(name, path))
                continue
            with open(path, encoding="utf-8") as fh:
                source = fh.read()
            output, err = run_code(source)
            if err:
                print("skip program {}: {}".format(name, err))
                continue
            programs[name] = {"source": source, "output": output,
                              "language": "python", "path": os.path.relpath(path, HERE)}
    return programs


def build_items(programs):
    items = []
    failures = []
    for name, prog in programs.items():
        for specs, seeds in STACKS:
            for seed in seeds:
                try:
                    rungs = obfusc.ladder(prog["source"], specs, seed=seed)
                except Exception as exc:  # a transform could not handle the tree
                    failures.append((name, specs, seed, "ladder: {}".format(exc)))
                    continue
                # Keep only the transforms that actually changed the code, so
                # the difficulty score and the per-transform statistics are
                # honest (flatten is a no-op on programs without functions).
                applied = []
                for i, spec in enumerate(specs):
                    if rungs[i + 1]["code"] != rungs[i]["code"]:
                        applied.append(canonical_name(spec))
                code = rungs[-1]["code"]
                if not applied:
                    continue
                output, err = run_code(code)
                if err:
                    failures.append((name, specs, seed, err))
                    continue
                if output != prog["output"]:
                    failures.append((name, specs, seed, "output differs"))
                    continue
                item_id = "{}.{}.s{}".format(
                    name, "+".join(SHORT[a] for a in applied), seed)
                if any(it["id"] == item_id for it in items):
                    continue  # same effective stack already present
                rng = random.Random(item_id)
                items.append({
                    "id": item_id,
                    "program": name,
                    "transforms": applied,
                    "seed": seed,
                    "code": code,
                    "expected_output": output,
                    "distractors": make_distractors(output, rng),
                    "difficulty": len(applied) + line_band(code),
                    "language": "python",
                })
    return items, failures


def import_snippets(folder, programs, items):
    """Add an existing snippet set (name.py or name.js plus name.out)."""
    added = 0
    paths = sorted(glob.glob(os.path.join(folder, "*.py"))
                   + glob.glob(os.path.join(folder, "*.js")))
    for path in paths:
        stem, ext = os.path.splitext(os.path.basename(path))
        language = "python" if ext == ".py" else "javascript"
        out_path = os.path.join(folder, stem + ".out")
        if not os.path.exists(out_path):
            print("import: {} has no .out file, skipped".format(path))
            continue
        with open(path, encoding="utf-8") as fh:
            code = fh.read()
        with open(out_path, encoding="utf-8") as fh:
            expected = fh.read()
        meta = {}
        meta_path = os.path.join(folder, stem + ".meta.json")
        if os.path.exists(meta_path):
            with open(meta_path, encoding="utf-8") as fh:
                meta = json.load(fh)
        actual, err = run_code(code, language)
        if err:
            print("import: {} failed to run ({}), skipped".format(path, err))
            continue
        if actual.rstrip("\n") != expected.rstrip("\n"):
            print("import: {} output differs from its .out file, skipped".format(path))
            continue
        program = meta.get("program", stem)
        if program not in programs:
            # Without a clean version we show the snippet itself as the program.
            programs[program] = {"source": code, "output": actual,
                                 "language": language, "path": os.path.relpath(path, HERE)}
        transforms = [str(t) for t in meta.get("transforms", [])]
        item_id = "import.{}".format(stem)
        rng = random.Random(item_id)
        items.append({
            "id": item_id,
            "program": program,
            "transforms": transforms,
            "seed": meta.get("seed"),
            "code": code,
            "expected_output": actual,
            "distractors": make_distractors(actual, rng),
            "difficulty": len(transforms) + line_band(code),
            "language": language,
        })
        added += 1
    return added


def pick_fallback(items, count=FALLBACK_COUNT):
    """Pick items spread over the difficulty range, one program each if possible."""
    ordered = sorted(items, key=lambda it: (it["difficulty"], it["id"]))
    picked = []
    used_programs = set()
    step = max(1, len(ordered) // count)
    for start in (0, 1, 2):  # a few passes so we still fill up on a tiny bank
        for it in ordered[start::step]:
            if len(picked) == count:
                break
            if it["program"] in used_programs and start == 0:
                continue
            if it in picked:
                continue
            picked.append(it)
            used_programs.add(it["program"])
    return sorted(picked, key=lambda it: it["difficulty"])


def write_fallback(html_path, bank, items):
    with open(html_path, encoding="utf-8") as fh:
        html = fh.read()
    start = html.find(FALLBACK_START)
    end = html.find(FALLBACK_END)
    if start < 0 or end < 0:
        print("fallback markers not found in {}, skipped".format(html_path))
        return
    small = {
        "version": bank["version"],
        "note": "built-in fallback, {} of {} items".format(len(items), len(bank["items"])),
        "programs": {it["program"]: bank["programs"][it["program"]] for it in items},
        "items": items,
    }
    block = "{}\nconst BUILT_IN_BANK = {};\n{}".format(
        FALLBACK_START, json.dumps(small, ensure_ascii=False, separators=(",", ":")),
        FALLBACK_END)
    html = html[:start] + block + html[end + len(FALLBACK_END):]
    with open(html_path, "w", encoding="utf-8") as fh:
        fh.write(html)
    print("embedded {} fallback items in {}".format(len(items), os.path.basename(html_path)))


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--out", default=os.path.join(HERE, "bank.json"))
    ap.add_argument("--import", dest="import_dir", metavar="DIR",
                    help="folder of .py/.js snippets with companion .out files")
    ap.add_argument("--no-fallback", action="store_true",
                    help="do not rewrite the built-in fallback in index.html")
    args = ap.parse_args()

    programs = load_programs()
    print("programs: {}".format(len(programs)))
    items, failures = build_items(programs)
    print("generated items: {}".format(len(items)))
    for name, specs, seed, why in failures:
        print("  failed: {} {} seed={}: {}".format(name, specs, seed, why))
    if args.import_dir:
        n = import_snippets(args.import_dir, programs, items)
        print("imported items: {}".format(n))

    bank = {
        "version": 1,
        "generated_by": "build_bank.py",
        "programs": {k: {"source": v["source"], "output": v["output"],
                         "language": v["language"]} for k, v in programs.items()},
        "items": items,
    }
    text = json.dumps(bank, ensure_ascii=False, indent=0)
    size = len(text.encode("utf-8"))
    if size > MAX_BANK_BYTES:
        print("bank.json would be {} bytes, above the {} byte limit; "
              "reduce STACKS or seeds".format(size, MAX_BANK_BYTES))
        sys.exit(1)
    with open(args.out, "w", encoding="utf-8") as fh:
        fh.write(text)
    by_diff = {}
    for it in items:
        by_diff[it["difficulty"]] = by_diff.get(it["difficulty"], 0) + 1
    print("wrote {} ({} bytes)".format(os.path.relpath(args.out, HERE), size))
    print("difficulty histogram: {}".format(
        ", ".join("{}:{}".format(k, by_diff[k]) for k in sorted(by_diff))))

    if not args.no_fallback:
        write_fallback(os.path.join(HERE, "index.html"), bank, pick_fallback(items))


if __name__ == "__main__":
    main()
