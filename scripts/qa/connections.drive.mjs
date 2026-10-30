// Run: node scripts/qa/drive.mjs scripts/qa/connections.drive.mjs
// Cross-media links, public targets, static pages, stale routes and optional-data failure.
import fs from 'node:fs';
import path from 'node:path';

export default async function ({ newPage, baseUrl, assert, outDir, root }) {
	const publications = JSON.parse(fs.readFileSync(path.join(root, 'assets/data/publications.json'), 'utf8'));
	const researchId = 'do-machines-struggle-where-humans-do-obfuscation-as-a-probe-of-human-and-machine-code-comprehension';
	const gadgets = JSON.stringify({ ambient: false, tilt: false, avatar: false, signature: false, now: false, navcat: false, book3d: false, eggs: false });
	for (const theme of ['light', 'dark']) {
		for (const width of [1280, 390]) {
			const page = await newPage({ width, height: 900, theme, mobile: width < 600, reducedMotion: true, storage: { 'gadgets.v1': gadgets },
				extraAllowedHosts: ['github.com', 'avatars.githubusercontent.com', 'giscus.app'] });
			await page.goto(baseUrl + '#/about');
			assert.equal(page.requests.some((request) => request.url.endsWith('/assets/data/connections.json')), false, 'Discovery data stays lazy on the homepage');
			await page.goto(baseUrl + '#/publications?topic=comprehension');
			await page.waitFor('.connections-publication');
			assert.equal(await page.eval(() => document.querySelectorAll('.connections-publication').length), 8);
			assert.deepEqual(await page.eval(() => Array.from(document.querySelectorAll('#publicationsContent .pub-block .lucida-console.h5')).map((item) => item.textContent.replace(/\s+/g, ' ').trim())), publications.map((paper) => paper.title), 'Source titles and map/palette selectors stay intact');
			assert.equal(await page.eval(() => document.querySelectorAll('#publicationsContent .pub-block').length), 12);
			await page.click('.connections-publication a[href*="#/post/benchmarks-we-actually-need"]');
			await page.waitFor('#blogPostView[data-rendered-slug="benchmarks-we-actually-need"] .connections-article');
			assert.equal(await page.eval(() => document.querySelectorAll('#blogPostView .connections-article').length), 1);
			assert.equal(await page.eval(() => document.querySelectorAll('#blogPostView .connections-article a').length), 3);
			assert.equal(await page.eval(() => document.querySelectorAll('#blogPostView .connections-article a[href*="#/post/"]').length), 0, 'Cross-media suggestions do not duplicate the existing related-writing footer');
			assert.equal(await page.eval(() => document.querySelector('.blog-reading-footer').previousElementSibling.classList.contains('connections-article')), true);
			assert.equal(await page.eval(() => Array.from(document.querySelectorAll('.content-connections a')).every((a) => a.href.startsWith(location.origin + '/'))), true);
			await page.click('#blogPostView .connections-article a[href*="paper="]');
			await page.waitFor((id) => location.hash === '#/publications?paper=' + id && document.activeElement.textContent.replace(/\s+/g, ' ').trim().startsWith('Do Machines Struggle'), { args: [researchId] });
			assert.equal(await page.eval((id) => document.querySelector('[data-publication-id="' + id + '"]').hidden, researchId), false);
			await page.eval(() => { location.hash = '#/publications'; });
			await page.eval(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
			await page.eval((id) => { document.activeElement.blur(); location.hash = '#/publications?paper=' + id; }, researchId);
			await page.waitFor(() => document.activeElement.classList.contains('h5'));
			assert.equal(await page.eval(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), false);
			await page.screenshot(path.join(outDir, 'connections-publications-' + theme + '-' + width + '.png'));
			await page.eval(() => { location.hash = '#/post/latentland'; });
			await page.waitFor('#blogPostView[data-rendered-slug="latentland"] .connections-article');
			await page.eval(async () => {
				var host = document.getElementById('blogPostView');
				host.querySelector('.connections-article').remove();
				var pending = window.Connections.renderPost(host, 'latentland');
				location.hash = '#/about';
				await pending;
			});
			assert.equal(await page.eval(() => document.querySelectorAll('#blogPostView .connections-article').length), 0, 'A stale article request cannot add links after navigation');
			await page.eval(() => { location.hash = '#/post/latentland'; });
			await page.waitFor('#blogPostView .connections-article');
			await page.eval(() => document.querySelector('#blogPostView .connections-article').scrollIntoView({ block: 'center', behavior: 'instant' }));
			await page.screenshot(path.join(outDir, 'connections-article-' + theme + '-' + width + '.png'));
			await page._send('Emulation.setEmulatedMedia', { media: 'print' });
			assert.equal(await page.eval(() => Array.from(document.querySelectorAll('.content-connections')).every((box) => getComputedStyle(box).display === 'none')), true);
			assert.equal(await page.eval(() => Array.from(document.querySelectorAll('#publicationsContent .pub-block')).filter((box) => getComputedStyle(box).display !== 'none').length), 12);
			assert.deepEqual(page.errors.filter((error) => error.type === 'exception'), []);
			assert.deepEqual(page.badRequests.filter((request) => request.url.startsWith(baseUrl)), []);
			await page.close();
		}
	}
	const unavailable = await newPage({ width: 390, height: 844, reducedMotion: true, storage: { 'gadgets.v1': gadgets } });
	await unavailable._send('Page.addScriptToEvaluateOnNewDocument', { source: `
		var originalFetch = window.fetch;
		window.fetch = function (url) {
			if (String(url).indexOf('assets/data/connections.json') !== -1) return Promise.reject(new Error('Optional data unavailable'));
			return originalFetch.apply(this, arguments);
		};
	` });
	await unavailable.goto(baseUrl + '#/post/latentland');
	await unavailable.waitFor('.blog-post-title');
	assert.equal(await unavailable.eval(() => document.querySelectorAll('.content-connections').length), 0);
	assert.equal(await unavailable.eval(() => document.querySelector('.blog-post-title').textContent), 'Latentland');
	assert.deepEqual(unavailable.errors.filter((error) => error.type === 'exception'), []);
	await unavailable.close();
	const sharePath = path.join(root, 'writing/latentland/index.html');
	if (fs.existsSync(sharePath)) {
		const article = await newPage({ width: 390, height: 844, theme: 'dark', reducedMotion: true });
		await article.goto(baseUrl + 'writing/latentland/');
		await article.waitFor('[data-article-slug="latentland"] .connections-article');
		assert.equal(await article.eval(() => document.querySelectorAll('.connections-article a').length), 3);
		assert.equal(await article.eval(() => Array.from(document.querySelectorAll('.connections-article a')).every((a) => a.href.startsWith(location.origin + '/misc/') || a.href.startsWith(location.origin + '/#/publications?paper='))), true, 'Nested share pages use site-root destinations');
		assert.deepEqual(article.badRequests.filter((request) => request.url.startsWith(baseUrl)), []);
		assert.deepEqual(article.errors.filter((error) => error.type === 'exception'), []);
		await article.close();
		console.log('Generated article connections passed.');
	} else console.log('Generated article case deferred until writing pages are built.');
}
