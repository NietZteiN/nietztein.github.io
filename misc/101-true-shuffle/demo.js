/*
 * True Shuffle: the demo library.
 *
 * EVERYTHING HERE IS INVENTED. No artist, track, channel or playlist in this
 * file exists; the ids ("demo-001") are not YouTube ids and nothing here can
 * be played. The page shows LABEL wherever this library is on screen.
 *
 *     var demo = TrueShuffle.demo.build(now);
 *     demo.lib        a library.js library of 160 tracks in four playlists
 *     demo.errors     { id: code }: what the mock player should fail on
 *     demo.label      the sentence to show
 *
 * The titles are written the ways uploaders write them (an auto-generated
 * Topic channel, a VEVO channel, "Artist - Title (Official Video)", corner
 * brackets, a numbered soundtrack, classical movements, one channel whose
 * "Title / Artist" format the parser cannot be sure of, and one stranger's
 * channel of "Artist - Title" uploads that nothing vouches for, shown as
 * guesses), so the demo also shows the parser, the unknown-artist list and
 * what teaching a channel does. Play counts, ratings and dates are made up from a fixed seed and
 * placed relative to `now`, so every listening mode has something to show.
 *
 * UMD: window.TrueShuffle.demo in the browser, module.exports in Node.
 * Needs library.js and shuffle.js loaded before it.
 */
(function (root, factory) {
	var node = typeof module === 'object' && module.exports;
	var api = factory(node ? require('./library.js') : (root.TrueShuffle || {}).library, node ? require('./shuffle.js') : (root.TrueShuffle || {}).shuffle);
	if (node) module.exports = api;
	else { root.TrueShuffle = root.TrueShuffle || {}; root.TrueShuffle.demo = api; }
})(typeof self !== 'undefined' ? self : this, function (Library, Shuffle) {
	'use strict';

	var LABEL = 'Demo library: every artist, track and playlist here is invented, and nothing is played.';
	var DAY = 86400000;
	var WIKI = 'https://en.wikipedia.org/wiki/';
	var LQ = String.fromCharCode(0x300C), RQ = String.fromCharCode(0x300D);     // corner brackets
	var LL = String.fromCharCode(0x3010), RL = String.fromCharCode(0x3011);     // lenticular brackets
	var E_ACUTE = String.fromCharCode(0xE9);

	var WORDS_A = ['Blue', 'Paper', 'Quiet', 'Hollow', 'Amber', 'Northern', 'Borrowed', 'Electric', 'Slow', 'Winter', 'Glass', 'Second', 'Copper', 'Late', 'Small', 'Faded', 'Open', 'Salt', 'Midnight', 'Morning', 'Silver', 'Distant', 'Velvet', 'Crooked', 'Sunken', 'Bright', 'Narrow', 'Hidden', 'Last', 'Painted'];
	var WORDS_B = ['Signal', 'Almanac', 'Harbor', 'Orchard', 'Current', 'Static', 'Kindling', 'Mosaic', 'Crossing', 'Engine', 'Meadow', 'Window', 'Letters', 'Tide', 'Compass', 'Staircase', 'Garden', 'Radio', 'Echo', 'Lighthouse', 'Satellite', 'Avenue', 'Weather', 'Arcade', 'Telegram', 'Rooftops', 'Ferry', 'Lullaby', 'Atlas', 'Parade'];

	// name, how many tracks, YouTube topic names, release years, how the
	// uploads are titled, and the channel they sit on.
	var ARTISTS = [
		{ name: 'Paper Lanterns', n: 26, topics: ['Rock_music', 'Independent_music'], years: [1993, 2004], style: 'topic' },
		{ name: 'Glass Orchard', n: 14, topics: ['Pop_music'], years: [2011, 2019], style: 'vevo', channel: 'GlassOrchardVEVO' },
		{ name: 'Hollow Compass', n: 12, topics: ['Rock_music'], years: [1974, 1986], style: 'old', channel: 'cassette drawer' },
		{ name: 'Neon Abacus', n: 12, topics: ['Electronic_music'], years: [2014, 2024], style: 'official', channel: 'Neon Abacus Official' },
		{ name: 'Saffron Circuit', n: 10, topics: ['Electronic_music', 'Pop_music'], years: [2002, 2009], style: 'topic' },
		{ name: 'Quiet Ferrymen', n: 10, topics: ['Country_music'], years: [1981, 1989], style: 'old', channel: 'Quiet Ferrymen' },
		{ name: 'Tin Lighthouse Trio', n: 12, topics: ['Jazz'], years: [1962, 1996], style: 'topic', suite: 'Night Suite' },
		{ name: 'DJ Tessellate', n: 10, topics: ['Hip_hop_music', 'Electronic_music'], years: [2005, 2022], style: 'feat', channel: 'DJ Tessellate' },
		{ name: 'Marrow & Pine', n: 9, topics: ['Independent_music', 'Country_music'], years: [2012, 2018], style: 'live', channel: 'Marrow & Pine' },
		{ name: 'The Velvet Algorithms', n: 9, topics: ['Rhythm_and_blues', 'Soul_music'], years: [1971, 1979], style: 'topic' },
		{ name: 'Kumori Station', n: 10, topics: ['Pop_music', 'Music_of_Asia'], years: [2015, 2025], style: 'quote', channel: 'Kumori Station Official YouTube Channel' },
		{ name: 'Las Polillas El' + E_ACUTE + 'ctricas', n: 8, topics: ['Music_of_Latin_America', 'Rock_music'], years: [1995, 2006], style: 'topic' },
		{ name: 'Aldric Vessant', n: 6, topics: ['Classical_music'], years: [2016, 2019], style: 'classical', channel: 'Orchestra of Minor Tides' },
		{ name: '', n: 6, topics: [], years: [2013, 2013], style: 'ost', channel: 'pixel archive', album: 'Starfall Odyssey' },
		{ name: 'Mizuiro Parade', n: 4, topics: ['Pop_music', 'Music_of_Asia'], years: [2018, 2023], style: 'slash', channel: 'aozora uploads' }
	];
	var GUESTS = ['Mira Osei', 'Tobin Vale', 'Aoba Rin', 'Glass Orchard'];
	var MOVEMENTS = ['I. Allegro moderato', 'II. Andante', 'III. Presto'];
	var WORKS = ['Symphony No. 3 in D minor, Op. 21', 'String Quartet No. 2, Op. 14'];
	var PLAYLISTS = [
		{ id: 'demo-liked', title: 'Liked videos', special: 'likes' },
		{ id: 'demo-commute', title: 'Commute' },
		{ id: 'demo-late', title: 'Late night' },
		{ id: 'demo-focus', title: 'Focus' }
	];

	function pad(n) { return (n < 10 ? '00' : n < 100 ? '0' : '') + n; }
	function isoDay(ms) { return new Date(ms).toISOString(); }

	// The raw material: videos as yt.js would hand them over, each with the
	// playlists it is in and the made-up listening state.
	// -> [{ video, playlists: { id: addedAt }, state: { plays, skips, rating, lastPlayed, blocked }, error }]
	function make(now) {
		now = now == null ? Date.now() : now;
		var r = Shuffle.rng('true-shuffle-demo'), out = [], used = {}, serial = 0;
		function between(a, b) { return a + r.int(b - a + 1); }
		function title() {
			for (var guard = 0; guard < 200; guard++) {
				var t = WORDS_A[r.int(WORDS_A.length)] + ' ' + WORDS_B[r.int(WORDS_B.length)];
				if (!used[t]) { used[t] = true; return t; }
			}
			return 'Untitled ' + (++serial);
		}
		function add(a, i, rawTitle, channel, more) {
			var id = 'demo-' + pad(out.length + 1);
			var year = between(a.years[0], a.years[1]);
			var v = {
				id: id, title: rawTitle, channel: channel, channelId: 'demo-ch-' + channel.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
				durationSec: between(150, 330), publishedAt: isoDay(Date.UTC(between(2009, 2023), r.int(12), 1 + r.int(27))),
				embeddable: true, topics: a.topics.map(function (t) { return WIKI + t; }).concat([WIKI + 'Music']), year: null, live: false
			};
			if (a.style === 'topic') v.year = year;                      // an auto-generated description states the release date
			if (a.style === 'vevo' || a.style === 'official' || a.style === 'quote' || a.style === 'feat' || a.style === 'live' || a.style === 'slash' || a.style === 'classical' || a.style === 'ost') {
				v.publishedAt = isoDay(Date.UTC(year, r.int(12), 1 + r.int(27)));
			}
			for (var k in (more || {})) v[k] = more[k];
			// Which playlists, and when it was added to each.
			var lists = {};
			var quietKind = a.topics.indexOf('Jazz') >= 0 || a.topics.indexOf('Classical_music') >= 0 || a.topics.indexOf('Electronic_music') >= 0 || a.style === 'ost';
			var recent = r.int(12) === 0;
			function when() { return isoDay(now - (recent ? between(0, 9) : between(20, 900)) * DAY - r.int(DAY)); }
			if (r.int(100) < 45) lists['demo-liked'] = when();
			if (r.int(100) < 35) lists['demo-commute'] = when();
			if (r.int(100) < 30) lists['demo-late'] = when();
			if (quietKind && r.int(100) < 50) lists['demo-focus'] = when();
			if (!Object.keys(lists).length) lists['demo-liked'] = when();
			// What the listener has done with it.
			var st = { plays: 0, skips: 0, rating: 0, lastPlayed: null, blocked: false };
			if (r.int(100) >= 35) {
				st.plays = 1 + Math.floor(Math.pow(r(), 2.2) * 30);
				st.lastPlayed = isoDay(now - (0.2 + r() * 200) * DAY);
				st.skips = r.int(4) === 0 ? 1 + r.int(4) : 0;
			}
			if (r.int(100) < 40) st.rating = [1, 2, 3, 3, 4, 4, 4, 5, 5, 5][r.int(10)];
			out.push({ video: v, playlists: lists, state: st, error: 0 });
			return out[out.length - 1];
		}

		ARTISTS.forEach(function (a) {
			var i, t, x;
			var topic = a.name + ' - Topic';
			for (i = 0; i < a.n; i++) {
				if (a.style === 'topic') {
					if (a.suite && i < 3) add(a, i, a.suite + ', Pt. ' + (i + 1), topic, { durationSec: between(540, 700), year: 1974 });
					else { t = title(); add(a, i, i % 9 === 8 ? t + ' (Live)' : i % 7 === 6 ? t + ' (Remastered 2011)' : t, topic); }
				} else if (a.style === 'vevo') {
					add(a, i, a.name + ' - ' + title() + (i % 3 === 0 ? ' (Official Video)' : i % 3 === 1 ? ' (Official Lyric Video)' : ' [Official Audio]'), a.channel);
				} else if (a.style === 'old') {
					t = title();
					x = between(a.years[0], a.years[1]);
					add(a, i, a.name + ' - ' + t + (i % 2 === 0 ? ' (' + x + ')' : i % 5 === 1 ? ' [HD]' : ''), a.channel);
				} else if (a.style === 'official') {
					t = title();
					add(a, i, i % 4 === 3 ? t + ' (DJ Tessellate Remix)' : i % 4 === 2 ? t + ' (Official Audio)' : t + ' (Official Video)', a.channel, i === 5 ? { durationSec: 665, title: t + ' (Extended Mix)' } : null);
				} else if (a.style === 'feat') {
					add(a, i, a.name + ' - ' + title() + (i % 2 === 0 ? ' (feat. ' + GUESTS[i % GUESTS.length] + ')' : '') + (i % 3 === 0 ? ' [Official Video]' : ''), a.channel);
				} else if (a.style === 'live') {
					add(a, i, a.name + ' - ' + title() + (i % 3 === 2 ? ' (Acoustic)' : ' (Live at Red Hollow)'), a.channel, { durationSec: between(200, 420) });
				} else if (a.style === 'quote') {
					t = title();
					add(a, i, i % 3 === 0 ? LL + 'MV' + RL + a.name + LQ + t + RQ : i % 3 === 1 ? a.name + LQ + t + RQ + 'Music Video' : a.name + ' ' + LQ + t + RQ + ' (Live ver.)', a.channel);
				} else if (a.style === 'classical') {
					add(a, i, a.name + ': ' + WORKS[Math.floor(i / 3)] + ' - ' + MOVEMENTS[i % 3] + ' - ' + a.channel, a.channel, { durationSec: between(380, 720) });
				} else if (a.style === 'ost') {
					add(a, i, a.album + ' OST - ' + (i + 1 < 10 ? '0' : '') + (i + 1) + ' - ' + title(), a.channel, { durationSec: between(95, 200), topics: [WIKI + 'Music', WIKI + 'Video_game_culture'] });
				} else if (a.style === 'slash') {
					add(a, i, title() + ' / ' + a.name, a.channel);
				}
			}
		});

		// The same song uploaded twice, for the duplicates report.
		var glass = out.filter(function (e) { return e.video.channel === 'GlassOrchardVEVO'; });
		[glass[0], glass[4]].forEach(function (e) {
			var again = add(ARTISTS[1], 0, e.video.title.replace(/\s*[(\[].*$/, '') + ' (Lyrics)', 'lyric lantern', { durationSec: e.video.durationSec + 2 });
			again.state = { plays: 0, skips: 0, rating: 0, lastPlayed: null, blocked: false };
		});

		// A few awkward ones: two the listener blocked, one YouTube already
		// reports as not embeddable, and three the player will refuse.
		out[9].state.blocked = true;
		out[61].state.blocked = true;
		out[30].video.embeddable = false;
		out[20].error = 100;
		out[47].error = 150;
		out[88].error = 101;
		return out;
	}

	// The videos alone, as yt.js's records.
	function videos(now) { return make(now).map(function (e) { return e.video; }); }

	// The whole demo: a library built through the same upsert() an import
	// uses, then given its listening state.
	function build(now) {
		now = now == null ? Date.now() : now;
		var entries = make(now), lib = Library.create(), errors = {};
		PLAYLISTS.forEach(function (p) {
			var mine = entries.filter(function (e) { return e.playlists[p.id]; }), addedAt = {};
			mine.forEach(function (e) { addedAt[e.video.id] = e.playlists[p.id]; });
			Library.setPlaylist(lib, { id: p.id, title: p.title, count: mine.length, privacy: 'demo', special: p.special || '', importedAt: new Date(now).toISOString() });
			Library.upsert(lib, mine.map(function (e) { return e.video; }), { playlistId: p.id, addedAt: addedAt, now: now });
		});
		Library.resolveArtists(lib);
		entries.forEach(function (e) {
			var t = lib.tracks[e.video.id];
			t.plays = e.state.plays; t.skips = e.state.skips; t.rating = e.state.rating; t.lastPlayed = e.state.lastPlayed; t.blocked = e.state.blocked;
			if (e.error) errors[e.video.id] = e.error;
		});
		return { lib: lib, errors: errors, label: LABEL, playlists: PLAYLISTS.map(function (p) { return lib.playlists[p.id]; }) };
	}

	return { LABEL: LABEL, build: build, videos: videos, make: make, ARTISTS: ARTISTS.map(function (a) { return a.name; }).filter(Boolean) };
});
