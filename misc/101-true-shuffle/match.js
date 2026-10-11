/*
 * True Shuffle: is this the same song? Matching across scripts, spellings
 * and uploads.
 *
 * A song reaches the page from many places: the library (a YouTube upload
 * with a parsed or labelled title), the free music services (clean titles,
 * often in another script), and YouTube's searches and lists (raw upload
 * titles). This file says when two of them are the same song, when they are
 * the same recording, and which upload of a song to play.
 *
 *     var M = TrueShuffle.match;
 *     M.sameSong(track, find)              -> { score, why, same, sameRecording }
 *     M.inLibrary(M.index(tracks), find)   -> { id, score, why, sameRecording } | null
 *     M.bestVideo(videos, find)            -> { video, score, why, alts } | null
 *     M.query(find)                        -> 'Paper Lanterns Blue Signal'
 *
 * Evidence adds up to a score, and SAME (5) is the bar: an equal title (4)
 * by an artist known to be another (-3) stays far below it. Kana are read
 * as Hepburn romaji, so a katakana title meets its romaji spelling; kanji
 * are never romanised, so a kanji title matches the same kanji or the
 * song's titleAlt.
 *
 * The source is plain ASCII: every other character is written as an escape,
 * and the kana table is one string of romaji in code point order.
 *
 * UMD: window.TrueShuffle.match in the browser (after parse.js and
 * library.js), module.exports in Node. Pure: no DOM, no network, no clock.
 */
(function (root, factory) {
	var node = typeof module === 'object' && module.exports;
	var api = factory(root,
		function () { return node ? require('./parse.js') : (root.TrueShuffle || {}).parse; },
		function () { return node ? require('./library.js') : (root.TrueShuffle || {}).library; });
	if (node) module.exports = api;
	else { root.TrueShuffle = root.TrueShuffle || {}; root.TrueShuffle.match = api; }
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this), function (root, getParse, getLibrary) {
	'use strict';

	var SAME = 5;           // sameSong: the same song from here up
	var STRONG = 7;         // sure enough to act on without asking
	var MIN_VIDEO = 5;      // bestVideo: the least score an upload needs

	var YT_ID = /^[A-Za-z0-9_-]{11}$/;
	var OWN = Object.prototype.hasOwnProperty;

	function has(map, k) { return OWN.call(map, k); }
	function str(v) { return v == null ? '' : String(v); }
	// Non-empty, each once, first seen first.
	function uniq(list) {
		var out = [], seen = {};
		for (var i = 0; i < list.length; i++) {
			var k = list[i];
			if (k && !has(seen, '#' + k)) { seen['#' + k] = true; out.push(k); }
		}
		return out;
	}
	// A string function that remembers its answers (20,000 at most, then it
	// starts again). The answers are only read, never changed, so the
	// functions stay pure; a library rebuilt after a change costs little.
	function memo(fn) {
		var cache = {}, size = 0;
		return function (s) {
			var k = '#' + s;
			if (has(cache, k)) return cache[k];
			if (size >= 20000) { cache = {}; size = 0; }
			size++;
			return (cache[k] = fn(s));
		};
	}

	// ---- Folding -----------------------------------------------------------------

	// A comparison key, the same as discover.js norm: no case, no accents, no
	// spaces or punctuation, "&" read as "and", a leading "the" dropped;
	// letters and digits of every script stay. NFKD also takes the sound
	// marks off kana (ga folds to ka), so romaji() always reads a text before
	// it is folded, never a key.
	function fold(s) {
		return str(s).normalize('NFKC').normalize('NFKD').replace(/[\u0300-\u036F]/g, '').toLowerCase()
			.replace(/&/g, ' and ').replace(/^\s*the\s+/, '').replace(/[^\p{L}\p{N}]+/gu, '');
	}

	// Katakana to hiragana. Everything else is left as it is.
	function kana(s) {
		return str(s).replace(/[\u30A1-\u30F6]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0x60); });
	}

	// ---- Kana to romaji (Hepburn) --------------------------------------------------

	// The reading of each hiragana from U+3041 to U+3096, in code point order.
	// Small kana carry their full-size reading; the small tsu ('-') is
	// handled by the loop in romaji(). The particle wo is written o, as
	// modern Hepburn writes it.
	var HIRA0 = 0x3041;
	var TABLE = ('a a i i u u e e o o ka ga ki gi ku gu ke ge ko go ' +
		'sa za shi ji su zu se ze so zo ta da chi ji - tsu zu te de to do ' +
		'na ni nu ne no ha ba pa hi bi pi fu bu pu he be pe ho bo po ' +
		'ma mi mu me mo ya ya yu yu yo yo ra ri ru re ro wa wa i e o n vu ka ke').split(' ');
	// The small vowels and the small ya, yu and yo, by code point.
	var SMALL_VOWEL = {}, SMALL_Y = {};
	[[0x3041, 'a'], [0x3043, 'i'], [0x3045, 'u'], [0x3047, 'e'], [0x3049, 'o']].forEach(function (p) { SMALL_VOWEL[p[0]] = p[1]; });
	[[0x3083, 'a'], [0x3085, 'u'], [0x3087, 'o']].forEach(function (p) { SMALL_Y[p[0]] = p[1]; });
	var SMALL_TSU = 0x3063, SMALL_WA = 0x308E, LONG_MARK = 0x30FC;
	// The kana a voiced iteration mark can voice: the k, s, t and h rows,
	// whose voiced kana is the next code point.
	var VOICEABLE = {};
	[0x304B, 0x304D, 0x304F, 0x3051, 0x3053, 0x3055, 0x3057, 0x3059, 0x305B, 0x305D, 0x305F, 0x3061, 0x3064, 0x3066, 0x3068,
		0x306F, 0x3072, 0x3075, 0x3078, 0x307B].forEach(function (c) { VOICEABLE[c] = true; });

	// A syllable and a small ya, yu or yo: kya, sha, cha, ja; tyu, dyu, fyu.
	function joinY(last, v) {
		if (last.length < 2) return '';
		if (/^(?:sh|ch|j)i$/.test(last)) return last.slice(0, -1) + v;
		return last.slice(0, -1) + 'y' + v;
	}
	// A syllable and a small vowel: the loanword sounds (fa, ti, di, tu, wi,
	// va, she, che, je, kwa, ye), or the same vowel drawn out (kaa, nee).
	function joinVowel(last, v) {
		if (last.length === 1) {
			if (last === 'u' && v !== 'u') return 'w' + v;
			if (last === 'i' && v === 'e') return 'ye';
			return '';
		}
		if (last.slice(-1) === v) return '';
		if (last === 'ku' || last === 'gu') return last.charAt(0) + 'w' + v;
		if (last.slice(-1) === 'i' && v === 'e') {
			var stem = last.slice(0, -1);
			return /^(?:sh|ch|j)$/.test(stem) ? stem + 'e' : stem + 'ye';
		}
		return last.slice(0, -1) + v;
	}

	// Hiragana and katakana to Hepburn romaji in lower case; every other
	// character is kept. Digraphs (kya, sha, cha, ja), loanword sounds (fa,
	// ti, di, wi, va, she, che, je), the small tsu doubling the next
	// consonant (tch before chi), the long mark repeating the vowel, and n
	// before a vowel or y written plain n.
	function romaji(s) {
		s = str(s);
		if (!/[\u3041-\u30FF\uFF66-\uFF9F]/.test(s)) return s;
		s = s.replace(/[\uFF61-\uFF9F]+/g, function (m) { return m.normalize('NFKC'); });   // half-width katakana
		if (/[\u3099\u309A]/.test(s)) s = s.normalize('NFC');                              // a combining sound mark onto its kana
		s = kana(s);
		var out = '', last = '', lastCode = 0, tsu = false;
		function put(r, code) {
			if (tsu) {
				if (r.slice(0, 2) === 'ch') out += 't';
				else if (/^[bcdfghjkmpqrstvwyz]/.test(r)) out += r.charAt(0);
				tsu = false;
			}
			out += r;
			last = r;
			lastCode = code || 0;
		}
		function swap(r) { out = out.slice(0, out.length - last.length) + r; last = r; }
		for (var i = 0; i < s.length; i++) {
			var c = s.charCodeAt(i), r;
			if (c >= HIRA0 && c <= 0x3096) {
				if (c === SMALL_TSU) { tsu = true; continue; }
				if (has(SMALL_Y, c) && last) { r = joinY(last, SMALL_Y[c]); if (r) { swap(r); continue; } }
				if (has(SMALL_VOWEL, c) && last) { r = joinVowel(last, SMALL_VOWEL[c]); if (r) { swap(r); continue; } }
				if (c === SMALL_WA && (last === 'ku' || last === 'gu')) { swap(last.charAt(0) + 'wa'); continue; }
				put(TABLE[c - HIRA0], c);
				continue;
			}
			if (c === LONG_MARK) {
				var lv = last.slice(-1);
				tsu = false;
				if (lv && 'aiueo'.indexOf(lv) >= 0) { out += lv; last = lv; lastCode = 0; }
				continue;
			}
			if (c === 0x309D || c === 0x309E || c === 0x30FD || c === 0x30FE) {        // iteration marks
				if (lastCode) {
					var code = lastCode;
					if ((c === 0x309E || c === 0x30FE) && has(VOICEABLE, code)) code++;
					else if ((c === 0x309D || c === 0x30FD) && has(VOICEABLE, code - 1) && TABLE[code - HIRA0] !== TABLE[code - 1 - HIRA0]) code--;
					put(TABLE[code - HIRA0], lastCode);
				}
				continue;
			}
			if (c === 0x309F) { put('yori'); continue; }
			if (c === 0x30FF) { put('koto'); continue; }
			if (c >= 0x30F7 && c <= 0x30FA) { put(['va', 'vi', 've', 'vo'][c - 0x30F7]); continue; }
			// anything else ends the run of kana; a small tsu before it is dropped
			tsu = false; last = ''; lastCode = 0;
			out += s.charAt(i);
		}
		return out;
	}

	// ---- Romanisation styles folded together ------------------------------------------

	// fold(), then the spellings romanisations disagree on made one: long
	// vowels (ou, oo, oh before a consonant or at the end, uu, aa, ii, ee,
	// ei: one vowel),
	// the particle wo (o), Hepburn against Kunrei (shi si, chi ti, tsu tu,
	// fu hu, ji zi, then sh sy, ch ty, j zy), m before b, p or m (n), and the
	// small tsu before ch typed as cch (tch).
	function loose(s) {
		var t = fold(s), before, guard = 0;
		if (!t) return '';
		t = t.replace(/cch/g, 'tch');
		do {
			before = t;
			t = t.replace(/([aiueo])\1+/g, '$1').replace(/ou/g, 'o').replace(/ei/g, 'e').replace(/oh(?![aiueoy])/g, 'o').replace(/wo/g, 'o');
		} while (t !== before && ++guard < 8);
		t = t.replace(/shi/g, 'si').replace(/chi/g, 'ti').replace(/tsu/g, 'tu').replace(/fu/g, 'hu').replace(/ji/g, 'zi');
		t = t.replace(/sh/g, 'sy').replace(/ch/g, 'ty').replace(/j/g, 'zy');
		return t.replace(/m(?=[bpm])/g, 'n');
	}

	var KANA_RE = /[\u3041-\u3096\u309D-\u309F\u30A1-\u30FA\u30FC-\u30FF\uFF66-\uFF9D]/;
	var JP_RE = /[\u3041-\u3096\u30A1-\u30FA\u30FC\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uFF66-\uFF9D]/;
	var HAN_ONE = /^[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]$/;
	// The loose key of a title or a name, its kana read as romaji first.
	var lkMemo = memo(function (s) { return KANA_RE.test(s) ? loose(romaji(kana(s))) : loose(s); });
	function lk(s) { return lkMemo(str(s)); }
	// Keys of one character say too little, except one kanji, which is a word.
	function keyOk(k) { return k.length >= 2 || HAN_ONE.test(k); }

	// ---- The song's own title ------------------------------------------------------

	var DASH = '\\-\\u2010-\\u2015\\u2212';
	var LENT_ALL = /[\u3010\u3014]([^\u3010\u3011\u3014\u3015]*)[\u3011\u3015]/g;
	var BRACKET = /\(([^()]*)\)|\[([^\[\]]*)\]/g;
	var DASH_TAIL = new RegExp('^(.*\\S)\\s+[' + DASH + ']{1,2}\\s+(\\S.*)$');
	var DECORATED = new RegExp('^(.*\\S)\\s+[' + DASH + ']([^' + DASH + ']{1,60})[' + DASH + ']\\s*$');
	var FEAT_BARE = /^(.*?\S)\s+(?:feat\.?|featuring|ft\.?)\s+\S.*$/i;
	var COVERED_BARE = /^(.*?\S)\s+(?:covered|cover(?:ed)?\s+by)\s+\S.*$/i;
	var TRAIL_CAPS = /^(.*\S)\s+(?:MV|M\/V|PV|HD|HQ|4K)$/;
	var TRAIL_WORDS = /^(.*\S)\s+(?:official\s+(?:music\s+|lyrics?\s+)?(?:video|audio|mv|pv)|music\s+video|lyrics?\s+video|lyrics|full\s+(?:ver\.?|version|size)|(tv\s*(?:size|ver\.?|version|edit))|(short\s*(?:ver\.?|version)))$/i;
	// A wave dash or tilde subtitle, "Title ~Subtitle~", and one left open.
	var SUBTITLE = /^(.*?)(\s*)([~\u301C])([^~\u301C]+)[~\u301C](.*)$/;
	var SUBTITLE_OPEN = /^(.*\S)(?:\s+[~\u301C]\s*|\u301C)([^~\u301C]+)$/;
	var WRAP = { '\u300C': '\u300D', '\u300E': '\u300F', '\u300A': '\u300B', '\u201C': '\u201D', '"': '"', '~': '~', '\u301C': '\u301C' };
	var SEPS = new RegExp('^[\\s' + DASH + '|/:~,\\u30FB\\u301C]+|[\\s' + DASH + '|/:~,\\u30FB\\u301C]+$', 'g');
	// A bracket that names the song's place in a show: OP, ED2, NCOP, Opening,
	// Ending, a theme or insert song (in Japanese too: opening, ending,
	// shudaika "theme song", sounyuuka "insert song"). OP and ED only in
	// capitals, so "Op. 9" stays.
	var ROLE_CAPS = /(?:^|[^A-Za-z])(?:NC)?(?:OP|ED)(?:\s*\d+)?(?![A-Za-z])/;
	var ROLE_WORDS = /\b(?:opening|ending)\b|\b(?:theme|insert)\s+song\b|\u30AA\u30FC\u30D7\u30CB\u30F3\u30B0|\u30A8\u30F3\u30C7\u30A3\u30F3\u30B0|\u4E3B\u984C\u6B4C|\u633F\u5165\u6B4C/i;
	// Japanese medium words parse.js does not drop: saizu (size), furu (full),
	// shooto (short), ofubookaru (off vocal), boukaru (vocal), insuto
	// (instrumental), karaoke, kashi (lyrics), jimaku (subtitles), koushiki
	// (official), kouonshitsu (high sound quality).
	var MEDIUM_JP = /\u30B5\u30A4\u30BA|\u30D5\u30EB|\u30B7\u30E7\u30FC\u30C8|\u30AA\u30D5\u30DC\u30FC\u30AB\u30EB|\u30DC\u30FC\u30AB\u30EB|\u30A4\u30F3\u30B9\u30C8|\u30AB\u30E9\u30AA\u30B1|\u6B4C\u8A5E|\u5B57\u5E55|\u516C\u5F0F|\u9AD8\u97F3\u8CEA/;
	var TV_JP = /tv\s*(?:\u30B5\u30A4\u30BA|ver)/i;
	var SHORT_JP = /\u30B7\u30E7\u30FC\u30C8/;
	var OFF_VOCAL_JP = /\u30AA\u30D5\u30DC\u30FC\u30AB\u30EB|\u30DC\u30FC\u30AB\u30EB\u30AA\u30D5/;

	// What one bracket or tail is: { drop, kinds } (kinds as parse.js names them).
	function groupInfo(text) {
		var t = str(text).trim(), out = { drop: false, kinds: [] };
		if (!t) { out.drop = true; return out; }
		var c = getParse().classifyGroup(t);
		if (c.kind) out.drop = true;
		if (c.kind === 'version') out.kinds = c.kinds.slice();
		function kind(k) { out.drop = true; if (out.kinds.indexOf(k) < 0) out.kinds.push(k); }
		if (TV_JP.test(t)) kind('tv-size');
		if (SHORT_JP.test(t)) kind('short');
		if (OFF_VOCAL_JP.test(t)) kind('instrumental');
		if (ROLE_CAPS.test(t) || ROLE_WORDS.test(t) || MEDIUM_JP.test(t)) out.drop = true;
		return out;
	}

	// The title without its decoration, and the versions the decoration named:
	// { base, kinds } (remembered: read it, never change it).
	var stripMemo = memo(stripText);
	function strip(s) { return stripMemo(str(s)); }
	function stripText(s) {
		var t = getParse().tidy(s), kinds = [];
		if (!t) return { base: '', kinds: [] };
		var orig = t, before, guard = 0, m, info;
		function note(i) { i.kinds.forEach(function (k) { if (kinds.indexOf(k) < 0) kinds.push(k); }); }
		function squeeze(x) { return x.replace(/\s+/g, ' ').trim(); }
		t = squeeze(t.replace(LENT_ALL, function (all, inner) { note(groupInfo(inner)); return ' '; }));
		do {
			before = t;
			t = squeeze(t.replace(BRACKET, function (all, a, b) {
				var i = groupInfo(a != null ? a : b);
				if (!i.drop) return all;
				note(i);
				return ' ';
			}));
			if ((m = DECORATED.exec(t)) && (info = groupInfo(m[2])).drop) { note(info); t = m[1].trim(); }
			// a tail with separators of its own holds more than decoration ("Title / THE FIRST TAKE")
			if ((m = DASH_TAIL.exec(t)) && !/[|\/]/.test(m[2]) && (info = groupInfo(m[2])).drop) { note(info); t = m[1].trim(); }
			if ((m = FEAT_BARE.exec(t)) && !/\d$/.test(m[1])) t = m[1].trim();
			if ((m = COVERED_BARE.exec(t))) { note({ kinds: ['cover'] }); t = m[1].trim(); }
			if ((m = TRAIL_CAPS.exec(t))) t = m[1].trim();
			if ((m = TRAIL_WORDS.exec(t))) { if (m[2]) note({ kinds: ['tv-size'] }); if (m[3]) note({ kinds: ['short'] }); t = m[1].trim(); }
			// "Title ~Subtitle~": the subtitle goes. A tilde glued to the end of
			// a Latin word ("Ah~") draws a sound out and opens nothing.
			if ((m = SUBTITLE.exec(t)) && (m[3] === '\u301C' || m[2] || !m[1] || /[^\x00-\x7F]$/.test(m[1])) && (m[1] + m[5]).trim()) {
				note(groupInfo(m[4]));
				t = squeeze(m[1] + ' ' + m[5]);
			}
			if ((m = SUBTITLE_OPEN.exec(t))) { note(groupInfo(m[2])); t = m[1].trim(); }
			// a title quoted whole: "<corner>Title<corner>"
			if (t.length >= 3 && has(WRAP, t.charAt(0)) && WRAP[t.charAt(0)] === t.charAt(t.length - 1)) {
				var inner = t.slice(1, -1);
				if (inner.indexOf(t.charAt(0)) < 0 && inner.indexOf(t.charAt(t.length - 1)) < 0 && inner.trim()) t = inner.trim();
			}
			t = squeeze(t.replace(SEPS, ''));
		} while (t !== before && ++guard < 10);
		if (!t) t = orig;
		return { base: t, kinds: kinds };
	}

	// The song's title without decoration: version and medium tails in
	// brackets or after a dash (TV size, short and full versions, off vocal,
	// instrumental, karaoke, MV, PV, official video or audio, lyrics, audio,
	// HD, 4K, remastered, covered by, every recording word parse.js knows),
	// feat. and ft. credits, OP and ED tags, lenticular tags, a ~subtitle~,
	// and corner quotes around the whole title. A bracket that only names an
	// anime stays.
	function baseTitle(s) { return strip(s).base; }

	// "Japanese (Romaji)" or the other way round: both halves are the title.
	function halves(b) {
		var m = /^(.+?)\s*[(\[]([^()\[\]]+)[)\]]$/.exec(b);
		if (!m) return [];
		var x = m[1].trim(), y = m[2].trim(), jx = JP_RE.test(x), jy = JP_RE.test(y);
		return jx !== jy && /[A-Za-z]/.test(jx ? y : x) ? [x, y] : [];
	}

	// The song's title as parse.js reads the upload's own title. raw: the
	// upload's title, or { title, channel } (a library track's `raw`). Not
	// read when the upload's title holds the (cleaner) title already; read
	// when it is the title itself, as for an upload's keys:
	// titleKeys(video.title, '', { title: video.title, channel: video.channel }).
	var parsedMemo = memo(function (k) {
		var at = k.indexOf('\n'), p = getParse().parse(k.slice(0, at), k.slice(at + 1));
		return p && p.title ? p.title : '';
	});
	function rawTitle(raw, title) {
		if (!raw) return '';
		var rt = typeof raw === 'string' ? raw : str(raw.title), ch = typeof raw === 'string' ? '' : str(raw.channel);
		if (!rt) return '';
		var ft = fold(baseTitle(title)), fr = fold(rt);
		if (ft && fold(title) !== fr && fr.indexOf(ft) >= 0) return '';
		return parsedMemo(rt.replace(/\n/g, ' ') + '\n' + ch);
	}

	// -> { f: fold keys, l: loose keys, t: both, kinds: versions the title's tails name }
	function titleParts(title, alt, raw) {
		var f = [], l = [], st = strip(title);
		function add(b, whole) {
			if (!b) return;
			f.push(fold(b));
			if (whole) f.push(fold(whole));
			l.push(lk(b));
			halves(b).forEach(function (x) { f.push(fold(x)); l.push(lk(x)); });
		}
		add(st.base, str(title));
		add(baseTitle(alt));
		var rt = rawTitle(raw, title);
		if (rt) add(baseTitle(rt));
		f = uniq(f).filter(keyOk);
		l = uniq(l).filter(keyOk);
		return { f: f, l: l, t: uniq(f.concat(l)), kinds: st.kinds };
	}
	// The keys a title is known by: fold(baseTitle(title)), fold(title),
	// fold(baseTitle(alt)), the loose key of each base (kana read as romaji),
	// both halves of a "Japanese (Romaji)" title, and with `raw` (the upload's
	// title, or { title, channel }) the title parse.js reads from it.
	function titleKeys(title, alt, raw) { return titleParts(title, alt, raw).t; }

	// ---- The artist ---------------------------------------------------------------------

	// -> { whole: keys for the credit as a whole, persons: keys for each
	//      person in it, all: both }
	var nameMemo = memo(function (n) { return [fold(n), lk(n)]; });
	var peopleMemo = memo(function (n) { return getLibrary().people(n); });
	function artistParts(credit, native, aliasOf, x) {
		var whole = [], persons = [];
		function alias(n) { if (typeof aliasOf !== 'function') return ''; var a = aliasOf(n); return a ? str(a) : ''; }
		function both(list, n) {
			var k = nameMemo(n), a = alias(n);
			list.push(k[0], k[1]);
			if (a) { k = nameMemo(a); list.push(k[0], k[1]); }
		}
		[credit, native].forEach(function (name) {
			name = str(name).trim();
			if (!name) return;
			both(whole, name);
			peopleMemo(name).forEach(function (p) { both(persons, p.name); });
		});
		if (x) {
			if (x.artistKey && (str(credit).trim() || str(native).trim())) whole.push(str(x.artistKey));
			if (Array.isArray(x.people)) x.people.forEach(function (p) { if (p && p.name) both(persons, str(p.name)); });
		}
		whole = uniq(whole);
		persons = uniq(persons);
		return { whole: whole, persons: persons, all: uniq(whole.concat(persons)) };
	}
	// The keys an artist credit is known by: the whole credit, each person in
	// it (library.js people: "A & B", "A feat. B", the voice actor of
	// "Character (CV: Name)"), the native name, each folded and loose (kana
	// read as romaji), and what aliasOf(name) calls each of them.
	function artistKeys(credit, native, aliasOf) { return artistParts(credit, native, aliasOf, null).all; }

	// ---- Signatures and the same song ------------------------------------------------------

	function isSig(x) { return !!x && Array.isArray(x.t) && Array.isArray(x.a); }
	function videoOf(x) {
		if (x.videoId) return str(x.videoId);
		return YT_ID.test(str(x.id)) ? str(x.id) : null;
	}
	// What a track or a find is matched by. x.version, or when it has none the
	// versions its title's tails name ("(TV Size)" gives 'tv-size').
	//   { t: titleKeys, a: artistKeys, v: videoId | null, d: seconds | 0,
	//     ver: version | '', w: fold(work) | '', r: role | '',
	//     tf, tl: the fold and loose title keys, aw: the whole-credit artist keys }
	function signature(x, opts) {
		if (isSig(x)) return x;
		x = x || {};
		var aliasOf = opts && opts.aliasOf;
		var tp = titleParts(x.title, x.titleAlt, x.raw);
		var ap = artistParts(x.artist, x.artistNative, aliasOf, x);
		var ver = str(x.version).trim();
		if (!ver) ver = sortKinds(tp.kinds).join('+');
		var d = +x.durationSec;
		return {
			t: tp.t, a: ap.all, v: videoOf(x), d: d > 0 ? d : 0, ver: ver, w: fold(x.work), r: str(x.role),
			tf: tp.f, tl: tp.l, aw: ap.whole
		};
	}
	function tfOf(s) { return s.tf || s.t; }
	function tlOf(s) { return s.tl || uniq(s.t.map(loose)); }
	function awOf(s) { return s.aw || s.a; }

	function sortKinds(kinds) {
		var order = getParse().VERSION_KINDS;
		return kinds.slice().sort(function (a, b) { return order.indexOf(a) - order.indexOf(b); });
	}
	// The kinds that tell recordings apart. A remaster is the same recording.
	var CUT_KINDS = { 'tv-size': true, short: true, edit: true, extended: true };
	function kindsOf(ver) {
		return uniq(str(ver).toLowerCase().split(/[+,\s]+/)).filter(function (k) { return k !== 'remaster'; }).sort();
	}
	function common(a, b) {
		if (!a.length || !b.length) return '';
		var m = {};
		a.forEach(function (k) { m['#' + k] = true; });
		for (var i = 0; i < b.length; i++) if (b[i] && has(m, '#' + b[i])) return b[i];
		return '';
	}
	function partOf(a, b) {
		for (var i = 0; i < a.length; i++) {
			if (a[i].length < 6) continue;
			for (var j = 0; j < b.length; j++) if (b[j].length >= 6 && (a[i].indexOf(b[j]) >= 0 || b[j].indexOf(a[i]) >= 0)) return true;
		}
		return false;
	}

	// Two signatures: the evidence, added up.
	function compare(sa, sb) {
		if (sa.v && sa.v === sb.v) return { score: 99, why: ['video'], same: true, sameRecording: true };
		var score = 0, why = [];
		if (common(tfOf(sa), tfOf(sb))) { score += 4; why.push('title'); }
		else if (common(tlOf(sa), tlOf(sb))) { score += 3; why.push('title-loose'); }
		else if (partOf(tfOf(sa), tfOf(sb)) || partOf(tlOf(sa), tlOf(sb))) { score += 1.5; why.push('title-part'); }
		else return { score: 0, why: ['no-title'], same: false, sameRecording: false };
		if (sa.a.length && sb.a.length) {
			if (common(awOf(sa), awOf(sb))) { score += 3; why.push('artist'); }
			else if (common(sa.a, sb.a)) { score += 2.5; why.push('person'); }
			else { score -= 3; why.push('other-artist'); }
		}
		if (sa.w && sa.w === sb.w) { score += 1.5; why.push('work'); }
		if (sa.r && sb.r && str(sa.r).toLowerCase() === str(sb.r).toLowerCase()) { score += 0.5; why.push('role'); }
		var ka = kindsOf(sa.ver), kb = kindsOf(sb.ver);
		var diff = ka.filter(function (k) { return kb.indexOf(k) < 0; }).concat(kb.filter(function (k) { return ka.indexOf(k) < 0; }));
		var cut = ka.concat(kb).some(function (k) { return has(CUT_KINDS, k); });
		if (diff.some(function (k) { return !has(CUT_KINDS, k); })) { score -= 2; why.push('other-version'); }
		var known = sa.d > 0 && sb.d > 0, close = false;
		if (known) {
			var gap = Math.abs(sa.d - sb.d);
			if (gap <= 4) { score += 1; why.push('length'); close = true; }
			else if (gap > 40 && !cut) { score -= 1.5; why.push('length-off'); }
		}
		var same = score >= SAME;
		return { score: score, why: why, same: same, sameRecording: same && !diff.length && (!known || close) };
	}

	// Are a and b (tracks, finds or signatures) the same song?
	//   title: equal fold key +4, else equal loose key +3, else one key inside
	//   the other (both 6 or more) +1.5, else nothing in common: score 0.
	//   artist: an equal credit +3, else a shared person (a voice actor too)
	//   +2.5, else (both known) -3. Same work +1.5, same role +0.5.
	//   Versions that differ -2 (a TV size or other cut only stops it being
	//   the same recording). Lengths within 4 s +1, over 40 s apart -1.5
	//   unless one is a cut.
	// -> { score, why: [reason], same: score >= SAME, sameRecording }
	function sameSong(a, b) { return compare(signature(a), signature(b)); }

	// ---- The library ------------------------------------------------------------------

	// tracks: an array or { id: track }.
	// -> { title: { key: [ids] }, video: { videoId: true }, sig: { id: signature },
	//      tracks: { id: track }, artist: { key: [ids] }, aliasOf }
	function index(tracks, opts) {
		var aliasOf = opts && typeof opts.aliasOf === 'function' ? opts.aliasOf : null;
		var list = Array.isArray(tracks) ? tracks : Object.keys(tracks || {}).map(function (k) { return tracks[k]; });
		var ix = { title: {}, video: {}, sig: {}, tracks: {}, artist: {} };
		if (aliasOf) ix.aliasOf = aliasOf;
		function push(map, k, id) { if (!has(map, k)) map[k] = []; map[k].push(id); }    // keys are unique per track
		list.forEach(function (t) {
			if (!t || !t.id || has(ix.tracks, t.id)) return;
			var s = signature(t, { aliasOf: aliasOf });
			ix.tracks[t.id] = t;
			ix.sig[t.id] = s;
			if (s.v) ix.video[s.v] = true;
			s.t.forEach(function (k) { push(ix.title, k, t.id); });
			s.a.forEach(function (k) { push(ix.artist, k, t.id); });
		});
		return ix;
	}

	// A track the player can play and the listener has not blocked.
	function playable(t) { return !t || (getLibrary().playable(t) && !t.blocked); }

	// The library track that is this find: its own video (score 99), else the
	// best whose sameSong reaches SAME, the same recording first, then one
	// that plays (and is not blocked), then the higher score.
	// -> { id, score, why, sameRecording } | null
	function inLibrary(ix, find) {
		if (!ix || !ix.sig || !find) return null;
		var fs = signature(find, { aliasOf: ix.aliasOf });
		if (fs.v && has(ix.video, fs.v)) {
			var vid = has(ix.tracks, fs.v) ? fs.v : '';
			if (!vid) for (var id in ix.sig) if (has(ix.sig, id) && ix.sig[id].v === fs.v) { vid = id; break; }
			if (vid) return { id: vid, score: 99, why: ['video'], sameRecording: true };
		}
		var seen = {}, cands = [];
		function take(map, keys) {
			if (!map) return;
			keys.forEach(function (k) {
				if (!has(map, k)) return;
				map[k].forEach(function (i) { if (!has(seen, '#' + i)) { seen['#' + i] = true; cands.push(i); } });
			});
		}
		take(ix.title, fs.t);
		take(ix.artist, fs.a);   // a title only partly alike reaches SAME only with the artist
		var best = null;
		cands.forEach(function (i) {
			if (!has(ix.sig, i)) return;
			var r = compare(fs, ix.sig[i]);
			if (!r.same) return;
			var c = { id: i, score: r.score, why: r.why, sameRecording: r.sameRecording, ok: playable(ix.tracks[i]) };
			if (!best || (c.sameRecording !== best.sameRecording ? c.sameRecording : c.ok !== best.ok ? c.ok : c.score > best.score)) best = c;
		});
		return best ? { id: best.id, score: best.score, why: best.why, sameRecording: best.sameRecording } : null;
	}

	// ---- Uploads ------------------------------------------------------------------------

	// Words in an upload's title that mark another recording than the song
	// itself: each costs 3 (6 at most) unless the find asks for it. The
	// Japanese ones: kabaa (cover), utattemita "tried singing" and hiitemita
	// "tried playing" (the usual cover tags), karaoke, ofuboukaru (off vocal),
	// insuto (instrumental), raibu (live), saizu (size), jikan (hours).
	var VIDEO_KINDS = [
		['cover', /\bcover(?:ed|s)?\b(?!\s*art)|\bsung\s+by\b|\u30AB\u30D0\u30FC|\u6B4C\u3063\u3066\u307F\u305F|\u5F3E\u3044\u3066\u307F\u305F/],
		['karaoke', /karaoke|\u30AB\u30E9\u30AA\u30B1/],
		['nightcore', /nightcore/],
		['sped-up', /\bsped\s*up\b|\bspeed\s*up\b/],
		['slowed', /\bslowed\b/],
		['8d', /\b8d\b/],
		['hour', /\b\d+\s*(?:hours?|hrs?)\b|\d+\s*\u6642\u9593/],
		['loop', /\bloop(?:ed|s)?\b/],
		['reaction', /\breact(?:s|ion|ions|ing)\b/],
		['instrumental', /\binstrumental\b|\binst\b|\boff\s*vocal\b|\bbacking\s+track\b|\u30AA\u30D5\u30DC\u30FC\u30AB\u30EB|\u30A4\u30F3\u30B9\u30C8/],
		['live', /\blive\b|\u30E9\u30A4\u30D6|\bthe\s+first\s+take\b|\bin\s+concert\b/],
		['tv-size', /\btv\s*(?:size|sized|ver|version|edit)\b|tv\s*\u30B5\u30A4\u30BA|\bshort\s*(?:ver|version|size)\b|\u30B7\u30E7\u30FC\u30C8/]
	];
	// Versions a find can ask for besides those: piano (piano), acoustic
	// (akoosutikku; hikigatari, singing to one's own playing), remix
	// (rimikkusu), orchestral (ookesutora).
	var ASK_KINDS = [
		['piano', /\bpiano\b|\u30D4\u30A2\u30CE/],
		['acoustic', /\bacoustic\b|\bunplugged\b|\u30A2\u30B3\u30FC\u30B9\u30C6\u30A3\u30C3\u30AF|\u5F3E\u304D\u8A9E\u308A/],
		['remix', /\bremix(?:ed)?\b|\brmx\b|\u30EA\u30DF\u30C3\u30AF\u30B9/],
		['orchestral', /\borchestra(?:l)?\b|\bsymphonic\b|\u30AA\u30FC\u30B1\u30B9\u30C8\u30E9/],
		['acapella', /\ba\s*cappella\b|\bacapella\b/],
		['extended', /\bextended\b/],
		['demo', /\bdemo\b/]
	];
	var ALL_KINDS = VIDEO_KINDS.concat(ASK_KINDS);
	var COVER_KINDS = { cover: true };
	// parse.js kinds as the upload words above name them
	var KIND_MAP = { 'sped-up': ['sped-up', 'nightcore'], session: ['live'], short: ['tv-size'] };
	var LYRICS = /\blyrics?\b|\u6B4C\u8A5E/;

	function lowText(s) { return getParse().tidy(s).normalize('NFKC').toLowerCase(); }
	function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
	// The song's own words (its base title, its artist), found in an upload's
	// title and left out before reading the version words there, so that
	// "Live Forever" or a band called Cover says nothing about the recording.
	// A Latin phrase goes only as whole words ("ai" stays in "aimer").
	function phrase(p) {
		var w = lowText(p).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
		if (!w.length) return null;
		var body = w.map(escapeRe).join('[^\\p{L}\\p{N}]*');
		return /^[\x00-\x7F]+$/.test(w.join('')) ? new RegExp('(^|[^\\p{L}\\p{N}])' + body + '(?![\\p{L}\\p{N}])', 'gu') : new RegExp('()' + body, 'gu');
	}
	function without(text, res) {
		res.forEach(function (re) { text = text.replace(re, '$1 '); });
		return text;
	}
	function kindsIn(text) {
		var out = [];
		ALL_KINDS.forEach(function (k) { if (k[1].test(text)) out.push(k[0]); });
		return out;
	}
	function words(text) {
		var w = text.split(/[^\p{L}\p{N}]+/u).filter(Boolean).map(fold).filter(Boolean);
		return { f: w, l: w.map(loose) };
	}
	// Is the key in the upload's title? Short keys (a Latin key under four
	// letters, any key under three) must be whole words there.
	function inText(k, vt) {
		if (!k) return false;
		if ((k.length < 4 && /^[a-z0-9]+$/.test(k)) || k.length < 3) return seq(vt.w.f, k) || seq(vt.w.l, k);
		return vt.f.indexOf(k) >= 0 || vt.l.indexOf(k) >= 0;
	}
	function seq(list, k) {
		for (var i = 0; i < list.length; i++) {
			var s = '';
			for (var j = i; j < list.length && j < i + 3; j++) {
				s += list[j];
				if (s === k) return true;
				if (s.length >= k.length) break;
			}
		}
		return false;
	}
	function nameIn(n, keys) { return !!n && (keys.indexOf(fold(n)) >= 0 || keys.indexOf(lk(n)) >= 0); }

	// What scoring uploads for one find needs, worked out once.
	function prep(find) {
		find = find || {};
		var sig = signature(find), ask = [];
		kindsOf(sig.ver).forEach(function (k) {
			(has(KIND_MAP, k) ? KIND_MAP[k] : [k]).forEach(function (x) {
				if (ask.indexOf(x) < 0 && ALL_KINDS.some(function (y) { return y[0] === x; })) ask.push(x);
			});
		});
		var own = isSig(find) ? [] : [baseTitle(find.title), baseTitle(find.titleAlt), str(find.artist), str(find.artistNative)].map(phrase).filter(Boolean);
		return { sig: sig, ask: ask, own: own };
	}

	function scoreWith(video, fx) {
		var P = getParse(), sig = fx.sig, score = 0, why = [];
		var raw = str(video.title), low = lowText(raw);
		var vt = { f: fold(raw), l: lk(raw), w: words(low) };
		var rest = without(low, fx.own);
		var vk = kindsIn(rest);
		var hit = fx.ask.filter(function (k) { return vk.indexOf(k) >= 0; });
		var miss = fx.ask.length > 0 && !hit.length;
		var ch = P.channelInfo(str(video.channel));
		// the channel says who uploaded it; it does not say which recording
		if (!miss) {
			if (ch.kind === 'topic') {
				if (nameIn(ch.name, sig.a)) { score += 6; why.push('topic'); }
			} else if (ch.kind !== 'various' && ch.kind !== 'none' && [ch.name, ch.raw].concat(ch.names).some(function (n) { return nameIn(n, sig.a); })) {
				score += 3; why.push('channel');
			}
			if (ch.kind === 'official' || ch.kind === 'vevo') { score += 1; why.push('official'); }
		}
		var titled = sig.t.some(function (k) { return inText(k, vt); });
		if (titled) { score += 4; why.push('title'); }
		if (sig.a.some(function (k) { return inText(k, vt); })) { score += 1.5; why.push('artist-in-title'); }
		if (hit.length) { score += Math.min(4, 2 * hit.length); why.push('version'); }
		else if (miss) { score -= 3; why.push('not-version'); }
		var cost = 0;
		vk.forEach(function (k) {
			if (!VIDEO_KINDS.some(function (x) { return x[0] === k; }) || fx.ask.indexOf(k) >= 0) return;
			if (has(COVER_KINDS, k) && hit.length) return;      // an arrangement asked for is usually somebody's cover
			cost += 3;
			why.push(k);
		});
		score -= Math.min(6, cost);
		if (LYRICS.test(rest)) { score -= 1; why.push('lyrics'); }
		var vd = +video.durationSec || 0;
		if (vd > 0 && sig.d > 0) {
			var gap = Math.abs(vd - sig.d);
			if (gap <= 5) { score += 2; why.push('length'); }
			else if (gap > 30) { score -= 2; why.push('length-off'); }
		}
		if (!titled) { score = Math.min(score, 0); why.push('no-title'); }
		return { score: score, why: why };
	}

	// How well an upload ({ videoId, title, channel, channelId, durationSec })
	// fits a find: the artist's Topic channel +6, a channel named as the
	// artist +3, an Official or VEVO channel +1 (none of these when the find
	// asks for a version the upload does not show), a title key of the find
	// in the upload's title +4 (without it the score is at most 0), the artist
	// in the title +1.5, each version the find asks for and the upload shows
	// +2 (4 at most) or none of them -3, each cover, sung by, karaoke,
	// nightcore, sped up, slowed, 8D, hours, loop, reaction, instrumental, off
	// vocal, live or TV size word the find does not ask for -3 (6 at most),
	// lyrics -1, the length within 5 s +2 or over 30 s off -2.
	// -> { score, why }
	function scoreVideo(video, find) { return scoreWith(video || {}, prep(find)); }

	// The upload to play for a find: the highest score, the first of equals;
	// null when it is under opts.min (MIN_VIDEO). alts: the next three that
	// reach min. -> { video, score, why, alts: [{ video, score }] } | null
	function bestVideo(videos, find, opts) {
		var min = opts && opts.min != null ? +opts.min : MIN_VIDEO;
		var fx = prep(find), rows = [];
		(videos || []).forEach(function (v, i) {
			if (!v) return;
			var r = scoreWith(v, fx);
			rows.push({ video: v, score: r.score, why: r.why, i: i });
		});
		rows.sort(function (a, b) { return b.score - a.score || a.i - b.i; });
		if (!rows.length || !(rows[0].score >= min)) return null;
		return {
			video: rows[0].video, score: rows[0].score, why: rows[0].why,
			alts: rows.slice(1).filter(function (r) { return r.score >= min; }).slice(0, 3).map(function (r) { return { video: r.video, score: r.score }; })
		};
	}

	// ---- Works and searches ---------------------------------------------------------------

	function grams(s) {
		var out = {};
		if (s.length < 3) { if (s) out[s] = true; return out; }
		for (var i = 0; i + 3 <= s.length; i++) out[s.slice(i, i + 3)] = true;
		return out;
	}
	// How well a work label names an anime: { name, synonyms } (or a name).
	// 1 for an equal fold or loose key with the name or a synonym, 0.8 when one
	// holds the other (both 4 or more), else the share of letter trigrams the
	// two loose keys have in common (Jaccard). -> 0..1
	function workScore(work, target) {
		var names = typeof target === 'string' ? [target] : target ? [target.name].concat(Array.isArray(target.synonyms) ? target.synonyms : []) : [];
		var wf = fold(work), wl = lk(work), best = 0;
		if (!wf) return 0;
		names.forEach(function (n) {
			var nf = fold(n), nl = lk(n), s;
			if (!nf) return;
			if (nf === wf || (nl && nl === wl)) s = 1;
			else if ((wf.length >= 4 && nf.length >= 4 && (wf.indexOf(nf) >= 0 || nf.indexOf(wf) >= 0)) ||
				(wl.length >= 4 && nl.length >= 4 && (wl.indexOf(nl) >= 0 || nl.indexOf(wl) >= 0))) s = 0.8;
			else {
				var a = grams(wl), b = grams(nl), both = 0, all = 0, k;
				for (k in a) if (has(a, k)) { all++; if (has(b, k)) both++; }
				for (k in b) if (has(b, k) && !has(a, k)) all++;
				s = all ? Math.round(both / all * 1000) / 1000 : 0;
			}
			if (s > best) best = s;
		});
		return best;
	}

	// What to type into a YouTube search for a find: the artist and the base
	// title, the Japanese title when the find has one and its title is
	// romaji. At most 100 characters.
	function query(find) {
		find = find || {};
		var title = str(find.title), alt = str(find.titleAlt), t = baseTitle(title);
		if (alt && JP_RE.test(alt) && !JP_RE.test(title) && /[A-Za-z]/.test(title)) t = baseTitle(alt) || t;
		var q = (str(find.artist).trim() + ' ' + t).replace(/\s+/g, ' ').trim();
		if (q.length > 100) {
			q = q.slice(0, 100);
			var cut = q.lastIndexOf(' ');
			if (cut >= 60) q = q.slice(0, cut);
			if (/[\uD800-\uDBFF]$/.test(q)) q = q.slice(0, -1);
			q = q.trim();
		}
		return q;
	}

	return {
		SAME: SAME, STRONG: STRONG, MIN_VIDEO: MIN_VIDEO,
		fold: fold, kana: kana, romaji: romaji, loose: loose, baseTitle: baseTitle,
		titleKeys: titleKeys, artistKeys: artistKeys, signature: signature,
		index: index, inLibrary: inLibrary, sameSong: sameSong,
		scoreVideo: scoreVideo, bestVideo: bestVideo, workScore: workScore, query: query
	};
});
