#!/usr/bin/env python3
"""Create a small synthetic git repository with branches and merges.

Used to produce example.html and to check merge and branch rendering:
    python3 make_example_repo.py /tmp/example-repo
    python3 git_timeline.py /tmp/example-repo -o example.html
"""

import os
import random
import subprocess
import sys

AUTHORS = [
    ("Ada Lovelace", "ada@example.org"),
    ("Grace Hopper", "grace@example.org"),
    ("Linus T.", "linus@example.org"),
]
MESSAGES = [
    "Add parser skeleton", "Fix off-by-one in tokenizer", "Refactor renderer", "Write docs for CLI",
    "Tune palette", "Handle empty input", "Speed up layout pass", "Add tests for merges",
    "Drop unused helper", "Rename config keys", "Polish README", "Support file depth",
]


def git(repo, *args, env=None):
    subprocess.run(["git", "-C", repo] + list(args), check=True, capture_output=True, env=env)


ALL_FILES = ["src/core.py", "src/render.py", "docs/guide.md", "tests/test_core.py",
             "README.md", "assets/style.css", "src/cli.py"]


def commit(repo, day, n, rnd, pool):
    """Write to a few files from `pool` and commit as a random author on synthetic day `day`."""
    author, email = rnd.choice(AUTHORS)
    paths = rnd.sample(pool, k=rnd.randint(1, min(3, len(pool))))
    for p in paths:
        full = os.path.join(repo, p)
        os.makedirs(os.path.dirname(full), exist_ok=True)
        lines = []
        if os.path.exists(full):
            lines = open(full, encoding="utf-8").read().splitlines()
            del lines[: rnd.randint(0, min(len(lines), 8))]
        lines += ["line %d of change %d" % (i, n) for i in range(rnd.choice([1, 3, 8, 20, 60, 150]))]
        open(full, "w", encoding="utf-8").write("\n".join(lines) + "\n")
    date = "2024-01-%02dT%02d:00:00+00:00" % (1 + day % 28, 9 + n % 9)
    env = dict(os.environ, GIT_AUTHOR_NAME=author, GIT_AUTHOR_EMAIL=email, GIT_AUTHOR_DATE=date,
               GIT_COMMITTER_NAME=author, GIT_COMMITTER_EMAIL=email, GIT_COMMITTER_DATE=date)
    git(repo, "add", "-A")
    git(repo, "commit", "-q", "-m", rnd.choice(MESSAGES) + " (%d)" % n, env=env)


def merge(repo, branch, date):
    """Merge `branch` into the current branch with a merge commit by the first author."""
    author, email = AUTHORS[0]
    env = dict(os.environ, GIT_AUTHOR_NAME=author, GIT_AUTHOR_EMAIL=email, GIT_AUTHOR_DATE=date,
               GIT_COMMITTER_NAME=author, GIT_COMMITTER_EMAIL=email, GIT_COMMITTER_DATE=date)
    git(repo, "merge", "-q", "--no-ff", "-m", "Merge branch '%s'" % branch, branch, env=env)


def main():
    repo = sys.argv[1] if len(sys.argv) > 1 else "example-repo"
    os.makedirs(repo, exist_ok=True)
    rnd = random.Random(8)
    git(repo, "init", "-q", "-b", "main")
    git(repo, "config", "commit.gpgsign", "false")
    n = 0
    day = 0

    def series(count, pool=ALL_FILES):
        # side branches edit their own files so merges never conflict
        nonlocal n, day
        for _ in range(count):
            n += 1
            day += 1
            commit(repo, day, n, rnd, pool)

    series(5)
    git(repo, "checkout", "-q", "-b", "feature/parser")
    series(4, ["src/core.py", "src/cli.py", "tests/test_core.py"])
    git(repo, "checkout", "-q", "main")
    series(3, ["README.md", "assets/style.css", "docs/guide.md"])
    merge(repo, "feature/parser", "2024-01-14T12:00:00+00:00")
    git(repo, "branch", "-q", "-d", "feature/parser")
    series(3)
    git(repo, "checkout", "-q", "-b", "docs")
    series(2, ["docs/guide.md", "README.md"])
    git(repo, "checkout", "-q", "main")
    series(2, ["src/core.py", "src/render.py"])
    merge(repo, "docs", "2024-01-22T12:00:00+00:00")
    git(repo, "tag", "v0.1")
    series(2)
    git(repo, "checkout", "-q", "-b", "experiment")   # left open, never merged
    series(3)
    git(repo, "checkout", "-q", "main")
    series(2)
    print("synthetic repo at", os.path.abspath(repo))


if __name__ == "__main__":
    main()
