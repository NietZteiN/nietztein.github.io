/*
 * ToyKit library tables: the kit's one copy of the lookup tables that
 * assets/js/bookshelf.js keeps for the catalogue (bookcases and shelves,
 * genre and language hues, language names, author aliases, free-text sources)
 * and of the small helpers that read them.
 *
 * Toys do not load this file themselves: ToyKit.library() fetches it next to
 * assets/data/library.json and hands back the tables and helpers together
 * with the books. It is UMD so Node can read it too (window.ToyKitLibrary in
 * a browser, module.exports under Node).
 *
 * bookshelf.js is the source of truth. Do not edit the tables here by hand:
 * change bookshelf.js, copy the change over, and run
 *     node scripts/check-tables.mjs
 * which fails when this copy differs from bookshelf.js in any way, key order
 * included (some toys use Object.keys(GENRE_HUE) as their genre order).
 */
(function (root, factory) {
	'use strict';
	var api = factory();
	if (typeof module === 'object' && module && module.exports) module.exports = api;
	if (root) root.ToyKitLibrary = api;
})(typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : null), function () {
	'use strict';

	// ---- Tables (copied from assets/js/bookshelf.js) --------------------------

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
		'Literature (English & European)': 214, 'Japanese literature': 354, 'Manga & comics': 322, 'Light novels': 282,
		'Writing, film & literary craft': 28, 'History & biography': 14, 'Philosophy & political theory': 248,
		'Religion & theology': 42, 'Society, culture & ideas': 186, 'Politics, law & current affairs': 168,
		'Psychology, self-help & business': 142, 'Art & visual culture': 76, 'Music & opera': 266,
		'Language study & reference': 104, 'Test prep & study guides': 56, 'Math, CS & engineering': 200,
		'Science': 178, 'Nursing & medical': 6, 'Magazines & catalogues': 90, 'Occult & folklore': 300,
		'Games & other objects': 0, 'Unidentified': 0,
	};
	var LANG_HUE = { English: 214, Japanese: 354, 'Bilingual & other': 42 };
	var LANG_NAME = { EN: 'English', JA: 'Japanese', DE: 'German', IT: 'Italian', LA: 'Latin', VI: 'Vietnamese' };
	var AUTHOR_ALIAS = {
		'村上春樹': 'Haruki Murakami', '三島由紀夫': 'Yukio Mishima', 'Mishima Yukio': 'Yukio Mishima',
		'太宰治': 'Osamu Dazai', 'Dazai Osamu': 'Osamu Dazai', '夏目漱石': 'Natsume Sōseki', '芥川龍之介': 'Ryūnosuke Akutagawa',
		'ed. Charles W. Eliot': 'Charles W. Eliot (ed.)', '井浦秀夫 / 監修 小林茂和': '井浦秀夫', '渡航 ほか': '渡航',
	};
	var FREE_SOURCE = { gutenberg: 'Project Gutenberg', aozora: 'Aozora Bunko' };

	// ---- Helpers (the same rules as the functions of the same name in bookshelf.js) ----

	// FNV-1a over UTF-16 code units: bookshelf.js hash(), ToyKit.hash() and VN.hash() all agree.
	function hash(s) {
		s = String(s == null ? '' : s);
		var h = 2166136261;
		for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
		return h >>> 0;
	}
	function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
	function fmt(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

	// 'Dazai Osamu' and '太宰治' are one author: the name to group and count by.
	function authorKey(a) { return a ? (AUTHOR_ALIAS[a] || a) : ''; }

	// 'EN/JA' -> 'English / Japanese'.
	function langName(code) {
		if (!code || code === '?') return 'Unknown language';
		return code.split('/').map(function (c) { return LANG_NAME[c] || c; }).join(' / ');
	}
	// The three colour buckets of LANG_HUE.
	function langBucket(code) {
		if (code === 'JA') return 'Japanese';
		if (/^EN(\/|$)/.test(code) && code !== 'EN/JA') return 'English';
		return 'Bilingual & other';
	}

	// The era a first-publication year falls in: 'Before 1800', '1800s', then decades.
	function eraLabel(y) {
		if (y == null) return 'Undated';
		if (y < 1800) return 'Before 1800';
		if (y < 1900) return '1800s';
		return Math.floor(y / 10) * 10 + 's';
	}
	// Sort key for era labels: oldest first, 'Undated' last.
	function eraRank(label) {
		if (label === 'Before 1800') return -1e6;
		if (label === 'Undated') return 1e9;
		return parseInt(label, 10);
	}
	function yearText(y) { return y < 0 ? 'c. ' + fmt(-y) + ' BC' : String(y); }

	var UNIT_BY_KEY = {};
	UNITS.forEach(function (u) { UNIT_BY_KEY[u.k] = u; });

	function unitName(k) { return UNIT_BY_KEY[k] ? UNIT_BY_KEY[k].name : 'unit ' + k; }

	// 'N3 (鈴木由美子)' -> { label: 'N3', sub: '鈴木由美子' }; photo and sticky notes are dropped.
	function shelfLabel(key) {
		var m = /^(.*?)\s*\((.*)\)\s*$/.exec(key);
		if (!m) return { label: key, sub: '' };
		return { label: m[1], sub: /sticky|photo/.test(m[2]) ? '' : m[2] };
	}

	// Every shelf in bookcase order: { unit, shelf, keys, label, sub }. A record
	// sits on the row where row.unit === record.u and row.keys contains record.s.
	function shelves() {
		var rows = [];
		UNITS.forEach(function (u) {
			u.shelves.forEach(function (sh) {
				var keys = typeof sh === 'string' ? [sh] : sh.keys;
				var lab = typeof sh === 'string' ? shelfLabel(sh) : { label: sh.label, sub: sh.sub || '' };
				rows.push({ unit: u.k, shelf: keys[0], keys: keys.slice(), label: lab.label, sub: lab.sub });
			});
		});
		return rows;
	}

	// The spine colour the bookshelf paints a record with, as { h, s, l }.
	// mode: 'genre' (the default), 'language' or 'era'.
	function spineColor(b, mode) {
		var seed = hash(b.a || b.pub || b.t), hue, sat, lig;
		if (mode === 'language') {
			hue = LANG_HUE[langBucket(b.l)]; sat = 36 + (seed % 24); lig = 30 + ((seed >> 4) % 24);
		} else if (mode === 'era') {
			if (b.y == null) return { h: 214, s: 4, l: 44 };
			return { h: 214, s: 42, l: Math.round(24 + 32 * clamp((b.y - 1800) / 225, 0, 1)) };
		} else {
			hue = GENRE_HUE[b.g]; if (hue == null) hue = 0;
			sat = 34 + (seed % 26); lig = 30 + ((seed >> 4) % 26);
			if (b.g === 'Games & other objects' || b.g === 'Unidentified') { sat = 6; lig = 40 + (seed % 14); }
		}
		return { h: (hue + ((seed % 17) - 8) + 360) % 360, s: sat, l: lig };
	}

	// 'hsl(214 40% 36%)' from a record (its ch/cs/cl) or from { h, s, l }.
	// shift adds to the lightness, e.g. hsl(b, 12) for a lighter edge.
	function hsl(c, shift) {
		var h = c.ch != null ? c.ch : c.h, s = c.cs != null ? c.cs : c.s, l = c.cl != null ? c.cl : c.l;
		return 'hsl(' + h + ' ' + s + '% ' + clamp(l + (shift || 0), 0, 100) + '%)';
	}

	// Gives every record the colour fields ch, cs, cl (genre colours, as on the bookshelf).
	function decorate(list) {
		(list || []).forEach(function (b) {
			if (b.ch != null && b.cs != null && b.cl != null) return;
			var c = spineColor(b, 'genre');
			b.ch = c.h; b.cs = c.s; b.cl = c.l;
		});
		return list;
	}

	return {
		UNITS: UNITS, GENRE_HUE: GENRE_HUE, LANG_HUE: LANG_HUE, LANG_NAME: LANG_NAME,
		AUTHOR_ALIAS: AUTHOR_ALIAS, FREE_SOURCE: FREE_SOURCE, UNIT_BY_KEY: UNIT_BY_KEY,
		// the names check-tables.mjs compares with bookshelf.js
		TABLES: ['UNITS', 'GENRE_HUE', 'LANG_HUE', 'LANG_NAME', 'AUTHOR_ALIAS', 'FREE_SOURCE'],
		hash: hash, authorKey: authorKey, langName: langName, langBucket: langBucket,
		eraLabel: eraLabel, eraRank: eraRank, yearText: yearText,
		unitName: unitName, shelfLabel: shelfLabel, shelves: shelves,
		spineColor: spineColor, hsl: hsl, decorate: decorate
	};
});
