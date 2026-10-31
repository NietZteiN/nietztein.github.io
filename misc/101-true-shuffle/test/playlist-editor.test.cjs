'use strict';
const assert = require('node:assert/strict');
const E = require('../playlist-editor.js');

function run() {
const original = ['a', 'b', 'c', 'd', 'e'];
assert.deepEqual(E.moveIds(original, ['b', 'c'], 'up'), ['b', 'c', 'a', 'd', 'e']);
assert.deepEqual(E.moveIds(original, ['b', 'c'], 'down'), ['a', 'd', 'b', 'c', 'e']);
assert.deepEqual(E.moveIds(original, ['d', 'b'], 'top'), ['b', 'd', 'a', 'c', 'e'], 'selected songs retain their playlist order');
assert.deepEqual(E.moveIds(original, ['b', 'd'], 'bottom'), ['a', 'c', 'e', 'b', 'd']);
assert.deepEqual(E.moveIds(original, ['b', 'd'], 'before', 'e'), ['a', 'c', 'b', 'd', 'e']);
assert.deepEqual(E.moveIds(original, ['b', 'd'], 'before', null), ['a', 'c', 'e', 'b', 'd']);
assert.deepEqual(E.moveIds(original, ['missing'], 'top'), original);
assert.deepEqual(E.moveIds(original, ['a', 'b'], 'up'), original, 'top boundary is stable');
assert.deepEqual(E.moveIds(original, ['d', 'e'], 'down'), original, 'bottom boundary is stable');
assert.deepEqual(original, ['a', 'b', 'c', 'd', 'e'], 'helpers do not mutate their input');
assert.deepEqual(E.fillVisibleOrder(['gone-1', 'a', 'gone-2', 'b', 'c'], ['c', 'a', 'b']), ['gone-1', 'c', 'gone-2', 'a', 'b'], 'unavailable IDs keep their slots');
assert.deepEqual(E.restoreRemoved(original, ['a', 'd', 'e', 'new'], ['b', 'c']), ['a', 'b', 'c', 'd', 'e', 'new']);
assert.deepEqual(E.restoreRemoved(original, ['a', 'd', 'new'], ['b']), ['a', 'b', 'd', 'new'], 'another later removal is not resurrected');
assert.deepEqual(E.restoreRemoved(original, ['a', 'b', 'c', 'new'], ['d', 'e']), ['a', 'b', 'c', 'd', 'e', 'new'], 'removed tail precedes later additions');
assert.deepEqual(E.restoreRemoved(['a', 'b'], ['new'], ['a', 'b']), ['a', 'b', 'new'], 'an emptied list restores before later additions');
assert.deepEqual(E.restoreRemoved(original, original.concat('new'), ['b']), original.concat('new'), 'already-restored songs are not duplicated');
for (const mode of ['top', 'bottom', 'up', 'down', 'before']) {
	const ids = Array.from({length: 300}, (_, i) => 'song-' + i);
	const moved = E.moveIds(ids, ids.filter((_, i) => i % 7 === 0), mode, ids[150]);
	assert.equal(new Set(moved).size, ids.length);
	assert.deepEqual([...moved].sort(), [...ids].sort(), mode + ' preserves every song exactly once');
}
}
module.exports = run;
if (require.main === module) {
	run();
	console.log('PASS playlist-editor: ordering, unavailable IDs, selection boundaries and merge-safe removal Undo');
}
