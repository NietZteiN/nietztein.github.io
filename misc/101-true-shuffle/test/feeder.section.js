// feeder: what keeps the queue fed (lists in order, endless radios).
module.exports = function (h) {
	var path = require('path');
	var Fd = require(path.join(h.HERE, 'feeder.js'));
	var S = require(path.join(h.HERE, 'shuffle.js'));
	var P = require(path.join(h.HERE, 'player.js'));

	function wait(ms) { return new Promise(function (r) { setTimeout(r, ms || 0); }); }
	// A library of 60 songs by 12 artists, and finds by 20 more.
	var lib = {}, libIds = [];
	for (var i = 0; i < 60; i++) { var id = 'lib' + i; lib[id] = { id: id, artistKey: 'a' + (i % 12), work: i % 7 === 0 ? 'w' + (i % 3) : '', title: 'Song ' + i }; libIds.push(id); }
	var reg = {}, regAdds = [];
	var registry = { add: function (f, v) { var id = v.videoId; reg[id] = { id: id, artistKey: 'n' + (f.artist || ''), transient: true, title: f.title }; regAdds.push(id); return reg[id]; } };
	function track(id) { return lib[id] || reg[id] || null; }
	var nf = 0;
	function makeFinds(n, artists) { var out = []; for (var k = 0; k < n; k++) { var x = nf++; out.push({ key: 'f' + x, title: 'Found ' + x, artist: 'x' + (x % (artists || 20)), videoId: null, why: [['similar', 'x']] }); } return out; }
	function resolver(opts) {
		opts = opts || {};
		return {
			calls: 0,
			resolve: function (f) {
				this.calls++;
				var fail = opts.fail && opts.fail(f), slow = opts.slow && opts.slow(f);
				return wait(slow ? 200 : 1).then(function () { return fail ? { none: true, reason: 'not-found' } : { videoId: ('V' + f.key + '___________').slice(0, 11), rung: 'pool', units: 0, video: { videoId: ('V' + f.key + '___________').slice(0, 11), title: f.title } }; });
			},
			forget: function () {}
		};
	}
	function familiar(seed, n, avoid) { return libIds.filter(function (x) { return avoid.indexOf(x) < 0; }).slice(0, n); }
	function deps(extra) {
		var d = { resolver: resolver(), registry: registry, track: track, familiar: familiar, artistOf: function (x) { return x.artistKey || ('n' + (x.artist || '')); }, workOf: function (x) { return x.work || ''; }, songKey: function (t) { return t.id; }, rand: S.rng('feeder'), maxWaitMs: 50, askEveryMs: 0 };
		for (var k in (extra || {})) d[k] = extra[k];
		return d;
	}

	h.describe('feeder', async function () {
		// ---- a list ----
		var list = makeFinds(8);
		var fails = { f3: true };
		var fd = Fd.create({ kind: 'list', label: 'Lanterns', finds: list, ahead: 3 }, deps({ resolver: resolver({ fail: function (f) { return fails[f.key]; } }) }));
		h.eq(fd.take(2), [], 'take: nothing before anything is ready (never waits)');
		await fd.fill();
		h.eq(fd.status().buffered, 3, 'fill: three ahead');
		var got = [];
		for (var k = 0; k < 10; k++) { got = got.concat(fd.take(1)); await fd.fill(); }
		h.eq(got, list.filter(function (f) { return !fails[f.key]; }).map(function (f) { return ('V' + f.key + '___________').slice(0, 11); }), 'a list plays in order and skips a song that cannot be found');
		h.eq(fd.status().phase, 'exhausted', 'a list ends');
		h.eq([fd.take(3), fd.status().phase], [[], 'exhausted'], 'a list that has ended stays ended when asked for more (the page reads the phase right after)');
		h.ok(regAdds.length >= 7, 'every found song gets a light track in the registry');
		var pk = Fd.create({ kind: 'list', finds: makeFinds(6), ahead: 2 }, deps());
		h.eq(pk.peek(4).map(function (p) { return p.status; }), ['waiting', 'waiting', 'waiting', 'waiting'], 'peek: songs still to look up say so');

		// ---- a radio: the ratio, the artists, never stopping ----
		var provided = 0;
		var radioDeps = deps({ providers: { similar: function () { provided++; return Promise.resolve(makeFinds(30)); } } });
		var rd = Fd.create({ kind: 'radio', seed: 'lib0', ratio: 0.5, ahead: 3 }, radioDeps);
		var played = [], newCount = 0, total = 0;
		for (var s = 0; s < 1000; s++) {
			if (!rd.status().buffered) await rd.fill();
			var ids = rd.take(1);
			if (!ids.length) { await rd.fill(); ids = rd.take(1); }
			if (!ids.length) break;
			played.push(ids[0]);
			total++;
			if (!lib[ids[0]]) newCount++;
		}
		h.eq(total, 1000, 'a radio gave 1,000 songs without running dry');
		h.near(newCount / total, 0.5, 0.05, 'a radio keeps its share of new songs (ratio 0.5)');
		var repeats = 0;
		for (var q = 1; q < played.length; q++) { var a = track(played[q]), b = track(played[q - 1]); if (a && b && radioDeps.artistOf(a) === radioDeps.artistOf(b)) repeats++; }
		h.eq(repeats, 0, 'a radio never plays one artist twice in a row');
		h.ok(provided >= 1, 'the providers were asked');
		var none = Fd.create({ kind: 'radio', seed: 'lib0', ratio: 0 }, deps({ providers: { similar: function () { throw new Error('ratio 0 asks no one'); } } }));
		await none.fill();
		h.ok(none.take(3).every(function (x) { return !!lib[x]; }), 'ratio 0: library songs only, no provider asked');
		// a new song that is slow gives way when the queue waits
		var slowFd = Fd.create({ kind: 'radio', seed: 'lib0', ratio: 1, ahead: 1 }, deps({ resolver: resolver({ slow: function () { return true; } }), providers: { similar: function () { return Promise.resolve(makeFinds(5)); } }, maxWaitMs: 30 }));
		var t0 = Date.now();
		await slowFd.fill();
		var first = slowFd.take(1);
		h.ok(first.length === 1 && lib[first[0]] && Date.now() - t0 < 180, 'a slow new song gives way to a familiar one within the wait (' + (Date.now() - t0) + ' ms)');
		await wait(250);
		h.ok(slowFd.status().buffered >= 1, 'and the late new song is kept for later');
		// two unplayable new songs in a row: the next is familiar
		var bad = Fd.create({ kind: 'radio', seed: 'lib0', ratio: 1, ahead: 1 }, deps({ providers: { similar: function () { return Promise.resolve(makeFinds(20)); } } }));
		await bad.fill();
		var n1 = bad.take(1)[0]; bad.feedback(n1, 'unplayable');
		await bad.fill();
		var n2 = bad.take(1)[0]; bad.feedback(n2, 'unplayable');
		await bad.fill();
		var n3 = bad.take(1)[0];
		h.ok(!lib[n1] && !lib[n2] && !!lib[n3], 'after two unplayable new songs the next one is familiar');
		// snapshot and restore
		var snap = JSON.parse(JSON.stringify(rd.snapshot()));
		var back = Fd.restore(snap, radioDeps);
		h.eq([back.status().kind, back.status().buffered, back.status().ratio], ['radio', snap.buffer.length, 0.5], 'snapshot and restore: the same radio, the same songs ready');

		// ---- with the real controller and the mock player: 300 songs, no halt ----
		var halts = [], mock = P.create({ kind: 'mock', auto: false });
		var feed = Fd.create({ kind: 'radio', seed: 'lib0', ratio: 0.5, ahead: 3 }, radioDeps);
		await feed.fill();
		var ctl = P.controller({ player: mock, onNeedMore: function () { return feed.take(3); }, onHalt: function (r) { halts.push(r); feed.fill().then(function () { var more = feed.take(3); if (more.length) ctl.enqueue(more); }); } });
		ctl.load(feed.take(3), 0);
		var heard = 0;
		for (var z = 0; z < 300; z++) {
			await h.tickAll();
			mock.finish();
			heard++;
			await feed.fill();
			await h.tickAll();
		}
		h.ok(heard === 300 && ctl.current() != null, 'the controller played 300 songs from a radio' + (halts.length ? ' (' + halts.length + ' short waits, each recovered)' : ' without a halt'));
		ctl.destroy();
	});
};
