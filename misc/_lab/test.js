/*
 * Lab kit tests. Node built-ins only; run from anywhere:
 *     node misc/_lab/test.js
 * Prints one PASS or FAIL line per check and exits 1 if any check failed.
 *
 * What is covered: every function of stats.js against answers worked by hand
 * in the comments below; the parts of lab.js that need no browser (the Latin
 * square, shuffles, records, the simulated participant, answer matching);
 * facts.js against the real facts file; the stage names against
 * assets/js/glance.js, read as text; lint-facts.js on a scratch folder with a
 * planted figure; the markup chart.js draws; and that the kit's own files
 * compile, are plain ASCII and write out none of the study's figures.
 * The browser half (timing, input, storage, the look) needs a browser: see
 * README.md, "Checking an experiment".
 */
'use strict';
var fs = require('fs');
var os = require('os');
var path = require('path');
var vm = require('vm');
var childProcess = require('child_process');

var HERE = __dirname;
var ROOT = path.resolve(HERE, '..', '..');
var S = require('./stats.js');
var Lab = require('./lab.js');
var Facts = require('./facts.js');
var Chart = require('./chart.js');
var Lint = require('./lint-facts.js');
var Kit = require('../_kit/kit.js');

var C = String.fromCharCode;
var RHO = C(0x3C1), MINUS = C(0x2212), SECTION = C(0xA7), MIDDOT = C(0xB7), NBSP = C(0xA0), DASH = C(0x2014);

var passed = 0, failed = 0, skipped = 0, section = '';
function ok(cond, msg) {
	if (cond) { passed++; console.log('PASS  ' + section + ': ' + msg); return true; }
	failed++;
	console.log('FAIL  ' + section + ': ' + msg);
	return false;
}
function eq(got, expected, msg) {
	var same = JSON.stringify(got) === JSON.stringify(expected);
	return ok(same, same ? msg : msg + '\n        got      ' + JSON.stringify(got) + '\n        expected ' + JSON.stringify(expected));
}
function near(got, expected, tol, msg) {
	var good = typeof got === 'number' && Math.abs(got - expected) <= tol;
	return ok(good, good ? msg : msg + '\n        got      ' + got + '\n        expected ' + expected + ' (within ' + tol + ')');
}
function throws(fn, pattern, msg) {
	try { fn(); } catch (e) { return ok(pattern.test(e.message), msg + (pattern.test(e.message) ? '' : '\n        threw    ' + e.message)); }
	return ok(false, msg + '\n        did not throw');
}
function skip(msg) { skipped++; console.log('SKIP  ' + section + ': ' + msg); }
function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }

/* ------------------------------------------------------------------ centre and spread */
section = 'spread';
(function () {
	// x = 2 4 4 4 5 5 7 9. Sum 40, n 8, mean 5.
	// Squared distances from 5: 9 1 1 1 0 0 4 16, sum 32.
	// Sample variance 32 / 7 = 4.571429; sd = sqrt(32 / 7) = 2.138090; sem = sd / sqrt(8) = 0.755929.
	// Sorted, the middle two are 4 and 5: median 4.5.
	var x = [2, 4, 4, 4, 5, 5, 7, 9];
	eq(S.sum(x), 40, 'sum');
	eq(S.mean(x), 5, 'mean');
	near(S.variance(x), 32 / 7, 1e-12, 'sample variance is 32 / 7');
	near(S.sd(x), 2.138090, 1e-6, 'sd');
	near(S.sem(x), 0.755929, 1e-6, 'sem');
	eq(S.median(x), 4.5, 'median of an even count is the mean of the middle two');
	eq(S.median([3, 1, 2]), 2, 'median of an odd count is the middle one');
	// quantile 0.25 of 1 2 3 4: h = (4 - 1) * 0.25 = 0.75, so 1 + 0.75 * (2 - 1) = 1.75.
	eq(S.quantile([4, 1, 3, 2], 0.25), 1.75, 'quantile interpolates between order statistics');
	eq([S.quantile([1, 2, 3, 4], 0), S.quantile([1, 2, 3, 4], 1)], [1, 4], 'quantile 0 and 1 are the ends');
	ok(isNaN(S.mean([])) && isNaN(S.median([])) && isNaN(S.sd([5])) && isNaN(S.sem([5])), 'nothing to compute gives NaN');
	ok(isNaN(S.mean([500, null])) && isNaN(S.median([1, undefined])) && isNaN(S.sum([1, '2'])), 'a null or a string makes the answer NaN, not a quiet zero');
	eq(S.finite([500, null, 620, NaN, undefined, '7', 580]), [500, 620, 580], 'finite() keeps the numbers');
	var before = [3, 1, 2];
	S.median(before); S.quantile(before, 0.3); S.rank(before);
	eq(before, [3, 1, 2], 'the list that was passed in is left alone');
})();

/* ------------------------------------------------------------------ ranks and correlation */
section = 'correlation';
(function () {
	eq(S.rank([10, 20, 20, 30]), [1, 2.5, 2.5, 4], 'tied values share the mean of their ranks');
	eq(S.rank([3, 1, 2]), [3, 1, 2], 'ranks follow the values, not the positions');
	eq(S.rank([5, 5, 5]), [2, 2, 2], 'three equal values all rank 2');

	// Pearson. x = 1 2 3 4 5 (mean 3), y = 2 4 5 4 5 (mean 4).
	// dx = -2 -1 0 1 2, dy = -2 0 1 0 1.
	// Sxy = 4 + 0 + 0 + 0 + 2 = 6, Sxx = 10, Syy = 4 + 0 + 1 + 0 + 1 = 6.
	// r = 6 / sqrt(10 * 6) = 0.774597. slope = 6 / 10 = 0.6, intercept = 4 - 0.6 * 3 = 2.2.
	var x = [1, 2, 3, 4, 5], y = [2, 4, 5, 4, 5];
	near(S.pearson(x, y), 0.774597, 1e-6, 'pearson');
	var line = S.linreg(x, y);
	near(line.slope, 0.6, 1e-12, 'linreg slope');
	near(line.intercept, 2.2, 1e-12, 'linreg intercept');
	near(line.r2, 0.6, 1e-12, 'linreg r squared is 36 / 60');
	near(line.predict(10), 8.2, 1e-12, 'linreg predict');
	// residuals y - (2.2 + 0.6 x): -0.8 0.6 1.0 -0.6 -0.2
	ok(line.residuals.every(function (r, i) { return Math.abs(r - [-0.8, 0.6, 1.0, -0.6, -0.2][i]) < 1e-12; }), 'linreg residuals');
	ok(isNaN(S.pearson([1, 1, 1], [1, 2, 3])) && isNaN(S.pearson([1, 2], [1, 2, 3])) && isNaN(S.linreg([2, 2], [1, 5]).slope), 'no spread or unequal lengths give NaN');

	// Spearman with ties. x = 1 2 2 3 4 has ranks 1 2.5 2.5 4 5; y = 10 20 30 30 50 has ranks 1 2 3.5 3.5 5.
	// Both rank lists have mean 3. dx = -2 -0.5 -0.5 1 2, dy = -2 -1 0.5 0.5 2.
	// Sxy = 4 + 0.5 - 0.25 + 0.5 + 4 = 8.75; Sxx = 4 + 0.25 + 0.25 + 1 + 4 = 9.5; Syy = 4 + 1 + 0.25 + 0.25 + 4 = 9.5.
	// rho = 8.75 / 9.5 = 35 / 38 = 0.921053.
	// (The shortcut 1 - 6 sum(d^2) / (n (n^2 - 1)) with d = 0 0.5 -1 0.5 0 would give 1 - 9 / 120 = 0.925: wrong with ties.)
	near(S.spearman([1, 2, 2, 3, 4], [10, 20, 30, 30, 50]), 35 / 38, 1e-12, 'spearman with ties is the Pearson correlation of average ranks: 35 / 38');
	ok(Math.abs(S.spearman([1, 2, 2, 3, 4], [10, 20, 30, 30, 50]) - 0.925) > 0.003, 'and not the no-ties shortcut (0.925)');
	// Without ties the shortcut holds: ranks 1 2 3 4 5 against 2 1 4 3 5, d = -1 1 -1 1 0, sum d^2 = 4, rho = 1 - 24 / 120 = 0.8.
	near(S.spearman([1, 2, 3, 4, 5], [20, 10, 40, 30, 50]), 0.8, 1e-12, 'spearman without ties: 1 - 6 * 4 / 120 = 0.8');
	eq(S.spearman([1, 2, 3, 4], [1, 8, 27, 64]), 1, 'any rising relation has rho 1');
	eq(S.spearman([1, 2, 3, 4], [9, 7, 2, 1]), -1, 'any falling relation has rho -1');
})();

/* ------------------------------------------------------------------ the normal distribution */
section = 'normal';
(function () {
	near(S.probit(0.975), 1.959963984540054, 1e-12, 'probit(0.975) is 1.959964');
	eq(S.Z95, 1.959963984540054, 'Z95 is that number');
	eq(S.probit(0.5), 0, 'probit(0.5) is 0');
	near(S.probit(0.8413447460685429), 1, 1e-12, 'probit of the share within one sd below is 1');
	near(S.probit(0.9), 1.2815515655446004, 1e-12, 'probit(0.9)');
	near(S.probit(0.001), -3.090232306167813, 1e-12, 'probit(0.001), in the tail');
	near(S.probit(1e-10), -6.361340902404056, 1e-10, 'probit(1e-10), in the far tail');
	ok(S.probit(0) === -Infinity && S.probit(1) === Infinity, 'probit(0) and probit(1) are infinite');
	ok(isNaN(S.probit(1.2)) && isNaN(S.probit(-0.1)) && isNaN(S.probit(NaN)), 'probit outside [0, 1] is NaN');
	near(S.normCdf(0), 0.5, 1e-15, 'normCdf(0) is one half');
	near(S.normCdf(1.96), 0.9750021048517795, 1e-13, 'normCdf(1.96)');
	near(S.normCdf(-1), 0.15865525393145707, 1e-13, 'normCdf(-1)');
	near(S.normCdf(-6), 9.865876450377e-10, 1e-20, 'normCdf(-6), by the continued fraction');
	var worst = 0;
	for (var i = 1; i < 2000; i++) worst = Math.max(worst, Math.abs(S.normCdf(S.probit(i / 2000)) - i / 2000));
	ok(worst < 1e-13, 'normCdf(probit(p)) returns p for 1999 values of p (largest error ' + worst.toExponential(1) + '), though the two are computed differently');
})();

/* ------------------------------------------------------------------ the Wilson interval */
section = 'wilson';
(function () {
	// 8 successes in 10, z = 1.96. p = 0.8, z^2 = 3.8416.
	// denominator 1 + 3.8416 / 10 = 1.38416
	// centre = (0.8 + 3.8416 / 20) / 1.38416 = 0.99208 / 1.38416 = 0.716738
	// half = 1.96 * sqrt(0.8 * 0.2 / 10 + 3.8416 / 400) / 1.38416 = 1.96 * sqrt(0.025604) / 1.38416
	//      = 1.96 * 0.1600125 / 1.38416 = 0.226581
	// lo = 0.490157, hi = 0.943319
	var w = S.wilson(8, 10, 1.96);
	near(w.centre, 0.716738, 1e-6, 'centre of 8 in 10');
	near(w.lo, 0.490157, 1e-6, 'lower bound of 8 in 10');
	near(w.hi, 0.943319, 1e-6, 'upper bound of 8 in 10');
	eq(w.p, 0.8, 'p is k / n');
	var d = S.wilson(8, 10);
	ok(Math.abs(d.lo - w.lo) < 1e-4 && Math.abs(d.hi - w.hi) < 1e-4 && d.z === S.Z95, 'without z it is the 95% interval');
	// 0 in 10: lo is exactly 0; hi = z^2 / (n + z^2) = 3.8416 / 13.8416 = 0.277540 at z = 1.96.
	var none = S.wilson(0, 10, 1.96), every = S.wilson(10, 10, 1.96);
	eq(none.lo, 0, '0 in 10: the lower bound is exactly 0');
	near(none.hi, 3.8416 / 13.8416, 1e-12, '0 in 10: the upper bound is z^2 / (n + z^2)');
	eq(every.hi, 1, '10 in 10: the upper bound is exactly 1');
	near(every.lo, 10 / 13.8416, 1e-12, '10 in 10: the lower bound is n / (n + z^2)');
	ok(isNaN(S.wilson(0, 0).lo) && isNaN(S.wilson(3, 2).lo) && isNaN(S.wilson(-1, 5).hi), 'no trials, or more successes than trials, gives NaN');
	var wide = S.wilson(5, 10), narrow = S.wilson(50, 100);
	ok(narrow.hi - narrow.lo < wide.hi - wide.lo, 'more trials give a narrower interval');
})();

/* ------------------------------------------------------------------ the bootstrap */
section = 'bootstrap';
(function () {
	var x = [2, 4, 4, 4, 5, 5, 7, 9];
	var a = S.bootstrapCI(x, S.mean, { seed: 'a' }), a2 = S.bootstrapCI(x, S.mean, { seed: 'a' }), b = S.bootstrapCI(x, S.mean, { seed: 'b' });
	eq([a.lo, a.hi, a.se], [a2.lo, a2.hi, a2.se], 'the same seed gives the same interval, to the last digit');
	ok(a.lo !== b.lo || a.hi !== b.hi || a.se !== b.se, 'another seed gives another draw');
	ok(Math.abs(a.lo - b.lo) < 0.5 && Math.abs(a.hi - b.hi) < 0.5, 'and nearly the same interval');
	eq(a.estimate, 5, 'estimate is the statistic of the data itself');
	ok(a.lo < 5 && 5 < a.hi, 'the interval holds the estimate (' + a.lo + ' to ' + a.hi + ')');
	eq([a.n, a.used, a.level, a.seed], [2000, 2000, 0.95, 'a'], 'defaults: 2000 resamples, 95%');
	var d = S.bootstrapCI(x, S.mean);
	eq([d.lo, d.hi], [S.bootstrapCI(x, S.mean).lo, S.bootstrapCI(x, S.mean).hi], 'without a seed it is still the same every time');
	// Two values, 0 and 1. A resample is 00, 01, 10 or 11, so its mean is 0, 0.5 or 1 with
	// chances 1/4, 1/2, 1/4. A quarter of the means are 0 and a quarter are 1, so the 2.5%
	// and 97.5% quantiles are 0 and 1, and the sd of the means is sqrt(1/4 * 1/4 + 1/4 * 1/4) = 0.3536.
	var two = S.bootstrapCI([0, 1], S.mean, { seed: 7 });
	eq([two.lo, two.hi], [0, 1], 'two values 0 and 1: the interval of the mean is 0 to 1');
	near(two.se, Math.sqrt(1 / 8), 0.02, 'and the standard error is sqrt(1/8)');
	var same = S.bootstrapCI([3, 3, 3, 3], S.median, { seed: 1 });
	eq([same.lo, same.hi, same.se], [3, 3, 0], 'data without spread give an interval without width');
	var inner = S.bootstrapCI(x, S.mean, { seed: 'a', level: 0.8 });
	ok(inner.lo >= a.lo && inner.hi <= a.hi && inner.hi - inner.lo < a.hi - a.lo, 'an 80% interval lies inside the 95% one');
	eq(S.bootstrapCI(x, S.mean, { seed: 'a', n: 300 }).n, 300, 'n sets the number of resamples');
	var pairs = [[1, 2], [2, 4], [3, 5], [4, 4], [5, 5], [6, 8], [7, 7], [8, 9]];
	var rho = S.bootstrapCI(pairs, function (ps) { return S.spearman(ps.map(function (p) { return p[0]; }), ps.map(function (p) { return p[1]; })); }, { seed: 'pairs' });
	ok(rho.lo > 0 && rho.hi <= 1 && rho.lo < rho.estimate && rho.used > 1900, 'it resamples pairs for a correlation (rho ' + rho.estimate.toFixed(2) + ', ' + rho.lo.toFixed(2) + ' to ' + rho.hi.toFixed(2) + ')');
	ok(isNaN(S.bootstrapCI([5], S.mean).lo) && isNaN(S.bootstrapCI([], S.mean).estimate), 'one value or none gives no interval');

	var diff = S.bootstrapDiff([5, 6, 7, 8, 9], [1, 2, 3, 4, 5], S.median, { seed: 1 }), diff2 = S.bootstrapDiff([5, 6, 7, 8, 9], [1, 2, 3, 4, 5], S.median, { seed: 1 });
	eq(diff.estimate, 4, 'bootstrapDiff: the estimate is median(a) - median(b)');
	eq([diff.lo, diff.hi], [diff2.lo, diff2.hi], 'bootstrapDiff is reproducible');
	ok(diff.lo < 4 && diff.hi > 4, 'bootstrapDiff: the interval holds the estimate');
	var flat = S.bootstrapDiff([5, 5, 5], [2, 2, 2, 2], S.mean, { seed: 3 });
	eq([flat.lo, flat.hi], [3, 3], 'bootstrapDiff of two constant lists is their difference exactly');
})();

/* ------------------------------------------------------------------ the permutation test */
section = 'permutation';
(function () {
	// a = 1 2 3, b = 4 5 6. T = mean(a) - mean(b) = 2 - 5 = -3.
	// There are C(6, 3) = 20 ways to pick the first group. Only {1,2,3} gives -3 and only
	// {4,5,6} gives +3; every other choice is closer to zero.
	// two-sided p = 2 / 20 = 0.1; "less" p = 1 / 20 = 0.05; "greater" p = 20 / 20 = 1.
	var t = S.permutationTest([1, 2, 3], [4, 5, 6]);
	eq([t.p, t.observed, t.exact, t.n], [0.1, -3, true, 20], 'exact two-sided p on 3 against 3 is 2 / 20');
	eq(S.permutationTest([1, 2, 3], [4, 5, 6], { alternative: 'less' }).p, 0.05, 'one-sided "less" is 1 / 20');
	eq(S.permutationTest([1, 2, 3], [4, 5, 6], { alternative: 'greater' }).p, 1, 'one-sided "greater" is 20 / 20');
	// a = 12 15, b = 9 10 11. T = 13.5 - 10 = 3.5, the largest of the C(5, 2) = 10 deals.
	// The most negative deal is a = {9, 10}: 9.5 - 38 / 3 = -3.167, which is not as far as 3.5.
	// So one deal in ten is as extreme, on either side: p = 0.1 both ways.
	var u = S.permutationTest([12, 15], [9, 10, 11]);
	eq([u.p, u.observed, u.n], [0.1, 3.5, 10], 'two-sided p on 2 against 3 is 1 / 10, not twice the one-sided p');
	eq(S.permutationTest([12, 15], [9, 10, 11], { alternative: 'greater' }).p, 0.1, 'and the one-sided p is 1 / 10 too');
	// Paired: differences 1 2 3 4, mean 2.5. 2^4 = 16 sign patterns; only ++++ and ---- reach 2.5 in size.
	var p = S.permutationTest([2, 4, 6, 8], [1, 2, 3, 4], { paired: true });
	eq([p.p, p.observed, p.exact, p.n, p.paired], [0.125, 2.5, true, 16, true], 'paired: exact p on four pairs is 2 / 16');
	eq(S.permutationTest([5, 5, 5], [5, 5, 5]).p, 1, 'identical groups: every deal is as extreme, p = 1');
	// A custom statistic: the difference of medians. a = 1 2 9, b = 3 4 5: medians 2 and 4, T = -2.
	var med = S.permutationTest([1, 2, 9], [3, 4, 5], { stat: function (g, h) { return S.median(g) - S.median(h); } });
	eq([med.observed, med.exact, med.n], [-2, true, 20], 'a custom statistic is used');
	ok(med.p > 0 && med.p <= 1, 'and gives a p value (' + med.p + ')');

	var big1 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], big2 = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
	var mc = S.permutationTest(big1, big2), mc2 = S.permutationTest(big1, big2);
	eq([mc.exact, mc.n], [false, 5000], 'C(24, 12) = 2,704,156 deals are too many: 5000 random deals instead');
	eq(mc.p, mc2.p, 'the random deals are seeded: the same p every time');
	var exact = S.permutationTest(big1, big2, { maxExact: 3e6 });
	eq([exact.exact, exact.n], [true, 2704156], 'maxExact can ask for all 2,704,156');
	near(mc.p, exact.p, 0.006, 'the Monte Carlo p (' + mc.p.toFixed(4) + ') is close to the exact one (' + exact.p.toFixed(4) + ')');
	ok(mc.p >= 1 / 5001, 'a Monte Carlo p is never 0');
	ok(isNaN(S.permutationTest([], [1, 2]).p) && isNaN(S.permutationTest([1, 2], [1, 2, 3], { paired: true }).p) && isNaN(S.permutationTest([1, null], [2, 3]).p), 'empty, unpaired or non-numeric input gives NaN');
})();

/* ------------------------------------------------------------------ signal detection */
section = 'dprime';
(function () {
	// 15 hits, 4 misses, 4 false alarms, 15 correct rejections.
	// H = (15 + 0.5) / (19 + 1) = 0.775, F = (4 + 0.5) / (19 + 1) = 0.225 = 1 - H.
	// From a normal table z(0.775) = 0.7554 (Phi(0.75) = 0.7734, Phi(0.76) = 0.7764), and z(0.225) = -0.7554.
	// d' = 0.7554 + 0.7554 = 1.5108; c = -(0.7554 - 0.7554) / 2 = 0: no bias.
	var a = S.dprime(15, 4, 4, 15);
	near(a.dprime, 1.5108, 5e-4, 'd-prime of 15/4/4/15 is 1.5108');
	near(a.c, 0, 1e-12, 'and the criterion is 0');
	eq([a.hitRate, a.faRate], [0.775, 0.225], 'the corrected rates are 0.775 and 0.225');
	near(a.rawHitRate, 15 / 19, 1e-12, 'the raw hit rate is kept too');
	// A perfect score, 10/0/0/10: without the correction z(1) and z(0) are infinite.
	// H = 10.5 / 11 = 0.9545, F = 0.5 / 11 = 0.0455; z(0.9545) = 1.6906 (Phi(1.69) = 0.9545).
	// d' = 3.3812.
	var perfect = S.dprime(10, 0, 0, 10);
	near(perfect.dprime, 3.3812, 5e-4, 'a perfect score has a finite d-prime, 3.3812, thanks to the log-linear correction');
	// 20/5/10/15: H = 20.5 / 26 = 0.78846, z = 0.8011; F = 10.5 / 26 = 0.40385, z = -0.2434.
	// d' = 0.8011 + 0.2434 = 1.0445; c = -(0.8011 - 0.2434) / 2 = -0.2788 (leans towards "yes").
	var b = S.dprime(20, 5, 10, 15);
	near(b.dprime, 1.0445, 5e-4, 'd-prime of 20/5/10/15 is 1.0445');
	near(b.c, -0.2788, 5e-4, 'its criterion is -0.2788: a lean towards yes');
	near(S.dprime(10, 10, 10, 10).dprime, 0, 1e-12, 'guessing has d-prime 0');
	ok(S.dprime(5, 15, 15, 5).dprime < 0, 'worse than guessing is negative');
	ok(isNaN(S.dprime(0, 0, 3, 7).dprime) && isNaN(S.dprime(3, 7, 0, 0).c) && isNaN(S.dprime(-1, 2, 3, 4).dprime), 'no signal trials, no noise trials or a negative count give NaN');
})();

/* ------------------------------------------------------------------ the staircase */
section = 'staircase';
(function () {
	// A simulated observer who is right exactly when the level is 7.5 or more; 2-down 1-up, start 12, step 1.
	//   12 right right -> 11, right right -> 10, -> 9, -> 8, -> 7   (ten trials, always downwards: no reversal)
	//   7 wrong -> 8          the first change upwards: a reversal, at 7
	//   8 right right -> 7    a reversal at 8
	//   7 wrong -> 8          a reversal at 7 ... and so on, three trials for every two reversals
	// After 10 + 9 = 19 trials the reversals are 7 8 7 8 7 8 and their mean is 7.5: the observer's threshold.
	var st = S.staircase({ start: 12, step: 1, down: 2, up: 1, min: 1, max: 20 });
	eq(st.level, 12, 'it starts at start');
	ok(isNaN(st.threshold()), 'no threshold before the first reversal');
	var levels = [];
	for (var i = 0; i < 19; i++) { levels.push(st.level); st.next(st.level >= 7.5); }
	eq(levels, [12, 12, 11, 11, 10, 10, 9, 9, 8, 8, 7, 8, 8, 7, 8, 8, 7, 8, 8], 'the levels a deterministic observer is shown');
	eq(st.reversals, [7, 8, 7, 8, 7, 8], 'six reversals after 19 trials');
	eq(st.threshold(), 7.5, 'their mean is the observer\'s threshold, 7.5');
	eq(st.threshold(2), 7.5, 'threshold(k) uses the last k reversals');
	eq([st.trials, st.history.length, st.history[10].level, st.history[10].correct], [19, 19, 7, false], 'trials and history are kept');
	near(st.target, Math.SQRT1_2, 1e-12, '2-down 1-up aims at 70.7% correct');
	near(S.staircase({ start: 5, step: 1, down: 3, up: 1 }).target, Math.pow(0.5, 1 / 3), 1e-12, '3-down 1-up aims at 79.4%');
	eq(S.staircase({ start: 5, step: 1, down: 1, up: 1 }).target, 0.5, '1-down 1-up aims at 50%');

	// An observer with a smooth psychometric function, P(right at level x) = 0.5 + 0.5 / (1 + exp(-(x - 50) / 5)).
	// It is right 70.7% of the time at x = 50 + 5 ln(0.41421 / 0.58579) = 48.27. A 2-down 1-up staircase must
	// settle near that level; with a step that is a fifth of the spread it settles a little below it.
	function observer(level) { return 0.5 + 0.5 / (1 + Math.exp(-(level - 50) / 5)); }
	var r = S.rng('observer'), s2 = S.staircase({ start: 70, step: 1, down: 2, up: 1, min: 0, max: 100 });
	for (i = 0; i < 4000; i++) s2.next(r() < observer(s2.level));
	var th = s2.threshold(200);
	near(th, 48.27, 1.5, 'a noisy observer: 4000 trials settle within a step and a half of the 70.7% level 48.27 (at ' + th.toFixed(2) + ')');
	near(observer(th), Math.SQRT1_2, 0.03, 'where that observer is right ' + (100 * observer(th)).toFixed(1) + '% of the time (target 70.7%)');
	var r3 = S.rng('observer3'), s3 = S.staircase({ start: 70, step: 1, down: 3, up: 1, min: 0, max: 100 });
	for (i = 0; i < 4000; i++) s3.next(r3() < observer(s3.level));
	near(observer(s3.threshold(200)), Math.pow(0.5, 1 / 3), 0.03, '3-down 1-up settles where the observer is right ' + (100 * observer(s3.threshold(200))).toFixed(1) + '% of the time (target 79.4%)');
	ok(s3.threshold(200) > th, 'which is an easier level than the 2-down one');

	// Shrinking steps: 4 until the first reversal, 2 until the second, then 1.
	var sh = S.staircase({ start: 20, step: [4, 2, 1], down: 1, up: 1, min: 0, max: 40 });
	var seen = [];
	[true, true, false, true, false, false].forEach(function (right) { sh.next(right); seen.push(sh.level); });
	eq(seen, [16, 12, 14, 13, 14, 15], 'a list of steps shrinks at each reversal: 20 -4 -4 +2 -1 +1 +1');
	var lo = S.staircase({ start: 2, step: 1, down: 1, up: 1, min: 1, max: 3 });
	lo.next(true); lo.next(true); lo.next(true);
	eq(lo.level, 1, 'the level does not go below min');
	lo.next(false); lo.next(false); lo.next(false); lo.next(false);
	eq(lo.level, 3, 'or above max');
	var frac = S.staircase({ start: 1, step: 0.1, down: 1, up: 1 });
	frac.next(true); frac.next(true); frac.next(true);
	eq(frac.level, 0.7, 'fractional steps do not drift (0.7, not 0.7000000000000001)');
	throws(function () { S.staircase({ start: 1, step: 0 }); }, /step must be a positive number/, 'a step of 0 throws');
	throws(function () { S.staircase({ start: 1, step: 1, min: 5, max: 2 }); }, /min must not be above max/, 'min above max throws');
})();

/* ------------------------------------------------------------------ forgetting curves */
section = 'curves';
(function () {
	// Exponential data: score = 8 * 0.5^t at t = 1 2 3 4, that is 4 2 1 0.5.
	// So a = 8 and b = ln 2 = 0.693147, and the exponential goes through every point (rss 0).
	// A power law cannot: 4 * t^-b would need b = 1 for the second point and b = 1.26 for the third.
	var f = S.fitExpVsPower([1, 2, 3, 4], [4, 2, 1, 0.5]);
	near(f.exp.a, 8, 1e-6, 'exponential data: a = 8');
	near(f.exp.b, Math.LN2, 1e-6, 'exponential data: b = ln 2');
	near(f.exp.rss, 0, 1e-12, 'exponential data: the exponential fits exactly');
	ok(f.power.rss > 0.01, 'the power law does not (rss ' + f.power.rss.toFixed(4) + ')');
	eq(f.better, 'exp', 'better is "exp"');
	near(f.exp.predict(5), 0.25, 1e-6, 'predict continues the curve');
	eq([f.exp.residuals.length, f.power.residuals.length, f.n], [4, 4, 4], 'one residual per point for each curve');
	near(f.exp.r2, 1, 1e-9, 'r2 of an exact fit is 1');
	// Power data: score = 6 / t at t = 1 2 4 8, that is 6 3 1.5 0.75: a = 6, b = 1.
	var g = S.fitExpVsPower([1, 2, 4, 8], [6, 3, 1.5, 0.75]);
	near(g.power.a, 6, 1e-6, 'power data: a = 6');
	near(g.power.b, 1, 1e-6, 'power data: b = 1');
	near(g.power.rss, 0, 1e-12, 'power data: the power law fits exactly');
	eq(g.better, 'power', 'better is "power"');
	var sumSq = g.exp.residuals.reduce(function (s, e) { return s + e * e; }, 0);
	near(sumSq, g.exp.rss, 1e-9, 'rss is the sum of the squared residuals');
	// Least squares is on the scores, not on their logarithms: no other (a, b) nearby does better.
	var base = g.exp.rss, beaten = false;
	[[1.01, 1], [0.99, 1], [1, 1.01], [1, 0.99]].forEach(function (k) {
		var a = g.exp.a * k[0], b = g.exp.b * k[1], s = 0;
		[1, 2, 4, 8].forEach(function (t, i) { var e = [6, 3, 1.5, 0.75][i] - a * Math.exp(-b * t); s += e * e; });
		if (s < base - 1e-12) beaten = true;
	});
	ok(!beaten, 'the fitted exponential is a least-squares minimum (moving a or b by 1% is no better)');
	var z = S.fitExpVsPower([1, 2, 3, 4, 5], [1, 0.5, 0.2, 0, 0.05]);
	ok(isFinite(z.exp.rss) && isFinite(z.power.rss) && (z.better === 'exp' || z.better === 'power'), 'a score of 0 is fitted like any other');
	throws(function () { S.fitExpVsPower([0, 1, 2], [1, 0.5, 0.2]); }, /power law needs every time above zero/, 'a time of 0 throws and says to pass shift');
	eq(S.fitExpVsPower([0, 1, 2], [1, 0.5, 0.2], { shift: 1 }).power.shift, 1, 'shift: 1 fits a * (t + 1)^-b');
	eq(S.fitExpVsPower([1, 2], [3, 1]).better, 'tie', 'two points fit both curves exactly: a tie');
	throws(function () { S.fitExpVsPower([1, 2, 3], [1, 2]); }, /same length/, 'unequal lengths throw');
	[[[1], [1], 'one point'], [[1, 2, 3], [1, NaN, 0.2], 'a NaN score'], [[], [], 'no points'], [[1, null], [1, 0.5], 'a null time']].forEach(function (c) {
		var r = S.fitExpVsPower(c[0], c[1]);
		ok(r.better === null && isNaN(r.exp.a) && isNaN(r.exp.b) && isNaN(r.power.rss) && isNaN(r.exp.predict(2)) && r.n === c[0].length,
			c[2] + ': no fit, every number NaN and better null (no throw)');
	});
})();

/* ------------------------------------------------------------------ surprisal */
section = 'surprisal';
eq([S.surprisal(1), S.surprisal(0.5), S.surprisal(0.25), S.surprisal(0.125)], [0, 1, 2, 3], 'surprisal is -log2(p): 0, 1, 2, 3 bits for 1, 1/2, 1/4, 1/8');
ok(S.surprisal(0) === Infinity, 'an impossible outcome is infinitely surprising');
ok(isNaN(S.surprisal(1.5)) && isNaN(S.surprisal(-0.1)) && isNaN(S.surprisal('0.5')), 'not a probability: NaN');
near(S.surprisal(0.9), 0.15200309344504997, 1e-12, 'surprisal(0.9)');

/* ------------------------------------------------------------------ random numbers */
section = 'rng';
(function () {
	var seeds = ['', 'a', 'lab', '2026-10-03', 42, 0, 4294967295, 'seed:auto'];
	var agree = seeds.every(function (s) {
		var a = S.rng(s), b = Kit.rng(s);
		for (var i = 0; i < 40; i++) if (a() !== b()) return false;
		return true;
	});
	ok(agree, 'LabStats.rng gives the numbers of ToyKit.rng for ' + seeds.length + ' seeds');
	eq(S.hash('foobar'), Kit.hash('foobar'), 'and the same hash');
	var a = Lab.rng('x'), b = S.rng('x');
	eq([a(), a(), a()], [b(), b(), b()], 'Lab.rng is that generator');
	var g = S.rng('normal'), draws = [];
	for (var i = 0; i < 20000; i++) draws.push(g.normal());
	near(S.mean(draws), 0, 0.03, 'normal(): mean 0 over 20000 draws');
	near(S.sd(draws), 1, 0.03, 'normal(): sd 1');
	var shifted = S.rng('normal'), first = S.rng('normal').normal();
	near(shifted.normal(600, 100), 600 + 100 * first, 1e-9, 'normal(mean, sd) shifts and scales the same draw');
})();

/* ------------------------------------------------------------------ the Latin square */
section = 'latin';
(function () {
	function check(rows, n, label) {
		var expectedRows = n % 2 && n > 1 ? 2 * n : n, per = expectedRows / n;
		var good = rows.length === expectedRows;
		// every row is a permutation of 0..n-1
		rows.forEach(function (row) {
			if (row.slice().sort(function (a, b) { return a - b; }).join() !== Array.from({ length: n }, function (_, i) { return i; }).join()) good = false;
		});
		// every condition equally often in every position
		for (var pos = 0; pos < n && good; pos++) {
			var count = {};
			rows.forEach(function (row) { count[row[pos]] = (count[row[pos]] || 0) + 1; });
			for (var c = 0; c < n; c++) if (count[c] !== per) good = false;
		}
		// every condition follows every other condition equally often
		var pairs = {};
		rows.forEach(function (row) { for (var j = 1; j < row.length; j++) { var k = row[j - 1] + '>' + row[j]; pairs[k] = (pairs[k] || 0) + 1; } });
		for (var a = 0; a < n && good; a++) for (var b = 0; b < n; b++) if (a !== b && pairs[a + '>' + b] !== per) good = false;
		ok(good, label + ': ' + rows.length + ' rows, each a permutation, each condition ' + per + 'x in each position, each ordered pair of neighbours ' + per + 'x');
	}
	eq(Lab.latin(4), [[0, 1, 3, 2], [1, 2, 0, 3], [2, 3, 1, 0], [3, 0, 2, 1]], 'latin(4) is the Williams square built from 0 1 3 2');
	eq(Lab.latin(2), [[0, 1], [1, 0]], 'latin(2)');
	eq(Lab.latin(1), [[0]], 'latin(1)');
	eq(Lab.latin(0), [], 'latin(0) is empty');
	for (var n = 2; n <= 9; n++) check(Lab.latin(n), n, 'latin(' + n + ')');
	for (n = 3; n <= 6; n++) check(Lab.latin(n, 'seed-' + n), n, 'latin(' + n + ', seed)');
	eq(Lab.latin(6, 'a'), Lab.latin(6, 'a'), 'a seed gives the same square every time');
	ok(JSON.stringify(Lab.latin(6, 'a')) !== JSON.stringify(Lab.latin(6, 'b')) && JSON.stringify(Lab.latin(6, 'a')) !== JSON.stringify(Lab.latin(6)), 'another seed, or none, gives another');
	var deck = [1, 2, 3, 4, 5, 6, 7, 8];
	eq(Lab.shuffle(deck, 's'), Lab.shuffle(deck, 's'), 'shuffle is the same for the same seed');
	eq(Lab.shuffle(deck, 's').slice().sort(function (a, b) { return a - b; }), deck, 'shuffle returns a permutation');
	eq(deck, [1, 2, 3, 4, 5, 6, 7, 8], 'and leaves its list alone');
	eq(Lab.shuffle(deck, 's'), Kit.rng('s').shuffle(deck), 'it is ToyKit.rng(seed).shuffle');
})();

/* ------------------------------------------------------------------ the stages of the loop */
section = 'stages';
(function () {
	var src;
	try { src = read('assets/js/glance.js'); } catch (e) { ok(false, 'assets/js/glance.js could not be read: ' + e.message); return; }
	var block = /var STAGES = \[([\s\S]*?)\n\t\];/.exec(src);
	if (!ok(!!block, 'assets/js/glance.js has a STAGES table')) return;
	var re = /\{ id: '([^']+)', side: '([^']+)', name: '([^']+)'(?:, sub: '([^']+)')? \}/g, m, theirs = [];
	while ((m = re.exec(block[1]))) {
		var s = { id: m[1], side: m[2], name: m[3] };
		if (m[4]) s.sub = m[4];
		theirs.push(s);
	}
	var lines = block[1].split('\n').filter(function (l) { return l.trim(); }).length;
	eq(theirs.length, lines, 'every line of that table was understood (' + lines + ' stages)');
	eq(Lab.STAGES, theirs, 'Lab.STAGES is that table, word for word: ' + Lab.STAGES.map(function (st) { return st.id + ' "' + st.name + '"'; }).join(', '));
	eq(Lab.STAGES.map(function (st) { return st.id; }), ['h1', 'h2', 'h3', 'm1', 'm2', 'm3', 'xin', 'xout'], 'three human stages, three model stages, two crossing arrows');
	eq(Lab.STAGES.map(function (st) { return st.side; }), ['Human', 'Human', 'Human', 'Model', 'Model', 'Model', 'Human to model', 'Model to human'], 'the sides');
	eq(Lab.stage('h2').name, 'Read and reason', 'stage(id) finds one');
	eq(Lab.stage('h9'), null, 'stage of an unknown id is null');
	eq(Lab.stageLabel('xout'), 'Model to human ' + MIDDOT + ' Output and explanation', 'stageLabel joins side and name the way the diagram captions them');
	ok(src.indexOf("s.side + ' " + MIDDOT + " ' + s.name") !== -1, 'glance.js captions a stage as side, middle dot, name');
})();

/* ------------------------------------------------------------------ records */
section = 'records';
(function () {
	var NOW = '2026-10-03T12:00:00.000Z';
	var rec = Lab.makeRecord({ exp: '61-odd-or-even', version: 2, stage: 'h2', seed: 'abc', headline: { label: ' Median time ', value: 612.4, unit: 'ms', ci: { lo: 540, hi: 690, estimate: 612.4 } }, trials: [{ i: 0, rt: 500 }] }, NOW);
	eq(rec, { exp: '61-odd-or-even', version: 2, t: NOW, stage: 'h2', headline: { label: 'Median time', value: 612.4, unit: 'ms', ci: [540, 690] }, n: 1, trials: [{ i: 0, rt: 500 }], seed: 'abc' }, 'a record: exp, version, t, stage, headline { label, value, unit, ci }, n, trials');
	eq(Lab.makeRecord({ exp: 'x', stage: 'm1', headline: { label: 'd', value: 1, ci: [3, 2] } }, NOW).headline, { label: 'd', value: 1, unit: '', ci: [2, 3] }, 'ci as a pair is put in order; no unit is the empty string');
	eq(Lab.makeRecord({ exp: 'x', stage: 'm1', headline: { label: 'd', value: NaN, unit: '%', ci: [NaN, 2] } }, NOW).headline, { label: 'd', value: null, unit: '%', ci: null }, 'a value or an interval that is not a number becomes null');
	eq(Lab.makeRecord({ exp: 'x', stage: 'xin', headline: { label: 'd', value: 1 }, n: 12, t: '2026-01-02T03:04:05Z' }, NOW).t, '2026-01-02T03:04:05Z', 'a time that is given is kept');
	eq(Lab.makeRecord({ exp: 'x', stage: 'xin', headline: { label: 'd', value: 1 }, auto: 'typical', extra: { a: [1] } }, NOW).auto, 'typical', 'auto and extra are kept when given');
	var trials = [{ rt: 1 }], made = Lab.makeRecord({ exp: 'x', stage: 'h1', headline: { label: 'd', value: 1 }, trials: trials }, NOW);
	trials[0].rt = 99;
	eq(made.trials[0].rt, 1, 'the trials are copied, not shared');
	throws(function () { Lab.makeRecord({ exp: 'x', stage: 'h7', headline: { label: 'd', value: 1 } }, NOW); }, /stage must be one of h1, h2, h3, m1, m2, m3, xin, xout/, 'an unknown stage throws and lists the stages');
	throws(function () { Lab.makeRecord({ exp: 'my exp', stage: 'h1', headline: { label: 'd', value: 1 } }, NOW); }, /exp must be the experiment's slug/, 'an exp that is not a slug throws');
	throws(function () { Lab.makeRecord({ exp: 'x', stage: 'h1' }, NOW); }, /needs a headline/, 'no headline throws');
	throws(function () { Lab.makeRecord({ exp: 'x', stage: 'h1', headline: { value: 3 } }, NOW); }, /headline needs a label/, 'a headline without a label throws');
	throws(function () { Lab.makeRecord({ exp: 'x', stage: 'h1', headline: { label: 'd', value: 1 }, n: 2.5 }, NOW); }, /n must be a whole number/, 'a fractional n throws');
	throws(function () { Lab.makeRecord({ exp: 'x', stage: 'h1', headline: { label: 'd', value: 1 }, t: 'yesterday' }, NOW); }, /t must be an ISO time/, 'a time that is not ISO throws');

	var list = [];
	for (var i = 0; i < 25; i++) list = Lab.pushRecord(list, { k: i }, Lab.MAX_RECORDS);
	eq([list.length, list[0].k, list[19].k], [20, 5, 24], 'pushRecord keeps the last 20, oldest first');
	eq(Lab.PREFIX, 'lab:v1:', 'records live under lab:v1:<exp>');
	eq(Lab.CAVEAT, 'One participant, one sitting: an anecdote, not a finding. Timing in a browser is approximate.', 'the standard caveat');
	eq(Lab.CONFIDENCE, [50, 60, 70, 80, 90, 100], 'the confidence scale of the obfuscation game');
})();

/* ------------------------------------------------------------------ text and numbers */
section = 'text';
(function () {
	// the answer matching of misc/05-obfuscation-game
	eq(Lab.judge('35 8\n', '35 8'), { correct: true, nearMiss: false }, 'a trailing newline does not matter');
	eq(Lab.judge('  count 15 \r\nprimes [2, 3]  ', 'count 15\nprimes [2, 3]\n'), { correct: true, nearMiss: false }, 'nor do line endings or space at the ends of lines');
	eq(Lab.judge(C(0x201C) + 'a' + C(0x201D) + ' ' + C(0x2018) + 'b' + C(0x2019), '"a" \'b\''), { correct: true, nearMiss: false }, 'curly quotes count as straight ones');
	eq(Lab.judge('gcd 12  lcm 252', 'gcd 12 lcm 252'), { correct: false, nearMiss: true }, 'a difference in blank space alone is a near miss');
	eq(Lab.judge('gcd 12 lcm 251', 'gcd 12 lcm 252'), { correct: false, nearMiss: false }, 'anything else is wrong');
	eq(Lab.judge('SUM 286', 'sum 286').correct, false, 'case matters');
	var game = read('misc/05-obfuscation-game/index.html');
	ok(game.indexOf('.split("\\n").map((l) => l.trim()).join("\\n")') !== -1 && game.indexOf('a.replace(/\\s+/g, "") === e.replace(/\\s+/g, "")') !== -1, 'misc/05-obfuscation-game still matches answers that way');
	ok(/id="confidence" min="50" max="100" step="10"/.test(game), 'and still asks for confidence from 50 to 100 in tens');

	eq(Lab.format(612.4, { unit: 'ms' }), '612' + NBSP + 'ms', 'format: whole milliseconds');
	eq(Lab.format(62.5, { unit: '%' }), '63%', 'format: a percentage');
	eq(Lab.format(7.25, { unit: '%' }), '7.3%', 'format: a small percentage keeps a decimal');
	eq(Lab.format(0.4217), '0.42', 'format: two decimals below 10');
	eq(Lab.format(-0.5, { digits: 2 }), MINUS + '0.50', 'format: a real minus sign, fixed digits');
	eq(Lab.format(84, { unit: 'ms', signed: true }), '+84' + NBSP + 'ms', 'format: signed');
	eq(Lab.format(-0.001), '0.00', 'format: no minus zero');
	eq(Lab.format(12345.6), '12,346', 'format: thousands are grouped from 10,000');
	eq([Lab.format(null), Lab.format(NaN), Lab.format(undefined)], [DASH, DASH, DASH], 'format: no number is a dash');
	eq(Lab.format(612.4, { unit: 'ms', bare: true }), '612', 'format: bare leaves the unit off');
})();

/* ------------------------------------------------------------------ the simulated participant */
section = 'sim';
(function () {
	function run(policy, seed, n, base) {
		var rng = S.rng(seed), out = [];
		for (var i = 0; i < n; i++) {
			var trial = Object.assign({ kind: 'trial', i: i, cond: i % 2 ? 'hard' : 'easy', values: ['a', 'b', 'c'], right: ['b'], correct: 'b', rng: rng }, base || {});
			out.push(Object.assign({ cond: trial.cond }, policy(trial)));
		}
		return out;
	}
	var policy = Lab.sim({ acc: { easy: 0.9, hard: 0.6 }, rt: { easy: 500, hard: 900 } });
	var out = run(policy, 'sim', 4000);
	function share(cond) { var mine = out.filter(function (t) { return t.cond === cond; }); return mine.filter(function (t) { return t.resp === 'b'; }).length / mine.length; }
	function medianRt(cond) { return S.median(out.filter(function (t) { return t.cond === cond; }).map(function (t) { return t.rt; })); }
	near(share('easy'), 0.9, 0.03, 'accuracy by condition: easy near 0.9 (' + share('easy').toFixed(3) + ')');
	near(share('hard'), 0.6, 0.03, 'hard near 0.6 (' + share('hard').toFixed(3) + ')');
	near(medianRt('easy'), 500, 25, 'median time by condition: easy near 500 ms (' + medianRt('easy').toFixed(0) + ')');
	near(medianRt('hard'), 900, 45, 'hard near 900 ms (' + medianRt('hard').toFixed(0) + ')');
	ok(out.every(function (t) { return ['a', 'b', 'c'].indexOf(t.resp) !== -1 && t.rt > 0 && Lab.CONFIDENCE.indexOf(t.confidence) !== -1; }), 'every answer is one of the choices, with a time and a confidence');
	ok(out.some(function (t) { return t.resp === 'a'; }) && out.some(function (t) { return t.resp === 'c'; }), 'a wrong answer is any of the other choices');
	eq(run(policy, 'sim', 50), run(policy, 'sim', 50), 'the same seed replays the same sitting');
	ok(JSON.stringify(run(policy, 'sim', 50)) !== JSON.stringify(run(policy, 'other', 50)), 'another seed plays another');
	var d = run(Lab.sim(), 'd', 4000);
	near(d.filter(function (t) { return t.resp === 'b'; }).length / 4000, 0.85, 0.03, 'defaults: 85% right');
	near(S.median(d.map(function (t) { return t.rt; })), 600, 30, 'defaults: about 600 ms');
	var miss = run(Lab.sim({ miss: 1 }), 'm', 5);
	ok(miss.every(function (t) { return t.resp === null && t.rt === null; }), 'miss: 1 never answers');
	var typed = run(Lab.sim({ acc: 1 }), 't', 3, { kind: 'text', values: [], right: [], correct: '42' });
	ok(typed.every(function (t) { return t.resp === '42'; }), 'a typed trial is answered with the correct text when right');
	var wrong = run(Lab.sim({ acc: 0, text: function (trial, right) { return right ? 'yes' : 'no'; } }), 't', 3, { kind: 'text', values: [], right: [], correct: '42' });
	ok(wrong.every(function (t) { return t.resp === 'no'; }), 'text() chooses what a typed answer says');
	var any = run(Lab.sim(), 'r', 300, { right: [], correct: undefined });
	ok(['a', 'b', 'c'].every(function (v) { return any.some(function (t) { return t.resp === v; }); }), 'with no right answer it picks among all the choices');
	// a simulated answer to the confidence question has the shape of a real one
	ok(out.every(function (t) { return t.confidenceRt >= 400 && t.confidenceRt <= 1400; }), 'every simulated answer carries a confidenceRt (400 to 1400 ms)');
	eq(Object.keys(Lab.simConfidence({ confidence: 90, confidenceRt: 512.34 })).sort(), ['confidence', 'confidenceRt'], 'simConfidence gives confidence and confidenceRt, as a real answer has');
	eq(Lab.simConfidence({ confidence: 90, confidenceRt: 512.34 }), { confidence: 90, confidenceRt: 512.3 }, 'simConfidence keeps a policy\'s own values, to a tenth');
	eq(Lab.simConfidence({ resp: 'a', rt: 500 }), { confidence: 70, confidenceRt: 800 }, 'a policy that gives neither still yields both (70, 800 ms)');
	eq(Lab.simConfidence({ confidence: 75, confidenceRt: -3 }), { confidence: 70, confidenceRt: 800 }, 'off the scale or not a time: the defaults');
	var labSrc = read('misc/_lab/lab.js');
	ok(/assign\(simulated, simConfidence\(answer\)\)/.test(labSrc.slice(labSrc.indexOf('function trial('), labSrc.indexOf('function text('))) &&
		/assign\(simulated, simConfidence\(answer\)\)/.test(labSrc.slice(labSrc.indexOf('function text('))), 'both simulated paths (trial and text) add simConfidence');
	ok(/if \(e\.repeat\) \{ e\.preventDefault\(\); return; \}/.test(labSrc), 'a held Enter on an answer button is held back (its repeats do not click)');
})();

/* ------------------------------------------------------------------ the facts file */
section = 'facts';
(function () {
	var text;
	try { text = read(Facts.FILE); } catch (e) { ok(false, Facts.FILE + ' could not be read: ' + e.message); return; }
	var facts = Facts.parse(text), keys = Object.keys(facts);
	var rawLines = text.split(/\r\n|\r|\n/);
	var factLines = rawLines.filter(function (l) { return /^@fact\b/.test(l); });
	console.log('      ' + Facts.FILE + ' has ' + factLines.length + ' @fact lines');
	ok(factLines.length > 0, 'the facts file has @fact lines');
	eq(keys.length, factLines.length, 'Facts.parse reads every one of them: ' + keys.length + ' facts');
	// Verbatim: each line of the file is exactly "@fact key = value ^ref" with the parsed value and ref.
	var bad = [];
	keys.forEach(function (k) {
		var f = facts[k], line = rawLines[f.line - 1] || '';
		var rebuilt = '@fact ' + f.key + ' = ' + f.value + ' ^' + f.ref;
		if (line.replace(/\s+$/, '') !== rebuilt) bad.push(k + ': ' + JSON.stringify(line) + ' vs ' + JSON.stringify(rebuilt));
		if (f.value !== f.value.trim() || !f.value) bad.push(k + ': empty or padded value');
	});
	ok(bad.length === 0, 'every value and reference is kept verbatim: "@fact key = value ^ref" rebuilds each line' + (bad.length ? '\n        ' + bad.join('\n        ') : ''));
	ok(keys.every(function (k) { return facts[k].ref && (facts[k].ref.charAt(0) === SECTION || /^p\.\d/.test(facts[k].ref)); }), 'every fact carries a section or page reference');
	ok(keys.every(function (k) { return /^[A-Za-z_][\w-]*$/.test(k) && facts[k].key === k; }), 'every key is a plain identifier');
	var numeric = keys.filter(function (k) { return facts[k].num != null; }), ranges = keys.filter(function (k) { return facts[k].range; });
	ok(numeric.length > 0 && numeric.every(function (k) { return typeof facts[k].num === 'number' && isFinite(facts[k].num); }), numeric.length + ' facts are a single number; ' + ranges.length + ' are a range; ' + (keys.length - numeric.length - ranges.length) + ' are neither');
	ok(keys.filter(function (k) { return facts[k].unit === '%'; }).every(function (k) { return /%$/.test(facts[k].value) && facts[k].num >= 0 && facts[k].num <= 100; }), 'every percentage is a number from 0 to 100 and keeps its sign in the value');
	ok(fs.existsSync(path.join(ROOT, Facts.PDF)), 'the abstract the references point into exists: ' + Facts.PDF);
	ok(text.indexOf(Facts.PDF) !== -1, 'and it is the file the facts file names as its source');

	// The story engine reads the same file; when it loads here, both must agree.
	var VN = null;
	try { VN = require('../55-paper-theatre/vn.js'); } catch (e) { VN = null; }
	if (!VN || typeof VN.parse !== 'function') skip('misc/55-paper-theatre/vn.js did not load under Node, so agreement with the story engine was not checked');
	else {
		var theirs = null;
		try { theirs = VN.parse(text).facts; } catch (e) { theirs = null; }
		if (!theirs) skip('VN.parse did not return facts, so agreement with the story engine was not checked');
		else {
			var mine = {}, yours = {};
			keys.forEach(function (k) { mine[k] = [facts[k].value, facts[k].ref]; });
			Object.keys(theirs).forEach(function (k) { yours[k] = [theirs[k].value, theirs[k].ref]; });
			eq(mine, yours, 'the Paper Theatre engine reads the same ' + keys.length + ' values and references from that file');
		}
	}

	// The parser on made-up lines (none of these is a figure of the study).
	var made = Facts.parse([
		C(0xFEFF) + '# a comment', '@fact share = 12.5% ^' + SECTION + '2', '@fact count = 1,234 ^p.3', '@fact word = Forty ^' + SECTION + '1.1',
		'@fact corr = ' + RHO + ' = ' + MINUS + '0.25 ^' + SECTION + '4', '@fact span = ' + RHO + ' = 0.10 to 0.20, p < 0.05 ^' + SECTION + '4', '@fact sizes = 2B to 16B ^' + SECTION + '3',
		'@fact phrase = a long while ^p. 2', '@fact day = 2026-01-02 ^p.2', '@fact bare = 7', '@fact long = first part', '   and the rest ^' + SECTION + '9',
		'@fact share = 13% ^' + SECTION + '5', '@fact broken', 'not a fact = 3 ^' + SECTION + '1', '# @fact hidden = 1 ^' + SECTION + '1'
	].join('\r\n'));
	eq(Object.keys(made), ['share', 'count', 'word', 'corr', 'span', 'sizes', 'phrase', 'day', 'bare', 'long'], 'parse: comments, malformed lines and other lines are skipped');
	eq([made.share.value, made.share.ref, made.share.num, made.share.unit], ['13%', SECTION + '5', 13, '%'], 'parse: a later line with the same key replaces the earlier one');
	eq([made.count.num, made.count.unit, made.count.ref], [1234, '', 'p.3'], 'parse: a grouped number, a page reference');
	eq(made.word.num, 40, 'parse: a number word');
	eq([made.corr.num, made.corr.unit, made.corr.value], [-0.25, RHO, RHO + ' = ' + MINUS + '0.25'], 'parse: a correlation with a real minus sign');
	eq([made.span.num, made.span.range, made.span.unit], [null, [0.1, 0.2], RHO], 'parse: a range has no single number');
	eq([made.sizes.range, made.sizes.unit], [[2, 16], 'B'], 'parse: a range with a unit letter');
	eq([made.phrase.num, made.phrase.ref, made.day.num], [null, 'p.2', null], 'parse: a phrase and a date are not numbers; "p. 2" is p.2');
	eq([made.bare.ref, made.bare.value], [null, '7'], 'parse: a fact without a reference has ref null');
	eq([made.long.value, made.long.ref], ['first part and the rest', SECTION + '9'], 'parse: an indented line continues the one before');
	eq(Facts.parse(''), {}, 'parse: nothing in, nothing out');
	eq([Facts.refWords(SECTION + '3.2'), Facts.refWords('p.2')], ['section 3.2', 'page 2'], 'refWords: a reference in words');
})();

/* ------------------------------------------------------------------ lint-facts */
section = 'lint';
(function () {
	var facts = Facts.parse(read(Facts.FILE));
	var guarded = Object.keys(facts).filter(function (k) { return /%|\d\.\d|\d,\d{3}/.test(facts[k].value) || facts[k].value.indexOf(RHO) !== -1; });
	var counted = guarded.filter(function (k) { return /^\d{1,3},\d{3}$/.test(facts[k].value); })[0];
	var percent = guarded.filter(function (k) { return /^\d+\.\d+%$/.test(facts[k].value); })[0];
	var whole = guarded.filter(function (k) { return /^\d+%$/.test(facts[k].value); })[0];
	var rhoKey = guarded.filter(function (k) { return new RegExp('^' + RHO + ' = ' + MINUS).test(facts[k].value); })[0];
	var rangeKey = guarded.filter(function (k) { return facts[k].range && facts[k].unit === RHO; })[0];
	if (!ok(!!(percent && whole && rhoKey && rangeKey), 'the facts file has the kinds of figure the lint guards (' + guarded.length + ' guarded)')) return;

	var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-lint-'));
	function put(name, body) { fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true }); fs.writeFileSync(path.join(dir, name), body); }
	function messages(r) { return r.failures.map(function (f) { return f.file + ':' + f.line + ' ' + f.message; }).join('\n        '); }
	// The planted calls and escapes are put together from pieces, so that this
	// file itself stays clean under the same lint (it is run on misc/_lab below).
	var CITE = 'Facts' + '.cite', FILL = 'Facts' + '.fill', BACKSLASH = C(92);
	try {
		put('app.js', '// a clean toy\nvar opacity = 0.5, width = "100%";\nel.appendChild(' + CITE + '("' + percent + '"));\n' + FILL + '("from {' + percent + '} on");\n');
		put('index.html', '<style>.bar { width: ' + facts[whole].value + '; }</style>\n<p style="width: ' + facts[whole].value + '">nothing cited by hand</p>\n');
		put('toy.json', JSON.stringify({ slug: 'x', facts: [percent] }));
		var clean = Lint.lint(dir);
		ok(clean.ok && clean.failures.length === 0, 'a clean folder passes (a figure-sized CSS width is not a figure)' + (clean.ok ? '' : '\n        ' + messages(clean)));
		eq([clean.files, clean.guarded, clean.listed, clean.used], [2, guarded.length, [percent], [percent]], 'it reports the files, the guarded figures, the listed and the cited keys');

		// What is layout, not a figure. Every whole percentage of the study is tried
		// in every place a layout percentage is written; none of them may fail.
		var wholes = guarded.filter(function (k) { return /^\d+%$/.test(facts[k].value); }).map(function (k) { return facts[k].value; });
		var Q = '"', BS = BACKSLASH;
		var layoutCases = [
			['a script sets a style', 'app.js', function (w) { return 'el.style.width = "' + w + '";\n'; }],
			['a style chosen by a condition', 'app.js', function (w) { return 'el.style.left = wide ? "' + w + '" : "0";\n'; }],
			['a style by its name in brackets', 'app.js', function (w) { return 'el.style["margin-left"] = \'' + w + '\';\n'; }],
			['cssText', 'app.js', function (w, v) { return 'el.style.cssText = "left: ' + w + '; top: ' + v + '";\n'; }],
			['a CSS colour', 'app.js', function (w) { return 'ctx.fillStyle = "hsl(210 40% ' + w + ')";\n'; }],
			['a CSS colour put together from pieces', 'app.js', function (w) { return 'ctx.fillStyle = "hsl(" + hue + ", 40%, ' + w + ')";\n'; }],
			['a gradient', 'app.js', function (w, v) { return 'var bg = "linear-gradient(90deg, #000 ' + w + ', #fff ' + v + ')";\n'; }],
			['markup with a style attribute, in a string', 'app.js', function (w) { return 'el.innerHTML = \'<i style="width:' + w + '"></i>\';\n'; }],
			['the same with escaped quotes', 'app.js', function (w) { return 'el.innerHTML = "<i style=' + BS + Q + 'width:' + w + BS + Q + '></i>";\n'; }],
			['a d3 attribute', 'app.js', function (w) { return 'stop.attr(\'cx\', \'' + w + '\');\n'; }],
			['setAttribute', 'app.js', function (w) { return 'rect.setAttribute("width", "' + w + '");\n'; }],
			['a style call', 'app.js', function (w) { return 'sel.style("width", "' + w + '"); $(el).css("left", "' + w + '"); el.style.setProperty("--w", "' + w + '");\n'; }],
			['a style object', 'app.js', function (w, v) { return 'Object.assign(el.style, { width: "' + w + '", marginLeft: \'' + v + '\' });\n'; }],
			['a stylesheet in a string', 'app.js', function (w, v) { return 'var css = ".bar { width: ' + w + '; left: ' + v + ' }";\n'; }],
			['a geometry variable', 'app.js', function (w) { return 'var offset = "' + w + '";\n'; }],
			['an SVG gradient stop', 'index.html', function (w, v) { return '<svg><linearGradient id="g"><stop offset="' + v + '"/><stop offset="' + w + '"/></linearGradient></svg>\n'; }],
			['an SVG size', 'index.html', function (w) { return '<svg><rect width="' + w + '" height="10"/></svg>\n'; }],
			['a table column', 'index.html', function (w) { return '<table><col width=\'' + w + '\'><col width=' + w + '></table>\n'; }],
			['a style attribute without quotes', 'index.html', function (w) { return '<div style=width:' + w + '>x</div>\n'; }],
			['a style block', 'index.html', function (w) { return '<style>\n.bar { width: ' + w + '; }\n</style>\n'; }],
			['a stylesheet', 'style.css', function (w) { return '.bar { width: ' + w + '; }\n'; }],
			['an SVG file', 'fig.svg', function (w) { return '<svg xmlns="http://www.w3.org/2000/svg"><rect x="' + w + '" width="' + w + '"/></svg>\n'; }],
			['the remainder operator in a code stimulus', 'app.js', function (w) { return 'window.ITEMS = [{ source: "print(' + w.replace('%', ' % 4') + ')" }, { source: "if ' + w.replace('%', ' % 2 == 0') + ':" }];\n'; }],
			['the remainder operator without spaces', 'app.js', function (w) { return 'var r = ' + w + '7;\n'; }]
		];
		var cried = [];
		layoutCases.forEach(function (c) {
			wholes.forEach(function (w, i) {
				put(c[1], c[2](w, wholes[(i + 1) % wholes.length]));
				var r = Lint.lint(dir);
				if (!r.ok || r.warnings.length) cried.push(c[0] + ' with ' + w + ': ' + (messages(r) || r.warnings[0].message));
			});
			if (c[1] !== 'app.js' && c[1] !== 'index.html') fs.rmSync(path.join(dir, c[1]));
		});
		ok(cried.length === 0, layoutCases.length + ' ways to write a layout percentage, each with the ' + wholes.length + ' whole percentages of the study: none is taken for a figure' +
			(cried.length ? '\n        ' + cried.join('\n        ') : ''));
		// ...and the same percentages where a reader would see them still fail
		var shownCases = [
			['text of the page', 'index.html', function (w) { return '<p>About ' + w + ' of the trials are catch trials.</p>\n'; }],
			['a string a script shows', 'app.js', function (w) { return 'el.textContent = "' + w + '";\n'; }],
			['a label in a data table', 'app.js', function (w) { return 'var rows = [{ label: "L3", value: "' + w + '" }];\n'; }],
			['a tooltip set through the DOM', 'app.js', function (w) { return 'el.setAttribute("title", "' + w + '");\n'; }],
			['a title attribute', 'index.html', function (w) { return '<p title="' + w + '">x</p>\n'; }],
			['a sentence that only starts like a declaration', 'app.js', function (w) { return 'var s = "Width: ' + w + ' of the screen";\n'; }],
			['a percentage followed by a number', 'app.js', function (w) { return 'var s = "' + w + ' 4";\n'; }],
			['a content: rule in a style block', 'index.html', function (w) { return '<style>.x::after { content: "' + w + '"; width: 10px; }</style>\n'; }],
			['a content: rule in a stylesheet', 'style.css', function (w) { return '.x::after { content: "' + w + '"; }\n'; }],
			['text in an SVG file', 'fig.svg', function (w) { return '<svg xmlns="http://www.w3.org/2000/svg"><text x="10">' + w + '</text></svg>\n'; }]
		];
		var slipped = [];
		put('app.js', 'var a = 1;\n');
		put('index.html', '<p>nothing</p>\n');
		shownCases.forEach(function (c) {
			put(c[1], c[2](wholes[0]));
			var r = Lint.lint(dir);
			if (r.ok || r.failures.length !== 1 || r.failures[0].file !== c[1]) slipped.push(c[0]);
			if (c[1] === 'app.js') put('app.js', 'var a = 1;\n');
			else if (c[1] === 'index.html') put('index.html', '<p>nothing</p>\n');
			else fs.rmSync(path.join(dir, c[1]));
		});
		ok(slipped.length === 0, shownCases.length + ' places where the reader would see the same percentage: every one still fails' + (slipped.length ? ' (not: ' + slipped.join('; ') + ')' : ''));
		eq(Lint.layout('a\n<p style="width: 12%">\nb</p>').split('\n').length, 3, 'blanking what is layout keeps every line break, so line numbers hold');
		eq(Lint.cssText('.a { width: 12%; }\n.a::after { content: "12 of them"; }').replace(/\s+/g, ' ').trim(), '"12 of them"', 'of a stylesheet only the content: rules are read');

		// the planted figure
		put('app.js', 'var a = 1;\nvar s = "In the study it was ' + facts[percent].value + '";\n');
		var planted = Lint.lint(dir);
		ok(!planted.ok && planted.failures.length === 1 && planted.failures[0].file === 'app.js' && planted.failures[0].line === 2 && planted.failures[0].message.indexOf(percent) !== -1,
			'a figure written out in a .js file fails, with the file, the line and the key' + (planted.ok ? '' : ' (app.js:' + planted.failures[0].line + ', ' + percent + ')'));
		ok(!planted.ok && planted.failures[0].message.indexOf(Lint.MARKER) !== -1, 'and the message names the marker for a line that is not the study\'s figure');
		put('app.js', 'var s = "In the study it was ' + facts[percent].value + '"; // lint-facts-ok: a test\n');
		ok(Lint.lint(dir).ok, 'the marker lint-facts-ok on that line lets it through');

		// other spellings of the same figure
		var rhoPlain = facts[rhoKey].value.split(RHO).join(BACKSLASH + 'u03c1').split(MINUS).join(BACKSLASH + 'u2212');
		put('app.js', 'var s = "' + rhoPlain + '";\n');
		ok(!Lint.lint(dir).ok, 'written with escapes it still fails');
		put('app.js', 'var s = "' + facts[rhoKey].value.split(RHO).join('rho').split(MINUS).join('-') + '";\n');
		ok(!Lint.lint(dir).ok, 'written as "rho" with a hyphen it still fails');
		put('app.js', 'var a = 1;\n');
		put('index.html', '<p>' + facts[rhoKey].value.split(RHO).join('&rho;').split(MINUS).join('&minus;') + '</p>\n');
		ok(!Lint.lint(dir).ok, 'written with entities in a .html file it still fails');
		put('index.html', '<p>' + facts[whole].value.replace('%', ' percent') + '</p>\n');
		ok(!Lint.lint(dir).ok, 'a percentage written with the word percent still fails');
		var range = facts[rangeKey].range;
		put('index.html', '<p>between ' + facts[rangeKey].value.replace(/^.*?(\d[\d.]*) to (\d[\d.]*).*$/, '$1' + C(0x2013) + '$2') + '</p>\n');
		ok(!Lint.lint(dir).ok && range.length === 2, 'the range inside a longer figure, written with a dash, still fails');
		put('index.html', '<p>nothing</p>\n');
		if (counted) {
			put('app.js', 'var runs = "' + facts[counted].value + ' of them";\n');
			var withComma = Lint.lint(dir);
			put('app.js', 'var runs = ' + facts[counted].value.replace(',', '') + ';\n');
			ok(!withComma.ok && !Lint.lint(dir).ok, 'a count with a thousands comma fails, with or without its comma');
			put('app.js', 'var a = 1;\n');
		} else skip('the facts file has no count with a thousands comma');
		put('data/deep/more.js', 'var t = "' + facts[whole].value + '";\n');
		var deep = Lint.lint(dir);
		ok(!deep.ok && deep.failures[0].file === 'data/deep/more.js', 'files in subfolders are checked too');
		fs.rmSync(path.join(dir, 'data'), { recursive: true, force: true });
		put('notes.md', facts[percent].value + '\n');
		var notes = Lint.lint(dir);
		ok(notes.ok && notes.warnings.length === 0, 'a file the page does not load (notes.md) is not read');
		put('data.json', '{"v": "' + facts[percent].value + '"}\n');
		var inJson = Lint.lint(dir);
		ok(inJson.ok && inJson.warnings.length === 1 && inJson.warnings[0].file === 'data.json' && /JSON/.test(inJson.warnings[0].message) && inJson.warnings[0].message.indexOf(percent) !== -1,
			'a figure in a .json data file warns (JSON cannot carry the marker) and does not fail');
		fs.rmSync(path.join(dir, 'data.json'));
		// a range written without the last zero of a decimal
		var loose = facts[rangeKey].value.replace(/^.*?(\d[\d.]*) to (\d[\d.]*).*$/, function (m, a, b) { return a.replace(/0+$/, '') + ' to ' + b.replace(/0+$/, ''); });
		if (loose !== facts[rangeKey].value.replace(/^.*?(\d[\d.]*) to (\d[\d.]*).*$/, '$1 to $2')) {
			put('app.js', 'var t = "' + loose + '";\n');
			ok(!Lint.lint(dir).ok, 'a range written without the last zero of a decimal still fails');
		} else skip('the facts file has no range with a decimal that ends in zero');
		put('app.js', 'var a = 1;\n');

		// the card text of toy.json: printed on the public Misc tab, where nothing can be cited
		['desc', 'title', 'note'].forEach(function (field) {
			var manifest = { slug: 'x', title: 'A toy', desc: 'What it does.', note: '', facts: [percent] };
			manifest[field] = 'It fell to ' + facts[percent].value + ' in the study.';
			put('toy.json', JSON.stringify(manifest, null, '\t'));
			var card = Lint.lint(dir);
			ok(!card.ok && card.failures.length === 1 && card.failures[0].file === 'toy.json' && card.failures[0].line > 1 && card.failures[0].message.indexOf('"' + field + '"') !== -1,
				'a figure in the "' + field + '" of toy.json fails, with its line');
		});
		put('toy.json', JSON.stringify({ slug: 'x', title: 'A toy', desc: 'Eighteen numbers, about a minute. Nothing is at 100%.', facts: [percent] }));
		ok(Lint.lint(dir).ok, 'card text without a figure of the study passes');

		// the bare number warns, without failing
		put('app.js', 'var x = ' + facts[percent].num + ';\n');
		var warned = Lint.lint(dir);
		ok(warned.ok && warned.warnings.length === 1 && warned.warnings[0].message.indexOf(percent) !== -1, 'the bare number of a percentage warns and does not fail');
		put('app.js', 'var x = ' + (facts[percent].num / 100).toFixed(3) + ';\n');
		var asShare = Lint.lint(dir);
		ok(asShare.ok && asShare.warnings.length === 1 && /share of one/.test(asShare.warnings[0].message), 'so does the same percentage written as a share of one');
		put('app.js', 'var x = 1' + facts[percent].num + ', y = "1' + facts[whole].value + '";\n');
		var inside = Lint.lint(dir);
		ok(inside.ok && inside.warnings.length === 0, 'a figure inside a longer number is not a match');

		// keys
		put('app.js', 'var a = 1;\n');
		put('toy.json', JSON.stringify({ slug: 'x', facts: [percent, 'no_such_fact'] }));
		var listed = Lint.lint(dir);
		ok(!listed.ok && /no_such_fact/.test(listed.failures[0].message) && listed.failures[0].file === 'toy.json', 'toy.json listing a key that is not in the facts file fails');
		put('toy.json', JSON.stringify({ slug: 'x', facts: 'all' }));
		ok(!Lint.lint(dir).ok, 'toy.json "facts" that is not a list fails');
		put('toy.json', JSON.stringify({ slug: 'x' }));
		put('app.js', CITE + '("no_such_fact");\n');
		ok(!Lint.lint(dir).ok, 'asking Facts.cite for an unknown key fails');
		put('app.js', FILL + '("it was {' + percent + '} and {no_such_fact}");\n');
		ok(!Lint.lint(dir).ok, 'so does an unknown key in a Facts.fill template');
		put('app.js', CITE + '("' + percent + '");\n');
		var unlisted = Lint.lint(dir);
		ok(unlisted.ok && unlisted.warnings.length === 1 && /add it to "facts" in toy\.json/.test(unlisted.warnings[0].message), 'a cited key that toy.json does not list warns');

		// the command line
		var script = path.join(HERE, 'lint-facts.js');
		function cli(args) { return childProcess.spawnSync(process.execPath, [script].concat(args), { encoding: 'utf8' }); }
		put('toy.json', JSON.stringify({ slug: 'x', facts: [percent] }));
		var good = cli([dir]);
		ok(good.status === 0 && /^PASS  /m.test(good.stdout), 'node lint-facts.js <clean folder> exits 0 and prints PASS');
		put('app.js', 'var s = "' + facts[percent].value + '";\n');
		var badRun = cli([dir]);
		ok(badRun.status === 1 && /^FAIL  .*app\.js:1  /m.test(badRun.stdout), 'on the planted folder it exits 1 and names app.js:1');
		eq(cli([path.join(dir, 'nowhere')]).status, 2, 'a folder that does not exist exits 2');
		eq(cli([]).status, 2, 'no folder at all exits 2');
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
	ok(!fs.existsSync(dir), 'the scratch folder is gone again');

	var own = Lint.lint(HERE);
	ok(own.ok && own.warnings.length === 0, 'misc/_lab itself writes out none of the study\'s figures (' + own.files + ' files)' + (own.ok ? '' : '\n        ' + messages(own)));
})();

/* ------------------------------------------------------------------ charts (the markup, without a browser) */
section = 'charts';
(function () {
	var B = Chart.build;
	function sane(built, label) {
		var m = built.markup;
		var good = /^<svg class="lab-chart lab-chart-\w+( is-empty)?" /.test(m) && /<\/svg>$/.test(m) && m.indexOf('role="img"') !== -1 &&
			!/NaN|undefined|Infinity/.test(m) && built.summary.length > 10 && m.indexOf('aria-label="' + built.summary.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') + '"') !== -1;
		ok(good, label + ': one <svg> with role="img", its summary as aria-label, and no NaN in it');
	}
	function count(built, re) { return (built.markup.match(re) || []).length; }

	// bars. One bar of 50 on a scale from 0 to 100, 340 by 220. The plot runs from y = 24 (6 + 18 of
	// head room) to y = 198 (22 for the labels): 174 px for 100 units. So the bar's top is at
	// 198 - 87 = 111, and a whisker from 25 to 75 runs from 198 - 130.5 = 67.5 to 198 - 43.5 = 154.5.
	var one = B.bars([{ label: 'a', value: 50, lo: 25, hi: 75, n: 12 }], { yMax: 100, unit: '%' });
	sane(one, 'bars');
	ok(/<path class="lc-bar lc-fill lc-s1" d="M[\d.]+ 198V115Q[\d.]+ 111 /.test(one.markup), 'bars: a bar of 50 on 0 to 100 rises from 198 to 111');
	ok(/<path class="lc-whisker" d="M[\d.]+ 67\.5V154\.5M/.test(one.markup), 'bars: its whisker from 25 to 75 runs from 154.5 to 67.5');
	eq(one.summary, 'Bar chart. a 50% (25 to 75), n = 12.', 'bars: the summary says the value, the interval and n');
	eq(one.table, { head: ['Condition', 'Value', 'Low', 'High', 'n'], rows: [['a', '50', '25', '75', '12']] }, 'bars: the table has the same numbers');
	eq([one.width, one.height], [340, 220], 'the default size is 340 by 220');
	var two = B.bars([{ label: 'clean code', value: 612, lo: 540, hi: 690 }, { label: 'renamed identifiers everywhere', value: 745 }], { title: 'Median time', unit: 'ms', yLabel: 'ms' });
	sane(two, 'bars (two)');
	eq(count(two, /class="lc-bar /g), 2, 'bars: one bar per row');
	eq(count(two, /class="lc-whisker"/g), 1, 'bars: a whisker only where lo and hi are given');
	ok(two.summary.indexOf('Median time. clean code 612 ms (540 to 690); renamed identifiers everywhere 745 ms.') === 0, 'bars: the title leads the summary');
	ok(count(two, /class="lc-tick lc-cat"/g) >= 3, 'bars: a long label is wrapped onto two lines');
	var neg = B.bars([{ label: 'a', value: -20, lo: -30, hi: -10 }, { label: 'b', value: 30 }]);
	sane(neg, 'bars (negative)');
	ok(neg.markup.indexOf(MINUS + '20') !== -1, 'bars: a negative value is labelled with a real minus sign');
	var negLabel = /<text class="lc-value" x="[\d.]+" y="([\d.]+)"[^>]*>[^<]*20<\/text>/.exec(neg.markup), zeroLine = /<line class="lc-axis" x1="[\d.]+" x2="[\d.]+" y1="([\d.]+)"/.exec(neg.markup);
	ok(negLabel && zeroLine && Number(negLabel[1]) < Number(zeroLine[1]), 'bars: the value of a bar that points down is still written above it, clear of the axis labels');
	var five = B.bars(['clean', 'renamed', 'dead code', 'flattened control flow', 'string encoding'].map(function (l, i) { return { label: l, value: 600 + 50 * i }; }));
	ok(['>flattened<', '>control<', '>flow<', '>string<', '>encoding<'].every(function (t) { return five.markup.indexOf(t) !== -1; }) && five.markup.indexOf(C(0x2026)) === -1,
		'bars: with five bars a three-word label takes three lines and nothing is cut');
	var tenLetters = B.bars(['clean', 'renamed', 'dead code', 'misleading names', 'flattened'].map(function (l, i) { return { label: l, value: 600 + 50 * i }; }));
	ok(tenLetters.markup.indexOf('>misleading<') !== -1 && tenLetters.markup.indexOf(C(0x2026)) === -1, 'bars: with five bars the ten-letter word "misleading" is whole');
	var tied = B.dots(['a', 'b', 'c', 'd'].map(function (l) { var v = []; for (var i = 0; i < 45; i++) v.push(50 + 10 * (i % 6)); return { label: l, values: v }; }), { title: 'ties' });
	var circles = [], cre = /<circle class="lc-dot[^"]*" cx="([\d.-]+)" cy="([\d.-]+)" r="([\d.]+)"/g, cm;
	while ((cm = cre.exec(tied.markup))) circles.push({ x: +cm[1], y: +cm[2], r: +cm[3] });
	var touching = 0;
	for (var ci = 0; ci < circles.length; ci++) for (var cj = ci + 1; cj < circles.length; cj++) {
		var ddx = circles[ci].x - circles[cj].x, ddy = circles[ci].y - circles[cj].y;
		if (Math.sqrt(ddx * ddx + ddy * ddy) < circles[ci].r + circles[cj].r - 0.2) touching++;
	}
	var counted = 0, more = /lc-more"[^>]*>\+(\d+)</g, mm;
	while ((mm = more.exec(tied.markup))) counted += +mm[1];
	eq(touching, 0, 'dots: four groups of 45 values tied on six levels: no dot drawn on another (' + circles.length + ' drawn, r = ' + (circles[0] && circles[0].r) + ')');
	eq(circles.length + counted, 180, 'dots: every value is either drawn or counted beside its row ("+n"), 180 in all');
	var few = B.dots([{ label: 'a', values: [1, 2, 2, 3] }]);
	ok(few.markup.indexOf('lc-more') === -1 && / r="4"/.test(few.markup), 'dots: a small sitting keeps 4 px dots and needs no count');
	sane(B.bars([], {}), 'bars (empty)');
	ok(B.bars([], { title: 'T' }).summary === 'T. Nothing to plot.' && B.bars(null).markup.indexOf('>Nothing to plot<') !== -1 && B.bars([]).height < 100, 'no data draws a short "Nothing to plot" instead of failing');
	var evil = B.bars([{ label: '<script>alert(1)</script> & "x"', value: 1 }], { title: 'a < b' });
	ok(evil.markup.indexOf('<script>') === -1 && evil.markup.indexOf('&lt;script&gt;') !== -1 && evil.markup.indexOf('aria-label="a &lt; b.') !== -1, 'labels are escaped');

	// scatter. y = 2x + 1 exactly: rho 1, the line through every point.
	var pts = [1, 2, 3, 4, 5, 6].map(function (x) { return { x: x, y: 2 * x + 1, label: 'item ' + x }; });
	var sc = B.scatter(pts, { xLabel: 'length', yLabel: 'time' });
	sane(sc, 'scatter');
	eq(count(sc, /class="lc-dot /g), 6, 'scatter: one dot per point');
	eq(count(sc, /class="lc-fit"/g), 1, 'scatter: a fitted line');
	ok(sc.markup.indexOf('>' + RHO + ' = 1.00, n = 6<') !== -1, 'scatter: the rho label (rho = 1.00, n = 6)');
	eq(sc.summary, 'Scatter plot. time against length, 6 points. Spearman rho 1.00. The fitted line rises: slope 2.', 'scatter: the summary');
	eq(sc.table.head, ['Item', 'length', 'time'], 'scatter: the table names its columns');
	var down = B.scatter([{ x: 1, y: 9 }, { x: 2, y: 7 }, { x: 3, y: 2 }, { x: 4, y: 1 }]);
	ok(down.markup.indexOf('>' + RHO + ' = ' + MINUS + '1.00, n = 4<') !== -1 && /falls/.test(down.summary), 'scatter: a falling relation has rho -1 and a line that falls');
	var plain = B.scatter(pts, { fit: false, rho: false, identity: true });
	ok(count(plain, /class="lc-fit"/g) === 0 && plain.markup.indexOf(RHO) === -1 && count(plain, /class="lc-ref"/g) === 1, 'scatter: fit and rho can be turned off; identity draws the dashed diagonal');
	var grouped = B.scatter([{ x: 1, y: 1, group: 'a' }, { x: 2, y: 3, group: 'b' }, { x: 3, y: 2, group: 'a' }, { x: 4, y: 5, group: 'c' }, { x: 5, y: 4, group: 'd' }]);
	sane(grouped, 'scatter (groups)');
	ok(count(grouped, /class="lc-legend"/g) === 3 && count(grouped, /lc-fill lc-s[123]"/g) >= 5, 'scatter: at most three groups get a colour and a key');
	sane(B.scatter([{ x: 1, y: 1 }]), 'scatter (one point)');
	sane(B.scatter([{ x: 2, y: 5 }, { x: 2, y: 5 }, { x: 2, y: 5 }]), 'scatter (no spread)');

	// line
	var curve = [1, 2, 4, 8, 16].map(function (t) { return { x: t, y: 6 / t }; });
	var fit = S.fitExpVsPower(curve.map(function (p) { return p.x; }), curve.map(function (p) { return p.y; }));
	var ln = B.line([{ name: 'recall', points: curve }], { xLabel: 'delay (s)', yLabel: 'score', curves: [{ name: 'exponential', fn: fit.exp.predict }, { name: 'power', fn: fit.power.predict }] });
	sane(ln, 'line');
	eq([count(ln, /<polyline class="lc-line /g), count(ln, /class="lc-dot /g), count(ln, /<path class="lc-curve /g), count(ln, /class="lc-legend"/g)], [1, 5, 2, 3], 'line: one line, five markers, two fitted curves, three keys');
	ok(/recall: 5 points, from 6 at 1 to 0.38 at 16/.test(ln.summary) && /Fitted curves: exponential, power\./.test(ln.summary), 'line: the summary');
	eq(ln.table.head, ['delay (s)', 'recall', 'exponential', 'power'], 'line: the table has a column per series and per curve');
	var long = [];
	for (var i = 1; i <= 60; i++) long.push({ x: i, y: 600 + 100 * Math.sin(i) });
	var crowded = B.line(long);
	sane(crowded, 'line (60 points)');
	eq([count(crowded, /class="lc-dot /g), count(crowded, /class="lc-hit"/g), count(crowded, /class="lc-legend"/g)], [0, 60, 0], 'line: a long series is a line without markers, each point keeps its tooltip, and one series has no key');
	var multi = B.line([{ name: 'a', points: [{ x: 1, y: 1, lo: 0.5, hi: 1.5 }, { x: 2, y: 2 }] }, { name: 'b', points: [{ x: 1, y: 2 }, { x: 2, y: 1 }] }]);
	ok(count(multi, /<polyline/g) === 2 && count(multi, /class="lc-whisker"/g) === 1 && count(multi, /class="lc-legend"/g) === 2, 'line: two series, a key for each, a whisker where given');
	sane(B.line([]), 'line (empty)');

	// dots
	var dt = B.dots([{ label: 'clean', values: [500, 520, 520, 610, 480] }, { label: 'renamed', values: [700, 650, null, 820] }], { unit: 'ms' });
	sane(dt, 'dots');
	eq(count(dt, /class="lc-dot /g), 8, 'dots: one dot per number (a null is dropped)');
	eq(count(dt, /class="lc-median"/g), 2, 'dots: a median tick per group');
	ok(/clean: 5 values, median 520 ms, from 480 to 610; renamed: 3 values, median 700 ms, from 650 to 820\./.test(dt.summary), 'dots: the summary has n, median and range per group');
	eq(dt.table.rows, [['clean', '5', '520', '480', '610'], ['renamed', '3', '700', '650', '820']], 'dots: the table too');
	eq(B.dots([{ label: 'a', values: [1, 1, 1, 1, 1, 1, 1, 1] }]).markup, B.dots([{ label: 'a', values: [1, 1, 1, 1, 1, 1, 1, 1] }]).markup, 'dots: the same data always gives the same picture');
	var stacked = B.dots([{ label: 'a', values: [1, 1, 1, 1, 1, 1, 1, 1] }]).markup.match(/class="lc-dot [^"]*" cx="([\d.]+)"/g);
	ok(stacked.length === 8 && new Set(stacked).size === 8, 'dots: equal values sit side by side, not on top of each other');
	sane(B.dots([{ label: 'none', values: [] }, { label: 'some', values: [3] }]), 'dots (an empty group)');

	// histogram
	var values = [];
	var g = S.rng('hist');
	for (i = 0; i < 200; i++) values.push(Math.round(g.normal(600, 120)));
	var h = B.histogram(values, { xLabel: 'ms', marks: [{ x: S.median(values), label: 'median' }] });
	sane(h, 'histogram');
	var total = h.table.rows.reduce(function (s, row) { return s + Number(row[1]); }, 0);
	eq(total, 200, 'histogram: every value is in exactly one bin');
	ok(h.table.rows.length >= 5 && h.table.rows.length <= 24, 'histogram: between 5 and 24 bins without being told (' + h.table.rows.length + ')');
	ok(h.table.rows.every(function (row) { return /^-?[\d,.]+ to -?[\d,.]+$/.test(row[0].replace(new RegExp(MINUS, 'g'), '-')); }) && /0 to \d+0$/.test(h.table.rows[0][0]), 'histogram: the bins have round edges (' + h.table.rows[0][0] + ', ...)');
	ok(count(h, /class="lc-markline"/g) === 1 && h.markup.indexOf('>median<') !== -1, 'histogram: a marked value is drawn and labelled');
	eq(B.histogram(values, { bins: 4 }).table.rows.length <= 8, true, 'histogram: bins asks for about that many');
	var same = B.histogram([5, 5, 5]);
	sane(same, 'histogram (no spread)');
	eq(same.table.rows.reduce(function (s, row) { return s + Number(row[1]); }, 0), 3, 'histogram: values without spread still land in a bin');
	// whole numbers over a short range: one bar per number, named by the number
	var spans = B.histogram([3, 3, 3, 4, 4, 5, 9], { xLabel: 'items' });
	sane(spans, 'histogram (whole numbers)');
	eq(spans.table, { head: ['items', 'Count'], rows: [['3', '3'], ['4', '2'], ['5', '1'], ['6', '0'], ['7', '0'], ['8', '0'], ['9', '1']] }, 'histogram: whole numbers get one bar each, named by the number');
	ok(/The most common value is 3 with 3\./.test(spans.summary) && count(spans, /class="lc-bar /g) === 4, 'histogram: and the summary names the most common one');
	ok(/ to /.test(B.histogram([3, 3, 3, 4, 4, 5, 9], { discrete: false }).table.rows[0][0]), 'histogram: discrete: false bins them like any other numbers');
	ok(/ to /.test(B.histogram([100, 150, 180, 240]).table.rows[0][0]), 'histogram: whole numbers far apart are binned');
	sane(B.histogram([]), 'histogram (empty)');
	sane(B.histogram([1.5, 2.5, 2.7, 9.1], { width: 280, height: 160 }), 'histogram (280 wide)');

	eq(Chart.fmt(1234.5), '1235', 'fmt: no decimals from 100');
	eq(Chart.fmt(12.345), '12.3', 'fmt: one decimal from 10');
	eq(Chart.fmt(0.5), '0.5', 'fmt: trailing zeros go');
	eq(Chart.fmt(-3), MINUS + '3', 'fmt: a real minus sign');
	eq(Chart.niceScale(0, 97, 4).ticks, [0, 50, 100], 'niceScale: round ticks (97 / 4 = 24.25 rounds up to steps of 50)');
	eq(Chart.niceScale(0, 745, 4).ticks, [0, 200, 400, 600, 800], 'niceScale: steps of 1, 2 or 5 times a power of ten');
	eq(Chart.niceScale(0.12, 0.38, 4).ticks, [0.1, 0.2, 0.3, 0.4], 'niceScale: without floating-point dust');
})();

/* ------------------------------------------------------------------ the kit's own files */
section = 'files';
(function () {
	['stats.js', 'chart.js', 'facts.js', 'lab.js', 'lint-facts.js', 'test.js'].forEach(function (name) {
		var src = fs.readFileSync(path.join(HERE, name), 'utf8');
		try { new vm.Script(src, { filename: name }); ok(true, name + ' compiles'); }
		catch (e) { ok(false, name + ' does not compile: ' + e.message); }
	});
	// A special character typed into a source file can arrive damaged, or as a
	// byte-order mark nobody sees. The kit builds such characters from their codes.
	['stats.js', 'chart.js', 'facts.js', 'lab.js', 'lint-facts.js', 'test.js', 'lab.css'].forEach(function (name) {
		var src = fs.readFileSync(path.join(HERE, name), 'utf8'), bad = [];
		for (var i = 0; i < src.length && bad.length < 3; i++) {
			var code = src.charCodeAt(i);
			if (code > 126 || (code < 32 && code !== 9 && code !== 10 && code !== 13)) bad.push('U+' + code.toString(16) + ' at ' + i);
		}
		ok(bad.length === 0, name + ' is plain ASCII' + (bad.length ? ' (' + bad.join(', ') + ')' : ''));
	});
	var readme;
	try { readme = fs.readFileSync(path.join(HERE, 'README.md'), 'utf8'); } catch (e) { ok(false, 'README.md could not be read'); return; }
	var names = ['Lab.session', 'session.instructions', 'session.trial', 'session.text', 'session.progress', 'session.pause', 'session.results', 'session.finish',
		'session.each', 'session.loop', 'Lab.latin', 'Lab.shuffle', 'Lab.rng', 'Lab.auto', 'Lab.sim', 'Lab.save', 'Lab.history', 'Lab.latest', 'Lab.all', 'Lab.clear',
		'Lab.STAGES', 'Lab.stage(', 'Lab.stageLabel', 'Lab.stageChip', 'Lab.caveat', 'Lab.headline', 'Lab.code', 'Lab.fail', 'Lab.judge', 'Lab.normalize', 'Lab.format',
		'Lab.each', 'Lab.last', 'Lab.isAuto', 'Lab.autoName', 'Lab.CONFIDENCE', 'Lab.CAVEAT', 'data-phase',
		'LabChart.bars', 'LabChart.scatter', 'LabChart.line', 'LabChart.dots', 'LabChart.histogram', 'LabChart.figure', 'LabChart.mount',
		'Facts.parse', 'Facts.load', 'Facts.get', 'Facts.all', 'Facts.cite', 'Facts.fill', 'Facts.source', 'lint-facts.js'];
	Object.keys(S).forEach(function (k) { if (typeof S[k] === 'function') names.push(k); });
	var missing = names.filter(function (n) { return readme.indexOf(n) === -1; });
	ok(missing.length === 0, 'README.md mentions every one of the ' + names.length + ' names of the API' + (missing.length ? ' (missing: ' + missing.join(', ') + ')' : ''));
	var guarded = Lint.patterns(Facts.parse(read(Facts.FILE))).filter(function (p) { return p.fails; });
	var leaked = guarded.filter(function (p) { p.re.lastIndex = 0; return p.re.test(Lint.decode(readme)); }).map(function (p) { return p.key; });
	ok(leaked.length === 0, 'README.md writes out none of the study\'s figures' + (leaked.length ? ' (' + leaked.join(', ') + ')' : ''));
	var css = fs.readFileSync(path.join(HERE, 'lab.css'), 'utf8');
	ok(!/@keyframes|animation\s*:/.test(css), 'lab.css has no animation');
	var loose = (css.match(/transition\s*:[^;]*;/g) || []).filter(function (t) { return t.indexOf('var(--dur') === -1; });
	ok(loose.length === 0, 'every transition in lab.css uses a kit duration token, which is zero under reduced motion' + (loose.length ? ' (' + loose.join(' ') + ')' : ''));
	ok(/:root\s*\{[^}]*--lab-c1/.test(css) && /:root\[data-theme="dark"\]\s*\{[^}]*--lab-c1/.test(css), 'lab.css sets the chart colours for the light and for the dark theme');
	var lab = fs.readFileSync(path.join(HERE, 'lab.js'), 'utf8');
	ok(lab.indexOf('performance.now()') !== -1 && lab.indexOf('e.timeStamp') !== -1 && lab.indexOf('requestAnimationFrame') !== -1, 'lab.js times with performance.now(), event time stamps and animation frames');
	ok(!/Math\.random\(/.test(lab) && !/Math\.random\(/.test(fs.readFileSync(path.join(HERE, 'stats.js'), 'utf8')) && !/Math\.random\(/.test(fs.readFileSync(path.join(HERE, 'chart.js'), 'utf8')), 'no file of the kit calls Math.random()');
})();

console.log('\n' + passed + ' passed, ' + failed + ' failed' + (skipped ? ', ' + skipped + ' skipped' : ''));
process.exitCode = failed ? 1 : 0;
