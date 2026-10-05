// Builds misc/_lang/texts/yume-juya-1.js: the First Night of Natsume Soseki's
// "Ten Nights of Dreams" (1908), with the furigana of the source.
//
//   node scripts/lang/build-yume-juya-1.mjs
//
// Source: Aozora Bunko, card 799, the text file with ruby (Shift_JIS, zipped).
// The only readings are the ruby of that file. A line of the output is a
// paragraph of the file with the markup taken out:
//   base《reading》        the reading goes to ruby as [start, end, reading],
//                          start and end being offsets into the line's text;
//                          the base is the run of kanji just before the mark
//   ｜base《reading》      the same, with the start of the base marked
//   ※［＃description］    a character outside JIS X 0208, described in words
//                          with its JIS X 0213 position; it is replaced by the
//                          character KANJIDIC2 lists at that position
// The colophon of the file (base text, who typed it in, dates) is kept whole
// in meta.colophon, as Aozora Bunko asks.

import { fetchCached, unzip, json, writeDataFile, isKanjiCp, isHiraganaCp, isKatakanaCp, allChars } from './lib.mjs';
import { loadKanjidic2 } from './edrdg.mjs';

const CARD_URL = 'https://www.aozora.gr.jp/cards/000148/card799.html';
const ZIP_URL = 'https://www.aozora.gr.jp/cards/000148/files/799_ruby_6024.zip';
const ZIP_SHA256 = 'bbcba67c68db31aca5d24d8cab5ec17a1c85f9730b183f14895bb0b6d5ae19b8';
const TEXT_FILE = 'yume_juya.txt';
const PART = 1; // which of the ten nights

function fail(msg) {
	throw new Error('build-yume-juya-1: ' + msg);
}

const zip = await fetchCached(ZIP_URL, 'aozora-799_ruby_6024.zip', { expectSha256: ZIP_SHA256 });
const files = unzip(zip.buf);
if (!files.has(TEXT_FILE)) fail(`the zip has no ${TEXT_FILE}: ${[...files.keys()].join(', ')}`);
const text = new TextDecoder('shift_jis', { fatal: true }).decode(files.get(TEXT_FILE));
const all = text.split('\r\n');

// ---- the parts of the file -----------------------------------------------------

const title = all[0];
const author = all[1];
const RULE = /^-{20,}$/;
const ruleLines = all.map((l, i) => (RULE.test(l) ? i : -1)).filter((i) => i >= 0);
if (ruleLines.length !== 2) fail('expected the note on symbols between two rules');
const COLOPHON_START = '底本：';
const colophonAt = all.findIndex((l) => l.startsWith(COLOPHON_START));
if (colophonAt < 0) fail('no colophon');
const colophon = all.slice(colophonAt).filter((l) => l !== '');

// A heading looks like  [indent note]TITLE[note: "TITLE" is a middle heading]
const HEADING = /^［＃[^］]*］([^［］]+)［＃「([^」]+)」は中見出し］$/;
const headings = [];
for (let i = ruleLines[1] + 1; i < colophonAt; i++) {
	const m = HEADING.exec(all[i]);
	if (m) {
		if (m[1] !== m[2]) fail('heading and its note disagree: ' + all[i]);
		headings.push({ line: i, name: m[1] });
	}
}
if (headings.length !== 10) fail(`expected ten nights, found ${headings.length}`);
const from = headings[PART - 1].line + 1;
const to = PART < 10 ? headings[PART].line : colophonAt;
const part = headings[PART - 1].name;
const paragraphs = all.slice(from, to).filter((l) => l !== '');

// ---- characters outside JIS X 0208 -------------------------------------------------

const kd = await loadKanjidic2();
const byJis213 = new Map();
for (const c of kd.characters) if (c.codepoints.jis213) byJis213.set(c.codepoints.jis213, c.literal);

// ---- ruby ------------------------------------------------------------------------------

const BAR = '｜';
const RUBY_OPEN = '《';
const RUBY_CLOSE = '》';
const NOTE_OPEN = '［＃';
const NOTE_CLOSE = '］';
const GAIJI_MARK = '※';
const isBaseChar = (ch) => isKanjiCp(ch.codePointAt(0)) || ch === '々';

const gaiji = [];
function parseLine(src, lineIndex) {
	let out = '';
	const ruby = [];
	let barAt = -1;
	let i = 0;
	while (i < src.length) {
		if (src.startsWith(GAIJI_MARK + NOTE_OPEN, i)) {
			const end = src.indexOf(NOTE_CLOSE, i);
			if (end < 0) fail('unclosed note in line ' + lineIndex);
			const note = src.slice(i + 1 + NOTE_OPEN.length, end);
			const m = /、第[34]水準(\d-\d{1,2}-\d{1,2})$/.exec(note);
			if (!m) fail('cannot read the character note: ' + note);
			const code = m[1]
				.split('-')
				.map((n, k) => (k === 0 ? n : n.padStart(2, '0')))
				.join('-');
			const ch = byJis213.get(code);
			if (!ch || [...ch].length !== 1) fail('KANJIDIC2 has no character at JIS X 0213 ' + code);
			gaiji.push({ line: lineIndex, at: out.length, ch, note, jis213: code });
			out += ch;
			i = end + 1;
		} else if (src.startsWith(NOTE_OPEN, i)) {
			fail(`line ${lineIndex} has a note this script does not know: ${src.slice(i, i + 30)}`);
		} else if (src[i] === BAR) {
			if (barAt >= 0) fail('two base marks before one ruby in line ' + lineIndex);
			barAt = out.length;
			i++;
		} else if (src[i] === RUBY_OPEN) {
			const end = src.indexOf(RUBY_CLOSE, i);
			if (end < 0) fail('unclosed ruby in line ' + lineIndex);
			const reading = src.slice(i + 1, end);
			let start;
			if (barAt >= 0) {
				start = barAt;
				barAt = -1;
			} else {
				// The run of kanji just before the mark; it cannot reach back into
				// the base of the ruby before it (as in kanji《..》kanji《..》).
				const floor = ruby.length ? ruby[ruby.length - 1][1] : 0;
				start = out.length;
				while (start > floor && isBaseChar(out[start - 1])) start--;
			}
			if (start === out.length) fail(`ruby without a base in line ${lineIndex}: ${reading}`);
			if (ruby.length && start < ruby[ruby.length - 1][1]) fail('overlapping ruby in line ' + lineIndex);
			ruby.push([start, out.length, reading]);
			i = end + 1;
		} else {
			out += src[i];
			i++;
		}
	}
	if (barAt >= 0) fail('a base mark without ruby in line ' + lineIndex);
	return { t: out, ruby };
}

const lines = paragraphs.map((p, i) => parseLine(p, i));

// ---- checks ----------------------------------------------------------------------------

let rubyCount = 0;
for (const [i, line] of lines.entries()) {
	for (const ch of line.t) {
		if (ch.codePointAt(0) > 0xffff) fail('a character outside the Basic Multilingual Plane: offsets would no longer be character counts');
		if ([BAR, RUBY_OPEN, RUBY_CLOSE, '［', '］', GAIJI_MARK].includes(ch)) fail(`markup left in line ${i}`);
	}
	for (const [s, e, r] of line.ruby) {
		rubyCount++;
		if (!(s >= 0 && e > s && e <= line.t.length)) fail(`bad ruby offsets in line ${i}`);
		if (![...line.t.slice(s, e)].every(isBaseChar)) fail(`ruby base is not kanji in line ${i}: ${line.t.slice(s, e)}`);
		if (!allChars(r, (cp) => isHiraganaCp(cp) || isKatakanaCp(cp))) fail(`ruby reading is not kana in line ${i}: ${r}`);
	}
}
if (!lines.length || !rubyCount) fail('nothing parsed');

const credited = {};
for (const l of colophon) {
	const m = /^(入力|校正)：(.+)$/.exec(l);
	if (m) credited[m[1]] = m[2];
}
if (!credited['入力']) fail('the colophon does not name who typed the text in');

const meta = {
	sources: [
		{ url: ZIP_URL, sha256: zip.sha256, fetched: zip.fetched, file: TEXT_FILE + ' (Shift_JIS)', card: CARD_URL, gives: 'everything except the character below' },
		{ ...kd.source, file: 'KANJIDIC2', version: kd.databaseVersion, gives: 'the Unicode character for the one JIS X 0213 position the text file spells out in words' },
	],
	licence: 'Public domain: Natsume Soseki died in 1916. Aozora Bunko lets files of works out of copyright be copied, converted and redistributed freely, and asks that the information in the colophon is kept.',
	credit:
		`${author}「${title}」${part}. Text and furigana from Aozora Bunko (${CARD_URL}); ` +
		Object.entries(credited)
			.map(([role, name]) => `${role}：${name}`)
			.join('、') +
		`; ${colophon[0]}`,
	kept: { lines: lines.length, ruby: rubyCount, characters: lines.reduce((n, l) => n + l.t.length, 0), gaiji: gaiji.length },
	dropped: [
		'The other nine nights, the title lines, the note on symbols at the head of the file, the heading line of the night (kept as part), blank lines.',
		'Ruby marks are taken out of the text and given as offsets; nothing else in a line is changed, the full-width space that indents a paragraph included.',
		'The description in words of a character outside JIS X 0208 is replaced by the character itself (see gaiji).',
	],
	colophon,
	gaiji,
	notes: {
		offsets: 'ruby is [start, end, reading]: t.slice(start, end) is the base. Every character of this text is one UTF-16 unit, so the offsets are character counts too.',
		orthography: 'The base text is a modern edition (see the colophon): new character forms and modern kana usage, not the spelling of 1908.',
		lines: 'One line is one paragraph of the source file. A paragraph of narration starts with a full-width space; speech starts with an opening bracket.',
	},
};

const body = '{\n"meta":' + json(meta) + ',\n"title":' + json(title) + ',\n"author":' + json(author) + ',\n"part":' + json(part) + ',\n"lines":[\n' + lines.map((l) => json(l)).join(',\n') + '\n]\n}';

writeDataFile('texts/yume-juya-1.js', 'LANG_TEXT_YUMEJUYA1', body, [
	'misc/_lang/texts/yume-juya-1.js: Natsume Soseki, Ten Nights of Dreams (1908), the First Night, with the furigana of the source (Aozora Bunko).',
	'Generated by scripts/lang/build-yume-juya-1.mjs. Do not edit: rebuild.',
	'Sources, licences and the credit a page must show: misc/_lang/LICENSES.md',
]);
console.log(`${title} / ${author} / ${part}: ${lines.length} lines, ${rubyCount} ruby, ${meta.kept.characters} characters, gaiji ${gaiji.map((g) => g.ch + ' ' + g.jis213).join(', ')}`);
console.log('credit: ' + meta.credit);
