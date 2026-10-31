// Release browsing uses invented catalogs and the demo library; no provider writes.
export default async function ({ newPage, baseUrl, assert, outDir }) {
	for (const theme of ['dark', 'light']) for (const width of [1280, 390]) {
		const page = await newPage({ width, height: width === 390 ? 844 : 860, mobile: width === 390, theme });
		const press = async label => {
			await page.eval(text => {
				const b = [...document.querySelectorAll('#fy-artists button')].find(b => b.textContent === text);
				if (!b) throw Error('Missing ' + text); b.focus();
			}, label); await page.key('Enter');
		};
		const releases = () => page.eval(() => [...document.querySelectorAll('.ts-artist-releases [data-release]')].map(b => b.textContent));
		await page.goto(baseUrl + 'misc/101-true-shuffle/?demo=1#/home'); await page.waitFor(() => window.__ts?.lib);
		await page.eval(() => {
			const TS = TrueShuffle, id = Object.keys(__ts.lib.tracks)[0];
			const song = (title, mine) => Object.assign(TS.sources.find({ key: 'test:' + title, title, artist: 'Echo Orchard', source: 'itunes' }), { mine: mine || null });
			const owned = song('Garden of Glass', id), fresh = song('Cobalt Horizon', null);
			const complete = { key: 'test:complete', title: 'Complete Garden', date: '2020-01-01', year: 2020, type: 'album', tracks: [owned], trackCount: 1 };
			const partial = { key: 'test:partial', title: 'Partial Horizons', date: '2026-06-01', year: 2026, type: 'album', tracks: [owned, fresh], trackCount: 2 };
			const unknown = { key: 'test:unknown', title: 'Unknown Fields', date: '2024-01-01', year: 2024, type: 'ep', trackCount: 4 };
			const undated = { key: 'test:undated', title: 'Undated Lights', type: 'album', trackCount: 2 };
			const compilation = { key: 'test:best', title: 'Collected Echoes', date: '2025-01-01', year: 2025, type: 'compilation', tracks: [fresh], trackCount: 1 };
			window.catalogReads = 0;
			TS.artists.create = () => ({ demo: () => ({ found: { sure: true }, discography: { top: [owned, fresh], albums: [complete, partial, undated], eps: [unknown], singles: [], compilations: [compilation] } }), albumTracks: async al => { window.catalogReads++; return { tracks: al.tracks || [fresh], have: al.tracks?.filter(t => t.mine).length || 0 }; } });
			location.hash = '#/for-you?artist=Echo%20Orchard&catalog=albums&visitor=keep';
		});
		await page.waitFor('.ts-artist-releases');
		assert.deepEqual(await releases(), ['Partial Horizons (2026)', 'Unknown Fields (2024)', 'Complete Garden (2020)', 'Undated Lights']);
		assert.equal(await page.eval(() => window.catalogReads), 0, 'Opening the catalog does not fetch every album');
		assert.ok(await page.eval(() => document.querySelector('.ts-artist-release-meta').textContent.includes('1 of 2 songs in your library')));
		assert.ok(await page.eval(() => document.querySelector('.ts-artist-count').textContent.includes('1 compilation')));
		await press('Hide complete releases');
		assert.deepEqual(await releases(), ['Partial Horizons (2026)', 'Unknown Fields (2024)', 'Undated Lights']);
		assert.equal(await page.eval(() => window.catalogReads), 0, 'Unknown releases remain visible without provider calls');
		await page.eval(() => { const s = document.querySelector('[aria-label="Sort releases"]'); s.value = 'oldest'; s.dispatchEvent(new Event('change', { bubbles: true })); });
		assert.deepEqual(await releases(), ['Unknown Fields (2024)', 'Partial Horizons (2026)', 'Undated Lights']);
		await page.type('[aria-label="Search releases"]', 'partial');
		assert.deepEqual(await releases(), ['Partial Horizons (2026)']);
		assert.ok(await page.eval(() => new URLSearchParams(location.hash.split('?')[1]).get('releaseQuery') === 'partial'));
		await press('Partial Horizons (2026)'); await page.waitFor('.ts-artist-song-summary');
		assert.equal(await page.eval(() => window.catalogReads), 1);
		assert.ok(await page.eval(() => document.querySelector('.ts-artist-song-summary').textContent.includes('1 in your library / 1 to discover')));
		await press('Only songs I do not have');
		assert.equal(await page.eval(() => document.querySelectorAll('.ts-discovery-result .ts-m-row').length), 1);
		await page.type('[aria-label="Search these songs"]', 'does not exist');
		assert.equal(await page.eval(() => document.querySelectorAll('.ts-discovery-result .ts-m-row').length), 0);
		await page.eval(() => { const s = document.querySelector('[aria-label="Search these songs"]'); s.value = ''; s.dispatchEvent(new Event('input', { bubbles: true })); });
		await press('Back to albums'); await page.waitFor('.ts-artist-releases');
		assert.deepEqual(await releases(), ['Partial Horizons (2026)']);
		assert.equal(await page.eval(() => document.querySelector('[aria-label="Sort releases"]').value), 'oldest');
		assert.equal(await page.eval(() => document.querySelector('[aria-label="Search releases"]').value), 'partial');
		assert.equal(await page.eval(() => new URLSearchParams(location.hash.split('?')[1]).get('visitor')), 'keep');
		await page.eval(() => { const s = document.querySelector('[aria-label="Search releases"]'); s.value = ''; s.dispatchEvent(new Event('input', { bubbles: true })); });
		await press('Compilations'); assert.deepEqual(await releases(), ['Collected Echoes (2025)']);
		assert.equal(await page.eval(() => new URLSearchParams(location.hash.split('?')[1]).get('catalog')), 'compilations');
		await press('Collected Echoes (2025)'); await page.waitFor('.ts-artist-song-summary');
		assert.ok(await page.eval(() => document.querySelector('.ts-discovery-result').textContent.includes('compilation / 2025-01-01 / 0 of 1 song in your library')));
		await press('Back to compilations'); await page.waitFor('.ts-artist-releases');
		await page.eval(() => document.querySelector('.ts-discovery-result').scrollIntoView({ block: 'start', behavior: 'instant' }));
		await page.screenshot(outDir + `/true-shuffle-artist-catalog-${theme}-${width}.png`);
		assert.ok(await page.eval(() => document.documentElement.scrollWidth <= innerWidth));
		assert.deepEqual(page.errors, []); assert.deepEqual(page.externalHosts, []); await page.close();
	}
}
