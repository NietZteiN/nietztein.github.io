/*
 * True Shuffle: search that forgives (fuzzy.js). Library search finds the
 * words as they are typed; this finds what was meant: romaji for a kana
 * title ("shirushi", or "sirusi", for shirushi), long vowels written or not
 * ("tokyo", "toukyou", "tohkyoh"), typos ("Kalafna", "Aimr"), the start of a
 * word still being typed, and a title typed without its spaces
 * ("kiminoshiranai"). The search page lists these under Close matches,
 * after the exact results; the palette (Ctrl+K) adds them when it finds few
 * songs.
 *
 *     var F = TrueShuffle.fuzzy;
 *     var ix = F.index(tracks)                       once per library change
 *     F.search(ix, 'kalafna hikari', { not, limit }) -> [{ id, score, how }]
 *     F.rankNames(['Aimer', 'Kalafina'], 'aimr')     -> [{ i: 0, score, how: 'typo' }]
 *     F.distance('aimr', 'aimer', 1)                 -> 1
 *
 * Kana are read as romaji with match.js (romaji, fold, loose); kanji are
 * never romanised, so a kanji title is found through its titleAlt. The
 * index and the search are pure and run in Node; closeMatches, section and
 * paletteSongs draw through app.js's page context (pageCtx).
 *
 * UMD: window.TrueShuffle.fuzzy in the browser (after match.js),
 * module.exports in Node. The source is plain ASCII.
 */
(function (root, factory) {
	var node = typeof module === 'object' && module.exports;
	var api = factory(root, function () { return node ? require('./match.js') : (root.TrueShuffle || {}).match; });
	if (node) module.exports = api;
	else { root.TrueShuffle = root.TrueShuffle || {}; root.TrueShuffle.fuzzy = api; }
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this), function (root, getMatch) {
	'use strict';

	// What a term's match is worth. Each kind beats every kind below it
	// whatever the field: a title or an artist adds FIELD, less than the gap.
	var EXACT = 50, PREFIX = 40, INSIDE = 30, LOOSE = 20, TYPO = 10, TYPO2 = 7, FIELD = 5, WHOLE = 2;
	// The track fields searched and their class: 0 the title, 1 the artist, 2 the rest.
	var FIELDS = [['title', 0], ['titleAlt', 0], ['artist', 1], ['artistNative', 1], ['work', 2], ['album', 2], ['feat', 2]];
	// The words a page shows for each kind of match ('' for none).
	var HOW = { exact: '', prefix: 'start of a word', romaji: 'romaji reading', loose: 'another spelling', typo: 'close spelling', joined: 'spaced differently' };
	var CLOSE_SONGS = 50, CLOSE_NAMES = 6, PALETTE_FEW = 3, PALETTE_SONGS = 8;

	function str(v) { return v == null ? '' : String(v); }
	// match.js, asked for once (a require in Node costs more than the work it does).
	var matchApi = null;
	function match() { return matchApi || (matchApi = getMatch()); }
	// A string function that remembers its answers (50,000 at most, then it
	// starts again), as match.js does: a rebuilt index costs little. The
	// answers are only read, never changed.
	function memo(fn) {
		var cache = new Map();
		return function (s) {
			var v = cache.get(s);
			if (v !== undefined) return v;
			if (cache.size >= 50000) cache = new Map();
			v = fn(s);
			cache.set(s, v);
			return v;
		};
	}

	// ---- Words and their forms ----------------------------------------------------------------

	var KANA_CH = '\u3041-\u3096\u309D-\u309F\u30A1-\u30FA\u30FC-\u30FF';
	var HAN_CH = '\u3005\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF';
	var SEP = /[^\p{L}\p{N}]+/u;
	// Japanese and other letters are separate words: "himawariGood" is two.
	var PIECE = new RegExp('[' + KANA_CH + HAN_CH + ']+|[^' + KANA_CH + HAN_CH + ']+', 'g');
	var CJK = new RegExp('^[' + KANA_CH + HAN_CH + ']');
	var HAN = new RegExp('[' + HAN_CH + ']');
	var KANA_RUN = new RegExp('[' + KANA_CH + ']{2,}', 'g');
	// A word that can be read as romaji: syllables of an optional consonant
	// (a doubled one for the small tsu) and a vowel, the syllabic n, an h
	// after a vowel (tohkyoh). Only such words are compared loosely, so
	// "four" never meets "for", nor "good" "god".
	var ROMAJI_LIKE = /^(?:([bcdfghjkmprstz])(?=\1)|t(?=ch)|(?:sh|ch|ts|kw|gw|[kgsztdnhbpmrfvj]y|[kgsztdnhbpmyrwfjv])?[aiueo](?:h(?![aiueoy]))?|n(?![aiueoy])|m(?=[bpm]))+$/;
	var LETTERS = /^[a-z]+$/;
	// Plain ASCII needs no Unicode work (most titles and names are).
	var ASCII = /^[\x00-\x7F]*$/, ASCII_SEP = /[^A-Za-z0-9]+/, ASCII_WORD = /^[A-Za-z0-9]+$/;

	function romajiLike(s) { return ROMAJI_LIKE.test(str(s)); }
	var looseOf = memo(function (s) { return match().loose(s); });

	// The words of a text, as written: split at everything but letters and
	// digits, and between Japanese and other letters.
	var wordsOf = memo(function (text) {
		if (ASCII.test(text)) return text.split(ASCII_SEP).filter(Boolean);
		var out = [], pieces = text.normalize('NFKC').split(SEP);
		for (var i = 0; i < pieces.length; i++) {
			var m = pieces[i] && pieces[i].match(PIECE);
			for (var j = 0; m && j < m.length; j++) out.push(m[j]);
		}
		return out;
	});
	// A word's forms: s, the folded word with its kana read as romaji; l, its
	// loose spelling (match.js loose), only for kana and romaji-like words;
	// k, read from kana; parts, the kana runs inside a word with kanji.
	var NONE = [];
	function reading(kanaText) {
		var r = match().romaji(kanaText), s = ASCII_WORD.test(r) ? r : match().fold(r);
		return { s: s, l: looseOf(s), k: true, parts: NONE };
	}
	var formOf = memo(function (word) {
		var M = match();
		if (!CJK.test(word)) {
			var s = ASCII_WORD.test(word) ? word.toLowerCase() : M.fold(word);
			return { s: s, l: LETTERS.test(s) && ROMAJI_LIKE.test(s) ? looseOf(s) : '', k: false, parts: NONE };
		}
		// one kana alone is a particle (the no of "Vtuber no"): part of the title, not a word to find
		if (!HAN.test(word)) { var f = reading(word); f.one = word.length < 2; return f; }
		var parts = [], runs = word.match(KANA_RUN) || [];
		for (var i = 0; i < runs.length; i++) { var p = reading(runs[i]); if (p.s.length >= 2) parts.push(p); }
		return { s: M.fold(M.romaji(word)), l: '', k: false, parts: parts };
	});

	// ---- Typos --------------------------------------------------------------------------------

	// The typos a word of n letters may carry: none under 4 letters, 1 up to 7, 2 from 8.
	function allowed(n) { return n < 4 ? 0 : n < 8 ? 1 : 2; }
	// Damerau-Levenshtein distance (a swap of two neighbours is one edit), or
	// max + 1 as soon as it must be more than max.
	function distance(a, b, max) {
		a = str(a); b = str(b);
		if (max == null) max = Math.max(a.length, b.length);
		var n = a.length, m = b.length;
		if (Math.abs(n - m) > max) return max + 1;
		if (!n || !m) return Math.max(n, m);
		var before = [], prev = [], cur = [], i, j;
		for (j = 0; j <= m; j++) prev[j] = j;
		for (i = 1; i <= n; i++) {
			cur = [i];
			var low = i, ca = a.charCodeAt(i - 1);
			for (j = 1; j <= m; j++) {
				var cb = b.charCodeAt(j - 1);
				var v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca === cb ? 0 : 1));
				if (i > 1 && j > 1 && ca === b.charCodeAt(j - 2) && a.charCodeAt(i - 2) === cb) v = Math.min(v, before[j - 2] + 1);
				cur[j] = v;
				if (v < low) low = v;
			}
			if (low > max) return max + 1;
			before = prev; prev = cur;
		}
		return prev[m] > max ? max + 1 : prev[m];
	}
	// Typos rarely touch the first letter: it must be the same, or swapped with the second.
	function sameStart(a, b) { return a.charAt(0) === b.charAt(0) || (a.charAt(0) === b.charAt(1) && a.charAt(1) === b.charAt(0)); }
	function typoOf(t, w, a) {
		var d = a + 1;
		if (w.s.length < 4) return d;
		if (Math.abs(w.s.length - t.s.length) <= a && sameStart(t.s, w.s)) d = distance(t.s, w.s, a);
		if (d > 1 && t.l && w.l && Math.abs(w.l.length - t.l.length) <= a && sameStart(t.l, w.l)) d = Math.min(d, distance(t.l, w.l, a));
		return d;
	}

	// ---- The index ----------------------------------------------------------------------------

	// An index: the documents (ids, keys to sort ties by), every word once
	// with where it occurs (p: document * 4 + field class), lookups by the
	// word as written (latin), as read from kana (reading) and loosely
	// (loose), and the titles with their spaces taken out (t*).
	function emptyIndex() {
		return { ids: [], keys: [], docOf: new Map(), words: [], latin: new Map(), reading: new Map(), loose: new Map(), tD: [], tS: [], tL: [], tK: [], tN: [] };
	}
	function wordAt(ix, f) {
		var map = f.k ? ix.reading : ix.latin, at = map.get(f.s);
		if (at === undefined) {
			at = ix.words.length;
			map.set(f.s, at);
			ix.words.push({ s: f.s, l: f.l, k: f.k, p: [] });
			if (f.l) { var same = ix.loose.get(f.l); if (same) same.push(at); else ix.loose.set(f.l, [at]); }
		}
		return ix.words[at];
	}
	// Words run together, as written (s) and loosely (l: each word's loose
	// spelling, or the word when it has none; '' when no word has one).
	function joinedOf(forms) {
		var s = '', l = '', any = false;
		for (var i = 0; i < forms.length; i++) { s += forms[i].s; l += forms[i].l || forms[i].s; any = any || !!forms[i].l; }
		return { s: s, l: any ? l : '' };
	}
	function post(w, code) { if (w.p[w.p.length - 1] !== code) w.p.push(code); }
	function addDoc(ix, id, key) {
		var d = ix.ids.length;
		ix.ids.push(id);
		ix.keys.push(key);
		ix.docOf.set(id, d);
		return d;
	}
	function addField(ix, d, cls, text) {
		var words = wordsOf(text), forms = [], kana = false;
		for (var i = 0; i < words.length; i++) {
			var f = formOf(words[i]);
			if (!f.s) continue;
			if (!f.one) post(wordAt(ix, f), d * 4 + cls);
			for (var j = 0; j < f.parts.length; j++) post(wordAt(ix, f.parts[j]), d * 4 + cls);
			forms.push(f);
			kana = kana || f.k || f.parts.length > 0;
		}
		if (cls !== 0 || !forms.length) return;
		var j = joinedOf(forms);
		ix.tD.push(d);
		ix.tS.push(j.s);
		ix.tL.push(j.l);
		ix.tK.push(kana);
		ix.tN.push(forms.length);
	}
	// Ties are sorted by this: the artist, then the title.
	function keyOf(s) { return s.toLowerCase(); }

	// The index of a list of tracks (or { id: track }): title and titleAlt,
	// artist and artistNative, work, album and feat.
	function index(tracks) {
		var list = Array.isArray(tracks) ? tracks : Object.keys(tracks || {}).map(function (k) { return tracks[k]; });
		var ix = emptyIndex();
		for (var i = 0; i < list.length; i++) {
			var t = list[i];
			if (!t || t.id == null || ix.docOf.has(String(t.id))) continue;
			var d = addDoc(ix, String(t.id), keyOf(str(t.artist) + ' ' + str(t.title)));
			for (var j = 0; j < FIELDS.length; j++) {
				var v = t[FIELDS[j][0]];
				if (Array.isArray(v)) v = v.join(' ');
				if (v) addField(ix, d, FIELDS[j][1], str(v));
			}
		}
		return ix;
	}
	// The index of plain names (an artist with its native name, a work): each
	// is a title, its id its place in the list ('0', '1' ...).
	function nameIndex(names) {
		var ix = emptyIndex();
		(names || []).forEach(function (name, i) { var d = addDoc(ix, String(i), keyOf(str(name))); addField(ix, d, 0, str(name)); });
		return ix;
	}

	// ---- The search ---------------------------------------------------------------------------

	// The words one term meets, each with its points and kind, flat:
	// [word, points, how, ...]. known: it met something without typos, so
	// no typos are looked for (a word that exists was meant).
	function termHits(ix, t, last, single) {
		var W = ix.words.length, pts = new Float64Array(W), how = [], list = [], s = t.s, l = t.l, len = s.length, w, wd;
		// a word still being typed may end in the middle of a syllable ("touky")
		if (!l && last && LETTERS.test(s) && ROMAJI_LIKE.test(s + 'a')) l = looseOf(s);
		function hit(at, p, kind) { if (p > pts[at]) { if (!pts[at]) list.push(at); pts[at] = p; how[at] = kind; } }
		if (ix.latin.has(s)) hit(ix.latin.get(s), EXACT, 'exact');
		if (len >= 2) {
			if (ix.reading.has(s)) hit(ix.reading.get(s), EXACT, 'romaji');
			var same = l && len >= 3 ? ix.loose.get(l) || [] : [];
			for (var i = 0; i < same.length; i++) hit(same[i], LOOSE, 'loose');
			// The start of a word for the last term only (it is still being typed),
			// and short ones only after another term; inside a word from 3 letters
			// (4 in a kana reading, which is a whole sentence), as library search
			// finds a word inside another.
			var pre = last && len >= (single ? 3 : 2), inside = len >= 3, loosePre = pre && l.length >= 3, looseIn = l.length >= 4;
			for (w = 0; w < W && (inside || pre || l); w++) {
				wd = ix.words[w];
				if (wd.s.length > len) {
					var at = wd.s.indexOf(s);
					if (at === 0 && pre) { hit(w, PREFIX, wd.k ? 'romaji' : 'prefix'); continue; }
					if (at >= 0 && inside && (!wd.k || len >= 4)) { hit(w, INSIDE, wd.k ? 'romaji' : 'exact'); continue; }
				}
				if (l && wd.l && wd.l.length > l.length) {
					var la = wd.l.indexOf(l);
					if ((la === 0 && loosePre) || (la >= 0 && looseIn && wd.k)) hit(w, LOOSE, 'loose');
				}
			}
		}
		var known = list.length > 0, a = allowed(len);
		if (!known && a) {
			for (w = 0; w < W; w++) {
				var d = typoOf(t, ix.words[w], a);
				if (d <= a) hit(w, d > 1 ? TYPO2 : TYPO, 'typo');
			}
		}
		var out = [];
		for (var k = 0; k < list.length; k++) out.push(list[k], pts[list[k]], how[list[k]]);
		return { hits: out, known: known };
	}

	function termsOf(query) {
		var words = wordsOf(str(query)), out = [];
		for (var i = 0; i < words.length; i++) { var f = formOf(words[i]); if (f.s) out.push(f); }
		return out;
	}

	// Every term must meet a word of the document (the last may be the start
	// of a word); or the whole query, spaces taken out, meets a whole title.
	// -> [{ id, score, how }], best first. opts: not (ids, as a list or
	// { id: true }, left out), limit.
	function search(ix, query, opts) {
		opts = opts || {};
		var terms = termsOf(query), n = ix && ix.ids ? ix.ids.length : 0;
		if (!n || !terms.length) return [];
		var nt = terms.length, score = new Float64Array(n), low = new Float64Array(n), lowHow = [], ok = new Int32Array(n), unknown = false;
		var d, i;
		for (var ti = 0; ti < nt; ti++) {
			var r = termHits(ix, terms[ti], ti === nt - 1, nt === 1), hits = r.hits;
			if (!r.known) unknown = true;
			var best = new Float64Array(n), bestHow = [], touched = [];
			for (i = 0; i < hits.length; i += 3) {
				var p = ix.words[hits[i]].p, pts = hits[i + 1];
				for (var j = 0; j < p.length; j++) {
					d = p[j] >> 2;
					var v = pts + ((p[j] & 3) < 2 ? FIELD : 0);
					if (!best[d]) touched.push(d);
					if (v > best[d]) { best[d] = v; bestHow[d] = hits[i + 2]; }
				}
			}
			for (i = 0; i < touched.length; i++) {
				d = touched[i];
				if (ok[d] !== ti) continue;
				ok[d] = ti + 1;
				score[d] += best[d];
				if (!ti || best[d] < low[d]) { low[d] = best[d]; lowHow[d] = bestHow[d]; }
			}
		}
		// The whole query against whole titles: "kiminoshiranai", "kimi no shiranai" for a kana title.
		var qj = joinedOf(terms), qs = qj.s, ql = qj.l;
		var typos = unknown ? allowed(qs.length) : 0, whole = new Float64Array(n), wholeHow = [];
		for (i = 0; i < ix.tD.length; i++) {
			var ts = ix.tS[i], tl = ix.tL[i], pt = 0, kind = '';
			if (ts === qs || (qs.length >= 4 && ts.length > qs.length && ts.lastIndexOf(qs, 0) === 0)) {
				pt = ts === qs ? EXACT : PREFIX;
				kind = ix.tK[i] ? 'romaji' : nt > 1 || ix.tN[i] > 1 ? 'joined' : ts === qs ? 'exact' : 'prefix';
			} else if (ql && tl && (tl === ql || (ql.length >= 4 && tl.lastIndexOf(ql, 0) === 0))) { pt = LOOSE; kind = 'loose'; }
			else if (typos && Math.abs(ts.length - qs.length) <= typos && sameStart(qs, ts)) {
				var dd = distance(qs, ts, typos);
				if (dd <= typos) { pt = dd > 1 ? TYPO2 : TYPO; kind = 'typo'; }
			}
			if (!pt) continue;
			d = ix.tD[i];
			var sc = (pt + FIELD) * nt + WHOLE;
			if (sc > whole[d]) { whole[d] = sc; wholeHow[d] = kind; }
		}
		var not = Object.create(null);
		if (Array.isArray(opts.not)) opts.not.forEach(function (id) { not[String(id)] = true; });
		else if (opts.not) Object.keys(opts.not).forEach(function (id) { if (opts.not[id]) not[id] = true; });
		var out = [];
		for (d = 0; d < n; d++) {
			var each = ok[d] === nt ? score[d] : 0;
			if ((!each && !whole[d]) || not[ix.ids[d]]) continue;
			out.push({ id: ix.ids[d], score: Math.max(each, whole[d]), how: each ? lowHow[d] : wholeHow[d], key: ix.keys[d] });
		}
		out.sort(function (a, b) { return b.score - a.score || (a.key < b.key ? -1 : a.key > b.key ? 1 : a.id < b.id ? -1 : 1); });
		if (opts.limit > 0) out = out.slice(0, opts.limit);
		return out.map(function (o) { return { id: o.id, score: o.score, how: o.how }; });
	}

	// A list of names ranked against a query, for artists and works:
	// -> [{ i (the name's place), score, how }], best first.
	function rankNames(names, query, opts) {
		return search(nameIndex(names), query, opts).map(function (r) { return { i: +r.id, score: r.score, how: r.how }; });
	}

	// =========================================================================================
	// The page: the search page's Close matches and the palette's songs. Drawn only with ctx
	// (app.js pageCtx); titles are untrusted text and go on the page through ctx.h (textContent).
	// =========================================================================================

	var doc = root.document || null;
	var CSS = [
		'.ts-fz-note { margin: -4px 0 12px; font-size: 13.5px; color: var(--text-2); }',
		'.ts-fz-how { font-size: 12px; color: var(--text-2); white-space: nowrap; }'
	].join('\n');
	function ensureCss() {
		if (!doc || doc.getElementById('ts-fuzzy-css')) return;
		var st = doc.createElement('style');
		st.id = 'ts-fuzzy-css';
		st.textContent = CSS;
		(doc.head || doc.documentElement).appendChild(st);
	}

	// What the page has searched in: rebuilt when app.js's index is (after every change).
	var held = { ix: null };
	function prepared(ctx) {
		var ix = ctx.idx();
		if (held.ix !== ix) held = { ix: ix };
		if (!held.songs) {
			held.songs = index(ix.all || []);
			held.byId = Object.create(null);
			(ix.all || []).forEach(function (t) { held.byId[t.id] = t; });
		}
		return held;
	}
	function closeNames(c, kind, query) {
		if (!c[kind]) {
			var map = c.ix[kind] || {}, list = Object.keys(map).map(function (k) { return map[k]; });
			c[kind] = { list: list, ix: nameIndex(list.map(function (e) { return kind === 'artists' ? str(e.name) + (e.native ? ' ' + e.native : '') : str(e.key); })) };
		}
		var e = c[kind];
		return search(e.ix, query, { limit: CLOSE_NAMES }).map(function (r) { return e.list[+r.id]; });
	}

	// The search page's close matches: the songs exact search did not find,
	// and artists and works when it found none. found: { songs, artists,
	// works, chips (how many genres, moods and scenes matched) }.
	// -> { query, songs, how: { id: how }, artists, works, exact, alone }
	// (alone: the close songs are all the page would show).
	function closeMatches(ctx, query, found) {
		found = found || {};
		var have = found.songs || [], out = { query: str(query).trim(), songs: [], how: {}, artists: [], works: [], exact: have.length, alone: false };
		if (!ctx || !out.query) return out;
		var c = prepared(ctx), not = {};
		have.forEach(function (t) { not[t.id] = true; });
		search(c.songs, out.query, { not: not, limit: CLOSE_SONGS }).forEach(function (r) {
			var t = c.byId[r.id];
			if (t) { out.songs.push(t); out.how[r.id] = r.how; }
		});
		if (!(found.artists || []).length) out.artists = closeNames(c, 'artists', out.query);
		if (!(found.works || []).length) out.works = closeNames(c, 'works', out.query);
		out.alone = out.songs.length > 0 && !have.length && !(found.artists || []).length && !(found.works || []).length &&
			!out.artists.length && !out.works.length && !found.chips;
		return out;
	}

	// The Close matches section, after the exact results (nothing when there are none).
	function section(view, ctx, close) {
		if (!view || !ctx || !close || !close.songs.length) return;
		ensureCss();
		var h = ctx.h, w = ctx.words, ids = close.songs.map(function (t) { return t.id; });
		var context = { label: 'Close to ' + w.q(close.query), href: '#/search?q=' + encodeURIComponent(close.query) };
		var sec = h('section', { class: 'ts-fz', aria: { label: 'Close matches' } });
		sec.appendChild(h('div', { class: 'ts-sec-head' }, [
			h('h2', { text: 'Close matches (' + w.n(ids.length) + ')' }),
			ctx.ui.smallBtn('play', 'Play these', function () { ctx.play.from(ids, 0, context); })
		]));
		if (!close.exact) sec.appendChild(h('p', { class: 'ts-fz-note', text: 'Nothing matches ' + w.q(close.query) + ' exactly. These come close.' }));
		view.appendChild(sec);
		// A hint on each row only when the rows come close in different ways; otherwise it would only repeat itself.
		var kinds = {};
		close.songs.forEach(function (t) { kinds[close.how[t.id]] = true; });
		var mixed = Object.keys(kinds).length > 1;
		ctx.ui.trackList(sec, close.songs, {
			context: context, label: 'Close matches',
			extra: function (t) { var words = mixed && HOW[close.how[t.id]]; return words ? h('span', { class: 'ts-fz-how', text: ' ' + w.DOT + ' ' + words }) : null; }
		});
	}

	// The palette's songs: when exact search found few, close ones fill up to
	// eight. They come after the exact songs and after the artists and works
	// the palette's own matching found (8 and up), before genres and moods.
	// out is the palette's list of entries.
	function paletteSongs(ctx, query, out) {
		if (!ctx || !out || !str(query).trim()) return out;
		var have = out.filter(function (e) { return e.kind === 'Song'; });
		if (have.length >= PALETTE_FEW) return out;
		var c = prepared(ctx), not = {};
		have.forEach(function (e) { if (e.art) not[e.art.id] = true; });
		search(c.songs, query, { not: not, limit: PALETTE_SONGS - have.length }).forEach(function (r) {
			var t = c.byId[r.id], words = HOW[r.how];
			if (!t) return;
			out.push({ kind: 'Song', name: ctx.words.title(t), sub: ctx.words.artist(t) + (words ? ' ' + ctx.words.DOT + ' ' + words : ''), run: function () { ctx.play.now([t.id]); }, art: t, s: 7.5 });
		});
		return out;
	}

	return {
		HOW: HOW,
		index: index, nameIndex: nameIndex, search: search, rankNames: rankNames, distance: distance, allowed: allowed, romajiLike: romajiLike,
		closeMatches: closeMatches, section: section, paletteSongs: paletteSongs
	};
});
