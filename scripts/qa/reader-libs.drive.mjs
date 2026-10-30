// Lazy reader scheduling, sanitization, theme reuse, failure recovery and races.
// Run: node scripts/qa/drive.mjs scripts/qa/reader-libs.drive.mjs
const slug = 'the-idea-of-order-at-the-screen';
const post = '#/post/' + slug;
const file = '2026-10-12-the-idea-of-order-at-the-screen.md';
const fixture = [
	'## Before', 'Readable fixture.', '<!-- never public -->',
	'<img src="assets/img/favicon.svg" onerror="window.readerUnsafe=true">',
	'<script>window.readerUnsafe=true</script>',
	'```js', 'const example = "<!-- literal -->";', '```',
	'Multiline math: $x +\ny$.',
	'$$\\frac{1}{\\frac{2}{\\frac{3}{4}}}$$',
	...Array.from({ length: 20 }, () => 'A paragraph that leaves enough space to test stable heading positions.'),
	'## Target', 'Target text.', ...Array.from({ length: 30 }, () => 'More readable text below the target.'),
].join('\n\n');

export default async function ({ newPage, baseUrl, assert }) {
	const pages = [];
	const prefs = JSON.stringify({ ambient: false, tilt: false, avatar: false, signature: false, now: false, navcat: false, book3d: false, eggs: false });
	async function fresh(path = 'index.html#/about', theme = 'light') {
		const page = await newPage({ width: 1280, height: 900, theme, reducedMotion: true, storage: { 'gadgets.v1': prefs }, blockHosts: ['giscus.app'], extraAllowedHosts: ['github.com', 'avatars.githubusercontent.com'] });
		pages.push(page);
		await page.goto(baseUrl + path);
		return page;
	}
	const readerRequests = (page) => page.requests.filter((r) => /\/desk\/vendor\/(marked|dompurify|highlight|katex)\//.test(r.url));
	async function inject(page) {
		await page.eval((text, filename) => {
			const nativeFetch = window.fetch;
			window.fetch = function (url, opts) {
				if (String(url).includes(filename)) return Promise.resolve(new Response(text, { status: 200 }));
				return nativeFetch(url, opts);
			};
		}, fixture, file);
	}
	async function hold(page, key, fail = false) {
		await page.eval((resource, reject) => {
			const append = document.head.appendChild.bind(document.head);
			window.readerRelease = null;
			document.head.appendChild = function (node) {
				if (node.getAttribute('data-reader-resource') === resource && !window.readerIntercepted) {
					window.readerIntercepted = true;
					if (reject) setTimeout(() => node.onerror(new Event('error')), 0);
					else window.readerRelease = () => append(node);
					return node;
				}
				return append(node);
			};
		}, key, fail);
	}

	const home = await fresh();
	await home.click('#theme-toggle');
	for (const route of ['#/education', '#/publications', '#/blog', '#/blog?format=note', '#/about']) {
		await home.eval((hash) => { location.hash = hash; }, route);
		await home.waitFor((route) => document.querySelector('#top-nav .active')?.getAttribute('data-route') === route, { args: [route.slice(2).split('?')[0]] });
		if (route.startsWith('#/blog')) await home.waitFor(() => document.querySelector('#blogListView')?.getAttribute('aria-busy') !== 'true');
	}
	await home.eval(() => { location.hash = '#/post/i-am-an-ai-loop'; });
	await home.waitFor('.blog-load-error');
	assert.equal(readerRequests(home).length, 0, 'About, sections, lists and theme changes request no reader dependencies');
	assert.equal(await home.eval(() => !!window.marked || !!window.DOMPurify || !!window.hljs || !!window.katex), false);
	await home.close();

	const prose = await fresh('index.html' + post);
	await prose.waitFor('#blogPostView[data-rendered-slug]');
	assert.deepEqual(readerRequests(prose).map((r) => new URL(r.url).pathname).sort(), ['/desk/vendor/dompurify/purify.min.js', '/desk/vendor/marked/marked.min.js']);
	assert.ok(await prose.eval(() => document.querySelector('.blog-post-body').textContent.length > 50));
	await prose.close();

	const formatted = await fresh();
	await inject(formatted);
	await hold(formatted, 'marked');
	await formatted.eval((hash) => { location.hash = hash; }, post);
	await formatted.waitFor(() => !!window.readerRelease);
	assert.equal(await formatted.eval(() => window.ReaderLibs.ensureCore() === window.ReaderLibs.ensureCore()), true, 'Concurrent core requests share one promise');
	await formatted.eval(() => window.readerRelease());
	await formatted.waitFor('.blog-post-body pre code[data-highlighted="yes"]');
	await formatted.waitFor('.blog-post-body .katex');
	assert.equal(await formatted.eval(() => !!window.readerUnsafe || !!document.querySelector('.blog-post-body [onerror], .blog-post-body script')), false, 'Markdown is sanitized before insertion');
	assert.equal(await formatted.eval(() => document.querySelector('.blog-post-body').textContent.includes('never public')), false);
	assert.ok(await formatted.eval(() => document.querySelector('pre code').textContent.includes('<!-- literal -->')));
	assert.equal(await formatted.eval(() => document.querySelectorAll('.blog-post-body .katex').length), 2, 'Single-dollar multiline math retains existing auto-render behavior');
	for (const resource of ['marked.min.js', 'purify.min.js', 'highlight.min.js', 'katex.min.js', 'auto-render.min.js']) {
		assert.equal(readerRequests(formatted).filter((r) => r.url.endsWith('/' + resource)).length, 1, resource + ' requested once');
	}
	await formatted.click('#theme-toggle');
	await formatted.waitFor(() => document.querySelector('#hljs-theme')?.href.endsWith('github-dark.min.css') && document.querySelector('#hljs-theme').media === 'all');
	await formatted.eval(() => { location.hash = '#/about'; });
	await formatted.waitFor(() => location.hash === '#/about');
	const beforeTheme = readerRequests(formatted).length;
	await formatted.click('#theme-toggle');
	assert.equal(readerRequests(formatted).length, beforeTheme, 'Theme switch away from a reader downloads nothing');
	await formatted.eval((hash) => { location.hash = hash; }, post);
	await formatted.waitFor(() => document.querySelector('#hljs-theme')?.href.endsWith('/github.min.css') && document.querySelector('#hljs-theme').media === 'all');
	assert.equal(readerRequests(formatted).length, beforeTheme, 'Cached reader reentry reuses an already loaded theme');
	await formatted.close();

	const failure = await fresh();
	await hold(failure, 'marked', true);
	await failure.eval((hash) => { location.hash = hash; }, post);
	await failure.waitFor('.blog-load-error .blog-retry');
	assert.equal(await failure.eval(() => !!document.querySelector('.blog-post-body')), false, 'Failed sanitizer/Markdown prerequisites never insert unsanitized content');
	await failure.click('.blog-retry');
	await failure.waitFor('#blogPostView[data-rendered-slug]');
	assert.equal(readerRequests(failure).filter((r) => r.url.endsWith('/purify.min.js')).length, 1);
	await failure.close();

	const optional = await fresh();
	await inject(optional);
	await hold(optional, 'highlight', true);
	await optional.eval((hash) => { location.hash = hash; }, post);
	await optional.waitFor('.blog-format-retry');
	assert.ok(await optional.eval(() => document.querySelector('.blog-post-body').textContent.includes('Readable fixture.')), 'Optional failure leaves article readable');
	await optional.click('.blog-format-retry');
	await optional.waitFor('.blog-post-body pre code[data-highlighted="yes"]');
	await optional.waitFor('.blog-format-notice', { hidden: true });
	assert.equal(readerRequests(optional).filter((r) => r.url.endsWith('/marked.min.js')).length, 1, 'Formatting retry does not refetch core');
	await optional.close();

	const race = await fresh();
	const homeTitle = await race.eval(() => document.title);
	await hold(race, 'marked');
	await race.eval((hash) => { location.hash = hash; }, post);
	await race.waitFor(() => !!window.readerRelease);
	await race.eval(() => { location.hash = '#/about'; });
	await race.waitFor((title) => document.title === title, { args: [homeTitle] });
	const about = await race.eval(() => ({ title: document.title, scroll: scrollY }));
	await race.eval(async () => { window.readerRelease(); await window.ReaderLibs.ensureCore(); });
	assert.equal(await race.eval(() => document.title), about.title, 'Late core completion cannot overwrite the newer route title');
	assert.equal(await race.eval(() => scrollY), about.scroll, 'Late core completion cannot move the newer route');
	assert.equal(await race.eval(() => document.getElementById('blogPostView').hasAttribute('data-rendered-slug')), false);
	await race.close();

	const concurrent = await fresh();
	await hold(concurrent, 'marked');
	await concurrent.eval((hash) => { location.hash = hash; }, post);
	await concurrent.waitFor(() => !!window.readerRelease);
	await concurrent.eval(() => { location.hash = '#/post/latentland'; });
	await concurrent.waitFor(() => location.hash === '#/post/latentland' && document.querySelector('.blog-loading'));
	await concurrent.eval(() => window.readerRelease());
	await concurrent.waitFor('#blogPostView[data-rendered-slug="latentland"]');
	assert.equal(await concurrent.eval(() => document.querySelector('.blog-post-title').textContent), 'Latentland', 'Concurrent post routes render only the newest article');
	assert.equal(readerRequests(concurrent).filter((r) => r.url.endsWith('/marked.min.js')).length, 1, 'Post routes share the in-flight core load');
	await concurrent.close();

	for (const interact of [false, true]) {
		const heading = await fresh();
		await inject(heading);
		await hold(heading, 'katex');
		await heading.eval((hash) => { location.hash = hash + '?section=post-the-idea-of-order-at-the-screen-target'; }, post);
		await heading.waitFor('#blogPostView[data-rendered-slug]');
		await heading.waitFor(() => !!window.readerRelease);
		if (interact) await heading.eval(() => { window.dispatchEvent(new WheelEvent('wheel')); scrollTo(0, 250); });
		await heading.eval(() => window.readerRelease());
		await heading.waitFor('.blog-post-body .katex');
		if (interact) assert.equal(await heading.eval(() => scrollY), 250, 'Late math respects visitor scrolling');
		else await heading.waitFor(() => Math.abs(document.getElementById('post-the-idea-of-order-at-the-screen-target').getBoundingClientRect().top - parseFloat(getComputedStyle(document.getElementById('post-the-idea-of-order-at-the-screen-target')).scrollMarginTop)) < 2);
		await heading.eval(() => { scrollTo(0, 350); document.getElementById('theme-toggle').click(); });
		await heading.waitFor(() => document.querySelector('#hljs-theme')?.href.endsWith('github-dark.min.css') && document.querySelector('#hljs-theme').media === 'all');
		assert.equal(await heading.eval(() => scrollY), 350, 'Theme changes preserve reading position away from a permalink');
		await heading.close();
	}

	const standalone = await fresh('writing/benchmarks-we-actually-need/', 'dark');
	await standalone.click('.article-theme');
	assert.equal(readerRequests(standalone).length, 0, 'Static prose needs neither core nor optional formatting libraries');
	await standalone.eval(() => {
		document.querySelector('.article-body').insertAdjacentHTML('afterbegin', '<pre><code class="language-js">const x = 1;</code></pre><p>$x +\ny$</p>');
	});
	await standalone.click('.article-theme');
	await standalone.waitFor('.article-body pre code[data-highlighted="yes"]');
	await standalone.waitFor('.article-body .katex');
	assert.equal(readerRequests(standalone).some((r) => /\/(marked|dompurify)\//.test(r.url)), false, 'Static enhancements never download Markdown/sanitizer');
	assert.equal(await standalone.eval(() => document.querySelector('#hljs-theme').href.endsWith('github-dark.min.css')), true);
	await standalone.eval(() => { location.hash = document.querySelector('.article-body h2').id; });
	await standalone.waitFor(() => !!location.hash);
	await standalone.eval(() => { scrollTo(0, 350); document.querySelector('.article-theme').click(); });
	await standalone.waitFor(() => document.querySelector('#hljs-theme')?.href.endsWith('/github.min.css') && document.querySelector('#hljs-theme').media === 'all');
	assert.equal(await standalone.eval(() => scrollY), 350, 'Static theme changes preserve reading position away from a heading');
	await standalone.close();
	for (const page of pages) assert.deepEqual(page.errors, [], 'No uncaught errors or unhandled promise failures');
	console.log('Reader libraries: zero home/list requests, local core/optional loads, dedupe, theme, sanitized output, retries, stale navigation and stable headings passed');
}
