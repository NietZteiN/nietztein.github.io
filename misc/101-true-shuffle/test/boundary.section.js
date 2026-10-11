// boundary: between two songs the page may read a list on the player first (player.js readList,
// the controller's onBoundary): the next song waits for it, at most boundaryMs; a press wins.
module.exports = function (h) {
	var path = require('path');
	var P = require(path.join(h.HERE, 'player.js'));
	function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

	h.describe('boundary', async function () {
		var mock = P.create({ kind: 'mock', auto: false, lists: { RDaaaaaaaaaaa: ['bbbbbbbbbbb', 'ccccccccccc'] } });
		h.eq([await mock.readList('RDaaaaaaaaaaa'), await mock.readList('RDzzzzzzzzzzz')], [['bbbbbbbbbbb', 'ccccccccccc'], []], 'readList: the mock answers from opts.lists, else none');

		// a hold: the next song starts only when the read settles
		var release = null, held = [];
		var ctl = P.controller({ player: mock, onBoundary: function (id) { held.push(id); return new Promise(function (r) { release = r; }); }, boundaryMs: 2000 });
		ctl.load(['t1', 't2', 't3'], 0);
		await h.tickAll();
		mock.finish();
		await h.tickAll();
		h.eq([held, ctl.current(), mock.id()], [['t1'], 't1', 't1'], 'onBoundary: at the end of t1 the next song waits');
		release();
		await h.tickAll();
		h.eq([ctl.current(), mock.id()], ['t2', 't2'], 'onBoundary: then t2 starts');

		// no hold: straight on
		var ctl2 = P.controller({ player: P.create({ kind: 'mock', auto: false }), onBoundary: function () { return null; } });
		ctl2.load(['u1', 'u2'], 0);
		await h.tickAll();
		ctl2.state();
		var p2 = ctl2;
		h.ok(p2.current() === 'u1', 'onBoundary: nothing returned');

		// a hold that never settles: boundaryMs lets the next song start
		var mock3 = P.create({ kind: 'mock', auto: false });
		var ctl3 = P.controller({ player: mock3, onBoundary: function () { return new Promise(function () {}); }, boundaryMs: 40 });
		ctl3.load(['v1', 'v2'], 0);
		await h.tickAll();
		mock3.finish();
		await h.tickAll();
		h.eq(ctl3.current(), 'v1', 'onBoundary: held');
		await wait(70);
		await h.tickAll();
		h.eq(ctl3.current(), 'v2', 'onBoundary: at most boundaryMs, then the next song');

		// a press during the hold wins, and the late release does not skip again
		var release4 = null, mock4 = P.create({ kind: 'mock', auto: false });
		var ctl4 = P.controller({ player: mock4, onBoundary: function () { return new Promise(function (r) { release4 = r; }); }, boundaryMs: 2000 });
		ctl4.load(['w1', 'w2', 'w3'], 0);
		await h.tickAll();
		mock4.finish();
		await h.tickAll();
		ctl4.jump(2);
		await h.tickAll();
		release4();
		await h.tickAll();
		h.eq([ctl4.current(), mock4.id()], ['w3', 'w3'], 'onBoundary: a jump during the hold wins; the release does nothing');
		ctl.destroy(); ctl3.destroy(); ctl4.destroy();
	});
};
