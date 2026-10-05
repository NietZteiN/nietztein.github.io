// Builds misc/_lang/jmdict-tech.js: the words of JMdict that are written only
// in kanji and have a sense in the field of computing or mathematics.
//
//   node scripts/lang/build-jmdict-tech.mjs
//
// Source: JMdict, English edition (EDRDG, CC BY-SA 4.0), read as published.
//
// Why this file exists: jmdict-core.js holds the common words, and only a few
// dozen of them carry the field tags comp or math in the sense their gloss
// comes from. A page that builds technical words out of kanji needs the
// technical vocabulary itself, common or not.
//
// A row is [kanji, kana, gloss, tags, band], the shape of jmdict-core.js, but
// the sense is the first one tagged comp or math (so the gloss is the
// technical meaning, where jmdict-core gives the everyday one), the written
// form is the first all-kanji form that sense applies to, and nothing is
// required of the priority tags.

import { json, writeDataFile, isKanjiCp, isHiraganaCp, isKatakanaCp } from './lib.mjs';
import { loadJmdict, nfBand, EDRDG_LICENCE_URL } from './edrdg.mjs';

const jm = await loadJmdict();

const FIELDS = ['comp', 'math'];
const UNWANTED_MISC = new Set(['vulg', 'X', 'derog', 'sens']);
// Written forms and readings JMdict marks as irregular, outdated, rare or
// there for searching only.
const SKIP_K_INFO = new Set(['iK', 'oK', 'rK', 'sK', 'io']);
const SKIP_R_INFO = new Set(['ik', 'ok', 'rk', 'sk']);
const KANJI_ITER = 0x3005; // the repetition mark that stands for a kanji

const allKanji = (s) => {
	for (const ch of s) {
		const cp = ch.codePointAt(0);
		if (!isKanjiCp(cp) && cp !== KANJI_ITER) return false;
	}
	return s.length > 0;
};

const rows = [];
let notAllKanji = 0;
let unwanted = 0;
for (const entry of jm.entries) {
	const sense = entry.s.find((s) => s.field.some((f) => FIELDS.includes(f)));
	if (!sense) continue;
	if (sense.misc.some((m) => UNWANTED_MISC.has(m))) {
		unwanted++;
		continue;
	}
	const kForm = entry.k.find((k) => allKanji(k.text) && !k.info.some((i) => SKIP_K_INFO.has(i)) && (sense.stagk.length === 0 || sense.stagk.includes(k.text)));
	if (!kForm) {
		notAllKanji++;
		continue;
	}
	const rForm = entry.r.find(
		(r) => !r.noKanji && !r.info.some((i) => SKIP_R_INFO.has(i)) && (r.restr.length === 0 || r.restr.includes(kForm.text)) && (sense.stagr.length === 0 || sense.stagr.includes(r.text))
	);
	if (!rForm || !sense.gloss.length) {
		notAllKanji++;
		continue;
	}
	rows.push({ seq: +entry.seq, kanji: kForm.text, kana: rForm.text, gloss: sense.gloss[0], sense, band: nfBand([...kForm.pri, ...rForm.pri]) });
}

// Shortest words first, then JMdict's own order.
rows.sort((a, b) => [...a.kanji].length - [...b.kanji].length || a.seq - b.seq);

function fail(msg) {
	throw new Error('build-jmdict-tech: ' + msg);
}
for (const r of rows) {
	for (const ch of r.kana) {
		const cp = ch.codePointAt(0);
		if (!isHiraganaCp(cp) && !isKatakanaCp(cp)) fail('reading with a character that is not kana: ' + r.kana);
	}
	if (!r.gloss || r.gloss !== r.gloss.trim()) fail('empty or untrimmed gloss for ' + r.kanji);
}

const tagKinds = { pos: new Set(), field: new Set(), misc: new Set() };
for (const r of rows) for (const kind of ['pos', 'field', 'misc']) for (const code of r.sense[kind]) tagKinds[kind].add(code);
const tagTable = {};
for (const kind of ['pos', 'field', 'misc']) {
	tagTable[kind] = {};
	for (const code of [...tagKinds[kind]].sort()) tagTable[kind][code] = jm.entities.get(code);
}

const byLength = {};
for (const r of rows) byLength[[...r.kanji].length] = (byLength[[...r.kanji].length] || 0) + 1;

const meta = {
	sources: [{ ...jm.source, file: 'JMdict_e', created: jm.created }],
	licence: 'CC BY-SA 4.0 (' + EDRDG_LICENCE_URL + ')',
	credit:
		'Words and glosses from JMdict, the property of the Electronic Dictionary Research and Development Group, used in conformance with the Group\'s licence (CC BY-SA 4.0): https://www.edrdg.org/wiki/index.php/JMdict-EDICT_Dictionary_Project',
	kept: {
		entries: rows.length,
		comp: rows.filter((r) => r.sense.field.includes('comp')).length,
		math: rows.filter((r) => r.sense.field.includes('math')).length,
		byLength,
		withBand: rows.filter((r) => r.band).length,
	},
	dropped: [
		`${notAllKanji} entries with a computing or mathematics sense but no usable written form made of kanji alone (mostly words in katakana).`,
		`${unwanted} entries whose technical sense JMdict marks vulgar, derogatory, rude or sensitive.`,
		'From each entry: every other written form, reading, sense and gloss, cross-references, notes, examples.',
	],
	row: ['kanji', 'kana', 'gloss', 'tags', 'band'],
	tags: tagTable,
	notes: {
		gloss: 'The first gloss of the first sense tagged comp or math: the technical meaning. jmdict-core.js gives the first sense of all, so a word in both files can have two different glosses.',
		kanji: 'The first written form made only of kanji that the sense applies to and that JMdict does not mark irregular, outdated, rare or search-only.',
		band: 'As in jmdict-core.js: the smallest nfNN tag of the two forms, or 0. Most technical words have none.',
		order: 'By the number of kanji, then in the order of JMdict.',
	},
};

const body =
	'{\n"meta":' +
	json(meta) +
	',\n"e":[\n' +
	rows.map((r) => json([r.kanji, r.kana, r.gloss, [...r.sense.pos, ...r.sense.field, ...r.sense.misc].join(','), r.band])).join(',\n') +
	'\n]\n}';

writeDataFile('jmdict-tech.js', 'LANG_JMDICT_TECH', body, [
	'misc/_lang/jmdict-tech.js: all-kanji words with a computing or mathematics sense, [kanji, kana, gloss, tags, band] (JMdict; EDRDG, CC BY-SA 4.0).',
	'Generated by scripts/lang/build-jmdict-tech.mjs. Do not edit: rebuild.',
	'Sources, licences and the credit a page must show: misc/_lang/LICENSES.md',
]);
console.log(`kept ${rows.length} (comp ${meta.kept.comp}, math ${meta.kept.math}); by length ${json(byLength)}; with a band ${meta.kept.withBand}`);
console.log(`dropped: no all-kanji form ${notAllKanji}, unwanted ${unwanted}`);
