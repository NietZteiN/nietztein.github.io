// Reader for the three files of Kanjium (github.com/mifunetoshiro/kanjium,
// CC BY-SA 4.0) that the kit uses, each at one pinned commit, so that a fresh
// download is byte for byte what was built from.

import { fetchCached } from './lib.mjs';

export const KANJIUM_COMMIT = '9ebca4589565c696e7c39e089e2e928ad65f678c'; // master on 2026-10-03
export const KANJIUM_REPO = 'https://github.com/mifunetoshiro/kanjium';
export const KANJIUM_LICENCE = 'CC BY-SA 4.0 (https://github.com/mifunetoshiro/kanjium/blob/' + KANJIUM_COMMIT + '/README.md)';
// The attribution the Kanjium README asks for, word for word.
export const KANJIUM_ATTRIBUTION =
	'The pitch accent notation, verb particle data, phonetics, homonyms and other additions or modifications to EDICT, KANJIDIC or KRADFILE were provided by Uros O. through his free database.';

const FILES = {
	accents: { path: 'data/source_files/raw/accents.txt', sha256: '8bd0dd127dab32ceec94cb03ab1ba6b68858ea73421dfa1731af2f373deb4f20' },
	wikipediaFreq: { path: 'data/source_files/raw/wikipedia_freq.txt', sha256: 'd84be5bf6981c22c946458662874ce15b07583bd8ce3437f159d9007dec91de5' },
	novelsFreq: { path: 'data/source_files/raw/novels_freq.txt', sha256: 'adbcadbbd6402844b09709f3058f139ccabee221f32fe16b52664ca159cca97f' },
};

async function load(which) {
	const f = FILES[which];
	const url = `https://raw.githubusercontent.com/mifunetoshiro/kanjium/${KANJIUM_COMMIT}/${f.path}`;
	const r = await fetchCached(url, `kanjium-${KANJIUM_COMMIT.slice(0, 8)}-${f.path.split('/').pop()}`, { expectSha256: f.sha256 });
	const text = new TextDecoder('utf-8', { fatal: true }).decode(r.buf);
	if (text.includes('\r')) throw new Error('Kanjium ' + which + ': unexpected carriage returns');
	return { source: { url, sha256: r.sha256, fetched: r.fetched }, text };
}

// accents.txt: one line per word, "word TAB reading TAB accents". The reading
// is empty when the word is written in kana. Returns { source, lines: Map(
// "word|reading" -> accents field) }; a word listed twice must agree with itself.
export async function loadAccents() {
	const { source, text } = await load('accents');
	const lines = new Map();
	let count = 0;
	for (const line of text.split('\n')) {
		if (!line) continue;
		const cols = line.split('\t');
		if (cols.length !== 3 || !cols[0] || !cols[2]) throw new Error('Kanjium accents: cannot read the line ' + JSON.stringify(line));
		count++;
		const key = cols[0] + '|' + cols[1];
		if (lines.has(key) && lines.get(key) !== cols[2]) throw new Error('Kanjium accents: two different lines for ' + key);
		lines.set(key, cols[2]);
	}
	return { source, lines, lineCount: count };
}

// The accents field: numbers separated by commas, some of them prefixed with a
// part of speech in parentheses, as in "(adverb)0,(noun)3" written with
// Japanese abbreviations. Returns { numbers (in order, without repeats),
// qualified (whether any number carries a prefix) } or null if the field does
// not have that form.
export function parseAccentField(field) {
	const numbers = [];
	let qualified = false;
	for (const token of field.split(',')) {
		const m = /^(\([^()]+\))?(\d+)$/.exec(token);
		if (!m) return null;
		if (m[1]) qualified = true;
		const n = +m[2];
		if (!numbers.includes(n)) numbers.push(n);
	}
	return { numbers, qualified };
}

// A frequency list: first line "#source: <url>", then "word TAB count".
// Returns { source, upstream (the url on the first line), counts: Map(word -> count) }.
async function loadFreq(which) {
	const { source, text } = await load(which);
	const all = text.split('\n');
	const head = /^#source: (\S+)$/.exec(all[0]);
	if (!head) throw new Error('Kanjium ' + which + ': no #source line');
	const counts = new Map();
	for (const line of all.slice(1)) {
		if (!line) continue;
		const cols = line.split('\t');
		if (cols.length !== 2 || !/^\d+$/.test(cols[1])) throw new Error('Kanjium ' + which + ': cannot read the line ' + JSON.stringify(line));
		if (counts.has(cols[0])) throw new Error('Kanjium ' + which + ': the word ' + cols[0] + ' is listed twice');
		counts.set(cols[0], +cols[1]);
	}
	return { source, upstream: head[1], counts };
}
export const loadWikipediaFreq = () => loadFreq('wikipediaFreq');
export const loadNovelsFreq = () => loadFreq('novelsFreq');
