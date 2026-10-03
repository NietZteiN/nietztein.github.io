// "Living portrait": the profile photo is a sky of clouds, so let it behave like
// one. A WebGL canvas laid exactly over the <img> redraws the same picture with
// slowly drifting clouds, a soft light that follows the pointer, a ripple on
// click, and (after dark in Texas) a dimmer sky with a few twinkling stars.
// A second, 2D canvas above it carries the weather: sakura petals in spring,
// snow in winter, a few leaves in autumn, and rain or snow whenever the Now
// card's cached Open-Meteo reading says so (thunder adds a rare soft flash).
// Double-clicking the photo cycles auto -> clear -> petals -> rain -> snow ->
// aurora; the choice is kept in localStorage 'gadgets.avatar.mode'.
// Now and then the navbar cat comes over and sits on the top edge of the frame
// (window.NavCat, see navcat.js).
//
// The <img> stays in place underneath for layout, alt text and the tilt gadget;
// every layer is a pointer-events:none sibling right after it. If WebGL or the
// cross-origin texture is unavailable the photo itself is left alone and only
// the 2D weather layer runs. Under prefers-reduced-motion nothing runs at all.
// Registered with the Gadgets registry as 'avatar'; disable() removes everything.
//
// Debug: ?gadgetDebug=avatar-day | avatar-dusk | avatar-night | avatar-petals |
// avatar-rain | avatar-snow | avatar-leaves | avatar-aurora | avatar-cat freezes
// the clock, the animation phase and the particles (seeded, mid-air) so headless
// screenshots are deterministic; avatar-cat also seats the cat on the frame.

(function () {
	'use strict';
	if (!window.Gadgets) return;

	var ZONE = 'America/Chicago';
	var MODE_KEY = 'gadgets.avatar.mode', WX_KEY = 'gadgets.now.wx', WX_MAX_AGE = 60 * 60 * 1000;
	var MODES = ['auto', 'clear', 'petals', 'rain', 'snow', 'aurora'];
	var debug = '';
	try { debug = new URLSearchParams(location.search).get('gadgetDebug') || ''; } catch (e) { debug = ''; }
	var FROZEN = /^avatar-/.test(debug);
	// Debug: [hour, mode, forced particle kind]
	var DEBUG = {
		'avatar-day': [13, 'clear'], 'avatar-dusk': [19.6, 'clear'], 'avatar-night': [23, 'clear'],
		'avatar-petals': [13, 'petals'], 'avatar-rain': [13, 'rain'], 'avatar-snow': [13, 'snow'],
		'avatar-leaves': [13, 'clear', 'leaves'], 'avatar-aurora': [23, 'aurora'], 'avatar-cat': [13, 'clear'],
	}[debug] || null;

	var VERT = 'attribute vec2 p; varying vec2 v; void main(){ v = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }';
	var FRAG = [
		'precision mediump float;',
		'varying vec2 v;',
		'uniform sampler2D tex;',
		'uniform float t, night, dusk, hover, rippleAge, aurora, gloom;',
		'uniform vec2 mouse, ripple;',
		'float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }',
		'float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);',
		'  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y); }',
		'float fbm(vec2 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++){ s += a * noise(p); p *= 2.03; a *= 0.5; } return s; }',
		'void main(){',
		'  vec2 uv = vec2(v.x, 1.0 - v.y);',
		// slow domain warp: the clouds churn and drift without the edges ever showing
		'  vec2 q = uv * 2.6;',
		'  vec2 w = vec2(fbm(q + vec2(t * 0.035, 0.0)), fbm(q + vec2(5.2, 1.3) - vec2(0.0, t * 0.028))) - 0.5;',
		'  float depth = smoothstep(0.15, 0.95, uv.y);',            // lower clouds move more than the high haze
		'  vec2 suv = (uv - 0.5) * 0.955 + 0.5 + w * (0.016 + 0.02 * depth);',
		'  suv.x += 0.006 * sin(t * 0.05 + uv.y * 3.0);',
		// pointer parallax
		'  suv += (mouse - 0.5) * -0.012 * hover * (0.4 + depth);',
		// click ripple
		'  if (rippleAge >= 0.0 && rippleAge < 2.4) {',
		'    vec2 d = uv - ripple; float r = length(d); float front = rippleAge * 0.55;',
		'    float wv = sin((r - front) * 46.0) * exp(-abs(r - front) * 14.0) * exp(-rippleAge * 1.6);',
		'    suv += normalize(d + 1e-5) * wv * 0.012;',
		'  }',
		'  vec3 c = texture2D(tex, clamp(suv, 0.001, 0.999)).rgb;',
		'  float l = dot(c, vec3(0.299, 0.587, 0.114));',
		// overcast: rain and snow take a little colour and light out of the sky
		'  c = mix(c, vec3(l) * vec3(0.74, 0.77, 0.86), gloom * 0.42);',
		// light that follows the pointer
		'  float g = exp(-dot(uv - mouse, uv - mouse) * 7.0) * hover;',
		'  c += vec3(1.0, 0.96, 0.9) * g * 0.10 * (0.5 + l);',
		// a slow breath of light across the whole sky
		'  c *= 1.0 + 0.025 * sin(t * 0.21 + uv.x * 2.0);',
		// golden hour, then night
		'  c = mix(c, c * vec3(1.10, 0.92, 0.82) + vec3(0.03, 0.0, -0.01), dusk * 0.6);',
		'  vec3 n = vec3(l) * vec3(0.20, 0.24, 0.42) + c * vec3(0.16, 0.18, 0.30);',
		'  c = mix(c, n, night * 0.82);',
		'  vec2 sg = floor(v * 150.0); float h = hash(sg);',
		'  float star = step(0.9965, h) * (0.55 + 0.45 * sin(t * (1.0 + h * 3.0) + h * 60.0));',
		'  vec2 sf = fract(v * 150.0) - 0.5; star *= smoothstep(0.5, 0.05, length(sf));',
		'  c += vec3(0.9, 0.93, 1.0) * star * night * (1.0 - smoothstep(0.25, 0.7, l)) * smoothstep(0.35, 0.9, v.y) * 0.9;',
		// aurora: a slow green-violet curtain hung in the upper sky, strongest at night
		'  if (aurora > 0.003) {',
		'    float ax = uv.x * 2.2 + (fbm(vec2(uv.x * 1.7 + t * 0.021, t * 0.017)) - 0.5) * 2.4;',
		'    float band = fbm(vec2(ax * 1.3, t * 0.03));',
		'    float hem = 0.30 + 0.30 * band + 0.05 * sin(ax * 2.3 + t * 0.06);',
		'    float rays = 0.55 + 0.45 * sin(ax * 11.0 + fbm(vec2(ax * 4.0, t * 0.045)) * 7.0);',
		'    float prof = smoothstep(hem + 0.07, hem - 0.02, uv.y) * (0.22 + 0.78 * smoothstep(-0.12, hem, uv.y));',
		'    vec3 ac = mix(vec3(0.22, 1.0, 0.56), vec3(0.58, 0.34, 1.0), smoothstep(hem, hem - 0.34, uv.y));',
		'    float ai = prof * (0.45 + 0.55 * rays) * (0.5 + 0.5 * band) * aurora * (0.30 + 0.70 * night);',
		'    c += ac * ai * 0.62 * (1.0 - c * 0.7);',
		'  }',
		'  gl_FragColor = vec4(c, 1.0);',
		'}',
	].join('\n');
	var UNIFORMS = ['t', 'night', 'dusk', 'hover', 'mouse', 'ripple', 'rippleAge', 'aurora', 'gloom'];

	var img = null, canvas = null, gl = null, prog = null, tex = null, loader = null;
	var fx = null, ctx = null, cap = null, perchEl = null;
	var uni = {}, raf = 0, running = false, visible = true, io = null;
	var mouse = [0.5, 0.35], mouseT = [0.5, 0.35], hover = 0, hoverT = 0;
	var ripple = [0.5, 0.5], rippleStart = -1e9, t0 = 0, lastDraw = 0;
	var parentTouched = null, parentPrevPos = '';
	var box = { l: -1, t: -1, w: 0, h: 0, cw: 0, ch: 0, dpr: 1 };

	function clamp01(x) { return Math.max(0, Math.min(1, x)); }
	function localHour() {
		if (DEBUG) return DEBUG[0];
		try {
			var parts = new Intl.DateTimeFormat('en-US', { timeZone: ZONE, hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(new Date());
			var h = 0, m = 0;
			parts.forEach(function (p) { if (p.type === 'hour') h = +p.value % 24; if (p.type === 'minute') m = +p.value; });
			return h + m / 60;
		} catch (e) { var d = new Date(); return d.getHours() + d.getMinutes() / 60; }
	}
	function localMonth() {
		try {
			return +new Intl.DateTimeFormat('en-US', { timeZone: ZONE, month: 'numeric' }).format(new Date()) || (new Date().getMonth() + 1);
		} catch (e) { return new Date().getMonth() + 1; }
	}
	function smooth(a, b, x) { var k = clamp01((x - a) / (b - a)); return k * k * (3 - 2 * k); }
	// 0 by day, 1 at night; dusk peaks around sunrise and sunset.
	function skyState() {
		var h = localHour();
		var night = clamp01(1 - smooth(5.5, 7.5, h) + smooth(19, 21, h));
		var dusk = Math.max(0, 1 - Math.abs(h - 19.6) / 1.3) + Math.max(0, 1 - Math.abs(h - 6.6) / 1.1);
		return { night: night, dusk: Math.min(1, dusk) };
	}

	// ---- Mode: what the sky is doing -------------------------------------------
	var mode = 'auto';
	// eff: the resolved weather. kind: none | petals | leaves | rain | snow.
	var eff = { kind: 'none', thunder: false, aurora: 0, gloom: 0, label: 'clear' };
	var sky = { night: 0, dusk: 0 }, effAt = -1e9;
	var aur = 0, gloom = 0;

	function loadMode() {
		if (DEBUG) return DEBUG[1];
		try { var m = localStorage.getItem(MODE_KEY); if (MODES.indexOf(m) >= 0) return m; } catch (e) { /* private mode */ }
		return 'auto';
	}
	function saveMode() {
		try { localStorage.setItem(MODE_KEY, mode); } catch (e) { /* private mode */ }
	}
	// The Now card's last Open-Meteo "current" block: { weather_code, is_day, ... }.
	function cachedWeatherCode() {
		try {
			var v = JSON.parse(localStorage.getItem(WX_KEY) || 'null');
			if (v && v.t && Date.now() - v.t < WX_MAX_AGE && v.data && v.data.weather_code != null) {
				var c = +v.data.weather_code;
				return isNaN(c) ? -1 : c;
			}
		} catch (e) { /* ignore */ }
		return -1;
	}
	function resolve() {
		var out = { kind: 'none', thunder: false, aurora: 0, gloom: 0, label: 'clear' };
		if (DEBUG && DEBUG[2]) { out.kind = DEBUG[2]; out.label = DEBUG[2]; return out; }
		if (mode === 'petals') out.kind = 'petals';
		else if (mode === 'rain') { out.kind = 'rain'; out.gloom = 0.7; }
		else if (mode === 'snow') { out.kind = 'snow'; out.gloom = 0.4; }
		else if (mode === 'aurora') out.aurora = 1;
		else if (mode === 'auto') {
			var c = cachedWeatherCode();
			if ((c >= 51 && c <= 67) || (c >= 80 && c <= 82) || (c >= 95 && c <= 99)) {
				out.kind = 'rain'; out.gloom = c >= 95 ? 1 : 0.8; out.thunder = c >= 95;
			} else if ((c >= 71 && c <= 77) || c === 85 || c === 86) {
				out.kind = 'snow'; out.gloom = 0.5;
			} else {
				var m = localMonth();
				if (m >= 3 && m <= 5) out.kind = 'petals';
				else if (m === 12 || m <= 2) out.kind = 'snow';
				else if (m >= 9 && m <= 11) out.kind = 'leaves';
			}
		}
		out.label = out.aurora ? 'aurora' : out.thunder ? 'storm' : out.kind === 'none' ? 'clear' : out.kind;
		return out;
	}
	function refresh(now) {
		effAt = now;
		sky = skyState();
		var next = resolve();
		var changed = next.kind !== eff.kind;
		eff = next;
		if (changed) repopulate(false);
	}

	// ---- Particles (2D canvas) ---------------------------------------------------
	var parts = [], ptime = 0, flashStart = -1e9, flashNext = 0;
	var seed = 20261003;
	// Seeded while frozen so a debug screenshot always shows the same frame.
	function rnd() {
		if (!FROZEN) return Math.random();
		seed = (seed + 0x6D2B79F5) | 0;
		var x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
		x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
		return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
	}
	var COUNT = { petals: 13, snow: 30, rain: 34, leaves: 3, none: 0 };
	var PETAL = [[255, 168, 198], [255, 196, 216], [246, 140, 180], [255, 214, 228]];
	var LEAF = [[204, 112, 44], [176, 80, 40], [216, 152, 52]];

	// Put a particle at the top (fresh = false) or anywhere in the box (fresh = true).
	function seat(p, fresh) {
		var w = box.w || 260, h = box.h || 260, z = p.z;
		switch (p.kind) {
			case 'petals':
			case 'leaves':
				p.x = rnd() * w * 1.25 - w * 0.3;
				p.y = fresh ? rnd() * h : -8 - rnd() * h * 0.25;
				break;
			case 'snow':
				p.x = rnd() * w;
				p.y = fresh ? rnd() * h : -4 - rnd() * h * 0.2;
				break;
			default:   // rain slants left, so it enters from the top and the right
				p.x = rnd() * w * 1.3;
				p.y = fresh ? rnd() * h * 1.2 - h * 0.2 : -(p.len + rnd() * h * 0.6);
		}
		return z;
	}
	function make(kind) {
		var z = rnd(), p = { kind: kind, z: z, x: 0, y: 0, out: false, fade: FROZEN ? 1 : 0 };
		p.ph = rnd() * 6.283; p.sf = 0.5 + rnd() * 0.9;
		switch (kind) {
			case 'petals':
				p.s = 2.6 + z * 3.2; p.vy = 9 + z * 15; p.vx = 4 + z * 9; p.sa = 6 + rnd() * 10;
				p.rot = rnd() * 6.283; p.rs = (rnd() < 0.5 ? -1 : 1) * (0.3 + rnd() * 0.8);
				p.fl = rnd() * 6.283; p.fs = 0.8 + rnd() * 1.4;
				p.a = 0.5 + z * 0.42; p.col = PETAL[Math.floor(rnd() * PETAL.length)];
				break;
			case 'leaves':
				p.s = 3.6 + z * 2.8; p.vy = 11 + z * 13; p.vx = 7 + z * 10; p.sa = 9 + rnd() * 10;
				p.rot = rnd() * 6.283; p.rs = (rnd() < 0.5 ? -1 : 1) * (0.4 + rnd() * 0.9);
				p.fl = rnd() * 6.283; p.fs = 0.7 + rnd() * 1.1;
				p.a = 0.62 + z * 0.33; p.col = LEAF[Math.floor(rnd() * LEAF.length)];
				break;
			case 'snow':
				p.s = 0.8 + z * 1.7; p.vy = 8 + z * 15; p.vx = 2 + z * 3; p.sa = 4 + rnd() * 7;
				p.a = 0.5 + z * 0.45;
				break;
			default:
				p.len = 7 + z * 11; p.vy = 105 + z * 115; p.vx = -0.2 * p.vy; p.s = 0.7 + z * 0.6;
				p.a = 0.24 + z * 0.3;
		}
		seat(p, true);
		return p;
	}
	function repopulate(instant) {
		var i;
		for (i = 0; i < parts.length; i++) parts[i].out = true;
		if (instant) parts.length = 0;
		var scale = Math.max(0.5, Math.min(2, ((box.w || 260) * (box.h || 260)) / 67600));
		var n = Math.round((COUNT[eff.kind] || 0) * scale);
		if (eff.kind === 'leaves') n = Math.max(2, Math.min(4, n));
		for (i = 0; i < n; i++) parts.push(make(eff.kind));
	}
	function stepParticles(dt) {
		var w = box.w, h = box.h, i, p;
		ptime += dt;
		for (i = parts.length - 1; i >= 0; i--) {
			p = parts[i];
			p.fade = clamp01(p.fade + (p.out ? -dt / 0.8 : dt / 1.6));
			if (p.out && p.fade <= 0) { parts.splice(i, 1); continue; }
			p.y += p.vy * dt;
			if (p.kind === 'rain') p.x += p.vx * dt;
			else {
				p.x += (p.vx + Math.sin(ptime * p.sf + p.ph) * p.sa) * dt;
				if (p.rs) { p.rot += p.rs * dt; p.fl += p.fs * dt; }
			}
			if (p.y > h + 14 || p.x > w + 40 || p.x < -w * 0.4) {
				if (p.out) parts.splice(i, 1); else seat(p, false);
			}
		}
	}
	function drawParticles(now) {
		var w = box.w, h = box.h, d = box.dpr, i, p, a, lit, dx, dy, c, s, k;
		ctx.setTransform(d, 0, 0, d, 0, 0);
		ctx.clearRect(0, 0, w, h);
		// Without WebGL the aurora has no shader to live in: a faint wash instead.
		if (!gl && aur > 0.01) {
			var gr = ctx.createLinearGradient(0, 0, 0, h * 0.62);
			var ai = aur * (0.3 + 0.7 * sky.night) * 0.4;
			gr.addColorStop(0, 'rgba(148,87,255,' + (ai * 0.5).toFixed(3) + ')');
			gr.addColorStop(0.7, 'rgba(56,255,143,' + ai.toFixed(3) + ')');
			gr.addColorStop(1, 'rgba(56,255,143,0)');
			ctx.fillStyle = gr;
			ctx.fillRect(0, 0, w, h);
		}
		var dim = 1 - 0.5 * sky.night;   // things in the air go dark with the sky
		ctx.lineCap = 'round';
		for (i = 0; i < parts.length; i++) {
			p = parts[i];
			dx = p.x / w - mouse[0]; dy = p.y / h - mouse[1];
			lit = Math.exp(-(dx * dx + dy * dy) * 7) * hover;    // the pointer light catches them too
			a = Math.min(1, p.a * p.fade * (1 + 0.7 * lit));
			if (a <= 0.01) continue;
			if (p.kind === 'rain') {
				k = p.len / p.vy;
				c = Math.round(232 * (dim + (1 - dim) * 0.4) + 20 * lit);
				ctx.strokeStyle = 'rgba(' + c + ',' + Math.min(255, c + 6) + ',' + Math.min(255, c + 20) + ',' + a.toFixed(3) + ')';
				ctx.lineWidth = p.s;
				ctx.beginPath();
				ctx.moveTo(p.x, p.y);
				ctx.lineTo(p.x - p.vx * k, p.y - p.len);
				ctx.stroke();
			} else if (p.kind === 'snow') {
				// a cool rim first, so a flake still reads against the white cloud
				ctx.fillStyle = 'rgba(126,134,186,' + (a * 0.34).toFixed(3) + ')';
				ctx.beginPath(); ctx.arc(p.x, p.y + 0.4, p.s + 0.9, 0, 6.2832); ctx.fill();
				c = Math.round(255 * (0.55 + 0.45 * dim));
				ctx.fillStyle = 'rgba(' + c + ',' + c + ',' + Math.min(255, c + 12) + ',' + a.toFixed(3) + ')';
				ctx.beginPath(); ctx.arc(p.x, p.y, p.s, 0, 6.2832); ctx.fill();
			} else {
				c = p.col; s = p.s;
				k = dim + lit * 0.12;
				ctx.save();
				ctx.translate(p.x, p.y);
				ctx.rotate(p.rot);
				ctx.scale(1, 0.3 + 0.7 * Math.abs(Math.cos(p.fl)));
				ctx.fillStyle = 'rgba(' + Math.min(255, Math.round(c[0] * k)) + ',' + Math.min(255, Math.round(c[1] * k)) + ',' + Math.min(255, Math.round(c[2] * (k + (1 - dim) * 0.3))) + ',' + a.toFixed(3) + ')';
				ctx.beginPath();
				ctx.moveTo(-s, 0);
				if (p.kind === 'petals') {
					// a sakura petal: pointed at the stem, notched at the tip
					ctx.bezierCurveTo(-s * 0.45, -s * 0.8, s * 0.7, -s * 0.72, s, -s * 0.2);
					ctx.lineTo(s * 0.76, 0);
					ctx.lineTo(s, s * 0.2);
					ctx.bezierCurveTo(s * 0.7, s * 0.72, -s * 0.45, s * 0.8, -s, 0);
				} else {
					ctx.quadraticCurveTo(0, -s * 0.78, s, 0);
					ctx.quadraticCurveTo(0, s * 0.78, -s, 0);
				}
				ctx.fill();
				if (p.kind === 'leaves') {
					ctx.strokeStyle = 'rgba(96,44,20,' + (a * 0.5).toFixed(3) + ')';
					ctx.lineWidth = 0.6;
					ctx.beginPath(); ctx.moveTo(-s * 1.25, 0); ctx.lineTo(s * 0.8, 0); ctx.stroke();
				} else {
					ctx.fillStyle = 'rgba(255,255,255,' + (a * 0.4 * dim).toFixed(3) + ')';
					ctx.beginPath(); ctx.ellipse(s * 0.15, -s * 0.12, s * 0.5, s * 0.22, 0, 0, 6.2832); ctx.fill();
				}
				ctx.restore();
			}
		}
		// thunder: a rare, soft double flash
		if (eff.thunder && !FROZEN) {
			if (!flashNext) flashNext = now + 9000 + Math.random() * 20000;
			if (now >= flashNext) { flashStart = now; flashNext = now + 22000 + Math.random() * 45000; }
			var age = (now - flashStart) / 1000;
			if (age >= 0 && age < 0.9) {
				var f = Math.exp(-age * 5) * ((age < 0.1 || (age > 0.2 && age < 0.32)) ? 1 : 0.4) * 0.2;
				ctx.fillStyle = 'rgba(244,246,255,' + f.toFixed(3) + ')';
				ctx.fillRect(0, 0, w, h);
			}
		}
	}

	// ---- Layout ------------------------------------------------------------------

	// Keep every layer a sibling right after the image (the tilt gadget may move the
	// image into its own wrapper at any time) and exactly over its box.
	function place() {
		if (!img || !fx) return false;
		var parent = img.parentNode;
		if (!parent) return false;
		var moved = false;
		if (fx.parentNode !== parent) {
			restoreParent();
			if (getComputedStyle(parent).position === 'static') {
				parentTouched = parent; parentPrevPos = parent.style.position; parent.style.position = 'relative';
			}
			moved = true;
		}
		var layers = [canvas, fx, perchEl, cap], prev = img, i, el;
		for (i = 0; i < layers.length; i++) {
			el = layers[i];
			if (!el) continue;
			if (el.parentNode !== parent || el.previousSibling !== prev) { parent.insertBefore(el, prev.nextSibling); moved = true; }
			prev = el;
		}
		var w = img.offsetWidth, h = img.offsetHeight;
		if (!w || !h) return false;
		var l = img.offsetLeft, t = img.offsetTop;
		var dpr = Math.min(2, window.devicePixelRatio || 1);
		if (moved || l !== box.l || t !== box.t || w !== box.w || h !== box.h || dpr !== box.dpr) {
			var ow = box.w, oh = box.h;
			box.l = l; box.t = t; box.w = w; box.h = h; box.dpr = dpr;
			box.cw = Math.round(w * dpr); box.ch = Math.round(h * dpr);
			var radius = getComputedStyle(img).borderRadius;
			[canvas, fx].forEach(function (c) {
				if (!c) return;
				var s = c.style;
				s.left = l + 'px'; s.top = t + 'px'; s.width = w + 'px'; s.height = h + 'px';
				s.borderRadius = radius;
			});
			if (fx.width !== box.cw || fx.height !== box.ch) { fx.width = box.cw; fx.height = box.ch; }
			cap.style.left = (l + 9) + 'px';
			cap.style.top = (t + h - 9) + 'px';
			placePerch();
			if (w !== ow || h !== oh) settleParticles(ow, oh);
		}
		if (canvas && gl && (canvas.width !== box.cw || canvas.height !== box.ch)) {
			canvas.width = box.cw; canvas.height = box.ch; gl.viewport(0, 0, box.cw, box.ch);
		}
		return true;
	}
	function restoreParent() {
		if (parentTouched) { parentTouched.style.position = parentPrevPos; parentTouched = null; }
	}
	// The box is known, or has changed (the photo loads after the first layout):
	// spread the particles over it. While frozen, also run the simulation forward
	// from the same seed so the frame looks lived-in and is always the same one.
	function settleParticles(ow, oh) {
		var i;
		if (FROZEN) {
			seed = 20261003; ptime = 0;
			repopulate(true);
			for (i = 0; i < 80; i++) stepParticles(0.05);
		} else if (!ow || !oh) {
			repopulate(true);
		} else {
			for (i = 0; i < parts.length; i++) { parts[i].x *= box.w / ow; parts[i].y *= box.h / oh; }
			var area = (box.w * box.h) / (ow * oh);
			if (area > 1.3 || area < 0.77) repopulate(false);
		}
	}

	function frame(now) {
		raf = 0;
		if (!running) return;
		if (visible && !document.hidden && now - lastDraw > 30) {
			var dt = Math.min(0.1, (now - lastDraw) / 1000);
			lastDraw = now;
			if (now - effAt > 20000) refresh(now);
			if (place()) {
				var k = 0.08;
				mouse[0] += (mouseT[0] - mouse[0]) * k; mouse[1] += (mouseT[1] - mouse[1]) * k;
				hover += (hoverT - hover) * 0.06;
				if (FROZEN) { aur = eff.aurora; gloom = eff.gloom; }
				else { aur += (eff.aurora - aur) * 0.035; gloom += (eff.gloom - gloom) * 0.03; }
				if (gl) {
					gl.uniform1f(uni.t, FROZEN ? 40 : (now - t0) / 1000);
					gl.uniform1f(uni.night, sky.night);
					gl.uniform1f(uni.dusk, sky.dusk);
					gl.uniform1f(uni.hover, hover);
					gl.uniform2f(uni.mouse, mouse[0], mouse[1]);
					gl.uniform2f(uni.ripple, ripple[0], ripple[1]);
					gl.uniform1f(uni.rippleAge, FROZEN ? -1 : (now - rippleStart) / 1000);
					gl.uniform1f(uni.aurora, aur);
					gl.uniform1f(uni.gloom, gloom);
					gl.drawArrays(gl.TRIANGLES, 0, 3);
				}
				if (!FROZEN) stepParticles(dt);
				drawParticles(now);
			}
		}
		raf = requestAnimationFrame(frame);
	}

	// ---- Pointer -------------------------------------------------------------------
	var capTimer = 0;

	function rel(e) {
		var r = img.getBoundingClientRect();
		return [clamp01((e.clientX - r.left) / r.width), clamp01((e.clientY - r.top) / r.height)];
	}
	function onMove(e) { mouseT = rel(e); hoverT = 1; }
	function onLeave() { hoverT = 0; }
	// The second click of a double-click changes the mode instead of rippling again.
	function onClick(e) { if (e.detail > 1) return; ripple = rel(e); rippleStart = performance.now(); }
	function onDblClick(e) {
		if (DEBUG) return;
		e.preventDefault();
		mode = MODES[(MODES.indexOf(mode) + 1) % MODES.length];
		saveMode();
		refresh(performance.now());
		showCaption(mode === 'auto' ? 'auto · ' + eff.label : mode);
	}
	function showCaption(text) {
		if (!cap) return;
		cap.textContent = text;
		cap.classList.add('is-on');
		if (capTimer) clearTimeout(capTimer);
		capTimer = setTimeout(function () { capTimer = 0; if (cap) cap.classList.remove('is-on'); }, 1700);
	}

	// ---- The cat comes to visit ----------------------------------------------------
	// navcat.js owns the cat; this side only offers it a seat (perchEl, kept on the
	// photo's top edge by place()) now and then and takes the seat away when the
	// photo is not on show. See window.NavCat in navcat.js.
	var catTimer = 0, catOut = false, nextCatAt = 0, perchFrac = 0.7;

	function onAbout() {
		var m = /^#\/([^\/?]+)/.exec(location.hash || '');
		return !m || m[1] === 'about';
	}
	function placePerch() {
		if (!perchEl || !box.w) return;
		perchEl.style.left = Math.round(box.l + (box.w - 24) * perchFrac) + 'px';
		perchEl.style.top = (box.t - 15) + 'px';   // sprite row 14 is the cat's feet
	}
	function catWelcome() {
		return running && visible && !document.hidden && !window.Gadgets.reducedMotion && onAbout() &&
			window.innerWidth >= 768 && box.w > 0 && img && img.offsetWidth > 0 &&
			window.NavCat && window.Gadgets.enabled('navcat') && perchEl && perchEl.parentNode;
	}
	function catTick() {
		if (!running) return;
		var cat = window.NavCat;
		if (catOut) {
			if (!catWelcome() && cat) cat.leave(!visible || document.hidden || window.Gadgets.reducedMotion || !img.offsetWidth);
			return;
		}
		if (!catWelcome()) return;
		if (debug === 'avatar-cat') {
			if (cat.visit(perchEl, { instant: true, hold: true })) catOut = true;
			return;
		}
		if (FROZEN) return;
		var now = performance.now();
		if (now < nextCatAt) return;
		perchFrac = 0.5 + Math.random() * 0.4;
		placePerch();
		if (cat.visit(perchEl, { ms: 20000 + Math.random() * 20000 })) catOut = true;
	}
	function onCatLeft() {
		catOut = false;
		nextCatAt = performance.now() + (240 + Math.random() * 240) * 1000;   // not again for 4 to 8 minutes
	}
	function onHash() { if (catOut) catTick(); }

	// ---- WebGL layer ----------------------------------------------------------------

	function compile(type, src) {
		var s = gl.createShader(type);
		gl.shaderSource(s, src); gl.compileShader(s);
		if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader');
		return s;
	}
	function dropGL() {
		if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas);
		if (gl) { var ext = gl.getExtension('WEBGL_lose_context'); if (ext) { try { ext.loseContext(); } catch (e) { /* ignore */ } } }
		canvas = null; gl = null; prog = null; tex = null; uni = {};
	}
	function startGL() {
		if (!running || gl) return;
		var c = document.createElement('canvas');
		c.className = 'gavatar-canvas';
		c.setAttribute('aria-hidden', 'true');
		try {
			gl = c.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'low-power' });
			if (!gl) throw new Error('no webgl');
			prog = gl.createProgram();
			gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
			gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
			gl.linkProgram(prog);
			if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('link');
			gl.useProgram(prog);
			var buf = gl.createBuffer();
			gl.bindBuffer(gl.ARRAY_BUFFER, buf);
			gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
			var loc = gl.getAttribLocation(prog, 'p');
			gl.enableVertexAttribArray(loc);
			gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
			UNIFORMS.forEach(function (n) { uni[n] = gl.getUniformLocation(prog, n); });
			tex = gl.createTexture();
			gl.bindTexture(gl.TEXTURE_2D, tex);
			gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, loader);   // throws if the image is tainted
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
		} catch (e) {
			gl = null; prog = null; tex = null; uni = {};
			return;   // leave the plain photo exactly as it is; the weather layer carries on
		}
		canvas = c;
		canvas.addEventListener('webglcontextlost', function (ev) { ev.preventDefault(); dropGL(); });
		t0 = performance.now();
		box.l = -1;   // force a re-layout so the new canvas gets its box
		place();
		requestAnimationFrame(function () { if (canvas) canvas.classList.add('is-on'); });
	}

	// ---- Lifecycle -------------------------------------------------------------------

	function enable() {
		if (running) return;
		if (window.Gadgets.reducedMotion && !FROZEN) return;   // a still photo is the reduced-motion version
		img = document.querySelector('#leftPanel img.profilepicture') || document.querySelector('#leftPanel img');
		if (!img) return;
		fx = document.createElement('canvas');
		ctx = fx.getContext && fx.getContext('2d');
		if (!ctx) { fx = null; img = null; return; }
		running = true;
		fx.className = 'gavatar-fx';
		fx.setAttribute('aria-hidden', 'true');
		cap = document.createElement('span');
		cap.className = 'gavatar-cap';
		cap.setAttribute('aria-hidden', 'true');
		perchEl = document.createElement('div');
		perchEl.className = 'gavatar-perch';
		perchEl.setAttribute('aria-hidden', 'true');

		mode = loadMode();
		box.w = 0; box.l = -1;
		parts.length = 0; ptime = 0; seed = 20261003; flashNext = 0; flashStart = -1e9;
		eff = { kind: 'none', thunder: false, aurora: 0, gloom: 0, label: 'clear' };
		refresh(performance.now());
		aur = 0; gloom = 0;

		img.addEventListener('pointermove', onMove);
		img.addEventListener('pointerleave', onLeave);
		img.addEventListener('click', onClick);
		img.addEventListener('dblclick', onDblClick);
		if (window.IntersectionObserver) {
			io = new IntersectionObserver(function (es) { visible = es[0].isIntersecting; if (!visible && catOut) catTick(); });
			io.observe(img);
		}
		document.addEventListener('navcat:left', onCatLeft);
		window.addEventListener('hashchange', onHash);
		catOut = false;
		nextCatAt = performance.now() + (50 + Math.random() * 70) * 1000;   // first visit after a minute or two
		catTimer = setInterval(catTick, debug === 'avatar-cat' ? 250 : 5000);

		t0 = performance.now();
		lastDraw = 0;
		place();
		requestAnimationFrame(function () { if (fx) fx.classList.add('is-on'); });
		raf = requestAnimationFrame(frame);

		// Load a CORS-clean copy for the texture; the visible <img> is untouched.
		// github.com/<user>.png redirects to the avatar host, and that redirect carries
		// no CORS header, so try the avatar host directly first.
		var src = img.currentSrc || img.src;
		var GH = 'https://github.com/';
		var user = src.indexOf(GH) === 0 && src.slice(-4) === '.png' ? src.slice(GH.length, -4) : '';
		var candidates = (user && user.indexOf('/') < 0 ? ['https://avatars.githubusercontent.com/' + user + '?s=600'] : []).concat([src]);
		var tryNext = function () {
			if (!running) return;
			var url = candidates.shift();
			if (!url) return;   // no texture: the photo stays plain under the weather layer
			loader = new Image();
			loader.crossOrigin = 'anonymous';
			loader.onload = startGL;
			loader.onerror = tryNext;
			loader.src = url;
		};
		tryNext();
	}

	function disable() {
		running = false;
		if (raf) cancelAnimationFrame(raf);
		raf = 0;
		if (catTimer) { clearInterval(catTimer); catTimer = 0; }
		if (capTimer) { clearTimeout(capTimer); capTimer = 0; }
		// Send the cat home before its seat goes away.
		if (catOut && window.NavCat) { try { window.NavCat.leave(true); } catch (e) { /* ignore */ } }
		catOut = false;
		document.removeEventListener('navcat:left', onCatLeft);
		window.removeEventListener('hashchange', onHash);
		if (io) { io.disconnect(); io = null; }
		if (img) {
			img.removeEventListener('pointermove', onMove);
			img.removeEventListener('pointerleave', onLeave);
			img.removeEventListener('click', onClick);
			img.removeEventListener('dblclick', onDblClick);
		}
		dropGL();
		[fx, cap, perchEl].forEach(function (el) { if (el && el.parentNode) el.parentNode.removeChild(el); });
		restoreParent();
		if (loader) { loader.onload = null; loader.onerror = null; }
		fx = null; ctx = null; cap = null; perchEl = null; loader = null; img = null;
		parts.length = 0;
		hover = 0; hoverT = 0; visible = true;
		box.w = 0; box.l = -1;
	}

	window.Gadgets.register('avatar', { label: 'Living portrait', enable: enable, disable: disable });
})();
