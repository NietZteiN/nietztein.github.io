# Git history as a film timeline

`git_timeline.py` reads a repository's history with plain `git log` and writes one self-contained HTML page that looks like a non-linear video editor. Each top-level directory (or each file) is a track, each commit is a clip whose width grows with the number of lines it changed, clips are colored by author, merges appear as hatched clips with a cross-dissolve mark, and branch points appear as dashed cuts labelled with the branch name. A program monitor above the tracks shows the commit under the playhead with a burn-in timecode, and a trailer button plays the whole history in 30 seconds and ends on a title card.

## How to run

```
cd 08-git-film-timeline
python3 git_timeline.py /path/to/repo -o timeline.html
```

Then open `timeline.html` in a browser (double-click works, no server needed; `python3 -m http.server` from the repository root works too, since the page has no external references). Options:

```
--depth dir|file        one track per top-level directory (default) or per file
--max-commits N         only the N most recent commits (default: all)
--branches all|current  history of all refs (default) or only the current branch
--tracks N              keep the N busiest tracks, fold the rest into "other" (default 12)
--trailer-seconds S     default length of trailer mode (default 30)
```

Example that produces the bundled `example.html`:

```
python3 make_example_repo.py /tmp/example-repo
python3 git_timeline.py /tmp/example-repo -o example.html
```

Only Python 3 (standard library) and `git` are needed. The script tries `--diff-merges=first-parent` so merge commits carry the lines they brought in, and falls back silently on older git versions.

## Using the page

- Drag the playhead, click the ruler, or click a clip to scrub. The monitor shows hash, author, date, message, files changed, insertions and deletions, branch tags, and a timecode where one commit is one frame at 24 fps.
- Arrow keys step one commit (Shift for ten), Home and End jump, Space plays at three commits per second, T runs the trailer, F fits the whole history to the window, Escape stops.
- Wheel zooms around the cursor, Shift+wheel or a horizontal wheel pans, dragging the track area pans.
- Sequence layout places clips back to back in commit order so the timeline is dense. Time layout places them by author date, so gaps and bursts become visible.
- The trailer eases through every commit in the chosen number of seconds (editable in the top bar), flashes the monitor on each new commit, follows the playhead, then ends on a title card with the repository name, commit count, contributors, and the first and last dates.
- Click an author chip in the legend to highlight only that author's clips.

## File layout

```
git_timeline.py       collects history, groups tracks, assigns lanes and branch names, writes HTML
template.html         the page (CSS and JavaScript); the script embeds the JSON into it
make_example_repo.py  builds a small synthetic repository with two merges and an open branch
example.html          generated timeline of that synthetic repository
screenshot.png        the example timeline mid-trailer
```

`template.html` must sit next to `git_timeline.py`. Opening the template on its own shows a short notice instead of a timeline.

## Assumptions

- Commit order is `git log --date-order` reversed, so parents always come before children and the sequence is close to chronological. Commit dates use the author date.
- Clip width is `max(10, 9 * log2(1 + lines changed))` in layout units. Binary files count as changed files with zero lines.
- Files at the repository root become their own tracks under `--depth dir` (for example `README.md`), since they are usually worth seeing. Tracks are ranked by total lines changed plus one per touch; the default keeps the top twelve.
- Branch names: every commit is labelled with the first ref (current branch first, then main or master, then other local branches, remotes, tags) whose first-parent chain reaches it. Commits from branches that were merged and deleted get their name from merge messages of the form `Merge branch 'name'` or `Merge pull request #N from name`. Anything still unnamed is labelled "unnamed branch" at cut markers.
- Author colors come from a SHA-1 hash of the author name, so the same name always gets the same color across repositories and runs.
- The timecode is purely sequential (one commit per frame at 24 fps); it is a burn-in ornament, not wall-clock time.

## Ideas for later

- Export the trailer as a video by capturing frames with Playwright and stitching them with ffmpeg.
- Audio: a click per commit whose pitch follows the lines changed.
- Show the diff of the current commit in the monitor when the file count is small.
- Cluster tracks by language or by a path prefix given on the command line.
