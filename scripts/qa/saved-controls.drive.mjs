// Run: node scripts/qa/drive.mjs scripts/qa/saved-controls.drive.mjs
// Uses disposable local storage; checks native controls and the legacy bridges.
import path from 'node:path';

export default async function ({ newPage, baseUrl, assert, outDir }) {
	const bookId = 'A-A2-05', originalNote = 'Keep this exact note: <text> & punctuation.';
	for (const [theme, width] of [['light', 1280], ['dark', 390]]) {
		const page = await newPage({ theme, width, height: 900, mobile: width < 600, reducedMotion: true, storage: {
			'misc.favorites.v1': JSON.stringify(['07-grokking-microscope', '45-reading-room']),
			'bookshelf.reading-list.v1': JSON.stringify({ version: 1, items: [{ id: bookId, note: originalNote, addedAt: '2026-10-01T00:00:00.000Z' }] })
		} });
		const waitCount = () => page.waitFor(() => document.querySelector('[data-saved-count]').textContent === String(window.SavedStore.snapshot().length));
		await page.goto(baseUrl + '#/publications');
		await page.waitFor('.publication-actions .saved-control');
		assert.equal(await page.eval(() => document.querySelectorAll('#publicationsContent .saved-control').length), 12);
		await page.click('.publication-actions .saved-control');
		assert.equal(await page.eval(() => document.activeElement.className), 'saved-control');
		assert.equal(await page.eval(() => document.querySelector('.publication-actions .saved-control').getAttribute('aria-pressed')), 'true');
		await waitCount();
		await page.eval(() => { location.hash = '#/blog'; });
		await page.waitFor('.blog-card[data-slug="latentland"] .saved-control');
		await page.click('.blog-card[data-slug="latentland"] .saved-control');
		assert.equal(await page.eval(() => location.hash), '#/blog', 'Save stays above the stretched native card link');
		assert.equal(await page.eval(() => window.SavedStore.has('post', 'latentland')), true);
		await waitCount();
		const changes = await page.eval(async () => {
			await new Promise(resolve => setTimeout(resolve, 100));
			let count = 0; const observer = new MutationObserver(records => { count += records.length; });
			observer.observe(document.querySelector('.blog-card[data-slug="latentland"]'), { childList: true, subtree: true });
			await new Promise(resolve => setTimeout(resolve, 250)); observer.disconnect(); return count;
		});
		assert.equal(changes, 0, 'saved controls settle without a MutationObserver rendering loop');
		await page.screenshot(path.join(outDir, 'saved-blog-' + theme + '-' + width + '.png'));
		await page.click('.blog-card[data-slug="latentland"] .blog-card-title');
		await page.waitFor('#blogPostView[data-rendered-slug="latentland"] .saved-control');
		assert.equal(await page.eval(() => document.querySelector('#blogPostView .saved-control').getAttribute('aria-pressed')), 'true');
		await page.click('#blogPostView .saved-control');
		assert.equal(await page.eval(() => window.SavedStore.has('post', 'latentland')), false);
		await page.key('Enter');
		assert.equal(await page.eval(() => window.SavedStore.has('post', 'latentland')), true, 'focused save button supports keyboard toggling');
		await page.eval(() => {
			const fake = document.createElement('article'); fake.id = 'private-save-probe'; fake.setAttribute('data-article-slug', 'i-am-an-ai-loop'); document.body.appendChild(fake);
			document.dispatchEvent(new CustomEvent('blog:render', { detail: { host: fake, slug: 'i-am-an-ai-loop' } }));
		});
		await page.eval(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
		assert.equal(await page.eval(() => !!document.querySelector('#private-save-probe .saved-control')), false, 'unknown/untracked posts never receive controls');

		await page.eval(() => { location.hash = '#/misc'; });
		await page.waitFor('#miscContent.active');
		await page.eval(async () => { await Promise.all(document.querySelector('#miscContent').getAnimations({ subtree: true }).filter(animation => animation.effect.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {}))); });
		await page.waitFor('.misc-favorite[data-slug="07-grokking-microscope"]');
		assert.equal(await page.eval(() => document.querySelector('.misc-saved-count').textContent), '1', 'Misc counts only its grid favorites');
		await page.click('.misc-favorite[data-slug="07-grokking-microscope"]');
		assert.equal(await page.eval(() => window.SavedStore.has('experiment', '07-grokking-microscope')), false);
		assert.equal(await page.eval(() => JSON.parse(localStorage.getItem('misc.favorites.v1')).includes('45-reading-room')), true, 'views-only favorites survive a Misc write');
		await waitCount();
		await page.click('.misc-favorite[data-slug="07-grokking-microscope"]');
		assert.equal(await page.eval(() => window.SavedStore.has('experiment', '07-grokking-microscope')), true);
		await page.eval(() => { location.hash = '#/saved'; });
		await page.waitFor('#saved-list .saved-item[data-kind="book"]');
		await page.click('#saved-list .saved-item[data-kind="book"] .saved-remove');
		assert.equal(await page.eval(() => window.SavedStore.has('book', 'A-A2-05')), false);
		await page.click('#saved-undo');
		assert.equal(await page.eval(() => window.SavedStore.get('book', 'A-A2-05').note), originalNote, 'hub Undo preserves the original book note');
		await page.click('#saved-list .saved-item[data-kind="experiment"][data-id="07-grokking-microscope"] .saved-remove');
		await page.eval(() => { location.hash = '#/misc'; });
		await page.waitFor(() => document.querySelector('.misc-favorite[data-slug="07-grokking-microscope"]').getAttribute('aria-pressed') === 'false');
		assert.equal(await page.eval(() => document.querySelector('.misc-saved-count').textContent), '0');

		await page.eval(() => { location.hash = '#/bookshelf'; });
		await page.waitFor('#reading-shelf');
		await page.click('.rs-your-list summary');
		assert.equal(await page.eval(() => document.querySelector('.rs-note').value), originalNote);
		await page.eval(() => { const note = document.querySelector('.rs-note'); note.focus(); note.setSelectionRange(3, 3); });
		await page.eval(async () => {
			const frame = document.createElement('iframe'); frame.hidden = true; document.body.appendChild(frame);
			const data = JSON.parse(localStorage.getItem('bookshelf.reading-list.v1'));
			data.items.push({ id: 'A-A1-10', note: 'Added in another document', addedAt: '2026-10-02T00:00:00.000Z' });
			frame.contentWindow.localStorage.setItem('bookshelf.reading-list.v1', JSON.stringify(data));
			await new Promise(resolve => setTimeout(resolve, 100)); frame.remove();
		});
		await page.waitFor(() => document.querySelector('.rs-list-count').textContent === '2');
		assert.equal(await page.eval(() => document.querySelector('.rs-note').value), originalNote, 'external collection changes preserve existing notes');
		assert.equal(await page.eval(() => document.activeElement.className), 'rs-note', 'external changes retain editor focus');
		assert.equal(await page.eval(() => document.activeElement.selectionStart), 3);
		await page.type('.rs-note', ' latest');
		assert.equal(await page.eval(() => window.SavedStore.get('book', 'A-A2-05').note), originalNote.slice(0, 3) + ' latest' + originalNote.slice(3));
		assert.equal(await page.eval(() => window.SavedStore.get('book', 'A-A1-10').note), 'Added in another document');
		await waitCount();
		assert.equal(await page.eval(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), true);
		await page.screenshot(path.join(outDir, 'saved-controls-' + theme + '-' + width + '.png'));
		assert.deepEqual(page.errors.filter(error => error.type === 'exception'), []);
		await page.close();
	}
	const article = await newPage({ theme: 'dark', width: 390, height: 844, mobile: true, reducedMotion: true });
	await article.goto(baseUrl + 'writing/latentland/');
	await article.waitFor('[data-article-slug] .saved-control');
	await article.click('.saved-control');
	assert.equal(await article.eval(() => window.SavedStore.has('post', 'latentland')), true);
	assert.equal(await article.eval(() => document.querySelector('.saved-hub-link').href), baseUrl + '#/saved', 'standalone reader links to root Saved hub');
	await article.screenshot(path.join(outDir, 'saved-article-dark-390.png'));
	assert.equal(await article.eval(() => Array.from(document.querySelectorAll('a')).some(a => a.querySelector('.saved-control'))), false);
	await article.reload();
	await article.waitFor('.saved-control[aria-pressed="true"]');
	await article.eval(() => { Storage.prototype.setItem = function () { throw new Error('Storage unavailable for this check'); }; });
	await article.click('.saved-control');
	assert.equal(await article.eval(() => window.SavedStore.has('post', 'latentland')), false);
	assert.match(await article.eval(() => document.querySelector('.saved-control-feedback').textContent), /for this visit/);
	assert.equal(await article.eval(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), true);
	assert.deepEqual(article.errors.filter(error => error.type === 'exception'), []);
	await article.close();
	// Hold only the controls' registry request; the reader itself still loads.
	// Both initial lists and rebuilt return lists must keep their reserved height.
	for (const width of [1280, 390]) {
		const delayed = await newPage({ width, height: 900, mobile: width < 600, theme: 'light', reducedMotion: true });
		await delayed._send('Page.addScriptToEvaluateOnNewDocument', { source: `
			var originalFetch = window.fetch; window.heldSavedRegistry = [];
			window.fetch = function (url, options) {
				if (String(url).indexOf('blog/index.json') !== -1 && new Error().stack.indexOf('saved-controls.js') !== -1) {
					return new Promise(function (resolve, reject) { window.heldSavedRegistry.push(function () { originalFetch.call(window, url, options).then(resolve, reject); }); });
				}
				return originalFetch.apply(this, arguments);
			};
		` });
		await delayed.goto(baseUrl + '#/blog');
		await delayed.waitFor(() => window.heldSavedRegistry.length && document.querySelector('.blog-card[data-slug="latentland"] .saved-card-actions'));
		await delayed.eval(async () => { await Promise.all(document.querySelector('#postsContent').getAnimations({ subtree: true }).filter(animation => animation.effect.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {}))); });
		const before = await delayed.eval(() => document.querySelector('.blog-card[data-slug="latentland"]').getBoundingClientRect().top);
		await delayed.eval(() => window.heldSavedRegistry.forEach(release => release()));
		await delayed.waitFor('.blog-card[data-slug="latentland"] .saved-control');
		await delayed.eval(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
		const after = await delayed.eval(() => document.querySelector('.blog-card[data-slug="latentland"]').getBoundingClientRect().top);
		assert.ok(Math.abs(after - before) < 1, 'delayed Save validation cannot move the initial list at ' + width + 'px');
		await delayed.click('.blog-card[data-slug="latentland"] .blog-card-title');
		await delayed.waitFor('#blogPostView[data-rendered-slug="latentland"]');
		await delayed.click('.blog-back');
		await delayed.waitFor('.blog-card[data-slug="latentland"] .saved-control');
		assert.equal(await delayed.eval(() => Array.from(document.querySelectorAll('.blog-card .saved-card-actions')).every(slot => slot.getBoundingClientRect().height === (innerWidth < 576 ? 44 : 36))), true, 'rebuilt lists retain reserved action height');
		await delayed.close();
	}
	console.log('Saved controls: public source gating, publication/blog/standalone saves, count sync, native links, legacy favorites, book notes/Undo, real cross-document storage, focus and themes/mobile passed.');
}
