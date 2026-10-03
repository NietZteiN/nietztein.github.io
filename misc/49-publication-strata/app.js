// Strata: the library as a stratigraphic section of first-publication years.
//
// x is time on a piecewise scale: a compressed "deep time" zone for everything
// before 1800 (piecewise-linear anchors), then 1800 to today at full width,
// with a torn fold mark between them. The view is a window [u0,u1] of the
// abstract coordinate u in [0,1], so zooming is the same operation everywhere.
// Each dated book is one block stacked in its year column (sorted by genre so
// the columns band); behind them a wiggle-offset streamgraph of books per
// decade by genre. Undated books live in a hatched band at the bottom: when
// the raw year text parses into a range ("2010s", "5th c. BC") the block is
// stretched over that range, otherwise it is parked in the "no date" gutter.
// Everything is drawn on one canvas; the tooltip and card are HTML.

(function () {
	'use strict';

	var DATA_URL = '../../assets/data/library.json';
	var THIS_YEAR = new Date().getFullYear();
	var Y_MIN = -2200, FOLD = 1800, Y_MAX = THIS_YEAR + 1;
	var DEEP_FRAC = 0.2;
	// piecewise-linear anchors for the deep-time zone: year -> u
	var DEEP = [[-2200, 0], [-500, 0.045], [0, 0.08], [1000, 0.12], [1500, 0.158], [1800, DEEP_FRAC]];

	var GENRE_HUE = {
		'Literature (English & European)': 214, 'Japanese literature': 354, 'Manga & comics': 322, 'Light novels': 282,
		'Writing, film & literary craft': 28, 'History & biography': 14, 'Philosophy & political theory': 248,
		'Religion & theology': 42, 'Society, culture & ideas': 186, 'Politics, law & current affairs': 168,
		'Psychology, self-help & business': 142, 'Art & visual culture': 76, 'Music & opera': 266,
		'Language study & reference': 104, 'Test prep & study guides': 56, 'Math, CS & engineering': 200,
		'Science': 178, 'Nursing & medical': 6, 'Magazines & catalogues': 90, 'Occult & folklore': 300,
		'Games & other objects': 0, 'Unidentified': 0,
	};
	var GENRE_ORDER = Object.keys(GENRE_HUE);
	var GENRE_INDEX = {};
	GENRE_ORDER.forEach(function (g, i) { GENRE_INDEX[g] = i; });
	var LANGS = [
		{ k: 'EN', name: 'English', hue: 214 },
		{ k: 'JA', name: 'Japanese', hue: 354 },
		{ k: 'other', name: 'Bilingual & other', hue: 42 },
	];
	var LANG_HUE = { EN: 214, JA: 354, other: 42 };
	var UNITS = {
		K: 'Pine library', H: 'Black bookcase', N: 'Manga case', B: 'Cherry bookcase', G: 'Library-label shelves',
		I: 'Cream bookcase', L: 'Nursing case', M: 'Japanese literature shelf', A: 'Light-wood unit', D: 'Wire shelf',
		F: 'Headset shelf', J: 'Cubby', Loose: 'Desk and floor',
	};
	var AUTHOR_ALIAS = {
		'村上春樹': 'Haruki Murakami', '三島由紀夫': 'Yukio Mishima', 'Mishima Yukio': 'Yukio Mishima',
		'太宰治': 'Osamu Dazai', 'Dazai Osamu': 'Osamu Dazai', '夏目漱石': 'Natsume Sōseki', '芥川龍之介': 'Ryūnosuke Akutagawa',
		'ed. Charles W. Eliot': 'Charles W. Eliot (ed.)', '井浦秀夫 / 監修 小林茂和': '井浦秀夫', '渡航 ほか': '渡航',
	};
	var EVENTS = [
		{ y: -2100, t: 'Gilgamesh written down' },
		{ y: -750, t: 'Homer’s epics take shape' },
		{ y: -430, t: 'Athenian tragedy at its height' },
		{ y: 1010, t: 'The Tale of Genji' },
		{ y: 1455, t: 'Gutenberg Bible' },
		{ y: 1605, t: 'Don Quixote, the first modern novel' },
		{ y: 1868, t: 'Meiji Restoration' },
		{ y: 1909, t: 'Harvard Classics: the five-foot shelf' },
		{ y: 1935, t: 'Penguin: the paperback revolution' },
		{ y: 1947, t: 'Tezuka’s New Treasure Island' },
		{ y: 1968, t: 'Weekly Shōnen Jump, issue 1' },
		{ y: 1989, t: 'Heisei begins' },
		{ y: 2007, t: 'The Kindle' },
		{ y: 2017, t: '“Attention Is All You Need”' },
	];

	var reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
	var params = new URLSearchParams(location.search);
	var THUMB = params.get('thumb') === '1';
	if (THUMB) document.body.classList.add('thumb');

	// ---- DOM -----------------------------------------------------------------
	function $(s) { return document.querySelector(s); }
	var stage = $('#stage'), canvas = $('#view'), ctx = canvas.getContext('2d');
	var tip = $('#tip'), msg = $('#msg'), hint = $('#hint');
	var searchEl = $('#search'), hitsEl = $('#hits');
	var eraEl = $('#era'), legendEl = $('#legend');
	var card = $('#card'), shade = $('#shade');
	var help = $('#help');

	// ---- State ---------------------------------------------------------------
	var books = [], dated = [], undated = [], byId = {};
	var view = { u0: 0, u1: 1 };
	var layers = 'both';            // blocks | streams | both
	var paint = 'genre';            // genre | lang
	var showEvents = true, showAuthors = false;
	var selected = null;            // book
	var pinned = false;             // tooltip pinned to the selected block
	var hits = [], hitSet = null, hitIndex = -1;
	var genreFocus = null, authorFocus = null;
	var hoverBlock = null, hoverRibbon = null;
	var W = 0, H = 0, dpr = 1;
	var blockRects = [], ribbonRects = [], streamShapes = null, lastLayout = null;
	var brush = null, drag = null;
	var anim = null;
	var stacks = {};                // paint -> {bins, keys, series}
	var authors = [];
	var rangeGroups = [], noDate = [];
	var yearCols = [];              // [{y, books}] sorted by year, stacking order
	var yearIndex = {};
	var hatch = null;

	// ---- Helpers -------------------------------------------------------------
	function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
	function fmt(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
	function fmtYear(y) { return y < 0 ? (-y) + ' BC' : (y < 1000 ? 'AD ' + Math.max(1, y) : String(y)); }
	function fmtYearShort(y) { return y < 0 ? (-y) + ' BC' : String(Math.max(1, y)); }
	function isCJK(s) { return /[぀-ヿ㐀-鿿]/.test(s); }
	function norm(s) { return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }
	function cmpTitle(a, b) {
		var ca = isCJK(a.t), cb = isCJK(b.t);
		if (ca !== cb) return ca ? 1 : -1;
		return a.t.localeCompare(b.t, 'en');
	}
	function langKey(b) { return b.l === 'EN' ? 'EN' : (b.l === 'JA' ? 'JA' : 'other'); }
	function colorKey(b) { return paint === 'lang' ? langKey(b) : b.g; }
	function hueOf(key) { return paint === 'lang' ? LANG_HUE[key] : GENRE_HUE[key]; }
	function keyColor(key, a, sat, lum) {
		var h = hueOf(key);
		if (!h) return 'hsla(30, 6%, ' + (lum || 58) + '%, ' + a + ')';
		return 'hsla(' + h + ', ' + (sat || 44) + '%, ' + (lum || 58) + '%, ' + a + ')';
	}
	function bookColor(b, a) { return keyColor(colorKey(b), a == null ? 1 : a); }
	function keyName(key) {
		if (paint === 'lang') { for (var i = 0; i < LANGS.length; i++) if (LANGS[i].k === key) return LANGS[i].name; }
		return key;
	}
	function shelfText(b) { return (UNITS[b.u] || b.u) + ' · ' + b.s; }
	function canonAuthor(a) {
		if (!a) return '';
		if (AUTHOR_ALIAS[a]) return AUTHOR_ALIAS[a];
		var s = a.replace(/,\s*(tr|trans|ed|eds|intro)\.?\s.*$/i, '').replace(/\s*\((ed|eds|tr)\.?\)\s*$/i, '').trim();
		return AUTHOR_ALIAS[s] || s;
	}
	function escapeHtml(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

	// ---- Scale ---------------------------------------------------------------
	function uOf(y) {
		if (y >= FOLD) return DEEP_FRAC + (y - FOLD) / (Y_MAX - FOLD) * (1 - DEEP_FRAC);
		if (y <= Y_MIN) return 0;
		for (var i = 1; i < DEEP.length; i++) {
			if (y <= DEEP[i][0]) {
				var a = DEEP[i - 1], b = DEEP[i];
				return a[1] + (y - a[0]) / (b[0] - a[0]) * (b[1] - a[1]);
			}
		}
		return DEEP_FRAC;
	}
	function yOf(u) {
		if (u >= DEEP_FRAC) return FOLD + (u - DEEP_FRAC) / (1 - DEEP_FRAC) * (Y_MAX - FOLD);
		if (u <= 0) return Y_MIN;
		for (var i = 1; i < DEEP.length; i++) {
			if (u <= DEEP[i][1]) {
				var a = DEEP[i - 1], b = DEEP[i];
				return a[0] + (u - a[1]) / (b[1] - a[1]) * (b[0] - a[0]);
			}
		}
		return FOLD;
	}
	var PL = 10, PR = 10;
	function xOfU(u) { return PL + (u - view.u0) / (view.u1 - view.u0) * (W - PL - PR); }
	function xOfY(y) { return xOfU(uOf(y)); }
	function uOfX(x) { return view.u0 + (x - PL) / (W - PL - PR) * (view.u1 - view.u0); }
	function pxPerYearAt(y) { return xOfY(y + 1) - xOfY(y); }
	function setView(u0, u1) {
		var minSpan = 2 / (Y_MAX - FOLD) * (1 - DEEP_FRAC);
		u0 = clamp(u0, 0, 1); u1 = clamp(u1, 0, 1);
		if (u1 - u0 < minSpan) { var c = (u0 + u1) / 2; u0 = c - minSpan / 2; u1 = c + minSpan / 2; }
		if (u0 < 0) { u1 -= u0; u0 = 0; }
		if (u1 > 1) { u0 -= (u1 - 1); u1 = 1; u0 = Math.max(0, u0); }
		view.u0 = u0; view.u1 = u1;
		syncZoomButtons();
		draw();
	}
	function animateView(u0, u1) {
		if (anim) { cancelAnimationFrame(anim.raf); anim = null; }
		if (reducedMotion || THUMB) { setView(u0, u1); return; }
		var from = { u0: view.u0, u1: view.u1 }, t0 = performance.now(), dur = 520;
		var target = { u0: clamp(u0, 0, 1), u1: clamp(u1, 0, 1) };
		function step(now) {
			var t = clamp((now - t0) / dur, 0, 1), e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
			setView(from.u0 + (target.u0 - from.u0) * e, from.u1 + (target.u1 - from.u1) * e);
			if (t < 1) anim.raf = requestAnimationFrame(step); else { anim = null; if (pinned && selected) pinTipToSelected(); }
		}
		anim = { raf: requestAnimationFrame(step) };
	}
	function flyToYear(y, force) {
		var x = xOfY(y);
		if (!force && x > PL + 20 && x < W - PR - 20 && pxPerYearAt(y) >= 2.5) return;
		var u = uOf(y), half;
		if (y >= FOLD) half = Math.min(view.u1 - view.u0, uOf(y + 30) - uOf(y)) ;
		else half = Math.max(0.03, Math.min((view.u1 - view.u0) / 2, 0.06));
		if (y >= FOLD && half < uOf(FOLD + 12) - uOf(FOLD)) half = uOf(FOLD + 30) - uOf(FOLD);
		if (y >= FOLD) half = Math.max(half, uOf(FOLD + 20) - uOf(FOLD));
		animateView(u - half, u + half);
	}
	function syncZoomButtons() {
		var btns = document.querySelectorAll('#zooms button');
		for (var i = 0; i < btns.length; i++) {
			var z = btns[i].getAttribute('data-z'), u0 = z === 'all' ? 0 : uOf(+z);
			btns[i].classList.toggle('on', Math.abs(view.u0 - u0) < 1e-6 && Math.abs(view.u1 - 1) < 1e-6);
		}
	}

	// ---- Data prep -----------------------------------------------------------
	function parseRange(yr) {
		var s = (yr || '').toLowerCase();
		var m = s.match(/(\d{3,4})s\s*(?:to|-|–)\s*(\d{2,4})s/);
		if (m) {
			var a = +m[1], b = +m[2];
			if (m[2].length === 2) b = Math.floor(a / 100) * 100 + b;
			return { a: a, b: b + 9 };
		}
		m = s.match(/(\d{3,4})s/);
		if (m) return { a: +m[1], b: +m[1] + 9 };
		m = s.match(/(early|mid|late)?\s*(\d{1,2})(?:st|nd|rd|th)\s*c\.?(\s*bc)?/);
		if (m) {
			var n = +m[2], bc = !!m[3], a2, b2;
			if (bc) { a2 = -n * 100; b2 = -(n - 1) * 100 - 1; } else { a2 = (n - 1) * 100 + 1; b2 = n * 100; }
			if (m[1] === 'early') b2 = a2 + 33;
			else if (m[1] === 'mid') { a2 += 33; b2 = a2 + 33; }
			else if (m[1] === 'late') a2 = b2 - 33;
			return { a: a2, b: b2 };
		}
		return null;
	}

	function prepare(list) {
		books = list.slice();
		dated = []; undated = []; byId = {};
		books.forEach(function (b) {
			byId[b.id] = b;
			b._q = norm(b.t) + ' ' + norm(b.a);
			if (typeof b.y === 'number') dated.push(b); else undated.push(b);
		});
		// year columns in stacking order (genre, then language, then title)
		var cols = {};
		dated.forEach(function (b) { (cols[b.y] = cols[b.y] || []).push(b); });
		yearCols = Object.keys(cols).map(Number).sort(function (a, b) { return a - b; }).map(function (y) {
			var arr = cols[y].sort(function (a, b) {
				var d = (GENRE_INDEX[a.g] || 0) - (GENRE_INDEX[b.g] || 0);
				if (d) return d;
				d = langKey(a).localeCompare(langKey(b));
				return d || cmpTitle(a, b);
			});
			arr.forEach(function (b, i) { b._yi = i; });
			return { y: y, books: arr };
		});
		yearIndex = {};
		yearCols.forEach(function (c, i) { yearIndex[c.y] = i; });

		// streams
		stacks.genre = buildStack(function (b) { return b.g; }, GENRE_ORDER);
		stacks.lang = buildStack(langKey, LANGS.map(function (l) { return l.k; }));

		// authors with 2+ dated books
		var am = {};
		dated.forEach(function (b) {
			var a = canonAuthor(b.a);
			if (!a) return;
			(am[a] = am[a] || { name: a, books: [] }).books.push(b);
		});
		authors = Object.keys(am).map(function (k) { return am[k]; }).filter(function (a) { return a.books.length >= 2; });
		authors.forEach(function (a) {
			a.books.sort(function (p, q) { return p.y - q.y; });
			var gc = {}; a.books.forEach(function (b) { gc[b.g] = (gc[b.g] || 0) + 1; });
			a.genre = Object.keys(gc).sort(function (x, y) { return gc[y] - gc[x]; })[0];
			a.min = a.books[0].y; a.max = a.books[a.books.length - 1].y; a.n = a.books.length;
		});
		authors.sort(function (a, b) { return a.min - b.min || b.n - a.n; });

		// undated: parse ranges, group, pack
		var groups = {};
		noDate = [];
		undated.forEach(function (b) {
			var r = parseRange(b.yr);
			if (!r) { noDate.push(b); return; }
			var k = r.a + ':' + r.b;
			(groups[k] = groups[k] || { a: r.a, b: r.b, books: [] }).books.push(b);
		});
		noDate.sort(cmpTitle);
		rangeGroups = Object.keys(groups).map(function (k) { return groups[k]; });
		rangeGroups.forEach(function (g) { g.books.sort(function (p, q) { return (GENRE_INDEX[p.g] || 0) - (GENRE_INDEX[q.g] || 0) || cmpTitle(p, q); }); });
		rangeGroups.sort(function (p, q) { return q.books.length - p.books.length || p.a - q.a; });
		var placed = [];
		rangeGroups.forEach(function (g) {
			var y0 = 0;
			placed.forEach(function (p) { if (p.a <= g.b && p.b >= g.a) y0 = Math.max(y0, p.y0 + p.books.length); });
			g.y0 = y0; placed.push(g);
		});
		rangeGroups.maxTop = placed.reduce(function (m, p) { return Math.max(m, p.y0 + p.books.length); }, 0);
	}

	function buildStack(keyFn, keys) {
		// bins: centuries before 1800, decades after
		var bins = [];
		for (var c = Y_MIN; c < FOLD; c += 100) bins.push({ a: c, b: c + 100 });
		for (var d = FOLD; d <= THIS_YEAR; d += 10) bins.push({ a: d, b: Math.min(d + 10, Y_MAX) });
		var binOf = function (y) { for (var i = bins.length - 1; i >= 0; i--) if (y >= bins[i].a) return i; return 0; };
		var ki = {}; keys.forEach(function (k, i) { ki[k] = i; });
		var series = keys.map(function () { return bins.map(function () { return [0, 0]; }); });
		dated.forEach(function (b) {
			var k = keyFn(b), i = ki[k]; if (i == null) return;
			series[i][binOf(b.y)][1] += 1;
		});
		var totals = bins.map(function (_, j) { return series.reduce(function (s, sr) { return s + sr[j][1]; }, 0); });
		wiggle(series);
		var lo = Infinity, hi = -Infinity;
		series.forEach(function (sr) { sr.forEach(function (p) { lo = Math.min(lo, p[0]); hi = Math.max(hi, p[1]); }); });
		return { bins: bins, keys: keys, series: series, lo: lo, hi: hi, totals: totals };
	}
	// d3's stackOffsetWiggle followed by stackOffsetNone, in order
	function wiggle(series) {
		var n = series.length, m = series[0].length, s0 = series[0];
		var y = 0;
		for (var j = 1; j < m; ++j) {
			var s1 = 0, s2 = 0;
			for (var i = 0; i < n; ++i) {
				var si = series[i], sij0 = si[j][1] || 0, sij1 = si[j - 1][1] || 0, s3 = (sij0 - sij1) / 2;
				for (var k = 0; k < i; ++k) { var sk = series[k]; s3 += (sk[j][1] || 0) - (sk[j - 1][1] || 0); }
				s1 += sij0; s2 += s3 * sij0;
			}
			s0[j - 1][1] += s0[j - 1][0] = y;
			if (s1) y -= s2 / s1;
		}
		s0[m - 1][1] += s0[m - 1][0] = y;
		for (var ii = 1; ii < n; ++ii) {
			var prev = series[ii - 1], cur = series[ii];
			for (var jj = 0; jj < m; ++jj) cur[jj][1] += cur[jj][0] = prev[jj][1];
		}
	}

	// ---- Era readout ----------------------------------------------------------
	function renderEra() {
		var ys = dated.map(function (b) { return b.y; }).sort(function (a, b) { return a - b; });
		var n = ys.length, median = n % 2 ? ys[(n - 1) / 2] : Math.round((ys[n / 2 - 1] + ys[n / 2]) / 2);
		var dec = {}; ys.forEach(function (y) { var k = Math.floor(y / 10) * 10; dec[k] = (dec[k] || 0) + 1; });
		var best = Object.keys(dec).map(Number).sort(function (a, b) { return dec[b] - dec[a] || a - b; })[0];
		var oldest = dated.reduce(function (m, b) { return b.y < m.y ? b : m; }, dated[0]);
		var newest = dated.reduce(function (m, b) { return b.y > m.y ? b : m; }, dated[0]);
		var pre = ys.filter(function (y) { return y < 1900; }).length;
		var tiles = [
			{ k: 'median year', v: fmtYear(median), s: 'of ' + fmt(n) + ' dated books · ' + fmt(undated.length) + ' undated' },
			{ k: 'busiest decade', v: best + 's', s: fmt(dec[best]) + ' books first published' },
			{ k: 'oldest', v: fmtYear(oldest.y), s: oldest.t + ' · ' + oldest.a, id: oldest.id },
			{ k: 'newest', v: String(newest.y), s: newest.t + ' · ' + newest.a, id: newest.id },
			{ k: 'pre-1900', v: (100 * pre / n).toFixed(1) + '<small>%</small>', s: fmt(pre) + ' books older than 1900' },
		];
		eraEl.innerHTML = tiles.map(function (t) {
			return '<div class="tile' + (t.id ? ' link' : '') + '"' + (t.id ? ' data-id="' + t.id + '" title="show this book"' : '') + '>' +
				'<div class="k">' + t.k + '</div><div class="v">' + t.v + '</div><div class="s">' + escapeHtml(t.s) + '</div></div>';
		}).join('');
		eraEl.addEventListener('click', function (e) {
			var tile = e.target.closest('.tile.link'); if (!tile) return;
			var b = byId[tile.getAttribute('data-id')]; if (!b) return;
			selectBook(b, true);
			flyToYear(b.y, true);
		});
	}

	function renderLegend() {
		var counts = {};
		books.forEach(function (b) { var k = colorKey(b); counts[k] = (counts[k] || 0) + 1; });
		var keys = paint === 'lang' ? LANGS.map(function (l) { return l.k; }) : GENRE_ORDER.filter(function (g) { return counts[g]; });
		legendEl.innerHTML = keys.map(function (k) {
			return '<button data-k="' + escapeHtml(k) + '" class="' + (genreFocus ? (genreFocus === k ? 'on' : 'dim') : '') + '">' +
				'<i style="background:' + keyColor(k, 1) + '"></i>' + escapeHtml(keyName(k)) + ' <span class="n">' + fmt(counts[k] || 0) + '</span></button>';
		}).join('');
	}
	legendEl.addEventListener('click', function (e) {
		var btn = e.target.closest('button'); if (!btn) return;
		var k = btn.getAttribute('data-k');
		genreFocus = genreFocus === k ? null : k;
		renderLegend(); draw();
	});

	// ---- Layout + drawing ----------------------------------------------------
	function resize() {
		var rect = stage.getBoundingClientRect();
		var top = rect.top + window.scrollY;
		var narrow = window.innerWidth < 720;
		var h = narrow ? clamp(window.innerHeight - rect.top - 110, 400, 560) : clamp(window.innerHeight - rect.top - 120, 440, 720);
		if (THUMB) h = clamp(window.innerHeight - rect.top - 14, 300, 900);
		stage.style.height = Math.round(h) + 'px';
		dpr = Math.min(window.devicePixelRatio || 1, 2);
		W = Math.round(stage.clientWidth); H = Math.round(h);
		canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
		draw();
	}

	function makeHatch(c) {
		var p = document.createElement('canvas'); p.width = p.height = 8;
		var g = p.getContext('2d');
		g.strokeStyle = 'rgba(236,220,192,0.09)'; g.lineWidth = 1;
		g.beginPath(); g.moveTo(-2, 10); g.lineTo(10, -2); g.moveTo(-2, 2); g.lineTo(2, -2); g.moveTo(6, 10); g.lineTo(10, 6); g.stroke();
		return c.createPattern(p, 'repeat');
	}

	function font(size, weight) { return (weight || 500) + ' ' + size + 'px "Barlow Condensed", "Arial Narrow", "Roboto Condensed", Arial, sans-serif'; }
	function fontSans(size) { return size + 'px -apple-system, "Segoe UI", Helvetica, Arial, "Hiragino Sans", "Yu Gothic", sans-serif'; }

	function draw() {
		if (!books.length || !W) return;
		render(ctx, W, H, dpr, false);
		if (pinned && selected) pinTipToSelected();
	}

	function render(c, W_, H_, scale, forExport) {
		c.setTransform(scale, 0, 0, scale, 0, 0);
		c.clearRect(0, 0, W_, H_);
		c.fillStyle = '#0c0a09'; c.fillRect(0, 0, W_, H_);
		if (!hatch) hatch = makeHatch(c);

		var narrow = W_ < 720;
		var top = forExport ? 54 : 26;
		var eventsH = showEvents ? 30 : 0;
		var yA = yOf(view.u0), yB = yOf(view.u1);
		var inView = function (y) { return y >= yA - 1 && y <= yB + 1; };

		// undated band geometry
		var bandH = narrow ? 76 : 96, bandLabelH = 15;
		var bandTop = H_ - bandH - 4;
		var axisH = 24;
		var baseline = bandTop - axisH;

		var colTop = top + eventsH + 6;
		var colH = baseline - colTop;

		var deepX = xOfY(FOLD);
		var deepVisible = view.u0 < DEEP_FRAC;

		// deep-time zone shading
		if (deepVisible) {
			c.fillStyle = 'rgba(0,0,0,0.28)';
			c.fillRect(PL, top, Math.min(deepX, W_ - PR) - PL, baseline - top);
		}

		// ticks (vertical hairlines)
		var ticks = computeTicks(yA, yB, W_);
		c.strokeStyle = 'rgba(236,220,192,0.07)'; c.lineWidth = 1;
		c.beginPath();
		ticks.forEach(function (t) { var x = Math.round(xOfY(t.y)) + 0.5; c.moveTo(x, colTop); c.lineTo(x, baseline); });
		c.stroke();

		// ---- columns (blocks) ----
		blockRects = [];
		var cols = [];
		var maxStack = 1;
		if (layers !== 'streams') {
			var pxm = pxPerYearAt(FOLD + 1);
			var bm = pickBin(pxm, [1, 2, 5, 10, 20, 50]);
			var seen = {};
			dated.forEach(function (b) {
				if (!inView(b.y)) return;
				var bs = b.y >= FOLD ? bm : pickBin(pxPerYearAt(b.y), [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000]);
				var start = Math.floor(b.y / bs) * bs;
				var k = start + ':' + bs;
				if (!seen[k]) { seen[k] = { start: start, size: bs, books: [] }; cols.push(seen[k]); }
				seen[k].books.push(b);
			});
			cols.forEach(function (col) {
				col.books.sort(function (a, b) {
					var d = (GENRE_INDEX[a.g] || 0) - (GENRE_INDEX[b.g] || 0);
					if (d) return d;
					d = langKey(a).localeCompare(langKey(b));
					return d || (a.y - b.y) || cmpTitle(a, b);
				});
				maxStack = Math.max(maxStack, col.books.length);
			});
		}
		var hb = 0;
		if (cols.length) hb = Math.max(1.6, Math.min(12, (colH - 16) / maxStack));

		// ---- streams ----
		streamShapes = null;
		if (layers !== 'blocks') {
			var st = stacks[paint];
			var sh = colH * (layers === 'streams' ? 0.94 : 0.82);
			var sy = function (v) { return colTop + (colH - sh) / 2 + (v - st.lo) / (st.hi - st.lo) * sh; };
			var xs = st.bins.map(function (bn) { return xOfY((bn.a + bn.b) / 2); });
			streamShapes = { xs: xs, st: st, sy: sy };
			var alpha = layers === 'streams' ? 0.62 : 0.26;
			c.save();
			c.beginPath(); c.rect(PL, colTop - 2, W_ - PL - PR, colH + 2); c.clip();
			st.series.forEach(function (sr, i) {
				var key = st.keys[i];
				var dim = genreFocus && paint === 'genre' && genreFocus !== key ? 0.25 : 1;
				var topPts = xs.map(function (x, j) { return [x, sy(sr[j][1])]; });
				var botPts = xs.map(function (x, j) { return [x, sy(sr[j][0])]; });
				c.beginPath();
				monoPath(c, topPts, true);
				monoPath(c, botPts.slice().reverse(), false);
				c.closePath();
				c.fillStyle = keyColor(key, alpha * dim, 46, layers === 'streams' ? 52 : 46);
				c.fill();
				c.strokeStyle = keyColor(key, (layers === 'streams' ? 0.5 : 0.25) * dim, 40, 66);
				c.lineWidth = 0.8;
				c.stroke();
			});
			c.restore();
		}

		// horizontal count hairlines (every 10 books)
		if (hb > 0) {
			c.font = font(10); c.textAlign = 'right'; c.textBaseline = 'bottom';
			var stepN = hb * 10 >= 24 ? 10 : (hb * 20 >= 24 ? 20 : 50);
			for (var n = stepN; n * hb < colH - 10; n += stepN) {
				var yy = Math.round(baseline - n * hb) + 0.5;
				c.strokeStyle = 'rgba(236,220,192,0.06)'; c.beginPath(); c.moveTo(PL, yy); c.lineTo(W_ - PR, yy); c.stroke();
				c.fillStyle = 'rgba(236,226,207,0.3)'; c.fillText(String(n), W_ - PR - 2, yy - 1);
			}
		}

		// draw blocks
		var dimming = hitSet || genreFocus || authorFocus;
		cols.forEach(function (col) {
			var x0 = xOfY(col.start), x1 = xOfY(col.start + col.size);
			var cw = x1 - x0;
			var w = cw <= 3 ? Math.max(1, cw - 0.4) : Math.min(cw - 1, 14);
			var bx = x0 + (cw - w) / 2;
			var gap = hb >= 4 ? 1 : (hb >= 2.5 ? 0.5 : 0);
			col.books.forEach(function (b, i) {
				var by = baseline - (i + 1) * hb;
				var a = 1;
				if (dimming) {
					var on = (!hitSet || hitSet[b.id]) && (!genreFocus || colorKey(b) === genreFocus) && (!authorFocus || canonAuthor(b.a) === authorFocus);
					a = on ? 1 : 0.14;
				}
				c.fillStyle = bookColor(b, a);
				c.fillRect(bx, by + gap, w, hb - gap);
				blockRects.push({ x: bx, y: by, w: w, h: hb, b: b });
			});
		});

		// ---- fold mark ----
		if (deepVisible && deepX > PL && deepX < W_ - PR) {
			c.strokeStyle = 'rgba(236,220,192,0.45)'; c.lineWidth = 1;
			c.beginPath();
			var zy = colTop - 4, amp = 3, per = 9, dir = 1;
			c.moveTo(deepX, zy);
			while (zy < baseline) { zy += per / 2; dir = -dir; c.lineTo(deepX + dir * amp, zy); }
			c.lineTo(deepX, baseline);
			c.stroke();
			var dw = deepX - PL;
			c.font = font(11); c.fillStyle = 'rgba(236,226,207,0.42)'; c.textAlign = 'right'; c.textBaseline = 'top';
			var deepLabel = 'DEEP TIME · 4,000 YEARS FOLDED INTO THIS ZONE';
			if (c.measureText(deepLabel).width > dw - 16) deepLabel = 'DEEP TIME · FOLDED';
			if (c.measureText(deepLabel).width <= dw - 16) c.fillText(deepLabel, deepX - 8, colTop + 2);
		}

		// ---- author ribbons (float in the upper part of the column area) ----
		ribbonRects = [];
		if (showAuthors) {
			c.font = font(11);
			var vis = authors.filter(function (a) { return a.max >= yA && a.min <= yB; })
				.sort(function (p, q) { return q.n - p.n || (q.max - q.min) - (p.max - p.min); });
			var area = colH * 0.66, LH = 13, SH = 5;
			var labeled = [], compact = [], laneEnds = [], compactEnds = [];
			vis.forEach(function (a) {
				var x0 = xOfY(a.min), x1 = Math.max(xOfY(a.max), x0 + 2);
				var lw = c.measureText(a.name).width + 6;
				var flip = x1 + lw > W_ - PR, e0 = flip ? x0 - lw : x0, e1 = flip ? x1 : x1 + lw;
				var li = -1, i;
				for (i = 0; i < laneEnds.length; i++) if (laneEnds[i] + 10 < e0) { li = i; break; }
				if (li < 0 && (laneEnds.length + 1) * LH <= area - 40) { li = laneEnds.length; laneEnds.push(e1); }
				else if (li >= 0) laneEnds[li] = e1;
				if (li >= 0) { labeled.push({ a: a, x0: x0, x1: x1, lane: li, lw: lw, flip: flip }); return; }
				var ci = -1;
				for (i = 0; i < compactEnds.length; i++) if (compactEnds[i] + 4 < x0) { ci = i; break; }
				if (ci < 0) { ci = compactEnds.length; compactEnds.push(x1); } else compactEnds[ci] = x1;
				compact.push({ a: a, x0: x0, x1: x1, lane: ci, lw: 0 });
			});
			var ry0 = colTop + 12;
			var compactTop = ry0 + laneEnds.length * LH + 4;
			var drawRibbon = function (ln, y, lh, withLabel) {
				var a = ln.a;
				var hot = hoverRibbon === a || authorFocus === a.name;
				var dimmed = authorFocus && !hot;
				var col = hot ? 'rgba(255,210,122,0.95)' : keyColor(paint === 'lang' ? langKey(a.books[0]) : a.genre, dimmed ? 0.15 : 0.7, 40, 66);
				c.strokeStyle = col; c.fillStyle = col; c.lineWidth = hot ? 2 : 1.25;
				c.beginPath(); c.moveTo(ln.x0, y); c.lineTo(ln.x1, y); c.stroke();
				a.books.forEach(function (b) { var x = xOfY(b.y); c.fillRect(x - 1, y - 3, 2, 6); });
				if (withLabel || hot) {
					c.fillStyle = hot ? 'rgba(255,210,122,1)' : (dimmed ? 'rgba(236,226,207,0.2)' : 'rgba(236,226,207,0.7)');
					var label = a.name + (withLabel ? '' : ' · ' + a.n), tw = c.measureText(label).width;
					var flipNow = withLabel ? ln.flip : (ln.x1 + 5 + tw > W_ - PR);
					if (!flipNow) { c.textAlign = 'left'; c.fillText(label, ln.x1 + 5, y); }
					else { c.textAlign = 'right'; c.fillText(label, Math.max(PL + tw, ln.x0 - 5), y); }
					c.textAlign = 'left';
				}
				ribbonRects.push({ x: ln.x0 - 3, y: y - lh / 2, w: ln.x1 - ln.x0 + 6 + ln.lw, h: lh, a: a });
			};
			c.textAlign = 'left'; c.textBaseline = 'middle';
			labeled.forEach(function (ln) { drawRibbon(ln, ry0 + ln.lane * LH + LH / 2, LH, true); });
			compact.forEach(function (ln) { drawRibbon(ln, compactTop + ln.lane * SH + SH / 2, SH, false); });
			if (compact.length) {
				c.font = font(10); c.textAlign = 'left'; c.textBaseline = 'top';
				var moreTxt = '+ ' + compact.length + ' MORE AUTHORS WITH 2+ BOOKS · HOVER A LINE', my = compactTop + compactEnds.length * SH + 2;
				c.fillStyle = 'rgba(12,10,9,0.8)'; c.fillRect(PL + 3, my - 2, c.measureText(moreTxt).width + 6, 14);
				c.fillStyle = 'rgba(236,226,207,0.45)'; c.fillText(moreTxt, PL + 6, my);
			}
		}

		// ---- events ----
		if (showEvents) {
			var rows = [-Infinity, -Infinity];
			c.font = font(11); c.textBaseline = 'top';
			EVENTS.forEach(function (ev) {
				if (!inView(ev.y)) return;
				var x = Math.round(xOfY(ev.y)) + 0.5;
				var tw = c.measureText(ev.t.toUpperCase()).width;
				var row = -1, lx;
				for (var r = 0; r < 2 && row < 0; r++) {
					lx = x + 4; if (lx + tw > W_ - PR) lx = x - 4 - tw;
					var left = Math.min(lx, x), right = Math.max(lx + tw, x);
					if (left > rows[r] + 8) { row = r; rows[r] = right; }
				}
				c.strokeStyle = 'rgba(255,210,122,' + (row < 0 ? 0.18 : 0.36) + ')'; c.lineWidth = 1;
				c.setLineDash([2, 4]);
				c.beginPath(); c.moveTo(x, top + (row < 0 ? 26 : row * 13 + 11)); c.lineTo(x, baseline); c.stroke();
				c.setLineDash([]);
				if (row >= 0) {
					c.fillStyle = 'rgba(255,210,122,0.78)'; c.textAlign = 'left';
					c.fillText(ev.t.toUpperCase(), lx, top + row * 13);
				}
			});
		}

		// ---- selection / hover ring ----
		var ringFor = function (b, color) {
			for (var i = 0; i < blockRects.length; i++) if (blockRects[i].b === b) {
				var r = blockRects[i];
				c.strokeStyle = color; c.lineWidth = 1.5;
				c.strokeRect(r.x - 1.5, r.y - 0.5, r.w + 3, r.h + 1);
				return r;
			}
			return null;
		};
		if (hoverBlock && hoverBlock !== selected) ringFor(hoverBlock, 'rgba(236,226,207,0.8)');
		if (selected) {
			var r = ringFor(selected, '#ffd27a');
			if (r) { c.shadowColor = 'rgba(255,210,122,0.8)'; c.shadowBlur = 8; c.strokeRect(r.x - 1.5, r.y - 0.5, r.w + 3, r.h + 1); c.shadowBlur = 0; }
		}

		// ---- axis ----
		c.strokeStyle = 'rgba(236,220,192,0.35)'; c.lineWidth = 1;
		c.beginPath(); c.moveTo(PL, Math.round(baseline) + 0.5); c.lineTo(W_ - PR, Math.round(baseline) + 0.5); c.stroke();
		c.font = font(narrow ? 12 : 13); c.textBaseline = 'top'; c.fillStyle = 'rgba(236,226,207,0.72)';
		ticks.forEach(function (t) {
			var x = Math.round(xOfY(t.y)) + 0.5;
			c.strokeStyle = 'rgba(236,220,192,0.35)';
			c.beginPath(); c.moveTo(x, baseline); c.lineTo(x, baseline + 4); c.stroke();
			c.textAlign = x < PL + 24 ? 'left' : (x > W_ - PR - 24 ? 'right' : 'center');
			c.fillText(t.label, x, baseline + 6);
		});
		// in-view readout
		var nIn = dated.reduce(function (s, b) { return s + (inView(b.y) ? 1 : 0); }, 0);
		c.font = font(11); c.textAlign = 'right'; c.textBaseline = 'top'; c.fillStyle = 'rgba(236,226,207,0.42)';
		var readout = fmtYearShort(Math.round(yA)) + ' – ' + fmtYearShort(Math.min(THIS_YEAR, Math.round(yB))) + ' · ' + fmt(nIn) + ' DATED BOOKS IN VIEW';
		c.fillText(readout, W_ - PR, top - 16 + (forExport ? 0 : 0));

		// ---- undated band ----
		c.fillStyle = 'rgba(0,0,0,0.3)'; c.fillRect(PL, bandTop, W_ - PL - PR, bandH);
		c.fillStyle = hatch; c.fillRect(PL, bandTop, W_ - PL - PR, bandH);
		c.strokeStyle = 'rgba(236,220,192,0.14)'; c.beginPath(); c.moveTo(PL, Math.round(bandTop) + 0.5); c.lineTo(W_ - PR, Math.round(bandTop) + 0.5); c.stroke();
		var gutterW = narrow ? 52 : 64;
		c.fillStyle = 'rgba(12,10,9,0.85)'; c.fillRect(PL, bandTop, gutterW, bandH);
		c.strokeStyle = 'rgba(236,220,192,0.14)'; c.beginPath(); c.moveTo(PL + gutterW + 0.5, bandTop); c.lineTo(PL + gutterW + 0.5, bandTop + bandH); c.stroke();
		c.font = font(10); c.textAlign = 'left'; c.textBaseline = 'top'; c.fillStyle = 'rgba(236,226,207,0.45)';
		c.fillText('NO DATE · ' + noDate.length, PL + 5, bandTop + 3);
		c.fillText('UNDATED, ROUGH RANGE · ' + (undated.length - noDate.length), PL + gutterW + 6, bandTop + 3);
		// no-date grid
		var cell = 5, rowsN = Math.max(1, Math.floor((bandH - bandLabelH - 4) / cell));
		noDate.forEach(function (b, i) {
			var cx = PL + 5 + Math.floor(i / rowsN) * cell, cy = bandTop + bandLabelH + 2 + (i % rowsN) * cell;
			if (cx > PL + gutterW - 5) return;
			var a = dimming ? (((!hitSet || hitSet[b.id]) && (!genreFocus || colorKey(b) === genreFocus) && (!authorFocus || canonAuthor(b.a) === authorFocus)) ? 1 : 0.14) : 1;
			c.fillStyle = bookColor(b, a);
			c.fillRect(cx, cy, cell - 1, cell - 1);
			blockRects.push({ x: cx, y: cy, w: cell - 1, h: cell - 1, b: b });
		});
		// range bars
		var hu = clamp((bandH - bandLabelH - 6) / Math.max(1, rangeGroups.maxTop), 1, 3.2);
		var bandBase = bandTop + bandH - 3;
		c.save(); c.beginPath(); c.rect(PL + gutterW + 1, bandTop, W_ - PL - PR - gutterW - 1, bandH); c.clip();
		rangeGroups.forEach(function (g) {
			if (g.b < yA || g.a > yB) return;
			var x0 = xOfY(g.a), x1 = Math.max(xOfY(g.b + 1), x0 + 2);
			g.books.forEach(function (b, i) {
				var y = bandBase - (g.y0 + i + 1) * hu;
				var a = dimming ? (((!hitSet || hitSet[b.id]) && (!genreFocus || colorKey(b) === genreFocus) && (!authorFocus || canonAuthor(b.a) === authorFocus)) ? 0.9 : 0.12) : 0.9;
				c.fillStyle = bookColor(b, a);
				c.fillRect(x0, y + (hu >= 2.5 ? 0.6 : 0.3), x1 - x0 - 0.5, hu - (hu >= 2.5 ? 0.6 : 0.3));
				blockRects.push({ x: x0, y: y, w: x1 - x0, h: hu, b: b });
			});
		});
		c.restore();
		if (selected && typeof selected.y !== 'number') {
			for (var i2 = 0; i2 < blockRects.length; i2++) if (blockRects[i2].b === selected) {
				var rr = blockRects[i2];
				c.strokeStyle = '#ffd27a'; c.lineWidth = 1.5; c.strokeRect(rr.x - 1.5, rr.y - 1, rr.w + 3, rr.h + 2);
			}
		}

		// brush
		if (brush) {
			var bx0 = Math.min(brush[0], brush[1]), bx1 = Math.max(brush[0], brush[1]);
			c.fillStyle = 'rgba(255,210,122,0.12)'; c.fillRect(bx0, top, bx1 - bx0, baseline - top);
			c.strokeStyle = 'rgba(255,210,122,0.7)'; c.lineWidth = 1;
			c.beginPath(); c.moveTo(Math.round(bx0) + 0.5, top); c.lineTo(Math.round(bx0) + 0.5, baseline); c.moveTo(Math.round(bx1) + 0.5, top); c.lineTo(Math.round(bx1) + 0.5, baseline); c.stroke();
			c.font = font(12); c.fillStyle = '#ffd27a'; c.textBaseline = 'top';
			c.textAlign = 'right'; c.fillText(fmtYearShort(Math.round(yOf(uOfX(bx0)))), bx0 - 4, top + 2);
			c.textAlign = 'left'; c.fillText(fmtYearShort(Math.round(yOf(uOfX(bx1)))), bx1 + 4, top + 2);
		}

		if (forExport) {
			c.font = font(26, 600); c.textAlign = 'left'; c.textBaseline = 'top'; c.fillStyle = '#ece2cf';
			c.fillText('STRATA', PL + 2, 8);
			c.font = fontSans(13); c.fillStyle = '#ab9d86';
			c.fillText('Jack V. Le’s library by first-publication year · ' + fmt(books.length) + ' books · nietztein.github.io', PL + 92, 15);
		}

		lastLayout = { top: top, colTop: colTop, baseline: baseline, bandTop: bandTop, bandH: bandH, hb: hb, cols: cols, gutterW: gutterW };
	}

	function pickBin(px, cands) {
		for (var i = 0; i < cands.length; i++) if (px * cands[i] >= 3.2) return cands[i];
		return cands[cands.length - 1];
	}

	function computeTicks(yA, yB, W_) {
		var out = [];
		var minPx = W_ < 720 ? 46 : 58;
		// modern zone
		var pxm = pxPerYearAt(FOLD + 1);
		var steps = [1, 2, 5, 10, 20, 25, 50, 100], step = 100;
		for (var i = 0; i < steps.length; i++) if (pxm * steps[i] >= minPx) { step = steps[i]; break; }
		var m0 = Math.max(FOLD, Math.ceil(yA / step) * step);
		for (var y = m0; y <= Math.min(yB, THIS_YEAR); y += step) out.push({ y: y, label: String(y) });
		// deep zone: candidates thinned by pixel spacing
		if (yA < FOLD) {
			var cands = [-2000, -1500, -1000, -750, -500, -250, 1, 250, 500, 750, 1000, 1200, 1400, 1500, 1600, 1700, 1750];
			var lastX = PL - 100;
			cands.forEach(function (cy) {
				if (cy < yA || cy > Math.min(yB, FOLD - 1)) return;
				var x = xOfY(cy);
				if (x - lastX < Math.max(minPx, 56)) return;
				if (yB >= FOLD && xOfY(FOLD) - x < 34) return;
				lastX = x;
				out.push({ y: cy, label: cy === 1 ? 'AD 1' : fmtYearShort(cy) });
			});
		}
		return out;
	}

	// monotone cubic (as d3.curveMonotoneX) through pts; moveTo first if start
	function monoPath(c, pts, start) {
		var n = pts.length; if (!n) return;
		if (start) c.moveTo(pts[0][0], pts[0][1]); else c.lineTo(pts[0][0], pts[0][1]);
		if (n < 2) return;
		var m = new Array(n);
		function sign(v) { return v < 0 ? -1 : 1; }
		for (var i = 1; i < n - 1; i++) {
			var h0 = pts[i][0] - pts[i - 1][0], h1 = pts[i + 1][0] - pts[i][0];
			var s0 = (pts[i][1] - pts[i - 1][1]) / (h0 || 1e-9), s1 = (pts[i + 1][1] - pts[i][1]) / (h1 || 1e-9);
			var p = (s0 * h1 + s1 * h0) / (h0 + h1 || 1e-9);
			m[i] = (sign(s0) + sign(s1)) * Math.min(Math.abs(s0), Math.abs(s1), 0.5 * Math.abs(p)) || 0;
		}
		function slope2(i0, i1, t) { var h = pts[i1][0] - pts[i0][0]; return h ? (3 * (pts[i1][1] - pts[i0][1]) / h - t) / 2 : t; }
		m[0] = slope2(0, 1, m[1] || 0);
		m[n - 1] = slope2(n - 2, n - 1, m[n - 2] || 0);
		for (var j = 0; j < n - 1; j++) {
			var x0 = pts[j][0], y0 = pts[j][1], x1 = pts[j + 1][0], y1 = pts[j + 1][1], dx = (x1 - x0) / 3;
			c.bezierCurveTo(x0 + dx, y0 + dx * m[j], x1 - dx, y1 - dx * m[j + 1], x1, y1);
		}
	}

	// ---- Hit testing + tooltip ------------------------------------------------
	function blockAt(x, y) {
		var best = null, bd = 1e9;
		for (var i = blockRects.length - 1; i >= 0; i--) {
			var r = blockRects[i];
			var pad = r.w < 4 || r.h < 4 ? 1.5 : 0;
			if (x >= r.x - pad && x <= r.x + r.w + pad && y >= r.y - pad && y <= r.y + r.h + pad) {
				var d = Math.abs(x - r.x - r.w / 2) + Math.abs(y - r.y - r.h / 2);
				if (d < bd) { bd = d; best = r.b; }
			}
		}
		return best;
	}
	function ribbonAt(x, y) {
		for (var i = 0; i < ribbonRects.length; i++) {
			var r = ribbonRects[i];
			if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return r.a;
		}
		return null;
	}
	function streamAt(x, y) {
		if (!streamShapes || !lastLayout) return null;
		if (y < lastLayout.colTop || y > lastLayout.baseline) return null;
		var xs = streamShapes.xs, st = streamShapes.st, sy = streamShapes.sy;
		var j = -1, bd = 1e9;
		for (var i = 0; i < xs.length; i++) { var d = Math.abs(xs[i] - x); if (d < bd) { bd = d; j = i; } }
		if (j < 0) return null;
		var bn = st.bins[j];
		if (bd > Math.max(6, (xOfY(bn.b) - xOfY(bn.a)) / 2)) return null;
		for (var k = 0; k < st.series.length; k++) {
			var sr = st.series[k][j];
			if (sr[1] - sr[0] <= 0) continue;
			if (y >= sy(sr[0]) && y <= sy(sr[1])) return { key: st.keys[k], bin: bn, n: sr[1] - sr[0], total: st.totals[j] };
		}
		return null;
	}
	function showTip(html, x, y) {
		tip.innerHTML = html;
		tip.classList.add('show');
		var tw = tip.offsetWidth, th = tip.offsetHeight;
		var left = x + 14, topY = y - th - 12;
		if (left + tw > W - 6) left = x - tw - 14;
		if (left < 6) left = 6;
		if (topY < 6) topY = y + 16;
		if (topY + th > H - 6) topY = H - th - 6;
		tip.style.left = left + 'px'; tip.style.top = topY + 'px';
	}
	function hideTip() { tip.classList.remove('show'); }
	function bookTipHtml(b) {
		var yr = typeof b.y === 'number' ? fmtYear(b.y) : (b.yr ? 'undated · ' + b.yr : 'undated');
		return '<div class="t">' + escapeHtml(b.t) + '</div>' +
			'<div class="m">' + escapeHtml(b.a || '—') + '</div>' +
			'<div class="y">' + escapeHtml(yr) + (typeof b.y === 'number' && b.yr && b.yr !== String(b.y) ? ' <span style="color:var(--ink-3);font-size:12px">' + escapeHtml(b.yr) + '</span>' : '') + '</div>' +
			'<div class="m"><i class="sw" style="background:' + bookColor(b, 1) + '"></i>' + escapeHtml(b.g) + ' · ' + escapeHtml(shelfText(b)) + '</div>';
	}
	function pinTipToSelected() {
		if (!selected) return;
		for (var i = 0; i < blockRects.length; i++) if (blockRects[i].b === selected) {
			var r = blockRects[i];
			showTip(bookTipHtml(selected), r.x + r.w / 2, r.y);
			return;
		}
		hideTip();
	}

	// ---- Card ----------------------------------------------------------------
	function openCard(b) {
		$('#card-spine').style.background = bookColor(b, 1);
		var yEl = $('#card-year');
		if (typeof b.y === 'number') yEl.innerHTML = escapeHtml(fmtYear(b.y)) + (b.yr && b.yr !== String(b.y) ? '<small>' + escapeHtml(b.yr) + '</small>' : '');
		else yEl.innerHTML = 'undated' + (b.yr ? '<small>' + escapeHtml(b.yr) + '</small>' : '');
		$('#card-title').textContent = b.t;
		$('#card-by').textContent = [b.a, b.pub].filter(Boolean).join(' · ');
		var meta = [['genre', b.g], ['type', b.ty], ['language', b.l], ['shelf', shelfText(b) + ' · #' + b.p]];
		$('#card-meta').innerHTML = meta.filter(function (m) { return m[1]; }).map(function (m) { return '<span>' + m[0] + ' <b>' + escapeHtml(m[1]) + '</b></span>'; }).join('');
		$('#card-desc').textContent = b.d || '';
		var links = '<a class="main" href="../../#/bookshelf/' + encodeURIComponent(b.id) + '">Open on the Bookshelf &rarr;</a>';
		if (b.free && b.free.url) links += '<a class="free" href="' + escapeHtml(b.free.url) + '" target="_blank" rel="noopener">free e-text (' + escapeHtml(b.free.src) + ')</a>';
		$('#card-links').innerHTML = links;
		$('#card-loc').textContent = b.id;
		card.classList.add('show'); shade.classList.add('show');
		$('#card-close').focus();
	}
	function closeCard() { card.classList.remove('show'); shade.classList.remove('show'); canvas.focus({ preventScroll: true }); }
	$('#card-close').addEventListener('click', closeCard);
	shade.addEventListener('click', closeCard);

	function selectBook(b, pin) {
		selected = b; pinned = !!pin;
		draw();
		if (pinned) pinTipToSelected();
	}

	// ---- Pointer -------------------------------------------------------------
	function pos(e) { var r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
	canvas.addEventListener('pointerdown', function (e) {
		if (e.button !== 0) return;
		var p = pos(e);
		drag = { x0: p.x, y0: p.y, brushing: false, id: e.pointerId };
		try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
	});
	canvas.addEventListener('pointermove', function (e) {
		var p = pos(e);
		if (drag) {
			if (!drag.brushing && Math.abs(p.x - drag.x0) > 6) { drag.brushing = true; pinned = false; hideTip(); }
			if (drag.brushing) { brush = [drag.x0, p.x]; draw(); return; }
		}
		var b = blockAt(p.x, p.y), rb = b ? null : ribbonAt(p.x, p.y);
		hoverRibbon = rb;
		if (b !== hoverBlock || rb) { hoverBlock = b; draw(); }
		canvas.style.cursor = b || rb ? 'pointer' : 'crosshair';
		if (b) { showTip(bookTipHtml(b), p.x, p.y); return; }
		if (rb) {
			showTip('<div class="t">' + escapeHtml(rb.name) + '</div><div class="y">' + fmtYearShort(rb.min) + ' – ' + fmtYearShort(rb.max) + '</div><div class="m">' + rb.n + ' books · click to isolate</div>', p.x, p.y);
			return;
		}
		var s = streamAt(p.x, p.y);
		if (s) {
			var bl = s.bin.a < FOLD ? (fmtYearShort(s.bin.a) + ' – ' + fmtYearShort(s.bin.b - 1)) : (s.bin.a + 's');
			showTip('<div class="t" style="font-family:var(--cond);font-weight:500;font-size:15px"><i class="sw" style="background:' + keyColor(s.key, 1) + '"></i>' + escapeHtml(keyName(s.key)) + '</div><div class="y">' + bl + '</div><div class="m">' + s.n + ' of ' + s.total + ' books first published then</div>', p.x, p.y);
			return;
		}
		if (pinned && selected) pinTipToSelected(); else hideTip();
	});
	function endDrag(e) {
		if (!drag) return;
		var p = pos(e), d = drag; drag = null;
		if (d.brushing) {
			brush = null;
			var ua = uOfX(Math.min(d.x0, p.x)), ub = uOfX(Math.max(d.x0, p.x));
			animateView(ua, ub);
			return;
		}
		// click
		var b = blockAt(p.x, p.y);
		if (b) { selectBook(b, false); openCard(b); return; }
		var rb = ribbonAt(p.x, p.y);
		if (rb) { authorFocus = authorFocus === rb.name ? null : rb.name; draw(); return; }
		if (selected) { selected = null; pinned = false; hideTip(); draw(); }
	}
	canvas.addEventListener('pointerup', endDrag);
	canvas.addEventListener('pointercancel', function () { drag = null; brush = null; draw(); });
	canvas.addEventListener('pointerleave', function () { if (!drag) { hoverBlock = null; hoverRibbon = null; if (pinned && selected) pinTipToSelected(); else hideTip(); draw(); } });
	canvas.addEventListener('dblclick', function () { animateView(0, 1); });
	canvas.addEventListener('wheel', function (e) {
		e.preventDefault();
		var p = pos(e);
		var span = view.u1 - view.u0;
		if (e.shiftKey || (Math.abs(e.deltaX) > Math.abs(e.deltaY))) {
			var dxu = (e.deltaX || e.deltaY) / (W - PL - PR) * span;
			setView(view.u0 + dxu, view.u1 + dxu);
			return;
		}
		var f = Math.exp(e.deltaY * 0.0016);
		var uc = uOfX(p.x);
		var u0 = uc - (uc - view.u0) * f, u1 = uc + (view.u1 - uc) * f;
		if (u1 - u0 > 1) { u0 = 0; u1 = 1; }
		setView(u0, u1);
	}, { passive: false });

	// ---- Keyboard ------------------------------------------------------------
	function stepYear(dir) {
		if (!selected || typeof selected.y !== 'number') {
			var c0 = dir > 0 ? yearCols[0] : yearCols[yearCols.length - 1];
			selectBook(c0.books[0], true); flyToYear(c0.y); return;
		}
		var i = yearIndex[selected.y] + dir;
		if (i < 0 || i >= yearCols.length) return;
		var col = yearCols[i];
		var b = col.books[Math.min(selected._yi, col.books.length - 1)];
		selectBook(b, true);
		flyToYear(col.y);
	}
	function stepStack(dir) {
		if (!selected || typeof selected.y !== 'number') { stepYear(1); return; }
		var col = yearCols[yearIndex[selected.y]];
		var j = selected._yi + dir;
		if (j < 0 || j >= col.books.length) return;
		selectBook(col.books[j], true);
	}
	document.addEventListener('keydown', function (e) {
		var inInput = e.target === searchEl;
		if (e.key === 'Escape') {
			if (help.classList.contains('show')) { help.classList.remove('show'); return; }
			if (card.classList.contains('show')) { closeCard(); return; }
			if (inInput && searchEl.value) { searchEl.value = ''; runSearch(''); return; }
			if (selected) { selected = null; pinned = false; hideTip(); draw(); }
			return;
		}
		if (inInput) {
			if (e.key === 'Enter') { e.preventDefault(); gotoHit(e.shiftKey ? -1 : 1); }
			if (e.key === 'ArrowDown') { e.preventDefault(); gotoHit(1); }
			if (e.key === 'ArrowUp') { e.preventDefault(); gotoHit(-1); }
			return;
		}
		if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
		if (card.classList.contains('show')) return;
		switch (e.key) {
			case 'ArrowLeft': e.preventDefault(); stepYear(-1); break;
			case 'ArrowRight': e.preventDefault(); stepYear(1); break;
			case 'ArrowUp': e.preventDefault(); stepStack(1); break;
			case 'ArrowDown': e.preventDefault(); stepStack(-1); break;
			case 'Enter': if (selected) openCard(selected); break;
			case '/': e.preventDefault(); searchEl.focus(); searchEl.select(); break;
			case 'e': case 'E': toggleEvents(); break;
			case 'a': case 'A': toggleAuthors(); break;
			case 'p': case 'P': exportPng(); break;
			case '?': help.classList.toggle('show'); break;
			case '0': animateView(0, 1); break;
		}
	});
	// make the canvas focusable so keys work after a click
	canvas.tabIndex = 0;

	// ---- Search --------------------------------------------------------------
	function runSearch(q) {
		var nq = norm(q.trim());
		hits = []; hitSet = null; hitIndex = -1;
		if (nq) {
			hits = books.filter(function (b) { return b._q.indexOf(nq) >= 0; });
			hits.sort(function (a, b) {
				var da = typeof a.y === 'number', db = typeof b.y === 'number';
				if (da !== db) return da ? -1 : 1;
				return da ? a.y - b.y : cmpTitle(a, b);
			});
			hitSet = {}; hits.forEach(function (b) { hitSet[b.id] = true; });
		}
		if (hits.length) { hitIndex = 0; focusHit(); }
		else { if (nq) { selected = null; pinned = false; hideTip(); } draw(); }
		hitsEl.innerHTML = nq ? (hits.length ? '<b>' + (hitIndex + 1) + '</b> / ' + hits.length : 'no match') : '';
	}
	function focusHit() {
		var b = hits[hitIndex];
		if (!b) return;
		selectBook(b, true);
		if (typeof b.y === 'number') flyToYear(b.y);
		hitsEl.innerHTML = '<b>' + (hitIndex + 1) + '</b> / ' + hits.length;
	}
	function gotoHit(dir) {
		if (!hits.length) return;
		hitIndex = (hitIndex + dir + hits.length) % hits.length;
		focusHit();
	}
	var searchTimer = null;
	searchEl.addEventListener('input', function () {
		clearTimeout(searchTimer);
		searchTimer = setTimeout(function () { runSearch(searchEl.value); }, 120);
	});
	$('#btn-next').addEventListener('click', function () { gotoHit(1); });
	$('#btn-prev').addEventListener('click', function () { gotoHit(-1); });

	// ---- Controls ------------------------------------------------------------
	function segHandler(sel, attr, fn) {
		var seg = $(sel);
		seg.addEventListener('click', function (e) {
			var btn = e.target.closest('button'); if (!btn) return;
			var v = btn.getAttribute(attr);
			Array.prototype.forEach.call(seg.querySelectorAll('button'), function (b) { b.classList.toggle('on', b === btn); });
			fn(v);
		});
	}
	segHandler('#layers', 'data-l', function (v) { layers = v; draw(); if (pinned) pinTipToSelected(); });
	segHandler('#paint', 'data-p', function (v) { paint = v; genreFocus = null; renderLegend(); draw(); });
	segHandler('#zooms', 'data-z', function (v) { animateView(v === 'all' ? 0 : uOf(+v), 1); });
	function toggleEvents() { showEvents = !showEvents; $('#btn-events').classList.toggle('on', showEvents); draw(); if (pinned) pinTipToSelected(); }
	function toggleAuthors() { showAuthors = !showAuthors; if (!showAuthors) authorFocus = null; $('#btn-authors').classList.toggle('on', showAuthors); draw(); if (pinned) pinTipToSelected(); }
	$('#btn-events').addEventListener('click', toggleEvents);
	$('#btn-authors').addEventListener('click', toggleAuthors);
	$('#btn-help').addEventListener('click', function () { help.classList.toggle('show'); });
	$('#help-close').addEventListener('click', function () { help.classList.remove('show'); });
	help.addEventListener('click', function (e) { if (e.target === help) help.classList.remove('show'); });
	$('#btn-png').addEventListener('click', exportPng);

	function exportPng() {
		var s = 2, off = document.createElement('canvas');
		var exW = Math.max(W, 1100), exH = H + 28;
		off.width = exW * s; off.height = exH * s;
		var c = off.getContext('2d');
		var savedW = W, savedH = H, savedHatch = hatch;
		W = exW; H = exH; hatch = null;
		try { render(c, exW, exH, s, true); } finally { W = savedW; H = savedH; hatch = savedHatch; }
		var a = document.createElement('a');
		a.download = 'strata-' + new Date().toISOString().slice(0, 10) + '.png';
		if (off.toBlob) {
			off.toBlob(function (blob) { if (!blob) return; a.href = URL.createObjectURL(blob); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000); }, 'image/png');
		} else { a.href = off.toDataURL('image/png'); a.click(); }
		draw();
	}

	// ---- URL state (also handy for testing) ----------------------------------
	function setSeg(sel, attr, v) {
		Array.prototype.forEach.call(document.querySelectorAll(sel + ' button'), function (b) { b.classList.toggle('on', b.getAttribute(attr) === v); });
	}
	function applyParams() {
		var l = params.get('layers'), pnt = params.get('paint'), z = params.get('zoom'), q = params.get('q');
		if (THUMB) { hint.style.display = 'none'; l = 'both'; z = z || '1800'; showEvents = true; }
		if (l === 'blocks' || l === 'streams' || l === 'both') { layers = l; setSeg('#layers', 'data-l', l); }
		if (pnt === 'lang' || pnt === 'genre') { paint = pnt; setSeg('#paint', 'data-p', pnt); renderLegend(); }
		if (params.get('events') === '0') { showEvents = false; }
		if (params.get('authors') === '1') { showAuthors = true; }
		$('#btn-events').classList.toggle('on', showEvents);
		$('#btn-authors').classList.toggle('on', showAuthors);
		if (z) {
			var m = z.match(/^(-?\d+)(?:-(-?\d+))?$/);
			if (m) { view.u0 = uOf(+m[1]); view.u1 = m[2] ? uOf(+m[2] + 1) : 1; if (view.u1 <= view.u0) { view.u0 = 0; view.u1 = 1; } }
		}
		syncZoomButtons();
		if (q) { searchEl.value = q; }
	}

	// ---- Boot ----------------------------------------------------------------
	function fail(text) { msg.textContent = text; msg.classList.add('show'); }

	function boot(data) {
		var list = (data && data.books) || [];
		if (!list.length) { fail('The catalogue loaded but had no books in it.'); return; }
		prepare(list);
		renderEra();
		renderLegend();
		applyParams();
		resize();
		if (THUMB) {
			var star = byId['K-AtoD-01'] || dated.filter(function (b) { return /^1984$/.test(b.t); })[0] || dated[0];
			selectBook(star, true);
		} else if (searchEl.value) runSearch(searchEl.value);
		if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { draw(); if (pinned) pinTipToSelected(); });
	}

	window.addEventListener('resize', function () { resize(); if (pinned) pinTipToSelected(); });

	fetch(DATA_URL).then(function (r) {
		if (!r.ok) throw new Error('HTTP ' + r.status);
		return r.json();
	}).then(boot).catch(function (err) {
		fail('Could not load the library catalogue (' + err.message + '). This page reads ../../assets/data/library.json from the site; open it from nietztein.github.io.');
	});
})();
