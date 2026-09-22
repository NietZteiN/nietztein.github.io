"""obfusc: composable AST-based code obfuscation transforms.

Public API:
    REGISTRY            mapping of transform name -> {func, description, options}
    ladder              build the clean-to-obfuscated ladder of rungs
    equivalence_check   run original and obfuscated in subprocesses and compare
    ladder_to_markdown  render a ladder as Markdown
    resolve_name        map a short alias to a full transform name

Project 5 (the guessing game) imports this package. Keep it importable by
inserting this folder onto sys.path, for example:

    import sys, pathlib
    sys.path.insert(0, str(pathlib.Path("side-projects/04-obfuscation-playground")))
    import obfusc
"""

from .python_transforms import REGISTRY, ALIASES, resolve_name
from .core import ladder, equivalence_check, ladder_to_markdown

__all__ = [
    "REGISTRY",
    "ALIASES",
    "resolve_name",
    "ladder",
    "equivalence_check",
    "ladder_to_markdown",
]
