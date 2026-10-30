// Builds blog/index.json from tracked Markdown files in blog/posts/.
// Untracked working notes and drafts never enter the public index. Stage a
// new post with git add before building its index entry.
//
// Zero dependencies — run with:  node scripts/build-blog-index.mjs [--check]
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

import { readFileSync, writeFileSync, existsSync, mkdirSync, lstatSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const scriptDir = dirname(fileURLToPath(import.meta.url));
export const repoRoot = resolve(scriptDir, '..');

// Parse a small subset of YAML front matter: `key: value` per line, plus
// `[a, b, c]` inline lists. No external YAML dependency.
export function parseFrontMatter(text) {
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
export function slugFromFile(file) {
	return file.replace(/\.md$/i, '').replace(/^\d{4}-\d{2}-\d{2}-/, '');
}

// Both public builders use this one tracked-file boundary. Merely saving a
// draft beside published posts does not make it public.
export function collectPosts(root = repoRoot) {
	const postsDir = join(root, 'blog', 'posts');
	const tracked = execFileSync('git', ['ls-files', '-z', '--', 'blog/posts/'], { cwd: root, encoding: 'utf8' });
	const files = tracked.split('\0').filter(Boolean).map((file) => file.slice('blog/posts/'.length))
		.filter((file) => /^[^/\\]+\.md$/i.test(file) && existsSync(join(postsDir, file)) && lstatSync(join(postsDir, file)).isFile());

	const posts = files.map((file) => {
		const text = readFileSync(join(postsDir, file), 'utf8');
		const fm = parseFrontMatter(text);
		if (fm.kind !== undefined && fm.kind !== '' && fm.kind !== 'article' && fm.kind !== 'note') throw new Error(`${file}: kind must be note, article, or omitted`);
		const dateFromName = (file.match(/^(\d{4}-\d{2}-\d{2})-/) || [])[1] || '';
		const slug = slugFromFile(file);
		if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new Error(`${file}: use a lowercase, hyphen-separated post slug`);
		const date = fm.date || dateFromName || '';
		if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date + 'T00:00:00Z')) || new Date(date + 'T00:00:00Z').toISOString().slice(0, 10) !== date)) {
			throw new Error(`${file}: publication date must be a real YYYY-MM-DD date`);
		}
		const meta = {
			slug,
			title: fm.title || slug,
			date,
			summary: fm.summary || '',
			tags: Array.isArray(fm.tags) ? fm.tags : fm.tags ? [fm.tags] : [],
			file,
			...(fm.kind === 'note' ? { kind: 'note' } : {}),
		};
		return { meta, markdown: text.replace(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?/, '').replace(/\r\n/g, '\n') };
	});
	const seen = new Set();
	for (const { meta } of posts) {
		if (seen.has(meta.slug)) throw new Error(`Duplicate post slug: ${meta.slug}`);
		seen.add(meta.slug);
	}
	return posts.sort((a, b) => b.meta.date.localeCompare(a.meta.date) || a.meta.file.localeCompare(b.meta.file));
}

export function buildIndex({ root = repoRoot, check = false } = {}) {
	const posts = collectPosts(root).map((post) => post.meta);
	const outFile = join(root, 'blog', 'index.json');
	const expected = JSON.stringify(posts, null, 2) + '\n';
	const current = existsSync(outFile) ? readFileSync(outFile, 'utf8').replace(/\r\n/g, '\n') : null;
	if (current === expected) return { ok: true, count: posts.length, changed: false };
	if (check) return { ok: false, count: posts.length, changed: true };
	mkdirSync(dirname(outFile), { recursive: true });
	writeFileSync(outFile, expected);
	return { ok: true, count: posts.length, changed: true };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const args = process.argv.slice(2);
	try {
		if (args.some((arg) => arg !== '--check')) throw new Error('Usage: node scripts/build-blog-index.mjs [--check]');
		const result = buildIndex({ check: args.includes('--check') });
		console.log(result.ok ? `Blog index: ${result.count} public post(s), ${result.changed ? 'updated' : 'up to date'}` : 'blog/index.json is out of date; run node scripts/build-blog-index.mjs');
		if (!result.ok) process.exitCode = 1;
	} catch (error) {
		console.error(error.message);
		process.exitCode = 1;
	}
}
