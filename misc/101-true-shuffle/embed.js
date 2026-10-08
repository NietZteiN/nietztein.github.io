/*
 * True Shuffle: embeddings and the map. Every track becomes a vector by one
 * of several recipes, the vectors give each track its nearest neighbours,
 * and the neighbour graph is laid out in two dimensions (a small UMAP-like
 * layout: attraction along the graph, repulsion from random samples). Pure:
 * no DOM, no network; the random source is passed in.
 *
 *   var E = TrueShuffle.embed;
 *   var vecs = E.vectors(tracks, 'labels', { taxonomy, now });   // Float32Array rows, unit length
 *   var nn = E.knn(vecs, 15);                                      // [{ ids: Int32Array, sims: Float32Array }]
 *   var lay = E.layout(vecs.length, nn, { rand });                 // lay.step(budgetMs) until lay.done
 *   lay.pos                                                        // Float32Array [x0, y0, x1, y1, ...]
 *
 * UMD: window.TrueShuffle.embed in the browser, module.exports in Node.
 */
(function (root, factory) {
	var node = typeof module === 'object' && module.exports;
	var api = factory();
	if (node) module.exports = api;
	else { root.TrueShuffle = root.TrueShuffle || {}; root.TrueShuffle.embed = api; }
})(typeof self !== 'undefined' ? self : this, function () {
	'use strict';

	var RECIPES = [
		{ key: 'labels', name: 'Sound', blurb: 'Your labels: genres, mood, scene, language, era and version. Songs that sound alike sit together.' },
		{ key: 'names', name: 'Names', blurb: 'What the titles, artists and works look like, letter by letter, in any script. Franchises and artists form islands.' },
		{ key: 'time', name: 'Taste timeline', blurb: 'Sound plus when you added each song: phases of your taste drift across the map.' },
		{ key: 'blend', name: 'Blend', blurb: 'Sound, names and time together.' },
		{ key: 'lm', name: 'Language model', blurb: 'A multilingual sentence model reads each song\'s description. Runs in your browser after a one-time download of about 120 MB.' }
	];
	var MOOD_RING = ['tender', 'wistful', 'dark', 'driving', 'bright', 'quirky'];
	var VERSION_FLAGS = ['cover', 'piano', 'orchestral', 'live', 'remix', 'acoustic', 'instrumental'];
	var DAY = 86400000;

	function str(v) { return v == null ? '' : String(v); }
	function fold(s) { return str(s).normalize('NFKC').toLowerCase(); }

	// ---- Text for the language model -------------------------------------------------------
	function describe(t, T) {
		var parts = [str(t.title)];
		if (t.titleAlt) parts.push('(' + t.titleAlt + ')');
		if (t.artist) parts.push('by ' + t.artist);
		if (t.origArtist) parts.push('originally by ' + t.origArtist);
		if (t.work) parts.push('from ' + t.work + (t.role ? ' ' + t.role : ''));
		if (t.genres && t.genres.length) parts.push(t.genres.join(', '));
		if (t.mood) parts.push(t.mood);
		if (t.scene && T && T.SCENE_NAME) parts.push(T.SCENE_NAME[t.scene] || t.scene);
		return parts.join(' ');
	}

	// ---- Recipes ----------------------------------------------------------------------------

	function unit(v) {
		var s = 0;
		for (var i = 0; i < v.length; i++) s += v[i] * v[i];
		s = Math.sqrt(s);
		if (s > 0) for (var j = 0; j < v.length; j++) v[j] /= s;
		return v;
	}
	// Hand-made features from the labels.
	function labelVectors(tracks, T) {
		var genres = [], gi = {}, fams = T ? T.FAMILIES.map(function (f) { return f.key; }) : [], scenes = T ? T.SCENES.map(function (s) { return s[0]; }) : [], langs = T ? T.LANGS.map(function (l) { return l[0]; }) : [];
		tracks.forEach(function (t) { (t.genres || []).forEach(function (g) { if (gi[g] == null) { gi[g] = genres.length; genres.push(g); } }); });
		var G = genres.length, F = fams.length, Sc = scenes.length, La = langs.length;
		var D = G + F + 2 + Sc + La + 1 + VERSION_FLAGS.length + 2;
		return tracks.map(function (t) {
			var v = new Float32Array(D), o = 0;
			(t.genres || []).forEach(function (g, k) { v[o + gi[g]] += k === 0 ? 1.2 : 0.8; });
			o += G;
			if (T) (t.genres || []).forEach(function (g) { var f = fams.indexOf(T.familyOf(g)); if (f >= 0) v[o + f] = 0.7; });
			o += F;
			var mi = MOOD_RING.indexOf(t.mood);
			if (mi >= 0) { var a = 2 * Math.PI * mi / MOOD_RING.length; v[o] = 0.9 * Math.cos(a); v[o + 1] = 0.9 * Math.sin(a); }
			o += 2;
			var si = scenes.indexOf(t.scene); if (si >= 0) v[o + si] = 0.8;
			o += Sc;
			var li = langs.indexOf(t.lang); if (li >= 0) v[o + li] = 0.6;
			o += La;
			if (t.year) v[o] = Math.max(-1, Math.min(1, (t.year - 2005) / 25)) * 0.5;
			o += 1;
			var ver = str(t.version);
			VERSION_FLAGS.forEach(function (f, k) { if (ver.indexOf(f) >= 0) v[o + k] = 0.35; });
			o += VERSION_FLAGS.length;
			if (t.kind === 'set') v[o] = 0.5;
			if (t.kind === 'clip') v[o + 1] = 1.5;
			return unit(v);
		});
	}
	// Character trigrams of the names, hashed into a signed random projection.
	var NAME_DIM = 160;
	function hash(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
	function nameVectors(tracks) {
		var df = {}, grams = tracks.map(function (t) {
			var fields = [[t.title, 1.2], [t.titleAlt, 0.8], [t.artist || t.artistGuess, 1.3], [t.artistNative, 0.8], [t.origArtist, 0.8], [t.work, 1.6], [t.channel, 0.5]];
			var bag = {};
			fields.forEach(function (f) {
				var s = ' ' + fold(f[0]).replace(/\s+/g, ' ').trim() + ' ';
				if (s.length < 3) return;
				// whole-word tokens and trigrams; CJK text gets bigrams too
				for (var i = 0; i + 3 <= s.length; i++) { var g = s.substr(i, 3); bag[g] = (bag[g] || 0) + f[1]; }
				for (var j = 0; j + 2 <= s.length; j++) { var b = s.substr(j, 2); if (/[\u3040-\u30FF\u3400-\u9FFF\uAC00-\uD7AF]/.test(b)) bag['2' + b] = (bag['2' + b] || 0) + f[1] * 0.7; }
			});
			for (var k in bag) df[k] = (df[k] || 0) + 1;
			return bag;
		});
		var N = tracks.length;
		return grams.map(function (bag) {
			var v = new Float32Array(NAME_DIM);
			for (var k in bag) {
				if (df[k] > N * 0.3) continue;                 // too common to tell anything apart
				var w = Math.log(1 + bag[k]) * Math.log(1 + N / df[k]), h = hash(k);
				v[h % NAME_DIM] += (h & 0x80000000 ? 1 : -1) * w;
				v[(h >>> 9) % NAME_DIM] += ((h >>> 3) & 1 ? 1 : -1) * w * 0.5;
			}
			return unit(v);
		});
	}
	// When a track was first added, as bumps on a ladder of moments across the
	// library's history: tracks added close together share bumps.
	function timeVectors(tracks, firstAdded) {
		var times = tracks.map(function (t) { return firstAdded(t) || 0; }), known = times.filter(Boolean);
		var lo = Math.min.apply(null, known.length ? known : [0]), hi = Math.max.apply(null, known.length ? known : [1]);
		var K = 24, span = Math.max(hi - lo, 30 * DAY), sigma = span / K;
		return times.map(function (x) {
			var v = new Float32Array(K);
			if (x) for (var k = 0; k < K; k++) { var c = lo + span * (k + 0.5) / K, d = (x - c) / sigma; v[k] = Math.exp(-d * d / 2); }
			return unit(v);
		});
	}
	function concat(parts, weights) {
		return parts[0].map(function (_, i) {
			var len = 0;
			parts.forEach(function (p) { len += p[i].length; });
			var v = new Float32Array(len), o = 0;
			parts.forEach(function (p, k) { var w = weights[k], x = p[i]; for (var j = 0; j < x.length; j++) v[o + j] = x[j] * w; o += x.length; });
			return unit(v);
		});
	}
	// tracks -> [Float32Array] of unit length. opts: { taxonomy, firstAdded, lm: { id: Float32Array } }
	function vectors(tracks, recipe, opts) {
		opts = opts || {};
		var T = opts.taxonomy, fa = opts.firstAdded || function () { return 0; };
		if (recipe === 'names') return nameVectors(tracks);
		if (recipe === 'time') return concat([labelVectors(tracks, T), timeVectors(tracks, fa)], [1, 0.9]);
		if (recipe === 'blend') return concat([labelVectors(tracks, T), nameVectors(tracks), timeVectors(tracks, fa)], [1, 0.75, 0.45]);
		if (recipe === 'lm') {
			var lm = opts.lm || {}, dim = 0;
			for (var k in lm) { dim = lm[k].length; break; }
			return tracks.map(function (t) { var v = lm[t.id]; return v ? unit(Float32Array.from(v)) : new Float32Array(dim || 1); });
		}
		return labelVectors(tracks, T);
	}

	// ---- Neighbours ---------------------------------------------------------------------------

	function dot(a, b) { var s = 0; for (var i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }
	// The k most similar rows of every row (cosine; rows are unit length).
	// Done in slices by knnStep for a page that must stay responsive.
	function knnJob(vecs, k) {
		var n = vecs.length, out = new Array(n), i = 0;
		k = Math.min(k, Math.max(1, n - 1));
		function row(r) {
			var ids = new Int32Array(k).fill(-1), sims = new Float32Array(k).fill(-Infinity), a = vecs[r];
			for (var j = 0; j < n; j++) {
				if (j === r) continue;
				var s = dot(a, vecs[j]);
				if (s <= sims[k - 1]) continue;
				var p = k - 1;
				while (p > 0 && sims[p - 1] < s) { sims[p] = sims[p - 1]; ids[p] = ids[p - 1]; p--; }
				sims[p] = s; ids[p] = j;
			}
			return { ids: ids, sims: sims };
		}
		return {
			done: n === 0,
			result: out,
			step: function (budgetMs) {
				var t0 = Date.now();
				while (i < n && (budgetMs == null || Date.now() - t0 < budgetMs)) { out[i] = row(i); i++; }
				this.done = i >= n;
				this.progress = n ? i / n : 1;
				return this.done;
			}
		};
	}
	function knn(vecs, k) { var j = knnJob(vecs, k); j.step(); return j.result; }

	// ---- Layout -----------------------------------------------------------------------------------
	// The neighbour graph laid out in 2D: edges weighted by similarity pull
	// their ends together, random pairs push apart (UMAP's curve, a = 1.58,
	// b = 0.9). Starts from the first two principal components so the result
	// is stable from run to run. step(budgetMs) runs some epochs.
	function pca2(vecs, rand) {
		var n = vecs.length, d = n ? vecs[0].length : 0, mean = new Float32Array(d), i, j;
		for (i = 0; i < n; i++) for (j = 0; j < d; j++) mean[j] += vecs[i][j] / n;
		function power(avoid) {
			var v = new Float32Array(d);
			for (j = 0; j < d; j++) v[j] = rand() - 0.5;
			for (var it = 0; it < 30; it++) {
				var w = new Float32Array(d);
				for (i = 0; i < n; i++) {
					var x = vecs[i], p = 0;
					for (j = 0; j < d; j++) p += (x[j] - mean[j]) * v[j];
					for (j = 0; j < d; j++) w[j] += p * (x[j] - mean[j]);
				}
				if (avoid) { var q = 0; for (j = 0; j < d; j++) q += w[j] * avoid[j]; for (j = 0; j < d; j++) w[j] -= q * avoid[j]; }
				unit(w);
				v = w;
			}
			return v;
		}
		var a = power(null), b = power(a), pos = new Float32Array(n * 2), mx = 1e-9;
		for (i = 0; i < n; i++) {
			var pa = 0, pb = 0;
			for (j = 0; j < d; j++) { pa += (vecs[i][j] - mean[j]) * a[j]; pb += (vecs[i][j] - mean[j]) * b[j]; }
			pos[2 * i] = pa; pos[2 * i + 1] = pb;
			mx = Math.max(mx, Math.abs(pa), Math.abs(pb));
		}
		for (i = 0; i < n * 2; i++) pos[i] = pos[i] / mx * 10 + (rand() - 0.5) * 0.05;
		return pos;
	}
	function layout(vecs, nn, opts) {
		opts = opts || {};
		var rand = opts.rand || Math.random, n = vecs.length, EPOCHS = opts.epochs || 260, NEG = opts.negatives || 4;
		var A = opts.a || 0.9, B = opts.b || 1.15;
		var pos = n ? pca2(vecs, rand) : new Float32Array(0);
		// symmetric edge list with weights from similarity rank
		var edges = [], seen = {};
		nn.forEach(function (row, i) {
			for (var r = 0; r < row.ids.length; r++) {
				var j = row.ids[r];
				if (j < 0) continue;
				var key = i < j ? i + ',' + j : j + ',' + i;
				var w = Math.exp(-r / 6) * Math.max(0.05, row.sims[r]);
				if (seen[key] != null) { edges[seen[key]][2] = Math.max(edges[seen[key]][2], w); continue; }
				seen[key] = edges.length;
				edges.push([i, j, w]);
			}
		});
		var epoch = 0;
		function clip(g) { return g > 4 ? 4 : g < -4 ? -4 : g; }
		var job = {
			pos: pos, edges: edges, done: n < 3, progress: 0,
			step: function (budgetMs) {
				var t0 = Date.now();
				while (epoch < EPOCHS && (budgetMs == null || Date.now() - t0 < budgetMs)) {
					var lr = 1 - epoch / EPOCHS;
					for (var e = 0; e < edges.length; e++) {
						var ed = edges[e];
						if (rand() > ed[2]) continue;
						var i = ed[0], j = ed[1];
						var dx = pos[2 * i] - pos[2 * j], dy = pos[2 * i + 1] - pos[2 * j + 1];
						var d2 = dx * dx + dy * dy;
						if (d2 > 0) {
							var ga = (-2 * A * B * Math.pow(d2, B - 1)) / (1 + A * Math.pow(d2, B));
							var gx = clip(ga * dx) * lr, gy = clip(ga * dy) * lr;
							pos[2 * i] += gx; pos[2 * i + 1] += gy; pos[2 * j] -= gx; pos[2 * j + 1] -= gy;
						}
						for (var s = 0; s < NEG; s++) {
							var k = Math.floor(rand() * n);
							if (k === i) continue;
							var ex = pos[2 * i] - pos[2 * k], ey = pos[2 * i + 1] - pos[2 * k + 1], e2 = ex * ex + ey * ey;
							var gr = (2 * B) / ((0.001 + e2) * (1 + A * Math.pow(e2, B)));
							pos[2 * i] += clip(gr * ex) * lr; pos[2 * i + 1] += clip(gr * ey) * lr;
						}
					}
					epoch++;
				}
				this.progress = epoch / EPOCHS;
				this.done = epoch >= EPOCHS;
				return this.done;
			}
		};
		return job;
	}

	// ---- Regions: k-means on the layout, each named by what it holds ------------------------------
	function regions(pos, tracks, k, rand) {
		var n = tracks.length;
		k = Math.max(1, Math.min(k, Math.floor(n / 8) || 1));
		var cx = new Float32Array(k), cy = new Float32Array(k), lab = new Int32Array(n), i, c;
		for (c = 0; c < k; c++) { var p = Math.floor(rand() * n); cx[c] = pos[2 * p]; cy[c] = pos[2 * p + 1]; }
		for (var it = 0; it < 25; it++) {
			for (i = 0; i < n; i++) {
				var best = 0, bd = Infinity;
				for (c = 0; c < k; c++) { var dx = pos[2 * i] - cx[c], dy = pos[2 * i + 1] - cy[c], d = dx * dx + dy * dy; if (d < bd) { bd = d; best = c; } }
				lab[i] = best;
			}
			var sx = new Float64Array(k), sy = new Float64Array(k), cnt = new Int32Array(k);
			for (i = 0; i < n; i++) { sx[lab[i]] += pos[2 * i]; sy[lab[i]] += pos[2 * i + 1]; cnt[lab[i]]++; }
			for (c = 0; c < k; c++) if (cnt[c]) { cx[c] = sx[c] / cnt[c]; cy[c] = sy[c] / cnt[c]; }
		}
		var out = [];
		for (c = 0; c < k; c++) {
			var members = [], g = {}, w = {}, mo = {};
			for (i = 0; i < n; i++) if (lab[i] === c) {
				members.push(i);
				var t = tracks[i];
				if (t.genres && t.genres[0]) g[t.genres[0]] = (g[t.genres[0]] || 0) + 1;
				if (t.work) w[t.work] = (w[t.work] || 0) + 1;
				if (t.mood) mo[t.mood] = (mo[t.mood] || 0) + 1;
			}
			if (!members.length) continue;
			var topG = Object.keys(g).sort(function (a, b) { return g[b] - g[a]; })[0] || '';
			var topW = Object.keys(w).sort(function (a, b) { return w[b] - w[a]; })[0] || '';
			var name = topW && w[topW] >= members.length * 0.45 ? topW : topG;
			var topM = Object.keys(mo).sort(function (a, b) { return mo[b] - mo[a]; })[0] || '';
			out.push({ x: cx[c], y: cy[c], name: name, mood: topM, size: members.length, members: members });
		}
		// the same name twice: tell them apart by mood
		var seen = {};
		out.forEach(function (r) { seen[r.name] = (seen[r.name] || 0) + 1; });
		out.forEach(function (r) { if (seen[r.name] > 1 && r.mood) r.name = r.name + ', ' + r.mood; });
		return out;
	}

	return {
		RECIPES: RECIPES, describe: describe, vectors: vectors, labelVectors: labelVectors, nameVectors: nameVectors, timeVectors: timeVectors,
		knn: knn, knnJob: knnJob, layout: layout, pca2: pca2, regions: regions, dot: dot, unit: unit
	};
});
