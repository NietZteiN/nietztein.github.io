// Run: node scripts/qa/drive.mjs scripts/qa/publications.drive.mjs
// Check discovery, source links, citation content and filtered CV printing.
export default async function ({ newPage, baseUrl, assert, outDir }) {
	for (const theme of ['light', 'dark']) {
		for (const width of [1280, 390]) {
			const page = await newPage({ width, height: 900, theme, mobile: width < 600 });
			await page.goto(baseUrl + '#/publications?topic=meaning');
			await page.waitFor('.publication-tools');
			assert.equal(await page.eval(() => document.querySelectorAll('#publicationsContent .pub-block:not([hidden])').length), 2);
			assert.equal(await page.eval(() => document.querySelector('.publication-count').textContent), '2 of 12 publications');
			assert.equal(await page.eval(() => Array.from(document.querySelectorAll('#publicationsContent h3:not([hidden])')).map(n => n.textContent.trim()).join('|')), 'Philosophical preprints');
			await page.click('.publication-filter[data-topic="comprehension"]');
			assert.equal(await page.eval(() => location.hash), '#/publications?topic=comprehension');
			assert.equal(await page.eval(() => document.querySelectorAll('#publicationsContent .pub-block:not([hidden])').length), 5);
			await page.click('.publication-filter[data-topic="science"]');
			assert.equal(await page.eval(() => document.querySelectorAll('#publicationsContent .pub-block:not([hidden])').length), 1);
			assert.equal(await page.eval(() => document.querySelector('#publicationsContent .pub-block:not([hidden]) .publication-status').textContent), 'Submitted / preprint');
			await page.click('.publication-filter[data-topic=""]');
			assert.equal(await page.eval(() => location.hash), '#/publications');
			assert.equal(await page.eval(() => document.querySelectorAll('#publicationsContent .pub-block:not([hidden])').length), 12);
			await page.click('.publication-cite > summary');
			assert.match(await page.eval(() => document.querySelector('.publication-reference').value), /J\. V\. Le \(2026\).*10\.1145\/3837729\.3839573|J\. V\. Le \(2026\).*2026SPLASH-SRC\.pdf/);
			assert.equal(await page.eval(() => document.querySelectorAll('.publication-question').length), 12);
			assert.equal(await page.eval(() => document.querySelectorAll('.publication-actions a').length), 10);
			assert.equal(await page.eval(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), false);
			assert.deepEqual(page.errors.filter(e => e.type === 'exception'), []);
			await page.eval(() => new Promise(resolve => window.setTimeout(resolve, 1500)));
			await page.eval(() => window.scrollTo({ top: document.querySelector('.publication-tools').getBoundingClientRect().top + window.scrollY - 70, behavior: 'instant' }));
			await page.screenshot(outDir + '/publications-' + theme + '-' + width + '.png');
			await page.click('.publication-filter[data-topic="meaning"]');
			await page._send('Emulation.setEmulatedMedia', { media: 'print' });
			assert.equal(await page.eval(() => Array.from(document.querySelectorAll('#publicationsContent .pub-block')).filter(n => getComputedStyle(n).display !== 'none').length), 12);
			assert.equal(await page.eval(() => getComputedStyle(document.querySelector('.publication-tools')).display), 'none');
			await page.close();
		}
	}
}
