"""Command line interface for the obfuscation playground.

Example:
    python3 -m obfusc --lang python \\
        --transforms rename:adversarial,flatten,dead_code --seed 1 file.py

Prints the ladder (clean code to fully obfuscated) as Markdown to stdout.
JavaScript transforms run in the browser; the CLI only supports Python.
"""

from __future__ import annotations

import argparse
import sys

from .core import ladder_to_markdown


def main(argv=None):
    parser = argparse.ArgumentParser(
        prog="python3 -m obfusc",
        description="Apply composable obfuscation transforms and print the "
                    "ladder as Markdown.",
    )
    parser.add_argument("file", help="path to a source file, or - for stdin")
    parser.add_argument("--lang", default="python", choices=["python"],
                        help="source language (only python is supported in the "
                             "CLI; JavaScript runs in the browser UI)")
    parser.add_argument("--transforms", required=True,
                        help="comma separated transforms, each optionally with "
                             "an argument, e.g. rename:adversarial,flatten,"
                             "dead_code,strings:xor,expr")
    parser.add_argument("--seed", type=int, default=0,
                        help="random seed for deterministic output")
    args = parser.parse_args(argv)

    if args.file == "-":
        source = sys.stdin.read()
        title = "Obfuscation ladder (stdin)"
    else:
        with open(args.file, "r", encoding="utf-8") as fh:
            source = fh.read()
        title = "Obfuscation ladder for {}".format(args.file)

    transforms = [t.strip() for t in args.transforms.split(",") if t.strip()]
    try:
        md = ladder_to_markdown(source, transforms, seed=args.seed, title=title)
    except KeyError as exc:
        parser.error("unknown transform: {}".format(exc))
        return 2
    except SyntaxError as exc:
        parser.error("could not parse source: {}".format(exc))
        return 2

    sys.stdout.write(md)
    if not md.endswith("\n"):
        sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
