// Site shell: hash router, section transitions, theme toggle, analytics.
//
// Routes (every section is linkable):
//   #/about  #/education  #/publications  #/press  #/blog  #/post/<slug>
//   #/teaching  #/presentations  #/experience  #/misc
//
// The blog module (blog.js) renders inside the #/blog and #/post/* routes;
// this file decides which section is visible and tells Blog what to draw.

(function () {
	'use strict';

	var html = document.documentElement;

	// route name -> section element id
	var ROUTES = {
		about: 'aboutmeContent',
		education: 'educationContent',
		publications: 'publicationsContent',
		press: 'blogContent',
		blog: 'postsContent',
		post: 'postsContent',
		teaching: 'academicContent',
		presentations: 'presentationsContent',
		experience: 'experienceContent',
		misc: 'miscContent',
	};
	var TITLES = {
		about: 'About',
		education: 'Education',
		publications: 'Publications',
		press: 'Writing & press',
		blog: 'Blog',
		post: 'Blog',
		teaching: 'Teaching',
		presentations: 'Presentations',
		experience: 'Experience',
		misc: 'Miscellaneous',
	};
	var DEFAULT_ROUTE = 'about';
	var SITE_NAME = 'Jack V. Le';

	var reducedMotion =
		window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

	function $(sel, root) {
		return (root || document).querySelector(sel);
	}
	function $$(sel, root) {
		return Array.prototype.slice.call((root || document).querySelectorAll(sel));
	}

	// ---- Theme ------------------------------------------------------------

	function currentTheme() {
		return html.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
	}

	function applyTheme(theme) {
		html.setAttribute('data-theme', theme);
		html.setAttribute('data-bs-theme', theme);
		try {
			localStorage.setItem('theme', theme);
		} catch (e) {
			/* private mode etc. */
		}
		var icon = $('#theme-toggle i');
		if (icon) {
			icon.className =
				theme === 'dark' ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
		}
		if (window.Blog) window.Blog.setHljsTheme(theme === 'dark');
	}

	function toggleTheme(ev) {
		var next = currentTheme() === 'dark' ? 'light' : 'dark';

		if (!document.startViewTransition || reducedMotion) {
			applyTheme(next);
			return;
		}

		// Circular wipe from the click point.
		var x = ev && ev.clientX ? ev.clientX : window.innerWidth;
		var y = ev && ev.clientY ? ev.clientY : 0;
		var r = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
		html.style.setProperty('--wipe-x', x + 'px');
		html.style.setProperty('--wipe-y', y + 'px');
		html.style.setProperty('--wipe-r', r + 'px');
		html.classList.add('theme-wipe');

		var vt = document.startViewTransition(function () {
			applyTheme(next);
		});
		vt.finished
			.catch(function () {})
			.then(function () {
				html.classList.remove('theme-wipe');
			});
	}

	// ---- Sections ---------------------------------------------------------

	var currentSection = null;

	// Adds a staggered entrance to the elements matched inside `root`.
	function staggerReveal(root, selector) {
		if (!root) return;
		var items = $$(selector, root);
		items.forEach(function (el, i) {
			el.classList.remove('rise');
			// Force a reflow so re-adding the class restarts the animation.
			void el.offsetWidth;
			el.style.setProperty('--i', Math.min(i, 18));
			el.classList.add('rise');
		});
	}

	var SECTION_ITEMS = '.container > :not(.row), .container > .row > *';

	function showSection(id) {
		var target = document.getElementById(id);
		if (!target) return;
		if (currentSection === id) return;

		$$('.section').forEach(function (s) {
			if (s !== target) {
				s.classList.remove('active');
				$$('.rise', s).forEach(function (el) {
					el.classList.remove('rise');
				});
			}
		});

		target.classList.add('active');
		currentSection = id;

		// The blog section is filled asynchronously; blog.js staggers its own items.
		if (id !== 'postsContent') staggerReveal(target, SECTION_ITEMS);

		// On phones the left panel is above the content: jump to the content.
		if (window.innerWidth < 768) {
			var top = target.getBoundingClientRect().top + window.pageYOffset - 70;
			window.scrollTo({ top: Math.max(top, 0), behavior: 'auto' });
		}
	}

	function setActiveLink(route) {
		var linkRoute = route === 'post' ? 'blog' : route;
		$$('#top-nav .nav-link').forEach(function (a) {
			a.classList.toggle('active', a.getAttribute('data-route') === linkRoute);
		});
	}

	function collapseMobileNav() {
		var nav = $('#mainNav');
		if (!nav || !nav.classList.contains('show') || !window.bootstrap) return;
		var c = window.bootstrap.Collapse.getInstance(nav);
		if (c) c.hide();
	}

	// ---- Router -----------------------------------------------------------

	function parseHash() {
		var h = window.location.hash || '';
		var m = /^#\/([^\/]+)\/?(.*)$/.exec(h);
		if (!m) return { route: DEFAULT_ROUTE, rest: '' };
		var route = m[1];
		// A query suffix (e.g. #/blog?tag=x) belongs to the section, not the route.
		// blog.js reads it from window.location.hash itself.
		var q = route.indexOf('?');
		if (q !== -1) route = route.slice(0, q);
		return { route: route, rest: m[2] || '' };
	}

	function applyRoute() {
		var r = parseHash();
		if (!ROUTES[r.route]) {
			window.location.replace('#/' + DEFAULT_ROUTE);
			return;
		}

		showSection(ROUTES[r.route]);
		setActiveLink(r.route);
		collapseMobileNav();

		if (r.route === 'blog' && window.Blog) {
			window.Blog.renderList();
		} else if (r.route === 'post' && window.Blog) {
			window.Blog.renderPost(decodeURIComponent(r.rest));
		}

		if (r.route !== 'post') {
			document.title = (r.route === DEFAULT_ROUTE ? '' : TITLES[r.route] + ' · ') + SITE_NAME;
		}

		trackPageView('/' + r.route + (r.rest ? '/' + r.rest : ''));
	}

	// ---- Analytics --------------------------------------------------------
	//
	// The site is a single page, so page views are sent by hand on each route
	// change. Both providers are optional and configured in assets/js/config.json:
	//   googleAnalyticsMeasurementId  -> Google Analytics 4
	//   goatCounterCode               -> https://<code>.goatcounter.com

	// Shared with blog.js (view counts, giscus) so config is only fetched once.
	var configPromise = fetch('assets/js/config.json')
		.then(function (r) {
			return r.ok ? r.json() : {};
		})
		.catch(function () {
			return {};
		});

	var gaReady = false;
	var gcReady = false;
	var pendingViews = [];

	function trackPageView(path) {
		pendingViews.push(path);
		flushViews();
	}

	function flushViews() {
		if (!gaReady && !gcReady) return;
		var views = pendingViews.splice(0);
		views.forEach(function (path) {
			if (gaReady && window.gtag) {
				window.gtag('event', 'page_view', {
					page_path: path,
					page_location: window.location.origin + '/' + path,
					page_title: document.title,
				});
			}
			if (gcReady && window.goatcounter && window.goatcounter.count) {
				window.goatcounter.count({ path: path, title: document.title });
			}
		});
	}

	function loadAnalytics(cfg) {
		if (cfg.googleAnalyticsMeasurementId) {
			var id = cfg.googleAnalyticsMeasurementId;
			window.dataLayer = window.dataLayer || [];
			window.gtag = function () {
				window.dataLayer.push(arguments);
			};
			window.gtag('js', new Date());
			window.gtag('config', id, { send_page_view: false });
			var s = document.createElement('script');
			s.async = true;
			s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(id);
			document.head.appendChild(s);
			gaReady = true;
		}

		if (cfg.goatCounterCode) {
			var g = document.createElement('script');
			g.async = true;
			g.setAttribute(
				'data-goatcounter',
				'https://' + cfg.goatCounterCode + '.goatcounter.com/count'
			);
			g.setAttribute('data-goatcounter-settings', JSON.stringify({ no_onload: true }));
			g.src = 'https://gc.zgo.at/count.js';
			g.onload = function () {
				gcReady = true;
				flushViews();
			};
			document.head.appendChild(g);
			window.GOATCOUNTER_CODE = cfg.goatCounterCode; // blog.js reads view counts with it
		}

		flushViews();
	}

	// ---- Reading progress bar --------------------------------------------

	function updateProgress() {
		var bar = $('#reading-progress');
		var post = $('#blogPostView');
		if (!bar) return;
		var visible = post && post.style.display !== 'none' && currentSection === 'postsContent';
		bar.classList.toggle('visible', !!visible);
		if (!visible) return;
		var doc = document.documentElement;
		var max = doc.scrollHeight - window.innerHeight;
		var pct = max > 0 ? (window.pageYOffset / max) * 100 : 0;
		bar.style.width = Math.min(100, Math.max(0, pct)) + '%';
	}

	// ---- Boot -------------------------------------------------------------

	window.Site = {
		showSection: showSection,
		staggerReveal: staggerReveal,
		updateProgress: updateProgress,
		config: configPromise,
	};

	document.addEventListener('DOMContentLoaded', function () {
		// Theme attribute was set pre-paint by the inline script; sync the icon + hljs.
		applyTheme(currentTheme());

		var toggle = $('#theme-toggle');
		if (toggle) toggle.addEventListener('click', toggleTheme);

		window.addEventListener('hashchange', applyRoute);
		window.addEventListener('scroll', updateProgress, { passive: true });
		window.addEventListener('resize', updateProgress);

		applyRoute();

		configPromise.then(loadAnalytics);
	});
})();
