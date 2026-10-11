// recs: the taste profile, the lane filter and the feed's bookkeeping (recs.js), all pure;
// and foryou.js's pure parts.
module.exports = function (h) {
	var path = require('path');
	var R = require(path.join(h.HERE, 'recs.js'));
	var DAY = 86400000;

	h.describe('recs', async function () {
		var now = Date.UTC(2026, 9, 11, 12);

		// ---- profile: the songs, artists, works and channels the listener likes ----
		var tracks = {
			a: { id: 'a', playlists: ['p'], rating: 5, plays: 8, skips: 0, lastPlayed: new Date(now - 2 * DAY).toISOString(), artistKey: 'x', artist: 'X', work: 'W', scene: 'anime', channelId: 'c1', channel: 'C1' },
			b: { id: 'b', playlists: ['p'], rating: 0, plays: 40, skips: 3, lastPlayed: new Date(now - 60 * DAY).toISOString(), artistKey: 'x', artist: 'X!' },
			c: { id: 'c', playlists: ['p'], rating: 4, plays: 0, skips: 2, lastPlayed: null, artistKey: 'y', artist: 'Y' },
			d: { id: 'd', playlists: ['p'], rating: 0, plays: 0, skips: 4, artistKey: 'y', artist: 'Y' },
			e: { id: 'e', playlists: ['p'], rating: 5, plays: 9, blocked: true, artistKey: 'q', artist: 'Q' },
			f: { id: 'f', playlists: [], rating: 5, plays: 9, transient: true, artistKey: 'q', artist: 'Q' },
			g: { id: 'g', playlists: ['p'], rating: 5, plays: 9, kind: 'clip', artistKey: 'q', artist: 'Q' },
			k: { id: 'k', playlists: ['p'], rating: 0, plays: 1, skips: 0, lastPlayed: new Date(now - 40 * DAY).toISOString(), artistKey: 'z', artist: 'Z' }
		};
		var history = [{ id: 'c', at: now - DAY, kind: 'play' }, { id: 'k', at: now - DAY, kind: 'skip' }, { id: 'd', at: now - 50 * DAY, kind: 'play' }];
		var p = R.profile(tracks, history, now);
		h.eq(p.songs, [{ id: 'a', w: 7 }, { id: 'b', w: 4.927 }, { id: 'c', w: 3 }, { id: 'k', w: 0.25 }], 'profile: a song weighs 3 if liked + plays/4 (20 at most) + 2 if played in the last 30 days - skips/(plays+1); blocked songs, light tracks, clips and songs of weight 0 or less are left out');
		h.eq(R.songWeight({ rating: 4, plays: 0, skips: 2 }, true), 3, 'songWeight: a play in the history counts as recent; a skip in it does not');
		var xw = Math.round((7 + 4.927) / Math.SQRT2 * 1000) / 1000;
		h.eq(p.artists.map(function (a) { return [a.key, a.name, a.w, a.ids]; }), [['x', 'X', xw, ['a', 'b']], ['z', 'Z', 0.25, ['k']]], 'profile: an artist weighs the sum of its songs over the square root of their number; one whose skips outweigh its likes is left out');
		h.eq(p.works, [{ key: 'W', name: 'W', scene: 'anime', w: 7, ids: ['a'] }], 'profile: works, with their commonest scene');
		h.eq(p.channels, [{ id: 'c1', name: 'C1', w: 7, ids: ['a'] }], 'profile: channels');
		h.eq(R.profile([], [], now), { songs: [], artists: [], works: [], channels: [] }, 'profile: an empty library');
		h.eq(R.profile(Object.keys(tracks).map(function (k) { return tracks[k]; }), history, now).songs, p.songs, 'profile: a list of tracks is read like a map');

		// ---- nextSeed: Your radio turns through the top songs ----
		h.eq([R.nextSeed(p, null), R.nextSeed(p, 'a'), R.nextSeed(p, 'k'), R.nextSeed(p, 'gone'), R.nextSeed({ songs: [] }, null)], ['a', 'b', 'a', 'a', null], 'nextSeed: the song after the last seed, round again, the first when the last dropped out');

		// ---- seasons ----
		h.eq(R.currentSeason(now), { year: 2026, season: 'fall' }, 'currentSeason: October is fall');
		h.eq(R.currentSeason(Date.UTC(2026, 0, 1)), { year: 2026, season: 'winter' }, 'currentSeason: January is winter');
		h.eq(R.previousSeason(now), { year: 2026, season: 'summer' }, 'previousSeason: of a moment');
		h.eq(R.previousSeason({ year: 2026, season: 'winter' }), { year: 2025, season: 'fall' }, 'previousSeason: winter follows the last fall');
		h.eq(R.seasonName({ year: 2026, season: 'fall' }), 'Fall 2026', 'seasonName');

		// ---- filter: what a lane shows ----
		var F = function (key, artist, title, more) { var o = { key: key, artist: artist, title: title, videoId: null }; Object.keys(more || {}).forEach(function (k) { o[k] = more[k]; }); return o; };
		var f1 = F('at:song:1', 'A', 'One', { mine: 'lib1' }), f2 = F('dz:track:2', 'B', 'Two'), f3 = F('it:track:3', 'b', 'Two!'), f4 = F('dz:track:4', 'C', 'Four'), f5 = F('dz:track:5', 'C', 'Five');
		var f6 = F('dz:track:6', 'Hid', 'Six'), f7 = F('dz:track:7', 'D', 'Seven'), f8 = F('dz:track:2', 'B2', 'Other'), f9 = F('dz:track:9', 'E', 'Nine');
		var heardAt = { 'dz:track:4': now - 10 * DAY, 'dz:track:5': now - 40 * DAY };
		var got = R.filter([f1, f2, f7, f3, f4, f5, f6, f8, f9], {
			now: now, heard: function (f) { return heardAt[f.key] || 0; }, hidden: function (f) { return f.artist === 'Hid'; }, shown: { 'dz:track:7': 3, 'dz:track:9': { n: 2, at: now } }
		});
		h.eq(got.map(function (f) { return f.key; }), ['dz:track:2', 'dz:track:5', 'dz:track:9', 'dz:track:7'], 'filter: not the library\'s, not heard in 30 days, not hidden, each song once (by key, or by artist and title folded); shown 3 times, to the end');
		h.eq(R.filter([f1, f2], { have: function () { return false; } }).length, 2, 'filter: `have` decides what the library has');
		h.eq(R.filter([f2, f5, f9], { limit: 2 }).length, 2, 'filter: limit');
		h.eq(R.filter([f2], { heard: function () { return true; } }), [], 'filter: heard may say true');
		h.eq(R.filter([f2], { hidden: function () { throw new Error('x'); } }), [], 'filter: an item a check throws on is left out');
		var trk = { id: 'vid00000001', playlists: ['p'], artist: 'T', title: 'Track' };
		h.eq(R.filter([F('at:song:77', 'Other', 'Name', { videoId: 'vid00000001' }), trk], { have: function () { return false; } }).length, 1, 'filter: a find of a library track\'s video is that track');

		// ---- dedupeLanes: each item in its first lane ----
		var lanes = R.dedupeLanes([[f2, f5], { items: [f3, f9], note: 'x' }, { groups: [{ title: 'G', items: [f9, f7, f5] }], items: [f9, f7, f5] }, null]);
		h.eq([lanes[0].map(function (f) { return f.key; }), lanes[1].items.map(function (f) { return f.key; }), lanes[1].note, lanes[2].groups[0].items.map(function (f) { return f.key; }), lanes[2].items.map(function (f) { return f.key; }), lanes[3]], [['dz:track:2', 'dz:track:5'], ['dz:track:9'], 'x', ['dz:track:7'], ['dz:track:7'], null], 'dedupeLanes: lists, { items } and { groups } lanes, in order; the same song from another source counts');

		// ---- the shown book ----
		var book = R.seen({ old: { n: 5, at: now - 61 * DAY } }, ['a', 'b', 'a'], now);
		h.eq(book, { a: { n: 1, at: now }, b: { n: 1, at: now } }, 'seen: each key once; entries older than 60 days are forgotten');
		h.eq(R.seen(book, ['a'], now + 3600000).a.n, 1, 'seen: not again within 6 hours (a redraw)');
		var b2 = R.seen(R.seen(book, ['a'], now + 7 * 3600000), ['a'], now + 14 * 3600000);
		h.eq(R.counts(b2), { a: 3, b: 1 }, 'seen: again after 6 hours; counts()');
		h.eq(R.counts(R.touch(b2, 'a')), { b: 1 }, 'touch: the item counts from nothing');
		h.eq(R.touch(b2, ['a', 'b']), {}, 'touch: several keys');
		h.eq(book.a.n, 1, 'seen and touch never change the book they are given');

		// ---- visits ----
		h.eq(R.visit(null, now), { visits: { last: now, prev: 0 }, since: 0 }, 'visit: the first');
		h.eq(R.visit({ last: now - 3600000, prev: now - 9 * DAY }, now), { visits: { last: now - 3600000, prev: now - 9 * DAY }, since: now - 9 * DAY }, 'visit: a look within 6 hours is the same visit');
		h.eq(R.visit({ last: now - 2 * DAY, prev: now - 9 * DAY }, now), { visits: { last: now, prev: now - 2 * DAY }, since: now - 2 * DAY }, 'visit: a new visit; since is the one before');

		// ---- releases: coming, since the last visit, earlier ----
		var als = ['2026-10-20', '2026-10-11', '2026-09-01', '2026-06-20', '2026-05-01', 'soon'].map(function (d, i) { return { title: 'R' + i, date: d }; });
		function dates(r) { return [r.coming, r.fresh, r.earlier].map(function (l) { return l.map(function (a) { return a.date; }); }); }
		h.eq(dates(R.releases(als, { now: now })), [['2026-10-20'], ['2026-10-11', '2026-09-01', '2026-06-20'], []], 'releases: a first visit: the last 120 days, and what is coming');
		h.eq(dates(R.releases(als, { now: now, since: Date.UTC(2026, 8, 15) })), [['2026-10-20'], ['2026-10-11'], ['2026-09-01', '2026-06-20']], 'releases: new since the last visit, then the rest of the 120 days');
		var long = R.releases(als, { now: now, since: Date.UTC(2026, 3, 1) });
		h.eq([dates(long), long.from], [[['2026-10-20'], ['2026-10-11', '2026-09-01', '2026-06-20', '2026-05-01'], []], '2026-04-01'], 'releases: a last visit longer ago than 120 days reaches back to it');
		h.eq(R.releases(als, { now: now, since: now - 800 * DAY }).from, new Date(now - 365 * DAY).toISOString().slice(0, 10), 'releases: a year back at most');

		// ---- byCompletion, newSince, sinceWords ----
		h.eq(R.byCompletion([{ title: 'A', have: 3, total: 11 }, { title: 'B', have: 5, total: 6 }, { title: 'C', have: 4, total: 4 }, { title: 'D', have: 1, total: 2 }]).map(function (f) { return f.title; }), ['B', 'D', 'A'], 'byCompletion: the fewest missing first, then the larger share; complete ones are left out');
		var ups = [{ key: 'u1', addedAt: '2026-10-09T10:00:00Z' }, { key: 'u2', addedAt: '2026-10-01T10:00:00Z' }, { key: 'u3', addedAt: '2026-10-10T10:00:00Z' }, { key: 'u4' }];
		h.eq(R.newSince(ups, Date.UTC(2026, 9, 5)).map(function (f) { return f.key; }), ['u3', 'u1'], 'newSince: after the mark, newest first; an upload with no date is not new');
		var noon = new Date(2026, 9, 11, 15).getTime(), WD = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
		h.eq([R.sinceWords(new Date(2026, 9, 11, 9).getTime(), noon), R.sinceWords(new Date(2026, 9, 10, 23).getTime(), noon), R.sinceWords(new Date(2026, 9, 6, 8).getTime(), noon), R.sinceWords(new Date(2026, 9, 3).getTime(), noon), R.sinceWords(new Date(2025, 11, 30).getTime(), noon)],
			['today', 'yesterday', WD[new Date(2026, 9, 6).getDay()], 'Oct 3', 'Dec 30, 2025'], 'sinceWords: today, yesterday, a weekday this week, a date, a year');

		// ---- interleave, ratioName ----
		var its = [['a1', 'A'], ['a2', 'A'], ['b1', 'B'], ['a3', 'A'], ['c1', 'C']].map(function (x) { return { id: x[0], artist: x[1] }; });
		h.eq(R.interleave(its, function (x) { return x.artist; }).map(function (x) { return x.id; }), ['a1', 'b1', 'c1', 'a2', 'a3'], 'interleave: one of each key in turn, each key\'s own order kept');
		h.eq([0, 0.2, 0.3, 0.5, 0.7, 0.8, 1].map(R.ratioName), ['None', 'None', 'Some', 'Some', 'Lots', 'Lots', 'Lots'], 'ratioName: the nearest of None, Some, Lots');
		h.eq(R.RATIOS, [['None', 0], ['Some', 0.5], ['Lots', 0.8]], 'RATIOS: the dial');

		// ---- migrate: the old Discover page's keys ----
		var kv = {
			'discover:saved': [
				{ id: 123, title: 'Song', artist: 'Art', preview: 'https://cdnt-preview.dzcdn.net/x.mp3', cover: 'https://evil.example/x.jpg', savedAt: 5 },
				{ id: 'vid12345678', videoId: 'vid12345678', title: 'Vid', artist: 'V', channel: 'Ch', savedAt: 9 },
				{ id: 456, title: 'Dup', artist: 'D', savedAt: 1 }, null
			],
			'finds:saved': [{ key: 'dz:track:456', title: 'Dup', savedAt: 3 }],
			'discover:hidden': { someartist: true, other: true, no: false },
			'finds:hidden': { artist: { other: 7 }, song: { 'dz:track:1': 2 } },
			'discover:ids': { paperlanterns: { id: 99, name: 'Paper Lanterns', picture: '' }, gone: null, kept: { id: 5, name: 'Kept' }, 'undefined': { id: 1 } },
			'finds:map': { 'artist:kept': { key: 'kept', deezer: null }, 'work:x': { y: 1 } }
		};
		var m = R.migrate(kv, now);
		h.eq(m.remove, ['discover:saved', 'discover:hidden', 'discover:ids'], 'migrate: the old keys go');
		h.eq(m.set['finds:saved'].map(function (f) { return [f.key, f.source, f.savedAt]; }), [['v:vid12345678', 'saved', 9], ['dz:track:123', 'deezer', 5], ['dz:track:456', undefined, 3]], 'migrate: saved songs join finds:saved as finds, each once, newest first');
		var dz = m.set['finds:saved'][1];
		h.eq([dz.preview, dz.cover, dz.ids, m.set['finds:saved'][0].videoId, m.set['finds:saved'][0].channel], ['https://cdnt-preview.dzcdn.net/x.mp3', '', { dz: 123 }, 'vid12345678', 'Ch'], 'migrate: a find\'s preview and cover only from the hosts sources.js allows');
		h.eq(m.set['finds:hidden'], { artist: { other: 7, someartist: now }, song: { 'dz:track:1': 2 }, work: {}, channel: {} }, 'migrate: hidden artists join finds:hidden.artist; those already there keep their time');
		var map = m.set['finds:map'];
		h.eq([Object.keys(map).sort(), map['artist:paperlanterns'].deezer, map['artist:paperlanterns'].checked, map['artist:paperlanterns'].sure, map['artist:kept']], [['artist:kept', 'artist:paperlanterns', 'work:x'], { id: 99, name: 'Paper Lanterns', sure: true, why: 'title', picture: '', fans: 0 }, { deezer: now }, true, { key: 'kept', deezer: null }], 'migrate: Deezer ids found before become artists.js records, never over one that exists');
		var kv2 = { 'discover:saved': kv['discover:saved'], 'finds:saved': m.set['finds:saved'], 'discover:hidden': kv['discover:hidden'], 'finds:hidden': m.set['finds:hidden'], 'discover:ids': kv['discover:ids'], 'finds:map': m.set['finds:map'] };
		h.eq(R.migrate(kv2, now + DAY).set, {}, 'migrate: run again, it changes nothing');
		h.eq(R.migrate({}, now), { set: {}, remove: [] }, 'migrate: nothing old, nothing to do');

		var Store = require(path.join(h.HERE, 'store.js'));
		var st = Store.memory();
		await st.set('discover:saved', kv['discover:saved']);
		await st.set('discover:hidden', { someartist: true });
		await st.set('finds:saved', kv['finds:saved']);
		var done = await R.migrateStore(st, now);
		var after = await Promise.all(['discover:saved', 'discover:hidden', 'finds:saved', 'finds:hidden'].map(function (k) { return st.get(k, 'none'); }));
		h.eq([done.remove, after[0], after[1], after[2].length, after[3].artist], [['discover:saved', 'discover:hidden'], 'none', 'none', 3, { someartist: now }], 'migrateStore: written to the store, the old keys removed');
		h.eq((await R.migrateStore(st, now)).set, {}, 'migrateStore: a second run finds nothing to move');
		h.eq((await R.migrateStore(null, now)).remove, [], 'migrateStore: no store, nothing');

		// =========================================================================
		// foryou.js: the parts that need no page
		// =========================================================================
		var Fy = require(path.join(h.HERE, 'foryou.js'));
		var S = require(path.join(h.HERE, 'sources.js'));
		var url = require('url');
		var fake = await import(url.pathToFileURL(path.join(h.HERE, 'test', 'fake-youtube.mjs')).href);
		h.eq(Fy.LANES, ['radio', 'season', 'airing', 'series', 'releases', 'channels', 'because', 'saved', 'hidden'], 'foryou LANES: the page, in order');

		// ---- joinSeason over the fixtures, through sources.js's own clients ----
		var sf = fake.createSourceFake(), asked = [];
		var hosts = S.endpointsFor({ test: true, base: 'http://fixtures.test' });
		Object.keys(hosts).forEach(function (k) { hosts[k].gap = 0; });
		var http = S.createHttp({ hosts: hosts, onLine: function () { return true; }, sleep: function () { return Promise.resolve(); }, fetch: function (u, init) { asked.push(String(u)); return sf.fetch(u, init); } });
		var cache = S.createCache({ now: function () { return now; } });
		var fall = R.currentSeason(now);
		var al = await S.aniList(http, cache).season(fall.year, fall.season), at = await S.animeThemes(http, cache).season(fall.year, fall.season);
		var j = Fy.joinSeason(al, at, fall);
		h.eq(j.anime.map(function (a) { return [a.id, a.slug, a.title, a.popularity, a.themes.map(function (f) { return f.role + f.seq; })]; }),
			[[900004, 'clockwork_meadow', 'Clockwork Meadow', 48210, ['OP1', 'ED1', 'insert1']], [900005, 'starlit_bakery', 'Starlit Bakery', 30500, ['OP1', 'ED1']], [900006, 'iron_tulip', 'Iron Tulip', 21877, ['OP1']]],
			'joinSeason: AniList\'s order (popularity), AnimeThemes\'s songs, met by AniList id; an anime with no songs and one AnimeThemes lacks are left out');
		h.eq([j.without, j.anime[0].season, j.anime[0].themes[0].key.indexOf('at:song:') === 0], [2, { year: 2026, season: 'fall' }, true], 'joinSeason: how many had no songs; the season; theme finds');
		j.anime[0].themes[0].mine = 'x';
		h.eq(at[0].themes[0].mine, undefined, 'joinSeason: the themes are copies (the cache\'s answers stay as they were)');
		var byName = Fy.joinSeason([{ id: 1, title: { romaji: 'Clockwork Meadow!', english: 'The Gear Field' }, popularity: 5 }], at, fall);
		h.eq([byName.anime.length, byName.anime[0].slug, byName.anime[0].titleAlt], [1, 'clockwork_meadow', 'The Gear Field'], 'joinSeason: without the id, by the name folded; the English title as titleAlt');
		h.eq(Fy.joinSeason(null, null).anime, [], 'joinSeason: nothing in, nothing out');

		// ---- airingOf, dayRange, airingToday (AniList's airingSchedule, cached) ----
		var sched = { airingAt: 1791703800, episode: 2, media: { id: 189123, title: { romaji: 'Ao no Hako Season 2', english: 'Blue Box Season 2', native: 'x' }, popularity: 45032, isAdult: false, format: 'TV', season: 'FALL', seasonYear: 2026, coverImage: { medium: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/small/bx189123.jpg' } } };
		h.eq(Fy.airingOf(sched), { id: 189123, title: { romaji: 'Ao no Hako Season 2', english: 'Blue Box Season 2', native: 'x' }, cover: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/small/bx189123.jpg', popularity: 45032, format: 'TV', adult: false, episode: 2, at: 1791703800000, season: { year: 2026, season: 'fall' } }, 'airingOf: AniList\'s schedule as a show (the shape seen on 2026-10-11)');
		h.eq([Fy.airingOf({ media: { id: 5, coverImage: { medium: 'https://evil.example/x.jpg' }, season: null } }).cover, Fy.airingOf({ media: { id: 5 } }).season], ['', null], 'airingOf: a cover only from AniList\'s host; no season when AniList has none');
		var local = new Date(2026, 9, 11, 15, 30).getTime(), dr = Fy.dayRange(local);
		h.eq([dr.from * 1000, dr.day, dr.to > dr.from], [new Date(2026, 9, 11).getTime(), '2026-10-11', true], 'dayRange: today from local midnight, in seconds');
		var posts = [];
		var pageOf = function (n) { return { data: { Page: { pageInfo: { hasNextPage: n === 1 }, airingSchedules: n === 1 ? [sched, { airingAt: 1791710000, episode: 7, media: { id: 7, isAdult: true, title: { romaji: 'Adult' } } }] : [{ airingAt: 1791720000, episode: 1, media: { id: 8, title: { romaji: 'Later' }, season: 'FALL', seasonYear: 2026 } }, { airingAt: 1, media: null }] } } }; };
		var fakeD = { Src: S, cache: S.createCache({ now: function () { return local; } }), http: { post: function (host, p, body) { posts.push([host, p, body.variables]); return Promise.resolve(pageOf(body.variables.page)); } } };
		var shows = await Fy.airingToday(fakeD, local);
		h.eq([shows.map(function (s) { return s.id; }), posts.length, posts[0][0], posts[0][2].from, posts[0][2].to, /airingSchedules/.test(Fy.AIRING)], [[189123, 8], 2, 'anilist', dr.from - 1, dr.to, true], 'airingToday: every page of today\'s schedule, adult titles and broken entries left out');
		await Fy.airingToday(fakeD, local + 3600000);
		h.eq(posts.length, 2, 'airingToday: kept for three hours');
		await h.rejects(Fy.airingToday({ Src: S, cache: S.createCache({ now: function () { return local; } }), http: { post: function () { return Promise.resolve({ errors: [{}] }); } } }, local), function (e) { return e.code === 'bad'; }, 'airingToday: an answer without a page is a SourceError');

		// ---- itunesPreview: an anime song's Apple preview, the same song only ----
		var gets = [];
		var itD = { Src: S, cache: S.createCache({ now: function () { return now; } }), http: { get: function (host, p, o) { gets.push([host, p, o.query.term, o.query.country]); return Promise.resolve({ results: [
			{ trackName: 'Gearsong (TV Size)', artistName: 'Someone Else', trackTimeMillis: 90000, previewUrl: 'https://audio-ssl.itunes.apple.com/a.m4a' },
			{ trackName: 'Gearsong', artistName: 'Kiri Hanase', trackTimeMillis: 240000, previewUrl: 'https://evil.example/b.m4a' },
			{ trackName: 'Gearsong', artistName: 'Kiri Hanase', trackTimeMillis: 241000, previewUrl: 'https://audio-ssl.itunes.apple.com/c.m4a' }
		] }); } } };
		var song = S.find({ key: 'at:song:1', title: 'Gearsong', artist: 'Kiri Hanase', people: ['Kiri Hanase'], source: 'animethemes', ids: { at: 1 } });
		var pv = await Fy.itunesPreview(itD, song);
		h.eq([pv && pv.preview, pv && pv.key, song.preview, gets[0].slice(0, 4)], ['https://audio-ssl.itunes.apple.com/c.m4a', 'at:song:1', '', ['itunes', '/search', 'Kiri Hanase Gearsong', 'US']], 'itunesPreview: the same song by the same artist, from Apple\'s preview host only; the find itself is left as it was');
		await Fy.itunesPreview(itD, song);
		h.eq(gets.length, 1, 'itunesPreview: the search is kept');
		h.eq(await Fy.itunesPreview(itD, S.find({ key: 'at:song:2', title: 'Unrelated', artist: 'Nobody', source: 'animethemes', ids: { at: 2 } })), null, 'itunesPreview: none for another song');

		// ---- stream: one at a time, the first result early, a pause ----
		var order = [], wantIt = true;
		var stm = Fy.stream(['a', 'none', 'bad', 'b', 'c'], function (x) {
			order.push(x);
			if (x === 'none') return null;
			if (x === 'bad') return Promise.reject(new Error('nope'));
			return new Promise(function (ok) { setTimeout(function () { ok(x.toUpperCase()); }, 5); });
		}, { want: function () { return wantIt; } });
		var heardR = [];
		stm.on(function (r) { heardR.push(r); if (r === 'B') wantIt = false; });
		await stm.first;
		h.eq([stm.results.slice(), stm.done], [['A'], false], 'stream: first resolves at the first result, the rest still coming');
		await new Promise(function (ok) { setTimeout(ok, 60); });
		h.eq([stm.results.slice(), stm.errors.length, stm.done, order], [['A', 'B'], 1, false, ['a', 'none', 'bad', 'b']], 'stream: nothing for a null, an error kept, and it pauses while it is not wanted');
		wantIt = true;
		stm.resume();
		await new Promise(function (ok) { setTimeout(ok, 60); });
		h.eq([stm.results, stm.done, heardR], [['A', 'B', 'C'], true, ['A', 'B', 'C', null]], 'stream: resume() goes on; the end is heard as null');
		var empty = Fy.stream([], function () { return 1; });
		await empty.first;
		h.eq([empty.done, empty.results], [true, []], 'stream: an empty list is done at once');

		// ---- the demo's invented anime and related artists ----
		var Dm = require(path.join(h.HERE, 'demo.js')), Lb = require(path.join(h.HERE, 'library.js'));
		var dlib = Dm.build(now).lib, seq = Lb.list(dlib).filter(function (t) { return t.scene === 'anime' && t.work && t.artist && (t.role === 'OP' || t.role === 'ED'); })[0];
		var curS = Fy.demoSeason(dlib, fall, { n: 10, sequelOf: seq.id }), prevS = Fy.demoSeason(dlib, R.previousSeason(fall), { n: 8 });
		var keysD = {}, dupD = 0;
		curS.concat(prevS).forEach(function (a) { a.themes.forEach(function (f) { if (keysD[f.key]) dupD++; keysD[f.key] = true; }); });
		h.eq([curS.length, prevS.length, dupD, curS[0].title, curS[0].themes[0].title, curS[0].themes[0].artist], [10, 8, 0, seq.work + ' 3rd Season', seq.title, seq.artist], 'demoSeason: ten anime, the first the library\'s work\'s new season opening with its song; no key twice');
		var namesC = curS.map(function (a) { return a.title; }), shared = prevS.filter(function (a) { return namesC.indexOf(a.title) >= 0; });
		h.eq(shared, [], 'demoSeason: two seasons in a row share no anime');
		h.ok(curS.every(function (a) { return a.themes.every(function (f) { return f.videoId === null && !f.preview && !f.cover && f.title.split(' ')[0] !== f.title.split(' ')[1]; }); }), 'demoSeason: invented songs: no video, no preview, no picture, no word twice in a title');
		var taken = {};
		Lb.list(dlib).forEach(function (t) { if (t.artist) taken[t.artist.toLowerCase().replace(/[^a-z0-9]+/g, '')] = true; });
		var rel = Fy.demoRelated('Paper Lanterns', 0, { mothradio: true });
		h.eq([rel.length, rel.every(function (f) { return /^dz:track:77/.test(f.key) && f.artist !== 'Moth Radio' && f.why[0][0] === 'related'; })], [8, true], 'demoRelated: eight Deezer-shaped songs by four artists, none of a name taken');
	});
};
