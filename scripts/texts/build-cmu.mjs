/*
 * Builds misc/_texts/cmu-phones.js : phoneme strings, with stress digits, for the 30,000 most
 * frequent English words that the CMU Pronouncing Dictionary has.
 *
 *     node scripts/texts/build-cmu.mjs [--offline]
 *
 * Source: github.com/cmusphinx/cmudict at a fixed commit (cmudict.dict, cmudict.phones, LICENSE).
 * Order: misc/18-zipf-karaoke/freq.js (Peter Norvig's count_1w.txt, 50,000 words by frequency).
 * The frequency list is walked from the top; a word is kept when the dictionary has it, until
 * 30,000 are kept. Where the dictionary lists several pronunciations ("word", "word(2)", ...),
 * the first one is kept. Comments after " #" in the dictionary are dropped. Nothing is changed
 * in a pronunciation.
 *
 * `blocked` flags the kept words that a toy should not show as a sample word: those on
 * LDNOOBW's English list, and the inflected forms, further obscenities, slurs and two names
 * that the builders found among the kept words (SEEN.en in blocked.mjs, which says how they
 * were found and where the line is drawn). Nothing is removed.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { get, writeData, sha256, ROOT } from './lib.mjs';
import { LD_EN, SEEN, flagBlocked } from './blocked.mjs';

const CMU_COMMIT = '74790861f652b15e4ac49015a90074ad62a27690';
const CMU = 'https://raw.githubusercontent.com/cmusphinx/cmudict/' + CMU_COMMIT + '/';
const FREQ = 'misc/18-zipf-karaoke/freq.js';
const WANT = 30000;

const dict = await get('cmu/cmudict.dict', CMU + 'cmudict.dict');
const phonesFile = await get('cmu/cmudict.phones', CMU + 'cmudict.phones');
const licence = await get('cmu/LICENSE', CMU + 'LICENSE');
const bad = await get(LD_EN[1], LD_EN[2]);

// The 39 phonemes and their classes.
const phones = {};
for (const line of phonesFile.text.split('\n')) {
	if (!line.trim()) continue;
	const m = /^([A-Z]+)\t([a-z]+)$/.exec(line);
	if (!m) throw new Error('unexpected line in cmudict.phones: ' + JSON.stringify(line));
	phones[m[1]] = m[2];
}
if (Object.keys(phones).length !== 39) throw new Error('expected 39 phonemes, found ' + Object.keys(phones).length);

// The dictionary: first-listed pronunciation of every word.
const first = new Map();
let entries = 0, variants = 0, comments = 0;
for (const line of dict.text.split('\n')) {
	if (!line) continue;
	const m = /^(\S+?)(?:\((\d+)\))? ([A-Z0-9 ]+?)( #.*)?$/.exec(line);
	if (!m) throw new Error('unexpected line in cmudict.dict: ' + JSON.stringify(line));
	entries++;
	if (m[4]) comments++;
	if (m[2]) { variants++; continue; }
	if (first.has(m[1])) throw new Error('two first pronunciations for ' + m[1]);
	for (const p of m[3].split(' ')) {
		const pm = /^([A-Z]+)([012])?$/.exec(p);
		if (!pm || !phones[pm[1]]) throw new Error('unknown phoneme ' + p + ' in ' + line);
		if ((phones[pm[1]] === 'vowel') !== (pm[2] !== undefined)) throw new Error('stress digit on a consonant, or none on a vowel: ' + line);
	}
	first.set(m[1], m[3]);
}

// The order.
const freqText = fs.readFileSync(path.join(ROOT, FREQ), 'utf8');
const sandbox = { window: {} };
vm.runInNewContext(freqText, sandbox);
const freqWords = sandbox.window.ZIPF_FREQ.words.split(' ');

const w = {};
const skipped = [];
let kept = 0, lastRank = 0;
for (let i = 0; i < freqWords.length && kept < WANT; i++) {
	const word = freqWords[i];
	if (first.has(word)) {
		if (/^\d+$/.test(word)) throw new Error('a numeric key would break the order of the object: ' + word);
		w[word] = first.get(word);
		kept++;
		lastRank = i + 1;
	} else skipped.push(word);
}
if (kept !== WANT) throw new Error('only ' + kept + ' of the frequency words are in the dictionary');
if (Object.keys(w).length !== WANT) throw new Error('duplicate words in the frequency list');

const flags = flagBlocked(Object.keys(w), { published: [[LD_EN[0], bad.text]], seen: [['seen en', SEEN.en]] });
const blocked = flags.blocked;
if (flags.seenMissing['seen en'].length) throw new Error('SEEN.en names words that are not among the kept entries: ' + flags.seenMissing['seen en'].join(' '));

const n = (x) => x.toLocaleString('en-US');
const data = {
	meta: {
		sources: [dict.source, phonesFile.source, licence.source, bad.source],
		licence: 'BSD 2-clause style (the CMUdict licence, reproduced in the comment at the top of this file and in LICENSES.md)',
		credit: 'Pronunciations: the CMU Pronouncing Dictionary (github.com/cmusphinx/cmudict), Copyright (C) 1993-2015 Carnegie Mellon University.' +
			' Word order: Peter Norvig\'s count_1w.txt (norvig.com/ngrams), derived from the Google Web Trillion Word Corpus.' +
			' Words flagged as blocked: LDNOOBW (github.com/LDNOOBW), CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/), with additions.',
		kept: 'the first-listed pronunciation of the ' + n(WANT) + ' most frequent English words that the dictionary has, with stress digits (0 none, 1 primary, 2 secondary), in frequency order; plus the dictionary\'s table of its 39 phonemes and their classes',
		dropped: 'the other ' + n(first.size - WANT) + ' words of the dictionary, all alternative pronunciations (' + n(variants) + ' in the dictionary), and its ' + comments + ' line comments. ' +
			n(skipped.length) + ' of the first ' + n(lastRank) + ' frequency words are not in the dictionary and were passed over (mostly abbreviations and web jargon: ' + skipped.slice(0, 8).join(', ') + ', ...)',
		entries: WANT,
		order: {
			file: FREQ,
			sha256: sha256(freqText.replace(/\r\n/g, '\n')),
			note: 'Peter Norvig\'s count_1w.txt (Google Web Trillion Word Corpus), 50,000 words by frequency. Object.keys(w) is in this order; the last kept word, "' + freqWords[lastRank - 1] + '", has rank ' + n(lastRank) + ' there.',
		},
		dictionaryWords: first.size,
		blockedCount: blocked.length,
		blockedNote: 'blocked = kept words a toy should not show as a sample word (profanity, sexual terms, slurs, the names Hitler and Nazi). They are flagged, never removed. ' +
			'LDNOOBW en (CC BY 4.0): ' + flags.publishedHits[LD_EN[0]] + ' of its entries occur here; added by the builders (inflected forms of those, and obscenities and slurs the list lacks, found by searching the kept words for word stems and reading the hits): ' + flags.seenNew['seen en'] +
			'. Mild words (damn, hell, crap), mild insults (idiot, moron) and neutral words for groups of people (gay, lesbian) are not flagged. A judgement, not a guarantee.',
	},
	phones,
	w,
	blocked,
};

const body = '{\n' +
	'"meta": ' + JSON.stringify(data.meta, null, '\t') + ',\n' +
	'"phones": ' + JSON.stringify(phones) + ',\n' +
	'"w": ' + JSON.stringify(w) + ',\n' +
	'"blocked": ' + JSON.stringify(blocked) + '\n}';
const licenceLines = licence.text.replace(/\s+$/, '').split('\n');
writeData('cmu-phones.js', 'TEXTS_CMU', [
	'misc/_texts/cmu-phones.js : window.TEXTS_CMU',
	'Phoneme strings (ARPAbet, with stress digits) for the ' + n(WANT) + ' most frequent English words,',
	'from the CMU Pronouncing Dictionary. Built by scripts/texts/build-cmu.mjs. Do not edit by hand.',
	'',
	'The dictionary is distributed under this licence, which must stay with it:',
	'',
].concat(licenceLines), body, data);

console.log('  dictionary lines ' + entries + ', distinct words ' + first.size + ', variants ' + variants + ', comments ' + comments);
console.log('  frequency words ' + freqWords.length + '; kept ' + kept + ', the last at rank ' + lastRank + ' ("' + freqWords[lastRank - 1] + '"); passed over ' + skipped.length);
console.log('  blocked ' + blocked.length + ' (' + JSON.stringify(flags.publishedHits) + ', added by SEEN.en ' + flags.seenNew['seen en'] + '): ' + blocked.join(' '));
console.log('  first entries: ' + Object.keys(w).slice(0, 6).map((k) => k + ' = ' + w[k]).join('; '));
