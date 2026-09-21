# Blog

Posts are plain Markdown files in [`posts/`](posts/). Anything in `posts/` is
published — there is no draft flag. Half-finished writing goes in
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
3. Commit and push. That's it.

A GitHub Action ([`.github/workflows/build-blog.yml`](../.github/workflows/build-blog.yml))
regenerates `index.json` from the posts folder and commits it back, so the site
picks up the new post automatically. **`index.json` is generated — do not edit it
by hand.**

## One-time setup

For the Action to commit the regenerated index back, the repository must allow
it to write:

> **Settings → Actions → General → Workflow permissions → "Read and write
> permissions" → Save.**

No change to the GitHub Pages source is needed — Pages keeps deploying from the
branch.

## Rebuilding the index locally (optional)

You normally don't need this, but you can regenerate the index yourself:

```bash
node scripts/build-blog-index.mjs
```

## How posts are rendered

The blog is rendered entirely in the browser (no build step for the site
itself). [`assets/js/blog.js`](../assets/js/blog.js) fetches `index.json`,
renders the list, and — when you open a post — fetches its Markdown, converts it
with [marked](https://marked.js.org/), sanitizes it with
[DOMPurify](https://github.com/cure53/DOMPurify), then applies
[highlight.js](https://highlightjs.org/) and [KaTeX](https://katex.org/).
Individual posts are linkable at `#/post/<slug>`.
