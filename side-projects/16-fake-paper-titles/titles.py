#!/usr/bin/env python3
"""Fake paper title generator and cliché linter. Standard library only.

    python3 titles.py generate --n 10 --seed 3 --temperature 0.9
    python3 titles.py generate --topic interp
    python3 titles.py lint "Towards Rethinking X: A Y Approach"
    python3 titles.py lint --file titles.txt
    python3 titles.py stats
    python3 titles.py build-page

Training data is the union of two files (see DEFAULT_SOURCES): the titles that
project 3 collects from the arXiv feeds, and a hand-curated seed in data/.

The generator is a word-level Markov chain of order 2 with backoff to order 1,
wrapped in a small structural model: how often titles have a colon, how many
words come before it, and which two-word openers start the main clause.
"""

import argparse
import json
import random
import re
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
DEFAULT_SOURCES = [
    HERE.parent / "03-arxiv-digest" / "data" / "titles.txt",
    HERE / "data" / "seed_titles.txt",
]
TEMPLATE = HERE / "page_template.html"
PAGE = HERE / "index.html"

START = "\x02"
END = "\x03"

# Words a title should not end on. Trailing ones are trimmed after a length cut.
DANGLING = {
    "a", "an", "and", "as", "at", "by", "for", "from", "in", "into", "is",
    "of", "on", "or", "the", "to", "via", "with", "without", "through",
    "using", "over", "under", "between", "are", "its", "their", "vs.", "vs",
    "&", "than", "that", "when", "how", "why", "what",
}

# Openers that promise a question; the title must then end with "?".
QUESTION_WORDS = {"Can", "Do", "Does", "Is", "Are", "What", "How", "Why",
                  "When", "Where", "Should", "Will"}

# Keywords for --topic. A generated title must contain at least one of them.
TOPICS = {
    "interp": ["interpretab", "mechanistic", "circuit", "probing", "probe",
               "attention head", "neuron", "sparse autoencoder", "activation",
               "patching", "attribution", "explanation", "explaining",
               "monosemantic", "features", "saliency", "dictionary learning"],
    "unlearning": ["unlearn", "forget", "removal", "erasing", "editing",
                   "memorization", "delete"],
    "code": ["code", "program", "software", "github", "source", "obfusc",
             "bug", "copilot", "repository"],
    "watermark": ["watermark", "detect", "provenance", "ai-generated",
                  "machine-generated", "radioactive"],
}

MAX_BODY_WORDS = 14   # hard cap on the main clause
SOFT_BODY_WORDS = 9   # from here on the END token is boosted
MAX_PREFIX_WORDS = 10


# ----------------------------------------------------------------------------
# Training data


def normalize(title):
    """Whitespace-normalized title text."""
    return " ".join(title.split())


def key(title):
    """Case- and punctuation-insensitive form used for deduplication and the
    verbatim check."""
    return re.sub(r"[^a-z0-9]+", " ", title.lower()).strip()


def read_titles(path):
    """Read one title per line. Blank lines and # comments are skipped."""
    path = Path(path)
    if not path.exists():
        return []
    out = []
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            line = normalize(line)
            if line and not line.startswith("#"):
                out.append(line)
    return out


def load_titles(paths=None):
    """Merge every source, keep first spelling of each title, drop duplicates."""
    seen = set()
    merged = []
    for path in paths or DEFAULT_SOURCES:
        for title in read_titles(path):
            k = key(title)
            if k and k not in seen:
                seen.add(k)
                merged.append(title)
    return merged


def split_colon(title):
    """(prefix_words, body_words). prefix_words is [] when there is no colon
    or the part before it is too long to be a name."""
    if ":" in title:
        prefix, body = title.split(":", 1)
        prefix_words = prefix.split()
        body_words = body.split()
        if 0 < len(prefix_words) <= MAX_PREFIX_WORDS and body_words:
            return prefix_words, body_words
    # No usable prefix: drop stray colons so the body chain never emits one.
    return [], [w.replace(":", "") for w in title.split() if w != ":"]


# ----------------------------------------------------------------------------
# Markov chain


def weighted_choice(rng, counter, temperature):
    """Sample a key from a Counter. Weights are count ** (1 / temperature), so
    temperature 1 samples proportionally, lower values sharpen, higher flatten.
    Temperature 0 (or below) is greedy."""
    items = list(counter.items())
    if temperature <= 0:
        return max(items, key=lambda kv: kv[1])[0]
    weights = [count ** (1.0 / temperature) for _, count in items]
    return rng.choices([k for k, _ in items], weights=weights, k=1)[0]


class Chain:
    """Order-2 word chain with backoff to order 1."""

    def __init__(self):
        self.two = {}   # (a, b) -> Counter of next word
        self.one = {}   # b -> Counter of next word

    def add(self, words):
        seq = [START, START] + list(words) + [END]
        for i in range(2, len(seq)):
            a, b, c = seq[i - 2], seq[i - 1], seq[i]
            self.two.setdefault((a, b), Counter())[c] += 1
            self.one.setdefault(b, Counter())[c] += 1

    def options(self, a, b):
        """Next-word counts for state (a, b); order 1 when the pair is unseen."""
        opts = self.two.get((a, b))
        if not opts:
            opts = self.one.get(b)
        return opts

    def walk(self, rng, temperature, start=(START, START), hard=MAX_BODY_WORDS,
             soft=SOFT_BODY_WORDS):
        """Generate words from a start state until END or the hard cap.
        Returns (words, ended) where ended is True when END was reached
        rather than the cap."""
        words = [w for w in start if w != START]
        a, b = start
        ended = False
        while len(words) < hard:
            opts = self.options(a, b)
            if not opts:
                break
            if len(words) >= soft and END in opts:
                opts = Counter(opts)
                opts[END] *= 3
            c = weighted_choice(rng, opts, temperature)
            if c == END:
                ended = True
                break
            words.append(c)
            a, b = b, c
        while words and words[-1].lower() in DANGLING:
            words.pop()
        return words, ended


# ----------------------------------------------------------------------------
# Structural model and generator


class TitleModel:
    def __init__(self, titles):
        self.titles = list(titles)
        self.body = Chain()
        self.prefix = Chain()
        self.colon_count = 0
        self.prefix_lengths = Counter()
        self.openers = Counter()            # (w1, w2) of every main clause
        self.openers_by_title = []          # parallel to titles
        self.known = set()                  # keys of whole titles and bodies
        for title in self.titles:
            prefix, body = split_colon(title)
            self.body.add(body)
            self.known.add(key(title))
            self.known.add(key(" ".join(body)))
            opener = tuple(body[:2]) if len(body) >= 2 else (START, body[0])
            self.openers[opener] += 1
            self.openers_by_title.append(opener)
            if prefix:
                self.colon_count += 1
                self.prefix_lengths[len(prefix)] += 1
                self.prefix.add(prefix)

    @property
    def colon_prob(self):
        return self.colon_count / max(1, len(self.titles))

    def is_known(self, text):
        return key(text) in self.known

    # -- start state ---------------------------------------------------------

    def pick_opener(self, rng, temperature, topic=None):
        """Sample a two-word start state. With a topic, prefer openers of titles
        that mention the topic, and fall back to any bigram containing a
        keyword when the chain has nothing better."""
        if topic:
            words = TOPICS[topic]
            biased = Counter()
            for title, opener in zip(self.titles, self.openers_by_title):
                if has_keyword(title, words):
                    biased[opener] += 1
            if rng.random() < 0.5:  # half the time start on the keyword itself
                inside = Counter()
                for (a, b), nxt in self.body.two.items():
                    if a != START and a[:1].isupper() and has_keyword(a + " " + b, words):
                        inside[(a, b)] += sum(nxt.values())
                if inside:
                    biased = inside
            if biased:
                return weighted_choice(rng, biased, temperature)
        return weighted_choice(rng, self.openers, temperature)

    # -- one candidate -------------------------------------------------------

    def draft(self, rng, temperature, topic=None):
        """One raw candidate. Returns (text, ended) where ended is False when
        the main clause hit the hard length cap."""
        body, ended = self.body.walk(rng, temperature,
                                     start=self.pick_opener(rng, temperature, topic))
        text = " ".join(body)
        if self.prefix_lengths and rng.random() < self.colon_prob:
            # Aim for a sampled length but only keep a prefix that reached its
            # natural end, so names are not cut in half ("Direct:").
            length = weighted_choice(rng, self.prefix_lengths, temperature)
            for _ in range(6):
                prefix, complete = self.prefix.walk(rng, temperature,
                                                 hard=MAX_PREFIX_WORDS, soft=length)
                if prefix and complete:
                    text = " ".join(prefix) + ": " + text
                    break
        return fix_case(text), ended

    def generate(self, rng, temperature=0.9, topic=None, tries=40):
        """One title that passes every quality check, or the best effort."""
        if topic and topic not in TOPICS:
            raise ValueError(f"unknown topic {topic!r}; pick one of {sorted(TOPICS)}")
        last = ""
        for _ in range(tries):
            text, ended = self.draft(rng, temperature, topic)
            last = text
            body_words = split_colon(text)[1]
            if len(body_words) < 3 or self.is_known(text):
                continue
            if not ended or not balanced(text):
                continue
            # A question opener without a question mark reads as a fragment.
            if body_words[0] in QUESTION_WORDS and not text.endswith("?"):
                continue
            if topic and not has_keyword(text, TOPICS[topic]):
                continue
            if ":" in text and self.is_known(text.split(":", 1)[1]):
                continue
            return text
        return strip_brackets(last)

    def generate_many(self, n, seed=None, temperature=0.9, topic=None):
        rng = random.Random(seed)
        out = []
        seen = set()
        while len(out) < n:
            title = self.generate(rng, temperature, topic)
            if key(title) not in seen:
                seen.add(key(title))
                out.append(title)
        return out

    def stats(self):
        return {
            "titles": len(self.titles),
            "colon_prob": round(self.colon_prob, 3),
            "prefix_lengths": dict(sorted(self.prefix_lengths.items())),
            "top_openers": [" ".join(w for w in o if w != START)
                            for o, _ in self.openers.most_common(12)],
            "bigram_states": len(self.body.two),
        }


def has_keyword(text, words):
    low = text.lower()
    return any(w in low for w in words)


def balanced(text):
    """Parentheses and brackets close in order, and quotes come in pairs."""
    stack = []
    pairs = {")": "(", "]": "[", "}": "{"}
    for ch in text:
        if ch in "([{":
            stack.append(ch)
        elif ch in pairs:
            if not stack or stack.pop() != pairs[ch]:
                return False
    return not stack and text.count('"') % 2 == 0


def strip_brackets(text):
    """Last resort when retries run out: drop bracket and quote characters."""
    return normalize(re.sub(r'[()\[\]{}"]', "", text))


def fix_case(text):
    """Capitalize the first word of the title and of the part after a colon.
    Everything else keeps the casing it had in the training data."""
    parts = text.split(": ", 1)
    fixed = []
    for part in parts:
        part = part.strip()
        if part:
            part = part[0].upper() + part[1:]
        fixed.append(part)
    return ": ".join(fixed)


# ----------------------------------------------------------------------------
# Linter

OPENERS = [
    ("Towards", 15), ("Toward", 12), ("Rethinking", 15), ("Revisiting", 12),
    ("Beyond", 12), ("Unveiling", 15), ("Demystifying", 15), ("On the", 8),
    ("A Simple", 10), ("Understanding", 8), ("Exploring", 8), ("Do ", 6),
    ("Can ", 6), ("Why ", 6), ("What ", 6), ("When ", 6),
]
BUZZWORDS = ["llm", "llms", "transformer", "transformers", "efficient",
             "robust", "scalable", "unified", "novel", "foundation", "emergent"]
KNOWN_ACRONYMS = {"NLP", "LLM", "LLMS", "GPT", "BERT", "AI", "ML", "RNN",
                  "CNN", "LSTM", "MT", "QA", "NER", "RL", "RLHF", "CLIP"}

VERDICTS = [
    (15, "Refreshingly plain. A reviewer might not notice it."),
    (35, "Mild. A few tropes, none that a reviewer would flag."),
    (55, "Solidly on trend. Could be from any recent workshop."),
    (75, "Heavily seasoned. The template is showing through."),
    (101, "Peak cliché. The title writes the paper for you."),
]


def lint(title):
    """Return {'score': int, 'rules': [(points, message), ...], 'verdict': str}."""
    title = normalize(title)
    rules = []
    words = title.split()
    low = title.lower()

    # Opener words, checked at the start and right after a colon.
    # Two stacked openers ("Towards Rethinking ...") both count.
    clauses = [title] + [c.strip() for c in title.split(":")[1:]]
    for clause in clauses:
        where = "" if clause is title else " after the colon"
        rest = clause
        for _ in range(2):
            hit = next((o for o, _ in OPENERS if rest.lower().startswith(o.lower())), None)
            if hit is None:
                break
            pts = dict(OPENERS)[hit]
            rules.append((pts, f'opener "{hit.strip()}"{where}'))
            rest = rest[len(hit):].strip()
            where = " stacked on it"

    # Colon structure.
    if ":" in title:
        rules.append((10, "colon present"))
        prefix_len = len(title.split(":", 1)[0].split())
        if prefix_len == 1:
            rules.append((8, "one-word name before the colon"))
        elif prefix_len <= 4:
            rules.append((4, f"prefix of {prefix_len} words before the colon"))
        else:
            rules.append((2, f"long prefix of {prefix_len} words before the colon"))
        if title.count(":") > 1:
            rules.append((10, f"{title.count(':')} colons"))

    # Cute acronyms: a capital letter inside a word (CodeBERT, SimCSE) or an
    # all-caps coinage before the colon (TOFU:, MUSE:).
    for w in words:
        segments = [seg for seg in re.split(r"[^A-Za-z]+", w) if seg]
        if any(re.search(r"[a-z][A-Z]", seg) for seg in segments):
            rules.append((12, f'cute acronym "{w.rstrip(":,")}"'))
            break
        core = "".join(segments)
        if (w.endswith(":") and core.isupper() and len(core) >= 3
                and core not in KNOWN_ACRONYMS):
            rules.append((8, f'all-caps name "{core}" before the colon'))
            break

    if "?" in title:
        rules.append((8, "question mark"))
    if "all you need" in low:
        rules.append((15, '"All You Need"'))
        if re.search(r"\b(is|are) all you need", low):
            rules.append((5, '"is All You Need" in full'))
    if "large language model" in low:
        rules.append((8, '"Large Language Models"'))
    if "a survey" in low or low.startswith("survey"):
        rules.append((10, '"A Survey"'))
    if "benchmark" in low:
        rules.append((8, '"Benchmark"'))
    if re.search(r"\bvia\b", low):
        rules.append((6, '"via"'))
    if re.search(r"\bmeets?\b", low):
        rules.append((10, '"Meets"'))
    if re.search(r"\bapproach\b", low):
        rules.append((5, '"Approach"'))

    # Buzzword density.
    tokens = [re.sub(r"[^a-z0-9]", "", t) for t in low.split()]
    hits = [t for t in tokens if t in BUZZWORDS]
    if hits:
        pts = min(20, 5 * len(hits))
        rules.append((pts, f"buzzwords {len(hits)}/{len(words)}: " + ", ".join(hits)))

    # Length.
    n = len(words)
    if n > 20:
        rules.append((12, f"{n} words, an abstract in disguise"))
    elif n > 15:
        rules.append((8, f"{n} words is long"))
    elif n <= 2:
        rules.append((6, f"{n}-word title, the monolith"))

    score = min(100, sum(p for p, _ in rules))
    verdict = next(v for limit, v in VERDICTS if score < limit)
    return {"score": score, "rules": rules, "verdict": verdict}


def format_lint(title, result):
    lines = [title]
    for pts, msg in result["rules"]:
        lines.append(f"  +{pts:<3} {msg}")
    if not result["rules"]:
        lines.append("  (no rule fired)")
    lines.append(f"  score {result['score']}/100  {result['verdict']}")
    return "\n".join(lines)


# ----------------------------------------------------------------------------
# Page build


def build_page(titles, template=TEMPLATE, out=PAGE):
    """Write index.html from the template with the training titles inlined."""
    html = template.read_text(encoding="utf-8")
    marker = "/*__TITLES__*/"
    if marker not in html:
        raise SystemExit(f"marker {marker} missing from {template}")
    data = json.dumps(titles, ensure_ascii=False).replace("</", "<\\/")
    html = html.replace(marker, data)
    out.write_text(html, encoding="utf-8")
    return out


# ----------------------------------------------------------------------------
# CLI


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--data", action="append", metavar="FILE",
                        help="training file, repeatable (default: project 3 titles + data/seed_titles.txt)")
    sub = parser.add_subparsers(dest="cmd", required=True)

    g = sub.add_parser("generate", help="print fake titles")
    g.add_argument("--n", type=int, default=10)
    g.add_argument("--seed", type=int, default=None)
    g.add_argument("--temperature", type=float, default=0.9)
    g.add_argument("--topic", choices=sorted(TOPICS))
    g.add_argument("--lint", action="store_true", help="show the cliché score next to each title")

    l = sub.add_parser("lint", help="score how cliché a title is")
    l.add_argument("title", nargs="*")
    l.add_argument("--file", help="rank every line of a file")

    sub.add_parser("stats", help="what the structural model learned")
    sub.add_parser("build-page", help="write index.html with the data inlined")

    args = parser.parse_args(argv)

    if args.cmd == "lint":
        if args.file:
            rows = [(lint(t), t) for t in read_titles(args.file)]
            rows.sort(key=lambda r: -r[0]["score"])
            for res, t in rows:
                top = ", ".join(m for _, m in sorted(res["rules"], reverse=True)[:3])
                print(f"{res['score']:3d}  {t}" + (f"  [{top}]" if top else ""))
            return
        if not args.title:
            parser.error("give a title or --file")
        print(format_lint(" ".join(args.title), lint(" ".join(args.title))))
        return

    titles = load_titles(args.data)
    if not titles:
        raise SystemExit("no training titles found")

    if args.cmd == "build-page":
        out = build_page(titles)
        print(f"wrote {out} with {len(titles)} titles")
        return

    model = TitleModel(titles)
    if args.cmd == "stats":
        print(json.dumps(model.stats(), indent=2, ensure_ascii=False))
        return

    for title in model.generate_many(args.n, args.seed, args.temperature, args.topic):
        if args.lint:
            print(f"{lint(title)['score']:3d}  {title}")
        else:
            print(title)


if __name__ == "__main__":
    main()
