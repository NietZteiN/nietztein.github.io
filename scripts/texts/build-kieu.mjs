/*
 * Builds misc/_texts/kieu-opening.js : lines 1 to 38 of Nguyen Du's Truyen Kieu.
 *
 *     node scripts/texts/build-kieu.mjs [--offline]
 *
 * Which text. Vietnamese Wikisource holds the poem in three kinds of page:
 *   - "Truyện Kiều": a modern-spelling text with no edition named;
 *   - "Truyện Kiều (bản Kiều Oánh Mậu 1902)": the Nom text of that edition beside a quoc ngu
 *     reading. The reading is not Kieu Oanh Mau's (his 1902 edition is in Nom). The page says
 *     the text was collected, annotated and typeset in Nom by the researchers Nguyen The and
 *     Phan Anh Dung, gives the Nom Foundation as its source, and does not say who made the
 *     quoc ngu reading or when. A recent transcription can be in copyright, so the page is
 *     not used. (Four more pages are named after Nom editions of 1866 to 1872; they were not
 *     examined.)
 *   - "Truyện Kiều (bản Trương Vĩnh Ký 1911)": the third edition (Saigon, F.-H. Schneider,
 *     1911) of the first quoc ngu transcription, by Truong Vinh Ky, who died in 1898. It is
 *     transcribed on Wikisource from a scan, page by page, and proofread there.
 * This script takes the third: poet dead since 1820, transcriber since 1898, printed 1911.
 *
 * The three scan pages that carry lines 1 to 38 are read as wikitext at fixed revisions
 * (oldid), so a refetch gives the same bytes. From each <poem> block the verse lines are
 * kept; the editor's footnotes (<ref>), the italics markup and the leading ":" that
 * indents the eight-syllable lines are dropped. The result is stored NFC-normalised.
 *
 * Wikisource is a transcription, and a transcription is not the book. A review on 2026-10-05
 * compared the 38 lines with the scan of the printed pages (the PDF on Wikimedia Commons that
 * Wikisource transcribes) and found four lines where the transcription departs from the
 * print; the fixer read all three pages again and found the same four and no other.
 * CORRECTIONS below puts the printed reading back, and the output lists each change in
 * meta.corrections. The page images are fetched too, so that their hashes are on record and
 * the next reader can look at exactly what was looked at.
 *
 * What that comparison can and cannot show. The scan is coarse (the whole 234-page PDF is
 * 7 MB). Letters, hyphens and the presence of a punctuation mark can be read. Whether a mark
 * over a vowel is a hook or a grave accent often cannot (line 7: "Kiểu" or "Kiều"), and a
 * comma that has lost its tail looks like a full stop. So the tone marks, and the choice
 * between comma and full stop, are Wikisource's.
 */
import { get, writeData } from './lib.mjs';

const WIKI = 'https://vi.wikisource.org/';
const INDEX = 'Kim_Van_Kieu_truyen_Truong_Vinh_Ky.pdf';
const SCAN = 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c0/' + INDEX + '/page{n}-1920px-' + INDEX + '.jpg';
const PAGES = [
	{ scan: 14, oldid: 149256 },
	{ scan: 15, oldid: 75486 },
	{ scan: 17, oldid: 75570 },      // scan page 16 is an illustration
];
const WANT = 38;

/* Where the Wikisource transcription departs from the printed page: [line, as transcribed,
 * as printed]. The second string must occur exactly once in the transcribed line, or the
 * build stops: a page that has been corrected upstream must not be "corrected" twice. */
const CORRECTIONS = [
	[4, 'điều', 'đều'],                              // the print spells the word "đều" here
	[8, 'phong tình', 'phong-tình'],                 // hyphen in the print
	[23, 'sắc-sảo, mặn-mà', 'sắc-sảo mặn-mà'],       // no comma in the print
	[24, 'tài sắc, lại', 'tài sắc lại'],             // no comma in the print
];

/** A page as a list of blocks in reading order: { verses, footnotes, italics, boldBefore }. */
function blocksOf(wikitext) {
	const body = wikitext.replace(/<noinclude>[\s\S]*?<\/noinclude>/g, '');
	const blocks = [];
	const re = /<poem>([\s\S]*?)<\/poem>/g;
	let last = 0;
	let m;
	while ((m = re.exec(body))) {
		const outside = body.slice(last, m.index);
		last = re.lastIndex;
		const footnotes = (m[1].match(/<ref>/g) || []).length;
		let text = m[1].replace(/<ref>[\s\S]*?<\/ref>/g, '');
		const italics = (text.match(/''/g) || []).length / 2;
		text = text.replace(/''/g, '');
		const verses = [];
		for (const raw of text.split('\n')) {
			const line = (raw.startsWith(':') ? raw.slice(1) : raw).trim();
			if (!line) continue;
			if (/[<>{}\[\]|=']/.test(line) || /\s{2,}/.test(line)) throw new Error('markup left in a verse line: ' + JSON.stringify(line));
			verses.push(line);
		}
		blocks.push({ verses, footnotes, italics, boldBefore: (outside.match(/'''[^']+'''/g) || []).length });
	}
	return blocks;
}

/** Syllables of a verse line: split on spaces and hyphens, ignore punctuation. */
function syllables(line) {
	return line.split(/[\s-]+/).map((t) => t.replace(/[^\p{L}]/gu, '')).filter(Boolean);
}

const sources = [];
const pages = [];
const kept = [];
const dropped = { footnotes: 0, italics: 0, bold: 0 };
let found = 0;
for (const p of PAGES) {
	const title = 'Trang:' + INDEX + '/' + p.scan;
	const r = await get('kieu/page-' + p.scan + '-rev-' + p.oldid + '.wiki', WIKI + 'w/index.php?title=' + title + '&action=raw&oldid=' + p.oldid);
	sources.push(r.source);
	const first = kept.length + 1;
	for (const block of blocksOf(r.text)) {
		found += block.verses.length;
		if (kept.length >= WANT) continue;
		if (kept.length + block.verses.length > WANT) throw new Error('line ' + WANT + ' falls inside a <poem> block; the cut would split a passage');
		for (const line of block.verses) kept.push({ line, scan: p.scan });
		dropped.footnotes += block.footnotes;
		dropped.italics += block.italics;
		dropped.bold += block.boldBefore;
	}
	pages.push({
		scan: p.scan, lines: first + '-' + kept.length, revision: p.oldid,
		url: WIKI + 'wiki/' + title,
		permalink: WIKI + 'w/index.php?title=' + title + '&oldid=' + p.oldid,
		image: SCAN.replace('{n}', p.scan),
	});
}
if (kept.length !== WANT) throw new Error('found ' + kept.length + ' verse lines, wanted ' + WANT);
if (dropped.bold !== 3) throw new Error('expected the title and two section headings before line ' + WANT + ', found ' + dropped.bold + ' bold spans');

// The images of the printed pages the lines were compared with.
for (const p of pages) {
	const r = await get('kieu/scan-' + p.scan + '-1920px.jpg', p.image);
	if (r.buf[0] !== 0xFF || r.buf[1] !== 0xD8) throw new Error('the scan of page ' + p.scan + ' is not a JPEG');
	sources.push(r.source);
}

let changedByNfc = 0;
const transcribed = kept.map((e) => {
	const n = e.line.normalize('NFC');
	if (n !== e.line) changedByNfc++;
	return n;
});

// Put the printed reading back where the transcription departs from it.
const lines = transcribed.slice();
const corrections = [];
for (const [n, from, to] of CORRECTIONS) {
	const a = from.normalize('NFC');
	const b = to.normalize('NFC');
	const was = lines[n - 1];
	if (was.split(a).length !== 2) throw new Error('line ' + n + ' of the transcription does not contain ' + JSON.stringify(a) + ' exactly once: ' + was);
	lines[n - 1] = was.replace(a, b);
	const page = pages.find((p) => { const [x, y] = p.lines.split('-').map(Number); return n >= x && n <= y; });
	corrections.push({ line: n, wikisource: was, print: lines[n - 1], scan: page.scan });
}

// Luc bat: lines of six and eight syllables in turn. List what does not fit.
const exceptions = [];
lines.forEach((line, i) => {
	const want = i % 2 === 0 ? 6 : 8;
	const got = syllables(line).length;
	if (got === want) return;
	const entry = { line: i + 1, syllables: got, expected: want };
	const without = line.replace(/ \([^)]*\)/, '');
	if (without !== line && syllables(without).length === want) {
		entry.reason = 'the editor gives a second reading of the first word in brackets, inside the verse: ' + /\([^)]*\)/.exec(line)[0];
		entry.without = without;
	} else {
		entry.reason = 'as printed';
	}
	exceptions.push(entry);
});

const data = {
	meta: {
		sources,
		licence: 'Public domain',
		credit: 'Nguyễn Du, Truyện Kiều, lines 1–38, in the quốc ngữ transcription of Trương Vĩnh Ký (Kim, Vân, Kiều truyện, 3rd edition, Saigon: F.-H. Schneider, 1911), from Vietnamese Wikisource, corrected against the scan of the print on Wikimedia Commons. Public domain.',
		kept: 'verse lines 1 to ' + WANT + ', from "' + lines[0] + '" to "' + lines[WANT - 1] + '", as transcribed on Wikisource from the 1911 printing, compared with the scan of the printed pages and corrected in ' + corrections.length +
			' lines where the transcription departs from the print (lines ' + corrections.map((c) => c.line).join(', ') + '; see corrections). Letters, hyphens, capitals and the places of the punctuation marks are those of the print; the scan is too coarse to check every tone mark, or to tell a comma from a full stop, so those are Wikisource\'s. Stored NFC-normalised (' +
			(changedByNfc === 0 ? 'the source text already was; no line changed' : changedByNfc + ' lines changed') + ')',
		dropped: 'the editor\'s ' + dropped.footnotes + ' footnotes; the title and his two section headings (before lines 1 and 7); the italics (' + dropped.italics +
			' spans: the edition prints proper names, and "hay là" in line 37, in italics); the indent of the even lines; everything after line ' + WANT + '. No translation is included',
		author: 'Nguyễn Du (1766–1820)',
		work: 'Truyện Kiều',
		edition: 'Poème Kim, Vân, Kiều truyện, transcrit pour la première fois en quốc-ngữ avec des notes explicatives par P. J.-B. Trương-Vĩnh-Ký. 3e édition. Saigon: F.-H. Schneider, 1911. Trương Vĩnh Ký died in 1898.',
		spelling: 'The spelling of the 1911 printing, not that of a modern school edition: compounds are hyphenated (người-ta, đau-đớn), the eight-syllable lines begin in lower case unless a name comes first, and some words differ (mạng for mệnh, đều for điều, Kiểu thơm for Cảo thơm, sử sanh for sử xanh, Túy-kiều for Thúy Kiều).',
		form: 'lục bát: lines of six and eight syllables in turn. A syllable is a run of letters between spaces or hyphens.',
		exceptions,
		corrections,
		correctionsNote: 'Lines where the Wikisource transcription (wikisource) departs from the printed page and the printed reading (print) was put back, after reading the scan of that page (pages[].image; scan is the page number in the PDF). Compared on 2026-10-05: all 38 lines, for letters, hyphens and punctuation. Not compared, because the scan does not show them reliably: tone marks, and comma against full stop.',
		pages,
		readingPage: WIKI + 'wiki/' + encodeURIComponent('Truyện_Kiều_(bản_Trương_Vĩnh_Ký_1911)/Kim,_Vân,_Kiều_truyện').replace(/%2F/g, '/').replace(/%2C/g, ',').replace(/%28/g, '(').replace(/%29/g, ')'),
	},
	lines,
};

const body = '{\n"meta": ' + JSON.stringify(data.meta, null, '\t') + ',\n"lines": [\n' + lines.map((l) => '\t' + JSON.stringify(l)).join(',\n') + '\n]\n}';
writeData('kieu-opening.js', 'TEXTS_KIEU', [
	'misc/_texts/kieu-opening.js : window.TEXTS_KIEU',
	'Nguyen Du, Truyen Kieu, lines 1 to 38, in the quoc ngu transcription of Truong Vinh Ky',
	'(3rd edition, Saigon 1911), from Vietnamese Wikisource, ' + corrections.length + ' lines corrected against the scan of',
	'the print. Public domain. NFC-normalised.',
	'Built by scripts/texts/build-kieu.mjs. Do not edit by hand. See LICENSES.md.',
], body, data);

console.log('  verse lines on the three pages: ' + found + ', kept ' + lines.length + ' (' + pages.map((p) => 'scan ' + p.scan + ': ' + p.lines).join(', ') + ')');
console.log('  changed by NFC: ' + changedByNfc + '; footnotes dropped: ' + dropped.footnotes + '; italic spans dropped: ' + dropped.italics + '; bold spans (title, headings) dropped: ' + dropped.bold);
console.log('  exceptions to 6/8: ' + JSON.stringify(exceptions));
for (const c of corrections) console.log('  corrected line ' + c.line + ' (scan page ' + c.scan + '): ' + c.wikisource + '  ->  ' + c.print);
lines.forEach((l, i) => console.log('  ' + String(i + 1).padStart(2) + ' [' + syllables(l).length + '] ' + l));
