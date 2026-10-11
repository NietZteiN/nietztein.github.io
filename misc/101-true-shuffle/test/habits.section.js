// habits: the listening clock, the streaks, minutes per week, Usually at this hour and
// the Skip-the-intro seek detector and offer, on invented histories. Times are UTC or a
// given offset (a number, or a function for a day the clocks change); one check reads
// the local clock the same way the page does, whatever the machine's time zone.
module.exports = function (h) {
	var path = require('path');
	var H = require(path.join(h.HERE, 'habits.js'));
	var MIN = 60000, HOUR = 3600000, DAY = 86400000;

	function ms(s) { return Date.parse(s); }
	function play(id, end, sec) { return { id: id, at: typeof end === 'number' ? end : ms(end), kind: 'play', listenedSec: sec == null ? 600 : sec }; }
	function skip(id, end, sec) { return { id: id, at: typeof end === 'number' ? end : ms(end), kind: 'skip', listenedSec: sec == null ? 30 : sec }; }
	function track(id, more) {
		var t = { id: id, title: 'Song ' + id, artist: 'Artist ' + id, embeddable: true, removed: false, playerError: 0, blocked: false };
		for (var k in more) t[k] = more[k];
		return t;
	}
	function freeze(x) { if (x && typeof x === 'object' && !Object.isFrozen(x)) { Object.freeze(x); Object.keys(x).forEach(function (k) { freeze(x[k]); }); } return x; }
	function idsOf(list) { return list.map(function (x) { return x.id; }); }
	// The US Central zone around its two changes in 2026: CDT (-300) from March 8, 08:00 UTC
	// to November 1, 07:00 UTC, CST (-360) on either side.
	var SPRING = ms('2026-03-08T08:00:00Z'), FALL = ms('2026-11-01T07:00:00Z');
	function central(t) { return t >= SPRING && t < FALL ? -300 : -360; }

	h.describe('habits', function () {
		// ---- clock ---------------------------------------------------------------------------
		var tracks = { a: track('a'), b: track('b'), c: track('c') };
		var NOW = ms('2026-10-10T12:00:00Z');                                    // a Saturday
		var hist = freeze([
			play('a', '2026-10-09T21:30:00Z'),                                   // Friday 21:20 to 21:30: 10 min
			play('b', '2026-10-09T22:10:00Z', 1200),                              // Friday 21:50 to 22:10: 10 + 10
			skip('c', '2026-10-09T21:45:00Z', 120),                               // a skip's two minutes count
			play('a', '2026-10-05T00:05:00Z'),                                   // Sunday 23:55 to Monday 00:05
			play('zzz', '2026-10-09T21:40:00Z'),                                 // not in the library
			play('a', '2026-10-11T21:30:00Z'),                                   // after now
			play('a', '2025-10-01T21:30:00Z'),                                   // more than a year ago
			{ id: 'a', at: 'not a time', kind: 'play', listenedSec: 60 },
			{ id: 'a', at: ms('2026-10-09T10:00:00Z'), kind: 'other', listenedSec: 60 },
			null
		]);
		var c = H.clock(hist, tracks, NOW);
		h.eq([c.cells[4][21], c.cells[4][22], c.cells[6][23], c.cells[0][0]], [22, 10, 5, 5], 'clock: minutes land in their weekday (Monday first) and hour, cut at the hour and at midnight between Sunday and Monday; a skip counts');
		h.eq([c.listens, c.minutes, c.max, c.peak], [4, 42, 22, { day: 4, hour: 21, minutes: 22 }], 'clock: unknown songs, listens after now or over a year old, bad times and other kinds are left out; the peak is the busiest hour');
		h.eq(c.from, ms('2026-10-05T00:05:00Z'), 'clock: from is the first listen counted');
		h.eq(H.clock(hist, null, NOW).listens, 5, 'clock: with no tracks every listen counts');
		h.eq(H.clock(hist, tracks, NOW, { days: 3 }).listens, 3, 'clock: days narrows the span');
		var tie = H.clock([play('a', '2026-10-06T10:10:00Z'), play('a', '2026-10-05T12:10:00Z')], tracks, NOW);
		h.eq([tie.peak.day, tie.peak.hour], [0, 12], 'clock: the first of equals is the peak (Monday before Tuesday)');
		var empty = H.clock([], tracks, NOW);
		h.eq([empty.listens, empty.minutes, empty.peak, empty.cells.length, empty.cells[0].length], [0, 0, null, 7, 24], 'clock: nothing gives seven empty rows of 24 and no peak');
		var tiny = H.clock([play('a', '2026-10-09T21:30:20Z', 20)], tracks, NOW);
		h.eq(tiny.cells[4][21], 0.3, 'clock: minutes are kept to a tenth, so a short listen still shows');
		var huge = H.clock([play('a', '2026-10-09T21:30:00Z', 1e9)], tracks, NOW);
		h.eq(huge.minutes, 720, 'clock: a broken listenedSec is cut to twelve hours');

		var west = H.clock([play('a', '2026-10-10T02:30:00Z')], tracks, NOW, { offset: -300 });
		h.eq(west.peak, { day: 4, hour: 21, minutes: 10 }, 'clock: a fixed offset moves a Saturday 02:20 UTC listen to Friday 21:20');
		var fall = H.clock([play('a', '2026-11-01T07:30:00Z', 3600)], tracks, ms('2026-11-02T12:00:00Z'), { offset: central });
		h.eq([fall.cells[6][1], fall.cells[6][0], fall.cells[6][2]], [60, 0, 0], 'clock: the night the clocks go back, 1 am comes twice (CDT, then CST) and both halves are 1 am');
		var spring = H.clock([play('a', '2026-03-08T08:30:00Z', 3600)], tracks, ms('2026-03-09T12:00:00Z'), { offset: central });
		h.eq([spring.cells[6][1], spring.cells[6][2], spring.cells[6][3]], [30, 0, 30], 'clock: the night the clocks go forward, 2 am never happens: 1:30 to 3:30 local is half an hour in each');
		var at = ms('2026-06-10T15:20:10Z'), d = new Date(at - 10000);
		var loc = H.clock([play('a', at, 10)], tracks, at + DAY, { local: true });
		h.ok(loc.cells[(d.getDay() + 6) % 7][d.getHours()] > 0, 'clock: local reads the machine\'s own clock, like Date (' + d.getDay() + ', ' + d.getHours() + ')');

		// ---- clockText -----------------------------------------------------------------------
		function said(day, hour, listens) { return H.clockText({ peak: { day: day, hour: hour, minutes: 30 }, listens: listens == null ? 10 : listens }); }
		h.eq(said(4, 21), 'You listen most on Friday evenings, 9 to 10 pm.', 'clockText: the sentence of the brief');
		h.eq([said(5, 1), said(0, 0), said(2, 23)], ['You listen most on Friday nights, 1 to 2 am.', 'You listen most on Sunday nights, midnight to 1 am.', 'You listen most on Wednesday nights, 11 pm to midnight.'], 'clockText: the small hours belong to the night before (1 am Saturday is Friday night)');
		h.eq([said(1, 5), said(1, 11), said(1, 12), said(1, 16), said(1, 17), said(1, 22)], [
			'You listen most on Tuesday mornings, 5 to 6 am.', 'You listen most on Tuesday mornings, 11 am to noon.', 'You listen most on Tuesday afternoons, noon to 1 pm.',
			'You listen most on Tuesday afternoons, 4 to 5 pm.', 'You listen most on Tuesday evenings, 5 to 6 pm.', 'You listen most on Tuesday evenings, 10 to 11 pm.'
		], 'clockText: mornings from 5, afternoons from noon, evenings from 5 pm, nights from 11 pm; noon and midnight by name');
		h.eq([said(4, 21, 9), H.clockText(empty), H.clockText(null)], ['', '', ''], 'clockText: nothing under ten listens, without a peak, or without a clock');

		// ---- streaks -------------------------------------------------------------------------
		var sh = freeze([
			play('a', '2026-10-05T12:00:00Z'), play('b', '2026-10-06T12:00:00Z'), play('a', '2026-10-07T12:00:00Z'), play('a', '2026-10-07T13:00:00Z'),
			play('a', '2026-10-09T12:00:00Z'), play('a', '2026-10-10T09:00:00Z'),
			play('a', '2026-09-20T12:00:00Z'), play('a', '2026-09-21T12:00:00Z'), play('a', '2026-09-22T12:00:00Z'),   // as long, but later counts as a tie
			skip('a', '2026-10-08T12:00:00Z'), play('zzz', '2026-10-08T12:00:00Z'), play('a', '2026-10-12T12:00:00Z')
		]);
		var st = H.streaks(sh, tracks, NOW);
		h.eq(st, { current: 2, currentFrom: '2026-10-09', today: true, longest: 3, longestFrom: '2026-09-20', longestTo: '2026-09-22', days: 8 }, 'streaks: today included; a skip, an unknown song and a play after now make no day; the first of the longest');
		h.eq(H.streaks(sh, tracks, ms('2026-10-11T12:00:00Z')).current, 2, 'streaks: with no play yet today, the streak up to yesterday still counts');
		h.eq(H.streaks(sh, tracks, ms('2026-10-11T12:00:00Z')).today, false, 'streaks: today says whether today has a play');
		h.eq(H.streaks(sh.slice(0, 6), tracks, ms('2026-10-12T12:00:00Z')).current, 0, 'streaks: a day without a play ends it');
		h.eq(H.streaks([], tracks, NOW), { current: 0, currentFrom: '', today: false, longest: 0, longestFrom: '', longestTo: '', days: 0 }, 'streaks: nothing');
		h.eq(H.streaks([play('a', '2026-10-10T03:00:00Z')], tracks, NOW, { offset: -300 }).currentFrom, '2026-10-09', 'streaks: an offset makes 03:00 UTC the evening before');
		var dst = ['2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03'].map(function (dk) { return play('a', dk + 'T05:30:00Z'); });
		h.eq(H.streaks(dst, tracks, ms('2026-11-03T12:00:00Z'), { offset: central }), { current: 3, currentFrom: '2026-10-31', today: false, longest: 3, longestFrom: '2026-10-31', longestTo: '2026-11-02', days: 3 }, 'streaks: 05:30 UTC is 00:30 in CDT and 23:30 in CST, so around the night the clocks go back four plays fall on three days');

		// ---- weeks ---------------------------------------------------------------------------
		var WED = ms('2026-10-07T12:00:00Z');
		var wk = H.weeks(freeze([
			play('a', '2026-10-05T00:05:00Z'),                                   // 5 min in the week of Sep 28, 5 in this one
			play('b', '2026-10-06T10:00:00Z', 1800), skip('c', '2026-10-07T11:00:00Z', 60),
			play('a', '2026-07-21T10:00:00Z'), play('a', '2026-07-19T10:00:00Z'),   // in the first week; before it
			play('a', '2026-10-08T10:00:00Z')                                     // after now
		]), tracks, WED);
		h.eq([wk.length, wk[0].from, wk[11].from, wk[11].current, wk[10].current], [12, '2026-07-20', '2026-10-05', true, false], 'weeks: twelve weeks, Monday first, the current one last');
		h.eq(wk.map(function (w) { return w.minutes; }), [10, 0, 0, 0, 0, 0, 0, 0, 0, 0, 5, 36], 'weeks: minutes per week, a listen over Sunday midnight split, skips counted, earlier weeks and later listens left out');
		h.eq(H.weeks([], tracks, WED, { n: 3 }).map(function (w) { return w.from; }), ['2026-09-21', '2026-09-28', '2026-10-05'], 'weeks: n sets how many');
		var wkz = H.weeks([play('a', '2026-10-05T03:00:00Z')], tracks, WED, { offset: -300, n: 2 });
		h.eq(wkz.map(function (w) { return w.minutes; }), [10, 0], 'weeks: an offset puts Monday 03:00 UTC on Sunday evening, the week before');
		var wkd = H.weeks([play('a', '2026-11-02T06:10:00Z', 1200)], tracks, ms('2026-11-04T12:00:00Z'), { offset: central, n: 2 });
		h.eq(wkd.map(function (w) { return w.from + ' ' + w.minutes; }), ['2026-10-26 10', '2026-11-02 10'], 'weeks: after the clocks went back, local midnight (06:00 UTC now) still divides the weeks');

		// ---- thisHour ------------------------------------------------------------------------
		var lib = {
			a: track('a'), b: track('b'), c: track('c'), d: track('d'), e: track('e'), f: track('f'),
			g: track('g', { blocked: true }), hh: track('hh'), i: track('i'), clip: track('clip', { kind: 'clip' })
		};
		var EVE = ms('2026-10-07T21:00:00Z');                                    // a Wednesday, 9 pm
		var here = freeze([
			play('a', '2026-10-06T20:40:00Z'), play('a', '2026-10-05T20:40:00Z'), play('a', '2026-09-30T20:40:00Z'),   // began 20:30
			play('b', '2026-10-06T22:00:00Z'), play('b', '2026-09-01T22:00:00Z'),     // began 21:50
			play('hh', '2026-10-02T20:15:00Z'), play('hh', '2026-10-01T20:15:00Z'),   // began 20:05: 55 minutes before
			play('c', '2026-10-06T22:40:00Z'), play('c', '2026-10-05T22:40:00Z'),     // began 22:30: too late
			play('d', '2026-10-03T21:10:00Z'), play('d', '2026-10-04T21:10:00Z'),     // a Saturday and a Sunday
			play('e', '2026-10-06T21:10:00Z'),                                       // once only
			play('f', '2026-05-01T21:10:00Z'), play('f', '2026-05-04T21:10:00Z'),     // over 120 days ago
			play('g', '2026-10-06T21:10:00Z'), play('g', '2026-10-05T21:10:00Z'),     // blocked
			play('clip', '2026-10-06T21:10:00Z'), play('clip', '2026-10-05T21:10:00Z'),
			skip('i', '2026-10-06T21:10:00Z'), skip('i', '2026-10-05T21:10:00Z'),     // skips
			play('i', '2026-10-06T21:40:00Z', 3000)                                   // began 20:50, ended 21:40
		]);
		var th = H.thisHour(here, lib, EVE);
		h.eq(th, [{ id: 'a', plays: 3, last: ms('2026-10-06T20:40:00Z') }, { id: 'b', plays: 2, last: ms('2026-10-06T22:00:00Z') }, { id: 'hh', plays: 2, last: ms('2026-10-02T20:15:00Z') }], 'thisHour: an hour either side, weekdays, the last 120 days, two plays each; skips, blocked songs and clips left out; most played, then the latest');
		h.eq(H.thisHour(here, lib, EVE, { least: 4 }), [], 'thisHour: fewer songs than least is too little to show');
		h.eq(idsOf(H.thisHour(here, lib, EVE, { min: 1 })), ['a', 'b', 'hh', 'i', 'e'], 'thisHour: min sets the plays a song needs; a play counts where it began (i: 50 minutes heard, ended 21:40, began 20:50)');
		h.eq(idsOf(H.thisHour(here, lib, ms('2026-10-10T21:00:00Z'), { least: 1, min: 1 })), ['d'], 'thisHour: on a Saturday only weekend plays count');
		var late = [play('a', '2026-10-07T00:30:00Z'), play('a', '2026-10-06T00:30:00Z'), play('b', '2026-10-06T00:30:00Z'), play('b', '2026-10-05T00:30:00Z'), play('hh', '2026-10-06T23:10:00Z'), play('hh', '2026-10-05T23:10:00Z')];
		h.eq(idsOf(H.thisHour(late, lib, ms('2026-10-07T23:30:00Z'))), ['a', 'hh', 'b'], 'thisHour: the hour either side wraps around midnight (00:20 is 50 minutes after 23:30)');
		var many = [];
		for (var k = 0; k < 15; k++) { lib['m' + k] = track('m' + k); many.push(play('m' + k, EVE - DAY - k * MIN), play('m' + k, EVE - 2 * DAY - k * MIN)); }
		h.eq(H.thisHour(many, lib, EVE).length, 12, 'thisHour: twelve at most');
		var tz = [play('a', '2026-10-07T01:40:00Z'), play('a', '2026-10-06T01:40:00Z'), play('b', '2026-10-07T01:40:00Z'), play('b', '2026-10-06T01:40:00Z'), play('hh', '2026-10-06T01:40:00Z'), play('hh', '2026-10-02T01:40:00Z')];
		h.eq(idsOf(H.thisHour(tz, lib, ms('2026-10-08T02:00:00Z'), { offset: -300 })), ['a', 'b', 'hh'], 'thisHour: with an offset, 01:30 UTC is 8:30 pm on a weekday evening');
		h.eq(H.thisHour(null, lib, EVE), [], 'thisHour: no history');

		h.eq([H.momentText(EVE), H.momentText(ms('2026-10-10T09:00:00Z')), H.momentText(ms('2026-10-11T02:00:00Z')), H.momentText(ms('2026-10-12T13:00:00Z'))],
			['weekday evenings', 'weekend mornings', 'weekend nights', 'weekday afternoons'], 'momentText: the kind of day and the part of it');
		h.eq(H.momentText(ms('2026-10-10T04:30:00Z'), { offset: -300 }), 'weekday nights', 'momentText: an offset (04:30 UTC on a Saturday is 11:30 pm on Friday)');

		// ---- seekDetector --------------------------------------------------------------------
		// Plays a song: events every 500 ms from wall time t, the position advancing with it.
		function run(det, list) { var out = []; list.forEach(function (e) { var r = det.feed(e); if (r) out.push(r); }); return out; }
		function playing(id, from, pos, n, t0, rate) {
			var out = [];
			for (var i = 0; i < n; i++) out.push({ id: id, current: pos + i * 0.5 * (rate || 1), at: t0 + i * 500, rate: rate || 1, playingFrom: 1 });
			return out;
		}
		var T = 1000000;
		var det = H.seekDetector();
		var seq = playing('x', 0, 0.5, 6, T).concat(playing('x', 0, 42, 6, T + 3000));
		var got = run(det, seq);
		h.eq(got, [{ id: 'x', from: 3, to: 42, at: T + 3000 }], 'seekDetector: a jump from 0:03 to 0:42 is a seek, told once playback has gone on 1.5 s, and only once');
		h.eq(run(H.seekDetector(), playing('x', 0, 0.5, 60, T)), [], 'seekDetector: playing along is no seek');
		h.eq(run(H.seekDetector(), playing('x', 0, 1, 60, T, 2)), [], 'seekDetector: at twice the speed the clock explains the steps');
		h.eq(run(H.seekDetector(), [{ id: 'x', current: 8, at: T, playingFrom: 1 }, { id: 'x', current: 12, at: T + 500, rate: 8, playingFrom: 1 }].concat(playing('x', 0, 12.5, 6, T + 1000, 8))), [], 'seekDetector: the rate is read from each event');
		var chain = [{ id: 'x', current: 3, at: T, playingFrom: 1 }];
		[8, 13, 18, 23, 28, 33, 38, 43].forEach(function (p, i) { chain.push({ id: 'x', current: p, at: T + 300 * (i + 1), playingFrom: 1 }); });
		h.eq(run(H.seekDetector(), chain.concat(playing('x', 0, 43.3, 6, T + 3000))).map(function (s) { return [s.from, s.to]; }), [[8, 43]], 'seekDetector: arrow-key seeks in a row are one seek, landing where they end (the first that reached 0:10 started it)');
		h.eq(run(H.seekDetector(), playing('x', 0, 20, 2, T).concat(playing('x', 0, 60, 6, T + 1000))), [], 'seekDetector: a seek from 0:20 is not past the intro');
		h.eq(run(H.seekDetector(), playing('x', 0, 2, 2, T).concat(playing('x', 0, 130, 6, T + 1000))), [], 'seekDetector: landing after 2:00 is not an intro');
		h.eq(run(H.seekDetector(), playing('x', 0, 2, 2, T).concat(playing('x', 0, 8, 6, T + 1000))), [], 'seekDetector: landing before 0:10 is not an intro');
		var fine = playing('x', 0, 2, 2, T).concat([{ id: 'x', current: 50, at: T + 1000, playingFrom: 1 }, { id: 'x', current: 44, at: T + 2000, playingFrom: 1 }]).concat(playing('x', 0, 44.5, 6, T + 2500));
		h.eq(run(H.seekDetector(), fine).map(function (s) { return s.to; }), [44], 'seekDetector: a step back within the chain moves where it lands');
		var away = playing('x', 0, 2, 2, T).concat([{ id: 'x', current: 50, at: T + 1000, playingFrom: 1 }]).concat(playing('y', 0, 0.5, 8, T + 1500));
		h.eq(run(H.seekDetector(), away), [], 'seekDetector: another song before it settles forgets it');
		var paused = [{ id: 'x', current: 3, at: T, playingFrom: 1 }, { id: 'x', current: 3, at: T + 500, playingFrom: 0 }, { id: 'x', current: 42, at: T + 60000, playingFrom: 0 }].concat(playing('x', 0, 42.5, 6, T + 61000).map(function (e) { e.playingFrom = T + 60500; return e; }));
		h.eq(run(H.seekDetector(), paused).map(function (s) { return s.to; }), [42], 'seekDetector: a seek while paused (a minute after the last event) is still a seek');
		var resumed = [{ id: 'x', current: 3, at: T, playingFrom: 1 }].concat(playing('x', 0, 42.5, 6, T + 60500).map(function (e) { e.playingFrom = T + 60000; return e; }));
		h.eq(run(H.seekDetector(), resumed).map(function (s) { return s.to; }), [42.5], 'seekDetector: seen only once playing again (YouTube reads no time while paused), it is still a seek');
		var slow = [];
		for (var j = 0; j < 6; j++) slow.push({ id: 'x', current: 1 + j * 60, at: T + j * 60000, playingFrom: 1 });
		h.eq(run(H.seekDetector(), slow), [], 'seekDetector: a hidden tab that hears the time once a minute is no seek');
		var rs = H.seekDetector();
		run(rs, playing('x', 0, 2, 2, T).concat([{ id: 'x', current: 50, at: T + 1000, playingFrom: 1 }]));
		rs.reset();
		h.eq(run(rs, playing('x', 0, 50.5, 6, T + 1500)), [], 'seekDetector: reset forgets a seek not yet told (the song ended)');
		var odd = H.seekDetector(), threw = false;
		try { [null, {}, { id: null, current: 3, at: T }, { id: 'x', current: 'a', at: T }, { id: 'x', current: 3 }].forEach(function (e) { if (odd.feed(e) !== null) threw = true; }); } catch (e) { threw = true; }
		h.ok(!threw, 'seekDetector: odd events give null and never throw');

		// ---- addSeek -------------------------------------------------------------------------
		var base = freeze([{ id: 'x', to: 42, at: NOW - 400 * DAY }, { id: 'y', to: 30, at: NOW - 2 * DAY }, { id: 'x', to: 'n', at: NOW }]);
		var added = H.addSeek(base, { id: 'x', to: 43.2, at: NOW - DAY, from: 2 }, NOW);
		h.eq(added, [{ id: 'y', to: 30, at: NOW - 2 * DAY }, { id: 'x', to: 43.2, at: NOW - DAY }], 'addSeek: appended in time order as { id, to, at }; a year old and broken ones dropped; the list given is not changed');
		var big = [];
		for (var b = 0; b < 320; b++) big.push({ id: 's' + b, to: 20, at: NOW - (400 - b) * MIN });
		var capped = H.addSeek(big, { id: 'new', to: 20, at: NOW }, NOW);
		h.eq([capped.length, capped[0].id, capped[capped.length - 1].id], [300, 's21', 'new'], 'addSeek: the newest 300 are kept');
		h.eq(H.addSeek(null, null, NOW), [], 'addSeek: nothing to keep');

		// ---- introOffer ----------------------------------------------------------------------
		var E1 = NOW - 3 * DAY, E2 = NOW - 2 * DAY, E3 = NOW - DAY;
		var plays3 = [play('x', E1), play('x', E2), skip('x', E3), play('y', E3 + HOUR)];
		function seek(id, at, to) { return { id: id, at: at, to: to }; }
		h.eq(H.introOffer('x', [seek('x', E1 - 500000, 42.7), seek('x', E2 - 500000, 44.1)], plays3, { now: NOW }), { start: 42, seeks: 2 }, 'introOffer: two of the last three plays seeking within 8 s offer the earlier, in whole seconds');
		h.eq(H.introOffer('x', [seek('x', E1 - 500000, 42), seek('x', E3 - 100000, 50)], plays3, { now: NOW }), { start: 42, seeks: 2 }, 'introOffer: a skip is a play here, and 8 s apart is close enough');
		h.eq(H.introOffer('x', [seek('x', E1 - 500000, 42), seek('x', E3 - 100000, 51)], plays3, { now: NOW }), null, 'introOffer: 9 s apart is not the same habit');
		h.eq(H.introOffer('x', [seek('x', E2 - 500000, 42)], plays3, { now: NOW }), null, 'introOffer: one seek is not a habit');
		h.eq(H.introOffer('x', [seek('x', E1 - 500000, 42), seek('x', E2 - 500000, 43), seek('x', E3 - 500000, 41)], plays3, { now: NOW }), { start: 41, seeks: 3 }, 'introOffer: three of three');
		h.eq(H.introOffer('x', [seek('x', E2 - 500000, 42), seek('x', NOW - 1000, 42)], plays3, { now: NOW }), null, 'introOffer: the play going on now is not one of the three');
		var plays4 = [play('x', E1 - DAY)].concat(plays3);
		h.eq(H.introOffer('x', [seek('x', E1 - DAY - 500000, 42), seek('x', E3 - 100000, 42)], plays4, { now: NOW }), null, 'introOffer: a seek in an older play than the last three is left out');
		h.eq(H.introOffer('x', [seek('x', E1 - 500000, 42), seek('x', E2 - 900000, 42), seek('x', E2 - 300000, 90)], plays3, { now: NOW }), null, 'introOffer: the last seek in a play is the one that counts');
		h.eq(H.introOffer('x', [seek('y', E1 - 500000, 42), seek('y', E2 - 500000, 42)], plays3, { now: NOW }), null, 'introOffer: another song\'s seeks do not count');
		h.eq(H.introOffer('x', [seek('x', E1 - 500000, 42), seek('x', E2 - 500000, 44)], plays3, { now: E2 - 1000 }), null, 'introOffer: listens after now are not read');
		h.eq(H.introOffer('x', [seek('x', E1 - 500000, 42), seek('x', E2 - 500000, 52)], plays3, { now: NOW, tol: 10 }), { start: 42, seeks: 2 }, 'introOffer: tol sets how close');
		h.eq(H.introOffer('x', null, null, {}), null, 'introOffer: nothing to go on');

		// ---- the watcher outside a browser, and speed ----------------------------------------
		var w = H.watch({ player: function () { return { on: function () { return function () {}; } }; }, demo: false, thumb: false });
		h.ok(w && typeof w.stop === 'function', 'watch: outside a browser it watches nothing and still returns stop');
		var lots = [], ids = Object.keys(lib);
		for (var n = 0; n < 5000; n++) lots.push(play(ids[n % ids.length], NOW - n * 37 * MIN, 120 + (n % 400)));
		var t0 = Date.now();
		H.clock(lots, lib, NOW, { local: true }); H.streaks(lots, lib, NOW, { local: true }); H.weeks(lots, lib, NOW, { local: true }); H.thisHour(lots, lib, NOW, { local: true });
		var took = Date.now() - t0;
		h.ok(took < 400, 'clock, streaks, weeks and thisHour over 5,000 listens take ' + took + ' ms');
	});
};
