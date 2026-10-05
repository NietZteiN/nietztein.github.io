/*
 * Writes misc/_texts/LICENSES.md from the meta objects of the data files, and refreshes the
 * table of files in misc/_texts/README.md (between the two "files" markers), so that the
 * credit lines, source URLs, hashes and sizes in the documents cannot drift from the data.
 *
 *     node scripts/texts/build-docs.mjs
 *
 * No network. Run it after any of the build-*.mjs scripts; build-all.mjs does.
 */
import fs from 'node:fs';
import path from 'node:path';
import { OUT, loadData, sha256 } from './lib.mjs';
import { batchesOf, batchUrl } from './dewikt.mjs';

const FILES = [
	{
		file: 'zarathustra-vorrede.js', global: 'TEXTS_ZARATHUSTRA', script: 'build-zarathustra.mjs',
		what: 'Nietzsche, *Also sprach Zarathustra*: the prologue ("Zarathustra\'s Vorrede"), ten sections, in German',
		short: (d) => 'Zarathustra\'s prologue in German: ' + d.sections.length + ' sections, ' + d.sections.reduce((a, s) => a + s.paras.length, 0) + ' paragraphs',
		notes: [
			'Friedrich Nietzsche died in 1900; the first part of the book, which opens with this prologue, appeared in 1883. The text is in the public domain.',
			'The plain-text file of Project Gutenberg\'s ebook 7205 names Peter Bellen under "Credits". Its header, licence and footer are not part of this dataset: their terms ask that they be removed when a text is passed on without them, and the build reads only the lines between two chapter headings. The name Project Gutenberg appears in the credit line and here, as the source, and nowhere in the text.',
			'Changed: the line breaks only. The source wraps each paragraph at about 70 characters; the lines of a paragraph are joined with one space. Spelling, punctuation, quotation marks and the underscores that mark emphasis are as in the source, including its misprint in the section numbers (the ninth section is headed "8.").',
		],
	},
	{
		file: 'freq-de.js', global: 'TEXTS_FREQ_DE', script: 'build-freq.mjs',
		what: 'the 20,000 most frequent German word forms in film subtitles, in order, with counts and a set of blocked words',
		short: (d) => d.words.length.toLocaleString('en-US') + ' German word forms by frequency, with counts; ' + d.blocked.length + ' blocked',
		notes: [
			'hermitdave/FrequencyWords states in its README: "MIT License for code. CC-by-sa-4.0 for content." The lists were counted on the OpenSubtitles 2018 corpus as distributed by OPUS (opus.nlpl.eu/OpenSubtitles2018.php). The repository is read at commit 525f9b5.',
			'LDNOOBW ("List of Dirty, Naughty, Obscene, and Otherwise Bad Words", github.com/LDNOOBW) is CC BY 4.0; read at commit 5faf2ba. Its German and English lists are used.',
			(d) => 'Changed: the list is cut after rank 20,000. `blocked` is an addition: the entries of the two LDNOOBW lists that occur among the 20,000; inflected forms, compounds and further words that the builders found by searching the kept entries for word stems and reading the hits (the lists `SEEN.de` and `SEEN.en` in `scripts/texts/blocked.mjs`, which says how they were found and where the line between flagged and unflagged is drawn); and the ' + d.meta.sites.length + ' entries that are addresses of subtitle sites (' + d.meta.sites.join(', ') + '), which the subtitle files carry in their credits. No word was removed or reordered.',
			'The blocked set is a judgement and was not made by reading all 20,000 entries. A review on 2026-10-05 found six obscene forms that the first build had missed; the search was then repeated with more stems, matched anywhere in a word. `node scripts/texts/review-blocked.mjs de` prints the hits again.',
			'Because the source is CC BY-SA, this file is too.',
		],
	},
	{
		file: 'freq-vi.js', global: 'TEXTS_FREQ_VI', script: 'build-freq.mjs',
		what: 'the 10,000 most frequent Vietnamese syllables in film subtitles, in order, with counts, a set of blocked words and a syllable-shape flag',
		short: (d) => d.words.length.toLocaleString('en-US') + ' Vietnamese syllables by frequency, with counts; ' + d.blocked.length + ' blocked; shape flags',
		notes: [
			'Source and licence as for `freq-de.js`. LDNOOBW has no Vietnamese list; its English list is used (the subtitles are full of English), with the builders\' English additions (`SEEN.en`), and the Vietnamese entries of `blocked` are the builder\'s own (the list `SEEN.vi` in `scripts/texts/blocked.mjs`), found by reading every entry that has the shape of a Vietnamese syllable.',
			(d) => 'Changed: (1) every entry was NFC-normalised. The source spells 2,589 syllables twice, once with precomposed letters and once with combining tone marks; such pairs were merged and their counts added, and the list was sorted again by count. (2) The list is cut after rank 10,000. (3) `blocked` and `syllable` are additions. `blocked` also flags the ' + d.meta.sites.length + ' entries that are addresses of subtitle and download sites (' + d.meta.sites.join(', ') + '). `syllable` marks the entries that have the shape of a Vietnamese syllable under the spelling rules in `scripts/texts/vi-syllable.mjs`; more than half of the 10,000 do not (names, English words, subtitle markup, broken encodings). No entry was removed.',
			'"mong", which is on LDNOOBW\'s English list, is an everyday Vietnamese word (to hope) and is not flagged.',
		],
	},
	{
		file: 'kieu-opening.js', global: 'TEXTS_KIEU', script: 'build-kieu.mjs',
		what: 'Nguyễn Du, *Truyện Kiều*, lines 1 to 38, in quốc ngữ',
		short: (d) => 'Truyện Kiều, lines 1 to ' + d.lines.length + ', in the 1911 transcription of Trương Vĩnh Ký',
		notes: [
			'Nguyễn Du died in 1820. The quốc ngữ text is the transcription of Trương Vĩnh Ký, who died in 1898, in its third edition (Saigon: F.-H. Schneider, 1911). Vietnamese Wikisource transcribes that edition from a scan, page by page, under the title "Truyện Kiều (bản Trương Vĩnh Ký 1911)" and marks it public domain. Lines 1 to 14 are on scan page 14 (validated there), 15 to 34 on page 15 and 35 to 38 on page 17 (both proofread). A validated or proofread page is still a transcription: it is not always letter for letter what the book prints.',
			'Not used, although Wikisource has it: the page "Truyện Kiều (bản Kiều Oánh Mậu 1902)". Kiều Oánh Mậu\'s 1902 edition is in Nôm, and that page shows the Nôm text with a quốc ngữ reading beside it. Its header says the text was collected, annotated and typeset in Nôm by the researchers Nguyễn Thế and Phan Anh Dũng and gives the Nôm Foundation as its source; it does not say who made the quốc ngữ reading or when. A recent transcription can be in copyright, so that page was left alone. The page "Truyện Kiều", in modern spelling, names no edition at all.',
			(d) => 'Changed: ' + d.meta.corrections.length + ' lines, where the Wikisource transcription departs from the printed page and the printed reading was put back: ' +
				d.meta.corrections.map((c) => 'line ' + c.line + ', "' + c.wikisource + '" on Wikisource, "' + c.print + '" in print').join('; ') +
				'. Dropped from the wikitext: the editor\'s footnotes, the title and two section headings, the italics markup and the colon that indents every second line. The text is stored NFC-normalised; it already was.',
			'How the print was read: the last three entries under "Fetched" are images of the scanned pages, from the PDF on Wikimedia Commons that Wikisource transcribes (`File:Kim_Van_Kieu_truyen_Truong_Vinh_Ky.pdf`, pages 14, 15 and 17; Commons marks it public domain). A review compared the 38 lines with them on 2026-10-05 and the fixer read all three pages again the same day. The scan is coarse. Letters, hyphens and the presence of a punctuation mark can be read from it, and in those the 38 lines now agree with the print. Tone marks often cannot (a hook and a grave accent look alike), nor can a comma be told from a full stop; those remain as Wikisource has them and were not verified against the print.',
			'No translation is included, and none was written.',
		],
	},
	{
		file: 'sentences.js', global: 'TEXTS_SENTENCES', script: 'build-sentences.mjs',
		what: (d) => 'short everyday sentences in ' + d.langs.length + ' language entries (' + new Set(d.langs.map((l) => l.iso)).size + ' languages; Chinese in both scripts), each with an English translation',
		short: (d) => d.langs.reduce((a, l) => a + l.sentences.length, 0).toLocaleString('en-US') + ' sentences in ' + d.langs.length + ' language entries, each with a Tatoeba id, owner and English translation',
		notes: [
			'Tatoeba publishes its sentences under CC BY 2.0 FR (a part of the corpus is CC0; only sentences the API reports as "CC BY 2.0 FR" were taken, translations included). The licence asks that every author be credited: show "Tatoeba" with the sentence number and the owner\'s user name, which every sentence here carries (`id`, `by`), and credit the English translation the same way with its own number and owner (`en.id`, `en.by`), because another contributor wrote it. A sentence can be linked as `https://tatoeba.org/en/sentences/show/<id>`.',
			'Fetched through the public API (`api.tatoeba.org/v1/sentences`), one request at a time, because the bulk exports are bz2 archives. The fallback named in the task (the UDHR texts at unicode.org) was not needed.',
			'Changed: nothing in a sentence. The selection is mechanical (see `meta.sampling` and `meta.dropped`, and `scripts/texts/build-sentences.mjs`): a seeded random order, tests of length and script, and a topic screen read against the English translations. The screen list was written by the builder, who then read all English translations of the selection and extended it once.',
			(d) => 'Every entry was asked for with the "owner is a self-declared native speaker" filter. Not included: ' + d.meta.notIncluded,
			(d) => 'The sentences of ' + d.meta.oneOwner.length + ' entries (' + d.meta.oneOwner.join(', ') + ') all belong to one contributor each.',
			'The English translations are Tatoeba\'s links between sentences, made by contributors. They are not always exact, and nothing here checks them.',
			'`family`, `branch` and `meta.lookalikes` are the builder\'s labels, not Tatoeba data.',
		],
	},
	{
		file: 'cmu-phones.js', global: 'TEXTS_CMU', script: 'build-cmu.mjs',
		what: 'phoneme strings with stress digits for the 30,000 most frequent English words that the CMU Pronouncing Dictionary has',
		short: (d) => Object.keys(d.w).length.toLocaleString('en-US') + ' English words with ARPAbet phonemes and stress digits; the 39 phonemes and their classes',
		notes: [
			'The CMU Pronouncing Dictionary is Copyright (C) 1993-2015 Carnegie Mellon University and is distributed under a two-clause BSD-style licence, which must stay with every copy. Its full text is in the comment at the top of `cmu-phones.js` and below. The repository cmusphinx/cmudict is read at commit 7479086.',
			'The order of the words is that of `misc/18-zipf-karaoke/freq.js` (Peter Norvig\'s `count_1w.txt`, which that file says is published under the MIT licence). Only the order is taken from it. The page norvig.com/ngrams, read on 2026-10-05, says: "Data files are derived from the Google Web Trillion Word Corpus, as described by Thorsten Brants and Alex Franz, and distributed by the Linguistic Data Consortium. Code copyright (c) 2008-2009 by Peter Norvig. You are free to use this code under the MIT license." It names the MIT licence for the code and states no separate licence for the data files, so the credit line names the source without a licence.',
			(d) => 'Changed: nothing in a pronunciation. Where the dictionary lists several, the first is kept. `blocked` is an addition: the kept words that are on LDNOOBW\'s English list (CC BY 4.0, read at commit 5faf2ba), and inflected forms, further obscenities and slurs, and the names Hitler and Nazi, which the builders found by searching the kept words for word stems and reading the hits (the list `SEEN.en` in `scripts/texts/blocked.mjs`). ' + d.blocked.length + ' words in all.',
			'The blocked set is a judgement and was not made by reading all 30,000 words. A review on 2026-10-05 found that the first build flagged only exact matches of the LDNOOBW list ("fuck" but not "fucked"); the additions date from that day. `node scripts/texts/review-blocked.mjs en` prints the stem hits again.',
		],
		after: 'cmu-licence',
	},
	{
		file: 'glosses-de.js', global: 'TEXTS_GLOSSES_DE', script: 'build-glosses.mjs', optional: true,
		what: 'English glosses for the most frequent German word forms of `freq-de.js`',
		short: (d) => 'English glosses for ' + Object.keys(d.g).length.toLocaleString('en-US') + ' of the 5,000 most frequent German forms',
		notes: [
			'WikDict (wikdict.com, by Karl Bartel) publishes bilingual dictionaries extracted from Wiktionary through the DBnary project; its site says that "all data is available under a free license (Creative Commons BY-SA)" and links to CC BY-SA 4.0. Every gloss in this file is a translation list from its German–English database.',
			'UniMorph German (github.com/unimorph/deu, read at commit d226d21) is extracted from the English Wiktionary; its README gives CC BY-SA 3.0. The German Wiktionary (de.wiktionary.org) is CC BY-SA 4.0. Both are used only to find the base form of an inflected form.',
			'Changed: see `meta.kept` and `meta.dropped` and the comment at the top of `scripts/texts/build-glosses.mjs`. No gloss was written or edited by hand; the matching of forms to headwords is mechanical and makes mistakes that a reader of German will notice (a rare reading beside a common one, sometimes in front of it).',
			'Because the sources are CC BY-SA, this file is too.',
		],
	},
];

const present = FILES.filter((f) => fs.existsSync(path.join(OUT, f.file)));
const missing = FILES.filter((f) => !f.optional && !fs.existsSync(path.join(OUT, f.file)));
if (missing.length) throw new Error('not built yet: ' + missing.map((f) => f.file).join(', '));

function bytes(file) {
	return Buffer.byteLength(fs.readFileSync(path.join(OUT, file), 'utf8').replace(/\r\n/g, '\n'));
}
function hashOf(file) {
	return sha256(fs.readFileSync(path.join(OUT, file), 'utf8').replace(/\r\n/g, '\n'));
}

/* Where the text of each Creative Commons licence named in a credit line can be read. */
const LICENCE_URLS = [
	['CC BY 2.0 FR', 'https://creativecommons.org/licenses/by/2.0/fr/'],
	['CC BY 4.0', 'https://creativecommons.org/licenses/by/4.0/'],
	['CC BY-SA 3.0', 'https://creativecommons.org/licenses/by-sa/3.0/'],
	['CC BY-SA 4.0', 'https://creativecommons.org/licenses/by-sa/4.0/'],
];

/* ---------------------------------------------------------------- LICENSES.md */
const out = [];
out.push('# Sources and licences of the texts kit');
out.push('');
out.push('Written by `scripts/texts/build-docs.mjs` from the `meta` object of each data file. Do not edit by hand: change the build script and run it again.');
out.push('');
out.push('Every data file in this folder is built by a script in `scripts/texts/` from a named public source. No sentence, verse, word list or gloss was written for it. Each section gives the licence, the credit line a toy must show wherever it uses the data (its "How it works" footer), every URL that was fetched with the day and the SHA-256 of what came back, and what was kept and dropped.');
out.push('');
out.push('Downloads are cached in `scripts/texts/.cache/`, which is gitignored and never published. `node scripts/texts/build-all.mjs --offline` rebuilds every file from that cache, byte for byte; without the cache the scripts fetch again, one request at a time, identifying themselves by the site URL.');
out.push('');
out.push('| File | Licence | From | Bytes | SHA-256 of the file |');
out.push('| --- | --- | --- | ---: | --- |');
const data = {};
for (const f of present) {
	data[f.file] = loadData(path.join(OUT, f.file), f.global);
	const hosts = [...new Set(data[f.file].meta.sources.map((s) => new URL(s.url).host))];
	out.push('| `' + f.file + '` | ' + data[f.file].meta.licence.replace(/\|/g, '/') + ' | ' + hosts.join(', ') + ' | ' + bytes(f.file).toLocaleString('en-US') + ' | `' + hashOf(f.file) + '` |');
}
out.push('');
out.push('Bytes and SHA-256 are of each data file as built, with LF line ends. `node misc/_texts/test.js` compares the files with this table, so a data file that was edited by hand, or built without running `build-docs.mjs` afterwards, fails the test.');
out.push('');
out.push('The licences named below, in full:');
out.push('');
for (const [name, url] of LICENCE_URLS) out.push('- ' + name + ': ' + url);
out.push('- The CMU Pronouncing Dictionary\'s own licence is reproduced under `cmu-phones.js` below.');
out.push('');
for (const f of present) {
	const meta = data[f.file].meta;
	out.push('## `' + f.file + '`');
	out.push('');
	out.push('What: ' + (typeof f.what === 'function' ? f.what(data[f.file]) : f.what) + '. Global: `window.' + f.global + '`. Built by `scripts/texts/' + f.script + '`.');
	out.push('');
	out.push('Licence: ' + meta.licence + (meta.licenceUrl ? ' (' + meta.licenceUrl + ')' : '') + '.');
	out.push('');
	out.push('Credit line:');
	out.push('');
	out.push('> ' + meta.credit);
	out.push('');
	out.push('Kept: ' + meta.kept + '.');
	out.push('');
	out.push('Dropped: ' + meta.dropped + '.');
	out.push('');
	for (const note of f.notes) { out.push(typeof note === 'function' ? note(data[f.file]) : note); out.push(''); }
	if (f.after === 'cmu-licence') {
		const src = fs.readFileSync(path.join(OUT, f.file), 'utf8').replace(/\r\n/g, '\n');
		const start = src.indexOf(' * Copyright (C)');
		const end = src.indexOf(' */');
		if (start === -1 || end === -1) throw new Error('the licence comment of cmu-phones.js was not found');
		out.push('```');
		for (const line of src.slice(start, end).split('\n')) { if (line === '') continue; out.push(line.replace(/^ \* ?/, '')); }
		out.push('```');
		out.push('');
	}
	out.push('Fetched (' + meta.sources.length + (meta.sources.length === 1 ? ' entry' : ' entries') + '):');
	out.push('');
	out.push('| URL | Fetched | SHA-256 |');
	out.push('| --- | --- | --- |');
	for (const s of meta.sources) out.push('| ' + s.url.replace(/\|/g, '%7C') + ' | ' + s.fetched + ' | `' + s.sha256 + '` |');
	out.push('');
	if (meta.batches) {
		// glosses-de.js keeps the hundred Wiktionary requests as one entry; spell them out here.
		const forms = loadData(path.join(OUT, 'freq-de.js'), 'TEXTS_FREQ_DE').words.slice(0, meta.forms);
		const batches = batchesOf(forms);
		if (batches.length !== meta.batches.sha256.length) throw new Error('glosses-de.js records ' + meta.batches.sha256.length + ' Wiktionary answers, but the frequency list makes ' + batches.length + ' requests');
		out.push('The last entry stands for ' + batches.length + ' requests to the German Wiktionary, fifty word forms each, in the order of `freq-de.js`. Its SHA-256 is the hash of the ' + batches.length + ' hashes below written one after another. Every request, with the hash of its answer:');
		out.push('');
		out.push('| # | Forms | URL | SHA-256 |');
		out.push('| ---: | --- | --- | --- |');
		batches.forEach((titles, k) => {
			out.push('| ' + (k + 1) + ' | ' + (k * 50 + 1) + ' to ' + (k * 50 + 50) + ' | ' + batchUrl(titles) + ' | `' + meta.batches.sha256[k] + '` |');
		});
		out.push('');
	}
}
if (!present.some((f) => f.file === 'glosses-de.js')) {
	out.push('## Not included: German glosses');
	out.push('');
	out.push('`glosses-de.js` has not been built. See `scripts/texts/build-glosses.mjs`.');
	out.push('');
}
fs.writeFileSync(path.join(OUT, 'LICENSES.md'), out.join('\n'));
console.log('wrote misc/_texts/LICENSES.md  ' + Buffer.byteLength(out.join('\n')) + ' bytes, ' + present.length + ' sections');

/* ---------------------------------------------------------------- README.md table */
const readmeFile = path.join(OUT, 'README.md');
if (!fs.existsSync(readmeFile)) {
	console.log('misc/_texts/README.md does not exist yet; table not written');
} else {
	const readme = fs.readFileSync(readmeFile, 'utf8').replace(/\r\n/g, '\n');
	const a = readme.indexOf('<!-- files:start -->');
	const b = readme.indexOf('<!-- files:end -->');
	if (a === -1 || b === -1 || b < a) throw new Error('README.md has no <!-- files:start --> ... <!-- files:end --> block');
	const rows = ['| File | Global | What | Bytes |', '| --- | --- | --- | ---: |'];
	let total = 0;
	for (const f of present) {
		const size = bytes(f.file);
		total += size;
		rows.push('| `' + f.file + '` | `window.' + f.global + '` | ' + f.short(data[f.file]) + ' | ' + size.toLocaleString('en-US') + ' |');
	}
	const next = readme.slice(0, a) + '<!-- files:start -->\n' + rows.join('\n') + '\n\nTogether ' + total.toLocaleString('en-US') + ' bytes. Sizes are of the files with LF line ends, before the server compresses them.\n' + readme.slice(b);
	fs.writeFileSync(readmeFile, next);
	console.log('refreshed the table in misc/_texts/README.md (' + present.length + ' files, ' + total + ' bytes)');
}
