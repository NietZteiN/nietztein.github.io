module.exports = function (h) {
	var L = require('../library.js'), E = require('../edits.js');
	h.describe('liked dates', function () {
		var lib = L.create();
		L.upsert(lib, [{ id: 'a', title: 'A - First', channel: 'A' }, { id: 'b', title: 'A - Second', channel: 'A' }], { playlistId: 'p', now: 1 });
		L.edit(lib, 'a', { rating: 4, at: 1000 });
		var joined = lib.tracks.a.likedAt;
		h.eq(joined, lib.tracks.a.stateAt, 'Crossing into Liked stamps its join time');
		L.edit(lib, 'a', { rating: 5, at: 2000 });
		L.edit(lib, 'a', { blocked: true, at: 3000 });
		h.eq(lib.tracks.a.likedAt, joined, 'Changing liked stars or blocking preserves join time');
		var undo = E.keep({ L: L, lib: function () { return lib; }, changed: function () {}, say: function () {} }, ['a']);
		L.edit(lib, 'a', { rating: 3, at: 4000 });
		h.eq(lib.tracks.a.likedAt, null, 'Unliking clears join time');
		undo();
		h.eq(lib.tracks.a.likedAt, joined, 'Rating Undo restores the old place in Liked');
		L.edit(lib, 'a', { rating: 0, at: 5000 });
		L.editMany(lib, ['a', 'b'], { rating: 5, at: 6000 });
		h.eq([lib.tracks.a.likedAt, lib.tracks.b.likedAt], [new Date(6000).toISOString(), new Date(6000).toISOString()], 'Bulk ratings stamp new likes');
		h.eq(L.load(JSON.parse(JSON.stringify(lib))).tracks.a.likedAt, lib.tracks.a.likedAt, 'Join time survives storage round-trip');
		var legacy = JSON.parse(JSON.stringify(lib)); delete legacy.tracks.a.likedAt;
		h.eq(L.load(legacy).tracks.a.likedAt, null, 'Older liked songs keep an unknown join time');
	});
};
