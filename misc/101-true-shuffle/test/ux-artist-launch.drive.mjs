// Discovery starts beside the playing song and never changes playback or asks a provider itself.
export default async function ({ newPage, baseUrl, assert, outDir }) {
	for (const theme of ['dark', 'light']) for (const width of [1280, 390]) {
		const page = await newPage({ width, height: width === 390 ? 844 : 900, mobile: width === 390, theme });
		await page.goto(baseUrl + 'misc/101-true-shuffle/?demo=1');
		await page.waitFor('.ts-home');
		const seed = await page.eval(() => {
			const c = window.__ts.pageCtx, tracks = c.L.list(c.lib()).filter(t => t.artist && c.L.playable(t) && !t.blocked);
			const t = tracks[0]; c.play.from(tracks.slice(0, 6).map(t => t.id), 0, { label: 'Discovery test', href: '#/' });
			return { id: t.id, name: TrueShuffle.artistLaunch.targets(t, c.L, c.lib())[0].name };
		});
		await page.waitFor('.ts-artist-shortcut');
		const playback = () => page.eval(() => { const c = window.__ts.pageCtx; return { current: c.current().id, queue: c.ctl().state().items, index: c.ctl().state().index, state: c.player().state() }; });
		const before = await playback();
		assert.equal(before.state, 'playing');
		await page.click('.ts-artist-shortcut');
		try { await page.waitFor('.ts-artist-hub-tabs'); }
		catch (err) { await page.screenshot(outDir + '/artist-launch-failure.png'); throw Error(err.message + '\n' + JSON.stringify(await page.eval(() => ({ hash: location.hash, text: document.querySelector('#view')?.textContent.slice(0, 1400), active: document.activeElement?.outerHTML, link: document.querySelector('.ts-artist-shortcut')?.outerHTML })))); }
		assert.equal(await page.eval(() => new URLSearchParams(location.hash.split('?')[1]).get('artist')), seed.name);
		try { await page.waitFor('.ts-discovery-result .ts-m-row'); }
		catch (err) { throw Error(err.message + '\n' + JSON.stringify(await page.eval(() => ({ hash: location.hash, text: document.querySelector('.ts-discovery-result')?.textContent, errors: window.__ts?.pageCtx.current()?.artist })))); }
		assert.deepEqual(await playback(), before);
		await page.eval(() => { location.hash = '#/'; }); await page.waitFor('.ts-home');
		if (width === 390) {
			await page.click('#tabbar [aria-label="Queue"]'); await page.waitFor(() => document.activeElement.id === 'sheet-close');
			await page.waitFor(() => { const e = document.querySelector('.ts-now-rest'); return Math.abs(e.getBoundingClientRect().top - parseFloat(getComputedStyle(e).top)) < 1; });
		}
		await page.waitFor('#nowinfo .ts-artist-launch');
		await page.eval(() => document.querySelector('#nowinfo .ts-artist-launch').scrollIntoView({ block: 'center', behavior: 'instant' }));
		await page.screenshot(outDir + `/true-shuffle-current-artist-${theme}-${width}.png`);
		await page.click('#nowinfo .ts-artist-launch a[href*="catalog=albums"]');
		try { await page.waitFor('.ts-artist-releases'); }
		catch (err) { await page.screenshot(outDir + '/artist-launch-albums-failure.png'); throw Error(err.message + '\n' + JSON.stringify(await page.eval(() => ({ hash: location.hash, text: document.querySelector('#view')?.textContent.slice(0, 1400), active: document.activeElement?.outerHTML })))); }
		assert.equal(await page.eval(() => new URLSearchParams(location.hash.split('?')[1]).get('catalog')), 'albums');
		assert.equal(await page.eval(() => document.body.classList.contains('sheet-open')), false);
		assert.deepEqual(await playback(), before);
		await page.eval(() => { location.hash = '#/for-you'; }); await page.waitFor('.ts-current-artist .ts-artist-launch');
		assert.equal(await page.eval(() => document.querySelector('.ts-current-artist h3').textContent), seed.name);
		await page.click('.ts-current-artist a[href*="missing=1"]');
		await page.waitFor(() => document.querySelector('.ts-discovery-result button[aria-pressed="true"]') && new URLSearchParams(location.hash.split('?')[1]).get('missing') === '1');
		assert.deepEqual(await playback(), before);
		// Focus can exclude the playing artist. Catalog links must still use the entire library.
		await page.eval(() => { const c = window.__ts.pageCtx; const other = c.L.list(c.lib()).find(t => t.artist && t.artist !== c.current().artist); const id = window.__ts.createSmart('Other artist', { artists: [other.artistKey] }); window.__ts.setFocus(id); });
		await page.click('.ts-artist-shortcut'); await page.waitFor('.ts-artist-hub-tabs');
		assert.equal(await page.eval(() => document.querySelector('#view h1').textContent), seed.name);
		await page.eval(() => window.__ts.setFocus(null));
		await page.eval(() => { location.hash = '#/for-you'; }); await page.waitFor('.ts-current-artist');
		const next = await page.eval(() => {
			const c = window.__ts.pageCtx, t = c.L.list(c.lib()).find(t => t.artist && t.artist !== c.current().artist && c.L.playable(t));
			c.play.now([t.id]); return TrueShuffle.artistLaunch.targets(t, c.L, c.lib())[0].name;
		});
		await page.waitFor(name => document.querySelector('.ts-current-artist h3')?.textContent === name, { args: [next] });
		await page.eval(() => {
			const c = window.__ts.pageCtx, host = document.createElement('div'); host.id = 'launch-fixture'; document.querySelector('#view').prepend(host);
			host.append(TrueShuffle.artistLaunch.render(c, { artist: 'First & Second', feat: [], title: 'Collaboration' }));
		});
		await page.eval(() => { const s = document.querySelector('#launch-fixture select'); s.focus(); s.value = 'Second'; s.dispatchEvent(new Event('change', { bubbles: true })); });
		assert.ok(await page.eval(() => [...document.querySelectorAll('#launch-fixture a')].every(a => new URLSearchParams(a.hash.split('?')[1]).get('artist') === 'Second')));
		assert.equal(await page.eval(() => document.activeElement === document.querySelector('#launch-fixture select')), true);
		assert.ok(await page.eval(() => document.documentElement.scrollWidth <= innerWidth));
		assert.deepEqual(page.errors, []); assert.deepEqual(page.externalHosts, []); await page.close();
	}
}
