/*
 * Theatre Studio: the branch map's graph and layout, as plain data (no DOM).
 *
 *   StudioMap.graph(program, walk)   -> {nodes, edges, chapters, stats}
 *   StudioMap.layout(graph, opts)    -> the same graph with x, y, w, h on every node, points on every edge,
 *                                       bands (one per chapter) and the total width and height
 *   StudioMap.build(program, walk, opts) = layout(graph(program, walk), opts)
 *   StudioMap.nodeAtLine(graph, line) -> the node whose stretch of script holds that source line, or null
 *
 * program is VN.parse() output (see ../55-paper-theatre/OPS.md); walk is VN.walk() output or null (there is no walk
 * while the script has a fatal issue). Nothing here reads the clock or a random source: the same program gives the
 * same result, byte for byte.
 *
 * Nodes are the places a story can branch or be jumped to: the start, every label, every menu, every chapter card,
 * every @end and @withheld, and one "missing" node per jump target that does not exist. The ops between two such
 * places are folded into the node before them (its `stops` counts the lines the reader sees there). Edges:
 *   flow    the script falls through into the next node
 *   goto    -> label
 *   if      @if ... -> label (the script also goes on)
 *   option  one menu option (several options to the same place share one edge; `labels` lists them)
 * The layout is layered top to bottom: chapters are horizontal bands in file order, and inside a band every node is
 * below the nodes that lead to it. An edge that goes back up (a hub's spoke returning to its menu, a jump to an
 * earlier chapter) is a `back` edge and is routed round the right-hand side.
 */
(function (root, factory) {
	if (typeof module === 'object' && module.exports) module.exports = factory();
	else root.StudioMap = factory();
}(typeof self !== 'undefined' ? self : this, function () {
	'use strict';

	var BLOCKING = { say: 1, narrate: 1, scene: 1, chapter: 1, pause: 1, card: 1, chart: 1, code: 1, read: 1, menu: 1, withheld: 1, end: 1 };

	var SIZE = {
		start: [76, 26], label: [148, 36], menu: [148, 36], chapter: [124, 36],
		end: [76, 26], withheld: [96, 26], missing: [128, 30]
	};

	function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
	function cut(s, n) { s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; }

	/* ------------------------------------------------------------------ graph */

	function graph(program, walk) {
		var ops = (program && program.ops) || [], n = ops.length;
		var labels = (program && program.labels) || {};
		var chapters = ((program && program.chapters) || []).map(function (c, i) {
			return { i: i, n: String(c.n == null ? '' : c.n), title: c.title || '', index: c.index, line: c.line };
		});
		var nodes = [], byId = {}, anchorAt = {};

		function chapterOf(index) {
			var c = -1;
			for (var k = 0; k < chapters.length; k++) if (chapters[k].index <= index) c = k;
			return c;
		}
		function addNode(id, kind, index, line, name) {
			var nd = {
				id: id, kind: kind, index: index, line: line, name: name, chapter: chapterOf(index),
				stops: 0, first: index, last: index, lines: [line, line],
				unreachable: false, loop: false, ending: kind === 'end' || kind === 'withheld',
				options: 0
			};
			nodes.push(nd); byId[id] = nd;
			return nd;
		}

		addNode('start', 'start', -1, n ? ops[0].line : 0, 'start');
		for (var i = 0; i < n; i++) {
			var op = ops[i], nd = null;
			if (op.kind === 'label') nd = addNode('L:' + op.name, 'label', i, op.line, op.name);
			else if (op.kind === 'menu') { nd = addNode('M:' + i, 'menu', i, op.line, 'menu'); nd.options = op.options.length; nd.stops = 1; }
			else if (op.kind === 'chapter') { nd = addNode('C:' + i, 'chapter', i, op.line, (op.n ? op.n + ' ' : '') + (op.title || '')); nd.n = String(op.n == null ? '' : op.n); nd.stops = 1; }
			else if (op.kind === 'end') { nd = addNode('E:' + i, 'end', i, op.line, op.implicit ? 'end (EOF)' : 'end'); nd.implicit = !!op.implicit; }
			else if (op.kind === 'withheld') { nd = addNode('W:' + i, 'withheld', i, op.line, 'withheld'); nd.stops = 1; }
			if (nd) anchorAt[i] = nd.id;
		}
		// a chapter card that opens the script still belongs to its own band; the start sits above everything
		byId.start.chapter = -1;

		var edges = [], edgeKey = {};
		function targetNode(target, from) {
			var idx = -1;
			if (target === 'end') idx = n - 1;
			else if (own(labels, target)) idx = labels[target];
			if (idx >= 0 && own(anchorAt, idx)) return anchorAt[idx];
			if (idx >= 0) {
				// a jump to an op that is not an anchor cannot happen with VN.parse output; fall forward to the next anchor
				for (var j = idx; j < n; j++) if (own(anchorAt, j)) return anchorAt[j];
			}
			var mid = 'X:' + target;
			if (!byId[mid]) {
				var src = byId[from];
				var m = addNode(mid, 'missing', src.index + 0.5, src.line, target);
				m.chapter = src.chapter;
				m.ending = false;
			}
			return mid;
		}
		function addEdge(from, to, kind, line, label, extra) {
			var k = from + '>' + to + '>' + kind;
			var e = edgeKey[k];
			if (!e) {
				e = { id: 'e' + edges.length, from: from, to: to, kind: kind, line: line, labels: [], once: false, cond: false, broken: byId[to].kind === 'missing' };
				edges.push(e); edgeKey[k] = e;
			}
			if (label != null) e.labels.push(label);
			if (extra && extra.once) e.once = true;
			if (extra && extra.cond) e.cond = true;
			return e;
		}

		// fold each stretch of ops into the node that opens it
		function runFrom(nodeId, p) {
			var nd = byId[nodeId];
			for (; p < n; p++) {
				if (own(anchorAt, p)) { addEdge(nodeId, anchorAt[p], 'flow', ops[p].line, null); return; }
				var o = ops[p];
				nd.last = p;
				if (o.line) { if (!nd.lines[0]) nd.lines[0] = o.line; nd.lines[1] = Math.max(nd.lines[1], o.line); }
				if (BLOCKING[o.kind]) nd.stops++;
				if (o.kind === 'goto') { addEdge(nodeId, targetNode(o.target, nodeId), 'goto', o.line, null); return; }
				if (o.kind === 'if') {
					var c = o.cond || {};
					var txt = c.op === 'truthy' ? c.name : c.op === 'falsy' ? '!' + c.name : c.name + ' ' + c.op + ' ' + c.value;
					addEdge(nodeId, targetNode(o.target, nodeId), 'if', o.line, txt, { cond: true });
				}
			}
		}
		runFrom('start', 0);
		nodes.slice().forEach(function (nd) {
			if (nd.kind === 'label' || nd.kind === 'chapter' || nd.kind === 'withheld') runFrom(nd.id, nd.index + 1);
			else if (nd.kind === 'menu') {
				var mop = ops[nd.index];
				mop.options.forEach(function (opt) {
					if (!opt.target) return;
					addEdge(nd.id, targetNode(opt.target, nd.id), 'option', opt.line, cut(opt.text, 60), { once: opt.once, cond: !!opt.cond });
				});
			}
		});
		// nodes created as missing targets after the anchors keep a stable place: order nodes by (index, id)
		var order = nodes.slice().sort(function (a, b) { return (a.index - b.index) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0); });

		// reachability, from the script itself and from the walk
		var out = {}; order.forEach(function (nd) { out[nd.id] = []; });
		edges.forEach(function (e) { out[e.from].push(e.to); });
		var seen = {}, stack = ['start'];
		while (stack.length) {
			var id = stack.pop();
			if (seen[id]) continue;
			seen[id] = 1;
			out[id].forEach(function (t) { stack.push(t); });
		}
		var walkUnreach = {};
		((walk && walk.unreachable) || []).forEach(function (l) { walkUnreach[l] = 1; });
		order.forEach(function (nd) {
			if (!seen[nd.id]) nd.unreachable = true;
			if (nd.kind === 'label' && walkUnreach[nd.name]) nd.unreachable = true;
		});
		var loopLines = [];
		((walk && walk.loops) || []).forEach(function (l) {
			if (loopLines.indexOf(l.line) >= 0) return;
			loopLines.push(l.line);
			var hit = nodeAtLine({ nodes: order }, l.line);
			if (hit) hit.loop = true;
		});

		var count = function (k) { return order.filter(function (x) { return x.kind === k; }).length; };
		var stats = {
			nodes: order.length, edges: edges.length,
			labels: count('label'), menus: count('menu'), chapters: chapters.length,
			endings: walk && walk.endings ? { end: walk.endings.end | 0, withheld: walk.endings.withheld | 0 } : null,
			endNodes: count('end'), withheldNodes: count('withheld'),
			// the end and withheld cards that some path reaches (`-> end` and the end of the file are the same card)
			reachableEndings: {
				end: order.filter(function (x) { return x.kind === 'end' && !x.unreachable; }).length,
				withheld: order.filter(function (x) { return x.kind === 'withheld' && !x.unreachable; }).length
			},
			paths: walk ? walk.paths : null,
			ok: walk ? !!walk.ok : null,
			unreachable: order.filter(function (x) { return x.unreachable && x.kind === 'label'; }).map(function (x) { return x.name; }),
			unreachableNodes: order.filter(function (x) { return x.unreachable; }).length,
			loops: loopLines,
			missing: order.filter(function (x) { return x.kind === 'missing'; }).map(function (x) { return x.name; }),
			walked: !!walk
		};
		return { nodes: order, edges: edges, chapters: chapters, stats: stats };
	}

	// the node whose stretch holds a source line: the last node (in file order) that starts at or before it
	function nodeAtLine(g, line) {
		var best = null;
		(g.nodes || []).forEach(function (nd) {
			if (nd.kind === 'missing' || nd.kind === 'start' && line < nd.line) return;
			if (nd.lines[0] <= line && (!best || nd.lines[0] > best.lines[0] || (nd.lines[0] === best.lines[0] && nd.index > best.index))) best = nd;
		});
		if (!best) best = (g.nodes || [])[0] || null;
		return best;
	}

	/* ------------------------------------------------------------------ layout */

	function layout(g, opts) {
		opts = opts || {};
		var GAPX = opts.gapX || 22, STEP = opts.layerStep || 66, HEAD = opts.bandHead || 24, MARGIN = opts.margin || 16, LANE = 12;
		var nodes = g.nodes, edges = g.edges, byId = {};
		nodes.forEach(function (nd, i) { byId[nd.id] = nd; nd.seq = i; var s = SIZE[nd.kind] || SIZE.label; nd.w = s[0]; nd.h = s[1]; });

		// bands: chapter -1 (before the first chapter) then each chapter in file order
		var bandIds = [];
		nodes.forEach(function (nd) { if (bandIds.indexOf(nd.chapter) < 0) bandIds.push(nd.chapter); });
		bandIds.sort(function (a, b) { return a - b; });
		var bandRank = {}; bandIds.forEach(function (c, i) { bandRank[c] = i; });

		// back edges: into an earlier band, a self edge, or closing a cycle inside a band (DFS in file order)
		var outs = {}; nodes.forEach(function (nd) { outs[nd.id] = []; });
		edges.forEach(function (e) { outs[e.from].push(e); e.back = false; });
		edges.forEach(function (e) {
			if (e.from === e.to || bandRank[byId[e.to].chapter] < bandRank[byId[e.from].chapter]) e.back = true;
		});
		var state = {};
		function dfs(id) {
			state[id] = 1;
			outs[id].forEach(function (e) {
				if (e.back || byId[e.to].chapter !== byId[id].chapter) return;
				if (state[e.to] === 1) e.back = true;
				else if (!state[e.to]) dfs(e.to);
			});
			state[id] = 2;
		}
		nodes.forEach(function (nd) { if (!state[nd.id]) dfs(nd.id); });

		// layers: longest path over forward edges, every band below the one before it
		var preds = {}; nodes.forEach(function (nd) { preds[nd.id] = []; });
		edges.forEach(function (e) { if (!e.back) preds[e.to].push(e.from); });
		var layer = {}, bandStart = {}, bandEnd = {}, next = 0;
		bandIds.forEach(function (c) {
			bandStart[c] = next;
			var inBand = nodes.filter(function (nd) { return nd.chapter === c; });
			// topological order inside the band (Kahn, ties by file order)
			var indeg = {}, done = {};
			inBand.forEach(function (nd) { indeg[nd.id] = preds[nd.id].filter(function (p) { return byId[p].chapter === c; }).length; });
			var remaining = inBand.length, guard = 0;
			while (remaining && guard++ < 100000) {
				var pick = null;
				for (var k = 0; k < inBand.length; k++) if (!done[inBand[k].id] && indeg[inBand[k].id] === 0) { pick = inBand[k]; break; }
				if (!pick) { for (k = 0; k < inBand.length; k++) if (!done[inBand[k].id]) { pick = inBand[k]; break; } }
				var l = bandStart[c];
				preds[pick.id].forEach(function (p) { if (layer[p] != null) l = Math.max(l, layer[p] + 1); });
				layer[pick.id] = l;
				done[pick.id] = 1; remaining--;
				outs[pick.id].forEach(function (e) { if (!e.back && byId[e.to].chapter === c && !done[e.to]) indeg[e.to]--; });
			}
			var end = bandStart[c];
			inBand.forEach(function (nd) { end = Math.max(end, layer[nd.id]); });
			bandEnd[c] = end;
			next = end + 1;
		});
		// an edge into a later band whose target was laid out before its source's band was known cannot occur:
		// bands are laid out in order and a forward edge never points into an earlier band.
		edges.forEach(function (e) { if (!e.back && layer[e.to] <= layer[e.from]) e.back = true; });

		var nLayers = next;
		var rows = []; for (var r = 0; r < nLayers; r++) rows.push([]);

		// dummy points for forward edges that skip layers
		var items = {};
		nodes.forEach(function (nd) { nd.layer = layer[nd.id]; items[nd.id] = { id: nd.id, node: nd, w: nd.w, layer: nd.layer, up: [], down: [], key: nd.seq }; rows[nd.layer].push(items[nd.id]); });
		edges.forEach(function (e) {
			e.via = [];
			if (e.back) return;
			var prev = items[e.from];
			for (var L = layer[e.from] + 1; L < layer[e.to]; L++) {
				var d = { id: e.id + ':' + L, node: null, w: 8, layer: L, up: [prev], down: [], key: byId[e.from].seq + 0.5 };
				prev.down.push(d);
				rows[L].push(d); e.via.push(d);
				prev = d;
			}
			prev.down.push(items[e.to]); items[e.to].up.push(prev);
		});
		rows.forEach(function (row) { row.sort(function (a, b) { return a.key - b.key || (a.id < b.id ? -1 : 1); }); row.forEach(function (it, i) { it.pos = i; }); });

		// crossing reduction: barycentre sweeps, stable ties
		function sweep(down) {
			for (var q = down ? 1 : nLayers - 2; down ? q < nLayers : q >= 0; q += down ? 1 : -1) {
				var row = rows[q];
				row.forEach(function (it) {
					var nb = down ? it.up : it.down;
					it.bary = nb.length ? nb.reduce(function (s, x) { return s + x.pos; }, 0) / nb.length : it.pos;
				});
				row.sort(function (a, b) { return (a.bary - b.bary) || (a.pos - b.pos); });
				row.forEach(function (it, i) { it.pos = i; });
			}
		}
		for (var s = 0; s < 4; s++) { sweep(true); sweep(false); }

		// x: pack each row, pulled towards the centre of what leads into it
		rows.forEach(function (row) { var x = 0; row.forEach(function (it) { it.x = x; x += it.w + GAPX; }); });
		function place(down) {
			for (var q = down ? 1 : nLayers - 2; down ? q < nLayers : q >= 0; q += down ? 1 : -1) {
				var row = rows[q];
				var want = row.map(function (it) {
					var nb = down ? it.up : it.down;
					if (!nb.length) return it.x + it.w / 2;
					return nb.reduce(function (sm, x) { return sm + x.x + x.w / 2; }, 0) / nb.length;
				});
				// left to right, never overlapping; then shift the row back towards what it wanted
				var xs = [], prevR = -Infinity;
				row.forEach(function (it, i) { var x = Math.max(want[i] - it.w / 2, prevR + GAPX); xs.push(x); prevR = x + it.w; });
				var over = 0;
				row.forEach(function (it, i) { over += xs[i] - (want[i] - it.w / 2); });
				var shift = row.length ? over / row.length : 0;
				var minX = row.length ? xs[0] - shift : 0;
				if (minX < 0) shift += minX;
				row.forEach(function (it, i) { it.x = Math.round(xs[i] - shift); });
			}
		}
		for (s = 0; s < 3; s++) { place(true); place(false); }
		var minAll = Infinity;
		rows.forEach(function (row) { row.forEach(function (it) { minAll = Math.min(minAll, it.x); }); });
		if (!isFinite(minAll)) minAll = 0;

		// y: layers inside bands, a header strip above every band that has a chapter
		var layerY = [], y = MARGIN, bandOf = {};
		bandIds.forEach(function (c) { for (var L = bandStart[c]; L <= bandEnd[c]; L++) bandOf[L] = c; });
		var bands = [];
		for (var L = 0; L < nLayers; L++) {
			var c = bandOf[L];
			if (L === bandStart[c]) {
				var b = { chapter: c, n: c >= 0 ? g.chapters[c].n : '', title: c >= 0 ? g.chapters[c].title : '', line: c >= 0 ? g.chapters[c].line : 0, y0: y };
				bands.push(b);
				y += (c >= 0 ? HEAD : 4);
			}
			layerY[L] = y;
			y += STEP;
			if (L === bandEnd[c]) { bands[bands.length - 1].y1 = y - STEP + 44; y = bands[bands.length - 1].y1 + 8; }
		}
		var maxRight = 0;
		rows.forEach(function (row) { row.forEach(function (it) { it.x = it.x - minAll + MARGIN; maxRight = Math.max(maxRight, it.x + it.w); }); });
		nodes.forEach(function (nd) {
			var it = items[nd.id];
			nd.x = it.x; nd.y = layerY[nd.layer] + Math.round((36 - nd.h) / 2); nd.order = it.pos;
			nd.cx = nd.x + nd.w / 2; nd.cy = nd.y + nd.h / 2;
		});

		// edge geometry
		var lane = 0;
		edges.forEach(function (e) {
			var a = byId[e.from], z = byId[e.to];
			if (!e.back) {
				var pts = [{ x: a.cx, y: a.y + a.h }];
				e.via.forEach(function (d) { pts.push({ x: d.x + d.w / 2, y: layerY[d.layer] + 18 }); });
				pts.push({ x: z.cx, y: z.y });
				e.points = pts;
			} else {
				// round the right-hand side, outside every node between the two layers
				var lo = Math.min(a.layer, z.layer), hi = Math.max(a.layer, z.layer), right = 0;
				for (var q = lo; q <= hi; q++) rows[q].forEach(function (it) { right = Math.max(right, it.x + it.w); });
				var rx = right + 14 + LANE * (lane++ % 6);
				e.points = [{ x: a.x + a.w, y: a.cy }, { x: rx, y: a.cy }, { x: rx, y: z.cy }, { x: z.x + z.w, y: z.cy }];
				maxRight = Math.max(maxRight, rx);
			}
			delete e.via;
		});

		bands.forEach(function (b) { b.x0 = 0; b.x1 = maxRight + MARGIN; });
		g.bands = bands;
		g.layers = nLayers;
		g.width = Math.ceil(maxRight + MARGIN);
		g.height = Math.ceil(y + MARGIN);
		nodes.forEach(function (nd) { delete nd.seq; });
		return g;
	}

	function build(program, walk, opts) { return layout(graph(program, walk), opts); }

	// pure helpers the panel and the test share
	function overlaps(a, b, pad) {
		pad = pad || 0;
		return a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad;
	}
	function summary(g) {
		var s = g.stats, parts = [];
		parts.push(s.labels + (s.labels === 1 ? ' label' : ' labels'));
		parts.push(s.menus + (s.menus === 1 ? ' menu' : ' menus'));
		if (s.paths != null) parts.push(s.paths + (s.paths === 1 ? ' path' : ' paths'));
		var e = s.reachableEndings;
		if (e) {
			parts.push(e.end + (e.end === 1 ? ' end card' : ' end cards'));
			if (e.withheld) parts.push(e.withheld + ' withheld');
		}
		return parts.join(' · ');
	}

	return { graph: graph, layout: layout, build: build, nodeAtLine: nodeAtLine, overlaps: overlaps, summary: summary, SIZE: SIZE, cut: cut };
}));
