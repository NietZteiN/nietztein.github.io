// Builds the toy cards in index.html, and misc/toys.json, from misc/*/toy.json.
//
// Every toy under misc/ describes itself in a small manifest,
// misc/<NN-slug>/toy.json. This script turns the manifests into
//   - the Misc tab's grid between the "toys:grid" markers in index.html: the
//     cards group by group, each group under a heading,
//   - the Misc tab's toolbar between the "toys:tools" markers: filter box, one
//     chip per group, Random, and the Cards / Compact switch (assets/js/misc.js
//     makes it work),
//   - the cards between the "toys:views" markers (the Bookshelf tab's "Ways to
//     see the library" strip) and the number in its "N views" hint,
//   - misc/toys.json: the group table plus every manifest, for pages and scripts.
// So nobody edits a card by hand. To add a toy: add its folder, its 800x500
// thumbnail at assets/img/misc/<NN-slug>.jpg and its toy.json, then run this.
//
// Zero dependencies. Run with:
//   node scripts/build-cards.mjs           rebuild; a file is written only if its bytes change
//   node scripts/build-cards.mjs --check   write nothing; exit 1 if a file would change
// Either way an invalid manifest stops the run: every problem is listed, nothing
// is written and the exit code is 1.
//
// A manifest, misc/44-text-tartan/toy.json:
//   {
//   	"n": 44,                                   the folder's number
//   	"slug": "44-text-tartan",                  the folder's name
//   	"title": "Text Tartan",                    card title
//   	"desc": "Weave any text into cloth: ...",  card description
//   	"note": "",                                small print under it (Misc grid only)
//   	"group": "art",                            an id from GROUPS below
//   	"tags": [],                                extra words the Misc filter finds the toy by
//   	"added": "2026-10-02",                     decides the "New" badge, see below
//   	"surfaces": ["grid"],                      "grid", "views", both, or [] for no card
//   	"order": { "grid": 11, "views": null },    position on each surface, see below
//   	"status": "live",                          "wip" keeps the toy out of index.html
//   	"kit": false
//   }
// plus "thumb": { "legacy": true } for the older thumbnails that are not 800x500.
// title, desc and note are one line of HTML text: entities such as &amp; stay as
// written, and a bare & < or > is escaped. Keys this script does not know are
// passed through to misc/toys.json untouched.
//
// Order on a surface: toys with no number in order[surface] come first, newest
// (highest n) on top; then the numbered ones, ascending. A new toy therefore
// needs no number, and the older cards keep the order they were written in.
//
// The Misc grid shows the groups in GROUPS order. A group that has a card gets a
// heading with its count and a chip in the toolbar; a group with none gets
// neither. Inside a group the order is the one above. The views strip is one
// flat row and its cards carry no extra attributes.
//
// A grid card also carries what misc.js and the command palette read:
//   data-n="44" data-group="art" data-tags="weave cloth" data-added="2026-10-02"
// (data-tags and data-added are left out when the manifest has nothing to say).
//
// The "New" badge: of the toys that have a card (on the grid or in the strip),
// the ones sharing the newest "added" date are the latest wave, and those of
// them on the grid get a small "New" pill on the thumbnail. A wave of more toys
// than a third of the grid's cards gets none (a badge on every other card says
// nothing): the badge is for the handful of toys that arrived last. No clock is
// read, so the same manifests always give the same page.
//
// index.html keeps its own line endings (LF or CRLF), its BOM if it has one,
// and every byte outside the three marker pairs and the views count.
// misc/toys.json is LF, tab-indented and free of timestamps, so the same
// manifests always give the same bytes (if a checkout has turned it into CRLF,
// that is kept too).
//
// Other scripts can import GROUPS, SURFACES, REGIONS, TOY_DIR_RE, loadManifests,
// validate, sortFor, groupsFor, newestWave, renderCard, renderBlock, renderTools,
// applyToIndex, renderToysJson, escapeText, escapeAttr and jpegSize; importing
// this file builds nothing. scripts/test-cards.mjs checks the result against the
// last commit.

import { readdirSync, readFileSync, writeFileSync, existsSync, realpathSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(scriptDir, '..');

// The one table of toy groups: id (what a manifest's "group" holds), display
// name, and display order (the order of this array).
export const GROUPS = [
	{ id: 'stories', name: 'Stories and the site' },
	{ id: 'ml', name: 'Machine learning, live' },
	{ id: 'lab', name: 'Experiments on you' },
	{ id: 'code', name: 'Code and obfuscation' },
	{ id: 'language', name: 'Language' },
	{ id: 'library', name: 'Library' },
	{ id: 'art', name: 'Art and sound' },
	{ id: 'time', name: 'Clocks and maps' },
];

// Where a card can show: "grid" is the Misc tab, "views" the Bookshelf strip.
// Each has a pair of marker comments in index.html.
export const SURFACES = ['grid', 'views'];

// Everything this script writes into index.html, each between its own pair of
// marker comments: the two surfaces, and "tools", the Misc tab's toolbar.
export const REGIONS = [...SURFACES, 'tools'];

// The small print under a description shows on these surfaces only.
const NOTE_SURFACES = ['grid'];

// A wave of new toys is badged "New" only while it is at most this fraction of
// the grid: 1 / NEW_WAVE_SHARE.
const NEW_WAVE_SHARE = 3;

// The filter box's placeholder and its name for screen readers.
const FILTER_LABEL = 'Filter the toys';

// A toy folder is misc/<two or three digits>-<slug>. Anything else under misc/
// (misc/_kit, for one) is not a toy and is never read.
export const TOY_DIR_RE = /^(\d{2,3})-[a-z0-9-]+$/;

const THUMB_WIDTH = 800;
const THUMB_HEIGHT = 500;

// The byte-order mark some Windows tools put at the start of a file. Built from
// its code so that no invisible character has to sit in this source.
const BOM = String.fromCharCode(0xfeff);

// ---- reading the manifests --------------------------------------------------

// Width and height of a JPEG, from its first start-of-frame segment (markers
// C0-CF, minus C4, C8 and CC, which are tables and not frames). Null when the
// bytes are not a JPEG or hold no frame header before the image data.
export function jpegSize(bytes) {
	if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
	let p = 2;
	while (p + 4 <= bytes.length) {
		if (bytes[p] !== 0xff) return null;
		const marker = bytes[p + 1];
		if (marker === 0xff) {
			p += 1; // fill byte before a marker
			continue;
		}
		p += 2;
		if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue; // no length field
		if (marker === 0xd9 || marker === 0xda) return null; // image data or end, and still no frame
		const length = bytes.readUInt16BE(p);
		const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
		if (isFrame) {
			if (p + 7 > bytes.length) return null;
			return { width: bytes.readUInt16BE(p + 5), height: bytes.readUInt16BE(p + 3) };
		}
		if (length < 2) return null;
		p += length;
	}
	return null;
}

function readManifest(path) {
	const bytes = readFileSync(path);
	const utf16 = bytes.length >= 2 && ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff));
	if (utf16) throw new Error('is saved as UTF-16; save it as UTF-8');
	const text = bytes.toString('utf8');
	let toy;
	try {
		toy = JSON.parse(text.startsWith(BOM) ? text.slice(1) : text);
	} catch (e) {
		throw new Error(`is not valid JSON (${e.message})`);
	}
	if (toy === null || typeof toy !== 'object' || Array.isArray(toy)) throw new Error('must hold one JSON object');
	return toy;
}

// One record per toy folder under misc/, sorted by folder number:
//   dir    the folder's name, "44-text-tartan"
//   num    the folder's number, 44
//   file   "misc/44-text-tartan/toy.json"
//   found  whether that file exists
//   toy    the parsed manifest, or null (no file, or a file that cannot be read)
//   error  why toy is null when the file exists; otherwise ""
//   page   whether misc/<dir>/index.html exists
//   thumb  { file, exists, near, width, height } for assets/img/misc/<dir>.jpg;
//          "near" is a file whose name differs only in case, width and height
//          are 0 when the size cannot be read
// Names are compared exactly, because GitHub Pages is case-sensitive even
// though this disk may not be. Reads the disk and nothing else; validate()
// then works on the records alone.
export function loadManifests(root = ROOT) {
	const miscDir = join(root, 'misc');
	const thumbDir = join(root, 'assets', 'img', 'misc');
	const thumbNames = existsSync(thumbDir) ? readdirSync(thumbDir) : [];
	const records = [];
	for (const entry of readdirSync(miscDir, { withFileTypes: true })) {
		const m = entry.isDirectory() ? TOY_DIR_RE.exec(entry.name) : null;
		if (!m) continue;
		const dir = entry.name;
		const names = readdirSync(join(miscDir, dir));

		const thumbName = `${dir}.jpg`;
		const thumb = { file: `assets/img/misc/${thumbName}`, exists: thumbNames.includes(thumbName), near: '', width: 0, height: 0 };
		if (thumb.exists) {
			const size = jpegSize(readFileSync(join(thumbDir, thumbName)));
			if (size) Object.assign(thumb, size);
		} else {
			thumb.near = thumbNames.find((name) => name.toLowerCase() === thumbName.toLowerCase()) || '';
		}

		const record = {
			dir,
			num: Number(m[1]),
			file: `misc/${dir}/toy.json`,
			found: names.includes('toy.json'),
			toy: null,
			error: '',
			page: names.includes('index.html'),
			thumb,
		};
		if (record.found) {
			try {
				record.toy = readManifest(join(miscDir, dir, 'toy.json'));
			} catch (e) {
				record.error = e.message;
			}
		}
		records.push(record);
	}
	return records.sort((a, b) => a.num - b.num || (a.dir < b.dir ? -1 : 1));
}

// ---- validation ---------------------------------------------------------------

function show(value) {
	return value === undefined ? 'nothing' : JSON.stringify(value);
}

function isPlainObject(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// Every problem in the records from loadManifests(), as a list of sentences
// (empty when all is well). A folder with no toy.json at all is not a problem
// here: it has no card, the build says so, and scripts/test-cards.mjs insists.
export function validate(records) {
	const problems = [];
	const groupIds = GROUPS.map((g) => g.id);
	const filesByN = new Map();

	for (const record of records) {
		if (!record.found) continue;
		const say = (message) => problems.push(`${record.file}: ${message}`);
		const toy = record.toy;
		if (!toy) {
			say(record.error);
			continue;
		}

		if (!Number.isInteger(toy.n)) {
			say(`"n" must be the folder's number, ${record.num} (found ${show(toy.n)})`);
		} else {
			if (toy.n !== record.num) say(`"n" is ${toy.n} but the folder's number is ${record.num}`);
			filesByN.set(toy.n, (filesByN.get(toy.n) || []).concat(record.file));
		}
		if (toy.slug !== record.dir) say(`"slug" must be the folder's name, "${record.dir}" (found ${show(toy.slug)})`);
		if (!groupIds.includes(toy.group)) say(`"group" must be one of ${groupIds.join(', ')} (found ${show(toy.group)})`);
		if (toy.status !== 'live' && toy.status !== 'wip') say(`"status" must be "live" or "wip" (found ${show(toy.status)})`);

		for (const key of ['title', 'desc', 'note']) {
			const text = toy[key];
			if (key === 'note' && text === undefined) continue;
			if (typeof text !== 'string') say(`"${key}" must be a string (found ${show(text)})`);
			else if (key !== 'note' && !text.trim()) say(`"${key}" must not be empty`);
			else if (/[\r\n\t]/.test(text)) say(`"${key}" must be one line, with no line breaks or tabs`);
		}

		const surfaces = Array.isArray(toy.surfaces) ? toy.surfaces : null;
		if (!surfaces) {
			say(`"surfaces" must be an array holding ${SURFACES.map(show).join(', ')} or nothing (found ${show(toy.surfaces)})`);
		} else {
			for (const s of surfaces) {
				if (!SURFACES.includes(s)) say(`"surfaces" has an unknown entry ${show(s)} (known: ${SURFACES.join(', ')})`);
			}
			if (new Set(surfaces).size !== surfaces.length) say('"surfaces" lists the same surface twice');
		}

		if (toy.order !== undefined && toy.order !== null) {
			if (!isPlainObject(toy.order)) {
				say(`"order" must be an object such as { "grid": 3, "views": null } (found ${show(toy.order)})`);
			} else {
				for (const [s, value] of Object.entries(toy.order)) {
					if (!SURFACES.includes(s)) say(`"order" has an unknown surface ${show(s)} (known: ${SURFACES.join(', ')})`);
					else if (value !== null && !Number.isFinite(value)) say(`"order.${s}" must be a number or null (found ${show(value)})`);
				}
			}
		}

		if (toy.thumb !== undefined) {
			if (!isPlainObject(toy.thumb)) say(`"thumb" must be an object such as { "legacy": true } (found ${show(toy.thumb)})`);
			else if (toy.thumb.legacy !== undefined && typeof toy.thumb.legacy !== 'boolean') say('"thumb.legacy" must be true or false');
		}

		// tags become a grid card's data-tags and "added" decides the New badge;
		// all three also travel to misc/toys.json, so keep them in shape.
		if (toy.tags !== undefined && !(Array.isArray(toy.tags) && toy.tags.every((tag) => typeof tag === 'string'))) {
			say(`"tags" must be an array of strings (found ${show(toy.tags)})`);
		}
		if (toy.added !== undefined && !(typeof toy.added === 'string' && /^(\d{4}-\d{2}-\d{2})?$/.test(toy.added))) {
			say(`"added" must be a date written YYYY-MM-DD (found ${show(toy.added)})`);
		}
		if (toy.kit !== undefined && typeof toy.kit !== 'boolean') say(`"kit" must be true or false (found ${show(toy.kit)})`);

		// A live toy with a card needs something to link to and a picture to show.
		if (toy.status === 'live' && surfaces && surfaces.length) {
			if (!record.page) say(`misc/${record.dir}/index.html is missing, so the card would link to nothing`);
			const thumb = record.thumb;
			const legacy = isPlainObject(toy.thumb) && toy.thumb.legacy === true;
			const wanted = `${THUMB_WIDTH}x${THUMB_HEIGHT}`;
			if (!thumb.exists) {
				say(`the thumbnail ${thumb.file} is missing` + (thumb.near ? ` (found ${thumb.near}: the name must match exactly, case included)` : ''));
			} else if (!legacy) {
				if (!thumb.width) say(`cannot read the size of ${thumb.file}; it must be a ${wanted} JPEG`);
				else if (thumb.width !== THUMB_WIDTH || thumb.height !== THUMB_HEIGHT) {
					say(`${thumb.file} is ${thumb.width}x${thumb.height}; it must be exactly ${wanted}`);
				}
			}
		}
	}

	for (const [n, files] of filesByN) {
		if (files.length > 1) problems.push(`"n" ${n} is used by more than one toy: ${files.join(', ')}`);
	}
	return problems;
}

// ---- ordering and rendering -------------------------------------------------

// The toys that have a card on `surface` (live, and listing it in "surfaces"),
// in display order: those with no number in order[surface] first, highest n on
// top, then the numbered ones ascending (equal numbers: highest n first).
// Returns a new array of the same manifest objects.
export function sortFor(toys, surface) {
	const rank = (toy) => {
		const value = isPlainObject(toy.order) ? toy.order[surface] : null;
		return Number.isFinite(value) ? value : null;
	};
	return toys
		.filter((toy) => toy.status === 'live' && Array.isArray(toy.surfaces) && toy.surfaces.includes(surface))
		.sort((a, b) => {
			const ra = rank(a);
			const rb = rank(b);
			if (ra === null && rb === null) return b.n - a.n;
			if (ra === null) return -1;
			if (rb === null) return 1;
			return ra - rb || b.n - a.n;
		});
}

// The Misc grid, group by group: [{ id, name, toys }] in GROUPS order, each
// group's toys in the order sortFor() gives them. A group with no card on the
// grid is left out. Throws if a grid toy names a group that GROUPS does not
// have (validate() reports that first; this only stops a card from vanishing).
export function groupsFor(toys) {
	const grid = sortFor(toys, 'grid');
	const known = GROUPS.map((group) => group.id);
	const strays = grid.filter((toy) => !known.includes(toy.group));
	if (strays.length) throw new Error(`no such group: ${strays.map((toy) => `${toy.slug} has ${show(toy.group)}`).join(', ')}`);
	return GROUPS.map(({ id, name }) => ({ id, name, toys: grid.filter((toy) => toy.group === id) })).filter((group) => group.toys.length);
}

// The toys whose grid card wears the "New" badge, as a Set of their n. Among
// the toys that have a card on any surface, those sharing the newest "added"
// date are the latest wave; its grid cards are badged unless the wave is more
// than a third the size of the grid. Toys with no date are never new.
export function newestWave(toys) {
	const dated = toys.filter(
		(toy) => toy.status === 'live' && Array.isArray(toy.surfaces) && toy.surfaces.some((s) => SURFACES.includes(s)) && typeof toy.added === 'string' && toy.added
	);
	const newest = dated.reduce((latest, toy) => (toy.added > latest ? toy.added : latest), '');
	const wave = dated.filter((toy) => toy.added === newest);
	const gridSize = sortFor(toys, 'grid').length;
	if (!wave.length || wave.length * NEW_WAVE_SHARE > gridSize) return new Set();
	return new Set(wave.filter((toy) => toy.surfaces.includes('grid')).map((toy) => toy.n));
}

// A bare "&" is one that does not start an entity (&name; &#123; &#x1F;).
const BARE_AMP_RE = /&(?!(?:[A-Za-z][A-Za-z0-9]*|#[0-9]+|#[xX][0-9A-Fa-f]+);)/g;

// Card text is HTML text that may already hold entities: only a bare & and any
// < or > are escaped. Everything else, non-ASCII included, is left as written.
export function escapeText(text) {
	return String(text).replace(BARE_AMP_RE, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// The same text inside a double-quoted attribute: a " is escaped as well.
export function escapeAttr(text) {
	return escapeText(text).replace(/"/g, '&quot;');
}

// A manifest's tags as the value of data-tags: separated by one space, each
// trimmed, blank ones dropped, and any run of whitespace inside a tag made one space.
function tagList(toy) {
	const tags = Array.isArray(toy.tags) ? toy.tags : [];
	return tags
		.map((tag) => String(tag).replace(/\s+/g, ' ').trim())
		.filter(Boolean)
		.join(' ');
}

// One card, every line prefixed with `indent`, lines joined with "\n" and no
// trailing line break. A grid card carries data-n, data-group, data-tags and
// data-added (the last two only when the manifest has them) and, with
// { isNew: true }, the "New" badge on its thumbnail; a views card has neither.
export function renderCard(toy, surface, indent = '', { isNew = false } = {}) {
	const onGrid = surface === 'grid';
	let data = '';
	if (onGrid) {
		const tags = tagList(toy);
		if (Number.isInteger(toy.n)) data += ` data-n="${toy.n}"`;
		if (typeof toy.group === 'string' && toy.group) data += ` data-group="${escapeAttr(toy.group)}"`;
		if (tags) data += ` data-tags="${escapeAttr(tags)}"`;
		if (typeof toy.added === 'string' && toy.added) data += ` data-added="${escapeAttr(toy.added)}"`;
	}
	// In the thumbnail, never in the title: the palette uses the title's text as the toy's name.
	const badge = onGrid && isNew ? '<span class="misc-new">New</span>' : '';
	const lines = [
		`<a class="misc-card" href="misc/${toy.slug}/" target="_blank" rel="noopener"${data}>`,
		`\t<div class="misc-thumb"><img src="assets/img/misc/${toy.slug}.jpg" alt="" loading="lazy">${badge}</div>`,
		'\t<div class="misc-body">',
		`\t\t<div class="misc-title">${escapeText(toy.title)}</div>`,
		`\t\t<p class="misc-desc">${escapeText(toy.desc)}</p>`,
	];
	if (toy.note && NOTE_SURFACES.includes(surface)) lines.push(`\t\t<p class="misc-note">${escapeText(toy.note)}</p>`);
	lines.push('\t</div>', '</a>');
	return lines.map((line) => indent + line).join('\n');
}

// A group's heading in the grid: its name and how many cards follow it.
function renderHeading(group, indent) {
	return `${indent}<h3 class="misc-group-h" id="misc-g-${group.id}" data-group="${group.id}">${escapeText(group.name)} <span class="misc-group-n">${group.toys.length}</span></h3>`;
}

// Everything between a surface's markers, in the same shape as renderCard().
// The views strip is its cards in sortFor() order; the grid is each group of
// groupsFor() as a heading followed by its cards. An empty string when the
// surface has no cards.
export function renderBlock(toys, surface, indent = '') {
	if (surface !== 'grid') {
		return sortFor(toys, surface)
			.map((toy) => renderCard(toy, surface, indent))
			.join('\n');
	}
	const fresh = newestWave(toys);
	const parts = [];
	for (const group of groupsFor(toys)) {
		parts.push(renderHeading(group, indent));
		for (const toy of group.toys) parts.push(renderCard(toy, surface, indent, { isNew: fresh.has(toy.n) }));
	}
	return parts.join('\n');
}

// "42 toys", "1 toy": what the toolbar's count says while nothing is filtered.
function countText(count) {
	return `${count} ${count === 1 ? 'toy' : 'toys'}`;
}

// The Misc tab's toolbar, in the same shape as renderCard(): the filter box
// with the count beside it, an "All" chip and one chip per group of groupsFor()
// with its count, the Random button, the Cards / Compact switch, and the line
// shown when nothing matches. It is written with the hidden attribute, which
// assets/js/misc.js removes: without JavaScript the grouped grid shows alone.
// The order of the controls is the order Tab visits them. An empty string when
// the grid has no cards.
export function renderTools(toys, indent = '') {
	const groups = groupsFor(toys);
	const total = groups.reduce((sum, group) => sum + group.toys.length, 0);
	if (!total) return '';
	const chip = (id, name, count, pressed) =>
		`\t\t\t<button type="button" class="misc-chip" data-group="${id}" aria-pressed="${pressed}">${escapeText(name)} <span class="misc-chip-n">${count}</span></button>`;
	const lines = [
		'<div class="misc-tools" hidden>',
		'\t<div class="misc-search">',
		'\t\t<i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>',
		`\t\t<input type="search" class="misc-filter" id="misc-filter" placeholder="${FILTER_LABEL}" aria-label="${FILTER_LABEL}" autocomplete="off" spellcheck="false" enterkeyhint="search">`,
		`\t\t<span class="misc-count" aria-live="polite" aria-atomic="true">${countText(total)}</span>`,
		'\t</div>',
		'\t<div class="misc-bar">',
		'\t\t<div class="misc-chips" role="group" aria-label="Groups">',
		chip('', 'All', total, true),
		...groups.map((group) => chip(group.id, group.name, group.toys.length, false)),
		'\t\t</div>',
		'\t\t<div class="misc-actions">',
		'\t\t\t<button type="button" class="misc-chip misc-random" title="Open one of the toys showing, picked at random"><i class="fa-solid fa-dice" aria-hidden="true"></i> Random</button>',
		'\t\t\t<div class="misc-seg" role="group" aria-label="View">',
		'\t\t\t\t<button type="button" class="misc-seg-btn" data-density="cards" aria-pressed="true"><i class="fa-solid fa-table-cells-large" aria-hidden="true"></i> Cards</button>',
		'\t\t\t\t<button type="button" class="misc-seg-btn" data-density="compact" aria-pressed="false"><i class="fa-solid fa-table-cells" aria-hidden="true"></i> Compact</button>',
		'\t\t\t</div>',
		'\t\t</div>',
		'\t</div>',
		'\t<p class="misc-empty" hidden>Nothing matches. <button type="button" class="misc-clear">Clear the filter</button></p>',
		'</div>',
	];
	return lines.map((line) => indent + line).join('\n');
}

// What goes between the markers of one region of REGIONS.
function renderRegion(toys, region, indent) {
	return region === 'tools' ? renderTools(toys, indent) : renderBlock(toys, region, indent);
}

// ---- index.html ---------------------------------------------------------------

// The line ending a text uses: CRLF when most of its line breaks are, else LF.
function detectEol(text) {
	const crlf = text.split('\r\n').length - 1;
	const lf = text.split('\n').length - 1 - crlf;
	return crlf > lf ? '\r\n' : '\n';
}

// Where a region's markup lives: between the line of its begin marker and the
// line of its end marker. Each marker must appear exactly once, as a comment
// on a line of its own. The markup takes the begin marker's indentation.
function findRegion(html, name) {
	const found = {};
	for (const edge of ['begin', 'end']) {
		const token = `toys:${name}:${edge}`;
		const mentions = html.split(token).length - 1;
		if (mentions !== 1) throw new Error(`index.html must mention "${token}" exactly once (found ${mentions})`);
		found[edge] = new RegExp(`^([ \\t]*)<!-- ${token}(?: [^\\r\\n]*)? -->[ \\t]*$`, 'm').exec(html);
		if (!found[edge]) throw new Error(`index.html: "<!-- ${token} -->" must be a comment on a line of its own`);
	}
	const lineBreak = html.indexOf('\n', found.begin.index);
	if (lineBreak === -1 || lineBreak >= found.end.index) {
		throw new Error(`index.html: toys:${name}:begin must sit on a line above toys:${name}:end`);
	}
	return { name, indent: found.begin[1], open: found.begin.index, start: lineBreak + 1, end: found.end.index };
}

const HINT_RE = /(<span class="bs-views-hint">)\d+( views)/g;

// index.html's text with the grid, the toolbar, the views strip and the views
// count rebuilt from the manifests. `html` is the file as read (BOM and line
// endings included); the markers themselves and everything outside them come
// back untouched.
export function applyToIndex(html, toys) {
	const eol = detectEol(html);
	const regions = REGIONS.map((name) => findRegion(html, name)).sort((a, b) => a.start - b.start);
	for (let i = 1; i < regions.length; i++) {
		if (regions[i].open < regions[i - 1].end) {
			throw new Error(`index.html: the toys:${regions[i - 1].name} and toys:${regions[i].name} blocks overlap`);
		}
	}

	// Splice from the bottom of the file up, so the offsets above stay true.
	let out = html;
	for (const region of regions.reverse()) {
		const block = renderRegion(toys, region.name, region.indent);
		const text = block ? block.split('\n').join(eol) + eol : '';
		out = out.slice(0, region.start) + text + out.slice(region.end);
	}

	const hints = out.match(HINT_RE) || [];
	if (hints.length !== 1) throw new Error(`index.html must hold exactly one '<span class="bs-views-hint">N views' (found ${hints.length})`);
	const views = sortFor(toys, 'views').length;
	return out.replace(HINT_RE, (match, before, after) => before + views + after);
}

// ---- misc/toys.json -----------------------------------------------------------

// The text of misc/toys.json: the groups in display order, then every
// manifest (wip ones too) sorted by n, each with its computed "href" and
// "thumbnail". LF, tab-indented, one trailing line break, no timestamps.
export function renderToysJson(toys) {
	const data = {
		groups: GROUPS.map(({ id, name }) => ({ id, name })),
		toys: [...toys]
			.sort((a, b) => a.n - b.n)
			.map((toy) => ({ ...toy, href: `misc/${toy.slug}/`, thumbnail: `assets/img/misc/${toy.slug}.jpg` })),
	};
	return JSON.stringify(data, null, '\t') + '\n';
}

// ---- the build ----------------------------------------------------------------

// 1-based number of the first line on which two files differ.
function firstDifferentLine(a, b) {
	const x = a.toString('utf8').split('\n');
	const y = b.toString('utf8').split('\n');
	let i = 0;
	while (i < x.length && i < y.length && x[i] === y[i]) i++;
	return i + 1;
}

function build(root, check) {
	const records = loadManifests(root);
	const problems = validate(records);
	if (problems.length) {
		console.error(`${problems.length} problem${problems.length === 1 ? '' : 's'} in the toy manifests; nothing was written:`);
		for (const problem of problems) console.error(`  ${problem}`);
		return 1;
	}
	for (const record of records) {
		if (!record.found) console.log(`note: misc/${record.dir}/ has no toy.json, so it has no card`);
	}

	const toys = records.filter((record) => record.toy).map((record) => record.toy);
	const wip = toys.filter((toy) => toy.status === 'wip');
	if (wip.length) console.log(`wip, no card: ${wip.map((toy) => toy.slug).join(', ')}`);
	const hidden = toys.filter((toy) => toy.status === 'live' && !toy.surfaces.length);
	if (hidden.length) console.log(`no surfaces, no card: ${hidden.map((toy) => toy.slug).join(', ')}`);

	const indexPath = join(root, 'index.html');
	const indexOld = readFileSync(indexPath);
	const indexText = indexOld.toString('utf8');
	if (!Buffer.from(indexText, 'utf8').equals(indexOld)) throw new Error('index.html is not valid UTF-8; refusing to rewrite it');
	const indexNew = Buffer.from(applyToIndex(indexText, toys), 'utf8');

	const toysPath = join(root, 'misc', 'toys.json');
	const toysOld = existsSync(toysPath) ? readFileSync(toysPath) : null;
	let toysText = renderToysJson(toys);
	if (toysOld && detectEol(toysOld.toString('utf8')) === '\r\n') toysText = toysText.split('\n').join('\r\n');
	const toysNew = Buffer.from(toysText, 'utf8');

	const outputs = [
		{ name: 'index.html', path: indexPath, old: indexOld, next: indexNew },
		{ name: 'misc/toys.json', path: toysPath, old: toysOld, next: toysNew },
	];
	let stale = 0;
	const states = outputs.map(({ name, path, old, next }) => {
		if (old && old.equals(next)) return `${name} unchanged`;
		stale += 1;
		if (check) return `${name} would change` + (old ? ` (from line ${firstDifferentLine(old, next)})` : ' (it does not exist yet)');
		// Someone else may be editing the same tree: never write over a file that moved underfoot.
		if (old && !readFileSync(path).equals(old)) throw new Error(`${name} changed while this was running; run it again`);
		writeFileSync(path, next);
		return `${name} ${old ? 'updated' : 'written'}`;
	});

	const groups = groupsFor(toys);
	const gridCards = groups.reduce((sum, group) => sum + group.toys.length, 0);
	const perGroup = groups.length ? ` (${groups.map((group) => `${group.id} ${group.toys.length}`).join(', ')})` : '';
	const badges = newestWave(toys).size;
	const cards = [
		`${gridCards} grid cards in ${groups.length} ${groups.length === 1 ? 'group' : 'groups'}${perGroup}`,
		`${badges || 'no'} New ${badges === 1 ? 'badge' : 'badges'}`,
		`${sortFor(toys, 'views').length} views cards`,
	].join(', ');
	console.log(`${toys.length} toys: ${cards}, ${wip.length} wip skipped. ${states.join(', ')}.`);
	return check && stale ? 1 : 0;
}

function main(args) {
	const unknown = args.filter((arg) => arg !== '--check');
	if (unknown.length) {
		console.error(`Unknown argument: ${unknown.join(' ')}`);
		console.error('Usage: node scripts/build-cards.mjs [--check]');
		return 1;
	}
	return build(ROOT, args.includes('--check'));
}

// True when this file is the script being run, not an import. Paths are
// compared through realpath and, on Windows, without regard to case (a shell
// may spell the drive letter either way).
function isMain() {
	if (!process.argv[1]) return false;
	const fold = (path) => (process.platform === 'win32' ? path.toLowerCase() : path);
	try {
		return fold(realpathSync(resolve(process.argv[1]))) === fold(realpathSync(fileURLToPath(import.meta.url)));
	} catch (e) {
		return false;
	}
}

if (isMain()) {
	try {
		process.exitCode = main(process.argv.slice(2));
	} catch (e) {
		console.error(`build-cards: ${e.message}`);
		process.exitCode = 1;
	}
}
