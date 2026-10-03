// Builds assets/data/places.json from the two lists at the top of
// misc/34-passport-atlas/app.js (VISITED and US_PLACES), so toys and tools can
// read the travel list without loading the atlas. app.js stays the source of
// truth: edit the list there (and its copy in widget.js), then run this.
//
// Zero dependencies. Run with:
//   node scripts/build-places-json.mjs           regenerate the file
//   node scripts/build-places-json.mjs --check   write nothing; exit 1 if the file
//                                                on disk is out of date
//
// Output shape, in app.js order:
//   { "countries": [{ id, name, home, city, tz, lat, lon, code, continent, pop }],
//     "usPlaces":  [{ name, lat, lon }] }
// `id` is the ISO 3166-1 numeric code as a string ("056"). `home` is written on
// every country; app.js writes it only on the home one.
//
// The array literals are cut out of the source text and evaluated on their own
// in an empty node:vm context; nothing is copied by hand. Two checks stop the
// build, in --check mode too:
//   - the home entry must be labelled "Texas" at 32.99, -96.75, the only home
//     label the site shows. A mismatch is reported without printing what was
//     found.
//   - widget.js keeps its own copy of both lists (COUNTRIES and US_PLACES). It
//     must list the same countries with the same name, home, city, lat, lon,
//     continent (`cont` there) and pop, and the same US places. Order may differ
//     (it is noted, not an error); tz and code exist only in app.js, vlat and
//     vlon only in widget.js. A disagreement is reported, never repaired.
//
// Output is LF, two-space JSON (like blog/index.json) with a trailing newline and
// no timestamps, so running this twice changes nothing.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const root = join(scriptDir, '..');
const atlasDir = join(root, 'misc', '34-passport-atlas');
const outFile = join(root, 'assets', 'data', 'places.json');
const OUT = 'assets/data/places.json';
const RUN = 'node scripts/build-places-json.mjs';

const HOME = { city: 'Texas', lat: 32.99, lon: -96.75 };

function fail(message) {
	throw new Error(message);
}

// ---- taking a literal out of a source file ---------------------------------

// The source text of the array literal assigned to `name` (`var NAME = [ ... ]`),
// found by matching brackets outside strings and comments.
function sliceArray(src, name, file) {
	const hits = [...src.matchAll(new RegExp(`\\b(?:var|let|const)\\s+${name}\\s*=\\s*`, 'g'))];
	if (hits.length !== 1) fail(`${file}: expected one declaration of ${name}, found ${hits.length}`);
	const start = hits[0].index + hits[0][0].length;
	if (src[start] !== '[') fail(`${file}: ${name} is not declared as an array literal`);
	const closer = { '[': ']', '{': '}', '(': ')' };
	const open = [];
	for (let i = start; i < src.length; i++) {
		const c = src[i];
		if (c === '"' || c === "'" || c === '`') {
			i++;
			while (i < src.length && src[i] !== c) i += src[i] === '\\' ? 2 : 1;
		} else if (c === '/' && src[i + 1] === '/') {
			while (i < src.length && src[i] !== '\n') i++;
		} else if (c === '/' && src[i + 1] === '*') {
			const end = src.indexOf('*/', i + 2);
			i = end === -1 ? src.length : end + 1;
		} else if (closer[c]) {
			open.push(closer[c]);
		} else if (c === ']' || c === '}' || c === ')') {
			if (open.pop() !== c) break;
			if (!open.length) return src.slice(start, i + 1);
		}
	}
	return fail(`${file}: could not find the end of the ${name} array literal`);
}

// A copy of an evaluated literal as plain data; anything JSON cannot hold
// (undefined, NaN, a function, a Date) is an error, not a silent null.
function toPlain(value, path) {
	if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
	if (typeof value === 'number') {
		if (!Number.isFinite(value)) fail(`${path} is not a finite number`);
		return value;
	}
	if (Array.isArray(value)) return Array.from(value, (v, i) => toPlain(v, `${path}[${i}]`));
	if (typeof value === 'object' && Object.prototype.toString.call(value) === '[object Object]') {
		const out = {};
		for (const key of Object.keys(value)) out[key] = toPlain(value[key], `${path}.${key}`);
		return out;
	}
	return fail(`${path} is ${value === undefined ? 'undefined' : `a ${typeof value}`}, not plain data`);
}

// The named array literals of one atlas source file, as data.
function readLists(file, names) {
	const path = join(atlasDir, file);
	if (!existsSync(path)) fail(`misc/34-passport-atlas/${file} not found`);
	const src = readFileSync(path, 'utf8');
	return names.map((name) => {
		const literal = sliceArray(src, name, file);
		let value;
		try {
			value = runInNewContext(`(${literal})`, Object.create(null), { timeout: 1000 });
		} catch (e) {
			fail(`${file}: ${name} is not a self-contained literal (${e.message})`);
		}
		const list = toPlain(value, `${file} ${name}`);
		if (!Array.isArray(list) || !list.length) fail(`${file}: ${name} is empty`);
		return list;
	});
}

// ---- shape -------------------------------------------------------------------

const isText = (v) => typeof v === 'string' && v !== '' && v === v.trim();
const isLat = (v) => typeof v === 'number' && v >= -90 && v <= 90;
const isLon = (v) => typeof v === 'number' && v >= -180 && v <= 180;

const COUNTRY_FIELDS = {
	id: (v) => typeof v === 'string' && /^\d{3}$/.test(v),
	name: isText,
	home: (v) => typeof v === 'boolean',
	city: isText,
	tz: isText,
	lat: isLat,
	lon: isLon,
	code: (v) => typeof v === 'string' && /^[A-Z]{3}$/.test(v),
	continent: isText,
	pop: (v) => Number.isInteger(v) && v > 0,
};
const PLACE_FIELDS = { name: isText, lat: isLat, lon: isLon };

// Checks one entry against a field table and returns it with those fields first,
// in table order, then any other keys as written. A missing `home` means false.
function shape(entry, fields, at) {
	if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) fail(`${at} is not an object`);
	const out = {};
	for (const [key, ok] of Object.entries(fields)) {
		const value = key === 'home' && entry[key] === undefined ? false : entry[key];
		if (!ok(value)) fail(`${at}.${key} is missing or not valid`);
		out[key] = value;
	}
	for (const key of Object.keys(entry)) if (!Object.hasOwn(out, key)) out[key] = entry[key];
	return out;
}

function assertUnique(list, key, what) {
	const seen = new Set();
	for (const item of list) {
		if (seen.has(item[key])) fail(`${what}: "${item[key]}" is listed twice`);
		seen.add(item[key]);
	}
}

// The home entry is the one place where a real address could leak, so the
// message never repeats what it found.
function assertHome(countries, file) {
	const homes = countries.filter((c) => c.home);
	if (homes.length !== 1) fail(`${file}: expected exactly one country with home: true, found ${homes.length}`);
	const h = homes[0];
	if (h.city !== HOME.city || h.lat !== HOME.lat || h.lon !== HOME.lon) {
		fail(`${file}: the home entry must be labelled "${HOME.city}" at ${HOME.lat}, ${HOME.lon}, and it is not. Fix ${file}; nothing was written. (What was found is deliberately not printed.)`);
	}
}

// ---- app.js against widget.js ---------------------------------------------

const SHARED_COUNTRY_FIELDS = ['name', 'home', 'city', 'lat', 'lon', 'continent', 'pop'];
const SHARED_PLACE_FIELDS = ['lat', 'lon'];

// Every way the two copies of a list disagree, as sentences. Order is not compared.
function disagreements(what, key, fields, label, app, widget) {
	const out = [];
	const inWidget = new Map(widget.map((w) => [w[key], w]));
	const inApp = new Set(app.map((a) => a[key]));
	for (const a of app) {
		const w = inWidget.get(a[key]);
		if (!w) {
			out.push(`${what} ${label(a)} is in app.js but not in widget.js`);
			continue;
		}
		for (const field of fields) {
			if (a[field] === w[field]) continue;
			// Same rule as assertHome: the home entry's values are never printed.
			const values = a.home || w.home ? '' : `: app.js has ${JSON.stringify(a[field])}, widget.js has ${JSON.stringify(w[field])}`;
			out.push(`${what} ${label(a)}: "${field}" differs${values}`);
		}
	}
	for (const w of widget) if (!inApp.has(w[key])) out.push(`${what} ${label(w)} is in widget.js but not in app.js`);
	return out;
}

const sameOrder = (a, b, key) => a.map((x) => x[key]).join('\n') === b.map((x) => x[key]).join('\n');

// ---- CLI ----------------------------------------------------------------------

function buildPlaces() {
	const [visited, usPlaces] = readLists('app.js', ['VISITED', 'US_PLACES']);
	const countries = visited.map((c, i) => shape(c, COUNTRY_FIELDS, `app.js VISITED[${i}]`));
	const places = usPlaces.map((p, i) => shape(p, PLACE_FIELDS, `app.js US_PLACES[${i}]`));
	assertUnique(countries, 'id', 'app.js VISITED');
	assertUnique(places, 'name', 'app.js US_PLACES');
	assertHome(countries, 'app.js');

	// widget.js names the continent `cont` and has no tz or code.
	const [wCountries, wPlaces] = readLists('widget.js', ['COUNTRIES', 'US_PLACES']);
	const widgetCountries = wCountries.map((c, i) => {
		if (c === null || typeof c !== 'object' || Array.isArray(c)) fail(`widget.js COUNTRIES[${i}] is not an object`);
		return { ...c, continent: c.cont, home: c.home === undefined ? false : c.home };
	});
	const widgetPlaces = wPlaces.map((p, i) => shape(p, PLACE_FIELDS, `widget.js US_PLACES[${i}]`));
	assertUnique(widgetCountries, 'id', 'widget.js COUNTRIES');
	assertUnique(widgetPlaces, 'name', 'widget.js US_PLACES');
	assertHome(widgetCountries, 'widget.js');

	const problems = [
		...disagreements('country', 'id', SHARED_COUNTRY_FIELDS, (c) => `${c.name} (${c.id})`, countries, widgetCountries),
		...disagreements('US place', 'name', SHARED_PLACE_FIELDS, (p) => `"${p.name}"`, places, widgetPlaces),
	];
	if (problems.length) {
		fail(`app.js and widget.js disagree; fix the source files, nothing was written:\n  - ${problems.join('\n  - ')}`);
	}

	const notes = [];
	if (!sameOrder(countries, widgetCountries, 'id')) {
		notes.push(`widget.js lists the countries in a different order (${widgetCountries.map((c) => c.id).join(', ')}); places.json follows app.js.`);
	}
	if (!sameOrder(places, widgetPlaces, 'name')) {
		notes.push('widget.js lists the US places in a different order; places.json follows app.js.');
	}
	return { data: { countries, usPlaces: places }, notes };
}

function main() {
	const args = process.argv.slice(2);
	const unknown = args.find((a) => a !== '--check');
	if (unknown !== undefined) fail(`Unknown argument "${unknown}". Usage: ${RUN} [--check]`);
	const check = args.includes('--check');

	const { data, notes } = buildPlaces();
	const what = `${data.countries.length} countries and ${data.usPlaces.length} US places`;
	console.log(`app.js and widget.js agree on ${what}.`);
	for (const note of notes) console.log(`Note: ${note}`);

	const json = JSON.stringify(data, null, 2) + '\n';
	const disk = existsSync(outFile) ? readFileSync(outFile, 'utf8') : null;

	if (check) {
		if (disk === null) {
			console.error(`${OUT} does not exist. Run: ${RUN}`);
			process.exitCode = 1;
			return;
		}
		// Git may check the file out with CRLF line endings (core.autocrlf); that is not drift.
		const found = disk.replace(/\r\n/g, '\n').split('\n');
		const expected = json.split('\n');
		let i = 0;
		while (i < found.length && i < expected.length && found[i] === expected[i]) i++;
		if (i < found.length || i < expected.length) {
			console.error(`${OUT} is out of date (first difference at line ${i + 1}). Run: ${RUN}`);
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
	console.error(`build-places-json: ${e.message}`);
	process.exitCode = 1;
}
