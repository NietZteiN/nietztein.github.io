// Builds blog/index.json from tracked Markdown files in blog/posts/.
// Untracked working notes and drafts never enter the public index. Stage a
// new post with git add before building its index entry.
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

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const root = join(scriptDir, '..');
const postsDir = join(root, 'blog', 'posts');
const outFile = join(root, 'blog', 'index.json');

// Parse a small subset of YAML front matter: `key: value` per line, plus
// `[a, b, c]` inline lists. No external YAML dependency.
function parseFrontMatter(text) {
	const fm = {};
	const m = /^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?/.exec(text);
	if (!m) return fm;
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
	return fm;
}

// "2026-07-14-hello-world.md" -> "hello-world"
function slugFromFile(file) {
	return file.replace(/\.md$/i, '').replace(/^\d{4}-\d{2}-\d{2}-/, '');
}

function build() {
	if (!existsSync(postsDir)) {
		mkdirSync(postsDir, { recursive: true });
	}

	const tracked = execFileSync('git', ['ls-files', '-z', '--', 'blog/posts/'], { cwd: root, encoding: 'utf8' });
	const files = tracked.split('\0').filter(Boolean).map((file) => file.slice('blog/posts/'.length))
		.filter((file) => /^[^/\\]+\.md$/i.test(file) && existsSync(join(postsDir, file)));

	const posts = files.map((file) => {
		const text = readFileSync(join(postsDir, file), 'utf8');
		const fm = parseFrontMatter(text);
		const dateFromName = (file.match(/^(\d{4}-\d{2}-\d{2})-/) || [])[1] || '';
		const slug = slugFromFile(file);
		return {
			slug,
			title: fm.title || slug,
			date: fm.date || dateFromName || '',
			summary: fm.summary || '',
			tags: Array.isArray(fm.tags) ? fm.tags : fm.tags ? [fm.tags] : [],
			file,
		};
	});

	// Newest first.
	posts.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

	writeFileSync(outFile, JSON.stringify(posts, null, 2) + '\n');
	console.log(`Wrote ${posts.length} post(s) to blog/index.json`);
}

build();
