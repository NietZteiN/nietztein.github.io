# Blog

Posts are plain Markdown files immediately inside [`posts/`](posts/). Only
Git-tracked files enter the public index, article pages, or feed; stage a new
post with `git add` when it is ready to publish. There is no draft flag.
Half-finished writing goes in
[`drafts/`](drafts/) instead, which is gitignored and never leaves this machine.

## Drafting

Drop a `.md` anywhere in `drafts/` and write freely — no front matter or date
prefix needed yet. Nothing there is committed, pushed, or served.

When it's ready, give it front matter and move it into `posts/` with a dated
filename:

```bash
mv blog/drafts/my-idea.md blog/posts/2026-08-01-my-idea.md
```

(Plain `mv`, not `git mv` — git refuses to move a file it isn't tracking.) Then
follow the publishing steps below.

## Publishing

1. Create a file named `posts/YYYY-MM-DD-your-slug.md` (the date and slug come
   from the filename).
2. Start it with a front-matter block, then write Markdown:

   ```markdown
   ---
   title: Your title here
   date: 2026-08-01
   summary: One line shown in the post list.
   tags: [tag-one, tag-two]
   ---

   # Your title here

   Body goes here. Code blocks are syntax-highlighted and `$LaTeX$` math renders.
   ```
3. Stage the post, commit and push. Use a lowercase, hyphen-separated slug and a
   real `YYYY-MM-DD` date. Two files cannot share the same slug.

A GitHub Action ([`.github/workflows/build-blog.yml`](../.github/workflows/build-blog.yml))
regenerates `index.json`, native article pages at `/writing/<slug>/`, RSS at
`/feed.xml`, and `sitemap.xml`, then commits them back. The site picks up the
new post automatically. The workflow also runs when the publishing builders
change. **These outputs are generated — do not edit them by hand.**

For a short note, add `kind: note` to the same front-matter block. Existing
posts omit `kind` and remain Articles; `kind: article` is also accepted but is
omitted from the public index. Other values fail the publishing build. Short
notes use the same title, date, summary, tags, file naming, share pages, and RSS
feed, and carry a visible format label. The blog's All / Articles / Short notes
filter combines with its topic filter (`#/blog?format=note&tag=language`).

The Desk's **Write → Post details → Format** control chooses Article or Short
note, keeps that choice in the saved draft and preview, and uses the existing
reviewed Publish action. The Desk's private **Notes** area remains private;
nothing from it is automatically published or turned into a short note.

When generated files change on the default branch, the workflow explicitly
requests a Pages rebuild after its commit. GitHub's workflow token does not
trigger a branch-source Pages build merely by pushing a commit. See
[GitHub's publishing-source documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site).

## One-time setup

For the Action to commit the regenerated index back, the repository must allow
it to write:

> **Settings → Actions → General → Workflow permissions → "Read and write
> permissions" → Save.**

No change to the GitHub Pages source is needed — Pages keeps deploying from the
branch.

## Rebuilding publishing files locally (optional)

You normally don't need this, but you can regenerate the publishing files:

```bash
node scripts/build-blog-index.mjs
node scripts/build-blog-pages.mjs
```

Both commands accept `--check` to report stale outputs without writing. Builds
are deterministic and do not add current-time timestamps. Untracked posts,
nested files, and drafts are excluded. Removing a public post removes only its
generator-marked `writing/<slug>/index.html`; unrelated files survive. An
existing hand-written page at the same path stops the build rather than being
overwritten.

## Reading, sharing, and RSS

Each post has a native, readable page at `/writing/<slug>/`. Its HTML includes
the article body, title, description, canonical URL, publication date, topic
links, and social preview metadata, so it works for link previews and without
JavaScript. The site's existing `#/post/<slug>` reader remains available.

RSS is at [`/feed.xml`](../feed.xml). It contains public titles, summaries,
categories, canonical article links, stable permalink GUIDs, and publication
dates at midnight UTC. It includes neither drafts nor commented-out passages.

[`scripts/build-blog-pages.mjs`](../scripts/build-blog-pages.mjs) uses the
already-vendored Marked parser with a controlled renderer. Standard Markdown,
tables, images, and code blocks are supported; raw HTML is omitted and unsafe
link/image protocols are rejected. HTML comments are removed before rendering,
while literal examples inside inline and fenced code remain visible. Code
highlighting and math rendering use the existing local vendor files. The
standalone reader's hand-written assets are [`writing/article.css`](../writing/article.css)
and [`writing/article.js`](../writing/article.js).

## How the site reader works

The main site's blog reader is rendered in the browser.
[`assets/js/blog.js`](../assets/js/blog.js) fetches `index.json`,
renders the list, and — when you open a post — fetches its Markdown, converts it
with [marked](https://marked.js.org/), sanitizes it with
[DOMPurify](https://github.com/cure53/DOMPurify), then applies
[highlight.js](https://highlightjs.org/) and [KaTeX](https://katex.org/).
Individual posts are linkable at `#/post/<slug>`.

The home page and blog list do not load the Markdown, sanitizing, code, or math
libraries. [`assets/js/reader-libs.js`](../assets/js/reader-libs.js) loads the
existing local vendor files when a post needs them, shares in-flight requests,
and permits retry after a failed load. Markdown and sanitizing must be ready
before post HTML is shown. Code highlighting and math are optional enhancements
and load only when the article contains matching content. Static article pages
use the same optional enhancements and remain readable without JavaScript.

## Views, likes, and comments

Both features are optional, free, and switched on purely by filling in
[`assets/js/config.json`](../assets/js/config.json). Leave a value blank and the
matching UI does not render at all. Nothing is stored in this repository.

### Comments and likes (giscus)

Comments and emoji reactions live as **GitHub Discussions** on this repo, one
Discussion per post (titled with the post's slug). Readers sign in with GitHub;
you moderate from the repo's Discussions tab.

One-time setup:

1. **Settings → General → Features → tick "Discussions"** on the repo.
2. Install the giscus app on the repo: <https://github.com/apps/giscus>.
3. Open <https://giscus.app>, enter `NietZteiN/nietztein.github.io`, and pick the
   **Announcements** category (so only you can open new threads; readers can
   still reply). The page prints a `data-category-id` — copy it into
   `giscus.categoryId` in `config.json`. The `repoId` is already filled in.
4. Commit and push.

The embed uses the `specific` mapping keyed by slug — pathname mapping would
put every post in one thread, because the site uses hash routes.
Reactions on the Discussion itself appear above the comment box and act as the
post's "likes". The comment frame follows the site's light/dark toggle.

### View counts (GoatCounter)

GoatCounter is free for personal sites and doubles as privacy-friendly
analytics (no cookies, no consent banner).

1. Sign up at <https://www.goatcounter.com/signup> and pick a site code, e.g.
   `nietztein` → `https://nietztein.goatcounter.com`.
2. In GoatCounter, **Settings → Site → tick "Allow adding visitor counts on
   your website"**. That exposes the public per-path counter the post page reads.
3. Put the code into `goatCounterCode` in `config.json`, commit, push.

Each post then shows "N views" next to its date. Counts are per path
(`/post/<slug>`) and start from the moment tracking goes live.
