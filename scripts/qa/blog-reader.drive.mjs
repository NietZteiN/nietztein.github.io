// Browser regression: native links, topic routes, reader tools, publication gates,
// recoverable loads, and late responses after navigation. Run with qa/drive.mjs.
import path from 'node:path';

export default async function ({ newPage, baseUrl, assert, outDir }) {
	const preferences = JSON.stringify({ ambient: false, tilt: false, avatar: false, signature: false, now: false, navcat: false, book3d: false, eggs: false });
	for (const [theme, width] of [['dark', 1280], ['light', 390]]) {
		const page = await newPage({
			width, height: width === 390 ? 844 : 900, theme, reducedMotion: true,
			storage: { 'gadgets.v1': preferences },
			blockHosts: ['giscus.app'],
			extraAllowedHosts: ['github.com', 'avatars.githubusercontent.com'],
		});
		async function checkListLanding(label) {
			if (width !== 390) return;
			await page.waitFor(() => {
				const title = document.querySelector('.blog-list-title')?.getBoundingClientRect();
				return title && title.top >= document.querySelector('.site-header').offsetHeight - 1 && title.bottom <= innerHeight;
			});
			assert.equal(await page.eval(() => document.querySelector('.blog-list-title').getBoundingClientRect().top < 100), true, label);
		}
		await page.goto(baseUrl + 'index.html#/blog');
		await page.waitFor('.blog-card-title');
		assert.equal(await page.eval(() => document.querySelector('.blog-subscribe').getAttribute('href')), 'feed.xml');
		await checkListLanding('direct mobile blog visit opens on the list');
		await page.eval(() => window.dispatchEvent(new Event('hashchange')));
		await page.waitFor('.blog-card-title', { visible: true });
		assert.equal(await page.eval(() => document.querySelectorAll('.blog-card').length), 7);
		assert.equal(await page.eval(() => document.querySelector('.blog-card').tagName), 'ARTICLE');
		assert.equal(await page.eval(() => document.querySelector('.blog-card').hasAttribute('role')), false);
		assert.equal(await page.eval(() => document.querySelector('.blog-card-title').getAttribute('href')), '#/post/the-idea-of-order-at-the-screen');
		assert.equal(await page.eval(() => {
			const link = document.querySelector('.blog-card-title');
			let unhandled = false;
			window.addEventListener('click', (event) => {
				unhandled = !event.defaultPrevented;
				event.preventDefault(); // Keep this regression from opening an untracked popup.
			}, { once: true });
			link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }));
			return unhandled;
		}), true, 'modified native click is not intercepted');
		assert.equal(await page.eval(() => location.hash), '#/blog');
		await page.click('.blog-card .tag[href="#/blog?tag=poetry"]');
		await page.waitFor(() => document.querySelectorAll('.blog-card').length === 2);
		await checkListLanding('mobile topic links open on the filtered list');
		assert.equal(await page.eval(() => document.querySelector('#blog-tag-filter').value), 'poetry');
		await page.eval(() => document.getElementById('blog-tag-filter').focus());
		await page.key('ArrowDown');
		await page.waitFor(() => document.getElementById('blog-tag-filter')?.value !== 'poetry');
		assert.equal(await page.eval(() => document.activeElement.id), 'blog-tag-filter', 'keyboard topic changes retain select focus');
		await page.eval(() => {
			const select = document.getElementById('blog-tag-filter');
			select.value = 'benchmarks';
			select.dispatchEvent(new Event('change', { bubbles: true }));
		});
		await page.waitFor(() => document.querySelectorAll('.blog-card').length === 1);
		await checkListLanding('mobile topic selector keeps the list in view');
		await page.waitFor(() => Array.from(document.querySelectorAll('.blog-card')).every((card) => card.getAnimations().every((animation) => animation.playState === 'finished')));
		const returnCardTop = await page.eval(() => {
			const card = document.querySelector('.blog-card-title');
			card.scrollIntoView({ block: 'center', behavior: 'instant' });
			return card.getBoundingClientRect().top;
		});
		await page.click('.blog-card-title');
		await page.waitFor('#blogPostView[data-rendered-slug="benchmarks-we-actually-need"]');
		assert.equal(await page.eval(() => document.querySelector('.blog-back').getAttribute('href')), '#/blog?tag=benchmarks', 'Back to posts preserves the topic');
		await page.click('.blog-back');
		await page.waitFor(() => document.querySelectorAll('.blog-card').length === 1 && document.querySelector('#blog-tag-filter')?.value === 'benchmarks');
		await page.waitFor('.blog-card-title', { visible: true });
		await page.waitFor((top) => Math.abs(document.querySelector('.blog-card-title').getBoundingClientRect().top - top) < 3, { args: [returnCardTop] }).catch(async (error) => {
			error.message += ' ' + JSON.stringify({ theme, width, expected: returnCardTop, actual: await page.eval(() => ({ top: document.querySelector('.blog-card-title').getBoundingClientRect().top, scroll: scrollY, list: document.querySelector('#blogListView').getBoundingClientRect().top })) });
			throw error;
		});
		await page.click('.blog-card-title');
		await page.waitFor('#blogPostView[data-rendered-slug="benchmarks-we-actually-need"]');
		if (width === 390) assert.equal(await page.eval(() => {
			const title = document.querySelector('.blog-post-title').getBoundingClientRect();
			return title.top >= document.querySelector('.site-header').offsetHeight && title.bottom <= innerHeight;
		}), true, 'mobile article opens on its title, below the sticky header');
		assert.ok(await page.eval(() => document.querySelector('.blog-post-body').textContent.includes('Making a genuinely funny joke.')), 'public text after a Markdown comment remains visible');
		assert.equal(await page.eval(() => document.querySelector('.blog-post-body').textContent.includes('Rating sexual technique.')), false, 'commented-out fragments stay hidden');
		assert.match(await page.eval(() => document.querySelector('.blog-reading-time').textContent), /^\d+ min read$/);
		assert.equal(await page.eval(() => document.querySelectorAll('#blogPostView h1').length), 1, 'duplicate Markdown title removed');
		assert.ok(await page.eval(() => !!document.querySelector('.blog-post-nav a')));
		assert.ok(await page.eval(() => !!document.querySelector('#blogPostView .blog-tags a')));
		await page.waitFor('.blog-toc');
		await page.click('.blog-toc summary');
		const section = await page.eval(() => {
			window.qaOriginalBody = document.querySelector('.blog-post-body');
			return new URL(document.querySelector('.blog-toc a').href).hash;
		});
		const markdownBefore = page.requests.filter((r) => r.url.includes('2026-09-23-benchmarks-we-actually-need.md')).length;
		await page.click('.blog-toc a');
		await page.waitFor(() => location.hash.includes('?section=') && document.activeElement.id.startsWith('post-'));
		assert.equal(await page.eval(() => window.qaOriginalBody === document.querySelector('.blog-post-body')), true, 'heading navigation reuses the rendered article');
		assert.equal(page.requests.filter((r) => r.url.includes('2026-09-23-benchmarks-we-actually-need.md')).length, markdownBefore);
		await page.reload();
		await page.waitFor('#blogPostView[data-rendered-slug="benchmarks-we-actually-need"]');
		assert.equal(await page.eval(() => location.hash), section);
		assert.equal(await page.eval(() => document.activeElement.id), new URLSearchParams(section.split('?')[1]).get('section'));
		await page.eval(() => {
			Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.reject(new Error('denied')) } });
		});
		await page.click('.blog-copy-link');
		await page.waitFor('.blog-share-link', { visible: true });
		assert.match(await page.eval(() => document.querySelector('.blog-share-link').value), /\/writing\/benchmarks-we-actually-need\/$/);
		assert.equal(await page.eval(() => document.querySelector('.blog-article-link').getAttribute('href')), 'writing/benchmarks-we-actually-need/');
		await page.eval(() => {
			Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: (text) => { window.qaCopied = text; return Promise.resolve(); } } });
		});
		await page.click('.blog-copy-link');
		await page.waitFor(() => document.querySelector('.blog-copy-status').textContent === 'Link copied');
		assert.match(await page.eval(() => window.qaCopied), /\/writing\/benchmarks-we-actually-need\/$/);
		await page.click('.blog-post-nav a:last-child');
		await page.waitFor('#blogPostView[data-rendered-slug="latentland"]');
		if (width === 390) assert.equal(await page.eval(() => {
			const title = document.querySelector('.blog-post-title').getBoundingClientRect();
			return title.top >= document.querySelector('.site-header').offsetHeight && title.bottom <= innerHeight;
		}), true, 'mobile older/newer navigation opens on the new article title');
		await page.eval(() => { location.hash = '#/post/i-am-an-ai-loop'; });
		await page.waitFor(() => document.querySelector('.blog-load-error')?.textContent.includes('not in the published archive'));
		assert.equal(page.requests.some((r) => r.url.includes('2026-09-08-i-am-an-ai-loop.md')), false, 'unindexed files are never fetched');
		await page.eval(() => {
			const original = window.fetch;
			window.fetch = function (url, options) {
				if (String(url).includes('2026-09-23-benchmarks-we-actually-need.md')) {
					return new Promise((resolve) => setTimeout(() => {
						window.qaSlowReleased = true;
						resolve(original(url, options));
					}, 600));
				}
				return original(url, options);
			};
			location.hash = '#/post/benchmarks-we-actually-need';
		});
		await page.waitFor('.blog-loading');
		await page.eval(() => { location.hash = '#/post/the-idea-of-order-at-the-screen'; });
		await page.waitFor('#blogPostView[data-rendered-slug="the-idea-of-order-at-the-screen"]');
		await page.waitFor(() => window.qaSlowReleased);
		await page.waitNetworkIdle();
		assert.equal(await page.eval(() => document.querySelector('.blog-post-title').textContent), 'The Idea of Order at the Screen', 'late response cannot replace a newer article');
		await page.eval(() => { location.hash = '#/about'; });
		await page.waitFor('#aboutmeContent.active');
		await page.eval(() => { location.hash = '#/post/the-idea-of-order-at-the-screen'; });
		await page.waitFor('#postsContent.active');
		assert.equal(await page.eval(() => document.title), 'The Idea of Order at the Screen · Jack V. Le', 'reused article restores title after another section');
		await page.eval(() => { location.hash = '#/about'; });
		await page.reload();
		await page.eval(() => {
			const original = window.fetch;
			let fail = true;
			window.fetch = function (url, options) {
				if (fail && String(url) === 'blog/index.json') {
					fail = false;
					return Promise.resolve(new Response('', { status: 503 }));
				}
				return original(url, options);
			};
			location.hash = '#/blog';
		});
		await page.waitFor('.blog-retry');
		assert.match(await page.eval(() => document.querySelector('.blog-load-error').textContent), /could not be loaded/);
		await page.click('.blog-retry');
		await page.waitFor(() => document.querySelectorAll('.blog-card').length === 7);
		await checkListLanding('mobile retry opens on the loaded list');
		assert.equal(await page.eval(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true, 'no horizontal overflow');
		await page.screenshot(path.join(outDir, 'blog-reader-' + theme + '-' + width + '.png'));
		await page.waitFor(() => Array.from(document.querySelectorAll('.blog-card')).every((card) => card.getAnimations().every((animation) => animation.playState === 'finished')));
		const returnPosition = await page.eval(() => {
			const card = document.querySelector('.blog-card:last-child');
			card.scrollIntoView({ block: 'center' });
			document.addEventListener('click', (event) => {
				window.qaListOpeningTop = event.target.closest('.blog-card').getBoundingClientRect().top;
			}, { once: true, capture: true });
			return { slug: card.getAttribute('data-slug'), top: card.getBoundingClientRect().top };
		});
		await page.click('.blog-card:last-child .blog-card-title');
		returnPosition.top = await page.eval(() => window.qaListOpeningTop);
		await page.waitFor('#blogPostView[data-rendered-slug="' + returnPosition.slug + '"]');
		await page.click('.blog-back');
		await page.waitFor(() => document.querySelectorAll('.blog-card').length === 7);
		await page.waitFor('.blog-card-title', { visible: true });
		await page.waitFor((slug, top) => Math.abs(document.querySelector('.blog-card[data-slug="' + slug + '"]').getBoundingClientRect().top - top) < 4, { args: [returnPosition.slug, returnPosition.top] });
		const returnedTop = await page.eval((slug) => document.querySelector('.blog-card[data-slug="' + slug + '"]').getBoundingClientRect().top, returnPosition.slug);
		assert.ok(Math.abs(returnedTop - returnPosition.top) < 4, 'Back to posts restores the list position: ' + JSON.stringify({ theme, expected: returnPosition.top, actual: returnedTop, position: await page.eval(() => scrollY) }));
		await page.eval(() => {
			const original = window.fetch;
			const fixture = '# Benchmarks We Actually Need\n\n' +
				'## Repeated\n\n' + 'A published sentence about language and meaning. '.repeat(140) +
				'\n\n<!-- PRIVATE_NOTE -->\n\n## Repeated\n\nVisible after comment.\n\n## Repeated 2\n\n' +
				'[Jump](#repeated)\n\nInline `<!-- literal inline comment -->`.\n\n```html\n<!-- literal fenced comment -->\n```\n';
			window.fetch = function (url, options) {
				if (String(url).includes('2026-09-23-benchmarks-we-actually-need.md')) return Promise.resolve(new Response(fixture));
				return original(url, options);
			};
			location.hash = '#/post/benchmarks-we-actually-need';
		});
		await page.waitFor('#blogPostView[data-rendered-slug="benchmarks-we-actually-need"]');
		const headings = await page.eval(() => Array.from(document.querySelectorAll('.blog-post-body h2')).map((h) => h.id));
		assert.equal(headings.length, 3);
		assert.equal(new Set(headings).size, 3, 'repeated and naturally suffixed headings have unique IDs');
		assert.equal(await page.eval(() => document.querySelector('.blog-post-body a:not(.blog-heading-link)').getAttribute('href')), '#/post/benchmarks-we-actually-need?section=' + headings[0]);
		assert.equal(await page.eval(() => document.querySelector('.blog-post-body').textContent.includes('PRIVATE_NOTE')), false);
		assert.ok(await page.eval(() => document.querySelector('.blog-post-body').textContent.includes('Visible after comment.')));
		assert.ok(await page.eval(() => document.querySelector('.blog-post-body code').textContent.includes('<!-- literal inline comment -->')));
		assert.equal(await page.eval(() => document.querySelector('.blog-post-body pre code').textContent.trim()), '<!-- literal fenced comment -->');
		assert.deepEqual(page.errors.filter((error) => error.type === 'exception'), []);
		await page.close();
	}
}
