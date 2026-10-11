/*
 * True Shuffle: rank your songs two at a time (duel.js). #/duel asks one easy
 * question over and over, "Which do you like more?"; each answer moves a score
 * per song and makes it surer. #/duel/ranking lists the songs by that score
 * and can turn the ranking into stars. The model is pure and runs in Node; the
 * drawing uses only the narrow view of the app that app.js hands page files
 * (pageCtx).
 *
 *     D.empty() -> a book with no duels
 *     D.record(book, winner, loser, { starsOf }) -> a new book
 *     D.skip(book, a, b, { starsOf }) -> a new book
 *     D.update(me, other, score) -> { r, rd }: one Glicko step
 *     D.pickPair(book, ids, rand, { starsOf, keyOf, sample }) -> [left, right] or null
 *     D.ranking(book, ids) -> [{ id, r, rd, n, w, sure }], best first
 *     D.starsPlan(rows, { ratingOf, all }) -> what "Set stars" would change
 *     D.pool(tracks, scope) -> ids       D.pack(book), D.unpack(value)
 *     D.view(view, ctx, parts, query)   #/duel and #/duel/ranking
 *
 * A book is { n: turns so far, s: { id: { r, rd, n, w, t } }, p: ['a|b'] }:
 * per song its score r, its uncertainty rd, its duels n, the ones it won w and
 * the turn it was last shown t; p the pairs shown lately, the last one last.
 *
 * UMD: window.TrueShuffle.duel in the browser, module.exports in Node.
 */
(function (root, factory) {
	var api = factory();
	if (typeof module === 'object' && module.exports) module.exports = api;
	else { root.TrueShuffle = root.TrueShuffle || {}; root.TrueShuffle.duel = api; }
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
	'use strict';

	var KEY = 'duel:scores';                        // the store's kv record
	var R0 = 1500, RD0 = 350, RD_MIN = 45;          // Glicko's start, and a floor so a score can still move
	var SURE_RD = 120, FAIR_RD = 200;               // about ten duels, about four
	var STAR_PRIOR = [0, -150, -75, 0, 75, 150];    // where a song starts: unrated, then one to five stars
	var SHARES = [[5, 0.1], [4, 0.3], [3, 0.7], [2, 0.9], [1, 1]];   // stars by place: the top 10%, the next 20%...
	var MIN_RANKED = 10;                            // stars need at least this many songs sure enough
	var PAIR_MEMORY = 200;                          // pairs not asked again for this many turns
	var SAMPLE = 60, REST = 3;                      // songs weighed per choice; turns a song rests after a duel
	var Q = Math.LN10 / 400;

	// ---- The model: Glicko, one duel at a time ----------------------------------------------

	function g(rd) { return 1 / Math.sqrt(1 + 3 * Q * Q * rd * rd / (Math.PI * Math.PI)); }
	// The chance that a song scored r is liked more than one scored rj, whose uncertainty is rdj.
	function expect(r, rj, rdj) { return 1 / (1 + Math.pow(10, -g(rdj) * (r - rj) / 400)); }

	// One Glicko step for `me` after a duel with `other`: score 1 when me was
	// picked, 0 when other was. The surprise moves the score, more for an unsure
	// song; every duel makes it surer. -> { r, rd }
	function update(me, other, score) {
		var gg = g(other.rd), e = expect(me.r, other.r, other.rd);
		var prec = 1 / (me.rd * me.rd) + Q * Q * gg * gg * e * (1 - e);
		return { r: me.r + Q / prec * gg * (score - e), rd: Math.max(RD_MIN, Math.sqrt(1 / prec)) };
	}

	function empty() { return { n: 0, s: {}, p: [] }; }
	function fresh(stars) {
		var k = Math.max(0, Math.min(5, Math.round(+stars || 0)));
		return { r: R0 + STAR_PRIOR[k], rd: RD0, n: 0, w: 0, t: 0 };
	}
	function entryOf(book, id, starsOf) { return book.s[id] || fresh(starsOf ? starsOf(id) : 0); }
	function pairKey(a, b) { return a < b ? a + '|' + b : b + '|' + a; }
	function remember(list, key) {
		var out = list.filter(function (k) { return k !== key; });
		out.push(key);
		return out.length > PAIR_MEMORY ? out.slice(out.length - PAIR_MEMORY) : out;
	}
	// A new book: one more turn, these entries replaced, this pair remembered.
	// The book given is never changed, so the one before a pick is its undo.
	function next(book, changes, key) {
		var s = {}, k;
		for (k in book.s) s[k] = book.s[k];
		for (k in changes) s[k] = changes[k];
		return { n: book.n + 1, s: s, p: remember(book.p, key) };
	}

	// `winner` was liked more than `loser`. A song meets the book with a score
	// from its stars (starsOf(id), 0 to 5). -> a new book
	function record(book, winner, loser, opts) {
		if (!winner || !loser || winner === loser) return book;
		var starsOf = opts && opts.starsOf, a = entryOf(book, winner, starsOf), b = entryOf(book, loser, starsOf);
		var ua = update(a, b, 1), ub = update(b, a, 0), turn = book.n + 1, ch = {};
		ch[winner] = { r: ua.r, rd: ua.rd, n: a.n + 1, w: a.w + 1, t: turn };
		ch[loser] = { r: ub.r, rd: ub.rd, n: b.n + 1, w: b.w, t: turn };
		return next(book, ch, pairKey(winner, loser));
	}
	// The pair could not be judged: no score moves, but both songs and the pair
	// rest like after a duel. -> a new book
	function skip(book, a, b, opts) {
		if (!a || !b || a === b) return book;
		var starsOf = opts && opts.starsOf, ch = {};
		[a, b].forEach(function (id) { var e = entryOf(book, id, starsOf); ch[id] = { r: e.r, rd: e.rd, n: e.n, w: e.w, t: book.n + 1 }; });
		return next(book, ch, pairKey(a, b));
	}

	// ---- Which two songs next ------------------------------------------------------------------

	function uniq(ids) {
		var seen = {}, out = [];
		(ids || []).forEach(function (id) { if (id && !seen[id]) { seen[id] = true; out.push(id); } });
		return out;
	}
	// k different items of a list, drawn with rand; the whole list when it is that short.
	function sampleOf(list, k, rand) {
		if (list.length <= k) return list;
		var out = [], seen = {};
		while (out.length < k) {
			var i = Math.floor(rand() * list.length);
			if (!seen[i]) { seen[i] = true; out.push(list[i]); }
		}
		return out;
	}
	// A song shown in the last duel waits unless nothing else is left; one shown
	// in the last few turns only when the others are much worse choices.
	function restOf(book, e) {
		if (!e.t) return 0;
		var ago = book.n - e.t;
		return ago <= 0 ? 5 : ago < REST ? 1 : 0;
	}

	// The next two songs to compare, from `ids` (the scope), or null when there
	// are fewer than two. The first is the song with most to learn: unsure, not
	// shown lately. The second is the partner that teaches most about it: a close
	// score (a toss-up says the most), unsure too, not met lately, and never
	// another upload of the same song (`keyOf(id)`, shuffle.js songKey). rand
	// (shuffle.js rng, or any source of [0, 1)) breaks ties and keeps the page
	// from being predictable; which side each song goes on is drawn too.
	// opts: { starsOf(id), keyOf(id), sample (60: songs weighed per choice) }
	function pickPair(book, ids, rand, opts) {
		opts = opts || {};
		var list = uniq(ids);
		if (list.length < 2) return null;
		rand = rand || Math.random;
		var size = opts.sample || SAMPLE, starsOf = opts.starsOf, keyOf = opts.keyOf, met = {};
		book.p.forEach(function (k) { met[k] = true; });
		var first = null, best = -Infinity;
		sampleOf(list, size, rand).forEach(function (id) {
			var e = entryOf(book, id, starsOf), sc = e.rd / RD0 - restOf(book, e) + rand() * 0.25;
			if (sc > best) { best = sc; first = id; }
		});
		var a = entryOf(book, first, starsOf), ka = keyOf ? keyOf(first) : '', second = null;
		best = -Infinity;
		sampleOf(list, size, rand).forEach(function (id) {
			if (id === first || (ka && keyOf(id) === ka)) return;
			var e = entryOf(book, id, starsOf);
			var p = 1 / (1 + Math.pow(10, -g(Math.sqrt(a.rd * a.rd + e.rd * e.rd)) * (a.r - e.r) / 400));
			var sc = 2.4 * p * (1 - p) + 0.4 * e.rd / RD0 - restOf(book, e) - (met[pairKey(first, id)] ? 10 : 0) + rand() * 0.2;
			if (sc > best) { best = sc; second = id; }
		});
		// a sample with nothing else in it, or only other uploads of the same song
		if (second == null) second = list.filter(function (id) { return id !== first && !(ka && keyOf(id) === ka); })[0] || list.filter(function (id) { return id !== first; })[0];
		return rand() < 0.5 ? [first, second] : [second, first];
	}

	// ---- The ranking and the stars -------------------------------------------------------------

	function sureness(rd) { return rd <= SURE_RD ? 'sure' : rd <= FAIR_RD ? 'fair' : 'unsure'; }
	// The songs of `ids` that have had a duel, best first: [{ id, r, rd, n, w, sure }];
	// sure is 'sure' (rd up to 120, about ten duels), 'fair' (200, about four) or 'unsure'.
	function ranking(book, ids) {
		var rows = [];
		uniq(ids).forEach(function (id) {
			var e = book.s[id];
			if (e && e.n > 0) rows.push({ id: id, r: e.r, rd: e.rd, n: e.n, w: e.w, sure: sureness(e.rd) });
		});
		rows.sort(function (a, b) { return b.r - a.r || a.rd - b.rd || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0); });
		return rows;
	}

	function starsAt(p) {
		for (var i = 0; i < SHARES.length; i++) if (p < SHARES[i][1]) return SHARES[i][0];
		return 1;
	}
	// What "Set stars from the ranking" would do. rows: ranking() (best first).
	// The songs sure enough (rd up to 200) get stars by their place among
	// themselves: the top 10% five, the next 20% four, the middle 40% three, the
	// next 20% two, the last 10% one. Only unrated songs change unless `all`.
	// -> { ok (at least 10 such songs), ranked (how many), unsure (the others),
	//      changes: [{ id, from, to }], counts: [0, ones, twos, threes, fours, fives] (of the changes),
	//      kept (rated songs left as they are), same (already right) }
	function starsPlan(rows, opts) {
		opts = opts || {};
		var ratingOf = opts.ratingOf || function () { return 0; };
		var sure = (rows || []).filter(function (x) { return x.rd <= FAIR_RD; });
		var out = { ok: sure.length >= MIN_RANKED, ranked: sure.length, unsure: (rows || []).length - sure.length, changes: [], counts: [0, 0, 0, 0, 0, 0], kept: 0, same: 0 };
		if (!out.ok) return out;
		sure.forEach(function (x, i) {
			var to = starsAt((i + 0.5) / sure.length), from = Math.max(0, Math.min(5, Math.round(+ratingOf(x.id) || 0)));
			if (from && !opts.all) { out.kept++; return; }
			if (from === to) { out.same++; return; }
			out.changes.push({ id: x.id, from: from, to: to });
			out.counts[to]++;
		});
		return out;
	}

	// ---- The songs a duel may ask about --------------------------------------------------------

	function listOf(tracks) {
		if (Array.isArray(tracks)) return tracks;
		var out = [];
		if (tracks && typeof tracks === 'object') for (var k in tracks) out.push(tracks[k]);
		return out;
	}
	// 'all', 'liked', 'unrated', 'work:<name>' or 'genre:<name>'; anything else is 'all'.
	function scopeOf(key) {
		var s = String(key || 'all'), i = s.indexOf(':');
		var kind = i > 0 ? s.slice(0, i) : s, value = i > 0 ? s.slice(i + 1) : '';
		if ((kind === 'work' || kind === 'genre') && value) return { key: s, kind: kind, value: value };
		if (kind === 'liked' || kind === 'unrated') return { key: kind, kind: kind, value: '' };
		return { key: 'all', kind: 'all', value: '' };
	}
	// The ids of the tracks (a list or { id: track }) a duel may ask about: playable
	// (library.js playable), not blocked, not a clip, not a found song; then the
	// scope: liked is four stars or more, unrated no stars, a work or a genre by name.
	function pool(tracks, scope) {
		var sc = scopeOf(scope), out = [];
		listOf(tracks).forEach(function (t) {
			if (!t || !t.id || t.removed || t.embeddable === false || t.playerError || t.blocked || t.kind === 'clip' || t.transient) return;
			if (sc.kind === 'liked' && !((+t.rating || 0) >= 4)) return;
			if (sc.kind === 'unrated' && +t.rating) return;
			if (sc.kind === 'work' && t.work !== sc.value) return;
			if (sc.kind === 'genre' && (t.genres || []).indexOf(sc.value) < 0) return;
			out.push(t.id);
		});
		return out;
	}

	// ---- Storage --------------------------------------------------------------------------------

	function round1(x) { return Math.round(x * 10) / 10; }
	function count(x) { x = Math.floor(+x); return isFinite(x) && x > 0 ? x : 0; }
	// The book as the store keeps it: { v: 1, n, s: { id: [r, rd, duels, won, turn] }, p }.
	function pack(book) {
		var s = {};
		for (var id in book.s) { var e = book.s[id]; s[id] = [round1(e.r), round1(e.rd), e.n, e.w, e.t]; }
		return { v: 1, n: book.n, s: s, p: book.p.slice() };
	}
	// A stored book back. A record that does not look right is left out, so a
	// damaged entry costs only itself; anything else gives an empty book.
	function unpack(v) {
		var b = empty();
		if (!v || typeof v !== 'object' || v.v !== 1) return b;
		b.n = count(v.n);
		if (v.s && typeof v.s === 'object') Object.keys(v.s).forEach(function (id) {
			var a = v.s[id];
			if (id === '__proto__' || !Array.isArray(a) || a.length < 5) return;
			var r = +a[0], rd = +a[1], n = count(a[2]), w = count(a[3]);
			if (!isFinite(r) || !isFinite(rd) || r < 0 || r > 4000 || rd <= 0 || w > n) return;
			b.s[id] = { r: r, rd: Math.max(RD_MIN, Math.min(RD0, rd)), n: n, w: w, t: Math.min(count(a[4]), b.n) };
		});
		if (Array.isArray(v.p)) b.p = v.p.filter(function (k) { return typeof k === 'string' && k.indexOf('|') > 0; }).slice(-PAIR_MEMORY);
		return b;
	}

	// =========================================================================================
	// The page. Drawn only with ctx (app.js pageCtx). Titles are untrusted text: everything
	// goes on the page through ctx.h, which uses textContent.
	// =========================================================================================

	var HUE = { h: 200, s: 55 };
	var UNDO_MAX = 20, SAVE_MS = 400, SETTLE_MS = 150, PAGE_ROWS = 100;
	var LEFT = String.fromCharCode(0x2190), RIGHT = String.fromCharCode(0x2192), STAR = String.fromCharCode(0x2605);
	var cx = null, ui = null, wired = false;
	var book = null, bookLib = null, loading = null, saveTimer = 0, unsaved = false, rand = null;
	// this visit's duels: how many, what Undo goes back to, the pair on screen
	var session = { picks: 0, undo: [], pair: null, shownAt: 0, last: '' };

	var CSS_ID = 'ts-duel-css';
	var CSS = [
		'.ts-duel-head.ts-hero { padding-top: 20px; padding-bottom: 14px; }',
		'.ts-duel-head .ts-hero-title { font-size: clamp(24px, 4.4cqi, 40px); }',
		'.ts-duel-tabs { display: flex; flex-wrap: wrap; gap: 6px; margin: 12px 0 0; }',
		// app.css's link hover would put the chosen tab's dark text on a pale ground
		'.ts-duel-tabs a.ts-chip.is-on:hover { background: var(--heading); border-color: var(--heading); }',
		'.ts-duel-scope { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin: 12px 0 0; }',
		'.ts-duel-scope-h { margin-right: 2px; font-size: 12.5px; font-weight: 650; color: var(--text-2); }',
		'.ts-duel-scope .ts-count { margin-left: 2px; }',
		'.ts-duel-q { margin: 18px 0 0; font-size: 20px; color: var(--heading); letter-spacing: -0.01em; }',
		'.ts-duel-pair { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; max-width: 860px; margin: 12px 0 0; }',
		'.ts-duel-side { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; min-width: 0; }',
		'.ts-duel-pick { position: relative; display: flex; flex-direction: column; align-items: stretch; gap: 10px; width: 100%; min-width: 0; margin: 0; padding: 10px 10px 14px; border: 1px solid var(--border-strong); border-radius: 16px; background: var(--surface); color: var(--text); font: inherit; text-align: left; cursor: pointer; transition: background var(--dur-fast), border-color var(--dur-fast), transform var(--dur-fast); animation: ts-duel-in 0.18s ease-out; }',
		'.ts-duel-pick:hover { background: var(--ts-hover); border-color: var(--text-2); }',
		'.ts-duel-pick:active { transform: scale(0.99); }',
		'.ts-duel-pick .ts-art { width: 100%; aspect-ratio: 16 / 9; border-radius: 10px; }',
		'@keyframes ts-duel-in { from { opacity: 0.35; transform: translateY(3px); } to { opacity: 1; transform: none; } }',
		'.ts-duel-key { position: absolute; top: 16px; left: 16px; z-index: 1; display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: 50%; border: 1px solid var(--border-strong); background: var(--surface); color: var(--heading); font-size: 13px; font-weight: 750; }',
		'.ts-duel-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; padding: 0 4px; }',
		'.ts-duel-title { font-size: 17px; font-weight: 750; line-height: 1.25; color: var(--heading); overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }',
		'.ts-duel-artist { font-size: 14px; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
		'.ts-duel-work { font-size: 13px; color: var(--text-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
		'.ts-duel-meta { margin-top: 3px; font-size: 12.5px; color: var(--text-2); }',
		'.ts-duel-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 10px; max-width: 860px; margin: 14px 0 0; }',
		'.ts-duel-progress { margin: 0 0 0 auto; font-size: 13px; color: var(--text-2); font-variant-numeric: tabular-nums; }',
		'.ts-duel-last { min-height: 1.45em; max-width: 860px; margin: 10px 0 0; font-size: 13.5px; color: var(--text); overflow-wrap: anywhere; }',
		'.ts-duel-foot { max-width: 72ch; margin: 22px 0 0; font-size: 12.5px; line-height: 1.5; color: var(--text-2); }',
		'.ts-duel-foot p { margin: 0 0 6px; }',
		'.ts-duel-empty { max-width: 62ch; margin: 18px 0 0; }',
		'.ts-duel-empty p { margin: 0 0 10px; }',
		'@container (max-width: 560px) {',
		'  .ts-duel-pair { grid-template-columns: minmax(0, 1fr); gap: 10px; }',
		'  .ts-duel-side { flex-direction: row; align-items: center; gap: 8px; }',
		'  .ts-duel-pick { flex: 1 1 0; width: auto; flex-direction: row; align-items: center; gap: 12px; padding: 8px 10px 8px 8px; }',
		'  .ts-duel-pick .ts-art { width: 64px; aspect-ratio: 1; flex: none; }',
		'  .ts-duel-key { top: 4px; left: 4px; width: 22px; height: 22px; font-size: 11.5px; }',
		'  .ts-duel-title { font-size: 15.5px; }',
		'  .ts-duel-progress { margin: 0; flex-basis: 100%; }',
		'}',
		'@media (hover: none), (pointer: coarse) { .ts-duel-key { display: none; } }',
		'@media (prefers-reduced-motion: reduce) { .ts-duel-pick { animation: none; } }',
		'html.is-reduced .ts-duel-pick { animation: none; }',
		'.ts-duel-sum { max-width: 72ch; margin: 16px 0 0; color: var(--text); line-height: 1.5; }',
		'.ts-duel-rank { list-style: none; max-width: 820px; margin: 8px 0 0; padding: 0; }',
		'.ts-duel-row { display: grid; grid-template-columns: 30px 44px minmax(0, 1fr); align-items: center; gap: 12px; padding: 6px 6px 6px 2px; border-radius: 10px; }',
		'.ts-duel-row:hover, .ts-duel-row:focus-within { background: var(--ts-hover); }',
		'.ts-duel-row .ts-art { width: 44px; height: 44px; border-radius: 6px; }',
		'.ts-duel-place { text-align: right; font-size: 15px; font-weight: 800; color: var(--text-2); font-variant-numeric: tabular-nums; }',
		'.ts-duel-rtext { display: flex; flex-direction: column; gap: 1px; min-width: 0; }',
		'.ts-duel-rtitle { font-weight: 650; color: var(--heading); text-decoration: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
		'.ts-duel-rtitle:hover { text-decoration: underline; }',
		'.ts-duel-rsub { font-size: 12.5px; color: var(--text-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
		'.ts-duel-conf { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; margin-top: 3px; font-size: 12.5px; color: var(--text-2); }',
		'.ts-duel-more { margin: 8px 0 0 2px; }',
		'.ts-duel-plan { list-style: none; margin: 10px 0 12px; padding: 0; }',
		'.ts-duel-plan li { display: flex; align-items: baseline; gap: 10px; padding: 4px 0; border-bottom: 1px solid var(--border); }',
		'.ts-duel-plan-s { width: 6.5em; flex: none; color: var(--text-2); letter-spacing: 1px; }',
		'.ts-duel-plan-l { flex: 1; color: var(--text); }',
		'.ts-duel-plan b { color: var(--heading); font-variant-numeric: tabular-nums; }',
		'.ts-duel-dlg p { margin: 0 0 10px; line-height: 1.5; }',
		'.ts-duel-dlg .ts-row-btns { justify-content: flex-end; margin: 14px 0 0; }',
		'.ts-duel-facets { list-style: none; max-height: min(52vh, 420px); overflow-y: auto; margin: 10px 0 0; padding: 0; }',
		'.ts-btn.ts-duel-facet { width: 100%; justify-content: space-between; border-radius: 10px; font-weight: 600; color: var(--text); }',
		'.ts-duel-facet .ts-count { margin-left: 12px; }'
	].join('\n');
	function injectCss() {
		if (typeof document === 'undefined' || document.getElementById(CSS_ID)) return;
		var s = document.createElement('style');
		s.id = CSS_ID;
		s.textContent = CSS;
		(document.head || document.documentElement).appendChild(s);
	}

	function kit() { return typeof ToyKit !== 'undefined' && ToyKit && ToyKit.load ? ToyKit : null; }
	function scopePref() { var k = kit(); return scopeOf(k ? k.load('duelScope', 'all') : 'all'); }
	// What the views count from: the index's tracks (Focus narrows them), else the library's.
	function tracksOf() {
		var ix = cx.idx ? cx.idx() : null;
		return ix && Array.isArray(ix.all) ? ix.all : listOf(cx.lib().tracks);
	}
	function trackOf(id) { return cx.lib().tracks[id] || null; }
	function starsOf(id) { var t = trackOf(id); return t ? +t.rating || 0 : 0; }
	function keyOf(id) { var t = trackOf(id); return t && cx.S && cx.S.songKey ? cx.S.songKey(t) : ''; }
	function titleOf(id) { var t = trackOf(id); return t ? cx.words.title(t) : 'this song'; }
	function opts() { return { starsOf: starsOf, keyOf: keyOf }; }

	// The book is read once per library: a restored backup or "Delete everything"
	// brings a new library object, and the book is read again from the store.
	function ensureBook() {
		var lib = cx.lib();
		if (book && bookLib === lib) return Promise.resolve(book);
		if (book) { book = null; loading = null; session.undo = []; session.pair = null; clearTimeout(saveTimer); unsaved = false; }
		if (!loading) {
			var st = cx.store ? cx.store() : null;
			loading = (st ? st.get(KEY, null) : Promise.resolve(null)).then(unpack, function () { return empty(); }).then(function (b) { book = b; bookLib = lib; return b; });
		}
		return loading;
	}
	function save() {
		unsaved = true;
		clearTimeout(saveTimer);
		saveTimer = setTimeout(flush, SAVE_MS);
	}
	function flush() {
		clearTimeout(saveTimer);
		if (!unsaved || !book || !cx || cx.thumb) return;
		var st = cx.store ? cx.store() : null;
		unsaved = false;
		if (st) st.set(KEY, pack(book)).catch(function (e) { cx.fail(new Error('Your duels could not be saved: ' + (e && e.message || e))); });
	}
	function wire() {
		if (wired || typeof document === 'undefined') return;
		wired = true;
		document.addEventListener('keydown', onKey, true);
		window.addEventListener('hashchange', flush);
		window.addEventListener('pagehide', flush);
	}

	// 1 or Left picks the left song, 2 or Right the right one, S skips, Backspace
	// undoes. A text field and an open dialog keep their keys; the arrows and
	// Backspace are taken only on this page's own controls (the queue and the
	// panel's tabs use them too). Captured before app.js's own keys (S shuffles again).
	function onKey(e) {
		if (!ui || ui.tab !== 'duel' || !ui.root.isConnected || !book || !session.pair) return;
		if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
		if (cx.U.dialogOpen && cx.U.dialogOpen()) return;
		var t = e.target, tag = (t && t.tagName) || '', k = e.key;
		if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag) || (t && t.isContentEditable)) return;
		var here = !t || t === document.body || ui.root.contains(t);
		var act = k === '1' ? function () { choose(0); } : k === '2' ? function () { choose(1); } : (k === 's' || k === 'S') ? skipPair
			: here && k === 'ArrowLeft' ? function () { choose(0); } : here && k === 'ArrowRight' ? function () { choose(1); } : here && k === 'Backspace' ? undo : null;
		if (!act) return;
		e.preventDefault();
		e.stopPropagation();
		if (!e.repeat) act();
	}
	function announce(text) {
		if (!ui || !ui.live) return;
		var live = ui.live;
		live.textContent = '';
		setTimeout(function () { live.textContent = text; }, 60);
	}

	// view(view, ctx, parts, query): app.js routes #/duel and #/duel/ranking here.
	function view(el, ctx, parts) {
		cx = ctx;
		injectCss();
		wire();
		if (!rand) rand = ctx.S && ctx.S.cryptoRng ? ctx.S.cryptoRng() : Math.random;
		var h = ctx.h, tab = parts && parts[0] === 'ranking' ? 'ranking' : 'duel';
		var box = h('div', { class: 'ts-duel' });
		var head = ctx.ui.headerBlock(box, { art: false, hue: HUE, kicker: 'Two songs at a time', title: 'Rank your songs' });
		head.classList.add('ts-duel-head');
		var tabs = h('nav', { class: 'ts-duel-tabs', aria: { label: 'Rank your songs' } });
		[['duel', 'Duel', ctx.link('duel')], ['ranking', 'Your ranking', ctx.link('duel', 'ranking')]].forEach(function (x) {
			var a = ctx.ui.chip(x[1], x[2], null, x[0] === tab ? 'is-on' : '');
			if (x[0] === tab) a.setAttribute('aria-current', 'page');
			tabs.appendChild(a);
		});
		box.appendChild(tabs);
		var body = h('div', { class: 'ts-duel-body' });
		var live = h('p', { class: 'kit-sr', role: 'status', aria: { live: 'polite' } });
		box.appendChild(body);
		box.appendChild(live);
		el.appendChild(box);
		var mine = ui = { root: box, body: body, live: live, tab: tab };
		if (book && bookLib === ctx.lib()) { drawBody(); return; }
		body.appendChild(h('p', { class: 'ts-muted ts-duel-empty', text: 'Loading your duels' + ctx.words.ELL }));
		ensureBook().then(function () { if (ui === mine && mine.root.isConnected) drawBody(); });
	}

	// The body again, the focus kept on the control that had it (by data-id).
	function drawBody() {
		if (!ui || !book) return;
		var body = ui.body, ae = typeof document !== 'undefined' ? document.activeElement : null;
		var had = ae && body.contains(ae) && ae.closest ? ae.closest('[data-id]') : null;
		var key = had ? had.getAttribute('data-id') : '';
		cx.clear(body);
		var all = tracksOf(), sc = scopePref(), ids = pool(all, sc.key);
		// a work or genre that has gone falls back to every song
		if ((sc.kind === 'work' || sc.kind === 'genre') && !ids.length) { sc = scopeOf('all'); ids = pool(all, 'all'); }
		if (!all.length) body.appendChild(emptyLibrary());
		else {
			body.appendChild(scopeRow(all, sc));
			if (ui.tab === 'ranking') drawRanking(body, all, ids, sc);
			else drawDuel(body, all, ids, sc);
		}
		if (key) {
			// Undo greys itself out when nothing is left to undo: the left song takes the focus then
			var back = body.querySelector('[data-id="' + key + '"]');
			if (!back || back.disabled) back = body.querySelector('[data-id="duel-pick-0"]');
			if (back) { try { back.focus({ preventScroll: true }); } catch (e) { /* gone */ } }
		}
	}
	function emptyLibrary() {
		var h = cx.h;
		return h('div', { class: 'ts-duel-empty' }, [
			h('p', { text: 'No songs yet. Import your playlists in Settings, then come back to rank them.' }),
			cx.U.btn({ icon: 'settings', label: 'Open Settings', variant: 'secondary', href: '#/settings' })
		]);
	}
	function scopeName(sc) { return sc.kind === 'liked' ? 'Liked songs' : sc.kind === 'unrated' ? 'Unrated songs' : sc.kind === 'all' ? 'All songs' : sc.value; }

	// The chips that pick which songs: all, liked, unrated, one anime or work, one genre.
	function scopeRow(all, sc) {
		var h = cx.h, U = cx.U, W = cx.words, row = h('div', { class: 'ts-duel-scope', role: 'group', aria: { label: 'Which songs' } });
		row.appendChild(h('span', { class: 'ts-duel-scope-h', text: 'Songs' }));
		function chip(key, label, n, on, fn) {
			var b = U.btn({ label: label, variant: 'chip', pressed: on, data: { id: 'duel-scope-' + key }, on: { click: fn } });
			if (n != null) b.appendChild(h('span', { class: 'ts-count', text: W.n(n) }));
			row.appendChild(b);
		}
		[['all', 'All songs'], ['liked', 'Liked'], ['unrated', 'Unrated']].forEach(function (x) {
			chip(x[0], x[1], pool(all, x[0]).length, sc.kind === x[0], function () { setScope(x[0]); });
		});
		var hasWorks = all.some(function (t) { return !!t.work; });
		if (hasWorks || sc.kind === 'work') chip('work', sc.kind === 'work' ? sc.value : 'Anime or work' + W.ELL, sc.kind === 'work' ? pool(all, sc.key).length : null, sc.kind === 'work', function () { pickFacet('work'); });
		chip('genre', sc.kind === 'genre' ? sc.value : 'Genre' + W.ELL, sc.kind === 'genre' ? pool(all, sc.key).length : null, sc.kind === 'genre', function () { pickFacet('genre'); });
		return row;
	}
	function setScope(key) {
		var k = kit();
		if (k) k.store('duelScope', key);
		session.pair = null;
		drawBody();
		announce(scopeName(scopeOf(key)) + '.');
	}
	// One anime or work, or one genre, from library.js facets over the songs a duel may ask about.
	function pickFacet(kind) {
		var h = cx.h, U = cx.U, W = cx.words;
		var list = cx.L.facets(cx.lib(), tracksOf().filter(function (t) { return pool([t], 'all').length; }), cx.now())[kind].filter(function (e) { return e.key && e.count >= 2; });
		var d = U.openDialog({ title: kind === 'work' ? 'Duel within one anime or work' : 'Duel within one genre' });
		d.node.classList.add('ts-duel-dlg');
		if (!list.length) { d.body.appendChild(h('p', { text: kind === 'work' ? 'No anime or work has two songs or more yet. The quick labeller can add them.' : 'No genre has two songs or more yet.' })); return; }
		var inp = h('input', { class: 'kit-input', type: 'search', placeholder: kind === 'work' ? 'Find an anime or work' : 'Find a genre', autocomplete: 'off', spellcheck: 'false', aria: { label: kind === 'work' ? 'Find an anime or work' : 'Find a genre' } });
		var ul = h('ul', { class: 'ts-duel-facets' });
		function fold(s) { return String(s || '').toLowerCase(); }
		function fill() {
			cx.clear(ul);
			var q = fold(inp.value.trim()), shown = list.filter(function (e) { return !q || fold(e.name).indexOf(q) >= 0; });
			shown.slice(0, 300).forEach(function (e) {
				var b = U.btn({ label: e.name, variant: 'ghost', size: 'md', cls: 'ts-duel-facet', on: { click: function () { d.close(); setScope(kind + ':' + e.key); } } });
				b.appendChild(h('span', { class: 'ts-count', text: W.plural(e.count, 'song') }));
				ul.appendChild(h('li', null, b));
			});
			if (!shown.length) ul.appendChild(h('li', { class: 'ts-muted', text: 'Nothing matches.' }));
		}
		inp.addEventListener('input', fill);
		d.body.appendChild(inp);
		d.body.appendChild(ul);
		fill();
		try { inp.focus(); } catch (e) { /* gone */ }
	}

	// ---- #/duel ---------------------------------------------------------------------------------

	function nextPair(ids) {
		session.pair = pickPair(book, ids, rand, opts());
		session.shownAt = Date.now();
	}
	function drawDuel(body, all, ids, sc) {
		var h = cx.h, U = cx.U, W = cx.words;
		if (ids.length < 2) {
			body.appendChild(h('p', { class: 'ts-duel-empty', text: 'A duel needs two songs, and ' + (sc.kind === 'all' ? 'the library has ' : 'this set has ') + (ids.length ? 'one' : 'none') + '. Pick another set above.' }));
			session.pair = null;
			return;
		}
		var inPool = {};
		ids.forEach(function (id) { inPool[id] = true; });
		var p = session.pair;
		if (!p || !inPool[p[0]] || !inPool[p[1]]) nextPair(ids);
		body.appendChild(h('h2', { class: 'ts-duel-q', text: 'Which do you like more?' }));
		var pair = h('div', { class: 'ts-duel-pair', role: 'group', aria: { label: 'Which do you like more?' } });
		pair.appendChild(sideOf(0));
		pair.appendChild(sideOf(1));
		body.appendChild(pair);
		body.appendChild(h('p', { class: 'ts-duel-last', text: session.last }));
		var ranked = 0, here = 0, seen = {};
		all.forEach(function (t) { var e = book.s[t.id]; if (e && e.n > 0 && !seen[t.id]) { seen[t.id] = true; ranked++; if (inPool[t.id]) here++; } });
		var bar = h('div', { class: 'ts-duel-bar' }, [
			U.btn({ icon: 'next', label: 'Skip', variant: 'secondary', kbd: 'S', title: 'Skip this pair (S)', data: { id: 'duel-skip' }, aria: { keyshortcuts: 'S' }, on: { click: skipPair } }),
			U.btn({ icon: 'back', label: 'Undo', variant: 'ghost', kbd: 'Backspace', disabled: !session.undo.length, data: { id: 'duel-undo' }, aria: { keyshortcuts: 'Backspace' }, on: { click: undo } }),
			h('p', { class: 'ts-duel-progress', text: W.plural(session.picks, 'duel') + ' this session ' + W.DOT + ' ' + W.plural(ranked, 'song') + ' ranked' + (sc.kind === 'all' ? '' : ' ' + W.DOT + ' ' + W.n(here) + ' of the ' + W.n(ids.length) + ' here') })
		]);
		body.appendChild(bar);
		body.appendChild(h('div', { class: 'ts-duel-foot' }, [
			h('p', { text: 'Click or tap the song you like more. Keys: 1 or ' + LEFT + ' for the left one, 2 or ' + RIGHT + ' for the right one, S skips a pair you cannot judge, Backspace undoes.' }),
			h('p', { text: 'Songs with few duels and close calls come first, so each answer teaches the most. Your duels are kept in this browser and in the backup file (Settings, Backup); stars set from the ranking sync like any rating.' })
		]));
	}
	function sideOf(side) {
		var h = cx.h, W = cx.words, T = cx.T || {}, id = session.pair[side], t = trackOf(id);
		var meta = (t.plays ? W.plural(t.plays, 'play') : 'never played') + ' ' + W.DOT + ' ' + (t.rating ? W.plural(t.rating, 'star') : 'no stars');
		var pick = h('button', { class: 'ts-duel-pick', data: { id: 'duel-pick-' + side, song: id }, aria: { keyshortcuts: side ? '2 ArrowRight' : '1 ArrowLeft' }, on: { click: function (e) { if (e.detail > 1) return; choose(side); } } }, [
			h('span', { class: 'ts-duel-key', aria: { hidden: 'true' }, text: side ? '2' : '1' }),
			cx.art(t),
			h('span', { class: 'ts-duel-text' }, [
				h('span', { class: 'kit-sr', text: 'Pick ' }),
				h('span', { class: 'ts-duel-title', text: W.title(t) }),
				h('span', { class: 'ts-duel-artist', text: W.artist(t) }),
				t.work ? h('span', { class: 'ts-duel-work', text: t.work + (t.role ? ' ' + W.DOT + ' ' + ((T.ROLE_NAME && T.ROLE_NAME[t.role]) || t.role) : '') }) : null,
				h('span', { class: 'ts-duel-meta', text: meta })
			])
		]);
		var hear = cx.U.btn({ icon: 'play', label: 'Hear it', variant: 'ghost', size: 'sm', title: 'Play ' + W.title(t) + ' now; the queue stays', data: { id: 'duel-hear-' + side }, on: { click: function () { cx.play.now([id]); } } });
		return h('div', { class: 'ts-duel-side' }, [pick, hear]);
	}
	function pushUndo(pick) {
		session.undo.push({ book: book, pair: session.pair, pick: pick, last: session.last });
		if (session.undo.length > UNDO_MAX) session.undo.shift();
	}
	function afterTurn(text) {
		session.last = text;
		save();
		var ids = pool(tracksOf(), scopePref().key);
		nextPair(ids.length >= 2 ? ids : pool(tracksOf(), 'all'));
		drawBody();
		if (session.pair) announce(text + ' Next: ' + titleOf(session.pair[0]) + ' or ' + titleOf(session.pair[1]) + '.');
	}
	// A pick that comes within a moment of the pair showing is a double click, not a choice.
	function choose(side) {
		if (!book || !session.pair || Date.now() - session.shownAt < SETTLE_MS) return;
		var p = session.pair, win = p[side], lose = p[1 - side];
		pushUndo(true);
		book = record(book, win, lose, opts());
		session.picks++;
		afterTurn('You picked ' + cx.words.q(titleOf(win)) + ' over ' + cx.words.q(titleOf(lose)) + '.');
	}
	function skipPair() {
		if (!book || !session.pair) return;
		pushUndo(false);
		book = skip(book, session.pair[0], session.pair[1], opts());
		afterTurn('Skipped ' + cx.words.q(titleOf(session.pair[0])) + ' and ' + cx.words.q(titleOf(session.pair[1])) + '.');
	}
	function undo() {
		var u = session.undo.pop();
		if (!u) return;
		book = u.book;
		session.pair = u.pair;
		session.shownAt = 0;
		session.last = u.last;
		if (u.pick) session.picks--;
		save();
		drawBody();
		announce('Undone. ' + titleOf(u.pair[0]) + ' or ' + titleOf(u.pair[1]) + '?');
	}

	// ---- #/duel/ranking -------------------------------------------------------------------------

	var SURE_WORDS = { sure: ['ok', 'Sure'], fair: ['new', 'Fairly sure'], unsure: ['library', 'Not sure yet'] };
	function drawRanking(body, all, ids, sc) {
		var h = cx.h, U = cx.U, W = cx.words, rows = ranking(book, ids);
		if (!rows.length) {
			body.appendChild(h('div', { class: 'ts-duel-empty' }, [
				h('p', { text: sc.kind === 'all' ? 'No duels yet. Pick the song you like more a few times, and your songs line up here.' : 'No duels among these songs yet.' }),
				U.btn({ icon: 'play', label: 'Start a duel', variant: 'primary', href: cx.link('duel') })
			]));
			return;
		}
		var c = { sure: 0, fair: 0, unsure: 0 };
		rows.forEach(function (x) { c[x.sure]++; });
		body.appendChild(h('p', { class: 'ts-duel-sum', text: W.plural(rows.length, 'song') + ' ranked' + (sc.kind === 'all' ? '' : ' here') + ': ' + W.n(c.sure) + ' sure, ' + W.n(c.fair) + ' fairly sure, ' + W.n(c.unsure) + ' not sure yet.' +
			(ids.length > rows.length ? ' ' + W.plural(ids.length - rows.length, 'song') + (ids.length - rows.length === 1 ? ' has' : ' have') + ' had no duel yet.' : '') + ' A song needs about four duels before its place means much.' }));
		var order = rows.map(function (x) { return x.id; }), playCtx = { label: sc.kind === 'all' ? 'Your ranking' : 'Your ranking: ' + scopeName(sc), href: cx.link('duel', 'ranking') };
		body.appendChild(h('div', { class: 'ts-row-btns' }, [
			U.btn({ icon: 'play', label: 'Play from the top', variant: 'primary', data: { id: 'duel-play' }, on: { click: function () { cx.play.from(order, 0, playCtx); } } }),
			U.btn({ icon: 'star', label: 'Set stars from the ranking' + W.ELL, variant: 'secondary', data: { id: 'duel-stars' }, on: { click: function () { starsDialog(rows, sc); } } })
		]));
		var ol = h('ol', { class: 'ts-duel-rank', aria: { label: 'Your ranking' } });
		var shown = Math.min(PAGE_ROWS, rows.length), i;
		for (i = 0; i < shown; i++) ol.appendChild(rowOf(rows[i], i));
		body.appendChild(ol);
		if (rows.length <= shown) return;
		var more = U.btn({ label: 'Show all ' + W.n(rows.length), variant: 'ghost', size: 'sm', cls: 'ts-duel-more', on: { click: function () {
			for (var j = shown; j < rows.length; j++) ol.appendChild(rowOf(rows[j], j));
			if (more.parentNode) more.parentNode.removeChild(more);
			var first = ol.children[shown] && ol.children[shown].querySelector('a');
			if (first) first.focus();
		} } });
		body.appendChild(more);
	}
	function rowOf(x, i) {
		var h = cx.h, W = cx.words, t = trackOf(x.id), sw = SURE_WORDS[x.sure];
		var conf = h('span', { class: 'ts-duel-conf' }, [
			cx.U.badge(sw[0], sw[1]),
			h('span', { text: W.plural(x.n, 'duel') + ', won ' + W.n(x.w) + (t.rating ? ' ' + W.DOT + ' ' : '') }),
			t.rating ? h('span', { aria: { label: W.plural(t.rating, 'star') } }, [h('span', { aria: { hidden: 'true' }, text: STAR + ' ' + t.rating })]) : null
		]);
		return h('li', { class: 'ts-duel-row' }, [
			h('span', { class: 'ts-duel-place', text: String(i + 1) }),
			cx.art(t),
			h('span', { class: 'ts-duel-rtext' }, [
				h('a', { class: 'ts-duel-rtitle', href: cx.link('track', x.id), text: W.title(t) }),
				h('span', { class: 'ts-duel-rsub', text: W.artist(t) + (t.work ? ' ' + W.DOT + ' ' + t.work : '') }),
				conf
			])
		]);
	}

	// Set stars from the ranking: a preview of what changes, the box for rated
	// songs, then one step, with Undo in the toast.
	function starsDialog(rows, sc) {
		var h = cx.h, U = cx.U, W = cx.words, all = false, plan = null;
		var d = U.openDialog({ title: 'Set stars from the ranking' });
		d.node.classList.add('ts-duel-dlg');
		var info = h('div');
		var box = U.check({ title: 'Also change songs that already have stars', desc: 'Off: only songs without stars get them.', checked: false, onChange: function (on) { all = on; fill(); } });
		var go = U.btn({ icon: 'star', label: 'Set stars', variant: 'primary', data: { id: 'duel-stars-go' }, on: { click: function () { if (!plan || !plan.changes.length) return; d.close(); applyStars(plan); } } });
		var cancel = U.btn({ label: 'Cancel', variant: 'ghost', on: { click: d.close } });
		d.body.appendChild(info);
		d.body.appendChild(box);
		d.body.appendChild(h('div', { class: 'ts-row-btns' }, [cancel, go]));
		function fill() {
			plan = starsPlan(rows, { ratingOf: starsOf, all: all });
			cx.clear(info);
			// Places only mean stars across all songs: within Liked, the last tenth would lose their like.
			box.hidden = !plan.ok || sc.kind !== 'all';
			if (!plan.ok) {
				info.appendChild(h('p', { text: 'Stars need at least ' + MIN_RANKED + ' songs ranked with enough duels (about four each), and ' + (sc.kind === 'all' ? 'there ' : 'here there ') + (plan.ranked === 1 ? 'is one' : 'are ' + W.n(plan.ranked)) + '. A few more duels first.' }));
				U.btnState(go, { disabled: true });
				return;
			}
			info.appendChild(h('p', { text: 'Among the ' + W.n(plan.ranked) + ' songs ranked ' + (sc.kind === 'all' ? '' : 'here ') + 'with enough duels, the top 10% get 5 stars, the next 20% get 4, the middle 40% get 3, the next 20% get 2 and the last 10% get 1.' }));
			var ul = h('ul', { class: 'ts-duel-plan', aria: { label: 'What would change' } });
			[5, 4, 3, 2, 1].forEach(function (k) {
				ul.appendChild(h('li', null, [
					h('span', { class: 'ts-duel-plan-s', aria: { hidden: 'true' }, text: new Array(k + 1).join(STAR) }),
					h('span', { class: 'ts-duel-plan-l', text: W.plural(k, 'star') }),
					h('b', { text: W.plural(plan.counts[k], 'song') })
				]));
			});
			info.appendChild(ul);
			var n = plan.changes.length, lose = 0, gain = 0, words = [];
			plan.changes.forEach(function (x) { if (x.from >= 4 && x.to < 4) lose++; if (x.from < 4 && x.to >= 4) gain++; });
			words.push(n ? W.plural(n, 'song') + (n === 1 ? ' gets' : ' get') + ' new stars.' : 'Nothing would change.');
			if (gain) words.push(W.plural(gain, 'song') + (gain === 1 ? ' joins' : ' join') + ' Liked songs (4 stars or more).');
			if (lose) words.push(W.plural(lose, 'liked song') + (lose === 1 ? ' leaves' : ' leave') + ' Liked songs.');
			if (plan.kept) words.push(W.plural(plan.kept, 'song') + ' that already ' + (plan.kept === 1 ? 'has' : 'have') + ' stars ' + (plan.kept === 1 ? 'keeps them' : 'keep them') + '.');
			if (plan.unsure) words.push(W.plural(plan.unsure, 'song') + (plan.unsure === 1 ? ' needs' : ' need') + ' more duels first and ' + (plan.unsure === 1 ? 'is' : 'are') + ' left alone.');
			info.appendChild(h('p', { text: words.join(' ') }));
			U.btnState(go, { disabled: !n, label: n ? 'Set stars for ' + W.plural(n, 'song') : 'Set stars' });
		}
		fill();
		try { (plan.ok && plan.changes.length ? go : cancel).focus(); } catch (e) { /* gone */ }
	}
	// One edit per number of stars (ctx.edit stamps the change for sync and saves
	// it); Undo puts every song back the same way.
	function applyStars(plan) {
		var to = {}, from = {};
		plan.changes.forEach(function (x) { (to[x.to] = to[x.to] || []).push(x.id); (from[x.from] = from[x.from] || []).push(x.id); });
		Object.keys(to).forEach(function (k) { cx.edit(to[k], { rating: +k }); });
		cx.U.toast('Stars set for ' + cx.words.plural(plan.changes.length, 'song') + '.', { action: 'Undo', onAction: function () {
			Object.keys(from).forEach(function (k) { cx.edit(from[k], { rating: +k }); });
			cx.say('The stars are back as they were.');
		} });
	}

	return {
		KEY: KEY, R0: R0, RD0: RD0, RD_MIN: RD_MIN, SURE_RD: SURE_RD, FAIR_RD: FAIR_RD, SHARES: SHARES, MIN_RANKED: MIN_RANKED, PAIR_MEMORY: PAIR_MEMORY,
		empty: empty, update: update, record: record, skip: skip, pickPair: pickPair, ranking: ranking, starsPlan: starsPlan,
		pool: pool, pack: pack, unpack: unpack, view: view
	};
});
