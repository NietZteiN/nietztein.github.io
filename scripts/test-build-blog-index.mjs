// Only Git-tracked, immediate Markdown posts belong in the public index.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, unlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = mkdtempSync(join(tmpdir(), 'blog-index-test-'));
const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
const post = (file) => writeFileSync(join(root, 'blog/posts', file), '---\ntitle: Test post\n---\nFixture.\n');
const build = () => {
	execFileSync(process.execPath, ['scripts/build-blog-index.mjs'], { cwd: root, stdio: 'pipe' });
	return JSON.parse(readFileSync(join(root, 'blog/index.json'), 'utf8')).map(p => p.file);
};
try {
	mkdirSync(join(root, 'scripts'));
	mkdirSync(join(root, 'blog/posts/nested'), { recursive: true });
	copyFileSync(join(dirname(fileURLToPath(import.meta.url)), 'build-blog-index.mjs'), join(root, 'scripts/build-blog-index.mjs'));
	git('init', '--quiet');
	post('2026-01-01-published.md');
	post('2026-01-02-private-note.md');
	post('2026-01-03-new-post.md');
	post('nested/2026-01-04-note.md');
	git('add', '--', 'blog/posts/2026-01-01-published.md', 'blog/posts/nested/2026-01-04-note.md');
	assert.deepEqual(build(), ['2026-01-01-published.md']);
	git('add', '--', 'blog/posts/2026-01-03-new-post.md');
	assert.deepEqual(build(), ['2026-01-03-new-post.md', '2026-01-01-published.md']);
	unlinkSync(join(root, 'blog/posts/2026-01-01-published.md'));
	assert.deepEqual(build(), ['2026-01-03-new-post.md']);
	assert.match(readFileSync(join(root, 'blog/posts/2026-01-02-private-note.md'), 'utf8'), /Fixture/);
	console.log('Blog index: 4 checks passed');
} finally {
	if (dirname(resolve(root)) !== resolve(tmpdir())) throw new Error('Unexpected cleanup target');
	rmSync(root, { recursive: true, force: true });
}
