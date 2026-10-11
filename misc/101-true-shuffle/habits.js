/*
 * True Shuffle: listening habits (habits.js). Three things built on the play
 * history: the listening clock on Your numbers (#/stats: minutes by weekday and
 * hour, the streaks of days with a play, minutes per week), the home page's
 * "Usually at this hour", and Skip the intro, learned: a song you keep seeking
 * past the start of is offered a later start, once. The counting is pure and
 * runs in Node; the drawing uses only the narrow view of the app that app.js
 * hands page files (pageCtx).
 *
 *     H.clock(history, tracks, now, { local, offset, days }) -> { cells, max, minutes, listens, peak, from }
 *     H.clockText(clock) -> 'You listen most on Friday evenings, 9 to 10 pm.'
 *     H.streaks(history, tracks, now, { local, offset }) -> { current, currentFrom, today, longest, longestFrom, longestTo, days }
 *     H.weeks(history, tracks, now, { local, offset, n }) -> [{ from, minutes, current }]
 *     H.thisHour(history, tracks, now, { local, offset, days, span, min, least, n }) -> [{ id, plays, last }]
 *     H.momentText(now, { local, offset }) -> 'weekday evenings'
 *     H.seekDetector(opts) -> { feed(e), reset() }
 *     H.addSeek(list, seek, now) -> list      H.introOffer(id, seeks, history, { now, tol }) -> { start, seeks } | null
 *     H.statsSection(view, ctx)   H.homeLane(view, ctx)   H.watch(ctx, opts) -> { stop }
 *
 * history is the store's listens, { id, at, kind: 'play' | 'skip', listenedSec },
 * in any order; tracks is { id: track } or a list (null counts every listen; thisHour
 * needs them, to leave out what cannot play). Times are UTC unless { local: true } (the reader's clock, as the page passes)
 * or { offset }: minutes east of UTC, a number or a function of the moment.
 *
 * UMD: window.TrueShuffle.habits in the browser, module.exports in Node.
 */
(function (root, factory) {
	var api = factory(root);
	if (typeof module === 'object' && module.exports) module.exports = api;
	else { root.TrueShuffle = root.TrueShuffle || {}; root.TrueShuffle.habits = api; }
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this), function (root) {
	'use strict';

	var MIN = 60000, HOUR = 3600000, DAY = 86400000;
	var CLOCK_DAYS = 365, ENOUGH = 10;              // the clock's span; the listens it needs before it names a peak
	var WEEKS = 12;
	var LONGEST = 12 * 3600;                        // a longer listenedSec is a broken record, cut to this
	var HERE_DAYS = 120, HERE_SPAN = 60, HERE_MIN = 2, HERE_LEAST = 3, HERE_N = 12;
	// Skip the intro: a seek from under FROM seconds to a point between LO and HI; seeks a
	// listener makes in a row (CHAIN_MS apart) are one; a seek counts once playback has gone
	// on for SETTLE_MS. Two of a song's last three plays with seeks within TOL seconds of each
	// other make an offer.
	var FROM = 15, LO = 10, HI = 120, SLACK = 2.5, SETTLE_MS = 1500, CHAIN_MS = 3000, TOL = 8, LAST = 3, NEED = 2;
	var KEEP = 300, KEEP_DAYS = 365;                 // the seeks kept (kv habits:seeks)
	var DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
	var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

	// ---- Time ---------------------------------------------------------------------------------

	function toMs(v) {
		if (typeof v === 'number') return isFinite(v) ? v : NaN;
		if (v instanceof Date) return v.getTime();
		if (typeof v === 'string' && v) return Date.parse(v);
		return NaN;
	}
	function nowOf(v) { var t = toMs(v); return isNaN(t) ? Date.now() : t; }
	// Minutes east of UTC at a moment: opts.offset (a number or a function), the reader's clock, or UTC.
	function zoneOf(opts) {
		var off = opts && opts.offset;
		if (typeof off === 'function') return function (ms) { return +off(ms) || 0; };
		if (typeof off === 'number' && isFinite(off)) return function () { return off; };
		if (opts && opts.local) return function (ms) { return -new Date(ms).getTimezoneOffset(); };
		return function () { return 0; };
	}
	// The calendar parts of a moment in a zone; wd is 0 for Monday.
	function partsAt(ms, zone) {
		var d = new Date(ms + zone(ms) * MIN);
		return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes(), wd: (d.getUTCDay() + 6) % 7 };
	}
	function pad(k) { return (k < 10 ? '0' : '') + k; }
	// Days in a row differ by one, whatever the clocks did in between.
	function dayNumber(p) { return Math.round(Date.UTC(p.y, p.m, p.d) / DAY); }
	function keyOf(dn) { var d = new Date(dn * DAY); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); }
	// Weeks start on Monday: day 0 (1970-01-01) was a Thursday.
	function weekOf(dn) { return Math.floor((dn + 3) / 7); }
	function mondayOf(w) { return 7 * w - 3; }
	function zeros(k) { var a = []; for (var i = 0; i < k; i++) a.push(0); return a; }
	function cmp(a, b) { return a < b ? -1 : a > b ? 1 : 0; }

	// ---- Tracks and listens -------------------------------------------------------------------

	function trackMap(tracks) {
		if (!tracks) return null;
		if (!Array.isArray(tracks)) return tracks;
		var m = {};
		tracks.forEach(function (t) { if (t && t.id != null) m[t.id] = t; });
		return m;
	}
	function known(map, id) { return id != null && (!map || (Object.prototype.hasOwnProperty.call(map, id) && !!map[id])); }
	function listen(e, map) { return !!e && (e.kind === 'play' || e.kind === 'skip') && known(map, e.id) && !isNaN(toMs(e.at)); }
	// library.js playable(), not blocked, not a clip
	function canPlay(t) { return !!t && !t.removed && t.embeddable !== false && !t.playerError && !t.blocked && t.kind !== 'clip'; }

	// What a listen was heard for, cut at the zone's hour boundaries: fn(start ms, seconds,
	// parts) for each piece. A listen ends at e.at and began listenedSec before it. On the
	// day the clocks go back an hour comes twice and both count as it; going forward, the
	// hour that never happens gets nothing.
	function pieces(e, zone, fn) {
		var sec = Math.min(LONGEST, Math.max(0, +e.listenedSec || 0)), end = toMs(e.at);
		if (!(sec > 0) || isNaN(end)) return;
		var t = end - sec * 1000;
		while (t < end) {
			var off = zone(t) * MIN, next = Math.floor((t + off) / HOUR) * HOUR + HOUR - off, stop = Math.min(next, end);
			fn(t, (stop - t) / 1000, partsAt(t, zone));
			t = stop;
		}
	}

	// ---- The listening clock ------------------------------------------------------------------
	// Minutes heard (plays and skips) by weekday (Monday first) and hour, over the last
	// opts.days (365). cells[day][hour] are minutes to a tenth; peak is the busiest hour,
	// the first of equals; from is the first listen counted.

	function clock(history, tracks, now, opts) {
		opts = opts || {};
		var at = nowOf(now), zone = zoneOf(opts), map = trackMap(tracks);
		var days = opts.days > 0 ? opts.days : CLOCK_DAYS, since = at - days * DAY;
		var sec = [0, 1, 2, 3, 4, 5, 6].map(function () { return zeros(24); }), total = 0, listens = 0, from = 0;
		(history || []).forEach(function (e) {
			if (!listen(e, map)) return;
			var t = toMs(e.at);
			if (t > at || t <= since) return;
			listens++;
			if (!from || t < from) from = t;
			pieces(e, zone, function (s, x, p) { sec[p.wd][p.h] += x; total += x; });
		});
		var max = 0, peak = null;
		var cells = sec.map(function (row, d) {
			return row.map(function (x, hr) {
				var v = Math.round(x / 6) / 10;
				if (v > max) { max = v; peak = { day: d, hour: hr, minutes: v }; }
				return v;
			});
		});
		return { cells: cells, max: max, minutes: Math.round(total / 60), listens: listens, peak: peak, from: from, days: days };
	}

	function hourWord(hr) { return hr === 0 ? 'midnight' : hr === 12 ? 'noon' : (hr % 12) + (hr < 12 ? ' am' : ' pm'); }
	// One hour as words: '9 to 10 pm', '11 am to noon', 'midnight to 1 am'.
	function hourSpan(hr) {
		var b = (hr + 1) % 24;
		if (hr === 0 || hr === 11 || hr === 12 || hr === 23) return hourWord(hr) + ' to ' + hourWord(b);
		return (hr % 12) + ' to ' + hourWord(b);
	}
	function partOf(hr) { return hr < 5 ? 'nights' : hr < 12 ? 'mornings' : hr < 17 ? 'afternoons' : hr < 23 ? 'evenings' : 'nights'; }
	// 'You listen most on Friday evenings, 9 to 10 pm.' The small hours belong to the night
	// before: 1 am on a Saturday is "Friday nights". '' until ENOUGH listens.
	function clockText(c) {
		if (!c || !c.peak || !(c.listens >= ENOUGH)) return '';
		var day = c.peak.day, hr = c.peak.hour;
		if (hr < 5) day = (day + 6) % 7;
		return 'You listen most on ' + DAYS[day] + ' ' + partOf(hr) + ', ' + hourSpan(hr) + '.';
	}

	// ---- Streaks ------------------------------------------------------------------------------
	// Days (the zone's) with at least one play, as Your year counts them. The current streak
	// ends today, or yesterday when today has no play yet; the longest is the first of equals.

	function streaks(history, tracks, now, opts) {
		var at = nowOf(now), zone = zoneOf(opts), map = trackMap(tracks), seen = {};
		(history || []).forEach(function (e) {
			if (!listen(e, map) || e.kind !== 'play') return;
			var t = toMs(e.at);
			if (t <= at) seen[dayNumber(partsAt(t, zone))] = true;
		});
		var dns = Object.keys(seen).map(Number).sort(function (a, b) { return a - b; });
		var out = { current: 0, currentFrom: '', today: false, longest: 0, longestFrom: '', longestTo: '', days: dns.length };
		var run = 0, first = 0;
		dns.forEach(function (dn, i) {
			if (i && dn === dns[i - 1] + 1) run++;
			else { run = 1; first = dn; }
			if (run > out.longest) { out.longest = run; out.longestFrom = keyOf(first); out.longestTo = keyOf(dn); }
		});
		var today = dayNumber(partsAt(at, zone)), end = seen[today] ? today : seen[today - 1] ? today - 1 : null;
		out.today = !!seen[today];
		if (end != null) {
			var k = end;
			while (seen[k - 1]) k--;
			out.current = end - k + 1;
			out.currentFrom = keyOf(k);
		}
		return out;
	}

	// ---- Minutes per week ---------------------------------------------------------------------
	// The last n (12) weeks, Monday first, the current one last (so far); from is its Monday.

	function weeks(history, tracks, now, opts) {
		opts = opts || {};
		var at = nowOf(now), zone = zoneOf(opts), map = trackMap(tracks), n = opts.n > 0 ? Math.floor(opts.n) : WEEKS;
		var last = weekOf(dayNumber(partsAt(at, zone))), first = last - n + 1, sec = zeros(n);
		var since = at - (n * 7 + 2) * DAY;
		(history || []).forEach(function (e) {
			if (!listen(e, map)) return;
			var t = toMs(e.at);
			if (t > at || t < since) return;
			pieces(e, zone, function (s, x, p) { var w = weekOf(dayNumber(p)) - first; if (w >= 0 && w < n) sec[w] += x; });
		});
		return sec.map(function (x, i) { return { from: keyOf(mondayOf(first + i)), minutes: Math.round(x / 60), current: i === n - 1 }; });
	}

	// ---- Usually at this hour -----------------------------------------------------------------
	// The songs played most (plays, not skips) within opts.span (60) minutes either side of
	// now's time of day, on the same kind of day (weekday or weekend), in the last opts.days
	// (120). A play counts where it began. Each song needs opts.min (2) plays; fewer than
	// opts.least (3) such songs is too little to go on, and gives []. Blocked, unplayable
	// songs and clips are left out. Most played first, then the latest; opts.n (12) at most.

	function weekend(wd) { return wd >= 5; }
	function thisHour(history, tracks, now, opts) {
		opts = opts || {};
		var at = nowOf(now), zone = zoneOf(opts), map = trackMap(tracks) || {};
		var since = at - (opts.days > 0 ? opts.days : HERE_DAYS) * DAY, span = opts.span > 0 ? opts.span : HERE_SPAN;
		var min = opts.min > 0 ? opts.min : HERE_MIN, least = opts.least > 0 ? opts.least : HERE_LEAST, n = opts.n > 0 ? Math.floor(opts.n) : HERE_N;
		var np = partsAt(at, zone), mNow = np.h * 60 + np.mi, wkEnd = weekend(np.wd);
		var c = {}, last = {};
		(history || []).forEach(function (e) {
			if (!listen(e, map) || e.kind !== 'play') return;
			var end = toMs(e.at);
			if (end > at || end < since) return;
			var p = partsAt(end - Math.min(LONGEST, Math.max(0, +e.listenedSec || 0)) * 1000, zone);
			if (weekend(p.wd) !== wkEnd) return;
			var d = Math.abs(p.h * 60 + p.mi - mNow);
			if (Math.min(d, 1440 - d) > span) return;
			c[e.id] = (c[e.id] || 0) + 1;
			if (!(last[e.id] >= end)) last[e.id] = end;
		});
		var out = Object.keys(c).filter(function (id) { return c[id] >= min && canPlay(map[id]); }).sort(function (a, b) {
			return c[b] - c[a] || last[b] - last[a] || cmp(a, b);
		}).map(function (id) { return { id: id, plays: c[id], last: last[id] }; });
		return out.length < least ? [] : out.slice(0, n);
	}
	// What kind of time now is: 'weekday evenings', 'weekend mornings'.
	function momentText(now, opts) {
		var p = partsAt(nowOf(now), zoneOf(opts));
		return (weekend(p.wd) ? 'weekend ' : 'weekday ') + partOf(p.h);
	}

	// ---- Skip the intro: the seek detector ----------------------------------------------------
	// Fed the player's time events, { id, current (s), at (wall ms), rate, playingFrom (wall
	// ms since when it has played without a stop, 0 when it is not playing) }. A seek is a
	// jump the clock cannot explain: more than SLACK seconds beyond what playing since the
	// last event could cover, or any step back. A forward seek from under FROM seconds that
	// lands between LO and HI is kept; further seeks within CHAIN_MS move where it lands (the
	// arrow keys go 5 s at a time); once playback has gone on SETTLE_MS from the last one,
	// feed() returns it, { id, from, to, at }, once. A new song, or reset(), forgets it.

	function seekDetector(opts) {
		opts = opts || {};
		var from = opts.from > 0 ? opts.from : FROM, lo = opts.min > 0 ? opts.min : LO, hi = opts.max > 0 ? opts.max : HI;
		var slack = opts.slack > 0 ? opts.slack : SLACK, settle = opts.settleMs > 0 ? opts.settleMs : SETTLE_MS, chain = opts.chainMs > 0 ? opts.chainMs : CHAIN_MS;
		var last = null, pending = null;
		function reset() { last = null; pending = null; }
		function feed(e) {
			if (!e || e.id == null || !isFinite(+e.current) || !isFinite(+e.at)) return null;
			var t = +e.at, cur = +e.current, out = null;
			if (last && last.id !== e.id) reset();
			if (!last) { last = { id: e.id, current: cur, at: t }; return null; }
			var played = e.playingFrom > 0 ? Math.max(0, t - Math.max(last.at, +e.playingFrom)) / 1000 * (e.rate > 0 ? +e.rate : 1) : 0;
			var step = cur - last.current;
			if (step > played + slack || step < -slack) {
				if (pending && t - pending.at <= chain) { pending.to = cur; pending.at = t; }
				else if (step > 0 && last.current < from) pending = { id: e.id, from: last.current, to: cur, at: t };
				else pending = null;
				if (pending && (pending.to < lo || pending.to > hi)) pending = null;
			} else if (pending && t - pending.at >= settle) {
				out = { id: pending.id, from: Math.round(pending.from * 10) / 10, to: Math.round(pending.to * 10) / 10, at: pending.at };
				pending = null;
			}
			last = { id: e.id, current: cur, at: t };
			return out;
		}
		return { feed: feed, reset: reset };
	}

	// The kept seeks after one more: { id, to, at } appended, those older than a year
	// dropped, the newest KEEP (300) kept. A new list; the old one is not changed.
	function addSeek(list, seek, now) {
		var at = nowOf(now), old = at - KEEP_DAYS * DAY;
		var out = (Array.isArray(list) ? list : []).filter(function (s) { return s && s.id != null && isFinite(+s.to) && +s.at > old; });
		if (seek && seek.id != null && isFinite(+seek.to) && isFinite(+seek.at)) out.push({ id: seek.id, to: +seek.to, at: +seek.at });
		out.sort(function (a, b) { return a.at - b.at; });
		return out.length > KEEP ? out.slice(out.length - KEEP) : out;
	}

	// Should the song start later? Its last three plays in the history (listens before
	// opts.now), each with the last seek made while it played (after the play before it
	// ended, up to its own end). Two of them (NEED) landing within opts.tol (8) seconds of
	// each other offer the earliest of them: -> { start (whole seconds), seeks } or null.
	function introOffer(id, seeks, history, opts) {
		opts = opts || {};
		var tol = opts.tol > 0 ? opts.tol : TOL, now = toMs(opts.now);
		if (isNaN(now)) now = Infinity;
		var ends = (history || []).filter(function (e) { return listen(e, null) && e.id === id && toMs(e.at) <= now; }).map(function (e) { return toMs(e.at); }).sort(function (a, b) { return b - a; });
		var mine = (seeks || []).filter(function (s) { return s && s.id === id && isFinite(+s.to) && isFinite(+s.at); }).sort(function (a, b) { return a.at - b.at; });
		var tos = [];
		for (var k = 0; k < Math.min(LAST, ends.length); k++) {
			var top = ends[k], bottom = k + 1 < ends.length ? ends[k + 1] : -Infinity, hit = null;
			mine.forEach(function (s) { if (s.at > bottom && s.at <= top) hit = s; });
			if (hit) tos.push(+hit.to);
		}
		tos.sort(function (a, b) { return a - b; });
		var best = null;
		tos.forEach(function (v) {
			var group = tos.filter(function (x) { return x >= v && x <= v + tol; });
			if (group.length >= NEED && (!best || group.length > best.length)) best = group;
		});
		return best ? { start: Math.floor(best[0]), seeks: best.length } : null;
	}

	// =========================================================================================
	// The page. Drawn only with ctx (app.js pageCtx). Titles are untrusted text: everything
	// goes on the page through ctx.h, which uses textContent.
	// =========================================================================================

	var CSS_ID = 'ts-habits-css';
	var CSS = [
		'.ts-hb { margin: 0 0 26px; }',
		'.ts-hb .ts-sec-head { margin-top: 8px; }',
		'.ts-hb-lede { margin: -4px 0 12px; max-width: 72ch; font-size: 14px; color: var(--text); }',
		'.ts-hb-empty { max-width: 62ch; margin: 0; }',
		'.ts-hb-wrap { display: grid; grid-template-columns: minmax(0, 1fr); gap: 14px; align-items: start; }',
		'@container (min-width: 900px) { .ts-hb-wrap { grid-template-columns: minmax(0, 1.5fr) minmax(0, 1fr); } }',
		'.ts-hb-side { display: grid; gap: 14px; min-width: 0; }',
		'.ts-hb-card { margin: 0; min-width: 0; padding: 14px 16px 12px; border: 1px solid var(--border); border-radius: 12px; background: var(--surface); }',
		'.ts-hb-card figcaption { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 10px; }',
		'.ts-hb-card h3 { margin: 0; font-size: 15.5px; color: var(--heading); }',
		'.ts-hb-card figcaption span { font-size: 12.5px; color: var(--text-2); }',
		'.ts-hb-note { margin: 2px 0 10px; min-height: 1.45em; font-size: 12.5px; color: var(--text-2); }',
		'.ts-hb-heat, .ts-hb-hours { display: grid; grid-template-columns: 2.4em repeat(24, minmax(0, 1fr)); gap: 2px; max-width: 760px; }',
		'.ts-hb-day { align-self: center; font-size: 11px; line-height: 1; color: var(--text-2); }',
		'.ts-hb-cell { display: block; aspect-ratio: 1 / 1; min-height: 8px; border-radius: 3px; background: var(--surface-2); }',
		'.ts-hb-cell[data-l="1"] { background: color-mix(in srgb, var(--ts-bar-fill) 34%, var(--surface-2)); }',
		'.ts-hb-cell[data-l="2"] { background: color-mix(in srgb, var(--ts-bar-fill) 58%, var(--surface-2)); }',
		'.ts-hb-cell[data-l="3"] { background: color-mix(in srgb, var(--ts-bar-fill) 80%, var(--surface-2)); }',
		'.ts-hb-cell[data-l="4"] { background: var(--ts-bar-fill); }',
		'.ts-hb-cell.is-hover { box-shadow: 0 0 0 2px var(--text-2); }',
		'.ts-hb-cell.is-peak { box-shadow: 0 0 0 2px var(--heading); }',
		'.ts-hb-hours { margin-top: 5px; font-size: 11px; color: var(--text-2); }',
		'.ts-hb-hours span { grid-column: span 6; white-space: nowrap; }',
		'.ts-hb-hours span:first-child { grid-column: span 1; }',
		'.ts-hb-legend { display: flex; flex-wrap: wrap; align-items: center; gap: 3px; margin-top: 10px; font-size: 11px; color: var(--text-2); }',
		'.ts-hb-legend .ts-hb-cell { width: 11px; height: 11px; min-height: 0; aspect-ratio: auto; }',
		'.ts-hb-legend .ts-hb-gap { width: 6px; }',
		'.ts-hb-legend .ts-hb-ring { width: 9px; height: 9px; margin: 0 2px 0 14px; border-radius: 3px; box-shadow: 0 0 0 2px var(--heading); }',
		'.ts-hb-tiles { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }',
		'.ts-hb-tiles .ts-stat { min-width: 0; }',
		'.ts-hb-sub { font-size: 12px; color: var(--text-2); overflow-wrap: anywhere; }',
		'.ts-hb-cols { display: flex; align-items: flex-end; gap: 4px; height: 118px; padding-top: 20px; border-bottom: 1px solid var(--border); }',
		'.ts-hb-col { flex: 1 1 0; min-width: 0; height: 100%; display: flex; align-items: flex-end; justify-content: center; }',
		'.ts-hb-col i { position: relative; display: block; width: 100%; max-width: 28px; border-radius: 4px 4px 0 0; background: var(--ts-bar-fill); }',
		'.ts-hb-col.is-now i { background: repeating-linear-gradient(135deg, var(--ts-bar-fill) 0 3px, color-mix(in srgb, var(--ts-bar-fill) 40%, transparent) 3px 6px); }',
		'.ts-hb-col.is-hover i { filter: brightness(1.2); }',
		'.ts-hb-col b { position: absolute; left: 50%; bottom: 100%; transform: translateX(-50%); margin-bottom: 3px; font-size: 11.5px; font-style: normal; font-weight: 700; color: var(--heading); white-space: nowrap; }',
		'.ts-hb-col:first-child b { left: 0; transform: none; }',
		'.ts-hb-col:last-child b { left: auto; right: 0; transform: none; }',
		'.ts-hb-axis { position: relative; height: 1.5em; margin-top: 5px; font-size: 11px; color: var(--text-2); }',
		'.ts-hb-axis span { position: absolute; top: 0; white-space: nowrap; }',
		'.ts-hb-axis span.is-end { right: 0; }',
		'.ts-hb-lane-lede { margin: -6px 0 10px; font-size: 13px; color: var(--text-2); }',
		'.ts-hb-ask { position: fixed; z-index: var(--ts-z-toast); left: calc((100vw - var(--ts-safe-right, 0px)) / 2); bottom: calc(var(--ts-bar) + 84px); transform: translateX(-50%); width: max-content; max-width: min(480px, calc(100vw - var(--ts-safe-right, 0px) - 24px)); display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; padding: 12px 10px 12px 16px; border-radius: 12px; background: var(--heading); color: var(--bg); box-shadow: var(--ts-e2); font-size: 14px; }',
		'.ts-hb-ask[hidden] { display: none; }',
		'body.has-pvbar .ts-hb-ask { bottom: calc(var(--ts-bar) + 170px); }',
		'.ts-hb-ask-t { flex: 1 1 230px; min-width: 0; }',
		'.ts-hb-ask-song { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; opacity: 0.82; }',
		'.ts-hb-ask-q { margin: 2px 0 0; }',
		'.ts-hb-ask-acts { display: flex; gap: 4px; margin-left: auto; }',
		'@media (max-width: 760px) { .ts-hb-ask { bottom: 214px; } }',
		'@media (pointer: coarse) { .ts-hb-ask .ts-toast-btn { min-height: var(--ts-hit, 44px); padding: 4px 12px; } }'
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
	function shortDay(key) { var a = String(key).split('-'); return MONTHS[+a[1] - 1] + ' ' + (+a[2]); }
	function minutesText(ctx, v) { return v > 0 && v < 0.5 ? 'under a minute' : ctx.words.longTime(v * 60); }
	function level(v, max) { return v > 0 && max > 0 ? Math.max(1, Math.min(4, Math.ceil(4 * Math.sqrt(v / max)))) : 0; }

	// ---- Your numbers: When you listen --------------------------------------------------------

	function statsSection(el, ctx) {
		injectCss();
		var h = ctx.h, now = ctx.now(), map = scopeOf(ctx), hist = historyOf(ctx), zone = { local: true };
		var c = clock(hist, map, now, zone);
		var box = h('section', { class: 'ts-hb', aria: { labelledby: 'ts-hb-h' } }, h('div', { class: 'ts-sec-head' }, h('h2', { id: 'ts-hb-h', text: 'When you listen' })));
		el.appendChild(box);
		if (!c.listens) {
			box.appendChild(h('p', { class: 'ts-muted ts-hb-empty', text: (ctx.demo ? 'The demo keeps no listening history. ' : 'Nothing counted yet. ') + 'Every song you play or skip adds to it, in this browser: the hours you listen, your streaks of days with music, and your weeks.' }));
			return;
		}
		var sum = clockText(c);
		box.appendChild(h('p', { class: 'ts-hb-lede', text: sum || 'A few more days of music, and this shows when you listen most.' }));
		var side = h('div', { class: 'ts-hb-side' }, [streakTiles(ctx, streaks(hist, map, now, zone)), weekChart(ctx, weeks(hist, map, now, zone))]);
		box.appendChild(h('div', { class: 'ts-hb-wrap' }, [heatMap(ctx, c, sum, now), side]));
	}

	// The clock: a square per weekday and hour, one hue, darker for more (four steps on a
	// square-root scale, so a quiet hour still shows), the busiest ringed; a line above
	// reads out the square under the pointer or the finger; role="img" with the summary,
	// and the minutes by part of the day as a table for screen readers.
	function heatMap(ctx, c, sum, now) {
		var h = ctx.h, W = ctx.words, cells = [];
		var first = new Date(c.from), span = now - c.from < (c.days - 1) * DAY ? 'since ' + MONTHS[first.getMonth()] + ' ' + first.getDate() : 'the last 12 months';
		var lead = c.peak ? 'Busiest hour: ' + DAYS[c.peak.day] + ', ' + hourSpan(c.peak.hour) + ' (' + minutesText(ctx, c.peak.minutes) + ')' : '';
		var note = h('p', { class: 'ts-hb-note', text: lead });
		var grid = h('div', { class: 'ts-hb-heat', role: 'img', aria: { label: 'Minutes listened by day and hour, ' + span + '. ' + (sum || lead) } });
		c.cells.forEach(function (row, d) {
			grid.appendChild(h('span', { class: 'ts-hb-day', text: DAYS[d].slice(0, 3) }));
			row.forEach(function (v, hr) {
				var peak = c.peak && c.peak.day === d && c.peak.hour === hr;
				var cell = h('span', { class: 'ts-hb-cell' + (peak ? ' is-peak' : ''), data: { l: String(level(v, c.max)), i: String(cells.length) } });
				cells.push({ d: d, hr: hr, v: v, el: cell });
				grid.appendChild(cell);
			});
		});
		function unhover() { Array.prototype.forEach.call(grid.querySelectorAll('.is-hover'), function (x) { x.classList.remove('is-hover'); }); }
		grid.addEventListener('pointerover', function (e) {
			var x = e.target && e.target.dataset && e.target.dataset.i != null ? cells[+e.target.dataset.i] : null;
			if (!x) return;
			unhover();
			x.el.classList.add('is-hover');
			note.textContent = DAYS[x.d] + ', ' + hourSpan(x.hr) + ': ' + (x.v ? minutesText(ctx, x.v) : 'nothing');
		});
		// a mouse that leaves puts the busiest hour back; a tap's reading stays until the next tap
		grid.addEventListener('pointerleave', function (e) { if (e.pointerType !== 'mouse') return; unhover(); note.textContent = lead; });
		var hours = h('div', { class: 'ts-hb-hours', aria: { hidden: 'true' } }, [h('span'), h('span', { text: '12 am' }), h('span', { text: '6 am' }), h('span', { text: 'noon' }), h('span', { text: '6 pm' })]);
		var legend = h('div', { class: 'ts-hb-legend', aria: { hidden: 'true' } }, [h('span', { text: 'Less' }), h('span', { class: 'ts-hb-gap' })]
			.concat([0, 1, 2, 3, 4].map(function (l) { return h('span', { class: 'ts-hb-cell', data: { l: String(l) } }); }))
			.concat([h('span', { class: 'ts-hb-gap' }), h('span', { text: 'More' })])
			.concat(c.peak ? [h('span', { class: 'ts-hb-ring' }), h('span', { text: 'Busiest' })] : []));
		var PARTS = ['12 am to 6 am', '6 am to noon', 'Noon to 6 pm', '6 pm to midnight'];
		var table = h('table', { class: 'kit-sr' }, [
			h('caption', { text: 'Minutes listened by day and part of the day' }),
			h('thead', null, h('tr', null, [h('th', { scope: 'col', text: 'Day' })].concat(PARTS.map(function (p) { return h('th', { scope: 'col', text: p }); })))),
			h('tbody', null, c.cells.map(function (row, d) {
				return h('tr', null, [h('th', { scope: 'row', text: DAYS[d] })].concat([0, 1, 2, 3].map(function (q) {
					var m = 0;
					for (var k = q * 6; k < q * 6 + 6; k++) m += row[k];
					return h('td', { text: W.n(Math.round(m)) });
				})));
			}))
		]);
		return h('figure', { class: 'ts-hb-card ts-hb-clock' }, [h('figcaption', null, [h('h3', { text: 'By day and hour' }), h('span', { text: 'Minutes, ' + span })]), note, grid, hours, legend, table]);
	}

	function streakTiles(ctx, st) {
		var h = ctx.h, W = ctx.words;
		function tile(v, l, s) { return h('div', { class: 'ts-stat' }, [h('span', { class: 'ts-stat-v', text: v }), h('span', { class: 'ts-stat-l', text: l }), h('span', { class: 'ts-hb-sub', text: s })]); }
		var cur = st.current ? (st.today ? (st.current > 1 ? 'since ' + shortDay(st.currentFrom) + ', today included' : 'today') : 'play something today to keep it going') : 'a play today starts one';
		var best = st.longest > 1 ? shortDay(st.longestFrom) + ' to ' + (st.current === st.longest && st.today && st.currentFrom === st.longestFrom ? 'today' : shortDay(st.longestTo)) : st.longest ? shortDay(st.longestFrom) : '';
		return h('div', { class: 'ts-hb-tiles' }, [
			tile(W.n(st.current), (st.current === 1 ? 'day' : 'days') + ' in a row now', cur),
			tile(W.n(st.longest), (st.longest === 1 ? 'day' : 'days') + ', your longest streak', best)
		]);
	}

	// Minutes per week: one column a week, this week (so far) hatched, the highest labelled.
	function weekChart(ctx, wk) {
		var h = ctx.h, W = ctx.words, max = 0, peak = -1;
		wk.forEach(function (w, i) { if (w.minutes > max) { max = w.minutes; peak = i; } });
		function words(w) { return (w.current ? 'This week so far' : 'Week of ' + shortDay(w.from)) + ': ' + (w.minutes ? W.longTime(w.minutes * 60) : 'nothing'); }
		var lead = peak < 0 ? 'Nothing in these weeks.' : 'Most: ' + (wk[peak].current ? 'this week so far' : 'the week of ' + shortDay(wk[peak].from)) + ', ' + W.longTime(max * 60);
		var note = h('p', { class: 'ts-hb-note', text: lead });
		var cols = h('div', { class: 'ts-hb-cols', role: 'img', aria: { label: 'Minutes per week, the last ' + wk.length + ' weeks. ' + lead } });
		wk.forEach(function (w, i) {
			var bar = h('i', { style: { height: w.minutes && max ? 'max(2px, ' + (100 * w.minutes / max) + '%)' : '0' } });
			if (i === peak) bar.appendChild(h('b', { text: W.longTime(w.minutes * 60) }));
			var col = h('div', { class: 'ts-hb-col' + (w.current ? ' is-now' : '') }, bar);
			col.addEventListener('pointerenter', function () {
				Array.prototype.forEach.call(cols.querySelectorAll('.is-hover'), function (x) { x.classList.remove('is-hover'); });
				col.classList.add('is-hover');
				note.textContent = words(w);
			});
			cols.appendChild(col);
		});
		cols.addEventListener('pointerleave', function (e) {
			if (e.pointerType !== 'mouse') return;
			Array.prototype.forEach.call(cols.querySelectorAll('.is-hover'), function (x) { x.classList.remove('is-hover'); });
			note.textContent = lead;
		});
		var n = wk.length, axis = h('div', { class: 'ts-hb-axis', aria: { hidden: 'true' } });
		[0, 4, 8].forEach(function (i) { if (i < n - 2) axis.appendChild(h('span', { style: { left: (100 * i / n) + '%' }, text: shortDay(wk[i].from) })); });
		axis.appendChild(h('span', { class: 'is-end', text: 'This week' }));
		var table = h('table', { class: 'kit-sr' }, [
			h('caption', { text: 'Minutes per week' }),
			h('thead', null, h('tr', null, [h('th', { scope: 'col', text: 'Week of' }), h('th', { scope: 'col', text: 'Minutes' })])),
			h('tbody', null, wk.map(function (w) { return h('tr', null, [h('th', { scope: 'row', text: shortDay(w.from) + (w.current ? ' (so far)' : '') }), h('td', { text: W.n(w.minutes) })]); }))
		]);
		return h('figure', { class: 'ts-hb-card' }, [h('figcaption', null, [h('h3', { text: 'Minutes per week' }), h('span', { text: 'the last ' + n + ' weeks' })]), note, cols, axis, table]);
	}

	// ---- Home: Usually at this hour -----------------------------------------------------------

	function homeLane(el, ctx) {
		if (ctx.thumb) return;
		var now = ctx.now(), map = scopeOf(ctx), rows = thisHour(historyOf(ctx), map, now, { local: true });
		if (!rows.length) return;
		injectCss();
		var W = ctx.words, ids = rows.map(function (r) { return r.id; }), playCtx = { label: 'Usually at this hour', href: '#/' };
		ctx.ui.sectionHead(el, 'Usually at this hour');
		var head = el.lastChild;
		if (head && head.classList && head.classList.contains('ts-sec-head')) head.appendChild(ctx.ui.smallBtn('play', 'Play all', function () { ctx.play.from(ids, 0, playCtx); }));
		el.appendChild(ctx.h('p', { class: 'ts-hb-lane-lede', text: 'What you play most on ' + momentText(now, { local: true }) + ' around this time, from the last four months.' }));
		ctx.ui.shelf(el, rows.map(function (r, i) {
			var t = map[r.id], card = ctx.ui.trackCard(t, ids, i, playCtx), sub = card.querySelector('.ts-card-sub');
			if (sub) sub.textContent = W.artist(t) + ' ' + W.DOT + ' ' + W.plural(r.plays, 'play');
			return card;
		}));
	}

	// ---- Skip the intro, learned ----------------------------------------------------------------
	// watch(ctx) listens to the player for the page's whole life (app.js start). Not in the
	// thumbnail, and not in the demo unless opts.demo (the drive checks use it). Kept in the
	// store's kv: habits:seeks ([{ id, to, at }]) and habits:asked ({ id: { at, answer } },
	// answer 'yes', 'no' or '' when the offer went unanswered: each song is asked once).

	var SEEKS = 'habits:seeks', ASKED = 'habits:asked', ASK_MS = 15000;
	var watching = null;
	function carOn() { var T = root && root.TrueShuffle; return !!(T && T.car && T.car.active && T.car.active()); }

	function watch(ctx, opts) {
		opts = opts || {};
		if (watching) watching.stop();
		var player = ctx && ctx.player ? ctx.player() : null;
		if (!player || !player.on || ctx.thumb || (ctx.demo && !opts.demo) || typeof document === 'undefined') return { stop: function () {} };
		var det = seekDetector(), playingFrom = 0, offs = [], prompt = null;
		function store() { return ctx.store ? ctx.store() : null; }
		// Read afresh each time, so nothing old is written back after Settings deletes everything.
		function load() {
			var s = store();
			if (!s) return Promise.resolve({ seeks: [], asked: {} });
			return Promise.all([s.get(SEEKS, []), s.get(ASKED, {})]).then(function (r) {
				return { seeks: Array.isArray(r[0]) ? r[0] : [], asked: r[1] && typeof r[1] === 'object' ? r[1] : {} };
			}, function () { return { seeks: [], asked: {} }; });
		}
		function save(key, value) { var s = store(); if (s) s.set(key, value).catch(function () { /* not kept */ }); }
		function answered(id, answer) {
			load().then(function (b) { b.asked[id] = { at: Date.now(), answer: answer }; save(ASKED, b.asked); });
		}
		function heard(s) {
			var lib = ctx.lib ? ctx.lib() : null, t = lib && lib.tracks ? lib.tracks[s.id] : null;
			var sp = ctx.songPref ? ctx.songPref(s.id) : null;
			if (!t || t.transient || (sp && sp.start > 0)) return;
			load().then(function (b) {
				b.seeks = addSeek(b.seeks, s, s.at);
				save(SEEKS, b.seeks);
				if (prompt || b.asked[s.id] || carOn() || !ctx.songPref) return;
				var offer = introOffer(s.id, b.seeks, historyOf(ctx), { now: s.at });
				if (!offer || (sp && sp.end > 0 && sp.end <= offer.start + 5)) return;
				b.asked[s.id] = { at: s.at, answer: '' };
				save(ASKED, b.asked);
				prompt = ask(ctx, t, offer.start, function (answer) {
					prompt = null;
					if (answer) answered(s.id, answer);
				});
			});
		}
		offs.push(player.on('state', function (e) {
			if (e && e.state === 'playing') { if (!playingFrom) playingFrom = Date.now(); }
			else playingFrom = 0;
		}));
		offs.push(player.on('ended', function () { det.reset(); }));
		offs.push(player.on('time', function (e) {
			if (!e) return;
			var s = det.feed({ id: e.id, current: e.current, at: Date.now(), rate: player.rate ? player.rate() : 1, playingFrom: playingFrom });
			if (s) heard(s);
		}));
		var me = { stop: function () { offs.forEach(function (off) { off(); }); offs = []; if (prompt) prompt.close(); if (watching === me) watching = null; } };
		watching = me;
		return me;
	}

	// The offer, as a small prompt where the toasts are (never over the player): "You skip
	// to 0:42 in this song. Start it there from now on?" Start at 0:42 sets the song's start
	// (its other trims and volume kept) with Undo in a toast; No is remembered. Unanswered,
	// it goes after ASK_MS (the clock waits while the pointer or the focus is on it).
	// done(answer) hears 'yes', 'no' or '' (gone unanswered).
	var askEl = null, asking = null;
	// The prompt's element, made once; its listeners act on the offer being shown.
	function askBox(h) {
		if (askEl) return askEl;
		askEl = h('div', { class: 'ts-hb-ask', role: 'status', aria: { live: 'polite' }, hidden: true });
		function hold() { if (asking) clearTimeout(asking.timer); }
		function resume() { setTimeout(function () { if (asking && !askEl.contains(document.activeElement) && !askEl.matches(':hover')) asking.wait(8000); }, 0); }
		askEl.addEventListener('pointerenter', hold);
		askEl.addEventListener('focusin', hold);
		askEl.addEventListener('pointerleave', resume);
		askEl.addEventListener('focusout', resume);
		askEl.addEventListener('keydown', function (e) { if (e.key === 'Escape' && asking) { e.stopPropagation(); asking.close(''); } });
		document.body.appendChild(askEl);
		return askEl;
	}
	function ask(ctx, t, start, done) {
		injectCss();
		var h = ctx.h, W = ctx.words, at = W.clock(start), box = askBox(h);
		var me = {
			timer: 0,
			close: function (answer) {
				if (asking !== me) return;
				asking = null;
				clearTimeout(me.timer);
				box.hidden = true;
				ctx.clear(box);
				done(answer || '');
			},
			wait: function (ms) { clearTimeout(me.timer); me.timer = setTimeout(function () { me.close(''); }, ms); }
		};
		if (asking) asking.close('');
		asking = me;
		var yes = h('button', { class: 'ts-toast-btn', type: 'button', text: 'Start at ' + at });
		var no = h('button', { class: 'ts-toast-btn', type: 'button', text: 'No' });
		yes.addEventListener('click', function () {
			var before = ctx.songPref(t.id);
			ctx.songPref(t.id, { start: start, end: (before && before.end) || 0, vol: (before && before.vol) || 100 });
			me.close('yes');
			ctx.U.toast(W.q(W.title(t)) + ' now starts at ' + at + '.', { action: 'Undo', onAction: function () {
				ctx.songPref(t.id, before || null);
				ctx.say(W.q(W.title(t)) + ' starts from the beginning again.');
			} });
		});
		no.addEventListener('click', function () { me.close('no'); ctx.say('Not asked again for this song.'); });
		ctx.clear(box);
		box.hidden = false;
		// filled a moment after it shows, so a screen reader announces the question
		setTimeout(function () {
			if (asking !== me) return;
			box.appendChild(h('div', { class: 'ts-hb-ask-t' }, [
				h('span', { class: 'ts-hb-ask-song', text: W.title(t) + ' ' + W.DOT + ' ' + W.artist(t) }),
				h('p', { class: 'ts-hb-ask-q', text: 'You skip to ' + at + ' in this song. Start it there from now on?' })
			]));
			box.appendChild(h('div', { class: 'ts-hb-ask-acts' }, [yes, no]));
		}, 60);
		me.wait(ASK_MS);
		return me;
	}

	return {
		clock: clock, clockText: clockText, streaks: streaks, weeks: weeks, thisHour: thisHour, momentText: momentText,
		seekDetector: seekDetector, addSeek: addSeek, introOffer: introOffer,
		statsSection: statsSection, homeLane: homeLane, watch: watch
	};
});
