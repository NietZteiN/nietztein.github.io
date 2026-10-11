/*
 * True Shuffle: works. Which anime a song in the library is from, checked
 * against the listener's own songs, and that anime's whole franchise of
 * songs: every opening, ending and insert song across its seasons and films,
 * with the ones the library already has marked. The Explore page's "Same
 * anime or series" lane reads it.
 *
 *     var works = TrueShuffle.works.create({ at, it, M, L, index, tracks, map, now });
 *     works.workOf(track, { signal })       -> Promise<null | found>
 *     works.franchise(found, { signal })    -> Promise<null | { title, series, entries, songs, have, total, current }>
 *     works.reject(track, slug)             "Not this one": remembered; workOf offers the next
 *     works.confirm(track, slug)            the listener says it is this one
 *     works.demo(track, lib)                -> { found, franchise } | null (invented, asks nothing)
 *     works.soundtracks(track, { signal })  -> Promise<null | { work, albums, have, total, sure }>
 *
 * A song with a work label is looked up by its label. AnimeThemes is asked
 * for anime and series of that name (its synonyms count: "Oregairu" finds
 * Yahari Ore no Seishun Love Comedy wa Machigatteiru), the first three anime
 * are read, and one is verified when one of its themes is a library song of
 * that work (match.js sameSong, SAME or more). When none is, a series the
 * label names (Monogatari) lends its entries, then the song's own title is
 * tried. A song without a label is looked up by its title and titleAlt: a
 * song of AnimeThemes counts when match.js says it is the same song and the
 * artist is part of the evidence, so an equal title by another artist never
 * does. Answers are kept in the page's map (checked again after 90 days, a
 * "found nothing" after 30), and the listener's corrections win.
 *
 * Every request goes through sources.js's clients (their lines, retries
 * and cache), and every call takes a signal that stops it. The demo invents
 * a franchise from the demo library and asks nothing.
 *
 * The source is plain ASCII: other characters are written as escapes.
 * UMD: window.TrueShuffle.works in the browser (after match.js, library.js
 * and sources.js), module.exports in Node.
 */
(function (root, factory) {
	var node = typeof module === 'object' && module.exports;
	var api = factory(root,
		function () { return node ? require('./match.js') : (root.TrueShuffle || {}).match; },
		function () { return node ? require('./library.js') : (root.TrueShuffle || {}).library; },
		function () { return node ? require('./sources.js') : (root.TrueShuffle || {}).sources; });
	if (node) module.exports = api;
	else { root.TrueShuffle = root.TrueShuffle || {}; root.TrueShuffle.works = api; }
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this), function (root, getMatch, getLibrary, getSources) {
	'use strict';

	var DAY = 86400000;
	var KEEP_MS = 90 * DAY;          // an anime found is checked again after this
	var KEEP_NONE_MS = 30 * DAY;     // and "found nothing" is asked again after this
	var TOP = 3;                     // the anime read for a work label
	var MAX_CANDIDATES = 8;          // kept, and offered for "Not this one"
	var SERIES_FIT = 0.8;            // a series the label names this well lends its entries
	var ALBUMS = 3;                  // soundtrack albums whose songs are read
	// Scenes that say what a work is; the others (utaite, vtuber, meme ...)
	// say who sings a song, as in quiz.js.
	var WORK_SCENES = ['anime', 'vn', 'game', 'film', 'tv', 'stage', 'touhou'];
	// The kinds of work for which a probable answer (nothing verified) is
	// still given: an anime, or a work nothing says the kind of. A game or a
	// visual novel often has an anime of the same name with other songs.
	var PROBABLE_KINDS = { anime: true, '': true };
	var SEASONS = ['winter', 'spring', 'summer', 'fall'];
	var ROLE_ORDER = { OP: 0, ED: 1, insert: 2 };
	var OWN = Object.prototype.hasOwnProperty;
	// Japanese script (sources.js asks Japan's store for such a name).
	var JAPANESE = /[\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uFF66-\uFF9F]/;
	// iTunes genres of a soundtrack, in English or Japanese: saundotorakku
	// (soundtrack), anime, geemu (game).
	var OST_GENRE = /soundtrack|anime|video ?games?|\bgames?\b|\u30B5\u30A6\u30F3\u30C9\u30C8\u30E9\u30C3\u30AF|\u30A2\u30CB\u30E1|\u30B2\u30FC\u30E0/i;

	// ---- Small helpers --------------------------------------------------------------------------

	function has(o, k) { return !!o && OWN.call(o, k); }
	function str(v) { return v == null ? '' : String(v); }
	function num(v) { var n = +v; return isFinite(n) ? n : 0; }
	function copy(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }
	function listOf(x) {
		if (Array.isArray(x)) return x;
		if (x && typeof x === 'object') return Object.keys(x).map(function (k) { return x[k]; });
		return [];
	}
	function uniq(list) {
		var out = [], seen = {};
		listOf(list).forEach(function (x) { if (x && !has(seen, '#' + x)) { seen['#' + x] = true; out.push(x); } });
		return out;
	}
	function cmp(a, b) { a = str(a); b = str(b); return a < b ? -1 : a > b ? 1 : 0; }
	// A shallow copy, so the finds sources.js shares are never changed.
	function shallow(o) { var x = {}; for (var k in o) if (has(o, k)) x[k] = o[k]; return x; }
	// FNV-1a: a string as a 32-bit number (the demo's choices and ids).
	function hash(s) {
		var x = 0x811c9dc5;
		s = str(s);
		for (var i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 0x01000193) >>> 0; }
		return x;
	}
	function seasonIndex(s) { var i = SEASONS.indexOf(str(s).toLowerCase()); return i < 0 ? 0 : i; }
	// When an anime aired, as one number; an unknown year sorts last.
	function aired(a) { var y = num(a && a.year); return y ? y * 4 + seasonIndex(a.season) : 1e9; }

	// The same 'aborted' SourceError sources.js gives, so the page reads every stop alike.
	function stopped() {
		var Src = getSources();
		if (Src && Src.SourceError) return Src.SourceError('aborted', 'Stopped.');
		var e = new Error('Stopped.');
		e.name = 'SourceError';
		e.code = 'aborted';
		return e;
	}
	function check(signal) { if (signal && signal.aborted) throw stopped(); }
	function aborted(e) { return !!e && e.code === 'aborted'; }

	// ---- A work in the library ------------------------------------------------------------------

	// The key a work is known by: spellings that romanise alike are one work
	// (match.js loose), as quiz.js groups them.
	function workKeyOf(M, name) { var k = M.loose(name); return k || M.fold(name); }
	// Someone else's recording of a song, or another arrangement of it.
	function coverish(t) { return !!str(t.origArtist).trim() || /cover|piano|orchestral|acoustic|remix|karaoke/.test(str(t.version)); }

	// The library's tracks labelled with this work, its spellings read
	// loosely. tracks: a list or { id: track }. M: match.js (optional).
	function workTracks(tracks, work, M) {
		M = M || getMatch();
		var key = workKeyOf(M, str(work).trim()), out = [], seen = {};
		if (!key) return out;
		listOf(tracks).forEach(function (t) {
			if (!t || !t.id || has(seen, t.id) || !str(t.work).trim()) return;
			if (workKeyOf(M, t.work) !== key) return;
			seen[t.id] = true;
			out.push(t);
		});
		return out;
	}

	// What kind of work this is: the commonest scene that names a kind of
	// work (WORK_SCENES) among its own recordings, then among all of them;
	// '' when none says (only covers by utaite or VTubers, say). Ties go to
	// the first in alphabetical order.
	function workKind(tracks) {
		function top(list) {
			var c = {}, best = '', n = 0;
			list.forEach(function (t) { var s = str(t.scene); if (WORK_SCENES.indexOf(s) >= 0) c[s] = (c[s] || 0) + 1; });
			Object.keys(c).sort().forEach(function (s) { if (c[s] > n) { n = c[s]; best = s; } });
			return best;
		}
		var all = listOf(tracks).filter(Boolean);
		return top(all.filter(function (t) { return !coverish(t); })) || top(all);
	}

	// A song without a work label is looked up by its title when it may be
	// an anime song: its scene is anime, or it has none and is in Japanese or
	// has no language either. Clips and sets are not songs.
	function titleLookable(t) {
		if (!t || !t.id || str(t.work).trim() || t.kind === 'clip' || t.kind === 'set') return false;
		if (!str(t.title).trim() && !str(t.titleAlt).trim()) return false;
		var scene = str(t.scene), lang = str(t.lang);
		return scene === 'anime' || (!scene && (lang === 'ja' || !lang));
	}

	// What to search AnimeThemes' songs for: the titleAlt (the labels' romaji
	// or English title, as AnimeThemes writes titles), the title without
	// decoration, and the parser's reading of an upload whose artist nothing
	// vouches for. Each once.
	function titleQueries(track, M) {
		M = M || getMatch();
		var out = [], seen = {};
		function add(s) {
			s = str(M.baseTitle(str(s))).trim();
			var k = M.fold(s);
			if (!k || has(seen, k)) return;
			seen[k] = true;
			out.push(s);
		}
		if (!track) return out;
		add(track.titleAlt);
		add(track.title);
		if (!str(track.artist).trim() && track.guess) add(track.guess.title);
		return out;
	}

	// The ways a library track can meet a theme: as itself; for a cover, as
	// the song it covers (its original artist, no version or length); for an
	// artist nothing vouches for, as the parser read the upload.
	// -> [{ x, how: '' | 'cover' | 'guess' }]
	function probes(t) {
		if (!t) return [];
		var out = [{ x: t, how: '' }];
		var orig = str(t.origArtist).trim(), g = t.guess;
		if (orig) out.push({ x: { title: t.title, titleAlt: t.titleAlt, artist: orig, work: t.work, role: t.role }, how: 'cover' });
		if (!str(t.artist).trim() && g && str(g.artist).trim()) {
			out.push({ x: { title: str(g.title).trim() || t.title, titleAlt: t.titleAlt, artist: g.artist, work: t.work, role: t.role, version: t.version, durationSec: t.durationSec }, how: 'guess' });
		}
		return out;
	}
	function sigOf(M, x, aliasOf) { return M.signature(x, aliasOf ? { aliasOf: aliasOf } : undefined); }
	// Each track's probes as match.js signatures, read once.
	function prepare(tracks, M, aliasOf) {
		return listOf(tracks).filter(function (t) { return t && t.id; }).map(function (t) {
			return { id: t.id, sigs: probes(t).map(function (p) { return sigOf(M, p.x, aliasOf); }) };
		});
	}
	function verifyRows(themes, rows, trackId, M, aliasOf) {
		var list = listOf(themes), ts = list.map(function (f) { return sigOf(M, f, aliasOf); });
		var ids = [], self = null, best = 0;
		rows.forEach(function (row) {
			var hit = false;
			row.sigs.forEach(function (ps) {
				ts.forEach(function (s, i) {
					var r = M.sameSong(ps, s);
					if (!r.same) return;
					hit = true;
					if (row.id === trackId && r.score > best) { best = r.score; self = list[i]; }
				});
			});
			if (hit) ids.push(row.id);
		});
		return { ok: ids.length > 0, n: ids.length, ids: ids, self: self, score: best };
	}
	// Which library songs of a work an anime's themes hold: every theme
	// against every way each track can meet it (probes; match.js sameSong,
	// SAME or more). trackId names the song asked about: `self` is its theme.
	// o: { M, aliasOf } -> { ok, n, ids: [track ids], self: theme | null, score }
	function verify(themes, tracks, trackId, o) {
		o = o || {};
		var M = o.M || getMatch();
		return verifyRows(themes, prepare(tracks, M, o.aliasOf), trackId, M, o.aliasOf);
	}

	// ---- Candidates ---------------------------------------------------------------------------------

	// Best first: the verified ones (the most of the work's songs found),
	// then the name that fits the label best (match.js workScore over the
	// anime's name, its synonyms and its series' name), then AnimeThemes'
	// own order (rank). Candidates: { ok, n, fit, rank }.
	function rankCandidates(cands) {
		return listOf(cands).map(function (c, i) { return { c: c, i: i }; }).sort(function (a, b) {
			var x = a.c, y = b.c;
			return ((y.ok ? 1 : 0) - (x.ok ? 1 : 0)) || (num(y.n) - num(x.n)) || (num(y.fit) - num(x.fit)) || (num(x.rank) - num(y.rank)) || (a.i - b.i);
		}).map(function (z) { return z.c; });
	}
	// The series a label names: the best fit among AnimeThemes' series
	// found, SERIES_FIT (0.8: one name holds the other) or more; else null.
	function bestSeries(list, work, M) {
		M = M || getMatch();
		var best = null, fit = 0;
		listOf(list).forEach(function (s) {
			if (!s || !s.slug) return;
			var f = M.workScore(work, str(s.name));
			if (f > fit) { fit = f; best = s; }
		});
		return fit >= SERIES_FIT ? best : null;
	}
	// A candidate from an anime record (sources.js anime()).
	function candOf(rec, rank, work, names, M) {
		var serSlug = str(listOf(rec.series)[0]), serName = '';
		if (serSlug) {
			listOf(rec.themes).some(function (f) { if (f && f.seriesKey === 'at:series:' + serSlug && f.series) { serName = str(f.series); return true; } return false; });
			if (!serName && has(names, serSlug)) serName = str(names[serSlug]);
		}
		var fit = work ? M.workScore(work, { name: str(rec.name), synonyms: listOf(rec.synonyms) }) : 0;
		if (work && serName) fit = Math.max(fit, M.workScore(work, serName));
		return {
			slug: str(rec.slug), name: str(rec.name), year: num(rec.year), season: str(rec.season), format: str(rec.format),
			series: serSlug ? { slug: serSlug, name: serName } : null, fit: fit, rank: rank,
			ok: false, n: 0, self: null, score: 0
		};
	}
	// A candidate as it is kept in the map.
	function summary(c) {
		var s = {
			slug: str(c.slug), name: str(c.name), year: num(c.year), season: str(c.season), format: str(c.format),
			series: c.series && c.series.slug ? { slug: str(c.series.slug), name: str(c.series.name) } : null,
			verified: !!(c.ok || c.verified)
		};
		if (c.song) s.song = str(c.song);
		return s;
	}
	// Series names known from kept candidates.
	function namesOf(cands) {
		var out = {};
		listOf(cands).forEach(function (c) { if (c && c.series && c.series.slug && c.series.name) out[c.series.slug] = c.series.name; });
		return out;
	}
	// The candidates offered for "Not this one": the answer first, the
	// rejected ones left out, MAX_CANDIDATES (8) at most.
	function offered(cands, first, no) {
		var out = [], seen = {};
		function add(c) {
			if (!c || !c.slug || has(seen, c.slug) || no.indexOf(c.slug) >= 0) return;
			seen[c.slug] = true;
			var s = summary(c);
			out.push({ slug: s.slug, name: s.name, year: s.year, season: s.season, format: s.format, verified: s.verified });
		}
		add(first);
		listOf(cands).forEach(add);
		return out.slice(0, MAX_CANDIDATES);
	}
	// The answer workOf gives.
	function makeFound(c, o) {
		return {
			kind: 'anime',
			anime: { slug: str(c.slug), name: str(c.name), year: num(c.year), season: str(c.season), format: str(c.format) },
			series: c.series && c.series.slug ? { slug: str(c.series.slug), name: str(c.series.name) } : null,
			sure: !!o.sure,
			via: o.via,
			candidates: offered(o.cands, c, listOf(o.no)),
			theme: o.theme || null,
			work: str(o.work),
			trackId: str(o.trackId),
			key: str(o.key),
			at: num(o.at)
		};
	}

	// AnimeThemes' songs (search 'songs') that are this track: match.js
	// sameSong reaching SAME with the artist part of the evidence ('artist'
	// or 'person'), so an equal title by another artist never counts. Each
	// song's anime: where it has the track's role first, then the earliest.
	// o: { M, aliasOf, order (the query's place) }
	// -> [{ song, score, why, anime: [{ slug, name, year, season, role, seq, themeId }] }], best first
	function titleMatches(track, songs, o) {
		o = o || {};
		var M = o.M || getMatch(), aliasOf = o.aliasOf, role = str(track && track.role), out = [];
		var ps = probes(track).map(function (p) { return sigOf(M, p.x, aliasOf); });
		listOf(songs).forEach(function (s, i) {
			if (!s || !str(s.title)) return;
			var ss = sigOf(M, { title: s.title, artist: str(s.credit) || listOf(s.artists).join(' & ') }, aliasOf), best = null;
			ps.forEach(function (p) {
				var r = M.sameSong(p, ss);
				if (!r.same || (r.why.indexOf('artist') < 0 && r.why.indexOf('person') < 0)) return;
				if (!best || r.score > best.score) best = r;
			});
			if (!best) return;
			var anime = listOf(s.anime).filter(function (a) { return a && a.slug; }).map(function (a, j) { return { a: a, j: j }; }).sort(function (x, y) {
				return ((y.a.role === role ? 1 : 0) - (x.a.role === role ? 1 : 0)) || (aired(x.a) - aired(y.a)) || (x.j - y.j);
			}).map(function (z) { return z.a; });
			out.push({ song: s, score: best.score, why: best.why, anime: anime, order: num(o.order) * 1000 + i });
		});
		return out.sort(function (a, b) { return b.score - a.score || a.order - b.order; });
	}

	// ---- Keeping answers ------------------------------------------------------------------------

	// Is a kept answer still good? The listener's own choice always is; an
	// anime found is checked again after KEEP_MS (90 days), "found nothing"
	// after KEEP_NONE_MS (30 days).
	function fresh(entry, now) {
		if (!entry || typeof entry !== 'object') return false;
		if (entry.via === 'user' && entry.slug) return true;
		if (!(num(entry.at) > 0)) return false;
		return num(now) - num(entry.at) < (entry.slug ? KEEP_MS : KEEP_NONE_MS);
	}
	// Where answers about a track are kept: { work: 'work:<fold(work)>' ('' without a label), song: 'song:<id>' }.
	function keysOf(track, M) {
		M = M || getMatch();
		var w = str(track && track.work).trim();
		return { work: w ? 'work:' + (M.fold(w) || w.toLowerCase()) : '', song: track && track.id ? 'song:' + track.id : '' };
	}

	// ---- The franchise ------------------------------------------------------------------------------

	// An entry that is a crossover: AnimeThemes files it under more than one
	// series, or its name sets two casts against each other ("A vs. B").
	// entry: { name, series: [slugs] } (an anime record).
	function isCrossover(entry) {
		return listOf(entry && entry.series).length > 1 || /(^|\s)vs\.?\s/i.test(str(entry && entry.name));
	}
	// The entries in the order they aired (year, then season; an unknown
	// year last), then by name; crossovers after all of the franchise's own
	// entries, in the same order among themselves.
	function orderEntries(entries) {
		return listOf(entries).map(function (e, i) { return { e: e, i: i }; }).sort(function (a, b) {
			return ((a.e.crossover ? 1 : 0) - (b.e.crossover ? 1 : 0)) || (aired(a.e) - aired(b.e)) || cmp(a.e.name, b.e.name) || (a.i - b.i);
		}).map(function (x) { return x.e; });
	}
	function roleRank(r) { return has(ROLE_ORDER, r) ? ROLE_ORDER[r] : 3; }
	// An entry's themes: openings, then endings, then insert songs, each by
	// its number; equal ones keep their order.
	function orderThemes(themes) {
		return listOf(themes).map(function (f, i) { return { f: f, i: i }; }).sort(function (a, b) {
			return (roleRank(a.f.role) - roleRank(b.f.role)) || (num(a.f.seq) - num(b.f.seq)) || (a.i - b.i);
		}).map(function (x) { return x.f; });
	}

	// The library's covers as the songs they cover, and its uploads whose
	// artist nothing vouches for as the parser read them: a second index for
	// what the library has under another name. -> { ix, by: { id: { id, how } } }
	function extraIndex(tracks, M, aliasOf) {
		M = M || getMatch();
		var rows = [], by = {};
		listOf(tracks).forEach(function (t) {
			if (!t || !t.id) return;
			probes(t).forEach(function (p) {
				if (!p.how) return;
				var x = shallow(p.x), id = t.id + '#' + p.how;
				x.id = id;
				x.removed = t.removed; x.embeddable = t.embeddable; x.playerError = t.playerError; x.blocked = t.blocked;
				by[id] = { id: t.id, how: p.how };
				rows.push(x);
			});
		});
		return { ix: rows.length ? M.index(rows, aliasOf ? { aliasOf: aliasOf } : undefined) : null, by: by };
	}
	// The library's copy of a found song: match.js inLibrary over the
	// library's index, then over the second one (extraIndex).
	// -> { id, how: 'recording' (the same recording) | 'version' (another
	//    take or cut of it) | 'cover' (someone else's recording of it) } | null
	function mineIn(ix, extra, f, M) {
		M = M || getMatch();
		var r = ix ? M.inLibrary(ix, f) : null;
		if (r) return { id: r.id, how: r.sameRecording ? 'recording' : 'version' };
		var x = extra && extra.ix ? M.inLibrary(extra.ix, f) : null;
		if (!x || !has(extra.by, x.id)) return null;
		var p = extra.by[x.id];
		return { id: p.id, how: p.how === 'cover' ? 'cover' : x.sameRecording ? 'recording' : 'version' };
	}

	function plainFold(s) { return str(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ''); }
	// A franchise from its entries ({ slug, name, year, season, format,
	// themes: [find], crossover }): the entries in order (orderEntries),
	// their themes in order (orderThemes) and annotated, and every song once.
	// A song is the same key (at:song:<id>), or the same title and the same
	// whole credit under another key: AnimeThemes sometimes keeps two song
	// records for one song used again ("Toki wo Kizamu Uta" in Clannad: After
	// Story and its special). Another arrangement with its own title ("...
	// -Reprise-", "... ~cuckool mix~") stays a song of its own.
	// o: { title, series, mineOf(find) -> { id, how } | null, isCurrent(find) -> bool,
	//      fold (match.js fold; else lower case without punctuation) }
	// -> { title, series, entries, songs, have, total, current }
	// Each theme gains entry (its entry's name), mine (a library id or null),
	// mineHow, alsoIn (the later entries that use the song again; on its
	// first appearance), firstIn (on a later appearance, the entry it first
	// came in) and current (it is the song the lane was opened from).
	function assemble(entries, o) {
		o = o || {};
		var fold = typeof o.fold === 'function' ? o.fold : plainFold;
		var seen = {}, byName = {}, songs = [], out = [], repeats = [];
		orderEntries(entries).forEach(function (e) {
			var name = str(e.name);
			var themes = orderThemes(e.themes).map(function (f) {
				var x = shallow(f), first = has(seen, x.key) ? seen[x.key] : null;
				var t = fold(x.title), a = fold(x.artist), same = t && a ? t + '|' + a : '';
				if (!first && same && has(byName, same)) first = byName[same];
				x.entry = name;
				x.alsoIn = [];
				x.current = false;
				if (first) {
					if (first.alsoIn.indexOf(name) < 0 && first.entry !== name) first.alsoIn.push(name);
					if (!has(seen, x.key)) seen[x.key] = first;
					x.firstIn = first.entry;
					x.mine = first.mine;
					x.mineHow = first.mineHow;
					repeats.push({ x: x, first: first });
				} else {
					var m = typeof o.mineOf === 'function' ? o.mineOf(x) : null;
					x.firstIn = '';
					x.mine = m ? m.id : null;
					x.mineHow = m ? m.how : '';
					seen[x.key] = x;
					if (same) byName[same] = x;
					songs.push(x);
				}
				return x;
			});
			out.push({ slug: str(e.slug), name: name, year: num(e.year), season: str(e.season), format: str(e.format), crossover: !!e.crossover, themes: themes });
		});
		var current = -1, have = 0;
		if (typeof o.isCurrent === 'function') for (var i = 0; i < songs.length; i++) if (o.isCurrent(songs[i])) { current = i; break; }
		if (current >= 0) {
			songs[current].current = true;
			repeats.forEach(function (r) { if (r.first === songs[current]) r.x.current = true; });
		}
		songs.forEach(function (s) { if (s.mine) have++; });
		return { title: str(o.title) || (out[0] ? out[0].name : ''), series: o.series || null, entries: out, songs: songs, have: have, total: songs.length, current: current };
	}

	// ---- Soundtracks on iTunes --------------------------------------------------------------------

	// Which of iTunes' albums for a work's name are its music: an artist the
	// library credits for the work, or else a soundtrack, anime or game genre
	// and the work's name in the album's title (iTunes also finds The
	// Beatles' "White Album" for "White Album 2"). Best first: a credited
	// artist, then albums before EPs and singles, then Apple's order.
	// credited: { artist key: true }.
	function albumsFor(work, albums, credited, M) {
		M = M || getMatch();
		var wk = M.fold(work), type = { Album: 0, Compilation: 0, EP: 1, Single: 2 };
		return listOf(albums).map(function (a, i) {
			var by = M.artistKeys(str(a && a.artist)).some(function (k) { return has(credited, k); });
			var t = M.fold(a && a.title), named = !!wk && (wk.length >= 3 ? t.indexOf(wk) >= 0 : t === wk);
			return { a: a, i: i, by: by, ok: by || (OST_GENRE.test(str(a && a.genre)) && named) };
		}).filter(function (x) { return x.a && x.a.id != null && x.ok; }).sort(function (x, y) {
			return ((y.by ? 1 : 0) - (x.by ? 1 : 0)) || ((has(type, x.a.type) ? type[x.a.type] : 1) - (has(type, y.a.type) ? type[y.a.type] : 1)) || (x.i - y.i);
		}).map(function (x) { return x.a; });
	}

	// ---- The demo -----------------------------------------------------------------------------------

	// Invented singers, titles and film names for the demo's franchises.
	var DEMO_SINGERS = ['Kiri Hanase', 'Tsubame Choir', 'Hinata Kurose (CV: Rio Nanase)', 'Yuzuha Amane', 'Lantern Orbit'];
	var DEMO_TITLES = ['Hanabi no Ato', 'Yuugure Signal', 'Komorebi Letter', 'Asa no Uta', 'Kazemachi Ticket', 'Hoshizora Platform', 'Tomoshibi', 'Natsu no Owari ni', 'Last Train Waltz', 'Shiosai Memory', 'Paper Crane Radio', 'Ekimae Overture'];
	var DEMO_SUBTITLES = ['Last Train Home', 'The Night Line', 'Terminal Lights'];
	var DEMO_SEASONS = ['spring', 'fall', 'summer'];
	function slugOf(name) { return str(name).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'work'; }

	// An invented franchise for a demo track's work (?demo=1): the work's own
	// songs in the library, in the order they came out, spread over two
	// entries (three from four songs: a TV series, its 2nd season and a
	// film), each with an opening and an ending (invented when the library
	// has none) and an invented insert song, and the last entry using the
	// first one's opening again. The finds are sources.js finds shaped as
	// AnimeThemes' (keys at:song:<n>, workKey at:anime:<slug>, seriesKey
	// at:series:<slug>, videoId null). The same library gives the same
	// franchise, whatever its order. Nothing is asked of any network.
	// o: { M, L, Src } -> { found, franchise } | null (no work, or a work
	// that is not an anime: a game, a visual novel)
	function demoFranchise(track, lib, o) {
		o = o || {};
		var M = o.M || getMatch(), L = o.L || getLibrary(), Src = o.Src || getSources();
		var work = str(track && track.work).trim();
		if (!track || !track.id || !work || !lib) return null;
		var all = lib.tracks && typeof lib.tracks === 'object' ? listOf(lib.tracks) : listOf(lib);
		var group = workTracks(all, work, M);
		if (!group.some(function (t) { return t.id === track.id; })) group.unshift(track);
		if (!PROBABLE_KINDS[workKind(group)]) return null;
		var songs = [], seenSong = {};
		group.filter(function (t) { return !coverish(t) && str(t.artist).trim() && str(t.title).trim(); }).sort(function (a, b) {
			return ((num(a.year) || 9999) - (num(b.year) || 9999)) || cmp(a.id, b.id);
		}).forEach(function (t) {
			var title = str(M.baseTitle(t.title)).trim() || str(t.title), k = M.fold(title) + '|' + M.fold(t.artist);
			if (has(seenSong, k)) return;
			seenSong[k] = true;
			songs.push({ title: title, artist: str(t.artist), role: has(ROLE_ORDER, t.role) ? t.role : 'insert', year: num(t.year) });
		});
		if (!songs.length) return null;

		var h = hash(work), n = songs.length >= 4 ? 3 : 2, serSlug = slugOf(work), entries = [], start = 0;
		var size = Math.floor(songs.length / n), extra = songs.length % n;
		for (var i = 0; i < n; i++) {
			var chunk = songs.slice(start, start + size + (i < extra ? 1 : 0));
			start += chunk.length;
			var name = i === 0 ? work : i === 1 ? work + ' 2nd Season' : work + ': ' + DEMO_SUBTITLES[h % DEMO_SUBTITLES.length];
			entries.push({ name: name, slug: slugOf(name), format: i === 2 ? 'Movie' : 'TV', season: DEMO_SEASONS[i], year: chunk.length ? chunk[0].year : 0, songs: chunk });
		}
		entries.forEach(function (e, j) {
			if (j === 0) { e.year = e.year || 2015; return; }
			var prev = entries[j - 1].year;
			if (!e.year || e.year <= prev) e.year = prev + 1;
		});
		var used = {}, made = 0;
		songs.forEach(function (s) { used[M.fold(s.title)] = true; });
		function invent(role) {
			var title = '', g;
			for (g = 0; g < DEMO_TITLES.length; g++) {
				title = DEMO_TITLES[(h + made * 5 + g) % DEMO_TITLES.length];
				if (!has(used, M.fold(title))) break;
			}
			used[M.fold(title)] = true;
			var s = { title: title, artist: DEMO_SINGERS[(h + made) % DEMO_SINGERS.length], role: role, invented: true };
			made++;
			return s;
		}
		entries.forEach(function (e) {
			if (!e.songs.some(function (s) { return s.role === 'OP'; })) e.songs.push(invent('OP'));
			if (!e.songs.some(function (s) { return s.role === 'ED'; })) e.songs.push(invent('ED'));
			e.songs.push(invent('insert'));
		});
		var firstOp = entries[0].songs.filter(function (s) { return s.role === 'OP'; })[0];
		entries[n - 1].songs.unshift({ title: firstOp.title, artist: firstOp.artist, role: 'OP', invented: !!firstOp.invented });

		var songIds = {}, taken = {};
		function songId(s) {
			var k = M.fold(s.title) + '|' + M.fold(s.artist);
			if (has(songIds, k)) return songIds[k];
			var id = 7000000 + hash(work + '|' + k) % 1000000;
			while (has(taken, id)) id++;
			taken[id] = true;
			songIds[k] = id;
			return id;
		}
		function people(credit) {
			var list = L && L.people ? L.people(credit).filter(function (p) { return p.as !== 'character'; }).map(function (p) { return p.name; }) : [credit];
			return uniq(list);
		}
		var built = entries.map(function (e, j) {
			var seq = {};
			var themes = e.songs.map(function (s, k) {
				seq[s.role] = (seq[s.role] || 0) + 1;
				var f = {
					key: 'at:song:' + songId(s), videoId: null, title: s.title, artist: s.artist, people: people(s.artist),
					work: e.name, workKey: 'at:anime:' + e.slug, series: work, seriesKey: 'at:series:' + serSlug,
					role: s.role, seq: seq[s.role], season: { year: e.year, season: e.season }, year: e.year,
					source: 'animethemes', ids: { at: 8000000 + (h % 9000) * 100 + j * 30 + k }
				};
				return Src && Src.find ? Src.find(f) : f;
			});
			return { slug: e.slug, name: e.name, year: e.year, season: e.season, format: e.format, themes: themes, crossover: false };
		});

		var series = { slug: serSlug, name: work };
		var rows = prepare([track], M, null), place = -1, theme = null;
		built.forEach(function (e, j) {
			if (place >= 0) return;
			var v = verifyRows(e.themes, rows, track.id, M, null);
			if (v.self) { place = j; theme = v.self; }
		});
		var cands = built.map(function (e) { return { slug: e.slug, name: e.name, year: e.year, season: e.season, format: e.format, series: series, ok: true }; });
		var found = makeFound(cands[place < 0 ? 0 : place], { sure: true, via: 'label', cands: cands, no: [], theme: theme, work: work, trackId: track.id, key: keysOf(track, M).work, at: 0 });
		found.demo = true;
		var ix = M.index(all), more = extraIndex(all, M, null);
		var franchise = assemble(built, {
			title: work, series: series, fold: M.fold,
			mineOf: function (f) { return mineIn(ix, more, f, M); },
			isCurrent: function (f) { return verifyRows([f], rows, track.id, M, null).ok; }
		});
		return { found: found, franchise: franchise };
	}

	// ---- The works object ---------------------------------------------------------------------------

	// deps: { at: sources.js animeThemes client, it: sources.js iTunes client
	//         or null, M: match.js, L: library.js, index(): match.js index of
	//         the library, tracks(): [library tracks], map: { get(key) ->
	//         Promise<value | undefined>, set(key, value) -> Promise } or null
	//         (then the answers last the session), now(): ms }
	function create(deps) {
		deps = deps || {};
		var M = deps.M || getMatch(), L = deps.L || getLibrary(), Src = getSources();
		var at = deps.at || null, it = deps.it || null;
		var now = typeof deps.now === 'function' ? deps.now : function () { return Date.now(); };
		var mem = {}, demos = {};
		var map = deps.map && typeof deps.map.get === 'function' && typeof deps.map.set === 'function' ? deps.map : {
			get: function (k) { return Promise.resolve(has(mem, k) ? copy(mem[k]) : undefined); },
			set: function (k, v) { mem[k] = copy(v); return Promise.resolve(); }
		};

		function allTracks() { return listOf(typeof deps.tracks === 'function' ? deps.tracks() : deps.tracks); }
		function givenIndex() { var ix = typeof deps.index === 'function' ? deps.index() : deps.index; return ix && ix.sig ? ix : null; }
		function aliasOf() { var ix = givenIndex(); return ix && typeof ix.aliasOf === 'function' ? ix.aliasOf : null; }
		function trackById(id) {
			var ix = givenIndex();
			if (ix && ix.tracks && has(ix.tracks, id)) return ix.tracks[id];
			var all = allTracks();
			for (var i = 0; i < all.length; i++) if (all[i] && all[i].id === id) return all[i];
			return null;
		}
		// A map that fails reads as empty and forgets a failed write.
		function load(key) {
			return Promise.resolve().then(function () { return map.get(key); }).then(function (v) { return v && typeof v === 'object' ? v : null; }, function () { return null; });
		}
		function save(key, v) {
			return Promise.resolve().then(function () { return map.set(key, v); }).then(function () {}, function () {});
		}
		// Changes to one key, one after another: fn(current entry or null)
		// returns the entry to keep, or null to leave it as it is.
		var queues = {};
		function update(key, fn) {
			var run = (queues[key] || Promise.resolve()).then(function () {
				return load(key).then(function (cur) {
					var v = fn(cur);
					return v ? save(key, v) : null;
				});
			});
			var tail = run.then(function () {}, function () {});
			queues[key] = tail;
			tail.then(function () { if (queues[key] === tail) delete queues[key]; });
			return run;
		}
		// A lookup's answer, kept. A "Not this one" or the listener's own
		// choice made while it looked stays; an answer rejected meanwhile is
		// kept undecided, to be looked up again.
		function keep(key, entry) {
			return update(key, function (cur) {
				if (cur && cur.via === 'user' && cur.slug) return null;
				entry.no = uniq(listOf(entry.no).concat(listOf(cur && cur.no)));
				if (entry.slug && entry.no.indexOf(entry.slug) >= 0) { entry.slug = ''; entry.sure = false; entry.at = 0; }
				return entry;
			});
		}
		function readAnime(slug, signal) { return at.anime(slug, { signal: signal }); }
		// The work's library tracks, the one asked about among them.
		function groupOf(track) {
			var g = workTracks(allTracks(), track.work, M);
			if (!g.some(function (t) { return t.id === track.id; })) g.unshift(track);
			return g;
		}
		function mineFinder() {
			var a = aliasOf(), all = allTracks();
			var ix = givenIndex() || M.index(all, a ? { aliasOf: a } : undefined), more = extraIndex(all, M, a);
			return function (f) { return mineIn(ix, more, f, M); };
		}

		// ---- The work label

		// The listener's own choice: that anime, whatever was found. null when
		// AnimeThemes no longer has it (then the label is looked up again).
		function fromUser(track, e, key, work, signal) {
			return readAnime(e.slug, signal).then(function (rec) {
				check(signal);
				if (!rec) {
					// The choice is forgotten (its "Not this one" list stays).
					return update(key, function (cur) {
						if (!cur || cur.via !== 'user' || cur.slug !== e.slug) return null;
						var next = shallow(cur);
						next.slug = ''; next.sure = false; next.at = 0; next.via = '';
						return next;
					}).then(function () { return null; });
				}
				var a = aliasOf(), c = candOf(rec, 0, work, namesOf(e.cands), M);
				var v = verifyRows(rec.themes, prepare([track], M, a), track.id, M, a);
				return makeFound(c, { sure: true, via: 'user', cands: e.cands, no: e.no, theme: v.self, work: work, trackId: track.id, key: key, at: e.at });
			});
		}

		// A kept answer for this track: the kept anime, or one of the first
		// four kept candidates the track itself is a theme of (read again,
		// from sources.js's cache), so that each song of a work names its own
		// season. selfSure: finding the track there makes the answer sure.
		function fromKept(track, e, key, work, selfSure, signal) {
			var no = listOf(e.no);
			if (!e.slug || no.indexOf(e.slug) >= 0) return Promise.resolve(null);
			var cands = listOf(e.cands).filter(function (c) { return c && c.slug && no.indexOf(c.slug) < 0; });
			var chosen = cands.filter(function (c) { return c.slug === e.slug; })[0] || null;
			var look = [chosen || { slug: e.slug }];
			cands.forEach(function (c) { if (c !== chosen && look.length < 4) look.push(c); });
			var a = aliasOf(), rows = prepare([track], M, a), names = namesOf(cands), base = chosen, hit = null, theme = null;
			function next(i) {
				if (i >= look.length) return Promise.resolve();
				return readAnime(look[i].slug, signal).then(function (rec) {
					check(signal);
					if (!rec) return next(i + 1);
					var c = look[i].name ? look[i] : summary(candOf(rec, 0, work, names, M));
					if (!base && rec.slug === e.slug) base = c;
					var v = verifyRows(rec.themes, rows, track.id, M, a);
					if (v.self) { hit = c; theme = v.self; return; }
					return next(i + 1);
				});
			}
			return next(0).then(null, function (err) { if (aborted(err)) throw err; }).then(function () {
				var c = hit || base;
				if (!c) return null;
				return makeFound(c, { sure: !!e.sure || (selfSure && !!hit), via: e.via || 'label', cands: cands, no: no, theme: theme, work: work, trackId: track.id, key: key, at: e.at });
			});
		}

		// The label looked up: the first TOP anime AnimeThemes finds for it,
		// each checked against the work's library songs; when none verifies,
		// the entries of a series the label names. -> { best, self, cands }
		function lookLabel(track, work, group, kind, no, signal) {
			var a = aliasOf(), rows = prepare(group, M, a), names = {}, cands = [], seen = {}, hits = [];
			function add(rec, rank) {
				if (!rec || !rec.slug || has(seen, rec.slug)) return;
				seen[rec.slug] = true;
				var c = candOf(rec, rank, work, names, M), v = verifyRows(rec.themes, rows, track.id, M, a);
				c.ok = v.ok; c.n = v.n; c.self = v.self; c.score = v.score;
				cands.push(c);
			}
			return at.search(work, ['anime', 'series'], { signal: signal }).then(function (res) {
				check(signal);
				listOf(res.series).forEach(function (s) { if (s && s.slug && !has(names, s.slug)) names[s.slug] = str(s.name); });
				hits = listOf(res.anime).filter(function (x) { return x && x.slug && no.indexOf(x.slug) < 0; });
				return Promise.all(hits.slice(0, TOP).map(function (x) { return readAnime(x.slug, signal); })).then(function (recs) {
					check(signal);
					recs.forEach(function (rec, i) { add(rec, i); });
					if (cands.some(function (c) { return c.ok; })) return null;
					var ser = bestSeries(res.series, work, M);
					if (!ser) return null;
					return at.series(ser.slug, { signal: signal }).then(function (s) {
						check(signal);
						if (!s) return null;
						names[s.slug] = str(s.name);
						var more = listOf(s.anime).filter(function (x) { return x && x.slug && !has(seen, x.slug) && no.indexOf(x.slug) < 0; });
						return Promise.all(more.map(function (x) { return readAnime(x.slug, signal); })).then(function (recs2) {
							check(signal);
							recs2.forEach(function (rec, i) { add(rec, TOP + i); });
						});
					});
				});
			}).then(function () {
				var ranked = rankCandidates(cands), best = ranked[0] || null, self = null;
				if (best && !best.ok && !PROBABLE_KINDS[kind]) best = null;
				if (best) ranked.forEach(function (c) { if (!self && c.self) self = c; });
				hits.forEach(function (x) {
					if (has(seen, x.slug)) return;
					seen[x.slug] = true;
					ranked.push({ slug: x.slug, name: str(x.name), year: num(x.year), season: str(x.season), format: '', series: null, ok: false });
				});
				return { best: best, self: self, cands: ranked };
			});
		}

		// The label's answer: kept while fresh, else looked up again (and kept);
		// a lookup that fails gives the stale answer when there is one.
		function labelAnswer(track, work, group, kind, e, key, signal) {
			var no = listOf(e && e.no);
			if (e && fresh(e, now())) return fromKept(track, e, key, work, true, signal);
			return lookLabel(track, work, group, kind, no, signal).then(function (r) {
				check(signal);
				var t = now(), best = r.best;
				var entry = { slug: best ? best.slug : '', sure: !!(best && best.ok), at: t, no: no, via: 'label', cands: r.cands.slice(0, MAX_CANDIDATES).map(summary) };
				return keep(key, entry).then(function () {
					if (!best) return null;
					var c = r.self || best;
					return makeFound(c, { sure: !!r.self || best.ok, via: 'label', cands: r.cands, no: no, theme: r.self ? r.self.self : null, work: work, trackId: track.id, key: key, at: t });
				});
			}, function (err) {
				if (aborted(err) || !(e && e.slug)) throw err;
				return fromKept(track, e, key, work, true, signal);
			});
		}

		// ---- The song's own title

		// AnimeThemes' songs of the track's titles, the ones that are this
		// song, and the anime each is a theme of. -> { best, sure, theme, cands }
		function lookTitle(track, no, signal) {
			var qs = titleQueries(track, M), matches = [], a = aliasOf();
			function ask(i) {
				if (i >= qs.length) return Promise.resolve();
				return at.search(qs[i], ['songs'], { signal: signal }).then(function (res) {
					check(signal);
					var got = titleMatches(track, res.songs, { M: M, aliasOf: a, order: i });
					matches = matches.concat(got);
					if (got.some(function (m) { return m.score >= M.STRONG; })) return;
					return ask(i + 1);
				});
			}
			return ask(0).then(function () {
				matches.sort(function (x, y) { return y.score - x.score || x.order - y.order; });
				var cands = [], seen = {};
				matches.forEach(function (m) {
					m.anime.forEach(function (x) {
						if (has(seen, x.slug) || no.indexOf(x.slug) >= 0) return;
						seen[x.slug] = true;
						cands.push({ slug: x.slug, name: str(x.name), year: num(x.year), season: str(x.season), format: '', series: null, ok: m.score >= M.STRONG, score: m.score, song: 'at:song:' + m.song.id });
					});
				});
				// The best one AnimeThemes still has, read for its format and series.
				function pick(i) {
					if (i >= cands.length) return Promise.resolve({ best: null, sure: false, theme: null, cands: [] });
					return readAnime(cands[i].slug, signal).then(function (rec) {
						check(signal);
						if (!rec) return pick(i + 1);
						var c = candOf(rec, i, '', {}, M), theme = null;
						c.ok = cands[i].ok; c.score = cands[i].score; c.song = cands[i].song;
						listOf(rec.themes).some(function (f) { if (f && f.key === c.song) { theme = f; return true; } return false; });
						return { best: c, sure: c.score >= M.STRONG, theme: theme, cands: [c].concat(cands.slice(i + 1)) };
					});
				}
				return pick(0);
			});
		}

		// The title's answer, kept under 'song:<id>' like the label's.
		// extraNo: the work's rejected anime, left out too.
		function titleAnswer(track, work, key, extraNo, e, signal) {
			var no = listOf(e && e.no), all = uniq(no.concat(listOf(extraNo)));
			if (e && fresh(e, now())) {
				var kept = shallow(e);
				kept.no = all;
				return fromKept(track, kept, key, work, false, signal);
			}
			return lookTitle(track, all, signal).then(function (r) {
				check(signal);
				var t = now(), best = r.best;
				var entry = { slug: best ? best.slug : '', sure: !!(best && r.sure), at: t, no: no, via: 'title', cands: r.cands.slice(0, MAX_CANDIDATES).map(summary) };
				return keep(key, entry).then(function () {
					if (!best) return null;
					return makeFound(best, { sure: r.sure, via: 'title', cands: r.cands, no: all, theme: r.theme, work: work, trackId: track.id, key: key, at: t });
				});
			}, function (err) {
				if (aborted(err) || !(e && e.slug)) throw err;
				var kept = shallow(e);
				kept.no = all;
				return fromKept(track, kept, key, work, false, signal);
			});
		}

		// ---- Which anime a song is from

		function byLabel(track, work, signal) {
			var keys = keysOf(track, M), group = groupOf(track), kind = workKind(group);
			return load(keys.work).then(function (e) {
				check(signal);
				var user = e && e.via === 'user' && e.slug ? fromUser(track, e, keys.work, work, signal) : Promise.resolve(null);
				return user.then(function (f) {
					if (f) return f;
					var le = e && e.via === 'user' ? { no: e.no } : e;
					return labelAnswer(track, work, group, kind, le, keys.work, signal).then(function (res) {
						check(signal);
						if (res && res.sure) return res;
						// Nothing verified: the song's own title may say which anime it is
						// (the label's candidates stay on offer after its own).
						return load(keys.song).then(function (se) {
							check(signal);
							return titleAnswer(track, work, keys.song, le && le.no, se, signal);
						}).then(function (tf) {
							if (!tf) return res;
							if (res) tf.candidates = offered(tf.candidates.concat(res.candidates), null, []);
							return tf;
						});
					});
				});
			});
		}
		function byTitle(track, signal) {
			var key = keysOf(track, M).song;
			return load(key).then(function (e) {
				check(signal);
				var user = e && e.via === 'user' && e.slug ? fromUser(track, e, key, '', signal) : Promise.resolve(null);
				return user.then(function (f) {
					if (f) return f;
					if (!titleLookable(track)) return null;
					return titleAnswer(track, '', key, [], e && e.via === 'user' ? { no: e.no } : e, signal);
				});
			});
		}

		// -> Promise<null | { kind: 'anime', anime: { slug, name, year, season,
		//    format }, series: { slug, name } | null, sure, via: 'label' |
		//    'title' | 'user', candidates: [{ slug, name, year, season, format,
		//    verified }], theme: find | null, work, trackId, key, at }>
		function workOf(track, o) {
			o = o || {};
			var signal = o.signal;
			return Promise.resolve().then(function () {
				check(signal);
				if (!track || !track.id || !at) return null;
				var work = str(track.work).trim();
				return work ? byLabel(track, work, signal) : byTitle(track, signal);
			});
		}

		// "Not this one": the anime is left out of this song's answers from now
		// on (and, for a labelled song, of its work's); the next workOf looks
		// again without it.
		function reject(track, slug) {
			slug = str(slug).trim();
			if (!track || !track.id || !slug) return Promise.resolve();
			var keys = keysOf(track, M);
			return Promise.all([keys.work, keys.song].filter(Boolean).map(function (k) {
				return update(k, function (e) {
					e = e ? shallow(e) : { slug: '', sure: false, at: 0, no: [], via: '', cands: [] };
					var no = listOf(e.no).slice();
					if (no.indexOf(slug) < 0) no.push(slug);
					e.no = no;
					if (e.slug === slug) { e.slug = ''; e.sure = false; e.at = 0; e.via = ''; }
					return e;
				});
			})).then(function () {});
		}
		// The listener says it is this anime: kept for the work (a labelled
		// song) or the song, never checked again.
		function confirm(track, slug) {
			slug = str(slug).trim();
			if (!track || !track.id || !slug) return Promise.resolve();
			var keys = keysOf(track, M), k = keys.work || keys.song;
			return update(k, function (e) {
				e = e ? shallow(e) : { cands: [] };
				e.no = listOf(e.no).filter(function (s) { return s !== slug; });
				e.slug = slug;
				e.sure = true;
				e.via = 'user';
				e.at = now();
				return e;
			}).then(function () {});
		}

		// ---- The franchise

		// Every entry of the found anime's series (or the anime alone), each
		// read for its format and its series (a crossover goes last), and
		// assembled: every song once, the library's copies marked.
		function franchise(found, o) {
			o = o || {};
			var signal = o.signal;
			return Promise.resolve().then(function () {
				check(signal);
				if (!found || !found.anime || !found.anime.slug) return null;
				if (found.demo) return has(demos, found.key) ? copy(demos[found.key]) : null;
				if (!at) return null;
				var ser = found.series && found.series.slug ? found.series : null;
				return (ser ? at.series(ser.slug, { signal: signal }) : Promise.resolve(null)).then(function (s) {
					check(signal);
					var stubs = s ? listOf(s.anime).filter(function (x) { return x && x.slug; }) : [];
					if (!stubs.some(function (x) { return x.slug === found.anime.slug; })) stubs.push({ slug: found.anime.slug, name: found.anime.name, year: found.anime.year, season: found.anime.season, themes: null });
					var failed = null;
					return Promise.all(stubs.map(function (x) {
						return readAnime(x.slug, signal).then(null, function (err) { if (aborted(err)) throw err; failed = failed || err; return null; });
					})).then(function (recs) {
						check(signal);
						var entries = [];
						stubs.forEach(function (x, i) {
							var rec = recs[i], themes = x.themes || (rec ? rec.themes : null), name = str(x.name || (rec && rec.name));
							if (!themes) return;
							entries.push({
								slug: x.slug, name: name, year: num(x.year || (rec && rec.year)), season: str(x.season || (rec && rec.season)),
								format: rec ? str(rec.format) : '', themes: themes, crossover: !!s && isCrossover({ name: name, series: rec ? rec.series : [] })
							});
						});
						if (!entries.length && failed) throw failed;
						var a = aliasOf(), track = found.trackId ? trackById(found.trackId) : null, rows = track ? prepare([track], M, a) : null;
						return assemble(entries, {
							title: str((s && s.name) || (ser && ser.name) || found.anime.name),
							series: s ? { slug: str(s.slug), name: str(s.name) } : ser ? { slug: str(ser.slug), name: str(ser.name) } : null,
							mineOf: mineFinder(), fold: M.fold,
							isCurrent: rows ? function (f) { return verifyRows([f], rows, track.id, M, a).ok; } : null
						});
					});
				});
			});
		}

		// ---- The demo

		function demo(track, lib) {
			var d = demoFranchise(track, lib, { M: M, L: L, Src: Src });
			if (d) demos[d.found.key] = copy(d.franchise);
			return d;
		}

		// ---- Soundtracks

		// A work's albums on iTunes (for a game, a visual novel, a stage
		// work): its soundtracks, character and vocal albums, found by the
		// work's name in Japan's store and then the US's (the US's first for
		// stage, film and TV works; Japan's only for a name in Japanese
		// script), filtered (albumsFor), the first ALBUMS (3) read, each
		// checked against the work's library songs.
		// -> Promise<null | { work, albums: [{ id, title, year, cover, type,
		//    artist, genre, link, country, tracks: [find], mine, verified }],
		//    have, total, sure }>
		function soundtracks(track, o) {
			o = o || {};
			var signal = o.signal;
			return Promise.resolve().then(function () {
				check(signal);
				var work = str(track && track.work).trim();
				if (!track || !track.id || !work || !it) return null;
				var group = groupOf(track), kind = workKind(group), credited = {};
				group.forEach(function (t) {
					var names = coverish(t) ? [t.origArtist] : [t.artist, t.artistNative];
					names.forEach(function (n) { if (str(n).trim()) M.artistKeys(str(n)).forEach(function (k) { credited[k] = true; }); });
				});
				var stores = JAPANESE.test(work) ? ['JP'] : kind === 'stage' || kind === 'film' || kind === 'tv' ? ['US', 'JP'] : ['JP', 'US'];
				var picked = [];
				function ask(i) {
					if (i >= stores.length) return Promise.resolve();
					return it.searchAlbums(work, { country: stores[i], limit: 25, signal: signal }).then(function (albums) {
						check(signal);
						picked = albumsFor(work, albums, credited, M).map(function (x) { var y = shallow(x); y.country = stores[i]; return y; });
						return picked.length ? null : ask(i + 1);
					});
				}
				return ask(0).then(function () {
					var read = picked.slice(0, ALBUMS);
					return Promise.all(read.map(function (x) { return it.albumTracks(x.id, { country: x.country, signal: signal }); })).then(function (lists) {
						check(signal);
						var a = aliasOf(), rows = prepare(group, M, a), mineOf = mineFinder(), seen = {}, have = 0, total = 0, sure = false;
						var albums = read.map(function (x, i) {
							var songs = listOf(lists[i]).map(shallow), v = verifyRows(songs, rows, track.id, M, a), mine = 0;
							songs.forEach(function (f) {
								var m = mineOf(f);
								f.mine = m ? m.id : null;
								f.mineHow = m ? m.how : '';
								if (f.mine) mine++;
								if (has(seen, f.key)) return;
								seen[f.key] = true;
								total++;
								if (f.mine) have++;
							});
							if (v.ok) sure = true;
							return {
								id: x.id, title: str(x.title), year: parseInt(str(x.date).slice(0, 4), 10) || 0, cover: str(x.cover), type: str(x.type),
								artist: str(x.artist), genre: str(x.genre), link: str(x.link), country: x.country, tracks: songs, mine: mine, verified: v.ok
							};
						});
						albums = albums.map(function (x, i) { return { x: x, i: i }; }).sort(function (p, q) { return ((q.x.verified ? 1 : 0) - (p.x.verified ? 1 : 0)) || (p.i - q.i); }).map(function (z) { return z.x; });
						return { work: work, albums: albums, have: have, total: total, sure: sure };
					});
				});
			});
		}

		return { workOf: workOf, franchise: franchise, reject: reject, confirm: confirm, demo: demo, soundtracks: soundtracks };
	}

	return {
		create: create,
		KEEP_MS: KEEP_MS, KEEP_NONE_MS: KEEP_NONE_MS, TOP: TOP, WORK_SCENES: WORK_SCENES,
		workTracks: workTracks, workKind: workKind, titleLookable: titleLookable, titleQueries: titleQueries,
		probes: probes, verify: verify, rankCandidates: rankCandidates, bestSeries: bestSeries, titleMatches: titleMatches,
		fresh: fresh, keysOf: keysOf,
		isCrossover: isCrossover, orderEntries: orderEntries, orderThemes: orderThemes, assemble: assemble,
		extraIndex: extraIndex, mineIn: mineIn, albumsFor: albumsFor, demoFranchise: demoFranchise
	};
});
