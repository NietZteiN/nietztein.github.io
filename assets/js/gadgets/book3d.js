// Gadget "book3d": a floating CSS-3D book at the top of the Bookshelf tab.
//
// A hero row is inserted right after the "My library" heading: on the left a
// six-faced book (front cover, back cover, spine, three page-edge faces, plus
// the first page behind a hinged front cover) that slowly turns and bobs under
// a fixed key light; on the right a caption for the book "on the desk today".
// The daily book is picked deterministically from the date; "pick another"
// walks a date-seeded sequence and "random" pulls anything. Picking closes the
// book, swaps the cover while it faces away, settles at a reading angle, opens
// the cover and types the description onto the first page.
//
// Switch off: Gadgets.set('book3d', false). Reduced motion: no rotation, a
// fixed three-quarter view, instant cover. Renders only while the Bookshelf
// section is active, on screen and the tab is visible.
// ?gadgetDebug=book3d-open shows the opened state (used for screenshots);
// ?gadgetDebug=book3d-pick runs the pick animation on load; &gadgetBook=<id>
// forces the book.

(function () {
	'use strict';
	if (!window.Gadgets) return;

	var DATA_URL = 'assets/data/library.json';

	// Copied from assets/js/bookshelf.js so cover colours match the shelf.
	var GENRE_HUE = {
		'Literature (English & European)': 214, 'Japanese literature': 354, 'Manga & comics': 322, 'Light novels': 282,
		'Writing, film & literary craft': 28, 'History & biography': 14, 'Philosophy & political theory': 248,
		'Religion & theology': 42, 'Society, culture & ideas': 186, 'Politics, law & current affairs': 168,
		'Psychology, self-help & business': 142, 'Art & visual culture': 76, 'Music & opera': 266,
		'Language study & reference': 104, 'Test prep & study guides': 56, 'Math, CS & engineering': 200,
		'Science': 178, 'Nursing & medical': 6, 'Magazines & catalogues': 90, 'Occult & folklore': 300,
		'Games & other objects': 0, 'Unidentified': 0,
	};

	var READ_ANGLE = 0.32;        // rad: angle the book settles at while open
	var STATIC_ANGLE = 0.52;      // rad: fixed three-quarter view (reduced motion)
	var BASE_VEL = 0.34;          // rad/s: idle rotation
	var OPEN_DEG = -168;          // cover hinge angle when open
	var TYPE_MS = 16;             // per character
	var HOLD_MS = 3600;           // after typing, before the cover closes

	// Face normals in book space (CSS: +x right, +y down, +z toward viewer).
	var LIGHT = norm([-0.42, -0.5, 0.78]);

	// ---- State ---------------------------------------------------------------

	var hero = null, stage = null, bookEl = null, shadowEl = null, coverEl = null, pageEl = null;
	var faces = {};
	var capEls = {};
	var section = null;

	var books = [];
	var current = null;
	var pickCount = 0;
	var fetchCtl = null;
	var loaded = false;

	var raf = 0, lastT = 0, running = false;
	var active = false, inView = true, hidden = false;
	var ty = STATIC_ANGLE, tx = -0.06, yoff = 0, bobT = 0, vel = BASE_VEL;
	var hv = 0, hovered = false, px = 0, py = 0;
	var mode = 'spin';            // spin | settle | hold
	var boost = false, swapped = true, pending = null, settleTarget = 0;
	var openDeg = 0;
	var timers = [];
	var typingTimer = 0;
	var mo = null, io = null;
	var listeners = [];
	var debugOpen = /[?&]gadgetDebug=book3d-open(&|$)/.test(window.location.search);
	var debugPick = /[?&]gadgetDebug=book3d-pick(&|$)/.test(window.location.search);
	var debugId = (window.location.search.match(/[?&]gadgetBook=([^&]+)/) || [])[1] || '';

	// ---- Helpers -------------------------------------------------------------

	function norm(v) { var l = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }
	function el(tag, cls, text) {
		var e = document.createElement(tag);
		if (cls) e.className = cls;
		if (text != null) e.textContent = text;
		return e;
	}
	function isJa(s) { return /[぀-ヿ一-鿿]/.test(s || ''); }
	function hash(str) {
		var h = 2166136261;
		for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
		return h >>> 0;
	}
	function todayKey() {
		var d = new Date();
		return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
	}
	function later(fn, ms) {
		var id = setTimeout(function () { timers = timers.filter(function (t) { return t !== id; }); fn(); }, ms);
		timers.push(id);
		return id;
	}
	function clearTimers() {
		timers.forEach(clearTimeout); timers = [];
		if (typingTimer) { clearTimeout(typingTimer); typingTimer = 0; }
	}
	function on(target, type, fn, opts) {
		target.addEventListener(type, fn, opts);
		listeners.push([target, type, fn, opts]);
	}
	function reduced() { return !!window.Gadgets.reducedMotion; }

	function firstSentence(s, max) {
		s = String(s || '').replace(/\s+/g, ' ').trim();
		var m = s.match(/^.{20,}?[.!?。](\s|$)/);
		var out = m ? m[0].trim() : s;
		if (out.length > max) out = out.slice(0, max - 1).replace(/\s\S*$/, '') + '…';
		return out;
	}
	function clip(s, max) {
		s = String(s || '').replace(/\s+/g, ' ').trim();
		return s.length > max ? s.slice(0, max - 1).replace(/\s\S*$/, '') + '…' : s;
	}

	function coverColor(b) {
		var seed = hash(b.id || b.t);
		var hue = GENRE_HUE[b.g]; if (hue == null) hue = 0;
		var sat = 34 + (seed % 26), lig = 26 + ((seed >> 4) % 18);
		if (b.g === 'Games & other objects' || b.g === 'Unidentified') { sat = 6; lig = 32 + (seed % 10); }
		hue = (hue + ((seed % 17) - 8) + 360) % 360;
		return { css: 'hsl(' + hue + ' ' + sat + '% ' + lig + '%)', variant: seed % 3 };
	}

	// ---- DOM -----------------------------------------------------------------

	function face(cls, extra) {
		var f = el('div', 'b3d-face ' + cls + (extra ? ' ' + extra : ''));
		f.setAttribute('aria-hidden', 'true');
		return f;
	}

	function build() {
		hero = el('div', 'b3d-hero is-loading');
		hero.id = 'b3d-hero';

		stage = el('a', 'b3d-stage');
		stage.href = '#/bookshelf';
		stage.setAttribute('aria-label', 'Open this book on the shelf');
		shadowEl = el('div', 'b3d-shadow');
		var scene = el('div', 'b3d-scene');
		bookEl = el('div', 'b3d-book');

		faces.page = face('b3d-page');
		faces.page.appendChild(el('span', 'b3d-page-h'));
		faces.page.appendChild(el('span', 'b3d-page-t'));
		faces.back = face('b3d-back');
		faces.spine = face('b3d-spine');
		faces.fore = face('b3d-pages b3d-fore');
		faces.top = face('b3d-pages b3d-top');
		faces.bottom = face('b3d-pages b3d-bottom');
		coverEl = el('div', 'b3d-cover');
		faces.front = face('b3d-front');
		faces.inside = face('b3d-inside');
		coverEl.appendChild(faces.front);
		coverEl.appendChild(faces.inside);

		bookEl.appendChild(faces.back);
		bookEl.appendChild(faces.top);
		bookEl.appendChild(faces.bottom);
		bookEl.appendChild(faces.spine);
		bookEl.appendChild(faces.fore);
		bookEl.appendChild(faces.page);
		bookEl.appendChild(coverEl);

		scene.appendChild(bookEl);
		stage.appendChild(shadowEl);
		stage.appendChild(scene);

		var cap = el('div', 'b3d-cap');
		capEls.kicker = el('span', 'b3d-kicker', 'On the desk today');
		capEls.title = el('a', 'b3d-title', 'Fetching the shelf…');
		capEls.title.href = '#/bookshelf';
		capEls.meta = el('span', 'b3d-meta', '');
		capEls.ex = el('p', 'b3d-ex', '');
		var actions = el('div', 'b3d-actions');
		capEls.pick = el('button', 'b3d-btn');
		capEls.pick.type = 'button';
		capEls.pick.appendChild(el('i', 'fa-solid fa-book-open'));
		capEls.pick.appendChild(document.createTextNode('Pick another'));
		capEls.rand = el('button', 'b3d-btn');
		capEls.rand.type = 'button';
		capEls.rand.appendChild(el('i', 'fa-solid fa-shuffle'));
		capEls.rand.appendChild(document.createTextNode('Random'));
		capEls.pick.disabled = capEls.rand.disabled = true;
		actions.appendChild(capEls.pick);
		actions.appendChild(capEls.rand);
		cap.appendChild(capEls.kicker);
		cap.appendChild(capEls.title);
		cap.appendChild(capEls.meta);
		cap.appendChild(capEls.ex);
		cap.appendChild(actions);

		hero.appendChild(stage);
		hero.appendChild(cap);

		on(capEls.pick, 'click', function () { pick(false); });
		on(capEls.rand, 'click', function () { pick(true); });
		on(stage, 'pointerenter', function () { hovered = true; });
		on(stage, 'pointerleave', function () { hovered = false; px = py = 0; });
		on(stage, 'pointermove', function (ev) {
			if (ev.pointerType === 'touch') return;
			var r = stage.getBoundingClientRect();
			px = Math.max(-1, Math.min(1, ((ev.clientX - r.left) / r.width) * 2 - 1));
			py = Math.max(-1, Math.min(1, ((ev.clientY - r.top) / r.height) * 2 - 1));
			hovered = true;
		});
		on(stage, 'click', function (ev) {
			// Hash navigation opens the card; let the router handle it.
			if (!current) ev.preventDefault();
		});
	}

	function fillCover(b) {
		var c = coverColor(b);
		bookEl.style.setProperty('--cov', c.css);
		bookEl.style.setProperty('--ink', '#f4efe4');
		var ja = isJa(b.t);
		var pub = (b.pub || '').trim();
		var mark = (pub || b.a || b.t || '·').replace(/^the\s+/i, '').charAt(0).toUpperCase();

		// Front cover
		var f = faces.front;
		f.className = 'b3d-face b3d-front v' + c.variant;
		f.textContent = '';
		f.appendChild(el('span', 'b3d-band'));
		if (c.variant !== 2) f.appendChild(el('span', 'b3d-rule'));
		var ct = el('span', 'b3d-ct', clip(b.t, 64));
		if (ja) ct.lang = 'ja';
		f.appendChild(ct);
		if (c.variant === 2) f.appendChild(el('span', 'b3d-rule'));
		var ca = el('span', 'b3d-ca', clip(b.a || (b.ty || ''), 40));
		if (isJa(b.a)) ca.lang = 'ja';
		f.appendChild(ca);
		if (c.variant === 0) { var r2 = el('span', 'b3d-rule'); r2.style.marginTop = '7px'; f.appendChild(r2); }
		var cp = el('span', 'b3d-cp');
		cp.appendChild(el('span', 'b3d-mark', mark));
		cp.appendChild(el('span', '', clip(pub || (b.y ? String(b.y) : ''), 16)));
		f.appendChild(cp);

		// Spine
		var s = faces.spine;
		s.textContent = '';
		var st = el('span', 'b3d-st', clip(b.t, 40));
		if (ja) st.lang = 'ja';
		s.appendChild(st);
		s.appendChild(el('span', 'b3d-sm', mark));

		// Back cover
		var bk = faces.back;
		bk.textContent = '';
		bk.appendChild(el('span', 'b3d-bb', clip(b.d || b.t, 150)));
		bk.appendChild(el('span', 'b3d-code'));

		// First page (text is typed later)
		faces.page.firstChild.textContent = b.t;
		faces.page.lastChild.textContent = '';
		if (isJa(b.d)) faces.page.lang = 'ja'; else faces.page.removeAttribute('lang');
	}

	function fillCaption(b, kicker) {
		capEls.kicker.textContent = kicker;
		capEls.title.textContent = b.t;
		if (isJa(b.t)) capEls.title.lang = 'ja'; else capEls.title.removeAttribute('lang');
		var href = '#/bookshelf/' + encodeURIComponent(b.id);
		capEls.title.href = href;
		stage.href = href;
		stage.setAttribute('aria-label', 'Open "' + b.t + '" on the shelf');
		capEls.meta.textContent = '';
		if (b.a) { capEls.meta.appendChild(el('b', '', b.a)); }
		var bits = [];
		if (b.y) bits.push(String(b.y));
		if (b.g) bits.push(b.g);
		capEls.meta.appendChild(document.createTextNode((b.a && bits.length ? ' · ' : '') + bits.join(' · ')));
		capEls.ex.textContent = firstSentence(b.d, 140);
		capEls.ex.title = b.d || '';
	}

	// ---- Typing ----------------------------------------------------------------

	function typeDescription(instant) {
		var text = clip(current.d || '', 230);
		var node = faces.page.lastChild;
		if (typingTimer) { clearTimeout(typingTimer); typingTimer = 0; }
		if (instant || reduced()) {
			node.textContent = text;
			faces.page.classList.remove('is-typing');
			return 0;
		}
		node.textContent = '';
		faces.page.classList.add('is-typing');
		var i = 0;
		(function step() {
			i += 1;
			node.textContent = text.slice(0, i);
			if (i < text.length) typingTimer = setTimeout(step, TYPE_MS);
			else { typingTimer = 0; faces.page.classList.remove('is-typing'); }
		})();
		return text.length * TYPE_MS;
	}

	function setOpen(deg) {
		openDeg = deg;
		coverEl.style.setProperty('--open', deg + 'deg');
	}

	// ---- Picking -----------------------------------------------------------------

	function dailyBook() {
		if (debugId) { for (var i = 0; i < books.length; i++) if (books[i].id === decodeURIComponent(debugId)) return books[i]; }
		return books[hash('desk:' + todayKey()) % books.length];
	}
	function nextBook(random) {
		if (books.length < 2) return books[0];
		var b;
		for (var tries = 0; tries < 8; tries++) {
			pickCount += 1;
			var i = random ? Math.floor(Math.random() * books.length) : (hash('desk:' + todayKey() + ':' + pickCount) % books.length);
			b = books[i];
			if (b !== current) break;
		}
		return b;
	}

	function pick(random) {
		if (!loaded || !books.length) return;
		var b = nextBook(random);
		var kicker = random ? 'Random pull' : 'Another from the shelf';
		clearTimers();
		capEls.pick.disabled = capEls.rand.disabled = true;

		if (reduced() || !running) {
			// Single-step version: swap, show it open, close again after a while.
			setOpen(0);
			current = b;
			fillCover(b); fillCaption(b, kicker);
			setOpen(OPEN_DEG);
			typeDescription(true);
			render(0);
			later(function () { setOpen(0); render(0); capEls.pick.disabled = capEls.rand.disabled = false; }, 5000);
			return;
		}

		pending = { book: b, kicker: kicker };
		setOpen(0);
		later(function () {
			mode = 'spin';
			boost = true;
			swapped = false;
		}, openDeg === 0 ? 0 : 700);
	}

	function openNow() {
		setOpen(OPEN_DEG);
		var ms = typeDescription(false);
		var closeAt = function () {
			if (hovered && !debugOpen) { later(closeAt, 800); return; }
			if (debugOpen) return;
			setOpen(0);
			later(function () { mode = 'spin'; capEls.pick.disabled = capEls.rand.disabled = false; }, 950);
		};
		later(closeAt, ms + HOLD_MS);
	}

	// ---- Render loop -------------------------------------------------------------

	function rot(n, ay, ax) {
		var ca = Math.cos(ay), sa = Math.sin(ay);
		var x = n[0] * ca + n[2] * sa, y = n[1], z = -n[0] * sa + n[2] * ca;
		var cb = Math.cos(ax), sb = Math.sin(ax);
		return [x, y * cb - z * sb, y * sb + z * cb];
	}
	function light(f, n, ay, ax, glossy) {
		var r = rot(n, ay, ax);
		var d = r[0] * LIGHT[0] + r[1] * LIGHT[1] + r[2] * LIGHT[2];
		var lit = Math.max(0, d);
		var bright = 0.42 + 0.58 * lit;
		f.style.setProperty('--sh', ((1 - bright) * 0.92).toFixed(3));
		f.style.setProperty('--gl', (Math.pow(lit, 3) * (glossy ? 0.75 : 0.3)).toFixed(3));
	}

	function render(dt) {
		var ay = ty + yoff, ax = tx;
		var bob = reduced() ? 0 : Math.sin(bobT) * 3;
		bookEl.style.transform = 'translateY(' + bob.toFixed(2) + 'px) rotateX(' + ax.toFixed(4) + 'rad) rotateY(' + ay.toFixed(4) + 'rad)';
		var sc = 1 - bob * 0.03;
		shadowEl.style.transform = 'scale(' + sc.toFixed(3) + ', 1)';
		shadowEl.style.opacity = (0.9 + bob * 0.03).toFixed(3);

		var o = openDeg * Math.PI / 180;
		var nf = [Math.sin(o), 0, Math.cos(o)];
		light(faces.front, nf, ay, ax, true);
		light(faces.inside, [-nf[0], 0, -nf[2]], ay, ax, false);
		light(faces.page, [0, 0, 1], ay, ax, false);
		light(faces.back, [0, 0, -1], ay, ax, true);
		light(faces.spine, [-1, 0, 0], ay, ax, true);
		light(faces.fore, [1, 0, 0], ay, ax, false);
		light(faces.top, [0, -1, 0], ay, ax, false);
		light(faces.bottom, [0, 1, 0], ay, ax, false);
	}

	function frame(now) {
		raf = 0;
		if (!running) return;
		var dt = lastT ? Math.min(0.05, (now - lastT) / 1000) : 0.016;
		lastT = now;

		hv += ((hovered ? 1 : 0) - hv) * Math.min(1, dt * 6);
		var k = Math.min(1, dt * 5);
		tx += ((hovered ? -py * 0.22 : 0) - 0.06 - tx) * k;
		yoff += ((hovered ? px * 0.42 : 0) - yoff) * k;
		bobT += dt * 1.25;

		if (mode === 'spin') {
			var target = BASE_VEL * (1 - 0.85 * hv) * (boost ? 7 : 1);
			vel += (target - vel) * Math.min(1, dt * 3);
			ty += vel * dt;
			if (boost) {
				if (!swapped && Math.cos(ty) < -0.7 && pending) {
					current = pending.book;
					fillCover(current); fillCaption(current, pending.kicker);
					pending = null;
					swapped = true;
				}
				if (swapped) {
					var rem = ((READ_ANGLE - ty) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
					if (rem < 1.1) { mode = 'settle'; settleTarget = ty + rem; boost = false; }
				}
			}
			if (ty > 1e4) ty -= 2 * Math.PI * Math.floor(ty / (2 * Math.PI));
		} else if (mode === 'settle') {
			var diff = settleTarget - ty;
			ty += diff * Math.min(1, dt * 4.2);
			if (Math.abs(diff) < 0.012) { ty = settleTarget; mode = 'hold'; vel = 0; openNow(); }
		} else {
			ty += (settleTarget - ty) * Math.min(1, dt * 5);
		}

		render(dt);
		raf = requestAnimationFrame(frame);
	}

	function sync() {
		var shouldRun = !!hero && loaded && active && inView && !hidden && !reduced();
		if (shouldRun === running) return;
		running = shouldRun;
		if (running) { lastT = 0; if (!raf) raf = requestAnimationFrame(frame); }
		else { if (raf) cancelAnimationFrame(raf); raf = 0; }
	}

	function checkActive() {
		active = !!(section && section.classList.contains('active'));
		sync();
	}

	// ---- Data ------------------------------------------------------------------

	function loadData() {
		fetchCtl = window.AbortController ? new AbortController() : null;
		var timeout = setTimeout(function () { if (fetchCtl) fetchCtl.abort(); }, 10000);
		timers.push(timeout);
		return fetch(DATA_URL, fetchCtl ? { signal: fetchCtl.signal } : undefined)
			.then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
			.then(function (data) {
				clearTimeout(timeout);
				books = (data && data.books || []).filter(function (b) { return b && b.t && b.d && b.id; });
				if (!books.length) throw new Error('no books');
				loaded = true;
			});
	}

	function ready() {
		if (!hero) return;
		current = dailyBook();
		fillCover(current);
		fillCaption(current, 'On the desk today');
		capEls.pick.disabled = capEls.rand.disabled = false;
		hero.classList.remove('is-loading');
		bookEl.classList.add('is-ready');

		if (reduced()) {
			ty = STATIC_ANGLE; tx = -0.06;
			if (debugOpen) { setOpen(OPEN_DEG); typeDescription(true); }
			render(0);
			return;
		}
		if (debugOpen) {
			ty = READ_ANGLE; settleTarget = READ_ANGLE; mode = 'hold'; vel = 0;
			coverEl.classList.add('is-instant');
			setOpen(OPEN_DEG); typeDescription(true);
			render(0);
		} else {
			ty = STATIC_ANGLE;
			render(0);
		}
		sync();
		if (debugPick) later(function () { pick(false); }, 50);
	}

	function failed() {
		if (!hero) return;
		hero.classList.remove('is-loading');
		capEls.title.textContent = 'The shelf is out of reach';
		capEls.meta.textContent = 'library.json could not be loaded.';
		capEls.ex.textContent = '';
		render(0);
	}

	// ---- Enable / disable ------------------------------------------------------

	function enable() {
		if (hero) return;
		var intro = document.querySelector('#bookshelfContent .bs-intro');
		section = document.getElementById('bookshelfContent');
		if (!intro || !section) return;
		build();
		intro.insertAdjacentElement('afterend', hero);
		setOpen(0);
		render(0);

		if (window.MutationObserver) {
			mo = new MutationObserver(checkActive);
			mo.observe(section, { attributes: true, attributeFilter: ['class'] });
		}
		on(window, 'hashchange', checkActive);
		on(document, 'visibilitychange', function () { hidden = !!document.hidden; sync(); });
		if (window.IntersectionObserver) {
			io = new IntersectionObserver(function (entries) {
				inView = entries.some(function (e) { return e.isIntersecting; });
				sync();
			}, { threshold: 0 });
			io.observe(hero);
		}
		hidden = !!document.hidden;
		checkActive();

		loadData().then(ready, function (err) {
			if (err && err.name === 'AbortError') { failed(); return; }
			failed();
		});
	}

	function disable() {
		running = false;
		if (raf) cancelAnimationFrame(raf); raf = 0;
		clearTimers();
		if (fetchCtl) { try { fetchCtl.abort(); } catch (e) { /* ignore */ } fetchCtl = null; }
		if (mo) { mo.disconnect(); mo = null; }
		if (io) { io.disconnect(); io = null; }
		listeners.forEach(function (l) { l[0].removeEventListener(l[1], l[2], l[3]); });
		listeners = [];
		if (hero && hero.parentNode) hero.parentNode.removeChild(hero);
		hero = stage = bookEl = shadowEl = coverEl = pageEl = null;
		faces = {}; capEls = {};
		books = []; current = null; pending = null; loaded = false; pickCount = 0;
		mode = 'spin'; boost = false; swapped = true; openDeg = 0; hovered = false; hv = 0;
		ty = STATIC_ANGLE; tx = -0.06; yoff = 0; vel = BASE_VEL;
	}

	window.Gadgets.register('book3d', {
		label: '3D book on the Bookshelf tab',
		enable: enable,
		disable: disable,
	});
})();
