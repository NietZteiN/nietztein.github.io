// Builds misc/_lang/accents.js: the pitch accent of the words of jmdict-core.js.
//
//   node scripts/lang/build-accents.mjs      (after build-jmdict-core.mjs)
//
// Source: accents.txt of Kanjium (CC BY-SA 4.0), at a pinned commit. A word of
// jmdict-core is looked up by its exact written form and reading; no accent is
// guessed, derived or carried over from another spelling.
//
//   a      '<kanji>|<kana>' -> the accent numbers Kanjium lists, in its order.
//          A word written in kana has the key '|<kana>'. 0 is flat (heiban);
//          n is a fall after the n-th mora.
//   q      the same key -> Kanjium's field word for word, for the few words
//          whose numbers it qualifies by part of speech
//   pairs  groups of words with the same kana and different accents, each
//          with its JMdict gloss (see below for the exact rule)

import { json, writeDataFile, loadDataFile, isHiraganaCp, isKatakanaCp } from './lib.mjs';
import { loadAccents, parseAccentField, KANJIUM_LICENCE, KANJIUM_ATTRIBUTION, KANJIUM_REPO } from './kanjium.mjs';

const J = loadDataFile('jmdict-core.js', 'LANG_JMDICT');
const acc = await loadAccents();

function fail(msg) {
	throw new Error('build-accents: ' + msg);
}

// Morae of a kana string: every kana is one, except the small ya/yu/yo and
// small vowels, which belong to the kana before them. The long-vowel mark,
// the small tsu and the syllabic n are morae of their own.
const SMALL = new Set([0x3083, 0x3085, 0x3087, 0x3041, 0x3043, 0x3045, 0x3047, 0x3049, 0x308e, 0x30e3, 0x30e5, 0x30e7, 0x30a1, 0x30a3, 0x30a5, 0x30a7, 0x30a9, 0x30ee]);
export function moraCount(kana) {
	let n = 0;
	for (const ch of kana) {
		const cp = ch.codePointAt(0);
		if (!isHiraganaCp(cp) && !isKatakanaCp(cp)) continue; // the middle dot of a few loan words
		if (!SMALL.has(cp)) n++;
	}
	return n;
}

const a = {};
const q = {};
let unreadable = 0;
let beyond = [];
const rowsOfKey = new Map();
for (const row of J.e) {
	const [kanji, kana] = row;
	const key = kanji + '|' + kana;
	rowsOfKey.set(key, (rowsOfKey.get(key) || 0) + 1);
	const field = acc.lines.get(kanji ? kanji + '|' + kana : kana + '|');
	if (field === undefined) continue;
	const parsed = parseAccentField(field);
	if (!parsed) {
		unreadable++;
		continue;
	}
	const morae = moraCount(kana);
	if (parsed.numbers.some((n) => n > morae)) {
		beyond.push(`${key} ${field} (${morae} morae)`);
		continue;
	}
	a[key] = parsed.numbers;
	if (parsed.qualified) q[key] = field;
}

// pairs: words that sound alike except for the accent. A word takes part if
//   it has a written form with kanji (a bare kana string would not say which word it is),
//   Kanjium gives it exactly one accent number, without a part-of-speech note,
//   and its written form and reading belong to one row of jmdict-core only
//   (otherwise the gloss would be a guess).
// A group is kept when its words carry at least two different numbers.
const byKana = new Map();
for (const [kanji, kana, gloss] of J.e) {
	const key = kanji + '|' + kana;
	if (!kanji || !a[key] || a[key].length !== 1 || q[key] || rowsOfKey.get(key) !== 1) continue;
	if (!byKana.has(kana)) byKana.set(kana, []);
	byKana.get(kana).push([kanji, a[key][0], gloss]);
}
const pairs = [...byKana.entries()]
	.filter(([, words]) => new Set(words.map((w) => w[1])).size >= 2)
	.sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0));

const keys = Object.keys(a).sort();
const sortedA = {};
for (const k of keys) sortedA[k] = a[k];
const sortedQ = {};
for (const k of Object.keys(q).sort()) sortedQ[k] = q[k];

const HASHI = ['橋|はし', '端|はし', '箸|はし'];
for (const k of HASHI) if (!a[k] || a[k].length !== 1) fail('no single accent for ' + k);
if (new Set(HASHI.map((k) => a[k][0])).size !== 3) fail('the three hashi do not have three accents');

const withSeveral = keys.filter((k) => a[k].length > 1).length;
// Keys that several rows of jmdict-core share: different words with the same
// written form and reading. Kanjium lists an accent per spelling, so the
// numbers under such a key do not say which of the words they belong to.
const sharedKeys = keys.filter((k) => rowsOfKey.get(k) > 1);
const meta = {
	sources: [
		{ ...acc.source, file: 'Kanjium accents.txt', lines: acc.lineCount },
		{ ...J.meta.sources[0], via: 'misc/_lang/jmdict-core.js', gives: 'the words that are looked up, and the glosses in pairs' },
	],
	licence: KANJIUM_LICENCE + '; glosses: JMdict, CC BY-SA 4.0',
	credit:
		'Pitch accents from Kanjium (' + KANJIUM_REPO + ', CC BY-SA 4.0): "' + KANJIUM_ATTRIBUTION + '" Glosses from JMdict (Electronic Dictionary Research and Development Group, CC BY-SA 4.0).',
	kept: {
		words: keys.length,
		ofJmdictCore: J.e.length,
		withOneAccent: keys.length - withSeveral,
		withSeveralAccents: withSeveral,
		qualified: Object.keys(q).length,
		pairGroups: pairs.length,
		pairWords: pairs.reduce((n, p) => n + p[1].length, 0),
		keysOfSeveralRows: sharedKeys.length,
		keysOfSeveralRowsInKana: sharedKeys.filter((k) => k.startsWith('|')).length,
	},
	sharedKeys,
	dropped: [
		`${acc.lines.size - keys.length} lines of accents.txt for words that are not rows of jmdict-core.js.`,
		`${J.e.length - keys.length - unreadable - beyond.length} rows of jmdict-core.js that accents.txt does not list under that exact written form and reading.`,
		`${unreadable} matching lines whose accent field could not be read, and ${beyond.length} whose accent number is larger than the number of morae.`,
		'The part-of-speech notes inside a field are dropped from a and kept word for word in q.',
	],
	notes: {
		key: "'<kanji>|<kana>' exactly as the row of jmdict-core.js has them; '|<kana>' for a word written in kana.",
		sharedKeys: 'Keys that stand for more than one row of jmdict-core.js (different words with the same written form and reading, mostly loan words in kana). Kanjium gives an accent per spelling, so the numbers under such a key may belong to either word, or to both. They are left out of pairs.',
		numbers: '0: no fall (heiban). n: the pitch falls after the n-th mora. Several numbers: Kanjium lists several accepted accents, in that order.',
		pairs: '[kana, [[kanji, accent, gloss], ...]]: same kana, one accent number each, at least two different numbers in the group. Words with several accents, words written in kana only and written forms shared by two JMdict entries are left out of pairs.',
		provenance: 'Kanjium does not say which dictionary or recordings its accent numbers were compiled from.',
	},
};

const body =
	'{\n"meta":' +
	json(meta) +
	',\n"a":{\n' +
	keys.map((k) => json(k) + ':' + json(sortedA[k])).join(',\n') +
	'\n},\n"q":' +
	json(sortedQ) +
	',\n"pairs":[\n' +
	pairs.map((p) => json(p)).join(',\n') +
	'\n]\n}';

writeDataFile('accents.js', 'LANG_ACCENT', body, [
	'misc/_lang/accents.js: pitch accents of the words in jmdict-core.js (Kanjium, CC BY-SA 4.0; glosses from JMdict).',
	'Generated by scripts/lang/build-accents.mjs. Do not edit: rebuild.',
	'Sources, licences and the credit a page must show: misc/_lang/LICENSES.md',
]);
console.log(`accents for ${keys.length} of ${J.e.length} words (${withSeveral} with several accents, ${Object.keys(q).length} qualified by part of speech)`);
console.log(`pair groups ${pairs.length}, words in them ${meta.kept.pairWords}; unreadable ${unreadable}; beyond the last mora ${beyond.length}: ${beyond.slice(0, 20).join('; ')}`);
console.log('hashi: ' + HASHI.map((k) => k + ' ' + a[k]).join(', '));
console.log(`keys shared by several rows of jmdict-core: ${sharedKeys.length} (${meta.kept.keysOfSeveralRowsInKana} in kana only)`);
