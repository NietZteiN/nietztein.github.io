// Builds misc/_lang/kanji.js: the 2,136 joyo kanji with meanings, readings,
// visible components, school grade, stroke count and newspaper frequency rank.
//
//   node scripts/lang/build-kanji.mjs
//
// Sources, all from the EDRDG (CC BY-SA 4.0), read as they are published:
//   KANJIDIC2  meanings (English), on and kun readings, grade, stroke count, frequency
//   KRADFILE   the components of each kanji, and (in its header) the Unicode
//              character of each component that it has to write as a stand-in
//   RADKFILE   the stroke count of each component
// Nothing is taken from KRADFILE2: it is not under the EDRDG licence.

import { json, writeDataFile, isKanjiCp, isHiraganaCp, isKatakanaCp, allChars } from './lib.mjs';
import { loadKanjidic2, loadKradfile, loadRadkfile, isJoyoGrade, joyoAliases, EDRDG_LICENCE_URL } from './edrdg.mjs';

const kd = await loadKanjidic2();
const krad = await loadKradfile();
const radk = await loadRadkfile();

function fail(msg) {
	throw new Error('build-kanji: ' + msg);
}

const KOKUJI = '(kokuji)'; // KANJIDIC2 lists this among the meanings of a kanji made in Japan

const joyo = kd.characters.filter((c) => isJoyoGrade(c.grade));
if (joyo.length !== 2136) fail(`KANJIDIC2 grades ${joyo.length} kanji as joyo, expected 2,136`);
// School order: grade, then stroke count, then code point.
joyo.sort((a, b) => a.grade - b.grade || a.strokes - b.strokes || a.literal.codePointAt(0) - b.literal.codePointAt(0));

// The elements KRADFILE writes with katakana or a full-width bar, besides kanji.
const isElement = (cp) => isKanjiCp(cp) || isKatakanaCp(cp) || cp === 0xff5c;

const k = {};
const noParts = [];
const usedElements = new Set();
let kokujiCount = 0;
for (const c of joyo) {
	if ([...c.literal].length !== 1 || !isKanjiCp(c.literal.codePointAt(0))) fail('not one kanji: ' + c.literal);
	const meanings = c.meanings.filter((m) => m !== KOKUJI);
	if (!meanings.length) fail('no English meaning for ' + c.literal);
	for (const r of c.on) if (!allChars(r, (cp) => isKatakanaCp(cp) || cp === 0x2d)) fail(`${c.literal}: on reading ${r}`);
	for (const r of c.kun) if (!allChars(r, (cp) => isHiraganaCp(cp) || isKatakanaCp(cp) || cp === 0x2e || cp === 0x2d)) fail(`${c.literal}: kun reading ${r}`);
	if (!c.on.length && !c.kun.length) fail('no reading for ' + c.literal);
	if (!(c.strokes >= 1 && c.strokes <= 30)) fail(`${c.literal}: stroke count ${c.strokes}`);
	if (c.freq !== null && !(c.freq >= 1 && c.freq <= 2501)) fail(`${c.literal}: frequency rank ${c.freq}`);
	const parts = krad.parts.get(c.literal) || [];
	if (!parts.length) noParts.push(c.literal);
	for (const p of parts) {
		if ([...p].length !== 1 || !isElement(p.codePointAt(0))) fail(`${c.literal}: component ${p}`);
		usedElements.add(p);
	}
	const entry = { m: meanings, on: c.on, kun: c.kun, parts, grade: c.grade, strokes: c.strokes, freq: c.freq };
	if (meanings.length !== c.meanings.length) {
		entry.kokuji = true;
		kokujiCount++;
	}
	k[c.literal] = entry;
}

// The components themselves: stroke count (RADKFILE) and, for the 22 that
// KRADFILE has to write as another kanji, the character of the real shape.
const el = {};
const elementList = [...usedElements].sort((a, b) => radk.strokes.get(a) - radk.strokes.get(b) || a.codePointAt(0) - b.codePointAt(0));
for (const e of elementList) {
	if (!radk.strokes.has(e)) fail('RADKFILE has no stroke count for the component ' + e);
	el[e] = { s: radk.strokes.get(e) };
	if (krad.standIns.has(e)) el[e].shape = krad.standIns.get(e);
}
const standInsUsed = elementList.filter((e) => krad.standIns.has(e));

const grades = {};
for (const c of joyo) grades[c.grade] = (grades[c.grade] || 0) + 1;

// alias: other forms of a joyo kanji -> the joyo kanji (see joyoAliases). The
// four joyo kanji without parts are the reason it is here: dictionaries that
// keep to JIS X 0208, JMdict among them, write those four in the older form.
const { aliases, ambiguous } = joyoAliases(kd);
const alias = {};
for (const [other, joyoKanji] of aliases) {
	if ([...other].length !== 1 || !isKanjiCp(other.codePointAt(0))) fail('alias of ' + joyoKanji + ' is not one kanji: ' + other);
	if (k[other] || !k[joyoKanji]) fail(`alias ${other} -> ${joyoKanji} does not lead from outside the joyo list into it`);
	alias[other] = joyoKanji;
}
const aliasOfNoParts = noParts.map((c) => Object.keys(alias).filter((other) => alias[other] === c));
if (aliasOfNoParts.some((list) => list.length !== 1)) fail('expected one other form for each kanji without parts, got ' + JSON.stringify(aliasOfNoParts));

const meta = {
	sources: [
		{ ...kd.source, file: 'KANJIDIC2', version: kd.databaseVersion, created: kd.dateOfCreation, gives: 'm, on, kun, grade, strokes, freq, kokuji, alias' },
		{ ...krad.source, file: 'KRADFILE', gives: 'parts, el[].shape' },
		{ ...radk.source, file: 'RADKFILE', gives: 'el[].s' },
	],
	licence: 'CC BY-SA 4.0 (' + EDRDG_LICENCE_URL + ')',
	credit:
		'Kanji data from KANJIDIC2, KRADFILE and RADKFILE, the property of the Electronic Dictionary Research and Development Group, used in conformance with the Group\'s licence (CC BY-SA 4.0): https://www.edrdg.org/wiki/index.php/KANJIDIC_Project',
	kept: { kanji: joyo.length, grades, withFrequency: joyo.filter((c) => c.freq !== null).length, withParts: joyo.length - noParts.length, elements: elementList.length, standIns: standInsUsed.length, kokuji: kokujiCount, aliases: Object.keys(alias).length },
	dropped: [
		`The ${kd.characters.length - joyo.length} kanji of KANJIDIC2 that are not joyo (grade 1 to 6 or 8); ${Object.keys(alias).length} of them are named in alias as other forms of a joyo kanji.`,
		'From each kanji: code points, radical numbers, dictionary references, query codes (SKIP, four corner and the rest), the old JLPT level, readings in Chinese, Korean and Vietnamese, name readings, meanings in other languages, and stroke counts after the first (KANJIDIC2 lists common miscounts there).',
		`The cross-references between kanji ("variants") are kept only as alias, and only where they join a kanji outside the joyo list to exactly one kanji on it; ${ambiguous.length} kanji cross-referenced with two joyo kanji are left out.`,
		`The pseudo-meaning "${KOKUJI}" is taken out of m and kept as kokuji: true (${kokujiCount} kanji).`,
		'KRADFILE2 is not used (it is not under the EDRDG licence).',
	],
	noParts: {
		kanji: noParts,
		why: 'KRADFILE describes the 6,355 kanji of JIS X 0208. These joyo kanji are the forms the 2010 joyo list adopted from outside that set, so they have no entry and their parts is an empty list.',
	},
	notes: {
		grade: '1 to 6 are the years of primary school; 8 is the rest of the joyo set (KANJIDIC2 uses 8 for it).',
		kun: 'A dot separates the part the kanji writes from the okurigana; a hyphen marks a prefix or suffix. Both are KANJIDIC2 notation.',
		freq: 'Rank among the 2,500 kanji most used in newspapers, 1 being the most frequent; null when KANJIDIC2 gives none.',
		parts: 'As KRADFILE writes them. Where the real shape is not in JIS X 0208 it writes a kanji that contains it; el[part].shape is then the Unicode character KRADFILE names for the real shape.',
		alias: 'alias[c] is the joyo kanji that KANJIDIC2 cross-references the kanji c with, for kanji c outside the joyo list that are cross-referenced with exactly one joyo kanji: older forms, variant forms, and the JIS X 0208 forms of the four kanji in noParts. Look a character up as k[c] || k[alias[c]].',
	},
};

const body =
	'{\n"meta":' +
	json(meta) +
	',\n"k":{\n' +
	Object.entries(k)
		.map(([lit, e]) => json(lit) + ':' + json(e))
		.join(',\n') +
	'\n},\n"el":{\n' +
	Object.entries(el)
		.map(([lit, e]) => json(lit) + ':' + json(e))
		.join(',\n') +
	'\n},\n"alias":' +
	json(alias) +
	'\n}';

writeDataFile('kanji.js', 'LANG_KANJI', body, [
	'misc/_lang/kanji.js: the 2,136 joyo kanji (KANJIDIC2, KRADFILE, RADKFILE; EDRDG, CC BY-SA 4.0).',
	'Generated by scripts/lang/build-kanji.mjs. Do not edit: rebuild.',
	'Sources, licences and the credit a page must show: misc/_lang/LICENSES.md',
]);

console.log(`kanji ${joyo.length}; grades ${json(grades)}; KANJIDIC2 ${kd.databaseVersion}`);
console.log(`without parts: ${noParts.join(' ')}; elements ${elementList.length}, of which stand-ins ${standInsUsed.length}; kokuji ${kokujiCount}`);
console.log(`alias: ${Object.keys(alias).length} other forms of joyo kanji (left out as ambiguous: ${ambiguous.join(' ') || 'none'}); of the kanji without parts: ${noParts.map((c, i) => aliasOfNoParts[i][0] + ' -> ' + c).join(', ')}`);
