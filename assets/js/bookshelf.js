// Bookshelf: every catalogued book in the house, drawn as spines.
//
// Data comes from assets/data/library.json (built by scripts/build-library-json.ps1).
// The page has three views that share one set of spine elements:
//   shelves  the real layout, bookcase by bookcase, shelf by shelf
//   wall     every spine reshelved by genre, language, era, author or title
//            (spines fly to their new slot with a FLIP animation)
//   stats    headline numbers and a few small charts
// Clicking a spine opens a card; #/bookshelf/<id> deep-links to one.
//
// main.js calls window.Bookshelf.show(rest) whenever the #/bookshelf route is
// applied. Everything renders lazily on the first call.

(function () {
	'use strict';

	var DATA_URL = 'assets/data/library.json';

	// ---- Physical layout ----------------------------------------------------

	// Order of presentation and short public descriptions of each bookcase.
	// Shelf keys match the Shelf column of the catalog; an object merges keys.
	var UNITS = [
		{
			k: 'K', name: 'Pine library',
			desc: 'Three pine folding bookcases. Alphabetical by title, with every "The" filed after S, the fifty-one Harvard Classics stacked beneath, and two shelves of Japanese books to the side.',
			shelves: ['A to D', 'D to I', 'H to L', 'M to O', 'O to S', 'S / The A-E', 'The F-O', 'The P-T', 'T-W',
				'HC 1-16', 'HC 17-34', 'HC 35-51', 'JP-1 (Jump, Mill)', 'JP-2 (Ranpo, Witchcraft)', 'Top (VN boxes)'],
		},
		{
			k: 'H', name: 'Black bookcase',
			desc: 'Six shelves: the canon read for school, a writing-craft and screenwriting library, dictionaries, and old test prep.',
			shelves: ['H1', 'H2', 'H3', 'H4', 'H5', 'H6'],
		},
		{
			k: 'N', name: 'Manga case',
			desc: 'The manga library: 1970s and 80s shōjo and seinen in bunko, seinen runs, visual novels and CDs, plus an Italian shelf with no counterpart anywhere else.',
			shelves: ['N-Top (VN boxes, CDs)', 'N1 (Uffizi)', 'N2 (Berlitz, Catan)', 'N3 (鈴木由美子)', 'N4 (バガボンド, くず)', 'N5 (手塚, 吉田秋生)'],
		},
		{
			k: 'B', name: 'Cherry bookcase',
			desc: 'Dark cherry shelves with library call-number labels. Almost entirely English humanities: religion, history, opera.',
			shelves: ['B1', 'B2', 'B3'],
		},
		{
			k: 'G', name: 'Library-label shelves',
			desc: 'Overflow shelves in the same dark cherry, with a nursing stack at one end.',
			shelves: ['G1', 'G2'],
		},
		{
			k: 'I', name: 'Cream bookcase',
			desc: 'English fiction and philosophy, with a visual-novel and illustration corner.',
			shelves: ['I1', 'I2'],
		},
		{
			k: 'L', name: 'Nursing case',
			desc: 'Drug guides, pathophysiology and review modules, with a Japanese manga shelf on top.',
			shelves: ['L0 (above sticky 16)', 'L1 (sticky 16)'],
		},
		{
			k: 'M', name: 'Japanese literature shelf',
			desc: 'Sōseki, Dazai, Mishima, Akutagawa and Murakami in the original, mostly bunko.',
			shelves: ['JP floor shelf'],
		},
		{
			k: 'A', name: 'Light-wood unit',
			desc: 'Two mixed shelves by the calligraphy wall: art, hymnal, textbooks, Penguin philosophy.',
			shelves: ['A1', 'A2'],
		},
		{
			k: 'D', name: 'Wire shelf',
			desc: 'Japanese bunko and test prep.',
			shelves: ['D1', 'D2'],
		},
		{
			k: 'F', name: 'Headset shelf',
			desc: 'Manga and art catalogues, next to the VR headset.',
			shelves: ['F1'],
		},
		{
			k: 'J', name: 'Cubby',
			desc: 'A box of self-help paperbacks.',
			shelves: ['Cubby'],
		},
		{
			k: 'Loose', name: 'Desk and floor',
			desc: 'Whatever was out being read when the photos were taken.',
			shelves: [{ keys: ['Floor', 'Held (photo 73)', 'Held (photo 96)'], label: 'Loose' }],
		},
	];

	// Hue per genre. Spines take the genre hue with a per-author jitter, so a
	// series looks uniform and neighbouring genres still read as families.
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

	var LANG_NAME = {
		EN: 'English', JA: 'Japanese', DE: 'German', IT: 'Italian', LA: 'Latin', VI: 'Vietnamese',
	};

	// Name variants merged for the "most collected" list.
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

	// ---- State ---------------------------------------------------------------

	var books = [];
	var byId = {};
	var counts = {};
	var loaded = false;
	var loading = null;
	var rendered = false;

	var view = ''; // shelves | wall | stats (empty until the first render)
	var sort = 'genre'; // wall grouping
	var query = '';
	var genreFilter = null;
	var langFilter = null;
	var pendingId = '';

	var reducedMotion =
		window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

	// DOM
	var root, toolbar, strip, stripSvg, shelfArea, statsArea, tip, card, cardBody, countEl, legendEl;
	var cardOpenFor = null;
	var lastFocus = null;
	var order = []; // books in current layout order (for the strip and prev/next)

	function $(sel, r) {
		return (r || document).querySelector(sel);
	}
	function $$(sel, r) {
		return Array.prototype.slice.call((r || document).querySelectorAll(sel));
	}
	function el(tag, cls, text) {
		var n = document.createElement(tag);
		if (cls) n.className = cls;
		if (text != null) n.textContent = text;
		return n;
	}
	function hash(s) {
		var h = 2166136261;
		for (var i = 0; i < s.length; i++) {
			h ^= s.charCodeAt(i);
			h = Math.imul(h, 16777619) >>> 0;
		}
		return h >>> 0;
	}
	function ordinal(n) {
		var s = ['th', 'st', 'nd', 'rd'];
		var v = n % 100;
		return n + (s[(v - 20) % 10] || s[v] || s[0]);
	}
	function fmt(n) {
		return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
	}
	function langName(code) {
		if (!code || code === '?') return 'Unknown language';
		return code.split('/').map(function (c) {
			return LANG_NAME[c] || c;
		}).join(' / ');
	}
	function langBucket(code) {
		if (code === 'JA') return 'Japanese';
		if (/^EN(\/|$)/.test(code) && code !== 'EN/JA') return 'English';
		return 'Bilingual & other';
	}
	function authorKey(a) {
		if (!a) return '';
		return AUTHOR_ALIAS[a] || a;
	}
	function isJapaneseText(s) {
		return /[぀-ヿ一-鿿]/.test(s);
	}

	// ---- Spine geometry + colour --------------------------------------------

	function decorate(b) {
		var t = b.ty || '';
		var pub = b.pub || '';
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

		var hue = GENRE_HUE[b.g];
		if (hue == null) hue = 0;
		var seed = hash(b.a || b.pub || b.t);
		var sh = (hue + ((seed % 17) - 8) + 360) % 360;
		var ss = 34 + (seed % 26);
		var sl = 30 + ((seed >> 4) % 26);
		if (b.g === 'Games & other objects' || b.g === 'Unidentified') { ss = 6; sl = 40 + (seed % 14); }

		b.w = width;
		b.h = height;
		b.color = 'hsl(' + sh + ' ' + ss + '% ' + sl + '%)';
		b.style = '--sh:' + sh + ';--ss:' + ss + '%;--sl:' + sl + '%;--w:' + width + 'px;--h:' + height + 'px';
		b.band = (h >> 5) % 4; // 0 none, 1 top, 2 bottom, 3 both
		b.search = (b.t + ' ' + b.a + ' ' + b.pub + ' ' + b.g + ' ' + b.d).toLowerCase();
	}

	function makeSpine(b) {
		var s = el('button', 'bk' + (b.band ? ' bk-band-' + b.band : ''));
		s.type = 'button';
		s.style.cssText = b.style;
		s.setAttribute('data-id', b.id);
		s.setAttribute('aria-label', b.t + (b.a ? ', ' + b.a : ''));
		var label = el('span', 'bk-t', b.t);
		if (isJapaneseText(b.t)) label.lang = 'ja';
		s.appendChild(label);
		b.el = s;
		return s;
	}

	// ---- Layouts -------------------------------------------------------------

	function shelfLabel(key) {
		var m = /^(.*?)\s*\((.*)\)\s*$/.exec(key);
		if (!m) return { label: key, sub: '' };
		var sub = /sticky|photo/.test(m[2]) ? '' : m[2];
		return { label: m[1], sub: sub };
	}

	function byTitle(a, b) {
		return a.t.localeCompare(b.t, ['en', 'ja']);
	}
	function byPos(a, b) {
		return a.p - b.p;
	}

	function layoutShelves() {
		var groups = [];
		UNITS.forEach(function (u) {
			var rows = [];
			u.shelves.forEach(function (sh) {
				var keys = typeof sh === 'string' ? [sh] : sh.keys;
				var lab = typeof sh === 'string' ? shelfLabel(sh) : { label: sh.label, sub: sh.sub || '' };
				var items = books.filter(function (b) {
					return b.u === u.k && keys.indexOf(b.s) !== -1;
				}).sort(byPos);
				if (items.length) rows.push({ label: lab.label, sub: lab.sub, books: items });
			});
			var n = rows.reduce(function (a, r) { return a + r.books.length; }, 0);
			if (n) groups.push({ label: u.name, sub: u.desc, count: n, rows: rows, unit: u.k });
		});
		return groups;
	}

	// Before 1800 is one shelf, the 1800s one century, then decades.
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
	function yearText(y) {
		return y < 0 ? 'c. ' + fmt(-y) + ' BC' : String(y);
	}

	function groupBy(keyFn, sortGroups, sortItems, subFn) {
		var map = {};
		books.forEach(function (b) {
			var k = keyFn(b);
			(map[k] = map[k] || []).push(b);
		});
		var keys = Object.keys(map);
		if (sortGroups) keys.sort(sortGroups);
		return keys.map(function (k) {
			var items = map[k].sort(sortItems || byTitle);
			return { label: k, sub: subFn ? subFn(k, items) : '', count: items.length, rows: [{ books: items }] };
		});
	}

	function layoutWall(kind) {
		if (kind === 'genre') {
			return groupBy(function (b) { return b.g; }, function (a, b) { return a.localeCompare(b); }, byTitle)
				.sort(function (a, b) { return b.count - a.count; });
		}
		if (kind === 'language') {
			return groupBy(function (b) { return langName(b.l); }, null, byTitle)
				.sort(function (a, b) { return b.count - a.count; });
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
			// Authors with three or more items get their own shelf.
			var tally = {};
			books.forEach(function (b) {
				var k = authorKey(b.a);
				if (k) tally[k] = (tally[k] || 0) + 1;
			});
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
		// title
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
		var h = el('h3', 'bs-unit-name', g.label);
		head.appendChild(h);
		if (g.count) head.appendChild(el('span', 'bs-unit-count', fmt(g.count) + (g.count === 1 ? ' book' : ' books')));
		wrap.appendChild(head);
		if (g.sub) wrap.appendChild(el('p', 'bs-unit-desc', g.sub));
		g.rows.forEach(function (r) {
			var shelf = el('div', 'bs-shelf');
			if (r.label) {
				var tag = el('div', 'bs-shelf-tag');
				tag.appendChild(el('span', 'bs-tag', r.label));
				if (r.sub) tag.appendChild(el('span', 'bs-shelf-sub', r.sub));
				shelf.appendChild(tag);
			}
			var row = el('div', 'bs-row');
			r.books.forEach(function (b) {
				var slot = el('div', 'bk-slot');
				slot.appendChild(b.el);
				row.appendChild(slot);
				order.push(b);
			});
			shelf.appendChild(row);
			wrap.appendChild(shelf);
		});
		return wrap;
	}

	function currentGroups() {
		return view === 'wall' ? layoutWall(sort) : layoutShelves();
	}

	function renderShelves(animate) {
		var groups = currentGroups();
		var first = {};
		if (animate && !reducedMotion) {
			books.forEach(function (b) {
				var r = b.el.getBoundingClientRect();
				if (r.width) first[b.id] = r;
			});
		}
		order = [];
		var frag = document.createDocumentFragment();
		groups.forEach(function (g) {
			frag.appendChild(buildGroup(g));
		});
		shelfArea.textContent = '';
		shelfArea.appendChild(frag);
		updateStrip();

		if (animate && !reducedMotion) {
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
			if (moves.length) {
				shelfArea.classList.add('is-flipping');
				// Two frames: one to commit the inverse transform, one to release it.
				requestAnimationFrame(function () {
					requestAnimationFrame(function () {
						moves.forEach(function (e, i) {
							e.style.transition = 'transform 620ms cubic-bezier(0.22, 1, 0.36, 1) ' + Math.min(i * 0.6, 260) + 'ms';
							e.style.transform = '';
						});
						setTimeout(function () {
							moves.forEach(function (e) {
								e.style.transition = '';
							});
							shelfArea.classList.remove('is-flipping');
						}, 950);
					});
				});
			}
		}
	}

	// The strip: one thin rect per book in the current order. A minimap.
	function updateStrip() {
		if (!stripSvg) return;
		var n = order.length || 1;
		stripSvg.setAttribute('viewBox', '0 0 ' + n + ' 10');
		var have = stripSvg.childNodes.length;
		order.forEach(function (b, i) {
			var r = b.strip;
			if (!r) {
				r = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
				r.setAttribute('y', '0');
				r.setAttribute('width', '1');
				r.setAttribute('height', '10');
				r.setAttribute('fill', b.color);
				r.setAttribute('data-id', b.id);
				b.strip = r;
				stripSvg.appendChild(r);
			}
			r.setAttribute('x', String(i));
		});
		void have;
	}

	// ---- Highlighting (search + filters) -------------------------------------

	function matches(b) {
		if (genreFilter && b.g !== genreFilter) return false;
		if (langFilter && langBucket(b.l) !== langFilter) return false;
		if (query) {
			var terms = query.split(/\s+/);
			for (var i = 0; i < terms.length; i++) {
				if (terms[i] && b.search.indexOf(terms[i]) === -1) return false;
			}
		}
		return true;
	}

	function applyHighlight() {
		var active = !!(query || genreFilter || langFilter);
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
			countEl.textContent = active
				? fmt(n) + ' of ' + fmt(books.length) + (n === 1 ? ' book' : ' books')
				: fmt(books.length) + ' books';
		}
		$$('.bs-legend .bs-chip', legendEl).forEach(function (c) {
			c.classList.toggle('is-on', c.getAttribute('data-genre') === genreFilter);
		});
		$$('[data-lang]', toolbar).forEach(function (c) {
			c.classList.toggle('is-on', (c.getAttribute('data-lang') || null) === langFilter);
		});
		root.classList.toggle('has-filter', active);
	}

	function jumpToFirstHit() {
		for (var i = 0; i < order.length; i++) {
			if (order[i].hit) {
				revealSpine(order[i]);
				return;
			}
		}
	}

	function revealSpine(b) {
		if (view === 'stats') setView('shelves');
		var r = b.el.getBoundingClientRect();
		var top = r.top + window.pageYOffset - window.innerHeight / 2 + r.height / 2;
		window.scrollTo({ top: Math.max(0, top), behavior: reducedMotion ? 'auto' : 'smooth' });
		b.el.classList.remove('is-pulse');
		void b.el.offsetWidth;
		b.el.classList.add('is-pulse');
		setTimeout(function () {
			b.el.classList.remove('is-pulse');
		}, 2400);
	}

	// ---- Tooltip -------------------------------------------------------------

	function showTip(b, rect) {
		tip.textContent = '';
		tip.appendChild(el('span', 'bs-tip-t', b.t));
		if (b.a) tip.appendChild(el('span', 'bs-tip-a', b.a));
		tip.classList.add('is-on');
		var w = tip.offsetWidth;
		var x = rect.left + rect.width / 2 - w / 2;
		x = Math.max(8, Math.min(x, window.innerWidth - w - 8));
		var y = rect.top - tip.offsetHeight - 10;
		if (y < 8) y = rect.bottom + 10;
		tip.style.transform = 'translate(' + Math.round(x) + 'px,' + Math.round(y) + 'px)';
	}
	function hideTip() {
		tip.classList.remove('is-on');
	}

	// ---- Book card -----------------------------------------------------------

	function whereText(b) {
		var unit = null;
		for (var i = 0; i < UNITS.length; i++) if (UNITS[i].k === b.u) unit = UNITS[i];
		var lab = shelfLabel(b.s);
		var name = unit ? unit.name.charAt(0).toLowerCase() + unit.name.slice(1) : 'unit ' + b.u;
		if (b.u === 'Loose') return 'Not shelved. It was out on the desk or floor.';
		return 'On the ' + name + ' (' + b.u + '), shelf ' + lab.label + ', ' + ordinal(b.p) + ' from the left.';
	}

	function shelfNeighbors(b) {
		var same = books.filter(function (x) { return x.u === b.u && x.s === b.s; }).sort(byPos);
		var i = same.indexOf(b);
		return { prev: same[i - 1] || null, next: same[i + 1] || null, index: i, total: same.length };
	}

	function openCard(b, fromEl) {
		if (!b) return;
		cardOpenFor = b;
		lastFocus = fromEl || document.activeElement;
		cardBody.textContent = '';

		var cover = el('div', 'bs-cover');
		cover.style.cssText = b.style;
		var coverIn = el('div', 'bs-cover-in');
		var ct = el('div', 'bs-cover-title', b.t);
		if (isJapaneseText(b.t)) ct.lang = 'ja';
		coverIn.appendChild(ct);
		if (b.a) coverIn.appendChild(el('div', 'bs-cover-author', b.a));
		if (b.pub) coverIn.appendChild(el('div', 'bs-cover-pub', b.pub));
		cover.appendChild(coverIn);

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
		if (b.st === 'Partial') {
			info.appendChild(el('p', 'bs-info-note', 'The spine was only partly readable in the photos, so the title above is a best reading.'));
		}

		var where = el('p', 'bs-info-where');
		where.appendChild(el('i', 'fa-solid fa-location-dot'));
		where.appendChild(document.createTextNode(' ' + whereText(b)));
		info.appendChild(where);

		var nb = shelfNeighbors(b);
		var nav = el('div', 'bs-card-nav');
		var prev = el('button', 'bs-btn', '');
		prev.type = 'button';
		prev.innerHTML = '<i class="fa-solid fa-arrow-left" aria-hidden="true"></i> <span>Left neighbour</span>';
		prev.disabled = !nb.prev;
		prev.addEventListener('click', function () { if (nb.prev) openCard(nb.prev, prev); });
		var next = el('button', 'bs-btn', '');
		next.type = 'button';
		next.innerHTML = '<span>Right neighbour</span> <i class="fa-solid fa-arrow-right" aria-hidden="true"></i>';
		next.disabled = !nb.next;
		next.addEventListener('click', function () { if (nb.next) openCard(nb.next, next); });
		var show = el('button', 'bs-btn bs-btn-quiet', '');
		show.type = 'button';
		show.innerHTML = '<i class="fa-solid fa-book-open" aria-hidden="true"></i> <span>Show on shelf</span>';
		show.addEventListener('click', function () {
			closeCard();
			if (view !== 'shelves') setView('shelves');
			setTimeout(function () { revealSpine(b); }, 60);
		});
		var link = el('button', 'bs-btn bs-btn-quiet', '');
		link.type = 'button';
		link.innerHTML = '<i class="fa-solid fa-link" aria-hidden="true"></i> <span>Copy link</span>';
		link.addEventListener('click', function () {
			var url = window.location.origin + window.location.pathname + '#/bookshelf/' + encodeURIComponent(b.id);
			var done = function () {
				link.querySelector('span').textContent = 'Copied';
				setTimeout(function () { link.querySelector('span').textContent = 'Copy link'; }, 1600);
			};
			if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, function () {});
			else done();
		});
		nav.appendChild(prev);
		nav.appendChild(next);
		nav.appendChild(show);
		nav.appendChild(link);
		info.appendChild(nav);

		cardBody.appendChild(cover);
		cardBody.appendChild(info);

		card.classList.add('is-open');
		document.body.classList.add('bs-card-is-open');
		card.setAttribute('aria-hidden', 'false');
		var closeBtn = $('.bs-card-close', card);
		if (closeBtn) closeBtn.focus();

		// Restart the cover flip on every open.
		cover.classList.remove('is-in');
		void cover.offsetWidth;
		cover.classList.add('is-in');

		var want = '#/bookshelf/' + encodeURIComponent(b.id);
		if (window.location.hash !== want) {
			try { history.replaceState(null, '', want); } catch (e) { /* file:// etc. */ }
		}
	}

	function closeCard() {
		if (!cardOpenFor) return;
		cardOpenFor = null;
		card.classList.remove('is-open');
		document.body.classList.remove('bs-card-is-open');
		card.setAttribute('aria-hidden', 'true');
		if (/^#\/bookshelf\/./.test(window.location.hash)) {
			try { history.replaceState(null, '', '#/bookshelf'); } catch (e) { /* ignore */ }
		}
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
		if (typeof value === 'number') {
			v.setAttribute('data-count', String(value));
			v.textContent = '0';
		} else {
			v.textContent = value;
		}
		t.appendChild(v);
		if (note) t.appendChild(el('div', 'bs-stat-note', note));
		return t;
	}

	function barChart(title, rows, opts) {
		opts = opts || {};
		var box = el('div', 'bs-chart');
		var head = el('div', 'bs-chart-head');
		head.appendChild(el('h4', 'bs-chart-title', title));
		if (opts.sub) head.appendChild(el('p', 'bs-chart-sub', opts.sub));
		box.appendChild(head);
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
				var go = function () {
					genreFilter = r.k;
					setView('wall');
					applyHighlight();
				};
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
		var box = el('div', 'bs-chart');
		var head = el('div', 'bs-chart-head');
		head.appendChild(el('h4', 'bs-chart-title', title));
		if (opts.sub) head.appendChild(el('p', 'bs-chart-sub', opts.sub));
		box.appendChild(head);
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
		var box = el('div', 'bs-chart');
		var head = el('div', 'bs-chart-head');
		head.appendChild(el('h4', 'bs-chart-title', title));
		if (sub) head.appendChild(el('p', 'bs-chart-sub', sub));
		box.appendChild(head);
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

	function renderStats() {
		statsArea.textContent = '';

		var ja = books.filter(function (b) { return langBucket(b.l) === 'Japanese'; }).length;
		var genres = tally(function (b) { return b.g; });
		var shelves = {};
		books.forEach(function (b) { shelves[b.u + '/' + b.s] = 1; });
		var dated = books.filter(function (b) { return b.y != null; });
		var oldest = dated.slice().sort(function (a, b) { return a.y - b.y; })[0];
		var authors = tally(function (b) { return authorKey(b.a); });
		var top = authors[0];
		var topReal = authors.filter(function (a) { return !/\(ed\.\)$/.test(a.k); })[0];

		var tiles = el('div', 'bs-stats-grid');
		tiles.appendChild(statTile('Books on the shelves', books.length, fmt(counts.rows || 0) + ' spines photographed, ' + fmt(counts.unreadable || 0) + ' unreadable, ' + fmt(counts.objects || 0) + ' not books'));
		tiles.appendChild(statTile('In Japanese', ja, Math.round((ja / books.length) * 100) + '% of the collection'));
		tiles.appendChild(statTile('Genres', genres.length, 'across ' + fmt(Object.keys(shelves).length) + ' shelves in ' + UNITS.filter(function (u) { return u.k !== 'Loose'; }).length + ' bookcases'));
		if (oldest) tiles.appendChild(statTile('Oldest text', oldest.y < 0 ? 'c. ' + fmt(-oldest.y) + ' BC' : String(oldest.y), oldest.t));
		if (top) tiles.appendChild(statTile('Most shelf space', top.n, top.k + (top.k === 'Charles W. Eliot (ed.)' ? ', the Harvard Classics' : '')));
		if (topReal && topReal !== top) tiles.appendChild(statTile('Most collected author', topReal.n, topReal.k));
		statsArea.appendChild(tiles);

		var charts = el('div', 'bs-charts');

		charts.appendChild(barChart('By genre', genres, {
			sub: 'Click a genre to reshelve the wall by it.', swatch: true, clickGenre: true, head: ['Genre', 'Books'],
		}));

		var langs = [
			{ k: 'English', n: 0 }, { k: 'Japanese', n: 0 }, { k: 'Bilingual & other', n: 0 },
		];
		books.forEach(function (b) {
			var k = langBucket(b.l);
			for (var i = 0; i < langs.length; i++) if (langs[i].k === k) langs[i].n++;
		});
		charts.appendChild(stackedBar('By language', langs, 'German, Italian and Latin, and bilingual dictionaries and readers, are the sliver on the right.'));

		// Every decade from 1900 gets a column, empty or not, so the axis is even.
		var eraRows = [];
		var eraMap = {};
		var maxYear = 1900;
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
		charts.appendChild(columnChart('First published', eraRows, {
			sub: fmt(dated.length) + ' books with a firm first-publication year; ' + fmt(books.length - dated.length) + ' undated (reprints, catalogues, magazines).',
		}));

		charts.appendChild(barChart('Most collected authors', authors.slice(0, 12), { head: ['Author', 'Books'], sub: 'Primary author or editor as printed on the spine.' }));

		var pubs = tally(function (b) { return b.pub; }).slice(0, 12);
		charts.appendChild(barChart('Publishers and series', pubs, { head: ['Publisher', 'Books'] }));

		statsArea.appendChild(charts);

		// Animate in (a timer rather than rAF so it also fires in a background tab).
		setTimeout(function () {
			statsArea.classList.add('is-in');
			countUp();
		}, 40);
	}

	function countUp() {
		$$('[data-count]', statsArea).forEach(function (n) {
			var target = parseInt(n.getAttribute('data-count'), 10);
			if (reducedMotion) { n.textContent = fmt(target); return; }
			var start = Date.now();
			var dur = 900;
			var timer = setInterval(function () {
				var p = Math.min(1, (Date.now() - start) / dur);
				var e = 1 - Math.pow(1 - p, 3);
				n.textContent = fmt(Math.round(target * e));
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
		if (v === 'stats') {
			shelfArea.hidden = true;
			strip.hidden = true;
			statsArea.hidden = false;
			statsArea.classList.remove('is-in');
			renderStats();
		} else {
			statsArea.hidden = true;
			shelfArea.hidden = false;
			strip.hidden = false;
			if (prev !== v || prev === 'stats') renderShelves(prev !== 'stats');
		}
	}

	function setSort(s) {
		sort = s;
		$$('[data-sort]', toolbar).forEach(function (b) {
			var on = b.getAttribute('data-sort') === s;
			b.classList.toggle('is-on', on);
			b.setAttribute('aria-pressed', on ? 'true' : 'false');
		});
		if (view !== 'wall') setView('wall');
		else renderShelves(true);
	}

	function buildToolbar() {
		toolbar = el('div', 'bs-toolbar');

		var search = el('div', 'bs-search');
		var ic = el('i', 'fa-solid fa-magnifying-glass');
		ic.setAttribute('aria-hidden', 'true');
		search.appendChild(ic);
		var input = el('input', 'bs-search-input');
		input.type = 'search';
		input.placeholder = 'Search titles, authors, descriptions…';
		input.setAttribute('aria-label', 'Search the bookshelf');
		input.autocomplete = 'off';
		var t;
		input.addEventListener('input', function () {
			clearTimeout(t);
			t = setTimeout(function () {
				query = input.value.trim().toLowerCase();
				applyHighlight();
			}, 90);
		});
		input.addEventListener('keydown', function (ev) {
			if (ev.key === 'Enter') { ev.preventDefault(); jumpToFirstHit(); }
			if (ev.key === 'Escape') { input.value = ''; query = ''; applyHighlight(); }
		});
		search.appendChild(input);
		countEl = el('span', 'bs-count', '');
		search.appendChild(countEl);
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

		var sorts = el('div', 'bs-sorts');
		sorts.appendChild(el('span', 'bs-sorts-label', 'Reshelve by'));
		[['genre', 'Genre'], ['language', 'Language'], ['era', 'Era'], ['author', 'Author'], ['title', 'Title']].forEach(function (s) {
			var b = el('button', 'bs-chip', s[1]);
			b.type = 'button';
			b.setAttribute('data-sort', s[0]);
			b.addEventListener('click', function () { setSort(s[0]); });
			sorts.appendChild(b);
		});
		toolbar.appendChild(sorts);

		var langs = el('div', 'bs-langs');
		[['', 'All'], ['English', 'English'], ['Japanese', 'Japanese'], ['Bilingual & other', 'Other']].forEach(function (l) {
			var b = el('button', 'bs-chip', l[1]);
			b.type = 'button';
			b.setAttribute('data-lang', l[0]);
			b.addEventListener('click', function () {
				langFilter = l[0] || null;
				applyHighlight();
			});
			langs.appendChild(b);
		});
		var rnd = el('button', 'bs-chip bs-chip-accent', '');
		rnd.type = 'button';
		rnd.setAttribute('data-action', 'random');
		rnd.innerHTML = '<i class="fa-solid fa-dice" aria-hidden="true"></i> Pull a random book';
		rnd.addEventListener('click', pullRandom);
		langs.appendChild(rnd);
		toolbar.appendChild(langs);

		return toolbar;
	}

	function buildLegend() {
		legendEl = el('div', 'bs-legend');
		var genres = tally(function (b) { return b.g; });
		genres.forEach(function (g) {
			var c = el('button', 'bs-chip bs-chip-genre');
			c.type = 'button';
			c.setAttribute('data-genre', g.k);
			var sw = el('i', 'bs-swatch');
			sw.style.background = 'hsl(' + (GENRE_HUE[g.k] || 0) + ' 55% 45%)';
			c.appendChild(sw);
			c.appendChild(document.createTextNode(g.k));
			c.appendChild(el('span', 'bs-chip-n', fmt(g.n)));
			c.addEventListener('click', function () {
				genreFilter = genreFilter === g.k ? null : g.k;
				applyHighlight();
			});
			legendEl.appendChild(c);
		});
		return legendEl;
	}

	// ---- Boot -----------------------------------------------------------------

	function build() {
		root.textContent = '';
		root.setAttribute('aria-busy', 'false');

		root.appendChild(buildToolbar());

		strip = el('div', 'bs-strip');
		stripSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
		stripSvg.setAttribute('preserveAspectRatio', 'none');
		stripSvg.setAttribute('aria-hidden', 'true');
		strip.appendChild(stripSvg);
		root.appendChild(strip);

		root.appendChild(buildLegend());

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
		card.addEventListener('click', function (ev) {
			if (ev.target === card) closeCard();
		});
		cardBody.addEventListener('mousemove', tiltCover);
		cardBody.addEventListener('mouseleave', untiltCover);
		document.body.appendChild(card);

		// Spine interactions, delegated.
		shelfArea.addEventListener('click', function (ev) {
			var s = ev.target.closest ? ev.target.closest('.bk') : null;
			if (!s) return;
			openCard(byId[s.getAttribute('data-id')], s);
		});
		shelfArea.addEventListener('mouseover', function (ev) {
			var s = ev.target.closest ? ev.target.closest('.bk') : null;
			if (!s) return;
			showTip(byId[s.getAttribute('data-id')], s.getBoundingClientRect());
		});
		shelfArea.addEventListener('mouseout', function (ev) {
			var s = ev.target.closest ? ev.target.closest('.bk') : null;
			if (s) hideTip();
		});
		shelfArea.addEventListener('focusin', function (ev) {
			var s = ev.target.closest ? ev.target.closest('.bk') : null;
			if (s) showTip(byId[s.getAttribute('data-id')], s.getBoundingClientRect());
		});
		shelfArea.addEventListener('focusout', hideTip);
		strip.addEventListener('click', function (ev) {
			var id = ev.target.getAttribute && ev.target.getAttribute('data-id');
			if (!id) return;
			var b = byId[id];
			if (view === 'stats') setView('shelves');
			revealSpine(b);
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
			else if (ev.key === 'ArrowLeft') {
				var p = shelfNeighbors(cardOpenFor).prev;
				if (p) { ev.preventDefault(); openCard(p); }
			} else if (ev.key === 'ArrowRight') {
				var n = shelfNeighbors(cardOpenFor).next;
				if (n) { ev.preventDefault(); openCard(n); }
			}
		});

		// First paint: staggered rise of every spine.
		setView('shelves');
		applyHighlight();
		if (!reducedMotion) {
			shelfArea.classList.add('is-entering');
			order.forEach(function (b, i) {
				b.el.style.setProperty('--d', Math.min(i * 1.6, 1100).toFixed(0));
			});
			setTimeout(function () {
				shelfArea.classList.remove('is-entering');
				books.forEach(function (b) { b.el.style.removeProperty('--d'); });
			}, 1900);
		}
		rendered = true;

		if (pendingId) {
			var b = byId[pendingId];
			pendingId = '';
			if (b) setTimeout(function () { openCard(b); }, 300);
		}
	}

	function load() {
		if (loading) return loading;
		loading = fetch(DATA_URL)
			.then(function (r) {
				if (!r.ok) throw new Error('HTTP ' + r.status);
				return r.json();
			})
			.then(function (data) {
				books = data.books || [];
				counts = data.counts || {};
				books.forEach(function (b) {
					decorate(b);
					makeSpine(b);
					byId[b.id] = b;
				});
				loaded = true;
			});
		return loading;
	}

	function show(rest) {
		root = root || document.getElementById('bookshelf');
		if (!root) return;
		var id = rest ? rest.replace(/^\/+|\/+$/g, '') : '';
		if (!loaded) {
			pendingId = id;
			if (!loading) {
				root.setAttribute('aria-busy', 'true');
				root.innerHTML =
					'<div class="bs-loading"><div class="bs-loading-row">' +
					new Array(28).join('<i style="--w:' + '14px"></i>') +
					'</div><p>Fetching the catalog…</p></div>';
				load().then(build, function (err) {
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
