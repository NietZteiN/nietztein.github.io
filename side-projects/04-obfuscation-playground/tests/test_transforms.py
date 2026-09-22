"""Behaviour-preservation tests for the Python transforms.

For every bundled Python example, this checks that:
  * each single transform still runs and prints the same stdout as the original,
  * two different stacked orders of all transforms do the same.

Run with:
    python3 -m unittest discover -s tests
or:
    python3 tests/test_transforms.py
"""

import glob
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)  # project 5 imports obfusc the same way

import obfusc  # noqa: E402

EXAMPLE_DIR = os.path.join(ROOT, "examples", "python")
EXAMPLES = sorted(glob.glob(os.path.join(EXAMPLE_DIR, "*.py")))

SINGLE = [
    ("rename_identifiers", {"mode": "uninformative"}),
    ("rename_identifiers", {"mode": "uninformative", "style": "lookalike"}),
    ("rename_identifiers", {"mode": "adversarial"}),
    ("control_flow_flatten", {}),
    ("dead_code_insertion", {"density": 0.6}),
    ("string_encoding", {"method": "base64"}),
    ("string_encoding", {"method": "xor"}),
    ("expression_rewriting", {}),
]

ORDER_A = [
    {"name": "rename_identifiers", "options": {"mode": "adversarial"}},
    {"name": "expression_rewriting", "options": {}},
    {"name": "string_encoding", "options": {"method": "base64"}},
    {"name": "dead_code_insertion", "options": {"density": 0.4}},
    {"name": "control_flow_flatten", "options": {}},
]
ORDER_B = list(reversed(ORDER_A))

SEEDS = [0, 1, 7]


class TransformEquivalence(unittest.TestCase):
    maxDiff = None


def _make_single_test(example, name, options, seed):
    def test(self):
        with open(example, encoding="utf-8") as _fh:
            src = _fh.read()
        rungs = obfusc.ladder(src, [{"name": name, "options": options}], seed=seed)
        obf = rungs[-1]["code"]
        result = obfusc.equivalence_check(src, obf)
        self.assertTrue(
            result["equal"],
            "output changed for {} + {} {} seed={}\n--- stderr ---\n{}\n--- code ---\n{}".format(
                os.path.basename(example), name, options, seed,
                result["obfuscated_stderr"], obf),
        )
    return test


def _make_stacked_test(example, order, label, seed):
    def test(self):
        with open(example, encoding="utf-8") as _fh:
            src = _fh.read()
        rungs = obfusc.ladder(src, order, seed=seed)
        self.assertEqual(len(rungs), len(order) + 1)  # original + one per step
        obf = rungs[-1]["code"]
        result = obfusc.equivalence_check(src, obf)
        self.assertTrue(
            result["equal"],
            "output changed for {} stacked order {} seed={}\n--- stderr ---\n{}\n--- code ---\n{}".format(
                os.path.basename(example), label, seed,
                result["obfuscated_stderr"], obf),
        )
    return test


# Generate one test method per (example, transform, seed) combination.
for _ex in EXAMPLES:
    _base = os.path.basename(_ex)[:-3]
    for _name, _opts in SINGLE:
        for _seed in SEEDS:
            _tag = "{}_{}_{}_{}".format(
                _base, _name, "_".join(str(v) for v in _opts.values()) or "def", _seed)
            setattr(TransformEquivalence, "test_single_" + _tag,
                    _make_single_test(_ex, _name, _opts, _seed))
    for _order, _label in ((ORDER_A, "A"), (ORDER_B, "B")):
        for _seed in SEEDS:
            setattr(TransformEquivalence,
                    "test_stacked_{}_{}_{}".format(_base, _label, _seed),
                    _make_stacked_test(_ex, _order, _label, _seed))


class LadderShape(unittest.TestCase):
    def test_rung_fields(self):
        with open(EXAMPLES[0], encoding="utf-8") as _fh:
            src = _fh.read()
        rungs = obfusc.ladder(src, ["rename", "flatten"], seed=1)
        self.assertEqual(rungs[0]["name"], "original")
        self.assertEqual(rungs[0]["diff"], "")
        for rung in rungs:
            self.assertIn("name", rung)
            self.assertIn("code", rung)
            self.assertIn("diff", rung)
        # Later rungs carry a non-empty unified diff.
        self.assertTrue(rungs[1]["diff"].startswith("---"))

    def test_alias_resolution(self):
        self.assertEqual(obfusc.resolve_name("rename"), "rename_identifiers")
        self.assertEqual(obfusc.resolve_name("flatten"), "control_flow_flatten")
        with self.assertRaises(KeyError):
            obfusc.resolve_name("nope")


if __name__ == "__main__":
    unittest.main(verbosity=2)
