// Spine Wall: canvas renderer, tile cache, camera, search, torch, X-ray paints, export.
// Geometry comes from wall.js (SpineWall.build). Everything is drawn in millimetres
// under a canvas transform; tiles are rasterised per zoom level and reused.

(function () {
	'use strict';

	var SW = window.SpineWall;
	var params = new URLSearchParams(location.search);
	var THUMB = params.get('thumb') === '1';
	var reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
	var DPR = Math.min(window.devicePixelRatio || 1, 2);
	var TILE = 256;
	var MAX_TILES = 320;
	var MAX_S = 7;

	var $ = function (s) { return document.querySelector(s); };
	var stage = $('#stage'), canvas = $('#wall'), fx = $('#fx'), ctx = canvas.getContext('2d');
	var mini = $('#minimap'), mctx = mini.getContext('2d');
	var tip = $('#tip'), card = $('#card'), legend = $('#legend'), msg = $('#msg'), measureEl = $('#measure'), whereEl = $('#where');
	var unitIndex = $('#units'), search = $('#find'), hitsEl = $('#hits'), prevBtn = $('#prev'), nextBtn = $('#next');
	var paintSel = $('#paint'), labelsBtn = $('#btn-labels'), helpEl = $('#help');

	var W = null;
	var vw = 1, vh = 1;
	var cam = { cx: 0, cy: 0, s: 1 };
	var minS = 0.05;
	var paint = 'natural', labelsOn = true, gen = 0;
	var selected = null, torch = null, hover = null, authorKey = '';
	var hits = [], hitIndex = -1;
	var tiles = new Map();
	var base = null, baseS = 1;
	var needFrame = false, fly = null, inertia = null;
	var pointers = new Map(), drag = null, pinch = null;
	var itemsByX = [];
	var exporting = false;

	var FONT_SERIF = '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, "Yu Mincho", "Hiragino Mincho ProN", "Noto Serif CJK JP", serif';
	var FONT_SANS = '"Segoe UI", Helvetica, Arial, "Yu Gothic", "Hiragino Sans", "Noto Sans CJK JP", sans-serif';
	var FONT_JA_SERIF = '"Yu Mincho", "Hiragino Mincho ProN", "Noto Serif CJK JP", "MS Mincho", serif';
	var FONT_JA_SANS = '"Yu Gothic", "Meiryo", "Hiragino Sans", "Noto Sans CJK JP", sans-serif';

	// ---- Boot --------------------------------------------------------------
	function boot() {
		fetch('../../assets/data/library.json').then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }).then(function (data) {
			W = SW.build(data);
			itemsByX = W.items.slice().sort(function (a, b) { return a.x - b.x; });
			buildUnitIndex();
			resize();
			fitWall();
			renderBase();
			$('#total').textContent = W.metres.toFixed(1) + ' m';
			$('#count').textContent = data.counts.books + ' books · ' + W.items.length + ' things on ' + W.shelves.length + ' shelves · ' + (W.wallW / 1000).toFixed(1) + ' m of wall';
			msg.hidden = true;
			if (THUMB) thumbState();
			if (params.get('s')) { cam.s = +params.get('s') || cam.s; cam.cx = +params.get('x') || cam.cx; cam.cy = +params.get('y') || cam.cy; clampCam(); }
			if (params.get('paint')) setPaint(params.get('paint'));
			if (params.get('labels') === '0') labelsBtn.click();
			var id = params.get('book');
			if (id) { var it = findById(id); if (it) { selectItem(it, true); flyTo(it, 2.6, true); } }
			requestFrame();
		}).catch(function (err) {
			msg.textContent = 'Could not load the catalogue (../../assets/data/library.json): ' + err.message;
			msg.hidden = false;
		});
	}

	function thumbState() {
		var unit = W.units[0], bay = unit.bays[0];
		var sh = bay.shelves[2]; // "D to I"
		cam.s = 2.8;
		var mid = sh.items[Math.floor(sh.items.length * 0.45)] || sh.items[0];
		cam.cx = mid.x + mid.rw / 2; cam.cy = sh.y + sh.innerH * 0.72;
		clampCam();
		var t = sh.items[Math.floor(sh.items.length * 0.42)];
		torch = t; selected = null;
		search.value = t.b.t;
	}

	// ---- Camera ------------------------------------------------------------
	function resize() {
		var r = stage.getBoundingClientRect();
		vw = Math.max(1, Math.round(r.width)); vh = Math.max(1, Math.round(r.height));
		[canvas, fx].forEach(function (c) { c.width = Math.round(vw * DPR); c.height = Math.round(vh * DPR); c.style.width = vw + 'px'; c.style.height = vh + 'px'; });
		var mr = mini.getBoundingClientRect();
		mini.width = Math.round(mr.width * DPR); mini.height = Math.round(mr.height * DPR);
		if (W) { minS = Math.min(vw / W.wallW, vh / W.wallH) * 0.96; clampCam(); }
		requestFrame();
	}
	function fitWall() { cam.s = minS; cam.cx = W.wallW / 2; cam.cy = W.top + W.wallH / 2; clampCam(); }
	function clampCam() {
		cam.s = Math.max(minS, Math.min(MAX_S, cam.s));
		var halfW = vw / 2 / cam.s, halfH = vh / 2 / cam.s;
		if (W.wallW * cam.s <= vw) cam.cx = W.wallW / 2; else cam.cx = Math.max(halfW, Math.min(W.wallW - halfW, cam.cx));
		if (W.wallH * cam.s <= vh) cam.cy = W.top + W.wallH / 2; else cam.cy = Math.max(W.top + halfH, Math.min(W.bottom - halfH, cam.cy));
	}
	function toScreen(wx, wy) { return [(wx - cam.cx) * cam.s + vw / 2, (wy - cam.cy) * cam.s + vh / 2]; }
	function toWorld(sx, sy) { return [(sx - vw / 2) / cam.s + cam.cx, (sy - vh / 2) / cam.s + cam.cy]; }
	function zoomAt(factor, sx, sy) {
		var before = toWorld(sx, sy);
		cam.s = Math.max(minS, Math.min(MAX_S, cam.s * factor));
		var after = toWorld(sx, sy);
		cam.cx += before[0] - after[0]; cam.cy += before[1] - after[1];
		clampCam(); requestFrame();
	}
	function flyTo(it, targetS, instant) {
		var s = Math.max(cam.s, targetS || 2.4);
		var cx = it.x + it.rw / 2, cy = it.y + it.rh / 2;
		flyCam(cx, cy, s, instant);
	}
	function flyCam(cx, cy, s, instant) {
		inertia = null;
		if (instant || reducedMotion) { cam.cx = cx; cam.cy = cy; cam.s = s; clampCam(); requestFrame(); return; }
		var from = { cx: cam.cx, cy: cam.cy, s: cam.s };
		var dist = Math.hypot(cx - from.cx, cy - from.cy) * Math.min(from.s, s);
		fly = { from: from, to: { cx: cx, cy: cy, s: s }, t0: performance.now(), dur: Math.min(1100, 420 + dist * 0.25 + Math.abs(Math.log(s / from.s)) * 160) };
		requestFrame();
	}
	function stepFly(now) {
		if (!fly) return;
		var t = Math.min(1, (now - fly.t0) / fly.dur);
		var e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
		var a = fly.from, b = fly.to;
		cam.s = Math.exp(Math.log(a.s) + (Math.log(b.s) - Math.log(a.s)) * e);
		cam.cx = a.cx + (b.cx - a.cx) * e; cam.cy = a.cy + (b.cy - a.cy) * e;
		clampCam();
		if (t >= 1) fly = null;
	}
	function stepInertia(now) {
		if (!inertia) return;
		var dt = Math.min(50, now - inertia.t); inertia.t = now;
		var k = Math.exp(-dt / 220);
		cam.cx -= inertia.vx * dt / cam.s; cam.cy -= inertia.vy * dt / cam.s;
		inertia.vx *= k; inertia.vy *= k;
		clampCam();
		if (Math.hypot(inertia.vx, inertia.vy) < 0.01) inertia = null;
	}

	// ---- Paints (X-ray) ----------------------------------------------------
	function paintColour(it) {
		if (paint === 'natural') return null;
		var b = it.b;
		if (!it.isBook) return '#2b2927';
		switch (paint) {
			case 'genre': { var h = SW.GENRE_HUE[b.g]; return (h == null || b.g === 'Unidentified') ? '#4a4846' : SW.hsl(h, 58, 48); }
			case 'lang': { var l = b.l || ''; if (l === 'EN') return SW.hsl(214, 60, 50); if (l === 'JA') return SW.hsl(354, 62, 50); if (/\//.test(l)) return SW.hsl(290, 45, 52); return SW.hsl(42, 70, 50); }
			case 'era': return b.y ? SW.eraColour(SW.eraOf(b.y)) : '#3a3836';
			case 'free': return b.free ? '#e2b93b' : '#3a3836';
			case 'author': return (authorKey && authorOf(b) === authorKey) ? '#ff7a59' : '#3a3836';
		}
		return null;
	}
	function authorOf(b) { return SW.foldAccents((b.a || '').split(/[,/(]|訳| and | & /)[0].trim()); }
	function contrastInk(colour) {
		var m = /hsl\((\d+) (\d+)% (\d+)%\)/.exec(colour);
		if (m) return parseInt(m[3], 10) < 48 ? '#f3eee3' : '#161412';
		var mm = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(colour);
		if (!mm) return '#161412';
		var l = (0.2126 * parseInt(mm[1], 16) + 0.7152 * parseInt(mm[2], 16) + 0.0722 * parseInt(mm[3], 16)) / 255;
		return l < 0.45 ? '#f3eee3' : '#161412';
	}
	function setPaint(mode) {
		paint = mode; paintSel.value = mode; gen++; tiles.clear(); renderBase(); updateLegend(); requestFrame();
	}
	function updateLegend() {
		legend.innerHTML = '';
		if (paint === 'natural') { legend.hidden = true; return; }
		legend.hidden = false;
		function sw(colour, label) { var d = document.createElement('span'); d.className = 'sw'; var i = document.createElement('i'); i.style.background = colour; d.appendChild(i); d.appendChild(document.createTextNode(label)); legend.appendChild(d); }
		if (paint === 'genre') {
			var counts = {}; W.items.forEach(function (it) { if (it.isBook) counts[it.b.g] = (counts[it.b.g] || 0) + 1; });
			Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; }).forEach(function (g) { sw(SW.GENRE_HUE[g] != null && g !== 'Unidentified' ? SW.hsl(SW.GENRE_HUE[g], 58, 48) : '#4a4846', g + ' ' + counts[g]); });
		} else if (paint === 'lang') { sw(SW.hsl(214, 60, 50), 'English'); sw(SW.hsl(354, 62, 50), 'Japanese'); sw(SW.hsl(290, 45, 52), 'Bilingual'); sw(SW.hsl(42, 70, 50), 'Other'); }
		else if (paint === 'era') { SW.ERAS.forEach(function (e) { sw(SW.eraColour(e), e); }); sw('#3a3836', 'no year'); }
		else if (paint === 'free') { sw('#e2b93b', 'free e-text (Gutenberg / Aozora)'); sw('#3a3836', 'no free text'); }
		else if (paint === 'author') { sw('#ff7a59', authorKey ? 'same author as the selected book: ' + (selected ? selected.b.a : '') : 'select a book to light its author'); }
	}

	// ---- Painting the world (mm units under a transform) --------------------
	function paintWorld(c, x0, y0, x1, y1, s) {
		// room: wall and floor
		c.fillStyle = '#211c19'; c.fillRect(x0, y0, x1 - x0, y1 - y0);
		if (y1 > -400) { var g = c.createLinearGradient(0, -400, 0, 0); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.25)'); c.fillStyle = g; c.fillRect(x0, Math.max(y0, -400), x1 - x0, Math.min(y1, 0) - Math.max(y0, -400)); }
		if (y1 > 0) { c.fillStyle = '#17120f'; c.fillRect(x0, 0, x1 - x0, y1); c.fillStyle = '#2d2420'; c.fillRect(x0, 0, x1 - x0, 2.5); }
		var dim = paint !== 'natural';
		W.units.forEach(function (u) {
			if (u.x + u.w < x0 - 50 || u.x > x1 + 50) return;
			var wood = W.woods[u.wood];
			u.bays.forEach(function (bay) {
				if (bay.x + bay.w < x0 || bay.x > x1) return;
				drawBay(c, bay, u, wood, s, dim);
			});
		});
		// items (sorted by x; widest item is 300 mm)
		var lo = lowerBound(itemsByX, x0 - 320);
		for (var i = lo; i < itemsByX.length; i++) {
			var it = itemsByX[i];
			if (it.x > x1) break;
			if (it.x + it.rw < x0 || it.y > y1 + 20 || it.y + it.rh < y0 - 20) continue;
			drawItem(c, it, s);
		}
		if (dim) { c.fillStyle = 'rgba(12,11,10,0.0)'; }
	}
	function lowerBound(arr, x) { var lo = 0, hi = arr.length; while (lo < hi) { var m = (lo + hi) >> 1; if (arr[m].x < x) lo = m + 1; else hi = m; } return lo; }

	var SIDE = 18, BOARD = 18, PLINTH = 40;
	function drawBay(c, bay, u, wood, s, dim) {
		var x = bay.x, w = bay.w, top = bay.caseTop, h = bay.caseH;
		var isWire = u.wood === 'wire', isDesk = u.wood === 'desk', isBox = u.wood === 'cardboard';
		if (isWire) {
			c.strokeStyle = wood.face; c.lineWidth = 5; c.strokeRect(x + 4, top + 4, w - 8, h - 8);
			bay.shelves.forEach(function (sh) {
				c.fillStyle = wood.face; c.fillRect(x, sh.boardY, w, 6);
				if (s >= 0.8) { c.fillStyle = wood.grain; for (var gx = x + 10; gx < x + w - 6; gx += 14) c.fillRect(gx, sh.boardY, 2, 6); }
				labelPlate(c, sh, s, wood, true);
			});
			plinthPlate(c, bay, u, wood, s, true);
			return;
		}
		if (isDesk) {
			// a desk: top slab, two legs, no back
			var sh0 = bay.shelves[0];
			c.fillStyle = wood.face; c.fillRect(x, sh0.boardY, w, 26);
			c.fillStyle = wood.edge; c.fillRect(x, sh0.boardY + 26, w, 4);
			c.fillStyle = wood.dark; c.fillRect(x + 20, sh0.boardY + 30, 40, -(sh0.boardY + 30)); c.fillRect(x + w - 60, sh0.boardY + 30, 40, -(sh0.boardY + 30));
			c.fillStyle = 'rgba(0,0,0,0.25)'; c.fillRect(x + 20, sh0.boardY + 30, w - 40, 3);
			labelPlate(c, sh0, s, wood, false, 26);
			plinthPlate(c, bay, u, wood, s);
			return;
		}
		// back panel (interior)
		c.fillStyle = wood.dark; c.fillRect(x, top, w, h);
		c.fillStyle = 'rgba(0,0,0,0.35)'; c.fillRect(x + SIDE, top, w - SIDE * 2, h - PLINTH);
		// sides, top board, plinth
		c.fillStyle = wood.face;
		c.fillRect(x, top, SIDE, h); c.fillRect(x + w - SIDE, top, SIDE, h); c.fillRect(x, top, w, 18);
		c.fillStyle = wood.edge; c.fillRect(x, -PLINTH, w, PLINTH);
		c.fillStyle = 'rgba(0,0,0,0.22)'; c.fillRect(x + SIDE - 2, top, 2, h); c.fillRect(x + w - SIDE, top, 2, h);
		if (isBox) { c.fillStyle = wood.edge; c.fillRect(x, top, w, 6); c.fillRect(x + w / 2 - 1, top, 2, h - PLINTH); }
		bay.shelves.forEach(function (sh) {
			if (sh.top) return;
			c.fillStyle = wood.face; c.fillRect(x + SIDE - 1, sh.boardY, w - SIDE * 2 + 2, BOARD);
			c.fillStyle = wood.edge; c.fillRect(x + SIDE - 1, sh.boardY + BOARD - 3, w - SIDE * 2 + 2, 3);
			c.fillStyle = 'rgba(0,0,0,0.3)'; c.fillRect(x + SIDE, sh.boardY - 2, w - SIDE * 2, 2); // shadow under the books
			if (s >= 1.4 && /pine|oak|maple|walnut|cherry|desk/.test(u.wood)) grain(c, x + SIDE, sh.boardY + 2, w - SIDE * 2, BOARD - 5, wood.grain, SW.hash(sh.name + u.k));
			labelPlate(c, sh, s, wood, false);
		});
		if (s >= 1.4 && /pine|oak|maple|walnut|cherry/.test(u.wood)) { grain(c, x + 2, top + 20, SIDE - 4, h - 60, wood.grain, SW.hash(u.k + bay.x), true); grain(c, x + w - SIDE + 2, top + 20, SIDE - 4, h - 60, wood.grain, SW.hash(u.k + bay.x + 'r'), true); }
		plinthPlate(c, bay, u, wood, s);
		if (dim) { c.fillStyle = 'rgba(8,8,10,0.45)'; c.fillRect(x, top, w, h); }
	}
	function grain(c, x, y, w, h, colour, seed, vertical) {
		var r = SW.rng(seed); c.fillStyle = colour; c.globalAlpha = 0.5;
		var n = 3 + Math.floor(r() * 3);
		for (var i = 0; i < n; i++) {
			if (vertical) { var gx = x + r() * w; c.fillRect(gx, y + r() * h * 0.3, 0.6, h * (0.4 + r() * 0.5)); }
			else { var gy = y + r() * h; c.fillRect(x + r() * w * 0.3, gy, w * (0.4 + r() * 0.6), 0.6); }
		}
		c.globalAlpha = 1;
	}
	function labelPlate(c, sh, s, wood, wire, boardH) {
		if (s < 0.5) return;
		var bh = boardH || (wire ? 6 : BOARD);
		var px = sh.labelX + 6, py = sh.boardY + (wire ? bh + 2 : 3), ph = wire ? 12 : bh - 6;
		c.font = (ph * 0.62) + 'px ' + FONT_SANS; c.textBaseline = 'middle'; c.textAlign = 'left';
		var text = sh.name;
		var tw = s >= 1 ? c.measureText(text).width : 40;
		var pw = Math.max(26, tw + 7);
		var g = c.createLinearGradient(px, py, px, py + ph); g.addColorStop(0, '#e4c777'); g.addColorStop(0.5, '#c09b4a'); g.addColorStop(1, '#a37f36');
		c.fillStyle = g; c.fillRect(px, py, pw, ph);
		c.fillStyle = 'rgba(0,0,0,0.35)'; c.fillRect(px, py + ph - 0.6, pw, 0.6);
		if (s >= 1) { c.fillStyle = '#2a1f0c'; c.fillText(text, px + 3.5, py + ph / 2 + 0.2); }
		if (s >= 2) { c.fillStyle = '#5b4716'; c.beginPath(); c.arc(px + 1.6, py + ph / 2, 0.5, 0, 6.3); c.arc(px + pw - 1.6, py + ph / 2, 0.5, 0, 6.3); c.fill(); }
	}
	function plinthPlate(c, bay, u, wood, s, wire) {
		if (!bay.first || s < 0.25) return;
		var y = wire ? -PLINTH + 10 : -PLINTH / 2;
		var size = Math.min(16, Math.max(9, 11));
		c.font = '600 ' + size + 'px ' + FONT_SERIF; c.textBaseline = 'middle'; c.textAlign = 'left';
		var text = u.name.toUpperCase();
		var tw = c.measureText(text).width;
		if (wire || u.wood === 'desk') { c.fillStyle = 'rgba(0,0,0,0.5)'; c.fillRect(bay.x + 8, y - size * 0.8, tw + 22 + size * 2, size * 1.6); }
		c.fillStyle = wood.ink; c.fillText(text, bay.x + 14, y);
		if (s >= 0.6) { c.font = '500 ' + (size * 0.78) + 'px ' + FONT_SANS; c.fillStyle = wood.ink; c.globalAlpha = 0.75; c.fillText('·  ' + u.k + '  ·  ' + u.books + ' books', bay.x + 14 + tw + 6, y + 0.5); c.globalAlpha = 1; }
	}

	// ---- Items --------------------------------------------------------------
	function drawItem(c, it, s) {
		c.save();
		if (it.c.kind === 'boardgame') { c.translate(it.x, it.y); drawBoardgame(c, it, s); c.restore(); return; }
		if (it.flat) { c.translate(it.x, it.y + it.rh); c.rotate(-Math.PI / 2); }
		else c.translate(it.x, it.y);
		if (it.isBook) drawBook(c, it, s); else drawObject(c, it, s);
		c.restore();
	}

	function drawBook(c, it, s) {
		var w = it.w, h = it.h, st = it.s, k = it.c, pc = paintColour(it);
		var base = pc || st.base, ink = pc ? contrastInk(pc) : st.ink;
		c.fillStyle = base; c.fillRect(0, 0, w, h);
		if (s < 0.3) return;
		// rounded spine shading
		var e = Math.min(1.6, w * 0.1);
		c.fillStyle = 'rgba(255,255,255,0.16)'; c.fillRect(0, 0, e, h);
		c.fillStyle = 'rgba(0,0,0,0.3)'; c.fillRect(w - e, 0, e, h);
		c.fillStyle = 'rgba(0,0,0,0.22)'; c.fillRect(0, 0, w, 0.8);
		if (st.finish === 'gloss' && !pc) { c.fillStyle = 'rgba(255,255,255,0.17)'; c.fillRect(w * 0.18, 0, Math.max(0.6, w * 0.1), h); }
		if (st.finish === 'cloth' && !pc && s >= 2.8) { c.fillStyle = 'rgba(0,0,0,0.06)'; for (var y = 1.5; y < h; y += 1.1) c.fillRect(e, y, w - 2 * e, 0.4); }
		if (!pc && s >= 0.45) decorate(c, it, w, h, st, k, s);
		if (s >= 0.8 && labelsOn) spineText(c, it, w, h, ink, s, it.flat);
		if (s >= 1.2 && !pc) {
			if (st.wear === 'fade') { var g = c.createLinearGradient(0, 0, 0, h * 0.2); g.addColorStop(0, 'rgba(255,255,255,0.16)'); g.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = g; c.fillRect(0, 0, w, h * 0.2); }
			if (st.wear === 'scuff') { c.fillStyle = 'rgba(255,255,255,0.22)'; c.fillRect(w * 0.1, h - 6 - (SW.hash(it.id) % 30), w * 0.8, 0.7); c.fillRect(0, h * 0.4 + (SW.hash(it.id) % 40), e * 1.5, 7); }
			if (st.tab) { c.fillStyle = st.tab; c.fillRect(w * 0.28, -5, Math.max(1.5, w * 0.4), 6.5); }
			if (st.ribbon) { c.fillStyle = st.ribbon; c.fillRect(w * 0.6, h - 1, 1.3, 12); }
		}
		if (s >= 1.6 && it.shelfRef && it.shelfRef.bay && W.units.some(function (u) { return u.k === it.unit && u.labels; }) && !pc) callLabel(c, it, w, h, s);
	}

	function decorate(c, it, w, h, st, k, s) {
		var b = it.b;
		switch (k.look) {
			case 'hc': {
				c.fillStyle = SW.GOLD; c.fillRect(0, h * 0.075, w, 0.9); c.fillRect(0, h * 0.09, w, 0.5); c.fillRect(0, h * 0.905, w, 0.5); c.fillRect(0, h * 0.92, w, 0.9);
				c.fillRect(0, h * 0.78, w, 0.5); c.fillRect(0, h * 0.84, w, 0.5);
				if (s >= 1.4 && k.vol) { c.font = '600 ' + Math.min(w * 0.5, 9) + 'px ' + FONT_SERIF; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = SW.GOLD; c.fillText(k.vol, w / 2, h * 0.81); }
				break;
			}
			case 'bunko': c.fillStyle = st.band; c.fillRect(0, 0, w, h * 0.055); c.fillRect(0, h * 0.93, w, h * 0.012); break;
			case 'mangabunko': c.fillStyle = st.band; c.fillRect(0, h * 0.86, w, h * 0.14); volumeBox(c, k, w, h, s, '#fff', '#111', 0.93); break;
			case 'lnbunko': c.fillStyle = st.accent; c.fillRect(0, h * 0.87, w, h * 0.13); c.fillStyle = 'rgba(255,255,255,0.85)'; c.fillRect(w * 0.2, h * 0.895, w * 0.6, h * 0.08); if (s >= 1.6 && k.vol) { c.font = '700 ' + Math.min(w * 0.6, 7) + 'px ' + FONT_SANS; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = '#111'; c.fillText(k.vol, w / 2, h * 0.935); } break;
			case 'tankobon': c.fillStyle = st.accent; c.fillRect(0, 0, w, h * 0.065); c.fillStyle = 'rgba(0,0,0,0.18)'; c.fillRect(0, h * 0.065, w, 0.6); volumeBox(c, k, w, h, s, '#fff', '#111', 0.925); break;
			case 'enmanga': case 'comic': case 'enln': c.fillStyle = st.accent; c.fillRect(0, h * 0.84, w, h * 0.16); if (s >= 1.6 && k.vol) { c.font = '700 ' + Math.min(w * 0.55, 7.5) + 'px ' + FONT_SANS; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = contrastInk(st.accent); c.fillText(k.vol, w / 2, h * 0.92); } break;
			case 'penguinclassic': c.fillStyle = st.accent; c.beginPath(); c.ellipse(w / 2, h * 0.955, Math.min(w * 0.28, 3), Math.min(w * 0.4, 4.5), 0, 0, 6.3); c.fill(); break;
			case 'penguin': c.fillStyle = st.band; c.fillRect(0, 0, w, h * 0.3); c.fillRect(0, h * 0.7, w, h * 0.3); break;
			case 'owc': c.fillStyle = st.band; c.fillRect(0, h * 0.88, w, h * 0.12); break;
			case 'vintage': c.fillStyle = st.accent; c.fillRect(0, h * 0.945, w, h * 0.055); break;
			case 'modernlib': c.fillStyle = SW.GOLD; c.fillRect(w * 0.35, h * 0.93, w * 0.3, h * 0.035); c.fillRect(0, h * 0.1, w, 0.6); break;
			case 'leather': case 'bbt': c.fillStyle = SW.GOLD; c.fillRect(0, h * 0.06, w, 0.7); c.fillRect(0, h * 0.11, w, 0.4); c.fillRect(0, h * 0.89, w, 0.4); c.fillRect(0, h * 0.94, w, 0.7); break;
			case 'dover': c.fillStyle = st.band; c.fillRect(0, 0, w, h * 0.1); break;
			case 'norton': c.fillStyle = st.band; c.fillRect(0, h * 0.9, w, h * 0.045); break;
			case 'ati': c.fillStyle = st.band; c.fillRect(0, 0, w, h * 0.1); c.fillRect(0, h * 0.88, w, h * 0.12); break;
			case 'textbook': case 'dictionary': c.fillStyle = st.accent; c.fillRect(0, h * 0.9, w, h * 0.1); break;
			case 'art': case 'magazine': c.fillStyle = st.accent; c.fillRect(0, 0, w, h * 0.04); break;
			case 'anthology': c.fillStyle = st.band; c.fillRect(0, h * 0.86, w, h * 0.05); break;
			default: if (st.accent) { c.fillStyle = st.accent; c.fillRect(0, h * 0.94, w, h * 0.012); c.fillRect(0, h * 0.045, w, h * 0.012); }
		}
	}
	function volumeBox(c, k, w, h, s, bg, ink, cy) {
		if (!k.vol || s < 1.4) return;
		var size = Math.min(w * 0.78, 11);
		c.fillStyle = bg; c.fillRect(w / 2 - size / 2, h * cy - size / 2, size, size);
		c.font = '700 ' + (size * 0.68) + 'px ' + FONT_SANS; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = ink;
		c.fillText(k.vol, w / 2, h * cy + 0.3);
	}
	var CALL = { 'Literature (English & European)': 'PR', 'Japanese literature': 'PL', 'Manga & comics': 'PN', 'Light novels': 'PL', 'Writing, film & literary craft': 'PN', 'History & biography': 'D', 'Philosophy & political theory': 'B', 'Religion & theology': 'BL', 'Society, culture & ideas': 'HM', 'Politics, law & current affairs': 'JK', 'Psychology, self-help & business': 'BF', 'Art & visual culture': 'N', 'Music & opera': 'ML', 'Language study & reference': 'PE', 'Test prep & study guides': 'LB', 'Math, CS & engineering': 'QA', 'Science': 'Q', 'Nursing & medical': 'RT', 'Magazines & catalogues': 'AP', 'Occult & folklore': 'BF' };
	function callLabel(c, it, w, h, s) {
		var lw = Math.min(w * 0.8, 14), lh = Math.min(14, Math.max(8, w * 0.9));
		c.fillStyle = '#f7f4ec'; c.fillRect(w / 2 - lw / 2, h * 0.78, lw, lh);
		if (s >= 3) {
			var code = (CALL[it.b.g] || 'Z') + ' ' + (1000 + SW.hash(it.id) % 9000);
			c.fillStyle = '#222'; c.font = (lh * 0.3) + 'px ' + FONT_SANS; c.textAlign = 'center'; c.textBaseline = 'middle';
			c.fillText(code.split(' ')[0], w / 2, h * 0.78 + lh * 0.3); c.fillText(code.split(' ')[1], w / 2, h * 0.78 + lh * 0.68);
		}
	}

	function spineText(c, it, w, h, ink, s, flat) {
		var b = it.b, k = it.c, st = it.s;
		var title = k.look === 'hc' ? 'HARVARD CLASSICS' : (b.t || '');
		var author = k.look === 'hc' ? (b.t.split(':')[1] || '').trim() : (b.a || '');
		if (!title) return;
		var ja = SW.hasCJK(title);
		var fontMm = Math.min(w * (ja ? 0.62 : 0.46), ja ? 9 : 8.5);
		fontMm = Math.min(fontMm, w * 0.82);
		if (fontMm * s < (ja ? 5 : 4.6)) return;
		var pad = Math.max(4, h * 0.04);
		var showAuthor = author && s >= 1.5 && h > 110 && fontMm > 2.4;
		var authorMm = Math.min(fontMm * 0.72, 4.5);
		var reserved = reservedBottom(k) * h; // volume boxes etc.
		var total = h - pad - reserved - 3;
		var avail = total;
		var weight = (k.look === 'hc' || k.look === 'leather' || k.look === 'bbt') ? '600 ' : (st.titleFont === 'sans' ? '600 ' : '500 ');
		var family = ja ? (st.titleFont === 'sans' ? FONT_JA_SANS : FONT_JA_SERIF) : (st.titleFont === 'sans' ? FONT_SANS : FONT_SERIF);
		c.fillStyle = ink;
		if (ja && !flat) {
			var achars = null, astep = authorMm * 1.08;
			if (showAuthor) { achars = Array.from(author.replace(/\s*[(/,、].*$/, '')).slice(0, 7); avail = total - achars.length * astep - 6; }
			c.font = weight + fontMm + 'px ' + family; c.textAlign = 'center'; c.textBaseline = 'top';
			var step = fontMm * 1.06, y = pad, chars = Array.from(title), max = Math.floor(avail / step);
			var n = Math.min(chars.length, max);
			if (n < chars.length) n = Math.max(0, n - 1);
			for (var i = 0; i < n; i++) { var ch = chars[i]; c.fillText(ch === 'ー' ? '｜' : ch, w / 2, y); y += step; }
			if (n < chars.length && max > 0) { c.fillRect(w / 2 - 0.4, y + 1, 0.8, 0.8); c.fillRect(w / 2 - 0.4, y + 3, 0.8, 0.8); c.fillRect(w / 2 - 0.4, y + 5, 0.8, 0.8); }
			if (achars && achars.length) {
				c.font = '400 ' + authorMm + 'px ' + family; var ay = pad + total - achars.length * astep;
				c.globalAlpha = 0.85;
				for (var j = 0; j < achars.length; j++) { c.fillText(achars[j], w / 2, ay); ay += astep; }
				c.globalAlpha = 1;
			}
			return;
		}
		// rotated latin text, reading top to bottom; the author sits at the foot, right-aligned
		c.save();
		c.translate(w / 2, pad); c.rotate(Math.PI / 2);
		var at = '';
		if (showAuthor) {
			c.font = '400 ' + authorMm + 'px ' + family;
			at = fitText(c, author, total * (k.look === 'hc' ? 0.46 : 0.38));
			if (at) avail = total - c.measureText(at).width - 8;
		}
		c.font = weight + fontMm + 'px ' + family; c.textAlign = 'left'; c.textBaseline = 'middle';
		if (c.measureText(title).width > avail) { fontMm *= 0.86; c.font = weight + fontMm + 'px ' + family; } // shrink once before truncating
		var text = fitText(c, title, avail);
		c.fillText(text, 0, 0.2);
		if (at) {
			c.font = '400 ' + authorMm + 'px ' + family; c.textAlign = 'right'; c.globalAlpha = 0.85;
			c.fillText(at, total, 0.2);
			c.globalAlpha = 1;
		}
		c.restore();
	}
	function reservedBottom(k) {
		switch (k.look) { case 'hc': return 0.26; case 'tankobon': case 'mangabunko': return 0.14; case 'lnbunko': return 0.15; case 'enmanga': case 'comic': case 'enln': return 0.17; case 'penguin': return 0.3; case 'owc': return 0.12; case 'ati': return 0.13; case 'textbook': case 'dictionary': return 0.11; case 'anthology': return 0.15; case 'norton': return 0.11; default: return 0.07; }
	}
	function fitText(c, text, avail) {
		if (avail <= 0) return '';
		if (c.measureText(text).width <= avail) return text;
		var lo = 0, hi = text.length;
		while (lo < hi) { var m = (lo + hi + 1) >> 1; if (c.measureText(text.slice(0, m) + '…').width <= avail) lo = m; else hi = m - 1; }
		return lo < 2 ? '' : text.slice(0, lo).replace(/\s+$/, '') + '…';
	}

	// ---- Objects --------------------------------------------------------------
	function drawObject(c, it, s) {
		var w = it.w, h = it.h, st = it.s, k = it.c.kind, pc = paintColour(it), b = it.b;
		var base = pc || st.base;
		var title = (b.t || '').replace(/^\(not a book\)\s*/, '');
		switch (k) {
			case 'cd': c.fillStyle = 'rgba(220,230,240,0.55)'; c.fillRect(0, 0, w, h); c.fillStyle = pc || st.accent; c.fillRect(w * 0.15, h * 0.06, w * 0.7, h * 0.88); c.fillStyle = 'rgba(255,255,255,0.5)'; c.fillRect(0, 0, w * 0.2, h); if (!pc && s >= 1.2 && labelsOn) vtext(c, title, w, h, '#fff', Math.min(w * 0.5, 5)); break;
			case 'dvd': case 'switch': case 'vita': c.fillStyle = base; c.fillRect(0, 0, w, h); c.fillStyle = 'rgba(255,255,255,0.85)'; c.fillRect(w * 0.15, h * 0.04, w * 0.7, h * 0.2); c.fillStyle = 'rgba(0,0,0,0.3)'; c.fillRect(w - 1.5, 0, 1.5, h); if (!pc && s >= 1.2 && labelsOn) vtext(c, title, w, h, k === 'dvd' ? '#fff' : '#fff', Math.min(w * 0.5, 5.5), h * 0.27); break;
			case 'box': {
				c.fillStyle = base; c.fillRect(0, 0, w, h);
				if (!pc) { var g = c.createLinearGradient(0, 0, 0, h * 0.55); g.addColorStop(0, st.accent); g.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = g; c.fillRect(0, 0, w, h * 0.55); c.fillStyle = 'rgba(255,255,255,0.25)'; c.fillRect(0, 0, w * 0.08, h); c.fillStyle = 'rgba(0,0,0,0.3)'; c.fillRect(w - w * 0.08, 0, w * 0.08, h); c.fillStyle = 'rgba(0,0,0,0.18)'; c.fillRect(0, h * 0.86, w, h * 0.14); }
				if (!pc && s >= 0.9 && labelsOn) vtext(c, title.replace(/\s*\(.*$/, ''), w, h, '#1b1816', Math.min(w * 0.42, 9), h * 0.08, h * 0.76);
				break;
			}
			case 'notebook': {
				var n = it.c.count || 1, nw = w / n;
				for (var i = 0; i < n; i++) { c.fillStyle = i === 0 ? base : '#2a2a2a'; c.fillRect(i * nw, 0, nw - 0.5, h); if (s >= 1.5) { c.fillStyle = '#c8c8c8'; for (var y = 4; y < h - 2; y += 6) c.fillRect(i * nw + nw * 0.3, y, nw * 0.4, 1.4); } }
				break;
			}
			case 'folder': c.fillStyle = base; c.fillRect(0, 0, w, h); c.fillStyle = 'rgba(255,255,255,0.3)'; c.fillRect(0, h * 0.3, w, 10); break;
			case 'papers': c.fillStyle = '#eee9df'; c.fillRect(0, 0, w, h); if (s >= 1) { c.fillStyle = 'rgba(0,0,0,0.12)'; for (var py = 2; py < h; py += 2.2) c.fillRect(1 + (SW.hash(it.id + py) % 5), py, w - 4, 0.5); } c.fillStyle = 'rgba(0,0,0,0.2)'; c.fillRect(0, h - 1, w, 1); break;
			case 'headset': {
				c.fillStyle = base; rounded(c, w * 0.05, h * 0.3, w * 0.9, h * 0.65, 14); c.fill();
				c.fillStyle = '#cfcfcb'; rounded(c, w * 0.12, h * 0.38, w * 0.76, h * 0.5, 10); c.fill();
				c.fillStyle = '#2a2a2a'; rounded(c, w * 0.2, h * 0.5, w * 0.6, h * 0.22, 6); c.fill();
				c.strokeStyle = '#3a3a3a'; c.lineWidth = 7; c.beginPath(); c.moveTo(w * 0.12, h * 0.5); c.quadraticCurveTo(w * 0.5, -h * 0.25, w * 0.88, h * 0.5); c.stroke();
				break;
			}
			case 'trophy': {
				// two ribbons with medals, a cup, a plush
				var ribbonCols = ['#1e2a4a', '#c43a3a', '#2f5d3a'];
				for (var ri = 0; ri < 3; ri++) { var rx = w * (0.12 + ri * 0.16); c.fillStyle = ribbonCols[ri]; c.fillRect(rx, 0, 7, h * 0.55); c.fillStyle = SW.GOLD; c.beginPath(); c.arc(rx + 3.5, h * 0.58, 11, 0, 6.3); c.fill(); c.fillStyle = '#8a6a2a'; c.beginPath(); c.arc(rx + 3.5, h * 0.58, 7, 0, 6.3); c.fill(); }
				c.fillStyle = SW.GOLD; c.beginPath(); c.moveTo(w * 0.62, h * 0.35); c.lineTo(w * 0.92, h * 0.35); c.lineTo(w * 0.85, h * 0.7); c.lineTo(w * 0.69, h * 0.7); c.closePath(); c.fill();
				c.fillRect(w * 0.75, h * 0.7, w * 0.04, h * 0.14); c.fillStyle = '#3a2a1a'; c.fillRect(w * 0.66, h * 0.84, w * 0.22, h * 0.16); c.fillStyle = '#4a3a2a'; c.beginPath(); c.arc(w * 0.5, h * 0.84, 14, 0, 6.3); c.fill();
				break;
			}
			case 'cords': c.strokeStyle = '#d8632a'; c.lineWidth = 3; c.beginPath(); c.moveTo(w * 0.3, 0); c.bezierCurveTo(w * 0.1, h * 0.4, w * 0.5, h * 0.6, w * 0.3, h); c.stroke(); c.strokeStyle = '#1e2a4a'; c.beginPath(); c.moveTo(w * 0.6, 0); c.bezierCurveTo(w * 0.8, h * 0.4, w * 0.4, h * 0.6, w * 0.6, h); c.stroke(); c.fillStyle = '#d8632a'; c.fillRect(w * 0.22, h - 14, 12, 14); c.fillStyle = '#1e2a4a'; c.fillRect(w * 0.55, h - 14, 12, 14); break;
			case 'ornament': c.fillStyle = '#e8dcc0'; c.fillRect(w * 0.15, h * 0.4, w * 0.7, h * 0.6); c.fillStyle = '#a2552f'; c.beginPath(); c.moveTo(w * 0.05, h * 0.42); c.lineTo(w * 0.5, 0); c.lineTo(w * 0.95, h * 0.42); c.closePath(); c.fill(); c.fillStyle = '#e2b93b'; c.beginPath(); c.arc(w * 0.7, h * 0.65, 7, 0, 6.3); c.fill(); c.fillStyle = '#5a3a1a'; c.beginPath(); c.arc(w * 0.7, h * 0.65, 3, 0, 6.3); c.fill(); c.fillStyle = '#6b4a2e'; c.fillRect(w * 0.35, h * 0.65, w * 0.18, h * 0.35); break;
			case 'pin': c.fillStyle = base; c.beginPath(); c.arc(w / 2, h / 2, w / 2, 0, 6.3); c.fill(); c.fillStyle = '#fff'; c.beginPath(); c.arc(w / 2, h / 2, w * 0.3, 0, 6.3); c.fill(); break;
			case 'pouch': c.fillStyle = base; rounded(c, 0, h * 0.1, w, h * 0.9, 12); c.fill(); c.fillStyle = '#fff'; c.fillRect(w * 0.1, h * 0.16, w * 0.8, 2.5); c.fillStyle = 'rgba(255,255,255,0.4)'; c.beginPath(); c.arc(w * 0.5, h * 0.6, h * 0.22, 0, 6.3); c.fill(); break;
			case 'calc': c.fillStyle = base; c.fillRect(0, 0, w, h); c.fillStyle = '#fff'; c.fillRect(w * 0.15, h * 0.1, w * 0.7, h * 0.12); if (s >= 1.2 && labelsOn) vtext(c, 'CASIO', w, h, '#fff', Math.min(w * 0.4, 7), h * 0.3); break;
			case 'photopaper': c.fillStyle = base; c.fillRect(0, 0, w, h); c.fillStyle = '#fff'; c.fillRect(w * 0.1, h * 0.1, w * 0.8, h * 0.55); c.fillStyle = '#e2b93b'; c.fillRect(w * 0.1, h * 0.7, w * 0.8, h * 0.08); break;
			default: c.fillStyle = base; c.fillRect(0, 0, w, h); c.fillStyle = 'rgba(255,255,255,0.3)'; c.fillRect(0, 0, w, h * 0.12); if (!pc && s >= 1.2 && labelsOn) vtext(c, title, w, h, '#1b1816', Math.min(w * 0.4, 7), h * 0.16);
		}
	}
	function drawBoardgame(c, it, s) {
		var w = it.rw, h = it.rh, pc = paintColour(it);
		c.fillStyle = pc || '#c43a3a'; c.fillRect(0, 0, w, h);
		c.fillStyle = 'rgba(0,0,0,0.25)'; c.fillRect(0, h - 3, w, 3); c.fillStyle = 'rgba(255,255,255,0.2)'; c.fillRect(0, 0, w, 2);
		if (!pc && s >= 0.6 && labelsOn) { c.fillStyle = '#f5e6c8'; c.font = '700 ' + (h * 0.45) + 'px ' + FONT_SANS; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('CATAN', w / 2, h / 2); }
	}
	function rounded(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.lineTo(x + w - r, y); c.quadraticCurveTo(x + w, y, x + w, y + r); c.lineTo(x + w, y + h - r); c.quadraticCurveTo(x + w, y + h, x + w - r, y + h); c.lineTo(x + r, y + h); c.quadraticCurveTo(x, y + h, x, y + h - r); c.lineTo(x, y + r); c.quadraticCurveTo(x, y, x + r, y); c.closePath(); }
	function vtext(c, text, w, h, ink, fontMm, y0, avail) {
		if (!text) return;
		y0 = y0 || h * 0.1; avail = avail || (h - y0 - h * 0.08);
		c.fillStyle = ink;
		if (SW.hasCJK(text)) {
			c.font = '600 ' + fontMm + 'px ' + FONT_JA_SANS; c.textAlign = 'center'; c.textBaseline = 'top';
			var step = fontMm * 1.06, chars = Array.from(text), n = Math.min(chars.length, Math.floor(avail / step)), y = y0;
			for (var i = 0; i < n; i++) { c.fillText(chars[i] === 'ー' ? '｜' : chars[i], w / 2, y); y += step; }
		} else {
			c.save(); c.translate(w / 2, y0); c.rotate(Math.PI / 2); c.font = '600 ' + fontMm + 'px ' + FONT_SANS; c.textAlign = 'left'; c.textBaseline = 'middle';
			c.fillText(fitText(c, text, avail), 0, 0); c.restore();
		}
	}

	// ---- Tiles --------------------------------------------------------------
	function levelFor(s) { return Math.round(Math.log2(s) * 2); }
	function levelScale(L) { return Math.pow(2, L / 2); }
	function tileFor(L, ix, iy, budgetOk) {
		var key = gen + ':' + L + ':' + ix + ':' + iy;
		var t = tiles.get(key);
		if (t) { tiles.delete(key); tiles.set(key, t); return t; }
		if (!budgetOk) return null;
		var ls = levelScale(L), k = ls * DPR, tw = TILE / k;
		var cv = document.createElement('canvas'); cv.width = TILE; cv.height = TILE;
		var c = cv.getContext('2d');
		c.setTransform(k, 0, 0, k, -ix * TILE, -W.top * k - iy * TILE);
		var x0 = ix * tw, y0 = W.top + iy * tw;
		paintWorld(c, x0, y0, x0 + tw, y0 + tw, ls);
		tiles.set(key, cv);
		if (tiles.size > MAX_TILES) tiles.delete(tiles.keys().next().value);
		return cv;
	}
	function renderBase() {
		if (!W) return;
		var bw = Math.min(4096, Math.ceil(W.wallW * 0.35 * DPR));
		baseS = bw / W.wallW;
		base = document.createElement('canvas'); base.width = bw; base.height = Math.ceil(W.wallH * baseS);
		var c = base.getContext('2d');
		c.setTransform(baseS, 0, 0, baseS, 0, -W.top * baseS);
		paintWorld(c, 0, W.top, W.wallW, W.bottom, baseS / DPR);
	}

	// ---- Frame -------------------------------------------------------------------
	function requestFrame() { if (!needFrame) { needFrame = true; requestAnimationFrame(frame); } }
	function frame(now) {
		needFrame = false;
		if (!W) return;
		stepFly(now); stepInertia(now);
		var L = levelFor(cam.s), ls = levelScale(L), tw = TILE / (ls * DPR);
		var x0 = cam.cx - vw / 2 / cam.s, y0 = cam.cy - vh / 2 / cam.s, x1 = x0 + vw / cam.s, y1 = y0 + vh / cam.s;
		var ix0 = Math.floor(Math.max(0, x0) / tw), ix1 = Math.floor(Math.min(W.wallW, x1) / tw);
		var iy0 = Math.floor(Math.max(0, y0 - W.top) / tw), iy1 = Math.floor(Math.min(W.wallH, y1 - W.top) / tw);
		ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
		ctx.fillStyle = '#211c19'; ctx.fillRect(0, 0, vw, vh);
		if (y1 > 0) { var fy = toScreen(0, 0)[1]; ctx.fillStyle = '#17120f'; ctx.fillRect(0, fy, vw, vh - fy); }
		var missing = [], deadline = performance.now() + (THUMB || exporting ? 1e9 : 9);
		var cxI = (ix0 + ix1) / 2, cyI = (iy0 + iy1) / 2;
		var order = [];
		for (var iy = iy0; iy <= iy1; iy++) for (var ix = ix0; ix <= ix1; ix++) order.push([ix, iy, Math.hypot(ix - cxI, iy - cyI)]);
		order.sort(function (a, b) { return a[2] - b[2]; });
		var drawSize = tw * cam.s;
		order.forEach(function (o) {
			var ix = o[0], iy = o[1];
			var t = tileFor(L, ix, iy, performance.now() < deadline);
			var sp = toScreen(ix * tw, W.top + iy * tw);
			var px = Math.floor(sp[0] * DPR) / DPR, py = Math.floor(sp[1] * DPR) / DPR, sz = Math.ceil(drawSize * DPR + 1) / DPR;
			if (t) ctx.drawImage(t, px, py, sz, sz);
			else {
				missing.push(o);
				if (base) {
					var bx = ix * tw * baseS, by = iy * tw * baseS, bs = tw * baseS;
					ctx.drawImage(base, bx, by, bs, bs, px, py, sz, sz);
				}
			}
		});
		drawFx(ctx);
		drawMinimap();
		updateMeasure();
		updateActiveUnit();
		if (missing.length || fly || inertia) requestFrame();
	}

	function drawFx(fctx) {
		fctx.setTransform(DPR, 0, 0, DPR, 0, 0);
		if (torch) {
			var r = screenRect(torch);
			var cx = r[0] + r[2] / 2, cy = r[1] + r[3] / 2;
			var rad = Math.max(220, r[3] * 1.1, r[2] * 1.6);
			// the dark falls off from the lit spine; the gradient's end colour carries on past the radius
			var g = fctx.createRadialGradient(cx, cy, rad * 0.22, cx, cy, rad);
			g.addColorStop(0, 'rgba(6,5,7,0)'); g.addColorStop(0.45, 'rgba(6,5,7,0.22)'); g.addColorStop(1, 'rgba(6,5,7,0.66)');
			fctx.fillStyle = g; fctx.fillRect(0, 0, vw, vh);
			var g2 = fctx.createRadialGradient(cx, cy, rad * 0.05, cx, cy, rad * 0.6);
			g2.addColorStop(0, 'rgba(255,214,140,0.2)'); g2.addColorStop(1, 'rgba(255,214,140,0)');
			fctx.fillStyle = g2; fctx.fillRect(cx - rad, cy - rad, rad * 2, rad * 2);
			outline(fctx, torch, '#ffd98a', 2);
		}
		if (hover && hover !== torch) outline(fctx, hover, 'rgba(255,255,255,0.8)', 1.5);
		if (selected) outline(fctx, selected, '#8fd3c0', 2);
	}
	function outline(fctx, it, colour, lw) {
		var r = screenRect(it);
		fctx.strokeStyle = colour; fctx.lineWidth = lw; fctx.strokeRect(r[0] - 1, r[1] - 1, r[2] + 2, r[3] + 2);
	}
	function screenRect(it) { var p = toScreen(it.x, it.y); return [p[0], p[1], it.rw * cam.s, it.rh * cam.s]; }

	// ---- Minimap, measure, unit index ----------------------------------------------
	function drawMinimap() {
		var mw = mini.width / DPR, mh = mini.height / DPR;
		mctx.setTransform(DPR, 0, 0, DPR, 0, 0);
		mctx.clearRect(0, 0, mw, mh);
		var k = mw / W.wallW, maxH = -W.top;
		W.units.forEach(function (u) {
			var wood = W.woods[u.wood];
			u.bays.forEach(function (bay) {
				var bh = (bay.h / maxH) * (mh - 14);
				mctx.fillStyle = wood.face; mctx.fillRect(bay.x * k, mh - 4 - bh, Math.max(1, bay.w * k), bh);
				mctx.fillStyle = 'rgba(0,0,0,0.25)'; mctx.fillRect(bay.x * k, mh - 4 - bh, Math.max(1, bay.w * k), 1);
			});
			mctx.fillStyle = 'rgba(236,228,210,0.8)'; mctx.font = '10px ' + FONT_SANS; mctx.textAlign = 'center'; mctx.textBaseline = 'top';
			if (u.w * k > 10) mctx.fillText(u.k, (u.x + u.w / 2) * k, 0);
		});
		var x0 = (cam.cx - vw / 2 / cam.s) * k, x1 = (cam.cx + vw / 2 / cam.s) * k;
		x0 = Math.max(0, x0); x1 = Math.min(mw, x1);
		mctx.fillStyle = 'rgba(143,211,192,0.18)'; mctx.fillRect(x0, 0, Math.max(2, x1 - x0), mh);
		mctx.strokeStyle = '#8fd3c0'; mctx.lineWidth = 1.5; mctx.strokeRect(x0 + 0.75, 0.75, Math.max(2, x1 - x0) - 1.5, mh - 1.5);
	}
	function locate(wx, wy) {
		// which shelf is under the point; returns {unit, shelf, metres}
		var unit = null;
		for (var i = 0; i < W.units.length; i++) { var u = W.units[i]; if (wx >= u.x - 80 && wx <= u.x + u.w + 80) { unit = u; break; } }
		if (!unit) {
			// between units: interpolate metres by x
			var prev = null, next = null;
			for (var j = 0; j < W.units.length; j++) { if (W.units[j].x + W.units[j].w < wx) prev = W.units[j]; else if (!next && W.units[j].x > wx) next = W.units[j]; }
			var m = prev ? prev.m1 : 0;
			return { unit: next || prev, shelf: null, metres: m };
		}
		var best = null, bestD = Infinity;
		unit.bays.forEach(function (bay) {
			bay.shelves.forEach(function (sh) {
				var dx = wx < bay.x ? bay.x - wx : wx > bay.x + bay.w ? wx - bay.x - bay.w : 0;
				var cy = sh.y + sh.innerH / 2, dy = Math.abs(wy - cy) - sh.innerH / 2;
				var d = Math.max(0, dy) + dx * 2;
				if (d < bestD) { bestD = d; best = sh; }
			});
		});
		if (!best) return { unit: unit, shelf: null, metres: unit.m0 };
		var frac = Math.max(0, Math.min(1, (wx - best.x) / best.w));
		var m = best.m0;
		for (var q = 0; q < best.items.length; q++) { var it = best.items[q]; if (it.x + it.rw >= wx) { m = it.m0; break; } m = it.m1; }
		if (wx > best.x + best.w) m = best.m1;
		return { unit: unit, shelf: best, metres: m, frac: frac };
	}
	function updateMeasure() {
		var loc = locate(cam.cx, cam.cy);
		var here = loc.metres / 1000;
		measureEl.textContent = 'You are ' + here.toFixed(1) + ' m into ' + W.metres.toFixed(1) + ' m of shelf';
		var where = loc.unit ? loc.unit.name + (loc.shelf ? ' · ' + loc.shelf.name : '') : '';
		whereEl.textContent = where + ' · wall ' + (cam.cx / 1000).toFixed(1) + ' m of ' + (W.wallW / 1000).toFixed(1) + ' m · ' + (cam.s >= 1 ? cam.s.toFixed(1) + ' px/mm' : (cam.s * 1000).toFixed(0) + ' px/m');
	}
	var lastActive = '';
	function updateActiveUnit() {
		var loc = locate(cam.cx, cam.cy);
		var k = loc.unit ? loc.unit.k : '';
		if (k === lastActive) return;
		lastActive = k;
		Array.prototype.forEach.call(unitIndex.children, function (b) { b.classList.toggle('on', b.dataset.k === k); });
	}
	function buildUnitIndex() {
		unitIndex.innerHTML = '';
		W.units.forEach(function (u, i) {
			var b = document.createElement('button');
			b.textContent = u.k; b.dataset.k = u.k; b.title = u.name + ' · ' + u.books + ' books\n' + u.desc;
			b.addEventListener('click', function () { flyToUnit(u); });
			unitIndex.appendChild(b);
		});
	}
	function flyToUnit(u) {
		var s = Math.min(MAX_S, Math.max(minS, Math.min(vw / (u.w + 160), vh / (u.h + 240))));
		flyCam(u.x + u.w / 2, -u.h / 2 - 20, s);
	}

	// ---- Hit testing, tooltip, card ----------------------------------------------
	function itemAt(sx, sy) {
		var p = toWorld(sx, sy), wx = p[0], wy = p[1];
		var lo = lowerBound(itemsByX, wx - 320);
		var hit = null;
		for (var i = lo; i < itemsByX.length; i++) {
			var it = itemsByX[i];
			if (it.x > wx) break;
			if (wx <= it.x + it.rw && wy >= it.y - 3 && wy <= it.y + it.rh) hit = it;
		}
		return hit;
	}
	function findById(id) { for (var i = 0; i < W.items.length; i++) if (W.items[i].id === id) return W.items[i]; return null; }
	function showTip(it, sx, sy) {
		if (!it) { tip.hidden = true; return; }
		var b = it.b;
		var title = (b.t || '').replace(/^\(not a book\)\s*/, '');
		tip.innerHTML = '<b></b><span></span>';
		tip.firstChild.textContent = title;
		tip.lastChild.textContent = [b.a, b.y, (it.unit + ' · ' + it.shelf + ' · #' + b.p)].filter(Boolean).join(' · ');
		tip.hidden = false;
		var r = stage.getBoundingClientRect();
		var tx = sx + 14, ty = sy + 16;
		if (tx + tip.offsetWidth > r.width - 8) tx = sx - tip.offsetWidth - 10;
		if (ty + tip.offsetHeight > r.height - 8) ty = sy - tip.offsetHeight - 10;
		tip.style.left = Math.max(4, tx) + 'px'; tip.style.top = Math.max(4, ty) + 'px';
	}
	function selectItem(it, quiet) {
		selected = it;
		if (!it) { card.hidden = true; if (paint === 'author') { authorKey = ''; setPaint('author'); } requestFrame(); return; }
		var b = it.b;
		$('#card-title').textContent = (b.t || '').replace(/^\(not a book\)\s*/, '');
		$('#card-by').textContent = [b.a, b.pub, b.yr || b.y].filter(Boolean).join(' · ');
		$('#card-meta').textContent = [b.ty, b.g, SW.langName(b.l), it.isBook ? it.c.thick + ' · ' + Math.round(it.w) + ' × ' + Math.round(it.h) + ' mm (assumed)' : 'object'].filter(Boolean).join(' · ');
		$('#card-desc').textContent = b.d || '';
		var u = W.units.filter(function (x) { return x.k === it.unit; })[0];
		$('#card-loc').textContent = (u ? u.name : it.unit) + ' · shelf ' + it.shelf + ' · position ' + b.p + ' · ' + (it.m0 / 1000).toFixed(2) + ' m along the shelf-metre line';
		var link = $('#card-link'); link.href = '../../#/bookshelf/' + encodeURIComponent(b.id); link.hidden = !it.isBook;
		var fl = $('#card-free'); if (b.free) { fl.hidden = false; fl.href = b.free.url; fl.textContent = 'free e-text (' + (b.free.src === 'gutenberg' ? 'Project Gutenberg' : b.free.src === 'aozora' ? 'Aozora Bunko' : b.free.src) + ')'; } else fl.hidden = true;
		$('#card-author').hidden = !b.a;
		card.hidden = false;
		if (paint === 'author') { authorKey = authorOf(b); setPaint('author'); }
		requestFrame();
	}

	// ---- Search -----------------------------------------------------------------
	function runSearch(q, jump) {
		var f = SW.foldAccents(q.trim());
		hits = []; hitIndex = -1;
		if (f.length >= 1) {
			var exact = [], partial = [];
			W.items.forEach(function (it) {
				var b = it.b, t = SW.foldAccents(b.t), a = SW.foldAccents(b.a || '');
				if (t === f || b.id.toLowerCase() === f) exact.push(it);
				else if (t.indexOf(f) >= 0 || a.indexOf(f) >= 0 || (b.t || '').indexOf(q.trim()) >= 0 || (b.a || '').indexOf(q.trim()) >= 0) partial.push(it);
			});
			hits = exact.concat(partial);
		}
		if (hits.length) { hitIndex = 0; torch = hits[0]; if (jump) flyTo(torch, 2.6); }
		else if (!f) torch = null;
		else torch = null;
		updateHits();
		requestFrame();
	}
	function stepHit(dir) {
		if (!hits.length) return;
		hitIndex = (hitIndex + dir + hits.length) % hits.length;
		torch = hits[hitIndex]; flyTo(torch, 2.6); updateHits(); requestFrame();
	}
	function updateHits() {
		hitsEl.textContent = hits.length ? (hitIndex + 1) + ' / ' + hits.length : (search.value.trim() ? 'no match' : '');
		prevBtn.disabled = nextBtn.disabled = hits.length < 2;
	}

	// ---- Export ---------------------------------------------------------------------
	function exportView() {
		var cv = document.createElement('canvas'); cv.width = Math.round(vw * DPR); cv.height = Math.round(vh * DPR);
		var c = cv.getContext('2d');
		var k = cam.s * DPR;
		c.setTransform(k, 0, 0, k, (vw / 2 - cam.cx * cam.s) * DPR, (vh / 2 - cam.cy * cam.s) * DPR);
		var x0 = cam.cx - vw / 2 / cam.s, y0 = cam.cy - vh / 2 / cam.s;
		paintWorld(c, x0, y0, x0 + vw / cam.s, y0 + vh / cam.s, cam.s);
		drawFx(c);
		stamp(c, cv.width, cv.height);
		download(cv, 'spine-wall-view.png');
	}
	function exportWall() {
		if (exporting) return;
		exporting = true;
		var maxW = 16000, area = 64e6;
		var s = Math.min(1.5, Math.sqrt(area / (W.wallW * W.wallH)));
		var fullW = Math.ceil(W.wallW * s), strips = Math.ceil(fullW / maxW);
		var stripW = Math.ceil(fullW / strips), stripH = Math.ceil(W.wallH * s) + 2;
		var cv = document.createElement('canvas'); cv.width = stripW; cv.height = stripH * strips;
		var c = cv.getContext('2d');
		if (!c) { exporting = false; return; }
		var btn = $('#btn-export-wall'), label = btn.textContent, i = 0;
		function step() {
			btn.textContent = 'rendering ' + (i + 1) + ' / ' + strips + '…';
			var x0 = i * stripW / s;
			c.setTransform(s, 0, 0, s, -x0 * s, -W.top * s + i * stripH);
			paintWorld(c, x0, W.top, x0 + stripW / s, W.bottom, s);
			c.setTransform(1, 0, 0, 1, 0, 0);
			c.fillStyle = '#0b0a09'; c.fillRect(0, (i + 1) * stripH - 2, stripW, 2);
			i++;
			if (i < strips) requestAnimationFrame(step);
			else { stamp(c, stripW, stripH * strips); btn.textContent = 'saving…'; download(cv, 'spine-wall.png', function () { btn.textContent = label; exporting = false; }); }
		}
		requestAnimationFrame(step);
	}
	function stamp(c, w, h) {
		c.setTransform(1, 0, 0, 1, 0, 0);
		c.font = (12 * DPR) + 'px ' + FONT_SANS; c.textAlign = 'right'; c.textBaseline = 'bottom';
		c.fillStyle = 'rgba(236,228,210,0.7)'; c.fillText('Spine Wall · ' + W.metres.toFixed(1) + ' m of books · nietztein.github.io', w - 10 * DPR, h - 8 * DPR);
	}
	function download(cv, name, done) {
		cv.toBlob(function (blob) {
			if (!blob) { if (done) done(); return; }
			var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
			setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); if (done) done(); }, 1500);
		}, 'image/png');
	}

	// ---- Input ---------------------------------------------------------------------
	function stagePos(e) { var r = stage.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
	fx.addEventListener('pointerdown', function (e) {
		if (!W) return;
		fx.setPointerCapture(e.pointerId);
		var p = stagePos(e);
		pointers.set(e.pointerId, p);
		inertia = null; fly = null;
		if (pointers.size === 1) drag = { x: p[0], y: p[1], sx: p[0], sy: p[1], t: performance.now(), vx: 0, vy: 0, moved: false };
		else if (pointers.size === 2) { var ps = Array.from(pointers.values()); pinch = { d: Math.hypot(ps[0][0] - ps[1][0], ps[0][1] - ps[1][1]), mx: (ps[0][0] + ps[1][0]) / 2, my: (ps[0][1] + ps[1][1]) / 2 }; drag = null; }
		tip.hidden = true;
	});
	fx.addEventListener('pointermove', function (e) {
		if (!W) return;
		var p = stagePos(e);
		if (pointers.has(e.pointerId)) pointers.set(e.pointerId, p);
		if (pinch && pointers.size === 2) {
			var ps = Array.from(pointers.values());
			var d = Math.hypot(ps[0][0] - ps[1][0], ps[0][1] - ps[1][1]), mx = (ps[0][0] + ps[1][0]) / 2, my = (ps[0][1] + ps[1][1]) / 2;
			if (pinch.d > 0) zoomAt(d / pinch.d, mx, my);
			cam.cx -= (mx - pinch.mx) / cam.s; cam.cy -= (my - pinch.my) / cam.s; clampCam();
			pinch.d = d; pinch.mx = mx; pinch.my = my; requestFrame(); return;
		}
		if (drag) {
			var now = performance.now(), dt = Math.max(1, now - drag.t);
			var dx = p[0] - drag.x, dy = p[1] - drag.y;
			cam.cx -= dx / cam.s; cam.cy -= dy / cam.s; clampCam();
			drag.vx = 0.7 * drag.vx + 0.3 * (dx / dt); drag.vy = 0.7 * drag.vy + 0.3 * (dy / dt);
			drag.x = p[0]; drag.y = p[1]; drag.t = now;
			if (Math.hypot(p[0] - drag.sx, p[1] - drag.sy) > 4) drag.moved = true;
			requestFrame(); return;
		}
		if (e.pointerType === 'mouse') {
			var it = itemAt(p[0], p[1]);
			if (it !== hover) { hover = it; requestFrame(); }
			showTip(it, p[0], p[1]);
			fx.style.cursor = it ? 'pointer' : 'grab';
		}
	});
	function endPointer(e) {
		if (!W) return;
		var p = stagePos(e);
		pointers.delete(e.pointerId);
		if (pinch) { if (pointers.size < 2) pinch = null; if (pointers.size === 1) { var q = pointers.values().next().value; drag = { x: q[0], y: q[1], sx: q[0], sy: q[1], t: performance.now(), vx: 0, vy: 0, moved: true }; } return; }
		if (drag) {
			if (!drag.moved) {
				var it = itemAt(p[0], p[1]);
				if (it) { selectItem(it); if (e.pointerType !== 'mouse') showTip(it, p[0], p[1]); }
				else { selectItem(null); tip.hidden = true; }
			} else if (performance.now() - drag.t < 80 && Math.hypot(drag.vx, drag.vy) > 0.05) inertia = { vx: drag.vx, vy: drag.vy, t: performance.now() };
			drag = null; requestFrame();
		}
	}
	fx.addEventListener('pointerup', endPointer);
	fx.addEventListener('pointercancel', endPointer);
	fx.addEventListener('pointerleave', function () { if (!drag) { hover = null; tip.hidden = true; requestFrame(); } });
	fx.addEventListener('wheel', function (e) {
		if (!W) return;
		e.preventDefault();
		var p = stagePos(e);
		var mult = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? vh : 1;
		var dx = e.deltaX * mult, dy = e.deltaY * mult;
		inertia = null; fly = null;
		if (e.ctrlKey || e.metaKey || (!e.shiftKey && Math.abs(dy) > Math.abs(dx))) zoomAt(Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0022)), p[0], p[1]);
		else { cam.cx += (e.shiftKey ? dy : dx) / cam.s; clampCam(); requestFrame(); }
	}, { passive: false });
	fx.addEventListener('dblclick', function (e) { var p = stagePos(e); var it = itemAt(p[0], p[1]); if (it) flyTo(it, Math.max(cam.s * 1.6, 3)); else zoomAt(1.8, p[0], p[1]); });

	// minimap
	var miniDrag = false;
	function miniJump(e) { var r = mini.getBoundingClientRect(); var fx_ = (e.clientX - r.left) / r.width; cam.cx = fx_ * W.wallW; clampCam(); requestFrame(); }
	mini.addEventListener('pointerdown', function (e) { if (!W) return; miniDrag = true; mini.setPointerCapture(e.pointerId); fly = null; inertia = null; miniJump(e); });
	mini.addEventListener('pointermove', function (e) { if (miniDrag) miniJump(e); });
	mini.addEventListener('pointerup', function () { miniDrag = false; });
	mini.addEventListener('pointercancel', function () { miniDrag = false; });

	// keyboard
	document.addEventListener('keydown', function (e) {
		if (!W) return;
		var inField = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
		if (e.key === 'Escape') { if (!card.hidden) selectItem(null); else if (torch) { torch = null; search.value = ''; hits = []; updateHits(); } else if (!helpEl.hidden) helpEl.hidden = true; search.blur(); requestFrame(); return; }
		if (inField) { if (e.key === 'Enter' && document.activeElement === search) { e.preventDefault(); if (hits.length) stepHit(e.shiftKey ? -1 : 1); else runSearch(search.value, true); } return; }
		var step = vw * 0.25 / cam.s;
		switch (e.key) {
			case 'ArrowLeft': cam.cx -= step; break;
			case 'ArrowRight': cam.cx += step; break;
			case 'ArrowUp': cam.cy -= vh * 0.25 / cam.s; break;
			case 'ArrowDown': cam.cy += vh * 0.25 / cam.s; break;
			case '+': case '=': zoomAt(1.3, vw / 2, vh / 2); return;
			case '-': case '_': zoomAt(1 / 1.3, vw / 2, vh / 2); return;
			case '0': fitWall(); requestFrame(); return;
			case 'Home': cam.cx = 0; break;
			case 'End': cam.cx = W.wallW; break;
			case '/': e.preventDefault(); search.focus(); search.select(); return;
			case 'l': case 'L': labelsBtn.click(); return;
			case 'n': case 'N': if (hits.length) stepHit(1); return;
			case '?': helpEl.hidden = !helpEl.hidden; return;
			default: return;
		}
		e.preventDefault(); fly = null; inertia = null; clampCam(); requestFrame();
	});

	// controls
	var searchTimer = null;
	search.addEventListener('input', function () { clearTimeout(searchTimer); searchTimer = setTimeout(function () { runSearch(search.value, true); }, 180); });
	prevBtn.addEventListener('click', function () { stepHit(-1); });
	nextBtn.addEventListener('click', function () { stepHit(1); });
	paintSel.addEventListener('change', function () { if (paintSel.value === 'author' && selected) authorKey = authorOf(selected.b); setPaint(paintSel.value); });
	labelsBtn.addEventListener('click', function () { labelsOn = !labelsOn; labelsBtn.classList.toggle('on', labelsOn); labelsBtn.setAttribute('aria-pressed', labelsOn); gen++; tiles.clear(); requestFrame(); });
	$('#btn-fit').addEventListener('click', function () { fitWall(); requestFrame(); });
	$('#btn-zoom-in').addEventListener('click', function () { zoomAt(1.4, vw / 2, vh / 2); });
	$('#btn-zoom-out').addEventListener('click', function () { zoomAt(1 / 1.4, vw / 2, vh / 2); });
	$('#btn-export-view').addEventListener('click', function () { if (W) exportView(); });
	$('#btn-export-wall').addEventListener('click', function () { if (W) exportWall(); });
	$('#btn-help').addEventListener('click', function () { helpEl.hidden = !helpEl.hidden; });
	$('#help-close').addEventListener('click', function () { helpEl.hidden = true; });
	$('#card-close').addEventListener('click', function () { selectItem(null); });
	$('#card-author').addEventListener('click', function () { if (selected) { authorKey = authorOf(selected.b); setPaint('author'); } });
	$('#card-torch').addEventListener('click', function () { if (selected) { torch = selected; flyTo(selected, 2.8); } });
	window.addEventListener('resize', resize);
	if (window.ResizeObserver) new ResizeObserver(function () { resize(); }).observe(stage);

	boot();
})();
