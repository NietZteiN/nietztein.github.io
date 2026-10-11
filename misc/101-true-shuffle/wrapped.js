/*
 * True Shuffle: your year (wrapped.js). A year in review at #/wrapped
 * (#/wrapped?year=2025 for another year) and three small lanes on the home
 * page: On this day, Rediscover old favourites, and one gentle nudge to like a
 * song played often. The counting is pure and runs in Node; the drawing uses
 * only the narrow view of the app that app.js hands page files (pageCtx).
 *
 *     W.yearStats(history, tracks, year, { now, local, top }) -> the year in numbers
 *     W.onThisDay(history, tracks, now, { local }) -> { added: [{ id, year, ago }], played: [{ id, plays, year, ago }] }
 *     W.rediscover(history, tracks, now, { n, local }) -> [{ id, last, score }]
 *     W.nudges(tracks, history, now) -> [ids]
 *     W.years(history, tracks, { local }) -> [2026, 2025]
 *     W.yearText(stats, tracks) -> a short plain-text summary
 *     W.view(view, ctx, parts, query)      W.homeLanes(view, ctx)
 *
 * history is the store's listens, { id, at, kind: 'play' | 'skip', listenedSec },
 * in any order; tracks is { id: track } or a list. Listens of songs that are
 * not in tracks are left out. Days, months and years are UTC unless
 * { local: true }: the page passes it, so that a day is the reader's own day.
 *
 * UMD: window.TrueShuffle.wrapped in the browser, module.exports in Node.
 */
(function (root, factory) {
	var api = factory();
	if (typeof module === 'object' && module.exports) module.exports = api;
	else { root.TrueShuffle = root.TrueShuffle || {}; root.TrueShuffle.wrapped = api; }
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
	'use strict';

	var DAY = 86400000;
	var DISCOVERED = 'local:discovered';            // finds.js DISCOVERED: songs kept from Discover
	var TOP = 50;                                   // the length of each top list
	var LOVED_RATING = 4, LOVED_PLAYS = 5, REST_DAYS = 180, REDISCOVER_N = 12;
	var NUDGE_DAYS = 60, NUDGE_PLAYS = 6, FULL = 0.9;   // a play heard to 90% of its length is a full one
	var REPEAT_PLAYS = 5, SKIPPED_MIN = 3;
	var RATING_WEIGHT = [1, 0.1, 0.4, 1, 2.5, 6];   // unrated, then one to five stars (shuffle.js favouriteWeight)
	var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
	var WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

	// ---- Dates ------------------------------------------------------------------------------

	function toMs(v) {
		if (typeof v === 'number') return isFinite(v) ? v : NaN;
		if (v instanceof Date) return v.getTime();
		if (typeof v === 'string' && v) return Date.parse(v);
		return NaN;
	}
	function pad(k) { return (k < 10 ? '0' : '') + k; }
	// The calendar parts of a moment, in UTC or on the reader's own clock.
	function parts(ms, local) {
		var d = new Date(ms);
		if (local) return { y: d.getFullYear(), m: d.getMonth(), d: d.getDate(), h: d.getHours(), wd: d.getDay() };
		return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate(), h: d.getUTCHours(), wd: d.getUTCDay() };
	}
	function dayKey(p) { return p.y + '-' + pad(p.m + 1) + '-' + pad(p.d); }
	function monthKey(p) { return p.y + '-' + pad(p.m + 1); }
	// 'YYYY-MM-DD' -> a day number, so that days in a row differ by one
	function dayNumber(key) { var a = String(key).split('-'); return Math.round(Date.UTC(+a[0], +a[1] - 1, +a[2] || 1) / DAY); }
	function isLeap(y) { return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0; }
	function cmp(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
	function zeros(k) { var a = []; for (var i = 0; i < k; i++) a.push(0); return a; }

	// ---- Tracks -----------------------------------------------------------------------------

	function trackMap(tracks) {
		if (!Array.isArray(tracks)) return tracks || {};
		var m = {};
		tracks.forEach(function (t) { if (t && t.id != null) m[t.id] = t; });
		return m;
	}
	function known(map, id) { return id != null && Object.prototype.hasOwnProperty.call(map, id) && !!map[id]; }
	// When a track first came into the library: the earliest of its playlist additions.
	function firstAdded(t) {
		var best = 0, a = t && t.addedAt;
		for (var k in a) {
			if (!Object.prototype.hasOwnProperty.call(a, k)) continue;
			var x = toMs(a[k]);
			if (x > 0 && (!best || x < best)) best = x;
		}
		return best;
	}
	// library.js playable(), and not blocked
	function canPlay(t) { return !!t && !t.removed && t.embeddable !== false && !t.playerError && !t.blocked; }
	function discovered(t) { return (Array.isArray(t.playlists) && t.playlists.indexOf(DISCOVERED) >= 0) || !!(t.addedAt && t.addedAt[DISCOVERED]); }
	function titleOf(t) { return (t && (t.title || (t.raw && t.raw.title))) || 'Untitled'; }
	function artistOf(t) { return t && t.artist ? t.artist : t && t.artistGuess ? t.artistGuess : 'Unknown artist'; }
	// A listen's time, or NaN when it is not a listen of a known song.
	function listenAt(e, map) { return e && known(map, e.id) ? toMs(e.at) : NaN; }

	// ---- The year in numbers ----------------------------------------------------------------
	// Tops count plays only (kind 'play'); minutes are what was heard (listenedSec),
	// skips included. Listens after opts.now are left out.

	function yearStats(history, tracks, year, opts) {
		opts = opts || {};
		var local = !!opts.local, now = toMs(opts.now);
		if (isNaN(now)) now = Date.now();
		year = Math.floor(+year) || parts(now, local).y;
		var top = opts.top > 0 ? Math.floor(opts.top) : TOP;
		var map = trackMap(tracks);
		var st = {
			year: year, listens: 0, plays: 0, skips: 0, seconds: 0, minutes: 0, songs: 0, artists: 0,
			days: 0, longestStreak: 0, streakFrom: '', streakTo: '',
			topSongs: [], topArtists: [], topWorks: [], topGenres: [], topMoods: [], topScenes: [],
			firstSong: null, lastSong: null, busiestMonth: null, busiestDay: null,
			hours: zeros(24), weekdays: zeros(7), months: zeros(12),
			newSongs: [], discoveries: [], mostSkipped: null, onRepeat: null
		};
		var songs = Object.create(null), byDay = Object.create(null), byMonth = Object.create(null), rep = Object.create(null);
		(history || []).forEach(function (e) {
			var at = listenAt(e, map);
			if (isNaN(at) || at > now) return;
			var play = e.kind === 'play';
			if (!play && e.kind !== 'skip') return;
			var p = parts(at, local);
			if (p.y !== year) return;
			var sec = Math.max(0, +e.listenedSec || 0);
			var s = songs[e.id] || (songs[e.id] = { id: e.id, plays: 0, skips: 0, sec: 0, first: 0 });
			st.listens++;
			st.seconds += sec;
			s.sec += sec;
			if (!play) { st.skips++; s.skips++; return; }
			st.plays++;
			s.plays++;
			if (!s.first || at < s.first) s.first = at;
			var dk = dayKey(p), mk = monthKey(p);
			byDay[dk] = (byDay[dk] || 0) + 1;
			byMonth[mk] = (byMonth[mk] || 0) + 1;
			st.hours[p.h]++;
			st.weekdays[p.wd]++;
			st.months[p.m]++;
			var r = rep[e.id] || (rep[e.id] = Object.create(null));
			r[dk] = (r[dk] || 0) + 1;
			if (!st.firstSong || at < st.firstSong.at) st.firstSong = { id: e.id, at: at };
			if (!st.lastSong || at > st.lastSong.at) st.lastSong = { id: e.id, at: at };
		});
		st.seconds = Math.round(st.seconds);
		st.minutes = Math.round(st.seconds / 60);
		var all = Object.keys(songs).map(function (k) { return songs[k]; });
		var played = all.filter(function (s) { return s.plays > 0; }).sort(function (a, b) {
			return b.plays - a.plays || b.sec - a.sec || a.first - b.first || cmp(a.id, b.id);
		});
		st.songs = played.length;
		st.topSongs = played.slice(0, top).map(function (s) { return { id: s.id, plays: s.plays, minutes: Math.round(s.sec / 60) }; });

		// Artists, works, genres, moods and scenes: the plays of their songs, the songs most played first.
		var g = { artist: Object.create(null), work: Object.create(null), genre: Object.create(null), mood: Object.create(null), scene: Object.create(null) };
		function bump(group, key, s, name) {
			var e = group[key] || (group[key] = { key: key, plays: 0, ids: [], names: Object.create(null) });
			e.plays += s.plays;
			e.ids.push(s.id);
			if (name) e.names[name] = (e.names[name] || 0) + s.plays;
		}
		played.forEach(function (s) {
			var t = map[s.id], seen = Object.create(null);
			if (t.artistKey) bump(g.artist, t.artistKey, s, t.artist);
			if (t.work) bump(g.work, t.work, s);
			(Array.isArray(t.genres) ? t.genres : []).forEach(function (x) { if (x && !seen[x]) { seen[x] = true; bump(g.genre, x, s); } });
			if (t.mood) bump(g.mood, t.mood, s);
			if (t.scene) bump(g.scene, t.scene, s);
		});
		function ranked(group) {
			return Object.keys(group).map(function (k) { return group[k]; }).sort(function (a, b) { return b.plays - a.plays || b.ids.length - a.ids.length || cmp(a.key, b.key); });
		}
		function commonest(names) {
			var best = '', c = -1;
			Object.keys(names).sort().forEach(function (k) { if (names[k] > c) { c = names[k]; best = k; } });
			return best;
		}
		function plain(e) { return { key: e.key, plays: e.plays, ids: e.ids }; }
		var arts = ranked(g.artist);
		st.artists = arts.length;
		st.topArtists = arts.slice(0, top).map(function (e) { return { key: e.key, name: commonest(e.names) || e.key, plays: e.plays, ids: e.ids }; });
		st.topWorks = ranked(g.work).slice(0, top).map(plain);
		st.topGenres = ranked(g.genre).slice(0, top).map(plain);
		st.topMoods = ranked(g.mood).slice(0, top).map(plain);
		st.topScenes = ranked(g.scene).slice(0, top).map(plain);

		// Days with a play, the longest run of them, the busiest day and month (the first of equals).
		var days = Object.keys(byDay).sort(), run = 0, from = '', prev = NaN;
		st.days = days.length;
		days.forEach(function (k) {
			var dn = dayNumber(k);
			if (dn === prev + 1) run++;
			else { run = 1; from = k; }
			prev = dn;
			if (run > st.longestStreak) { st.longestStreak = run; st.streakFrom = from; st.streakTo = k; }
			if (!st.busiestDay || byDay[k] > st.busiestDay.plays) st.busiestDay = { date: k, plays: byDay[k] };
		});
		Object.keys(byMonth).sort().forEach(function (k) { if (!st.busiestMonth || byMonth[k] > st.busiestMonth.plays) st.busiestMonth = { month: k, plays: byMonth[k] }; });

		// On repeat: the most plays of one song on one day, five or more.
		Object.keys(rep).sort().forEach(function (id) {
			Object.keys(rep[id]).sort().forEach(function (dk) {
				var c = rep[id][dk], o = st.onRepeat;
				if (c < REPEAT_PLAYS) return;
				if (!o || c > o.plays || (c === o.plays && dk < o.date)) st.onRepeat = { id: id, date: dk, plays: c };
			});
		});
		// Skipped the most: three skips or more; of equals, the one played least.
		all.slice().sort(function (a, b) { return cmp(a.id, b.id); }).forEach(function (s) {
			var o = st.mostSkipped;
			if (s.skips < SKIPPED_MIN) return;
			if (!o || s.skips > o.skips || (s.skips === o.skips && s.plays < o.plays)) st.mostSkipped = { id: s.id, skips: s.skips, plays: s.plays };
		});

		// Songs first added this year, oldest first; those kept from Discover among them.
		var fresh = [];
		Object.keys(map).forEach(function (id) {
			var t = map[id], f = t ? firstAdded(t) : 0;
			if (f && parts(f, local).y === year) fresh.push({ id: id, at: f, kept: discovered(t) });
		});
		fresh.sort(function (a, b) { return a.at - b.at || cmp(a.id, b.id); });
		st.newSongs = fresh.map(function (x) { return x.id; });
		st.discoveries = fresh.filter(function (x) { return x.kept; }).map(function (x) { return x.id; });
		return st;
	}

	// ---- On this day ------------------------------------------------------------------------
	// Songs first added on this month and day in earlier years (oldest first), and songs played
	// on it in earlier years (most played first). On February 28 of a year without a 29th, the
	// 29ths of earlier years count too.

	function onThisDay(history, tracks, now, opts) {
		var local = !!(opts && opts.local), at = toMs(now);
		if (isNaN(at)) at = Date.now();
		var np = parts(at, local), map = trackMap(tracks);
		var leap = np.m === 1 && np.d === 28 && !isLeap(np.y);
		function onDay(p) { return p.y < np.y && ((p.m === np.m && p.d === np.d) || (leap && p.m === 1 && p.d === 29)); }
		var added = [];
		Object.keys(map).forEach(function (id) {
			var t = map[id], f = t ? firstAdded(t) : 0;
			if (!f) return;
			var p = parts(f, local);
			if (onDay(p)) added.push({ id: id, year: p.y, ago: np.y - p.y, at: f });
		});
		added.sort(function (a, b) { return b.ago - a.ago || a.at - b.at || cmp(a.id, b.id); });
		var by = Object.create(null), played = [];
		(history || []).forEach(function (e) {
			if (!e || e.kind !== 'play') return;
			var t2 = listenAt(e, map);
			if (isNaN(t2)) return;
			var p = parts(t2, local);
			if (!onDay(p)) return;
			var x = by[e.id];
			if (!x) { x = by[e.id] = { id: e.id, plays: 0, year: p.y, ago: 0 }; played.push(x); }
			x.plays++;
			if (p.y > x.year) x.year = p.y;
		});
		played.forEach(function (x) { x.ago = np.y - x.year; });
		played.sort(function (a, b) { return b.plays - a.plays || b.year - a.year || cmp(a.id, b.id); });
		return { added: added.map(function (x) { return { id: x.id, year: x.year, ago: x.ago }; }), played: played };
	}

	// ---- Rediscover -------------------------------------------------------------------------
	// Songs loved before (rated four or more, or played five times or more, by the track's
	// count or the history's) and not played in the last 180 days: lastPlayed and the history
	// both count, and a song added in those days is not "before". Blocked, unplayable songs and
	// clips are left out. Best first: shuffle.js's favourite weight, then the longest unheard.
	// -> [{ id, last (the last play in ms, 0 for never), score }]

	function rediscover(history, tracks, now, opts) {
		opts = opts || {};
		var at = toMs(now);
		if (isNaN(at)) at = Date.now();
		var n = opts.n > 0 ? Math.floor(opts.n) : REDISCOVER_N;
		var cutoff = at - REST_DAYS * DAY, map = trackMap(tracks);
		var last = Object.create(null), count = Object.create(null);
		(history || []).forEach(function (e) {
			if (!e || e.kind !== 'play') return;
			var t = listenAt(e, map);
			if (isNaN(t)) return;
			count[e.id] = (count[e.id] || 0) + 1;
			if (!(last[e.id] >= t)) last[e.id] = t;
		});
		var out = [];
		Object.keys(map).forEach(function (id) {
			var t = map[id];
			if (!canPlay(t) || t.kind === 'clip') return;
			var plays = Math.max(+t.plays || 0, count[id] || 0), rating = Math.max(0, Math.min(5, Math.round(+t.rating || 0)));
			if (rating < LOVED_RATING && plays < LOVED_PLAYS) return;
			var lp = Math.max(toMs(t.lastPlayed) || 0, last[id] || 0);
			if (Math.max(lp, firstAdded(t)) >= cutoff) return;
			var skips = +t.skips || 0;
			var score = RATING_WEIGHT[rating] * (1 + Math.log(1 + plays) / Math.LN2) / (1 + skips / (plays + 1));
			out.push({ id: id, last: lp, score: Math.round(score * 1000) / 1000 });
		});
		out.sort(function (a, b) { return b.score - a.score || a.last - b.last || cmp(a.id, b.id); });
		return out.slice(0, n);
	}

	// ---- Nudges -----------------------------------------------------------------------------
	// Songs played to the end six times or more in the last 60 days and not liked (rated under
	// four), most played first. A play is a full one when 90% of the track's length was heard;
	// without a length (or a listenedSec), the history's 'play' decides. Blocked songs never.

	function nudgeRows(tracks, history, now) {
		var at = toMs(now);
		if (isNaN(at)) at = Date.now();
		var since = at - NUDGE_DAYS * DAY, map = trackMap(tracks);
		var c = Object.create(null), lastAt = Object.create(null);
		(history || []).forEach(function (e) {
			if (!e || e.kind !== 'play') return;
			var t = listenAt(e, map);
			if (isNaN(t) || t < since || t > at) return;
			var dur = +map[e.id].durationSec || 0;
			if (dur > 0 && e.listenedSec != null && +e.listenedSec < FULL * dur) return;
			c[e.id] = (c[e.id] || 0) + 1;
			if (!(lastAt[e.id] >= t)) lastAt[e.id] = t;
		});
		return Object.keys(c).filter(function (id) {
			var t = map[id];
			return c[id] >= NUDGE_PLAYS && (+t.rating || 0) < LOVED_RATING && !t.blocked;
		}).sort(function (a, b) { return c[b] - c[a] || lastAt[b] - lastAt[a] || cmp(a, b); }).map(function (id) {
			return { id: id, plays: c[id], last: lastAt[id] };
		});
	}
	function nudges(tracks, history, now) { return nudgeRows(tracks, history, now).map(function (r) { return r.id; }); }

	// ---- Years ------------------------------------------------------------------------------
	// The years with at least one play of a known song, newest first.

	function years(history, tracks, opts) {
		var local = !!(opts && opts.local), map = trackMap(tracks), seen = Object.create(null), out = [];
		(history || []).forEach(function (e) {
			if (!e || e.kind !== 'play') return;
			var t = listenAt(e, map);
			if (isNaN(t)) return;
			var y = parts(t, local).y;
			if (!seen[y]) { seen[y] = true; out.push(y); }
		});
		return out.sort(function (a, b) { return b - a; });
	}

	// ---- The year as plain text (Copy as text) ----------------------------------------------

	function num(k) { return String(Math.round(+k || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
	function count(k, one, many) { return num(k) + ' ' + (k === 1 ? one : (many || one + 's')); }
	function monthName(key) { return MONTHS[+String(key).slice(5, 7) - 1] || String(key); }
	function yearText(st, tracks) {
		var map = trackMap(tracks), out = ['My ' + st.year + ' in music'];
		if (!st.plays) { out.push('Nothing counted yet.'); return out.join('\n'); }
		out.push(count(st.minutes, 'minute') + ', ' + count(st.plays, 'play') + ' of ' + count(st.songs, 'song') + ' by ' + count(st.artists, 'artist') + '.');
		out.push(count(st.days, 'day') + ' with music; the longest streak ' + count(st.longestStreak, 'day') + ' in a row.');
		var songs = st.topSongs.filter(function (s) { return known(map, s.id); }).slice(0, 5);
		if (songs.length) {
			out.push('', 'Top songs');
			songs.forEach(function (s, i) { var t = map[s.id]; out.push((i + 1) + '. ' + titleOf(t) + ' - ' + artistOf(t) + ' (' + count(s.plays, 'play') + ')'); });
		}
		if (st.topArtists.length) out.push('', 'Top artists: ' + st.topArtists.slice(0, 5).map(function (a) { return a.name; }).join(', '));
		if (st.topGenres.length) out.push('Top genres: ' + st.topGenres.slice(0, 3).map(function (x) { return x.key; }).join(', '));
		if (st.busiestMonth) out.push('Busiest month: ' + monthName(st.busiestMonth.month) + ' (' + count(st.busiestMonth.plays, 'play') + ')');
		out.push('', '- True Shuffle');
		return out.join('\n');
	}

	// =========================================================================================
	// The page. Drawn only with ctx (app.js pageCtx). Titles are untrusted text: everything
	// goes on the page through ctx.h, which uses textContent.
	// =========================================================================================

	var CSS_ID = 'ts-wrapped-css';
	var CSS = [
		'.ts-wr-badge { flex-direction: column; gap: 4%; color: #fff; }',
		'.ts-wr-badge .ts-i { width: 22%; height: 22%; opacity: 0.92; }',
		'.ts-wr-badge-y { font-size: clamp(26px, 27cqi, 56px); font-weight: 800; line-height: 1; letter-spacing: -0.03em; }',
		'.ts-wr-years { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin: 6px 0 2px; }',
		'.ts-wr-years-h { margin-right: 2px; font-size: 12.5px; font-weight: 650; color: var(--text-2); }',
		'.ts-wr-tiles { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin: 18px 0 4px; }',
		'@container (min-width: 720px) { .ts-wr-tiles { grid-template-columns: repeat(4, minmax(0, 1fr)); } }',
		'.ts-wr-tile { display: flex; flex-direction: column; gap: 2px; min-width: 0; padding: 14px 16px; border-radius: 12px; background: var(--surface-2); }',
		'.ts-wr-tile.is-hero { grid-column: 1 / -1; background: linear-gradient(120deg, color-mix(in srgb, var(--ts-play) 20%, var(--surface-2)), var(--surface-2) 75%); }',
		'.ts-wr-tile-v { font-size: 30px; font-weight: 800; line-height: 1.1; letter-spacing: -0.02em; color: var(--heading); }',
		'.ts-wr-tile.is-hero .ts-wr-tile-v { font-size: clamp(40px, 8cqi, 64px); }',
		'.ts-wr-tile-l { font-size: 13.5px; font-weight: 650; color: var(--text); }',
		'.ts-wr-tile-s { font-size: 12.5px; color: var(--text-2); overflow-wrap: anywhere; }',
		'.ts-wr-top { list-style: none; margin: 0; padding: 0; max-width: 820px; }',
		'.ts-wr-song { display: grid; grid-template-columns: 26px 48px minmax(0, 1fr) auto; align-items: center; gap: 12px; padding: 6px 6px 6px 2px; border-radius: 10px; }',
		'.ts-wr-song:hover, .ts-wr-song:focus-within { background: var(--ts-hover); }',
		'.ts-wr-song .ts-art { width: 48px; height: 48px; border-radius: 6px; }',
		'.ts-wr-rank { text-align: right; font-size: 17px; font-weight: 800; color: var(--text-2); }',
		'.ts-wr-song.is-first { grid-template-columns: 26px 72px minmax(0, 1fr) auto; margin-bottom: 4px; padding: 10px 6px 10px 2px; background: linear-gradient(90deg, color-mix(in srgb, var(--ts-play) 14%, transparent), transparent 85%); }',
		'.ts-wr-song.is-first .ts-art { width: 72px; height: 72px; border-radius: 8px; }',
		'.ts-wr-song.is-first .ts-wr-rank { font-size: 26px; color: var(--heading); }',
		'.ts-wr-song.is-first .ts-wr-song-title { font-size: 18px; }',
		'.ts-wr-song-text { display: flex; flex-direction: column; gap: 1px; min-width: 0; }',
		'.ts-wr-song-title { font-weight: 650; color: var(--heading); text-decoration: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
		'.ts-wr-song-title:hover { text-decoration: underline; }',
		'.ts-wr-song-sub { font-size: 12.5px; line-height: 1.35; color: var(--text-2); overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }',
		'.ts-wr-song-sub a { color: inherit; text-decoration: none; }',
		'.ts-wr-song-sub a:hover { color: var(--text); text-decoration: underline; }',
		'.ts-btn.ts-wr-play { color: var(--ts-play); }',
		'.ts-wr-more { margin: 8px 0 0 2px; }',
		'.ts-wr-sound { display: grid; grid-template-columns: 70px minmax(0, 1fr); gap: 10px 12px; align-items: start; max-width: 980px; }',
		'.ts-wr-sound-h { padding-top: 5px; font-size: 12.5px; font-weight: 700; color: var(--text-2); }',
		'.ts-wr-sound .ts-chips { margin: 0; }',
		'@container (max-width: 520px) { .ts-wr-sound { grid-template-columns: minmax(0, 1fr); gap: 4px; } .ts-wr-sound-h { padding-top: 8px; } }',
		'.ts-wr-charts { display: grid; grid-template-columns: minmax(0, 1fr); gap: 14px; }',
		'@container (min-width: 560px) { .ts-wr-charts { grid-template-columns: minmax(0, 1.5fr) minmax(0, 1fr); } }',
		'.ts-wr-chart { margin: 0; min-width: 0; padding: 14px 16px 12px; border: 1px solid var(--border); border-radius: 12px; background: var(--surface); }',
		'.ts-wr-chart.is-wide { grid-column: 1 / -1; }',
		'.ts-wr-chart h3 { margin: 0; font-size: 15.5px; color: var(--heading); }',
		'.ts-wr-note { margin: 2px 0 10px; min-height: 1.45em; font-size: 12.5px; color: var(--text-2); }',
		'.ts-wr-cols { display: flex; align-items: flex-end; gap: 2px; height: 128px; padding-top: 20px; border-bottom: 1px solid var(--border); }',
		'.ts-wr-col { flex: 1 1 0; min-width: 0; height: 100%; display: flex; align-items: flex-end; justify-content: center; }',
		'.ts-wr-col i { position: relative; display: block; width: 100%; max-width: 24px; border-radius: 4px 4px 0 0; background: var(--ts-bar-fill); }',
		'.ts-wr-col.is-hover i { filter: brightness(1.2); }',
		'.ts-wr-col b { position: absolute; left: 50%; bottom: 100%; transform: translateX(-50%); margin-bottom: 3px; font-size: 11.5px; font-style: normal; font-weight: 700; color: var(--heading); white-space: nowrap; }',
		'.ts-wr-axis { display: flex; gap: 2px; margin-top: 5px; font-size: 11px; color: var(--text-2); }',
		'.ts-wr-axis span { flex: 1 1 0; min-width: 0; text-align: center; white-space: nowrap; }',
		'.ts-wr-moments { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 280px), 1fr)); gap: 10px; }',
		'.ts-wr-moment { display: flex; align-items: center; gap: 12px; min-width: 0; padding: 12px 14px; border-radius: 12px; background: var(--surface-2); color: inherit; text-decoration: none; }',
		'a.ts-wr-moment:hover { background: color-mix(in srgb, var(--surface-2) 75%, var(--border-strong)); }',
		'.ts-wr-moment > .ts-art, .ts-wr-moment-ic { width: 52px; height: 52px; border-radius: 8px; flex: none; }',
		'.ts-wr-moment-ic { display: flex; align-items: center; justify-content: center; background: color-mix(in srgb, var(--ts-play) 16%, transparent); color: var(--ts-play); }',
		'.ts-wr-moment-ic .ts-i { width: 26px; height: 26px; }',
		'.ts-wr-moment-t { display: flex; flex-direction: column; min-width: 0; }',
		'.ts-wr-moment-k { font-size: 11px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-2); }',
		'.ts-wr-moment-v { font-size: 16px; font-weight: 750; color: var(--heading); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
		'.ts-wr-moment-s { font-size: 12.5px; color: var(--text-2); overflow-wrap: anywhere; }',
		'.ts-wr-lede { margin: -4px 0 12px; font-size: 13.5px; color: var(--text-2); }',
		'.ts-wr-empty { max-width: 62ch; }',
		'.ts-wr-empty p { margin: 0 0 8px; }',
		'.ts-wr-empty b { color: var(--heading); }',
		'.ts-wr-foot { max-width: 72ch; margin: 36px 0 0; font-size: 12.5px; line-height: 1.5; color: var(--text-2); }',
		'.ts-wr-text { width: 100%; min-height: 240px; font: 13px/1.5 var(--font-mono); }',
		'.ts-wr-nudge { display: flex; flex-wrap: wrap; align-items: center; gap: 12px 14px; max-width: 820px; margin: 28px 0 4px; padding: 12px 14px; border: 1px solid var(--border); border-radius: 12px; background: var(--surface); }',
		'.ts-wr-nudge > .ts-art { width: 52px; height: 52px; border-radius: 8px; }',
		'.ts-wr-nudge-t { flex: 1 1 200px; min-width: 0; }',
		'.ts-wr-nudge-q { margin: 0; font-weight: 600; color: var(--heading); overflow-wrap: anywhere; }',
		'.ts-wr-nudge-q a { color: inherit; }',
		'.ts-wr-nudge-s { margin: 2px 0 0; font-size: 12.5px; color: var(--text-2); }',
		'.ts-wr-nudge-acts { display: flex; flex-wrap: wrap; gap: 8px; }',
		'.ts-btn.ts-wr-like .ts-i { color: var(--ts-like); }'
	].join('\n');
	function injectCss() {
		if (typeof document === 'undefined' || document.getElementById(CSS_ID)) return;
		var s = document.createElement('style');
		s.id = CSS_ID;
		s.textContent = CSS;
		(document.head || document.documentElement).appendChild(s);
	}

	// What the views count from: the index's tracks (Focus narrows them), else the library's.
	function scopeOf(ctx) {
		var ix = ctx.idx ? ctx.idx() : null;
		if (ix && Array.isArray(ix.all)) return trackMap(ix.all);
		var lib = ctx.lib ? ctx.lib() : null;
		return (lib && lib.tracks) || {};
	}
	function historyOf(ctx) { var hs = ctx.history ? ctx.history() : null; return Array.isArray(hs) ? hs : []; }

	// Words for dates, on the reader's clock.
	function hourName(hr) { return hr === 0 ? '12 am' : hr < 12 ? hr + ' am' : hr === 12 ? '12 pm' : (hr - 12) + ' pm'; }
	function dayText(ms) { var p = parts(ms, true); return MONTHS[p.m] + ' ' + p.d; }
	function clockText(ms) { var p = parts(ms, true), mi = new Date(ms).getMinutes(); return (p.h % 12 || 12) + ':' + pad(mi) + ' ' + (p.h < 12 ? 'am' : 'pm'); }
	function keyText(key, weekday) {
		var a = String(key).split('-'), wd = new Date(Date.UTC(+a[0], +a[1] - 1, +a[2])).getUTCDay();
		return (weekday ? WEEKDAYS[wd] + ', ' : '') + MONTHS[+a[1] - 1] + ' ' + (+a[2]);
	}
	function shortKey(key) { var a = String(key).split('-'); return MONTHS[+a[1] - 1].slice(0, 3) + ' ' + (+a[2]); }
	function dayOfYear(p) { return Math.round((Date.UTC(p.y, p.m, p.d) - Date.UTC(p.y, 0, 1)) / DAY) + 1; }
	function yearsAgo(k) { return k === 1 ? 'a year ago' : k + ' years ago'; }
	// When a song was last heard, short: the month within the last eleven months, else the year.
	function heardText(ms, now) { var p = parts(ms, true); return now - ms < 330 * DAY ? MONTHS[p.m] : String(p.y); }
	// '102 plays', '8 h 30 min': kept on one line where a sub-line wraps
	var NBSP = String.fromCharCode(160);
	function keep(s) { return String(s).replace(/ /g, NBSP); }
	function hoursText(minutes) {
		var hrs = Math.round(minutes / 60);
		if (hrs < 2) return '';
		return 'about ' + num(hrs) + ' hours' + (hrs >= 48 ? ', or ' + (Math.round(hrs / 2.4) / 10) + ' days' : '');
	}
	function remove(node) { if (node && node.parentNode) node.parentNode.removeChild(node); }

	// "Copy as text": a copy glyph of its own unless ui.js has one.
	var COPY_PATH = 'M8 3h11a2 2 0 0 1 2 2v11h-2V5H8zM4 7h11a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2zm0 2v11h11V9z';
	function copyIcon(ctx) {
		if (ctx.U.PATHS && ctx.U.PATHS.copy) return ctx.icon('copy');
		var NS = 'http://www.w3.org/2000/svg', svg = document.createElementNS(NS, 'svg'), p = document.createElementNS(NS, 'path');
		svg.setAttribute('viewBox', '0 0 24 24');
		svg.setAttribute('aria-hidden', 'true');
		svg.setAttribute('focusable', 'false');
		svg.setAttribute('class', 'ts-i');
		p.setAttribute('d', COPY_PATH);
		p.setAttribute('fill-rule', 'evenodd');
		svg.appendChild(p);
		return svg;
	}
	function copyButton(ctx, fn) {
		var b = ctx.U.btn({ label: 'Copy as text', variant: 'secondary', size: 'md', on: { click: fn } });
		b.insertBefore(copyIcon(ctx), b.firstChild);
		return b;
	}
	function copyText(ctx, text) {
		var cb = typeof navigator !== 'undefined' ? navigator.clipboard : null;
		if (!cb || !cb.writeText) { showText(ctx, text); return; }
		cb.writeText(text).then(function () { ctx.say('Your year is copied as text.'); }, function () { showText(ctx, text); });
	}
	// When the browser will not let the page copy: the text in a dialog, selected.
	function showText(ctx, text) {
		var d = ctx.U.openDialog({ title: 'Your year, as text' });
		var ta = ctx.h('textarea', { class: 'kit-input ts-wr-text', rows: '12', readonly: true, aria: { label: 'Your year, as text' } });
		ta.value = text;
		d.body.appendChild(ctx.h('p', { class: 'ts-muted', text: 'The browser did not let the page copy it. Select it and copy it (Ctrl+C).' }));
		d.body.appendChild(ta);
		try { ta.focus(); ta.select(); } catch (e) { /* gone */ }
	}

	// ---- #/wrapped --------------------------------------------------------------------------

	function view(el, ctx, routeParts, query) {
		injectCss();
		var h = ctx.h, W = ctx.words, now = ctx.now(), nowP = parts(now, true);
		var asked = query && query.get ? parseInt(query.get('year'), 10) : NaN;
		var year = asked >= 1970 && asked <= nowP.y ? asked : nowP.y, current = year === nowP.y;
		var map = scopeOf(ctx), hist = historyOf(ctx);
		var st = yearStats(hist, map, year, { now: now, local: true });
		var ys = years(hist, map, { local: true }).filter(function (y) { return y <= nowP.y; });
		if (ys.indexOf(year) < 0) { ys.push(year); ys.sort(function (a, b) { return b - a; }); }
		var href = ctx.link('wrapped') + '?year=' + year;
		var topIds = st.topSongs.map(function (s) { return s.id; });
		var playCtx = { label: 'Your top songs of ' + year, href: href };

		var badge = h('span', { class: 'ts-art ts-art-gen ts-hero-art ts-wr-badge', aria: { hidden: 'true' }, style: { '--h': '268', '--s': '62%' } }, [ctx.icon('sparkle'), h('span', { class: 'ts-wr-badge-y', text: String(year) })]);
		var blurb, meta, acts = null;
		if (st.plays) {
			var k = Math.min(TOP, topIds.length);
			blurb = (current ? 'So far, ' : '') + W.plural(st.plays, 'play') + ' of ' + W.plural(st.songs, 'song') + ' by ' + W.plural(st.artists, 'artist') + '.';
			meta = dayText(st.firstSong.at) + ' to ' + (current && dayText(st.lastSong.at) === dayText(now) ? 'today' : dayText(st.lastSong.at)) + ' ' + W.DOT + ' counted in this browser';
			acts = [
				ctx.ui.actionBtn('play', k >= TOP ? 'Play your top 50' : k === 1 ? 'Play your top song' : 'Play your top ' + k, function () { ctx.play.from(topIds, 0, playCtx); }, true),
				copyButton(ctx, function () { copyText(ctx, yearText(st, map)); }),
				ctx.lists && ctx.lists.create ? ctx.ui.actionBtn('playlist-new', 'Save as playlist' + W.ELL, function () { ctx.lists.create(topIds, 'Top songs of ' + year); }) : null
			].filter(Boolean);
		} else {
			blurb = current ? 'Your year in music fills in as you listen.' : 'Nothing was counted in ' + year + '.';
		}
		ctx.ui.headerBlock(el, { kicker: 'Your year in music', title: 'Your ' + year, blurb: blurb, meta: meta, hue: { h: 268, s: 55 }, artNode: badge, actions: acts });
		yearChips(el, ctx, ys, year);

		if (!st.plays) {
			el.appendChild(h('div', { class: 'ts-empty ts-wr-empty' }, [
				h('p', null, h('b', { text: current ? 'Nothing counted yet this year.' : 'No plays counted in ' + year + '.' })),
				h('p', { text: 'Listens are counted from now on: every song you play to the end, or at least half of it, adds to your year here, in this browser. Come back after a few days of music.' })
			]));
			newSongsSection(el, ctx, map, st, current);
			return;
		}

		// the year in five numbers
		var tiles = h('div', { class: 'ts-wr-tiles' });
		function tile(v, l, s, hero) {
			tiles.appendChild(h('div', { class: 'ts-wr-tile' + (hero ? ' is-hero' : '') }, [h('span', { class: 'ts-wr-tile-v', text: v }), h('span', { class: 'ts-wr-tile-l', text: l }), s ? h('span', { class: 'ts-wr-tile-s', text: s }) : null]));
		}
		var daysIn = current ? dayOfYear(nowP) : (isLeap(year) ? 366 : 365);
		tile(W.n(st.minutes), st.minutes === 1 ? 'minute of music' : 'minutes of music', hoursText(st.minutes), true);
		tile(W.n(st.songs), st.songs === 1 ? 'song' : 'different songs', W.plural(st.plays, 'play') + (st.skips ? ', ' + W.plural(st.skips, 'skip') : ''));
		tile(W.n(st.artists), st.artists === 1 ? 'artist' : 'artists', st.topArtists[0] ? 'Most of all ' + st.topArtists[0].name : '');
		tile(W.n(st.days), st.days === 1 ? 'day with music' : 'days with music', 'of ' + W.n(daysIn) + (current ? ' so far' : ''));
		tile(W.n(st.longestStreak), st.longestStreak === 1 ? 'day in a row' : 'days in a row', st.longestStreak > 1 ? 'Longest streak: ' + shortKey(st.streakFrom) + ' to ' + shortKey(st.streakTo) : 'Your longest streak');
		el.appendChild(tiles);

		topSongsSection(el, ctx, map, st, topIds, playCtx);
		topArtistsSection(el, ctx, map, st, href);
		topWorksSection(el, ctx, map, st, href);
		soundSection(el, ctx, st);

		ctx.ui.sectionHead(el, 'When you listened');
		var charts = h('div', { class: 'ts-wr-charts' });
		var hourNames = st.hours.map(function (v, i) { return hourName(i) + ' to ' + hourName((i + 1) % 24); });
		columnChart(charts, ctx, {
			title: 'Month by month', wide: true, values: st.months, col: 'Month',
			names: MONTHS, axis: MONTHS.map(function (m) { return m.slice(0, 3); }),
			lead: function (i, v) { return 'Most plays in ' + MONTHS[i] + ': ' + W.n(v) + '.'; }
		});
		columnChart(charts, ctx, {
			title: 'Your year by the hour', values: st.hours, col: 'Hour', names: hourNames,
			axis: st.hours.map(function (v, i) { return i % 6 === 0 ? hourName(i) : ''; }),
			lead: function (i, v) { return 'Most plays between ' + hourName(i) + ' and ' + hourName((i + 1) % 24) + ': ' + W.n(v) + '.'; }
		});
		columnChart(charts, ctx, {
			title: 'Your week', values: st.weekdays, col: 'Day', names: WEEKDAYS,
			axis: WEEKDAYS.map(function (d) { return d.slice(0, 3); }),
			lead: function (i, v) { return 'Most plays on ' + WEEKDAYS[i] + 's: ' + W.n(v) + '.'; }
		});
		el.appendChild(charts);

		highlightsSection(el, ctx, map, st, current);
		newSongsSection(el, ctx, map, st, current);

		var foot = 'A play is a song heard to the end or at least half of it; skips add to the minutes, not to the tops. Counted in this browser from the listens it keeps';
		if (hist.length >= 5000) {
			var oldest = Infinity;
			hist.forEach(function (e) { var t = toMs(e && e.at); if (t < oldest) oldest = t; });
			if (isFinite(oldest)) foot += ', your last ' + W.n(hist.length) + ', back to ' + dayText(oldest) + ', ' + parts(oldest, true).y;
		}
		el.appendChild(h('p', { class: 'ts-wr-foot', text: foot + '.' }));
	}

	function yearChips(el, ctx, ys, year) {
		if (ys.length < 2) return;
		var nav = ctx.h('nav', { class: 'ts-wr-years', aria: { label: 'Other years' } }, [ctx.h('span', { class: 'ts-wr-years-h', text: 'Years' })]);
		ys.forEach(function (y) {
			var c = ctx.ui.chip(String(y), ctx.link('wrapped') + '?year=' + y, null, y === year ? 'is-on' : '');
			if (y === year) c.setAttribute('aria-current', 'page');
			nav.appendChild(c);
		});
		el.appendChild(nav);
	}

	function songRow(ctx, map, s, i, ids, playCtx) {
		var h = ctx.h, W = ctx.words, t = map[s.id];
		var sub = h('span', { class: 'ts-wr-song-sub' }, [
			t.artistKey ? h('a', { href: ctx.link('artist', t.artistKey), text: W.artist(t) }) : W.artist(t),
			' ' + W.DOT + ' ' + keep(W.plural(s.plays, 'play')) + (s.minutes ? ' ' + W.DOT + ' ' + keep(W.longTime(s.minutes * 60)) : '')
		]);
		return h('li', { class: 'ts-wr-song' + (i === 0 ? ' is-first' : '') }, [
			h('span', { class: 'ts-wr-rank', aria: { hidden: 'true' }, text: String(i + 1) }),
			ctx.art(t, 'ts-wr-art'),
			h('span', { class: 'ts-wr-song-text' }, [h('a', { class: 'ts-wr-song-title', href: ctx.link('track', s.id), text: W.title(t) }), sub]),
			ctx.U.btn({ icon: 'play', iconOnly: true, label: 'Play ' + W.title(t), variant: 'icon', cls: 'ts-wr-play', on: { click: function () { ctx.play.from(ids, i, playCtx); } } })
		]);
	}
	function topSongsSection(el, ctx, map, st, ids, playCtx) {
		ctx.ui.sectionHead(el, 'Your top songs');
		var ol = ctx.h('ol', { class: 'ts-wr-top', aria: { label: 'Your top songs of ' + st.year } });
		var shown = Math.min(10, st.topSongs.length), i;
		for (i = 0; i < shown; i++) ol.appendChild(songRow(ctx, map, st.topSongs[i], i, ids, playCtx));
		el.appendChild(ol);
		if (st.topSongs.length <= shown) return;
		var more = ctx.U.btn({ label: 'Show all ' + st.topSongs.length, variant: 'ghost', size: 'sm', cls: 'ts-wr-more', on: { click: function () {
			for (var j = shown; j < st.topSongs.length; j++) ol.appendChild(songRow(ctx, map, st.topSongs[j], j, ids, playCtx));
			remove(more);
			var first = ol.children[shown] && ol.children[shown].querySelector('a');
			if (first) first.focus();
		} } });
		el.appendChild(more);
	}
	function topArtistsSection(el, ctx, map, st, href) {
		if (!st.topArtists.length) return;
		var W = ctx.words, useImg = !!(ctx.prefs && ctx.prefs().art) && !ctx.demo;
		ctx.ui.sectionHead(el, 'Your top artists', { href: '#/artists', text: 'All artists' });
		ctx.ui.shelf(el, st.topArtists.slice(0, 12).map(function (a) {
			var cover = map[a.ids[0]], hue = ctx.hue(cover);
			return ctx.ui.card({
				round: true, href: ctx.link('artist', a.key), art: ctx.U.art(cover.id, hue.h, a.name, 'is-round', useImg, hue.s), title: a.name, sub: W.plural(a.plays, 'play'),
				play: function () { ctx.play.from(a.ids, 0, { label: a.name + ' in ' + st.year, href: href }); }, playLabel: 'Play your ' + st.year + ' songs by ' + a.name
			});
		}));
	}
	function topWorksSection(el, ctx, map, st, href) {
		if (!st.topWorks.length) return;
		var W = ctx.words;
		ctx.ui.sectionHead(el, 'From your anime, games and stage', { href: '#/works', text: 'All of them' });
		ctx.ui.shelf(el, st.topWorks.slice(0, 12).map(function (w) {
			return ctx.ui.card({
				href: ctx.link('work', w.key), art: ctx.art(map[w.ids[0]]), title: w.key, sub: W.plural(w.plays, 'play'),
				play: function () { ctx.play.from(w.ids, 0, { label: w.key + ' in ' + st.year, href: href }); }, playLabel: 'Play your ' + st.year + ' songs from ' + w.key
			});
		}));
	}
	function chipRow(box, ctx, label, items) {
		if (!items.length) return;
		var chips = ctx.h('div', { class: 'ts-chips' });
		items.forEach(function (x) {
			var c = ctx.ui.chip(x.name, x.href, x.hue);
			c.appendChild(ctx.h('span', { class: 'ts-count', text: ctx.words.n(x.plays) }));
			chips.appendChild(c);
		});
		box.appendChild(ctx.h('span', { class: 'ts-wr-sound-h', text: label }));
		box.appendChild(chips);
	}
	function soundSection(el, ctx, st) {
		if (!st.topGenres.length && !st.topMoods.length && !st.topScenes.length) return;
		var T = ctx.T || {}, box = ctx.h('div', { class: 'ts-wr-sound' });
		ctx.ui.sectionHead(el, 'Your sound', { href: '#/genres', text: 'All genres' });
		chipRow(box, ctx, 'Genres', st.topGenres.slice(0, 12).map(function (g) { return { name: g.key, href: ctx.link('genre', g.key), hue: T.hueOf ? T.hueOf(g.key) : null, plays: g.plays }; }));
		chipRow(box, ctx, 'Moods', st.topMoods.map(function (m) { return { name: (T.MOOD_NAME && T.MOOD_NAME[m.key]) || m.key, href: ctx.link('c', 'mood', m.key), plays: m.plays }; }));
		chipRow(box, ctx, 'Scenes', st.topScenes.map(function (s) { return { name: (T.SCENE_NAME && T.SCENE_NAME[s.key]) || s.key, href: ctx.link('c', 'scene', s.key), plays: s.plays }; }));
		el.appendChild(box);
	}

	// A column chart of plain divs: one series in one hue (--ts-bar-fill), the highest
	// column labelled, a line above it that reads out the column under the pointer,
	// role="img" with a summary, and the numbers as a table for screen readers.
	// o: { title, values, names, axis, col (the table's first heading), lead(i, v), wide }
	function columnChart(box, ctx, o) {
		var h = ctx.h, W = ctx.words, max = 0, peak = -1, total = 0;
		o.values.forEach(function (v, i) { total += v; if (v > max) { max = v; peak = i; } });
		var lead = max ? o.lead(peak, max) : 'Nothing yet.';
		var note = h('p', { class: 'ts-wr-note', text: lead });
		var cols = h('div', { class: 'ts-wr-cols', role: 'img', aria: { label: o.title + ': ' + W.plural(total, 'play') + '. ' + lead } });
		o.values.forEach(function (v, i) {
			// a column with any plays stays visible (2 px at least)
			var bar = h('i', { style: { height: v && max ? 'max(2px, ' + (100 * v / max) + '%)' : '0' } });
			if (i === peak) bar.appendChild(h('b', { text: W.n(v) }));
			var col = h('div', { class: 'ts-wr-col' }, bar);
			col.addEventListener('pointerenter', function () {
				Array.prototype.forEach.call(cols.querySelectorAll('.is-hover'), function (c) { c.classList.remove('is-hover'); });
				note.textContent = o.names[i] + ': ' + W.plural(v, 'play');
				col.classList.add('is-hover');
			});
			cols.appendChild(col);
		});
		// a mouse that leaves puts the summary back; a tap's reading stays until the next tap
		cols.addEventListener('pointerleave', function (e) {
			if (e.pointerType !== 'mouse') return;
			Array.prototype.forEach.call(cols.querySelectorAll('.is-hover'), function (c) { c.classList.remove('is-hover'); });
			note.textContent = lead;
		});
		var axis = h('div', { class: 'ts-wr-axis', aria: { hidden: 'true' } }, o.values.map(function (v, i) { return h('span', { text: o.axis[i] || '' }); }));
		var table = h('table', { class: 'kit-sr' }, [
			h('caption', { text: o.title }),
			h('thead', null, h('tr', null, [h('th', { scope: 'col', text: o.col }), h('th', { scope: 'col', text: 'Plays' })])),
			h('tbody', null, o.values.map(function (v, i) { return h('tr', null, [h('th', { scope: 'row', text: o.names[i] }), h('td', { text: W.n(v) })]); }))
		]);
		box.appendChild(h('figure', { class: 'ts-wr-chart' + (o.wide ? ' is-wide' : '') }, [h('figcaption', null, h('h3', { text: o.title })), note, cols, axis, table]));
	}

	function highlightsSection(el, ctx, map, st, current) {
		var h = ctx.h, W = ctx.words, items = [];
		if (st.busiestMonth) items.push({ icon: 'stats', k: 'Busiest month', v: monthName(st.busiestMonth.month), s: W.plural(st.busiestMonth.plays, 'play') });
		if (st.busiestDay) items.push({ icon: 'newest', k: 'Busiest day', v: keyText(st.busiestDay.date, true), s: W.plural(st.busiestDay.plays, 'play') });
		if (st.firstSong) items.push({ id: st.firstSong.id, k: 'First song of the year', s: dayText(st.firstSong.at) + ', ' + clockText(st.firstSong.at) });
		if (st.onRepeat) items.push({ id: st.onRepeat.id, k: 'On repeat', s: W.plural(st.onRepeat.plays, 'time') + ' on ' + keyText(st.onRepeat.date) });
		if (st.mostSkipped) items.push({ id: st.mostSkipped.id, k: 'Skipped the most', s: 'skipped ' + W.plural(st.mostSkipped.skips, 'time') });
		if (!current && st.lastSong) items.push({ id: st.lastSong.id, k: 'Last song of the year', s: dayText(st.lastSong.at) + ', ' + clockText(st.lastSong.at) });
		if (!items.length) return;
		ctx.ui.sectionHead(el, 'Highlights');
		var box = h('div', { class: 'ts-wr-moments' });
		items.forEach(function (x) {
			var t = x.id ? map[x.id] : null;
			var text = h('span', { class: 'ts-wr-moment-t' }, [
				h('span', { class: 'ts-wr-moment-k', text: x.k }),
				h('span', { class: 'ts-wr-moment-v', text: t ? W.title(t) : x.v }),
				h('span', { class: 'ts-wr-moment-s', text: t ? W.artist(t) + ' ' + W.DOT + ' ' + x.s : x.s })
			]);
			if (t) box.appendChild(h('a', { class: 'ts-wr-moment', href: ctx.link('track', t.id) }, [ctx.art(t), text]));
			else box.appendChild(h('div', { class: 'ts-wr-moment' }, [h('span', { class: 'ts-wr-moment-ic', aria: { hidden: 'true' } }, ctx.icon(x.icon)), text]));
		});
		el.appendChild(box);
	}

	function newSongsSection(el, ctx, map, st, current) {
		var W = ctx.words, kept = st.discoveries, all = st.newSongs;
		if (!all.length) return;
		var when = current ? 'this year' : 'in ' + st.year, added = ctx.link('c', 'added', String(st.year));
		ctx.ui.sectionHead(el, kept.length ? 'You kept ' + W.plural(kept.length, 'new song') + ' ' + when : 'New ' + when, { href: added, text: 'Added in ' + st.year });
		el.appendChild(ctx.h('p', { class: 'ts-wr-lede', text: W.plural(all.length, 'song') + ' joined your playlists ' + when + (kept.length ? ', ' + W.n(kept.length) + ' of them kept from Discover.' : '.') }));
		var ids = (kept.length ? kept : all).slice(-18).reverse();
		ctx.ui.shelf(el, ids.map(function (id, i) { return ctx.ui.trackCard(map[id], ids, i, { label: 'New ' + when, href: added }); }));
	}

	// ---- The home page's lanes --------------------------------------------------------------
	// On this day, Rediscover old favourites and one nudge, each only when it has something.

	var NUDGE_KEY = 'nudgeDismissed', NUDGE_REST = 30 * DAY;
	var quiet = false;   // a nudge was answered: no other one until the page is loaded again
	function kit() { return typeof ToyKit !== 'undefined' && ToyKit && ToyKit.load ? ToyKit : null; }
	// { id: until (ms) } for the nudges put off with "Not now"; expired ones dropped
	function dismissed(now) {
		var k = kit(), m = k ? k.load(NUDGE_KEY, null) : null, out = Object.create(null);
		if (m && typeof m === 'object' && !Array.isArray(m)) Object.keys(m).forEach(function (id) { if (+m[id] > now) out[id] = +m[id]; });
		return out;
	}
	function dismiss(id, now) {
		var k = kit();
		if (!k) return;
		var m = dismissed(now);
		m[id] = now + NUDGE_REST;
		k.store(NUDGE_KEY, m);
	}
	function withSub(ctx, card, t, text) {
		var sub = card.querySelector('.ts-card-sub');
		if (sub) sub.textContent = ctx.words.artist(t) + ' ' + ctx.words.DOT + ' ' + text;
		return card;
	}

	function homeLanes(el, ctx) {
		injectCss();
		var now = ctx.now(), map = scopeOf(ctx), hist = historyOf(ctx);
		onThisDayLane(el, ctx, map, hist, now);
		rediscoverLane(el, ctx, map, hist, now);
		if (!quiet) nudgeCard(el, ctx, map, hist, now);
	}
	function onThisDayLane(el, ctx, map, hist, now) {
		var W = ctx.words, od = onThisDay(hist, map, now, { local: true }), items = [], seen = Object.create(null);
		function take(id, sub, cap) { if (items.length < cap && !seen[id] && canPlay(map[id])) { seen[id] = true; items.push({ id: id, sub: sub }); } }
		od.played.forEach(function (x) { take(x.id, (x.plays > 1 ? keep(W.plural(x.plays, 'play')) + ' ' : 'played ') + yearsAgo(x.ago), 6); });
		od.added.forEach(function (x) { take(x.id, 'added ' + yearsAgo(x.ago), 18); });
		if (!items.length) return;
		var ids = items.map(function (x) { return x.id; }), playCtx = { label: 'On this day', href: '#/' };
		ctx.ui.sectionHead(el, 'On this day');
		ctx.ui.shelf(el, items.map(function (x, i) { var t = map[x.id]; return withSub(ctx, ctx.ui.trackCard(t, ids, i, playCtx), t, x.sub); }));
	}
	function rediscoverLane(el, ctx, map, hist, now) {
		var rd = rediscover(hist, map, now, { n: REDISCOVER_N });
		if (!rd.length) return;
		var ids = rd.map(function (x) { return x.id; }), playCtx = { label: 'Rediscover old favourites', href: '#/' };
		ctx.ui.sectionHead(el, 'Rediscover old favourites');
		var head = el.lastChild;
		if (head && head.classList && head.classList.contains('ts-sec-head')) head.appendChild(ctx.ui.smallBtn('play', 'Play all', function () { ctx.play.from(ids, 0, playCtx); }));
		ctx.ui.shelf(el, rd.map(function (x, i) { var t = map[x.id]; return withSub(ctx, ctx.ui.trackCard(t, ids, i, playCtx), t, x.last ? 'last heard in ' + heardText(x.last, now) : 'liked, never played'); }));
	}
	function nudgeCard(el, ctx, map, hist, now) {
		var h = ctx.h, W = ctx.words, off = dismissed(now);
		var rows = nudgeRows(map, hist, now).filter(function (r) { return !off[r.id]; });
		if (!rows.length) return;
		var r = rows[0], t = map[r.id];
		var like = ctx.U.btn({ icon: 'heart', label: 'Like it', variant: 'secondary', size: 'sm', cls: 'ts-wr-like' });
		var later = ctx.U.btn({ label: 'Not now', variant: 'ghost', size: 'sm' });
		var card = h('section', { class: 'ts-wr-nudge', aria: { label: 'Like this song?' } }, [
			ctx.art(t),
			h('div', { class: 'ts-wr-nudge-t' }, [
				h('p', { class: 'ts-wr-nudge-q' }, ['You play ', h('a', { href: ctx.link('track', t.id), text: W.title(t) }), ' a lot. Like it?']),
				h('p', { class: 'ts-wr-nudge-s', text: W.plural(r.plays, 'time') + ' to the end in the last two months' })
			]),
			h('div', { class: 'ts-wr-nudge-acts' }, [like, later])
		]);
		like.addEventListener('click', function () {
			var before = +t.rating || 0;
			quiet = true;
			remove(card);
			ctx.edit([t.id], { rating: 5 });
			ctx.U.toast('Liked ' + W.q(W.title(t)) + '.', { action: 'Undo', onAction: function () { ctx.edit([t.id], { rating: before }); } });
		});
		later.addEventListener('click', function () {
			quiet = true;
			dismiss(t.id, ctx.now());
			remove(card);
			ctx.say('Not now: ' + W.q(W.title(t)) + ' will not be suggested for 30 days.');
		});
		el.appendChild(card);
	}

	return {
		yearStats: yearStats, onThisDay: onThisDay, rediscover: rediscover, nudges: nudges, years: years, yearText: yearText,
		view: view, homeLanes: homeLanes
	};
});
