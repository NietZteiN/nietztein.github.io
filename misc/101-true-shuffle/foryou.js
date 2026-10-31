/*
 * True Shuffle: For you (#/for-you). New music from the listener's own
 * listening, as lanes (lanes.js) that each load on their own and say why when
 * they cannot: Your radio (an endless radio of your favourites and songs like
 * them, the New songs dial, today's YouTube units, the sources that are on),
 * this season's anime and their openings and endings (AniList, AnimeThemes),
 * what airs today, the songs missing from your series (works.js), new
 * releases from your artists (artists.js), new uploads from the channels that
 * find music for you (channel.js), "Because you play X" (Deezer's related
 * artists), and Saved for later with what you hid. recs.js decides what is
 * worth showing: not what you have, not what you heard lately, not what you
 * hid, each song once on the page, and what was shown three times without a
 * touch last. In the demo nothing is asked of any service: every lane is
 * built from the demo library and invented songs.
 *
 *     Fy.view(view, ctx, parts, query)        #/for-you (?lane=<id> scrolls to one)
 *     Fy.LANES                                the lanes, in page order
 *     Fy.joinSeason(aniList, animeThemes, season) -> { anime: [{ id, slug, title, titleAlt, cover, popularity, format, season, themes }], without }
 *     Fy.airingOf(schedule) -> { id, title, cover, popularity, format, adult, episode, at, season }
 *     Fy.AIRING                               AniList's query for what airs between two times
 *     Fy.dayRange(now) -> { from, to, day }   today in the listener's time zone (seconds)
 *     Fy.airingToday(D, now, signal) -> Promise<[show]>   what airs today (AniList, cached 3 hours; adult titles left out)
 *     Fy.itunesPreview(D, find, signal) -> Promise<find with preview | null>   an anime song's Apple preview
 *     Fy.demoSeason(lib, season, o) -> [anime]   Fy.demoRelated(name, k, taken) -> [find]
 *     Fy.stream(list, worker, { want }) -> { results, errors, done, first, on(fn), resume(), count }
 *
 * UMD: window.TrueShuffle.foryou in the browser, module.exports in Node.
 */
(function (root, factory) {
	var node = typeof module === 'object' && module.exports;
	var api = factory(root, !!node);
	if (node) module.exports = api;
	else { root.TrueShuffle = root.TrueShuffle || {}; root.TrueShuffle.foryou = api; }
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this), function (root, inNode) {
	'use strict';

	var DAY = 86400000, HOUR = 3600000;
	var LANES = ['radio', 'season', 'airing', 'series', 'releases', 'channels', 'because', 'saved', 'hidden'];
	var DEDUPE = ['airing', 'series', 'channels', 'because-0', 'because-1', 'because-2'];   // each song only in the first of these
	var SERIES_MAX = 6;       // works read for Missing from your series (AnimeThemes: 90 requests a minute)
	var ARTISTS_MAX = 8;      // artists read for New releases, one at a time (iTunes: about 20 a minute)
	var BECAUSE_MAX = 3;      // Because you play X lanes
	var RELATED_MAX = 6;      // related artists read in each, two songs each
	var CURATORS_MAX = 6;     // channels read for New from your channels (1 unit each)
	var SEASON_SHOW = 30;     // anime shown of a season, most popular first
	var PREVIEW_MAX = 6;      // songs whose iTunes preview is looked for on one press
	var MEMO_MS = 6 * HOUR;   // a series or an artist read is not read again this session for so long
	var DOT = String.fromCharCode(0xB7), ELL = String.fromCharCode(0x2026), RSQ = String.fromCharCode(0x2019);
	var AIRING = 'query ($from: Int, $to: Int, $page: Int) { Page(page: $page, perPage: 50) { pageInfo { hasNextPage } airingSchedules(airingAt_greater: $from, airingAt_lesser: $to, sort: TIME) { airingAt episode media { id idMal title { romaji english native } popularity isAdult format season seasonYear coverImage { medium } } } } }';
	var JUMP = [['artists', 'Choose an artist'], ['releases', 'New releases'], ['because-0', 'Similar artists'], ['radio', 'Your radio'], ['channels', 'Your channels'], ['saved', 'Saved']];

	function str(v) { return v == null ? '' : String(v); }
	function num(v) { var n = +v; return isFinite(n) ? n : 0; }
	function own(o, k) { return !!o && Object.prototype.hasOwnProperty.call(o, k); }
	function mod(name) {
		var TS = root && root.TrueShuffle;
		if (TS && TS[name]) return TS[name];
		if (inNode && typeof require === 'function') { try { return require('./' + name + '.js'); } catch (e) { return null; } }
		return null;
	}
	function fold(s) { var M = mod('match'); return M && M.fold ? M.fold(str(s)) : str(s).toLowerCase().replace(/[^a-z0-9]+/g, ''); }
	function hueOf(s) { var x = 0; s = str(s); for (var i = 0; i < s.length; i++) x = (x * 31 + s.charCodeAt(i)) % 360; return x; }
	function nowOf(ctx) { try { return ctx && typeof ctx.now === 'function' ? +ctx.now() : Date.now(); } catch (e) { return Date.now(); } }
	function pref(key, d) { var K = root.ToyKit; try { return K && K.load ? K.load(key, d) : d; } catch (e) { return d; } }
	function setPref(key, v) { var K = root.ToyKit; try { if (K && K.store) K.store(key, v); } catch (e) { /* not kept */ } }
	function ratio() { var r = +pref('newRatio', 0.5); return isFinite(r) ? Math.max(0, Math.min(1, r)) : 0.5; }
	function plural(ctx, k, one, many) { return ctx.words && ctx.words.plural ? ctx.words.plural(k, one, many) : k + ' ' + (k === 1 ? one : many || one + 's'); }
	function q(ctx, s) { return ctx.words && ctx.words.q ? ctx.words.q(s) : '"' + s + '"'; }
	function nice(ctx, k) { return ctx.words && ctx.words.n ? ctx.words.n(k) : String(k); }
	function canRead(ctx) { try { return !ctx.demo && !!(ctx.canRead && ctx.canRead()); } catch (e) { return false; } }
	function artOn(ctx) { var p = null; try { p = ctx.prefs ? ctx.prefs() : null; } catch (e) { p = null; } return !ctx.demo && !ctx.thumb && !(p && p.art === false); }
	function roleWord(f) { var r = str(f && f.role), s = num(f && f.seq); return r === 'OP' || r === 'ED' ? r + (s > 0 ? s : '') : r === 'insert' ? 'Insert' : r; }
	function aborted() { var Src = mod('sources'); return Src && Src.SourceError ? Src.SourceError('aborted', 'Stopped.', { host: 'foryou' }) : new Error('Stopped.'); }
	function explainText(e) { var Ln = mod('lanes'); return Ln && Ln.explain ? Ln.explain(e).text : str(e && e.message) || 'Something went wrong.'; }

	// ---- Pure parts ------------------------------------------------------------------------------------

	// Today in the listener's own time zone: { from, to } in seconds (AniList's airingAt), day 'YYYY-MM-DD'.
	function dayRange(now) {
		var d = new Date(+now);
		var start = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(), end = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
		function p2(n) { return (n < 10 ? '0' : '') + n; }
		return { from: Math.floor(start / 1000), to: Math.floor(end / 1000), day: d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) };
	}
	// One of AniList's airingSchedules as a show; `at` in ms, `season` lower case (null when AniList has none).
	function airingOf(s) {
		var m = (s && s.media) || {}, t = m.title || {}, Src = mod('sources'), cover = str(m.coverImage && m.coverImage.medium);
		return {
			id: m.id == null ? null : m.id, title: { romaji: str(t.romaji), english: str(t.english), native: str(t.native) },
			cover: Src && Src.okImage && Src.okImage(cover) ? cover : '', popularity: num(m.popularity), format: str(m.format), adult: !!m.isAdult,
			episode: num(s && s.episode), at: num(s && s.airingAt) * 1000,
			season: m.season && m.seasonYear ? { year: num(m.seasonYear), season: str(m.season).toLowerCase() } : null
		};
	}
	// A season's anime: AniList's (by popularity) joined to AnimeThemes's (their themes as
	// finds) by AniList id, else by name; only those with songs. Themes are copies.
	function joinSeason(al, at, season) {
		var byId = {}, byName = {}, used = {}, out = [];
		(at || []).forEach(function (a) {
			if (!a) return;
			if (a.resources && a.resources.anilist) byId[a.resources.anilist] = a;
			var k = fold(a.name);
			if (k && !own(byName, k)) byName[k] = a;
		});
		(al || []).forEach(function (m) {
			if (!m) return;
			var t = m.title || {};
			var a = byId[m.id] || byName[fold(t.romaji)] || byName[fold(t.english)] || null;
			if (!a || used[a.slug] || !a.themes || !a.themes.length) return;
			used[a.slug] = true;
			var name = str(a.name) || str(t.romaji) || str(t.english);
			out.push({
				id: m.id, slug: str(a.slug), title: name, titleAlt: t.english && fold(t.english) !== fold(name) ? str(t.english) : '',
				cover: str(m.cover), popularity: num(m.popularity), format: str(m.format || a.format),
				season: season || (a.year ? { year: num(a.year), season: str(a.season).toLowerCase() } : null),
				themes: a.themes.map(function (f) { var c = {}; for (var k in f) if (own(f, k)) c[k] = f[k]; return c; })
			});
		});
		return { anime: out, without: (al || []).length - out.length };
	}

	// ---- The demo: invented anime, releases and related artists, shaped as the real ones ---------------

	var DEMO_ANIME = ['Harbor Lights Academy', 'Paper Moon Courier', 'Static Bloom', 'Lantern Street Detectives', 'Cloudline Express', 'Night Ferry Diaries', 'Glass Garden Saga', 'Mirror Lake Orchestra', 'Tidewater Radio Club', 'Signal Fire Brigade', 'Weathervane Girls', 'Ember Station', 'Moonlit Workshop', 'Sky Tram Seven', 'Origami Knights', 'Saltwind Bakery', 'Comet Tail Postman', 'Hanamichi Theatre', 'Rooftop Garden Club', 'Snowglobe Detectives'];
	var DEMO_SINGERS = ['Aoi Minase', 'Kiyora', 'Tsukimi Bell', 'Hollow Compass', 'Mizuiro Parade', 'Sora no Koe', 'Lantern Choir', 'Copper Sea', 'Rin Asagiri', 'Velvet Kites'];
	var DEMO_WORDS = ['Starlit', 'Morning', 'Ribbon', 'Horizon', 'Comet', 'Satellite', 'Lullaby', 'Overdrive', 'Daybreak', 'Blossom', 'Arrow', 'Echo', 'Gravity', 'Aurora', 'Prism', 'Voyage'];
	var DEMO_RELATED = ['Moth Radio', 'Velvet Kites', 'Copper Sea', 'Static Orchard', 'Paper Comets', 'Hollow Compass', 'Mizuiro Parade', 'Lantern Choir', 'Brass Meridian', 'Juniper Wire', 'Saltglass', 'Tidal Atlas'];
	function twoWords(a, b) { var L = DEMO_WORDS.length, x = a % L, y = b % L; if (y === x) y = (y + 5) % L; return DEMO_WORDS[x] + ' ' + DEMO_WORDS[y]; }
	function seasonNo(s) { return num(s && s.year) * 4 + Math.max(0, ['winter', 'spring', 'summer', 'fall'].indexOf(str(s && s.season))); }
	function slugOf(s) { return str(s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''); }
	// A season of invented anime (`o.n`, 10), each with an opening and an ending (a second
	// opening now and then), the most popular first. With `o.sequelOf` (a demo track of an
	// anime work) the first is that work's new season, opening with that library song.
	function demoSeason(lib, season, o) {
		o = o || {};
		var Src = mod('sources'), make = Src && Src.find ? Src.find : function (f) { return f; };
		var n = Math.min(o.n || 10, DEMO_ANIME.length / 2), sn = seasonNo(season), out = [], start = (sn % 2) * (DEMO_ANIME.length / 2);
		var lt = o.sequelOf && lib && lib.tracks ? lib.tracks[o.sequelOf] : null;
		for (var i = 0; i < n; i++) {
			var name = lt && i === 0 ? lt.work + ' 3rd Season' : DEMO_ANIME[(start + i) % DEMO_ANIME.length];
			var slug = slugOf(name), base = 6100000 + (sn % 1000) * 100 + i * 5;
			var roles = [['OP', 1], ['ED', 1]].concat(i % 4 === 1 ? [['OP', 2]] : []);
			var themes = roles.map(function (r, j) {
				var mine = lt && i === 0 && r[0] === 'OP';
				var title = mine ? lt.title : twoWords(sn + i * 3 + j, sn + i * 5 + j * 7 + 3);
				return make({ key: 'at:song:' + (base + j), title: title, artist: mine ? lt.artist : DEMO_SINGERS[(i * 3 + j + sn) % DEMO_SINGERS.length], work: name, workKey: 'at:anime:' + slug,
					role: r[0], seq: r[1], season: { year: season.year, season: season.season }, year: season.year, source: 'animethemes', ids: { at: base + j, anilist: 990000 + base + j }, demo: true });
			});
			out.push({ id: 990000 + base, slug: slug, title: name, titleAlt: '', cover: '', popularity: Math.max(1200, 96000 - i * 7300), format: i % 5 === 4 ? 'ONA' : 'TV', season: { year: season.year, season: season.season }, themes: themes, demo: true });
		}
		return out;
	}
	// Invented songs by artists "related" to one of the library's (none of them a library
	// artist's name in `taken`, folded): four artists, two songs each, Deezer-shaped.
	function demoRelated(name, k, taken) {
		var Src = mod('sources'), make = Src && Src.find ? Src.find : function (f) { return f; };
		var names = DEMO_RELATED.filter(function (a) { return !(taken && taken[fold(a)]); }), out = [];
		for (var i = 0; i < 4 && names.length; i++) {
			var a = names[(k * 4 + i) % names.length];
			for (var j = 0; j < 2; j++) {
				var id = 7700000 + k * 100 + i * 10 + j;
				out.push(make({ title: twoWords(k * 7 + i * 3 + j, k + i * 5 + j * 2 + 9), artist: a, album: DEMO_WORDS[(i + j + k) % DEMO_WORDS.length] + ' Days',
					durationSec: 180 + ((i * 37 + j * 23) % 90), source: 'deezer', ids: { dz: id }, why: [['related', name]], demo: true }));
			}
		}
		return out;
	}

	// ---- A lane that fills in as it goes ----------------------------------------------------------

	// Runs worker(item) over the list one at a time (each source on its own line, kept
	// gentle). `first` resolves at the first result (or the end); `on(fn)` hears each
	// result and the end (null). It pauses while `want()` is false (the lane left the
	// page) and goes on with resume().
	function stream(list, worker, o) {
		o = o || {};
		var s = { results: [], errors: [], done: false, i: 0, count: (list || []).length, running: false, want: o.want || function () { return true; } };
		var subs = [], resolveFirst = null, firstDone = false;
		s.first = new Promise(function (res) { resolveFirst = res; });
		function first() { if (!firstDone) { firstDone = true; resolveFirst(s); } }
		function emit(r) { subs.slice().forEach(function (fn) { try { fn(r); } catch (e) { /* a drawing error stays in its lane */ } }); }
		function step() {
			if (s.done) { s.running = false; return; }
			if (!s.want()) { s.running = false; return; }
			if (s.i >= s.count) { s.done = true; s.running = false; first(); emit(null); return; }
			var item = list[s.i++];
			var p;
			try { p = Promise.resolve(worker(item)); } catch (e) { p = Promise.reject(e); }
			p.then(function (r) {
				if (r) { s.results.push(r); first(); emit(r); }
			}, function (e) {
				if (e && e.code === 'aborted') { s.i--; return; }
				s.errors.push(e);
			}).then(step);
		}
		s.on = function (fn) { subs.push(fn); return function () { subs = subs.filter(function (x) { return x !== fn; }); }; };
		s.resume = function () { if (!s.running && !s.done) { s.running = true; step(); } };
		s.resume();
		return s;
	}

	// ---- What the lanes are built from ------------------------------------------------------------

	var inst = { ctx: null };
	function deps(ctx) {
		if (inst.ctx === ctx) return inst;
		var Src = mod('sources'), M = mod('match'), http = null, cache = null;
		if (!ctx.demo) {
			try { http = ctx.http ? ctx.http() : null; } catch (e) { http = null; }
			try { cache = ctx.cache ? ctx.cache() : null; } catch (e) { cache = null; }
		}
		if (!cache && Src && Src.createCache) cache = Src.createCache({ now: function () { return nowOf(ctx); } });
		inst = { ctx: ctx, Src: Src, http: http, cache: cache, memo: {} };
		if (Src && http && !ctx.demo) {
			inst.at = Src.animeThemes(http, cache);
			inst.al = Src.aniList(http, cache);
			inst.it = Src.iTunes(http, cache);
			try { inst.dz = ctx.deezer ? Src.deezerFinds(ctx.deezer(), cache) : null; } catch (e) { inst.dz = null; }
		}
		var common = { M: M, L: ctx.L, index: function () { return libIndex(ctx); }, tracks: function () { return ctx.L.list(ctx.lib()); }, map: ctx.demo ? null : ctx.findsMap || null, now: function () { return nowOf(ctx); } };
		var Wk = mod('works'), Ar = mod('artists');
		inst.works = Wk && M ? Wk.create(Object.assign({ at: inst.at || null, it: inst.it || null }, common)) : null;
		inst.artists = Ar && M ? Ar.create(Object.assign({ it: inst.it || null, dz: inst.dz || null, at: inst.at || null }, common)) : null;
		return inst;
	}
	// A result kept for the session (a series, an artist's releases): `fn` runs once in MEMO_MS.
	function memo(D, key, fn) {
		var m = D.memo[key];
		if (m && Date.now() - m.at < MEMO_MS) return Promise.resolve(m.value);
		return Promise.resolve().then(fn).then(function (v) { D.memo[key] = { at: Date.now(), value: v }; return v; });
	}
	function libIndex(ctx) { var M = mod('match'); return ctx.libIndex ? ctx.libIndex() : M.index(ctx.L.list(ctx.lib())); }
	// The library's copy of a found song, if it has one (match.js inLibrary).
	function mineOf(ctx, f) {
		if (!f) return null;
		if (f.mine) return f.mine;
		var lib = ctx.lib(), M = mod('match');
		if (f.videoId && lib.tracks[f.videoId] && !lib.tracks[f.videoId].transient) return f.videoId;
		if (!M || !M.inLibrary || !f.title) return null;
		try { var hit = M.inLibrary(libIndex(ctx), f); return hit && hit.id && lib.tracks[hit.id] ? hit.id : null; } catch (e) { return null; }
	}
	function knownArtist(ctx, name) {
		var k = ctx.L && ctx.L.normArtist ? ctx.L.normArtist(name) : fold(name), ix = null;
		try { ix = ctx.idx ? ctx.idx() : null; } catch (e) { ix = null; }
		return !!(k && ix && ix.artists && ix.artists[k]);
	}

	// ---- The page's bookkeeping: what was shown, heard, seen ---------------------------------------

	function page(base) {
		var R = mod('recs'), now = nowOf(base), store = null;
		try { store = base.store ? base.store() : null; } catch (e) { store = null; }
		var hist = [];
		try { hist = base.history ? base.history() || [] : []; } catch (e) { hist = []; }
		var P = { base: base, now: now, R: R, prof: R.profile(base.L.list(base.lib()), hist, now), got: {}, book: {}, heard: {}, played: {}, seenCh: {}, since: 0, names: {}, lanes: {}, timers: {}, dropped: {}, known: {} };
		hist.forEach(function (e) { if (e && e.kind === 'play' && now - e.at < R.RECENT_MS) P.played[e.id] = Math.max(P.played[e.id] || 0, +e.at || 0); });
		P.kv = {
			get: function (k, d) { return store && !base.thumb ? store.get(k, d).then(null, function () { return d; }) : Promise.resolve(d); },
			set: function (k, v) { if (store && !base.thumb) store.set(k, v); }
		};
		// later writes of the same key wait a moment and go once
		P.save = function (k, v) { clearTimeout(P.timers[k]); P.timers[k] = setTimeout(function () { P.kv.set(k, v); }, 800); };
		P.ready = Promise.all([P.kv.get('finds:heard', {}), P.kv.get('foryou:shown', {}), P.kv.get('feed:visits', null), P.kv.get('feed:seen', {}), P.kv.get('foryou:names', {})]).then(function (r) {
			P.heard = r[0] || {};
			P.book = r[1] || {};
			var v = R.visit(r[2], now);
			P.since = v.since;
			if (JSON.stringify(v.visits) !== JSON.stringify(r[2])) P.kv.set('feed:visits', v.visits);
			P.seenCh = r[3] || {};
			P.names = r[4] || {};
			return P;
		}, function () { return P; });
		return P;
	}
	function heardAt(P, f) {
		var h = P.heard[f.key];
		var t = h && +h.at ? +h.at : 0;
		if (f.videoId && P.played[f.videoId]) t = Math.max(t, P.played[f.videoId]);
		return t;
	}
	// A lane's items through recs.js: the filter, then each song only in the first lane that has it.
	// `o.keepMine` keeps the library's songs (they show with a check); `o.fresh` starts the lane anew.
	function settle(P, id, items, o) {
		o = o || {};
		var ctx = P.c, R = P.R, en = ctx.engine ? ctx.engine() : null;
		if (o.fresh) P.got[id] = [];
		var out = R.filter(items, {
			now: P.now,
			have: o.keepMine ? function () { return false; } : function (f) { var m = mineOf(ctx, f); if (m) f.mine = m; return !!m; },
			heard: o.keepHeard ? null : function (f) { return heardAt(P, f); },
			hidden: function (f) { return !!(en && en.isHidden && en.isHidden(f)); },
			shown: R.counts(P.book)
		});
		know(P, out);
		var at = DEDUPE.indexOf(id);
		if (at < 0) return out;
		var prior = [];
		DEDUPE.slice(0, at).forEach(function (x) { prior = prior.concat(P.got[x] || []); });
		prior = prior.concat(P.got[id] || []);
		out = R.dedupeLanes([prior, out])[1];
		P.got[id] = (P.got[id] || []).concat(out);
		return out;
	}
	// Found songs the page shows, by key: Explore can open one only once explore.js remembers it.
	function know(P, items) { (items || []).forEach(function (f) { if (f && f.key && !f.mine) P.known[f.key] = f; }); }
	function exploreFind(P, it) {
		var X = mod('explore'), f = (it && it.find) || (it && P.known[it.key]) || null;
		if (f && X && X.remember) X.remember(f);
		return it.mine ? '#/explore/' + encodeURIComponent(it.mine) : '#/explore/find/' + encodeURIComponent(it.key);
	}
	function shown(P, items) {
		var keys = items.map(function (x) { return x && (x.key || (x.find && x.find.key)); }).filter(Boolean);
		if (!keys.length) return;
		P.book = P.R.seen(P.book, keys, P.now);
		P.save('foryou:shown', P.book);
	}
	function touched(P, keys) {
		P.book = P.R.touch(P.book, keys);
		P.save('foryou:shown', P.book);
	}
	function named(P, kind, key, label) {
		if (!key || !label) return;
		P.names[kind + ':' + key] = label;
		var ks = Object.keys(P.names);
		if (ks.length > 400) delete P.names[ks[0]];
		P.save('foryou:names', P.names);
	}
	// The page's context for the lanes: a preview or a hide counts as a touch.
	function laneCtx(P, base) {
		var c = {};
		for (var k in base) if (own(base, k)) c[k] = base[k];
		if (typeof base.preview === 'function') c.preview = function (it, btn) { if (it && it.key) touched(P, [it.key]); return base.preview(it, btn); };
		return c;
	}
	// Row and card options: Play and Not interested count as touches; a hidden item's name is kept.
	function rowOpts(P, label, href, extra) {
		var Me = mod('media'), ctx = P.c, context = { label: label, href: href || '#/for-you' };
		var o = {
			context: context,
			onPlay: function (it, mode) { touched(P, [it.key]); return Me.play(ctx, it, mode === 'from' ? 'now' : mode, { context: context }); },
			go: { explore: function (it) { ctx.nav(exploreFind(P, it)); } },
			onHide: function (it, kind) { touched(P, [it.key]); if (kind === 'song') named(P, 'song', it.key, it.title + (it.artist ? ' by ' + it.artist : '')); else if (it.artist) named(P, 'artist', fold(it.artist), it.artist); }
		};
		for (var k in extra || {}) if (own(extra, k)) o[k] = extra[k];
		return o;
	}

	// ---- Playing, queueing, previews ----------------------------------------------------------------

	function playItems(P, items, label, href, mode) {
		var ctx = P.c, en = ctx.engine ? ctx.engine() : null, finds = items.map(function (x) { return x.find || x; });
		if (!finds.length) return;
		touched(P, finds.map(function (f) { return f.key; }));
		var lib = ctx.lib(), mine = finds.every(function (f) { return f.mine || (f.videoId && lib.tracks[f.videoId]); });
		if (mine) {
			var ids = finds.map(function (f) { return f.mine || f.videoId; });
			if (mode === 'later') ctx.play.later(ids); else if (mode === 'next') ctx.play.next(ids); else ctx.play.from(ids, 0, { label: label, href: href });
			return;
		}
		if (mode === 'later' || mode === 'next') { queueFinds(P, finds, mode); return; }
		if (!en) { ctx.say('Playing found songs needs the discovery engine.'); return; }
		if (ctx.demo && finds.some(function (f) { return !f.mine && !f.videoId; })) { ctx.say('The demo cannot search YouTube, so its invented songs do not play.'); return; }
		en.list(finds, { label: label, href: href || '#/for-you', searchCap: 10 });
	}
	// Found songs to the queue one after another (each found on YouTube first; ten at most).
	function queueFinds(P, finds, mode) {
		var ctx = P.c, can = canRead(ctx);
		var known = finds.filter(function (f) { return f.mine || f.videoId; });
		var todo = (can ? finds : known).slice(0, 10);
		if (!can && known.length < finds.length) ctx.say(ctx.demo ? 'The demo cannot search YouTube, so its invented songs cannot be queued.' : 'Finding songs on YouTube needs a sign-in or an API key (Settings); only the songs already found were queued.');
		if (!todo.length) return Promise.resolve(0);
		var job = ctx.job ? ctx.job('Adding ' + plural(ctx, todo.length, 'song') + ' to the queue' + ELL) : null, added = 0;
		return todo.reduce(function (p, f) {
			return p.then(function (stop) {
				if (stop) return true;
				if (f.mine) { if (mode === 'next') ctx.play.next([f.mine]); else ctx.play.later([f.mine]); added++; return false; }
				return Promise.resolve(ctx.play.find(f, mode)).then(function (r) {
					if (r && r.videoId) { added++; return false; }
					return !!(r && (r.reason === 'over-budget' || r.reason === 'needs-key'));
				}, function () { return true; });
			});
		}, Promise.resolve(false)).then(function () { if (job) job.done(added ? plural(ctx, added, 'song') + ' added to the queue.' : ''); return added; });
	}
	// 30-second previews one after another: the page's preview bar (ctx.previewList), else the first one.
	function previewList(P, items, label, btn) {
		var ctx = P.c, list = items.filter(function (x) { return x && x.preview; });
		if (!list.length) { ctx.say(ctx.demo ? 'The demo plays no previews: its new songs are invented.' : 'None of these songs has a preview.'); return; }
		touched(P, list.map(function (x) { return x.key; }));
		var Me = mod('media'), its = list.map(function (x) { return Me.item(x, ctx); });
		if (typeof ctx.previewList === 'function') { ctx.previewList(its, label); return; }
		if (typeof ctx.preview === 'function') ctx.preview(its[0], btn || null);
	}
	// An anime song's preview from Apple's iTunes Search (match.js says it is the same
	// song), kept 30 days. -> Promise<find with preview, or null>
	function itunesPreview(D, f, signal) {
		var M = mod('match'), Src = D.Src;
		if (!D.http || !D.cache || !M) return Promise.resolve(null);
		var who = (f.people && f.people[0]) || str(f.artist).replace(/\s*\(CV:[^)]*\)/g, '');
		var term = (who + ' ' + (M.baseTitle ? M.baseTitle(f.title) : f.title)).trim();
		var country = /[\u3040-\u30FF\u3400-\u9FFF]/.test(term) ? 'JP' : 'US';
		return D.cache.wrap('it:q:song:' + country + ':' + term.toLowerCase(), Src.TTL.itSearch, function () {
			return D.http.get('itunes', '/search', { query: { term: term, entity: 'song', media: 'music', limit: 8, country: country }, signal: signal }).then(function (j) {
				return (j && Array.isArray(j.results) ? j.results : []).filter(function (r) { return r && r.previewUrl; }).map(function (r) {
					return { title: str(r.trackName), artist: str(r.artistName), durationSec: Math.round(num(r.trackTimeMillis) / 1000), preview: str(r.previewUrl) };
				});
			});
		}, { signal: signal }).then(function (rs) {
			var best = (rs || []).filter(function (r) { var s = M.sameSong(f, r); return s && s.same && Src.okPreview(r.preview); })[0];
			if (!best) return null;
			var c = {};
			for (var k in f) if (own(f, k)) c[k] = f[k];
			c.preview = best.preview;
			return c;
		});
	}

	// ---- Small parts of the page ---------------------------------------------------------------------

	function groupHead(ctx, title, sub, buttons, extra) {
		var h = ctx.h, gh = h('div', { class: 'ts-fy-gh' });
		var t = h('h3', { class: 'ts-fy-gt' });
		if (title && title.nodeType) t.appendChild(title); else t.textContent = str(title);
		gh.appendChild(t);
		if (extra) gh.appendChild(extra);
		if (sub) gh.appendChild(h('span', { class: 'ts-fy-gsub', text: sub }));
		if (buttons && buttons.length) gh.appendChild(h('div', { class: 'ts-fy-gbtns' }, buttons));
		return gh;
	}
	// Rows of songs (media.js) with Show more, `limit` at a time.
	function rowsBlock(P, items, opts, limit) {
		var ctx = P.c, Me = mod('media'), h = ctx.h, box = h('div'), shownN = 0;
		var its = items.map(function (x) { return Me.item(x, ctx); }).filter(Boolean), ol = Me.list(ctx, [], Object.assign({}, opts, { list: its }));
		box.appendChild(ol);
		var more = null;
		function draw() {
			var to = Math.min(its.length, shownN + limit), first = null;
			its.slice(shownN, to).forEach(function (it) { var r = Me.row(ctx, it, Object.assign({}, opts, { list: its })); ol.appendChild(r); if (!first) first = r; });
			var was = shownN;
			shownN = to;
			if (more && more.parentNode) more.parentNode.removeChild(more);
			more = null;
			if (shownN < its.length) {
				more = ctx.U.btn({ icon: 'down', label: 'Show ' + Math.min(limit, its.length - shownN) + ' more', variant: 'secondary', size: 'sm', cls: 'ts-fy-showmore', on: { click: draw } });
				box.appendChild(more);
			}
			if (was && first) { var b = first.querySelector('.ts-m-play'); if (b) b.focus(); }
		}
		draw();
		return box;
	}
	function progressBar(ctx, have, total) {
		return ctx.h('span', { class: 'ts-fy-prog', role: 'img', aria: { label: have + ' of ' + total }, style: { '--p': String(total ? Math.round(100 * have / total) : 0) } });
	}
	function laneNote(ctx, s, what) {
		if (!s.errors.length) return '';
		var n = s.errors.length;
		return plural(ctx, n, what) + ' could not be read: ' + explainText(s.errors[0]);
	}

	// ---- 1. Your radio ------------------------------------------------------------------------------------

	var RATIO_SAY = { None: 'Only your own songs.', Some: 'About half new songs, from free sources.', Lots: 'Mostly new songs: about 8 in 10.' };
	function seedFor(P) {
		var ctx = P.c, lib = ctx.lib(), id = P.R.nextSeed(P.prof, str(pref('forYouSeed', '')));
		if (id && lib.tracks[id]) return id;
		var all = ctx.L.list(lib).filter(function (t) { return (!ctx.L.playable || ctx.L.playable(t)) && !t.blocked && t.kind !== 'clip'; });
		return all.length ? all[Math.floor(Math.random() * all.length)].id : null;
	}
	function sourcesOf(ctx) {
		var key = '', lfm = '';
		try { key = String(pref('apiKey', '') || (root.TrueShuffle && root.TrueShuffle.config && root.TrueShuffle.config.apiKey) || '').trim(); } catch (e) { key = ''; }
		try { lfm = ctx.lastfmKey ? ctx.lastfmKey() : ''; } catch (e) { lfm = ''; }
		if (ctx.demo) return [['YouTube', false, 'not in the demo'], ['Deezer', false, 'not in the demo'], ['iTunes', false, 'not in the demo'], ['Last.fm', false, 'not in the demo'], ['AnimeThemes', false, 'not in the demo'], ['AniList', false, 'not in the demo']].map(function (x) { return { name: x[0], on: x[1], how: x[2] }; });
		var read = canRead(ctx);
		return [
			{ name: 'YouTube', on: read, how: read ? (key ? 'an API key: finds and plays new songs' : 'signed in: finds and plays new songs') : 'off: sign in or add an API key to play new songs here', fix: !read },
			{ name: 'Deezer', on: !!ctx.deezer, how: 'related artists and previews' },
			{ name: 'iTunes', on: true, how: 'new releases and previews' },
			{ name: 'Last.fm', on: !!lfm, how: lfm ? 'your key: similar songs' : 'off: add a key in Settings for similar songs', fix: !lfm },
			{ name: 'AnimeThemes', on: true, how: 'anime openings and endings' },
			{ name: 'AniList', on: true, how: 'this season and what airs today' }
		];
	}
	function quotaWords(ctx, qa) {
		if (ctx.demo) return 'The demo uses no YouTube units: its new songs are invented.';
		if (!canRead(ctx)) return 'Without a sign-in or an API key, a new song that needs finding opens on YouTube in a new tab.';
		if (!qa) return '';
		return 'YouTube today: ' + nice(ctx, qa.used) + ' of ' + nice(ctx, qa.daily) + ' units used, ' + nice(ctx, qa.left) + ' left for finding songs (' + nice(ctx, qa.reserve) + ' kept for imports). The radio spends ' + nice(ctx, qa.auto.used) + ' of its own ' + nice(ctx, qa.auto.cap) + '. It starts again at ' + (qa.resetsAt || 'midnight Pacific time') + '.';
	}
	function radioLane(P) {
		var ctx = P.c, h = ctx.h, U = ctx.U, en = ctx.engine ? ctx.engine() : null;
		return {
			id: 'radio', title: 'Your radio', sub: 'your favourites, and songs like them you do not have yet', layout: 'rows',
			unavailable: function () {
				if (!en) return { text: 'Your radio needs the discovery engine, which did not start on this page.', fix: null };
				if (!Object.keys(ctx.lib().tracks).length) return { text: 'Your radio starts from your own songs: import a playlist first.', fix: { label: 'Open Settings', icon: 'settings', run: function () { ctx.nav('#/settings'); } } };
				return null;
			},
			isEmpty: function () { return false; },
			load: function () { return Promise.resolve({ ready: true }); },
			render: function (body) {
				var hero = h('div', { class: 'ts-fy-hero' }), main = h('div', { class: 'ts-fy-hero-main' });
				var seedLine = h('p', { class: 'ts-fy-seed' });
				function showSeed() {
					ctx.clear(seedLine);
					var id = seedFor(P), t = id ? ctx.trackOf(id) : null;
					seedLine.dataset.seed = id || '';
					if (!t) { seedLine.textContent = 'Play or like a few songs: your radio starts from your favourites.'; return; }
					seedLine.appendChild(document.createTextNode('Starts from '));
					seedLine.appendChild(h('b', { text: ctx.words.title(t) }));
					var a = ctx.words.artist ? ctx.words.artist(t) : t.artist;
					if (a) seedLine.appendChild(document.createTextNode(' by ' + a));
					seedLine.appendChild(document.createTextNode(P.prof.songs.length > 1 ? ', one of your favourites; the next press starts from another.' : '.'));
				}
				showSeed();
				var start = U.btn({ icon: 'radio', label: 'Start your radio', variant: 'primary', size: 'lg', cls: 'ts-fy-start', on: { click: function () {
					var id = seedLine.dataset.seed;
					if (!id) { ctx.say('Play or like a few songs first: your radio starts from your favourites.'); return; }
					setPref('forYouSeed', id);
					U.btnState(start, { busy: true });
					var r = ratio(), t = ctx.trackOf(id);
					Promise.resolve(en.radio(id, { ratio: r, label: 'Your radio', href: '#/for-you' })).then(function (ids) {
						U.btnState(start, { busy: false });
						if (ids && ids.length) ctx.say('Your radio, from ' + q(ctx, ctx.words.title(t)) + ': ' + RATIO_SAY[P.R.ratioName(r)].toLowerCase());
						showSeed();
					}, function (e) { U.btnState(start, { busy: false }); if (ctx.fail) ctx.fail(e); });
				} } });
				var pv = U.btn({ icon: 'headphones', label: 'Preview new songs', variant: 'secondary', size: 'md', cls: 'ts-fy-preview', on: { click: function () { previewNew(P, pv); } } });
				main.appendChild(seedLine);
				main.appendChild(h('div', { class: 'ts-fy-hero-btns' }, [start, pv]));
				hero.appendChild(main);

				// the New songs dial: how much of a radio is new (also Endless and every Start radio)
				var dial = h('div', { class: 'ts-fy-dial' }), dh = h('p', { class: 'ts-fy-dial-h', id: 'ts-fy-dial-h', text: 'New songs' });
				var seg = h('div', { class: 'ts-seg ts-fy-seg', role: 'radiogroup', aria: { labelledby: 'ts-fy-dial-h' } }), say = h('p', { class: 'ts-muted ts-fy-dial-say' });
				function paint() {
					var name = P.R.ratioName(ratio());
					[].slice.call(seg.children).forEach(function (b) { var on = b.dataset.name === name; b.setAttribute('aria-checked', on ? 'true' : 'false'); b.tabIndex = on ? 0 : -1; });
					say.textContent = RATIO_SAY[name] + ' Also for Endless and every Start radio.';
				}
				P.R.RATIOS.forEach(function (x, i) {
					var b = h('button', { class: 'ts-seg-b', role: 'radio', data: { name: x[0] }, text: x[0], on: {
						click: function () { setPref('newRatio', x[1]); paint(); },
						keydown: function (e) {
							var d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
							if (!d) return;
							e.preventDefault();
							var j = (i + d + P.R.RATIOS.length) % P.R.RATIOS.length;
							setPref('newRatio', P.R.RATIOS[j][1]);
							paint();
							seg.children[j].focus();
						}
					} });
					seg.appendChild(b);
				});
				dial.appendChild(dh);
				dial.appendChild(seg);
				dial.appendChild(say);
				paint();
				hero.appendChild(dial);

				var qa = null;
				try { qa = en.quota ? en.quota() : null; } catch (e) { qa = null; }
				hero.appendChild(h('p', { class: 'ts-fy-quota', text: quotaWords(ctx, qa) }));
				var srcList = h('ul', { class: 'ts-fy-srclist', aria: { labelledby: 'ts-fy-src-h' } });
				var src = h('div', { class: 'ts-fy-sources' }, [h('span', { class: 'ts-fy-src-h', id: 'ts-fy-src-h', text: 'Sources' }), srcList]);
				sourcesOf(ctx).forEach(function (s) {
					var kids = [ctx.icon ? ctx.icon(s.on ? 'check-circle' : 'minus-circle') : null, h('span', { text: s.name })];
					var chip = s.fix && !ctx.demo
						? h('a', { class: 'ts-fy-src is-off', href: '#/settings', title: s.name + ': ' + s.how, aria: { label: s.name + ': ' + s.how } }, kids)
						: h('span', { class: 'ts-fy-src' + (s.on ? ' is-on' : ' is-off'), title: s.name + ': ' + s.how }, kids.concat([h('span', { class: 'kit-sr', text: ': ' + s.how })]));
					srcList.appendChild(h('li', null, chip));
				});
				hero.appendChild(src);
				body.appendChild(hero);
			}
		};
	}
	// Preview new songs: Deezer's mixes of four of your top artists, songs you lack, one artist at a time.
	function previewNew(P, btn) {
		var ctx = P.c, U = ctx.U, D = deps(P.base);
		if (ctx.demo) { ctx.say('The demo plays no previews: its new songs are invented.'); return; }
		if (!D.dz || !D.artists) { ctx.say('Previews come from Deezer, which is not available here.'); return; }
		var top = P.prof.artists.slice(0, 12);
		if (!top.length) { ctx.say('Play or like a few songs first: the previews start from your favourite artists.'); return; }
		var pick = top.slice().sort(function () { return Math.random() - 0.5; }).slice(0, 4), all = [];
		U.btnState(btn, { busy: true });
		var job = ctx.job ? ctx.job('Finding new songs to preview' + ELL) : null;
		pick.reduce(function (p, a) {
			return p.then(function () {
				return D.artists.find({ key: a.key, name: a.name }, { sources: ['deezer'] }).then(function (fa) {
					if (!fa || !fa.deezer) return null;
					return D.dz.radio(fa.deezer.id, 30).then(function (fs) { all = all.concat(fs.map(function (f) { var c = Object.assign({}, f); c.why = [['radio', a.name]]; return c; })); });
				}).then(null, function () { return null; });
			});
		}, Promise.resolve()).then(function () {
			U.btnState(btn, { busy: false });
			if (job) job.done();
			var fresh = settle(P, 'preview', all.filter(function (f) { return f.preview; }), {});
			fresh = P.R.interleave(fresh, function (f) { return fold(f.artist); }).slice(0, 40);
			if (!fresh.length) { ctx.say('Deezer had nothing new for your taste just now.'); return; }
			previewList(P, fresh, 'New for you', btn);
		});
	}

	// ---- 2. This season's anime ------------------------------------------------------------------------

	function seasonOf(D, s, signal) {
		return Promise.all([D.al.season(s.year, s.season, { perPage: 50, signal: signal }), D.at.season(s.year, s.season, { signal: signal })]).then(function (r) { return joinSeason(r[0], r[1], s); });
	}
	function seasonLane(P) {
		var ctx = P.c, R = P.R, cur = R.currentSeason(P.now), prev = R.previousSeason(cur), D = deps(P.base);
		return {
			id: 'season', title: 'This season' + RSQ + 's anime', sub: R.seasonName(cur) + ' and ' + R.seasonName(prev) + ', the most popular first', badge: 'anime', layout: 'cards', lazy: true,
			key: 'fy:season:' + cur.year + ':' + cur.season + (ctx.demo ? ':demo' : ''), maxAgeMs: HOUR,
			unavailable: function () { return ctx.demo || (D.al && D.at) ? null : { text: 'This season' + RSQ + 's anime come from AniList and AnimeThemes, which are not available here.', fix: null }; },
			empty: 'AnimeThemes has no songs for this season' + RSQ + 's anime yet.',
			load: function (signal) {
				function mark(groups) {
					groups.forEach(function (g) { g.anime.forEach(function (a) { a.themes.forEach(function (f) { f.mine = mineOf(ctx, f); }); }); });
					return { groups: groups.filter(function (g) { return g.anime.length; }).map(function (g) { return { title: g.title, sub: g.sub, anime: g.anime, items: [] }; }), items: [], anime: groups.reduce(function (n, g) { return n + g.anime.length; }, 0), note: groups.note || '' };
				}
				if (ctx.demo) {
					var seq = ctx.L.list(ctx.lib()).filter(function (t) { return t.scene === 'anime' && t.work && t.artist && (t.role === 'OP' || t.role === 'ED'); })[0];
					var g = [{ title: R.seasonName(cur), sub: 'airing now', anime: demoSeason(ctx.lib(), cur, { n: 10, sequelOf: seq ? seq.id : null }) }, { title: R.seasonName(prev), sub: 'last season', anime: demoSeason(ctx.lib(), prev, { n: 8 }) }];
					return Promise.resolve(mark(g));
				}
				return seasonOf(D, cur, signal).then(function (a) {
					return seasonOf(D, prev, signal).then(function (b) {
						return mark([{ title: R.seasonName(cur), sub: 'airing now', anime: a.anime }, { title: R.seasonName(prev), sub: 'last season', anime: b.anime }]);
					}, function (e) {
						if (e && e.code === 'aborted') throw e;
						var out = [{ title: R.seasonName(cur), sub: 'airing now', anime: a.anime }];
						out.note = 'Last season could not be read: ' + explainText(e);
						return mark(out);
					});
				});
			},
			isEmpty: function (d) { return !d || !d.anime; },
			render: function (body, d) {
				d.groups.forEach(function (g) { body.appendChild(seasonGroup(P, g)); });
			}
		};
	}
	function seasonGroup(P, g) {
		var ctx = P.c, h = ctx.h, box = h('div', { class: 'ts-fy-group' });
		box.appendChild(groupHead(ctx, g.title, plural(ctx, g.anime.length, 'anime', 'anime') + ' with songs, ' + g.sub));
		var shelf = h('div', { class: 'ts-shelf ts-fy-ashelf', role: 'list', aria: { label: g.title } });
		g.anime.slice(0, SEASON_SHOW).forEach(function (a) { var c = animeCard(P, a); c.setAttribute('role', 'listitem'); shelf.appendChild(c); });
		box.appendChild(shelf);
		return box;
	}
	// An anime: its cover (AniList's), its name, its songs as chips (each opens Explore; a
	// check on yours); the card opens Explore for its first opening, its play button plays it.
	function animeCard(P, a) {
		var ctx = P.c, h = ctx.h, U = ctx.U, X = mod('explore'), Me = mod('media');
		var themes = a.themes.slice(), first = themes.filter(function (f) { return f.role === 'OP'; })[0] || themes[0];
		// Explore's address for a song, without remembering it yet (explore.js keeps 60): a click remembers it.
		var hrefOf = function (f) { return f.mine ? '#/explore/' + encodeURIComponent(f.mine) : '#/explore/find/' + encodeURIComponent(f.key); };
		var keep = function (f) { return function () { if (!f.mine && X && X.remember) X.remember(f); touched(P, [f.key]); }; };
		var mine = themes.filter(function (f) { return f.mine; }).length;
		var art = artOn(ctx) && a.cover ? h('span', { class: 'ts-art ts-fy-cover' }, h('img', { src: a.cover, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' })) : U.swatch(hueOf(a.title), a.title, 'ts-fy-cover', 45);
		var sub = [a.titleAlt, a.format === 'TV' ? '' : a.format, mine ? mine + ' of yours' : ''].filter(Boolean).join(' ' + DOT + ' ');
		var card = h('div', { class: 'ts-card ts-fy-acard', data: { slug: a.slug } });
		var link = h('a', { class: 'ts-card-a', href: hrefOf(first), title: a.title, on: { click: keep(first) } }, [art, h('span', { class: 'ts-card-title', text: a.title })]);
		if (sub) link.appendChild(h('span', { class: 'ts-card-sub', text: sub }));
		card.appendChild(link);
		var chips = h('ul', { class: 'ts-fy-themes', aria: { label: 'Songs of ' + a.title } });
		themes.forEach(function (f) {
			var label = roleWord(f) + ': ' + f.title + (f.artist ? ' by ' + f.artist : '') + (f.mine ? ', in your library' : '');
			chips.appendChild(h('li', null, h('a', { class: 'ts-fy-theme' + (f.mine ? ' is-mine' : ''), href: hrefOf(f), title: label, aria: { label: label }, on: { click: keep(f) } }, [h('span', { text: roleWord(f) || 'Song' }), f.mine && ctx.icon ? ctx.icon('check') : null])));
		});
		card.appendChild(chips);
		var over = h('div', { class: 'ts-fy-over' });
		var big = h('button', { class: 'ts-bigplay ts-fy-aplay', type: 'button', title: 'Play ' + roleWord(first) + ': ' + first.title, aria: { label: 'Play ' + first.title + ', ' + roleWord(first) + ' of ' + a.title } }, [ctx.icon ? ctx.icon('play') : U.icon('play')]);
		big.addEventListener('click', function (e) {
			e.preventDefault();
			touched(P, [first.key]);
			if (ctx.demo && !first.mine) { ctx.say('The demo cannot search YouTube, so its invented songs do not play.'); return; }
			Me.play(ctx, first, 'now', { context: { label: a.title, href: '#/for-you?lane=season' } });
		});
		over.appendChild(big);
		card.appendChild(over);
		return card;
	}

	// ---- 3. Airing today -------------------------------------------------------------------------------

	// D: { http, cache, Src } (sources.js createHttp, createCache, the module).
	function airingToday(D, now, signal) {
		var r = dayRange(now), Src = D.Src;
		return D.cache.wrap('al:airing:' + r.day + ':' + r.from, 3 * HOUR, function () {
			var shows = [];
			function page(n) {
				return D.http.post('anilist', '', { query: AIRING, variables: { from: r.from - 1, to: r.to, page: n } }, { signal: signal }).then(function (j) {
					var pg = j && j.data && j.data.Page;
					if (!pg) throw Src.SourceError('bad', 'AniList sent an answer this page cannot read.', { host: 'anilist' });
					(Array.isArray(pg.airingSchedules) ? pg.airingSchedules : []).forEach(function (s) { shows.push(airingOf(s)); });
					return pg.pageInfo && pg.pageInfo.hasNextPage && n < 3 ? page(n + 1) : shows;
				});
			}
			return page(1);
		}, { signal: signal }).then(function (x) { return (x || []).filter(function (s) { return !s.adult && s.id != null; }); });
	}
	function clockOf(ms) { try { return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); } catch (e) { return ''; } }
	function airingLane(P) {
		var ctx = P.c, R = P.R, D = deps(P.base), cur = R.currentSeason(P.now), prev = R.previousSeason(cur);
		return {
			id: 'airing', title: 'Airing today', sub: 'new episodes today, and their songs', badge: ['season', 'Airing'], layout: 'groups', lazy: true, limit: 4,
			unavailable: function () { return ctx.demo || (D.al && D.at) ? null : { text: 'What airs today comes from AniList and AnimeThemes, which are not available here.', fix: null }; },
			empty: function (d) { return d && d.shows ? plural(ctx, d.shows, 'show') + ' air today; AnimeThemes has no songs for them yet.' : 'No anime airs today, or AniList does not know of any.'; },
			load: function (signal) {
				return P.ready.then(function () {
					var shows;
					if (ctx.demo) {
						var base = dayRange(P.now).from * 1000, an = demoSeason(ctx.lib(), cur, { n: 10 });
						shows = [[1, 13.5], [3, 17], [5, 21.5], [6, 23.75]].map(function (x, i) { var a = an[x[0]]; return { show: { id: a.id, title: { romaji: a.title, english: '', native: '' }, episode: 2 + i, at: base + x[1] * HOUR }, anime: a }; });
						return shape(shows, 0);
					}
					return airingToday(D, P.now, signal).then(function (list) {
						var want = {};
						list.forEach(function (s) { if (s.season && (seasonNo(s.season) === seasonNo(cur) || seasonNo(s.season) === seasonNo(prev))) want[seasonNo(s.season)] = s.season; });
						var seasons = Object.keys(want).map(function (k) { return want[k]; });
						return Promise.all(seasons.map(function (s) { return D.at.season(s.year, s.season, { signal: signal }).then(null, function (e) { if (e && e.code === 'aborted') throw e; return []; }); })).then(function (lists) {
							var byId = {};
							lists.forEach(function (l) { (l || []).forEach(function (a) { if (a.resources && a.resources.anilist) byId[a.resources.anilist] = a; }); });
							var withSongs = [];
							list.forEach(function (s) {
								var a = byId[s.id];
								if (a && a.themes && a.themes.length) withSongs.push({ show: s, anime: { title: str(a.name), themes: a.themes.map(function (f) { return Object.assign({}, f); }) } });
							});
							return shape(withSongs, list.length);
						});
					});
				});
				function shape(rows, total) {
					var all = [];
					rows.forEach(function (r) {
						r.items = r.anime.themes.map(function (f) { f.mine = mineOf(ctx, f); f.why = []; return f; });
						all = all.concat(r.items);
					});
					var kept = settle(P, 'airing', all, { keepMine: true, keepHeard: true, fresh: true }), ok = {};
					kept.forEach(function (f) { ok[f.key] = true; });
					var groups = rows.map(function (r) {
						var t = r.show.title.english || r.show.title.romaji || r.anime.title;
						return { title: r.anime.title || t, sub: 'Episode ' + r.show.episode + (clockOf(r.show.at) ? ' ' + DOT + ' ' + clockOf(r.show.at) : ''), items: r.items.filter(function (f) { return ok[f.key]; }) };
					}).filter(function (g) { return g.items.length; });
					var items = [];
					groups.forEach(function (g) { items = items.concat(g.items); });
					shown(P, items);
					var rest = total - rows.length;
					return { groups: groups, items: items, shows: total, note: rest > 0 ? plural(ctx, rest, 'more show') + ' air today without songs on AnimeThemes yet.' : '' };
				}
			},
			row: rowOpts(P, 'Airing today', '#/for-you?lane=airing'),
			actions: function (d) {
				if (!d || !d.items || !d.items.length) return [];
				return [ctx.U.btn({ icon: 'play', label: 'Play them', variant: 'secondary', size: 'sm', on: { click: function () { playItems(P, d.items, 'Airing today', '#/for-you?lane=airing'); } } })];
			}
		};
	}

	// ---- 4. Missing from your series -------------------------------------------------------------------

	function seriesLane(P) {
		var ctx = P.c, D = deps(P.base);
		return {
			id: 'series', title: 'Missing from your series', sub: 'the anime you play most, and their songs you do not have', badge: 'anime', layout: 'groups', lazy: true,
			unavailable: function () { return D.works ? null : { text: 'Your series need works.js.', fix: null }; },
			empty: function (d) { return d && d.unknown ? 'AnimeThemes does not know the anime you play most (' + d.unknown + ').' : 'Label the anime your songs are from (Edit, the work), or play some anime songs: this lists the openings and endings you do not have.'; },
			load: function (signal) {
				return P.ready.then(function () {
					var lib = ctx.lib();
					var works = P.prof.works.filter(function (w) { return w.scene === 'anime' || !w.scene; }).slice(0, SERIES_MAX);
					if (!works.length) return { items: [] };
					P.got.series = [];
					var s = stream(works, function (w) {
						if (signal && signal.aborted) return Promise.reject(aborted());
						var t = lib.tracks[w.ids[0]];
						if (!t) return null;
						if (ctx.demo) { var d = D.works.demo(t, lib); return d ? franchiseOf(P, w, d.found, d.franchise) : null; }
						return memo(D, 'series:' + w.key, function () {
							return D.works.workOf(t, { signal: signal }).then(function (fw) { return fw ? D.works.franchise(fw, { signal: signal }).then(function (fr) { return fr ? { fw: fw, fr: fr } : null; }) : null; });
						}).then(function (x) { return x ? franchiseOf(P, w, x.fw, x.fr) : null; });
					}, { want: function () { return !signal || !signal.aborted; } });
					return s.first.then(function () {
						if (!s.results.length && s.done) { if (s.errors.length) throw s.errors[0]; return { items: [], unknown: works.slice(0, 3).map(function (w) { return w.name; }).join(', ') }; }
						return { stream: s, items: [] };
					});
				});
			},
			isEmpty: function (d) { return !d || !d.stream; },
			render: function (body, d) {
				var s = d.stream, h = ctx.h, box = h('div'), foot = h('p', { class: 'ts-muted ts-fy-more' });
				body.appendChild(box);
				body.appendChild(foot);
				function draw() {
					ctx.clear(box);
					var list = P.R.byCompletion(s.results);
					list.forEach(function (fr) { box.appendChild(seriesBlock(P, fr)); });
					if (!list.length && s.done) box.appendChild(h('p', { class: 'ts-muted ts-fy-none', text: 'You have every song of the anime you play most.' }));
					foot.textContent = s.done ? laneNote(ctx, s, 'series') : 'Looking at your series: ' + Math.min(s.i, s.count) + ' of ' + s.count + ELL;
					foot.hidden = !foot.textContent;
				}
				s.want = function () { return body.isConnected; };
				s.on(function () { if (body.isConnected) draw(); });
				draw();
				s.resume();
			}
		};
	}
	// A franchise as the lane shows it: { key, title, have, total, missing } (missing through the filter).
	function franchiseOf(P, w, fw, fr) {
		var ctx = P.c;
		var songs = (fr.songs || []).map(function (f) { var c = Object.assign({}, f); c.mine = c.mine || mineOf(ctx, c); return c; });
		var have = songs.filter(function (f) { return f.mine; }).length, total = songs.length;
		var missing = settle(P, 'series', songs.filter(function (f) { return !f.mine; }).map(function (f) { f.why = []; return f; }), {});
		shown(P, missing);
		return { key: w.key, title: fr.title || (fw && fw.anime && fw.anime.name) || w.key, have: have, total: total, missing: missing, sure: !fw || fw.sure !== false, probable: fw && fw.sure === false && fw.anime ? fw.anime.name : '' };
	}
	function seriesBlock(P, fr) {
		var ctx = P.c, h = ctx.h, U = ctx.U, box = h('div', { class: 'ts-fy-group ts-fy-series', data: { work: fr.key } });
		var label = fr.title + ': the ones you lack', href = '#/for-you?lane=series';
		var title = h('span', null, [document.createTextNode(fr.title + ' '), h('span', { class: 'ts-fy-count', text: fr.have + '/' + fr.total })]);
		var add = U.btn({ icon: 'queue-add', label: 'Add missing to queue', variant: 'secondary', size: 'sm', title: 'Each one is found on YouTube first when it is not known yet (a search: 100 units)', on: { click: function () { playItems(P, fr.missing, label, href, 'later'); } } });
		var pv = U.btn({ icon: 'headphones', label: 'Preview missing', variant: 'secondary', size: 'sm', busyLabel: 'Finding previews' + ELL, on: { click: function () { previewMissing(P, fr, pv); } } });
		box.appendChild(groupHead(ctx, title, fr.missing.length ? plural(ctx, fr.missing.length, 'song') + ' missing' + (fr.probable ? ' ' + DOT + ' probably ' + fr.probable : '') : 'the missing ones are hidden or heard lately', fr.missing.length ? [add, pv] : [], progressBar(ctx, fr.have, fr.total)));
		if (fr.missing.length) box.appendChild(rowsBlock(P, fr.missing, rowOpts(P, label, href), 4));
		return box;
	}
	// Preview missing: Apple's previews of up to six of them (one iTunes request each, kept 30 days).
	function previewMissing(P, fr, btn) {
		var ctx = P.c, U = ctx.U, D = deps(P.base);
		var ready = fr.missing.filter(function (f) { return f.preview; });
		if (ready.length) { previewList(P, ready, fr.title + ': missing', btn); return; }
		if (ctx.demo) { ctx.say('The demo plays no previews: its new songs are invented.'); return; }
		if (!D.http) { ctx.say('Previews come from iTunes, which is not available here.'); return; }
		var todo = fr.missing.slice(0, PREVIEW_MAX), got = [];
		U.btnState(btn, { busy: true });
		var job = ctx.job ? ctx.job('Finding previews on iTunes (' + todo.length + ' songs)' + ELL) : null;
		todo.reduce(function (p, f) { return p.then(function () { return itunesPreview(D, f).then(function (c) { if (c) got.push(c); }, function () { /* the next one */ }); }); }, Promise.resolve()).then(function () {
			U.btnState(btn, { busy: false });
			if (job) job.done();
			if (!got.length) { ctx.say('iTunes has no previews of these songs.'); return; }
			got.forEach(function (c) { fr.missing.forEach(function (f) { if (f.key === c.key) f.preview = c.preview; }); });
			previewList(P, got, fr.title + ': missing', btn);
		});
	}

	// ---- 5. New releases from your artists --------------------------------------------------------------

	// The demo's releases: artists.js's invented discography with a few releases moved
	// to the last weeks, and one coming.
	function demoReleases(P, D, a, k) {
		var d = D.artists.demo(a.key, P.c.lib());
		if (!d) return null;
		var dg = d.discography, list = [].concat(dg.albums, dg.eps, dg.singles);
		list.sort(function (x, y) { return x.key < y.key ? -1 : 1; });
		var out = [];
		list.slice(0, 2).forEach(function (al, i) {
			var c = Object.assign({}, al), days = k === 1 && i === 0 ? -16 : 6 + k * 11 + i * 23;
			c.date = new Date(P.now - days * DAY).toISOString().slice(0, 10);
			c.year = +c.date.slice(0, 4);
			c.artistName = d.found.name;
			out.push(c);
		});
		return { artist: a, found: d.found, albums: out };
	}
	function releasesLane(P) {
		var ctx = P.c, D = deps(P.base), R = P.R;
		return {
			id: 'releases', title: 'New releases from your artists', sub: function () { return P.since ? 'since your last visit ' + R.sinceWords(P.since, P.now) + ', and what is coming' : 'the last ' + R.RELEASE_DAYS + ' days, and what is coming'; },
			badge: 'album', layout: 'cards', lazy: true,
			unavailable: function () { return D.artists ? null : { text: 'New releases need artists.js.', fix: null }; },
			empty: function (d) { return d && d.unknown ? 'Apple' + RSQ + 's iTunes and Deezer do not know your favourite artists (' + d.unknown + ').' : 'Play or like a few songs: this follows your favourite artists.'; },
			load: function (signal) {
				return P.ready.then(function () {
					var artists = P.prof.artists.slice(0, ARTISTS_MAX);
					var picked = root.TrueShuffle.artistDiscovery ? root.TrueShuffle.artistDiscovery.chosen(ctx).map(function (name) { return { key: ctx.L.normArtist(name), name: name }; }) : [];
					artists = picked.concat(artists.filter(function (a) { return !picked.some(function (p) { return p.key === a.key; }); })).slice(0, ARTISTS_MAX);
					if (!artists.length) return { items: [] };
					var k = 0;
					var s = stream(artists, function (a) {
						if (signal && signal.aborted) return Promise.reject(aborted());
						if (ctx.demo) return demoReleases(P, D, a, k++);
						return memo(D, 'rel:' + a.key, function () {
							return D.artists.find({ key: a.key, name: a.name }, { signal: signal }).then(function (fa) {
								if (!fa) return null;
								return D.artists.discography(fa, { signal: signal }).then(function (dg) {
									var albums = [].concat(dg.albums || [], dg.eps || [], dg.singles || [], dg.compilations || []).filter(function (al) { return !al.guest; }).map(function (al) { var c = Object.assign({}, al); c.artistName = fa.name; return c; });
									return { artist: a, found: fa, albums: albums };
								});
							});
						});
					}, { want: function () { return !signal || !signal.aborted; } });
					return s.first.then(function () {
						if (!s.results.length && s.done) { if (s.errors.length) throw s.errors[0]; return { items: [], unknown: artists.slice(0, 3).map(function (a) { return a.name; }).join(', ') }; }
						return { stream: s, items: [] };
					});
				});
			},
			isEmpty: function (d) { return !d || !d.stream; },
			render: function (body, d) {
				var s = d.stream, h = ctx.h, box = h('div'), foot = h('p', { class: 'ts-muted ts-fy-more' });
				body.appendChild(box);
				body.appendChild(foot);
				function draw() {
					ctx.clear(box);
					var all = [];
					s.results.forEach(function (r) { all = all.concat(r.albums || []); });
					var g = R.releases(all, { now: P.now, since: P.since });
					var groups = [['Coming', 'not out yet', g.coming], [P.since ? 'New since your last visit' : 'The last ' + R.RELEASE_DAYS + ' days', '', g.fresh], ['Earlier', 'before your last visit', g.earlier]];
					var any = false;
					groups.forEach(function (x) {
						if (!x[2].length) return;
						any = true;
						var gb = h('div', { class: 'ts-fy-group' });
						gb.appendChild(groupHead(ctx, x[0], [plural(ctx, x[2].length, 'release'), x[1]].filter(Boolean).join(', ')));
						var grid = h('div', { class: 'ts-shelf ts-fy-rshelf', role: 'list', aria: { label: x[0] } });
						x[2].slice(0, 24).forEach(function (al) { var c = releaseCard(P, al); c.setAttribute('role', 'listitem'); grid.appendChild(c); });
						gb.appendChild(grid);
						box.appendChild(gb);
					});
					if (!any && s.done) box.appendChild(h('p', { class: 'ts-muted ts-fy-none', text: 'Nothing new from your artists in the last ' + R.RELEASE_DAYS + ' days.' }));
					foot.textContent = s.done ? laneNote(ctx, s, 'artist') : 'Looking at your artists: ' + Math.min(s.i, s.count) + ' of ' + s.count + ELL;
					foot.hidden = !foot.textContent;
				}
				s.want = function () { return body.isConnected; };
				s.on(function () { if (body.isConnected) draw(); });
				draw();
				s.resume();
			}
		};
	}
	function dateWords(P, d) {
		var t = Date.parse(d + 'T12:00:00Z'), today = new Date(P.now).toISOString().slice(0, 10);
		var M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'], x = new Date(t);
		var words = M[x.getUTCMonth()] + ' ' + x.getUTCDate() + (x.getUTCFullYear() !== new Date(P.now).getUTCFullYear() ? ', ' + x.getUTCFullYear() : '');
		return d > today ? 'Coming ' + words : d === today ? 'Out today' : words;
	}
	function releaseCard(P, al) {
		var ctx = P.c, h = ctx.h, U = ctx.U;
		ctx.discoveryChanged = function () { if (P.lanes.releases) P.lanes.releases.reload(); };
		var art = artOn(ctx) && al.cover ? h('span', { class: 'ts-art' }, h('img', { src: al.cover, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' })) : U.swatch(hueOf(al.title), al.title, '', 45);
		var type = al.type === 'ep' ? 'EP' : al.type === 'single' ? 'Single' : al.type === 'compilation' ? 'Compilation' : 'Album';
		var sub = [al.artistName, type, dateWords(P, str(al.date).slice(0, 10))].filter(Boolean).join(' ' + DOT + ' ');
		var c = ctx.ui && ctx.ui.card ? ctx.ui.card({ href: '#', art: art, title: al.title, sub: sub, play: function () { albumDialog(P, al, true); }, playLabel: 'Play ' + al.title, cls: 'ts-fy-rcard' }) : h('div', { class: 'ts-card' });
		var a = c.querySelector('a');
		if (a) a.addEventListener('click', function (e) { e.preventDefault(); albumDialog(P, al); });
		return c;
	}
	// A dialog takes the focus (its close button), so Escape and Tab work in it at once.
	function focusIn(d) { var b = d && d.node && d.node.querySelector('.ts-modal-head button'); if (b && b.focus) b.focus(); }
	// A release's songs (artists.js albumTracks; the demo's carry theirs): Play all, Shuffle, Add to queue.
	function albumDialog(P, al, playNow) {
		var ctx = P.c, D = deps(P.base), h = ctx.h, U = ctx.U, Me = mod('media');
		var d = U.openDialog({ title: al.title, wide: true });
		focusIn(d);
		d.body.appendChild(h('p', { class: 'ts-muted', text: [al.artistName, dateWords(P, str(al.date).slice(0, 10)), al.trackCount ? plural(ctx, al.trackCount, 'song') : ''].filter(Boolean).join(' ' + DOT + ' ') }));
		var acts = h('div', { class: 'ts-row-btns ts-fy-dlg-btns' }), note = h('p', { class: 'ts-muted' }), list = h('div');
		d.body.appendChild(acts);
		d.body.appendChild(note);
		d.body.appendChild(list);
		note.textContent = 'Loading' + ELL;
		var get = al.tracks ? Promise.resolve({ tracks: al.tracks }) : D.artists ? D.artists.albumTracks(al, {}) : Promise.reject(new Error('Albums need artists.js.'));
		get.then(function (r) {
			var tracks = (r.tracks || []).map(function (f) { var c = Object.assign({}, f); c.mine = c.mine || mineOf(ctx, c); return c; });
			var have = tracks.filter(function (f) { return f.mine; }).length, label = al.title + ' (' + al.artistName + ')';
			var group = !ctx.demo && canRead(ctx) && tracks.filter(function (f) { return !f.mine && !f.videoId; }).length >= 4;
			note.textContent = 'You have ' + have + ' of ' + plural(ctx, tracks.length, 'song') + '.' + (have < tracks.length ? (ctx.demo ? ' The demo cannot search YouTube for the others.' : !canRead(ctx) ? ' Playing the others needs a sign-in or a YouTube API key (Settings).' : group ? ' The others are found on YouTube when you play: the album' + RSQ + 's own list first (one search, about 101 units for all of them).' : ' The others are found on YouTube when you play (a search each, 100 units, unless one was found before).') : '');
			function go(order) {
				var en = ctx.engine ? ctx.engine() : null;
				d.close();
				if (!group || !en || !en.resolveGroup) { playItems(P, order, label, '#/for-you?lane=releases'); return; }
				var job = ctx.job ? ctx.job('Finding ' + al.title + ' on YouTube' + ELL) : null;
				en.resolveGroup(order, { query: al.artistName + ' ' + al.title, title: al.title }).then(function () { if (job) job.done(); playItems(P, order, label, '#/for-you?lane=releases'); }, function () { if (job) job.done(); playItems(P, order, label, '#/for-you?lane=releases'); });
			}
			acts.appendChild(U.btn({ icon: 'play', label: 'Play all', variant: 'primary', size: 'md', cost: group ? 101 : null, on: { click: function () { go(tracks); } } }));
			acts.appendChild(U.btn({ icon: 'shuffle', label: 'Shuffle', variant: 'secondary', size: 'md', on: { click: function () { go(tracks.slice().sort(function () { return Math.random() - 0.5; })); } } }));
			acts.appendChild(U.btn({ icon: 'queue-add', label: 'Add to queue', variant: 'secondary', size: 'md', on: { click: function () { d.close(); playItems(P, tracks, label, '', 'later'); } } }));
			list.appendChild(Me.list(ctx, tracks, Object.assign(rowOpts(P, label, '#/for-you?lane=releases'), { list: tracks, numbered: true })));
			if (playNow) go(tracks);
		}, function (e) { note.textContent = explainText(e); });
	}

	// ---- 6. New from your channels ------------------------------------------------------------------------

	function curatorsOf(P) {
		var ctx = P.c, Ch = mod('channel');
		if (!Ch) return [];
		var w = {};
		P.prof.channels.forEach(function (c) { w[c.id] = c.w; });
		return Ch.rank(ctx.L.list(ctx.lib())).filter(function (c) { return c.curator; }).map(function (c, i) { return { c: c, i: i }; })
			.sort(function (x, y) { return (w[y.c.id] || 0) - (w[x.c.id] || 0) || x.i - y.i; }).map(function (x) { return x.c; }).slice(0, CURATORS_MAX);
	}
	function channelsLane(P) {
		var ctx = P.c, Ch = mod('channel'), Src = mod('sources'), D = deps(P.base), R = P.R;
		return {
			id: 'channels', title: 'New from your channels', sub: 'the channels that find music for you', badge: 'channel', layout: 'groups', lazy: true,
			unavailable: function () {
				if (!Ch || !Src) return { text: 'Channels need channel.js.', fix: null };
				if (ctx.demo) return null;
				if (!canRead(ctx) || !ctx.client || !ctx.client()) return { text: 'New uploads are read through YouTube' + RSQ + 's Data API (1 unit a channel): sign in, or add an API key in Settings.', fix: { label: 'Open Settings', icon: 'settings', run: function () { ctx.nav('#/settings'); } } };
				return null;
			},
			empty: function (d) { return d && d.curators ? 'Nothing new from your channels since you last looked.' : 'None of your channels uploads other artists' + RSQ + ' songs yet; such channels show up here.'; },
			load: function (signal) {
				return P.ready.then(function () {
					var lib = ctx.lib(), cur = curatorsOf(P), errors = [];
					if (!cur.length) return { items: [] };
					P.got.channels = [];
					var have = function (v) { return !!(lib.tracks[v] && !lib.tracks[v].transient); };
					return Promise.all(cur.map(function (c) {
						var get = ctx.demo ? Promise.resolve(Ch.demoUploads(c.id, c.name, ctx.S.rng('channel-' + c.id))) : Src.ytLists(ctx.client(), D.cache).uploads(c.id, { max: 50, signal: signal });
						return get.then(function (items) { return { c: c, items: items }; }, function (e) { if (e && e.code === 'aborted') throw e; errors.push(e); return null; });
					})).then(function (rows) {
						rows = rows.filter(Boolean);
						if (!rows.length && errors.length) throw errors[0];
						var groups = [];
						rows.forEach(function (r) {
							var c = r.c, rule = lib.channelRules && lib.channelRules[c.id];
							var finds = Ch.uploadFinds(r.items, { channelId: c.id, channel: c.name, rule: rule, have: have, find: Src.find }).filter(function (f) { return f.music && !f.mine; });
							// new: since you marked it seen; before that, since you last added one of its songs, 30 days at most
							var mark = +P.seenCh[c.id] || Math.max(Date.parse(c.lastAdded) || 0, P.now - 30 * DAY);
							var fresh = settle(P, 'channels', R.newSince(finds, mark), {});
							if (fresh.length) groups.push({ c: c, mark: mark, items: fresh });
						});
						var items = [];
						groups.forEach(function (g) { items = items.concat(g.items); });
						shown(P, items);
						return { groups: groups, items: items, curators: cur.length, note: errors.length ? plural(ctx, errors.length, 'channel') + ' could not be read: ' + explainText(errors[0]) : '' };
					});
				});
			},
			isEmpty: function (d) { return !d || !d.groups || !d.groups.length; },
			actions: function (d) {
				if (!d || !d.groups || !d.groups.length) return [];
				return [ctx.U.btn({ icon: 'check', label: 'Mark all seen', variant: 'secondary', size: 'sm', on: { click: function () { markSeen(P, d.groups.map(function (g) { return g.c.id; })); } } })];
			},
			render: function (body, d) {
				d.groups.forEach(function (g) {
					var h = ctx.h, U = ctx.U, box = h('div', { class: 'ts-fy-group', data: { channel: g.c.id } });
					var label = 'New from ' + g.c.name, href = ctx.link ? ctx.link('channel', g.c.id) : '#/channel/' + encodeURIComponent(g.c.id);
					var title = h('a', { class: 'ts-fy-glink', href: href, text: g.c.name });
					var sub = g.items.length + ' new since ' + R.sinceWords(g.mark, P.now);
					var play = U.btn({ icon: 'play', label: 'Play these', variant: 'secondary', size: 'sm', on: { click: function () { playItems(P, g.items, label, href); } } });
					var seenB = U.btn({ icon: 'check', label: 'Mark seen', variant: 'ghost', size: 'sm', on: { click: function () { markSeen(P, [g.c.id]); } } });
					box.appendChild(groupHead(ctx, title, sub, [play, seenB]));
					box.appendChild(rowsBlock(P, g.items, rowOpts(P, label, href), 4));
					body.appendChild(box);
				});
			}
		};
	}
	function markSeen(P, ids) {
		ids.forEach(function (id) { P.seenCh[id] = P.now; });
		P.kv.set('feed:seen', P.seenCh);
		var lane = P.lanes.channels;
		if (lane) lane.reload();
		P.c.say(ids.length === 1 ? 'Marked seen: its next uploads show up here.' : 'Marked seen: their next uploads show up here.');
	}

	// ---- 7. Because you play X -------------------------------------------------------------------------------

	// Up to three of your top artists that Deezer knows, found once for the three lanes.
	function becausePicks(P, signal) {
		if (P.picks) return P.picks;
		var ctx = P.c, D = deps(P.base);
		P.picks = P.ready.then(function () {
			var top = P.prof.artists.slice(0, ARTISTS_MAX);
			if (ctx.demo) return top.slice(0, BECAUSE_MAX).map(function (a) { return { artist: a, dz: null }; });
			if (!D.artists || !D.dz) return [];
			var out = [];
			return top.reduce(function (p, a) {
				return p.then(function () {
					if (out.length >= BECAUSE_MAX) return;
					return D.artists.find({ key: a.key, name: a.name }, { sources: ['deezer'], signal: signal }).then(function (fa) {
						if (fa && fa.deezer && fa.deezer.id != null) out.push({ artist: a, dz: fa.deezer });
					}, function (e) { if (e && e.code === 'aborted') throw e; });
				});
			}, Promise.resolve()).then(function () { return out; });
		});
		P.picks.then(null, function () { P.picks = null; });
		return P.picks;
	}
	// A lane with nothing to say that need not be there (a second Because lane) leaves the page.
	function dropLane(P, id) {
		setTimeout(function () {
			var l = P.lanes[id], w = root.document && root.document.getElementById('fy-lane-' + id);
			if (l) l.destroy();
			if (w && w.parentNode) w.parentNode.removeChild(w);
			delete P.lanes[id];
			P.dropped[id] = true;
		}, 0);
	}
	// The first lane is mounted with the page; once it knows the picks, the others join it (P.morePicks).
	function becauseLane(P, k) {
		var ctx = P.c, D = deps(P.base), id = 'because-' + k, guess = P.prof.artists[k];
		var pick = null;
		return {
			id: id, title: function (d) { var a = d && d.pick ? d.pick.artist : guess; return 'Because you play ' + (a ? a.name : 'your favourites'); },
			sub: function (d) { return d && d.pick ? 'artists Deezer relates to ' + d.pick.artist.name + ' that you do not have' : 'artists like your favourites'; },
			badge: ['ext', 'Deezer'], layout: 'cards', lazy: true, limit: 12, grid: false,
			unavailable: function () { return ctx.demo || (D.artists && D.dz) ? null : { text: 'Related artists come from Deezer, which is not available here.', fix: null }; },
			empty: function (d) {
				if (!d || !d.pick) return 'Deezer does not know your favourite artists, or you have not played enough yet.';
				return d.unknown ? 'The songs of the artists Deezer relates to ' + d.pick.artist.name + ' are in the lanes above, hidden, or heard lately.' : 'You already have every artist Deezer relates to ' + d.pick.artist.name + '.';
			},
			load: function (signal) {
				return becausePicks(P, signal).then(function (picks) {
					pick = picks[k] || null;
					if (k === 0 && P.morePicks) P.morePicks(picks);
					if (!pick) return { items: [] };
					var name = pick.artist.name;
					if (ctx.demo) {
						var taken = {};
						ctx.L.list(ctx.lib()).forEach(function (t) { if (t.artist) taken[fold(t.artist)] = true; });
						var inv = settle(P, id, demoRelated(name, k, taken), { fresh: true });
						shown(P, inv);
						return { items: inv, pick: pick, unknown: 4 };
					}
					return D.dz.related(pick.dz.id).then(function (rel) {
						var en = ctx.engine ? ctx.engine() : null;
						var fresh = rel.filter(function (a) { return a && a.name && !knownArtist(ctx, a.name) && !(en && en.isHidden && en.isHidden({ artist: a.name })); }).slice(0, RELATED_MAX);
						return Promise.all(fresh.map(function (a) { return D.dz.top(a.id, 3).then(function (l) { return (l || []).slice(0, 2); }, function () { return []; }); })).then(function (lists) {
							var all = [];
							lists.forEach(function (l) { l.forEach(function (f) { var c = Object.assign({}, f); c.why = [['related', name]]; all.push(c); }); });
							all = P.R.interleave(all, function (f) { return fold(f.artist); });
							var items = settle(P, id, all, { fresh: true });
							shown(P, items);
							if (k > 0 && !items.length) dropLane(P, id);
							return { items: items, pick: pick, total: items.length, unknown: fresh.length };
						});
					});
				});
			},
			row: rowOpts(P, guess ? 'Because you play ' + guess.name : 'Because you play', '#/for-you?lane=' + id),
			actions: function (d) {
				if (!d || !d.pick) return [];
				var U = ctx.U, a = d.pick.artist, out = [];
				var en = ctx.engine ? ctx.engine() : null, seed = a.ids && a.ids[0];
				if (en && seed) out.push(U.btn({ icon: 'radio', label: 'Start radio', variant: 'secondary', size: 'sm', title: 'A radio from your songs by ' + a.name + ', with new songs by the dial', on: { click: function () { en.radio(seed, { ratio: ratio(), label: 'Radio: like ' + a.name, href: '#/for-you?lane=' + id }); } } }));
				var pvb = U.btn({ icon: 'headphones', label: 'Preview all', variant: 'secondary', size: 'sm', on: { click: function () { previewList(P, d.items || [], 'Because you play ' + a.name, pvb); } } });
				out.push(pvb);
				return out;
			}
		};
	}

	// ---- 8. Saved for later, and what you hid ------------------------------------------------------------

	function savedLane(P) {
		var ctx = P.c, U = ctx.U, en = ctx.engine ? ctx.engine() : null;
		return {
			id: 'saved', title: 'Saved for later', sub: 'songs you kept to listen to', layout: 'rows', limit: 8,
			unavailable: function () { return en ? null : { text: 'Saved for later needs the discovery engine, which did not start on this page.', fix: null }; },
			empty: 'Nothing saved for later. The bookmark on a found song keeps it here.',
			load: function () {
				var items = (en.saved() || []).map(function (f) { var c = Object.assign({}, f); c.mine = mineOf(ctx, c); c.why = c.why && c.why.length ? c.why : [['saved', '']]; return c; });
				know(P, items);
				return Promise.resolve({ items: items, total: items.length });
			},
			isEmpty: function (d) { return !d || !d.items || !d.items.length; },
			row: rowOpts(P, 'Saved for later', '#/for-you?lane=saved', {
				menuItems: function (it) { return it.mine ? [{ label: 'Remove from Saved for later', icon: 'bookmark', onSelect: function () { en.unsave(it.key); } }] : []; }
			}),
			actions: function (d) {
				var items = (d && d.items) || [], out = [];
				if (items.length) {
					out.push(U.btn({ icon: 'play', label: 'Play all', variant: 'secondary', size: 'sm', on: { click: function () { playItems(P, items, 'Saved for later', '#/for-you?lane=saved'); } } }));
					out.push(U.btn({ icon: 'shuffle', label: 'Shuffle', variant: 'secondary', size: 'sm', on: { click: function () { playItems(P, items.slice().sort(function () { return Math.random() - 0.5; }), 'Saved for later', '#/for-you?lane=saved'); } } }));
					out.push(U.btn({ icon: 'queue-add', label: 'Add to queue', variant: 'secondary', size: 'sm', on: { click: function () { playItems(P, items, 'Saved for later', '', 'later'); } } }));
					out.push(U.btn({ icon: 'trash', label: 'Remove all', variant: 'secondary', size: 'sm', on: { click: function () {
						var keep = en.saved();
						keep.forEach(function (f) { en.unsave(f.key); });
						U.toast('Saved for later is empty.', { action: 'Undo', onAction: function () { keep.slice().reverse().forEach(function (f) { en.save(f); }); } });
					} } }));
				}
				return out;
			}
		};
	}
	var HIDDEN_KINDS = [['artist', 'Artists', 'artist'], ['song', 'Songs', 'song'], ['work', 'Anime and works', 'work'], ['channel', 'Channels', 'channel']];
	// What you hid (Not interested): how many of each, a few of their names, and a dialog to show them again.
	function hiddenLane(P) {
		var ctx = P.c, U = ctx.U, h = ctx.h, en = ctx.engine ? ctx.engine() : null;
		return {
			id: 'hidden', title: 'Hidden', sub: 'what you are not interested in, kept out of every suggestion', layout: 'rows',
			unavailable: function () { return en && en.hidden ? null : { text: 'Hiding songs needs the discovery engine, which did not start on this page.', fix: null }; },
			empty: 'Nothing is hidden. Not interested, in a found song' + RSQ + 's menu, keeps a song or its artist out of suggestions.',
			load: function () { return P.ready.then(function () { var hd = en.hidden(), n = {}, total = 0; HIDDEN_KINDS.forEach(function (k) { n[k[0]] = Object.keys(hd[k[0]] || {}).length; total += n[k[0]]; }); return { counts: n, all: total, hd: hd }; }); },
			isEmpty: function (d) { return !d || !d.all; },
			actions: function (d) { return d && d.all ? [U.btn({ icon: 'eye-off', label: 'See them and show again', variant: 'secondary', size: 'sm', cls: 'ts-fy-hidden-btn', on: { click: function () { hiddenDialog(P); } } })] : []; },
			render: function (body, d) {
				var parts = HIDDEN_KINDS.filter(function (k) { return d.counts[k[0]]; }).map(function (k) { return plural(ctx, d.counts[k[0]], k[2]); });
				body.appendChild(h('p', { class: 'ts-fy-hsum', text: 'You hid ' + (parts.length > 1 ? parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1] : parts[0]) + '.' }));
				var names = h('div', { class: 'ts-chips ts-fy-hnames' }), n = 0;
				HIDDEN_KINDS.forEach(function (k) { Object.keys(d.hd[k[0]] || {}).sort(function (a, b) { return d.hd[k[0]][b] - d.hd[k[0]][a]; }).forEach(function (key) { if (n++ < 6) names.appendChild(h('span', { class: 'ts-chip is-small', text: hiddenName(P, k[0], key) })); }); });
				body.appendChild(names);
			}
		};
	}
	function hiddenName(P, kind, key) {
		var ctx = P.c, en = ctx.engine ? ctx.engine() : null;
		if (P.names[kind + ':' + key]) return P.names[kind + ':' + key];
		if (kind === 'song') {
			var pool = en ? (en.saved() || []).slice() : [];
			Object.keys(P.got).forEach(function (id) { pool = pool.concat(P.got[id] || []); });
			var s = pool.filter(function (f) { return f && f.key === key; })[0];
			if (s) return s.title + (s.artist ? ' by ' + s.artist : '');
		}
		if (kind === 'channel') { var t = ctx.L.list(ctx.lib()).filter(function (x) { return x.channelId === key && x.channel; })[0]; if (t) return t.channel; }
		return kind === 'song' ? 'A song (' + key + ')' : key;
	}
	// Show again: the engine's own undo of a hide (hide once more, then take it back).
	function unhide(en, kind, key) {
		if (typeof en.unhide === 'function') { en.unhide(kind, key); return; }
		var undo = en.hide(kind, key);
		if (typeof undo === 'function') undo();
	}
	function hiddenDialog(P) {
		var ctx = P.c, h = ctx.h, U = ctx.U, en = ctx.engine(), R = P.R;
		var d = U.openDialog({ title: 'Hidden from suggestions', wide: false });
		focusIn(d);
		var body = d.body, hd = en.hidden(), KINDS = HIDDEN_KINDS;
		function nameOf(kind, key) { return hiddenName(P, kind, key); }
		function draw() {
			ctx.clear(body);
			// the button pressed is gone: the focus stays in the dialog
			if (root.document && !d.node.contains(root.document.activeElement)) focusIn(d);
			hd = en.hidden();
			var any = false;
			KINDS.forEach(function (k) {
				var keys = Object.keys(hd[k[0]] || {}).sort(function (a, b) { return hd[k[0]][b] - hd[k[0]][a]; });
				if (!keys.length) return;
				any = true;
				body.appendChild(h('h3', { class: 'ts-fy-hh', text: k[1] + ' (' + keys.length + ')' }));
				var ul = h('ul', { class: 'ts-fy-hlist' });
				keys.forEach(function (key) {
					var at = +hd[k[0]][key] || 0, name = nameOf(k[0], key);
					ul.appendChild(h('li', { class: 'ts-fy-hrow' }, [
						h('span', { class: 'ts-fy-hname', text: name, title: name }),
						at ? h('span', { class: 'ts-muted ts-fy-hwhen', text: R.sinceWords(at, Date.now()) }) : null,
						U.btn({ label: 'Show again', variant: 'secondary', size: 'sm', aria: { label: 'Show ' + name + ' again' }, on: { click: function () { unhide(en, k[0], key); ctx.say(name + ' may be suggested again.'); draw(); } } })
					]));
				});
				body.appendChild(ul);
			});
			if (!any) { body.appendChild(h('p', { class: 'ts-muted', text: 'Nothing is hidden. Not interested, in a found song' + RSQ + 's menu, hides a song or its artist from suggestions.' })); return; }
			body.appendChild(h('div', { class: 'ts-fy-dlg-btns' }, [U.btn({ icon: 'retry', label: 'Show everything again', variant: 'secondary', size: 'sm', on: { click: function () {
				KINDS.forEach(function (k) { Object.keys(hd[k[0]] || {}).forEach(function (key) { unhide(en, k[0], key); }); });
				ctx.say('Everything hidden may be suggested again.');
				draw();
			} } })]));
		}
		draw();
	}

	// ---- The page ---------------------------------------------------------------------------------------

	var css = false;
	function injectCss() {
		if (css || !root.document) return;
		css = true;
		var st = root.document.createElement('style');
		st.id = 'ts-foryou-css';
		st.textContent = [
			'.ts-fy-jump{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0 18px}',
			'.ts-fy-lane{margin:0 0 26px;max-width:1000px;scroll-margin-top:72px;min-width:0}',
			'.ts-fy-lane[hidden]{display:none}',
			'.ts-fy-hero{display:flex;flex-direction:column;gap:14px;padding:16px 18px;border:1px solid var(--border);border-radius:16px;background:linear-gradient(135deg,color-mix(in srgb,var(--ts-play,#1f5fd6) 12%,transparent),transparent 70%)}',
			'.ts-fy-hero-main{min-width:0}',
			'.ts-fy-seed{margin:0;font-size:14px;line-height:1.45;color:var(--text-2);overflow-wrap:anywhere}',
			'.ts-fy-seed b{color:var(--heading);font-weight:650}',
			'.ts-fy-hero-btns{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin:12px 0 0}',
			'.ts-fy-seed{max-width:70ch}',
			'.ts-fy-dial{min-width:0;display:flex;flex-wrap:wrap;align-items:center;gap:6px 12px}',
			'.ts-fy-dial-h{margin:0;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--text-2)}',
			'.ts-fy-seg .ts-seg-b[aria-checked="true"]{background:var(--heading);color:var(--bg);border-color:var(--heading)}',
			'.ts-fy-dial-say{margin:0;flex:1 1 220px;font-size:12.5px;line-height:1.4}',
			'.ts-fy-quota{margin:0;font-size:13px;line-height:1.45;color:var(--text-2)}',
			'.ts-fy-sources{display:flex;flex-wrap:wrap;align-items:center;gap:6px 8px;font-size:12.5px}',
			'.ts-fy-src-h{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--text-2);margin-right:2px}',
			'.ts-fy-src{display:inline-flex;align-items:center;gap:4px;padding:2px 9px 2px 6px;border-radius:999px;border:1px solid var(--border);color:var(--text-2);text-decoration:none;white-space:nowrap}',
			'.ts-fy-src .ts-i{width:14px;height:14px;flex:none}',
			'.ts-fy-src.is-on{color:var(--text)}',
			'.ts-fy-src.is-on .ts-i{color:var(--ts-ok)}',
			'a.ts-fy-src:hover{border-color:var(--border-strong);color:var(--text)}',
			'.ts-fy-group{margin:2px 0 12px;min-width:0}',
			'.ts-fy-gh{display:flex;flex-wrap:wrap;align-items:center;gap:4px 12px;margin:12px 8px 4px}',
			'.ts-fy-gt{margin:0;font-size:15px;font-weight:700;color:var(--heading);min-width:0;overflow-wrap:anywhere}',
			'.ts-fy-gsub{font-size:12.5px;color:var(--text-2)}',
			'.ts-fy-gbtns{margin-left:auto;display:flex;flex-wrap:wrap;gap:6px}',
			'.ts-fy-glink{color:inherit;text-decoration:none}',
			'.ts-fy-glink:hover{text-decoration:underline}',
			'.ts-fy-count{font-weight:600;color:var(--text-2);font-variant-numeric:tabular-nums}',
			'.ts-fy-prog{position:relative;flex:none;width:96px;height:6px;border-radius:3px;background:var(--ts-hover);overflow:hidden}',
			'.ts-fy-prog::after{content:"";position:absolute;inset:0 auto 0 0;width:calc(var(--p,0) * 1%);background:var(--ts-play,#1f5fd6);border-radius:3px}',
			'.ts-fy-ashelf,.ts-fy-rshelf{gap:4px;grid-auto-columns:minmax(150px,160px);margin:0 -2px}',
			'.ts-fy-acard .ts-fy-cover{aspect-ratio:3/4;margin-bottom:6px}',
			'.ts-fy-acard .ts-card-sub{-webkit-line-clamp:1}',
			'.ts-fy-over{position:absolute;left:10px;right:10px;top:10px;aspect-ratio:3/4;pointer-events:none}',
			'.ts-fy-over .ts-bigplay{pointer-events:auto;top:auto;right:8px;bottom:8px;width:40px;height:40px}',
			'.ts-fy-acard:hover .ts-fy-over .ts-bigplay,.ts-fy-acard:focus-within .ts-fy-over .ts-bigplay{opacity:1;transform:none}',
			'.ts-fy-themes,.ts-fy-srclist{display:flex;flex-wrap:wrap;gap:4px;margin:6px 0 0;padding:0;list-style:none}',
			'.ts-fy-srclist{gap:6px 8px;margin:0}',
			'.ts-fy-theme{display:inline-flex;align-items:center;gap:3px;padding:0 7px;border-radius:999px;border:1px solid var(--border);font-size:11.5px;font-weight:650;line-height:20px;color:var(--text-2);text-decoration:none}',
			'.ts-fy-theme:hover{color:var(--text);border-color:var(--border-strong)}',
			'.ts-fy-theme.is-mine{color:var(--ts-ok);border-color:color-mix(in srgb,var(--ts-ok) 45%,transparent)}',
			'.ts-fy-theme .ts-i{width:12px;height:12px}',
			'.ts-fy-showmore{margin:6px 8px 0}',
			'.ts-fy-more{margin:8px 8px 0;font-size:12.5px}',
			'.ts-fy-none{margin:6px 8px}',
			
			'.ts-fy-dlg-btns{display:flex;flex-wrap:wrap;gap:8px;margin:6px 0 10px}',
			'.ts-fy-hh{margin:14px 0 4px;font-size:14px}',
			'.ts-fy-hsum{margin:0 8px 4px;font-size:14px;color:var(--text)}',
			'.ts-fy-hnames{margin:4px 8px 0}',
			'.ts-fy-hlist{list-style:none;margin:0;padding:0}',
			'.ts-fy-hrow{display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid var(--border)}',
			'.ts-fy-hname{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
			'.ts-fy-hwhen{font-size:12.5px;white-space:nowrap}',
			'@media (hover:none),(pointer:coarse){.ts-fy-over .ts-bigplay{opacity:1;transform:none}}',
			'@media (max-width:760px){.ts-fy-hero{padding:14px}.ts-fy-gbtns{margin-left:0;flex-basis:100%}.ts-fy-ashelf,.ts-fy-rshelf{grid-auto-columns:minmax(136px,144px)}.ts-fy-over .ts-bigplay{opacity:1;transform:none;width:36px;height:36px}}'
		].join('\n');
		root.document.head.appendChild(st);
	}

	function view(el, base, parts, query) {
		injectCss();
		var R = mod('recs'), Lanes = mod('lanes'), Me = mod('media');
		if (!R || !Lanes || !Me) { el.appendChild(base.h('p', { class: 'ts-empty', text: 'For you needs recs.js, lanes.js and media.js.' })); return null; }
		var P = page(base);
		P.c = laneCtx(P, base);
		var ctx = P.c, h = ctx.h, U = ctx.U;
		var prof = P.prof;
		var meta = prof.songs.length ? 'From ' + plural(ctx, prof.songs.length, 'song') + ' you play or like' + (prof.artists.length ? ' ' + DOT + ' ' + plural(ctx, prof.artists.length, 'artist') : '') + (prof.works.length ? ' ' + DOT + ' ' + plural(ctx, prof.works.length, 'series', 'series') : '') : 'Play or like a few songs: this page learns from what you play.';
		if (ctx.ui && ctx.ui.headerBlock) ctx.ui.headerBlock(el, { kicker: 'Discover', title: 'For you', art: false, hue: { h: 265, s: 45 }, blurb: 'Find more songs by artists you listen to, choose someone new, or explore artists like your favourites. Search YouTube for a song and add it to your playlist.', meta: meta });
		else el.appendChild(h('h1', { class: 'ts-h1', text: 'For you' }));
		var jump = h('div', { class: 'ts-fy-jump', role: 'navigation', aria: { label: 'Jump to' } });
		el.appendChild(jump);
		el.appendChild(h('div', { class: 'ts-discovery-destinations' }, [h('a', { class: 'ts-chip', href: '#/listening-shelf?tab=albums', text: 'Want to hear' }), h('a', { class: 'ts-chip', href: '#/listening-shelf?tab=tray', text: 'Discovery tray' }), h('a', { class: 'ts-chip', href: '#/listening-shelf?tab=inbox', text: 'Release inbox' })]));
		if (root.TrueShuffle.artistLaunch && !(query && query.get('artist'))) {
			var currentArtist = h('div', { class: 'ts-current-artist' }); el.appendChild(currentArtist);
			root.TrueShuffle.artistLaunch.live(currentArtist, ctx);
		}
		if (root.TrueShuffle.artistDiscovery) root.TrueShuffle.artistDiscovery(el, ctx, query);
		el.addEventListener('click', function (e) {
			var a = e.target && e.target.closest ? e.target.closest('a[href^="#/explore/find/"]') : null;
			if (!a) return;
			var key = '';
			try { key = decodeURIComponent(a.getAttribute('href').slice('#/explore/find/'.length)); } catch (x) { return; }
			if (P.known[key]) exploreFind(P, { key: key });
		}, true);
		var specs = [['releases', releasesLane(P)], ['radio', radioLane(P)], ['channels', channelsLane(P)]];
		var mounted = [];
		function mount(id, spec, after) {
			var wrap = h('section', { class: 'ts-fy-lane', id: 'fy-lane-' + id });
			el.appendChild(wrap);
			var lane = Lanes.mount(wrap, ctx, spec);
			P.lanes[id] = lane;
			mounted.push(lane);
			if (after) after(wrap, lane);
			return wrap;
		}
		specs.forEach(function (x) { mount(x[0], x[1]); });
		var firstBecause = mount('because-0', becauseLane(P, 0));
		var savedWrap = mount('saved', savedLane(P));
		mount('hidden', hiddenLane(P));
		var anime = h('details', { class: 'ts-discovery-anime' }, h('summary', { text: 'Anime & series: this season, airing today, and songs from your series' })); el.appendChild(anime);
		var animeMounted = false;
		function openAnime() { if (animeMounted || !anime.open) return; animeMounted = true; [['season', seasonLane(P)], ['airing', airingLane(P)], ['series', seriesLane(P)]].forEach(function (x) { var w = mount(x[0], x[1]); anime.appendChild(w); }); }
		anime.addEventListener('toggle', openAnime);
		// the other Because lanes, for the other artists Deezer knows, after the first
		P.morePicks = function (picks) {
			for (var k = 1; k < Math.min(picks.length, BECAUSE_MAX); k++) {
				if (P.lanes['because-' + k] || P.dropped['because-' + k] || !firstBecause.isConnected) continue;
				var wrap = h('section', { class: 'ts-fy-lane', id: 'fy-lane-because-' + k });
				el.insertBefore(wrap, savedWrap);
				var lane = Lanes.mount(wrap, ctx, becauseLane(P, k));
				P.lanes['because-' + k] = lane;
				mounted.push(lane);
			}
		};
		// Saved for later follows the engine: a save or a removal anywhere redraws it.
		var en = ctx.engine ? ctx.engine() : null;
		if (en && en.on) {
			var off = en.on('saved', function () { var l = P.lanes.saved; if (!l || !l.node.isConnected) { off(); return; } l.reload(); });
			var off2 = en.on('hidden', function () { var l = P.lanes.hidden; if (!l || !l.node.isConnected) { off2(); return; } if (l.state() !== 'loading') l.reload(); });
		}
		JUMP.forEach(function (j) {
			jump.appendChild(U.btn({ variant: 'chip', label: j[1], on: { click: function () { var w = root.document.getElementById(j[0] === 'artists' ? 'fy-artists' : 'fy-lane-' + j[0]); if (w) w.scrollIntoView({ behavior: 'smooth', block: 'start' }); } } }));
		});
		var want = query && query.get ? query.get('lane') : '';
		if (want === 'because') want = 'because-0';
		if (['season', 'airing', 'series'].indexOf(want) >= 0) { anime.open = true; openAnime(); }
		if (want && root.document && root.document.getElementById('fy-lane-' + want)) setTimeout(function () { var w = root.document.getElementById('fy-lane-' + want); if (w) w.scrollIntoView({ block: 'start' }); }, 60);
		return { lanes: mounted, profile: prof };
	}

	return {
		view: view, LANES: LANES, joinSeason: joinSeason, airingOf: airingOf, AIRING: AIRING, dayRange: dayRange, airingToday: airingToday, itunesPreview: itunesPreview,
		demoSeason: demoSeason, demoRelated: demoRelated, stream: stream
	};
});
