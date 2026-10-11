/*
 * True Shuffle: the words of the song that is on. Synced lyrics from LRCLIB
 * (lrclib.net: open, no key, CORS for every origin) in the Lyrics tab of the
 * now-playing panel, a big karaoke page (#/lyrics), and finding a song by a
 * line of its words (#/lyrics?q=, and a section on the search page).
 *
 * The parsing (parseLrc, lineAt, romajiLine), the choice of a record
 * (queryFor, pick, answerOf) and the client (createClient: get and search,
 * cached, one lookup in flight per song, one request every 300 ms) are pure
 * and run in Node. The views need a browser and app.js's page context
 * (pageCtx): panel, tick, view, searchSection. Everything that comes from the
 * network goes on the page as text (ctx.h uses textContent).
 *
 * UMD: window.TrueShuffle.lyrics in the browser (after match.js, sources.js
 * and ui.js), module.exports in Node. The source is plain ASCII.
 */
(function (root, factory) {
	var node = typeof module === 'object' && module.exports;
	var api = factory(root,
		function () { return node ? require('./match.js') : (root.TrueShuffle || {}).match; },
		function () { return node ? require('./sources.js') : (root.TrueShuffle || {}).sources; });
	if (node) module.exports = api;
	else { root.TrueShuffle = root.TrueShuffle || {}; root.TrueShuffle.lyrics = api; }
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this), function (root, getMatch, getSources) {
	'use strict';

	var API = 'https://lrclib.net/api/';
	var SITE = 'https://lrclib.net/';
	var CLIENT = 'True Shuffle (https://nietztein.github.io/misc/101-true-shuffle/)';
	var DAY = 86400000;
	var TTL_MS = 30 * DAY;        // an answer, "none" too, is kept this long
	var GAP_MS = 300;             // at least this long between two requests
	var TIMEOUT_MS = 15000;
	var NEAR = 3;                 // seconds: a record this close in length is this cut of the song
	var CUT_GAP = 45;             // seconds: further apart, the timing belongs to another cut
	var PAUSE_MS = 4000;          // a scroll by hand stops the following this long
	var MAX_GETS = 4;
	var YT_ID = /^[A-Za-z0-9_-]{11}$/;
	var KANA = /[\u3041-\u3096\u309D-\u309F\u30A1-\u30FA\u30FC-\u30FF\uFF66-\uFF9D]/;
	var OWN = Object.prototype.hasOwnProperty;
	var cp = String.fromCharCode;
	var NOTE = cp(0x266A), DOT = cp(0xB7), MINUS = cp(0x2212), LARR = cp(0x2190), RSQ = cp(0x2019), ELL = cp(0x2026);

	function str(v) { return v == null ? '' : String(v); }
	function has(o, k) { return OWN.call(o, k); }
	function uniq(list) {
		var out = [], seen = {};
		list.forEach(function (x) { if (x && !has(seen, '#' + x)) { seen['#' + x] = true; out.push(x); } });
		return out;
	}
	function copy(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }
	function M() { var m = null; try { m = getMatch(); } catch (e) { m = null; } return m && typeof m.fold === 'function' ? m : null; }
	function clockMs() { return root.performance && typeof root.performance.now === 'function' ? root.performance.now() : Date.now(); }
	// match.js fold when it is there: no case, accents, spaces or punctuation.
	function fold(s) {
		var m = M();
		if (m) return m.fold(s);
		return str(s).normalize('NFKD').replace(/[\u0300-\u036F]/g, '').toLowerCase()
			.replace(/&/g, ' and ').replace(/^\s*the\s+/, '').replace(/[^\p{L}\p{N}]+/gu, '');
	}

	// ---- LRC ----------------------------------------------------------------------------

	var STAMP = /^(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?$/;
	var ID_TAG = /^([A-Za-z#][\w#-]*)\s*:([\s\S]*)$/;
	var LEAD = /^\s*\[([^\[\]]*)\]/;
	var INNER = /\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\]|<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/g;

	// LRC text -> { lines: [{ t: seconds, text }], offset: ms, tags: { ar, ti, ... } }.
	// [mm:ss], [mm:ss.xx], [mm:ss.xxx] and [mm:ss:xx]; several stamps on one line
	// give that line at each time; [offset:+/-ms] is applied to every time (a
	// positive offset shows the words sooner, as LRC says); a stamp with no words
	// is a spacer (text ''); lines without a stamp are left out; word stamps
	// (<mm:ss.xx>) are dropped; sorted by time, equal times in the order written.
	function parseLrc(text) {
		var tags = {}, rows = [];
		str(text).replace(/^\uFEFF/, '').split(/\r\n|\r|\n/).forEach(function (raw, order) {
			var rest = raw, stamps = [], lead, m;
			while ((lead = LEAD.exec(rest))) {
				var inner = lead[1].trim();
				if ((m = STAMP.exec(inner))) stamps.push(+m[1] * 60 + +m[2] + (m[3] ? +('0.' + m[3]) : 0));
				else if (!stamps.length && (m = ID_TAG.exec(inner))) tags[m[1].toLowerCase()] = m[2].trim();
				else break;
				rest = rest.slice(lead[0].length);
			}
			if (!stamps.length) return;
			var words = rest.replace(INNER, '').replace(/\s+/g, ' ').trim();
			stamps.forEach(function (t) { rows.push({ t: t, text: words, o: order }); });
		});
		var offset = parseInt(str(tags.offset).replace(/\s+/g, ''), 10);
		if (!isFinite(offset)) offset = 0;
		rows.sort(function (a, b) { return a.t - b.t || a.o - b.o; });
		return {
			lines: rows.map(function (r) { return { t: Math.round(Math.max(0, r.t - offset / 1000) * 1000) / 1000, text: r.text }; }),
			offset: offset,
			tags: tags
		};
	}

	// The line being sung at `seconds`: the last one that has started (-1 before the first).
	function lineAt(lines, seconds) {
		if (!lines || !lines.length) return -1;
		var s = +seconds;
		if (!(s >= lines[0].t)) return -1;
		var lo = 0, hi = lines.length - 1;
		while (lo < hi) {
			var mid = (lo + hi + 1) >> 1;
			if (lines[mid].t <= s) lo = mid; else hi = mid - 1;
		}
		return lo;
	}

	// Japanese punctuation, for a romaji line.
	var PUNCT = { 0x3001: ', ', 0x3002: '. ', 0x300C: '"', 0x300D: '"', 0x300E: '"', 0x300F: '"', 0x30FB: ' ', 0x301C: '~' };
	// A line's kana read as Hepburn romaji (match.js romaji; kanji stay). '' without kana.
	function romajiLine(text) {
		text = str(text);
		var m = M();
		if (!KANA.test(text) || !m || typeof m.romaji !== 'function') return '';
		var r = m.romaji(text.normalize('NFKC'));
		r = r.replace(/[\u3001\u3002\u300C-\u300F\u30FB\u301C]/g, function (c) { return PUNCT[c.charCodeAt(0)]; });
		return r.replace(/\s+/g, ' ').replace(/\s+([,.!?])/g, '$1').trim();
	}

	// ---- Which record is this song ---------------------------------------------------------

	function baseOf(s) {
		s = str(s).trim();
		var m = M(), b = m && typeof m.baseTitle === 'function' ? str(m.baseTitle(s)).trim() : s;
		return b || s;
	}
	// The credits a record may name: the artist (or the guess), and the original artist of a cover.
	function creditsOf(t) { return uniq([str(t.artist || t.artistGuess).trim(), str(t.origArtist).trim()]); }

	// The lookups to make for a track, best first: its artist with its title, then
	// with its titleAlt (often the Japanese title); the artist's native name with the
	// titleAlt; the original artist of a cover. -> [{ artist_name, track_name,
	// duration }] (4 at most; duration only when the length is known; none without
	// an artist).
	function queryFor(track) {
		var t = track || {};
		var artist = str(t.artist || t.artistGuess).trim(), orig = str(t.origArtist).trim(), native = str(t.artistNative).trim();
		var title = baseOf(t.title || (t.raw && t.raw.title)), alt = baseOf(t.titleAlt);
		var dur = Math.round(+t.durationSec || 0);
		var out = [], seen = {};
		function add(a, ti) {
			if (!a || !ti) return;
			var k = (fold(a) || a) + '|' + (fold(ti) || ti);
			if (has(seen, k)) return;
			seen[k] = true;
			var q = { artist_name: a, track_name: ti };
			if (dur > 0) q.duration = dur;
			out.push(q);
		}
		add(artist, title);
		add(artist, alt);
		add(native, alt || title);
		add(orig, title);
		add(orig, alt);
		return out.slice(0, MAX_GETS);
	}

	// How a record's title and artist meet the song's: { title, artist } points, or
	// null when it is another song (another title, or another known artist).
	function meet(track, title, artist) {
		var m = M(), credits = creditsOf(track), best = null;
		if (m) {
			(credits.length ? credits : ['']).forEach(function (a, i) {
				var why = m.sameSong({ title: track.title || (track.raw && track.raw.title), titleAlt: track.titleAlt, artist: a, artistNative: i === 0 ? track.artistNative : '' }, { title: title, artist: artist }).why || [];
				var ts = why.indexOf('title') >= 0 ? 4 : why.indexOf('title-loose') >= 0 ? 3 : why.indexOf('title-part') >= 0 ? 1 : 0;
				if (!ts || why.indexOf('other-artist') >= 0) return;
				var as = why.indexOf('artist') >= 0 ? 3 : why.indexOf('person') >= 0 ? 2 : 0;
				if (ts === 1 && as < 3) return;          // a title only partly alike needs the same credit
				if (!best || ts + as > best.title + best.artist) best = { title: ts, artist: as };
			});
			return best;
		}
		// without match.js: equal folded titles, and the artist equal or one inside the other
		var rt = fold(title), ra = fold(artist);
		if (!rt || [fold(baseOf(track.title)), fold(track.title), fold(track.titleAlt)].indexOf(rt) < 0) return null;
		if (!credits.length) return { title: 4, artist: 0 };
		var as2 = 0;
		credits.concat([str(track.artistNative)]).forEach(function (c) {
			var f = fold(c);
			if (!f || !ra) return;
			if (f === ra) as2 = 3;
			else if (!as2 && f.length >= 3 && ra.length >= 3 && (f.indexOf(ra) >= 0 || ra.indexOf(f) >= 0)) as2 = 2;
		});
		return as2 ? { title: 4, artist: as2 } : null;
	}
	// A record's score for a track, or null when it is not this song.
	function scoreOf(r, track) {
		if (!r || typeof r !== 'object' || Array.isArray(r)) return null;
		var title = str(r.trackName || r.name).trim(), artist = str(r.artistName).trim();
		var synced = !!str(r.syncedLyrics).trim(), plain = !!str(r.plainLyrics).trim(), inst = r.instrumental === true;
		if (!title || (!synced && !plain && !inst)) return null;
		var mt = meet(track, title, artist);
		if (!mt) return null;
		var d = +r.duration, td = +track.durationSec, gap = d > 0 && td > 0 ? Math.abs(d - td) : -1;
		if (!mt.artist && !(gap >= 0 && gap <= NEAR)) return null;        // nobody vouches: the length must
		var s = mt.title + mt.artist + (synced ? 3 : plain ? 1 : 0.5);
		return s + (gap < 0 ? 1 : gap <= NEAR ? 4 : gap <= 8 ? 2.5 : gap <= 15 ? 1 : -2);
	}
	// The best LRCLIB record for a track, or null: the same title (folded, kana read
	// as romaji, the titleAlt too) and the same artist (or the original artist, or a
	// person in the credit); a length within 3 s first, synced words before plain
	// ones. A track with no artist takes only a record within 3 s of its length.
	function pick(results, track) {
		var best = null, top = -Infinity;
		track = track || {};
		(Array.isArray(results) ? results : []).forEach(function (r) {
			var s = scoreOf(r, track);
			if (s != null && s > top) { best = r; top = s; }
		});
		return best;
	}

	// A record as the answer the page shows:
	// { synced: lines | null, plain: text | null, instrumental, otherCut, source: { id, artist, title, duration } }.
	// Timed words for a cut over 45 s longer or shorter than the track (a TV size
	// against the full song) are kept as plain words only (otherCut).
	function answerOf(r, track) {
		if (!r || typeof r !== 'object') return null;
		var parsed = str(r.syncedLyrics).trim() ? parseLrc(r.syncedLyrics) : null;
		var synced = parsed && parsed.lines.some(function (l) { return !!l.text; }) ? parsed.lines : null;
		var plain = str(r.plainLyrics).replace(/\r\n?/g, '\n').trim();
		if (!plain && synced) plain = synced.map(function (l) { return l.text; }).join('\n').replace(/\n{3,}/g, '\n\n').trim();
		var d = +r.duration, td = +((track || {}).durationSec);
		var otherCut = !!synced && d > 0 && td > 0 && Math.abs(d - td) > CUT_GAP;
		return {
			synced: otherCut ? null : synced,
			plain: plain || null,
			instrumental: r.instrumental === true && !synced && !plain,
			otherCut: otherCut,
			source: { id: r.id == null ? null : r.id, artist: str(r.artistName), title: str(r.trackName || r.name), duration: d > 0 ? d : 0 }
		};
	}

	// Where a track's answer is kept: 'ly:<videoId>', else 'ly:<artist>|<title>' folded.
	function cacheKey(track) {
		var t = track || {};
		var v = t.videoId ? str(t.videoId) : YT_ID.test(str(t.id)) ? str(t.id) : '';
		if (v) return 'ly:' + v;
		var a = fold(t.artist || t.artistGuess || t.origArtist), ti = fold(t.title || (t.raw && t.raw.title));
		return a || ti ? 'ly:' + a + '|' + ti : '';
	}

	// ---- Finding a song by its words -------------------------------------------------------

	function loosely(s) { return str(s).normalize('NFKD').replace(/[\u0300-\u036F]/g, '').toLowerCase(); }
	function wordsOf(s) { return uniq(str(s).split(/[\s,.!?;:"()\[\]\u3001\u3002\u300C\u300D]+/).filter(function (w) { return w.length >= 2 || /[^\x00-\x7F]/.test(w); })); }
	var STOP = {};
	'the an and or of to in on at is it be for with my your me you we oh so but are was'.split(' ').forEach(function (w) { STOP[w] = true; });
	// The words worth finding: small words left out (unless there is nothing else),
	// and a plural's singular too ("lanterns" finds "lantern").
	function keyWords(s) {
		var all = wordsOf(s), some = all.filter(function (w) { return !has(STOP, w); }), out = some.length ? some : all;
		out.slice().forEach(function (w) { if (w.length > 4 && /[a-z]s$/.test(w) && !/ss$/.test(w)) out.push(w.slice(0, -1)); });
		return uniq(out);
	}
	function textOf(r) { return str(r.plainLyrics).trim() || str(r.syncedLyrics).replace(/^[ \t]*(?:\[[^\]\n]*\][ \t]*)+/gm, ''); }
	// The line of a song's words that holds most of the words asked for (small words
	// count only when there are no others; a plural finds its singular), and the next
	// line too when it is short; at most 160 characters; '' when none holds any.
	function snippet(text, words) {
		var lines = str(text).split(/\r\n|\r|\n/).map(function (l) { return l.replace(INNER, '').replace(/\s+/g, ' ').trim(); }).filter(Boolean);
		var want = keyWords(loosely(words));
		if (!lines.length || !want.length) return '';
		var best = -1, top = 0;
		lines.forEach(function (l, i) {
			var f = loosely(l), s = 0;
			want.forEach(function (w) { if (f.indexOf(w) >= 0) s += w.length; });
			if (s > top) { top = s; best = i; }
		});
		if (best < 0) return '';
		var out = lines[best];
		if (out.length < 28 && lines[best + 1]) out += ' / ' + lines[best + 1];
		return out.length > 160 ? out.slice(0, 159) + ELL : out;
	}
	// Search results, one row per song (title and artist), the synced record first.
	function hitsOf(list, words) {
		var out = [], at = {};
		(Array.isArray(list) ? list : []).forEach(function (r) {
			if (!r || typeof r !== 'object') return;
			var title = str(r.trackName || r.name).trim(), artist = str(r.artistName).trim();
			if (!title) return;
			var row = {
				id: r.id == null ? null : r.id, title: title, artist: artist, album: str(r.albumName).trim(),
				duration: +r.duration > 0 ? Math.round(+r.duration) : 0, snippet: snippet(textOf(r), words),
				synced: !!str(r.syncedLyrics).trim(), instrumental: r.instrumental === true
			};
			var k = (fold(title) || title) + '|' + (fold(artist) || artist);
			if (has(at, k)) {
				var old = out[at[k]];
				if (row.synced && !old.synced) { if (!row.snippet) row.snippet = old.snippet; out[at[k]] = row; }
				return;
			}
			at[k] = out.length;
			out.push(row);
		});
		return out;
	}
	// A search result as a find (sources.js shape) the engine can play.
	function toFind(hit) {
		hit = hit || {};
		var f = { key: 'lrc:' + str(hit.id), title: str(hit.title), artist: str(hit.artist), album: str(hit.album), durationSec: +hit.duration || 0, source: 'lrclib', ids: { lrc: hit.id } };
		var Src = null;
		try { Src = getSources(); } catch (e) { Src = null; }
		return Src && typeof Src.find === 'function' ? Src.find(f) : f;
	}

	// ---- The client -------------------------------------------------------------------------

	function lyricsError(code, message, status) {
		var e = new Error(message);
		e.name = 'LyricsError';
		e.code = code;
		if (status) e.status = status;
		return e;
	}
	var conf = { fetch: null };

	// createClient({ fetch, cache, now, wait, gapMs, base, client }) -> { get, search }
	//   fetch: (url, init) -> Promise<Response>; else the one configure() gave, else the browser's.
	//   cache: sources.js createCache(...) (get(key), put(key, value, ttlMs)); else a Map here.
	//   now: the clock (ms); wait(ms) -> Promise: how a turn is waited for (tests pass fakes).
	//   client: the Lrclib-Client header LRCLIB asks browsers to send ('' sends none).
	function createClient(opts) {
		opts = opts || {};
		var cache = opts.cache || null;
		var now = typeof opts.now === 'function' ? opts.now : function () { return Date.now(); };
		var wait = typeof opts.wait === 'function' ? opts.wait : function (ms) { return new Promise(function (res) { setTimeout(res, ms); }); };
		var gap = opts.gapMs == null ? GAP_MS : Math.max(0, +opts.gapMs || 0);
		var base = opts.base || API;
		var ident = opts.client == null ? CLIENT : str(opts.client);
		var mem = new Map(), flying = {}, searches = {};
		var turn = Promise.resolve(), nextAt = 0;

		function fetcher() {
			if (typeof opts.fetch === 'function') return opts.fetch;
			if (typeof conf.fetch === 'function') return conf.fetch;
			return typeof root.fetch === 'function' ? function (u, i) { return root.fetch(u, i); } : null;
		}
		// Requests leave one at a time, at least `gap` ms apart.
		function slot() {
			var p = turn.then(function () {
				var d = nextAt - now();
				return d > 0 ? wait(d) : null;
			}).then(function () { nextAt = now() + gap; });
			turn = p.catch(function () {});
			return p;
		}
		function call(path, params) {
			var url = base + path + '?' + Object.keys(params).filter(function (k) { return params[k] !== '' && params[k] != null; }).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]); }).join('&');
			return slot().then(function () {
				var f = fetcher();
				if (!f) throw lyricsError('offline', 'This browser cannot reach LRCLIB.');
				var ctl = typeof AbortController === 'function' ? new AbortController() : null;
				var timer = ctl ? setTimeout(function () { ctl.abort(); }, TIMEOUT_MS) : 0;
				var init = { method: 'GET', credentials: 'omit', referrerPolicy: 'no-referrer' };
				if (ident) init.headers = { 'Lrclib-Client': ident };
				if (ctl) init.signal = ctl.signal;
				return Promise.resolve().then(function () { return f(url, init); }).then(function (res) {
					clearTimeout(timer);
					if (!res || typeof res.status !== 'number') throw lyricsError('bad-answer', 'LRCLIB sent no answer.');
					if (res.status === 404 || res.status === 400) return null;             // nothing there
					if (res.status === 429) {
						var after = +(res.headers && typeof res.headers.get === 'function' ? res.headers.get('retry-after') : 0) || 30;
						nextAt = Math.max(nextAt, now() + Math.min(after, 120) * 1000);
						throw lyricsError('busy', 'LRCLIB is busy; try again in ' + Math.min(after, 120) + ' seconds.', 429);
					}
					if (!(res.status >= 200 && res.status < 300)) throw lyricsError('http', 'LRCLIB answered ' + res.status + '.', res.status);
					return Promise.resolve().then(function () { return res.json(); }).catch(function () { throw lyricsError('bad-answer', 'LRCLIB sent something that is not lyrics.'); });
				}, function (e) {
					clearTimeout(timer);
					if (e && e.name === 'AbortError') throw lyricsError('timeout', 'LRCLIB did not answer in time.');
					throw lyricsError('offline', 'LRCLIB could not be reached' + (e && e.message ? ' (' + e.message + ')' : '') + '.');
				});
			});
		}

		function cget(key) {
			if (cache) return Promise.resolve().then(function () { return cache.get(key); }).catch(function () { return undefined; });
			var r = mem.get(key);
			if (r && r.exp > now()) return Promise.resolve(copy(r.value));
			if (r) mem.delete(key);
			return Promise.resolve(undefined);
		}
		function cput(key, value) {
			if (cache) return Promise.resolve().then(function () { return cache.put(key, value, TTL_MS); }).catch(function () {});
			mem.set(key, { value: copy(value), exp: now() + TTL_MS });
			return Promise.resolve();
		}

		// api/get with each lookup until one gives timed words of this length; then
		// api/search with the lookup that found something (else the first; when that
		// finds nothing, once more with a cover's original artist); pick.
		function lookup(track) {
			var qs = queryFor(track), found = [], used = null, i = 0, orig = str(track.origArtist).trim();
			if (!qs.length) return Promise.resolve(null);
			function enough(r) {
				var p = pick([r], track);
				if (!p || !str(p.syncedLyrics).trim()) return false;
				var d = +p.duration, td = +track.durationSec;
				return !(d > 0 && td > 0) || Math.abs(d - td) <= NEAR;
			}
			function next() {
				if (i >= qs.length) return search();
				var q = qs[i++];
				return call('get', q).then(function (r) {
					if (r && typeof r === 'object' && !Array.isArray(r)) {
						found.push(r);
						if (!used && pick([r], track)) used = q;
						if (enough(r)) return r;
					}
					return next();
				});
			}
			function search() {
				var q = used || qs[0];
				return call('search', { track_name: q.track_name, artist_name: q.artist_name }).then(function (list) {
					found = found.concat(Array.isArray(list) ? list : []);
					var best = pick(found, track);
					if (best || used || !orig || fold(orig) === fold(q.artist_name)) return best;
					return call('search', { track_name: q.track_name, artist_name: orig }).then(function (more) {
						return pick(found.concat(Array.isArray(more) ? more : []), track);
					});
				});
			}
			return next().then(function (best) { return answerOf(best, track); });
		}

		return {
			// The words of a track: { synced, plain, instrumental, otherCut, source } or null
			// (none found; kept 30 days like an answer). Rejects on a network failure,
			// which is not kept.
			get: function (track) {
				if (!track) return Promise.resolve(null);
				var key = cacheKey(track);
				if (!key) return Promise.resolve(null);
				if (flying[key]) return flying[key];
				var p = cget(key).then(function (hit) {
					if (hit !== undefined) return hit;
					return lookup(track).then(function (ans) { return cput(key, ans).then(function () { return ans; }); });
				});
				flying[key] = p;
				function done() { if (flying[key] === p) delete flying[key]; }
				p.then(done, done);
				return p;
			},
			// Songs whose words hold these words: [{ id, title, artist, album, duration,
			// snippet, synced, instrumental }], one row per song. Kept 10 minutes here.
			search: function (words) {
				words = str(words).replace(/\s+/g, ' ').trim();
				if (!words) return Promise.resolve([]);
				var k = words.toLowerCase(), hit = searches[k];
				if (hit && now() - hit.at < 600000) return hit.p;
				var p = call('search', { q: words }).then(function (list) { return hitsOf(list, words); });
				searches[k] = { at: now(), p: p };
				p.catch(function () { if (searches[k] && searches[k].p === p) delete searches[k]; });
				return p;
			}
		};
	}

	// ---- The page ---------------------------------------------------------------------------

	var doc = root.document || null;
	var pageClient = null, pageCache = null;
	var known = {}, knownKeys = [];       // cache key -> what LRCLIB said, for redraws without waiting
	var surfaces = [];                    // what follows the time: the panel, the karaoke page
	var last = { sec: 0, id: null, at: 0 };
	var libIx = { lib: null, n: -1, ix: null };

	// configure({ fetch }): the fetch every client made without one uses (tests, the
	// drive scripts); null for the browser's again. Forgets what this page was told.
	function configure(o) {
		o = o || {};
		if ('fetch' in o) conf.fetch = typeof o.fetch === 'function' ? o.fetch : null;
		pageClient = null;
		known = {};
		knownKeys = [];
		return { fetch: conf.fetch };
	}
	function clientFor(ctx) {
		var c = ctx && typeof ctx.cache === 'function' ? ctx.cache() : null;
		if (!pageClient || pageCache !== c) { pageClient = createClient({ cache: c }); pageCache = c; }
		return pageClient;
	}
	function remember(key, ans) {
		if (!has(known, key)) { knownKeys.push(key); if (knownKeys.length > 60) delete known[knownKeys.shift()]; }
		known[key] = ans;
	}
	// The demo's songs are invented and a thumbnail asks nothing: no lookups there,
	// unless a test configured a fetch.
	function quiet(ctx) { return !!(ctx && (ctx.thumb || (ctx.demo && !conf.fetch))); }

	function kit() { return root.ToyKit || null; }
	function load(key, fallback) { var k = kit(); try { return k ? k.load(key, fallback) : fallback; } catch (e) { return fallback; } }
	function save(key, value) { var k = kit(); try { if (k) k.store(key, value); } catch (e) { /* storage off */ } }
	function romajiOn() { return load('lyricsRomaji', false) === true; }
	function offsets() { var m = load('lyricsOffset', {}); return m && typeof m === 'object' && !Array.isArray(m) ? m : {}; }
	function offsetOf(id) { var v = id ? +offsets()[id] : 0; return isFinite(v) ? v : 0; }
	function setOffset(id, v) {
		var m = offsets();
		delete m[id];
		if (v) m[id] = v;
		var keys = Object.keys(m);
		while (keys.length > 300) delete m[keys.shift()];
		save('lyricsOffset', Object.keys(m).length ? m : null);
	}
	function offText(v) { return (v > 0 ? '+' : v < 0 ? MINUS : '') + Math.abs(v).toFixed(1) + ' s'; }
	function reduced() {
		var k = kit();
		if (k && 'reducedMotion' in k) return !!k.reducedMotion;
		return !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);
	}
	function later(fn) { if (typeof root.requestAnimationFrame === 'function') root.requestAnimationFrame(function () { fn(); }); else setTimeout(fn, 0); }
	function hueOf(s) { var x = 0; s = str(s); for (var i = 0; i < s.length; i++) x = (x * 31 + s.charCodeAt(i)) % 360; return x; }

	var CSS = [
		'.ts-ly { padding: 2px 2px 16px; }',
		'.ts-ly-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 8px; margin: 2px 8px 6px; font-size: 12.5px; color: var(--text-2); }',
		'.ts-ly-head b { color: var(--heading); font-size: 13.5px; font-weight: 650; overflow-wrap: anywhere; }',
		'.ts-ly-credit { margin-left: auto; white-space: nowrap; }',
		'.ts-ly-credit a, .ts-lyv-sub a, .ts-ly-more a { color: inherit; text-underline-offset: 2px; }',
		'.ts-ly-tools { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; margin: 0 4px 6px; }',
		'.ts-ly-nudge { display: inline-flex; align-items: center; }',
		'.ts-ly-off { min-width: 4.6em; padding-left: 6px; padding-right: 6px; justify-content: center; font-variant-numeric: tabular-nums; }',
		'.ts-ly-step { min-width: 32px; padding-left: 0; padding-right: 0; justify-content: center; font-size: 17px; }',
		'.ts-ly-tools .ts-ly-big { margin-left: auto; }',
		'.ts-ly-tools .ts-btn--chip[aria-pressed="true"]:hover:not(:disabled) { background: var(--heading); color: var(--bg); border-color: var(--heading); opacity: 0.86; }',
		'.ts-ly-lines { list-style: none; margin: 0; padding: 0; }',
		'.ts-ly-l { display: block; width: 100%; margin: 0; padding: 5px 10px; border: 0; border-radius: 8px; background: none; color: var(--text-2); font: inherit; font-size: 15px; line-height: 1.45; text-align: left; cursor: pointer; overflow-wrap: anywhere; transition: color var(--dur-fast), background-color var(--dur-fast), opacity var(--dur); }',
		'.ts-ly-l:hover { background: var(--ts-hover); color: var(--text); }',
		'.ts-ly-l:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }',
		'.ts-ly-l.is-now { color: var(--heading); font-weight: 650; background: var(--ts-hover); box-shadow: inset 3px 0 0 var(--accent); }',
		'.ts-ly-l.is-gap { font-size: 12px; padding-top: 1px; padding-bottom: 1px; }',
		'.ts-ly-rom { display: block; font-size: 0.82em; font-weight: 400; color: var(--text-2); }',
		'.ts-ly-p { margin: 0; padding: 3px 10px; font-size: 15px; line-height: 1.45; color: var(--text); overflow-wrap: anywhere; }',
		'.ts-ly-p.is-gap { height: 12px; padding: 0; }',
		'.ts-ly-msg { margin: 0; padding: 10px 8px; color: var(--text-2); line-height: 1.5; }',
		'.ts-ly-msg a { color: var(--accent); }',
		'.ts-ly-msg .ts-btn { margin-top: 8px; }',
		'.ts-ly-note { margin: 0 8px 8px; font-size: 12.5px; color: var(--text-2); }',
		'.ts-ly-sk { display: block; height: 12px; margin: 14px 10px; border-radius: 6px; background: var(--border); animation: ts-ly-pulse 1.1s ease-in-out infinite alternate; }',
		'@keyframes ts-ly-pulse { from { opacity: 0.45; } to { opacity: 1; } }',
		'.ts-lyv-bar { position: sticky; top: 0; z-index: 3; display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; padding: 8px 0; background: var(--ts-panel, var(--surface)); border-bottom: 1px solid var(--border); }',
		'.ts-lyv-bar .ts-back { margin: 0; white-space: nowrap; }',
		'.ts-lyv-bar-t { flex: 1 1 120px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; color: var(--heading); opacity: 0; transition: opacity var(--dur-fast); }',
		'.ts-lyv-bar.is-stuck .ts-lyv-bar-t { opacity: 1; }',
		'.ts-lyv-bar .ts-ly-tools { margin: 0 0 0 auto; }',
		'.ts-lyv-head { display: flex; align-items: center; gap: 16px; margin: 18px 0 4px; }',
		'.ts-lyv-art { width: 72px; height: 72px; border-radius: 10px; flex: none; }',
		'.ts-lyv-head .ts-h1 { margin: 0; overflow-wrap: anywhere; }',
		'.ts-lyv-sub { margin: 2px 0 0; color: var(--text-2); font-size: 14px; }',
		'.ts-lyv .ts-ly-lines { padding: 24vh 0 46vh; max-width: 980px; }',
		'.ts-lyv .ts-ly-l { font-size: clamp(22px, 3.2vw, 40px); line-height: 1.25; font-weight: 700; letter-spacing: -0.01em; padding: 8px 12px; border-radius: 12px; color: var(--heading); opacity: 0.28; }',
		'.ts-lyv .ts-ly-l:hover { opacity: 0.7; color: var(--heading); }',
		'.ts-lyv .ts-ly-l.is-now { opacity: 1; background: none; box-shadow: inset 4px 0 0 var(--accent); }',
		'.ts-lyv .ts-ly-l.is-next1 { opacity: 0.62; }',
		'.ts-lyv .ts-ly-l.is-next2 { opacity: 0.45; }',
		'.ts-lyv .ts-ly-l.is-gap { font-size: clamp(18px, 2.4vw, 28px); }',
		'.ts-lyv .ts-ly-rom { font-size: 0.55em; font-weight: 500; margin-top: 2px; color: inherit; }',
		'.ts-lyv .ts-ly-plain { padding: 8px 0 30vh; max-width: 900px; }',
		'.ts-lyv .ts-ly-p { font-size: clamp(18px, 2.2vw, 26px); line-height: 1.5; padding: 4px 12px; }',
		'.ts-lyv .ts-ly-msg { font-size: 16px; padding: 16px 0; max-width: 64ch; }',
		'.ts-lyv .ts-ly-note { margin: 8px 0; }',
		'.ts-lyv .ts-ly-sk { height: 26px; margin: 22px 12px; max-width: 760px; }',
		'.ts-ly-find { max-width: 640px; }',
		'.ts-ly-hit { flex-wrap: wrap; }',
		'.ts-ly-hit .ts-q-text { flex: 1 1 220px; }',
		'.ts-ly-snip { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; margin-top: 2px; font-size: 12.5px; color: var(--text); overflow-wrap: anywhere; }',
		'.ts-ly-snip mark { background: none; color: var(--accent); font-weight: 650; }',
		'.ts-ly-acts { display: flex; align-items: center; gap: 8px; margin-left: auto; flex: none; }',
		'.ts-ly-sec { margin: 4px 0 18px; padding: 10px 12px; border: 1px solid var(--border); border-radius: 12px; background: var(--surface); max-width: 900px; }',
		'.ts-ly-sec .ts-sec-head { margin: 0; align-items: center; }',
		'.ts-ly-sec .ts-sec-head h2 { font-size: 15px; }',
		'.ts-ly-sec .ts-sec-head .ts-btn { margin-left: auto; }',
		'.ts-ly-sec-res:not(:empty) { margin-top: 8px; }',
		'.ts-ly-more { margin: 6px 8px 0; font-size: 13px; color: var(--text-2); }',
		'@media (prefers-reduced-motion: reduce) { .ts-ly-l { transition: none; } .ts-ly-sk { animation: none; } }',
		'html.is-reduced .ts-ly-l { transition: none; }',
		'html.is-reduced .ts-ly-sk { animation: none; }',
		'@media (max-width: 760px) { .ts-lyv-bar { background: var(--bg); } .ts-lyv-art { width: 56px; height: 56px; } .ts-lyv .ts-ly-lines { padding: 16vh 0 40vh; } }'
	].join('\n');
	function ensureCss() {
		if (!doc || doc.getElementById('ts-lyrics-css')) return;
		var st = doc.createElement('style');
		st.id = 'ts-lyrics-css';
		st.textContent = CSS;
		(doc.head || doc.documentElement).appendChild(st);
	}

	function credit(ctx) { return ctx.h('a', { href: SITE, target: '_blank', rel: 'noopener', text: 'LRCLIB' }); }
	function skeleton(ctx, n) {
		var box = ctx.h('div', { role: 'status', aria: { label: 'Loading the lyrics' } });
		for (var i = 0; i < n; i++) box.appendChild(ctx.h('span', { class: 'ts-ly-sk', style: { width: [72, 55, 84, 40, 66, 58, 76, 48][i % 8] + '%' } }));
		return box;
	}
	function searchHref(t, ctx) { return '#/lyrics?q=' + encodeURIComponent(ctx.words && ctx.words.title ? ctx.words.title(t) : str(t && t.title)); }
	function hasKana(ans) { return !!ans && (KANA.test(str(ans.plain)) || !!(ans.synced && ans.synced.some(function (l) { return KANA.test(l.text); }))); }

	// ---- A place the words are drawn: the Lyrics tab ('panel') or the karaoke page ('big')

	function surface(kind, box, ctx) {
		return {
			kind: kind, box: box, ctx: ctx, id: null, track: null, key: '', ans: undefined, err: null, state: 'idle', drawn: false,
			lines: null, offset: 0, els: [], marked: [], cur: -2, tabAt: null, list: null, offBtn: null, bar: null,
			scroller: null, unwatch: null, io: null, pausedUntil: 0, autoUntil: clockMs() + 700, behind: false, timer: 0, token: 0
		};
	}
	function drop(s) {
		clearTimeout(s.timer);
		if (s.unwatch) s.unwatch();
		if (s.io) s.io.disconnect();
		s.unwatch = null;
		s.io = null;
		var i = surfaces.indexOf(s);
		if (i >= 0) surfaces.splice(i, 1);
	}
	// A karaoke page the router has taken away lets go of its listeners.
	function sweep() { surfaces.slice().forEach(function (s) { if (s.kind === 'big' && !s.box.isConnected) drop(s); }); }

	// Draw a song in a surface: what this page knows, else a lookup.
	function show(s, id) {
		var ctx = s.ctx;
		clearTimeout(s.timer);
		s.token++;
		s.id = id == null ? null : String(id);
		s.track = s.id && typeof ctx.trackOf === 'function' ? ctx.trackOf(s.id) : null;
		s.ans = undefined;
		s.err = null;
		s.lines = null;
		s.offset = offsetOf(s.id);
		if (!s.track) { s.state = 'idle'; draw(s); return; }
		if (quiet(ctx)) { s.state = 'demo'; draw(s); return; }
		s.key = cacheKey(s.track);
		if (s.key && has(known, s.key)) { take(s, known[s.key]); return; }
		s.state = 'loading';
		draw(s);
		var token = s.token, key = s.key;
		clientFor(ctx).get(s.track).then(function (ans) {
			if (key) remember(key, ans);
			if (s.token === token) take(s, ans);
		}, function (err) {
			if (s.token !== token) return;
			s.state = 'error';
			s.err = err;
			draw(s);
		});
	}
	function take(s, ans) {
		s.ans = ans;
		s.lines = ans && ans.synced && ans.synced.length ? ans.synced : null;
		s.state = !ans ? 'none' : s.lines ? 'synced' : ans.plain ? 'plain' : ans.instrumental ? 'instrumental' : 'none';
		draw(s);
		if (s.lines) { if (s.kind === 'big') later(function () { resync(s, true); }); else resync(s, true); }
	}

	function draw(s) {
		var ctx = s.ctx, h = ctx.h, t = s.track, big = s.kind === 'big';
		if (s.io) { s.io.disconnect(); s.io = null; }
		ctx.clear(s.box);
		s.drawn = true;
		s.els = []; s.marked = []; s.cur = -2; s.tabAt = null; s.list = null; s.offBtn = null; s.bar = null;
		var wrap = h('div', { class: (big ? 'ts-lyv-in' : 'ts-ly') + ' is-' + s.state });
		s.box.appendChild(wrap);
		if (big) drawBigHead(s, wrap); else drawPanelHead(s, wrap);
		var title = t ? (ctx.words && ctx.words.title ? ctx.words.title(t) : str(t.title)) : '';
		var msg = function (kids) { var p = h('p', { class: 'ts-ly-msg' }, kids); wrap.appendChild(p); return p; };
		if (s.state === 'idle') {
			msg(big ? 'Play a song and its words follow it here, in time.' : 'Nothing is playing. The words of the song that is on show here, in time.');
			if (big) { wrap.appendChild(h('h2', { class: 'ts-ly-note', text: 'Or find a song by a line of its words' })); wrap.appendChild(findForm(ctx, '')); }
		} else if (s.state === 'demo') {
			msg((ctx.thumb ? 'Lyrics are not looked up here.' : 'The demo' + RSQ + 's songs are invented, so there are no lyrics to show.') + ' With your own library, the words of the song that is on show here in time, from LRCLIB.');
		} else if (s.state === 'loading') {
			wrap.appendChild(skeleton(ctx, big ? 5 : 7));
		} else if (s.state === 'none') {
			msg(['No lyrics found for this song. ', h('a', { href: searchHref(t, ctx), text: 'Search lyrics' })]);
		} else if (s.state === 'instrumental') {
			msg('LRCLIB lists this song as an instrumental: there are no words to show.');
		} else if (s.state === 'error') {
			var again = ctx.U.btn({ icon: 'retry', label: 'Try again', variant: 'secondary', size: 'sm' });
			again.addEventListener('click', function () { show(s, s.id); });
			msg(['The lyrics could not be loaded. ' + str(s.err && s.err.message), h('br'), again]);
		} else if (s.state === 'plain') {
			wrap.appendChild(h('p', { class: 'ts-ly-note', text: s.ans.otherCut ? 'The timed lyrics on LRCLIB are for another cut of this song, so the words are shown without timing.' : 'These lyrics are not timed.' }));
			wrap.appendChild(plainEl(s, s.ans.plain));
		} else if (s.state === 'synced') {
			wrap.appendChild(linesEl(s));
			s.scroller = scrollerOf(s.box);
			watchScroll(s);
		}
		if (big && t && title && !ctx.thumb && doc && s.state !== 'idle') doc.title = title + ' ' + DOT + ' Lyrics ' + DOT + ' True Shuffle';
	}
	function drawPanelHead(s, wrap) {
		var ctx = s.ctx, h = ctx.h, t = s.track;
		if (!t) return;
		var head = h('div', { class: 'ts-ly-head' }, [h('b', { text: ctx.words.title(t) }), h('span', { text: ctx.words.artist(t) })]);
		if (s.state !== 'demo') head.appendChild(h('span', { class: 'ts-ly-credit' }, ['Lyrics from ', credit(ctx)]));
		wrap.appendChild(head);
		var tools = toolsEl(s);
		if (tools) wrap.appendChild(tools);
	}
	function drawBigHead(s, wrap) {
		var ctx = s.ctx, h = ctx.h, t = s.track;
		if (!t) {
			wrap.appendChild(h('div', { class: 'ts-lyv-head' }, [h('div', null, [h('p', { class: 'ts-kicker', text: 'Lyrics' }), h('h1', { class: 'ts-h1', text: 'Nothing is playing' })])]));
			return;
		}
		var inLib = !!(ctx.lib && ctx.lib() && ctx.lib().tracks && ctx.lib().tracks[s.id]);
		var back = h('a', { class: 'ts-back', href: inLib && ctx.link ? ctx.link('track', s.id) : '#/', text: LARR + ' ' + (inLib ? 'Song details' : 'Home') });
		// the bar names the song once the title has scrolled away
		var bar = h('div', { class: 'ts-lyv-bar' }, [back, h('b', { class: 'ts-lyv-bar-t', aria: { hidden: 'true' }, text: ctx.words.title(t) + ' ' + DOT + ' ' + ctx.words.artist(t) })]);
		var tools = toolsEl(s);
		if (tools) bar.appendChild(tools);
		wrap.appendChild(bar);
		s.bar = bar;
		var art = typeof ctx.art === 'function' ? ctx.art(t, 'ts-lyv-art') : null;
		var sub = h('p', { class: 'ts-lyv-sub' }, [ctx.words.artist(t)]);
		if (s.state !== 'demo') sub.appendChild(h('span', null, [' ' + DOT + ' Lyrics from ', credit(ctx)]));
		var h1 = h('h1', { class: 'ts-h1', text: ctx.words.title(t) });
		wrap.appendChild(h('header', { class: 'ts-lyv-head' }, [art, h('div', null, [h('p', { class: 'ts-kicker', text: 'Lyrics' }), h1, sub])]));
		if (typeof root.IntersectionObserver === 'function') {
			s.io = new root.IntersectionObserver(function (es) { bar.classList.toggle('is-stuck', !es[es.length - 1].isIntersecting); });
			s.io.observe(h1);
		} else bar.classList.add('is-stuck');
	}
	function toolsEl(s) {
		var ctx = s.ctx, h = ctx.h, U = ctx.U, bits = [];
		if ((s.state === 'synced' || s.state === 'plain') && hasKana(s.ans)) {
			var rb = U.btn({ label: 'Romaji', variant: 'chip', size: 'sm', pressed: romajiOn(), cls: 'ts-ly-rombtn', title: 'Show the kana read in Latin letters' });
			rb.addEventListener('click', function () {
				var focused = doc.activeElement === rb;
				save('lyricsRomaji', romajiOn() ? null : true);
				redrawAll(s);
				var again = focused && s.box.querySelector('.ts-ly-rombtn');
				if (again) again.focus();
			});
			bits.push(rb);
		}
		if (s.state === 'synced') {
			var minus = U.btn({ label: MINUS, variant: 'ghost', size: 'sm', cls: 'ts-ly-step', title: 'Show the words half a second sooner (Shift: 5 seconds)' });
			var mid = U.btn({ label: offText(s.offset), variant: 'ghost', size: 'sm', cls: 'ts-ly-off', title: 'How far the words are moved for this song; click to put them back' });
			var plus = U.btn({ label: '+', variant: 'ghost', size: 'sm', cls: 'ts-ly-step', title: 'Show the words half a second later (Shift: 5 seconds)' });
			minus.setAttribute('aria-label', 'Words half a second sooner');
			plus.setAttribute('aria-label', 'Words half a second later');
			minus.addEventListener('click', function (e) { nudge(s, e.shiftKey ? -5 : -0.5); });
			plus.addEventListener('click', function (e) { nudge(s, e.shiftKey ? 5 : 0.5); });
			mid.addEventListener('click', function () { nudge(s, null); });
			s.offBtn = mid;
			bits.push(h('span', { class: 'ts-ly-nudge', role: 'group', aria: { label: 'Timing of the words' } }, [minus, mid, plus]));
		}
		if (s.kind === 'panel' && (s.state === 'synced' || s.state === 'plain')) bits.push(U.btn({ icon: 'arrow-right', label: 'Karaoke', variant: 'ghost', size: 'sm', href: '#/lyrics', cls: 'ts-ly-big', title: 'The words big, to sing along' }));
		return bits.length ? h('div', { class: 'ts-ly-tools' }, bits) : null;
	}
	function linesEl(s) {
		var ctx = s.ctx, h = ctx.h, rom = romajiOn() && hasKana(s.ans);
		var clock = ctx.words && ctx.words.clock ? ctx.words.clock : function (x) { return Math.round(x) + ' s'; };
		var list = h('ol', { class: 'ts-ly-lines', aria: { label: 'Lyrics, in time with the song' } });
		s.lines.forEach(function (l, i) {
			var gap = !l.text, at = clock(Math.max(0, l.t + s.offset));
			var b = h('button', { class: 'ts-ly-l' + (gap ? ' is-gap' : ''), tabindex: '-1', title: 'Play from ' + at, data: { i: i }, aria: { label: gap ? 'Music, from ' + at : null } });
			b.appendChild(h('span', { class: 'ts-ly-t', text: gap ? NOTE : l.text }));
			if (rom && !gap) { var r = romajiLine(l.text); if (r) b.appendChild(h('span', { class: 'ts-ly-rom', text: r })); }
			list.appendChild(h('li', null, b));
			s.els.push(b);
		});
		if (s.els[0]) { s.els[0].tabIndex = 0; s.tabAt = 0; }
		list.addEventListener('click', function (e) {
			var b = e.target && e.target.closest ? e.target.closest('.ts-ly-l') : null;
			if (b && list.contains(b)) seek(s, +b.dataset.i);
		});
		list.addEventListener('keydown', function (e) {
			if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
			var k = s.els.indexOf(doc.activeElement), n = k + (e.key === 'ArrowDown' ? 1 : -1);
			if (k < 0 || !s.els[n]) return;
			e.preventDefault();
			s.els[k].tabIndex = -1;
			s.els[n].tabIndex = 0;
			s.tabAt = n;
			s.els[n].focus();
		});
		s.list = list;
		return list;
	}
	function plainEl(s, text) {
		var ctx = s.ctx, h = ctx.h, rom = romajiOn() && hasKana(s.ans);
		var box = h('div', { class: 'ts-ly-plain' });
		str(text).split('\n').forEach(function (line) {
			var t = line.trim(), p = h('p', { class: 'ts-ly-p' + (t ? '' : ' is-gap'), text: t });
			if (rom && t) { var r = romajiLine(t); if (r) p.appendChild(h('span', { class: 'ts-ly-rom', text: r })); }
			box.appendChild(p);
		});
		return box;
	}
	// Romaji switched: every surface again. The panel whose button was pressed stays
	// where the reader is (its tools scroll with the words), and follows again later.
	function redrawAll(from) {
		surfaces.forEach(function (s) {
			if (!s.drawn || !s.box.isConnected || (s.state !== 'synced' && s.state !== 'plain')) return;
			var stay = s === from && s.kind === 'panel';
			if (stay) s.pausedUntil = clockMs() + PAUSE_MS;
			draw(s);
			resync(s, !stay);
		});
	}

	// ---- Following the time

	// The seconds the song that is on has played (the player's word, else the last tick).
	function nowSec(s) {
		var p = s.ctx && typeof s.ctx.player === 'function' ? s.ctx.player() : null;
		if (p && typeof p.time === 'function' && typeof p.id === 'function' && p.id() != null && String(p.id()) === s.id) {
			var t = p.time();
			if (t && isFinite(t.current)) return +t.current;
		}
		return last.id === s.id ? last.sec : 0;
	}
	function resync(s, jump) {
		if (!s.lines) return;
		s.cur = -2;
		time(s, nowSec(s), jump !== false);
	}
	function time(s, sec, jump) {
		if (!s.lines || !s.els.length) return;
		var eff = sec - s.offset, i = lineAt(s.lines, eff), moved = i !== s.cur;
		if (moved) mark(s, i);
		if (moved || jump || s.behind) follow(s, !!jump);
		plan(s, eff);
	}
	function mark(s, i) {
		var els = s.els;
		s.marked.forEach(function (k) { var e = els[k]; if (e) { e.classList.remove('is-now', 'is-next1', 'is-next2'); e.removeAttribute('aria-current'); } });
		s.marked = [];
		s.cur = i;
		function put(k, cls) { if (els[k]) { els[k].classList.add(cls); s.marked.push(k); } }
		if (i >= 0) { put(i, 'is-now'); if (els[i]) els[i].setAttribute('aria-current', 'true'); }
		if (s.kind === 'big') { put(i + 1, 'is-next1'); put(i + 2, 'is-next2'); }
		// the keyboard enters the list at the line being sung, unless it is in the list already
		var a = doc && doc.activeElement;
		if (!(a && s.list && s.list.contains(a))) {
			var k2 = Math.max(0, i);
			if (s.tabAt != null && els[s.tabAt]) els[s.tabAt].tabIndex = -1;
			if (els[k2]) { els[k2].tabIndex = 0; s.tabAt = k2; }
		}
	}
	// Keep the line in view: the panel moves only when it leaves the middle of the
	// view; the karaoke page keeps it in the centre. Not while the reader scrolls.
	function follow(s, jump) {
		var el = s.els[s.cur >= 0 ? s.cur : 0], sc = s.scroller;
		if (!el || !sc) return;
		if (!jump && clockMs() < s.pausedUntil) { s.behind = true; return; }
		if (!el.getClientRects().length) return;                 // the tab is hidden
		var r = el.getBoundingClientRect(), b = sc.getBoundingClientRect();
		var top = Math.max(b.top, 0) + (s.bar ? s.bar.getBoundingClientRect().height : 0);
		var height = Math.min(b.bottom, root.innerHeight || b.bottom) - top, delta;
		if (height <= 40) return;
		s.behind = false;
		if (s.kind === 'big') delta = (r.top + r.height / 2) - (top + height / 2);
		else if (r.top >= top + height * 0.15 && r.bottom <= top + height * 0.75) return;
		else delta = r.top - (top + height * 0.35);
		if (Math.abs(delta) < 2) return;
		var smooth = !jump && !reduced();
		s.autoUntil = clockMs() + (smooth ? 1000 : 200);
		if (typeof sc.scrollTo === 'function') sc.scrollTo({ top: sc.scrollTop + delta, behavior: smooth ? 'smooth' : 'auto' });
		else sc.scrollTop += delta;
	}
	// The player says the time twice a second: the next line is lit on time by a timer.
	function plan(s, eff) {
		clearTimeout(s.timer);
		var nxt = s.lines[s.cur + 1];
		if (!nxt) return;
		var dt = nxt.t - eff;
		if (!(dt > 0 && dt < 0.55)) return;
		var p = typeof s.ctx.player === 'function' ? s.ctx.player() : null;
		if (!p || typeof p.state !== 'function' || p.state() !== 'playing') return;
		var rate = typeof p.rate === 'function' ? (+p.rate() || 1) : 1;
		s.timer = setTimeout(function () {
			if (!s.box.isConnected || last.id !== s.id) return;
			var pp = s.ctx.player();
			if (!pp || pp.state() !== 'playing') return;
			time(s, last.sec + (clockMs() - last.at) / 1000 * rate, false);
		}, Math.ceil(dt * 1000 / rate) + 10);
	}
	function scrollerOf(el) {
		for (var p = el.parentElement; p; p = p.parentElement) {
			var oy = root.getComputedStyle ? root.getComputedStyle(p).overflowY : '';
			if (oy === 'auto' || oy === 'scroll' || oy === 'overlay') return p;
		}
		return doc.scrollingElement || doc.documentElement;
	}
	// A scroll by hand (wheel, touch, keys, the scroll bar) pauses the following.
	function watchScroll(s) {
		var sc = s.scroller;
		if (!sc || (s.unwatch && s.unwatch.el === sc)) return;
		if (s.unwatch) s.unwatch();
		function byHand() { s.pausedUntil = clockMs() + PAUSE_MS; s.behind = true; }
		function onScroll() { if (clockMs() > s.autoUntil) byHand(); }
		function onKey(e) { if (/^(?:ArrowUp|ArrowDown|PageUp|PageDown|Home|End)$/.test(e.key)) byHand(); }
		var opt = { passive: true };
		sc.addEventListener('wheel', byHand, opt);
		sc.addEventListener('touchmove', byHand, opt);
		sc.addEventListener('scroll', onScroll, opt);
		sc.addEventListener('keydown', onKey);
		s.unwatch = function () {
			sc.removeEventListener('wheel', byHand, opt);
			sc.removeEventListener('touchmove', byHand, opt);
			sc.removeEventListener('scroll', onScroll, opt);
			sc.removeEventListener('keydown', onKey);
		};
		s.unwatch.el = sc;
	}
	function seek(s, i) {
		var line = s.lines && s.lines[i], p = typeof s.ctx.player === 'function' ? s.ctx.player() : null;
		if (!line || !p || typeof p.seek !== 'function') return;
		if (typeof p.id === 'function' && p.id() != null && String(p.id()) !== s.id) return;
		var at = Math.max(0, line.t + s.offset + 0.05);
		p.seek(at);
		s.pausedUntil = 0;
		tick(at, s.id);
	}
	function nudge(s, by) {
		var v = by == null ? 0 : Math.max(-120, Math.min(120, Math.round((s.offset + by) * 10) / 10));
		setOffset(s.id, v);
		surfaces.forEach(function (o) {
			if (o.id !== s.id) return;
			var stay = o === s && o.kind === 'panel';     // the reader is at the panel's tools: stay there
			o.offset = v;
			if (o.offBtn) o.ctx.U.btnState(o.offBtn, { label: offText(v) });
			if (stay) o.pausedUntil = clockMs() + PAUSE_MS;
			if (o.lines) resync(o, !stay);
		});
	}

	// tick(seconds, videoId): the player's time, about twice a second. Lights the line
	// being sung in every surface showing that song (no redraw); the karaoke page
	// follows the player to a new song.
	function tick(sec, id) {
		sec = +sec || 0;
		id = id == null ? null : String(id);
		last = { sec: sec, id: id, at: clockMs() };
		for (var i = surfaces.length - 1; i >= 0; i--) {
			var s = surfaces[i];
			if (!s.box.isConnected) { drop(s); continue; }
			if (s.kind === 'big' && id && s.id !== id) { show(s, id); continue; }
			if (s.id === id && s.lines) time(s, sec, false);
		}
	}

	// panel(box, ctx, { id, force }): the Lyrics tab for the song `id`. The same song
	// again without force does nothing; force redraws from what is known (no lookup).
	function panel(box, ctx, o) {
		if (!box || !doc || !ctx) return;
		ensureCss();
		sweep();
		o = o || {};
		var id = o.id == null ? null : String(o.id), s = null;
		for (var i = 0; i < surfaces.length; i++) if (surfaces[i].box === box) { s = surfaces[i]; break; }
		if (!s) { s = surface('panel', box, ctx); surfaces.push(s); }
		s.ctx = ctx;
		if (s.drawn && s.id === id) {
			if (!o.force) return;
			// a failure, nothing playing, or a demo note when lookups are allowed now: look again
			if (s.state !== 'error' && s.state !== 'idle' && !(s.state === 'demo' && !quiet(ctx))) {
				if (s.id) s.track = ctx.trackOf(s.id) || s.track;
				draw(s);
				resync(s, true);
				return;
			}
		}
		show(s, id);
	}

	// view(el, ctx, parts, query): #/lyrics, the words of the song that is on, big;
	// #/lyrics?q=<words>, songs whose words hold them.
	function view(el, ctx, parts, query) {
		if (!el || !doc || !ctx) return;
		ensureCss();
		surfaces.slice().forEach(function (s) { if (s.kind === 'big') drop(s); });
		var q = query && typeof query.get === 'function' ? query.get('q') : null;
		if (q != null) { searchPage(el, ctx, q); return; }
		var box = ctx.h('div', { class: 'ts-lyv' });
		el.appendChild(box);
		var s = surface('big', box, ctx);
		surfaces.push(s);
		var c = typeof ctx.ctl === 'function' ? ctx.ctl() : null;
		show(s, c && typeof c.current === 'function' ? c.current() : null);
	}

	function findForm(ctx, value) {
		var h = ctx.h;
		var inp = h('input', { class: 'kit-input', type: 'search', value: value || '', placeholder: 'A line you remember', autocomplete: 'off', spellcheck: 'false', enterkeyhint: 'search', aria: { label: 'Words from the song' } });
		var go = ctx.U.btn({ icon: 'search', label: 'Find the song', variant: 'secondary' });
		go.type = 'submit';
		var f = h('form', { class: 'ts-inline-form ts-ly-find', role: 'search' }, [inp, go]);
		f.addEventListener('submit', function (e) {
			e.preventDefault();
			var v = inp.value.replace(/\s+/g, ' ').trim();
			if (v) ctx.nav('#/lyrics?q=' + encodeURIComponent(v)); else inp.focus();
		});
		return f;
	}
	function searchPage(el, ctx, q) {
		var h = ctx.h;
		q = str(q).replace(/\s+/g, ' ').trim();
		el.appendChild(h('a', { class: 'ts-back', href: '#/lyrics', text: LARR + ' Lyrics' }));
		el.appendChild(h('h1', { class: 'ts-h1', text: q ? 'Songs with ' + (ctx.words && ctx.words.q ? ctx.words.q(q) : q) : 'Find a song by its words' }));
		el.appendChild(h('p', { class: 'ts-muted ts-lede' }, ['A line you remember is enough. The words are searched on ', credit(ctx), ', an open database of lyrics.']));
		el.appendChild(findForm(ctx, q));
		var box = h('div', { class: 'ts-ly-res' });
		el.appendChild(box);
		if (!q) return;
		if (ctx.thumb) { box.appendChild(h('p', { class: 'ts-ly-msg', text: 'Lyrics are not looked up here.' })); return; }
		runSearch(ctx, box, q, 20, null);
	}
	function runSearch(ctx, box, q, max, btn) {
		var h = ctx.h, U = ctx.U;
		ctx.clear(box);
		box.appendChild(skeleton(ctx, 3));
		if (btn) U.btnState(btn, { busy: true });
		clientFor(ctx).search(q).then(function (list) {
			if (btn) U.btnState(btn, { busy: false });
			if (!box.isConnected) return;
			ctx.clear(box);
			if (!list.length) { box.appendChild(h('p', { class: 'ts-ly-msg', text: 'No song on LRCLIB has these words.' })); return; }
			if (btn) btn.hidden = true;
			box.appendChild(hitList(ctx, list.slice(0, max), q));
			if (list.length > max) box.appendChild(h('p', { class: 'ts-ly-more' }, [h('a', { href: '#/lyrics?q=' + encodeURIComponent(q), text: 'All ' + list.length + ' songs' }), ' ' + DOT + ' Lyrics from ', credit(ctx)]));
			else if (btn) box.appendChild(h('p', { class: 'ts-ly-more' }, ['Lyrics from ', credit(ctx)]));
		}, function (err) {
			if (btn) U.btnState(btn, { busy: false });
			if (!box.isConnected) return;
			ctx.clear(box);
			var again = U.btn({ icon: 'retry', label: 'Try again', variant: 'secondary', size: 'sm' });
			again.addEventListener('click', function () { runSearch(ctx, box, q, max, btn); });
			box.appendChild(h('p', { class: 'ts-ly-msg' }, ['The search could not be done. ' + str(err && err.message), h('br'), again]));
		});
	}
	// The library's copy of a find, when the library has it (match.js inLibrary on an
	// index kept while the library stays the same).
	function libraryCopy(ctx, f) {
		var m = M(), lib = typeof ctx.lib === 'function' ? ctx.lib() : null;
		if (!m || !lib || !lib.tracks || !ctx.L || typeof ctx.L.list !== 'function') return null;
		try {
			var n = Object.keys(lib.tracks).length;
			if (libIx.lib !== lib || libIx.n !== n) libIx = { lib: lib, n: n, ix: m.index(ctx.L.list(lib)) };
			return m.inLibrary(libIx.ix, f);
		} catch (e) { return null; }
	}
	function hitList(ctx, list, words) {
		var ul = ctx.h('ul', { class: 'ts-dlist ts-ly-hits' });
		list.forEach(function (it) { ul.appendChild(hitRow(ctx, it, words)); });
		return ul;
	}
	function hitRow(ctx, it, words) {
		var h = ctx.h, U = ctx.U;
		var li = h('li', { class: 'ts-drow ts-ly-hit' });
		li.appendChild(U.swatch(hueOf(it.artist || it.title), it.title, 'ts-q-art'));
		var sub = [it.artist, it.album, it.duration && ctx.words && ctx.words.clock ? ctx.words.clock(it.duration) : '', it.instrumental ? 'instrumental' : ''].filter(Boolean).join(' ' + DOT + ' ');
		var text = h('span', { class: 'ts-q-text' }, [h('span', { class: 'ts-q-title', text: it.title }), h('span', { class: 'ts-q-artist', text: sub })]);
		if (it.snippet) { var sn = h('span', { class: 'ts-ly-snip' }); markWords(ctx, sn, it.snippet, words); text.appendChild(sn); }
		li.appendChild(text);
		var f = toFind(it), mine = libraryCopy(ctx, f), acts = h('span', { class: 'ts-ly-acts' });
		if (mine) acts.appendChild(U.badge('ok', 'In your library'));
		var pb = U.btn({ icon: 'play', label: 'Play', variant: 'primary', size: 'sm', cost: mine ? null : 100, title: mine ? 'Play your copy now; what was coming stays after it' : 'Find it on YouTube and play it here (uses 100 of today' + RSQ + 's YouTube units)' });
		pb.addEventListener('click', function () {
			if (!ctx.play || typeof ctx.play.find !== 'function') return;
			U.btnState(pb, { busy: true });
			Promise.resolve(ctx.play.find(f, 'now')).then(function () { U.btnState(pb, { busy: false }); }, function () { U.btnState(pb, { busy: false }); });
		});
		acts.appendChild(pb);
		li.appendChild(acts);
		// a song found before costs nothing: the engine's estimate takes the badge off
		var eng = !mine && typeof ctx.engine === 'function' ? ctx.engine() : null;
		if (eng && typeof eng.estimate === 'function') {
			Promise.resolve().then(function () { return eng.estimate([f]); }).then(function (est) {
				var e = est && est.perFind && est.perFind[f.key];
				if (e && e.status === 'ready') U.btnState(pb, { cost: null });
			}, function () { /* keep the badge */ });
		}
		return li;
	}
	// The snippet as text, the words asked for in <mark>.
	function markWords(ctx, el, text, words) {
		var low = text.toLowerCase(), spans = [];
		if (low.length === text.length) keyWords(str(words).toLowerCase()).forEach(function (w) {
			for (var i = low.indexOf(w); i >= 0; i = low.indexOf(w, i + w.length)) spans.push([i, i + w.length]);
		});
		spans.sort(function (a, b) { return a[0] - b[0]; });
		var merged = [];
		spans.forEach(function (r) { var p = merged[merged.length - 1]; if (p && r[0] <= p[1]) p[1] = Math.max(p[1], r[1]); else merged.push([r[0], r[1]]); });
		var at = 0;
		merged.forEach(function (r) {
			if (r[0] > at) el.appendChild(doc.createTextNode(text.slice(at, r[0])));
			el.appendChild(ctx.h('mark', { text: text.slice(r[0], r[1]) }));
			at = r[1];
		});
		if (at < text.length) el.appendChild(doc.createTextNode(text.slice(at)));
	}

	// searchSection(view, ctx, q): on the search page, for three words or more (or 12
	// characters), a compact section whose button looks the words up on LRCLIB and
	// lists up to five songs. Nothing is asked until the button is pressed.
	function searchSection(el, ctx, q) {
		if (!el || !doc || !ctx) return;
		q = str(q).replace(/\s+/g, ' ').trim();
		if (q.split(' ').length < 3 && q.length < 12) return;
		ensureCss();
		var h = ctx.h;
		var go = ctx.U.btn({ icon: 'search', label: 'Search lyrics', variant: 'secondary', size: 'sm', title: 'Look for songs whose words hold these (on LRCLIB)' });
		var box = h('div', { class: 'ts-ly-sec-res' });
		var sec = h('section', { class: 'ts-ly-sec', aria: { label: 'Songs with these words (lyrics)' } }, [h('div', { class: 'ts-sec-head' }, [h('h2', { text: 'Songs with these words (lyrics)' }), go]), box]);
		go.addEventListener('click', function () { runSearch(ctx, box, q, 5, go); });
		el.appendChild(sec);
	}

	return {
		API: API, TTL_MS: TTL_MS, GAP_MS: GAP_MS,
		parseLrc: parseLrc, lineAt: lineAt, romajiLine: romajiLine,
		queryFor: queryFor, pick: pick, answerOf: answerOf, cacheKey: cacheKey, snippet: snippet, toFind: toFind,
		createClient: createClient, configure: configure,
		panel: panel, tick: tick, view: view, searchSection: searchSection
	};
});
