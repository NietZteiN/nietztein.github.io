// Builds misc/_lang/freq-ja.js: the two-kanji words of jmdict-core.js with
// their counts in Kanjium's two frequency lists, and the set of two-kanji
// strings that are attested anywhere in the sources, for a game of "word or
// not a word".
//
//   node scripts/lang/build-freq-ja.mjs      (after build-jmdict-core.mjs and build-kanji.mjs)
//
// Sources: wikipedia_freq.txt and novels_freq.txt of Kanjium (CC BY-SA 4.0),
// at a pinned commit; JMdict (EDRDG, CC BY-SA 4.0).
//
//   w      [kanji, kana, gloss, wiki, novels]: a written form of exactly two
//          kanji from jmdict-core.js, its reading and gloss there, and its
//          count in each list (0 when the list does not have it). Sorted by
//          the Wikipedia count, then the novels count, largest first.
//   alt    forms that jmdict-core.js has under more than one reading: the
//          other readings, [[kana, gloss], ...]
//   known  first kanji -> string of second kanji: every two-kanji string that
//          is a written form in JMdict (any entry, common or not) or a word in
//          either list, as long as both kanji are joyo or occur in w. A string
//          a page makes up is "not a word" only if it is not in here.

import { json, writeDataFile, loadDataFile, isKanjiCp, isHiraganaCp, isKatakanaCp } from './lib.mjs';
import { loadJmdict } from './edrdg.mjs';
import { loadWikipediaFreq, loadNovelsFreq, KANJIUM_LICENCE, KANJIUM_ATTRIBUTION, KANJIUM_REPO } from './kanjium.mjs';

const J = loadDataFile('jmdict-core.js', 'LANG_JMDICT');
const K = loadDataFile('kanji.js', 'LANG_KANJI');
const jm = await loadJmdict();
const wiki = await loadWikipediaFreq();
const novels = await loadNovelsFreq();

function fail(msg) {
	throw new Error('build-freq-ja: ' + msg);
}
if (J.meta.sources[0].sha256 !== jm.source.sha256) fail('jmdict-core.js was built from another edition of JMdict; rebuild it first');

const twoKanji = (s) => {
	const chars = [...s];
	return chars.length === 2 && chars.every((c) => isKanjiCp(c.codePointAt(0)));
};

// ---- w and alt ---------------------------------------------------------------------

const firstRow = new Map();
const alt = {};
J.e.forEach((row, index) => {
	const [kanji, kana, gloss] = row;
	if (!twoKanji(kanji)) return;
	if (!firstRow.has(kanji)) firstRow.set(kanji, { kanji, kana, gloss, index });
	else (alt[kanji] = alt[kanji] || []).push([kana, gloss]);
});
const w = [...firstRow.values()].map((r) => ({ ...r, wiki: wiki.counts.get(r.kanji) || 0, novels: novels.counts.get(r.kanji) || 0 }));
w.sort((x, y) => y.wiki - x.wiki || y.novels - x.novels || x.index - y.index);
for (const r of w) {
	for (const ch of r.kana) {
		const cp = ch.codePointAt(0);
		if (!isHiraganaCp(cp) && !isKatakanaCp(cp)) fail('reading with a character that is not kana: ' + r.kana);
	}
	if (!r.gloss) fail('no gloss for ' + r.kanji);
}

// ---- known ---------------------------------------------------------------------------

const alphabet = new Set(Object.keys(K.k));
const joyoCount = alphabet.size;
for (const r of w) for (const ch of r.kanji) alphabet.add(ch);

const attested = new Set();
let fromJmdict = 0;
for (const entry of jm.entries) {
	for (const k of entry.k) {
		if (twoKanji(k.text) && !attested.has(k.text)) {
			attested.add(k.text);
			fromJmdict++;
		}
	}
}
let fromLists = 0;
for (const list of [wiki, novels]) {
	for (const word of list.counts.keys()) {
		if (twoKanji(word) && !attested.has(word)) {
			attested.add(word);
			fromLists++;
		}
	}
}
const knownMap = new Map();
let knownCount = 0;
for (const s of attested) {
	const [first, second] = [...s];
	if (!alphabet.has(first) || !alphabet.has(second)) continue;
	if (!knownMap.has(first)) knownMap.set(first, []);
	knownMap.get(first).push(second);
	knownCount++;
}
const byCodePoint = (x, y) => x.codePointAt(0) - y.codePointAt(0);
const known = {};
for (const first of [...knownMap.keys()].sort(byCodePoint)) known[first] = knownMap.get(first).sort(byCodePoint).join('');
for (const r of w) {
	const [first, second] = [...r.kanji];
	if (!known[first] || ![...known[first]].includes(second)) fail('known does not hold the word ' + r.kanji);
}

const meta = {
	sources: [
		{ ...wiki.source, file: 'Kanjium wikipedia_freq.txt', words: wiki.counts.size, upstream: wiki.upstream, gives: 'w[][3], known' },
		{ ...novels.source, file: 'Kanjium novels_freq.txt', words: novels.counts.size, upstream: novels.upstream, gives: 'w[][4], known' },
		{ ...jm.source, file: 'JMdict_e', created: jm.created, gives: 'the words, readings and glosses (through misc/_lang/jmdict-core.js), known' },
	],
	licence: KANJIUM_LICENCE + '; JMdict: CC BY-SA 4.0',
	credit:
		'Word frequencies from Kanjium (' + KANJIUM_REPO + ', CC BY-SA 4.0): "' + KANJIUM_ATTRIBUTION + '" Words and glosses from JMdict (Electronic Dictionary Research and Development Group, CC BY-SA 4.0).',
	kept: {
		words: w.length,
		inWikipediaList: w.filter((r) => r.wiki).length,
		inNovelsList: w.filter((r) => r.novels).length,
		inNeitherList: w.filter((r) => !r.wiki && !r.novels).length,
		withOtherReadings: Object.keys(alt).length,
		known: knownCount,
		knownFirstKanji: Object.keys(known).length,
		alphabet: alphabet.size,
		alphabetJoyo: joyoCount,
	},
	dropped: [
		'From the two lists: every word that is not a two-kanji written form of jmdict-core.js (their counts are not kept; their two-kanji words still go into known).',
		`From known: ${attested.size - knownCount} attested two-kanji strings with a kanji that is neither joyo nor used in w.`,
		'Written forms with the repetition mark (as in hito-bito) are not counted as two kanji.',
	],
	row: ['kanji', 'kana', 'gloss', 'wiki', 'novels'],
	notes: {
		counts: 'Occurrences of the written form in the list, whatever its reading: the lists count spellings. 0 means the list does not have the form.',
		wiki: 'Kanjium describes the list as word frequency based on an analysis of Japanese Wikipedia (20,000 words).',
		novels:
			'Kanjium describes the list as word frequency based on an analysis of over 5,000 novels. Its segmenter turned some kana strings into the wrong kanji, so a few forms have counts far above their real use; prefer the Wikipedia count to rank words, and use the novels count for coverage.',
		kana: 'The reading of the first row of jmdict-core.js with that written form; alt lists the others.',
		known: `Sources of known: ${fromJmdict} written forms of JMdict, and ${fromLists} more words that only the two lists have (among them surnames and counters). Names in general are not covered: JMnedict is not part of the kit.`,
	},
};

const body =
	'{\n"meta":' +
	json(meta) +
	',\n"w":[\n' +
	w.map((r) => json([r.kanji, r.kana, r.gloss, r.wiki, r.novels])).join(',\n') +
	'\n],\n"alt":' +
	json(alt) +
	',\n"known":{\n' +
	Object.entries(known)
		.map(([first, seconds]) => json(first) + ':' + json(seconds))
		.join(',\n') +
	'\n}\n}';

writeDataFile('freq-ja.js', 'LANG_FREQ_JA', body, [
	'misc/_lang/freq-ja.js: two-kanji words with their counts in two frequency lists, and the attested two-kanji strings',
	'(Kanjium, CC BY-SA 4.0; JMdict, EDRDG, CC BY-SA 4.0).',
	'Generated by scripts/lang/build-freq-ja.mjs. Do not edit: rebuild.',
	'Sources, licences and the credit a page must show: misc/_lang/LICENSES.md',
]);
console.log(`words ${w.length} (in the Wikipedia list ${meta.kept.inWikipediaList}, in the novels list ${meta.kept.inNovelsList}, in neither ${meta.kept.inNeitherList}); other readings for ${Object.keys(alt).length}`);
console.log(`known ${knownCount} strings under ${Object.keys(known).length} first kanji; alphabet ${alphabet.size} (${joyoCount} joyo); JMdict forms ${fromJmdict}, list-only ${fromLists}`);
