#!/usr/bin/env python3
"""Regenerate static/examples.js from the canonical files in examples/.

The UI embeds the examples so it works when opened directly from file://
(where fetch of local files is blocked). Run this after editing any example:

    python3 tools/build_examples.py
"""
import json
import glob
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def main():
    data = {"python": {}, "js": {}}
    for path in sorted(glob.glob(os.path.join(ROOT, "examples", "python", "*.py"))):
        data["python"][os.path.basename(path)[:-3]] = open(path, encoding="utf-8").read()
    for path in sorted(glob.glob(os.path.join(ROOT, "examples", "js", "*.js"))):
        data["js"][os.path.basename(path)[:-3]] = open(path, encoding="utf-8").read()
    out = ("// Auto-generated from examples/. Do not edit by hand; "
           "run tools/build_examples.py.\n")
    out += "window.OBF_EXAMPLES = " + json.dumps(data, indent=2, ensure_ascii=False) + ";\n"
    with open(os.path.join(ROOT, "static", "examples.js"), "w", encoding="utf-8") as fh:
        fh.write(out)
    print("wrote static/examples.js")


if __name__ == "__main__":
    main()
