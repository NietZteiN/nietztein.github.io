// Proves the toy cards lose nothing on their way from the manifests into
// index.html. Against a base commit: the Bookshelf views strip is the same
// bytes, and every card of the Misc grid is still there once, with the same
// link, picture and text, now sitting under its group's heading. It also checks
// that the grid, its headings, the toolbar's chips and the manifests agree.
//
// Zero dependencies (it needs git on PATH). Run with:
//   node scripts/test-cards.mjs                  the cards must be exactly those of HEAD
//   node scripts/test-cards.mjs --base <commit>  compare with another commit's index.html
//                                                (6f15b85 is the last one with hand-written
//                                                cards, in one flat list)
//   node scripts/test-cards.mjs --allow-new      extra cards are fine; every card of the
//                                                base must still be there and unchanged
// Exit code 0 when every check passes, 1 when one fails.
//
// What it checks:
//   1. every toy folder (misc/<NN-slug>/) has a toy.json, the manifests are valid,
//      and misc/toys.json lists exactly those folders, each of which exists;
//   2. the views strip: the sequence of (position, href, img src, title, desc)
//      read from the base commit's index.html is the sequence read from the
//      working tree's, the cards' markup is the same bytes (line endings aside),
//      and so is the strip's own title line (the count in it aside, with --allow-new);
//   3. the Misc grid against the base: every card of the base is there exactly
//      once with the same href, img src, title, desc and note; its markup is the
//      same bytes once the new data attributes and the New badge are taken out;
//      and inside each group the cards of the base keep their relative order;
//   4. the Misc grid against the manifests: each group that has a card has its
//      heading, in GROUPS order, with the right count; every card sits under its
//      own group's heading and carries its manifest's n, group, tags and date;
//      the New badge is on the latest wave and nowhere else;
//   5. the toolbar: written hidden, directly above the grid, with the filter
//      box, the count, one chip per heading whose number is that group's card
//      count, an All chip with the total, Random and the Cards / Compact switch,
//      in the order Tab visits them; and index.html loads assets/js/misc.js;
//   6. the "N views" hint counts the views cards;
//   7. everything generated comes from the manifests: emptying the three blocks
//      and rebuilding them gives the file back, and rebuilding again changes nothing;
//   8. "build-cards.mjs --check" exits 0, and running the generator twice writes
//      nothing (same bytes, same modification times);
//   9. the rules today's cards never exercise: escaping, new toys on top of
//      their group, empty groups left out, notes in the grid only, tags, which
//      wave is "New", and that validation does catch a bad manifest.
//
// Checks 2 to 5 read the page with their own small parser, not with
// build-cards.mjs, so they test what is in the file and not how it got there.
// Comparing with HEAD is right for as long as the cards are meant to stay as
// committed. While toys are being added and not yet committed, pass --allow-new;
// when the layout is changed on purpose, this is the test to update.

import { readFileSync, existsSync, statSync, realpathSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import {
	GROUPS,
	loadManifests,
	validate,
	sortFor,
	groupsFor,
	newestWave,
	renderCard,
	renderBlock,
	renderTools,
	applyToIndex,
	escapeText,
	escapeAttr,
} from './build-cards.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const root = join(scriptDir, '..');
const buildScript = join(scriptDir, 'build-cards.mjs');

// The elements that hold the generated markup, as written in index.html.
const GRID_OPEN = '<div class="misc-grid">';
const VIEWS_OPEN = '<div class="bs-views-row">';
const STRIP_OPEN = '<div class="bs-views" id="bs-views">';
const MISC_SCRIPT = '<script src="assets/js/misc.js"></script>';
const FIELDS = ['href', 'img', 'title', 'desc', 'note'];

// ---- a small test harness -----------------------------------------------------

let passed = 0;
let failed = 0;

// Runs one check. `fn` throws to fail; what it returns is shown after the name.
function check(name, fn) {
	try {
		const detail = fn();
		passed += 1;
		console.log(`ok    ${name}${detail ? ` (${detail})` : ''}`);
		return true;
	} catch (e) {
		failed += 1;
		console.log(`FAIL  ${name}`);
		for (const line of String(e.message).split('\n')) console.log(`        ${line}`);
		return false;
	}
}

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

function assertEqual(actual, expected, what) {
	if (actual !== expected) throw new Error(`${what}\n  expected: ${JSON.stringify(expected)}\n  found:    ${JSON.stringify(actual)}`);
}

// The same for two long texts: says where they first differ and shows that
// spot, not the whole of both.
function assertSameText(actual, expected, what) {
	if (actual === expected) return;
	let at = 0;
	while (at < actual.length && at < expected.length && actual[at] === expected[at]) at++;
	const line = expected.slice(0, at).split('\n').length;
	const around = (text) => JSON.stringify(text.slice(Math.max(0, at - 40), at + 80));
	throw new Error(`${what}: the first difference is at character ${at}, line ${line}\n  expected: ${around(expected)}\n  found:    ${around(actual)}`);
}

// Fails with every problem in the list (the first dozen spelled out).
function assertNone(problems) {
	assert(!problems.length, problems.slice(0, 12).join('\n') + (problems.length > 12 ? `\n... and ${problems.length - 12} more` : ''));
}

// ---- reading cards out of a page ----------------------------------------------

// The byte-order mark, built from its code so that no invisible character has
// to sit in this source.
const BOM = String.fromCharCode(0xfeff);

// A page's text without a byte-order mark and with LF line endings.
function normalise(text) {
	return (text.startsWith(BOM) ? text.slice(1) : text).replace(/\r\n/g, '\n');
}

// The text inside the one element opened by `openTag`, found by counting nested divs.
function innerOf(html, openTag) {
	const count = html.split(openTag).length - 1;
	assert(count === 1, `the page must hold ${openTag} exactly once (found ${count})`);
	const start = html.indexOf(openTag) + openTag.length;
	const tags = /<div\b|<\/div>/g;
	tags.lastIndex = start;
	let depth = 1;
	let m;
	while ((m = tags.exec(html))) {
		depth += m[0] === '</div>' ? -1 : 1;
		if (depth === 0) return html.slice(start, m.index);
	}
	throw new Error(`${openTag} is never closed`);
}

const MARKER_LINE_RE = /^[ \t]*<!-- toys:(?:grid|views|tools):(?:begin|end)(?: [^\n]*)? -->[ \t]*\n/gm;
const CARD_RE = /[ \t]*<a class="misc-card"([^>]*)>([\s\S]*?)<\/a>/g;
// A grid block is a run of headings and cards.
const GRID_ITEM_RE = /[ \t]*<h3 class="misc-group-h"([^>]*)>([\s\S]*?)<\/h3>|[ \t]*<a class="misc-card"([^>]*)>([\s\S]*?)<\/a>/g;
const DATA_ATTR_RE = / data-(?:n|group|tags|added)="[^"]*"/g;
const BADGE = '<span class="misc-new">New</span>';

function pick(re, text) {
	const m = re.exec(text);
	return m ? m[1] : null;
}

// One card: `attrs` is the text after class="misc-card" in its opening tag,
// `body` what the <a> holds, `raw` the whole card from the start of its line.
function readCard(surface, position, attrs, body, raw, label) {
	const card = {
		surface,
		position,
		href: pick(/\bhref="([^"]*)"/, attrs),
		img: pick(/<img\b[^>]*\bsrc="([^"]*)"/, body),
		title: pick(/<div class="misc-title">([\s\S]*?)<\/div>/, body),
		desc: pick(/<p class="misc-desc">([\s\S]*?)<\/p>/, body),
		note: pick(/<p class="misc-note">([\s\S]*?)<\/p>/, body) ?? '',
		data: {
			n: pick(/\bdata-n="([^"]*)"/, attrs),
			group: pick(/\bdata-group="([^"]*)"/, attrs),
			tags: pick(/\bdata-tags="([^"]*)"/, attrs),
			added: pick(/\bdata-added="([^"]*)"/, attrs),
		},
		badge: body.includes(BADGE),
		attrs,
		body,
		raw,
	};
	for (const field of FIELDS) {
		assert(typeof card[field] === 'string', `${label}: ${surface} card ${position} has no ${field}`);
	}
	return card;
}

// The views strip of a page: `inner` is the block's text without the marker
// lines, `cards` its cards in order, each { surface, position, href, img,
// title, desc, note, raw, ... }.
function readViews(html, label) {
	const inner = innerOf(html, VIEWS_OPEN).replace(MARKER_LINE_RE, '');
	const cards = [];
	for (const m of inner.matchAll(CARD_RE)) cards.push(readCard('views', cards.length, m[1], m[2], m[0], label));
	const leftover = inner.replace(CARD_RE, '').trim();
	assert(!leftover, `${label}: the views block holds something besides cards: ${JSON.stringify(leftover.slice(0, 120))}`);
	return { inner, cards };
}

// A grid block (the text between the grid markers): `cards` in order, each
// with `under`, the data-group of the heading above it ('' when there is
// none, as in a page from before the groups); `headings` in order, each
// { id, group, name, count, cards }.
function parseGrid(inner, label) {
	const cards = [];
	const headings = [];
	for (const m of inner.matchAll(GRID_ITEM_RE)) {
		if (m[1] !== undefined) {
			const text = /^([\s\S]*?) <span class="misc-group-n">(\d+)<\/span>$/.exec(m[2]);
			assert(text, `${label}: a group heading is not "Name <span class="misc-group-n">N</span>": ${JSON.stringify(m[2].slice(0, 120))}`);
			headings.push({
				id: pick(/\bid="([^"]*)"/, m[1]),
				group: pick(/\bdata-group="([^"]*)"/, m[1]),
				name: text[1],
				count: Number(text[2]),
				cards: [],
			});
		} else {
			const card = readCard('grid', cards.length, m[3], m[4], m[0], label);
			const heading = headings[headings.length - 1];
			card.under = heading ? heading.group : '';
			if (heading) heading.cards.push(card);
			cards.push(card);
		}
	}
	const leftover = inner.replace(GRID_ITEM_RE, '').trim();
	assert(!leftover, `${label}: the grid block holds something besides headings and cards: ${JSON.stringify(leftover.slice(0, 120))}`);
	return { inner, cards, headings };
}

function readGrid(html, label) {
	return parseGrid(innerOf(html, GRID_OPEN).replace(MARKER_LINE_RE, ''), label);
}

// The views strip's own lines: what its element holds above the row of cards.
function readStripHead(html) {
	const inner = innerOf(html, STRIP_OPEN);
	const row = inner.indexOf(VIEWS_OPEN);
	assert(row !== -1, `${STRIP_OPEN} does not hold ${VIEWS_OPEN}`);
	return inner.slice(0, row);
}

// The toolbar: `text` is what sits between the tools markers, `gap` what sits
// between the end marker and the grid's opening tag.
function readTools(html) {
	const begin = /^[ \t]*<!-- toys:tools:begin(?: [^\n]*)? -->[ \t]*\n/m.exec(html);
	const end = /^[ \t]*<!-- toys:tools:end -->[ \t]*\n/m.exec(html);
	assert(begin && end && begin.index < end.index, 'the page has no "toys:tools:begin" ... "toys:tools:end" pair of marker lines');
	const after = end.index + end[0].length;
	const grid = html.indexOf(GRID_OPEN, after);
	assert(grid !== -1, `${GRID_OPEN} does not come after the tools markers`);
	return { text: html.slice(begin.index + begin[0].length, end.index), gap: html.slice(after, grid) };
}

// A card's markup as it was before the grid knew about groups: without the
// data attributes of its opening tag and without the New badge.
function plainMarkup(card) {
	const open = card.raw.indexOf('>');
	return card.raw.slice(0, open).replace(DATA_ATTR_RE, '') + card.raw.slice(open).replace(BADGE, '');
}

function sameFields(a, b) {
	return FIELDS.every((field) => a[field] === b[field]);
}

function describe(card) {
	return `${card.surface} position ${card.position} (${card.href})`;
}

// Pairs each card of `base` with a card of `work`, in order, skipping cards of
// `work` that match none. Returns the pairs, the cards of `work` left over, and
// the first card of `base` that found no partner (or null).
function pairInOrder(base, work, same) {
	const pairs = [];
	const extra = [];
	let j = 0;
	for (const card of base) {
		while (j < work.length && !same(card, work[j])) extra.push(work[j++]);
		if (j === work.length) return { pairs, extra, lost: card };
		pairs.push([card, work[j++]]);
	}
	return { pairs, extra: extra.concat(work.slice(j)), lost: null };
}

// The toys with a card on the grid, straight from the manifests (not through
// sortFor or groupsFor, which are what is being tested).
function gridToys(toys) {
	return toys.filter((toy) => toy.status === 'live' && Array.isArray(toy.surfaces) && toy.surfaces.includes('grid'));
}

// ---- the checks ---------------------------------------------------------------

function main(args) {
	let base = 'HEAD';
	let allowNew = false;
	for (let i = 0; i < args.length; i++) {
		if (args[i] === '--base' && args[i + 1]) base = args[++i];
		else if (args[i] === '--allow-new') allowNew = true;
		else {
			console.error(`Unknown argument: ${args[i]}`);
			console.error('Usage: node scripts/test-cards.mjs [--base <commit>] [--allow-new]');
			return 1;
		}
	}

	const records = loadManifests(root);
	const toys = records.filter((record) => record.toy).map((record) => record.toy);
	const indexPath = join(root, 'index.html');
	const toysPath = join(root, 'misc', 'toys.json');
	const notRun = () => assert(false, 'not run: the pages could not be read');

	// 1. Folders and manifests.
	check('every toy folder has a toy.json', () => {
		const without = records.filter((record) => !record.found).map((record) => `misc/${record.dir}/`);
		assert(!without.length, `no toy.json in: ${without.join(', ')}`);
		return `${records.length} folders`;
	});

	check('the manifests are valid', () => {
		const problems = validate(records);
		assert(!problems.length, problems.join('\n'));
		const perGroup = GROUPS.map((group) => `${group.id} ${toys.filter((toy) => toy.group === group.id).length}`);
		return perGroup.join(', ');
	});

	check('misc/toys.json lists every toy folder, and every toy it lists has its folder', () => {
		assert(existsSync(toysPath), 'misc/toys.json does not exist; run node scripts/build-cards.mjs');
		const listed = JSON.parse(readFileSync(toysPath, 'utf8')).toys.map((toy) => toy.slug);
		const folders = records.filter((record) => record.found).map((record) => record.dir);
		const gone = listed.filter((slug) => !existsSync(join(root, 'misc', slug)) || !statSync(join(root, 'misc', slug)).isDirectory());
		assert(!gone.length, `listed in misc/toys.json but the folder is gone: ${gone.join(', ')}`);
		const unlisted = folders.filter((dir) => !listed.includes(dir));
		assert(!unlisted.length, `a folder with a toy.json is not in misc/toys.json: ${unlisted.join(', ')}`);
		const strangers = listed.filter((slug) => !folders.includes(slug));
		assert(!strangers.length, `listed in misc/toys.json without a toy.json of its own: ${strangers.join(', ')}`);
		assertEqual(new Set(listed).size, listed.length, 'misc/toys.json lists a toy twice');
		return `${listed.length} toys`;
	});

	// The base commit's page and the working tree's, read with the parser above.
	let before = null;
	let after = null;
	const loaded = check(`index.html of ${base} and of the working tree can be read`, () => {
		const baseHtml = normalise(execFileSync('git', ['show', `${base}:index.html`], { cwd: root, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }).toString('utf8'));
		const workHtml = normalise(readFileSync(indexPath, 'utf8'));
		before = { views: readViews(baseHtml, base), grid: readGrid(baseHtml, base), stripHead: readStripHead(baseHtml) };
		after = { views: readViews(workHtml, 'working tree'), grid: readGrid(workHtml, 'working tree'), stripHead: readStripHead(workHtml), html: workHtml };
		return ['views', 'grid'].map((surface) => `${surface}: ${before[surface].cards.length} cards in ${base}, ${after[surface].cards.length} now`).join('; ');
	});

	// 2. The views strip against the base commit.
	check(allowNew ? `views: every card of ${base} is still there, same fields, same order` : `views: the cards are those of ${base}, field for field, in the same order`, () => {
		if (!loaded) notRun();
		const was = before.views;
		const now = after.views;
		if (allowNew) {
			const { extra, lost } = pairInOrder(was.cards, now.cards, sameFields);
			assert(!lost, lost ? `the card at ${describe(lost)} of ${base} is gone, changed or out of order` : '');
			return extra.length ? `${was.cards.length} kept, ${extra.length} new: ${extra.map((card) => card.href).join(' ')}` : `${was.cards.length} cards, none new`;
		}
		const differences = [];
		for (let i = 0; i < Math.max(was.cards.length, now.cards.length); i++) {
			const a = was.cards[i];
			const b = now.cards[i];
			if (!a) differences.push(`position ${i}: ${b.href} is new (not in ${base})`);
			else if (!b) differences.push(`position ${i}: ${a.href} is missing`);
			else {
				for (const field of FIELDS) {
					if (a[field] !== b[field]) differences.push(`position ${i}: ${field} differs\n  ${base}: ${JSON.stringify(a[field])}\n  now:  ${JSON.stringify(b[field])}`);
				}
			}
		}
		assertNone(differences);
		return `${now.cards.length} cards`;
	});

	check(allowNew ? `views: those cards' markup is byte-identical to ${base}` : `views: the block's markup is byte-identical to ${base}`, () => {
		if (!loaded) notRun();
		const was = before.views;
		const now = after.views;
		if (allowNew) {
			const { pairs, lost } = pairInOrder(was.cards, now.cards, sameFields);
			assert(!lost, 'not run: a card is gone, changed or out of order');
			for (const [a, b] of pairs) assertSameText(b.raw, a.raw, `the markup of ${describe(a)} changed`);
			return `${pairs.length} cards`;
		}
		assertSameText(now.inner, was.inner, `the views block is not the same text as in ${base}`);
		return `${Buffer.byteLength(now.inner)} bytes`;
	});

	check(`views: the strip's title and hint are byte-identical to ${base}` + (allowNew ? ', the count aside' : ''), () => {
		if (!loaded) notRun();
		const text = (head) => (allowNew ? head.replace(/(<span class="bs-views-hint">)\d+( views)/, '$1N$2') : head);
		assertSameText(text(after.stripHead), text(before.stripHead), `the lines above the views cards are not the same text as in ${base}`);
		return `${Buffer.byteLength(after.stripHead)} bytes`;
	});

	// 3. The Misc grid against the base commit.
	check(
		allowNew
			? `grid: every card of ${base} is there exactly once, with the same link, picture, title, description and note`
			: `grid: the cards are those of ${base}, each exactly once, with the same link, picture, title, description and note`,
		() => {
			if (!loaded) notRun();
			const was = before.grid.cards;
			const now = after.grid.cards;
			const problems = [];
			const count = (cards, href) => cards.filter((card) => card.href === href).length;
			for (const href of new Set(was.map((card) => card.href))) {
				if (count(was, href) > 1) problems.push(`${base} itself holds ${href} ${count(was, href)} times`);
			}
			for (const href of new Set(now.map((card) => card.href))) {
				if (count(now, href) > 1) problems.push(`${href} is on the grid ${count(now, href)} times`);
			}
			for (const card of was) {
				const twin = now.find((other) => other.href === card.href);
				if (!twin) {
					problems.push(`${card.href} is gone`);
					continue;
				}
				for (const field of FIELDS) {
					if (twin[field] !== card[field]) problems.push(`${card.href}: ${field} differs\n  ${base}: ${JSON.stringify(card[field])}\n  now:  ${JSON.stringify(twin[field])}`);
				}
			}
			const extra = now.filter((card) => !was.some((other) => other.href === card.href));
			if (!allowNew) for (const card of extra) problems.push(`${card.href} is new (not in ${base})`);
			assertNone(problems);
			return extra.length ? `${was.length} kept, ${extra.length} new: ${extra.map((card) => card.href).join(' ')}` : `${was.length} cards, none new`;
		}
	);

	check(`grid: apart from the data attributes and the New badge, those cards' markup is byte-identical to ${base}`, () => {
		if (!loaded) notRun();
		let compared = 0;
		for (const card of before.grid.cards) {
			const twin = after.grid.cards.find((other) => other.href === card.href);
			assert(twin, `not run: ${card.href} is gone`);
			assertSameText(plainMarkup(twin), plainMarkup(card), `the markup of ${card.href} changed`);
			compared += 1;
		}
		return `${compared} cards`;
	});

	check(`grid: inside each group the cards of ${base} keep their relative order`, () => {
		if (!loaded) notRun();
		const place = new Map(before.grid.cards.map((card) => [card.href, card.position]));
		const problems = [];
		for (const heading of after.grid.headings) {
			const kept = heading.cards.filter((card) => place.has(card.href));
			for (let i = 1; i < kept.length; i++) {
				if (place.get(kept[i - 1].href) > place.get(kept[i].href)) {
					problems.push(`under "${heading.name}", ${kept[i - 1].href} now comes before ${kept[i].href}; in ${base} it came after`);
				}
			}
		}
		assertNone(problems);
		return after.grid.headings.map((heading) => `${heading.group} ${heading.cards.filter((card) => place.has(card.href)).length}`).join(', ');
	});

	// 4. The Misc grid against the manifests.
	const expectedGroups = GROUPS.map((group) => ({ ...group, toys: gridToys(toys).filter((toy) => toy.group === group.id) })).filter((group) => group.toys.length);

	check('grid: each group that has a card has its heading, in GROUPS order, with the right count', () => {
		if (!loaded) notRun();
		const { headings, cards } = after.grid;
		assertEqual(headings.map((heading) => heading.group).join(' '), expectedGroups.map((group) => group.id).join(' '), 'the headings, top to bottom');
		const loose = cards.filter((card) => !card.under);
		assert(!loose.length, `cards above the first heading: ${loose.map((card) => card.href).join(' ')}`);
		headings.forEach((heading, i) => {
			const group = expectedGroups[i];
			assertEqual(heading.id, `misc-g-${group.id}`, `the id of the "${group.name}" heading`);
			assertEqual(heading.name, escapeText(group.name), `the text of the ${group.id} heading`);
			assertEqual(heading.cards.length, group.toys.length, `cards under "${group.name}" (the manifests have ${group.toys.length} on the grid)`);
			assertEqual(heading.count, heading.cards.length, `the number in the "${group.name}" heading`);
		});
		const order = headings.map((heading) => GROUPS.findIndex((group) => group.id === heading.group));
		assert(order.every((at, i) => at !== -1 && (i === 0 || at > order[i - 1])), 'the headings are not in GROUPS order');
		return headings.map((heading) => `${heading.group} ${heading.count}`).join(', ');
	});

	check("grid: every card sits under its own group's heading and carries its manifest's n, group, tags and date", () => {
		if (!loaded) notRun();
		const problems = [];
		const expected = new Map(gridToys(toys).map((toy) => [`misc/${toy.slug}/`, toy]));
		for (const card of after.grid.cards) {
			const toy = expected.get(card.href);
			if (!toy) {
				problems.push(`${card.href} has a card but no live manifest that lists the grid`);
				continue;
			}
			const tags = (toy.tags || []).map((tag) => tag.replace(/\s+/g, ' ').trim()).filter(Boolean).join(' ');
			const want = { n: String(toy.n), group: toy.group, tags: tags ? escapeAttr(tags) : null, added: toy.added || null };
			for (const key of Object.keys(want)) {
				if (card.data[key] !== want[key]) problems.push(`${card.href}: data-${key} is ${JSON.stringify(card.data[key])}, the manifest says ${JSON.stringify(want[key])}`);
			}
			if (card.under !== toy.group) problems.push(`${card.href} sits under the "${card.under}" heading; its group is "${toy.group}"`);
			assertEqual(card.attrs.replace(DATA_ATTR_RE, ''), ` href="${card.href}" target="_blank" rel="noopener"`, `the opening tag of ${card.href}, data attributes aside`);
		}
		for (const href of expected.keys()) {
			if (!after.grid.cards.some((card) => card.href === href)) problems.push(`${href} should have a card on the grid and has none`);
		}
		assertNone(problems);
		return `${after.grid.cards.length} cards`;
	});

	check('grid: the New badge is on the latest wave of toys and nowhere else', () => {
		if (!loaded) notRun();
		const fresh = newestWave(toys);
		const problems = [];
		for (const card of after.grid.cards) {
			const isNew = fresh.has(Number(card.data.n));
			if (card.badge !== isNew) problems.push(`${card.href} ${card.badge ? 'has a badge it should not have' : 'should have the badge'}`);
			if (card.badge && !new RegExp(`<div class="misc-thumb"><img\\b[^>]*>${BADGE}</div>`).test(card.body)) problems.push(`${card.href}: the badge is not at the end of .misc-thumb`);
			if (card.title.includes('misc-new')) problems.push(`${card.href}: the badge is inside the title`);
		}
		assertEqual(after.html.split(BADGE).length - 1, fresh.size, 'New badges in the whole page');
		assertNone(problems);
		const dates = toys.map((toy) => toy.added).filter(Boolean).sort();
		const newest = dates[dates.length - 1] || 'no date';
		const sharing = dates.filter((date) => date === newest).length;
		return fresh.size
			? `${fresh.size} badged: the ${sharing} toys of ${newest}`
			: `none today: ${newest} is on ${sharing} toys, more than a third of the ${after.grid.cards.length} grid cards`;
	});

	// 5. The toolbar.
	check("tools: an All chip with the total, then one chip per heading, in the same order, with that group's card count", () => {
		if (!loaded) notRun();
		const { text } = readTools(after.html);
		const chips = [...text.matchAll(/<button type="button" class="misc-chip" data-group="([^"]*)" aria-pressed="(true|false)">([\s\S]*?) <span class="misc-chip-n">(\d+)<\/span><\/button>/g)].map((m) => ({
			group: m[1],
			pressed: m[2],
			name: m[3],
			count: Number(m[4]),
		}));
		assertEqual(text.split('class="misc-chip"').length - 1, chips.length, 'chips that could be read, of those in the toolbar');
		const { headings, cards } = after.grid;
		assertEqual(chips.length, headings.length + 1, 'chips (All, and one per heading)');
		assertEqual(JSON.stringify(chips[0]), JSON.stringify({ group: '', pressed: 'true', name: 'All', count: cards.length }), 'the All chip');
		headings.forEach((heading, i) => {
			const chip = chips[i + 1];
			assertEqual(chip.group, heading.group, `the group of chip ${i + 1}`);
			assertEqual(chip.name, heading.name, `the label of the ${heading.group} chip`);
			assertEqual(chip.count, heading.cards.length, `the number on the "${heading.name}" chip`);
			assertEqual(chip.pressed, 'false', `aria-pressed of the "${heading.name}" chip`);
		});
		return chips.map((chip) => `${chip.group || 'all'} ${chip.count}`).join(', ');
	});

	check('tools: written hidden, directly above the grid, with the filter, the count, Random and the view switch in Tab order', () => {
		if (!loaded) notRun();
		const { text, gap } = readTools(after.html);
		assert(!gap.trim(), `something sits between the toolbar and the grid: ${JSON.stringify(gap.trim().slice(0, 120))}`);
		assert(/^[ \t]*<div class="misc-tools" hidden>\n/.test(text), 'the toolbar must open with <div class="misc-tools" hidden>');
		const once = (needle, what) => assertEqual(text.split(needle).length - 1, 1, `${what} in the toolbar`);
		once('<input type="search" class="misc-filter"', 'filter boxes');
		once('aria-label="Filter the toys"', 'filter boxes named "Filter the toys"');
		once('class="misc-chip misc-random"', 'Random buttons');
		once('data-density="cards" aria-pressed="true"', 'pressed Cards buttons');
		once('data-density="compact" aria-pressed="false"', 'unpressed Compact buttons');
		once('<p class="misc-empty" hidden>', 'hidden "Nothing matches" lines');
		once('class="misc-clear"', 'Clear buttons');
		const count = /<span class="misc-count" aria-live="polite"[^>]*>(\d+) (toys?)<\/span>/.exec(text);
		assert(count, 'no <span class="misc-count" aria-live="polite">N toys</span>');
		assertEqual(Number(count[1]), after.grid.cards.length, 'the number in the count line');
		assertEqual(count[2], after.grid.cards.length === 1 ? 'toy' : 'toys', 'the noun in the count line');
		const order = ['class="misc-filter"', 'data-group=""', 'class="misc-chip misc-random"', 'data-density="cards"', 'data-density="compact"'].map((needle) => text.indexOf(needle));
		assert(order.every((at, i) => at !== -1 && (i === 0 || at > order[i - 1])), 'the controls are not in the order filter, chips, Random, Cards, Compact');
		assertEqual(text.lastIndexOf('class="misc-chip" data-group=') < text.indexOf('class="misc-chip misc-random"'), true, 'every group chip comes before Random');
		assertEqual(after.html.split(MISC_SCRIPT).length - 1, 1, `${MISC_SCRIPT} in index.html (the toolbar stays hidden without it)`);
		assert(existsSync(join(root, 'assets', 'js', 'misc.js')), 'assets/js/misc.js does not exist');
		return `${count[1]} ${count[2]}`;
	});

	// 6. The count in the strip's hint.
	check('the "N views" hint counts the views cards', () => {
		if (!loaded) notRun();
		const html = readFileSync(indexPath, 'utf8');
		const hints = [...html.matchAll(/<span class="bs-views-hint">(\d+) views/g)];
		assertEqual(hints.length, 1, 'index.html must hold exactly one "N views" hint');
		assertEqual(Number(hints[0][1]), after.views.cards.length, 'the hint and the strip disagree');
		return `${hints[0][1]} views`;
	});

	// 7. Everything generated comes from the manifests.
	check('emptying the three blocks and rebuilding them gives index.html back', () => {
		const html = readFileSync(indexPath, 'utf8');
		const emptied = applyToIndex(html, []);
		assert(!emptied.includes('class="misc-card"'), 'there are cards outside the marker pairs');
		assert(!emptied.includes('class="misc-group-h"'), 'there is a group heading outside the grid markers');
		assert(!emptied.includes('class="misc-tools"') && !emptied.includes('class="misc-chip"'), 'there is toolbar markup outside the tools markers');
		assert(emptied.includes('<span class="bs-views-hint">0 views'), 'the views count was not reset');
		const rebuilt = applyToIndex(emptied, toys);
		assert(rebuilt === html, 'the rebuilt page is not the page on disk; run node scripts/build-cards.mjs');
		assert(applyToIndex(rebuilt, toys) === rebuilt, 'rebuilding a second time changed the page');
		const crlf = html.includes('\r\n') ? html : html.replace(/\n/g, '\r\n');
		const lf = crlf.replace(/\r\n/g, '\n');
		assert(applyToIndex(applyToIndex(crlf, []), toys) === crlf, 'a CRLF copy of the page does not survive a rebuild');
		assert(applyToIndex(applyToIndex(lf, []), toys) === lf, 'an LF copy of the page does not survive a rebuild');
		assert(applyToIndex(BOM + lf, toys) === BOM + lf, 'a copy with a BOM does not keep it');
		return `${html.length - emptied.length} characters generated`;
	});

	// 8. The generator, run for real.
	const run = (runArgs) => spawnSync(process.execPath, [buildScript, ...runArgs], { cwd: root, encoding: 'utf8' });
	const upToDate = check('build-cards.mjs --check exits 0', () => {
		const result = run(['--check']);
		assert(result.status === 0, `exit ${result.status}\n${result.stdout}${result.stderr}`.trim());
		return result.stdout.trim();
	});

	check('running the generator twice writes nothing', () => {
		// A test must not rewrite the files it is checking, so the real runs only
		// happen once --check has said there is nothing to write.
		assert(upToDate, 'not run: --check failed, so a real run would rewrite files');
		const snapshot = () => [indexPath, toysPath].map((path) => ({ path, bytes: readFileSync(path), mtime: statSync(path).mtimeMs }));
		const states = [snapshot()];
		for (let i = 0; i < 2; i++) {
			const result = run([]);
			assert(result.status === 0, `run ${i + 1}: exit ${result.status}\n${result.stdout}${result.stderr}`.trim());
			states.push(snapshot());
		}
		for (let i = 1; i < states.length; i++) {
			states[i].forEach((file, k) => {
				assert(file.bytes.equals(states[0][k].bytes), `run ${i} changed the bytes of ${file.path}`);
				assert(file.mtime === states[0][k].mtime, `run ${i} rewrote ${file.path}`);
			});
		}
		return 'index.html and misc/toys.json: same bytes, same modification times';
	});

	// 9. Rules that today's cards do not exercise.
	// A made-up toy with a card on the grid; `more` overrides any key.
	const made = (n, more = {}) => ({ n, slug: `${n}-x`, title: `T${n}`, desc: 'd', group: 'lab', tags: [], added: '2026-01-01', status: 'live', surfaces: ['grid'], order: { grid: null, views: null }, ...more });

	check('text is escaped only where it has to be', () => {
		const cases = [
			['Tom & Jerry', 'Tom &amp; Jerry'],
			['a < b > c', 'a &lt; b &gt; c'],
			['3&times;5 &amp; &#215; &#xD7; &lt;b&gt;', '3&times;5 &amp; &#215; &#xD7; &lt;b&gt;'],
			['& &; &# &#; &#x; &1;', '&amp; &amp;; &amp;# &amp;#; &amp;#x; &amp;1;'],
			["Authors' 堕落論 cliché 3×5 · →", "Authors' 堕落論 cliché 3×5 · →"],
		];
		for (const [input, expected] of cases) assertEqual(escapeText(input), expected, `escapeText(${JSON.stringify(input)})`);
		assertEqual(escapeAttr('say "hi" & <go> &amp; on'), 'say &quot;hi&quot; &amp; &lt;go&gt; &amp; on', 'escapeAttr');
		return `${cases.length + 1} cases`;
	});

	check('order: unnumbered toys first with the newest on top, then the numbered ones', () => {
		const toy = (n, grid, more = {}) => ({ n, slug: `${n}-x`, title: 't', desc: 'd', status: 'live', surfaces: ['grid'], order: { grid, views: null }, ...more });
		const list = [
			toy(10, 1),
			toy(11, 0),
			toy(60, null),
			toy(61, undefined),
			toy(12, 0.5),
			toy(13, 1),
			toy(62, null, { status: 'wip' }),
			toy(63, null, { surfaces: ['views'] }),
			{ n: 64, slug: '64-x', title: 't', desc: 'd', status: 'live', surfaces: ['grid'] },
			toy(65, 0, { surfaces: [] }),
		];
		assertEqual(sortFor(list, 'grid').map((t) => t.n).join(' '), '64 61 60 11 12 13 10', 'grid order');
		assertEqual(sortFor(list, 'views').map((t) => t.n).join(' '), '63', 'views order');
		assertEqual(list.map((t) => t.n).join(' '), '10 11 60 61 12 13 62 63 64 65', 'sortFor must not reorder its input');
		return '';
	});

	check('groups: GROUPS order, new toys on top of their group, the older ones as numbered, empty groups left out', () => {
		const list = [
			made(10, { group: 'time', order: { grid: 2 } }),
			made(11, { group: 'ml', order: { grid: 5 } }),
			made(12, { group: 'time', order: { grid: 1 } }),
			made(13, { group: 'ml', order: { grid: 0 } }),
			made(60, { group: 'ml' }),
			made(61, { group: 'time' }),
			made(62, { group: 'ml' }),
			made(63, { group: 'art', status: 'wip' }),
			made(64, { group: 'library', surfaces: ['views'] }),
			made(65, { group: 'stories', surfaces: [] }),
		];
		const groups = groupsFor(list);
		assertEqual(groups.map((group) => `${group.id}: ${group.toys.map((toy) => toy.n).join(' ')}`).join(' | '), 'ml: 62 60 13 11 | time: 61 12 10', 'groupsFor');
		const grid = parseGrid(renderBlock(list, 'grid', '\t') + '\n', 'made-up grid');
		assertEqual(grid.headings.map((heading) => `${heading.id} ${heading.group} "${heading.name}" ${heading.count}: ${heading.cards.map((card) => card.data.n).join(' ')}`).join(' | '),
			'misc-g-ml ml "Machine learning, live" 4: 62 60 13 11 | misc-g-time time "Clocks and maps" 3: 61 12 10', 'the rendered grid');
		assert(renderBlock(list, 'grid', '\t').startsWith('\t<h3 class="misc-group-h" id="misc-g-ml" data-group="ml">Machine learning, live <span class="misc-group-n">4</span></h3>\n\t<a class="misc-card" '), 'the grid does not open with a heading line followed by a card');
		const tools = renderTools(list, '');
		const chips = [...tools.matchAll(/class="misc-chip" data-group="([^"]*)" aria-pressed="[a-z]+">([^<]*) <span class="misc-chip-n">(\d+)</g)].map((m) => `${m[1]}=${m[2]}=${m[3]}`);
		assertEqual(chips.join(' | '), '=All=7 | ml=Machine learning, live=4 | time=Clocks and maps=3', 'the chips');
		assert(tools.includes('<span class="misc-count" aria-live="polite" aria-atomic="true">7 toys</span>'), 'the count line does not say "7 toys"');
		assert(renderTools([made(60)], '').includes('>1 toy</span>'), 'one toy is not counted as "1 toy"');
		assertEqual(renderTools([], '\t'), '', 'renderTools of no toys');
		assertEqual(renderTools([made(64, { surfaces: ['views'] })], '\t'), '', 'renderTools when nothing is on the grid');
		let stray = '';
		try {
			groupsFor([made(60, { group: 'nope' })]);
		} catch (e) {
			stray = e.message;
		}
		assert(stray.includes('60-x') && stray.includes('nope'), `a grid toy with an unknown group must throw, naming it (got ${JSON.stringify(stray)})`);
		return '';
	});

	check('a note renders in the grid and not in the views strip; a views card has no data attributes', () => {
		const toy = made(60, { title: 'T', desc: 'D', note: 'N & more', surfaces: ['grid', 'views'] });
		const grid = renderCard(toy, 'grid', '\t');
		const views = renderCard(toy, 'views', '\t');
		assert(grid.includes('\t\t\t<p class="misc-note">N &amp; more</p>'), 'the grid card has no note line');
		assert(!views.includes('misc-note'), 'the views card shows the note');
		assertEqual(grid.split('\n').length, 8, 'lines in a grid card with a note');
		assertEqual(views.split('\n').length, 7, 'lines in a views card');
		assertEqual(grid.split('\n')[0], '\t<a class="misc-card" href="misc/60-x/" target="_blank" rel="noopener" data-n="60" data-group="lab" data-added="2026-01-01">', 'the opening tag of a grid card');
		assertEqual(views.split('\n')[0], '\t<a class="misc-card" href="misc/60-x/" target="_blank" rel="noopener">', 'the opening tag of a views card');
		assertEqual(renderCard(toy, 'views', '\t', { isNew: true }), views, 'a views card never wears the badge');
		assertEqual(renderBlock([toy], 'views', '\t'), views, 'renderBlock of one toy');
		assertEqual(renderBlock([], 'grid', '\t'), '', 'renderBlock of no toys');
		return '';
	});

	check('tags: one space between them, trimmed, blank ones dropped, escaped; no attribute when there are none', () => {
		const open = (toy) => renderCard(toy, 'grid').split('\n')[0];
		assertEqual(open(made(60, { tags: [' weave ', 'two  words', '', '  ', 'a"b&c'] })).includes(' data-tags="weave two words a&quot;b&amp;c" '), true, 'data-tags of a tagged toy');
		assert(!open(made(60, { tags: [] })).includes('data-tags'), 'an empty tag list still gives data-tags');
		assert(!open(made(60, { tags: undefined })).includes('data-tags'), 'no tag list still gives data-tags');
		assert(!open(made(60, { added: '' })).includes('data-added'), 'an empty date still gives data-added');
		assertEqual(open(made(60, { tags: ['x'] })), '<a class="misc-card" href="misc/60-x/" target="_blank" rel="noopener" data-n="60" data-group="lab" data-tags="x" data-added="2026-01-01">', 'the order of the data attributes');
		return '';
	});

	check('New badge: the latest wave gets it while it is at most a third of the grid', () => {
		const old = (n) => made(n, { added: '2026-01-01' });
		const fresh = (n, more = {}) => made(n, { added: '2026-02-02', ...more });
		const ns = (list) => [...newestWave(list)].sort((a, b) => a - b).join(' ');
		const olds = [1, 2, 3, 4, 5, 6, 7, 8, 9].map(old);
		assertEqual(ns([...olds, fresh(60), fresh(61), fresh(62)]), '60 61 62', '3 new toys on a grid of 12');
		assertEqual(ns([...olds.slice(0, 8), fresh(60), fresh(61), fresh(62), fresh(63)]), '60 61 62 63', '4 new toys on a grid of 12 (exactly a third)');
		assertEqual(ns([...olds.slice(0, 7), fresh(60), fresh(61), fresh(62), fresh(63), fresh(64)]), '', '5 new toys on a grid of 12');
		assertEqual(ns(olds), '', 'every toy from the same day');
		assertEqual(ns([]), '', 'no toys');
		assertEqual(ns([...olds, fresh(60), fresh(61, { surfaces: ['views'] })]), '60', 'a views-only toy of the wave is not badged');
		assertEqual(ns([...olds, fresh(60), fresh(61, { surfaces: ['views'] }), fresh(62, { surfaces: ['views'] }), fresh(63, { surfaces: ['views'] })]), '', 'views-only toys count towards the size of the wave (4 on a grid of 10)');
		assertEqual(ns([...olds, fresh(60), made(61, { added: '2026-03-03', status: 'wip' })]), '60', 'a wip toy with a later date does not take the badge away');
		assertEqual(ns([...olds, fresh(60), made(61, { added: '2026-03-03', surfaces: [] })]), '60', 'nor does a toy with no card');
		assertEqual(ns([...olds, fresh(60), made(61, { added: '' }), made(62, { added: undefined })]), '60', 'toys with no date are never new');
		const block = renderBlock([...olds, fresh(60), fresh(61)], 'grid', '');
		assertEqual(block.split(BADGE).length - 1, 2, 'badges in the rendered grid');
		assert(block.includes(`<div class="misc-thumb"><img src="assets/img/misc/60-x.jpg" alt="" loading="lazy">${BADGE}</div>`), 'the badge is not at the end of .misc-thumb');
		assert(!/<div class="misc-title">[^\n]*misc-new/.test(block), 'the badge is inside a title');
		return '';
	});

	check('validation catches a bad manifest', () => {
		const thumb = (width, height, exists = true) => ({ file: 'assets/img/misc/60-x.jpg', exists, near: '', width, height });
		const record = (toy, more = {}) => ({ dir: '60-x', num: 60, file: 'misc/60-x/toy.json', found: true, toy, error: '', page: true, thumb: thumb(800, 500), ...more });
		const good = { n: 60, slug: '60-x', title: 'T', desc: 'D', note: '', group: 'lab', tags: [], added: '2026-10-03', surfaces: ['grid'], order: { grid: null, views: null }, status: 'live', kit: false };
		const problemsOf = (toy, more) => validate([record(toy, more)]);
		const expectProblem = (toy, more, needle) => {
			const problems = problemsOf(toy, more);
			assert(problems.some((p) => p.includes(needle)), `expected a problem mentioning ${JSON.stringify(needle)}, found ${JSON.stringify(problems)}`);
		};

		assertEqual(problemsOf(good).join('\n'), '', 'a good manifest');
		expectProblem({ ...good, n: 61 }, {}, '"n"');
		expectProblem({ ...good, slug: '60-y' }, {}, '"slug"');
		expectProblem({ ...good, group: 'nope' }, {}, '"group"');
		expectProblem({ ...good, title: ' ' }, {}, '"title"');
		expectProblem({ ...good, desc: '' }, {}, '"desc"');
		expectProblem({ ...good, desc: 'two\nlines' }, {}, '"desc"');
		expectProblem({ ...good, status: 'done' }, {}, '"status"');
		expectProblem({ ...good, surfaces: ['grid', 'shelf'] }, {}, '"surfaces"');
		expectProblem({ ...good, surfaces: 'grid' }, {}, '"surfaces"');
		expectProblem({ ...good, order: { grid: '3' } }, {}, '"order.grid"');
		expectProblem({ ...good, order: { gird: 3 } }, {}, '"order"');
		expectProblem({ ...good, tags: 'weave' }, {}, '"tags"');
		expectProblem({ ...good, added: 'yesterday' }, {}, '"added"');
		expectProblem(good, { thumb: thumb(0, 0, false) }, 'is missing');
		expectProblem(good, { thumb: thumb(800, 571) }, '800x571');
		expectProblem(good, { thumb: thumb(0, 0) }, 'cannot read the size');
		expectProblem(good, { page: false }, 'index.html is missing');
		expectProblem(null, { error: 'is not valid JSON (x)' }, 'not valid JSON');

		// What is allowed: an old thumbnail marked legacy, and a toy that has no card.
		assertEqual(problemsOf({ ...good, thumb: { legacy: true } }, { thumb: thumb(800, 571) }).join('\n'), '', 'a legacy thumbnail');
		assertEqual(problemsOf({ ...good, status: 'wip' }, { thumb: thumb(0, 0, false), page: false }).join('\n'), '', 'a wip toy without a thumbnail');
		assertEqual(problemsOf({ ...good, surfaces: [] }, { thumb: thumb(0, 0, false) }).join('\n'), '', 'a toy with no surfaces');
		assertEqual(validate([record(null, { found: false })]).join('\n'), '', 'a folder with no toy.json');

		const twins = [record(good), record({ ...good, slug: '60-y' }, { dir: '60-y', file: 'misc/60-y/toy.json' })];
		assert(validate(twins).some((p) => p.includes('more than one toy')), 'two toys with the same n were not reported');
		return '';
	});

	const total = passed + failed;
	console.log(failed ? `\n${failed} of ${total} checks failed.` : `\nAll ${total} checks passed.`);
	return failed ? 1 : 0;
}

// True when this file is the script being run, not an import (same test as in
// build-cards.mjs: through realpath, and without regard to case on Windows).
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
		console.error(`test-cards: ${e.message}`);
		process.exitCode = 1;
	}
}
