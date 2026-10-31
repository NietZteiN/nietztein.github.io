// Shell regression: explicit navigation wins pending search, accessible sort,
// stable disclosure destinations, and phone sheet focus/return.
import path from 'node:path';

export default async function ({ newPage, baseUrl, assert, outDir }) {
	for (const theme of ['light', 'dark']) for (const width of [1440, 1024, 390]) {
		const page = await newPage({ width, height: 900, mobile: width < 761, theme, reducedMotion: true });
		await page.goto(baseUrl + 'misc/101-true-shuffle/?demo=1');
		await page.waitFor('.ts-home-start');
		if (width > 760) {
			assert.equal(await page.eval(() => document.querySelectorAll('#nav > li > a').length), 9, 'Listening, discovery shelf, library and Settings remain directly available');
			await page.click('#nav .ts-nav-group summary');
			await page.click('#nav a[href="#/genres"]');
			await page.waitFor(() => document.querySelector('#nav a[href="#/genres"]').getAttribute('aria-current') === 'page');
			assert.equal(await page.eval(() => document.querySelector('#nav a[href="#/genres"]').closest('details').open), true);
		}
		await page.eval(() => {
			const input = document.querySelector('#search'); input.focus(); input.value = 'stale query';
			input.dispatchEvent(new Event('input', { bubbles: true })); location.hash = '#/songs';
		});
		await page.waitFor('.ts-row');
		await page.eval(() => new Promise(resolve => setTimeout(resolve, 240)));
		assert.equal(await page.eval(() => location.hash), '#/songs', 'Explicit navigation cancels pending search');
		async function search(value) {
			await page.eval(value => {
				const input = document.querySelector('#search'); input.focus(); input.value = value;
				input.dispatchEvent(new Event('input', { bubbles: true }));
			}, value);
			await page.waitFor(value => location.hash === '#/search?q=' + value && document.querySelector('#view h1')?.textContent.includes(value), { args: [value] });
			assert.equal(await page.eval(() => document.title.startsWith(document.querySelector('#view h1').textContent)), true);
			assert.equal(await page.eval(() => document.activeElement.id), 'search');
		}
		await search('a');
		await page.eval(() => { document.querySelector('#main').scrollTop = 800; });
		assert.ok(await page.eval(() => document.querySelector('#main').scrollTop) > 0);
		await search('e');
		assert.equal(await page.eval(() => document.querySelector('#main').scrollTop), 0, 'Changed search reveals the new results');
		await page.eval(() => { location.hash = '#/songs'; document.querySelector('#search').blur(); });
		await page.waitFor('.ts-row');
		if (width > 760) {
			assert.equal(await page.eval(() => document.querySelector('.ts-th[data-sort-key="title"]').closest('[aria-hidden="true"]')), null);
			await page.eval(() => document.querySelector('.ts-th[data-sort-key="title"]').focus());
			await page.key('Enter');
			await page.waitFor(() => document.querySelector('.ts-th[data-sort-key="title"]').getAttribute('aria-pressed') === 'true');
			assert.equal(await page.eval(() => document.activeElement.dataset.sortKey), 'title');
			await page.key('Enter');
			await page.waitFor(() => document.querySelector('.ts-th[data-sort-key="title"]').classList.contains('is-reversed'));
			assert.equal(await page.eval(() => document.activeElement.dataset.sortKey), 'title');
		} else {
			await page.click('#tabbar [aria-label="Queue"]');
			await page.waitFor(() => document.activeElement.id === 'sheet-close');
			assert.equal(await page.eval(() => document.querySelector('#main').inert), true);
			await page.key('Escape');
			await page.waitFor(() => !document.body.classList.contains('sheet-open'));
			assert.equal(await page.eval(() => document.activeElement.getAttribute('aria-label')), 'Queue');
			assert.equal(await page.eval(() => document.querySelector('#main').inert), false);
		}
		assert.equal(await page.eval(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), true);
		await page.screenshot(path.join(outDir, 'shuffle-shell-' + theme + '-' + width + '.png'));
		assert.deepEqual(page.errors, []); assert.deepEqual(page.externalHosts, []);
		await page.close();
	}
}
