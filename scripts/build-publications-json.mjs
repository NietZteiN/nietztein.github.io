// Builds assets/data/publications.json from the hand-written publication list in
// index.html (the #publicationsContent section), so toys and tools can read the
// list without scraping HTML at run time. index.html stays the source of truth:
// edit the page, then run this.
//
// Zero dependencies. Run with:
//   node scripts/build-publications-json.mjs           regenerate the file
//   node scripts/build-publications-json.mjs --check   write nothing; exit 1 if the
//                                                      file on disk is out of date
//
// One object per .pub-block, in page order:
//   { id, title, authors, authorsText, year, section, venue, links, story }
//   id           kebab slug of the whole title (stable for as long as the title is)
//   title        the .h5 line
//   authors      the names on the .pub-authors line, split on commas (or "and"),
//                without footnote marks
//   authorsText  the .pub-authors line as displayed (marks such as † kept)
//   year         the .pub-year-h2 heading the block sits under, as a number
//   section      the heading above that, as displayed ("Workshop papers")
//   venue        the .pub-congress line as displayed, minus the play link
//   links        [{ label, href }] for every other link in the block. The title
//                link has no label of its own, so it is named after where it
//                points (PDF, arXiv, PhilArchive). hrefs are copied as written: a
//                relative one is relative to the site root, not to this file.
//   story        the ?story=<id> of the block's .pub-play link (Paper Theatre),
//                or null
//
// Text is copied, never rewritten: tags are dropped, entities decoded, whitespace
// collapsed. A block that does not fit the pattern stops the build with an error
// instead of a guess. The press list further down the page also uses .pub-block;
// it lives in another section and is not read.
//
// No per-author "self" flag is written: the bold .pub-author class is also on
// the co-first author of two papers, so it does not single out the site owner.
//
// Output is LF, two-space JSON (like blog/index.json) with a trailing newline and
// no timestamps, so running this twice changes nothing.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const root = join(scriptDir, '..');
const indexHtml = join(root, 'index.html');
const outFile = join(root, 'assets', 'data', 'publications.json');
const OUT = 'assets/data/publications.json';
const RUN = 'node scripts/build-publications-json.mjs';
const SECTION_ID = 'publicationsContent';

function fail(message) {
	throw new Error(message);
}

// ---- small HTML helpers -----------------------------------------------------

// One tag. Groups: "/" on a closing tag, the tag name, the raw attributes.
// Quoted attribute values may contain ">".
const TAG_RE = /<(\/?)([A-Za-z][A-Za-z0-9]*)((?:"[^"]*"|'[^']*'|[^'">])*)>/g;
const tags = () => new RegExp(TAG_RE.source, 'g');

// Tags that separate words when rendered. Inline tags (span, sup, em, a) do
// not, so "Le</span><sup>†</sup>," stays "Le†,".
const BREAKING = new Set([
	'br', 'hr', 'div', 'p', 'li', 'ul', 'ol', 'dl', 'dt', 'dd', 'table', 'tr', 'td', 'th',
	'blockquote', 'section', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
]);

// Named entities a hand-written page is likely to use, as code points. An
// unknown one stops the build rather than leak "&name;" into the JSON; add it here.
const ENTITIES = {
	amp: 0x26, lt: 0x3c, gt: 0x3e, quot: 0x22, apos: 0x27, nbsp: 0xa0,
	ndash: 0x2013, mdash: 0x2014, hellip: 0x2026, middot: 0xb7, bull: 0x2022,
	lsquo: 0x2018, rsquo: 0x2019, ldquo: 0x201c, rdquo: 0x201d, laquo: 0xab, raquo: 0xbb,
	dagger: 0x2020, Dagger: 0x2021, sect: 0xa7, para: 0xb6,
	copy: 0xa9, reg: 0xae, trade: 0x2122, deg: 0xb0, times: 0xd7, minus: 0x2212, plusmn: 0xb1,
	larr: 0x2190, rarr: 0x2192,
	agrave: 0xe0, aacute: 0xe1, auml: 0xe4, ccedil: 0xe7, egrave: 0xe8, eacute: 0xe9,
	iacute: 0xed, ntilde: 0xf1, oacute: 0xf3, ouml: 0xf6, uacute: 0xfa, uuml: 0xfc, szlig: 0xdf,
};

function decodeEntities(s) {
	return s.replace(/&(#[xX][0-9a-fA-F]+|#[0-9]+|[A-Za-z][A-Za-z0-9]*);/g, (ref, body) => {
		if (body[0] !== '#') {
			if (!Object.hasOwn(ENTITIES, body)) fail(`Unknown HTML entity ${ref} in index.html: add it to ENTITIES in scripts/build-publications-json.mjs`);
			return String.fromCodePoint(ENTITIES[body]);
		}
		const code = /^#[xX]/.test(body) ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
		if (!(code > 0 && code <= 0x10ffff) || (code >= 0xd800 && code <= 0xdfff)) fail(`Bad character reference ${ref} in index.html`);
		return String.fromCodePoint(code);
	});
}

// Markup -> the text a reader sees: tags dropped, entities decoded, runs of
// whitespace (non-breaking spaces included) collapsed to one space.
function plain(html) {
	const text = html.replace(tags(), (tag, close, name) => (BREAKING.has(name.toLowerCase()) ? ' ' : ''));
	const stray = /<[A-Za-z\/!?][^\n]{0,40}/.exec(text);
	if (stray) fail(`Could not parse the markup at "${stray[0]}" in index.html`);
	return decodeEntities(text).replace(/\s+/g, ' ').trim();
}

// An attribute value from a tag's raw attributes, or null.
function attr(attrs, name) {
	const m = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i').exec(attrs);
	return m ? decodeEntities(m[1] ?? m[2] ?? m[3]) : null;
}

function hasClass(attrs, token) {
	return (attr(attrs, 'class') || '').split(/\s+/).includes(token);
}

// The element whose opening tag is the regex match `open`: its inner markup and
// the index just past its closing tag. Elements of the same name may nest.
function closeOf(html, open) {
	const name = open[2].toLowerCase();
	const re = tags();
	re.lastIndex = open.index + open[0].length;
	let depth = 1;
	let m;
	while ((m = re.exec(html))) {
		if (m[2].toLowerCase() !== name) continue;
		depth += m[1] ? -1 : 1;
		if (depth === 0) return { inner: html.slice(open.index + open[0].length, m.index), end: m.index + m[0].length };
	}
	return fail(`A <${name}> in index.html is never closed: ${open[0].replace(/\s+/g, ' ').slice(0, 80)}`);
}

// Elements matching test(tagName, rawAttributes), in document order. A match is
// skipped over whole, so matches never nest.
function* elements(html, test) {
	const re = tags();
	let m;
	while ((m = re.exec(html))) {
		if (m[1]) continue;
		const tag = m[2].toLowerCase();
		if (!test(tag, m[3])) continue;
		const el = closeOf(html, m);
		yield { tag, attrs: m[3], inner: el.inner, start: m.index, end: el.end };
		re.lastIndex = el.end;
	}
}

// How many opening tags match test(tagName, rawAttributes), nested or not.
function countOpen(html, test) {
	let n = 0;
	for (const m of html.matchAll(tags())) if (!m[1] && test(m[2].toLowerCase(), m[3])) n++;
	return n;
}

const isPlayLink = (tag, attrs) => tag === 'a' && hasClass(attrs, 'pub-play');

// Markup without its .pub-play links: "Play the visual novel" is not part of
// the line it sits on.
function dropPlayLinks(html) {
	let out = html;
	for (const a of [...elements(html, isPlayLink)].reverse()) out = out.slice(0, a.start) + out.slice(a.end);
	return out;
}

// ---- one publication ---------------------------------------------------------

// "A, B, and C" / "A and B" / "A & B" all split; the page itself uses commas.
const AUTHOR_SEP = /\s*,\s*(?:(?:and|&)\s+)?|\s+(?:and|&)\s+/;
// Footnote marks left on a name when they are not wrapped in <sup>.
const TRAILING_MARKS = /[\s*†‡§¶]+$/;

// "What Does an Embedding Mean? A Semiotic…" -> "what-does-an-embedding-mean-a-semiotic-…"
function slugify(s) {
	return s
		.normalize('NFKD')
		.replace(/\p{M}/gu, '') // accents split off by NFKD
		.toLowerCase()
		.replace(/['’]/g, '')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
}

const HOST_LABELS = {
	'arxiv.org': 'arXiv',
	'philarchive.org': 'PhilArchive',
	'philpapers.org': 'PhilPapers',
	'doi.org': 'DOI',
	'openreview.net': 'OpenReview',
	'aclanthology.org': 'ACL Anthology',
	'dl.acm.org': 'ACM DL',
};

function urlOf(href) {
	try {
		return new URL(href, 'https://site.invalid/');
	} catch (e) {
		return null;
	}
}

// A label for a link that has none of its own (the title link): the known host,
// else "PDF" for a .pdf, else the host name.
function linkLabel(href) {
	const url = urlOf(href);
	if (!url) return 'Link';
	const host = url.hostname.replace(/^www\./, '');
	if (Object.hasOwn(HOST_LABELS, host)) return HOST_LABELS[host];
	if (/\.pdf$/i.test(url.pathname)) return 'PDF';
	return host === 'site.invalid' ? 'Link' : host;
}

function parseBlock(html, at, section, year) {
	if (section === null) fail(`${at}: this .pub-block has no section heading above it`);
	if (year === null) fail(`${at}: this .pub-block has no .pub-year-h2 heading above it in its section`);

	const only = (token, what) => {
		const found = [...elements(html, (tag, attrs) => tag === 'div' && hasClass(attrs, token))];
		if (found.length !== 1) fail(`${at}: expected one ${what} (div.${token}) in this .pub-block, found ${found.length}`);
		return found[0];
	};
	const titleEl = only('h5', 'title line');
	const authorsEl = only('pub-authors', 'author line');
	const venueEl = only('pub-congress', 'venue line');

	const title = plain(dropPlayLinks(titleEl.inner));
	if (!title) fail(`${at}: the title line is empty`);
	const id = slugify(title);
	if (!id) fail(`${at}: the title "${title}" has no letters or digits to make an id from`);

	const authorsHtml = dropPlayLinks(authorsEl.inner);
	const authorsText = plain(authorsHtml);
	const authors = plain(authorsHtml.replace(/<sup\b[^>]*>[\s\S]*?<\/sup>/gi, ''))
		.split(AUTHOR_SEP)
		.map((name) => name.replace(TRAILING_MARKS, '').trim());
	if (!authorsText || authors.some((name) => !name)) fail(`${at}: could not split the author line "${authorsText}" into names ("${title}")`);

	const venue = plain(dropPlayLinks(venueEl.inner));
	if (!venue) fail(`${at}: the venue line is empty ("${title}")`);

	const links = [];
	const stories = [];
	for (const a of elements(html, (tag) => tag === 'a')) {
		const href = attr(a.attrs, 'href');
		if (hasClass(a.attrs, 'pub-play')) {
			const url = href === null ? null : urlOf(href);
			const story = url ? url.searchParams.get('story') : null;
			if (!story) fail(`${at}: the .pub-play link has no ?story=<id> in its href ("${title}")`);
			stories.push(story);
			continue;
		}
		if (href === null) continue;
		const inTitle = a.start >= titleEl.start && a.end <= titleEl.end;
		links.push({ label: (!inTitle && plain(a.inner)) || linkLabel(href), href });
	}
	if (stories.length > 1) fail(`${at}: more than one .pub-play link in one .pub-block ("${title}")`);

	return { id, title, authors, authorsText, year, section, venue, links, story: stories.length ? stories[0] : null };
}

// ---- the whole list -----------------------------------------------------------

// The inner markup of <section id="publicationsContent"> and where it starts.
function findSection(doc) {
	const re = /<(\/?)section\b((?:"[^"]*"|'[^']*'|[^'">])*)>/gi;
	const opens = [];
	let m;
	while ((m = re.exec(doc))) if (!m[1] && attr(m[2], 'id') === SECTION_ID) opens.push(m);
	if (opens.length !== 1) fail(`index.html must have exactly one <section id="${SECTION_ID}">, found ${opens.length}`);
	const start = opens[0].index + opens[0][0].length;
	re.lastIndex = start;
	let depth = 1;
	while ((m = re.exec(doc))) {
		depth += m[1] ? -1 : 1;
		if (depth === 0) return { inner: doc.slice(start, m.index), start };
	}
	return fail(`<section id="${SECTION_ID}"> in index.html is never closed`);
}

function parsePublications(html) {
	// Comments are blanked, not removed, so offsets still give index.html line numbers.
	const doc = html.replace(/<!--[\s\S]*?-->/g, (c) => c.replace(/[^\r\n]/g, ' '));
	const { inner, start } = findSection(doc);
	const at = (i) => `index.html line ${doc.slice(0, start + i).split('\n').length}`;

	const entries = [];
	let section = null;
	let year = null;
	const re = tags();
	let m;
	while ((m = re.exec(inner))) {
		if (m[1]) continue;
		const tag = m[2].toLowerCase();
		if (/^h[1-6]$/.test(tag)) {
			const el = closeOf(inner, m);
			const text = plain(el.inner);
			if (hasClass(m[3], 'pub-year-h2')) {
				if (!/^\d{4}$/.test(text)) fail(`${at(m.index)}: the year heading "${text}" is not a four-digit year`);
				year = Number(text);
			} else {
				if (!text) fail(`${at(m.index)}: empty section heading`);
				section = text;
				year = null; // a new section needs its own year heading
			}
			re.lastIndex = el.end;
		} else if (tag === 'div' && hasClass(m[3], 'pub-block')) {
			const el = closeOf(inner, m);
			entries.push(parseBlock(el.inner, at(m.index), section, year));
			re.lastIndex = el.end;
		}
	}

	if (!entries.length) fail(`No .pub-block found in <section id="${SECTION_ID}"> of index.html`);

	// Nothing may slip past the walk above: count the blocks and the play links
	// again without it.
	const blocks = countOpen(inner, (tag, attrs) => hasClass(attrs, 'pub-block'));
	if (blocks !== entries.length) fail(`#${SECTION_ID} has ${blocks} .pub-block elements but ${entries.length} were read (is one nested in another?)`);
	const plays = countOpen(inner, (tag, attrs) => hasClass(attrs, 'pub-play'));
	const withStory = entries.filter((e) => e.story !== null).length;
	if (plays !== withStory) fail(`#${SECTION_ID} has ${plays} .pub-play links but ${withStory} were read (is one outside a .pub-block?)`);

	const seen = new Set();
	for (const e of entries) {
		if (seen.has(e.id)) fail(`Two publications share the id "${e.id}": their titles must differ`);
		seen.add(e.id);
	}
	return entries;
}

// ---- CLI ------------------------------------------------------------------------

// "line 12: file has …, expected …" for the first line that differs.
function firstDifference(found, expected) {
	const a = found.split('\n');
	const b = expected.split('\n');
	let i = 0;
	while (i < a.length && i < b.length && a[i] === b[i]) i++;
	const show = (line) => (line === undefined ? 'nothing' : JSON.stringify(line.trim()));
	return `line ${i + 1}: file has ${show(a[i])}, expected ${show(b[i])}`;
}

function main() {
	const args = process.argv.slice(2);
	const unknown = args.find((a) => a !== '--check');
	if (unknown !== undefined) fail(`Unknown argument "${unknown}". Usage: ${RUN} [--check]`);
	const check = args.includes('--check');

	const entries = parsePublications(readFileSync(indexHtml, 'utf8'));
	const json = JSON.stringify(entries, null, 2) + '\n';
	const what = `${entries.length} publication${entries.length === 1 ? '' : 's'}`;
	const disk = existsSync(outFile) ? readFileSync(outFile, 'utf8') : null;

	if (check) {
		if (disk === null) {
			console.error(`${OUT} does not exist. Run: ${RUN}`);
			process.exitCode = 1;
			return;
		}
		// Git may check the file out with CRLF line endings (core.autocrlf); that is not drift.
		const found = disk.replace(/\r\n/g, '\n');
		if (found !== json) {
			console.error(`${OUT} is out of date (${firstDifference(found, json)}). Run: ${RUN}`);
			process.exitCode = 1;
			return;
		}
		console.log(`${OUT} is up to date (${what}).`);
		return;
	}

	if (disk === json) {
		console.log(`${OUT} is already up to date (${what}).`);
		return;
	}
	mkdirSync(dirname(outFile), { recursive: true });
	writeFileSync(outFile, json);
	console.log(`Wrote ${what} to ${OUT}`);
}

try {
	main();
} catch (e) {
	console.error(`build-publications-json: ${e.message}`);
	process.exitCode = 1;
}
