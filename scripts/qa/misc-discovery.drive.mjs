// Run: node scripts/qa/drive.mjs scripts/qa/misc-discovery.drive.mjs
// Exercises visitor state and native links; no live service writes.
import path from 'node:path';

export default async function ({ newPage, baseUrl, assert, outDir }) {
	for (const [theme, width] of [['light', 1280], ['dark', 390]]) {
		const page = await newPage({ width, height: 860, mobile: width < 600, theme, reducedMotion: true,
			storage: { 'misc.favorites.v1': '[]', 'misc.recent.v1': '{"wrong":true}' } });
		await page.goto(baseUrl + '#/misc');
		await page.waitFor('.misc-favorite');
		const total = await page.eval(() => document.querySelectorAll('#miscContent .misc-grid .misc-card').length);
		assert.equal(await page.eval(() => document.querySelectorAll('.misc-entry:not([hidden])').length), total);
		assert.equal(await page.eval(() => document.querySelectorAll('.misc-featured-link').length), 3);
		assert.equal(await page.eval(() => !!document.querySelector('.misc-card button, .misc-card a')), false, 'native card anchors cannot contain other controls');
		const originalOrder = await page.eval(() => Array.from(document.querySelector('.misc-grid').children).map(el => el.classList.contains('misc-group-h') ? 'heading:' + el.dataset.group : el.querySelector('.misc-card').getAttribute('href')));

		await page.click('.misc-entry .misc-favorite');
		const saved = await page.eval(() => JSON.parse(localStorage.getItem('misc.favorites.v1')));
		assert.equal(saved.length, 1);
		await page.click('[data-scope="favorites"]');
		assert.equal(await page.eval(() => document.querySelectorAll('.misc-entry:not([hidden])').length), 1);
		await page.waitFor(() => location.hash.includes('scope=favorites'));
		await page.reload();
		assert.equal(await page.eval(() => document.querySelectorAll('.misc-entry:not([hidden])').length), 1, 'favorites persist through reload');
		await page.click('.misc-entry:not([hidden]) .misc-favorite');
		assert.equal(await page.eval(() => document.querySelectorAll('.misc-entry:not([hidden])').length), 0);
		assert.equal(await page.eval(() => document.activeElement.getAttribute('data-scope')), 'favorites', 'removing last favorite keeps focus visible');
		assert.match(await page.eval(() => document.querySelector('.misc-empty-text').textContent), /No favorites/);
		await page.click('.misc-clear');

		await page.click('.misc-featured-link', { button: 'middle' });
		assert.equal(await page.eval(() => JSON.parse(localStorage.getItem('misc.recent.v1')).length), 1, 'middle click records the opening');
		await page.click('.misc-entry .misc-card');
		assert.equal(await page.eval(() => JSON.parse(localStorage.getItem('misc.recent.v1')).length), 2, 'primary click records another toy');
		await page.click('[data-scope="recent"]');
		assert.equal(await page.eval(() => document.querySelectorAll('.misc-entry:not([hidden])').length), 2);
		assert.equal(await page.eval(() => document.querySelector('.misc-sort').value), 'recent');
		const recentOrder = await page.eval(() => Array.from(document.querySelectorAll('.misc-entry:not([hidden]) .misc-card')).map(el => el.getAttribute('href').split('/')[1]));
		assert.deepEqual(recentOrder, await page.eval(() => JSON.parse(localStorage.getItem('misc.recent.v1'))));

		await page.eval(() => { location.hash = '#/about'; });
		await page.waitFor('#aboutmeContent.active');
		await page.click('.home-work[href="misc/07-grokking-microscope/"]', { button: 'middle' });
		assert.equal(await page.eval(() => JSON.parse(localStorage.getItem('misc.recent.v1'))[0]), '07-grokking-microscope', 'homepage native links record an opening');
		await page.eval(() => { window.Palette.open(); });
		await page.type('#palette-input', 'Spectrogram Painter');
		await page.waitFor(() => document.querySelector('.palette-item-label') && document.querySelector('.palette-item-label').textContent === 'Spectrogram Painter');
		await page.key('Enter');
		await page.waitFor(() => JSON.parse(localStorage.getItem('misc.recent.v1'))[0] === '41-spectrogram-painter');
		assert.equal(await page.eval(() => window.Misc.recordOpen('https://example.com/misc/07-grokking-microscope/')), false, 'external URLs do not enter local history');
		await page.eval(() => { location.hash = '#/misc?scope=recent'; });
		await page.waitFor(() => document.querySelectorAll('.misc-entry:not([hidden])').length === 4);
		const integratedRecent = await page.eval(() => JSON.parse(localStorage.getItem('misc.recent.v1')));
		assert.deepEqual(integratedRecent.slice(0, 2), ['41-spectrogram-painter', '07-grokking-microscope']);
		assert.equal(new Set(integratedRecent).size, integratedRecent.length, 'openings are recorded without duplicate entries');

		await page.click('[data-scope="all"]');
		await page.eval(() => { const select = document.querySelector('.misc-sort'); select.value = 'newest'; select.dispatchEvent(new Event('change', { bubbles: true })); });
		const dates = await page.eval(() => Array.from(document.querySelectorAll('.misc-entry .misc-card')).map(el => el.dataset.added || ''));
		assert.deepEqual(dates, dates.slice().sort().reverse(), 'newest order is reflected in the DOM');
		assert.equal(await page.eval(() => document.querySelectorAll('.misc-group-h:not([hidden])').length), 0);
		await page.eval(() => { const select = document.querySelector('.misc-sort'); select.value = 'grouped'; select.dispatchEvent(new Event('change', { bubbles: true })); });
		const restoredOrder = await page.eval(() => Array.from(document.querySelector('.misc-grid').children).map(el => el.classList.contains('misc-group-h') ? 'heading:' + el.dataset.group : el.querySelector('.misc-card').getAttribute('href')));
		assert.deepEqual(restoredOrder, originalOrder, 'returning to grouped restores heading and card DOM order');

		await page.eval(() => { location.hash = '#/misc?g=ml&q=grok&sort=newest'; });
		await page.waitFor(() => document.querySelector('.misc-filter').value === 'grok');
		assert.equal(await page.eval(() => document.querySelectorAll('.misc-entry:not([hidden])').length), 1);
		assert.match(await page.eval(() => document.querySelector('.misc-entry:not([hidden]) .misc-title').textContent), /Grokking/i);
		await page.eval(() => { const filter = document.querySelector('.misc-filter'); filter.value = 'no-such-toy-xyz'; filter.dispatchEvent(new Event('input', { bubbles: true })); });
		await page.waitFor(() => location.hash.includes('no-such-toy-xyz'));
		await page.eval(() => document.querySelector('.misc-clear').focus());
		await page.key('Enter');
		await page.waitFor(() => document.querySelector('.misc-filter').value === '' && location.hash === '#/misc');
		await page.eval(() => {
			localStorage.setItem('misc.favorites.v1', JSON.stringify(['07-grokking-microscope']));
			dispatchEvent(new StorageEvent('storage', { key: 'misc.favorites.v1' }));
		});
		assert.equal(await page.eval(() => document.querySelector('.misc-saved-count').textContent), '1', 'other-tab storage updates refresh favorites');
		await page.eval(() => document.querySelector('[data-scope="favorites"]').focus());
		await page.key('Enter');
		await page.waitFor(() => location.hash.includes('scope=favorites'));
		assert.match(await page.eval(() => {
			const title = document.querySelector('.misc-entry:not([hidden]) .misc-title');
			return title ? title.textContent : JSON.stringify({ hash: location.hash, input: document.querySelector('.misc-filter').value,
				groups: Array.from(document.querySelectorAll('[data-group][aria-pressed="true"]')).map(el => el.dataset.group),
				scope: document.querySelector('[data-scope][aria-pressed="true"]').dataset.scope,
				favorites: localStorage.getItem('misc.favorites.v1') });
		}), /Grokking/i);
		await page.click('[data-density="compact"]');
		assert.equal(await page.eval(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), true, 'no horizontal overflow');
		await page.screenshot(path.join(outDir, 'misc-discovery-' + theme + '-' + width + '.png'));
		await page.eval(() => { Storage.prototype.setItem = function () { throw new Error('Storage disabled for this check'); }; });
		await page.click('.misc-entry:not([hidden]) .misc-favorite');
		assert.match(await page.eval(() => document.querySelector('.misc-local-note').textContent), /storage is unavailable/i);
		assert.equal(await page.eval(() => document.querySelectorAll('.misc-entry:not([hidden])').length), 0, 'favorites remain usable with unavailable storage');
		assert.deepEqual(page.errors.filter(error => error.type === 'exception'), []);
		await page.close();
	}
	console.log('Misc discovery: favorites, recent links, URL filters, sorting and grouped DOM, storage updates, mobile and both themes passed.');
}
