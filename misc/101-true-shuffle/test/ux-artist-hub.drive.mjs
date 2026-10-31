// Artist identity, album bookmarks and library Focus work as one connected route.
export default async function ({ newPage, baseUrl, assert, outDir }) {
	for (const theme of ['dark', 'light']) for (const width of [1280, 390]) {
		const page = await newPage({ width, height: width === 390 ? 844 : 900, mobile: width === 390, theme, reducedMotion: true });
		const press = async (label, scope = '#view') => {
			await page.eval(({ label, scope }) => { const b = [...document.querySelector(scope).querySelectorAll('button')].find(b => (b.querySelector('.ts-btn-label')?.textContent || b.textContent) === label); if (!b) throw Error('Missing ' + label); b.focus(); }, { label, scope }); await page.key('Enter');
		};
		await page.goto(baseUrl + 'misc/101-true-shuffle/?demo=1'); await page.waitFor('.ts-home');
		const artist = await page.eval(() => {
			const c = __ts.pageCtx, a = Object.values(c.idx().artists)[0];
			c.play.from(a.tracks.slice(0, 4).map(t => t.id), 0, { label: 'Artist test', href: '#/' });
			location.hash = TrueShuffle.artistHub.href(a.name, c.L); return { name: a.name, key: a.key };
		});
		await page.waitFor('.ts-artist-hub-tabs');
		const playback = () => page.eval(() => ({ id: __ts.pageCtx.current().id, items: __ts.ctl.state().items, index: __ts.ctl.state().index, state: __ts.player.state() }));
		const before = await playback();
		assert.equal(await page.eval(() => document.querySelector('#view h1').textContent), artist.name);
		assert.equal(await page.eval(() => document.querySelectorAll('.ts-artist-hub-tabs a').length), 4);
		assert.equal(await page.eval(() => !!document.querySelector('#fy-artists')), false);
		await page.click('.ts-artist-hub-tabs a[href*="tab=catalog"]'); await page.waitFor('.ts-discovery-result .ts-m-row');
		assert.equal(await page.eval(() => !!document.querySelector('.ts-discovery-picks, [aria-label="Artist to discover"]')), false);
		await press('Albums & EPs'); await page.waitFor('.ts-artist-release');
		const release = await page.eval(() => ({ key: document.querySelector('[data-release]').dataset.release, title: document.querySelector('[data-release]').textContent }));
		await press('Want to hear', '.ts-artist-release');
		assert.equal(await page.eval(() => TrueShuffle.discoveryShelf.read(__ts.pageCtx).albums.length), 1);
		await page.click('.ts-artist-release [data-release]'); await page.waitFor('.ts-album-hero');
		const albumRoute = await page.eval(() => location.hash);
		assert.equal(new URLSearchParams(albumRoute.split('?')[1]).get('album'), release.key);
		await page.eval(() => document.querySelector('.ts-album-hero').scrollIntoView({ block: 'start', behavior: 'instant' }));
		await page.screenshot(outDir + `/true-shuffle-artist-hub-${theme}-${width}.png`);
		assert.deepEqual(await playback(), before);
		// Songs in the catalog can join the tray without replacing the older Saved-for-later feature.
		await page.eval(() => document.querySelector('.ts-m-row .ts-m-more').focus()); await page.key('Enter');
		await press('Collect in discovery tray', '.ts-menu');
		assert.equal(await page.eval(() => TrueShuffle.discoveryShelf.read(__ts.pageCtx).tray.length), 1);
		await page.eval(() => { location.hash = '#/listening-shelf?tab=albums'; }); await page.waitFor('.ts-shelf-card-title');
		await page.click('.ts-shelf-card-title'); await page.waitFor('.ts-album-hero');
		assert.equal(await page.eval(() => new URLSearchParams(location.hash.split('?')[1]).get('album')), release.key);
		assert.equal(await page.eval(() => document.querySelector('#view h1').textContent), artist.name);
		assert.deepEqual(await playback(), before);
		await page.reload(); await page.waitFor('.ts-album-hero');
		assert.equal(await page.eval(() => TrueShuffle.discoveryShelf.read(__ts.pageCtx).albums.length), 1);
		await page.click('.ts-artist-hub-tabs a[href*="tab=releases"]'); await page.waitFor('[aria-label="Release type"]');
		await page.eval(() => { const s = document.querySelector('[aria-label="Release type"]'); s.value = 'single'; s.dispatchEvent(new Event('change', { bubbles: true })); });
		assert.equal(await page.eval(() => new URLSearchParams(location.hash.split('?')[1]).get('releaseType')), 'single');
		await page.reload(); await page.waitFor('[aria-label="Release type"]');
		assert.equal(await page.eval(() => document.querySelector('[aria-label="Release type"]').value), 'single');
		await page.eval(key => {
			const c = __ts.pageCtx, other = c.L.list(c.lib()).find(t => t.artistKey && t.artistKey !== key); __ts.setFocus(__ts.createSmart('Other artist', { artists: [other.artistKey] }));
		}, artist.key);
		await page.click('.ts-artist-hub-tabs a[href*="tab=library"]'); await page.waitFor('.ts-artist-hub-body .ts-empty');
		await page.click('.ts-artist-hub-body a[href*="all=1"]'); await page.waitFor('.ts-artist-hub-body .ts-row');
		assert.equal(await page.eval(() => document.querySelector('#view h1').textContent), artist.name);
		await page.eval(() => __ts.setFocus(null));
		await page.eval(() => { location.hash = '#/artist/unheard?artist=Unheard&tab=library'; }); await page.waitFor('.ts-artist-hub-body .ts-empty');
		assert.equal(await page.eval(() => document.querySelector('#view h1').textContent), 'Unheard');
		assert.ok(await page.eval(() => document.documentElement.scrollWidth <= innerWidth));
		assert.deepEqual(page.errors, []); assert.deepEqual(page.externalHosts, []); await page.close();
	}
}
