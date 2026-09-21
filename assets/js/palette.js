// Command palette: Ctrl/Cmd+K (or "/") opens a searchable list of sections,
// blog posts, external links and actions.
//
// Markup is built lazily on first open and appended to <body>:
//   .palette-backdrop            dims the page, click closes
//   #palette.palette[role=dialog] the box
//     .palette-head
//       #palette-input.palette-input   search field
//     #palette-list.palette-list       results (role=listbox)
//       .palette-group                 group label ("Sections", "Posts", ...)
//       .palette-item                  a row (role=option); .is-selected marks it
//     .palette-hint                    keyboard hint row
//
// Hooks used from the page: #palette-open (optional trigger button) and
// #theme-toggle (clicked by the "Toggle dark mode" action).

(function () {
	'use strict';

	var CV_URL = 'assets/documents/JackLeCV.pdf';
	var POSTS_INDEX = 'blog/index.json';

	var SECTIONS = [
		{ label: 'About', hash: '#/about', keywords: 'home bio research interests honors awards' },
		{ label: 'Education', hash: '#/education', keywords: 'university ut dallas waseda coursework degree' },
		{ label: 'Publications', hash: '#/publications', keywords: 'papers preprints arxiv abstracts' },
		{ label: 'Writing & press', hash: '#/press', keywords: 'news mentions articles media' },
		{ label: 'Blog', hash: '#/blog', keywords: 'posts writing essays' },
		{ label: 'Projects', hash: '#/projects', keywords: 'code software portfolio' },
		{ label: 'Teaching', hash: '#/teaching', keywords: 'grader teaching assistant courses' },
		{ label: 'Presentations', hash: '#/presentations', keywords: 'talks symposium conference' },
		{ label: 'Experience', hash: '#/experience', keywords: 'work internships research industry community' },
	];

	var LINKS = [
		{ label: 'Academic CV', url: CV_URL, keywords: 'resume pdf curriculum vitae' },
		{ label: 'GitHub', url: 'https://github.com/nietztein', keywords: 'code repositories nietztein' },
		{ label: 'LinkedIn', url: 'https://www.linkedin.com/in/jack-le-utd/', keywords: 'profile network' },
		{ label: 'Email', url: 'mailto:jackle12533@gmail.com', keywords: 'contact mail jackle12533' },
		{ label: 'RSS feed', url: 'blog/feed.xml', keywords: 'subscribe atom xml' },
	];

	var ACTIONS = [
		{
			label: 'Toggle dark mode',
			keywords: 'theme light dark switch appearance',
			run: function () {
				var btn = document.getElementById('theme-toggle');
				if (btn) btn.click();
			},
		},
	];

	// ---- Helpers ----------------------------------------------------------

	function escapeHtml(s) {
		return String(s == null ? '' : s)
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#39;');
	}

	function el(tag, className, text) {
		var node = document.createElement(tag);
		if (className) node.className = className;
		if (text != null) node.textContent = text;
		return node;
	}

	function isEditable(target) {
		if (!target || !target.tagName) return false;
		var tag = target.tagName.toLowerCase();
		return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable;
	}

	function closestItem(target) {
		var node = target;
		while (node && node !== list) {
			if (node.classList && node.classList.contains('palette-item')) return node;
			node = node.parentNode;
		}
		return null;
	}

	function goHash(hash) {
		if (window.location.hash === hash) {
			// Same route: nudge the router so the section still gets shown.
			try {
				window.dispatchEvent(new Event('hashchange'));
			} catch (e) {
				/* very old browsers */
			}
		} else {
			window.location.hash = hash;
		}
	}

	function openExternal(url) {
		if (/^mailto:/.test(url)) {
			window.location.href = url;
			return;
		}
		window.open(url, '_blank', 'noopener');
	}

	// ---- Items ------------------------------------------------------------

	function makeItem(group, label, keywords, hint, run) {
		return {
			group: group,
			label: label,
			hint: hint || '',
			search: (label + ' ' + (keywords || '')).toLowerCase(),
			labelLower: label.toLowerCase(),
			run: run,
		};
	}

	var sectionItems = [];
	var linkItems = [];
	var actionItems = [];
	var postItems = [];

	SECTIONS.forEach(function (s) {
		sectionItems.push(
			makeItem('Sections', s.label, s.keywords, s.hash, function () {
				goHash(s.hash);
			})
		);
	});

	LINKS.forEach(function (l) {
		linkItems.push(
			makeItem('Links', l.label, l.keywords, l.url.replace(/^mailto:/, ''), function () {
				openExternal(l.url);
			})
		);
	});

	ACTIONS.forEach(function (a) {
		actionItems.push(makeItem('Actions', a.label, a.keywords, '', a.run));
	});

	var postsLoaded = false;
	var postsLoading = false;

	function loadPosts(done) {
		if (postsLoaded || postsLoading || !window.fetch) return;
		postsLoading = true;
		fetch(POSTS_INDEX)
			.then(function (r) {
				return r.ok ? r.json() : [];
			})
			.then(function (data) {
				var entries = Array.isArray(data) ? data : [];
				postItems = [];
				entries.forEach(function (p) {
					if (!p || !p.slug || !p.title) return;
					var slug = String(p.slug);
					var title = String(p.title);
					var tags = Array.isArray(p.tags) ? p.tags.join(' ') : '';
					var keywords = (p.summary || '') + ' ' + tags + ' ' + (p.date || '');
					postItems.push(
						makeItem('Posts', 'Post: ' + title, keywords, p.date || '', function () {
							goHash('#/post/' + encodeURIComponent(slug));
						})
					);
				});
				postsLoaded = true;
				postsLoading = false;
				if (done) done();
			})
			.catch(function () {
				postsLoading = false;
			});
	}

	function allItems() {
		return sectionItems.concat(postItems, linkItems, actionItems);
	}

	// Case-insensitive match: every whitespace-separated word of the query must
	// appear in label+keywords. Label prefix matches rank first, then label
	// substring matches, then keyword-only matches; ties keep list order.
	function filterItems(query) {
		var q = (query || '').trim().toLowerCase();
		var items = allItems();
		if (!q) return items;

		var words = q.split(/\s+/);
		var scored = [];
		items.forEach(function (it, i) {
			var ok = true;
			for (var w = 0; w < words.length; w++) {
				if (it.search.indexOf(words[w]) === -1) {
					ok = false;
					break;
				}
			}
			if (!ok) return;
			var score = 2;
			if (it.labelLower.indexOf(q) === 0) score = 0;
			else if (it.labelLower.indexOf(q) !== -1) score = 1;
			scored.push({ item: it, score: score, index: i });
		});
		scored.sort(function (a, b) {
			return a.score - b.score || a.index - b.index;
		});
		return scored.map(function (s) {
			return s.item;
		});
	}

	// ---- DOM --------------------------------------------------------------

	var backdrop = null;
	var dialog = null;
	var input = null;
	var list = null;
	var isOpen = false;
	var results = [];
	var selected = 0;
	var lastFocused = null;

	function build() {
		if (dialog) return;

		backdrop = el('div', 'palette-backdrop');
		backdrop.setAttribute('aria-hidden', 'true');

		dialog = el('div', 'palette');
		dialog.id = 'palette';
		dialog.setAttribute('role', 'dialog');
		dialog.setAttribute('aria-modal', 'true');
		dialog.setAttribute('aria-label', 'Command palette');

		var head = el('div', 'palette-head');
		var icon = el('span', 'palette-icon');
		icon.setAttribute('aria-hidden', 'true');
		icon.innerHTML = '<i class="fa-solid fa-magnifying-glass"></i>';

		input = el('input', 'palette-input');
		input.id = 'palette-input';
		input.type = 'text';
		input.setAttribute('placeholder', 'Search sections, posts, links…');
		input.setAttribute('autocomplete', 'off');
		input.setAttribute('autocorrect', 'off');
		input.setAttribute('autocapitalize', 'off');
		input.setAttribute('spellcheck', 'false');
		input.setAttribute('role', 'combobox');
		input.setAttribute('aria-expanded', 'true');
		input.setAttribute('aria-controls', 'palette-list');
		input.setAttribute('aria-autocomplete', 'list');
		input.setAttribute('aria-label', 'Search');

		head.appendChild(icon);
		head.appendChild(input);

		list = el('div', 'palette-list');
		list.id = 'palette-list';
		list.setAttribute('role', 'listbox');

		var hint = el('div', 'palette-hint');
		hint.innerHTML =
			'<span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>' +
			'<span class="palette-hint-sep" aria-hidden="true">·</span>' +
			'<span><kbd>↵</kbd> open</span>' +
			'<span class="palette-hint-sep" aria-hidden="true">·</span>' +
			'<span><kbd>esc</kbd> close</span>';

		dialog.appendChild(head);
		dialog.appendChild(list);
		dialog.appendChild(hint);

		document.body.appendChild(backdrop);
		document.body.appendChild(dialog);

		backdrop.addEventListener('click', close);
		input.addEventListener('input', function () {
			render(input.value);
		});
		input.addEventListener('keydown', onInputKey);

		// Clicking anywhere in the dialog must not steal focus from the input.
		dialog.addEventListener('mousedown', function (ev) {
			if (ev.target !== input) ev.preventDefault();
		});

		list.addEventListener('mousemove', function (ev) {
			var row = closestItem(ev.target);
			if (!row) return;
			var i = parseInt(row.getAttribute('data-index'), 10);
			if (!isNaN(i) && i !== selected) select(i, false);
		});
		list.addEventListener('click', function (ev) {
			var row = closestItem(ev.target);
			if (!row) return;
			var i = parseInt(row.getAttribute('data-index'), 10);
			if (!isNaN(i)) activate(i);
		});
	}

	function render(query) {
		results = filterItems(query);
		selected = 0;
		list.innerHTML = '';

		if (!results.length) {
			list.appendChild(el('div', 'palette-empty', 'No matches.'));
			input.removeAttribute('aria-activedescendant');
			return;
		}

		var html = '';
		var lastGroup = null;
		results.forEach(function (it, i) {
			if (it.group !== lastGroup) {
				html += '<div class="palette-group" role="presentation">' + escapeHtml(it.group) + '</div>';
				lastGroup = it.group;
			}
			html +=
				'<div class="palette-item' + (i === 0 ? ' is-selected' : '') + '" role="option"' +
				' id="palette-item-' + i + '" data-index="' + i + '"' +
				' aria-selected="' + (i === 0 ? 'true' : 'false') + '">' +
				'<span class="palette-item-label">' + escapeHtml(it.label) + '</span>' +
				(it.hint ? '<span class="palette-item-hint">' + escapeHtml(it.hint) + '</span>' : '') +
				'</div>';
		});
		list.innerHTML = html;
		input.setAttribute('aria-activedescendant', 'palette-item-0');
		list.scrollTop = 0;
	}

	function select(i, scroll) {
		if (!results.length) return;
		var n = results.length;
		i = ((i % n) + n) % n; // wrap both ways
		var rows = list.querySelectorAll('.palette-item');
		var prev = rows[selected];
		if (prev) {
			prev.classList.remove('is-selected');
			prev.setAttribute('aria-selected', 'false');
		}
		selected = i;
		var row = rows[i];
		if (row) {
			row.classList.add('is-selected');
			row.setAttribute('aria-selected', 'true');
			input.setAttribute('aria-activedescendant', row.id);
			if (scroll !== false) scrollRowIntoView(row);
		}
	}

	function scrollRowIntoView(row) {
		var top = row.offsetTop;
		var bottom = top + row.offsetHeight;
		// Keep the group label visible when landing on the first row of a group.
		var prevSib = row.previousElementSibling;
		if (prevSib && prevSib.classList.contains('palette-group')) top = prevSib.offsetTop;
		if (top < list.scrollTop) {
			list.scrollTop = top;
		} else if (bottom > list.scrollTop + list.clientHeight) {
			list.scrollTop = bottom - list.clientHeight;
		}
	}

	function activate(i) {
		var it = results[i];
		if (!it) return;
		close();
		// Run after the palette has closed so focus is restored first.
		setTimeout(function () {
			it.run();
		}, 0);
	}

	function onInputKey(ev) {
		switch (ev.key) {
			case 'ArrowDown':
				ev.preventDefault();
				select(selected + 1);
				break;
			case 'ArrowUp':
				ev.preventDefault();
				select(selected - 1);
				break;
			case 'Home':
				ev.preventDefault();
				select(0);
				break;
			case 'End':
				ev.preventDefault();
				select(results.length - 1);
				break;
			case 'Enter':
				ev.preventDefault();
				activate(selected);
				break;
			case 'Escape':
				ev.preventDefault();
				close();
				break;
			case 'Tab':
				// Focus stays in the input while the palette is open.
				ev.preventDefault();
				break;
			default:
				break;
		}
	}

	// ---- Open / close -----------------------------------------------------

	function open() {
		if (isOpen) return;
		build();
		lastFocused = document.activeElement;
		isOpen = true;

		document.body.classList.add('palette-is-open');
		backdrop.classList.add('is-open');
		dialog.classList.add('is-open');

		input.value = '';
		render('');
		input.focus();

		loadPosts(function () {
			if (isOpen) render(input.value);
		});
	}

	function close() {
		if (!isOpen) return;
		isOpen = false;
		document.body.classList.remove('palette-is-open');
		backdrop.classList.remove('is-open');
		dialog.classList.remove('is-open');
		if (lastFocused && lastFocused.focus && document.body.contains(lastFocused)) {
			try {
				lastFocused.focus({ preventScroll: true });
			} catch (e) {
				lastFocused.focus();
			}
		}
		lastFocused = null;
	}

	function toggle() {
		if (isOpen) close();
		else open();
	}

	// ---- Global shortcuts -------------------------------------------------

	document.addEventListener('keydown', function (ev) {
		if (ev.defaultPrevented) return;
		var meta = ev.ctrlKey || ev.metaKey;

		if (meta && !ev.altKey && !ev.shiftKey && (ev.key === 'k' || ev.key === 'K')) {
			ev.preventDefault();
			toggle();
			return;
		}

		if (isOpen) {
			if (ev.key === 'Escape') {
				ev.preventDefault();
				close();
			} else if (document.activeElement !== input) {
				input.focus();
			}
			return;
		}

		if (ev.key === '/' && !meta && !ev.altKey && !isEditable(ev.target)) {
			ev.preventDefault();
			open();
		}
	});

	function bindTrigger() {
		var btn = document.getElementById('palette-open');
		if (!btn) return;
		btn.addEventListener('click', function (ev) {
			ev.preventDefault();
			open();
		});
	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', bindTrigger);
	} else {
		bindTrigger();
	}

	window.Palette = { open: open, close: close, toggle: toggle };
})();
