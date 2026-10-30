// Run: node scripts/qa/drive.mjs scripts/qa/legacy-preservation.drive.mjs
// Unknown IDs can be removed public content; ordinary visible edits retain them.
import fs from 'node:fs';
export default async function ({ newPage, baseUrl, assert }) {
	const unknownId = 'UNAVAILABLE-BOOK-01', unknownNote = 'Unresolved note: <text> & exact punctuation. '.repeat(120);
	const page = await newPage({ width: 390, height: 900, mobile: true, theme: 'dark', reducedMotion: true, storage: {
		'bookshelf.reading-list.v1': JSON.stringify({ version: 1, items: [
			{ id: 'A-A2-05', note: 'Visible note', addedAt: '2026-10-01T00:00:00.000Z' },
			{ id: unknownId, note: unknownNote, addedAt: '2026-10-02T00:00:00.000Z' }
		] }),
		'misc.favorites.v1': JSON.stringify(['07-grokking-microscope', 'retired-experiment'])
	} });
	await page.goto(baseUrl + '#/bookshelf');
	await page.waitFor('#reading-shelf');
	await page.click('.rs-your-list summary');
	assert.equal(await page.eval(() => document.querySelector('.rs-list-count').textContent), '1');
	assert.equal(await page.eval(() => document.querySelectorAll('.rs-saved-book').length), 1);
	await page.type('.rs-note', ' edit');
	assert.equal(await page.eval(id => JSON.parse(localStorage.getItem('bookshelf.reading-list.v1')).items.find(item => item.id === id).note, unknownId), unknownNote);
	assert.equal(await page.eval(id => window.SavedStore.get('book', id).note, unknownId), unknownNote, 'adoption keeps the full unresolved note, including beyond the visible editor limit');
	assert.equal(await page.eval(id => document.querySelector('#reading-shelf').textContent.includes(id), unknownId), false, 'unknown books have no rendered metadata');
	await page.click('.rs-list-actions .rs-action:nth-child(2)');
	assert.match(page.dialogs[0].message, /books shown/);
	assert.equal(await page.eval(() => document.querySelector('.rs-list-count').textContent), '0');
	assert.equal(await page.eval(() => JSON.parse(localStorage.getItem('bookshelf.reading-list.v1')).items.length), 1, 'clear removes the visible list only');
	assert.equal(await page.eval(id => window.SavedStore.get('book', id).note, unknownId), unknownNote);
	await page.click('.rs-undo .rs-action');
	assert.equal(await page.eval(() => document.querySelector('.rs-note').value), 'Visible note edit');
	await page.eval(() => window.SavedStore.restore([{ kind: 'book', id: 'UNAVAILABLE-BOOK-02', note: 'Another exact unresolved note', addedAt: '2026-10-03T00:00:00.000Z' }], { source: 'saved-hub' }));
	await page.type('.rs-note', ' again');
	assert.equal(await page.eval(() => window.SavedStore.get('book', 'UNAVAILABLE-BOOK-02').note), 'Another exact unresolved note', 'external unresolved records survive later visible edits');
	await page.eval(id => window.SavedStore.remove('book', id, { source: 'saved-hub' }), unknownId);
	await page.type('.rs-note', ' after removal');
	assert.equal(await page.eval(id => window.SavedStore.has('book', id), unknownId), false, 'intentional hub removal is not resurrected');

	await page.goto(baseUrl + '#/misc');
	await page.click('.misc-favorite[data-slug="07-grokking-microscope"]');
	assert.equal(await page.eval(() => JSON.parse(localStorage.getItem('misc.favorites.v1')).includes('retired-experiment')), true);
	assert.equal(await page.eval(() => window.SavedStore.has('experiment', 'retired-experiment')), true);
	assert.equal(await page.eval(() => document.querySelector('.misc-saved-count').textContent), '0', 'unknown favorites do not inflate the public grid count');
	await page.eval(() => window.SavedStore.toggle('experiment', 'another-retired-experiment', { source: 'saved-hub' }));
	await page.click('.misc-favorite[data-slug="07-grokking-microscope"]');
	assert.deepEqual(await page.eval(() => JSON.parse(localStorage.getItem('misc.favorites.v1')).slice().sort()), ['07-grokking-microscope', 'another-retired-experiment', 'retired-experiment']);
	assert.equal(page.requests.some(request => request.url.includes('UNAVAILABLE-BOOK') || request.url.includes('retired-experiment')), false, 'unresolved IDs never trigger metadata requests');
	await page.reload();
	assert.equal(await page.eval(() => document.querySelector('.misc-saved-count').textContent), '1');
	await page.eval(() => { Storage.prototype.setItem = function () { throw new Error('Storage unavailable for this check'); }; });
	await page.click('.misc-favorite[data-slug="07-grokking-microscope"]');
	await page.eval(() => window.SavedStore.refresh({ source: 'qa-refresh' }));
	assert.equal(await page.eval(() => window.SavedStore.has('experiment', 'retired-experiment')), true, 'memory-only writes preserve unresolved favorites');
	assert.equal(await page.eval(() => window.SavedStore.get('book', 'UNAVAILABLE-BOOK-02').note), 'Another exact unresolved note');
	assert.deepEqual(page.errors.filter(error => error.type === 'exception'), []);
	await page.close();

	const corruptBook = '{original unreadable reading data', corruptFavorites = '{original unreadable favorite data';
	const corrupt = await newPage({ width: 1280, height: 900, theme: 'light', reducedMotion: true, storage: {
		'bookshelf.reading-list.v1': corruptBook, 'misc.favorites.v1': corruptFavorites
	} });
	await corrupt.goto(baseUrl + '#/bookshelf');
	await corrupt.waitFor('#reading-shelf');
	await corrupt.click('.rs-paths summary');
	await corrupt.waitFor('.rs-path-book .rs-save');
	await corrupt.click('.rs-path-book .rs-save');
	await corrupt.click('.rs-your-list summary');
	await corrupt.type('.rs-note', 'A memory-only note to export.');
	assert.equal(await corrupt.eval(() => localStorage.getItem('bookshelf.reading-list.v1')), corruptBook, 'legacy reading writes never replace unreadable original bytes');
	assert.equal(await corrupt.eval(() => window.SavedStore.get('book', 'A-A2-05').note), 'A memory-only note to export.');
	await corrupt.eval(() => window.SavedStore.refresh({ source: 'qa-refresh' }));
	assert.equal(await corrupt.eval(() => localStorage.getItem('bookshelf.reading-list.v1')), corruptBook);
	assert.equal(await corrupt.eval(() => window.SavedStore.get('book', 'A-A2-05').note), 'A memory-only note to export.');
	assert.equal(await corrupt.eval(() => window.SavedStore.status().issues.some(issue => issue.provider === 'book' && issue.reason === 'corrupt')), true);
	await corrupt.click('.rs-list-actions .rs-action');
	for (let n = 0; n < 50 && (!corrupt.downloads.length || corrupt.downloads[0].state !== 'completed'); n++) await new Promise(resolve => setTimeout(resolve, 50));
	assert.equal(corrupt.downloads[0].state, 'completed');
	assert.equal(JSON.parse(fs.readFileSync(corrupt.downloads[0].path, 'utf8')).books[0].note, 'A memory-only note to export.', 'memory-only reading notes remain exportable');
	await corrupt.goto(baseUrl + '#/misc');
	await corrupt.click('.misc-favorite[data-slug="07-grokking-microscope"]');
	assert.equal(await corrupt.eval(() => localStorage.getItem('misc.favorites.v1')), corruptFavorites, 'legacy stars never replace unreadable original bytes');
	assert.equal(await corrupt.eval(() => window.SavedStore.has('experiment', '07-grokking-microscope')), true);
	await corrupt.eval(() => window.SavedStore.refresh({ source: 'qa-refresh' }));
	assert.equal(await corrupt.eval(() => window.SavedStore.has('experiment', '07-grokking-microscope')), true);
	assert.equal(await corrupt.eval(() => window.SavedStore.status().issues.some(issue => issue.provider === 'experiment' && issue.reason === 'corrupt')), true);
	assert.equal(await corrupt.eval(() => localStorage.getItem('misc.favorites.v1')), corruptFavorites);
	await corrupt.eval(async () => {
		const frame = document.createElement('iframe'); frame.hidden = true; document.body.appendChild(frame);
		frame.contentWindow.localStorage.setItem('misc.favorites.v1', '[]');
		await new Promise(resolve => setTimeout(resolve, 100)); frame.remove();
	});
	await corrupt.waitFor(() => !window.SavedStore.status().issues.some(issue => issue.provider === 'experiment' && issue.reason === 'corrupt'));
	assert.equal(await corrupt.eval(() => window.SavedStore.has('experiment', '07-grokking-microscope')), true, 'valid external recovery retains a pending memory-only Save');
	assert.equal(await corrupt.eval(() => document.querySelector('.misc-favorite[data-slug="07-grokking-microscope"]').getAttribute('aria-pressed')), 'true');
	await corrupt.click('.misc-favorite[data-slug="05-obfuscation-game"]');
	assert.deepEqual(await corrupt.eval(() => JSON.parse(localStorage.getItem('misc.favorites.v1')).slice().sort()), ['05-obfuscation-game', '07-grokking-microscope'], 'valid external recovery re-enables persistence without dropping pending favorites');
	assert.deepEqual(corrupt.errors.filter(error => error.type === 'exception'), []);
	await corrupt.close();
	console.log('Legacy preservation: unresolved book notes/favorites survive edits, visible clear and Undo, external changes, reload and memory-only adoption without metadata fetches.');
}
