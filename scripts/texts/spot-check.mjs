/*
 * Spot checks of misc/_texts against the live sources. Needs the network; uses no cache.
 *
 *     node scripts/texts/spot-check.mjs [seed]
 *
 *   1. three paragraphs of the German text against the Project Gutenberg file, fetched again;
 *   2. all 38 Kieu lines against the three Wikisource pages as they are rendered today (the
 *      four lines that were corrected against the print are compared in the reading Wikisource
 *      had; the print itself is an image and can only be read by eye);
 *   3. twenty sentences against their Tatoeba numbers (text, owner, language, licence, and
 *      that the English translation is still a direct translation with the same text);
 *   4. twenty CMU entries against the raw dictionary, fetched again.
 * The samples are drawn with a seeded generator (the seed is the first argument, default
 * "2026-10-03"), so a run can be repeated. One request at a time, 1.5 s apart: about 45
 * requests, a little over a minute. Prints PASS or FAIL lines and exits 1 on any failure.
 *
 * This is not part of test.js because it depends on other people's servers.
 */
import path from 'node:path';
import { fresh, loadData, sha256, rng, noBom, OUT } from './lib.mjs';

const seed = process.argv[2] || '2026-10-03';
const random = rng('spot-check ' + seed);
function pick(list, n) {
	const pool = list.slice();
	const out = [];
	while (out.length < n && pool.length) out.push(pool.splice(Math.floor(random() * pool.length), 1)[0]);
	return out;
}
let passed = 0, failed = 0;
function ok(cond, msg) {
	if (cond) { passed++; console.log('PASS  ' + msg); } else { failed++; console.log('FAIL  ' + msg); }
	return cond;
}
function decode(html) {
	return html.replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(Number(d))).replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCodePoint(parseInt(h, 16)))
		.replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
}

/* 1. Zarathustra */
{
	const Z = loadData(path.join(OUT, 'zarathustra-vorrede.js'), 'TEXTS_ZARATHUSTRA');
	const src = Z.meta.sources[0];
	const buf = await fresh(src.url);
	ok(sha256(buf) === src.sha256, 'zarathustra: the Gutenberg file fetched now has the recorded SHA-256 (' + buf.length + ' bytes)');
	// Paragraphs of the file: blocks between blank lines, their lines joined with one space.
	const blocks = new Set(noBom(buf.toString('utf8')).split(/\r?\n\s*\r?\n/).map((b) => b.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).join(' ')));
	const all = [];
	Z.sections.forEach((s) => s.paras.forEach((p, i) => all.push({ n: s.n, i: i + 1, p })));
	for (const x of pick(all, 3)) {
		ok(blocks.has(x.p), 'zarathustra: section ' + x.n + ', paragraph ' + x.i + ' is a paragraph of the file, letter for letter: "' + x.p.slice(0, 60) + (x.p.length > 60 ? '..."' : '"') + ' (' + x.p.length + ' characters)');
	}
}

/* 2. Kieu */
{
	const K = loadData(path.join(OUT, 'kieu-opening.js'), 'TEXTS_KIEU');
	// Lines corrected against the print differ from Wikisource on purpose: look for the reading
	// that was found there (meta.corrections[].wikisource). If a corrected line is no longer on
	// the page as recorded, Wikisource has been edited and the correction should be looked at.
	const asTranscribed = new Map((K.meta.corrections || []).map((c) => [c.line, c.wikisource]));
	let matched = 0;
	for (const page of K.meta.pages) {
		const title = decodeURIComponent(page.url.split('/wiki/')[1]);
		const api = 'https://vi.wikisource.org/w/api.php?action=parse&page=' + encodeURIComponent(title) + '&prop=text%7Crevid&format=json&formatversion=2';
		const j = JSON.parse((await fresh(api)).toString('utf8'));
		const same = j.parse.revid === page.revision;
		console.log('      scan page ' + page.scan + ': revision today ' + j.parse.revid + (same ? ' (the one that was built from)' : ', built from ' + page.revision + ': the page has been edited since'));
		const text = decode(j.parse.text
			.replace(/<sup[^>]*class="[^"]*reference[^"]*"[^>]*>[\s\S]*?<\/sup>/g, '')
			.replace(/<br\s*\/?>/g, '\n').replace(/<\/(p|div|dd|dl|li|h\d)>/g, '\n')
			.replace(/<[^>]+>/g, '')).normalize('NFC');
		const rendered = text.split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
		const [from, to] = page.lines.split('-').map(Number);
		let at = 0;
		for (let n = from; n <= to; n++) {
			const line = asTranscribed.get(n) || K.lines[n - 1];
			const found = rendered.indexOf(line, at);
			if (found === -1) { ok(false, 'kieu: line ' + n + (asTranscribed.has(n) ? ' (as recorded before correction)' : '') + ' is not a line of the rendered page ' + page.scan + ': ' + line); continue; }
			at = found + 1;
			matched++;
		}
	}
	ok(matched === K.lines.length, 'kieu: ' + matched + ' of ' + K.lines.length + ' lines are lines of the rendered Wikisource pages, in order, letter for letter (' + asTranscribed.size + ' of them in the reading recorded before the correction against the print)');
}

/* 3. Tatoeba */
{
	const S = loadData(path.join(OUT, 'sentences.js'), 'TEXTS_SENTENCES');
	const all = [];
	S.langs.forEach((l) => l.sentences.forEach((s) => all.push({ l, s })));
	let good = 0;
	const sample = pick(all, 20);
	for (const x of sample) {
		const url = 'https://api.tatoeba.org/v1/sentences/' + x.s.id + '?' + encodeURIComponent('showtrans:lang') + '=eng';
		let d = null;
		try { d = JSON.parse((await fresh(url)).toString('utf8')).data; } catch (err) { ok(false, 'tatoeba #' + x.s.id + ' (' + x.l.code + '): ' + err.message); continue; }
		const translations = [].concat(...(d.translations || []).map((t) => (Array.isArray(t) ? t : [t])));
		const en = translations.find((t) => t.id === x.s.en.id);
		const problems = [];
		if (d.text !== x.s.text) problems.push('text is now ' + JSON.stringify(d.text));
		if (d.owner !== x.s.by) problems.push('owner is now ' + d.owner);
		if (d.lang !== x.l.iso) problems.push('language is now ' + d.lang);
		if (d.license !== 'CC BY 2.0 FR') problems.push('licence is now ' + d.license);
		if (!en) problems.push('translation #' + x.s.en.id + ' is no longer linked');
		else {
			if (en.text !== x.s.en.text) problems.push('translation text is now ' + JSON.stringify(en.text));
			if ((en.owner || '') !== x.s.en.by) problems.push('translation owner is now ' + en.owner);
			if (en.is_direct === false) problems.push('translation is no longer direct');
		}
		if (!problems.length) good++;
		ok(!problems.length, 'tatoeba #' + x.s.id + ' (' + x.l.code + ', by ' + x.s.by + '): ' + (problems.length ? problems.join('; ') : x.s.text + '  =  ' + x.s.en.text + ' (#' + x.s.en.id + ')'));
	}
	console.log('      ' + good + ' of ' + sample.length + ' sentences agree with Tatoeba today');
}

/* 4. CMU */
{
	const C = loadData(path.join(OUT, 'cmu-phones.js'), 'TEXTS_CMU');
	const src = C.meta.sources[0];
	const buf = await fresh(src.url);
	ok(sha256(buf) === src.sha256, 'cmu: the dictionary fetched now has the recorded SHA-256 (' + buf.length + ' bytes)');
	const raw = '\n' + buf.toString('utf8');
	let good = 0;
	const sample = pick(Object.keys(C.w), 20);
	for (const word of sample) {
		// the first line of the raw file that begins with the word and a space
		const at = raw.indexOf('\n' + word + ' ');
		const line = at === -1 ? '' : raw.slice(at + 1, raw.indexOf('\n', at + 1));
		const expected = word + ' ' + C.w[word];
		const same = line === expected || line.startsWith(expected + ' #');
		if (same) good++;
		ok(same, 'cmu: ' + expected + (same ? '' : '   but the raw file has: ' + line));
	}
	console.log('      ' + good + ' of ' + sample.length + ' words agree with the raw dictionary');
}

console.log('\n' + passed + ' passed, ' + failed + ' failed (seed ' + seed + ')');
process.exit(failed ? 1 : 0);
