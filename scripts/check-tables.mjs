#!/usr/bin/env node
// check-tables.mjs: keeps the toys' shared copy of the bookshelf tables honest.
//
// The catalogue's lookup tables (bookcases and shelves, genre and language hues,
// language names, author aliases, free-text sources) are written in
// assets/js/bookshelf.js. misc/_kit/library.js is the one copy the toys share.
//
//   1. The table literals are sliced out of the bookshelf.js source text,
//      evaluated with node:vm and compared with the kit copy, key order
//      included. Any difference: exit 1.
//   2. The small helper functions the kit copied with them (langName,
//      langBucket, authorKey, eraLabel, eraRank, yearText, shelfLabel, the
//      spine colour) are sliced out the same way and run, next to the kit's,
//      over every record of assets/data/library.json. A different answer:
//      exit 1. A helper that can no longer be found in bookshelf.js is only
//      mentioned.
//   3. The older hand-made copies inside the toys and gadgets are compared too
//      and their drift is reported. That part never fails the run.
//
// Usage:  node scripts/check-tables.mjs [--quiet] [--json]
//         --quiet  print only failures and the result line
//         --json   print the whole result as JSON instead of text
//
// Node built-ins only. misc/_kit/test.js imports checkKit() from this file.

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..');
export const SOURCE = 'assets/js/bookshelf.js';
export const KIT = 'misc/_kit/library.js';
export const DATA = 'assets/data/library.json';

// The hand-made copies the kit replaces (folders are searched for .js and .html files).
export const LISTED_COPIES = [
	'misc/45-reading-room', 'misc/46-shelf-terminus', 'misc/47-spine-wall', 'misc/48-library-sunburst',
	'misc/49-publication-strata', 'misc/50-author-constellations', 'misc/51-library-flows',
	'misc/52-library-by-numbers', 'misc/54-card-catalog', 'assets/js/gadgets/now.js',
];
// Where else to look for copies nobody listed.
const OTHER_ROOTS = ['misc', 'assets/js'];
const HELPERS = ['langName', 'langBucket', 'authorKey', 'eraLabel', 'eraRank', 'yearText', 'shelfLabel', 'colorFor'];
const HELPER_NEEDS = ['hash', 'clamp', 'fmt'];

function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }

// ---- Slicing JavaScript source text ---------------------------------------

// Is the "/" at src[i] the start of a regular expression (rather than a division)?
function regexAllowed(src, i) {
	let j = i - 1;
	while (j >= 0 && /\s/.test(src[j])) j--;
	if (j < 0) return true;
	if ('(,=:[!&|?{};+-*%<>~^'.includes(src[j])) return true;
	const word = /[A-Za-z_$][\w$]*$/.exec(src.slice(Math.max(0, j - 12), j + 1));
	return !!word && /^(return|typeof|case|in|of|delete|void|instanceof|new|do|else)$/.test(word[0]);
}

// The index just past the string, template, comment or regex that starts at
// src[i], or i itself when nothing of the kind starts there.
function skipToken(src, i) {
	const c = src[i];
	if (c === '"' || c === "'" || c === '`') {
		for (let j = i + 1; j < src.length; j++) {
			if (src[j] === '\\') { j++; continue; }
			if (src[j] === c) return j + 1;
		}
		return src.length;
	}
	if (c === '/' && src[i + 1] === '/') {
		const end = src.indexOf('\n', i);
		return end === -1 ? src.length : end;
	}
	if (c === '/' && src[i + 1] === '*') {
		const end = src.indexOf('*/', i + 2);
		return end === -1 ? src.length : end + 2;
	}
	if (c === '/' && regexAllowed(src, i)) {
		let inClass = false;
		for (let j = i + 1; j < src.length; j++) {
			const d = src[j];
			if (d === '\\') { j++; continue; }
			if (d === '\n') return i;
			if (inClass) { if (d === ']') inClass = false; continue; }
			if (d === '[') { inClass = true; continue; }
			if (d === '/') {
				j++;
				while (j < src.length && /[a-z]/i.test(src[j])) j++;
				return j;
			}
		}
	}
	return i;
}

// The balanced {...}, [...] or (...) that opens at src[start], or null.
export function sliceBalanced(src, start) {
	let depth = 0;
	for (let i = start; i < src.length;) {
		const next = skipToken(src, i);
		if (next !== i) { i = next; continue; }
		const c = src[i];
		if (c === '{' || c === '[' || c === '(') depth++;
		else if (c === '}' || c === ']' || c === ')') {
			depth--;
			if (depth === 0) return src.slice(start, i + 1);
			if (depth < 0) return null;
		}
		i++;
	}
	return null;
}

// "var NAME = {...}" or "var NAME = [...]" (also "let", "const" and ", NAME ="
// in a var list): the literal's text and the line it starts on, or null when
// NAME is not defined as a literal in this source.
export function sliceLiteral(src, name) {
	const re = new RegExp('(?:\\b(?:var|let|const)\\s+|,\\s*)' + name + '\\s*=\\s*(?=[\\[{])');
	const m = re.exec(src);
	if (!m) return null;
	const start = m.index + m[0].length;
	const text = sliceBalanced(src, start);
	if (text == null) return null;
	return { text, line: src.slice(0, start).split('\n').length };
}

// "function NAME(...) {...}" as source text, or null.
export function sliceFunction(src, name) {
	const m = new RegExp('\\bfunction\\s+' + name + '\\s*\\(').exec(src);
	if (!m) return null;
	const paren = src.indexOf('(', m.index);
	const args = sliceBalanced(src, paren);
	if (args == null) return null;
	let i = paren + args.length;
	while (i < src.length && /\s/.test(src[i])) i++;
	if (src[i] !== '{') return null;
	const body = sliceBalanced(src, i);
	return body == null ? null : src.slice(m.index, i + body.length);
}

// Evaluates a literal in an empty vm context and returns plain data of this realm.
export function evalLiteral(text) {
	const value = vm.runInNewContext('(' + text + ')', Object.create(null), { timeout: 2000 });
	return JSON.parse(JSON.stringify(value));
}

// ---- Comparing ----------------------------------------------------------------

function show(v) {
	const s = JSON.stringify(v);
	return s == null ? String(v) : (s.length > 60 ? s.slice(0, 57) + '...' : s);
}
function isObject(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }

// Differences between two plain values as short sentences ([] when they are the
// same). `theirs` is what bookshelf.js says. Key order counts.
export function diff(mine, theirs, at = '') {
	const where = at || 'the table';
	if (Array.isArray(mine) !== Array.isArray(theirs) || isObject(mine) !== isObject(theirs)) {
		return [where + ' is ' + show(mine) + ', bookshelf.js has ' + show(theirs)];
	}
	if (Array.isArray(mine)) {
		const out = [];
		if (mine.length !== theirs.length) out.push(where + ' has ' + mine.length + ' entries, bookshelf.js has ' + theirs.length);
		for (let i = 0; i < Math.min(mine.length, theirs.length); i++) out.push(...diff(mine[i], theirs[i], at + '[' + i + ']'));
		return out;
	}
	if (isObject(mine)) {
		const out = [];
		const a = Object.keys(mine), b = Object.keys(theirs);
		const missing = b.filter((k) => !(k in mine)), extra = a.filter((k) => !(k in theirs));
		if (missing.length) out.push(where + ' lacks ' + missing.map(show).join(', '));
		if (extra.length) out.push(where + ' adds ' + extra.map(show).join(', '));
		for (const k of a) if (k in theirs) out.push(...diff(mine[k], theirs[k], (at ? at + '.' : '') + k));
		if (!missing.length && !extra.length && a.join('\u0000') !== b.join('\u0000')) out.push(where + ' has its keys in a different order');
		return out;
	}
	return mine === theirs ? [] : [where + ' is ' + show(mine) + ', bookshelf.js has ' + show(theirs)];
}

// What a UNITS table says, whatever its shape: the unit keys in order and, per
// unit, the name, the description and the shelf keys (null when not recorded).
function unitFacts(units) {
	const facts = { order: [], units: {} };
	const shelfKeys = (u) => {
		const out = [];
		const walk = (v) => {
			if (typeof v === 'string') out.push(v);
			else if (Array.isArray(v)) v.forEach(walk);
			else if (v && typeof v === 'object') for (const k of ['top', 'shelves', 'cols', 'bays', 'keys']) if (v[k] != null) walk(v[k]);
		};
		let any = false;
		for (const k of ['top', 'shelves', 'cols', 'bays']) if (u[k] != null) { any = true; walk(u[k]); }
		return any ? out : null;
	};
	const add = (key, u) => {
		facts.order.push(key);
		facts.units[key] = typeof u === 'string'
			? { name: u, desc: null, shelves: null }
			: { name: u.name == null ? null : u.name, desc: u.desc == null ? null : u.desc, shelves: shelfKeys(u) };
	};
	if (Array.isArray(units)) {
		for (const u of units) {
			if (!u || typeof u !== 'object') return null;
			const key = u.k != null ? u.k : u.id;
			if (key == null) return null;
			add(String(key), u);
		}
	} else if (isObject(units)) {
		for (const [k, u] of Object.entries(units)) add(k, u);
	} else return null;
	return facts;
}

// How a reshaped UNITS copy compares with bookshelf.js, fact by fact.
function diffUnits(copy, site) {
	const a = unitFacts(copy), b = unitFacts(site);
	if (!a) return { same: false, notes: ['a shape this script cannot read'] };
	const notes = [];
	const missing = b.order.filter((k) => !(k in a.units)), extra = a.order.filter((k) => !(k in b.units));
	if (missing.length) notes.push('lacks unit ' + missing.join(', '));
	if (extra.length) notes.push('adds unit ' + extra.join(', '));
	const shared = a.order.filter((k) => k in b.units);
	if (shared.join(' ') !== b.order.filter((k) => k in a.units).join(' ')) notes.push('units in a different order');
	let names = 0, descs = 0, shelves = 0, hasDesc = false, hasShelves = false;
	for (const k of shared) {
		const x = a.units[k], y = b.units[k];
		if (x.name !== y.name) { names++; notes.push('unit ' + k + ' is named ' + show(x.name) + ', bookshelf.js has ' + show(y.name)); }
		if (x.desc != null) { hasDesc = true; if (x.desc !== y.desc) { descs++; notes.push('unit ' + k + ' has a different description'); } }
		if (x.shelves != null) {
			hasShelves = true;
			const gone = y.shelves.filter((s) => !x.shelves.includes(s)), added = x.shelves.filter((s) => !y.shelves.includes(s));
			if (gone.length) { shelves++; notes.push('unit ' + k + ' lacks shelf ' + gone.map(show).join(', ')); }
			if (added.length) { shelves++; notes.push('unit ' + k + ' adds shelf ' + added.map(show).join(', ')); }
		}
	}
	const agree = ['names'];
	if (hasDesc) agree.push('descriptions');
	if (hasShelves) agree.push('shelf keys');
	const kept = 'keeps ' + agree.join(', ') + (hasDesc && hasShelves ? '' : '; drops ' + [hasDesc ? '' : 'descriptions', hasShelves ? '' : 'shelves'].filter(Boolean).join(' and '));
	return { same: notes.length === 0, notes, kept, counts: { names, descs, shelves } };
}

// ---- 1. The kit copy against bookshelf.js -----------------------------------

function siteTables(src, names) {
	const out = {};
	for (const name of names) {
		const lit = sliceLiteral(src, name);
		if (!lit) { out[name] = { error: 'not found as a literal in ' + SOURCE }; continue; }
		try { out[name] = { value: evalLiteral(lit.text), text: lit.text, line: lit.line }; }
		catch (e) { out[name] = { error: 'could not be evaluated (' + e.message + ')' }; }
	}
	return out;
}

function size(v) { return Array.isArray(v) ? v.length + ' entries' : Object.keys(v).length + ' keys'; }

// Returns { ok, tables: [{ name, ok, note }], helpers: [{ name, ok, note, skipped }], notes: [] }.
export function checkKit() {
	const result = { ok: true, tables: [], helpers: [], notes: [] };
	const src = read(SOURCE);
	const require = createRequire(import.meta.url);
	const kitPath = path.join(ROOT, KIT);
	delete require.cache[require.resolve(kitPath)];
	const kit = require(kitPath);
	const names = Array.isArray(kit.TABLES) ? kit.TABLES : [];
	if (!names.length) { result.ok = false; result.notes.push(KIT + ' does not list its tables (TABLES)'); }
	const site = siteTables(src, names);

	for (const name of names) {
		const s = site[name];
		if (s.error) { result.ok = false; result.tables.push({ name, ok: false, note: s.error }); continue; }
		if (kit[name] == null) { result.ok = false; result.tables.push({ name, ok: false, note: 'missing from ' + KIT }); continue; }
		const d = diff(JSON.parse(JSON.stringify(kit[name])), s.value, '');
		if (d.length) { result.ok = false; result.tables.push({ name, ok: false, note: d.slice(0, 6).join('; ') + (d.length > 6 ? '; and ' + (d.length - 6) + ' more' : '') }); }
		else result.tables.push({ name, ok: true, note: 'same as bookshelf.js line ' + s.line + ' (' + size(s.value) + ')' });
	}

	// Tables bookshelf.js has that the kit does not carry (information only).
	const seen = new Set(names);
	const re = /(?:^|\n)\tvar ([A-Z][A-Z0-9_]*)\s*=\s*(?=[\[{])/g;
	let m;
	while ((m = re.exec(src))) if (!seen.has(m[1])) result.notes.push(SOURCE + ' also defines ' + m[1] + ' (not carried by the kit)');

	// Helpers.
	let lib;
	try { lib = JSON.parse(read(DATA)); } catch (e) { lib = null; result.notes.push(DATA + ' could not be read, so the helpers were not exercised'); }
	const parts = [], found = [];
	for (const name of names) if (site[name].text) parts.push('var ' + name + ' = ' + site[name].text + ';');
	for (const name of HELPER_NEEDS.concat(HELPERS)) {
		const f = sliceFunction(src, name);
		if (f) { parts.push(f); found.push(name); }
	}
	let fns = null;
	try { fns = vm.runInNewContext(parts.join('\n') + '\n({ ' + found.map((n) => n + ': ' + n).join(', ') + ' })', {}, { timeout: 5000 }); }
	catch (e) { result.notes.push('the helper functions of ' + SOURCE + ' could not be evaluated (' + e.message + ')'); }
	const records = lib ? (lib.books || []).concat(lib.objects || []) : [];
	const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
	const run = (name, kitFn, each) => {
		if (!fns || typeof fns[name] !== 'function' || !records.length) {
			result.helpers.push({ name, ok: true, skipped: true, note: 'not found in ' + SOURCE + ', so not compared' });
			return;
		}
		if (typeof kitFn !== 'function') { result.ok = false; result.helpers.push({ name, ok: false, note: 'missing from ' + KIT }); return; }
		let bad = 0, first = '', n = 0;
		for (const b of records) {
			for (const [input, theirs, mine] of each(b)) {
				n++;
				if (!same(theirs, mine)) { bad++; if (!first) first = 'for ' + show(input) + ' the kit says ' + show(mine) + ', bookshelf.js says ' + show(theirs); }
			}
		}
		if (bad) { result.ok = false; result.helpers.push({ name, ok: false, note: bad + ' of ' + n + ' answers differ; ' + first }); }
		else result.helpers.push({ name, ok: true, note: n + ' answers agree' });
	};
	const safe = (fn) => { try { return fn(); } catch (e) { return 'threw: ' + e.message; } };
	run('langName', kit.langName, (b) => [[b.l, safe(() => fns.langName(b.l)), safe(() => kit.langName(b.l))]]);
	run('langBucket', kit.langBucket, (b) => [[b.l, safe(() => fns.langBucket(b.l)), safe(() => kit.langBucket(b.l))]]);
	run('authorKey', kit.authorKey, (b) => [[b.a, safe(() => fns.authorKey(b.a)), safe(() => kit.authorKey(b.a))]]);
	run('eraLabel', kit.eraLabel, (b) => [[b.y, safe(() => fns.eraLabel(b.y)), safe(() => kit.eraLabel(b.y))]]);
	run('eraRank', kit.eraRank, (b) => { const e = kit.eraLabel(b.y); return [[e, safe(() => fns.eraRank(e)), safe(() => kit.eraRank(e))]]; });
	run('yearText', kit.yearText, (b) => (b.y == null ? [] : [[b.y, safe(() => fns.yearText(b.y)), safe(() => kit.yearText(b.y))]]));
	run('shelfLabel', kit.shelfLabel, (b) => [[b.s, safe(() => fns.shelfLabel(b.s)), safe(() => kit.shelfLabel(b.s))]]);
	// colorFor reads b.seed and b.lb, which bookshelf.js's decorate() sets like this:
	const seeded = /b\.seed\s*=\s*hash\(b\.a\s*\|\|\s*b\.pub\s*\|\|\s*b\.t\)/.test(src) && /b\.lb\s*=\s*langBucket\(b\.l\)/.test(src);
	if (!seeded) result.notes.push('could not confirm how ' + SOURCE + ' seeds its spine colours (decorate() changed), so colorFor was not compared');
	if (fns && seeded && typeof fns.hash === 'function' && typeof fns.langBucket === 'function') {
		run('colorFor', kit.spineColor, (b) => ['genre', 'language', 'era'].map((mode) => {
			const theirs = safe(() => fns.colorFor(Object.assign({}, b, { seed: fns.hash(b.a || b.pub || b.t), lb: fns.langBucket(b.l) }), mode));
			return [b.id + ' ' + mode, theirs, safe(() => kit.spineColor(b, mode))];
		}));
	} else result.helpers.push({ name: 'colorFor', ok: true, skipped: true, note: 'not compared' });
	return result;
}

// ---- 2. Drift in the hand-made copies (report only) ---------------------------

function filesUnder(rel, out = []) {
	const abs = path.join(ROOT, rel);
	let st;
	try { st = fs.statSync(abs); } catch (e) { return out; }
	if (st.isFile()) { if (/\.(js|mjs|html)$/.test(rel)) out.push(rel.split(path.sep).join('/')); return out; }
	for (const name of fs.readdirSync(abs).sort()) {
		if (name === 'node_modules' || name.startsWith('.')) continue;
		filesUnder(path.join(rel, name), out);
	}
	return out;
}

function compareCopy(name, copy, site) {
	if (name === 'UNITS') {
		if (!diff(copy, site).length) return { status: 'same', note: '' };
		const u = diffUnits(copy, site);
		return u.same
			? { status: 'reshaped', note: u.kept }
			: { status: 'differs', note: u.notes.slice(0, 4).join('; ') + (u.notes.length > 4 ? '; and ' + (u.notes.length - 4) + ' more' : '') };
	}
	const d = diff(copy, site);
	if (!d.length) return { status: 'same', note: '' };
	if (isObject(copy) && isObject(site) && !Object.keys(copy).some((k) => k in site)) {
		// No key in common: the same values under other keys, or another table that only shares the name.
		const values = (o) => Object.values(o).map((v) => JSON.stringify(v)).sort().join('\u0000');
		return values(copy) === values(site)
			? { status: 'rekeyed', note: 'the same values under other keys (' + Object.keys(copy).join(', ') + ')' }
			: { status: 'unrelated', note: 'shares no key with bookshelf.js; a different table with the same name (' + Object.keys(copy).join(', ') + ')' };
	}
	const order = d.length === 1 && /different order/.test(d[0]);
	return { status: order ? 'reordered' : 'differs', note: d.slice(0, 4).map((s) => s.replace(/^the table /, '')).join('; ') + (d.length > 4 ? '; and ' + (d.length - 4) + ' more' : '') };
}

// Returns { listed: [{ file, tables: [{ name, line, status, note }] }], other: [...], absent: [paths] }.
export function drift() {
	const src = read(SOURCE);
	const require = createRequire(import.meta.url);
	const kit = require(path.join(ROOT, KIT));
	const names = kit.TABLES || [];
	const site = siteTables(src, names);
	const scan = (file) => {
		const text = read(file), tables = [];
		for (const name of names) {
			if (site[name].error) continue;
			const lit = sliceLiteral(text, name);
			if (!lit) continue;
			let value;
			try { value = evalLiteral(lit.text); }
			catch (e) { tables.push({ name, line: lit.line, status: 'unreadable', note: 'not a plain literal (' + e.message + ')' }); continue; }
			tables.push(Object.assign({ name, line: lit.line }, compareCopy(name, value, site[name].value)));
		}
		return tables;
	};
	const out = { listed: [], other: [], absent: [] };
	const listedFiles = new Set();
	for (const entry of LISTED_COPIES) {
		const files = filesUnder(entry);
		if (!files.length) { out.absent.push(entry); continue; }
		let any = false;
		for (const file of files) {
			listedFiles.add(file);
			const tables = scan(file);
			if (tables.length) { any = true; out.listed.push({ file, tables }); }
		}
		if (!any) out.listed.push({ file: entry, tables: [] });
	}
	for (const base of OTHER_ROOTS) {
		for (const file of filesUnder(base)) {
			if (listedFiles.has(file) || file === SOURCE || file.startsWith('misc/_kit/')) continue;
			const tables = scan(file);
			if (tables.length) out.other.push({ file, tables });
		}
	}
	return out;
}

// ---- Command line ---------------------------------------------------------------

function main(argv) {
	const quiet = argv.includes('--quiet'), json = argv.includes('--json');
	let kit, copies;
	try { kit = checkKit(); }
	catch (e) { console.error('check-tables: ' + e.message); process.exitCode = 1; return; }
	try { copies = drift(); } catch (e) { copies = { listed: [], other: [], absent: [], error: e.message }; }
	if (json) { console.log(JSON.stringify({ ok: kit.ok, kit, drift: copies }, null, 2)); process.exitCode = kit.ok ? 0 : 1; return; }

	const pad = (s, n) => (s + ' '.repeat(n)).slice(0, Math.max(n, s.length));
	const line = (ok, name, note) => { if (!quiet || !ok) console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + pad(name, 13) + note); };
	if (!quiet) console.log('check-tables: ' + KIT + ' against ' + SOURCE);
	for (const t of kit.tables) line(t.ok, t.name, t.note);
	if (!quiet) console.log('helpers, run over the catalogue');
	for (const h of kit.helpers) { if (h.skipped) { if (!quiet) console.log('  skip  ' + pad(h.name, 13) + h.note); } else line(h.ok, h.name, h.note); }
	if (!quiet) for (const n of kit.notes) console.log('  note  ' + n);

	if (!quiet) {
		const section = (title, list) => {
			if (!list.length) return;
			console.log(title);
			for (const f of list) {
				if (!f.tables.length) { console.log('  ' + f.file + ': no table literals found'); continue; }
				console.log('  ' + f.file);
				for (const t of f.tables) console.log('    ' + pad(t.name, 13) + pad(t.status, 11) + (t.note ? t.note + ' ' : '') + '(line ' + t.line + ')');
			}
		};
		section('drift in the older copies (report only, never fails)', copies.listed);
		for (const a of copies.absent) console.log('  ' + a + ': not present');
		section('copies found elsewhere (report only)', copies.other);
		if (copies.error) console.log('  the drift report could not be completed: ' + copies.error);
		const all = copies.listed.concat(copies.other).flatMap((f) => f.tables);
		const tally = {};
		for (const t of all) tally[t.status] = (tally[t.status] || 0) + 1;
		console.log('copies: ' + (all.length ? Object.keys(tally).map((k) => tally[k] + ' ' + k).join(', ') : 'none found'));
	}
	console.log(kit.ok ? 'result: the kit copy matches bookshelf.js' : 'result: the kit copy DIFFERS from bookshelf.js (fix misc/_kit/library.js)');
	process.exitCode = kit.ok ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
