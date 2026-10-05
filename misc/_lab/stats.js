/*
 * LabStats: the statistics of the lab kit (misc/_lab). Pure functions, no DOM.
 *
 * UMD: window.LabStats in a page, module.exports under Node
 * (node misc/_lab/test.js checks every function against answers worked by hand).
 *
 * Every function takes plain arrays of numbers and says in its comment which
 * formula it implements. Anything that is not a finite number (a null, a
 * string, NaN) makes the answer NaN instead of being quietly counted as zero:
 * a timed-out trial has rt null, so filter first with LabStats.finite(list).
 *
 * Random draws (the bootstrap, the Monte Carlo permutation test) come from
 * rng(seed): the same FNV-1a hash and mulberry32 generator as ToyKit.rng, so
 * one seed gives the same numbers everywhere on the site.
 */
(function () {
	'use strict';

	var SQRT_PI = Math.sqrt(Math.PI);
	var Z95 = 1.959963984540054;        // probit(0.975): the z of a two-sided 95% interval

	// ---- Small helpers ----------------------------------------------------------

	function isNum(x) { return typeof x === 'number' && isFinite(x); }
	function list(xs) { return xs == null ? [] : Array.prototype.slice.call(xs); }
	function allNums(xs) {
		for (var i = 0; i < xs.length; i++) if (!isNum(xs[i])) return false;
		return true;
	}
	// finite(list): the finite numbers of a list, in order. Use it to drop the
	// nulls of timed-out trials before asking for a mean or a median.
	function finite(xs) { return list(xs).filter(isNum); }
	function ascending(a, b) { return a - b; }

	// ---- Seeded random numbers (identical to ToyKit.hash and ToyKit.rng) --------

	// hash(str): FNV-1a, 32 bits. h = 2166136261; for each character
	// h = (h XOR code) * 16777619 mod 2^32.
	function hash(str) {
		str = String(str == null ? '' : str);
		var h = 2166136261;
		for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
		return h >>> 0;
	}
	function mulberry32(a) {
		return function () {
			a |= 0; a = (a + 0x6D2B79F5) | 0;
			var t = Math.imul(a ^ (a >>> 15), 1 | a);
			t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
			return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
		};
	}
	// rng(seed) -> next(): a number in [0, 1), mulberry32 seeded with the FNV-1a
	// hash of the seed (a number seeds it directly). next.int(n) is an integer in
	// 0..n-1, next.pick(list) one item, next.shuffle(list) a shuffled copy
	// (Fisher-Yates), next.normal(mean, sd) a normal draw (Box-Muller:
	// mean + sd * sqrt(-2 ln u1) * cos(2 pi u2)).
	function rng(seed) {
		var next = mulberry32(typeof seed === 'number' ? seed >>> 0 : hash(seed));
		next.int = function (n) {
			var r = next();
			return n > 0 ? Math.floor(r * Math.floor(n)) : 0;
		};
		next.pick = function (items) {
			return items && items.length ? items[Math.floor(next() * items.length)] : undefined;
		};
		next.shuffle = function (items) {
			var out = Array.prototype.slice.call(items || []);
			for (var i = out.length - 1; i > 0; i--) {
				var j = Math.floor(next() * (i + 1));
				var t = out[i]; out[i] = out[j]; out[j] = t;
			}
			return out;
		};
		next.normal = function (mean, sd) {
			var u1 = 1 - next(), u2 = next();       // u1 in (0, 1], so the logarithm is finite
			var z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
			return (mean == null ? 0 : +mean) + (sd == null ? 1 : +sd) * z;
		};
		return next;
	}

	// ---- Centre and spread ----------------------------------------------------------

	// sum(x) = x1 + x2 + ... + xn
	function sum(xs) {
		var a = list(xs), s = 0;
		if (!allNums(a)) return NaN;
		for (var i = 0; i < a.length; i++) s += a[i];
		return s;
	}

	// mean(x) = sum(x) / n. NaN for an empty list.
	function mean(xs) {
		var a = list(xs);
		return a.length ? sum(a) / a.length : NaN;
	}

	// variance(x) = sum((xi - mean)^2) / (n - 1): the sample variance (n - 1 in the
	// denominator). NaN for fewer than two values.
	function variance(xs) {
		var a = list(xs), n = a.length;
		if (n < 2 || !allNums(a)) return NaN;
		var m = mean(a), s = 0;
		for (var i = 0; i < n; i++) s += (a[i] - m) * (a[i] - m);
		return s / (n - 1);
	}

	// sd(x) = sqrt(variance(x)): the sample standard deviation.
	function sd(xs) { return Math.sqrt(variance(xs)); }

	// sem(x) = sd(x) / sqrt(n): the standard error of the mean.
	function sem(xs) {
		var n = list(xs).length;
		return n < 2 ? NaN : sd(xs) / Math.sqrt(n);
	}

	// quantile(x, p), 0 <= p <= 1: linear interpolation between order statistics
	// (the default of R and NumPy, "type 7"). With the values sorted as
	// s[0] <= ... <= s[n-1] and h = (n - 1) * p:
	//     q = s[floor(h)] + (h - floor(h)) * (s[floor(h) + 1] - s[floor(h)])
	function quantile(xs, p) {
		var a = list(xs), n = a.length;
		if (!n || !allNums(a) || !(p >= 0 && p <= 1)) return NaN;
		a.sort(ascending);
		var h = (n - 1) * p, lo = Math.floor(h), hi = Math.ceil(h);
		return a[lo] + (h - lo) * (a[hi] - a[lo]);
	}

	// median(x) = quantile(x, 0.5): the middle value, or the mean of the two middle ones.
	function median(xs) { return quantile(xs, 0.5); }

	// ---- Ranks and correlation ------------------------------------------------------

	// rank(x): ranks from 1 (the smallest) to n. Equal values share the mean of the
	// ranks they cover ("average ranks"): [10, 20, 20, 30] -> [1, 2.5, 2.5, 4].
	function rank(xs) {
		var a = list(xs), n = a.length, idx = [], out = new Array(n), i, j, k;
		if (!allNums(a)) return a.map(function () { return NaN; });
		for (i = 0; i < n; i++) idx.push(i);
		idx.sort(function (p, q) { return a[p] - a[q] || p - q; });
		for (i = 0; i < n; i = j) {
			for (j = i + 1; j < n && a[idx[j]] === a[idx[i]]; j++) { /* the run of equal values is idx[i..j-1] */ }
			var r = (i + 1 + j) / 2;                  // the mean of the positions i+1 .. j
			for (k = i; k < j; k++) out[idx[k]] = r;
		}
		return out;
	}

	// pearson(x, y): r = Sxy / sqrt(Sxx * Syy), with Sxy = sum((xi - mx)(yi - my)),
	// Sxx = sum((xi - mx)^2), Syy = sum((yi - my)^2). NaN when either list has no
	// spread, when the lengths differ, or with fewer than two pairs.
	function pearson(xs, ys) {
		var x = list(xs), y = list(ys), n = x.length;
		if (n !== y.length || n < 2 || !allNums(x) || !allNums(y)) return NaN;
		var mx = mean(x), my = mean(y), sxy = 0, sxx = 0, syy = 0;
		for (var i = 0; i < n; i++) {
			var dx = x[i] - mx, dy = y[i] - my;
			sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
		}
		if (sxx === 0 || syy === 0) return NaN;
		var r = sxy / Math.sqrt(sxx * syy);
		return r > 1 ? 1 : r < -1 ? -1 : r;
	}

	// spearman(x, y): rho = pearson(rank(x), rank(y)), with average ranks for ties.
	// (The shortcut 1 - 6 sum(d^2) / (n (n^2 - 1)) is only right without ties, so it
	// is not used.)
	function spearman(xs, ys) {
		var x = list(xs), y = list(ys);
		if (x.length !== y.length || !allNums(x) || !allNums(y)) return NaN;
		return pearson(rank(x), rank(y));
	}

	// linreg(x, y): the least-squares line y = intercept + slope * x.
	//     slope = Sxy / Sxx        intercept = my - slope * mx        r = pearson(x, y)
	// Returns { slope, intercept, r, r2, n, predict(x), residuals } where
	// residuals[i] = y[i] - predict(x[i]).
	function linreg(xs, ys) {
		var x = list(xs), y = list(ys), n = x.length;
		var out = { slope: NaN, intercept: NaN, r: NaN, r2: NaN, n: n, residuals: [], predict: function () { return NaN; } };
		if (n !== y.length || n < 2 || !allNums(x) || !allNums(y)) return out;
		var mx = mean(x), my = mean(y), sxy = 0, sxx = 0, i;
		for (i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) * (x[i] - mx); }
		if (sxx === 0) return out;
		var slope = sxy / sxx, intercept = my - slope * mx;
		out.slope = slope;
		out.intercept = intercept;
		out.r = pearson(x, y);
		out.r2 = out.r * out.r;
		out.predict = function (v) { return intercept + slope * v; };
		for (i = 0; i < n; i++) out.residuals.push(y[i] - (intercept + slope * x[i]));
		return out;
	}

	// ---- The normal distribution ------------------------------------------------------

	// erf(x) for 0 <= x < 3, by the series with only positive terms:
	//     erf(x) = 2 / sqrt(pi) * exp(-x^2) * sum over n >= 0 of 2^n x^(2n+1) / (1 * 3 * 5 * ... * (2n + 1))
	function erfSeries(x) {
		var term = x, total = x, n = 0;
		while (term > total * 1e-17 && n < 300) {
			n++;
			term *= 2 * x * x / (2 * n + 1);
			total += term;
		}
		return 2 / SQRT_PI * Math.exp(-x * x) * total;
	}
	// erfc(x) for x >= 3, by the continued fraction
	//     erfc(x) = exp(-x^2) / sqrt(pi) * 1 / (x + (1/2) / (x + (2/2) / (x + (3/2) / (x + ...))))
	function erfcFraction(x) {
		var t = x;
		for (var k = 60; k >= 1; k--) t = x + (k / 2) / t;
		return Math.exp(-x * x) / (SQRT_PI * t);
	}

	// normCdf(z) = P(Z <= z) for a standard normal Z = (1 + erf(z / sqrt(2))) / 2.
	function normCdf(z) {
		if (typeof z !== 'number' || z !== z) return NaN;
		if (z === Infinity) return 1;
		if (z === -Infinity) return 0;
		var x = Math.abs(z) / Math.SQRT2;
		var tail = x < 3 ? 0.5 * (1 - erfSeries(x)) : 0.5 * erfcFraction(x);     // P(Z > |z|)
		return z > 0 ? 1 - tail : tail;
	}

	// probit(p): the z with normCdf(z) = p, for 0 < p < 1 (the inverse of the
	// standard normal distribution). Wichura's algorithm AS 241 (PPND16, 1988):
	// three rational approximations, one for the middle (|p - 0.5| <= 0.425) and
	// two for the tails in r = sqrt(-ln(min(p, 1 - p))). Accurate to about 1e-16.
	function probit(p) {
		if (typeof p !== 'number' || !(p >= 0 && p <= 1)) return NaN;
		if (p === 0) return -Infinity;
		if (p === 1) return Infinity;
		var q = p - 0.5, r, val;
		if (Math.abs(q) <= 0.425) {
			r = 0.180625 - q * q;
			return q * (((((((2.5090809287301226727e3 * r + 3.3430575583588128105e4) * r + 6.7265770927008700853e4) * r +
				4.5921953931549871457e4) * r + 1.3731693765509461125e4) * r + 1.9715909503065514427e3) * r +
				1.3314166789178437745e2) * r + 3.3871328727963666080e0) /
				(((((((5.2264952788528545610e3 * r + 2.8729085735721942674e4) * r + 3.9307895800092710610e4) * r +
				2.1213794301586595867e4) * r + 5.3941960214247511077e3) * r + 6.8718700749205790830e2) * r +
				4.2313330701600911252e1) * r + 1);
		}
		r = Math.sqrt(-Math.log(q < 0 ? p : 1 - p));
		if (r <= 5) {
			r -= 1.6;
			val = (((((((7.74545014278341407640e-4 * r + 2.27238449892691845833e-2) * r + 2.41780725177450611770e-1) * r +
				1.27045825245236838258e0) * r + 3.64784832476320460504e0) * r + 5.76949722146069140550e0) * r +
				4.63033784615654529590e0) * r + 1.42343711074968357734e0) /
				(((((((1.05075007164441684324e-9 * r + 5.47593808499534494600e-4) * r + 1.51986665636164571966e-2) * r +
				1.48103976427480074590e-1) * r + 6.89767334985100004550e-1) * r + 1.67638483018380384940e0) * r +
				2.05319162663775882187e0) * r + 1);
		} else {
			r -= 5;
			val = (((((((2.01033439929228813265e-7 * r + 2.71155556874348757815e-5) * r + 1.24266094738807843860e-3) * r +
				2.65321895265761230930e-2) * r + 2.96560571828504891230e-1) * r + 1.78482653991729133580e0) * r +
				5.46378491116411436990e0) * r + 6.65790464350110377720e0) /
				(((((((2.04426310338993978564e-15 * r + 1.42151175831644588870e-7) * r + 1.84631831751005468180e-5) * r +
				7.86869131145613259100e-4) * r + 1.48753612908506148525e-2) * r + 1.36929880922735805310e-1) * r +
				5.99832206555887937690e-1) * r + 1);
		}
		return q < 0 ? -val : val;
	}

	// ---- Intervals -----------------------------------------------------------------------

	// wilson(k, n, z): the Wilson score interval for a proportion, k successes in n
	// trials. With p = k / n and z = 1.96 (95%) unless given:
	//     centre = (p + z^2 / (2n)) / (1 + z^2 / n)
	//     half   = z * sqrt(p (1 - p) / n + z^2 / (4 n^2)) / (1 + z^2 / n)
	//     lo = centre - half,   hi = centre + half
	// Unlike p +- z sqrt(p (1 - p) / n) it stays inside [0, 1] and is not empty at
	// k = 0 or k = n. Returns { p, lo, hi, centre, k, n, z }; all NaN when n is 0.
	function wilson(k, n, z) {
		z = isNum(z) && z > 0 ? z : Z95;
		var out = { p: NaN, lo: NaN, hi: NaN, centre: NaN, k: k, n: n, z: z };
		if (!isNum(k) || !isNum(n) || n <= 0 || k < 0 || k > n) return out;
		var p = k / n, z2 = z * z, denom = 1 + z2 / n;
		var centre = (p + z2 / (2 * n)) / denom;
		var half = z * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n)) / denom;
		out.p = p;
		out.centre = centre;
		out.lo = k === 0 ? 0 : Math.max(0, centre - half);
		out.hi = k === n ? 1 : Math.min(1, centre + half);
		return out;
	}

	// bootstrapCI(values, statFn, { n: 2000, seed: 'lab', level: 0.95 }): the
	// percentile bootstrap. Draw n resamples of the values, each as long as the
	// list and drawn with replacement by rng(seed); compute statFn on every one;
	// the interval is from the (1 - level) / 2 quantile to the 1 - (1 - level) / 2
	// quantile of those n statistics. The values may be anything statFn accepts
	// (numbers, or pairs for a correlation). Seeded, so the same call gives the
	// same interval every time.
	// Returns { lo, hi, estimate: statFn(values), se: the sd of the n statistics,
	// level, n, used: how many resamples gave a finite statistic, seed }.
	function bootstrapCI(values, statFn, opts) {
		opts = opts || {};
		var v = list(values), N = v.length;
		var B = opts.n > 0 ? Math.floor(opts.n) : 2000;
		var level = opts.level > 0 && opts.level < 1 ? +opts.level : 0.95;
		var seed = opts.seed == null ? 'lab' : opts.seed;
		var fn = typeof statFn === 'function' ? statFn : mean;
		var out = { lo: NaN, hi: NaN, estimate: N ? fn(v.slice()) : NaN, se: NaN, level: level, n: B, used: 0, seed: seed };
		if (N < 2) return out;
		var next = rng(seed), stats = [], sample = new Array(N), b, i, t;
		for (b = 0; b < B; b++) {
			for (i = 0; i < N; i++) sample[i] = v[Math.floor(next() * N)];
			t = fn(sample);
			if (isNum(t)) stats.push(t);
		}
		out.used = stats.length;
		if (stats.length < 2 || stats.length < B / 2) return out;
		out.lo = quantile(stats, (1 - level) / 2);
		out.hi = quantile(stats, 1 - (1 - level) / 2);
		out.se = sd(stats);
		return out;
	}

	// bootstrapDiff(a, b, statFn, { n: 2000, seed: 'lab', level: 0.95 }): the same
	// percentile bootstrap for the difference statFn(a) - statFn(b) between two
	// independent lists (two conditions of one sitting). Each resample draws a
	// with replacement from a and b with replacement from b.
	// Returns { lo, hi, estimate, se, level, n, used, seed }.
	function bootstrapDiff(a, b, statFn, opts) {
		opts = opts || {};
		var x = list(a), y = list(b), nx = x.length, ny = y.length;
		var B = opts.n > 0 ? Math.floor(opts.n) : 2000;
		var level = opts.level > 0 && opts.level < 1 ? +opts.level : 0.95;
		var seed = opts.seed == null ? 'lab' : opts.seed;
		var fn = typeof statFn === 'function' ? statFn : mean;
		var out = { lo: NaN, hi: NaN, estimate: nx && ny ? fn(x.slice()) - fn(y.slice()) : NaN, se: NaN, level: level, n: B, used: 0, seed: seed };
		if (nx < 2 || ny < 2) return out;
		var next = rng(seed), stats = [], sx = new Array(nx), sy = new Array(ny), k, i, t;
		for (k = 0; k < B; k++) {
			for (i = 0; i < nx; i++) sx[i] = x[Math.floor(next() * nx)];
			for (i = 0; i < ny; i++) sy[i] = y[Math.floor(next() * ny)];
			t = fn(sx) - fn(sy);
			if (isNum(t)) stats.push(t);
		}
		out.used = stats.length;
		if (stats.length < 2 || stats.length < B / 2) return out;
		out.lo = quantile(stats, (1 - level) / 2);
		out.hi = quantile(stats, 1 - (1 - level) / 2);
		out.se = sd(stats);
		return out;
	}

	// ---- The permutation test ----------------------------------------------------------

	// How many ways to choose k of n, as a float (it only has to be compared with a limit).
	function choose(n, k) {
		if (k < 0 || k > n) return 0;
		k = Math.min(k, n - k);
		var c = 1;
		for (var i = 1; i <= k; i++) c = c * (n - k + i) / i;
		return Math.round(c);
	}

	// permutationTest(a, b, { paired, stat, alternative, n: 5000, seed: 'lab', maxExact: 20000 })
	//
	// Two independent lists (the default): the statistic is T = mean(a) - mean(b),
	// or stat(a, b) if given. Under the null hypothesis the labels are arbitrary,
	// so every way of dealing the pooled values into a group of length(a) and a
	// group of length(b) is equally likely. The p value is the share of those
	// deals whose T is at least as extreme as the observed one:
	//     two-sided  |T*| >= |T|        greater  T* >= T        less  T* <= T
	// When there are at most maxExact deals (C(na + nb, na)) every one is tried and
	// p is exact. Otherwise n random deals are drawn by rng(seed) and
	// p = (count + 1) / (n + 1), which counts the observed deal itself.
	//
	// paired: true: the lists are matched pairs; the statistic is the mean of the
	// differences a[i] - b[i] (or stat(a, b)), and a deal swaps a[i] with b[i]
	// for some pairs, which flips the sign of that difference: 2^n deals.
	//
	// Returns { p, observed, exact, n: deals tried, alternative, paired }.
	function permutationTest(a, b, opts) {
		opts = opts || {};
		var x = list(a), y = list(b), nx = x.length, ny = y.length;
		var alt = opts.alternative === 'greater' || opts.alternative === 'less' ? opts.alternative : 'two-sided';
		var maxExact = opts.maxExact > 0 ? +opts.maxExact : 20000;
		var B = opts.n > 0 ? Math.floor(opts.n) : 5000;
		var seed = opts.seed == null ? 'lab' : opts.seed;
		var custom = typeof opts.stat === 'function' ? opts.stat : null;
		var paired = !!opts.paired;
		var out = { p: NaN, observed: NaN, exact: false, n: 0, alternative: alt, paired: paired };
		if (!nx || !ny || !allNums(x) || !allNums(y) || (paired && nx !== ny)) return out;

		var observed = custom ? custom(x.slice(), y.slice()) : (paired ? meanDiff(x, y) : mean(x) - mean(y));
		out.observed = observed;
		if (!isNum(observed)) return out;
		var eps = 1e-9 * Math.max(1, Math.abs(observed));
		var count = 0, tried = 0;
		function meanDiff(p, q) {
			var s = 0;
			for (var i = 0; i < p.length; i++) s += p[i] - q[i];
			return s / p.length;
		}
		function see(t) {
			tried++;
			if (!isNum(t)) return;
			if (alt === 'greater' ? t >= observed - eps : alt === 'less' ? t <= observed + eps : Math.abs(t) >= Math.abs(observed) - eps) count++;
		}
		var i, k, next;

		if (paired) {
			var swapA = new Array(nx), swapB = new Array(nx);
			var deal = function (flip) {          // flip(i) says whether pair i is swapped
				for (var j = 0; j < nx; j++) {
					if (flip(j)) { swapA[j] = y[j]; swapB[j] = x[j]; } else { swapA[j] = x[j]; swapB[j] = y[j]; }
				}
				see(custom ? custom(swapA.slice(), swapB.slice()) : meanDiff(swapA, swapB));
			};
			if (nx <= 30 && Math.pow(2, nx) <= maxExact) {
				var total = Math.pow(2, nx), mask;
				var bit = function (j) { return (mask >> j) & 1; };
				for (mask = 0; mask < total; mask++) deal(bit);
				out.exact = true;
				out.p = count / tried;
			} else {
				next = rng(seed);
				var coin = function () { return next() < 0.5; };
				for (k = 0; k < B; k++) deal(coin);
				out.p = (count + 1) / (tried + 1);
			}
			out.n = tried;
			return out;
		}

		var pooled = x.concat(y), N = nx + ny, totalSum = sum(pooled);
		var ga = new Array(nx), gb = new Array(ny);
		var dealt = function (inA) {             // inA[i] is true when pooled[i] goes to the first group
			if (!custom) {
				var s = 0;
				for (var j = 0; j < N; j++) if (inA[j]) s += pooled[j];
				see(s / nx - (totalSum - s) / ny);
				return;
			}
			var ia = 0, ib = 0;
			for (var m = 0; m < N; m++) { if (inA[m]) ga[ia++] = pooled[m]; else gb[ib++] = pooled[m]; }
			see(custom(ga.slice(), gb.slice()));
		};
		if (choose(N, nx) <= maxExact) {
			// every combination of nx positions out of N, in lexicographic order
			var idx = [], member = new Array(N);
			for (i = 0; i < nx; i++) idx.push(i);
			for (;;) {
				for (i = 0; i < N; i++) member[i] = false;
				for (i = 0; i < nx; i++) member[idx[i]] = true;
				dealt(member);
				for (i = nx - 1; i >= 0 && idx[i] === N - nx + i; i--) { /* find the last position that can still move */ }
				if (i < 0) break;
				idx[i]++;
				for (k = i + 1; k < nx; k++) idx[k] = idx[k - 1] + 1;
			}
			out.exact = true;
			out.p = count / tried;
		} else {
			next = rng(seed);
			var order = [], flags = new Array(N);
			for (i = 0; i < N; i++) order.push(i);
			for (k = 0; k < B; k++) {
				for (i = N - 1; i > 0; i--) {
					var j = Math.floor(next() * (i + 1));
					var t = order[i]; order[i] = order[j]; order[j] = t;
				}
				for (i = 0; i < N; i++) flags[i] = false;
				for (i = 0; i < nx; i++) flags[order[i]] = true;
				dealt(flags);
			}
			out.p = (count + 1) / (tried + 1);
		}
		out.n = tried;
		return out;
	}

	// ---- Signal detection ------------------------------------------------------------

	// dprime(hits, misses, falseAlarms, correctRejections): sensitivity and bias of
	// a yes/no task, with the log-linear correction (Hautus, 1995): add 0.5 to
	// every cell before computing the rates, so a perfect or an empty cell does
	// not send z to infinity.
	//     H = (hits + 0.5) / (hits + misses + 1)
	//     F = (falseAlarms + 0.5) / (falseAlarms + correctRejections + 1)
	//     d' = z(H) - z(F)              sensitivity (0 = cannot tell signal from noise)
	//     c  = -(z(H) + z(F)) / 2       criterion (above 0 = leans towards "no")
	// with z = probit. Returns { dprime, c, hitRate: H, faRate: F, rawHitRate,
	// rawFaRate }; NaN when there were no signal trials or no noise trials.
	function dprime(hits, misses, falseAlarms, correctRejections) {
		var out = { dprime: NaN, c: NaN, hitRate: NaN, faRate: NaN, rawHitRate: NaN, rawFaRate: NaN };
		var cells = [hits, misses, falseAlarms, correctRejections];
		for (var i = 0; i < 4; i++) if (!isNum(cells[i]) || cells[i] < 0) return out;
		var signal = hits + misses, noise = falseAlarms + correctRejections;
		if (signal <= 0 || noise <= 0) return out;
		var H = (hits + 0.5) / (signal + 1), F = (falseAlarms + 0.5) / (noise + 1);
		var zH = probit(H), zF = probit(F);
		out.dprime = zH - zF;
		out.c = -(zH + zF) / 2;
		if (out.c === 0) out.c = 0;        // never -0
		out.hitRate = H;
		out.faRate = F;
		out.rawHitRate = hits / signal;
		out.rawFaRate = falseAlarms / noise;
		return out;
	}

	// ---- The staircase -----------------------------------------------------------------

	// staircase({ start, step, down: 2, up: 1, min, max }): the transformed
	// up-down method (Levitt, 1971). The level is how easy the trial is.
	//     after `down` correct answers in a row  ->  level = level - step  (harder)
	//     after `up` wrong answers in a row      ->  level = level + step  (easier)
	// A wrong answer ends a run of correct ones and the other way round; the level
	// stays inside [min, max]. A reversal is a change that goes the other way
	// from the change before it, and the level at which it happened is kept.
	// With up = 1 the level settles where P(correct)^down = 0.5: 70.7% correct for
	// down = 2, 79.4% for down = 3, 50% for down = 1.
	// `step` may be a list ([4, 2, 1]): the first size is used until the first
	// reversal, the second until the next, the last from then on.
	//
	// Returns { level, next(correct) -> the new level, threshold(k) -> the mean of
	// the last k reversal levels (k = 6 unless given; NaN before the first
	// reversal), reversals, trials, history: [{ level, correct }], down, up, target }.
	function staircase(opts) {
		opts = opts || {};
		var steps = (Array.isArray(opts.step) ? opts.step : [opts.step == null ? 1 : opts.step]).map(Number);
		if (!steps.length || !allNums(steps) || steps.some(function (s) { return s <= 0; })) throw new RangeError('staircase: step must be a positive number, or a list of them');
		var down = opts.down == null ? 2 : Math.floor(opts.down);
		var up = opts.up == null ? 1 : Math.floor(opts.up);
		if (!(down >= 1) || !(up >= 1)) throw new RangeError('staircase: down and up must be whole numbers from 1');
		var min = opts.min == null ? -Infinity : +opts.min;
		var max = opts.max == null ? Infinity : +opts.max;
		if (!(min <= max)) throw new RangeError('staircase: min must not be above max');
		function clamp(v) { return Math.min(max, Math.max(min, Math.round(v * 1e9) / 1e9)); }
		var start = opts.start == null ? (isFinite(max) ? max : 0) : +opts.start;
		if (!isNum(start)) throw new RangeError('staircase: start must be a number');

		var runRight = 0, runWrong = 0, lastDir = 0;
		var s = {
			level: clamp(start), trials: 0, reversals: [], history: [], down: down, up: up,
			target: up === 1 ? Math.pow(0.5, 1 / down) : down === 1 ? 1 - Math.pow(0.5, 1 / up) : NaN
		};
		function move(dir) {                   // -1 harder, +1 easier
			if (lastDir && dir !== lastDir) s.reversals.push(s.level);
			lastDir = dir;
			s.level = clamp(s.level + dir * steps[Math.min(s.reversals.length, steps.length - 1)]);
		}
		s.next = function (correct) {
			s.history.push({ level: s.level, correct: !!correct });
			s.trials++;
			if (correct) {
				runWrong = 0;
				if (++runRight >= down) { runRight = 0; move(-1); }
			} else {
				runRight = 0;
				if (++runWrong >= up) { runWrong = 0; move(1); }
			}
			return s.level;
		};
		s.threshold = function (k) {
			k = k > 0 ? Math.floor(k) : 6;
			var last = s.reversals.slice(-k);
			return last.length ? mean(last) : NaN;
		};
		return s;
	}

	// ---- Forgetting and learning curves --------------------------------------------------

	// One curve, y = a * g(t)^..., fitted by least squares on the scores themselves.
	function fitCurve(t, y, kind, shift) {
		var n = t.length, i;
		var u = t.map(function (v) { return kind === 'power' ? v + shift : v; });
		function base(b, ui) { return kind === 'power' ? Math.pow(ui, -b) : Math.exp(-b * ui); }
		function rssOf(a, b) {
			var s = 0;
			for (var j = 0; j < n; j++) { var e = y[j] - a * base(b, u[j]); s += e * e; }
			return s;
		}
		// Start from the straight line through the logarithms of the positive scores:
		// ln y = ln a - b t (exponential) or ln y = ln a - b ln t (power).
		var lx = [], ly = [];
		for (i = 0; i < n; i++) if (y[i] > 0) { lx.push(kind === 'power' ? Math.log(u[i]) : u[i]); ly.push(Math.log(y[i])); }
		var line = lx.length >= 2 ? linreg(lx, ly) : null;
		var a, b;
		if (line && isNum(line.slope) && isNum(line.intercept)) { a = Math.exp(line.intercept); b = -line.slope; }
		else { a = Math.max.apply(null, y) > 0 ? Math.max.apply(null, y) : 1; b = 0; }
		// Then Levenberg-Marquardt on (a, b): solve (J'J + lambda diag(J'J)) d = J'r
		// with r = y - f and J the derivatives of f, accept a step that lowers the
		// sum of squares, and stop when none does.
		var lambda = 1e-3, cur = rssOf(a, b);
		for (var iter = 0; iter < 200 && isNum(cur); iter++) {
			var jaa = 0, jab = 0, jbb = 0, ga = 0, gb = 0;
			for (i = 0; i < n; i++) {
				var g = base(b, u[i]);
				var da = g, db = -a * (kind === 'power' ? Math.log(u[i]) : u[i]) * g;
				var e = y[i] - a * g;
				jaa += da * da; jab += da * db; jbb += db * db; ga += da * e; gb += db * e;
			}
			var improved = false;
			for (var tries = 0; tries < 40; tries++) {
				var A = jaa * (1 + lambda), D = jbb * (1 + lambda), det = A * D - jab * jab;
				if (isNum(det) && Math.abs(det) > 1e-300) {
					var na = a + (D * ga - jab * gb) / det, nb = b + (A * gb - jab * ga) / det;
					var next = rssOf(na, nb);
					if (isNum(next) && next <= cur) {
						improved = cur - next > 1e-15 * (1 + cur);
						a = na; b = nb; cur = next;
						lambda = Math.max(lambda / 10, 1e-12);
						break;
					}
				}
				lambda *= 10;
			}
			if (!improved) break;
		}
		var my = mean(y), tss = 0, residuals = [];
		for (i = 0; i < n; i++) { tss += (y[i] - my) * (y[i] - my); residuals.push(y[i] - a * base(b, u[i])); }
		var fit = { a: a, b: b, rss: cur, r2: tss > 0 ? 1 - cur / tss : NaN, residuals: residuals };
		fit.predict = kind === 'power'
			? function (v) { return a * Math.pow(v + shift, -b); }
			: function (v) { return a * Math.exp(-b * v); };
		if (kind === 'power') fit.shift = shift;
		return fit;
	}

	// fitExpVsPower(times, scores, { shift: 0 }): fits the two textbook forgetting
	// (or learning) curves to the same points and says which is closer.
	//     exponential   score = a * exp(-b * t)
	//     power         score = a * (t + shift)^(-b)
	// Each is fitted by least squares on the scores themselves (not on their
	// logarithms, which would weigh the small scores more): a straight-line fit of
	// the logarithms gives the start, Levenberg-Marquardt refines it.
	// The power law needs every t + shift above zero: with a time of 0, pass
	// { shift: 1 }; otherwise this throws. Fewer than two points, or a point
	// that is not a finite number, give NaN for every number and better: null.
	// Returns { exp: { a, b, rss, r2, residuals, predict(t) },
	//           power: { a, b, shift, rss, r2, residuals, predict(t) },
	//           better: 'exp' | 'power' | 'tie', n }
	// where residuals[i] = scores[i] - predict(times[i]), rss = sum(residuals^2),
	// r2 = 1 - rss / sum((score - mean)^2), and `better` is the curve with the
	// smaller rss (both have two parameters, so no penalty is needed). With a
	// handful of points the two are often nearly as close as each other: report
	// which fitted this sitting better, not what forgetting "is".
	function fitExpVsPower(times, scores, opts) {
		opts = opts || {};
		var t = list(times), y = list(scores), n = t.length;
		var shift = isNum(opts.shift) ? opts.shift : 0;
		if (n !== y.length) throw new RangeError('fitExpVsPower: times and scores must have the same length');
		// Too few points, or one that is not a number: no fit, so every number
		// of the answer is NaN (as everywhere in this file) and `better` is null.
		if (n < 2 || !allNums(t) || !allNums(y)) {
			var none = function (kind) {
				var f = { a: NaN, b: NaN, rss: NaN, r2: NaN, residuals: y.map(function () { return NaN; }), predict: function () { return NaN; } };
				if (kind === 'power') f.shift = shift;
				return f;
			};
			return { exp: none('exp'), power: none('power'), better: null, n: n };
		}
		for (var i = 0; i < n; i++) {
			if (!(t[i] + shift > 0)) throw new RangeError('fitExpVsPower: the power law needs every time above zero; pass { shift: 1 } when a time is 0');
		}
		var e = fitCurve(t, y, 'exp', 0), p = fitCurve(t, y, 'power', shift);
		var tol = 1e-9 * Math.max(1e-12, e.rss + p.rss);
		return { exp: e, power: p, better: Math.abs(e.rss - p.rss) <= tol ? 'tie' : e.rss < p.rss ? 'exp' : 'power', n: n };
	}

	// ---- Information ---------------------------------------------------------------------

	// surprisal(p) = -log2(p): how many bits of surprise an outcome of probability
	// p carries. 1 -> 0 bits, 0.5 -> 1 bit, 0.25 -> 2 bits, 0 -> Infinity.
	function surprisal(p) {
		if (typeof p !== 'number' || !(p >= 0 && p <= 1)) return NaN;
		if (p === 0) return Infinity;
		var bits = -Math.log(p) / Math.LN2;
		return bits === 0 ? 0 : bits;        // never -0
	}

	var api = {
		Z95: Z95,
		finite: finite, hash: hash, rng: rng,
		sum: sum, mean: mean, median: median, variance: variance, sd: sd, sem: sem, quantile: quantile,
		rank: rank, pearson: pearson, spearman: spearman, linreg: linreg,
		normCdf: normCdf, probit: probit,
		wilson: wilson, bootstrapCI: bootstrapCI, bootstrapDiff: bootstrapDiff, permutationTest: permutationTest,
		dprime: dprime, staircase: staircase, fitExpVsPower: fitExpVsPower, surprisal: surprisal
	};
	if (typeof module === 'object' && module && module.exports) module.exports = api;
	if (typeof window !== 'undefined') window.LabStats = api;
})();
