// Easter eggs gadget: the site's hidden switches and small surprises.
//
//   - Palette commands (via Palette.addActions): "Surprise me", "Pull a random
//     book", "Toggle gadget: <label>" (one per registered gadget, kept in sync),
//     "Turn all effects off/on", "Stargaze", "Play Tetris" and, when a gadget
//     called 'signature' exists, "Replay signature" (fires `signature:replay`).
//   - Konami code (up up down down left right left right B A) anywhere outside
//     an input: a toast, then Bookshelf Tetris (misc/17) in a modal overlay.
//   - Typing "stars": the bookshelf planetarium (misc/43) at near-full viewport.
//   - Typing "nietzsche": one of twelve short aphorisms slides up for 8 s.
//   - Typing "cat": dispatches `navcat:purr` for the navbar cat, if any.
//   - A sparkle button next to #theme-toggle opens an "Effects" popover with a
//     switch per registered gadget plus "all off / all on".
//   - An unknown hash route ("#/attic") shows "there is no such shelf" with a
//     link home. main.js redirects unknown routes to #/about on its own, so the
//     toast appears over the About page right after that redirect.
//
// Debug (for screenshots): ?gadgetDebug=eggs-tetris | eggs-stars | eggs-toast |
// eggs-menu | eggs-palette opens that state on load; any eggs-* value also keeps toasts from
// auto-hiding. Switch the whole gadget off with Gadgets.set('eggs', false)
// (the Effects menu and the palette command "Toggle gadget: Easter eggs").

(function () {
	'use strict';

	var G = window.Gadgets;
	if (!G) return;

	var NAME = 'eggs';
	var TETRIS_URL = 'misc/17-bookshelf-tetris/';
	var STARS_URL = 'misc/43-shelf-planetarium/?thumb=1';
	var LIBRARY_URL = 'assets/data/library.json';
	var HOME_HASH = '#/about';
	var TOAST_MS = 5000;
	var APHORISM_MS = 8000;

	// Short public-domain lines (translations after Common, Zimmern, Kaufmann-era
	// phrasing in common circulation), attributed by book.
	var APHORISMS = [
		{ t: 'He who has a why to live for can bear almost any how.', s: 'Twilight of the Idols' },
		{ t: 'Without music, life would be a mistake.', s: 'Twilight of the Idols' },
		{ t: 'One must still have chaos in oneself to be able to give birth to a dancing star.', s: 'Thus Spoke Zarathustra' },
		{ t: 'And if you gaze long into an abyss, the abyss also gazes into you.', s: 'Beyond Good and Evil' },
		{ t: 'Convictions are more dangerous enemies of truth than lies.', s: 'Human, All Too Human' },
		{ t: 'All truly great thoughts are conceived while walking.', s: 'Twilight of the Idols' },
		{ t: 'Blessed are the forgetful, for they get the better even of their blunders.', s: 'Beyond Good and Evil' },
		{ t: 'The snake which cannot cast its skin has to die.', s: 'Daybreak' },
		{ t: 'Every deep thinker is more afraid of being understood than of being misunderstood.', s: 'Beyond Good and Evil' },
		{ t: 'We have art in order not to die of the truth.', s: 'Notebooks, 1888' },
		{ t: 'One repays a teacher badly if one always remains a pupil.', s: 'Thus Spoke Zarathustra' },
		{ t: 'I would believe only in a god who could dance.', s: 'Thus Spoke Zarathustra' },
	];

	var KONAMI = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];

	// Captured at parse time: main.js may redirect an unknown route before enable() runs.
	var initialHash = window.location.hash;

	var debug = '';
	try {
		var dm = /[?&]gadgetDebug=([^&#]+)/.exec(window.location.search);
		if (dm) debug = decodeURIComponent(dm[1]);
	} catch (e) { debug = ''; }
	var debugging = debug.indexOf('eggs') === 0;

	// ---- Small helpers ----------------------------------------------------

	function el(tag, className, text) {
		var n = document.createElement(tag);
		if (className) n.className = className;
		if (text != null) n.textContent = text;
		return n;
	}
	function $$(sel, root) {
		return Array.prototype.slice.call((root || document).querySelectorAll(sel));
	}
	function isEditable(t) {
		if (!t || !t.tagName) return false;
		var tag = t.tagName.toLowerCase();
		return tag === 'input' || tag === 'textarea' || tag === 'select' || t.isContentEditable;
	}
	function paletteOpen() {
		return document.body.classList.contains('palette-is-open');
	}
	function pick(arr) {
		return arr[Math.floor(Math.random() * arr.length)];
	}
	function goHash(hash) {
		if (window.location.hash === hash) {
			try { window.dispatchEvent(new Event('hashchange')); } catch (e) { /* old browsers */ }
		} else {
			window.location.hash = hash;
		}
	}
	function emit(name) {
		try { document.dispatchEvent(new CustomEvent(name)); } catch (e) { /* old browsers */ }
	}

	var running = false;
	var cleanups = [];
	function on(target, type, fn, opts) {
		target.addEventListener(type, fn, opts);
		cleanups.push(function () { target.removeEventListener(type, fn, opts); });
	}
	function later(fn, ms) {
		var id = setTimeout(fn, ms);
		cleanups.push(function () { clearTimeout(id); });
		return id;
	}

	// ---- Toast ------------------------------------------------------------

	var toast = null;
	var toastTimer = 0;

	function hideToast(now) {
		if (!toast) return;
		var t = toast;
		toast = null;
		clearTimeout(toastTimer);
		t.classList.remove('is-in');
		var remove = function () { if (t.parentNode) t.parentNode.removeChild(t); };
		if (now || G.reducedMotion) remove(); else setTimeout(remove, 380);
	}

	function showToast(fill, ms, cls) {
		hideToast(true);
		var t = el('div', 'eggs-toast' + (cls ? ' ' + cls : ''));
		t.setAttribute('role', 'status');
		t.setAttribute('aria-live', 'polite');
		fill(t);
		var x = el('button', 'eggs-toast-close', '✕');
		x.type = 'button';
		x.setAttribute('aria-label', 'Dismiss');
		x.addEventListener('click', function () { hideToast(); });
		t.appendChild(x);
		document.body.appendChild(t);
		toast = t;
		void t.offsetWidth; // commit the start state so the slide-up transition runs
		t.classList.add('is-in');
		if (ms > 0 && !debugging) toastTimer = setTimeout(function () { hideToast(); }, ms);
	}

	function textToast(text, ms) {
		showToast(function (t) { t.appendChild(el('span', null, text)); }, ms || TOAST_MS);
	}

	function aphorism() {
		var a = debugging ? APHORISMS[2] : pick(APHORISMS);
		showToast(function (t) {
			t.appendChild(el('span', 'eggs-aph-text', '“' + a.t + '”'));
			var src = el('span', 'eggs-aph-src');
			src.appendChild(el('span', null, '— Nietzsche, ' + a.s));
			t.appendChild(src);
		}, APHORISM_MS, 'is-aphorism');
	}

	function noSuchShelf() {
		showToast(function (t) {
			t.appendChild(el('span', null, 'there is no such shelf · '));
			var a = el('a', null, 'home');
			a.href = HOME_HASH;
			a.addEventListener('click', function () { hideToast(); });
			t.appendChild(a);
		}, TOAST_MS);
	}

	// ---- Overlay (iframe modal) ------------------------------------------

	var overlay = null;
	var lastFocus = null;

	function closeOverlay() {
		if (!overlay) return;
		var ov = overlay;
		overlay = null;
		document.body.classList.remove('eggs-lock');
		ov.classList.remove('is-in');
		var remove = function () { if (ov.parentNode) ov.parentNode.removeChild(ov); };
		if (G.reducedMotion) remove(); else setTimeout(remove, 340);
		if (lastFocus && lastFocus.focus && document.body.contains(lastFocus)) {
			try { lastFocus.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
		}
		lastFocus = null;
	}

	function openOverlay(kind) {
		closeOverlay();
		closeMenu();
		lastFocus = document.activeElement;

		var isStars = kind === 'stars';
		var ov = el('div', 'eggs-overlay');
		ov.setAttribute('role', 'dialog');
		ov.setAttribute('aria-modal', 'true');
		ov.setAttribute('aria-label', isStars ? 'The Texas sky right now' : 'Bookshelf Tetris');

		var modal = el('div', 'eggs-modal is-' + kind);
		var head = el('div', 'eggs-modal-head');
		head.appendChild(el('strong', null, isStars ? 'Bookshelf Planetarium' : 'Bookshelf Tetris'));
		var note = el('span');
		note.innerHTML = isStars
			? '<kbd>esc</kbd> closes'
			: '<kbd>esc</kbd> pauses · ✕ closes';
		head.appendChild(el('span', 'eggs-spacer'));
		head.appendChild(note);
		var close = el('button', 'eggs-close', '✕');
		close.type = 'button';
		close.setAttribute('aria-label', 'Close');
		head.appendChild(close);

		var frame = el('iframe');
		frame.title = isStars ? 'Bookshelf planetarium' : 'Bookshelf Tetris';
		frame.src = isStars ? STARS_URL : TETRIS_URL;

		modal.appendChild(head);
		modal.appendChild(frame);
		if (isStars) modal.appendChild(el('div', 'eggs-caption', 'the Texas sky right now'));
		ov.appendChild(modal);
		document.body.appendChild(ov);
		document.body.classList.add('eggs-lock');
		void ov.offsetWidth;
		ov.classList.add('is-in');
		overlay = ov;

		close.addEventListener('click', closeOverlay);
		ov.addEventListener('click', function (ev) { if (ev.target === ov) closeOverlay(); });
		ov.addEventListener('keydown', function (ev) {
			if (ev.key === 'Escape') {
				ev.preventDefault();
				ev.stopPropagation();
				closeOverlay();
			} else if (ev.key === 'Tab') {
				// Two stops: the close button and the frame.
				ev.preventDefault();
				if (document.activeElement === close) { try { frame.contentWindow.focus(); } catch (e) { frame.focus(); } }
				else close.focus();
			}
		});
		frame.addEventListener('load', function () {
			if (overlay !== ov) return;
			try {
				if (isStars) {
					frame.contentWindow.document.addEventListener('keydown', function (e) {
						if (e.key === 'Escape') closeOverlay();
					});
				}
				frame.contentWindow.focus();
			} catch (e) { /* cross-origin or unloaded */ }
		});
		close.focus();
	}

	// Focus that escapes the overlay (e.g. tabbing out of the iframe) comes back.
	function onFocusIn(ev) {
		if (overlay && !overlay.contains(ev.target)) {
			var c = overlay.querySelector('.eggs-close');
			if (c) c.focus();
		} else if (menu && menuBtn && !menu.contains(ev.target) && ev.target !== menuBtn) {
			closeMenu();
		}
	}

	function stargaze() { openOverlay('stars'); }
	function playTetris() { openOverlay('tetris'); }
	function foundTetris() {
		showToast(function (t) {
			t.innerHTML = '<kbd>↑↑↓↓←→←→BA</kbd> — you found the tetris';
		}, TOAST_MS);
		if (debugging) playTetris(); else later(playTetris, 900);
	}

	// ---- Keystroke buffer (Konami + words) --------------------------------

	var keys = [];
	var chars = '';

	function onKey(ev) {
		if (ev.defaultPrevented || ev.ctrlKey || ev.metaKey || ev.altKey) return;
		if (overlay || menu || paletteOpen() || isEditable(ev.target)) return;
		var k = ev.key;
		if (!k || k === 'Unidentified') return;
		var kl = k.length === 1 ? k.toLowerCase() : k;

		keys.push(kl);
		if (keys.length > KONAMI.length) keys.shift();
		if (keys.length === KONAMI.length && keys.every(function (v, i) { return v === KONAMI[i]; })) {
			keys = [];
			chars = '';
			foundTetris();
			return;
		}

		if (k.length === 1 && /[a-z]/i.test(k)) {
			chars = (chars + kl).slice(-12);
			if (/nietzsche$/.test(chars)) { chars = ''; aphorism(); }
			else if (/stars$/.test(chars)) { chars = ''; stargaze(); }
			else if (/cat$/.test(chars)) { chars = ''; purr(); }
		} else if (k.length !== 1) {
			chars = '';
		}
	}

	function purr() {
		var hasCat = G.list().some(function (g) { return g.name === 'navcat' && g.on; });
		if (hasCat) emit('navcat:purr');
	}

	// ---- Palette actions --------------------------------------------------

	var removeActions = null;
	var syncPending = false;

	function surpriseMe() {
		var links = $$('#miscContent .misc-card[href]');
		if (!links.length) { goHash('#/misc'); return; }
		var a = pick(links);
		window.open(a.getAttribute('href'), '_blank', 'noopener');
	}

	var libraryPromise = null;
	function loadLibrary() {
		if (libraryPromise) return libraryPromise;
		var ctl = window.AbortController ? new AbortController() : null;
		var timer = setTimeout(function () { if (ctl) ctl.abort(); }, 8000);
		libraryPromise = fetch(LIBRARY_URL, ctl ? { signal: ctl.signal } : undefined)
			.then(function (r) { return r.ok ? r.json() : null; })
			.then(function (data) {
				clearTimeout(timer);
				var books = data && Array.isArray(data.books) ? data.books : [];
				return books.filter(function (b) { return b && b.id; });
			})
			.catch(function () { clearTimeout(timer); libraryPromise = null; return []; });
		return libraryPromise;
	}

	function randomBook() {
		loadLibrary().then(function (books) {
			if (!books.length) {
				textToast('the catalogue is out of reach right now');
				goHash('#/bookshelf');
				return;
			}
			var b = pick(books);
			goHash('#/bookshelf/' + encodeURIComponent(b.id));
		});
	}

	function setAll(onFlag) {
		G.list().forEach(function (g) {
			if (g.name !== NAME && g.on !== onFlag) G.set(g.name, onFlag);
		});
	}

	function syncActions() {
		if (!running || !window.Palette || !window.Palette.addActions) return;
		if (removeActions) { removeActions(); removeActions = null; }
		var acts = [
			{ label: 'Surprise me', keywords: 'eggs random misc toy lucky dice', hint: 'a random Misc toy', run: surpriseMe },
			{ label: 'Pull a random book', keywords: 'eggs random bookshelf library shelf lucky', hint: 'from the shelves', run: randomBook },
			{ label: 'Stargaze', keywords: 'eggs stars sky night planetarium texas', hint: 'the Texas sky right now', run: stargaze },
			{ label: 'Play Tetris', keywords: 'eggs game bookshelf tetris konami', hint: 'Bookshelf Tetris', run: playTetris },
		];
		var list = G.list();
		list.forEach(function (g) {
			if (g.name === NAME) return;
			acts.push({
				label: 'Toggle gadget: ' + g.label,
				keywords: 'eggs effects gadget switch ' + g.name + ' ' + (g.on ? 'off' : 'on'),
				hint: g.on ? 'on' : 'off',
				run: function () { G.toggle(g.name); },
			});
		});
		acts.push({ label: 'Turn all effects off', keywords: 'eggs gadgets disable quiet plain', hint: '', run: function () { setAll(false); } });
		acts.push({ label: 'Turn all effects on', keywords: 'eggs gadgets enable', hint: '', run: function () { setAll(true); } });
		if (list.some(function (g) { return g.name === 'signature'; })) {
			acts.push({ label: 'Replay signature', keywords: 'eggs handwriting name draw again', hint: '', run: function () { emit('signature:replay'); } });
		}
		removeActions = window.Palette.addActions(acts);
	}

	function scheduleSync() {
		if (syncPending) return;
		syncPending = true;
		setTimeout(function () {
			syncPending = false;
			syncActions();
			if (menu) renderMenu();
		}, 0);
	}

	// The switch for this gadget itself stays in the palette even while it is
	// off; otherwise there would be no way back once everything is hidden.
	if (window.Palette && window.Palette.addActions) {
		window.Palette.addActions([{
			label: 'Toggle gadget: Easter eggs',
			keywords: 'effects gadget switch eggs konami menu',
			hint: '',
			run: function () { G.toggle(NAME); },
		}]);
	}

	// ---- Effects menu (navbar) --------------------------------------------

	var menuBtn = null;
	var menu = null;

	function buildButton() {
		var themeBtn = document.getElementById('theme-toggle');
		if (!themeBtn || menuBtn) return;
		menuBtn = el('button', themeBtn.className + ' eggs-menu-btn');
		menuBtn.id = 'eggs-menu-btn';
		menuBtn.type = 'button';
		menuBtn.title = 'Effects';
		menuBtn.setAttribute('aria-label', 'Effects');
		menuBtn.setAttribute('aria-haspopup', 'dialog');
		menuBtn.setAttribute('aria-expanded', 'false');
		menuBtn.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i>';
		themeBtn.parentNode.insertBefore(menuBtn, themeBtn.nextSibling);
		menuBtn.addEventListener('click', function () { if (menu) closeMenu(); else openMenu(); });
	}

	function renderMenu() {
		if (!menu) return;
		var list = G.list();
		var body = menu.querySelector('.eggs-menu-body');
		body.innerHTML = '';
		if (!list.length) {
			body.appendChild(el('div', 'eggs-menu-empty', 'No effects registered.'));
			return;
		}
		list.forEach(function (g) {
			var row = el('button', 'eggs-menu-row');
			row.type = 'button';
			row.setAttribute('role', 'switch');
			row.setAttribute('aria-checked', g.on ? 'true' : 'false');
			row.setAttribute('data-gadget', g.name);
			row.appendChild(el('span', null, g.label));
			var sw = el('span', 'eggs-switch');
			sw.setAttribute('aria-hidden', 'true');
			row.appendChild(sw);
			row.addEventListener('click', function () { G.toggle(g.name); });
			body.appendChild(row);
		});
	}

	function positionMenu() {
		if (!menu || !menuBtn) return;
		var r = menuBtn.getBoundingClientRect();
		var w = menu.offsetWidth || 260;
		var left = Math.min(Math.max(16, r.right - w), window.innerWidth - w - 16);
		menu.style.left = Math.max(16, left) + 'px';
		menu.style.top = (r.bottom + 8) + 'px';
	}

	function openMenu() {
		if (menu || !menuBtn) return;
		closeOverlay();
		menu = el('div', 'eggs-menu');
		menu.id = 'eggs-menu';
		menu.setAttribute('role', 'dialog');
		menu.setAttribute('aria-label', 'Effects');
		var head = el('div', 'eggs-menu-head');
		head.appendChild(el('span', null, 'Effects'));
		head.appendChild(el('span', null, 'saved in this browser'));
		menu.appendChild(head);
		menu.appendChild(el('div', 'eggs-menu-body'));
		menu.appendChild(el('div', 'eggs-menu-sep'));
		var foot = el('div', 'eggs-menu-foot');
		var off = el('button', null, 'All off');
		off.type = 'button';
		off.addEventListener('click', function () { setAll(false); });
		var onb = el('button', null, 'All on');
		onb.type = 'button';
		onb.addEventListener('click', function () { setAll(true); });
		foot.appendChild(off);
		foot.appendChild(onb);
		menu.appendChild(foot);

		menu.addEventListener('keydown', function (ev) {
			var items = $$('button', menu);
			var i = items.indexOf(document.activeElement);
			if (ev.key === 'Escape') {
				ev.preventDefault();
				ev.stopPropagation();
				closeMenu();
				menuBtn.focus();
			} else if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
				ev.preventDefault();
				var n = items.length;
				items[((i + (ev.key === 'ArrowDown' ? 1 : -1)) % n + n) % n].focus();
			} else if (ev.key === 'Tab') {
				// Keep focus inside the popover; Esc or a click outside closes it.
				if (ev.shiftKey && i <= 0) { ev.preventDefault(); items[items.length - 1].focus(); }
				else if (!ev.shiftKey && i === items.length - 1) { ev.preventDefault(); items[0].focus(); }
			}
		});

		document.body.appendChild(menu);
		renderMenu();
		positionMenu();
		menuBtn.setAttribute('aria-expanded', 'true');
		var first = menu.querySelector('button');
		if (first) first.focus();
	}

	function closeMenu() {
		if (!menu) return;
		if (menu.parentNode) menu.parentNode.removeChild(menu);
		menu = null;
		if (menuBtn) menuBtn.setAttribute('aria-expanded', 'false');
	}

	function onPointerDown(ev) {
		if (!menu) return;
		if (menu.contains(ev.target) || ev.target === menuBtn || menuBtn.contains(ev.target)) return;
		closeMenu();
	}

	// ---- Unknown routes ---------------------------------------------------

	var knownRoutes = null;
	function routes() {
		if (!knownRoutes) {
			knownRoutes = { post: true };
			$$('#top-nav .nav-link[data-route]').forEach(function (a) {
				knownRoutes[a.getAttribute('data-route')] = true;
			});
		}
		return knownRoutes;
	}
	function routeOf(hash) {
		var m = /^#\/([^\/]+)/.exec(hash || '');
		if (!m) return null;
		var r = m[1];
		var q = r.indexOf('?');
		if (q !== -1) r = r.slice(0, q);
		return r;
	}
	function checkHash(hash) {
		var r = routeOf(hash);
		if (r == null || r === '' || routes()[r]) return;
		noSuchShelf();
	}
	function onHashChange(ev) {
		var h = window.location.hash;
		try { if (ev && ev.newURL) h = new URL(ev.newURL).hash; } catch (e) { /* keep current */ }
		checkHash(h);
	}

	// ---- Debug states -----------------------------------------------------

	function runDebug() {
		if (!debugging) return;
		if (window.innerWidth < 768) window.scrollTo(0, 0); // headless shots at phone width
		if (debug === 'eggs-tetris') foundTetris();
		else if (debug === 'eggs-stars') stargaze();
		else if (debug === 'eggs-toast') aphorism();
		else if (debug === 'eggs-menu') {
			var nav = document.getElementById('mainNav');
			if (nav && window.innerWidth < 768) { nav.classList.add('show'); window.scrollTo(0, 0); }
			openMenu();
		} else if (debug === 'eggs-palette' && window.Palette) {
			window.Palette.open();
			var inp = document.getElementById('palette-input');
			if (inp) { inp.value = 'eggs'; inp.dispatchEvent(new Event('input')); }
		}
	}

	// ---- Register ---------------------------------------------------------

	G.register(NAME, {
		label: 'Easter eggs',
		enable: function () {
			if (running) return;
			running = true;
			buildButton();
			syncActions();
			on(document, 'keydown', onKey);
			on(document, 'focusin', onFocusIn);
			on(document, 'mousedown', onPointerDown);
			on(document, 'touchstart', onPointerDown, { passive: true });
			on(document, 'gadgets:change', scheduleSync);
			on(window, 'hashchange', onHashChange, true); // capture: runs before main.js redirects
			on(window, 'resize', positionMenu);
			on(window, 'load', scheduleSync);
			checkHash(initialHash);
			initialHash = '';
			runDebug();
		},
		disable: function () {
			if (!running) return;
			running = false;
			closeOverlay();
			closeMenu();
			hideToast(true);
			if (menuBtn && menuBtn.parentNode) menuBtn.parentNode.removeChild(menuBtn);
			menuBtn = null;
			if (removeActions) { removeActions(); removeActions = null; }
			cleanups.forEach(function (fn) { try { fn(); } catch (e) { /* ignore */ } });
			cleanups = [];
			keys = [];
			chars = '';
		},
	});
})();
