// Desk UI: the shared widgets, and the theme.
//
// This file is loaded in <head>, before anything is painted, so that the page
// opens in the right theme (the site's own key: localStorage "theme", light or
// dark; without one, the system preference).
//
// Nothing here ever sets innerHTML from outside text. el() builds DOM from
// text nodes; the two places that take HTML (renderMarkdown, safeHTML) pass it
// through DOMPurify first, and rendered Markdown is shown in a frame that
// cannot run scripts.
//
// window.DeskUI is the toolbox; DeskUI.create({ issueTicket, siteRoot }) makes
// the object the views receive as api.ui (see desk/README.md).

(function () {
	'use strict';

	var doc = document;
	var root = doc.documentElement;

	// ---- theme ------------------------------------------------------------------

	var themeListeners = [];

	function storedTheme() {
		var t = null;
		try {
			t = localStorage.getItem('theme');
		} catch (e) {
			/* storage blocked: follow the system */
		}
		return t === 'light' || t === 'dark' ? t : null;
	}

	function systemTheme() {
		return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
	}

	function applyTheme() {
		var t = storedTheme() || systemTheme();
		var changed = root.getAttribute('data-theme') !== t;
		root.setAttribute('data-theme', t);
		if (changed) {
			themeListeners.slice().forEach(function (fn) {
				try {
					fn(t);
				} catch (e) {
					/* a listener's problem */
				}
			});
		}
		return t;
	}

	applyTheme();
	window.addEventListener('storage', function (e) {
		if (e.key === 'theme' || e.key === null) applyTheme();
	});
	if (window.matchMedia) {
		var mq = window.matchMedia('(prefers-color-scheme: dark)');
		if (mq.addEventListener) mq.addEventListener('change', applyTheme);
	}

	var theme = {
		get: function () {
			return root.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
		},
		set: function (t) {
			try {
				localStorage.setItem('theme', t === 'dark' ? 'dark' : 'light');
			} catch (e) {
				/* storage blocked: the change lasts until reload */
				root.setAttribute('data-theme', t === 'dark' ? 'dark' : 'light');
			}
			applyTheme();
		},
		toggle: function () {
			theme.set(theme.get() === 'dark' ? 'light' : 'dark');
		},
		onChange: function (fn) {
			themeListeners.push(fn);
			return function () {
				var i = themeListeners.indexOf(fn);
				if (i !== -1) themeListeners.splice(i, 1);
			};
		},
	};

	function reducedMotion() {
		return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
	}

	// ---- DOM ----------------------------------------------------------------------

	// el('button', { class: 'btn', type: 'button', on: { click: fn }, text: 'Save' }, [child, 'text'])
	// Strings become text nodes. There is no way to pass HTML.
	function el(tag, props, children) {
		var node = doc.createElement(tag);
		if (props) {
			Object.keys(props).forEach(function (k) {
				var v = props[k];
				if (v === undefined || v === null || v === false) return;
				if (k === 'class') node.className = v;
				else if (k === 'text') node.textContent = v;
				else if (k === 'on') {
					Object.keys(v).forEach(function (name) {
						node.addEventListener(name, v[name]);
					});
				} else if (k === 'data') {
					Object.keys(v).forEach(function (name) {
						node.dataset[name] = v[name];
					});
				} else if (k === 'style') {
					Object.keys(v).forEach(function (name) {
						node.style.setProperty(name, v[name]);
					});
				} else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'hidden' || k === 'selected' || k === 'readOnly') node[k] = v;
				else node.setAttribute(k, v === true ? '' : String(v));
			});
		}
		append(node, children);
		return node;
	}

	function append(node, children) {
		if (children === undefined || children === null || children === false) return node;
		if (Array.isArray(children)) {
			children.forEach(function (c) {
				append(node, c);
			});
		} else if (children instanceof Node) node.appendChild(children);
		else node.appendChild(doc.createTextNode(String(children)));
		return node;
	}

	function clear(node) {
		while (node && node.firstChild) node.removeChild(node.firstChild);
		return node;
	}

	// ---- icons --------------------------------------------------------------------
	// Line icons on a 24 by 24 grid, drawn for this page. A view may name one of
	// these, or pass its own path data (a string that starts with "M").

	var ICONS = {
		home: 'M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10',
		write: 'M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4',
		notes: 'M6 3h9l4 4v14H6zM14 3v5h5M9 12h7M9 16h7',
		reading: 'M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM4 19V5M9 8h6',
		todos: 'M4 4h16v16H4zM8 12l3 3 5-6',
		stats: 'M5 20V10M11 20V4M17 20v-7M2 20h20',
		health: 'M2 12h4l3-8 4 16 3-8h6',
		lock: 'M6 11h12v9H6zM8 11V8a4 4 0 0 1 8 0v3',
		unlock: 'M6 11h12v9H6zM8 11V8a4 4 0 0 1 7.5-2',
		key: 'M4 12a3.5 3.5 0 1 0 7 0 3.5 3.5 0 0 0-7 0zM11 12h10M17 12v3M20.5 12v3',
		settings: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1',
		saved: 'M5 12l5 5 9-10',
		unsaved: 'M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10z',
		syncing: 'M4 12a8 8 0 0 1 14-5l2 2M20 4v5h-5M20 12a8 8 0 0 1-14 5l-2-2M4 20v-5h5',
		offline: 'M3 3l18 18M5 12.5a10 10 0 0 1 3-2M12 8a10 10 0 0 1 7 4.5M8.5 16a5 5 0 0 1 7 0M12 19.5h.01',
		plus: 'M12 5v14M5 12h14',
		back: 'M15 5l-7 7 7 7',
		close: 'M6 6l12 12M18 6L6 18',
		external: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6',
		trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6',
		warning: 'M12 3l10 18H2zM12 10v5M12 18h.01',
		info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v6M12 7.5h.01',
		check: 'M5 12l5 5 9-10',
		cross: 'M6 6l12 12M18 6L6 18',
		eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
		image: 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M9 9h.01',
		sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5',
		moon: 'M20 14A8 8 0 0 1 10 4a8 8 0 1 0 10 10z',
		search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM16 16l5 5',
		refresh: 'M4 12a8 8 0 0 1 14-5l2 2M20 4v5h-5M20 12a8 8 0 0 1-14 5',
		comment: 'M4 5h16v11H9l-5 4z',
		globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18',
		dot: 'M12 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4z',
	};

	var SVG_NS = 'http://www.w3.org/2000/svg';

	function icon(name, size) {
		var d = ICONS[name] || (typeof name === 'string' && /^[Mm][\d\s.,\-a-zA-Z]+$/.test(name) ? name : ICONS.dot);
		var svg = doc.createElementNS(SVG_NS, 'svg');
		svg.setAttribute('viewBox', '0 0 24 24');
		svg.setAttribute('width', String(size || 20));
		svg.setAttribute('height', String(size || 20));
		svg.setAttribute('fill', 'none');
		svg.setAttribute('stroke', 'currentColor');
		svg.setAttribute('stroke-width', '1.8');
		svg.setAttribute('stroke-linecap', 'round');
		svg.setAttribute('stroke-linejoin', 'round');
		svg.setAttribute('aria-hidden', 'true');
		svg.setAttribute('focusable', 'false');
		svg.setAttribute('class', 'ico');
		var path = doc.createElementNS(SVG_NS, 'path');
		path.setAttribute('d', d);
		svg.appendChild(path);
		return svg;
	}

	// button('Save', { kind: 'primary' | 'danger' | 'quiet', icon: 'check', onClick: fn, type: 'submit' })
	function button(label, opts) {
		opts = opts || {};
		var b = el('button', {
			type: opts.type || 'button',
			class: 'btn' + (opts.kind ? ' btn-' + opts.kind : '') + (opts.class ? ' ' + opts.class : ''),
			id: opts.id,
			title: opts.title,
			'aria-label': opts.label,
			disabled: opts.disabled,
		});
		if (opts.icon) b.appendChild(icon(opts.icon, opts.iconSize || 18));
		if (label) b.appendChild(el('span', { text: label }));
		if (opts.onClick) b.addEventListener('click', opts.onClick);
		return b;
	}

	// A labelled control: field('Title', inputElement, 'A hint under it')
	var fieldCount = 0;
	function field(label, control, hint) {
		var id = control.id || 'f' + ++fieldCount;
		control.id = id;
		var wrap = el('div', { class: 'field' }, [el('label', { for: id, text: label }), control]);
		if (hint) {
			var hintEl = el('div', { class: 'field-hint', id: id + '-hint' }, hint);
			control.setAttribute('aria-describedby', id + '-hint');
			wrap.appendChild(hintEl);
		}
		return wrap;
	}

	// ---- toast --------------------------------------------------------------------

	function toastHost() {
		var host = doc.getElementById('desk-toasts');
		if (!host) {
			host = el('div', { id: 'desk-toasts', class: 'toasts', role: 'status', 'aria-live': 'polite' });
			doc.body.appendChild(host);
		}
		return host;
	}

	// toast('Saved') ; toast('Could not save', { kind: 'bad' }) ; kinds: ok, warn, bad
	function toast(text, opts) {
		opts = opts || {};
		var kind = opts.kind || 'ok';
		var node = el('div', { class: 'toast toast-' + kind }, [icon(kind === 'ok' ? 'check' : kind === 'warn' ? 'info' : 'warning', 18), el('span', { text: String(text) })]);
		var gone = false;
		function dismiss() {
			if (gone) return;
			gone = true;
			if (node.parentNode) node.parentNode.removeChild(node);
		}
		node.addEventListener('click', dismiss);
		toastHost().appendChild(node);
		setTimeout(dismiss, opts.ms || (kind === 'ok' ? 4000 : 9000));
		return dismiss;
	}

	// ---- dialogs ------------------------------------------------------------------

	// Opens a modal dialog. build(dialog, close) fills it; close(value) ends it.
	// -> Promise of the value (undefined when dismissed with Escape).
	function dialog(build, opts) {
		opts = opts || {};
		return new Promise(function (resolve) {
			var dlg = el('dialog', { class: 'dialog' + (opts.wide ? ' dialog-wide' : ''), 'aria-labelledby': 'dlg-title' });
			var done = false;
			function close(value) {
				if (done) return;
				done = true;
				try {
					dlg.close();
				} catch (e) {
					/* already closed */
				}
				if (dlg.parentNode) dlg.parentNode.removeChild(dlg);
				resolve(value);
			}
			dlg.addEventListener('cancel', function (e) {
				e.preventDefault();
				if (opts.locked) return;
				close(undefined);
			});
			dlg.addEventListener('close', function () {
				close(undefined);
			});
			build(dlg, close);
			doc.body.appendChild(dlg);
			if (dlg.showModal) dlg.showModal();
			else dlg.setAttribute('open', '');
			var first = dlg.querySelector('[data-autofocus]');
			if (first) first.focus();
		});
	}

	function closeAllDialogs() {
		Array.prototype.slice.call(doc.querySelectorAll('dialog.dialog')).forEach(function (d) {
			try {
				d.close();
			} catch (e) {
				/* not open */
			}
			if (d.parentNode) d.parentNode.removeChild(d);
		});
		// Nothing said while the Desk was open stays on screen once it is locked.
		var host = doc.getElementById('desk-toasts');
		if (host) clear(host);
	}

	function bodyNodes(body) {
		if (body instanceof Node) return body;
		if (Array.isArray(body)) {
			return body.map(function (b) {
				return b instanceof Node ? b : el('p', { text: String(b) });
			});
		}
		return body ? el('p', { text: String(body) }) : null;
	}

	// confirm({ title, body, action: 'Delete', cancel: 'Cancel', danger: true }) -> Promise<boolean>
	function confirm(opts) {
		opts = opts || {};
		return dialog(function (dlg, close) {
			var cancel = button(opts.cancel || 'Cancel', {
				onClick: function () {
					close(false);
				},
			});
			var ok = button(opts.action || 'OK', {
				kind: opts.danger ? 'danger' : 'primary',
				onClick: function () {
					close(true);
				},
			});
			(opts.danger ? cancel : ok).setAttribute('data-autofocus', '');
			ok.setAttribute('data-role', 'confirm');
			cancel.setAttribute('data-role', 'cancel');
			append(dlg, [el('h2', { id: 'dlg-title', text: opts.title || 'Are you sure?' }), el('div', { class: 'dialog-body' }, bodyNodes(opts.body)), el('div', { class: 'dialog-actions' }, [cancel, ok])]);
		}).then(function (v) {
			return v === true;
		});
	}

	// ---- busy ---------------------------------------------------------------------

	// Marks a button (or any element) as working until the promise settles.
	// Returns the same promise.
	function busy(node, promise) {
		if (!node) return promise;
		var was = node.disabled;
		node.setAttribute('aria-busy', 'true');
		node.classList.add('is-busy');
		if ('disabled' in node) node.disabled = true;
		function done() {
			node.removeAttribute('aria-busy');
			node.classList.remove('is-busy');
			if ('disabled' in node) node.disabled = was;
		}
		Promise.resolve(promise).then(done, done);
		return promise;
	}

	// ---- dates --------------------------------------------------------------------

	function pad(n) {
		return (n < 10 ? '0' : '') + n;
	}

	function toDate(value) {
		if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
		if (value === undefined || value === null || value === '') return null;
		if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
			var p = value.split('-');
			return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
		}
		var d = new Date(value);
		return isNaN(d.getTime()) ? null : d;
	}

	var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

	var date = {
		// today's date here, as the blog's file names want it: 2026-10-05
		iso: function (d) {
			var x = toDate(d) || new Date();
			return x.getFullYear() + '-' + pad(x.getMonth() + 1) + '-' + pad(x.getDate());
		},
		// a sortable UTC stamp for file names: 20261005T140322Z
		stamp: function (d) {
			var x = toDate(d) || new Date();
			return x.getUTCFullYear() + pad(x.getUTCMonth() + 1) + pad(x.getUTCDate()) + 'T' + pad(x.getUTCHours()) + pad(x.getUTCMinutes()) + pad(x.getUTCSeconds()) + 'Z';
		},
		// 2026-10-05T14:03:22Z
		utc: function (d) {
			var x = toDate(d) || new Date();
			return x.toISOString().replace(/\.\d{3}Z$/, 'Z');
		},
		// "October 5, 2026": a YYYY-MM-DD string is read as that calendar day, as the blog does
		long: function (value) {
			var x = toDate(value);
			if (!x) return String(value || '');
			if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return MONTHS[x.getUTCMonth()] + ' ' + x.getUTCDate() + ', ' + x.getUTCFullYear();
			return MONTHS[x.getMonth()] + ' ' + x.getDate() + ', ' + x.getFullYear();
		},
		// "Oct 5", or "Oct 5, 2025" for another year
		short: function (value) {
			var x = toDate(value);
			if (!x) return String(value || '');
			var isDay = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
			var m = MONTHS[isDay ? x.getUTCMonth() : x.getMonth()].slice(0, 3);
			var day = isDay ? x.getUTCDate() : x.getDate();
			var year = isDay ? x.getUTCFullYear() : x.getFullYear();
			return m + ' ' + day + (year !== new Date().getFullYear() ? ', ' + year : '');
		},
		// "14:03"
		time: function (value) {
			var x = toDate(value);
			return x ? pad(x.getHours()) + ':' + pad(x.getMinutes()) : '';
		},
		// "just now", "5 min ago", "3 h ago", "yesterday", "12 days ago", then a short date
		ago: function (value) {
			var x = toDate(value);
			if (!x) return '';
			var s = Math.round((Date.now() - x.getTime()) / 1000);
			if (s < 0) return date.short(x) + ' ' + date.time(x);
			if (s < 45) return 'just now';
			if (s < 3600) return Math.max(1, Math.round(s / 60)) + ' min ago';
			if (s < 86400) return Math.round(s / 3600) + ' h ago';
			if (s < 2 * 86400) return 'yesterday';
			if (s < 30 * 86400) return Math.round(s / 86400) + ' days ago';
			return date.short(x);
		},
		parse: toDate,
	};

	// ---- posts: front matter, the way assets/js/blog.js reads it -----------------

	// -> { fm: { title, date, summary, tags: [...] , ... }, body }
	function parsePost(text) {
		var fm = {};
		var body = String(text == null ? '' : text);
		var m = /^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?/.exec(body);
		if (m) {
			body = body.slice(m[0].length);
			m[1].split(/\r?\n/).forEach(function (line) {
				var idx = line.indexOf(':');
				if (idx === -1) return;
				var key = line.slice(0, idx).trim();
				var val = line.slice(idx + 1).trim();
				if (val.charAt(0) === '[' && val.charAt(val.length - 1) === ']') {
					fm[key] = val
						.slice(1, -1)
						.split(',')
						.map(function (s) {
							return s.trim().replace(/^["']|["']$/g, '');
						})
						.filter(Boolean);
				} else {
					fm[key] = val.replace(/^["']|["']$/g, '');
				}
			});
		}
		return { fm: fm, body: body };
	}

	// The inverse: buildPost({ title: 'T', tags: ['a', 'b'] }, 'Body') -> the file's text.
	// Values are written on one line each; a list becomes [a, b].
	function buildPost(fm, body) {
		var lines = [];
		Object.keys(fm || {}).forEach(function (key) {
			var v = fm[key];
			if (v === undefined || v === null) return;
			if (Array.isArray(v)) {
				lines.push(
					key +
						': [' +
						v
							.map(function (s) {
								return String(s).replace(/[\[\],\r\n]/g, ' ').trim();
							})
							.filter(Boolean)
							.join(', ') +
						']'
				);
			} else lines.push(key + ': ' + String(v).replace(/\r?\n/g, ' ').trim());
		});
		var text = String(body == null ? '' : body).replace(/^\s*\n/, '');
		return '---\n' + lines.join('\n') + '\n---\n\n' + text + (text && !/\n$/.test(text) ? '\n' : '');
	}

	// ---- the libraries (loaded on first use, from desk/vendor/) -----------------

	var here = (function () {
		var s = doc.currentScript;
		return s && s.src ? s.src.replace(/[^/]*$/, '') : new URL('./', location.href).href;
	})();
	var VENDOR = here + 'vendor/';
	var vendorPromise = null;

	function loadScript(src) {
		return new Promise(function (resolve, reject) {
			var s = doc.createElement('script');
			s.src = src;
			s.onload = function () {
				resolve();
			};
			s.onerror = function () {
				reject(new Error('Could not load ' + src.replace(here, 'desk/') + '. Check the connection and reload.'));
			};
			doc.head.appendChild(s);
		});
	}

	// marked, DOMPurify, highlight.js, KaTeX and its auto-render: the versions
	// the blog itself uses, served from this site.
	function loadVendor() {
		if (!vendorPromise) {
			vendorPromise = loadScript(VENDOR + 'marked/marked.min.js')
				.then(function () {
					return loadScript(VENDOR + 'dompurify/purify.min.js');
				})
				.then(function () {
					return loadScript(VENDOR + 'highlight/highlight.min.js');
				})
				.then(function () {
					return loadScript(VENDOR + 'katex/katex.min.js');
				})
				.then(function () {
					return loadScript(VENDOR + 'katex/auto-render.min.js');
				})
				.then(function () {
					// Exactly what blog.js sets.
					if (window.marked && window.marked.setOptions) window.marked.setOptions({ gfm: true, breaks: false });
				})
				.catch(function (err) {
					vendorPromise = null;
					throw err;
				});
		}
		return vendorPromise;
	}

	// Sets el's content to sanitised HTML. For HTML that came from outside
	// (a comment's bodyHTML, say). -> Promise
	function safeHTML(node, html) {
		return loadVendor().then(function () {
			node.innerHTML = window.DOMPurify.sanitize(String(html == null ? '' : html));
			return node;
		});
	}

	// ---- Markdown, rendered as the site renders a post ---------------------------

	var KATEX_DELIMITERS = [
		{ left: '$$', right: '$$', display: true },
		{ left: '$', right: '$', display: false },
		{ left: '\\(', right: '\\)', display: false },
		{ left: '\\[', right: '\\]', display: true },
	];

	// The same two steps as decorate() in assets/js/blog.js.
	function decorate(container) {
		if (window.hljs) {
			Array.prototype.forEach.call(container.querySelectorAll('pre code'), function (node) {
				try {
					window.hljs.highlightElement(node);
				} catch (e) {
					/* ignore */
				}
			});
		}
		if (window.renderMathInElement) {
			try {
				window.renderMathInElement(container, { delimiters: KATEX_DELIMITERS, throwOnError: false });
			} catch (e) {
				/* ignore */
			}
		}
	}

	function makeRenderer(siteRoot) {
		var frames = typeof WeakMap !== 'undefined' ? new WeakMap() : null;

		function styles(fdoc, t) {
			var hl = fdoc.getElementById('hljs-theme');
			var want = VENDOR + 'highlight/' + (t === 'dark' ? 'github-dark.min.css' : 'github.min.css');
			if (hl && hl.getAttribute('href') !== want) hl.setAttribute('href', want);
			fdoc.documentElement.setAttribute('data-theme', t);
			fdoc.documentElement.setAttribute('data-bs-theme', t);
		}

		function waitForSheets(fdoc) {
			var links = Array.prototype.slice.call(fdoc.querySelectorAll('link[rel="stylesheet"]'));
			return Promise.all(
				links.map(function (link) {
					if (link.sheet) return null;
					return new Promise(function (resolve) {
						link.addEventListener('load', resolve);
						link.addEventListener('error', resolve);
						setTimeout(resolve, 4000);
					});
				})
			);
		}

		// One frame per host element, kept and refilled on later calls.
		function frameFor(host, t) {
			var known = frames && frames.get(host);
			if (known && known.frame.isConnected && known.frame.contentDocument) return known.ready;
			var frame = doc.createElement('iframe');
			frame.className = 'preview-frame';
			frame.title = 'Preview';
			// No allow-scripts: nothing inside this frame can run, whatever the
			// Markdown contains. allow-same-origin lets this page fill and measure it.
			frame.setAttribute('sandbox', 'allow-same-origin');
			var ready = new Promise(function (resolve, reject) {
				var url = URL.createObjectURL(new Blob(['<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body></body></html>'], { type: 'text/html' }));
				frame.addEventListener('load', function onLoad() {
					frame.removeEventListener('load', onLoad);
					URL.revokeObjectURL(url);
					var fdoc = frame.contentDocument;
					if (!fdoc) {
						reject(new Error('The preview frame could not be opened.'));
						return;
					}
					var head = fdoc.head;
					[VENDOR + 'fonts/fonts.css', VENDOR + 'bootstrap/bootstrap.min.css', siteRoot + 'assets/css/main.css'].forEach(function (href) {
						var link = fdoc.createElement('link');
						link.rel = 'stylesheet';
						link.href = href;
						head.appendChild(link);
					});
					var hl = fdoc.createElement('link');
					hl.rel = 'stylesheet';
					hl.id = 'hljs-theme';
					hl.href = VENDOR + 'highlight/' + (t === 'dark' ? 'github-dark.min.css' : 'github.min.css');
					head.appendChild(hl);
					var kx = fdoc.createElement('link');
					kx.rel = 'stylesheet';
					kx.href = VENDOR + 'katex/katex.min.css';
					head.appendChild(kx);
					var own = fdoc.createElement('style');
					own.textContent = 'html{scroll-behavior:auto}body{margin:0;padding:14px 16px 20px;overflow-x:hidden;transition:none}#blogPostView{max-width:46rem;margin:0 auto}';
					head.appendChild(own);
					styles(fdoc, t);
					var view = fdoc.createElement('div');
					view.id = 'blogPostView';
					fdoc.body.appendChild(view);
					// Links open in a new tab, from this page: the frame itself may not navigate or open windows.
					fdoc.addEventListener('click', function (e) {
						var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
						if (!a) return;
						e.preventDefault();
						var href = a.getAttribute('href') || '';
						if (href.charAt(0) === '#') {
							var target = fdoc.getElementById(decodeURIComponent(href.slice(1)));
							if (target) target.scrollIntoView();
							return;
						}
						if (/^https?:/i.test(a.href)) window.open(a.href, '_blank', 'noopener,noreferrer');
					});
					var fit = function () {
						var hgt = Math.ceil(fdoc.documentElement.scrollHeight);
						if (hgt && frame.style.height !== hgt + 'px') frame.style.height = hgt + 'px';
					};
					if (window.ResizeObserver) new ResizeObserver(fit).observe(fdoc.body);
					waitForSheets(fdoc).then(function () {
						resolve({ frame: frame, doc: fdoc, view: view, fit: fit });
					});
				});
				frame.src = url;
			});
			if (frames) frames.set(host, { frame: frame, ready: ready });
			clear(host);
			host.appendChild(frame);
			return ready;
		}

		// A post is rendered inside the site's index.html, so its relative links
		// and images are relative to the site root.
		function absolutise(container, resolveUrl) {
			Array.prototype.forEach.call(container.querySelectorAll('[src], [href]'), function (node) {
				['src', 'href'].forEach(function (attr) {
					var v = node.getAttribute(attr);
					if (!v || v.charAt(0) === '#' || /^(data|blob|mailto|tel):/i.test(v)) return;
					var next = null;
					if (resolveUrl) {
						try {
							next = resolveUrl(v, attr === 'src' ? 'src' : 'href', node);
						} catch (e) {
							next = null;
						}
					}
					if (!next) {
						try {
							next = new URL(v, siteRoot).href;
						} catch (e) {
							next = v;
						}
					}
					node.setAttribute(attr, next);
				});
			});
		}

		// renderMarkdown(el, markdown, opts) -> Promise<{ frame, body, title, date }>
		//   opts.theme       'light' | 'dark' (default: the Desk's current theme)
		//   opts.post        true: `markdown` is a whole post file; its front matter is
		//                    read and the title and date are shown as on the site
		//   opts.title, opts.date   show this heading and date above the body
		//   opts.resolveUrl  function (url, 'src' | 'href', node) -> url or null, for
		//                    images that are not on the site yet (return a blob: URL)
		return function renderMarkdown(host, markdown, opts) {
			opts = opts || {};
			var t = opts.theme === 'light' || opts.theme === 'dark' ? opts.theme : theme.get();
			return loadVendor()
				.then(function () {
					return frameFor(host, t);
				})
				.then(function (f) {
					var fdoc = f.doc;
					styles(fdoc, t);
					var parsed = opts.post ? parsePost(markdown) : { fm: {}, body: String(markdown == null ? '' : markdown) };
					var title = opts.title !== undefined ? opts.title : opts.post ? parsed.fm.title || '' : '';
					var when = opts.date !== undefined ? opts.date : opts.post ? parsed.fm.date || '' : '';
					var rawHtml = window.marked.parse(parsed.body);
					var clean = window.DOMPurify.sanitize(rawHtml);
					clear(f.view);
					if (title) {
						var h1 = fdoc.createElement('h1');
						h1.className = 'blog-post-title';
						h1.textContent = title;
						f.view.appendChild(h1);
					}
					if (title || when) {
						var meta = fdoc.createElement('div');
						meta.className = 'blog-post-meta blog-info mb-4';
						if (when) {
							var span = fdoc.createElement('span');
							span.textContent = date.long(when);
							meta.appendChild(span);
						}
						f.view.appendChild(meta);
					}
					var body = fdoc.createElement('div');
					body.className = 'blog-post-body';
					body.innerHTML = clean;
					f.view.appendChild(body);
					absolutise(body, opts.resolveUrl);
					decorate(body);
					f.fit();
					return { frame: f.frame, body: body, title: title, date: when, fm: parsed.fm };
				});
		};
	}

	// ---- list / detail ------------------------------------------------------------

	// Two panes side by side on a wide screen; one at a time on a phone, with a
	// Back button over the detail.
	//   var ld = ui.listDetail(el, { label: 'Notes', onClose: fn });
	//   ld.list     put the list here
	//   ld.detail   put the open item here
	//   ld.open()   show the detail pane (on a phone the list gives way)
	//   ld.close()  back to the list
	function listDetail(host, opts) {
		opts = opts || {};
		var list = el('div', { class: 'ld-list', role: 'region', 'aria-label': opts.label || 'List' });
		var detail = el('div', { class: 'ld-body' });
		var back = button(opts.backLabel || 'Back to the list', {
			icon: 'back',
			kind: 'quiet',
			class: 'ld-back',
			onClick: function () {
				api.close();
			},
		});
		var pane = el('div', { class: 'ld-detail', role: 'region', 'aria-label': opts.detailLabel || 'Selected item', tabindex: '-1' }, [el('div', { class: 'ld-bar' }, back), detail]);
		var wrap = el('div', { class: 'ld', data: { pane: 'list' } }, [list, pane]);
		var api = {
			el: wrap,
			list: list,
			detail: detail,
			isOpen: function () {
				return wrap.dataset.pane === 'detail';
			},
			isNarrow: function () {
				return window.matchMedia ? window.matchMedia('(max-width: 759px)').matches : window.innerWidth < 760;
			},
			open: function () {
				wrap.dataset.pane = 'detail';
				if (api.isNarrow()) pane.focus({ preventScroll: true });
			},
			close: function () {
				wrap.dataset.pane = 'list';
				if (opts.onClose) opts.onClose();
			},
		};
		host.appendChild(wrap);
		return api;
	}

	// A row for such a list: row({ title, meta, badge, current, onClick }) -> <button>
	function row(opts) {
		var b = el('button', { type: 'button', class: 'row' + (opts.current ? ' is-current' : ''), 'aria-current': opts.current ? 'true' : undefined }, [
			el('span', { class: 'row-main' }, [el('span', { class: 'row-title', text: opts.title || '' }), opts.meta ? el('span', { class: 'row-meta', text: opts.meta }) : null]),
			opts.badge ? el('span', { class: 'badge' + (opts.badgeKind ? ' badge-' + opts.badgeKind : ''), text: opts.badge }) : null,
		]);
		if (opts.onClick) b.addEventListener('click', opts.onClick);
		return b;
	}

	// A plain-words box for something that went wrong, with an optional retry.
	function errorBox(err, retry) {
		var message = err && err.message ? err.message : String(err || 'Something went wrong.');
		var box = el('div', { class: 'notice notice-bad', role: 'alert' }, [icon('warning', 18), el('div', {}, [el('p', { text: message })])]);
		if (retry) box.lastChild.appendChild(button('Try again', { kind: 'quiet', onClick: retry }));
		return box;
	}

	function notice(text, kind) {
		return el('div', { class: 'notice notice-' + (kind || 'info') }, [icon(kind === 'bad' || kind === 'warn' ? 'warning' : kind === 'ok' ? 'check' : 'info', 18), el('div', {}, text instanceof Node || Array.isArray(text) ? text : el('p', { text: String(text) }))]);
	}

	// ---- the object views get as api.ui ----------------------------------------

	function create(config) {
		var siteRoot = config.siteRoot;
		var issueTicket = config.issueTicket;
		var siteUrl = config.siteUrl || siteRoot;

		// The one way to get a ticket for a write to the public site.
		//   confirmPublish({ title, paths, summary, previewNode, action }) -> Promise<ticket | null>
		//   paths: ['blog/posts/2026-10-05-x.md', { path: 'assets/img/blog/a.png', note: 'new image' }]
		function confirmPublish(opts) {
			opts = opts || {};
			var paths = (opts.paths || []).map(function (p) {
				return typeof p === 'string' ? { path: p } : p;
			});
			if (!paths.length) return Promise.reject(new Error('confirmPublish needs the paths that will change.'));
			return dialog(
				function (dlg, close) {
					var cancel = button('Cancel', {
						onClick: function () {
							close(null);
						},
					});
					cancel.setAttribute('data-autofocus', '');
					cancel.setAttribute('data-role', 'cancel');
					var go = button(opts.action || 'Publish', {
						kind: 'primary',
						icon: 'globe',
						onClick: function () {
							var ticket;
							try {
								ticket = issueTicket({
									paths: paths.map(function (p) {
										return p.path;
									}),
								});
							} catch (e) {
								toast(e.message, { kind: 'bad' });
								close(null);
								return;
							}
							close(ticket);
						},
					});
					go.setAttribute('data-role', 'publish');
					append(dlg, [
						el('h2', { id: 'dlg-title', text: opts.title || 'Publish to the live site?' }),
						el('div', { class: 'dialog-body' }, [
							notice('This changes the public site at ' + siteUrl.replace(/^https?:\/\//, '').replace(/\/$/, '') + '. It is live within a minute or two, and stays in the public history.', 'warn'),
							opts.summary ? (opts.summary instanceof Node ? opts.summary : el('p', { class: 'publish-summary', text: String(opts.summary) })) : null,
							el('div', { class: 'publish-paths' }, [
								el('div', { class: 'label', text: paths.length === 1 ? 'One file changes:' : paths.length + ' files change:' }),
								el(
									'ul',
									{},
									paths.map(function (p) {
										return el('li', {}, [el('code', { text: p.path }), p.note ? el('span', { class: 'muted', text: '  ' + p.note }) : null]);
									})
								),
							]),
							opts.previewNode ? el('div', { class: 'publish-preview' }, opts.previewNode) : null,
						]),
						el('div', { class: 'dialog-actions' }, [cancel, go]),
					]);
				},
				{ wide: !!opts.previewNode }
			).then(function (ticket) {
				return ticket || null;
			});
		}

		return {
			el: el,
			clear: clear,
			icon: icon,
			button: button,
			field: field,
			toast: toast,
			confirm: confirm,
			confirmPublish: confirmPublish,
			dialog: dialog,
			busy: busy,
			renderMarkdown: makeRenderer(siteRoot),
			safeHTML: safeHTML,
			parsePost: parsePost,
			buildPost: buildPost,
			date: date,
			listDetail: listDetail,
			row: row,
			errorBox: errorBox,
			notice: notice,
			theme: theme,
			reducedMotion: reducedMotion,
			loadVendor: loadVendor,
		};
	}

	window.DeskUI = {
		create: create,
		el: el,
		clear: clear,
		icon: icon,
		icons: Object.keys(ICONS),
		button: button,
		field: field,
		toast: toast,
		confirm: confirm,
		dialog: dialog,
		closeAllDialogs: closeAllDialogs,
		busy: busy,
		date: date,
		parsePost: parsePost,
		buildPost: buildPost,
		errorBox: errorBox,
		notice: notice,
		theme: theme,
		reducedMotion: reducedMotion,
		loadVendor: loadVendor,
	};
})();
