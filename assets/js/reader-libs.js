// Reader dependencies are local, shared, and loaded only by a reader that needs
// them. Core rendering must await Markdown + sanitization; optional formatting
// always settles without making an otherwise readable article unavailable.
(function (root, factory) {
	'use strict';
	if (typeof module === 'object' && module.exports) module.exports = { createReaderLibs: factory };
	else if (!root.ReaderLibs) root.ReaderLibs = factory(root, root.document);
})(typeof window !== 'undefined' ? window : this, function (win, doc, options) {
	'use strict';
	options = options || {};
	var script = doc.currentScript;
	var rootUrl = options.rootUrl || (script && script.src ? new URL('../../', script.src).href : new URL('./', win.location.href).href);
	var vendor = new URL('desk/vendor/', rootUrl).href;
	var timeoutMs = options.timeoutMs || 12000;
	var assets = Object.create(null);
	var corePromise = null;
	var dark = doc.documentElement.getAttribute('data-theme') === 'dark';
	var highlightLinks = Object.create(null), highlightReady = Object.create(null);

	function errorFor(key) {
		var error = new Error('Reader resource could not be loaded: ' + key);
		error.readerResource = key;
		return error;
	}

	function resource(key, path, available, stylesheet) {
		if (!stylesheet && available()) return Promise.resolve(available());
		if (assets[key]) return assets[key].promise;
		var entry = { node: doc.createElement(stylesheet ? 'link' : 'script'), promise: null };
		assets[key] = entry;
		entry.promise = new Promise(function (resolve, reject) {
			var node = entry.node, settled = false;
			function finish(error) {
				if (settled) return;
				settled = true;
				win.clearTimeout(timer);
				node.onload = node.onerror = null;
				if (error) {
					if (assets[key] === entry) delete assets[key];
					if (node.parentNode) node.parentNode.removeChild(node);
					reject(error);
				} else resolve(stylesheet ? node : available());
			}
			var timer = win.setTimeout(function () { finish(errorFor(key)); }, timeoutMs);
			node.setAttribute('data-reader-resource', key);
			node.onload = function () { finish(!stylesheet && !available() ? errorFor(key) : null); };
			node.onerror = function () { finish(errorFor(key)); };
			if (stylesheet) {
				node.rel = 'stylesheet';
				node.href = new URL(path, vendor).href;
				if (key.indexOf('highlight-style-') === 0) node.media = 'not all';
			} else {
				node.async = true;
				node.src = new URL(path, vendor).href;
			}
			try { doc.head.appendChild(node); } catch (error) { finish(errorFor(key)); }
		});
		return entry.promise;
	}

	function ensureCore() {
		if (!corePromise) {
			corePromise = Promise.all([
				resource('marked', 'marked/marked.min.js', function () { return win.marked && typeof win.marked.parse === 'function' ? win.marked : null; }),
				resource('sanitize', 'dompurify/purify.min.js', function () { return win.DOMPurify && typeof win.DOMPurify.sanitize === 'function' ? win.DOMPurify : null; })
			]).then(function (libraries) {
				if (libraries[0].setOptions) libraries[0].setOptions({ gfm: true, breaks: false });
				return { marked: libraries[0], DOMPurify: libraries[1] };
			}).catch(function (error) { corePromise = null; throw error; });
		}
		return corePromise;
	}

	function activateHighlightStyle() {
		var wanted = dark ? 'dark' : 'light';
		if (!highlightReady[wanted]) return;
		Object.keys(highlightLinks).forEach(function (theme) {
			var link = highlightLinks[theme];
			link.media = theme === wanted ? 'all' : 'not all';
			link.id = theme === wanted ? 'hljs-theme' : 'reader-highlight-' + theme;
		});
	}

	function highlightStyle() {
		var theme = dark ? 'dark' : 'light';
		return resource('highlight-style-' + theme, 'highlight/github' + (dark ? '-dark' : '') + '.min.css', null, true).then(function (link) {
			highlightLinks[theme] = link; highlightReady[theme] = true;
			activateHighlightStyle();
			return link;
		});
	}

	function setTheme(isDark) {
		dark = !!isDark;
		// Setting the site's theme must never start a reader request on About.
		// The active reader asks enhance() for a missing theme when necessary.
		activateHighlightStyle();
	}

	function ensureHighlight() {
		return Promise.all([
			resource('highlight', 'highlight/highlight.min.js', function () { return win.hljs && typeof win.hljs.highlightElement === 'function' ? win.hljs : null; }),
			highlightStyle()
		]).then(function (values) { return values[0]; });
	}

	function ensureMath() {
		var math = resource('katex', 'katex/katex.min.js', function () { return win.katex && typeof win.katex.render === 'function' ? win.katex : null; }).then(function () {
			return resource('math-render', 'katex/auto-render.min.js', function () { return typeof win.renderMathInElement === 'function' ? win.renderMathInElement : null; });
		});
		return Promise.all([math, resource('math-style', 'katex/katex.min.css', null, true)]).then(function (values) { return values[0]; });
	}

	function needsMath(container) {
		var walker = doc.createTreeWalker(container, 4), current, parts = [];
		while ((current = walker.nextNode())) {
			var parent = current.parentElement;
			if (parent && !parent.closest('pre, code, script, style, textarea, option, .katex')) parts.push(current.nodeValue);
		}
		return /\$\$[\s\S]+?\$\$|\\\([\s\S]+?\\\)|\\\[[\s\S]+?\\\]|(^|[^\\])\$(?!\$)[^$]+?\$/.test(parts.join('\n'));
	}

	function enhance(container, opts) {
		opts = opts || {};
		function active() { return !!container && container.isConnected && (!opts.active || opts.active()); }
		if (!active()) return Promise.resolve({ highlight: 'unused', math: 'unused' });
		var code = container.querySelectorAll('pre code');
		var math = needsMath(container);
		var highlighting = code.length ? ensureHighlight().then(function (library) {
			if (active()) Array.prototype.forEach.call(code, function (node) {
				if (node.getAttribute('data-highlighted') !== 'yes') library.highlightElement(node);
			});
			return 'ready';
		}).catch(function () { return 'failed'; }) : Promise.resolve('unused');
		var typesetting = math ? ensureMath().then(function (render) {
			if (active() && needsMath(container)) render(container, { delimiters: [
				{ left: '$$', right: '$$', display: true }, { left: '$', right: '$', display: false },
				{ left: '\\(', right: '\\)', display: false }, { left: '\\[', right: '\\]', display: true }
			], throwOnError: false });
			return 'ready';
		}).catch(function () { return 'failed'; }) : Promise.resolve('unused');
		return Promise.all([highlighting, typesetting]).then(function (results) { return { highlight: results[0], math: results[1] }; });
	}

	return { ensureCore: ensureCore, ensureHighlight: ensureHighlight, ensureMath: ensureMath, enhance: enhance, setTheme: setTheme };
});
