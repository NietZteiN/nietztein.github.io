// Search scopes, typed results and explicit provider intent; all data invented.
export default async function ({ newPage, baseUrl, assert, outDir }) {
	for (const theme of ['dark', 'light']) for (const width of [1280, 390]) {
		const page = await newPage({ width, height: width === 390 ? 844 : 900, mobile: width === 390, theme });
		await page.goto(baseUrl + 'misc/101-true-shuffle/?demo=1#/search?q=Paper');
		await page.waitFor('.ts-search-scope');
		assert.ok(await page.eval(() => document.querySelector('.ts-search-scope-note').textContent.includes('imported music')));
		await page.click('.ts-search-scope a[href*="scope=discover"]');
		await page.waitFor('.ts-search-discover');
		assert.equal(await page.eval(() => document.querySelector('[aria-label="Search music catalogs"]').value), 'Paper');
		assert.equal(await page.eval(() => document.querySelectorAll('.ts-search-result-group').length), 0);
		await page.eval(() => document.querySelector('[aria-label="Search music catalogs"]').focus()); await page.key('Enter');
		await page.waitFor('.ts-search-result-group[data-kind="artists"]');
		assert.equal(await page.eval(() => new URLSearchParams(location.hash.split('?')[1]).get('run')), '1');
		assert.ok(await page.eval(() => document.querySelector('.ts-search-result-group[data-kind="artists"] a').getAttribute('href').includes('&tab=catalog')));
		assert.ok(await page.eval(() => document.querySelector('.ts-search-result-group[data-kind="songs"] .ts-m-row')));
		assert.ok(await page.eval(() => document.querySelector('.ts-search-result-group[data-kind="albums"] .ts-search-result')));
		await page.eval(() => document.querySelector('.ts-search-discover').scrollIntoView({ block: 'start', behavior: 'instant' }));
		await page.screenshot(outDir + `/true-shuffle-music-search-${theme}-${width}.png`);
		await page.type('[aria-label="Search music catalogs"]', ' Lanterns');
		assert.equal(await page.eval(() => document.querySelectorAll('.ts-search-result-group').length), 0);
		await page.click('.ts-search-types a[href*="kind=albums"]'); await page.waitFor('.ts-search-discover');
		await page.waitFor(() => new URLSearchParams(location.hash.split('?')[1]).get('kind') === 'albums' && document.querySelectorAll('.ts-search-result-group').length === 0);
		assert.equal(await page.eval(() => new URLSearchParams(location.hash.split('?')[1]).get('q')), 'Paper Lanterns');
		assert.equal(await page.eval(() => document.querySelectorAll('.ts-search-result-group').length), 0);
		await page.eval(() => document.querySelector('[aria-label="Search music catalogs"]').focus()); await page.key('Enter');
		await page.waitFor('.ts-search-result-group[data-kind="albums"]');
		assert.equal(await page.eval(() => document.querySelectorAll('.ts-search-result-group').length), 1);
		await page.reload(); await page.waitFor('.ts-search-result-group[data-kind="albums"]');
		assert.equal(await page.eval(() => document.querySelectorAll('.ts-search-result-group').length), 1);
		// Global header edits preserve scope and type, but drop permission to run a catalog request.
		await page.type('#search', 'X');
		await page.waitFor(() => new URLSearchParams(location.hash.split('?')[1]).get('q')?.endsWith('X'));
		assert.equal(await page.eval(() => new URLSearchParams(location.hash.split('?')[1]).get('scope')), 'discover');
		assert.equal(await page.eval(() => new URLSearchParams(location.hash.split('?')[1]).get('kind')), 'albums');
		assert.equal(await page.eval(() => new URLSearchParams(location.hash.split('?')[1]).get('run')), null);
		assert.equal(await page.eval(() => document.querySelectorAll('.ts-search-result-group').length), 0);
		assert.ok(await page.eval(() => document.documentElement.scrollWidth <= innerWidth));
		assert.deepEqual(page.errors, []); assert.deepEqual(page.externalHosts, []); await page.close();
	}
	const page = await newPage({ width: 390, height: 844, mobile: true, theme: 'light' });
	await page.goto(baseUrl + 'misc/101-true-shuffle/?demo=1'); await page.waitFor(() => window.__ts?.pageCtx && TrueShuffle.musicSearch);
	await page.eval(() => {
		const base = window.__ts.pageCtx, ctx = Object.create(base); ctx.demo = false; ctx.prefs = () => ({ art: false }); ctx.engine = () => null;
		window.searchCalls = [];
		ctx.http = () => ({ get: async (host, path, options) => {
			window.searchCalls.push({ host, path, query: options.query });
			if (options.query.term === 'Offline') throw new Error('Invented offline failure');
			if (options.query.entity === 'musicArtist') return { results: [{ wrapperType: 'artist', artistId: 123, artistName: 'Echo Orchard', primaryGenreName: 'Indie' }] };
			if (options.query.entity === 'album') return { results: [{ wrapperType: 'collection', collectionId: 456, artistName: 'Echo Orchard', collectionName: 'Cobalt Album', trackCount: 9, releaseDate: '2026-06-01' }] };
			return { results: [{ wrapperType: 'track', kind: 'song', trackId: 789, trackName: 'Cobalt Song', artistName: 'Echo Orchard', collectionId: 456, collectionName: 'Cobalt Album', trackTimeMillis: 183000 }] };
		} });
		ctx.cache = () => ({ wrap: async (key, ttl, fn) => fn() });
		const host = document.querySelector('#view'); host.replaceChildren(); TrueShuffle.musicSearch.view(host, ctx, new URLSearchParams('q=Echo&scope=discover'));
	});
	assert.equal(await page.eval(() => window.searchCalls.length), 0);
	await page.type('[aria-label="Search music catalogs"]', ' Orchard');
	assert.equal(await page.eval(() => window.searchCalls.length), 0);
	await page.key('Enter'); await page.waitFor('.ts-search-result-group[data-kind="songs"]');
	assert.equal(await page.eval(() => window.searchCalls.length), 3);
	assert.deepEqual(await page.eval(() => window.searchCalls.map(c => c.query.entity).sort()), ['album', 'musicArtist', 'song']);
	assert.ok(await page.eval(() => document.querySelector('.ts-search-result-group[data-kind="albums"] a').getAttribute('href').startsWith('#/album/itunes/456?')));
	assert.equal(await page.eval(() => document.querySelectorAll('.ts-search-result-art img').length), 0);
	await page.eval(() => { const input = document.querySelector('[aria-label="Search music catalogs"]'); input.value = 'Offline'; input.dispatchEvent(new Event('input', { bubbles: true })); input.focus(); });
	assert.equal(await page.eval(() => window.searchCalls.length), 3);
	await page.key('Enter'); await page.waitFor(() => document.querySelector('.ts-search-discover [role="status"]').textContent.includes('could not load'));
	assert.equal(await page.eval(() => document.querySelectorAll('.ts-search-result-group').length), 0);
	assert.ok(await page.eval(() => !document.querySelector('.ts-search-discover button[type="submit"]').disabled));
	assert.ok(await page.eval(() => document.documentElement.scrollWidth <= innerWidth));
	assert.deepEqual(page.errors, []); assert.deepEqual(page.externalHosts, []); await page.close();
}
