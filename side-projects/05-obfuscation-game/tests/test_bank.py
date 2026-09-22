"""Checks that bank.json is sound.

For every item: the obfuscated code runs and prints exactly expected_output,
the three distractors differ from the truth and from each other, and the
recorded difficulty matches the scoring rule. Also checks that every clean
program reproduces its stored output and that the file stays under 1 MB.

Run with:
    python3 -m unittest discover -s tests
"""

import json
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)

import build_bank  # noqa: E402

BANK_PATH = os.path.join(ROOT, "bank.json")


def _load():
    with open(BANK_PATH, encoding="utf-8") as fh:
        return json.load(fh)


class BankShape(unittest.TestCase):
    def test_size_limit(self):
        self.assertLessEqual(os.path.getsize(BANK_PATH), build_bank.MAX_BANK_BYTES)

    def test_fields(self):
        bank = _load()
        keys = {"id", "program", "transforms", "seed", "code", "expected_output",
                "distractors", "difficulty", "language"}
        ids = set()
        for item in bank["items"]:
            self.assertTrue(keys <= set(item), item.get("id"))
            self.assertNotIn(item["id"], ids)
            ids.add(item["id"])
            self.assertIn(item["program"], bank["programs"])
            self.assertEqual(len(item["distractors"]), 3)
            outs = {item["expected_output"].strip()} | {d.strip() for d in item["distractors"]}
            self.assertEqual(len(outs), 4, item["id"])
            self.assertEqual(
                item["difficulty"],
                len(item["transforms"]) + build_bank.line_band(item["code"]), item["id"])


class BankReproduces(unittest.TestCase):
    """Every snippet and every clean program runs and prints its stored output."""


def _make_item_test(item):
    def test(self):
        out, err = build_bank.run_code(item["code"], item["language"])
        self.assertIsNone(err, "{}: {}".format(item["id"], err))
        self.assertEqual(out, item["expected_output"], item["id"])
    return test


def _make_program_test(name, prog):
    def test(self):
        out, err = build_bank.run_code(prog["source"], prog["language"])
        self.assertIsNone(err, "{}: {}".format(name, err))
        self.assertEqual(out, prog["output"], name)
    return test


if os.path.exists(BANK_PATH):
    _bank = _load()
    for _item in _bank["items"]:
        setattr(BankReproduces, "test_item_" + _item["id"].replace(".", "_").replace("+", "_"),
                _make_item_test(_item))
    for _name, _prog in _bank["programs"].items():
        setattr(BankReproduces, "test_program_" + _name, _make_program_test(_name, _prog))


if __name__ == "__main__":
    unittest.main()
