/*
 * True Shuffle: artists. An artist or band of the library, found on iTunes,
 * Deezer and AnimeThemes and checked against the listener's own songs, with
 * their top songs, their albums, EPs, singles and compilations (and how many
 * songs of each the library has), and the anime songs they sang. It feeds the
 * Explore page's "artist or band" lane and its album dialog.
 *
 *     var artists = TrueShuffle.artists.create(deps);
 *     artists.find(who, { signal, sources }) -> Promise<null | found>
 *     artists.discography(found, { signal }) -> Promise<{ top, albums, eps, singles, compilations, anime, errors }>
 *     artists.albumTracks(album, { signal, from }) -> Promise<{ tracks, have, total }>
 *     artists.reject(who, source, id) -> Promise<found | null>      "Not this artist"
 *     artists.confirm(who, source, id) -> Promise<found | null>     "Yes, this one"
 *     artists.demo(artistKey, lib) -> { found, discography } | null    invented, no network (?demo=1)
 *
 * deps: { it: sources.js iTunes(http, cache), dz: deezerFinds(dz, cache) or null,
 *         at: animeThemes(http, cache) or null, M: match.js, L: library.js,
 *         index() -> match.js index of the library, tracks() -> the library's tracks,
 *         map: { get(key) -> Promise<value | undefined>, set(key, value) -> Promise } or null,
 *         now() -> ms }
 *
 * Finding: iTunes is asked in the artist's own store first (Japan's for a
 * name in Japanese script, or when most of their songs here are Japanese or
 * from an anime, a game or a visual novel; else the US store), then in the
 * other, by the name and then the native name. A store's artist named alike
 * is sure when one of its song or release titles is a song the library has by
 * this artist; an equal name alone is only probable. Deezer the same way;
 * AnimeThemes by an equal name. What was found is kept under artist:<key> in
 * map (without one, for the session): a store's artist is looked for again
 * after 90 days, "not there" after 30, never for ever, and a store that did
 * not answer is asked again next time. The listener's own answers (confirm,
 * reject) always win.
 *
 * Plain ASCII: every other character is written as an escape.
 * UMD: window.TrueShuffle.artists in the browser, module.exports in Node.
 */
(function (root, factory) {
	var api = factory(root);
	if (typeof module === 'object' && module.exports) module.exports = api;
	else { root.TrueShuffle = root.TrueShuffle || {}; root.TrueShuffle.artists = api; }
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this), function (root) {
	'use strict';

	var DAY = 86400000;
	var RECHECK_MS = 90 * DAY;    // a store's artist is looked for again after this
	var MISS_MS = 30 * DAY;       // and "not there" is believed this long
	var SONGS = 100;              // iTunes songs read for an artist: the check and Top songs share the answer
	var DZ_TOP = 50;              // Deezer top songs read for an artist, the same way
	var TOP = 30;                 // top songs given
	var ITUNES_MAX = 8;           // iTunes requests one find may make (Apple allows about 20 a minute)
	var CHECK_MAX = 2;            // artists named alike whose songs are read, per store and name
	var CANDS_MAX = 6;            // candidates kept per source
	var SOURCES = ['itunes', 'deezer', 'animethemes'];
	var GROUPS = { album: 'albums', ep: 'eps', single: 'singles', compilation: 'compilations' };
	var TYPED = { name: 2, store: 2, count: 1, guess: 0 };    // how much a type is worth, by what said it

	var JAPANESE = /[\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uFF66-\uFF9F]/;
	var HAN = /[\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7AF]/;     // kanji, and Hangul: two of them name a song
	var KANA = /[\u3040-\u30FF\uFF66-\uFF9F]/;
	var JP_SCENES = { anime: true, game: true, vn: true };
	// Names of releases that gather earlier ones: best-ofs, greatest hits,
	// anthologies, singles and B-side collections; the Japanese words for best
	// (besuto), complete works (zenshuu) and collected works (sakuhinshuu).
	var COMPILATION = /\bbest\s+of\b|\b(?:the|very|all[\s-]*time|complete|ultimate|greatest)\s+best\b|\bbest\s+(?:album|selection|collection|hits|tracks)\b|\bgreatest\s+hits\b|\bhits\s+collection\b|\banthology\b|\bretrospective\b|\bthe\s+essentials?\b|^essentials$|\bsingles\s+(?:collection|best)\b|^(?:the\s+)?(?:complete\s+)?singles(?:\s+\d{4}\s*[-\u2013]\s*\d{4})?$|\bb[\s-]?sides\b|\brarities\b|^(?:the\s+)?(?:complete\s+)?collection$|\bthe\s+collection\b|\bdefinitive\s+collection\b|\bcomplete\s+works\b|\u30D9\u30B9\u30C8|\u5168\u96C6|\u4F5C\u54C1\u96C6/i;
	var SUFFIX = / - (Single|EP)$/i;
	// "EP" as a word, a mini album (and mini arubamu)
	var EP_WORD = /\bE\.?P\b|\bmini[\s-]*album\b|\u30DF\u30CB\u30A2\u30EB\u30D0\u30E0/i;
	var ALBUM_WORD = /\balbum\b|\u30A2\u30EB\u30D0\u30E0/i;
	// round, square, full-width and lenticular brackets, with what is in them
	var BRACKETS = /\s*(?:\([^()]*\)|\[[^[\]]*\]|\uFF08[^\uFF08\uFF09]*\uFF09|\u3010[^\u3010\u3011]*\u3011)\s*/g;
	// Titles too common to say whose song it is.
	var GENERIC = { intro: 1, outro: 1, interlude: 1, prologue: 1, epilogue: 1, overture: 1, reprise: 1, untitled: 1, instrumental: 1, opening: 1, ending: 1, theme: 1, maintheme: 1, bonustrack: 1, skit: 1, demo: 1, op: 1, ed: 1 };

	function mod(name) { return root && root.TrueShuffle && root.TrueShuffle[name]; }
	function need(name, file) { return mod(name) || (typeof require === 'function' ? require(file) : null); }
	function str(v) { return v == null ? '' : String(v); }
	function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
	function copy(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }
	function shallow(o) { var out = {}; for (var k in o) if (own(o, k)) out[k] = o[k]; return out; }
	function values(o) { return Array.isArray(o) ? o : o ? Object.keys(o).map(function (k) { return o[k]; }) : []; }
	function yearOf(date) { var y = parseInt(str(date).slice(0, 4), 10); return y > 0 ? y : 0; }
	function dayOf(date) { var t = Date.parse(str(date).slice(0, 10)); return isNaN(t) ? null : Math.round(t / DAY); }
	function titleOf(x) { return typeof x === 'string' ? x : str(x && (x.title != null ? x.title : x.name)); }
	function byId(a, b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; }
	function commonest(counts) {
		var best = '', n = 0;
		Object.keys(counts).sort().forEach(function (k) { if (counts[k] > n) { n = counts[k]; best = k; } });
		return best;
	}
	// Names compared without case, accents, punctuation or a leading "the"
	// (match.js fold, discover.js norm).
	function fold(s) {
		return str(s).normalize('NFKC').normalize('NFKD').replace(/[\u0300-\u036F]/g, '').toLowerCase()
			.replace(/&/g, ' and ').replace(/^\s*the\s+/, '').replace(/[^\p{L}\p{N}]+/gu, '');
	}

	// ---- Errors and stopping -------------------------------------------------------------------

	// A SourceError (sources.js), so the page treats it like any source's.
	function failure(code, message) {
		var S = need('sources', './sources.js');
		if (S && S.SourceError) return S.SourceError(code, message, { host: 'artists' });
		var e = new Error(message);
		e.name = 'SourceError';
		e.code = code;
		return e;
	}
	function stopped() { return failure('aborted', 'Stopped.'); }
	function aborted(e, signal) { return (!!e && e.code === 'aborted') || !!(signal && signal.aborted); }
	// A promise that also rejects ('aborted') when the signal fires: for the
	// Deezer calls, which take no signal of their own.
	function guard(p, signal) {
		if (!signal || !signal.addEventListener) return Promise.resolve(p);
		return new Promise(function (resolve, reject) {
			if (signal.aborted) { reject(stopped()); return; }
			var off = function () { reject(stopped()); };
			signal.addEventListener('abort', off);
			Promise.resolve(p).then(function (v) { signal.removeEventListener('abort', off); resolve(v); }, function (e) { signal.removeEventListener('abort', off); reject(e); });
		});
	}
	// Run fn over items one after another until one gives something.
	// -> Promise<the first value that is not null | null>
	function firstOf(items, fn) {
		var i = 0;
		function next() {
			if (i >= items.length) return Promise.resolve(null);
			var x = items[i++];
			return Promise.resolve(fn(x)).then(function (v) { return v != null ? v : next(); });
		}
		return next();
	}

	// ---- Names, stores and titles (pure) -------------------------------------------------------

	// The keys a name is known by: its fold, and its loose key (match.js, kana
	// read as romaji first), so "AOI  MINATO", "Aoi Minato" and a katakana
	// spelling of "Yorushika" meet.
	function nameKeys(name, M) {
		var n = str(name).trim();
		if (!n) return [];
		var out = [fold(n)];
		if (M && M.loose) out.push(M.loose(M.romaji && M.kana ? M.romaji(M.kana(n)) : n));
		return out.filter(Boolean);
	}
	// Is a store's artist named as ours (the name or the native name)? An
	// equal fold or loose key; "Aoi Minato Trio" is not "Aoi Minato".
	function namedAlike(name, ours, M) {
		var k = nameKeys(name, M);
		return (ours || []).some(function (o) {
			var ok = nameKeys(o, M);
			return k.some(function (x) { return ok.indexOf(x) >= 0; });
		});
	}
	// Worth offering as "this one?": named alike, or one name holds the other.
	function relatedName(name, ours, M) {
		if (namedAlike(name, ours, M)) return true;
		var f = fold(name);
		return f.length >= 3 && (ours || []).some(function (o) { var g = fold(o); return g.length >= 3 && (f.indexOf(g) >= 0 || g.indexOf(f) >= 0); });
	}

	// The iTunes store to look in first: Japan's ('JP') for a name or native
	// name in Japanese script, or when most of the artist's songs here are
	// Japanese (lang 'ja', or no language and a title in Japanese script) or
	// from an anime, a game or a visual novel (scene 'anime', 'game', 'vn');
	// otherwise the US store.
	function storeFor(name, native, tracks) {
		if (JAPANESE.test(str(name)) || JAPANESE.test(str(native))) return 'JP';
		var n = 0, jp = 0;
		(tracks || []).forEach(function (t) {
			if (!t) return;
			n++;
			if (t.lang === 'ja' || own(JP_SCENES, str(t.scene)) || (!t.lang && JAPANESE.test(str(t.title)))) jp++;
		});
		return n && jp * 2 > n ? 'JP' : 'US';
	}

	// What kind of release, and what said so: 'name' (its title), 'store'
	// (the store's own word), 'count' (its number of songs), 'guess'.
	function typing(album) {
		var a = typeof album === 'string' ? { title: album } : (album || {});
		var name = str(a.title != null ? a.title : a.name).trim(), said = str(a.type).toLowerCase(), n = +a.trackCount || 0;
		var stated = a.source === 'deezer' || a.stated === true;
		if (said === 'compilation' || said === 'compile') return { type: 'compilation', by: 'store' };
		if (COMPILATION.test(name)) return { type: 'compilation', by: 'name' };
		var m = SUFFIX.exec(name);
		if (m) return { type: m[1].toLowerCase(), by: 'name' };
		if (EP_WORD.test(name)) return { type: 'ep', by: 'name' };
		// iTunes's client calls a release of up to three songs a single itself:
		// only more songs than that show the store's own " - Single".
		if (said === 'ep') return { type: 'ep', by: 'store' };
		if (said === 'single') return { type: 'single', by: stated || n > 3 ? 'store' : 'count' };
		if (said === 'album' && stated) return { type: 'album', by: 'store' };
		if (n >= 1 && n <= 3) return { type: 'single', by: 'count' };
		if (n >= 4 && n <= 6) return ALBUM_WORD.test(name) ? { type: 'album', by: 'name' } : { type: 'ep', by: 'count' };
		return { type: 'album', by: n ? 'count' : 'guess' };
	}
	// The type of a release: 'album' | 'ep' | 'single' | 'compilation'.
	// album: a title (a string), or { title, trackCount, type, source }:
	// type is what the source said (the iTunes client's 'Album' 'EP' 'Single'
	// 'Compilation', or Deezer's record_type), and source 'deezer' (or
	// stated: true) means the source states its types, so its 'album' stands
	// whatever the count. In order:
	//   1. a compilation: the source says so, or the title reads like one
	//      (Best of, Greatest Hits, Anthology, The Singles, B-Sides...);
	//   2. the title's " - Single" or " - EP", then "EP" or "mini album" in it;
	//   3. what the source said: single, EP, and album when it states types;
	//   4. the count: 1 to 3 songs a single, 4 to 6 an EP unless the title
	//      says album, more (or unknown) an album.
	function albumType(album) { return typing(album).type; }

	function titleKeysOf(al, M) {
		var t = str(al.title), keys = [fold(t)];
		if (M && M.baseTitle) keys.push(fold(M.baseTitle(t)));
		return keys.filter(Boolean);
	}
	// One release listed twice (by two stores, or twice by one): a title key
	// in common, and dates at most two days apart (time zones), or the same
	// year and type. An album and its title song's single stay apart.
	function sameRelease(a, b, M) {
		var ka = titleKeysOf(a, M), kb = titleKeysOf(b, M);
		if (!ka.some(function (k) { return kb.indexOf(k) >= 0; })) return false;
		var da = dayOf(a.date), db = dayOf(b.date);
		if (da != null && db != null && Math.abs(da - db) <= 2) return true;
		return (+a.year || 0) === (+b.year || 0) && a.type === b.type;
	}
	function newestFirst(a, b) {
		var x = str(a.date), y = str(b.date);
		if (x !== y) return !x ? 1 : !y ? -1 : x < y ? 1 : -1;
		return str(a.title) < str(b.title) ? -1 : str(a.title) > str(b.title) ? 1 : 0;
	}
	function asAlbum(al) {
		var c = copy(al);
		if (!GROUPS[c.type] || !c.typedBy) { var t = typing(c); c.type = t.type; c.typedBy = t.by; }
		if (!c.year) c.year = yearOf(c.date);
		c.ids = c.ids || {};
		if (c.source && c.ids[c.source] == null) c.ids[c.source] = c.id;
		return c;
	}
	// Two listings of one release made one.
	function join(twin, al) {
		if (al.source === twin.source) {
			// one store listing a release twice (a clean and an explicit version):
			// the one with more songs leads
			if ((+al.trackCount || 0) > (+twin.trackCount || 0)) {
				twin.id = al.id;
				twin.key = al.key || twin.key;
				twin.ids[al.source] = al.id;
				if (al.cover) twin.cover = al.cover;
				if (al.link) twin.link = al.link;
			}
		} else if (twin.ids[al.source] == null) twin.ids[al.source] = al.id;
		if (!twin.cover && al.cover) twin.cover = al.cover;
		if (!twin.link && al.link) twin.link = al.link;
		if (!twin.date && al.date) { twin.date = al.date; twin.year = al.year; }
		twin.trackCount = Math.max(+twin.trackCount || 0, +al.trackCount || 0);
		if (twin.type !== 'compilation' && (al.type === 'compilation' || (TYPED[al.typedBy] || 0) > (TYPED[twin.typedBy] || 0))) {
			twin.type = al.type;
			twin.typedBy = al.typedBy;
		}
	}
	// Albums from several lists (iTunes's, then Deezer's) as one list, newest
	// first, each release once. The first list's entry leads (its id, key,
	// link and cover); the other store's id joins its ids. A type from a
	// title or a store wins over one from a count, and a compilation stays one.
	// M (match.js) is optional: with it, base titles meet too.
	function mergeAlbums(lists, M) {
		var out = [];
		(lists || []).forEach(function (list) {
			(list || []).forEach(function (raw) {
				if (!raw || raw.id == null) return;
				// the listing of the same type first (an album and its title song's
				// single can share a date)
				var al = asAlbum(raw), twins = out.filter(function (x) { return sameRelease(x, al, M); });
				var twin = twins.filter(function (x) { return x.type === al.type; })[0] || twins[0];
				if (twin) join(twin, al); else out.push(al);
			});
		});
		return out.sort(newestFirst);
	}

	// How much a title key says whose song it is: 0 for a generic one (Intro,
	// Interlude, Opening...), 1 for two kanji or Hangul or more, or seven
	// letters or more (kana counted as romaji), else 0.5.
	function strength(k, M) {
		if (!k || own(GENERIC, k)) return 0;
		if (HAN.test(k)) return k.length >= 2 ? 1 : 0.5;
		var latin = KANA.test(k) && M && M.romaji && M.kana ? M.romaji(M.kana(k)) : k;
		return latin.length >= 7 ? 1 : 0.5;
	}
	// A title's keys: match.js titleKeys, and the same with every bracket
	// taken out ("Blue Signal (Starfall Odyssey)" is also "Blue Signal").
	function keysFor(title, alt, M) {
		var keys = M.titleKeys(title, alt).slice();
		[title, alt].forEach(function (x) {
			x = str(x).trim();
			var bare = x.replace(BRACKETS, ' ').replace(/\s+/g, ' ').trim();
			if (bare && bare !== x) M.titleKeys(bare).forEach(function (k) { if (keys.indexOf(k) < 0) keys.push(k); });
		});
		return keys;
	}
	function trackKeys(t, M) {
		var keys = M.signature(t).t.slice();
		keysFor(t.title, t.titleAlt, M).forEach(function (k) { if (keys.indexOf(k) < 0) keys.push(k); });
		return keys;
	}
	// Does a store's artist have one of our songs? titles: its song or release
	// titles (strings, or finds and albums); tracks: the library's songs by
	// the artist. Each of our songs met (a title key in common) adds its best
	// key's strength once, a song uploaded twice ("Home", "Home (Live)") once
	// in all; 1 or more is sure, so one telling title is enough and a short
	// one ("Home") needs another song.
	// -> { sure, score, hits: [{ id, title, as }] } (as: the store's title)
	function verify(titles, tracks, M) {
		var byKey = {}, best = {}, order = [];
		(tracks || []).forEach(function (t, i) {
			if (!t || !str(t.title)) return;
			var song = fold(M.baseTitle(str(t.title))) || '#' + i;
			trackKeys(t, M).forEach(function (k) { (byKey['#' + k] = byKey['#' + k] || []).push({ song: song, t: t }); });
		});
		(titles || []).forEach(function (x) {
			var title = titleOf(x);
			if (!title) return;
			keysFor(title, '', M).forEach(function (k) {
				var s = strength(k, M);
				if (!s || !own(byKey, '#' + k)) return;
				byKey['#' + k].forEach(function (e) {
					if (!own(best, e.song)) { order.push(e); best[e.song] = { s: s, as: title }; }
					else if (s > best[e.song].s) best[e.song] = { s: s, as: title };
				});
			});
		});
		var score = 0, hits = [];
		order.forEach(function (e) { score += best[e.song].s; hits.push({ id: e.t.id, title: str(e.t.title), as: best[e.song].as }); });
		return { sure: score >= 1, score: score, hits: hits };
	}

	// ---- The demo (invented, deterministic) ----------------------------------------------------

	// Words for invented songs, none of them in demo.js's titles, so an
	// invented song never meets a library song.
	var DEMO_A = ['Gentle', 'Restless', 'Golden', 'Patient', 'Weightless', 'Wandering', 'Unwritten', 'Tidal', 'Lucky', 'Crimson', 'Feathered', 'Rusted', 'Folded', 'Sleepless', 'Humming'];
	var DEMO_B = ['Postcards', 'Rivers', 'Clockwork', 'Embers', 'Lanes', 'Stations', 'Kites', 'Bridges', 'Corridors', 'Islands', 'Rooms', 'Orbits', 'Thresholds', 'Tin Cans', 'Sparrows'];
	var DEMO_WORKS = ['Clockwork Sparrows', 'Tidal Academy', 'The Folded Islands'];
	var SEASONS = ['winter', 'spring', 'summer', 'fall'];

	function hash(s) {
		var h = 2166136261;
		for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
		return h >>> 0;
	}
	// A seeded random source (mulberry32): the same seed, the same numbers.
	function rng(seed) {
		var a = hash(str(seed));
		function r() {
			a = (a + 0x6D2B79F5) >>> 0;
			var t = a;
			t = Math.imul(t ^ (t >>> 15), t | 1);
			t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
			return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
		}
		r.int = function (n) { return Math.floor(r() * n); };
		return r;
	}
	function slugOf(s) { return fold(s.replace(/[^A-Za-z0-9]+/g, ' ')) || 'artist'; }
	function pad2(n) { return (n < 10 ? '0' : '') + n; }

	// The demo's artist as the stores would show them: releases built around
	// the library's own songs (most played first) and invented ones, top songs
	// from them, and anime songs for an anime artist. own: the artist's
	// library tracks; make: sources.js find.
	function demoBuild(key, own, make) {
		var r = rng('artists-demo:' + key), spell = {}, native = '';
		own.forEach(function (t) { if (t.artist) spell[t.artist] = (spell[t.artist] || 0) + 1; if (!native && t.artistNative) native = str(t.artistNative); });
		var name = commonest(spell) || key, country = storeFor(name, native, own);
		var h = hash(key), itBase = 9000000000 + (h % 900000) * 1000, dzBase = 900000000 + (h % 90000) * 1000;
		var years = own.map(function (t) { return +t.year || 0; }).filter(Boolean).sort(function (x, y) { return x - y; });
		var y0 = years[0] || 2012, y1 = Math.max(years[years.length - 1] || 2022, y0 + 4);
		var used = {}, serial = 0, nextTrack = 100, nextRelease = 1;
		var songs = own.filter(function (t) { return t.kind !== 'clip' && t.kind !== 'set' && str(t.title); })
			.sort(function (x, y) { return (y.plays || 0) - (x.plays || 0) || byId(x, y); });
		var jp = country === 'JP';
		function invent() {
			for (var g = 0; g < 200; g++) {
				var t = DEMO_A[r.int(DEMO_A.length)] + ' ' + DEMO_B[r.int(DEMO_B.length)];
				if (!used[t]) { used[t] = true; return t; }
			}
			return 'Untitled ' + (++serial);
		}
		function take() { return songs.length ? songs.shift() : null; }
		function song(t, rel, seq, title) {
			var f = make({
				title: title || (t ? t.title : invent()), artist: name, album: rel.title, albumId: 'it:' + rel.id,
				year: rel.year, durationSec: t ? (+t.durationSec || 210) : 150 + r.int(180), seq: seq,
				source: 'itunes', ids: { it: itBase + nextTrack++ }
			});
			f.mine = t ? t.id : null;
			f.demo = true;
			return f;
		}
		function release(type, title, tracks) {
			var id = itBase + nextRelease++;
			return { key: 'it:album:' + id, id: id, title: title, year: 0, date: '', type: type, typedBy: 'store', trackCount: 0, cover: '', link: '', source: 'itunes', have: null, haveFrom: '', ids: { itunes: id }, country: country, artist: name, genre: '', guest: false, demo: true, plan: tracks };
		}
		// The plan: three singles (two of them the library's most played songs),
		// one to three albums of ten songs (three of ours each), two EPs, and a
		// best-of once there are ten songs or more.
		var plan = [], nAlbums = Math.max(1, Math.min(3, Math.floor(songs.length / 6))), i, k;
		var many = songs.length >= 10;
		for (i = 0; i < 3; i++) {
			var a = i < 2 ? take() : null, side = invent();
			var tracks = [a ? { t: a } : { title: invent() }, { title: side }];
			if (jp) tracks.push({ title: (a ? a.title : tracks[0].title) + ' (Instrumental)', inst: true });
			plan.push(release('single', a ? a.title : tracks[0].title, tracks));
		}
		for (i = 0; i < nAlbums; i++) {
			var at = [];
			for (k = 0; k < 10; k++) { var x = k % 3 === 1 ? take() : null; at.push(x ? { t: x } : {}); }
			plan.push(release('album', invent(), at));
		}
		for (i = 0; i < 2; i++) {
			var et = [], n = 4 + r.int(3);
			for (k = 0; k < n; k++) { var y = k === 0 && i === 0 ? take() : null; et.push(y ? { t: y } : {}); }
			plan.push(release('ep', invent(), et));
		}
		// Years: the releases in order across the library's years.
		plan.forEach(function (rel, j) {
			rel.year = y0 + Math.round(j * (y1 - y0) / Math.max(1, plan.length - 1));
			rel.date = rel.year + '-' + pad2(1 + r.int(12)) + '-' + pad2(1 + r.int(28));
			rel.tracks = rel.plan.map(function (p, s) { return song(p.t || null, rel, s + 1, p.t ? '' : p.title || ''); });
			rel.trackCount = rel.tracks.length;
		});
		var originals = [];
		plan.forEach(function (rel) { rel.tracks.forEach(function (f) { if (!/\(Instrumental\)$/.test(f.title)) originals.push(f); }); });
		if (many) {
			var best = release('compilation', 'The Best of ' + name, []);
			best.year = y1;
			best.date = y1 + '-12-01';
			var picks = originals.filter(function (f) { return f.mine; }).slice(0, 6).concat(originals.filter(function (f) { return !f.mine; }).slice(0, 6));
			best.tracks = picks.map(function (f, s) { return song(f.mine ? { id: f.mine, title: f.title, durationSec: f.durationSec } : null, best, s + 1, f.mine ? '' : f.title); });
			best.trackCount = best.tracks.length;
			plan.push(best);
		}
		plan.forEach(function (rel) { delete rel.plan; });
		// Top songs: ours and invented ones, alternating, the most played first.
		var ours = originals.filter(function (f) { return f.mine; }), theirs = originals.filter(function (f) { return !f.mine; }), top = [];
		while (top.length < 12 && (ours.length || theirs.length)) {
			var pick = (top.length % 3 === 1 ? theirs : ours).shift() || ours.shift() || theirs.shift();
			top.push(pick);
		}
		// Anime songs: an anime artist's own (each with its work and role) and two invented.
		var anime = [];
		if (own.some(function (t) { return t.scene === 'anime'; })) {
			var atId = 9000000 + (h % 90000) * 10;
			own.filter(function (t) { return t.work && t.scene === 'anime'; }).sort(byId).slice(0, 3).forEach(function (t, j) {
				var yr = +t.year || y0;
				anime.push(atSong(atId + j, t.title, t.work, t.role === 'ED' ? 'ED' : 'OP', yr, t.id));
			});
			DEMO_WORKS.slice(0, 2).forEach(function (w, j) { anime.push(atSong(atId + 5 + j, invent(), w, j ? 'insert' : 'ED', y1 - j, null)); });
			anime.sort(function (x, y) { return y.year - x.year || (x.title < y.title ? -1 : 1); });
		}
		function atSong(id, title, work, role, yr, mine) {
			var f = make({
				key: 'at:song:' + id, title: title, artist: name, people: [name], work: work, workKey: 'at:anime:' + slugOf(work),
				role: role, seq: 1, season: { year: yr, season: SEASONS[r.int(4)] }, year: yr, source: 'animethemes', ids: { at: id }
			});
			f.mine = mine;
			f.demo = true;
			return f;
		}
		var disco = { top: top, albums: [], eps: [], singles: [], compilations: [], anime: anime, errors: [], demo: true };
		plan.sort(newestFirst).forEach(function (rel) { disco[GROUPS[rel.type]].push(rel); });
		var found = {
			key: key, name: name, native: native,
			itunes: { id: itBase, name: name, country: country, sure: true, why: 'title', link: '', genre: '' },
			deezer: { id: dzBase, name: name, sure: true, why: 'title', picture: '', fans: 500 + r.int(20000) },
			animethemes: anime.length ? { slug: slugOf(name), name: name, sure: true, why: 'title' } : null,
			sure: true,
			candidates: [
				{ source: 'itunes', id: itBase + 999, name: name, country: jp ? 'US' : 'JP', genre: 'Classical', link: '', alike: true },
				{ source: 'deezer', id: dzBase + 999, name: name + ' Tribute', picture: '', fans: 40, alike: false }
			],
			at: 0, errors: [], demo: true
		};
		return { found: found, discography: disco };
	}

	// ---- The artists object ----------------------------------------------------------------

	function create(deps) {
		deps = deps || {};
		var M = deps.M || need('match', './match.js'), L = deps.L || need('library', './library.js');
		var now = deps.now || function () { return Date.now(); };
		var map = deps.map || null;
		var memo = {};       // 'artist:<key>' -> the record, this session
		var haveOf = {};     // album key -> songs of it the library has, once its songs were read
		var demos = {};      // artist key -> the demo's { found, discography }

		function tracks() { return values(deps.tracks ? deps.tracks() : []); }
		function index() { return deps.index ? deps.index() : null; }
		function norm(name) { return L && L.normArtist ? L.normArtist(name) : fold(name); }
		function mkey(key) { return 'artist:' + key; }
		function keyOf(who) {
			if (typeof who === 'string') return who;
			if (!who || typeof who !== 'object') return '';
			return str(who.key) || norm(who.name);
		}

		// A store's artist named as ours: verify's answer, except that with one song of ours
		// by them its title is all the evidence there can be, so a short one ("Magia") will do.
		function vouched(titles, ours) { var v = verify(titles, ours, M); return v.sure || (v.score >= 0.5 && (ours || []).length <= 1); }
		// who: a library artist key, or { key, name, native }.
		// -> { key, name, native, tracks: the library's songs by them, or with them in the credit } | null
		function subject(who) {
			var key = keyOf(who), name = '', native = '';
			if (who && typeof who === 'object') { name = str(who.name).trim(); native = str(who.native).trim(); }
			if (!key) return null;
			var mine = [], spell = {}, nat = '';
			tracks().forEach(function (t) {
				if (!t) return;
				var by = t.artistKey === key;
				if (!by && t.artist && L && L.people && /&| feat| ft\.|\(/i.test(t.artist)) by = L.people(t.artist).some(function (p) { return p.key === key; });
				if (!by) return;
				mine.push(t);
				if (t.artistKey === key) {
					if (t.artist) spell[t.artist] = (spell[t.artist] || 0) + 1;
					if (!nat && t.artistNative) nat = str(t.artistNative);
				}
			});
			name = name || commonest(spell);
			native = native || nat;
			if (!name && !native) return null;
			return { key: key, name: name || native, native: native, tracks: mine };
		}
		function nameList(a) {
			var out = [], seen = {};
			[a.name, a.native].forEach(function (n) { var k = fold(n); if (k && !seen[k]) { seen[k] = true; out.push(n); } });
			return out;
		}

		// ---- the record: artist:<key> in map, or this session

		function blank(key) { return { key: key, name: '', itunes: null, deezer: null, animethemes: null, sure: false, at: 0, no: [], yes: {}, checked: {}, cands: [] }; }
		function tidy(v, key) {
			var r = blank(key);
			if (!v || typeof v !== 'object') return r;
			SOURCES.forEach(function (s) { if (v[s] && typeof v[s] === 'object') r[s] = v[s]; });
			r.name = str(v.name);
			r.sure = !!v.sure;
			r.at = +v.at || 0;
			if (Array.isArray(v.no)) r.no = v.no.map(str);
			if (v.yes && typeof v.yes === 'object') r.yes = v.yes;
			if (v.checked && typeof v.checked === 'object') r.checked = v.checked;
			if (Array.isArray(v.cands)) r.cands = v.cands.filter(function (c) { return c && c.source && c.id != null; });
			return r;
		}
		function load(key) {
			var k = mkey(key);
			if (own(memo, k)) return Promise.resolve(memo[k]);
			if (!map) return Promise.resolve(memo[k] = blank(key));
			return Promise.resolve().then(function () { return map.get(k); }).then(function (v) {
				return own(memo, k) ? memo[k] : (memo[k] = tidy(v, key));
			}, function () {
				return own(memo, k) ? memo[k] : (memo[k] = blank(key));
			});
		}
		function save(rec) {
			var k = mkey(rec.key);
			memo[k] = rec;
			if (!map) return Promise.resolve();
			return Promise.resolve().then(function () { return map.set(k, copy(rec)); }).then(function () {}, function () {});
		}

		function client(s) { return s === 'itunes' ? deps.it : s === 'deezer' ? deps.dz : deps.at; }
		function idOf(s, pick) { return pick ? str(s === 'animethemes' ? pick.slug : pick.id) : ''; }
		function isNo(rec, s, id) { return rec.no.indexOf(s + ':' + str(id)) >= 0; }
		function itPick(c, country, sure, why) { return { id: c.id, name: str(c.name), country: str(country), sure: !!sure, why: why || '', link: str(c.link), genre: str(c.genre) }; }
		function dzPick(c, sure, why) { return { id: c.id, name: str(c.name), sure: !!sure, why: why || '', picture: str(c.picture), fans: +c.fans || 0 }; }
		function atPick(c, sure, why) { return { slug: str(c.slug), name: str(c.name), sure: !!sure, why: why || '' }; }
		function found(rec) { return SOURCES.some(function (s) { return !!rec[s]; }); }
		// Is this source to be asked now? Never while the listener's choice
		// stands; else when it was never asked, when its artist was found 90
		// days ago or more, or when it was not there 30 days ago or more.
		function due(rec, s, t) {
			if (!client(s) || rec.yes[s]) return false;
			var at = rec.checked[s];
			if (at == null) return true;
			return t - at >= (rec[s] ? RECHECK_MS : MISS_MS);
		}
		// The listener's answers over what was found: a confirmed artist is the
		// one, and sure; a rejected one is never chosen (its source is asked again).
		function corrections(rec, a) {
			SOURCES.forEach(function (s) {
				var y = rec.yes[s];
				if (y && y.id != null && y.id !== '') {
					rec[s] = s === 'itunes' ? itPick(y, y.country || storeFor(a.name, a.native, a.tracks), true, 'confirmed')
						: s === 'deezer' ? dzPick(y, true, 'confirmed') : atPick({ slug: y.id, name: y.name }, true, 'confirmed');
					return;
				}
				if (rec[s] && isNo(rec, s, idOf(s, rec[s]))) { rec[s] = null; delete rec.checked[s]; }
			});
			rec.cands = rec.cands.filter(function (c) { return !isNo(rec, c.source, c.id); });
			rec.sure = SOURCES.some(function (s) { return !!(rec[s] && rec[s].sure); });
		}
		function addCand(list, c) {
			if (!list.some(function (x) { return x.source === c.source && str(x.id) === str(c.id); })) list.push(c);
		}
		function alikeFirst(list) { return list.filter(function (c) { return c.alike; }).concat(list.filter(function (c) { return !c.alike; })); }
		function keepCands(rec, s, list) {
			rec.cands = rec.cands.filter(function (c) { return c.source !== s; }).concat(alikeFirst(list || []).slice(0, CANDS_MAX));
		}
		function view(rec, a, errors) {
			if (!found(rec)) return null;
			var chosen = {}, cands = [];
			SOURCES.forEach(function (s) { if (rec[s]) chosen[s + ':' + idOf(s, rec[s])] = true; });
			// iTunes's, then Deezer's, then AnimeThemes's, each as its source gave them
			SOURCES.forEach(function (s) { rec.cands.forEach(function (c) { if (c.source === s && !chosen[s + ':' + str(c.id)]) cands.push(copy(c)); }); });
			return {
				key: rec.key, name: a.name, native: a.native,
				itunes: rec.itunes ? copy(rec.itunes) : null,
				deezer: rec.deezer ? copy(rec.deezer) : null,
				animethemes: rec.animethemes ? copy(rec.animethemes) : null,
				sure: !!rec.sure,
				candidates: cands,
				at: rec.at || 0,
				errors: errors || []
			};
		}
		function errorRow(s, e) { return { source: s, code: str(e && e.code) || 'network', message: str(e && e.message) }; }

		// ---- the checks, one per source: -> Promise<{ pick, cands }>

		// iTunes: the artist's store, then the other; in each, the name, then
		// the native name. Of the artists named alike, the songs of two at most
		// are read (each one request, kept 7 days); then the releases of the
		// probable one. ITUNES_MAX requests in all; usually two.
		function itunesCheck(a, rec, signal) {
			var it = deps.it, first = storeFor(a.name, a.native, a.tracks), names = nameList(a);
			var asked = 0, cands = [], read = {}, releasesRead = {}, probable = null;
			function room() { return asked < ITUNES_MAX; }
			function weigh(list, country) {
				list = (list || []).filter(function (c) { return c && c.id != null && !isNo(rec, 'itunes', c.id); });
				var alike = list.filter(function (c) { return namedAlike(c.name, names, M); });
				list.forEach(function (c) {
					var same = alike.indexOf(c) >= 0;
					if (same || relatedName(c.name, names, M)) addCand(cands, { source: 'itunes', id: c.id, name: str(c.name), country: country, genre: str(c.genre), link: str(c.link), alike: same });
				});
				if (!probable && alike.length) probable = itPick(alike[0], country, false, '');
				if (!a.tracks.length) return null;
				var todo = alike.filter(function (c) { return !read[country + ':' + c.id]; }).slice(0, CHECK_MAX);
				return firstOf(todo, function (c) {
					if (!room()) return null;
					asked++;
					read[country + ':' + c.id] = true;
					return it.artistSongs(c.id, { country: country, limit: SONGS, signal: signal }).then(function (songs) {
						return vouched(songs, a.tracks) ? itPick(c, country, true, 'title') : null;
					});
				});
			}
			function look(country) {
				return firstOf(names, function (name) {
					if (!room()) return null;
					asked++;
					return it.searchArtist(name, { country: country, signal: signal }).then(function (list) { return weigh(list, country); });
				});
			}
			// The releases of the probable artist: a single named as one of our songs.
			function releases() {
				if (!probable || !a.tracks.length || !room() || releasesRead[probable.country + ':' + probable.id]) return null;
				asked++;
				releasesRead[probable.country + ':' + probable.id] = true;
				return it.albums(probable.id, { country: probable.country, signal: signal }).then(function (als) {
					if (!vouched(als, a.tracks)) return null;
					probable.sure = true;
					probable.why = 'album';
					return probable;
				});
			}
			return look(first).then(function (hit) {
				// with no songs of theirs to check, the first artist named alike will do
				if (hit || (!a.tracks.length && probable)) return hit;
				return Promise.resolve(releases()).then(function (hit2) {
					return hit2 || look(first === 'JP' ? 'US' : 'JP').then(function (hit3) { return hit3 || releases(); });
				});
			}).then(function (hit) { return { pick: hit || probable, cands: cands }; });
		}

		// Deezer: the name, then the native name; of the artists named alike
		// (three at most), the first whose top songs or releases hold one of
		// ours; else the one of that name with the most fans, as probable.
		function deezerCheck(a, rec, signal) {
			var dz = deps.dz, names = nameList(a), cands = [], read = {}, probable = null;
			return firstOf(names, function (name) {
				return guard(dz.searchArtists(name, { signal: signal }), signal).then(function (list) {
					list = (list || []).filter(function (c) { return c && c.id != null && !isNo(rec, 'deezer', c.id); });
					var alike = list.filter(function (c) { return namedAlike(c.name, names, M); });
					list.forEach(function (c) {
						var same = alike.indexOf(c) >= 0;
						if (same || relatedName(c.name, names, M)) addCand(cands, { source: 'deezer', id: c.id, name: str(c.name), picture: str(c.picture), fans: +c.fans || 0, alike: same });
					});
					var most = alike.slice().sort(function (x, y) { return (+y.fans || 0) - (+x.fans || 0); })[0];
					if (!probable && most) probable = dzPick(most, false, '');
					if (!a.tracks.length) return null;
					return firstOf(alike.filter(function (c) { return !read[c.id]; }).slice(0, CHECK_MAX + 1), function (c) {
						read[c.id] = true;
						return guard(dz.top(c.id, DZ_TOP, { signal: signal }), signal).then(function (songs) {
							if (vouched(songs, a.tracks)) return dzPick(c, true, 'title');
							return guard(dz.albums(c.id, { signal: signal }), signal).then(function (als) {
								return vouched(als, a.tracks) ? dzPick(c, true, 'album') : null;
							});
						});
					});
				});
			}).then(function (hit) { return { pick: hit || probable, cands: cands }; });
		}

		// AnimeThemes: the name, then the native name; an artist named alike is
		// taken. Their songs (kept 30 days, and wanted for the discography
		// anyway) say whether it is sure.
		function animeCheck(a, rec, signal) {
			var at = deps.at, names = nameList(a), cands = [];
			return firstOf(names, function (name) {
				return at.search(name, ['artists'], { signal: signal }).then(function (r) {
					var list = ((r && r.artists) || []).filter(function (x) { return x && x.slug && !isNo(rec, 'animethemes', x.slug); });
					var same = list.filter(function (x) { return namedAlike(x.name, names, M); });
					list.forEach(function (x) {
						var is = same.indexOf(x) >= 0;
						if (is || relatedName(x.name, names, M)) addCand(cands, { source: 'animethemes', id: str(x.slug), name: str(x.name), alike: is });
					});
					if (!same.length) return null;
					var pick = atPick(same[0], false, '');
					if (!a.tracks.length) return pick;
					return at.artist(pick.slug, { signal: signal }).then(function (art) {
						if (art && vouched(art.songs || [], a.tracks)) { pick.sure = true; pick.why = 'title'; }
						return pick;
					});
				});
			}).then(function (hit) { return { pick: hit, cands: cands }; });
		}
		var CHECKS = { itunes: itunesCheck, deezer: deezerCheck, animethemes: animeCheck };

		// One store's artist is sure and the other's only named alike: when
		// their releases share a title (as verify counts it), they are one
		// artist, and both are sure (why: 'twin').
		function twins(rec, signal) {
			var it = rec.itunes, dz = rec.deezer;
			if (!it || !dz || it.sure === dz.sure || !deps.it || !deps.dz) return Promise.resolve();
			return Promise.all([
				deps.it.albums(it.id, { country: it.country, signal: signal }),
				guard(deps.dz.albums(dz.id, { signal: signal }), signal)
			]).then(function (r) {
				var mine = (r[0] || []).map(function (x, i) { return { id: 'it' + i, title: x.title }; });
				if (!verify(r[1] || [], mine, M).sure) return;
				var weak = it.sure ? dz : it;
				weak.sure = true;
				weak.why = 'twin';
			}, function (e) { if (aborted(e, signal)) throw stopped(); });
		}

		// The artist on iTunes, Deezer and AnimeThemes. Answers from the record
		// when nothing is due; else asks the sources that are (at once, each on
		// its own line) and keeps what they said. A source that fails is left
		// as it was and asked again next time; when nothing is found and one
		// failed, its error is the answer. o.sources (some of SOURCES) asks only
		// those now, the others as they stand: a lane that needs only Deezer's
		// artist need not wait for iTunes. -> Promise<null | found>
		function find(who, o) {
			o = o || {};
			var signal = o.signal, only = Array.isArray(o.sources) ? o.sources : null;
			if (signal && signal.aborted) return Promise.reject(stopped());
			var a = subject(who);
			if (!a) return Promise.resolve(null);
			return load(a.key).then(function (stored) {
				if (signal && signal.aborted) throw stopped();
				var rec = copy(stored), t = now(), errors = [], fails = [], jobs = [];
				corrections(rec, a);
				SOURCES.forEach(function (s) {
					if ((only && only.indexOf(s) < 0) || !due(rec, s, t)) return;
					jobs.push(CHECKS[s](a, rec, signal).then(function (r) {
						rec[s] = r.pick;
						rec.checked[s] = t;
						keepCands(rec, s, r.cands);
					}, function (e) {
						if (aborted(e, signal)) throw stopped();
						fails.push(e);
						errors.push(errorRow(s, e));
					}));
				});
				if (!jobs.length) return view(rec, a, []);
				return Promise.all(jobs).then(function () {
					if (signal && signal.aborted) throw stopped();
					// the twin check asks both stores; not when only some sources are to be asked
					if (only && (only.indexOf('itunes') < 0 || only.indexOf('deezer') < 0)) return null;
					return twins(rec, signal);
				}).then(function () {
					// answers given while this find ran still win
					var latest = memo[mkey(a.key)] || stored;
					rec.no = latest.no.slice();
					rec.yes = copy(latest.yes);
					rec.name = a.name;
					rec.at = t;
					corrections(rec, a);
					return save(rec).then(function () {
						if (!found(rec) && fails.length) throw fails[0];
						return view(rec, a, errors);
					});
				});
			});
		}

		function answer(who, source, id, fn) {
			var key = keyOf(who);
			if (!key || SOURCES.indexOf(source) < 0 || id == null || id === '') return Promise.reject(failure('bad', 'Say which source and which artist.'));
			var a = subject(who) || { key: key, name: str(who && who.name) || key, native: '', tracks: [] };
			return load(key).then(function (stored) {
				var rec = copy(stored);
				fn(rec, a);
				corrections(rec, a);
				return save(rec).then(function () { return view(rec, a, []); });
			});
		}
		// "Not this artist": that source's artist is never chosen again for
		// this one; the source is asked again on the next find.
		// -> Promise<found | null> (as it now stands, nothing asked)
		function reject(who, source, id) {
			return answer(who, source, id, function (rec) {
				var tag = source + ':' + str(id);
				if (rec.no.indexOf(tag) < 0) rec.no.push(tag);
				if (rec.yes[source] && str(rec.yes[source].id) === str(id)) delete rec.yes[source];
			});
		}
		// "Yes, this one": that source's artist is the one, and sure, from now on.
		// id: the id (iTunes, Deezer) or slug (AnimeThemes), or a candidate.
		// -> Promise<found | null>
		function confirm(who, source, id) {
			var given = id && typeof id === 'object' ? id : null;
			var sid = given ? (given.id != null ? given.id : given.slug) : id;
			return answer(who, source, sid, function (rec, a) {
				var c = rec.cands.filter(function (x) { return x.source === source && str(x.id) === str(sid); })[0] || given;
				if (!c && rec[source] && idOf(source, rec[source]) === str(sid)) c = rec[source];
				c = c || {};
				var y = { id: sid, name: str(c.name) || a.name };
				if (source === 'itunes') { y.country = str(c.country) || storeFor(a.name, a.native, a.tracks); y.link = str(c.link); y.genre = str(c.genre); }
				if (source === 'deezer') { y.picture = str(c.picture); y.fans = +c.fans || 0; }
				rec.yes[source] = y;
				rec.no = rec.no.filter(function (x) { return x !== source + ':' + str(sid); });
				rec.checked[source] = now();
			});
		}

		// ---- the discography

		function mineOf(f, ix) {
			if (!ix || !M || !M.inLibrary) return null;
			var r = M.inLibrary(ix, f);
			// the same song; another version (an instrumental, a live take) is not ours, a cut is
			return r && (r.sameRecording || r.why.indexOf('other-version') < 0) ? r.id : null;
		}
		function withMine(f, ix) { var c = shallow(f); c.mine = mineOf(f, ix); return c; }
		// Top songs: each list in its order (iTunes's, then Deezer's), each
		// song once (its base title and version), no instrumental or karaoke.
		function topSongs(lists, ix) {
			var out = [], seen = {};
			lists.forEach(function (list) {
				(list || []).forEach(function (f) {
					if (!f || !str(f.title) || out.length >= TOP) return;
					var s = M.signature(f), ver = str(s.ver);
					if (/(^|\+)(instrumental|karaoke)(\+|$)/.test(ver)) return;
					var k = (s.tf[0] || fold(f.title)) + '|' + ver;
					if (seen[k]) return;
					seen[k] = true;
					out.push(withMine(f, ix));
				});
			});
			return out;
		}
		function isOurs(credit, names) {
			credit = str(credit);
			if (!credit || namedAlike(credit, names, M)) return true;
			return !!(L && L.people) && L.people(credit).some(function (p) { return namedAlike(p.name, names, M); });
		}
		function fromItunes(x, pick, names) {
			var t = typing({ title: x.title, trackCount: x.trackCount, type: x.type, source: 'itunes' });
			return {
				key: 'it:album:' + x.id, id: x.id, title: str(x.title), year: yearOf(x.date), date: str(x.date), type: t.type, typedBy: t.by,
				trackCount: +x.trackCount || 0, cover: str(x.cover), link: str(x.link), source: 'itunes', have: null, haveFrom: '',
				ids: { itunes: x.id }, country: str(pick.country), artist: str(x.artist), genre: str(x.genre), guest: !isOurs(x.artist, names)
			};
		}
		function fromDeezer(x) {
			var t = typing({ title: x.title, trackCount: x.trackCount, type: x.type, source: 'deezer' });
			return {
				key: 'dz:album:' + x.id, id: x.id, title: str(x.title), year: yearOf(x.date), date: str(x.date), type: t.type, typedBy: t.by,
				trackCount: +x.trackCount || 0, cover: str(x.cover), link: /^\d+$/.test(str(x.id)) ? 'https://www.deezer.com/album/' + x.id : '', source: 'deezer', have: null, haveFrom: '',
				ids: { deezer: x.id }, country: '', artist: '', genre: '', guest: false
			};
		}
		// have: what albumTracks counted this session, else the songs whose own
		// album field names this release (a lower bound), else null.
		function fillHave(al, a) {
			if (own(haveOf, al.key)) { al.have = haveOf[al.key]; al.haveFrom = 'tracks'; return; }
			var keys = titleKeysOf(al, M), ids = {};
			a.tracks.forEach(function (t) { if (str(t.album) && titleKeysOf({ title: t.album }, M).some(function (k) { return keys.indexOf(k) >= 0; })) ids[t.id] = true; });
			var n = Object.keys(ids).length;
			if (n) { al.have = n; al.haveFrom = 'library'; }
		}
		function grouped(albums, out) {
			albums.forEach(function (al) { out[GROUPS[al.type] || 'albums'].push(al); });
			return out;
		}
		function empty() { return { top: [], albums: [], eps: [], singles: [], compilations: [], anime: [], errors: [] }; }

		// Everything they released, their top songs and their anime songs.
		// Sources that are sure are used (all of them when none is). A part
		// that fails leaves the rest, with the failure in errors; when every
		// part fails, the first error is the answer.
		function discography(f, o) {
			o = o || {};
			var signal = o.signal;
			if (signal && signal.aborted) return Promise.reject(stopped());
			if (!f) return Promise.resolve(empty());
			// the demo's artist: from memory, and never from a source (its ids are invented)
			if (f.demo) {
				if (!demos[f.key]) return Promise.resolve(empty());
				var d = copy(demos[f.key].discography);
				['albums', 'eps', 'singles', 'compilations'].forEach(function (g) { d[g].forEach(function (al) { if (own(haveOf, al.key)) { al.have = haveOf[al.key]; al.haveFrom = 'tracks'; } }); });
				return Promise.resolve(d);
			}
			var it = f.itunes, dz = f.deezer, at = f.animethemes;
			var useIt = !!(deps.it && it && (it.sure || !f.sure)), useDz = !!(deps.dz && dz && (dz.sure || !f.sure)), useAt = !!(deps.at && at);
			var errors = [], fails = [], tried = 0;
			function part(source, p) {
				tried++;
				return Promise.resolve(p).then(function (v) { return v || []; }, function (e) {
					if (aborted(e, signal)) throw stopped();
					fails.push(e);
					errors.push(errorRow(source, e));
					return [];
				});
			}
			var none = Promise.resolve([]);
			return Promise.all([
				useIt ? part('itunes', deps.it.albums(it.id, { country: it.country, signal: signal })) : none,
				useIt ? part('itunes', deps.it.artistSongs(it.id, { country: it.country, limit: SONGS, signal: signal })) : none,
				useDz ? part('deezer', guard(deps.dz.albums(dz.id, { signal: signal }), signal)) : none,
				useDz ? part('deezer', guard(deps.dz.top(dz.id, DZ_TOP, { signal: signal }), signal)) : none,
				useAt ? part('animethemes', deps.at.artist(at.slug, { signal: signal }).then(function (r) { return r ? r.songs : []; })) : none
			]).then(function (r) {
				if (signal && signal.aborted) throw stopped();
				if (tried && fails.length === tried) throw fails[0];
				var a = subject({ key: f.key, name: f.name, native: f.native }) || { key: f.key, name: str(f.name), native: str(f.native), tracks: [] };
				// whose releases are theirs: our names, the stores' names for them, and
				// the credit most of iTunes's releases carry (a kanji name, say); a
				// release credited to someone else is a guest appearance
				var credits = {};
				r[0].forEach(function (x) { if (x && x.artist) credits[x.artist] = (credits[x.artist] || 0) + 1; });
				var names = nameList(a).concat([it && it.name, dz && dz.name, commonest(credits)].filter(Boolean)), ix = index();
				var albums = mergeAlbums([r[0].map(function (x) { return fromItunes(x, it, names); }), r[2].map(fromDeezer)], M);
				albums.forEach(function (al) { fillHave(al, a); });
				var out = grouped(albums, empty());
				out.top = topSongs([r[1], r[3]], ix);
				out.anime = r[4].map(function (x) { return withMine(x, ix); });
				out.errors = errors;
				return out;
			});
		}

		// An album's songs, each with seq (its number on its disc), disc and
		// mine, and how many of them the library has (each library song once).
		// The album's own source is read (o.from picks the other), and the other
		// store's copy when that fails. An album that carries its songs (the
		// demo's) is answered from them.
		function albumTracks(album, o) {
			o = o || {};
			var signal = o.signal;
			if (signal && signal.aborted) return Promise.reject(stopped());
			if (!album) return Promise.resolve({ tracks: [], have: 0, total: 0 });
			var ids = album.ids || {};
			function idFor(s) { return ids[s] != null ? ids[s] : album.source === s ? album.id : null; }
			function read(s) {
				var id = idFor(s);
				if (s === 'itunes' && deps.it && id != null) return deps.it.albumTracks(id, { country: album.country || undefined, signal: signal });
				if (s === 'deezer' && deps.dz && id != null) return guard(deps.dz.albumTracks({ id: id, title: album.title, cover: album.cover }, { signal: signal }), signal);
				return null;
			}
			var p;
			if (Array.isArray(album.tracks)) p = Promise.resolve(album.tracks);
			else {
				var first = o.from === 'deezer' || o.from === 'itunes' ? o.from : album.source === 'deezer' ? 'deezer' : 'itunes';
				var second = first === 'itunes' ? 'deezer' : 'itunes';
				var asked = read(first);
				p = asked || read(second);
				if (!p) return Promise.reject(failure('not-found', 'There is no source for the songs of ' + (str(album.title) || 'this release') + '.'));
				if (asked && idFor(second) != null && client(second)) {
					p = p.then(null, function (e) {
						if (aborted(e, signal)) throw stopped();
						return read(second) || Promise.reject(e);
					});
				}
			}
			return p.then(function (list) {
				if (signal && signal.aborted) throw stopped();
				// songs the album carried keep their own mine; read ones are matched now
				var carried = Array.isArray(album.tracks), ix = carried ? null : index(), have = {}, disc = 1, last = 0;
				var out = (list || []).map(function (f, i) {
					var c = shallow(f), seq = +c.seq || 0;
					if (!seq) seq = i + 1;
					else if (i && seq <= last) disc++;
					last = seq;
					c.seq = seq;
					c.disc = disc;
					if (!carried || c.mine === undefined) c.mine = mineOf(c, ix);
					if (c.mine) have[c.mine] = true;
					return c;
				});
				var n = Object.keys(have).length;
				if (album.key) haveOf[album.key] = n;
				return { tracks: out, have: n, total: out.length };
			});
		}

		// The demo's artist (?demo=1): invented releases and top songs around
		// the demo library's own songs, the same every time; no network. Its
		// discography and album songs are answered from memory afterwards too.
		function demo(artistKey, lib) {
			var key = str(artistKey);
			if (!key || !lib || !lib.tracks) return null;
			var all = L && L.list ? L.list(lib) : values(lib.tracks);
			var mine = all.filter(function (t) { return t && t.artistKey === key; }).sort(byId);
			if (!mine.length) return null;
			var S = need('sources', './sources.js');
			var out = demoBuild(key, mine, S && S.find ? S.find : function (x) { return x; });
			demos[key] = copy(out);
			return out;
		}

		return { find: find, discography: discography, albumTracks: albumTracks, reject: reject, confirm: confirm, demo: demo };
	}

	return {
		create: create,
		storeFor: storeFor, albumType: albumType, mergeAlbums: mergeAlbums, verify: verify, namedAlike: namedAlike,
		RECHECK_MS: RECHECK_MS, MISS_MS: MISS_MS, SONGS: SONGS, DZ_TOP: DZ_TOP, TOP: TOP, ITUNES_MAX: ITUNES_MAX
	};
});
