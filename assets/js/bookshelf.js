// Bookshelf: every catalogued book in the house, drawn as spines.
//
// Data comes from assets/data/library.json (built by scripts/build-library-json.ps1).
// Three views share one set of spine elements:
//   shelves  the real layout, bookcase by bookcase, shelf by shelf; in Rearrange
//            mode the spines can be dragged between slots and shelves, shuffled,
//            and reset (the visitor's arrangement lives in localStorage)
//   wall     every spine reshelved by genre, language, era, author or title
//            (spines fly to their new slot with a FLIP animation)
//   stats    headline numbers and a few small charts
// Search supports field filters (author:, genre:, year:, is:free ...) and shows a
// ranked dropdown. Spines can be coloured by genre, language or era and the
// colours morph between modes. Clicking a spine opens a card; #/bookshelf/<id>
// deep-links to one and ?view=&sort=&q=&genre=&lang=&paint= carry the state.
//
// main.js calls window.Bookshelf.show(rest) whenever the #/bookshelf route is
// applied. Everything renders lazily on the first call.

(function () {
	'use strict';

	var DATA_URL = 'assets/data/library.json';
	var STORE_ARRANGEMENT = 'bookshelf.arrangement.v1';
	var STORE_ZOOM = 'bookshelf.zoom';

	// ---- Physical layout ----------------------------------------------------

	// Order of presentation and a short description of each bookcase (shown in
	// the wall view only). Shelf keys match the Shelf column of the catalog; an
	// object merges several keys into one row.
	var UNITS = [
		{
			k: 'K', name: 'Pine library',
			desc: 'Three pine folding bookcases. Alphabetical by title, with every "The" filed after S, the fifty-one Harvard Classics stacked beneath, and two shelves of Japanese books to the side.',
			shelves: ['A to D', 'D to I', 'H to L', 'M to O', 'O to S', 'S / The A-E', 'The F-O', 'The P-T', 'T-W',
				'HC 1-16', 'HC 17-34', 'HC 35-51', 'JP-1 (Jump, Mill)', 'JP-2 (Ranpo, Witchcraft)', 'Top (VN boxes)'],
		},
		{ k: 'H', name: 'Black bookcase', desc: 'Six shelves: the canon read for school, a writing-craft and screenwriting library, dictionaries, and old test prep.', shelves: ['H1', 'H2', 'H3', 'H4', 'H5', 'H6'] },
		{ k: 'N', name: 'Manga case', desc: 'The manga library: 1970s and 80s shōjo and seinen in bunko, seinen runs, visual novels and CDs, plus an Italian shelf.', shelves: ['N-Top (VN boxes, CDs)', 'N1 (Uffizi)', 'N2 (Berlitz, Catan)', 'N3 (鈴木由美子)', 'N4 (バガボンド, くず)', 'N5 (手塚, 吉田秋生)'] },
		{ k: 'B', name: 'Cherry bookcase', desc: 'Dark cherry shelves with library call-number labels. Almost entirely English humanities.', shelves: ['B1', 'B2', 'B3'] },
		{ k: 'G', name: 'Library-label shelves', desc: 'Overflow shelves in the same dark cherry, with a nursing stack at one end.', shelves: ['G1', 'G2'] },
		{ k: 'I', name: 'Cream bookcase', desc: 'English fiction and philosophy, with a visual-novel and illustration corner.', shelves: ['I1', 'I2'] },
		{ k: 'L', name: 'Nursing case', desc: 'Drug guides, pathophysiology and review modules, with a Japanese manga shelf on top.', shelves: ['L0 (above sticky 16)', 'L1 (sticky 16)'] },
		{ k: 'M', name: 'Japanese literature shelf', desc: 'Sōseki, Dazai, Mishima, Akutagawa and Murakami in the original, mostly bunko.', shelves: ['JP floor shelf'] },
		{ k: 'A', name: 'Light-wood unit', desc: 'Two mixed shelves by the calligraphy wall.', shelves: ['A1', 'A2'] },
		{ k: 'D', name: 'Wire shelf', desc: 'Japanese bunko and test prep.', shelves: ['D1', 'D2'] },
		{ k: 'F', name: 'Headset shelf', desc: 'Manga and art catalogues, next to the VR headset.', shelves: ['F1'] },
		{ k: 'J', name: 'Cubby', desc: 'A box of self-help paperbacks.', shelves: ['Cubby'] },
		{ k: 'Loose', name: 'Desk and floor', desc: 'Whatever was out being read when the photos were taken.', shelves: [{ keys: ['Floor', 'Held (photo 73)', 'Held (photo 96)'], label: 'Loose' }] },
	];

	var GENRE_HUE = {
		'Literature (English & European)': 214,
		'Japanese literature': 354,
		'Manga & comics': 322,
		'Light novels': 282,
		'Writing, film & literary craft': 28,
		'History & biography': 14,
		'Philosophy & political theory': 248,
		'Religion & theology': 42,
		'Society, culture & ideas': 186,
		'Politics, law & current affairs': 168,
		'Psychology, self-help & business': 142,
		'Art & visual culture': 76,
		'Music & opera': 266,
		'Language study & reference': 104,
		'Test prep & study guides': 56,
		'Math, CS & engineering': 200,
		'Science': 178,
		'Nursing & medical': 6,
		'Magazines & catalogues': 90,
		'Occult & folklore': 300,
		'Games & other objects': 0,
		'Unidentified': 0,
	};
	var LANG_HUE = { English: 214, Japanese: 354, 'Bilingual & other': 42 };

	var LANG_NAME = { EN: 'English', JA: 'Japanese', DE: 'German', IT: 'Italian', LA: 'Latin', VI: 'Vietnamese' };

	var AUTHOR_ALIAS = {
		'村上春樹': 'Haruki Murakami',
		'三島由紀夫': 'Yukio Mishima', 'Mishima Yukio': 'Yukio Mishima',
		'太宰治': 'Osamu Dazai', 'Dazai Osamu': 'Osamu Dazai',
		'夏目漱石': 'Natsume Sōseki',
		'芥川龍之介': 'Ryūnosuke Akutagawa',
		'ed. Charles W. Eliot': 'Charles W. Eliot (ed.)',
		'井浦秀夫 / 監修 小林茂和': '井浦秀夫',
		'渡航 ほか': '渡航',
	};

	var FREE_SOURCE = { gutenberg: 'Project Gutenberg', aozora: 'Aozora Bunko' };

	// ---- State ---------------------------------------------------------------

	var books = [];
	var byId = {};
	var counts = {};
	var loaded = false;
	var loading = null;
	var rendered = false;

	var view = ''; // shelves | wall | stats (empty until the first render)
	var sort = 'genre';
	var paint = 'genre'; // genre | language | era
	var query = '';
	var parsed = { terms: [], filters: [] };
	var genreFilter = null;
	var langFilter = null;
	var freeFilter = false;
	var zoom = 1;
	var rearranging = false;
	var arrangement = {}; // "unit|shelf" -> [ids]
	var pendingId = '';

	var reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

	var root, toolbar, ctxRow, strip, stripSvg, shelfArea, statsArea, tip, card, cardBody, countEl, legendEl;
	var searchInput, resultsEl;
	var cardOpenFor = null;
	var lastFocus = null;
	var order = [];
	var observer = null;

	function $(sel, r) { return (r || document).querySelector(sel); }
	function $$(sel, r) { return Array.prototype.slice.call((r || document).querySelectorAll(sel)); }
	function el(tag, cls, text) {
		var n = document.createElement(tag);
		if (cls) n.className = cls;
		if (text != null) n.textContent = text;
		return n;
	}
	function hash(s) {
		var h = 2166136261;
		for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
		return h >>> 0;
	}
	function ordinal(n) {
		var s = ['th', 'st', 'nd', 'rd'], v = n % 100;
		return n + (s[(v - 20) % 10] || s[v] || s[0]);
	}
	function fmt(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
	function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
	function langName(code) {
		if (!code || code === '?') return 'Unknown language';
		return code.split('/').map(function (c) { return LANG_NAME[c] || c; }).join(' / ');
	}
	function langBucket(code) {
		if (code === 'JA') return 'Japanese';
		if (/^EN(\/|$)/.test(code) && code !== 'EN/JA') return 'English';
		return 'Bilingual & other';
	}
	function authorKey(a) { return a ? (AUTHOR_ALIAS[a] || a) : ''; }
	function isJapaneseText(s) { return /[぀-ヿ一-鿿]/.test(s); }
	function store(key, val) {
		try {
			if (val == null) localStorage.removeItem(key);
			else localStorage.setItem(key, JSON.stringify(val));
		} catch (e) { /* private mode */ }
	}
	function load(key) {
		try { var v = localStorage.getItem(key); return v ? JSON.parse(v) : null; } catch (e) { return null; }
	}

	// Search normalisation: strip accents, fold katakana to hiragana and
	// full-width ASCII to ASCII, lower-case.
	function norm(s) {
		return String(s || '')
			.normalize('NFD').replace(/[̀-ͯ]/g, '')
			.toLowerCase()
			.replace(/[ァ-ヶ]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0x60); })
			.replace(/[！-～]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xfee0); });
	}

	// ---- Spine geometry + colour --------------------------------------------

	function decorate(b) {
		var t = b.ty || '', pub = b.pub || '';
		var h = hash(b.id);
		var bunko = /文庫/.test(pub) || t === 'Light novel';
		var manga = t === 'Manga' || t === 'Comics';
		var box = t === 'Media' || t === 'Games' || t === 'Game';
		var thin = t === 'Magazine' || t === 'Calendar' || t === 'Math journal';
		var tall = /^(Art|Textbook|Reference|Anthology|Technical|Nursing & medical|Test prep|Documents|Picture book|Other)$/.test(t);
		var hc = /Harvard Classics/.test(pub);

		var height, width;
		if (hc) { height = 108; width = 15; }
		else if (manga) { height = 84 + (h % 2) * 4; width = 12 + (h % 3); }
		else if (bunko) { height = 82; width = 12 + ((h >> 2) % 3); }
		else if (box) { height = 118; width = 28 + (h % 8); }
		else if (thin) { height = 116; width = 8 + (h % 3); }
		else if (tall) { height = 116 + (h % 3) * 4; width = 18 + (h % 12); }
		else { height = 98 + (h % 4) * 4; width = 14 + ((h >> 3) % 8); }

		b.w = width;
		b.hgt = height;
		b.seed = hash(b.a || b.pub || b.t);
		b.band = (h >> 5) % 4;
		b.ou = b.u; b.os = b.s; b.op = b.p; // catalog positions, for Reset
		b.nt = norm(b.t); b.na = norm(b.a); b.np = norm(b.pub); b.nd = norm(b.d); b.ng = norm(b.g);
		b.lb = langBucket(b.l);
		b.free = b.free || null;
	}

	function colorFor(b, mode) {
		var seed = b.seed, hue, sat, lig;
		if (mode === 'language') {
			hue = LANG_HUE[b.lb];
			sat = 36 + (seed % 24); lig = 30 + ((seed >> 4) % 24);
		} else if (mode === 'era') {
			hue = 214;
			if (b.y == null) { sat = 4; lig = 44; }
			else { sat = 42; lig = Math.round(24 + 32 * clamp((b.y - 1800) / 225, 0, 1)); }
			return { h: hue, s: sat, l: lig };
		} else {
			hue = GENRE_HUE[b.g]; if (hue == null) hue = 0;
			sat = 34 + (seed % 26); lig = 30 + ((seed >> 4) % 26);
			if (b.g === 'Games & other objects' || b.g === 'Unidentified') { sat = 6; lig = 40 + (seed % 14); }
		}
		return { h: (hue + ((seed % 17) - 8) + 360) % 360, s: sat, l: lig };
	}

	function applyColor(b) {
		var c = colorFor(b, paint);
		b.ch = c.h; b.cs = c.s; b.cl = c.l;
		b.color = 'hsl(' + c.h + ' ' + c.s + '% ' + c.l + '%)';
		b.el.style.setProperty('--sh', c.h);
		b.el.style.setProperty('--ss', c.s + '%');
		b.el.style.setProperty('--sl', c.l + '%');
		if (b.strip) b.strip.setAttribute('fill', b.color);
	}

	function makeSpine(b) {
		var s = el('button', 'bk' + (b.band ? ' bk-band-' + b.band : '') + (b.free ? ' bk-free' : ''));
		s.type = 'button';
		s.style.setProperty('--w', b.w + 'px');
		s.style.setProperty('--h', b.hgt + 'px');
		s.setAttribute('data-id', b.id);
		s.setAttribute('aria-label', b.t + (b.a ? ', ' + b.a : ''));
		var label = el('span', 'bk-t', b.t);
		if (isJapaneseText(b.t)) label.lang = 'ja';
		s.appendChild(label);
		b.el = s;
		applyColor(b);
		return s;
	}

	// ---- Arrangement (visitor's own rearranging) ------------------------------

	function shelfKey(u, s) { return u + '|' + s; }

	function applyArrangement() {
		books.forEach(function (b) { b.u = b.ou; b.s = b.os; b.p = b.op; });
		Object.keys(arrangement).forEach(function (key) {
			var parts = key.split('|');
			arrangement[key].forEach(function (id, i) {
				var b = byId[id];
				if (b) { b.u = parts[0]; b.s = parts[1]; b.p = i + 1; }
			});
		});
	}

	function hasArrangement() { return Object.keys(arrangement).length > 0; }

	function renumberRow(row) {
		var u = row.getAttribute('data-unit'), s = row.getAttribute('data-shelf');
		var ids = [];
		$$('.bk', row).forEach(function (e, i) {
			var b = byId[e.getAttribute('data-id')];
			b.u = u; b.s = s; b.p = i + 1;
			ids.push(b.id);
		});
		arrangement[shelfKey(u, s)] = ids;
	}

	function saveArrangement() {
		store(STORE_ARRANGEMENT, hasArrangement() ? arrangement : null);
		refreshCounts();
		rebuildOrder();
		updateContextRow();
	}

	function refreshCounts() {
		$$('.bs-unit', shelfArea).forEach(function (u) {
			var n = $$('.bk', u).length;
			var c = $('.bs-unit-count', u);
			if (c) c.textContent = fmt(n) + (n === 1 ? ' book' : ' books');
		});
	}

	function rebuildOrder() {
		order = $$('.bk', shelfArea).map(function (e) { return byId[e.getAttribute('data-id')]; });
		updateStrip();
	}

	function shuffleShelves() {
		if (view !== 'shelves') setView('shelves');
		var rows = $$('.bs-row', shelfArea);
		var pool = [], sizes = [];
		rows.forEach(function (r) {
			var slots = $$('.bk-slot', r);
			sizes.push(slots.length);
			slots.forEach(function (sl) { pool.push(sl); });
		});
		for (var i = pool.length - 1; i > 0; i--) {
			var j = Math.floor(Math.random() * (i + 1));
			var t = pool[i]; pool[i] = pool[j]; pool[j] = t;
		}
		// Every shelf keeps its size; each slot is appended exactly once, so the
		// final order within a shelf follows the shuffled pool.
		flip(function () {
			var k = 0;
			rows.forEach(function (r, ri) {
				for (var i = 0; i < sizes[ri]; i++) r.appendChild(pool[k++]);
			});
			rows.forEach(renumberRow);
		});
		saveArrangement();
	}

	function resetShelves() {
		arrangement = {};
		applyArrangement();
		store(STORE_ARRANGEMENT, null);
		if (view !== 'shelves') setView('shelves');
		else renderShelves(true);
		updateContextRow();
	}

	function downloadLayout() {
		var snapshot = {};
		$$('.bs-row', shelfArea).forEach(function (r) {
			snapshot[shelfKey(r.getAttribute('data-unit'), r.getAttribute('data-shelf'))] =
				$$('.bk', r).map(function (e) { return e.getAttribute('data-id'); });
		});
		var blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
		var a = document.createElement('a');
		a.href = URL.createObjectURL(blob);
		a.download = 'arrangement.json';
		document.body.appendChild(a);
		a.click();
		setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
	}

	// ---- Drag and drop ---------------------------------------------------------

	var drag = null;
	var suppressClick = false;

	function onPointerDown(ev) {
		if (!rearranging || view !== 'shelves') return;
		if (ev.button != null && ev.button !== 0) return;
		var s = ev.target.closest ? ev.target.closest('.bk') : null;
		if (!s) return;
		drag = { el: s, slot: s.parentNode, id: ev.pointerId, x0: ev.clientX, y0: ev.clientY, active: false, ghost: null, fromRow: s.closest('.bs-row') };
		try { s.setPointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
	}

	function startDrag(ev) {
		var r = drag.el.getBoundingClientRect();
		var g = drag.el.cloneNode(true);
		g.className = drag.el.className + ' bk-ghost';
		g.style.width = r.width + 'px';
		g.style.height = r.height + 'px';
		g.style.left = r.left + 'px';
		g.style.top = r.top + 'px';
		document.body.appendChild(g);
		drag.ghost = g;
		drag.dx = ev.clientX - r.left;
		drag.dy = ev.clientY - r.top;
		drag.active = true;
		drag.el.classList.add('is-drag-src');
		root.classList.add('is-dragging');
		hideTip();
		drag.scroll = setInterval(function () {
			if (!drag) return;
			var y = drag.lastY || 0;
			if (y < 70) window.scrollBy(0, -12);
			else if (y > window.innerHeight - 70) window.scrollBy(0, 12);
		}, 16);
	}

	function onPointerMove(ev) {
		if (!drag || ev.pointerId !== drag.id) return;
		if (!drag.active) {
			if (Math.hypot(ev.clientX - drag.x0, ev.clientY - drag.y0) < 6) return;
			startDrag(ev);
		}
		ev.preventDefault();
		drag.lastY = ev.clientY;
		var x = ev.clientX - drag.dx, y = ev.clientY - drag.dy;
		drag.ghost.style.transform = 'translate(' + (x - parseFloat(drag.ghost.style.left)) + 'px,' + (y - parseFloat(drag.ghost.style.top)) + 'px) rotate(-4deg) scale(1.06)';

		var under = document.elementFromPoint(ev.clientX, ev.clientY);
		if (!under) return;
		var slot = under.closest ? under.closest('.bk-slot') : null;
		if (slot && slot !== drag.slot) {
			var rr = slot.getBoundingClientRect();
			var before = ev.clientX < rr.left + rr.width / 2;
			var row = slot.parentNode;
			if (before) row.insertBefore(drag.slot, slot);
			else row.insertBefore(drag.slot, slot.nextSibling);
			return;
		}
		var row2 = under.closest ? under.closest('.bs-row') : null;
		if (row2 && row2 !== drag.slot.parentNode) {
			row2.appendChild(drag.slot);
		}
	}

	function onPointerUp(ev) {
		if (!drag || ev.pointerId !== drag.id) return;
		var d = drag;
		drag = null;
		if (!d.active) return;
		clearInterval(d.scroll);
		d.ghost.remove();
		d.el.classList.remove('is-drag-src');
		root.classList.remove('is-dragging');
		suppressClick = true;
		setTimeout(function () { suppressClick = false; }, 0);
		var toRow = d.slot.closest('.bs-row');
		renumberRow(d.fromRow);
		if (toRow && toRow !== d.fromRow) renumberRow(toRow);
		saveArrangement();
		d.el.classList.add('is-dropped');
		setTimeout(function () { d.el.classList.remove('is-dropped'); }, 500);
	}

	function setRearranging(on) {
		rearranging = on;
		root.classList.toggle('is-rearranging', on);
		if (on && view !== 'shelves') setView('shelves');
		updateContextRow();
	}

	// ---- Layouts -------------------------------------------------------------

	function shelfLabel(key) {
		var m = /^(.*?)\s*\((.*)\)\s*$/.exec(key);
		if (!m) return { label: key, sub: '' };
		return { label: m[1], sub: /sticky|photo/.test(m[2]) ? '' : m[2] };
	}
	function byTitle(a, b) { return a.t.localeCompare(b.t, ['en', 'ja']); }
	function byPos(a, b) { return a.p - b.p; }

	function layoutShelves() {
		var groups = [];
		UNITS.forEach(function (u) {
			var rows = [];
			u.shelves.forEach(function (sh) {
				var keys = typeof sh === 'string' ? [sh] : sh.keys;
				var lab = typeof sh === 'string' ? shelfLabel(sh) : { label: sh.label, sub: sh.sub || '' };
				var items = books.filter(function (b) { return b.u === u.k && keys.indexOf(b.s) !== -1; }).sort(byPos);
				rows.push({ label: lab.label, sub: lab.sub, books: items, unit: u.k, shelf: keys[0] });
			});
			var n = rows.reduce(function (a, r) { return a + r.books.length; }, 0);
			groups.push({ label: u.name, sub: u.desc, count: n, rows: rows, unit: u.k });
		});
		return groups;
	}

	function eraLabel(y) {
		if (y == null) return 'Undated';
		if (y < 1800) return 'Before 1800';
		if (y < 1900) return '1800s';
		return Math.floor(y / 10) * 10 + 's';
	}
	function eraRank(label) {
		if (label === 'Before 1800') return -1e6;
		if (label === 'Undated') return 1e9;
		return parseInt(label, 10);
	}
	function yearText(y) { return y < 0 ? 'c. ' + fmt(-y) + ' BC' : String(y); }

	function groupBy(keyFn, sortGroups, sortItems, subFn) {
		var map = {};
		books.forEach(function (b) { var k = keyFn(b); (map[k] = map[k] || []).push(b); });
		var keys = Object.keys(map);
		if (sortGroups) keys.sort(sortGroups);
		return keys.map(function (k) {
			var items = map[k].sort(sortItems || byTitle);
			return { label: k, sub: subFn ? subFn(k, items) : '', count: items.length, rows: [{ books: items }] };
		});
	}

	function layoutWall(kind) {
		if (kind === 'genre') {
			return groupBy(function (b) { return b.g; }, null, byTitle).sort(function (a, b) { return b.count - a.count; });
		}
		if (kind === 'language') {
			return groupBy(function (b) { return langName(b.l); }, null, byTitle).sort(function (a, b) { return b.count - a.count; });
		}
		if (kind === 'era') {
			return groupBy(function (b) { return eraLabel(b.y); },
				function (a, b) { return eraRank(a) - eraRank(b); },
				function (a, b) { return (a.y || 0) - (b.y || 0) || byTitle(a, b); },
				function (k, items) {
					if (k === 'Undated') return 'No firm first-publication year';
					var ys = items.map(function (b) { return b.y; });
					var lo = Math.min.apply(null, ys), hi = Math.max.apply(null, ys);
					return lo === hi ? '' : yearText(lo) + ' to ' + yearText(hi);
				});
		}
		if (kind === 'author') {
			var tally = {};
			books.forEach(function (b) { var k = authorKey(b.a); if (k) tally[k] = (tally[k] || 0) + 1; });
			var groups = groupBy(function (b) {
				var k = authorKey(b.a);
				return k && tally[k] >= 3 ? k : (k ? 'One or two each' : 'No author on the spine');
			}, null, function (a, b) {
				return authorKey(a.a).localeCompare(authorKey(b.a), ['en', 'ja']) || byTitle(a, b);
			});
			var tail = ['One or two each', 'No author on the spine'];
			return groups.sort(function (a, b) {
				var ta = tail.indexOf(a.label), tb = tail.indexOf(b.label);
				if (ta !== -1 || tb !== -1) return (ta === -1 ? -1 : ta) - (tb === -1 ? -1 : tb);
				return b.count - a.count || a.label.localeCompare(b.label);
			});
		}
		return groupBy(function (b) {
			var c = b.t.replace(/^[\s'"(\[]+/, '').charAt(0);
			if (isJapaneseText(c)) return '日本語';
			if (/[0-9]/.test(c)) return '0–9';
			var u = c.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
			return /[A-Z]/.test(u) ? u : '#';
		}, function (a, b) {
			var w = function (k) { return k === '日本語' ? 2 : (k === '#' || k === '0–9') ? 1 : 0; };
			return w(a) - w(b) || a.localeCompare(b);
		}, byTitle);
	}

	// ---- Rendering the shelves ----------------------------------------------

	function buildGroup(g) {
		var wrap = el('section', 'bs-unit');
		var head = el('div', 'bs-unit-head');
		head.appendChild(el('h3', 'bs-unit-name', g.label));
		head.appendChild(el('span', 'bs-unit-count', fmt(g.count) + (g.count === 1 ? ' book' : ' books')));
		wrap.appendChild(head);
		if (g.sub && view !== 'shelves') wrap.appendChild(el('p', 'bs-unit-desc', g.sub));
		g.rows.forEach(function (r) {
			var shelf = el('div', 'bs-shelf');
			if (r.label) {
				var tag = el('div', 'bs-shelf-tag');
				tag.appendChild(el('span', 'bs-tag', r.label));
				if (r.sub) tag.appendChild(el('span', 'bs-shelf-sub', r.sub));
				shelf.appendChild(tag);
			}
			var row = el('div', 'bs-row');
			if (r.unit) { row.setAttribute('data-unit', r.unit); row.setAttribute('data-shelf', r.shelf); }
			r.books.forEach(function (b, i) {
				var slot = el('div', 'bk-slot');
				b.el.style.setProperty('--d', Math.min(i * 14, 520));
				slot.appendChild(b.el);
				row.appendChild(slot);
				order.push(b);
			});
			shelf.appendChild(row);
			wrap.appendChild(shelf);
		});
		return wrap;
	}

	function currentGroups() { return view === 'wall' ? layoutWall(sort) : layoutShelves(); }

	// FLIP: measure, mutate, measure, and animate the difference away.
	function flip(mutate) {
		if (reducedMotion) { mutate(); return; }
		var first = {};
		books.forEach(function (b) { var r = b.el.getBoundingClientRect(); if (r.width) first[b.id] = r; });
		mutate();
		var moves = [];
		books.forEach(function (b) {
			var a = first[b.id];
			if (!a) return;
			var z = b.el.getBoundingClientRect();
			var dx = a.left - z.left, dy = a.top - z.top;
			if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
			b.el.style.transition = 'none';
			b.el.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
			moves.push(b.el);
		});
		if (!moves.length) return;
		shelfArea.classList.add('is-flipping');
		requestAnimationFrame(function () {
			requestAnimationFrame(function () {
				moves.forEach(function (e, i) {
					e.style.transition = 'transform 640ms cubic-bezier(0.22, 1, 0.36, 1) ' + Math.min(i * 0.5, 240) + 'ms';
					e.style.transform = '';
				});
				setTimeout(function () {
					moves.forEach(function (e) { e.style.transition = ''; });
					shelfArea.classList.remove('is-flipping');
				}, 950);
			});
		});
	}

	function renderShelves(animate) {
		var groups = currentGroups();
		var build = function () {
			order = [];
			var frag = document.createDocumentFragment();
			groups.forEach(function (g) { frag.appendChild(buildGroup(g)); });
			shelfArea.textContent = '';
			shelfArea.appendChild(frag);
		};
		if (animate && !reducedMotion) {
			flip(build);
			$$('.bs-shelf', shelfArea).forEach(function (s) { s.classList.add('is-seen'); });
		} else {
			build();
			watchShelves();
		}
		updateStrip();
	}

	// Spines rise onto each board as it scrolls into view.
	function watchShelves() {
		var shelves = $$('.bs-shelf', shelfArea);
		if (reducedMotion || !('IntersectionObserver' in window)) {
			shelves.forEach(function (s) { s.classList.add('is-seen'); });
			return;
		}
		if (observer) observer.disconnect();
		observer = new IntersectionObserver(function (entries) {
			entries.forEach(function (en) {
				if (en.isIntersecting) { en.target.classList.add('is-seen'); observer.unobserve(en.target); }
			});
		}, { rootMargin: '80px 0px' });
		shelves.forEach(function (s) { s.classList.add('is-unseen'); observer.observe(s); });
	}

	function updateStrip() {
		if (!stripSvg) return;
		var n = order.length || 1;
		stripSvg.setAttribute('viewBox', '0 0 ' + n + ' 10');
		order.forEach(function (b, i) {
			var r = b.strip;
			if (!r) {
				r = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
				r.setAttribute('y', '0'); r.setAttribute('width', '1'); r.setAttribute('height', '10');
				r.setAttribute('fill', b.color);
				r.setAttribute('data-id', b.id);
				b.strip = r;
				stripSvg.appendChild(r);
			}
			r.setAttribute('x', String(i));
		});
	}

	// ---- Search --------------------------------------------------------------

	var FIELD_ALIAS = { t: 'title', title: 'title', a: 'author', author: 'author', p: 'pub', pub: 'pub', publisher: 'pub', g: 'genre', genre: 'genre', l: 'lang', lang: 'lang', language: 'lang', y: 'year', year: 'year', s: 'shelf', shelf: 'shelf', u: 'unit', unit: 'unit', is: 'is', type: 'type', ty: 'type' };

	function parseQuery(q) {
		var terms = [], filters = [];
		norm(q).split(/\s+/).forEach(function (tok) {
			if (!tok) return;
			var m = /^([a-z]+):(.+)$/.exec(tok);
			if (m && FIELD_ALIAS[m[1]]) filters.push({ f: FIELD_ALIAS[m[1]], v: m[2] });
			else terms.push(tok);
		});
		return { terms: terms, filters: filters };
	}

	function yearFilter(b, v) {
		var m;
		if (b.y == null) return v === 'undated' || v === 'none';
		if ((m = /^(\d{4})s$/.exec(v))) return b.y >= +m[1] && b.y < +m[1] + 10;
		if ((m = /^(\d{4})-(\d{4})$/.exec(v))) return b.y >= +m[1] && b.y <= +m[2];
		if ((m = /^<(\d{4})$/.exec(v))) return b.y < +m[1];
		if ((m = /^>(\d{4})$/.exec(v))) return b.y > +m[1];
		if ((m = /^(\d{4})$/.exec(v))) return b.y === +m[1];
		return v === 'dated';
	}

	function passesFilter(b, f) {
		switch (f.f) {
			case 'title': return b.nt.indexOf(f.v) !== -1;
			case 'author': return b.na.indexOf(f.v) !== -1;
			case 'pub': return b.np.indexOf(f.v) !== -1;
			case 'genre': return b.ng.indexOf(f.v) !== -1;
			case 'type': return norm(b.ty).indexOf(f.v) !== -1;
			case 'lang': return norm(b.l).indexOf(f.v) !== -1 || norm(langName(b.l)).indexOf(f.v) !== -1 || norm(b.lb).indexOf(f.v) !== -1;
			case 'year': return yearFilter(b, f.v);
			case 'shelf': return norm(b.s).indexOf(f.v) !== -1;
			case 'unit': return norm(b.u) === f.v;
			case 'is':
				if (f.v === 'free') return !!b.free;
				if (f.v === 'partial') return b.st === 'Partial';
				if (f.v === 'japanese') return b.lb === 'Japanese';
				if (f.v === 'english') return b.lb === 'English';
				if (f.v === 'dated') return b.y != null;
				if (f.v === 'undated') return b.y == null;
				if (f.v === 'moved') return b.u !== b.ou || b.s !== b.os || b.p !== b.op;
				return true;
		}
		return true;
	}

	// 0 = no match, otherwise a relevance score.
	function score(b) {
		var i;
		for (i = 0; i < parsed.filters.length; i++) if (!passesFilter(b, parsed.filters[i])) return 0;
		var total = 1;
		for (i = 0; i < parsed.terms.length; i++) {
			var t = parsed.terms[i], s = 0, k;
			if ((k = b.nt.indexOf(t)) !== -1) s = k === 0 ? 40 : (b.nt.charAt(k - 1) === ' ' ? 30 : 22);
			else if ((k = b.na.indexOf(t)) !== -1) s = k === 0 || b.na.charAt(k - 1) === ' ' ? 18 : 12;
			else if (b.np.indexOf(t) !== -1) s = 8;
			else if (b.ng.indexOf(t) !== -1) s = 6;
			else if (b.nd.indexOf(t) !== -1) s = 3;
			if (!s) return 0;
			total += s;
		}
		return total;
	}

	function matches(b) {
		if (genreFilter && b.g !== genreFilter) return false;
		if (langFilter && b.lb !== langFilter) return false;
		if (freeFilter && !b.free) return false;
		if (parsed.terms.length || parsed.filters.length) return score(b) > 0;
		return true;
	}

	function applyHighlight() {
		var active = !!(parsed.terms.length || parsed.filters.length || genreFilter || langFilter || freeFilter);
		var n = 0;
		books.forEach(function (b) {
			var ok = !active || matches(b);
			b.hit = ok;
			if (ok) n++;
			b.el.classList.toggle('is-dim', active && !ok);
			b.el.classList.toggle('is-hit', active && ok);
			if (b.strip) b.strip.setAttribute('opacity', active && !ok ? '0.15' : '1');
		});
		if (countEl) {
			countEl.textContent = active ? fmt(n) + ' of ' + fmt(books.length) : fmt(books.length) + ' books';
		}
		$$('[data-genre]', legendEl).forEach(function (c) { c.classList.toggle('is-on', c.getAttribute('data-genre') === genreFilter); });
		$$('[data-lang]', root).forEach(function (c) { c.classList.toggle('is-on', (c.getAttribute('data-lang') || null) === langFilter); });
		$$('[data-free]', toolbar).forEach(function (c) { c.classList.toggle('is-on', freeFilter); });
		root.classList.toggle('has-filter', active);
		syncUrl();
	}

	var resultSel = -1;
	var resultItems = [];

	function highlightText(text, terms) {
		var frag = document.createDocumentFragment();
		var lower = norm(text);
		var spans = [];
		terms.forEach(function (t) {
			var i = lower.indexOf(t);
			// Only highlight when normalisation kept the string length (plain ASCII/kana).
			if (i !== -1 && lower.length === text.length) spans.push([i, i + t.length]);
		});
		spans.sort(function (a, b) { return a[0] - b[0]; });
		var pos = 0;
		spans.forEach(function (sp) {
			if (sp[0] < pos) return;
			frag.appendChild(document.createTextNode(text.slice(pos, sp[0])));
			frag.appendChild(el('mark', null, text.slice(sp[0], sp[1])));
			pos = sp[1];
		});
		frag.appendChild(document.createTextNode(text.slice(pos)));
		return frag;
	}

	function renderResults() {
		resultsEl.textContent = '';
		resultItems = [];
		resultSel = -1;
		if (!parsed.terms.length && !parsed.filters.length) { resultsEl.hidden = true; return; }
		var scored = [];
		books.forEach(function (b) {
			if (genreFilter && b.g !== genreFilter) return;
			if (langFilter && b.lb !== langFilter) return;
			if (freeFilter && !b.free) return;
			var s = score(b);
			if (s) scored.push([s, b]);
		});
		scored.sort(function (a, b) { return b[0] - a[0] || byTitle(a[1], b[1]); });
		if (!scored.length) {
			resultsEl.appendChild(el('div', 'bs-result-empty', 'Nothing on the shelves matches. Try author:, genre:, year:1990s or is:free.'));
			resultsEl.hidden = false;
			return;
		}
		scored.slice(0, 8).forEach(function (pair, i) {
			var b = pair[1];
			var item = el('div', 'bs-result');
			item.setAttribute('role', 'option');
			item.setAttribute('data-id', b.id);
			var sw = el('i', 'bs-swatch');
			sw.style.background = b.color;
			item.appendChild(sw);
			var body = el('div', 'bs-result-body');
			var t = el('div', 'bs-result-t');
			t.appendChild(highlightText(b.t, parsed.terms));
			if (isJapaneseText(b.t)) t.lang = 'ja';
			body.appendChild(t);
			var meta = el('div', 'bs-result-m');
			if (b.a) meta.appendChild(highlightText(b.a, parsed.terms));
			meta.appendChild(document.createTextNode((b.a ? ' · ' : '') + b.u + ' / ' + shelfLabel(b.s).label));
			if (b.free) meta.appendChild(el('span', 'bs-result-free', 'free online'));
			body.appendChild(meta);
			item.appendChild(body);
			item.addEventListener('mousedown', function (ev) { ev.preventDefault(); });
			item.addEventListener('click', function () { pickResult(b); });
			resultsEl.appendChild(item);
			resultItems.push(item);
		});
		if (scored.length > 8) resultsEl.appendChild(el('div', 'bs-result-more', fmt(scored.length - 8) + ' more highlighted on the shelves'));
		resultsEl.hidden = false;
	}

	function selectResult(i) {
		if (!resultItems.length) return;
		resultSel = (i + resultItems.length) % resultItems.length;
		resultItems.forEach(function (it, k) { it.classList.toggle('is-selected', k === resultSel); });
		resultItems[resultSel].scrollIntoView({ block: 'nearest' });
	}

	function pickResult(b) {
		resultsEl.hidden = true;
		if (view === 'stats') setView('shelves');
		revealSpine(b);
		setTimeout(function () { openCard(b, searchInput); }, 350);
	}

	function jumpToFirstHit() {
		for (var i = 0; i < order.length; i++) if (order[i].hit) { revealSpine(order[i]); return; }
	}

	function revealSpine(b) {
		if (view === 'stats') setView('shelves');
		var r = b.el.getBoundingClientRect();
		var top = r.top + window.pageYOffset - window.innerHeight / 2 + r.height / 2;
		window.scrollTo({ top: Math.max(0, top), behavior: reducedMotion ? 'auto' : 'smooth' });
		b.el.classList.remove('is-pulse');
		void b.el.offsetWidth;
		b.el.classList.add('is-pulse');
		setTimeout(function () { b.el.classList.remove('is-pulse'); }, 2400);
	}

	// ---- URL state -------------------------------------------------------------

	function syncUrl() {
		if (!rendered) return;
		var q = [];
		if (view && view !== 'shelves') q.push('view=' + view);
		if (view === 'wall' && sort !== 'genre') q.push('sort=' + sort);
		if (paint !== 'genre') q.push('paint=' + paint);
		if (query) q.push('q=' + encodeURIComponent(query));
		if (genreFilter) q.push('genre=' + encodeURIComponent(genreFilter));
		if (langFilter) q.push('lang=' + encodeURIComponent(langFilter));
		if (freeFilter) q.push('free=1');
		var h = '#/bookshelf' + (cardOpenFor ? '/' + encodeURIComponent(cardOpenFor.id) : '') + (q.length ? '?' + q.join('&') : '');
		if (window.location.hash !== h) {
			try { history.replaceState(null, '', h); } catch (e) { /* file:// */ }
		}
	}

	function readUrlState() {
		var h = window.location.hash || '';
		var i = h.indexOf('?');
		if (i === -1) return;
		var params = {};
		h.slice(i + 1).split('&').forEach(function (kv) {
			var p = kv.split('=');
			if (p[0]) params[p[0]] = decodeURIComponent((p[1] || '').replace(/\+/g, ' '));
		});
		if (/^(shelves|wall|stats)$/.test(params.view || '')) view = params.view === 'shelves' ? '' : params.view;
		if (/^(genre|language|era|author|title)$/.test(params.sort || '')) sort = params.sort;
		if (/^(genre|language|era)$/.test(params.paint || '')) paint = params.paint;
		if (params.q) { query = params.q; parsed = parseQuery(query); }
		if (params.genre && GENRE_HUE[params.genre] != null) genreFilter = params.genre;
		if (params.lang && LANG_HUE[params.lang]) langFilter = params.lang;
		if (params.free === '1') freeFilter = true;
	}

	// ---- Tooltip -------------------------------------------------------------

	function showTip(b, rect) {
		if (drag && drag.active) return;
		tip.textContent = '';
		tip.appendChild(el('span', 'bs-tip-t', b.t));
		if (b.a) tip.appendChild(el('span', 'bs-tip-a', b.a));
		tip.classList.add('is-on');
		var w = tip.offsetWidth;
		var x = clamp(rect.left + rect.width / 2 - w / 2, 8, window.innerWidth - w - 8);
		var y = rect.top - tip.offsetHeight - 10;
		if (y < 8) y = rect.bottom + 10;
		tip.style.transform = 'translate(' + Math.round(x) + 'px,' + Math.round(y) + 'px)';
	}
	function hideTip() { tip.classList.remove('is-on'); }

	// ---- Book card -----------------------------------------------------------

	function unitName(k) {
		for (var i = 0; i < UNITS.length; i++) if (UNITS[i].k === k) return UNITS[i].name;
		return 'unit ' + k;
	}

	function whereText(b) {
		var lab = shelfLabel(b.s);
		var name = unitName(b.u);
		name = name.charAt(0).toLowerCase() + name.slice(1);
		var moved = b.u !== b.ou || b.s !== b.os || b.p !== b.op;
		if (b.u === 'Loose') return moved ? 'Moved to the desk-and-floor pile.' : 'Not shelved. It was out on the desk or floor.';
		return (moved ? 'Moved by you to the ' : 'On the ') + name + ' (' + b.u + '), shelf ' + lab.label + ', ' + ordinal(b.p) + ' from the left.';
	}

	function shelfNeighbors(b) {
		var same = books.filter(function (x) { return x.u === b.u && x.s === b.s; }).sort(byPos);
		var i = same.indexOf(b);
		return { prev: same[i - 1] || null, next: same[i + 1] || null };
	}

	function button(cls, icon, label, onClick) {
		var btn = el('button', 'bs-btn' + (cls ? ' ' + cls : ''));
		btn.type = 'button';
		btn.innerHTML = (icon ? '<i class="fa-solid ' + icon + '" aria-hidden="true"></i> ' : '') + '<span>' + label + '</span>';
		if (onClick) btn.addEventListener('click', onClick);
		return btn;
	}

	function openCard(b, fromEl) {
		if (!b) return;
		cardOpenFor = b;
		lastFocus = fromEl || document.activeElement;
		cardBody.textContent = '';

		var cover = el('div', 'bs-cover');
		cover.style.setProperty('--sh', b.ch);
		cover.style.setProperty('--ss', b.cs + '%');
		cover.style.setProperty('--sl', b.cl + '%');
		var coverIn = el('div', 'bs-cover-in');
		var ct = el('div', 'bs-cover-title', b.t);
		if (isJapaneseText(b.t)) ct.lang = 'ja';
		coverIn.appendChild(ct);
		if (b.a) coverIn.appendChild(el('div', 'bs-cover-author', b.a));
		if (b.pub) coverIn.appendChild(el('div', 'bs-cover-pub', b.pub));
		cover.appendChild(coverIn);
		cover.appendChild(el('div', 'bs-cover-pages'));

		var info = el('div', 'bs-info');
		var h = el('h3', 'bs-info-title', b.t);
		if (isJapaneseText(b.t)) h.lang = 'ja';
		info.appendChild(h);
		if (b.a) info.appendChild(el('div', 'bs-info-author', b.a));
		var meta = [];
		if (b.pub) meta.push(b.pub);
		if (b.yr) meta.push(b.yr);
		if (meta.length) info.appendChild(el('div', 'bs-info-meta', meta.join(' · ')));

		var chips = el('div', 'bs-info-chips');
		var gchip = el('span', 'bs-chip bs-chip-static');
		var sw = el('i', 'bs-swatch');
		sw.style.background = 'hsl(' + GENRE_HUE[b.g] + ' 55% 45%)';
		gchip.appendChild(sw);
		gchip.appendChild(document.createTextNode(b.g));
		chips.appendChild(gchip);
		chips.appendChild(el('span', 'bs-chip bs-chip-static', langName(b.l)));
		if (b.ty && b.ty !== '?') chips.appendChild(el('span', 'bs-chip bs-chip-static', b.ty));
		info.appendChild(chips);

		if (b.d) info.appendChild(el('p', 'bs-info-desc', b.d));
		if (b.st === 'Partial') info.appendChild(el('p', 'bs-info-note', 'The spine was only partly readable in the photos, so the title above is a best reading.'));

		if (b.free) {
			var freeBox = el('div', 'bs-info-free');
			var a = el('a', 'bs-btn bs-btn-accent');
			a.href = b.free.url;
			a.target = '_blank';
			a.rel = 'noopener';
			a.innerHTML = '<i class="fa-solid fa-book-open-reader" aria-hidden="true"></i> <span>Read it free on ' + (FREE_SOURCE[b.free.src] || b.free.src) + '</span>';
			freeBox.appendChild(a);
			if (b.free.note) freeBox.appendChild(el('span', 'bs-info-free-note', b.free.note));
			info.appendChild(freeBox);
		}

		var where = el('p', 'bs-info-where');
		where.appendChild(el('i', 'fa-solid fa-location-dot'));
		where.appendChild(document.createTextNode(' ' + whereText(b)));
		info.appendChild(where);

		var nb = shelfNeighbors(b);
		var nav = el('div', 'bs-card-nav');
		var prev = button('', 'fa-arrow-left', 'Left neighbour', function () { if (nb.prev) openCard(nb.prev, prev); });
		prev.disabled = !nb.prev;
		var next = button('', '', 'Right neighbour', function () { if (nb.next) openCard(nb.next, next); });
		next.innerHTML = '<span>Right neighbour</span> <i class="fa-solid fa-arrow-right" aria-hidden="true"></i>';
		next.disabled = !nb.next;
		var show = button('bs-btn-quiet', 'fa-book-open', 'Show on shelf', function () {
			closeCard();
			if (view !== 'shelves') setView('shelves');
			setTimeout(function () { revealSpine(b); }, 60);
		});
		var link = button('bs-btn-quiet', 'fa-link', 'Copy link', function () {
			var url = window.location.origin + window.location.pathname + '#/bookshelf/' + encodeURIComponent(b.id);
			var done = function () {
				link.querySelector('span').textContent = 'Copied';
				setTimeout(function () { link.querySelector('span').textContent = 'Copy link'; }, 1600);
			};
			if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, function () {});
			else done();
		});
		nav.appendChild(prev); nav.appendChild(next); nav.appendChild(show); nav.appendChild(link);
		info.appendChild(nav);

		cardBody.appendChild(cover);
		cardBody.appendChild(info);

		card.classList.add('is-open');
		document.body.classList.add('bs-card-is-open');
		card.setAttribute('aria-hidden', 'false');
		var closeBtn = $('.bs-card-close', card);
		if (closeBtn) closeBtn.focus();
		cover.classList.remove('is-in');
		void cover.offsetWidth;
		cover.classList.add('is-in');
		syncUrl();
	}

	function closeCard() {
		if (!cardOpenFor) return;
		cardOpenFor = null;
		card.classList.remove('is-open');
		document.body.classList.remove('bs-card-is-open');
		card.setAttribute('aria-hidden', 'true');
		syncUrl();
		if (lastFocus && lastFocus.focus) lastFocus.focus();
		lastFocus = null;
	}

	function tiltCover(ev) {
		var cover = $('.bs-cover', cardBody);
		if (!cover || reducedMotion) return;
		var r = cover.getBoundingClientRect();
		var px = (ev.clientX - r.left) / r.width - 0.5;
		var py = (ev.clientY - r.top) / r.height - 0.5;
		cover.style.setProperty('--rx', (-py * 10).toFixed(2) + 'deg');
		cover.style.setProperty('--ry', (px * 14).toFixed(2) + 'deg');
	}
	function untiltCover() {
		var cover = $('.bs-cover', cardBody);
		if (!cover) return;
		cover.style.setProperty('--rx', '0deg');
		cover.style.setProperty('--ry', '0deg');
	}

	function pullRandom() {
		var pool = books.filter(function (b) { return b.hit !== false; });
		if (!pool.length) pool = books;
		var b = pool[Math.floor(Math.random() * pool.length)];
		if (view === 'stats') setView('shelves');
		revealSpine(b);
		b.el.classList.add('is-pulled');
		setTimeout(function () {
			b.el.classList.remove('is-pulled');
			openCard(b, $('[data-action="random"]', toolbar));
		}, reducedMotion ? 0 : 520);
	}

	// ---- Stats ---------------------------------------------------------------

	function tally(keyFn, filter) {
		var m = {};
		books.forEach(function (b) {
			if (filter && !filter(b)) return;
			var k = keyFn(b);
			if (k == null || k === '') return;
			m[k] = (m[k] || 0) + 1;
		});
		return Object.keys(m).map(function (k) { return { k: k, n: m[k] }; })
			.sort(function (a, b) { return b.n - a.n || a.k.localeCompare(b.k); });
	}

	function statTile(label, value, note) {
		var t = el('div', 'bs-stat');
		t.appendChild(el('div', 'bs-stat-label', label));
		var v = el('div', 'bs-stat-value');
		if (typeof value === 'number') { v.setAttribute('data-count', String(value)); v.textContent = '0'; }
		else v.textContent = value;
		t.appendChild(v);
		if (note) t.appendChild(el('div', 'bs-stat-note', note));
		return t;
	}

	function tableView(rows, head) {
		var d = el('details', 'bs-table');
		d.appendChild(el('summary', null, 'Show as a table'));
		var t = el('table');
		var tr = el('tr');
		head.forEach(function (h) { tr.appendChild(el('th', null, h)); });
		t.appendChild(tr);
		rows.forEach(function (r) {
			var row = el('tr');
			row.appendChild(el('td', null, r.k));
			row.appendChild(el('td', 'num', fmt(r.n)));
			t.appendChild(row);
		});
		d.appendChild(t);
		return d;
	}

	function chartBox(title, sub) {
		var box = el('div', 'bs-chart');
		var head = el('div', 'bs-chart-head');
		head.appendChild(el('h4', 'bs-chart-title', title));
		if (sub) head.appendChild(el('p', 'bs-chart-sub', sub));
		box.appendChild(head);
		return box;
	}

	function barChart(title, rows, opts) {
		opts = opts || {};
		var box = chartBox(title, opts.sub);
		var max = rows.reduce(function (m, r) { return Math.max(m, r.n); }, 0) || 1;
		var list = el('div', 'bs-bars');
		rows.forEach(function (r) {
			var row = el('div', 'bs-bar-row');
			row.setAttribute('role', 'img');
			row.setAttribute('aria-label', r.k + ': ' + fmt(r.n));
			var lab = el('div', 'bs-bar-label');
			if (opts.swatch) {
				var sw = el('i', 'bs-swatch');
				sw.style.background = 'hsl(' + (GENRE_HUE[r.k] || 0) + ' 55% 45%)';
				lab.appendChild(sw);
			}
			lab.appendChild(document.createTextNode(r.k));
			var track = el('div', 'bs-bar-track');
			var bar = el('div', 'bs-bar');
			bar.style.setProperty('--pct', ((r.n / max) * 100).toFixed(2) + '%');
			track.appendChild(bar);
			track.appendChild(el('span', 'bs-bar-val', fmt(r.n)));
			row.appendChild(lab);
			row.appendChild(track);
			if (opts.clickGenre) {
				row.classList.add('is-clickable');
				row.tabIndex = 0;
				var go = function () { genreFilter = r.k; setView('wall'); applyHighlight(); };
				row.addEventListener('click', go);
				row.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); go(); } });
			}
			list.appendChild(row);
		});
		box.appendChild(list);
		box.appendChild(tableView(rows, opts.head || ['Item', 'Books']));
		return box;
	}

	function columnChart(title, rows, opts) {
		opts = opts || {};
		var box = chartBox(title, opts.sub);
		var max = rows.reduce(function (m, r) { return Math.max(m, r.n); }, 0) || 1;
		var cols = el('div', 'bs-cols');
		rows.forEach(function (r) {
			var c = el('div', 'bs-col');
			c.setAttribute('role', 'img');
			c.setAttribute('aria-label', r.k + ': ' + fmt(r.n));
			var stack = el('div', 'bs-col-stack');
			var bar = el('div', 'bs-col-bar');
			bar.style.setProperty('--pct', ((r.n / max) * 100).toFixed(2) + '%');
			if (r.n === max) bar.appendChild(el('span', 'bs-col-val', fmt(r.n)));
			stack.appendChild(bar);
			c.appendChild(stack);
			c.appendChild(el('div', 'bs-col-label', r.short || r.k));
			c.addEventListener('mouseenter', function () { showTip({ t: r.k, a: fmt(r.n) + (r.n === 1 ? ' book' : ' books') }, c.getBoundingClientRect()); });
			c.addEventListener('mouseleave', hideTip);
			cols.appendChild(c);
		});
		box.appendChild(cols);
		box.appendChild(tableView(rows, ['Era', 'Books']));
		return box;
	}

	function stackedBar(title, rows, sub) {
		var box = chartBox(title, sub);
		var total = rows.reduce(function (a, r) { return a + r.n; }, 0) || 1;
		var bar = el('div', 'bs-stack');
		var legend = el('div', 'bs-stack-legend');
		rows.forEach(function (r, i) {
			var seg = el('div', 'bs-stack-seg bs-series-' + (i + 1));
			seg.style.setProperty('--pct', ((r.n / total) * 100).toFixed(2) + '%');
			seg.setAttribute('role', 'img');
			seg.setAttribute('aria-label', r.k + ': ' + fmt(r.n));
			var pct = Math.round((r.n / total) * 100);
			if (pct >= 12) seg.appendChild(el('span', 'bs-stack-val', pct + '%'));
			bar.appendChild(seg);
			var li = el('span', 'bs-stack-key');
			li.appendChild(el('i', 'bs-swatch bs-series-' + (i + 1)));
			li.appendChild(document.createTextNode(r.k + ' · ' + fmt(r.n)));
			legend.appendChild(li);
		});
		box.appendChild(bar);
		box.appendChild(legend);
		box.appendChild(tableView(rows, ['Language', 'Books']));
		return box;
	}

	function renderStats() {
		statsArea.textContent = '';
		var ja = books.filter(function (b) { return b.lb === 'Japanese'; }).length;
		var genres = tally(function (b) { return b.g; });
		var shelves = {};
		books.forEach(function (b) { shelves[b.ou + '/' + b.os] = 1; });
		var dated = books.filter(function (b) { return b.y != null; });
		var oldest = dated.slice().sort(function (a, b) { return a.y - b.y; })[0];
		var authors = tally(function (b) { return authorKey(b.a); });
		var topReal = authors.filter(function (a) { return !/\(ed\.\)$/.test(a.k); })[0];
		var free = books.filter(function (b) { return b.free; }).length;

		var tiles = el('div', 'bs-stats-grid');
		tiles.appendChild(statTile('Books on the shelves', books.length, fmt(counts.rows || 0) + ' spines photographed, ' + fmt(counts.unreadable || 0) + ' unreadable, ' + fmt(counts.objects || 0) + ' not books'));
		tiles.appendChild(statTile('In Japanese', ja, Math.round((ja / books.length) * 100) + '% of the collection'));
		tiles.appendChild(statTile('Genres', genres.length, 'across ' + fmt(Object.keys(shelves).length) + ' shelves in ' + UNITS.filter(function (u) { return u.k !== 'Loose'; }).length + ' bookcases'));
		if (oldest) tiles.appendChild(statTile('Oldest text', yearText(oldest.y), oldest.t));
		if (topReal) tiles.appendChild(statTile('Most collected author', topReal.n, topReal.k));
		tiles.appendChild(statTile('Free to read online', free, 'public-domain texts on Project Gutenberg and Aozora Bunko'));
		statsArea.appendChild(tiles);

		var charts = el('div', 'bs-charts');
		charts.appendChild(barChart('By genre', genres, { sub: 'Click a genre to reshelve the wall by it.', swatch: true, clickGenre: true, head: ['Genre', 'Books'] }));

		var langs = [{ k: 'English', n: 0 }, { k: 'Japanese', n: 0 }, { k: 'Bilingual & other', n: 0 }];
		books.forEach(function (b) { for (var i = 0; i < langs.length; i++) if (langs[i].k === b.lb) langs[i].n++; });
		charts.appendChild(stackedBar('By language', langs, 'German, Italian and Latin, and bilingual dictionaries and readers, are the sliver on the right.'));

		var eraRows = [], eraMap = {}, maxYear = 1900;
		books.forEach(function (b) {
			if (b.y == null) return;
			var k = eraLabel(b.y);
			eraMap[k] = (eraMap[k] || 0) + 1;
			if (b.y > maxYear) maxYear = b.y;
		});
		eraRows.push({ k: 'Before 1800', short: '<1800', n: eraMap['Before 1800'] || 0 });
		eraRows.push({ k: '1800s', short: '1800s', n: eraMap['1800s'] || 0 });
		for (var dec = 1900; dec <= maxYear; dec += 10) {
			var key = dec + 's';
			eraRows.push({ k: key, short: dec % 100 === 0 ? String(dec) : "'" + String(dec).slice(2), n: eraMap[key] || 0 });
		}
		charts.appendChild(columnChart('First published', eraRows, { sub: fmt(dated.length) + ' books with a firm first-publication year; ' + fmt(books.length - dated.length) + ' undated (reprints, catalogues, magazines).' }));
		charts.appendChild(barChart('Most collected authors', authors.slice(0, 12), { head: ['Author', 'Books'], sub: 'Primary author or editor as printed on the spine.' }));
		charts.appendChild(barChart('Publishers and series', tally(function (b) { return b.pub; }).slice(0, 12), { head: ['Publisher', 'Books'] }));
		statsArea.appendChild(charts);

		setTimeout(function () { statsArea.classList.add('is-in'); countUp(); }, 40);
	}

	function countUp() {
		$$('[data-count]', statsArea).forEach(function (n) {
			var target = parseInt(n.getAttribute('data-count'), 10);
			if (reducedMotion) { n.textContent = fmt(target); return; }
			var start = Date.now(), dur = 900;
			var timer = setInterval(function () {
				var p = Math.min(1, (Date.now() - start) / dur);
				n.textContent = fmt(Math.round(target * (1 - Math.pow(1 - p, 3))));
				if (p >= 1) clearInterval(timer);
			}, 16);
		});
	}

	// ---- Views + toolbar ------------------------------------------------------

	function setView(v) {
		var prev = view;
		view = v;
		$$('[data-view]', toolbar).forEach(function (b) {
			var on = b.getAttribute('data-view') === v;
			b.classList.toggle('is-on', on);
			b.setAttribute('aria-pressed', on ? 'true' : 'false');
		});
		root.setAttribute('data-view', v);
		if (v !== 'shelves' && rearranging) setRearranging(false);
		if (v === 'stats') {
			shelfArea.hidden = true; strip.hidden = true; legendEl.hidden = true;
			statsArea.hidden = false;
			statsArea.classList.remove('is-in');
			renderStats();
		} else {
			statsArea.hidden = true;
			shelfArea.hidden = false; strip.hidden = false; legendEl.hidden = false;
			if (prev !== v || prev === 'stats') renderShelves(prev !== 'stats' && prev !== '');
		}
		updateContextRow();
		syncUrl();
	}

	function setSort(s) {
		sort = s;
		$$('[data-sort]', toolbar).forEach(function (b) {
			var on = b.getAttribute('data-sort') === s;
			b.classList.toggle('is-on', on);
			b.setAttribute('aria-pressed', on ? 'true' : 'false');
		});
		if (view !== 'wall') setView('wall');
		else { renderShelves(true); syncUrl(); }
	}

	function setPaint(p) {
		paint = p;
		$$('[data-paint]', toolbar).forEach(function (b) { b.classList.toggle('is-on', b.getAttribute('data-paint') === p); });
		books.forEach(applyColor);
		renderLegend();
		syncUrl();
	}

	function setZoom(z) {
		zoom = clamp(z, 0.7, 1.6);
		root.style.setProperty('--bs-zoom', zoom);
		store(STORE_ZOOM, zoom);
		var r = $('.bs-zoom input', toolbar);
		if (r) r.value = zoom;
	}

	function chip(label, attrs, onClick, cls) {
		var b = el('button', 'bs-chip' + (cls ? ' ' + cls : ''), label);
		b.type = 'button';
		Object.keys(attrs || {}).forEach(function (k) { b.setAttribute(k, attrs[k]); });
		if (onClick) b.addEventListener('click', onClick);
		return b;
	}

	function updateContextRow() {
		ctxRow.textContent = '';
		if (view === 'wall') {
			ctxRow.appendChild(el('span', 'bs-row-label', 'Reshelve by'));
			[['genre', 'Genre'], ['language', 'Language'], ['era', 'Era'], ['author', 'Author'], ['title', 'Title']].forEach(function (s) {
				ctxRow.appendChild(chip(s[1], { 'data-sort': s[0] }, function () { setSort(s[0]); }, sort === s[0] ? 'is-on' : ''));
			});
		} else if (view === 'shelves') {
			var re = chip('', null, function () { setRearranging(!rearranging); }, rearranging ? 'is-on' : '');
			re.innerHTML = '<i class="fa-solid ' + (rearranging ? 'fa-check' : 'fa-hand') + '" aria-hidden="true"></i> ' + (rearranging ? 'Done rearranging' : 'Rearrange');
			ctxRow.appendChild(re);
			var sh = chip('', null, shuffleShelves);
			sh.innerHTML = '<i class="fa-solid fa-shuffle" aria-hidden="true"></i> Shuffle';
			ctxRow.appendChild(sh);
			if (hasArrangement()) {
				var rs = chip('', null, resetShelves);
				rs.innerHTML = '<i class="fa-solid fa-rotate-left" aria-hidden="true"></i> Reset shelves';
				ctxRow.appendChild(rs);
			}
			if (rearranging) {
				var dl = chip('', null, downloadLayout, 'bs-chip-quiet');
				dl.innerHTML = '<i class="fa-solid fa-download" aria-hidden="true"></i> Download layout';
				ctxRow.appendChild(dl);
				ctxRow.appendChild(el('span', 'bs-row-hint', 'Drag a spine to another slot or shelf. Your arrangement is saved in this browser only.'));
			} else if (hasArrangement()) {
				ctxRow.appendChild(el('span', 'bs-row-hint', 'Showing your rearranged shelves.'));
			}
		}
	}

	function buildToolbar() {
		toolbar = el('div', 'bs-toolbar');

		var search = el('div', 'bs-search');
		var ic = el('i', 'fa-solid fa-magnifying-glass');
		ic.setAttribute('aria-hidden', 'true');
		search.appendChild(ic);
		searchInput = el('input', 'bs-search-input');
		searchInput.type = 'search';
		searchInput.placeholder = 'Search: title, author, or author:murakami year:1990s is:free';
		searchInput.setAttribute('aria-label', 'Search the bookshelf');
		searchInput.autocomplete = 'off';
		searchInput.value = query;
		var t;
		searchInput.addEventListener('input', function () {
			clearTimeout(t);
			t = setTimeout(function () {
				query = searchInput.value.trim();
				parsed = parseQuery(query);
				applyHighlight();
				renderResults();
			}, 80);
		});
		searchInput.addEventListener('focus', function () { if (query) renderResults(); });
		searchInput.addEventListener('blur', function () { setTimeout(function () { resultsEl.hidden = true; }, 150); });
		searchInput.addEventListener('keydown', function (ev) {
			if (ev.key === 'ArrowDown') { ev.preventDefault(); if (resultsEl.hidden) renderResults(); selectResult(resultSel + 1); }
			else if (ev.key === 'ArrowUp') { ev.preventDefault(); selectResult(resultSel - 1); }
			else if (ev.key === 'Enter') {
				ev.preventDefault();
				if (resultSel >= 0 && resultItems[resultSel]) pickResult(byId[resultItems[resultSel].getAttribute('data-id')]);
				else if (resultItems.length && view !== 'stats') jumpToFirstHit();
				else if (resultItems.length) pickResult(byId[resultItems[0].getAttribute('data-id')]);
			}
			else if (ev.key === 'Escape') {
				if (!resultsEl.hidden) { resultsEl.hidden = true; return; }
				searchInput.value = ''; query = ''; parsed = parseQuery('');
				applyHighlight();
			}
		});
		search.appendChild(searchInput);
		countEl = el('span', 'bs-count', '');
		search.appendChild(countEl);
		resultsEl = el('div', 'bs-results');
		resultsEl.setAttribute('role', 'listbox');
		resultsEl.hidden = true;
		search.appendChild(resultsEl);
		toolbar.appendChild(search);

		var views = el('div', 'bs-seg');
		views.setAttribute('role', 'group');
		views.setAttribute('aria-label', 'View');
		[['shelves', 'fa-layer-group', 'As shelved'], ['wall', 'fa-shuffle', 'Reshelve'], ['stats', 'fa-chart-simple', 'Numbers']].forEach(function (v) {
			var b = el('button', 'bs-seg-btn');
			b.type = 'button';
			b.setAttribute('data-view', v[0]);
			b.innerHTML = '<i class="fa-solid ' + v[1] + '" aria-hidden="true"></i> <span>' + v[2] + '</span>';
			b.addEventListener('click', function () { setView(v[0]); });
			views.appendChild(b);
		});
		toolbar.appendChild(views);

		ctxRow = el('div', 'bs-ctx');
		toolbar.appendChild(ctxRow);

		var filters = el('div', 'bs-filters');
		[['', 'All'], ['English', 'English'], ['Japanese', 'Japanese'], ['Bilingual & other', 'Other']].forEach(function (l) {
			filters.appendChild(chip(l[1], { 'data-lang': l[0] }, function () { langFilter = l[0] || null; applyHighlight(); renderResults(); }));
		});
		var fr = chip('', { 'data-free': '1' }, function () { freeFilter = !freeFilter; applyHighlight(); renderResults(); });
		fr.innerHTML = '<i class="fa-solid fa-book-open-reader" aria-hidden="true"></i> Free to read';
		filters.appendChild(fr);

		var paintBox = el('span', 'bs-paint');
		paintBox.appendChild(el('span', 'bs-row-label', 'Colour by'));
		[['genre', 'Genre'], ['language', 'Language'], ['era', 'Era']].forEach(function (p) {
			paintBox.appendChild(chip(p[1], { 'data-paint': p[0] }, function () { setPaint(p[0]); }, paint === p[0] ? 'is-on' : ''));
		});
		filters.appendChild(paintBox);

		var zoomBox = el('label', 'bs-zoom');
		zoomBox.innerHTML = '<i class="fa-solid fa-magnifying-glass-plus" aria-hidden="true"></i>';
		var range = el('input');
		range.type = 'range'; range.min = '0.7'; range.max = '1.6'; range.step = '0.05'; range.value = zoom;
		range.setAttribute('aria-label', 'Spine size');
		range.addEventListener('input', function () { setZoom(parseFloat(range.value)); });
		zoomBox.appendChild(range);
		filters.appendChild(zoomBox);

		var rnd = chip('', { 'data-action': 'random' }, pullRandom, 'bs-chip-accent');
		rnd.innerHTML = '<i class="fa-solid fa-dice" aria-hidden="true"></i> Pull a random book';
		filters.appendChild(rnd);
		toolbar.appendChild(filters);
		return toolbar;
	}

	function renderLegend() {
		legendEl.textContent = '';
		if (paint === 'genre') {
			tally(function (b) { return b.g; }).forEach(function (g) {
				var c = chip('', { 'data-genre': g.k }, function () { genreFilter = genreFilter === g.k ? null : g.k; applyHighlight(); renderResults(); }, 'bs-chip-genre' + (genreFilter === g.k ? ' is-on' : ''));
				var sw = el('i', 'bs-swatch');
				sw.style.background = 'hsl(' + (GENRE_HUE[g.k] || 0) + ' 55% 45%)';
				c.appendChild(sw);
				c.appendChild(document.createTextNode(g.k));
				c.appendChild(el('span', 'bs-chip-n', fmt(g.n)));
				legendEl.appendChild(c);
			});
		} else if (paint === 'language') {
			['English', 'Japanese', 'Bilingual & other'].forEach(function (k) {
				var n = books.filter(function (b) { return b.lb === k; }).length;
				var c = chip('', { 'data-lang': k }, function () { langFilter = langFilter === k ? null : k; applyHighlight(); renderResults(); }, 'bs-chip-genre' + (langFilter === k ? ' is-on' : ''));
				var sw = el('i', 'bs-swatch');
				sw.style.background = 'hsl(' + LANG_HUE[k] + ' 55% 45%)';
				c.appendChild(sw);
				c.appendChild(document.createTextNode(k));
				c.appendChild(el('span', 'bs-chip-n', fmt(n)));
				legendEl.appendChild(c);
			});
		} else {
			var ramp = el('div', 'bs-ramp');
			ramp.appendChild(el('span', 'bs-ramp-label', 'Before 1800'));
			ramp.appendChild(el('span', 'bs-ramp-bar'));
			ramp.appendChild(el('span', 'bs-ramp-label', '2020s'));
			var grey = el('span', 'bs-ramp-label bs-ramp-undated');
			grey.appendChild(el('i', 'bs-swatch'));
			grey.appendChild(document.createTextNode(' undated'));
			ramp.appendChild(grey);
			legendEl.appendChild(ramp);
		}
	}

	// ---- Boot -----------------------------------------------------------------

	function build() {
		root.textContent = '';
		root.setAttribute('aria-busy', 'false');
		root.style.setProperty('--bs-zoom', zoom);

		root.appendChild(buildToolbar());

		strip = el('div', 'bs-strip');
		stripSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
		stripSvg.setAttribute('preserveAspectRatio', 'none');
		stripSvg.setAttribute('aria-hidden', 'true');
		strip.appendChild(stripSvg);
		root.appendChild(strip);

		legendEl = el('div', 'bs-legend');
		root.appendChild(legendEl);
		renderLegend();

		shelfArea = el('div', 'bs-shelves');
		root.appendChild(shelfArea);
		statsArea = el('div', 'bs-stats');
		statsArea.hidden = true;
		root.appendChild(statsArea);

		tip = el('div', 'bs-tip');
		tip.setAttribute('role', 'tooltip');
		document.body.appendChild(tip);

		card = el('div', 'bs-card-backdrop');
		card.setAttribute('aria-hidden', 'true');
		var dialog = el('div', 'bs-card');
		dialog.setAttribute('role', 'dialog');
		dialog.setAttribute('aria-modal', 'true');
		dialog.setAttribute('aria-label', 'Book');
		var close = el('button', 'bs-card-close');
		close.type = 'button';
		close.setAttribute('aria-label', 'Close');
		close.innerHTML = '<i class="fa-solid fa-xmark" aria-hidden="true"></i>';
		close.addEventListener('click', closeCard);
		dialog.appendChild(close);
		cardBody = el('div', 'bs-card-body');
		dialog.appendChild(cardBody);
		card.appendChild(dialog);
		card.addEventListener('click', function (ev) { if (ev.target === card) closeCard(); });
		cardBody.addEventListener('mousemove', tiltCover);
		cardBody.addEventListener('mouseleave', untiltCover);
		document.body.appendChild(card);

		shelfArea.addEventListener('click', function (ev) {
			if (suppressClick) return;
			var s = ev.target.closest ? ev.target.closest('.bk') : null;
			if (s) openCard(byId[s.getAttribute('data-id')], s);
		});
		shelfArea.addEventListener('mouseover', function (ev) {
			var s = ev.target.closest ? ev.target.closest('.bk') : null;
			if (s) showTip(byId[s.getAttribute('data-id')], s.getBoundingClientRect());
		});
		shelfArea.addEventListener('mouseout', function (ev) {
			if (ev.target.closest && ev.target.closest('.bk')) hideTip();
		});
		shelfArea.addEventListener('focusin', function (ev) {
			var s = ev.target.closest ? ev.target.closest('.bk') : null;
			if (s) showTip(byId[s.getAttribute('data-id')], s.getBoundingClientRect());
		});
		shelfArea.addEventListener('focusout', hideTip);
		shelfArea.addEventListener('pointerdown', onPointerDown);
		shelfArea.addEventListener('pointermove', onPointerMove);
		shelfArea.addEventListener('pointerup', onPointerUp);
		shelfArea.addEventListener('pointercancel', onPointerUp);
		shelfArea.addEventListener('dragstart', function (ev) { ev.preventDefault(); });

		strip.addEventListener('click', function (ev) {
			var id = ev.target.getAttribute && ev.target.getAttribute('data-id');
			if (id) revealSpine(byId[id]);
		});
		strip.addEventListener('mouseover', function (ev) {
			var id = ev.target.getAttribute && ev.target.getAttribute('data-id');
			if (id) showTip(byId[id], ev.target.getBoundingClientRect());
		});
		strip.addEventListener('mouseout', hideTip);
		window.addEventListener('scroll', hideTip, { passive: true });

		document.addEventListener('keydown', function (ev) {
			if (!cardOpenFor) return;
			if (ev.key === 'Escape') { ev.preventDefault(); closeCard(); }
			else if (ev.key === 'ArrowLeft') { var p = shelfNeighbors(cardOpenFor).prev; if (p) { ev.preventDefault(); openCard(p); } }
			else if (ev.key === 'ArrowRight') { var n = shelfNeighbors(cardOpenFor).next; if (n) { ev.preventDefault(); openCard(n); } }
		});

		setView(view || 'shelves');
		applyHighlight();
		rendered = true;
		syncUrl();

		if (pendingId) {
			var b = byId[pendingId];
			pendingId = '';
			if (b) setTimeout(function () { openCard(b); }, 300);
		}
	}

	function loadData() {
		if (loading) return loading;
		loading = fetch(DATA_URL)
			.then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
			.then(function (data) {
				books = data.books || [];
				counts = data.counts || {};
				books.forEach(function (b) { decorate(b); byId[b.id] = b; });
				arrangement = load(STORE_ARRANGEMENT) || {};
				// Drop stored ids that no longer exist in the catalog.
				Object.keys(arrangement).forEach(function (k) {
					arrangement[k] = arrangement[k].filter(function (id) { return byId[id]; });
					if (!arrangement[k].length) delete arrangement[k];
				});
				applyArrangement();
				var z = load(STORE_ZOOM);
				if (typeof z === 'number') zoom = clamp(z, 0.7, 1.6);
				readUrlState();
				books.forEach(makeSpine);
				loaded = true;
			});
		return loading;
	}

	function show(rest) {
		root = root || document.getElementById('bookshelf');
		if (!root) return;
		var id = rest ? rest.replace(/^\/+|\/+$/g, '') : '';
		var q = id.indexOf('?');
		if (q !== -1) id = id.slice(0, q);
		if (!loaded) {
			pendingId = id;
			if (!loading) {
				root.setAttribute('aria-busy', 'true');
				root.innerHTML = '<div class="bs-loading"><div class="bs-loading-row">' + new Array(28).join('<i></i>') + '</div><p>Fetching the catalog…</p></div>';
				loadData().then(build, function (err) {
					root.innerHTML = '<p class="bs-error">The catalog could not be loaded (' + String(err.message || err) + ').</p>';
				});
			}
			return;
		}
		if (!rendered) { pendingId = id; return; }
		if (id) {
			var b = byId[id];
			if (b && cardOpenFor !== b) openCard(b);
		} else if (cardOpenFor) {
			closeCard();
		}
	}

	window.Bookshelf = { show: show };
})();
