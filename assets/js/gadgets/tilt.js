// Gadget "tilt": the micro-interaction bundle for the site shell.
//   1. 3D tilt + moving specular glare on the profile photo and every
//      .misc-card (Misc grid and the Bookshelf "Ways to see the library"
//      strip), delegated so cards added later work too.
//   2. A sliding active-tab indicator under #navbarList with a hover ghost.
//   3. Magnetic buttons (#theme-toggle, #palette-open, Bookshelf toolbar).
//   4. Click ripples on buttons and cards.
//   5. A faint cursor spotlight in dark mode.
// All pointer work is coalesced into one requestAnimationFrame; nothing runs
// when the pointer is still. Tilt, magnets, ripples and the spotlight only
// exist for fine (mouse/pen) pointers and are off under reduced motion.
// Switch off: Gadgets.set('tilt', false). ?gadgetDebug=tilt-demo poses the
// photo, the first card, the nav ghost bar and the spotlight for a screenshot.
(function () {
	'use strict';
	if (!window.Gadgets) return;

	var MAX_TILT = 7;      // degrees
	var MAG_RADIUS = 40;   // px around a button where it starts to drift
	var MAG_PULL = 4;      // px max drift
	var MAG_SEL = '#theme-toggle, #palette-open, .bs-chip:not(.bs-chip-static), .bs-seg-btn, .bs-hitnav button';
	var RIPPLE_SEL = '.misc-card, #theme-toggle, #palette-open, .bs-chip:not(.bs-chip-static), .bs-seg-btn, .bs-hitnav button, .btn';

	var DEMO = false;
	try { DEMO = /[?&]gadgetDebug=tilt-demo(&|$)/.test(window.location.search); } catch (e) { /* ignore */ }

	var fineMq = window.matchMedia ? window.matchMedia('(hover: hover) and (pointer: fine)') : null;
	function finePointer() { return !!(fineMq && fineMq.matches); }
	function motionOK() { return finePointer() && !window.Gadgets.reducedMotion; }

	var html = document.documentElement;
	var active = false;
	var cleanups = [];
	function on(target, type, fn, opts) {
		target.addEventListener(type, fn, opts);
		cleanups.push(function () { target.removeEventListener(type, fn, opts); });
	}

	// ---- shared pointer state + one rAF -------------------------------
	var px = -1, py = -1, moveTarget = null, rafId = 0, inside = false;

	function schedule() {
		if (!rafId) rafId = window.requestAnimationFrame(frame);
	}
	function frame() {
		rafId = 0;
		if (!active || document.hidden) return;
		updateTilt();
		updateMagnets();
		updateSpot();
	}
	function onMove(e) {
		if (e.pointerType === 'touch') return;
		px = e.clientX; py = e.clientY; moveTarget = e.target; inside = true;
		schedule();
	}
	function onLeaveWindow(e) {
		if (e.relatedTarget) return; // still inside the document
		inside = false;
		releaseTilt();
		releaseAllMagnets();
		hideSpot();
	}

	// ---- 1. tilt + glare ------------------------------------------------
	var photo = null, photoOuter = null, photoInner = null;
	var tiltEl = null, tiltRect = null;

	function wrapPhoto() {
		photo = document.querySelector('#leftPanel img');
		if (!photo || photoOuter) return;
		photoOuter = document.createElement('div');
		photoOuter.className = 'gtilt-photo';
		photoInner = document.createElement('div');
		photoInner.className = 'gtilt-photo-inner';
		var glare = document.createElement('div');
		glare.className = 'gtilt-photo-glare';
		photo.parentNode.insertBefore(photoOuter, photo);
		photoInner.appendChild(photo);
		photoInner.appendChild(glare);
		photoOuter.appendChild(photoInner);
	}
	function unwrapPhoto() {
		if (!photoOuter) return;
		if (photoOuter.parentNode) {
			photoOuter.parentNode.insertBefore(photo, photoOuter);
			photoOuter.parentNode.removeChild(photoOuter);
		}
		photoOuter = photoInner = photo = null;
	}

	function tiltTargetOf(t) {
		if (!t || !t.closest) return null;
		var card = t.closest('.misc-card');
		if (card) return card;
		if (photoInner && photoInner.contains(t)) return photoInner;
		return null;
	}
	function pose(el, rx, ry, gx, gy) {
		el.style.setProperty('--gt-rx', rx.toFixed(2) + 'deg');
		el.style.setProperty('--gt-ry', ry.toFixed(2) + 'deg');
		el.style.setProperty('--gt-gx', gx.toFixed(1) + '%');
		el.style.setProperty('--gt-gy', gy.toFixed(1) + '%');
	}
	function unpose(el) {
		el.classList.remove('gtilt-is-tilting');
		el.style.removeProperty('--gt-rx');
		el.style.removeProperty('--gt-ry');
		el.style.removeProperty('--gt-gx');
		el.style.removeProperty('--gt-gy');
	}
	function releaseTilt() {
		if (tiltEl) unpose(tiltEl);
		tiltEl = null; tiltRect = null;
	}
	function updateTilt() {
		if (!motionOK()) { releaseTilt(); return; }
		var el = inside ? tiltTargetOf(moveTarget) : null;
		if (el !== tiltEl) {
			releaseTilt();
			tiltEl = el;
			if (el) {
				// The rect is taken once on enter (near rest) and refreshed on
				// scroll/resize, so the rotated box never feeds back into the angle.
				tiltRect = el.getBoundingClientRect();
				el.classList.add('gtilt-is-tilting');
			}
		}
		if (!el) return;
		if (!tiltRect) tiltRect = el.getBoundingClientRect();
		var r = tiltRect;
		if (!r.width || !r.height) return;
		var fx = Math.min(1, Math.max(0, (px - r.left) / r.width));
		var fy = Math.min(1, Math.max(0, (py - r.top) / r.height));
		pose(el, -(fy - 0.5) * 2 * MAX_TILT, (fx - 0.5) * 2 * MAX_TILT, fx * 100, fy * 100);
	}
	function onScrollOrResize() {
		tiltRect = null;
		magDirty = true;
	}

	// ---- 2. navbar indicator -------------------------------------------
	var navUl = null, navInd = null, barA = null, barG = null, navObs = null;
	var firstPlace = true, hoverLink = null, ghostShown = false;

	function navMeasure(link) {
		var r = link.getBoundingClientRect(), u = navUl.getBoundingClientRect();
		var cs = window.getComputedStyle(link);
		var pl = parseFloat(cs.paddingLeft) || 0, pr = parseFloat(cs.paddingRight) || 0;
		return { x: r.left - u.left + pl, w: Math.max(2, r.width - pl - pr) };
	}
	function setBar(bar, m, instant) {
		if (instant) bar.classList.add('no-anim');
		bar.style.transform = 'translateX(' + m.x.toFixed(1) + 'px) scaleX(' + (m.w / 100).toFixed(4) + ')';
		if (instant) { void bar.offsetWidth; bar.classList.remove('no-anim'); }
	}
	function navVisible() {
		return !!navUl && window.innerWidth >= 768 && navUl.offsetParent !== null;
	}
	function activeLink() {
		return navUl ? navUl.querySelector('.nav-link.active') : null;
	}
	function navPlace() {
		if (!navVisible()) { firstPlace = true; return; }
		var a = activeLink();
		if (!a) { barA.classList.remove('is-shown'); return; }
		var m = navMeasure(a);
		setBar(barA, m, firstPlace || window.Gadgets.reducedMotion);
		barA.classList.add('is-shown');
		firstPlace = false;
		if (!ghostShown) setBar(barG, m, true);
	}
	function ghostTo(link) {
		if (!navVisible()) return;
		if (!ghostShown) {
			var a = activeLink();
			if (a) setBar(barG, navMeasure(a), true);
			ghostShown = true;
			barG.classList.add('is-shown');
		}
		setBar(barG, navMeasure(link), window.Gadgets.reducedMotion);
	}
	function ghostHide() {
		hoverLink = null;
		if (!ghostShown) return;
		ghostShown = false;
		barG.classList.remove('is-shown');
		var a = activeLink();
		if (a && navVisible()) setBar(barG, navMeasure(a), window.Gadgets.reducedMotion);
	}
	function setupNav() {
		navUl = document.getElementById('navbarList');
		if (!navUl) return;
		navUl.classList.add('gtilt-nav');
		navInd = document.createElement('li');
		navInd.className = 'gtilt-nav-ind';
		navInd.setAttribute('aria-hidden', 'true');
		navInd.setAttribute('role', 'presentation');
		barG = document.createElement('div');
		barG.className = 'gtilt-nav-bar is-ghost';
		barA = document.createElement('div');
		barA.className = 'gtilt-nav-bar is-active';
		navInd.appendChild(barG);
		navInd.appendChild(barA);
		navUl.appendChild(navInd);
		firstPlace = true; ghostShown = false; hoverLink = null;

		navPlace();
		on(window, 'hashchange', navPlace);
		on(window, 'resize', navPlace);
		on(window, 'load', navPlace);
		if (document.fonts && document.fonts.ready) {
			document.fonts.ready.then(function () { if (active) navPlace(); }, function () { /* ignore */ });
		}
		if (window.MutationObserver) {
			// Only the links' own class changes matter; the bars live inside the
			// list too, and reacting to them would loop.
			navObs = new MutationObserver(function (records) {
				for (var i = 0; i < records.length; i++) {
					var t = records[i].target;
					if (t && t.classList && t.classList.contains('nav-link')) { navPlace(); return; }
				}
			});
			navObs.observe(navUl, { attributes: true, subtree: true, attributeFilter: ['class'] });
		}
		on(navUl, 'pointerover', function (e) {
			if (!finePointer()) return;
			var l = e.target && e.target.closest ? e.target.closest('.nav-link') : null;
			if (!l || !navUl.contains(l) || l === hoverLink) return;
			hoverLink = l;
			ghostTo(l);
		});
		on(navUl, 'pointerleave', ghostHide);
		on(navUl, 'focusout', function (e) {
			if (!e.relatedTarget || !navUl.contains(e.relatedTarget)) ghostHide();
		});
	}
	function teardownNav() {
		if (navObs) { navObs.disconnect(); navObs = null; }
		if (navUl) navUl.classList.remove('gtilt-nav');
		if (navInd && navInd.parentNode) navInd.parentNode.removeChild(navInd);
		navUl = navInd = barA = barG = null;
	}

	// ---- 3. magnetic buttons -------------------------------------------
	var magEls = [], magRects = [], magStamp = 0, magDirty = true, magHeld = [];

	function magCollect() {
		magEls = [];
		var all = document.querySelectorAll(MAG_SEL);
		for (var i = 0; i < all.length; i++) {
			// Only laid-out buttons (bookshelf chips exist only while that section is active).
			if (all[i].offsetParent !== null) magEls.push(all[i]);
		}
		magRects = magEls.map(function (el) { return el.getBoundingClientRect(); });
	}
	function magRelease(el) {
		el.style.removeProperty('--gt-mx');
		el.style.removeProperty('--gt-my');
		el.classList.add('gtilt-mag-release');
		window.setTimeout(function () { el.classList.remove('gtilt-mag-release'); }, 650);
	}
	function releaseAllMagnets() {
		magHeld.forEach(magRelease);
		magHeld = [];
	}
	function updateMagnets() {
		if (!motionOK()) { releaseAllMagnets(); return; }
		var now = window.performance ? window.performance.now() : Date.now();
		if (magDirty || now - magStamp > 300) { magCollect(); magStamp = now; magDirty = false; }
		var held = [];
		for (var i = 0; i < magEls.length; i++) {
			var el = magEls[i], r = magRects[i];
			if (!r.width) continue;
			var dx = px - Math.min(Math.max(px, r.left), r.right);
			var dy = py - Math.min(Math.max(py, r.top), r.bottom);
			var dist = Math.sqrt(dx * dx + dy * dy);
			var wasHeld = magHeld.indexOf(el) !== -1;
			if (dist < MAG_RADIUS && inside) {
				var k = 1 - dist / MAG_RADIUS;
				var cx = r.left + r.width / 2, cy = r.top + r.height / 2;
				var mx = (px - cx) / (r.width / 2 + MAG_RADIUS) * MAG_PULL * k;
				var my = (py - cy) / (r.height / 2 + MAG_RADIUS) * MAG_PULL * k;
				el.style.setProperty('--gt-mx', mx.toFixed(2) + 'px');
				el.style.setProperty('--gt-my', my.toFixed(2) + 'px');
				if (wasHeld) el.classList.remove('gtilt-mag-release');
				held.push(el);
			} else if (wasHeld) {
				magRelease(el);
			}
		}
		// Buttons that vanished (a re-rendered toolbar) are simply dropped.
		magHeld = held;
	}

	// ---- 4. ripples ----------------------------------------------------
	var ripples = [];
	function onDown(e) {
		if (!motionOK() || e.button !== 0 || e.pointerType === 'touch') return;
		var host = e.target && e.target.closest ? e.target.closest(RIPPLE_SEL) : null;
		if (!host) return;
		var r = host.getBoundingClientRect();
		if (!r.width) return;
		var size = Math.max(r.width, r.height) * 1.7;
		host.classList.add('gtilt-ripple-host');
		var w = document.createElement('span');
		w.className = 'gtilt-ripple';
		w.setAttribute('aria-hidden', 'true');
		w.style.setProperty('--x', (e.clientX - r.left).toFixed(1) + 'px');
		w.style.setProperty('--y', (e.clientY - r.top).toFixed(1) + 'px');
		w.style.setProperty('--s', size.toFixed(0) + 'px');
		host.appendChild(w);
		ripples.push(w);
		var done = false;
		function kill() {
			if (done) return;
			done = true;
			if (w.parentNode) w.parentNode.removeChild(w);
			var i = ripples.indexOf(w);
			if (i !== -1) ripples.splice(i, 1);
		}
		w.addEventListener('animationend', kill);
		window.setTimeout(kill, 900);
	}
	function killRipples() {
		ripples.forEach(function (w) { if (w.parentNode) w.parentNode.removeChild(w); });
		ripples = [];
		var hosts = document.querySelectorAll('.gtilt-ripple-host');
		for (var i = 0; i < hosts.length; i++) hosts[i].classList.remove('gtilt-ripple-host');
	}

	// ---- 5. spotlight (dark mode) --------------------------------------
	var spot = null, spotShown = false, theme = window.Gadgets.theme();

	function spotAllowed() { return theme === 'dark' && motionOK(); }
	function hideSpot() {
		if (spot && spotShown) { spot.classList.remove('is-shown'); spotShown = false; }
	}
	function updateSpot() {
		if (!spot) return;
		if (!spotAllowed() || !inside) { hideSpot(); return; }
		spot.style.transform = 'translate3d(' + (px - 150).toFixed(1) + 'px, ' + (py - 150).toFixed(1) + 'px, 0)';
		if (!spotShown) { spot.classList.add('is-shown'); spotShown = true; }
	}
	window.Gadgets.onTheme(function (t) {
		theme = t;
		if (!active) return;
		if (!spotAllowed()) hideSpot();
		else if (inside) schedule();
	});

	// ---- demo pose for screenshots -------------------------------------
	function demoPose() {
		if (!DEMO || !active) return;
		if (photoInner) {
			photoInner.classList.add('gtilt-is-tilting');
			pose(photoInner, 5, -7, 32, 26);
		}
		var card = document.querySelector('.section.active .misc-card');
		if (card && card !== tiltEl) {
			card.classList.add('gtilt-is-tilting');
			pose(card, 4, 6, 68, 30);
		}
		if (spot && theme === 'dark') {
			spot.style.transform = 'translate3d(730px, 290px, 0)';
			spot.classList.add('is-shown'); spotShown = true;
		}
		var blogLink = navUl ? navUl.querySelector('.nav-link[data-route="blog"]') : null;
		if (blogLink && navVisible()) ghostTo(blogLink);
	}

	// ---- enable / disable ----------------------------------------------
	function enable() {
		if (active) return;
		active = true;
		html.classList.add('gtilt-on');
		wrapPhoto();
		setupNav();
		spot = document.createElement('div');
		spot.className = 'gtilt-spot';
		spot.setAttribute('aria-hidden', 'true');
		document.body.appendChild(spot);

		on(document, 'pointermove', onMove, { passive: true });
		on(document, 'pointerdown', onDown, { passive: true });
		on(document, 'mouseout', onLeaveWindow);
		on(window, 'scroll', onScrollOrResize, { passive: true });
		on(window, 'resize', onScrollOrResize);
		on(document, 'visibilitychange', function () {
			if (document.hidden) { releaseTilt(); releaseAllMagnets(); hideSpot(); }
		});
		if (fineMq && fineMq.addEventListener) on(fineMq, 'change', function () { schedule(); });
		if (DEMO) {
			window.requestAnimationFrame(demoPose);
			on(window, 'hashchange', function () { window.requestAnimationFrame(demoPose); });
		}
	}
	function disable() {
		if (!active) return;
		active = false;
		cleanups.forEach(function (fn) { fn(); });
		cleanups = [];
		if (rafId) { window.cancelAnimationFrame(rafId); rafId = 0; }
		releaseTilt();
		releaseAllMagnets();
		var posed = document.querySelectorAll('.gtilt-is-tilting');
		for (var i = 0; i < posed.length; i++) unpose(posed[i]);
		killRipples();
		teardownNav();
		unwrapPhoto();
		if (spot && spot.parentNode) spot.parentNode.removeChild(spot);
		spot = null; spotShown = false;
		html.classList.remove('gtilt-on');
	}

	window.Gadgets.register('tilt', { label: '3D tilt and hover effects', enable: enable, disable: disable });
})();
