// "Living portrait": the profile photo is a sky of clouds, so let it behave like
// one. A WebGL canvas laid exactly over the <img> redraws the same picture with
// slowly drifting clouds, a soft light that follows the pointer, a ripple on
// click, and (after dark in Texas) a dimmer sky with a few twinkling stars.
// The <img> stays in place underneath for layout, alt text and the tilt gadget;
// if WebGL or the cross-origin texture is unavailable nothing changes at all.
// Registered with the Gadgets registry as 'avatar'; disable() removes everything.
//
// Debug: ?gadgetDebug=avatar-day | avatar-night | avatar-dusk freezes the clock
// and the animation phase so headless screenshots are deterministic.

(function () {
	'use strict';
	if (!window.Gadgets) return;

	var ZONE = 'America/Chicago';
	var debug = '';
	try { debug = new URLSearchParams(location.search).get('gadgetDebug') || ''; } catch (e) { debug = ''; }
	var FROZEN = /^avatar-/.test(debug);

	var VERT = 'attribute vec2 p; varying vec2 v; void main(){ v = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }';
	var FRAG = [
		'precision mediump float;',
		'varying vec2 v;',
		'uniform sampler2D tex;',
		'uniform float t, night, dusk, hover, rippleAge;',
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
		'  gl_FragColor = vec4(c, 1.0);',
		'}',
	].join('\n');

	var img = null, canvas = null, gl = null, prog = null, tex = null, loader = null;
	var uni = {}, raf = 0, running = false, visible = true, io = null;
	var mouse = [0.5, 0.35], mouseT = [0.5, 0.35], hover = 0, hoverT = 0;
	var ripple = [0.5, 0.5], rippleStart = -1e9, t0 = 0, lastDraw = 0;
	var parentTouched = null, parentPrevPos = '';

	function localHour() {
		if (debug === 'avatar-day') return 13;
		if (debug === 'avatar-night') return 23;
		if (debug === 'avatar-dusk') return 19.6;
		try {
			var parts = new Intl.DateTimeFormat('en-US', { timeZone: ZONE, hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(new Date());
			var h = 0, m = 0;
			parts.forEach(function (p) { if (p.type === 'hour') h = +p.value % 24; if (p.type === 'minute') m = +p.value; });
			return h + m / 60;
		} catch (e) { var d = new Date(); return d.getHours() + d.getMinutes() / 60; }
	}
	function smooth(a, b, x) { var k = Math.max(0, Math.min(1, (x - a) / (b - a))); return k * k * (3 - 2 * k); }
	// 0 by day, 1 at night; dusk peaks around sunrise and sunset.
	function skyState() {
		var h = localHour();
		var night = 1 - smooth(5.5, 7.5, h) + smooth(19, 21, h);
		night = Math.max(0, Math.min(1, night));
		var dusk = Math.max(0, 1 - Math.abs(h - 19.6) / 1.3) + Math.max(0, 1 - Math.abs(h - 6.6) / 1.1);
		return { night: night, dusk: Math.min(1, dusk) };
	}

	function compile(type, src) {
		var s = gl.createShader(type);
		gl.shaderSource(s, src); gl.compileShader(s);
		if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader');
		return s;
	}

	// Keep the canvas a sibling right after the image (the tilt gadget may move the
	// image into its own wrapper at any time) and exactly over its box.
	function place() {
		if (!img || !canvas) return false;
		var parent = img.parentNode;
		if (!parent) return false;
		if (canvas.parentNode !== parent || canvas.previousSibling !== img) {
			restoreParent();
			if (getComputedStyle(parent).position === 'static') {
				parentTouched = parent; parentPrevPos = parent.style.position; parent.style.position = 'relative';
			}
			parent.insertBefore(canvas, img.nextSibling);
		}
		var w = img.offsetWidth, h = img.offsetHeight;
		if (!w || !h) return false;
		var s = canvas.style;
		s.left = img.offsetLeft + 'px'; s.top = img.offsetTop + 'px'; s.width = w + 'px'; s.height = h + 'px';
		s.borderRadius = getComputedStyle(img).borderRadius;
		var dpr = Math.min(2, window.devicePixelRatio || 1);
		var cw = Math.round(w * dpr), ch = Math.round(h * dpr);
		if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; gl.viewport(0, 0, cw, ch); }
		return true;
	}
	function restoreParent() {
		if (parentTouched) { parentTouched.style.position = parentPrevPos; parentTouched = null; }
	}

	function draw(now) {
		raf = 0;
		if (!running) return;
		if (visible && !document.hidden && now - lastDraw > 30) {
			lastDraw = now;
			if (place()) {
				var k = 0.08;
				mouse[0] += (mouseT[0] - mouse[0]) * k; mouse[1] += (mouseT[1] - mouse[1]) * k;
				hover += (hoverT - hover) * 0.06;
				var sky = skyState();
				var t = FROZEN ? 40 : (now - t0) / 1000;
				gl.uniform1f(uni.t, t);
				gl.uniform1f(uni.night, sky.night);
				gl.uniform1f(uni.dusk, sky.dusk);
				gl.uniform1f(uni.hover, hover);
				gl.uniform2f(uni.mouse, mouse[0], mouse[1]);
				gl.uniform2f(uni.ripple, ripple[0], ripple[1]);
				gl.uniform1f(uni.rippleAge, FROZEN ? -1 : (now - rippleStart) / 1000);
				gl.drawArrays(gl.TRIANGLES, 0, 3);
			}
		}
		raf = requestAnimationFrame(draw);
	}

	function rel(e) {
		var r = img.getBoundingClientRect();
		return [Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), Math.max(0, Math.min(1, (e.clientY - r.top) / r.height))];
	}
	function onMove(e) { mouseT = rel(e); hoverT = 1; }
	function onLeave() { hoverT = 0; }
	function onClick(e) { ripple = rel(e); rippleStart = performance.now(); }

	function start() {
		if (!running || gl) return;
		canvas = document.createElement('canvas');
		canvas.className = 'gavatar-canvas';
		canvas.setAttribute('aria-hidden', 'true');
		try {
			gl = canvas.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'low-power' });
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
			['t', 'night', 'dusk', 'hover', 'mouse', 'ripple', 'rippleAge'].forEach(function (n) { uni[n] = gl.getUniformLocation(prog, n); });
			tex = gl.createTexture();
			gl.bindTexture(gl.TEXTURE_2D, tex);
			gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, loader);   // throws if the image is tainted
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
		} catch (e) {
			gl = null; canvas = null;
			return;   // leave the plain photo exactly as it is
		}
		canvas.addEventListener('webglcontextlost', function (ev) { ev.preventDefault(); disable(); });
		img.addEventListener('pointermove', onMove);
		img.addEventListener('pointerleave', onLeave);
		img.addEventListener('click', onClick);
		if (window.IntersectionObserver) {
			io = new IntersectionObserver(function (es) { visible = es[0].isIntersecting; });
			io.observe(img);
		}
		t0 = performance.now();
		place();
		requestAnimationFrame(function () { if (canvas) canvas.classList.add('is-on'); });
		raf = requestAnimationFrame(draw);
	}

	function enable() {
		if (running) return;
		if (window.Gadgets.reducedMotion && !FROZEN) return;   // a still photo is the reduced-motion version
		img = document.querySelector('#leftPanel img.profilepicture') || document.querySelector('#leftPanel img');
		if (!img) return;
		running = true;
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
			if (!url) { running = false; return; }
			loader = new Image();
			loader.crossOrigin = 'anonymous';
			loader.onload = start;
			loader.onerror = tryNext;
			loader.src = url;
		};
		tryNext();
	}

	function disable() {
		running = false;
		if (raf) cancelAnimationFrame(raf);
		raf = 0;
		if (io) { io.disconnect(); io = null; }
		if (img) {
			img.removeEventListener('pointermove', onMove);
			img.removeEventListener('pointerleave', onLeave);
			img.removeEventListener('click', onClick);
		}
		if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas);
		restoreParent();
		if (gl) { var ext = gl.getExtension('WEBGL_lose_context'); if (ext) { try { ext.loseContext(); } catch (e) { /* ignore */ } } }
		canvas = null; gl = null; prog = null; tex = null; loader = null; uni = {};
		hover = 0; hoverT = 0;
	}

	window.Gadgets.register('avatar', { label: 'Living portrait', enable: enable, disable: disable });
})();
