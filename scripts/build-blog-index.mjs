// Builds the blog's generated files from the Markdown in blog/posts/:
//
//   blog/index.json   -> post metadata used by assets/js/blog.js
//   blog/feed.xml     -> RSS 2.0 feed
//   blog/p/<slug>.html-> one tiny page per post carrying Open Graph / Twitter
//                        meta tags (so shared links get a title + summary
//                        card) that then redirects to the in-app route.
//
// Zero dependencies — run with:  node scripts/build-blog-index.mjs
// It is also run automatically by .github/workflows/build-blog.yml on every push
// that touches blog/posts/**, so you normally never run it by hand.
//
// Each post file may start with a front-matter block:
//
//   ---
//   title: Hello, world
//   date: 2026-07-14
//   summary: One-line teaser shown in the post list.
//   tags: [meta, research]
//   ---
//
// Missing fields fall back sensibly (date/slug are derived from the filename).

import {
	readdirSync,
	readFileSync,
	writeFileSync,
	existsSync,
	mkdirSync,
	rmSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE_URL = 'https://nietztein.github.io';
const SITE_NAME = 'Jack V. Le';
const SITE_DESCRIPTION = 'Notes on language models, meaning, and research.';
const OG_IMAGE = 'https://github.com/nietztein.png';
const WORDS_PER_MINUTE = 200;

const scriptDir = dirname(fileURLToPath(import.meta.url));
const root = join(scriptDir, '..');
const postsDir = join(root, 'blog', 'posts');
const indexFile = join(root, 'blog', 'index.json');
const feedFile = join(root, 'blog', 'feed.xml');
const stubDir = join(root, 'blog', 'p');

// Parse a small subset of YAML front matter: `key: value` per line, plus
// `[a, b, c]` inline lists. No external YAML dependency.
function parseFrontMatter(text) {
	const fm = {};
	let body = text;
	const m = /^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?/.exec(text);
	if (!m) return { fm, body };
	body = text.slice(m[0].length);
	for (const line of m[1].split(/\r?\n/)) {
		const idx = line.indexOf(':');
		if (idx === -1) continue;
		const key = line.slice(0, idx).trim();
		let val = line.slice(idx + 1).trim();
		if (val.startsWith('[') && val.endsWith(']')) {
			fm[key] = val
				.slice(1, -1)
				.split(',')
				.map((s) => s.trim().replace(/^["']|["']$/g, ''))
				.filter(Boolean);
		} else {
			fm[key] = val.replace(/^["']|["']$/g, '');
		}
	}
	return { fm, body };
}

// "2026-07-14-hello-world.md" -> "hello-world"
function slugFromFile(file) {
	return file.replace(/\.md$/i, '').replace(/^\d{4}-\d{2}-\d{2}-/, '');
}

function wordCount(markdown) {
	const text = markdown
		.replace(/```[\s\S]*?```/g, ' ') // code blocks
		.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ') // images
		.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // links -> text
		.replace(/[#>*_`~-]+/g, ' ');
	return text.split(/\s+/).filter(Boolean).length;
}

function escapeXml(s) {
	return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
		'&': '&amp;',
		'<': '&lt;',
		'>': '&gt;',
		'"': '&quot;',
		"'": '&#39;',
	})[c]);
}

function postUrl(p) {
	return `${SITE_URL}/#/post/${encodeURIComponent(p.slug)}`;
}

function stubUrl(p) {
	return `${SITE_URL}/blog/p/${encodeURIComponent(p.slug)}.html`;
}

function rfc822(iso) {
	const d = new Date(iso + 'T00:00:00Z');
	return isNaN(d.getTime()) ? '' : d.toUTCString();
}

function buildFeed(posts) {
	const items = posts
		.filter((p) => p.date)
		.map(
			(p) => `    <item>
      <title>${escapeXml(p.title)}</title>
      <link>${escapeXml(postUrl(p))}</link>
      <guid isPermaLink="false">${escapeXml(p.slug)}</guid>
      <pubDate>${rfc822(p.date)}</pubDate>
      <description>${escapeXml(p.summary)}</description>
${p.tags.map((t) => `      <category>${escapeXml(t)}</category>`).join('\n')}
    </item>`
		)
		.join('\n');

	return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(SITE_NAME)}</title>
    <link>${SITE_URL}/#/blog</link>
    <atom:link href="${SITE_URL}/blog/feed.xml" rel="self" type="application/rss+xml" />
    <description>${escapeXml(SITE_DESCRIPTION)}</description>
    <language>en-us</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${items}
  </channel>
</rss>
`;
}

function buildStub(p) {
	const url = postUrl(p);
	const title = `${p.title} · ${SITE_NAME}`;
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeXml(title)}</title>
<meta name="description" content="${escapeXml(p.summary)}">
<link rel="canonical" href="${escapeXml(url)}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="${escapeXml(SITE_NAME)}">
<meta property="og:title" content="${escapeXml(p.title)}">
<meta property="og:description" content="${escapeXml(p.summary)}">
<meta property="og:url" content="${escapeXml(stubUrl(p))}">
<meta property="og:image" content="${OG_IMAGE}">
<meta property="article:published_time" content="${escapeXml(p.date)}">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${escapeXml(p.title)}">
<meta name="twitter:description" content="${escapeXml(p.summary)}">
<meta name="twitter:image" content="${OG_IMAGE}">
<meta http-equiv="refresh" content="0; url=${escapeXml(url)}">
<script>location.replace(${JSON.stringify(url)});</script>
</head>
<body>
<p>Redirecting to <a href="${escapeXml(url)}">${escapeXml(p.title)}</a>…</p>
</body>
</html>
`;
}

function build() {
	if (!existsSync(postsDir)) {
		mkdirSync(postsDir, { recursive: true });
	}

	const files = readdirSync(postsDir).filter((f) => /\.md$/i.test(f));

	const posts = files.map((file) => {
		const text = readFileSync(join(postsDir, file), 'utf8');
		const { fm, body } = parseFrontMatter(text);
		const dateFromName = (file.match(/^(\d{4}-\d{2}-\d{2})-/) || [])[1] || '';
		const slug = slugFromFile(file);
		const words = wordCount(body);
		return {
			slug,
			title: fm.title || slug,
			date: fm.date || dateFromName || '',
			summary: fm.summary || '',
			tags: Array.isArray(fm.tags) ? fm.tags : fm.tags ? [fm.tags] : [],
			words,
			minutes: Math.max(1, Math.round(words / WORDS_PER_MINUTE)),
			file,
		};
	});

	// Newest first.
	posts.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

	writeFileSync(indexFile, JSON.stringify(posts, null, 2) + '\n');
	console.log(`Wrote ${posts.length} post(s) to blog/index.json`);

	writeFileSync(feedFile, buildFeed(posts));
	console.log('Wrote blog/feed.xml');

	rmSync(stubDir, { recursive: true, force: true });
	mkdirSync(stubDir, { recursive: true });
	for (const p of posts) {
		writeFileSync(join(stubDir, `${p.slug}.html`), buildStub(p));
	}
	console.log(`Wrote ${posts.length} share page(s) to blog/p/`);
}

build();
