/* ==========================================================================
   "Cite this" for the publications list.

   Every #publicationsContent .pub-block gets a quiet "Cite" button at the end
   of its .pub-congress line. It opens a small dialog with BibTeX and APA tabs,
   a Copy button and a "Download .bib" link.

   Citations are GENERATED from fields, never stored as text. The fields live
   in assets/data/citations.json, keyed by a slug of the title (see slugOf).
   A publication with no entry there still gets a citation built from what the
   page shows, so a new .pub-block works before the JSON is updated.

   Public API: window.Cite = { ready, slugOf, bibtexFor, apaFor, all,
   allBibtex, downloadAll, open, close, refresh }.
   Debug: ?citeDebug=<slug>[&citeTab=apa][&citeTheme=light|dark] opens that
   entry on load (for screenshots).
   The pure generators are also exported for Node (module.exports).
   ========================================================================== */
(function (root) {
	'use strict';

	/* ---------- Pure generators (no DOM) -------------------------------- */

	function clean(s) {
		return String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
	}

	/* lowercase, non-alphanumerics to hyphens, trimmed, first 60 chars. */
	function slugOf(title) {
		return clean(title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
	}

	function texEscape(s) {
		return String(s).replace(/([&%_#$])/g, '\\$1');
	}

	/* Brace words with two or more capitals (LLM, AI, NeurIPS) so BibTeX styles keep their case. */
	function protectCaps(s) {
		return s.replace(/[A-Za-z0-9]*[A-Z][A-Za-z0-9]*[A-Z][A-Za-z0-9]*/g, '{$&}');
	}

	/* "Last, First" or "First Last" to { last, first }. */
	function parseName(name) {
		var n = clean(name);
		var comma = n.indexOf(',');
		if (comma !== -1) return { last: clean(n.slice(0, comma)), first: clean(n.slice(comma + 1)) };
		var parts = n.split(' ');
		if (parts.length < 2) return { last: n, first: '' };
		return { last: parts[parts.length - 1], first: parts.slice(0, -1).join(' ') };
	}

	function initials(first) {
		return clean(first).split(' ').filter(Boolean).map(function (word) {
			return word.split('-').filter(Boolean).map(function (p) { return p.charAt(0).toUpperCase() + '.'; }).join('-');
		}).join(' ');
	}

	var RAW_FIELDS = { url: 1, doi: 1, eprint: 1, archivePrefix: 1, primaryClass: 1 };
	var FIELD_ORDER = ['title', 'author', 'booktitle', 'journal', 'howpublished', 'volume', 'number', 'pages',
		'publisher', 'year', 'month', 'eprint', 'archivePrefix', 'primaryClass', 'doi', 'url', 'note'];
	var META_FIELDS = { type: 1, key: 1, slug: 1, generated: 1 };

	function resolveUrl(url, base) {
		if (!url || /^[a-z][a-z0-9+.-]*:/i.test(url)) return url;
		// Relative paths (local PDFs) resolve against the canonical site URL when the page declares one.
		var b = base;
		if (!b && typeof document !== 'undefined') {
			var canon = document.querySelector('link[rel="canonical"][href]');
			b = canon ? canon.href : document.baseURI;
		}
		if (!b) return url;
		try {
			var u = new URL(b);
			u.search = '';
			u.hash = '';
			return new URL(url, u.href).href;
		} catch (e) {
			return url;
		}
	}

	function fieldValue(name, entry, base) {
		var v = entry[name];
		if (name === 'author') return (Array.isArray(v) ? v : [v]).map(clean).map(texEscape).join(' and ');
		if (name === 'title') return protectCaps(texEscape(clean(v)));
		if (name === 'url') return resolveUrl(String(v), base);
		if (RAW_FIELDS[name]) return String(v);
		return texEscape(clean(v));
	}

	function bibtex(entry, base) {
		var names = FIELD_ORDER.filter(function (n) { return entry[n] != null && entry[n] !== ''; });
		Object.keys(entry).forEach(function (n) {
			if (!META_FIELDS[n] && names.indexOf(n) === -1 && entry[n] != null && entry[n] !== '') names.splice(names.length - (entry.note ? 1 : 0), 0, n);
		});
		var lines = names.map(function (n) { return '  ' + n + ' = {' + fieldValue(n, entry, base) + '}'; });
		return '@' + (entry.type || 'misc') + '{' + (entry.key || 'key') + ',\n' + lines.join(',\n') + '\n}';
	}

	function apaAuthors(list) {
		var names = (Array.isArray(list) ? list : [list]).filter(Boolean).map(function (a) {
			var n = parseName(a);
			var ini = initials(n.first);
			return ini ? n.last + ', ' + ini : n.last;
		});
		if (names.length < 2) return names.join('');
		if (names.length === 2) return names[0] + ', & ' + names[1];
		return names.slice(0, -1).join(', ') + ', & ' + names[names.length - 1];
	}

	function stop(s) {
		s = clean(s);
		return /[.?!]$/.test(s) ? s : s + '.';
	}

	/* APA 7 as a list of segments: { t: text, i: italic }. Titles keep the capitalisation they are stored with. */
	function apaSegments(entry, base) {
		var seg = [];
		function add(t, i) { if (t) seg.push({ t: t, i: !!i }); }
		var authors = apaAuthors(entry.author);
		var title = clean(entry.title);
		var year = '(' + (entry.year || 'n.d.') + ').';
		add(authors ? stop(authors) + ' ' + year + ' ' : '');
		if (entry.type === 'inproceedings' || entry.type === 'incollection') {
			add(stop(title) + ' ');
			if (!authors) add(year + ' ');
			add('In ');
			add(clean(entry.booktitle), true);
			add('. ');
		} else if (entry.type === 'article') {
			add(stop(title) + ' ');
			if (!authors) add(year + ' ');
			add(clean(entry.journal) + (entry.volume ? ', ' + entry.volume : ''), true);
			add((entry.number ? '(' + entry.number + ')' : '') + (entry.pages ? ', ' + String(entry.pages).replace(/-+/g, '–') : '') + '. ');
		} else {
			if (entry.eprint) {
				add(title, true);
				add(' (' + (entry.archivePrefix || 'arXiv') + ':' + entry.eprint + '). ' + (entry.archivePrefix || 'arXiv') + '. ');
			} else {
				add(/[.?!]$/.test(title) ? title : title + '.', true);
				add(' ');
			}
			if (!authors) add(year + ' ');
			if (entry.howpublished) add(stop(entry.howpublished) + ' ');
		}
		if (entry.note) add(stop(entry.note) + ' ');
		if (entry.doi) add('https://doi.org/' + entry.doi);
		else if (entry.url) add(resolveUrl(String(entry.url), base));
		if (seg.length) seg[seg.length - 1].t = seg[seg.length - 1].t.replace(/\s+$/, '');
		return seg;
	}

	function apa(entry, base) {
		return apaSegments(entry, base).map(function (s) { return s.t; }).join('');
	}

	var KEY_STOPWORDS = { a: 1, an: 1, the: 1, on: 1, of: 1, in: 1, to: 1, 'for': 1, and: 1, 'do': 1, does: 1, what: 1, is: 1, are: 1, how: 1, why: 1, towards: 1, toward: 1 };

	function makeKey(authors, year, title) {
		var first = authors && authors.length ? parseName(authors[0]).last : 'anon';
		var words = clean(title).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
		var word = words.filter(function (w) { return !KEY_STOPWORDS[w]; })[0] || words[0] || '';
		return (first.toLowerCase().replace(/[^a-z0-9]/g, '') || 'anon') + (year || '') + word;
	}

	var pure = { slugOf: slugOf, bibtex: bibtex, apa: apa, apaSegments: apaSegments, makeKey: makeKey, texEscape: texEscape, protectCaps: protectCaps };
	if (typeof module !== 'undefined' && module.exports) module.exports = pure;
	if (typeof document === 'undefined') return;

	/* ---------- Browser side ------------------------------------------- */

	var script = document.currentScript;
	var DATA_URL = script && script.src ? new URL('../data/citations.json', script.src).href : 'assets/data/citations.json';

	var data = {};      // slug -> entry from citations.json
	var fromDom = {};   // slug -> entry generated from the page
	var pop = null;     // the one shared dialog
	var openBtn = null; // the button whose dialog is open
	var blobUrl = null;
	var statusTimer = 0;

	function textOf(el, drop) {
		if (!el) return '';
		var copy = el.cloneNode(true);
		Array.prototype.forEach.call(copy.querySelectorAll(drop), function (n) { n.remove(); });
		return clean(copy.textContent);
	}

	/* Fallback entry from what the page shows: title, authors as shown, nearest year heading, venue line as note. */
	function entryFromBlock(block) {
		var title = textOf(block.querySelector('.lucida-console.h5'), '.cite-btn');
		var authors = textOf(block.querySelector('.pub-authors'), 'sup').split(',').map(clean).filter(Boolean);
		var note = textOf(block.querySelector('.pub-congress'), '.pub-play, .cite-btn').replace(/\.$/, '');
		var year = '';
		var row = block.closest('.row');
		var heading = row && row.querySelector('.pub-year-h2');
		if (!heading) {
			var all = document.querySelectorAll('#publicationsContent .pub-year-h2');
			for (var i = 0; i < all.length; i++) {
				if (all[i].compareDocumentPosition(block) & Node.DOCUMENT_POSITION_FOLLOWING) heading = all[i];
			}
		}
		if (heading) year = (clean(heading.textContent).match(/\d{4}/) || [''])[0];
		var link = block.querySelector('.lucida-console.h5 a[href]');
		var entry = { type: 'misc', key: makeKey(authors, year, title), title: title, author: authors, generated: true };
		if (year) entry.year = year;
		if (link) entry.url = link.getAttribute('href');
		if (note) entry.note = note;
		return entry;
	}

	function entryFor(slug) {
		return data[slug] || fromDom[slug] || null;
	}

	function bibtexFor(slug) {
		var e = entryFor(slug);
		return e ? bibtex(e) : null;
	}

	function apaFor(slug) {
		var e = entryFor(slug);
		return e ? apa(e) : null;
	}

	function all() {
		var slugs = Object.keys(data);
		Object.keys(fromDom).forEach(function (s) { if (!data[s]) slugs.push(s); });
		return slugs.map(function (s) {
			return { slug: s, entry: entryFor(s), bibtex: bibtexFor(s), apa: apaFor(s) };
		});
	}

	function allBibtex() {
		return all().map(function (c) { return c.bibtex; }).join('\n\n') + '\n';
	}

	function bibBlob(text) {
		return URL.createObjectURL(new Blob([text], { type: 'application/x-bibtex;charset=utf-8' }));
	}

	/* Download every entry as one .bib file. */
	function downloadAll(filename) {
		var url = bibBlob(allBibtex());
		var a = document.createElement('a');
		a.href = url;
		a.download = filename || 'publications.bib';
		a.hidden = true;
		document.body.appendChild(a);
		a.click();
		a.remove();
		setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
	}

	/* ---------- Dialog -------------------------------------------------- */

	function el(tag, attrs, text) {
		var n = document.createElement(tag);
		Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); });
		if (text != null) n.textContent = text;
		return n;
	}

	function buildPop() {
		pop = el('div', { id: 'cite-pop', 'class': 'cite-pop', role: 'dialog', 'aria-modal': 'false', hidden: '' });
		var head = el('div', { 'class': 'cite-pop-head' });
		var tabs = el('div', { 'class': 'cite-tabs', role: 'tablist', 'aria-label': 'Citation format' });
		['bibtex', 'apa'].forEach(function (name) {
			tabs.appendChild(el('button', {
				type: 'button', 'class': 'cite-tab', role: 'tab', id: 'cite-tab-' + name,
				'aria-controls': 'cite-panel-' + name, 'data-cite-tab': name
			}, name === 'bibtex' ? 'BibTeX' : 'APA'));
		});
		head.appendChild(tabs);
		head.appendChild(el('button', { type: 'button', 'class': 'cite-close', 'aria-label': 'Close citation' }, '×'));
		pop.appendChild(head);

		var pb = el('div', { 'class': 'cite-panel', role: 'tabpanel', id: 'cite-panel-bibtex', 'aria-labelledby': 'cite-tab-bibtex', tabindex: '0' });
		pb.appendChild(el('pre', { 'class': 'cite-text' }));
		var pa = el('div', { 'class': 'cite-panel', role: 'tabpanel', id: 'cite-panel-apa', 'aria-labelledby': 'cite-tab-apa', tabindex: '0' });
		pa.appendChild(el('p', { 'class': 'cite-text' }));
		pop.appendChild(pb);
		pop.appendChild(pa);

		var actions = el('div', { 'class': 'cite-actions' });
		actions.appendChild(el('button', { type: 'button', 'class': 'cite-copy' }, 'Copy'));
		actions.appendChild(el('a', { 'class': 'cite-download', href: '#' }, 'Download .bib'));
		actions.appendChild(el('span', { 'class': 'cite-status', role: 'status', 'aria-live': 'polite' }));
		pop.appendChild(actions);
		document.body.appendChild(pop);

		pop.addEventListener('click', function (ev) {
			var tab = ev.target.closest('.cite-tab');
			if (tab) return selectTab(tab.getAttribute('data-cite-tab'), false);
			if (ev.target.closest('.cite-close')) return close(true);
			if (ev.target.closest('.cite-copy')) return copyCurrent();
		});
		pop.addEventListener('keydown', onPopKey);
	}

	function currentTab() {
		var t = pop.querySelector('.cite-tab[aria-selected="true"]');
		return t ? t.getAttribute('data-cite-tab') : 'bibtex';
	}

	function selectTab(name, focus) {
		Array.prototype.forEach.call(pop.querySelectorAll('.cite-tab'), function (t) {
			var on = t.getAttribute('data-cite-tab') === name;
			t.setAttribute('aria-selected', on ? 'true' : 'false');
			t.setAttribute('tabindex', on ? '0' : '-1');
			document.getElementById(t.getAttribute('aria-controls')).hidden = !on;
			if (on && focus) t.focus({ preventScroll: true });
		});
		setStatus('');
		place();
	}

	function setStatus(msg) {
		clearTimeout(statusTimer);
		var s = pop.querySelector('.cite-status');
		s.textContent = msg;
		if (msg) statusTimer = setTimeout(function () { s.textContent = ''; }, 2500);
	}

	function fallbackCopy(text) {
		var ta = el('textarea', { readonly: '', 'aria-hidden': 'true' });
		ta.value = text;
		ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;';
		pop.appendChild(ta);
		ta.select();
		var ok = false;
		try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
		ta.remove();
		return ok;
	}

	function copyCurrent() {
		var name = currentTab();
		var label = name === 'bibtex' ? 'BibTeX' : 'APA';
		var text = document.querySelector('#cite-panel-' + name + ' .cite-text').textContent;
		var copyBtn = pop.querySelector('.cite-copy');
		function done(ok) {
			if (!ok) copyBtn.focus({ preventScroll: true });
			setStatus(ok ? 'Copied ' + label : 'Copy failed. Select the text instead.');
		}
		if (navigator.clipboard && navigator.clipboard.writeText && window.isSecureContext) {
			navigator.clipboard.writeText(text).then(function () { done(true); }, function () {
				done(fallbackCopy(text));
				copyBtn.focus({ preventScroll: true });
			});
		} else {
			done(fallbackCopy(text));
			copyBtn.focus({ preventScroll: true });
		}
	}

	function focusables() {
		return Array.prototype.filter.call(pop.querySelectorAll('button, a[href], [tabindex="0"]'), function (n) {
			return n.getAttribute('tabindex') !== '-1' && n.offsetParent !== null;
		});
	}

	function onPopKey(ev) {
		if (ev.key === 'Tab') {
			// The dialog sits at the end of <body>, so keep Tab inside it; Esc leaves.
			var f = focusables();
			var i = f.indexOf(document.activeElement);
			var next = ev.shiftKey ? (i <= 0 ? f.length - 1 : i - 1) : (i === f.length - 1 ? 0 : i + 1);
			ev.preventDefault();
			f[next].focus();
			return;
		}
		if (ev.target.closest && ev.target.closest('.cite-tab')) {
			var order = ['bibtex', 'apa'];
			var at = order.indexOf(currentTab());
			var to = -1;
			if (ev.key === 'ArrowRight') to = (at + 1) % order.length;
			else if (ev.key === 'ArrowLeft') to = (at + order.length - 1) % order.length;
			else if (ev.key === 'Home') to = 0;
			else if (ev.key === 'End') to = order.length - 1;
			if (to !== -1) {
				ev.preventDefault();
				selectTab(order[to], true);
			}
		}
	}

	/* Anchor the dialog under the button (above it when there is no room), clamped to the viewport. */
	function place() {
		if (!pop || pop.hidden || !openBtn) return;
		var r = openBtn.getBoundingClientRect();
		var vw = document.documentElement.clientWidth;
		var vh = window.innerHeight;
		var w = pop.offsetWidth;
		var h = pop.offsetHeight;
		var left = Math.max(12, Math.min(r.left, vw - w - 12));
		var top = r.bottom + 6;
		if (top + h > vh - 8 && r.top - h - 6 > 8) top = r.top - h - 6;
		pop.style.left = (left + window.pageXOffset) + 'px';
		pop.style.top = (top + window.pageYOffset) + 'px';
	}

	function open(target, tab) {
		var btn = typeof target === 'string'
			? document.querySelector('.cite-btn[data-cite-slug="' + target.replace(/[^a-z0-9-]/g, '') + '"]')
			: target;
		if (!btn) return false;
		var slug = btn.getAttribute('data-cite-slug');
		var entry = entryFor(slug);
		if (!entry) return false;
		if (!pop) buildPop();
		if (openBtn) close(false);

		var bib = bibtex(entry);
		pop.querySelector('#cite-panel-bibtex .cite-text').textContent = bib;
		var p = pop.querySelector('#cite-panel-apa .cite-text');
		p.textContent = '';
		apaSegments(entry).forEach(function (s) {
			p.appendChild(s.i ? el('em', {}, s.t) : document.createTextNode(s.t));
		});
		pop.setAttribute('aria-label', 'Cite: ' + clean(entry.title));

		var dl = pop.querySelector('.cite-download');
		blobUrl = bibBlob(bib + '\n');
		dl.href = blobUrl;
		dl.setAttribute('download', (entry.key || slug) + '.bib');

		openBtn = btn;
		btn.setAttribute('aria-expanded', 'true');
		pop.hidden = false;
		selectTab(tab === 'apa' ? 'apa' : 'bibtex', true);
		place();
		return true;
	}

	function close(returnFocus) {
		if (!pop || !openBtn) return;
		var btn = openBtn;
		openBtn = null;
		pop.hidden = true;
		setStatus('');
		btn.setAttribute('aria-expanded', 'false');
		if (blobUrl) {
			// Give a just-clicked download a moment before the URL goes away.
			var dead = blobUrl;
			blobUrl = null;
			setTimeout(function () { URL.revokeObjectURL(dead); }, 1000);
		}
		if (returnFocus) btn.focus({ preventScroll: true });
	}

	/* ---------- Buttons -------------------------------------------------- */

	function refresh() {
		Array.prototype.forEach.call(document.querySelectorAll('#publicationsContent .pub-block'), function (block) {
			if (block.querySelector('.cite-btn')) return;
			var line = block.querySelector('.pub-congress');
			var titleEl = block.querySelector('.lucida-console.h5');
			if (!line || !titleEl) return;
			var title = clean(titleEl.textContent);
			var slug = slugOf(title);
			if (!slug) return;
			fromDom[slug] = entryFromBlock(block);
			var btn = el('button', {
				type: 'button', 'class': 'cite-btn', 'data-cite-slug': slug,
				'aria-haspopup': 'dialog', 'aria-expanded': 'false', 'aria-controls': 'cite-pop',
				'aria-label': 'Cite: ' + title
			}, 'Cite');
			line.appendChild(document.createTextNode(' '));
			line.appendChild(btn);
		});
	}

	function init() {
		refresh();

		document.addEventListener('click', function (ev) {
			var btn = ev.target.closest && ev.target.closest('.cite-btn');
			if (!btn) return;
			ev.preventDefault();
			if (openBtn === btn) close(true);
			else open(btn);
		});
		// Outside press closes; focus goes back to the button unless the press lands on something focusable.
		document.addEventListener('pointerdown', function (ev) {
			if (!openBtn || pop.contains(ev.target) || (ev.target.closest && ev.target.closest('.cite-btn'))) return;
			close(true);
		}, true);
		document.addEventListener('keydown', function (ev) {
			if (ev.key === 'Escape' && openBtn) {
				ev.preventDefault();
				ev.stopPropagation();
				close(true);
			}
		}, true);
		window.addEventListener('resize', place);
		window.addEventListener('hashchange', function () { close(false); });
	}

	var ready = new Promise(function (resolve) {
		function start() {
			init();
			fetch(DATA_URL).then(function (r) {
				if (!r.ok) throw new Error('HTTP ' + r.status);
				return r.json();
			}).then(function (json) {
				data = json || {};
			}).catch(function (err) {
				// Not fatal: every citation falls back to what the page shows.
				if (window.console) console.warn('cite.js: citations.json unavailable, using page text.', err);
			}).then(function () {
				resolve(api);
				debugOpen();
			});
		}
		if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
		else start();
	});

	/* ?citeDebug=<slug>[&citeTab=apa][&citeTheme=light|dark]: open that entry on load (for screenshots). */
	function debugOpen() {
		var q;
		try { q = new URLSearchParams(location.search); } catch (e) { return; }
		var slug = q.get('citeDebug');
		if (!slug) return;
		var theme = q.get('citeTheme');
		if (theme === 'light' || theme === 'dark') {
			document.documentElement.setAttribute('data-theme', theme);
			document.documentElement.setAttribute('data-bs-theme', theme);
		}
		setTimeout(function () {
			var btn = document.querySelector('.cite-btn[data-cite-slug="' + slug.replace(/[^a-z0-9-]/g, '') + '"]');
			if (!btn) return;
			btn.scrollIntoView({ block: 'center', behavior: 'instant' });
			open(btn, q.get('citeTab'));
		}, 800);
	}

	var api = {
		ready: ready,
		slugOf: slugOf,
		bibtexFor: bibtexFor,
		apaFor: apaFor,
		all: all,
		allBibtex: allBibtex,
		downloadAll: downloadAll,
		open: open,
		close: function () { close(true); },
		refresh: refresh
	};
	root.Cite = api;
})(typeof window !== 'undefined' ? window : this);
