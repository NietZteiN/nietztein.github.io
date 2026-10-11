// artists: an artist or band on iTunes, Deezer and AnimeThemes, checked
// against the library, and their releases (artists.js). iTunes and
// AnimeThemes answer from test/fixtures through the in-process fake, or from
// a small fake of iTunes's stores below; Deezer through discover.js with an
// invented transport. Nothing here reaches a real service.
module.exports = function (h) {
	var path = require('path'), url = require('url');
	var A = require(path.join(h.HERE, 'artists.js'));
	var S = require(path.join(h.HERE, 'sources.js'));
	var M = require(path.join(h.HERE, 'match.js'));
	var L = require(path.join(h.HERE, 'library.js'));
	var D = require(path.join(h.HERE, 'discover.js'));
	var Demo = require(path.join(h.HERE, 'demo.js'));
	var Store = require(path.join(h.HERE, 'store.js'));
	var DAY = 86400000, T0 = Date.UTC(2026, 9, 10, 12);
	var J = String.fromCharCode;
	var YORUSHIKA = J(0x30E8, 0x30EB, 0x30B7, 0x30AB), HARU = J(0x6674, 0x308B), HIKARI = J(0x3072, 0x304B, 0x308A, 0x306E, 0x5730, 0x56F3);
	var BEST_ALBUM = J(0x30D9, 0x30B9, 0x30C8, 0x30A2, 0x30EB, 0x30D0, 0x30E0), MINI_ALBUM = J(0x30DF, 0x30CB, 0x30A2, 0x30EB, 0x30D0, 0x30E0);
	var SAKURA = J(0x3055, 0x304F, 0x3089, 0x3073, 0x3088, 0x308A);   // "sakurabiyori" in hiragana
	var KANJI_NAME = J(0x7C73, 0x6CA2, 0x5065, 0x4E8C);                // an invented name in kanji

	function tr(id, artist, title, more) {
		return Object.assign({ id: id, artist: artist, artistKey: L.normArtist(artist), title: title, titleAlt: '', artistNative: '', album: '', lang: '', scene: '', work: '', role: '', durationSec: 0, raw: { title: artist + ' - ' + title, channel: artist + ' - Topic' } }, more || {});
	}
	// A persistent kv as the page gives one: copies in and out.
	function kv() {
		var m = new Map();
		return { m: m, get: function (k) { return Promise.resolve(m.has(k) ? JSON.parse(JSON.stringify(m.get(k))) : undefined); }, set: function (k, v) { m.set(k, JSON.parse(JSON.stringify(v))); return Promise.resolve(); } };
	}
	// A client whose calls are counted by name.
	function counted(client) {
		var out = { calls: [] };
		Object.keys(client).forEach(function (k) { out[k] = function () { out.calls.push(k); return client[k].apply(client, arguments); }; });
		return out;
	}
	function caught(p) { return p.then(function () { return null; }, function (e) { return e; }); }
	function httpWith(fetch, now) {
		var hosts = S.endpointsFor({ test: true, base: 'http://fixtures.test' });
		Object.keys(hosts).forEach(function (x) { hosts[x].gap = 0; });
		return S.createHttp({ hosts: hosts, onLine: function () { return true; }, sleep: function () { return Promise.resolve(); }, now: now, fetch: fetch });
	}
	async function until(test) { for (var i = 0; i < 50 && !test(); i++) await h.tickAll(); return test(); }

	// iTunes with its stores apart: who can be found where (by their name, or
	// by terms of their own), and their songs and releases in each store.
	function storesFake(db) {
		var log = [];
		function reply(results) {
			var body = '\n\n' + JSON.stringify({ resultCount: results.length, results: results }) + '\n';
			return Promise.resolve({ ok: true, status: 200, headers: { get: function () { return null; } }, text: function () { return Promise.resolve(body); } });
		}
		function fetch(u) {
			var q = new URL(u), p = q.searchParams, c = p.get('country');
			if (/\/search$/.test(q.pathname)) {
				var term = p.get('term').toLowerCase();
				log.push('search ' + c + ' ' + p.get('term'));
				return reply(db.filter(function (a) { return a.stores[c] && (a.terms || [a.name]).some(function (x) { return x.toLowerCase().indexOf(term) >= 0; }); }).map(function (a) {
					return { wrapperType: 'artist', artistType: 'Artist', artistId: a.id, artistName: a.name, primaryGenreName: a.genre || 'Pop', artistLinkUrl: 'https://music.apple.com/us/artist/x/' + a.id + '?uo=4' };
				}));
			}
			var id = +p.get('id'), entity = p.get('entity'), a = db.filter(function (x) { return x.id === id; })[0], st = a && a.stores[c];
			log.push(entity + ' ' + c + ' ' + id);
			if (!st) return reply([]);
			if (entity === 'song') return reply((st.songs || []).map(function (t, i) { return { wrapperType: 'track', kind: 'song', trackId: id * 100 + i, artistId: id, artistName: a.name, trackName: t, collectionId: id * 10, collectionName: t + ' - Single', trackNumber: 1, discNumber: 1, releaseDate: '2020-01-01T00:00:00Z' }; }));
			return reply((st.albums || []).map(function (t, i) {
				var x = typeof t === 'string' ? { title: t } : t;
				return { wrapperType: 'collection', collectionType: 'Album', collectionId: id * 10 + i, artistId: id, artistName: x.artist || a.name, collectionName: x.title, trackCount: x.count || 2, releaseDate: '2021-0' + (1 + i) + '-01T00:00:00Z' };
			}));
		}
		return { fetch: fetch, log: log };
	}

	h.describe('artists', async function () {
		// ---- storeFor: the iTunes store to look in first ----
		h.eq([
			A.storeFor('Aoi Minato', '', []), A.storeFor(YORUSHIKA, '', []), A.storeFor('Yorushika', YORUSHIKA, []),
			A.storeFor('X', '', [{ lang: 'ja' }, { lang: 'ja' }, { lang: 'en' }]), A.storeFor('X', '', [{ scene: 'vn' }, { scene: 'game' }, { lang: 'en' }]),
			A.storeFor('X', '', [{ scene: 'anime' }, { lang: 'en' }]), A.storeFor('X', '', [{ title: HARU }, { title: 'Blue', lang: 'en' }, { title: HIKARI }]), A.storeFor('X', '', [{ lang: 'en' }, { lang: 'inst' }])
		], ['US', 'JP', 'JP', 'JP', 'JP', 'US', 'JP', 'US'], 'storeFor: Japan for a name or native name in Japanese script, or when most songs are Japanese, anime, game or visual-novel songs (half is not most); else the US');

		// ---- albumType: a release's type from its name, its count and its source ----
		var types = [
			['Harbor of Small Lights - Single', 2], ['Lanterns Over Water - EP', 4], [{ title: 'Creep', type: 'EP', trackCount: 5 }], [{ title: 'Drill EP', type: 'Album', trackCount: 4 }],
			[{ title: 'The Far Shore', type: 'Single', trackCount: 3 }], [{ title: 'Tide Atlas', type: 'Album', trackCount: 10 }], [{ title: 'Small Rooms', type: 'Album', trackCount: 5 }],
			[{ title: 'Small Rooms (1st Album)', type: 'Album', trackCount: 5 }], [{ title: 'Paper Weather', type: 'Album', trackCount: 5, source: 'deezer' }], [{ title: 'Harbor Lights', type: 'Single', source: 'deezer' }],
			[{ title: 'Lumen Tide Original Soundtrack', type: 'Compilation', trackCount: 24 }], [{ title: 'x', type: 'compile', source: 'deezer' }],
			['Greatest Hits', 14], ['The Best of Paper Lanterns', 16], ['B-Sides & Rarities', 12], ['Singles 1990-2000', 18], ['The Singles', 20], [BEST_ALBUM, 15], ['Collection', 14],
			['Best Friend', 1], ['Do Your Best', 2], ['Winter Collection', 10], ['Single Ladies', 1], ['Keep Going', 5], ['Step Into Light', 12],
			[{ title: 'Mini Album', trackCount: 7 }], [MINI_ALBUM, 6], [{ title: 'Unknown', trackCount: 0 }], ['Harbor of Small Lights - Single', 6]
		].map(function (r) { return A.albumType(typeof r[0] === 'string' ? { title: r[0], trackCount: r[1] } : r[0]); });
		h.eq(types, ['single', 'ep', 'ep', 'ep', 'single', 'album', 'ep', 'album', 'album', 'single', 'compilation', 'compilation',
			'compilation', 'compilation', 'compilation', 'compilation', 'compilation', 'compilation', 'compilation',
			'single', 'single', 'album', 'single', 'ep', 'album', 'ep', 'ep', 'album', 'single'],
			'albumType: the name\'s " - Single" or " - EP", "EP" or "mini album" in it, the store\'s word, best-of names, then 1 to 3 songs a single, 4 to 6 an EP unless it says album, more an album');
		h.eq([A.albumType('Lanterns Over Water - EP'), A.albumType({ title: 'Paper Weather', type: 'Album', source: 'itunes', trackCount: 5 })], ['ep', 'ep'], 'albumType: a title alone, and iTunes\'s "Album" (every release there is one) does not stand against the count');

		// ---- mergeAlbums: iTunes's and Deezer's lists as one ----
		var itList = [
			{ source: 'itunes', id: 1, title: 'Tide Atlas', date: '2022-06-01', type: 'album', typedBy: 'count', trackCount: 10, link: 'https://music.apple.com/x/1', cover: 'c1' },
			{ source: 'itunes', id: 2, title: 'Tide Atlas', date: '2022-03-01', type: 'single', typedBy: 'name', trackCount: 2 },
			{ source: 'itunes', id: 3, title: 'Creep', date: '1992-09-21', type: 'ep', typedBy: 'name', trackCount: 5 },
			{ source: 'itunes', id: 4, title: 'Creep', date: '1992-09-21', type: 'ep', typedBy: 'name', trackCount: 6 },
			{ source: 'itunes', id: 5, title: 'Drill EP', date: '1992-05-05', type: 'Album', trackCount: 4 }
		];
		var dzList = [
			{ source: 'deezer', id: 71, title: 'Tide Atlas', date: '2022-05-31', type: 'album', typedBy: 'store', link: 'https://www.deezer.com/album/71' },
			{ source: 'deezer', id: 72, title: 'Creep', date: '1992-09-21', type: 'single', typedBy: 'store' },
			{ source: 'deezer', id: 73, title: 'Only Deezer', date: '2024-02-02', type: 'ep', typedBy: 'store' },
			{ source: 'deezer', id: 74, title: 'Tide Atlas', date: '2022-03-01', type: 'single', typedBy: 'store' }
		];
		var before = JSON.stringify([itList, dzList]);
		var merged = A.mergeAlbums([itList, dzList], M);
		h.eq(merged.map(function (x) { return x.date + ' ' + x.type + ' ' + x.title + ' ' + JSON.stringify(x.ids); }), [
			'2024-02-02 ep Only Deezer {"deezer":73}', '2022-06-01 album Tide Atlas {"itunes":1,"deezer":71}', '2022-03-01 single Tide Atlas {"itunes":2,"deezer":74}',
			'1992-09-21 ep Creep {"itunes":4,"deezer":72}', '1992-05-05 ep Drill EP {"itunes":5}'
		], 'mergeAlbums: one entry per release, newest first; dates two days apart are one release; an album and its title song\'s single stay apart, each joined by its own twin');
		var tide = merged[1], creep = merged[3];
		h.eq([tide.id, tide.link, tide.cover, tide.typedBy, creep.id, creep.trackCount, creep.type], [1, 'https://music.apple.com/x/1', 'c1', 'store', 4, 6, 'ep'], 'mergeAlbums: the first list leads (id, link, cover); the release listed twice by one store keeps the fuller one; a type from a store beats one from a count, and a name\'s word stands');
		h.eq(JSON.stringify([itList, dzList]), before, 'mergeAlbums: the lists given are left as they were');
		h.eq(A.mergeAlbums([[{ source: 'itunes', id: 9, title: 'Fresh', date: '2020-01-01', type: 'Compilation' }], [{ source: 'deezer', id: 99, title: 'Fresh', date: '2020-01-01', type: 'album', typedBy: 'store' }]], M).map(function (x) { return x.type; }), ['compilation'], 'mergeAlbums: a compilation stays one');

		// ---- verify: one of our songs in a store's titles ----
		var ours = [tr('a', 'Paper Lanterns', 'Blue Signal (Starfall Odyssey)'), tr('b', 'Paper Lanterns', 'Home'), tr('c', 'Paper Lanterns', 'Rain'), tr('d', 'Paper Lanterns', 'Intro'), tr('e', 'Paper Lanterns', 'Sakura Biyori')];
		var v1 = A.verify(['Blue Signal', 'Something Else'], ours, M), v2 = A.verify(['Home'], ours, M), v3 = A.verify([{ title: 'Home' }, { title: 'Rain (Live)' }], ours, M), v4 = A.verify(['Intro', 'Outro'], ours, M), v5 = A.verify([SAKURA], ours, M);
		h.eq([v1.sure, v1.hits, v2.sure, v2.score, v3.sure, v4.sure, v4.score, v5.sure], [true, [{ id: 'a', title: 'Blue Signal (Starfall Odyssey)', as: 'Blue Signal' }], false, 0.5, true, false, 0, true],
			'verify: a telling title is enough (the bracket after ours aside); a short one ("Home") needs another; Intro and Outro say nothing; kana meet romaji');
		var twice = [tr('h1', 'Paper Lanterns', 'Home'), tr('h2', 'Paper Lanterns', 'Home (Live)')];
		h.eq([A.verify(['Home'], twice, M).score, A.verify(['Home'], twice, M).sure], [0.5, false], 'verify: one song uploaded twice counts once');
		h.eq([A.namedAlike('AOI  MINATO', ['Aoi Minato'], M), A.namedAlike('Aoi Minato Trio', ['Aoi Minato'], M), A.namedAlike('Yorushika', [YORUSHIKA], M), A.namedAlike('The Paper Lanterns', ['Paper Lanterns'], M)], [true, false, true, true], 'namedAlike: case, spaces, "the" and katakana against romaji; a longer name is another artist');

		// ---- finding, against the fixtures (iTunes, AnimeThemes) and an invented Deezer ----
		var mod = await import(url.pathToFileURL(path.join(h.HERE, 'test', 'fake-youtube.mjs')).href);
		var clock = T0;
		function now() { return clock; }
		var dzData = {
			'search/artist?q=Aoi%20Minato&limit=6': { data: [{ id: 501, name: 'Aoi Minato', nb_fan: 9000 }, { id: 502, name: 'Aoi Minato', nb_fan: 300 }, { id: 503, name: 'Aoi Minato Trio', nb_fan: 50 }] },
			'artist/501/top?limit=50': { data: [{ id: 5011, title: 'Neon Rain', duration: 200, artist: { id: 501, name: 'Aoi Minato' } }] },
			'artist/501/albums?limit=50': { data: [{ id: 5010, title: 'Neon Rain', release_date: '2018-01-01', record_type: 'single' }] },
			'artist/502/top?limit=50': { data: [{ id: 5021, title: 'Harbor of Small Lights', duration: 252, artist: { id: 502, name: 'Aoi Minato' }, album: { id: 5020, title: 'Harbor of Small Lights' } }, { id: 5022, title: 'Glass Harbor', duration: 230, artist: { id: 502, name: 'Aoi Minato' } }] },
			'artist/502/albums?limit=50': { data: [{ id: 5020, title: 'Harbor of Small Lights', release_date: '2019-04-24', record_type: 'single' }, { id: 5023, title: 'Tide Atlas', release_date: '2022-05-31', record_type: 'album' }, { id: 5024, title: 'Glass Harbor', release_date: '2024-02-02', record_type: 'ep' }] },
			'album/5020/tracks?limit=60': { data: [{ id: 5021, title: 'Harbor of Small Lights', duration: 252, artist: { id: 502, name: 'Aoi Minato' } }, { id: 5025, title: 'Night Ferry', duration: 238, artist: { id: 502, name: 'Aoi Minato' } }] },
			'album/5024/tracks?limit=60': { data: [{ id: 5022, title: 'Glass Harbor', duration: 230, artist: { id: 502, name: 'Aoi Minato' } }, { id: 5026, title: 'Harbor of Small Lights (Live)', duration: 260, artist: { id: 502, name: 'Aoi Minato' } }] },
			'search/artist?q=Kumori%20Station&limit=6': { data: [{ id: 601, name: 'Kumori Station', nb_fan: 70 }] },
			'artist/601/top?limit=50': { data: [{ id: 6011, title: 'Night Bus', duration: 199, artist: { id: 601, name: 'Kumori Station' } }] },
			'artist/601/albums?limit=50': { data: [{ id: 6010, title: 'Rust and Roses', release_date: '2026-10-15', record_type: 'single' }] }
		};
		var lib1 = [
			tr('yt00000001a', 'Aoi Minato', 'Harbor of Small Lights', { scene: 'anime', lang: 'ja' }),
			tr('yt00000002a', 'Aoi Minato', 'Lanterns Over Water', { scene: 'anime', lang: 'ja' }),
			tr('yt00000003a', 'Aoi Minato', 'Undertow', { lang: 'ja', album: 'Tide Atlas' }),
			tr('yt00000004a', 'Kumori Station', 'Second Current', { scene: 'anime', lang: 'ja' }),
			tr('yt00000005a', 'Aoi Minato & Kumori Station', 'Petal Engine', { scene: 'anime', lang: 'ja' })
		];
		// A fresh set of sources: the fixture fake, a cache on the test's clock, Deezer through discover.js.
		function rig(dzTransport) {
			var sf = mod.createSourceFake(), log = [], dzCalls = [];
			var http = httpWith(function (u, init) { log.push(u.replace('http://fixtures.test', '')); return sf.fetch(u, init); }, now);
			var cache = S.createCache({ store: Store.memory(), now: now });
			var dzc = D.createDeezer({ gapMs: 0, transport: dzTransport || function (u) { dzCalls.push(u.replace(D.API, '')); var k = u.replace(D.API, ''); return Promise.resolve(dzData[k] || { data: [] }); } });
			return { sf: sf, log: log, dzCalls: dzCalls, it: counted(S.iTunes(http, cache)), at: counted(S.animeThemes(http, cache)), dz: counted(S.deezerFinds(dzc, cache)) };
		}
		var r1 = rig(), map1 = kv();
		var ar = A.create({ it: r1.it, dz: r1.dz, at: r1.at, M: M, L: L, index: function () { return M.index(lib1); }, tracks: function () { return lib1; }, map: map1, now: now });
		var f1 = await ar.find('aoiminato');
		var itLog = r1.log.filter(function (u) { return /^\/itunes/.test(u); });
		h.eq([f1.key, f1.name, f1.itunes.id, f1.itunes.country, f1.itunes.sure, f1.itunes.why, f1.sure], ['aoiminato', 'Aoi Minato', 1700000001, 'JP', true, 'title', true], 'find: the artist on iTunes, sure: one of their songs is one of ours');
		h.ok(/country=JP/.test(itLog[0]) && /\/search\?term=Aoi%20Minato/.test(itLog[0]), 'find: asked in the Japanese store first (most of their songs here are anime songs)');
		h.eq(itLog.length, 2, 'find: frugal with iTunes: a search and the songs of the artist named alike (Aoi Minato Trio is not read)');
		h.eq([f1.deezer.id, f1.deezer.sure, f1.deezer.why], [502, true, 'title'], 'find: the namesake trap: Deezer\'s other Aoi Minato has more fans but none of our titles, so the one that has them is taken');
		h.eq(f1.animethemes, { slug: 'aoi_minato', name: 'Aoi Minato', sure: true, why: 'title' }, 'find: AnimeThemes by an equal name, sure by the songs they sang');
		h.eq(f1.candidates.map(function (c) { return c.source + ':' + c.id + ':' + c.name + ':' + c.alike; }), ['itunes:1700000003:Aoi Minato Trio:false', 'deezer:501:Aoi Minato:true', 'deezer:503:Aoi Minato Trio:false'], 'find: the other artists of that name (or holding it) as candidates for "Not this artist", the chosen ones left out');
		h.eq([f1.errors, typeof f1.at], [[], 'number'], 'find: no errors, and when it was asked');
		var rec1 = map1.m.get('artist:aoiminato');
		h.ok(rec1 && rec1.itunes.id === 1700000001 && rec1.deezer.id === 502 && rec1.animethemes.slug === 'aoi_minato' && rec1.sure === true && rec1.at === T0 && Array.isArray(rec1.no), 'find: kept in the map under artist:<key> as { itunes, deezer, animethemes, sure, at, no }');

		// only some sources now: a lane that needs Deezer's artist does not wait for iTunes
		var rq = rig();
		var arq = A.create({ it: rq.it, dz: rq.dz, at: rq.at, M: M, L: L, index: function () { return M.index(lib1); }, tracks: function () { return lib1; }, now: now });
		var fq = await arq.find('aoiminato', { sources: ['deezer'] });
		h.eq([fq.deezer.id, fq.itunes, fq.animethemes, rq.it.calls.length, rq.at.calls.length], [502, null, null, 0, 0], 'find: sources asks only those now');
		var dzBefore = rq.dz.calls.length, fq2 = await arq.find('aoiminato');
		h.eq([fq2.itunes.id, fq2.animethemes.slug, rq.it.calls.length > 0, rq.dz.calls.length - dzBefore], [1700000001, 'aoi_minato', true, 0], 'find: and the others on the next find, Deezer\'s answer kept');

		// sure versus probable, and the twin check
		var f2 = await ar.find({ name: 'Aoi Minato Trio' });
		h.eq([f2.key, f2.itunes.id, f2.itunes.sure, f2.sure, f2.deezer, f2.animethemes], ['aoiminatotrio', 1700000003, false, false, null, null], 'find: a name with no songs here to check: the artist of that name, probable only');
		var f3 = await ar.find('kumoristation');
		h.eq([f3.itunes.sure, f3.deezer.id, f3.deezer.sure, f3.deezer.why], [true, 601, true, 'twin'], 'find: Deezer\'s Kumori Station has none of our songs, but a release iTunes\'s sure one has: one artist, both sure');

		// ---- the discography ----
		var logAt = r1.log.length;
		var d1 = await ar.discography(f1);
		h.eq(r1.log.slice(logAt), ['/itunes/lookup?id=1700000001&entity=album&limit=200&country=JP'], 'discography: one more iTunes request (the releases): the songs read by find, and the AnimeThemes artist, come from the cache');
		function rows(list) { return list.map(function (x) { return x.date + ' ' + x.title; }); }
		h.eq([rows(d1.albums), rows(d1.eps), rows(d1.singles), rows(d1.compilations)], [
			['2022-06-01 Tide Atlas'], ['2024-02-02 Glass Harbor', '2021-11-10 Lanterns Over Water'], ['2023-07-19 The Far Shore', '2019-04-24 Harbor of Small Lights'], ['2019-06-26 Lumen Tide Original Soundtrack']
		], 'discography: albums, EPs, singles and compilations, newest first; iTunes\'s (" - EP", " - Single", three songs, the collection type) and Deezer\'s (record_type) as one list');
		var tideA = d1.albums[0], harbor = d1.singles[1], glass = d1.eps[0];
		h.eq([tideA.key, tideA.ids, tideA.source, tideA.country, harbor.ids, glass.key, glass.source, glass.link], ['it:album:1710000003', { itunes: 1710000003, deezer: 5023 }, 'itunes', 'JP', { itunes: 1710000001, deezer: 5020 }, 'dz:album:5024', 'deezer', 'https://www.deezer.com/album/5024'], 'discography: a release both stores list is one entry (iTunes leading, Deezer\'s id with it); Deezer\'s own stay');
		h.eq([tideA.have, tideA.haveFrom, d1.eps[1].have, harbor.have], [1, 'library', null, null], 'discography: have is null until the songs are read, unless the library\'s own album field tells');
		h.ok(!JSON.stringify(d1).match(/Neon Rain/), 'discography: nothing of the namesake');
		h.eq(d1.top.map(function (x) { return x.title + ':' + x.mine; }), ['Harbor of Small Lights:yt00000001a', 'Night Ferry:null', 'Lanterns Over Water:yt00000002a', 'Paper Lantern Parade:null', 'Undertow:yt00000003a', HIKARI + ':null', 'Tide Atlas:null', 'The Far Shore:null', 'Glass Harbor:null'],
			'discography: top songs, iTunes\'s then Deezer\'s, each song once, no instrumentals, ours marked mine');
		h.eq(d1.top[0], Object.assign(S.find(d1.top[0]), { mine: 'yt00000001a' }), 'discography: a top song is a find (sources.js)');
		h.eq(d1.anime.map(function (x) { return x.title + ' | ' + x.work + ' | ' + x.role + ' | ' + x.mine; }), [
			'Petal Engine | Iron Tulip | OP | yt00000005a', HIKARI + ' | Clockwork Meadow | insert | null', 'The Far Shore | Lumen Tide: The Far Shore | ED | null',
			'Lanterns Over Water | Lumen Tide 2nd Season | OP | yt00000002a', 'Harbor of Small Lights | Lumen Tide | OP | yt00000001a', 'Tidal Lullaby | Lumen Tide | insert | null'
		], 'discography: the anime songs they sang, newest first, with work and role; a duet in the library is ours too');
		h.eq(d1.errors, [], 'discography: no errors');

		// ---- an album's songs ----
		var epSongs = await ar.albumTracks(d1.eps[1]);
		h.eq([epSongs.have, epSongs.total, epSongs.tracks.map(function (x) { return x.seq + ':' + x.mine; })], [1, 4, ['1:yt00000002a', '2:null', '3:null', '4:null']], 'albumTracks: the EP\'s songs in order, ours marked (its instrumental is not ours), have and total');
		var tideSongs = await ar.albumTracks(tideA);
		h.eq(tideSongs.tracks.map(function (x) { return x.disc + '-' + x.seq + ' ' + x.title; }), ['1-1 Tide Atlas', '1-2 ' + HIKARI, '2-1 Undertow'], 'albumTracks: disc by disc');
		var glassSongs = await ar.albumTracks(glass);
		h.eq([glassSongs.have, glassSongs.total, glassSongs.tracks.map(function (x) { return x.seq + ' ' + x.key + ' ' + x.mine; })], [0, 2, ['1 dz:track:5022 null', '2 dz:track:5026 null']], 'albumTracks: a Deezer release, numbered in order; a live take of our song is not ours');
		var viaDz = await ar.albumTracks(harbor, { from: 'deezer' });
		h.eq([viaDz.tracks.map(function (x) { return x.key; }), viaDz.have], [['dz:track:5021', 'dz:track:5025'], 1], 'albumTracks: from the other store when asked');
		var d2 = await ar.discography(f1);
		h.eq([d2.albums[0].have, d2.albums[0].haveFrom, d2.eps[1].have, d2.eps[0].have, d2.singles[1].have], [1, 'tracks', 1, 0, 1], 'discography: have once the songs were read');
		r1.sf.set({ sourceFail: { itunes: 2 } });
		var fell = await ar.albumTracks(Object.assign({}, harbor, { key: 'it:album:1710000001:again' }));
		h.eq(fell.tracks.map(function (x) { return x.key; }), ['dz:track:5021', 'dz:track:5025'], 'albumTracks: when its store fails, the other store\'s copy');
		r1.sf.set({ reset: true });
		h.eq((await caught(ar.albumTracks({ key: 'x', id: 1, source: 'nowhere', title: 'Lost' }))).code, 'not-found', 'albumTracks: a release no source can read');

		// ---- corrections, the cache's time limits, the stores ----
		var sdb = [
			{ id: 11, name: 'Paper Lanterns', stores: { US: { songs: ['Neon Rain', 'Static Hymn'], albums: ['Neon Rain'] } } },
			{ id: 12, name: 'Paper Lanterns', stores: { US: { songs: ['Blue Signal', 'Harbor Light'], albums: ['Blue Signal - Single'] } } },
			{ id: 21, name: 'Glass Orchard', stores: { US: { songs: ['Other Things', 'Home'], albums: ['Elsewhere'] }, JP: { songs: ['Other Things'] } } },
			{ id: 31, name: 'Mizuiro Parade', stores: { US: { songs: ['Glass Kite'] } } },
			{ id: 41, name: 'Yorushika', terms: [YORUSHIKA], stores: { JP: { songs: [HARU] } } },
			{ id: 51, name: 'Saffron Circuit', stores: { US: { songs: ['Nothing Ours'], albums: ['Slow Current - Single'] } } },
			// found by a name in Latin letters, its releases credited in kanji (as the real JP store does)
			{ id: 61, name: 'Kenji Yonezawa', stores: { US: { songs: ['Kaze no Uta'], albums: [{ title: 'Kaze no Uta', artist: KANJI_NAME, count: 10 }, { title: 'Hana', artist: KANJI_NAME, count: 2 }, { title: 'Guest Spot - Single', artist: 'Glass Orchard', count: 1 }] } } }
		];
		var lib2 = [
			tr('pl1', 'Paper Lanterns', 'Blue Signal', { lang: 'en' }), tr('pl2', 'Paper Lanterns', 'Paper Weather', { lang: 'en' }),
			tr('go1', 'Glass Orchard', 'Winter Almanac', { lang: 'en' }), tr('go2', 'Glass Orchard', 'Home', { lang: 'en' }),
			tr('mp1', 'Mizuiro Parade', 'Glass Kite', { scene: 'vn', lang: 'ja' }), tr('yo1', 'Yorushika', HARU, { artistNative: YORUSHIKA, lang: 'ja' }),
			tr('sc1', 'Saffron Circuit', 'Slow Current', { lang: 'en' }), tr('vk1', 'Velvet Kites', 'Paper Garden', { lang: 'en' }),
			tr('ky1', 'Kenji Yonezawa', 'Kaze no Uta', { lang: 'en' })
		];
		var stores = storesFake(sdb), map2 = kv();
		var http2 = httpWith(stores.fetch, now), cache2 = S.createCache({ store: Store.memory(), now: now });
		var it2 = counted(S.iTunes(http2, cache2));
		var ar2 = A.create({ it: it2, M: M, L: L, index: function () { return M.index(lib2); }, tracks: function () { return lib2; }, map: map2, now: now });
		function asked(fn) { var n = stores.log.length; return fn().then(function (v) { return { v: v, log: stores.log.slice(n) }; }); }
		var pl = await asked(function () { return ar2.find('paperlanterns'); });
		h.eq([pl.v.itunes.id, pl.v.itunes.sure, pl.v.itunes.country, pl.log], [12, true, 'US', ['search US Paper Lanterns', 'song US 11', 'song US 12']], 'find: two artists of one name: the first has none of our songs, the second has one, and is taken');
		h.eq(pl.v.candidates.map(function (c) { return c.id; }), [11], 'find: the other Paper Lanterns is offered instead');
		var go = await asked(function () { return ar2.find('glassorchard'); });
		h.eq([go.v.itunes.id, go.v.itunes.sure, go.v.sure, go.log], [21, false, false, ['search US Glass Orchard', 'song US 21', 'album US 21', 'search JP Glass Orchard', 'song JP 21']], 'find: an equal name and none of our titles (one short title only) is probable: sure is false, after its songs, its releases and the other store');
		var one = [lib2.filter(function (t) { return t.id === 'go2'; })[0]];
		var ar3 = A.create({ it: S.iTunes(httpWith(storesFake(sdb).fetch, now), S.createCache({ store: Store.memory(), now: now })), M: M, L: L, index: function () { return M.index(one); }, tracks: function () { return one; }, map: kv(), now: now });
		var go1 = await ar3.find('glassorchard');
		h.eq([go1.itunes.id, go1.itunes.sure], [21, true], 'find: with one song of ours by them, its short title in common is all the evidence there can be: sure');
		h.ok(go.log.length <= A.ITUNES_MAX, 'find: within ITUNES_MAX iTunes requests');
		var mp = await asked(function () { return ar2.find('mizuiroparade'); });
		h.eq([mp.v.itunes.id, mp.v.itunes.country, mp.v.itunes.sure, mp.log], [31, 'US', true, ['search JP Mizuiro Parade', 'search US Mizuiro Parade', 'song US 31']], 'find: a visual-novel artist is looked for in Japan first, then found in the US store');
		var yo = await asked(function () { return ar2.find('yorushika'); });
		h.eq([yo.v.itunes.id, yo.v.itunes.country, yo.v.native, yo.log], [41, 'JP', YORUSHIKA, ['search JP Yorushika', 'search JP ' + YORUSHIKA, 'song JP 41']], 'find: then by the native name');
		var sc = await asked(function () { return ar2.find('saffroncircuit'); });
		h.eq([sc.v.itunes.sure, sc.v.itunes.why, sc.log], [true, 'album', ['search US Saffron Circuit', 'song US 51', 'album US 51']], 'find: sure by a release named as one of our songs');
		var vk = await asked(function () { return ar2.find('velvetkites'); });
		h.eq([vk.v, vk.log], [null, ['search US Velvet Kites', 'search JP Velvet Kites']], 'find: nobody of that name: null');
		h.eq(await ar2.find('nobody-here'), null, 'find: a key the library does not know: null');
		var kd = await ar2.discography(await ar2.find('kenjiyonezawa'));
		h.eq(kd.albums.concat(kd.eps, kd.singles, kd.compilations).map(function (x) { return x.title + ':' + x.guest; }), ['Kaze no Uta:false', 'Guest Spot:true', 'Hana:false'], 'discography: a release credited to someone else is a guest appearance; the store\'s own spelling of the artist (in kanji here) is theirs');
		h.ok(kd.albums.concat(kd.singles).every(function (x) { return x.haveFrom === '' && x.have === null && 'typedBy' in x && 'ids' in x && !('fans' in x); }), 'discography: every release has the same fields');

		// the time limits: found 90 days, "not there" 30, never for ever
		function searches() { return it2.calls.filter(function (c) { return c === 'searchArtist'; }).length; }
		var s0 = searches();
		clock = T0 + 29 * DAY;
		await ar2.find('velvetkites');
		await ar2.find('paperlanterns');
		h.eq(searches() - s0, 0, 'cache: within 30 days neither the artist found nor the one not found is looked for again');
		clock = T0 + 31 * DAY;
		await ar2.find('velvetkites');
		await ar2.find('paperlanterns');
		h.eq(searches() - s0, 2, 'cache: after 30 days "not there" is asked again (US and JP); the artist found is not');
		clock = T0 + 91 * DAY;
		var again = await ar2.find('paperlanterns');
		h.eq([searches() - s0, again.itunes.id, again.at], [3, 12, T0 + 91 * DAY], 'cache: after 90 days the artist found is checked again');
		var fresh = A.create({ it: it2, M: M, L: L, index: function () { return M.index(lib2); }, tracks: function () { return lib2; }, map: map2, now: now });
		var s1 = searches();
		h.eq([(await fresh.find('paperlanterns')).itunes.id, searches() - s1], [12, 0], 'cache: another session reads the map and asks nothing');
		var bare = A.create({ it: it2, M: M, L: L, index: function () { return M.index(lib2); }, tracks: function () { return lib2; }, now: now });
		await bare.find('paperlanterns');
		var s2 = searches();
		await bare.find('paperlanterns');
		var bare2 = A.create({ it: it2, M: M, L: L, index: function () { return M.index(lib2); }, tracks: function () { return lib2; }, now: now });
		await bare2.find('paperlanterns');
		h.eq([searches() - s2], [1], 'cache: without a map, kept for the session only');

		// corrections win
		var rj = await ar2.reject('paperlanterns', 'itunes', 12);
		h.eq([rj, map2.m.get('artist:paperlanterns').no], [null, ['itunes:12']], 'reject: that artist is out (nothing else is chosen yet) and the rejection is kept');
		var afterNo = await ar2.find('paperlanterns');
		h.eq([afterNo.itunes.id, afterNo.itunes.sure, afterNo.candidates.map(function (c) { return c.id; })], [11, false, []], 'reject: the next find asks again and takes the other artist of the name, probable; the rejected one is never offered');
		var s3 = searches();
		var yes = await ar2.confirm('paperlanterns', 'itunes', 11);
		h.eq([yes.itunes.id, yes.itunes.sure, yes.itunes.why, yes.sure], [11, true, 'confirmed', true], 'confirm: the listener\'s choice, sure');
		clock = T0 + 300 * DAY;
		var kept = await ar2.find('paperlanterns');
		h.eq([kept.itunes.id, kept.itunes.why, searches() - s3, map2.m.get('artist:paperlanterns').no], [11, 'confirmed', 0, ['itunes:12']], 'confirm: it stands, never looked for again, and the rejection stays');
		var back = await ar2.confirm('paperlanterns', 'itunes', { id: 12, name: 'Paper Lanterns', country: 'US' });
		h.eq([back.itunes.id, back.itunes.name, back.itunes.country, map2.m.get('artist:paperlanterns').no], [12, 'Paper Lanterns', 'US', []], 'confirm: a candidate object, and confirming takes a rejection back');
		h.eq((await caught(ar2.reject('paperlanterns', 'spotify', 1))).code, 'bad', 'reject: only iTunes, Deezer or AnimeThemes');
		clock = T0;

		// ---- failures: a source that does not answer ----
		var r3 = rig();
		r3.sf.set({ sourceFail: { itunes: 2 } });
		var ar3 = A.create({ it: r3.it, dz: r3.dz, at: r3.at, M: M, L: L, index: function () { return M.index(lib1); }, tracks: function () { return lib1; }, map: kv(), now: now });
		var part = await ar3.find('kumoristation');
		h.eq([part.itunes, part.deezer.id, part.animethemes.slug, part.errors.map(function (e) { return e.source + ':' + e.code; })], [null, 601, 'kumori_station', ['itunes:server']], 'find: iTunes failing leaves the others, and says so');
		var n3 = r3.it.calls.length;
		var part2 = await ar3.find('kumoristation');
		h.eq([part2.itunes.id, r3.it.calls.length > n3], [1700000002, true], 'find: a source that failed is asked again next time, not remembered as "not there"');
		var r4 = rig();
		r4.sf.set({ sourceFail: { itunes: 2 } });
		var lib4 = [tr('zz1', 'Velvet Kites', 'Paper Garden', { lang: 'en' })];
		var ar4 = A.create({ it: r4.it, dz: r4.dz, at: r4.at, M: M, L: L, index: function () { return M.index(lib4); }, tracks: function () { return lib4; }, now: now });
		var e4 = await caught(ar4.find('velvetkites'));
		h.eq([e4 && e4.code, S.isSourceError(e4)], ['server', true], 'find: nothing found and a source failed: its error is the answer');

		// ---- stopping ----
		var stop = new AbortController();
		stop.abort();
		var c0 = r1.it.calls.length + r1.dz.calls.length + r1.at.calls.length;
		var a1 = await caught(ar.find('kumoristation', { signal: stop.signal })), a2 = await caught(ar.discography(f1, { signal: stop.signal })), a3 = await caught(ar.albumTracks(harbor, { signal: stop.signal }));
		h.eq([a1.code, a2.code, a3.code, r1.it.calls.length + r1.dz.calls.length + r1.at.calls.length - c0], ['aborted', 'aborted', 'aborted', 0], 'abort: a signal already fired stops find, discography and albumTracks before anything is asked');
		var held = [], gateMap = kv();
		var gated = httpWith(function (u, init) {
			return new Promise(function (resolve, reject) {
				held.push(function () { stores.fetch(u, init).then(resolve, reject); });
				if (init && init.signal) init.signal.addEventListener('abort', function () { var e = new Error('The operation was aborted.'); e.name = 'AbortError'; reject(e); });
			});
		}, now);
		var ar5 = A.create({ it: S.iTunes(gated, S.createCache({ now: now })), M: M, L: L, index: function () { return M.index(lib2); }, tracks: function () { return lib2; }, map: gateMap, now: now });
		var stop2 = new AbortController(), pending = caught(ar5.find('paperlanterns', { signal: stop2.signal }));
		h.ok(await until(function () { return held.length > 0; }), 'abort: a find on its way (a request waiting for its answer)');
		stop2.abort();
		var a5 = await pending;
		h.eq([a5 && a5.code, gateMap.m.size], ['aborted', 0], 'abort: the signal stops it in flight, and nothing is kept');
		var silent = rig(function () { return new Promise(function () {}); });
		var ar6 = A.create({ it: null, dz: silent.dz, at: null, M: M, L: L, index: function () { return M.index(lib1); }, tracks: function () { return lib1; }, now: now });
		var stop3 = new AbortController(), pending3 = caught(ar6.discography({ key: 'aoiminato', name: 'Aoi Minato', itunes: null, deezer: { id: 502, name: 'Aoi Minato', sure: true }, animethemes: null, sure: true }, { signal: stop3.signal }));
		await h.tickAll();
		stop3.abort();
		h.eq((await pending3).code, 'aborted', 'abort: Deezer, which takes no signal, is let go of all the same');

		// ---- the demo: invented, the same every time, no network ----
		var demo = Demo.build(T0), dlib = demo.lib;
		function nothing() { throw new Error('the demo must not ask a source'); }
		var noNet = { searchArtist: nothing, artistSongs: nothing, albums: nothing, albumTracks: nothing, top: nothing, searchArtists: nothing, search: nothing, artist: nothing };
		var ard = A.create({ it: noNet, dz: noNet, at: noNet, M: M, L: L, index: function () { return M.index(L.list(dlib)); }, tracks: function () { return L.list(dlib); }, now: now });
		var dm = ard.demo('paperlanterns', dlib), dm2 = A.create({ M: M, L: L }).demo('paperlanterns', Demo.build(T0 + 5 * DAY).lib);
		h.ok(!!dm && JSON.stringify(dm) === JSON.stringify(ard.demo('paperlanterns', dlib)) && JSON.stringify(dm) === JSON.stringify(dm2), 'demo: the same artist and library, the same answer (any day, any instance)');
		h.eq(Object.keys(dm.found), ['key', 'name', 'native', 'itunes', 'deezer', 'animethemes', 'sure', 'candidates', 'at', 'errors', 'demo'], 'demo: found is shaped as find\'s answer');
		h.eq([dm.found.name, dm.found.sure, dm.found.itunes.country, dm.found.candidates.length > 0, Object.keys(dm.discography)], ['Paper Lanterns', true, 'US', true, ['top', 'albums', 'eps', 'singles', 'compilations', 'anime', 'errors', 'demo']], 'demo: the artist, sure, a namesake to say "not this one" to, and a discography shaped as the real one');
		var findKeys = Object.keys(S.find({}));
		var everySong = dm.discography.top.concat.apply(dm.discography.top, ['albums', 'eps', 'singles', 'compilations'].map(function (g) { return dm.discography[g].reduce(function (all, r) { return all.concat(r.tracks); }, []); }));
		h.ok(everySong.length > 20 && everySong.every(function (f) { return findKeys.every(function (k) { return k in f; }) && f.videoId === null && /^it:track:\d+$/.test(f.key) && 'mine' in f; }), 'demo: every song is a find (sources.js), videoId null, with mine');
		var mineTop = dm.discography.top.filter(function (f) { return f.mine; });
		h.ok(mineTop.length >= 3 && mineTop.length < dm.discography.top.length && mineTop.every(function (f) { return dlib.tracks[f.mine] && dlib.tracks[f.mine].artistKey === 'paperlanterns' && dlib.tracks[f.mine].title === f.title; }), 'demo: top songs, some of them the library\'s own (marked mine), some invented');
		h.ok(dm.discography.albums.length >= 1 && dm.discography.eps.length >= 1 && dm.discography.singles.length >= 3 && dm.discography.compilations.length === 1, 'demo: albums, EPs, singles and a best-of');
		var allRel = ['albums', 'eps', 'singles', 'compilations'].reduce(function (all, g) { return all.concat(dm.discography[g].map(function (r) { return [g, r]; })); }, []);
		h.ok(allRel.every(function (x) { var r = x[1]; return ({ album: 'albums', ep: 'eps', single: 'singles', compilation: 'compilations' })[r.type] === x[0] && /^it:album:\d+$/.test(r.key) && r.have === null && r.trackCount === r.tracks.length && r.tracks.every(function (t, i) { return t.seq === i + 1; }); }), 'demo: each release in its group, keyed like a real one, have null until read, its songs numbered');
		h.ok(['albums', 'eps', 'singles', 'compilations'].every(function (g) { var l = dm.discography[g]; return l.every(function (r, i) { return !i || r.date <= l[i - 1].date; }); }), 'demo: newest first');
		var firstAlbum = dm.discography.albums[0], dt = await ard.albumTracks(firstAlbum);
		var expectHave = {};
		firstAlbum.tracks.forEach(function (t) { if (t.mine) expectHave[t.mine] = true; });
		h.eq([dt.total, dt.have, dt.have > 0], [firstAlbum.tracks.length, Object.keys(expectHave).length, true], 'demo: an album\'s songs and how many are ours, without asking anyone');
		var dd = await ard.discography(dm.found);
		h.eq([dd.albums[0].have, dd.albums[0].haveFrom, dd.top.length], [dt.have, 'tracks', dm.discography.top.length], 'demo: its discography again from memory, have filled in once read');
		h.eq(await A.create({ it: noNet, dz: noNet, at: noNet, M: M, L: L }).discography(dm.found), { top: [], albums: [], eps: [], singles: [], compilations: [], anime: [], errors: [] }, 'demo: an instance that did not make it asks no source for its invented ids');
		var ks = ard.demo('kumoristation', dlib);
		h.ok(ks.found.itunes.country === 'JP' && ks.found.animethemes && ks.discography.anime.length >= 3 && ks.discography.anime.every(function (f) { return f.work && f.role && /^at:song:\d+$/.test(f.key) && f.source === 'animethemes'; }) && ks.discography.anime.some(function (f) { return f.mine; }), 'demo: an anime artist: the Japanese store, and anime songs with work and role, some ours');
		h.ok(ks.discography.singles.every(function (r) { return r.tracks.some(function (t) { return /\(Instrumental\)$/.test(t.title) && !t.mine; }); }), 'demo: a Japanese single comes with its instrumental');
		h.eq([ard.demo('nobody', dlib), ard.demo('', dlib), ard.demo('paperlanterns', null)], [null, null, null], 'demo: no such artist: null');
	});
};
