// Duplicate review: scoped/version-aware choices, narrow Undo and local persistence.
export default async function ({ newPage, baseUrl, assert, outDir }) {
	const ids = ['audit-duplicate-a', 'audit-duplicate-b', 'audit-duplicate-c', 'audit-live-a', 'audit-live-b'];
	async function seed(page) {
		await page.eval(async (ids) => {
			const ctx = window.__ts.pageCtx, L = ctx.L, lib = ctx.lib();
			L.setPlaylist(lib, { id: 'local:duplicate-audit', title: 'Audit fixture', ids: ids.slice() });
			L.upsert(lib, ids.map((id, i) => ({ id, title: 'Fixture Band - Comparison Song', channel: i === 1 ? 'Second upload channel' : 'Fixture channel ' + i, durationSec: i === 1 ? 181 : 180, embeddable: i !== 2 })), { playlistId: 'local:duplicate-audit', now: 1 });
			ids.forEach((id, i) => { L.edit(lib, id, { title: 'Comparison Song', artist: 'Fixture Band', version: id.includes('live') ? 'live' : '', rating: i === 0 ? 5 : 2, blocked: i === 2, at: 2 }); lib.tracks[id].plays = i === 0 ? 12 : 3; });
			await ctx.changed(ids, true);
			await new Promise((resolve) => setTimeout(resolve, 180)); // Settle the app's batched redraw before taking focus/bounds snapshots.
			location.hash = '#/fix?tab=dups';
		}, ids);
		await page.waitFor('.ts-dupes');
		await page.waitFor(() => [...document.querySelectorAll('.ts-dupe-group')].some((g) => g.querySelector('h2').textContent === 'Comparison Song'));
	}
	async function markOriginal(page) {
		await page.eval(() => {
			const group = [...document.querySelectorAll('.ts-dupe-group')].find((g) => g.querySelector('[data-id="dupe-copy-audit-duplicate-a"]'));
			if (!group) throw new Error('No original group'); group.id = 'audit-original';
			group.querySelector('[data-id="dupe-copy-audit-duplicate-b"] .ts-dupe-actions button:last-child').id = 'audit-choose';
		});
	}
	for (const theme of ['light', 'dark']) for (const width of [1280, 390]) {
		const page = await newPage({ width, height: width === 390 ? 844 : 900, mobile: width === 390, theme, reducedMotion: true });
		await page.goto(baseUrl + 'misc/101-true-shuffle/?demo=1#/songs');
		await page.waitFor(() => !!window.__ts?.lib);
		await seed(page); await markOriginal(page);
		assert.equal(await page.eval(() => document.querySelectorAll('#audit-original .ts-dupe-copy').length), 3, 'Original copies stay separate from live versions');
		const facts = await page.eval(() => document.querySelector('#audit-original').textContent);
		for (const label of ['Channel', 'Second upload channel', 'Version', 'Length', '3:01', 'Plays', '12', 'Stars', '5 of 5', 'Availability', 'Cannot play here']) assert.ok(facts.includes(label), 'Comparison exposes ' + label);
		const before = await page.eval((ids) => ids.map((id) => ({ id, blocked: window.__ts.lib.tracks[id].blocked, playlists: window.__ts.lib.tracks[id].playlists.slice(), plays: window.__ts.lib.tracks[id].plays, rating: window.__ts.lib.tracks[id].rating, at: window.__ts.lib.tracks[id].stateAt })), ids);
		await page.screenshot(outDir + '/shuffle-duplicates-' + theme + '-' + width + '.png');
		await page.eval(() => document.querySelector('#audit-original .ts-dupe-copies').scrollIntoView({ block: 'start', behavior: 'instant' }));
		await page.screenshot(outDir + '/shuffle-duplicates-comparison-' + theme + '-' + width + '.png');
		assert.equal(await page.eval(() => document.documentElement.scrollWidth > innerWidth), false, 'Review fits the viewport');
		assert.equal(await page.eval(() => [...document.querySelectorAll('#audit-original .ts-dupe-copy')].every((c) => [...c.querySelectorAll('.ts-dupe-facts,button')].every((n) => { const r=n.getBoundingClientRect(), b=c.getBoundingClientRect(); return r.left>=b.left-1 && r.right<=b.right+1; }))), true, 'Facts and actions fit each comparison card');
		await page.click('#audit-choose');
		await page.waitFor(() => !document.querySelector('[data-id="dupe-copy-audit-duplicate-a"]'));
		assert.deepEqual(await page.eval((ids) => ids.slice(0,3).map((id) => window.__ts.lib.tracks[id].blocked), ids), [true, false, true]);
		assert.equal(await page.eval(() => document.activeElement.tagName), 'H1', 'A completed group returns focus to the review heading');
		await page.click('.ts-dupes-tools a[href*="groups=all"]');
		await page.waitFor('[data-id="dupe-copy-audit-duplicate-a"]');
		assert.ok(await page.eval(() => document.querySelector('[data-id="dupe-copy-audit-duplicate-b"]').classList.contains('is-preferred')));
		await page.eval(() => { const ctx=window.__ts.pageCtx; ctx.L.edit(ctx.lib(),'audit-duplicate-a',{work:'Later correction',rating:4}); ctx.lib().tracks['audit-duplicate-a'].channel='Later channel'; ctx.lib().tracks['audit-duplicate-a'].plays=99; });
		await page.eval(() => { [...document.querySelectorAll('.ts-toast button')].find((b) => b.textContent === 'Undo').id = 'audit-undo'; });
		await page.click('#audit-undo');
		assert.deepEqual(await page.eval((ids) => ids.slice(0,3).map((id) => window.__ts.lib.tracks[id].blocked), ids), before.slice(0,3).map((t)=>t.blocked), 'Undo restores mixed previous blocks');
		assert.deepEqual(await page.eval(() => { const t=window.__ts.lib.tracks['audit-duplicate-a']; return [t.work,t.rating,t.channel,t.plays]; }), ['Later correction',4,'Later channel',99], 'Undo preserves intervening metadata and listening data');
		assert.deepEqual(await page.eval((ids)=>ids.map((id)=>window.__ts.lib.tracks[id].playlists),ids), before.map((t)=>t.playlists));
		assert.ok(await page.eval((old)=>window.__ts.lib.tracks['audit-duplicate-a'].stateAt>old,before[0].at));
		// Focus review must not alter a same-song copy outside its visible selection.
		await page.eval(() => { const lib=window.__ts.lib; window.__ts.pageCtx.L.edit(lib,'audit-duplicate-c',{blocked:false}); const list=window.__ts.createSmart('Audit scoped copies',{text:'Comparison Song'}); window.__ts.setFocus(list); });
		await page.waitFor('.ts-dupe-scope');
		assert.ok(await page.eval(()=>document.querySelector('.ts-dupe-scope').textContent.includes('Copies outside Focus')));
		assert.deepEqual(page.errors, []); assert.deepEqual(page.externalHosts, []); await page.close();
	}
	// Real-mode storage, invented non-YouTube ids only. No player/sign-in/network writes.
	const persisted = await newPage({ width:1280, height:900, theme:'light', reducedMotion:true, blockHosts:['accounts.google.com','oauth2.googleapis.com','www.googleapis.com','youtube.googleapis.com','www.youtube.com','www.youtube-nocookie.com'] });
	await persisted.goto(baseUrl+'misc/101-true-shuffle/#/songs'); await persisted.waitFor(()=>!!window.__ts?.store);
	await seed(persisted); await markOriginal(persisted); await persisted.click('#audit-choose');
	await persisted.waitFor(()=>window.__ts.lib.tracks['audit-duplicate-a'].blocked);
	await persisted.eval(async()=>{await window.__ts.pageCtx.store().getTracks();});
	await persisted.reload(); await persisted.waitFor(()=>!!window.__ts?.lib?.tracks['audit-duplicate-a']);
	assert.deepEqual(await persisted.eval((ids)=>ids.slice(0,3).map((id)=>window.__ts.lib.tracks[id].blocked),ids),[true,false,true],'Local duplicate preference survives a real IndexedDB reload');
	assert.deepEqual(persisted.errors, []); assert.deepEqual(persisted.externalHosts, []); await persisted.close();
}
