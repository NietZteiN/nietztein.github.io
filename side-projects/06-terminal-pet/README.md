# Terminal pet

A small ASCII cat that lives in your shell and feeds on git commits. Each new commit in a watched repository lifts its mood; every quiet hour lets the mood decay. Run `pet` to see the cat, or put its tiny face, such as `(^_^)`, in your prompt. Python 3 standard library only, no dependencies, and the prompt hook never runs git, so the shell stays fast.

```
    /\_/\    *  .          /\_/\               /\_/\               /\_/\              |\_/|
  \( ^o^ )/    *          ( ^_^ )             ( -_- )             ( ;_; )             (T_T )    . . .
   (  w  )  .           = (  w  ) =         - (  w  ) -            (  w  )             ( w  )
   (     )~~              (     )~            (     )             _(     )           _(      )_
   (_)_(_)                (_)_(_)             (_)_(_)            (_______)          (__________)
   ecstatic                happy               neutral              sad               miserable
```

## How to run

```sh
cd 06-terminal-pet
./pet.py                # show the cat (first run creates the config)
./pet.py --all-moods    # print all five moods
./install.sh            # symlink ./pet.py to ~/.local/bin/pet and print the shell lines
```

`install.sh` never edits your shell files. It prints what to add. For zsh (the macOS default):

```zsh
source /path/to/06-terminal-pet/pet.zsh
setopt PROMPT_SUBST
RPROMPT='${PET_MOOD}'          # or use ${PET_MOOD} anywhere in PROMPT
```

For bash:

```bash
source /path/to/06-terminal-pet/pet.sh
PS1='$PET_MOOD \w \$ '
```

Commands:

| Command | What it does |
| --- | --- |
| `pet` | The cat, its mood level and number, hours since the last commit, and a remark |
| `pet status` | Numbers only: mood, level, last commit, last scan, half-life, watched repos |
| `pet prompt` | A tiny face for the prompt. `--zsh` and `--bash` add shell-safe color |
| `pet add PATH` | Watch a repository (any path inside it works) |
| `pet remove PATH` | Stop watching it |
| `pet feed` | A small manual boost, at most once per hour |
| `pet name NAME` | Rename the cat (default: Mochi) |
| `pet scan` | Rescan the repositories right now |
| `pet --all-moods` | Print all five moods |

Options: `--no-color`, `--color`. The `NO_COLOR` environment variable is honoured, and color is off when output is not a terminal.

Example output of `pet`:

```
    /\_/\
   ( ^_^ )
 = (  w  ) =
   (     )~
   (_)_(_)
  Mochi is happy (72/100). Last commit: 1.5 h ago.
  Mochi approves of your commit history.
```

Example output of `pet status`:

```
name        Mochi
mood        86.0
level       ecstatic (^o^)
last_commit 0.02 h ago
last_scan   0.0 min ago
half_life   18 h
repos       1 watched
  ok   /Users/jack/code/some-repo
```

## How the mood works

- Mood is a number from 0 to 100. Levels: ecstatic (80 and up), happy (60), neutral (35), sad (15), miserable (below 15).
- Each new commit in a watched repository adds `commit_boost` points (default 12), at most `max_commits_per_scan` commits per scan (default 5), so a large `git pull` does not max the cat out in one go. Commits are detected by comparing `git rev-list --count HEAD` and `git log -1 --format=%ct` with the values from the previous scan. An amend or rebase that changes the newest commit without raising the count is counted as one commit. Every git call has a short timeout (3 s by default).
- Between commits the mood decays exponentially with a half-life of `half_life_hours` (default 18). From 100, the cat is at 50 after 18 quiet hours, 25 after 36, and about 12 after 54.
- On a fresh install the mood starts at 50, already decayed by the time since your most recent commit, so the first picture is honest.
- `pet feed` adds `feed_boost` points (default 8), once per hour.
- If git is missing or a watched path has disappeared, that repository is skipped and shown as `skip` in `pet status`. The pet never crashes a prompt: on any unexpected error `pet prompt` prints `(?_?)`.

## Speed

`pet prompt` reads one JSON file (`state.json`) and prints. It makes no git calls. The mood cache is refreshed by a scan at most every `scan_interval_minutes` (default 5); when the prompt notices the cache is stale it spawns a detached background rescan and still prints the cached value at once. A lock file prevents overlapping scans.

Measured on the build machine (Linux, Python 3.11, 50 runs each):

| Invocation | Median | Max |
| --- | --- | --- |
| `python3 -S pet.py prompt --zsh` (what the shell hooks run) | 22.1 ms | 23.6 ms |
| `pet prompt` through the symlink | 25.2 ms | 28.8 ms |

Bare `python3 -c pass` is about 11 ms of that, and importing `json` about 8 ms. The hooks use `python3 -S` (skip site-packages) to save the rest.

## File layout

```
06-terminal-pet/
  pet.py       the program (Python 3, standard library only)
  pet.zsh      zsh precmd hook that sets $PET_MOOD
  pet.sh       bash PROMPT_COMMAND hook that sets $PET_MOOD
  install.sh   symlinks pet.py to ~/.local/bin/pet and prints the lines to add
  README.md    this file
```

Runtime files, created on first run in `~/.config/terminal-pet/` (or `$XDG_CONFIG_HOME/terminal-pet/`):

- `config.json`: `name`, `repos` (list of absolute paths), `half_life_hours`, `scan_interval_minutes`, `commit_boost`, `max_commits_per_scan`, `feed_boost`, `git_timeout_seconds`. Edit it freely; missing keys fall back to defaults.
- `state.json`: the cached mood with its timestamp, the last scan time, the newest commit time, and the per-repository commit counts.
- `scan.lock`: exists only while a scan is running.

## Testing aids

- `PET_FAKE_NOW=<epoch seconds or ISO 8601>` overrides the clock, useful for checking decay. It also stamps `state.json` with the fake time, so use a separate home for experiments.
- `PET_HOME=/some/dir` uses that directory instead of `~/.config/terminal-pet`.

A quick self-check in a throwaway repository:

```sh
export PET_HOME=/tmp/pet-test
mkdir /tmp/pet-repo && cd /tmp/pet-repo && git init -q && git commit -q --allow-empty -m init
pet                                   # neutral, mood 50
git commit -q --allow-empty -m work && pet scan && pet status     # mood 62
PET_FAKE_NOW=$(python3 -c 'import time; print(time.time()+36*3600)') pet   # decayed to about 15
```

## Assumptions

- Jack uses zsh (macOS default), so zsh is the first-class integration; bash is supported through `pet.sh`. Neither file is edited automatically.
- The right place for a tiny face is the right prompt (`RPROMPT`); the example uses that but `${PET_MOOD}` works anywhere in `PROMPT`.
- On first run, the current directory is added to the watch list if it is inside a git repository. Other repositories are added with `pet add PATH`.
- Half-life 18 hours, 12 points per commit, and the level thresholds above are guesses at a pleasant pace: a normal working day keeps the cat happy, a weekend off makes it sad, and a week away makes it miserable. All of them live in `config.json`.
- Commits are counted on the checked-out branch (`HEAD`) of each repository. Pulling other people's commits counts too, capped at five per scan.
- `pet prompt` refreshes the cache by spawning a detached background scan. That process is invisible to the shell's job table and ends within a second.

## Ideas for later

- A `pet log` command that plots the mood over the last week as a sparkline.
- Extra remarks tied to the time of day or to the branch name.
- Count lines changed, not only commits, so one large commit is worth more than three empty ones.
- A tmux status-line snippet (`#(pet prompt)`), which needs no shell hook at all.
- Seasonal outfits: a scarf in winter, drawn from the local date.
