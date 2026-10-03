// "Now in Garland" card: a compact live card under the contact rows in the
// left column. Sky strip with the day's solar arc (real NOAA-style solar
// position), the local clock, weather from Open-Meteo, the latest GitHub
// push and a date-seeded pick from the bookshelf. Registered with the
// Gadgets registry as 'now'; disable() removes everything.
//
// Debug: ?gadgetDebug=now-day | now-night freezes the clock at a fixed
// instant and fakes the network rows so screenshots are deterministic.

(function () {
	'use strict';
	if (!window.Gadgets) return;

	var LAT = 32.9126, LON = -96.6389, ZONE = 'America/Chicago';
	var WX_URL = 'https://api.open-meteo.com/v1/forecast?latitude=32.9126&longitude=-96.6389&current=temperature_2m,weather_code,is_day&temperature_unit=fahrenheit&timezone=America%2FChicago';
	var GH_URL = 'https://api.github.com/users/nietztein/events/public';
	var LIB_URL = 'assets/data/library.json';
	var WX_KEY = 'gadgets.now.wx', GH_KEY = 'gadgets.now.gh';
	var WX_TTL = 15 * 60 * 1000, GH_TTL = 60 * 60 * 1000;
	var FETCH_TIMEOUT = 8000;

	// Copied from assets/js/bookshelf.js so the spine matches the shelf.
	var GENRE_HUE = {
		'Literature (English & European)': 214, 'Japanese literature': 354, 'Manga & comics': 322, 'Light novels': 282,
		'Writing, film & literary craft': 28, 'History & biography': 14, 'Philosophy & political theory': 248,
		'Religion & theology': 42, 'Society, culture & ideas': 186, 'Politics, law & current affairs': 168,
		'Psychology, self-help & business': 142, 'Art & visual culture': 76, 'Music & opera': 266,
		'Language study & reference': 104, 'Test prep & study guides': 56, 'Math, CS & engineering': 200,
		'Science': 178, 'Nursing & medical': 6, 'Magazines & catalogues': 90, 'Occult & folklore': 300,
		'Games & other objects': 0, 'Unidentified': 0,
	};

	// ---- Debug mode -----------------------------------------------------------
	var debug = '';
	try { debug = (new URLSearchParams(location.search).get('gadgetDebug') || ''); } catch (e) { debug = ''; }
	var DEBUG_NOW = debug === 'now-day' ? Date.UTC(2026, 5, 21, 19, 0, 0)      // 14:00 CDT, 21 Jun 2026
		: debug === 'now-night' ? Date.UTC(2026, 9, 2, 3, 30, 0) : 0;            // 22:30 CDT, 1 Oct 2026
	function now() { return DEBUG_NOW ? new Date(DEBUG_NOW) : new Date(); }

	// ---- Time zone helpers ---------------------------------------------------
	var dtfParts = null, dtfTime = null, dtfTimeShort = null, dtfDate = null;
	function fmt(opts) { opts.timeZone = ZONE; return new Intl.DateTimeFormat('en-US', opts); }
	function localParts(d) {
		if (!dtfParts) dtfParts = fmt({ year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23' });
		var out = {};
		dtfParts.formatToParts(d).forEach(function (p) { if (p.type !== 'literal') out[p.type] = p.value; });
		return { y: +out.year, m: +out.month, d: +out.day, H: +out.hour % 24, M: +out.minute, S: +out.second };
	}
	function dayKey(d) { var p = localParts(d); return p.y + '-' + (p.m < 10 ? '0' : '') + p.m + '-' + (p.d < 10 ? '0' : '') + p.d; }

	// ---- Solar math (NOAA simplified) ----------------------------------------
	var RAD = Math.PI / 180;
	function solarBasics(jd) {
		var jc = (jd - 2451545) / 36525;
		var L0 = (280.46646 + jc * (36000.76983 + jc * 0.0003032)) % 360;
		var M = 357.52911 + jc * (35999.05029 - 0.0001537 * jc);
		var e = 0.016708634 - jc * (0.000042037 + 0.0000001267 * jc);
		var C = Math.sin(M * RAD) * (1.914602 - jc * (0.004817 + 0.000014 * jc)) + Math.sin(2 * M * RAD) * (0.019993 - 0.000101 * jc) + Math.sin(3 * M * RAD) * 0.000289;
		var trueLong = L0 + C;
		var omega = 125.04 - 1934.136 * jc;
		var lambda = trueLong - 0.00569 - 0.00478 * Math.sin(omega * RAD);
		var eps0 = 23 + (26 + ((21.448 - jc * (46.815 + jc * (0.00059 - jc * 0.001813)))) / 60) / 60;
		var eps = eps0 + 0.00256 * Math.cos(omega * RAD);
		var decl = Math.asin(Math.sin(eps * RAD) * Math.sin(lambda * RAD)) / RAD;
		var y = Math.tan(eps / 2 * RAD); y *= y;
		var eqt = 4 / RAD * (y * Math.sin(2 * L0 * RAD) - 2 * e * Math.sin(M * RAD) + 4 * e * y * Math.sin(M * RAD) * Math.cos(2 * L0 * RAD) - 0.5 * y * y * Math.sin(4 * L0 * RAD) - 1.25 * e * e * Math.sin(2 * M * RAD));
		return { decl: decl, eqt: eqt };
	}
	// Elevation of the sun in degrees at an instant.
	function elevation(d) {
		var jd = d.getTime() / 86400000 + 2440587.5;
		var s = solarBasics(jd);
		var minutes = (d.getUTCHours() * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60);
		var tst = (minutes + s.eqt + 4 * LON) % 1440; if (tst < 0) tst += 1440;
		var ha = tst / 4 - 180;
		var sinEl = Math.sin(LAT * RAD) * Math.sin(s.decl * RAD) + Math.cos(LAT * RAD) * Math.cos(s.decl * RAD) * Math.cos(ha * RAD);
		return Math.asin(Math.max(-1, Math.min(1, sinEl))) / RAD;
	}
	// Sunrise / sunset instants (ms) for a local calendar day {y,m,d}.
	function sunTimes(p) {
		var base = Date.UTC(p.y, p.m - 1, p.d);                 // 0h UTC of that date
		var jd = base / 86400000 + 2440587.5;
		var s = solarBasics(jd + 0.5);
		var cosHa = (Math.cos(90.833 * RAD) / (Math.cos(LAT * RAD) * Math.cos(s.decl * RAD))) - Math.tan(LAT * RAD) * Math.tan(s.decl * RAD);
		cosHa = Math.max(-1, Math.min(1, cosHa));
		var ha = Math.acos(cosHa) / RAD;
		var rise = 720 - 4 * (LON + ha) - s.eqt;
		var set = 720 - 4 * (LON - ha) - s.eqt;
		return { rise: base + rise * 60000, set: base + set * 60000 };
	}
	function shiftDay(p, n) { var d = new Date(Date.UTC(p.y, p.m - 1, p.d + n, 12)); return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() }; }
	// Moon phase 0..1 (0 = new, 0.5 = full).
	function moonPhase(d) {
		var jd = d.getTime() / 86400000 + 2440587.5;
		var age = ((jd - 2451550.1) / 29.530588853) % 1;
		return age < 0 ? age + 1 : age;
	}

	// ---- Small helpers --------------------------------------------------------
	var SVG_NS = 'http://www.w3.org/2000/svg';
	function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
	function svg(tag, attrs) { var n = document.createElementNS(SVG_NS, tag); for (var k in attrs) n.setAttribute(k, attrs[k]); return n; }
	function hash(str) { var h = 2166136261; for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
	function lerp(a, b, t) { return a + (b - a) * t; }
	function mixHex(a, b, t) {
		var pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
		var r = Math.round(lerp(pa >> 16, pb >> 16, t)), g = Math.round(lerp((pa >> 8) & 255, (pb >> 8) & 255, t)), bl = Math.round(lerp(pa & 255, pb & 255, t));
		return 'rgb(' + r + ',' + g + ',' + bl + ')';
	}
	function cacheGet(key, ttl) {
		if (DEBUG_NOW) return null;
		try { var v = JSON.parse(localStorage.getItem(key) || 'null'); if (v && v.t && Date.now() - v.t < ttl) return v.data; } catch (e) { /* ignore */ }
		return null;
	}
	function cacheSet(key, data) { try { localStorage.setItem(key, JSON.stringify({ t: Date.now(), data: data })); } catch (e) { /* ignore */ } }
	function fetchJSON(url, signal) {
		if (!window.fetch || !window.AbortController) return Promise.reject(new Error('no fetch'));
		var ctrl = new AbortController();
		var timer = setTimeout(function () { ctrl.abort(); }, FETCH_TIMEOUT);
		if (signal) signal.addEventListener('abort', function () { ctrl.abort(); });
		return fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } }).then(function (r) {
			if (!r.ok) throw new Error('http ' + r.status);
			return r.json();
		}).then(function (j) { clearTimeout(timer); return j; }, function (e) { clearTimeout(timer); throw e; });
	}
	function relTime(ms) {
		var s = Math.max(0, Math.round(ms / 1000));
		if (s < 60) return 'just now';
		var m = Math.round(s / 60); if (m < 60) return m + ' min ago';
		var h = Math.round(m / 60); if (h < 36) return h + ' h ago';
		var d = Math.round(h / 24); if (d < 30) return d + ' d ago';
		var mo = Math.round(d / 30); if (mo < 12) return mo + ' mo ago';
		return Math.round(d / 365) + ' y ago';
	}
	function untilText(ms) {
		var m = Math.max(0, Math.round(ms / 60000));
		var h = Math.floor(m / 60); m -= h * 60;
		return (h ? h + ' h ' : '') + m + ' m';
	}

	// ---- Weather glyphs -------------------------------------------------------
	var P = { stroke: 'currentColor', fill: 'none', 'stroke-width': '1.6', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };
	function glyphSvg() { return svg('svg', { viewBox: '0 0 24 24', width: '18', height: '18', 'aria-hidden': 'true', 'class': 'now-glyph' }); }
	function glyph(kind) {
		var s = glyphSvg();
		function add(tag, a) { for (var k in P) if (!(k in a)) a[k] = P[k]; s.appendChild(svg(tag, a)); }
		function cloud(y) { return 'M7 ' + (y + 9) + 'h10a4 4 0 0 0 .5-7.97A5.5 5.5 0 0 0 7 ' + (y + 0.6) + ' 4.2 4.2 0 0 0 7 ' + (y + 9) + 'z'; }
		switch (kind) {
			case 'sun':
				add('circle', { cx: 12, cy: 12, r: 4 });
				[0, 45, 90, 135, 180, 225, 270, 315].forEach(function (a) {
					var r = a * RAD;
					add('line', { x1: (12 + 6.5 * Math.cos(r)).toFixed(2), y1: (12 + 6.5 * Math.sin(r)).toFixed(2), x2: (12 + 9 * Math.cos(r)).toFixed(2), y2: (12 + 9 * Math.sin(r)).toFixed(2) });
				});
				break;
			case 'moon':
				add('path', { d: 'M14.5 3.5a8.5 8.5 0 1 0 6 13.5A7 7 0 0 1 14.5 3.5z' });
				break;
			case 'partly':
				add('path', { d: 'M9 9.5a3.5 3.5 0 0 1 6.3-1.6' });
				add('line', { x1: 12.5, y1: 3, x2: 12.5, y2: 4.6 }); add('line', { x1: 18.5, y1: 5.5, x2: 17.4, y2: 6.6 }); add('line', { x1: 21, y1: 11, x2: 19.4, y2: 11 }); add('line', { x1: 6.5, y1: 5.5, x2: 7.6, y2: 6.6 });
				add('path', { d: 'M8 20h8a3.5 3.5 0 0 0 .4-6.98A4.5 4.5 0 0 0 8 13.3 3.4 3.4 0 0 0 8 20z' });
				break;
			case 'cloud':
				add('path', { d: cloud(9) });
				break;
			case 'fog':
				add('path', { d: cloud(4) });
				add('line', { x1: 5, y1: 17, x2: 17, y2: 17 }); add('line', { x1: 8, y1: 20.5, x2: 19, y2: 20.5 });
				break;
			case 'rain':
				add('path', { d: cloud(6) });
				add('line', { x1: 9, y1: 18, x2: 8, y2: 21 }); add('line', { x1: 13, y1: 18, x2: 12, y2: 21 }); add('line', { x1: 17, y1: 18, x2: 16, y2: 21 });
				break;
			case 'snow':
				add('path', { d: cloud(5) });
				add('line', { x1: 8.5, y1: 17.5, x2: 8.5, y2: 21 }); add('line', { x1: 7, y1: 19.25, x2: 10, y2: 19.25 });
				add('line', { x1: 15.5, y1: 17.5, x2: 15.5, y2: 21 }); add('line', { x1: 14, y1: 19.25, x2: 17, y2: 19.25 });
				break;
			case 'storm':
				add('path', { d: cloud(5) });
				add('path', { d: 'M12.5 14l-2.5 4h3l-1.5 4' });
				break;
			case 'commit':
				add('circle', { cx: 12, cy: 12, r: 3.2 }); add('line', { x1: 3, y1: 12, x2: 8.8, y2: 12 }); add('line', { x1: 15.2, y1: 12, x2: 21, y2: 12 });
				break;
		}
		return s;
	}
	function wmo(code, isDay) {
		code = +code;
		if (code === 0) return { word: 'Clear', icon: isDay ? 'sun' : 'moon' };
		if (code === 1) return { word: 'Fair', icon: isDay ? 'sun' : 'moon' };
		if (code === 2) return { word: 'Cloudy', icon: isDay ? 'partly' : 'cloud' };
		if (code === 3) return { word: 'Overcast', icon: 'cloud' };
		if (code === 45 || code === 48) return { word: 'Fog', icon: 'fog' };
		if (code >= 51 && code <= 57) return { word: 'Drizzle', icon: 'rain' };
		if (code >= 61 && code <= 67) return { word: 'Rain', icon: 'rain' };
		if (code >= 71 && code <= 77) return { word: 'Snow', icon: 'snow' };
		if (code >= 80 && code <= 82) return { word: 'Showers', icon: 'rain' };
		if (code === 85 || code === 86) return { word: 'Snow', icon: 'snow' };
		if (code >= 95) return { word: 'Storm', icon: 'storm' };
		return { word: 'Weather', icon: 'cloud' };
	}

	// ---- Sky strip --------------------------------------------------------------
	// Keyed by solar elevation (degrees): [elev, top, bottom, ground].
	var SKY = [
		[-18, '#090d1f', '#141a33', '#0b0e18'],
		[-10, '#101738', '#2d2a58', '#0e111c'],
		[-5, '#23356b', '#b85c5a', '#141722'],
		[0, '#3b64a8', '#f0a060', '#2a2f33'],
		[6, '#4f86cf', '#f6cf8c', '#56704f'],
		[15, '#4b93e0', '#a6d2f3', '#5f8a5a'],
		[60, '#3f86d9', '#b9dcf5', '#6a9a62'],
	];
	function skyAt(e) {
		var i = 0;
		while (i < SKY.length - 2 && e > SKY[i + 1][0]) i++;
		var a = SKY[i], b = SKY[i + 1];
		var t = Math.max(0, Math.min(1, (e - a[0]) / (b[0] - a[0])));
		return { top: mixHex(a[1], b[1], t), bottom: mixHex(a[2], b[2], t), ground: mixHex(a[3], b[3], t) };
	}

	var W = 100, H = 44, HZ = 33, X0 = 10, X1 = 90, PEAK = 25;
	function arcPoint(t) { return { x: X0 + (X1 - X0) * t, y: HZ - Math.sin(Math.PI * t) * PEAK }; }
	function arcPath() {
		var d = '';
		for (var i = 0; i <= 24; i++) { var p = arcPoint(i / 24); d += (i ? ' L' : 'M') + p.x.toFixed(2) + ' ' + p.y.toFixed(2); }
		return d;
	}
	var STARS = [];
	for (var si = 0; si < 14; si++) { var hs = hash('star' + si); STARS.push({ x: 3 + (hs % 940) / 10, y: 3 + ((hs >>> 10) % 240) / 10, r: 0.35 + ((hs >>> 20) % 5) / 10 }); }

	function buildSky() {
		var s = svg('svg', { viewBox: '0 0 ' + W + ' ' + H, preserveAspectRatio: 'none', 'class': 'now-sky', 'aria-hidden': 'true' });
		var defs = svg('defs', {});
		var g = svg('linearGradient', { id: 'now-skyg', x1: 0, y1: 0, x2: 0, y2: 1 });
		var g1 = svg('stop', { offset: '0' }), g2 = svg('stop', { offset: '1' });
		g.appendChild(g1); g.appendChild(g2); defs.appendChild(g);
		var glow = svg('radialGradient', { id: 'now-glow' });
		glow.appendChild(svg('stop', { offset: '0', 'stop-color': '#fff6d6', 'stop-opacity': '0.9' }));
		glow.appendChild(svg('stop', { offset: '1', 'stop-color': '#ffd27a', 'stop-opacity': '0' }));
		defs.appendChild(glow);
		s.appendChild(defs);
		var sky = svg('rect', { x: 0, y: 0, width: W, height: HZ, fill: 'url(#now-skyg)' });
		var stars = svg('g', { fill: '#fff', opacity: 0 });
		STARS.forEach(function (st) { stars.appendChild(svg('circle', { cx: st.x, cy: st.y, r: st.r })); });
		var ground = svg('rect', { x: 0, y: HZ, width: W, height: H - HZ });
		var arc = svg('path', { d: arcPath(), fill: 'none', stroke: '#fff', 'stroke-opacity': '0.45', 'stroke-width': '1', 'stroke-dasharray': '2 3', 'vector-effect': 'non-scaling-stroke' });
		var horizon = svg('line', { x1: 0, y1: HZ, x2: W, y2: HZ, stroke: '#fff', 'stroke-opacity': '0.5', 'stroke-width': '1', 'vector-effect': 'non-scaling-stroke' });
		var body = svg('g', {});
		var glowC = svg('ellipse', { cx: 0, cy: 0, rx: 10, ry: 10, fill: 'url(#now-glow)' });
		var sun = svg('ellipse', { cx: 0, cy: 0, rx: 3, ry: 3, fill: '#fff4c2' });
		var moonG = svg('g', {});
		moonG.appendChild(svg('ellipse', { cx: 0, cy: 0, rx: 7, ry: 7, fill: '#dfe6ff', opacity: '0.12' })); moonG.appendChild(svg('ellipse', { cx: 0, cy: 0, rx: 3, ry: 3, fill: '#2a3150' }));
		var moonLit = svg('path', { d: '', fill: '#eef1ff' });
		moonG.appendChild(moonLit);
		body.appendChild(glowC); body.appendChild(sun); body.appendChild(moonG);
		s.appendChild(sky); s.appendChild(stars); s.appendChild(ground); s.appendChild(arc); s.appendChild(horizon); s.appendChild(body);
		return { svg: s, g1: g1, g2: g2, stars: stars, ground: ground, body: body, glow: glowC, sun: sun, moonG: moonG, moonLit: moonLit };
	}
	// Lit part of a moon disc of radius r for phase 0..1 (SVG y-down coords).
	function moonPath(phase, r) {
		var rx = Math.abs(Math.cos(2 * Math.PI * phase)) * r;
		var waxing = phase < 0.5;
		var outer = 'A' + r + ' ' + r + ' 0 0 ' + (waxing ? 1 : 0) + ' 0 ' + r;
		var sweep = waxing ? (phase < 0.25 ? 0 : 1) : (phase < 0.75 ? 0 : 1);
		return 'M0 ' + (-r) + ' ' + outer + ' A' + rx.toFixed(3) + ' ' + r + ' 0 0 ' + sweep + ' 0 ' + (-r) + 'Z';
	}

	// ---- Card ---------------------------------------------------------------------
	var root = null, sky = null, refs = {}, aborts = [], books = null, reduced = false;
	var lastSecond = -1, lastMinuteKey = '';

	function skel(cls) { var s = el('span', 'now-skel ' + (cls || '')); s.setAttribute('aria-hidden', 'true'); return s; }

	function build() {
		root = el('section', 'now-card');
		root.id = 'now-card';
		root.setAttribute('aria-label', 'Now in Garland, Texas');

		var strip = el('div', 'now-strip');
		sky = buildSky();
		strip.appendChild(sky.svg);
		root.appendChild(strip);

		var clock = el('div', 'now-row now-clock');
		refs.time = el('time', 'now-time', '--:--');
		var side = el('div', 'now-side');
		refs.date = el('div', 'now-date', ' ');
		refs.sun = el('div', 'now-sun', ' ');
		side.appendChild(refs.date); side.appendChild(refs.sun);
		clock.appendChild(refs.time); clock.appendChild(side);
		root.appendChild(clock);

		refs.wx = el('div', 'now-row now-wx');
		refs.wx.appendChild(skel('now-skel-icon')); refs.wx.appendChild(skel('now-skel-w1'));
		root.appendChild(refs.wx);

		refs.gh = el('div', 'now-row now-gh');
		refs.gh.appendChild(skel('now-skel-icon')); refs.gh.appendChild(skel('now-skel-w2'));
		root.appendChild(refs.gh);

		refs.pick = el('div', 'now-row now-pick');
		refs.pick.appendChild(skel('now-skel-spine')); refs.pick.appendChild(skel('now-skel-w3'));
		root.appendChild(refs.pick);

		var foot = el('div', 'now-foot');
		foot.appendChild(el('span', null, 'Garland, TX'));
		foot.appendChild(el('span', 'now-dot', '·'));
		foot.appendChild(el('span', 'now-mono', 'UTC−5/−6'));
		root.appendChild(foot);
		return root;
	}

	// Hide a row that failed to load. The card keeps its reserved height
	// (min-height in CSS, footer pinned to the bottom) so nothing below moves.
	function collapse(row) {
		if (!row || row.classList.contains('now-off')) return;
		row.style.height = row.offsetHeight + 'px';
		requestAnimationFrame(function () { requestAnimationFrame(function () { if (row.parentNode) { row.classList.add('now-off'); row.style.height = ''; } }); });
	}
	function fill(row, nodes) {
		while (row.firstChild) row.removeChild(row.firstChild);
		nodes.forEach(function (n) { row.appendChild(n); });
		row.classList.add('now-ready');
	}

	// ---- Clock + sky updates ----------------------------------------------------
	function tick(force) {
		if (!root) return;
		var d = now();
		var p = localParts(d);
		if (!force && p.S === lastSecond) return;
		lastSecond = p.S;
		if (!dtfTime) dtfTime = fmt({ hour: 'numeric', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
		if (!dtfTimeShort) dtfTimeShort = fmt({ hour: 'numeric', minute: '2-digit', hourCycle: 'h23' });
		var str = (reduced ? dtfTimeShort : dtfTime).format(d);
		if (refs.time.textContent !== str) refs.time.textContent = str;
		refs.time.setAttribute('datetime', d.toISOString());
		var mk = dayKey(d) + ' ' + p.H + ':' + p.M;
		if (force || mk !== lastMinuteKey) { lastMinuteKey = mk; minute(d, p); }
	}
	function minute(d, p) {
		if (!dtfDate) dtfDate = fmt({ weekday: 'long', month: 'short', day: 'numeric' });
		refs.date.textContent = dtfDate.format(d);
		var today = sunTimes(p), t = d.getTime();
		var txt, isNight, prog;
		if (t < today.rise) {
			var prev = sunTimes(shiftDay(p, -1));
			txt = 'sunrise in ' + untilText(today.rise - t); isNight = true; prog = (t - prev.set) / (today.rise - prev.set);
		} else if (t < today.set) {
			txt = 'sunset in ' + untilText(today.set - t); isNight = false; prog = (t - today.rise) / (today.set - today.rise);
		} else {
			var next = sunTimes(shiftDay(p, 1));
			txt = 'sunrise in ' + untilText(next.rise - t); isNight = true; prog = (t - today.set) / (next.rise - today.set);
		}
		refs.sun.textContent = txt;
		paintSky(d, isNight, Math.max(0, Math.min(1, prog)));
	}
	function paintSky(d, isNight, prog) {
		var e = elevation(d);
		var c = skyAt(e);
		sky.g1.setAttribute('stop-color', c.top); sky.g2.setAttribute('stop-color', c.bottom);
		sky.ground.setAttribute('fill', c.ground);
		var night = Math.max(0, Math.min(1, (-e - 4) / 8));
		sky.stars.setAttribute('opacity', (night * 0.85).toFixed(2));
		var pt = arcPoint(prog);
		// Keep the disc round even though the SVG is stretched to the strip.
		var box = sky.svg.getBoundingClientRect();
		var ratio = box.width && box.height ? (box.width / W) / (box.height / H) : 1;
		sky.body.setAttribute('transform', 'translate(' + pt.x.toFixed(2) + ' ' + pt.y.toFixed(2) + ') scale(' + (1 / ratio).toFixed(3) + ' 1)');
		sky.sun.style.display = isNight ? 'none' : '';
		sky.glow.style.display = isNight ? 'none' : '';
		sky.moonG.style.display = isNight ? '' : 'none';
		if (!isNight) {
			var warm = Math.max(0, Math.min(1, 1 - e / 12));
			sky.sun.setAttribute('fill', mixHex('#fff7cc', '#ffb347', warm));
		} else {
			sky.moonLit.setAttribute('d', moonPath(moonPhase(d), 3));
		}
	}

	// ---- Weather ----------------------------------------------------------------
	function renderWx(cur) {
		if (!root || !cur || typeof cur.temperature_2m !== 'number') return collapse(refs.wx);
		var f = Math.round(cur.temperature_2m), c = Math.round((cur.temperature_2m - 32) * 5 / 9);
		var w = wmo(cur.weather_code, cur.is_day !== 0);
		var text = el('div', 'now-text');
		text.appendChild(el('span', 'now-temp', f + '°F'));
		text.appendChild(el('span', 'now-sub', ' · ' + c + '°C · '));
		text.appendChild(el('span', 'now-word', w.word));
		fill(refs.wx, [glyph(w.icon), text]);
		refs.wx.setAttribute('title', 'Current conditions (Open-Meteo)');
	}
	function loadWx(signal) {
		if (DEBUG_NOW) return renderWx(debug === 'now-day' ? { temperature_2m: 91, weather_code: 0, is_day: 1 } : { temperature_2m: 68, weather_code: 2, is_day: 0 });
		var cached = cacheGet(WX_KEY, WX_TTL);
		if (cached) return renderWx(cached);
		fetchJSON(WX_URL, signal).then(function (j) {
			if (!root) return;
			var cur = j && j.current;
			if (cur && typeof cur.temperature_2m === 'number') { cacheSet(WX_KEY, cur); renderWx(cur); } else collapse(refs.wx);
		}).catch(function () { collapse(refs.wx); });
	}

	// ---- GitHub -------------------------------------------------------------------
	function renderGh(push) {
		if (!root || !push || !push.repo) return collapse(refs.gh);
		var text = el('div', 'now-text');
		var a = el('a', 'now-repo', push.repo.replace(/^nietztein\//i, ''));
		a.href = 'https://github.com/' + push.repo; a.target = '_blank'; a.rel = 'noopener noreferrer';
		a.title = 'Latest push: ' + push.repo;
		text.appendChild(el('span', 'now-sub', 'pushed '));
		text.appendChild(a);
		text.appendChild(el('span', 'now-sub', ' · ' + relTime(now().getTime() - push.at)));
		fill(refs.gh, [glyph('commit'), text]);
	}
	function loadGh(signal) {
		if (DEBUG_NOW) return renderGh({ repo: 'nietztein/nietztein.github.io', at: DEBUG_NOW - 2 * 3600 * 1000 - 5 * 60000 });
		var cached = cacheGet(GH_KEY, GH_TTL);
		if (cached) return renderGh(cached);
		fetchJSON(GH_URL, signal).then(function (j) {
			if (!root) return;
			var ev = null;
			if (Array.isArray(j)) for (var i = 0; i < j.length; i++) if (j[i] && j[i].type === 'PushEvent') { ev = j[i]; break; }
			if (ev && ev.repo && ev.repo.name && ev.created_at) {
				var push = { repo: ev.repo.name, at: Date.parse(ev.created_at) };
				cacheSet(GH_KEY, push); renderGh(push);
			} else collapse(refs.gh);
		}).catch(function () { collapse(refs.gh); });
	}

	// ---- Shelf pick -------------------------------------------------------------
	function pickable(b) { return b && b.t && b.g !== 'Games & other objects' && b.g !== 'Unidentified'; }
	function spineFor(b) {
		var seed = hash(b.id || b.t);
		var hue = GENRE_HUE[b.g]; if (hue == null) hue = 0;
		var h = (hue + ((seed % 17) - 8) + 360) % 360, s = 34 + (seed % 26), l = 30 + ((seed >>> 4) % 26);
		var sp = el('a', 'now-spine');
		sp.href = '#/bookshelf/' + encodeURIComponent(b.id);
		sp.style.setProperty('--sp', 'hsl(' + h + ' ' + s + '% ' + l + '%)');
		sp.setAttribute('aria-label', 'Open ' + b.t + ' on the bookshelf');
		sp.appendChild(el('span', 'now-spine-band'));
		return sp;
	}
	function renderPick(b) {
		if (!root || !b) return collapse(refs.pick);
		var text = el('div', 'now-text now-pick-text');
		text.appendChild(el('span', 'now-sub now-label', "today's pick"));
		var a = el('a', 'now-title', b.t);
		a.href = '#/bookshelf/' + encodeURIComponent(b.id);
		a.title = b.t;
		if (/[぀-ヿ一-鿿]/.test(b.t)) a.lang = 'ja';
		text.appendChild(a);
		text.appendChild(el('span', 'now-sub now-author', b.a || b.pub || b.ty || ''));
		var btn = el('button', 'now-another', 'another');
		btn.type = 'button';
		btn.title = 'Pick a random book';
		btn.setAttribute('aria-label', 'Pick another book at random');
		btn.addEventListener('click', function () {
			var pool = books.filter(pickable);
			var nb = pool[Math.floor(Math.random() * pool.length)];
			if (nb === b && pool.length > 1) nb = pool[(pool.indexOf(nb) + 1) % pool.length];
			renderPick(nb);
			var again = refs.pick.querySelector('.now-another');
			if (again) again.focus();
		});
		fill(refs.pick, [spineFor(b), text, btn]);
	}
	function loadPick(signal) {
		fetchJSON(LIB_URL, signal).then(function (j) {
			if (!root) return;
			books = (j && j.books) || [];
			var pool = books.filter(pickable);
			if (!pool.length) return collapse(refs.pick);
			renderPick(pool[hash('pick:' + dayKey(now())) % pool.length]);
		}).catch(function () { collapse(refs.pick); });
	}

	// ---- Lifecycle ----------------------------------------------------------------
	var clockTimer = 0;
	function startClock() {
		stopClock();
		if (DEBUG_NOW) return;
		if (reduced) {
			// Minute updates only: wake up just after the next minute boundary.
			var d = new Date();
			var wait = 60000 - (d.getSeconds() * 1000 + d.getMilliseconds()) + 50;
			clockTimer = setTimeout(function () { tick(true); clockTimer = setInterval(function () { tick(true); }, 60000); }, wait);
		} else {
			clockTimer = setInterval(function () { tick(false); }, 1000);
		}
	}
	function stopClock() { if (clockTimer) { clearTimeout(clockTimer); clearInterval(clockTimer); clockTimer = 0; } }
	function onVisibility() { if (!root) return; if (document.hidden) stopClock(); else { tick(true); startClock(); } }
	var resizeRaf = 0;
	function onResize() { if (!root || resizeRaf) return; resizeRaf = requestAnimationFrame(function () { resizeRaf = 0; tick(true); }); }
	function onMotion() { reduced = Gadgets.reducedMotion; if (root) root.classList.toggle('now-reduced', reduced); tick(true); if (!document.hidden) startClock(); }

	var motionMq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

	function enable() {
		if (root) return;
		var panel = document.getElementById('leftPanel');
		if (!panel) return;
		var rows = panel.querySelectorAll('.row.mb-2');
		var last = rows.length ? rows[rows.length - 1] : null;
		reduced = Gadgets.reducedMotion;
		build();
		root.classList.toggle('now-reduced', reduced);
		if (last && last.nextSibling) panel.insertBefore(root, last.nextSibling); else panel.appendChild(root);
		tick(true);
		if (!document.hidden) startClock();
		document.addEventListener('visibilitychange', onVisibility);
		window.addEventListener('resize', onResize);
		if (motionMq && motionMq.addEventListener) motionMq.addEventListener('change', onMotion);
		var ctrl = window.AbortController ? new AbortController() : null;
		aborts.push(ctrl);
		var sig = ctrl ? ctrl.signal : null;
		loadWx(sig); loadGh(sig); loadPick(sig);
	}
	function disable() {
		stopClock();
		if (resizeRaf) { cancelAnimationFrame(resizeRaf); resizeRaf = 0; }
		document.removeEventListener('visibilitychange', onVisibility);
		window.removeEventListener('resize', onResize);
		if (motionMq && motionMq.removeEventListener) motionMq.removeEventListener('change', onMotion);
		aborts.forEach(function (c) { try { if (c) c.abort(); } catch (e) { /* ignore */ } });
		aborts = [];
		if (root && root.parentNode) root.parentNode.removeChild(root);
		root = null; sky = null; refs = {}; books = null; lastSecond = -1; lastMinuteKey = '';
	}

	Gadgets.register('now', { label: 'Now in Garland card', enable: enable, disable: disable });
})();
