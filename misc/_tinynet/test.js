// Tests of misc/_tinynet. Run with: node misc/_tinynet/test.js
// Prints PASS/FAIL lines (and the measured numbers the README quotes); exit code 1 on any failure.
// Four full training runs of the default network are part of it. Three of them train in worker threads
// while this thread trains the first (see "long runs" below); TINYNET_TEST_THREADS=0 trains all four here,
// one after the other, with the same results bit for bit. The measured times are in README.md.
'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');
var TinyNet = require('./tinynet.js');
var threads = null;
try {
	threads = require('worker_threads');
} catch (err) {
	threads = null;
}

// This file is also the script of its own worker threads: there it does one long run and nothing else.
if (threads && !threads.isMainThread && threads.workerData && threads.workerData.tinynetLongRun) {
	(function (d) {
		var msg;
		try {
			msg = longRun(d.task);
		} catch (err) {
			msg = { error: String(err && err.stack || err) };
		}
		d.port.postMessage(msg);
		Atomics.store(d.shared, 0, 1);
		Atomics.notify(d.shared, 0);
		d.port.close();
	})(threads.workerData);
	return;
}

var failures = 0, passes = 0, started = Date.now();

function check(name, ok, detail) {
	if (ok) passes++;
	else failures++;
	console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail === undefined || detail === '' ? '' : '  [' + detail + ']'));
	return ok;
}

function section(title) {
	console.log('\n# ' + title + '  (' + ((Date.now() - started) / 1000).toFixed(1) + ' s)');
}

function info(text) {
	console.log('     ' + text);
}

function pct(x) {
	return (x * 100).toFixed(1) + '%';
}

function sameArray(a, b) {
	var i;
	if (a.length !== b.length) return false;
	for (i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
	return true;
}

function sameWeights(a, b) {
	return sameArray(a.W1a, b.W1a) && sameArray(a.W1b, b.W1b) && sameArray(a.W2, b.W2);
}

function maxAbsDiff(a, b) {
	var i, m = 0, d;
	for (i = 0; i < a.length; i++) {
		d = Math.abs(a[i] - b[i]);
		if (!(d <= m)) m = d;
	}
	return m;
}

function throws(fn) {
	try {
		fn();
	} catch (err) {
		return String(err && err.message);
	}
	return null;
}

// ---------------------------------------------------------------- deterministic math

section('exp, log, tanh, sigmoid without Math.exp');
(function () {
	var r = TinyNet.rng('math'), i, x, a, b, worstE = 0, worstL = 0, worstT = 0, worstS = 0;
	for (i = 0; i < 60000; i++) {
		x = (r() * 2 - 1) * 700;
		a = TinyNet.exp(x);
		b = Math.exp(x);
		worstE = Math.max(worstE, Math.abs(a - b) / b);
		x = Math.exp((r() * 2 - 1) * 700);
		worstL = Math.max(worstL, Math.abs(TinyNet.log(x) - Math.log(x)) / Math.max(Math.abs(Math.log(x)), 1e-300));
		x = (r() * 2 - 1) * (i % 3 === 0 ? 0.02 : 25);
		worstT = Math.max(worstT, Math.abs(TinyNet.tanh(x) - Math.tanh(x)) / Math.max(Math.abs(Math.tanh(x)), 1e-300));
		worstS = Math.max(worstS, Math.abs(TinyNet.sigmoid(x) - 1 / (1 + Math.exp(-x))) * (1 + Math.exp(-x)));
	}
	check('exp agrees with Math.exp over [-700, 700]', worstE < 1e-15, 'worst relative error ' + worstE.toExponential(2));
	check('log agrees with Math.log over 600 orders of magnitude', worstL < 1e-15, 'worst relative error ' + worstL.toExponential(2));
	check('tanh agrees with Math.tanh', worstT < 1e-13, 'worst relative error ' + worstT.toExponential(2));
	check('sigmoid agrees with 1 / (1 + e^-x)', worstS < 1e-14, 'worst relative error ' + worstS.toExponential(2));
	check('exp and log at the edges', TinyNet.exp(0) === 1 && TinyNet.exp(-Infinity) === 0 && TinyNet.exp(Infinity) === Infinity && TinyNet.exp(-800) === 0 &&
		TinyNet.exp(NaN) !== TinyNet.exp(NaN) && TinyNet.log(1) === 0 && TinyNet.log(0) === -Infinity && TinyNet.log(-1) !== TinyNet.log(-1) && TinyNet.log(Infinity) === Infinity &&
		Math.abs(TinyNet.exp(-745) - Math.exp(-745)) <= 5e-324 && Math.abs(TinyNet.log(5e-324) - Math.log(5e-324)) < 1e-12);
})();

// ---------------------------------------------------------------- random numbers

section('seeded random numbers');
(function () {
	var a = TinyNet.rng(1), b = TinyNet.rng(1), c = TinyNet.rng(2), i, same = true, differs = false, lo = 1, hi = 0, sum = 0, v, n = 100000, s1 = 0, s2 = 0, arr, sorted, r;
	for (i = 0; i < 200; i++) {
		v = a();
		if (v !== b()) same = false;
		if (v !== c()) differs = true;
	}
	check('the same seed gives the same stream, another seed another', same && differs);
	r = TinyNet.rng('range');
	for (i = 0; i < n; i++) {
		v = r();
		lo = Math.min(lo, v);
		hi = Math.max(hi, v);
		sum += v;
	}
	check('uniform numbers stay in [0, 1) with mean near 0.5', lo >= 0 && hi < 1 && Math.abs(sum / n - 0.5) < 0.01, 'mean ' + (sum / n).toFixed(4));
	for (i = 0; i < n; i++) {
		v = r.normal();
		s1 += v;
		s2 += v * v;
	}
	check('normal numbers have mean near 0 and variance near 1', Math.abs(s1 / n) < 0.02 && Math.abs(s2 / n - 1) < 0.03, 'mean ' + (s1 / n).toFixed(4) + ', variance ' + (s2 / n).toFixed(4));
	arr = [];
	for (i = 0; i < 50; i++) arr.push(i);
	TinyNet.rng('shuffle').shuffle(arr);
	sorted = arr.slice().sort(function (x, y) { return x - y; });
	check('shuffle is a permutation and is not the identity', sorted.every(function (x, k) { return x === k; }) && arr.some(function (x, k) { return x !== k; }));
	check('int(n) stays below n', (function () { var q = TinyNet.rng('int'), k; for (k = 0; k < 5000; k++) { v = q.int(7); if (v < 0 || v > 6 || v !== Math.floor(v)) return false; } return true; })());
	check('hash is FNV-1a', TinyNet.hash('') === 0x811c9dc5 && TinyNet.hash('a') === 0xe40c292c);
})();

// ---------------------------------------------------------------- base64

section('base64 of Float32Array bytes');
(function () {
	var ok = true, n, i, a, b, r = TinyNet.rng('b64');
	check('1.0 encodes as the little-endian bytes 00 00 80 3F', TinyNet.encodeFloats(new Float32Array([1])) === 'AACAPw==');
	for (n = 0; n < 12; n++) {
		a = new Float32Array(n);
		for (i = 0; i < n; i++) a[i] = (r() - 0.5) * 1e3;
		b = TinyNet.decodeFloats(TinyNet.encodeFloats(a));
		if (!sameArray(a, b)) ok = false;
	}
	check('encodeFloats then decodeFloats gives the same bits for lengths 0 to 11', ok);
	check('decodeFloats refuses data that is not whole floats', throws(function () { TinyNet.decodeFloats('AAAA'); }) !== null);
})();

// ---------------------------------------------------------------- hungarian

section('Hungarian assignment');
(function () {
	var r = TinyNet.rng('hungarian'), trials = 300, bad = 0, t, n, m, cost, flat, i, j, got, best, used, total, ok;

	function brute(cost, n, m) {
		var best = Infinity, taken = new Array(m).fill(false);
		(function rec(row, sum) {
			var c;
			if (row === n) { if (sum < best) best = sum; return; } // no pruning: costs may be negative
			for (c = 0; c < m; c++) if (!taken[c]) { taken[c] = true; rec(row + 1, sum + cost[row][c]); taken[c] = false; }
		})(0, 0);
		return best;
	}

	for (t = 0; t < trials; t++) {
		n = 1 + r.int(6);
		m = n + (t % 3 === 0 ? r.int(3) : 0);
		cost = [];
		flat = new Float64Array(n * m);
		for (i = 0; i < n; i++) {
			cost.push([]);
			for (j = 0; j < m; j++) {
				cost[i].push(Math.round((r() * 20 - 10) * 100) / 100);
				flat[i * m + j] = cost[i][j];
			}
		}
		got = TinyNet.hungarian(cost);
		best = brute(cost, n, m);
		used = {};
		total = 0;
		ok = got.length === n;
		for (i = 0; i < n; i++) {
			if (used[got[i]] || got[i] < 0 || got[i] >= m) ok = false;
			used[got[i]] = true;
			total += cost[i][got[i]];
		}
		if (!ok || Math.abs(total - best) > 1e-9 || !sameArray(got, TinyNet.hungarian(flat, n))) bad++;
	}
	check('matches brute force on ' + trials + ' random matrices up to 6 by 8 (rows and flat input)', bad === 0, bad + ' wrong');
	check('a known 3 by 3 case', sameArray(TinyNet.hungarian([[4, 1, 3], [2, 0, 5], [3, 2, 2]]), [1, 0, 2]));
	check('more rows than columns is refused', throws(function () { TinyNet.hungarian([[1], [2]]); }) !== null);
})();

// ---------------------------------------------------------------- the generic network

section('generic network: shape, forward, determinism');
(function () {
	var net = TinyNet.create({ sizes: [3, 5, 4, 2], act: 'tanh', seed: 7 }), again = TinyNet.create({ sizes: [3, 5, 4, 2], act: 'tanh', seed: 7 }), other = TinyNet.create({ sizes: [3, 5, 4, 2], act: 'tanh', seed: 8 }),
		nb = TinyNet.create({ sizes: [2, 3, 1], bias: false }), tiny, out;
	check('create gives W[l] of sizes[l] * sizes[l + 1] and b[l] of sizes[l + 1]', net.W.length === 3 && net.W[0].length === 15 && net.W[1].length === 20 && net.W[2].length === 8 && net.b[0].length === 5 && net.b[2].length === 2 && net.W[0] instanceof Float32Array);
	check('the same seed gives the same weights, another seed others', sameArray(net.W[1], again.W[1]) && !sameArray(net.W[1], other.W[1]));
	check('bias: false leaves b empty', nb.b[0].length === 0 && nb.b[1].length === 0);
	tiny = TinyNet.create({ sizes: [2, 2, 1], act: 'relu', seed: 1 });
	tiny.W[0].set([1, -1, 2, 0.5]); // input 0 -> units (1, -1); input 1 -> units (2, 0.5)
	tiny.b[0].set([0.5, -1]);
	tiny.W[1].set([3, -2]);
	tiny.b[1].set([0.25]);
	out = TinyNet.forward(tiny, [1, 1, -1, 2], 2);
	// row 0: pre = (1 + 2 + 0.5, -1 + 0.5 - 1) = (3.5, -1.5) -> relu (3.5, 0) -> 10.5 + 0.25
	// row 1: pre = (-1 + 4 + 0.5, 1 + 1 - 1) = (3.5, 1) -> 10.5 - 2 + 0.25
	check('forward matches a hand calculation', Math.abs(out.out[0] - 10.75) < 1e-12 && Math.abs(out.out[1] - 8.75) < 1e-12 && out.acts.length === 3 && out.acts[1][1] === 0 && out.acts[1][3] === 1, Array.from(out.out).join(', '));
	check('unknown activation is refused', throws(function () { TinyNet.create({ sizes: [1, 1], act: 'gelu' }); }) !== null);
})();

// Finite differences against backward, on every weight and bias (and the inputs).
function gradCheck(net, X, n, lossOf, opts) {
	var cache = TinyNet.forward(net, X, n, opts), L = lossOf(cache.out), grads = TinyNet.backward(net, cache, L.dOut, { dX: true }), worst = 0, eps = 1e-5, l;

	function lossNow() {
		return lossOf(TinyNet.forward(net, X, n, opts).out).loss;
	}

	function probe(arr, g) {
		var i, old, hi, lo, lp, lm, fd, err;
		for (i = 0; i < arr.length; i++) {
			old = arr[i];
			arr[i] = old + eps;
			hi = arr[i];
			lp = lossNow();
			arr[i] = old - eps;
			lo = arr[i];
			lm = lossNow();
			arr[i] = old;
			fd = (lp - lm) / (hi - lo);
			err = Math.abs(fd - g[i]) / (1e-3 + Math.abs(g[i]));
			if (!(err <= worst)) worst = err;
		}
	}

	for (l = 0; l < net.W.length; l++) {
		probe(net.W[l], grads.W[l]);
		probe(net.b[l], grads.b[l]);
	}
	probe(X, grads.dX);
	return { worst: worst, grads: grads, cache: cache };
}

section('generic network: backward against finite differences');
(function () {
	var r = TinyNet.rng('gradcheck'), n = 6, X = new Float64Array(n * 3), labels = [0, 1, 1, 0, 1, 0], soft = new Float64Array(n * 2), target = new Float64Array(n * 2), bits = new Float64Array(n * 2), i, lines = [], allOk = true;
	for (i = 0; i < X.length; i++) X[i] = r() * 2 - 1;
	for (i = 0; i < n; i++) {
		soft[2 * i] = r();
		soft[2 * i + 1] = 1 - soft[2 * i];
		target[2 * i] = r() * 2 - 1;
		target[2 * i + 1] = r() * 2 - 1;
		bits[2 * i] = r() < 0.5 ? 0 : 1;
		bits[2 * i + 1] = r();
	}
	TinyNet.acts.forEach(function (act) {
		var losses = {
			'softmaxCE': function (out) { return TinyNet.softmaxCE(out, labels, n); },
			'softmaxCE (soft labels)': function (out) { return TinyNet.softmaxCE(out, soft, n); },
			'mse': function (out) { return TinyNet.mse(out, target, n); },
			'bce': function (out) { return TinyNet.bce(out, bits, n); }
		};
		Object.keys(losses).forEach(function (name) {
			var net = TinyNet.create({ sizes: [3, 5, 4, 2], act: act, seed: 'gc-' + act }), res;
			for (i = 0; i < net.b.length; i++) net.b[i].set(net.b[i].map(function () { return (r() - 0.5) * 0.4; }));
			res = gradCheck(net, X, n, losses[name]);
			if (!(res.worst < 1e-5)) allOk = false;
			lines.push(act + ' / ' + name + ': ' + res.worst.toExponential(1));
		});
	});
	check('five activations times four losses: every weight, bias and input gradient matches', allOk, 'worst errors relative to 1e-3 + |gradient|');
	lines.forEach(function (l) { info(l); });
})();

section('generic network: the per-unit hook');
(function () {
	var r = TinyNet.rng('hook'), n = 5, X = new Float64Array(n * 3), labels = [1, 0, 2, 1, 0], vals = new Float64Array(n), i, net, plain, hooked, res, zeroIn = true, fdWorst = 0, eps = 1e-6, lp, lm, old, g, nout, twoHooks, fnHook;
	for (i = 0; i < X.length; i++) X[i] = r() * 2 - 1;
	for (i = 0; i < n; i++) vals[i] = r() * 2 - 0.5;
	['relu', 'tanh', 'square'].forEach(function (act) {
		net = TinyNet.create({ sizes: [3, 6, 4, 3], act: act, seed: 'hook-' + act });
		function lossOf(out) { return TinyNet.softmaxCE(out, labels, n); }
		var opts = { hook: { layer: 1, unit: 2, values: vals } };
		plain = TinyNet.forward(net, X, n);
		hooked = TinyNet.forward(net, X, n, opts);
		res = gradCheck(net, X, n, lossOf, opts);
		nout = 6;
		for (i = 0; i < 3; i++) if (res.grads.W[0][i * nout + 2] !== 0) zeroIn = false;
		if (res.grads.b[0][2] !== 0) zeroIn = false;
		// dLoss/d(value) by finite differences on the values themselves
		g = res.grads.hook;
		for (i = 0; i < n; i++) {
			old = vals[i];
			vals[i] = old + eps;
			lp = lossOf(TinyNet.forward(net, X, n, opts).out).loss;
			vals[i] = old - eps;
			lm = lossOf(TinyNet.forward(net, X, n, opts).out).loss;
			vals[i] = old;
			fdWorst = Math.max(fdWorst, Math.abs((lp - lm) / (2 * eps) - g[i]) / (1e-3 + Math.abs(g[i])));
		}
		check(act + ': the hooked unit takes the given values and the output changes', hooked.acts[1][2] === vals[0] && hooked.acts[1][6 + 2] === vals[1] && maxAbsDiff(plain.out, hooked.out) > 1e-6);
		check(act + ': with the hook, all other gradients still match finite differences', res.worst < 1e-5, res.worst.toExponential(1));
		check(act + ': no gradient reaches the hooked unit\'s incoming weights and bias', zeroIn);
		check(act + ': grads.hook is dLoss/d(value) per sample', fdWorst < 1e-5, fdWorst.toExponential(1));
	});
	net = TinyNet.create({ sizes: [3, 6, 4, 3], act: 'tanh', seed: 'hook-two' });
	twoHooks = TinyNet.forward(net, X, n, { hook: [{ layer: 1, unit: 0, values: vals }, { layer: 2, unit: 3, fn: function (s, a) { return 2 * a; } }] });
	fnHook = TinyNet.forward(net, X, n, { hook: { layer: 1, unit: 0, values: vals } });
	check('two hooks at once, one of them a function of the activation', twoHooks.acts[1][0] === vals[0] && Math.abs(twoHooks.acts[2][3] - 2 * fnHook.acts[2][3]) < 1e-12 &&
		TinyNet.backward(net, twoHooks, TinyNet.softmaxCE(twoHooks.out, labels, n).dOut).hooks.length === 2);
	check('a hook on the output layer or an unknown unit is refused', throws(function () { TinyNet.forward(net, X, n, { hook: { layer: 3, unit: 0, values: vals } }); }) !== null &&
		throws(function () { TinyNet.forward(net, X, n, { hook: { layer: 1, unit: 6, values: vals } }); }) !== null);
})();

section('optimisers and learning');
(function () {
	var net = TinyNet.create({ sizes: [1, 1], bias: false, act: 'linear', seed: 1 }), opt, w0, g, lr = 0.1, wd = 0.5, b1 = 0.9, b2 = 0.999, eps = 1e-8, m, v, w1, w2, expect1, expect2, X, y, i, cache, L, sg, mom, v1;
	net.W[0][0] = 0.75;
	w0 = net.W[0][0];
	g = 0.3;
	opt = TinyNet.adamw(net, { lr: lr, wd: wd });
	opt.step({ W: [new Float64Array([g])], b: [new Float64Array(0)] });
	w1 = net.W[0][0];
	m = (1 - b1) * g;
	v = (1 - b2) * g * g;
	expect1 = Math.fround(w0 * (1 - lr * wd) - lr * (m / (1 - b1)) / (Math.sqrt(v / (1 - b2)) + eps));
	opt.step({ W: [new Float64Array([-0.2])], b: [new Float64Array(0)] });
	w2 = net.W[0][0];
	m = b1 * m + (1 - b1) * -0.2;
	v = b2 * v + (1 - b2) * 0.04;
	expect2 = Math.fround(w1 * (1 - lr * wd) - lr * (m / (1 - b1 * b1)) / (Math.sqrt(v / (1 - b2 * b2)) + eps));
	check('adamw: two steps equal the textbook formula (decoupled decay, bias-corrected moments)', Math.abs(w1 - expect1) < 1e-7 && Math.abs(w2 - expect2) < 1e-7, w1 + ' vs ' + expect1 + ', ' + w2 + ' vs ' + expect2);

	net.W[0][0] = 0.75;
	mom = 0.9;
	sg = TinyNet.sgd(net, { lr: 0.1, momentum: mom });
	sg.step({ W: [new Float64Array([0.3])], b: [new Float64Array(0)] });
	v1 = 0.3;
	expect1 = Math.fround(0.75 - 0.1 * v1);
	w1 = net.W[0][0];
	sg.step({ W: [new Float64Array([-0.2])], b: [new Float64Array(0)] });
	expect2 = Math.fround(w1 - 0.1 * (mom * v1 - 0.2));
	check('sgd: two steps with momentum equal v = momentum * v + g; w -= lr * v', Math.abs(w1 - expect1) < 1e-7 && Math.abs(net.W[0][0] - expect2) < 1e-7);

	// XOR with softmax cross-entropy and AdamW
	net = TinyNet.create({ sizes: [2, 8, 2], act: 'tanh', seed: 4 });
	opt = TinyNet.adamw(net, { lr: 0.05, wd: 0 });
	X = [0, 0, 0, 1, 1, 0, 1, 1];
	y = [0, 1, 1, 0];
	for (i = 0; i < 300; i++) {
		cache = TinyNet.forward(net, X, 4);
		L = TinyNet.softmaxCE(cache.out, y, 4);
		opt.step(TinyNet.backward(net, cache, L.dOut));
	}
	L = TinyNet.softmaxCE(TinyNet.forward(net, X, 4).out, y, 4);
	check('a 2-8-2 tanh network learns XOR in 300 AdamW steps', L.acc === 1 && L.loss < 0.05, 'loss ' + L.loss.toExponential(2));

	// a line with mse and plain SGD
	net = TinyNet.create({ sizes: [1, 1], act: 'linear', seed: 2 });
	sg = TinyNet.sgd(net, { lr: 0.1, momentum: 0.5 });
	X = [-1, -0.5, 0, 0.5, 1];
	y = X.map(function (x) { return 2 * x - 1; });
	for (i = 0; i < 300; i++) {
		cache = TinyNet.forward(net, X, 5);
		sg.step(TinyNet.backward(net, cache, TinyNet.mse(cache.out, y, 5).dOut));
	}
	check('a 1-1 linear network fits y = 2x - 1 with mse and SGD', Math.abs(net.W[0][0] - 2) < 1e-3 && Math.abs(net.b[0][0] + 1) < 1e-3, 'w ' + net.W[0][0].toFixed(5) + ', b ' + net.b[0][0].toFixed(5));

	// AND with bce
	net = TinyNet.create({ sizes: [2, 4, 1], act: 'relu', seed: 3 });
	opt = TinyNet.adamw(net, { lr: 0.05, wd: 0 });
	X = [0, 0, 0, 1, 1, 0, 1, 1];
	y = [0, 0, 0, 1];
	for (i = 0; i < 300; i++) {
		cache = TinyNet.forward(net, X, 4);
		opt.step(TinyNet.backward(net, cache, TinyNet.bce(cache.out, y, 4).dOut));
	}
	L = TinyNet.bce(TinyNet.forward(net, X, 4).out, y, 4);
	check('a 2-4-1 relu network learns AND with bce', L.acc === 1 && L.loss < 0.05, 'loss ' + L.loss.toExponential(2));
})();

section('serialize, load, clone, lerp');
(function () {
	var a = TinyNet.create({ sizes: [4, 7, 3], act: 'sigmoid', seed: 11 }), b = TinyNet.create({ sizes: [4, 7, 3], act: 'sigmoid', seed: 12 }), text, back, c, mid, i, ok = true, X = [0.1, -0.2, 0.3, 0.4];
	a.b[0].set([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7]);
	text = JSON.stringify(TinyNet.serialize(a));
	back = TinyNet.load(text);
	check('serialize -> JSON -> load gives the same bits and the same outputs', sameArray(a.W[0], back.W[0]) && sameArray(a.W[1], back.W[1]) && sameArray(a.b[0], back.b[0]) && sameArray(a.b[1], back.b[1]) &&
		back.act === 'sigmoid' && back.bias === true && sameArray(TinyNet.forward(a, X, 1).out, TinyNet.forward(back, X, 1).out), text.length + ' characters for ' + (4 * 7 + 7 + 7 * 3 + 3) + ' numbers');
	c = TinyNet.clone(a);
	c.W[0][0] += 1;
	check('clone is a separate copy', c.W[0][0] !== a.W[0][0] && sameArray(c.W[1], a.W[1]));
	mid = TinyNet.lerp(a, b, 0.25);
	for (i = 0; i < a.W[0].length; i++) if (Math.abs(mid.W[0][i] - (0.75 * a.W[0][i] + 0.25 * b.W[0][i])) > 1e-7) ok = false;
	check('lerp(a, b, 0) is a, lerp(a, b, 1) is b, 0.25 in between', ok && sameArray(TinyNet.lerp(a, b, 0).W[1], a.W[1]) && sameArray(TinyNet.lerp(a, b, 1).W[1], b.W[1]) && sameArray(TinyNet.lerp(a, b, 1).b[0], b.b[0]));
	check('load refuses data of the wrong size', throws(function () { TinyNet.load({ sizes: [4, 7, 3], act: 'relu', bias: true, data: 'AACAPw==' }); }) !== null);
})();

// ---------------------------------------------------------------- modular addition: structure and gradients

// The same model as a generic network: input = one-hot(a) next to one-hot(b), no biases.
function twin(t) {
	var p = t.p, h = t.hidden, w = t.weights(), tb = t.table(), net = TinyNet.create({ sizes: [2 * p, h, p], act: t.cfg.act, bias: false, seed: 0 }), idx = [], i, X, y;
	net.W[0].set(w.W1a, 0);
	net.W[0].set(w.W1b, p * h);
	net.W[1].set(w.W2);
	for (i = 0; i < p * p; i++) if (tb.isTrain[i]) idx.push(i);
	X = new Float32Array(idx.length * 2 * p);
	y = new Int32Array(idx.length);
	for (i = 0; i < idx.length; i++) {
		X[i * 2 * p + Math.floor(idx[i] / p)] = 1;
		X[i * 2 * p + p + idx[i] % p] = 1;
		y[i] = (Math.floor(idx[i] / p) + idx[i] % p) % p;
	}
	return { net: net, X: X, y: y, n: idx.length };
}

section('modular addition: the task and the split');
(function () {
	var t = TinyNet.grok({ p: 13, hidden: 10, frac: 0.6, seed: 5 }), tb = t.table(), nTrain = 0, i, m = t.metrics(), t2 = TinyNet.grok({ p: 13, hidden: 10, frac: 0.6, seed: 6, splitSeed: 5 }), t3 = TinyNet.grok({ p: 13, hidden: 10, frac: 0.6, seed: 6 }), d = TinyNet.grokDefaults();
	for (i = 0; i < tb.isTrain.length; i++) nTrain += tb.isTrain[i];
	check('60% of the 169 pairs are training pairs', nTrain === Math.round(0.6 * 169) && t.nTrain === nTrain && t.nTest === 169 - nTrain && tb.pred.length === 169 && tb.prob.length === 169 && tb.p === 13);
	check('an untrained network is at chance: loss near ln 13', Math.abs(m.trainLoss - Math.log(13)) < 0.2 && m.epoch === 0 && m.trainAcc < 0.3, 'train loss ' + m.trainLoss.toFixed(3) + ', ln 13 = ' + Math.log(13).toFixed(3));
	check('splitSeed shares the split between two initialisations', sameArray(t2.table().isTrain, tb.isTrain) && !sameArray(t2.weights().W2, t.weights().W2) && !sameArray(t3.table().isTrain, tb.isTrain));
	check('the defaults are p 41, hidden 128, 60%, lr 0.01, wd 1, relu', d.p === 41 && d.hidden === 128 && d.frac === 0.6 && d.lr === 0.01 && d.wd === 1 && d.act === 'relu' && d.seed === 1 && d.beta2 === 0.98);
	check('bad settings are refused in plain words', /p must be/.test(throws(function () { TinyNet.grok({ p: 1 }); })) && /hidden must be/.test(throws(function () { TinyNet.grok({ hidden: 0 }); })) &&
		/frac must be/.test(throws(function () { TinyNet.grok({ frac: 0 }); })) && /unknown activation/.test(throws(function () { TinyNet.grok({ act: 'gelu' }); })));
})();

section('modular addition: gradients');
(function () {
	var lines = [], worstTwin = 0, worstFd = 0, lossGap = 0;
	TinyNet.acts.forEach(function (act) {
		var t = TinyNet.grok({ p: 7, hidden: 6, act: act, seed: 3, frac: 0.7 }), tw, cache, L, g, mine, d, w, names = ['W1a', 'W1b', 'W2'], q, k, arr, old, hi, lo, lp, lm, fd, err, fdWorst = 0, eps = 1e-5, ph = 42;
		t.run(3);
		tw = twin(t);
		cache = TinyNet.forward(tw.net, tw.X, tw.n);
		L = TinyNet.softmaxCE(cache.out, tw.y, tw.n);
		g = TinyNet.backward(tw.net, cache, L.dOut);
		mine = t.gradAt(null, 'train');
		d = Math.max(maxAbsDiff(mine.grad.W1a, g.W[0].subarray(0, ph)), maxAbsDiff(mine.grad.W1b, g.W[0].subarray(ph, 2 * ph)), maxAbsDiff(mine.grad.W2, g.W[1]));
		worstTwin = Math.max(worstTwin, d);
		lossGap = Math.max(lossGap, Math.abs(mine.loss - L.loss));
		w = t.weights();
		for (q = 0; q < 3; q++) {
			arr = w[names[q]];
			for (k = 0; k < arr.length; k++) {
				old = arr[k];
				arr[k] = old + eps;
				hi = arr[k];
				lp = t.lossAt(w, 'train').loss;
				arr[k] = old - eps;
				lo = arr[k];
				lm = t.lossAt(w, 'train').loss;
				arr[k] = old;
				fd = (lp - lm) / (hi - lo);
				err = Math.abs(fd - mine.grad[names[q]][k]) / (1e-3 + Math.abs(fd));
				if (!(err <= fdWorst)) fdWorst = err;
			}
		}
		worstFd = Math.max(worstFd, fdWorst);
		lines.push(act + ': against the generic network ' + d.toExponential(1) + ', against finite differences ' + fdWorst.toExponential(1));
	});
	check('the trainer\'s loss and gradient equal the generic network\'s on one-hot inputs (5 activations)', worstTwin < 1e-12 && lossGap < 1e-12, 'largest difference ' + worstTwin.toExponential(1));
	check('the trainer\'s gradient matches finite differences (5 activations)', worstFd < 1e-5, 'worst ' + worstFd.toExponential(1));
	lines.forEach(function (l) { info(l); });
})();

section('modular addition: the training loop');
(function () {
	var t = TinyNet.grok({ p: 7, hidden: 8, seed: 9, frac: 0.7, lr: 0.01, wd: 1 }), tw = twin(t), opt = TinyNet.adamw(tw.net, { lr: 0.01, wd: 1, beta1: 0.9, beta2: 0.98, eps: 1e-8 }), i, cache, w, d,
		a, b, c, m1, m2;
	for (i = 0; i < 8; i++) {
		cache = TinyNet.forward(tw.net, tw.X, tw.n);
		opt.step(TinyNet.backward(tw.net, cache, TinyNet.softmaxCE(cache.out, tw.y, tw.n).dOut));
	}
	t.run(8);
	w = t.weights();
	d = Math.max(maxAbsDiff(w.W1a, tw.net.W[0].subarray(0, 56)), maxAbsDiff(w.W1b, tw.net.W[0].subarray(56, 112)), maxAbsDiff(w.W2, tw.net.W[1]));
	check('8 epochs equal 8 full-batch AdamW steps of the generic network', d < 1e-6, 'largest weight difference ' + d.toExponential(1));

	a = TinyNet.grok({ p: 17, hidden: 24, seed: 1 });
	b = TinyNet.grok({ p: 17, hidden: 24, seed: 1 });
	c = TinyNet.grok({ p: 17, hidden: 24, seed: 2 });
	m1 = a.step(40);
	b.step(10); b.step(10); b.run(15); m2 = b.step(5);
	c.step(40);
	check('the same seed gives the same weights bit for bit, however the epochs are chunked', sameWeights(a.weights(), b.weights()) && m1.trainLoss === m2.trainLoss && m1.testAcc === m2.testAcc && m1.epoch === 40 && m2.epoch === 40);
	check('another seed gives other weights', !sameWeights(a.weights(), c.weights()));
	(function () {
		var x = TinyNet.grok({ p: 17, hidden: 24, seed: 1, wd: 0.5, lr: 0.02 }), y = TinyNet.grok({ p: 17, hidden: 24, seed: 1 }), now;
		now = y.set({ wd: 0.5, lr: 0.02 });
		x.run(20);
		y.run(20);
		check('set({ lr, wd }) changes the optimiser from the next epoch on', sameWeights(x.weights(), y.weights()) && now.wd === 0.5 && now.lr === 0.02 && y.cfg.wd === 0.5 && now.beta2 === 0.98 &&
			/only lr, wd/.test(throws(function () { y.set({ p: 5 }); })) && /lr must be positive/.test(throws(function () { y.set({ lr: 0 }); })));
	})();
	a.reset();
	check('reset() goes back to the seed\'s initial weights and epoch 0', sameWeights(a.weights(), TinyNet.grok({ p: 17, hidden: 24, seed: 1 }).weights()) && a.epoch === 0 && a.metrics().epoch === 0);
	a.step(40);
	check('and training again from there repeats the run', sameWeights(a.weights(), b.weights()));
	check('norms() are the Frobenius norms', (function () { var n = a.norms(), ww = a.weights(), s = 0, k; for (k = 0; k < ww.W2.length; k++) s += ww.W2[k] * ww.W2[k]; return Math.abs(n.W2 - Math.sqrt(s)) < 1e-9 && Math.abs(n.total - Math.sqrt(n.W1a * n.W1a + n.W1b * n.W1b + n.W2 * n.W2)) < 1e-9; })());
	check('table() agrees with metrics()', (function () { var tb = a.table(), m = a.metrics(), okTrain = 0, okTest = 0, k, p = 17; for (k = 0; k < p * p; k++) { if (tb.pred[k] === (Math.floor(k / p) + k % p) % p) { if (tb.isTrain[k]) okTrain++; else okTest++; } } return Math.abs(okTrain / a.nTrain - m.trainAcc) < 1e-12 && Math.abs(okTest / a.nTest - m.testAcc) < 1e-12; })());
})();

// ---------------------------------------------------------------- grokking

var E = 1500; // the standard run: every snapshot in snapshots.js is this long
var MEMO_EPOCH = 100; // the "memorised, not yet generalised" snapshot
var snaps = null;
(function () {
	var file = path.join(__dirname, 'snapshots.js'), sandbox;
	if (!fs.existsSync(file)) return;
	sandbox = { window: {} };
	vm.runInNewContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: 'snapshots.js' });
	snaps = sandbox.window.TINYNET_SNAPSHOTS || null;
})();

function curveOf(t, epochs, capture) {
	var curve = { epoch: [0], trainLoss: [], trainAcc: [], testLoss: [], testAcc: [] }, m = t.metrics(), e;
	function push(mm) {
		curve.trainLoss.push(mm.trainLoss);
		curve.trainAcc.push(mm.trainAcc);
		curve.testLoss.push(mm.testLoss);
		curve.testAcc.push(mm.testAcc);
	}
	push(m);
	for (e = 10; e <= epochs; e += 10) {
		m = t.step(10);
		curve.epoch.push(m.epoch);
		push(m);
		if (capture) capture(m);
	}
	return curve;
}

function firstEpoch(curve, key, level) {
	var i;
	for (i = 0; i < curve.epoch.length; i++) if (curve[key][i] >= level) return curve.epoch[i];
	return -1;
}

// ---------------------------------------------------------------- long runs
//
// One long run: { kind: 'train', cfg, epochs } is a training run with its curve;
// { kind: 'retrain', cfg, weights, epoch, forget, epochs, every } is unlearn({ method: 'retrain' }) on a
// trainer put in a trained state first. Returns plain data, so it can come back from another thread.
function longRun(task) {
	var t0 = Date.now(), t = TinyNet.grok(task.cfg), out = {};
	if (task.kind === 'train') {
		out.curve = curveOf(t, task.epochs, null);
	} else {
		t.load(task.weights, { epoch: task.epoch });
		out.result = t.unlearn({ method: 'retrain', forget: task.forget, steps: task.epochs, every: task.every });
	}
	out.epoch = t.epoch;
	out.weights = t.weights();
	out.seconds = (Date.now() - t0) / 1000;
	return out;
}

var useThreads = !!threads && process.env.TINYNET_TEST_THREADS !== '0';

// startLong(task) -> wait(): starts the run in a worker thread and returns a function that blocks until
// its result is here. Without threads the run happens inside wait() instead. The trainer is deterministic,
// so where a run happens changes nothing in its result; only the seconds differ.
function startLong(task) {
	var done = null, shared, channel, worker;
	function here() {
		return done || (done = longRun(task));
	}
	if (!useThreads) return here;
	try {
		shared = new Int32Array(new SharedArrayBuffer(4));
		channel = new threads.MessageChannel();
		worker = new threads.Worker(__filename, { workerData: { tinynetLongRun: true, task: task, port: channel.port2, shared: shared }, transferList: [channel.port2] });
		worker.unref();
	} catch (err) {
		return here;
	}
	return function () {
		var got;
		if (done) return done;
		// This thread has nothing else to do, so it sleeps until the worker says it has posted.
		Atomics.wait(shared, 0, 0, 240000);
		got = threads.receiveMessageOnPort(channel.port1);
		channel.port1.close();
		if (got && got.message && !got.message.error) {
			done = got.message;
			done.where = 'in another thread';
		} else {
			info('a worker thread did not deliver (' + (got && got.message ? got.message.error : 'no answer in 240 s') + '); doing that run here instead');
			done = longRun(task);
		}
		return done;
	};
}

var A = TinyNet.grok({}), curveA, memoWeights = null, purity0, purityEnd, baseA, secondsA;
var cfgZ = { wd: 0 }, cfgB = { seed: 2, splitSeed: 1 };
var waitZ = startLong({ kind: 'train', cfg: cfgZ, epochs: E });
var waitB = startLong({ kind: 'train', cfg: cfgB, epochs: E });
var waitRetrain = null;

// The forget sets of the unlearning section: 40 random training pairs, and every pair that contains 17.
// (Which pairs are training pairs is fixed by the seed, before any training.)
var trainPairs = [], forget40, seventeen = [];
(function () {
	var tb = A.table(), i;
	for (i = 0; i < 41 * 41; i++) if (tb.isTrain[i]) trainPairs.push([Math.floor(i / 41), i % 41]);
	forget40 = TinyNet.rng('forget').shuffle(trainPairs.slice()).slice(0, 40);
	for (i = 0; i < 41; i++) {
		seventeen.push([17, i]);
		if (i !== 17) seventeen.push([i, 17]);
	}
})();

section('grokking with the default settings (p 41, hidden 128, relu, 60%, lr 0.01, wd 1, seed 1), ' + E + ' epochs');
(function () {
	var t0 = Date.now(), memo, t50, t99, atMemo, last, i;
	info(useThreads ? 'two more long runs (no weight decay; the second seed) are training in worker threads meanwhile' : 'worker threads are off: every long run trains in this thread, one after the other');
	purity0 = A.spectrum().mean;
	curveA = curveOf(A, E, function (m) {
		if (m.epoch === MEMO_EPOCH) memoWeights = A.weights();
	});
	secondsA = (Date.now() - t0) / 1000;
	purityEnd = A.spectrum().mean;
	baseA = A.weights();
	// The exact-unlearning baseline is a fourth whole training run. It can start now and is looked at in the unlearning section.
	waitRetrain = startLong({ kind: 'retrain', cfg: {}, weights: baseA, epoch: E, forget: forget40, epochs: E, every: 50 });
	memo = firstEpoch(curveA, 'trainAcc', 1);
	t50 = firstEpoch(curveA, 'testAcc', 0.5);
	t99 = firstEpoch(curveA, 'testAcc', 0.99);
	i = curveA.epoch.indexOf(memo);
	atMemo = i >= 0 ? curveA.testAcc[i] : NaN;
	last = curveA.epoch.length - 1;
	info(E + ' epochs in ' + secondsA.toFixed(1) + ' s = ' + (E / secondsA).toFixed(0) + ' epochs per second here (the curve is evaluated every 10 epochs)');
	info('train accuracy 100% from epoch ' + memo + ' (test accuracy then ' + pct(atMemo) + '); test accuracy 50% at epoch ' + t50 + ', 99% at epoch ' + t99);
	info('at epoch ' + E + ': train loss ' + curveA.trainLoss[last].toExponential(2) + ', test loss ' + curveA.testLoss[last].toFixed(4) + ', test accuracy ' + pct(curveA.testAcc[last]));
	info('mean spectral purity of the hidden units: ' + purity0.toFixed(3) + ' at the start, ' + purityEnd.toFixed(3) + ' at the end');
	check('train accuracy saturates early (100% by epoch 200)', memo > 0 && memo <= 200, 'epoch ' + memo);
	check('the network has only memorised at that point (test accuracy under 10%)', atMemo < 0.1, pct(atMemo));
	check('test accuracy passes 99% much later (at least 5 times later)', t99 > 0 && t99 >= 5 * memo, 'epoch ' + t99 + ' against ' + memo);
	check('and it is still at 99% or more at the end', curveA.testAcc[last] >= 0.99, pct(curveA.testAcc[last]));
	check('spectral purity rises: each unit\'s response over a becomes one sinusoid', purity0 < 0.3 && purityEnd > 0.75, purity0.toFixed(3) + ' -> ' + purityEnd.toFixed(3));
})();

section('spectrum of the grokked network');
(function () {
	var s = A.spectrum(), sb = A.spectrum({ of: 'b' }), so = A.spectrum({ of: 'out' }), i, okShape, sum = 0, agreeB = 0, agreeOut = 0, w = A.weights(), j, a, re = 0, im = 0, used = 0, K = 20, synth, sp;
	okShape = s.freq.length === 128 && s.purity.length === 128 && s.counts.length === K + 1 && s.power.length === K + 1 && s.K === K;
	for (i = 0; i <= K; i++) { sum += s.power[i]; if (s.counts[i] > 0) used++; }
	for (i = 0; i < 128; i++) {
		if (s.freq[i] === sb.freq[i]) agreeB++;
		if (s.freq[i] === so.freq[i]) agreeOut++;
	}
	check('one frequency and one purity per hidden unit; power shares add up to 1', okShape && Math.abs(sum - 1) < 1e-5 && s.counts[0] === 0);
	// the reported frequency and amplitude describe the real column: project unit 0 on its own sinusoid
	j = 0;
	for (a = 0; a < 41; a++) {
		re += w.W1a[a * 128 + j] * Math.cos(2 * Math.PI * s.freq[j] * a / 41);
		im -= w.W1a[a * 128 + j] * Math.sin(2 * Math.PI * s.freq[j] * a / 41);
	}
	check('amp and phase are those of the dominant sinusoid', Math.abs(s.amp[j] - 2 * Math.sqrt(re * re + im * im) / 41) < 1e-5 && Math.abs(s.phase[j] - Math.atan2(im, re)) < 1e-5);
	// a pure synthetic sinusoid has purity 1 at its own frequency
	synth = TinyNet.grok({ p: 41, hidden: 4, seed: 1 });
	sp = synth.weights();
	for (a = 0; a < 41; a++) for (j = 0; j < 4; j++) sp.W1a[a * 4 + j] = 0.3 + Math.cos(2 * Math.PI * (j + 3) * a / 41 + j);
	synth.load(sp);
	sp = synth.spectrum();
	check('a column that is exactly cos(2 pi k a / p + phase) plus a constant has purity 1 at k, amp 1 and that phase', sameArray(sp.freq, [3, 4, 5, 6]) && sp.purity.every(function (x) { return x > 0.99999; }) && sp.amp.every(function (x) { return Math.abs(x - 1) < 1e-5; }) && sp.dc[0] > 0.1 &&
		[0, 1, 2, 3].every(function (ph, q) { var d = sp.phase[q] - ph; d -= 2 * Math.PI * Math.round(d / (2 * Math.PI)); return Math.abs(d) < 1e-5; }), 'phases ' + Array.from(sp.phase).map(function (x) { return x.toFixed(3); }).join(', '));
	info('units per dominant frequency k = 1..20: ' + Array.from(s.counts).slice(1).join(' ') + '  (' + used + ' of 20 frequencies in use)');
	info('a unit\'s frequency over a is also its frequency over b for ' + agreeB + ' of 128 units, and of its output weights for ' + agreeOut + ' of 128');
	info('mean purity over a ' + s.mean.toFixed(3) + ', over b ' + sb.mean.toFixed(3) + ', of output weights ' + so.mean.toFixed(3));
	check('most units use the same frequency for a, for b and for their output', agreeB >= 96 && agreeOut >= 96);
})();

var Z, curveZ;

section('no grokking without weight decay (same seed, same ' + E + ' epochs)');
(function () {
	var run = waitZ(), last, maxTest = 0, i, pz;
	curveZ = run.curve;
	Z = TinyNet.restore({ cfg: cfgZ, epoch: run.epoch, weights: run.weights });
	last = curveZ.epoch.length - 1;
	for (i = 0; i <= last; i++) maxTest = Math.max(maxTest, curveZ.testAcc[i]);
	pz = Z.spectrum().mean;
	info(E + ' epochs in ' + run.seconds.toFixed(1) + ' s' + (run.where ? ' ' + run.where : '') + '; train accuracy ' + pct(curveZ.trainAcc[last]) + ', test accuracy ' + pct(curveZ.testAcc[last]) + ' (highest seen ' + pct(maxTest) + '; chance is ' + pct(1 / 41) + '), test loss ' + curveZ.testLoss[last].toFixed(2));
	info('mean spectral purity ' + pz.toFixed(3) + '; weight norm ' + Z.norms().total.toFixed(1) + ' against ' + A.norms().total.toFixed(1) + ' with weight decay');
	check('it memorises the training pairs', curveZ.trainAcc[last] === 1);
	check('test accuracy never gets anywhere (under 10% at every checkpoint)', maxTest < 0.1, 'highest ' + pct(maxTest));
	check('and the units stay far from single sinusoids', pz < 0.6, pz.toFixed(3));
})();

// ---------------------------------------------------------------- unlearning

function setsLine(s) {
	return 'forget ' + Math.round(s.forget.acc * s.forget.n) + ' of ' + s.forget.n + ' (loss ' + s.forget.loss.toFixed(3) + '), retain ' + pct(s.retain.acc) + ', test ' + pct(s.test.acc);
}

section('unlearning 40 training pairs of the grokked network');
(function () {
	var r, r2, r3, rr, w, i, ok, init, decay, worst, moved, k, rj, job;

	r = A.unlearn({ method: 'ascent', forget: forget40 });
	info('ascent, 30 steps at 0.003:  before ' + setsLine(r.before));
	info('                            after  ' + setsLine(r.after));
	check('ascent: counts and bookkeeping', r.counts.forget === 40 && r.counts.forgetInTrain === 40 && r.counts.retain === A.nTrain - 40 && r.counts.test === A.nTest && r.steps === 30 && r.curve.length === 31 && r.method === 'ascent' && r.rule === 'adam' && A.epoch === E && r.stopped === false);
	check('ascent: the forget pairs were all right before', r.before.forget.acc === 1 && r.before.retain.acc === 1);
	check('ascent: the loss on the forget pairs goes up, step after step', r.after.forget.loss > 1000 * r.before.forget.loss && r.curve.every(function (c, q) { return q === 0 || c.forget.loss > r.curve[q - 1].forget.loss; }));
	check('ascent: the network now gets some forget pairs wrong', r.after.forget.acc < 0.9, pct(r.after.forget.acc));
	check('ascent: test accuracy pays for it', r.after.test.acc < r.before.test.acc, pct(r.before.test.acc) + ' -> ' + pct(r.after.test.acc));

	r2 = A.unlearn({ method: 'finetune', forget: forget40, steps: 5 });
	info('then finetune, 5 epochs on the retain set only:  ' + setsLine(r2.after));
	check('finetune after ascent: 5 epochs counted, retain set still perfect', A.epoch === E + 5 && r2.after.retain.acc === 1 && r2.steps === 5 && r2.curve.length === 6);
	check('finetune after ascent: the forgotten pairs come back although they were not trained on', r2.after.forget.acc > r.after.forget.acc, pct(r.after.forget.acc) + ' -> ' + pct(r2.after.forget.acc));

	A.load(baseA, { epoch: E });
	r3 = A.unlearn({ method: 'ascent', rule: 'sgd', lr: 1, forget: forget40, steps: 100, every: 100 });
	info('plain gradient ascent (w += 1.0 * gradient), 100 steps:  ' + setsLine(r3.after) + '  (the gradient at a loss of ' + r3.before.forget.loss.toExponential(1) + ' is too small to move it)');
	check('ascent with rule "sgd" runs and reports its rule', r3.rule === 'sgd' && r3.steps === 100 && r3.after.forget.loss >= r3.before.forget.loss);

	// finetune trains on the retain set and on nothing else: take every pair with a 17 out, and the
	// rows of 17 in both tables see no gradient, so they only decay by (1 - lr * wd) per epoch.
	A.load(baseA, { epoch: E });
	A.unlearn({ method: 'finetune', forget: seventeen, steps: 3 });
	w = A.weights();
	worst = 0;
	moved = 0;
	decay = Math.pow(1 - 0.01 * 1, 3);
	for (i = 0; i < 128; i++) {
		worst = Math.max(worst, Math.abs(w.W1a[17 * 128 + i] - baseA.W1a[17 * 128 + i] * decay), Math.abs(w.W1b[17 * 128 + i] - baseA.W1b[17 * 128 + i] * decay));
		moved = Math.max(moved, Math.abs(w.W1a[18 * 128 + i] - baseA.W1a[18 * 128 + i] * decay));
	}
	check('finetune: with every pair containing 17 held out, the rows of 17 only decay; other rows also learn', worst < 1e-6 && moved > 1e-4, 'largest deviation from pure decay ' + worst.toExponential(1) + ' (row 18: ' + moved.toExponential(1) + ')');

	// retrain = a fresh network from the same seed on the retain set: exact unlearning.
	// unlearn({ method: 'retrain', forget: forget40, steps: E, every: 50 }) on a trainer loaded with baseA at epoch E.
	A.load(baseA, { epoch: E });
	rr = waitRetrain();
	r = rr.result;
	info('retrain from the same seed without the 40 pairs, ' + E + ' epochs (' + rr.seconds.toFixed(1) + ' s' + (rr.where ? ' ' + rr.where : '') + '):  ' + setsLine(r.after));
	check('retrain: it began from the grokked network it was asked to replace', r.before.forget.acc === 1 && r.before.test.acc === A.metrics().testAcc && r.counts.forget === 40 && r.counts.retain === A.nTrain - 40);
	check('retrain: a full run on the retain set, epoch counter restarted', rr.epoch === E && r.epoch === E && r.steps === E && r.after.retain.acc === 1 && r.curve[0].step === 0 && r.curve.length === E / 50 + 1 && !sameWeights(rr.weights, baseA));
	check('retrain: it starts from the seed\'s initial weights', (function () { var f = TinyNet.grok({}); return Math.abs(r.curve[0].retain.loss - f.evalOn(trainPairs.filter(function (pr) { return !forget40.some(function (q) { return q[0] === pr[0] && q[1] === pr[1]; }); })).loss) < 1e-12; })());
	check('retrain: the network never trained on the 40 pairs and still answers most of them (it learned the rule)', r.after.forget.acc >= 0.9, Math.round(r.after.forget.acc * 40) + ' of 40');

	A.load(baseA, { epoch: E });
	job = A.unlearnJob({ method: 'retrain', forget: seventeen, steps: 300, every: 100 });
	k = 0;
	while (!job.done) { job.step(37); k++; }
	rj = job.result;
	init = TinyNet.grok({}).weights();
	w = A.weights();
	decay = Math.pow(0.99, 300);
	worst = 0;
	for (i = 0; i < 128; i++) worst = Math.max(worst, Math.abs(w.W1a[17 * 128 + i] / (init.W1a[17 * 128 + i] * decay) - 1), Math.abs(w.W1b[17 * 128 + i] / (init.W1b[17 * 128 + i] * decay) - 1));
	info('retrain without every pair containing 17, 300 epochs in chunks of 37:  ' + setsLine(rj.after) + '  (' + rj.counts.forgetInTrain + ' of the 81 were training pairs)');
	check('retrain as a job in chunks: the rows of 17 are the initial rows times 0.99^300, so 17 was never seen', worst < 1e-3 && k === 9 && rj.steps === 300 && rj.counts.forget === 81 && A.epoch === 300, 'largest relative deviation ' + worst.toExponential(1));
	check('retrain without 17: almost nothing with a 17 in it is answered', rj.after.forget.acc <= 0.1, Math.round(rj.after.forget.acc * 81) + ' of 81');
	ok = /method must be/.test(throws(function () { A.unlearn({ method: 'scrub', forget: forget40 }); })) && /at least one/.test(throws(function () { A.unlearn({ method: 'ascent', forget: [] }); })) &&
		/out of range/.test(throws(function () { A.unlearn({ method: 'ascent', forget: [[41, 0]] }); }));
	check('bad requests are refused in plain words', ok);
	A.load(baseA, { epoch: E });
	job = A.unlearnJob({ method: 'ascent', forget: forget40, steps: 30 });
	job.step(10);
	job.stop();
	check('a job can be stopped early', job.done && job.result.stopped === true && job.result.steps === 10 && job.result.curve.length === 11);
	A.load(baseA, { epoch: E });
})();

// ---------------------------------------------------------------- merging

var B, curveB;

section('merging two networks trained from different seeds on the same pairs');
(function () {
	var run = waitB(), t0, wB, naive, aligned, seen, i, okPerm = true, permLoss, alphas = [0, 0.25, 0.5, 0.75, 1], c1, c2, zero, one, ms;
	curveB = run.curve;
	B = TinyNet.restore({ cfg: cfgB, epoch: run.epoch, weights: run.weights });
	info('second network (seed 2, the split of seed 1): ' + E + ' epochs in ' + run.seconds.toFixed(1) + ' s' + (run.where ? ' ' + run.where : '') + ', test accuracy ' + pct(B.metrics().testAcc) + ', 99% at epoch ' + firstEpoch(curveB, 'testAcc', 0.99));
	wB = B.weights();
	naive = A.merge(wB, { alpha: 0.5 });
	aligned = A.merge(wB, { align: true, alpha: 0.5 });
	t0 = process.hrtime.bigint();
	for (i = 0; i < 10; i++) A.matchUnits(wB);
	ms = Number(process.hrtime.bigint() - t0) / 1e6 / 10;
	info('plain average of the weights:        train ' + pct(naive.trainAcc) + ', test ' + pct(naive.testAcc) + ', test loss ' + naive.testLoss.toFixed(3));
	info('average after permutation alignment: train ' + pct(aligned.trainAcc) + ', test ' + pct(aligned.testAcc) + ', test loss ' + aligned.testLoss.toFixed(3));
	info('matching 128 units (similarity matrix + Hungarian): ' + ms.toFixed(1) + ' ms');
	check('naive merging is bad: the plain average loses most of its test accuracy', naive.testAcc < 0.6, pct(naive.testAcc));
	check('aligned merging is good: over 90% test accuracy', aligned.testAcc > 0.9, pct(aligned.testAcc));
	seen = new Uint8Array(128);
	for (i = 0; i < 128; i++) {
		if (aligned.match[i] < 0 || aligned.match[i] >= 128 || seen[aligned.match[i]]) okPerm = false;
		seen[aligned.match[i]] = 1;
		if (aligned.sign[i] !== 1 || naive.match[i] !== i) okPerm = false;
	}
	check('match is a permutation of the hidden units (the identity without align)', okPerm);
	permLoss = A.lossAt(aligned.other, 'all');
	check('the permuted network is the same function as the original', Math.abs(permLoss.loss - A.lossAt(wB, 'all').loss) < 1e-9 && permLoss.acc === A.lossAt(wB, 'all').acc);
	c1 = A.merge(wB, { alphas: alphas }).curve;
	c2 = A.merge(wB, { align: true, alphas: alphas }).curve;
	info('test accuracy at alpha 0, 0.25, 0.5, 0.75, 1:  plain ' + c1.map(function (c) { return pct(c.testAcc); }).join(' ') + '   aligned ' + c2.map(function (c) { return pct(c.testAcc); }).join(' '));
	zero = A.merge(wB, { align: true, alpha: 0 });
	one = A.merge(wB, { align: true, alpha: 1 });
	check('alpha 0 is this network, alpha 1 the (permuted) other one; the curve has one row per alpha', sameWeights(zero.weights, baseA) && sameWeights(one.weights, one.other) && c1.length === 5 && c1[0].testAcc === A.metrics().testAcc && Math.abs(c2[4].testAcc - B.metrics().testAcc) < 1e-12 && c1[2].testAcc === naive.testAcc);
	check('merge leaves the trainer\'s own weights alone', sameWeights(A.weights(), baseA));
	(function () {
		var m = A.merge(wB, { align: true, similarity: true }), sim = m.similarity, matched = 0, diagonal = 0, sameFreq = 0, sa = A.spectrum(), sb = TinyNet.restore({ cfg: B.cfg, epoch: E, weights: TinyNet.encodeWeights(m.other) }).spectrum(), k;
		for (k = 0; k < 128; k++) {
			matched += sim[k * 128 + m.match[k]];
			diagonal += sim[k * 128 + k];
			if (sa.freq[k] === sb.freq[k]) sameFreq++;
		}
		info('summed similarity of unit pairs: ' + diagonal.toFixed(1) + ' as the units come, ' + matched.toFixed(1) + ' after matching; ' + sameFreq + ' of 128 matched pairs share their dominant frequency');
		check('similarity: true returns the 128 by 128 matrix the assignment maximised', sim instanceof Float32Array && sim.length === 128 * 128 && matched > diagonal && A.merge(wB, { align: true }).similarity === null);
	})();
})();

section('alignment undoes a known shuffle (with the sign symmetries of square and tanh)');
(function () {
	['relu', 'square', 'tanh'].forEach(function (act) {
		var t = TinyNet.grok({ p: 11, hidden: 12, act: act, seed: 21 }), w, perm = [], sign = [], r = TinyNet.rng('perm-' + act), i, a, c, shuffled, m, ok = true, merged, h = 12, p = 11;
		t.run(30);
		w = t.weights();
		for (i = 0; i < h; i++) { perm.push(i); sign.push(act === 'relu' ? 1 : (r() < 0.5 ? -1 : 1)); }
		r.shuffle(perm);
		// unit i of the original becomes unit perm[i] of the shuffled copy, with its sign flipped where the activation allows
		shuffled = { W1a: new Float32Array(p * h), W1b: new Float32Array(p * h), W2: new Float32Array(h * p) };
		for (i = 0; i < h; i++) {
			for (a = 0; a < p; a++) {
				shuffled.W1a[a * h + perm[i]] = sign[i] * w.W1a[a * h + i];
				shuffled.W1b[a * h + perm[i]] = sign[i] * w.W1b[a * h + i];
			}
			for (c = 0; c < p; c++) shuffled.W2[perm[i] * p + c] = (act === 'tanh' ? sign[i] : 1) * w.W2[i * p + c];
		}
		m = t.matchUnits(shuffled);
		for (i = 0; i < h; i++) if (m.match[i] !== perm[i] || m.sign[i] !== sign[i]) ok = false;
		merged = t.merge(shuffled, { align: true, alpha: 0.5 });
		check(act + ': a shuffled' + (act === 'relu' ? '' : ' and sign-flipped') + ' copy is the same function, is matched back exactly, and merges into the original',
			Math.abs(t.lossAt(shuffled, 'all').loss - t.lossAt(null, 'all').loss) < 1e-9 && ok && maxAbsDiff(merged.weights.W1a, w.W1a) < 1e-7 && maxAbsDiff(merged.weights.W2, w.W2) < 1e-7);
	});
})();

// ---------------------------------------------------------------- attribution

section('attribution by gradient similarity');
(function () {
	var p = 41, tb = A.table(), queries = [[3, 5], [17, 30], [0, 0], [20, 21]], okSelf = true, okZero = true, okBound = true, okSum = true, okParts = true, worstDirect = 0, r = TinyNet.rng('influence'), small, sw, q, t, gq, gt, dot, eta, w2, k, names = ['W1a', 'W1b', 'W2'], pred, real, worstFirst = 0, n;

	function norm2(g) { var s = 0, i; for (i = 0; i < g.W1a.length; i++) s += g.W1a[i] * g.W1a[i] + g.W1b[i] * g.W1b[i] + g.W2[i] * g.W2[i]; return s; }
	function dotOf(g1, g2) { var s = 0, i; for (i = 0; i < g1.W1a.length; i++) s += g1.W1a[i] * g2.W1a[i] + g1.W1b[i] * g2.W1b[i] + g1.W2[i] * g2.W2[i]; return s; }
	function relation(qi, ti) { var qa = Math.floor(qi / p), qb = qi % p, ta = Math.floor(ti / p), tb2 = ti % p; return (qa + qb) % p === (ta + tb2) % p ? 'same sum' : qa === ta ? 'same a' : qb === tb2 ? 'same b' : 'other'; }

	queries.forEach(function (query) {
		var qi = query[0] * p + query[1], cos = A.influence(query), parts = A.influence(query, { parts: true }), dots = A.influence(query, { kind: 'dot' }), order = [], i, means = { 'same sum': [0, 0], 'same a': [0, 0], 'same b': [0, 0], other: [0, 0] }, rel, gQuery = A.gradAt(null, [query]).grad, picks, gT, direct, positive = 0, others;
		for (i = 0; i < p * p; i++) {
			if (!tb.isTrain[i]) { if (cos[i] !== 0 || dots[i] !== 0) okZero = false; continue; }
			order.push(i);
			if (Math.abs(cos[i]) > 1 + 1e-6) okBound = false;
			if (Math.abs(parts.out[i] + parts.a[i] + parts.b[i] - parts.total[i]) > 1e-6 || parts.total[i] !== cos[i]) okParts = false;
			if (cos[i] > 0) positive++;
			if (i !== qi) {
				rel = relation(qi, i);
				means[rel][0] += cos[i];
				means[rel][1]++;
			}
		}
		order.sort(function (x, y) { return cos[y] - cos[x]; });
		if (tb.isTrain[qi] && (order[0] !== qi || Math.abs(cos[qi] - 1) > 1e-6)) okSelf = false;
		// the closed form against the gradients themselves, for a few training pairs
		picks = [order[0], order[1], order[order.length - 1], order[r.int(order.length)], order[r.int(order.length)]];
		picks.forEach(function (ti) {
			gT = A.gradAt(null, [[Math.floor(ti / p), ti % p]]).grad;
			direct = dotOf(gT, gQuery);
			worstDirect = Math.max(worstDirect, Math.abs(dots[ti] - direct) / (1e-30 + Math.abs(direct)), Math.abs(cos[ti] - direct / Math.sqrt(norm2(gT) * norm2(gQuery))));
		});
		others = (means['same a'][0] + means['same b'][0] + means.other[0]) / (means['same a'][1] + means['same b'][1] + means.other[1]);
		if (!(means['same sum'][0] / means['same sum'][1] > others + 0.05)) okSum = false;
		info('query (' + query.join(', ') + '), ' + (tb.isTrain[qi] ? 'a training pair' : 'a test pair') + ', cosine: ' + positive + ' of ' + order.length + ' training pairs score above zero');
		info('   top: ' + order.slice(0, 6).map(function (i) { return '(' + Math.floor(i / p) + ', ' + i % p + ') ' + cos[i].toFixed(3) + (i === qi ? ' itself' : ' ' + relation(qi, i)); }).join('; '));
		info('   lowest: ' + order.slice(-3).map(function (i) { return '(' + Math.floor(i / p) + ', ' + i % p + ') ' + cos[i].toFixed(3) + ' ' + relation(qi, i); }).join('; '));
		info('   mean by relation to the query: ' + Object.keys(means).map(function (k) { return k + ' ' + (means[k][0] / means[k][1]).toFixed(4) + ' (n = ' + means[k][1] + ')'; }).join(', '));
	});
	check('scores are zero outside the training set', okZero);
	check('cosine scores stay within [-1, 1]', okBound);
	check('a training pair\'s most similar training pair is itself, at cosine 1', okSelf);
	check('the closed form equals the similarity of the two full gradients (dot and cosine)', worstDirect < 1e-5, 'worst difference ' + worstDirect.toExponential(1));
	check('parts (W2, W1a, W1b) add up to the total', okParts);
	check('on the grokked network, pairs with the same answer as the query score higher on average than the rest', okSum);

	// what 'dot' means: the first-order change of the query's loss after one plain gradient step on one training pair
	small = TinyNet.grok({ p: 11, hidden: 16, seed: 8 });
	small.run(5);
	sw = small.weights();
	n = 0;
	[[2, 3], [7, 7], [10, 1]].forEach(function (query) {
		var stb = small.table(), dots = small.influence(query, { kind: 'dot' }), i, done = 0;
		for (i = 0; i < 121 && done < 4; i++) {
			if (!stb.isTrain[i] || Math.abs(dots[i]) < 0.01) continue;
			done++;
			n++;
			gt = small.gradAt(null, [[Math.floor(i / 11), i % 11]]).grad;
			eta = 1e-3;
			w2 = small.weights();
			for (k = 0; k < 3; k++) for (t = 0; t < w2[names[k]].length; t++) w2[names[k]][t] = sw[names[k]][t] - eta * gt[names[k]][t];
			real = small.lossAt(w2, [query]).loss - small.lossAt(sw, [query]).loss;
			pred = -eta * dots[i];
			worstFirst = Math.max(worstFirst, Math.abs(real - pred) / Math.abs(pred));
		}
	});
	check('"dot" predicts the change of the query\'s loss after one small gradient step on one training pair', n >= 6 && worstFirst < 0.05, n + ' cases, worst relative error ' + worstFirst.toExponential(1));
	check('a query outside the table is refused', throws(function () { A.influence([41, 0]); }) !== null && throws(function () { A.influence([0, 0], { kind: 'tracin' }); }) !== null);
})();

// ---------------------------------------------------------------- slices

section('loss-landscape slices');
(function () {
	var t = TinyNet.grok({ p: 13, hidden: 24, seed: 3 }), u = TinyNet.grok({ p: 13, hidden: 24, seed: 4, splitSeed: 3 }), v = TinyNet.grok({ p: 13, hidden: 24, seed: 5, splitSeed: 3 }), s, s2, s3, sj, i, finite = true, own, w, pw, d, nw, nd, names = ['W1a', 'W1b', 'W2'], q, okNorm = true, lu, both, g, eps, lp, lm, k, t0, big, mid, sub, wu, wv, dist, far, o2, st;
	t.step(400);
	u.step(400);
	v.step(400);
	own = t.metrics().trainLoss;
	w = t.weights();
	wu = u.weights();
	wv = v.weights();
	s = t.slice({ n: 9, seed: 1 });
	for (i = 0; i < 81; i++) if (!isFinite(s.loss[i]) || !isFinite(s.acc[i])) finite = false;
	mid = 4 * 9 + 4;
	check('random slice: 9 by 9 finite losses, the current loss at the origin', finite && s.loss.length === 81 && s.n === 9 && Math.abs(s.loss[mid] - own) <= 1e-6 * own && s.axes.x[4] === 0 && s.axes.y[4] === 0 && s.axes.x[0] === -1 && s.axes.x[8] === 1 && s.points.self[0] === 0 && s.points.other === null,
		'origin ' + s.loss[mid].toExponential(4) + ', train loss ' + own.toExponential(4));
	check('the origin is the lowest point of a slice around a trained network', (function () { var m = Infinity, k2; for (k2 = 0; k2 < 81; k2++) m = Math.min(m, s.loss[k2]); return m === s.loss[mid]; })());
	// per-matrix normalisation: each direction's part in a matrix has that matrix's norm
	pw = t.planeWeights(1, 0);
	nw = t.norms();
	for (q = 0; q < 3; q++) {
		d = 0;
		for (i = 0; i < w[names[q]].length; i++) d += (pw[names[q]][i] - w[names[q]][i]) * (pw[names[q]][i] - w[names[q]][i]);
		nd = Math.sqrt(d);
		if (Math.abs(nd / nw[names[q]] - 1) > 1e-4) okNorm = false;
	}
	pw = t.planeWeights(0, 1);
	for (q = 0; q < 3; q++) {
		d = 0;
		for (i = 0; i < w[names[q]].length; i++) d += (pw[names[q]][i] - w[names[q]][i]) * (pw[names[q]][i] - w[names[q]][i]);
		if (Math.abs(Math.sqrt(d) / nw[names[q]] - 1) > 1e-4) okNorm = false;
	}
	check('random directions are normalised per matrix: one unit along an axis moves each matrix by its own norm', okNorm && sameWeights(t.planeWeights(0, 0), w));
	check('the same seed gives the same slice, another seed another', sameArray(t.slice({ n: 5, seed: 1 }).loss, t.slice({ n: 5, seed: 1 }).loss) && !sameArray(t.slice({ n: 5, seed: 1 }).loss, t.slice({ n: 5, seed: 2 }).loss));

	s2 = t.slice({ n: 9, toward: wu, which: 'both', seed: 2 });
	lu = t.lossAt(wu, 'train').loss;
	both = t.lossAt(wu, 'test');
	// x runs from -0.5 to 1.5: index 2 is x = 0 (this network), index 6 is x = 1 (the other one); y = 0 is row 4
	check('slice toward another network: this one at (0, 0), the other at (1, 0), with their own losses there', s2.points.other[0] === 1 && s2.points.other[1] === 0 && s2.axes.x[2] === 0 && s2.axes.x[6] === 1 && s2.axes.y[4] === 0 &&
		Math.abs(s2.loss[4 * 9 + 2] - own) <= 1e-6 * own && Math.abs(s2.loss[4 * 9 + 6] - lu) <= 1e-6 * lu && Math.abs(s2.lossTest[4 * 9 + 6] - both.loss) <= 1e-6 * both.loss && Math.abs(s2.accTest[4 * 9 + 6] - both.acc) < 1e-6);
	check('lossAt({ xy }) and planeWeights read the plane of the last slice', Math.abs(t.lossAt({ xy: [1, 0] }, 'train').loss - lu) <= 1e-9 * lu && sameWeights(t.planeWeights(1, 0), wu) && Math.abs(t.lossAt({ xy: [0.5, 0] }, 'train').loss - s2.loss[4 * 9 + 4]) <= 1e-6 * s2.loss[4 * 9 + 4]);
	// the second axis has, matrix by matrix, the length of the first
	pw = t.planeWeights(0, 1);
	okNorm = true;
	for (q = 0; q < 3; q++) {
		d = 0;
		nd = 0;
		for (i = 0; i < w[names[q]].length; i++) {
			d += (pw[names[q]][i] - w[names[q]][i]) * (pw[names[q]][i] - w[names[q]][i]);
			nd += (wu[names[q]][i] - w[names[q]][i]) * (wu[names[q]][i] - w[names[q]][i]);
		}
		if (Math.abs(Math.sqrt(d / nd) - 1) > 1e-4) okNorm = false;
	}
	check('toward: the random second axis has, matrix by matrix, the length of the first', okNorm);

	// gradAt projects the gradient on the plane: compare with finite differences along the axes
	g = t.gradAt({ xy: [0.3, 0.2] }, 'train');
	eps = 1e-3;
	lp = t.lossAt({ xy: [0.3 + eps, 0.2] }, 'train').loss;
	lm = t.lossAt({ xy: [0.3 - eps, 0.2] }, 'train').loss;
	k = (lp - lm) / (2 * eps);
	lp = t.lossAt({ xy: [0.3, 0.2 + eps] }, 'train').loss;
	lm = t.lossAt({ xy: [0.3, 0.2 - eps] }, 'train').loss;
	check('gradAt({ xy }).xy is the slope of the surface along the two axes', Math.abs(g.xy[0] - k) < 0.02 * Math.abs(k) + 1e-6 && Math.abs(g.xy[1] - (lp - lm) / (2 * eps)) < 0.02 * Math.abs((lp - lm) / (2 * eps)) + 1e-6, '[' + g.xy[0].toFixed(4) + ', ' + g.xy[1].toFixed(4) + '] against [' + k.toFixed(4) + ', ' + ((lp - lm) / (2 * eps)).toFixed(4) + ']');

	// three networks in one plane, without distortion
	s3 = t.slice({ n: 5, toward: wu, toward2: wv });
	o2 = s3.points.other2;
	pw = t.planeWeights(o2[0], o2[1]);
	dist = 0;
	far = 0;
	d = 0;
	for (q = 0; q < 3; q++) for (i = 0; i < w[names[q]].length; i++) {
		dist += (wv[names[q]][i] - w[names[q]][i]) * (wv[names[q]][i] - w[names[q]][i]);
		far += (wu[names[q]][i] - w[names[q]][i]) * (wu[names[q]][i] - w[names[q]][i]);
		d = Math.max(d, Math.abs(pw[names[q]][i] - wv[names[q]][i]));
	}
	check('toward2: the third network lies in the plane at points.other2, at its true distance', d < 1e-5 && Math.abs(Math.sqrt(o2[0] * o2[0] + o2[1] * o2[1]) - Math.sqrt(dist / far)) < 1e-6 && Math.abs(t.lossAt({ xy: o2 }, 'train').loss - t.lossAt(wv, 'train').loss) < 1e-6,
		'other2 at (' + o2[0].toFixed(3) + ', ' + o2[1].toFixed(3) + ')');

	sj = t.sliceJob({ n: 9, seed: 1 });
	k = 0;
	while (!sj.done) { sj.step(10); k++; }
	check('a slice job in chunks of 10 points gives the same picture', k === 9 && sameArray(sj.result.loss, s.loss) && sj.result.stopped === false);
	// a job that is still being stepped keeps its own plane when another slice is started
	sj = t.sliceJob({ n: 9, seed: 1 });
	sj.step(30);
	st = t.slice({ n: 5, seed: 99, span: 0.3 });
	while (!sj.done) sj.step(7);
	check('two slice jobs stepped in turn do not disturb each other; lossAt({ xy }) reads the plane of the latest', sameArray(sj.result.loss, s.loss) && Math.abs(t.lossAt({ xy: [st.axes.x[4], st.axes.y[0]] }, 'train').loss - st.loss[4]) < 1e-6 && st.loss[4] !== s.loss[8]);
	st = t.sliceJob({ n: 9, seed: 1 });
	st.step(20);
	st.stop();
	check('a stopped slice keeps what it has and marks the rest NaN', st.result.stopped === true && st.result.done === 20 && st.result.loss[19] === s.loss[19] && st.result.loss[20] !== st.result.loss[20]);
	sub = t.slice({ n: 5, seed: 1, sample: 30 });
	check('sample: a slice over 30 of the pairs', sub.pairs === 30 && s.pairs === t.nTrain && isFinite(sub.loss[12]));
	check('span and center move the window', (function () { var z = t.slice({ n: 3, seed: 1, span: 0.25, center: [0.5, -0.5] }); return z.axes.x[0] === 0.25 && z.axes.x[2] === 0.75 && z.axes.y[1] === -0.5; })());
	check('bad requests are refused', throws(function () { t.slice({ n: 1 }); }) !== null && throws(function () { t.slice({ toward: w }); }) !== null && throws(function () { t.slice({ which: 'validation' }); }) !== null);

	t0 = Date.now();
	big = A.slice({ n: 9, seed: 1 });
	info('default network, 9 by 9 slice on the ' + big.pairs + ' training pairs: ' + (Date.now() - t0) + ' ms = ' + ((Date.now() - t0) / 81).toFixed(1) + ' ms per point; loss ' + big.loss[40].toExponential(2) + ' at the origin, ' + big.loss[36].toFixed(2) + ' one weight-norm away');
	check('default network: the slice is finite and centred on the current loss', Math.abs(big.loss[40] - A.metrics().trainLoss) <= 1e-6 * A.metrics().trainLoss && Array.from(big.loss).every(isFinite));
})();

// ---------------------------------------------------------------- weights in and out

section('weights round trip');
(function () {
	var text = TinyNet.encodeWeights(baseA), back = TinyNet.decodeWeights(text, 41, 128), t, m, mA = A.metrics(), r;
	check('encodeWeights -> decodeWeights gives the same bits', sameWeights(back, baseA), text.length + ' characters for ' + 3 * 41 * 128 + ' weights');
	t = TinyNet.grok({});
	m = t.load(text, { epoch: E });
	check('load takes the base64 text and gives the same network', sameWeights(t.weights(), baseA) && m.testAcc === mA.testAcc && m.trainLoss === mA.trainLoss && m.epoch === E);
	r = TinyNet.restore({ cfg: A.cfg, epoch: E, weights: text });
	check('restore(snapshot) builds a trainer in that state', sameWeights(r.weights(), baseA) && r.epoch === E && r.metrics().testAcc === mA.testAcc);
	t = TinyNet.grok({ weights: baseA, epoch: 7 });
	check('grok({ weights, epoch }) starts from given weights', sameWeights(t.weights(), baseA) && t.epoch === 7);
	check('weights() are copies', (function () { var w = A.weights(); w.W2[0] += 1; return A.weights().W2[0] === baseA.W2[0]; })());
	check('weights of the wrong size are refused', /do not fit/.test(throws(function () { TinyNet.grok({ p: 7, hidden: 4 }).load(baseA); })));
	t = TinyNet.restore({ cfg: A.cfg, epoch: E, weights: text });
	m = t.step(10);
	info('10 more epochs after a load (the optimiser\'s moments restart from zero): test accuracy ' + pct(mA.testAcc) + ' -> ' + pct(m.testAcc) + ', train accuracy ' + pct(m.trainAcc));
	check('training on from loaded weights does not break the network', m.trainAcc === 1 && m.testAcc >= mA.testAcc - 0.01 && m.epoch === E + 10);
})();

// ---------------------------------------------------------------- snapshots

section('snapshots.js');
(function () {
	var bytes, names = ['grokked', 'memorised', 'second', 'noDecay'], r6 = function (x) { return +x.toPrecision(6); }, okCurve;
	if (!snaps) {
		check('snapshots.js is present (build it with: node scripts/build-grok-snapshots.mjs)', false);
		return;
	}
	bytes = fs.statSync(path.join(__dirname, 'snapshots.js')).size;
	check('the file holds the four snapshots and is under 400 KB', names.every(function (n) { return snaps[n] && snaps[n].cfg && typeof snaps[n].weights === 'string' && snaps[n].metrics; }) && bytes < 400 * 1024, (bytes / 1024).toFixed(0) + ' KB');
	check('grokked: the default run at epoch ' + E + ', bit for bit what this test just trained', snaps.grokked.epoch === E && JSON.stringify(snaps.grokked.cfg) === JSON.stringify(A.cfg) && snaps.grokked.weights === TinyNet.encodeWeights(baseA));
	check('memorised: the same run at epoch ' + MEMO_EPOCH + ', bit for bit', snaps.memorised.epoch === MEMO_EPOCH && memoWeights !== null && snaps.memorised.weights === TinyNet.encodeWeights(memoWeights));
	check('second: seed 2 on the split of seed 1, bit for bit', snaps.second.epoch === E && JSON.stringify(snaps.second.cfg) === JSON.stringify(B.cfg) && snaps.second.weights === TinyNet.encodeWeights(B.weights()));
	check('noDecay: weight decay 0, bit for bit', snaps.noDecay.epoch === E && JSON.stringify(snaps.noDecay.cfg) === JSON.stringify(Z.cfg) && snaps.noDecay.weights === TinyNet.encodeWeights(Z.weights()));
	okCurve = ['grokked', 'second', 'noDecay'].every(function (n) {
		var mine = n === 'grokked' ? curveA : n === 'second' ? curveB : curveZ, c = snaps[n].curve;
		return c && c.every === 10 && c.trainLoss.length === E / 10 + 1 && ['trainLoss', 'trainAcc', 'testLoss', 'testAcc'].every(function (key) {
			return c[key].every(function (x, i) { return x === r6(mine[key][i]); });
		});
	});
	check('the curves (every 10 epochs, six significant digits) are those of the runs above', okCurve);
	check('memorised really is memorised and not generalised; grokked is both', snaps.memorised.metrics.trainAcc === 1 && snaps.memorised.metrics.testAcc < 0.1 && snaps.grokked.metrics.testAcc >= 0.99 && snaps.noDecay.metrics.testAcc < 0.1 && snaps.second.metrics.testAcc >= 0.99,
		'test accuracy: memorised ' + pct(snaps.memorised.metrics.testAcc) + ', grokked ' + pct(snaps.grokked.metrics.testAcc) + ', second ' + pct(snaps.second.metrics.testAcc) + ', noDecay ' + pct(snaps.noDecay.metrics.testAcc));
	check('restore(snapshot) reproduces the stored metrics', (function () { var t = TinyNet.restore(snaps.memorised), m = t.metrics(); return m.epoch === MEMO_EPOCH && r6(m.testLoss) === snaps.memorised.metrics.testLoss && m.trainAcc === snaps.memorised.metrics.trainAcc; })());
	// The stored slices: set up the same planes (a job that is never stepped does that) and recompute some points.
	(function () {
		var r4 = function (x) { return +Math.fround(x).toPrecision(4); }, sl = snaps.slices, ok = true, okPlane = true, probes = [[0, 0], [12, 12], [24, 24], [6, 6], [18, 6], [3, 20], [20, 3], [12, 0]], aligned, job, s, q, ix, iy, at;
		if (!sl || !sl.around || !sl.basins) {
			check('the two stored slices are present', false);
			return;
		}
		A.sliceJob({ n: sl.around.n, seed: sl.around.seed, which: 'both' });
		s = sl.around;
		for (q = 0; q < probes.length; q++) {
			ix = probes[q][0];
			iy = probes[q][1];
			at = { xy: [s.x[ix], s.y[iy]] };
			if (r4(A.lossAt(at, 'train').loss) !== s.train[iy * s.n + ix] || r4(A.lossAt(at, 'test').loss) !== s.test[iy * s.n + ix]) ok = false;
		}
		check('slices.around: 25 by 25 train and test losses around grokked, equal to a fresh computation at 8 probed points', ok && s.train.length === 625 && s.test.length === 625 && s.x.length === 25 && s.x[12] === 0 && s.y[12] === 0 &&
			s.train[12 * 25 + 12] === r4(A.metrics().trainLoss) && s.test[12 * 25 + 12] === r4(A.metrics().testLoss));
		aligned = A.merge(B.weights(), { align: true, alpha: 1 }).other;
		job = A.sliceJob({ n: sl.basins.n, toward: B.weights(), toward2: aligned, which: 'both', center: sl.basins.center });
		s = sl.basins;
		ok = true;
		for (q = 0; q < probes.length; q++) {
			ix = probes[q][0];
			iy = probes[q][1];
			at = { xy: [s.x[ix], s.y[iy]] };
			if (r4(A.lossAt(at, 'train').loss) !== s.train[iy * s.n + ix] || r4(A.lossAt(at, 'test').loss) !== s.test[iy * s.n + ix]) ok = false;
		}
		job.stop();
		okPlane = s.x[6] === 0 && s.y[6] === 0 && s.x[18] === 1 && s.points.other[0] === 1 && s.points.other[1] === 0 && s.points.other2.length === 2 &&
			s.train[6 * 25 + 6] === r4(A.metrics().trainLoss) && s.train[6 * 25 + 18] === r4(B.metrics().trainLoss) && s.test[6 * 25 + 18] === r4(A.lossAt(B.weights(), 'test').loss);
		check('slices.basins: grokked at grid (6, 6), second at (18, 6) with their own losses; equal to a fresh computation at 8 probed points', ok && okPlane,
			'second aligned at (' + s.points.other2.map(function (v) { return v.toFixed(3); }).join(', ') + '); train loss half way to second ' + s.train[6 * 25 + 12] + ', half way to second aligned ' + r4(A.lossAt({ xy: [s.points.other2[0] / 2, s.points.other2[1] / 2] }, 'train').loss));
	})();
})();

// ---------------------------------------------------------------- worker.js and client.js, simulated

// A stand-in for the browser: worker.js runs in its own vm context, messages are structured-cloned
// and delivered on later turns of the event loop, transfer lists are honoured.
function makeFakeWorkerClass(log) {
	var workerSrc = fs.readFileSync(path.join(__dirname, 'worker.js'), 'utf8');
	return function FakeWorker(url) {
		var page = this, terminated = false, scope, ctx;
		log.urls.push(url);
		page.onmessage = null;
		page.onerror = null;
		scope = {
			onmessage: null,
			postMessage: function (msg, transfer) {
				var copy = structuredClone(msg, transfer && transfer.length ? { transfer: transfer } : undefined);
				log.fromWorker++;
				setImmediate(function () { if (!terminated && page.onmessage) page.onmessage({ data: copy }); });
			},
			importScripts: function (name) {
				vm.runInContext(fs.readFileSync(path.join(__dirname, name), 'utf8'), ctx, { filename: name });
			},
			MessageChannel: MessageChannel,
			performance: performance,
			setTimeout: setTimeout
		};
		scope.self = scope;
		ctx = vm.createContext(scope);
		page.postMessage = function (msg) {
			var copy = structuredClone(msg);
			setImmediate(function () { if (!terminated && scope.onmessage) scope.onmessage({ data: copy }); });
		};
		page.terminate = function () { terminated = true; };
		if (/missing/.test(url)) {
			setImmediate(function () { if (page.onerror) page.onerror({ message: '', preventDefault: function () {} }); });
			return;
		}
		vm.runInContext(workerSrc, ctx, { filename: 'worker.js' });
	};
}

function loadClient(FakeWorker) {
	var win = {};
	new Function('window', 'Worker', fs.readFileSync(path.join(__dirname, 'client.js'), 'utf8'))(win, FakeWorker);
	return win.TinyNetClient;
}

function workerTests() {
	var log = { urls: [], fromWorker: 0 }, Client = loadClient(makeFakeWorkerClass(log)), net = Client.start('../_tinynet/worker.js'), cfg = { p: 11, hidden: 16, seed: 3, lr: 0.03 }, progress = [], direct = TinyNet.grok(cfg), ready;

	function rejects(promise) {
		return promise.then(function () { return null; }, function (err) { return err; });
	}

	return net.ready.then(function (r) {
		ready = r;
		return net.init(cfg);
	}).then(function (m) {
		check('client: ready resolves with the version; init answers with the metrics at epoch 0', ready.version === TinyNet.version && m.epoch === 0 && m.nTrain === 73 && m.nTest === 48 && m.cfg.p === 11 && m.cfg.wd === 1 && m.params === 3 * 11 * 16 && log.urls[0] === '../_tinynet/worker.js');
		return net.train({ epochs: 65, every: 10, include: { table: true, spectrum: true, norms: true }, onProgress: function (pr) { progress.push(pr); } });
	}).then(function (end) {
		var d = direct.step(65), last = progress[progress.length - 1];
		check('client: train reports at every multiple of "every" and once more at the end', progress.map(function (pr) { return pr.epoch; }).join(',') === '10,20,30,40,50,60,65' && end.epoch === 65 && end.stopped === false && end.reason === 'done' && end.ran === 65 && end.epochsPerSec > 0);
		check('client: progress carries the table, the spectrum and the norms when asked', last.table.pred.length === 121 && last.table.isTrain.length === 121 && last.spectrum.freq.length === 16 && last.norms.total > 0 && end.table === undefined);
		check('client: the worker\'s run equals the same run in this process', end.trainLoss === d.trainLoss && end.testAcc === d.testAcc && last.trainLoss === d.trainLoss);
		return net.weights();
	}).then(function (w) {
		check('client: weights() returns the trained weights, bit for bit', sameWeights(w, direct.weights()) && w.epoch === 65 && w.W1a instanceof Float32Array);
		// a long run: a second job is refused, a quick query is answered, stop ends it
		var seen = [], third, long, second, table, stop;
		return new Promise(function (resolve) {
			long = net.train({ epochs: 1000000, every: 5, onProgress: function (pr) { seen.push(pr.epoch); if (seen.length === 3) resolve(); } });
		}).then(function () {
			third = seen[2];
			second = rejects(net.train({ epochs: 5 }));
			table = net.table();
			stop = net.stop();
			return Promise.all([second, table, stop, long]);
		}).then(function (all) {
			var err = all[0], tb = all[1], st = all[2], end = all[3];
			check('client: a second train while one runs is refused with a sentence', err instanceof Error && /busy with train/.test(err.message) && /busy/.test(err.detail), err && err.message);
			check('client: a query is answered in the middle of a run', tb && tb.pred.length === 121);
			check('client: stop() ends the run; its promise resolves with stopped: true', st.stopped === true && end.stopped === true && end.reason === 'stopped' && end.epoch < 1000000 && end.epoch === seen[seen.length - 1] && net.busy() === false,
				'asked at epoch ' + third + ', stopped at epoch ' + end.epoch);
			return net.stop();
		});
	}).then(function (st) {
		check('client: stop() with nothing running says so', st.stopped === false);
		return net.reset();
	}).then(function (m) {
		check('client: reset() goes back to epoch 0', m.epoch === 0);
		return net.train({ epochs: 5000, every: 10, until: { trainAcc: 1 } });
	}).then(function (end) {
		var t0 = Date.now(), n = 0;
		check('client: until stops the run at the first report that meets it', end.reason === 'until' && end.trainAcc === 1 && end.epoch < 5000 && end.epoch % 10 === 0, 'epoch ' + end.epoch);
		return net.train({ epochs: 40, every: 10, rate: 100, onProgress: function () { n++; } }).then(function (paced) {
			var ms = Date.now() - t0;
			check('client: rate paces a run (40 epochs at 100 per second take about 0.4 s)', ms >= 350 && ms < 2000 && n === 4 && paced.epochsPerSec < 115, ms + ' ms, measured ' + paced.epochsPerSec.toFixed(0) + ' epochs per second');
			return net.train({ epochs: 300 - 40 - end.epoch, every: 100 });
		});
	}).then(function () {
		var steps = [];
		return net.unlearn({ method: 'ascent', forget: [[1, 2], [3, 4], [5, 6]], steps: 12, every: 4, onProgress: function (pr) { steps.push(pr.step); } }).then(function (r) {
			check('client: unlearn reports its curve as it goes and resolves with before and after', steps.join(',') === '4,8,12' && r.method === 'ascent' && r.steps === 12 && r.curve.length === 4 && r.after.forget.loss > r.before.forget.loss && r.counts.forget === 3);
			return net.weights();
		});
	}).then(function (w) {
		var other = TinyNet.grok({ p: 11, hidden: 16, seed: 4, splitSeed: 3, lr: 0.03 }), ticks = 0;
		other.step(300);
		return net.merge(other.weights(), { align: true, alpha: 0.5, alphas: [0, 1] }).then(function (mg) {
			check('client: merge returns weights, match and the curve', mg.weights.W1a.length === 176 && mg.match.length === 16 && mg.curve.length === 2 && mg.align === true && mg.testAcc >= 0);
			return net.influence([1, 2], { kind: 'cos' });
		}).then(function (inf) {
			check('client: influence returns one score per cell', inf instanceof Float32Array && inf.length === 121);
			return net.slice({ n: 7, toward: other.weights(), which: 'both', onProgress: function () { ticks++; } });
		}).then(function (s) {
			check('client: slice returns the grid', s.loss.length === 49 && s.lossTest.length === 49 && s.axes.x.length === 7 && s.points.other[0] === 1 && s.stopped === false && isFinite(s.loss[0]));
			return Promise.all([net.lossAt({ xy: [1, 0] }, 'train'), net.lossAt(other.weights(), 'train'), net.lossAt(null, 'test'), net.metrics(), net.evalOn([[0, 0], [1, 1]]), net.gradAt(null, 'train'), net.planeWeights(1, 0), net.spectrum({ of: 'out' }), net.norms(), net.ping(),
				net.set({ wd: 0.25 }), net.merge(other.weights(), { similarity: true })]);
		}).then(function (all) {
			check('client: lossAt, evalOn, gradAt, planeWeights, spectrum, norms, ping, set answer', Math.abs(all[0].loss - all[1].loss) < 1e-9 && all[2].acc === all[3].testAcc && all[4].n === 2 && all[5].grad.W2.length === 176 && all[5].xy.length === 2 &&
				sameWeights(all[6], other.weights()) && all[7].of === 'out' && all[8].total > 0 && all[9].version === TinyNet.version && all[10].wd === 0.25 && all[10].lr === 0.03 && all[11].similarity.length === 256 && all[11].align === false);
			return net.load(w, { epoch: 300 });
		}).then(function (m) {
			check('client: load puts weights back', m.epoch === 300);
			return net.restore({ cfg: other.cfg, epoch: 300, weights: TinyNet.encodeWeights(other.weights()) });
		}).then(function (m) {
			check('client: restore(snapshot) starts a trainer in a stored state', m.epoch === 300 && m.cfg.seed === 4 && m.testAcc === other.metrics().testAcc);
		});
	}).then(function () {
		return Promise.all([rejects(net.init({ p: 1 })), rejects(net.unlearn({ method: 'scrub', forget: [[0, 0]] })), rejects(net.influence([99, 0]))]);
	}).then(function (errs) {
		check('client: a bad request rejects with a readable message and the technical detail', errs.every(function (e) { return e instanceof Error && typeof e.detail === 'string' && e.detail.length > 0; }) && /p must be an integer/.test(errs[0].message) && !/TinyNet/.test(errs[0].message), errs[0].message);
		return net.metrics();
	}).then(function (m) {
		check('client: the trainer survives a refused request', m.epoch === 300);
		var hang = rejects(net.train({ epochs: 1000000, every: 1000 }));
		net.terminate();
		return Promise.all([hang, rejects(net.metrics())]);
	}).then(function (errs) {
		check('client: terminate() rejects what was waiting and everything after', errs[0] instanceof Error && errs[1] instanceof Error && /shut down/.test(errs[1].message));
		var broken = Client.start('missing-worker.js');
		return Promise.all([rejects(broken.ready), rejects(broken.init({}))]);
	}).then(function (errs) {
		check('client: a worker that cannot load rejects ready and every call, in plain words', errs[0] instanceof Error && errs[1] instanceof Error && /could not be started/.test(errs[1].message));
		var noWorkers = loadClient(undefined).start('worker.js');
		return rejects(noWorkers.init({}));
	}).then(function (err) {
		check('client: a browser without workers gets the same plain failure', err instanceof Error && /could not be started/.test(err.message));
	});
}

section('worker.js and client.js (simulated: a vm context, structured clone, transfers)');
workerTests().then(null, function (err) {
	check('worker and client tests ran to the end', false, String(err && err.stack || err));
}).then(function () {
	var code = failures ? 1 : 0;
	console.log('\n' + (failures ? 'FAILED: ' + failures + ' of ' + (passes + failures) + ' checks' : 'ok: ' + passes + ' checks passed') + ' in ' + ((Date.now() - started) / 1000).toFixed(1) + ' s');
	process.exitCode = code;
	process.stdout.write('', function () { process.exit(code); });
});
