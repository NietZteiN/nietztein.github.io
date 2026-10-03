/* The human–machine loop as a rotatable 3D model, for the "3D" view of the
 * CV-at-a-glance gallery (assets/js/glance.js loads this file on first use).
 *
 * No dependency: a figure-eight band is projected by hand onto a 2D canvas.
 * The left lobe is the HUMAN half (solid), the right lobe the MODEL half
 * (outlined); they cross in the middle, where instruction passes one way and
 * output the other. Stages are nodes on the band, project cards are labelled
 * satellites tethered to the stage they study, and pulses run round the band.
 *
 * window.GlanceLoop3D.mount(host, model, opts) -> controller | null
 *   model  { stages: [{id, name}], cards: [{id, label, wire: [stage ids]}] }
 *   opts   { reduced, onHover(sel | null), onPick(sel) }, sel = {card} | {stage}
 *   controller  start() stop() frame(n) resize() setHighlight(r) setReduced(b) */
(function () {
	'use strict';

	var TAU = Math.PI * 2, A = 1.55, B = 0.72, D = 0.34, HALF = 0.105, CAM = 7, N = 132, PERIOD = 10;
	// where each stage sits on the band (parameter u); m3 hangs off m2 on a spur
	var U = { h2: 0.72 * Math.PI, h3: Math.PI, h1: 1.28 * Math.PI, xin: 1.5 * Math.PI, m1: 1.75 * Math.PI, m2: 0.25 * Math.PI, xout: 0.5 * Math.PI };
	var M3 = [2.0, 0.55, -0.3], M3_U = 0.25 * Math.PI + 0.42;
	var SAT = {
		comp: [-1.3, -1.5, 0.5], se: [-2.1, -0.72, -0.2], align: [0, 1.3, 0.3], eval: [0, -1.3, 0.5], phil: [1.75, -1.45, -0.4],
		sci: [0.92, 1.5, 0.6], unl: [2.3, 1.45, -0.1], attr: [2.45, -0.3, -0.5], other: [-2.0, 1.4, -0.4]
	};
	var SHORT = { h1: 'Interpret', h2: 'Read', h3: 'Judge', m1: 'Represent', m2: 'Generate', m3: 'Change', xin: 'instruction', xout: 'output' };

	function curve(u) { return [A * Math.cos(u), B * Math.sin(2 * u), D * Math.sin(u)]; }
	function edge(u, k) {   // a point on the band's edge: k = -1 or +1
		var tx = -A * Math.sin(u), ty = 2 * B * Math.cos(2 * u), l = Math.sqrt(tx * tx + ty * ty) || 1;
		var bank = 0.55 * Math.sin(2 * u), c = curve(u), w = HALF * k;
		return [c[0] - ty / l * Math.cos(bank) * w, c[1] + tx / l * Math.cos(bank) * w, c[2] + Math.sin(bank) * w];
	}
	function wrap(s, n) {
		var out = [], line = '';
		s.split(' ').forEach(function (w) {
			if (line && (line + ' ' + w).length > n) { out.push(line); line = w; }
			else line = line ? line + ' ' + w : w;
		});
		if (line) out.push(line);
		return out;
	}

	function mount(host, model, opts) {
		opts = opts || {};
		var canvas = document.createElement('canvas'), ctx = canvas.getContext && canvas.getContext('2d');
		if (!ctx) return null;
		canvas.className = 'glance-3d-canvas';
		canvas.setAttribute('role', 'img');
		canvas.setAttribute('aria-label', 'Rotatable model of the human–machine loop: a figure-eight band with the human stages on the left lobe, ' +
			'the model stages on the right, and project cards tethered to the stage they study. The buttons that follow list the same cards and stages.');
		host.appendChild(canvas);

		var w = 0, h = 0, dpr = 1, col = {}, running = false, raf = 0, last = 0, clock = 0;
		var reduced = !!opts.reduced, yaw = 0, pitch = 0, drag = null, hl = null, over = null, hits = [];

		var stagePos = {};
		Object.keys(U).forEach(function (id) { stagePos[id] = curve(U[id]); });
		stagePos.m3 = M3;
		var stages = model.stages.filter(function (s) { return stagePos[s.id]; });
		var cards = model.cards.filter(function (c) { return SAT[c.id]; }).map(function (c) {
			return { id: c.id, label: c.label, lines: wrap(c.label, 18), at: SAT[c.id], wire: (c.wire || []).filter(function (s) { return stagePos[s]; }) };
		});

		function colours() {
			var cs = getComputedStyle(host);
			function v(n, d) { return (cs.getPropertyValue(n) || '').trim() || d; }
			col = { text: v('--text', '#1b1f24'), text2: v('--text-2', '#5f6873'), border: v('--border-strong', '#cfd4da'),
				accent: v('--accent', '#1f5fd6'), surface: v('--surface', '#f7f8fa'), surface2: v('--surface-2', '#eef0f3'),
				font: v('--font-mono', 'monospace') };
		}
		function resize() {
			var cw = Math.round(host.clientWidth), ch = Math.round(host.clientHeight);
			if (!cw || !ch) return;
			dpr = Math.min(window.devicePixelRatio || 1, 2);
			if (cw !== w || ch !== h) {
				w = cw; h = ch;
				canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
			}
			colours();
			if (!running) draw();
		}

		function draw() {
			if (!w || !h) return;
			var compact = w < 560, S = compact ? Math.min(w / 5.3, h / 3.7) : Math.min(w / 5.9, h / 3.95), cx = w / 2, cy = h / 2;
			var sway = reduced ? 0 : 1;
			var ya = -0.22 + yaw + sway * 0.42 * Math.sin(clock * TAU / 16), pa = 0.44 + pitch + sway * 0.06 * Math.sin(clock * TAU / 11);
			var cyw = Math.cos(ya), syw = Math.sin(ya), cp = Math.cos(pa), sp = Math.sin(pa);
			function P(p) {   // world -> [screen x, screen y, depth (larger = nearer), perspective]
				var x = p[0] * cyw + p[2] * syw, z = -p[0] * syw + p[2] * cyw, y = p[1] * cp - z * sp, zz = p[1] * sp + z * cp, k = CAM / (CAM - zz);
				return [cx + x * S * k, cy - y * S * k, zz, k];
			}
			function near(z) { return Math.max(0, Math.min(1, (z + 1.6) / 3.2)); }
			function on(kind, id) { return !hl || (hl[kind] && hl[kind].indexOf(id) >= 0); }
			var items = [], i, t = clock;
			hits = [];

			ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
			ctx.clearRect(0, 0, w, h);
			ctx.lineJoin = 'round'; ctx.lineCap = 'round';

			// the band, as quads sorted with everything else
			var prevL = P(edge(0, -1)), prevR = P(edge(0, 1));
			for (i = 1; i <= N; i++) {
				(function (u, um, l0, r0) {
					var l1 = P(edge(u, -1)), r1 = P(edge(u, 1)), z = (l0[2] + r0[2] + l1[2] + r1[2]) / 4, human = Math.cos(um) < 0;
					items.push({ z: z, draw: function () {
						var k = 0.55 + 0.45 * near(z);
						ctx.beginPath(); ctx.moveTo(l0[0], l0[1]); ctx.lineTo(l1[0], l1[1]); ctx.lineTo(r1[0], r1[1]); ctx.lineTo(r0[0], r0[1]); ctx.closePath();
						ctx.globalAlpha = (human ? 0.62 : 0.16) * k * (hl ? 0.7 : 1); ctx.fillStyle = col.accent; ctx.fill();
						ctx.globalAlpha = (human ? 0.9 : 0.8) * k * (hl ? 0.7 : 1); ctx.strokeStyle = col.accent; ctx.lineWidth = 1;
						ctx.beginPath(); ctx.moveTo(l0[0], l0[1]); ctx.lineTo(l1[0], l1[1]); ctx.moveTo(r0[0], r0[1]); ctx.lineTo(r1[0], r1[1]); ctx.stroke();
					} });
					prevL = l1; prevR = r1;
				})(i / N * TAU, (i - 0.5) / N * TAU, prevL, prevR);
			}

			// the spur to "Change capabilities"
			var pm2 = P(stagePos.m2), pm3 = P(stagePos.m3);
			items.push({ z: (pm2[2] + pm3[2]) / 2 - 0.01, draw: function () {
				ctx.globalAlpha = 0.8 * (hl ? 0.7 : 1); ctx.strokeStyle = col.accent; ctx.lineWidth = 1.6;
				ctx.beginPath(); ctx.moveTo(pm2[0], pm2[1]); ctx.lineTo(pm3[0], pm3[1]); ctx.stroke();
			} });

			// pulses on the band, and one on the spur each time a pulse passes m2
			var pu = [];
			if (!reduced) for (i = 0; i < 3; i++) {
				(function (u) {
					pu.push(u);
					var p = P(curve(u));
					items.push({ z: p[2] + 0.05, draw: function () {
						ctx.fillStyle = col.accent;
						ctx.globalAlpha = 0.22; ctx.beginPath(); ctx.arc(p[0], p[1], 9 * p[3], 0, TAU); ctx.fill();
						ctx.globalAlpha = 1; ctx.beginPath(); ctx.arc(p[0], p[1], 3.6 * p[3], 0, TAU); ctx.fill();
						ctx.fillStyle = col.surface; ctx.beginPath(); ctx.arc(p[0], p[1], 1.4 * p[3], 0, TAU); ctx.fill();
					} });
				})((((t / PERIOD + i / 3) % 1) + 1) % 1 * TAU);
			}
			function glow(id) {   // 0..1, how close a pulse is to this stage
				var u0 = id === 'm3' ? M3_U : U[id], g = 0;
				pu.forEach(function (u) {
					var d = Math.abs(u - (u0 % TAU)); d = Math.min(d, TAU - d);
					g = Math.max(g, Math.exp(-(d * d) / 0.05));
				});
				return g;
			}

			// tethers and satellites
			var labels = [];
			cards.forEach(function (c) {
				var p = P(c.at), lit = on('cards', c.id), strong = !!hl && lit;
				c.wire.forEach(function (sid) {
					var q = P(stagePos[sid]);
					items.push({ z: Math.min(p[2], q[2]) - 0.02, draw: function () {
						ctx.globalAlpha = strong ? 1 : lit ? 0.75 : 0.25; ctx.strokeStyle = strong ? col.accent : col.text2; ctx.lineWidth = strong ? 1.6 : 1;
						ctx.setLineDash([3, 4]); ctx.lineDashOffset = reduced ? 0 : -t * 14;
						ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); ctx.stroke();
						ctx.setLineDash([]);
					} });
				});
				labels.push({ kind: 'card', id: c.id, p: p, lit: lit, strong: strong || (over && over.card === c.id), lines: c.lines, dashed: !c.wire.length });
			});

			// stage nodes
			stages.forEach(function (s) {
				var p = P(stagePos[s.id]), lit = on('stages', s.id), strong = !!hl && lit, g = glow(s.id), cross = s.id === 'xin' || s.id === 'xout';
				items.push({ z: p[2] + 0.04, draw: function () {
					var r = (cross ? 4 : 6) * p[3];
					if (g > 0.02 || strong) {
						ctx.globalAlpha = strong ? 0.3 : 0.3 * g; ctx.fillStyle = col.accent;
						ctx.beginPath(); ctx.arc(p[0], p[1], r + 9, 0, TAU); ctx.fill();
					}
					ctx.globalAlpha = lit ? 1 : 0.4;
					ctx.beginPath(); ctx.arc(p[0], p[1], r, 0, TAU);
					ctx.fillStyle = strong || g > 0.5 ? col.accent : col.surface; ctx.fill();
					ctx.strokeStyle = col.accent; ctx.lineWidth = 1.6; ctx.stroke();
				} });
				labels.push({ kind: 'stage', id: s.id, p: p, lit: lit, strong: strong || (over && over.stage === s.id), name: s.name, cross: cross, wy: stagePos[s.id][1] });
			});

			items.sort(function (a, b) { return a.z - b.z; });
			items.forEach(function (it) { it.draw(); });
			ctx.globalAlpha = 1;

			// lobe names, then labels on top of the geometry (nearest last)
			ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
			ctx.font = '600 ' + (compact ? 9 : 10.5) + 'px ' + col.font;
			[['HUMAN', [-0.9, 0, 0]], ['MODEL', [0.9, 0, 0]]].forEach(function (l) {
				var p = P(l[1]);
				ctx.globalAlpha = hl ? 0.45 : 0.85; ctx.fillStyle = col.text2;
				spaced(l[0], p[0], p[1], 1.6);
			});

			labels.sort(function (a, b) { return a.p[2] - b.p[2]; });
			labels.forEach(function (l) {
				var a = (l.lit ? 0.62 + 0.38 * near(l.p[2]) : 0.42), x = l.p[0], y = l.p[1];
				if (l.kind === 'stage') {
					var name = compact || l.cross ? SHORT[l.id] : l.name, up = l.cross ? l.id === 'xin' : l.id !== 'm3' && l.wy > -0.2;
					var ty = y + (up ? -15 : l.id === 'm3' ? 21 : 16) * l.p[3], left = l.id === 'h3' || l.id === 'm2';
					hits.push({ sel: { stage: l.id }, x: x, y: y, r: 13 });
					if (compact && l.cross && !l.strong) return;
					if (left) { x -= 9; ty = y - 13; }
					ctx.textAlign = left ? 'right' : 'center';
					ctx.font = (l.cross ? '' : '600 ') + (compact ? 9 : l.cross ? 9.5 : 10.5) + 'px ' + col.font;
					ctx.globalAlpha = a; ctx.lineWidth = 3.5; ctx.strokeStyle = col.surface; ctx.strokeText(name, x, ty);
					ctx.fillStyle = l.strong ? col.accent : l.cross ? col.text2 : col.text; ctx.fillText(name, x, ty);
					ctx.textAlign = 'center';
				} else {
					var show = !compact || l.strong, fs = compact ? 9 : 10, lh = fs + 2, tw = 0;
					ctx.font = fs + 'px ' + col.font;
					l.lines.forEach(function (s) { tw = Math.max(tw, ctx.measureText(s).width); });
					var bw = show ? tw + 14 : 12, bh = show ? l.lines.length * lh + 9 : 12;
					x = Math.max(bw / 2 + 4, Math.min(w - bw / 2 - 4, x)); y = Math.max(bh / 2 + 4, Math.min(h - bh / 2 - 4, y));
					hits.push({ sel: { card: l.id }, x: x, y: y, hw: Math.max(bw / 2, 12), hh: Math.max(bh / 2, 12) });
					ctx.globalAlpha = l.lit ? Math.min(1, a + 0.15) : 0.55;
					rr(x - bw / 2, y - bh / 2, bw, bh, show ? 6 : 6);
					ctx.fillStyle = l.strong ? col.surface2 : col.surface; ctx.fill();
					if (l.dashed) ctx.setLineDash([3, 3]);
					ctx.strokeStyle = l.strong ? col.accent : col.border; ctx.lineWidth = l.strong ? 1.5 : 1; ctx.stroke();
					ctx.setLineDash([]);
					if (!show) return;
					ctx.globalAlpha = a; ctx.fillStyle = col.text;
					l.lines.forEach(function (s, j) { ctx.fillText(s, x, y + (j - (l.lines.length - 1) / 2) * lh + 0.5); });
				}
			});
			ctx.globalAlpha = 1;
		}
		function rr(x, y, bw, bh, r) {
			ctx.beginPath();
			ctx.moveTo(x + r, y); ctx.arcTo(x + bw, y, x + bw, y + bh, r); ctx.arcTo(x + bw, y + bh, x, y + bh, r);
			ctx.arcTo(x, y + bh, x, y, r); ctx.arcTo(x, y, x + bw, y, r); ctx.closePath();
		}
		function spaced(s, x, y, gap) {   // letter-spaced caps, centred
			var ws = s.split('').map(function (ch) { return ctx.measureText(ch).width; });
			var total = ws.reduce(function (a, b) { return a + b + gap; }, -gap), at = x - total / 2;
			ctx.textAlign = 'left';
			s.split('').forEach(function (ch, i) { ctx.fillText(ch, at, y); at += ws[i] + gap; });
			ctx.textAlign = 'center';
		}

		// -- animation ---------------------------------------------------------------------
		function loop(ms) {
			raf = requestAnimationFrame(loop);
			var dt = Math.min(0.05, (ms - last) / 1000 || 0); last = ms;
			if (!drag) clock += dt;
			draw();
		}
		function start() {
			if (reduced) { stop(); draw(); return; }
			if (running) return;
			running = true; last = performance.now();
			raf = requestAnimationFrame(loop);
		}
		function stop() {
			running = false;
			if (raf) cancelAnimationFrame(raf);
			raf = 0;
		}

		// -- pointer: drag to turn, hover or tap to pick --------------------------------
		function find(e) {
			var b = canvas.getBoundingClientRect(), x = e.clientX - b.left, y = e.clientY - b.top, best = null, bd = Infinity;
			hits.forEach(function (q) {
				var dx = x - q.x, dy = y - q.y, d = dx * dx + dy * dy;
				var inside = q.r ? d <= q.r * q.r : Math.abs(dx) <= q.hw && Math.abs(dy) <= q.hh;
				if (inside && d < bd) { bd = d; best = q.sel; }
			});
			return best;
		}
		function same(a, b) { return (!a && !b) || (!!a && !!b && a.card === b.card && a.stage === b.stage); }
		canvas.addEventListener('pointerdown', function (e) {
			drag = { x: e.clientX, y: e.clientY, moved: 0, id: e.pointerId };
			try { canvas.setPointerCapture(e.pointerId); } catch (err) { }
		});
		canvas.addEventListener('pointermove', function (e) {
			if (drag) {
				var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
				drag.x = e.clientX; drag.y = e.clientY; drag.moved += Math.abs(dx) + Math.abs(dy);
				yaw += dx * 0.008; pitch = Math.max(-1.2, Math.min(1.0, pitch + dy * 0.006));
				if (!running) draw();
				return;
			}
			var s = find(e);
			if (same(s, over)) return;
			over = s;
			canvas.style.cursor = s ? 'pointer' : '';
			if (opts.onHover) opts.onHover(s);
			if (!running) draw();
		});
		function up(e) {
			if (!drag) return;
			var tap = drag.moved < 5;
			drag = null;
			try { canvas.releasePointerCapture(e.pointerId); } catch (err) { }
			if (tap && e.type === 'pointerup') { var s = find(e); if (s && opts.onPick) opts.onPick(s); }
		}
		canvas.addEventListener('pointerup', up);
		canvas.addEventListener('pointercancel', up);
		canvas.addEventListener('pointerleave', function () {
			if (drag || !over) return;
			over = null; canvas.style.cursor = '';
			if (opts.onHover) opts.onHover(null);
			if (!running) draw();
		});

		// follow the theme switch
		if (window.MutationObserver) {
			new MutationObserver(function () { colours(); if (!running) draw(); })
				.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
		}

		resize();
		return {
			start: start,
			stop: stop,
			resize: resize,
			frame: function (n) { stop(); clock = n / 60; resize(); draw(); },
			setHighlight: function (r) { hl = r; if (!running) draw(); },
			setReduced: function (b) { reduced = !!b; if (reduced) { stop(); draw(); } }
		};
	}

	window.GlanceLoop3D = { mount: mount };
})();
