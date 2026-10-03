// EN / 日本語 toggle.
//
// English in index.html is the source of truth; nothing in the page markup
// knows about Japanese. assets/data/ja.json is a list of entries:
//
//   { "sel": "<CSS selector>", "en": "<English text>", "ja": "<Japanese>",
//     "index": n,        optional: take the n-th match of sel instead of
//                        searching the matches for the one whose text is `en`
//     "prefix": true,    optional: `en` is only the start of the text
//     "match": "<regex>" optional: run on the English text; {1}, {2}... in `ja`
//                        are replaced by its capture groups
//     "html": true }     optional: `ja` is HTML (otherwise plain text)
//
// Switching to Japanese looks each element up, checks that its current English
// text (whitespace collapsed) still equals `en`, remembers its innerHTML and
// swaps in the Japanese. If the English was edited since the translation was
// written the element is left in English and one console warning is printed,
// so a stale translation never shows wrong content. Switching back restores
// every remembered innerHTML exactly.
//
// The choice is stored in localStorage 'lang'. ?lang=ja (or ?lang=en) forces a
// language for one page load without storing it. ?i18nTest=1 runs a self-test
// (see selfTest below).
//
// API: window.I18n = { lang(), set(lang), toggle() }; a bubbling 'i18n:change'
// event (detail.lang) is dispatched on document after every switch.

(function () {
	'use strict';

	if (window.I18n) return; // loaded twice

	var STORE_KEY = 'lang';
	var NOTE_TEXT = '日本語版は一部のページのみです。';
	var NOTE_HOST = '#aboutmeContent .container > .row';

	var html = document.documentElement;
	var script = document.currentScript;
	var DICT_URL = script && script.src ? new URL('../data/ja.json', script.src).href : 'assets/data/ja.json';

	var current = 'en';      // language on screen
	var wanted = 'en';       // language asked for (differs while ja.json loads)
	var dict = null;         // parsed ja.json
	var dictPromise = null;
	var applied = [];        // [{ el, html, lang }] in the order they were translated
	var warned = {};         // entry index -> true, so each warning prints once
	var note = null;
	var button = null;
	var lastSkipped = [];

	function norm(s) {
		return String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
	}

	function esc(s) {
		return String(s).replace(/[&<>"]/g, function (c) {
			return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
		});
	}

	function param(name) {
		var m = new RegExp('[?&]' + name + '=([^&#]*)').exec(window.location.search);
		return m ? decodeURIComponent(m[1]) : null;
	}

	function stored() {
		try {
			return localStorage.getItem(STORE_KEY);
		} catch (e) {
			return null;
		}
	}

	function store(lang) {
		try {
			localStorage.setItem(STORE_KEY, lang);
		} catch (e) {
			/* private mode etc. */
		}
	}

	function warnOnce(i, msg) {
		if (warned[i]) return;
		warned[i] = true;
		if (window.console && console.warn) console.warn('[i18n] ' + msg);
	}

	// ---- Dictionary ---------------------------------------------------------

	function loadDict() {
		if (!dictPromise) {
			dictPromise = fetch(DICT_URL)
				.then(function (r) {
					if (!r.ok) throw new Error('HTTP ' + r.status);
					return r.json();
				})
				.then(function (list) {
					if (!Array.isArray(list)) throw new Error('ja.json is not a list');
					dict = list;
					return list;
				})
				.catch(function (e) {
					dictPromise = null;
					if (window.console && console.warn) console.warn('[i18n] could not load ' + DICT_URL + ': ' + e.message);
					throw e;
				});
		}
		return dictPromise;
	}

	function textMatches(entry, text) {
		var en = norm(entry.en);
		return entry.prefix ? text.indexOf(en) === 0 : text === en;
	}

	// The element an entry refers to, or null. Without `index` the selector's
	// matches are searched for the one whose text is the entry's English, so an
	// element inserted or reordered by another script does not shift the lookup.
	function find(entry, taken) {
		var nodes;
		try {
			nodes = document.querySelectorAll(entry.sel);
		} catch (e) {
			return null;
		}
		if (typeof entry.index === 'number') {
			var el = nodes[entry.index];
			return el && taken.indexOf(el) === -1 && textMatches(entry, norm(el.textContent)) ? el : null;
		}
		for (var i = 0; i < nodes.length; i++) {
			if (taken.indexOf(nodes[i]) === -1 && textMatches(entry, norm(nodes[i].textContent))) return nodes[i];
		}
		return null;
	}

	// The Japanese innerHTML for an entry, or null when its `match` regex fails.
	function render(entry, text) {
		var ja = String(entry.ja);
		if (entry.match) {
			var m;
			try {
				m = new RegExp(entry.match).exec(text);
			} catch (e) {
				m = null;
			}
			if (!m) return null;
			ja = ja.replace(/\{(\d+)\}/g, function (all, n) {
				return m[+n] == null ? '' : (entry.html ? esc(m[+n]) : m[+n]);
			});
		}
		return entry.html ? ja : esc(ja);
	}

	// ---- Switching ----------------------------------------------------------

	function toJapanese() {
		var taken = [];
		lastSkipped = [];
		dict.forEach(function (entry, i) {
			if (!entry || !entry.sel || entry.ja == null) return;
			var el = find(entry, taken);
			var out = el ? render(entry, norm(el.textContent)) : null;
			if (out == null) {
				lastSkipped.push(i);
				warnOnce(i, 'left in English (page text no longer matches ja.json entry ' + i + '): ' +
					entry.sel + ' / "' + norm(entry.en).slice(0, 60) + '"');
				return;
			}
			taken.push(el);
			applied.push({ el: el, html: el.innerHTML, lang: el.getAttribute('lang') });
			el.innerHTML = out;
			el.setAttribute('lang', 'ja');
			el.setAttribute('data-i18n', '');
		});

		var host = document.querySelector(NOTE_HOST);
		if (host && !note) {
			note = document.createElement('p');
			note.className = 'i18n-note';
			note.setAttribute('lang', 'ja');
			var pill = document.createElement('span');
			pill.textContent = NOTE_TEXT;
			note.appendChild(pill);
			host.insertBefore(note, host.firstChild);
		}
	}

	function toEnglish() {
		// Newest first, so an element nested inside another translated one is
		// put back before its parent.
		for (var i = applied.length - 1; i >= 0; i--) {
			var a = applied[i];
			a.el.innerHTML = a.html;
			if (a.lang == null) a.el.removeAttribute('lang');
			else a.el.setAttribute('lang', a.lang);
			a.el.removeAttribute('data-i18n');
		}
		applied = [];
		if (note && note.parentNode) note.parentNode.removeChild(note);
		note = null;
	}

	function syncButton() {
		if (!button) return;
		var ja = current === 'ja';
		// The label names the language the button switches to, in that language.
		button.textContent = ja ? 'EN' : '日本語';
		button.setAttribute('lang', ja ? 'en' : 'ja');
		button.setAttribute('aria-label', ja ? 'Switch to English' : '日本語に切り替える');
		button.title = ja ? 'Switch to English' : '日本語に切り替える';
		button.setAttribute('aria-pressed', ja ? 'true' : 'false');
	}

	function commit(lang) {
		if (lang === current) return;
		if (lang === 'ja') toJapanese();
		else toEnglish();
		current = lang;
		html.setAttribute('lang', lang);
		syncButton();
		document.dispatchEvent(new CustomEvent('i18n:change', { bubbles: true, detail: { lang: lang } }));
		// Label widths changed: let things that measure the navbar re-place themselves.
		try {
			window.dispatchEvent(new Event('resize'));
		} catch (e) {
			/* old browsers */
		}
	}

	// persist === false is used for ?lang= and the self-test.
	function set(lang, persist) {
		lang = lang === 'ja' ? 'ja' : 'en';
		wanted = lang;
		if (persist !== false) store(lang);
		if (lang === 'en' || dict) {
			commit(lang);
			return Promise.resolve(current);
		}
		return loadDict().then(
			function () {
				// The user may have switched back while ja.json was loading.
				if (wanted === 'ja') commit('ja');
				return current;
			},
			function () {
				wanted = current;
				return current;
			}
		);
	}

	function toggle() {
		return set(wanted === 'ja' ? 'en' : 'ja');
	}

	// ---- Navbar button ------------------------------------------------------

	function buildButton() {
		var theme = document.getElementById('theme-toggle');
		if (!theme || button) return;
		button = document.createElement('button');
		button.id = 'lang-toggle';
		button.className = 'lang-toggle';
		button.type = 'button';
		syncButton();
		theme.parentNode.insertBefore(button, theme);
		button.addEventListener('click', function () {
			toggle();
		});
	}

	// ---- Self-test (?i18nTest=1) --------------------------------------------
	//
	// From English: switch to Japanese and back, and compare the page before
	// and after. The result is logged and written to <html data-i18n-test>.

	function hash(s) {
		var h = 5381;
		for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
		return (h >>> 0).toString(16);
	}

	function selfTest() {
		var start = current;
		commit('en');
		var before = document.body.innerHTML;
		commit('ja');
		var during = document.body.innerHTML;
		var count = applied.length;
		var skipped = lastSkipped.slice();
		var langJa = html.getAttribute('lang');
		commit('en');
		var after = document.body.innerHTML;
		var langEn = html.getAttribute('lang');
		commit(start);

		var ok = before === after && during !== before && skipped.length === 0 && langJa === 'ja' && langEn === 'en';
		var msg = (ok ? 'PASS' : 'FAIL') +
			' entries=' + dict.length + ' translated=' + count + ' skipped=' + skipped.length +
			(skipped.length ? ' [' + skipped.join(',') + ']' : '') +
			' restored=' + (before === after) +
			' len ' + before.length + '->' + during.length + '->' + after.length +
			' hash ' + hash(before) + '->' + hash(during) + '->' + hash(after);
		html.setAttribute('data-i18n-test', msg);
		if (window.console) console.log('[i18n test] ' + msg);
		return ok;
	}

	// ---- Boot ---------------------------------------------------------------

	function boot() {
		buildButton();

		var forced = param('lang');
		var initial = forced === 'ja' || forced === 'en' ? forced : stored() === 'ja' ? 'ja' : 'en';
		var ready = initial === 'ja' ? set('ja', false) : Promise.resolve();

		if (param('i18nTest') === '1') {
			ready
				.then(loadDict)
				.then(function () {
					// After load, so the widgets that build themselves from the page are in place.
					if (document.readyState === 'complete') selfTest();
					else window.addEventListener('load', selfTest);
				})
				.catch(function () {
					html.setAttribute('data-i18n-test', 'FAIL could not load ja.json');
				});
		}
	}

	window.I18n = {
		lang: function () {
			return current;
		},
		set: function (lang) {
			return set(lang);
		},
		toggle: toggle,
	};

	// Deferred scripts that read the English page (glance.js) run before
	// DOMContentLoaded, so translating from here on cannot feed them Japanese.
	var booted = false;
	function bootOnce() {
		if (booted) return;
		booted = true;
		boot();
	}
	if (document.readyState === 'complete') bootOnce();
	else {
		document.addEventListener('DOMContentLoaded', bootOnce);
		window.addEventListener('load', bootOnce);
	}
})();
