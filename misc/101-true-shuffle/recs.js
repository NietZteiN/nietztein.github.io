/*
 * True Shuffle: recommendations, the pure half of the For you page (foryou.js).
 * What the listener's own listening says they like (the taste profile), which
 * found songs are worth showing (the lane filter), and the small bookkeeping a
 * feed needs: what was shown, what was touched, the last visit, the anime
 * season. Nothing here touches the page, the network or the store, except
 * migrateStore, which takes a store.js store.
 *
 *     R.profile(tracks, history, now) -> { songs: [{ id, w }], artists: [{ key, name, w, ids }],
 *                                          works: [{ key, name, scene, w, ids }], channels: [{ id, name, w, ids }] }
 *     R.songWeight(track, recent) -> number
 *     R.currentSeason(now) / R.previousSeason(nowOrSeason) -> { year, season }    R.seasonName(s) -> 'Fall 2026'
 *     R.filter(items, { have, heard, hidden, shown, now, limit }) -> items
 *     R.dedupeLanes(lanes) -> lanes                each item only in its first lane
 *     R.seen(book, keys, now) / R.touch(book, keys) -> book    R.counts(book) -> { key: n }
 *     R.visit(visits, now) -> { visits, since }    R.releases(albums, { now, since }) -> { coming, fresh, earlier, from }
 *     R.byCompletion(franchises) -> the ones with songs missing, closest to complete first
 *     R.newSince(finds, mark) -> finds              R.sinceWords(ms, now) -> 'today' | 'Tuesday' | 'Oct 3'
 *     R.nextSeed(profile, lastId) -> id             R.interleave(items, keyOf) -> items
 *     R.ratioName(r) -> 'None' | 'Some' | 'Lots'    R.RATIOS
 *     R.migrate(kv, now) -> { set, remove }         R.migrateStore(store, now) -> Promise<{ set, remove }>
 *     R.SEASONS, R.SINK (3), R.RECENT_MS (30 days), R.SEEN_GAP_MS (6 hours), R.VISIT_GAP_MS (6 hours),
 *     R.RELEASE_DAYS (120), R.SEED_TOP (12)
 *
 * UMD: window.TrueShuffle.recs in the browser, module.exports in Node.
 */
(function (root, factory) {
	var node = typeof module === 'object' && module.exports;
	var api = factory(root, !!node);
	if (node) module.exports = api;
	else { root.TrueShuffle = root.TrueShuffle || {}; root.TrueShuffle.recs = api; }
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this), function (root, inNode) {
	'use strict';

	var DAY = 86400000;
	var RECENT_MS = 30 * DAY;        // "played lately" and "heard lately": the last 30 days
	var SINK = 3;                    // shown this often without a touch, an item goes to the end
	var SEEN_GAP_MS = 6 * 3600000;   // a key counts as shown again only after this long
	var BOOK_KEEP_MS = 60 * DAY;     // a shown count this old is forgotten
	var BOOK_MAX = 3000;             // keys kept in the shown book
	var VISIT_GAP_MS = 6 * 3600000;  // two looks at the page this close are one visit
	var RELEASE_DAYS = 120;          // new releases: the last 120 days (or since the last visit)
	var RELEASE_MAX_DAYS = 365;      // ... but never further back than a year
	var SEED_TOP = 12;               // Your radio's seed turns through this many top songs
	var SAVED_MAX = 500;             // as engine.js keeps
	var SEASONS = ['winter', 'spring', 'summer', 'fall'];
	var RATIOS = [['None', 0], ['Some', 0.5], ['Lots', 0.8]];
	var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
	var WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
	var OWN = Object.prototype.hasOwnProperty;

	function has(o, k) { return !!o && OWN.call(o, k); }
	function str(v) { return v == null ? '' : String(v); }
	function num(v) { var n = +v; return isFinite(n) ? n : 0; }
	function list(x) { return Array.isArray(x) ? x : x && typeof x === 'object' ? Object.keys(x).map(function (k) { return x[k]; }) : []; }
	function copy(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }
	function round3(n) { return Math.round(n * 1000) / 1000; }
	function cmp(a, b) { a = str(a); b = str(b); return a < b ? -1 : a > b ? 1 : 0; }
	function mod(name) {
		var TS = root && root.TrueShuffle;
		if (TS && TS[name]) return TS[name];
		if (inNode && typeof require === 'function') { try { return require('./' + name + '.js'); } catch (e) { return null; } }
		return null;
	}
	// Names compared without case, accents, punctuation or a leading "the" (discover.js
	// norm, match.js fold): the page's own fold when it is there.
	function fold(s) {
		var DX = mod('discover');
		if (DX && DX.norm) return DX.norm(str(s));
		return str(s).normalize('NFKC').normalize('NFKD').replace(/[\u0300-\u036F]/g, '').toLowerCase()
			.replace(/&/g, ' and ').replace(/^\s*the\s+/, '').replace(/[^\p{L}\p{N}]+/gu, '');
	}
	function timeOf(v) { if (typeof v === 'number') return v; var t = Date.parse(str(v)); return isFinite(t) ? t : 0; }
	// The commonest of some spellings: { spelling: count } -> spelling.
	function commonest(c) { var best = '', n = -1; Object.keys(c).sort().forEach(function (k) { if (c[k] > n) { n = c[k]; best = k; } }); return best; }

	// ---- The taste profile -----------------------------------------------------------------------

	// A song's weight: 3 if liked (four stars or more), a quarter point a play (twenty
	// at most), 2 if played in the last 30 days, less one point for each skip a play.
	function songWeight(t, recent) {
		if (!t) return 0;
		var plays = Math.max(0, num(t.plays)), skips = Math.max(0, num(t.skips));
		return (num(t.rating) >= 4 ? 3 : 0) + Math.min(plays, 20) / 4 + (recent ? 2 : 0) - skips / (plays + 1);
	}

	// What the listener's songs say: the songs, artists, works and channels they like,
	// best first. tracks: the library's tracks (a list or a map; light, blocked tracks
	// and clips are left out); history: [{ id, at, kind: 'play' | 'skip' }] (a play in
	// the last 30 days counts as recent, as lastPlayed does); now: ms.
	// A group's weight is the sum of its songs' weights over the square root of its
	// number of songs, so a big group counts, but less than its size. Songs and groups
	// of weight 0 or less are left out.
	function profile(tracks, history, now) {
		now = now == null ? Date.now() : +now;
		var played = {};
		list(history).forEach(function (e) {
			if (!e || e.kind !== 'play' || !e.id) return;
			var at = timeOf(e.at);
			if (at && now - at < RECENT_MS && at <= now + DAY) played[e.id] = true;
		});
		var songs = [], groups = { artists: {}, works: {}, channels: {} };
		function bump(map, key, t, w, extra) {
			var g = map[key] || (map[key] = { key: key, sum: 0, n: 0, members: [], names: {}, scenes: {} });
			g.sum += w;
			g.n++;
			g.members.push({ id: t.id, w: w });
			if (extra) extra(g);
		}
		list(tracks).forEach(function (t) {
			if (!t || !t.id || t.transient || t.blocked || t.kind === 'clip') return;
			var last = timeOf(t.lastPlayed);
			var recent = !!played[t.id] || (last > 0 && now - last < RECENT_MS && last <= now + DAY);
			var w = round3(songWeight(t, recent));
			if (w > 0) songs.push({ id: t.id, w: w });
			if (t.artistKey) bump(groups.artists, t.artistKey, t, w, function (g) { if (t.artist) g.names[t.artist] = (g.names[t.artist] || 0) + 1; });
			if (t.work) bump(groups.works, str(t.work), t, w, function (g) { if (t.scene) g.scenes[t.scene] = (g.scenes[t.scene] || 0) + 1; });
			if (t.channelId) bump(groups.channels, t.channelId, t, w, function (g) { if (t.channel) g.names[t.channel] = (g.names[t.channel] || 0) + 1; });
		});
		function best(a, b) { return b.w - a.w || cmp(a.key || a.id, b.key || b.id); }
		songs.sort(best);
		function ranked(map, shape) {
			return Object.keys(map).map(function (k) {
				var g = map[k];
				return shape(g, round3(g.sum / Math.sqrt(g.n)), g.members.sort(best).map(function (m) { return m.id; }));
			}).filter(function (g) { return g.w > 0; }).sort(best);
		}
		return {
			songs: songs,
			artists: ranked(groups.artists, function (g, w, ids) { return { key: g.key, name: commonest(g.names) || g.key, w: w, ids: ids }; }),
			works: ranked(groups.works, function (g, w, ids) { return { key: g.key, name: g.key, scene: commonest(g.scenes), w: w, ids: ids }; }),
			channels: ranked(groups.channels, function (g, w, ids) { return { key: g.key, id: g.key, name: commonest(g.names) || g.key, w: w, ids: ids }; }).map(function (c) { delete c.key; return c; })
		};
	}

	// Your radio's next seed: the song after `lastId` among the top songs (the first when
	// there was none, or it has dropped out), so each press starts from another favourite.
	function nextSeed(prof, lastId) {
		var top = (prof && prof.songs ? prof.songs : []).slice(0, SEED_TOP);
		if (!top.length) return null;
		var i = -1;
		for (var k = 0; k < top.length; k++) if (top[k].id === lastId) i = k;
		return top[(i + 1) % top.length].id;
	}

	// ---- Anime seasons (AniList's: winter is January to March, UTC) ------------------------------------

	function currentSeason(now) {
		var d = new Date(now == null ? Date.now() : +now);
		return { year: d.getUTCFullYear(), season: SEASONS[Math.floor(d.getUTCMonth() / 3)] };
	}
	// The season before: of a moment (ms), or of a season ({ year, season }).
	function previousSeason(x) {
		var s = x && typeof x === 'object' ? { year: num(x.year), season: str(x.season).toLowerCase() } : currentSeason(x);
		var i = SEASONS.indexOf(s.season);
		if (i < 0) i = 0;
		return i === 0 ? { year: s.year - 1, season: 'fall' } : { year: s.year, season: SEASONS[i - 1] };
	}
	function seasonName(s) { var n = str(s && s.season); return n ? n.charAt(0).toUpperCase() + n.slice(1) + ' ' + num(s.year) : ''; }

	// ---- Which found songs a lane shows ------------------------------------------------------------

	// One item's identities: its key, and its artist and title folded (two finds of one
	// song from two sources meet there). Library tracks count by their video.
	function idsOf(x) {
		if (!x || typeof x !== 'object') return [];
		var out = [], f = x.find && !x.key ? x.find : x;
		var track = !!f.id && Array.isArray(f.playlists), vid = f.videoId || (track ? f.id : '');
		var key = str(f.key) || (track ? 'v:' + f.id : '');
		if (key) out.push('k:' + key);
		if (vid) out.push('v:' + vid);
		var a = fold(f.artist), t = fold(f.title);
		if (a && t) out.push('n:' + a + '|' + t);
		return out;
	}
	function keyOf(x) { var f = x && x.find && !x.key ? x.find : x; return f ? str(f.key) || (f.id ? 'v:' + f.id : '') : ''; }
	function countOf(v) { return typeof v === 'number' ? v : v && typeof v === 'object' ? num(v.n) : 0; }

	// The items a lane may show, in their order: not what the library has (`have`), not
	// what was heard in the last 30 days (`heard` gives true, or the time it was heard),
	// not what is hidden, each song once; an item shown SINK (3) times without a touch
	// (`shown`: { key: n } or the book seen() keeps) goes to the end. `limit` cuts the list.
	function filter(items, o) {
		o = o || {};
		var now = o.now == null ? Date.now() : +o.now, shown = o.shown || {};
		var have = typeof o.have === 'function' ? o.have : function (f) { return !!(f && f.mine); };
		var seen = {}, keep = [], sunk = [];
		list(items).forEach(function (x) {
			if (!x || typeof x !== 'object') return;
			try {
				if (have(x)) return;
				if (typeof o.hidden === 'function' && o.hidden(x)) return;
				if (typeof o.heard === 'function') {
					var h = o.heard(x);
					if (h === true || (typeof h === 'number' && h > 0 && now - h < RECENT_MS)) return;
				}
			} catch (e) { return; }
			var ids = idsOf(x);
			if (!ids.length || ids.some(function (i) { return seen[i]; })) return;
			ids.forEach(function (i) { seen[i] = true; });
			(countOf(shown[keyOf(x)]) >= SINK ? sunk : keep).push(x);
		});
		var out = keep.concat(sunk);
		return o.limit > 0 ? out.slice(0, o.limit) : out;
	}

	// Lanes in page order, each a list of items or { items, groups: [{ items }] }: every
	// item stays only in the first lane that has it. The same shapes come back, new.
	function dedupeLanes(lanes) {
		var seen = {};
		function take(items) {
			return list(items).filter(function (x) {
				var ids = idsOf(x);
				if (ids.some(function (i) { return seen[i]; })) return false;
				ids.forEach(function (i) { seen[i] = true; });
				return true;
			});
		}
		return list(lanes).map(function (l) {
			if (Array.isArray(l)) return take(l);
			if (!l || typeof l !== 'object') return l;
			var out = {};
			Object.keys(l).forEach(function (k) { out[k] = l[k]; });
			if (Array.isArray(l.groups)) {
				out.groups = l.groups.map(function (g) { var c = {}; Object.keys(g || {}).forEach(function (k) { c[k] = g[k]; }); c.items = take(g && g.items); return c; });
				if (Array.isArray(l.items)) { var inGroups = {}; out.groups.forEach(function (g) { g.items.forEach(function (x) { inGroups[keyOf(x)] = true; }); }); out.items = l.items.filter(function (x) { return inGroups[keyOf(x)]; }); }
			} else if (Array.isArray(l.items)) out.items = take(l.items);
			return out;
		});
	}

	// ---- What was shown and what was touched ------------------------------------------------------

	// The shown book: { key: { n, at } }. seen() counts each key once more, unless it was
	// counted in the last 6 hours (a redraw, a quick return); old entries are forgotten.
	function seen(book, keys, now) {
		now = now == null ? Date.now() : +now;
		var out = {};
		Object.keys(book || {}).forEach(function (k) { var e = book[k]; if (e && typeof e === 'object' && now - num(e.at) < BOOK_KEEP_MS) out[k] = { n: num(e.n), at: num(e.at) }; });
		list(keys).forEach(function (k) {
			k = str(k);
			if (!k) return;
			var e = out[k];
			if (e && now - e.at < SEEN_GAP_MS) return;
			out[k] = { n: (e ? e.n : 0) + 1, at: now };
		});
		var all = Object.keys(out);
		if (all.length > BOOK_MAX) all.sort(function (a, b) { return out[a].at - out[b].at; }).slice(0, all.length - BOOK_MAX).forEach(function (k) { delete out[k]; });
		return out;
	}
	// The listener did something with these (played, previewed, saved, hid): they count from nothing.
	function touch(book, keys) {
		var out = {}, drop = {};
		(Array.isArray(keys) ? keys : [keys]).forEach(function (k) { drop[str(k)] = true; });
		Object.keys(book || {}).forEach(function (k) { if (!drop[k]) out[k] = book[k]; });
		return out;
	}
	function counts(book) { var out = {}; Object.keys(book || {}).forEach(function (k) { out[k] = countOf(book[k]); }); return out; }

	// ---- Visits and new releases ------------------------------------------------------------------

	// The kv record feed:visits ({ last, prev }) after a look at the page now, and `since`:
	// the visit before this one (0: the first). Looks within 6 hours are one visit.
	function visit(visits, now) {
		now = now == null ? Date.now() : +now;
		var last = num(visits && visits.last), prev = num(visits && visits.prev);
		if (!last) return { visits: { last: now, prev: 0 }, since: 0 };
		if (now - last < VISIT_GAP_MS) return { visits: { last: last, prev: prev }, since: prev };
		return { visits: { last: now, prev: last }, since: last };
	}
	function dayOf(ms) { return new Date(ms).toISOString().slice(0, 10); }
	// Releases (artists.js albums: `date` 'YYYY-MM-DD') in three groups: coming (after
	// today, soonest first), fresh (since the last visit, or the last 120 days on a first
	// visit) and earlier (the rest of the last 120 days, or since the last visit when that
	// was longer ago, a year at most), both newest first. `from` is the first day shown.
	function releases(albums, o) {
		o = o || {};
		var now = o.now == null ? Date.now() : +o.now, since = num(o.since);
		var start = now - RELEASE_DAYS * DAY;
		if (since > 0 && since < start) start = Math.max(since, now - RELEASE_MAX_DAYS * DAY);
		var today = dayOf(now), from = dayOf(start), cut = since > 0 ? dayOf(since) : '';
		var out = { coming: [], fresh: [], earlier: [], from: from };
		list(albums).forEach(function (a) {
			var d = str(a && a.date).slice(0, 10);
			if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return;
			if (d > today) out.coming.push(a);
			else if (d < from) return;
			else if (!cut || d > cut) out.fresh.push(a);
			else out.earlier.push(a);
		});
		function newest(a, b) { return cmp(b.date, a.date) || cmp(a.title, b.title); }
		out.coming.sort(function (a, b) { return cmp(a.date, b.date) || cmp(a.title, b.title); });
		out.fresh.sort(newest);
		out.earlier.sort(newest);
		return out;
	}

	// Franchises ({ title, have, total }) with songs still missing, the closest to complete
	// first: the fewest missing, then the larger share had, then the title.
	function byCompletion(fr) {
		return list(fr).filter(function (f) { return f && num(f.total) > num(f.have); }).slice().sort(function (a, b) {
			var ma = num(a.total) - num(a.have), mb = num(b.total) - num(b.have);
			return ma - mb || (num(b.have) / num(b.total)) - (num(a.have) / num(a.total)) || cmp(a.title, b.title);
		});
	}

	// Uploads after a moment (ms): finds with addedAt (an ISO time), newest first.
	function newSince(finds, mark) {
		mark = num(mark);
		return list(finds).filter(function (f) { var t = timeOf(f && f.addedAt); return t > 0 && t > mark; }).sort(function (a, b) { return timeOf(b.addedAt) - timeOf(a.addedAt); });
	}
	// A moment in words, by the local calendar: 'today', 'yesterday', a weekday within the
	// last six days ('Tuesday'), else 'Oct 3' (and the year when it is not this year's).
	function sinceWords(ms, now) {
		now = now == null ? Date.now() : +now;
		var d = new Date(+ms), n = new Date(now);
		var a = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(), b = new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime();
		var days = Math.round((b - a) / DAY);
		if (days <= 0) return 'today';
		if (days === 1) return 'yesterday';
		if (days < 7) return WEEKDAYS[d.getDay()];
		return MONTHS[d.getMonth()] + ' ' + d.getDate() + (d.getFullYear() !== n.getFullYear() ? ', ' + d.getFullYear() : '');
	}

	// Items in their order, no key twice in a row where another can come between: a round
	// over the keys, each key's items in their own order (a preview list, one artist at a time).
	function interleave(items, key) {
		var by = {}, order = [], out = [];
		list(items).forEach(function (x) { var k = str(key(x)); if (!has(by, k)) { by[k] = []; order.push(k); } by[k].push(x); });
		for (var more = true; more;) {
			more = false;
			order.forEach(function (k) { if (by[k].length) { out.push(by[k].shift()); more = true; } });
		}
		return out;
	}

	// The New songs dial's word for a ratio: the nearest of None (0), Some (0.5), Lots (0.8).
	function ratioName(r) {
		r = num(r);
		var best = RATIOS[0];
		RATIOS.forEach(function (x) { if (Math.abs(x[1] - r) < Math.abs(best[1] - r)) best = x; });
		return best[0];
	}

	// ---- Moving the old Discover page's keys -------------------------------------------------------

	// The old hub's records, as engine.js and artists.js keep them now. kv: { key: value }
	// for the keys read (missing ones may be left out). -> { set: { key: value }, remove: [keys] }:
	// - discover:saved ([{ id, title, artist, preview, cover, album, videoId, channel, savedAt }])
	//   joins finds:saved as finds (a video's 'v:<id>', else Deezer's 'dz:track:<id>'), each once, newest first;
	// - discover:hidden ({ folded name: true }) joins finds:hidden.artist ({ folded name: ms });
	// - discover:ids ({ artist key: { id, name, picture } }: Deezer artists checked against the
	//   library) become artists.js records in finds:map (artist:<key>, Deezer sure, checked now),
	//   only for artists it has no record of yet.
	// The old keys are listed in `remove`. Running it again changes nothing.
	function migrate(kv, now) {
		kv = kv || {};
		now = now == null ? Date.now() : +now;
		var set = {}, remove = [];
		var Src = mod('sources'), make = Src && Src.find ? Src.find : function (f) { return f; };
		var oldSaved = kv['discover:saved'], oldHidden = kv['discover:hidden'], oldIds = kv['discover:ids'];
		if (Array.isArray(oldSaved)) {
			remove.push('discover:saved');
			var saved = Array.isArray(kv['finds:saved']) ? copy(kv['finds:saved']) : [], keys = {};
			saved.forEach(function (f) { if (f && f.key) keys[f.key] = true; });
			var added = 0;
			oldSaved.forEach(function (s) {
				if (!s || (!s.videoId && s.id == null)) return;
				var f = s.videoId
					? make({ key: 'v:' + s.videoId, videoId: s.videoId, title: s.title, artist: s.artist, album: s.album, cover: s.cover, preview: s.preview, channel: s.channel, source: 'saved' })
					: make({ title: s.title, artist: s.artist, album: s.album, cover: s.cover, preview: s.preview, source: 'deezer', ids: { dz: s.id } });
				if (!f.key) f.key = 'dz:track:' + s.id;
				if (keys[f.key]) return;
				keys[f.key] = true;
				f.savedAt = num(s.savedAt) || now;
				saved.push(f);
				added++;
			});
			if (added) {
				saved.sort(function (a, b) { return num(b.savedAt) - num(a.savedAt); });
				set['finds:saved'] = saved.slice(0, SAVED_MAX);
			}
		}
		if (oldHidden && typeof oldHidden === 'object') {
			remove.push('discover:hidden');
			var hid = kv['finds:hidden'] && typeof kv['finds:hidden'] === 'object' ? copy(kv['finds:hidden']) : {}, more = false;
			['artist', 'song', 'work', 'channel'].forEach(function (k) { if (!hid[k] || typeof hid[k] !== 'object') hid[k] = {}; });
			Object.keys(oldHidden).forEach(function (name) {
				var k = fold(name);
				if (!oldHidden[name] || !k || hid.artist[k]) return;
				hid.artist[k] = now;
				more = true;
			});
			if (more) set['finds:hidden'] = hid;
		}
		if (oldIds && typeof oldIds === 'object') {
			remove.push('discover:ids');
			var map = kv['finds:map'] && typeof kv['finds:map'] === 'object' ? copy(kv['finds:map']) : {}, put = false;
			Object.keys(oldIds).forEach(function (key) {
				var d = oldIds[key];
				if (!key || key === 'undefined' || !d || d.id == null || has(map, 'artist:' + key)) return;
				map['artist:' + key] = {
					key: key, name: str(d.name), itunes: null, animethemes: null,
					deezer: { id: d.id, name: str(d.name), sure: true, why: 'title', picture: str(d.picture), fans: 0 },
					sure: true, at: now, no: [], yes: {}, checked: { deezer: now }, cands: []
				};
				put = true;
			});
			if (put) set['finds:map'] = map;
		}
		return { set: set, remove: remove };
	}
	var MIGRATE_KEYS = ['discover:saved', 'discover:hidden', 'discover:ids', 'finds:saved', 'finds:hidden', 'finds:map'];
	// migrate() on a store.js store: reads the keys, writes what changed, removes the old
	// ones. Run it before the engine starts (engine.js reads finds:saved and finds:hidden
	// once) and before artists.js reads finds:map. -> Promise<{ set, remove }>
	function migrateStore(store, now) {
		if (!store || typeof store.get !== 'function') return Promise.resolve({ set: {}, remove: [] });
		return Promise.all(MIGRATE_KEYS.map(function (k) { return store.get(k, null); })).then(function (vals) {
			var kv = {};
			MIGRATE_KEYS.forEach(function (k, i) { if (vals[i] != null) kv[k] = vals[i]; });
			var r = migrate(kv, now);
			var writes = Object.keys(r.set).map(function (k) { return store.set(k, r.set[k]); });
			return Promise.all(writes).then(function () {
				return Promise.all(r.remove.map(function (k) { return typeof store.remove === 'function' ? store.remove(k) : store.set(k, null); }));
			}).then(function () { return r; });
		});
	}

	return {
		profile: profile, songWeight: songWeight, nextSeed: nextSeed,
		currentSeason: currentSeason, previousSeason: previousSeason, seasonName: seasonName,
		filter: filter, dedupeLanes: dedupeLanes, seen: seen, touch: touch, counts: counts,
		visit: visit, releases: releases, byCompletion: byCompletion, newSince: newSince, sinceWords: sinceWords,
		interleave: interleave, ratioName: ratioName, migrate: migrate, migrateStore: migrateStore,
		RATIOS: RATIOS, SEASONS: SEASONS, SINK: SINK, RECENT_MS: RECENT_MS, SEEN_GAP_MS: SEEN_GAP_MS, VISIT_GAP_MS: VISIT_GAP_MS, RELEASE_DAYS: RELEASE_DAYS, SEED_TOP: SEED_TOP
	};
});
