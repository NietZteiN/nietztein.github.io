/*
 * TinyNet: a tiny neural-network trainer in plain JavaScript (misc/_tinynet).
 *
 * Two things live here:
 *   1. a small generic dense network (create, forward, backward, losses,
 *      optimisers, serialise, lerp, a per-unit hook), and
 *   2. TinyNet.grok(): a trainer for "a + b mod p" with one hidden layer,
 *      full-batch AdamW and cross-entropy, plus the experiments the toys on
 *      this site run on it (spectrum, unlearning, merging, gradient-similarity
 *      attribution, loss-landscape slices).
 *
 * Pure UMD: window.TinyNet, self.TinyNet in a worker, module.exports in Node.
 * No DOM, no dependencies, no Math.random. Training uses only + - * / and
 * Math.sqrt on IEEE doubles (exp and log are implemented below), so a run with
 * a given seed gives the same bits on any conforming engine.
 *
 * README.md in this folder is the reference.
 */
(function (root, factory) {
	'use strict';
	if (typeof module === 'object' && module && typeof module.exports === 'object') module.exports = factory();
	else root.TinyNet = factory();
})(typeof self !== 'undefined' ? self : this, function () {
	'use strict';

	// ------------------------------------------------------------------
	// Deterministic exp and log. Math.exp and Math.log are
	// "implementation-approximated" in the language spec; these use basic
	// arithmetic only, so every engine computes the same bits.
	//
	// The method and the constants are those of fdlibm's e_exp.c and
	// e_log.c, whose notice reads:
	//
	//   Copyright (C) 1993 by Sun Microsystems, Inc. All rights reserved.
	//   Developed at SunSoft, a Sun Microsystems, Inc. business.
	//   Permission to use, copy, modify, and distribute this
	//   software is freely granted, provided that this notice
	//   is preserved.
	//
	// Changed here: written in JavaScript; the exponent is found and
	// applied with exact multiplications by powers of two instead of
	// bit operations; one branch of each function is used throughout.
	// ------------------------------------------------------------------

	var LN2_HI = 6.93147180369123816490e-01;
	var LN2_LO = 1.90821492927058770002e-10;
	var INV_LN2 = 1.44269504088896338700e+00;
	var HALF_LN2 = 0.34657359027997264;
	var EP1 = 1.66666666666666019037e-01;
	var EP2 = -2.77777777770155933842e-03;
	var EP3 = 6.61375632143793436117e-05;
	var EP4 = -1.65339022054652515390e-06;
	var EP5 = 4.13813679705723846039e-08;
	var LG1 = 6.666666666666735130e-01;
	var LG2 = 3.999999999940941908e-01;
	var LG3 = 2.857142874366239149e-01;
	var LG4 = 2.222219843214978396e-01;
	var LG5 = 1.818357216161805012e-01;
	var LG6 = 1.531383769920937332e-01;
	var LG7 = 1.479819860511658591e-01;
	var SQRT2 = 1.4142135623730951;
	var SQRT1_2 = 0.7071067811865476;

	// POW2[k + 1075] = 2^k for k in [-1074, 1023], built by exact doubling and halving.
	var POW2 = new Float64Array(2100);
	(function () {
		var i;
		POW2[1075] = 1;
		for (i = 1076; i <= 1075 + 1023; i++) POW2[i] = POW2[i - 1] * 2;
		for (i = 1074; i >= 1; i--) POW2[i] = POW2[i + 1] * 0.5;
	})();
	var TWO32 = POW2[1075 + 32];
	var TWOM32 = POW2[1075 - 32];

	function exp(x) {
		var k, hi, lo, r, t, c, y;
		if (x !== x) return x;
		if (x > 709.782712893384) return Infinity;
		if (x < -745.1332191019412) return 0;
		if (x > HALF_LN2 || x < -HALF_LN2) {
			k = Math.floor(x * INV_LN2 + 0.5) | 0;
			hi = x - k * LN2_HI;
			lo = k * LN2_LO;
		} else {
			k = 0;
			hi = x;
			lo = 0;
		}
		r = hi - lo;
		t = r * r;
		c = r - t * (EP1 + t * (EP2 + t * (EP3 + t * (EP4 + t * EP5))));
		y = 1 - ((lo - (r * c) / (2 - c)) - hi);
		if (k === 0) return y;
		if (k > 1023) return y * POW2[1075 + 1023] * 2;
		if (k < -1021) return y * POW2[1075 + k + 60] * POW2[1075 - 60];
		return y * POW2[1075 + k];
	}

	function log(x) {
		var k = 0, f, s, z, w, t1, t2, R, hfsq;
		if (x !== x || x < 0) return NaN;
		if (x === 0) return -Infinity;
		if (x === Infinity) return x;
		while (x >= TWO32) { x *= TWOM32; k += 32; }
		while (x < TWOM32) { x *= TWO32; k -= 32; }
		while (x >= SQRT2) { x *= 0.5; k++; }
		while (x < SQRT1_2) { x *= 2; k--; }
		f = x - 1;
		s = f / (2 + f);
		z = s * s;
		w = z * z;
		t1 = w * (LG2 + w * (LG4 + w * LG6));
		t2 = z * (LG1 + w * (LG3 + w * (LG5 + w * LG7)));
		R = t2 + t1;
		hfsq = 0.5 * f * f;
		return k * LN2_HI - ((hfsq - (s * (hfsq + R) + k * LN2_LO)) - f);
	}

	function sigmoid(x) {
		var e;
		if (x >= 0) return 1 / (1 + exp(-x));
		e = exp(x);
		return e / (1 + e);
	}

	function tanh(x) {
		var ax = x < 0 ? -x : x, x2, t, r;
		if (ax !== ax) return x;
		if (ax < 0.01) {
			x2 = x * x;
			return x * (1 - x2 * (1 / 3 - x2 * (2 / 15 - x2 * (17 / 315))));
		}
		if (ax > 20) return x < 0 ? -1 : 1;
		t = exp(-2 * ax);
		r = (1 - t) / (1 + t);
		return x < 0 ? -r : r;
	}

	// ------------------------------------------------------------------
	// Seeded random numbers: mulberry32 on an FNV-1a hash of the seed.
	// ------------------------------------------------------------------

	function hashString(str) {
		var h = 0x811c9dc5, i;
		str = String(str);
		for (i = 0; i < str.length; i++) {
			h ^= str.charCodeAt(i);
			h = Math.imul(h, 0x01000193);
		}
		return h >>> 0;
	}

	// rng(seed) -> r; r() in [0, 1); r.int(n); r.normal(); r.shuffle(typedOrPlainArray) in place.
	// A number or a string works as a seed; both are hashed, so 1, 2, 3 give unrelated streams.
	function rng(seed) {
		var s = hashString('tinynet:' + String(seed)), spare = 0, hasSpare = false;
		function next() {
			var t;
			s = (s + 0x6D2B79F5) | 0;
			t = Math.imul(s ^ (s >>> 15), 1 | s);
			t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
			return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
		}
		next.int = function (n) {
			return Math.floor(next() * n);
		};
		// Marsaglia's polar method: needs only log and sqrt.
		next.normal = function () {
			var u, v, q, f;
			if (hasSpare) {
				hasSpare = false;
				return spare;
			}
			do {
				u = 2 * next() - 1;
				v = 2 * next() - 1;
				q = u * u + v * v;
			} while (q >= 1 || q === 0);
			f = Math.sqrt(-2 * log(q) / q);
			spare = v * f;
			hasSpare = true;
			return u * f;
		};
		next.shuffle = function (arr) {
			var i, j, t;
			for (i = arr.length - 1; i > 0; i--) {
				j = Math.floor(next() * (i + 1));
				t = arr[i];
				arr[i] = arr[j];
				arr[j] = t;
			}
			return arr;
		};
		return next;
	}

	// ------------------------------------------------------------------
	// Base64 of Float32Array bytes (little-endian whatever the platform).
	// ------------------------------------------------------------------

	var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
	var B64_REV = null;

	function bytesToBase64(bytes) {
		var parts = [], chunk = '', i, n = bytes.length, b0, b1, b2;
		for (i = 0; i < n; i += 3) {
			b0 = bytes[i];
			b1 = i + 1 < n ? bytes[i + 1] : 0;
			b2 = i + 2 < n ? bytes[i + 2] : 0;
			chunk += B64.charAt(b0 >> 2) + B64.charAt(((b0 & 3) << 4) | (b1 >> 4)) +
				(i + 1 < n ? B64.charAt(((b1 & 15) << 2) | (b2 >> 6)) : '=') +
				(i + 2 < n ? B64.charAt(b2 & 63) : '=');
			if (chunk.length >= 8192) {
				parts.push(chunk);
				chunk = '';
			}
		}
		parts.push(chunk);
		return parts.join('');
	}

	function base64ToBytes(str) {
		var i, n, len, out, o = 0, c0, c1, c2, c3;
		if (!B64_REV) {
			B64_REV = new Int16Array(128);
			for (i = 0; i < 128; i++) B64_REV[i] = -1;
			for (i = 0; i < 64; i++) B64_REV[B64.charCodeAt(i)] = i;
		}
		str = String(str).replace(/[^A-Za-z0-9+\/]/g, '');
		n = str.length;
		if (n % 4 === 1) throw new Error('TinyNet: bad base64 length');
		len = Math.floor(n * 3 / 4);
		out = new Uint8Array(len);
		for (i = 0; i < n; i += 4) {
			c0 = B64_REV[str.charCodeAt(i)];
			c1 = B64_REV[str.charCodeAt(i + 1)];
			c2 = i + 2 < n ? B64_REV[str.charCodeAt(i + 2)] : 0;
			c3 = i + 3 < n ? B64_REV[str.charCodeAt(i + 3)] : 0;
			if (o < len) out[o++] = (c0 << 2) | (c1 >> 4);
			if (o < len) out[o++] = ((c1 & 15) << 4) | (c2 >> 2);
			if (o < len) out[o++] = ((c2 & 3) << 6) | c3;
		}
		return out;
	}

	function encodeFloats(arr) {
		var bytes = new Uint8Array(arr.length * 4), view = new DataView(bytes.buffer), i;
		for (i = 0; i < arr.length; i++) view.setFloat32(i * 4, arr[i], true);
		return bytesToBase64(bytes);
	}

	function decodeFloats(str) {
		var bytes = base64ToBytes(str), view, out, i;
		if (bytes.length % 4 !== 0) throw new Error('TinyNet: the encoded data is not a whole number of 32-bit floats');
		view = new DataView(bytes.buffer);
		out = new Float32Array(bytes.length / 4);
		for (i = 0; i < out.length; i++) out[i] = view.getFloat32(i * 4, true);
		return out;
	}

	// ------------------------------------------------------------------
	// Small helpers
	// ------------------------------------------------------------------

	function fail(msg) {
		throw new Error('TinyNet: ' + msg);
	}

	function isInt(v) {
		return typeof v === 'number' && isFinite(v) && Math.floor(v) === v;
	}

	function now() {
		if (typeof performance !== 'undefined' && performance && typeof performance.now === 'function') return performance.now();
		return Date.now();
	}

	// One AdamW update of one tensor (decoupled weight decay, bias-corrected moments).
	// c1 = 1 - beta1^t, c2 = 1 - beta2^t.
	function adamUpdate(w, g, m, v, lr, wd, beta1, beta2, eps, c1, c2) {
		var i, n = w.length, gi, mi, vi, keep = 1 - lr * wd, stepSize = lr / c1, rc2 = Math.sqrt(c2), a1 = 1 - beta1, a2 = 1 - beta2;
		for (i = 0; i < n; i++) {
			gi = g[i];
			mi = beta1 * m[i] + a1 * gi;
			vi = beta2 * v[i] + a2 * gi * gi;
			m[i] = mi;
			v[i] = vi;
			w[i] = w[i] * keep - stepSize * mi / (Math.sqrt(vi) / rc2 + eps);
		}
	}

	// ------------------------------------------------------------------
	// 1. The generic dense network
	// ------------------------------------------------------------------

	var ACTS = ['relu', 'tanh', 'sigmoid', 'square', 'linear'];

	function checkAct(act) {
		if (ACTS.indexOf(act) < 0) fail('unknown activation "' + act + '" (use ' + ACTS.join(', ') + ')');
		return act;
	}

	// create({ sizes: [in, h1, ..., out], act, bias, seed, scale }) -> net
	// net.W[l] is Float32Array(sizes[l] * sizes[l + 1]); the weight from input i to output j is W[l][i * sizes[l + 1] + j].
	// net.b[l] is Float32Array(sizes[l + 1]) (length 0 when bias is false).
	function create(opts) {
		var sizes, act, bias, seed, scale, r, W = [], b = [], l, nin, nout, limit, w, i;
		opts = opts || {};
		sizes = opts.sizes;
		if (!sizes || sizes.length < 2) fail('create needs sizes: [in, ..., out]');
		for (l = 0; l < sizes.length; l++) if (!isInt(sizes[l]) || sizes[l] < 1) fail('sizes must be positive integers');
		act = checkAct(opts.act === undefined ? 'relu' : opts.act);
		bias = opts.bias !== false;
		seed = opts.seed === undefined ? 1 : opts.seed;
		scale = opts.scale === undefined ? 1 : +opts.scale;
		r = rng(String(seed) + '/net');
		for (l = 0; l < sizes.length - 1; l++) {
			nin = sizes[l];
			nout = sizes[l + 1];
			// He uniform into a ReLU layer, Glorot uniform otherwise (and into the linear output).
			limit = (act === 'relu' && l < sizes.length - 2 ? Math.sqrt(6 / nin) : Math.sqrt(6 / (nin + nout))) * scale;
			w = new Float32Array(nin * nout);
			for (i = 0; i < w.length; i++) w[i] = (2 * r() - 1) * limit;
			W.push(w);
			b.push(new Float32Array(bias ? nout : 0));
		}
		return { sizes: Array.prototype.slice.call(sizes), act: act, bias: bias, W: W, b: b };
	}

	function normaliseHooks(hook, sizes, n) {
		var list = hook instanceof Array ? hook : [hook], out = [], i, h;
		for (i = 0; i < list.length; i++) {
			h = list[i];
			if (!h) continue;
			if (!isInt(h.layer) || h.layer < 1 || h.layer > sizes.length - 2) fail('hook.layer must be a hidden layer: 1 to ' + (sizes.length - 2));
			if (!isInt(h.unit) || h.unit < 0 || h.unit >= sizes[h.layer]) fail('hook.unit is out of range for layer ' + h.layer);
			if (typeof h.fn !== 'function' && !(h.values && h.values.length >= n)) fail('hook needs values (one per sample) or fn(sample, activation)');
			out.push({ layer: h.layer, unit: h.unit, values: h.values || null, fn: typeof h.fn === 'function' ? h.fn : null });
		}
		return out;
	}

	// forward(net, X, n, { hook }) -> { out, acts, pre, n, hooks }
	// X holds n rows of sizes[0] numbers. acts[0] is X, acts[l] the activations of layer l,
	// out = acts[last] the raw outputs (no activation on the output layer).
	// hook: { layer, unit, values } or { layer, unit, fn } replaces one hidden unit's activation.
	function forward(net, X, n, opts) {
		var sizes = net.sizes, L = sizes.length - 1, acts = [X], pres = [null], hooks = [], l, nin, nout, W, b, inp, outp, s, i, j, oi, oo, ow, x, hk, q, len;
		if (n === undefined || n === null) n = X.length / sizes[0];
		if (!isInt(n) || n < 0 || X.length < n * sizes[0]) fail('forward: X must hold n rows of ' + sizes[0] + ' numbers');
		if (opts && opts.hook) hooks = normaliseHooks(opts.hook, sizes, n);
		for (l = 0; l < L; l++) {
			nin = sizes[l];
			nout = sizes[l + 1];
			W = net.W[l];
			b = net.b[l];
			inp = acts[l];
			outp = new Float64Array(n * nout);
			for (s = 0; s < n; s++) {
				oi = s * nin;
				oo = s * nout;
				if (b.length) for (j = 0; j < nout; j++) outp[oo + j] = b[j];
				for (i = 0; i < nin; i++) {
					x = +inp[oi + i];
					if (x !== 0) {
						ow = i * nout;
						for (j = 0; j < nout; j++) outp[oo + j] += x * W[ow + j];
					}
				}
			}
			if (l < L - 1) {
				len = n * nout;
				if (net.act === 'square') {
					pres.push(new Float64Array(outp));
					for (i = 0; i < len; i++) outp[i] = outp[i] * outp[i];
				} else {
					pres.push(null);
					if (net.act === 'relu') {
						for (i = 0; i < len; i++) if (!(outp[i] > 0)) outp[i] = outp[i] !== outp[i] ? outp[i] : 0;
					} else if (net.act === 'tanh') {
						for (i = 0; i < len; i++) outp[i] = tanh(outp[i]);
					} else if (net.act === 'sigmoid') {
						for (i = 0; i < len; i++) outp[i] = sigmoid(outp[i]);
					}
				}
				for (q = 0; q < hooks.length; q++) {
					hk = hooks[q];
					if (hk.layer !== l + 1) continue;
					for (s = 0; s < n; s++) {
						oo = s * nout + hk.unit;
						outp[oo] = hk.fn ? +hk.fn(s, outp[oo]) : +hk.values[s];
					}
				}
			} else {
				pres.push(null);
			}
			acts.push(outp);
		}
		return { out: acts[L], acts: acts, pre: pres, n: n, hooks: hooks };
	}

	// backward(net, cache, dOut, { dX }) -> { W: [...], b: [...], hook, hooks, dX }
	// dOut is dLoss/dOut as a loss function returns it. The result has the shapes of net.W and net.b
	// (Float64Array). With a hook in the cache, the hooked unit is a constant: no gradient flows
	// through it to earlier weights, and grads.hook[s] is dLoss/d(value given for sample s).
	function backward(net, cache, dOut, opts) {
		var sizes = net.sizes, L = sizes.length - 1, n = cache.n, hooks = cache.hooks || [], gW = new Array(L), gb = new Array(L), hookGrads = [],
			delta = dOut, l, nin, nout, W, inp, g, bg, prev, s, i, j, oi, oo, ow, x, acc, len, act = net.act, h, pre, q, hk, hg, wantDX = !!(opts && opts.dX), dX = null;
		if (!dOut || dOut.length < n * sizes[L]) fail('backward: dOut must hold n rows of ' + sizes[L] + ' numbers');
		for (q = 0; q < hooks.length; q++) hookGrads.push(null);
		for (l = L - 1; l >= 0; l--) {
			nin = sizes[l];
			nout = sizes[l + 1];
			W = net.W[l];
			inp = cache.acts[l];
			g = new Float64Array(nin * nout);
			bg = new Float64Array(net.b[l].length ? nout : 0);
			for (s = 0; s < n; s++) {
				oi = s * nin;
				oo = s * nout;
				for (i = 0; i < nin; i++) {
					x = +inp[oi + i];
					if (x !== 0) {
						ow = i * nout;
						for (j = 0; j < nout; j++) g[ow + j] += x * delta[oo + j];
					}
				}
				if (bg.length) for (j = 0; j < nout; j++) bg[j] += delta[oo + j];
			}
			gW[l] = g;
			gb[l] = bg;
			if (l === 0 && !wantDX) break;
			prev = new Float64Array(n * nin);
			for (s = 0; s < n; s++) {
				oi = s * nin;
				oo = s * nout;
				for (i = 0; i < nin; i++) {
					ow = i * nout;
					acc = 0;
					for (j = 0; j < nout; j++) acc += W[ow + j] * delta[oo + j];
					prev[oi + i] = acc;
				}
			}
			if (l === 0) {
				dX = prev;
				break;
			}
			// prev is now dLoss/d(activation of layer l). Hooked units stop here.
			for (q = 0; q < hooks.length; q++) {
				hk = hooks[q];
				if (hk.layer !== l) continue;
				hg = new Float64Array(n);
				for (s = 0; s < n; s++) {
					hg[s] = prev[s * nin + hk.unit];
					prev[s * nin + hk.unit] = 0;
				}
				hookGrads[q] = hg;
			}
			h = cache.acts[l];
			len = n * nin;
			if (act === 'relu') {
				for (i = 0; i < len; i++) if (!(h[i] > 0)) prev[i] = 0;
			} else if (act === 'tanh') {
				for (i = 0; i < len; i++) prev[i] *= 1 - h[i] * h[i];
			} else if (act === 'sigmoid') {
				for (i = 0; i < len; i++) prev[i] *= h[i] * (1 - h[i]);
			} else if (act === 'square') {
				pre = cache.pre[l];
				for (i = 0; i < len; i++) prev[i] *= 2 * pre[i];
			}
			// A hooked unit's own derivative is zero whatever its activation function says.
			for (q = 0; q < hooks.length; q++) {
				hk = hooks[q];
				if (hk.layer !== l) continue;
				for (s = 0; s < n; s++) prev[s * nin + hk.unit] = 0;
			}
			delta = prev;
		}
		return { W: gW, b: gb, hook: hookGrads.length ? hookGrads[0] : null, hooks: hookGrads, dX: dX };
	}

	// softmaxCE(out, labels, n) -> { loss, dOut, acc, probs }
	// labels: n class indices, or n rows of class probabilities. loss is the mean over the n rows.
	function softmaxCE(out, labels, n) {
		var k, dOut, probs, loss = 0, correct = 0, s, c, o, mx, am, sum, e, hard, y, inv, t, tm, ta;
		if (n === undefined || n === null) n = labels.length;
		k = out.length / n;
		if (!isInt(k) || k < 1) fail('softmaxCE: out must hold n rows');
		hard = labels.length === n && k !== 1;
		if (!hard && labels.length !== n * k) fail('softmaxCE: labels must be n class indices or n rows of probabilities');
		dOut = new Float64Array(n * k);
		probs = new Float64Array(n * k);
		inv = 1 / n;
		for (s = 0; s < n; s++) {
			o = s * k;
			mx = out[o];
			am = 0;
			for (c = 1; c < k; c++) if (out[o + c] > mx) { mx = out[o + c]; am = c; }
			sum = 0;
			for (c = 0; c < k; c++) {
				e = exp(out[o + c] - mx);
				probs[o + c] = e;
				sum += e;
			}
			for (c = 0; c < k; c++) probs[o + c] /= sum;
			if (hard) {
				y = labels[s] | 0;
				if (y < 0 || y >= k) fail('softmaxCE: label ' + labels[s] + ' is out of range');
				loss += log(sum) - (out[o + y] - mx);
				if (am === y) correct++;
				for (c = 0; c < k; c++) dOut[o + c] = probs[o + c] * inv;
				dOut[o + y] -= inv;
			} else {
				tm = -1;
				ta = 0;
				for (c = 0; c < k; c++) {
					t = +labels[o + c];
					if (t > tm) { tm = t; ta = c; }
					if (t !== 0) loss += t * (log(sum) - (out[o + c] - mx));
					dOut[o + c] = (probs[o + c] - t) * inv;
				}
				if (am === ta) correct++;
			}
		}
		return { loss: n ? loss / n : NaN, dOut: dOut, acc: n ? correct / n : NaN, probs: probs };
	}

	// mse(out, target, n) -> { loss, dOut }: the mean of (out - target)^2 over every number in out.
	function mse(out, target, n) {
		var len = out.length, dOut = new Float64Array(len), loss = 0, i, d, inv;
		if (target.length !== len) fail('mse: target must have the shape of out');
		inv = 1 / len;
		for (i = 0; i < len; i++) {
			d = out[i] - target[i];
			loss += d * d;
			dOut[i] = 2 * d * inv;
		}
		return { loss: len ? loss * inv : NaN, dOut: dOut };
	}

	// bce(out, target, n) -> { loss, dOut, acc, probs }: out holds logits (sigmoid is applied here),
	// target numbers in [0, 1]; the mean over every number in out.
	function bce(out, target, n) {
		var len = out.length, dOut = new Float64Array(len), probs = new Float64Array(len), loss = 0, correct = 0, i, x, t, ax, pr, inv;
		if (target.length !== len) fail('bce: target must have the shape of out');
		inv = 1 / len;
		for (i = 0; i < len; i++) {
			x = out[i];
			t = +target[i];
			ax = x < 0 ? -x : x;
			loss += (x > 0 ? x : 0) - x * t + log(1 + exp(-ax));
			pr = sigmoid(x);
			probs[i] = pr;
			dOut[i] = (pr - t) * inv;
			if ((x > 0) === (t >= 0.5)) correct++;
		}
		return { loss: len ? loss * inv : NaN, dOut: dOut, acc: len ? correct / len : NaN, probs: probs };
	}

	// adamw(net, { lr, wd, beta1, beta2, eps }) -> opt with step(grads). Weight decay is decoupled and
	// applied to weights only, never to biases. opt.lr and opt.wd may be changed between steps.
	function adamw(net, o) {
		var L = net.W.length, mW = [], vW = [], mb = [], vb = [], l, b1t = 1, b2t = 1, opt;
		o = o || {};
		for (l = 0; l < L; l++) {
			mW.push(new Float64Array(net.W[l].length));
			vW.push(new Float64Array(net.W[l].length));
			mb.push(new Float64Array(net.b[l].length));
			vb.push(new Float64Array(net.b[l].length));
		}
		opt = {
			lr: o.lr === undefined ? 0.001 : +o.lr,
			wd: o.wd === undefined ? 0.01 : +o.wd,
			beta1: o.beta1 === undefined ? 0.9 : +o.beta1,
			beta2: o.beta2 === undefined ? 0.999 : +o.beta2,
			eps: o.eps === undefined ? 1e-8 : +o.eps,
			t: 0,
			step: function (grads) {
				var i;
				opt.t++;
				b1t *= opt.beta1;
				b2t *= opt.beta2;
				for (i = 0; i < L; i++) {
					adamUpdate(net.W[i], grads.W[i], mW[i], vW[i], opt.lr, opt.wd, opt.beta1, opt.beta2, opt.eps, 1 - b1t, 1 - b2t);
					if (net.b[i].length) adamUpdate(net.b[i], grads.b[i], mb[i], vb[i], opt.lr, 0, opt.beta1, opt.beta2, opt.eps, 1 - b1t, 1 - b2t);
				}
				return opt;
			},
			reset: function () {
				var i;
				opt.t = 0;
				b1t = 1;
				b2t = 1;
				for (i = 0; i < L; i++) {
					mW[i].fill(0);
					vW[i].fill(0);
					mb[i].fill(0);
					vb[i].fill(0);
				}
				return opt;
			}
		};
		return opt;
	}

	// sgd(net, { lr, momentum, wd }) -> opt with step(grads). v = momentum * v + g; w -= lr * v.
	// wd here is plain L2 (added to the gradient of weights, not of biases).
	function sgd(net, o) {
		var L = net.W.length, vW = [], vb = [], l, opt;
		o = o || {};
		for (l = 0; l < L; l++) {
			vW.push(new Float64Array(net.W[l].length));
			vb.push(new Float64Array(net.b[l].length));
		}
		function update(w, g, v, lr, mom, wd) {
			var i, n = w.length, gi;
			for (i = 0; i < n; i++) {
				gi = g[i] + wd * w[i];
				if (mom !== 0) {
					gi = mom * v[i] + gi;
					v[i] = gi;
				}
				w[i] = w[i] - lr * gi;
			}
		}
		opt = {
			lr: o.lr === undefined ? 0.1 : +o.lr,
			momentum: o.momentum === undefined ? 0 : +o.momentum,
			wd: o.wd === undefined ? 0 : +o.wd,
			t: 0,
			step: function (grads) {
				var i;
				opt.t++;
				for (i = 0; i < L; i++) {
					update(net.W[i], grads.W[i], vW[i], opt.lr, opt.momentum, opt.wd);
					if (net.b[i].length) update(net.b[i], grads.b[i], vb[i], opt.lr, opt.momentum, 0);
				}
				return opt;
			},
			reset: function () {
				var i;
				opt.t = 0;
				for (i = 0; i < L; i++) {
					vW[i].fill(0);
					vb[i].fill(0);
				}
				return opt;
			}
		};
		return opt;
	}

	function clone(net) {
		var W = [], b = [], l;
		for (l = 0; l < net.W.length; l++) {
			W.push(new Float32Array(net.W[l]));
			b.push(new Float32Array(net.b[l]));
		}
		return { sizes: net.sizes.slice(), act: net.act, bias: net.bias, W: W, b: b };
	}

	function paramCount(net) {
		var n = 0, l;
		for (l = 0; l < net.W.length; l++) n += net.W[l].length + net.b[l].length;
		return n;
	}

	// serialize(net) -> { sizes, act, bias, data }: plain JSON; data is base64 of every W[l] then b[l], in order.
	function serialize(net) {
		var flat = new Float32Array(paramCount(net)), o = 0, l;
		for (l = 0; l < net.W.length; l++) {
			flat.set(net.W[l], o);
			o += net.W[l].length;
			flat.set(net.b[l], o);
			o += net.b[l].length;
		}
		return { sizes: net.sizes.slice(), act: net.act, bias: net.bias, data: encodeFloats(flat) };
	}

	// load(obj) -> net, from what serialize returned (or its JSON text).
	function load(obj) {
		var net, flat, o = 0, l;
		if (typeof obj === 'string') obj = JSON.parse(obj);
		net = create({ sizes: obj.sizes, act: obj.act, bias: obj.bias, seed: 0 });
		flat = decodeFloats(obj.data);
		if (flat.length !== paramCount(net)) fail('load: the data does not fit sizes ' + JSON.stringify(obj.sizes));
		for (l = 0; l < net.W.length; l++) {
			net.W[l].set(flat.subarray(o, o + net.W[l].length));
			o += net.W[l].length;
			net.b[l].set(flat.subarray(o, o + net.b[l].length));
			o += net.b[l].length;
		}
		return net;
	}

	// lerp(netA, netB, alpha) -> a new net with (1 - alpha) * A + alpha * B.
	function lerp(netA, netB, alpha) {
		var out = clone(netA), l, i, a, b;
		if (JSON.stringify(netA.sizes) !== JSON.stringify(netB.sizes) || netA.bias !== netB.bias) fail('lerp: the two networks must have the same shape');
		for (l = 0; l < out.W.length; l++) {
			a = netA.W[l];
			b = netB.W[l];
			for (i = 0; i < a.length; i++) out.W[l][i] = (1 - alpha) * a[i] + alpha * b[i];
			a = netA.b[l];
			b = netB.b[l];
			for (i = 0; i < a.length; i++) out.b[l][i] = (1 - alpha) * a[i] + alpha * b[i];
		}
		return out;
	}

	// ------------------------------------------------------------------
	// The Hungarian algorithm (Kuhn-Munkres with potentials, O(n^2 m)).
	// hungarian(cost) with cost an array of n rows of m >= n numbers, or
	// hungarian(flat, n) with flat a typed array of n * m numbers, row-major.
	// Returns Int32Array(n): the column given to each row, minimising the total.
	// ------------------------------------------------------------------

	function hungarian(cost, nRows) {
		var n, m, flat, i, j, u, v, pcol, way, minv, used, i0, j0, j1, delta, cur, out, row;
		if (cost && cost.length && typeof cost[0] !== 'number') {
			n = cost.length;
			m = cost[0].length;
			flat = new Float64Array(n * m);
			for (i = 0; i < n; i++) {
				row = cost[i];
				if (row.length !== m) fail('hungarian: every row must have the same length');
				for (j = 0; j < m; j++) flat[i * m + j] = row[j];
			}
		} else {
			flat = cost;
			n = nRows === undefined ? Math.round(Math.sqrt(flat.length)) : nRows;
			m = n ? flat.length / n : 0;
			if (!isInt(m)) fail('hungarian: a flat cost matrix needs n rows of equal length');
		}
		if (n > m) fail('hungarian: needs at least as many columns as rows');
		for (i = 0; i < n * m; i++) if (flat[i] !== flat[i]) fail('hungarian: the cost matrix contains NaN');
		u = new Float64Array(n + 1);
		v = new Float64Array(m + 1);
		pcol = new Int32Array(m + 1);
		way = new Int32Array(m + 1);
		minv = new Float64Array(m + 1);
		used = new Uint8Array(m + 1);
		for (i = 1; i <= n; i++) {
			pcol[0] = i;
			j0 = 0;
			for (j = 0; j <= m; j++) {
				minv[j] = Infinity;
				used[j] = 0;
			}
			do {
				used[j0] = 1;
				i0 = pcol[j0];
				delta = Infinity;
				j1 = 0;
				for (j = 1; j <= m; j++) {
					if (!used[j]) {
						cur = flat[(i0 - 1) * m + (j - 1)] - u[i0] - v[j];
						if (cur < minv[j]) {
							minv[j] = cur;
							way[j] = j0;
						}
						if (minv[j] < delta) {
							delta = minv[j];
							j1 = j;
						}
					}
				}
				for (j = 0; j <= m; j++) {
					if (used[j]) {
						u[pcol[j]] += delta;
						v[j] -= delta;
					} else {
						minv[j] -= delta;
					}
				}
				j0 = j1;
			} while (pcol[j0] !== 0);
			do {
				j1 = way[j0];
				pcol[j0] = pcol[j1];
				j0 = j1;
			} while (j0);
		}
		out = new Int32Array(n);
		for (j = 1; j <= m; j++) if (pcol[j]) out[pcol[j] - 1] = j - 1;
		return out;
	}

	// ------------------------------------------------------------------
	// 2. The modular-addition trainer
	//
	//   h = act(W1a[a] + W1b[b])      W1a, W1b: p rows of `hidden` numbers
	//   logits = h . W2               W2: `hidden` rows of p numbers
	//
	// No biases. Full batch, AdamW, mean cross-entropy.
	// ------------------------------------------------------------------

	var GROK_DEFAULTS = { p: 41, hidden: 128, frac: 0.6, lr: 0.01, wd: 1, act: 'relu', seed: 1, beta1: 0.9, beta2: 0.98, eps: 1e-8, init: 1 };
	var ACT_ID = { relu: 0, square: 1, tanh: 2, sigmoid: 3, linear: 4 };

	function grokConfig(c) {
		var cfg = {}, k;
		c = c || {};
		for (k in GROK_DEFAULTS) cfg[k] = c[k] === undefined || c[k] === null ? GROK_DEFAULTS[k] : c[k];
		cfg.splitSeed = c.splitSeed === undefined || c.splitSeed === null ? cfg.seed : c.splitSeed;
		cfg.p = +cfg.p;
		cfg.hidden = +cfg.hidden;
		cfg.frac = +cfg.frac;
		cfg.lr = +cfg.lr;
		cfg.wd = +cfg.wd;
		cfg.beta1 = +cfg.beta1;
		cfg.beta2 = +cfg.beta2;
		cfg.eps = +cfg.eps;
		cfg.init = +cfg.init;
		if (!(cfg.beta1 >= 0 && cfg.beta1 < 1) || !(cfg.beta2 >= 0 && cfg.beta2 < 1)) fail('beta1 and beta2 must be at least 0 and below 1');
		if (!(cfg.eps > 0)) fail('eps must be positive');
		if (!isInt(cfg.p) || cfg.p < 2 || cfg.p > 256) fail('p must be an integer from 2 to 256');
		if (!isInt(cfg.hidden) || cfg.hidden < 1 || cfg.hidden > 4096) fail('hidden must be an integer from 1 to 4096');
		if (!(cfg.frac > 0 && cfg.frac <= 1)) fail('frac must be above 0 and at most 1');
		if (!(cfg.lr > 0)) fail('lr must be positive');
		if (!(cfg.wd >= 0)) fail('wd must be zero or positive');
		if (!(cfg.init > 0)) fail('init must be positive');
		checkAct(cfg.act);
		return cfg;
	}

	function weightsOf(w, p, hidden, what) {
		var out;
		if (typeof w === 'string') w = decodeWeights(w, p, hidden);
		else if (w && typeof w.weights === 'string') w = decodeWeights(w.weights, p, hidden);
		else if (w && w.weights && w.weights.W1a) w = w.weights;
		if (!w || !w.W1a || !w.W1b || !w.W2) fail((what || 'weights') + ' must be { W1a, W1b, W2 }');
		if (w.W1a.length !== p * hidden || w.W1b.length !== p * hidden || w.W2.length !== hidden * p) {
			fail((what || 'weights') + ' do not fit p = ' + p + ', hidden = ' + hidden);
		}
		out = { W1a: w.W1a, W1b: w.W1b, W2: w.W2 };
		if (!(out.W1a instanceof Float32Array)) out.W1a = new Float32Array(out.W1a);
		if (!(out.W1b instanceof Float32Array)) out.W1b = new Float32Array(out.W1b);
		if (!(out.W2 instanceof Float32Array)) out.W2 = new Float32Array(out.W2);
		return out;
	}

	// encodeWeights({ W1a, W1b, W2 }) -> base64 of the three Float32Arrays in that order.
	function encodeWeights(w) {
		var flat = new Float32Array(w.W1a.length + w.W1b.length + w.W2.length);
		flat.set(w.W1a, 0);
		flat.set(w.W1b, w.W1a.length);
		flat.set(w.W2, w.W1a.length + w.W1b.length);
		return encodeFloats(flat);
	}

	// decodeWeights(base64, p, hidden) -> { W1a, W1b, W2 }
	function decodeWeights(str, p, hidden) {
		var flat = decodeFloats(str), ph = p * hidden;
		if (flat.length !== 3 * ph) fail('decodeWeights: the data does not fit p = ' + p + ', hidden = ' + hidden);
		return { W1a: flat.slice(0, ph), W1b: flat.slice(ph, 2 * ph), W2: flat.slice(2 * ph, 3 * ph) };
	}

	function grok(config) {
		var cfg = grokConfig(config);
		var p = cfg.p, hidden = cfg.hidden, N = p * p, PH = p * hidden, actId = ACT_ID[cfg.act];
		var W1a = new Float32Array(PH), W1b = new Float32Array(PH), W2 = new Float32Array(PH);
		var G = { W1a: new Float64Array(PH), W1b: new Float64Array(PH), W2: new Float64Array(PH) };
		var Mo = { W1a: new Float64Array(PH), W1b: new Float64Array(PH), W2: new Float64Array(PH) };
		var Ve = { W1a: new Float64Array(PH), W1b: new Float64Array(PH), W2: new Float64Array(PH) };
		var T = { W1a: new Float32Array(PH), W1b: new Float32Array(PH), W2: new Float32Array(PH) }; // scratch weights
		var hv = new Float64Array(hidden), dv = new Float64Array(hidden), list = new Int32Array(hidden), z = new Float64Array(p);
		var isTrain = new Uint8Array(N), pred = new Uint8Array(N), prob = new Float32Array(N);
		var nTrain = Math.min(N, Math.max(1, Math.round(cfg.frac * N))), nTest = N - nTrain;
		var trainIdx = new Int32Array(nTrain), testIdx = new Int32Array(nTest);
		var res = { loss: 0, correct: 0 };
		var adamT = 0, b1t = 1, b2t = 1, cache = null, plane = null;
		var trainer;

		// ---- the split and the initial weights ----
		(function () {
			var order = new Int32Array(N), i, a = 0, b = 0;
			for (i = 0; i < N; i++) order[i] = i;
			rng(String(cfg.splitSeed) + '/split').shuffle(order);
			for (i = 0; i < nTrain; i++) isTrain[order[i]] = 1;
			for (i = 0; i < N; i++) {
				if (isTrain[i]) trainIdx[a++] = i;
				else testIdx[b++] = i;
			}
		})();

		function initWeights() {
			var r = rng(String(cfg.seed) + '/init'), i;
			// Uniform in +-init/sqrt(fan-in): fan-in is 2p for the two tables (the input is two one-hot
			// vectors side by side) and `hidden` for W2. This is the default of a linear layer in PyTorch.
			var s1 = cfg.init / Math.sqrt(2 * p), s2 = cfg.init / Math.sqrt(hidden);
			for (i = 0; i < PH; i++) W1a[i] = (2 * r() - 1) * s1;
			for (i = 0; i < PH; i++) W1b[i] = (2 * r() - 1) * s1;
			for (i = 0; i < PH; i++) W2[i] = (2 * r() - 1) * s2;
		}

		function resetAdam() {
			adamT = 0;
			b1t = 1;
			b2t = 1;
			Mo.W1a.fill(0); Mo.W1b.fill(0); Mo.W2.fill(0);
			Ve.W1a.fill(0); Ve.W1b.fill(0); Ve.W2.fill(0);
		}

		// ---- the kernel: forward over a list of pairs, optionally backward ----
		// wa, wb, w2: the weights to use. idx[0..n): pair indices (a * p + b). g: gradient buffers
		// to add into (the gradient of the MEAN loss over the n pairs), or null. predOut, probOut:
		// per-pair argmax and probability of the right answer, or null. Sets res.loss (the sum) and res.correct.
		function pass(wa, wb, w2, idx, n, g, predOut, probOut) {
			var gA = null, gB = null, g2 = null, wantGrad = g !== null;
			var inv = 1 / n, lossSum = 0, correct = 0;
			var s, pair, a, b, y, oa, ob, cnt, cnt2, j, k, c, pre, h0, h1, o0, o1, mx, am, sum, e, zy, is, acc0, acc1, d0, d1, t;
			var pEven = p & ~1;
			if (wantGrad) {
				gA = g.W1a;
				gB = g.W1b;
				g2 = g.W2;
			}
			for (s = 0; s < n; s++) {
				pair = idx[s];
				a = (pair / p) | 0;
				b = pair - a * p;
				y = a + b;
				if (y >= p) y -= p;
				oa = a * hidden;
				ob = b * hidden;
				cnt = 0;
				if (actId === 0) {
					for (j = 0; j < hidden; j++) {
						pre = wa[oa + j] + wb[ob + j];
						if (pre > 0) {
							hv[cnt] = pre;
							list[cnt] = j;
							cnt++;
						}
					}
				} else {
					cnt = hidden;
					if (actId === 1) {
						for (j = 0; j < hidden; j++) {
							pre = wa[oa + j] + wb[ob + j];
							hv[j] = pre * pre;
							dv[j] = 2 * pre;
							list[j] = j;
						}
					} else if (actId === 2) {
						for (j = 0; j < hidden; j++) {
							t = tanh(wa[oa + j] + wb[ob + j]);
							hv[j] = t;
							dv[j] = 1 - t * t;
							list[j] = j;
						}
					} else if (actId === 3) {
						for (j = 0; j < hidden; j++) {
							t = sigmoid(wa[oa + j] + wb[ob + j]);
							hv[j] = t;
							dv[j] = t * (1 - t);
							list[j] = j;
						}
					} else {
						for (j = 0; j < hidden; j++) {
							hv[j] = wa[oa + j] + wb[ob + j];
							dv[j] = 1;
							list[j] = j;
						}
					}
				}
				for (c = 0; c < p; c++) z[c] = 0;
				cnt2 = cnt & ~1;
				for (k = 0; k < cnt2; k += 2) {
					h0 = hv[k];
					o0 = list[k] * p;
					h1 = hv[k + 1];
					o1 = list[k + 1] * p;
					for (c = 0; c < p; c++) z[c] += h0 * w2[o0 + c] + h1 * w2[o1 + c];
				}
				if (k < cnt) {
					h0 = hv[k];
					o0 = list[k] * p;
					for (c = 0; c < p; c++) z[c] += h0 * w2[o0 + c];
				}
				mx = z[0];
				am = 0;
				for (c = 1; c < p; c++) {
					if (z[c] > mx) {
						mx = z[c];
						am = c;
					}
				}
				zy = z[y] - mx;
				sum = 0;
				for (c = 0; c < p; c++) {
					e = exp(z[c] - mx);
					z[c] = e;
					sum += e;
				}
				lossSum += log(sum) - zy;
				if (am === y) correct++;
				if (predOut !== null) predOut[pair] = am;
				if (probOut !== null) probOut[pair] = z[y] / sum;
				if (wantGrad) {
					is = inv / sum;
					for (c = 0; c < p; c++) z[c] *= is;
					z[y] -= inv;
					for (k = 0; k < cnt; k++) {
						h0 = hv[k];
						j = list[k];
						o0 = j * p;
						acc0 = 0;
						acc1 = 0;
						for (c = 0; c < pEven; c += 2) {
							d0 = z[c];
							d1 = z[c + 1];
							g2[o0 + c] += h0 * d0;
							g2[o0 + c + 1] += h0 * d1;
							acc0 += w2[o0 + c] * d0;
							acc1 += w2[o0 + c + 1] * d1;
						}
						if (c < p) {
							d0 = z[c];
							g2[o0 + c] += h0 * d0;
							acc0 += w2[o0 + c] * d0;
						}
						acc0 += acc1;
						if (actId !== 0) acc0 *= dv[k];
						gA[oa + j] += acc0;
						gB[ob + j] += acc0;
					}
				}
			}
			res.loss = lossSum;
			res.correct = correct;
		}

		function zeroG() {
			G.W1a.fill(0);
			G.W1b.fill(0);
			G.W2.fill(0);
		}

		// One epoch of AdamW on the pairs idx[0..n).
		function epochOn(idx, n) {
			var c1, c2;
			zeroG();
			pass(W1a, W1b, W2, idx, n, G, null, null);
			adamT++;
			b1t *= cfg.beta1;
			b2t *= cfg.beta2;
			c1 = 1 - b1t;
			c2 = 1 - b2t;
			adamUpdate(W1a, G.W1a, Mo.W1a, Ve.W1a, cfg.lr, cfg.wd, cfg.beta1, cfg.beta2, cfg.eps, c1, c2);
			adamUpdate(W1b, G.W1b, Mo.W1b, Ve.W1b, cfg.lr, cfg.wd, cfg.beta1, cfg.beta2, cfg.eps, c1, c2);
			adamUpdate(W2, G.W2, Mo.W2, Ve.W2, cfg.lr, cfg.wd, cfg.beta1, cfg.beta2, cfg.eps, c1, c2);
			cache = null;
		}

		function evalList(w, idx, n) {
			pass(w.W1a, w.W1b, w.W2, idx, n, null, null, null);
			return { loss: n ? res.loss / n : NaN, acc: n ? res.correct / n : NaN, n: n };
		}

		function own() {
			return { W1a: W1a, W1b: W1b, W2: W2 };
		}

		// ---- public: training ----

		function run(epochs) {
			var e, n = epochs === undefined ? 1 : epochs | 0;
			for (e = 0; e < n; e++) {
				epochOn(trainIdx, nTrain);
				trainer.epoch++;
			}
			return trainer.epoch;
		}

		function metrics() {
			var tl, ta;
			if (!cache) {
				pass(W1a, W1b, W2, trainIdx, nTrain, null, pred, prob);
				tl = res.loss / nTrain;
				ta = res.correct / nTrain;
				pass(W1a, W1b, W2, testIdx, nTest, null, pred, prob);
				cache = {
					epoch: trainer.epoch,
					trainLoss: tl,
					trainAcc: ta,
					testLoss: nTest ? res.loss / nTest : NaN,
					testAcc: nTest ? res.correct / nTest : NaN
				};
			}
			return { epoch: trainer.epoch, trainLoss: cache.trainLoss, trainAcc: cache.trainAcc, testLoss: cache.testLoss, testAcc: cache.testAcc };
		}

		function step(epochs) {
			run(epochs);
			return metrics();
		}

		function table() {
			metrics();
			return { p: p, pred: new Uint8Array(pred), isTrain: new Uint8Array(isTrain), prob: new Float32Array(prob) };
		}

		function weights() {
			return { W1a: new Float32Array(W1a), W1b: new Float32Array(W1b), W2: new Float32Array(W2) };
		}

		// load(weights, { epoch }) : weights is { W1a, W1b, W2 }, a base64 string from encodeWeights, or a
		// snapshot { weights, epoch }. The optimiser's moments start again from zero.
		function loadWeights(w, opts) {
			var ww = weightsOf(w, p, hidden, 'load: weights');
			W1a.set(ww.W1a);
			W1b.set(ww.W1b);
			W2.set(ww.W2);
			resetAdam();
			if (opts && isInt(opts.epoch)) trainer.epoch = opts.epoch;
			else if (w && typeof w === 'object' && isInt(w.epoch)) trainer.epoch = w.epoch;
			cache = null;
			return metrics();
		}

		function reset() {
			initWeights();
			resetAdam();
			trainer.epoch = 0;
			cache = null;
			return metrics();
		}

		// set({ lr, wd, beta1, beta2, eps }): change the optimiser's settings from the next epoch on.
		// The weights, the moments and the epoch counter stay. Returns the settings now in force.
		function set(o) {
			var keys = ['lr', 'wd', 'beta1', 'beta2', 'eps'], i, k, v;
			o = o || {};
			for (k in o) if (keys.indexOf(k) < 0) fail('set: only lr, wd, beta1, beta2 and eps can change during a run (got "' + k + '")');
			for (i = 0; i < keys.length; i++) {
				k = keys[i];
				if (o[k] === undefined || o[k] === null) continue;
				v = +o[k];
				if (k === 'lr' && !(v > 0)) fail('lr must be positive');
				if (k === 'wd' && !(v >= 0)) fail('wd must be zero or positive');
				if ((k === 'beta1' || k === 'beta2') && !(v >= 0 && v < 1)) fail(k + ' must be at least 0 and below 1');
				if (k === 'eps' && !(v > 0)) fail('eps must be positive');
				cfg[k] = v;
			}
			return { lr: cfg.lr, wd: cfg.wd, beta1: cfg.beta1, beta2: cfg.beta2, eps: cfg.eps };
		}

		// ---- public: looking inside ----

		function norms() {
			var a = 0, b = 0, c = 0, i;
			for (i = 0; i < PH; i++) {
				a += W1a[i] * W1a[i];
				b += W1b[i] * W1b[i];
				c += W2[i] * W2[i];
			}
			return { W1a: Math.sqrt(a), W1b: Math.sqrt(b), W2: Math.sqrt(c), total: Math.sqrt(a + b + c) };
		}

		// spectrum({ of: 'a' | 'b' | 'out' }): the discrete Fourier transform, over the p values of one
		// number, of each hidden unit's weights: of 'a' the column of W1a (how the unit responds to a),
		// of 'b' the column of W1b, of 'out' the unit's row of W2 (what it writes to each answer).
		// The constant term is left out of the shares.
		function spectrum(opts) {
			var of = (opts && opts.of) || 'a', K = p >> 1, cosT = new Float64Array(p), sinT = new Float64Array(p),
				freq = new Int32Array(hidden), purity = new Float32Array(hidden), amp = new Float32Array(hidden), phase = new Float32Array(hidden), dc = new Float32Array(hidden),
				counts = new Int32Array(K + 1), power = new Float32Array(K + 1), x = new Float64Array(p),
				j, a, k, re, im, pw, total, best, bestK, bestRe, bestIm, sum, mean = 0, grand = 0, m;
			if (of !== 'a' && of !== 'b' && of !== 'out') fail('spectrum: of must be "a", "b" or "out"');
			for (a = 0; a < p; a++) {
				cosT[a] = Math.cos(2 * Math.PI * a / p);
				sinT[a] = Math.sin(2 * Math.PI * a / p);
			}
			for (j = 0; j < hidden; j++) {
				sum = 0;
				for (a = 0; a < p; a++) {
					x[a] = of === 'a' ? W1a[a * hidden + j] : of === 'b' ? W1b[a * hidden + j] : W2[j * p + a];
					sum += x[a];
				}
				total = 0;
				best = -1;
				bestK = 0;
				bestRe = 0;
				bestIm = 0;
				for (k = 1; k <= K; k++) {
					re = 0;
					im = 0;
					m = 0;
					for (a = 0; a < p; a++) {
						re += x[a] * cosT[m];
						im -= x[a] * sinT[m];
						m += k;
						if (m >= p) m -= p;
					}
					pw = re * re + im * im;
					if (2 * k !== p) pw *= 2;
					total += pw;
					power[k] += pw;
					if (pw > best) {
						best = pw;
						bestK = k;
						bestRe = re;
						bestIm = im;
					}
				}
				freq[j] = bestK;
				purity[j] = total > 0 ? best / total : 0;
				amp[j] = (2 * bestK === p ? 1 : 2) * Math.sqrt(bestRe * bestRe + bestIm * bestIm) / p;
				phase[j] = Math.atan2(bestIm, bestRe);
				dc[j] = total + sum * sum > 0 ? sum * sum / (total + sum * sum) : 0;
				counts[bestK]++;
				mean += purity[j];
				grand += total;
			}
			if (grand > 0) for (k = 0; k <= K; k++) power[k] /= grand;
			return { of: of, K: K, freq: freq, purity: purity, amp: amp, phase: phase, dc: dc, mean: mean / hidden, counts: counts, power: power };
		}

		// ---- public: evaluating other weights ----

		function listOf(which) {
			var all, i;
			if (which && typeof which === 'object' && typeof which.length === 'number') return indexList(which);
			if (which === 'test') return testIdx;
			if (which === 'all') {
				all = new Int32Array(N);
				for (i = 0; i < N; i++) all[i] = i;
				return all;
			}
			if (which === undefined || which === null || which === 'train') return trainIdx;
			fail('expected "train", "test", "all" or a list of [a, b] pairs, got ' + JSON.stringify(which));
		}

		// lossAt(weights, 'train' | 'test' | 'all' | [[a, b], ...]) -> { loss, acc }.
		// weights: { W1a, W1b, W2 }, null for the trainer's own, or { xy: [x, y] }, a point on the
		// plane of the last slice().
		function lossAt(w, which) {
			var ww, idx = listOf(which), r;
			if (w && w.xy) {
				if (!plane) fail('lossAt({ xy }) needs a slice() first');
				planePoint(+w.xy[0], +w.xy[1], T);
				ww = T;
			} else {
				ww = w === undefined || w === null ? own() : weightsOf(w, p, hidden, 'lossAt: weights');
			}
			r = evalList(ww, idx, idx.length);
			return { loss: r.loss, acc: r.acc };
		}

		function pairIndex(pair) {
			var a, b;
			if (typeof pair === 'number') {
				if (!isInt(pair) || pair < 0 || pair >= N) fail('pair index ' + pair + ' is out of range');
				return pair;
			}
			a = pair[0];
			b = pair[1];
			if (!isInt(a) || !isInt(b) || a < 0 || b < 0 || a >= p || b >= p) fail('pair [' + a + ', ' + b + '] is out of range for p = ' + p);
			return a * p + b;
		}

		function indexList(pairs) {
			var seen = new Uint8Array(N), i, n = 0, out, k = 0;
			for (i = 0; i < pairs.length; i++) seen[pairIndex(pairs[i])] = 1;
			for (i = 0; i < N; i++) n += seen[i];
			out = new Int32Array(n);
			for (i = 0; i < N; i++) if (seen[i]) out[k++] = i;
			return out;
		}

		// evalOn(pairs, weights) -> { loss, acc, n } on any list of [a, b] pairs (duplicates count once).
		function evalOn(pairs, w) {
			var idx = indexList(pairs);
			return evalList(w === undefined || w === null ? own() : weightsOf(w, p, hidden, 'evalOn: weights'), idx, idx.length);
		}

		// ---- public: unlearning ----

		function unlearnJob(o) {
			var method, forgetIdx, inForget = new Uint8Array(N), retainIdx, testRest, i, k, steps, every, lr, job, before, forgetInTrain = 0,
				plainAscent, aM = null, aV = null, ascT = 0, asc1 = 1, asc2 = 1;
			o = o || {};
			method = o.method || 'ascent';
			if (method !== 'ascent' && method !== 'retrain' && method !== 'finetune') fail('unlearn: method must be "ascent", "retrain" or "finetune"');
			if (o.rule !== undefined && o.rule !== null && o.rule !== 'adam' && o.rule !== 'sgd') fail('unlearn: rule must be "adam" or "sgd"');
			plainAscent = o.rule === 'sgd';
			if (!o.forget || !o.forget.length) fail('unlearn: forget must list at least one [a, b] pair');
			forgetIdx = indexList(o.forget);
			for (i = 0; i < forgetIdx.length; i++) {
				inForget[forgetIdx[i]] = 1;
				if (isTrain[forgetIdx[i]]) forgetInTrain++;
			}
			retainIdx = new Int32Array(nTrain - forgetInTrain);
			for (i = 0, k = 0; i < nTrain; i++) if (!inForget[trainIdx[i]]) retainIdx[k++] = trainIdx[i];
			testRest = new Int32Array(nTest - (forgetIdx.length - forgetInTrain));
			for (i = 0, k = 0; i < nTest; i++) if (!inForget[testIdx[i]]) testRest[k++] = testIdx[i];
			if ((method === 'retrain' || method === 'finetune') && retainIdx.length === 0) fail('unlearn: nothing would be left to train on');
			steps = o.steps === undefined || o.steps === null ? (method === 'ascent' ? 30 : method === 'finetune' ? 5 : Math.max(1, trainer.epoch)) : o.steps | 0;
			if (steps < 0) fail('unlearn: steps must be zero or more');
			every = o.every === undefined || o.every === null ? (method === 'retrain' ? 10 : 1) : Math.max(1, o.every | 0);
			// The ascent's own step size. 0.003 with the 'adam' rule moves every weight by about 0.003 a step,
			// which on the default network starts to break the forget pairs after about 25 steps.
			lr = o.lr === undefined || o.lr === null ? (method === 'ascent' ? (plainAscent ? 1 : 0.003) : cfg.lr) : +o.lr;
			if (!(lr > 0)) fail('unlearn: lr must be positive');

			function sets() {
				var w = own(), f = evalList(w, forgetIdx, forgetIdx.length), r = evalList(w, retainIdx, retainIdx.length), t = evalList(w, testRest, testRest.length);
				return { forget: f, retain: r, test: t };
			}

			function record(at) {
				var m = sets();
				m.step = at;
				job.curve.push(m);
				job.last = m;
				return m;
			}

			// One step UP the mean loss of the forget pairs. 'adam' (the default) is the trainer's own
			// update rule with the gradient's sign flipped, fresh moments and no weight decay; 'sgd' is
			// the bare w += lr * gradient.
			function ascentStep() {
				var j2, c1, c2;
				zeroG();
				pass(W1a, W1b, W2, forgetIdx, forgetIdx.length, G, null, null);
				if (plainAscent) {
					for (j2 = 0; j2 < PH; j2++) {
						W1a[j2] = W1a[j2] + lr * G.W1a[j2];
						W1b[j2] = W1b[j2] + lr * G.W1b[j2];
						W2[j2] = W2[j2] + lr * G.W2[j2];
					}
				} else {
					for (j2 = 0; j2 < PH; j2++) {
						G.W1a[j2] = -G.W1a[j2];
						G.W1b[j2] = -G.W1b[j2];
						G.W2[j2] = -G.W2[j2];
					}
					ascT++;
					asc1 *= cfg.beta1;
					asc2 *= cfg.beta2;
					c1 = 1 - asc1;
					c2 = 1 - asc2;
					adamUpdate(W1a, G.W1a, aM.W1a, aV.W1a, lr, 0, cfg.beta1, cfg.beta2, cfg.eps, c1, c2);
					adamUpdate(W1b, G.W1b, aM.W1b, aV.W1b, lr, 0, cfg.beta1, cfg.beta2, cfg.eps, c1, c2);
					adamUpdate(W2, G.W2, aM.W2, aV.W2, lr, 0, cfg.beta1, cfg.beta2, cfg.eps, c1, c2);
				}
				cache = null;
			}

			job = {
				method: method,
				steps: steps,
				every: every,
				at: 0,
				done: false,
				curve: [],
				last: null,
				result: null,
				// Advance by at most `count` steps (all the rest when left out). Returns the job.
				step: function (count) {
					var c2 = count === undefined || count === null ? Infinity : count, done = 0;
					while (!job.done && done < c2) {
						if (job.at >= steps) {
							finish();
							break;
						}
						if (method === 'ascent') ascentStep();
						else {
							epochOn(retainIdx, retainIdx.length);
							trainer.epoch++;
						}
						job.at++;
						done++;
						if (job.at % every === 0 && job.at < steps) record(job.at);
						if (job.at >= steps) finish();
					}
					return job;
				},
				// Give up early: the result describes the network as it is now, with stopped: true.
				stop: function () {
					if (!job.done) {
						finish();
						job.result.stopped = true;
					}
					return job;
				}
			};

			function finish() {
				var after;
				if (job.done) return;
				after = job.at > 0 && job.curve.length && job.curve[job.curve.length - 1].step === job.at ? job.curve[job.curve.length - 1] : record(job.at);
				job.done = true;
				job.result = {
					method: method,
					rule: method === 'ascent' ? (plainAscent ? 'sgd' : 'adam') : 'adamw',
					steps: job.at,
					lr: method === 'ascent' ? lr : cfg.lr,
					counts: { forget: forgetIdx.length, forgetInTrain: forgetInTrain, retain: retainIdx.length, test: testRest.length },
					before: before,
					after: { forget: after.forget, retain: after.retain, test: after.test },
					curve: job.curve,
					epoch: trainer.epoch,
					stopped: false
				};
			}

			before = sets();
			if (method === 'retrain') {
				initWeights();
				resetAdam();
				trainer.epoch = 0;
				cache = null;
			} else if (method === 'ascent') {
				// The trainer's own moments describe the point the ascent is about to leave.
				resetAdam();
				if (!plainAscent) {
					aM = { W1a: new Float64Array(PH), W1b: new Float64Array(PH), W2: new Float64Array(PH) };
					aV = { W1a: new Float64Array(PH), W1b: new Float64Array(PH), W2: new Float64Array(PH) };
				}
			}
			record(0);
			if (steps === 0) finish();
			return job;
		}

		function unlearn(o) {
			var job = unlearnJob(o);
			while (!job.done) job.step();
			return job.result;
		}

		// ---- public: merging ----

		// matchUnits(other) -> { match, sign }: the permutation of the other network's hidden units that
		// maximises the summed inner product between each of this network's units and the unit matched
		// to it (incoming weights from both tables and outgoing weights together). One linear assignment
		// problem, solved exactly; for a one-hidden-layer network this is the whole of "weight matching".
		// sign is all ones for relu and sigmoid. For an even activation (square) a unit's incoming
		// weights may be negated freely, and for an odd one (tanh, linear) incoming and outgoing together;
		// the sign that matches better is chosen.
		function matchUnits(other, o2) {
			var B = weightsOf(other, p, hidden, 'merge: the other weights'), S1 = new Float64Array(hidden * hidden), S2 = new Float64Array(hidden * hidden),
				cost = new Float64Array(hidden * hidden), sign = new Int8Array(hidden), a, i, j, c, x, o, oi, oj, acc, match, even = actId === 1, odd = actId === 2 || actId === 4, t0 = now(), ms, sim = null;
			for (a = 0; a < p; a++) {
				o = a * hidden;
				for (i = 0; i < hidden; i++) {
					x = W1a[o + i];
					oi = i * hidden;
					for (j = 0; j < hidden; j++) S1[oi + j] += x * B.W1a[o + j];
					x = W1b[o + i];
					for (j = 0; j < hidden; j++) S1[oi + j] += x * B.W1b[o + j];
				}
			}
			for (i = 0; i < hidden; i++) {
				oi = i * p;
				for (j = 0; j < hidden; j++) {
					oj = j * p;
					acc = 0;
					for (c = 0; c < p; c++) acc += W2[oi + c] * B.W2[oj + c];
					S2[i * hidden + j] = acc;
				}
			}
			for (i = 0; i < hidden * hidden; i++) {
				if (even) cost[i] = -((S1[i] < 0 ? -S1[i] : S1[i]) + S2[i]);
				else if (odd) cost[i] = -(S1[i] + S2[i] < 0 ? -(S1[i] + S2[i]) : S1[i] + S2[i]);
				else cost[i] = -(S1[i] + S2[i]);
			}
			match = hungarian(cost, hidden);
			for (i = 0; i < hidden; i++) {
				j = i * hidden + match[i];
				sign[i] = even ? (S1[j] < 0 ? -1 : 1) : odd ? (S1[j] + S2[j] < 0 ? -1 : 1) : 1;
			}
			ms = now() - t0;
			if (o2 && o2.similarity) {
				// What the assignment maximised: row i = this network's unit i, column j = the other's unit j.
				sim = new Float32Array(hidden * hidden);
				for (i = 0; i < hidden * hidden; i++) sim[i] = -cost[i];
			}
			return { match: match, sign: sign, ms: ms, similarity: sim };
		}

		// permuteUnits(weights, match, sign) -> the same function with its hidden units reordered:
		// unit match[i] of the input becomes unit i of the result.
		function permuteUnits(w, match, sign) {
			var B = weightsOf(w, p, hidden, 'permuteUnits: weights'), out = { W1a: new Float32Array(PH), W1b: new Float32Array(PH), W2: new Float32Array(PH) },
				i, a, c, src, s1, s2, even = actId === 1;
			if (!match || match.length !== hidden) fail('permuteUnits: match must have one entry per hidden unit');
			for (i = 0; i < hidden; i++) {
				src = match[i];
				s1 = sign ? sign[i] : 1;
				s2 = even ? 1 : s1;
				for (a = 0; a < p; a++) {
					out.W1a[a * hidden + i] = s1 * B.W1a[a * hidden + src];
					out.W1b[a * hidden + i] = s1 * B.W1b[a * hidden + src];
				}
				for (c = 0; c < p; c++) out.W2[i * p + c] = s2 * B.W2[src * p + c];
			}
			return out;
		}

		function mix(A, B, alpha, out) {
			var i;
			for (i = 0; i < PH; i++) {
				out.W1a[i] = (1 - alpha) * A.W1a[i] + alpha * B.W1a[i];
				out.W1b[i] = (1 - alpha) * A.W1b[i] + alpha * B.W1b[i];
				out.W2[i] = (1 - alpha) * A.W2[i] + alpha * B.W2[i];
			}
			return out;
		}

		// merge(otherWeights, { align, alpha, alphas }) -> { weights, match, sign, other, alpha, align, train, test, curve }
		// weights = (1 - alpha) * this + alpha * other, the other one permuted first when align is true.
		// This trainer's own weights are not changed.
		function merge(other, o) {
			var B = weightsOf(other, p, hidden, 'merge: the other weights'), align, alpha, m, match, sign, i, out, curve = null, t, ms = 0, sim = null;
			o = o || {};
			align = !!o.align;
			alpha = o.alpha === undefined || o.alpha === null ? 0.5 : +o.alpha;
			if (align || o.similarity) {
				m = matchUnits(B, { similarity: !!o.similarity });
				sim = m.similarity;
			}
			if (align) {
				match = m.match;
				sign = m.sign;
				ms = m.ms;
				B = permuteUnits(B, match, sign);
			} else {
				match = new Int32Array(hidden);
				sign = new Int8Array(hidden);
				for (i = 0; i < hidden; i++) {
					match[i] = i;
					sign[i] = 1;
				}
				B = { W1a: new Float32Array(B.W1a), W1b: new Float32Array(B.W1b), W2: new Float32Array(B.W2) };
			}
			out = mix(own(), B, alpha, { W1a: new Float32Array(PH), W1b: new Float32Array(PH), W2: new Float32Array(PH) });
			if (o.alphas && o.alphas.length) {
				curve = [];
				for (i = 0; i < o.alphas.length; i++) {
					mix(own(), B, +o.alphas[i], T);
					t = { alpha: +o.alphas[i], train: evalList(T, trainIdx, nTrain), test: evalList(T, testIdx, nTest) };
					curve.push({ alpha: t.alpha, trainLoss: t.train.loss, trainAcc: t.train.acc, testLoss: t.test.loss, testAcc: t.test.acc });
				}
			}
			t = { train: evalList(out, trainIdx, nTrain), test: evalList(out, testIdx, nTest) };
			return {
				weights: out, match: match, sign: sign, other: B, alpha: alpha, align: align, matchMs: ms,
				trainLoss: t.train.loss, trainAcc: t.train.acc, testLoss: t.test.loss, testAcc: t.test.acc, curve: curve, similarity: sim
			};
		}

		// ---- public: attribution ----

		// One pair's hidden activations h, error vector delta = softmax - onehot, and dpre = dLoss/d(pre-activation).
		function example(pair, h, delta, dpre) {
			var a = (pair / p) | 0, b = pair - a * p, y = (a + b) % p, oa = a * hidden, ob = b * hidden, j, c, pre, t, d, mx, sum, acc, o;
			for (c = 0; c < p; c++) delta[c] = 0;
			for (j = 0; j < hidden; j++) {
				pre = W1a[oa + j] + W1b[ob + j];
				if (actId === 0) { t = pre > 0 ? pre : 0; d = pre > 0 ? 1 : 0; }
				else if (actId === 1) { t = pre * pre; d = 2 * pre; }
				else if (actId === 2) { t = tanh(pre); d = 1 - t * t; }
				else if (actId === 3) { t = sigmoid(pre); d = t * (1 - t); }
				else { t = pre; d = 1; }
				h[j] = t;
				dpre[j] = d;
				if (t !== 0) {
					o = j * p;
					for (c = 0; c < p; c++) delta[c] += t * W2[o + c];
				}
			}
			mx = delta[0];
			for (c = 1; c < p; c++) if (delta[c] > mx) mx = delta[c];
			sum = 0;
			for (c = 0; c < p; c++) {
				delta[c] = exp(delta[c] - mx);
				sum += delta[c];
			}
			for (c = 0; c < p; c++) delta[c] /= sum;
			delta[y] -= 1;
			for (j = 0; j < hidden; j++) {
				if (dpre[j] !== 0) {
					o = j * p;
					acc = 0;
					for (c = 0; c < p; c++) acc += W2[o + c] * delta[c];
					dpre[j] *= acc;
				}
			}
		}

		// influence([a, b], { kind: 'cos' | 'dot', parts }) -> Float32Array(p * p), row a, column b.
		// For every TRAINING pair t: the similarity between the gradient of t's loss and the gradient of the
		// query's loss, both with respect to all weights, at the current weights. 'dot' is the inner product
		// (the first-order drop in the query's loss per unit of learning rate if one plain gradient step were
		// taken on t alone); 'cos', the default, divides it by both gradient norms. Zero for pairs outside
		// the training set. With parts: true the result is { total, out, a, b }, the same score split by
		// weight matrix (W2, W1a, W1b); the three parts add up to total.
		function influence(query, o) {
			var q = pairIndex(query), kind = (o && o.kind) || 'cos', parts = !!(o && o.parts),
				hq = new Float64Array(hidden), dq = new Float64Array(p), eq = new Float64Array(hidden),
				h = new Float64Array(hidden), d = new Float64Array(p), e = new Float64Array(hidden),
				total = new Float32Array(N), po = parts ? new Float32Array(N) : null, pa = parts ? new Float32Array(N) : null, pb = parts ? new Float32Array(N) : null,
				qa = (q / p) | 0, qb = q - qa * p, s, t, ta, tb, j, c, hh, dd, ee, nh, nd, ne, nq, nt, vOut, vA, vB, den;
			if (kind !== 'cos' && kind !== 'dot') fail('influence: kind must be "cos" or "dot"');
			example(q, hq, dq, eq);
			hh = 0; dd = 0; ee = 0;
			for (j = 0; j < hidden; j++) { hh += hq[j] * hq[j]; ee += eq[j] * eq[j]; }
			for (c = 0; c < p; c++) dd += dq[c] * dq[c];
			nq = Math.sqrt(hh * dd + 2 * ee);
			for (s = 0; s < nTrain; s++) {
				t = trainIdx[s];
				ta = (t / p) | 0;
				tb = t - ta * p;
				example(t, h, d, e);
				hh = 0; dd = 0; ee = 0; nh = 0; nd = 0; ne = 0;
				for (j = 0; j < hidden; j++) {
					hh += h[j] * hq[j];
					ee += e[j] * eq[j];
					nh += h[j] * h[j];
					ne += e[j] * e[j];
				}
				for (c = 0; c < p; c++) {
					dd += d[c] * dq[c];
					nd += d[c] * d[c];
				}
				vOut = hh * dd;
				vA = ta === qa ? ee : 0;
				vB = tb === qb ? ee : 0;
				if (kind === 'cos') {
					nt = Math.sqrt(nh * nd + 2 * ne);
					den = nt * nq;
					if (den > 0) {
						vOut /= den;
						vA /= den;
						vB /= den;
					} else {
						vOut = 0;
						vA = 0;
						vB = 0;
					}
				}
				total[t] = vOut + vA + vB;
				if (parts) {
					po[t] = vOut;
					pa[t] = vA;
					pb[t] = vB;
				}
			}
			return parts ? { total: total, out: po, a: pa, b: pb, kind: kind } : total;
		}

		// ---- public: loss-landscape slices ----

		// The weights at (x, y) of a plane { origin, d1, d2 }; the plane of the last slice when none is given.
		function planePoint(x, y, out, pl) {
			var i, o = (pl || plane).origin, d1 = (pl || plane).d1, d2 = (pl || plane).d2;
			for (i = 0; i < PH; i++) {
				out.W1a[i] = o.W1a[i] + x * d1.W1a[i] + y * d2.W1a[i];
				out.W1b[i] = o.W1b[i] + x * d1.W1b[i] + y * d2.W1b[i];
				out.W2[i] = o.W2[i] + x * d1.W2[i] + y * d2.W2[i];
			}
			return out;
		}

		function frob(a) {
			var s = 0, i;
			for (i = 0; i < a.length; i++) s += a[i] * a[i];
			return Math.sqrt(s);
		}

		function dot3(A, B) {
			var s = 0, i;
			for (i = 0; i < PH; i++) s += A.W1a[i] * B.W1a[i] + A.W1b[i] * B.W1b[i] + A.W2[i] * B.W2[i];
			return s;
		}

		// k of the entries of idx, chosen with r and kept in ascending order (all of them when k is not smaller).
		function subset(idx, k, r) {
			var copy, out;
			if (k >= idx.length) return idx;
			copy = new Int32Array(idx);
			r.shuffle(copy);
			out = copy.slice(0, k);
			out.sort(); // a typed array sorts by value
			return out;
		}

		// A Gaussian direction whose three matrices are rescaled to the norms in `target`.
		function randomDirection(r, target) {
			var d = { W1a: new Float64Array(PH), W1b: new Float64Array(PH), W2: new Float64Array(PH) }, names = ['W1a', 'W1b', 'W2'], q, i, m, nrm, f;
			for (q = 0; q < 3; q++) {
				m = d[names[q]];
				for (i = 0; i < PH; i++) m[i] = r.normal();
				nrm = frob(m);
				f = nrm > 0 ? target[q] / nrm : 0;
				for (i = 0; i < PH; i++) m[i] *= f;
			}
			return d;
		}

		function sliceJob(o) {
			var n, span, which, seed, r, origin, d1, d2, other = null, other2 = null, target, i, cx, cy, xs, ys, loss, acc, lossTest = null, accTest = null, job, total,
				points, len1, proj, u, both, idxA, idxB, own2, t0 = now();
			o = o || {};
			n = o.n === undefined || o.n === null ? 25 : o.n | 0;
			if (n < 2 || n > 201) fail('slice: n must be from 2 to 201');
			span = o.span === undefined || o.span === null ? 1 : +o.span;
			if (!(span > 0)) fail('slice: span must be positive');
			which = o.which || 'train';
			if (which !== 'train' && which !== 'test' && which !== 'both') fail('slice: which must be "train", "test" or "both"');
			both = which === 'both';
			seed = o.seed === undefined || o.seed === null ? 1 : o.seed;
			r = rng(String(seed) + '/slice');
			origin = { W1a: new Float64Array(W1a), W1b: new Float64Array(W1b), W2: new Float64Array(W2) };
			points = { self: [0, 0], other: null, other2: null };
			if (o.toward) {
				other = weightsOf(o.toward, p, hidden, 'slice: toward');
				d1 = { W1a: new Float64Array(PH), W1b: new Float64Array(PH), W2: new Float64Array(PH) };
				for (i = 0; i < PH; i++) {
					d1.W1a[i] = other.W1a[i] - origin.W1a[i];
					d1.W1b[i] = other.W1b[i] - origin.W1b[i];
					d1.W2[i] = other.W2[i] - origin.W2[i];
				}
				len1 = Math.sqrt(dot3(d1, d1));
				if (!(len1 > 0)) fail('slice: toward is the same point as the current weights');
				points.other = [1, 0];
				if (o.toward2) {
					// The plane through three networks, drawn without distortion: the second axis is the part of
					// (toward2 - self) at right angles to the first, rescaled to the first axis's length.
					other2 = weightsOf(o.toward2, p, hidden, 'slice: toward2');
					d2 = { W1a: new Float64Array(PH), W1b: new Float64Array(PH), W2: new Float64Array(PH) };
					for (i = 0; i < PH; i++) {
						d2.W1a[i] = other2.W1a[i] - origin.W1a[i];
						d2.W1b[i] = other2.W1b[i] - origin.W1b[i];
						d2.W2[i] = other2.W2[i] - origin.W2[i];
					}
					proj = dot3(d2, d1) / (len1 * len1);
					for (i = 0; i < PH; i++) {
						d2.W1a[i] -= proj * d1.W1a[i];
						d2.W1b[i] -= proj * d1.W1b[i];
						d2.W2[i] -= proj * d1.W2[i];
					}
					u = Math.sqrt(dot3(d2, d2));
					if (!(u > 1e-9 * len1)) fail('slice: toward2 lies on the line through the current weights and toward');
					for (i = 0; i < PH; i++) {
						d2.W1a[i] *= len1 / u;
						d2.W1b[i] *= len1 / u;
						d2.W2[i] *= len1 / u;
					}
					points.other2 = [proj, u / len1];
				} else {
					target = [frob(d1.W1a), frob(d1.W1b), frob(d1.W2)];
					d2 = randomDirection(r, target);
				}
			} else {
				target = [frob(origin.W1a), frob(origin.W1b), frob(origin.W2)];
				d1 = randomDirection(r, target);
				d2 = randomDirection(r, target);
			}
			cx = o.center ? +o.center[0] : (o.toward ? 0.5 : 0);
			cy = o.center ? +o.center[1] : (points.other2 ? 0.5 * points.other2[1] : 0);
			xs = new Float32Array(n);
			ys = new Float32Array(n);
			for (i = 0; i < n; i++) {
				// Written so that the middle of an odd grid is exactly the centre.
				xs[i] = cx + span * (2 * i - (n - 1)) / (n - 1);
				ys[i] = cy + span * (2 * i - (n - 1)) / (n - 1);
			}
			total = n * n;
			loss = new Float32Array(total).fill(NaN);
			acc = new Float32Array(total).fill(NaN);
			if (both) {
				lossTest = new Float32Array(total).fill(NaN);
				accTest = new Float32Array(total).fill(NaN);
			}
			idxA = which === 'test' ? testIdx : trainIdx;
			idxB = testIdx;
			if (o.sample !== undefined && o.sample !== null) {
				// A fixed random subset of the pairs: faster, and no longer the exact loss.
				if (!isInt(o.sample) || o.sample < 1) fail('slice: sample must be a positive integer');
				idxA = subset(idxA, o.sample, rng(String(seed) + '/sample'));
				if (both) idxB = subset(idxB, o.sample, rng(String(seed) + '/sample-test'));
			}
			// This job keeps its own plane, so a job that is still being stepped is not disturbed by a later
			// slice; lossAt({ xy }), gradAt({ xy }) and planeWeights read the plane of the latest one.
			own2 = { origin: origin, d1: d1, d2: d2 };
			plane = own2;

			function finish(stopped) {
				job.done = true;
				job.result = {
					n: n, which: which, loss: loss, acc: acc, lossTest: lossTest, accTest: accTest,
					axes: { x: xs, y: ys }, points: points, center: [cx, cy], span: span, pairs: idxA.length,
					done: job.at, total: total, ms: now() - t0, stopped: stopped
				};
			}

			job = {
				n: n,
				total: total,
				at: 0,
				done: false,
				result: null,
				// Compute at most `count` grid points (all the rest when left out). Returns the job.
				step: function (count) {
					var c2 = count === undefined || count === null ? Infinity : count, done = 0, ix, iy, e;
					while (!job.done && job.at < total && done < c2) {
						iy = (job.at / n) | 0;
						ix = job.at - iy * n;
						planePoint(xs[ix], ys[iy], T, own2);
						e = evalList(T, idxA, idxA.length);
						loss[job.at] = e.loss;
						acc[job.at] = e.acc;
						if (both) {
							e = evalList(T, idxB, idxB.length);
							lossTest[job.at] = e.loss;
							accTest[job.at] = e.acc;
						}
						job.at++;
						done++;
					}
					if (job.at >= total && !job.done) finish(false);
					return job;
				},
				// Give up early: the points not reached stay NaN, and the result says stopped: true.
				stop: function () {
					if (!job.done) finish(true);
					return job;
				}
			};
			return job;
		}

		// slice({ toward, toward2, seed, n, span, center, which }) -> { n, loss, acc, axes: { x, y }, points, ... }
		// loss[iy * n + ix] is the loss at self + axes.x[ix] * d1 + axes.y[iy] * d2.
		function slice(o) {
			var job = sliceJob(o);
			while (!job.done) job.step();
			return job.result;
		}

		// planeWeights(x, y) -> the weights at a point of the last slice's plane.
		function planeWeights(x, y) {
			if (!plane) fail('planeWeights needs a slice() first');
			return planePoint(+x, +y, { W1a: new Float32Array(PH), W1b: new Float32Array(PH), W2: new Float32Array(PH) });
		}

		// gradAt(weights, 'train' | 'test' | 'all' | [[a, b], ...]) -> { loss, acc, grad: { W1a, W1b, W2 }, xy }:
		// the gradient of the mean loss at any weights (Float64Array copies). xy is that gradient projected
		// on the axes of the last slice, [dLoss/dx, dLoss/dy], or null when there is no slice yet.
		function gradAt(w, which) {
			var ww, idx = listOf(which), n = idx.length, out, xy = null;
			if (w && w.xy) {
				if (!plane) fail('gradAt({ xy }) needs a slice() first');
				planePoint(+w.xy[0], +w.xy[1], T);
				ww = T;
			} else {
				ww = w === undefined || w === null ? own() : weightsOf(w, p, hidden, 'gradAt: weights');
			}
			zeroG();
			pass(ww.W1a, ww.W1b, ww.W2, idx, n, G, null, null);
			out = { loss: n ? res.loss / n : NaN, acc: n ? res.correct / n : NaN, grad: { W1a: new Float64Array(G.W1a), W1b: new Float64Array(G.W1b), W2: new Float64Array(G.W2) }, xy: null };
			if (plane) xy = [dot3(G, plane.d1), dot3(G, plane.d2)];
			out.xy = xy;
			return out;
		}

		trainer = {
			cfg: cfg,
			p: p,
			hidden: hidden,
			nTrain: nTrain,
			nTest: nTest,
			epoch: 0,
			step: step,
			run: run,
			metrics: metrics,
			table: table,
			spectrum: spectrum,
			norms: norms,
			weights: weights,
			load: loadWeights,
			reset: reset,
			set: set,
			lossAt: lossAt,
			gradAt: gradAt,
			evalOn: evalOn,
			unlearn: unlearn,
			unlearnJob: unlearnJob,
			matchUnits: matchUnits,
			permuteUnits: permuteUnits,
			merge: merge,
			influence: influence,
			slice: slice,
			sliceJob: sliceJob,
			planeWeights: planeWeights
		};

		initWeights();
		if (config && config.weights) loadWeights(config.weights, { epoch: isInt(config.epoch) ? config.epoch : 0 });
		return trainer;
	}

	// restore(snapshot) -> a trainer in the state of a snapshot { cfg, epoch, weights }.
	function restore(snap) {
		var t;
		if (!snap || !snap.cfg || !snap.weights) fail('restore needs a snapshot { cfg, epoch, weights }');
		t = grok(snap.cfg);
		t.load(snap.weights, { epoch: isInt(snap.epoch) ? snap.epoch : 0 });
		return t;
	}

	return {
		version: '1.0.0',
		// generic network
		create: create,
		forward: forward,
		backward: backward,
		softmaxCE: softmaxCE,
		mse: mse,
		bce: bce,
		adamw: adamw,
		sgd: sgd,
		clone: clone,
		serialize: serialize,
		load: load,
		lerp: lerp,
		acts: ACTS.slice(),
		// modular addition
		grok: grok,
		restore: restore,
		grokDefaults: function () {
			var o = {}, k;
			for (k in GROK_DEFAULTS) o[k] = GROK_DEFAULTS[k];
			return o;
		},
		encodeWeights: encodeWeights,
		decodeWeights: decodeWeights,
		hungarian: hungarian,
		// helpers
		rng: rng,
		hash: hashString,
		exp: exp,
		log: log,
		sigmoid: sigmoid,
		tanh: tanh,
		encodeFloats: encodeFloats,
		decodeFloats: decodeFloats
	};
});
