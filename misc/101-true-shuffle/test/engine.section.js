// engine: the discovery engine end to end on a memory store, with stand-ins
// for match.js (names fold to letters) and for the page.
module.exports = function (h) {
	var path = require('path');
	var E = require(path.join(h.HERE, 'engine.js'));
	var F = require(path.join(h.HERE, 'finds.js'));
	var Fd = require(path.join(h.HERE, 'feeder.js'));
	var L = require(path.join(h.HERE, 'library.js'));
	var S = require(path.join(h.HERE, 'shuffle.js'));
	var Store = require(path.join(h.HERE, 'store.js'));

	function fold(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ''); }
	var M = {
		fold: fold,
		titleKeys: function (t, a) { return [fold(t), fold(a)].filter(function (k) { return k.length > 1; }); },
		artistKeys: function (c, n) { return [fold(c), fold(n)].filter(Boolean); },
		signature: function (x) { return { t: M.titleKeys(x.title, x.titleAlt), a: M.artistKeys(x.artist) }; },
		index: function (tracks) { return { tracks: tracks }; },
		inLibrary: function (ix, f) { var hit = (ix.tracks || []).filter(function (t) { return fold(t.title) === fold(f.title) && fold(t.artist) === fold(f.artist); })[0]; return hit ? { id: hit.id, score: 9 } : null; },
		bestVideo: function () { return null; },
		query: function (f) { return f.artist + ' ' + f.title; }
	};
	function wait(ms) { return new Promise(function (r) { setTimeout(r, ms || 0); }); }

	h.describe('engine', async function () {
		var store = Store.memory();
		var lib = L.create();
		L.upsert(lib, [{ id: 'aaaaaaaaaaa', title: 'Paper Lanterns - Blue Signal', channel: 'Paper Lanterns' }, { id: 'bbbbbbbbbbb', title: 'Glass Orchard - Winter Almanac', channel: 'Glass Orchard' }, { id: 'ccccccccccc', title: 'Neon Abacus - Counting Backwards', channel: 'Neon Abacus' }], { playlistId: 'PL1', now: Date.UTC(2026, 9, 1) });
		var calls = [];
		var app = {
			playNow: function (ids) { calls.push(['now'].concat(ids)); },
			queueNext: function (ids) { calls.push(['next'].concat(ids)); },
			queueLater: function (ids) { calls.push(['later'].concat(ids)); },
			startFeeder: function (fd, ids, ctx) { calls.push(['feeder', ctx.label].concat(ids)); },
			onLibrary: function (ids) { calls.push(['library'].concat(ids)); }
		};
		var used = 0;
		function make() {
			return E.create({
				L: L, S: S, M: M, F: F, Fd: Fd, lib: function () { return lib; }, store: store, cache: null, client: null,
				canRead: function () { return false; }, now: function () { return Date.UTC(2026, 9, 10, 12); }, rand: S.rng('engine'),
				quota: { used: function () { return used; }, daily: function () { return 10000; } },
				familiar: function (seed, n, avoid) { return Object.keys(lib.tracks).filter(function (id) { return avoid.indexOf(id) < 0; }).slice(0, n); },
				index: function () { return M.index(L.list(lib)); },
				queueIds: function () { return ['fffffffffff']; },
				app: app
			});
		}
		var en = make();
		await en.start();
		h.ok(en.started(), 'start: ready, with nothing stored yet');
		// play a find that carries its video: the light track exists, the page plays it now
		var f1 = { key: 'v:fffffffffff', videoId: 'fffffffffff', title: 'Harbour Lights', artist: 'Tin Lighthouse Trio', source: 'ytuploads', channel: 'Tin Lighthouse Trio' };
		var r = await en.play(f1, { mode: 'now' });
		h.eq([r.rung, calls[0]], ['known', ['now', 'fffffffffff']], 'play now: a find with an id plays at once');
		h.ok(en.isFound('fffffffffff') && en.track('fffffffffff').transient, 'play: the find has a light track');
		await en.play({ key: 'v:ggggggggggg', videoId: 'ggggggggggg', title: 'Low Tide', artist: 'Tin Lighthouse Trio' }, { mode: 'next' });
		h.eq(calls[1], ['next', 'ggggggggggg'], 'play next: through the page\'s queueNext');
		// a find the library has already: the user's own upload
		var mine = await en.play({ key: 'it:track:9', title: 'Blue Signal', artist: 'Paper Lanterns' }, { mode: 'later' });
		h.eq([mine.rung, calls[2]], ['library', ['later', 'aaaaaaaaaaa']], 'a find the library has plays the library\'s own track');
		// without a key or a sign-in a find with no id cannot be looked up
		var nk = await en.play({ key: 'it:track:10', title: 'Unknown Song', artist: 'Nobody' }, { mode: 'now' });
		h.eq([nk.none, nk.reason, calls.length], [true, 'needs-key', 3], 'no key and no sign-in: says so, plays nothing');
		// listening: a find finished twice joins the library
		en.listened('fffffffffff', { completed: true, listenedSec: 180, durationSec: 181, at: 1 });
		h.ok(!lib.tracks.fffffffffff, 'one finished listen: still a find');
		en.listened('fffffffffff', { completed: true, listenedSec: 180, durationSec: 181, at: 2 });
		h.ok(!!lib.tracks.fffffffffff && lib.tracks.fffffffffff.playlists[0] === F.DISCOVERED, 'finished twice: kept, in the playlist Discovered');
		h.eq(calls[calls.length - 1], ['library', 'fffffffffff'], 'the page is told to save it');
		h.eq(en.keep('ggggggggggg'), ['ggggggggggg'], 'keep: a like or Keep adds a find at once');
		// saved for later, hidden
		en.save({ key: 'it:track:11', title: 'Glass Avenue', artist: 'Glass Orchard' });
		en.save({ key: 'it:track:11', title: 'Glass Avenue', artist: 'Glass Orchard' });
		h.eq(en.saved().map(function (f) { return f.key; }), ['it:track:11'], 'save: once');
		en.unsave('it:track:11');
		h.eq(en.saved(), [], 'unsave');
		var undo = en.hide('artist', 'Tin Lighthouse Trio');
		h.ok(en.isHidden({ artist: 'tin lighthouse trio' }), 'hide: an artist, whatever the spelling');
		undo();
		h.ok(!en.isHidden({ artist: 'Tin Lighthouse Trio' }), 'hide: undo');
		// a radio from a library song: familiar songs, the page starts it
		var ids = await en.radio('aaaaaaaaaaa', { ratio: 0, label: 'Radio: Blue Signal' });
		var last = calls[calls.length - 1];
		h.ok(last[0] === 'feeder' && last[1] === 'Radio: Blue Signal' && ids.length >= 1, 'radio: the page gets a feeder and its first songs');
		h.eq(en.feeder().kind, 'radio', 'feeder(): the running feeder');
		var more = await en.starved();
		h.ok(Array.isArray(more), 'starved: more songs when the queue ran dry');
		// the quota: 1,500 kept back for imports and adds
		used = 9000;
		h.eq([en.quota().left, en.quota().auto.cap], [0, 300], 'quota: today\'s allowance less what was used and the reserve');
		used = 0;
		// a reload: the registry and the feeder come back
		en.persist();
		await wait(1700);
		var again = make();
		await again.start();
		h.ok(again.isFound('ggggggggggg') === false && again.feeder() && again.feeder().kind === 'radio', 'after a reload: kept songs left the registry, the radio goes on');
		again.stopFeeder();
		h.eq(again.feeder(), null, 'stopFeeder');
	});
};
