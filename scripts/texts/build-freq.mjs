/*
 * Builds misc/_texts/freq-de.js and misc/_texts/freq-vi.js.
 *
 *     node scripts/texts/build-freq.mjs [--offline] [--review]
 *
 * Source: hermitdave/FrequencyWords, the 2018 lists (counts of word forms in the
 * OpenSubtitles 2018 corpus), content CC BY-SA 4.0. The repository is read at a fixed
 * commit, so a refetch gives the same bytes.
 *
 * What is done to a list, in this order, and nothing else:
 *   1. every entry is NFC-normalised; entries that become equal are merged and their
 *      counts added (the Vietnamese file spells 2,589 syllables twice, once with
 *      precomposed letters and once with combining tone marks; the German file has none);
 *   2. the entries are sorted by count, largest first (ties keep the source order);
 *   3. the first N are kept, with their counts.
 * Nothing is removed for being rude, foreign or broken: coverage figures need every rank.
 *
 * `blocked` flags the kept entries a toy should not pick as a stimulus. blocked.mjs holds
 * the rules and the word lists, shared with build-cmu.mjs, and says how they were found:
 *   - LDNOOBW, CC BY 4.0: its German list for German, its English list for both (subtitles
 *     are full of English);
 *   - SEEN: forms the builders found among the kept entries that the published lists miss
 *     (inflected forms, compounds, and Vietnamese, which LDNOOBW does not cover). The
 *     English additions apply to both lists, as they do to the CMU words;
 *   - the addresses of subtitle and download sites, which the subtitle files carry in their
 *     credits ("phudeviet.org", "subcentral.de"): not rude, but not vocabulary either.
 * UNBLOCK lists the few hits of the English list that are ordinary words of the language.
 *
 * `syllable` (Vietnamese only) says which entries have the shape of a Vietnamese syllable;
 * see vi-syllable.mjs.
 *
 * --review prints the blocked sets with where each word came from.
 */
import { get, writeData, noBom } from './lib.mjs';
import { isViSyllable } from './vi-syllable.mjs';
import { LD_EN, LD_DE, SEEN, UNBLOCK, flagBlocked } from './blocked.mjs';

const FW_COMMIT = '525f9b560de45753a5ea01069454e72e9aa541c6';
const FW = 'https://raw.githubusercontent.com/hermitdave/FrequencyWords/' + FW_COMMIT + '/content/2018/';
const REVIEW = process.argv.includes('--review');

const LISTS = [
	{
		code: 'de', name: 'German', file: 'freq-de.js', global: 'TEXTS_FREQ_DE', top: 20000,
		src: 'de/de_50k.txt', cache: 'freq/de_50k.txt', unit: 'word forms',
		published: [LD_DE, LD_EN],
	},
	{
		code: 'vi', name: 'Vietnamese', file: 'freq-vi.js', global: 'TEXTS_FREQ_VI', top: 10000,
		src: 'vi/vi_50k.txt', cache: 'freq/vi_50k.txt', unit: 'syllables',
		published: [LD_EN],
	},
];

function parseList(text) {
	const lines = noBom(text).split('\n');
	if (lines[lines.length - 1] === '') lines.pop();
	const rows = [];
	for (const line of lines) {
		const m = /^(\S+) (\d+)$/.exec(line);
		if (!m) throw new Error('unexpected line in a frequency list: ' + JSON.stringify(line));
		rows.push([m[1], Number(m[2])]);
	}
	return rows;
}

function nfc(s) {
	return s.normalize('NFC');
}

for (const list of LISTS) {
	const raw = await get(list.cache, FW + list.src);
	const rows = parseList(raw.text);
	const sourceTotal = rows.reduce((sum, r) => sum + r[1], 0);

	// 1. NFC, merging entries that become equal.
	const merged = new Map();
	let notNfc = 0;
	for (const [word, count] of rows) {
		const key = nfc(word);
		if (key !== word) notNfc++;
		if (merged.has(key)) merged.get(key).count += count;
		else merged.set(key, { word: key, count, order: merged.size });
	}
	const mergedAway = rows.length - merged.size;

	// 2. and 3. Sort by count, keep the first N.
	const sorted = [...merged.values()].sort((a, b) => b.count - a.count || a.order - b.order);
	const kept = sorted.slice(0, list.top);
	const words = kept.map((e) => e.word);
	const counts = kept.map((e) => e.count);
	const keptTotal = counts.reduce((a, b) => a + b, 0);
	if (words.some((w) => /\s/.test(w))) throw new Error('an entry contains white space');
	if (new Set(words).size !== words.length) throw new Error('duplicate entries after merging');
	const rank = new Map(words.map((w, i) => [w, i + 1]));

	// The blocked set.
	const sources = [raw.source];
	const published = [];
	for (const [label, cache, url] of list.published) {
		const r = await get(cache, url);
		sources.push(r.source);
		published.push([label, r.text]);
	}
	const own = 'seen ' + list.code;
	const unblock = UNBLOCK[list.code].map(nfc);
	const flags = flagBlocked(words, { published, seen: [[own, SEEN[list.code]], ['seen en', SEEN.en]], unblock, sites: true });
	const { blocked, why, publishedHits } = flags;
	const seenMissing = flags.seenMissing[own];
	const seenNew = flags.seenNew[own];
	const seenEnNew = flags.seenNew['seen en'];

	const data = { meta: null, words, counts, blocked };
	const nonLetter = words.filter((w) => !/^\p{L}+$/u.test(w)).length;
	let syllable = null;
	if (list.code === 'vi') {
		syllable = words.map((w) => (isViSyllable(w) ? '1' : '0')).join('');
		data.syllable = syllable;
	}
	const shaped = syllable ? syllable.split('1').length - 1 : 0;

	const n = (x) => x.toLocaleString('en-US');
	data.meta = {
		sources,
		licence: 'CC BY-SA 4.0',
		credit: list.name + ' word frequencies: hermitdave/FrequencyWords, 2018 lists, counted on the OpenSubtitles 2018 corpus (opus.nlpl.eu), CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/).' +
			' Words flagged as blocked: LDNOOBW (github.com/LDNOOBW), CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/), with additions.',
		licenceUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
		kept: 'the ' + n(list.top) + ' most frequent ' + list.unit + ' of the ' + n(rows.length) + ' in ' + list.src.split('/')[1] +
			', with their counts, lower case as in the source' +
			(mergedAway ? '; entries were NFC-normalised first and ' + n(mergedAway) + ' that then spelled the same ' + (list.code === 'vi' ? 'syllable' : 'word') + ' twice were merged, counts added' : '; every entry was already NFC and none had to be merged'),
		dropped: 'everything after rank ' + n(list.top) + ' (' + n(merged.size - list.top) + ' entries). Nothing was removed from the ranking: rude words, names, English words and subtitle markup keep their ranks',
		entries: words.length,
		sourceEntries: rows.length,
		sourceTokens: sourceTotal,
		keptTokens: keptTotal,
		mergedEntries: mergedAway,
		blockedCount: blocked.length,
		blockedNote: 'blocked = entries a toy should not show as a stimulus (profanity, sexual terms, slurs, the names Hitler and Nazi, and the addresses of subtitle and download sites). They are flagged, never removed. ' +
			Object.keys(publishedHits).map((k) => k + ': ' + publishedHits[k] + ' of its entries occur here').join('; ') +
			'; ' + list.name + ' forms added by the builders (' + (list.code === 'vi' ? 'who read every syllable-shaped entry' : 'who searched the list for word stems and read the hits') + '): ' + seenNew +
			'; English forms added by the builders: ' + seenEnNew +
			'; site addresses: ' + flags.sites.length + ' (' + flags.sites.join(', ') + ')' +
			(unblock.length ? '; left unflagged although on the English list, as ordinary ' + list.name + ': ' + unblock.join(', ') : '') +
			'. Mild words and mild insults are not flagged. A judgement, not a guarantee',
		unblocked: unblock,
		sites: flags.sites,
		notLetters: nonLetter,
	};
	if (syllable) {
		data.meta.syllableCount = shaped;
		data.meta.syllableNote = 'syllable[i] is "1" when words[i] has the shape of one Vietnamese syllable (initial + rhyme + at most one tone mark, by the spelling rules in scripts/texts/vi-syllable.mjs) and "0" when it cannot be Vietnamese: names, English words, subtitle markup, broken encodings. ' +
			n(shaped) + ' of ' + n(words.length) + ' entries pass. A shape test only: "an", "to" and "can" pass.';
	}

	const body = '{\n' +
		'"meta": ' + JSON.stringify(data.meta, null, '\t') + ',\n' +
		'"words": ' + JSON.stringify(words.join(' ')) + '.split(" "),\n' +
		'"counts": ' + JSON.stringify(counts) + ',\n' +
		'"blocked": ' + JSON.stringify(blocked.join(' ')) + '.split(" ")' +
		(syllable ? ',\n"syllable": ' + JSON.stringify(syllable) : '') +
		'\n}';
	writeData(list.file, list.global, [
		'misc/_texts/' + list.file + ' : window.' + list.global,
		'The ' + n(list.top) + ' most frequent ' + list.name + ' ' + list.unit + ' in film subtitles, in order, with counts.',
		'Source: hermitdave/FrequencyWords, 2018 lists (CC BY-SA 4.0). See LICENSES.md for the credit line.',
		'Built by scripts/texts/build-freq.mjs. Do not edit by hand.',
		'Warning: a raw subtitle word list. It contains profanity and slurs; see "blocked".',
	], body, data);

	console.log('  ' + list.code + ': source entries ' + rows.length + ', not NFC ' + notNfc + ', merged away ' + mergedAway + ', after merge ' + merged.size);
	console.log('  tokens: source ' + sourceTotal + ', kept ' + keptTotal + ' (' + (100 * keptTotal / sourceTotal).toFixed(2) + '%)');
	console.log('  count at rank 1: ' + counts[0] + ', at rank ' + list.top + ': ' + counts[counts.length - 1]);
	console.log('  blocked ' + blocked.length + ' (' + JSON.stringify(publishedHits) + ', added by SEEN.' + list.code + ' ' + seenNew + ', by SEEN.en ' + seenEnNew + ', sites ' + flags.sites.length + '), not letters only: ' + nonLetter + (syllable ? ', syllable-shaped: ' + shaped : ''));
	if (seenMissing.length) console.log('  SEEN.' + list.code + ' words that are not among the kept entries (ignored): ' + seenMissing.join(' '));
	const enOnly = blocked.filter((w) => why.get(w).every((s) => s === 'seen en'));
	console.log('  flagged by SEEN.en alone: ' + enOnly.map((w) => w + '#' + rank.get(w) + (syllable && syllable.charAt(rank.get(w) - 1) === '1' ? ' (syllable-shaped!)' : '')).join(' '));
	if (REVIEW) {
		console.log('  blocked, in rank order:');
		console.log('  ' + blocked.map((w) => w + '#' + rank.get(w) + '[' + why.get(w).map((s) => s.replace('LDNOOBW ', 'L-')).join('+') + ']').join(' '));
	}
}
