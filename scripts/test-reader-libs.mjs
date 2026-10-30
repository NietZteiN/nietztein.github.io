// Dependency scheduling/recovery without a browser or a network.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { createReaderLibs } = createRequire(import.meta.url)('../assets/js/reader-libs.js');

function harness(timeoutMs = 1000) {
	const requests = [];
	const win = { location: { href: 'https://example.test/' }, setTimeout, clearTimeout };
	const head = {
		appendChild(node) { node.parentNode = head; requests.push(node); },
		removeChild(node) { node.parentNode = null; },
	};
	const doc = { head, documentElement: { getAttribute() { return 'light'; } },
		createElement(tag) { return { tag, setAttribute(key, value) { this[key] = value; } }; } };
	const loader = createReaderLibs(win, doc, { rootUrl: 'https://example.test/', timeoutMs });
	function find(key) { return requests.filter((node) => node['data-reader-resource'] === key).at(-1); }
	function complete(key) {
		if (key === 'marked') win.marked = { parse() {}, setOptions() {} };
		if (key === 'sanitize') win.DOMPurify = { sanitize() {} };
		if (key === 'highlight') win.hljs = { highlightElement() {} };
		if (key === 'katex') win.katex = { render() {} };
		if (key === 'math-render') win.renderMathInElement = function () {};
		find(key).onload();
	}
	return { loader, requests, win, find, complete };
}

{
	const h = harness();
	h.loader.setTheme(true);
	assert.equal(h.requests.length, 0, 'Theme changes alone never download styles');
	const first = h.loader.ensureCore(), second = h.loader.ensureCore();
	assert.equal(first, second, 'Core consumers share one pending promise');
	assert.equal(h.requests.length, 2);
	h.complete('marked'); h.complete('sanitize');
	assert.equal((await first).DOMPurify, h.win.DOMPurify);
	await h.loader.ensureCore();
	assert.equal(h.requests.length, 2, 'Resolved dependencies remain shared');
}
{
	const h = harness();
	const failed = h.loader.ensureCore();
	h.find('marked').onerror(); h.complete('sanitize');
	await assert.rejects(failed, { readerResource: 'marked' });
	const retried = h.loader.ensureCore();
	assert.equal(h.requests.length, 3, 'A failed core resource retries without reloading its successful sibling');
	h.complete('marked'); await retried;
}
{
	const h = harness(15);
	const failed = h.loader.ensureCore();
	h.complete('sanitize');
	await assert.rejects(failed, { readerResource: 'marked' });
	assert.equal(h.find('marked').parentNode, null, 'Timed-out tags are detached');
	const retried = h.loader.ensureCore();
	h.complete('marked'); await retried;
}
{
	const h = harness();
	const first = h.loader.ensureMath(), second = h.loader.ensureMath();
	assert.equal(h.requests.length, 2, 'KaTeX and its CSS start once');
	assert.equal(h.find('math-render'), undefined, 'Auto-render waits for KaTeX');
	h.complete('katex');
	await Promise.resolve();
	assert.equal(h.requests.filter((n) => n['data-reader-resource'] === 'math-render').length, 1);
	h.complete('math-render'); h.complete('math-style');
	await Promise.all([first, second]);
}
{
	const h = harness();
	const first = h.loader.ensureHighlight();
	h.complete('highlight'); h.complete('highlight-style-light');
	await first;
	assert.equal(h.find('highlight-style-light').media, 'all');
	h.loader.setTheme(true);
	assert.equal(h.requests.length, 2, 'Missing dark styles wait for a reader request');
	const dark = h.loader.ensureHighlight();
	h.complete('highlight-style-dark'); await dark;
	assert.equal(h.find('highlight-style-light').media, 'not all');
	assert.equal(h.find('highlight-style-dark').media, 'all');
	h.loader.setTheme(false);
	assert.equal(h.requests.length, 3, 'Returning to an already loaded theme uses its existing sheet');
	assert.equal(h.find('highlight-style-light').media, 'all');
}
console.log('Reader libraries: lazy scheduling, deduplication, ordered math, theme reuse, failures and timeout recovery passed');
