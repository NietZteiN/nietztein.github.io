// Run: node scripts/qa/drive.mjs scripts/qa/saved-import.drive.mjs
// FileReader/File input flow with disposable backups and local storage only.
import path from 'node:path';

export default async function ({ newPage, baseUrl, assert, outDir }) {
	const bookId = 'A-A2-05', unknownId = 'UNAVAILABLE-IMPORTED-BOOK', note = 'Current note stays exactly. 日本語 <literal> & text';
	const gadgets = JSON.stringify({ ambient: false, tilt: false, avatar: false, signature: false, now: false, navcat: false, book3d: false, eggs: false });
	const sourceKeys = ['site.saved.v1', 'bookshelf.reading-list.v1', 'misc.favorites.v1'];
	const backup = { version: 1, items: [
		{ kind: 'book', id: bookId, note: 'Imported note must never replace the existing note', addedAt: 'older opaque stamp', title: 'HOSTILE IMPORT TITLE', url: 'javascript:alert(1)' },
		{ kind: 'post', id: 'latentland', title: 'HOSTILE IMPORT TITLE', url: 'https://backup.invalid/private' },
		{ kind: 'post', id: 'benchmarks-we-actually-need', note: 'A new backup note', addedAt: 'legacy unknown stamp', title: 'HOSTILE IMPORT TITLE' },
		{ kind: 'book', id: unknownId, note: 'Unresolved backup note <img onerror=bad> stays literal.', addedAt: 'unknown original stamp', title: 'HOSTILE IMPORT TITLE', url: 'https://backup.invalid/private' },
		{ kind: 'experiment', id: '07-grokking-microscope', title: 'HOSTILE IMPORT TITLE', url: 'javascript:alert(1)' },
		{ kind: 'post', id: 'benchmarks-we-actually-need', note: 'A new backup note', addedAt: 'legacy unknown stamp', title: 'Different ignored title' }
	] };
	async function choose(page, content, name = 'site-saved-items.json') {
		await page.eval((value, filename) => {
			const transfer = new DataTransfer(); transfer.items.add(new File([typeof value === 'string' ? value : JSON.stringify(value)], filename, { type: 'application/json' }));
			const input = document.getElementById('saved-import-file'); input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true }));
		}, content, name);
	}
	const ready = page => page.waitFor(() => !document.querySelector('#saved-import-panel').hidden && !document.querySelector('#saved-import-panel').hasAttribute('aria-busy'));
	const disk = page => page.eval(keys => keys.map(key => localStorage.getItem(key)), sourceKeys);
	for (const [theme, width] of [['light', 1280], ['dark', 390]]) {
		const page = await newPage({ theme, width, height: 900, mobile: width < 600, reducedMotion: true, storage: {
			'gadgets.v1': gadgets,
			'site.saved.v1': JSON.stringify({ version: 1, items: [{ kind: 'post', id: 'latentland', addedAt: 'current opaque stamp', note: 'Existing post note' }] }),
			'bookshelf.reading-list.v1': JSON.stringify({ version: 1, items: [{ id: bookId, note, addedAt: 'current book stamp' }] })
		} });
		await page.goto(baseUrl + '#/saved'); await page.waitFor('#saved-hub:not([aria-busy])');
		const before = await disk(page);
		await choose(page, backup); await ready(page);
		assert.deepEqual(await disk(page), before, 'file validation and review do not write storage');
		assert.equal(await page.eval(() => document.querySelector('[data-import-count="additions"]').textContent), '3');
		assert.equal(await page.eval(() => document.querySelector('[data-import-count="existing"]').textContent), '2');
		assert.equal(await page.eval(() => document.querySelector('[data-import-count="duplicates"]').textContent), '1');
		assert.equal(await page.eval(() => document.querySelector('#saved-import-panel').textContent.includes('HOSTILE IMPORT TITLE')), false);
		assert.equal(await page.eval(() => Array.from(document.querySelectorAll('#saved-import-panel a')).some(a => a.href.includes('backup.invalid') || a.href.startsWith('javascript:'))), false);
		assert.match(await page.eval(() => document.querySelector('.saved-import-item[data-import-id="benchmarks-we-actually-need"] .saved-import-item-title').textContent), /Benchmarks We Actually Need/);
		assert.equal(await page.eval(() => document.querySelector('.saved-import-item[data-import-id="UNAVAILABLE-IMPORTED-BOOK"] .saved-import-item-title').textContent), unknownId);
		assert.equal(await page.eval(() => document.activeElement.id), 'saved-import-heading');
		assert.equal(await page.eval(() => {
			const rect = document.getElementById('saved-import-heading').getBoundingClientRect(), header = document.querySelector('.site-header');
			return rect.top >= (header ? header.offsetHeight : 0) && rect.bottom <= innerHeight;
		}), true, 'file review is revealed below the sticky header');
		await page.screenshot(path.join(outDir, 'saved-import-review-' + theme + '-' + width + '.png'));
		await page.click('#saved-import-cancel');
		assert.deepEqual(await disk(page), before, 'Cancel has no writes');
		assert.equal(await page.eval(() => document.activeElement.id), 'saved-import');
		assert.equal(await page.eval(() => document.getElementById('saved-import-file').value), '', 'same-file reselection stays possible');
		await choose(page, backup); await ready(page);
		await page.eval(id => {
			window.SavedStore.remove('post', 'latentland', { source: 'another-view' });
			window.SavedStore.adoptLegacy('book', [{ id, note: 'Late book note wins', addedAt: 'late book stamp' }], { source: 'reading-shelf', persistent: false });
		}, bookId);
		assert.equal(await page.eval(() => document.querySelector('[data-import-count="additions"]').textContent), '3');
		await page.eval(() => {
			const frame = document.createElement('iframe'); frame.hidden = true; document.body.appendChild(frame);
			frame.contentWindow.localStorage.setItem('site.saved.v1', JSON.stringify({ version: 1, items: [{ kind: 'post', id: 'benchmarks-we-actually-need', note: 'Late post note wins', addedAt: 'late opaque stamp' }] }));
			// Confirm in this task, before the cross-document storage event arrives.
			document.getElementById('saved-import-confirm').click(); frame.remove();
		});
		assert.equal(await page.eval(() => document.querySelector('#saved-import-panel').hidden), true);
		assert.equal(await page.eval(() => window.SavedStore.get('book', 'A-A2-05').note), 'Late book note wins');
		assert.equal(await page.eval(() => window.SavedStore.get('post', 'benchmarks-we-actually-need').note), 'Late post note wins');
		assert.equal(await page.eval(() => window.SavedStore.has('post', 'latentland')), false, 'a formerly already-saved record deleted after review is not re-added');
		assert.equal(await page.eval(() => window.SavedStore.get('book', 'UNAVAILABLE-IMPORTED-BOOK').note), backup.items[3].note);
		assert.equal(await page.eval(() => window.SavedStore.get('book', 'UNAVAILABLE-IMPORTED-BOOK').addedAt), 'unknown original stamp');
		assert.equal(await page.eval(() => window.SavedStore.has('experiment', '07-grokking-microscope')), true);
		assert.match(await page.eval(() => document.getElementById('saved-status').textContent), /Restored 2 of 3 reviewed additions/);
		const after = await disk(page);
		await choose(page, '{not valid JSON'); await ready(page);
		assert.equal(await page.eval(() => document.querySelector('#saved-import-confirm').disabled), true);
		assert.match(await page.eval(() => document.querySelector('#saved-import-error').textContent), /not valid JSON/);
		assert.deepEqual(await disk(page), after);
		await choose(page, { version: 1, items: [{ kind: 'book', id: 'conflict', note: 'First' }, { kind: 'book', id: 'conflict', note: 'Different' }] }); await ready(page);
		assert.match(await page.eval(() => document.querySelector('#saved-import-error').textContent), /duplicate.*different note/i);
		assert.deepEqual(await disk(page), after);
		await choose(page, { version: 1, items: [] }); await ready(page);
		assert.equal(await page.eval(() => document.querySelector('#saved-import-confirm').disabled), true);
		await page.click('#saved-import-cancel');

		// Hold file reads so an older selection can finish after a newer selection.
		await page.eval(() => {
			window.originalImportRead = FileReader.prototype.readAsText; window.heldImportReads = [];
			FileReader.prototype.readAsText = function (file) { const reader = this; window.heldImportReads.push({ reader, release: () => window.originalImportRead.call(reader, file) }); };
		});
		await choose(page, { version: 1, items: [{ kind: 'post', id: 'untitled' }] }, 'older.json');
		await choose(page, { version: 1, items: [{ kind: 'post', id: 'what-language-models-represent' }] }, 'newer.json');
		await page.eval(() => window.heldImportReads[0].release());
		await page.waitFor(() => window.heldImportReads[0].reader.readyState === 2);
		assert.equal(await page.eval(() => document.querySelector('#saved-import-panel').hasAttribute('aria-busy')), true, 'stale file read cannot replace the new selection');
		await page.eval(() => window.heldImportReads[1].release()); await ready(page);
		assert.equal(await page.eval(() => document.querySelector('.saved-import-item').getAttribute('data-import-id')), 'what-language-models-represent');
		await page.click('#saved-import-cancel');
		await choose(page, { version: 1, items: [{ kind: 'post', id: 'untitled' }] }, 'canceled.json');
		await page.click('#saved-import-cancel'); await page.eval(() => window.heldImportReads[2].release());
		await page.waitFor(() => window.heldImportReads[2].reader.readyState === 2);
		assert.equal(await page.eval(() => document.querySelector('#saved-import-panel').hidden), true);
		await choose(page, { version: 1, items: [{ kind: 'post', id: 'untitled' }] }, 'background.json');
		const heldPosition = await page.eval(() => { document.getElementById('saved-search').focus(); return scrollY; });
		await page.eval(() => window.heldImportReads[3].release()); await ready(page);
		assert.equal(await page.eval(() => document.activeElement.id), 'saved-search', 'a completed read does not steal focus from another control');
		assert.ok(Math.abs(await page.eval(() => scrollY) - heldPosition) < 1, 'a background read does not move the viewport');
		await page.click('#saved-import-cancel');
		await page.eval(() => { FileReader.prototype.readAsText = window.originalImportRead; });
		assert.deepEqual(await disk(page), after, 'canceled and stale file reads never restore anything');
		assert.equal(await page.eval(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), true);
		assert.equal(page.requests.some(request => request.url.includes('backup.invalid') || request.url.includes('UNAVAILABLE-IMPORTED-BOOK')), false);
		assert.deepEqual(page.errors.filter(error => error.type === 'exception'), []);
		await page.close();
	}
	const offline = await newPage({ width: 390, height: 900, mobile: true, theme: 'dark', reducedMotion: true, storage: {
		'gadgets.v1': gadgets, 'site.saved.v1': '{unreadable original site data', 'bookshelf.reading-list.v1': '{unreadable original book data'
	} });
	await offline._send('Page.addScriptToEvaluateOnNewDocument', { source: `
		var importOriginalFetch = window.fetch;
		window.fetch = function (url) { if (/publications\\.json|blog\\/index\\.json|misc\\/toys\\.json|library(?:-additions)?\\.json/.test(String(url))) return Promise.reject(new Error('Public metadata offline')); return importOriginalFetch.apply(this, arguments); };
	` });
	await offline.goto(baseUrl + '#/saved'); await offline.waitFor('#saved-hub:not([aria-busy])');
	const corruptBefore = await disk(offline);
	await choose(offline, { version: 1, items: [{ kind: 'post', id: 'latentland', title: 'HOSTILE IMPORT TITLE', url: 'https://backup.invalid/private' }, { kind: 'book', id: unknownId, note: 'An exact offline note' }] }); await ready(offline);
	assert.equal(await offline.eval(() => document.querySelector('.saved-import-item-title').textContent), 'latentland', 'unavailable metadata falls back to the literal ID');
	assert.deepEqual(await disk(offline), corruptBefore);
	await offline.click('#saved-import-confirm');
	assert.equal(await offline.eval(() => window.SavedStore.get('book', 'UNAVAILABLE-IMPORTED-BOOK').note), 'An exact offline note');
	assert.deepEqual(await disk(offline), corruptBefore, 'corrupt original bytes survive confirmed memory-only restore');
	assert.match(await offline.eval(() => document.querySelector('#saved-status').textContent), /only for this visit/);
	await offline.eval(() => { const original = URL.createObjectURL; URL.createObjectURL = function (blob) { window.importExportText = blob.text(); return original.call(this, blob); }; });
	await offline.click('#saved-export');
	const memoryExport = await offline.eval(async () => JSON.parse(await window.importExportText));
	assert.equal(memoryExport.items.find(item => item.id === unknownId).note, 'An exact offline note');
	assert.equal(memoryExport.items.every(item => !('title' in item) && !('url' in item)), true);
	await offline.close();
	const quota = await newPage({ width: 1280, height: 900, theme: 'light', reducedMotion: true, storage: { 'gadgets.v1': gadgets } });
	await quota.goto(baseUrl + '#/saved'); await quota.waitFor('#saved-hub:not([aria-busy])');
	await choose(quota, { version: 1, items: [{ kind: 'post', id: 'latentland' }] }); await ready(quota);
	await quota.eval(() => { Storage.prototype.setItem = function () { throw new Error('Quota unavailable'); }; });
	await quota.click('#saved-import-confirm');
	assert.equal(await quota.eval(() => window.SavedStore.has('post', 'latentland')), true);
	assert.equal(await quota.eval(() => localStorage.getItem('site.saved.v1')), null);
	assert.match(await quota.eval(() => document.getElementById('saved-status').textContent), /only for this visit/);
	assert.deepEqual(quota.errors.filter(error => error.type === 'exception'), []); await quota.close();
	const large = await newPage({ width: 390, height: 900, mobile: true, theme: 'dark', reducedMotion: true, storage: { 'gadgets.v1': gadgets } });
	await large.goto(baseUrl + '#/saved'); await large.waitFor('#saved-hub:not([aria-busy])');
	const many = { version: 1, items: Array.from({ length: 10000 }, (_, i) => ({ kind: 'book', id: 'unresolved-backup-book-' + i, note: 'Exact note ' + i, addedAt: '' })) };
	const beforeLarge = await disk(large); await choose(large, many); await ready(large);
	assert.equal(await large.eval(() => document.querySelector('[data-import-count="additions"]').textContent), '10000');
	assert.equal(await large.eval(() => document.querySelectorAll('#saved-import-list > li').length), 25, 'large reviews keep bounded DOM with full totals');
	assert.deepEqual(await disk(large), beforeLarge);
	assert.equal(await large.eval(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), true);
	await large.click('#saved-import-confirm');
	assert.equal(await large.eval(() => window.SavedStore.snapshot().length), 10000);
	assert.equal(await large.eval(() => window.SavedStore.get('book', 'unresolved-backup-book-9999').note), 'Exact note 9999');
	const beforeOversize = await disk(large);
	await large.eval(() => {
		const transfer = new DataTransfer(); transfer.items.add(new File([new Uint8Array(window.SavedImport.MAX_BYTES + 1)], 'too-large.json', { type: 'application/json' }));
		const input = document.getElementById('saved-import-file'); input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true }));
	});
	await ready(large); assert.match(await large.eval(() => document.querySelector('#saved-import-error').textContent), /too large/);
	assert.deepEqual(await disk(large), beforeOversize);
	assert.deepEqual(large.errors.filter(error => error.type === 'exception'), []); await large.close();
	console.log('Saved import: no-write preview/cancel, trusted metadata, merge-only restore, late changes, exact notes, duplicates, file-read races, offline/corrupt/quota recovery and mobile/themes passed.');
}
