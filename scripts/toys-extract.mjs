// One-off: turns the hand-written toy cards in index.html into one manifest per
// toy, misc/<NN-slug>/toy.json. Kept in the repo for the record.
//
// Until 2026-10-03 index.html held 60 hand-written cards for 52 toys: 42 in the
// Misc grid and 18 in the Bookshelf tab's "Ways to see the library" strip, eight
// toys showing in both. This script read them out once, from index.html as of
// commit 6f15b85. Since then the cards are generated from the manifests by
// scripts/build-cards.mjs, and the manifests are the thing to edit.
//
// Zero dependencies (it needs git on PATH for the dates). Run with:
//   node scripts/toys-extract.mjs                 write the manifests that do not exist yet
//   node scripts/toys-extract.mjs --dry-run       print them, write nothing
//   node scripts/toys-extract.mjs --force         overwrite existing manifests as well
//   node scripts/toys-extract.mjs --rev 6f15b85   read that commit's index.html, not the working tree's
//
// It never overwrites a toy.json unless --force is given: once a manifest has
// been edited, the cards in index.html are no longer where its facts come from.
//
// What goes into each manifest (the shape is described in build-cards.mjs):
//   title, desc, note   the card's text exactly as written, HTML entities included
//   surfaces, order     where the card shows, and its zero-based position there
//   group               from the MEMBERS table below
//   added               date of the commit that added misc/<slug>/index.html
//   thumb.legacy        only when the thumbnail is not 800x500
// Each file is LF, tab-indented, keys in that order, one trailing line break.

import { readFileSync, writeFileSync, existsSync, realpathSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { GROUPS, SURFACES, loadManifests, validate } from './build-cards.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const root = join(scriptDir, '..');

// Which group each toy went into, by toy number. The ids, display names and
// display order of the groups live in GROUPS in build-cards.mjs.
const MEMBERS = {
	stories: [31, 32, 42, 55],
	ml: [7, 16, 19],
	lab: [],
	code: [4, 5, 8, 30, 33],
	language: [11, 12, 13, 18, 21, 25, 26, 27, 36],
	library: [1, 9, 14, 17, 20, 22, 23, 24, 35, 37, 40, 43, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54],
	art: [29, 38, 39, 41, 44],
	time: [10, 15, 28, 34],
};

// The element that holds each surface's cards, as written in index.html.
const CONTAINERS = {
	grid: '<div class="misc-grid">',
	views: '<div class="bs-views-row">',
};

// ---- reading the cards --------------------------------------------------------

// One card, exactly as every card was written: eight lines (seven without a
// note), tab-indented, nothing optional but the note. Sticky, so it only
// matches at the position it is asked about.
const CARD_RE = new RegExp(
	[
		String.raw`(\t*)<a class="misc-card" href="misc/([^"/]+)/" target="_blank" rel="noopener">`,
		String.raw`\1\t<div class="misc-thumb"><img src="assets/img/misc/([^"/]+)\.jpg" alt="" loading="lazy"></div>`,
		String.raw`\1\t<div class="misc-body">`,
		String.raw`\1\t\t<div class="misc-title">(.*)</div>`,
		String.raw`\1\t\t<p class="misc-desc">(.*)</p>`,
		String.raw`(?:\1\t\t<p class="misc-note">(.*)</p>` + '\n)?' + String.raw`\1\t</div>`,
		String.raw`\1</a>`,
	].join('\n') + '\n',
	'y'
);

// Lines that may sit between cards: blank ones, and build-cards.mjs's markers
// (so the script still reads index.html after the markers went in).
const SKIP_RE = /[ \t]*(?:<!-- toys:(?:grid|views):(?:begin|end)(?: [^\n]*)? -->[ \t]*)?\n/y;

// Offsets of the text inside the one element opened by `openTag`, found by
// counting nested divs.
function innerSpan(html, openTag) {
	const count = html.split(openTag).length - 1;
	if (count !== 1) throw new Error(`index.html must hold ${openTag} exactly once (found ${count})`);
	const start = html.indexOf(openTag) + openTag.length;
	const tags = /<div\b|<\/div>/g;
	tags.lastIndex = start;
	let depth = 1;
	let m;
	while ((m = tags.exec(html))) {
		depth += m[0] === '</div>' ? -1 : 1;
		if (depth === 0) return { start, end: m.index };
	}
	throw new Error(`index.html: ${openTag} is never closed`);
}

// Every card of one surface, in document order: [{ slug, title, desc, note }].
// Throws at the first thing in the block that is neither a card in the
// expected shape nor a line that may be skipped.
function readCards(html, surface) {
	const { start, end } = innerSpan(html, CONTAINERS[surface]);
	const cards = [];
	let at = start;
	for (;;) {
		SKIP_RE.lastIndex = at;
		if (SKIP_RE.test(html)) {
			at = SKIP_RE.lastIndex;
			continue;
		}
		CARD_RE.lastIndex = at;
		const m = CARD_RE.exec(html);
		if (!m) break;
		const [, , slug, image, title, desc, note] = m;
		if (image !== slug) throw new Error(`the ${surface} card for ${slug} shows another toy's thumbnail (${image}.jpg)`);
		if (cards.some((card) => card.slug === slug)) throw new Error(`${slug} has two cards on the ${surface} surface`);
		cards.push({ slug, title, desc, note: note || '' });
		at = CARD_RE.lastIndex;
	}
	if (html.slice(at, end).trim()) {
		const line = html.slice(0, at).split('\n').length;
		throw new Error(`index.html line ${line}: the ${surface} block holds something that is not a card in the usual shape`);
	}
	return cards;
}

// ---- building the manifests ---------------------------------------------------

// Date (YYYY-MM-DD) of the commit that first added misc/<slug>/index.html, or
// "" when git cannot say.
function addedDate(slug) {
	let out = '';
	try {
		out = execFileSync('git', ['log', '--diff-filter=A', '--format=%as', '--', `misc/${slug}/index.html`], {
			cwd: root,
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'ignore'],
		});
	} catch (e) {
		return '';
	}
	const dates = out.split(/\r?\n/).filter(Boolean);
	return dates.length ? dates[dates.length - 1] : '';
}

function groupOf(n) {
	const ids = Object.keys(MEMBERS).filter((id) => MEMBERS[id].includes(n));
	if (ids.length !== 1) throw new Error(`toy ${n} must be in exactly one group of MEMBERS (found ${ids.length})`);
	return ids[0];
}

// The manifests, sorted by n, for every toy folder that has a card; plus the
// folders that have none (there is nothing to extract for those).
function buildManifests(html) {
	const known = GROUPS.map((group) => group.id);
	for (const id of Object.keys(MEMBERS)) {
		if (!known.includes(id)) throw new Error(`MEMBERS names a group that GROUPS does not have: ${id}`);
	}

	const cards = {};
	for (const surface of SURFACES) cards[surface] = readCards(html, surface);

	const records = loadManifests(root);
	const folders = records.map((record) => record.dir);
	for (const surface of SURFACES) {
		for (const card of cards[surface]) {
			if (!folders.includes(card.slug)) throw new Error(`the ${surface} card for ${card.slug} has no folder misc/${card.slug}/`);
		}
	}

	const manifests = [];
	const cardless = [];
	for (const record of records) {
		const found = {};
		for (const surface of SURFACES) {
			const position = cards[surface].findIndex((card) => card.slug === record.dir);
			if (position !== -1) found[surface] = { position, card: cards[surface][position] };
		}
		const shown = SURFACES.filter((surface) => found[surface]);
		if (!shown.length) {
			cardless.push(record.dir);
			continue;
		}

		// A toy on two surfaces must say the same thing on both. The note is the
		// exception: the grid shows it and the views strip never did.
		const first = found[shown[0]].card;
		for (const surface of shown) {
			const card = found[surface].card;
			if (card.title !== first.title || card.desc !== first.desc) {
				throw new Error(`${record.dir}: the title or description differs between ${shown[0]} and ${surface}`);
			}
			if (card.note && surface !== 'grid') throw new Error(`${record.dir}: a note on the ${surface} card would be lost (notes render in the grid only)`);
		}

		const thumb = record.thumb;
		if (thumb.exists && !thumb.width) throw new Error(`cannot read the size of ${thumb.file}`);

		const manifest = {
			n: record.num,
			slug: record.dir,
			title: first.title,
			desc: first.desc,
			note: found.grid ? found.grid.card.note : '',
			group: groupOf(record.num),
			tags: [],
			added: addedDate(record.dir),
			surfaces: shown,
			order: Object.fromEntries(SURFACES.map((surface) => [surface, found[surface] ? found[surface].position : null])),
			status: 'live',
			kit: false,
		};
		if (thumb.exists && (thumb.width !== 800 || thumb.height !== 500)) manifest.thumb = { legacy: true };
		manifests.push(manifest);
	}

	const numbers = manifests.map((manifest) => manifest.n);
	for (const n of Object.values(MEMBERS).flat()) {
		if (!numbers.includes(n)) throw new Error(`MEMBERS lists toy ${n}, which has no card`);
	}
	return { manifests, cardless, cards };
}

// ---- writing ------------------------------------------------------------------

function inline(value) {
	if (Array.isArray(value)) return `[${value.map(inline).join(', ')}]`;
	if (value !== null && typeof value === 'object') {
		const parts = Object.entries(value).map(([key, v]) => `${JSON.stringify(key)}: ${inline(v)}`);
		return parts.length ? `{ ${parts.join(', ')} }` : '{}';
	}
	return JSON.stringify(value);
}

// A manifest as the text of its toy.json: one top-level key per line, each
// value on that line, tab-indented, LF, one trailing line break.
export function formatManifest(manifest) {
	const lines = Object.entries(manifest).map(([key, value]) => `\t${JSON.stringify(key)}: ${inline(value)}`);
	return `{\n${lines.join(',\n')}\n}\n`;
}

function main(args) {
	const flags = new Set(['--dry-run', '--force']);
	let rev = '';
	for (let i = 0; i < args.length; i++) {
		if (args[i] === '--rev' && args[i + 1]) rev = args[++i];
		else if (!flags.has(args[i])) {
			console.error(`Unknown argument: ${args[i]}`);
			console.error('Usage: node scripts/toys-extract.mjs [--dry-run] [--force] [--rev <commit>]');
			return 1;
		}
	}
	const dryRun = args.includes('--dry-run');
	const force = args.includes('--force');

	const source = rev
		? execFileSync('git', ['show', `${rev}:index.html`], { cwd: root, maxBuffer: 64 * 1024 * 1024 }).toString('utf8')
		: readFileSync(join(root, 'index.html'), 'utf8');
	// Without a byte-order mark (code 0xFEFF) and with LF line endings, whatever the file uses.
	const text = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
	const { manifests, cardless, cards } = buildManifests(text.replace(/\r\n/g, '\n'));

	let written = 0;
	const kept = [];
	for (const manifest of manifests) {
		const text = formatManifest(manifest);
		if (JSON.stringify(JSON.parse(text)) !== JSON.stringify(manifest)) throw new Error(`${manifest.slug}: the manifest does not survive being written out`);
		const file = `misc/${manifest.slug}/toy.json`;
		if (dryRun) {
			process.stdout.write(`${file}\n${text}`);
			continue;
		}
		if (existsSync(join(root, file)) && !force) {
			kept.push(file);
			continue;
		}
		writeFileSync(join(root, file), text);
		written += 1;
	}

	const from = rev ? `index.html at ${rev}` : 'index.html';
	console.log(`Read ${SURFACES.map((surface) => `${cards[surface].length} ${surface} cards`).join(' and ')} from ${from}: ${manifests.length} toys.`);
	console.log(`Per group: ${GROUPS.map((group) => `${group.id} ${manifests.filter((m) => m.group === group.id).length}`).join(', ')}.`);
	const legacy = manifests.filter((m) => m.thumb && m.thumb.legacy);
	console.log(`Thumbnails that are not 800x500 (thumb.legacy): ${legacy.length ? legacy.map((m) => m.slug.slice(0, 2)).join(' ') : 'none'}.`);
	const undated = manifests.filter((m) => !m.added);
	console.log(`Added date unknown: ${undated.length ? undated.map((m) => m.slug).join(', ') : 'none'}.`);
	for (const dir of cardless) console.log(`No card in ${from} for misc/${dir}/: write its toy.json by hand.`);

	if (dryRun) {
		console.log('Dry run: nothing was written.');
		return 0;
	}
	for (const file of kept) console.log(`Kept ${file} as it is (use --force to overwrite).`);
	console.log(`Wrote ${written} manifest${written === 1 ? '' : 's'}, kept ${kept.length}.`);

	const problems = validate(loadManifests(root));
	for (const problem of problems) console.error(`  ${problem}`);
	if (problems.length) console.error(`${problems.length} problem${problems.length === 1 ? '' : 's'} in the manifests on disk.`);
	return problems.length ? 1 : 0;
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
		console.error(`toys-extract: ${e.message}`);
		process.exitCode = 1;
	}
}
