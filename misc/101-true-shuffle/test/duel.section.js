// duel: ranking songs two at a time. The Glicko step against the formula
// written out again here, the book never changed in place, the pair choice's
// properties on seeded runs, convergence on a hidden true order (with and
// without noise, against random pairs), the ranking, the stars mapping, the
// scopes, and storage through store.js's in-memory twin and its export.
module.exports = function (h) {
	var path = require('path');
	var D = require(path.join(h.HERE, 'duel.js'));
	var S = require(path.join(h.HERE, 'shuffle.js'));
	var Store = require(path.join(h.HERE, 'store.js'));

	function freeze(x) { if (x && typeof x === 'object' && !Object.isFrozen(x)) { Object.freeze(x); Object.keys(x).forEach(function (k) { freeze(x[k]); }); } return x; }
	function ids(n, prefix) { var out = []; for (var i = 0; i < n; i++) out.push((prefix || 's') + i); return out; }
	function spearman(order, truth) {
		var n = order.length, pos = {}, d2 = 0;
		truth.forEach(function (id, i) { pos[id] = i; });
		order.forEach(function (id, i) { var d = i - pos[id]; d2 += d * d; });
		return 1 - 6 * d2 / (n * (n * n - 1));
	}
	// Duels on a hidden order: s0 is liked most. With noise the answer follows
	// Bradley-Terry on strengths spread from 3 to -3, else it is always right.
	function simulate(n, duels, seed, opts) {
		opts = opts || {};
		var rand = S.rng(seed), list = ids(n), strength = {}, book = D.empty();
		list.forEach(function (id, i) { strength[id] = (n - i) / n * 6 - 3; });
		for (var k = 0; k < duels; k++) {
			var p;
			if (opts.random) { var a = list[Math.floor(rand() * n)], b; do { b = list[Math.floor(rand() * n)]; } while (b === a); p = [a, b]; }
			else p = D.pickPair(book, list, rand);
			var pa = opts.noise ? 1 / (1 + Math.exp(-(strength[p[0]] - strength[p[1]]))) : (strength[p[0]] > strength[p[1]] ? 1 : 0);
			book = rand() < pa ? D.record(book, p[0], p[1]) : D.record(book, p[1], p[0]);
		}
		var order = D.ranking(book, list).map(function (r) { return r.id; });
		list.forEach(function (id) { if (order.indexOf(id) < 0) order.push(id); });
		return { book: book, rho: spearman(order, list) };
	}
	// Glicko-1 for one game, written out again from Glickman's paper.
	function glicko(r, rd, rj, rdj, s) {
		var q = Math.log(10) / 400, gj = 1 / Math.sqrt(1 + 3 * q * q * rdj * rdj / Math.pow(Math.PI, 2));
		var e = 1 / (1 + Math.pow(10, -gj * (r - rj) / 400)), d2 = 1 / (q * q * gj * gj * e * (1 - e));
		return { r: r + q / (1 / (rd * rd) + 1 / d2) * gj * (s - e), rd: Math.sqrt(1 / (1 / (rd * rd) + 1 / d2)) };
	}
	function track(id, more) {
		var t = { id: id, title: 'Song ' + id, artist: 'A', genres: [], rating: 0, plays: 0, embeddable: true, removed: false, playerError: 0, blocked: false };
		for (var k in more) t[k] = more[k];
		return t;
	}

	h.describe('duel', async function () {
		// ---- the Glicko step ------------------------------------------------------------------
		var a = { r: 1500, rd: 350 }, b = { r: 1500, rd: 350 };
		var ua = D.update(a, b, 1), ub = D.update(b, a, 0), want = glicko(1500, 350, 1500, 350, 1);
		h.near(ua.r, want.r, 1e-9, 'update: a win between two new songs follows Glicko (r ' + want.r.toFixed(1) + ')');
		h.near(ua.rd, want.rd, 1e-9, 'update: and the uncertainty falls as Glicko says (rd ' + want.rd.toFixed(1) + ')');
		h.near(ua.r - 1500, 1500 - ub.r, 1e-9, 'update: between equals the winner gains what the loser loses');
		var w2 = glicko(1620, 90, 1480, 240, 0), u2 = D.update({ r: 1620, rd: 90 }, { r: 1480, rd: 240 }, 0);
		h.near(u2.r, w2.r, 1e-9, 'update: a sure song losing to an unsure weaker one, as Glicko says');
		h.ok(Math.abs(u2.r - 1620) < Math.abs(ua.r - 1500), 'update: a sure song moves less than a new one');
		var expected = D.update({ r: 1700, rd: 150 }, { r: 1400, rd: 150 }, 1), upset = D.update({ r: 1400, rd: 150 }, { r: 1700, rd: 150 }, 1);
		h.ok(upset.r - 1400 > expected.r - 1700, 'update: an upset moves the score more than the expected win (' + (upset.r - 1400).toFixed(1) + ' > ' + (expected.r - 1700).toFixed(1) + ')');
		var floor = { r: 1500, rd: D.RD_MIN };
		for (var i = 0; i < 30; i++) floor = D.update(floor, { r: 1500, rd: D.RD_MIN }, i % 2);
		h.eq(floor.rd, D.RD_MIN, 'update: the uncertainty never falls below RD_MIN (' + D.RD_MIN + '), so a score can still move');

		// ---- record and skip --------------------------------------------------------------------
		var b0 = freeze(D.empty()), b1 = D.record(b0, 'x', 'y');
		h.eq(b0, { n: 0, s: {}, p: [] }, 'record: the book given is never changed (frozen)');
		h.eq([b1.n, b1.s.x.n, b1.s.x.w, b1.s.x.t, b1.s.y.n, b1.s.y.w, b1.s.y.t, b1.p], [1, 1, 1, 1, 1, 0, 1, ['x|y']], 'record: one turn, a duel each, the win to the winner, both shown this turn, the pair remembered');
		h.near(b1.s.x.r, ua.r, 1e-9, 'record: the scores are the Glicko step');
		h.ok(D.record(b1, 'x', 'x') === b1 && D.record(b1, '', 'y') === b1, 'record: a song against itself, or none, changes nothing');
		var stars = { five: 5, one: 1 }, bs = D.record(D.empty(), 'one', 'five', { starsOf: function (id) { return stars[id] || 0; } });
		var direct = D.update({ r: D.R0 - 150, rd: D.RD0 }, { r: D.R0 + 150, rd: D.RD0 }, 1);
		h.near(bs.s.one.r, direct.r, 1e-9, 'record: a song starts from its stars (one star at 1350, five at 1650)');
		h.ok(bs.s.one.r - (D.R0 - 150) > ua.r - D.R0, 'record: so a one-star song beating a five-star one is a surprise and moves further');
		var b2 = D.skip(freeze(b1), 'x', 'z');
		h.eq([b2.n, b2.s.x.r === b1.s.x.r, b2.s.x.n, b2.s.x.t, b2.s.z.n, b2.s.z.t, b2.p], [2, true, 1, 2, 0, 2, ['x|y', 'x|z']], 'skip: no score moves, nothing counts as a duel, but both songs and the pair rest');
		h.eq(D.ranking(b2, ['x', 'y', 'z']).map(function (r) { return r.id; }), ['x', 'y'], 'skip: a song only skipped is not ranked');
		var many = D.empty();
		for (i = 0; i < 260; i++) many = D.record(many, 'a' + i, 'b' + i);
		h.eq([many.p.length, many.p[0], many.p[many.p.length - 1]], [D.PAIR_MEMORY, 'a60|b60', 'a259|b259'], 'record: at most PAIR_MEMORY (' + D.PAIR_MEMORY + ') pairs are remembered, the newest last');
		var again = D.record(D.record(D.record(D.empty(), 'a', 'b'), 'c', 'd'), 'b', 'a');
		h.eq(again.p, ['c|d', 'a|b'], 'record: a pair met again moves to the end, once');

		// ---- the pair choice --------------------------------------------------------------------
		h.eq([D.pickPair(D.empty(), [], S.rng('p')), D.pickPair(D.empty(), ['a', 'a'], S.rng('p'))], [null, null], 'pickPair: fewer than two songs gives null');
		h.eq(D.pickPair(D.empty(), ['a', 'b'], S.rng('p')).slice().sort(), ['a', 'b'], 'pickPair: two songs give those two');
		function run(pool, n, seed, opts) {
			var rand = S.rng(seed), book = D.empty(), pairs = [];
			for (var k = 0; k < n; k++) {
				var p = D.pickPair(book, pool, rand, opts);
				pairs.push(p);
				book = rand() < 0.5 ? D.record(book, p[0], p[1], opts) : D.record(book, p[1], p[0], opts);
			}
			return { book: book, pairs: pairs };
		}
		var pool30 = ids(30), r1 = run(pool30, 150, 'seed-a'), r2 = run(pool30, 150, 'seed-a'), r3 = run(pool30, 150, 'seed-b');
		h.eq(r1.pairs, r2.pairs, 'pickPair: the same seed gives the same pairs');
		h.ok(JSON.stringify(r1.pairs) !== JSON.stringify(r3.pairs), 'pickPair: another seed gives other pairs');
		h.ok(r1.pairs.every(function (p) { return p[0] !== p[1] && pool30.indexOf(p[0]) >= 0 && pool30.indexOf(p[1]) >= 0; }), 'pickPair: always two different songs of the pool');
		var seenPairs = {}, repeat = 0;
		r1.pairs.forEach(function (p) { var k = p.slice().sort().join('|'); if (seenPairs[k]) repeat++; seenPairs[k] = true; });
		h.eq(repeat, 0, 'pickPair: 150 picks among 30 songs never ask the same pair twice');
		var back2back = 0;
		r1.pairs.forEach(function (p, k) { if (k && (r1.pairs[k - 1].indexOf(p[0]) >= 0 || r1.pairs[k - 1].indexOf(p[1]) >= 0)) back2back++; });
		h.eq(back2back, 0, 'pickPair: a song of the last duel never comes straight back (30 songs)');
		var small = run(['a', 'b', 'c'], 30, 'tiny'), same = 0;
		small.pairs.forEach(function (p, k) { if (k && p.slice().sort().join() === small.pairs[k - 1].slice().sort().join()) same++; });
		h.eq(same, 0, 'pickPair: three songs: never the same pair twice in a row');
		var lefts = 0;
		r1.pairs.concat(r3.pairs).forEach(function (p) { if (p[0] < p[1]) lefts++; });
		h.ok(lefts > 110 && lefts < 190, 'pickPair: which side a song goes on is drawn (' + lefts + ' of 300 in name order)');
		// two uploads of one song are never asked against each other
		var keys = {};
		ids(20).forEach(function (id, k) { keys[id] = 'song' + Math.floor(k / 2); });
		var kr = run(ids(20), 120, 'keys', { keyOf: function (id) { return keys[id]; } });
		h.ok(kr.pairs.every(function (p) { return keys[p[0]] !== keys[p[1]]; }), 'pickPair: never two uploads of the same song (keyOf)');
		h.eq(D.pickPair(D.empty(), ['a', 'b'], S.rng('k'), { keyOf: function () { return 'same'; } }).slice().sort(), ['a', 'b'], 'pickPair: unless nothing else is there');
		// the unsure come first
		var mixed = D.empty();
		mixed.n = 100;
		ids(40).forEach(function (id, k) { mixed.s[id] = { r: 1500 + (k % 7) * 30, rd: k < 20 ? 60 : 330, n: k < 20 ? 30 : 1, w: 0, t: 1 }; });
		var unsureFirst = 0, rr = S.rng('unsure');
		for (i = 0; i < 200; i++) { var pp = D.pickPair(mixed, ids(40), rr), aa = pp.filter(function (id) { return +id.slice(1) >= 20; }).length; if (aa) unsureFirst++; }
		h.ok(unsureFirst >= 190, 'pickPair: an unsure song is in nearly every pair while there are some (' + unsureFirst + ' of 200)');
		// close scores make the pair
		var spread = D.empty(), rs = S.rng('close'), gap = 0, randomGap = 0;
		spread.n = 100;
		ids(60).forEach(function (id, k) { spread.s[id] = { r: 1000 + k * 20, rd: 150, n: 8, w: 4, t: 1 }; });
		for (i = 0; i < 300; i++) {
			var cp = D.pickPair(spread, ids(60), rs);
			gap += Math.abs(spread.s[cp[0]].r - spread.s[cp[1]].r);
			randomGap += Math.abs(spread.s['s' + Math.floor(rs() * 60)].r - spread.s['s' + Math.floor(rs() * 60)].r);
		}
		h.ok(gap / 300 < randomGap / 300 / 4, 'pickPair: the partner has a close score (mean gap ' + (gap / 300).toFixed(0) + ' against ' + (randomGap / 300).toFixed(0) + ' for random pairs)');
		// a big library stays quick
		var big = ids(5000, 'v'), bb = D.empty(), rb = S.rng('big'), t0 = Date.now();
		for (i = 0; i < 300; i++) { var bp = D.pickPair(bb, big, rb); bb = D.record(bb, bp[0], bp[1]); }
		var ms = Date.now() - t0;
		h.ok(ms < 3000, 'pickPair and record: 300 duels in a library of 5,000 songs in ' + ms + ' ms');
		h.eq(Object.keys(bb.s).length, 600, 'pickPair: in a big library the new songs come in first (600 songs met in 300 duels)');

		// ---- convergence on a hidden order ------------------------------------------------------
		var det = 0, noisy = 0, rnd = 0, seeds = ['c1', 'c2', 'c3', 'c4'];
		seeds.forEach(function (s) {
			det += simulate(40, 160, s).rho;
			noisy += simulate(40, 240, s, { noise: true }).rho;
			rnd += simulate(40, 240, s, { noise: true, random: true }).rho;
		});
		det /= seeds.length; noisy /= seeds.length; rnd /= seeds.length;
		h.ok(det >= 0.95, 'convergence: 40 songs, 160 duels with right answers: rank correlation ' + det.toFixed(3) + ' (at least 0.95)');
		h.ok(noisy >= 0.85, 'convergence: 40 songs, 240 duels with noisy answers: ' + noisy.toFixed(3) + ' (at least 0.85)');
		h.ok(noisy > rnd, 'convergence: the chosen pairs learn faster than random pairs (' + noisy.toFixed(3) + ' against ' + rnd.toFixed(3) + ')');
		var after = simulate(40, 160, 'c1').book, fair = D.ranking(after, ids(40)).filter(function (r) { return r.rd <= D.FAIR_RD; }).length;
		h.eq(fair, 40, 'convergence: after four duels a song, every song is at least fairly sure');

		// ---- the ranking ------------------------------------------------------------------------
		var rb2 = D.empty();
		rb2.s = { a: { r: 1600, rd: 100, n: 12, w: 9, t: 1 }, b: { r: 1700, rd: 180, n: 5, w: 4, t: 1 }, c: { r: 1600, rd: 300, n: 1, w: 1, t: 1 }, d: { r: 1800, rd: 350, n: 0, w: 0, t: 1 }, e: { r: 1550, rd: 250, n: 2, w: 1, t: 1 } };
		var rk = D.ranking(rb2, ['a', 'b', 'c', 'd', 'x', 'a']);
		h.eq(rk.map(function (r) { return r.id + ':' + r.sure; }), ['b:fair', 'a:sure', 'c:unsure'], 'ranking: best first, the surer of equals first; only songs asked for that had a duel; sure, fair or unsure from rd');
		h.eq([rk[1].n, rk[1].w], [12, 9], 'ranking: duels and wins come along');

		// ---- the stars --------------------------------------------------------------------------
		function rows(n, rd) { var out = []; for (var k = 0; k < n; k++) out.push({ id: 'r' + k, r: 2000 - k, rd: rd || 100 }); return out; }
		var p10 = D.starsPlan(rows(10));
		h.eq([p10.ok, p10.ranked, p10.counts, p10.changes.map(function (c) { return c.to; })], [true, 10, [0, 1, 2, 4, 2, 1], [5, 4, 4, 3, 3, 3, 3, 2, 2, 1]], 'starsPlan: ten unrated songs get 5, 4, 4, 3, 3, 3, 3, 2, 2, 1 by place');
		var p100 = D.starsPlan(rows(100));
		h.eq(p100.counts, [0, 10, 20, 40, 20, 10], 'starsPlan: a hundred songs: 10%, 20%, 40%, 20%, 10%');
		h.eq(D.starsPlan(rows(9)).ok, false, 'starsPlan: fewer than MIN_RANKED (' + D.MIN_RANKED + ') songs sure enough is not enough');
		var mixedRows = rows(12).concat([{ id: 'u1', r: 1995.5, rd: 260 }, { id: 'u2', r: 10, rd: 300 }]).sort(function (x, y) { return y.r - x.r; });
		var rated = { r0: 5, r1: 2, r11: 1 }, onlyNew = D.starsPlan(mixedRows, { ratingOf: function (id) { return rated[id] || 0; } });
		h.eq([onlyNew.ranked, onlyNew.unsure, onlyNew.kept, onlyNew.changes.length, onlyNew.changes.some(function (c) { return rated[c.id] || c.id.charAt(0) === 'u'; })], [12, 2, 3, 9, false], 'starsPlan: by default only unrated songs change; rated ones are kept, unsure ones left alone');
		var withAll = D.starsPlan(mixedRows, { ratingOf: function (id) { return rated[id] || 0; }, all: true });
		h.eq([withAll.same, withAll.changes.length, withAll.changes.filter(function (c) { return c.id === 'r1'; })[0]], [2, 10, { id: 'r1', from: 2, to: 4 }], 'starsPlan: with all, rated songs change too, and songs already right are counted as the same');
		var sum = 0;
		withAll.counts.forEach(function (c) { sum += c; });
		h.eq(sum, withAll.changes.length, 'starsPlan: the counts add up to the changes');

		// ---- the scopes -------------------------------------------------------------------------
		var tracks = [
			track('a', { rating: 5, work: 'Kumori: Station', genres: ['Rock'] }), track('b', { rating: 4, genres: ['Pop', 'Rock'] }), track('c', { rating: 2 }), track('d'),
			track('e', { blocked: true }), track('f', { kind: 'clip' }), track('g', { removed: true }), track('h', { embeddable: false }), track('i', { playerError: 150 }), track('j', { transient: true }),
			track('k', { work: 'Kumori: Station', role: 'ED' })
		];
		h.eq(D.pool(tracks, 'all'), ['a', 'b', 'c', 'd', 'k'], 'pool: playable, not blocked, not a clip, not a found song');
		h.eq([D.pool(tracks, 'liked'), D.pool(tracks, 'unrated')], [['a', 'b'], ['d', 'k']], 'pool: liked is four stars or more; unrated has none');
		h.eq([D.pool(tracks, 'work:Kumori: Station'), D.pool(tracks, 'genre:Rock'), D.pool(tracks, 'genre:Jazz')], [['a', 'k'], ['a', 'b'], []], 'pool: one work (a colon in its name too), one genre');
		var map = {};
		tracks.forEach(function (t) { map[t.id] = t; });
		h.eq([D.pool(map, 'nonsense'), D.pool(map, 'work:'), D.pool(null, 'all')], [['a', 'b', 'c', 'd', 'k'], ['a', 'b', 'c', 'd', 'k'], []], 'pool: a map works too; an unknown scope is all songs');

		// ---- storage ----------------------------------------------------------------------------
		var stored = simulate(30, 90, 'store').book, packed = D.pack(stored);
		h.ok(Object.keys(packed.s).every(function (id) { var e = packed.s[id]; return Array.isArray(e) && e.length === 5 && Math.round(e[0] * 10) === e[0] * 10; }), 'pack: each song is [r, rd, duels, won, turn], scores to a tenth');
		h.eq(D.pack(D.unpack(packed)), packed, 'pack and unpack: a round trip keeps everything');
		h.eq(D.ranking(D.unpack(packed), ids(30)).map(function (r) { return r.id; }), D.ranking(stored, ids(30)).map(function (r) { return r.id; }), 'unpack: the ranking survives the rounding');
		h.eq([D.unpack(null), D.unpack('x'), D.unpack({ v: 2, n: 3 }), D.unpack({ v: 1 })], [D.empty(), D.empty(), D.empty(), D.empty()], 'unpack: anything that is not a book gives an empty one');
		// as a file would bring it: JSON makes "__proto__" a key of its own
		var hurt = D.unpack(JSON.parse('{"v":1,"n":5,"s":{"ok":[1600,120,4,3,9],"nan":["x",100,1,0,1],"won":[1500,100,1,2,1],"short":[1500,100],"low":[1500,3,2,1,1],"__proto__":[1,100,1,0,1]},"p":["a|b",7,"nobar","c|d"]}'));
		h.eq(hurt, { n: 5, s: { ok: { r: 1600, rd: 120, n: 4, w: 3, t: 5 }, low: { r: 1500, rd: D.RD_MIN, n: 2, w: 1, t: 1 } }, p: ['a|b', 'c|d'] }, 'unpack: damaged entries are left out, the rest kept (rd at least RD_MIN, the turn at most the book\'s)');
		h.ok(Object.getPrototypeOf(hurt.s) === Object.prototype, 'unpack: a "__proto__" entry cannot change the book\'s shape');
		var st = Store.memory();
		await st.set(D.KEY, packed);
		h.eq(D.pack(D.unpack(await st.get(D.KEY, null))), packed, 'storage: the book goes through store.js\'s kv (' + D.KEY + ') unchanged');
		var exp = await st.exportAll(0);
		h.eq(exp.kv[D.KEY], packed, 'storage: the store\'s export carries it');
		var st2 = Store.memory();
		await st2.importAll(JSON.parse(JSON.stringify(exp)));
		h.eq(D.pack(D.unpack(await st2.get(D.KEY, null))), packed, 'storage: and importing the file brings it back');
		h.ok(JSON.stringify(packed).length < 30 * 60, 'storage: compact (' + JSON.stringify(packed).length + ' characters for 30 songs)');
	});
};
