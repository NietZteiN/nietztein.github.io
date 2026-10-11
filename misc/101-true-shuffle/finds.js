/*
 * True Shuffle: found songs. A find (sources.js's shape) is a song the
 * library does not have. This file turns finds into things the queue can
 * hold, without filling the library with every song that played once.
 *
 *     var reg = F.registry(lib, { L, now });
 *     reg.add(find, video) -> track     reg.get(id)  reg.has(id)  reg.find(id)  reg.ids()
 *     reg.drop(ids)  reg.keepOnly(ids)  reg.setDuration(id, sec)  reg.listened(id, info)
 *     reg.toJSON()   F.registryFrom(lib, json, { L, now })
 *     F.promote(lib, reg, id, { L, playlistId, now }) -> [ids changed]
 *
 *     var res = F.resolver({ M, cache, index, lists, search, budget, now });
 *     res.prepare(finds) -> Promise        res.estimate(finds) -> estimate (synchronous)
 *     res.resolve(find, { allow }) -> Promise<{ videoId, rung, units, video } | { none, rung, reason }>
 *     res.learn(videos)   res.forget(videoId)   res.topicOf(name)   res.known()
 *
 * The registry keeps a light track for each find that has a YouTube id:
 * shaped like a library track (made by library.js upsert on a shadow
 * library that shares the real one's aliases, profiles and channel rules),
 * with `transient: true` and `foundVia: { source, key, why }`, so the bar,
 * the queue, S.similar and the cover art work on it as on any track. A
 * find joins the real library only when the listener says it is worth
 * keeping (promote: a like, Keep, a playlist, finishing it twice).
 *
 * The resolver finds a YouTube id for a find that has none, the cheapest
 * way first (RUNGS, COST):
 *   0 known    the find carries one (a Mix, a channel's uploads, the library)  free
 *   1 cache    found before (yt:res:<key>, 30 days; "not found" 7 days)       free
 *   2 library  the library has the song (match.js inLibrary)                  free
 *   3 pool     a video seen in any list or search of the last 30 days         free
 *   4 topic    the artist's Topic channel uploads, then the pool again        1 unit per 50
 *   6 search   one YouTube search for this song                              101 units
 * Rung 4 runs only within the automatic allowance (budget.autoLeft()); rung 6
 * only when allowed ({ allow: 'search' }: the listener pressed Play) and
 * within today's quota less the reserve (budget.left()).
 *
 * UMD: window.TrueShuffle.finds in the browser, module.exports in Node.
 */
(function (root, factory) {
	var node = typeof module === 'object' && module.exports;
	var api = factory(function () { return node ? require('./library.js') : (root.TrueShuffle || {}).library; });
	if (node) module.exports = api;
	else { root.TrueShuffle = root.TrueShuffle || {}; root.TrueShuffle.finds = api; }
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this), function (getLibrary) {
	'use strict';

	var FOUND = 'local:found';            // the shadow library's one playlist
	var DISCOVERED = 'local:discovered';  // the real library's playlist for kept finds
	var RUNGS = ['known', 'cache', 'library', 'pool', 'topic', 'group', 'search'];
	var COST = { known: 0, cache: 0, library: 0, pool: 0, topic: 1, group: 101, search: 101 };
	var GROUP_MIN = 4;     // the group rung is worth a search from this many unresolved songs
	var DAY = 86400000;
	var YT_ID = /^[A-Za-z0-9_-]{11}$/;

	function iso(t) { return new Date(t).toISOString(); }
	function copy(o) { return JSON.parse(JSON.stringify(o)); }

	// ---- The registry: light tracks for finds -----------------------------------------------

	// A shadow library that reads names the way the real one does.
	function shadowOf(lib, L) {
		var s = L.create();
		if (lib) {
			s.aliases = lib.aliases;
			s.channelRules = lib.channelRules;
			s.genres = lib.genres;
			s.profiles = lib.profiles || {};
			s.settings = lib.settings;
		}
		return s;
	}
	// The labels a structured find knows (AnimeThemes, iTunes, Deezer, Last.fm):
	// they win over what the upload's title says, as hand-made labels do.
	function labelsOf(find) {
		var l = {};
		if (find.artist && find.source !== 'ytuploads' && find.source !== 'ytplaylist' && find.source !== 'ytmix' && find.source !== 'ytsearch') l.artist = find.artist;
		if (find.title && l.artist) l.title = find.title;
		if (find.titleAlt) l.titleAlt = find.titleAlt;
		if (find.work) l.work = find.work;
		if (find.role) l.role = find.role;
		return Object.keys(l).length ? l : null;
	}
	function registry(lib, opts) {
		opts = opts || {};
		var L = opts.L || getLibrary();
		var now = opts.now || function () { return Date.now(); };
		var shadow = shadowOf(lib, L), finds = {};
		var api = {
			// video: { videoId or id, title, channel, channelId, durationSec, publishedAt }
			add: function (find, video) {
				video = video || {};
				var id = video.videoId || video.id || find.videoId;
				if (!id || !YT_ID.test(id)) return null;
				var rec = {
					id: id,
					title: video.title || find.title || '',
					channel: video.channel || find.channel || '',
					channelId: video.channelId || find.channelId || '',
					durationSec: video.durationSec || find.durationSec || 0,
					publishedAt: video.publishedAt || '',
					embeddable: video.embeddable !== false,
					topics: video.topics || []
				};
				L.upsert(shadow, [rec], { playlistId: FOUND, now: now() });
				var t = shadow.tracks[id], lab = labelsOf(find);
				if (lab) { t.labels = lab; L.deriveIds(shadow, [id]); }
				t.transient = true;
				t.foundVia = { source: find.source || '', key: find.key || ('v:' + id), why: (find.why || []).slice(0, 3) };
				if (find.cover && !t.cover) t.cover = find.cover;
				var f = copy(find);
				f.videoId = id;
				finds[id] = f;
				return t;
			},
			get: function (id) { return shadow.tracks[id] || null; },
			has: function (id) { return !!shadow.tracks[id]; },
			find: function (id) { return finds[id] || null; },
			ids: function () { return Object.keys(shadow.tracks); },
			drop: function (ids) { (ids || []).forEach(function (id) { delete shadow.tracks[id]; delete finds[id]; }); },
			// Keep only these (the queue's and the last ones played); -> ids dropped
			keepOnly: function (ids) {
				var keep = {}, gone = [];
				(ids || []).forEach(function (id) { keep[id] = true; });
				Object.keys(shadow.tracks).forEach(function (id) { if (!keep[id]) { gone.push(id); delete shadow.tracks[id]; delete finds[id]; } });
				return gone;
			},
			setDuration: function (id, sec) { var t = shadow.tracks[id]; if (t && sec > 0 && !t.durationSec) t.durationSec = Math.round(sec); },
			// A listen, as library.recordPlay counts it: -> the track
			listened: function (id, info) { return shadow.tracks[id] ? L.recordPlay(shadow, id, info) : null; },
			shadow: function () { return shadow; },
			toJSON: function () { return { v: 1, tracks: copy(shadow.tracks), finds: copy(finds) }; }
		};
		return api;
	}
	function registryFrom(lib, json, opts) {
		var reg = registry(lib, opts);
		if (json && json.v === 1 && json.tracks) {
			var sh = reg.shadow(), fs = json.finds || {};
			Object.keys(json.tracks).forEach(function (id) {
				if (!YT_ID.test(id)) return;
				sh.tracks[id] = json.tracks[id];
				if (fs[id]) reg.add(fs[id], { videoId: id, title: json.tracks[id].raw && json.tracks[id].raw.title, channel: json.tracks[id].channel, channelId: json.tracks[id].channelId, durationSec: json.tracks[id].durationSec });
				var t = sh.tracks[id], old = json.tracks[id];
				['plays', 'skips', 'lastPlayed', 'rating', 'durationSec'].forEach(function (k) { if (old[k] != null) t[k] = old[k]; });
			});
		}
		return reg;
	}

	// A find the listener keeps joins the library, in the playlist Discovered.
	// -> [ids changed] (write them, the playlist and the meta)
	function promote(lib, reg, id, opts) {
		opts = opts || {};
		var L = opts.L || getLibrary();
		var t = reg.get(id), when = iso(opts.now ? opts.now() : Date.now());
		var pl = opts.playlistId || DISCOVERED;
		if (!lib.playlists[pl]) L.setPlaylist(lib, { id: pl, title: 'Discovered', privacy: 'local', special: 'local', importedAt: when });
		if (lib.tracks[id]) {
			var have = lib.tracks[id];
			if (have.playlists.indexOf(pl) < 0) { have.playlists.push(pl); have.addedAt[pl] = when; }
			reg.drop([id]);
			return [id];
		}
		if (!t) return [];
		var mine = copy(t);
		delete mine.transient;
		mine.playlists = [pl];
		mine.addedAt = {};
		mine.addedAt[pl] = when;
		lib.tracks[id] = mine;
		L.deriveIds(lib, [id]);
		lib.playlists[pl].count = L.list(lib).filter(function (x) { return x.playlists.indexOf(pl) >= 0; }).length;
		reg.drop([id]);
		return [id];
	}

	// ---- The resolver: a YouTube id for a find, cheapest way first ---------------------------

	// deps: { M (match.js), cache (sources.js createCache, or null), index() (M.index of the
	//         library), lists (sources.js ytLists, or null), search(q, { max }) -> Promise<videos>
	//         (or null), canSearch() -> bool (a key or a sign-in now; default: search is given),
	//         lists: { uploads(channelId, { max }) -> [items], with items.units when the caller knows what the read cost (a cached read costs nothing) } (or null),
	//         budget: { left(), autoLeft(), spend(units, auto) },
	//         topicChannels(): { foldedArtist: channelId } from the library, now }
	function resolver(deps) {
		var M = deps.M, cache = deps.cache || null, now = deps.now || function () { return Date.now(); };
		var memo = {};          // find key -> videoId, or '' for "not found"
		var pool = {};          // videoId -> video (anything a list or a search returned)
		var poolKeys = {};      // title key -> [videoIds]
		var topics = {};        // folded artist -> Topic channel id
		var bad = {};           // videoIds the player refused
		function canSearch() { return !!deps.search && (typeof deps.canSearch === 'function' ? !!deps.canSearch() : true); }
		function canList() { return !!deps.lists && (typeof deps.canList === 'function' ? !!deps.canList() : true); }
		function budget() { return deps.budget || { left: function () { return 0; }, autoLeft: function () { return 0; }, spend: function () {} }; }
		function learnTopics() {
			var t = deps.topicChannels ? deps.topicChannels() : {};
			Object.keys(t || {}).forEach(function (k) { topics[k] = t[k]; });
		}
		function learn(videos) {
			(videos || []).forEach(function (v) {
				var id = v && (v.videoId || v.id);
				if (!id || !YT_ID.test(id) || bad[id]) return;
				var vid = { videoId: id, title: v.title || '', channel: v.channel || '', channelId: v.channelId || '', durationSec: v.durationSec || 0 };
				pool[id] = vid;
				M.titleKeys(vid.title, '', { title: vid.title, channel: vid.channel }).forEach(function (k) { (poolKeys[k] = poolKeys[k] || []).indexOf(id) < 0 && poolKeys[k].push(id); });
				// "Artist - Topic" teaches where that artist's songs are
				var m = /^(.*) - Topic$/.exec(vid.channel);
				if (m && vid.channelId) topics[M.fold(m[1])] = vid.channelId;
			});
		}
		// The library's own upload of this recording (not another version of the song).
		function sameRecordingIn(ix, find) { var hit = M.inLibrary(ix, find); return hit && hit.sameRecording !== false ? hit : null; }
		function fromPool(find) {
			var keys = M.signature(find).t, seen = {}, cands = [];
			keys.forEach(function (k) {
				Object.keys(poolKeys).forEach(function (pk) {
					if (pk === k || (k.length >= 6 && pk.indexOf(k) >= 0)) (poolKeys[pk] || []).forEach(function (id) { if (!seen[id] && !bad[id]) { seen[id] = true; cands.push(pool[id]); } });
				});
			});
			return cands.length ? M.bestVideo(cands, find) : null;
		}
		function topicFor(find) {
			var ks = M.artistKeys(find.artist || '', find.artistNative || '');
			for (var i = 0; i < ks.length; i++) if (topics[ks[i]]) return topics[ks[i]];
			return '';
		}
		function remember(find, videoId) {
			memo[find.key] = videoId || '';
			if (cache && find.key) cache.put('yt:res:' + find.key, videoId ? { videoId: videoId } : null, videoId ? 30 * DAY : 7 * DAY);
		}
		function found(rung, units, video) { return { videoId: video.videoId, rung: rung, units: units, video: video }; }
		// The group's own list among a playlist search's answers: one whose title is the
		// group's, a YouTube Music album (OLAK5uy_) first.
		function pickList(lists, title) {
			var want = M.fold(M.baseTitle ? M.baseTitle(title) : title), best = null, top = 0;
			(lists || []).forEach(function (l) {
				var t = M.fold(l.title || ''), s = 0;
				if (!want || !t) return;
				if (t === want) s += 6; else if (t.indexOf(want) >= 0 || (t.length >= 4 && want.indexOf(t) >= 0)) s += 4; else return;
				if (/^OLAK5uy_/.test(l.playlistId || '')) s += 3;
				if (s > top) { top = s; best = l; }
			});
			return best;
		}
		var api = {
			// Warm the memory from the cache (one read), so estimate() is right.
			prepare: function (finds) {
				learnTopics();
				var keys = (finds || []).filter(function (f) { return f && f.key && !f.videoId && !(f.key in memo); }).map(function (f) { return 'yt:res:' + f.key; });
				if (!cache || !keys.length) return Promise.resolve();
				return cache.getMany(keys).then(function (got) {
					Object.keys(got || {}).forEach(function (k) { var v = got[k]; memo[k.slice(7)] = v && v.videoId ? v.videoId : ''; });
				});
			},
			// What playing these would take, without a request: synchronous.
			estimate: function (finds) {
				var out = { perFind: {}, ready: 0, cheap: 0, search: 0, blocked: 0, units: 0 }, ix = deps.index ? deps.index() : null;
				var searchOk = canSearch(), left = budget().left();
				(finds || []).forEach(function (f) {
					var e;
					if (f.videoId) e = { rung: 'known', units: 0, status: 'ready' };
					else if (memo[f.key]) e = { rung: 'cache', units: 0, status: 'ready' };
					else if (ix && sameRecordingIn(ix, f)) e = { rung: 'library', units: 0, status: 'ready' };
					else if (fromPool(f)) e = { rung: 'pool', units: 0, status: 'ready' };
					else if (memo[f.key] === '') e = { rung: 'cache', units: 0, status: 'not-found' };
					else if (canList() && topicFor(f)) e = { rung: 'topic', units: 1, status: 'cheap' };
					else if (!searchOk) e = { rung: 'search', units: COST.search, status: 'needs-key' };
					else if (left < COST.search) e = { rung: 'search', units: COST.search, status: 'over-budget' };
					else e = { rung: 'search', units: COST.search, status: 'search' };
					out.perFind[f.key] = e;
					if (e.status === 'ready') out.ready++;
					else if (e.status === 'cheap') { out.cheap++; out.units += 1; }
					else if (e.status === 'search') { out.search++; out.units += COST.search; }
					else out.blocked++;
				});
				return out;
			},
			// allow: 'free' (rungs 0-3), 'cheap' (and 4), 'search' (and 6: the listener pressed Play)
			resolve: function (find, opts) {
				opts = opts || {};
				var allow = opts.allow || 'free';
				if (!find) return Promise.resolve({ none: true, rung: 'known', reason: 'nothing' });
				if (find.videoId && !bad[find.videoId]) return Promise.resolve({ videoId: find.videoId, rung: 'known', units: 0, video: { videoId: find.videoId, title: find.title, channel: find.channel, channelId: find.channelId, durationSec: find.durationSec } });
				learnTopics();
				return api.prepare([find]).then(function () {
					if (memo[find.key] && !bad[memo[find.key]]) return { videoId: memo[find.key], rung: 'cache', units: 0, video: pool[memo[find.key]] || { videoId: memo[find.key] } };
					var ix = deps.index ? deps.index() : null, inLib = ix ? sameRecordingIn(ix, find) : null;
					if (inLib && !bad[inLib.id]) return { videoId: inLib.id, rung: 'library', units: 0, video: { videoId: inLib.id } };
					var p = fromPool(find);
					if (p) { remember(find, p.video.videoId); return found('pool', 0, p.video); }
					if (memo[find.key] === '' && allow !== 'search') return { none: true, rung: 'cache', reason: 'not-found' };
					var tc = topicFor(find);
					var step = (allow === 'cheap' || allow === 'search') && tc && canList() && budget().autoLeft() >= 1
						? deps.lists.uploads(tc, { max: 200 }).then(function (items) { var units = items && typeof items.units === 'number' ? items.units : Math.ceil(Math.max(1, (items || []).length) / 50); budget().spend(units, true); learn((items || []).map(function (x) { return { videoId: x.videoId, title: x.title, channel: x.channel, channelId: tc }; })); var q = fromPool(find); return q ? found('topic', units, q.video) : null; }, function () { return null; })
						: Promise.resolve(null);
					return step.then(function (hit) {
						if (hit) { remember(find, hit.videoId); return hit; }
						if (allow !== 'search') return { none: true, rung: 'search', reason: 'needs-search' };
						if (!canSearch()) return { none: true, rung: 'search', reason: 'needs-key' };
						if (budget().left() < COST.search) return { none: true, rung: 'search', reason: 'over-budget' };
						budget().spend(100, false);
						return deps.search(M.query(find), { max: 10 }).then(function (videos) {
							learn(videos);
							var best = M.bestVideo(videos || [], find);
							if (!best) { remember(find, ''); return { none: true, rung: 'search', reason: 'not-found' }; }
							remember(find, best.video.videoId);
							return found('search', COST.search, best.video);
						});
					});
				});
			},
			// The group rung: an album's own YouTube list, found with one playlist search
			// (100 units, on a press) and read 50 at a time (1 unit), its songs then matched
			// to the finds through the pool. From GROUP_MIN unresolved songs on.
			// o: { query, title } -> Promise<{ resolved, units, list, reason }>
			resolveGroup: function (finds, o) {
				o = o || {};
				var need = (finds || []).filter(function (f) { return f && f.key && !f.videoId && !memo[f.key]; });
				if (need.length < GROUP_MIN) return Promise.resolve({ resolved: 0, units: 0, reason: 'few' });
				if (!deps.searchPlaylists || !canSearch()) return Promise.resolve({ resolved: 0, units: 0, reason: 'needs-key' });
				if (budget().left() < COST.group) return Promise.resolve({ resolved: 0, units: 0, reason: 'over-budget' });
				budget().spend(100, false);
				return deps.searchPlaylists(o.query || o.title || '', { max: 5 }).then(function (lists) {
					var best = pickList(lists, o.title || o.query || '');
					if (!best || !deps.lists || !deps.lists.playlist) return { resolved: 0, units: 100, reason: 'no-list' };
					return deps.lists.playlist(best.playlistId, { max: 200 }).then(function (items) {
						var units = 100 + (items && typeof items.units === 'number' ? items.units : Math.ceil(Math.max(1, (items || []).length) / 50));
						learn((items || []).map(function (x) { return { videoId: x.videoId, title: x.title, channel: x.channel, channelId: x.channelId }; }));
						var n = 0;
						need.forEach(function (f) { var p = fromPool(f); if (p) { remember(f, p.video.videoId); n++; } });
						return { resolved: n, units: units, list: best.playlistId };
					});
				});
			},
			learn: learn,
			// The player refused this video: the next resolve takes the next-best one.
			forget: function (videoId) {
				bad[videoId] = true;
				delete pool[videoId];
				Object.keys(memo).forEach(function (k) { if (memo[k] === videoId) delete memo[k]; });
			},
			topicOf: function (name) { learnTopics(); var k = M.fold(name || ''); return topics[k] || ''; },
			known: function () { return { pool: Object.keys(pool).length, topics: Object.keys(topics).length, memo: Object.keys(memo).length }; }
		};
		return api;
	}

	return {
		registry: registry, registryFrom: registryFrom, promote: promote, resolver: resolver,
		RUNGS: RUNGS, COST: COST, GROUP_MIN: GROUP_MIN, FOUND: FOUND, DISCOVERED: DISCOVERED
	};
});
