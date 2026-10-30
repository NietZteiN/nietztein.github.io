// Run: node scripts/qa/drive.mjs scripts/qa/writing.drive.mjs
// Real article URLs, static content, XML discovery, native navigation and print.
import path from 'node:path';

export default async function ({ newPage, baseUrl, assert, outDir }) {
	const metadata = await newPage({ width: 1280, height: 900 });
	await metadata.goto(baseUrl + 'writing/benchmarks-we-actually-need/');
	const discovery = await metadata.eval(async () => {
		const posts = await (await fetch('/blog/index.json')).json();
		const parser = new DOMParser();
		const feed = parser.parseFromString(await (await fetch('/feed.xml')).text(), 'application/xml');
		const sitemap = parser.parseFromString(await (await fetch('/sitemap.xml')).text(), 'application/xml');
		const pages = [];
		for (const post of posts) {
			const response = await fetch('/writing/' + encodeURIComponent(post.slug) + '/');
			const html = parser.parseFromString(await response.text(), 'text/html');
			pages.push({ status: response.status, slug: post.slug, title: html.querySelector('title')?.textContent,
				canonical: html.querySelector('link[rel="canonical"]')?.href,
				og: html.querySelector('meta[property="og:title"]')?.content,
				description: html.querySelector('meta[name="description"]')?.content,
				body: html.querySelector('.article-body')?.textContent,
				schema: JSON.parse(html.querySelector('script[type="application/ld+json"]')?.textContent || '{}') });
		}
		return { posts, pages, feedErrors: feed.querySelectorAll('parsererror').length,
			sitemapErrors: sitemap.querySelectorAll('parsererror').length,
			feed: Array.from(feed.querySelectorAll('item')).map((item) => ({
				title: item.querySelector('title').textContent, link: item.querySelector('link').textContent,
				guid: item.querySelector('guid').textContent, date: item.querySelector('pubDate').textContent })),
			sitemap: Array.from(sitemap.querySelectorAll('loc')).map((item) => item.textContent) };
	});
	assert.equal(discovery.feedErrors + discovery.sitemapErrors, 0, 'RSS and sitemap are well-formed XML');
	assert.equal(discovery.feed.length, discovery.posts.length);
	assert.equal(discovery.sitemap.length, discovery.posts.length + 1);
	for (const page of discovery.pages) {
		const post = discovery.posts.find((item) => item.slug === page.slug);
		const canonical = 'https://nietztein.github.io/writing/' + encodeURIComponent(post.slug) + '/';
		assert.equal(page.status, 200);
		assert.equal(page.title, post.title + ' · Jack V. Le');
		assert.equal(page.canonical, canonical);
		assert.equal(page.og, post.title);
		assert.equal(page.description, post.summary);
		assert.equal(page.schema.url, canonical);
		assert.ok(page.body.trim().length > 40, 'Readable article content exists in the delivered HTML');
		assert.ok(discovery.sitemap.includes(canonical));
		const item = discovery.feed.find((entry) => entry.link === canonical);
		assert.equal(item?.guid, canonical);
		assert.equal(item.title, post.title);
		assert.ok(Number.isFinite(Date.parse(item.date)));
	}
	assert.equal(discovery.pages.some((page) => page.slug === 'i-am-an-ai-loop'), false, 'Untracked writing stays out of public pages');
	await metadata.close();
	for (const [theme, width] of [['light', 1280], ['dark', 390]]) {
		const page = await newPage({ theme, width, height: 900, mobile: width < 600, reducedMotion: true });
		await page.goto(baseUrl + 'writing/benchmarks-we-actually-need/');
		await page.waitFor('[data-article-slug] .connections-article');
		assert.equal(await page.eval(() => document.documentElement.dataset.theme), theme);
		assert.ok(await page.eval(() => document.querySelector('.article-body').textContent.includes('Making a genuinely funny joke.')));
		assert.equal(await page.eval(() => document.querySelector('.article-body').textContent.includes('Rating sexual technique.')), false);
		assert.equal(await page.eval(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), true);
		await page.click('.article-theme');
		assert.equal(await page.eval(() => document.documentElement.dataset.theme), theme === 'light' ? 'dark' : 'light');
		await page.click('.article-theme');
		await page.eval(() => Object.defineProperty(navigator, 'clipboard', { configurable: true,
			value: { writeText: (text) => { window.qaArticleCopied = text; return Promise.resolve(); } } }));
		await page.click('.article-copy');
		await page.waitFor(() => document.querySelector('.article-share [role="status"]').textContent === 'Link copied');
		assert.equal(await page.eval(() => window.qaArticleCopied), baseUrl + 'writing/benchmarks-we-actually-need/');
		await page.click('.article-contents summary');
		await page.click('.article-contents a');
		assert.equal(await page.eval(() => location.hash), '#post-benchmarks-we-actually-need-ideas');
		await page.eval(() => window.scrollTo(0, 0));
		await page.screenshot(path.join(outDir, 'writing-' + theme + '-' + width + '.png'));
		await page._send('Emulation.setEmulatedMedia', { media: 'print' });
		assert.equal(await page.eval(() => getComputedStyle(document.querySelector('.article-header')).display), 'none');
		assert.equal(await page.eval(() => document.querySelector('.article-body').getBoundingClientRect().height > 0), true);
		assert.deepEqual(page.errors.filter((error) => error.type === 'exception'), []);
		assert.deepEqual(page.badRequests.filter((request) => request.url.startsWith(baseUrl)), []);
		await page.close();
	}
	const plain = await newPage({ width: 390, height: 844 });
	await plain._send('Emulation.setScriptExecutionDisabled', { value: true });
	await plain.goto(baseUrl + 'writing/the-idea-of-order-at-the-screen/');
	assert.ok(await plain.eval(() => document.querySelector('.article-body').textContent.includes('She asked for something bluer than the sea.')),
		'The article remains readable with JavaScript disabled');
	await plain.close();
}
