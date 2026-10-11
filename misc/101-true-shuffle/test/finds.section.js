// finds: the registry of found songs and the resolver's cost ladder.
// A tiny stand-in for match.js keeps these tests about the ladder itself.
module.exports = function (h) {
	var path = require('path');
	var F = require(path.join(h.HERE, 'finds.js'));
	var L = require(path.join(h.HERE, 'library.js'));

	function fold(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ''); }
	var M = {
		fold: fold,
		titleKeys: function (title, alt) { return [fold(title), fold(alt)].filter(function (k) { return k.length > 1; }).filter(function (k, i, a) { return a.indexOf(k) === i; }); },
		artistKeys: function (credit, native) { return [fold(credit), fold(native)].filter(Boolean); },
		signature: function (x) { return { t: M.titleKeys(x.title, x.titleAlt), a: M.artistKeys(x.artist), v: x.videoId || null }; },
		index: function (tracks) { var ix = { tracks: {} }; tracks.forEach(function (t) { ix.tracks[t.id] = t; }); return ix; },
		inLibrary: function (ix, f) { var ids = Object.keys(ix.tracks); for (var i = 0; i < ids.length; i++) { var t = ix.tracks[ids[i]]; if (fold(t.title) === fold(f.title) && fold(t.artist) === fold(f.artist)) return { id: t.id, score: 9, why: [] }; } return null; },
		bestVideo: function (videos, f) { var want = fold(f.title); var hit = (videos || []).filter(function (v) { return fold(v.title).indexOf(want) >= 0; })[0]; return hit ? { video: hit, score: 7, alts: [] } : null; },
		query: function (f) { return (f.artist + ' ' + f.title).trim(); }
	};
	function memCache() {
		var rows = {};
		return {
			rows: rows,
			get: function (k) { return Promise.resolve(rows[k] ? rows[k].v : undefined); },
			getMany: function (ks) { var o = {}; ks.forEach(function (k) { if (k in rows) o[k] = rows[k].v; }); return Promise.resolve(o); },
			put: function (k, v, ttl) { rows[k] = { v: v, ttl: ttl }; return Promise.resolve(); }
		};
	}
	function budgetOf(units, auto) {
		var spent = { units: 0, auto: 0 };
		return { spent: spent, left: function () { return units - spent.units; }, autoLeft: function () { return auto - spent.auto; }, spend: function (u, isAuto) { spent.units += u; if (isAuto) spent.auto += u; } };
	}
	var V = function (n) { return ('vid' + n + '__________').slice(0, 11); };

	h.describe('finds', async function () {
		// ---- the registry ----
		var lib = L.create();
		var reg = F.registry(lib, { now: function () { return Date.UTC(2026, 9, 10); } });
		var t = reg.add({ key: 'it:track:1', title: 'Glass Avenue', artist: 'Glass Orchard', source: 'itunes', work: 'Starfall Odyssey', role: 'OP', why: [['album', 'Lanterns']] }, { videoId: V(1), title: 'Glass Orchard - Glass Avenue (Official Video)', channel: 'Sunken Meadow Records', durationSec: 201 });
		h.ok(t && t.transient === true && t.id === V(1), 'registry: a find with a video becomes a light track');
		h.eq([t.artist, t.title, t.work, t.role, t.durationSec], ['Glass Orchard', 'Glass Avenue', 'Starfall Odyssey', 'OP', 201], 'registry: a structured find\'s artist, title, work and role win, as labels do');
		h.eq([t.foundVia.source, t.foundVia.key], ['itunes', 'it:track:1'], 'registry: the track says where it was found');
		h.eq(reg.add({ key: 'x' }, { videoId: 'not an id' }), null, 'registry: no YouTube id, no track');
		var t2 = reg.add({ key: 'v:' + V(2), source: 'ytuploads' }, { videoId: V(2), title: 'Paper Lanterns - Blue Signal', channel: 'Paper Lanterns' });
		h.eq([t2.artist, t2.title], ['Paper Lanterns', 'Blue Signal'], 'registry: an upload is read by parse.js like any import');
		reg.setDuration(V(2), 187.4);
		h.eq(reg.get(V(2)).durationSec, 187, 'registry: the player tells the length');
		reg.listened(V(2), { completed: true, listenedSec: 187, durationSec: 187, at: 1 });
		h.eq(reg.get(V(2)).plays, 1, 'registry: listens are counted on the light track');
		var back = F.registryFrom(lib, JSON.parse(JSON.stringify(reg.toJSON())), {});
		h.eq([back.ids().sort(), back.get(V(2)).plays, back.find(V(1)).key], [[V(1), V(2)].sort(), 1, 'it:track:1'], 'registry: survives toJSON and registryFrom');
		h.eq(reg.keepOnly([V(1)]), [V(2)], 'registry: keepOnly drops the rest');
		h.ok(!lib.tracks[V(1)], 'registry: the real library is untouched');
		// promote: the find joins the library under Discovered
		var changed = F.promote(lib, reg, V(1), { now: function () { return Date.UTC(2026, 9, 11); } });
		h.eq(changed, [V(1)], 'promote: returns what changed');
		var kept = lib.tracks[V(1)];
		h.ok(kept && !kept.transient && kept.playlists[0] === F.DISCOVERED && lib.playlists[F.DISCOVERED] && lib.playlists[F.DISCOVERED].count === 1, 'promote: the track is in the library, in the playlist Discovered');
		h.ok(!reg.has(V(1)), 'promote: and no longer in the registry');

		// ---- the resolver's ladder ----
		var library = [{ id: V(10), title: 'Morning Lighthouse', artist: 'Paper Lanterns' }];
		var cache = memCache(), searches = [], uploads = [];
		var budget = budgetOf(1000, 300);
		var res = F.resolver({
			M: M, cache: cache, index: function () { return M.index(library); }, budget: budget,
			topicChannels: function () { return { tinlighthousetrio: 'UCtopic' }; },
			lists: { uploads: function (ch) { uploads.push(ch); return Promise.resolve([{ videoId: V(20), title: 'Crooked Parade' }, { videoId: V(21), title: 'Harbour Lights' }]); } },
			search: function (q) { searches.push(q); return Promise.resolve([{ videoId: V(30), title: 'Neon Abacus - Counting Backwards', channel: 'Neon Abacus - Topic', channelId: 'UCneon' }]); }
		});
		var r0 = await res.resolve({ key: 'v:' + V(5), videoId: V(5) });
		h.eq([r0.videoId, r0.rung, r0.units], [V(5), 'known', 0], 'resolve: a find with an id needs nothing');
		var r2 = await res.resolve({ key: 'it:track:2', title: 'Morning Lighthouse', artist: 'Paper Lanterns' });
		h.eq([r2.videoId, r2.rung], [V(10), 'library'], 'resolve: the library has it: the user\'s own upload');
		var est = res.estimate([{ key: 'a', title: 'Crooked Parade', artist: 'Tin Lighthouse Trio' }, { key: 'b', title: 'Counting Backwards', artist: 'Neon Abacus' }, { key: 'c', videoId: V(7) }]);
		h.eq([est.perFind.a.status, est.perFind.b.status, est.perFind.c.status, est.units], ['cheap', 'search', 'ready', 1 + F.COST.search], 'estimate: the topic channel is cheap, a search costs ' + F.COST.search + ', a known id is ready');
		var free = await res.resolve({ key: 'a', title: 'Crooked Parade', artist: 'Tin Lighthouse Trio' }, { allow: 'free' });
		h.eq([free.none, free.reason, uploads.length], [true, 'needs-search', 0], 'resolve: free only: nothing is spent');
		var r4 = await res.resolve({ key: 'a', title: 'Crooked Parade', artist: 'Tin Lighthouse Trio' }, { allow: 'cheap' });
		h.eq([r4.videoId, r4.rung, uploads, budget.spent.auto], [V(20), 'topic', ['UCtopic'], 1], 'resolve: cheap: the artist\'s Topic uploads, one unit');
		var r3 = await res.resolve({ key: 'd', title: 'Harbour Lights', artist: 'Tin Lighthouse Trio' }, { allow: 'free' });
		h.eq([r3.videoId, r3.rung, uploads.length], [V(21), 'pool', 1], 'resolve: what a list returned is free from then on (the pool)');
		var noKey = await res.resolve({ key: 'b', title: 'Counting Backwards', artist: 'Neon Abacus' }, { allow: 'cheap' });
		h.eq([noKey.none, searches.length], [true, 0], 'resolve: a search only when the listener pressed Play');
		var r6 = await res.resolve({ key: 'b', title: 'Counting Backwards', artist: 'Neon Abacus' }, { allow: 'search' });
		h.eq([r6.videoId, r6.rung, searches, budget.spent.units], [V(30), 'search', ['Neon Abacus Counting Backwards'], 101], 'resolve: search: one query, 100 units (plus the topic unit before)');
		h.ok(cache.rows['yt:res:b'] && cache.rows['yt:res:b'].v.videoId === V(30) && cache.rows['yt:res:b'].ttl === 30 * 86400000, 'resolve: the answer is kept 30 days');
		var res2 = F.resolver({ M: M, cache: cache, index: function () { return M.index([]); }, budget: budgetOf(0, 0) });
		var again = await res2.resolve({ key: 'b', title: 'Counting Backwards', artist: 'Neon Abacus' }, { allow: 'free' });
		h.eq([again.videoId, again.rung], [V(30), 'cache'], 'resolve: a later page finds it in the cache for free');
		h.eq(res.topicOf('Neon Abacus'), 'UCneon', 'resolve: a search result on "X - Topic" teaches where X\'s songs are');
		var budget3 = budgetOf(1000, 300);
		var res3 = F.resolver({ M: M, cache: memCache(), index: function () { return M.index([]); }, budget: budget3, topicChannels: function () { return { tinlighthousetrio: 'UCtopic' }; },
			lists: { uploads: function () { var items = [{ videoId: V(20), title: 'Crooked Parade' }]; items.units = 0; return Promise.resolve(items); } } });
		var cached = await res3.resolve({ key: 'a', title: 'Crooked Parade', artist: 'Tin Lighthouse Trio' }, { allow: 'cheap' });
		h.eq([cached.videoId, cached.units, budget3.spent.auto], [V(20), 0, 0], 'resolve: an uploads read the caller says was cached costs nothing');
		res.forget(V(30));
		var after = await res.resolve({ key: 'b', title: 'Counting Backwards', artist: 'Neon Abacus' }, { allow: 'free' });
		h.ok(after.none || after.videoId !== V(30), 'forget: a video the player refused is not chosen again');
		var broke = F.resolver({ M: M, cache: memCache(), index: function () { return M.index([]); }, budget: budgetOf(50, 0), search: function () { throw new Error('must not search'); } });
		var over = await broke.resolve({ key: 'z', title: 'Silent Engine', artist: 'Nobody' }, { allow: 'search' });
		h.eq([over.none, over.reason], [true, 'over-budget'], 'resolve: no search past the day\'s allowance');
		var noSearch = F.resolver({ M: M, index: function () { return M.index([]); }, budget: budgetOf(9999, 0) });
		var nk = await noSearch.resolve({ key: 'y', title: 'Silent Engine', artist: 'Nobody' }, { allow: 'search' });
		h.eq(nk.reason, 'needs-key', 'resolve: no key and no sign-in: says so');
		var none = memCache(), lone = F.resolver({ M: M, cache: none, index: function () { return M.index([]); }, budget: budgetOf(1000, 0), search: function () { return Promise.resolve([]); } });
		var miss = await lone.resolve({ key: 'q', title: 'Nowhere Song', artist: 'Nobody' }, { allow: 'search' });
		h.eq([miss.none, miss.reason, none.rows['yt:res:q'].v, none.rows['yt:res:q'].ttl], [true, 'not-found', null, 7 * 86400000], 'resolve: "not found" is kept for 7 days');
	});
};
