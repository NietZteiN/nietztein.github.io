// Local collection compatibility, safe resolution and merge-safe Undo.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createStore, keys } = require('../assets/js/saved-store.js');
const { registryFor } = require('../assets/js/saved.js');
const date = '2026-10-29T12:00:00.000Z';
function memory(seed = {}) {
	const values = new Map(Object.entries(seed)); const writes = [];
	return { values, writes, getItem: (key) => values.get(key) ?? null, setItem: (key, value) => { writes.push(key); values.set(key, value); } };
}
const bookId = 'N-N5(手塚,吉田秋生)-32';
const note = 'Keep this exact note.\n日本語と & <literal markup>\n' + 'x'.repeat(4100);
const rawBooks = JSON.stringify({ version: 1, extra: 'preserve', items: [{ id: bookId, note, addedAt: date }, { id: 'other-book', note: 'Another note', addedAt: date }] });
const storage = memory({
	[keys.book]: rawBooks,
	[keys.experiment]: JSON.stringify(['04-obfuscation-playground', 'unlisted-existing-slug']),
	[keys.site]: JSON.stringify({ version: 1, items: [{ kind: 'post', id: 'latentland', addedAt: date, url: 'javascript:bad', title: 'Untrusted' }, { kind: 'book', id: bookId }, { kind: 'experiment', id: 'forged-experiment' }] })
});
const store = createStore({ storage, now: () => date });
assert.equal(storage.writes.length, 0, 'Reading legacy data does not migrate or rewrite it');
assert.equal(store.snapshot().length, 5, 'Each legacy provider remains authoritative; forged kinds in the site key are excluded');
assert.equal(store.get('book', bookId).note, note, 'Long Unicode notes are preserved exactly');
assert.equal(store.get('post', 'latentland').url, undefined, 'Stored arbitrary links are never collection metadata');
assert.equal(store.get('post', 'latentland').title, undefined);
const events = []; store.subscribe((detail) => events.push(detail));
assert.equal(store.toggle('publication', 'public-paper', { source: 'test' }), true);
assert.deepEqual(storage.writes, [keys.site], 'A paper save does not rewrite books or experiment favorites');
assert.equal(storage.values.get(keys.book), rawBooks);
assert.equal(events.at(-1).source, 'test');
assert.deepEqual(events.at(-1).changed, [{ kind: 'publication', id: 'public-paper' }]);
const removed = store.remove('book', bookId, { source: 'hub' });
assert.equal(removed.note, note);
assert.equal(JSON.parse(storage.values.get(keys.book)).extra, 'preserve', 'Other schema fields survive edits');
assert.equal(store.restore([removed], { source: 'hub' }), 1);
assert.equal(store.get('book', bookId).note, note);
assert.deepEqual(JSON.parse(storage.values.get(keys.book)).items.map((item) => item.id), [bookId, 'other-book'], 'Undo restores the original order');
store.remove('book', bookId);
const newer = [{ id: bookId, note: 'A newer note from another view', addedAt: date }, { id: 'other-book', note: 'Another note', addedAt: date }];
storage.setItem(keys.book, JSON.stringify({ version: 1, items: newer }));
store.refresh({ source: 'storage' });
assert.equal(store.restore([removed]), 0);
assert.equal(store.get('book', bookId).note, newer[0].note, 'Undo never overwrites a newer existing note');
assert.equal(store.toggle('post', '../drafts/private'), false);
assert.equal(store.toggle('unknown', 'latentland'), false);
const beforeClear = store.snapshot();
const cleared = store.clear({ source: 'hub' });
assert.equal(store.snapshot().length, 0);
store.toggle('post', 'newer-post');
store.adoptLegacy('book', [{ id: bookId, note: 'New after clear', addedAt: date }], { source: 'reading-shelf', persistent: false });
assert.equal(store.restore(cleared), beforeClear.length - 1);
assert.equal(store.has('post', 'newer-post'), true, 'Undo merges with saves made after a clear');
assert.equal(store.get('book', bookId).note, 'New after clear');
const allAgain = store.clear(); store.restore(allAgain);
assert.equal(store.snapshot().filter((item) => item.kind === 'experiment').length, 2);

const corruptStorage = memory({ [keys.book]: '{not valid json' });
const corrupt = createStore({ storage: corruptStorage });
corrupt.toggle('book', bookId); corrupt.refresh();
assert.equal(corrupt.has('book', bookId), true);
assert.equal(corruptStorage.values.get(keys.book), '{not valid json', 'Corrupt original bytes are left untouched');
assert.equal(corrupt.status().persistent, false);
corrupt.adoptLegacy('book', [{ id: bookId, note: 'New memory note', addedAt: date }], { source: 'reading-shelf', persistent: false });
corrupt.refresh();
assert.equal(corruptStorage.values.get(keys.book), '{not valid json', 'Failed legacy adoption cannot remove corrupt-byte protection');
assert.equal(corrupt.status().issues.find((issue) => issue.provider === 'book').reason, 'corrupt');
assert.equal(corrupt.get('book', bookId).note, 'New memory note');
corrupt.adoptLegacy('book', [{ id: bookId, note: 'New memory note', addedAt: date }], { source: 'reading-shelf', persistent: true }); corrupt.refresh();
assert.equal(corruptStorage.values.get(keys.book), '{not valid json', 'A bridge flag alone cannot acknowledge unreadable disk data');
corruptStorage.values.set(keys.book, JSON.stringify({ version: 1, items: [{ id: 'recovered-book', note: 'Recovered externally', addedAt: date }] })); corrupt.refresh();
assert.equal(corrupt.status().persistent, true, 'A valid external replacement allows safe merged persistence again');
assert.equal(corrupt.get('book', bookId).note, 'New memory note');
assert.equal(corrupt.get('book', 'recovered-book').note, 'Recovered externally');
const failedStorage = memory({ [keys.book]: rawBooks });
failedStorage.setItem = () => { throw new Error('quota'); };
const failed = createStore({ storage: failedStorage, now: () => date });
failed.remove('book', bookId); failed.refresh();
assert.equal(failed.has('book', bookId), false, 'A failed write is not reverted by stale disk data on refresh');
failed.adoptLegacy('experiment', ['04-obfuscation-playground'], { source: 'misc', persistent: false });
failed.refresh(); assert.equal(failed.has('experiment', '04-obfuscation-playground'), true);
assert.equal(failed.status().persistent, false);
const unavailable = createStore({ storage: () => { throw new Error('blocked'); }, now: () => date });
unavailable.toggle('post', 'latentland'); unavailable.refresh();
assert.equal(unavailable.has('post', 'latentland'), true);

// Rebase unsaved local operations over changes from another document. A failed
// write must not turn a later storage event into silent loss or a false success.
const pendingDisk = memory(); let pendingFails = true;
const pendingWrite = pendingDisk.setItem;
pendingDisk.setItem = (key, value) => { if (pendingFails) throw new Error('quota'); pendingWrite(key, value); };
const pending = createStore({ storage: pendingDisk, now: () => date });
pending.toggle('post', 'local-pending');
pendingDisk.values.set(keys.site, JSON.stringify({ version: 1, items: [{ kind: 'post', id: 'other-tab', addedAt: date }] }));
pending.refresh({ source: 'storage' });
assert.equal(pending.has('post', 'local-pending'), true, 'Changed external storage retains a memory-only addition');
assert.equal(pending.has('post', 'other-tab'), true, 'External additions are merged');
assert.equal(pending.status().persistent, false, 'An unwritten local addition is still reported as nonpersistent');
pendingDisk.values.set(keys.site, JSON.stringify({ version: 1, items: [{ kind: 'post', id: 'other-tab', addedAt: date }, { kind: 'post', id: 'another-tab', addedAt: date }] }));
pending.refresh();
assert.equal(pending.has('post', 'local-pending'), true, 'Rebasing again retains the outstanding operation');
pendingDisk.values.set(keys.site, JSON.stringify({ version: 1, items: [{ kind: 'post', id: 'local-pending', addedAt: date }, { kind: 'post', id: 'other-tab', addedAt: date }] }));
pending.refresh();
assert.equal(pending.has('post', 'another-tab'), false, 'An unrelated remote deletion does not become a local intention');
pendingDisk.values.set(keys.site, JSON.stringify({ version: 1, items: [{ kind: 'post', id: 'other-tab', addedAt: date }, { kind: 'post', id: 'another-tab', addedAt: date }] }));
pending.refresh();
assert.equal(pending.has('post', 'local-pending'), true, 'Temporary remote agreement cannot acknowledge a pending addition');
pendingFails = false; pending.refresh();
assert.equal(pending.status().persistent, true);
assert.deepEqual(JSON.parse(pendingDisk.values.get(keys.site)).items.map((item) => item.id).sort(), ['another-tab', 'local-pending', 'other-tab']);
pendingDisk.values.set(keys.site, JSON.stringify({ version: 1, items: [{ kind: 'post', id: 'other-tab', addedAt: date }] })); pending.refresh();
assert.equal(pending.has('post', 'local-pending'), false, 'A successful write clears the addition journal so later remote changes apply');

const removalDisk = memory({ [keys.site]: JSON.stringify({ version: 1, items: [{ kind: 'post', id: 'removed', addedAt: date }] }), [keys.experiment]: JSON.stringify(['04-obfuscation-playground']) });
let removalFails = true; const removalWrite = removalDisk.setItem;
removalDisk.setItem = (key, value) => { if (removalFails) throw new Error('quota'); removalWrite(key, value); };
const removals = createStore({ storage: removalDisk });
removals.remove('post', 'removed'); removals.remove('experiment', '04-obfuscation-playground');
removalDisk.values.set(keys.site, JSON.stringify({ version: 1, items: [{ kind: 'post', id: 'removed', addedAt: date }, { kind: 'post', id: 'remote-new', addedAt: date }] }));
removalDisk.values.set(keys.experiment, JSON.stringify(['04-obfuscation-playground', '07-grokking-microscope']));
removals.refresh();
assert.equal(removals.has('post', 'removed'), false, 'A remote snapshot cannot resurrect a pending removal');
assert.equal(removals.has('experiment', '04-obfuscation-playground'), false, 'Legacy favorites retain removal tombstones');
assert.equal(removals.has('post', 'remote-new'), true);
assert.equal(removals.has('experiment', '07-grokking-microscope'), true);
assert.equal(removals.status().persistent, false);
removalDisk.values.set(keys.site, JSON.stringify({ version: 1, items: [{ kind: 'post', id: 'remote-new', addedAt: date }] })); removals.refresh();
removalDisk.values.set(keys.site, JSON.stringify({ version: 1, items: [{ kind: 'post', id: 'removed', addedAt: date }, { kind: 'post', id: 'remote-new', addedAt: date }] })); removals.refresh();
assert.equal(removals.has('post', 'removed'), false, 'Temporary remote agreement cannot acknowledge a pending removal');
removalFails = false; removals.refresh();
assert.deepEqual(JSON.parse(removalDisk.values.get(keys.site)).items.map((item) => item.id), ['remote-new']);
assert.deepEqual(JSON.parse(removalDisk.values.get(keys.experiment)), ['07-grokking-microscope']);

const noteDisk = memory({ [keys.book]: JSON.stringify({ version: 1, items: [{ id: bookId, note: 'Original', addedAt: date }] }) });
let noteFails = true; const noteWrite = noteDisk.setItem;
noteDisk.setItem = (key, value) => { if (noteFails) throw new Error('quota'); noteWrite(key, value); };
const notes = createStore({ storage: noteDisk });
notes.adoptLegacy('book', [{ id: bookId, note: 'Pending local note', addedAt: date }], { source: 'reading-shelf', persistent: false });
const remoteDate = '2026-10-29T13:00:00.000Z';
noteDisk.values.set(keys.book, JSON.stringify({ version: 1, extra: 'remote metadata', items: [{ id: bookId, note: 'Remote edit', addedAt: remoteDate }, { id: 'remote-book', note: 'Remote book note', addedAt: date }] }));
notes.refresh();
assert.equal(notes.get('book', bookId).note, 'Pending local note', 'Pending local note text survives an external edit');
assert.equal(notes.get('book', bookId).addedAt, remoteDate, 'An unrelated remote field is retained');
assert.equal(notes.get('book', 'remote-book').note, 'Remote book note');
assert.equal(notes.status().persistent, false);
noteDisk.values.set(keys.book, JSON.stringify({ version: 1, extra: 'remote metadata', items: [{ id: bookId, note: 'Pending local note', addedAt: remoteDate }, { id: 'remote-book', note: 'Remote book note', addedAt: date }] })); notes.refresh();
noteDisk.values.set(keys.book, JSON.stringify({ version: 1, extra: 'remote metadata', items: [{ id: bookId, note: 'Remote reversal', addedAt: remoteDate }, { id: 'remote-book', note: 'Remote book note', addedAt: date }] })); notes.refresh();
assert.equal(notes.get('book', bookId).note, 'Pending local note', 'Temporary remote agreement cannot acknowledge a pending note field');
noteFails = false; notes.refresh();
assert.equal(notes.status().persistent, true);
assert.equal(JSON.parse(noteDisk.values.get(keys.book)).extra, 'remote metadata');
assert.equal(JSON.parse(noteDisk.values.get(keys.book)).items.find((item) => item.id === bookId).note, 'Pending local note');

const registry = registryFor(
	[{ id: 'paper', title: 'A paper', authorsText: 'A. Author', year: 2026 }],
	[{ slug: 'post', title: 'A post', file: 'post.md' }, { slug: 'private', title: 'Draft', file: '../drafts/private.md' }],
	{ toys: [{ slug: 'live', title: 'Live', status: 'live', surfaces: ['views'] }, { slug: 'unfinished', title: 'WIP', status: 'wip', surfaces: ['grid'] }, { slug: 'unlisted', title: 'Hidden', status: 'live', surfaces: [] }] },
	{ books: [{ id: bookId, t: 'Base title', a: 'An author' }] },
	{ books: [{ id: bookId, t: 'Must not override the base catalogue' }, { id: 'new-book', t: 'An additional book' }] }
);
assert.equal(registry['book:' + bookId].title, 'Base title');
assert.equal(registry['book:new-book'].title, 'An additional book', 'Additional catalogue books can be resolved');
assert.equal(registry['experiment:live'].title, 'Live');
assert.equal(registry['experiment:unfinished'], undefined);
assert.equal(registry['experiment:unlisted'], undefined);
assert.equal(registry['post:private'], undefined);
assert.equal(registry['publication:paper'].title, 'A paper');
assert.deepEqual(Object.keys(registryFor(null, null, null, null, null)), []);
console.log('PASS saved collection: legacy compatibility, exact notes/order, safe IDs, Undo, pending-operation rebasing/recovery, storage failures, and public catalogue additions');
