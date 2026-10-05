// Spot checks of misc/_lang against its sources, each by another route than
// the one the build takes. Needs the network (the Wikisource and Wikipedia
// pages are fetched again, live); the big dictionary files come from the cache.
//
//   node scripts/lang/spot-check.mjs [--seed <text>]
//
// The samples are drawn with a seeded generator; the seed (today's date unless
// given) is printed, so a run can be repeated.
//
//   1  five poems against the Japanese Wikisource page as rendered today (HTML,
//      where the build reads the wikitext of a pinned revision), with the
//      corrections and the kanji forms of meta undone; then the readings and
//      the poets against the table in Japanese Wikipedia as rendered today
//      (the differences must be exactly meta.variants), and the corrected
//      readings against a third list of the poems
//   2  all 100 first lines of Porter's verses against the list of first lines
//      on the work's front page at English Wikisource; and the opening of each
//      romanised poem against the kana reading
//   3  ten kanji's parts against the lines of the raw KRADFILE; all of them
//      against the JSON edition of KRADFILE published by jmdict-simplified
//   4  the kanji records against the JSON edition of KANJIDIC2 (another
//      parser, another day's file); the grades against the table of kanji by
//      school year in Japanese Wikipedia
//   5  jmdict-core rows against the JSON edition of JMdict
//   6  ten accents against the lines of the raw Kanjium file
//   7  the first ten ruby against the raw Aozora file
//
// Exit code 1 if a check that must hold exactly fails. Differences that come
// from comparing two editions of a dictionary are listed, not failed.

import zlib from 'node:zlib';
import { fetchCached, unzip, untarGz, loadDataFile, seededRng, USER_AGENT, isKanjiCp } from './lib.mjs';
import { URLS } from './edrdg.mjs';
import { KANJIUM_COMMIT } from './kanjium.mjs';

const seedAt = process.argv.indexOf('--seed');
const seed = seedAt >= 0 ? process.argv[seedAt + 1] : new Date().toISOString().slice(0, 10);
const rng = seededRng(seed);
console.log('seed: ' + seed);

let failed = 0;
function section(title) {
	console.log('\n== ' + title);
}
function result(ok, text) {
	if (!ok) failed++;
	console.log((ok ? 'PASS ' : 'FAIL ') + text);
}
function sample(list, n) {
	const pool = list.slice();
	const out = [];
	while (out.length < n && pool.length) out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
	return out;
}
async function live(url) {
	await new Promise((r) => setTimeout(r, 1000));
	const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
	if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
	return res.text();
}
function htmlText(s) {
	return s
		.replace(/<[^>]+>/g, '')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&nbsp;/g, ' ')
		.replace(/&amp;/g, '&');
}
function diffAt(a, b) {
	const x = [...a];
	const y = [...b];
	for (let i = 0; i < Math.max(x.length, y.length); i++) if (x[i] !== y[i]) return `character ${i + 1}: ${JSON.stringify(x[i])} against ${JSON.stringify(y[i])}`;
	return null;
}

const H = loadDataFile('hyakunin.js', 'LANG_HYAKUNIN');
const K = loadDataFile('kanji.js', 'LANG_KANJI');
const J = loadDataFile('jmdict-core.js', 'LANG_JMDICT');
const A = loadDataFile('accents.js', 'LANG_ACCENT');
const Y = loadDataFile('texts/yume-juya-1.js', 'LANG_TEXT_YUMEJUYA1');

// ---- 1. five poems against Japanese Wikisource, fetched again -------------------------

section('1. Five poems, character by character, against the Japanese Wikisource page as rendered now');
{
	const pinnedUrl = H.meta.sources[0].url;
	const title = new URL(pinnedUrl).searchParams.get('title');
	const pinnedRev = +new URL(pinnedUrl).searchParams.get('oldid');
	const info = JSON.parse(await live('https://ja.wikisource.org/w/api.php?' + new URLSearchParams({ action: 'query', prop: 'revisions', rvprop: 'ids|timestamp', titles: title, format: 'json', formatversion: '2' })));
	const liveRev = info.query.pages[0].revisions[0];
	console.log(`page revision now: ${liveRev.revid} (${liveRev.timestamp}); the build is pinned to ${pinnedRev}${liveRev.revid === pinnedRev ? ': the same' : ': the page has been edited since'}`);
	const html = await live('https://ja.wikisource.org/w/index.php?' + new URLSearchParams({ title, action: 'render' }));
	const rowsHtml = html.split(/<tr[\s>]/).slice(1);
	const byNumber = new Map();
	let n = 0;
	for (const row of rowsHtml) {
		if (!/<span id="[^"]+">[^<]+<\/span>/.test(row)) continue;
		n++;
		const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]);
		const poemLines = cells[0].split(/<br[^>]*>/).map((s) => htmlText(s).trim());
		const poetLines = cells[1].split(/<br[^>]*>/).map((s) => htmlText(s).trim());
		byNumber.set(n, { poemLines, poetLines });
	}
	result(byNumber.size === 100, `the rendered page has ${byNumber.size} poem rows`);
	const strip = (s) => s.replace(/^（/, '').replace(/）$/, '');
	// What the page prints, worked back from the data: the kanji forms of
	// meta.forms and then the corrections of meta.corrections undone.
	const asPrinted = (poem) => {
		const p = { n: poem.n, text: poem.text, kana: poem.kana, poet: poem.poet, poetKana: poem.poetKana };
		for (const f of H.meta.forms.replaced) for (const field of ['text', 'poet']) if (f[field].includes(p.n)) p[field] = p[field].split(f.to).join(f.from);
		for (const c of H.meta.corrections) {
			if (c.n !== p.n) continue;
			if (c.field === 'poet') {
				if (p.poet !== c.to) throw new Error(`poem ${p.n}: the poet is not the corrected ${c.to}`);
				p.poet = c.from;
			} else {
				const phrases = p[c.field].split(' ');
				if (phrases[c.phrase - 1] !== c.to) throw new Error(`poem ${p.n}: phrase ${c.phrase} of ${c.field} is not the corrected ${c.to}`);
				phrases[c.phrase - 1] = c.from;
				p[c.field] = phrases.join(' ');
			}
		}
		return p;
	};
	const compare = (poem) => {
		const p = asPrinted(poem);
		const row = byNumber.get(p.n);
		const expected = {
			text: row.poemLines[0] + ' ' + row.poemLines[1],
			kana: strip(row.poemLines[2]) + ' ' + strip(row.poemLines[3]),
			poet: row.poetLines[0],
			poetKana: strip(row.poetLines[1]),
		};
		return Object.keys(expected)
			.map((f) => (diffAt(p[f], expected[f]) ? `${f}: ${diffAt(p[f], expected[f])}` : null))
			.filter(Boolean);
	};
	for (const p of sample(H.poems, 5).sort((a, b) => a.n - b.n)) {
		const problems = compare(p);
		const chars = [...p.text, ...p.kana, ...p.poet, ...p.poetKana].length;
		result(problems.length === 0, `poem ${p.n} (${p.poet}): ${problems.length ? problems.join('; ') : chars + ' characters of text, reading, poet and poet reading are identical'}`);
	}
	const differing = H.poems.filter((p) => compare(p).length);
	result(differing.length === 0, `all 100 poems compared the same way, with ${H.meta.corrections.length} corrections and ${H.meta.kept.placesInJoyoForm} kanji forms undone: ${100 - differing.length} identical${differing.length ? '; differ: ' + differing.map((p) => p.n).join(', ') : ''}`);
}

section('1b. Readings and poets against the table of poems in Japanese Wikipedia as rendered now; the corrected readings against a third list');
{
	const expand = (kana) => {
		let out = '';
		for (const ch of kana) out += ch === 'ゝ' ? out[out.length - 1] : ch === 'ゞ' ? String.fromCodePoint(out.codePointAt(out.length - 1) + 1) : ch;
		return out;
	};
	const pinnedUrl = H.meta.sources.find((s) => /meta\.corrections/.test(s.gives || '')).url;
	const title = new URL(pinnedUrl).searchParams.get('title');
	const pinnedRev = +new URL(pinnedUrl).searchParams.get('oldid');
	const info = JSON.parse(await live('https://ja.wikipedia.org/w/api.php?' + new URLSearchParams({ action: 'query', prop: 'revisions', rvprop: 'ids|timestamp', titles: title, format: 'json', formatversion: '2' })));
	const liveRev = info.query.pages[0].revisions[0];
	console.log(`page revision now: ${liveRev.revid} (${liveRev.timestamp}); the build is pinned to ${pinnedRev}${liveRev.revid === pinnedRev ? ': the same' : ': the page has been edited since'}`);
	const html = await live('https://ja.wikipedia.org/w/index.php?' + new URLSearchParams({ title, action: 'render' }));
	// Rows of the table: a number, the poet, the poem with each kanji followed by its reading in parentheses.
	const rows = new Map();
	for (const row of html.split(/<tr[\s>]/).slice(1)) {
		const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]);
		if (cells.length < 3 || !/^\d+$/.test(htmlText(cells[0]).trim())) continue;
		const n = +htmlText(cells[0]).trim();
		if (n < 1 || n > 100 || rows.has(n)) continue;
		const halves = cells[2]
			.replace(/<sup[\s\S]*?<\/sup>/g, '') // footnote marks
			.split(/<br[^>]*>/)
			.map((s) => htmlText(s).trim().split(/\s+/));
		if (halves.length !== 2) continue;
		// The reading of a phrase: every run of kanji gives way to the reading in the parentheses after it.
		const hiragana = String.fromCharCode(0x3041) + '-' + String.fromCharCode(0x3096);
		const kanjiWithReading = new RegExp('[^（）' + hiragana + ']+（([^（）]+)）', 'g');
		const reading = (phrase) => phrase.replace(kanjiWithReading, '$1');
		rows.set(n, { poet: htmlText(cells[1]).trim(), kana: [...halves[0], ...halves[1]].map(reading) });
	}
	result(rows.size === 100, `the rendered table has ${rows.size} poem rows`);
	if (rows.size === 100) {
		const found = [];
		for (const p of H.poems) {
			const row = rows.get(p.n);
			p.kana.split(' ').forEach((phrase, i) => {
				if (expand(phrase) !== row.kana[i]) found.push({ n: p.n, field: 'kana', phrase: i + 1, here: phrase, there: row.kana[i] });
			});
			if (p.poet !== row.poet) found.push({ n: p.n, field: 'poet', here: p.poet, there: row.poet });
		}
		const key = (v) => [v.n, v.field, v.phrase || 0, v.here, v.there].join('|');
		// A name the table prints in an older form of the same kanji is not a variant; meta.forms says which forms are the same.
		const sameForms = (a, b) => {
			let x = a;
			let y = b;
			for (const f of H.meta.forms.replaced) {
				x = x.split(f.from).join(f.to);
				y = y.split(f.from).join(f.to);
			}
			return x === y;
		};
		const expected = new Set(H.meta.variants.map(key));
		const unexpected = found.filter((v) => !expected.has(key(v)) && !(v.field === 'poet' && sameForms(v.here, v.there)));
		const gone = H.meta.variants.filter((v) => !found.some((f) => key(f) === key(v)));
		result(unexpected.length === 0 && gone.length === 0, `readings and poets of 100 poems against the table: ${found.length} places differ, meta.variants lists ${H.meta.variants.length}${unexpected.length ? '; not in meta.variants: ' + unexpected.map((v) => `${v.n} ${v.field} ${v.here}/${v.there}`).join(', ') : ''}${gone.length ? '; in meta.variants but no longer different: ' + gone.map((v) => v.n + ' ' + v.field).join(', ') : ''}`);
		for (const c of H.meta.corrections) {
			const row = rows.get(c.n);
			if (c.field === 'poet') result(row.poet === c.to, `correction, poem ${c.n}, poet: ${c.to} (the Wikisource page: ${c.from}); the table prints ${row.poet}`);
			else if (c.field === 'kana') result(row.kana[c.phrase - 1] === c.to, `correction, poem ${c.n}, reading of phrase ${c.phrase}: ${c.to} (the Wikisource page: ${c.from}); the table reads ${row.kana[c.phrase - 1]}`);
		}
	}

	// A third list, used only here: a page that prints the hundred poems in kana.
	// It has slips of its own, so only the corrected readings must be found in it;
	// for the rest the count is reported.
	const THIRD = 'https://hyakunin.stardust31.com/kimariji.html';
	let third = null;
	try {
		third = (await live(THIRD))
			.replace(/<script[\s\S]*?<\/script>/gi, '')
			.replace(/<[^>]+>/g, '')
			.replace(/&nbsp;/g, '')
			.split(String.fromCharCode(0x3000)) // the full-width space
			.join('')
			.replace(/\s+/g, '');
	} catch (err) {
		console.log(`SKIPPED the third list (${THIRD}): ${err.message}`);
	}
	if (third !== null) {
		const flat = (s) => expand(s.replace(/ /g, ''));
		const half = (c) => (c.phrase <= 3 ? 'kami' : 'shimo');
		for (const c of H.meta.corrections.filter((x) => x.field === 'kana')) {
			const p = H.poems[c.n - 1];
			const now = flat(p[half(c)]);
			const phrases = p[half(c)].split(' ');
			phrases[c.phrase <= 3 ? c.phrase - 1 : c.phrase - 4] = c.from;
			const before = flat(phrases.join(' '));
			// Where the correction adds a kana, the old reading is part of the new one and cannot be looked for by itself.
			const beforeAbsent = now.includes(before) ? null : !third.includes(before);
			result(third.includes(now) && beforeAbsent !== false, `correction, poem ${c.n}: the third list ${third.includes(now) ? 'has' : 'does not have'} ${now}${beforeAbsent === null ? '' : ` and ${beforeAbsent ? 'does not have' : 'has'} ${before}`}`);
		}
		const missing = [];
		for (const p of H.poems) for (const h of ['kami', 'shimo']) if (!third.includes(flat(p[h]))) missing.push(`${p.n} ${h}`);
		console.log(`     of the 200 half poems, ${200 - missing.length} occur in the third list letter for letter; not found: ${missing.join(', ') || 'none'}`);
		const explained = H.meta.variants.filter((v) => v.field === 'kana').map((v) => `${v.n} ${v.phrase <= 3 ? 'kami' : 'shimo'}`);
		const unexplained = missing.filter((m) => !explained.includes(m));
		console.log(`     of those, variants named in meta.variants: ${missing.length - unexplained.length}; others (slips or other readings in that list, not checked further): ${unexplained.join(', ') || 'none'}`);
	}
}

// ---- 2. Porter ---------------------------------------------------------------------------

section("2. Porter: first lines against the list on the work's front page; romanised openings against the kana");
{
	const front = await live('https://en.wikisource.org/w/index.php?' + new URLSearchParams({ title: 'A Hundred Verses from Old Japan', action: 'raw' }));
	const listed = [...front.matchAll(/^# \[\[\/Poem (\d+)\/\|([^\]]+)\]\]/gm)].map((m) => ({ n: +m[1], first: m[2].trim() }));
	const loose = (s) => s.replace(/[^A-Za-z]/g, '').toLowerCase();
	const wrong = listed.filter((l) => loose(H.poems[l.n - 1].en.split('\n')[0]) !== loose(l.first));
	result(listed.length === 100 && wrong.length === 0, `${listed.length} first lines listed; ${listed.length - wrong.length} agree with en, letters only${wrong.length ? '; differ: ' + wrong.map((l) => l.n).join(', ') : ''}`);

	// A rough romanisation of the first phrase of the reading, only to see that
	// poem n of Porter is poem n of the Japanese text. Not shipped anywhere.
	const ROWS = { あ: '', か: 'k', さ: 's', た: 't', な: 'n', は: 'h', ま: 'm', や: 'y', ら: 'r', わ: 'w', が: 'g', ざ: 'z', だ: 'd', ば: 'b', ぱ: 'p' };
	const TABLE = {};
	const gojuon = ['あいうえお', 'かきくけこ', 'さしすせそ', 'たちつてと', 'なにぬねの', 'はひふへほ', 'まみむめも', 'や ゆ よ', 'らりるれろ', 'わゐ ゑを', 'がぎぐげご', 'ざじずぜぞ', 'だぢづでど', 'ばびぶべぼ', 'ぱぴぷぺぽ'];
	for (const row of gojuon) [...row].forEach((ch, i) => { if (ch !== ' ') TABLE[ch] = ROWS[row[0]] + 'aiueo'[i]; });
	TABLE['ん'] = 'n';
	const rough = (kana) => [...kana].map((ch) => TABLE[ch] || '').join('');
	// Compare consonant skeletons, so that spelling habits (wo/o, he/e, dzu/zu, shi/si) do not matter much.
	const skeleton = (s) =>
		s
			.toLowerCase()
			.replace(/[^a-z]/g, '')
			.replace(/tsu/g, 'tu')
			.replace(/chi/g, 'ti')
			.replace(/sh/g, 's')
			.replace(/ch/g, 't')
			.replace(/j/g, 'z')
			.replace(/[aiueoyhwf]/g, '')
			.replace(/(.)\1/g, '$1');
	const lcs = (a, b) => {
		const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
		for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
		return dp[a.length][b.length];
	};
	const scores = H.poems.map((p) => {
		const expand = (kana) => {
			let out = '';
			for (const ch of kana) out += ch === 'ゝ' ? out[out.length - 1] : ch === 'ゞ' ? String.fromCodePoint(out.codePointAt(out.length - 1) + 1) : ch;
			return out;
		};
		const a = skeleton(rough(expand(p.kana.replace(/ /g, ''))));
		const b = skeleton(p.romaji);
		return { n: p.n, score: lcs(a, b) / Math.max(a.length, b.length) };
	});
	// Each poem must resemble its own romanisation more than its neighbours' do.
	const misplaced = H.poems.filter((p, i) => {
		const own = scores[i].score;
		return [i - 1, i + 1].some((j) => {
			if (j < 0 || j >= 100) return false;
			const a = skeleton(rough(p.kana.replace(/ /g, '')));
			const b = skeleton(H.poems[j].romaji);
			return lcs(a, b) / Math.max(a.length, b.length) >= own;
		});
	});
	const low = scores.filter((s) => s.score < 0.7);
	result(misplaced.length === 0, `consonant skeletons of the kana and of Porter's romanisation: lowest similarity ${Math.min(...scores.map((s) => s.score)).toFixed(2)}, mean ${(scores.reduce((x, s) => x + s.score, 0) / 100).toFixed(2)}; ${misplaced.length} poems resemble a neighbour's romanisation as much as their own`);
	if (low.length) console.log('     below 0.70 (Porter reads the poem differently, or romanises loosely): ' + low.map((s) => `${s.n} (${s.score.toFixed(2)})`).join(', '));
}

// ---- 3. KRADFILE ---------------------------------------------------------------------------

section('3. Kanji parts against the raw KRADFILE (EUC-JP), and against the JSON edition from jmdict-simplified');
const JSON_TAG = '3.6.2+20260928191014';
async function jsonEdition(stem) {
	const name = `${stem}-${JSON_TAG}.json.tgz`;
	const r = await fetchCached('https://github.com/scriptin/jmdict-simplified/releases/download/' + encodeURIComponent(JSON_TAG) + '/' + encodeURIComponent(name), name);
	return JSON.parse([...untarGz(r.buf)][0][1].toString('utf8'));
}
{
	const raw = new TextDecoder('euc-jp', { fatal: true }).decode(zlib.gunzipSync((await fetchCached(URLS.kradfile, 'edrdg-kradfile.gz')).buf));
	const rawLines = raw.split('\n');
	const withParts = Object.keys(K.k).filter((k) => K.k[k].parts.length);
	for (const k of sample(withParts, 10)) {
		const line = rawLines.find((l) => l.startsWith(k + ' : '));
		const same = line !== undefined && line.slice([...k].join('').length + 3).trim() === K.k[k].parts.join(' ');
		result(same, `${k}  parts: ${K.k[k].parts.join(' ')}   raw line: ${line}`);
	}
	const edition = await jsonEdition('kradfile');
	const differ = withParts.filter((k) => JSON.stringify(edition.kanji[k]) !== JSON.stringify(K.k[k].parts));
	result(differ.length === 0, `${withParts.length - differ.length} of ${withParts.length} kanji have the same parts in the JSON edition${differ.length ? '; differ: ' + differ.join(' ') : ''}`);
	for (const k of K.meta.noParts.kanji) console.log(`     ${k} (no parts): raw KRADFILE has ${rawLines.some((l) => l.startsWith(k + ' : ')) ? 'a line' : 'no line'}; the JSON edition, which merges KRADFILE2, has ${edition.kanji[k] ? edition.kanji[k].join(' ') : 'nothing'}`);
}

// ---- 4. KANJIDIC2 and the grades ----------------------------------------------------------------

section('4. Kanji records against the JSON edition of KANJIDIC2; grades against the table by school year in Japanese Wikipedia');
{
	const edition = await jsonEdition('kanjidic2-en');
	const byLiteral = new Map(edition.characters.map((c) => [c.literal, c]));
	const fields = { m: 0, on: 0, kun: 0, grade: 0, strokes: 0, freq: 0 };
	const examples = [];
	let missing = 0;
	for (const [k, e] of Object.entries(K.k)) {
		const c = byLiteral.get(k);
		if (!c) {
			missing++;
			continue;
		}
		const g = c.readingMeaning.groups[0];
		const theirs = {
			m: g.meanings.filter((x) => x.lang === 'en' && x.value !== '(kokuji)').map((x) => x.value),
			on: g.readings.filter((x) => x.type === 'ja_on').map((x) => x.value),
			kun: g.readings.filter((x) => x.type === 'ja_kun').map((x) => x.value),
			grade: c.misc.grade,
			strokes: c.misc.strokeCounts[0],
			freq: c.misc.frequency,
		};
		for (const f of Object.keys(fields)) {
			if (JSON.stringify(theirs[f]) !== JSON.stringify(e[f])) {
				fields[f]++;
				if (examples.length < 6) examples.push(`${k}.${f}: ${JSON.stringify(e[f])} here, ${JSON.stringify(theirs[f])} there`);
			}
		}
	}
	const total = Object.values(fields).reduce((a, b) => a + b, 0);
	console.log(`     JSON edition dated ${edition.dictDate} (database ${edition.databaseVersion}); ours ${K.meta.sources[0].created} (database ${K.meta.sources[0].version})`);
	result(missing === 0 && fields.grade === 0 && fields.strokes === 0, `2,136 kanji compared: ${missing} missing there; differing fields ${JSON.stringify(fields)}`);
	if (total) console.log('     ' + examples.join('\n     '));

	const page = await live('https://ja.wikipedia.org/w/index.php?' + new URLSearchParams({ title: decodeURIComponent('%E5%AD%A6%E5%B9%B4%E5%88%A5%E6%BC%A2%E5%AD%97%E9%85%8D%E5%BD%93%E8%A1%A8'), action: 'raw' }));
	const sections = page.split(/^== /m).slice(1);
	for (let grade = 1; grade <= 6; grade++) {
		const sec = sections.find((s) => new RegExp('^第' + grade + '学年').test(s));
		if (!sec) {
			result(false, `grade ${grade}: no section in the Wikipedia article`);
			continue;
		}
		const stated = +(/（(\d+)字）/.exec(sec.split('\n')[0]) || [])[1];
		const body = sec.split('\n').slice(1).join('\n').replace(/<ref[\s\S]*?<\/ref>/g, '').replace(/<ref[^>]*\/>/g, '').replace(/\{\{[^{}]*\}\}/g, '');
		const theirs = new Set([...body].filter((ch) => isKanjiCp(ch.codePointAt(0))));
		const ours = new Set(Object.keys(K.k).filter((k) => K.k[k].grade === grade));
		const onlyOurs = [...ours].filter((k) => !theirs.has(k));
		const onlyTheirs = [...theirs].filter((k) => !ours.has(k));
		result(onlyOurs.length === 0 && ours.size === stated, `grade ${grade}: ${ours.size} kanji here, the article states ${stated}; ${onlyOurs.length} of ours are not in its section${onlyOurs.length ? ' (' + onlyOurs.join('') + ')' : ''}; kanji in its section that are not ours: ${onlyTheirs.length}${onlyTheirs.length ? ' (' + onlyTheirs.slice(0, 20).join('') + ')' : ''}`);
	}
}

// ---- 5. JMdict ------------------------------------------------------------------------------------

section('5. jmdict-core rows against the JSON edition of JMdict');
{
	const edition = await jsonEdition('jmdict-eng');
	const index = new Map();
	const add = (key, word) => {
		if (!index.has(key)) index.set(key, []);
		index.get(key).push(word);
	};
	for (const word of edition.words) {
		for (const kana of word.kana) {
			add('|' + kana.text, word);
			for (const kanji of word.kanji) add(kanji.text + '|' + kana.text, word);
		}
	}
	let found = 0;
	let glossSame = 0;
	const notFound = [];
	const glossDiffers = [];
	for (const [kanji, kana, gloss] of J.e) {
		const words = index.get(kanji + '|' + kana);
		if (!words) {
			notFound.push(kanji + '|' + kana);
			continue;
		}
		found++;
		if (words.some((w) => w.sense.some((s) => s.gloss.length && s.gloss[0].text === gloss))) glossSame++;
		else if (glossDiffers.length < 8) glossDiffers.push(`${kanji}|${kana}: "${gloss}"`);
	}
	console.log(`     JSON edition dated ${edition.dictDate}; ours ${J.meta.sources[0].created}`);
	result(found / J.e.length > 0.995 && glossSame / J.e.length > 0.99, `${J.e.length} rows: ${found} found there under the same written form and reading, ${glossSame} with the same gloss as the first gloss of a sense`);
	if (notFound.length) console.log('     not found (edited between the two editions): ' + notFound.slice(0, 12).join(', ') + (notFound.length > 12 ? ', ...' : ''));
	if (glossDiffers.length) console.log('     gloss differs (first few): ' + glossDiffers.join('; '));
	const common = new Set();
	for (const word of edition.words) if (word.kanji.some((x) => x.common) || word.kana.some((x) => x.common)) common.add(word.id);
	console.log(`     entries the JSON edition marks common: ${common.size}; rows here: ${J.e.length} (plus ${J.meta.dropped[2].split(' ')[0]} left out for the tags of their first sense and ${J.meta.dropped[3].split(' ')[0]} for their gloss)`);
}

// ---- 6. accents -------------------------------------------------------------------------------------

section('6. Ten accents against the raw lines of Kanjium accents.txt');
{
	const r = await fetchCached(`https://raw.githubusercontent.com/mifunetoshiro/kanjium/${KANJIUM_COMMIT}/data/source_files/raw/accents.txt`, `kanjium-${KANJIUM_COMMIT.slice(0, 8)}-accents.txt`);
	const raw = r.buf.toString('utf8');
	const keys = Object.keys(A.a);
	const fixed = ['橋|はし', '端|はし', '箸|はし'];
	for (const key of [...fixed, ...sample(keys.filter((k) => !fixed.includes(k)), 7)]) {
		const [kanji, kana] = key.split('|');
		const needle = '\n' + (kanji ? kanji + '\t' + kana : kana + '\t') + '\t';
		const at = raw.indexOf(needle);
		const line = at < 0 ? null : raw.slice(at + 1, raw.indexOf('\n', at + 1));
		const numbers = line ? [...new Set(line.split('\t')[2].match(/\d+/g).map(Number))] : null;
		result(line !== null && JSON.stringify(numbers) === JSON.stringify(A.a[key]), `${key}  a: ${JSON.stringify(A.a[key])}   raw line: ${line === null ? 'none' : line.replace(/\t/g, ' | ')}`);
	}
}

// ---- 7. ruby ------------------------------------------------------------------------------------------

section('7. The first ten ruby against the raw Aozora file');
{
	const zip = await fetchCached(Y.meta.sources[0].url, 'aozora-799_ruby_6024.zip');
	const raw = new TextDecoder('shift_jis', { fatal: true }).decode(unzip(zip.buf).get('yume_juya.txt'));
	const start = raw.indexOf(Y.part + '［＃');
	const body = raw.slice(raw.indexOf('\n', start));
	// Straight from the raw text: the ten first 《...》 with the text before each.
	const found = [];
	const re = /《([^》]+)》/g;
	let m;
	while (found.length < 10 && (m = re.exec(body))) found.push({ reading: m[1], before: body.slice(Math.max(0, m.index - 12), m.index) });
	const ours = [];
	for (const line of Y.lines) for (const [s, e, reading] of line.ruby) ours.push({ base: line.t.slice(s, e), reading });
	for (let i = 0; i < 10; i++) {
		const f = found[i];
		const o = ours[i];
		const ok = f.reading === o.reading && f.before.endsWith(o.base);
		result(ok, `${i + 1}. ${o.base}《${o.reading}》   raw: ...${f.before.replace(/\r?\n/g, ' ')}《${f.reading}》`);
	}
	const rawCount = (body.slice(0, body.indexOf('第二夜［＃')).match(/《/g) || []).length;
	result(rawCount === ours.length, `ruby in the raw First Night: ${rawCount}; in the data: ${ours.length}`);
}

console.log('\n' + (failed ? failed + ' check(s) FAILED' : 'all spot checks passed'));
process.exit(failed ? 1 : 0);
