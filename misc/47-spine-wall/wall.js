// Spine Wall: the layout engine. Pure data in, pure geometry out, no DOM.
//
// build(data) turns assets/data/library.json into one long wall in millimetres:
// units (the real bookcases, in the site's order) -> bays -> shelves -> items.
// Every item gets a deterministic size and "look" from a hash of its id, so the
// wall is identical on every visit. app.js draws it; Node can require() it.

(function (root, factory) {
	if (typeof module === 'object' && module.exports) module.exports = factory();
	else root.SpineWall = factory();
}(typeof self !== 'undefined' ? self : this, function () {
	'use strict';

	// ---- The physical bookcases (names, descriptions and order from the site) ----
	// Shelves inside a bay run top to bottom. "top" is an open shelf sitting on the case.
	var UNITS = [
		{ k: 'K', name: 'Pine library', wood: 'pine',
			desc: 'Three pine folding bookcases. Alphabetical by title, with every "The" filed after S, the fifty-one Harvard Classics stacked beneath, and two shelves of Japanese books to the side.',
			bays: [
				{ top: 'Top (VN boxes)', shelves: ['A to D', 'D to I', 'H to L', 'HC 1-16'] },
				{ shelves: ['M to O', 'O to S', 'S / The A-E', 'HC 17-34'] },
				{ shelves: ['The F-O', 'The P-T', 'T-W', 'HC 35-51'] },
				{ shelves: ['JP-1 (Jump, Mill)', 'JP-2 (Ranpo, Witchcraft)'], gap: 60 },
			] },
		{ k: 'H', name: 'Black bookcase', wood: 'black', desc: 'Six shelves: the canon read for school, a writing-craft and screenwriting library, dictionaries, and old test prep.', bays: [{ shelves: ['H1', 'H2', 'H3', 'H4', 'H5', 'H6'] }] },
		{ k: 'N', name: 'Manga case', wood: 'walnut', desc: 'The manga library: 1970s and 80s shōjo and seinen in bunko, seinen runs, visual novels and CDs, plus an Italian shelf.', bays: [{ top: 'N-Top (VN boxes, CDs)', shelves: ['N1 (Uffizi)', 'N2 (Berlitz, Catan)', 'N3 (鈴木由美子)', 'N4 (バガボンド, くず)', 'N5 (手塚, 吉田秋生)'] }] },
		{ k: 'B', name: 'Cherry bookcase', wood: 'cherry', labels: true, desc: 'Dark cherry shelves with library call-number labels. Almost entirely English humanities.', bays: [{ shelves: ['B1', 'B2', 'B3'] }] },
		{ k: 'G', name: 'Library-label shelves', wood: 'cherry', labels: true, desc: 'Overflow shelves in the same dark cherry, with a nursing stack at one end.', bays: [{ shelves: ['G1', 'G2'] }] },
		{ k: 'I', name: 'Cream bookcase', wood: 'cream', desc: 'English fiction and philosophy, with a visual-novel and illustration corner.', bays: [{ shelves: ['I1', 'I2'] }] },
		{ k: 'L', name: 'Nursing case', wood: 'white', desc: 'Drug guides, pathophysiology and review modules, with a Japanese manga shelf on top.', bays: [{ shelves: ['L0 (above sticky 16)', 'L1 (sticky 16)'] }] },
		{ k: 'M', name: 'Japanese literature shelf', wood: 'oak', desc: 'Sōseki, Dazai, Mishima, Akutagawa and Murakami in the original, mostly bunko.', bays: [{ shelves: ['JP floor shelf'] }] },
		{ k: 'A', name: 'Light-wood unit', wood: 'maple', desc: 'Two mixed shelves by the calligraphy wall.', bays: [{ shelves: ['A1', 'A2'] }] },
		{ k: 'D', name: 'Wire shelf', wood: 'wire', desc: 'Japanese bunko and test prep.', bays: [{ shelves: ['D1', 'D2'] }] },
		{ k: 'F', name: 'Headset shelf', wood: 'grey', desc: 'Manga and art catalogues, next to the VR headset.', bays: [{ shelves: ['F1'] }] },
		{ k: 'J', name: 'Cubby', wood: 'cardboard', desc: 'A box of self-help paperbacks.', bays: [{ shelves: ['Cubby'] }] },
		{ k: 'Loose', name: 'Desk and floor', wood: 'desk', desc: 'Whatever was out being read when the photos were taken.', bays: [{ shelves: [{ keys: ['Floor', 'Held (photo 73)', 'Held (photo 96)'], label: 'Loose', flat: true }] }] },
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
	var LANG_NAME = { EN: 'English', JA: 'Japanese', DE: 'German', IT: 'Italian', LA: 'Latin', VI: 'Vietnamese' };

	// Assumed spine thickness by type (mm). Stated in the page footer.
	var THICKNESS = { manga: 14, bunko: 12, paperback: 24, hardback: 34, art: 32, textbook: 40, magazine: 8 };

	// Wood and metal palettes per unit.
	var WOODS = {
		pine: { face: '#d6b273', edge: '#b58f52', dark: '#8f6b35', grain: '#c9a262', ink: '#3b2a12' },
		black: { face: '#23221f', edge: '#141311', dark: '#0b0b0a', grain: '#2d2b27', ink: '#d9d2c2' },
		walnut: { face: '#5c3d28', edge: '#3f2819', dark: '#2a1a10', grain: '#6b4a32', ink: '#f0e4cf' },
		cherry: { face: '#5a2a1f', edge: '#3e1c14', dark: '#29110c', grain: '#6a3527', ink: '#f2e3d2' },
		cream: { face: '#e7dec9', edge: '#c9bda3', dark: '#a89a7e', grain: '#ddd3bc', ink: '#3b2f1e' },
		white: { face: '#dddcd6', edge: '#bdbcb5', dark: '#9c9b94', grain: '#d4d3cc', ink: '#2f2f2c' },
		oak: { face: '#a97c4a', edge: '#86602f', dark: '#5e4220', grain: '#9b7040', ink: '#2c1d0c' },
		maple: { face: '#cfae79', edge: '#ad8c58', dark: '#866a3d', grain: '#c4a26c', ink: '#3b2a12' },
		wire: { face: '#2a2a2a', edge: '#161616', dark: '#0d0d0d', grain: '#3a3a3a', ink: '#e8e8e8' },
		grey: { face: '#8c8b86', edge: '#6b6a66', dark: '#4d4c49', grain: '#83827d', ink: '#15150f' },
		cardboard: { face: '#b48c5c', edge: '#8e6c42', dark: '#6b502e', grain: '#a78150', ink: '#2b1c0a' },
		desk: { face: '#6b4a2e', edge: '#4c3420', dark: '#30200f', grain: '#7a5636', ink: '#f1e5d1' },
	};

	// ---- Small helpers ----
	function hash(s) {
		var h = 2166136261;
		for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
		return h >>> 0;
	}
	function rng(seed) {
		var a = seed >>> 0;
		return function () {
			a = (a + 0x6D2B79F5) >>> 0;
			var t = a;
			t = Math.imul(t ^ (t >>> 15), t | 1);
			t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
			return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
		};
	}
	function pick(r, arr) { return arr[Math.floor(r() * arr.length) % arr.length]; }
	function between(r, lo, hi) { return lo + r() * (hi - lo); }
	function round1(v) { return Math.round(v * 10) / 10; }
	function hasCJK(s) { return /[　-ヿ㐀-䶿一-鿿＀-￯]/.test(s || ''); }
	function hsl(h, s, l) { return 'hsl(' + Math.round(h) + ' ' + Math.round(s) + '% ' + Math.round(l) + '%)'; }
	function langName(code) {
		if (!code || code === '?') return 'Unknown language';
		return code.split('/').map(function (c) { return LANG_NAME[c] || c; }).join(' / ');
	}
	function foldAccents(s) { return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }

	// Volume numbers: "Vol. 3", ", Part 02", "Level 1", "巻之一", "第3巻", trailing " 2"
	var KANJI_NUM = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10 };
	function volumeOf(title) {
		var m;
		if ((m = /(?:Vols?\.?|Volume|Part|Level|Book|Tome)\s*0*([0-9]+(?:\s*[-–]\s*[0-9]+)?|[IVX]{1,4})\b/i.exec(title))) return { n: m[1].replace(/\s/g, ''), series: title.slice(0, m.index).replace(/[\s,:(]+$/, '') };
		if ((m = /第\s*([0-9０-９]+)\s*巻/.exec(title))) return { n: m[1].replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); }), series: title.slice(0, m.index) };
		if ((m = /巻之([一二三四五六七八九十]+)/.exec(title))) return { n: String(KANJI_NUM[m[1]] || m[1]), series: title.slice(0, m.index) };
		if ((m = /^(.*\S)\s+\(?([0-9]{1,2})\)?$/.exec(title)) && !/^\d{4}$/.test(m[2])) return { n: m[2], series: m[1].replace(/[\s,(]+$/, '') };
		if ((m = /^(.*\S)\s+([IVX]{1,4})$/.exec(title))) return { n: m[2], series: m[1] };
		return null;
	}

	// ---- Classification: what kind of thing is this, and how big ----
	function classify(b) {
		var pub = b.pub || '', ty = b.ty || '', t = b.t || '';
		var ja = /JA/.test(b.l || '') || hasCJK(t);
		var vol = volumeOf(t);
		var r = rng(hash(b.id));
		var c = { kind: 'book', look: 'plain', ja: ja, vol: vol ? vol.n : null, series: vol ? vol.series : t, thick: 'paperback', finish: 'paper', hard: false };

		if (b.st === 'Not a book' || /^\(not a book\)/.test(t) || /Media|Games?|Other/.test(ty)) return classifyObject(b, c, r);

		if (/Collier/.test(pub) && /Harvard Classics/.test(t)) { c.look = 'hc'; c.w = 34; c.h = 216; c.thick = 'hardback'; c.finish = 'cloth'; c.hard = true; c.series = 'Harvard Classics'; var hv = /Vol\.\s*(\d+)/.exec(t); c.vol = hv ? hv[1] : c.vol; return c; }
		if (ty === 'Manga' || ty === 'Comics') {
			if (/文庫/.test(pub)) { c.look = 'mangabunko'; c.w = between(r, 15, 19); c.h = 152; c.thick = 'bunko'; c.finish = 'gloss'; return c; }
			if (/3-in-1|Omnibus|omnibus|傑作集/i.test(t)) { c.look = ja ? 'tankobon' : 'enmanga'; c.w = between(r, 36, 48); c.h = ja ? 190 : 192; c.thick = 'hardback'; c.finish = 'gloss'; return c; }
			if (ja) { c.look = 'tankobon'; c.w = between(r, 12.5, 16); c.h = /Big|ビッグ|モーニング|ヤング|KCZ|KCGM|KC\b|Kiss|mimi|Comics Special|バーズ/.test(pub) ? 182 : 176; c.thick = 'manga'; c.finish = 'gloss'; return c; }
			if (ty === 'Comics') { c.look = 'comic'; c.w = between(r, 9, 20); c.h = between(r, 255, 268); c.thick = 'paperback'; c.finish = 'gloss'; return c; }
			c.look = 'enmanga'; c.w = between(r, 15, 21); c.h = /Vertical/.test(pub) ? 196 : 191; c.thick = 'manga'; c.finish = 'gloss'; return c;
		}
		if (ty === 'Light novel') {
			if (ja || /文庫/.test(pub)) { c.look = 'lnbunko'; c.w = between(r, 11, 15); c.h = 150; c.thick = 'bunko'; c.finish = 'gloss'; return c; }
			c.look = 'enln'; c.w = between(r, 18, 24); c.h = 190; c.thick = 'paperback'; c.finish = 'gloss'; return c;
		}
		if (/文庫/.test(pub) || (ja && /新書/.test(pub))) { c.look = 'bunko'; c.w = between(r, 10, 17); c.h = /新書/.test(pub) ? 173 : 150; c.thick = 'bunko'; c.finish = 'paper'; return c; }
		if (ty === 'Anthology') { c.look = 'anthology'; c.w = between(r, 38, 50); c.h = between(r, 228, 240); c.thick = 'textbook'; c.finish = 'paper'; return c; }
		if (ty === 'Art' || ty === 'Picture book' || ty === "Children's") { c.look = 'art'; c.w = ty === 'Art' ? between(r, 16, 38) : between(r, 7, 11); c.h = between(r, 245, 305); c.thick = 'art'; c.finish = r() < 0.6 ? 'gloss' : 'cloth'; c.hard = r() < 0.6; return c; }
		if (ty === 'Magazine' || ty === 'Calendar' || ty === 'Math journal') { c.look = 'magazine'; c.w = between(r, 5, 9); c.h = ty === 'Calendar' ? 300 : between(r, 262, 290); c.thick = 'magazine'; c.finish = 'gloss'; return c; }
		if (ty === 'Textbook' || ty === 'Nursing & medical' || ty === 'Test prep' || ty === 'Technical') {
			c.look = /ATI/.test(pub) ? 'ati' : 'textbook'; c.w = /ATI/.test(pub) ? between(r, 12, 16) : between(r, 26, 46); c.h = /ATI/.test(pub) ? 275 : between(r, 250, 282); c.thick = 'textbook'; c.finish = 'gloss'; c.hard = r() < 0.5; return c;
		}
		if (ty === 'Reference') { c.look = /Dictionary|Thesaurus|Webster/i.test(t) ? 'dictionary' : 'textbook'; c.w = between(r, 30, 62); c.h = between(r, 228, 262); c.thick = 'textbook'; c.finish = 'cloth'; c.hard = true; return c; }
		if (ty === 'Poetry' || ty === 'Drama' || ty === 'Essays' || ty === 'Hymnal' || ty === 'Documents') { c.look = 'slim'; c.w = between(r, 8, 17); c.h = between(r, 198, 216); c.thick = 'paperback'; c.finish = ty === 'Hymnal' ? 'cloth' : 'paper'; c.hard = ty === 'Hymnal'; return c; }
		// Fiction and the nonfiction family.
		if (/Penguin Classics/.test(pub)) { c.look = 'penguinclassic'; c.w = between(r, 16, 30); c.h = 198; return c; }
		if (/^Penguin\b/.test(pub)) { c.look = 'penguin'; c.w = between(r, 14, 26); c.h = 198; return c; }
		if (/Oxford World/.test(pub)) { c.look = 'owc'; c.w = between(r, 16, 28); c.h = 196; return c; }
		if (/^Vintage/.test(pub)) { c.look = 'vintage'; c.w = between(r, 14, 28); c.h = 203; return c; }
		if (/Modern Library|Everyman|Library of America/.test(pub)) { c.look = 'modernlib'; c.w = between(r, 26, 40); c.h = between(r, 208, 220); c.thick = 'hardback'; c.finish = 'cloth'; c.hard = true; return c; }
		if (/leather|Easton|Franklin Library/i.test(pub)) { c.look = 'leather'; c.w = between(r, 30, 42); c.h = between(r, 218, 240); c.thick = 'hardback'; c.finish = 'cloth'; c.hard = true; return c; }
		if (/Dover/.test(pub)) { c.look = 'dover'; c.w = between(r, 8, 22); c.h = 210; return c; }
		if (/Norton/.test(pub)) { c.look = 'norton'; c.w = between(r, 18, 34); c.h = 213; return c; }
		if (/Bhaktivedanta/.test(pub)) { c.look = 'bbt'; c.w = between(r, 22, 44); c.h = between(r, 215, 230); c.thick = 'hardback'; c.finish = 'cloth'; c.hard = true; return c; }
		if (/Yen On|J-Novel|Seven Seas|Yen Press/.test(pub)) { c.look = 'enln'; c.w = between(r, 18, 24); c.h = 190; c.finish = 'gloss'; return c; }
		if (ty === 'Fiction') {
			var hard = r() < 0.18;
			c.look = hard ? 'hardback' : 'paperback'; c.hard = hard; c.w = hard ? between(r, 28, 44) : between(r, 15, 31); c.h = hard ? between(r, 215, 240) : between(r, 196, 212);
			c.thick = hard ? 'hardback' : 'paperback'; c.finish = hard ? (r() < 0.6 ? 'cloth' : 'gloss') : 'paper'; return c;
		}
		var hard2 = r() < 0.35;
		c.look = hard2 ? 'hardback' : 'trade'; c.hard = hard2; c.w = hard2 ? between(r, 26, 44) : between(r, 16, 34); c.h = hard2 ? between(r, 222, 242) : between(r, 203, 232);
		c.thick = hard2 ? 'hardback' : 'paperback'; c.finish = hard2 ? (r() < 0.55 ? 'cloth' : 'gloss') : 'paper';
		return c;
	}

	function classifyObject(b, c, r) {
		var t = (b.t || '').toLowerCase(), pub = (b.pub || '').toLowerCase();
		c.thick = null; c.finish = 'gloss'; c.look = 'object';
		if (/catan/.test(t)) { c.kind = 'boardgame'; c.w = 300; c.h = 74; c.flat = true; return c; }
		if (/headset/.test(t)) { c.kind = 'headset'; c.w = 190; c.h = 105; return c; }
		if (/trophies|medals|medal ribbons/.test(t)) { c.kind = 'trophy'; c.w = 170; c.h = 190; return c; }
		if (/honor cords/.test(t)) { c.kind = 'cords'; c.w = 70; c.h = 215; return c; }
				if (/pin badge/.test(t)) { c.kind = 'pin'; c.w = 32; c.h = 32; return c; }
		if (/pouch/.test(t)) { c.kind = 'pouch'; c.w = 92; c.h = 72; return c; }
		if (/calculator/.test(t)) { c.kind = 'calc'; c.w = 42; c.h = 190; return c; }
		if (/photo paper/.test(t)) { c.kind = 'photopaper'; c.w = 112; c.h = 160; return c; }
		if (/plaque|ema/.test(t) && /papers|forms/.test(t)) { c.kind = 'papers'; c.w = 150; c.h = 60; return c; }
		if (/ornament|cottage/.test(t)) { c.kind = 'ornament'; c.w = 70; c.h = 85; return c; }
		if (/loose|stacks|printed pages|folder lying|binder/.test(t)) { c.kind = /folder lying|binder/.test(t) ? 'folder' : 'papers'; c.w = c.kind === 'folder' ? 12 : 160; c.h = c.kind === 'folder' ? 300 : 40; return c; }
		if (/notebook/.test(t)) { c.kind = 'notebook'; var n = /two|hardback notebooks/.test(t) ? 2 : 1; c.w = (n === 2 ? 26 : 13); c.h = between(r, 225, 270); c.count = n; return c; }
		if (/disc cleaner|\(cd\)|cd\)|drama cd|cd$/.test(t) || /\(cd\)|drama cd/.test(pub)) { c.kind = 'cd'; c.w = 10; c.h = 125; return c; }
		if (/\(dvd\)/.test(t) || /dvd\)/.test(pub) || /\(dvd, /.test(t)) { c.kind = 'dvd'; c.w = 14; c.h = 190; return c; }
		if (/switch/.test(pub)) { c.kind = 'switch'; c.w = 11; c.h = 170; return c; }
		if (/ps vita/.test(t) || /5pb/.test(pub)) { c.kind = 'vita'; c.w = 12; c.h = 134; return c; }
		if (/box|boxed|edition|dvd-rom|premium|limited|anniversary|console|\(game/.test(t) || /movic/.test(pub)) {
			c.kind = 'box'; c.w = /dvd-rom|console|通常版/.test(t) ? between(r, 18, 26) : between(r, 42, 68); c.h = /dvd-rom|console|通常版/.test(t) ? 190 : between(r, 200, 265); return c;
		}
		if (/アフターストーリー|after/.test(t)) { c.kind = 'cd'; c.w = 10; c.h = 125; return c; }
		c.kind = 'misc'; c.w = 45; c.h = 150; return c;
	}

	// ---- Looks: deterministic colours and finish ----
	var DARKS = ['#1b1b1d', '#24262b', '#2b2a28', '#5a1c22', '#7a1f1f', '#1e2a4a', '#243d6b', '#1f4a3f', '#2f5d3a', '#4a2d6b', '#5b3a24', '#3b2f2f', '#8e2323', '#20323a', '#6b2d2d', '#2d3b2a'];
	var LIGHTS = ['#f1ede4', '#e9dfc8', '#f5f1e8', '#eee6d2', '#dfd6bf', '#f3eadb', '#e4e0d4', '#f7f3ea'];
	var BRIGHTS = ['#d8632a', '#e2b93b', '#2f55a4', '#1f6b6b', '#c43a3a', '#6b9b37', '#d88aa6', '#8fb8d8', '#b07a2a', '#8a4fb0', '#3a8a8a', '#e0a0b0', '#f0c05a', '#5a7fc0'];
	var GOLD = '#d9b35b';

	function luminance(hex) {
		var m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
		if (!m) return 0.5;
		return (0.2126 * parseInt(m[1], 16) + 0.7152 * parseInt(m[2], 16) + 0.0722 * parseInt(m[3], 16)) / 255;
	}
	function inkFor(base, r) { return luminance(base) < 0.42 ? ((r && r() < 0.3) ? GOLD : '#f1ead8') : '#1e1a16'; }

	function look(b, c) {
		var r = rng(hash('look:' + b.id));
		var sr = rng(hash('series:' + (c.series || b.t) + '|' + (b.a || '') + '|' + (b.pub || '')));
		var s = { base: '#888', ink: '#111', accent: null, band: null, blocks: null, finish: c.finish, titleFont: 'serif' };
		switch (c.look) {
			case 'hc': s.base = '#4b1c1f'; s.ink = GOLD; s.accent = GOLD; s.finish = 'cloth'; break;
			case 'bunko': s.base = pick(sr, ['#efe7d2', '#f2ecda', '#ebe3cc', '#f4efe3']); s.ink = '#2a2420'; s.band = hsl(sr() * 360, 55, 48); s.finish = 'paper'; break;
			case 'mangabunko': s.base = pick(sr, ['#efe7d2', '#f3ede0', '#e9e2d0']); s.ink = '#2a2420'; s.band = hsl(sr() * 360, 70, 50); s.finish = 'gloss'; s.titleFont = 'sans'; break;
			case 'lnbunko': s.base = pick(sr, ['#ffffff', '#f8f6f0', '#fbfaf5']); s.ink = hsl(sr() * 360, 60, 38); s.accent = hsl(sr() * 360, 85, 55); s.band = s.accent; s.finish = 'gloss'; s.titleFont = 'sans'; break;
			case 'tankobon': { var h = sr() * 360; s.base = hsl(h + (r() - 0.5) * 10, 65 + sr() * 25, 46 + sr() * 24); s.ink = luminanceHsl(s.base) < 0.5 ? '#ffffff' : '#1e1a16'; s.accent = sr() < 0.5 ? '#ffffff' : hsl((h + 180) % 360, 70, 60); s.finish = 'gloss'; s.titleFont = 'sans'; break; }
			case 'enmanga': case 'comic': { var dark = sr() < 0.45; s.base = dark ? pick(sr, ['#1b1b1d', '#101014', '#2b2630', '#1a2838']) : pick(sr, ['#ffffff', '#f6f3ee', '#f2f0ea']); s.ink = dark ? '#ffffff' : '#111'; s.accent = hsl(sr() * 360, 80, 52); s.finish = 'gloss'; s.titleFont = 'sans'; break; }
			case 'enln': s.base = pick(sr, ['#ffffff', '#f8f8f6', '#f4f2ee']); s.ink = '#1e1a16'; s.accent = hsl(sr() * 360, 80, 50); s.finish = 'gloss'; s.titleFont = 'sans'; break;
			case 'penguinclassic': s.base = '#121212'; s.ink = '#f4f1ea'; s.accent = '#f0803c'; s.finish = 'paper'; break;
			case 'penguin': s.base = '#f4f1ea'; s.ink = '#1e1a16'; s.band = '#f0803c'; s.finish = 'paper'; s.titleFont = 'sans'; break;
			case 'owc': s.base = '#f6f3ec'; s.ink = '#1e1a16'; s.band = pick(sr, ['#1b3f8f', '#8c1d2a', '#2a6b3f', '#5a3b8c']); s.finish = 'paper'; break;
			case 'vintage': s.base = pick(sr, DARKS.concat(BRIGHTS, LIGHTS)); s.ink = inkFor(s.base); s.accent = '#d12a2a'; s.finish = 'paper'; break;
			case 'modernlib': s.base = pick(sr, ['#1b1b1d', '#2a2422', '#3a2a2a', '#e9dfc8']); s.ink = inkFor(s.base, r); s.accent = GOLD; s.finish = 'cloth'; break;
			case 'leather': s.base = pick(sr, ['#4a1a1f', '#1f2e1f', '#1b1f33', '#2c1a12']); s.ink = GOLD; s.accent = GOLD; s.finish = 'cloth'; break;
			case 'dover': s.base = pick(sr, ['#ffffff', '#f6f3ec']); s.ink = '#1e1a16'; s.band = hsl(sr() * 360, 65, 42); s.finish = 'paper'; s.titleFont = 'sans'; break;
			case 'norton': s.base = pick(sr, ['#f3efe6', '#1d1d1f', '#8e2323', '#1e2a4a', '#2f5d3a', '#e2b93b']); s.ink = inkFor(s.base); s.band = '#f3efe6'; s.finish = 'paper'; break;
			case 'bbt': s.base = pick(sr, ['#1e2a4a', '#4b1c1f', '#2f2a4a']); s.ink = GOLD; s.accent = GOLD; s.finish = 'cloth'; break;
			case 'ati': s.base = '#f4f4f2'; s.ink = '#163a5c'; s.band = pick(sr, ['#2f7fb8', '#2a9d8f', '#c0392b', '#7b5ea7', '#e67e22']); s.finish = 'gloss'; s.titleFont = 'sans'; break;
			case 'textbook': case 'dictionary': s.base = pick(sr, ['#1e2a4a', '#8e2323', '#f1ede4', '#2f5d3a', '#24262b', '#2f55a4', '#e2b93b', '#f6f3ec', '#5a1c22', '#3a8a8a']); s.ink = inkFor(s.base); s.accent = hsl(sr() * 360, 60, 55); s.finish = c.look === 'dictionary' ? 'cloth' : 'gloss'; s.titleFont = 'sans'; break;
			case 'art': s.base = pick(sr, ['#ffffff', '#111111', '#f4f1ea', '#1a1a1a', '#e2b93b', '#c43a3a', '#2f55a4', '#f0e4cf']); s.ink = inkFor(s.base); s.accent = hsl(sr() * 360, 65, 55); s.titleFont = 'sans'; break;
			case 'magazine': s.base = pick(sr, ['#ffffff', '#f6f3ec', '#e8e8e8', '#d8632a', '#e2b93b', '#2f55a4']); s.ink = inkFor(s.base); s.accent = hsl(sr() * 360, 80, 55); s.titleFont = 'sans'; break;
			case 'anthology': s.base = pick(sr, ['#1b1b1d', '#5a1c22', '#1e2a4a', '#f1ede4', '#2f5d3a']); s.ink = inkFor(s.base); s.band = '#e9dfc8'; s.finish = 'paper'; break;
			case 'slim': s.base = pick(sr, LIGHTS.concat(DARKS, ['#d8632a', '#8fb8d8', '#6b9b37'])); s.ink = inkFor(s.base); s.finish = c.finish; break;
			case 'hardback': s.base = pick(sr, DARKS.concat(DARKS, LIGHTS, ['#b08a5a', '#6b6a3a', '#d8632a'])); s.ink = inkFor(s.base, r); s.accent = s.ink === GOLD ? GOLD : null; break;
			case 'object': break;
			default: // paperback, trade
				s.base = pick(sr, LIGHTS.concat(DARKS, BRIGHTS, LIGHTS)); s.ink = inkFor(s.base); s.accent = sr() < 0.5 ? hsl(sr() * 360, 60, 50) : null; s.titleFont = sr() < 0.45 ? 'sans' : 'serif';
		}
		if (c.kind !== 'book') {
			var k = c.kind;
			s.base = k === 'cd' ? '#dfe6ec' : k === 'dvd' ? '#1b1b1d' : k === 'switch' ? '#e8302a' : k === 'vita' ? '#1a2a5a' : k === 'box' ? hsl(sr() * 360, 45, 72) : k === 'notebook' ? pick(sr, ['#d88aa6', '#2a2a2a', '#3b6bb3', '#c9b48a', '#d9d0b8']) : k === 'folder' ? pick(sr, ['#c43a3a', '#d88aa6', '#1b1b1d']) : k === 'calc' ? '#2f7a4a' : k === 'papers' ? '#f3efe6' : k === 'photopaper' ? '#2f55a4' : k === 'headset' ? '#e9e9e6' : k === 'trophy' ? GOLD : k === 'cords' ? '#d8632a' : k === 'ornament' ? '#e2b93b' : k === 'pin' ? '#d88aa6' : k === 'pouch' ? '#e0a0b0' : k === 'boardgame' ? '#c43a3a' : '#777';
			s.ink = inkFor(s.base); s.accent = hsl(sr() * 360, 70, 55); s.titleFont = 'sans'; s.finish = 'gloss';
			if (/notebook with pink/.test(b.t)) s.base = '#e8a0b8';
			if (/plaid/.test(b.t)) s.base = '#8a3a3a';
			if (/black spiral|black binder/.test(b.t)) s.base = '#2a2a2a';
			if (/blue spiral/.test(b.t)) s.base = '#3b6bb3';
			if (/cardboard/.test(b.t)) s.base = '#c9b48a';
			if (/red folder|red and pink/.test(b.t)) s.base = '#c43a3a';
		}
		// Wear and bookmarks (hash-driven, sparse).
		s.wear = r() < 0.16 ? (r() < 0.5 ? 'scuff' : 'fade') : null;
		s.tab = r() < 0.07 ? pick(r, ['#ff6fa3', '#ffd23f', '#5ac8fa', '#9be15d']) : null;
		s.ribbon = (c.hard && r() < 0.22) ? pick(r, ['#8e2323', '#1e2a4a', '#2f5d3a', GOLD]) : null;
		s.lean = null;
		return s;
	}
	function luminanceHsl(str) { var m = /hsl\((\d+) (\d+)% (\d+)%\)/.exec(str); return m ? parseInt(m[3], 10) / 100 : 0.5; }

	// ---- Layout ----
	var BOARD = 18, SIDE = 18, PLINTH = 40, TOPBOARD = 18, PAD = 6, GAP = 0.7, UNIT_GAP = 160, BAY_GAP = 10, MIN_INNER_H = 185, HEADROOM = 22;

	function build(data) {
		var all = (data.books || []).concat(data.objects || []);
		var byShelf = {};
		all.forEach(function (b) {
			var key = b.u + '|' + b.s;
			(byShelf[key] = byShelf[key] || []).push(b);
		});
		Object.keys(byShelf).forEach(function (k) { byShelf[k].sort(function (a, b) { return (a.p || 0) - (b.p || 0); }); });

		var items = [], units = [], shelves = [], plates = [];
		var x = 60, running = 0, floorY = 0, maxUnitH = 0;
		var tally = {};

		UNITS.forEach(function (U) {
			var wood = WOODS[U.wood];
			var unit = { k: U.k, name: U.name, desc: U.desc, wood: U.wood, labels: !!U.labels, x: x, bays: [], books: 0, objects: 0 };
			var bx = x;
			// First pass: measure every bay.
			var measured = U.bays.map(function (B) {
				var rows = [];
				if (B.top) rows.push({ name: B.top, keys: [B.top], top: true });
				B.shelves.forEach(function (sdef) {
					if (typeof sdef === 'string') rows.push({ name: sdef, keys: [sdef] });
					else rows.push({ name: sdef.label, keys: sdef.keys, flat: !!sdef.flat });
				});
				rows.forEach(function (row) {
					row.items = [];
					row.keys.forEach(function (key) {
						(byShelf[U.k + '|' + key] || []).forEach(function (b) {
							var c = classify(b), s = look(b, c);
							var it = { id: b.id, b: b, c: c, s: s, w: c.w, h: c.h, flat: !!c.flat || !!row.flat, key: key, unit: U.k, shelf: row.name, isBook: c.kind === 'book' };
							row.items.push(it);
						});
					});
					// Measure the row.
					var r = rng(hash('slack:' + U.k + row.name));
					if (row.flat) {
						// Piles: one per key, lying flat.
						var piles = {}, order = [];
						row.items.forEach(function (it) { if (!piles[it.key]) { piles[it.key] = []; order.push(it.key); } piles[it.key].push(it); });
						var px = 0, tallest = 0;
						order.forEach(function (key) {
							var pile = piles[key], pw = 0, ph = 0;
							pile.forEach(function (it) { pw = Math.max(pw, it.h); ph += it.w + 0.5; });
							pile.px = px; pile.pw = pw; pile.ph = ph; px += pw + 70; tallest = Math.max(tallest, ph);
						});
						row.piles = order.map(function (k) { return piles[k]; });
						row.contentW = Math.max(px - 70, 200); row.contentH = Math.max(tallest, 120);
					} else {
						var w = 0, h = 0;
						row.items.forEach(function (it) { w += it.w + GAP + (r() < 0.12 ? between(r, 1, 6) : 0); h = Math.max(h, it.h); });
						row.contentW = w; row.contentH = h;
					}
				});
				return rows;
			});
			// Uniform width across a unit's main bays (same model of bookcase).
			var innerW = 0;
			measured.forEach(function (rows, i) {
				if (U.bays[i].gap) return;
				rows.forEach(function (row) { if (!row.top) innerW = Math.max(innerW, row.contentW); });
			});
			innerW = Math.max(innerW * 1.04 + PAD * 2, 300);
			U.bays.forEach(function (B, bi) {
				var rows = measured[bi];
				var bayInnerW = innerW;
				if (B.gap) { bayInnerW = 0; rows.forEach(function (row) { bayInnerW = Math.max(bayInnerW, row.contentW); }); bayInnerW = Math.max(bayInnerW * 1.04 + PAD * 2, 300); bx += B.gap; }
				var bayW = bayInnerW + SIDE * 2;
				var bay = { x: bx, w: bayW, innerW: bayInnerW, shelves: [], unit: U.k, wood: U.wood, first: bi === 0 };
				// Heights: open top row sits on the top board.
				var plinth = U.wood === 'desk' ? 700 : PLINTH;
				var hTotal = plinth;
				var rowsNormal = rows.filter(function (r) { return !r.top; });
				rowsNormal.forEach(function (row) { row.innerH = Math.max(row.contentH + HEADROOM, MIN_INNER_H); hTotal += row.innerH + BOARD; });
				hTotal += TOPBOARD - BOARD;
				var topRow = rows.filter(function (r) { return r.top; })[0];
				var caseH = hTotal;
				var totalH = caseH + (topRow ? topRow.contentH + 2 : 0);
				bay.caseH = caseH; bay.h = totalH;
				bay.y = -totalH; // floor at y = 0, up is negative
				var yTop = -caseH; // top of the top board
				bay.caseTop = yTop;
				var cursor = yTop + TOPBOARD;
				var allRows = topRow ? [topRow].concat(rowsNormal) : rowsNormal;
				allRows.forEach(function (row) {
					var sh = { name: row.name, unit: U.k, bay: bay, items: row.items, top: !!row.top, flat: !!row.flat, x: bx + SIDE, w: bayInnerW };
					if (row.top) { sh.boardY = yTop; sh.innerH = row.contentH + 2; sh.y = yTop - sh.innerH; sh.boardH = TOPBOARD; }
					else { sh.y = cursor; sh.innerH = row.innerH; sh.boardY = cursor + row.innerH; sh.boardH = BOARD; cursor = sh.boardY + BOARD; }
					sh.labelX = sh.x + 4;
					// Place items.
					if (row.flat) {
						row.piles.forEach(function (pile) {
							var py = sh.boardY;
							pile.forEach(function (it) {
								it.x = sh.x + PAD + pile.px; it.y = py - it.w; it.rw = pile.pw; it.rh = it.w; it.flat = true;
								it.rx = it.x; py -= it.w + 0.5;
								it.shelfRef = sh; placeMetre(it);
								items.push(it);
							});
						});
					} else {
						var r = rng(hash('slack:' + U.k + row.name));
						var cx = sh.x + PAD;
						row.items.forEach(function (it) {
							it.x = cx; it.y = sh.boardY - it.h; it.rw = it.w; it.rh = it.h;
							cx += it.w + GAP + (r() < 0.12 ? between(r, 1, 6) : 0);
							it.shelfRef = sh; placeMetre(it);
							items.push(it);
						});
					}
					sh.m0 = sh.items.length ? sh.items[0].m0 : running;
					sh.m1 = running;
					sh.books = sh.items.filter(function (i) { return i.isBook; }).length;
					bay.shelves.push(sh); shelves.push(sh);
					if (!row.top && sh.items.length === 0) sh.empty = true;
				});
				unit.bays.push(bay);
				maxUnitH = Math.max(maxUnitH, totalH);
				bx += bayW + BAY_GAP;
			});
			unit.w = bx - BAY_GAP - x;
			unit.h = Math.max.apply(null, unit.bays.map(function (b) { return b.h; }));
			unit.books = unit.bays.reduce(function (n, b) { return n + b.shelves.reduce(function (m, s) { return m + s.books; }, 0); }, 0);
			unit.objects = unit.bays.reduce(function (n, b) { return n + b.shelves.reduce(function (m, s) { return m + s.items.length - s.books; }, 0); }, 0);
			unit.m0 = unit.bays[0].shelves[0] ? Math.min.apply(null, unit.bays.map(function (b) { return Math.min.apply(null, b.shelves.map(function (s) { return s.m0; })); })) : running;
			unit.m1 = running;
			units.push(unit);
			x = bx - BAY_GAP + UNIT_GAP;
		});

		function placeMetre(it) {
			it.m0 = running;
			if (it.isBook) { running += it.w; tally[it.c.thick] = (tally[it.c.thick] || 0) + 1; }
			it.m1 = running;
		}

		var wallW = x - UNIT_GAP + 60;
		var top = -maxUnitH - 140; // headroom above the tallest unit
		var floor = 90; // floor strip below
		return {
			units: units, shelves: shelves, items: items,
			wallW: wallW, top: top, bottom: floor, wallH: floor - top,
			metres: running / 1000, tally: tally,
			woods: WOODS, thickness: THICKNESS,
		};
	}

	// Decade band for the era paint.
	function eraOf(y) {
		if (!y) return null;
		if (y < 1800) return 'pre-1800';
		if (y < 1900) return '1800s';
		return Math.floor(y / 10) * 10 + 's';
	}
	var ERAS = ['pre-1800', '1800s', '1900s', '1910s', '1920s', '1930s', '1940s', '1950s', '1960s', '1970s', '1980s', '1990s', '2000s', '2010s', '2020s'];
	function eraColour(era) {
		var i = ERAS.indexOf(era);
		if (i < 0) return '#4a4a4a';
		var t = i / (ERAS.length - 1);
		// sepia -> ember -> electric: old books brown, new books cyan
		var h = 30 + t * 170, s = 55 + t * 25, l = 38 + t * 22;
		return hsl(h, s, l);
	}

	return { UNITS: UNITS, GENRE_HUE: GENRE_HUE, WOODS: WOODS, THICKNESS: THICKNESS, ERAS: ERAS, build: build, classify: classify, look: look, hash: hash, rng: rng, hasCJK: hasCJK, hsl: hsl, langName: langName, foldAccents: foldAccents, eraOf: eraOf, eraColour: eraColour, volumeOf: volumeOf, GOLD: GOLD };
}));
