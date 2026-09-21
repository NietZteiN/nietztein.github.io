// Markdown blog: renders the post list and individual posts inside #postsContent.
//
// Data flow:
//   blog/index.json  ->  list view  (grouped by year, one card per post)
//   blog/posts/*.md  ->  post view  (marked -> DOMPurify -> highlight.js + KaTeX)
//
// Routing is owned by main.js:
//   #/blog            -> Blog.renderList()
//   #/blog?tag=x&q=y  -> Blog.renderList()  (filters are read from the hash here)
//   #/post/<slug>     -> Blog.renderPost(slug)
//
// List filters are reflected in the hash with history.replaceState so they are
// linkable without triggering a hashchange (which would re-render the list).

(function () {
	'use strict';

	var INDEX_URL = 'blog/index.json';
	var POSTS_DIR = 'blog/posts/';
	var TAG_CLASSES = ['t-purple', 't-lime', 't-sky'];
	var WORDS_PER_MINUTE = 200;
	var LIST_ROUTE = '#/blog';
	var MIN_TOC_HEADINGS = 3;
	var COPIED_MS = 1500;

	var HLJS_LIGHT =
		'https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11.9.0/build/styles/github.min.css';
	var HLJS_DARK =
		'https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11.9.0/build/styles/github-dark.min.css';

	var indexPromise = null;

	// Current list filters; also mirrored into the hash (see writeListHash).
	var listState = { q: '', tag: '' };
	// Last list hash (with filters) so "Back to posts" returns to the same view.
	var listHash = LIST_ROUTE;

	var reducedMotion =
		window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

	function loadIndex() {
		if (!indexPromise) {
			indexPromise = fetch(INDEX_URL, { cache: 'no-cache' })
				.then(function (r) {
					return r.ok ? r.json() : [];
				})
				.catch(function () {
					return [];
				});
		}
		return indexPromise;
	}

	function escapeHtml(s) {
		return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
			return {
				'&': '&amp;',
				'<': '&lt;',
				'>': '&gt;',
				'"': '&quot;',
				"'": '&#39;',
			}[c];
		});
	}

	function formatDate(iso) {
		if (!iso) return '';
		var parts = String(iso).split('-');
		if (parts.length < 3) return iso;
		var d = new Date(Date.UTC(+parts[0], +parts[1] - 1, +parts[2]));
		if (isNaN(d.getTime())) return iso;
		return d.toLocaleDateString('en-US', {
			year: 'numeric',
			month: 'long',
			day: 'numeric',
			timeZone: 'UTC',
		});
	}

	function views() {
		return {
			list: document.getElementById('blogListView'),
			post: document.getElementById('blogPostView'),
		};
	}

	function readingTime(text) {
		var words = (text || '').trim().split(/\s+/).filter(Boolean).length;
		return Math.max(1, Math.round(words / WORDS_PER_MINUTE));
	}

	function afterRender() {
		if (window.Site && window.Site.updateProgress) window.Site.updateProgress();
	}

	// ---- Hash query helpers ------------------------------------------------
	//
	// Contract:  #/blog?tag=<tag>&q=<text>   (both optional, URL-encoded)

	function safeDecode(s) {
		try {
			return decodeURIComponent(String(s).replace(/\+/g, ' '));
		} catch (e) {
			return '';
		}
	}

	// Parses "tag=x&q=y" (with or without a leading "#/blog?" / "?") into listState.
	function parseListQuery(str) {
		var out = { q: '', tag: '' };
		var s = String(str || '');
		var qi = s.indexOf('?');
		if (qi !== -1) s = s.slice(qi + 1);
		else if (s.charAt(0) === '#') s = '';
		s.split('&').forEach(function (pair) {
			if (!pair) return;
			var idx = pair.indexOf('=');
			var key = safeDecode(idx === -1 ? pair : pair.slice(0, idx));
			var val = idx === -1 ? '' : safeDecode(pair.slice(idx + 1));
			if (key === 'q') out.q = val.trim();
			else if (key === 'tag') out.tag = val.trim();
		});
		return out;
	}

	function buildListHash() {
		var parts = [];
		if (listState.tag) parts.push('tag=' + encodeURIComponent(listState.tag));
		if (listState.q) parts.push('q=' + encodeURIComponent(listState.q));
		return LIST_ROUTE + (parts.length ? '?' + parts.join('&') : '');
	}

	// Mirror the filters into the URL without firing hashchange.
	function writeListHash() {
		listHash = buildListHash();
		if (window.location.hash === listHash) return;
		try {
			history.replaceState(
				history.state,
				'',
				window.location.pathname + window.location.search + listHash
			);
		} catch (e) {
			/* ignore (e.g. sandboxed origins) */
		}
	}

	// ---- List view -------------------------------------------------------

	function tagsHtml(tags) {
		if (!tags || !tags.length) return '';
		var spans = tags
			.map(function (t, i) {
				return (
					'<span class="tag ' +
					TAG_CLASSES[i % TAG_CLASSES.length] +
					'">' +
					escapeHtml(t) +
					'</span>'
				);
			})
			.join(' ');
		return '<div class="blog-tags mt-2">' + spans + '</div>';
	}

	function minutesLabel(n) {
		var m = parseInt(n, 10);
		if (!m || m < 1) return '';
		return m + ' min read';
	}

	function cardHtml(p) {
		var info = [];
		var date = formatDate(p.date);
		var mins = minutesLabel(p.minutes);
		if (date) info.push(escapeHtml(date));
		if (mins) info.push('<span class="blog-minutes">' + escapeHtml(mins) + '</span>');
		return (
			'<div class="blog-card mb-3" tabindex="0" role="link" data-slug="' +
			escapeHtml(p.slug) +
			'">' +
			'<div class="blog-info">' +
			info.join(' · ') +
			'</div>' +
			'<div class="lucida-console h5 mb-1">' +
			escapeHtml(p.title) +
			'</div>' +
			'<div class="blog-short">' +
			escapeHtml(p.summary || '') +
			'</div>' +
			tagsHtml(p.tags) +
			'</div>'
		);
	}

	function allTags(posts) {
		var seen = {};
		var tags = [];
		posts.forEach(function (p) {
			(p.tags || []).forEach(function (t) {
				var key = String(t).toLowerCase();
				if (!key || seen[key]) return;
				seen[key] = true;
				tags.push(String(t));
			});
		});
		tags.sort(function (a, b) {
			return a.toLowerCase().localeCompare(b.toLowerCase());
		});
		return tags;
	}

	function chipHtml(tag, label, active) {
		return (
			'<button type="button" class="blog-chip' +
			(active ? ' is-active' : '') +
			'" data-tag="' +
			escapeHtml(tag) +
			'" aria-pressed="' +
			(active ? 'true' : 'false') +
			'">' +
			escapeHtml(label) +
			'</button>'
		);
	}

	function controlsHtml(tags) {
		var chips = chipHtml('', 'All', !listState.tag);
		tags.forEach(function (t) {
			chips += chipHtml(t, t, t.toLowerCase() === listState.tag.toLowerCase());
		});
		return (
			'<div class="blog-controls">' +
			'<input type="search" class="blog-search" placeholder="Search posts…" ' +
			'aria-label="Search posts" autocomplete="off" spellcheck="false" value="' +
			escapeHtml(listState.q) +
			'">' +
			(tags.length
				? '<div class="blog-chips" role="group" aria-label="Filter by tag">' + chips + '</div>'
				: '') +
			'</div>'
		);
	}

	function postMatches(p) {
		if (listState.tag) {
			var want = listState.tag.toLowerCase();
			var has = (p.tags || []).some(function (t) {
				return String(t).toLowerCase() === want;
			});
			if (!has) return false;
		}
		if (listState.q) {
			var hay = (
				(p.title || '') +
				' ' +
				(p.summary || '') +
				' ' +
				(p.tags || []).join(' ')
			).toLowerCase();
			if (hay.indexOf(listState.q.toLowerCase()) === -1) return false;
		}
		return true;
	}

	function groupsHtml(posts) {
		var shown = posts.filter(postMatches);
		if (!shown.length) return '<p class="blog-empty mt-3">No posts match.</p>';

		var byYear = {};
		shown.forEach(function (p) {
			var year = (p.date || '').slice(0, 4) || '—';
			(byYear[year] = byYear[year] || []).push(p);
		});

		var years = Object.keys(byYear).sort().reverse();
		var html = '';
		years.forEach(function (year) {
			html += '<div class="row mt-3"><h2 class="pub-year-h2">' + escapeHtml(year) + '</h2>';
			byYear[year].forEach(function (p) {
				html += cardHtml(p);
			});
			html += '</div>';
		});
		return html;
	}

	// Re-render only the year groups (keeps the search box and its focus intact).
	function renderGroups(listEl, posts) {
		var groups = listEl.querySelector('.blog-groups');
		if (!groups) return;
		groups.innerHTML = groupsHtml(posts);
		if (window.Site) window.Site.staggerReveal(groups, '.pub-year-h2, .blog-card');
		afterRender();
	}

	function syncChips(listEl) {
		var want = listState.tag.toLowerCase();
		listEl.querySelectorAll('.blog-chip').forEach(function (chip) {
			var active = (chip.getAttribute('data-tag') || '').toLowerCase() === want;
			chip.classList.toggle('is-active', active);
			chip.setAttribute('aria-pressed', active ? 'true' : 'false');
		});
	}

	function bindControls(listEl, posts) {
		var input = listEl.querySelector('.blog-search');
		if (input) {
			input.addEventListener('input', function () {
				listState.q = input.value.trim();
				writeListHash();
				renderGroups(listEl, posts);
			});
			input.addEventListener('keydown', function (e) {
				if (e.key === 'Escape' && input.value) {
					input.value = '';
					listState.q = '';
					writeListHash();
					renderGroups(listEl, posts);
				}
			});
		}
		var chips = listEl.querySelector('.blog-chips');
		if (chips) {
			chips.addEventListener('click', function (e) {
				var chip = e.target.closest && e.target.closest('.blog-chip');
				if (!chip) return;
				var tag = chip.getAttribute('data-tag') || '';
				listState.tag = tag && tag.toLowerCase() === listState.tag.toLowerCase() ? '' : tag;
				syncChips(listEl);
				writeListHash();
				renderGroups(listEl, posts);
			});
		}
	}

	// `query` is optional: "tag=x&q=y", "?tag=x" or a full "#/blog?tag=x" hash.
	// When omitted the filters are read from window.location.hash.
	function renderList(query) {
		var v = views();
		if (!v.list || !v.post) return;
		v.post.style.display = 'none';
		v.post.innerHTML = '';
		document.title = 'Blog · Jack V. Le';

		listState = parseListQuery(
			typeof query === 'string' && query ? query : window.location.hash
		);
		listHash = buildListHash();

		loadIndex().then(function (posts) {
			if (!posts.length) {
				v.list.innerHTML = '<p class="mt-2">No posts yet.</p>';
				v.list.style.display = '';
				afterRender();
				return;
			}

			var tags = allTags(posts);
			// Drop a tag from the URL that no post has, so the chips stay honest.
			if (
				listState.tag &&
				!tags.some(function (t) {
					return t.toLowerCase() === listState.tag.toLowerCase();
				})
			) {
				listState.tag = '';
				writeListHash();
			}

			v.list.innerHTML = controlsHtml(tags) + '<div class="blog-groups"></div>';
			v.list.style.display = '';
			bindControls(v.list, posts);

			var groups = v.list.querySelector('.blog-groups');
			groups.innerHTML = groupsHtml(posts);
			if (window.Site) {
				window.Site.staggerReveal(v.list, '.blog-controls, .pub-year-h2, .blog-card');
			}
			afterRender();
		});
	}

	// ---- Post view -------------------------------------------------------

	// Split a raw .md file into { fm, body }, parsing simple front matter.
	function parsePost(text) {
		var fm = {};
		var body = text;
		var m = /^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?/.exec(text);
		if (m) {
			body = text.slice(m[0].length);
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

	function decorate(container) {
		if (!container) return;
		if (window.hljs) {
			container.querySelectorAll('pre code').forEach(function (el) {
				try {
					window.hljs.highlightElement(el);
				} catch (e) {
					/* ignore */
				}
			});
		}
		if (window.renderMathInElement) {
			try {
				window.renderMathInElement(container, {
					delimiters: [
						{ left: '$$', right: '$$', display: true },
						{ left: '$', right: '$', display: false },
						{ left: '\\(', right: '\\)', display: false },
						{ left: '\\[', right: '\\]', display: true },
					],
					throwOnError: false,
				});
			} catch (e) {
				/* ignore */
			}
		}
	}

	// ---- Table of contents ----

	function slugify(text) {
		return (
			String(text || '')
				.toLowerCase()
				.replace(/[^a-z0-9À-ɏ\s-]/g, '')
				.trim()
				.replace(/[\s-]+/g, '-')
				.replace(/^-+|-+$/g, '') || 'section'
		);
	}

	// Gives every h2/h3 a unique id; returns the headings (in document order).
	function assignHeadingIds(body) {
		var used = {};
		var headings = Array.prototype.slice.call(body.querySelectorAll('h2, h3'));
		headings.forEach(function (h) {
			var base = slugify(h.textContent);
			var id = base;
			var n = 2;
			var other = document.getElementById(id);
			// Avoid clashes within the post and with any other element on the page
			// (the heading's own pre-existing id is not a clash).
			while (used[id] || (other && other !== h)) {
				id = base + '-' + n++;
				other = document.getElementById(id);
			}
			used[id] = true;
			h.id = id;
		});
		return headings;
	}

	function tocLinkHtml(h) {
		return (
			'<button type="button" class="blog-toc-link" data-target="' +
			escapeHtml(h.id) +
			'">' +
			escapeHtml(h.textContent) +
			'</button>'
		);
	}

	// h2s are top-level items; h3s nest under the preceding h2.
	function tocHtml(headings) {
		var html = '<nav class="blog-toc" aria-label="Contents">';
		html += '<div class="blog-toc-label">Contents</div><ol class="blog-toc-list">';
		var openSub = false;
		var openItem = false;
		headings.forEach(function (h) {
			var level = h.tagName.toLowerCase();
			if (level === 'h2') {
				if (openSub) html += '</ol>';
				if (openItem) html += '</li>';
				html += '<li>' + tocLinkHtml(h);
				openItem = true;
				openSub = false;
			} else {
				if (!openItem) {
					// h3 before any h2: promote it to a top-level item.
					html += '<li>' + tocLinkHtml(h);
					openItem = true;
					return;
				}
				if (!openSub) {
					html += '<ol>';
					openSub = true;
				}
				html += '<li>' + tocLinkHtml(h) + '</li>';
			}
		});
		if (openSub) html += '</ol>';
		if (openItem) html += '</li>';
		html += '</ol></nav>';
		return html;
	}

	function scrollToHeading(id) {
		var el = document.getElementById(id);
		if (!el) return;
		el.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' });
	}

	// ---- Copy buttons on code blocks ----

	function addCopyButtons(body) {
		body.querySelectorAll('pre').forEach(function (pre) {
			if (pre.querySelector('.copy-btn')) return;
			var btn = document.createElement('button');
			btn.type = 'button';
			btn.className = 'copy-btn';
			btn.textContent = 'Copy';
			btn.setAttribute('aria-label', 'Copy code');
			pre.appendChild(btn);
		});
	}

	function copyText(text) {
		if (navigator.clipboard && navigator.clipboard.writeText) {
			return navigator.clipboard.writeText(text);
		}
		// Fallback for insecure contexts / older browsers.
		return new Promise(function (resolve, reject) {
			var ta = document.createElement('textarea');
			ta.value = text;
			ta.setAttribute('readonly', '');
			ta.style.position = 'fixed';
			ta.style.top = '-1000px';
			document.body.appendChild(ta);
			ta.select();
			var ok = false;
			try {
				ok = document.execCommand('copy');
			} catch (e) {
				ok = false;
			}
			document.body.removeChild(ta);
			ok ? resolve() : reject(new Error('copy failed'));
		});
	}

	function handleCopyClick(btn) {
		var pre = btn.closest('pre');
		if (!pre) return;
		var code = pre.querySelector('code');
		var text = code ? code.textContent : '';
		if (!code) {
			// No <code> child: take everything except the button itself.
			var clone = pre.cloneNode(true);
			var b = clone.querySelector('.copy-btn');
			if (b) clone.removeChild(b);
			text = clone.textContent;
		}
		copyText(text)
			.then(function () {
				btn.textContent = 'Copied';
				btn.classList.add('is-copied');
				clearTimeout(btn._copyTimer);
				btn._copyTimer = setTimeout(function () {
					btn.textContent = 'Copy';
					btn.classList.remove('is-copied');
				}, COPIED_MS);
			})
			.catch(function () {
				btn.textContent = 'Failed';
				clearTimeout(btn._copyTimer);
				btn._copyTimer = setTimeout(function () {
					btn.textContent = 'Copy';
				}, COPIED_MS);
			});
	}

	// ---- Previous / next ----

	function postHref(p) {
		return '#/post/' + encodeURIComponent(p.slug);
	}

	// `posts` is newest-first: the previous entry is newer, the next is older.
	function pagerHtml(posts, idx) {
		if (idx < 0) return '';
		var newer = idx > 0 ? posts[idx - 1] : null;
		var older = idx < posts.length - 1 ? posts[idx + 1] : null;
		if (!newer && !older) return '';
		var html = '<nav class="blog-pager" aria-label="Post navigation">';
		if (newer) {
			html +=
				'<a class="blog-pager-link blog-pager-newer" href="' +
				escapeHtml(postHref(newer)) +
				'" rel="prev">' +
				'<span class="blog-pager-label">← Newer</span>' +
				'<span class="blog-pager-title">' +
				escapeHtml(newer.title) +
				'</span></a>';
		}
		if (older) {
			html +=
				'<a class="blog-pager-link blog-pager-older" href="' +
				escapeHtml(postHref(older)) +
				'" rel="next">' +
				'<span class="blog-pager-label">Older →</span>' +
				'<span class="blog-pager-title">' +
				escapeHtml(older.title) +
				'</span></a>';
		}
		html += '</nav>';
		return html;
	}

	// Optional: show the GoatCounter view count for this post (needs
	// "Allow adding visitor counts on your website" enabled in GoatCounter).
	function loadViewCount(slug, el) {
		var code = window.GOATCOUNTER_CODE;
		if (!code || !el) return;
		var url = 'https://' + code + '.goatcounter.com/counter//post/' + encodeURIComponent(slug) + '.json';
		fetch(url)
			.then(function (r) {
				return r.ok ? r.json() : null;
			})
			.then(function (data) {
				if (!data || data.count == null) return;
				var n = String(data.count).trim();
				el.textContent = n + (n === '1' ? ' view' : ' views');
			})
			.catch(function () {});
	}

	function backLink() {
		return (
			'<p class="mb-3"><a href="' +
			escapeHtml(listHash || LIST_ROUTE) +
			'" class="link-dark blog-back">← Back to posts</a></p>'
		);
	}

	function renderPost(slug) {
		var v = views();
		if (!v.list || !v.post) return;

		loadIndex().then(function (posts) {
			var meta = null;
			var idx = -1;
			for (var i = 0; i < posts.length; i++) {
				if (posts[i].slug === slug) {
					meta = posts[i];
					idx = i;
					break;
				}
			}
			var file = meta ? meta.file : slug + '.md';

			return fetch(POSTS_DIR + file, { cache: 'no-cache' })
				.then(function (r) {
					if (!r.ok) throw new Error('not found');
					return r.text();
				})
				.then(function (text) {
					var parsed = parsePost(text);
					var title = (meta && meta.title) || parsed.fm.title || slug;
					var date = formatDate((meta && meta.date) || parsed.fm.date);
					var minutes =
						(meta && parseInt(meta.minutes, 10) > 0 && parseInt(meta.minutes, 10)) ||
						readingTime(parsed.body);
					var rawHtml = window.marked.parse(parsed.body);
					var clean = window.DOMPurify.sanitize(rawHtml);

					document.title = title + ' · Jack V. Le';

					v.list.style.display = 'none';
					v.post.innerHTML =
						backLink() +
						'<h1 class="blog-post-title">' +
						escapeHtml(title) +
						'</h1>' +
						'<div class="blog-post-meta mb-4">' +
						(date ? '<span>' + escapeHtml(date) + '</span>' : '') +
						'<span>' + minutes + ' min read</span>' +
						'<span class="blog-views"></span>' +
						'</div>' +
						'<div class="blog-post-body">' +
						clean +
						'</div>' +
						pagerHtml(posts, idx);
					v.post.style.display = '';

					var body = v.post.querySelector('.blog-post-body');
					var metaEl = v.post.querySelector('.blog-post-meta');
					decorate(body);

					// Heading ids + table of contents.
					var headings = assignHeadingIds(body);
					if (headings.length >= MIN_TOC_HEADINGS && metaEl) {
						metaEl.insertAdjacentHTML('afterend', tocHtml(headings));
					}
					addCopyButtons(body);

					loadViewCount(slug, v.post.querySelector('.blog-views'));
					if (window.Site) {
						window.Site.staggerReveal(
							v.post,
							'.blog-post-title, .blog-post-meta, .blog-toc, .blog-post-body, .blog-pager'
						);
					}
					window.scrollTo({ top: 0, behavior: 'auto' });
					afterRender();
				})
				.catch(function () {
					document.title = 'Post not found · Jack V. Le';
					v.list.style.display = 'none';
					v.post.innerHTML = backLink() + '<p>Sorry, that post could not be found.</p>';
					v.post.style.display = '';
					afterRender();
				});
		});
	}

	// ---- Theme hook + public API ------------------------------------------

	// Sync the highlight.js stylesheet to the active theme.
	function setHljsTheme(isDark) {
		var link = document.getElementById('hljs-theme');
		if (link) link.href = isDark ? HLJS_DARK : HLJS_LIGHT;
	}

	window.Blog = {
		renderList: renderList,
		renderPost: renderPost,
		setHljsTheme: setHljsTheme,
	};

	if (window.marked && window.marked.setOptions) {
		window.marked.setOptions({ gfm: true, breaks: false });
	}

	function openCard(card) {
		var slug = card.getAttribute('data-slug');
		if (slug) window.location.hash = '#/post/' + encodeURIComponent(slug);
	}

	// Cards, TOC links and copy buttons are dynamic, so delegate from the document.
	document.addEventListener('click', function (e) {
		if (!e.target.closest) return;

		var toc = e.target.closest('.blog-toc-link');
		if (toc) {
			e.preventDefault();
			scrollToHeading(toc.getAttribute('data-target'));
			return;
		}

		var copy = e.target.closest('.copy-btn');
		if (copy) {
			e.preventDefault();
			handleCopyClick(copy);
			return;
		}

		var card = e.target.closest('.blog-card');
		if (card) openCard(card);
	});
	document.addEventListener('keydown', function (e) {
		if (e.key !== 'Enter' && e.key !== ' ') return;
		var card = e.target.closest && e.target.closest('.blog-card');
		if (card) {
			e.preventDefault();
			openCard(card);
		}
	});
})();
