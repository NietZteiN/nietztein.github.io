/*
 * Builds misc/_texts/zarathustra-vorrede.js : "Zarathustra's Vorrede", the ten sections of the
 * prologue of Nietzsche's Also sprach Zarathustra, in German.
 *
 *     node scripts/texts/build-zarathustra.mjs [--offline]
 *
 * Source: Project Gutenberg ebook 7205, plain text. Only the lines between the chapter
 * heading "Zarathustra's Vorrede." and the next heading, "Die Reden Zarathustra's", are read,
 * so nothing of the header, the licence or the footer of the file can get in; the script
 * checks that anyway. Project Gutenberg is named as the source in meta and in LICENSES.md,
 * and nowhere in the text.
 *
 * The text is kept exactly: spelling (Theil, giebt, gieng), punctuation, quotation marks and
 * the _underscores_ with which the plain-text edition marks emphasis. The only change is to
 * the line breaks: the file wraps paragraphs at about 70 characters, and the lines of a
 * paragraph are joined here with one space.
 */
import { get, writeData, noBom } from './lib.mjs';

const URL_TXT = 'https://www.gutenberg.org/cache/epub/7205/pg7205.txt';
const APOS = String.fromCharCode(0x2019);       // the typographic apostrophe of the file
const START = 'Zarathustra' + APOS + 's Vorrede.';
const END = 'Die Reden Zarathustra' + APOS + 's';

const r = await get('pg7205.txt', URL_TXT);
const fileLines = noBom(r.text).split(/\r?\n/);

function only(line) {
	const hits = [];
	fileLines.forEach((l, i) => { if (l === line) hits.push(i); });
	if (hits.length !== 1) throw new Error(JSON.stringify(line) + ' occurs ' + hits.length + ' times as a whole line, expected once');
	return hits[0];
}
const startAt = only(START);
const endAt = only(END);
if (!(startAt < endAt)) throw new Error('the two headings are in the wrong order');
if (fileLines[startAt - 3].trim() !== 'Erster Theil') throw new Error('the heading before the Vorrede is not "Erster Theil"');

// The title page of the ebook, for the names as the file gives them.
const startMark = fileLines.findIndex((l) => l.startsWith('*** START OF'));
const head = fileLines.slice(startMark + 1, startMark + 20).map((l) => l.trim()).filter(Boolean);
if (head[0] !== 'cover' || head[1] !== 'Also sprach Zarathustra' || head[2] !== 'Ein Buch für Alle und Keinen' || head[3] !== 'von Friedrich Wilhelm Nietzsche') {
	throw new Error('the title page is not as expected: ' + JSON.stringify(head.slice(0, 5)));
}

const sections = [];
let para = [];
let wrapped = 0;
const flush = () => {
	if (!para.length) return;
	if (!sections.length) throw new Error('text before the first section number: ' + para.join(' '));
	wrapped += para.length - 1;
	sections[sections.length - 1].paras.push(para.join(' '));
	para = [];
};
for (let i = startAt + 1; i < endAt; i++) {
	const line = fileLines[i];
	if (line.trim() === '') { flush(); continue; }
	if (line !== line.trim() || /\s{2,}/.test(line)) throw new Error('unexpected spacing in line ' + (i + 1) + ': ' + JSON.stringify(line));
	if (/^\d+\.$/.test(line)) {
		flush();
		sections.push({ n: sections.length + 1, label: line, paras: [] });
		continue;
	}
	para.push(line);
}
flush();

if (sections.length !== 10) throw new Error('expected ten sections, found ' + sections.length);
const all = sections.map((s) => s.paras.join('\n')).join('\n');
for (const banned of [/gutenberg/i, /licen[sc]e/i, /www\./i, /e-?book/i, /\*\*\*/, /copyright/i, /trademark/i]) {
	if (banned.test(all)) throw new Error('boilerplate in the text: ' + banned);
}
const labels = sections.map((s) => s.label);
const mislabelled = sections.filter((s) => s.label !== s.n + '.');
const words = all.match(/\p{L}+/gu) || [];
const paras = sections.reduce((sum, s) => sum + s.paras.length, 0);

// The source writes ss for the sharp s almost everywhere. Record where it does not, so that
// nobody claims "never".
const ESZETT = String.fromCharCode(0xDF);
const sharp = [];
for (const s of sections) {
	s.paras.forEach((p, i) => {
		for (const w of p.match(/\p{L}+/gu) || []) if (w.includes(ESZETT)) sharp.push({ section: s.n, paragraph: i + 1, word: w });
	});
}
const notes = [];
if (mislabelled.length) {
	notes.push('The source numbers the sections ' + labels.join(' ') + ': section ' + mislabelled.map((s) => s.n).join(', ') + ' is headed "' + mislabelled.map((s) => s.label).join('", "') + '" there. n counts the sections in order; label keeps the heading of the source.');
}
notes.push('The source writes ss where today\'s spelling has ' + ESZETT + ' (dreissig, verliess, grosses)' +
	(sharp.length ? ', except in ' + sharp.map((x) => '"' + x.word + '" (section ' + x.section + ', paragraph ' + x.paragraph + ')').join(', ') + ', kept as the source has ' + (sharp.length === 1 ? 'it' : 'them') + '.' : ', without exception.'));

const data = {
	meta: {
		sources: [r.source],
		licence: 'Public domain',
		credit: 'Friedrich Nietzsche, Also sprach Zarathustra: Zarathustra' + APOS + 's Vorrede. German text from Project Gutenberg, ebook 7205 (gutenberg.org/ebooks/7205). Public domain.',
		kept: 'the ten sections of ' + START.replace(/\.$/, '') + ' (' + paras + ' paragraphs, ' + words.length.toLocaleString('en-US') + ' words), exactly as in the source: spelling, punctuation, and the _underscores_ that mark emphasis. The lines of a paragraph, wrapped in the source, are joined with one space (' + wrapped.toLocaleString('en-US') + ' joins)',
		dropped: 'everything else in the file: the Project Gutenberg header, licence and footer, the title page, the table of contents and all other chapters',
		author: 'Friedrich Wilhelm Nietzsche',
		work: 'Also sprach Zarathustra: Ein Buch für Alle und Keinen',
		part: 'Erster Theil',
		notes,
		sharpS: sharp,
	},
	title: START,
	sections,
};

const body = '{\n"meta": ' + JSON.stringify(data.meta, null, '\t') + ',\n' +
	'"title": ' + JSON.stringify(data.title) + ',\n' +
	'"sections": [\n' + sections.map((s) => '{"n": ' + s.n + ', "label": ' + JSON.stringify(s.label) + ', "paras": [\n' + s.paras.map((p) => '\t' + JSON.stringify(p)).join(',\n') + '\n]}').join(',\n') + '\n]\n}';
writeData('zarathustra-vorrede.js', 'TEXTS_ZARATHUSTRA', [
	'misc/_texts/zarathustra-vorrede.js : window.TEXTS_ZARATHUSTRA',
	'Friedrich Nietzsche, Also sprach Zarathustra: the prologue, ten sections, in German.',
	'Public domain. Built by scripts/texts/build-zarathustra.mjs. Do not edit by hand. See LICENSES.md.',
], body, data);

console.log('  file lines ' + (startAt + 1) + ' to ' + (endAt + 1) + '; sections ' + sections.length + ' (' + labels.join(' ') + '); paragraphs ' + paras + ' (' + sections.map((s) => s.paras.length).join(', ') + '); words ' + words.length + '; joins ' + wrapped);
console.log('  first: ' + sections[0].paras[0].slice(0, 90) + '...');
console.log('  last:  ' + sections[9].paras[sections[9].paras.length - 1]);
