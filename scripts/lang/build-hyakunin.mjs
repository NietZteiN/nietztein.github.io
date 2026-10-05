// Builds misc/_lang/hyakunin.js: the 100 poems of the Ogura Hyakunin Isshu.
//
//   node scripts/lang/build-hyakunin.mjs            build from the cache (downloads what is missing)
//   node scripts/lang/build-hyakunin.mjs --relock   look up the newest revisions of the wiki pages
//                                                   and pin those in hyakunin.lock.json
//
// Nothing Japanese is written here. Every string in the output is copied from
// one of four wiki pages, each at a pinned revision (scripts/lang/hyakunin.lock.json):
//
//   Japanese Wikisource, the page of the Ogura Hyakunin Isshu: the poem as
//     printed, its reading in historical kana, the poet as printed, the poet's
//     reading, the anthology the poem was taken from.
//   Japanese Wikipedia, the article on the Hyakunin Isshu: its table of the
//     hundred poems, a second witness for the readings and the poets. Where
//     the Wikisource page is wrong, or prints a reading other than the one in
//     use for the game, the place is named in CORRECTIONS below and the string
//     is taken from this table. Every other difference between the two pages
//     is kept in the output as a variant (meta.variants).
//   English Wikisource, William N. Porter, "A Hundred Verses from Old Japan"
//     (1909), the 200 transcribed pages of the poems: the romanised poem, the
//     English verse, and the poet's name as Porter prints it on both pages.
//   Japanese Wikipedia, the article on kimariji: the list of the 100 kimariji
//     as players write them, which the computed ones are checked against.
//
// The Wikisource page writes some kanji in their older forms and the same
// kanji in the current form elsewhere. KANJIDIC2 (EDRDG) says which kanji are
// another form of a joyo kanji; those are written in the joyo form, and every
// such change is listed in the output (meta.forms).
//
// The kimariji is computed: for each poem, the shortest prefix of its kana
// reading that no other poem shares when the cards are read aloud (see
// heardKey below for the two places where that differs from the spelling).

import fs from 'node:fs';
import path from 'node:path';
import { fetchCached, sha256, scriptDir, json, writeDataFile, isKanjiCp, isHiraganaCp, allChars, USER_AGENT } from './lib.mjs';
import { loadKanjidic2, joyoAliases } from './edrdg.mjs';

const lockFile = path.join(scriptDir, 'hyakunin.lock.json');
const relock = process.argv.includes('--relock');

// Page titles, percent-encoded so that this file holds no Japanese of its own.
const JAWS_TITLE = decodeURIComponent('%E5%B0%8F%E5%80%89%E7%99%BE%E4%BA%BA%E4%B8%80%E9%A6%96'); // the Ogura Hyakunin Isshu
const JAWP_TITLE = decodeURIComponent('%E6%B1%BA%E3%81%BE%E3%82%8A%E5%AD%97'); // "kimariji"
const JAWP_TABLE_TITLE = decodeURIComponent('%E7%99%BE%E4%BA%BA%E4%B8%80%E9%A6%96'); // the Hyakunin Isshu
const ENWS_INDEX = 'Hundredversesfro00fujiuoft.djvu';
const ENWS_FIRST = 16; // poem n is on pages 14 + 2n (Japanese side) and 15 + 2n (English side)
const ENWS_LAST = 215;

// ---- revisions ----------------------------------------------------------------

async function api(host, params) {
	const url = `https://${host}/w/api.php?` + new URLSearchParams({ format: 'json', formatversion: '2', ...params });
	await new Promise((r) => setTimeout(r, 1000));
	const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
	if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
	return res.json();
}

async function latestRevision(host, title) {
	const j = await api(host, { action: 'query', prop: 'revisions', rvprop: 'ids|timestamp', titles: title });
	const page = j.query.pages[0];
	if (page.missing) throw new Error(`${host}: no page called ${title}`);
	return { title, revid: page.revisions[0].revid, timestamp: page.revisions[0].timestamp };
}

async function makeLock() {
	const lock = { note: 'Revisions of the wiki pages that scripts/lang/build-hyakunin.mjs reads. Written by --relock; the sha256 of each page is filled in by the build.' };
	lock.jaWikisource = await latestRevision('ja.wikisource.org', JAWS_TITLE);
	lock.jaWikipedia = await latestRevision('ja.wikipedia.org', JAWP_TITLE);
	lock.jaWikipediaTable = await latestRevision('ja.wikipedia.org', JAWP_TABLE_TITLE);
	lock.enWikisource = { index: ENWS_INDEX, pages: {} };
	const titles = [];
	for (let p = ENWS_FIRST; p <= ENWS_LAST; p++) titles.push(`Page:${ENWS_INDEX}/${p}`);
	for (let i = 0; i < titles.length; i += 50) {
		const j = await api('en.wikisource.org', { action: 'query', prop: 'revisions', rvprop: 'ids|timestamp', titles: titles.slice(i, i + 50).join('|') });
		for (const page of j.query.pages) {
			if (page.missing) throw new Error('en.wikisource.org: no page called ' + page.title);
			lock.enWikisource.pages[page.title.split('/')[1]] = { revid: page.revisions[0].revid, timestamp: page.revisions[0].timestamp };
		}
	}
	if (Object.keys(lock.enWikisource.pages).length !== titles.length) throw new Error('en.wikisource.org did not answer for every page');
	return lock;
}

let lock;
if (relock || !fs.existsSync(lockFile)) {
	lock = await makeLock();
	console.log('pinned the newest revisions');
} else {
	lock = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
	// A lock file written before the table of poems became a source.
	if (!lock.jaWikipediaTable) {
		lock.jaWikipediaTable = await latestRevision('ja.wikipedia.org', JAWP_TABLE_TITLE);
		console.log('pinned the newest revision of the Wikipedia table of poems');
	}
}

function pin(entry, hash) {
	if (entry.sha256 && entry.sha256 !== hash) throw new Error(`revision ${entry.revid} no longer has the recorded sha256`);
	entry.sha256 = hash;
}

async function rawRevision(host, entry, cachePrefix) {
	const url = `https://${host}/w/index.php?title=${encodeURIComponent(entry.title)}&oldid=${entry.revid}&action=raw`;
	const r = await fetchCached(url, `${cachePrefix}-${entry.revid}.wikitext`);
	pin(entry, r.sha256);
	return { text: r.buf.toString('utf8'), url, sha256: r.sha256, fetched: r.fetched };
}

const jaws = await rawRevision('ja.wikisource.org', lock.jaWikisource, 'jaws-hyakunin');
const jawp = await rawRevision('ja.wikipedia.org', lock.jaWikipedia, 'jawp-kimariji');
const jawpTable = await rawRevision('ja.wikipedia.org', lock.jaWikipediaTable, 'jawp-hyakunin');

// The 200 Porter pages, 50 revisions to a request.
const porterPages = new Map();
let porterFetched = '';
{
	const numbers = [];
	for (let p = ENWS_FIRST; p <= ENWS_LAST; p++) numbers.push(String(p));
	for (let i = 0; i < numbers.length; i += 50) {
		const batch = numbers.slice(i, i + 50);
		const revids = batch.map((p) => lock.enWikisource.pages[p].revid);
		const url = 'https://en.wikisource.org/w/api.php?' + new URLSearchParams({ action: 'query', prop: 'revisions', rvprop: 'ids|content', rvslots: 'main', format: 'json', formatversion: '2', revids: revids.join('|') });
		const r = await fetchCached(url, `enws-porter-${batch[0]}-${batch[batch.length - 1]}-${sha256(Buffer.from(revids.join(','))).slice(0, 12)}.json`);
		if (r.fetched > porterFetched) porterFetched = r.fetched;
		const j = JSON.parse(r.buf.toString('utf8'));
		for (const page of j.query.pages) {
			const p = page.title.split('/')[1];
			const rev = page.revisions[0];
			if (rev.revid !== lock.enWikisource.pages[p].revid) throw new Error(`page ${p}: got revision ${rev.revid}`);
			const text = rev.slots.main.content;
			pin(lock.enWikisource.pages[p], sha256(Buffer.from(text, 'utf8')));
			porterPages.set(+p, text);
		}
	}
	if (porterPages.size !== 200) throw new Error(`expected 200 Porter pages, got ${porterPages.size}`);
}
// One hash for the 200 pages: the sha256 of the lines "<page> <revision> <sha256 of its wikitext>".
const porterManifest = [...porterPages.keys()].sort((a, b) => a - b).map((p) => `${p} ${lock.enWikisource.pages[p].revid} ${lock.enWikisource.pages[p].sha256}`).join('\n') + '\n';
const porterSha = sha256(Buffer.from(porterManifest));

// The lock file, one page to a line; rewritten only when something changed.
{
	const TAB = '\t';
	const NL = '\n';
	const pageLines = Object.keys(lock.enWikisource.pages)
		.sort((x, y) => x - y)
		.map((p) => TAB + TAB + TAB + JSON.stringify(p) + ': ' + JSON.stringify(lock.enWikisource.pages[p]));
	const lockText = [
		'{',
		TAB + '"note": ' + JSON.stringify(lock.note) + ',',
		TAB + '"jaWikisource": ' + JSON.stringify(lock.jaWikisource) + ',',
		TAB + '"jaWikipedia": ' + JSON.stringify(lock.jaWikipedia) + ',',
		TAB + '"jaWikipediaTable": ' + JSON.stringify(lock.jaWikipediaTable) + ',',
		TAB + '"enWikisource": {',
		TAB + TAB + '"index": ' + JSON.stringify(lock.enWikisource.index) + ',',
		TAB + TAB + '"pages": {',
		pageLines.join(',' + NL),
		TAB + TAB + '}',
		TAB + '}',
		'}',
		'',
	].join(NL);
	JSON.parse(lockText);
	if (!fs.existsSync(lockFile) || fs.readFileSync(lockFile, 'utf8') !== lockText) fs.writeFileSync(lockFile, lockText);
}

// ---- Japanese Wikisource: the table of the poems -------------------------------

const OPEN = '（'; // full-width parentheses around the readings
const CLOSE = '）';
const ITER = 'ゝ'; // hiragana iteration mark: repeat the kana before it
const ITER_VOICED = 'ゞ'; // the same, voiced
const KANJI_ITER = '々';

function fail(msg) {
	throw new Error('build-hyakunin: ' + msg);
}

const DIGITS = '一二三四五六七八九';
function kanjiNumber(s) {
	// 1 to 100 as the table writes them: units, a ten with optional multiplier and unit, or the hundred.
	if (s === '百') return 100;
	const m = /^([二三四五六七八九]?)(十?)([一二三四五六七八九]?)$/.exec(s);
	if (!m || !s) fail('cannot read the number ' + s);
	if (!m[2]) {
		if (m[1] && m[3]) fail('cannot read the number ' + s);
		return DIGITS.indexOf(m[1] || m[3]) + 1;
	}
	return (m[1] ? DIGITS.indexOf(m[1]) + 1 : 1) * 10 + (m[3] ? DIGITS.indexOf(m[3]) + 1 : 0);
}

const CELL = '|style="vertical-align:top"|';
function cell(line, n) {
	if (!line.startsWith(CELL)) fail(`poem ${n}: unexpected cell ${line.slice(0, 40)}`);
	return line.slice(CELL.length);
}
function unlink(s) {
	// [[target|label]] -> label, [[target]] -> target
	return s.replace(/\[\[(?:[^\]|]*\|)?([^\]|]*)\]\]/g, '$1');
}

const isKanaText = (cp) => isHiraganaCp(cp);
const isPoemText = (cp) => isHiraganaCp(cp) || isKanjiCp(cp) || cp === KANJI_ITER.codePointAt(0);

const tableStart = jaws.text.indexOf('{|');
const tableEnd = jaws.text.indexOf('\n|}', tableStart);
if (tableStart < 0 || tableEnd < 0) fail('the table of poems was not found');
const rows = jaws.text.slice(tableStart, tableEnd).split('\n|-\n').slice(2); // caption and header row come first
if (rows.length !== 100) fail(`expected 100 rows, found ${rows.length}`);

const poems = rows.map((row, i) => {
	const n = i + 1;
	const lines = row.split('\n');
	if (lines.length !== 5) fail(`poem ${n}: the row has ${lines.length} cells`);
	const num = /<span id="([^"]+)">([^<]+)<\/span>$/.exec(lines[0]);
	if (!num || num[1] !== num[2] || kanjiNumber(num[2]) !== n) fail(`poem ${n}: the row is numbered ${num && num[2]}`);

	const parts = cell(lines[1], n).split('<br />').map((s) => s.trim());
	if (parts.length !== 4) fail(`poem ${n}: the poem cell has ${parts.length} lines`);
	const [textKami, textShimo, kanaKamiRaw, kanaShimoRaw] = parts;
	if (!kanaKamiRaw.startsWith(OPEN) || !kanaShimoRaw.endsWith(CLOSE)) fail(`poem ${n}: the reading is not in parentheses`);
	const bold = /^'''([^']+)'''/.exec(kanaKamiRaw.slice(1));
	if (!bold) fail(`poem ${n}: no bold kimariji at the start of the reading`);
	const kami = kanaKamiRaw.slice(1).replace(/'''/g, '');
	const shimo = kanaShimoRaw.slice(0, -1);
	for (const [what, s, count, test] of [
		['text, upper half', textKami, 3, isPoemText],
		['text, lower half', textShimo, 2, isPoemText],
		['reading, upper half', kami, 3, isKanaText],
		['reading, lower half', shimo, 2, isKanaText],
	]) {
		const ku = s.split(' ');
		if (ku.length !== count) fail(`poem ${n}: ${what} has ${ku.length} phrases: ${s}`);
		for (const k of ku) if (!allChars(k, test)) fail(`poem ${n}: ${what} has a character outside its script: ${k}`);
	}

	const poetCell = /^\[\[([^\]|]+)\|([^\]|]+)\]\]<br \/>（([^（）]+)）$/.exec(cell(lines[2], n));
	if (!poetCell) fail(`poem ${n}: cannot read the poet cell`);
	if (!allChars(poetCell[2], (cp) => isKanjiCp(cp))) fail(`poem ${n}: poet not in kanji: ${poetCell[2]}`);
	if (!allChars(poetCell[3], isKanaText)) fail(`poem ${n}: poet reading not in hiragana: ${poetCell[3]}`);
	const anthology = unlink(cell(lines[3], n)).trim();
	if (!/^[^\[\]{}|<>]+\d+$/.test(anthology)) fail(`poem ${n}: cannot read the anthology cell: ${anthology}`);

	return {
		n,
		poet: poetCell[2],
		poetKana: poetCell[3],
		poetLink: poetCell[1].replace(/^(w|作者):/, '').replace(/ \(.*\)$/, ''),
		text: textKami + ' ' + textShimo,
		kana: kami + ' ' + shimo,
		kami,
		shimo,
		anthology,
		bold: bold[1].replace(/ /g, ''),
		caption: lines[4], // the picture cell; read only as a check on one correction
	};
});

// ---- Japanese Wikipedia: the published list of kimariji ---------------------------

const listed = [...jawp.text.matchAll(/^\*+ '''([^']+)'''([^：\n]*)：\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/gm)].map((m) => ({
	bold: m[1],
	opening: m[1] + m[2],
	link: m[3].replace(/ \(.*\)$/, ''),
	label: m[4] || m[3],
}));
if (listed.length !== 100) fail(`the Wikipedia list has ${listed.length} entries, expected 100`);
for (const it of listed) if (!allChars(it.bold, isKanaText)) fail('Wikipedia kimariji not in hiragana: ' + it.bold);

// Each listed card is matched to a poem by its poet (link target or printed
// name, as the Wikisource page has them). What is left over on both sides is
// matched only if exactly one of each remains.
const bySound = new Array(100).fill(null);
const listLabel = new Array(100).fill(null); // the poet as the list prints the name
const unmatchedItems = [];
for (const it of listed) {
	const found = poems.filter((p) => p.poetLink === it.link || p.poet === it.label || p.poet === it.link || p.poetLink === it.label);
	if (found.length === 1 && bySound[found[0].n - 1] === null) {
		bySound[found[0].n - 1] = it.bold;
		listLabel[found[0].n - 1] = it.label;
	} else unmatchedItems.push(it);
}
const unmatchedPoems = poems.filter((p) => bySound[p.n - 1] === null);
let matchedByElimination = [];
if (unmatchedItems.length === 1 && unmatchedPoems.length === 1) {
	bySound[unmatchedPoems[0].n - 1] = unmatchedItems[0].bold;
	listLabel[unmatchedPoems[0].n - 1] = unmatchedItems[0].label;
	matchedByElimination = [unmatchedPoems[0].n];
} else if (unmatchedItems.length || unmatchedPoems.length) {
	fail(`could not match the Wikipedia list to the poems: ${unmatchedItems.length} entries and ${unmatchedPoems.length} poems left over`);
}

// ---- Japanese Wikipedia: the table of the poems ------------------------------------

// The table writes a poem in two lines of three and two phrases, each kanji
// (or run of kanji) followed by its reading in full-width parentheses, the
// kimariji in bold, some poems with a footnote. From a phrase come two
// strings: the phrase as written (the readings taken out) and its reading
// (each run of kanji replaced by the reading that follows it).
function tablePhrase(phrase, n) {
	let text = '';
	let kana = '';
	let run = '';
	const chars = [...phrase];
	for (let i = 0; i < chars.length; i++) {
		const ch = chars[i];
		const cp = ch.codePointAt(0);
		if (ch === OPEN) {
			const close = chars.indexOf(CLOSE, i);
			const reading = close < 0 ? '' : chars.slice(i + 1, close).join('');
			if (!run || !allChars(reading, isKanaText)) fail(`Wikipedia table, poem ${n}: cannot read ${phrase}`);
			kana += reading;
			run = '';
			i = close;
		} else if (isKanjiCp(cp) || ch === KANJI_ITER) {
			run += ch;
			text += ch;
		} else if (isHiraganaCp(cp)) {
			if (run) fail(`Wikipedia table, poem ${n}: kanji without a reading in ${phrase}`);
			text += ch;
			kana += ch;
		} else fail(`Wikipedia table, poem ${n}: unexpected character in ${phrase}`);
	}
	if (run) fail(`Wikipedia table, poem ${n}: kanji without a reading at the end of ${phrase}`);
	return { text, kana };
}

const table = [];
{
	const start = jawpTable.text.indexOf('{| class="wikitable');
	const end = jawpTable.text.indexOf('\n|}', start);
	if (start < 0 || end < 0) fail('the Wikipedia table of poems was not found');
	for (const row of jawpTable.text.slice(start, end).split('\n|-').slice(1)) {
		const cells = row
			.split('\n')
			.filter((l) => l.startsWith('|'))
			.map((l) => l.slice(1));
		const num = cells.length >= 3 ? /^style="text-align:right"\|(\d+)$/.exec(cells[0]) : null;
		if (!num) continue; // the heading rows
		const n = +num[1];
		if (n !== table.length + 1) fail(`Wikipedia table: row ${table.length + 1} is numbered ${n}`);
		const poetCell = /^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]$/.exec(cells[1].trim());
		if (!poetCell) fail(`Wikipedia table, poem ${n}: cannot read the poet cell`);
		const poet = (poetCell[2] || poetCell[1]).replace(/<wbr>/g, '');
		if (!allChars(poet, (cp) => isKanjiCp(cp))) fail(`Wikipedia table, poem ${n}: poet not in kanji: ${poet}`);
		const poem = cells[2]
			.replace(/<ref[^>]*\/>/g, '')
			.replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, '') // footnotes on the wording of a poem in other anthologies
			.replace(/'''/g, '') // the kimariji in bold
			.replace(/<wbr>/g, '');
		const halves = poem.split(/<br ?\/?>/).map((s) => s.trim().split(/\s+/));
		if (halves.length !== 2 || halves[0].length !== 3 || halves[1].length !== 2) fail(`Wikipedia table, poem ${n}: not three and two phrases`);
		const phrases = [...halves[0], ...halves[1]].map((ph) => tablePhrase(ph, n));
		table.push({ n, poet, poetLink: poetCell[1].replace(/ \(.*\)$/, ''), text: phrases.map((ph) => ph.text), kana: phrases.map((ph) => ph.kana) });
	}
	if (table.length !== 100) fail(`the Wikipedia table has ${table.length} poems, expected 100`);
}

// ---- corrections from the Wikipedia table ----------------------------------------------

// The places where the output follows the Wikipedia table instead of the
// Wikisource page. An entry names a place and gives the reason; the strings
// are read from the two pages, never written here, and the build stops when
// the pages no longer differ there in the way the entry expects.
//   poet     the poet's name: the two names must differ in one character, the
//            Wikisource page's own link must agree with the table against the
//            page's label, and the Wikipedia list of kimariji must print the
//            name as the table does.
//   phrase   one of the five phrases (1 to 5), in the fields listed: the two
//            pages must differ there by one character (one changed, or one
//            more), and afterwards the two pages must read the whole poem alike.
//            With caption, the Wikisource page's own caption of the picture
//            beside the poem must have the phrase as the table writes it.
const NAME_WHY = 'One character of the name is wrong on the Wikisource page. The page links the name to the right person, and the Wikipedia table and the Wikipedia list of kimariji print the name as it is here.';
const CORRECTIONS = [
	{ n: 28, poet: true, why: NAME_WHY },
	{ n: 46, poet: true, why: NAME_WHY },
	{
		n: 70,
		phrase: 4,
		fields: ['text', 'kana'],
		why: 'The Wikisource page prints a variant of the first word. The reading in use for the game, which the Wikipedia table gives, differs in one kana.',
	},
	{
		n: 74,
		phrase: 3,
		fields: ['text', 'kana'],
		caption: true, // the page's caption of the picture beside the poem must have the phrase as the table writes it
		why: 'The Wikisource page prints the phrase without its last syllable. The reading in use for the game, which the Wikipedia table gives, has it, and so does the caption of the picture beside the poem on the Wikisource page itself.',
	},
	{
		n: 89,
		phrase: 5,
		fields: ['kana'],
		why: 'The Wikisource page spells the reading of the verb with the kana ha. Its historical spelling has wa, as the Wikipedia table writes it (and as the page itself spells the wa of another verb, in the last phrase of poem 92).',
	},
];

// True when b is a with one character changed, added or removed.
function oneEdit(a, b) {
	const x = [...a];
	const y = [...b];
	if (a === b || Math.abs(x.length - y.length) > 1) return false;
	let i = 0;
	while (i < x.length && i < y.length && x[i] === y[i]) i++;
	const rest = (list, from) => list.slice(from).join('');
	if (x.length === y.length) return rest(x, i + 1) === rest(y, i + 1);
	return x.length < y.length ? rest(x, i) === rest(y, i + 1) : rest(x, i + 1) === rest(y, i);
}

const corrections = [];
for (const c of CORRECTIONS) {
	const p = poems[c.n - 1];
	const t = table[c.n - 1];
	if (c.poet) {
		const from = p.poet;
		const to = t.poet;
		const differing = [...from].filter((ch, i) => ch !== [...to][i]).length;
		if ([...from].length !== [...to].length || differing !== 1) fail(`correction, poem ${c.n}: the two pages do not print names one character apart (${from}, ${to})`);
		if (from.includes(p.poetLink) || !to.includes(p.poetLink)) fail(`correction, poem ${c.n}: the link of the Wikisource page (${p.poetLink}) does not decide between ${from} and ${to}`);
		if (listLabel[c.n - 1] !== to) fail(`correction, poem ${c.n}: the Wikipedia list of kimariji prints ${listLabel[c.n - 1]}, the table ${to}`);
		p.poet = to;
		corrections.push({ n: c.n, field: 'poet', from, to, why: c.why });
		continue;
	}
	for (const field of c.fields) {
		const phrases = p[field].split(' ');
		const from = phrases[c.phrase - 1];
		const to = t[field][c.phrase - 1];
		if (!oneEdit(from, to)) fail(`correction, poem ${c.n}, ${field}, phrase ${c.phrase}: the two pages are not one character apart (${from}, ${to})`);
		phrases[c.phrase - 1] = to;
		p[field] = phrases.join(' ');
		corrections.push({ n: c.n, field, phrase: c.phrase, from, to, why: c.why });
	}
	if (writtenOut(p.kana) !== t.kana.join(' ')) fail(`correction, poem ${c.n}: the two pages still read the poem differently (${p.kana}; ${t.kana.join(' ')})`);
	if (c.caption && !p.caption.includes(t.text[c.phrase - 1])) fail(`correction, poem ${c.n}: the caption on the Wikisource page does not have ${t.text[c.phrase - 1]}`);
	const [k1, k2, k3, k4, k5] = p.kana.split(' ');
	p.kami = [k1, k2, k3].join(' ');
	p.shimo = [k4, k5].join(' ');
}

// ---- kanji in the joyo form -------------------------------------------------------------

// The Wikisource page writes some kanji in an older form in one poem and in
// the current form in another. KANJIDIC2 cross-references each such kanji with
// the joyo kanji it is a form of; those are replaced, in the poem, the poet's
// name and the anthology, and every replacement is recorded.
const kd = await loadKanjidic2();
const { aliases } = joyoAliases(kd);
const joyoForm = (s) => [...s].map((ch) => aliases.get(ch) || ch).join('');
const FORM_FIELDS = ['text', 'poet', 'anthology'];
const formPairs = new Map();
for (const p of poems) {
	for (const field of FORM_FIELDS) {
		const printed = p[field];
		for (const ch of new Set(printed)) {
			const to = aliases.get(ch);
			if (!to) continue;
			if (printed.includes(to)) fail(`poem ${p.n}, ${field}: both ${ch} and ${to} occur, so the replacement could not be undone`);
			if (!formPairs.has(ch)) formPairs.set(ch, { from: ch, to, text: [], poet: [], anthology: [] });
			formPairs.get(ch)[field].push(p.n);
		}
		p[field] = joyoForm(printed);
	}
}
const forms = [...formPairs.values()];

// ---- what the two pages still print differently --------------------------------------------

// Readings (phrase by phrase, the iteration marks written out) and poets'
// names (both in the joyo form). The wording in kanji is not compared: the
// table writes most poems with other kanji than the Wikisource page.
const VARIANT_NOTES = {
	'44 kana 1': 'Not another reading: the table spells the opening of this poem partly by sound.',
};
const variants = [];
for (const p of poems) {
	const t = table[p.n - 1];
	const here = p.kana.split(' ');
	here.forEach((phrase, i) => {
		if (writtenOut(phrase) !== t.kana[i]) variants.push({ n: p.n, field: 'kana', phrase: i + 1, here: phrase, there: t.kana[i] });
	});
	if (joyoForm(p.poet) !== joyoForm(t.poet)) variants.push({ n: p.n, field: 'poet', here: p.poet, there: t.poet });
}
const variantKey = (v) => `${v.n} ${v.field}${v.phrase ? ' ' + v.phrase : ''}`;
for (const v of variants) if (VARIANT_NOTES[variantKey(v)]) v.note = VARIANT_NOTES[variantKey(v)];
for (const key of Object.keys(VARIANT_NOTES)) if (!variants.some((v) => variantKey(v) === key)) fail('a note is written for a variant that is not there: ' + key);
const compared = {
	readingsAlike: poems.filter((p) => !variants.some((v) => v.n === p.n && v.field === 'kana')).length,
	namesAlike: poems.filter((p) => !variants.some((v) => v.n === p.n && v.field === 'poet')).length,
	writtenWithTheSameKanji: poems.filter((p) => p.text === joyoForm(table[p.n - 1].text.join(' '))).length,
};

// The poets' readings: the page gives most in historical kana and a few with
// a modern spelling in part of the name. No source at hand prints those few
// in historical kana, so they stay as printed and are named here, by poem.
// The list was made by reading the hundred names; it cannot be derived.
// (Porter helps for two of them: see the check after his pages are read.)
const POET_KANA_MODERN = [24, 55, 72, 76, 80];

// ---- kimariji -------------------------------------------------------------------

// A card is taken by ear, so two openings count as the same when they sound
// the same. heardKey turns a kana reading (spaces removed) into a string of
// the same length in which
//   - an iteration mark is written out (the source writes "ko-ITER-ro"),
//   - the three kana that are spelled differently and read the same are
//     merged: wo = o, wi = i, we = e,
//   - a poem that opens with a long o, spelled a-fu (poem 44) or o-ho (poems
//     60 and 95), opens with o-o.
// Spelled out letter by letter, poem 26 (wo-gu-ra-ya-ma) would be the only
// card under "wo" and so a one-kana card, and poem 44 (a-fu-ko-to-no) a
// two-kana card. Players count them as o-gu and o-o-ko: see the list in the
// Japanese Wikipedia article, which is read below and compared poem by poem.
const SAME_SOUND = [
	['を', 'お'],
	['ゐ', 'い'],
	['ゑ', 'え'],
];
const LONG_O_OPENINGS = ['あふ', 'おほ'];
const LONG_O = 'おお';

function heardKey(kana) {
	let out = '';
	for (const ch of kana) {
		if (ch === ITER) out += out[out.length - 1];
		else if (ch === ITER_VOICED) out += String.fromCodePoint(out.codePointAt(out.length - 1) + 1);
		else out += ch;
	}
	for (const [a, b] of SAME_SOUND) out = out.split(a).join(b);
	for (const o of LONG_O_OPENINGS) if (out.startsWith(o)) out = LONG_O + out.slice(o.length);
	if (out.length !== kana.length) fail('heardKey changed the length of ' + kana);
	return out;
}
function writtenOut(kana) {
	let out = '';
	for (const ch of kana) {
		if (ch === ITER) out += out[out.length - 1];
		else if (ch === ITER_VOICED) out += String.fromCodePoint(out.codePointAt(out.length - 1) + 1);
		else out += ch;
	}
	return out;
}

function shortestUniquePrefixes(keys) {
	return keys.map((key, i) => {
		for (let len = 1; len <= key.length; len++) {
			const prefix = key.slice(0, len);
			if (!keys.some((other, j) => j !== i && other.startsWith(prefix))) return len;
		}
		fail(`reading ${i + 1} is a prefix of another reading`);
	});
}
function histogram(lengths) {
	const h = {};
	for (const len of lengths) h[len] = (h[len] || 0) + 1;
	return h;
}

const flat = poems.map((p) => p.kana.replace(/ /g, ''));
const heardLengths = shortestUniquePrefixes(flat.map(heardKey));
const spelledLengths = shortestUniquePrefixes(flat.map(writtenOut));
poems.forEach((p, i) => {
	p.kimariji = flat[i].slice(0, heardLengths[i]);
});

// ---- checks on the kimariji ---------------------------------------------------------

const ONE_KANA = ['む', 'す', 'め', 'ふ', 'さ', 'ほ', 'せ'];
const PUBLISHED_HISTOGRAM = histogram(bySound.map((s) => s.length));
const computedHistogram = histogram(heardLengths);
const oneKana = poems.filter((p) => p.kimariji.length === 1).map((p) => p.kimariji);
if (oneKana.length !== 7 || ONE_KANA.some((k) => !oneKana.includes(k))) fail('the one-kana cards are ' + oneKana.join(' '));
if (json(computedHistogram) !== json(PUBLISHED_HISTOGRAM)) fail(`histogram ${json(computedHistogram)} is not the published ${json(PUBLISHED_HISTOGRAM)}`);
if (json(PUBLISHED_HISTOGRAM) !== json({ 1: 7, 2: 42, 3: 37, 4: 6, 5: 2, 6: 6 })) fail('the published histogram changed: ' + json(PUBLISHED_HISTOGRAM));
const lengthMismatch = poems.filter((p, i) => p.kimariji.length !== bySound[i].length || heardKey(p.kimariji)[0] !== heardKey(bySound[i])[0]);
if (lengthMismatch.length) fail('kimariji differ from the Wikipedia list for poems ' + lengthMismatch.map((p) => p.n).join(', '));
const boldDiffers = poems.filter((p) => p.bold !== p.kimariji).map((p) => ({ n: p.n, printed: p.bold, computed: p.kimariji }));
const spelledDiffers = poems.filter((p, i) => spelledLengths[i] !== heardLengths[i]).map((p, i) => ({ n: p.n, spelled: flat[p.n - 1].slice(0, spelledLengths[p.n - 1]), heard: p.kimariji }));

// ---- English Wikisource: Porter ----------------------------------------------------

function porterPage(pageNumber) {
	const text = porterPages.get(pageNumber).replace(/<noinclude>[\s\S]*?<\/noinclude>/g, '');
	const blockAt = text.indexOf('{{center block');
	const head = /^\{\{c\|(?:\{\{larger\|(\d+)\}\}\s*)?([^{}]+)\}\}\s*$/.exec(text.slice(0, blockAt));
	if (!head) fail(`Porter page ${pageNumber}: cannot read the heading ${JSON.stringify(text.slice(0, blockAt))}`);
	const poem = /<poem>([\s\S]*?)<\/poem>/.exec(text);
	if (!poem) fail(`Porter page ${pageNumber}: no poem`);
	const lines = poem[1]
		.replace(/\{\{em\|[^{}]*\}\}/g, '') // the printed indent of alternate lines
		.replace(/\{\{uc\|\{\{li\|([^{}|]*)\|[^{}]*\}\}([^{}]*)\}\}/g, '$1$2') // large first letter and capitals of the first word
		.replace(/''/g, '') // italics
		.split('\n')
		.map((l) => l.replace(/^:+/, '').trim()) // one page indents with a leading colon instead
		.filter(Boolean);
	if (lines.length !== 5) fail(`Porter page ${pageNumber}: ${lines.length} lines`);
	for (const l of lines) if (/[{}<>\[\]|]/.test(l)) fail(`Porter page ${pageNumber}: markup left in ${l}`);
	return {
		number: head[1] ? +head[1] : null,
		heading: head[2].replace(/<br \/>/g, ' ').replace(/\s+/g, ' ').trim(),
		lines,
	};
}

for (const p of poems) {
	const left = porterPage(14 + 2 * p.n);
	const right = porterPage(15 + 2 * p.n);
	if (left.number !== null && left.number !== p.n) fail(`Porter page ${14 + 2 * p.n} is numbered ${left.number}, expected ${p.n}`);
	if (right.number !== null) fail(`Porter page ${15 + 2 * p.n} carries a number`);
	p.romaji = left.lines.join('\n');
	p.en = right.lines.join('\n');
	p.poetRomaji = left.heading;
	p.poetEn = right.heading;
	for (const s of [p.romaji, p.en, p.poetRomaji, p.poetEn]) {
		for (const ch of s) {
			const cp = ch.codePointAt(0);
			const ok = cp === 10 || (cp >= 0x20 && cp < 0x7f) || (cp >= 0xc0 && cp <= 0x17f) || cp === 0x2018 || cp === 0x2019 || cp === 0x2014;
			if (!ok) fail(`poem ${p.n}: unexpected character U+${cp.toString(16)} in Porter's text`);
		}
	}
}

// Porter writes the old "kwa" where the historical kana has ku-wa. A name he
// writes with it, read on the page without it, has a modern spelling there
// and must be in the list above (the list holds more: not every modern
// spelling shows in a romanisation).
{
	const count = (s, piece) => s.split(piece).length - 1;
	const byPorter = poems.filter((p) => count(p.poetRomaji.toUpperCase(), 'KW') > count(p.poetKana, 'くわ')).map((p) => p.n);
	const missing = byPorter.filter((n) => !POET_KANA_MODERN.includes(n));
	if (missing.length) fail('poets read with a modern spelling that the list does not name: ' + missing.join(', '));
}

// ---- output ---------------------------------------------------------------------------

const correctedPoems = [...new Set(corrections.map((c) => c.n))];
const place = (c) => `poem ${c.n}, ${c.field === 'poet' ? 'poet' : (c.field === 'kana' ? 'reading' : 'text') + ' of phrase ' + c.phrase}`;
const meta = {
	sources: [
		{ url: jaws.url, sha256: jaws.sha256, fetched: jaws.fetched, gives: 'text, kana, kami, shimo, poet, poetKana, anthology, published.wikisource' },
		{
			url: jawpTable.url,
			sha256: jawpTable.sha256,
			fetched: jawpTable.fetched,
			gives: 'the strings of meta.corrections (' + corrections.map(place).join('; ') + '), and the other readings and names of meta.variants',
		},
		{ ...kd.source, file: 'KANJIDIC2', version: kd.databaseVersion, gives: 'which kanji are another form of a joyo kanji (meta.forms)' },
		{
			url: 'https://en.wikisource.org/wiki/A_Hundred_Verses_from_Old_Japan',
			pages: `Page:${ENWS_INDEX}/${ENWS_FIRST} to /${ENWS_LAST}, at the revisions listed in scripts/lang/hyakunin.lock.json`,
			sha256: porterSha,
			sha256Of: 'the 200 lines "<page> <revision> <sha256 of the page wikitext>"',
			fetched: porterFetched,
			gives: 'romaji, en, poetRomaji, poetEn',
		},
		{ url: jawp.url, sha256: jawp.sha256, fetched: jawp.fetched, gives: 'published.bySound, and the histogram the computed kimariji must match' },
	],
	licence:
		'The poems are in the public domain. The Wikisource page that supplies their readings is tagged CC BY-SA 3.0; the Wikipedia table of the poems and the Wikipedia list of kimariji are CC BY-SA 4.0; KANJIDIC2 is the property of the Electronic Dictionary Research and Development Group, CC BY-SA 4.0. Porter (1909) is in the public domain (published before 1931; he died in 1929).',
	credit:
		`Ogura Hyakunin Isshu: text and readings from Japanese Wikisource (CC BY-SA 3.0), corrected in ${correctedPoems.length} poems after the table of poems in Japanese Wikipedia (CC BY-SA 4.0), with ${forms.length} kanji written in their current form after KANJIDIC2 (Electronic Dictionary Research and Development Group, CC BY-SA 4.0); romanised text and English verse from William N. Porter, A Hundred Verses from Old Japan (1909), as transcribed at English Wikisource (public domain); kimariji checked against the list in Japanese Wikipedia (CC BY-SA 4.0).`,
	kept: { poems: poems.length, corrections: corrections.length, correctedPoems: correctedPoems.length, variants: variants.length, kanjiInJoyoForm: forms.length, placesInJoyoForm: forms.reduce((sum, f) => sum + FORM_FIELDS.reduce((s, field) => s + f[field].length, 0), 0) },
	dropped: [
		'From Wikisource: the picture column, the links, the introduction.',
		...corrections.map((c) => `Changed, ${place(c)}: the Wikisource page prints ${c.from}; ${c.to} is taken from the Wikipedia table. ${c.why}`),
		...forms.map((f) => `Changed, kanji form: the Wikisource page prints ${f.from}; it is written ${f.to} here (${FORM_FIELDS.filter((field) => f[field].length).map((field) => `${field} of poem${f[field].length > 1 ? 's' : ''} ${f[field].join(', ')}`).join('; ')}).`),
		"From Porter: his note under each poem, the pictures, the indent of alternate lines, the italics of a few words, and the capitals and large initial of each verse's first word (the transcription holds the word in ordinary case).",
		'The halves of each poem are joined by a space where the page has a line break.',
		'From the Wikipedia table: everything but the strings named above. Its wording of the poems in kanji is not used.',
	],
	corrections,
	variants,
	compared: {
		note: 'The Wikisource page (after the corrections) against the Wikipedia table: readings phrase by phrase with the iteration marks written out, names with both in the joyo form. The differences are meta.variants.',
		...compared,
	},
	forms: {
		rule: 'A kanji outside the joyo list that KANJIDIC2 cross-references with exactly one kanji on the list is written as that kanji, in text, poet and anthology. To get back what the Wikisource page prints, put from in place of to in the poems listed, then undo meta.corrections.',
		replaced: forms,
	},
	poetKana: {
		note: 'The readings of the poets are the Wikisource page\'s: historical kana, except in the poems listed, where part of the name has a modern spelling. They are kept as printed; no source at hand prints them otherwise.',
		modernSpelling: POET_KANA_MODERN,
	},
	kimariji: {
		rule: 'The shortest prefix of the kana reading that no other poem shares when the cards are read aloud: iteration marks written out; wo, wi, we counted as o, i, e; an opening a-fu or o-ho counted as o-o. The prefix itself is cut from the reading as the source spells it.',
		histogram: computedHistogram,
		publishedHistogram: PUBLISHED_HISTOGRAM,
		spelledOutWouldDiffer: spelledDiffers,
		wikisourceBoldDiffers: boldDiffers,
		wikipediaMatchedByElimination: matchedByElimination,
	},
};

const FIELDS = ['n', 'poet', 'poetKana', 'text', 'kana', 'kami', 'shimo', 'kimariji', 'romaji', 'en', 'poetRomaji', 'poetEn', 'anthology'];
const body =
	'{\n"meta":' +
	json(meta) +
	',\n"poems":[\n' +
	poems.map((p) => json(Object.fromEntries(FIELDS.map((f) => [f, p[f]])))).join(',\n') +
	'\n],\n"published":{\n"wikisource":' +
	json(poems.map((p) => p.bold)) +
	',\n"bySound":' +
	json(bySound) +
	'\n}\n}';

writeDataFile('hyakunin.js', 'LANG_HYAKUNIN', body, [
	'misc/_lang/hyakunin.js: the 100 poems of the Ogura Hyakunin Isshu.',
	'Generated by scripts/lang/build-hyakunin.mjs. Do not edit: rebuild.',
	'Sources, licences and the credit a page must show: misc/_lang/LICENSES.md',
]);

console.log(`poems ${poems.length}; kimariji lengths ${json(computedHistogram)}; one-kana cards ${oneKana.join(' ')}`);
console.log('spelled out, these would differ: ' + json(spelledDiffers));
console.log('Wikisource prints a different bold prefix for: ' + json(boldDiffers));
console.log('Wikipedia list matched by elimination: poem ' + (matchedByElimination.join(', ') || 'none'));
console.log('corrections from the Wikipedia table:');
for (const c of corrections) console.log(`  ${place(c)}: ${c.from} -> ${c.to}`);
console.log('kanji written in the joyo form: ' + forms.map((f) => `${f.from} -> ${f.to} (${FORM_FIELDS.flatMap((field) => f[field].map((n) => (field === 'text' ? '' : field + ' ') + n)).join(', ')})`).join('; '));
console.log('the two pages still differ in:');
for (const v of variants) console.log(`  poem ${v.n}, ${v.field}${v.phrase ? ' of phrase ' + v.phrase : ''}: ${v.here} here, ${v.there} in the table`);
console.log(`compared with the Wikipedia table: readings alike in ${compared.readingsAlike} poems, names alike in ${compared.namesAlike}, written with the same kanji in ${compared.writtenWithTheSameKanji}`);
