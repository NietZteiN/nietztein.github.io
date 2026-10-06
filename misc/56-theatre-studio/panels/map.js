/*
 * Theatre Studio panel 'map': the branch map of the script on show, drawn as SVG from panels/map-layout.js.
 * Chapters are bands, labels and menus are nodes, option targets and jumps are edges; endings, unreachable labels,
 * loops and jumps to nowhere are marked. The node the stage is on is highlighted.
 *
 * Pointer: drag to pan, wheel to zoom about the pointer, two fingers to pinch; click a node to put the caret on its
 * line (the stage follows), Shift+click to send only the stage there (preview:goto).
 * Keys (map focused): arrows move between nodes, N / P the next or previous node in script order, Enter goes there,
 * Shift+Enter stage only, Shift+arrows pan,
 * + and - zoom, 0 fits the whole map, 1 is actual size, S selects the node the stage is on.
 */
(function () {
	'use strict';
	var doc = document;
	var SVGNS = 'http://www.w3.org/2000/svg';
	var BASE = (function () {
		var s = doc.currentScript && doc.currentScript.src;
		return s ? s.replace(/[^\/]*$/, '') : 'panels/';
	}());
	var ZMIN = 0.15, ZMAX = 2.5;

	function addStyles() {
		if (doc.getElementById('st-issues-map-css')) return;
		var l = doc.createElement('link');
		l.id = 'st-issues-map-css'; l.rel = 'stylesheet'; l.href = BASE + 'issues-map.css';
		doc.head.appendChild(l);
	}
	function loadLayout() {
		if (window.StudioMap) return Promise.resolve(window.StudioMap);
		return new Promise(function (resolve, reject) {
			var s = doc.createElement('script');
			s.src = BASE + 'map-layout.js';
			s.onload = function () { if (window.StudioMap) resolve(window.StudioMap); else reject(new Error('map-layout.js loaded but defined nothing')); };
			s.onerror = function () { reject(new Error('panels/map-layout.js could not be loaded')); };
			doc.head.appendChild(s);
		});
	}
	function el(tag, cls, text) {
		var e = doc.createElement(tag);
		if (cls) e.className = cls;
		if (text != null) e.textContent = text;
		return e;
	}
	function sv(tag, attrs, text) {
		var e = doc.createElementNS(SVGNS, tag);
		for (var k in attrs) if (Object.prototype.hasOwnProperty.call(attrs, k) && attrs[k] != null) e.setAttribute(k, attrs[k]);
		if (text != null) e.textContent = text;
		return e;
	}
	function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }
	function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
	function fit(s, px, cw) {
		s = String(s == null ? '' : s);
		var max = Math.max(3, Math.floor(px / cw));
		return s.length > max ? s.slice(0, max - 1) + '…' : s;
	}

	if (!window.Studio || typeof window.Studio.registerPanel !== 'function') return;
	addStyles();

	window.Studio.registerPanel({
		id: 'map', title: 'Branch map', order: 20,
		mount: function (pane, api) {
			return loadLayout().then(function (M) { return mountMap(pane, api, M); });
		}
	});

	function mountMap(pane, api, M) {
		var bus = window.Studio.bus;
		var S = {
			g: null, program: null, walk: null, dirty: true, visible: false,
			k: 1, tx: 0, ty: 0, placed: false, userMoved: false,
			sel: null, stageId: null, stageLine: 0, cursorId: null,
			nodeEls: {}, drag: null, pointers: {}, pinch: null
		};

		pane.classList.add('stim-map');
		var bar = el('div', 'stim-mapbar');
		var info = el('p', 'stim-mapinfo', 'Waiting for the script…');
		var flags = el('p', 'stim-flags');
		var tools = el('div', 'stim-tools');
		function tool(label, title, fn) {
			var b = el('button', 'stim-tool', label);
			b.type = 'button'; b.title = title; b.setAttribute('aria-label', title);
			b.addEventListener('click', fn);
			tools.appendChild(b);
			return b;
		}
		tool('−', 'Zoom out (-)', function () { zoomBy(1 / 1.25); });
		tool('+', 'Zoom in (+)', function () { zoomBy(1.25); });
		tool('Fit', 'Fit the whole map (0)', function () { fitAll(); });
		tool('Stage', 'Show the node the stage is on (S)', function () { if (S.stageId) { select(S.stageId, true); } });
		bar.appendChild(info); bar.appendChild(flags); bar.appendChild(tools);
		pane.appendChild(bar);

		var view = el('div', 'stim-view');
		view.tabIndex = 0;
		view.setAttribute('role', 'group');
		view.setAttribute('aria-roledescription', 'branch map');
		view.setAttribute('aria-label', 'Branch map. Arrow keys move between nodes, N and P go through them in script order, Enter goes to the node’s line, Shift+arrows pan, plus and minus zoom, 0 fits.');
		var svg = sv('svg', { 'class': 'stim-svg', width: '100%', height: '100%', 'aria-hidden': 'true', focusable: 'false' });
		var defs = sv('defs');
		['', '-back', '-bad', '-stage'].forEach(function (suf) {
			var m = sv('marker', { id: 'stim-arrow' + suf, viewBox: '0 0 10 10', refX: '9', refY: '5', markerWidth: '7', markerHeight: '7', orient: 'auto-start-reverse' });
			m.appendChild(sv('path', { d: 'M0,0 L10,5 L0,10 z', 'class': 'stim-arrowhead' + suf }));
			defs.appendChild(m);
		});
		svg.appendChild(defs);
		var world = sv('g', { 'class': 'stim-world' });
		svg.appendChild(world);
		view.appendChild(svg);
		var live = el('p', 'stim-live');
		live.setAttribute('aria-live', 'polite');
		var legend = el('p', 'stim-legend');
		legend.innerHTML = '<span class="lg lg-label">label</span><span class="lg lg-menu">menu</span><span class="lg lg-chapter">chapter</span>' +
			'<span class="lg lg-end">ending</span><span class="lg lg-un">unreachable</span><span class="lg lg-stage">on stage</span>' +
			'<span class="lg lg-back">returns</span>';
		pane.appendChild(view);
		pane.appendChild(legend);
		pane.appendChild(live);

		/* ---- drawing ---- */

		function nodeTitle(nd) {
			switch (nd.kind) {
				case 'start': return 'start';
				case 'label': return nd.name;
				case 'menu': return 'menu · ' + plural(nd.options, 'option', 'options');
				case 'chapter': return 'chapter ' + nd.n;
				case 'end': return nd.implicit ? 'end' : '@end';
				case 'withheld': return 'withheld';
				case 'missing': return '? ' + nd.name;
			}
			return nd.name;
		}
		function nodeSub(nd) {
			var bits = [];
			if (nd.kind === 'missing') return 'no such label';
			if (nd.line) bits.push('L' + nd.line);
			if (nd.kind === 'label' || nd.kind === 'start' || nd.kind === 'chapter') bits.push(nd.stops + (nd.stops === 1 ? ' stop' : ' stops'));
			if (nd.unreachable) bits.push('unreachable');
			if (nd.loop) bits.push('loop');
			return bits.join(' · ');
		}
		function describe(nd) {
			var s = nd.kind === 'label' ? 'label ' + nd.name : nd.kind === 'chapter' ? 'chapter ' + nd.name : nd.kind === 'missing' ? 'missing label ' + nd.name : nodeTitle(nd);
			if (nd.line && nd.kind !== 'missing') s += ', line ' + nd.line;
			if (nd.kind === 'label' || nd.kind === 'start' || nd.kind === 'chapter') s += ', ' + plural(nd.stops, 'stop', 'stops');
			if (nd.unreachable) s += ', unreachable';
			if (nd.loop) s += ', part of a loop';
			if (nd.id === S.stageId) s += ', on stage';
			var outs = S.g.edges.filter(function (e) { return e.from === nd.id; });
			if (outs.length) s += '. Leads to ' + outs.map(function (e) { var t = byId(e.to); return t ? nodeTitle(t) : '?'; }).join(', ');
			return s;
		}
		function byId(id) { return S.g && S.g.byId ? S.g.byId[id] : null; }

		function edgePath(e) {
			var p = e.points;
			if (e.back) return roundPolyline(p, 6);
			var s = 'M' + p[0].x + ',' + p[0].y;
			for (var j = 1; j < p.length; j++) {
				var a = p[j - 1], b = p[j], dy = (b.y - a.y) / 2;
				s += ' C' + a.x + ',' + (a.y + dy) + ' ' + b.x + ',' + (b.y - dy) + ' ' + b.x + ',' + b.y;
			}
			return s;
		}
		function roundPolyline(p, r) {
			var d = 'M' + p[0].x + ',' + p[0].y;
			for (var i = 1; i < p.length - 1; i++) {
				var a = p[i - 1], b = p[i], c = p[i + 1];
				var l1 = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)), l2 = Math.max(1, Math.hypot(c.x - b.x, c.y - b.y));
				var rr = Math.min(r, l1 / 2, l2 / 2);
				var p1 = { x: b.x - (b.x - a.x) / l1 * rr, y: b.y - (b.y - a.y) / l1 * rr };
				var p2 = { x: b.x + (c.x - b.x) / l2 * rr, y: b.y + (c.y - b.y) / l2 * rr };
				d += ' L' + p1.x + ',' + p1.y + ' Q' + b.x + ',' + b.y + ' ' + p2.x + ',' + p2.y;
			}
			var z = p[p.length - 1];
			return d + ' L' + z.x + ',' + z.y;
		}

		function rebuild() {
			if (!S.program) return;
			var g;
			try { g = M.build(S.program, S.walk); }
			catch (err) { info.textContent = 'The map could not be drawn: ' + (err && err.message || err); return; }
			g.byId = {};
			g.nodes.forEach(function (nd) {
				g.byId[nd.id] = nd;
				// a jump to nowhere is reached from the jump's own line
				if (nd.kind === 'missing') {
					var into = g.edges.filter(function (e) { return e.to === nd.id; })[0];
					if (into && into.line) nd.line = into.line;
				}
			});
			// typing keeps the view; a different script (another draft, a pasted file) starts it again
			if (S.g) {
				var had = {}, same = 0;
				S.g.nodes.forEach(function (nd) { had[nd.id] = 1; });
				g.nodes.forEach(function (nd) { if (had[nd.id]) same++; });
				if (same / Math.max(g.nodes.length, S.g.nodes.length) < 0.5) S.placed = false;
			}
			S.g = g;
			S.dirty = false;
			drawInfo();
			drawWorld();
			if (S.sel && !g.byId[S.sel]) S.sel = null;
			S.stageId = S.stageLine ? (M.nodeAtLine(g, S.stageLine) || {}).id || null : null;
			S.cursorId = (M.nodeAtLine(g, api.getCursorLine()) || {}).id || null;
			paintMarks();
			if (!S.placed || !anyVisible()) { S.placed = false; S.userMoved = false; initialView(); }
			else apply();
		}
		// a new script can leave the old pan pointing at empty space: then the view starts again
		function anyVisible() {
			if (!S.g || !S.visible) return true;
			var vs = size();
			return S.g.nodes.some(function (nd) {
				var x0 = S.tx + nd.x * S.k, y0 = S.ty + nd.y * S.k;
				return x0 + nd.w * S.k > 0 && y0 + nd.h * S.k > 0 && x0 < vs.w && y0 < vs.h;
			});
		}

		function drawInfo() {
			var st = S.g.stats;
			info.textContent = M.summary(S.g) + (st.walked ? '' : ' · not walked (fatal issue)');
			flags.innerHTML = '';
			function flag(cls, text) { flags.appendChild(el('span', 'stim-flag ' + cls, text)); }
			if (st.missing.length) flag('is-bad', plural(st.missing.length, 'jump', 'jumps') + ' to nowhere: ' + st.missing.join(', '));
			if (st.unreachable.length) flag('is-warn', plural(st.unreachable.length, 'unreachable label', 'unreachable labels') + ': ' + st.unreachable.join(', '));
			if (st.loops.length) flag('is-warn', plural(st.loops.length, 'loop', 'loops') + ' (line ' + st.loops.join(', ') + ')');
			if (st.walked && !st.missing.length && !st.unreachable.length && !st.loops.length) flag('is-ok', st.menus ? 'every label reachable, no loops' : 'no menus: one straight path');
		}

		function drawWorld() {
			var g = S.g;
			world.innerHTML = '';
			S.nodeEls = {};
			var gb = sv('g', { 'class': 'stim-bands' });
			g.bands.forEach(function (b, i) {
				var cls = 'stim-band' + (i % 2 ? ' is-odd' : '');
				// bands run the whole width of the view, whatever the pan
				gb.appendChild(sv('rect', { x: -6000, y: b.y0, width: g.width + 12000, height: b.y1 - b.y0, 'class': cls }));
				if (b.chapter >= 0) {
					var t = sv('text', { x: 8, y: b.y0 + 15, 'class': 'stim-bandtext' });
					t.textContent = fit('Chapter ' + b.n + (b.title ? ' · ' + b.title : '') + '  (L' + b.line + ')', Math.max(200, g.width - 16), 6.4);
					gb.appendChild(t);
				}
			});
			world.appendChild(gb);

			var ge = sv('g', { 'class': 'stim-edges' });
			var gl = sv('g', { 'class': 'stim-elabels' });
			g.edges.forEach(function (e) {
				var cls = 'stim-edge k-' + e.kind + (e.back ? ' is-back' : '') + (e.broken ? ' is-broken' : '') + (e.cond ? ' is-cond' : '');
				var path = sv('path', { d: edgePath(e), 'class': cls, 'marker-end': 'url(#stim-arrow' + (e.broken ? '-bad' : e.back ? '-back' : '') + ')', 'data-edge': e.id, 'data-from': e.from, 'data-to': e.to });
				var tt = e.labels.length ? e.labels.join(' / ') : e.kind;
				path.appendChild(sv('title', {}, tt + (e.line ? ' (line ' + e.line + ')' : '')));
				ge.appendChild(path);
				if (e.labels.length) {
					// options fan out from one menu, so their labels go where they arrive: just above the target
					var pl = e.points[e.points.length - 1], tn = byId(e.to);
					var lx, ly, anchor = 'middle', room;
					if (e.back) { lx = e.points[1].x + 4; ly = (e.points[1].y + e.points[2].y) / 2; anchor = 'start'; room = 120; }
					else { lx = pl.x; ly = pl.y - 7; room = Math.max(90, (tn ? tn.w : 140) + 6); }
					var txt = (e.once ? '↻ ' : '') + e.labels.join(' / ');
					var lt = sv('text', { x: lx, y: ly, 'class': 'stim-elabel' + (e.broken ? ' is-broken' : ''), 'text-anchor': anchor });
					lt.textContent = fit(txt, room, 5.6);
					gl.appendChild(lt);
				}
			});
			world.appendChild(ge);

			var gn = sv('g', { 'class': 'stim-nodes' });
			g.nodes.forEach(function (nd) {
				var cls = 'stim-node k-' + nd.kind + (nd.unreachable ? ' is-un' : '') + (nd.loop ? ' is-loop' : '') + (nd.ending ? ' is-ending' : '');
				var grp = sv('g', { 'class': cls, transform: 'translate(' + nd.x + ',' + nd.y + ')', 'data-node': nd.id });
				var round = nd.kind === 'start' || nd.kind === 'end' || nd.kind === 'withheld' ? nd.h / 2 : nd.kind === 'menu' ? 10 : 3;
				grp.appendChild(sv('rect', { x: 0, y: 0, width: nd.w, height: nd.h, rx: round, ry: round, 'class': 'stim-box' }));
				if (nd.kind === 'menu') grp.appendChild(sv('rect', { x: 3, y: 3, width: nd.w - 6, height: nd.h - 6, rx: 7, ry: 7, 'class': 'stim-inner' }));
				var big = nd.h >= 34;
				var t1 = sv('text', { x: nd.w / 2, y: big ? 15 : nd.h / 2 + 4, 'text-anchor': 'middle', 'class': 'stim-t1' });
				t1.textContent = fit(nodeTitle(nd), nd.w - 12, nd.kind === 'label' || nd.kind === 'missing' ? 6.6 : 6.2);
				grp.appendChild(t1);
				if (big) {
					var t2 = sv('text', { x: nd.w / 2, y: 29, 'text-anchor': 'middle', 'class': 'stim-t2' });
					t2.textContent = fit(nodeSub(nd), nd.w - 10, 5.4);
					grp.appendChild(t2);
				}
				grp.appendChild(sv('title', {}, describe(nd)));
				gn.appendChild(grp);
				S.nodeEls[nd.id] = grp;
			});
			world.appendChild(gn);
			world.appendChild(gl);
		}

		function paintMarks() {
			if (!S.g) return;
			Object.keys(S.nodeEls).forEach(function (id) {
				var n = S.nodeEls[id];
				n.classList.toggle('is-stage', id === S.stageId);
				n.classList.toggle('is-sel', id === S.sel);
				n.classList.toggle('is-cursor', id === S.cursorId && id !== S.stageId);
			});
			var paths = world.querySelectorAll('.stim-edge');
			for (var i = 0; i < paths.length; i++) {
				var p = paths[i];
				var on = S.stageId && (p.getAttribute('data-from') === S.stageId);
				p.classList.toggle('is-from-stage', !!on);
			}
		}

		/* ---- view transform ---- */

		function size() { return { w: view.clientWidth || 1, h: view.clientHeight || 1 }; }
		function apply() {
			world.setAttribute('transform', 'translate(' + Math.round(S.tx * 10) / 10 + ',' + Math.round(S.ty * 10) / 10 + ') scale(' + Math.round(S.k * 1000) / 1000 + ')');
			view.setAttribute('data-zoom', String(Math.round(S.k * 100)));
		}
		function initialView() {
			if (!S.g || !S.visible) return;
			var vs = size();
			if (vs.w < 20 || vs.h < 20) return;
			// fit the width (readable even for the biggest story), never smaller than 55 %, never larger than 100 %
			S.k = clamp(Math.min(1, (vs.w - 8) / S.g.width), 0.55, 1);
			S.tx = Math.max(4, (vs.w - S.g.width * S.k) / 2);
			S.ty = 4;
			S.placed = true;
			apply();
			// scroll only as far as needed to show the stage's node: the top of the map stays in view when it can
			var target = S.stageId || S.cursorId;
			if (target && target !== 'start') ensureVisible(target, false);
		}
		function fitAll() {
			if (!S.g) return;
			var vs = size();
			S.k = clamp(Math.min((vs.w - 8) / S.g.width, (vs.h - 8) / S.g.height), ZMIN, ZMAX);
			S.tx = (vs.w - S.g.width * S.k) / 2;
			S.ty = (vs.h - S.g.height * S.k) / 2;
			S.userMoved = true;
			apply();
			announce('Whole map, ' + Math.round(S.k * 100) + ' percent');
		}
		function zoomAt(f, cx, cy) {
			var k2 = clamp(S.k * f, ZMIN, ZMAX);
			if (k2 === S.k) return;
			S.tx = cx - (cx - S.tx) * (k2 / S.k);
			S.ty = cy - (cy - S.ty) * (k2 / S.k);
			S.k = k2;
			S.userMoved = true;
			apply();
		}
		function zoomBy(f) { var vs = size(); zoomAt(f, vs.w / 2, vs.h / 2); announce(Math.round(S.k * 100) + ' percent'); }
		function panBy(dx, dy) { S.tx += dx; S.ty += dy; S.userMoved = true; apply(); }
		function ensureVisible(id, center) {
			var nd = byId(id); if (!nd) return;
			var vs = size(), m = 24;
			var x0 = S.tx + nd.x * S.k, y0 = S.ty + nd.y * S.k, x1 = x0 + nd.w * S.k, y1 = y0 + nd.h * S.k;
			if (center && (x0 < m || y0 < m || x1 > vs.w - m || y1 > vs.h - m)) {
				S.tx = vs.w / 2 - (nd.x + nd.w / 2) * S.k;
				S.ty = vs.h / 2 - (nd.y + nd.h / 2) * S.k;
			} else {
				if (x0 < m) S.tx += m - x0; else if (x1 > vs.w - m) S.tx -= x1 - (vs.w - m);
				if (y0 < m) S.ty += m - y0; else if (y1 > vs.h - m) S.ty -= y1 - (vs.h - m);
			}
			apply();
		}
		function announce(t) { live.textContent = t; }

		/* ---- selection and jumps ---- */

		function select(id, reveal) {
			if (!byId(id)) return;
			S.sel = id;
			paintMarks();
			if (reveal) ensureVisible(id, false);
			announce(describe(byId(id)));
		}
		function goNode(id, stageOnly) {
			var nd = byId(id); if (!nd) return;
			select(id, false);
			if (stageOnly) {
				if (nd.kind === 'label') bus.emit('preview:goto', { label: nd.name });
				else if (nd.line) bus.emit('preview:goto', { line: nd.line });
				return;
			}
			if (nd.line) api.gotoLine(nd.line);
		}
		function neighbour(dir) {
			var g = S.g; if (!g || !g.nodes.length) return null;
			var cur = byId(S.sel) || byId(S.stageId) || byId(S.cursorId) || g.nodes[0];
			if (!byId(S.sel)) return cur.id;
			var best = null, bestScore = Infinity;
			g.nodes.forEach(function (nd) {
				if (nd === cur) return;
				var dx = nd.cx - cur.cx, dy = nd.cy - cur.cy, score;
				if (dir === 'up' || dir === 'down') {
					if (dir === 'up' ? nd.layer >= cur.layer : nd.layer <= cur.layer) return;
					score = Math.abs(nd.layer - cur.layer) * 10000 + Math.abs(dx);
				} else {
					if (nd.layer !== cur.layer) return;
					if (dir === 'left' ? dx >= 0 : dx <= 0) return;
					score = Math.abs(dx);
				}
				if (score < bestScore) { bestScore = score; best = nd; }
			});
			return best ? best.id : null;
		}

		/* ---- input ---- */

		view.addEventListener('keydown', function (e) {
			if (!S.g) return;
			var k = e.key, step = 60;
			if (e.ctrlKey || e.altKey || e.metaKey) return;
			var dir = k === 'ArrowUp' ? 'up' : k === 'ArrowDown' ? 'down' : k === 'ArrowLeft' ? 'left' : k === 'ArrowRight' ? 'right' : null;
			if (dir && e.shiftKey) {
				e.preventDefault();
				panBy(dir === 'left' ? step : dir === 'right' ? -step : 0, dir === 'up' ? step : dir === 'down' ? -step : 0);
			} else if (dir) {
				e.preventDefault();
				var id = neighbour(dir);
				if (id) select(id, true);
			} else if (k === 'Enter' || k === ' ') {
				e.preventDefault();
				if (S.sel) goNode(S.sel, e.shiftKey);
				else { var f = neighbour('down'); if (f) select(f, true); }
			} else if (k === '+' || k === '=') { e.preventDefault(); zoomBy(1.25); }
			else if (k === '-' || k === '_') { e.preventDefault(); zoomBy(1 / 1.25); }
			else if (k === '0') { e.preventDefault(); fitAll(); }
			else if (k === '1') { e.preventDefault(); var vs = size(); zoomAt(1 / S.k, vs.w / 2, vs.h / 2); announce('100 percent'); }
			else if (k === 'n' || k === 'p' || k === 'N' || k === 'P') {
				// next / previous node in script order
				e.preventDefault();
				var list = S.g.nodes, at = list.indexOf(byId(S.sel));
				var j = at < 0 ? 0 : (at + ((k === 'n' || k === 'N') ? 1 : -1) + list.length) % list.length;
				select(list[j].id, true);
			}
			else if (k === 's' || k === 'S') { if (S.stageId) { e.preventDefault(); select(S.stageId, true); } }
			else if (k === 'Home') { e.preventDefault(); select('start', true); }
			else if (k === 'Escape' && S.sel) { S.sel = null; paintMarks(); }
		});
		view.addEventListener('focus', function () {
			if (!S.sel && S.g) { var id = S.stageId || S.cursorId || 'start'; S.sel = id; paintMarks(); announce(describe(byId(id))); }
		});

		function nodeFromEvent(e) {
			var t = e.target;
			while (t && t !== view) { if (t.getAttribute && t.getAttribute('data-node')) return t.getAttribute('data-node'); t = t.parentNode; }
			return null;
		}
		function local(e) { var r = view.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }

		view.addEventListener('pointerdown', function (e) {
			if (e.button !== 0 && e.pointerType === 'mouse') return;
			S.pointers[e.pointerId] = local(e);
			var ids = Object.keys(S.pointers);
			if (ids.length === 2) {
				var a = S.pointers[ids[0]], b = S.pointers[ids[1]];
				S.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, k: S.k };
				S.drag = null;
			} else {
				var p = local(e);
				S.drag = { x: p.x, y: p.y, tx: S.tx, ty: S.ty, moved: false, node: nodeFromEvent(e), shift: e.shiftKey, id: e.pointerId };
			}
			try { view.setPointerCapture(e.pointerId); } catch (err) { /* not capturable */ }
		});
		view.addEventListener('pointermove', function (e) {
			if (!S.pointers[e.pointerId]) return;
			S.pointers[e.pointerId] = local(e);
			var ids = Object.keys(S.pointers);
			if (S.pinch && ids.length >= 2) {
				var a = S.pointers[ids[0]], b = S.pointers[ids[1]];
				var d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
				zoomAt((S.pinch.k * d / S.pinch.d) / S.k, (a.x + b.x) / 2, (a.y + b.y) / 2);
				return;
			}
			if (!S.drag || S.drag.id !== e.pointerId) return;
			var p = local(e), dx = p.x - S.drag.x, dy = p.y - S.drag.y;
			if (!S.drag.moved && Math.abs(dx) + Math.abs(dy) < 5) return;
			S.drag.moved = true;
			view.classList.add('is-dragging');
			S.tx = S.drag.tx + dx; S.ty = S.drag.ty + dy; S.userMoved = true;
			apply();
		});
		function endPointer(e) {
			if (!S.pointers[e.pointerId]) return;
			delete S.pointers[e.pointerId];
			if (Object.keys(S.pointers).length < 2) S.pinch = null;
			var d = S.drag;
			if (d && d.id === e.pointerId) {
				S.drag = null;
				view.classList.remove('is-dragging');
				if (!d.moved && d.node && e.type === 'pointerup') goNode(d.node, d.shift || e.shiftKey);
			}
		}
		view.addEventListener('pointerup', endPointer);
		view.addEventListener('pointercancel', endPointer);
		view.addEventListener('wheel', function (e) {
			if (!S.g) return;
			e.preventDefault();
			var p = local(e);
			if (e.shiftKey) { panBy(-e.deltaY, 0); return; }
			var f = Math.exp(-clamp(e.deltaY, -120, 120) * (e.deltaMode === 1 ? 0.05 : 0.0018));
			zoomAt(f, p.x, p.y);
		}, { passive: false });

		/* ---- bus ---- */

		function onReady(d) {
			S.program = d && d.program || null;
			S.walk = d && d.walk || null;
			S.dirty = true;
			if (S.visible) rebuild();
		}
		function onStop(d) {
			S.stageLine = d && d.line | 0;
			if (!S.g) return;
			var nd = M.nodeAtLine(S.g, S.stageLine);
			var id = nd ? nd.id : null;
			if (id === S.stageId) return;
			S.stageId = id;
			paintMarks();
			if (S.visible && id && !S.drag) ensureVisible(id, false);
		}
		function onCursor(d) {
			if (!S.g) return;
			var nd = M.nodeAtLine(S.g, d && d.line | 0);
			S.cursorId = nd ? nd.id : null;
			paintMarks();
		}
		function onDraft() { S.placed = false; S.sel = null; S.stageId = null; S.stageLine = 0; }
		bus.on('program:ready', onReady);
		bus.on('preview:stop', onStop);
		bus.on('cursor:line', onCursor);
		// the stage reloaded: with a fatal issue it shows its panel and no stop, so nothing on the map is on stage
		function onStageReady(d) {
			var fatal = d && (d.issues || []).some(function (i) { return i.level === 'fatal'; });
			if (fatal || !d || d.title === null) { S.stageLine = 0; S.stageId = null; paintMarks(); }
		}
		bus.on('preview:ready', onStageReady);
		var lastKey = api.getDraftKey();
		bus.on('doc:change', function () { var k = api.getDraftKey(); if (k !== lastKey) { lastKey = k; onDraft(); } });

		// mounted after the first lint: the api has the program but not the walk, so paths wait for the next lint
		S.program = api.getProgram();
		pane.__stimMap = function () { return { k: S.k, tx: S.tx, ty: S.ty, sel: S.sel, stageId: S.stageId, cursorId: S.cursorId, stats: S.g ? S.g.stats : null, nodes: S.g ? S.g.nodes.length : 0, width: S.g ? S.g.width : 0, height: S.g ? S.g.height : 0 }; };

		return {
			show: function () {
				S.visible = true;
				if (S.dirty || !S.g) rebuild();
				else if (!S.placed) initialView();
				else apply();
			},
			hide: function () { S.visible = false; },
			resize: function () { if (S.visible && S.g && !S.userMoved) initialView(); },
			unmount: function () {
				bus.off('program:ready', onReady);
				bus.off('preview:stop', onStop);
				bus.off('cursor:line', onCursor);
				bus.off('preview:ready', onStageReady);
			}
		};
	}
}());
