"""The ladder builder and the equivalence checker.

``ladder`` applies transforms one at a time and returns a list of rungs, each
with the full code at that step and a unified diff against the previous rung.
``equivalence_check`` runs an original and an obfuscated program in a subprocess
with the same input and compares their output, which is how the test suite
proves that a transform preserved behaviour.
"""

from __future__ import annotations

import ast
import difflib
import random
import subprocess
import sys
import tempfile
import os

from .python_transforms import REGISTRY, resolve_name


def _normalize_transforms(transforms):
    """Accept several spellings and return a list of (name, options) pairs.

    Each entry may be:
      * a string ``"rename"`` or ``"rename:adversarial"``
      * a dict ``{"name": "rename_identifiers", "options": {...}}``
    """
    result = []
    for item in transforms:
        if isinstance(item, dict):
            name = resolve_name(item["name"])
            options = dict(item.get("options") or {})
        else:
            text = str(item)
            if ":" in text:
                base, _, arg = text.partition(":")
                name = resolve_name(base.strip())
                # A bare argument is interpreted per transform: rename uses it
                # as the mode, string_encoding as the method.
                options = {}
                if name == "rename_identifiers":
                    options["mode"] = arg.strip()
                elif name == "string_encoding":
                    options["method"] = arg.strip()
                else:
                    options["mode"] = arg.strip()
            else:
                name = resolve_name(text.strip())
                options = {}
        result.append((name, options))
    return result


def _unparse(tree):
    return ast.unparse(tree)


def ladder(source, transforms, seed=0):
    """Build the obfuscation ladder.

    Returns a list of rungs ``[{name, code, diff}]``. The first rung is the
    canonicalized original (its diff is empty); each following rung applies one
    transform on top of the running tree and diffs against the rung before it.
    """
    pairs = _normalize_transforms(transforms)
    tree = ast.parse(source)

    rungs = []
    prev_code = _unparse(tree)
    rungs.append({"name": "original", "code": prev_code, "diff": ""})

    for i, (name, options) in enumerate(pairs):
        rng = random.Random("{}:{}:{}".format(seed, i, name))
        entry = REGISTRY[name]
        tree = entry["func"](tree, rng, options)
        # Re-parse through unparse so downstream transforms always see a clean
        # tree with locations, and so the displayed code matches what runs.
        code = _unparse(tree)
        tree = ast.parse(code)

        diff_lines = difflib.unified_diff(
            prev_code.splitlines(),
            code.splitlines(),
            fromfile=rungs[-1]["name"],
            tofile=name,
            lineterm="",
        )
        label = name
        if options:
            label = "{} ({})".format(
                name, ", ".join("{}={}".format(k, v) for k, v in options.items()))
        rungs.append({"name": label, "code": code, "diff": "\n".join(diff_lines)})
        prev_code = code

    return rungs


def equivalence_check(original, obfuscated, entrypoint=None):
    """Run both programs as scripts and compare their stdout.

    ``entrypoint`` is an optional dict with keys ``stdin`` (str) and ``argv``
    (list of str). It is named to leave room for future call-a-function modes;
    for the bundled script examples the programs simply run top to bottom.

    Returns a dict with the comparison result and the captured output.
    """
    entrypoint = entrypoint or {}
    stdin_text = entrypoint.get("stdin", "")
    argv = entrypoint.get("argv", [])
    timeout = entrypoint.get("timeout", 10)

    def run(src):
        with tempfile.NamedTemporaryFile(
                "w", suffix=".py", delete=False, encoding="utf-8") as fh:
            fh.write(src)
            path = fh.name
        try:
            proc = subprocess.run(
                [sys.executable, path, *map(str, argv)],
                input=stdin_text,
                capture_output=True,
                text=True,
                timeout=timeout,
            )
            return proc.stdout, proc.stderr, proc.returncode
        finally:
            os.unlink(path)

    o_out, o_err, o_rc = run(original)
    b_out, b_err, b_rc = run(obfuscated)
    return {
        "equal": (o_out == b_out) and (o_rc == b_rc),
        "original_stdout": o_out,
        "obfuscated_stdout": b_out,
        "original_stderr": o_err,
        "obfuscated_stderr": b_err,
        "original_returncode": o_rc,
        "obfuscated_returncode": b_rc,
    }


def ladder_to_markdown(source, transforms, seed=0, title=None):
    """Render a ladder as a Markdown document (used by the CLI)."""
    rungs = ladder(source, transforms, seed)
    out = []
    if title:
        out.append("# {}".format(title))
        out.append("")
    out.append("Seed: {}".format(seed))
    out.append("")
    for i, rung in enumerate(rungs):
        out.append("## Rung {}: {}".format(i, rung["name"]))
        out.append("")
        out.append("```python")
        out.append(rung["code"])
        out.append("```")
        out.append("")
        if rung["diff"]:
            out.append("Diff against previous rung:")
            out.append("")
            out.append("```diff")
            out.append(rung["diff"])
            out.append("```")
            out.append("")
    return "\n".join(out)
