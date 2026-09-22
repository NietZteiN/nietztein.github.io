"""Unit tests for the linter rules and the Markov chain.

    python3 -m unittest discover -s tests -v
"""

import random
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import titles  # noqa: E402

CORPUS = [
    "Attention Is All You Need",
    "BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding",
    "Language Models are Few-Shot Learners",
    "Language Models are Unsupervised Multitask Learners",
    "Towards Automated Circuit Discovery for Mechanistic Interpretability",
    "Sparse Autoencoders Find Highly Interpretable Features in Language Models",
    "Machine Unlearning of Features and Labels",
    "A Watermark for Large Language Models",
    "Learning to Represent Programs with Graphs (Extended Version)",
    "Rethinking Machine Unlearning for Large Language Models",
    "Evaluating Large Language Models Trained on Code",
    "Robust Distortion-free Watermarks for Language Models",
]


def rules_of(result):
    return [msg for _, msg in result["rules"]]


class LintRules(unittest.TestCase):
    def test_opener_and_colon(self):
        r = titles.lint("Towards Rethinking X: A Y Approach")
        self.assertIn('opener "Towards"', rules_of(r))
        self.assertIn('opener "Rethinking" stacked on it', rules_of(r))
        self.assertIn("colon present", rules_of(r))
        self.assertIn("prefix of 3 words before the colon", rules_of(r))
        self.assertEqual(r["score"], 49)

    def test_all_you_need(self):
        r = titles.lint("Attention Is All You Need")
        self.assertIn('"All You Need"', rules_of(r))
        self.assertIn('"is All You Need" in full', rules_of(r))
        self.assertEqual(r["score"], 20)

    def test_cute_acronym_but_not_hyphen(self):
        self.assertIn('cute acronym "CodeBERT"', rules_of(titles.lint("CodeBERT: A Model")))
        hyphen = rules_of(titles.lint("Real-World Evaluation of Parsers"))
        self.assertFalse(any(m.startswith("cute acronym") for m in hyphen))
        self.assertIn('all-caps name "TOFU" before the colon',
                      rules_of(titles.lint("TOFU: A Task of Fictitious Unlearning")))

    def test_question_survey_benchmark_via_meets(self):
        r = titles.lint("Vision Meets Language: A Survey and Benchmark via Prompting?")
        for m in ["question mark", '"A Survey"', '"Benchmark"', '"via"', '"Meets"']:
            self.assertIn(m, rules_of(r))

    def test_buzzwords_and_length(self):
        r = titles.lint("Efficient Robust Scalable Unified LLM Transformer")
        self.assertIn("buzzwords 6/6: efficient, robust, scalable, unified, llm, transformer", rules_of(r))
        long = titles.lint(" ".join(["word"] * 21))
        self.assertIn("21 words, an abstract in disguise", rules_of(long))
        self.assertIn("2-word title, the monolith", rules_of(titles.lint("Segment Anything")))

    def test_score_is_capped_and_plain_title_is_zero(self):
        big = titles.lint("Towards Rethinking LLMs Meet Transformers: A Survey and Benchmark "
                          "via Efficient Robust Scalable Unified Large Language Models Is All You Need?")
        self.assertEqual(big["score"], 100)
        self.assertEqual(titles.lint("Deep Residual Learning for Image Recognition")["score"], 0)

    def test_lint_file_ranks(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "t.txt"
            p.write_text("Plain Title Here\nTowards X: All You Need?\n", encoding="utf-8")
            rows = sorted(((titles.lint(t)["score"], t) for t in titles.read_titles(p)), reverse=True)
            self.assertEqual(rows[0][1], "Towards X: All You Need?")


class ChainAndModel(unittest.TestCase):
    def setUp(self):
        self.model = titles.TitleModel(CORPUS)

    def test_order2_with_backoff(self):
        chain = self.model.body
        # Order 2 state seen in the corpus.
        self.assertIn("are", chain.options("Language", "Models"))
        # Unseen pair falls back to order 1 on the last word.
        self.assertIn("are", chain.options("Never", "Models"))
        self.assertIsNone(chain.options("Never", "Seen"))

    def test_structure_learned(self):
        self.assertAlmostEqual(self.model.colon_prob, 1 / len(CORPUS))
        self.assertEqual(self.model.prefix_lengths, {1: 1})
        self.assertIn(("Language", "Models"), self.model.openers)

    def test_generate_is_deterministic_and_never_verbatim(self):
        a = self.model.generate_many(8, seed=3)
        b = self.model.generate_many(8, seed=3)
        self.assertEqual(a, b)
        for t in a:
            self.assertFalse(self.model.is_known(t), t)
            self.assertTrue(titles.balanced(t), t)
            # Bodies must end naturally, so they stay under the hard cap.
            self.assertLess(len(titles.split_colon(t)[1]), titles.MAX_BODY_WORDS)
            self.assertTrue(t[0].isupper(), t)

    def test_topic_keyword_required(self):
        for topic, words in titles.TOPICS.items():
            for t in self.model.generate_many(5, seed=1, topic=topic):
                self.assertTrue(titles.has_keyword(t, words), (topic, t))
        with self.assertRaises(ValueError):
            self.model.generate(random.Random(0), topic="nope")

    def test_temperature_zero_is_greedy(self):
        c = titles.weighted_choice(random.Random(0), {"x": 1, "y": 5}, 0)
        self.assertEqual(c, "y")

    def test_helpers(self):
        self.assertFalse(titles.balanced("A (B"))
        self.assertFalse(titles.balanced('A "B'))
        self.assertTrue(titles.balanced("A (B) [C]"))
        self.assertEqual(titles.strip_brackets('A (B "C'), "A B C")
        self.assertEqual(titles.fix_case("towards x: a y"), "Towards x: A y")
        self.assertEqual(titles.key("BERT: Pre-training!"), "bert pre training")

    def test_load_titles_merges_and_dedupes(self):
        with tempfile.TemporaryDirectory() as d:
            a = Path(d) / "a.txt"
            b = Path(d) / "b.txt"
            a.write_text("# comment\nAlpha Beta\nGamma\n", encoding="utf-8")
            b.write_text("alpha beta\nDelta\n\n", encoding="utf-8")
            self.assertEqual(titles.load_titles([a, b]), ["Alpha Beta", "Gamma", "Delta"])


if __name__ == "__main__":
    unittest.main()
