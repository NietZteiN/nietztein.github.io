// Albums remain a browsing action until Play/Queue is explicitly pressed.
export default async function ({ newPage, baseUrl, assert, outDir }) {
	for (const theme of ['dark', 'light']) for (const width of [1280, 390]) {
		const page = await newPage({ width, height: width === 390 ? 844 : 900, mobile: width === 390, theme });
		const press = async label => {
			await page.eval(text => { const b = [...document.querySelectorAll('#fy-artists button')].find(b => b.textContent === text); if (!b) throw Error('Missing ' + text); b.focus(); }, label);
			await page.key('Enter');
		};
		await page.goto(baseUrl + 'misc/101-true-shuffle/?demo=1'); await page.waitFor('.ts-home');
		const ids = await page.eval(() => {
			const c = __ts.pageCtx, own = c.L.list(c.lib()).filter(t => c.L.playable(t) && !t.blocked).slice(0, 5);
			c.play.from(own.slice(3).map(t => t.id), 0, { label: 'Keep this queue', href: '#/' });
			const tracks = own.slice(0, 3).map((t, i) => Object.assign(TrueShuffle.sources.find({ key: 'album:' + i, title: t.title, artist: 'Echo Orchard', source: 'itunes', seq: i + 1 }), { mine: t.id }));
			const album = { key: 'it:album:1234', id: 1234, title: 'Parallel Gardens', source: 'itunes', type: 'album', year: 2026, date: '2026-10-01', trackCount: 3, tracks, cover: 'https://example.invalid/album.jpg' };
			window.albumFixture = album; window.albumReads = 0;
			TrueShuffle.artists.create = () => ({ demo: () => ({ found: { sure: true }, discography: { top: tracks, albums: [album], eps: [], singles: [], compilations: [] } }), albumTracks: async al => { window.albumReads++; return { tracks: al.tracks, total: al.tracks.length, have: al.tracks.length }; } });
			location.hash = '#/for-you?artist=Echo%20Orchard&catalog=albums'; return own.slice(0, 3).map(t => t.id);
		});
		await page.waitFor('.ts-artist-releases');
		const before = await page.eval(() => ({ id: __ts.pageCtx.current().id, queue: __ts.ctl.state().items, state: __ts.player.state() }));
		assert.equal(await page.eval(() => window.albumReads), 0);
		assert.equal(await page.eval(() => document.querySelectorAll('.ts-artist-release-art img').length), 0, 'Demo uses generated covers instead of remote artwork');
		await page.eval(() => { const s = document.querySelector('[aria-label="Release layout"]'); s.value = 'compact'; s.dispatchEvent(new Event('change', { bubbles: true })); });
		assert.ok(await page.eval(() => document.querySelector('.ts-artist-releases').classList.contains('is-compact')));
		assert.equal(await page.eval(() => ToyKit.load('releaseLayoutDemo', '')), 'compact');
		assert.equal(await page.eval(() => new URLSearchParams(location.hash.split('?')[1]).get('density')), 'compact');
		await press('Parallel Gardens (2026)'); await page.waitFor('.ts-album-hero');
		assert.equal(await page.eval(() => window.albumReads), 1);
		assert.deepEqual(await page.eval(() => [...document.querySelectorAll('.ts-discovery-result .ts-m-idx')].map(x => x.textContent)), ['1', '2', '3']);
		assert.deepEqual(await page.eval(() => ({ id: __ts.pageCtx.current().id, queue: __ts.ctl.state().items, state: __ts.player.state() })), before);
		await page.eval(() => document.querySelector('.ts-album-hero').scrollIntoView({ block: 'start', behavior: 'instant' }));
		await page.screenshot(outDir + `/true-shuffle-album-${theme}-${width}.png`);
		await press('Play next'); await page.waitFor(() => document.querySelector('.ts-album-play-note').textContent.includes('placed next'));
		assert.deepEqual(await page.eval(() => __ts.ctl.state().items.slice(__ts.ctl.state().index + 1, __ts.ctl.state().index + 4)), ids);
		assert.equal(await page.eval(() => __ts.pageCtx.current().id), before.id);
		await press('Add to queue'); await page.waitFor(() => document.querySelector('.ts-album-play-note').textContent.includes('added to the queue'));
		assert.deepEqual(await page.eval(() => __ts.ctl.state().items.slice(-3)), ids);
		await press('Back to albums'); await page.waitFor('.ts-artist-releases');
		assert.ok(await page.eval(() => document.querySelector('.ts-artist-releases').classList.contains('is-compact')));
		await page.waitFor(() => document.activeElement.getAttribute('data-release') === 'it:album:1234');
		await press('Parallel Gardens (2026)'); await page.waitFor('.ts-album-actions');
		await press('Play album'); await page.waitFor(id => __ts.pageCtx.current().id === id, { args: [ids[0]] });
		assert.deepEqual(await page.eval(() => __ts.ctl.state().items), ids);
		// A direct album detail reuses the same UI without asking for an artist catalog.
		await page.eval(() => {
			const c = __ts.pageCtx, host = document.querySelector('#view'); host.replaceChildren();
			TrueShuffle.artistDiscovery.album(host, c, window.albumFixture, { artist: 'Echo Orchard', base: '#/album/itunes/1234', query: new URLSearchParams('title=Parallel+Gardens') });
		});
		await page.waitFor('.ts-album-hero');
		assert.equal(await page.eval(() => document.querySelector('.ts-album-hero h1')?.textContent), 'Parallel Gardens');
		assert.ok(await page.eval(() => document.title.startsWith('Parallel Gardens')));
		assert.equal(await page.eval(() => document.querySelector('.ts-discovery-result .ts-chips[role="group"]').hidden), true);
		assert.equal(await page.eval(() => document.querySelector('[aria-label="Artist to discover"]')), null);
		// Mixed found songs must be queued serially, and next-insertion must retain album order.
		await page.eval(() => {
			const c = Object.create(__ts.pageCtx); c.demo = false; c.http = () => null; c.canRead = () => true; c.prefs = () => ({ art: false });
			window.albumFoundQueue = ['current']; window.albumFindCalls = [];
			c.play = Object.assign({}, c.play, { find: async (f, mode) => {
				window.albumFindCalls.push(f.key); await new Promise(r => setTimeout(r, f.key.endsWith('1') ? 25 : 5));
				if (mode === 'next') window.albumFoundQueue.splice(1, 0, f.key); else window.albumFoundQueue.push(f.key);
				return { videoId: 'mock-' + f.key };
			} });
			window.albumFoundContext = c;
			const album = Object.assign({}, window.albumFixture, { tracks: [1, 2, 3].map(n => TrueShuffle.sources.find({ key: 'new:' + n, title: 'Unheard invented album song ' + n, artist: 'Echo Orchard', source: 'itunes' })) });
			window.albumFoundFixture = album; const host = document.querySelector('#view'); host.replaceChildren();
			TrueShuffle.artistDiscovery.album(host, c, album, { artist: 'Echo Orchard', base: '#/album/itunes/1234' });
		});
		await page.waitFor('.ts-album-actions'); await press('Play next');
		await page.waitFor(() => document.querySelector('.ts-album-play-note').textContent.includes('placed next'));
		assert.deepEqual(await page.eval(() => window.albumFoundQueue), ['current', 'new:1', 'new:2', 'new:3']);
		assert.deepEqual(await page.eval(() => window.albumFindCalls), ['new:3', 'new:2', 'new:1']);
		await press('Add to queue'); await page.waitFor(() => document.querySelector('.ts-album-play-note').textContent.includes('added to the queue'));
		assert.deepEqual(await page.eval(() => window.albumFoundQueue.slice(-3)), ['new:1', 'new:2', 'new:3']);
		await page.eval(() => {
			const c = window.albumFoundContext; c.canRead = () => false; const host = document.querySelector('#view'); host.replaceChildren();
			TrueShuffle.artistDiscovery.album(host, c, window.albumFoundFixture, { artist: 'Echo Orchard', base: '#/album/itunes/1234' });
		});
		await page.waitFor('.ts-album-actions');
		assert.ok(await page.eval(() => [...document.querySelectorAll('.ts-album-actions button')].every(b => b.disabled)));
		assert.ok(await page.eval(() => document.querySelector('.ts-album-play-note').textContent.includes('needs a YouTube API key or sign-in')));
		assert.ok(await page.eval(() => document.documentElement.scrollWidth <= innerWidth));
		assert.deepEqual(page.errors, []); assert.deepEqual(page.externalHosts, []); await page.close();
	}
}
