// Gadget "ambient": a full-viewport WebGL canvas behind the page.
//
//   dark  theme -> a slow, deep aurora/nebula (domain-warped fbm in the site
//                  accent blue, a violet and a warm peach, peaking at ~12 %
//                  alpha over #0f1115) plus two layers of parallax stars that
//                  drift a few pixels with the cursor and the scroll position.
//   light theme -> soft cumulus in whites and the faintest pink over #ffffff,
//                  echoing the profile photo, also parallaxed.
//
// Raw WebGL1, one fragment shader, no libraries. Rendered at half resolution
// (quarter on touch/narrow screens) and upscaled by CSS; capped at 30 fps;
// paused when the tab is hidden or the canvas is not visible; a single static
// frame under prefers-reduced-motion; off entirely on Save-Data, on touch
// devices with fewer than four hardware threads, or when WebGL is missing.
// Theme switches crossfade the two looks inside the shader (u_mix).
//
// Debug: ?gadgetDebug=ambient-dark or ?gadgetDebug=ambient-light forces that
// theme's look as one static mid-animation frame (for screenshots).
//
// Switch off: Gadgets.set('ambient', false) (persists in localStorage).

(function () {
	'use strict';

	if (!window.Gadgets) return;

	var ID = 'gadget-ambient';
	var FPS_CAP = 30;
	var FADE_SECONDS = 0.9;          // theme crossfade length
	var DEBUG_TIME = 47.0;           // seconds into the animation for debug frames

	var VERT = [
		'attribute vec2 a_pos;',
		'void main(){ gl_Position = vec4(a_pos, 0.0, 1.0); }',
	].join('\n');

	var FRAG = [
		'#ifdef GL_FRAGMENT_PRECISION_HIGH',
		'precision highp float;',
		'#else',
		'precision mediump float;',
		'#endif',
		'uniform vec2  u_res;',     // canvas size in render pixels
		'uniform float u_scale;',   // render pixels per CSS pixel
		'uniform float u_time;',    // seconds
		'uniform float u_mix;',     // 0 = light (clouds), 1 = dark (aurora)
		'uniform vec2  u_par;',     // cursor parallax, -1..1
		'uniform float u_scroll;',  // scrollY in CSS pixels
		'',
		'float hash(vec2 p){',
		'  vec3 p3 = fract(vec3(p.xyx) * 0.1031);',
		'  p3 += dot(p3, p3.yzx + 33.33);',
		'  return fract((p3.x + p3.y) * p3.z);',
		'}',
		'float noise(vec2 p){',
		'  vec2 i = floor(p); vec2 f = fract(p);',
		'  f = f * f * (3.0 - 2.0 * f);',
		'  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),',
		'             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);',
		'}',
		'const mat2 ROT = mat2(1.6, 1.2, -1.2, 1.6);',
		'float fbm4(vec2 p){',
		'  float v = 0.0; float a = 0.5;',
		'  for (int i = 0; i < 4; i++) { v += a * noise(p); p = ROT * p; a *= 0.5; }',
		'  return v;',
		'}',
		'float fbm5(vec2 p){',
		'  float v = 0.0; float a = 0.5;',
		'  for (int i = 0; i < 5; i++) { v += a * noise(p); p = ROT * p; a *= 0.5; }',
		'  return v;',
		'}',
		'',
		// One sparse star layer: a grid of cells, one star per occupied cell.
		'float stars(vec2 px, vec2 off, float cell, float density, float t){',
		'  vec2 g = (px + off) / cell;',
		'  vec2 i = floor(g); vec2 f = fract(g);',
		'  float h = hash(i + 7.3);',
		'  if (h > density) return 0.0;',
		'  vec2 c = vec2(hash(i + 0.37), hash(i + 0.71)) * 0.7 + 0.15;',
		'  float d = length(f - c) * cell;',
		'  float tw = 0.65 + 0.35 * sin(t * (0.4 + h * 1.6) + h * 6.2832);',
		'  float b = 0.35 + 0.65 * hash(i + 0.13);',
		'  return smoothstep(1.3, 0.0, d) * tw * b;',
		'}',
		'',
		'vec4 aurora(vec2 uv, vec2 px, float t){',
		'  vec2 p = uv * 1.5 + u_par * 0.05 + vec2(0.0, u_scroll * 0.00025);',
		'  float s = t * 0.035;',
		'  vec2 q = vec2(fbm4(p + vec2(0.0, s)), fbm4(p + vec2(5.2, 1.3) - s * 0.7));',
		'  vec2 r = vec2(fbm4(p + 3.5 * q + vec2(1.7, 9.2) + 0.15 * s),',
		'                fbm4(p + 3.5 * q + vec2(8.3, 2.8) + 0.126 * s));',
		'  float f = fbm5(p + 3.0 * r);',
		// A broad diagonal band so it reads as a curtain, not a flat fog.
		'  float band = exp(-pow((uv.y - 0.22 * sin(uv.x * 1.3 + s * 2.0) + 0.05) / 0.55, 2.0));',
		'  float glow = smoothstep(0.38, 0.85, f) * (0.35 + 0.65 * band);',
		'  vec3 blue   = vec3(0.486, 0.702, 1.000);',   // #7cb3ff accent
		'  vec3 violet = vec3(0.560, 0.360, 1.000);',
		'  vec3 peach  = vec3(1.000, 0.620, 0.380);',   // warm counterpoint
		'  vec3 col = mix(blue, violet, smoothstep(0.25, 0.75, q.y));',
		'  col = mix(col, peach, smoothstep(0.55, 0.9, r.x) * 0.8);',
		'  float a = glow * 0.13;',
		// Stars: two parallax layers in render pixels (cells sized in CSS px).
		'  float c1 = 64.0 * u_scale; float c2 = 112.0 * u_scale;',
		'  float st = stars(px, (u_par * 5.0 + vec2(0.0, u_scroll * 0.06)) * u_scale, c1, 0.30, t);',
		'  st += stars(px, (u_par * 11.0 + vec2(0.0, u_scroll * 0.14)) * u_scale + vec2(13.0, 29.0), c2, 0.34, t * 1.3) * 1.15;',
		'  st *= 0.30;',
		'  vec3 starCol = mix(vec3(0.85, 0.90, 1.0), vec3(1.0, 0.95, 0.88), hash(floor(px / 7.0)));',
		'  vec3 outCol = col * a + starCol * st;',
		'  return vec4(outCol, min(1.0, a + st));',
		'}',
		'',
		'vec4 clouds(vec2 uv, float t){',
		'  vec2 p = uv * 1.25 + u_par * 0.03 + vec2(t * 0.012, u_scroll * 0.0002);',
		'  float w = fbm4(p * 2.0 + vec2(0.0, t * 0.02));',
		'  float n = fbm5(p + vec2(0.0, 0.35 * w) + vec2(0.0, t * 0.004));',
		'  float cloud = smoothstep(0.40, 0.72, n);',
		// Bright cores stay white (transparent); rims and undersides blush.
		'  float core = smoothstep(0.62, 0.90, n);',
		'  float shade = fbm4(p * 2.3 + 3.1);',
		'  vec3 pink  = vec3(1.000, 0.780, 0.860);',
		'  vec3 lilac = vec3(0.835, 0.820, 0.930);',
		'  vec3 col = mix(lilac, pink, smoothstep(0.30, 0.70, shade));',
		'  float a = cloud * (1.0 - 0.55 * core) * 0.22;',
		'  return vec4(col * a, a);',
		'}',
		'',
		'void main(){',
		'  vec2 px = gl_FragCoord.xy;',
		'  vec2 uv = (px - 0.5 * u_res) / u_res.y;',
		'  uv.y = -uv.y;',  // y down, so scroll moves the field the natural way
		'  vec4 c = vec4(0.0);',
		'  if (u_mix < 0.999) c += clouds(uv, u_time) * (1.0 - u_mix);',
		'  if (u_mix > 0.001) c += aurora(uv, px, u_time) * u_mix;',
		'  gl_FragColor = c;',
		'}',
	].join('\n');

	// ---- state --------------------------------------------------------------
	var canvas = null, gl = null, prog = null, uni = null;
	var active = false;          // enable() ran and built a canvas
	var looping = false;         // rAF loop scheduled
	var hidden = false, offscreen = false, lost = false;
	var staticMode = false;      // reduced motion or debug: single frames only
	var debugTheme = null;       // 'dark' | 'light' | null
	var scale = 0.5;
	var t0 = 0, lastFrame = 0, lastTick = 0;
	var mix = 1, mixTarget = 1;
	var parX = 0, parY = 0, parTX = 0, parTY = 0;
	var scroll = 0, scrollT = 0;
	var listeners = [];
	var io = null, resizeRaf = 0, firstFrameDone = false;
	var themeHooked = false;

	function on(target, ev, fn, opts) {
		target.addEventListener(ev, fn, opts);
		listeners.push([target, ev, fn, opts]);
	}

	function readDebug() {
		try {
			var v = new URLSearchParams(location.search).get('gadgetDebug') || '';
			if (v === 'ambient-dark') return 'dark';
			if (v === 'ambient-light') return 'light';
		} catch (e) { /* ignore */ }
		return null;
	}

	function isTouch() {
		// Primary pointer is coarse (phones, tablets). maxTouchPoints alone is
	// true on touch-screen laptops driven by a mouse, so it is only a fallback.
	if (window.matchMedia) return window.matchMedia('(pointer: coarse)').matches;
	return navigator.maxTouchPoints > 0;
	}
	function isNarrow() {
		return window.innerWidth < 768;
	}
	function lowPower() {
		try {
			var c = navigator.connection;
			if (c && c.saveData) return true;
		} catch (e) { /* ignore */ }
		var threads = navigator.hardwareConcurrency;
		return !!(threads && threads < 4 && isTouch());
	}

	// ---- GL setup -----------------------------------------------------------
	function compile(type, src) {
		var sh = gl.createShader(type);
		gl.shaderSource(sh, src);
		gl.compileShader(sh);
		if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS) && !gl.isContextLost()) {
			var log = gl.getShaderInfoLog(sh);
			gl.deleteShader(sh);
			throw new Error('ambient shader: ' + log);
		}
		return sh;
	}

	function buildProgram() {
		var vs = compile(gl.VERTEX_SHADER, VERT);
		var fs = compile(gl.FRAGMENT_SHADER, FRAG);
		var p = gl.createProgram();
		gl.attachShader(p, vs);
		gl.attachShader(p, fs);
		gl.linkProgram(p);
		gl.deleteShader(vs);
		gl.deleteShader(fs);
		if (!gl.getProgramParameter(p, gl.LINK_STATUS) && !gl.isContextLost()) {
			throw new Error('ambient link: ' + gl.getProgramInfoLog(p));
		}
		gl.useProgram(p);
		var buf = gl.createBuffer();
		gl.bindBuffer(gl.ARRAY_BUFFER, buf);
		gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
		var loc = gl.getAttribLocation(p, 'a_pos');
		gl.enableVertexAttribArray(loc);
		gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
		prog = p;
		uni = {};
		['u_res', 'u_scale', 'u_time', 'u_mix', 'u_par', 'u_scroll'].forEach(function (n) {
			uni[n] = gl.getUniformLocation(p, n);
		});
		gl.disable(gl.DEPTH_TEST);
		gl.disable(gl.BLEND);
		gl.clearColor(0, 0, 0, 0);
	}

	function resize() {
		resizeRaf = 0;
		if (!canvas || !gl) return;
		scale = (isTouch() || isNarrow()) ? 0.25 : 0.5;
		var w = Math.max(1, Math.round(window.innerWidth * scale));
		var h = Math.max(1, Math.round(window.innerHeight * scale));
		if (canvas.width !== w || canvas.height !== h) {
			canvas.width = w;
			canvas.height = h;
			gl.viewport(0, 0, w, h);
			if (staticMode) draw(now());
		}
	}

	function now() { return (window.performance && performance.now) ? performance.now() : Date.now(); }

	function draw(ts) {
		if (!gl || lost || !prog) return;
		var t = (ts - t0) / 1000;
		if (debugTheme) t = DEBUG_TIME;
		gl.uniform2f(uni.u_res, canvas.width, canvas.height);
		gl.uniform1f(uni.u_scale, scale);
		gl.uniform1f(uni.u_time, t);
		gl.uniform1f(uni.u_mix, mix);
		gl.uniform2f(uni.u_par, parX, parY);
		gl.uniform1f(uni.u_scroll, scroll);
		gl.drawArrays(gl.TRIANGLES, 0, 3);
		if (!firstFrameDone) {
			firstFrameDone = true;
			var c = canvas;
			// Next frame, so the first paint happens at opacity 0 and then fades.
			requestAnimationFrame(function () { if (c === canvas && canvas) canvas.classList.add('is-on'); });
		}
	}

	// ---- loop ---------------------------------------------------------------
	function shouldLoop() {
		return active && !staticMode && !hidden && !offscreen && !lost;
	}
	function kick() {
		if (looping || !shouldLoop()) return;
		looping = true;
		lastTick = now();
		requestAnimationFrame(tick);
	}
	function tick(ts) {
		looping = false;
		if (!shouldLoop()) return;
		var dt = Math.min(0.1, (ts - lastTick) / 1000);
		lastTick = ts;
		// crossfade + eased parallax advance every tick; drawing is capped.
		if (mix !== mixTarget) {
			var step = dt / FADE_SECONDS;
			mix = mix < mixTarget ? Math.min(mixTarget, mix + step) : Math.max(mixTarget, mix - step);
		}
		parX += (parTX - parX) * 0.06;
		parY += (parTY - parY) * 0.06;
		scroll += (scrollT - scroll) * 0.12;
		if (ts - lastFrame >= 1000 / FPS_CAP - 1) {
			lastFrame = ts;
			draw(ts);
		}
		looping = true;
		requestAnimationFrame(tick);
	}

	// Static mode: snap everything and draw one frame.
	function drawStatic() {
		mix = mixTarget;
		parX = parTX; parY = parTY; scroll = scrollT;
		draw(now());
	}

	// ---- events -------------------------------------------------------------
	function onTheme(t) {
		if (!active) return;
		mixTarget = (debugTheme || t) === 'dark' ? 1 : 0;
		if (staticMode) drawStatic(); else kick();
	}
	function onMove(e) {
		var w = window.innerWidth || 1, h = window.innerHeight || 1;
		parTX = (e.clientX / w) * 2 - 1;
		parTY = (e.clientY / h) * 2 - 1;
	}
	function onScroll() {
		scrollT = window.scrollY || window.pageYOffset || 0;
		if (staticMode && !debugTheme) {
			// Reduced motion: no loop, but the still frame follows the scroll
			// position (throttled to one draw per animation frame).
			if (!resizeRaf) resizeRaf = requestAnimationFrame(function () { resizeRaf = 0; drawStatic(); });
		}
	}
	function onVisibility() {
		hidden = !!document.hidden;
		if (!hidden) kick();
	}
	function onResize() {
		if (!resizeRaf) resizeRaf = requestAnimationFrame(resize);
	}
	function onLost(e) {
		e.preventDefault();
		lost = true;
		prog = null;
	}
	function onRestored() {
		lost = false;
		try { buildProgram(); } catch (err) { teardown(); return; }
		resize();
		if (staticMode) drawStatic(); else kick();
	}

	// ---- enable / disable ---------------------------------------------------
	function enable() {
		if (active) return;
		if (lowPower()) return;
		var mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

		var c = document.createElement('canvas');
		c.id = ID;
		c.setAttribute('aria-hidden', 'true');
		var ctx = null;
		try {
			var opts = { alpha: true, antialias: false, depth: false, stencil: false, premultipliedAlpha: true, powerPreference: 'low-power', failIfMajorPerformanceCaveat: false };
			ctx = c.getContext('webgl', opts) || c.getContext('experimental-webgl', opts);
		} catch (e) { ctx = null; }
		if (!ctx) return;   // no WebGL: show nothing

		canvas = c;
		gl = ctx;
		try { buildProgram(); } catch (e) {
			gl = null; canvas = null; prog = null;
			if (window.console) console.warn(String(e && e.message || e));
			return;
		}

		debugTheme = readDebug();
		staticMode = !!debugTheme || Gadgets.reducedMotion;
		if (debugTheme) c.classList.add('is-static');
		active = true;
		lost = false;
		firstFrameDone = false;
		hidden = !!document.hidden;
		offscreen = false;
		// Seed the clock by day so a refresh lands in a similar place.
		var day = Math.floor(Date.now() / 86400000);
		t0 = now() - (day % 97) * 1000;
		lastFrame = 0;
		scrollT = scroll = window.scrollY || 0;
		parX = parY = parTX = parTY = 0;
		mix = mixTarget = (debugTheme || Gadgets.theme()) === 'dark' ? 1 : 0;

		document.body.insertBefore(c, document.body.firstChild);
		resize();

		on(window, 'resize', onResize, { passive: true });
		on(window, 'orientationchange', onResize, { passive: true });
		on(window, 'scroll', onScroll, { passive: true });
		if (!isTouch()) on(window, 'mousemove', onMove, { passive: true });
		on(document, 'visibilitychange', onVisibility);
		on(c, 'webglcontextlost', onLost, false);
		on(c, 'webglcontextrestored', onRestored, false);
		if (mq && mq.addEventListener) {
			on(mq, 'change', function () {
				if (!active || debugTheme) return;
				staticMode = Gadgets.reducedMotion;
				if (staticMode) drawStatic(); else kick();
			});
		}
		if (!themeHooked) {
			themeHooked = true;
			Gadgets.onTheme(onTheme);
		}
		if (window.IntersectionObserver) {
			io = new IntersectionObserver(function (entries) {
				for (var i = 0; i < entries.length; i++) offscreen = !entries[i].isIntersecting;
				if (!offscreen) kick();
			});
			io.observe(c);
		}

		// Always paint one frame right away (even if the tab starts hidden), then loop.
		drawStatic();
		if (!staticMode) kick();
	}

	function teardown() {
		listeners.forEach(function (l) { try { l[0].removeEventListener(l[1], l[2], l[3]); } catch (e) { /* ignore */ } });
		listeners = [];
		if (io) { try { io.disconnect(); } catch (e) { /* ignore */ } io = null; }
		if (resizeRaf) { cancelAnimationFrame(resizeRaf); resizeRaf = 0; }
		if (gl && !lost) {
			try {
				if (prog) gl.deleteProgram(prog);
				var ext = gl.getExtension('WEBGL_lose_context');
				if (ext) ext.loseContext();
			} catch (e) { /* ignore */ }
		}
		if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas);
		canvas = null; gl = null; prog = null; uni = null;
		active = false; looping = false; lost = false;
	}

	function disable() {
		if (!active) return;
		teardown();
	}

	Gadgets.register('ambient', { label: 'Ambient background', enable: enable, disable: disable });
})();
