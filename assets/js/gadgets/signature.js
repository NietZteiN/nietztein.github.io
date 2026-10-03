// Gadget "signature": a hand-authored single-stroke cursive "Jack V. Le" that
// draws itself under the name in the left panel. Pure inline SVG; the strokes
// are plain M/C path data, the thick parts are the same curves re-drawn wider
// over sub-ranges (pen pressure), and the draw-in is a dash-offset timeline
// measured with getTotalLength() at runtime. Click the signature to replay.
// `?gadgetDebug=signature-half` freezes it half drawn; `signature-full` shows
// it finished. Switch off with Gadgets.set('signature', false).
(function () {
	'use strict';
	if (!window.Gadgets || !document.querySelector) return;

	var VIEW_W = 180, VIEW_H = 56;
	var TOTAL_MS = 1800;   // whole signature, pen lifts included
	var LIFT_MS = 70;      // pause while the pen is in the air between strokes
	var DOT_MS = 160;      // the full stop popping in at the very end
	var BASE_W = 1.55;     // hairline width (viewBox units)

	// Strokes in writing order. Only absolute M and C commands are used so the
	// pressure overlays below can slice exact sub-curves out of them.
	var STROKES = [
		{ // "Jack" in one connected movement
			d: 'M 7 23 C 11 15, 18 9, 24 9 C 30 9, 29 18, 26 26 C 24 32, 21 40, 18 46 ' +
				'C 16 50, 9 50, 8 46 C 7 42, 14 37, 22 34 C 27 32, 31 31, 35 30 ' +
				'C 38 27, 43 25, 44 27 C 41 24, 33 28, 33 34 C 34 39, 42 37, 44 28 ' +
				'C 43 33, 43 38, 46 37 C 48 36, 49 34, 51 32 ' +
				'C 53 28, 58 25, 58 28 C 57 24, 50 29, 51 34 C 52 39, 58 37, 61 33 ' +
				'C 64 27, 68 14, 72 9 C 75 5, 76 10, 73 18 C 70 26, 67 32, 65 37 ' +
				'C 67 31, 71 27, 74 27 C 77 27, 72 31, 70 32 C 73 33, 76 35, 78 36 C 81 37, 83 35, 86 32',
			pace: 1.0,
			press: [
				[1, 0.05, 1.0, 2.2], [1, 0.3, 1.0, 2.8], [2, 0.0, 0.9, 2.2], [2, 0.0, 0.6, 2.8], // J stem
				[9, 0.0, 0.9, 2.1],                                                     // a down
				[14, 0.1, 0.9, 2.1], [14, 0.3, 0.8, 2.6]                                // k stem
			]
		},
		{ // "V" with a curled entry and exit
			d: 'M 93 18 C 95 13, 101 10, 102 15 C 101 24, 102 31, 105 37 C 109 31, 113 21, 118 12 C 120 9, 122 13, 118 17',
			pace: 1.1,
			press: [[1, 0.0, 1.0, 2.2], [1, 0.2, 0.9, 2.8]]
		},
		{ // "Le": a tall bowed capital L whose horizontal foot runs straight into the e
			d: 'M 142 5 C 145 14, 139 28, 133 38 C 132 41, 135 41, 140 40 C 144 39, 147 38, 149 36 ' +
				'C 152 33, 154 29, 151 28 C 148 27, 145 32, 146 36 C 148 39, 153 37, 157 33',
			pace: 1.05,
			press: [[0, 0.08, 0.95, 2.2], [0, 0.3, 0.8, 2.8], [4, 0.0, 0.8, 2.0]]
		},
		{ // underline swash in the accent colour, looping back under the J
			d: 'M 157 33 C 165 26, 174 29, 171 37 C 168 45, 130 49, 80 48 C 55 47, 38 46, 36 43 C 35 40, 41 40, 43 42',
			pace: 0.75,
			swash: true,
			lift: 0,
			press: [[1, 0.15, 1.0, 2.0], [2, 0.0, 0.5, 2.0]]
		}
	];
	var DOT = { x: 123, y: 36, r: 1.6 };

	var SVG_NS = 'http://www.w3.org/2000/svg';
	var wrap = null, svg = null, h3 = null, dot = null;
	var runs = [];           // [{ el, len, start, dur, pace, over: [{ el, len, a, b }] }]
	var raf = 0, t0 = 0, paused = -1, playedOnce = false, revealTimer = 0;
	var debug = (function () {
		var m = /[?&]gadgetDebug=([^&#]+)/.exec(location.search);
		return m ? decodeURIComponent(m[1]) : '';
	})();

	// ---- path helpers -----------------------------------------------------

	function parse(d) {
		var nums = d.replace(/[A-Za-z]/g, function (c) { return ' ' + c + ' '; }).replace(/,/g, ' ').trim().split(/\s+/);
		var segs = [], i = 0, cur = null, cmd = '';
		while (i < nums.length) {
			var tok = nums[i];
			if (tok === 'M' || tok === 'C') { cmd = tok; i++; continue; }
			if (cmd === 'M') { cur = [+nums[i], +nums[i + 1]]; i += 2; cmd = 'C'; continue; }
			var p0 = cur, p1 = [+nums[i], +nums[i + 1]], p2 = [+nums[i + 2], +nums[i + 3]], p3 = [+nums[i + 4], +nums[i + 5]];
			segs.push([p0, p1, p2, p3]);
			cur = p3; i += 6;
		}
		return segs;
	}
	function lerp(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; }
	function splitAt(seg, t) { // de Casteljau: returns [left, right]
		var a = lerp(seg[0], seg[1], t), b = lerp(seg[1], seg[2], t), c = lerp(seg[2], seg[3], t);
		var d = lerp(a, b, t), e = lerp(b, c, t), f = lerp(d, e, t);
		return [[seg[0], a, d, f], [f, e, c, seg[3]]];
	}
	function sub(seg, t0, t1) {
		var right = splitAt(seg, t0)[1];
		var t = t0 >= 1 ? 1 : (t1 - t0) / (1 - t0);
		return splitAt(right, t)[0];
	}
	function fmt(n) { return Math.round(n * 100) / 100; }
	function segD(seg) {
		return 'M ' + fmt(seg[0][0]) + ' ' + fmt(seg[0][1]) + ' C ' + fmt(seg[1][0]) + ' ' + fmt(seg[1][1]) + ', ' +
			fmt(seg[2][0]) + ' ' + fmt(seg[2][1]) + ', ' + fmt(seg[3][0]) + ' ' + fmt(seg[3][1]);
	}
	function mk(tag, attrs) {
		var el = document.createElementNS(SVG_NS, tag);
		for (var k in attrs) if (Object.prototype.hasOwnProperty.call(attrs, k)) el.setAttribute(k, attrs[k]);
		return el;
	}
	function lengthOf(d) {
		var p = mk('path', { d: d });
		svg.appendChild(p);
		var len = 0;
		try { len = p.getTotalLength(); } catch (e) { len = 0; }
		svg.removeChild(p);
		return len;
	}

	// Pen easing: quick off the mark, braking into the end of each stroke.
	function ease(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }
	function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

	// ---- build --------------------------------------------------------------

	function build() {
		h3 = document.querySelector('#leftPanel h3');
		if (!h3 || document.querySelector('.sig-wrap')) return false;

		wrap = document.createElement('div');
		wrap.className = 'sig-wrap';
		wrap.setAttribute('aria-hidden', 'true');
		svg = mk('svg', { viewBox: '0 0 ' + VIEW_W + ' ' + VIEW_H, width: VIEW_W, height: VIEW_H, focusable: 'false' });
		var title = mk('title', {});
		title.textContent = 'replay';
		svg.appendChild(title);
		wrap.appendChild(svg);
		h3.parentNode.insertBefore(wrap, h3.nextSibling);

		runs = [];
		STROKES.forEach(function (s) {
			var segs = parse(s.d);
			var cls = 'sig-ink' + (s.swash ? ' sig-swash' : '');
			var el = mk('path', { d: s.d, 'class': cls, 'stroke-width': BASE_W });
			svg.appendChild(el);
			var total = lengthOf(s.d) || 1;
			var cum = [0];
			segs.forEach(function (seg) { cum.push(cum[cum.length - 1] + lengthOf(segD(seg))); });
			var over = (s.press || []).map(function (p) {
				var k = p[0], ta = p[1], tb = p[2], w = p[3];
				var seg = segs[k];
				if (!seg) return null;
				var d = segD(sub(seg, ta, tb));
				var o = mk('path', { d: d, 'class': cls, 'stroke-width': w });
				svg.appendChild(o);
				var a = (cum[k] + (ta > 0 ? lengthOf(segD(sub(seg, 0, ta))) : 0)) / total;
				var b = (cum[k] + (tb < 1 ? lengthOf(segD(sub(seg, 0, tb))) : cum[k + 1] - cum[k])) / total;
				return { el: o, len: lengthOf(d) || 1, a: a, b: Math.max(b, a + 0.001) };
			}).filter(Boolean);
			runs.push({ el: el, len: total, pace: s.pace || 1, lift: s.lift == null ? LIFT_MS : s.lift, over: over, start: 0, dur: 0 });
		});
		dot = mk('circle', { cx: DOT.x, cy: DOT.y, r: DOT.r, 'class': 'sig-dot' });
		svg.appendChild(dot);

		// Timeline: stroke time grows with length (sub-linearly, long swashes
		// are quick) times its pace; pen lifts and the dot fill the rest.
		var weights = runs.map(function (r) { return Math.pow(r.len, 0.85) * r.pace; });
		var sum = weights.reduce(function (a, b) { return a + b; }, 0);
		var lifts = runs.reduce(function (a, r, i) { return a + (i ? r.lift : 0); }, 0);
		var drawMs = TOTAL_MS - lifts - DOT_MS;
		var t = 0;
		runs.forEach(function (r, i) {
			if (i) t += r.lift;
			r.start = t;
			r.dur = drawMs * weights[i] / sum;
			t += r.dur;
		});
		runs.forEach(function (r) {
			r.el.style.strokeDasharray = r.len + ' ' + (r.len + 2);
			r.over.forEach(function (o) { o.el.style.strokeDasharray = o.len + ' ' + (o.len + 2); });
		});
		return true;
	}

	// ---- animation ----------------------------------------------------------

	function render(ms) {
		runs.forEach(function (r) {
			var p = ease(clamp01((ms - r.start) / r.dur));
			r.el.style.strokeDashoffset = r.len * (1 - p);
			r.over.forEach(function (o) {
				var q = clamp01((p - o.a) / (o.b - o.a));
				o.el.style.strokeDashoffset = o.len * (1 - q);
			});
		});
		var dp = clamp01((ms - (TOTAL_MS - DOT_MS)) / DOT_MS);
		var pop = dp <= 0 ? 0 : (dp < 0.6 ? 1.35 * (dp / 0.6) : 1.35 - 0.35 * ((dp - 0.6) / 0.4));
		dot.setAttribute('r', (DOT.r * pop).toFixed(2));
	}
	function finish() { render(TOTAL_MS); }

	function frame(now) {
		raf = 0;
		var ms = now - t0;
		if (ms >= TOTAL_MS) { finish(); return; }
		render(ms);
		raf = requestAnimationFrame(frame);
	}
	function play() {
		if (!svg) return;
		if (raf) cancelAnimationFrame(raf);
		if (window.Gadgets.reducedMotion || debug === 'signature-full') { finish(); revealName(false); return; }
		if (debug === 'signature-half') { render(TOTAL_MS / 2); revealName(false); return; }
		revealName(!playedOnce);
		playedOnce = true;
		render(0);
		t0 = performance.now();
		paused = -1;
		raf = requestAnimationFrame(frame);
	}
	function revealName(animate) {
		if (!h3) return;
		if (revealTimer) { clearTimeout(revealTimer); revealTimer = 0; }
		h3.classList.remove('sig-name-pre');
		if (animate) {
			h3.classList.add('sig-name-in');
			h3.addEventListener('animationend', function done() { h3.classList.remove('sig-name-in'); h3.removeEventListener('animationend', done); });
		}
	}

	function onVisibility() {
		if (!svg) return;
		if (document.hidden) {
			if (raf) { cancelAnimationFrame(raf); raf = 0; paused = performance.now() - t0; }
		} else if (paused >= 0) {
			t0 = performance.now() - paused;
			paused = -1;
			raf = requestAnimationFrame(frame);
		}
	}
	function onClick() { if (!window.Gadgets.reducedMotion) play(); }

	var io = null;
	function armTrigger() {
		var panel = document.getElementById('leftPanel') || h3;
		if ('IntersectionObserver' in window) {
			io = new IntersectionObserver(function (entries) {
				if (entries.some(function (e) { return e.isIntersecting; })) {
					io.disconnect(); io = null;
					play();
				}
			}, { threshold: 0.15 });
			io.observe(panel);
			// Never leave the name hidden if the panel somehow never intersects.
			revealTimer = setTimeout(function () { revealTimer = 0; revealName(false); }, 2500);
		} else {
			play();
		}
	}

	function enable() {
		if (svg) return;
		if (!build()) return;
		if (!window.Gadgets.reducedMotion && !debug) h3.classList.add('sig-name-pre');
		render(0);
		wrap.addEventListener('click', onClick);
		document.addEventListener('visibilitychange', onVisibility);
		armTrigger();
	}
	function disable() {
		if (raf) { cancelAnimationFrame(raf); raf = 0; }
		if (io) { io.disconnect(); io = null; }
		if (revealTimer) { clearTimeout(revealTimer); revealTimer = 0; }
		document.removeEventListener('visibilitychange', onVisibility);
		if (wrap) {
			wrap.removeEventListener('click', onClick);
			if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
		}
		if (h3) { h3.classList.remove('sig-name-pre'); h3.classList.remove('sig-name-in'); }
		wrap = svg = dot = h3 = null;
		runs = [];
		playedOnce = false;
	}

	window.Gadgets.register('signature', { label: 'Signature', enable: enable, disable: disable });
})();
