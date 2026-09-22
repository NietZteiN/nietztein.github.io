# Fellowship and PhD tracker

A single local web page that reads two CSV files (applications and recommender letters) and shows upcoming deadlines with live countdowns, a status pill and materials progress for every application, one dot per recommender letter, and a per-recommender list of what is still owed. Every date comes from the CSV; nothing is hardcoded in the page. The page makes no network calls apart from reading the two CSV files that sit next to it, so it is safe to keep open with real data.

## How to run

From the repository root (or from this folder, adjusting the path):

```
cd /home/user/side-projects
python3 -m http.server 8000
```

Then open <http://localhost:8000/02-application-tracker/>.

Opening `index.html` directly as a file also works. Browsers do not let a page read files next to it in that case, so the page shows two file pickers and two paste boxes instead. Pick `applications.csv` and `recommenders.csv`, or paste their contents, and press Load. Nothing leaves the browser either way.

To check the page (needs the `playwright` Python package and a Chromium build):

```
python3 verify.py
```

This serves the folder, opens the page in headless Chromium, checks for console errors, exercises the filters and the file fallback, and writes `screenshot.png`.

## Files

```
02-application-tracker/
  index.html         the whole app (HTML, CSS, JS; no libraries)
  applications.csv   sample applications (edit or replace with your own)
  recommenders.csv   sample recommender rows (optional)
  verify.py          Playwright smoke test, also produces screenshot.png
  screenshot.png     what the page looks like with the sample data
  README.md
```

## Data format

`applications.csv` columns:

| column | meaning |
| --- | --- |
| id | any unique string; recommender rows refer to it |
| name | program or fellowship name |
| type | `fellowship` or `phd` |
| institution | who runs it |
| deadline | ISO date `YYYY-MM-DD` |
| status | one of `not_started`, `in_progress`, `submitted`, `interview`, `accepted`, `rejected`, `declined` |
| materials_required | semicolon separated list, for example `cv;transcript;references` |
| materials_done | semicolon separated subset of the required list (matching is case insensitive) |
| notes | free text |
| url | optional link, shown on the application name |

`recommenders.csv` columns:

| column | meaning |
| --- | --- |
| application_id | matches `id` in applications.csv |
| recommender | a name; the sample uses Recommender A to D |
| requested_on | ISO date the letter was requested, blank if not yet requested |
| submitted_on | ISO date the letter went in, blank if still pending |
| notes | free text, shown in the tooltip and in the recommender panel |

Dot colors: green means submitted, amber means requested but not submitted, gray means listed but not yet requested. One row per recommender per application.

Keeping the tracker in Google Sheets or Numbers works well: keep one sheet per file with the same headers, then use File, Download, CSV (Sheets) or File, Export To, CSV (Numbers) and save the result next to `index.html`. The page never contacts Sheets or any other service. If you copy cells straight from a spreadsheet and paste them into the boxes, the data is tab separated; the page detects that from the header line, and adding `?tsv` to the URL forces tab mode.

## Assumptions

- A deadline counts down to 23:59 local time on the deadline date. Change `deadlineHour` and `deadlineMinute` in the `CONFIG` block at the top of the script in `index.html` if a program uses a different cutoff (for example 17:00 Eastern; the page uses the browser's local time zone).
- The "Next up" strip shows the three nearest future deadlines among applications with status `not_started` or `in_progress`, since those are the ones that still need work. Submitted and decided applications stay in the table but are skipped there.
- "Letters outstanding" in the header counts every recommender row without a `submitted_on` date whose application deadline has not passed.
- Materials progress counts how many items in `materials_required` also appear in `materials_done`. Items in `materials_done` that are not in the required list are ignored.
- Rows with an unrecognized deadline are kept and sorted to the bottom, labelled "date not recognized".
- Unknown status values are shown as Not started.
- The sample data includes one past deadline (a September travel grant) so the dimming and the hide toggle can be seen. All sample names, notes, and links are placeholders.

## Ideas for later

- A small "add or edit" form that writes the CSV back out with a download button.
- Optional per-application deadline time and time zone columns.
- An ICS export so the deadlines land in a calendar.
- A compact printable view for the recommender panel, to send each recommender their own list.
