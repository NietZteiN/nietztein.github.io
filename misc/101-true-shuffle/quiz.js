/*
 * True Shuffle: quiz.js, Guess the anime (#/quiz).
 *
 * A few seconds of an opening or ending from the library, four anime to
 * choose from, ten rounds. No video: YouTube's player would show the anime.
 * The clip is the 30-second preview Apple's iTunes Search gives for the
 * song (CORS, no key, about 20 requests a minute), played in a plain Audio
 * element while YouTube's player is paused.
 *
 *     var Q = TrueShuffle.quiz;
 *     var p = Q.pool(tracks, { inserts: false });         // the songs and the works
 *     var r = Q.makeRound(p, S.rng('x'), { level: 'normal', avoid: { ids, songs, works } });
 *     var g = Q.createGame({ tracks, rand, level, fetch }); // the state machine the page drives
 *     g.start().then(function (st) { ... g.answer(1, 2400); g.next(); ... g.summary(); });
 *
 * The pure parts (pool, choicesFor, makeRound, pickPreview, score, typed,
 * searchTerms, searchUrl, roleLabel) and createGame run in Node. view()
 * draws the page with the app's ctx (app.js pageCtx) and is browser only.
 *
 * UMD: window.TrueShuffle.quiz in the browser (after library.js,
 * shuffle.js and match.js), module.exports in Node. Titles from the
 * library and from iTunes go on the page through textContent.
 */
(function (root, factory) {
	var node = typeof module === 'object' && module.exports;
	var api = factory(root,
		function () { return node ? require('./library.js') : (root.TrueShuffle || {}).library; },
		function () { return node ? require('./shuffle.js') : (root.TrueShuffle || {}).shuffle; },
		function () { return node ? require('./match.js') : (root.TrueShuffle || {}).match; });
	if (node) module.exports = api;
	else { root.TrueShuffle = root.TrueShuffle || {}; root.TrueShuffle.quiz = api; }
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this), function (root, getL, getS, getM) {
	'use strict';

	var ROUNDS = 10;          // rounds in a game
	var MIN_WORKS = 4;        // works needed to play: the answer and three others
	var AHEAD = 2;            // rounds looked up ahead of the one on screen
	var START_WINDOW = 20;    // a clip starts somewhere in the preview's first 20 seconds
	var MORE_SEC = 5;         // "Give me 5 more seconds"
	var GAP_MS = 3100;        // iTunes Search allows about 20 requests a minute
	var PAUSE_MS = 60000;     // after a 403 or 429 the requests wait a minute
	var FAILS = 3;            // failed lookups in a row before the game says so
	var TRIES = 15;           // songs without a preview tried for one round before giving up
	var RETRY_MS = 1000;      // a failed lookup is tried again after 1 s, then 2 s
	var ECHO_MS = 1500;       // a "playing" from YouTube's player this soon after pausing it is its echo
	var DAY = 86400000;
	var HIT_TTL = 30 * DAY, MISS_TTL = 7 * DAY;
	var ITUNES = 'https://itunes.apple.com/search';
	var COUNTRY = 'JP';
	var PREVIEW_RE = /^https:\/\/audio-ssl\.itunes\.apple\.com\/[^\s"'<>\\]+$/;
	var APPLE_RE = /^https:\/\/music\.apple\.com\/[^\s"'<>\\]*$/;
	var JAPANESE = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u;
	var FETCH_INIT = { credentials: 'omit', referrerPolicy: 'no-referrer' };
	var LEVELS = {
		easy: { key: 'easy', name: 'Easy', clip: 10, blurb: '10 seconds. The other three can be any anime.' },
		normal: { key: 'normal', name: 'Normal', clip: 7, blurb: '7 seconds. The other three are the same kind of show where the library has them.' },
		hard: { key: 'hard', name: 'Hard', clip: 4, blurb: '4 seconds. The other three are the same kind of show from within three years. You can type the name.' }
	};
	var LEVEL_KEYS = ['easy', 'normal', 'hard'];
	// Scenes that say what a work is; the others (utaite, vtuber, meme ...) say who sings a song.
	var WORK_SCENES = ['anime', 'vn', 'game', 'film', 'tv', 'stage', 'touhou'];
	var SURE_YEAR = { label: true, edit: true, release: true, title: true, '': true };
	var ROLE_SHORT = { OP: 'OP', ED: 'ED', insert: 'Insert song' };

	// ---- Small helpers -------------------------------------------------------------------

	function str(x) { return x == null ? '' : String(x); }
	function has(o, k) { return !!o && Object.prototype.hasOwnProperty.call(o, k); }
	function listOf(x) {
		if (Array.isArray(x)) return x;
		if (x && typeof x === 'object') return Object.keys(x).map(function (k) { return x[k]; });
		return [];
	}
	// match.js fold when it is there: no case, accents, spaces or punctuation.
	function fold(s) {
		var M = getM();
		if (M && M.fold) return M.fold(s);
		return str(s).normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase().replace(/&/g, ' and ').replace(/^\s*the\s+/, '').replace(/[^\p{L}\p{N}]+/gu, '');
	}
	// The key a work is known by: spellings that romanise alike are one work.
	function workKey(name) { var M = getM(), k = M && M.loose ? M.loose(name) : ''; return k || fold(name); }
	function pickIndex(rand, n) {
		if (!(n > 1)) return 0;
		if (rand && typeof rand.int === 'function') return rand.int(n);
		var i = Math.floor(rand() * n);
		return i >= n ? n - 1 : i < 0 ? 0 : i;
	}
	function playable(t) { var L = getL(); return L && L.playable ? L.playable(t) : !!t && !t.removed && t.embeddable !== false && !t.playerError; }
	function coverish(t) { return !!t.origArtist || /cover|piano|orchestral|acoustic|remix|karaoke/.test(str(t.version)); }
	function songKeyOf(t) { var S = getS(); return S && S.songKey ? S.songKey(t) : fold(t.title) + '|' + fold(t.origArtist || t.artist); }
	function qerr(code, message) { var e = new Error(message); e.code = code; return e; }

	// ---- The pool: the songs a game can ask about ------------------------------------------

	// A song can be asked about: it plays, it is not blocked, it is a song
	// (not a clip or a set), it has a sure artist (so its preview can be
	// matched) and a work, and it is an opening or an ending (or an insert
	// song, when asked).
	function eligible(t, inserts) {
		if (!t || !t.id || !str(t.work).trim() || !str(t.artist).trim()) return false;
		if (!playable(t) || t.blocked || t.kind === 'clip' || t.kind === 'set') return false;
		return t.role === 'OP' || t.role === 'ED' || (!!inserts && t.role === 'insert');
	}
	// The commonest scene of a work, from its own recordings first (a cover's
	// scene says who sings it), and from the scenes that name a kind of work.
	function sceneOf(tracks) {
		function top(list, only) {
			var c = {}, best = '', n = 0;
			list.forEach(function (t) { var s = str(t.scene); if (s && (!only || WORK_SCENES.indexOf(s) >= 0)) c[s] = (c[s] || 0) + 1; });
			Object.keys(c).sort().forEach(function (s) { if (c[s] > n) { n = c[s]; best = s; } });
			return best;
		}
		var own = tracks.filter(function (t) { return !coverish(t); });
		return top(own, true) || top(tracks, true) || top(own, false) || top(tracks, false);
	}
	// The first year of a work: its own recordings' earliest sure year (an
	// upload's year says nothing), else any track's; 0 when none is known.
	function yearOf(tracks) {
		function min(list) {
			var y = 0;
			list.forEach(function (t) {
				var v = Math.floor(+t.year);
				if (v > 1900 && v < 2200 && has(SURE_YEAR, str(t.yearSource)) && (!y || v < y)) y = v;
			});
			return y;
		}
		return min(tracks.filter(function (t) { return !coverish(t); })) || min(tracks);
	}
	// The names a typed answer may use: every spelling the labels give the
	// work, those passed in, and the main title of "Main: Subtitle",
	// "Main - Subtitle" or "Main (Season 2)" when it is four letters or more.
	function aliasesOf(names, more) {
		var out = [];
		function add(s) { s = str(s).trim(); if (s && out.indexOf(s) < 0) out.push(s); }
		names.forEach(add);
		listOf(more).forEach(add);
		out.slice().forEach(function (s) {
			var m = /^(.+?)\s*(?::|\s[\p{Pd}|]\s|\()/u.exec(s);
			if (m && fold(m[1]).length >= 4) add(m[1]);
		});
		return out;
	}
	// tracks: a list or { id: track }. opts: { inserts, aliases: { work: [names] } }
	// -> { works: [{ name, key, scene, year, ids, aliases }], byWork, byId, ids, songs, ok, need, inserts }
	function pool(tracks, opts) {
		opts = opts || {};
		var inserts = !!opts.inserts, extra = opts.aliases && typeof opts.aliases === 'object' ? opts.aliases : {};
		var groups = {}, keys = [];
		listOf(tracks).forEach(function (t) {
			var name = t ? str(t.work).trim() : '';
			if (!name) return;
			var k = workKey(name);
			if (!k) return;
			var g = groups[k];
			if (!g) { g = groups[k] = { names: {}, all: [], songs: [] }; keys.push(k); }
			g.names[name] = (g.names[name] || 0) + 1;
			g.all.push(t);
			if (eligible(t, inserts)) g.songs.push(t);
		});
		keys.sort();
		var works = [], byWork = {}, byId = {}, ids = [], taken = {};
		keys.forEach(function (k) {
			var g = groups[k];
			if (!g.songs.length) return;
			var names = Object.keys(g.names).sort(function (a, b) { return g.names[b] - g.names[a] || (a < b ? -1 : a > b ? 1 : 0); });
			var more = [];
			names.forEach(function (nm) { if (has(extra, nm)) more = more.concat(listOf(extra[nm])); });
			var own = [], mine = {};
			g.songs.forEach(function (t) { if (!has(taken, t.id)) { taken[t.id] = true; mine[t.id] = t; own.push(t.id); } });
			own.sort();
			own.forEach(function (id) { byId[id] = mine[id]; });
			var w = { name: names[0], key: k, scene: sceneOf(g.all), year: yearOf(g.all), ids: own, aliases: aliasesOf(names, more) };
			works.push(w);
			byWork[w.name] = w;
			ids = ids.concat(own);
		});
		ids.sort();
		return { works: works, byWork: byWork, byId: byId, ids: ids, songs: ids.length, ok: works.length >= MIN_WORKS, need: MIN_WORKS, inserts: inserts };
	}

	// ---- A round ---------------------------------------------------------------------------

	// Two works of one franchise: one name holds the other (five letters or more).
	function related(a, b) {
		var x = fold(a), y = fold(b);
		if (!x || !y) return false;
		if (x === y) return true;
		var s = x.length < y.length ? x : y, l = s === x ? y : x;
		return s.length >= 5 && l.indexOf(s) >= 0;
	}
	// The four names to choose from: the answer once, at a random place, and
	// three other works. Easy takes any; Normal the answer's scene first;
	// Hard its scene and within three years first, then its scene, then any.
	// Easy and Normal keep works of the same franchise for last; Hard allows one.
	function choicesFor(answer, works, rand, level) {
		var list = listOf(works).filter(function (w) { return w && w.name; });
		var name = answer && typeof answer === 'object' ? str(answer.name) : str(answer);
		var a = null;
		list.forEach(function (w) { if (!a && w.name === name) a = w; });
		if (!a) a = answer && typeof answer === 'object' ? answer : { name: name };
		var key = a.key || workKey(name), scene = str(a.scene), year = +a.year || 0;
		var lv = has(LEVELS, level) ? level : 'normal';
		var seen = {}, others = [];
		list.forEach(function (w) {
			var k = w.key || workKey(w.name);
			if (w.name === name || k === key || seen[k]) return;
			seen[k] = true;
			others.push(w);
		});
		function rel(w) { return related(w.name, name); }
		function same(w) { return !!scene && str(w.scene) === scene; }
		function near(w) { return year > 0 && +w.year > 0 && Math.abs(+w.year - year) <= 3; }
		var tiers;
		if (lv === 'easy') tiers = [others.filter(function (w) { return !rel(w); }), others.filter(rel)];
		else if (lv === 'normal') {
			tiers = [
				others.filter(function (w) { return same(w) && !rel(w); }),
				others.filter(function (w) { return !same(w) && !rel(w); }),
				others.filter(rel)
			];
		} else {
			tiers = [
				others.filter(function (w) { return same(w) && (!year || near(w)); }),
				others.filter(function (w) { return same(w) && year > 0 && !near(w); }),
				others.filter(function (w) { return !same(w); })
			];
		}
		var wrong = [], later = [], relN = 0;
		tiers.forEach(function (tier) {
			var left = tier.slice();
			while (wrong.length < 3 && left.length) {
				var w = left.splice(pickIndex(rand, left.length), 1)[0];
				if (lv === 'hard' && rel(w)) {
					if (relN >= 1) { later.push(w); continue; }
					relN++;
				}
				wrong.push(w.name);
			}
		});
		while (wrong.length < 3 && later.length) wrong.push(later.shift().name);
		var out = wrong.slice();
		out.splice(pickIndex(rand, out.length + 1), 0, name);
		return out;
	}
	// avoid: a list of ids, or { ids, songs, works } (lists, or maps whose truthy keys count).
	function avoidOf(x) {
		var out = { ids: {}, songs: {}, works: {} };
		function fill(map, v) {
			if (Array.isArray(v)) v.forEach(function (k) { map[k] = true; });
			else if (v && typeof v === 'object') Object.keys(v).forEach(function (k) { if (v[k]) map[k] = true; });
		}
		if (Array.isArray(x)) fill(out.ids, x);
		else if (x && typeof x === 'object') { fill(out.ids, x.ids); fill(out.songs, x.songs); fill(out.works, x.works); }
		return out;
	}
	// One round: a work drawn evenly among those with a song left (works not
	// asked yet first), one of its songs, the choices, and where the clip
	// starts. The same rand gives the same round. null when nothing is left.
	function makeRound(p, rand, opts) {
		opts = opts || {};
		if (!p || !p.works || !p.works.length) return null;
		var level = has(LEVELS, opts.level) ? opts.level : 'normal';
		var av = avoidOf(opts.avoid);
		function free(id) { var t = p.byId[id]; return !!t && !av.ids[id] && !av.songs[songKeyOf(t)]; }
		var open = p.works.filter(function (w) { return w.ids.some(free); });
		if (!open.length) return null;
		var fresh = open.filter(function (w) { return !av.works[w.name]; });
		var from = fresh.length ? fresh : open;
		var w = from[pickIndex(rand, from.length)];
		var ids = w.ids.filter(free);
		var id = ids[pickIndex(rand, ids.length)], t = p.byId[id];
		var choices = choicesFor(w, p.works, rand, level);
		return {
			id: id, work: w.name, scene: w.scene, year: w.year, song: songKeyOf(t),
			title: str(t.title), artist: str(t.artist), role: str(t.role), roleLabel: roleLabel(t),
			choices: choices, answer: choices.indexOf(w.name), level: level,
			clipSec: LEVELS[level].clip, startSec: pickIndex(rand, START_WINDOW)
		};
	}
	// 'OP', 'ED' or 'Insert song'; with the number the upload's title gives
	// ("Opening 2", "ED3", "NCOP 4") when it agrees with the role: 'OP2'.
	function roleLabel(t) {
		var r = str(t && t.role), base = has(ROLE_SHORT, r) ? ROLE_SHORT[r] : r;
		if (r !== 'OP' && r !== 'ED') return base;
		var text = str(t.raw && t.raw.title) + ' ' + str(t.title) + ' ' + str(t.versionText);
		var m = /\b(?:NC)?(OP|ED)\s?0?([1-9]\d?)\b/i.exec(text) || /\b(Opening|Ending)\s+(?:Theme\s+)?(?:#\s?|No\.?\s?)?0?([1-9]\d?)\b/i.exec(text);
		if (!m) return base;
		var kind = /^(OP|Opening)$/i.test(m[1]) ? 'OP' : 'ED';
		return kind === r ? r + m[2] : base;
	}

	// ---- Previews from iTunes Search ---------------------------------------------------------

	function okPreview(url) { return PREVIEW_RE.test(str(url)); }
	function appleLink(u) { u = str(u).replace(/[?&]uo=\d+$/, ''); return APPLE_RE.test(u) ? u : ''; }
	// Without match.js: an equal folded title (or titleAlt) and artist.
	function sameByFold(t, f) {
		var ft = fold(f.title), fa = fold(f.artist);
		var titles = [t.title, t.titleAlt].map(fold).filter(Boolean), artists = [t.artist, t.artistNative].map(fold).filter(Boolean);
		return !!ft && titles.indexOf(ft) >= 0 && artists.some(function (a) { return a === fa || (a.length >= 4 && fa.length >= 4 && (a.indexOf(fa) >= 0 || fa.indexOf(a) >= 0)); });
	}
	// The result that is this song: an Apple preview address, then match.js
	// sameSong (else folded equality); the highest score, the first of
	// equal ones. -> { url, title, artist, durationSec, score, link } | null
	// opts.ok replaces the address check (a test serving its own audio).
	function pickPreview(results, track, opts) {
		if (!track) return null;
		var ok = opts && typeof opts.ok === 'function' ? opts.ok : okPreview;
		var M = getM(), best = null;
		listOf(results).forEach(function (r) {
			if (!r || typeof r !== 'object') return;
			if (r.kind != null && r.kind !== 'song') return;
			var url = str(r.previewUrl);
			if (!ok(url)) return;
			var f = { title: str(r.trackName).trim(), artist: str(r.artistName).trim(), durationSec: +r.trackTimeMillis > 0 ? Math.round(+r.trackTimeMillis / 1000) : 0 };
			if (!f.title || !f.artist) return;
			var s;
			if (M && M.sameSong) {
				var m = M.sameSong(track, f);
				if (!m || !m.same) return;
				s = m.score;
			} else {
				if (!sameByFold(track, f)) return;
				s = 5;
			}
			if (!best || s > best.score) best = { url: url, title: f.title, artist: f.artist, durationSec: f.durationSec, score: s, link: appleLink(r.trackViewUrl) };
		});
		return best;
	}
	function baseOf(title) { var M = getM(), b = M && M.baseTitle ? M.baseTitle(title) : str(title); return b || str(title); }
	function cap(q) {
		q = str(q).replace(/\s+/g, ' ').trim();
		if (q.length > 100) {
			q = q.slice(0, 100);
			var c = q.lastIndexOf(' ');
			if (c >= 60) q = q.slice(0, c);
			var last = q.charCodeAt(q.length - 1);
			if (last >= 0xD800 && last <= 0xDBFF) q = q.slice(0, -1);
		}
		return q.trim();
	}
	// What to ask iTunes, at most two: the artist's native name and the
	// Japanese title when the labels have them (Japan's store lists them so),
	// then the original artist for a cover, else the names as the library has them.
	function searchTerms(t) {
		var out = [];
		if (!t) return out;
		function add(artist, title) { var q = cap(str(artist).trim() + ' ' + baseOf(title)); if (q && str(title).trim() && out.indexOf(q) < 0) out.push(q); }
		var jp = JAPANESE.test(str(t.titleAlt)) && !JAPANESE.test(str(t.title)) ? t.titleAlt : t.title;
		add(t.artistNative || t.artist, jp);
		if (t.origArtist) add(t.origArtist, jp);
		add(t.artist, t.title);
		return out.slice(0, 2);
	}
	function searchUrl(term, country) {
		var c = /^[A-Za-z]{2}$/.test(str(country)) ? str(country).toUpperCase() : COUNTRY;
		return ITUNES + '?term=' + encodeURIComponent(str(term)).replace(/%20/g, '+') + '&country=' + c + '&media=music&entity=song&limit=5';
	}
	function cacheKey(t, country) {
		return 'qz:it:' + (country || COUNTRY) + ':' + fold(t.artist).slice(0, 40) + ':' + fold(t.title).slice(0, 60) + (t.origArtist ? ':' + fold(t.origArtist).slice(0, 30) : '');
	}

	// Requests one after another, gapMs apart; pause(ms) holds them all.
	function makeLine(o) {
		o = o || {};
		var gap = o.gapMs != null ? Math.max(0, +o.gapMs || 0) : GAP_MS;
		var now = typeof o.now === 'function' ? o.now : function () { return Date.now(); };
		var last = -Infinity, until = 0, chain = Promise.resolve();
		function wait(ms) { return new Promise(function (res) { setTimeout(res, ms); }); }
		return {
			run: function (fn) {
				var p = chain.then(function () {
					var d = Math.max(last + gap, until) - now();
					return d > 0 ? wait(d) : null;
				}).then(function () { last = now(); return fn(); });
				chain = p.then(function () {}, function () {});
				return p;
			},
			pause: function (ms) { until = Math.max(until, now() + Math.max(0, +ms || 0)); },
			pausedUntil: function () { return until; }
		};
	}

	// ---- Scoring ------------------------------------------------------------------------------

	// 50 extra points for an answer within 2 s of the clip starting, none after 15 s.
	function speedBonus(ms) {
		ms = +ms;
		if (!(ms >= 0)) return 0;
		return Math.round(50 * Math.max(0, Math.min(1, (15000 - ms) / 13000)));
	}
	// The score after one answer (a new object): a right answer is 100 points
	// and the speed bonus; a wrong one ends the streak. score(null) is a new game's.
	// -> { points, right, wrong, streak, best, last }
	function score(state, correct, ms) {
		var s = state || {};
		var out = { points: +s.points || 0, right: +s.right || 0, wrong: +s.wrong || 0, streak: +s.streak || 0, best: +s.best || 0, last: 0 };
		if (arguments.length < 2) return out;
		if (correct) {
			out.last = 100 + speedBonus(ms);
			out.points += out.last;
			out.right++;
			out.streak++;
			if (out.streak > out.best) out.best = out.streak;
		} else {
			out.wrong++;
			out.streak = 0;
		}
		return out;
	}
	function plainWorkScore(a, b) {
		var x = fold(a), y = fold(b);
		if (!x || !y) return 0;
		if (x === y) return 1;
		return x.length >= 4 && y.length >= 4 && (x.indexOf(y) >= 0 || y.indexOf(x) >= 0) ? 0.8 : 0;
	}
	// The choice a typed answer names (match.js workScore against each
	// choice's names, 0.8 or more, one choice clearly best), else -1.
	function typed(text, round, p) {
		var q = str(text).trim(), M = getM();
		if (!q || !round || !Array.isArray(round.choices)) return -1;
		var best = -1, top = 0, tie = false;
		round.choices.forEach(function (name, i) {
			var w = p && p.byWork && has(p.byWork, name) ? p.byWork[name] : null;
			var names = w && w.aliases && w.aliases.length ? w.aliases : [name], s = 0;
			names.forEach(function (nm) { var v = M && M.workScore ? M.workScore(q, nm) : plainWorkScore(q, nm); if (v > s) s = v; });
			if (s > top) { top = s; best = i; tie = false; } else if (s > 0 && s === top) tie = true;
		});
		return top >= 0.8 && !tie ? best : -1;
	}

	// ---- A game: the state machine the page drives ---------------------------------------------

	function copyRound(r) {
		if (!r) return null;
		var o = {};
		Object.keys(r).forEach(function (k) { o[k] = r[k]; });
		o.choices = r.choices.slice();
		if (r.preview) o.preview = Object.assign({}, r.preview);
		return o;
	}
	function messageOf(e) {
		var code = e && e.code;
		if (code === 'rate') return 'Apple' + String.fromCharCode(0x2019) + 's iTunes Search asked for a pause. Try again in a minute.';
		if (code === 'network') return 'iTunes Search could not be reached. Check the connection, then try again.';
		if (code === 'server') return 'iTunes Search is having trouble. Try again in a moment.';
		if (code === 'none') return 'None of the last ' + TRIES + ' songs tried has a preview on iTunes. Try again for others.';
		return 'iTunes Search sent an answer this page could not read. Try again.';
	}
	// opts: { tracks or pool, level, rand, rounds (10), inserts, aliases, fetch,
	//         gapMs, pauseMs, retryMs, line, cache (sources.js createCache), memo, previewOk, country, now }
	// Phases: idle -> loading -> question -> answered -> (loading ->) question ... -> summary;
	// empty (fewer than four works) and error (iTunes did not answer: retry()) on the side.
	function createGame(opts) {
		opts = opts || {};
		var S = getS();
		var rand = typeof opts.rand === 'function' ? opts.rand : S && S.cryptoRng ? S.cryptoRng() : Math.random;
		var level = has(LEVELS, opts.level) ? opts.level : 'normal';
		var p = opts.pool || pool(opts.tracks || [], { inserts: opts.inserts, aliases: opts.aliases });
		var doFetch = typeof opts.fetch === 'function' ? opts.fetch : null;
		var now = typeof opts.now === 'function' ? opts.now : function () { return Date.now(); };
		var line = opts.line || makeLine({ gapMs: opts.gapMs, now: now });
		var pauseMs = opts.pauseMs != null ? Math.max(0, +opts.pauseMs || 0) : PAUSE_MS;
		var retryMs = opts.retryMs != null ? Math.max(0, +opts.retryMs || 0) : RETRY_MS;
		var cache = opts.cache && typeof opts.cache.wrap === 'function' ? opts.cache : null;
		var memo = opts.memo && typeof opts.memo === 'object' ? opts.memo : {};
		var pvOk = typeof opts.previewOk === 'function' ? opts.previewOk : okPreview;
		var country = /^[A-Za-z]{2}$/.test(str(opts.country)) ? str(opts.country).toUpperCase() : COUNTRY;
		var st = { phase: 'idle', total: opts.rounds > 0 ? Math.floor(opts.rounds) : ROUNDS, index: -1, score: score(null), error: '', skipped: 0, tried: 0, asked: 0 };
		var cur = null, queue = [], history = [], used = { ids: {}, songs: {}, works: {} };
		var preparing = false, fails = 0, exhausted = false, stopped = false, timer = 0, subs = [], waiters = [];

		function snapshot() {
			return {
				phase: st.phase, level: level, total: st.total, index: st.index, played: history.length, score: score(st.score),
				error: st.error, skipped: st.skipped, tried: st.tried, asked: st.asked, waitMs: Math.max(0, line.pausedUntil() - now()),
				round: copyRound(cur)
			};
		}
		function emit() {
			var s = snapshot();
			if (s.phase !== 'loading') { var w = waiters; waiters = []; w.forEach(function (f) { f(s); }); }
			subs.slice().forEach(function (f) { try { f(s); } catch (e) { setTimeout(function () { throw e; }, 0); } });
		}
		function ready() {
			var s = snapshot();
			if (s.phase !== 'loading') return Promise.resolve(s);
			return new Promise(function (res) { waiters.push(res); });
		}
		function get(url) {
			st.asked++;
			var p0;
			try { p0 = Promise.resolve(doFetch(url, FETCH_INIT)); } catch (e) { p0 = Promise.reject(e); }
			return p0.then(function (res) {
				if (!res || typeof res.status !== 'number') throw qerr('network', 'No answer.');
				if (res.status === 403 || res.status === 429) throw qerr('rate', 'HTTP ' + res.status);
				if (!res.ok) throw qerr(res.status >= 500 ? 'server' : 'bad', 'HTTP ' + res.status);
				return Promise.resolve().then(function () { return res.json(); }).then(null, function () { throw qerr('bad', 'Not JSON.'); });
			}, function (e) { throw qerr('network', str(e && e.message) || 'Failed to fetch.'); });
		}
		function checked(pv) { return pv && typeof pv === 'object' && pvOk(pv.url) ? pv : null; }
		// This song's preview: the session's memo, the cache, else iTunes (a
		// cover may get its original's). -> preview | null; rejects when iTunes fails.
		function lookup(t) {
			var key = cacheKey(t, country);
			if (has(memo, key)) return Promise.resolve(checked(memo[key]));
			function ask() {
				var terms = searchTerms(t), i = 0;
				function step() {
					if (i >= terms.length) return null;
					var term = terms[i++];
					return line.run(function () { return get(searchUrl(term, country)); }).then(function (j) {
						var res = j && Array.isArray(j.results) ? j.results : [];
						var pv = pickPreview(res, t, { ok: pvOk });
						if (!pv && t.origArtist) {
							pv = pickPreview(res, { title: t.title, titleAlt: t.titleAlt, artist: t.origArtist }, { ok: pvOk });
							if (pv) pv.original = true;
						}
						return pv || step();
					});
				}
				return Promise.resolve().then(step);
			}
			var p1 = cache ? cache.wrap(key, HIT_TTL, ask, { negTtlMs: MISS_TTL }) : ask();
			return p1.then(function (pv) { pv = checked(pv); memo[key] = pv; return pv; });
		}
		function hold(r, on) {
			if (on) {
				used.ids[r.id] = true;
				used.songs[r.song] = true;
				used.works[r.work] = (used.works[r.work] || 0) + 1;
				return;
			}
			delete used.ids[r.id];
			delete used.songs[r.song];
			used.works[r.work] = (used.works[r.work] || 0) - 1;
			if (!(used.works[r.work] > 0)) delete used.works[r.work];
		}
		// One round with a preview. A song without one is left out for the
		// game (its work may still come); after TRIES of them it gives up.
		function prepareOne() {
			st.tried = 0;
			function attempt() {
				if (stopped) return Promise.resolve(null);
				var r = makeRound(p, rand, { level: level, avoid: used });
				if (!r) return Promise.resolve(null);
				hold(r, true);
				st.tried++;
				return lookup(p.byId[r.id]).then(function (pv) {
					if (stopped) return null;
					if (pv) { r.preview = pv; return r; }
					st.skipped++;
					hold(r, false);
					used.ids[r.id] = true;
					used.songs[r.song] = true;
					if (st.tried >= TRIES) throw qerr('none', 'No previews.');
					emit();
					return attempt();
				}, function (e) { hold(r, false); throw e; });
			}
			return attempt();
		}
		// Rounds still wanted in the queue: the one the page waits for, and AHEAD more.
		function want() {
			var left = st.total - history.length - (cur ? 1 : 0);
			return Math.min(left, cur ? AHEAD : AHEAD + 1);
		}
		function fill() {
			if (preparing || stopped || exhausted || fails >= FAILS) return;
			if (st.phase === 'idle' || st.phase === 'empty' || st.phase === 'summary') return;
			if (queue.length >= want()) return;
			preparing = true;
			prepareOne().then(function (r) {
				preparing = false;
				if (stopped) return;
				fails = 0;
				st.error = '';
				if (r) queue.push(r); else exhausted = true;
				advance();
				fill();
			}, function (e) {
				preparing = false;
				if (stopped) return;
				if (e && e.code === 'rate') line.pause(pauseMs);
				fails = e && e.code === 'none' ? FAILS : fails + 1;
				if (fails >= FAILS) {
					st.error = messageOf(e);
					if (st.phase === 'loading') st.phase = 'error';
					emit();
					return;
				}
				timer = setTimeout(fill, e && e.code === 'rate' ? 0 : retryMs * fails);
				emit();
			});
		}
		// The page waits for a round: give it the next one, or end the game
		// early when the pool has no more songs with previews.
		function advance() {
			if (st.phase === 'loading') {
				if (queue.length) {
					cur = queue.shift();
					st.index = history.length;
					st.phase = 'question';
				} else if (exhausted && !preparing) {
					if (history.length) { finish(); return; }
					st.phase = 'error';
					st.error = 'None of these songs has a preview on iTunes.';
				} else if (fails >= FAILS) st.phase = 'error';
			}
			emit();
		}
		function finish() {
			cur = null;
			queue = [];
			st.total = Math.min(st.total, history.length);
			st.phase = 'summary';
			clearTimeout(timer);
			emit();
		}
		var api = {
			// Look the first rounds up. -> Promise<state> once the first round is there (or empty, or error)
			start: function () {
				if (st.phase !== 'idle') return ready();
				if (!p.ok) { st.phase = 'empty'; emit(); return ready(); }
				if (!doFetch) { st.phase = 'error'; st.error = 'This browser cannot ask iTunes for previews.'; emit(); return ready(); }
				st.phase = 'loading';
				st.index = 0;
				emit();
				fill();
				return ready();
			},
			// The current round, a copy: { id, work, title, artist, role, roleLabel, choices, answer, startSec, clipSec, preview, ... }
			round: function () { return copyRound(cur); },
			// choice: an index into round().choices, or a work's name; ms: how long the answer took.
			// -> the round with chosen, right, points, ms; null when no question is open
			answer: function (choice, ms) {
				if (st.phase !== 'question' || !cur) return null;
				var i = typeof choice === 'number' ? Math.floor(choice) : cur.choices.indexOf(str(choice));
				if (!(i >= 0 && i < cur.choices.length)) return null;
				var right = i === cur.answer;
				st.score = score(st.score, right, ms);
				cur.chosen = i;
				cur.right = right;
				cur.points = st.score.last;
				cur.ms = +ms > 0 ? Math.round(+ms) : 0;
				history.push(copyRound(cur));
				st.phase = 'answered';
				emit();
				fill();
				return copyRound(cur);
			},
			// The next round, or the summary after the last. -> Promise<state> once it is there
			next: function () {
				if (st.phase !== 'answered') return ready();
				cur = null;
				if (history.length >= st.total) { finish(); return ready(); }
				st.phase = 'loading';
				st.index = history.length;
				advance();
				fill();
				return ready();
			},
			// The clip of the current round would not play: another song in its place.
			skip: function () {
				if (st.phase !== 'question' || !cur) return ready();
				var r = cur;
				cur = null;
				st.skipped++;
				hold(r, false);
				used.ids[r.id] = true;
				used.songs[r.song] = true;
				var key = cacheKey(p.byId[r.id], country);
				memo[key] = null;
				if (cache && typeof cache.put === 'function') cache.put(key, null, MISS_TTL);
				st.phase = 'loading';
				advance();
				fill();
				return ready();
			},
			// After an error: look again.
			retry: function () {
				if (st.phase !== 'error') return ready();
				fails = 0;
				st.error = '';
				exhausted = false;
				st.phase = 'loading';
				advance();
				fill();
				return ready();
			},
			stop: function () { stopped = true; clearTimeout(timer); queue = []; },
			state: snapshot,
			ready: ready,
			pool: function () { return p; },
			// -> { level, rounds, played, right, wrong, points, best, skipped, missed: [round], history: [round] }
			summary: function () {
				var s = st.score;
				return {
					level: level, rounds: st.total, played: history.length, right: s.right, wrong: s.wrong, points: s.points, best: s.best, skipped: st.skipped,
					missed: history.filter(function (r) { return !r.right; }).map(copyRound), history: history.map(copyRound)
				};
			},
			// fn(state) after every change. -> off()
			on: function (fn) {
				subs.push(fn);
				return function () { subs = subs.filter(function (f) { return f !== fn; }); };
			}
		};
		return api;
	}

	// ---- The page (browser only) ------------------------------------------------------------------

	var HUE = { h: 330, s: 45 };
	var DOT = String.fromCharCode(0xB7), ELL = String.fromCharCode(0x2026), RSQ = String.fromCharCode(0x2019);
	var cx = null, game = null, ui = null, drawn = '', wired = false, wiredPlayer = false, wiredBus = false, kept = null, levelFrom = '', itLine = null, bestAtStart = null, typedDraft = '';
	var memoAll = {};
	var conf = { fetch: null, gapMs: GAP_MS, pauseMs: PAUSE_MS, rand: null, previewOk: null };
	var clip = { el: null, key: '', from: 0, until: 0, extra: 0, heardAt: 0, shownAt: 0, timer: 0, pending: null, blocked: false, pausedAppAt: 0 };

	// Tests and drive scripts: { fetch, gapMs, pauseMs, rand, previewOk, forget }. -> what is set
	function configure(o) {
		o = o || {};
		if ('fetch' in o) conf.fetch = typeof o.fetch === 'function' ? o.fetch : null;
		if (o.gapMs != null) { conf.gapMs = Math.max(0, +o.gapMs || 0); itLine = null; }
		if (o.pauseMs != null) conf.pauseMs = Math.max(0, +o.pauseMs || 0);
		if ('rand' in o) conf.rand = typeof o.rand === 'function' ? o.rand : null;
		if ('previewOk' in o) conf.previewOk = typeof o.previewOk === 'function' ? o.previewOk : null;
		if (o.forget) memoAll = {};
		return { fetch: !!conf.fetch, gapMs: conf.gapMs, pauseMs: conf.pauseMs, rand: !!conf.rand, previewOk: !!conf.previewOk };
	}
	function sharedLine() { if (!itLine) itLine = makeLine({ gapMs: conf.gapMs }); return itLine; }
	function kit() { return root.ToyKit || null; }
	function loadPref(key, fb) { var K = kit(); return K && K.load ? K.load(key, fb) : fb; }
	function savePref(key, v) { var K = kit(); if (K && K.store) K.store(key, v); }
	function levelPref() { var v = loadPref('quizLevel', 'normal'); return has(LEVELS, v) ? v : 'normal'; }
	function insertsPref() { return loadPref('quizInserts', false) === true; }
	// The best ever, kept under quizBest: { streak, points: { easy, normal, hard }, games }.
	function bestOf() {
		var v = loadPref('quizBest', null), out = { streak: 0, points: { easy: 0, normal: 0, hard: 0 }, games: 0 };
		if (typeof v === 'number') out.streak = Math.max(0, Math.floor(v) || 0);
		else if (v && typeof v === 'object') {
			out.streak = Math.max(0, Math.floor(+v.streak) || 0);
			out.games = Math.max(0, Math.floor(+v.games) || 0);
			if (v.points && typeof v.points === 'object') LEVEL_KEYS.forEach(function (k) { out.points[k] = Math.max(0, Math.floor(+v.points[k]) || 0); });
		}
		return out;
	}
	function keepStreak(s) { var b = bestOf(); if (s && s.best > b.streak) { b.streak = s.best; savePref('quizBest', b); } }
	function keepGame(sum) {
		var b = bestOf();
		if (sum.points > (b.points[sum.level] || 0)) b.points[sum.level] = sum.points;
		if (sum.best > b.streak) b.streak = sum.best;
		b.games++;
		savePref('quizBest', b);
	}
	function onQuizRoute() { var hs = root.location ? str(root.location.hash) : ''; return /^#\/quiz(?:[\/?]|$)/.test(hs); }
	function scoped() {
		var ix = cx.idx ? cx.idx() : null;
		return ix && Array.isArray(ix.all) ? ix.all : cx.L.list(cx.lib());
	}
	function currentPool(ins) { return pool(scoped(), { inserts: ins }); }
	function roundKey(r) { return r ? r.id + '@' + (r.choices || []).join('|') : ''; }
	function stamp(s) { return s ? s.phase + ':' + s.index + ':' + (s.round ? roundKey(s.round) : '') : 'setup'; }

	// ---- The clip -------------------------------------------------------------------------------

	function audioEl() {
		if (clip.el) return clip.el;
		var a = new Audio();
		a.preload = 'auto';
		a.addEventListener('loadedmetadata', function () { var f = clip.pending; clip.pending = null; if (f) f(); });
		a.addEventListener('playing', function () { if (!clip.heardAt) clip.heardAt = Date.now(); clip.blocked = false; paint(); });
		a.addEventListener('pause', paint);
		a.addEventListener('ended', paint);
		a.addEventListener('error', onAudioError);
		clip.el = a;
		return a;
	}
	// YouTube's player stops while a clip plays.
	function pauseApp() {
		var p = cx && cx.player ? cx.player() : null;
		if (!p || typeof p.state !== 'function') return;
		var s = p.state();
		if (s === 'playing' || s === 'loading') {
			clip.pausedAppAt = Date.now();
			try { p.pause(); } catch (e) { /* the player is gone */ }
		}
	}
	function playEl(a) {
		var pr;
		if (cx && cx.bus && cx.bus.emit) cx.bus.emit('audio', { by: 'quiz' });
		try { pr = a.play(); } catch (e) { pr = Promise.reject(e); }
		if (pr && typeof pr.then === 'function') {
			pr.then(function () { clip.blocked = false; paint(); }, function (e) {
				if (e && e.name === 'NotAllowedError') { clip.blocked = true; paint(); }
				// AbortError: a newer clip or a pause came first; a broken file fires 'error'
			});
		}
		tick();
	}
	// The round's clip from its start, for its length and the seconds asked for since.
	function startClip() {
		var r = game ? game.round() : null;
		if (!r || !r.preview || !onQuizRoute()) return;
		if (roundKey(r) !== clip.key) newRound(r, false);
		var a = audioEl(), len = r.clipSec + clip.extra;
		pauseApp();
		function go() {
			var d = a.duration, from = r.startSec;
			if (isFinite(d) && d > 0 && from + len > d) from = Math.max(0, d - len);
			clip.from = from;
			clip.until = from + len;
			try { a.currentTime = from; } catch (e) { /* not seekable yet: it starts at 0 */ }
			playEl(a);
		}
		if (a.getAttribute('src') !== r.preview.url) { a.src = r.preview.url; clip.pending = go; tick(); }
		else if (a.readyState >= 1) { clip.pending = null; go(); }
		else { clip.pending = go; tick(); }
		paint();
	}
	function newRound(r, autoplay) {
		stopClip();
		clip.key = roundKey(r);
		clip.extra = 0;
		clip.from = 0;
		clip.until = 0;
		clip.heardAt = 0;
		clip.shownAt = Date.now();
		clip.blocked = false;
		typedDraft = '';
		if (autoplay && onQuizRoute() && ui && ui.root.isConnected) startClip();
	}
	function clipEnd() { var a = clip.el; return a && isFinite(a.duration) && a.duration > 0 ? a.duration : 30; }
	function canMore(r) { return !!r && !!r.preview && (clip.until ? clip.from : r.startSec) + r.clipSec + clip.extra < clipEnd() - 0.25; }
	// "Give me 5 more seconds": a playing clip runs on; a stopped one goes on from where it stopped.
	function moreSeconds() {
		var r = game ? game.round() : null, a = clip.el;
		if (!canMore(r)) return;
		clip.extra += MORE_SEC;
		if (!a || a.getAttribute('src') !== r.preview.url || !clip.until) { startClip(); return; }
		var d = clipEnd();
		if (!a.paused) { clip.until = Math.min(d, clip.until + MORE_SEC); paint(); return; }
		var at = a.currentTime;
		if (!(at >= clip.from) || at >= d - 0.25) { startClip(); return; }
		pauseApp();
		clip.until = Math.min(d, at + MORE_SEC);
		playEl(a);
		paint();
	}
	function stopClip() {
		clip.pending = null;
		if (clip.el && !clip.el.paused) clip.el.pause();
		if (clip.timer) { clearInterval(clip.timer); clip.timer = 0; }
		paint();
	}
	function tick() {
		if (clip.timer) return;
		clip.timer = setInterval(function () {
			var a = clip.el;
			if (!a) return;
			if (!a.paused && clip.until && a.currentTime >= clip.until - 0.04) a.pause();
			paintMeter();
			if (a.paused && !clip.pending) { clearInterval(clip.timer); clip.timer = 0; }
		}, 80);
	}
	function onAudioError() {
		var a = clip.el;
		clip.pending = null;
		if (!a || !game) return;
		var r = game.round(), s = game.state();
		if (!r || !r.preview || r.preview.url !== a.getAttribute('src')) { paint(); return; }
		if (s.phase === 'question') {
			announce('That clip would not play, so here is another song.');
			game.skip();
		} else paint();
	}
	// The app's player started: the clip stops (unless it is the echo of the pause just sent).
	function onPlayerState(e) {
		if (!e || (e.state !== 'playing' && e.state !== 'loading')) return;
		if (!clip.pending && !(clip.el && !clip.el.paused)) return;
		if (Date.now() - clip.pausedAppAt < ECHO_MS) { pauseApp(); return; }
		stopClip();
	}

	// ---- Drawing --------------------------------------------------------------------------------

	var CSS = [
		'.ts-quiz { --qz-ok: var(--ts-ok, #1a7f37); --qz-bad: var(--kit-warn, #b3261e); }',
		'.ts-quiz-art .ts-i { width: 46%; height: 46%; fill: rgba(255, 255, 255, 0.92); }',
		// app.css gives every link its parent's colour (.ts a), which wins over a primary button's ink
		'.ts-quiz a.ts-btn--primary, .ts-quiz a.ts-btn--primary:hover { color: var(--ts-play-ink); }',
		'.ts-quiz-head.ts-hero { padding-top: 20px; padding-bottom: 14px; }',
		'.ts-quiz-head .ts-hero-title { font-size: clamp(24px, 4.4cqi, 40px); }',
		'.ts-quiz-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 18px; margin: 14px 0 4px; font-size: 14px; color: var(--text); }',
		'.ts-quiz-bar b { color: var(--heading); font-weight: 750; font-variant-numeric: tabular-nums; }',
		'.ts-quiz-dots { display: inline-flex; flex-wrap: wrap; gap: 5px; }',
		'.ts-quiz-dots i { width: 10px; height: 10px; border-radius: 50%; background: var(--border-strong); }',
		'.ts-quiz-dots i.is-right { background: var(--qz-ok); }',
		'.ts-quiz-dots i.is-wrong { background: var(--qz-bad); }',
		'.ts-quiz-dots i.is-now { background: transparent; box-shadow: inset 0 0 0 2px var(--accent); }',
		'.ts-quiz-q { margin: 16px 0 10px; font-size: 20px; color: var(--heading); letter-spacing: -0.01em; }',
		'.ts-quiz-q:focus, .ts-quiz-score:focus { outline: none; }',
		'.ts-quiz-listen { display: flex; flex-direction: column; gap: 12px; padding: 14px 16px; border: 1px solid var(--border); border-radius: 14px; background: var(--surface); }',
		'.ts-quiz-listen.is-loading { flex-direction: row; align-items: center; min-height: 52px; color: var(--text-2); font-weight: 600; }',
		'.ts-quiz-track { display: flex; align-items: center; gap: 12px; }',
		'.ts-quiz-eq { display: inline-flex; align-items: flex-end; gap: 3px; width: 34px; height: 26px; flex: none; }',
		'.ts-quiz-eq i { flex: 1; height: 25%; border-radius: 2px; background: var(--accent); opacity: 0.5; }',
		'.ts-quiz-listen.is-playing .ts-quiz-eq i { opacity: 1; animation: ts-quiz-eq 0.8s ease-in-out infinite alternate; }',
		'.ts-quiz-listen.is-playing .ts-quiz-eq i:nth-child(2) { animation-delay: -0.5s; }',
		'.ts-quiz-listen.is-playing .ts-quiz-eq i:nth-child(3) { animation-delay: -0.2s; }',
		'.ts-quiz-listen.is-playing .ts-quiz-eq i:nth-child(4) { animation-delay: -0.65s; }',
		'.ts-quiz-listen.is-playing .ts-quiz-eq i:nth-child(5) { animation-delay: -0.35s; }',
		'@keyframes ts-quiz-eq { from { height: 18%; } to { height: 100%; } }',
		'.ts-quiz-meter { position: relative; flex: 1; height: 6px; border-radius: 3px; background: var(--border); overflow: hidden; }',
		'.ts-quiz-meter i { position: absolute; left: 0; top: 0; bottom: 0; width: 0; border-radius: 3px; background: var(--accent); }',
		'.ts-quiz-secs { flex: none; min-width: 3em; text-align: right; font-size: 13px; font-weight: 700; color: var(--text-2); font-variant-numeric: tabular-nums; }',
		'.ts-quiz-btns { display: flex; flex-wrap: wrap; gap: 8px; }',
		'.ts-quiz-note { margin: 0; font-size: 13.5px; color: var(--text-2); }',
		'.ts-quiz-note:empty { display: none; }',
		'.ts-quiz-choices { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin: 16px 0 12px; }',
		'.ts-btn.ts-quiz-choice { height: auto; min-height: 64px; padding: 10px 16px 10px 12px; justify-content: flex-start; gap: 12px; border-radius: 16px; border-color: var(--border-strong); background: var(--surface); color: var(--heading); font-size: 16px; font-weight: 650; line-height: 1.25; text-align: left; white-space: normal; }',
		'.ts-btn.ts-quiz-choice .ts-btn-label { overflow: visible; text-overflow: clip; overflow-wrap: anywhere; }',
		'.ts-btn.ts-quiz-choice:hover:not(:disabled) { background: var(--ts-hover); border-color: var(--text-2); }',
		'.ts-btn.ts-quiz-choice:active:not(:disabled) { transform: scale(0.99); }',
		'.ts-btn.ts-quiz-choice:disabled { opacity: 1; cursor: default; }',
		'.ts-quiz-key { display: inline-flex; align-items: center; justify-content: center; flex: none; width: 30px; height: 30px; border-radius: 50%; border: 1px solid var(--border-strong); background: var(--bg); color: var(--text-2); font-size: 13px; font-weight: 750; }',
		'.ts-btn.ts-quiz-choice.is-right { border-color: var(--qz-ok); background: color-mix(in srgb, var(--qz-ok) 14%, var(--surface)); }',
		'.ts-btn.ts-quiz-choice.is-wrong { border-color: var(--qz-bad); background: color-mix(in srgb, var(--qz-bad) 12%, var(--surface)); }',
		'.ts-btn.ts-quiz-choice.is-right .ts-quiz-key { background: var(--qz-ok); border-color: var(--qz-ok); color: var(--bg); }',
		'.ts-btn.ts-quiz-choice.is-wrong .ts-quiz-key { background: var(--qz-bad); border-color: var(--qz-bad); color: var(--bg); }',
		'.ts-btn.ts-quiz-choice.is-dim { opacity: 0.55; }',
		'.ts-btn.ts-quiz-choice .ts-quiz-mark { width: 22px; height: 22px; margin-left: auto; }',
		'.ts-quiz-choice.is-right .ts-quiz-mark { fill: var(--qz-ok); }',
		'.ts-quiz-choice.is-wrong .ts-quiz-mark { fill: var(--qz-bad); }',
		'@container (max-width: 520px) { .ts-quiz-choices { grid-template-columns: minmax(0, 1fr); } }',
		'@media (max-width: 520px) { .ts-quiz-choices { grid-template-columns: minmax(0, 1fr); } }',
		'.ts-quiz-type { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 10px; margin: 0 0 12px; }',
		'.ts-quiz-type label { font-weight: 650; font-size: 14px; color: var(--heading); }',
		'.ts-quiz-type .kit-input { flex: 1 1 200px; min-width: 0; min-height: 40px; font-size: 15px; }',
		'.ts-quiz-typemsg { flex-basis: 100%; margin: 0; font-size: 13.5px; color: var(--text-2); }',
		'.ts-quiz-typemsg:empty { display: none; }',
		'.ts-quiz-result { margin: 14px 0 0; padding: 14px 16px; border: 1px solid var(--border); border-radius: 14px; background: var(--surface); }',
		'.ts-quiz-result.is-right { border-color: color-mix(in srgb, var(--qz-ok) 60%, var(--border)); }',
		'.ts-quiz-result.is-wrong { border-color: color-mix(in srgb, var(--qz-bad) 55%, var(--border)); }',
		'.ts-quiz-verdict { display: flex; align-items: center; gap: 8px; margin: 0 0 6px; font-size: 21px; font-weight: 800; color: var(--heading); }',
		'.ts-quiz-verdict .ts-i { width: 26px; height: 26px; }',
		'.ts-quiz-result.is-right .ts-quiz-verdict .ts-i { fill: var(--qz-ok); }',
		'.ts-quiz-result.is-wrong .ts-quiz-verdict .ts-i { fill: var(--qz-bad); }',
		'.ts-quiz-song { margin: 0; line-height: 1.6; overflow-wrap: anywhere; }',
		'.ts-quiz-song b { color: var(--heading); }',
		'.ts-quiz-credit { margin: 4px 0 0; font-size: 13px; }',
		'.ts-quiz-result .ts-row-btns { margin: 12px 0 0; }',
		'.ts-quiz-foot { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 16px; margin: 18px 0 0; font-size: 13px; }',
		'.ts-quiz-foot p { margin: 0; max-width: 70ch; }',
		'.ts-quiz-error { padding: 14px 16px; border: 1px solid var(--kit-warn-line, var(--border)); border-radius: 14px; background: var(--kit-warn-soft, var(--surface)); }',
		'.ts-quiz-error p { margin: 0 0 4px; color: var(--heading); }',
		'.ts-quiz-setup { margin: 18px 0 0; max-width: 780px; }',
		'.ts-quiz-levels { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; min-width: 0; margin: 0 0 14px; padding: 0; border: 0; }',
		'.ts-quiz-levels legend { padding: 0; margin: 0 0 8px; font-weight: 700; color: var(--heading); }',
		'.ts-quiz-level { display: grid; grid-template-columns: auto 1fr; align-items: center; align-content: start; gap: 4px 10px; padding: 12px 14px; border: 1px solid var(--border-strong); border-radius: 14px; background: var(--surface); cursor: pointer; }',
		'.ts-quiz-level:hover { background: var(--ts-hover); }',
		'.ts-quiz-level input { margin: 0; width: 18px; height: 18px; accent-color: var(--accent); }',
		'.ts-quiz-level-name { font-size: 16px; font-weight: 750; color: var(--heading); }',
		'.ts-quiz-level-blurb { grid-column: 1 / -1; font-size: 13px; line-height: 1.4; color: var(--text-2); }',
		'.ts-quiz-level.is-on { border-color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent); }',
		'.ts-quiz-level:focus-within { outline: 2px solid var(--accent); outline-offset: 2px; }',
		'@container (max-width: 600px) { .ts-quiz-levels { grid-template-columns: minmax(0, 1fr); } }',
		'@media (max-width: 600px) { .ts-quiz-levels { grid-template-columns: minmax(0, 1fr); } }',
		'.ts-quiz-small { margin: 10px 0 0; font-size: 13px; max-width: 70ch; }',
		'.ts-quiz-empty { margin: 18px 0 0; max-width: 70ch; }',
		'.ts-quiz-empty h2 { margin: 0 0 8px; font-size: 20px; color: var(--heading); }',
		'.ts-quiz-final { margin: 22px 0 6px; }',
		'.ts-quiz-score { margin: 0; font-size: clamp(44px, 11cqi, 84px); line-height: 1; font-weight: 800; letter-spacing: -0.03em; color: var(--heading); }',
		'.ts-quiz-sub { margin: 10px 0 0; font-size: 17px; font-weight: 650; color: var(--heading); }',
		'.ts-quiz-stats { margin: 6px 0 0; color: var(--text); }',
		'.ts-quiz-stats b { color: var(--heading); }',
		'.ts-quiz-news { display: flex; flex-wrap: wrap; gap: 6px; margin: 10px 0 0; }',
		'.ts-quiz-missed { list-style: none; margin: 0; padding: 0; }',
		'.ts-quiz-missed li { display: flex; align-items: center; gap: 12px; padding: 10px 2px; border-bottom: 1px solid var(--border); }',
		'.ts-quiz-mtext { flex: 1; min-width: 0; line-height: 1.5; overflow-wrap: anywhere; }',
		'.ts-quiz-mtext b { color: var(--heading); }',
		'@media (prefers-reduced-motion: reduce) { .ts-quiz-listen.is-playing .ts-quiz-eq i { animation: none; height: 70%; } }',
		'html.is-reduced .ts-quiz-listen.is-playing .ts-quiz-eq i { animation: none; height: 70%; }'
	].join('\n');
	function injectCss() {
		var d = root.document;
		if (!d || d.getElementById('ts-quiz-css')) return;
		var s = d.createElement('style');
		s.id = 'ts-quiz-css';
		s.textContent = CSS;
		d.head.appendChild(s);
	}
	function wire() {
		if (!wired) {
			wired = true;
			root.addEventListener('hashchange', function () { if (!onQuizRoute()) stopClip(); });
			root.addEventListener('pagehide', stopClip);
			root.document.addEventListener('keydown', onKey, true);
		}
		if (!wiredBus && cx.bus && cx.bus.on) { cx.bus.on('audio', function (e) { if (!e || e.by !== 'quiz') stopClip(); }); wiredBus = true; }
		if (!wiredPlayer && cx.player) {
			var p = cx.player();
			if (p && typeof p.on === 'function') { p.on('state', onPlayerState); wiredPlayer = true; }
		}
	}
	// 1 to 4 choose, Space plays the clip again, Enter goes on. A text field
	// keeps its keys; a control outside the game keeps Space and Enter.
	function onKey(e) {
		if (!game || !ui || !ui.root.isConnected || !onQuizRoute()) return;
		if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
		if (cx.U && cx.U.dialogOpen && cx.U.dialogOpen()) return;
		var t = e.target, tag = (t && t.tagName) || '';
		if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag) || (t && t.isContentEditable)) return;
		var ctl = tag === 'BUTTON' || tag === 'A' || tag === 'SUMMARY', mine = !!t && ui.root.contains(t);
		var ph = game.state().phase, k = e.key;
		function take() { e.preventDefault(); e.stopPropagation(); }
		if (/^[1-4]$/.test(k) && ph === 'question') { take(); choose(+k - 1); return; }
		if (ctl && !mine) return;
		if ((k === ' ' || k === 'Spacebar') && (ph === 'question' || ph === 'answered')) { take(); startClip(); return; }
		if (k === 'Enter' && ph === 'answered') {
			if (ctl && t !== ui.next) return;
			take();
			goNext();
		}
	}
	function announce(text) {
		if (!ui || !ui.live) return;
		var live = ui.live;
		live.textContent = '';
		setTimeout(function () { live.textContent = text; }, 60);
	}

	// view(view, ctx, parts, query): app.js routes #/quiz here. A game in
	// progress survives a redraw and a visit elsewhere; its clip does not.
	function view(el, ctx, parts, query) {
		cx = ctx;
		injectCss();
		wire();
		// #/quiz?level=hard picks the level once per address (a redraw keeps the reader's own choice)
		var lv = query && typeof query.get === 'function' ? query.get('level') : '', here = root.location ? str(root.location.hash) : '';
		if (lv && has(LEVELS, lv) && here !== levelFrom) savePref('quizLevel', lv);
		levelFrom = here;
		var h = ctx.h;
		var box = h('div', { class: 'ts-quiz' });
		var live = h('p', { class: 'kit-sr', role: 'status', aria: { live: 'polite' } });
		var body = h('div', { class: 'ts-quiz-body' });
		box.appendChild(live);
		box.appendChild(body);
		el.appendChild(box);
		ui = { root: box, live: live, body: body, choices: [] };
		draw(false);
	}
	function draw(move) {
		if (!ui || !cx) return;
		var s = game ? game.state() : null, ph = s ? s.phase : 'setup';
		cx.clear(ui.body);
		ui.choices = [];
		ui.next = ui.play = ui.more = ui.meter = ui.secs = ui.listen = ui.note = ui.q = ui.wait = ui.start = ui.final = null;
		if (!s || ph === 'idle' || ph === 'empty') drawSetup(ui.body);
		else if (ph === 'summary') drawSummary(ui.body);
		else drawRound(ui.body, s);
		drawn = s ? stamp(s) : 'setup';
		if (move) {
			var to = ph === 'answered' ? ui.next : ph === 'summary' ? ui.final : (ph === 'question' || ph === 'loading' || ph === 'error') ? ui.q : ui.start;
			if (to) { try { to.focus(); } catch (e) { /* gone */ } }
		}
		paint();
	}
	function onGame(s) {
		if (!ui) return;
		var changed = stamp(s) !== drawn;
		if (!changed) { if (ui.wait) ui.wait.textContent = waitText(s); return; }
		var shown = ui.root.isConnected;
		if (shown) draw(true);
		if (s.phase === 'question' && s.round && roundKey(s.round) !== clip.key) newRound(s.round, shown);
		if (s.phase === 'question') announce('Round ' + (s.index + 1) + ' of ' + s.total + '. Which anime is this from?');
		else if (s.phase === 'answered' && s.round) announce(verdictWords(s.round));
		else if (s.phase === 'summary') { var sum = game.summary(); if (kept !== game) { kept = game; keepGame(sum); } announce('Game over: ' + sum.right + ' of ' + sum.played + ' right, ' + sum.points + ' points.'); }
		else if (s.phase === 'error') announce(s.error);
	}
	function verdictWords(r) {
		var song = r.title + ' by ' + r.artist + (r.roleLabel ? ', ' + r.roleLabel : '');
		return r.right ? 'Right! ' + song + ', from ' + r.work + '. ' + r.points + ' points.' : 'Not quite. It was ' + r.work + ': ' + song + '.';
	}
	function waitText(s) {
		if (s.waitMs > 1500) return 'iTunes asked for a pause; the next clip comes in about ' + Math.ceil(s.waitMs / 1000) + ' seconds' + ELL;
		if (s.tried > 1) return 'Looking for a song with a preview (' + s.tried + ' tried)' + ELL;
		return 'Getting the clip' + ELL;
	}
	function quizArt() {
		var a = cx.h('span', { class: 'ts-art ts-art-gen ts-hero-art ts-quiz-art', aria: { hidden: 'true' }, style: { '--h': String(HUE.h), '--s': '55%' } });
		a.appendChild(cx.icon('tv'));
		return a;
	}
	function newGame() {
		stopClip();
		if (game) game.stop();
		game = null;
		var p = currentPool(insertsPref());
		if (!p.ok) { draw(true); return; }
		bestAtStart = bestOf();
		clip.key = '';
		game = createGame({
			pool: p, level: levelPref(), rand: conf.rand || (cx.S && cx.S.cryptoRng ? cx.S.cryptoRng() : null),
			fetch: conf.fetch || (typeof root.fetch === 'function' ? function (u, o) { return root.fetch(u, o); } : null),
			line: sharedLine(), pauseMs: conf.pauseMs, cache: cx.cache ? cx.cache() : null, memo: memoAll, previewOk: conf.previewOk
		});
		game.on(onGame);
		game.start();
		if (stamp(game.state()) !== drawn) draw(true);
	}
	function quit() {
		stopClip();
		if (game) game.stop();
		game = null;
		clip.key = '';
		draw(true);
	}
	function choose(i) {
		if (!game || game.state().phase !== 'question') return;
		var since = clip.heardAt || clip.shownAt || Date.now();
		// a playing clip goes on a little as the answer shows
		if (clip.el && !clip.el.paused && clip.until) clip.until = Math.min(clipEnd(), clip.until + 10);
		var r = game.answer(i, Date.now() - since);
		if (r) keepStreak(game.state().score);
	}
	function goNext() {
		if (!game || game.state().phase !== 'answered') return;
		stopClip();
		game.next();
	}
	function playFull(id) { stopClip(); cx.play.now([id]); }

	// The parts of the clip box that change while it plays.
	function paint() {
		if (!ui || !ui.listen) return;
		var a = clip.el, on = !!clip.pending || (!!a && !a.paused), r = game ? game.round() : null;
		ui.listen.classList.toggle('is-playing', on);
		if (ui.play) cx.U.btnState(ui.play, { label: clip.heardAt && !clip.blocked ? 'Play again' : 'Play the clip', icon: clip.heardAt && !clip.blocked ? 'retry' : 'play' });
		if (ui.more) cx.U.btnState(ui.more, { disabled: !canMore(r) });
		if (ui.note) ui.note.textContent = clip.blocked ? 'This browser wants a press before it plays sound: press Play the clip.' : '';
		paintMeter();
	}
	function paintMeter() {
		if (!ui || !ui.meter) return;
		var a = clip.el, r = game ? game.round() : null, at = 0;
		if (a && clip.until > clip.from && r && r.preview && a.getAttribute('src') === r.preview.url) at = Math.max(0, Math.min(1, (a.currentTime - clip.from) / (clip.until - clip.from)));
		ui.meter.firstChild.style.width = (at * 100).toFixed(1) + '%';
		if (ui.secs && r) ui.secs.textContent = (r.clipSec + clip.extra) + ' s';
	}

	function plural(k, one, many) {
		if (cx && cx.words && cx.words.plural) return cx.words.plural(k, one, many);
		return k + ' ' + (k === 1 ? one : (many || one + 's'));
	}
	function drawSetup(c) {
		var h = cx.h, U = cx.U, ins = insertsPref(), lv = levelPref(), p = currentPool(ins), best = bestOf();
		cx.ui.headerBlock(c, {
			kicker: 'A game', title: 'Guess the anime', hue: HUE, artNode: quizArt(),
			blurb: 'A few seconds of an opening or an ending from your library, and four anime to choose from. Ten rounds. No video, so nothing on screen gives it away.',
			meta: p.works.length ? plural(p.works.length, 'anime, game or show', 'anime, games and shows') + ' ' + DOT + ' ' + plural(p.songs, 'song') : ''
		});
		if (!p.ok) { drawEmpty(c, p, ins); return; }
		var form = h('form', { class: 'ts-quiz-setup' });
		var fs = h('fieldset', { class: 'ts-quiz-levels' }, [h('legend', { text: 'How hard' })]);
		LEVEL_KEYS.forEach(function (k) {
			var inp = h('input', { type: 'radio', name: 'qz-level', value: k, checked: k === lv, data: { id: 'qz-level-' + k } });
			var lab = h('label', { class: 'ts-quiz-level' + (k === lv ? ' is-on' : '') }, [inp, h('span', { class: 'ts-quiz-level-name', text: LEVELS[k].name }), h('span', { class: 'ts-quiz-level-blurb', text: LEVELS[k].blurb })]);
			inp.addEventListener('change', function () {
				if (!inp.checked) return;
				savePref('quizLevel', k);
				Array.prototype.forEach.call(fs.querySelectorAll('.ts-quiz-level'), function (x) { x.classList.toggle('is-on', x === lab); });
			});
			fs.appendChild(lab);
		});
		form.appendChild(fs);
		var cb = h('input', { type: 'checkbox', checked: ins, data: { id: 'qz-inserts' } });
		cb.addEventListener('change', function () {
			savePref('quizInserts', cb.checked);
			draw(false);
			var again = ui && ui.body.querySelector('[data-id="qz-inserts"]');
			if (again) again.focus();
		});
		form.appendChild(h('label', { class: 'ts-check' }, [cb, h('span', { text: 'Count insert songs too' })]));
		ui.start = U.btn({ icon: 'play', label: 'Start', variant: 'primary', size: 'xl', data: { id: 'qz-start' } });
		ui.start.type = 'submit';
		form.appendChild(h('div', { class: 'ts-row-btns' }, [ui.start]));
		form.addEventListener('submit', function (e) { e.preventDefault(); newGame(); });
		c.appendChild(form);
		var bests = LEVEL_KEYS.filter(function (k) { return best.points[k] > 0; }).map(function (k) { return LEVELS[k].name + ' ' + best.points[k]; });
		if (best.streak || bests.length) c.appendChild(h('p', { class: 'ts-quiz-small ts-muted', text: 'Your best streak: ' + best.streak + (bests.length ? '. Best scores: ' + bests.join(', ') + '.' : '.') }));
		c.appendChild(h('p', { class: 'ts-quiz-small ts-muted', text: 'Keys: 1 to 4 choose, Space plays the clip again, Enter goes on. Start asks Apple' + RSQ + 's iTunes Search for the clips: it sends the artist and title of each song, nothing else.' + (cx.demo ? ' The demo' + RSQ + 's songs are invented, so iTunes has no clips of them.' : '') }));
	}
	function drawEmpty(c, p, ins) {
		var h = cx.h, U = cx.U, w = p.works;
		var box = h('section', { class: 'ts-quiz-empty' });
		box.appendChild(h('h2', { text: 'Not enough to play yet' }));
		box.appendChild(h('p', { text: 'The game asks about openings and endings from at least ' + MIN_WORKS + ' different anime, games or shows: songs labelled with the work they are from and the role OP or ED, and with an artist.' }));
		var have = !w.length ? 'There are none of those here yet.'
			: w.length === 1 ? 'Here: ' + plural(p.songs, 'such song') + ', all from ' + w[0].name + '.'
			: 'Here: ' + plural(p.songs, 'such song') + ' from ' + w.slice(0, -1).map(function (x) { return x.name; }).join(', ') + ' and ' + w[w.length - 1].name + '.';
		box.appendChild(h('p', { class: 'ts-muted', text: have }));
		var row = h('div', { class: 'ts-row-btns' });
		row.appendChild(U.btn({ icon: 'edit', label: 'Quick labeller', variant: 'primary', href: '#/label' }));
		row.appendChild(U.btn({ icon: 'works', label: 'Anime, games & stage', variant: 'secondary', href: '#/works' }));
		if (!ins && currentPool(true).ok) row.appendChild(U.btn({ icon: 'plus', label: 'Count insert songs too', variant: 'secondary', on: { click: function () { savePref('quizInserts', true); draw(true); } } }));
		box.appendChild(row);
		c.appendChild(box);
	}
	function drawRound(c, s) {
		var h = cx.h, r = game.round(), ph = s.phase;
		var head = cx.ui.headerBlock(c, { art: false, hue: HUE, kicker: 'Round ' + Math.min(s.index + 1, s.total) + ' of ' + s.total + ' ' + DOT + ' ' + LEVELS[s.level].name, title: 'Guess the anime' });
		head.classList.add('ts-quiz-head');
		c.appendChild(scoreBar(s));
		ui.q = h('h2', { class: 'ts-quiz-q', tabindex: '-1', text: 'Which anime is this from?' });
		c.appendChild(ui.q);
		if (ph === 'error') c.appendChild(errorBox(s));
		else {
			c.appendChild(listenBox(r, s));
			if (ph === 'answered' && r) c.appendChild(resultBox(r, s));
			if (r) c.appendChild(choiceGrid(r, ph));
			if (r && ph === 'question' && s.level === 'hard') c.appendChild(typeBox());
		}
		c.appendChild(footer());
	}
	function scoreBar(s) {
		var h = cx.h, sc = s.score, hist = game.summary().history, bar = h('div', { class: 'ts-quiz-bar' });
		var dots = h('span', { class: 'ts-quiz-dots', aria: { hidden: 'true' } });
		for (var i = 0; i < s.total; i++) dots.appendChild(h('i', { class: i < hist.length ? (hist[i].right ? 'is-right' : 'is-wrong') : i === s.index ? 'is-now' : null }));
		bar.appendChild(dots);
		bar.appendChild(h('span', null, [h('b', { text: String(sc.points) }), ' points']));
		bar.appendChild(h('span', null, ['Streak ', h('b', { text: String(sc.streak) })]));
		bar.appendChild(h('span', { class: 'ts-muted' }, ['Best streak ', h('b', { text: String(Math.max(bestOf().streak, sc.best)) })]));
		return bar;
	}
	function listenBox(r, s) {
		var h = cx.h, U = cx.U, box = h('div', { class: 'ts-quiz-listen' });
		ui.listen = box;
		if (!r) {
			box.classList.add('is-loading');
			box.appendChild(h('span', { class: 'ts-spin', aria: { hidden: 'true' } }));
			ui.wait = h('span', { text: waitText(s) });
			box.appendChild(ui.wait);
			return box;
		}
		ui.meter = h('span', { class: 'ts-quiz-meter', aria: { hidden: 'true' } }, h('i'));
		ui.secs = h('span', { class: 'ts-quiz-secs', text: (r.clipSec + clip.extra) + ' s' });
		box.appendChild(h('div', { class: 'ts-quiz-track' }, [h('span', { class: 'ts-quiz-eq', aria: { hidden: 'true' } }, [h('i'), h('i'), h('i'), h('i'), h('i')]), ui.meter, ui.secs]));
		ui.play = U.btn({ icon: 'play', label: 'Play the clip', variant: 'secondary', size: 'lg', kbd: 'Space', data: { id: 'qz-play' }, on: { click: startClip } });
		ui.more = U.btn({ icon: 'plus', label: 'Give me 5 more seconds', variant: 'ghost', size: 'lg', data: { id: 'qz-more' }, on: { click: moreSeconds } });
		box.appendChild(h('div', { class: 'ts-quiz-btns' }, [ui.play, ui.more]));
		ui.note = h('p', { class: 'ts-quiz-note' });
		box.appendChild(ui.note);
		return box;
	}
	function choiceGrid(r, ph) {
		var h = cx.h, U = cx.U, grid = h('div', { class: 'ts-quiz-choices', role: 'group', aria: { label: 'The four choices' } });
		r.choices.forEach(function (name, i) {
			var b = U.btn({ label: name, variant: 'secondary', size: 'xl', cls: 'ts-quiz-choice', data: { id: 'qz-choice-' + i }, on: { click: function () { choose(i); } } });
			b.insertBefore(h('span', { class: 'ts-quiz-key', text: String(i + 1), aria: { hidden: 'true' } }), b.firstChild);
			b.setAttribute('aria-keyshortcuts', String(i + 1));
			if (ph === 'answered') {
				b.disabled = true;
				if (i === r.answer) { b.classList.add('is-right'); b.appendChild(cx.icon('check', 'ts-quiz-mark')); b.appendChild(h('span', { class: 'kit-sr', text: ' (the answer)' })); }
				else if (i === r.chosen) { b.classList.add('is-wrong'); b.appendChild(cx.icon('close', 'ts-quiz-mark')); b.appendChild(h('span', { class: 'kit-sr', text: ' (your choice)' })); }
				else b.classList.add('is-dim');
			}
			ui.choices.push(b);
			grid.appendChild(b);
		});
		return grid;
	}
	function typeBox() {
		var h = cx.h, U = cx.U, form = h('form', { class: 'ts-quiz-type' });
		var inp = h('input', { id: 'qz-typed', class: 'kit-input', type: 'text', autocomplete: 'off', spellcheck: 'false', autocapitalize: 'off', enterkeyhint: 'go', data: { id: 'qz-typed' }, value: typedDraft });
		var go = U.btn({ label: 'Guess', variant: 'secondary', size: 'md' });
		go.type = 'submit';
		var msg = h('p', { class: 'ts-quiz-typemsg', aria: { live: 'polite' } });
		inp.addEventListener('input', function () { typedDraft = inp.value; msg.textContent = ''; });
		form.appendChild(h('label', { for: 'qz-typed', text: 'Or type it' }));
		form.appendChild(inp);
		form.appendChild(go);
		form.appendChild(msg);
		form.addEventListener('submit', function (e) {
			e.preventDefault();
			if (!game) return;
			var i = typed(inp.value, game.round(), game.pool());
			if (i < 0) { msg.textContent = inp.value.trim() ? 'That is not one of the four, or it fits more than one: type more of the name, or press a choice.' : 'Type the name first.'; return; }
			choose(i);
		});
		return form;
	}
	function resultBox(r, s) {
		var h = cx.h, U = cx.U, last = s.played >= s.total, pv = r.preview || {};
		var box = h('section', { class: 'ts-quiz-result ' + (r.right ? 'is-right' : 'is-wrong'), aria: { label: 'The answer' } });
		box.appendChild(h('p', { class: 'ts-quiz-verdict' }, [cx.icon(r.right ? 'check-circle' : 'close'), h('span', { text: r.right ? 'Right! +' + r.points + ' points' : 'Not quite. It was ' + r.work + '.' })]));
		box.appendChild(h('p', { class: 'ts-quiz-song' }, [
			h('b', { text: r.title }), ' by ' + r.artist + ' ', r.roleLabel ? h('span', { class: 'ts-role', text: r.roleLabel }) : null,
			' from ', h('a', { href: cx.link('work', r.work), text: r.work })
		]));
		var credit = (pv.original ? 'The clip was the original recording: ' : 'The clip: ') + (pv.title || r.title) + ' by ' + (pv.artist || r.artist) + ', a preview from Apple' + RSQ + 's iTunes Search';
		box.appendChild(h('p', { class: 'ts-quiz-credit ts-muted' }, pv.link ? [credit + ' (', h('a', { href: pv.link, target: '_blank', rel: 'noopener noreferrer', text: 'Apple Music' }), ').'] : [credit + '.']));
		ui.next = U.btn({ icon: last ? 'medal' : 'arrow-right', label: last ? 'See how you did' : 'Next round', variant: 'primary', size: 'lg', kbd: 'Enter', data: { id: 'qz-next' }, on: { click: goNext } });
		var full = U.btn({ icon: 'play', label: 'Play the full song', variant: 'secondary', size: 'lg', data: { id: 'qz-full' }, on: { click: function () { playFull(r.id); } } });
		box.appendChild(h('div', { class: 'ts-row-btns' }, [ui.next, full]));
		return box;
	}
	function errorBox(s) {
		var h = cx.h, U = cx.U, box = h('div', { class: 'ts-quiz-error' });
		box.appendChild(h('p', { text: s.error || 'Something went wrong.' }));
		box.appendChild(h('div', { class: 'ts-row-btns' }, [U.btn({ icon: 'retry', label: 'Try again', variant: 'primary', size: 'lg', data: { id: 'qz-retry' }, on: { click: function () { if (game) game.retry(); } } })]));
		return box;
	}
	function footer() {
		var h = cx.h, U = cx.U;
		return h('div', { class: 'ts-quiz-foot' }, [
			h('p', { class: 'ts-muted', text: 'Keys: 1 to 4 choose, Space plays the clip again, Enter goes on. Clips: 30-second previews from Apple' + RSQ + 's iTunes Search.' }),
			U.btn({ icon: 'close', label: 'End this game', variant: 'ghost', size: 'sm', data: { id: 'qz-quit' }, on: { click: quit } })
		]);
	}
	function drawSummary(c) {
		var h = cx.h, U = cx.U, s = game.summary(), before = bestAtStart || bestOf(), lv = LEVELS[s.level];
		var n = cx.words && cx.words.n ? cx.words.n : String;
		cx.ui.headerBlock(c, { kicker: 'Game over ' + DOT + ' ' + lv.name, title: 'Guess the anime', hue: HUE, artNode: quizArt() });
		var fin = h('section', { class: 'ts-quiz-final', aria: { labelledby: 'qz-final' } });
		ui.final = h('h2', { id: 'qz-final', class: 'ts-quiz-score', tabindex: '-1', text: s.right + ' of ' + s.played });
		fin.appendChild(ui.final);
		var ratio = s.played ? s.right / s.played : 0;
		fin.appendChild(h('p', { class: 'ts-quiz-sub', text: ratio === 1 ? 'A perfect game.' : ratio >= 0.8 ? 'You know your anime.' : ratio >= 0.5 ? 'Not bad at all.' : ratio > 0 ? 'Some of these were hard.' : 'A hard one. Easy gives longer clips.' }));
		fin.appendChild(h('p', { class: 'ts-quiz-stats' }, [h('b', { text: n(s.points) }), ' points ' + DOT + ' best streak ', h('b', { text: String(s.best) }), s.skipped ? ' ' + DOT + ' ' + plural(s.skipped, 'song') + ' without a clip skipped' : '']));
		var news = [];
		if (s.points > 0 && s.points > (before.points[s.level] || 0)) news.push('New best score on ' + lv.name);
		if (s.best > before.streak) news.push('New best streak');
		if (news.length) fin.appendChild(h('p', { class: 'ts-quiz-news' }, news.map(function (t) { return U.badge('new', t); })));
		fin.appendChild(h('div', { class: 'ts-row-btns' }, [
			U.btn({ icon: 'retry', label: 'Play again', variant: 'primary', size: 'lg', data: { id: 'qz-again' }, on: { click: newGame } }),
			U.btn({ icon: 'sliders', label: 'Change difficulty', variant: 'secondary', size: 'lg', data: { id: 'qz-setup' }, on: { click: quit } })
		]));
		c.appendChild(fin);
		if (!s.missed.length) { cx.ui.sectionHead(c, 'Nothing missed'); return; }
		cx.ui.sectionHead(c, 'The ones you missed');
		var ids = s.missed.map(function (m) { return m.id; });
		c.appendChild(h('div', { class: 'ts-row-btns' }, [U.btn({ icon: 'queue-add', label: 'Queue the ones I missed', variant: 'secondary', data: { id: 'qz-queue' }, on: { click: function () { cx.play.later(ids); } } })]));
		var ul = h('ul', { class: 'ts-quiz-missed' });
		s.missed.forEach(function (m) {
			var li = h('li');
			li.appendChild(U.btn({ icon: 'play', label: 'Play ' + m.title, iconOnly: true, variant: 'secondary', size: 'md', data: { id: 'qz-miss-' + m.id }, on: { click: function () { playFull(m.id); } } }));
			li.appendChild(h('div', { class: 'ts-quiz-mtext' }, [
				h('div', null, [h('b', { text: m.title }), ' ' + DOT + ' ' + m.artist + ' ', m.roleLabel ? h('span', { class: 'ts-role', text: m.roleLabel }) : null]),
				h('div', { class: 'ts-muted' }, ['From ', h('a', { href: cx.link('work', m.work), text: m.work }), ' ' + DOT + ' you said ' + m.choices[m.chosen]])
			]));
			ul.appendChild(li);
		});
		c.appendChild(ul);
	}

	return {
		ROUNDS: ROUNDS, MIN_WORKS: MIN_WORKS, LEVELS: LEVELS, ITUNES: ITUNES,
		pool: pool, choicesFor: choicesFor, makeRound: makeRound, roleLabel: roleLabel,
		pickPreview: pickPreview, searchTerms: searchTerms, searchUrl: searchUrl,
		score: score, typed: typed, createGame: createGame,
		configure: configure, game: function () { return game; }, view: view
	};
});
