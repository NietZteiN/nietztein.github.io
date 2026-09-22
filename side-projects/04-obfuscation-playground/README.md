# Obfuscation Playground

A local tool for studying how obfuscation transforms compose. Paste a Python or
JavaScript snippet, pick transforms from a list, reorder them, and see them
applied one at a time as a "ladder" from clean code to fully obfuscated. Each
rung shows a colored diff against the rung before it. The transforms are
composable functions on the abstract syntax tree, so they can be stacked and
reordered, which is how real obfuscated code is built. Python transforms run on
a small local server; JavaScript transforms run entirely in the browser.

## How to run

Serve the UI (Python transforms need the server):

    cd 04-obfuscation-playground
    python3 serve.py            # then open http://127.0.0.1:8000/
    python3 serve.py --port 9000

The server binds to 127.0.0.1 only. JavaScript ladders also work by opening
`static/index.html` directly from disk, with no server.

Command line (Python only), prints the ladder as Markdown:

    python3 -m obfusc --lang python \
        --transforms rename:adversarial,flatten,dead_code --seed 1 examples/python/fizzbuzz.py

Run the tests:

    python3 -m unittest discover -s tests

## The transforms

Each transform is a function `transform(tree, rng, options) -> tree`, registered
in `obfusc.REGISTRY` with a name, a description, and an options schema. The same
five are implemented for both languages.

- **rename_identifiers**: renames local identifiers. `mode="uninformative"`
  gives names like `a1, b2` (or `l, I, O` lookalikes with `style="lookalike"`);
  `mode="adversarial"` swaps in misleading names, for example a counter renamed
  `total_price` or a list renamed `is_valid`. Builtins, attributes of external
  objects, and keyword-argument names of external calls are never renamed.
- **control_flow_flatten**: rewrites each function body as a `while` loop with a
  state variable and an if/elif dispatch. Bodies using `try` or `with` are
  skipped gracefully.
- **dead_code_insertion**: inserts opaque always-false predicates (like
  `if (x*x) < 0:`) guarding junk, plus unused variable assignments.
- **string_encoding**: replaces string literals with decode calls (`base64` or a
  reversible `xor`) and injects a small decode helper at the top.
- **expression_rewriting**: obfuscates small integer constants, rewrites `x+1`
  into `x-(-1)` and `n*2` into `n<<1` where it is safe, and wraps boolean test
  positions in double negation.

The `ladder(source, transforms, seed)` function returns the rungs
`[{name, code, diff}]`, where `diff` is a unified diff against the previous rung.
`equivalence_check(original, obfuscated)` runs both programs in a subprocess with
the same input and compares stdout, which is how the tests prove each transform
preserved behaviour on the bundled examples.

## Using obfusc from another project

Project 5 (the guessing game) reuses these transforms. Import the package by
inserting this folder onto `sys.path`:

    import sys, pathlib
    sys.path.insert(0, str(pathlib.Path("side-projects/04-obfuscation-playground")))
    import obfusc
    rungs = obfusc.ladder(source, ["rename:adversarial", "flatten"], seed=1)

## File layout

    obfusc/                    the Python package
      python_transforms.py     the five transforms + REGISTRY
      core.py                  ladder, equivalence_check, ladder_to_markdown
      __main__.py              the CLI
    static/
      index.html               the browser UI (three panels + ladder)
      js_transforms.js         the JavaScript transforms (runs in the browser)
      examples.js              examples embedded for offline (file://) use
    vendor/                    acorn, acorn-walk, astring (MIT), + README
    examples/python/*.py       6 Python examples with deterministic output
    examples/js/*.js           4 JavaScript examples with deterministic output
    tests/test_transforms.py   equivalence tests over every example
    tools/build_examples.py    regenerates static/examples.js from examples/
    serve.py                   the local server
    screenshot.png             a screenshot of the UI

## Assumptions

- **Scope handling is conservative for single-file snippets.** The Python
  renamer uses one consistent name map and excludes a name everywhere if it is
  risky anywhere (a builtin, an import, a method name, a method or lambda
  parameter). Parameters are renamed only for plain functions whose name is also
  renamed, so the matching keyword arguments at internal call sites can be
  rewritten together. This is safe but sometimes renames less than it could.
- **JavaScript is a documented subset.** The JS renamer assumes a snippet does
  not use the same name as both a local binding in one place and an undeclared
  global in another. JS control-flow flattening hoists simple `let`/`const`/`var`
  declarations (const becomes let) and function declarations, and skips
  functions whose top level uses `try`, destructuring declarations, or class
  declarations. The Python `x+1 -> x-(-1)` rewrite is omitted for JavaScript,
  where `+` also concatenates strings and the rewrite would not be safe.
- **The CLI handles Python only.** JavaScript transforms are browser side by
  design (they use the vendored parser and generator).
- **Determinism** comes from a per-rung seed, so the same inputs and seed always
  give the same ladder.
- **Vendored libraries** were taken from the npm tarballs because the jsdelivr
  CDN was blocked in the build environment. They are the same `dist/` files.
  See `vendor/README.md` for versions, licenses, and how to refresh them.

## Ideas for later

- A "highlight what changed and why" mode that annotates each rung with the
  reasoning behind the transform.
- Measure obfuscation strength (identifier entropy, cyclomatic complexity,
  literal coverage) and show it per rung.
- More transforms: function inlining and outlining, bogus control-flow with
  real (not always-false) opaque predicates, and integer encoding with mixed
  boolean-arithmetic.
- A server-side equivalence check button in the UI, run on the bundled examples.
