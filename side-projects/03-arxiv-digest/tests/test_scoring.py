"""Unit tests for digest.py, run with:  python3 -m unittest discover -s tests"""

import datetime as dt
import json
import sys
import tempfile
import unittest
from pathlib import Path

TESTS = Path(__file__).resolve().parent
sys.path.insert(0, str(TESTS.parent))

import digest  # noqa: E402

SAMPLE = TESTS / "sample_cs.CL.xml"


class ParseTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.papers = digest.parse_feed(SAMPLE.read_bytes())
        cls.by_id = {p.arxiv_id: p for p in cls.papers}

    def test_item_count_and_fields(self):
        self.assertEqual(len(self.papers), 55)
        paper = self.by_id["2609.00013"]
        self.assertTrue(paper.title.startswith("Can Watermarks Survive Translation?"))
        self.assertEqual(paper.authors[0], "Zhiwei He")
        self.assertEqual(len(paper.authors), 8)
        self.assertEqual(paper.categories, ["cs.CL", "cs.CR"])
        self.assertEqual(paper.link, "https://arxiv.org/abs/2609.00013")
        self.assertEqual(paper.announce_type, "new")
        self.assertTrue(paper.abstract.startswith("Text watermarks for large language models"))
        self.assertNotIn("Announce Type", paper.abstract)

    def test_announce_types(self):
        self.assertEqual(self.by_id["2609.00008"].announce_type, "replace")
        self.assertEqual(self.by_id["2609.00003"].announce_type, "cross")

    def test_old_rdf_layout_still_parses(self):
        rdf = """<?xml version="1.0"?>
        <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
                 xmlns="http://purl.org/rss/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/">
          <item rdf:about="http://arxiv.org/abs/2301.00001">
            <title>Old Style Title. (arXiv:2301.00001v1 [cs.CL])</title>
            <link>http://arxiv.org/abs/2301.00001</link>
            <description>&lt;p&gt;An abstract with &lt;b&gt;tags&lt;/b&gt;.&lt;/p&gt;</description>
            <dc:creator>&lt;a href="x"&gt;Ada Lovelace&lt;/a&gt;, &lt;a href="y"&gt;Alan Turing&lt;/a&gt;</dc:creator>
          </item>
        </rdf:RDF>"""
        papers = digest.parse_feed(rdf)
        self.assertEqual(len(papers), 1)
        self.assertEqual(papers[0].arxiv_id, "2301.00001")
        self.assertEqual(papers[0].title, "Old Style Title.")
        self.assertEqual(papers[0].authors, ["Ada Lovelace", "Alan Turing"])
        self.assertEqual(papers[0].abstract, "An abstract with tags.")

    def test_atom_layout_parses(self):
        atom = """<feed xmlns="http://www.w3.org/2005/Atom">
          <entry>
            <id>http://arxiv.org/abs/2401.12345v2</id>
            <title>Atom Title</title>
            <summary>Atom abstract.</summary>
            <author><name>Grace Hopper</name></author>
            <category term="cs.SE"/>
          </entry>
        </feed>"""
        papers = digest.parse_feed(atom)
        self.assertEqual(papers[0].arxiv_id, "2401.12345")
        self.assertEqual(papers[0].authors, ["Grace Hopper"])
        self.assertEqual(papers[0].categories, ["cs.SE"])

    def test_merge_across_feeds(self):
        a = digest.parse_feed(SAMPLE.read_bytes())
        b = digest.parse_feed(SAMPLE.read_bytes())
        merged = digest.merge_papers([("cs.CL", a), ("cs.LG", b)])
        self.assertEqual(len(merged), 55)
        self.assertEqual(merged["2609.00013"].feeds, ["cs.CL", "cs.LG"])


class ScoringTests(unittest.TestCase):
    def make(self, title, abstract=""):
        return digest.Paper("0000.00000", title, [], abstract, "", [])

    def test_phrase_matching_and_title_bonus(self):
        terms = digest.compile_terms([{"term": "sparse autoencoder", "weight": 5}])
        in_title = self.make("Scaling Sparse Autoencoders", "nothing here")
        in_abstract = self.make("A paper", "we train a sparse autoencoder")
        neither = self.make("Sparse things", "an autoencoder that is sparse")
        self.assertEqual(digest.score_paper(in_title, terms, [], 2.0)[0], 10.0)
        self.assertEqual(digest.score_paper(in_abstract, terms, [], 2.0)[0], 5.0)
        self.assertEqual(digest.score_paper(neither, terms, [], 2.0)[0], 0.0)

    def test_word_mode_ignores_order(self):
        terms = digest.compile_terms([{"term": "sparse autoencoder", "weight": 5, "phrase": False}])
        paper = self.make("Sparse things", "an autoencoder that is sparse")
        self.assertEqual(digest.score_paper(paper, terms, [], 2.0)[0], 5.0)

    def test_hyphen_plural_and_case(self):
        terms = digest.compile_terms([{"term": "cross-lingual", "weight": 4}, {"term": "circuit", "weight": 3}])
        paper = self.make("CROSS LINGUAL transfer", "We find circuits.")
        score, matches = digest.score_paper(paper, terms, [], 2.0)
        self.assertEqual(score, 8.0 + 3.0)
        self.assertEqual([(m[0], m[1]) for m in matches], [("cross-lingual", "title"), ("circuit", "abstract")])

    def test_word_boundaries(self):
        terms = digest.compile_terms([{"term": "SAE", "weight": 2}])
        self.assertEqual(digest.score_paper(self.make("Saeed et al. on SAEs"), terms, [], 2.0)[0], 4.0)
        self.assertEqual(digest.score_paper(self.make("Saeed alone"), terms, [], 2.0)[0], 0.0)

    def test_negative_terms_subtract(self):
        terms = digest.compile_terms([{"term": "language model", "weight": 1}])
        negatives = digest.compile_terms([{"term": "diffusion model", "weight": 2}])
        paper = self.make("Diffusion Models for Images", "a language model helps")
        score, matches = digest.score_paper(paper, terms, negatives, 2.0)
        self.assertEqual(score, 1.0 - 4.0)
        self.assertIn(("diffusion model", "title", -4.0), matches)

    def test_sample_ranking_uses_shipped_config(self):
        config = digest.load_config(digest.DEFAULT_CONFIG)
        terms = digest.compile_terms(config["terms"])
        negatives = digest.compile_terms(config["negative_terms"])
        papers = digest.parse_feed(SAMPLE.read_bytes())
        for paper in papers:
            paper.score, paper.matches = digest.score_paper(paper, terms, negatives, config["title_bonus"])
        by_id = {p.arxiv_id: p for p in papers}
        self.assertGreater(by_id["2609.00013"].score, 15)   # watermark that survives translation
        self.assertGreater(by_id["2609.00001"].score, 10)   # sparse autoencoders
        self.assertLess(by_id["2609.00031"].score, 1)       # diffusion models
        self.assertLess(by_id["2609.00051"].score, 1)       # residual nets for images


class MemoryAndRenderTests(unittest.TestCase):
    def test_prune_seen(self):
        today = dt.date(2026, 9, 22)
        seen = {"a": "2026-09-01", "b": "2026-01-01", "c": "garbage"}
        self.assertEqual(digest.prune_seen(seen, today, 90), {"a": "2026-09-01"})

    def test_end_to_end_offline_writes_digest_and_seen(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            argv = ["--offline", str(SAMPLE), "--out", str(tmp / "d"), "--seen", str(tmp / "seen.json"),
                    "--top", "3", "--date", "2026-09-22"]
            self.assertEqual(digest.main(argv), 0)
            text = (tmp / "d" / "2026-09-22.md").read_text(encoding="utf-8")
            self.assertIn("## 1. [Can Watermarks Survive Translation?", text)
            self.assertIn("et al.", text)
            self.assertIn("3 shown", text)
            seen = json.loads((tmp / "seen.json").read_text())
            self.assertEqual(len(seen), 3)
            self.assertEqual(seen["2609.00013"], "2026-09-22")

            # A second run must not repeat those three.
            self.assertEqual(digest.main(argv + ["--date", "2026-09-23"]), 0)
            text2 = (tmp / "d" / "2026-09-23.md").read_text(encoding="utf-8")
            self.assertNotIn("2609.00013", text2)
            self.assertEqual(len(json.loads((tmp / "seen.json").read_text())), 6)

            # --reset forgets everything again.
            self.assertEqual(digest.main(argv + ["--reset", "--date", "2026-09-24"]), 0)
            self.assertEqual(len(json.loads((tmp / "seen.json").read_text())), 3)

    def test_format_authors(self):
        self.assertEqual(digest.format_authors(["A", "B"], 5), "A, B")
        self.assertEqual(digest.format_authors(list("ABCDEFG"), 5), "A, B, C, D, E et al.")


if __name__ == "__main__":
    unittest.main()
