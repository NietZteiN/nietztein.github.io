// Constellations: the graph engine. No DOM in here, so it also runs under Node
// (see the test recipe at the bottom). app.js owns the canvas and the panels.
//
//   buildGraph(books)          authors (with AUTHOR_ALIAS merges) + every pair
//                              of authors that share something, with reasons
//   selectEdges(graph, cfg)    weight the pairs by the enabled edge types and
//                              keep only the strongest N per node
//   Simulation                 velocity Verlet with link springs, Barnes-Hut
//                              charge repulsion, centring, positional targets
//                              and circle collision; alpha cooling like d3
//   communities(graph, edges)  weighted label propagation + auto names
//   hull(points) / padHull     convex hull for the cluster nebulae
//   layoutTargets(...)         force / radial by genre / grid by unit / timeline

var AuthorGraph = (function () {
	'use strict';

	// ---- Site vocabulary (copied from assets/js/bookshelf.js) ---------------

	var UNITS = [
		{ k: 'K', name: 'Pine library', shelves: ['A to D', 'D to I', 'H to L', 'M to O', 'O to S', 'S / The A-E', 'The F-O', 'The P-T', 'T-W', 'HC 1-16', 'HC 17-34', 'HC 35-51', 'JP-1 (Jump, Mill)', 'JP-2 (Ranpo, Witchcraft)', 'Top (VN boxes)'] },
		{ k: 'H', name: 'Black bookcase', shelves: ['H1', 'H2', 'H3', 'H4', 'H5', 'H6'] },
		{ k: 'N', name: 'Manga case', shelves: ['N-Top (VN boxes, CDs)', 'N1 (Uffizi)', 'N2 (Berlitz, Catan)', 'N3 (鈴木由美子)', 'N4 (バガボンド, くず)', 'N5 (手塚, 吉田秋生)'] },
		{ k: 'B', name: 'Cherry bookcase', shelves: ['B1', 'B2', 'B3'] },
		{ k: 'G', name: 'Library-label shelves', shelves: ['G1', 'G2'] },
		{ k: 'I', name: 'Cream bookcase', shelves: ['I1', 'I2'] },
		{ k: 'L', name: 'Nursing case', shelves: ['L0 (above sticky 16)', 'L1 (sticky 16)'] },
		{ k: 'M', name: 'Japanese literature shelf', shelves: ['JP floor shelf'] },
		{ k: 'A', name: 'Light-wood unit', shelves: ['A1', 'A2'] },
		{ k: 'D', name: 'Wire shelf', shelves: ['D1', 'D2'] },
		{ k: 'F', name: 'Headset shelf', shelves: ['F1'] },
		{ k: 'J', name: 'Cubby', shelves: ['Cubby'] },
		{ k: 'Loose', name: 'Desk and floor', shelves: ['Floor', 'Held (photo 73)', 'Held (photo 96)'] },
	];
	var UNIT_BY_KEY = {};
	UNITS.forEach(function (u, i) { u.order = i; UNIT_BY_KEY[u.k] = u; });

	var GENRE_HUE = {
		'Literature (English & European)': 214, 'Japanese literature': 354, 'Manga & comics': 322, 'Light novels': 282,
		'Writing, film & literary craft': 28, 'History & biography': 14, 'Philosophy & political theory': 248,
		'Religion & theology': 42, 'Society, culture & ideas': 186, 'Politics, law & current affairs': 168,
		'Psychology, self-help & business': 142, 'Art & visual culture': 76, 'Music & opera': 266,
		'Language study & reference': 104, 'Test prep & study guides': 56, 'Math, CS & engineering': 200,
		'Science': 178, 'Nursing & medical': 6, 'Magazines & catalogues': 90, 'Occult & folklore': 300,
		'Games & other objects': 0, 'Unidentified': 0,
	};
	var GENRE_SHORT = {
		'Literature (English & European)': 'literature', 'Japanese literature': 'Japanese literature', 'Manga & comics': 'manga',
		'Light novels': 'light novels', 'Writing, film & literary craft': 'writing craft', 'History & biography': 'history',
		'Philosophy & political theory': 'philosophy', 'Religion & theology': 'religion', 'Society, culture & ideas': 'society',
		'Politics, law & current affairs': 'politics', 'Psychology, self-help & business': 'self-help', 'Art & visual culture': 'art',
		'Music & opera': 'music', 'Language study & reference': 'language study', 'Test prep & study guides': 'test prep',
		'Math, CS & engineering': 'math & CS', 'Science': 'science', 'Nursing & medical': 'nursing', 'Magazines & catalogues': 'magazines',
		'Occult & folklore': 'occult', 'Games & other objects': 'objects', 'Unidentified': 'unidentified',
	};
	var GREY_GENRES = { 'Games & other objects': 1, 'Unidentified': 1 };
	var LANG_NAME = { EN: 'English', JA: 'Japanese', DE: 'German', IT: 'Italian', LA: 'Latin', VI: 'Vietnamese' };
	var AUTHOR_ALIAS = {
		'村上春樹': 'Haruki Murakami', '三島由紀夫': 'Yukio Mishima', 'Mishima Yukio': 'Yukio Mishima',
		'太宰治': 'Osamu Dazai', 'Dazai Osamu': 'Osamu Dazai', '夏目漱石': 'Natsume Sōseki', '芥川龍之介': 'Ryūnosuke Akutagawa',
		'ed. Charles W. Eliot': 'Charles W. Eliot (ed.)', '井浦秀夫 / 監修 小林茂和': '井浦秀夫', '渡航 ほか': '渡航',
	};

	// Edge types, in display order. `w` is the default weight.
	var EDGE_TYPES = [
		{ k: 'shelf', label: 'Share a shelf', w: 3 },
		{ k: 'unit', label: 'Share a bookcase', w: 0.6 },
		{ k: 'genre', label: 'Share a genre', w: 1 },
		{ k: 'pub', label: 'Share a publisher or series', w: 1.5 },
		{ k: 'lang', label: 'Share a language', w: 0.25 },
		{ k: 'decade', label: 'Same decade of first publication', w: 0.5 },
	];

	// ---- Small helpers --------------------------------------------------------

	function hashStr(s) {
		var h = 2166136261;
		for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
		return h >>> 0;
	}
	function mulberry32(seed) {
		var a = seed >>> 0;
		return function () {
			a = (a + 0x6D2B79F5) >>> 0;
			var t = a;
			t = Math.imul(t ^ (t >>> 15), t | 1);
			t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
			return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
		};
	}
	function isJapaneseText(s) { return /[぀-ヿ一-鿿]/.test(s); }
	function authorKey(a) { return a ? (AUTHOR_ALIAS[a] || a) : ''; }
	function decadeOf(y) { return y == null ? null : Math.floor(y / 10) * 10; }
	function decadeLabel(d) {
		if (d == null) return 'undated';
		if (d < 0) return (-d) + 's BC';
		return d + 's';
	}
	function langBucket(code) {
		if (code === 'JA') return 'Japanese';
		if (/^EN(\/|$)/.test(code || '') && code !== 'EN/JA') return 'English';
		return 'Bilingual & other';
	}
	var LANG_HUE = { English: 214, Japanese: 354, 'Bilingual & other': 42 };
	function langLabel(code) {
		return String(code || '').split('/').map(function (c) { return LANG_NAME[c] || c; }).join(' / ');
	}
	function compareNames(a, b) {
		// Latin before CJK, then locale order.
		var ja = isJapaneseText(a), jb = isJapaneseText(b);
		if (ja !== jb) return ja ? 1 : -1;
		return a < b ? -1 : a > b ? 1 : 0;
	}
	function topKey(counts) {
		var best = null, n = -1;
		for (var k in counts) if (counts[k] > n) { n = counts[k]; best = k; }
		return best;
	}

	// Timeline scale: most of the library is 1800-2025, so older centuries are
	// compressed. Returns 0..1.
	var YEAR_BREAKS = [[-2200, 0], [1500, 0.1], [1800, 0.26], [1900, 0.45], [2030, 1]];
	function yearT(y) {
		if (y == null) return null;
		if (y <= YEAR_BREAKS[0][0]) return 0;
		for (var i = 1; i < YEAR_BREAKS.length; i++) {
			var a = YEAR_BREAKS[i - 1], b = YEAR_BREAKS[i];
			if (y <= b[0]) return a[1] + (b[1] - a[1]) * (y - a[0]) / (b[0] - a[0]);
		}
		return 1;
	}
	var YEAR_TICKS = [-2000, 1500, 1700, 1800, 1850, 1900, 1950, 2000];

	// ---- Build --------------------------------------------------------------

	function buildGraph(books) {
		var byName = {};
		var orphan = 0;
		books.forEach(function (b) {
			var name = authorKey(b.a);
			if (!name) { orphan++; return; }
			var n = byName[name];
			if (!n) n = byName[name] = { name: name, books: [], genres: {}, units: {}, shelves: {}, pubs: {}, langs: {}, langBuckets: {}, year: null, jp: isJapaneseText(name) };
			n.books.push(b);
			var lb = langBucket(b.l);
			n.langBuckets[lb] = (n.langBuckets[lb] || 0) + 1;
			if (b.g) n.genres[b.g] = (n.genres[b.g] || 0) + 1;
			if (b.u) n.units[b.u] = (n.units[b.u] || 0) + 1;
			if (b.u && b.s) n.shelves[b.u + '|' + b.s] = (n.shelves[b.u + '|' + b.s] || 0) + 1;
			if (b.pub) n.pubs[b.pub] = 1;
			String(b.l || '').split('/').forEach(function (c) { if (c && c !== '?') n.langs[c] = 1; });
			if (b.y != null && (n.year == null || b.y < n.year)) n.year = b.y;
		});

		var nodes = Object.keys(byName).map(function (k) { return byName[k]; });
		nodes.sort(function (a, b) { return b.books.length - a.books.length || compareNames(a.name, b.name); });
		nodes.forEach(function (n, i) {
			n.index = i;
			n.count = n.books.length;
			n.genre = topKey(n.genres);
			n.unit = topKey(n.units);
			n.unitName = UNIT_BY_KEY[n.unit] ? UNIT_BY_KEY[n.unit].name : n.unit;
			var sk = topKey(n.shelves);
			n.shelf = sk ? sk.split('|')[1] : '';
			var u = UNIT_BY_KEY[n.unit];
			n.shelfIndex = u ? Math.max(0, u.shelves.indexOf(n.shelf)) : 0;
			n.unitOrder = u ? u.order : UNITS.length;
			n.decade = decadeOf(n.year);
			n.lang = topKey(n.langBuckets);
			n.hue = GENRE_HUE[n.genre] != null ? GENRE_HUE[n.genre] : 0;
			n.grey = !!GREY_GENRES[n.genre];
			n.r = 3.2 + 2.1 * Math.sqrt(n.count);
			n.books.sort(function (a, b) { return (a.y == null) - (b.y == null) || (a.y || 0) - (b.y || 0) || compareNames(a.t, b.t); });
			n.x = n.y = n.vx = n.vy = n.ax = n.ay = 0;
			n.fx = n.fy = null;
			n.deg = 0;
			n.adj = [];
		});

		// Group authors by each shared attribute, then enumerate pairs inside
		// each group. A pair's reasons are ids into `reasons`.
		var reasons = [];           // {type, value, label}
		var pairs = new Map();      // key a*N+b (a<b) -> [reasonId...]
		var N = nodes.length;
		function group(type, getKeys, labelFor) {
			var buckets = {};
			nodes.forEach(function (n) {
				getKeys(n).forEach(function (key) { (buckets[key] = buckets[key] || []).push(n.index); });
			});
			Object.keys(buckets).forEach(function (key) {
				var members = buckets[key];
				if (members.length < 2 || members.length > 420) return;
				var rid = reasons.length;
				reasons.push({ type: type, value: key, label: labelFor(key), size: members.length });
				for (var i = 0; i < members.length; i++) {
					for (var j = i + 1; j < members.length; j++) {
						var a = members[i], b = members[j];
						if (a > b) { var t = a; a = b; b = t; }
						var pk = a * N + b;
						var list = pairs.get(pk);
						if (!list) pairs.set(pk, list = []);
						list.push(rid);
					}
				}
			});
		}
		group('shelf', function (n) { return Object.keys(n.shelves); }, function (k) {
			var p = k.split('|'); return 'shares shelf ' + p[1];
		});
		group('unit', function (n) { return Object.keys(n.units); }, function (k) { return 'both in the ' + (UNIT_BY_KEY[k] ? UNIT_BY_KEY[k].name : k); });
		group('genre', function (n) { return Object.keys(n.genres); }, function (k) { return 'both ' + GENRE_SHORT[k]; });
		group('pub', function (n) { return Object.keys(n.pubs); }, function (k) { return 'both from ' + k; });
		group('lang', function (n) { return Object.keys(n.langs); }, function (k) { return 'both in ' + langLabel(k); });
		group('decade', function (n) { return n.decade == null ? [] : [String(n.decade)]; }, function (k) { return 'both first published in the ' + decadeLabel(+k); });

		// Candidate lists per node, so edge selection is a per-node sort.
		var cand = nodes.map(function () { return []; });
		pairs.forEach(function (list, pk) {
			var a = Math.floor(pk / N), b = pk - a * N;
			cand[a].push(pk); cand[b].push(pk);
		});

		return { nodes: nodes, reasons: reasons, pairs: pairs, cand: cand, N: N, orphanBooks: orphan, books: books };
	}

	// cfg = { enabled: {shelf:true,...}, weight: {shelf:3,...}, perNode: 4 }
	function selectEdges(graph, cfg) {
		var N = graph.N, nodes = graph.nodes, reasons = graph.reasons;
		var wOf = {};
		EDGE_TYPES.forEach(function (t) { wOf[t.k] = cfg.enabled[t.k] === false ? 0 : (cfg.weight[t.k] != null ? cfg.weight[t.k] : t.w); });
		// Weight of each pair: sum of reason weights, each type capped at two reasons.
		var weight = new Map();
		graph.pairs.forEach(function (list, pk) {
			var w = 0, seen = {};
			for (var i = 0; i < list.length; i++) {
				var rs = reasons[list[i]], t = rs.type;
				seen[t] = (seen[t] || 0) + 1;
				if (seen[t] <= 2) w += wOf[t];
			}
			if (w > 0) weight.set(pk, w);
		});
		// Each node ranks its candidates. An edge survives when both ends rank
		// it in their top N (mutual); nodes left with fewer than two edges then
		// add their strongest candidates, so nobody is stranded but hubs do not
		// collect every stray.
		var keep = new Set();
		var perNode = Math.max(1, cfg.perNode || 4);
		var rank = new Map();
		var ranked = graph.cand.map(function (list) {
			var scored = [];
			for (var k = 0; k < list.length; k++) { var w = weight.get(list[k]); if (w) scored.push([w, list[k]]); }
			scored.sort(function (a, b) { return b[0] - a[0] || a[1] - b[1]; });
			return scored;
		});
		ranked.forEach(function (scored) {
			for (var j = 0; j < scored.length && j < perNode; j++) {
				var pk = scored[j][1];
				if (rank.has(pk)) keep.add(pk); else rank.set(pk, 1);
			}
		});
		var degree = new Int32Array(N);
		keep.forEach(function (pk) { var a = Math.floor(pk / N); degree[a]++; degree[pk - a * N]++; });
		var floor = Math.min(2, perNode), cap = perNode * 3;
		function fill(i, scored, useCap) {
			for (var j = 0; j < scored.length && degree[i] < floor; j++) {
				var pk = scored[j][1];
				if (keep.has(pk)) continue;
				var a = Math.floor(pk / N), b = pk - a * N;
				if (useCap && degree[a === i ? b : a] >= cap) continue;
				keep.add(pk); degree[a]++; degree[b]++;
			}
		}
		ranked.forEach(function (scored, i) { fill(i, scored, true); });
		ranked.forEach(function (scored, i) { fill(i, scored, false); });
		nodes.forEach(function (n) { n.deg = 0; n.adj = []; });
		var edges = [];
		keep.forEach(function (pk) {
			var a = Math.floor(pk / N), b = pk - a * N;
			var e = { a: a, b: b, source: nodes[a], target: nodes[b], w: weight.get(pk), reasons: graph.pairs.get(pk).filter(function (rid) { return wOf[reasons[rid].type] > 0; }) };
			edges.push(e);
			nodes[a].deg++; nodes[b].deg++;
			nodes[a].adj.push(e); nodes[b].adj.push(e);
		});
		edges.sort(function (x, y) { return x.w - y.w; });
		var maxW = 0;
		edges.forEach(function (e) { if (e.w > maxW) maxW = e.w; });
		edges.forEach(function (e) { e.t = maxW ? e.w / maxW : 1; });
		return edges;
	}

	function reasonText(graph, e) {
		return e.reasons.map(function (rid) { return graph.reasons[rid].label; }).join(' · ');
	}

	// ---- Simulation --------------------------------------------------------

	// Barnes-Hut quadtree over nodes with charge q.
	function Quad(x0, y0, x1, y1) { this.x0 = x0; this.y0 = y0; this.x1 = x1; this.y1 = y1; this.kids = null; this.node = null; this.mass = 0; this.cx = 0; this.cy = 0; }
	Quad.prototype.insert = function (n, depth) {
		if (this.node === null && this.kids === null) { this.node = n; return; }
		if (this.kids === null) {
			if (depth > 24) { this.mass += n.q; return; } // coincident points: fold into mass
			var old = this.node; this.node = null;
			this.split();
			this.child(old).insert(old, depth + 1);
		}
		this.child(n).insert(n, depth + 1);
	};
	Quad.prototype.split = function () {
		var mx = (this.x0 + this.x1) / 2, my = (this.y0 + this.y1) / 2;
		this.kids = [new Quad(this.x0, this.y0, mx, my), new Quad(mx, this.y0, this.x1, my), new Quad(this.x0, my, mx, this.y1), new Quad(mx, my, this.x1, this.y1)];
	};
	Quad.prototype.child = function (n) {
		var mx = (this.x0 + this.x1) / 2, my = (this.y0 + this.y1) / 2;
		return this.kids[(n.x >= mx ? 1 : 0) + (n.y >= my ? 2 : 0)];
	};
	Quad.prototype.summarize = function () {
		if (this.kids === null) {
			if (this.node) { this.mass += this.node.q; this.cx = this.node.x; this.cy = this.node.y; }
			return;
		}
		var m = 0, cx = 0, cy = 0;
		for (var i = 0; i < 4; i++) {
			var k = this.kids[i]; k.summarize();
			if (k.mass > 0) { m += k.mass; cx += k.cx * k.mass; cy += k.cy * k.mass; }
		}
		this.mass = m; if (m > 0) { this.cx = cx / m; this.cy = cy / m; }
	};

	function Simulation(nodes, edges, opts) {
		this.nodes = nodes;
		this.edges = edges || [];
		this.alpha = 1; this.alphaMin = 0.001; this.alphaDecay = 0.0228; this.alphaTarget = 0;
		this.damping = 0.6;
		this.theta2 = 0.64;
		this.charge = -380;        // repulsion constant
		this.linkStrength = 1;     // multiplier on springs
		this.linkLength = 30;      // base rest length added to radii
		this.centre = 0.005;       // pull to origin
		this.centreX = 1; this.centreY = 1;
		this.posStrength = 0;      // positional targets (tx, ty)
		this.posX = 1; this.posY = 1;
		this.collide = 1;
		this.chargeScale = 1;
		this.clusters = [];        // communities; members are drawn toward their centroid
		this.clusterStrength = 0.3;
		this.ticks = 0;
		if (opts) for (var k in opts) this[k] = opts[k];
		var self = this;
		nodes.forEach(function (n) { n.q = 1 + n.r / 6; });
		this.edges.forEach(function (e) { self.prepEdge(e); });
	}
	Simulation.prototype.setEdges = function (edges) {
		var self = this; this.edges = edges; edges.forEach(function (e) { self.prepEdge(e); });
	};
	Simulation.prototype.prepEdge = function (e) {
		// stronger links are shorter, and hubs are not dragged about by every link
		e.len = this.linkLength + e.source.r + e.target.r + 120 * (1 - e.t);
		e.k = (0.15 + 0.85 * e.t) / Math.min(e.source.deg, e.target.deg) ** 0.5;
	};
	Simulation.prototype.reheat = function (a) { this.alpha = Math.max(this.alpha, a == null ? 0.5 : a); };
	Simulation.prototype.settled = function () { return this.alpha < this.alphaMin; };
	Simulation.prototype.energy = function () {
		var e = 0;
		for (var i = 0; i < this.nodes.length; i++) { var n = this.nodes[i]; e += 0.5 * (n.vx * n.vx + n.vy * n.vy); }
		return e;
	};

	Simulation.prototype.forces = function () {
		var nodes = this.nodes, a = this.alpha, i, n;
		for (i = 0; i < nodes.length; i++) { nodes[i].ax = 0; nodes[i].ay = 0; }

		// charge (Barnes-Hut)
		if (this.charge && this.chargeScale) {
			var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
			for (i = 0; i < nodes.length; i++) { n = nodes[i]; if (n.x < x0) x0 = n.x; if (n.x > x1) x1 = n.x; if (n.y < y0) y0 = n.y; if (n.y > y1) y1 = n.y; }
			var side = Math.max(x1 - x0, y1 - y0, 1) + 2;
			var root = new Quad(x0 - 1, y0 - 1, x0 - 1 + side, y0 - 1 + side);
			for (i = 0; i < nodes.length; i++) root.insert(nodes[i], 0);
			root.summarize();
			var K = this.charge * this.chargeScale * a, theta2 = this.theta2;
			var stack = [];
			for (i = 0; i < nodes.length; i++) {
				n = nodes[i];
				var fx = 0, fy = 0;
				stack.length = 0; stack.push(root);
				while (stack.length) {
					var q = stack.pop();
					if (q.mass === 0) continue;
					var dx = q.cx - n.x, dy = q.cy - n.y;
					var w = q.x1 - q.x0;
					var d2 = dx * dx + dy * dy;
					if (q.kids === null || w * w < theta2 * d2) {
						if (q.kids === null && q.node === n) continue;
						if (q.kids === null && q.node && q.node !== n) { /* leaf with another node */ }
						if (d2 < 1e-4) { dx = (i & 1 ? 0.5 : -0.5); dy = (i & 2 ? 0.5 : -0.5); d2 = 0.5; }
						var d = Math.sqrt(d2);
						var minD = 2 * n.r + 4;
						if (d2 < minD * minD) d2 = minD * minD;
						var f = K * q.mass / d2;   // negative => repulsion
						fx += f * dx / d; fy += f * dy / d;
					} else {
						for (var c = 0; c < 4; c++) stack.push(q.kids[c]);
					}
				}
				n.ax += fx * n.q; n.ay += fy * n.q;
			}
		}

		// links
		var ls = this.linkStrength * a;
		if (ls) {
			for (i = 0; i < this.edges.length; i++) {
				var e = this.edges[i], s = e.source, t = e.target;
				var ex = t.x - s.x, ey = t.y - s.y;
				var L = Math.sqrt(ex * ex + ey * ey) || 1e-3;
				var f2 = (L - e.len) * e.k * ls / L;
				var ux = ex * f2, uy = ey * f2;
				var bias = t.deg / (s.deg + t.deg);  // the lighter end moves more
				s.ax += ux * bias; s.ay += uy * bias;
				t.ax -= ux * (1 - bias); t.ay -= uy * (1 - bias);
			}
		}

		// cluster gravity: each community gathers around its own centroid
		var cs = this.clusterStrength * a;
		if (cs && this.clusters.length) {
			for (i = 0; i < this.clusters.length; i++) {
				var cl = this.clusters[i], mem = cl.members, cx = 0, cy = 0;
				for (var m = 0; m < mem.length; m++) { cx += mem[m].x; cy += mem[m].y; }
				cx /= mem.length; cy /= mem.length;
				for (m = 0; m < mem.length; m++) { n = mem[m]; n.ax += (cx - n.x) * cs; n.ay += (cy - n.y) * cs; }
			}
		}

		// centring and positional targets
		var c = this.centre * a, ps = this.posStrength * a;
		for (i = 0; i < nodes.length; i++) {
			n = nodes[i];
			n.ax -= n.x * c * this.centreX; n.ay -= n.y * c * this.centreY;
			if (ps && n.tx != null) { n.ax += (n.tx - n.x) * ps * this.posX; n.ay += (n.ty - n.y) * ps * this.posY; }
		}
	};

	// Position-based circle collision via a uniform grid.
	Simulation.prototype.collideNodes = function () {
		var nodes = this.nodes, cell = 44, grid = new Map(), i, n;
		for (i = 0; i < nodes.length; i++) {
			n = nodes[i];
			var gx = Math.floor(n.x / cell), gy = Math.floor(n.y / cell), key = gx * 100003 + gy;
			var b = grid.get(key); if (!b) grid.set(key, b = []); b.push(n);
		}
		for (i = 0; i < nodes.length; i++) {
			n = nodes[i];
			var cx = Math.floor(n.x / cell), cy = Math.floor(n.y / cell);
			for (var ox = -1; ox <= 1; ox++) for (var oy = -1; oy <= 1; oy++) {
				var bucket = grid.get((cx + ox) * 100003 + (cy + oy));
				if (!bucket) continue;
				for (var j = 0; j < bucket.length; j++) {
					var m = bucket[j];
					if (m.index <= n.index) continue;
					var dx = m.x - n.x, dy = m.y - n.y, rr = n.r + m.r + 3;
					var d2 = dx * dx + dy * dy;
					if (d2 >= rr * rr) continue;
					var d = Math.sqrt(d2) || 1e-3;
					if (d2 < 1e-6) { dx = 0.01 * (n.index & 1 ? 1 : -1); dy = 0.01; d = 0.0141; }
					var push = (rr - d) / d * 0.5 * this.collide;
					var nf = n.fx != null, mf = m.fx != null;
					if (!nf && !mf) { n.x -= dx * push; n.y -= dy * push; m.x += dx * push; m.y += dy * push; }
					else if (!nf) { n.x -= dx * push * 2; n.y -= dy * push * 2; }
					else if (!mf) { m.x += dx * push * 2; m.y += dy * push * 2; }
				}
			}
		}
	};

	Simulation.prototype.tick = function (count) {
		count = count || 1;
		var nodes = this.nodes, i, n;
		for (var k = 0; k < count; k++) {
			var dt = 1;
			if (this.ticks === 0) this.forces();
			// velocity Verlet: positions from current acceleration
			for (i = 0; i < nodes.length; i++) {
				n = nodes[i];
				if (n.fx != null) { n.x = n.fx; n.y = n.fy; n.vx = n.vy = 0; continue; }
				n.x += n.vx * dt + 0.5 * n.ax * dt * dt;
				n.y += n.vy * dt + 0.5 * n.ay * dt * dt;
				n.oax = n.ax; n.oay = n.ay;
			}
			this.forces();
			for (i = 0; i < nodes.length; i++) {
				n = nodes[i];
				if (n.fx != null) continue;
				n.vx = (n.vx + 0.5 * (n.oax + n.ax) * dt) * this.damping;
				n.vy = (n.vy + 0.5 * (n.oay + n.ay) * dt) * this.damping;
				var sp = n.vx * n.vx + n.vy * n.vy;
				if (sp > 400) { var s = 20 / Math.sqrt(sp); n.vx *= s; n.vy *= s; }
			}
			if (this.collide) this.collideNodes();
			this.alpha += (this.alphaTarget - this.alpha) * this.alphaDecay;
			this.ticks++;
		}
		return this;
	};

	// Brute force reference for the Barnes-Hut check (same clamps).
	Simulation.prototype.bruteCharge = function () {
		var nodes = this.nodes, K = this.charge * this.chargeScale * this.alpha, out = [];
		for (var i = 0; i < nodes.length; i++) {
			var n = nodes[i], fx = 0, fy = 0;
			for (var j = 0; j < nodes.length; j++) {
				if (i === j) continue;
				var m = nodes[j], dx = m.x - n.x, dy = m.y - n.y, d2 = dx * dx + dy * dy;
				var minD = 2 * n.r + 4; if (d2 < minD * minD) d2 = minD * minD;
				var d = Math.sqrt(dx * dx + dy * dy) || 1e-3;
				var f = K * m.q / d2;
				fx += f * dx / d; fy += f * dy / d;
			}
			out.push([fx * n.q, fy * n.q]);
		}
		return out;
	};

	// ---- Communities ----------------------------------------------------------

	function communities(graph, edges, seed) {
		var nodes = graph.nodes, N = nodes.length;
		var label = new Int32Array(N);
		for (var i = 0; i < N; i++) label[i] = i;
		var rnd = mulberry32(seed || 7);
		var order = nodes.map(function (n) { return n.index; });
		var changed = true, rounds = 0;
		while (changed && rounds < 40) {
			changed = false; rounds++;
			// shuffle visiting order (seeded)
			for (var s = order.length - 1; s > 0; s--) { var j = Math.floor(rnd() * (s + 1)); var t = order[s]; order[s] = order[j]; order[j] = t; }
			for (var o = 0; o < order.length; o++) {
				var n = nodes[order[o]];
				if (!n.adj.length) continue;
				var score = {};
				for (var a = 0; a < n.adj.length; a++) {
					var e = n.adj[a], other = e.source === n ? e.target : e.source;
					score[label[other.index]] = (score[label[other.index]] || 0) + e.w;
				}
				var best = label[n.index], bestS = score[best] || 0;
				for (var L in score) if (score[L] > bestS + 1e-9 || (score[L] === bestS && +L < best)) { best = +L; bestS = score[L]; }
				if (best !== label[n.index]) { label[n.index] = best; changed = true; }
			}
		}
		var groups = {};
		for (i = 0; i < N; i++) (groups[label[i]] = groups[label[i]] || []).push(nodes[i]);
		var list = Object.keys(groups).map(function (k) { return groups[k]; }).filter(function (g) { return g.length >= 3; });
		list.sort(function (a, b) { return b.length - a.length; });
		var used = {};
		var out = list.map(function (members, idx) {
			var gc = {}, uc = {}, books = 0;
			members.forEach(function (n) {
				n.books.forEach(function (b) { if (b.g) gc[b.g] = (gc[b.g] || 0) + 1; if (b.u) uc[b.u] = (uc[b.u] || 0) + 1; books++; });
			});
			var genre = topKey(gc), unit = topKey(uc);
			var uname = UNIT_BY_KEY[unit] ? UNIT_BY_KEY[unit].name : unit;
			var name = uname + ' · ' + GENRE_SHORT[genre];
			if (used[name]) {
				// disambiguate with the commonest shelf inside that bookcase
				var sc = {};
				members.forEach(function (n) { n.books.forEach(function (b) { if (b.u === unit && b.s) sc[b.s] = (sc[b.s] || 0) + 1; }); });
				name = uname + ' · ' + GENRE_SHORT[genre] + ' · ' + (topKey(sc) || members.length + ' authors');
			}
			used[name] = 1;
			var c = { id: idx, members: members, genre: genre, unit: unit, name: name, hue: GENRE_HUE[genre] || 0, grey: !!GREY_GENRES[genre], books: books };
			members.forEach(function (n) { n.community = c; });
			return c;
		});
		nodes.forEach(function (n) { if (n.community && n.community.members.indexOf(n) < 0) n.community = null; });
		nodes.forEach(function (n) { if (!out.some(function (c) { return c.members.indexOf(n) >= 0; })) n.community = null; });
		return out;
	}

	// ---- Geometry -------------------------------------------------------------

	function cross(o, a, b) { return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]); }
	function hull(points) {
		var pts = points.slice().sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
		if (pts.length < 3) return pts;
		var lower = [], upper = [], i;
		for (i = 0; i < pts.length; i++) {
			while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], pts[i]) <= 0) lower.pop();
			lower.push(pts[i]);
		}
		for (i = pts.length - 1; i >= 0; i--) {
			while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], pts[i]) <= 0) upper.pop();
			upper.push(pts[i]);
		}
		lower.pop(); upper.pop();
		return lower.concat(upper);
	}
	function centroid(pts) {
		var x = 0, y = 0; pts.forEach(function (p) { x += p[0]; y += p[1]; });
		return [x / pts.length, y / pts.length];
	}

	// ---- Layout presets ----------------------------------------------------

	// Returns per-mode simulation settings and sets n.tx/n.ty targets.
	function layoutTargets(graph, mode, extent) {
		var nodes = graph.nodes, W = extent.w, H = extent.h, i, n;
		nodes.forEach(function (m) { m.tx = m.ty = null; });
		var info = { mode: mode, labels: [] };
		if (mode === 'radial') {
			var gc = {}; nodes.forEach(function (m) { gc[m.genre] = (gc[m.genre] || 0) + 1; });
			var genres = Object.keys(gc).sort(function (a, b) { return (GENRE_HUE[a] || 0) - (GENRE_HUE[b] || 0); });
			var total = nodes.length, ang = -Math.PI / 2, R = Math.min(W, H) * 0.42;
			var slot = {};
			genres.forEach(function (g) {
				var span = 2 * Math.PI * gc[g] / total;
				slot[g] = { a0: ang, span: span, i: 0 };
				info.labels.push({ text: GENRE_SHORT[g], angle: ang + span / 2, r: R + 58, hue: GENRE_HUE[g] || 0, grey: !!GREY_GENRES[g], n: gc[g] });
				ang += span;
			});
			var sorted = nodes.slice().sort(function (a, b) { return (GENRE_HUE[a.genre] || 0) - (GENRE_HUE[b.genre] || 0) || b.count - a.count; });
			sorted.forEach(function (m) {
				var s = slot[m.genre];
				var t = (s.i + 0.5) / gc[m.genre];
				s.i++;
				var a = s.a0 + s.span * t;
				var rr = R - Math.min(R * 0.55, 12 * Math.sqrt(m.count - 1)) - (s.i % 2) * 14;
				m.tx = Math.cos(a) * rr; m.ty = Math.sin(a) * rr;
			});
			info.R = R;
			return Object.assign(info, { charge: 0.25, link: 0.12, centre: 0, pos: 0.32, collide: 1 });
		}
		if (mode === 'grid') {
			var byUnit = {};
			nodes.forEach(function (m) { (byUnit[m.unit] = byUnit[m.unit] || []).push(m); });
			var units = UNITS.filter(function (u) { return byUnit[u.k]; });
			var cell = 24, gap = 34, maxW = Math.max(W - 40, 420);
			var x = 0, y = 0, rowH = 0, blocks = [];
			units.forEach(function (u) {
				var list = byUnit[u.k].sort(function (a, b) { return a.shelfIndex - b.shelfIndex || b.count - a.count || compareNames(a.name, b.name); });
				var cols = Math.max(3, Math.ceil(Math.sqrt(list.length * 1.7)));
				var rows = Math.ceil(list.length / cols);
				// blocks are at least as wide as their small-caps label
				var labelW = (u.name.length + 5) * 14;
				var bw = Math.max(cols * cell, labelW), bh = rows * cell + 22;
				var inset = (bw - cols * cell) / 2;
				if (x + bw > maxW && x > 0) { x = 0; y += rowH + gap; rowH = 0; }
				list.forEach(function (m, k) {
					m.tx = x + inset + (k % cols) * cell + cell / 2; m.ty = y + 22 + Math.floor(k / cols) * cell + cell / 2;
				});
				blocks.push({ x: x, y: y, w: bw, h: bh, name: u.name, k: u.k, n: list.length });
				x += bw + gap; if (bh > rowH) rowH = bh;
			});
			var totalW = 0, totalH = y + rowH;
			blocks.forEach(function (b) { if (b.x + b.w > totalW) totalW = b.x + b.w; });
			var ox = totalW / 2, oy = totalH / 2;
			nodes.forEach(function (m) { m.tx -= ox; m.ty -= oy; });
			blocks.forEach(function (b) { b.x -= ox; b.y -= oy; info.labels.push({ text: b.name, x: b.x, y: b.y + 6, n: b.n, box: b }); });
			return Object.assign(info, { charge: 0.08, link: 0.05, centre: 0, pos: 0.5, collide: 0.6 });
		}
		if (mode === 'timeline') {
			var span = Math.max(W - 120, 700);
			var left = -span / 2;
			var undatedX = left + span + 70;
			nodes.forEach(function (m) {
				var t = yearT(m.year);
				m.tx = t == null ? undatedX : left + t * span;
				m.ty = null;
			});
			YEAR_TICKS.forEach(function (yv) { info.labels.push({ text: yv < 0 ? (-yv) + ' BC' : String(yv), x: left + yearT(yv) * span }); });
			info.labels.push({ text: 'undated', x: undatedX });
			info.axisY = 0; info.left = left; info.right = left + span;
			return Object.assign(info, { charge: 0.5, link: 0.5, centre: 0.5, centreX: 0, pos: 0.7, posY: 0, collide: 1, cluster: 0 });
		}
		return Object.assign(info, { charge: 1, link: 1, centre: 1, pos: 0, collide: 1, cluster: 0.3 });
	}

	function seedPositions(nodes, seed, radius) {
		var rnd = mulberry32(seed);
		nodes.forEach(function (n, i) {
			// golden-angle spiral with jitter: deterministic and spread out
			var a = i * 2.399963 + rnd() * 0.4, r = radius * Math.sqrt((i + 0.5) / nodes.length) * (0.9 + rnd() * 0.2);
			n.x = Math.cos(a) * r; n.y = Math.sin(a) * r; n.vx = n.vy = 0; n.ax = n.ay = 0;
		});
	}

	return {
		UNITS: UNITS, UNIT_BY_KEY: UNIT_BY_KEY, GENRE_HUE: GENRE_HUE, LANG_HUE: LANG_HUE, langBucket: langBucket, GENRE_SHORT: GENRE_SHORT, GREY_GENRES: GREY_GENRES, LANG_NAME: LANG_NAME,
		AUTHOR_ALIAS: AUTHOR_ALIAS, EDGE_TYPES: EDGE_TYPES, YEAR_TICKS: YEAR_TICKS,
		hashStr: hashStr, mulberry32: mulberry32, isJapaneseText: isJapaneseText, authorKey: authorKey, compareNames: compareNames,
		decadeLabel: decadeLabel, langLabel: langLabel, yearT: yearT,
		buildGraph: buildGraph, selectEdges: selectEdges, reasonText: reasonText,
		Simulation: Simulation, communities: communities, hull: hull, centroid: centroid,
		layoutTargets: layoutTargets, seedPositions: seedPositions,
	};
})();

if (typeof module !== 'undefined' && module.exports) module.exports = AuthorGraph;
