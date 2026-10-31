// Listening-first Home, with the network-free invented demo only.
export default async function ({ newPage, baseUrl, assert, outDir }) {
	for (const theme of ['dark', 'light']) for (const width of [1280, 390]) {
		const page = await newPage({ width, height: width === 390 ? 844 : 860, mobile: width === 390, theme });
		await page.goto(baseUrl + 'misc/101-true-shuffle/?demo=1');
		await page.waitFor('.ts-home');
		assert.equal(await page.eval(() => document.querySelector('#view h1').textContent), 'Your next listen');
		assert.ok(await page.eval(() => document.querySelector('.ts-home-intro').textContent.includes('invented music, simulated player')));
		assert.equal(await page.eval(() => document.querySelector('.ts-home-more').open), false);
		assert.equal(await page.eval(() => document.querySelector('.ts-home-more-body').childElementCount), 0);
		assert.ok(await page.eval(() => document.querySelector('.ts-home-current').hidden === !window.__ts.pageCtx.current()));
		await page.screenshot(outDir + `/true-shuffle-home-${theme}-${width}.png`);
		await page.click('[data-home-daily]');
		await page.waitFor(() => window.__ts.pageCtx.player().state() === 'playing');
		const before = await page.eval(() => ({ id: window.__ts.pageCtx.current().id, items: window.__ts.pageCtx.ctl().state().items.slice() }));
		assert.equal(await page.eval(() => document.querySelector('[data-home-continue]').textContent), 'Open player');
		await page.click('[data-home-continue]');
		assert.equal(await page.eval(() => window.__ts.pageCtx.player().state()), 'playing');
		if (width === 390) assert.ok(await page.eval(() => document.body.classList.contains('sheet-open')));
		else assert.ok(await page.eval(() => !document.body.classList.contains('queue-hidden') && document.activeElement.id === 'tab-next'));
		await page.key('Escape');
		await page.eval(() => window.__ts.pageCtx.ctl().pause());
		await page.waitFor(() => document.querySelector('[data-home-continue]').textContent === 'Resume listening');
		await page.click('[data-home-continue]');
		await page.waitFor(() => window.__ts.pageCtx.player().state() === 'playing');
		assert.deepEqual(await page.eval(() => ({ id: window.__ts.pageCtx.current().id, items: window.__ts.pageCtx.ctl().state().items.slice() })), before);
		await page.eval(() => { document.querySelector('.ts-home-more').open = true; });
		await page.waitFor('.ts-home-more-body .ts-home-links');
		assert.deepEqual(await page.eval(() => [...document.querySelectorAll('.ts-home-more-body > .ts-home-links a')].map(a => a.getAttribute('href'))), ['#/browse', '#/genres', '#/works', '#/channels', '#/mix', '#/map']);
		assert.ok(await page.eval(() => document.documentElement.scrollWidth <= innerWidth));
		const globalMix = await page.eval(() => ToyKit.load('dailyMixDemo', null));
		const scope = await page.eval(() => {
			const c = window.__ts.pageCtx, artist = Object.keys(c.idx().artists)[0];
			const id = window.__ts.createSmart('Focused home test', { artists: [artist] });
			window.__ts.setFocus(id); return window.__ts.scopeTracks().filter(t => c.L.playable(t) && !t.blocked).map(t => t.id);
		});
		await page.waitFor(() => !!document.querySelector('[data-home-daily]') && !document.querySelector('[data-home-daily]').disabled);
		await page.click('[data-home-daily]');
		await page.waitFor(() => window.__ts.pageCtx.player().state() === 'playing');
		assert.ok(await page.eval(ids => window.__ts.pageCtx.ctl().state().items.every(id => ids.includes(id)), scope));
		assert.deepEqual(await page.eval(() => ToyKit.load('dailyMixDemo', null)), globalMix);
		await page.eval(() => window.__ts.setFocus(null));
		await page.eval(() => { location.hash = '#/search?q=ZzzUnfindableArtist992'; });
		await page.waitFor('.ts-home-search-handoff');
		assert.equal(await page.eval(() => document.querySelector('.ts-home-search-handoff a').getAttribute('href')), '#/for-you?artist=ZzzUnfindableArtist992');
		await page.click('.ts-home-search-handoff a');
		await page.waitFor('.ts-discovery-result h3');
		assert.equal(await page.eval(() => document.querySelector('.ts-discovery-result h3').textContent), 'Music by ZzzUnfindableArtist992');
		assert.deepEqual(page.errors, []); assert.deepEqual(page.externalHosts, []);
		await page.close();
	}
	const page = await newPage({ width: 390, height: 844, mobile: true, theme: 'light' });
	await page.goto(baseUrl + 'misc/101-true-shuffle/?player=mock'); await page.waitFor('.ts-home-welcome');
	assert.equal(await page.eval(() => document.querySelector('.ts-home-steps').children.length), 3);
	assert.equal(await page.eval(() => document.querySelector('.ts-home-welcome a').getAttribute('href')), '?demo=1');
	assert.ok(await page.eval(() => document.querySelector('.ts-home-demo-note').textContent.includes('simulated player')));
	assert.ok(await page.eval(() => document.documentElement.scrollWidth <= innerWidth));
	await page.screenshot(outDir + '/true-shuffle-onboarding-light-390.png');
	assert.deepEqual(page.errors, []); assert.deepEqual(page.externalHosts, []); await page.close();
}
