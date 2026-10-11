// fuzzy: search that forgives (fuzzy.js). distance and allowed, romajiLike, the index and
// the search on invented tracks shaped like the library's, rankNames, the page calls on a
// fake page context, the shipped labels.json (read only), and the speed on 10,000
// generated tracks. Kana and kanji are built with String.fromCharCode, so this file
// stays plain ASCII.
module.exports = function (h) {
	var fs = require('fs');
	var path = require('path');
	var F = require(path.join(h.HERE, 'fuzzy.js'));
	var M = require(path.join(h.HERE, 'match.js'));
	var L = require(path.join(h.HERE, 'library.js'));

	function cp() { return String.fromCharCode.apply(null, arguments); }
	// A track with the fields library search reads too, so the two can be compared.
	function track(id, more) {
		var t = { id: id, title: '', titleAlt: '', artist: '', artistNative: '', work: '', album: '', feat: [], genres: [], tags: [],
			channel: '', version: '', versionText: '', origArtist: '', raw: { title: '', channel: '' } };
		for (var k in more) t[k] = more[k];
		return t;
	}
	function ids(list) { return list.map(function (r) { return r.id; }); }
	function byId(list, id) { for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i]; return null; }
	function sorted(a) { return a.slice().sort(); }
	function freeze(x) { if (x && typeof x === 'object' && !Object.isFrozen(x)) { Object.freeze(x); Object.keys(x).forEach(function (k) { freeze(x[k]); }); } return x; }
	function ms(t0) { return Number(process.hrtime.bigint() - t0) / 1e6; }

	// Kana and kanji, by code point.
	var SHIRUSHI = cp(0x3057, 0x308B, 0x3057);                                         // shirushi
	var KOI_NO_SHIRUSHI = cp(0x3053, 0x3044, 0x306E) + SHIRUSHI;                       // koi no shirushi
	var KIMI_NO_SHIRANAI = cp(0x304D, 0x307F, 0x306E, 0x3057, 0x3089, 0x306A, 0x3044); // kimi no shiranai
	var KIMI_KANJI = cp(0x541B, 0x306E, 0x77E5, 0x3089, 0x306A, 0x3044, 0x7269, 0x8A9E); // the same with kanji, and "monogatari"
	var TOUKYOU_KANA = cp(0x30C8, 0x30A6, 0x30AD, 0x30E7, 0x30A6);                     // toukyou in katakana
	var KOI_KANJI = cp(0x604B);                                                        // koi, one kanji
	var KOI_NO_UTA = cp(0x604B, 0x306E, 0x3046, 0x305F);                               // a kanji, then no uta in kana
	var CONNECT = cp(0x30B3, 0x30CD, 0x30AF, 0x30C8);                                  // konekuto
	var HIMAWARI = cp(0x3072, 0x307E, 0x308F, 0x308A);                                 // himawari

	var TRACKS = [
		track('a', { title: SHIRUSHI, artist: 'Hanabi Lane' }),
		track('b', { title: KOI_NO_SHIRUSHI, titleAlt: 'Koi no Shirushi', artist: 'Oratorio Choir', work: 'Kami Nomi' }),
		track('c', { title: KIMI_KANJI, titleAlt: 'Kimi no Shiranai Monogatari', artist: 'supercell', work: 'Bakemonogatari' }),
		track('d', { title: KIMI_NO_SHIRANAI, artist: 'Quiet Ferrymen' }),
		track('e', { title: 'Hikari', artist: 'Kalafina', work: 'Kara no Kyoukai' }),
		track('f', { title: 'Lacrimosa', artist: 'Kalafina' }),
		track('g', { title: 'Brave Shine', artist: 'Aimer' }),
		track('h', { title: 'Toukyou Teddy Bear', artist: 'Neru' }),
		track('i', { title: 'Tokyo Drift', artist: 'Teriyaki Boyz' }),
		track('j', { title: TOUKYOU_KANA, artist: 'Glass Orchard' }),
		track('k', { title: KOI_KANJI, artist: 'Paper Lanterns' }),
		track('m', { title: CONNECT, titleAlt: 'Connect', artist: 'ClariS' }),
		track('n', { title: HIMAWARI + 'Good Days', artist: 'Komachi' }),
		track('o', { title: 'Four Seasons', artist: 'Vivaldi Ensemble' }),
		track('p', { title: 'Good Morning', artist: 'Glass Orchard' }),
		track('q', { title: 'A Cruel Angel', artist: 'Yoko' }),
		track('r', { title: 'Sakura no Uta', artist: 'hana' }),
		track('s', { title: 'Hikaru Nara', artist: 'Goose house' }),
		track('t', { title: KOI_NO_UTA, artist: 'Marrow & Pine' }),
		track('u', { title: 'Melancholia', artist: 'Saffron Circuit', feat: ['Aoba Rin'] })
	];
	freeze(TRACKS);

	h.describe('fuzzy', function () {
		var ix = F.index(TRACKS);
		function find(q, opts) { return F.search(ix, q, opts); }
		function found(q) { return sorted(ids(find(q))); }

		// ---- distance and allowed --------------------------------------------------------
		h.eq([F.distance('aimr', 'aimer', 1), F.distance('aimer', 'aimr', 1), F.distance('kalafna', 'kalafina', 1)], [1, 1, 1], 'distance: a letter missing is one edit, both ways');
		h.eq([F.distance('lvoe', 'love', 1), F.distance('hikari', 'hikari', 2), F.distance('kitten', 'sitting')], [1, 0, 3], 'distance: two neighbours swapped are one edit (Damerau); equal words 0; kitten and sitting 3');
		h.eq([F.distance('', 'abc'), F.distance('abcdef', 'uvwxyz', 1), F.distance('abc', 'abcdef', 2)], [3, 2, 3], 'distance: from nothing, the length; further than max gives max + 1, early');
		h.eq([0, 3, 4, 7, 8, 12].map(F.allowed), [0, 0, 1, 1, 2, 2], 'allowed: no typos under 4 letters, 1 for 4 to 7, 2 from 8');

		// ---- romajiLike --------------------------------------------------------------------
		var romaji = ['tokyo', 'toukyou', 'tohkyoh', 'shirushi', 'sirusi', 'kimi', 'shinjuku', 'sinzyuku', 'kantan', 'shimbun', 'matcha', 'kitte', 'kyouka', 'nyan'];
		var english = ['four', 'good', 'soul', 'kalafina', 'aimer', 'lighthouse', 'two', 'xyz', 'drift', 'hikari2'];
		h.eq(romaji.filter(function (w) { return !F.romajiLike(w); }), [], 'romajiLike: romaji in Hepburn and Kunrei, long vowels, the small tsu, n and m');
		h.eq(english.filter(F.romajiLike), [], 'romajiLike: English words, names with an l, numbers are not');

		// ---- the index -----------------------------------------------------------------------
		h.eq(ix.ids.length, TRACKS.length, 'index: one document per track');
		var twice = F.index(TRACKS.concat([TRACKS[0], null, { title: 'no id' }]));
		h.eq(twice.ids.length, TRACKS.length, 'index: a track listed twice counts once; null and a track without an id are left out');
		var asMap = {}; TRACKS.forEach(function (t) { asMap[t.id] = t; });
		h.eq(sorted(ids(F.search(F.index(asMap), 'kalafna'))), ['e', 'f'], 'index: takes { id: track } too');
		h.eq([F.search(F.index([]), 'hikari'), F.search(ix, ''), F.search(ix, '  !! '), F.search(null, 'x')], [[], [], [], []], 'search: an empty index, an empty query, a query of punctuation: nothing');

		// ---- romaji for kana titles ---------------------------------------------------------------
		var r = find('shirushi');
		h.eq(sorted(ids(r)), ['a', 'b'], 'romaji: "shirushi" finds the kana title shirushi and the one whose titleAlt says it');
		h.eq(byId(r, 'a').how, 'romaji', 'romaji: the kana title is found by its reading (how: romaji)');
		h.eq(found('konekuto'), ['m'], 'romaji: a katakana loanword by its reading ("konekuto")');
		h.eq(byId(find('himawari'), 'n') && byId(find('himawari'), 'n').how, 'romaji', 'romaji: kana run into Latin letters are words of their own ("himawari" in himawariGood Days)');
		h.eq(found('good days'), ['n'], 'romaji: and the Latin half of that title is too');
		h.eq(found('nouta'), ['t'], 'romaji: the kana inside a title with kanji are read too');
		h.eq(find('kimi no shiranai')[0].id, 'd', 'romaji: "kimi no shiranai" finds the kana title kiminoshiranai (the whole query, spaces out), first: it is the whole title');
		h.eq([byId(find('kimi no shiranai'), 'd').how, byId(find('kimi no shiranai'), 'c').how], ['romaji', 'exact'], 'romaji: how says so; the kanji title is found through its titleAlt');
		h.eq(found('shiranai'), ['c', 'd'], 'romaji: a word inside a kana title (a title is one long word in kana)');

		// ---- loose spellings -----------------------------------------------------------------------
		r = find('sirusi');
		h.eq([sorted(ids(r)), r.map(function (x) { return x.how; })], [['a', 'b'], ['loose', 'loose']], 'loose: "sirusi" (Kunrei) finds shirushi in kana and in romaji (how: loose)');
		h.eq(find('koi no sirusi')[0].id, 'b', 'loose: "koi no sirusi" puts Koi no Shirushi first');
		h.eq(found('tokyo'), ['h', 'i', 'j'], 'loose: "tokyo" finds Tokyo, Toukyou and toukyou in katakana');
		h.eq(ids(find('tokyo'))[0], 'i', 'loose: the exact Tokyo first');
		h.eq(found('toukyou'), ['h', 'i', 'j'], 'loose: "toukyou" finds all three');
		h.eq(ids(find('toukyou')).indexOf('i'), 2, 'loose: and the exact ones come before Tokyo');
		h.eq(found('tohkyoh'), ['h', 'i', 'j'], 'loose: "tohkyoh" (the h for a long vowel) too');
		h.eq(found('touky'), ['h', 'i', 'j'], 'loose: a last word typed to the middle of a syllable ("touky") already finds them');
		h.eq([found('for'), found('god'), found('sol')], [[], [], []], 'loose: English is not read as romaji: "for" is not Four, "god" not Good');

		// ---- typos, at each length -----------------------------------------------------------------
		r = find('kalafna');
		h.eq([sorted(ids(r)), r[0].how], [['e', 'f'], 'typo'], 'typo: "Kalafna" (7 letters, one missing) finds Kalafina\'s songs (how: typo)');
		h.eq(found('aimr'), ['g'], 'typo: "Aimr" (4 letters) finds Aimer');
		h.eq(found('amr'), [], 'typo: 3 letters carry none ("amr" is not Aimer)');
		h.eq(found('kalfina'), ['e', 'f'], 'typo: 7 letters, one edit');
		h.eq(found('klfina'), [], 'typo: 6 letters, two edits: too far');
		h.eq(found('lacrmosaa'), ['f'], 'typo: 9 letters, two edits ("lacrmosaa" for Lacrimosa)');
		h.eq(found('lcrmosaa'), [], 'typo: 8 letters, three edits: too far');
		h.eq(found('monogtri'), ['c'], 'typo: 8 letters, two missing ("monogtri" for monogatari, in a titleAlt)');
		h.eq(found('kimi no shiranai monogatri'), ['c'], 'typo: in the last of several words');
		h.eq(found('hikari'), ['e'], 'typo: none looked for when the word exists ("hikari" does not bring Hikaru)');
		h.eq(found('hikri'), ['e'], 'typo: "hikri" is one edit from Hikari, two from Hikaru');
		h.eq(found('ikalafina'), [], 'typo: the first letter must stay (or swap with the second)');
		h.eq(found('akalfina'), ['e', 'f'], 'typo: the first two swapped is one edit');

		// ---- the start of a word, several words --------------------------------------------------
		r = find('kalaf');
		h.eq([sorted(ids(r)), r[0].how], [['e', 'f'], 'prefix'], 'prefix: the last word may be the start of a word (how: prefix)');
		h.eq([found('ka'), found('kal')], [[], ['e', 'f']], 'prefix: alone, 3 letters at least');
		h.eq(found('hikari ka'), ['e'], 'prefix: after another word, 2 letters');
		h.eq(byId(find('kalaf hikari'), 'e').how, 'exact', 'several words: an earlier word inside a word counts, as in library search (how: exact)');
		r = find('kalafna hikari');
		h.eq([ids(r), r[0].how], [['e'], 'typo'], 'several words: every word must match ("kalafna hikari" is only Hikari); how is the weakest');
		h.eq(found('kalafna zzzz'), [], 'several words: one word that matches nothing leaves nothing');
		h.eq(find('kiminoshiranai').map(function (x) { return x.id + ':' + x.how; }), ['d:romaji', 'c:joined'], 'whole title: "kiminoshiranai" finds Kimi no Shiranai Monogatari by its titleAlt without spaces (how: joined)');
		h.eq(find('supercel l').length, 0, 'whole title: only titles, not artists, are run together');

		// ---- kanji -------------------------------------------------------------------------------
		h.ok(found('koi').indexOf('k') < 0 && found('koi').indexOf('b') >= 0, 'kanji: never romanised ("koi" finds Koi no Shirushi by its titleAlt, not the kanji koi)');
		h.eq([found(KOI_KANJI), find(KOI_KANJI)[0].how], [['k'], 'exact'], 'kanji: typed as kanji, the same word is found as written');
		h.eq(found('kimi no shiranai monogatari'), ['c'], 'kanji: the kanji title by its whole titleAlt');

		// ---- short junk ------------------------------------------------------------------------
		h.eq(found('a'), ['q'], '"a" finds only the word a, not every title with an a in it');
		h.eq(found('no'), ['b', 'c', 'e', 'r'], '"no" finds only the word no (Koi no, Kimi no, Kara no, Sakura no): not kiminoshiranai in kana, nor no inside a title with kanji');
		var exact = function (q) { return ids(L.search(null, q, TRACKS)); };
		h.eq(['a', 'no', 'x', 'u'].filter(function (q) { return find(q).some(function (x) { return exact(q).indexOf(x.id) < 0; }); }), [], 'short terms find nothing library search does not already find');
		h.eq([found('x'), found('zq'), found('qqqq'), found('zzzzzzzz')], [[], [], [], []], 'junk finds nothing');

		// ---- the order --------------------------------------------------------------------------
		var ord = F.index([
			track('o6', { title: 'Toukyou', artist: 'A' }),
			track('o5', { title: 'Tokyoite', artist: 'A' }),
			track('o4', { title: 'Elsewhere', artist: 'A', album: 'Tokyo Tapes' }),
			track('o3', { title: 'Something', artist: 'Tokyo Brass' }),
			track('o2', { title: 'Tokyo Nights', artist: 'B' }),
			track('o1', { title: 'Tokyo', artist: 'C' })
		]);
		h.eq(ids(F.search(ord, 'tokyo')), ['o1', 'o2', 'o3', 'o4', 'o5', 'o6'], 'order: the title equal to the query, exact in the title, in the artist, in the album, a start, a loose spelling');
		h.eq(F.search(ord, 'tokyo').map(function (x) { return x.how; }), ['exact', 'exact', 'exact', 'exact', 'prefix', 'loose'], 'order: how for each');
		var typoOrd = F.index([track('t3', { title: 'Something', album: 'Kalafina Live' }), track('t2', { title: 'Melancholic' }), track('t1', { title: 'Hello', artist: 'Kalafina' })]);
		h.eq(ids(F.search(typoOrd, 'kalafna')), ['t1', 't3'], 'order: a typo in the artist before one in the album');
		var two = F.search(F.index([track('w2', { title: 'Melancholic' }), track('w1', { title: 'Melancholia' })]), 'melancholiaa');
		h.eq(ids(two), ['w1', 'w2'], 'order: one typo before two');
		var each = find('tokyo');
		h.ok(each.every(function (x, n) { return !n || each[n - 1].score >= x.score; }), 'order: best first');
		h.eq(Object.keys(each[0]), ['id', 'score', 'how'], 'search: { id, score, how }');

		// ---- not and limit ----------------------------------------------------------------------
		h.eq([ids(find('kalafna', { not: ['e'] })), ids(find('kalafna', { not: { f: true } })), find('kalafna', { limit: 1 }).length], [['f'], ['e'], 1], 'not (a list or { id: true }) leaves tracks out; limit cuts the list');
		h.eq(found('aoba'), ['u'], 'feat is searched');

		// ---- purity ---------------------------------------------------------------------------
		var again = F.index(TRACKS.slice().reverse());
		h.eq(F.search(again, 'tokyo'), find('tokyo'), 'the same answer from the tracks in another order');
		h.eq(find('kalafna hikari'), find('kalafna hikari'), 'the same answer twice (the tracks are frozen)');

		// ---- rankNames --------------------------------------------------------------------------
		var names = ['Aimer', 'Kalafina', 'ClariS', 'Tokyo Jihen', 'Uchujin', 'supercell', 'Kara no Kyoukai'];
		h.eq(F.rankNames(names, 'aimr'), [{ i: 0, score: 17, how: 'typo' }], 'rankNames: "aimr" is Aimer, a typo');
		h.eq(F.rankNames(names, 'toukyou jihen').map(function (x) { return x.i + ':' + x.how; }), ['3:loose'], 'rankNames: "toukyou jihen" is Tokyo Jihen');
		h.eq(F.rankNames(names, 'uchuujin').map(function (x) { return x.i + ':' + x.how; }), ['4:loose'], 'rankNames: "uchuujin" is Uchujin');
		h.eq(F.rankNames(names, 'kara nokyoukai').map(function (x) { return x.i + ':' + x.how; }), ['6:joined'], 'rankNames: "kara nokyoukai" is Kara no Kyoukai, spaced differently');
		h.eq(F.rankNames(names, 'kara no kyokai').map(function (x) { return x.i + ':' + x.how; }), ['6:loose'], 'rankNames: a work, "kara no kyokai"');
		h.eq([F.rankNames(names, ''), F.rankNames([], 'aimer'), F.rankNames(null, 'aimer')], [[], [], []], 'rankNames: nothing to rank, nothing asked');
		h.eq(F.HOW.typo + ' / ' + F.HOW.loose + ' / ' + F.HOW.romaji + ' / ' + F.HOW.joined + ' / ' + F.HOW.prefix + ' / ' + F.HOW.exact, 'close spelling / another spelling / romaji reading / spaced differently / start of a word / ', 'HOW: the words the page shows');

		// ---- the page calls, on a fake page context ---------------------------------------------
		function entries(list, keyOf) { var m = {}; list.forEach(function (t) { var k = keyOf(t); if (!k) return; (m[k] = m[k] || { key: k, name: t.artist, native: '', tracks: [] }).tracks.push(t); }); return m; }
		function pageIndex(list) { return { all: list, artists: entries(list, function (t) { return t.artist.toLowerCase().replace(/[^a-z]/g, ''); }), works: entries(list, function (t) { return t.work; }) }; }
		var played = [], idxNow = pageIndex(TRACKS);
		function el(tag, attrs, kids) { var e = { tag: tag, attrs: attrs || {}, kids: [] }; e.appendChild = function (c) { e.kids.push(c); return c; }; [].concat(kids || []).forEach(function (c) { if (c) e.kids.push(c); }); return e; }
		var lists = [];
		var ctx = {
			idx: function () { return idxNow; }, h: el,
			words: { title: function (t) { return t.title; }, artist: function (t) { return t.artist; }, q: function (s) { return '"' + s + '"'; }, n: String, DOT: '*' },
			ui: { smallBtn: function (icon, label, fn) { return el('button', { label: label, fn: fn }); }, trackList: function (view, tracks, opts) { lists.push({ view: view, tracks: tracks, opts: opts }); } },
			play: { now: function (list) { played.push(['now', list]); }, from: function (list, at, c) { played.push(['from', list, at, c.label]); } }
		};
		var close = F.closeMatches(ctx, 'kalafna', { songs: [], artists: [], works: [], chips: 0 });
		h.eq([ids(close.songs).sort(), close.how.e, close.artists.map(function (a) { return a.name; }), close.works, close.exact, close.alone], [['e', 'f'], 'typo', ['Kalafina'], [], 0, false],
			'closeMatches: "Kalafna" gives Kalafina\'s songs, how, and Kalafina among the artists (so the page is not alone with them)');
		close = F.closeMatches(ctx, 'sirusi', { songs: [], artists: [], works: [], chips: 0 });
		h.eq([ids(close.songs).sort(), close.alone], [['a', 'b'], true], 'closeMatches: songs and nothing else: alone (drawn in place of Nothing found)');
		h.eq(F.closeMatches(ctx, 'sirusi', { songs: [], artists: [], works: [], chips: 1 }).alone, false, 'closeMatches: a genre, mood or scene chip on the page: not alone');
		close = F.closeMatches(ctx, 'tokyo', { songs: [TRACKS[8]], artists: [{ key: 'x' }], works: [] });
		h.eq([ids(close.songs).sort(), close.artists, close.exact], [['h', 'j'], [], 1], 'closeMatches: the songs exact search found are left out; no close artists when exact search found some');
		h.eq(F.closeMatches(ctx, '  ', {}).songs, [], 'closeMatches: an empty query: nothing');
		idxNow = pageIndex(TRACKS.concat([track('z', { title: 'Kalafina Medley', artist: 'Quiet Ferrymen' })]));
		h.ok(ids(F.closeMatches(ctx, 'kalafna', {}).songs).indexOf('z') >= 0, 'closeMatches: built again when the page\'s index changes (a new song is found)');
		idxNow = pageIndex(TRACKS);
		close = F.closeMatches(ctx, 'kalafna', {});
		var view = el('div');
		F.section(view, ctx, close);
		var sec = view.kids[0], head = sec && sec.kids[0];
		h.eq([view.kids.length, head && head.kids[0].attrs.text, head && head.kids[1].attrs.label, sec && sec.kids[1].attrs.text], [1, 'Close matches (2)', 'Play these', 'Nothing matches "kalafna" exactly. These come close.'],
			'section: a heading with the count, Play these, and the note when exact search found no song');
		var tl = lists[lists.length - 1];
		h.eq([tl.view === sec, ids(tl.tracks), tl.opts.extra(TRACKS[4]), tl.opts.context.label], [true, ids(close.songs), null, 'Close to "kalafna"'], 'section: the songs as a track list, no hint on a row when every row comes close the same way');
		var mixedClose = { query: 'x', exact: false, songs: [TRACKS[4], TRACKS[5]], how: {}, artists: [], works: [] };
		mixedClose.how[TRACKS[4].id] = 'typo'; mixedClose.how[TRACKS[5].id] = 'romaji';
		F.section(el('div'), ctx, mixedClose);
		h.eq(lists[lists.length - 1].opts.extra(TRACKS[4]).attrs.text, ' * close spelling', 'section: rows that come close in different ways each say how');
		tl = lists[lists.length - 2];
		head.kids[1].attrs.fn();
		h.eq(played[played.length - 1], ['from', ids(close.songs), 0, 'Close to "kalafna"'], 'section: Play these plays them in order');
		var none = el('div');
		F.section(none, ctx, F.closeMatches(ctx, 'zzzz', {}));
		h.eq(none.kids.length, 0, 'section: nothing when there are no close matches');
		var withExact = el('div');
		F.section(withExact, ctx, F.closeMatches(ctx, 'tokyo', { songs: [TRACKS[8]] }));
		h.eq(withExact.kids[0].kids.length, 1, 'section: no note when exact search found songs');
		var out = [{ kind: 'Song', name: 'Lacrimosa', art: TRACKS[5], s: 15 }, { kind: 'Artist', name: 'Kalafina', s: 8 }];
		F.paletteSongs(ctx, 'kalafna', out);
		h.eq(out.slice(2).map(function (e) { return [e.kind, e.name, e.sub, e.s]; }), [['Song', 'Hikari', 'Kalafina * close spelling', 7.5]], 'paletteSongs: few exact songs: close ones join, below them and the artists, saying how');
		out[2].run();
		h.eq(played[played.length - 1], ['now', ['e']], 'paletteSongs: an entry plays the song now');
		var full = [1, 2, 3].map(function (n) { return { kind: 'Song', art: TRACKS[n], s: 15 }; });
		h.eq(F.paletteSongs(ctx, 'kalafna', full).length, 3, 'paletteSongs: three exact songs or more: left as they are');
		h.eq(F.paletteSongs(ctx, '', []).length, 0, 'paletteSongs: an empty query: nothing');

		// ---- the shipped labels.json (read only) ---------------------------------------------------
		var labels = JSON.parse(fs.readFileSync(path.join(h.HERE, 'labels.json'), 'utf8'));
		var real = Object.keys(labels.tracks).map(function (id) {
			var x = labels.tracks[id], prof = (labels.artists || {})[x.artist] || {};
			return track(id, { title: x.title || '', titleAlt: x.titleAlt || '', artist: x.artist || '', artistNative: prof.native || '', work: x.work || '' });
		});
		var t0 = process.hrtime.bigint(), rix = F.index(real), took = ms(t0);
		h.ok(real.length > 1000 && took < 1000, 'labels.json: ' + real.length + ' tracks indexed in ' + took.toFixed(0) + ' ms');
		var KANA_ONLY = /^[\u3041-\u30FF\s!?.,~\u3001\u3002\u30FB\u2606\u266A]+$/, HAN = /[\u4E00-\u9FFF]/;
		var kanaTitles = real.filter(function (t) { return KANA_ONLY.test(t.title) && /[\u3041-\u30FF]/.test(t.title); });
		var kanaMiss = kanaTitles.filter(function (t) { return ids(F.search(rix, M.romaji(t.title))).indexOf(t.id) < 0; });
		h.ok(kanaTitles.length > 100 && kanaMiss.length <= kanaTitles.length * 0.02, 'labels.json: ' + (kanaTitles.length - kanaMiss.length) + ' of ' + kanaTitles.length + ' kana titles found by their romaji reading' + (kanaMiss.length ? ' (missed: ' + kanaMiss.slice(0, 3).map(function (t) { return t.id; }).join(', ') + ')' : ''));
		var kanji = real.filter(function (t) { return HAN.test(t.title) && /^[A-Za-z][A-Za-z ']+$/.test(t.titleAlt); });
		var kanjiMiss = kanji.filter(function (t) { return ids(F.search(rix, t.titleAlt)).indexOf(t.id) < 0; });
		h.ok(kanji.length > 100 && kanjiMiss.length === 0, 'labels.json: every one of ' + kanji.length + ' kanji titles found by its titleAlt' + (kanjiMiss.length ? ' (missed: ' + kanjiMiss.slice(0, 3).map(function (t) { return t.id; }).join(', ') + ')' : ''));
		// one letter out of the middle of the titleAlt's longest word (5 letters or more)
		function misspell(s) {
			var ws = s.split(' '), at = 0;
			ws.forEach(function (w, n) { if (w.length > ws[at].length) at = n; });
			if (ws[at].length < 5) return '';
			var w = ws[at], mid = Math.floor(w.length / 2);
			ws[at] = w.slice(0, mid) + w.slice(mid + 1);
			return ws.join(' ');
		}
		var typoCases = kanji.map(function (t) { return { t: t, q: misspell(t.titleAlt) }; }).filter(function (c) { return c.q; });
		var typoMiss = typoCases.filter(function (c) { return ids(F.search(rix, c.q)).indexOf(c.t.id) < 0; });
		h.ok(typoCases.length > 100 && typoMiss.length <= typoCases.length * 0.1, 'labels.json: ' + (typoCases.length - typoMiss.length) + ' of ' + typoCases.length + ' kanji titles found by their titleAlt with a letter missing' + (typoMiss.length ? ' (e.g. ' + typoMiss.slice(0, 3).map(function (c) { return JSON.stringify(c.q); }).join(', ') + ')' : ''));
		var artistNames = []; real.forEach(function (t) { if (t.artist && artistNames.indexOf(t.artist) < 0) artistNames.push(t.artist); });
		var single = artistNames.filter(function (a) { return /^[A-Za-z]{5,}$/.test(a); });
		var artistMiss = single.filter(function (a) { var q = a.slice(0, 2) + a.slice(3); return F.rankNames(artistNames, q, { limit: 3 }).map(function (x) { return artistNames[x.i]; }).indexOf(a) < 0; });
		h.ok(single.length > 30 && artistMiss.length <= single.length * 0.1, 'labels.json: ' + (single.length - artistMiss.length) + ' of ' + single.length + ' one-word artists in the first three with their third letter missing' + (artistMiss.length ? ' (missed: ' + artistMiss.slice(0, 3).join(', ') + ')' : ''));
		function realFirst(q, pick, how) {
			var want = real.filter(pick).map(function (t) { return t.id; }), got = F.search(rix, q);
			return want.length > 0 && got.length > 0 && want.indexOf(got[0].id) >= 0 && (!how || got[0].how === how);
		}
		h.ok(realFirst('koi no sirusi', function (t) { return t.titleAlt === 'Koi no Shirushi'; }, 'loose'), 'labels.json: "koi no sirusi" puts Koi no Shirushi first, another spelling');
		h.ok(realFirst('toukyou jihen', function (t) { return t.artist === 'Tokyo Jihen'; }, 'loose'), 'labels.json: "toukyou jihen" puts Tokyo Jihen first');
		h.ok(realFirst('konekuto', function (t) { return t.titleAlt === 'Connect' && t.artist === 'ClariS'; }, 'romaji'), 'labels.json: "konekuto" puts ClariS\'s Connect (in katakana) first, by its reading');
		h.ok(realFirst('kiminoshiranai', function (t) { return t.titleAlt === 'Kimi no Shiranai Monogatari'; }, 'joined'), 'labels.json: "kiminoshiranai" puts Kimi no Shiranai Monogatari first, spaced differently');
		var uchu = F.search(rix, 'uchujin').map(function (x) { return rix.ids.indexOf(x.id) >= 0 && real.filter(function (t) { return t.id === x.id; })[0]; });
		h.ok(uchu.some(function (t) { return t.artist === 'Uchujin'; }) && uchu.some(function (t) { return t.titleAlt === 'Uchuujin'; }), 'labels.json: "uchujin" finds the artist Uchujin and the song Uchuujin');
		var realExact = function (q) { return ids(L.search(null, q, real)); };
		h.eq(['a', 'no', 'to', 'x'].filter(function (q) { var ex = realExact(q); return F.search(rix, q).some(function (x) { return ex.indexOf(x.id) < 0; }); }), [], 'labels.json: "a", "no", "to" and "x" find nothing library search does not');
		h.eq([F.search(rix, 'qxzv').length, F.search(rix, 'zzzz zzzz').length], [0, 0], 'labels.json: junk finds nothing');

		// ---- speed: 10,000 generated tracks ----------------------------------------------------------
		var seed = 7;
		function rand() { seed = seed + 0x6D2B79F5 | 0; var x = Math.imul(seed ^ seed >>> 15, 1 | seed); x = x + Math.imul(x ^ x >>> 7, 61 | x) ^ x; return ((x ^ x >>> 14) >>> 0) / 4294967296; }
		function pick(a) { return a[Math.floor(rand() * a.length)]; }
		var SYL = 'ka ki ku ke ko sa shi su se so ta chi tsu te to na ni nu ne no ha hi fu he ho ma mi mu me mo ya yu yo ra ri ru re ro wa n ga gi gu ge go'.split(' ');
		var EN = 'blue letters late meadow glass engine small current static quiet staircase lullaby electric rooftops morning lighthouse radio distant almanac bright crossing slow open orchard garden satellite copper telegram velvet crooked arcade amber window hidden hollow echo avenue atlas compass faded parade painted ferry second kindling silver signal midnight harbor winter tide northern sunken narrow mosaic salt weather'.split(' ');
		function jword() { var n = 2 + Math.floor(rand() * 3), s = ''; while (n--) s += pick(SYL); return s; }
		function kanaRun(n) { var s = ''; while (n--) s += cp(0x3042 + Math.floor(rand() * 80)); return s; }
		function kanjiRun(n) { var s = ''; while (n--) s += cp(0x4E00 + Math.floor(rand() * 2000)); return s; }
		var artists = [], works = [], big = [], i;
		for (i = 0; i < 1500; i++) artists.push(rand() < 0.5 ? pick(EN) + ' ' + pick(EN) : jword() + ' ' + jword());
		for (i = 0; i < 400; i++) works.push(jword() + ' no ' + jword());
		for (i = 0; i < 10000; i++) {
			var kind = rand(), g = { id: 'g' + i, artist: pick(artists), artistNative: rand() < 0.3 ? kanaRun(4) : '', work: rand() < 0.5 ? pick(works) : '', album: rand() < 0.3 ? pick(EN) + ' ' + pick(EN) : '', feat: rand() < 0.1 ? [pick(artists)] : [] };
			if (kind < 0.35) { g.title = pick(EN) + ' ' + pick(EN) + (rand() < 0.3 ? ' ' + pick(EN) : ''); g.titleAlt = ''; }
			else if (kind < 0.65) { g.title = kanaRun(3 + Math.floor(rand() * 6)); g.titleAlt = jword() + ' no ' + jword(); }
			else if (kind < 0.85) { g.title = kanjiRun(2) + kanaRun(2) + kanjiRun(2); g.titleAlt = jword() + ' ' + jword() + ' ' + jword(); }
			else { g.title = jword() + ' ' + jword(); g.titleAlt = ''; }
			big.push(g);
		}
		big[4321] = { id: 'g4321', title: 'Hikari', titleAlt: '', artist: 'Kalafina', artistNative: '', work: '', album: '', feat: [] };
		big = JSON.parse(JSON.stringify(big));   // flat strings, as the store hands them over
		t0 = process.hrtime.bigint();
		var bix = F.index(big), first = ms(t0);
		t0 = process.hrtime.bigint();
		bix = F.index(big);
		var rebuilt = ms(t0);
		// The first build meets every word for the first time; alone it takes about 110 ms here, but after
		// the whole suite (a big heap) or on a busy machine twice that, so it only fails far above the aim.
		h.ok(first < 600, 'speed: 10,000 new tracks indexed in ' + first.toFixed(0) + ' ms (the aim is 150; this fails over 600)');
		h.ok(rebuilt < 150, 'speed: indexed again after a change in ' + rebuilt.toFixed(0) + ' ms (at most 150)');
		var queries = ['kalafna hikari', 'tokyo', 'shiranai monogatari', 'lighthose', 'copper telegrm', 'kiminoshiranai', 'sakura no uta', 'no', 'electric', 'meadw'];
		queries.forEach(function (q) { F.search(bix, q, { limit: 50 }); });
		t0 = process.hrtime.bigint();
		for (var rep = 0; rep < 3; rep++) queries.forEach(function (q) { F.search(bix, q, { limit: 50 }); });
		var each10 = ms(t0) / (queries.length * 3);
		h.ok(each10 < 15, 'speed: a query over 10,000 tracks in ' + each10.toFixed(1) + ' ms on average (at most 15)');
		h.eq(F.search(bix, 'kalafna hikari')[0].id, 'g4321', 'speed: and the right song comes first among them');
	});
};
