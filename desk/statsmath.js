// Desk stats: the arithmetic of the "Stats" view, with no browser in it.
//
// Loaded by desk/views/stats.js as window.DeskStatsMath and by
// desk/test/test-stats.mjs through require(). Everything here is a pure
// function of its arguments: no Date.now(), no time zone of the machine, no
// DOM. Times are milliseconds since the epoch; a "day" is a string
// YYYY-MM-DD; a time zone is a fixed offset in minutes east of UTC (Texas in
// summer is -300), because that is how GoatCounter itself cuts time into days.
//
// What GoatCounter's API gives (read from its documentation and source,
// https://www.goatcounter.com/help/api and github.com/arp242/goatcounter):
//   GET /api/v0/stats/total  { total, total_utc, total_events, stats: [{ day, hourly: [24], daily }] }
//   GET /api/v0/stats/hits   { hits: [{ count, path_id, path, title, event, max, stats: [...] }], total, more }
//   GET /api/v0/stats/<page> { stats: [{ id, name, count, ref_scheme }], more }    page: toprefs, locations, browsers, systems
// The day labels and the 24 hourly slots of "total" and "hits" are in the time
// zone chosen in the GoatCounter account, at that zone's present offset.

(function (root, factory) {
	if (typeof module === 'object' && module.exports) module.exports = factory();
	else root.DeskStatsMath = factory();
})(typeof self !== 'undefined' ? self : this, function () {
	'use strict';

	var MIN = 60000;
	var HOUR = 3600000;
	var DAY = 86400000;
	var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

	// The shell's routes and their names: a copy of TITLES in assets/js/main.js
	// (test-stats.mjs fails when the two drift apart). trackPageView() there
	// reports '/' + route + ('/' + rest), so these are the paths GoatCounter has.
	var ROUTE_TITLES = {
		about: 'About',
		education: 'Education',
		publications: 'Publications',
		press: 'Writing & press',
		blog: 'Blog',
		post: 'Blog',
		teaching: 'Teaching',
		presentations: 'Presentations',
		experience: 'Experience',
		bookshelf: 'Bookshelf',
		misc: 'Miscellaneous',
	};

	function own(obj, key) {
		return !!obj && Object.prototype.hasOwnProperty.call(obj, key);
	}

	function pad(n) {
		return (n < 10 ? '0' : '') + n;
	}

	// A count from outside: a whole number, never negative, never NaN.
	function int(v) {
		var n = Number(v);
		return isFinite(n) && n > 0 ? Math.floor(n) : 0;
	}

	// 1234567 -> "1,234,567"
	function fmt(n) {
		var s = String(Math.round(Number(n) || 0));
		var sign = '';
		if (s.charAt(0) === '-') {
			sign = '-';
			s = s.slice(1);
		}
		return sign + s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
	}

	// ---- days at a fixed offset ----------------------------------------------------

	// "2026-10-05" -> the instant of 00:00 UTC on that day, or NaN.
	function parseDay(key) {
		var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key == null ? '' : key));
		if (!m) return NaN;
		var ms = Date.UTC(+m[1], +m[2] - 1, +m[3]);
		var d = new Date(ms);
		if (d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) return NaN;
		return ms;
	}

	// The calendar day an instant falls on, for a clock `offsetMin` minutes east of UTC.
	function dayKey(ms, offsetMin) {
		var d = new Date(ms + (offsetMin || 0) * MIN);
		return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
	}

	// The instant that day begins on such a clock.
	function dayStart(key, offsetMin) {
		return parseDay(key) - (offsetMin || 0) * MIN;
	}

	function addDays(key, n) {
		return dayKey(parseDay(key) + n * DAY, 0);
	}

	// The `n` days that end with `lastKey`, oldest first.
	function dayList(lastKey, n) {
		var out = [];
		for (var i = n - 1; i >= 0; i--) out.push(addDays(lastKey, -i));
		return out;
	}

	function floorHour(ms) {
		return Math.floor(ms / HOUR) * HOUR;
	}

	function ceilHour(ms) {
		return Math.ceil(ms / HOUR) * HOUR;
	}

	// The form GoatCounter's own command-line client sends: 2026-10-05T05:00:00Z
	function apiTime(ms) {
		return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
	}

	// -300 -> "UTC-5", 330 -> "UTC+5:30", 0 -> "UTC"
	function offsetName(offsetMin) {
		var m = Math.round(Number(offsetMin) || 0);
		if (!m) return 'UTC';
		var a = Math.abs(m);
		return 'UTC' + (m < 0 ? '-' : '+') + Math.floor(a / 60) + (a % 60 ? ':' + pad(a % 60) : '');
	}

	// "2026-09-23" -> "September 23" ("September 23, 2025" when `withYear`)
	function longDay(key, withYear) {
		var ms = parseDay(key);
		if (isNaN(ms)) return String(key || '');
		var d = new Date(ms);
		return MONTHS[d.getUTCMonth()] + ' ' + d.getUTCDate() + (withYear ? ', ' + d.getUTCFullYear() : '');
	}

	// "2026-09-23" -> "Sep 23"
	function shortDay(key) {
		var ms = parseDay(key);
		if (isNaN(ms)) return String(key || '');
		var d = new Date(ms);
		return MONTHS[d.getUTCMonth()].slice(0, 3) + ' ' + d.getUTCDate();
	}

	// The last `days` days, today included, on a clock `offsetMin` east of UTC,
	// and the same number of days before them (for "compared with before").
	// start / prevStart / end are what the API is asked for: whole UTC hours
	// ("should be rounded to the hour"), chosen so that every hour asked for
	// falls inside the days named, also on a half-hour clock.
	function range(nowMs, offsetMin, days) {
		offsetMin = Math.round(Number(offsetMin) || 0);
		days = Math.max(1, Math.floor(days || 1));
		var today = dayKey(nowMs, offsetMin);
		var keys = dayList(today, days);
		var prevKeys = dayList(addDays(keys[0], -1), days);
		var startMs = ceilHour(dayStart(keys[0], offsetMin));
		var prevStartMs = ceilHour(dayStart(prevKeys[0], offsetMin));
		var endMs = floorHour(dayStart(today, offsetMin) + DAY - 1);
		return {
			days: days,
			offset: offsetMin,
			today: today,
			keys: keys,
			prevKeys: prevKeys,
			startMs: startMs,
			prevStartMs: prevStartMs,
			endMs: endMs,
			start: apiTime(startMs),
			prevStart: apiTime(prevStartMs),
			end: apiTime(endMs),
		};
	}

	// ---- the API's day-and-hour lists --------------------------------------------

	// One entry of a "stats" list -> that day's count. The 24 hourly numbers
	// are trusted over "daily" when both are there (they are what "daily" sums).
	function dayCount(entry) {
		if (entry && Array.isArray(entry.hourly) && entry.hourly.length) {
			var n = 0;
			for (var i = 0; i < entry.hourly.length; i++) n += int(entry.hourly[i]);
			return n;
		}
		return int(entry && entry.daily);
	}

	// [{ day, hourly, daily }] -> { "2026-10-05": 12, ... }
	function dailyMap(stats) {
		var map = {};
		(Array.isArray(stats) ? stats : []).forEach(function (entry) {
			if (!entry || isNaN(parseDay(entry.day))) return;
			map[entry.day] = (own(map, entry.day) ? map[entry.day] : 0) + dayCount(entry);
		});
		return map;
	}

	// -> [{ day, count }] for exactly these days; a day the API left out is 0.
	function series(stats, keys) {
		var map = dailyMap(stats);
		return (keys || []).map(function (day) {
			return { day: day, count: own(map, day) ? map[day] : 0 };
		});
	}

	function sum(list) {
		var n = 0;
		(list || []).forEach(function (item) {
			n += int(item && typeof item === 'object' ? item.count : item);
		});
		return n;
	}

	// Every hour that has a count, as an instant: [{ t, n }], oldest first.
	// `offsetMin` is the clock the labels are written in.
	function hourSlots(stats, offsetMin) {
		var out = [];
		(Array.isArray(stats) ? stats : []).forEach(function (entry) {
			if (!entry) return;
			var start = dayStart(entry.day, offsetMin);
			if (isNaN(start)) return;
			if (Array.isArray(entry.hourly) && entry.hourly.length) {
				for (var h = 0; h < entry.hourly.length && h < 24; h++) {
					var n = int(entry.hourly[h]);
					if (n) out.push({ t: start + h * HOUR, n: n });
				}
			} else if (int(entry.daily)) {
				// No hours given: the whole day sits at its first hour.
				out.push({ t: start, n: int(entry.daily) });
			}
		});
		out.sort(function (a, b) {
			return a.t - b.t;
		});
		return out;
	}

	// The same counts cut into days on another clock: { day: count }.
	// (For when the GoatCounter account is set to a different zone from his.)
	function rebucket(stats, fromOffsetMin, toOffsetMin) {
		var map = {};
		hourSlots(stats, fromOffsetMin).forEach(function (slot) {
			var key = dayKey(slot.t, toOffsetMin);
			map[key] = (own(map, key) ? map[key] : 0) + slot.n;
		});
		return map;
	}

	// How many were counted from the hour that contains `sinceMs` onwards.
	// Counts come by the hour, so the hour he last looked in is counted whole:
	// better to show a view twice than to hide a new one.
	function sumSince(stats, offsetMin, sinceMs) {
		if (sinceMs == null || isNaN(sinceMs)) return 0;
		var from = floorHour(sinceMs);
		var n = 0;
		hourSlots(stats, offsetMin).forEach(function (slot) {
			if (slot.t >= from) n += slot.n;
		});
		return n;
	}

	// Did the API cut the days where we expected? The request runs from the
	// first hour of keys[0] to the last hour of the last key on OUR clock; the
	// labels that come back are on the GoatCounter account's clock. The same
	// first and last label means the two clocks agree (to within the hour).
	//   -> { known, same, first, last, shift }   shift: 'earlier' | 'later' | ''
	function compareDays(stats, keys) {
		var days = (Array.isArray(stats) ? stats : [])
			.map(function (e) {
				return e && e.day;
			})
			.filter(function (d) {
				return !isNaN(parseDay(d));
			})
			.sort();
		if (!days.length || !keys || !keys.length) return { known: false, same: true, first: '', last: '', shift: '' };
		var first = days[0];
		var last = days[days.length - 1];
		var wantFirst = keys[0];
		var wantLast = keys[keys.length - 1];
		var shift = '';
		if (first < wantFirst) shift = 'earlier';
		else if (last > wantLast) shift = 'later';
		else if (first > wantFirst || last < wantLast) shift = first > wantFirst ? 'later' : 'earlier';
		return { known: true, same: first === wantFirst && last === wantLast, first: first, last: last, shift: shift };
	}

	// ---- change against the period before -------------------------------------------

	//   -> { now, prev, diff, pct, dir, label, words }
	//   dir: 'up' | 'down' | 'same' | 'new' (from nothing) | 'none' (nothing either time)
	//   label: "+12%", "-40%", "no change", "new", ""     words: "12% more than"
	function change(now, prev) {
		now = int(now);
		prev = int(prev);
		var out = { now: now, prev: prev, diff: now - prev, pct: null, dir: 'same', label: 'no change', words: 'the same as' };
		if (!prev && !now) {
			out.dir = 'none';
			out.label = '';
			out.words = 'none, as in';
			return out;
		}
		if (!prev) {
			out.dir = 'new';
			out.label = 'new';
			out.words = 'up from none in';
			return out;
		}
		out.pct = ((now - prev) / prev) * 100;
		if (now === prev) return out;
		var abs = Math.abs(out.pct);
		var shown = abs < 1 ? 'under 1%' : fmt(Math.round(abs)) + '%';
		out.dir = now > prev ? 'up' : 'down';
		out.label = abs < 1 ? (now > prev ? '+<1%' : '-<1%') : (now > prev ? '+' : '-') + fmt(Math.round(abs)) + '%';
		out.words = shown + (now > prev ? ' more than' : ' fewer than');
		return out;
	}

	// 3 of 40 -> "8%"; a part that would round to 0 -> "<1%"
	function share(count, total) {
		count = int(count);
		total = int(total);
		if (!total || !count) return '0%';
		var p = (count / total) * 100;
		if (p < 1) return '<1%';
		return Math.min(100, Math.round(p)) + '%';
	}

	// ---- paths joined to titles ----------------------------------------------------

	function safeDecode(s) {
		try {
			return decodeURIComponent(s);
		} catch (e) {
			return s;
		}
	}

	// "post/x/?a=1" -> "/post/x": one spelling per page.
	function cleanPath(path) {
		var p = String(path == null ? '' : path).trim().replace(/[?#].*$/, '');
		if (p.charAt(0) !== '/') p = '/' + p;
		p = p.replace(/\/{2,}/g, '/');
		if (p.length > 1) p = p.replace(/\/+$/, '');
		return p;
	}

	// blog/index.json, misc/toys.json and the route names -> one lookup.
	//   -> { posts: { slug: { title, date } }, toys: { '44-text-tartan': { title, href } }, routes: { about: 'About' } }
	function buildIndex(posts, toys, routes) {
		var index = { posts: {}, toys: {}, routes: {} };
		(Array.isArray(posts) ? posts : []).forEach(function (p) {
			if (!p || typeof p.slug !== 'string' || !p.slug) return;
			index.posts[p.slug] = { title: typeof p.title === 'string' && p.title ? p.title : p.slug, date: typeof p.date === 'string' ? p.date : '' };
		});
		var list = Array.isArray(toys) ? toys : toys && Array.isArray(toys.toys) ? toys.toys : [];
		list.forEach(function (t) {
			if (!t || typeof t.slug !== 'string' || !t.slug) return;
			index.toys[t.slug] = { title: typeof t.title === 'string' && t.title ? t.title : t.slug, href: typeof t.href === 'string' ? t.href : 'misc/' + t.slug + '/' };
		});
		var names = routes || ROUTE_TITLES;
		Object.keys(names).forEach(function (r) {
			index.routes[r] = String(names[r]);
		});
		return index;
	}

	// What a path is, in words.
	//   -> { key, path, kind, title, detail, link }
	//   kind: 'post' | 'route' | 'book' | 'toy' | 'home' | 'event' | 'other'
	//   link: where it is on the site, relative to the site root ('' when unknown)
	//   detail: a second line (the path, or why the title is a guess)
	function describe(path, index, hit) {
		index = index || { posts: {}, toys: {}, routes: {} };
		var p = cleanPath(path);
		var out = { key: p, path: p, kind: 'other', title: p, detail: '', link: '' };
		if (hit && hit.event) {
			out.kind = 'event';
			out.key = 'event:' + String(path == null ? '' : path);
			out.path = String(path == null ? '' : path);
			out.title = cleanTitle(hit.title) || out.path;
			out.detail = 'An event, not a page';
			return out;
		}
		var parts = p.split('/').slice(1).map(safeDecode);
		var head = parts[0] || '';

		if (p === '/' || head === 'index.html') {
			out.kind = 'home';
			out.title = 'Home';
			out.detail = p;
			out.link = './';
			return out;
		}
		if (head === 'post' && parts.length >= 2 && parts[1]) {
			var slug = parts.slice(1).join('/');
			out.kind = 'post';
			out.key = '/post/' + slug;
			if (own(index.posts, slug)) {
				out.title = index.posts[slug].title;
				out.detail = out.key;
				out.link = '#/post/' + encodeURIComponent(slug);
			} else {
				out.title = slug;
				out.detail = 'No published post has this address';
			}
			return out;
		}
		if (head === 'bookshelf' && parts.length >= 2 && parts[1]) {
			out.kind = 'book';
			out.title = 'Bookshelf: ' + parts.slice(1).join('/');
			out.detail = 'One book\'s card';
			out.link = '#/bookshelf/' + encodeURIComponent(parts.slice(1).join('/'));
			return out;
		}
		if (head === 'misc' && parts.length >= 2 && parts[1]) {
			out.kind = 'toy';
			if (own(index.toys, parts[1])) {
				out.title = index.toys[parts[1]].title;
				out.detail = p;
				out.link = 'misc/' + encodeURIComponent(parts[1]) + '/';
			} else {
				out.title = parts[1];
				out.detail = 'Not in misc/toys.json';
			}
			return out;
		}
		if (parts.length === 1 && own(index.routes, head)) {
			out.kind = 'route';
			out.title = index.routes[head];
			out.detail = p;
			out.link = '#/' + head;
			return out;
		}
		var given = cleanTitle(hit && hit.title);
		if (given) {
			out.title = given;
			out.detail = p;
		} else {
			out.detail = 'Not a page of the site';
		}
		return out;
	}

	// GoatCounter keeps document.title: "Publications · Jack V. Le" -> "Publications".
	function cleanTitle(title) {
		var t = String(title == null ? '' : title).replace(/\s+/g, ' ').trim();
		var cut = t.lastIndexOf(' ' + String.fromCharCode(0xb7) + ' ');
		if (cut > 0) t = t.slice(0, cut).trim();
		return t;
	}

	// The API's hits -> rows for the "Top pages" table: named, spellings of one
	// page merged, largest first.
	//   -> [{ key, path, paths, kind, title, detail, link, count, share }]
	//   opts.total: what the shares are a part of (default: the sum of the rows)
	function joinPages(hits, index, opts) {
		opts = opts || {};
		var byKey = {};
		var order = [];
		(Array.isArray(hits) ? hits : []).forEach(function (hit) {
			if (!hit || typeof hit.path !== 'string') return;
			var d = describe(hit.path, index, hit);
			var row = byKey[d.key];
			if (!own(byKey, d.key)) {
				row = byKey[d.key] = { key: d.key, path: d.path, paths: [], kind: d.kind, title: d.title, detail: d.detail, link: d.link, count: 0, share: '0%' };
				order.push(d.key);
			}
			if (row.paths.indexOf(hit.path) === -1) row.paths.push(hit.path);
			row.count += int(hit.count);
		});
		var rows = order.map(function (k) {
			return byKey[k];
		});
		rows.sort(function (a, b) {
			return b.count - a.count || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
		});
		var total = opts.total != null ? int(opts.total) : sum(rows);
		rows.forEach(function (r) {
			r.share = share(r.count, total);
			r.part = total ? Math.min(1, r.count / total) : 0;
		});
		return rows;
	}

	// The API's { id, name, count } lists (referrers, countries, browsers,
	// systems) -> rows, largest first; a blank name gets `opts.blank`.
	//   -> [{ name, count, share, part, blank }]
	function topList(stats, opts) {
		opts = opts || {};
		var byName = {};
		var order = [];
		(Array.isArray(stats) ? stats : []).forEach(function (s) {
			if (!s) return;
			var raw = String(s.name == null ? '' : s.name).replace(/\s+/g, ' ').trim();
			var blank = !raw;
			var name = blank ? opts.blank || '(unknown)' : raw;
			var key = blank ? '\u0000blank' : raw;
			if (!own(byName, key)) {
				byName[key] = { name: name, count: 0, share: '0%', part: 0, blank: blank };
				order.push(key);
			}
			byName[key].count += int(s.count);
		});
		var rows = order
			.map(function (k) {
				return byName[k];
			})
			.filter(function (r) {
				return r.count > 0;
			});
		rows.sort(function (a, b) {
			return b.count - a.count || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
		});
		var total = opts.total != null && int(opts.total) >= sum(rows) ? int(opts.total) : sum(rows);
		rows.forEach(function (r) {
			r.share = share(r.count, total);
			r.part = total ? Math.min(1, r.count / total) : 0;
		});
		return rows;
	}

	// ---- the public counters (no token) -----------------------------------------------

	// { "count": "1 234" } -> 1234. GoatCounter formats the number for people
	// (thin spaces, commas or dots between thousands); null when there is none.
	function parseCounter(data) {
		if (!data || data.count == null) return null;
		var digits = String(data.count).replace(/[^\d]/g, '');
		if (!digits) return null;
		var n = parseInt(digits, 10);
		return isFinite(n) ? n : null;
	}

	// The counter answers "how many since the start of day D (UTC)". From one
	// such number per day, oldest first, the days themselves:
	//   [{ day, since }] -> [{ day, count }]      count = since(day) - since(next day)
	// The answers are cached by GoatCounter for hours and not all at the same
	// moment, so a difference can come out negative; it is shown as 0.
	function sinceToDaily(points) {
		var list = (points || []).filter(function (p) {
			return p && !isNaN(parseDay(p.day)) && p.since != null;
		});
		list.sort(function (a, b) {
			return a.day < b.day ? -1 : a.day > b.day ? 1 : 0;
		});
		return list.map(function (p, i) {
			var next = i + 1 < list.length ? int(list[i + 1].since) : 0;
			return { day: p.day, count: Math.max(0, int(p.since) - next) };
		});
	}

	// ---- the chart -------------------------------------------------------------------

	// An axis that ends on a round number: { max, step, ticks: [0, step, ...] }.
	// Views are whole, so the step is never under 1.
	function niceScale(max, maxSteps) {
		max = Math.max(0, Number(max) || 0);
		maxSteps = Math.max(1, maxSteps || 4);
		if (max <= 0) return { max: 1, step: 1, ticks: [0, 1] };
		var raw = max / maxSteps;
		var pow = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10));
		var step = 10 * pow;
		var choices = [1, 2, 5, 10];
		for (var i = 0; i < choices.length; i++) {
			if (choices[i] * pow >= raw - 1e-9) {
				step = choices[i] * pow;
				break;
			}
		}
		step = Math.max(1, Math.round(step));
		var top = Math.ceil(max / step) * step;
		var ticks = [];
		for (var v = 0; v <= top; v += step) ticks.push(v);
		return { max: top, step: step, ticks: ticks };
	}

	// Which of n days get a date under them: at most `maxLabels`, evenly
	// spaced, always including the last (today).
	function labelIndexes(n, maxLabels) {
		if (n <= 0) return [];
		maxLabels = Math.max(1, maxLabels || 5);
		var strides = [1, 2, 7, 14, 21, 28];
		var stride = Math.ceil(n / maxLabels);
		for (var i = 0; i < strides.length; i++) {
			if (Math.ceil(n / strides[i]) <= maxLabels) {
				stride = strides[i];
				break;
			}
		}
		var out = [];
		for (var k = n - 1; k >= 0; k -= stride) out.unshift(k);
		return out;
	}

	function round2(v) {
		return Math.round(v * 100) / 100;
	}

	// A column with a rounded top and a square foot, as SVG path data.
	function barPath(x, y, w, h, radius) {
		var r = Math.max(0, Math.min(radius || 0, w / 2, h));
		var x2 = round2(x + w);
		var foot = round2(y + h);
		x = round2(x);
		y = round2(y);
		if (!r) return 'M' + x + ' ' + foot + 'V' + y + 'H' + x2 + 'V' + foot + 'Z';
		r = round2(r);
		return 'M' + x + ' ' + foot + 'V' + round2(y + r) + 'Q' + x + ' ' + y + ' ' + round2(x + r) + ' ' + y + 'H' + round2(x2 - r) + 'Q' + x2 + ' ' + y + ' ' + x2 + ' ' + round2(y + r) + 'V' + foot + 'Z';
	}

	// Where everything of a column chart goes, in the units of its viewBox.
	//   series: [{ day, count }]
	//   opts: { width, height, left, right, top, bottom, maxBar, maxLabels, steps }
	//   -> { width, height, plot: { x, y, w, h }, scale, bars: [{ i, day, count, x, y, w, h, slotX, slotW, d }],
	//        ticks: [{ value, y }], labels: [{ i, day, x }], peak: index or -1 }
	function chartLayout(list, opts) {
		opts = opts || {};
		var width = opts.width || 640;
		var height = opts.height || 190;
		var left = opts.left == null ? 36 : opts.left;
		var right = opts.right == null ? 8 : opts.right;
		var top = opts.top == null ? 14 : opts.top;
		var bottom = opts.bottom == null ? 24 : opts.bottom;
		var plot = { x: left, y: top, w: Math.max(1, width - left - right), h: Math.max(1, height - top - bottom) };
		var n = list.length;
		var max = 0;
		var peak = -1;
		list.forEach(function (p, i) {
			if (int(p.count) > max) {
				max = int(p.count);
				peak = i;
			}
		});
		var scale = niceScale(max, opts.steps || 3);
		var slot = n ? plot.w / n : plot.w;
		var gap = slot >= 6 ? 2 : slot >= 3 ? 1 : 0;
		var bw = Math.max(1, Math.min(opts.maxBar || 24, slot - gap));
		var bars = list.map(function (p, i) {
			var count = int(p.count);
			var h = count ? Math.max(2, (count / scale.max) * plot.h) : 0;
			var x = plot.x + i * slot + (slot - bw) / 2;
			var y = plot.y + plot.h - h;
			return {
				i: i,
				day: p.day,
				count: count,
				x: round2(x),
				y: round2(y),
				w: round2(bw),
				h: round2(h),
				slotX: round2(plot.x + i * slot),
				slotW: round2(slot),
				d: count ? barPath(x, y, bw, h, 4) : '',
			};
		});
		var ticks = scale.ticks.map(function (value) {
			return { value: value, y: round2(plot.y + plot.h - (value / scale.max) * plot.h) };
		});
		var labels = labelIndexes(n, opts.maxLabels || 5).map(function (i) {
			return { i: i, day: list[i].day, x: round2(plot.x + i * slot + slot / 2) };
		});
		return { width: width, height: height, plot: plot, scale: scale, bars: bars, ticks: ticks, labels: labels, peak: peak };
	}

	// The chart in a sentence or two, for people who do not read charts (and
	// for the chart's accessible name).
	//   opts: { prevTotal, zoneNote }
	function summarize(list, opts) {
		opts = opts || {};
		var n = list.length;
		if (!n) return 'There is nothing to show yet.';
		var total = sum(list);
		var span = n === 1 ? 'today' : 'in the last ' + n + ' days';
		var before = n === 1 ? 'the day before' : 'the ' + n + ' days before';
		var Before = before.charAt(0).toUpperCase() + before.slice(1);
		if (!total) {
			var none = 'No views ' + span + '.';
			if (opts.prevTotal != null && int(opts.prevTotal)) none += ' ' + Before + ' had ' + fmt(opts.prevTotal) + '.';
			return none;
		}
		var best = list[0];
		list.forEach(function (p) {
			if (int(p.count) > int(best.count)) best = p;
		});
		var avg = total / n;
		var avgText = avg >= 10 ? fmt(Math.round(avg)) : String(Math.round(avg * 10) / 10);
		var text = fmt(total) + (total === 1 ? ' view ' : ' views ') + span;
		if (n > 1) text += ', ' + avgText + ' a day on average. The busiest day was ' + longDay(best.day) + ' with ' + fmt(best.count) + '.';
		else text += '.';
		if (opts.prevTotal != null) {
			var c = change(total, opts.prevTotal);
			if (c.dir === 'new') text += ' ' + Before + ' had none.';
			else if (c.dir === 'same') text += ' ' + Before + ' had the same.';
			else text += ' That is ' + c.words + ' ' + before + ' (' + fmt(c.prev) + ').';
		}
		return text;
	}

	// ---- comments (giscus keeps them as GitHub Discussions) -------------------------

	// Only a link to github.com is ever used as a link.
	function githubUrl(url) {
		var u = String(url == null ? '' : url);
		return /^https:\/\/github\.com\/[^\s"'<>\\]*$/.test(u) ? u : '';
	}

	function nodesOf(connection) {
		return connection && Array.isArray(connection.nodes) ? connection.nodes.filter(Boolean) : [];
	}

	// GraphQL discussions -> one flat list of comments and replies, newest first.
	// giscus (mapping "specific") titles each discussion with the post's slug,
	// which is how a comment finds its post.
	//   opts: { index, category, me }
	//   -> [{ id, kind: 'comment' | 'reply', at, createdAt, url, author, text, hidden, mine, replyTo,
	//         slug, postTitle, known, number, discussionUrl }]
	function flattenComments(discussions, opts) {
		opts = opts || {};
		var posts = (opts.index && opts.index.posts) || {};
		var me = String(opts.me || '').toLowerCase();
		var out = [];
		(Array.isArray(discussions) ? discussions : []).forEach(function (d) {
			if (!d) return;
			if (opts.category && d.category && d.category.name && d.category.name !== opts.category) return;
			var slug = String(d.title == null ? '' : d.title).trim();
			var known = own(posts, slug);
			var discussionUrl = githubUrl(d.url);

			function push(c, kind, parent) {
				var at = Date.parse(c.createdAt);
				if (isNaN(at)) return;
				var author = c.author && typeof c.author.login === 'string' && c.author.login ? c.author.login : '';
				var text = typeof c.bodyText === 'string' && c.bodyText ? c.bodyText : typeof c.body === 'string' ? c.body : '';
				out.push({
					id: String(c.id || kind + ':' + c.createdAt + ':' + author),
					kind: kind,
					at: at,
					createdAt: String(c.createdAt),
					url: githubUrl(c.url) || discussionUrl,
					author: author || 'a deleted account',
					text: text.replace(/\r\n?/g, '\n').trim(),
					hidden: !!c.isMinimized,
					mine: !!me && author.toLowerCase() === me,
					replyTo: parent && parent.author && parent.author.login ? String(parent.author.login) : '',
					slug: slug,
					postTitle: known ? posts[slug].title : '',
					known: known,
					number: d.number,
					discussionUrl: discussionUrl,
				});
			}

			nodesOf(d.comments).forEach(function (c) {
				push(c, 'comment', null);
				nodesOf(c.replies).forEach(function (r) {
					push(r, 'reply', c);
				});
			});
		});
		out.sort(function (a, b) {
			return b.at - a.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
		});
		return out;
	}

	// New to him: written by someone else after he last looked.
	function isNew(item, sinceMs) {
		return !!item && !item.mine && sinceMs != null && !isNaN(sinceMs) && item.at > sinceMs;
	}

	// A long comment, shortened at a word: { text, cut }.
	function excerpt(text, max) {
		var s = String(text == null ? '' : text);
		max = max || 400;
		if (s.length <= max) return { text: s, cut: false };
		var head = s.slice(0, max);
		var space = head.lastIndexOf(' ');
		if (space > max * 0.6) head = head.slice(0, space);
		return { text: head.replace(/[\s.,;:]+$/, '') + ' ...', cut: true };
	}

	// ---- "since you last looked" -----------------------------------------------------

	// Two times are kept in the settings: the last look and the one before it.
	// Opening the view again within `sittingMs` is the same sitting: what was
	// new stays marked and nothing is written. After that, the last look is
	// what "new" is measured from, and now becomes the last look.
	//   -> { since: ms or null, record: null or { lastSeen, seenBefore } (ISO strings to store) }
	function lookState(lastSeen, seenBefore, nowMs, sittingMs) {
		sittingMs = sittingMs == null ? 5 * MIN : sittingMs;
		var last = typeof lastSeen === 'string' ? Date.parse(lastSeen) : NaN;
		var before = typeof seenBefore === 'string' ? Date.parse(seenBefore) : NaN;
		var nowIso = apiTime(nowMs);
		if (isNaN(last)) return { since: null, record: { lastSeen: nowIso, seenBefore: null } };
		if (last > nowMs + sittingMs) {
			// A clock that was ahead wrote this. Do not trust it; start again from now.
			return { since: isNaN(before) || before > nowMs ? null : before, record: { lastSeen: nowIso, seenBefore: isNaN(before) || before > nowMs ? null : apiTime(before) } };
		}
		if (nowMs - last < sittingMs) return { since: isNaN(before) ? null : before, record: null };
		return { since: last, record: { lastSeen: nowIso, seenBefore: apiTime(last) } };
	}

	return {
		MIN: MIN,
		HOUR: HOUR,
		DAY: DAY,
		ROUTE_TITLES: ROUTE_TITLES,
		int: int,
		fmt: fmt,
		parseDay: parseDay,
		dayKey: dayKey,
		dayStart: dayStart,
		addDays: addDays,
		dayList: dayList,
		floorHour: floorHour,
		ceilHour: ceilHour,
		apiTime: apiTime,
		offsetName: offsetName,
		longDay: longDay,
		shortDay: shortDay,
		range: range,
		dayCount: dayCount,
		dailyMap: dailyMap,
		series: series,
		sum: sum,
		hourSlots: hourSlots,
		rebucket: rebucket,
		sumSince: sumSince,
		compareDays: compareDays,
		change: change,
		share: share,
		cleanPath: cleanPath,
		cleanTitle: cleanTitle,
		buildIndex: buildIndex,
		describe: describe,
		joinPages: joinPages,
		topList: topList,
		parseCounter: parseCounter,
		sinceToDaily: sinceToDaily,
		niceScale: niceScale,
		labelIndexes: labelIndexes,
		barPath: barPath,
		chartLayout: chartLayout,
		summarize: summarize,
		githubUrl: githubUrl,
		flattenComments: flattenComments,
		isNew: isNew,
		excerpt: excerpt,
		lookState: lookState,
	};
});
