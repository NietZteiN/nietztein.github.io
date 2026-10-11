// quiz: Guess the anime. The pool, the choices per level, seeded rounds,
// the preview picker, the score, typed answers, and whole games against a
// fake iTunes Search (no network).
module.exports = function (h) {
	var path = require('path');
	var Q = require(path.join(h.HERE, 'quiz.js'));
	var S = require(path.join(h.HERE, 'shuffle.js'));

	function cp() { return String.fromCharCode.apply(null, arguments); }
	function fold(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, ''); }
	function tr(id, title, artist, work, role, scene, year, extra) {
		var t = { id: id, title: title, artist: artist, artistKey: fold(artist), work: work, role: role, scene: scene, year: year, yearSource: 'label', kind: 'song', embeddable: true, removed: false, playerError: null, blocked: false, durationSec: 240 };
		Object.keys(extra || {}).forEach(function (k) { t[k] = extra[k]; });
		return t;
	}
	// Nine works: six anime (2010 to 2021), two visual novels, a game. Ghost
	// Lantern's only song has no preview on the fake iTunes.
	var LIB = [
		tr('sf-op1', 'Blue Signal', 'Paper Lanterns', 'Starfall Odyssey', 'OP', 'anime', 2019),
		tr('sf-ed1', 'Ember Fields', 'Glass Orchard', 'Starfall Odyssey', 'ED', 'anime', 2019),
		tr('sf-op2', 'Northern Lights Engine', 'Paper Lanterns', 'Starfall Odyssey', 'OP', 'anime', 2020),
		tr('ks-op1', 'Late Ferry', 'Kumori Station', 'Kumori Station Anime', 'OP', 'anime', 2021),
		tr('ks-ed1', 'Painted Rooftops', 'Kumori Station', 'Kumori Station Anime', 'ED', 'anime', 2021),
		tr('mr-op1', 'Winter Almanac', 'Neon Abacus', 'Moonlit Relay', 'OP', 'anime', 2020),
		tr('hl-op1', 'Glass Engine', 'Quiet Ferrymen', 'Harbor Lights Academy', 'OP', 'anime', 2010),
		tr('hl-ed1', 'Morning Lighthouse', 'Marrow & Pine', 'Harbor Lights Academy', 'ED', 'anime', 2010),
		tr('pp-op1', 'Counting Backwards', 'Saffron Circuit', 'Paper Planet', 'OP', 'anime', 2018),
		tr('gl-op1', 'Lantern Ghost', 'Twin Rivers', 'Ghost Lantern', 'OP', 'anime', 2019),
		tr('sg-op1', 'Salt Kindling', 'Tin Lighthouse Trio', 'Signal Garden', 'OP', 'vn', 2015),
		tr('ow-op1', 'Velvet Static', 'Hollow Compass', 'Orchid Window', 'OP', 'vn', 2016),
		tr('ct-ed1', 'Paper Echo', 'DJ Tessellate', 'Clockwork Tide', 'ED', 'game', 2012)
	];
	// Tracks that never join the pool (the insert song does when asked).
	var OUT = [
		tr('x-theme', 'Theme Song', 'Paper Lanterns', 'Starfall Odyssey', 'theme', 'anime', 2019),
		tr('x-ost', 'Score Cue', 'Paper Lanterns', 'Starfall Odyssey', 'OST', 'anime', 2019),
		tr('x-insert', 'Insert Song', 'Glass Orchard', 'Starfall Odyssey', 'insert', 'anime', 2019),
		tr('x-gone', 'Removed', 'Paper Lanterns', 'Moonlit Relay', 'ED', 'anime', 2020, { removed: true }),
		tr('x-noembed', 'No Embed', 'Paper Lanterns', 'Moonlit Relay', 'ED', 'anime', 2020, { embeddable: false }),
		tr('x-err', 'Player Error', 'Paper Lanterns', 'Moonlit Relay', 'ED', 'anime', 2020, { playerError: 150 }),
		tr('x-blocked', 'Blocked', 'Paper Lanterns', 'Moonlit Relay', 'ED', 'anime', 2020, { blocked: true }),
		tr('x-clip', 'A Clip', 'Paper Lanterns', 'Moonlit Relay', 'OP', 'anime', 2020, { kind: 'clip' }),
		tr('x-set', 'A Medley', 'Paper Lanterns', 'Moonlit Relay', 'OP', 'anime', 2020, { kind: 'set' }),
		tr('x-noartist', 'No Artist', '', 'Moonlit Relay', 'OP', 'anime', 2020),
		tr('x-nowork', 'No Work', 'Paper Lanterns', '', 'OP', 'anime', 2020),
		tr('x-onlyost', 'Only A Cue', 'Glass Orchard', 'Score Only Show', 'OST', 'anime', 2019)
	];
	var ALL = LIB.concat(OUT);
	var PV = 'https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview125/v4/';

	// A fake iTunes Search: each term the quiz would send for a library song
	// answers with a decoy first and the song itself (unless listed in none).
	function fakeITunes(lib, o) {
		o = o || {};
		var log = [], byTerm = {};
		lib.forEach(function (t) { Q.searchTerms(t).forEach(function (term) { (byTerm[term] = byTerm[term] || []).push(t); }); });
		function answer(results) { return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({ resultCount: results.length, results: results }); } }); }
		function fetch(url, init) {
			log.push({ url: url, init: init });
			var term = decodeURIComponent(/[?&]term=([^&]*)/.exec(url)[1].replace(/\+/g, ' '));
			var special = o.on && o.on(term, log.length);
			if (special) return special;
			var results = [{ wrapperType: 'track', kind: 'song', trackName: 'Something Else', artistName: 'Nobody', previewUrl: PV + 'decoy.m4a', trackTimeMillis: 200000 }];
			(byTerm[term] || []).forEach(function (t) {
				if ((o.none || {})[t.id]) return;
				results.push({ wrapperType: 'track', kind: 'song', trackName: t.title, artistName: t.artist, previewUrl: PV + t.id + '.m4a', trackTimeMillis: 241000, trackViewUrl: 'https://music.apple.com/jp/album/x/1?i=2&uo=4' });
			});
			return answer(results);
		}
		return { fetch: fetch, log: log, answer: answer };
	}
	function wait(ms) { return new Promise(function (r) { setTimeout(r, ms || 0); }); }
	function names(list) { return list.map(function (w) { return w.name; }); }

	h.describe('quiz', async function () {
		// ---- the pool ----
		var p = Q.pool(ALL);
		h.eq(p.ids, LIB.map(function (t) { return t.id; }).sort(), 'pool: openings and endings that play, with a work and an artist; not themes, scores, removed, unembeddable, refused, blocked, clips, sets, songs without an artist or a work');
		h.eq(names(p.works), ['Clockwork Tide', 'Ghost Lantern', 'Harbor Lights Academy', 'Kumori Station Anime', 'Moonlit Relay', 'Orchid Window', 'Paper Planet', 'Signal Garden', 'Starfall Odyssey'], 'pool: one entry per work with at least one such song (a work with only score cues is not one)');
		h.eq([p.ok, p.songs, p.need], [true, 13, 4], 'pool: nine works, enough to play');
		var sf = p.byWork['Starfall Odyssey'];
		h.eq([sf.scene, sf.year, sf.ids], ['anime', 2019, ['sf-ed1', 'sf-op1', 'sf-op2']], 'pool: a work carries its scene, its first year and its songs');
		h.ok(Q.pool(ALL, { inserts: true }).ids.indexOf('x-insert') >= 0 && p.ids.indexOf('x-insert') < 0, 'pool: insert songs only when asked');
		var asMap = {};
		ALL.forEach(function (t) { asMap[t.id] = t; });
		h.eq(JSON.stringify(Q.pool(asMap)), JSON.stringify(p), 'pool: a { id: track } map gives the same pool as a list');
		h.eq(JSON.stringify(Q.pool(ALL.slice().reverse())), JSON.stringify(p), 'pool: the order of the tracks does not matter');
		var frozen = ALL.map(function (t) { return Object.freeze(Object.assign({}, t)); });
		h.eq(JSON.stringify(Q.pool(frozen)), JSON.stringify(p), 'pool: reads the tracks without changing them');
		var three = Q.pool(LIB.filter(function (t) { return ['Starfall Odyssey', 'Moonlit Relay', 'Signal Garden'].indexOf(t.work) >= 0; }));
		h.eq([three.ok, three.works.length], [false, 3], 'pool: three works are not enough');
		var cov = Q.pool([
			tr('o1', 'Rain Song', 'Paper Lanterns', 'Rain Show', 'OP', 'anime', 2008),
			tr('c1', 'Rain Song', 'Some Utaite', 'Rain Show', 'OP', 'utaite', 2021, { origArtist: 'Paper Lanterns', version: 'cover' }),
			tr('c2', 'Rain Song', 'Other Utaite', 'Rain Show', 'OP', 'utaite', 2022, { origArtist: 'Paper Lanterns', version: 'cover' }),
			tr('u1', 'Up Song', 'Neon Abacus', 'Upload Show', 'OP', 'anime', 2015, { yearSource: 'upload' })
		]);
		h.eq([cov.byWork['Rain Show'].scene, cov.byWork['Rain Show'].year, cov.byWork['Upload Show'].year], ['anime', 2008, 0], 'pool: covers do not decide a work\'s scene or year; an upload\'s year is not a year');
		var spell = Q.pool([
			tr('t1', 'Pre-Parade', 'Rie Kugimiya', 'Toradora!', 'OP', 'anime', 2008),
			tr('t2', 'Vanilla Salt', 'Yui Horie', 'Toradora!', 'ED', 'anime', 2008),
			tr('t3', 'Orange', 'Rie Kugimiya', 'Toradora', 'ED', 'anime', 2009),
			tr('m1', 'Mishima Closing', 'Philip Glass', 'Mishima: A Life in Four Chapters', 'ED', 'film', 1985)
		]);
		h.eq([names(spell.works), spell.byWork['Toradora!'].ids, spell.byWork['Toradora!'].aliases], [['Mishima: A Life in Four Chapters', 'Toradora!'], ['t1', 't2', 't3'], ['Toradora!', 'Toradora']], 'pool: spellings of one work are one work, named the commonest way, the others kept as aliases');
		h.eq(spell.byWork['Mishima: A Life in Four Chapters'].aliases, ['Mishima: A Life in Four Chapters', 'Mishima'], 'pool: the main title before a colon is an alias');
		h.eq(Q.pool([tr('a', 'Song', 'Artist', 'Show', 'OP', 'anime', 2000)], { aliases: { Show: ['The Show Proper'] } }).byWork.Show.aliases, ['Show', 'The Show Proper'], 'pool: aliases passed in join the work\'s');

		// ---- the choices ----
		var bad = { dup: 0, once: 0, foreign: 0, scene: 0, near: 0, vn: 0 };
		for (var s = 0; s < 150; s++) {
			['easy', 'normal', 'hard'].forEach(function (lv) {
				p.works.forEach(function (w) {
					var c = Q.choicesFor(w, p.works, S.rng('choices-' + lv + '-' + s), lv);
					if (c.length !== 4 || new Set(c).size !== 4) bad.dup++;
					if (c.filter(function (x) { return x === w.name; }).length !== 1) bad.once++;
					if (c.some(function (x) { return !p.byWork[x]; })) bad.foreign++;
					var wrong = c.filter(function (x) { return x !== w.name; }).map(function (x) { return p.byWork[x]; });
					if (lv === 'normal' && w.scene === 'anime' && wrong.some(function (x) { return x.scene !== 'anime'; })) bad.scene++;
					if (lv === 'hard' && w.name === 'Starfall Odyssey' && wrong.some(function (x) { return x.scene !== 'anime' || Math.abs(x.year - 2019) > 3; })) bad.near++;
					if (lv === 'normal' && w.name === 'Signal Garden' && c.indexOf('Orchid Window') < 0) bad.vn++;
				});
			});
		}
		h.eq([bad.dup, bad.once, bad.foreign], [0, 0, 0], 'choices: four different works, the answer exactly once, all from the pool (150 seeds, every work, every level)');
		h.eq(bad.scene, 0, 'choices: Normal takes the other three from the answer\'s scene when it has three more');
		h.eq(bad.vn, 0, 'choices: Normal takes the one other visual novel there is, then fills from other scenes');
		h.eq(bad.near, 0, 'choices: Hard takes the same scene within three years when there are three such works');
		var harbor = Q.choicesFor('Harbor Lights Academy', p.works, S.rng('h'), 'hard');
		h.ok(harbor.every(function (x) { return p.byWork[x].scene === 'anime'; }), 'choices: Hard with no work near in years keeps to the scene: ' + harbor.join(', '));
		var seenEasy = {};
		for (var e = 0; e < 60; e++) Q.choicesFor('Starfall Odyssey', p.works, S.rng('easy-' + e), 'easy').forEach(function (x) { seenEasy[p.byWork[x].scene] = true; });
		h.ok(seenEasy.vn && seenEasy.game, 'choices: Easy draws from any scene');
		var at = {};
		for (var a = 0; a < 400; a++) at[Q.choicesFor('Moonlit Relay', p.works, S.rng('pos-' + a), 'easy').indexOf('Moonlit Relay')] = true;
		h.eq(Object.keys(at).sort(), ['0', '1', '2', '3'], 'choices: the answer can be any of the four buttons');
		var fr = [{ name: 'Starfall Odyssey', scene: 'anime', year: 2019 }, { name: 'Starfall Odyssey Zero', scene: 'anime', year: 2020 }, { name: 'Starfall Odyssey Movie', scene: 'anime', year: 2021 },
			{ name: 'Kumori Station Anime', scene: 'anime', year: 2021 }, { name: 'Moonlit Relay', scene: 'anime', year: 2020 }, { name: 'Paper Planet', scene: 'anime', year: 2018 }];
		var relN = { normal: 0, hard: 0 };
		for (var f = 0; f < 100; f++) {
			relN.normal += Q.choicesFor('Starfall Odyssey', fr, S.rng('fr-' + f), 'normal').filter(function (x) { return /Starfall Odyssey /.test(x); }).length;
			relN.hard = Math.max(relN.hard, Q.choicesFor('Starfall Odyssey', fr, S.rng('fr-' + f), 'hard').filter(function (x) { return /Starfall Odyssey /.test(x); }).length);
		}
		h.eq([relN.normal, relN.hard], [0, 1], 'choices: Normal keeps works of the same franchise out while others fit; Hard allows one at most');

		// ---- rounds: seeded ----
		var r1 = Q.makeRound(p, S.rng('seed-7'), { level: 'normal' });
		h.eq(JSON.stringify(Q.makeRound(p, S.rng('seed-7'), { level: 'normal' })), JSON.stringify(r1), 'makeRound: the same seed gives the same round');
		h.eq(JSON.stringify(Q.makeRound(Q.pool(ALL.slice().reverse()), S.rng('seed-7'), { level: 'normal' })), JSON.stringify(r1), 'makeRound: whatever order the library came in');
		var distinct = {};
		for (var d = 0; d < 20; d++) distinct[JSON.stringify(Q.makeRound(p, S.rng('d-' + d), { level: 'normal' }))] = true;
		h.ok(Object.keys(distinct).length >= 10, 'makeRound: other seeds, other rounds (' + Object.keys(distinct).length + ' of 20 differ)');
		h.ok(r1.choices[r1.answer] === r1.work && p.byWork[r1.work].ids.indexOf(r1.id) >= 0 && r1.clipSec === 7 && r1.startSec >= 0 && r1.startSec < 20, 'makeRound: the answer names the song\'s work; Normal plays 7 s from somewhere in the first 20');
		h.eq(['easy', 'normal', 'hard'].map(function (lv) { return Q.makeRound(p, S.rng('x'), { level: lv }).clipSec; }), [10, 7, 4], 'makeRound: 10, 7 and 4 seconds');
		var avoidAll = { ids: p.ids.filter(function (id) { return id !== 'ct-ed1'; }) };
		h.eq(Q.makeRound(p, S.rng('only'), { avoid: avoidAll }).id, 'ct-ed1', 'makeRound: avoided songs never come');
		h.eq(Q.makeRound(p, S.rng('none'), { avoid: p.ids }), null, 'makeRound: nothing left, no round');
		var worksAvoided = { works: names(p.works).filter(function (n) { return n !== 'Paper Planet'; }) };
		var onlyFresh = {};
		for (var w2 = 0; w2 < 30; w2++) onlyFresh[Q.makeRound(p, S.rng('fresh-' + w2), { avoid: worksAvoided }).work] = true;
		h.eq(Object.keys(onlyFresh), ['Paper Planet'], 'makeRound: a work not asked yet comes before the others');
		h.eq(Q.makeRound(p, S.rng('same'), { avoid: { ids: ['sf-op1'], songs: [S.songKey(LIB[2])] } }).id !== 'sf-op2', true, 'makeRound: a song already asked in another upload is avoided too');
		h.eq([Q.roleLabel({ role: 'OP', raw: { title: 'Starfall Odyssey Opening 2 (HD)' } }), Q.roleLabel({ role: 'ED', raw: { title: '[NCED3] creditless' } }), Q.roleLabel({ role: 'OP', raw: { title: 'Ending 4' } }), Q.roleLabel({ role: 'insert' }), Q.roleLabel({ role: 'OP', raw: { title: 'Ending 2005' } })],
			['OP2', 'ED3', 'OP', 'Insert song', 'OP'], 'roleLabel: OP2 when the upload numbers it, the plain role otherwise');

		// ---- previews ----
		var song = LIB[0];
		var res = [
			{ kind: 'song', trackName: 'Blue Signal', artistName: 'Someone Else', previewUrl: PV + 'other-artist.m4a' },
			{ kind: 'song', trackName: 'Blue Signal (Instrumental)', artistName: 'Paper Lanterns', previewUrl: PV + 'inst.m4a', trackTimeMillis: 240500 },
			{ kind: 'music-video', trackName: 'Blue Signal', artistName: 'Paper Lanterns', previewUrl: PV + 'video.m4v' },
			{ kind: 'song', trackName: 'Blue Signal', artistName: 'Paper Lanterns', previewUrl: 'http://audio-ssl.itunes.apple.com/plain-http.m4a' },
			{ kind: 'song', trackName: 'Blue Signal', artistName: 'Paper Lanterns', previewUrl: PV + 'right.m4a', trackTimeMillis: 240400, trackViewUrl: 'https://music.apple.com/jp/album/blue-signal/1?i=2&uo=4' },
			null, 'junk'
		];
		var pk = Q.pickPreview(res, song);
		h.eq([pk && pk.url, pk && pk.link, pk && pk.durationSec], [PV + 'right.m4a', 'https://music.apple.com/jp/album/blue-signal/1?i=2', 240], 'pickPreview: the song itself, over another artist\'s, an instrumental, a video and a plain-http address');
		h.eq(Q.pickPreview([res[0], res[2], res[3]], song), null, 'pickPreview: nothing that is this song, no preview');
		h.eq([Q.pickPreview([], song), Q.pickPreview(null, song), Q.pickPreview(res, null)], [null, null, null], 'pickPreview: no results, no preview');
		h.eq(Q.pickPreview([{ kind: 'song', trackName: 'Blue Signal', artistName: 'Paper Lanterns', previewUrl: 'https://evil.example/x.m4a' }], song), null, 'pickPreview: only Apple\'s preview host');
		h.eq(Q.pickPreview([{ trackName: 'Blue Signal', artistName: 'Paper Lanterns', previewUrl: 'http://127.0.0.1:9/clip.wav' }], song, { ok: function (u) { return u.indexOf('http://127.0.0.1') === 0; } }).url, 'http://127.0.0.1:9/clip.wav', 'pickPreview: a test may allow its own audio server');
		var HIKARU = cp(0x5149, 0x308B, 0x306A, 0x3089);
		h.eq(Q.pickPreview([{ kind: 'song', trackName: HIKARU, artistName: 'Goose house', previewUrl: PV + 'hikaru.m4a' }], { title: 'Hikaru Nara', titleAlt: HIKARU, artist: 'Goose house', durationSec: 250 }).url, PV + 'hikaru.m4a', 'pickPreview: Japan\'s store titles the song in Japanese; the labels\' titleAlt meets it');
		var THESIS = cp(0x6B8B, 0x9177, 0x306A, 0x5929, 0x4F7F, 0x306E, 0x30C6, 0x30FC, 0x30BC), TAKAHASHI = cp(0x9AD8, 0x6A4B, 0x6D0B, 0x5B50);
		var eva = { title: 'A Cruel Angel\'s Thesis', titleAlt: THESIS, artist: 'Yoko Takahashi', artistNative: TAKAHASHI };
		h.eq(Q.pickPreview([{ kind: 'song', trackName: THESIS, artistName: TAKAHASHI, previewUrl: PV + 'eva.m4a' }], eva).url, PV + 'eva.m4a', 'pickPreview: the artist under its native name');
		h.eq(Q.searchTerms(eva), [TAKAHASHI + ' ' + THESIS, 'Yoko Takahashi A Cruel Angel\'s Thesis'], 'searchTerms: the native name and the Japanese title first, then the names as the library has them');
		h.eq(Q.searchTerms({ title: 'Rain Song (TV Size)', artist: 'Some Utaite', origArtist: 'Paper Lanterns' }), ['Some Utaite Rain Song', 'Paper Lanterns Rain Song'], 'searchTerms: a cover asks for the original artist second; decoration off the title');
		h.eq(Q.searchUrl('Paper Lanterns Blue Signal'), 'https://itunes.apple.com/search?term=Paper+Lanterns+Blue+Signal&country=JP&media=music&entity=song&limit=5', 'searchUrl: Japan\'s store, songs, five results');
		h.ok(Q.searchUrl('A&B ' + HIKARU).indexOf('term=A%26B+%E5%85%89') > 0, 'searchUrl: the term is encoded');

		// ---- the score ----
		var s0 = Q.score(null);
		h.eq(s0, { points: 0, right: 0, wrong: 0, streak: 0, best: 0, last: 0 }, 'score(null): a new game');
		var s1 = Q.score(s0, true, 1500), s2 = Q.score(s1, true, 8500), s3 = Q.score(s2, false, 900), s4 = Q.score(s3, true, 20000);
		h.eq([s1.last, s2.last, s3.last, s4.last], [150, 125, 0, 100], 'score: 100 a right answer, up to 50 more for speed (all within 2 s, none after 15 s)');
		h.eq([s2.streak, s3.streak, s4.streak, s4.best, s4.right, s4.wrong, s4.points], [2, 0, 1, 2, 3, 1, 375], 'score: a wrong answer ends the streak; the best streak stays');
		h.eq(s0, { points: 0, right: 0, wrong: 0, streak: 0, best: 0, last: 0 }, 'score: the state given is not changed');

		// ---- typed answers ----
		var tp = Q.pool(LIB.concat([
			tr('m1', 'Mishima Closing', 'Philip Glass', 'Mishima: A Life in Four Chapters', 'ED', 'film', 1985),
			tr('mo1', 'Staple Stable', 'Chiwa Saito', 'Bakemonogatari', 'OP', 'anime', 2009),
			tr('mo2', 'Renai Circulation', 'Kana Hanazawa', 'Monogatari Second Season', 'OP', 'anime', 2013)
		]));
		var round = { choices: ['Mishima: A Life in Four Chapters', 'Starfall Odyssey', 'Bakemonogatari', 'Monogatari Second Season'] };
		h.eq(['starfall odyssey', 'STARFALL-ODYSSEY!', 'Mishima', 'Starfall', 'Bakemonogatari'].map(function (x) { return Q.typed(x, round, tp); }), [1, 1, 0, 1, 2], 'typed: the name in any case or punctuation, an alias, a part of four letters or more');
		h.eq(['monogatari', 'Kumori Station', '', 'zz'].map(function (x) { return Q.typed(x, round, tp); }), [-1, -1, -1, -1], 'typed: a name that fits two choices, none, or nothing, names no choice');

		// ---- a whole game ----
		var it = fakeITunes(LIB, { none: { 'gl-op1': true } });
		var g = Q.createGame({ tracks: ALL, rand: S.rng('game-1'), level: 'normal', fetch: it.fetch, gapMs: 0 });
		var phases = [];
		g.on(function (st) { if (phases[phases.length - 1] !== st.phase) phases.push(st.phase); });
		h.eq([g.state().phase, g.answer(0, 100), g.round()], ['idle', null, null], 'game: nothing to answer before it starts');
		var st = await g.start();
		h.eq([st.phase, st.index, st.total], ['question', 0, 10], 'game: start looks the first round up');
		h.ok(it.log[0].init && it.log[0].init.credentials === 'omit' && it.log[0].init.referrerPolicy === 'no-referrer', 'game: requests go without cookies or a referrer');
		var seen = [], works = [], wrongIds = [], answers = [], goodUrls = true;
		for (var i = 0; i < 10; i++) {
			var r = g.round();
			if (!r || !r.preview || r.preview.url !== PV + r.id + '.m4a') goodUrls = false;
			seen.push(r.id);
			works.push(r.work);
			var pick = i % 3 === 2 ? (r.answer + 1) % 4 : r.answer;
			if (pick !== r.answer) wrongIds.push(r.id);
			var got = i === 4 ? g.answer(r.choices[pick], 3000) : g.answer(pick, 1000 * i);
			answers.push(got && got.right);
			h.eq(g.answer(pick, 10), null, 'game: one answer per round (' + (i + 1) + ')');
			await wait(2);
			st = await g.next();
		}
		h.ok(goodUrls, 'game: every round carries the preview of its own song');
		h.eq(answers, [true, true, false, true, true, false, true, true, false, true], 'game: answers by index or by name, right and wrong as chosen');
		h.eq(st.phase, 'summary', 'game: ten rounds, then the summary');
		h.eq(new Set(seen).size, 10, 'game: ten different songs');
		h.eq(new Set(works.slice(0, 8)).size, 8, 'game: the eight works with previews all come before any comes twice');
		h.ok(seen.indexOf('gl-op1') < 0, 'game: the song without a preview never comes');
		var sum = g.summary();
		h.eq([sum.played, sum.right, sum.wrong, sum.best, sum.level, sum.missed.map(function (m) { return m.id; })], [10, 7, 3, 2, 'normal', wrongIds], 'game: the summary counts the answers and lists the songs missed');
		h.ok(sum.skipped === 1 && it.log.some(function (x) { return x.url.indexOf('Twin+Rivers') > 0; }), 'game: the song without a preview was asked about once and skipped');
		h.eq([it.log.length, g.state().asked], [11, 11], 'game: one request per song, none beyond the tenth round');
		h.eq(sum.points, sum.history.reduce(function (n, x) { return n + x.points; }, 0), 'game: the points add up');
		var expected = ['loading'];
		for (var x = 0; x < 10; x++) expected.push('question', 'answered');
		expected.push('summary');
		h.eq(phases, expected, 'game: loading once, then each round ready when asked for (looked up ahead), then the summary');
		h.eq(g.answer(0, 1), null, 'game: no answers after the summary');

		var g2 = Q.createGame({ tracks: ALL.slice().reverse(), rand: S.rng('game-1'), level: 'normal', fetch: fakeITunes(LIB, { none: { 'gl-op1': true } }).fetch, gapMs: 0 });
		await g2.start();
		var seen2 = [];
		for (var j = 0; j < 10; j++) { seen2.push(g2.round().id + ':' + g2.round().choices.join('|')); g2.answer(0, 0); await g2.next(); }
		var g1again = Q.createGame({ tracks: ALL, rand: S.rng('game-1'), level: 'normal', fetch: fakeITunes(LIB, { none: { 'gl-op1': true } }).fetch, gapMs: 0 });
		await g1again.start();
		var seen1 = [];
		for (var k = 0; k < 10; k++) { seen1.push(g1again.round().id + ':' + g1again.round().choices.join('|')); g1again.answer(1, 0); await g1again.next(); }
		h.eq(seen2, seen1, 'game: the same seed plays the same game, whatever order the library came in');

		// ---- what goes wrong ----
		h.eq((await Q.createGame({ tracks: three.ids.map(function (id) { return three.byId[id]; }), fetch: it.fetch }).start()).phase, 'empty', 'game: fewer than four works: empty');
		var nf = await Q.createGame({ tracks: ALL }).start();
		h.ok(nf.phase === 'error' && /cannot ask iTunes/.test(nf.error), 'game: no fetch, an error that says so');

		// a 403 holds the line for pauseMs, then the game goes on
		var hits = 0, t0 = Date.now();
		var rl = fakeITunes(LIB, { on: function () { hits++; return hits === 1 ? Promise.resolve({ ok: false, status: 403, json: function () { return Promise.resolve({}); } }) : null; } });
		var gr = Q.createGame({ tracks: LIB, rand: S.rng('rate'), fetch: rl.fetch, gapMs: 0, pauseMs: 60, retryMs: 5 });
		st = await gr.start();
		h.ok(st.phase === 'question' && Date.now() - t0 >= 55 && rl.log.length >= 2, 'game: iTunes asks for a pause (403): the requests wait, then the game goes on (' + (Date.now() - t0) + ' ms)');
		gr.stop();

		// three network failures in a row: an error; retry goes on
		var down = true;
		var nw = fakeITunes(LIB, { on: function () { return down ? Promise.reject(new TypeError('Failed to fetch')) : null; } });
		var gn = Q.createGame({ tracks: LIB, rand: S.rng('net'), fetch: nw.fetch, gapMs: 0, retryMs: 5 });
		st = await gn.start();
		h.ok(st.phase === 'error' && /could not be reached/.test(st.error) && nw.log.length === 3, 'game: three failed requests in a row stop the game with a sentence (' + st.error + ')');
		down = false;
		st = await gn.retry();
		h.eq(st.phase, 'question', 'game: retry looks again and the game goes on');
		gn.stop();

		// no previews at all: an error, not a hang
		var gz = Q.createGame({ tracks: LIB, rand: S.rng('zero'), fetch: fakeITunes(LIB, { none: (function () { var o = {}; LIB.forEach(function (t) { o[t.id] = true; }); return o; })() }).fetch, gapMs: 0 });
		st = await gz.start();
		h.ok(st.phase === 'error' && st.skipped === 13 && /preview/.test(st.error), 'game: when no song has a preview, it says so (' + st.error + ')');

		// skip: the clip would not play; another song takes the round
		var gs = Q.createGame({ tracks: LIB, rand: S.rng('skip'), fetch: fakeITunes(LIB).fetch, gapMs: 0 });
		st = await gs.start();
		var before = gs.round().id;
		st = await gs.skip();
		h.ok(st.phase === 'question' && gs.round().id !== before && st.skipped === 1 && st.index === 0, 'skip: another song in the same round');
		gs.stop();

		// the memo (and the store's cache) keep answers between games
		var memo = {}, mi = fakeITunes(LIB);
		var gm = Q.createGame({ tracks: LIB, rand: S.rng('memo'), fetch: mi.fetch, gapMs: 0, memo: memo });
		await gm.start();
		await wait(20);
		var asked = mi.log.length;
		var gm2 = Q.createGame({ tracks: LIB, rand: S.rng('memo'), fetch: mi.fetch, gapMs: 0, memo: memo });
		await gm2.start();
		await wait(20);
		h.eq([asked, mi.log.length, gm2.round().id], [3, 3, gm.round().id], 'game: the first round and two ahead are looked up; a game with the same memo asks nothing again');
		gm.stop();
		gm2.stop();
		var store = {}, puts = 0, cache = {
			wrap: function (key, ttl, fn, o) { if (key in store) return Promise.resolve(store[key]); return Promise.resolve(fn()).then(function (v) { puts++; store[key] = v; return v; }); },
			put: function (key, v) { store[key] = v; return Promise.resolve(); }
		};
		var ci = fakeITunes(LIB);
		var gc = Q.createGame({ tracks: LIB, rand: S.rng('cache'), fetch: ci.fetch, gapMs: 0, cache: cache });
		await gc.start();
		await wait(20);
		var gc2 = Q.createGame({ tracks: LIB, rand: S.rng('cache'), fetch: ci.fetch, gapMs: 0, cache: cache });
		await gc2.start();
		await wait(20);
		h.ok(puts === 3 && ci.log.length === 3 && Object.keys(store).every(function (k) { return /^qz:it:JP:/.test(k); }), 'game: answers are kept in the cache under qz:it: keys, and read back');
		gc.stop();
		gc2.stop();

		// a cover with no preview of its own plays its original
		var COVER = [tr('cv1', 'Rain Song', 'Some Utaite', 'Rain Show', 'OP', 'anime', 2021, { origArtist: 'Paper Lanterns', version: 'cover' })].concat(LIB.filter(function (t) { return t.work !== 'Ghost Lantern'; }));
		var co = fakeITunes(COVER, { on: function (term) { return term === 'Some Utaite Rain Song' ? co.answer([{ kind: 'song', trackName: 'Rain Song', artistName: 'Paper Lanterns', previewUrl: PV + 'original.m4a' }]) : null; } });
		var cp1 = Q.pool(COVER);
		var gco = Q.createGame({ pool: cp1, rand: S.rng('cover'), fetch: co.fetch, gapMs: 0, rounds: 9 });
		st = await gco.start();
		var coverRound = null;
		for (var q = 0; q < 9 && st.phase !== 'summary'; q++) { var rr = gco.round(); if (rr.id === 'cv1') coverRound = rr; gco.answer(rr.answer, 0); st = await gco.next(); }
		h.ok(coverRound && coverRound.preview.url === PV + 'original.m4a' && coverRound.preview.original === true, 'game: a cover without a preview of its own gets the original recording\'s, marked original');
		h.eq([st.phase, gco.summary().played], ['summary', 9], 'game: rounds can be fewer than ten');
		// a pool that runs out: the summary comes early
		var FOUR = LIB.filter(function (t) { return ['sf-op1', 'ks-op1', 'mr-op1', 'sg-op1'].indexOf(t.id) >= 0; });
		var g4 = Q.createGame({ tracks: FOUR, rand: S.rng('four'), fetch: fakeITunes(FOUR).fetch, gapMs: 0 });
		st = await g4.start();
		for (var y = 0; y < 10 && st.phase === 'question'; y++) { g4.answer(g4.round().answer, 0); await wait(2); st = await g4.next(); }
		h.eq([st.phase, st.total, g4.summary().played, g4.summary().right], ['summary', 4, 4, 4], 'game: four songs, four rounds, then the summary (no round twice)');
	});
};
