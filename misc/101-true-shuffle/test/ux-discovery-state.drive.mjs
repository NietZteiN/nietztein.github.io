// Artist catalog state survives leaving the page, history and a direct reload.
export default async function ({ newPage, baseUrl, assert, outDir }) {
	for (const theme of ['dark', 'light']) for (const width of [1280, 390]) {
		const page = await newPage({ width, height: width === 390 ? 844 : 860, mobile: width === 390, theme });
		const press = async (label) => {
			await page.eval(text => {
				const b = [...document.querySelectorAll('#fy-artists button')].find(b => b.textContent === text);
				if (!b) throw Error('Missing button ' + text); b.focus();
			}, label); await page.key('Enter');
		};
		await page.goto(baseUrl + 'misc/101-true-shuffle/?demo=1#/for-you?lane=releases&visitor=keep');
		await page.waitFor('#fy-artists');
		const artist = await page.eval(() => document.querySelector('.ts-discovery-picks button').textContent);
		await press(artist); await page.waitFor('.ts-discovery-result .ts-m-row');
		assert.equal(await page.eval(() => new URLSearchParams(location.hash.split('?')[1]).get('artist')), artist);
		assert.equal(await page.eval(() => new URLSearchParams(location.hash.split('?')[1]).get('visitor')), 'keep');
		assert.equal(await page.eval(() => new URLSearchParams(location.hash.split('?')[1]).get('lane')), 'releases');
		assert.equal(await page.eval(() => document.querySelectorAll('.ts-discovery-result [role="tab"],.ts-discovery-result [role="tablist"]').length), 0);
		await press('Albums & EPs');
		const album = await page.eval(() => [...document.querySelectorAll('.ts-discovery-result button')].find(b => /\(\d{4}\)$/.test(b.textContent)).textContent);
		await press(album); await page.waitFor('.ts-discovery-result .ts-m-row');
		await press('Only songs I do not have');
		const before = await page.eval(() => ({ hash: location.hash, title: document.querySelector('.ts-discovery-result h4').textContent, rows: [...document.querySelectorAll('.ts-discovery-result .ts-m-tt')].map(t => t.textContent) }));
		assert.equal(new URLSearchParams(before.hash.split('?')[1]).get('catalog'), 'albums');
		assert.ok(new URLSearchParams(before.hash.split('?')[1]).get('album'));
		assert.equal(new URLSearchParams(before.hash.split('?')[1]).get('missing'), '1');
		await page.eval(() => { location.hash = '#/artists'; }); await page.waitFor(() => !document.querySelector('#fy-artists'));
		await page.eval(() => history.back()); await page.waitFor('.ts-discovery-result h4');
		const snapshot = () => page.eval(() => ({ hash: location.hash, title: document.querySelector('.ts-discovery-result h4').textContent, rows: [...document.querySelectorAll('.ts-discovery-result .ts-m-tt')].map(t => t.textContent) }));
		assert.deepEqual(await snapshot(), before);
		await page.eval(() => history.forward()); await page.waitFor(() => !document.querySelector('#fy-artists'));
		await page.eval(() => history.back()); await page.waitFor('.ts-discovery-result h4'); assert.deepEqual(await snapshot(), before);
		await page.reload(); await page.waitFor('.ts-discovery-result h4'); assert.deepEqual(await snapshot(), before);
		assert.ok(await page.eval(() => [...document.querySelectorAll('.ts-discovery-result button')].find(b => b.textContent === 'Albums & EPs').getAttribute('aria-pressed') === 'true'));
		assert.ok(await page.eval(() => [...document.querySelectorAll('.ts-discovery-result button')].find(b => b.textContent === 'Only songs I do not have').getAttribute('aria-pressed') === 'true'));
		await page.eval(() => document.querySelector('.ts-discovery-result').scrollIntoView({ block: 'start', behavior: 'instant' }));
		await page.screenshot(outDir + `/true-shuffle-discovery-state-${theme}-${width}.png`);
		await press('Back to albums');
		assert.equal(await page.eval(() => new URLSearchParams(location.hash.split('?')[1]).get('album')), null);
		assert.ok(await page.eval(() => document.documentElement.scrollWidth <= innerWidth));
		assert.deepEqual(page.errors, []); assert.deepEqual(page.externalHosts, []); await page.close();
	}
}
