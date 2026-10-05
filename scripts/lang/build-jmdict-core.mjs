// Builds misc/_lang/jmdict-core.js: the common words of JMdict, one row per entry.
//
//   node scripts/lang/build-jmdict-core.mjs
//
// Source: JMdict, English edition (EDRDG, CC BY-SA 4.0), read as published.
//
// What is kept: the entries JMdict itself calls common, that is, entries with
// a written form or reading tagged news1, ichi1, spec1, spec2 or gai1 (the
// entries marked (P) in EDICT). Entries whose only priority tags are of the
// second tier (news2, ichi2, gai2) are left out: with them the file would be
// about 1.6 MB.
//
// A row is [kanji, kana, gloss, tags, band]:
//   kanji  the first written form with a common tag, or '' when the entry is
//          common only in kana
//   kana   the first reading of that form with a common tag (else the first
//          with any priority tag, else the first that applies to the form)
//   gloss  the first gloss of the first sense that applies to those two
//   tags   that sense's part-of-speech, field and misc codes, comma-separated
//   band   the smallest nfNN tag on the two forms (1 to 48: the NN-th block of
//          500 words in the newspaper frequency file), or 0 when they have none
// Nothing is reworded, shortened or translated.

import { json, writeDataFile, isKanjiCp, isHiraganaCp, isKatakanaCp } from './lib.mjs';
import { loadJmdict, COMMON_TAGS, nfBand, EDRDG_LICENCE_URL } from './edrdg.mjs';

const jm = await loadJmdict();

// Senses a page that picks words at random should not serve.
const UNWANTED_MISC = new Set(['vulg', 'X', 'derog', 'sens']);
// JMdict's tags do not reach every such word: the plain words for sex acts,
// sex work, pornography and sexual offences carry none of them. An entry is
// also left out when the gloss that would be shown names one of these. The
// pattern is deliberately narrow: "sex education", "the opposite sex",
// "sexual harassment" and the like stay, and so does "rapeseed".
const UNWANTED_GLOSS = /\b(?:prostitut\w*|penis|semen|ejaculat\w*|erotic|pornograph\w*|rape|molest\w*|strip show|stripper|sexual (?:intercourse|desire|assault|arousal)|sex (?:position|service)|selling of sex)\b|^sex$/i;

const isCommon = (x) => x.pri.some((p) => COMMON_TAGS.has(p));

export function coreRow(entry) {
	const kForm = entry.k.find(isCommon) || null;
	let rForm;
	if (kForm) {
		const applies = (r) => !r.noKanji && (r.restr.length === 0 || r.restr.includes(kForm.text));
		rForm = entry.r.find((r) => applies(r) && isCommon(r)) || entry.r.find((r) => applies(r) && r.pri.length) || entry.r.find(applies);
	} else {
		rForm = entry.r.find(isCommon);
	}
	if (!rForm) return null;
	const kanji = kForm ? kForm.text : '';
	const kana = rForm.text;
	const sense = entry.s.find((s) => (kForm ? s.stagk.length === 0 || s.stagk.includes(kanji) : s.stagk.length === 0) && (s.stagr.length === 0 || s.stagr.includes(kana)));
	if (!sense || !sense.gloss.length) return null;
	return { seq: +entry.seq, kanji, kana, gloss: sense.gloss[0], sense, band: nfBand([...(kForm ? kForm.pri : []), ...rForm.pri]) };
}

const rows = [];
let secondTier = 0;
let unwanted = 0;
let unwantedByGloss = 0;
let unusable = 0;
for (const entry of jm.entries) {
	const any = entry.k.some((x) => x.pri.length) || entry.r.some((x) => x.pri.length);
	if (!any) continue;
	if (!entry.k.some(isCommon) && !entry.r.some(isCommon)) {
		secondTier++;
		continue;
	}
	const row = coreRow(entry);
	if (!row) {
		unusable++;
		continue;
	}
	if (row.sense.misc.some((m) => UNWANTED_MISC.has(m))) {
		unwanted++;
		continue;
	}
	if (UNWANTED_GLOSS.test(row.gloss)) {
		unwantedByGloss++;
		continue;
	}
	rows.push(row);
}

// Most frequent first: bands 1 to 48, then the words without a band; inside a
// band, JMdict's own entry order.
rows.sort((a, b) => (a.band || 99) - (b.band || 99) || a.seq - b.seq);

// ---- checks ---------------------------------------------------------------------

function fail(msg) {
	throw new Error('build-jmdict-core: ' + msg);
}
const isKanaCp = (cp) => isHiraganaCp(cp) || isKatakanaCp(cp);
const otherChars = new Map();
for (const r of rows) {
	for (const ch of r.kana) {
		const cp = ch.codePointAt(0);
		if (!isKanaCp(cp) && cp !== 0x30fb) fail(`reading with a character that is not kana: ${r.kana}`);
	}
	for (const ch of r.kanji) {
		const cp = ch.codePointAt(0);
		if (!isKanjiCp(cp) && !isKanaCp(cp)) otherChars.set(ch, (otherChars.get(ch) || 0) + 1);
	}
	if (!r.gloss || r.gloss !== r.gloss.trim()) fail('empty or untrimmed gloss for ' + r.kanji + ' ' + r.kana);
	if (/[\t\n]/.test(r.gloss)) fail('control character in a gloss');
}

const tagKinds = { pos: new Map(), field: new Map(), misc: new Map() };
for (const r of rows) for (const kind of ['pos', 'field', 'misc']) for (const code of r.sense[kind]) tagKinds[kind].set(code, (tagKinds[kind].get(code) || 0) + 1);
const tagTable = {};
for (const kind of ['pos', 'field', 'misc']) {
	tagTable[kind] = {};
	for (const code of [...tagKinds[kind].keys()].sort()) tagTable[kind][code] = jm.entities.get(code);
}
for (const kind of ['pos', 'field', 'misc']) for (const code of Object.keys(tagTable[kind])) if (/,/.test(code)) fail('a tag code contains a comma: ' + code);

const withBand = rows.filter((r) => r.band).length;
const meta = {
	sources: [{ ...jm.source, file: 'JMdict_e', created: jm.created }],
	licence: 'CC BY-SA 4.0 (' + EDRDG_LICENCE_URL + ')',
	credit:
		'Words and glosses from JMdict, the property of the Electronic Dictionary Research and Development Group, used in conformance with the Group\'s licence (CC BY-SA 4.0): https://www.edrdg.org/wiki/index.php/JMdict-EDICT_Dictionary_Project',
	kept: {
		entries: rows.length,
		withKanji: rows.filter((r) => r.kanji).length,
		kanaOnly: rows.filter((r) => !r.kanji).length,
		withBand,
		withoutBand: rows.length - withBand,
		fieldComp: tagKinds.field.get('comp') || 0,
		fieldMath: tagKinds.field.get('math') || 0,
	},
	dropped: [
		`${jm.entries.length - rows.length - secondTier - unwanted - unwantedByGloss - unusable} entries of JMdict without any priority tag.`,
		`${secondTier} entries whose only priority tags are of the second tier (news2, ichi2, gai2 and their nf bands): not "common" by JMdict's own rule.`,
		`${unwanted} common entries whose first sense JMdict marks vulgar (vulg), derogatory (derog), rude (X) or sensitive (sens).`,
		`${unwantedByGloss} more common entries whose gloss names a sex act, sex work, pornography or a sexual offence (it matches meta.unwantedGloss): JMdict's tags do not mark them, and a page that draws words at random should not serve them.`,
		`${unusable} common entries without a usable form, reading or sense.`,
		'From each entry: every written form and reading after the first common one, every sense after the first that applies, every gloss after the first, cross-references, notes, examples, loan-word sources, dialect tags.',
	],
	row: ['kanji', 'kana', 'gloss', 'tags', 'band'],
	unwantedGloss: UNWANTED_GLOSS.source,
	tags: tagTable,
	notes: {
		kanji: "The first written form with a common tag; '' when the entry is common only in kana. The tag uk in tags means JMdict says the word is usually written in kana all the same.",
		band: 'The smallest nfNN tag of the two forms: 1 to 48, each a block of 500 words in the newspaper frequency file JMdict uses, 1 being the most frequent. 0 means the forms have no nf tag (they are common by another list), not that the word is rare.',
		order: 'By band (1 to 48, then 0), then in the order of JMdict.',
		tags: 'Comma-separated codes of the sense the gloss comes from: part of speech, then field, then misc. meta.tags explains each code in the words of the JMdict DTD.',
		homographs: 'A few written forms occur in more than one entry and so in more than one row.',
	},
};

const body =
	'{\n"meta":' +
	json(meta) +
	',\n"e":[\n' +
	rows.map((r) => json([r.kanji, r.kana, r.gloss, [...r.sense.pos, ...r.sense.field, ...r.sense.misc].join(','), r.band])).join(',\n') +
	'\n]\n}';

const out = writeDataFile('jmdict-core.js', 'LANG_JMDICT', body, [
	'misc/_lang/jmdict-core.js: the common words of JMdict, [kanji, kana, gloss, tags, band] (EDRDG, CC BY-SA 4.0).',
	'Generated by scripts/lang/build-jmdict-core.mjs. Do not edit: rebuild.',
	'Sources, licences and the credit a page must show: misc/_lang/LICENSES.md',
]);
if (out.bytes > 1250000) fail(`the file is ${out.bytes} bytes; the budget is about 1.2 MB`);

console.log(`JMdict created ${jm.created}: ${jm.entries.length} entries; kept ${rows.length} (${meta.kept.withKanji} with kanji, ${meta.kept.kanaOnly} kana only; ${withBand} with a band)`);
console.log(`dropped: second tier ${secondTier}, unwanted first sense ${unwanted}, unwanted by gloss ${unwantedByGloss}, unusable ${unusable}`);
console.log(`field tags: comp ${meta.kept.fieldComp}, math ${meta.kept.fieldMath}`);
console.log('characters in written forms that are neither kanji nor kana: ' + [...otherChars].map(([c, n]) => `${c} U+${c.codePointAt(0).toString(16)} x${n}`).join(', '));
