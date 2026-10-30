// Saved backup reads are pure and strict; applying a reviewed plan remains a
// separate store operation that rechecks current membership and keeps notes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const I = require('../assets/js/saved-import.js');
const { createStore, valid, keys } = require('../assets/js/saved-store.js');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const encode = (items, extra = {}) => JSON.stringify({ version: 1, items, ...extra });
const bookId = 'N-N5(手塚,吉田秋生)-32';
const note = '日本語と emoji 😀\nExact whitespace:  \n<script>literal note</script>\n' + 'x'.repeat(5000);
const timestamp = 'older legacy date that cannot be parsed';
const exported = encode([
	{ kind: 'book', id: bookId, note, addedAt: timestamp, title: '<img src=x onerror=alert(1)>', url: 'javascript:alert(1)', unresolved: true, position: -100 },
	{ kind: 'post', id: 'unresolved-post', note: 'Private local annotation', addedAt: '', title: ['unused'], url: { fetch: 'https://invalid.example/private' } },
	{ kind: 'publication', id: 'public-paper' },
	{ kind: 'experiment', id: '07-grokking-microscope' }
], { exportedAt: 123, extra: { ignored: true } });
const parsed = I.parse(exported);
assert.equal(parsed.originalCount, 4);
assert.equal(parsed.duplicates, 0);
assert.deepEqual(parsed.items, [
	{ kind: 'book', id: bookId, addedAt: timestamp, note },
	{ kind: 'post', id: 'unresolved-post', addedAt: '', note: 'Private local annotation' },
	{ kind: 'publication', id: 'public-paper', addedAt: '' },
	{ kind: 'experiment', id: '07-grokking-microscope' }
]);
assert.equal(parsed.items.some((item) => 'url' in item || 'title' in item || 'position' in item || 'unresolved' in item), false);
assert.equal(I.parse('\ufeff' + exported).items[0].note, note, 'A UTF-8 BOM is accepted without changing note text');

const duplicates = I.parse(encode([
	{ kind: 'book', id: bookId, note: '', title: 'ignored first' },
	{ kind: 'book', id: bookId, note: '', addedAt: '', title: 'ignored second', url: 'javascript:bad' },
	{ kind: 'post', id: 'one' }, { kind: 'post', id: 'one', note: '', addedAt: '' },
	{ kind: 'experiment', id: 'one', note: '', addedAt: '' }
]));
assert.equal(duplicates.originalCount, 5);
assert.equal(duplicates.duplicates, 2);
assert.equal(duplicates.items.length, 3, 'Duplicate identity includes kind');
assert.deepEqual(duplicates.duplicateRows.map((row) => [row.row, row.firstRow]), [[2, 1], [4, 3]]);
assert.deepEqual(duplicates.items[2], { kind: 'experiment', id: 'one' }, 'Empty experiment annotations normalize away');

function rejects(input, field, row = null) {
	let error;
	try { I.parse(typeof input === 'string' ? input : JSON.stringify(input)); } catch (caught) { error = caught; }
	assert.ok(error instanceof I.SavedImportError, 'Invalid input rejects the whole backup');
	assert.ok(error.errors.some((item) => item.field === field && item.row === row), error.message);
	assert.equal('items' in error, false, 'Invalid backups do not expose a partial restoration result');
	return error;
}
rejects('{broken', 'file');
rejects(null, 'file');
rejects([], 'file');
rejects({ version: 2, items: [] }, 'version');
rejects({ version: '1', items: [] }, 'version');
rejects({ version: 1, books: [] }, 'items');
rejects({ version: 1, items: null }, 'items');
rejects({ version: 1, items: [null] }, 'item', 1);
rejects({ version: 1, items: [[]] }, 'item', 1);
rejects({ version: 1, items: [{ kind: 'POST', id: 'one' }] }, 'kind', 1);
rejects({ version: 1, items: [{ kind: 'post', id: '../draft' }] }, 'id', 1);
rejects({ version: 1, items: [{ kind: 'book', id: 'line\nbreak' }] }, 'id', 1);
rejects({ version: 1, items: [{ kind: 'post', id: 42 }] }, 'id', 1);
for (const invalid of [null, 0, false, {}, []]) {
	rejects({ version: 1, items: [{ kind: 'book', id: bookId, note: invalid }] }, 'note', 1);
	rejects({ version: 1, items: [{ kind: 'book', id: bookId, addedAt: invalid }] }, 'addedAt', 1);
}
rejects({ version: 1, items: [{ kind: 'experiment', id: 'one', note: 'Cannot fit the ID-only provider' }] }, 'note', 1);
rejects({ version: 1, items: [{ kind: 'experiment', id: 'one', addedAt: '2026-10-30' }] }, 'addedAt', 1);
const conflictingNote = rejects({ version: 1, items: [{ kind: 'book', id: bookId, note: 'first' }, { kind: 'book', id: bookId, note: 'different' }] }, 'note', 2);
assert.match(conflictingNote.errors[0].message, /row 1/);
rejects({ version: 1, items: [{ kind: 'post', id: 'one', addedAt: 'first' }, { kind: 'post', id: 'one', addedAt: 'second' }] }, 'addedAt', 2);
const manyErrors = rejects({ version: 1, items: [{ kind: 'post', id: 'valid' }, { kind: 'unknown', id: 'bad' }, { kind: 'book', id: bookId, note: false }] }, 'kind', 2);
assert.equal(manyErrors.errors.length, 2);

const maxRows = Array.from({ length: I.MAX_ITEMS }, (_, i) => ({ kind: 'post', id: 'item-' + i }));
assert.equal(I.parse(encode(maxRows)).items.length, 10000);
rejects({ version: 1, items: maxRows.concat({ kind: 'post', id: 'extra' }) }, 'items');
const emojiFile = encode([{ kind: 'book', id: bookId, note: '😀' }]);
const atByteLimit = ' '.repeat(I.MAX_BYTES - Buffer.byteLength(emojiFile, 'utf8')) + emojiFile;
assert.equal(I.parse(atByteLimit).items[0].note, '😀', 'Limit counts UTF-8 bytes, including surrogate pairs');
rejects(' ' + atByteLimit, 'file');
rejects(encode([{ kind: 'book', id: bookId, note: '界'.repeat(Math.ceil(I.MAX_BYTES / 3)) }]), 'file');

const disk = new Map(); let writes = 0;
const store = createStore({ storage: { getItem: (key) => disk.get(key) ?? null, setItem: (key, value) => { writes++; disk.set(key, value); } } });
assert.equal(store.valid, valid, 'Browser and Node APIs expose the identical ID policy');
const original = structuredClone(parsed.items);
const initialPlan = I.plan(parsed.items, store.snapshot());
assert.equal(initialPlan.additionCount, 4);
assert.equal(initialPlan.alreadySavedCount, 0);
assert.equal(writes, 0, 'Parsing and preview planning never write to storage');
assert.deepEqual(parsed.items, original, 'Planning does not mutate the reviewed import');
store.restore([{ kind: 'book', id: bookId, note: 'Current local note always wins', addedAt: 'older than import' }]);
const freshPlan = I.plan(parsed.items, store.snapshot());
assert.deepEqual(freshPlan.alreadySaved, [{ kind: 'book', id: bookId }]);
assert.equal(freshPlan.additionCount, 3);
assert.equal(store.restore(initialPlan.additions, { source: 'saved-import' }), 3, 'Actual restore rechecks records saved after preview');
assert.equal(store.get('book', bookId).note, 'Current local note always wins');
assert.equal(store.get('book', bookId).addedAt, 'older than import', 'Imported addedAt never elects a fresher annotation');
assert.equal(store.has('post', 'unresolved-post'), true, 'Unresolved IDs are retained without fetching their metadata');
assert.equal(store.restore([{ kind: 'post', id: 'same-batch', note: 'first' }, { kind: 'post', id: 'same-batch', note: 'second' }]), 1);
assert.equal(store.get('post', 'same-batch').note, 'first', 'Bulk membership map keeps first addition and avoids duplicates');
assert.ok(JSON.parse(disk.get(keys.site)).items.every((item) => !('url' in item) && !('title' in item)));
const bulkDisk = new Map(); let bulkWrites = 0;
const bulk = createStore({ storage: { getItem: (key) => bulkDisk.get(key) ?? null, setItem: (key, value) => { bulkWrites++; bulkDisk.set(key, value); } } });
assert.equal(bulk.restore(maxRows, { source: 'saved-import' }), I.MAX_ITEMS, 'A maximum-size reviewed batch restores every distinct ID');
assert.equal(bulk.snapshot().length, I.MAX_ITEMS);
assert.equal(bulk.restore(maxRows, { source: 'saved-import' }), 0, 'Repeating a full backup adds no duplicates');
assert.equal(bulkWrites, 1, 'A batch writes its provider once and an already-saved batch does not rewrite it');
const getterMetadata = { kind: 'post', id: 'safe' };
Object.defineProperty(getterMetadata, 'title', { get() { throw new Error('Imported title was read'); } });
Object.defineProperty(getterMetadata, 'url', { get() { throw new Error('Imported URL was read'); } });
assert.equal(I.plan([getterMetadata], []).additions[0].id, 'safe');

const context = { SavedStore: { valid }, fetch() { throw new Error('No network allowed'); } };
Object.defineProperty(context, 'localStorage', { get() { throw new Error('No storage allowed'); } });
vm.runInNewContext(fs.readFileSync(path.join(root, 'assets/js/saved-import.js'), 'utf8'), context);
assert.equal(typeof context.SavedImport.parse, 'function');
assert.equal(context.SavedImport.parse(encode([{ kind: 'book', id: bookId, note }])).items[0].note, note);
assert.equal(context.SavedImport.plan([], []).additionCount, 0);
for (const [kind, id] of [['book', bookId], ['book', 'a/b opaque ID'], ['post', 'Uppercase'], ['post', 'one'], ['experiment', '../bad']]) {
	assert.equal((() => { try { I.parse(encode([{ kind, id }])); return true; } catch { return false; } })(), valid(kind, id));
}
console.log('PASS saved import: pure validation/planning, exact Unicode notes, opaque legacy timestamps, metadata isolation, strict rows/duplicates/limits, safe merge and late-state protection');
