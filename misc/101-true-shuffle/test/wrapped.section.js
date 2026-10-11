// wrapped: the counting behind "Your year" and the home page's lanes (yearStats,
// onThisDay, rediscover, nudges, years, yearText) on an invented history.
// Dates are UTC (the default); one check reads the local clock the same way
// the page does, whatever the machine's time zone.
module.exports = function (h) {
	var path = require('path');
	var W = require(path.join(h.HERE, 'wrapped.js'));
	var DAY = 86400000;

	function ms(s) { return Date.parse(s); }
	function track(id, more) {
		var t = {
			id: id, title: 'Song ' + id, artist: 'Artist ' + id, artistKey: 'artist-' + id, genres: [], playlists: ['PL1'],
			addedAt: { PL1: '2020-01-01T12:00:00Z' }, durationSec: 200, embeddable: true, removed: false, playerError: 0,
			rating: 0, plays: 0, skips: 0, lastPlayed: null, blocked: false
		};
		for (var k in more) t[k] = more[k];
		return t;
	}
	function play(id, when, sec) { return { id: id, at: typeof when === 'number' ? when : ms(when), kind: 'play', listenedSec: sec == null ? 200 : sec }; }
	function skip(id, when, sec) { return { id: id, at: typeof when === 'number' ? when : ms(when), kind: 'skip', listenedSec: sec == null ? 20 : sec }; }
	function newestFirst(list) { return list.slice().sort(function (x, y) { return y.at - x.at; }); }
	function freeze(x) { if (x && typeof x === 'object' && !Object.isFrozen(x)) { Object.freeze(x); Object.keys(x).forEach(function (k) { freeze(x[k]); }); } return x; }
	function idsOf(list) { return list.map(function (x) { return x.id; }); }

	h.describe('wrapped', function () {
		var NOW = ms('2026-10-10T12:00:00Z');

		// ---- yearStats -------------------------------------------------------------------
		var tracks = {
			a: track('a', { artist: 'Paper Lanterns', artistKey: 'paperlanterns', genres: ['Indie rock', 'Alt J-rock'], mood: 'bright', scene: 'anime', work: 'Starfall Odyssey' }),
			b: track('b', { artist: 'Glass Orchard', artistKey: 'glassorchard', genres: ['Indie pop'], mood: 'wistful' }),
			c: track('c', { artist: 'Paper Lanterns', artistKey: 'paperlanterns', genres: ['Indie rock', 'Indie rock'], mood: 'bright' }),
			d: track('d', { artist: '', artistKey: '', artistGuess: 'a channel' }),
			e: track('e', { playlists: ['local:discovered'], addedAt: { 'local:discovered': '2026-03-05T10:00:00Z' } }),
			f: track('f', { addedAt: { PL1: '2026-01-01T00:30:00Z' } }),
			g: track('g', { playlists: ['PL1', 'PL2'], addedAt: { PL1: '2026-02-01T00:00:00Z', PL2: '2025-06-01T00:00:00Z' } }),
			k: track('k', { playlists: ['PL1', 'local:discovered'], addedAt: { 'local:discovered': '2026-05-01T00:00:00Z', PL1: '2024-01-01T00:00:00Z' } }),
			y: track('y', { addedAt: { PL1: '2025-12-31T23:30:00Z' } })
		};
		var hist = newestFirst([
			play('a', '2026-01-01T00:00:00Z'),                                   // the first second of the year (UTC)
			play('a', '2026-01-30T10:00:00Z'),
			play('b', '2026-01-31T23:59:59Z'),                                   // the last second of January
			play('a', '2026-02-01T00:00:00Z'),
			play('b', '2026-02-02T08:00:00Z'),                                   // Jan 30 to Feb 2: four days in a row
			play('a', '2026-03-10T09:00:00Z'), play('a', '2026-03-10T10:00:00Z'), play('a', '2026-03-10T11:00:00Z'), play('a', '2026-03-10T12:00:00Z'), play('a', '2026-03-10T13:00:00Z'),
			play('c', '2026-03-11T21:00:00Z'),
			skip('c', '2026-04-01T21:00:00Z'), skip('c', '2026-04-01T21:01:00Z'), skip('c', '2026-04-01T21:02:00Z'), skip('c', '2026-04-02T21:00:00Z'), skip('c', '2026-04-03T21:00:00Z'), skip('c', '2026-04-04T21:00:00Z'),
			skip('d', '2026-04-02T07:00:00Z'),
			play('zzz', '2026-05-01T12:00:00Z'), skip('zzz', '2026-05-01T12:05:00Z'), play('zzz', '2024-05-01T12:00:00Z'),   // not in the library
			play('b', '2025-12-31T23:59:59Z'),                                   // the last second of 2025
			play('a', '2025-06-15T12:00:00Z'),
			skip('a', '2023-03-03T12:00:00Z'),                                   // a year with a skip only
			play('a', '2026-12-01T12:00:00Z')                                    // after now
		]);
		var st = W.yearStats(hist, tracks, 2026, { now: NOW });
		h.eq([st.year, st.listens, st.plays, st.skips], [2026, 18, 11, 7], 'yearStats: listens, plays and skips of 2026; songs not in the library and a listen after now are left out');
		h.eq([st.seconds, st.minutes], [2340, 39], 'yearStats: minutes are what was heard, skips included (11 x 200 s + 7 x 20 s)');
		h.eq(st.topSongs, [{ id: 'a', plays: 8, minutes: 27 }, { id: 'b', plays: 2, minutes: 7 }, { id: 'c', plays: 1, minutes: 5 }], 'yearStats: top songs by plays; six skips do not lift c above b');
		h.eq([st.songs, st.artists], [3, 2], 'yearStats: songs and artists played (a song with only a skip, and an unknown artist, are not counted)');
		h.eq(st.topArtists, [{ key: 'paperlanterns', name: 'Paper Lanterns', plays: 9, ids: ['a', 'c'] }, { key: 'glassorchard', name: 'Glass Orchard', plays: 2, ids: ['b'] }], 'yearStats: top artists add up their songs\' plays, the songs most played first');
		h.eq(st.topGenres, [{ key: 'Indie rock', plays: 9, ids: ['a', 'c'] }, { key: 'Alt J-rock', plays: 8, ids: ['a'] }, { key: 'Indie pop', plays: 2, ids: ['b'] }], 'yearStats: a play counts once for each genre of its song (a genre listed twice, once)');
		h.eq([st.topMoods, st.topScenes, st.topWorks], [[{ key: 'bright', plays: 9, ids: ['a', 'c'] }, { key: 'wistful', plays: 2, ids: ['b'] }], [{ key: 'anime', plays: 8, ids: ['a'] }], [{ key: 'Starfall Odyssey', plays: 8, ids: ['a'] }]], 'yearStats: top moods, scenes and works');
		h.eq([st.days, st.longestStreak, st.streakFrom, st.streakTo], [7, 4, '2026-01-30', '2026-02-02'], 'yearStats: seven days with a play; the longest streak runs across the end of January');
		h.eq([st.busiestDay, st.busiestMonth], [{ date: '2026-03-10', plays: 5 }, { month: '2026-03', plays: 6 }], 'yearStats: the busiest day and month');
		h.eq([st.firstSong, st.lastSong], [{ id: 'a', at: ms('2026-01-01T00:00:00Z') }, { id: 'c', at: ms('2026-03-11T21:00:00Z') }], 'yearStats: the first and last song of the year (UTC boundaries)');
		h.eq(st.months.slice(0, 4), [3, 2, 6, 0], 'yearStats: plays per month (23:59:59 on January 31 is January, midnight on February 1 is February)');
		var hours = [];
		for (var hr = 0; hr < 24; hr++) hours.push(0);
		[0, 0, 8, 9, 10, 10, 11, 12, 13, 21, 23].forEach(function (x) { hours[x]++; });
		h.eq(st.hours, hours, 'yearStats: plays per hour of the day (UTC)');
		h.eq(st.weekdays, [1, 1, 5, 1, 1, 1, 1], 'yearStats: plays per day of the week, Sunday first (2026-03-10 is a Tuesday)');
		var sum = function (a) { return a.reduce(function (x, y) { return x + y; }, 0); };
		h.ok(sum(st.hours) === st.plays && sum(st.weekdays) === st.plays && sum(st.months) === st.plays, 'yearStats: hours, weekdays and months each add up to the plays');
		h.eq([st.onRepeat, st.mostSkipped], [{ id: 'a', date: '2026-03-10', plays: 5 }, { id: 'c', skips: 6, plays: 1 }], 'yearStats: on repeat (five plays in one day) and skipped the most');
		h.eq([st.newSongs, st.discoveries], [['f', 'e'], ['e']], 'yearStats: songs first added in 2026 (the earliest addition counts) and those kept from Discover');

		var last = W.yearStats(hist, tracks, 2025, { now: NOW });
		h.eq([last.plays, last.songs, last.firstSong.id, last.lastSong, last.newSongs, last.discoveries], [2, 2, 'a', { id: 'b', at: ms('2025-12-31T23:59:59Z') }, ['g', 'y'], []], 'yearStats: 2025 has the play a second before midnight UTC and the songs first added that year');
		h.eq(W.years(hist, tracks), [2026, 2025], 'years: the years with a play of a known song, newest first (an unknown song\'s year and a year of skips only are not years)');

		var none = W.yearStats([], tracks, 2026, { now: NOW });
		h.eq([none.plays, none.listens, none.minutes, none.topSongs, none.firstSong, none.busiestDay, none.busiestMonth, none.onRepeat, none.mostSkipped, none.longestStreak, sum(none.hours)], [0, 0, 0, [], null, null, null, null, null, 0, 0], 'yearStats: no history, an empty year');
		h.eq(none.newSongs, ['f', 'e'], 'yearStats: new songs are counted without a history');
		h.eq(W.yearStats(hist, tracks, null, { now: NOW }).year, 2026, 'yearStats: without a year, the year of now');
		var two = W.yearStats(hist, tracks, 2026, { now: NOW, top: 2 });
		h.eq([two.topSongs.length, two.topGenres.length, two.songs], [2, 2, 3], 'yearStats: top cuts the lists, not the counts');
		h.eq(JSON.stringify(W.yearStats(hist, Object.keys(tracks).map(function (id) { return tracks[id]; }), 2026, { now: NOW })), JSON.stringify(st), 'yearStats: tracks as a list give the same answer as a map');
		h.eq(W.yearStats(hist.slice().reverse(), tracks, 2026, { now: NOW }), st, 'yearStats: the order of the history does not matter');
		var noisy = hist.concat([null, { id: 'a', at: 'not a date', kind: 'play' }, { id: 'a', at: ms('2026-05-05T05:00:00Z'), kind: 'pause' }, { id: 'constructor', at: ms('2026-05-05T05:00:00Z'), kind: 'play' }]);
		h.eq(W.yearStats(noisy, tracks, 2026, { now: NOW }), st, 'yearStats: entries that are not listens of known songs are ignored (null, a bad date, another kind, a name from Object.prototype)');

		// The page counts on the reader's clock: the same moments, read with local getters.
		var x1 = ms('2026-06-15T03:30:00Z'), x2 = ms('2026-01-01T03:00:00Z'), d1 = new Date(x1), d2 = new Date(x2);
		var loc = W.yearStats([play('a', x1)], tracks, d1.getFullYear(), { now: NOW, local: true });
		h.ok(loc.plays === 1 && loc.hours[d1.getHours()] === 1 && loc.weekdays[d1.getDay()] === 1 && loc.busiestDay.date === d1.getFullYear() + '-' + ('0' + (d1.getMonth() + 1)).slice(-2) + '-' + ('0' + d1.getDate()).slice(-2), 'yearStats: local: true reads hours, weekdays and days on the local clock (offset ' + d1.getTimezoneOffset() + ' min)');
		h.eq(W.yearStats([play('a', x2)], tracks, d2.getFullYear(), { now: NOW, local: true }).plays, 1, 'yearStats: local: true puts 03:00 UTC on New Year\'s Day in the local year (' + d2.getFullYear() + ')');

		// ---- yearText ---------------------------------------------------------------------
		var text = W.yearText(st, tracks);
		h.ok(text.indexOf('My 2026 in music') === 0 && text.indexOf('39 minutes, 11 plays of 3 songs by 2 artists.') > 0 && text.indexOf('1. Song a - Paper Lanterns (8 plays)') > 0 && text.indexOf('Top artists: Paper Lanterns, Glass Orchard') > 0 && text.indexOf('Busiest month: March (6 plays)') > 0, 'yearText: the year in a few plain lines');
		h.eq(W.yearText(none, tracks), 'My 2026 in music\nNothing counted yet.', 'yearText: an empty year says so');

		// ---- onThisDay --------------------------------------------------------------------
		var t2 = {
			leap: track('leap', { addedAt: { PL1: '2024-02-29T10:00:00Z' } }),
			feb28: track('feb28', { addedAt: { PL1: '2025-02-28T23:00:00Z' } }),
			mar1: track('mar1', { addedAt: { PL1: '2025-03-01T00:00:00Z' } }),
			now26: track('now26', { addedAt: { PL1: '2026-02-28T01:00:00Z' } }),
			early: track('early', { playlists: ['PL1', 'PL2'], addedAt: { PL1: '2026-02-28T05:00:00Z', PL2: '2023-02-28T05:00:00Z' } }),
			feb27: track('feb27', { addedAt: { PL1: '2023-02-27T23:59:59Z' } }),
			midnight: track('midnight', { addedAt: { PL1: '2022-02-28T00:00:00Z' } }),
			none: track('none', { addedAt: {} }),
			p1: track('p1'), p2: track('p2'), p3: track('p3')
		};
		var h2 = [
			play('p1', '2025-02-28T12:00:00Z'), play('p1', '2025-02-28T13:00:00Z'), play('p1', '2025-02-28T14:00:00Z'),
			play('p2', '2024-02-29T12:00:00Z'), play('p2', '2023-02-28T12:00:00Z'),
			skip('p3', '2025-02-28T12:00:00Z'),
			play('p3', '2026-02-28T09:00:00Z'),
			play('zzz', '2025-02-28T12:00:00Z')
		];
		var od = W.onThisDay(h2, t2, ms('2026-02-28T12:00:00Z'));
		h.eq(od.added, [{ id: 'midnight', year: 2022, ago: 4 }, { id: 'early', year: 2023, ago: 3 }, { id: 'leap', year: 2024, ago: 2 }, { id: 'feb28', year: 2025, ago: 1 }], 'onThisDay: on February 28 of 2026 (no 29th), songs first added on February 28 and 29 of earlier years, oldest first; not this year\'s, not March 1 or 23:59:59 on the 27th');
		h.eq(od.played, [{ id: 'p1', plays: 3, year: 2025, ago: 1 }, { id: 'p2', plays: 2, year: 2024, ago: 2 }], 'onThisDay: songs played on this day in earlier years, most played first (skips, this year and unknown songs left out)');
		var leapDay = W.onThisDay(h2, t2, ms('2028-02-29T12:00:00Z'));
		h.eq([leapDay.added, leapDay.played], [[{ id: 'leap', year: 2024, ago: 4 }], [{ id: 'p2', plays: 1, year: 2024, ago: 4 }]], 'onThisDay: on February 29, 2028, only the 29ths');
		var leapYear28 = W.onThisDay(h2, t2, ms('2028-02-28T12:00:00Z'));
		h.eq(idsOf(leapYear28.added), ['midnight', 'early', 'feb28', 'now26'], 'onThisDay: on February 28 of a leap year the 29ths wait for their own day');
		h.eq(leapYear28.played, [{ id: 'p1', plays: 3, year: 2025, ago: 3 }, { id: 'p3', plays: 1, year: 2026, ago: 2 }, { id: 'p2', plays: 1, year: 2023, ago: 5 }], 'onThisDay: equal plays, the most recent year first');
		h.eq(W.onThisDay(h2, t2, ms('2026-03-01T12:00:00Z')).added, [{ id: 'mar1', year: 2025, ago: 1 }], 'onThisDay: March 1 is not February 29');
		h.eq(W.onThisDay([], {}, NOW), { added: [], played: [] }, 'onThisDay: nothing to show');

		// ---- rediscover -------------------------------------------------------------------
		var t3 = {
			r5old: track('r5old', { rating: 5, plays: 10, lastPlayed: '2025-01-01T12:00:00.000Z' }),
			r4old: track('r4old', { rating: 4, plays: 10, lastPlayed: '2026-04-10T00:00:00.000Z' }),
			r4recent: track('r4recent', { rating: 4, plays: 10, lastPlayed: '2026-04-20T00:00:00.000Z' }),
			r3many: track('r3many', { rating: 3, plays: 4, lastPlayed: '2025-01-01T00:00:00.000Z' }),
			r0five: track('r0five', { rating: 0, plays: 5, lastPlayed: '2025-03-01T00:00:00.000Z' }),
			r0hist: track('r0hist', { rating: 0, plays: 0 }),
			r5hist: track('r5hist', { rating: 5, plays: 3, lastPlayed: '2025-01-01T00:00:00.000Z' }),
			r5never: track('r5never', { rating: 5 }),
			r5fresh: track('r5fresh', { rating: 5, addedAt: { PL1: '2026-09-01T00:00:00Z' } }),
			r5blocked: track('r5blocked', { rating: 5, plays: 10, lastPlayed: '2024-01-01T00:00:00.000Z', blocked: true }),
			r5gone: track('r5gone', { rating: 5, plays: 10, lastPlayed: '2024-01-01T00:00:00.000Z', removed: true }),
			r5clip: track('r5clip', { rating: 5, plays: 10, lastPlayed: '2024-01-01T00:00:00.000Z', kind: 'clip' }),
			r4edge: track('r4edge', { rating: 4, plays: 1, lastPlayed: new Date(NOW - 180 * DAY).toISOString() }),
			r4past: track('r4past', { rating: 4, plays: 1, lastPlayed: new Date(NOW - 180 * DAY - 1000).toISOString() })
		};
		var h3 = [
			play('r0hist', '2025-01-05T12:00:00Z'), play('r0hist', '2025-01-06T12:00:00Z'), play('r0hist', '2025-01-07T12:00:00Z'), play('r0hist', '2025-01-08T12:00:00Z'), play('r0hist', '2025-01-09T12:00:00Z'),
			play('r5hist', '2026-09-01T12:00:00Z'),
			skip('r5old', '2026-10-01T12:00:00Z')
		];
		var rd = W.rediscover(h3, t3, NOW);
		h.eq(idsOf(rd), ['r5old', 'r4old', 'r5never', 'r4past', 'r0hist', 'r0five'], 'rediscover: loved songs (four stars, or five plays by the track or the history) unplayed for 180 days, best first; equals, the longest unheard first');
		h.ok(rd[0].score > rd[1].score && rd[1].score > rd[2].score && rd[4].score === rd[5].score, 'rediscover: scores fall (five stars and many plays first)');
		h.eq([rd[1].last, rd[2].last, rd[4].last], [ms('2026-04-10T00:00:00.000Z'), 0, ms('2025-01-09T12:00:00Z')], 'rediscover: last is the last play (lastPlayed or the history), 0 for never');
		h.ok(idsOf(rd).indexOf('r4edge') < 0 && idsOf(rd).indexOf('r4past') >= 0, 'rediscover: played exactly 180 days ago is too recent; a second more is not');
		h.ok(['r4recent', 'r3many', 'r5hist', 'r5fresh', 'r5blocked', 'r5gone', 'r5clip'].every(function (id) { return idsOf(rd).indexOf(id) < 0; }), 'rediscover: not a recent play (lastPlayed or the history), three stars and four plays, a song added in the last 180 days, blocked, removed or a clip');
		h.eq(idsOf(W.rediscover(h3, t3, NOW, { n: 2 })), ['r5old', 'r4old'], 'rediscover: n caps the list');

		// ---- nudges -----------------------------------------------------------------------
		var t4 = {}, h4 = [];
		['n6', 'n5', 'n7half', 'n6liked', 'n6r3', 'n6old', 'n8', 'n6blocked', 'n6nodur', 'n6skips', 'n6almost', 'n6short', 'n6nosec'].forEach(function (id) { t4[id] = track(id); });
		t4.n6liked.rating = 4; t4.n6r3.rating = 3; t4.n6blocked.blocked = true; t4.n6nodur.durationSec = 0;
		function plays(id, k, fromDay, sec) { for (var i = 0; i < k; i++) h4.push(play(id, NOW - (fromDay + i) * DAY, sec)); }
		plays('n6', 6, 1);
		plays('n5', 5, 1);
		plays('n7half', 5, 1); plays('n7half', 2, 10, 100);
		plays('n6liked', 6, 1);
		plays('n6r3', 6, 2);
		plays('n6old', 5, 1); h4.push(play('n6old', NOW - 61 * DAY));
		plays('n8', 8, 3);
		plays('n6blocked', 6, 1);
		plays('n6nodur', 6, 4, 30);
		for (var s = 0; s < 6; s++) h4.push(skip('n6skips', NOW - (s + 1) * DAY, 199));
		plays('n6almost', 6, 5, 181);
		plays('n6short', 6, 1, 179);
		for (var q = 0; q < 6; q++) h4.push({ id: 'n6nosec', at: NOW - (6 + q) * DAY, kind: 'play' });
		plays('zzz', 6, 1);
		h.eq(W.nudges(t4, newestFirst(h4), NOW), ['n8', 'n6', 'n6r3', 'n6nodur', 'n6almost', 'n6nosec'], 'nudges: six full plays in 60 days and not liked, most played first, then the latest');
		h.ok(['n5', 'n7half', 'n6liked', 'n6old', 'n6blocked', 'n6skips', 'n6short', 'zzz'].every(function (id) { return W.nudges(t4, h4, NOW).indexOf(id) < 0; }), 'nudges: not five plays, half plays (under 90% heard), liked (four stars), a play 61 days ago, blocked, skips, or a song not in the library');
		h.eq(W.nudges(t4, [], NOW), [], 'nudges: no history, no nudge');

		// ---- purity -----------------------------------------------------------------------
		freeze(hist); freeze(tracks); freeze(h2); freeze(t2); freeze(h3); freeze(t3); freeze(h4); freeze(t4);
		var again = [W.yearStats(hist, tracks, 2026, { now: NOW }), W.onThisDay(h2, t2, ms('2026-02-28T12:00:00Z')), W.rediscover(h3, t3, NOW), W.nudges(t4, h4, NOW), W.years(hist, tracks)];
		var twice = [W.yearStats(hist, tracks, 2026, { now: NOW }), W.onThisDay(h2, t2, ms('2026-02-28T12:00:00Z')), W.rediscover(h3, t3, NOW), W.nudges(t4, h4, NOW), W.years(hist, tracks)];
		h.eq(again, twice, 'pure: frozen inputs, the same answers twice');
		h.eq(again[0], st, 'pure: the answers did not change the inputs');

		// ---- size -------------------------------------------------------------------------
		var big = {}, bh = [];
		for (var i = 0; i < 2000; i++) big['t' + i] = track('t' + i, { artistKey: 'k' + (i % 300), artist: 'K' + (i % 300), genres: ['G' + (i % 40)], addedAt: { PL1: new Date(Date.UTC(2019 + (i % 8), i % 12, 1 + (i % 28))).toISOString() } });
		for (var j = 0; j < 5000; j++) bh.push(play('t' + ((j * 7919) % 2000), NOW - j * 3600000 * 2.5, 150 + (j % 60)));
		var t0 = Date.now();
		var bs = W.yearStats(bh, big, 2026, { now: NOW, local: true });
		W.onThisDay(bh, big, NOW, { local: true });
		W.rediscover(bh, big, NOW);
		W.nudges(big, bh, NOW);
		W.years(bh, big, { local: true });
		var took = Date.now() - t0;
		h.ok(bs.plays === 5000 - bh.filter(function (e) { return new Date(e.at).getFullYear() !== 2026; }).length && took < 1500, 'size: 5,000 listens over 2,000 songs, every function once, in ' + took + ' ms');
	});
};
