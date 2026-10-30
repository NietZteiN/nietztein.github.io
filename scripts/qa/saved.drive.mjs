// Run: node scripts/qa/drive.mjs scripts/qa/saved.drive.mjs
// Unified hub persistence, public metadata, native links, filters, export and Undo.
import fs from 'node:fs';
import path from 'node:path';

export default async function ({ newPage, baseUrl, assert, outDir, root }) {
	const bookId = 'A-A2-05', addedId = 'saved-fixture-book';
	const catalogue = JSON.parse(fs.readFileSync(path.join(root, 'assets/data/library.json'), 'utf8'));
	const bookTitle = catalogue.books.find((book) => book.id === bookId).t;
	const researchId = 'do-machines-struggle-where-humans-do-obfuscation-as-a-probe-of-human-and-machine-code-comprehension';
	const note = 'noteNeedle: preserve this\n日本語 & <literal text>';
	const stamp = '2026-10-29T12:00:00.000Z';
	const gadgets = JSON.stringify({ ambient: false, tilt: false, avatar: false, signature: false, now: false, navcat: false, book3d: false, eggs: false });
	for (const [theme, width] of [['light', 1280], ['dark', 390]]) {
		const page = await newPage({ theme, width, height: 900, mobile: width < 600, reducedMotion: true,
			extraAllowedHosts: ['github.com', 'avatars.githubusercontent.com', 'giscus.app'], storage: {
				'gadgets.v1': gadgets,
				'site.saved.v1': JSON.stringify({ version: 1, items: [
					{ kind: 'post', id: 'latentland', addedAt: stamp, title: 'Untrusted title', url: 'javascript:alert(1)' },
					{ kind: 'post', id: 'untitled', addedAt: stamp },
					{ kind: 'publication', id: researchId, addedAt: stamp },
					{ kind: 'post', id: 'i-am-an-ai-loop', addedAt: stamp },
					{ kind: 'book', id: 'forged-book' }
				] }),
				'misc.favorites.v1': JSON.stringify(['07-grokking-microscope', '45-reading-room', 'nonexistent-toy']),
				'bookshelf.reading-list.v1': JSON.stringify({ version: 1, items: [{ id: bookId, note, addedAt: stamp }, { id: addedId, note: 'Added book note', addedAt: stamp }] })
			} });
		await page._send('Page.addScriptToEvaluateOnNewDocument', { source: `
			var savedOriginalFetch = window.fetch;
			window.fetch = function (url) {
				if (String(url).indexOf('assets/data/library-additions.json') !== -1) return Promise.resolve(new Response(JSON.stringify({ books: [
					{ id: 'A-A2-05', t: 'Wrong override' }, { id: 'saved-fixture-book', t: 'Added Catalogue Book', a: 'An author' }
				] }), { headers: { 'content-type': 'application/json' } }));
				return savedOriginalFetch.apply(this, arguments);
			};
		` });
		await page.goto(baseUrl + '#/about');
		await page.waitFor('#saved-open:not([hidden])');
		assert.equal(page.requests.some((request) => request.url.endsWith('/assets/data/library.json')), false, 'Saved book metadata remains lazy on About');
		await page.eval(() => { location.hash = '#/saved'; });
		await page.waitFor(() => document.querySelectorAll('#saved-list > .saved-item').length === 7);
		assert.equal(await page.eval(() => document.querySelector('#saved-count').textContent), '7 saved items');
		assert.equal(await page.eval(() => document.querySelector('[data-saved-count]').textContent), '7');
		assert.equal(await page.eval(() => document.querySelector('#saved-hub').textContent.includes('Untrusted title')), false);
		assert.equal(await page.eval(() => document.querySelector('#saved-hub').textContent.includes('i-am-an-ai-loop')), false);
		assert.equal(await page.eval(() => document.querySelector('.saved-item[data-id="A-A2-05"] .saved-item-title').textContent), bookTitle, 'Base catalogue wins duplicate additions');
		assert.equal(await page.eval(() => document.querySelector('.saved-item[data-id="saved-fixture-book"] .saved-item-title').textContent), 'Added Catalogue Book');
		assert.equal(await page.eval(() => Array.from(document.querySelectorAll('#saved-list a')).every((a) => a.href.startsWith(location.origin + '/'))), true);
		assert.equal(await page.eval(() => document.querySelector('.saved-item[data-kind="post"] a').href), baseUrl + '#/post/latentland');
		assert.equal(await page.eval(() => document.querySelector('.saved-item[data-kind="experiment"] a').href.includes('/misc/')), true);
		await page.eval(() => document.querySelector('#saved-kind').focus()); await page.key('ArrowDown');
		assert.equal(await page.eval(() => document.activeElement.id), 'saved-kind', 'Keyboard filtering retains the select');
		await page.eval(() => { const select = document.querySelector('#saved-kind'); select.value = 'book'; select.dispatchEvent(new Event('change', { bubbles: true })); });
		assert.equal(await page.eval(() => document.querySelectorAll('#saved-list .saved-item').length), 2);
		await page.type('#saved-search', 'noteNeedle');
		assert.equal(await page.eval(() => document.querySelectorAll('#saved-list .saved-item').length), 1);
		await page.waitFor(() => location.hash.includes('q=noteNeedle'));
		await page.reload(); await page.waitFor(() => document.querySelector('#saved-count')?.textContent === '1 of 7 saved items');
		assert.equal(await page.eval(() => document.querySelector('#saved-search').value), 'noteNeedle');
		await page.eval(() => {
			const input = document.querySelector('#saved-search'); input.value = ''; input.dispatchEvent(new Event('input', { bubbles: true }));
			const select = document.querySelector('#saved-kind'); select.value = ''; select.dispatchEvent(new Event('change', { bubbles: true }));
			window.savedBlobText = null; const original = URL.createObjectURL;
			URL.createObjectURL = function (blob) { window.savedBlobText = blob.text(); return original.call(this, blob); };
		});
		await page.click('#saved-export');
		const output = await page.eval(async () => JSON.parse(await window.savedBlobText));
		assert.equal(output.items.length, 9, 'Backup includes unresolved local IDs as well as publicly resolved items');
		assert.equal(output.items.find((item) => item.id === bookId).note, note);
		assert.equal(output.items.some((item) => item.title === 'Untrusted title'), false);
		assert.equal(output.items.filter((item) => item.unresolved).length, 2);
		assert.equal(output.items.filter((item) => item.unresolved).every((item) => !('url' in item) && !('title' in item)), true, 'Unresolved items receive no invented destination or title');
		assert.equal(output.items.filter((item) => !item.unresolved).every((item) => item.url.startsWith(baseUrl)), true);
		await page.waitFor(() => true);
		assert.equal(page.downloads.some((download) => download.filename === 'site-saved-items.json'), true);
		assert.equal(await page.eval(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), true);
		await page.screenshot(path.join(outDir, 'saved-hub-' + theme + '-' + width + '.png'));
		await page.eval(() => { window.savedOriginalConfirm = window.confirm; window.confirm = () => false; });
		await page.click('#saved-clear');
		assert.equal(await page.eval(() => document.querySelectorAll('#saved-list .saved-item').length), 7, 'Cancel preserves every item');
		await page.eval(() => { window.confirm = window.savedOriginalConfirm; });
		await page.click('#saved-clear');
		assert.equal(await page.eval(() => document.querySelectorAll('#saved-list .saved-item').length), 0);
		assert.equal(await page.eval(() => document.activeElement.id), 'saved-undo');
		assert.equal(await page.eval(() => window.SavedStore.has('post', 'i-am-an-ai-loop')), true, 'Clear leaves unresolved stored data intact');
		assert.equal(await page.eval(() => window.SavedStore.has('experiment', 'nonexistent-toy')), true);
		await page.eval((id) => {
			window.SavedStore.toggle('post', 'benchmarks-we-actually-need', { source: 'external-view' });
			window.SavedStore.adoptLegacy('book', [{ id, note: 'New note after clear', addedAt: '2026-10-29T13:00:00.000Z' }], { source: 'reading-shelf', persistent: false });
		}, bookId);
		await page.click('#saved-undo');
		assert.equal(await page.eval((id) => window.SavedStore.get('book', id).note, bookId), 'New note after clear', 'Undo preserves a newer book note');
		assert.equal(await page.eval(() => window.SavedStore.has('post', 'benchmarks-we-actually-need')), true, 'Undo keeps saves made after clear');
		assert.equal(await page.eval(() => document.querySelectorAll('#saved-list .saved-item').length), 8);
		await page.eval(() => document.querySelector('.saved-item[data-id="latentland"] .saved-item-link').focus());
		await page.eval(() => window.SavedStore.remove('post', 'latentland', { source: 'external-view' }));
		assert.equal(await page.eval(() => document.activeElement.id), 'saved-search', 'External removal of the focused row leaves keyboard focus in the hub');
		await page._send('Emulation.setEmulatedMedia', { media: 'print' });
		assert.equal(await page.eval(() => getComputedStyle(document.querySelector('#savedContent')).display), 'none');
		assert.deepEqual(page.errors.filter((error) => error.type === 'exception'), []);
		assert.deepEqual(page.badRequests.filter((request) => request.url.startsWith(baseUrl)), []);
		await page.close();
	}
	const corrupt = await newPage({ width: 390, height: 844, mobile: true, reducedMotion: true, storage: {
		'gadgets.v1': gadgets, 'bookshelf.reading-list.v1': '{broken json', 'site.saved.v1': JSON.stringify({ version: 1, items: [{ kind: 'post', id: 'latentland' }] })
	} });
	await corrupt.goto(baseUrl + '#/saved'); await corrupt.waitFor('#saved-list .saved-item');
	assert.match(await corrupt.eval(() => document.querySelector('.saved-storage-note').textContent), /left untouched/);
	await corrupt.eval(() => { Storage.prototype.setItem = () => { throw new Error('Storage blocked'); }; window.SavedStore.toggle('post', 'benchmarks-we-actually-need'); window.SavedStore.refresh(); });
	assert.equal(await corrupt.eval(() => window.SavedStore.has('post', 'benchmarks-we-actually-need')), true);
	assert.equal(await corrupt.eval(() => document.querySelectorAll('#saved-list .saved-item').length), 2);
	assert.equal(await corrupt.eval(() => localStorage.getItem('bookshelf.reading-list.v1')), '{broken json');
	assert.deepEqual(corrupt.errors.filter((error) => error.type === 'exception'), []);
	await corrupt.close();
	const unavailable = await newPage({ width: 390, height: 844, mobile: true, reducedMotion: true, storage: {
		'gadgets.v1': gadgets,
		'bookshelf.reading-list.v1': JSON.stringify({ version: 1, items: [{ id: 'retired-book', note, addedAt: stamp }] }),
		'site.saved.v1': JSON.stringify({ version: 1, items: [{ kind: 'post', id: 'no-longer-public', addedAt: stamp, title: 'Untrusted', url: 'javascript:bad' }] })
	} });
	await unavailable._send('Page.addScriptToEvaluateOnNewDocument', { source: `
		const original = window.fetch;
		window.fetch = function (url) {
			if (/publications\\.json|blog\\/index\\.json|misc\\/toys\\.json|library(?:-additions)?\\.json/.test(String(url))) return Promise.reject(new Error('Sources unavailable'));
			return original.apply(this, arguments);
		};
	` });
	await unavailable.goto(baseUrl + '#/saved');
	await unavailable.waitFor('#saved-hub:not([aria-busy])');
	assert.equal(await unavailable.eval(() => document.querySelector('#saved-export').disabled), false, 'Export stays available when every source fails');
	assert.equal(await unavailable.eval(() => document.querySelector('#saved-clear').disabled), true, 'Clear remains limited to resolved public items');
	await unavailable.eval(() => {
		const original = URL.createObjectURL;
		URL.createObjectURL = function (blob) { window.savedBlobText = blob.text(); return original.call(this, blob); };
	});
	await unavailable.click('#saved-export');
	const unresolvedBackup = await unavailable.eval(async () => JSON.parse(await window.savedBlobText));
	assert.equal(unresolvedBackup.items.length, 2);
	assert.equal(unresolvedBackup.items.find((item) => item.kind === 'book').note, note);
	assert.equal(unresolvedBackup.items.find((item) => item.kind === 'book').addedAt, stamp);
	assert.equal(unresolvedBackup.items.every((item) => item.unresolved && !('url' in item) && !('title' in item)), true);
	assert.deepEqual(unavailable.errors.filter((error) => error.type === 'exception'), []);
	await unavailable.close();
	const conflict = await newPage({ width: 1280, height: 900, reducedMotion: true, storage: {
		'gadgets.v1': gadgets,
		'site.saved.v1': JSON.stringify({ version: 1, items: [{ kind: 'post', id: 'latentland', addedAt: stamp }] }),
		'bookshelf.reading-list.v1': JSON.stringify({ version: 1, items: [{ id: bookId, note: 'Original', addedAt: stamp }] })
	} });
	await conflict.goto(baseUrl + '#/saved'); await conflict.waitFor('#saved-list .saved-item');
	await conflict.eval((id) => {
		window.originalSavedSetItem = Storage.prototype.setItem;
		Storage.prototype.setItem = function () { throw new Error('quota'); };
		window.SavedStore.remove('post', 'latentland', { source: 'test' });
		window.SavedStore.adoptLegacy('book', [{ id, note: 'Pending local note', addedAt: '2026-10-29T12:00:00.000Z' }], { source: 'reading-shelf', persistent: false });
		const frame = document.createElement('iframe'); frame.id = 'saved-conflict-frame'; frame.hidden = true; document.body.appendChild(frame);
		frame.contentWindow.localStorage.setItem('site.saved.v1', JSON.stringify({ version: 1, items: [{ kind: 'post', id: 'latentland' }, { kind: 'post', id: 'untitled' }] }));
		frame.contentWindow.localStorage.setItem('bookshelf.reading-list.v1', JSON.stringify({ version: 1, items: [{ id, note: 'Remote note', addedAt: '2026-10-29T13:00:00.000Z' }, { id: 'A-A1-10', note: 'External addition', addedAt: '2026-10-29T12:00:00.000Z' }] }));
	}, bookId);
	await conflict.waitFor(() => window.SavedStore.has('post', 'untitled') && window.SavedStore.has('book', 'A-A1-10'));
	assert.equal(await conflict.eval(() => window.SavedStore.has('post', 'latentland')), false);
	assert.equal(await conflict.eval((id) => window.SavedStore.get('book', id).note, bookId), 'Pending local note');
	assert.equal(await conflict.eval(() => window.SavedStore.status().persistent), false);
	await conflict.eval((id) => {
		window.savedAgreementEvents = 0; window.addEventListener('storage', () => { window.savedAgreementEvents++; });
		const disk = document.querySelector('#saved-conflict-frame').contentWindow.localStorage;
		disk.setItem('site.saved.v1', JSON.stringify({ version: 1, items: [{ kind: 'post', id: 'untitled' }] }));
		disk.setItem('bookshelf.reading-list.v1', JSON.stringify({ version: 1, items: [{ id, note: 'Pending local note', addedAt: '2026-10-29T13:00:00.000Z' }, { id: 'A-A1-10', note: 'External addition', addedAt: '2026-10-29T12:00:00.000Z' }] }));
	}, bookId);
	await conflict.waitFor(() => window.savedAgreementEvents >= 2);
	await conflict.eval((id) => {
		const disk = document.querySelector('#saved-conflict-frame').contentWindow.localStorage;
		disk.setItem('site.saved.v1', JSON.stringify({ version: 1, items: [{ kind: 'post', id: 'latentland' }, { kind: 'post', id: 'untitled' }] }));
		disk.setItem('bookshelf.reading-list.v1', JSON.stringify({ version: 1, items: [{ id, note: 'Remote reversal', addedAt: '2026-10-29T13:00:00.000Z' }, { id: 'A-A1-10', note: 'External addition', addedAt: '2026-10-29T12:00:00.000Z' }] }));
	}, bookId);
	await conflict.waitFor(() => window.savedAgreementEvents >= 4);
	assert.equal(await conflict.eval(() => window.SavedStore.has('post', 'latentland')), false, 'Temporary remote agreement does not acknowledge an unwritten removal');
	assert.equal(await conflict.eval((id) => window.SavedStore.get('book', id).note, bookId), 'Pending local note', 'Temporary remote agreement does not acknowledge an unwritten note');
	await conflict.eval(() => { Storage.prototype.setItem = window.originalSavedSetItem; window.SavedStore.refresh(); });
	assert.equal(await conflict.eval(() => window.SavedStore.status().persistent), true);
	assert.equal(await conflict.eval(() => JSON.parse(localStorage.getItem('site.saved.v1')).items.some((item) => item.id === 'latentland')), false);
	assert.equal(await conflict.eval((id) => JSON.parse(localStorage.getItem('bookshelf.reading-list.v1')).items.find((item) => item.id === id).note, bookId), 'Pending local note');
	assert.deepEqual(conflict.errors.filter((error) => error.type === 'exception'), []);
	await conflict.close();
	console.log('Saved hub: public metadata/additions, lazy data, native links, filter state, export, confirmation, merge-safe Undo, focus, corrupt storage, print and themes/mobile passed.');
}
