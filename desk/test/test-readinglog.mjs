// Tests for desk/readinglog.js (the reading log: shape, public projection,
// statistics, finder) and for the pure helpers of desk/views/notes.js.
// Run with: node desk/test/test-readinglog.mjs [seed]
//
// The part that matters most: a private note, or a field whose "public" box is
// not ticked, can never appear in what would be published. That is checked on
// thousands of random logs, well-formed and hostile, and the checker itself is
// checked against two deliberately leaky projections.

import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const RL = require('../readinglog.js');

let failed = 0;
let count = 0;
function check(name, ok, detail = '') {
	count++;
	if (!ok) failed++;
	console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${!ok && detail ? ' : ' + detail : ''}`);
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function throws(fn) {
	try {
		fn();
		return null;
	} catch (e) {
		return e;
	}
}

// A small seeded generator, so a failure can be run again.
const seed = Number(process.argv[2]) || 20261005;
function mulberry32(a) {
	return function () {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}
const rnd = mulberry32(seed);
const int = (n) => Math.floor(rnd() * n);
const pick = (list) => list[int(list.length)];
const chance = (p) => rnd() < p;
function shuffled(list) {
	const out = list.slice();
	for (let i = out.length - 1; i > 0; i--) {
		const j = int(i + 1);
		[out[i], out[j]] = [out[j], out[i]];
	}
	return out;
}
function shuffleKeys(obj) {
	const out = {};
	for (const k of shuffled(Object.keys(obj))) out[k] = obj[k];
	return out;
}
console.log(`seed ${seed}`);

// ---- values --------------------------------------------------------------------

check('cleanDate: real days pass, rebuilt as YYYY-MM-DD', RL.cleanDate('2026-10-05') === '2026-10-05' && RL.cleanDate('2024-02-29') === '2024-02-29' && RL.cleanDate('1900-01-01') === '1900-01-01');
check(
	'cleanDate: everything else is null',
	['2026-02-30', '2023-02-29', '2026-13-01', '2026-00-10', '2026-1-5', '20261005', '1899-12-31', '2200-01-01', '2026-10-05T10:00:00Z', ' 2026-10-05', '2026-10-05\n', '2026-10-05\nsecret', '', null, undefined, 20261005, {}, ['2026-10-05']].every((v) => RL.cleanDate(v) === null)
);
check('cleanRating: 1 to 5, as a number', [1, 2, 3, 4, 5].every((n) => RL.cleanRating(n) === n) && RL.cleanRating('4') === 4);
check('cleanRating: everything else is null', [0, 6, 2.5, -1, NaN, Infinity, '5 stars', '', null, undefined, true, [5], { valueOf: () => 5 }].every((v) => RL.cleanRating(v) === null));
check('cleanStatus: the four statuses only', RL.STATUSES.every((s) => RL.cleanStatus(s) === s) && ['Read', 'done', '', null, 1, ['read'], 'read '].every((v) => RL.cleanStatus(v) === null));
check('isId: catalogue ids pass', ['A-A2-17', 'K-HC 1-16'.replace(/ /g, '_'), 'Loose-Floor-03', 'x', 'B1.2'].every(RL.isId));
check('isId: shelf labels with brackets, commas and Japanese pass', ['L-L1(sticky16)-01', 'K-JP-1(Jump,Mill)-01', 'N-N3(' + String.fromCharCode(0x9234, 0x6728) + ')-01', 'N-N4(' + String.fromCharCode(0x30d0, 0x30ac) + ',' + String.fromCharCode(0x304f, 0x305a) + ')-01'].every(RL.isId));
check('isId: odd keys are refused', ['', ' x', 'a b', '__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf', '-a', 'a/b', 'a'.repeat(65), 'né', 5, null, undefined].every((v) => !RL.isId(v)));

// ---- the log -------------------------------------------------------------------

const sample = {
	'B-B1-03': { status: 'read', started: '2026-08-01', finished: '2026-08-20', rating: 5, note: 'The middle chapters drag; ask M. about the ending.', public: { status: true, dates: true, rating: true } },
	'A-A2-17': { status: 'reading', started: '2026-10-01', finished: null, rating: null, note: 'private thought', public: { status: true, dates: false, rating: false } },
	'K-A-01': { status: 'want', started: null, finished: null, rating: null, note: '', public: { status: false, dates: false, rating: false } },
	'N-N4-02': { status: 'abandoned', started: '2026-05-02', finished: '2026-05-09', rating: 2, note: 'not for me', public: { status: false, dates: true, rating: false } },
};

{
	const n = RL.normalize({
		'A-A2-17': { status: 'read', rating: '4', note: 'x  \r\n', public: { status: 'yes', rating: true } },
		'bad id': { status: 'read' },
		'K-A-01': { status: 'nonsense' },
		'K-A-02': 'read',
		'K-A-03': null,
		'K-A-04': ['read'],
		'K-A-05': { public: { status: true, dates: true, rating: true } },
		'B-B1-03': { started: '2026-01-02', extra: 'field', public: null },
	});
	check('normalize: keeps what is valid, sorted by id', same(Object.keys(n.log), ['A-A2-17', 'B-B1-03']));
	check('normalize: says what it dropped', same(n.dropped.slice().sort(), ['K-A-01', 'K-A-02', 'K-A-03', 'K-A-04', 'K-A-05', 'bad id'].sort()));
	check('normalize: an entry has exactly the six fields, cleaned', same(n.log['A-A2-17'], { status: 'read', started: null, finished: null, rating: 4, note: 'x', public: { status: false, dates: false, rating: true } }));
	check('normalize: unknown fields are not kept', same(Object.keys(n.log['B-B1-03']), ['status', 'started', 'finished', 'rating', 'note', 'public']));
	check('normalize: not an object gives an empty log', [null, undefined, 'x', 5, [], [1]].every((v) => same(RL.normalize(v).log, {})));
}
{
	check('parse: empty text is an empty log', same(RL.parse('').log, {}) && same(RL.parse('  \n').log, {}));
	check('parse: reads a file, with or without a byte-order mark', same(RL.parse(String.fromCharCode(0xfeff) + JSON.stringify(sample)).log, RL.normalize(sample).log));
	const e1 = throws(() => RL.parse('{ not json'));
	const e2 = throws(() => RL.parse('[1, 2]'));
	check('parse: bad JSON and a non-object throw in plain words', e1 && /not valid JSON/.test(e1.message) && e2 && /does not hold a reading log/.test(e2.message));
	const text = RL.serialize(sample);
	check('serialize: ends with a newline, uses tabs, ids sorted', text.endsWith('}\n') && text.includes('\n\t"A-A2-17": {\n\t\t"status"') && text.indexOf('A-A2-17') < text.indexOf('B-B1-03') && text.indexOf('B-B1-03') < text.indexOf('K-A-01'));
	check('serialize: the same whatever the key order', RL.serialize(shuffleKeys(sample)) === text && RL.serialize(RL.parse(text).log) === text);
	check('serialize then parse gives the log back', same(RL.parse(text).log, RL.normalize(sample).log));
}
{
	const before = RL.normalize(sample).log;
	const frozen = JSON.stringify(before);
	let log = RL.set(before, 'K-B-09', { status: 'reading' }, '2026-10-05');
	check('set: marking "reading" fills in the start date', same(log['K-B-09'], { status: 'reading', started: '2026-10-05', finished: null, rating: null, note: '', public: { status: false, dates: false, rating: false } }));
	check('set: the log passed in is not changed', JSON.stringify(before) === frozen && !('K-B-09' in before));
	log = RL.set(log, 'K-B-09', { status: 'read' }, '2026-10-20');
	check('set: marking "read" fills in the finish date and keeps the start', log['K-B-09'].started === '2026-10-05' && log['K-B-09'].finished === '2026-10-20' && log['K-B-09'].status === 'read');
	log = RL.set(log, 'K-B-09', { status: 'reading' }, '2026-11-01');
	check('set: a change of status never clears or overwrites a date', log['K-B-09'].started === '2026-10-05' && log['K-B-09'].finished === '2026-10-20');
	log = RL.set(log, 'K-B-09', { started: '2026-09-30', finished: '', rating: 4, note: 'good\n\n', public: { rating: true } }, '2026-11-01');
	check('set: dates, rating, note and one public box', same(log['K-B-09'], { status: 'reading', started: '2026-09-30', finished: null, rating: 4, note: 'good', public: { status: false, dates: false, rating: true } }));
	log = RL.set(log, 'K-B-09', { public: { status: 'true', dates: 1 } }, '2026-11-01');
	check('set: only the boolean true ticks a box', log['K-B-09'].public.status === false && log['K-B-09'].public.dates === false && log['K-B-09'].public.rating === true);
	check('set: "want" and "abandoned" set no date', RL.set({}, 'x1', { status: 'want' }, '2026-10-05').x1.started === null && RL.set({}, 'x1', { status: 'abandoned' }, '2026-10-05').x1.finished === null);
	check('set: no "today" means no date is filled in', RL.set({}, 'x1', { status: 'read' }).x1.finished === null);
	log = RL.set(log, 'K-B-09', { status: null, started: null, rating: null, note: '' });
	check('set: an entry with nothing left in it is removed', !('K-B-09' in log));
	check('set: a bad id changes nothing', same(RL.set(before, 'bad id', { status: 'read' }, '2026-10-05'), before) && same(RL.set(before, '__proto__', { status: 'read' }, '2026-10-05'), before));
	check('set: a too long note is cut at NOTE_MAX', RL.set({}, 'x1', { note: 'n'.repeat(RL.NOTE_MAX + 50) }).x1.note.length === RL.NOTE_MAX);
	const snap = RL.get(before, 'B-B1-03');
	const changed = RL.set(before, 'B-B1-03', { status: 'abandoned', rating: 1, note: '' }, '2026-10-05');
	check('put: restores an entry exactly (undo)', same(RL.put(changed, 'B-B1-03', snap), before));
	check('put(null) and remove: the entry is gone', !('B-B1-03' in RL.put(before, 'B-B1-03', null)) && !('B-B1-03' in RL.remove(before, 'B-B1-03')) && 'B-B1-03' in before);
	check('get: a copy, or a blank entry', same(RL.get(before, 'nope'), RL.blank()) && RL.get(before, 'B-B1-03') !== before['B-B1-03'] && RL.inLog(before, 'B-B1-03') && !RL.inLog(before, 'nope') && !RL.inLog(before, 'toString'));
	check('changedIds: which books differ', same(RL.changedIds(before, changed), ['B-B1-03']) && same(RL.changedIds(before, RL.remove(before, 'K-A-01')), ['K-A-01']) && same(RL.changedIds(before, shuffleKeys(before)), []));
}
{
	// Two devices: the phone marked one book and removed another; meanwhile the
	// laptop rated a third and also touched the book the phone removed.
	const base = RL.normalize(sample).log;
	let phone = RL.set(base, 'K-C-01', { status: 'want' }, '2026-10-05');
	phone = RL.remove(phone, 'N-N4-02');
	let laptop = RL.set(base, 'K-A-01', { rating: 3 }, '2026-10-05');
	laptop = RL.set(laptop, 'N-N4-02', { note: 'changed on the laptop' }, '2026-10-05');
	const merged = RL.merge(laptop, phone, RL.changedIds(base, phone));
	check('merge: this device\'s changes go on top of the other device\'s', merged['K-C-01'].status === 'want' && merged['K-A-01'].rating === 3 && !('N-N4-02' in merged) && same(merged['B-B1-03'], base['B-B1-03']));
	check('merge: with nothing changed here, theirs wins whole', same(RL.merge(laptop, phone, []), laptop));
	check('merge: the result is a clean, sorted log', same(Object.keys(merged), Object.keys(merged).slice().sort()) && same(RL.normalize(merged).log, merged));
}

// ---- the public projection: examples ------------------------------------------------

{
	const none = JSON.parse(JSON.stringify(sample));
	for (const id of Object.keys(none)) none[id].public = { status: false, dates: false, rating: false };
	check('projection: by default nothing is public', same(RL.publicProjection(none), { version: 1, books: {} }) && RL.publicText(none) === '{\n\t"version": 1,\n\t"books": {}\n}\n');
	check('projection: a log without any "public" object publishes nothing', same(RL.publicProjection({ 'A-A2-17': { status: 'read', rating: 5, note: 'n' } }).books, {}));
	const p = RL.publicProjection(sample);
	check('projection: only ticked fields, and only books with one', same(p, { version: 1, books: { 'A-A2-17': { status: 'reading' }, 'B-B1-03': { status: 'read', started: '2026-08-01', finished: '2026-08-20', rating: 5 }, 'N-N4-02': { started: '2026-05-02', finished: '2026-05-09' } } }));
	check('projection: the text has no note in it', !/drag|private thought|not for me|note/.test(RL.publicText(sample)));
	check('projection: a ticked box over an empty field adds nothing', same(RL.publicProjection({ 'K-A-01': { status: 'want', public: { status: false, dates: true, rating: true } } }).books, {}));
	check('projection: knownIds limits it to books of the catalogue', same(Object.keys(RL.publicProjection(sample, { knownIds: ['B-B1-03', 'K-A-01'] }).books), ['B-B1-03']) && same(Object.keys(RL.publicProjection(sample, { knownIds: { 'N-N4-02': true, 'A-A2-17': false } }).books), ['N-N4-02']) && same(RL.publicProjection(sample, { knownIds: [] }).books, {}));
	const s = RL.publicSummary(sample);
	check('summary: counts per field and the rows', s.books === 3 && s.status === 2 && s.dates === 2 && s.rating === 1 && s.rows.length === 3 && same(s.rows[0], { id: 'A-A2-17', status: 'reading', started: null, finished: null, rating: null }));
	check('summary: what stays behind', s.inLog === 4 && s.keptPrivate === 1 && s.notesKeptPrivate === 3 && same(s.unknown, []));
	check('summary: ticked books that are not in the catalogue are listed, not published', same(RL.publicSummary(sample, { knownIds: ['B-B1-03'] }).unknown, ['A-A2-17', 'N-N4-02']) && RL.publicSummary(sample, { knownIds: ['B-B1-03'] }).books === 1);
	check('readPublic: reads back what publicText wrote', same(RL.readPublic(RL.publicText(sample)), p));
	check('readPublic: checks every value again and drops the rest', same(RL.readPublic(JSON.stringify({ books: { 'A-A2-17': { status: 'read', note: 'leak', rating: 9, started: 'soon' }, 'bad id': { status: 'read' }, 'K-A-01': { note: 'only a note' } } })), { version: 1, books: { 'A-A2-17': { status: 'read' } } }));
	check('readPublic: not such a file gives null', RL.readPublic('nope') === null && RL.readPublic('[]') === null && RL.readPublic('{"books": []}') === null && RL.readPublic('') === null);
	const next = RL.publicProjection(RL.set(RL.set(RL.remove(sample, 'N-N4-02'), 'B-B1-03', { rating: 4 }), 'K-A-01', { public: { status: true } }));
	check('diffPublic: added, changed, removed, same', same(RL.diffPublic(p, next), { added: ['K-A-01'], removed: ['N-N4-02'], changed: ['B-B1-03'], same: 1 }) && same(RL.diffPublic(null, p), { added: ['A-A2-17', 'B-B1-03', 'N-N4-02'], removed: [], changed: [], same: 0 }) && same(RL.diffPublic(p, p), { added: [], removed: [], changed: [], same: 3 }));
}

// ---- the public projection: properties ------------------------------------------------

const PUBLIC_KEYS = ['status', 'started', 'finished', 'rating'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Everything that would be wrong with `text` as the public file of `log`.
//   secrets: strings that must not occur anywhere in the text
//   expect:  for well-formed logs, { id: { field: value } } of exactly what may be there
function violations(text, { secrets = [], expect = null, knownIds = null } = {}) {
	const out = [];
	for (const s of secrets) if (s && text.includes(s)) out.push(`the text contains the private string ${JSON.stringify(s)}`);
	let data;
	try {
		data = JSON.parse(text);
	} catch (e) {
		return out.concat('the text is not JSON');
	}
	if (!same(Object.keys(data), ['version', 'books']) || data.version !== 1) out.push('top level is not { version: 1, books }');
	const books = data.books && typeof data.books === 'object' && !Array.isArray(data.books) ? data.books : {};
	if (!same(Object.keys(books), Object.keys(books).slice().sort())) out.push('ids are not sorted');
	for (const [id, b] of Object.entries(books)) {
		if (!RL.isId(id)) out.push(`bad id ${JSON.stringify(id)}`);
		if (knownIds && !knownIds.includes(id)) out.push(`${id} is not in the catalogue`);
		if (!b || typeof b !== 'object' || Array.isArray(b) || !Object.keys(b).length) {
			out.push(`${id}: not an object with fields`);
			continue;
		}
		for (const [k, v] of Object.entries(b)) {
			if (!PUBLIC_KEYS.includes(k)) out.push(`${id}: unexpected field ${JSON.stringify(k)}`);
			else if (k === 'status' && !RL.STATUSES.includes(v)) out.push(`${id}: bad status`);
			else if ((k === 'started' || k === 'finished') && !(typeof v === 'string' && DATE_RE.test(v))) out.push(`${id}: bad date`);
			else if (k === 'rating' && ![1, 2, 3, 4, 5].includes(v)) out.push(`${id}: bad rating`);
		}
	}
	if (expect) {
		if (!same(Object.keys(books), Object.keys(expect).sort())) out.push(`books ${Object.keys(books)} instead of ${Object.keys(expect).sort()}`);
		for (const id of Object.keys(expect)) {
			for (const k of PUBLIC_KEYS) {
				const got = books[id] ? books[id][k] : undefined;
				if (got !== expect[id][k]) out.push(`${id}.${k}: ${JSON.stringify(got)} instead of ${JSON.stringify(expect[id][k])}`);
			}
		}
	}
	return out;
}

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const randomId = () => `${pick(LETTERS)}-${pick(LETTERS)}${int(9) + 1}-${String(int(40) + 1).padStart(2, '0')}`;
const randomDate = () => `${1990 + int(60)}-${String(int(12) + 1).padStart(2, '0')}-${String(int(28) + 1).padStart(2, '0')}`;
// A private string no public file could contain by accident: it has characters
// that no id, status, date or number has.
let secretCount = 0;
const secret = () => `§note ${++secretCount} ${Math.floor(rnd() * 1e9).toString(36)}§`;

// A: well-formed logs. The projection must be exactly the ticked, filled fields.
{
	const N = 3000;
	let bad = 0;
	let firstBad = '';
	let unstable = 0;
	let published = 0;
	let withheld = 0;
	for (let i = 0; i < N; i++) {
		const log = {};
		const expect = {};
		const secrets = [];
		const n = int(13);
		for (let j = 0; j < n; j++) {
			const id = randomId();
			const e = {
				status: chance(0.85) ? pick(RL.STATUSES) : null,
				started: chance(0.6) ? randomDate() : null,
				finished: chance(0.4) ? randomDate() : null,
				rating: chance(0.5) ? int(5) + 1 : null,
				note: chance(0.7) ? secret() : '',
				public: { status: chance(0.4), dates: chance(0.4), rating: chance(0.4) },
			};
			if (e.note) secrets.push(e.note);
			if (!e.status && !e.started && !e.finished && !e.rating && !e.note) continue;
			log[id] = e;
			const pub = {};
			if (e.public.status && e.status) pub.status = e.status;
			if (e.public.dates && e.started) pub.started = e.started;
			if (e.public.dates && e.finished) pub.finished = e.finished;
			if (e.public.rating && e.rating) pub.rating = e.rating;
			if (Object.keys(pub).length) expect[id] = pub;
			else delete expect[id];
			for (const k of ['status', 'started', 'finished', 'rating']) {
				if (e[k] === null) continue;
				if (k in pub) published++;
				else withheld++;
			}
		}
		const text = RL.publicText(log);
		const v = violations(text, { secrets, expect });
		if (v.length) {
			bad++;
			if (!firstBad) firstBad = `log ${i}: ${v[0]}`;
		}
		// Stable: the same bytes again, from another key order, and after a save and a load.
		if (RL.publicText(log) !== text || RL.publicText(shuffleKeys(log)) !== text || RL.publicText(RL.parse(RL.serialize(log)).log) !== text || RL.publicText(RL.normalize(log).log) !== text) unstable++;
		if (!same(RL.readPublic(text), RL.publicProjection(log))) unstable++;
	}
	check(`property, ${N} well-formed logs: the public text is exactly the ticked fields, and never a note`, bad === 0, firstBad);
	check(`property, ${N} well-formed logs: the public text is stable (repeat, key order, save and load, read back)`, unstable === 0, `${unstable} differed`);
	check('property: the random logs really had both kinds of field', published > 2000 && withheld > 2000, `${published} published, ${withheld} withheld`);
}

// B: hostile logs. Whatever is in the log, the text is a valid public file and
// holds none of the private strings.
{
	const N = 3000;
	let bad = 0;
	let firstBad = '';
	let unstable = 0;
	let nonEmpty = 0;
	let notesKept = 0;
	const junk = (s) =>
		pick([
			() => s,
			() => 'read' + s,
			() => s + 'read',
			() => `2026-01-01${s}`,
			() => `2026-01-01\n${s}`,
			() => `${s}\n2026-01-01`,
			() => [s],
			() => ({ note: s, toString: undefined }),
			() => ({ status: 'read', value: s }),
			() => 5,
			() => '5' + s,
			() => true,
			() => null,
			() => 0,
			() => -3,
			() => 2.5,
			() => '2026-02-31',
			() => pick(RL.STATUSES),
			() => randomDate(),
			() => int(7),
		])();
	const tick = (s) => pick([true, true, true, false, 'true', 1, s, { yes: true }, [true], null, undefined]);
	for (let i = 0; i < N; i++) {
		const secrets = [];
		const mk = () => {
			const s = secret();
			secrets.push(s);
			return s;
		};
		const log = {};
		const n = int(10);
		for (let j = 0; j < n; j++) {
			const id = pick([randomId, randomId, randomId, () => mk(), () => `${randomId()} ${mk()}`, () => '__proto__', () => 'constructor', () => 'toString', () => ''])();
			const entry = pick([
				() => ({ status: junk(mk()), started: junk(mk()), finished: junk(mk()), rating: junk(mk()), note: mk(), public: { status: tick(mk()), dates: tick(mk()), rating: tick(mk()), note: true, [mk()]: true } }),
				() => ({ status: pick(RL.STATUSES), started: randomDate(), finished: randomDate(), rating: int(5) + 1, note: mk(), secret: mk(), review: { text: mk() }, public: { status: true, dates: true, rating: true, note: true, secret: true, review: true } }),
				() => ({ status: pick(RL.STATUSES), note: mk(), public: pick([true, 'all', mk(), [true, true, true], null, 7]) }),
				() => mk(),
				() => [mk(), { status: 'read', public: { status: true } }],
				() => null,
				() => ({ note: mk(), public: { status: true, dates: true, rating: true } }),
			])();
			Object.defineProperty(log, id, { value: entry, enumerable: true, writable: true, configurable: true });
		}
		// The same log as GitHub would hand it over: through JSON.
		const parsed = JSON.parse(JSON.stringify(log));
		for (const input of [log, parsed]) {
			const text = RL.publicText(input);
			const v = violations(text, { secrets });
			if (v.length) {
				bad++;
				if (!firstBad) firstBad = `log ${i}: ${v[0]}`;
			}
			if (text !== RL.publicText(shuffleKeys(input)) || text !== RL.publicText(RL.normalize(input).log)) unstable++;
			if (Object.keys(JSON.parse(text).books).length) nonEmpty++;
		}
		// The private file itself, by contrast, does hold the notes (the test would
		// be empty if the notes were lost on the way in).
		if (secrets.some((s) => RL.serialize(log).includes(s))) notesKept++;
	}
	check(`property, ${N} hostile logs (as objects and through JSON): the public text is a valid public file with no private string`, bad === 0, firstBad);
	check(`property, ${N} hostile logs: stable under key order and normalising`, unstable === 0, `${unstable} differed`);
	check('hostile logs: the private text does keep notes that the public text must not have', notesKept > N / 4, notesKept + ' of ' + N + ' private files held a secret');
	check('property: the hostile logs were not all empty', nonEmpty > 1000, `${nonEmpty} non-empty projections`);
	check('hostile logs: Object.prototype is untouched', Object.keys(Object.prototype).length === 0 && {}.status === undefined && {}.note === undefined);
}

// An id-shaped secret used as a key is the one string that travels: it is a
// book id. With the catalogue's ids given, it does not.
{
	const log = { 'my-secret-plan': { status: 'read', public: { status: true } }, 'A-A2-17': { status: 'read', public: { status: true } } };
	check('a made-up id is published without the catalogue, and never with it', 'my-secret-plan' in RL.publicProjection(log).books && same(Object.keys(RL.publicProjection(log, { knownIds: ['A-A2-17'] }).books), ['A-A2-17']));
}

// The checker is not vacuous: it catches a projection that copies the entry
// and one that ignores the boxes.
{
	const leakCopy = (log) => JSON.stringify({ version: 1, books: RL.normalize(log).log }, null, '\t') + '\n';
	const leakAll = (log) => {
		const clean = RL.normalize(log).log;
		const books = {};
		for (const id of Object.keys(clean)) {
			const e = clean[id];
			const b = {};
			if (e.status) b.status = e.status;
			if (e.started) b.started = e.started;
			if (e.finished) b.finished = e.finished;
			if (e.rating) b.rating = e.rating;
			if (Object.keys(b).length) books[id] = b;
		}
		return JSON.stringify({ version: 1, books }, null, '\t') + '\n';
	};
	const expect = { 'A-A2-17': { status: 'reading' }, 'B-B1-03': { status: 'read', started: '2026-08-01', finished: '2026-08-20', rating: 5 }, 'N-N4-02': { started: '2026-05-02', finished: '2026-05-09' } };
	const secrets = Object.values(sample).map((e) => e.note).filter(Boolean);
	check('the checker accepts the real projection of the sample', violations(RL.publicText(sample), { secrets, expect }).length === 0);
	check('the checker catches a projection that copies whole entries', violations(leakCopy(sample), { secrets, expect }).some((v) => /private string/.test(v)) && violations(leakCopy(sample), { secrets, expect }).some((v) => /unexpected field/.test(v)));
	check('the checker catches a projection that ignores the boxes', violations(leakAll(sample), { secrets, expect }).length > 0 && violations(leakAll(sample), { secrets, expect }).every((v) => !/private string/.test(v)));
}

// ---- statistics ----------------------------------------------------------------------

{
	const log = RL.normalize({
		a1: { status: 'read', finished: '2026-03-01', rating: 5, note: 'n' },
		a2: { status: 'read', finished: '2026-09-09', started: '2026-09-01', rating: 4, public: { status: true, rating: true } },
		a3: { status: 'read', finished: '2025-12-31', rating: 2 },
		a4: { status: 'read' },
		b1: { status: 'reading', started: '2026-10-01' },
		b2: { status: 'reading', started: '2026-10-04' },
		b3: { status: 'reading' },
		c1: { status: 'want' },
		d1: { status: 'abandoned', started: '2026-01-05', public: { dates: true } },
		e1: { note: 'just a note' },
	}).log;
	const s = RL.stats(log);
	check('stats: counts by status', s.total === 10 && same(s.byStatus, { reading: 3, want: 1, read: 4, abandoned: 1, none: 1 }));
	check('stats: ratings and notes', s.rated === 3 && s.averageRating === 3.67 && s.notes === 2 && RL.stats({}).averageRating === null);
	check('stats: finished by year counts read books with a finish date', same(s.finishedByYear, { 2025: 1, 2026: 2 }));
	check('stats: currently reading, newest start first, undated last', same(s.reading, ['b2', 'b1', 'b3']));
	check('stats: how much is public', s.publicBooks === 2 && same(s.publicFields, { status: 1, dates: 1, rating: 1 }));
	check('listByStatus: read by finish date, the rest by id', same(RL.listByStatus(log, 'read'), ['a2', 'a1', 'a3', 'a4']) && same(RL.listByStatus(log, 'want'), ['c1']) && same(RL.listByStatus(log, null), ['e1']) && same(RL.listByStatus(log, 'abandoned'), ['d1']));
	const books = [
		{ id: 'a1', g: 'Science', l: 'EN' },
		{ id: 'a2', g: 'Japanese literature', l: 'JA' },
		{ id: 'a3', g: 'Science', l: 'EN' },
		{ id: 'a4', g: 'Art & visual culture', l: 'EN' },
		{ id: 'b1', g: 'Science', l: 'EN' },
		{ id: 'zz', g: 'Science', l: 'EN' },
	];
	check('breakdown: read books by a property of the catalogue, largest first', same(RL.breakdown(log, books, (b) => b.g), [{ key: 'Science', count: 2 }, { key: 'Art & visual culture', count: 1 }, { key: 'Japanese literature', count: 1 }]) && same(RL.breakdown(log, books, (b) => b.l, 'reading'), [{ key: 'EN', count: 1 }]));
}

// ---- the finder ----------------------------------------------------------------------

const jp = (...codes) => String.fromCharCode(...codes);
{
	const KOKORO = jp(0x3053, 0x3053, 0x308d); // hiragana ko-ko-ro
	const VAGABOND = jp(0x30d0, 0x30ac, 0x30dc, 0x30f3, 0x30c9); // katakana ba-ga-bo-n-do
	const VAGABOND_HIRA = jp(0x3070, 0x304c, 0x307c, 0x3093, 0x3069);
	const VAGABOND_HALF = jp(0xff8a, 0xff9e, 0xff76, 0xff9e, 0xff8e, 0xff9e, 0xff9d, 0xff84, 0xff9e); // half-width katakana
	const SOSEKI = jp(0x590f, 0x76ee, 0x6f31, 0x77f3);
	const O_MACRON = jp(0x14d);
	const FULL_A = jp(0xff21, 0xff22, 0xff23); // full-width ABC
	check('fold: accents, case, apostrophes and punctuation', RL.fold(`S${O_MACRON}seki`) === 'soseki' && RL.fold("  John O'Leary: In Awe! ") === 'john oleary in awe' && RL.fold('Crime & Punishment (Vol. 2)') === 'crime punishment vol 2');
	check('fold: katakana, half-width katakana and hiragana meet', RL.fold(VAGABOND) === VAGABOND_HIRA && RL.fold(VAGABOND_HALF) === VAGABOND_HIRA && RL.fold(VAGABOND_HIRA) === VAGABOND_HIRA);
	check('fold: full-width letters become plain ones; kanji are kept', RL.fold(FULL_A) === 'abc' && RL.fold(SOSEKI) === SOSEKI && RL.fold(null) === '' && RL.fold(undefined) === '');

	const books = [
		{ id: 'x1', t: 'The Art of War', a: 'Sun Tzu', d: 'Ancient Chinese treatise on strategy.' },
		{ id: 'x2', t: 'War and Peace', a: 'Leo Tolstoy', d: 'Novel of the Napoleonic wars.' },
		{ id: 'x3', t: KOKORO, a: SOSEKI, d: 'Kokoro, the 1914 novel about Sensei and his secret.' },
		{ id: 'x4', t: 'Kokoro', a: `Natsume S${O_MACRON}seki`, d: 'English translation.' },
		{ id: 'x5', t: VAGABOND + ' 3', a: jp(0x4e95, 0x4e0a, 0x96c4, 0x5f66), d: 'Vagabond, the Musashi manga.' },
		{ id: 'x6', t: 'Party Politics', a: 'A. Warden', d: 'A study.' },
		{ id: 'x7', t: 'Untitled', a: '', d: '' },
	];
	const index = RL.makeIndex(books, { aliases: { [SOSEKI]: `Natsume S${O_MACRON}seki` } });
	const ids = (q, opts) => RL.search(index, q, opts).map((b) => b.id);
	check('search: an empty query returns everything in shelf order', same(ids(''), ['x1', 'x2', 'x3', 'x4', 'x5', 'x6', 'x7']) && same(ids('   '), ids('')));
	check('search: a title that starts with the word comes first', same(ids('war'), ['x2', 'x1', 'x6']), ids('war').join());
	check('search: every word must match, in any field', same(ids('war tolstoy'), ['x2']) && same(ids('tolstoy war'), ['x2']) && same(ids('war zebra'), []));
	check('search: an author is found under every spelling the catalogue knows', same(ids('soseki').sort(), ['x3', 'x4']) && same(ids(SOSEKI).sort(), ['x3', 'x4']) && same(ids('natsume').sort(), ['x3', 'x4']));
	check('search: Japanese titles by kana in either script, and by the description in English', same(ids(VAGABOND_HIRA), ['x5']) && same(ids(VAGABOND), ['x5']) && same(ids(VAGABOND_HALF), ['x5']) && same(ids('vagabond'), ['x5']) && same(ids(KOKORO), ['x3']));
	check('search: an exact title beats a longer one; the description counts least', ids('kokoro')[0] === 'x4' && same(ids('kokoro'), ['x4', 'x3']));
	check('search: accents and case in the query do not matter', same(ids(`S${O_MACRON}SEKI`).sort(), ['x3', 'x4']) && same(ids('ART OF WAR'), ['x1']));
	check('search: limit', same(ids('', { limit: 2 }), ['x1', 'x2']) && same(ids('war', { limit: 1 }), ['x2']));
	check('search: an empty index and a missing index are fine', same(RL.search([], 'x'), []) && same(RL.search(null, 'x'), []) && same(RL.makeIndex(null), []));
}

// The real catalogue, as the view uses it. These are properties of the data, not
// a list of titles, so they hold when the library changes.
{
	const library = JSON.parse(fs.readFileSync(path.join(repoRoot, 'assets', 'data', 'library.json'), 'utf8'));
	const Lib = require(path.join(repoRoot, 'misc', '_kit', 'library.js'));
	const books = library.books;
	const index = RL.makeIndex(books, { aliases: Lib.AUTHOR_ALIAS });
	check('catalogue: every book id is usable as a log key', books.length > 100 && books.every((b) => RL.isId(b.id)), books.filter((b) => !RL.isId(b.id)).slice(0, 3).map((b) => b.id).join());
	check('catalogue: ids are unique', new Set(books.map((b) => b.id)).size === books.length);
	const t0 = Date.now();
	let missTitle = [];
	let missAuthor = [];
	for (const b of books) {
		if (RL.fold(b.t)) {
			const top = RL.search(index, b.t);
			// the book itself, or another copy with the very same title, is first
			if (!top.length || RL.fold(top[0].t) !== RL.fold(b.t) || !top.some((x) => x.id === b.id)) missTitle.push(b.id);
		}
		if (RL.fold(b.a) && !RL.search(index, b.a).some((x) => x.id === b.id)) missAuthor.push(b.id);
	}
	const ms = Date.now() - t0;
	check(`catalogue: each of the ${books.length} books is found by its full title, at the top`, missTitle.length === 0, missTitle.slice(0, 5).join());
	check('catalogue: each book with an author is found by that author', missAuthor.length === 0, missAuthor.slice(0, 5).join());
	check('catalogue: a search over the whole library takes a few milliseconds', ms / (books.length * 2) < 20, `${(ms / (books.length * 2)).toFixed(2)} ms per search`);
	let aliasMiss = [];
	for (const [name, key] of Object.entries(Lib.AUTHOR_ALIAS)) {
		const byName = books.filter((b) => b.a === name);
		const found = new Set(RL.search(index, key).map((b) => b.id));
		for (const b of byName) if (!found.has(b.id)) aliasMiss.push(`${key} -> ${b.id}`);
		const byKey = books.filter((b) => b.a === key);
		const foundBack = new Set(RL.search(index, name).map((b) => b.id));
		for (const b of byKey) if (!foundBack.has(b.id)) aliasMiss.push(`${name} -> ${b.id}`);
	}
	check('catalogue: an author written in Japanese is found by the romanised name and the other way round', aliasMiss.length === 0, aliasMiss.slice(0, 5).join(' ; '));
	// A log over real ids projects only real ids.
	const log = {};
	for (const b of books.slice(0, 40)) log[b.id] = { status: 'read', rating: 3, note: 'n', public: { status: true } };
	log['not-in-the-catalogue'] = { status: 'read', public: { status: true } };
	const p = RL.publicProjection(log, { knownIds: books.map((b) => b.id) });
	check('catalogue: a log over real books projects those books only', Object.keys(p.books).length === 40 && !('not-in-the-catalogue' in p.books));
}

// ---- the notes view's helpers (desk/views/notes.js) ---------------------------------------

const notesPath = path.join(here, '..', 'views', 'notes.js');
const N = fs.existsSync(notesPath) ? require(notesPath) : null;
if (!N || typeof N.slugify !== 'function') {
	check('notes: desk/views/notes.js exports its helpers under Node', false, 'no helpers found');
} else {
	const O_MACRON = jp(0x14d);
	const KOKORO = jp(0x3053, 0x3053, 0x308d);
	check('slugify: lower case, dashes, no accents', N.slugify('Hello, World!') === 'hello-world' && N.slugify(`  S${O_MACRON}seki's  "Kokoro" -- notes `) === 'sosekis-kokoro-notes' && N.slugify('a/b\\c..d') === 'a-b-c-d');
	check('slugify: keeps letters of other scripts; never empty; never long', N.slugify(KOKORO) === KOKORO && N.slugify('') === 'note' && N.slugify('!!!') === 'note' && N.slugify('x'.repeat(200)).length <= 48 && !/-$/.test(N.slugify('word '.repeat(30))));
	check('slugify: nothing that could leave the folder', ['../../etc/passwd', '..', '.', 'a/../b', '\\\\server\\share', 'con.md'].every((s) => !/[\\/.]/.test(N.slugify(s))));
	const at = new Date(Date.UTC(2026, 9, 5, 14, 3, 22));
	check('pathFor: notes/<year>/<stamp>-<slug>.md, in UTC', N.pathFor(at, 'A first thought') === 'notes/2026/20261005T140322Z-a-first-thought.md' && N.pathFor(new Date(Date.UTC(2027, 0, 1, 0, 0, 0)), '') === 'notes/2027/20270101T000000Z-note.md');
	check('titleOf: the first line that says something, without Markdown marks', N.titleOf('\n\n## A heading\nmore') === 'A heading' && N.titleOf('- [ ] buy milk\nx') === 'buy milk' && N.titleOf('> quoted') === 'quoted' && N.titleOf('   ') === '' && N.titleOf('x'.repeat(300)).length <= 81);
	check('excerptOf: what follows the title, on one line', N.excerptOf('# Title\n\nFirst   line.\nSecond line.') === 'First line. Second line.' && N.excerptOf('only a title') === '');
	check('cleanTags: lower case, dashes, no duplicates, from a string or a list', same(N.cleanTags('Idea, #Reading list,idea,  ,x'), ['idea', 'reading-list', 'x']) && same(N.cleanTags(['A B', 'a-b', '[x]']), ['a-b', 'x']) && same(N.cleanTags(null), []));

	const fm = N.toFrontMatter({ created: '2026-10-05T14:03:22Z', updated: '2026-10-05T15:00:00Z', tags: ['idea'], pinned: true, archived: false }, { created: 'old', custom: 'kept', tags: ['old'] });
	check('toFrontMatter: the five fields in order, unknown ones kept after them', same(Object.keys(fm), ['created', 'updated', 'tags', 'pinned', 'archived', 'custom']) && fm.pinned === 'true' && fm.archived === 'false' && fm.custom === 'kept' && same(fm.tags, ['idea']));
	const meta = N.metaOf({ created: '2026-10-05T14:03:22Z', tags: ['Inbox', 'x y'], pinned: 'true', archived: 'no' }, 'notes/inbox/20261005T140322Z-ab.md');
	check('metaOf: reads the front matter', meta.created === '2026-10-05T14:03:22Z' && meta.updated === '2026-10-05T14:03:22Z' && same(meta.tags, ['inbox', 'x-y']) && meta.pinned === true && meta.archived === false && meta.inbox === true);
	const fromName = N.metaOf({}, 'notes/2025/20250314T091500Z-pi.md');
	check('metaOf: without front matter the date comes from the file name', fromName.created === '2025-03-14T09:15:00Z' && fromName.inbox === false && same(fromName.tags, []) && N.metaOf({}, 'notes/loose.md').created === '');

	const mk = (p, body, m) => Object.assign({ path: p, body, title: N.titleOf(body), tags: [], pinned: false, archived: false, inbox: /^notes\/inbox\//.test(p), created: '', updated: '' }, m);
	const notes = [
		mk('notes/2026/a.md', 'Groceries\nmilk, eggs', { updated: '2026-10-01T10:00:00Z', tags: ['home'] }),
		mk('notes/2026/b.md', `S${O_MACRON}seki reading plan\nKokoro first`, { updated: '2026-10-03T10:00:00Z', tags: ['reading'], pinned: true }),
		mk('notes/inbox/c.md', 'Call the bank', { updated: '2026-10-04T10:00:00Z', tags: ['inbox'] }),
		mk('notes/2025/d.md', 'Old idea about eggs', { updated: '2025-01-01T10:00:00Z', archived: true, tags: ['home'] }),
		mk('notes/2026/e.md', '', { updated: '2026-10-02T10:00:00Z', missing: true }),
	];
	const paths = (list) => list.map((n) => n.path.replace(/^notes\//, ''));
	check('filterNotes: "all" hides the archive; pinned first, then newest', same(paths(N.filterNotes(notes, {})), ['2026/b.md', 'inbox/c.md', '2026/e.md', '2026/a.md']));
	check('filterNotes: pinned, inbox, archived', same(paths(N.filterNotes(notes, { show: 'pinned' })), ['2026/b.md']) && same(paths(N.filterNotes(notes, { show: 'inbox' })), ['inbox/c.md']) && same(paths(N.filterNotes(notes, { show: 'archived' })), ['2025/d.md']));
	check('filterNotes: by tag', same(paths(N.filterNotes(notes, { tag: 'home' })), ['2026/a.md']) && same(paths(N.filterNotes(notes, { tag: 'home', show: 'archived' })), ['2025/d.md']));
	check('filterNotes: search over the text and the tags, every word, accents ignored', same(paths(N.filterNotes(notes, { q: 'eggs' })), ['2026/a.md']) && same(paths(N.filterNotes(notes, { q: 'soseki KOKORO' })), ['2026/b.md']) && same(paths(N.filterNotes(notes, { q: 'reading' })), ['2026/b.md']) && same(paths(N.filterNotes(notes, { q: 'eggs', show: 'archived' })), ['2025/d.md']) && same(paths(N.filterNotes(notes, { q: 'zebra' })), []));
	check('tagCounts: tags of the notes that are not archived, most used first', same(N.tagCounts(notes), [{ tag: 'home', count: 1 }, { tag: 'inbox', count: 1 }, { tag: 'reading', count: 1 }]));
	const draft = N.draftFrom({ body: '# A post idea\n\nFirst paragraph.\n', tags: ['inbox', 'ml'] }, '2026-10-05');
	check('draftFrom: a note becomes a title, a body without that heading, and tags without "inbox"', draft.title === 'A post idea' && draft.body === 'First paragraph.\n' && same(draft.tags, ['ml']) && draft.date === '2026-10-05' && draft.slug === 'a-post-idea');
	const plain = N.draftFrom({ body: 'Just a line\nand another', tags: [] }, '2026-10-05');
	check('draftFrom: a first line that is not a heading stays in the body', plain.title === 'Just a line' && plain.body === 'Just a line\nand another\n');
}

console.log(`\n${count - failed} of ${count} passed`);
process.exit(failed ? 1 : 0);
