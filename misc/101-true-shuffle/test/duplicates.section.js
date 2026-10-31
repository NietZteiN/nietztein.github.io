module.exports = function (h) {
	var L = require('../library.js'), D = require('../duplicates.js');
	function fixture() {
		var lib = L.create();
		L.upsert(lib, ['a', 'b', 'c', 'live-a', 'live-b', 'other'].map(function (id) {
			return { id: id, title: 'Band - Signal', channel: 'Channel ' + id, durationSec: id === 'b' ? 181 : 180, embeddable: true };
		}), { playlistId: 'p', now: 1 });
		['a', 'b', 'c', 'live-a', 'live-b', 'other'].forEach(function (id) {
			L.edit(lib, id, { artist: 'Band', title: id === 'other' ? 'Another song' : 'Signal', version: id.indexOf('live') === 0 ? 'live' : '', rating: id === 'a' ? 5 : 2, at: 2 });
			lib.tracks[id].plays = id === 'a' ? 12 : 3;
		});
		L.edit(lib, 'c', { blocked: true, at: 3 });
		return lib;
	}
	h.describe('duplicates', function () {
		var lib = fixture(), group = D.groups(lib).filter(function (g) { return g.ids.indexOf('a') >= 0; })[0];
		h.eq(group.ids, ['a', 'b', 'c'], 'Default grouping keeps live versions apart from original uploads');
		h.eq(D.groups(lib).length, 2, 'Original and live copies form separate groups');
		h.eq(D.counts(lib), { all: 2, needsDecision: 2, resolved: 0, unavailable: 0, copies: 5 }, 'Counts describe groups, not a flat list of songs');
		h.eq(D.groups(lib, ['a', 'c'])[0].ids, ['a', 'c'], 'Focus keeps only the copies actually shown');
		h.eq(D.groups(lib, ['a']).length, 0, 'One copy in Focus is not a duplicate group');
		var before = JSON.parse(JSON.stringify(lib)), applied = D.prefer(lib, group.key, 'b', { now: function () { return 100; } });
		h.eq(applied.ids, ['a'], 'Only block states that differ are changed');
		h.eq(group.ids.map(function (id) { return lib.tracks[id].blocked; }), [true, false, true], 'Preferred copy stays allowed; other copies are blocked');
		h.eq(lib.tracks.c.stateAt, before.tracks.c.stateAt, 'Already blocked alternatives keep their existing state timestamp');
		h.eq(D.counts(lib).needsDecision, 1, 'A resolved group leaves the default needs-choice count');
		var chosenAt = lib.tracks.a.stateAt;
		L.edit(lib, 'a', { rating: 4, work: 'An intervening correction', at: 200 });
		lib.tracks.a.channel = 'Refreshed channel'; lib.tracks.a.plays = 99;
		var back = applied.undo();
		h.eq(back, ['a'], 'Undo reports only affected surviving block states');
		h.eq(group.ids.map(function (id) { return lib.tracks[id].blocked; }), [false, false, true], 'Undo restores the exact mixed prior block states');
		h.ok(lib.tracks.a.stateAt > chosenAt && Date.parse(lib.tracks.a.stateAt) > 200, 'Undo stamps a fresh change even if the supplied clock is behind later changes');
		h.eq([lib.tracks.a.rating, lib.tracks.a.work, lib.tracks.a.channel, lib.tracks.a.plays], [4, 'An intervening correction', 'Refreshed channel', 99], 'Timestamped block edits do not rederive or erase intervening metadata');
		h.eq(applied.undo(), [], 'Undo is safe to invoke twice');
		h.eq(lib.playlists, before.playlists, 'Choosing and undoing never alter playlists');
		h.eq(Object.keys(lib.tracks), Object.keys(before.tracks), 'Choosing and undoing never remove songs');
		h.eq(lib.tracks.b, before.tracks.b, 'An unchanged preferred record is untouched');
		h.eq(D.prefer(lib, group.key, 'other'), null, 'A copy from another song is refused');
		lib.tracks.b.embeddable = false;
		var unavailable = JSON.stringify(lib);
		h.eq(D.prefer(lib, group.key, 'b'), null, 'An unavailable preferred copy is refused');
		h.eq(JSON.stringify(lib), unavailable, 'Refusing an unavailable copy makes no changes');
		lib = fixture(); group = D.groups(lib)[0];
		L.edit(lib, 'c', { blocked: false });
		var scoped = D.prefer(lib, group.key, 'a', { tracks: ['a', 'b'] });
		h.eq(scoped.ids, ['b'], 'Choosing in Focus changes only its visible copies');
		h.eq(lib.tracks.c.blocked, false, 'An outside copy keeps its block state');
		delete lib.tracks.b;
		h.eq(scoped.undo(), [], 'Undo never resurrects a record removed by another action');
		lib = fixture(); group = D.groups(lib)[0];
		L.editMany(lib, group.ids, { blocked: true });
		h.ok(D.groups(lib)[0].needsDecision, 'An available but fully blocked group needs a choice');
		var unblocked = D.prefer(lib, group.key, 'a');
		h.eq(unblocked.ids, ['a'], 'A blocked preferred copy is explicitly unblocked');
		unblocked.undo(); h.ok(lib.tracks.a.blocked, 'Undo restores the preferred copy previous blocked state too');
		group.ids.forEach(function (id) { lib.tracks[id].removed = true; });
		h.eq(D.counts(lib).unavailable, 1, 'Groups with no available copies remain reviewable in All groups');
		h.eq(D.groups(lib)[0].needsDecision, false, 'No impossible preference action is requested for an unavailable group');
	});
};
