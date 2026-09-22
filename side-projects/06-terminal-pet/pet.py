#!/usr/bin/env python3
"""Terminal pet: a small ASCII cat whose mood follows your git commits.

Python 3 standard library only. State lives in ~/.config/terminal-pet/.

Mood model
----------
mood is a number from 0 to 100. Every new commit in a watched repository
adds COMMIT_BOOST points. Between commits the mood decays exponentially
with a configurable half-life (default 18 hours), so a pet at 100 sits at
50 after 18 quiet hours, 25 after 36, and so on.

Speed
-----
`pet prompt` is meant to run on every shell prompt, so it reads only
state.json and prints. Git is scanned at most every scan_interval_minutes;
when the cache is stale the prompt spawns a detached background rescan
and still prints the cached value immediately.

Testing aids
------------
PET_FAKE_NOW   override the current time (epoch seconds or ISO 8601)
PET_HOME       use this directory instead of ~/.config/terminal-pet
"""

import json
import math
import os
import sys
import time

VERSION = "1.0"

# --------------------------------------------------------------------- paths

def pet_home():
    """Directory holding config.json and state.json."""
    custom = os.environ.get("PET_HOME")
    if custom:
        return os.path.expanduser(custom)
    xdg = os.environ.get("XDG_CONFIG_HOME") or os.path.join(os.path.expanduser("~"), ".config")
    return os.path.join(xdg, "terminal-pet")


CONFIG_PATH = os.path.join(pet_home(), "config.json")
STATE_PATH = os.path.join(pet_home(), "state.json")
LOCK_PATH = os.path.join(pet_home(), "scan.lock")

DEFAULT_CONFIG = {
    "name": "Mochi",
    "repos": [],
    "half_life_hours": 18,
    "scan_interval_minutes": 5,
    "commit_boost": 12,
    "max_commits_per_scan": 5,
    "feed_boost": 8,
    "git_timeout_seconds": 3,
}

# ---------------------------------------------------------------------- time

def now():
    """Current time in epoch seconds, or PET_FAKE_NOW when set (testing aid)."""
    fake = os.environ.get("PET_FAKE_NOW")
    if fake:
        try:
            return float(fake)
        except ValueError:
            from datetime import datetime
            return datetime.fromisoformat(fake).timestamp()
    return time.time()

# ---------------------------------------------------------------------- json

def load_json(path, fallback):
    try:
        with open(path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        if isinstance(data, dict):
            return data
    except (OSError, ValueError):
        pass
    return fallback


def save_json(path, data):
    """Atomic write so a prompt reading mid-write never sees a torn file."""
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        tmp = path + ".tmp.%d" % os.getpid()
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(data, fh, indent=2, sort_keys=True)
            fh.write("\n")
        os.replace(tmp, path)
    except OSError:
        pass


def load_config():
    """Read config.json, creating it with defaults on first run."""
    cfg = load_json(CONFIG_PATH, None)
    if cfg is None:
        cfg = dict(DEFAULT_CONFIG)
        top = git_toplevel(os.getcwd())
        if top:
            cfg["repos"] = [top]
        save_json(CONFIG_PATH, cfg)
        return cfg
    # Fill in any keys added after the config was first written.
    for key, value in DEFAULT_CONFIG.items():
        cfg.setdefault(key, value)
    return cfg


def load_state():
    return load_json(STATE_PATH, {})

# ----------------------------------------------------------------------- git

def run_git(args, cwd, timeout):
    """Run a git command; return stdout or None on any failure."""
    import subprocess
    env = dict(os.environ, GIT_OPTIONAL_LOCKS="0", LC_ALL="C")
    try:
        out = subprocess.run(
            ["git", "-C", cwd] + args,
            capture_output=True, text=True, timeout=timeout, env=env,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if out.returncode != 0:
        return None
    return out.stdout.strip()


def git_toplevel(path):
    out = run_git(["rev-parse", "--show-toplevel"], path, 3)
    return out or None


def inspect_repo(path, timeout):
    """Return (commit_count, latest_commit_epoch) or None if unreadable."""
    if not os.path.isdir(path):
        return None
    count = run_git(["rev-list", "--count", "HEAD"], path, timeout)
    stamp = run_git(["log", "-1", "--format=%ct"], path, timeout)
    if not count or not stamp:
        return None
    try:
        return int(count), int(stamp)
    except ValueError:
        return None

# ---------------------------------------------------------------------- mood

def decayed_mood(state, at):
    """Mood at time `at`, applying exponential decay since it was last set."""
    mood = float(state.get("mood", 50.0))
    half_life = float(state.get("half_life_hours", 18)) * 3600.0
    elapsed = max(0.0, at - float(state.get("mood_at", at)))
    if half_life <= 0:
        return mood
    return mood * math.pow(0.5, elapsed / half_life)


def clamp(x):
    return max(0.0, min(100.0, x))


def scan(cfg, state, force=False):
    """Re-read the watched repositories and update the mood cache.

    Returns the (possibly unchanged) state. Never raises.
    """
    t = now()
    interval = float(cfg.get("scan_interval_minutes", 5)) * 60.0
    if not force and t - float(state.get("last_scan", 0)) < interval:
        return state

    boost = float(cfg.get("commit_boost", 12))
    cap = int(cfg.get("max_commits_per_scan", 5))
    timeout = float(cfg.get("git_timeout_seconds", 3))
    seen = state.get("repos", {})
    if not isinstance(seen, dict):
        seen = {}

    mood = decayed_mood(state, t)
    first_run = "mood" not in state
    new_commits = 0
    latest_commit = float(state.get("last_commit_ts", 0))
    fresh = {}

    for path in cfg.get("repos", []):
        info = inspect_repo(os.path.expanduser(path), timeout)
        if info is None:
            continue  # path gone or git missing: skip quietly
        count, stamp = info
        fresh[path] = {"count": count, "last_ts": stamp}
        latest_commit = max(latest_commit, stamp)
        old = seen.get(path)
        if old is None:
            continue  # newly watched: baseline only, no boost for history
        added = count - int(old.get("count", count))
        if added <= 0 and stamp != int(old.get("last_ts", stamp)):
            added = 1  # amend or rebase: still work, count it once
        new_commits += max(0, added)

    if first_run:
        # Start at 50, already decayed by the time since the last commit,
        # so a fresh install reflects recent activity honestly.
        base = {"mood": 50.0, "mood_at": latest_commit or t,
                "half_life_hours": cfg.get("half_life_hours", 18)}
        mood = decayed_mood(base, t)

    mood = clamp(mood + boost * min(new_commits, cap))

    state.update({
        "mood": round(mood, 3),
        "mood_at": t,
        "last_scan": t,
        "last_commit_ts": latest_commit,
        "repos": fresh,
        "half_life_hours": cfg.get("half_life_hours", 18),
        "scan_interval_minutes": cfg.get("scan_interval_minutes", 5),
        "name": cfg.get("name", "Mochi"),
        "version": VERSION,
    })
    save_json(STATE_PATH, state)
    return state


def background_scan():
    """Spawn a detached `pet scan` so the prompt never waits on git."""
    import subprocess
    try:
        subprocess.Popen(
            [sys.executable, os.path.abspath(__file__), "scan", "--quiet"],
            stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL, start_new_session=True,
        )
    except OSError:
        pass


def lock_active():
    """True while another scan holds the lock; locks older than 60 s are stale."""
    try:
        return time.time() - os.path.getmtime(LOCK_PATH) < 60
    except OSError:
        return False


def take_lock():
    """True if this process may scan."""
    if lock_active():
        return False
    release_lock()
    try:
        os.makedirs(os.path.dirname(LOCK_PATH), exist_ok=True)
        fd = os.open(LOCK_PATH, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        os.close(fd)
        return True
    except OSError:
        return False


def release_lock():
    try:
        os.unlink(LOCK_PATH)
    except OSError:
        pass

# ------------------------------------------------------------------ the cat

LEVELS = [
    # (threshold, name, glyph, color)
    (80, "ecstatic", "(^o^)", "95"),   # bright magenta
    (60, "happy", "(^_^)", "92"),      # bright green
    (35, "neutral", "(-_-)", "93"),    # bright yellow
    (15, "sad", "(;_;)", "94"),        # bright blue
    (0, "miserable", "(T_T)", "90"),   # grey
]

ART = {
    "ecstatic": r"""
    /\_/\    *  .
  \( ^o^ )/    *
   (  w  )  .
   (     )~~
   (_)_(_)
""",
    "happy": r"""
    /\_/\
   ( ^_^ )
 = (  w  ) =
   (     )~
   (_)_(_)
""",
    "neutral": r"""
    /\_/\
   ( -_- )
 - (  w  ) -
   (     )
   (_)_(_)
""",
    "sad": r"""
    /\_/\
   ( ;_; )
   (  w  )
  _(     )
 (_______)
""",
    "miserable": r"""
   |\_/|
   (T_T )    . . .
   ( w  )
 _(      )_
(__________)
""",
}

REMARKS = {
    "ecstatic": [
        "Commits everywhere. {name} is vibrating.",
        "{name} has never been happier. Keep going.",
        "So many commits. {name} purrs at full volume.",
    ],
    "happy": [
        "{name} is content. A good day of work.",
        "{name} approves of your commit history.",
        "Warm and fed. {name} is doing fine.",
    ],
    "neutral": [
        "{name} is waiting. A commit would be nice.",
        "{name} stares at the cursor. Nothing yet.",
        "Quiet lately. {name} is patient, for now.",
    ],
    "sad": [
        "{name} misses you. It has been a while.",
        "{name} sighs and looks at the empty log.",
        "One small commit would cheer {name} up.",
    ],
    "miserable": [
        "{name} has given up hope. Please commit something.",
        "{name} lies flat. The repository is silent.",
        "Days without commits. {name} is a puddle.",
    ],
}


def level_for(mood):
    for threshold, name, glyph, color in LEVELS:
        if mood >= threshold:
            return name, glyph, color
    return LEVELS[-1][1:]


def want_color(argv):
    if "--no-color" in argv or os.environ.get("NO_COLOR"):
        return False
    if "--color" in argv:
        return True
    return sys.stdout.isatty()


def paint(text, color, enabled):
    if not enabled:
        return text
    return "\033[%sm%s\033[0m" % (color, text)


def hours_since(stamp, at):
    if not stamp:
        return None
    return max(0.0, (at - float(stamp)) / 3600.0)


def fmt_hours(h):
    if h is None:
        return "no commits seen"
    if h < 1:
        return "%d min" % int(h * 60)
    if h < 48:
        return "%.1f h" % h
    return "%.1f days" % (h / 24)


def show_creature(name, level, mood, hours, remark, color):
    code = level_for(mood)[2]
    art = ART[level].strip("\n")
    print(paint(art, code, color))
    print("  %s is %s (%d/100). Last commit: %s ago." % (
        name, paint(level, code, color), round(mood),
        fmt_hours(hours) if hours is not None else "never"))
    print("  " + remark)

# ------------------------------------------------------------------ commands

def cmd_show(cfg, argv):
    state = scan(cfg, load_state())
    t = now()
    mood = decayed_mood(state, t)
    level, _, _ = level_for(mood)
    import random
    remark = random.choice(REMARKS[level]).format(name=cfg["name"])
    show_creature(cfg["name"], level, mood, hours_since(state.get("last_commit_ts"), t),
                  remark, want_color(argv))


def cmd_all_moods(cfg, argv):
    color = want_color(argv)
    for threshold, level, glyph, code in LEVELS:
        print(paint("%s  %s  (mood %d and up)" % (glyph, level, threshold), code, color))
        print(paint(ART[level].strip("\n"), code, color))
        print()


def cmd_status(cfg, argv):
    state = scan(cfg, load_state())
    t = now()
    mood = decayed_mood(state, t)
    level, glyph, _ = level_for(mood)
    print("name        %s" % cfg["name"])
    print("mood        %.1f" % mood)
    print("level       %s %s" % (level, glyph))
    h = hours_since(state.get("last_commit_ts"), t)
    print("last_commit %s" % ("%.2f h ago" % h if h is not None else "none"))
    print("last_scan   %.1f min ago" % ((t - float(state.get("last_scan", t))) / 60))
    print("half_life   %s h" % cfg["half_life_hours"])
    print("repos       %d watched" % len(cfg.get("repos", [])))
    for path in cfg.get("repos", []):
        info = state.get("repos", {}).get(path)
        mark = "ok  " if info else "skip"
        print("  %s %s" % (mark, path))


def cmd_prompt(argv):
    """The fast path: one JSON read, no git, then print a glyph."""
    state = load_json(STATE_PATH, None)
    if state is None or "mood" not in state:
        state = scan(load_config(), {}, force=True)  # first ever run only
    t = now()
    interval = float(state.get("scan_interval_minutes", 5)) * 60.0
    if t - float(state.get("last_scan", 0)) >= interval and not lock_active():
        background_scan()
    level, glyph, code = level_for(decayed_mood(state, t))
    if "--zsh" in argv:
        colors = {"95": "magenta", "92": "green", "93": "yellow", "94": "blue", "90": "8"}
        print("%%F{%s}%s%%f" % (colors[code], glyph))
    elif "--bash" in argv:
        print("\001\033[%sm\002%s\001\033[0m\002" % (code, glyph))
    elif want_color(argv):
        print(paint(glyph, code, True))
    else:
        print(glyph)


def cmd_scan(cfg, argv):
    if not take_lock():
        return
    try:
        state = scan(cfg, load_state(), force=True)
    finally:
        release_lock()
    if "--quiet" not in argv:
        print("scanned %d repos, mood %.1f" % (len(state.get("repos", {})), state["mood"]))


def cmd_add(cfg, argv):
    if len(argv) < 1:
        die("usage: pet add PATH")
    top = git_toplevel(os.path.abspath(os.path.expanduser(argv[0])))
    if not top:
        die("not a git repository: %s" % argv[0])
    if top in cfg["repos"]:
        print("already watching %s" % top)
        return
    cfg["repos"].append(top)
    save_json(CONFIG_PATH, cfg)
    scan(cfg, load_state(), force=True)
    print("now watching %s" % top)


def cmd_remove(cfg, argv):
    if len(argv) < 1:
        die("usage: pet remove PATH")
    target = os.path.abspath(os.path.expanduser(argv[0]))
    keep = [r for r in cfg["repos"] if os.path.abspath(r) != target]
    if len(keep) == len(cfg["repos"]):
        die("not watching %s" % argv[0])
    cfg["repos"] = keep
    save_json(CONFIG_PATH, cfg)
    state = load_state()
    state.get("repos", {}).pop(target, None)
    save_json(STATE_PATH, state)
    print("stopped watching %s" % target)


def cmd_feed(cfg, argv):
    state = scan(cfg, load_state())
    t = now()
    last = float(state.get("last_feed", 0))
    if t - last < 3600:
        wait = int((3600 - (t - last)) / 60) + 1
        print("%s is full. Try again in %d min." % (cfg["name"], wait))
        return
    mood = clamp(decayed_mood(state, t) + float(cfg.get("feed_boost", 8)))
    state.update({"mood": round(mood, 3), "mood_at": t, "last_feed": t})
    save_json(STATE_PATH, state)
    level, glyph, code = level_for(mood)
    print("%s %s eats. Mood %d." % (paint(glyph, code, want_color(argv)), cfg["name"], round(mood)))


def cmd_name(cfg, argv):
    if not argv:
        print(cfg["name"])
        return
    cfg["name"] = " ".join(argv).strip() or cfg["name"]
    save_json(CONFIG_PATH, cfg)
    state = load_state()
    state["name"] = cfg["name"]
    save_json(STATE_PATH, state)
    print("your pet is now called %s" % cfg["name"])


HELP = """pet, a terminal cat that lives on git commits

  pet               show the cat, its mood, and hours since the last commit
  pet status        numbers only
  pet prompt        tiny glyph for the prompt (add --zsh or --bash for color)
  pet add PATH      watch a repository
  pet remove PATH   stop watching it
  pet feed          a small boost, once per hour
  pet name NAME     rename the cat
  pet scan          rescan repositories now
  pet --all-moods   print all five moods
  pet --help        this text

Options: --no-color, --color. NO_COLOR is honoured. Config lives in
%s
""" % pet_home()


def die(msg):
    print(msg, file=sys.stderr)
    sys.exit(1)


def main(argv):
    flags = [a for a in argv if a.startswith("--")]
    words = [a for a in argv if not a.startswith("--")]
    cmd = words[0] if words else ""
    rest = words[1:]

    # Prompt comes first and avoids loading config: it must stay cheap.
    if cmd == "prompt":
        return cmd_prompt(flags)
    if "--help" in flags or cmd in ("help", "-h"):
        print(HELP, end="")
        return
    if "--version" in flags:
        print("pet %s" % VERSION)
        return

    cfg = load_config()
    if "--all-moods" in flags:
        return cmd_all_moods(cfg, flags)
    handlers = {
        "": cmd_show, "show": cmd_show, "status": cmd_status, "scan": cmd_scan,
        "add": cmd_add, "remove": cmd_remove, "feed": cmd_feed, "name": cmd_name,
    }
    handler = handlers.get(cmd)
    if handler is None:
        die("unknown command: %s (try pet --help)" % cmd)
    if cmd in ("add", "remove", "name"):
        handler(cfg, rest)
    else:
        handler(cfg, flags)


if __name__ == "__main__":
    try:
        main(sys.argv[1:])
    except KeyboardInterrupt:
        pass
    except Exception as exc:  # the pet must never break a shell prompt
        if "prompt" in sys.argv:
            print("(?_?)")
        else:
            die("pet: %s" % exc)
