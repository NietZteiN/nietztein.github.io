export default async function ({newPage, baseUrl, assert, outDir}) {
	for (const theme of ['dark', 'light']) for (const width of [1280, 390]) {
		const page = await newPage({width, height: width === 390 ? 844 : 860, mobile: width === 390, theme});
		const go = async hash => { await page.eval(hash => { location.hash = hash; }, hash); await page.waitFor(() => !document.querySelector('.ts-modal')); };
		const named = async (selector, label) => {
			await page.eval(({selector, label}) => { document.querySelectorAll('#playlist-test-action').forEach(el => el.removeAttribute('id')); const el = [...document.querySelectorAll(selector)].find(el => el.textContent.trim() === label); if (!el) throw Error('Missing action: ' + label); el.id = 'playlist-test-action'; }, {selector, label});
			await page.click('#playlist-test-action');
		};
		const order = () => page.eval(() => window.__ts.lists().find(li => li.id === 'edit-fixture').ids.slice());
		const rowFocus = async id => {
			await page.eval(() => { const main = document.querySelector('#main'), list = document.querySelector('#view .ts-vlist'); if (list) main.scrollTop += list.getBoundingClientRect().top - main.getBoundingClientRect().top - 100; });
			await page.waitFor('#view .ts-row[data-id="' + id + '"]'); await page.eval(id => { document.querySelector('#view .ts-row[data-id="' + id + '"]').focus(); }, id);
		};
		const rowMenu = async id => { await rowFocus(id); await page.click('#view .ts-row[data-id="' + id + '"] button[aria-label^="More for"]'); await page.waitFor('.ts-menu'); };
		const drag = async p => {
			await page._send('Input.dispatchMouseEvent', {type: 'mouseMoved', x: p.x1, y: p.y1});
			await page._send('Input.dispatchMouseEvent', {type: 'mousePressed', x: p.x1, y: p.y1, button: 'left', buttons: 1, clickCount: 1});
			for (let i = 1; i <= 20; i++) await page._send('Input.dispatchMouseEvent', {type: 'mouseMoved', x: p.x1 + (p.x2 - p.x1) * i / 20, y: p.y1 + (p.y2 - p.y1) * i / 20, button: 'left', buttons: 1});
			// Chromium delivers native HTML dragover after mouse movement; let its last target settle.
			await page.eval(() => new Promise(resolve => setTimeout(resolve, 100)));
			await page._send('Input.dispatchMouseEvent', {type: 'mouseMoved', x: p.x2, y: p.y2, button: 'left', buttons: 1});
			await page.eval(() => new Promise(resolve => setTimeout(resolve, 60)));
			await page._send('Input.dispatchMouseEvent', {type: 'mouseReleased', x: p.x2, y: p.y2, button: 'left', buttons: 0, clickCount: 1});
		};
		await page.goto(baseUrl + 'misc/101-true-shuffle/?demo=1#/lists');
		await page.waitFor(() => !!window.TrueShuffle.playlistEditor && !!document.querySelector('#view h1'));
		await named('#view button', 'New hand-picked playlist');
		assert.equal(await page.eval(() => document.querySelector('.ts-modal input[type="checkbox"]').checked), false);
		await page.type('.ts-modal input[aria-label="Playlist name"]', 'Empty local list');
		await page.click('.ts-modal button[type="submit"]');
		await page.waitFor('.ts-playlist-add');
		assert.equal(await page.eval(() => document.querySelector('#focus-btn').textContent.trim()), 'Everything');
		const fixture = await page.eval(() => {
			const list = window.__ts.lists().find(li => li.name === 'Empty local list'); window.__ts.setFocus(list.id);
			return Object.values(window.__ts.lib.tracks).filter(t => window.TrueShuffle.library.playable(t) && !t.blocked).slice(0, 7).map(t => { const copy = JSON.parse(JSON.stringify(t)); copy.playlists = ['source']; copy.addedAt = {source: Date.now()}; copy.importedAt = new Date().toISOString(); return copy; });
		});
		await page.click('.ts-playlist-add'); await page.waitFor('.ts-playlist-search');
		assert.ok(await page.eval(() => document.querySelectorAll('.ts-playlist-results input').length > 0), 'picker sees the whole library despite empty Focus');
		await page.key('Escape');
		// Real IndexedDB with a mock player verifies persistence without YouTube writes.
		await page.goto(baseUrl + 'misc/101-true-shuffle/?player=mock#/settings');
		await page.waitFor(() => !!window.__ts?.store);
		const ids = fixture.map(t => t.id);
		await page.eval(async ({fixture, ids}) => {
			const s = window.__ts.store; await s.putTracks(fixture); await s.putPlaylists([{id: 'source', title: 'Test local library'}]);
			await s.set('lists', [{id: 'edit-fixture', name: 'Road trip', kind: 'manual', ids: [ids[0], 'missing-upload', ...ids.slice(1, 5)]}, {id: 'drop-fixture', name: 'Drop target', kind: 'manual', ids: []}]); await s.set('focus', 'edit-fixture');
		}, {fixture, ids});
		await page.reload(); await go('#/list/edit-fixture'); await page.waitFor('#view .ts-row');
		await page.eval(ids => window.__ts.playIds(ids.slice(0, 3), 0, {label: 'Queue control', href: '#/songs'}), ids);
		const queueBefore = await page.eval(() => window.__ts.ctl.state().items.slice());
		await page.click('.ts-playlist-add'); await page.waitFor('.ts-playlist-search');
		assert.equal(await page.eval(id => document.querySelector('.ts-playlist-results input[data-id="' + id + '"]').disabled, ids[0]), true);
		await page.type('.ts-playlist-search', fixture[5].title);
		await page.waitFor(id => !!document.querySelector('.ts-playlist-results input[data-id="' + id + '"]'), {args: [ids[5]]});
		await page.click('.ts-playlist-results input[data-id="' + ids[5] + '"]');
		assert.equal(await page.eval(() => document.querySelector('.ts-playlist-picker-actions button').textContent), 'Add 1 song');
		await page.screenshot(outDir + `/shuffle-playlist-picker-${theme}-${width}.png`);
		await named('.ts-playlist-picker-actions button', 'Add 1 song'); await page.waitFor(() => !document.querySelector('.ts-modal'));
		assert.equal((await order()).filter(id => id === ids[5]).length, 1);
		await page.waitFor(() => document.activeElement.classList.contains('ts-playlist-add'));
		await page.eval(id => { const li = window.__ts.lists().find(li => li.id === 'edit-fixture'); li.ids.push(id); window.__ts.pageCtx.lists.save(); }, ids[6]);
		await named('.ts-toast button', 'Undo'); assert.ok(!(await order()).includes(ids[5])); assert.ok((await order()).includes(ids[6]), 'add Undo keeps later additions');
		await rowFocus(ids[1]); await page.key('Alt+ArrowUp');
		assert.deepEqual((await order()).slice(0, 4), [ids[1], 'missing-upload', ids[0], ids[2]]);
		assert.equal(await page.eval(() => document.activeElement.dataset.id), ids[1]);
		await named('.ts-toast button', 'Undo');
		// Multi-selection keeps its relative order and both selected rows.
		await rowFocus(ids[1]);
		await page.click('#view .ts-row[data-id="' + ids[1] + '"] .ts-r-tt');
		await rowFocus(ids[2]); await page.key(' '); await page.key('Alt+ArrowDown');
		assert.deepEqual((await order()).filter(id => id !== 'missing-upload').slice(0, 4), [ids[0], ids[3], ids[1], ids[2]]);
		assert.equal(await page.eval(() => document.querySelectorAll('#view .ts-row.is-sel').length), 2);
		await named('.ts-toast button', 'Undo');
		await rowMenu(ids[1]); await named('[role="menuitem"]', 'Move\u2026'); await named('[role="menuitem"]', 'To the bottom');
		assert.deepEqual((await order()).slice(-2), [ids[1], ids[2]]);
		await named('.ts-toast button', 'Undo');
		await rowFocus(ids[1]); await page.key('Escape');
		await rowMenu(ids[1]); await named('[role="menuitem"]', 'Remove from Road trip');
		await page.eval(id => { const li = window.__ts.lists().find(li => li.id === 'edit-fixture'); if (!li.ids.includes(id)) li.ids.push(id); window.__ts.pageCtx.lists.save(); }, ids[5]);
		await named('.ts-toast button', 'Undo');
		assert.deepEqual((await order()).slice(0, 5), [ids[0], 'missing-upload', ids[1], ids[2], ids[3]]);
		assert.ok((await order()).includes(ids[5]));
		await go('#/list/edit-fixture?sort=title'); await page.waitFor(() => !document.querySelector('.ts-playlist-reorder-hint'));
		const sortedOrder = await order(); await rowFocus(ids[1]); await page.key('Alt+ArrowDown'); assert.deepEqual(await order(), sortedOrder);
		await rowMenu(ids[1]); assert.equal(await page.eval(() => [...document.querySelectorAll('[role="menuitem"]')].some(el => el.textContent.trim() === 'Move\u2026')), false); await page.key('Escape');
		await go('#/list/edit-fixture?dir=rev'); await page.waitFor('.ts-playlist-reorder-hint'); await rowFocus(ids[0]); await page.key('Alt+ArrowUp');
		assert.deepEqual((await order()).slice(0, 3), [ids[1], 'missing-upload', ids[0]], 'reversed Your order writes the corresponding stored order');
		await named('.ts-toast button', 'Undo');
		await go('#/list/edit-fixture'); await page.waitFor('.ts-playlist-reorder-hint'); await page.key('Escape');
		// Browser drag exercises the same real DataTransfer path used by sidebar/queue copying.
		if (width === 1280) {
			await page.eval(() => { const main = document.querySelector('#main'), list = document.querySelector('#view .ts-vlist'); main.scrollTop += list.getBoundingClientRect().top - main.getBoundingClientRect().top - 95; });
			const points = await page.eval(({from, to}) => { const a = document.querySelector('.ts-row[data-id="' + from + '"] .ts-r-tt').getBoundingClientRect(), b = document.querySelector('.ts-row[data-id="' + to + '"]').getBoundingClientRect(); return {x1: a.x + 12, y1: a.y + a.height / 2, x2: b.x + 120, y2: b.y + 3}; }, {from: ids[4], to: ids[0]});
			await drag(points);
			await page.waitFor(id => window.__ts.lists().find(li => li.id === 'edit-fixture').ids[0] === id, {args: [ids[4]]});
			assert.equal((await order())[1], 'missing-upload');
		}
		assert.deepEqual(await page.eval(() => window.__ts.ctl.state().items.slice()), queueBefore, 'editing never changes the playing queue');
		if (width === 1280) {
			const beforeCopy = await order();
			const copyPoints = target => page.eval(({id, target}) => { const a = document.querySelector('.ts-row[data-id="' + id + '"] .ts-r-tt').getBoundingClientRect(), b = document.querySelector(target).getBoundingClientRect(); return {x1: a.x + 12, y1: a.y + a.height / 2, x2: b.x + b.width / 2, y2: b.y + b.height / 2}; }, {id: ids[4], target});
			await drag(await copyPoints('.ts-station[data-list="drop-fixture"]'));
			await page.waitFor(id => window.__ts.lists().find(li => li.id === 'drop-fixture').ids.includes(id), {args: [ids[4]]});
			assert.deepEqual(await order(), beforeCopy, 'sidebar drop copies without moving the source');
			await drag(await copyPoints('#now .ts-tabs'));
			await page.waitFor(count => window.__ts.ctl.state().items.length === count + 1, {args: [queueBefore.length]});
			assert.deepEqual(await order(), beforeCopy, 'queue drop copies without moving the source');
		}
		const persisted = await order(); await page.reload(); await page.waitFor('#view .ts-row'); assert.deepEqual(await order(), persisted);
		await page.screenshot(outDir + `/shuffle-playlist-editor-${theme}-${width}.png`);
		assert.deepEqual(page.errors, []); assert.deepEqual(page.externalHosts, []); await page.close();
	}
}
