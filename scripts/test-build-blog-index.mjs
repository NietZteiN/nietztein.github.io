// Only Git-tracked, immediate Markdown posts belong in the public index.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, unlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';

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
	assert.equal(spawnSync(process.execPath, ['scripts/build-blog-index.mjs', '--check'], { cwd: root }).status, 0);
	writeFileSync(join(root, 'blog/index.json'), '[]\n');
	assert.equal(spawnSync(process.execPath, ['scripts/build-blog-index.mjs', '--check'], { cwd: root }).status, 1);
	assert.equal(readFileSync(join(root, 'blog/index.json'), 'utf8'), '[]\n', '--check does not rewrite stale files');
	build();
	post('2026-02-30-invalid.md');
	git('add', '--', 'blog/posts/2026-02-30-invalid.md');
	assert.equal(spawnSync(process.execPath, ['scripts/build-blog-index.mjs'], { cwd: root }).status, 1, 'invalid dates fail before publishing');
	git('rm', '--cached', '--', 'blog/posts/2026-02-30-invalid.md');
	post('2025-01-03-new-post.md');
	git('add', '--', 'blog/posts/2025-01-03-new-post.md');
	assert.equal(spawnSync(process.execPath, ['scripts/build-blog-index.mjs'], { cwd: root }).status, 1, 'duplicate slugs fail before publishing');
	git('rm', '--cached', '--', 'blog/posts/2025-01-03-new-post.md');
	writeFileSync(join(root, 'blog/posts/2026-01-05-short-note.md'), '---\ntitle: Fixture note\nkind: note\n---\nA brief fixture.\n');
	writeFileSync(join(root, 'blog/posts/2026-01-06-article.md'), '---\ntitle: Explicit article\nkind: article\n---\nAn article fixture.\n');
	git('add', '--', 'blog/posts/2026-01-05-short-note.md', 'blog/posts/2026-01-06-article.md');
	build();
	const entries = JSON.parse(readFileSync(join(root, 'blog/index.json'), 'utf8'));
	assert.equal(entries.find((entry) => entry.slug === 'short-note').kind, 'note');
	assert.equal(Object.hasOwn(entries.find((entry) => entry.slug === 'article'), 'kind'), false, 'explicit articles keep the original index shape');
	assert.equal(Object.hasOwn(entries.find((entry) => entry.slug === 'new-post'), 'kind'), false, 'existing posts keep the original index shape');
	writeFileSync(join(root, 'blog/posts/2026-01-07-invalid-kind.md'), '---\nkind: tweet\n---\nInvalid format.\n');
	git('add', '--', 'blog/posts/2026-01-07-invalid-kind.md');
	assert.equal(spawnSync(process.execPath, ['scripts/build-blog-index.mjs'], { cwd: root }).status, 1, 'unsupported formats fail before publishing');
	console.log('Blog index: tracked sources, staging/deletion, read-only --check, date, slug and explicit note format checks passed');
} finally {
	if (dirname(resolve(root)) !== resolve(tmpdir())) throw new Error('Unexpected cleanup target');
	rmSync(root, { recursive: true, force: true });
}
