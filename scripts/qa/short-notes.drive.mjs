// No real notes are published: public-reader fixtures are fetch responses, and
// authoring/publishing runs only against the in-memory fake GitHub server.
import path from 'node:path';
import { startFakeGitHub } from '../../desk/test/fake-github.mjs';
import { openDesk, signIn, unlock, fill } from '../../desk/test/drive-helpers.mjs';

export default async function (ctx) {
	const { newPage, baseUrl, assert, outDir } = ctx;
	const gadgets = JSON.stringify({ ambient: false, tilt: false, avatar: false, signature: false, now: false, navcat: false, book3d: false, eggs: false });
	for (const [theme, width] of [['dark', 1280], ['light', 390]]) {
		const page = await newPage({ width, height: 900, mobile: width < 600, theme, reducedMotion: true,
			storage: { 'gadgets.v1': gadgets }, blockHosts: ['giscus.app'], extraAllowedHosts: ['github.com', 'avatars.githubusercontent.com'] });
		await page.goto(baseUrl + '#/blog?format=note');
		await page.waitFor('.blog-empty');
		assert.match(await page.eval(() => document.querySelector('.blog-empty').textContent), /No short notes have been published yet/);
		assert.equal(await page.eval(() => document.querySelectorAll('.blog-card').length), 0, 'no actual note content is invented');
		await page.eval(() => { location.hash = '#/about'; });
		await page.reload();
		await page.eval(() => {
			const fixture = [
				{ slug: 'qa-note', title: 'QA short note', date: '2001-01-03', summary: 'An in-memory note fixture.', tags: ['language'], file: '2001-01-03-qa-note.md', kind: 'note' },
				{ slug: 'qa-other-note', title: 'QA other note', date: '2001-01-02', summary: 'Another in-memory note fixture.', tags: ['other'], file: '2001-01-02-qa-other-note.md', kind: 'note' },
				{ slug: 'qa-article', title: 'QA article', date: '2001-01-01', summary: 'An in-memory article fixture.', tags: ['language', 'code'], file: '2001-01-01-qa-article.md' },
			];
			const original = window.fetch;
			window.fetch = function (url, options) {
				const pathname = new URL(String(url), location.href).pathname;
				if (pathname.endsWith('/blog/index.json')) return Promise.resolve(new Response(JSON.stringify(fixture), { headers: { 'Content-Type': 'application/json' } }));
				const post = fixture.find((item) => pathname.endsWith('/blog/posts/' + item.file));
				if (post) return Promise.resolve(new Response('---\ntitle: ' + post.title + '\n' + (post.kind ? 'kind: note\n' : '') + '---\n\nA brief authored browser fixture.'));
				return original(url, options);
			};
			location.hash = '#/blog';
		});
		await page.waitFor(() => document.querySelectorAll('.blog-card').length === 3);
		assert.equal(await page.eval(() => document.querySelectorAll('.blog-card .blog-kind-badge').length), 2);
		await page.click('#blog-format-note');
		await page.waitFor(() => document.querySelectorAll('.blog-card').length === 2 && document.querySelector('#blog-format-note').getAttribute('aria-current') === 'page');
		assert.equal(await page.eval(() => document.activeElement.id), 'blog-format-note', 'format links retain keyboard focus after rendering');
		await page.eval(() => {
			const select = document.querySelector('#blog-tag-filter');
			select.focus();
			select.value = 'language';
			select.dispatchEvent(new Event('change', { bubbles: true }));
		});
		await page.waitFor(() => document.querySelectorAll('.blog-card').length === 1 && location.hash === '#/blog?format=note&tag=language');
		assert.equal(await page.eval(() => document.activeElement.id), 'blog-tag-filter');
		assert.equal(await page.eval(() => document.querySelector('.blog-card .tag').getAttribute('href')), '#/blog?format=note&tag=language');
		await page.click('.blog-card-title');
		await page.waitFor('#blogPostView[data-rendered-slug="qa-note"]');
		assert.equal(await page.eval(() => document.querySelector('#blogPostView').getAttribute('data-post-kind')), 'note');
		assert.equal(await page.eval(() => document.querySelector('.blog-post-meta .blog-kind-badge').textContent), 'Short note');
		assert.match(await page.eval(() => document.querySelector('.blog-article-link').textContent), /Note page/);
		assert.equal(await page.eval(() => document.querySelector('.blog-back').getAttribute('href')), '#/blog?format=note&tag=language');
		await page.click('.blog-back');
		await page.waitFor('#blogListView .blog-card-title', { visible: true });
		assert.equal(await page.eval(() => document.querySelector('#blog-tag-filter').value), 'language');
		assert.equal(await page.eval(() => document.querySelector('#blog-format-note').getAttribute('aria-current')), 'page');
		await page.click('#blog-format-article');
		await page.waitFor(() => document.querySelectorAll('.blog-card').length === 1 && document.querySelector('.blog-card').getAttribute('data-slug') === 'qa-article');
		assert.equal(await page.eval(() => location.hash), '#/blog?format=article&tag=language');
		assert.equal(await page.eval(() => document.querySelector('.blog-card').getAttribute('data-post-kind')), 'article');
		await page.click('#blog-format-all');
		await page.waitFor(() => document.querySelectorAll('.blog-card').length === 2);
		assert.equal(await page.eval(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), true);
		await page.screenshot(path.join(outDir, 'short-note-filter-' + theme + '-' + width + '.png'));
		assert.deepEqual(page.errors.filter((error) => error.type === 'exception'), []);
		await page.close();
	}

	const fake = await startFakeGitHub();
	try {
		const privateRepo = fake.repo('NietZteiN/desk-ready');
		const publicRepo = fake.repo('NietZteiN/nietztein.github.io');
		privateRepo.put('notes/inbox/do-not-publish.md', 'PRIVATE_ONLY_NOTE_FIXTURE\n');
		const page = await openDesk(ctx, fake, { width: 1280, height: 900, theme: 'dark', reducedMotion: true });
		await signIn(page);
		await page.goto(page.deskUrl + '#/write?new=1');
		await page.waitFor('#w-kind', { visible: true });
		assert.equal(await page.eval(() => document.querySelector('#w-kind').value), '', 'existing Article format is the default');
		await fill(page, '#w-title', 'QA short note fixture');
		await fill(page, '#w-summary', 'A brief authored fixture used only by local tests.');
		await fill(page, '#w-date', '2001-01-01');
		await fill(page, '#w-kind', 'note');
		await fill(page, '#w-text', 'A brief authored note in the fake GitHub server.');
		await page.waitFor(() => document.querySelector('#w-preview-host iframe')?.contentDocument?.querySelector('.w-preview-kind-label')?.textContent === 'Short note');
		await page.click('#w-save');
		await page.waitFor(() => location.hash.includes('draft='));
		const draftPath = await page.eval(() => new URLSearchParams(location.hash.split('?')[1]).get('draft'));
		assert.match(privateRepo.text(draftPath), /^kind: note$/m);
		await page.reload();
		await unlock(page);
		await page.waitFor('#w-kind');
		assert.equal(await page.eval(() => document.querySelector('#w-kind').value), 'note', 'saved/reopened draft retains its format');
		await page.click('#w-publish');
		await page.waitFor('dialog[open] [data-role="publish"]');
		assert.match(await page.eval(() => document.querySelector('dialog[open]').textContent), /Format: Short note/);
		const publicPath = 'blog/posts/2001-01-01-qa-short-note-fixture.md';
		assert.equal(publicRepo.text(publicPath), null, 'review alone cannot publish');
		await page.click('dialog[open] [data-role="cancel"]');
		await page.waitFor('dialog[open]', { hidden: true });
		assert.equal(publicRepo.text(publicPath), null, 'cancel preserves the public site');
		await page.click('#w-publish');
		await page.waitFor('dialog[open] [data-role="publish"]');
		await page.click('dialog[open] [data-role="publish"]');
		await page.waitFor('#w-watch');
		assert.match(publicRepo.text(publicPath), /^kind: note$/m);
		await page.waitFor('#w-live-link', { timeoutMs: 15000 });
		assert.equal(JSON.parse(publicRepo.text('blog/index.json')).find((entry) => entry.slug === 'qa-short-note-fixture').kind, 'note');
		assert.equal(publicRepo.files().some((name) => name.startsWith('notes/')), false);
		assert.equal(publicRepo.files().some((name) => (publicRepo.text(name) || '').includes('PRIVATE_ONLY_NOTE_FIXTURE')), false, 'private Notes are never promoted automatically');
		await page.click('.w-meta-sum');
		await fill(page, '#w-kind', '');
		await page.waitFor(() => document.querySelector('#w-preview-host iframe')?.contentDocument?.querySelector('.w-preview-kind-label') === null);
		await page.click('#w-save');
		await page.waitFor(() => document.querySelector('#w-status')?.dataset.state === 'saved');
		assert.equal(/^kind:/m.test(privateRepo.text(draftPath)), false, 'switching to Article removes kind from the saved draft');
		assert.equal(publicRepo.text(publicPath).includes('kind: note'), true, 'saving an Article draft does not silently update the live note');
		await page.screenshot(path.join(outDir, 'short-note-desk.png'));
		await page.setViewport({ width: 390, height: 844, mobile: true });
		await page.eval(() => document.querySelector('#w-kind').scrollIntoView({ block: 'center' }));
		assert.equal(await page.eval(() => document.querySelector('#w-kind').getBoundingClientRect().height >= 44), true, 'mobile format selector has a full touch target');
		assert.equal(await page.eval(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), true);
		await page.screenshot(path.join(outDir, 'short-note-desk-mobile.png'));
		await fill(page, '#w-kind', 'note');
		await page.click('#w-tab-preview');
		await page.waitFor(() => document.querySelector('#w-preview-host iframe')?.contentDocument?.querySelector('.w-preview-kind-label')?.textContent === 'Short note');
		assert.deepEqual(page.errors.filter((error) => error.type === 'exception'), []);
		await page.close();
	} finally { await fake.close(); }
}
