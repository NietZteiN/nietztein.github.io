// A local fake of GoatCounter (https://<code>.goatcounter.com), for testing the
// Desk's Stats view without the real service.
//
// It answers the calls desk/views/stats.js makes, shaped like the real API
// (checked against https://www.goatcounter.com/help/api, its source, and the
// real service's answers on 2026-10-05):
//   GET /api/v0/stats/total?start&end          { total, total_events, total_utc, stats: [{ day, hourly[24], daily }] }
//   GET /api/v0/stats/hits?start&end&limit     { hits: [{ count, path_id, path, title, event, max, stats }], total, more }
//   GET /api/v0/stats/<page>?start&end&limit   { stats: [{ id, name, count }], more }   page: toprefs locations browsers systems
//   GET /counter/<encodeURIComponent(path)>.json?start=week|month|year|YYYY-MM-DD    { count: "1 234" }  (no token)
//   GET /counter/TOTAL.json                    the whole site
// The API wants "Authorization: Bearer <token>"; it accepts only FAKE_GOAT_TOKEN.
// CORS as on the real service: Access-Control-Allow-Origin: * on every
// answer (401 included), preflight allows Authorization and Content-Type, and
// NO Access-Control-Expose-Headers (so X-Rate-Limit-* cannot be read by a page).
// 4 requests a second, then 429.
//
// The data are made up and deterministic: a few views an hour over the last
// 200 days, spread over the site's real routes, two real posts, a post that
// was never published, a book card, a hostile path and hostile names.
// Day labels and hourly slots are on the account's clock (`offset`, minutes
// east of UTC; GoatCounter uses the zone set in the account).
//
// In a drive script:
//   import { startFakeGoatCounter, FAKE_GOAT_TOKEN } from '<repo>/desk/test/fake-goatcounter.mjs';
//   const goat = await startFakeGoatCounter();        // { url: 'http://127.0.0.1:<port>', ... }
//   ... open <site>/desk/?api=<fake github>&goat=<goat.url> ...
//   goat.set({ apiCors: false })   the browser refuses the API (no CORS headers), counters still work
//   goat.set({ counterCors: false, down: true, status: 401|403|500, offset: 0, counterOff: true })
//   goat.requests                  [{ method, path, query, auth: 'none'|'good'|'bad', status }]
//   await goat.close();
// By hand: node desk/test/fake-goatcounter.mjs [--port 8788]

import http from 'node:http';

export const FAKE_GOAT_TOKEN = 'FAKE-goat-token-1234567890';

const HOUR = 3600000;
const DAY = 86400000;

// path, weight, title as document.title would have sent it
const PATHS = [
	['/about', 30, 'Jack V. Le'],
	['/post/benchmarks-we-actually-need', 16, 'Benchmarks We Actually Need · Jack V. Le'],
	['/post/latentland', 12, 'Latentland · Jack V. Le'],
	['/blog', 10, 'Blog · Jack V. Le'],
	['/publications', 10, 'Publications · Jack V. Le'],
	['/misc', 8, 'Miscellaneous · Jack V. Le'],
	['/bookshelf', 6, 'Bookshelf · Jack V. Le'],
	['/teaching', 3, 'Teaching · Jack V. Le'],
	['/bookshelf/b-0042', 2, 'Bookshelf · Jack V. Le'],
	['/post/never-published', 1, 'Blog · Jack V. Le'],
	['/<script>window.__xss=4</script>', 1, '<img src=x onerror="window.__xss=5">'],
];
const REFS = [
	['', 60],
	['news.ycombinator.com', 8],
	['www.google.com', 12],
	['github.com', 7],
	['scholar.google.com', 5],
	['<img src=x onerror="window.__xss=3">', 1],
];
const LOCATIONS = [
	['US', 'United States', 50],
	['VN', 'Vietnam', 12],
	['DE', 'Germany', 9],
	['JP', 'Japan', 8],
	['GB', 'United Kingdom', 6],
	['', '(unknown)', 3],
];
const BROWSERS = [
	['Chrome', 55],
	['Safari', 20],
	['Firefox', 15],
	['Edge', 8],
];
const SYSTEMS = [
	['Windows', 35],
	['macOS', 25],
	['iOS', 20],
	['Android', 12],
	['Linux', 8],
];

// a small deterministic hash -> [0, 1)
function rnd(n, salt) {
	let t = ((n | 0) + Math.imul(salt + 1, 0x9e3779b9)) | 0;
	t = Math.imul(t ^ (t >>> 16), 0x21f0aaad);
	t = Math.imul(t ^ (t >>> 15), 0x735a2d97);
	t = Math.imul(t ^ (t >>> 15), 0x2c1b3c6d);
	t ^= t >>> 16;
	return (t >>> 0) / 4294967296;
}

function pick(list, weightIndex, u) {
	const total = list.reduce((s, e) => s + e[weightIndex], 0);
	let acc = 0;
	for (const e of list) {
		acc += e[weightIndex] / total;
		if (u < acc) return e;
	}
	return list[list.length - 1];
}

function pad(n) {
	return (n < 10 ? '0' : '') + n;
}
function dayKey(ms, offsetMin) {
	const d = new Date(ms + offsetMin * 60000);
	return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
}
function hourOfDay(ms, offsetMin) {
	return new Date(ms + offsetMin * 60000).getUTCHours();
}

// Views of one hour: [{ path, title, ref, loc, browser, system }]
function hourViews(hourIndex) {
	const t = hourIndex * HOUR;
	const h = new Date(t).getUTCHours();
	// more by day (Texas afternoon is about 19-23Z), and a slow rise over the months
	const daytime = h >= 14 || h <= 3 ? 1 : 0.35;
	const growth = 0.6 + 0.4 * ((hourIndex % 4800) / 4800);
	const n = Math.floor(rnd(hourIndex, 1) * 2.4 * daytime * growth + rnd(hourIndex, 7) * 1.2);
	const out = [];
	for (let i = 0; i < n; i++) {
		const k = hourIndex * 8 + i;
		const p = pick(PATHS, 1, rnd(k, 2));
		out.push({
			path: p[0],
			title: p[2],
			ref: pick(REFS, 1, rnd(k, 3))[0],
			loc: pick(LOCATIONS, 2, rnd(k, 4)),
			browser: pick(BROWSERS, 1, rnd(k, 5))[0],
			system: pick(SYSTEMS, 1, rnd(k, 6))[0],
		});
	}
	return out;
}

function parseTime(v, fallback) {
	if (v == null || v === '') return fallback;
	const s = String(v);
	const ms = /^\d{4}-\d{2}-\d{2}$/.test(s) ? Date.parse(s + 'T00:00:00Z') : Date.parse(s);
	return isNaN(ms) ? NaN : ms;
}

export async function startFakeGoatCounter({ port = 0, offset = -300, now = () => Date.now() } = {}) {
	const fake = {
		url: '',
		port: 0,
		requests: [],
		opts: { apiCors: true, counterCors: true, down: false, status: 0, offset, counterOff: false, rateLimit: 4, delayMs: 0 },
		set(o) {
			Object.assign(this.opts, o || {});
		},
		reset() {
			this.opts = { apiCors: true, counterCors: true, down: false, status: 0, offset, counterOff: false, rateLimit: 4, delayMs: 0 };
			this.requests.length = 0;
		},
		// The views in [startMs, endMs): for checking the page's numbers.
		views(startMs, endMs) {
			return viewsIn(startMs, endMs);
		},
		close() {
			return new Promise((done) => {
				server.close(() => done());
				server.closeAllConnections();
			});
		},
	};

	// Generated data stop at the current hour; nothing is in the future.
	const cache = new Map();
	function viewsAt(hourIndex) {
		if (!cache.has(hourIndex)) cache.set(hourIndex, hourViews(hourIndex));
		return cache.get(hourIndex);
	}
	function viewsIn(startMs, endMs) {
		const first = Math.max(Math.ceil(startMs / HOUR), Math.floor((now() - 200 * DAY) / HOUR));
		const last = Math.min(Math.ceil(endMs / HOUR), Math.floor(now() / HOUR) + 1);
		const out = [];
		for (let i = first; i < last; i++) for (const v of viewsAt(i)) out.push({ ...v, t: i * HOUR });
		return out;
	}

	function range(q) {
		const end = parseTime(q.get('end'), Math.floor(now() / HOUR) * HOUR + HOUR);
		const start = parseTime(q.get('start'), end - 7 * DAY);
		if (isNaN(start) || isNaN(end)) return null;
		// "end" is inclusive of its hour on the real service
		return { start, end: end + HOUR };
	}

	function dayStats(views, start, end) {
		const off = fake.opts.offset;
		const days = new Map();
		for (let t = start; t < end; t += HOUR) {
			const k = dayKey(t, off);
			if (!days.has(k)) days.set(k, { day: k, hourly: new Array(24).fill(0), daily: 0 });
		}
		for (const v of views) {
			const k = dayKey(v.t, off);
			if (!days.has(k)) continue;
			const e = days.get(k);
			e.hourly[hourOfDay(v.t, off)]++;
			e.daily++;
		}
		return [...days.values()].sort((a, b) => (a.day < b.day ? -1 : 1));
	}

	function limitOf(q, def) {
		const n = parseInt(q.get('limit') || String(def), 10);
		return Math.max(1, Math.min(100, isNaN(n) ? def : n));
	}

	function tally(views, keyOf) {
		const m = new Map();
		for (const v of views) {
			const k = keyOf(v);
			m.set(k, (m.get(k) || 0) + 1);
		}
		return [...m.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
	}

	function api(pathname, q) {
		const r = range(q);
		if (!r) return { status: 400, body: { errors: { start: ['invalid time'] } } };
		const views = viewsIn(r.start, r.end);
		const limit = limitOf(q, 20);
		if (pathname === '/api/v0/stats/total') {
			const stats = dayStats(views, r.start, r.end);
			return { status: 200, body: { total: views.length, total_events: 0, total_utc: views.length, stats } };
		}
		if (pathname === '/api/v0/stats/hits') {
			const rows = tally(views, (v) => v.path);
			const hits = rows.slice(0, limit).map(([p, count]) => {
				const def = PATHS.find((e) => e[0] === p);
				const stats = dayStats(
					views.filter((v) => v.path === p),
					r.start,
					r.end
				);
				return { count, path_id: 107800000 + PATHS.indexOf(def), path: p, event: false, title: def[2], max: Math.max(0, ...stats.map((s) => s.daily)), stats };
			});
			return { status: 200, body: { hits, total: views.length, more: rows.length > limit } };
		}
		const m = /^\/api\/v0\/stats\/(toprefs|locations|browsers|systems)$/.exec(pathname);
		if (m) {
			let rows;
			if (m[1] === 'toprefs') rows = tally(views, (v) => v.ref).map(([name, count]) => ({ id: name, name, count, ref_scheme: name ? 'h' : 'o' }));
			else if (m[1] === 'locations') rows = tally(views, (v) => v.loc[0] + '\t' + v.loc[1]).map(([k, count]) => ({ id: k.split('\t')[0], name: k.split('\t')[1], count }));
			else rows = tally(views, (v) => v[m[1] === 'browsers' ? 'browser' : 'system']).map(([name, count]) => ({ id: name, name, count }));
			return { status: 200, body: { stats: rows.slice(0, limit), more: rows.length > limit } };
		}
		if (pathname === '/api/v0/me') return { status: 404, body: { error: 'not found' } };
		return { status: 404, body: { error: 'not found' } };
	}

	function counter(pathname, q) {
		const m = /^\/counter\/(.+)\.json$/.exec(pathname);
		if (!m) return { status: 404, body: { error: 'not found' } };
		if (fake.opts.counterOff) return { status: 403, body: { error: 'Visitor counts are not enabled for this site' } };
		let p;
		try {
			p = decodeURIComponent(m[1]);
		} catch (e) {
			return { status: 400, body: { error: 'bad path' } };
		}
		const s = q.get('start');
		const end = now() + HOUR;
		let start = now() - 200 * DAY;
		if (s === 'week') start = now() - 7 * DAY;
		else if (s === 'month') start = now() - 30 * DAY;
		else if (s === 'year') start = now() - 365 * DAY;
		else if (s) {
			start = parseTime(s, NaN);
			if (isNaN(start)) return { status: 400, body: { error: 'invalid start' } };
		}
		const views = viewsIn(start, end);
		if (p === 'TOTAL') return { status: 200, body: { count: fmtCount(views.length) } };
		const n = views.filter((v) => v.path === p).length;
		if (!PATHS.some((e) => e[0] === p)) return { status: 404, body: { count: '0' } };
		return { status: 200, body: { count: fmtCount(n) } };
	}

	// GoatCounter formats with a thin space between thousands
	function fmtCount(n) {
		return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
	}

	let windowStart = 0;
	let windowCount = 0;

	const server = http.createServer((req, res) => {
		const url = new URL(req.url, 'http://x');
		const isApi = url.pathname.startsWith('/api/');
		const cors = isApi ? fake.opts.apiCors : fake.opts.counterCors;
		const auth = req.headers.authorization ? (req.headers.authorization === 'Bearer ' + FAKE_GOAT_TOKEN ? 'good' : 'bad') : 'none';
		const entry = { method: req.method, path: url.pathname, query: url.search, auth, cookie: !!req.headers.cookie, status: 0 };
		fake.requests.push(entry);
		if (fake.opts.down) {
			entry.status = -1;
			req.socket.destroy();
			return;
		}
		const send = (status, body, extra = {}) => {
			entry.status = status;
			const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extra };
			if (cors) headers['Access-Control-Allow-Origin'] = '*';
			const out = () => {
				res.writeHead(status, headers);
				res.end(body == null ? '' : JSON.stringify(body));
			};
			if (fake.opts.delayMs) setTimeout(out, fake.opts.delayMs);
			else out();
		};
		if (req.method === 'OPTIONS') {
			const extra = cors ? { 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'DELETE, GET, HEAD, OPTIONS, PATCH, POST, PUT', 'Access-Control-Allow-Credentials': 'true' } : {};
			return send(200, null, extra);
		}
		if (req.method !== 'GET') return send(405, { error: 'method not allowed' });

		const sec = Math.floor(Date.now() / 1000);
		if (sec !== windowStart) {
			windowStart = sec;
			windowCount = 0;
		}
		windowCount++;
		if (fake.opts.rateLimit && windowCount > fake.opts.rateLimit) return send(429, { error: 'rate limited' }, { 'Retry-After': '1', 'X-Rate-Limit-Reset': '1' });

		if (!isApi) {
			const r = counter(url.pathname, url.searchParams);
			return send(r.status, r.body);
		}
		if (fake.opts.status) return send(fake.opts.status, { error: fake.opts.status === 401 ? 'unauthorized' : fake.opts.status === 403 ? 'API token lacks the stats permission' : 'internal server error' });
		if (auth !== 'good') return send(401, { error: auth === 'none' ? 'no API key in Authorization header' : 'unknown API key' });
		const r = api(url.pathname, url.searchParams);
		send(r.status, r.body);
	});

	await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
	fake.port = server.address().port;
	fake.url = 'http://127.0.0.1:' + fake.port;
	return fake;
}

// node desk/test/fake-goatcounter.mjs [--port 8788]
if (process.argv[1] && import.meta.url === new URL('file:///' + process.argv[1].replace(/\\/g, '/')).href) {
	const i = process.argv.indexOf('--port');
	const fake = await startFakeGoatCounter({ port: i > 0 ? Number(process.argv[i + 1]) : 8788 });
	console.log(fake.url + '   token: ' + FAKE_GOAT_TOKEN);
}
