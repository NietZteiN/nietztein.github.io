// Card Catalog: the library as an oak card catalogue.
//
// library.json is turned into catalogue entries (heading, filing key, run) and
// filed into drawers by one of five indexes: author, title, subject, shelf,
// year. Latin headings are inverted (Surname, Given) the way a cataloguer
// would type them; Japanese headings are filed by reading in a separate kana
// run (a small surname table does the readings; anything it cannot read goes
// under 漢字 by code point). Each drawer holds the cards plus tabbed guide
// cards at sub-range boundaries. The open drawer is a 3D stack you riffle
// with the wheel, arrow keys or a drag. Search types the query onto the right
// drawer's label, pulls it and riffles to the first hit.
(function () {
	'use strict';

	var DATA_URL = '../../assets/data/library.json';
	var BOOK_URL = '../../#/bookshelf/';

	// Physical bookcases, copied from assets/js/bookshelf.js.
	var UNITS = [
		{ k: 'K', name: 'Pine library', shelves: ['A to D', 'D to I', 'H to L', 'M to O', 'O to S', 'S / The A-E', 'The F-O', 'The P-T', 'T-W', 'HC 1-16', 'HC 17-34', 'HC 35-51', 'JP-1 (Jump, Mill)', 'JP-2 (Ranpo, Witchcraft)', 'Top (VN boxes)'] },
		{ k: 'H', name: 'Black bookcase', shelves: ['H1', 'H2', 'H3', 'H4', 'H5', 'H6'] },
		{ k: 'N', name: 'Manga case', shelves: ['N-Top (VN boxes, CDs)', 'N1 (Uffizi)', 'N2 (Berlitz, Catan)', 'N3 (鈴木由美子)', 'N4 (バガボンド, くず)', 'N5 (手塚, 吉田秋生)'] },
		{ k: 'B', name: 'Cherry bookcase', shelves: ['B1', 'B2', 'B3'] },
		{ k: 'G', name: 'Library-label shelves', shelves: ['G1', 'G2'] },
		{ k: 'I', name: 'Cream bookcase', shelves: ['I1', 'I2'] },
		{ k: 'L', name: 'Nursing case', shelves: ['L0 (above sticky 16)', 'L1 (sticky 16)'] },
		{ k: 'M', name: 'Japanese literature shelf', shelves: ['JP floor shelf'] },
		{ k: 'A', name: 'Light-wood unit', shelves: ['A1', 'A2'] },
		{ k: 'D', name: 'Wire shelf', shelves: ['D1', 'D2'] },
		{ k: 'F', name: 'Headset shelf', shelves: ['F1'] },
		{ k: 'J', name: 'Cubby', shelves: ['Cubby'] },
		{ k: 'Loose', name: 'Desk and floor', shelves: [{ keys: ['Floor', 'Held (photo 73)', 'Held (photo 96)'], label: 'Loose' }] },
	];
	var UNIT_BY_KEY = {};
	UNITS.forEach(function (u) { UNIT_BY_KEY[u.k] = u; });

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
	// short genre names for the brass label frames (the full name is in the tooltip)
	var GENRE_SHORT = {
		'Literature (English & European)': 'Literature (Eng.)', 'Japanese literature': 'Japanese lit.', 'Manga & comics': 'Manga & comics', 'Light novels': 'Light novels',
		'Writing, film & literary craft': 'Writing & film', 'History & biography': 'History & biog.', 'Philosophy & political theory': 'Philosophy',
		'Religion & theology': 'Religion', 'Society, culture & ideas': 'Society & ideas', 'Politics, law & current affairs': 'Politics & law',
		'Psychology, self-help & business': 'Psych. & self-help', 'Art & visual culture': 'Art', 'Music & opera': 'Music & opera',
		'Language study & reference': 'Language & ref.', 'Test prep & study guides': 'Test prep', 'Math, CS & engineering': 'Math & CS',
		'Nursing & medical': 'Nursing', 'Magazines & catalogues': 'Magazines', 'Occult & folklore': 'Occult & folklore', 'Games & other objects': 'Games & objects',
	};

	// Surname readings for the Japanese authors in the catalogue (hiragana).
	var READINGS = {
		'一色': 'いっしき', '三島': 'みしま', '三木': 'みき', '三秋': 'みあき', '中地': 'なかち', '中島': 'なかじま', '中村': 'なかむら',
		'五十嵐': 'いがらし', '井上': 'いのうえ', '井浦': 'いうら', '伊瀬': 'いせ', '伊藤': 'いとう', '佐伯': 'さえき', '佐竹': 'さたけ',
		'光瀬': 'みつせ', '冨岡': 'とみおか', '出水': 'いずみ', '加藤': 'かとう', '原田': 'はらだ', '友松': 'ともまつ', '吉田': 'よしだ',
		'周密': 'しゅうみつ', '和月': 'わつき', '喜国': 'きくに', '国立西洋美術館': 'こくりつせいようびじゅつかん', '士郎': 'しろう',
		'夏乃実': 'なつのみ', '夏目': 'なつめ', '大岡': 'おおおか', '大塚': 'おおつか', '天道': 'てんどう', '太宰': 'だざい', '宮島': 'みやじま',
		'宮沢': 'みやざわ', '山岸': 'やまぎし', '山崎': 'やまざき', '山田': 'やまだ', '山種美術館': 'やまたねびじゅつかん', '岡崎': 'おかざき',
		'峰浪': 'みねなみ', '弘兼': 'ひろかね', '手塚': 'てづか', '新川': 'しんかわ', '新海': 'しんかい', '有馬': 'ありま', '木原': 'きはら',
		'村上': 'むらかみ', '村田': 'むらた', '東京国立博物館': 'とうきょうこくりつはくぶつかん', '松本': 'まつもと', '枕': 'まくら',
		'柳澤': 'やなぎさわ', '柴門': 'さいもん', '森見': 'もりみ', '森': 'もり', '江戸川': 'えどがわ', '池田': 'いけだ', '浅野': 'あさの',
		'浅田': 'あさだ', '浦沢': 'うらさわ', '清水': 'しみず', '渡航': 'わたり', '狩野': 'かのう', '猫又': 'ねこまた', '田中': 'たなか',
		'田口': 'たぐち', '矢島': 'やじま', '筒井': 'つつい', '篠原': 'しのはら', '美内': 'みうち', '臺': 'だい', '芥川': 'あくたがわ',
		'芳澤': 'よしざわ', '苗川': 'なえかわ', '萩尾': 'はぎお', '藤原': 'ふじわら', '藤子': 'ふじこ', '衣笠': 'きぬがさ', '西原': 'さいばら',
		'貴田': 'きだ', '赤坂': 'あかさか', '野矢': 'のや', '鈴木': 'すずき', '間宮': 'まみや', '関口': 'せきぐち', '阪田': 'さかた',
		'須藤': 'すどう', '鴨川': 'かもがわ', '黒川': 'くろかわ', '白井': 'しらい', '相良': 'さがら', '塩川': 'しおかわ', '畠中': 'はたけなか',
		'河島': 'かわしま', '込山': 'こみやま', '横田': 'よこた', '横槍': 'よこやり', '永福': 'えいふく', '嶋本': 'しまもと', '小林': 'こばやし',
		'上田': 'うえだ', '梶村': 'かじむら', '福島': 'ふくしま', '七緒': 'ななお', '萩': 'はぎ', '岩': 'いわ', '高': 'たか', '石': 'いし',
	};
	var KEEP = ['Murasaki Shikibu', 'Sun Tzu', 'Dante Alighieri', 'Master Chin Kung', 'Omori Sogen', 'Hyojun Romaji Kai', 'Lilac Soft',
		'College Board', 'ATI Nursing Education', 'The Metropolitan Museum of Art', 'The School of Life', 'Dale Carnegie Training', '50 Cent', 'CLAMP', 'NECOTOXIN'];
	var SURNAME_FIRST = ['Mishima Yukio', 'Dazai Osamu', 'Yoshida Kiju', 'Natsume Sōseki'];
	var TITLE_ENTRY_RE = /^(ed\.|tr\.|various|\(author|eds?\s)/i;
	var JA_ROLE_RE = /^(原作|漫画|作画|小説|監修|編著|編|訳|校注|選|著|作)\s*/;
	var JA_TRAIL_RE = /\s*(編著|編|訳|校注|選|監修|著|ほか)\s*$/;

	var reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
	var thumb = /[?&]thumb=1/.test(location.search);

	// ---- helpers ------------------------------------------------------------

	function $(s, r) { return (r || document).querySelector(s); }
	function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
	function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
	function hash(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h >>> 0; }
	function fold(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }
	function hasCJK(s) { return /[぀-ヿ一-鿿㐀-䶿]/.test(s || ''); }
	function isKana(ch) { return /[぀-ヿ]/.test(ch); }
	function isKanji(ch) { return /[一-鿿㐀-䶿]/.test(ch); }
	function kataToHira(s) { return s.replace(/[ァ-ヶ]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0x60); }); }
	function stripArticle(t) { return String(t || '').replace(/^[^\p{L}\p{N}]+/u, '').replace(/^(the|an?)\s+/i, '').replace(/^[^\p{L}\p{N}]+/u, ''); }
	function langName(code) { if (!code || code === '?') return 'Unknown'; return code.split('/').map(function (c) { return LANG_NAME[c] || c; }).join(' / '); }
	function fmt(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
	function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

	var ROWS = [['あ', 'あいうえおぁぃぅぇぉゔ'], ['か', 'かきくけこがぎぐげごゕゖ'], ['さ', 'さしすせそざじずぜぞ'], ['た', 'たちつてとだぢづでどっ'], ['な', 'なにぬねの'],
		['は', 'はひふへほばびぶべぼぱぴぷぺぽ'], ['ま', 'まみむめも'], ['や', 'やゆよゃゅょ'], ['ら', 'らりるれろ'], ['わ', 'わゐゑをん']];
	function kanaRow(ch) {
		ch = kataToHira(ch);
		for (var i = 0; i < ROWS.length; i++) if (ROWS[i][1].indexOf(ch) >= 0) return ROWS[i][0];
		return 'ん';
	}
	function kanaKey(s) { return kataToHira(s).replace(/[＝・\s=･]/g, ''); }

	var enCol = new Intl.Collator('en', { sensitivity: 'base', numeric: true });
	var jaCol = new Intl.Collator('ja');
	function cmpEntries(a, b) {
		if (a.run !== b.run) return a.run - b.run;
		var c = a.run === 0 ? enCol.compare(a.key, b.key) : a.run === 1 ? jaCol.compare(a.key, b.key) : (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
		if (c) return c;
		return enCol.compare(fold(a.b.t), fold(b.b.t));
	}

	// ---- headings -----------------------------------------------------------

	// Latin author string -> catalogue heading ("Surname, Given") or null for a
	// title main entry (editors, translators, illegible).
	function latinHeading(a) {
		var s = a.trim().replace(/^Dr\.\s+/, '').replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\?+/g, '').trim();
		if (!s || TITLE_ENTRY_RE.test(s)) return null;
		if (KEEP.indexOf(s) >= 0) return s;
		var amp = s.split(/\s+&\s+/);
		if (amp.length === 2 && amp[0].split(/\s+/).length === 1 && amp[1].split(/\s+/).length >= 2 && amp[1].indexOf(',') < 0 && amp[1].indexOf('(') < 0) {
			var t2 = amp[1].split(/\s+/);
			return t2[t2.length - 1] + ', ' + amp[0] + ' & ' + t2.slice(0, -1).join(' ');
		}
		var cut = s.search(/,|;|\s&\s|\sand\s|\swith\s|\s\/\s|\set al/);
		var first = (cut >= 0 ? s.slice(0, cut) : s).trim();
		if (KEEP.indexOf(first) >= 0) return first;
		var tok = first.split(/\s+/);
		if (tok.length === 1 || /^the$/i.test(tok[0])) return first;
		if (SURNAME_FIRST.indexOf(first) >= 0) return tok[0] + ', ' + tok.slice(1).join(' ');
		return tok[tok.length - 1] + ', ' + tok.slice(0, -1).join(' ');
	}

	// Japanese author string -> {head, key, run} (run 1 = kana, 2 = 漢字), or
	// {latin: name} when the first-named creator is written in Latin letters.
	function jaHeading(a) {
		var s = a.trim();
		while (JA_ROLE_RE.test(s)) s = s.replace(JA_ROLE_RE, '');
		var cut = s.search(/\s*(\/|,|、|×|\(|\sほか|\s原作|\s監修|／)/);
		var tok = (cut >= 0 ? s.slice(0, cut) : s).replace(JA_TRAIL_RE, '').trim();
		if (!tok) tok = s;
		if (!hasCJK(tok)) return { latin: tok };
		var reading = null;
		var ch = tok.charAt(0);
		if (isKana(ch)) {
			if (/^[゠-ヿ・＝ー]+$/.test(tok) && tok.indexOf('・') > 0) {
				var segs = tok.split('・');
				reading = kanaKey(segs[segs.length - 1] + segs.slice(0, -1).join(''));
			} else reading = kanaKey(tok);
		} else {
			for (var n = Math.min(8, tok.length); n >= 1; n--) {
				var pre = tok.slice(0, n);
				if (READINGS[pre]) { reading = READINGS[pre] + kanaKey(tok.slice(n)); break; }
			}
		}
		if (reading) return { head: tok, key: reading, run: 1 };
		return { head: tok, key: tok, run: 2 };
	}

	function groupOf(entry) {
		if (entry.run === 0) {
			var c = entry.key.replace(/[^a-z0-9]/g, '').charAt(0);
			if (!c) return '#';
			return /\d/.test(c) ? '0-9' : c.toUpperCase();
		}
		if (entry.run === 1) return kanaRow(entry.key.charAt(0));
		return null;
	}

	// A title main entry (no author, or an editor/translator only).
	function titleEntry(b) {
		var head = stripArticle(b.t) || b.t;
		var e = { b: b, head: head, titleEntry: true, stmt: b.a || '' };
		fileByString(e, head);
		return e;
	}
	function fileByString(e, s) {
		var ch = s.charAt(0);
		if (isKana(ch)) { e.run = 1; e.key = kanaKey(s); }
		else if (isKanji(ch)) { e.run = 2; e.key = s; }
		else { e.run = 0; e.key = fold(s); }
		e.group = groupOf(e);
	}
	function authorEntry(b) {
		var a = (b.a || '').trim();
		if (!a) return titleEntry(b);
		var e;
		if (hasCJK(a)) {
			var j = jaHeading(a);
			if (j.latin) { var lh = latinHeading(j.latin); if (!lh) return titleEntry(b); e = { b: b, head: lh, stmt: a, run: 0, key: fold(lh) }; }
			else e = { b: b, head: j.head, stmt: a, run: j.run, key: j.key };
		} else {
			var h = latinHeading(a);
			if (!h) return titleEntry(b);
			e = { b: b, head: h, stmt: a, run: 0, key: fold(h) };
		}
		e.group = groupOf(e);
		return e;
	}
	function titleIndexEntry(b) {
		var e = authorEntry(b);
		var t = stripArticle(b.t) || b.t;
		var f = { b: b, head: t, titleHead: true, authorHead: e.titleEntry ? '' : e.head, stmt: b.a || '' };
		fileByString(f, t);
		return f;
	}

	// ---- drawers ------------------------------------------------------------

	var books = [], authorEntries = {};
	var index = 'author';
	var drawers = [];

	function labelFor(run, firstKey, lastKey, prevKey, nextKey) {
		function latin(k, n) { var s = k.replace(/[^a-z0-9]/g, ''); s = s.slice(0, n); return s.charAt(0).toUpperCase() + s.slice(1); }
		function distinct(x, y) {
			if (!x || !y) return 3;
			var a = x.replace(/[^a-z0-9]/g, ''), b = y.replace(/[^a-z0-9]/g, ''), i = 0;
			while (i < 5 && a.charAt(i) === b.charAt(i)) i++;
			return clamp(i + 1, 3, 5);
		}
		if (run === 0) {
			var l1 = latin(firstKey, distinct(prevKey, firstKey)), l2 = latin(lastKey, distinct(lastKey, nextKey));
			return l1 === l2 ? l1 : l1 + '–' + l2;
		}
		if (run === 1) { var k1 = firstKey.slice(0, 2), k2 = lastKey.slice(0, 2); return k1 === k2 ? k1 : k1 + '–' + k2; }
		var c1 = firstKey.charAt(0), c2 = lastKey.charAt(0);
		return c1 === c2 ? c1 : c1 + '–' + c2;
	}

	// Split one sorted run into drawers of about `target` cards, never cutting
	// a heading in two and preferring to cut at group (guide) boundaries.
	function chunkRun(entries, target, runName) {
		var out = [];
		if (!entries.length) return out;
		var cur = [];
		function close() {
			if (!cur.length) return;
			out.push({ entries: cur, run: cur[0].run, runName: runName });
			cur = [];
		}
		var i = 0;
		while (i < entries.length) {
			// take the next block: a whole heading at least, a whole group when it fits
			var j = i + 1;
			while (j < entries.length && entries[j].key === entries[i].key) j++;
			var gj = j;
			while (gj < entries.length && entries[gj].group === entries[i].group) gj++;
			var groupLen = gj - i, headLen = j - i;
			var room = target * 1.3 - cur.length;
			var take = groupLen <= room ? gj : (headLen <= room || cur.length === 0 ? j : i);
			if (take === i) { close(); continue; }
			for (var k = i; k < take; k++) cur.push(entries[k]);
			i = take;
			if (cur.length >= target) close();
		}
		close();
		// a tiny trailing drawer merges backward
		if (out.length > 1 && out[out.length - 1].entries.length < target * 0.3) {
			var tail = out.pop(); var prev = out[out.length - 1];
			prev.entries = prev.entries.concat(tail.entries);
		}
		out.forEach(function (d, i) {
			var es = d.entries, prev = out[i - 1], next = out[i + 1];
			d.label = labelFor(d.run, es[0].key, es[es.length - 1].key, prev ? prev.entries[prev.entries.length - 1].key : null, next ? next.entries[0].key : null);
		});
		return out;
	}

	function runsOf(entries) {
		var runs = [[], [], []];
		entries.forEach(function (e) { runs[e.run].push(e); });
		return runs;
	}

	function withGuides(entries, guideOf) {
		// insert guide cards at group changes; returns items {guide:true,label,count} | entry
		var items = [], lastG = undefined, gi = 0;
		entries.forEach(function (e, i) {
			var g = guideOf ? guideOf(e, i) : e.group;
			if (g != null && g !== lastG) {
				var n = 0; for (var k = i; k < entries.length && (guideOf ? guideOf(entries[k], k) : entries[k].group) === g; k++) n++;
				items.push({ guide: true, label: g, count: n, gi: gi++, first: entries.slice(i, i + 10) });
			}
			lastG = g;
			items.push(e);
		});
		return items;
	}

	function buildAuthorOrTitle(kind) {
		var entries = books.map(function (b) { return kind === 'title' ? titleIndexEntry(b) : authorEntries[b.id]; });
		entries.sort(cmpEntries);
		var runs = runsOf(entries);
		var out = [];
		chunkRun(runs[0], 30, 'A–Z').forEach(function (d) { out.push(d); });
		chunkRun(runs[1], 24, 'あ–ん').forEach(function (d) { out.push(d); });
		chunkRun(runs[2], 24, '漢字').forEach(function (d) { out.push(d); });
		out.forEach(function (d) { d.items = withGuides(d.entries); d.title = (kind === 'title' ? 'Title' : 'Author') + ' · ' + d.label; });
		return out;
	}

	function buildSubject() {
		var byG = {};
		books.forEach(function (b) { (byG[b.g] = byG[b.g] || []).push(authorEntries[b.id]); });
		return Object.keys(byG).sort(function (a, b) { return enCol.compare(a, b); }).map(function (g) {
			var es = byG[g].slice().sort(cmpEntries);
			var label = GENRE_SHORT[g] || g;
			return { entries: es, label: label, fullLabel: g, hue: GENRE_HUE[g], items: withGuides(es, function (e) { return e.run === 0 ? e.group : e.run === 1 ? 'かな' : '漢字'; }), title: 'Subject · ' + g, long: label.length > 12 };
		});
	}

	function buildShelf() {
		var out = [];
		UNITS.forEach(function (u) {
			u.shelves.forEach(function (sh, si) {
				var keys = typeof sh === 'string' ? [sh] : sh.keys, label = typeof sh === 'string' ? sh : sh.label;
				var es = books.filter(function (b) { return b.u === u.k && keys.indexOf(b.s) >= 0; }).map(function (b) { return authorEntries[b.id]; });
				es.sort(function (a, b) { return keys.indexOf(a.b.s) - keys.indexOf(b.b.s) || a.b.p - b.b.p; });
				out.push({ entries: es, label: label.replace(/\s*\(.*\)$/, ''), fullLabel: label, rail: si === 0 ? u : null, unit: u,
					items: withGuides(es, function (e) { var lo = Math.floor((e.b.p - 1) / 10) * 10 + 1; return lo + '–' + (lo + 9); }),
					title: u.name + ' · ' + label, long: label.length > 12 });
			});
		});
		return out;
	}

	function buildYear() {
		var periods = [{ label: 'BCE – 1499', lo: -Infinity, hi: 1499 }, { label: '1500s', lo: 1500, hi: 1599 }, { label: '1600s', lo: 1600, hi: 1699 },
			{ label: '1700s', lo: 1700, hi: 1799 }, { label: '1800 – 49', lo: 1800, hi: 1849 }, { label: '1850 – 99', lo: 1850, hi: 1899 }];
		for (var d = 1900; d <= 2020; d += 10) periods.push({ label: d + 's', lo: d, hi: d + 9 });
		periods.push({ label: 'Undated', lo: null });
		return periods.map(function (p) {
			var es = books.filter(function (b) { return p.lo === null ? b.y == null : (b.y != null && b.y >= p.lo && b.y <= p.hi); }).map(function (b) { return authorEntries[b.id]; });
			es.sort(function (a, b) { return (a.b.y || 0) - (b.b.y || 0) || cmpEntries(a, b); });
			var guide = p.lo === null ? null : function (e) {
				var y = e.b.y; if (y < 0) return 'BCE'; if (y < 1500) return (Math.floor(y / 100) + 1) + 'th c.'; if (y < 1900) return String(Math.floor(y / 10) * 10) + 's'; return String(y);
			};
			return { entries: es, label: p.label, items: withGuides(es, guide), title: 'Year · ' + p.label };
		});
	}

	function build() {
		if (index === 'author') drawers = buildAuthorOrTitle('author');
		else if (index === 'title') drawers = buildAuthorOrTitle('title');
		else if (index === 'subject') drawers = buildSubject();
		else if (index === 'shelf') drawers = buildShelf();
		else drawers = buildYear();
		drawers.forEach(function (d, i) { d.i = i; });
		renderCabinet();
	}

	// ---- cabinet DOM --------------------------------------------------------

	var grid = $('#grid'), tray = $('#tray'), box = $('#box'), stackEl = $('#stack'), cardsEl = $('#cards'), emptyEl = $('#empty');
	var trayName = $('#trayname'), posEl = $('#pos'), guidesEl = $('#guides'), contentsEl = $('#contents'), tip = $('#tip');
	var openDrawer = null, pos = 0, cardEls = [];

	function renderCabinet() {
		grid.innerHTML = '';
		var lastRun = null;
		drawers.forEach(function (d) {
			if (d.rail) {
				var r = el('div', 'rail'); r.innerHTML = '<span><b>' + esc(d.rail.k) + '</b> · ' + esc(d.rail.name) + '</span>'; grid.appendChild(r);
			} else if (d.runName && d.runName !== lastRun && (index === 'author' || index === 'title')) {
				var r2 = el('div', 'rail'); r2.innerHTML = '<span>' + esc(d.runName) + '</span>'; grid.appendChild(r2);
			}
			lastRun = d.runName;
			var b = el('button', 'drawer' + (d.hue != null ? ' hued' : '') + (d.entries.length ? '' : ' empty'));
			b.type = 'button'; b.setAttribute('role', 'listitem');
			b.style.setProperty('--grain', (hash(d.label) % 40) + 'px');
			if (d.hue != null) b.style.setProperty('--hue', d.hue);
			b.title = (d.fullLabel || d.label) + ' · ' + d.entries.length + (d.entries.length === 1 ? ' card' : ' cards') + (d.entries.length ? ' · ' + d.entries[0].head + ' … ' + d.entries[d.entries.length - 1].head : '');
			b.setAttribute('aria-label', 'Drawer ' + (d.fullLabel || d.label) + ', ' + d.entries.length + ' cards');
			b.innerHTML = '<span class="side l"></span><span class="side r"></span><span class="floor"></span><span class="top"></span>' +
				'<span class="front"><span class="hue"></span><span class="plate"><span class="label' + (d.long ? ' long' : '') + '"><span class="rng">' + esc(d.label) + '</span><span class="n">' + d.entries.length + '</span></span></span><span class="pull"></span><span class="badge"></span></span>';
			b.addEventListener('click', function () { if (!d.entries.length) return; if (openDrawer === d) closeDrawer(); else pull(d, 0, false); });
			d.el = b;
			grid.appendChild(b);
		});
	}

	function closeDrawer() {
		if (openDrawer) openDrawer.el.classList.remove('open');
		openDrawer = null; cardEls = []; cardsEl.innerHTML = ''; guidesEl.innerHTML = ''; contentsEl.innerHTML = '';
		emptyEl.style.display = ''; trayName.textContent = 'No drawer open'; posEl.textContent = '';
	}

	// Pull a drawer out and show its stack at item index `at` (riffling there if asked).
	function pull(d, at, riffle) {
		var wasOpen = openDrawer === d;
		if (!wasOpen) {
			if (openDrawer) openDrawer.el.classList.remove('open');
			openDrawer = d; d.el.classList.add('open');
			Sound.drawer();
			cardsEl.innerHTML = ''; cardEls = [];
			d.items.forEach(function (it, i) {
				var c = el('article', 'card ' + (it.guide ? 'guide' : hasCJK(it.b.t) ? 'ja' : 'lat') + ' off');
				c.dataset.i = i; c.setAttribute('aria-hidden', 'true');
				cardsEl.appendChild(c); cardEls.push(c);
			});
			emptyEl.style.display = 'none';
			trayName.innerHTML = '<b>' + esc(d.title) + '</b>';
			renderGuides(d); renderContents(d);
			if (window.innerWidth <= 980 && !thumb) tray.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' });
		}
		var target = clamp(at, 0, d.items.length - 1);
		if (!riffle || reducedMotion) { if (riffleTimer) { clearInterval(riffleTimer); riffleTimer = null; } pos = target; layout(false); return; }
		riffleTo(target, wasOpen);
	}

	var riffleTimer = null;
	function riffleTo(target, wasOpen) {
		if (riffleTimer) { clearInterval(riffleTimer); riffleTimer = null; }
		if (reducedMotion) { pos = target; layout(false); return; }
		if (!wasOpen) pos = Math.max(0, target - 7);
		else if (Math.abs(target - pos) > 9) pos = target - 7 * Math.sign(target - pos);
		layout(true);
		riffleTimer = setInterval(function () {
			if (pos === target) { clearInterval(riffleTimer); riffleTimer = null; stackEl.classList.remove('fast'); layout(false); return; }
			pos += Math.sign(target - pos);
			Sound.flip();
			layout(true);
		}, 70);
	}

	function step(n) {
		if (!openDrawer) return;
		var np = clamp(pos + n, 0, openDrawer.items.length - 1);
		if (np === pos) return;
		pos = np; Sound.flip(); layout(Math.abs(n) > 1);
	}
	function jump(i) { if (!openDrawer) return; pos = clamp(i, 0, openDrawer.items.length - 1); Sound.flip(); layout(false); }

	// Place every card of the open drawer relative to `pos`.
	function layout(fast) {
		if (!openDrawer) return;
		stackEl.classList.toggle('fast', !!fast);
		var items = openDrawer.items;
		for (var i = 0; i < cardEls.length; i++) {
			var c = cardEls[i], k = i - pos;
			var off = k > 14 || k < -4;
			c.classList.toggle('off', off);
			if (off) continue;
			if (!c.dataset.filled) fill(c, items[i], i);
			c.classList.toggle('cur', k === 0);
			c.classList.toggle('behind', k > 0);
			c.classList.toggle('flipped', k < 0);
			c.setAttribute('aria-hidden', k === 0 ? 'false' : 'true');
			if (k === 0) { c.style.transform = 'translate3d(0,-14px,26px) rotateX(10deg)'; c.style.opacity = 1; c.style.zIndex = 20; c.style.pointerEvents = 'auto'; }
			else if (k > 0) { c.style.transform = 'translate3d(0,' + (-k * 3) + 'px,' + (-k * 9) + 'px) rotateX(' + (12 + k * 0.6) + 'deg)'; c.style.opacity = 1; c.style.zIndex = 20 - k; c.style.pointerEvents = 'auto'; }
			else { c.style.transform = 'translate3d(0,8px,' + (40 - k * 8) + 'px) rotateX(-80deg)'; c.style.opacity = 0; c.style.zIndex = 30; c.style.pointerEvents = 'none'; }
		}
		var it = items[pos];
		var n = openDrawer.entries.length, bi = it.guide ? null : openDrawer.entries.indexOf(it) + 1;
		posEl.textContent = it.guide ? 'guide · ' + it.label : (bi + ' / ' + n);
		Array.prototype.forEach.call(guidesEl.children, function (g) { g.classList.toggle('on', +g.dataset.i === currentGuide(pos)); });
		if (contentsEl.classList.contains('show')) {
			var prev = contentsEl.querySelector('.cur'); if (prev) prev.classList.remove('cur');
			var cb = contentsEl.children[pos]; if (cb) { cb.classList.add('cur'); cb.scrollIntoView({ block: 'nearest' }); }
		}
	}
	function currentGuide(p) { var items = openDrawer.items; for (var i = p; i >= 0; i--) if (items[i].guide) return i; return -1; }

	function renderGuides(d) {
		guidesEl.innerHTML = '';
		d.items.forEach(function (it, i) {
			if (!it.guide) return;
			var b = el('button', '', it.label); b.type = 'button'; b.dataset.i = i; b.title = it.count + (it.count === 1 ? ' card' : ' cards');
			b.addEventListener('click', function () { jump(i); tray.focus({ preventScroll: true }); });
			guidesEl.appendChild(b);
		});
	}
	function renderContents(d) {
		contentsEl.innerHTML = '';
		d.items.forEach(function (it, i) {
			var b = el('button', it.guide ? 'g' : ''); b.type = 'button';
			if (it.guide) b.textContent = '▸ ' + it.label + ' (' + it.count + ')';
			else b.innerHTML = esc(it.head) + (it.titleHead || it.titleEntry ? '' : ' — ' + esc(it.b.t)) + (it.b.y != null ? '<span class="y">' + it.b.y + '</span>' : '');
			b.addEventListener('click', function () { jump(i); });
			contentsEl.appendChild(b);
		});
	}

	// ---- cards --------------------------------------------------------------

	function pencilFor(b) {
		var h = hash(b.id + '|pencil');
		var kind = h % 11;
		if (kind < 5) return '';
		if (kind === 5) return '<span class="pencil tr">copy 2</span>';
		if (kind === 6) {
			var months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
			var h2 = hash(b.id + '|stamp');
			return '<span class="stamp">' + months[h2 % 12] + ' ' + (1 + (h2 >> 4) % 28) + ' ' + (1961 + (h2 >> 9) % 49) + '</span>';
		}
		if (kind === 7) return '<span class="tick">✓</span>';
		if (kind === 8) return '<span class="pencil br">acc. ' + (1000 + (h >> 5) % 9000) + '</span>';
		if (kind === 9) return '<span class="pencil tr">gift</span>';
		return '<span class="pencil br">recat.</span>';
	}

	function callNo(b) {
		var sh = String(b.s).replace(/\s*\(.*\)$/, '').replace(/\s+/g, '').slice(0, 6);
		return '<span class="callno" title="' + esc(b.id) + '"><span>' + esc(b.u) + '</span><span>' + esc(sh) + '</span><span>' + b.p + '</span></span>';
	}
	function fill(c, it, i) {
		c.dataset.filled = '1';
		if (it.guide) {
			var slot = it.gi % 5;
			c.innerHTML = '<span class="tab' + (it.label.length > 4 ? ' long' : '') + '" style="left:' + (slot * 20 + 0.5) + '%">' + esc(it.label) + '</span>' +
				'<div class="gbig">' + esc(it.label) + '</div><div class="gsub">' + it.count + (it.count === 1 ? ' card' : ' cards') + '<ul>' +
				it.first.map(function (e) { return '<li>' + esc(e.head) + '</li>'; }).join('') + (it.count > 10 ? '<li>…</li>' : '') + '</ul></div><span class="hole"></span>';
			return;
		}
		var b = it.b, u = UNIT_BY_KEY[b.u];
		var hue = GENRE_HUE[b.g] != null ? GENRE_HUE[b.g] : 40;
		c.style.setProperty('--hue', hue);
		var link = '<a href="' + BOOK_URL + encodeURIComponent(b.id) + '">' + esc(b.t) + '</a>';
		var tracings = '<p class="tracings"><i></i>1. ' + esc(b.g) + '. 2. ' + esc(b.ty) + '. 3. ' + esc(langName(b.l)) + '.' + (it.titleEntry || it.titleHead ? '' : ' I. Title.') + (b.free ? ' II. E-text (' + esc(b.free.src) + ').' : '') + '</p>';
		var year = b.yr || (b.y != null ? String(b.y) : 'n.d.');
		if (hasCJK(b.t)) {
			var head = it.titleHead ? (it.authorHead || '') : it.head;
			c.innerHTML = callNo(b) + '<div class="vbody">' +
				(it.titleHead ? '<p class="ttl">' + link + '</p>' + (head ? '<p class="heading">' + esc(head) + '</p>' : '') : '<p class="heading">' + esc(it.head) + '</p><p class="ttl">' + link + '</p>') +
				(it.stmt && it.stmt !== it.head && !(it.titleHead && it.stmt === it.authorHead) ? '<p class="imp">' + esc(it.stmt) + '</p>' : '') +
				'<p class="imp">' + esc(b.pub ? b.pub + '、' : '') + esc(year) + '</p>' +
				'<p class="phys">' + esc(u ? u.name : b.u) + '、' + esc(b.s) + '、' + b.p + '番</p>' +
				(b.d ? '<p class="note">' + esc(b.d) + '</p>' : '') + '</div>' + tracings + pencilFor(b) + '<span class="hole"></span>';
			return;
		}
		var heading, ttl;
		if (it.titleHead) {
			heading = '<p class="heading">' + link + '</p>';
			ttl = it.stmt ? '<p class="ttl">/ ' + esc(it.stmt) + '.</p>' : '';
		} else if (it.titleEntry) {
			heading = '<p class="heading">' + link + '</p>';
			ttl = it.stmt ? '<p class="ttl">/ ' + esc(it.stmt) + '.</p>' : '';
		} else {
			heading = '<p class="heading">' + esc(it.head) + '.</p>';
			ttl = '<p class="ttl">' + link + ' / ' + esc(it.stmt) + '.</p>';
		}
		c.innerHTML = '<div class="rules"></div>' + callNo(b) + '<div class="body">' + heading + ttl +
			'<p class="imp">' + esc(b.pub ? b.pub + ', ' : '') + esc(year) + '.</p>' +
			'<p class="phys">1 v. ; ' + esc(u ? u.name : b.u) + ', shelf ' + esc(b.s) + ', no. ' + b.p + '.</p>' +
			(b.d ? '<p class="note">' + esc(b.d) + '</p>' : '') + '</div>' + tracings + pencilFor(b) + '<span class="hole"></span>';
	}

	// ---- search -------------------------------------------------------------

	var qInput = $('#q'), hitsEl = $('#hits'), prevBtn = $('#prev'), nextBtn = $('#next');
	var matches = [], matchAt = -1, typedDrawer = null, typeTimer = null, searchTimer = null;

	function restoreLabel() {
		if (typeTimer) { clearInterval(typeTimer); typeTimer = null; }
		if (typedDrawer) { typedDrawer.el.querySelector('.rng').textContent = typedDrawer.label; typedDrawer.el.classList.remove('typing'); typedDrawer = null; }
	}
	function typeInto(d, text, done) {
		restoreLabel();
		typedDrawer = d; d.el.classList.add('typing');
		var rng = d.el.querySelector('.rng');
		if (reducedMotion || thumb) { rng.innerHTML = esc(text) + '<span class="caret"></span>'; done(); return; }
		var i = 0;
		rng.innerHTML = '<span class="caret"></span>';
		typeTimer = setInterval(function () {
			i++;
			rng.innerHTML = esc(text.slice(0, i)) + '<span class="caret"></span>';
			if (i >= text.length) { clearInterval(typeTimer); typeTimer = null; done(); }
		}, 45);
	}
	function search(q) {
		var fq = fold(q).trim();
		matches = []; matchAt = -1;
		drawers.forEach(function (d) { d.el.classList.remove('hit'); });
		if (!fq) { restoreLabel(); hitsEl.textContent = ''; prevBtn.disabled = nextBtn.disabled = true; return; }
		drawers.forEach(function (d) {
			var n = 0;
			d.items.forEach(function (it, i) {
				if (it.guide) return;
				var b = it.b;
				if (fold(b.t).indexOf(fq) >= 0 || fold(b.a).indexOf(fq) >= 0 || fold(it.head).indexOf(fq) >= 0 || b.id.toLowerCase() === fq) { matches.push({ d: d, i: i }); n++; }
			});
			if (n) { d.el.classList.add('hit'); d.el.querySelector('.badge').textContent = n; }
		});
		prevBtn.disabled = nextBtn.disabled = matches.length < 2;
		if (!matches.length) { restoreLabel(); hitsEl.textContent = 'no cards'; return; }
		goMatch(0, q);
	}
	function goMatch(mi, q) {
		matchAt = (mi + matches.length) % matches.length;
		var m = matches[matchAt];
		hitsEl.textContent = (matchAt + 1) + ' of ' + matches.length;
		typeInto(m.d, q || qInput.value.trim(), function () { pull(m.d, m.i, true); });
	}
	qInput.addEventListener('input', function () {
		clearTimeout(searchTimer);
		searchTimer = setTimeout(function () { search(qInput.value); }, 160);
	});
	qInput.addEventListener('keydown', function (e) {
		if (e.key === 'Enter') { e.preventDefault(); if (matches.length) goMatch(matchAt + (e.shiftKey ? -1 : 1)); }
		if (e.key === 'Escape') { qInput.value = ''; search(''); }
	});
	nextBtn.addEventListener('click', function () { if (matches.length) goMatch(matchAt + 1); });
	prevBtn.addEventListener('click', function () { if (matches.length) goMatch(matchAt - 1); });

	// ---- navigation ---------------------------------------------------------

	$('#back').addEventListener('click', function () { step(-1); });
	$('#fwd').addEventListener('click', function () { step(1); });
	$('#list').addEventListener('click', function () {
		var on = contentsEl.classList.toggle('show'); this.setAttribute('aria-pressed', on ? 'true' : 'false'); this.classList.toggle('on', on);
		if (on) layout(false);
	});
	var wheelAt = 0;
	box.addEventListener('wheel', function (e) {
		if (!openDrawer) return;
		e.preventDefault();
		var now = Date.now(); if (now - wheelAt < 70) return; wheelAt = now;
		step((e.deltaY || e.deltaX) > 0 ? 1 : -1);
	}, { passive: false });
	var drag = null;
	box.addEventListener('pointerdown', function (e) {
		if (!openDrawer || e.button) return;
		drag = { x: e.clientX, y: e.clientY, moved: false };
		box.setPointerCapture(e.pointerId);
	});
	box.addEventListener('pointermove', function (e) {
		if (!drag) return;
		var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
		var d = Math.abs(dx) > Math.abs(dy) ? dx : -dy; // drag left or drag up = next
		if (Math.abs(d) > 34) { step(d < 0 ? 1 : -1); drag.x = e.clientX; drag.y = e.clientY; drag.moved = true; }
	});
	box.addEventListener('pointerup', function (e) {
		if (!drag) return;
		var moved = drag.moved; drag = null;
		if (moved) return;
		var card = e.target.closest && e.target.closest('.card.behind');
		if (card) jump(+card.dataset.i);
	});
	box.addEventListener('pointercancel', function () { drag = null; });
	box.addEventListener('click', function (e) { if (e.target.closest && e.target.closest('.card.behind') && e.target.tagName === 'A') e.preventDefault(); });
	document.addEventListener('keydown', function (e) {
		if (e.target === qInput || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
		if (!openDrawer) return;
		var map = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1, PageDown: 10, PageUp: -10 };
		if (e.key in map) { e.preventDefault(); step(map[e.key]); }
		else if (e.key === 'Home') { e.preventDefault(); jump(0); }
		else if (e.key === 'End') { e.preventDefault(); jump(openDrawer.items.length - 1); }
		else if (e.key === 'Escape') closeDrawer();
	});

	// tooltip on the card edges behind the current one
	box.addEventListener('mouseover', function (e) {
		var card = e.target.closest && e.target.closest('.card.behind');
		if (!card || !openDrawer) { tip.style.display = 'none'; return; }
		var it = openDrawer.items[+card.dataset.i];
		if (it.guide) tip.innerHTML = '<b>Guide · ' + esc(it.label) + '</b><br>' + it.count + ' cards';
		else {
			var b = it.b, u = UNIT_BY_KEY[b.u];
			tip.innerHTML = '<b>' + esc(b.t) + '</b><br>' + esc(b.a || '—') + ' · ' + (b.y != null ? b.y : 'n.d.') + ' · ' + esc((u ? u.name : b.u) + ' / ' + b.s);
		}
		tip.style.display = 'block';
	});
	box.addEventListener('mousemove', function (e) {
		if (tip.style.display !== 'block') return;
		var x = e.clientX + 14, y = e.clientY + 16;
		if (x + 300 > window.innerWidth) x = e.clientX - 310;
		if (y + 60 > window.innerHeight) y = e.clientY - 60;
		tip.style.left = x + 'px'; tip.style.top = y + 'px';
	});
	box.addEventListener('mouseleave', function () { tip.style.display = 'none'; });

	// index switch
	$('#indexes').addEventListener('click', function (e) {
		var b = e.target.closest('button'); if (!b || b.dataset.index === index) return;
		Array.prototype.forEach.call(this.children, function (x) { x.classList.toggle('on', x === b); x.setAttribute('aria-selected', x === b ? 'true' : 'false'); });
		index = b.dataset.index;
		restoreLabel(); closeDrawer(); build();
		if (qInput.value.trim()) search(qInput.value);
	});

	// print: lay the open drawer out as 3×5 cards on a sheet (print stylesheet)
	function buildSheet() {
		var sheet = $('#printsheet'); sheet.innerHTML = '';
		sheet.appendChild(el('h2', '', 'Card Catalog · ' + openDrawer.title + ' · ' + openDrawer.entries.length + ' cards'));
		openDrawer.items.forEach(function (it, i) {
			var c = el('article', 'card ' + (it.guide ? 'guide' : hasCJK(it.b.t) ? 'ja' : 'lat'));
			fill(c, it, i); sheet.appendChild(c);
		});
	}
	$('#print').addEventListener('click', function () {
		if (!openDrawer) { qInput.focus(); return; }
		buildSheet();
		window.print();
	});
	window.addEventListener('afterprint', function () { $('#printsheet').innerHTML = ''; });

	// card size follows the tray width
	function size() {
		var w = box.clientWidth - 36;
		tray.style.setProperty('--cardw', Math.max(240, Math.min(470, w)) + 'px');
	}
	window.addEventListener('resize', size);

	// ---- sound (off by default) ---------------------------------------------

	var Sound = (function () {
		var ctx = null, on = false, noise = null;
		function ensure() {
			if (ctx) return;
			var AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
			ctx = new AC();
			var len = ctx.sampleRate * 1.2, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
			for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
			noise = buf;
		}
		function burst(opts) {
			if (!on || !ctx) return;
			var t = ctx.currentTime;
			var src = ctx.createBufferSource(); src.buffer = noise;
			var f = ctx.createBiquadFilter(); f.type = opts.type; f.frequency.value = opts.freq; f.Q.value = opts.q || 0.8;
			var g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t);
			g.gain.exponentialRampToValueAtTime(opts.gain, t + opts.attack);
			g.gain.exponentialRampToValueAtTime(0.0001, t + opts.len);
			src.connect(f); f.connect(g); g.connect(ctx.destination);
			src.start(t); src.stop(t + opts.len + 0.05);
		}
		function thunk(when) {
			if (!on || !ctx) return;
			var t = ctx.currentTime + when;
			var o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(60, t + 0.12);
			var g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
			o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + 0.2);
		}
		return {
			toggle: function () { on = !on; if (on) { ensure(); if (ctx && ctx.state === 'suspended') ctx.resume(); } return on; },
			drawer: function () { burst({ type: 'bandpass', freq: 700, q: 0.6, gain: 0.18, attack: 0.12, len: 0.5 }); thunk(0.42); },
			flip: function () { burst({ type: 'highpass', freq: 2200, q: 0.7, gain: 0.09, attack: 0.006, len: 0.05 }); },
		};
	})();
	$('#sound').addEventListener('click', function () {
		var on = Sound.toggle();
		this.textContent = 'Sound: ' + (on ? 'on' : 'off'); this.classList.toggle('on', on); this.setAttribute('aria-pressed', on ? 'true' : 'false');
		if (on) Sound.drawer();
	});

	// ---- boot ---------------------------------------------------------------

	function boot(data) {
		books = (data.books || []).slice();
		books.forEach(function (b) { authorEntries[b.id] = authorEntry(b); });
		$('header .sub').textContent = 'The library as an oak card catalogue: ' + fmt(books.length) + ' typed cards in drawers. Pull one.';
		size();
		// ?index=shelf&open=3&at=5 or ?q=... deep-link a state (also how the page is tested)
		var params = new URLSearchParams(location.search);
		if (/^(author|title|subject|shelf|year)$/.test(params.get('index') || '')) {
			index = params.get('index');
			Array.prototype.forEach.call($('#indexes').children, function (x) { x.classList.toggle('on', x.dataset.index === index); });
		}
		build();
		if (params.get('open') != null && drawers[+params.get('open')]) pull(drawers[+params.get('open')], +(params.get('at') || 0), false);
		if (params.get('q')) { qInput.value = params.get('q'); search(qInput.value); }
		if (params.get('print') && openDrawer) buildSheet();
		if (thumb) {
			document.body.classList.add('thumb');
			$('#hint').style.display = 'none';
			var hit = null;
			drawers.some(function (d) { return d.items.some(function (it, i) { if (!it.guide && /murakami, haruki/.test(fold(it.head))) { hit = { d: d, i: i }; return true; } return false; }); });
			if (!hit) hit = { d: drawers[Math.floor(drawers.length / 3)], i: 1 };
			pull(hit.d, hit.i, false);
		}
	}

	window.CardCatalog = { authorEntry: authorEntry, titleIndexEntry: titleIndexEntry, latinHeading: latinHeading, jaHeading: jaHeading, boot: boot,
		setIndex: function (i) { index = i; build(); return drawers; } };
	if (window.__noFetch) return;
	fetch(DATA_URL).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }).then(boot).catch(function (err) {
		$('#warn').style.display = 'block';
		$('#warn').textContent = 'The catalogue could not be loaded (' + err.message + '). Open this page from the site, not from a file.';
		trayName.textContent = 'Catalogue unavailable';
	});
})();
