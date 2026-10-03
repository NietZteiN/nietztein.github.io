// Command palette: Ctrl/Cmd+K (or "/") opens a searchable list of sections,
// blog posts, external links and actions. With a query it searches the whole
// site: publications, presentations, teaching, experience, honors, press
// (indexed once from the DOM), the bookshelf (assets/data/library.json, fetched
// the first time a query has 2+ characters) and the misc toys.
//
// ?paletteDebug=<query> opens the palette on load with that query typed (for
// headless screenshots).
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
//
// Other scripts (the gadgets) can add actions at runtime:
//   var remove = window.Palette.addActions([{ label, keywords, hint, run }]);
//   remove();   // takes them out again

(function () {
	'use strict';

	var CV_URL = 'assets/documents/JackLeCV.pdf';
	var POSTS_INDEX = 'blog/index.json';
	var THEATRE_URL = 'misc/55-paper-theatre/';
	var STORIES_INDEX = THEATRE_URL + 'stories/index.json';
	var LIBRARY_URL = 'assets/data/library.json';

	// Order of the groups when nothing else decides it (see filterItems).
	var GROUP_ORDER = [
		'Sections', 'Publications', 'Presentations', 'Teaching', 'Experience', 'Honors', 'Press',
		'Bookshelf', 'Misc', 'Posts', 'Stories', 'Links', 'Actions',
	];
	// Most rows a group may show while a query is present. Groups not listed
	// here (Sections, Posts, Stories, Links, Actions) are never cut.
	var GROUP_CAPS = {
		Publications: 6, Presentations: 6, Teaching: 6, Experience: 6, Honors: 6, Press: 6,
		Bookshelf: 8, Misc: 6,
	};
	var BOOK_MIN_QUERY = 2;
	var BOOK_DEBOUNCE_MS = 120;
	var FLASH_MS = 1500;

	var SECTIONS = [
		{ label: 'About', hash: '#/about', keywords: 'home bio research interests honors awards' },
		{ label: 'Education', hash: '#/education', keywords: 'university ut dallas waseda coursework degree' },
		{ label: 'Publications', hash: '#/publications', keywords: 'papers preprints arxiv abstracts' },
		{ label: 'Writing & press', hash: '#/press', keywords: 'news mentions articles media' },
		{ label: 'Blog', hash: '#/blog', keywords: 'posts writing essays' },
		{ label: 'Teaching', hash: '#/teaching', keywords: 'grader teaching assistant courses' },
		{ label: 'Presentations', hash: '#/presentations', keywords: 'talks symposium conference' },
		{ label: 'Experience', hash: '#/experience', keywords: 'work internships research industry community' },
		{ label: 'Bookshelf', hash: '#/bookshelf', keywords: 'books library shelves reading manga novels catalog collection' },
		{ label: 'Miscellaneous', hash: '#/misc', keywords: 'misc toys side projects games clocks tools playground' },
	];

	var LINKS = [
		{ label: 'Academic CV', url: CV_URL, keywords: 'resume pdf curriculum vitae' },
		{ label: 'GitHub', url: 'https://github.com/nietztein', keywords: 'code repositories nietztein' },
		{ label: 'LinkedIn', url: 'https://www.linkedin.com/in/jack-le-utd/', keywords: 'profile network' },
		{ label: 'Email', url: 'mailto:jackle12533@gmail.com', keywords: 'contact mail jackle12533' },
		{ label: 'Paper Theatre', url: THEATRE_URL, keywords: 'visual novel stories papers posts play kamishibai toy' },
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
		{
			label: 'Print CV',
			keywords: 'print paper pdf resume curriculum vitae printer',
			run: function () {
				if (window.Site && typeof window.Site.printCV === 'function') window.Site.printCV();
				else if (window.print) window.print();
			},
		},
		{
			label: 'Download all citations (.bib)',
			keywords: 'bibtex cite citation references export publications papers',
			// Only offered when a citation module is on the page.
			when: function () {
				return !!citeDownloader();
			},
			run: function () {
				var fn = citeDownloader();
				if (fn) fn();
			},
		},
		{
			label: 'Research map: Loop',
			keywords: 'glance gallery human machine loop view about',
			run: function () {
				showGlance('loop');
			},
		},
		{
			label: 'Research map: 3D',
			keywords: 'glance gallery three dimensional model view about',
			run: function () {
				showGlance('3d');
			},
		},
		{
			label: 'Research map: Timeline',
			keywords: 'glance gallery history years chronology view about',
			run: function () {
				showGlance('timeline');
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

	function reducedMotion() {
		try {
			return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
		} catch (e) {
			return false;
		}
	}

	function textOf(node) {
		return node ? String(node.textContent || '').replace(/\s+/g, ' ').trim() : '';
	}

	function qsa(sel, root) {
		try {
			return Array.prototype.slice.call((root || document).querySelectorAll(sel));
		} catch (e) {
			return [];
		}
	}

	function closestClass(node, className) {
		while (node && node !== document) {
			if (node.classList && node.classList.contains(className)) return node;
			node = node.parentNode;
		}
		return null;
	}

	function yearIn(s) {
		var m = /\b(?:19|20)\d\d\b/.exec(s || '');
		return m ? m[0] : '';
	}

	// ---- Jump and highlight -----------------------------------------------

	var flash = null; // { node, saved, timers }

	function endFlash() {
		if (!flash) return;
		flash.timers.forEach(clearTimeout);
		var st = flash.node.style;
		st.outline = flash.saved.outline;
		st.outlineOffset = flash.saved.outlineOffset;
		st.borderRadius = flash.saved.borderRadius;
		st.transition = flash.saved.transition;
		flash = null;
	}

	// A ring around the element for about 1.5s, set inline so no stylesheet is
	// needed. With reduced motion the ring does not fade, it is just removed.
	function flashNode(node) {
		endFlash();
		var st = node.style;
		if (!st) return;
		flash = {
			node: node,
			saved: {
				outline: st.outline,
				outlineOffset: st.outlineOffset,
				borderRadius: st.borderRadius,
				transition: st.transition,
			},
			timers: [],
		};
		st.outline = '2px solid var(--accent, #1f5fd6)';
		st.outlineOffset = '6px';
		st.borderRadius = '6px';
		if (!reducedMotion()) {
			flash.timers.push(
				setTimeout(function () {
					st.transition = 'outline-color 400ms ease';
					st.outlineColor = 'transparent';
				}, FLASH_MS - 400)
			);
		}
		flash.timers.push(setTimeout(endFlash, FLASH_MS));
	}

	function scrollToNode(node) {
		try {
			node.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'center' });
		} catch (e) {
			node.scrollIntoView();
		}
	}

	// Calls done(node) once the node is laid out (its section is shown by the
	// router on hashchange, which may be a tick or two away).
	function whenVisible(getNode, done) {
		var tries = 0;
		function attempt() {
			var node = getNode();
			var shown = node && document.body.contains(node) && node.getClientRects().length > 0;
			if (shown) done(node);
			else if (tries++ < 30) setTimeout(attempt, 50);
		}
		setTimeout(attempt, 80);
	}

	// Go to a section, then bring one of its elements into view and ring it.
	function jumpTo(hash, node) {
		goHash(hash);
		whenVisible(
			function () {
				return node;
			},
			function (n) {
				scrollToNode(n);
				flashNode(n);
			}
		);
	}

	// ---- Action helpers ---------------------------------------------------

	function citeDownloader() {
		var c = window.Cite;
		if (!c) return null;
		var names = ['downloadAll', 'downloadAllBib', 'downloadBib', 'exportAll'];
		for (var i = 0; i < names.length; i++) {
			if (typeof c[names[i]] === 'function') return c[names[i]].bind(c);
		}
		return null;
	}

	// Research map on the About page (glance.js). The gallery reads the
	// 'glance-view' key when it builds; if it is already built, its thumbnail
	// button switches it live.
	function showGlance(view) {
		try {
			window.localStorage.setItem('glance-view', view);
		} catch (e) {
			/* private mode etc. */
		}
		goHash('#/about');
		whenVisible(
			function () {
				return document.getElementById('cv-glance');
			},
			function (box) {
				try {
					window.dispatchEvent(new CustomEvent('glance:view', { detail: { view: view } }));
				} catch (e) {
					/* no CustomEvent constructor */
				}
				var btn = box.querySelector('.glance-thumb[data-view="' + view + '"]');
				if (!btn) {
					var want = view.toLowerCase();
					qsa('button', box).some(function (b) {
						if (textOf(b).toLowerCase().indexOf(want) === -1) return false;
						btn = b;
						return true;
					});
				}
				if (btn) btn.click();
				scrollToNode(box);
			}
		);
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
			when: null, // optional: the item is listed only while this returns true
		};
	}

	var sectionItems = [];
	var linkItems = [];
	var actionItems = [];
	var postItems = [];
	var storyItems = [];

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
		var it = makeItem('Actions', a.label, a.keywords, '', a.run);
		if (a.when) it.when = a.when;
		actionItems.push(it);
	});

	// ---- Page content (indexed once from the DOM) --------------------------

	var domItems = [];
	var domIndexed = false;

	function addDom(group, label, keywords, hint, hash, node) {
		if (!label) return;
		domItems.push(
			makeItem(group, label, keywords, hint, function () {
				jumpTo(hash, node);
			})
		);
	}

	// Year heading of the row an entry sits in ("2026").
	function rowYear(node) {
		var row = closestClass(node, 'row');
		var h = row ? row.querySelector('.pub-year-h2, .academic-year-h2') : null;
		return textOf(h);
	}

	// Nearest heading above the entry's row or list ("Workshop papers").
	function headingAbove(node) {
		var n = node ? node.previousElementSibling : null;
		while (n) {
			if (/^H[2-5]$/.test(n.tagName) && !/year-h2/.test(n.className)) return textOf(n);
			n = n.previousElementSibling;
		}
		return '';
	}

	function indexPubBlocks(group, hash, rootSel) {
		qsa(rootSel + ' .pub-block').forEach(function (block) {
			var title = textOf(block.querySelector('.lucida-console.h5'));
			var authors = textOf(block.querySelector('.pub-authors'));
			var venue = textOf(block.querySelector('.pub-congress'));
			var year = rowYear(block) || yearIn(authors) || yearIn(venue);
			var kind = headingAbove(closestClass(block, 'row'));
			addDom(group, title, [authors, venue, kind, year].join(' '), year, hash, block);
		});
	}

	function indexDom() {
		if (domIndexed) return;
		domIndexed = true;
		domItems = [];

		indexPubBlocks('Publications', '#/publications', '#publicationsContent');

		// Presentations have no wrapper: a title line followed by a venue line.
		qsa('#presentationsContent .lucida-console.h5').forEach(function (title) {
			var next = title.nextElementSibling;
			var venue = next && !/\bh5\b/.test(next.className) && !/^H\d$/.test(next.tagName) ? textOf(next) : '';
			var year = rowYear(title) || yearIn(venue);
			addDom('Presentations', textOf(title), venue + ' talk ' + year, year, '#/presentations', title);
		});

		qsa('#academicContent .academic-block').forEach(function (block) {
			var name = textOf(block.querySelector('.academic-name')) || textOf(block.querySelector('.lucida-console.h5'));
			var role = textOf(block.querySelector('.academic-rol'));
			var when = textOf(block.querySelector('.academic-year')) || rowYear(block);
			var hint = role && when ? role + ' · ' + when : role || when;
			addDom('Teaching', name, role + ' ' + when + ' teaching course', hint, '#/teaching', block);
		});

		qsa('#experienceContent li').forEach(function (li) {
			var full = textOf(li);
			var role = textOf(li.querySelector('strong'));
			// "Role, Place — what; when." -> label "Role, Place", hint "when".
			var head = full.split(/\s[—–]\s/)[0];
			var label = head.length <= 70 ? head : role || head.slice(0, 70);
			var tail = full.lastIndexOf(';') !== -1 ? full.slice(full.lastIndexOf(';') + 1).replace(/\.$/, '').trim() : '';
			var kind = headingAbove(li.parentNode);
			var hint = tail && tail.length <= 28 ? tail : kind;
			addDom('Experience', label, full + ' ' + kind, hint, '#/experience', li);
		});

		qsa('#aboutmeContent .abme-honors-bullet').forEach(function (li) {
			var full = textOf(li);
			var name = textOf(li.querySelector('strong')) || full.slice(0, 70);
			addDom('Honors', name, full + ' honor award scholarship', yearIn(full), '#/about', li);
		});

		indexPubBlocks('Press', '#/press', '#blogContent');

		qsa('.misc-grid .misc-card').forEach(function (card) {
			var href = card.getAttribute('href');
			var title = textOf(card.querySelector('.misc-title'));
			if (!href || !title) return;
			domItems.push(
				makeItem('Misc', title, textOf(card.querySelector('.misc-desc')) + ' toy ' + href, href, function () {
					openExternal(href);
				})
			);
		});
	}

	// ---- Bookshelf (assets/data/library.json, fetched on demand) -----------

	var books = null; // [{ id, title, author, year, tl, search, item }]
	var booksLoading = false;
	var booksFailed = false;
	var booksWaiting = null; // callback of the newest query waiting on the fetch
	var bookQuery = ''; // the query bookMatches was computed for
	var bookMatches = []; // every matching book for bookQuery, best first
	var bookTimer = 0;

	// Silent on failure: the Bookshelf group is then simply absent.
	function loadBooks(done) {
		if (books) {
			done();
			return;
		}
		booksWaiting = done;
		if (booksLoading || booksFailed || !window.fetch) return;
		booksLoading = true;
		fetch(LIBRARY_URL)
			.then(function (r) {
				return r.ok ? r.json() : null;
			})
			.then(function (data) {
				booksLoading = false;
				var rows = data && Array.isArray(data.books) ? data.books : null;
				if (!rows) {
					booksFailed = true;
					return;
				}
				var out = [];
				rows.forEach(function (b) {
					if (!b || !b.id || !b.t) return;
					var title = String(b.t);
					var author = String(b.a || '');
					out.push({
						id: String(b.id),
						title: title,
						author: author,
						year: b.y ? String(b.y) : '',
						tl: title.toLowerCase(),
						search: (title + ' ' + author).toLowerCase(),
						item: null,
					});
				});
				books = out;
				var cb = booksWaiting;
				booksWaiting = null;
				if (cb) cb();
			})
			.catch(function () {
				booksLoading = false;
				booksFailed = true;
			});
	}

	function bookItem(b) {
		if (!b.item) {
			b.item = makeItem('Bookshelf', b.title, b.author, b.author || b.year, function () {
				goHash('#/bookshelf/' + encodeURIComponent(b.id));
			});
		}
		return b.item;
	}

	// Books whose title+author contain every word of q. Title prefix matches
	// first, then title substring, then the rest; ties keep shelf order.
	function matchBooks(q, pool) {
		var words = q.split(' ');
		var hits = [];
		pool.forEach(function (b, i) {
			for (var w = 0; w < words.length; w++) {
				if (b.search.indexOf(words[w]) === -1) return;
			}
			var at = b.tl.indexOf(q);
			hits.push({ book: b, score: at === 0 ? 0 : at !== -1 ? 1 : 2, index: i });
		});
		hits.sort(function (a, b) {
			return a.score - b.score || a.index - b.index;
		});
		return hits.map(function (h) {
			return h.book;
		});
	}

	function normQuery(query) {
		return (query || '').trim().toLowerCase().replace(/\s+/g, ' ');
	}

	// Brings bookMatches up to date for the query. Any change is a scan of the
	// library, so it waits for a pause in typing; the list is then re-rendered
	// with the Bookshelf group in place.
	function updateBooks(query) {
		var q = normQuery(query);
		clearTimeout(bookTimer);
		if (q === bookQuery) return;
		if (q.length < BOOK_MIN_QUERY) {
			bookQuery = '';
			bookMatches = [];
			return;
		}
		bookTimer = setTimeout(function () {
			loadBooks(function () {
				if (!isOpen || normQuery(input.value) !== q) return;
				bookMatches = matchBooks(q, books);
				bookQuery = q;
				render(input.value, true);
			});
		}, BOOK_DEBOUNCE_MS);
	}

	// Runtime actions (gadgets). Returns a function that removes them again.
	function addActions(actions) {
		var added = (actions || []).map(function (a) {
			return makeItem('Actions', a.label, a.keywords, a.hint, a.run);
		});
		actionItems = actionItems.concat(added);
		if (isOpen) render(input.value);
		return function () {
			actionItems = actionItems.filter(function (it) {
				return added.indexOf(it) === -1;
			});
			if (isOpen) render(input.value);
		};
	}

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

	var storiesLoaded = false;
	var storiesLoading = false;

	// Paper Theatre stories (misc/55-paper-theatre). The manifest is generated by
	// scripts/build-vn-index.mjs; if it is missing or unreadable the group is
	// simply absent. Drafts never appear here; embargoed stories are hinted.
	function loadStories(done) {
		if (storiesLoaded || storiesLoading || !window.fetch) return;
		storiesLoading = true;
		fetch(STORIES_INDEX)
			.then(function (r) {
				return r.ok ? r.json() : [];
			})
			.then(function (data) {
				var entries = Array.isArray(data) ? data : [];
				storyItems = [];
				entries.forEach(function (s) {
					if (!s || !s.id || !s.title) return;
					var status = String(s.status || 'draft');
					if (status === 'draft') return;
					var id = String(s.id);
					var title = String(s.title);
					var hint = status === 'embargo' ? 'coming soon' : s.kind === 'blog' ? 'from a post' : 'from a paper';
					var keywords = [s.kind, s.source, s.pub, s.slug, s.authors, s.blurb, 'visual novel story'].join(' ');
					storyItems.push(
						makeItem('Stories', 'Play: ' + title, keywords, hint, function () {
							openExternal(THEATRE_URL + '?story=' + encodeURIComponent(id));
						})
					);
				});
				storiesLoaded = true;
				storiesLoading = false;
				if (done) done();
			})
			.catch(function () {
				storiesLoading = false;
			});
	}

	function listed(it) {
		if (!it.when) return true;
		try {
			return !!it.when();
		} catch (e) {
			return false;
		}
	}

	// What an empty query shows: the short lists only.
	function baseItems() {
		return sectionItems.concat(postItems, storyItems, linkItems, actionItems).filter(listed);
	}

	// What a query searches (books are matched separately, see updateBooks).
	function allItems() {
		return sectionItems.concat(domItems, postItems, storyItems, linkItems, actionItems).filter(listed);
	}

	// Case-insensitive match: every whitespace-separated word of the query must
	// appear in label+keywords. Label prefix matches rank first, then label
	// substring matches, then keyword-only matches; ties keep list order.
	//
	// Results stay together by group. Within a group they are ranked as above
	// and cut to the group's cap; the groups themselves are ordered by their
	// best match, ties in GROUP_ORDER.
	function filterItems(query) {
		var q = normQuery(query);
		if (!q) return baseItems();

		var words = q.split(' ');
		var groups = {};
		function add(it, score, index) {
			var g = groups[it.group] || (groups[it.group] = { name: it.group, best: 3, rows: [] });
			g.rows.push({ item: it, score: score, index: index });
			if (score < g.best) g.best = score;
		}

		allItems().forEach(function (it, i) {
			for (var w = 0; w < words.length; w++) {
				if (it.search.indexOf(words[w]) === -1) return;
			}
			var at = it.labelLower.indexOf(q);
			add(it, at === 0 ? 0 : at !== -1 ? 1 : 2, i);
		});

		if (bookQuery === q) {
			bookMatches.slice(0, GROUP_CAPS.Bookshelf).forEach(function (b, i) {
				var at = b.tl.indexOf(q);
				add(bookItem(b), at === 0 ? 0 : at !== -1 ? 1 : 2, i);
			});
		}

		function rank(name) {
			var i = GROUP_ORDER.indexOf(name);
			return i === -1 ? GROUP_ORDER.length : i;
		}
		var out = [];
		Object.keys(groups)
			.map(function (k) {
				return groups[k];
			})
			.sort(function (a, b) {
				return a.best - b.best || rank(a.name) - rank(b.name);
			})
			.forEach(function (g) {
				g.rows.sort(function (a, b) {
					return a.score - b.score || a.index - b.index;
				});
				var cap = GROUP_CAPS[g.name] || g.rows.length;
				g.rows.slice(0, cap).forEach(function (r) {
					out.push(r.item);
				});
			});
		return out;
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
		input.setAttribute('placeholder', 'Search papers, books, toys, posts…');
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
			updateBooks(input.value);
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

	// keep: a late re-render (books arriving) must not move the selection off
	// the row the reader has already arrowed to.
	function render(query, keep) {
		var held = keep && selected > 0 ? results[selected] : null;
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

		var at = held ? results.indexOf(held) : -1;
		if (at > 0) select(at);
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
		indexDom();
		lastFocused = document.activeElement;
		isOpen = true;

		document.body.classList.add('palette-is-open');
		backdrop.classList.add('is-open');
		dialog.classList.add('is-open');

		input.value = '';
		updateBooks('');
		render('');
		input.focus();

		loadPosts(function () {
			if (isOpen) render(input.value);
		});
		loadStories(function () {
			if (isOpen) render(input.value);
		});
	}

	function close() {
		if (!isOpen) return;
		isOpen = false;
		clearTimeout(bookTimer);
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

	// ?paletteDebug=<query>: open on load with the query typed.
	function debugOpen() {
		var m = /[?&]paletteDebug(?:=([^&#]*))?(?:&|#|$)/.exec(window.location.search || '');
		if (!m) return;
		var q = '';
		try {
			q = decodeURIComponent((m[1] || '').replace(/\+/g, ' '));
		} catch (e) {
			q = m[1] || '';
		}
		open();
		input.value = q;
		updateBooks(q);
		render(q);
	}

	function boot() {
		bindTrigger();
		debugOpen();
	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', boot);
	} else {
		boot();
	}

	window.Palette = { open: open, close: close, toggle: toggle, addActions: addActions };
})();
