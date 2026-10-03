// Gadgets registry: the small shell-level effects (ambient background, navbar
// cat, "Now" card, signature, tilt, 3D book, easter eggs) register here so one
// switch can turn each of them on or off. Preferences live in localStorage
// under "gadgets.v1" as { name: true|false }; everything defaults to on.
//
//   Gadgets.register('navcat', { enable: fn, disable: fn, label: 'Navbar cat' })
//   Gadgets.enabled('navcat')      -> boolean
//   Gadgets.set('navcat', false)   -> calls disable(), persists, fires 'gadgets:change'
//   Gadgets.toggle('navcat')
//   Gadgets.list()                 -> [{ name, label, on }]
//   Gadgets.reducedMotion          -> boolean (live)
//   Gadgets.theme()                -> 'light' | 'dark' (reads <html data-theme>)
//   Gadgets.onTheme(fn)            -> fn(theme) now and whenever data-theme changes
//
// A gadget's enable() is called once the DOM is ready (or immediately when it
// registers after that), and only if it is switched on.

(function () {
	'use strict';

	var KEY = 'gadgets.v1';
	var prefs = {};
	try { prefs = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { prefs = {}; }

	var gadgets = {};
	var order = [];
	var ready = document.readyState !== 'loading';
	if (!ready) document.addEventListener('DOMContentLoaded', function () { ready = true; order.forEach(start); });

	var mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

	function save() {
		try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch (e) { /* private mode */ }
	}
	function enabled(name) {
		return prefs[name] !== false;
	}
	function start(name) {
		var g = gadgets[name];
		if (!g || g.running || !enabled(name)) return;
		g.running = true;
		try { g.api.enable(); } catch (e) { g.running = false; if (window.console) console.warn('gadget ' + name + ' failed to start', e); }
	}
	function stop(name) {
		var g = gadgets[name];
		if (!g || !g.running) return;
		g.running = false;
		try { g.api.disable(); } catch (e) { if (window.console) console.warn('gadget ' + name + ' failed to stop', e); }
	}
	function fire(name) {
		try { document.dispatchEvent(new CustomEvent('gadgets:change', { detail: { name: name, on: enabled(name) } })); } catch (e) { /* old browsers */ }
	}

	var themeListeners = [];
	function theme() {
		return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
	}
	if (window.MutationObserver) {
		new MutationObserver(function () {
			var t = theme();
			themeListeners.forEach(function (fn) { try { fn(t); } catch (e) { /* ignore */ } });
		}).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
	}

	window.Gadgets = {
		register: function (name, api) {
			if (gadgets[name]) return;
			gadgets[name] = { api: api, running: false, label: api.label || name };
			order.push(name);
			if (ready) start(name);
		},
		enabled: enabled,
		set: function (name, on) {
			prefs[name] = !!on;
			save();
			if (on) start(name); else stop(name);
			fire(name);
		},
		toggle: function (name) { window.Gadgets.set(name, !enabled(name)); },
		list: function () {
			return order.map(function (n) { return { name: n, label: gadgets[n].label, on: enabled(n) }; });
		},
		get reducedMotion() { return !!(mq && mq.matches); },
		theme: theme,
		onTheme: function (fn) { themeListeners.push(fn); try { fn(theme()); } catch (e) { /* ignore */ } },
	};
})();
