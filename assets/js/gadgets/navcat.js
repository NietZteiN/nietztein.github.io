// Gadget "navcat": a tiny pixel-art grey tabby that lives on the bottom edge of
// the sticky navbar. It walks in from the left and sits on the active tab,
// follows the route when it changes, blinks and flicks its tail, falls asleep
// after 45 s without input, purrs when clicked (rolls over on a long press),
// occasionally stretches or yawns, and bolts off the right edge when the page
// is scrolled fast. Switch it off with Gadgets.set('navcat', false).
//
// Visits: another gadget (the living portrait) may invite the cat somewhere
// else for a while through window.NavCat:
//   NavCat.visit(host, { ms, instant, hold }) -> boolean. The cat walks off the
//       left end of the navbar and reappears inside `host` (a 24x16 box the
//       caller positions; the cat's feet rest on its bottom edge), where it
//       idles as usual, faces the pointer and purrs when hovered. After `ms`
//       it goes home by itself. Refused (false) unless the cat is sitting awake
//       on the navbar, motion is allowed and the window is >= 768px wide.
//   NavCat.leave(immediate) ends a visit early (immediate: no walk back).
//   NavCat.state -> 'off' | 'going' | 'perched' | the navbar state.
// 'navcat:visit' / 'navcat:left' fire on document when the cat arrives / has
// gone home (for whatever reason, including this gadget being switched off).
//
// Debug: ?gadgetDebug=navcat-sleep | navcat-walk | navcat-purr | navcat-sit |
// navcat-roll | navcat-stretch | navcat-sheet forces a state (sheet draws every
// frame at 5x in the corner). Harmless otherwise.

(function () {
	'use strict';

	if (!window.Gadgets || !window.requestAnimationFrame || !window.matchMedia) return;
	var probe = document.createElement('canvas');
	if (!probe.getContext || !probe.getContext('2d')) return;

	var W = 24, H = 16;        // sprite grid (CSS px)
	var HEAD = 14;             // headroom above the sprite for hearts / zzz
	var CH = H + HEAD;
	var WALK_SPEED = 80;       // px/s
	var RETURN_SPEED = 120;
	var FLEE_SPEED = 260;
	var SLEEP_AFTER = 45000;   // ms without input
	var FRAME_MS = 125;

	// ---- Sprites ----------------------------------------------------------
	// Rows hold the fill only; compile() adds a 1px rim around every shape in a
	// colour that flips with the theme. Letters: g grey, d dark stripe, w chest,
	// p pink, e eye, k closed eye.

	var SIT_ROWS = [
		'........................',
		'..............g....g....',
		'..............gg..gg....',
		'.............gdgggdgg...',
		'.............gggggggg...',
		'.............gggeggeg...',
		'.............gggggggg...',
		'.............ggggwwpg...',
		'..............gggwwwg...',
		'...........ggggggwwwg...',
		'.........gggdggggwwwg...',
		'........ggggggggwwwwg...',
		'.......ggdggdgggwwwwg...',
		'......gggggggggggwwgg...',
		'......ggggggggg.gg.gg...',
		'........................',
	];
	// Tail overlays for the sitting cat: resting, half raised, raised.
	var TAILS = [
		[[5, 14], [4, 14], [3, 14, 'd'], [2, 14], [1, 13]],
		[[5, 13], [4, 13], [3, 12, 'd'], [2, 12], [1, 11]],
		[[6, 12], [5, 11], [5, 10, 'd'], [4, 9], [4, 8]],
	];
	var YAWN_MOUTH = [[18, 8, 'p'], [19, 8, 'p'], [18, 9, 'p'], [19, 9, 'p']];

	var WALK_BODY = [
		'........................',
		'................g...g...',
		'...g............gg.gg...',
		'..g.............gdgggdg.',
		'..g.............ggggggg.',
		'..g.............gggegeg.',
		'..gg.....gggggggggggggp.',
		'...gggggggggggggggggwwg.',
		'.....gggdggdggdggggwww..',
		'.....gggggggggggggggw...',
		'.....ggggggggggggggg....',
		'.....ggggggggggggggg....',
		'........................',
		'........................',
		'........................',
		'........................',
	];
	// [hind near, hind far, front near, front far] leg x positions per frame.
	var LEGS = [[6, 9, 15, 18], [7, 8, 16, 17], [6, 9, 15, 18], [5, 10, 14, 19]];

	var SLEEP_ROWS = [[
		'........................',
		'........................',
		'........................',
		'........................',
		'........................',
		'........................',
		'........................',
		'..........ggggggg.......',
		'........gggggggggg.g.g..',
		'......ggggdgggdgggggggg.',
		'.....gggggggggggggggggg.',
		'....gggdgggdggggggkkgg..',
		'....ggggggggggggggggpg..',
		'...gggggggggggggggggwg..',
		'...ggdggdggdggdggdgggg..',
		'........................',
	], [
		'........................',
		'........................',
		'........................',
		'........................',
		'........................',
		'........................',
		'..........ggggggg.......',
		'........gggggggggg......',
		'......gggggggggggg.g.g..',
		'......ggggdgggdgggggggg.',
		'.....gggggggggggggggggg.',
		'....gggdgggdggggggkkgg..',
		'....ggggggggggggggggpg..',
		'...gggggggggggggggggwg..',
		'...ggdggdggdggdggdgggg..',
		'........................',
	]];

	var ROLL_ROWS = [[
		'........................',
		'........................',
		'........................',
		'........................',
		'........................',
		'........................',
		'......g..g.....g...g....',
		'......g..g.....g...g....',
		'......gggg.....ggggg....',
		'.....ggwwwwwwwwwwwwgg...',
		'....gggwwwwwwwwwwwwwggg.',
		'...ggggwwwwwwwwwwwwgkgg.',
		'...gggdgggdgggdggggggpg.',
		'..gggggggggggggggggggg..',
		'...g.gggggggggggggg.g.g.',
		'........................',
	], [
		'........................',
		'........................',
		'........................',
		'........................',
		'........................',
		'........................',
		'.....g..g.......g...g...',
		'......g..g.....g...g....',
		'......gggg.....ggggg....',
		'.....ggwwwwwwwwwwwwgg...',
		'....gggwwwwwwwwwwwwwggg.',
		'...ggggwwwwwwwwwwwwgkgg.',
		'...gggdgggdgggdggggggpg.',
		'..gggggggggggggggggggg..',
		'...g.gggggggggggggg.g.g.',
		'........................',
	]];

	var STRETCH_ROWS = [
		'........................',
		'....g...................',
		'...g...gggg.............',
		'...g..gggggggg..........',
		'...gg.gggdggggggg.g..g..',
		'....gggggggggdgggggggg..',
		'......gggggggggggggegeg.',
		'......ggggggggggggggggp.',
		'.......gggggggggggggwwg.',
		'......gg.gggggggggggww..',
		'......gg..ggggggggggg...',
		'......gg....ggggggggg...',
		'......gg.....gggggggggg.',
		'......gg.......gggggggg.',
		'......gg.........gggwwg.',
		'........................',
	];

	var HEART = ['.g.g.', 'ggggg', '.ggg.', '..g..'];
	var ZEE = ['ggg', '..g', '.g.', 'ggg'];

	var CODES = { '.': 0, g: 2, d: 3, w: 4, p: 5, e: 6, k: 7 };
	// Palette indices: 1 rim, 2 grey, 3 stripe, 4 chest, 5 pink, 6 eye, 7 closed eye.
	var PAL = {
		light: [null, '#2b3139', '#9ba3ae', '#6c737e', '#f2f4f7', '#e4959e', '#2b3139', '#2b3139'],
		dark: [null, '#dce2eb', '#7a828f', '#555c67', '#d6dce5', '#d78d97', '#9ae58f', '#dce2eb'],
	};

	function put(rows, pts, ch) {
		var r = rows.slice();
		pts.forEach(function (p) {
			var s = r[p[1]];
			r[p[1]] = s.slice(0, p[0]) + (p[2] || ch || 'g') + s.slice(p[0] + 1);
		});
		return r;
	}
	function sub(rows, from, to) {
		return rows.map(function (s) { return s.split(from).join(to); });
	}
	function legs(body, xs) {
		var r = body.slice(), y, i, x, ch;
		for (y = 12; y <= 14; y++) {
			var s = r[y].split('');
			// far legs first (dark), near legs on top (grey, white sock on the front one)
			for (i = 0; i < 4; i++) {
				x = xs[i];
				ch = (i === 1 || i === 3) ? 'd' : 'g';
				if (i === 2 && y === 14) ch = 'w';
				s[x] = ch; s[x + 1] = ch;
			}
			// redraw near legs over far ones where they cross
			for (i = 0; i < 4; i += 2) {
				x = xs[i];
				ch = (i === 2 && y === 14) ? 'w' : 'g';
				s[x] = ch; s[x + 1] = ch;
			}
			r[y] = s.join('');
		}
		return r;
	}
	function compile(rows) {
		var px = new Uint8Array(W * H), x, y;
		for (y = 0; y < H; y++) for (x = 0; x < W; x++) px[y * W + x] = CODES[(rows[y] || '')[x]] || 0;
		var out = new Uint8Array(px);
		for (y = 0; y < H; y++) for (x = 0; x < W; x++) {
			if (px[y * W + x]) continue;
			if ((x > 0 && px[y * W + x - 1]) || (x < W - 1 && px[y * W + x + 1]) ||
				(y > 0 && px[(y - 1) * W + x]) || (y < H - 1 && px[(y + 1) * W + x])) out[y * W + x] = 1;
		}
		return out;
	}

	var F = null;
	function build() {
		if (F) return;
		var closed = sub(SIT_ROWS, 'e', 'k');
		F = {
			sit: TAILS.map(function (t) { return compile(put(SIT_ROWS, t)); }),
			blink: TAILS.map(function (t) { return compile(put(closed, t)); }),
			yawn: compile(put(put(closed, TAILS[0]), YAWN_MOUTH)),
			walk: LEGS.map(function (l) { return compile(legs(WALK_BODY, l)); }),
			sleep: SLEEP_ROWS.map(compile),
			roll: ROLL_ROWS.map(compile),
			stretch: compile(STRETCH_ROWS),
		};
	}

	// ---- DOM / drawing ----------------------------------------------------

	var nav = null, stage = null, box = null, canvas = null, ctx = null, ro = null;
	var pal = PAL.light;
	var dpr = 1;

	function paint(frame, flip, ox, fx) {
		if (!ctx) return;
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.clearRect(0, 0, W, CH);
		if (ox) ctx.translate(ox, 0);
		var c, x, y, i, dx;
		for (c = 1; c <= 7; c++) {
			ctx.fillStyle = pal[c];
			for (y = 0; y < H; y++) for (x = 0; x < W; x++) {
				i = y * W + x;
				if (frame[i] !== c) continue;
				dx = flip ? W - 1 - x : x;
				ctx.fillRect(dx, HEAD + y, 1, 1);
			}
		}
		if (fx) fx(flip);
	}
	function glyph(rows, x, y, flip, color, alpha) {
		var r, c, s;
		ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
		ctx.fillStyle = color;
		for (r = 0; r < rows.length; r++) {
			s = rows[r];
			for (c = 0; c < s.length; c++) {
				if (s[c] !== 'g') continue;
				var gx = x + c, gy = y + r;
				if (flip) gx = W - 1 - gx;
				if (gx < 0 || gx >= W || gy < 0 || gy >= CH) continue;
				ctx.fillRect(gx, gy, 1, 1);
			}
		}
		ctx.globalAlpha = 1;
	}
	function hearts(t) {
		// t: ms since purr began. Three hearts drift up from the head.
		return function (flip) {
			var i, p, x, y;
			for (i = 0; i < 3; i++) {
				p = (t - i * 220) / 950;
				if (p <= 0 || p >= 1) continue;
				x = 14 + [-5, 2, 7][i] + Math.round(Math.sin(p * 7 + i * 2) * 1.5);
				y = HEAD + 1 - Math.round(p * 12);
				glyph(HEART, x, y, flip, pal[5], 1 - p * p);
			}
		};
	}
	function zzz(t) {
		return function (flip) {
			var i, p, x, y, a;
			for (i = 0; i < 3; i++) {
				p = ((t / 2600) + i / 3) % 1;
				x = 19 + Math.round(p * 4) + (i % 2);
				y = HEAD + 5 - Math.round(p * 15);
				a = p < 0.12 ? p / 0.12 : 1 - (p - 0.12) / 0.88;
				glyph(ZEE, x, y, flip, pal[1], a);
			}
		};
	}

	// ---- State ------------------------------------------------------------

	var active = false, paused = false;
	var state = 'sit';        // walk | sit | sleep | purr | roll | stretch | yawn | away
	var x = 0, target = 0, dir = 1, speed = WALK_SPEED, flip = false;
	var t0 = 0, tEnd = 0, lastStep = 0;
	var blinkEnd = 0, tailStart = 0;
	var lastInput = 0, fleeCooldown = 0;
	var raf = 0, slow = 0;
	var timers = {};
	var pressed = false;
	var navW = 0;
	var debug = '';
	var mqDesktop = window.matchMedia('(min-width: 768px)');

	function now() { return (window.performance && performance.now) ? performance.now() : Date.now(); }
	function rand(a, b) { return a + Math.random() * (b - a); }
	function reduced() { return !!window.Gadgets.reducedMotion; }
	function setTimer(name, fn, ms) {
		clearTimer(name);
		timers[name] = setTimeout(function () { timers[name] = 0; fn(); }, ms);
	}
	function clearTimer(name) {
		if (timers[name]) { clearTimeout(timers[name]); timers[name] = 0; }
	}
	function clearIdle() {
		['blink', 'tail', 'big', 'sleep', 'anim'].forEach(clearTimer);
		blinkEnd = 0; tailStart = 0;
	}
	function clearAll() {
		Object.keys(timers).forEach(clearTimer);
		blinkEnd = 0; tailStart = 0;
	}

	function place() {
		if (visitPhase === 'there') return;   // the host positions a visiting cat
		if (box) box.style.transform = 'translate3d(' + Math.round(x) + 'px,0,0)';
	}
	function currentRoute() {
		var m = /^#\/([^\/?]+)/.exec(window.location.hash || '');
		var r = m ? m[1] : 'about';
		if (r === 'post') r = 'blog';
		return r;
	}
	// The sitting cat's body spans grid columns 6..20 (tail to the left of it),
	// so the sprite is placed by its body centre, which depends on facing.
	var ANCHOR = 13.5;
	function anchor(f) { return f ? W - ANCHOR : ANCHOR; }
	// keep: true re-places the cat without turning it (resize, font load).
	function targetX(keep) {
		if (!nav) return null;
		var link = nav.querySelector('.nav-link[data-route="' + currentRoute() + '"]') || nav.querySelector('.nav-link.active');
		if (!link) return null;
		var lr = link.getBoundingClientRect();
		if (!lr.width) return null;
		var nr = nav.getBoundingClientRect();
		navW = nav.clientWidth;
		var cx = lr.left - nr.left + lr.width / 2;
		// Face the way the cat would walk to get there (keeps the current
		// facing when it is already there).
		var cur = x + anchor(flip);
		tFlip = (keep || Math.abs(cx - cur) < 2) ? flip : cx < cur;
		return Math.round(cx - anchor(tFlip));
	}
	var tFlip = false;   // facing assumed by the last targetX()

	// Loop: rAF while a motion is in progress, a 100 ms tick while asleep,
	// nothing at all while the cat just sits.
	function need(on) {
		if (on) {
			if (!raf && !slow) raf = requestAnimationFrame(frame);
		} else {
			if (raf) { cancelAnimationFrame(raf); raf = 0; }
			if (slow) { clearTimeout(slow); slow = 0; }
		}
	}
	function frame() {
		raf = 0; slow = 0;
		if (!active || paused) return;
		var t = now();
		var more = step(t);
		render(t);
		if (more === 'slow') slow = setTimeout(frame, 100);
		else if (more) raf = requestAnimationFrame(frame);
	}
	function step(t) {
		if (state === 'walk') {
			var dt = Math.min(0.1, Math.max(0, (t - lastStep) / 1000));
			lastStep = t;
			var d = target - x;
			if (Math.abs(d) <= speed * dt) { x = target; arrive(); return state !== 'sit' && state !== 'away' && state !== 'hop'; }
			dir = d < 0 ? -1 : 1;
			flip = dir < 0;
			x += dir * speed * dt;
			place();
			return true;
		}
		if (state === 'sit') return t < blinkEnd || (tailStart && t < tailStart + 5 * FRAME_MS);
		if (state === 'sleep') return 'slow';
		if (state === 'purr' || state === 'roll' || state === 'stretch' || state === 'yawn') {
			if (t >= tEnd) { toSit(); return false; }
			return true;
		}
		return false;
	}
	function render(t) {
		if (!F || !ctx) return;
		switch (state) {
			case 'walk': {
				var ms = speed > RETURN_SPEED ? 70 : FRAME_MS;
				paint(F.walk[Math.floor(t / ms) % 4], flip);
				break;
			}
			case 'sit': {
				var tail = 0;
				if (tailStart) {
					var k = Math.floor((t - tailStart) / FRAME_MS);
					tail = [1, 2, 2, 1, 0][Math.max(0, Math.min(4, k))];
					if (k >= 5) { tailStart = 0; tail = 0; }
				}
				paint((t < blinkEnd ? F.blink : F.sit)[tail], flip);
				break;
			}
			case 'sleep':
				paint(F.sleep[Math.floor((t - t0) / 1300) % 2], flip, 0, zzz(t - t0));
				break;
			case 'purr': {
				var e = t - t0;
				var wig = e < 700 ? Math.round(Math.sin(e / 45) * 1) : 0;
				paint(F.blink[1], flip, wig, hearts(e));
				break;
			}
			case 'roll':
				paint(F.roll[Math.floor((t - t0) / 260) % 2], flip);
				break;
			case 'stretch':
				paint(F.stretch, flip);
				break;
			case 'yawn':
				paint(F.yawn, flip);
				break;
			case 'hop':
				paint(F.sit[2], flip);
				break;
			case 'away':
				break;
			default:
				paint(F.sit[0], flip);
		}
	}

	// ---- Transitions ------------------------------------------------------

	function toSit() {
		state = 'sit';
		clearIdle();
		need(false);
		place();
		render(now());
		armIdle();
	}
	function armIdle() {
		if (state !== 'sit' || paused || reduced()) return;
		setTimer('blink', doBlink, rand(2500, 6500));
		setTimer('tail', doTail, rand(4000, 10000));
		setTimer('big', doBig, rand(120000, 260000));
		armSleep();
	}
	function armSleep() {
		if (state !== 'sit' || paused || reduced()) return;
		var left = SLEEP_AFTER - (now() - lastInput);
		if (left <= 0) { toSleep(); return; }
		setTimer('sleep', armSleep, Math.max(500, left));
	}
	function doBlink() {
		if (state !== 'sit') return;
		blinkEnd = now() + 160;
		need(true);
		setTimer('blink', doBlink, rand(2500, 6500));
	}
	function doTail() {
		if (state !== 'sit') return;
		tailStart = now();
		need(true);
		setTimer('tail', doTail, rand(4000, 10000));
	}
	function doBig() {
		if (state !== 'sit') return;
		if (Math.random() < 0.5) toAnim('stretch', 1800); else toAnim('yawn', 1300);
	}
	function toAnim(kind, dur) {
		state = kind;
		clearIdle();
		t0 = now(); tEnd = t0 + dur;
		render(t0);
		need(true);
	}
	function toSleep() {
		state = 'sleep';
		clearIdle();
		t0 = now();
		need(false);
		render(t0);
		need(true);
	}
	function wake(viaRoute) {
		if (state !== 'sleep') return;
		need(false);
		if (viaRoute) { state = 'sit'; return; }
		toAnim('stretch', 1400);
	}
	function toWalk(tx, spd) {
		target = tx;
		speed = spd || WALK_SPEED;
		if (reduced()) { x = target; flip = tFlip; dir = flip ? -1 : 1; arrive(); return; }
		clearIdle();
		state = 'walk';
		lastStep = now();
		need(true);
	}
	function arrive() {
		x = target;
		place();
		if (visitPhase === 'going') { perch(); return; }
		if (target > navW) {
			state = 'away';
			need(false);
			setTimer('away', comeBack, rand(5000, 9000));
			return;
		}
		toSit();
	}
	function flee() {
		fleeCooldown = now() + 40000;
		toWalk(navW + W + 4, FLEE_SPEED);
	}
	function comeBack() {
		if (!active || paused) return;
		var tx = targetX();
		if (tx === null) return;
		x = navW + 4;
		place();
		toWalk(tx, RETURN_SPEED);
	}
	function goTo(viaRoute) {
		if (visitPhase) return;   // out visiting: it walks back to the right tab later
		var tx = targetX(!viaRoute && state !== 'walk');
		if (tx === null) return;
		if (state === 'away') { target = tx; return; }   // comes back to the new tab later
		if (state === 'sleep') wake(true);
		if (state === 'walk' && target > navW) return;    // keep fleeing; returns later
		if (tx === target && state !== 'walk' && !viaRoute) return;
		if (!viaRoute && state !== 'walk') { x = tx; target = tx; flip = tFlip; place(); render(now()); return; }   // resize: just re-place
		if (state === 'purr' || state === 'roll' || state === 'stretch' || state === 'yawn') { state = 'sit'; }
		if (state === 'walk') { target = tx; return; }
		toWalk(tx, speed > RETURN_SPEED ? RETURN_SPEED : WALK_SPEED);
	}

	// ---- Visiting ---------------------------------------------------------
	// See the header. visitPhase: '' at home, 'going' while walking off the
	// navbar, 'there' while sitting in the host element.

	var visitPhase = '', visitHost = null, visitMs = 0, visitHold = false, lastHoverPurr = 0;

	function announce(name) {
		try { document.dispatchEvent(new CustomEvent(name)); } catch (e) { /* old browsers */ }
	}
	function visit(host, opts) {
		opts = opts || {};
		if (!active || paused || reduced() || !mqDesktop.matches || visitPhase || !host || !box) return false;
		if (!opts.instant && state !== 'sit') return false;
		visitHost = host;
		visitMs = Math.max(5000, Math.min(60000, +opts.ms || 30000));
		visitHold = !!opts.hold;
		visitPhase = 'going';
		if (opts.instant) { need(false); clearAll(); perch(); return visitPhase === 'there'; }
		tFlip = true;
		toWalk(-W - 4, WALK_SPEED);
		return true;
	}
	function perch() {
		if (!visitHost || !document.documentElement.contains(visitHost)) { visitPhase = ''; visitHost = null; walkHome(); announce('navcat:left'); return; }
		visitPhase = 'there';
		need(false);
		clearIdle();
		box.style.transform = '';
		box.classList.remove('is-leaving');
		box.classList.add('is-perched');
		visitHost.appendChild(box);
		flip = false;
		lastInput = now();
		toSit();
		if (!visitHold) setTimer('visit', function () { leave(false); }, visitMs);
		announce('navcat:visit');
	}
	// Put the box back on the navbar, off its left end, and walk to the tab.
	function walkHome() {
		var tx = targetX();
		x = -W - 2;
		place();
		if (tx === null) { x = 0; target = 0; place(); toSit(); return; }
		toWalk(tx, RETURN_SPEED);
	}
	function unperch() {
		clearTimer('visit'); clearTimer('hop');
		if (box) {
			box.classList.remove('is-perched', 'is-leaving');
			if (stage && box.parentNode !== stage) stage.appendChild(box);
		}
		visitPhase = ''; visitHost = null;
	}
	function leave(immediate) {
		if (!visitPhase || !active) return;
		if (visitPhase === 'going') {
			visitPhase = ''; visitHost = null;
			if (immediate || paused) { settleHome(); } else { var tx = targetX(); if (tx !== null) toWalk(tx, WALK_SPEED); }
			announce('navcat:left');
			return;
		}
		if (immediate || paused || reduced()) {
			unperch();
			settleHome();
			announce('navcat:left');
			return;
		}
		if (state === 'hop') return;   // already on its way
		// a small hop off the frame, then the walk back along the navbar
		clearTimer('visit');
		clearIdle();
		need(false);
		state = 'hop';
		render(now());
		box.classList.add('is-leaving');
		setTimer('hop', function () {
			unperch();
			state = 'sit';
			walkHome();
			announce('navcat:left');
		}, 260);
	}
	function settleHome() {
		need(false);
		clearIdle();
		state = 'sit';
		var tx = targetX(true);
		x = target = tx === null ? 0 : tx;
		place();
		if (!paused) toSit();
	}
	// A visiting cat turns its head towards the pointer.
	function lookAt(e) {
		if (visitPhase !== 'there' || state !== 'sit' || !box || !e || typeof e.clientX !== 'number') return;
		var r = box.getBoundingClientRect();
		var cx = r.left + r.width / 2;
		if (Math.abs(e.clientX - cx) < 14) return;
		var f = e.clientX < cx;
		if (f !== flip) { flip = f; render(now()); }
	}
	function onPointerEnter() {
		if (visitPhase !== 'there' || state !== 'sit' || reduced()) return;
		var t = now();
		if (t - lastHoverPurr < 5000) return;
		lastHoverPurr = t;
		toAnim('purr', 1500);
	}

	// ---- Input ------------------------------------------------------------

	var scrollSamples = [], scrollArmAt = 0;
	function onInput(e) {
		lastInput = now();
		if (state === 'sleep' && !paused) wake(false);
		if (visitPhase === 'there') lookAt(e);
	}
	function seedScroll(t) {
		scrollSamples.length = 0;
		scrollSamples.push([t, window.pageYOffset]);
	}
	function onScroll() {
		onInput();
		var t = now(), y = window.pageYOffset;
		var prev = scrollSamples.length ? scrollSamples[scrollSamples.length - 1] : null;
		scrollSamples.push([t, y]);
		while (scrollSamples.length > 1 && t - scrollSamples[0][0] > 220) scrollSamples.shift();
		if (t < scrollArmAt) return;   // ignore scroll restoration right after load
		// Speed over the last ~200 ms (smooth wheel / trackpad flicks), or a
		// single big jump (the previous event is used with its gap capped at
		// 300 ms, so one 100 px wheel notch never counts as a startle).
		var v = 0, first = scrollSamples[0];
		if (first && t - first[0] >= 90) v = Math.abs(y - first[1]) / (t - first[0]) * 1000;
		if (prev) v = Math.max(v, Math.abs(y - prev[1]) / Math.max(16, Math.min(300, t - prev[0])) * 1000);
		if (v > 2600 && t > fleeCooldown && !visitPhase && (state === 'sit' || state === 'stretch' || state === 'yawn') && !reduced()) {
			seedScroll(t);
			flee();
		}
	}
	function onPointerDown(e) {
		if (e.button) return;
		e.preventDefault();
		onInput();
		pressed = true;
		setTimer('press', function () {
			if (!pressed) return;
			pressed = false;
			if (reduced()) return;
			if (state === 'sit' || state === 'purr' || state === 'stretch' || state === 'yawn') toAnim('roll', 2400);
		}, 550);
	}
	function onPointerUp() {
		if (!pressed) return;
		pressed = false;
		clearTimer('press');
		if (reduced()) {
			if (state !== 'sit') return;
			paint(F.sit[0], flip, 0, hearts(500));
			setTimer('anim', function () { if (state === 'sit') render(now()); }, 900);
			return;
		}
		if (state === 'sit' || state === 'stretch' || state === 'yawn' || state === 'purr') toAnim('purr', 1500);
	}
	function onPointerCancel() {
		pressed = false;
		clearTimer('press');
	}
	function onHash() { goTo(true); }
	var resizeRaf = 0;
	function onResize() {
		if (resizeRaf) return;
		resizeRaf = requestAnimationFrame(function () {
			resizeRaf = 0;
			if (!active) return;
			if (!mqDesktop.matches) { pause(); return; }
			if (paused && !document.hidden) { resume(); return; }
			goTo(false);
		});
	}
	function onVisibility() {
		if (document.hidden) pause(); else resume();
	}
	function pause() {
		if (paused) return;
		if (visitPhase) leave(true);
		paused = true;
		need(false);
		clearAll();
		pressed = false;
	}
	function resume() {
		if (!paused || !active || document.hidden || !mqDesktop.matches) return;
		paused = false;
		lastInput = now();
		var tx = targetX(state !== 'walk');
		if (tx === null) return;
		if (state === 'walk') { target = target > navW ? navW + W + 4 : tx; lastStep = now(); need(true); return; }
		if (state === 'away') { comeBack(); return; }
		flip = tFlip;
		if (state === 'sleep') { x = tx; target = tx; place(); need(true); return; }
		x = tx; target = tx; place();
		toSit();
	}

	// ---- Debug sheet ------------------------------------------------------

	function drawSheet() {
		build();
		var frames = [].concat(F.sit, F.blink, [F.yawn], F.walk, F.sleep, F.roll, [F.stretch]);
		var S = 5, cols = frames.length;
		var c = document.createElement('canvas');
		c.className = 'navcat-sheet';
		c.width = cols * (W + 2) * S;
		c.height = 2 * (H + 2) * S;
		c.style.width = c.width + 'px';
		c.style.height = c.height + 'px';
		var g = c.getContext('2d');
		['light', 'dark'].forEach(function (th, row) {
			g.fillStyle = th === 'light' ? '#ffffff' : '#0f1115';
			g.fillRect(0, row * (H + 2) * S, c.width, (H + 2) * S);
			frames.forEach(function (fr, i) {
				var p = PAL[th], x, y, v;
				for (y = 0; y < H; y++) for (x = 0; x < W; x++) {
					v = fr[y * W + x];
					if (!v) continue;
					g.fillStyle = p[v];
					g.fillRect((i * (W + 2) + 1 + x) * S, (row * (H + 2) + 1 + y) * S, S, S);
				}
			});
		});
		document.body.appendChild(c);
		return c;
	}
	var sheetEl = null;

	// ---- Theme ------------------------------------------------------------

	var themeHooked = false;
	function setTheme(t) {
		pal = PAL[t] || PAL.light;
		if (active && !paused) render(now());
	}

	// ---- Enable / disable -------------------------------------------------

	function enable() {
		if (active) return;
		nav = document.getElementById('top-nav');
		if (!nav) return;
		build();
		debug = (/[?&]gadgetDebug=(navcat-[a-z]+)/.exec(window.location.search) || [])[1] || '';

		if (debug === 'navcat-sheet' && !sheetEl) sheetEl = drawSheet();

		stage = document.createElement('div');
		stage.className = 'navcat-stage';
		stage.setAttribute('aria-hidden', 'true');
		box = document.createElement('div');
		box.className = 'navcat';
		canvas = document.createElement('canvas');
		dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
		canvas.width = Math.round(W * dpr);
		canvas.height = Math.round(CH * dpr);
		ctx = canvas.getContext('2d');
		box.appendChild(canvas);
		stage.appendChild(box);
		nav.appendChild(stage);

		if (!themeHooked) { themeHooked = true; window.Gadgets.onTheme(setTheme); }
		pal = PAL[window.Gadgets.theme()] || PAL.light;

		active = true;
		paused = false;
		lastInput = now();
		state = 'sit';

		box.addEventListener('pointerdown', onPointerDown);
		box.addEventListener('pointerup', onPointerUp);
		box.addEventListener('pointercancel', onPointerCancel);
		box.addEventListener('pointerleave', onPointerCancel);
		box.addEventListener('pointerenter', onPointerEnter);
		box.addEventListener('contextmenu', prevent);
		window.addEventListener('hashchange', onHash);
		window.addEventListener('resize', onResize);
		window.addEventListener('scroll', onScroll, { passive: true });
		window.addEventListener('pointermove', onInput, { passive: true });
		window.addEventListener('keydown', onInput, { passive: true });
		window.addEventListener('wheel', onInput, { passive: true });
		window.addEventListener('touchstart', onInput, { passive: true });
		document.addEventListener('visibilitychange', onVisibility);
		seedScroll(now());
		scrollArmAt = now() + 1500;
		// The links move when the web font arrives or the nav reflows: re-aim.
		if (window.ResizeObserver) {
			ro = new ResizeObserver(onResize);
			var ul = nav.querySelector('#navbarList');
			if (ul) ro.observe(ul);
			ro.observe(nav);
		}
		if (document.fonts && document.fonts.ready) {
			document.fonts.ready.then(function () { if (active) onResize(); }, function () { /* ignore */ });
		}

		if (!mqDesktop.matches || document.hidden) { paused = true; return; }

		var tx = targetX();
		if (tx === null) { x = 0; target = 0; place(); toSit(); return; }
		target = tx;
		switch (debug) {
			case 'navcat-sleep':
				x = tx; place(); lastInput = -1e9; t0 = now(); state = 'sleep'; render(t0); need(true); break;
			case 'navcat-walk':
				x = tx - 150; place(); state = 'walk'; speed = WALK_SPEED; lastStep = now(); dir = 1; flip = false; render(lastStep); need(true); break;
			case 'navcat-purr':
				x = tx; place(); toAnim('purr', 1500); t0 = now() - 450; render(now()); break;
			case 'navcat-roll':
				x = tx; place(); toAnim('roll', 60000); break;
			case 'navcat-stretch':
				x = tx; place(); toAnim('stretch', 60000); break;
			case 'navcat-sit':
				x = tx; place(); toSit(); break;
			default:
				x = -W - 2; place();
				toWalk(tx, WALK_SPEED);
		}
	}
	function prevent(e) { e.preventDefault(); }

	function disable() {
		if (!active) return;
		var wasOut = !!visitPhase;
		if (visitPhase) { visitPhase = ''; visitHost = null; }
		active = false;
		need(false);
		clearAll();
		if (box && box.parentNode && box.parentNode !== stage) box.parentNode.removeChild(box);
		box.removeEventListener('pointerenter', onPointerEnter);
		if (resizeRaf) { cancelAnimationFrame(resizeRaf); resizeRaf = 0; }
		if (ro) { ro.disconnect(); ro = null; }
		box.removeEventListener('pointerdown', onPointerDown);
		box.removeEventListener('pointerup', onPointerUp);
		box.removeEventListener('pointercancel', onPointerCancel);
		box.removeEventListener('pointerleave', onPointerCancel);
		box.removeEventListener('contextmenu', prevent);
		window.removeEventListener('hashchange', onHash);
		window.removeEventListener('resize', onResize);
		window.removeEventListener('scroll', onScroll);
		window.removeEventListener('pointermove', onInput);
		window.removeEventListener('keydown', onInput);
		window.removeEventListener('wheel', onInput);
		window.removeEventListener('touchstart', onInput);
		document.removeEventListener('visibilitychange', onVisibility);
		if (stage && stage.parentNode) stage.parentNode.removeChild(stage);
		if (sheetEl && sheetEl.parentNode) sheetEl.parentNode.removeChild(sheetEl);
		sheetEl = null;
		stage = box = canvas = ctx = null;
		scrollSamples.length = 0;
		pressed = false; paused = false;
		state = 'sit';
		if (wasOut) announce('navcat:left');
	}

	window.NavCat = {
		visit: visit,
		leave: leave,
		get state() { return !active ? 'off' : visitPhase === 'there' ? 'perched' : visitPhase === 'going' ? 'going' : state; },
	};

	window.Gadgets.register('navcat', { label: 'Navbar cat', enable: enable, disable: disable });
})();
