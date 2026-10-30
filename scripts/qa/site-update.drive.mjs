// Cross-section checks for the site update. Run with:
// node scripts/qa/drive.mjs scripts/qa/site-update.drive.mjs
import path from 'node:path';

export default async function ({ newPage, baseUrl, assert, outDir }) {
	const gadgets = JSON.stringify({ ambient: false, tilt: false, avatar: false, signature: false, now: false, navcat: false, book3d: false, eggs: false });
	for (const theme of ['light', 'dark']) {
		const page = await newPage({ width: 1280, height: 900, theme, reducedMotion: true,
			storage: { 'gadgets.v1': gadgets },
			extraAllowedHosts: ['api.open-meteo.com', 'api.github.com', 'avatars.githubusercontent.com', 'github.com', 'giscus.app'] });
		await page.goto(baseUrl + '#/about');
		assert.equal(await page.eval(() => document.querySelectorAll('.home-work').length), 3);
		assert.equal(await page.eval(() => document.querySelectorAll('#home-updates li').length), 3);
		assert.equal(await page.eval(() => document.querySelector('#home-background-copy').textContent.includes('Undergraduate researcher')), true);
		assert.equal(await page.eval(() => document.querySelector('#home-discovery').nextElementSibling.id), 'cv-glance');
		await page.eval(() => {
			window.qaRealOpen = window.open;
			window.open = (url) => { window.qaOpenedCv = url; };
			window.Palette.open();
		});
		await page.type('#palette-input', 'Academic CV');
		await page.waitFor(() => document.querySelector('.palette-item-label')?.textContent === 'Academic CV');
		await page.key('Enter');
		await page.waitFor(() => typeof window.qaOpenedCv === 'string');
		assert.equal(await page.eval(() => window.qaOpenedCv), await page.eval(() => document.querySelector('#leftPanel a[href*="JackLeCV.pdf"]').getAttribute('href')),
			'The search palette opens the same current CV as the profile link');
		await page.eval(() => { window.open = window.qaRealOpen; });
		await page.screenshot(path.join(outDir, 'update-about-' + theme + '.png'));
		for (const width of [1400, 1280, 1024, 768, 390]) {
			await page.setViewport({ width, height: 900, mobile: width < 768 });
			// Let responsive geometry and the browser's input coordinates settle.
			await page.eval(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
			if (width < 1200) {
				await page.waitFor(() => !document.querySelector('#mainNav').classList.contains('collapsing'));
				if (!await page.eval(() => document.querySelector('#mainNav').classList.contains('show'))) await page.click('.navbar-toggler');
				await page.waitFor('#mainNav.show');
				await page.click('#mainNav a[data-route="publications"]');
				await page.waitFor(() => !document.querySelector('#mainNav').classList.contains('show') && !document.querySelector('#mainNav').classList.contains('collapsing'));
			}
			for (const route of ['about', 'publications?topic=comprehension', 'blog', 'misc', 'saved']) {
				await page.eval((next) => { window.location.hash = '#/' + next; }, route);
				if (route === 'blog') await page.waitFor('.blog-card-title');
				if (route === 'saved') await page.waitFor('#saved-hub');
				await page.eval(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
				// Canvas widgets resize asynchronously when a hidden section reopens.
				await page.waitFor(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 2, { timeoutMs: 2000 });
				const overflow = await page.eval(() => ({
					page: document.documentElement.scrollWidth,
					viewport: document.documentElement.clientWidth,
					offenders: Array.from(document.querySelectorAll('body *')).filter((el) => {
						const r = el.getBoundingClientRect();
						return r.width && r.left >= 0 && r.right > document.documentElement.clientWidth + 2 && getComputedStyle(el).position !== 'fixed';
					}).slice(0, 6).map((el) => ({ name: el.tagName + '.' + el.className,
						chain: [el, el.parentElement, el.parentElement.parentElement, el.parentElement.parentElement.parentElement].map((node) => ({ class: node.className, width: node.clientWidth, style: node.getAttribute('style') })) }))
				}));
				assert.ok(overflow.page <= overflow.viewport + 2, theme + ' ' + width + ' ' + route + ': ' + JSON.stringify(overflow));
				if (width === 390) await page.screenshot(path.join(outDir, 'update-' + route.split('?')[0] + '-mobile-' + theme + '.png'));
			}
		}
		await page.setViewport({ width: 1280, height: 900, mobile: false });
		await page.eval(() => { window.location.hash = '#/publications?topic=meaning'; });
		await page.waitFor(() => document.querySelector('.publication-filter[data-topic="meaning"]').getAttribute('aria-pressed') === 'true');
		await page.screenshot(path.join(outDir, 'update-publications-' + theme + '.png'));
		await page._send('Emulation.setEmulatedMedia', { media: 'print' });
		assert.equal(await page.eval(() => Array.from(document.querySelectorAll('#publicationsContent .pub-block')).filter((el) => getComputedStyle(el).display !== 'none').length), 12);
		assert.equal(await page.eval(() => getComputedStyle(document.querySelector('#home-discovery')).display), 'none');
		assert.equal(await page.eval(() => document.querySelector('#home-background-copy').getBoundingClientRect().height > 0), true, 'Full biography prints even when its disclosure is closed');
		await page._send('Emulation.setEmulatedMedia', { media: '' });
		await page.eval(() => { window.location.hash = '#/about'; window.I18n.set('ja'); });
		await page.waitFor(() => document.documentElement.lang === 'ja');
		await page.waitFor(() => document.querySelector('.home-title').textContent.includes('人間'));
		assert.equal(await page.eval(() => document.querySelector('#home-background-copy').textContent.includes('2022年8月')), true);
		await page.eval(() => window.I18n.set('en'));
		assert.equal(await page.eval(() => document.querySelector('.home-title').textContent), 'How do humans and machines make meaning?');
		assert.deepEqual(page.errors.filter((e) => e.type === 'exception'), []);
		assert.deepEqual(page.badRequests.filter((r) => r.url.startsWith(baseUrl)), []);
		await page.close();
		console.log('Layout, About, translations and print passed: ' + theme);
	}
}
