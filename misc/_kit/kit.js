/*
 * ToyKit: the shared page kit for the toys under misc/.
 *
 * A toy loads two files in its <head>, in this order:
 *     <link rel="stylesheet" href="../_kit/kit.css"><script src="../_kit/kit.js"></script>
 * and gets what every toy used to write by hand: the header (title, sub line,
 * theme toggle, help button, back link), the help dialog, the "How it works"
 * footer, the site's theme, the ?thumb=1 and reduced-motion switches, a
 * seeded random generator, namespaced storage, one shared loader for the
 * library catalogue and for the blog, a loader for CDN scripts with a failure
 * panel, and one shared AudioContext. README.md in this folder is the manual.
 *
 * This file runs synchronously, before first paint, and at once
 *   - sets <html data-theme="light|dark"> from ?theme=, then localStorage
 *     "theme" (the site's own key), then prefers-color-scheme;
 *   - adds class "is-thumb" to <html> under ?thumb=1;
 *   - adds class "is-reduced" to <html> while motion should be reduced;
 *   - sets window.__toyReady = false (ToyKit.ready() makes it true).
 *
 * Old-style browser code on purpose: one IIFE, no modules, no build step.
 * The pure helpers in the first half are also exported through
 * module.exports, so `node misc/_kit/test.js` can test them without a browser.
 */
(function () {
	'use strict';

	var VERSION = 1;
	var THUMB_DAY = '2026-10-03';        // what daily() answers under ?thumb=1
	var FETCH_TIMEOUT = 20000;
	var SCRIPT_TIMEOUT = 8000;
	var CDN_HOSTS = ['cdn.jsdelivr.net', 'cdnjs.cloudflare.com'];

	// =========================================================================
	// Pure helpers (no DOM; exported to Node)
	// =========================================================================

	// ---- Hash and random numbers ---------------------------------------------
	// The same FNV-1a and mulberry32 as misc/55-paper-theatre/vn.js, so one seed
	// gives the same numbers everywhere on the site.

	function hash(str) {
		str = String(str == null ? '' : str);
		var h = 2166136261;
		for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
		return h >>> 0;
	}

	function mulberry32(a) {
		return function () {
			a |= 0; a = (a + 0x6D2B79F5) | 0;
			var t = Math.imul(a ^ (a >>> 15), 1 | a);
			t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
			return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
		};
	}

	// rng(seed) -> next(): a number in [0, 1). The seed is a string or a number.
	// next.int(n) is an integer in 0..n-1, next.pick(list) one item of a list,
	// next.shuffle(list) a shuffled copy (the list itself is left alone).
	function rng(seed) {
		var next = mulberry32(typeof seed === 'number' ? seed >>> 0 : hash(seed));
		next.int = function (n) {
			var r = next();
			return n > 0 ? Math.floor(r * Math.floor(n)) : 0;
		};
		next.pick = function (list) {
			return list && list.length ? list[Math.floor(next() * list.length)] : undefined;
		};
		next.shuffle = function (list) {
			var out = Array.prototype.slice.call(list || []);
			for (var i = out.length - 1; i > 0; i--) {
				var j = Math.floor(next() * (i + 1));
				var t = out[i]; out[i] = out[j]; out[j] = t;
			}
			return out;
		};
		return next;
	}

	// daily() -> 'YYYY-MM-DD' in local time; daily({ utc: true }) in UTC.
	// { date: aDate } asks about another day.
	function daily(opts) {
		opts = opts || {};
		var d = opts.date instanceof Date ? opts.date : new Date();
		function two(n) { return (n < 10 ? '0' : '') + n; }
		return opts.utc
			? d.getUTCFullYear() + '-' + two(d.getUTCMonth() + 1) + '-' + two(d.getUTCDate())
			: d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate());
	}

	// ---- Blog posts: front matter and plain text ------------------------------

	// Splits a post file into { meta, body }. The front matter is the simple
	// "key: value" block that assets/js/blog.js reads; "[a, b]" is a list.
	function frontMatter(text) {
		var body = String(text == null ? '' : text);
		if (body.charCodeAt(0) === 0xFEFF) body = body.slice(1);       // a byte-order mark
		var meta = {};
		var m = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(body);
		if (m) {
			body = body.slice(m[0].length);
			m[1].split(/\r?\n/).forEach(function (line) {
				var at = line.indexOf(':');
				if (at === -1) return;
				var key = line.slice(0, at).trim();
				var val = line.slice(at + 1).trim();
				if (!key || key === '__proto__') return;
				if (val.charAt(0) === '[' && val.charAt(val.length - 1) === ']') {
					meta[key] = val.slice(1, -1).split(',').map(function (s) {
						return s.trim().replace(/^["']|["']$/g, '');
					}).filter(Boolean);
				} else {
					meta[key] = val.replace(/^["']|["']$/g, '');
				}
			});
		}
		return { meta: meta, body: body };
	}

	// Where the backtick run of exactly `len` that closes a code span starts, or -1.
	function closingRun(line, from, len) {
		for (var i = from; i < line.length; i++) {
			if (line.charAt(i) !== '`') continue;
			var run = 1;
			while (line.charAt(i + run) === '`') run++;
			if (run === len) return i;
			i += run - 1;
		}
		return -1;
	}

	var FENCE = /^ {0,3}(`{3,}|~{3,})/;
	function closesFence(line, fence) {
		var f = FENCE.exec(line);
		return !!f && f[1].charAt(0) === fence.charAt(0) && f[1].length >= fence.length && /^\s*$/.test(line.slice(f[0].length));
	}

	// Removes HTML comments entirely: across lines, and to the end of the text
	// when one is never closed. An author comments text out to unpublish it, so
	// nothing inside a comment may reach a reader. Fenced code blocks and
	// `code spans` are kept as they are.
	function stripComments(md) {
		var lines = String(md == null ? '' : md).split('\n');
		var out = [], fence = '', inComment = false;
		for (var i = 0; i < lines.length; i++) {
			var line = lines[i];
			if (!inComment) {
				if (fence) { out.push(line); if (closesFence(line, fence)) fence = ''; continue; }
				var f = FENCE.exec(line);
				if (f) { fence = f[1]; out.push(line); continue; }
			}
			var kept = '', touched = inComment, j = 0;
			while (j < line.length) {
				if (inComment) {
					var end = line.indexOf('-->', j);
					if (end === -1) { j = line.length; break; }
					inComment = false; j = end + 3;
					continue;
				}
				var c = line.charAt(j);
				if (c === '`') {
					var run = 1;
					while (line.charAt(j + run) === '`') run++;
					var close = closingRun(line, j + run, run);
					if (close === -1) { kept += line.substr(j, run); j += run; }
					else { kept += line.slice(j, close + run); j = close + run; }
					continue;
				}
				if (c === '<' && line.substr(j, 4) === '<!--') { inComment = true; touched = true; j += 4; continue; }
				kept += c; j++;
			}
			// a line that held nothing but comment goes away with it
			if (touched && /^\s*$/.test(kept)) continue;
			out.push(kept);
		}
		return out.join('\n');
	}

	var WORD = 'A-Za-z0-9\\u00C0-\\u024F\\u0370-\\u03FF\\u0400-\\u04FF\\u3040-\\u30FF\\u4E00-\\u9FFF';
	var RE_UNDERSCORES = new RegExp('(^|[^_' + WORD + '])(_{1,3})(?=\\S)(.{0,5000}?\\S)\\2(?![_' + WORD + '])', 'g');
	// Written as strings for new RegExp, and as character codes, so that this
	// file stays plain ASCII: the private-use characters park() hands out, runs
	// of blanks (a no-break space counts), and the few named entities worth knowing.
	var RE_PARKED = new RegExp('[\\uE000-\\uF8FF]', 'g');
	var RE_SPACES = new RegExp('[ \\t\\u00A0]+', 'g');
	var ENTITIES = {
		lt: '<', gt: '>', quot: '"', apos: '\'', nbsp: ' ', amp: '&',
		mdash: String.fromCharCode(0x2014), ndash: String.fromCharCode(0x2013), hellip: String.fromCharCode(0x2026)
	};

	// The markup inside one line: links keep their words, emphasis loses its marks.
	function inlineText(s) {
		if (!s) return '';
		// Escaped characters and code spans are parked as private-use characters
		// while the marks around them are removed, and put back at the end.
		var parked = [];
		function park(text) { parked.push(text); return String.fromCharCode(0xE000 + parked.length - 1); }
		s = s.replace(RE_PARKED, '');
		s = s.replace(/\\([\\`*_{}\[\]()#+\-.!|<>~$])/g, function (m, ch) { return park(ch); });
		s = s.replace(/(`+)(.+?)\1(?!`)/g, function (m, ticks, code) { return park(code.trim()); });
		s = s.replace(/!\[[^\]]*\]\((?:[^()\s]|\([^()]*\))*(?:\s+"[^"]*")?\)/g, '');                         // images
		s = s.replace(/!\[[^\]]*\]\[[^\]]*\]/g, '');
		s = s.replace(/\[((?:[^\[\]]|\[[^\[\]]*\])*)\]\((?:[^()\s]|\([^()]*\))*(?:\s+"[^"]*")?\)/g, '$1');     // [words](url)
		s = s.replace(/\[((?:[^\[\]]|\[[^\[\]]*\])*)\]\[[^\]]*\]/g, '$1');                                    // [words][ref]
		s = s.replace(/\[\^[^\]]+\]/g, '');                                                                   // footnote marks
		s = s.replace(/<((?:https?:\/\/|mailto:)[^>\s]+)>/g, '$1');                                           // <https://...>
		// HTML tags. Only up to the last ">" of the line: past it no tag can close,
		// and looking for one from every "<" would take quadratic time.
		var cut = s.lastIndexOf('>') + 1;
		s = s.slice(0, cut).replace(/<br\s*\/?>/gi, ' ').replace(/<\/?[A-Za-z][^>]*>/g, '') + s.slice(cut);
		// **strong**, *em*, ***both***, ~~struck~~, _em_: matched pairs only, so "2 * 3"
		// and snake_case stay. A pair is looked for within 5,000 characters.
		for (var pass = 0; pass < 4; pass++) {
			var before = s;
			s = s.replace(/(\*{1,3}|~~)(?=\S)(.{0,5000}?\S)\1/g, '$2');
			s = s.replace(RE_UNDERSCORES, '$1$3');
			if (s === before) break;
		}
		s = s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, function (m, name) {
			if (name.charAt(0) === '#') {
				var code = name.charAt(1).toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
				return code > 0 && code < 0x110000 && String.fromCodePoint ? String.fromCodePoint(code) : m;
			}
			var known = ENTITIES[name.toLowerCase()];
			return known == null ? m : known;
		});
		s = s.replace(RE_PARKED, function (ch) {
			var text = parked[ch.charCodeAt(0) - 0xE000];
			return text == null ? '' : text;
		});
		return s.replace(RE_SPACES, ' ').trim();
	}

	// Markdown to plain prose. Front matter, HTML comments, code fences and all
	// markup go; the words stay. One paragraph, heading or list item per line,
	// with a blank line between blocks.
	function markdownToText(md) {
		var body = frontMatter(md).body.replace(/\r\n?/g, '\n');
		body = stripComments(body).replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, '');
		var lines = body.split('\n');
		var out = [], fence = '';
		for (var i = 0; i < lines.length; i++) {
			var line = lines[i];
			if (fence) { if (closesFence(line, fence)) fence = ''; continue; }
			var f = FENCE.exec(line);
			if (f) { fence = f[1]; out.push(''); continue; }
			if (/^ {0,3}([-*_])( *\1){2,} *$/.test(line)) { out.push(''); continue; }                       // a rule
			if (/^ {0,3}=+ *$/.test(line)) continue;                                                        // setext underline
			if (/^ {0,3}\[[^\]^][^\]]*\]:\s*\S+/.test(line)) continue;                                      // link definition
			if (line.indexOf('|') !== -1 && /^[\s|:-]*-[\s|:-]*$/.test(line)) continue;                     // table rule
			line = line.replace(/^\s*(?:>\s?)+/, '');                                                        // quote marks
			line = line.replace(/^\s*(?:[-*+]|\d{1,9}[.)])\s+(?:\[[ xX]\]\s+)?/, '');                        // list marks, task boxes
			line = line.replace(/^\s*#{1,6}\s+/, '').replace(/\s+#+\s*$/, '');                               // heading marks
			line = line.replace(/^\s*\[\^[^\]]+\]:\s*/, '');                                                 // a footnote keeps its words
			if (/^\s*\|.*\|\s*$/.test(line)) line = line.replace(/^\s*\||\|\s*$/g, '').replace(/\s*\|\s*/g, ' ');   // table row
			out.push(inlineText(line));
		}
		return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
	}

	// ---- Where things are -------------------------------------------------------

	// The site root from the URL kit.js itself was loaded from:
	// https://example.org/misc/_kit/kit.js -> https://example.org/
	function rootFromScript(src) {
		var s = String(src == null ? '' : src).replace(/[?#].*$/, '');
		var m = /^(.*\/)misc\/_kit\/[^\/]*$/.exec(s);
		if (m) return m[1];
		try { return new URL('../../', s).href; } catch (e) { return ''; }
	}

	// The folder a page lives in: '/misc/56-some-toy/index.html' -> '56-some-toy'.
	function idFromPath(pathname) {
		var parts = String(pathname == null ? '' : pathname).replace(/[?#].*$/, '').split('/');
		parts.pop();
		var last = '';
		while (parts.length && !last) last = parts.pop();
		try { last = decodeURIComponent(last); } catch (e) { /* keep it as it is */ }
		return cleanId(last) || 'toy';
	}
	function cleanId(id) { return String(id == null ? '' : id).replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, ''); }

	// Every key a toy stores is "toy.<id>.<key>".
	function storageKey(id, key) { return 'toy.' + id + '.' + key; }

	var pure = {
		VERSION: VERSION, THUMB_DAY: THUMB_DAY, CDN_HOSTS: CDN_HOSTS,
		hash: hash, mulberry32: mulberry32, rng: rng, daily: daily,
		frontMatter: frontMatter, stripComments: stripComments, markdownToText: markdownToText,
		rootFromScript: rootFromScript, idFromPath: idFromPath, storageKey: storageKey
	};
	if (typeof module === 'object' && module && module.exports) module.exports = pure;
	if (typeof window === 'undefined' || typeof document === 'undefined') return;
	if (window.ToyKit && window.ToyKit.version) return;      // loaded twice: the first one stays

	// =========================================================================
	// Browser part
	// =========================================================================

	var html = document.documentElement;
	var params;
	try { params = new URLSearchParams(window.location.search); } catch (e) { params = new URLSearchParams(''); }
	var thumb = params.get('thumb') === '1';

	window.__toyReady = false;
	if (thumb) html.classList.add('is-thumb');

	function media(query) {
		try { return window.matchMedia ? window.matchMedia(query) : null; } catch (e) { return null; }
	}
	function watch(mq, fn) {
		if (!mq) return;
		if (mq.addEventListener) mq.addEventListener('change', fn);
		else if (mq.addListener) mq.addListener(fn);
	}
	// A listener that throws is reported in the console but does not stop the others.
	function emit(fns, value) {
		fns.slice().forEach(function (fn) {
			try { fn(value); } catch (err) { setTimeout(function () { throw err; }, 0); }
		});
	}
	function subscribe(fns, fn) {
		if (typeof fn !== 'function') return function () {};
		fns.push(fn);
		return function () { var i = fns.indexOf(fn); if (i !== -1) fns.splice(i, 1); };
	}
	function plain(message, detail) {
		var err = new Error(message);
		err.plain = true;              // the message can be shown to a reader as it is
		err.detail = detail || '';     // the technical part
		return err;
	}

	// ---- Theme (the site's: localStorage "theme", <html data-theme>) ----------

	function validTheme(t) { return t === 'light' || t === 'dark' ? t : null; }
	var queryTheme = validTheme(params.get('theme'));
	var darkQuery = media('(prefers-color-scheme: dark)');
	var themeFns = [];

	function storedTheme() {
		try { return validTheme(window.localStorage.getItem('theme')); } catch (e) { return null; }
	}
	function osTheme() { return darkQuery && darkQuery.matches ? 'dark' : 'light'; }
	function theme() { return html.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'; }

	html.setAttribute('data-theme', queryTheme || storedTheme() || osTheme());

	function applyTheme(t) {
		if (html.getAttribute('data-theme') === t) return;
		html.setAttribute('data-theme', t);
		syncThemeButton();
		emit(themeFns, t);
	}
	function setTheme(t) {
		t = validTheme(t);
		if (!t) return theme();
		try { window.localStorage.setItem('theme', t); } catch (e) { /* private mode: the page still switches */ }
		applyTheme(t);
		return t;
	}
	function onTheme(fn) { return subscribe(themeFns, fn); }

	// Another tab (the site itself, or another toy) switched the theme.
	window.addEventListener('storage', function (e) {
		if (e.key !== 'theme' && e.key !== null) return;
		var t = e.key === null ? null : validTheme(e.newValue);
		applyTheme(t || queryTheme || storedTheme() || osTheme());
	});
	// The OS switched, and the reader never chose a theme here.
	watch(darkQuery, function () {
		if (!queryTheme && !storedTheme()) applyTheme(osTheme());
	});
	// Back from the site with the Back button: the page is shown again as it was
	// left, and may have missed a switch made in the meantime.
	window.addEventListener('pageshow', function (e) {
		if (e.persisted && !queryTheme) applyTheme(storedTheme() || osTheme());
	});

	// ---- Reduced motion ---------------------------------------------------------

	var motionQuery = media('(prefers-reduced-motion: reduce)');
	var motionForced = params.get('motion') === 'reduce';
	var motionFns = [];

	function reduced() { return thumb || motionForced || !!(motionQuery && motionQuery.matches); }
	function syncMotion() { html.classList.toggle('is-reduced', reduced()); }
	syncMotion();
	watch(motionQuery, function () { syncMotion(); emit(motionFns, reduced()); });

	function onMotion(fn) {
		var off = subscribe(motionFns, fn);
		if (typeof fn === 'function') fn(reduced());
		return off;
	}

	// ---- Where the site is ------------------------------------------------------

	var script = document.currentScript || document.querySelector('script[src*="_kit/kit.js"]');
	var kitUrl = script && script.src ? String(script.src) : '';
	var root = rootFromScript(kitUrl);
	if (!root) {
		// kit.js was not loaded from a file (inlined, say): take the page to be misc/<toy>/index.html
		try { root = new URL('../../', window.location.href).href; } catch (e) { root = '/'; }
	}
	var kitBase = kitUrl ? kitUrl.replace(/[?#].*$/, '').replace(/[^\/]*$/, '') : root + 'misc/_kit/';

	// ---- Storage ("toy.<id>.<key>", JSON) ----------------------------------------

	var toyId = idFromPath(window.location.pathname);    // until init({ id }) names the toy

	function store(key, value) {
		try {
			var k = storageKey(toyId, key);
			var json = value == null ? undefined : JSON.stringify(value);
			if (json === undefined) window.localStorage.removeItem(k);
			else window.localStorage.setItem(k, json);
			return true;
		} catch (e) { return false; }        // quota, private mode, storage switched off
	}
	function load(key, fallback) {
		try {
			var raw = window.localStorage.getItem(storageKey(toyId, key));
			if (raw == null) return fallback;
			var value = JSON.parse(raw);
			return value == null ? fallback : value;
		} catch (e) { return fallback; }
	}

	// ---- Fetching the site's own data ---------------------------------------------

	// Resolves with the text of a same-site file. Rejects with an Error whose
	// message can be shown to a reader as it is; err.detail has the technical part.
	function getText(url, what) {
		if (typeof window.fetch !== 'function') {
			return Promise.reject(plain(what + ' could not be loaded because this browser is too old for this page.', 'window.fetch is missing'));
		}
		var ctl = typeof AbortController === 'function' ? new AbortController() : null;
		var timer = setTimeout(function () { if (ctl) ctl.abort(); }, FETCH_TIMEOUT);
		return window.fetch(url, ctl ? { signal: ctl.signal } : undefined).then(function (res) {
			if (!res.ok) throw plain(what + ' could not be loaded (the server answered ' + res.status + ').', 'GET ' + url + ' -> HTTP ' + res.status);
			return res.text();
		}).then(function (text) {
			clearTimeout(timer);
			return text;
		}, function (err) {
			clearTimeout(timer);
			if (err && err.plain) throw err;
			if (window.location.protocol === 'file:') {
				throw plain(what + ' could not be loaded because this page was opened straight from a file. Open it from the website, or through a local web server.', 'GET ' + url + ' from a file: page');
			}
			if (err && err.name === 'AbortError') {
				throw plain(what + ' took too long to load. Reloading the page usually fixes it.', 'GET ' + url + ' timed out after ' + FETCH_TIMEOUT + ' ms');
			}
			throw plain(what + ' could not be loaded. The connection may be down; reloading the page usually fixes it.', 'GET ' + url + ' failed: ' + (err && err.message ? err.message : String(err)));
		});
	}
	function getJSON(url, what) {
		return getText(url, what).then(function (text) {
			try { return JSON.parse(text); }
			catch (e) { throw plain(what + ' arrived damaged and could not be read.', 'GET ' + url + ' is not valid JSON: ' + e.message); }
		});
	}

	// ---- The library ----------------------------------------------------------------

	var libraryPromise = null;

	function tables() {
		if (window.ToyKitLibrary) return Promise.resolve(window.ToyKitLibrary);
		return loadScript(kitBase + 'library.js', { global: 'ToyKitLibrary' }).then(null, function (err) {
			throw plain('The library tables could not be loaded. Reloading the page usually fixes it.', err && err.detail ? err.detail : String(err && err.message));
		});
	}
	function buildLibrary(data, T) {
		if (!data || typeof data !== 'object' || !Array.isArray(data.books)) {
			throw plain('The library catalogue arrived damaged and could not be read.', 'assets/data/library.json has no "books" list');
		}
		var books = data.books;
		var objects = Array.isArray(data.objects) ? data.objects : [];
		T.decorate(books);
		T.decorate(objects);
		var byId = Object.create(null);
		objects.forEach(function (o) { byId[o.id] = o; });
		books.forEach(function (b) { byId[b.id] = b; });
		var lib = { generated: data.generated || '', counts: data.counts || {}, books: books, objects: objects, byId: byId };
		Object.keys(T).forEach(function (k) { lib[k] = T[k]; });
		return lib;
	}
	// One fetch for the whole page, however many callers.
	function library() {
		if (!libraryPromise) {
			libraryPromise = Promise.all([getJSON(root + 'assets/data/library.json', 'The library catalogue'), tables()]).then(function (got) {
				return buildLibrary(got[0], got[1]);
			});
			libraryPromise.then(null, function () { libraryPromise = null; });     // a failed load can be tried again
		}
		return libraryPromise;
	}

	// ---- The blog (published posts only: whatever blog/index.json lists) ----------

	var indexPromise = null;
	var postPromises = Object.create(null);

	function postIndex() {
		if (!indexPromise) {
			indexPromise = getJSON(root + 'blog/index.json', 'The list of blog posts').then(function (list) {
				if (!Array.isArray(list)) throw plain('The list of blog posts arrived damaged and could not be read.', 'blog/index.json is not a list');
				return list;
			});
			indexPromise.then(null, function () { indexPromise = null; });
		}
		return indexPromise;
	}
	function posts() {
		return postIndex().then(function (list) { return list.slice(); });
	}
	function post(slug) {
		slug = String(slug == null ? '' : slug);
		if (!postPromises[slug]) {
			postPromises[slug] = postIndex().then(function (list) {
				var entry = null;
				for (var i = 0; i < list.length; i++) {
					if (list[i] && list[i].slug === slug) { entry = list[i]; break; }
				}
				if (!entry) throw plain('There is no published post called "' + slug + '".', 'slug ' + JSON.stringify(slug) + ' is not in blog/index.json');
				var file = String(entry.file || '');
				if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\.md$/.test(file)) {
					throw plain('That blog post could not be loaded.', 'unexpected file name in blog/index.json: ' + JSON.stringify(file));
				}
				return getText(root + 'blog/posts/' + file, 'That blog post').then(function (raw) {
					var parsed = frontMatter(raw);
					var meta = {};
					Object.keys(parsed.meta).forEach(function (k) { meta[k] = parsed.meta[k]; });
					Object.keys(entry).forEach(function (k) { meta[k] = entry[k]; });
					var markdown = stripComments(parsed.body.replace(/\r\n?/g, '\n')).replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '');
					return { meta: meta, markdown: markdown, text: markdownToText(raw) };
				});
			});
			postPromises[slug].then(null, function () { delete postPromises[slug]; });
		}
		return postPromises[slug].then(function (p) {
			var meta = {};
			Object.keys(p.meta).forEach(function (k) { meta[k] = p.meta[k]; });
			return { meta: meta, markdown: p.markdown, text: p.text };
		});
	}

	// ---- Scripts from a CDN -----------------------------------------------------------

	var scriptPromises = Object.create(null);

	function hostOf(url) {
		try { return new URL(url, window.location.href).host; } catch (e) { return ''; }
	}
	function inject(url, opts) {
		var p = new Promise(function (resolve, reject) {
			var timeout = opts.timeoutMs > 0 ? +opts.timeoutMs : SCRIPT_TIMEOUT;
			var host = hostOf(url);
			var from = host && host !== window.location.host ? ' from ' + host : '';
			var message = 'A script this page needs could not be loaded' + from + '. The connection may be down; reloading the page usually fixes it.';
			try {
				var u = new URL(url, window.location.href);
				if (/^https?:$/.test(u.protocol) && u.host !== window.location.host && CDN_HOSTS.indexOf(u.host) === -1 && window.console && console.warn) {
					console.warn('ToyKit.loadScript: ' + u.host + ' is not a CDN this site uses (' + CDN_HOSTS.join(', ') + ').');
				}
			} catch (e) { /* not a URL the browser can parse: the load below fails and says so */ }
			var s = document.createElement('script');
			var done = false;
			function finish(err) {
				if (done) return;
				done = true;
				clearTimeout(timer);
				s.onload = s.onerror = null;
				if (!err) { resolve(); return; }
				if (s.parentNode) s.parentNode.removeChild(s);
				reject(err);
			}
			var timer = setTimeout(function () { finish(plain(message, 'timed out after ' + timeout + ' ms: ' + url)); }, timeout);
			s.onload = function () { finish(null); };
			s.onerror = function () { finish(plain(message, 'could not load ' + url)); };
			if (opts.integrity) { s.integrity = String(opts.integrity); s.crossOrigin = 'anonymous'; }
			s.async = true;
			s.src = url;
			(document.head || html).appendChild(s);
		});
		p.then(null, function () { delete scriptPromises[url]; });      // a failed load can be tried again
		return p;
	}
	// loadScript(url, { integrity, timeoutMs: 8000, global: 'Name' }) -> Promise.
	// Resolves once the script has run (with window[global] when a global is
	// named, and only if it exists); rejects otherwise. Never throws.
	function loadScript(url, opts) {
		opts = opts || {};
		var name = opts.global ? String(opts.global) : '';
		var loading;
		try {
			if (typeof url !== 'string' || !url) {
				return Promise.reject(plain('A script this page needs could not be loaded.', 'ToyKit.loadScript was called without a URL'));
			}
			if (name && window[name] != null) return Promise.resolve(window[name]);
			loading = scriptPromises[url] || (scriptPromises[url] = inject(url, opts));
		} catch (err) {
			return Promise.reject(err);
		}
		return loading.then(function () {
			if (name && window[name] == null) {
				throw plain('A script this page needs loaded but did not work. Reloading the page usually fixes it.', url + ' did not define window.' + name);
			}
			return name ? window[name] : true;
		});
	}

	// ---- Small DOM helpers ---------------------------------------------------------------

	function el(tag, cls, text) {
		var node = document.createElement(tag);
		if (cls) node.className = cls;
		if (text != null) node.textContent = text;
		return node;
	}
	function whenBody(fn) {
		if (document.body) fn();
		else document.addEventListener('DOMContentLoaded', function () { fn(); });
	}

	var ui = { header: null, h1: null, sub: null, tools: null, theme: null, help: null, back: null, footer: null, fail: null, toast: null };
	var cfg = { title: '', sub: '', back: 'misc', help: null, footer: null };
	var pageTitle = false, pageSub = false;

	// ---- The failure panel ----------------------------------------------------------------

	var GENERIC_FAILURE = 'Part of this page could not be loaded, so it may look unfinished. Reloading usually fixes it.';

	// fail('plain words', { detail: 'technical words' }) or fail(anError).
	// Shows the .kit-fail panel under the header. The page goes on: a toy that
	// fails still calls ToyKit.ready().
	function fail(message, opts) {
		opts = opts || {};
		var text, detail;
		if (message && typeof message === 'object') {
			text = message.plain && message.message ? String(message.message) : GENERIC_FAILURE;
			detail = opts.detail != null ? opts.detail : (message.detail || (message.plain ? '' : message.message) || '');
		} else {
			text = message ? String(message) : GENERIC_FAILURE;
			detail = opts.detail != null ? opts.detail : '';
		}
		html.setAttribute('data-toy-failed', '1');
		whenBody(function () {
			var panel = ui.fail;
			if (!panel) {
				panel = ui.fail = el('div', 'kit-fail');
				panel.setAttribute('role', 'alert');
				panel.appendChild(el('div', 'kit-fail-body'));
				var close = el('button', 'kit-btn small kit-fail-close', 'Dismiss');
				close.type = 'button';
				close.addEventListener('click', function () {
					if (panel.parentNode) panel.parentNode.removeChild(panel);
					if (ui.fail === panel) ui.fail = null;
				});
				panel.appendChild(close);
			}
			if (!panel.parentNode) {
				if (ui.header && ui.header.parentNode) ui.header.parentNode.insertBefore(panel, ui.header.nextSibling);
				else document.body.insertBefore(panel, document.body.firstChild);
			}
			var body = panel.firstChild;
			var shown = body.querySelectorAll('.kit-fail-msg');
			for (var i = 0; i < shown.length; i++) if (shown[i].textContent === text) return;     // said already
			body.appendChild(el('p', 'kit-fail-msg', text));
			if (detail) {
				var more = el('details', 'kit-fail-detail');
				more.appendChild(el('summary', null, 'Details'));
				more.appendChild(el('code', null, String(detail)));
				body.appendChild(more);
			}
		});
	}

	// ---- Toast --------------------------------------------------------------------------------

	var toastTimer = 0;

	function toastNode() {
		if (!ui.toast && document.body) {
			ui.toast = el('div', 'kit-toast');
			ui.toast.setAttribute('role', 'status');
			ui.toast.setAttribute('aria-live', 'polite');
			ui.toast.setAttribute('aria-atomic', 'true');
			document.body.appendChild(ui.toast);
		}
		return ui.toast;
	}
	// A short message at the bottom of the page, read out politely by screen readers.
	function toast(text, ms) {
		if (thumb) return;
		whenBody(function () {
			var node = toastNode();
			node.textContent = String(text == null ? '' : text);
			node.classList.add('show');
			clearTimeout(toastTimer);
			toastTimer = setTimeout(function () { node.classList.remove('show'); }, ms > 0 ? ms : 2600);
		});
	}

	// ---- Download -----------------------------------------------------------------------------

	// download('name.txt', 'text' or a Blob, 'text/plain')
	function download(filename, data, mime) {
		var blob = typeof Blob !== 'undefined' && data instanceof Blob
			? data
			: new Blob([data == null ? '' : data], { type: mime || 'text/plain;charset=utf-8' });
		var url = URL.createObjectURL(blob);
		var a = el('a');
		a.href = url;
		a.download = String(filename || 'download');
		a.style.display = 'none';
		(document.body || html).appendChild(a);
		a.click();
		if (a.parentNode) a.parentNode.removeChild(a);
		setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
	}

	// ---- Audio: one AudioContext, made on the first user gesture ---------------------------------

	var AudioCtor = window.AudioContext || window.webkitAudioContext;
	var audioCtx = null, audioWaiting = [], gestured = false, audioStarting = false;

	function gestureOnRecord() {
		var ua = navigator.userActivation;
		return ua ? !!(ua.isActive || ua.hasBeenActive) : gestured;
	}
	// Only ever called once a gesture is on record.
	function startAudio() {
		try {
			if (!audioCtx || audioCtx.state === 'closed') audioCtx = new AudioCtor();
			if (audioCtx.state !== 'running' && audioCtx.resume) {      // suspended, or interrupted on iOS
				var ctx = audioCtx;
				var settled = function () { audioStarting = false; return ctx; };
				audioStarting = true;
				return audioCtx.resume().then(settled, settled);
			}
			return Promise.resolve(audioCtx);
		} catch (e) {
			return Promise.resolve(null);
		}
	}
	function onGesture(e) {
		if (e && e.isTrusted === false) return;                       // a scripted click is not a gesture
		var ua = navigator.userActivation;
		if (ua) { if (!ua.isActive && !ua.hasBeenActive) return; }    // e.g. the pointerdown of a touch
		else if (e && e.type === 'pointerdown' && e.pointerType !== 'mouse') return;
		else if (e && e.type === 'keydown' && /^(Escape|Esc|Tab|Shift|Control|Alt|Meta|CapsLock)$/.test(e.key)) return;
		gestured = true;
		if (audioWaiting.length) {
			var waiting = audioWaiting;
			audioWaiting = [];
			startAudio().then(function (ctx) { waiting.forEach(function (resolve) { resolve(ctx); }); });
		} else if (audioStarting && audioCtx && audioCtx.state !== 'running' && audioCtx.state !== 'closed') {
			// audio() asked for a running context and the browser is still holding it
			// back: ask again inside this gesture. (A context the toy suspended
			// itself is left alone until the toy calls audio() again.)
			try { audioCtx.resume().then(null, function () {}); } catch (err) { /* stays as it is */ }
		}
	}
	['pointerdown', 'pointerup', 'mousedown', 'touchend', 'keydown', 'click'].forEach(function (type) {
		window.addEventListener(type, onGesture, { capture: true, passive: true });
	});
	// audio() -> Promise of the page's one AudioContext, running. Called before
	// any gesture, it waits for the first one; no context is built until then.
	// Resolves null under ?thumb=1 and where there is no Web Audio.
	function audio() {
		if (thumb || !AudioCtor) return Promise.resolve(null);
		if (audioCtx && audioCtx.state === 'running') return Promise.resolve(audioCtx);
		if (gestureOnRecord()) return startAudio();
		return new Promise(function (resolve) { audioWaiting.push(resolve); });
	}

	// ---- The help dialog ---------------------------------------------------------------------------

	var dialog = null, backdrop = null, opener = null, pressedInside = false;

	function focusables(node) {
		var list = node.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])');
		return Array.prototype.filter.call(list, function (n) { return n.getClientRects().length > 0; });
	}
	function helpSource() {
		if (!cfg.help) return null;
		try { return typeof cfg.help === 'string' ? document.querySelector(cfg.help) : cfg.help; } catch (e) { return null; }
	}
	function openHelp(from) {
		if (thumb) return false;
		if (dialog) return true;
		var source = helpSource();
		if (!source || !document.body) return false;

		backdrop = el('div', 'kit-backdrop');
		dialog = el('div', 'kit-dialog');
		dialog.setAttribute('role', 'dialog');
		dialog.setAttribute('aria-modal', 'true');
		dialog.setAttribute('aria-labelledby', 'kit-dialog-title');
		dialog.tabIndex = -1;
		var head = el('div', 'kit-dialog-head');
		var h2 = el('h2', null, cfg.title || document.title || 'Help');
		h2.id = 'kit-dialog-title';
		var close = el('button', 'kit-btn small kit-dialog-close');
		close.type = 'button';
		close.appendChild(document.createTextNode('Close '));
		close.appendChild(el('kbd', null, 'Esc'));
		close.addEventListener('click', function () { closeHelp(); });
		head.appendChild(h2);
		head.appendChild(close);
		var body = el('div', 'kit-dialog-body');
		if (source.content && source.content.cloneNode) body.appendChild(source.content.cloneNode(true));    // a <template>
		else Array.prototype.forEach.call(source.childNodes, function (n) { body.appendChild(n.cloneNode(true)); });
		dialog.appendChild(head);
		dialog.appendChild(body);
		backdrop.appendChild(dialog);

		// A click on the backdrop closes; a drag that began inside the dialog does not.
		pressedInside = false;
		dialog.addEventListener('pointerdown', function () { pressedInside = true; });
		backdrop.addEventListener('click', function (e) {
			var inside = pressedInside;
			pressedInside = false;
			if (e.target === backdrop && !inside) closeHelp();
		});

		var active = document.activeElement;
		opener = from || (active && active !== document.body && active !== html ? active : ui.help);
		document.body.appendChild(backdrop);
		if (ui.help) ui.help.setAttribute('aria-expanded', 'true');
		close.focus();
		return true;
	}
	function closeHelp() {
		if (!dialog) return false;
		if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
		dialog = backdrop = null;
		if (ui.help) ui.help.setAttribute('aria-expanded', 'false');
		var back = opener && document.contains(opener) ? opener : ui.help;
		opener = null;
		if (back && back.focus) back.focus();
		return true;
	}
	// While the dialog is open the keyboard belongs to it: Escape closes, Tab
	// stays inside, and no key reaches the toy underneath.
	window.addEventListener('keydown', function (e) {
		if (!dialog) return;
		if (e.key === 'Escape' || e.key === 'Esc') {
			e.preventDefault();
			e.stopImmediatePropagation();
			closeHelp();
			return;
		}
		if (e.key === 'Tab') {
			var f = focusables(dialog);
			var active = document.activeElement;
			if (!f.length) { e.preventDefault(); dialog.focus(); }
			else if (!dialog.contains(active)) { e.preventDefault(); f[0].focus(); }
			else if (e.shiftKey && (active === f[0] || active === dialog)) { e.preventDefault(); f[f.length - 1].focus(); }
			else if (!e.shiftKey && active === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
		}
		e.stopImmediatePropagation();
	}, true);

	// ---- The header -------------------------------------------------------------------------------------

	var SUN = '<svg class="kit-i-sun" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="4"/><path d="M12 2.6v2.6M12 18.8v2.6M2.6 12h2.6M18.8 12h2.6M5.35 5.35l1.85 1.85M16.8 16.8l1.85 1.85M5.35 18.65l1.85-1.85M16.8 7.2l1.85-1.85"/></svg>';
	var MOON = '<svg class="kit-i-moon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M20.5 13.2A8.6 8.6 0 1 1 10.8 3.5a6.9 6.9 0 0 0 9.7 9.7z"/></svg>';

	function syncThemeButton() {
		if (!ui.theme) return;
		var label = theme() === 'dark' ? 'Switch to the light theme' : 'Switch to the dark theme';
		ui.theme.setAttribute('aria-label', label);
		ui.theme.title = label;
	}
	function build() {
		var body = document.body;
		var header = ui.header || document.querySelector('header.kit-header');
		if (!header) {
			header = el('header', 'kit-header');
			body.insertBefore(header, body.firstChild);
		}
		if (!ui.header) {
			// What the page put in its own <header class="kit-header"> stays: an
			// <h1> is the title, a .kit-sub the sub line, and anything else ends
			// up in front of the kit's buttons.
			var own = Array.prototype.slice.call(header.children);
			var h1 = null, sub = null;
			own.forEach(function (n) {
				if (!h1 && n.tagName === 'H1') h1 = n;
				else if (!sub && n.classList.contains('kit-sub')) sub = n;
			});
			pageTitle = !!h1;
			pageSub = !!sub;
			ui.header = header;
			ui.h1 = h1 || el('h1');
			ui.h1.classList.add('kit-title');
			ui.sub = sub || el('span', 'kit-sub');
			var spacer = el('span', 'kit-spacer');
			spacer.setAttribute('aria-hidden', 'true');
			ui.tools = el('div', 'kit-tools');
			own.forEach(function (n) { if (n !== h1 && n !== sub) ui.tools.appendChild(n); });
			ui.theme = el('button', 'kit-theme');
			ui.theme.type = 'button';
			ui.theme.innerHTML = MOON + SUN;
			ui.theme.addEventListener('click', function () { setTheme(theme() === 'dark' ? 'light' : 'dark'); });
			ui.back = el('a', 'kit-back');
			ui.tools.appendChild(ui.theme);
			ui.tools.appendChild(ui.back);
			header.appendChild(ui.h1);
			header.appendChild(ui.sub);
			header.appendChild(spacer);
			header.appendChild(ui.tools);
		}

		var title = cfg.title || (pageTitle ? ui.h1.textContent.trim() : '') || document.title || 'Untitled';
		cfg.title = title;
		if (!pageTitle) ui.h1.textContent = title;
		if (!document.title) document.title = title;
		if (!pageSub) {
			ui.sub.textContent = cfg.sub;
			ui.sub.hidden = !cfg.sub;
		}

		var toShelf = cfg.back === 'bookshelf';
		ui.back.href = root + (toShelf ? '#/bookshelf' : '#/misc');
		ui.back.textContent = '';
		var arrow = el('span', null, String.fromCharCode(0x2190) + ' ');      // a left arrow
		arrow.setAttribute('aria-hidden', 'true');
		ui.back.appendChild(arrow);
		ui.back.appendChild(document.createTextNode(toShelf ? 'Bookshelf' : 'Jack V. Le'));
		ui.back.title = toShelf ? 'Back to the bookshelf' : 'Back to the site';

		if (cfg.help && !ui.help) {
			ui.help = el('button', 'kit-help', '?');
			ui.help.type = 'button';
			ui.help.setAttribute('aria-label', 'Help');
			ui.help.setAttribute('aria-haspopup', 'dialog');
			ui.help.setAttribute('aria-expanded', 'false');
			ui.help.title = 'How this works';
			ui.help.addEventListener('click', function () { openHelp(ui.help); });
			ui.tools.insertBefore(ui.help, ui.back);
			if (!helpSource() && window.console && console.warn) console.warn('ToyKit.init: nothing in the page matches help: ' + cfg.help);
		} else if (!cfg.help && ui.help) {
			closeHelp();
			ui.tools.removeChild(ui.help);
			ui.help = null;
		}

		if (cfg.footer) {
			var f = null;
			try { f = typeof cfg.footer === 'string' ? document.querySelector(cfg.footer) : cfg.footer; } catch (e) { f = null; }
			if (f && f.tagName === 'TEMPLATE' && f.content) {
				if (!ui.footer) {
					ui.footer = el('footer', 'kit-footer');
					ui.footer.appendChild(f.content.cloneNode(true));
					body.appendChild(ui.footer);
				}
			} else if (f && f.classList) {
				f.classList.add('kit-footer');
			}
		}

		syncThemeButton();
		if (!thumb) toastNode();       // the live region is in the page before it first speaks
	}

	// init({ id, title, sub, back: 'misc' | 'bookshelf', help: '#help-template' | null, footer: selector | null })
	// Builds the header (and the help button, and the footer class). Calling it
	// again changes what it built; it never builds a second one.
	function init(opts) {
		opts = opts || {};
		if (opts.id != null && cleanId(opts.id)) toyId = cleanId(opts.id);
		if (opts.title != null) cfg.title = String(opts.title);
		if (opts.sub != null) cfg.sub = String(opts.sub);
		if (opts.back === 'misc' || opts.back === 'bookshelf') cfg.back = opts.back;
		if ('help' in opts) cfg.help = opts.help || null;
		if ('footer' in opts) cfg.footer = opts.footer || null;
		html.setAttribute('data-toy', toyId);
		whenBody(build);
		return ToyKit;
	}

	// ---- Ready --------------------------------------------------------------------------------------------

	// Call once the first meaningful frame is drawn. The thumbnail and QA
	// scripts wait for window.__toyReady === true.
	function ready() {
		window.__toyReady = true;
		html.setAttribute('data-toy-ready', '1');
	}

	// The value of a colour token as the page has it right now: token('--accent').
	function token(name) {
		name = String(name || '');
		if (name.slice(0, 2) !== '--') name = '--' + name;
		try { return window.getComputedStyle(document.body || html).getPropertyValue(name).trim(); } catch (e) { return ''; }
	}

	var ToyKit = {
		version: VERSION,
		init: init,
		root: root,
		thumb: thumb,
		params: params,
		onMotion: onMotion,
		theme: theme,
		onTheme: onTheme,
		setTheme: setTheme,
		token: token,
		hash: hash,
		rng: rng,
		daily: function (opts) { return thumb && !(opts && opts.date) ? THUMB_DAY : daily(opts); },
		store: store,
		load: load,
		library: library,
		posts: posts,
		post: post,
		frontMatter: frontMatter,
		markdownToText: markdownToText,
		loadScript: loadScript,
		fail: fail,
		audio: audio,
		help: { open: function () { return openHelp(null); }, close: closeHelp },
		toast: toast,
		download: download,
		ready: ready
	};
	Object.defineProperty(ToyKit, 'reducedMotion', { enumerable: true, get: reduced });
	Object.defineProperty(ToyKit, 'id', { enumerable: true, get: function () { return toyId; } });

	window.ToyKit = ToyKit;
})();
