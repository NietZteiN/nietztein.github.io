// Constellations: canvas, camera, panels. The graph engine is in graph.js.
(function () {
	'use strict';

	var G = window.AuthorGraph;
	var DATA_URL = '../../assets/data/library.json';
	var params = new URLSearchParams(location.search);
	var THUMB = params.get('thumb') === '1';
	var reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
	if (THUMB) document.body.classList.add('thumb');

	// ---- DOM ------------------------------------------------------------------
	function $(s) { return document.querySelector(s); }
	function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
	var canvas = $('#sky'), ctx = canvas.getContext('2d');
	var panel = $('#panel'), card = $('#card'), cardName = $('#card-name'), cardBody = $('#card-body'), tip = $('#tip');
	var qInput = $('#q'), results = $('#results'), statusEl = $('#status'), subtitle = $('#subtitle');

	// ---- State ----------------------------------------------------------------
	var graph = null, edges = [], clusters = [], sim = null;
	var layout = 'force', skin = 'constellation', paint = 'genre';
	var showHulls = true, showLabels = true;
	var cfg = { enabled: {}, weight: {}, perNode: 4 };
	G.EDGE_TYPES.forEach(function (t) { cfg.enabled[t.k] = true; cfg.weight[t.k] = t.w; });
	var layoutInfo = { mode: 'force', labels: [] };
	var cam = { x: 0, y: 0, k: 1 };
	var W = 0, H = 0, DPR = 1;
	var hover = null, selected = null, spot = null;
	var dragging = null, dragStart = null, dragMoved = false, dragWasPinned = false;
	var panning = null;
	var pointers = new Map(), pinch = null;
	var autoFit = false, dirty = true, flight = null;
	var bgStars = [];
	var seed = G.hashStr(new Date().toISOString().slice(0, 10));
	var raf = 0;
	var byId = {};

	// ---- Colour -----------------------------------------------------------------
	function eraT(y) { var t = G.yearT(y); return t; }
	function hsl(n) {
		if (paint === 'lang') { return { h: G.LANG_HUE[n.lang] || 42, s: 70, grey: false }; }
		if (paint === 'era') {
			var t = eraT(n.year);
			if (t == null) return { h: 0, s: 0, grey: true };
			return { h: 262 - 222 * t, s: 70, grey: false };
		}
		return { h: n.hue, s: n.grey ? 0 : 70, grey: n.grey };
	}
	function starColor(n, alpha, light) {
		var c = hsl(n);
		var L = light != null ? light : (skin === 'constellation' ? 76 : 60);
		var S = c.grey ? 0 : (skin === 'constellation' ? c.s : 55);
		return 'hsla(' + c.h.toFixed(0) + ' ' + S + '% ' + L + '% / ' + alpha + ')';
	}
	function clusterColor(c, alpha, light) {
		// nebulae stay tinted by their dominant genre whatever the star colouring
		var h = c.hue, s = c.grey ? 0 : 60;
		return 'hsla(' + h + ' ' + s + '% ' + (light || 62) + '% / ' + alpha + ')';
	}

	// ---- Camera -----------------------------------------------------------------
	function resize() {
		DPR = Math.min(window.devicePixelRatio || 1, 2);
		W = canvas.clientWidth; H = canvas.clientHeight;
		canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
		makeBgStars();
		dirty = true;
	}
	function viewRect() {
		// The part of the canvas not covered by panels, for fitting.
		var narrow = W <= 760;
		var left = narrow || THUMB ? 16 : 290 + 24, right = W - 16, top = 56, bottom = narrow ? H - 60 : H - 50;
		if (!narrow && !THUMB && card.classList.contains('show')) right = W - 352 - 24;
		if (narrow && card.classList.contains('show')) bottom = H * 0.42;
		return { x: left, y: top, w: Math.max(200, right - left), h: Math.max(200, bottom - top) };
	}
	function toScreen(x, y) { return [W / 2 + cam.x + x * cam.k, H / 2 + cam.y + y * cam.k]; }
	function toWorld(sx, sy) { return [(sx - W / 2 - cam.x) / cam.k, (sy - H / 2 - cam.y) / cam.k]; }
	function contentBounds(useTargets) {
		var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
		graph.nodes.forEach(function (n) {
			var x = useTargets && n.tx != null ? n.tx : n.x, y = useTargets && n.ty != null ? n.ty : n.y;
			if (x - n.r < x0) x0 = x - n.r; if (x + n.r > x1) x1 = x + n.r; if (y - n.r < y0) y0 = y - n.r; if (y + n.r > y1) y1 = y + n.r;
		});
		if (layout === 'radial') { var R = layoutInfo.R + 95; x0 = Math.min(x0, -R); x1 = Math.max(x1, R); y0 = Math.min(y0, -R); y1 = Math.max(y1, R); }
		if (layout === 'timeline') { y0 -= 30; y1 += 30; }
		if (layout === 'grid') { y0 -= 10; }
		return { x0: x0, y0: y0, x1: x1, y1: y1 };
	}
	function fitCamera(useTargets) {
		var b = contentBounds(useTargets), v = viewRect();
		var pad = 36;
		var bw = Math.max(1, b.x1 - b.x0 + pad * 2), bh = Math.max(1, b.y1 - b.y0 + pad * 2);
		var k = Math.min(v.w / bw, v.h / bh);
		k = Math.max(0.2, Math.min(2.5, k));
		var cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
		return { k: k, x: (v.x + v.w / 2) - W / 2 - cx * k, y: (v.y + v.h / 2) - H / 2 - cy * k };
	}
	function flyTo(target, ms) {
		if (reducedMotion || THUMB || !ms) { cam.x = target.x; cam.y = target.y; cam.k = target.k; flight = null; dirty = true; return; }
		flight = { from: { x: cam.x, y: cam.y, k: cam.k }, to: target, t0: performance.now(), ms: ms };
		schedule();
	}
	function camToNode(n, k) {
		var v = viewRect();
		return { k: k, x: (v.x + v.w / 2) - W / 2 - n.x * k, y: (v.y + v.h / 2) - H / 2 - n.y * k };
	}

	// ---- Background stars ----------------------------------------------------
	function makeBgStars() {
		var rnd = G.mulberry32(seed ^ 0x5bd1e995);
		bgStars = [];
		var count = Math.round(W * H / 2600);
		for (var i = 0; i < count; i++) bgStars.push({ x: rnd() * 1.4 - 0.2, y: rnd() * 1.4 - 0.2, r: 0.3 + rnd() * 0.9, a: 0.15 + rnd() * 0.5, w: rnd() < 0.12 });
	}

	// ---- Build ----------------------------------------------------------------
	function rebuildEdges(keepHeat) {
		edges = G.selectEdges(graph, cfg);
		clusters = G.communities(graph, edges, seed);
		if (sim) { sim.setEdges(edges); sim.clusters = clusters; if (!keepHeat) sim.reheat(0.6); }
		$('#edge-count').textContent = edges.length + ' lines · ' + clusters.length + ' clusters';
		if (selected) renderCard(selected);
		dirty = true; schedule();
	}
	function applyLayout(mode, first) {
		layout = mode;
		layoutInfo = G.layoutTargets(graph, mode, { w: Math.max(900, W - 340), h: Math.max(600, H - 110) });
		sim.chargeScale = layoutInfo.charge;
		sim.linkStrength = layoutInfo.link;
		sim.centre = 0.005 * layoutInfo.centre;
		sim.centreX = layoutInfo.centreX != null ? layoutInfo.centreX : 1;
		sim.centreY = 1;
		sim.posStrength = layoutInfo.pos;
		sim.posX = 1; sim.posY = layoutInfo.posY != null ? layoutInfo.posY : 1;
		sim.collide = layoutInfo.collide;
		sim.clusterStrength = layoutInfo.cluster != null ? layoutInfo.cluster : 0;
		// pinned nodes keep their pins across layouts (the user asked for them)
		sim.reheat(first ? 1 : 0.9);
		if (mode !== 'force') { graph.nodes.forEach(function (n) { if (n.ty == null && n.tx != null) n.ty = n.y; }); }
		autoFit = true;
		if (mode !== 'force') flyTo(fitCamera(true), first ? 0 : 700);
		document.querySelectorAll('#layout-seg button').forEach(function (b) { b.setAttribute('aria-checked', String(b.dataset.v === mode)); });
		dirty = true; schedule();
	}

	// ---- Drawing ----------------------------------------------------------------
	function labelFont(px, serif) {
		return (serif ? '600 ' : '500 ') + px + 'px ' + (serif ? '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, "Hiragino Mincho ProN", "Yu Mincho", "Noto Serif CJK JP", serif' : '-apple-system, "Segoe UI", Helvetica, Arial, "Hiragino Sans", "Yu Gothic", "Noto Sans CJK JP", sans-serif');
	}
	function smallCaps(c, text, x, y, px, color, align) {
		// uppercase with tracking: canvas has no reliable small-caps
		c.font = '600 ' + px + 'px ' + '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, "Hiragino Mincho ProN", "Yu Mincho", serif';
		c.fillStyle = color;
		var t = G.isJapaneseText(text) ? text : text.toUpperCase();
		var track = px * 0.14, widths = [], total = 0;
		for (var i = 0; i < t.length; i++) { var w = c.measureText(t[i]).width; widths.push(w); total += w + track; }
		total -= track;
		var sx = align === 'left' ? x : align === 'right' ? x - total : x - total / 2;
		c.textAlign = 'left';
		for (i = 0; i < t.length; i++) { c.fillText(t[i], sx, y); sx += widths[i] + track; }
		return total;
	}
	function focusNode() { return hover || selected; }
	function neighbourSet(n) {
		var s = new Set(); s.add(n);
		n.adj.forEach(function (e) { s.add(e.source === n ? e.target : e.source); });
		return s;
	}

	function draw(c, w, h, scale, forExport) {
		c.setTransform(scale, 0, 0, scale, 0, 0);
		var cons = skin === 'constellation';
		// sky
		if (cons) {
			var gr = c.createRadialGradient(w * 0.5, h * 0.45, 10, w * 0.5, h * 0.45, Math.max(w, h) * 0.75);
			gr.addColorStop(0, '#0d1428'); gr.addColorStop(1, '#05070f');
			c.fillStyle = gr; c.fillRect(0, 0, w, h);
			for (var i = 0; i < bgStars.length; i++) {
				var s = bgStars[i];
				var sx = (s.x * w + cam.x * 0.15) % (w * 1.2), sy = (s.y * h + cam.y * 0.15) % (h * 1.2);
				if (sx < -10) sx += w * 1.2; if (sy < -10) sy += h * 1.2;
				c.fillStyle = s.w ? 'rgba(200,215,255,' + s.a + ')' : 'rgba(255,245,225,' + s.a + ')';
				c.beginPath(); c.arc(sx, sy, s.r, 0, 6.2832); c.fill();
			}
		} else {
			c.fillStyle = '#15171c'; c.fillRect(0, 0, w, h);
		}
		if (!graph) return;

		var focus = focusNode();
		var nb = focus ? neighbourSet(focus) : null;
		var k = cam.k;
		var ox = w / 2 + cam.x, oy = h / 2 + cam.y;
		c.save();
		c.translate(ox, oy); c.scale(k, k);

		// layout guides
		drawGuides(c, k, cons);

		// hulls
		if (showHulls && layout === 'force') drawHulls(c, k, cons);

		// edges
		c.lineCap = 'round';
		for (i = 0; i < edges.length; i++) {
			var e = edges[i], a = e.source, b = e.target;
			var inc = focus && (a === focus || b === focus);
			var alpha, width;
			if (focus) { alpha = inc ? 0.85 : 0.04; width = inc ? 1.4 : 0.6; }
			else { alpha = cons ? 0.10 + 0.32 * e.t : 0.14 + 0.4 * e.t; width = cons ? 0.6 + 0.9 * e.t : 0.8 + 1.4 * e.t; }
			if (spot && !focus && (a.genre !== spot && b.genre !== spot)) alpha *= 0.25;
			c.strokeStyle = inc ? (cons ? 'rgba(242,217,162,' + alpha + ')' : 'rgba(228,185,106,' + alpha + ')') : (cons ? 'rgba(170,190,240,' + alpha + ')' : 'rgba(255,255,255,' + alpha + ')');
			c.lineWidth = width / Math.sqrt(k);
			c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke();
		}

		// nodes
		var nodes = graph.nodes;
		for (i = 0; i < nodes.length; i++) {
			var n = nodes[i];
			var dim = (focus && !nb.has(n)) || (spot && n.genre !== spot && !(focus && nb.has(n)));
			var al = dim ? 0.22 : 1;
			var r = n.r;
			if (cons) {
				if (!dim) {
					var glowR = r * 2.6 + 4;
					var g2 = c.createRadialGradient(n.x, n.y, 0, n.x, n.y, glowR);
					g2.addColorStop(0, starColor(n, 0.55, 80)); g2.addColorStop(0.35, starColor(n, 0.18, 70)); g2.addColorStop(1, starColor(n, 0, 60));
					c.fillStyle = g2; c.beginPath(); c.arc(n.x, n.y, glowR, 0, 6.2832); c.fill();
				}
				c.fillStyle = starColor(n, al, dim ? 60 : 84);
				c.beginPath(); c.arc(n.x, n.y, r * 0.78, 0, 6.2832); c.fill();
				if (!dim) { c.fillStyle = 'rgba(255,255,255,0.85)'; c.beginPath(); c.arc(n.x, n.y, Math.max(0.6, r * 0.3), 0, 6.2832); c.fill(); }
				if (!dim && n.count >= 5) {
					// four-point sparkle for the big names
					c.strokeStyle = starColor(n, 0.45, 85); c.lineWidth = 0.8 / Math.sqrt(k);
					var sp = r * 2.2;
					c.beginPath(); c.moveTo(n.x - sp, n.y); c.lineTo(n.x + sp, n.y); c.moveTo(n.x, n.y - sp); c.lineTo(n.x, n.y + sp); c.stroke();
				}
			} else {
				c.fillStyle = starColor(n, al, dim ? 35 : 58);
				c.beginPath(); c.arc(n.x, n.y, r, 0, 6.2832); c.fill();
				c.strokeStyle = 'rgba(255,255,255,' + (dim ? 0.12 : 0.55) + ')'; c.lineWidth = 1 / k;
				c.stroke();
			}
			if (n.fx != null && n.pinned) {
				c.strokeStyle = cons ? 'rgba(242,217,162,0.9)' : 'rgba(228,185,106,0.95)'; c.lineWidth = 1.2 / k;
				c.beginPath(); c.arc(n.x, n.y, r + 4 / k, 0, 6.2832); c.stroke();
			}
			if (n === focus) {
				c.strokeStyle = cons ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.95)'; c.lineWidth = 1.5 / k;
				c.beginPath(); c.arc(n.x, n.y, r + 7 / k, 0, 6.2832); c.stroke();
			}
		}
		c.restore();

		// labels in screen space
		drawLabels(c, w, h, k, cons, focus, nb, scale);
		if (forExport) {
			c.font = labelFont(12, true); c.fillStyle = 'rgba(230,232,240,0.55)'; c.textAlign = 'left'; c.textBaseline = 'alphabetic';
			c.fillText('Constellations · ' + graph.N + ' authors of the library · nietztein.github.io', 16, h - 14);
		}
	}

	function drawGuides(c, k, cons) {
		var ink = cons ? 'rgba(200,210,240,' : 'rgba(255,255,255,';
		if (layout === 'radial') {
			c.strokeStyle = ink + '0.08)'; c.lineWidth = 1 / k; c.setLineDash([3 / k, 5 / k]);
			c.beginPath(); c.arc(0, 0, layoutInfo.R, 0, 6.2832); c.stroke(); c.setLineDash([]);
		} else if (layout === 'grid') {
			layoutInfo.labels.forEach(function (L) {
				var b = L.box;
				c.strokeStyle = ink + '0.10)'; c.lineWidth = 1 / k;
				c.beginPath(); c.rect(b.x - 8, b.y + 10, b.w + 16, b.h - 4); c.stroke();
			});
		} else if (layout === 'timeline') {
			c.strokeStyle = ink + '0.12)'; c.lineWidth = 1 / k;
			var y0 = -Infinity, y1 = Infinity;
			graph.nodes.forEach(function (n) { if (n.y > y0) y0 = n.y; if (n.y < y1) y1 = n.y; });
			layoutInfo.labels.forEach(function (L) {
				c.beginPath(); c.moveTo(L.x, y1 - 24); c.lineTo(L.x, y0 + 24); c.stroke();
			});
		}
	}

	function drawHulls(c, k, cons) {
		var shown = clusters.filter(function (cl) { return cl.members.length >= 5; }).slice(0, 16);
		shown.forEach(function (cl) {
			var pts = cl.members.map(function (n) { return [n.x, n.y]; });
			var h = G.hull(pts);
			if (h.length < 2) return;
			var maxR = 0; cl.members.forEach(function (n) { if (n.r > maxR) maxR = n.r; });
			var pad = maxR + 18;
			c.lineJoin = 'round'; c.lineCap = 'round';
			var layers = cons ? [[pad + 30, 0.025], [pad + 14, 0.035], [pad, 0.05]] : [[pad + 6, 0.05], [pad, 0.04]];
			layers.forEach(function (L) {
				c.strokeStyle = clusterColor(cl, L[1], cons ? 65 : 70); c.fillStyle = clusterColor(cl, L[1], cons ? 65 : 70);
				c.lineWidth = L[0] * 2;
				c.beginPath(); c.moveTo(h[0][0], h[0][1]);
				for (var i = 1; i < h.length; i++) c.lineTo(h[i][0], h[i][1]);
				c.closePath(); c.stroke(); if (h.length >= 3) c.fill();
			});
			cl._hull = h; cl._pad = pad;
		});
		clusters.forEach(function (cl) { if (shown.indexOf(cl) < 0) cl._hull = null; });
	}

	function drawLabels(c, w, h, k, cons, focus, nb, scale) {
		c.setTransform(scale, 0, 0, scale, 0, 0);
		var placed = [];
		function fits(x, y, tw, th) {
			if (x < -tw || y < 0 || x > w + tw || y > h) return false;
			for (var i = 0; i < placed.length; i++) { var p = placed[i]; if (x < p[0] + p[2] && x + tw > p[0] && y < p[1] + p[3] && y + th > p[1]) return false; }
			placed.push([x, y, tw, th]); return true;
		}
		c.textBaseline = 'middle';
		var ox = w / 2 + cam.x, oy = h / 2 + cam.y;
		// layout labels
		if (layout === 'radial') {
			layoutInfo.labels.forEach(function (L) {
				var x = ox + Math.cos(L.angle) * L.r * k, y = oy + Math.sin(L.angle) * L.r * k;
				var col = 'hsla(' + L.hue + ' ' + (L.grey ? 0 : 60) + '% 72% / 0.85)';
				var text = L.text + ' · ' + L.n;
				c.font = labelFont(11, true); var tw = c.measureText(text.toUpperCase()).width * 1.14;
				var align = Math.cos(L.angle) > 0.2 ? 'left' : Math.cos(L.angle) < -0.2 ? 'right' : 'center';
				var lx = align === 'left' ? x : align === 'right' ? x - tw : x - tw / 2;
				if (fits(lx - 2, y - 7, tw + 4, 14)) smallCaps(c, text, x, y, 11, col, align);
			});
		} else if (layout === 'grid') {
			layoutInfo.labels.forEach(function (L) {
				var x = ox + L.x * k, y = oy + L.y * k;
				c.font = labelFont(11, true);
				smallCaps(c, L.text + ' · ' + L.n, x, y, 11, cons ? 'rgba(220,226,245,0.8)' : 'rgba(255,255,255,0.75)', 'left');
			});
		} else if (layout === 'timeline') {
			var y0 = -Infinity; graph.nodes.forEach(function (n) { if (n.y > y0) y0 = n.y; });
			layoutInfo.labels.forEach(function (L) {
				var x = ox + L.x * k, y = oy + (y0 + 36) * k;
				if (y > h - 8) y = h - 8;
				c.font = labelFont(11, false); c.fillStyle = cons ? 'rgba(220,226,245,0.7)' : 'rgba(255,255,255,0.7)'; c.textAlign = 'center';
				c.fillText(L.text, x, y);
			});
		}
		// cluster names
		if (showHulls && layout === 'force') {
			clusters.forEach(function (cl) {
				if (!cl._hull) return;
				var top = null; cl._hull.forEach(function (p) { if (!top || p[1] < top[1]) top = p; });
				var cen = G.centroid(cl._hull);
				var x = ox + cen[0] * k, y = oy + (top[1] - cl._pad - 6) * k;
				var dimmed = focus && !cl.members.some(function (m) { return nb.has(m); });
				var col = clusterColor(cl, dimmed ? 0.25 : (cons ? 0.8 : 0.85), 74);
				c.font = labelFont(11, true);
				var tw = c.measureText(cl.name.toUpperCase()).width * 1.14;
				if (fits(x - tw / 2 - 2, y - 7, tw + 4, 14)) smallCaps(c, cl.name, x, y, 11, col, 'center');
			});
		}
		// author names
		if (!showLabels && !focus) return;
		var minCount = k < 0.6 ? 6 : k < 1.1 ? 4 : k < 1.8 ? 2 : 1;
		if (THUMB) minCount = 4;
		var list = graph.nodes;
		for (var i = 0; i < list.length; i++) {
			var n = list[i];
			var isNb = focus && nb.has(n);
			if (!isNb && (!showLabels || n.count < minCount)) continue;
			if (focus && !isNb) continue;
			var sx = ox + n.x * k, sy = oy + n.y * k;
			if (sx < -80 || sy < -20 || sx > w + 80 || sy > h + 20) continue;
			var px = n === focus ? 14 : isNb ? 12 : Math.min(13, 10 + Math.sqrt(n.count) * 0.7);
			c.font = labelFont(px, cons);
			var tw = c.measureText(n.name).width;
			var lx = sx + n.r * k + 5, ly = sy;
			if (!fits(lx, ly - px / 2 - 1, tw, px + 2)) continue;
			c.textAlign = 'left';
			if (cons) { c.shadowColor = 'rgba(0,0,0,0.9)'; c.shadowBlur = 4; }
			c.fillStyle = n === focus ? (cons ? '#fff3d6' : '#fff') : isNb ? 'rgba(240,242,250,0.95)' : (spot && n.genre !== spot ? 'rgba(230,232,240,0.3)' : 'rgba(230,232,240,' + (cons ? 0.82 : 0.9) + ')');
			c.fillText(n.name, lx, ly);
			c.shadowBlur = 0;
		}
	}

	function render() { draw(ctx, W, H, DPR, false); dirty = false; }

	// ---- Loop ---------------------------------------------------------------
	function schedule() { if (!raf) raf = requestAnimationFrame(frame); }
	function frame(now) {
		raf = 0;
		var busy = false;
		if (flight) {
			var t = Math.max(0, Math.min(1, (now - flight.t0) / flight.ms)), e = 1 - Math.pow(1 - t, 3);
			cam.x = flight.from.x + (flight.to.x - flight.from.x) * e;
			cam.y = flight.from.y + (flight.to.y - flight.from.y) * e;
			cam.k = flight.from.k + (flight.to.k - flight.from.k) * e;
			if (t >= 1) flight = null; else busy = true;
			dirty = true;
		}
		if (sim && !sim.settled()) {
			sim.tick(sim.alpha > 0.5 ? 2 : 1);
			busy = true; dirty = true;
			if (autoFit && !flight && !dragging && !panning) {
				var f = fitCamera(false);
				var rate = layout === 'force' ? 0.08 : 0.15;
				cam.x += (f.x - cam.x) * rate; cam.y += (f.y - cam.y) * rate; cam.k += (f.k - cam.k) * rate;
			}
		} else if (autoFit) autoFit = false;
		if (dirty) render();
		updateStatus();
		if (busy) schedule();
	}
	function updateStatus() {
		if (!sim || THUMB) return;
		statusEl.textContent = (sim.settled() ? 'settled' : 'settling · α ' + sim.alpha.toFixed(2)) + ' · zoom ' + cam.k.toFixed(2) + '×';
	}

	// ---- Hit testing & pointer ---------------------------------------------------
	function nodeAt(sx, sy) {
		var p = toWorld(sx, sy), best = null, bd = Infinity;
		var slop = 9 / cam.k;
		for (var i = 0; i < graph.nodes.length; i++) {
			var n = graph.nodes[i], dx = n.x - p[0], dy = n.y - p[1], d = Math.sqrt(dx * dx + dy * dy) - n.r;
			if (d < slop && d < bd) { bd = d; best = n; }
		}
		return best;
	}
	function setHover(n, ev) {
		if (n !== hover) { hover = n; dirty = true; schedule(); canvas.classList.toggle('hit', !!n); }
		if (n && ev) showTip(n, ev.clientX, ev.clientY); else hideTip();
	}

	canvas.addEventListener('pointerdown', function (ev) {
		if (!graph) return;
		canvas.setPointerCapture(ev.pointerId);
		pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
		results.classList.remove('show');
		if (pointers.size === 2) {
			var pts = Array.from(pointers.values());
			pinch = { d: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y), k: cam.k, cx: (pts[0].x + pts[1].x) / 2, cy: (pts[0].y + pts[1].y) / 2, camx: cam.x, camy: cam.y };
			if (dragging) { endDrag(false); }
			panning = null;
			return;
		}
		var n = nodeAt(ev.clientX, ev.clientY);
		autoFit = false;
		if (n) {
			dragging = n; dragStart = [ev.clientX, ev.clientY]; dragMoved = false; dragWasPinned = !!n.pinned;
			n.fx = n.x; n.fy = n.y;
			hideTip();
		} else {
			panning = { x: ev.clientX, y: ev.clientY, camx: cam.x, camy: cam.y, moved: false };
			canvas.classList.add('drag');
		}
	});
	canvas.addEventListener('pointermove', function (ev) {
		if (!graph) return;
		if (pointers.has(ev.pointerId)) pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
		if (pinch && pointers.size >= 2) {
			var pts = Array.from(pointers.values());
			var d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
			var cx = (pts[0].x + pts[1].x) / 2, cy = (pts[0].y + pts[1].y) / 2;
			var nk = Math.max(0.15, Math.min(6, pinch.k * d / pinch.d));
			// keep the midpoint fixed in world space
			var wx = (pinch.cx - W / 2 - pinch.camx) / pinch.k, wy = (pinch.cy - H / 2 - pinch.camy) / pinch.k;
			cam.k = nk; cam.x = cx - W / 2 - wx * nk; cam.y = cy - H / 2 - wy * nk;
			dirty = true; schedule(); return;
		}
		if (dragging) {
			if (!dragMoved && Math.hypot(ev.clientX - dragStart[0], ev.clientY - dragStart[1]) > 4) { dragMoved = true; sim.reheat(0.3); }
			if (dragMoved) {
				var p = toWorld(ev.clientX, ev.clientY);
				dragging.fx = p[0]; dragging.fy = p[1];
				if (reducedMotion) sim.tick(3);
				dirty = true; schedule();
			}
			return;
		}
		if (panning) {
			var dx = ev.clientX - panning.x, dy = ev.clientY - panning.y;
			if (Math.abs(dx) + Math.abs(dy) > 3) panning.moved = true;
			cam.x = panning.camx + dx; cam.y = panning.camy + dy; dirty = true; schedule();
			return;
		}
		if (ev.pointerType === 'mouse' || ev.pointerType === 'pen') setHover(nodeAt(ev.clientX, ev.clientY), ev);
	});
	function endDrag(click) {
		var n = dragging; dragging = null;
		if (!n) return;
		if (click) {
			if (selected === n && n.pinned) { /* already pinned and open; keep */ }
			n.pinned = true; n.fx = n.x; n.fy = n.y;
			select(n);
		} else {
			if (!dragWasPinned) { n.fx = n.fy = null; n.pinned = false; }
			sim.reheat(0.2);
		}
		dirty = true; schedule();
	}
	canvas.addEventListener('pointerup', function (ev) {
		pointers.delete(ev.pointerId);
		if (pinch) { if (pointers.size < 2) pinch = null; return; }
		if (dragging) { endDrag(!dragMoved); if (ev.pointerType !== 'mouse') setHover(null); return; }
		if (panning) {
			var wasMoved = panning.moved; panning = null; canvas.classList.remove('drag');
			if (!wasMoved) { if (ev.pointerType !== 'mouse') { setHover(null); } if (selected) { clearSelection(); } }
		}
	});
	canvas.addEventListener('pointercancel', function (ev) { pointers.delete(ev.pointerId); pinch = null; if (dragging) endDrag(false); panning = null; canvas.classList.remove('drag'); });
	canvas.addEventListener('pointerleave', function () { if (!dragging) setHover(null); });
	canvas.addEventListener('dblclick', function (ev) {
		if (!graph) return;
		var n = nodeAt(ev.clientX, ev.clientY);
		if (n) { n.fx = n.fy = null; n.pinned = false; sim.reheat(0.3); dirty = true; schedule(); if (selected === n) renderCard(n); }
		else { autoFit = false; flyTo(fitCamera(false), 500); }
	});
	canvas.addEventListener('wheel', function (ev) {
		if (!graph) return;
		ev.preventDefault();
		autoFit = false; flight = null;
		var f = Math.exp(-ev.deltaY * (ev.deltaMode === 1 ? 0.05 : 0.0016));
		var nk = Math.max(0.15, Math.min(6, cam.k * f));
		var p = toWorld(ev.clientX, ev.clientY);
		cam.k = nk; cam.x = ev.clientX - W / 2 - p[0] * nk; cam.y = ev.clientY - H / 2 - p[1] * nk;
		dirty = true; schedule();
	}, { passive: false });

	document.addEventListener('keydown', function (ev) {
		var t = ev.target, editing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA');
		if (ev.key === 'Escape') { if (results.classList.contains('show')) { results.classList.remove('show'); return; } if (selected) clearSelection(); else if (panel.classList.contains('open')) closeSheet(); return; }
		if (editing) return;
		if (ev.key === '/') { ev.preventDefault(); openSheetIfNarrow(); qInput.focus(); qInput.select(); }
		else if (ev.key === 'f' || ev.key === 'F') { autoFit = false; flyTo(fitCamera(false), 500); }
		else if (ev.key === 'r' || ev.key === 'R') { reheat(); }
	});

	// ---- Tooltip -------------------------------------------------------------
	function showTip(n, x, y) {
		tip.innerHTML = '';
		tip.appendChild(el('div', 't', n.name));
		tip.appendChild(el('div', 'a', n.count + (n.count === 1 ? ' book' : ' books') + ' · ' + G.GENRE_SHORT[n.genre] + (n.year != null ? ' · from ' + yearText(n.year) : '')));
		var ul = el('ul');
		n.books.slice(0, 5).forEach(function (b) {
			var li = el('li'); li.textContent = b.t + ' ';
			var y = el('span', 'y', '· ' + (b.y != null ? yearText(b.y) : 'n.d.') + ' · ' + shelfText(b)); li.appendChild(y); ul.appendChild(li);
		});
		if (n.count > 5) ul.appendChild(el('li', 'y', '… and ' + (n.count - 5) + ' more'));
		tip.appendChild(ul);
		tip.appendChild(el('div', 'hint', n.deg + (n.deg === 1 ? ' neighbour' : ' neighbours') + ' · click to pin and read why'));
		tip.classList.add('show');
		var r = tip.getBoundingClientRect();
		var tx = x + 16, ty = y + 16;
		if (tx + r.width > W - 8) tx = x - r.width - 12;
		if (ty + r.height > H - 8) ty = Math.max(8, y - r.height - 12);
		tip.style.left = tx + 'px'; tip.style.top = ty + 'px';
	}
	function hideTip() { tip.classList.remove('show'); }
	function yearText(y) { return y < 0 ? (-y) + ' BC' : String(y); }
	function shelfText(b) { var u = G.UNIT_BY_KEY[b.u]; return (u ? u.name : b.u) + (b.s ? ', ' + b.s : ''); }

	// ---- Selection & card -----------------------------------------------------
	function select(n) {
		selected = n;
		renderCard(n);
		card.classList.add('show');
		dirty = true; schedule();
	}
	function clearSelection() {
		selected = null; card.classList.remove('show'); dirty = true; schedule();
	}
	function renderCard(n) {
		cardName.textContent = n.name;
		cardBody.innerHTML = '';
		var units = {};
		n.books.forEach(function (b) { units[b.u] = (units[b.u] || 0) + 1; });
		var where = Object.keys(units).sort(function (a, b) { return units[b] - units[a]; }).map(function (k) { var u = G.UNIT_BY_KEY[k]; return (u ? u.name : k) + (Object.keys(units).length > 1 ? ' (' + units[k] + ')' : ''); }).join(', ');
		cardBody.appendChild(el('div', 'meta', n.count + (n.count === 1 ? ' book' : ' books') + ' · ' + where + (n.year != null ? ' · first published ' + yearText(n.year) : '')));
		var chips = el('div', 'chips');
		Object.keys(n.genres).sort(function (a, b) { return n.genres[b] - n.genres[a]; }).forEach(function (g) {
			var s = el('span'); var d = el('i', 'dot'); d.style.color = 'hsl(' + (G.GENRE_HUE[g] || 0) + ' ' + (G.GREY_GENRES[g] ? 0 : 65) + '% 70%)'; d.style.background = 'currentColor';
			s.appendChild(d); s.appendChild(document.createTextNode(g + (Object.keys(n.genres).length > 1 ? ' · ' + n.genres[g] : ''))); chips.appendChild(s);
		});
		cardBody.appendChild(chips);
		var h3 = el('h3'); h3.textContent = 'Books'; var hint = el('span', 'hint', 'opens the card on the Bookshelf'); h3.appendChild(hint); cardBody.appendChild(h3);
		var ul = el('ul');
		n.books.forEach(function (b) {
			var li = el('li'); var a = el('a'); a.href = '../../#/bookshelf/' + encodeURIComponent(b.id); a.textContent = b.t; li.appendChild(a);
			li.appendChild(el('span', 'm', (b.y != null ? yearText(b.y) : 'n.d.') + ' · ' + shelfText(b) + (b.pub ? ' · ' + b.pub : '') + ' · ' + G.langLabel(b.l)));
			ul.appendChild(li);
		});
		cardBody.appendChild(ul);
		var h3b = el('h3'); h3b.textContent = 'Neighbours'; h3b.appendChild(el('span', 'hint', n.deg + ' drawn')); cardBody.appendChild(h3b);
		var nl = el('ul');
		n.adj.slice().sort(function (a, b) { return b.w - a.w; }).forEach(function (e) {
			var o = e.source === n ? e.target : e.source;
			var li = el('li', 'nb');
			var btn = el('button', 'lnk', o.name); btn.addEventListener('click', function () { goTo(o); });
			li.appendChild(btn);
			li.appendChild(el('span', 'm', o.count + (o.count === 1 ? ' book' : ' books')));
			li.appendChild(el('span', 'why', G.reasonText(graph, e)));
			nl.appendChild(li);
		});
		if (!n.adj.length) nl.appendChild(el('li', 'm', 'No lines with the current edge settings.'));
		cardBody.appendChild(nl);
		var act = el('div', 'actions');
		var rel = el('button', 'small', n.pinned ? 'Release pin' : 'Pin here');
		rel.addEventListener('click', function () {
			if (n.pinned) { n.pinned = false; n.fx = n.fy = null; sim.reheat(0.3); } else { n.pinned = true; n.fx = n.x; n.fy = n.y; }
			renderCard(n); dirty = true; schedule();
		});
		act.appendChild(rel);
		var fly = el('button', 'small', 'Fly to'); fly.addEventListener('click', function () { goTo(n); }); act.appendChild(fly);
		if (n.community) { var cm = el('span', 'muted', 'cluster: ' + n.community.name); cm.style.alignSelf = 'center'; act.appendChild(cm); }
		cardBody.appendChild(act);
		cardBody.scrollTop = 0;
	}
	function goTo(n) {
		autoFit = false;
		select(n);
		var k = Math.max(cam.k, 1.7);
		flyTo(camToNode(n, k), 700);
		closeSheet();
	}
	$('#card-close').addEventListener('click', clearSelection);

	// ---- Search ---------------------------------------------------------------
	function norm(s) {
		return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
			.replace(/[ァ-ヶ]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0x60); })
			.replace(/[！-～]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xfee0); });
	}
	var searchIndex = [];
	var resultNodes = [], resultSel = -1;
	function buildSearch() {
		searchIndex = [];
		graph.nodes.forEach(function (n) {
			searchIndex.push({ n: n, k: norm(n.name), kind: 'author' });
			n.books.forEach(function (b) { searchIndex.push({ n: n, k: norm(b.t), kind: 'title', b: b }); });
		});
	}
	function runSearch() {
		var q = norm(qInput.value.trim());
		results.innerHTML = ''; resultNodes = []; resultSel = -1;
		if (!q) { results.classList.remove('show'); return; }
		var hits = [];
		searchIndex.forEach(function (it) {
			var i = it.k.indexOf(q);
			if (i < 0) return;
			hits.push({ it: it, score: (it.kind === 'author' ? 0 : 10) + (i === 0 ? 0 : 3) + (it.k.length - q.length) / 100 });
		});
		hits.sort(function (a, b) { return a.score - b.score; });
		var seen = new Set();
		hits.forEach(function (h) {
			if (resultNodes.length >= 9) return;
			var key = h.it.n.index + (h.it.kind === 'title' ? ':' + h.it.b.id : '');
			if (seen.has(key) || (h.it.kind === 'title' && seen.has(String(h.it.n.index)))) return;
			seen.add(key); if (h.it.kind === 'author') seen.add(String(h.it.n.index));
			resultNodes.push(h.it.n);
			var li = el('li'); li.setAttribute('role', 'option');
			if (h.it.kind === 'author') { li.appendChild(el('span', 't', h.it.n.name)); li.appendChild(el('span', 'm', h.it.n.count + (h.it.n.count === 1 ? ' book' : ' books') + ' · ' + G.GENRE_SHORT[h.it.n.genre])); }
			else { li.appendChild(el('span', 't', h.it.b.t)); li.appendChild(el('span', 'm', h.it.n.name + ' · ' + shelfText(h.it.b))); }
			li.addEventListener('mousedown', function (ev) { ev.preventDefault(); pick(h.it.n); });
			results.appendChild(li);
		});
		if (!resultNodes.length) results.appendChild(el('li', 'none', 'No author or title matches'));
		results.classList.add('show');
	}
	function pick(n) { results.classList.remove('show'); qInput.blur(); goTo(n); }
	function highlightResult() { Array.from(results.children).forEach(function (li, i) { li.classList.toggle('sel', i === resultSel); }); }
	qInput.addEventListener('input', runSearch);
	qInput.addEventListener('focus', function () { if (qInput.value.trim()) runSearch(); });
	qInput.addEventListener('blur', function () { setTimeout(function () { results.classList.remove('show'); }, 120); });
	qInput.addEventListener('keydown', function (ev) {
		if (ev.key === 'ArrowDown') { ev.preventDefault(); resultSel = Math.min(resultNodes.length - 1, resultSel + 1); highlightResult(); }
		else if (ev.key === 'ArrowUp') { ev.preventDefault(); resultSel = Math.max(0, resultSel - 1); highlightResult(); }
		else if (ev.key === 'Enter') { ev.preventDefault(); var n = resultNodes[resultSel < 0 ? 0 : resultSel]; if (n) pick(n); }
	});

	// ---- Panel controls -----------------------------------------------------------
	function setSeg(id, v) { document.querySelectorAll(id + ' button').forEach(function (b) { b.setAttribute('aria-checked', String(b.dataset.v === v)); }); }
	function segHandler(id, fn) {
		var seg = $(id);
		seg.addEventListener('click', function (ev) {
			var b = ev.target.closest('button'); if (!b) return;
			seg.querySelectorAll('button').forEach(function (x) { x.setAttribute('aria-checked', String(x === b)); });
			fn(b.dataset.v);
		});
	}
	segHandler('#layout-seg', function (v) { applyLayout(v, false); });
	segHandler('#skin-seg', function (v) { skin = v; document.body.classList.toggle('network', v === 'network'); dirty = true; schedule(); });
	segHandler('#paint-seg', function (v) { paint = v; renderLegend(); dirty = true; schedule(); });
	$('#chk-hulls').addEventListener('change', function (ev) { showHulls = ev.target.checked; dirty = true; schedule(); });
	$('#chk-labels').addEventListener('change', function (ev) { showLabels = ev.target.checked; dirty = true; schedule(); });
	function reheat() { if (!sim) return; sim.reheat(0.8); autoFit = true; schedule(); }
	$('#btn-reheat').addEventListener('click', reheat);
	$('#btn-fit').addEventListener('click', function () { autoFit = false; flyTo(fitCamera(false), 500); });
	$('#btn-export').addEventListener('click', exportPNG);
	$('#btn-panel').addEventListener('click', function () { panel.classList.add('open'); document.body.classList.add('sheet'); });
	$('#btn-sheet-close').addEventListener('click', closeSheet);
	function closeSheet() { panel.classList.remove('open'); document.body.classList.remove('sheet'); }
	function openSheetIfNarrow() { if (W <= 760) { panel.classList.add('open'); document.body.classList.add('sheet'); } }

	function buildEdgePanel() {
		var box = $('#edges'); box.innerHTML = '';
		G.EDGE_TYPES.forEach(function (t) {
			var row = el('div', 'edge'); row.dataset.k = t.k;
			var lab = el('label'); var cb = el('input'); cb.type = 'checkbox'; cb.checked = cfg.enabled[t.k];
			lab.appendChild(cb); lab.appendChild(el('span', null, t.label)); lab.title = t.label;
			var range = el('input'); range.type = 'range'; range.min = '0.25'; range.max = '4'; range.step = '0.25'; range.value = String(cfg.weight[t.k]); range.setAttribute('aria-label', t.label + ' weight');
			var w = el('span', 'w', '×' + cfg.weight[t.k]);
			cb.addEventListener('change', function () { cfg.enabled[t.k] = cb.checked; row.classList.toggle('off', !cb.checked); rebuildEdges(); });
			range.addEventListener('input', function () { cfg.weight[t.k] = +range.value; w.textContent = '×' + range.value; });
			range.addEventListener('change', function () { rebuildEdges(); });
			row.appendChild(lab); row.appendChild(range); row.appendChild(w);
			box.appendChild(row);
		});
		var pn = $('#pernode');
		pn.addEventListener('input', function () { $('#pernode-v').textContent = pn.value; });
		pn.addEventListener('change', function () { cfg.perNode = +pn.value; rebuildEdges(); });
	}

	function renderLegend() {
		var leg = $('#legend'); leg.innerHTML = '';
		var title = $('#legend-title');
		var items = [];
		if (paint === 'genre') {
			var gc = {}; graph.nodes.forEach(function (n) { gc[n.genre] = (gc[n.genre] || 0) + 1; });
			Object.keys(gc).sort(function (a, b) { return gc[b] - gc[a]; }).forEach(function (g) { items.push({ key: g, text: G.GENRE_SHORT[g], n: gc[g], col: 'hsl(' + (G.GENRE_HUE[g] || 0) + ' ' + (G.GREY_GENRES[g] ? 0 : 65) + '% 70%)' }); });
			title.innerHTML = 'Genres <span class="hint">click to spotlight</span>';
		} else if (paint === 'lang') {
			var lc = {}; graph.nodes.forEach(function (n) { lc[n.lang] = (lc[n.lang] || 0) + 1; });
			Object.keys(lc).sort(function (a, b) { return lc[b] - lc[a]; }).forEach(function (l) { items.push({ key: null, text: l, n: lc[l], col: 'hsl(' + G.LANG_HUE[l] + ' 65% 70%)' }); });
			title.innerHTML = 'Language <span class="hint">of their books</span>';
		} else {
			[[-2200, 'antiquity'], [1500, '1500s'], [1800, '1800s'], [1900, '1900s'], [1950, '1950s'], [2000, '2000s'], [2020, '2020s']].forEach(function (p) {
				items.push({ key: null, text: p[1], n: '', col: 'hsl(' + (262 - 222 * G.yearT(p[0])).toFixed(0) + ' 65% 70%)' });
			});
			items.push({ key: null, text: 'undated', n: graph.nodes.filter(function (n) { return n.year == null; }).length, col: 'hsl(0 0% 60%)' });
			title.innerHTML = 'Era <span class="hint">first publication</span>';
		}
		items.forEach(function (it) {
			var b = el('button'); var d = el('i', 'dot'); d.style.color = it.col; d.style.background = 'currentColor'; b.appendChild(d);
			b.appendChild(el('span', 't', it.text)); b.appendChild(el('span', 'c', String(it.n)));
			if (it.key) {
				b.classList.toggle('off', !!spot && spot !== it.key);
				b.addEventListener('click', function () { spot = spot === it.key ? null : it.key; renderLegend(); dirty = true; schedule(); });
			} else b.disabled = true;
			leg.appendChild(b);
		});
	}

	// ---- Export -----------------------------------------------------------------
	function exportPNG() {
		if (!graph) return;
		var scale = 2;
		var off = document.createElement('canvas');
		off.width = W * scale; off.height = H * scale;
		var c = off.getContext('2d');
		draw(c, W, H, scale, true);
		var name = 'constellations-' + layout + (selected ? '-' + selected.name.replace(/[^\w぀-鿿]+/g, '_') : '') + '.png';
		if (off.toBlob) off.toBlob(function (blob) { if (!blob) return; var url = URL.createObjectURL(blob); var a = el('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(url); }, 2000); }, 'image/png');
		else { var a = el('a'); a.href = off.toDataURL('image/png'); a.download = name; document.body.appendChild(a); a.click(); a.remove(); }
	}

	// ---- Boot ---------------------------------------------------------------------
	function boot(data) {
		var books = data.books || [];
		graph = G.buildGraph(books);
		books.forEach(function (b) { byId[b.id] = b; });
		edges = G.selectEdges(graph, cfg);
		clusters = G.communities(graph, edges, seed);
		G.seedPositions(graph.nodes, seed, 260);
		sim = new G.Simulation(graph.nodes, edges);
		sim.clusters = clusters;
		subtitle.textContent = graph.N + ' authors of ' + books.length + ' books, joined by what they share';
		$('#edge-count').textContent = edges.length + ' lines · ' + clusters.length + ' clusters';
		buildEdgePanel(); renderLegend(); buildSearch();
		resize();
		// ?layout= ?skin= ?paint= deep links (also handy for testing)
		var pSkin = params.get('skin'), pPaint = params.get('paint'), pLayout = params.get('layout');
		if (pSkin === 'network') { skin = 'network'; document.body.classList.add('network'); setSeg('#skin-seg', skin); }
		if (pPaint === 'lang' || pPaint === 'era') { paint = pPaint; setSeg('#paint-seg', paint); renderLegend(); }
		applyLayout(/^(radial|grid|timeline)$/.test(pLayout || '') ? pLayout : 'force', true);
		if (THUMB || reducedMotion) {
			// settle synchronously so the first paint is the finished sky
			var guard = 0; while (!sim.settled() && guard++ < 600) sim.tick();
			autoFit = false;
			var fit = fitCamera(false);
			if (THUMB) {
				// the card image: closer in, cropping the outer satellites
				var v = viewRect(), mx = v.x + v.w / 2, my = v.y + v.h / 2 - 8;
				var wx = (mx - W / 2 - fit.x) / fit.k, wy = (my - W * 0 - H / 2 - fit.y) / fit.k;
				fit.k *= 1.45; fit.x = mx - W / 2 - wx * fit.k; fit.y = my - H / 2 - wy * fit.k;
			}
			flyTo(fit, 0);
			render();
			if (THUMB) { updateStatus(); return; }
		} else {
			cam = fitCamera(true); cam.k = Math.min(cam.k, 1.4);
		}
		schedule();
		// deep link: ?author=Name flies there once settled
		var want = params.get('author');
		if (want) {
			var key = norm(want), n = graph.nodes.find(function (m) { return norm(m.name) === key; });
			if (n) { if (reducedMotion || THUMB) goTo(n); else setTimeout(function () { goTo(n); }, 1200); }
		}
	}

	window.addEventListener('resize', function () { resize(); schedule(); });
	resize();
	render();

	fetch(DATA_URL).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
		.then(boot)
		.catch(function (err) {
			$('#fallback').classList.add('show');
			statusEl.textContent = 'no data: ' + (err && err.message ? err.message : err);
		});
})();
