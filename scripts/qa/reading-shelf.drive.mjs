// Run: node scripts/qa/drive.mjs scripts/qa/reading-shelf.drive.mjs
// Checks only the public catalogue and this browser's disposable local list.
import fs from 'node:fs';
import path from 'node:path';

export default async function ({ newPage, baseUrl, assert, outDir, root }) {
	const catalog = JSON.parse(fs.readFileSync(path.join(root, 'assets/data/library.json'), 'utf8'));
	const paths = JSON.parse(fs.readFileSync(path.join(root, 'assets/data/reading-paths.json'), 'utf8')).paths;
	const ids = new Set(catalog.books.map(book => book.id));
	assert.equal(paths.length, 3);
	for (const route of paths) for (const entry of route.books) assert(ids.has(entry.id), 'reading paths must use real public catalogue IDs: ' + entry.id);

	for (const [theme, width] of [['light', 1280], ['dark', 390]]) {
		const page = await newPage({ theme, width, height: 900, mobile: width < 600, reducedMotion: true,
			storage: { 'bookshelf.reading-list.v1': JSON.stringify({ version: 1, items: [] }) } });
		await page.goto(baseUrl + '#/bookshelf');
		await page.waitFor('#reading-shelf');
		assert.equal(await page.eval(() => document.querySelector('.rs-paths').open), false, 'paths start compact');
		assert.equal(await page.eval(() => document.querySelector('.rs-your-list').open), false, 'visitor list starts compact');
		await page.click('.rs-paths summary');
		await page.waitFor('.rs-path-book');
		assert.equal(await page.eval(() => document.querySelectorAll('.rs-path').length), 3);
		assert.equal(await page.eval(() => document.querySelectorAll('.rs-path-book').length), 9);
		await page.click('.rs-path-book .rs-save');
		assert.equal(await page.eval(() => document.querySelector('.rs-list-count').textContent), '1');
		const firstId = await page.eval(() => JSON.parse(localStorage.getItem('bookshelf.reading-list.v1')).items[0].id);
		await page.click('.rs-path-book .rs-title');
		await page.waitFor('.bs-card-backdrop.is-open .rs-detail-save .rs-save');
		await page.eval(async () => {
			await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame);
			await Promise.all(document.querySelector('.bs-card-backdrop').getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => {})));
		});
		assert.equal(await page.eval(() => document.querySelector('.rs-detail-save .rs-save').dataset.bookId), firstId);
		assert.equal(await page.eval(() => document.querySelector('.rs-detail-save .rs-save').getAttribute('aria-pressed')), 'true');
		await page.eval(() => { window.readingClickTrace = []; document.addEventListener('click', ev => window.readingClickTrace.push({ tag: ev.target.tagName, cls: ev.target.className, text: ev.target.textContent.slice(0, 60) }), { capture: true }); });
		const clickPoint = await page.click('.rs-detail-save .rs-save');
		if (await page.eval(() => document.querySelector('.rs-list-count').textContent) !== '0') console.log('Detail click diagnostic: ' + JSON.stringify(await page.eval(point => ({ point, trace: window.readingClickTrace, over: document.elementFromPoint(point.x, point.y)?.outerHTML.slice(0, 300), button: document.querySelector('.rs-detail-save .rs-save').getBoundingClientRect().toJSON() }), clickPoint)));
		assert.equal(await page.eval(() => document.querySelector('.rs-list-count').textContent), '0');
		assert.equal(await page.eval(() => document.activeElement.className), 'rs-save', 'detail toggle retains focus');
		await page.key('Enter');
		assert.equal(await page.eval(() => document.querySelector('.rs-list-count').textContent), '1');
		await page.key('Escape');
		await page.waitFor(() => getComputedStyle(document.querySelector('.bs-card-backdrop')).visibility === 'hidden');
		await page.click('.rs-your-list summary');
		assert.equal(await page.eval(() => document.querySelector('.rs-your-list').open), true);
		const note = 'Compare perception and language. <script>this stays text</script>';
		await page.type('.rs-note', note);
		assert.equal(await page.eval(() => JSON.parse(localStorage.getItem('bookshelf.reading-list.v1')).items[0].note), note);
		await page.click('.rs-path-book:nth-child(2) .rs-save');
		assert.equal(await page.eval(() => document.querySelector('.rs-list-count').textContent), '2');
		assert.equal(await page.eval(() => document.querySelector('.rs-note').value), note, 'adding another book preserves the latest note');
		await page.click('.rs-saved-book:nth-child(2) .rs-remove');
		assert.equal(await page.eval(() => document.querySelector('.rs-note').value), note, 'removing another book preserves the latest note');
		await page.reload();
		await page.waitFor('#reading-shelf');
		await page.click('.rs-your-list summary');
		assert.equal(await page.eval(() => document.querySelector('.rs-note').value), note, 'notes survive reload');
		await page.click('.rs-list-actions .rs-action');
		await page.waitFor(() => document.querySelector('.rs-status').textContent.includes('exported'));
		assert.equal(page.downloads.length, 1);
		for (let n = 0; n < 50 && page.downloads[0].state !== 'completed'; n++) await new Promise(resolve => setTimeout(resolve, 50));
		assert.equal(page.downloads[0].state, 'completed');
		const exported = JSON.parse(fs.readFileSync(page.downloads[0].path, 'utf8'));
		assert.equal(exported.version, 1);
		assert.equal(exported.books[0].id, firstId);
		assert.equal(exported.books[0].note, note);
		assert.match(exported.books[0].url, /#\/bookshelf\//);
		await page.click('.rs-remove');
		assert.equal(await page.eval(() => document.querySelector('.rs-list-count').textContent), '0');
		assert.equal(await page.eval(() => document.activeElement.tagName), 'SUMMARY', 'removing last item restores focus to list summary');
		await page.click('.rs-undo .rs-action');
		assert.equal(await page.eval(() => document.querySelector('.rs-note').value), note, 'undo restores notes');
		await page.click('.rs-list-actions .rs-action:nth-child(2)');
		assert.equal(page.dialogs.length, 1, 'clear requires confirmation');
		assert.equal(await page.eval(() => document.querySelector('.rs-list-count').textContent), '0');
		await page.click('.rs-undo .rs-action');
		assert.equal(await page.eval(() => document.querySelector('.rs-note').value), note);
		assert.equal(await page.eval(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), true);
		await page.screenshot(path.join(outDir, 'reading-shelf-' + theme + '-' + width + '.png'));
		await page.eval(() => { Storage.prototype.setItem = function () { throw new Error('storage unavailable for this check'); }; });
		await page.type('.rs-note', ' local');
		assert.match(await page.eval(() => document.querySelector('.rs-storage-note').textContent), /storage is unavailable or full/i);
		assert.deepEqual(page.errors.filter(error => error.type === 'exception'), []);
		await page.close();
	}
	console.log('Reading shelf: real public IDs, compact paths, detail toggles, local notes, JSON export, remove/clear/undo, storage failure and mobile/theme checks passed.');
}
