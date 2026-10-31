// Discovery shelf data stays browser-local; account and music providers are never called.
export default async function ({ newPage, baseUrl, assert, outDir }) {
	for (const theme of ['dark', 'light']) for (const width of [1280, 390]) {
		const page = await newPage({ width, height: width === 390 ? 844 : 900, mobile: width === 390, theme });
		const press = async (label, scope = '#view') => {
			await page.eval(({ label, scope }) => {
				const b = [...document.querySelector(scope).querySelectorAll('button')].find(b => (b.querySelector('.ts-btn-label')?.textContent || b.textContent) === label);
				if (!b) throw Error('Missing button ' + label); b.focus();
			}, { label, scope }); await page.key('Enter');
		};
		await page.goto(baseUrl + 'misc/101-true-shuffle/?demo=1#/listening-shelf'); await page.waitFor('.ts-shelf-tabs');
		const fixture = await page.eval(() => {
			const c = __ts.pageCtx, TS = TrueShuffle, owned = c.L.list(c.lib()).find(t => t.artist && c.L.playable(t));
			const song = TS.sources.find({ key: 'shelf-owned', videoId: owned.id, title: owned.title, artist: owned.artist, source: 'library' }); song.mine = owned.id;
			const missing = TS.sources.find({ key: 'shelf-missing', title: 'Unheard Track', artist: owned.artist, source: 'itunes' });
			const album = { key: 'shelf-release', id: '100', title: 'Tomorrow Garden', artist: owned.artist, source: 'itunes', type: 'album', date: new Date(c.now() - 86400000).toISOString().slice(0, 10), year: 2026, trackCount: 2, tracks: [song, missing] };
			window.shelfFixture = { song, missing, album }; c.play.from([owned.id], 0, { label: 'Keep playing', href: '#/' });
			const host = document.createElement('div'); host.id = 'shelf-buttons'; document.querySelector('#view').append(host);
			host.append(TS.discoveryShelf.albumButton(c, album, { artist: owned.artist }), TS.discoveryShelf.collectButton(c, album, { kind: 'album', artist: owned.artist }), TS.discoveryShelf.songButton(c, song), TS.discoveryShelf.songButton(c, missing));
			TS.discoveryShelf.recordCatalog(c, owned.artist, [album]);
			return { id: owned.id, artist: owned.artist };
		});
		const playback = () => page.eval(() => ({ id: __ts.pageCtx.current().id, items: __ts.ctl.state().items, index: __ts.ctl.state().index, playing: __ts.player.state() }));
		const before = await playback();
		await press('Want to hear', '#shelf-buttons');
		for (let i = 0; i < 3; i++) await press('Collect', '#shelf-buttons');
		assert.deepEqual(await page.eval(() => TrueShuffle.discoveryShelf.counts(TrueShuffle.discoveryShelf.read(__ts.pageCtx))), { albums: 1, tray: 3, releases: 1, unseen: 1 });
		assert.deepEqual(await playback(), before);
		await page.eval(name => { location.hash = '#/for-you?artist=' + encodeURIComponent(name); }, fixture.artist); await page.waitFor('.ts-discovery-result');
		await press('Keep this artist here', '.ts-discovery-result');
		await page.eval(() => { location.hash = '#/listening-shelf'; }); await page.waitFor('.ts-shelf-card');
		await page.reload(); await page.waitFor('.ts-shelf-card');
		assert.equal(await page.eval(() => document.querySelector('.ts-shelf-card-title').textContent.includes('Tomorrow Garden')), true);
		await press('Remove'); await page.waitFor('.ts-shelf-empty');
		await press('Undo', '.ts-toast'); await page.waitFor('.ts-shelf-card');
		assert.equal(await page.eval(() => TrueShuffle.discoveryShelf.counts(TrueShuffle.discoveryShelf.read(__ts.pageCtx)).albums), 1);
		await page.eval(() => { location.hash = '#/listening-shelf?tab=tray'; }); await page.waitFor('.ts-shelf-select');
		await press('Select all'); await press('Make playlist'); await page.waitFor('.ts-modal');
		const listCount = await page.eval(() => __ts.pageCtx.lists.all().length);
		await press('Cancel', '.ts-modal'); assert.equal(await page.eval(() => __ts.pageCtx.lists.all().length), listCount);
		await press('Make playlist'); await page.waitFor('.ts-modal');
		const beforeCreate = await playback();
		await page.type('[aria-label="Playlist name"]', 'Found together');
		await press('Find songs & create', '.ts-modal');
		await page.waitFor(() => /^#\/list\//.test(location.hash));
		assert.deepEqual(await page.eval(() => __ts.pageCtx.lists.all().at(-1).ids), [fixture.id]);
		assert.deepEqual(await playback(), beforeCreate);
		assert.equal(await page.eval(() => TrueShuffle.discoveryShelf.read(__ts.pageCtx).tray.length), 3);
		await page.eval(() => { location.hash = '#/listening-shelf?tab=inbox'; }); await page.waitFor('.ts-shelf-card');
		await press('Mark checked'); await page.waitFor('.ts-shelf-empty');
		assert.equal(await page.eval(() => TrueShuffle.discoveryShelf.counts(TrueShuffle.discoveryShelf.read(__ts.pageCtx)).unseen), 0);
		await press('Unseen only'); await page.waitFor('.ts-shelf-card');
		await page.reload(); await page.waitFor('.ts-shelf-card');
		assert.ok(await page.eval(() => document.querySelector('.ts-shelf-card').textContent.includes('Mark unseen')));
		await page.eval(() => { const s = document.querySelector('[aria-label="Release type"]'); s.value = 'single'; s.dispatchEvent(new Event('change', { bubbles: true })); });
		await page.waitFor('.ts-shelf-empty');
		await page.eval(() => { const s = document.querySelector('[aria-label="Release type"]'); s.value = 'all'; s.dispatchEvent(new Event('change', { bubbles: true })); }); await page.waitFor('.ts-shelf-card');
		await page.eval(() => {
			const TS = TrueShuffle, c = __ts.pageCtx, name = TS.discoveryShelf.read(c).inbox[0].artist;
			TS.artistDiscovery.chosen = () => [name];
			TS.artists.create = () => ({ demo: () => ({ discography: { albums: [{ key: 'next-release', title: 'Next Season', type: 'album', date: new Date(c.now() + 86400000).toISOString().slice(0, 10), source: 'itunes', id: '200' }], eps: [], singles: [], compilations: [] } }) });
		});
		await press('Check releases'); await page.waitFor(() => document.querySelector('#view').textContent.includes('Next Season'));
		assert.equal(await page.eval(() => TrueShuffle.discoveryShelf.counts(TrueShuffle.discoveryShelf.read(__ts.pageCtx)).unseen), 1);
		await page.screenshot(outDir + `/true-shuffle-listening-shelf-${theme}-${width}.png`);
		assert.ok(await page.eval(() => document.documentElement.scrollWidth <= innerWidth));
		assert.deepEqual(page.errors, []); assert.deepEqual(page.externalHosts, []); await page.close();
	}
	// Collect an actual demo release before opening it, reload, then make a playlist.
	const catalog = await newPage({ width: 1280, height: 900, theme: 'dark' });
	await catalog.goto(baseUrl + 'misc/101-true-shuffle/?demo=1#/for-you?artist=Paper%20Lanterns&catalog=albums'); await catalog.waitFor('.ts-artist-release .ts-shelf-collect');
	await catalog.eval(() => {
		const card = [...document.querySelectorAll('.ts-artist-release')].find(el => /\b[1-9]\d* of \d+ songs? in your library/.test(el.textContent));
		if (!card) throw Error('No demo release with owned tracks');
		[...card.querySelectorAll('button')].find(b => b.textContent === 'Collect').focus();
	}); await catalog.key('Enter');
	assert.equal(await catalog.eval(() => !!document.querySelector('.ts-album-actions')), false, 'Collecting a card does not open or fetch the album');
	const albumIds = await catalog.eval(() => TrueShuffle.discoveryShelf.read(__ts.pageCtx).tray[0].release.tracks.filter(f => f.mine).map(f => f.mine));
	assert.ok(albumIds.length > 0, 'The actual demo release contains songs already in the invented library');
	await catalog.eval(() => { location.hash = '#/listening-shelf?tab=tray'; }); await catalog.waitFor('.ts-shelf-select'); await catalog.reload(); await catalog.waitFor('.ts-shelf-select');
	const makeCatalogList = async () => {
		await catalog.eval(() => [...document.querySelectorAll('#view button')].find(b => b.textContent === 'Select all').focus()); await catalog.key('Enter');
		await catalog.eval(() => [...document.querySelectorAll('#view button')].find(b => b.textContent === 'Make playlist').focus()); await catalog.key('Enter'); await catalog.waitFor('.ts-modal');
		await catalog.eval(() => [...document.querySelectorAll('.ts-modal button')].find(b => b.textContent === 'Find songs & create').focus()); await catalog.key('Enter');
		await catalog.waitFor(() => /^#\/list\//.test(location.hash));
		assert.deepEqual(await catalog.eval(() => __ts.pageCtx.lists.all().at(-1).ids), albumIds);
	};
	await makeCatalogList();
	// A metadata-only saved demo release recovers its invented tracks without provider calls.
	await catalog.eval(() => { const saved = ToyKit.load('discoveryShelfDemoV1', null); delete saved.tray[0].release.tracks; ToyKit.store('discoveryShelfDemoV1', saved); location.hash = '#/listening-shelf?tab=tray'; }); await catalog.waitFor('.ts-shelf-select'); await catalog.reload(); await catalog.waitFor('.ts-shelf-select');
	await makeCatalogList();
	assert.deepEqual(catalog.errors, []); assert.deepEqual(catalog.externalHosts, []); await catalog.close();
	// A resolver result can become a local playlist without playing, queueing, or writing to YouTube.
	const page = await newPage({ width: 390, height: 844, mobile: true, theme: 'light' });
	await page.goto(baseUrl + 'misc/101-true-shuffle/?player=mock#/listening-shelf?tab=tray'); await page.waitFor('.ts-shelf-tabs');
	await page.eval(() => ToyKit.store('art', false)); await page.reload(); await page.waitFor('.ts-shelf-tabs');
	await page.eval(() => {
		const c = __ts.pageCtx, host = document.createElement('div'); host.id = 'real-shelf-buttons'; document.querySelector('#view').append(host);
		const f = TrueShuffle.sources.find({ key: 'shelf-real-find', title: 'Fresh Signal', artist: 'Echo Orchard', source: 'itunes' });
		host.append(TrueShuffle.discoveryShelf.songButton(c, f));
		c.canRead = () => true; c.engine = () => ({ resolve: async () => ({ videoId: 'zzShelf0001', video: { title: 'Echo Orchard - Fresh Signal', channel: 'Echo Orchard - Topic', durationSec: 190 } }) });
	});
	await page.eval(() => document.querySelector('#real-shelf-buttons button').focus()); await page.key('Enter');
	await page.eval(() => { location.hash = '#/listening-shelf?tab=albums'; }); await page.waitFor('.ts-shelf-empty');
	await page.eval(() => { location.hash = '#/listening-shelf?tab=tray'; }); await page.waitFor('.ts-shelf-select');
	await page.eval(() => [...document.querySelectorAll('#view button')].find(b => b.textContent === 'Select all').focus()); await page.key('Enter');
	await page.eval(() => [...document.querySelectorAll('#view button')].find(b => b.textContent === 'Make playlist').focus()); await page.key('Enter'); await page.waitFor('.ts-modal');
	await page.eval(() => [...document.querySelectorAll('.ts-modal button')].find(b => b.textContent === 'Find songs & create').focus()); await page.key('Enter');
	await page.waitFor(() => !!__ts.lib.tracks.zzShelf0001 && /^#\/list\//.test(location.hash));
	assert.deepEqual(await page.eval(() => __ts.pageCtx.lists.all().at(-1).ids), ['zzShelf0001']);
	assert.equal(await page.eval(() => __ts.pageCtx.current()), null);
	await page.reload(); await page.waitFor(() => !!__ts.lib.tracks.zzShelf0001);
	assert.deepEqual(await page.eval(() => __ts.pageCtx.lists.all().at(-1).ids), ['zzShelf0001']);
	const countBeforeCancel = await page.eval(() => __ts.pageCtx.lists.all().length);
	await page.eval(() => {
		const c = __ts.pageCtx; c.canRead = () => true;
		c.engine = () => ({ resolve: () => new Promise(r => { window.finishShelfResolve = r; }) });
		const host = document.createElement('div'); host.id = 'shelf-cancel-button'; document.querySelector('#view').append(host);
		host.append(TrueShuffle.discoveryShelf.songButton(c, { key: 'cancel-find', title: 'Wait for me', artist: 'Echo Orchard', source: 'itunes' }));
		host.querySelector('button').click(); location.hash = '#/listening-shelf?tab=tray';
	}); await page.waitFor('.ts-shelf-select');
	await page.eval(() => [...document.querySelectorAll('#view button')].find(b => b.textContent === 'Select all').focus()); await page.key('Enter');
	await page.eval(() => [...document.querySelectorAll('#view button')].find(b => b.textContent === 'Make playlist').focus()); await page.key('Enter'); await page.waitFor('.ts-modal');
	await page.eval(() => [...document.querySelectorAll('.ts-modal button')].find(b => b.textContent === 'Find songs & create').focus()); await page.key('Enter');
	await page.waitFor(() => !!window.finishShelfResolve); await page.key('Escape'); await page.waitFor(() => !document.querySelector('.ts-modal'));
	await page.eval(() => window.finishShelfResolve({ videoId: 'zzShelf0002', video: { title: 'Echo Orchard - Wait for me' } }));
	await page.eval(() => new Promise(r => setTimeout(r, 150)));
	assert.equal(await page.eval(() => __ts.pageCtx.lists.all().length), countBeforeCancel);
	assert.equal(await page.eval(() => !!__ts.lib.tracks.zzShelf0002), false);
	assert.deepEqual(page.errors, []); assert.deepEqual(page.externalHosts, []); await page.close();
}
