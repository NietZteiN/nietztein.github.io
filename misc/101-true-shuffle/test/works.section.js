/*
 * works.js: which anime a song is from and its franchise, against the
 * invented answers in test/fixtures through the in-process fake
 * (createSourceFake().fetch) behind sources.js's own clients, with fixture
 * variants made here: a series reached only through its series' name, a
 * crossover, and soundtrack albums. Loaded by test.js, which runs it as the
 * section "works".
 */
'use strict';
var path = require('path');
var url = require('url');

module.exports = function (h) {
	var DAY = 86400000, T = Date.UTC(2026, 9, 10, 12);
	var HIKARI = String.fromCharCode(0x3072, 0x304B, 0x308A, 0x306E, 0x5730, 0x56F3);
	var ANIME_JA = String.fromCharCode(0x30A2, 0x30CB, 0x30E1);

	function json(x) { return JSON.parse(JSON.stringify(x)); }
	// A library track as library.js leaves one (the fields match.js and works.js read).
	function tr(id, title, artist, more) {
		var t = { id: id, title: title, artist: artist, titleAlt: '', artistNative: '', origArtist: '', scene: '', work: '', role: '', lang: '', kind: 'song', version: '', durationSec: 0, guess: { artist: '', title: '', rule: 'none', confidence: 0 } };
		Object.keys(more || {}).forEach(function (k) { t[k] = more[k]; });
		return t;
	}
	// AnimeThemes and iTunes records in the shapes of test/fixtures.
	function atArtist(id, name, slug) { return { id: id, name: name, slug: slug, information: null, artistsong: { id: id + 1000, alias: null, as: null, member_alias: null, member_as: null, relevance: null } }; }
	function atTheme(id, type, seq, songId, title, artists) { return { id: id, sequence: seq, slug: type + (seq || 1), type: type, song: { id: songId, title: title, artists: artists } }; }
	function atAnime(id, slug, name, year, season, format, themes, series) {
		return { id: id, name: name, media_format: format, season: season, slug: slug, synopsis: 'Invented.', year: year, animethemes: themes, series: series, resources: [], animesynonyms: [] };
	}
	function itTrack(trackId, collectionId, n, name, artist, artistId, collection, genre) {
		return {
			wrapperType: 'track', kind: 'song', artistId: artistId, collectionId: collectionId, trackId: trackId, artistName: artist, collectionName: collection, trackName: name,
			previewUrl: 'https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview00/v4/fa/ke/00/fake-' + trackId + '/mzaf_' + trackId + '.plus.aac.p.m4a',
			artworkUrl100: 'https://is1-ssl.mzstatic.com/image/thumb/Music00/v4/fa/ke/00/fake-' + collectionId + '/source/100x100bb.jpg',
			releaseDate: '2020-01-01T08:00:00Z', discNumber: 1, trackNumber: n, trackTimeMillis: 90000 + n * 1000, primaryGenreName: genre
		};
	}
	function itAlbum(collectionId, name, artist, artistId, genre, count) {
		return {
			wrapperType: 'collection', collectionType: 'Album', artistId: artistId, collectionId: collectionId, artistName: artist, collectionName: name,
			collectionViewUrl: 'https://music.apple.com/jp/album/x/' + collectionId + '?uo=4', artworkUrl100: 'https://is1-ssl.mzstatic.com/image/thumb/Music00/v4/fa/ke/00/fake-' + collectionId + '/source/100x100bb.jpg',
			trackCount: count, releaseDate: '2020-01-01T08:00:00Z', primaryGenreName: genre
		};
	}

	h.describe('works', async function () {
		var W = require(path.join(h.HERE, 'works.js'));
		var S = require(path.join(h.HERE, 'sources.js'));
		var M = require(path.join(h.HERE, 'match.js'));
		var L = require(path.join(h.HERE, 'library.js'));
		var D = require(path.join(h.HERE, 'demo.js'));
		var fake = await import(url.pathToFileURL(path.join(h.HERE, 'test', 'fake-youtube.mjs')).href);

		// sources.js's clients over the in-process fake, a clock, a map that
		// keeps copies (r.kept), and the library.
		// o: { fixtures, noMap, delay (ms before each answer) }
		function rig(lib, o) {
			o = o || {};
			var sf = fake.createSourceFake(o.fixtures ? { fixtures: o.fixtures } : {});
			var hosts = S.endpointsFor({ test: true, base: 'http://fixtures.test' });
			Object.keys(hosts).forEach(function (k) { hosts[k].gap = 0; });
			var r = { clock: T, asked: [], kept: {}, sf: sf, lib: lib };
			function fetch(u, init) {
				r.asked.push(new URL(u));
				if (!o.delay) return sf.fetch(u, init);
				return new Promise(function (ok) { setTimeout(ok, o.delay); }).then(function () { return sf.fetch(u, init); });
			}
			var http = S.createHttp({ hosts: hosts, onLine: function () { return true; }, sleep: function () { return Promise.resolve(); }, fetch: fetch });
			var now = function () { return r.clock; };
			var cache = S.createCache({ now: now });
			var ix = M.index(lib);
			r.at = S.animeThemes(http, cache);
			r.it = S.iTunes(http, cache);
			r.map = o.noMap ? null : {
				get: function (k) { return Promise.resolve(Object.prototype.hasOwnProperty.call(r.kept, k) ? json(r.kept[k]) : undefined); },
				set: function (k, v) { r.kept[k] = json(v); return Promise.resolve(); }
			};
			r.deps = { at: r.at, it: r.it, M: M, L: L, index: function () { return ix; }, tracks: function () { return lib; }, map: r.map, now: now };
			r.works = W.create(r.deps);
			// What was asked from n on, short: the path, and the search's words.
			r.since = function (n) {
				return r.asked.slice(n || 0).map(function (x) {
					var p = x.pathname.replace(/^\/(animethemes|itunes)/, ''), q = x.searchParams;
					return p + (q.get('q') ? '?q=' + q.get('q') : q.get('term') ? '?term=' + q.get('term') + '&country=' + q.get('country') : '');
				});
			};
			return r;
		}

		var lib = [
			tr('vidHARBOR01', 'Harbor of Small Lights', 'Aoi Minato', { work: 'Lumen Tide', role: 'OP', scene: 'anime', lang: 'ja' }),
			tr('vidPAPER001', 'Paper Moon Letter', 'Mio Asahina (CV: Shiori Kanda) & Kaede Tsukishima (CV: Rena Ogura)', { work: 'Lumen Tide', role: 'ED', scene: 'anime', lang: 'ja' }),
			tr('vidTIDALCV1', 'Tidal Lullaby', 'Kasumi Utaite', { origArtist: 'Aoi Minato', version: 'cover', work: 'Lumen Tide', role: 'insert', scene: 'utaite', lang: 'ja' }),
			tr('vidHARBTV01', 'Harbor of Small Lights (TV Size)', 'Aoi Minato', { work: 'lumen tide', role: 'OP', scene: 'anime', version: 'tv-size' }),
			tr('vidFARSHORE', 'The Far Shore', 'Aoi Minato', { work: 'Lumen Tide', role: 'ED', scene: 'anime' }),
			tr('vidMOONLIT1', 'Moonlit Crossing', 'Hollow Compass', { work: 'Lumen Tide 2nd Season', role: 'insert', scene: 'anime' }),
			tr('vidGEAR0001', 'Gearsong', 'Neon Abacus', { work: 'Clockwork Meadow', role: 'OP', scene: 'anime', lang: 'ja' }),
			tr('vidGEAR0002', 'Gearsong', 'Neon Abacus', { scene: 'anime', lang: 'ja' }),
			tr('vidSEVENTH1', 'Seventh Flame', 'Rena Ogura', { lang: 'ja' }),
			tr('vidHIKARI01', 'Hikari no Chizu', 'Aoi Minato', { titleAlt: HIKARI, scene: 'anime' }),
			tr('vidPETAL001', 'Kumori Station & Aoi Minato - Petal Engine', '', { guess: { artist: 'Kumori Station & Aoi Minato', title: 'Petal Engine', rule: 'dash', confidence: 0.5 }, lang: 'ja' }),
			tr('vidHARBNL01', 'Harbor of Small Lights', 'Aoi Minato', { scene: 'anime' }),
			tr('vidWESTERN1', 'Seventh Flame', 'Rena Ogura', { lang: 'en' }),
			tr('vidVNSONG01', 'Harbor of Small Lights', 'Aoi Minato', { scene: 'vn' }),
			tr('vidNOTHING1', 'Paper Planes at Dusk', 'Quiet Ferrymen', { work: 'Nothing Like This', role: 'OP', scene: 'anime' })
		];
		var harbor = lib[0], farShore = lib[4], tvSize = lib[3], moonlit = lib[5], gear = lib[6], gearBare = lib[7], seventh = lib[8], hikari = lib[9], petal = lib[10], harborBare = lib[11], western = lib[12], vnSong = lib[13], nothing = lib[14];
		function slugs(f) { return f.candidates.map(function (c) { return c.slug + (c.verified ? '+' : ''); }); }

		// ---- The pure parts ----
		h.eq([
			W.workKind([tr('a', 'x', 'A', { scene: 'anime' }), tr('b', 'x', 'B', { scene: 'utaite', origArtist: 'A' })]),
			W.workKind([tr('a', 'x', 'A', { scene: 'utaite', origArtist: 'Z' }), tr('b', 'x', 'B', { scene: 'vtuber', origArtist: 'Z' })]),
			W.workKind([tr('a', 'x', 'A', { scene: 'vn' }), tr('b', 'y', 'A', { scene: 'vn' }), tr('c', 'z', 'A', { scene: 'anime' })]),
			W.workKind([tr('a', 'x', 'A', { scene: 'anime', origArtist: 'Z' }), tr('b', 'y', 'A', { scene: 'game' })])
		], ['anime', '', 'vn', 'game'], 'workKind: the commonest scene that names a kind of work, the work\'s own recordings first ("" when only covers by utaite or VTubers say)');
		h.eq(W.workTracks(lib, 'LUMEN TIDE', M).map(function (t) { return t.id; }), ['vidHARBOR01', 'vidPAPER001', 'vidTIDALCV1', 'vidHARBTV01', 'vidFARSHORE'], 'workTracks: the library\'s songs of a work, its spellings read loosely');
		var asMap = {}; lib.forEach(function (t) { asMap[t.id] = t; });
		h.eq(W.workTracks(asMap, 'Clockwork Meadow').map(function (t) { return t.id; }), ['vidGEAR0001'], 'workTracks: takes { id: track } too');
		h.eq([W.titleLookable(seventh), W.titleLookable(hikari), W.titleLookable(western), W.titleLookable(vnSong), W.titleLookable(harbor), W.titleLookable(tr('c', 'x', 'A', { scene: 'anime', kind: 'clip' })), W.titleLookable(tr('e', 'x', 'A', { scene: 'anime', lang: 'en' }))],
			[true, true, false, false, false, false, true], 'titleLookable: a song without a label whose scene is anime, or none with Japanese or no language; not a clip');
		h.eq([W.titleQueries(hikari, M), W.titleQueries(petal, M), W.titleQueries(tr('x', 'Blue Signal (TV Size)', 'A', { titleAlt: 'blue signal' }), M)],
			[[HIKARI, 'Hikari no Chizu'], ['Kumori Station & Aoi Minato - Petal Engine', 'Petal Engine'], ['blue signal']], 'titleQueries: the titleAlt first, the title without decoration, the parser\'s reading of an unsure upload; each once');
		h.eq([W.probes(harbor).map(function (p) { return p.how; }), W.probes(lib[2]).map(function (p) { return p.how; }), W.probes(petal).map(function (p) { return p.how; }), W.probes(lib[2])[1].x.artist],
			[[''], ['', 'cover'], ['', 'guess'], 'Aoi Minato'], 'probes: a cover also meets its song as the original artist\'s, an unsure upload as the parser read it');
		var gearTheme = S.find({ title: 'Gearsong', artist: 'Hoshizora Relay', work: 'Clockwork Meadow', role: 'OP', seq: 1, source: 'animethemes', ids: { at: 1 } });
		var tidalTheme = S.find({ title: 'Tidal Lullaby', artist: 'Aoi Minato', work: 'Lumen Tide', role: 'insert', seq: 1, source: 'animethemes', ids: { at: 2 } });
		var petalTheme = S.find({ title: 'Petal Engine', artist: 'Kumori Station & Aoi Minato', role: 'OP', seq: 1, source: 'animethemes', ids: { at: 3 } });
		var vg = W.verify([gearTheme], [gear], gear.id, { M: M }), vt = W.verify([tidalTheme, gearTheme], [lib[2], gear], lib[2].id, { M: M }), vp = W.verify([petalTheme], [petal], petal.id, { M: M });
		h.eq([vg.ok, vg.self], [false, null], 'verify: the threshold trap: the same title and work by another artist does not verify');
		h.eq([vt.ok, vt.n, vt.ids, vt.self === tidalTheme, vp.ok, vp.self === petalTheme], [true, 1, ['vidTIDALCV1'], true, true, true], 'verify: a cover meets its song through its original artist, an unsure upload through the parser\'s reading; self is the song asked about');
		var tm = W.titleMatches(tr('x', 'Gearsong', 'Neon Abacus', { role: 'OP' }), [
			{ id: 1, title: 'Gearsong', credit: 'Hoshizora Relay', artists: ['Hoshizora Relay'], anime: [{ slug: 'z', name: 'Z', year: 2020, season: 'spring', role: 'OP' }] },
			{ id: 2, title: 'Gearsong', credit: 'Neon Abacus & Hoshizora Relay', artists: ['Neon Abacus', 'Hoshizora Relay'], anime: [{ slug: 'b', name: 'B', year: 2020, season: 'spring', role: 'insert' }, { slug: 'a', name: 'A', year: 2024, season: 'winter', role: 'OP' }, { slug: 'c', name: 'C', year: 2019, season: 'fall', role: 'insert' }] },
			{ id: 3, title: 'Gearsong', credit: 'Neon Abacus', artists: ['Neon Abacus'], anime: [{ slug: 'd', name: 'D', year: 2021, season: 'summer', role: 'ED' }] }
		], { M: M });
		h.eq(tm.map(function (m) { return m.song.id + ' ' + m.score + ' ' + m.anime.map(function (a) { return a.slug; }).join(''); }), ['3 7 d', '2 6.5 acb'], 'titleMatches: an equal title by another artist never counts; a person of the credit does, below the whole credit; the anime where it has the track\'s role first, then the earliest');
		// A stand-in for match.js whose sameSong calls any title the same song, to reach the rule itself.
		function stubM(why) { return { signature: function (x) { return x; }, sameSong: function () { return { same: true, score: 6, why: why }; } }; }
		var oneSong = [{ id: 1, title: 'Gearsong', credit: 'Hoshizora Relay', anime: [{ slug: 'a', name: 'A', year: 2020, season: 'spring', role: 'OP' }] }];
		h.eq([W.titleMatches(tr('x', 'Gearsong', ''), oneSong, { M: stubM(['title', 'work']) }).length, W.titleMatches(tr('x', 'Gearsong', ''), oneSong, { M: stubM(['title', 'person']) }).length], [0, 1], 'titleMatches: a match without the artist in its evidence never counts, whatever its score');
		h.eq(W.rankCandidates([{ slug: 'a', ok: false, n: 0, fit: 1, rank: 0 }, { slug: 'b', ok: true, n: 1, fit: 0.5, rank: 2 }, { slug: 'c', ok: true, n: 3, fit: 0.2, rank: 1 }, { slug: 'd', ok: false, n: 0, fit: 1, rank: 1 }, { slug: 'e', ok: false, n: 0, fit: 0.9, rank: 0 }]).map(function (c) { return c.slug; }),
			['c', 'b', 'a', 'd', 'e'], 'rankCandidates: verified first (the most of the work\'s songs), then the best-fitting name, then AnimeThemes\' order');
		h.eq([(W.bestSeries([{ slug: 'saiunkoku', name: 'Saiunkoku Monogatari' }, { slug: 'monogatari', name: 'Monogatari' }], 'Monogatari', M) || {}).slug, W.bestSeries([{ slug: 'x', name: 'Other Story' }], 'Monogatari', M)], ['monogatari', null], 'bestSeries: the series the label names best, 0.8 or more');
		h.eq([W.fresh({ slug: 'x', at: T }, T + 89 * DAY), W.fresh({ slug: 'x', at: T }, T + 90 * DAY), W.fresh({ slug: '', at: T }, T + 29 * DAY), W.fresh({ slug: '', at: T }, T + 30 * DAY), W.fresh({ slug: 'x', via: 'user', at: 1 }, T + 4000 * DAY), W.fresh({ slug: 'x', at: 0 }, T), W.fresh(null, T)],
			[true, false, true, false, true, false, false], 'fresh: an anime found is good 90 days, "found nothing" 30, the listener\'s choice always; undecided never');
		h.eq([W.keysOf(harbor, M), W.keysOf(seventh, M)], [{ work: 'work:lumentide', song: 'song:vidHARBOR01' }, { work: '', song: 'song:vidSEVENTH1' }], 'keysOf: work:<fold(work)> and song:<id>');
		h.eq([W.isCrossover({ name: 'Lupin III vs. Detective Conan', series: ['lupin'] }), W.isCrossover({ name: 'Movie', series: ['a', 'b'] }), W.isCrossover({ name: 'HUNTER x HUNTER', series: ['hxh'] }), W.isCrossover({ name: 'Versus', series: [] })],
			[true, true, false, false], 'isCrossover: filed under two series, or "A vs. B"; not "HUNTER x HUNTER"');
		h.eq(W.orderEntries([{ name: 'B', year: 2020, season: 'fall' }, { name: 'A', year: 2020, season: 'spring' }, { name: 'X', year: 0 }, { name: 'C', year: 2010, crossover: true }, { name: 'D', year: 2015, season: 'winter' }]).map(function (e) { return e.name; }),
			['D', 'A', 'B', 'X', 'C'], 'orderEntries: by year and season, an unknown year last, crossovers after them all');
		h.eq(W.orderThemes([{ role: 'ED', seq: 1 }, { role: 'insert', seq: 2 }, { role: 'OP', seq: 2 }, { role: 'OP', seq: 1 }, { role: '', seq: 1 }, { role: 'insert', seq: 1 }]).map(function (f) { return f.role + f.seq; }),
			['OP1', 'OP2', 'ED1', 'insert1', 'insert2', '1'], 'orderThemes: OP, ED, inserts, each by number');
		var asm = W.assemble([
			{ slug: 'b', name: 'Two', year: 2021, themes: [S.find({ key: 'k:3', title: 'Third', role: 'OP', seq: 1 }), S.find({ key: 'k:1', title: 'First', role: 'ED', seq: 1 })] },
			{ slug: 'a', name: 'One', year: 2019, themes: [S.find({ key: 'k:2', title: 'Second', role: 'ED', seq: 1 }), S.find({ key: 'k:1', title: 'First', role: 'OP', seq: 1 })] }
		], { title: 'Both', mineOf: function (f) { return f.key === 'k:1' ? { id: 'vidMINE00001', how: 'version' } : null; }, isCurrent: function (f) { return f.key === 'k:3'; } });
		h.eq([asm.title, asm.entries.map(function (e) { return e.name; }), asm.songs.map(function (s) { return s.title + ' ' + s.entry + ' ' + s.alsoIn.join(',') + ' ' + s.mine + ' ' + s.mineHow; }), asm.have, asm.total, asm.current, asm.entries[1].themes[1].firstIn],
			['Both', ['One', 'Two'], ['First One Two vidMINE00001 version', 'Second One  null ', 'Third Two  null '], 1, 3, 2, 'One'], 'assemble: entries in order, every song once in its first entry with alsoIn, the library\'s copy and how, have, total, the current song');
		var dup = W.assemble([
			{ slug: 'a', name: 'First', year: 2008, themes: [S.find({ key: 'at:song:1', title: 'Toki wo Kizamu Uta', artist: 'Lia', role: 'OP', seq: 1 }), S.find({ key: 'at:song:2', title: 'Megumeru', artist: 'eufonius', role: 'ED', seq: 1 })] },
			{ slug: 'b', name: 'Special', year: 2009, themes: [S.find({ key: 'at:song:3', title: 'Toki wo Kizamu Uta', artist: 'Lia', role: 'OP', seq: 1 }), S.find({ key: 'at:song:4', title: 'Megumeru ~cuckool mix 2007~', artist: 'eufonius', role: 'ED', seq: 1 })] }
		], { fold: M.fold, isCurrent: function (f) { return f.key === 'at:song:1'; } });
		h.eq([dup.songs.map(function (s) { return s.title; }), dup.songs[0].alsoIn, dup.entries[1].themes[0].firstIn, dup.entries[1].themes[0].current, dup.entries[1].themes[0].key],
			[['Toki wo Kizamu Uta', 'Megumeru', 'Megumeru ~cuckool mix 2007~'], ['Special'], 'First', true, 'at:song:3'], 'assemble: a song AnimeThemes keeps twice (one title and credit under two keys, as seen on the real API) counts once; an arrangement with its own title stays its own');
		var ix0 = M.index(lib), extra0 = W.extraIndex(lib, M);
		h.eq([W.mineIn(ix0, extra0, tidalTheme, M), W.mineIn(ix0, extra0, petalTheme, M), W.mineIn(ix0, extra0, gearTheme, M)], [{ id: 'vidTIDALCV1', how: 'cover' }, { id: 'vidPETAL001', how: 'recording' }, null], 'mineIn: a cover counts as having the song, said so; an unsure upload as the parser read it; an equal title by another artist does not');
		var credited = {}; M.artistKeys('Rena Ueshiba').forEach(function (k) { credited[k] = true; });
		h.eq(W.albumsFor('White Album 2', [
			{ id: 1, title: 'The White Album', artist: 'The Beatles', genre: 'Rock', type: 'Album' },
			{ id: 2, title: 'WHITE ALBUM2 ORIGINAL SOUNDTRACK', artist: 'Various Artists', genre: 'Soundtrack', type: 'Album' },
			{ id: 3, title: 'Todokanai Koi', artist: 'Rena Ueshiba', genre: 'J-Pop', type: 'Single' },
			{ id: 4, title: 'WHITE ALBUM Original Soundtrack', artist: 'Various Artists', genre: 'Anime', type: 'Album' },
			{ id: 5, title: 'White Album 2 Vocal Collection', artist: 'Leaf', genre: 'Game', type: 'EP' },
			{ id: 6, title: 'White Album 2 Sound Collection', artist: 'Leaf', genre: ANIME_JA, type: 'Album' }
		], credited, M).map(function (a) { return a.id; }), [3, 2, 6, 5], 'albumsFor: not The Beatles\' "White Album" for "White Album 2", nor the first game\'s; a credited artist first, albums before EPs; genres in Japanese too');

		// ---- A labelled song: verified ----
		var r = rig(lib);
		var f = await r.works.workOf(harbor);
		h.eq(Object.keys(f), ['kind', 'anime', 'series', 'sure', 'via', 'candidates', 'theme', 'work', 'trackId', 'key', 'at'], 'workOf: the answer\'s fields');
		h.eq([f.kind, f.anime, f.series, f.sure, f.via], ['anime', { slug: 'lumen_tide', name: 'Lumen Tide', year: 2019, season: 'spring', format: 'TV' }, { slug: 'lumen_tide', name: 'Lumen Tide' }, true, 'label'], 'workOf: a labelled song whose anime has it as a theme: verified');
		h.eq(slugs(f), ['lumen_tide+', 'lumen_tide_the_far_shore+', 'lumen_tide_2nd_season'], 'workOf: candidates, best first: verified (the most of the work\'s songs), then the rest');
		h.eq([f.theme.key, f.theme.role, f.theme.seq, f.work, f.trackId, f.key, f.at], ['at:song:92001', 'OP', 1, 'Lumen Tide', 'vidHARBOR01', 'work:lumentide', T], 'workOf: the theme that is this song, the work, where the answer is kept, when');
		h.eq(r.since(0), ['/search?q=Lumen Tide', '/anime/lumen_tide', '/anime/lumen_tide_2nd_season', '/anime/lumen_tide_the_far_shore'], 'workOf: one search of the label, then the first three anime');
		h.eq(r.asked[0].searchParams.get('fields[search]'), 'anime,series', 'workOf: the search asks for anime and series');
		h.eq([r.kept['work:lumentide'].slug, r.kept['work:lumentide'].sure, r.kept['work:lumentide'].via, r.kept['work:lumentide'].at, r.kept['work:lumentide'].no, r.kept['work:lumentide'].cands.length], ['lumen_tide', true, 'label', T, [], 3], 'workOf: kept in the map under work:<fold(work)> as { slug, sure, at, no, via, cands }');
		var n0 = r.asked.length;
		var far = await r.works.workOf(farShore);
		h.eq([far.anime.slug, far.theme && far.theme.title, far.sure, far.via, far.key, r.asked.length - n0], ['lumen_tide_the_far_shore', 'The Far Shore', true, 'label', 'work:lumentide', 0], 'workOf: another song of the work names its own entry, from the kept answer and the cache, asking nothing');
		var tv = await r.works.workOf(tvSize);
		h.eq([tv.anime.slug, tv.key, tv.theme && tv.theme.title], ['lumen_tide', 'work:lumentide', 'Harbor of Small Lights'], 'workOf: another spelling of the work is the same work; a TV size meets its song');

		// ---- Probable, the threshold trap ----
		var moon = await r.works.workOf(moonlit);
		h.eq([moon.anime.slug, moon.sure, moon.via, moon.theme], ['lumen_tide_2nd_season', false, 'label', null], 'workOf: nothing verifies: the best candidate, not sure');
		var n1 = r.asked.length;
		var g = await r.works.workOf(gear);
		h.eq([g.anime.slug, g.sure, g.via, g.theme], ['clockwork_meadow', false, 'label', null], 'workOf: the threshold trap: an equal title by another artist does not verify the anime');
		h.eq(r.since(n1), ['/search?q=Clockwork Meadow', '/anime/clockwork_meadow', '/search?q=Gearsong'], 'workOf: nothing verified, so the song\'s own title is tried too');
		h.eq(await r.works.workOf(gearBare), null, 'workOf: the trap without a label: its title finds the song by another artist, which does not count');
		var vnRig = rig([tr('vidVNOVEN01', 'Oven Light', 'Mizuiro Parade', { work: 'Starlit Bakery', role: 'OP', scene: 'vn' })]);
		var anRig = rig([tr('vidANOVEN01', 'Oven Light', 'Mizuiro Parade', { work: 'Starlit Bakery', role: 'OP', scene: 'anime' })]);
		var vsRig = rig([tr('vidVNSUGAR1', 'Sugar Orbit', 'Lulu Amane (CV: Mika Hoshino)', { work: 'Starlit Bakery', role: 'OP', scene: 'vn' })]);
		var vsF = await vsRig.works.workOf(vsRig.lib[0]), anF = await anRig.works.workOf(anRig.lib[0]);
		h.eq([await vnRig.works.workOf(vnRig.lib[0]), vnRig.kept['work:starlitbakery'].slug, anF.anime.slug, anF.sure, vsF.anime.slug, vsF.sure],
			[null, '', 'starlit_bakery', false, 'starlit_bakery', true], 'workOf: a visual novel\'s song no anime of its name has: no probable answer (labelled as an anime\'s, there is one); one its anime has too: verified');

		// ---- Songs without a label ----
		var n2 = r.asked.length;
		var sev = await r.works.workOf(seventh);
		h.eq([sev.anime.slug, sev.via, sev.sure, sev.theme.title, sev.key, sev.work], ['seventh_lantern', 'title', true, 'Seventh Flame', 'song:vidSEVENTH1', ''], 'workOf: a song without a label, found by its title and artist (STRONG: sure)');
		h.eq([r.since(n2), r.asked[n2].searchParams.get('fields[search]')], [['/search?q=Seventh Flame', '/anime/seventh_lantern'], 'songs'], 'workOf: a search of songs, then the anime read for its format and series');
		var n3 = r.asked.length;
		var hk = await r.works.workOf(hikari);
		h.eq([hk.anime.slug, hk.theme.role, hk.sure, r.asked[n3].searchParams.get('q')], ['clockwork_meadow', 'insert', true, HIKARI], 'workOf: the titleAlt is asked first (here the Japanese title) and meets the theme');
		var pt = await r.works.workOf(petal);
		h.eq([pt.anime.slug, pt.sure, pt.theme.title], ['iron_tulip', true, 'Petal Engine'], 'workOf: an upload whose artist nothing vouches for: the parser\'s reading of it meets the credit');
		var nl = await r.works.workOf(harborBare);
		h.eq([nl.anime.slug, slugs(nl), nl.series], ['lumen_tide', ['lumen_tide+', 'lumen_tide_the_far_shore+'], { slug: 'lumen_tide', name: 'Lumen Tide' }], 'workOf: a song used in two anime: the earliest, the other offered');
		var n4 = r.asked.length;
		h.eq([await r.works.workOf(western), await r.works.workOf(vnSong), await r.works.workOf({ id: 'x' }), await r.works.workOf(null), r.asked.length - n4], [null, null, null, null, 0], 'workOf: a song in English with no scene, a visual novel\'s song without a work, nothing to go on: not looked up');
		var n5 = r.asked.length;
		h.eq(await r.works.workOf(nothing), null, 'workOf: a label and a title AnimeThemes does not know: nothing');
		h.eq([r.since(n5), r.kept['work:nothinglikethis'].slug, r.kept['song:vidNOTHING1'].slug], [['/search?q=Nothing Like This', '/search?q=Paper Planes at Dusk'], '', ''], 'workOf: the label, then the song\'s own title; "found nothing" kept for both');

		// ---- The franchise ----
		var fr = await r.works.franchise(f);
		h.eq([fr.title, fr.series], ['Lumen Tide', { slug: 'lumen_tide', name: 'Lumen Tide' }], 'franchise: titled with the series\' name');
		h.eq(fr.entries.map(function (e) { return e.year + ' ' + e.season + ' ' + e.format + ' ' + e.name + (e.crossover ? ' x' : ''); }), ['2019 spring TV Lumen Tide', '2021 fall TV Lumen Tide 2nd Season', '2023 summer Movie Lumen Tide: The Far Shore'], 'franchise: every entry of the series, oldest first, with its format');
		h.eq(fr.entries.map(function (e) { return e.themes.map(function (t) { return t.role + t.seq; }).join(' '); }), ['OP1 ED1 insert1', 'OP1 OP2 ED1', 'OP1 ED1'], 'franchise: each entry\'s themes, OP, then ED, then inserts, each by number');
		h.eq(fr.songs.map(function (s) { return s.title; }), ['Harbor of Small Lights', 'Paper Moon Letter', 'Tidal Lullaby', 'Second Current', 'Lanterns Over Water', 'Paper Moon Letter -Reprise-', 'The Far Shore'], 'franchise: every song once, in the entries\' order');
		h.eq([fr.songs[0].entry, fr.songs[0].alsoIn, fr.entries[2].themes[0].firstIn, fr.entries[2].themes[0].key === fr.songs[0].key, fr.songs[1].alsoIn], ['Lumen Tide', ['Lumen Tide: The Far Shore'], 'Lumen Tide', true, []], 'franchise: a song used again (the film\'s opening) appears once, in its first entry, with alsoIn');
		h.eq(fr.songs.map(function (s) { return s.mine ? s.mine + ' ' + s.mineHow : null; }), ['vidHARBOR01 recording', 'vidPAPER001 recording', 'vidTIDALCV1 cover', null, null, null, 'vidFARSHORE recording'], 'franchise: the library\'s copies (the same recording first; a cover counts, said so)');
		h.eq([fr.have, fr.total], [4, 7], 'franchise: have and total');
		h.eq([fr.current, fr.songs[0].current, fr.entries[2].themes[0].current, fr.songs[1].current], [0, true, true, false], 'franchise: the song it was opened from');
		var shape = Object.keys(S.find({}));
		h.ok(fr.songs.every(function (s) { return shape.every(function (k) { return k in s; }) && /^at:song:\d+$/.test(s.key) && /^at:anime:/.test(s.workKey) && s.seriesKey === 'at:series:lumen_tide' && s.videoId === null && s.source === 'animethemes'; }), 'franchise: the songs are AnimeThemes\' finds (every field of sources.js find)');
		var sevFr = await r.works.franchise(sev);
		h.eq([sevFr.title, sevFr.series, sevFr.entries.length, sevFr.songs.map(function (s) { return s.title; }), sevFr.songs[0].mine, sevFr.have, sevFr.current], ['Seventh Lantern', null, 1, ['Seventh Flame'], 'vidSEVENTH1', 1, 0], 'franchise: an anime outside any series is a franchise of one');
		h.eq(await r.works.franchise(null), null, 'franchise: nothing found, nothing to show');

		// ---- A series named by the label, and a crossover (a fixture variant) ----
		var GW = { id: 95100, name: 'Glasswing', slug: 'glasswing' }, SB = { id: 95101, name: 'Starlit Bakery', slug: 'starlit_bakery' };
		var aoi = atArtist(93100, 'Aoi Minato', 'aoi_minato'), mika = atArtist(93101, 'Mika Hoshino', 'mika_hoshino'), relay = atArtist(93102, 'Hoshizora Relay', 'hoshizora_relay');
		var fx = fake.loadFixtures();
		fx.animethemes.anime = fx.animethemes.anime.concat([
			atAnime(90101, 'glasswing_tales', 'Glasswing Tales', 2010, 'Spring', 'TV', [atTheme(91101, 'OP', null, 92101, 'Wingbeat', [aoi]), atTheme(91102, 'ED', null, 92102, 'Dust of Glass', [relay])], [GW]),
			atAnime(90102, 'glasswing_tales_2', 'Glasswing Tales 2', 2012, 'Fall', 'TV', [atTheme(91103, 'ED', null, 92104, 'Second Wing', [relay]), atTheme(91104, 'OP', null, 92103, 'Shattered Sky', [aoi]), atTheme(91111, 'IN', null, 92110, 'Dust of Glass', [relay])], [GW]),
			atAnime(90103, 'glasswing_tales_zero', 'Glasswing Tales: Zero', 2014, 'Summer', 'Movie', [atTheme(91105, 'OP', null, 92105, 'Zero Hour Wings', [aoi]), atTheme(91106, 'ED', null, 92101, 'Wingbeat', [aoi])], [GW]),
			atAnime(90104, 'glasswing_vs_starlit_bakery', 'Glasswing vs. Starlit Bakery', 2011, 'Winter', 'Special', [atTheme(91107, 'OP', null, 92106, 'Sugar Glass Duel', [mika, relay])], [GW, SB]),
			atAnime(90105, 'hanegatari', 'Hanegatari', 2016, 'Winter', 'TV', [atTheme(91108, 'OP', null, 92107, 'Feather Circulation', [mika]), atTheme(91109, 'IN', 2, 92108, 'Quiet Wing', [mika]), atTheme(91110, 'IN', 1, 92109, 'Loud Wing', [mika])], [GW])
		]);
		var feather = tr('vidFEATHER1', 'Feather Circulation', 'Mika Hoshino', { work: 'Glasswing', role: 'OP', scene: 'anime' });
		var gw = rig(lib.concat([feather, tr('vidWINGPN01', 'Wingbeat (Piano Ver.)', 'Aoi Minato', { scene: 'anime', version: 'piano' })]), { fixtures: fx });
		var gf = await gw.works.workOf(feather);
		h.eq([gf.anime.slug, gf.sure, gf.via, gf.series, gf.theme.title], ['hanegatari', true, 'label', { slug: 'glasswing', name: 'Glasswing' }, 'Feather Circulation'], 'workOf: no anime of the label\'s name verifies, so the series it names lends its entries (as "Monogatari" would)');
		h.eq(gw.since(0), ['/search?q=Glasswing', '/anime/glasswing_tales', '/anime/glasswing_tales_2', '/anime/glasswing_tales_zero', '/series/glasswing', '/series/glasswing', '/anime/glasswing_vs_starlit_bakery', '/anime/hanegatari'], 'workOf: the first three anime, then the series (the nested include refused, then each entry not read yet)');
		var gfr = await gw.works.franchise(gf);
		h.eq(gfr.entries.map(function (e) { return e.name + (e.crossover ? ' (crossover)' : ''); }), ['Glasswing Tales', 'Glasswing Tales 2', 'Glasswing Tales: Zero', 'Hanegatari', 'Glasswing vs. Starlit Bakery (crossover)'], 'franchise: a crossover (filed under two series) after the franchise\'s own entries, though it aired before most of them');
		h.eq([gfr.entries[1].themes.map(function (t) { return t.role + t.seq; }), gfr.entries[3].themes.map(function (t) { return t.role + t.seq + ' ' + t.title; })], [['OP1', 'ED1', 'insert1'], ['OP1 Feather Circulation', 'insert1 Loud Wing', 'insert2 Quiet Wing']], 'franchise: OP before ED, inserts by number, whatever order AnimeThemes lists them in');
		h.eq([gfr.songs[1].title, gfr.songs[1].alsoIn, gfr.entries[1].themes[2].firstIn, gfr.entries[1].themes[2].key], ['Dust of Glass', ['Glasswing Tales 2'], 'Glasswing Tales', 'at:song:92110'], 'franchise: a second song record of one song (its title and credit) is the song used again');
		h.eq([gfr.songs.length, gfr.songs[0].title, gfr.songs[0].alsoIn, gfr.songs.filter(function (s) { return s.mine; }).map(function (s) { return s.title + ' ' + s.mineHow; }), gfr.have, gfr.total, gfr.songs[gfr.current].title],
			[9, 'Wingbeat', ['Glasswing Tales: Zero'], ['Wingbeat version', 'Feather Circulation recording'], 2, 9, 'Feather Circulation'], 'franchise: another version (a piano one) counts as having the song, said so');

		// ---- Keeping answers: 90 days, 30 for nothing, the session without a map ----
		var c = rig(lib);
		await c.works.workOf(harbor);
		var k0 = c.asked.length;
		c.clock = T + 89 * DAY;
		var again = await c.works.workOf(harbor);
		h.eq([again.anime.slug, again.sure, again.at, c.asked.length - k0], ['lumen_tide', true, T, 0], 'cache: 89 days on, the kept answer; nothing asked');
		c.clock = T + 91 * DAY;
		var k1 = c.asked.length;
		var later = await c.works.workOf(harbor);
		h.eq([later.anime.slug, later.at, c.kept['work:lumentide'].at, c.since(k1)], ['lumen_tide', T + 91 * DAY, T + 91 * DAY, ['/search?q=Lumen Tide']], 'cache: after 90 days the label is looked up again (its anime still in sources.js\'s cache)');
		await c.works.workOf(nothing);
		var k2 = c.asked.length;
		c.clock = T + 91 * DAY + 29 * DAY;
		h.eq([await c.works.workOf(nothing), c.asked.length - k2], [null, 0], 'cache: "found nothing" is kept 29 days on; nothing asked');
		c.clock = T + 91 * DAY + 31 * DAY;
		await c.works.workOf(nothing);
		h.eq(c.since(k2), ['/search?q=Nothing Like This', '/search?q=Paper Planes at Dusk'], 'cache: after 30 days it is asked again');
		var nm = rig(lib, { noMap: true });
		await nm.works.workOf(harbor);
		nm.clock = T + 10 * DAY;
		var k3 = nm.asked.length;
		var sess = await nm.works.workOf(harbor);
		h.eq([sess.anime.slug, sess.sure, nm.asked.length - k3], ['lumen_tide', true, 0], 'cache: without a map the answers last the session (the search itself no longer cached)');
		var st = rig(lib);
		await st.works.workOf(harbor);
		st.clock = T + 100 * DAY;
		st.sf.set({ sourceFail: { animethemes: 50 } });
		var stale = await st.works.workOf(harbor);
		h.eq([stale.anime.slug, stale.sure, stale.at], ['lumen_tide', true, T], 'cache: when the check after 90 days fails, the kept answer still serves');
		await h.rejects(st.works.workOf(seventh), function (e) { return S.isSourceError(e) && e.code !== 'aborted'; }, 'workOf: a failure with nothing kept rejects with the SourceError');

		// ---- The listener's corrections ----
		var x = rig(lib);
		await x.works.workOf(harbor);
		await x.works.reject(harbor, 'lumen_tide');
		h.eq([x.kept['work:lumentide'].no, x.kept['work:lumentide'].slug, x.kept['song:vidHARBOR01'].no], [['lumen_tide'], '', ['lumen_tide']], 'reject: remembered for the work and the song; the answer it named is undecided');
		var next = await x.works.workOf(harbor);
		h.eq([next.anime.slug, next.sure, next.theme.title, slugs(next)], ['lumen_tide_the_far_shore', true, 'Harbor of Small Lights', ['lumen_tide_the_far_shore+', 'lumen_tide_2nd_season']], 'reject: "Not this one": workOf offers the next candidate, the rejected one left out');
		h.ok((await x.works.workOf(lib[1])).anime.slug !== 'lumen_tide', 'reject: for every song of the work');
		await x.works.reject(harbor, 'lumen_tide_the_far_shore');
		var third = await x.works.workOf(harbor);
		h.eq([third.anime.slug, third.sure, third.via], ['lumen_tide_2nd_season', false, 'label'], 'reject: then the next, not verified (the song\'s title finds only the rejected ones)');
		await x.works.confirm(harbor, 'lumen_tide');
		var mine = await x.works.workOf(harbor);
		h.eq([mine.anime.slug, mine.sure, mine.via, mine.theme.title, x.kept['work:lumentide'].no], ['lumen_tide', true, 'user', 'Harbor of Small Lights', ['lumen_tide_the_far_shore']], 'confirm: the listener\'s choice wins (and leaves the rejected list)');
		x.clock = T + 400 * DAY;
		var k4 = x.asked.length;
		var still = await x.works.workOf(lib[1]);
		h.eq([still.anime.slug, still.via, still.sure, x.since(k4).filter(function (p) { return p.indexOf('/search') === 0; })], ['lumen_tide', 'user', true, []], 'confirm: for every song of the work, never looked up again (400 days on)');
		await x.works.reject(harbor, 'lumen_tide');
		var after = await x.works.workOf(harbor);
		h.eq([after.anime.slug, after.via], ['lumen_tide_2nd_season', 'label'], 'reject: rejecting the listener\'s own choice looks again');
		await x.works.reject(harbor, 'lumen_tide_2nd_season');
		h.eq(await x.works.workOf(harbor), null, 'reject: every candidate rejected (the series\' too): nothing');
		await x.works.reject(seventh, 'seventh_lantern');
		h.eq(await x.works.workOf(seventh), null, 'reject: a song found by its title whose only anime is rejected: nothing');
		await x.works.confirm(seventh, 'starlit_bakery');
		var conf = await x.works.workOf(seventh);
		h.eq([conf.anime.slug, conf.via, conf.sure, conf.key, conf.theme], ['starlit_bakery', 'user', true, 'song:vidSEVENTH1', null], 'confirm: a song without a label keeps its own choice');
		await x.works.confirm(western, 'seventh_lantern');
		h.eq((await x.works.workOf(western)).anime.slug, 'seventh_lantern', 'confirm: even for a song the page would not look up');
		var y = rig(lib);
		await y.works.confirm(harbor, 'no_such_anime');
		var gone = await y.works.workOf(harbor);
		h.eq([gone.anime.slug, gone.via, y.kept['work:lumentide'].via, y.kept['work:lumentide'].slug], ['lumen_tide', 'label', 'label', 'lumen_tide'], 'confirm: an anime AnimeThemes does not have is forgotten, and the label looked up');
		var rc = rig(lib, { delay: 3 });
		var pending = rc.works.workOf(harbor);
		await rc.works.reject(harbor, 'lumen_tide');
		var raced = await pending;
		h.eq([raced.anime.slug, rc.kept['work:lumentide'].no, rc.kept['work:lumentide'].slug, (await rc.works.workOf(harbor)).anime.slug], ['lumen_tide', ['lumen_tide'], '', 'lumen_tide_the_far_shore'], 'reject: a "Not this one" given while workOf looks is not lost; the answer it rejected is kept undecided');
		await h.rejects(Promise.all([x.works.reject(null, 'x'), x.works.confirm(harbor, '')]).then(function () { throw new Error('fine'); }), function (e) { return e.message === 'fine'; }, 'reject, confirm: nothing to do without a song or a slug');

		// ---- Stopping ----
		var ab = rig(lib, { delay: 5 });
		var done = new AbortController();
		done.abort();
		await h.rejects(ab.works.workOf(harbor, { signal: done.signal }), function (e) { return e.code === 'aborted' && e.name === 'SourceError'; }, 'abort: a signal already fired: rejects "aborted" at once');
		await h.rejects(ab.works.franchise(f, { signal: done.signal }), function (e) { return e.code === 'aborted'; }, 'abort: franchise too');
		h.eq(ab.asked.length, 0, 'abort: and nothing is asked');
		var mid = new AbortController(), p1 = ab.works.workOf(harbor, { signal: mid.signal });
		setTimeout(function () { mid.abort(); }, 2);
		await h.rejects(p1, function (e) { return e.code === 'aborted'; }, 'abort: stopped while it looks: rejects "aborted"');
		h.eq(Object.keys(ab.kept), [], 'abort: nothing is kept from a stopped lookup');
		var whole = await ab.works.workOf(harbor);
		h.eq(whole.anime.slug, 'lumen_tide', 'abort: the next call looks again');
		var mid2 = new AbortController(), p2 = ab.works.franchise(whole, { signal: mid2.signal });
		setTimeout(function () { mid2.abort(); }, 2);
		await h.rejects(p2, function (e) { return e.code === 'aborted'; }, 'abort: a franchise stopped while it reads the series');
		var spied = [], sig = new AbortController();
		function spy(client) {
			var out = {};
			Object.keys(client).forEach(function (k) {
				out[k] = function () { var o = arguments[arguments.length - 1]; spied.push(k + ':' + !!(o && o.signal === sig.signal)); return client[k].apply(null, arguments); };
			});
			return out;
		}
		var sp = rig(lib);
		var sw = W.create(Object.assign({}, sp.deps, { at: spy(sp.at), it: spy(sp.it) }));
		var sf1 = await sw.workOf(harbor, { signal: sig.signal });
		await sw.franchise(sf1, { signal: sig.signal });
		await sw.workOf(gear, { signal: sig.signal });
		await sw.workOf(nothing, { signal: sig.signal });
		await sw.soundtracks(harbor, { signal: sig.signal });
		h.ok(spied.length >= 10 && spied.every(function (s) { return /:true$/.test(s); }), 'abort: every client call carries the signal (' + spied.length + ' calls: ' + spied.filter(function (s, i) { return spied.indexOf(s) === i; }).join(' ') + ')');

		// ---- Soundtracks on iTunes (a fixture variant) ----
		var fx2 = fake.loadFixtures();
		fx2.itunes.results = fx2.itunes.results.concat([
			itTrack(1720000301, 1710000004, 1, 'Harbor of Small Lights (TV Size)', 'Aoi Minato', 1700000001, 'Lumen Tide Original Soundtrack', 'Soundtrack'),
			itTrack(1720000302, 1710000004, 2, 'Morning at the Lighthouse', 'Aoi Minato', 1700000001, 'Lumen Tide Original Soundtrack', 'Soundtrack'),
			itAlbum(1710000901, 'The Lumen Tide Album', 'The Night Owls', 1700000901, 'Rock', 12),
			itTrack(1720000901, 1710000901, 1, 'Lumen', 'The Night Owls', 1700000901, 'The Lumen Tide Album', 'Rock'),
			itAlbum(1710000902, 'Lumen Tide Image Songs', 'Aoi Minato', 1700000001, 'J-Pop', 6),
			itTrack(1720000902, 1710000902, 1, 'Lantern Song', 'Aoi Minato', 1700000001, 'Lumen Tide Image Songs', 'J-Pop')
		]);
		var ot = rig(lib, { fixtures: fx2 });
		var ost = await ot.works.soundtracks(harbor);
		h.eq([ost.work, ost.albums.map(function (a) { return a.title + (a.verified ? ' +' : ''); }), ost.have, ost.total, ost.sure], ['Lumen Tide', ['Lumen Tide Original Soundtrack +', 'Lumen Tide Image Songs'], 1, 3, true], 'soundtracks: the work\'s albums (a credited artist\'s too), not a rock album of a like name; verified by a library song');
		h.eq([ost.albums[0].tracks.map(function (t) { return t.title + ' ' + t.mine + ' ' + t.mineHow; }), ost.albums[0].mine, ost.albums[0].year, ost.albums[0].type, ost.albums[0].country, /^it:track:/.test(ost.albums[0].tracks[0].key)], [['Harbor of Small Lights (TV Size) vidHARBTV01 recording', 'Morning at the Lighthouse null '], 1, 2019, 'Compilation', 'JP', true], 'soundtracks: each album\'s songs as iTunes finds, the library\'s copies marked');
		h.eq(ot.since(0), ['/search?term=Lumen Tide&country=JP', '/lookup', '/lookup'], 'soundtracks: Japan\'s store first for an anime, a game or a visual novel; the albums\' songs read');
		var k5 = ot.asked.length;
		var none = await ot.works.soundtracks(nothing);
		h.eq([none.albums, none.have, none.total, none.sure, ot.since(k5)], [[], 0, 0, false, ['/search?term=Nothing Like This&country=JP', '/search?term=Nothing Like This&country=US']], 'soundtracks: nothing in Japan\'s store, then the US\'s; nothing found');
		var k6 = ot.asked.length;
		await ot.works.soundtracks(tr('vidSTAGE001', 'Wait for It', 'Leslie Odom Jr.', { work: 'Hamilton', scene: 'stage' }));
		h.eq(ot.since(k6)[0], '/search?term=Hamilton&country=US', 'soundtracks: the US store first for a stage work');
		h.eq([await W.create({ M: M, L: L }).soundtracks(harbor), await ot.works.soundtracks(seventh)], [null, null], 'soundtracks: null without the iTunes client or a work label');

		// ---- The demo ----
		var dlib = D.build(Date.UTC(2026, 9, 10)).lib;
		var dw = W.create({ M: M, L: L });
		var kumori = dlib.tracks['demo-131'];
		var dm = dw.demo(kumori, dlib), dfound = dm.found, dfr = dm.franchise;
		h.eq([dfound.kind, dfound.sure, dfound.via, dfound.demo, dfound.work, dfound.series, dfound.trackId], ['anime', true, 'label', true, 'Kumori Station Anime', { slug: 'kumori_station_anime', name: 'Kumori Station Anime' }, 'demo-131'], 'demo: an invented answer for a demo song\'s work');
		h.eq([dfr.entries.length, dfr.entries.map(function (e) { return e.format; }), dfr.entries.every(function (e, i) { return !i || e.year > dfr.entries[i - 1].year; }), dfr.title], [3, ['TV', 'TV', 'Movie'], true, 'Kumori Station Anime'], 'demo: three entries, a TV series, its second season and a film, oldest first');
		var kumoriIds = L.list(dlib).filter(function (t) { return t.work === 'Kumori Station Anime'; }).map(function (t) { return t.id; });
		h.ok(kumoriIds.length >= 4 && kumoriIds.every(function (id) { return dfr.songs.some(function (s) { return s.mine === id; }); }), 'demo: every library song of the work (' + kumoriIds.length + ') is one of its themes, marked as the library\'s');
		var invented = dfr.songs.filter(function (s) { return !s.mine; });
		h.eq([dfr.have, dfr.total, invented.length >= 1, invented.every(function (s) { return s.videoId === null; })], [kumoriIds.length, kumoriIds.length + invented.length, true, true], 'demo: invented missing themes, without a video, so some are not the library\'s');
		h.ok(dfr.songs.some(function (s) { return s.alsoIn.length; }) && dfr.entries[2].themes[0].firstIn === dfr.entries[0].name, 'demo: the film uses the first entry\'s opening again (alsoIn, firstIn)');
		h.ok(dfr.entries.every(function (e) { return e.themes.every(function (s) { return shape.every(function (k) { return k in s; }) && /^at:song:\d+$/.test(s.key) && s.workKey === 'at:anime:' + e.slug && s.seriesKey === 'at:series:kumori_station_anime' && s.source === 'animethemes' && typeof s.ids.at === 'number' && s.season.year === e.year; }); }), 'demo: finds shaped like AnimeThemes\' (sources.js find, at:song:<n>, at:anime:<slug>, at:series:<slug>)');
		var home = dfr.entries.filter(function (e) { return e.slug === dfound.anime.slug; })[0];
		h.ok(home && home.themes.some(function (t) { return t.mine === 'demo-131'; }) && dfound.theme.title === kumori.title && dfr.songs[dfr.current].mine === 'demo-131', 'demo: the answer names the entry the song is in, its theme, and the franchise\'s current song');
		var reversed = { tracks: {} };
		Object.keys(dlib.tracks).reverse().forEach(function (id) { reversed.tracks[id] = dlib.tracks[id]; });
		h.eq([JSON.stringify(dw.demo(kumori, dlib)) === JSON.stringify(dm), JSON.stringify(W.demoFranchise(kumori, reversed, { M: M, L: L })) === JSON.stringify(dm)], [true, true], 'demo: the same every time, whatever the library\'s order');
		h.eq(json(await dw.franchise(dfound)), json(dfr), 'demo: franchise(found) of the demo\'s answer is the same franchise, asking nothing');
		h.eq([dw.demo(dlib.tracks['demo-149'], dlib), dw.demo(dlib.tracks['demo-001'], dlib), await dw.workOf(kumori)], [null, null, null], 'demo: none for a game\'s work or a song without a work; without the clients workOf asks nothing');
		var pairLib = { tracks: { vidPAIR00001: tr('vidPAIR00001', 'Blue Signal', 'Paper Lanterns', { work: 'Pair Show', role: 'OP', scene: 'anime', year: 2018 }), vidPAIR00002: tr('vidPAIR00002', 'Late Letter', 'Paper Lanterns', { work: 'Pair Show', role: 'ED', scene: 'anime', year: 2020 }) } };
		var pair = W.demoFranchise(pairLib.tracks.vidPAIR00002, pairLib, { M: M, L: L });
		h.eq([pair.franchise.entries.map(function (e) { return e.name; }), pair.found.anime.name, pair.franchise.songs[0].alsoIn, pair.franchise.have], [['Pair Show', 'Pair Show 2nd Season'], 'Pair Show 2nd Season', ['Pair Show 2nd Season'], 2], 'demo: two songs make two entries, the second using the first one\'s opening again');
	});
};
