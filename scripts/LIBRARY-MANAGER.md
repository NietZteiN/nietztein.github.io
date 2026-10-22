# Add books to the public bookshelf

Double-click `library-manager.cmd` in the repository folder. It opens the local
manager in your browser. Keep the command window open until you finish.
Node.js and the repository's existing Git authentication are required.

1. Enter a book, choose its shelf, and click **Add to queue**. Books default to
   a new **My / New books** shelf; you can rearrange them on the bookshelf later.
2. Or upload a CSV or JSON file. Download the CSV template for column names.
   Language uses codes such as EN and JA. JSON accepts an array or `{ "books": [...] }`,
   including the compact field names used in `assets/data/library.json`.
   A batch is rejected entirely if any row is invalid or has an existing ID.
3. Review the queue. Remove mistakes or download the queue as a backup.
4. Click **Publish books**. This saves, commits, and pushes the additions. GitHub
   Pages typically takes a few minutes to show them publicly.

The manager runs only on this computer at a loopback address. Git handles your
credentials; there is no public write endpoint or token stored in the website.
Only `assets/data/library-additions.json` is committed by the manager. Work on
`main`, and commit or unstage any staged changes before publishing. If a push
fails after saving, run `git push` to retry; do not re-import the saved books.
Pending books stay in memory until published; use **Download queue** before closing
if you want to return later.

Additions are separate from the original spreadsheet export, so rebuilding the
base catalog does not erase them. The main website's Bookshelf tab combines both
files. Older standalone library experiments still use their original catalog.
To correct an already published addition, edit `library-additions.json` and commit
and push it normally. Uploads accept catalog records, not ebook files.

Command-line alternative: `node scripts/library-admin.mjs --open`.
