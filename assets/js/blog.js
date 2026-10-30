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

	var indexPromise = null;
	var requestId = 0;
	var lastListHref = '#/blog';
	var savedListPosition = null;
	var pendingListOffset = null;
	var interactionVersion = 0;

	function loadIndex() {
		if (!indexPromise) {
			indexPromise = fetch(INDEX_URL, { cache: 'no-cache' })
				.then(function (r) {
					if (!r.ok) throw new Error('index unavailable');
					return r.json();
				})
				.then(function (posts) {
					if (!Array.isArray(posts)) throw new Error('invalid index');
					return posts.slice().sort(function (a, b) {
						return String(b.date || '').localeCompare(String(a.date || ''));
					});
				})
				.catch(function (error) {
					indexPromise = null;
					throw error;
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

	function postHref(slug, heading) {
		return '#/post/' + encodeURIComponent(slug) + (heading ? '?section=' + encodeURIComponent(heading) : '');
	}

	function articleHref(slug) {
		return 'writing/' + encodeURIComponent(slug) + '/';
	}

	function postRendered(host, slug) {
		document.dispatchEvent(new CustomEvent('blog:render', { detail: { host: host, slug: slug } }));
	}

	function postRoute() {
		var match = /^#\/post\/([^?]+)(?:\?(.*))?$/.exec(window.location.hash);
		if (!match) return null;
		try {
			return { slug: decodeURIComponent(match[1]), section: new URLSearchParams(match[2] || '').get('section') || '' };
		} catch (e) {
			return null;
		}
	}

	function onPost(slug) {
		var route = postRoute();
		return route && route.slug === slug;
	}

	function onList() {
		return /^#\/blog(?:\?|\/?$)/.test(window.location.hash);
	}

	function selectedTag() {
		var query = window.location.hash.split('?')[1] || '';
		return new URLSearchParams(query).get('tag') || '';
	}

	function selectedFormat() {
		var value = new URLSearchParams(window.location.hash.split('?')[1] || '').get('format');
		return value === 'note' || value === 'article' ? value : '';
	}

	function tagHref(tag, format) {
		if (format === undefined) format = selectedFormat();
		var query = [];
		if (format) query.push('format=' + encodeURIComponent(format));
		if (tag) query.push('tag=' + encodeURIComponent(tag));
		return '#/blog' + (query.length ? '?' + query.join('&') : '');
	}

	function matchesFormat(post, format) {
		return !format || (post.kind === 'note' ? 'note' : 'article') === format;
	}

	function kindBadge(kind) {
		return kind === 'note' ? '<span class="blog-kind-badge">Short note</span>' : '';
	}

	function retryHtml() {
		return '<button type="button" class="blog-reader-button blog-retry">Try again</button>';
	}

	function positionList(list, request, offset, interaction) {
		function align() {
			if (request !== requestId || !onList() || interaction !== interactionVersion) return;
			var top = 0;
			if (offset !== null) {
				top = list.getBoundingClientRect().top + window.pageYOffset + offset;
			} else if (window.innerWidth < 768) {
				var header = document.querySelector('.site-header');
				top = list.getBoundingClientRect().top + window.pageYOffset - (header ? header.offsetHeight : 70) - 16;
			}
			window.scrollTo({ top: Math.max(0, top), behavior: 'auto' });
		}
		align();
		// On a direct mobile visit the profile sits above the list. Its image and
		// fonts can settle after the posts arrive; keep the list in view until the
		// visitor starts interacting, then leave their position alone.
		if (document.fonts && document.fonts.ready) document.fonts.ready.then(align);
		var portrait = document.querySelector('#leftPanel .profilepicture');
		if (portrait && !portrait.complete) {
			portrait.addEventListener('load', align, { once: true });
			portrait.addEventListener('error', align, { once: true });
		}
	}

	// ---- List view -------------------------------------------------------

	function tagsHtml(tags, format) {
		if (!tags || !tags.length) return '';
		var spans = tags
			.map(function (t, i) {
				return (
					'<a href="' + escapeHtml(tagHref(t, format)) + '" class="tag ' +
					TAG_CLASSES[i % TAG_CLASSES.length] +
					'">' +
					escapeHtml(t) +
					'</a>'
				);
			})
			.join(' ');
		return '<div class="blog-tags mt-2">' + spans + '</div>';
	}

	function cardHtml(p, format) {
		return (
			'<article class="blog-card mb-3" data-slug="' +
			escapeHtml(p.slug) +
			'" data-post-kind="' + (p.kind === 'note' ? 'note' : 'article') + '">' +
			'<div class="blog-info">' +
			escapeHtml(formatDate(p.date)) +
			kindBadge(p.kind) +
			'</div>' +
			'<h3 class="lucida-console h5 mb-1"><a class="blog-card-title" href="' + escapeHtml(postHref(p.slug)) + '">' +
			escapeHtml(p.title) +
			'</a></h3>' +
			'<div class="blog-short">' +
			escapeHtml(p.summary || '') +
			'</div>' +
			'<div class="blog-card-play"></div>' +
			tagsHtml(p.tags, format) +
			'</article>'
		);
	}

	function listTools(posts, tag, format) {
		var counts = Object.create(null);
		posts.forEach(function (p) {
			if (!matchesFormat(p, format)) return;
			(p.tags || []).forEach(function (t) { counts[t] = (counts[t] || 0) + 1; });
		});
		var tags = Object.keys(counts).sort();
		var formatCount = posts.filter(function (p) { return matchesFormat(p, format); }).length;
		var options = '<option value="">All topics (' + formatCount + ')</option>';
		if (tag && tags.indexOf(tag) === -1) tags.push(tag);
		tags.forEach(function (t) {
			options += '<option value="' + escapeHtml(t) + '"' + (t === tag ? ' selected' : '') + '>' +
				escapeHtml(t) + ' (' + (counts[t] || 0) + ')</option>';
		});
		var formatPosts = posts.filter(function (p) { return !tag || (p.tags || []).indexOf(tag) !== -1; });
		var formats = [{ value: '', label: 'All' }, { value: 'article', label: 'Articles' }, { value: 'note', label: 'Short notes' }];
		var formatLinks = formats.map(function (item) {
			var count = formatPosts.filter(function (p) { return matchesFormat(p, item.value); }).length;
			return '<a class="blog-format-link" id="blog-format-' + (item.value || 'all') + '" href="' + escapeHtml(tagHref(tag, item.value)) + '"' +
				(item.value === format ? ' aria-current="page"' : '') + '>' + item.label + ' <span>' + count + '</span></a>';
		}).join('');
		return '<div class="blog-list-heading"><div><h1 class="blog-list-title">Blog</h1>' +
			'<p class="blog-list-intro">Writing on language, models, and the questions around them.</p>' +
			'<a class="blog-subscribe" href="feed.xml">Follow via RSS <span aria-hidden="true">↗</span></a></div>' +
			'<div class="blog-filter"><label for="blog-tag-filter">Topic</label>' +
			'<select id="blog-tag-filter">' + options + '</select></div></div>' +
			'<nav class="blog-format-filters" aria-label="Writing format">' + formatLinks + '</nav>' +
			(tag ? '<p class="blog-filter-note">Showing ' + escapeHtml(tag) + ' <a href="' + escapeHtml(tagHref('', format)) + '">Clear topic</a></p>' : '');
	}

	function emptyListHtml(tag, format) {
		var text = format === 'note' ? (tag ? 'No short notes match this topic yet.' : 'No short notes have been published yet.') :
			format === 'article' ? (tag ? 'No articles match this topic yet.' : 'No articles have been published yet.') :
			tag ? 'No posts have this topic yet.' : 'No posts yet.';
		return '<p class="blog-empty">' + text + ' <a href="#/blog">Browse all writing</a>.</p>';
	}

	function renderList() {
		var v = views();
		if (!v.list || !v.post) return;
		var request = ++requestId;
		var tag = selectedTag();
		var format = selectedFormat();
		var offset = pendingListOffset;
		pendingListOffset = null;
		var interaction = interactionVersion;
		lastListHref = tagHref(tag, format);
		var activeId = document.activeElement && document.activeElement.id;
		var restoreControlFocus = activeId === 'blog-tag-filter' || /^blog-format-(all|article|note)$/.test(activeId || '') ? activeId : '';
		v.post.style.display = 'none';
		v.post.innerHTML = '';
		v.post.removeAttribute('data-rendered-slug');
		v.list.style.display = '';
		v.list.setAttribute('aria-busy', 'true');
		v.list.innerHTML = '<p class="blog-loading" role="status">Loading posts…</p>';
		document.title = 'Blog · Jack V. Le';

		loadIndex().then(function (posts) {
			if (request !== requestId || !onList()) return;
			v.list.removeAttribute('aria-busy');
			var byYear = {};
			posts.forEach(function (p) {
				if (!matchesFormat(p, format)) return;
				if (tag && (p.tags || []).indexOf(tag) === -1) return;
				var year = (p.date || '').slice(0, 4) || '—';
				(byYear[year] = byYear[year] || []).push(p);
			});

			var years = Object.keys(byYear).sort().reverse();
			var html = listTools(posts, tag, format);
			if (!years.length) html += emptyListHtml(tag, format);
			years.forEach(function (year) {
				html += '<div class="row mt-3"><h2 class="pub-year-h2">' + escapeHtml(year) + '</h2>';
				byYear[year].forEach(function (p) {
					html += cardHtml(p, format);
				});
				html += '</div>';
			});
			v.list.innerHTML = html;
			v.list.style.display = '';
			if (restoreControlFocus && document.activeElement === document.body) {
				try { document.getElementById(restoreControlFocus).focus({ preventScroll: true }); }
				catch (e) { document.getElementById(restoreControlFocus).focus(); }
			}
			postRendered(v.list, '');
			if (window.Site) window.Site.staggerReveal(v.list, '.pub-year-h2, .blog-card');
			loadListStoryLinks(v.list);
			positionList(v.list, request, offset, interaction);
			afterRender();
		}).catch(function () {
			if (request !== requestId || !onList()) return;
			v.list.removeAttribute('aria-busy');
			v.list.innerHTML = '<div class="blog-load-error"><p role="alert">The posts could not be loaded. Check your connection and try again.</p>' + retryHtml() + '</div>';
			positionList(v.list, request, offset, interaction);
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

	// An HTML comment adjacent to a Markdown list can be tokenised as inline
	// HTML, escaping its closing marker and swallowing later public paragraphs.
	// Remove author-hidden fragments first; keep literal comments in code samples.
	function stripComments(markdown) {
		var comment = false;
		var fence = '';
		var fenceLength = 0;
		var codeSpan = 0;
		return markdown.split('\n').map(function (line) {
			var marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
			if (!comment && !codeSpan && marker) {
				if (!fence) {
					fence = marker[1].charAt(0);
					fenceLength = marker[1].length;
					return line;
				}
				if (marker[1].charAt(0) === fence && marker[1].length >= fenceLength && !marker[2].trim()) {
					fence = '';
					return line;
				}
			}
			if (fence) return line;
			var output = '';
			var i = 0;
			while (i < line.length) {
				if (comment) {
					var end = line.indexOf('-->', i);
					if (end === -1) break;
					comment = false;
					i = end + 3;
				} else if (line.charAt(i) === '`') {
					var start = i;
					while (line.charAt(i) === '`') i++;
					var length = i - start;
					if (!codeSpan) codeSpan = length;
					else if (codeSpan === length) codeSpan = 0;
					output += line.slice(start, i);
				} else if (!codeSpan && line.slice(i, i + 4) === '<!--') {
					comment = true;
					i += 4;
				} else {
					output += line.charAt(i++);
				}
			}
			return output;
		}).join('\n');
	}

	function decorate(container, slug, request, realign) {
		if (!container || !window.ReaderLibs) return;
		var interaction = interactionVersion;
		var serial = (container.readerDecoration || 0) + 1;
		container.readerDecoration = serial;
		function active() { return request === requestId && onPost(slug) && container.isConnected && container.readerDecoration === serial; }
		return window.ReaderLibs.enhance(container, { active: active }).then(function (result) {
			if (!active()) return;
			var host = container.parentNode;
			var notice = host.querySelector('.blog-format-notice');
			if (result.highlight === 'failed' || result.math === 'failed') {
				if (!notice) {
					notice = document.createElement('p');
					notice.className = 'blog-info blog-format-notice';
					notice.innerHTML = '<span role="status">Some code or math formatting is unavailable.</span> <button class="blog-reader-button blog-format-retry" type="button">Retry formatting</button>';
					container.insertAdjacentElement('afterend', notice);
					notice.querySelector('button').addEventListener('click', function () {
						this.disabled = true;
						decorate(container, slug, requestId);
					});
				}
				notice.querySelector('button').disabled = false;
			} else if (notice) {
				var restoreFocus = notice.contains(document.activeElement);
				notice.remove();
				if (restoreFocus) {
					var title = host.querySelector('.blog-post-title');
					title.setAttribute('tabindex', '-1');
					title.focus({ preventScroll: true });
				}
			}
			// Formatting can change height above a permalink. Respect any reading
			// interaction made while libraries were arriving.
			var route = postRoute();
			if (realign && route && route.section && interaction === interactionVersion) scrollToSection(host);
			afterRender();
		});
	}

	function backLink() {
		return '<p class="mb-3"><a href="' + escapeHtml(lastListHref) + '" class="link-dark blog-back">← Back to posts</a></p>';
	}

	function readingMinutes(body) {
		var text = body.textContent || '';
		var cjk = text.match(/[\u3040-\u30ff\u3400-\u9fff]/g) || [];
		var words = text.replace(/[\u3040-\u30ff\u3400-\u9fff]/g, ' ').match(/\S+/g) || [];
		return Math.max(1, Math.ceil(words.length / 220 + cjk.length / 500));
	}

	function headingSlug(text) {
		var result = String(text).toLowerCase().trim().replace(/[^\w\u3040-\u30ff\u3400-\u9fff]+/g, '-').replace(/^-|-$/g, '');
		return result || 'section';
	}

	function prepareHeadings(body, slug, title) {
		var first = body.firstElementChild;
		if (first && first.tagName === 'H1' && first.textContent.trim().toLowerCase() === title.trim().toLowerCase()) {
			first.remove();
		}
		var used = Object.create(null);
		var aliases = Object.create(null);
		var toc = [];
		body.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach(function (heading) {
			var text = heading.textContent.trim();
			var key = headingSlug(text);
			var oldId = heading.id;
			var base = 'post-' + headingSlug(slug) + '-' + key;
			var id = base;
			var suffix = 2;
			while (used[id]) id = base + '-' + suffix++;
			used[id] = true;
			heading.id = id;
			heading.setAttribute('tabindex', '-1');
			if (!aliases[key]) aliases[key] = heading.id;
			if (oldId) aliases[oldId] = heading.id;
			var link = document.createElement('a');
			link.className = 'blog-heading-link';
			link.href = postHref(slug, heading.id);
			link.textContent = '#';
			link.setAttribute('aria-label', 'Link to ' + text);
			heading.appendChild(link);
			if (/^H[123]$/.test(heading.tagName)) toc.push({ id: heading.id, text: text, level: heading.tagName });
		});
		// Hashes belong to the site's router; article-local links use its section query.
		body.querySelectorAll('a[href^="#"]:not(.blog-heading-link)').forEach(function (link) {
			var target = link.getAttribute('href').slice(1);
			try { target = decodeURIComponent(target); } catch (e) { /* keep literal */ }
			if (aliases[target]) link.href = postHref(slug, aliases[target]);
		});
		return toc;
	}

	function tocHtml(headings, minutes, slug) {
		if (headings.length < 2 || minutes < 4) return '';
		return '<details class="blog-toc"><summary>On this page</summary><nav aria-label="Article contents"><ol>' +
			headings.map(function (heading) {
				return '<li' + (heading.level === 'H3' ? ' class="blog-toc-sub"' : '') + '><a href="' +
					escapeHtml(postHref(slug, heading.id)) + '">' + escapeHtml(heading.text) + '</a></li>';
			}).join('') + '</ol></nav></details>';
	}

	function scrollToSection(post) {
		var route = postRoute();
		var target = route && route.section ? document.getElementById(route.section) : null;
		if (target && post.contains(target) && /^H[1-6]$/.test(target.tagName)) {
			target.scrollIntoView({ block: 'start', behavior: 'auto' });
			try { target.focus({ preventScroll: true }); } catch (e) { target.focus(); }
		} else {
			var top = 0;
			if (window.innerWidth < 768) {
				var header = document.querySelector('.site-header');
				top = post.getBoundingClientRect().top + window.pageYOffset - (header ? header.offsetHeight : 70) - 16;
			}
			window.scrollTo({ top: Math.max(0, top), behavior: 'auto' });
		}
	}

	function footerHtml(posts, meta) {
		var position = -1;
		posts.forEach(function (post, i) { if (post.slug === meta.slug) position = i; });
		var newer = posts[position - 1];
		var older = posts[position + 1];
		var related = posts.filter(function (post) {
			return post.slug !== meta.slug && (!newer || post.slug !== newer.slug) && (!older || post.slug !== older.slug);
		}).map(function (post) {
			return { post: post, score: (post.tags || []).filter(function (tag) { return (meta.tags || []).indexOf(tag) !== -1; }).length };
		}).filter(function (item) { return item.score > 0; }).sort(function (a, b) { return b.score - a.score; }).slice(0, 2);
		function nextLink(post, label) {
			return post ? '<a href="' + escapeHtml(postHref(post.slug)) + '"><span>' + label + '</span>' + escapeHtml(post.title) + '</a>' : '';
		}
		var html = '<footer class="blog-reading-footer">';
		if (related.length) {
			html += '<h2 class="blog-footer-title">Related writing</h2><ul class="blog-related">' + related.map(function (item) {
				return '<li><a href="' + escapeHtml(postHref(item.post.slug)) + '">' + escapeHtml(item.post.title) + '</a>' +
					'<p>' + escapeHtml(item.post.summary || '') + '</p></li>';
			}).join('') + '</ul>';
		}
		if (newer || older) html += '<nav class="blog-post-nav" aria-label="More posts">' + nextLink(newer, 'Newer post') + nextLink(older, 'Older post') + '</nav>';
		return html + '</footer>';
	}

	function shareHtml(slug, kind) {
		return '<div class="blog-share"><button type="button" class="blog-reader-button blog-copy-link" data-slug="' + escapeHtml(slug) + '">Copy link</button>' +
			'<a class="blog-article-link" href="' + escapeHtml(articleHref(slug)) + '">' + (kind === 'note' ? 'Note page' : 'Article page') + ' <span aria-hidden="true">↗</span></a>' +
			'<span class="blog-copy-status" role="status"></span><input class="blog-share-link" type="text" aria-label="Article link" readonly hidden></div>';
	}

	function copyLink(button) {
		var share = button.closest('.blog-share');
		var status = share.querySelector('.blog-copy-status');
		var input = share.querySelector('.blog-share-link');
		var url = new URL(articleHref(button.getAttribute('data-slug')), document.baseURI).href;
		function fallback() {
			input.value = url;
			input.hidden = false;
			input.focus();
			input.select();
			status.textContent = 'Select and copy this link.';
		}
		if (navigator.clipboard && navigator.clipboard.writeText) {
			navigator.clipboard.writeText(url).then(function () {
				status.textContent = 'Link copied';
				input.hidden = true;
			}).catch(fallback);
		} else {
			fallback();
		}
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

	function postMetaHtml(date, slug, minutes, kind) {
		return (
			'<div class="blog-post-meta blog-info mb-4">' +
			kindBadge(kind) +
			(date ? '<span>' + escapeHtml(date) + '</span>' : '') +
			'<span class="blog-reading-time" title="Estimated reading time">' + minutes + ' min read</span>' +
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
			if (!cfg.goatCounterCode || !el.isConnected || !onPost(slug)) return;
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
					if (!data || data.count == null || !el.isConnected || !onPost(slug)) return;
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
			if (!el.isConnected || !onPost(slug)) return;

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

	// Paper Theatre (misc/55-paper-theatre): if a published visual novel exists for
	// this post, add one small link to the meta row. The manifest is fetched once;
	// any failure simply leaves the post as it is.
	var STORIES_URL = 'misc/55-paper-theatre/stories/index.json';
	var storiesPromise = null;
	function loadStories() {
		if (!storiesPromise) {
			storiesPromise = fetch(STORIES_URL)
				.then(function (r) { return r.ok ? r.json() : []; })
				.catch(function () { return []; });
		}
		return storiesPromise;
	}
	// The same link on each card of the post list, so a story can be opened
	// without opening the post first.
	function loadListStoryLinks(listEl) {
		loadStories().then(function (list) {
			if (!Array.isArray(list) || !listEl.isConnected || !onList()) return;
			var bySlug = {};
			list.forEach(function (s) {
				if (s && s.kind === 'blog' && s.status === 'published' && s.slug && s.id) bySlug[s.slug] = s.id;
			});
			listEl.querySelectorAll('.blog-card').forEach(function (card) {
				var id = bySlug[card.getAttribute('data-slug')];
				var slot = card.querySelector('.blog-card-play');
				if (!id || !slot || slot.firstChild) return;
				var a = document.createElement('a');
				a.className = 'blog-play';
				a.href = 'misc/55-paper-theatre/?story=' + encodeURIComponent(id);
				a.target = '_blank';
				a.rel = 'noopener';
				a.textContent = 'Play as a visual novel';
				slot.appendChild(a);
			});
		});
	}

	function loadStoryLink(metaEl, slug) {
		if (!metaEl) return;
		loadStories().then(function (list) {
			if (!Array.isArray(list) || !metaEl.isConnected || !onPost(slug)) return;
			for (var i = 0; i < list.length; i++) {
				var s = list[i];
				if (s && s.kind === 'blog' && s.status === 'published' && s.slug === slug && s.id) {
					var a = document.createElement('a');
					a.className = 'blog-play';
					a.href = 'misc/55-paper-theatre/?story=' + encodeURIComponent(s.id);
					a.target = '_blank';
					a.rel = 'noopener';
					a.textContent = 'Play as a visual novel';
					metaEl.appendChild(a);
					return;
				}
			}
		});
	}

	function renderPost(slug) {
		var v = views();
		if (!v.list || !v.post) return;
		slug = String(slug || '').split('?')[0];
		var request = ++requestId;
		if (v.post.getAttribute('data-rendered-slug') === slug) {
			v.list.style.display = 'none';
			v.post.style.display = '';
			document.title = v.post.querySelector('.blog-post-title').textContent + ' · Jack V. Le';
			scrollToSection(v.post);
			postRendered(v.post, slug);
			decorate(v.post.querySelector('.blog-post-body'), slug, request, true);
			afterRender();
			return;
		}
		v.list.style.display = 'none';
		v.post.style.display = '';
		v.post.removeAttribute('data-rendered-slug');
		v.post.setAttribute('aria-busy', 'true');
		v.post.innerHTML = backLink() + '<p class="blog-loading" role="status">Loading post…</p>';
		document.title = 'Loading post · Jack V. Le';

		loadIndex().then(function (posts) {
			if (request !== requestId || !onPost(slug)) return;
			var meta = null;
			for (var i = 0; i < posts.length; i++) {
				if (posts[i].slug === slug) {
					meta = posts[i];
					break;
				}
			}
			// Only the public index may select a file. Never guess a draft's filename.
			if (!meta || typeof meta.file !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.md$/.test(meta.file)) {
				var notFound = new Error('not published');
				notFound.notPublished = true;
				throw notFound;
			}

			var markdown = fetch(POSTS_DIR + meta.file, { cache: 'no-cache' })
				.then(function (r) {
					if (!r.ok) throw new Error('not found');
					return r.text();
				});
			return Promise.all([markdown, window.ReaderLibs.ensureCore()])
				.then(function (loaded) {
					if (request !== requestId || !onPost(slug)) return;
					var parsed = parsePost(loaded[0]);
					var title = (meta && meta.title) || parsed.fm.title || slug;
					var date = formatDate((meta && meta.date) || parsed.fm.date);
					var rawHtml = loaded[1].marked.parse(stripComments(parsed.body));
					var clean = loaded[1].DOMPurify.sanitize(rawHtml);
					var body = document.createElement('div');
					body.className = 'blog-post-body';
					body.innerHTML = clean;
					var headings = prepareHeadings(body, slug, title);
					var minutes = readingMinutes(body);

					document.title = title + ' · Jack V. Le';

					v.list.style.display = 'none';
					v.post.innerHTML =
						backLink() +
						'<h1 class="blog-post-title">' +
						escapeHtml(title) +
						'</h1>' +
						postMetaHtml(date, slug, minutes, meta.kind) + tagsHtml(meta.tags || parsed.fm.tags, meta.kind === 'note' ? 'note' : '') + shareHtml(slug, meta.kind) +
						tocHtml(headings, minutes, slug) + body.outerHTML + footerHtml(posts, meta) +
						'<section class="blog-comments" id="blogComments"></section>';
					v.post.style.display = '';
					v.post.removeAttribute('aria-busy');
					v.post.setAttribute('data-rendered-slug', slug);
					v.post.setAttribute('data-post-kind', meta.kind === 'note' ? 'note' : 'article');

					decorate(v.post.querySelector('.blog-post-body'), slug, request, true);
					postRendered(v.post, slug);
					loadViewCount(v.post.querySelector('.blog-views'), slug);
					loadStoryLink(v.post.querySelector('.blog-post-meta'), slug);
					loadComments(v.post.querySelector('#blogComments'), slug);
					scrollToSection(v.post);
					afterRender();
				});
		}).catch(function (error) {
			if (request !== requestId || !onPost(slug)) return;
			v.post.removeAttribute('aria-busy');
			document.title = (error.notPublished ? 'Post not found' : 'Post unavailable') + ' · Jack V. Le';
			v.post.innerHTML = backLink() + '<div class="blog-load-error"><p role="alert">' +
				(error.notPublished ? 'This post is not in the published archive.' : 'This post could not be loaded. Check your connection and try again.') +
				'</p>' + (error.notPublished ? '' : retryHtml()) + '</div>';
			afterRender();
		});
	}

	// ---- Theme hook + public API ------------------------------------------

	// Record the theme without loading reader dependencies on other sections.
	function setHljsTheme(isDark) {
		if (window.ReaderLibs) window.ReaderLibs.setTheme(isDark);
		setGiscusTheme(isDark);
		var route = postRoute();
		if (route) decorate(views().post.querySelector('.blog-post-body'), route.slug, requestId);
	}

	window.Blog = {
		renderList: renderList,
		renderPost: renderPost,
		setHljsTheme: setHljsTheme,
	};

	['pointerdown', 'touchstart', 'wheel', 'keydown'].forEach(function (name) {
		window.addEventListener(name, function () { interactionVersion++; }, { capture: true, passive: true });
	});

	// This listener is installed before main.js's DOMContentLoaded router hook,
	// so it can remember the visible list before the next route changes its DOM.
	window.addEventListener('hashchange', function (event) {
		if (typeof event.oldURL !== 'string') return; // The palette can refresh a route with a plain Event.
		var oldHash = event.oldURL.slice(event.oldURL.indexOf('#'));
		var wasList = /^#\/blog(?:\?|\/?$)/.test(oldHash);
		if (wasList && !onList()) {
			var list = views().list;
			if (list) savedListPosition = { href: lastListHref, offset: -list.getBoundingClientRect().top };
		}
		if (onList()) {
			pendingListOffset = !wasList && savedListPosition && savedListPosition.href === window.location.hash ? savedListPosition.offset : null;
		}
	});

	// Article, tag and heading links are ordinary anchors, including modified clicks.
	document.addEventListener('click', function (e) {
		var copy = e.target.closest && e.target.closest('.blog-copy-link');
		if (copy) copyLink(copy);
		var retry = e.target.closest && e.target.closest('.blog-retry');
		if (retry) {
			indexPromise = null;
			var route = postRoute();
			if (route) renderPost(route.slug);
			else if (onList()) renderList();
		}
	});

	document.addEventListener('change', function (e) {
		if (e.target.id === 'blog-tag-filter') window.location.hash = tagHref(e.target.value);
	});
})();
