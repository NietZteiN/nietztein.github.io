// Markdown blog: renders the post list and individual posts inside #postsContent.
//
// Data flow:
//   blog/index.json  ->  list view  (grouped by year, one card per post)
//   blog/posts/*.md  ->  post view  (marked -> DOMPurify -> highlight.js + KaTeX)
//
// Routing is owned by main.js:
//   #/blog            -> Blog.renderList()
//   #/post/<slug>     -> Blog.renderPost(slug)

(function () {
	'use strict';

	var INDEX_URL = 'blog/index.json';
	var POSTS_DIR = 'blog/posts/';
	var TAG_CLASSES = ['t-purple', 't-lime', 't-sky'];

	var HLJS_LIGHT =
		'https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11.9.0/build/styles/github.min.css';
	var HLJS_DARK =
		'https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11.9.0/build/styles/github-dark.min.css';

	var indexPromise = null;

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

	function afterRender() {
		if (window.Site && window.Site.updateProgress) window.Site.updateProgress();
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

	function cardHtml(p) {
		return (
			'<div class="blog-card mb-3" data-slug="' +
			escapeHtml(p.slug) +
			'">' +
			'<div class="blog-info">' +
			escapeHtml(formatDate(p.date)) +
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

	function renderList() {
		var v = views();
		if (!v.list || !v.post) return;
		v.post.style.display = 'none';
		v.post.innerHTML = '';
		document.title = 'Blog · Jack V. Le';

		loadIndex().then(function (posts) {
			if (!posts.length) {
				v.list.innerHTML = '<p class="mt-2">No posts yet.</p>';
				v.list.style.display = '';
				afterRender();
				return;
			}

			var byYear = {};
			posts.forEach(function (p) {
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
			v.list.innerHTML = html;
			v.list.style.display = '';
			if (window.Site) window.Site.staggerReveal(v.list, '.pub-year-h2, .blog-card');
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

	function backLink() {
		return '<p class="mb-3"><a href="#/blog" class="link-dark blog-back">← Back to posts</a></p>';
	}

	// ---- Views + comments ------------------------------------------------
	//
	// Both are optional and free, configured in assets/js/config.json:
	//   goatCounterCode -> GoatCounter (also the analytics provider) exposes a
	//                      public per-path counter; we read it back for the post.
	//   giscus          -> comments + reactions stored as GitHub Discussions.
	// With either left blank the corresponding UI simply does not appear.

	var GISCUS_ORIGIN = 'https://giscus.app';

	function siteConfig() {
		return window.Site && window.Site.config ? window.Site.config : Promise.resolve({});
	}

	function postMetaHtml(date, slug) {
		return (
			'<div class="blog-post-meta blog-info mb-4">' +
			(date ? '<span>' + escapeHtml(date) + '</span>' : '') +
			'<span class="blog-views" data-slug="' + escapeHtml(slug) + '" hidden></span>' +
			'</div>'
		);
	}

	// GoatCounter: GET https://<code>.goatcounter.com/counter/<url-encoded path>.json
	// -> { "count": "1 234" }. Requires "Allow adding visitor counts on your
	// website" to be ticked in the GoatCounter site settings.
	function loadViewCount(el, slug) {
		if (!el) return;
		siteConfig().then(function (cfg) {
			if (!cfg.goatCounterCode) return;
			var path = '/post/' + slug; // must match trackPageView() in main.js
			var url =
				'https://' +
				cfg.goatCounterCode +
				'.goatcounter.com/counter/' +
				encodeURIComponent(path) +
				'.json';
			fetch(url)
				.then(function (r) {
					return r.ok ? r.json() : null;
				})
				.then(function (data) {
					if (!data || data.count == null) return;
					var n = parseInt(String(data.count).replace(/[^\d]/g, ''), 10);
					if (isNaN(n)) return;
					el.textContent = n.toLocaleString('en-US') + (n === 1 ? ' view' : ' views');
					el.hidden = false;
				})
				.catch(function () {
					/* counter unavailable: leave hidden */
				});
		});
	}

	// giscus: each post maps to one Discussion whose title is the post slug
	// ("specific" mapping). Pathname mapping would not work here because the
	// site uses hash routes, so every post would share a single thread.
	function loadComments(el, slug) {
		if (!el) return;
		siteConfig().then(function (cfg) {
			var g = cfg.giscus;
			if (!g || !g.repo || !g.repoId || !g.category || !g.categoryId) return;
			if (!el.isConnected) return; // user navigated away before config arrived

			var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
			var s = document.createElement('script');
			s.src = GISCUS_ORIGIN + '/client.js';
			s.async = true;
			s.crossOrigin = 'anonymous';
			var attrs = {
				'data-repo': g.repo,
				'data-repo-id': g.repoId,
				'data-category': g.category,
				'data-category-id': g.categoryId,
				'data-mapping': 'specific',
				'data-term': slug,
				'data-strict': '1',
				'data-reactions-enabled': '1',
				'data-emit-metadata': '0',
				'data-input-position': 'bottom',
				'data-theme': isDark ? 'dark' : 'light',
				'data-lang': 'en',
				'data-loading': 'lazy',
			};
			Object.keys(attrs).forEach(function (k) {
				s.setAttribute(k, attrs[k]);
			});
			el.innerHTML = '<h2 class="blog-comments-title">Comments</h2>';
			el.appendChild(s);
		});
	}

	function setGiscusTheme(isDark) {
		var iframe = document.querySelector('iframe.giscus-frame');
		if (!iframe || !iframe.contentWindow) return;
		iframe.contentWindow.postMessage(
			{ giscus: { setConfig: { theme: isDark ? 'dark' : 'light' } } },
			GISCUS_ORIGIN
		);
	}

	function renderPost(slug) {
		var v = views();
		if (!v.list || !v.post) return;

		loadIndex().then(function (posts) {
			var meta = null;
			for (var i = 0; i < posts.length; i++) {
				if (posts[i].slug === slug) {
					meta = posts[i];
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
					var rawHtml = window.marked.parse(parsed.body);
					var clean = window.DOMPurify.sanitize(rawHtml);

					document.title = title + ' · Jack V. Le';

					v.list.style.display = 'none';
					v.post.innerHTML =
						backLink() +
						'<h1 class="blog-post-title">' +
						escapeHtml(title) +
						'</h1>' +
						postMetaHtml(date, slug) +
						'<div class="blog-post-body">' +
						clean +
						'</div>' +
						'<section class="blog-comments" id="blogComments"></section>';
					v.post.style.display = '';

					decorate(v.post.querySelector('.blog-post-body'));
					loadViewCount(v.post.querySelector('.blog-views'), slug);
					loadComments(v.post.querySelector('#blogComments'), slug);
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

	// Sync the highlight.js stylesheet (and the giscus frame) to the active theme.
	function setHljsTheme(isDark) {
		var link = document.getElementById('hljs-theme');
		if (link) link.href = isDark ? HLJS_DARK : HLJS_LIGHT;
		setGiscusTheme(isDark);
	}

	window.Blog = {
		renderList: renderList,
		renderPost: renderPost,
		setHljsTheme: setHljsTheme,
	};

	if (window.marked && window.marked.setOptions) {
		window.marked.setOptions({ gfm: true, breaks: false });
	}

	// Cards are dynamic, so delegate from the document.
	document.addEventListener('click', function (e) {
		var card = e.target.closest && e.target.closest('.blog-card');
		if (!card) return;
		var slug = card.getAttribute('data-slug');
		if (slug) window.location.hash = '#/post/' + encodeURIComponent(slug);
	});
})();
