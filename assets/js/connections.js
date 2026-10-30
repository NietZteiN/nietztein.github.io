// Curated topical connections. The public source indices supply every title
// and validate every target; the small connection file supplies only the links
// and their editorial descriptions. No story scripts or private data are read.
(function () {
	'use strict';

	var LIMIT = 3;
	var VALID_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

	function key(kind, id) { return kind + ':' + id; }
	function clean(value) { return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''; }
	function validKind(kind) { return kind === 'publication' || kind === 'post' || kind === 'experiment'; }

	// Pure validation is also used by the small Node regression test. Missing,
	// unpublished or malformed targets are omitted without inventing a URL.
	function compile(model, publications, posts, toys) {
		var entities = Object.create(null), links = Object.create(null);
		function add(kind, id, title) {
			if (typeof id !== 'string' || !VALID_ID.test(id) || !clean(title)) return;
			entities[key(kind, id)] = { kind: kind, id: id, title: clean(title) };
		}
		(Array.isArray(publications) ? publications : []).forEach(function (paper) {
			if (paper) add('publication', paper.id, paper.title);
		});
		(Array.isArray(posts) ? posts : []).forEach(function (post) {
			if (post && typeof post.file === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]*\.md$/.test(post.file)) add('post', post.slug, post.title);
		});
		var experiments = toys && Array.isArray(toys.toys) ? toys.toys : [];
		experiments.forEach(function (toy) {
			if (toy && toy.status === 'live' && Array.isArray(toy.surfaces) && toy.surfaces.some(function (surface) {
				return surface === 'grid' || surface === 'views';
			})) add('experiment', toy.slug, toy.title);
		});
		if (!model || model.version !== 1 || !Array.isArray(model.connections)) return { entities: entities, links: links };
		model.connections.forEach(function (row) {
			if (!row || !row.from || !validKind(row.from.kind) || !Array.isArray(row.to)) return;
			var from = key(row.from.kind, row.from.id);
			if (!entities[from]) return;
			var result = links[from] || [];
			row.to.forEach(function (edge) {
				if (!edge || !validKind(edge.kind) || edge.kind === row.from.kind || result.length >= LIMIT) return;
				var target = key(edge.kind, edge.id), description = clean(edge.description);
				if (!entities[target] || !description || description.length > 240) return;
				if (result.some(function (item) { return item.key === target; })) return;
				result.push({ key: target, entity: entities[target], description: description });
			});
			if (result.length) links[from] = result;
		});
		return { entities: entities, links: links };
	}

	if (typeof module !== 'undefined' && module.exports) {
		module.exports = { compile: compile };
		return;
	}
	if (typeof document === 'undefined' || window.Connections) return;

	var sourceScript = document.currentScript;
	var rootUrl = sourceScript && sourceScript.src ? new URL('../../', sourceScript.src).href : new URL('./', window.location.href).href;
	var dataPromise = null, serial = 0, focusedPaperHash = '';
	var labels = { publication: 'Research', post: 'Writing', experiment: 'Experiment' };

	function node(tag, className, value) {
		var result = document.createElement(tag);
		if (className) result.className = className;
		if (value) result.textContent = value;
		return result;
	}
	function data(path) {
		return fetch(new URL(path, rootUrl).href, { cache: 'no-cache' }).then(function (response) {
			if (!response.ok) throw new Error('Connection source unavailable');
			return response.json();
		}).catch(function () { return null; });
	}
	function load() {
		if (!dataPromise) {
			dataPromise = Promise.all([
				data('assets/data/connections.json'), data('assets/data/publications.json'),
				data('blog/index.json'), data('misc/toys.json')
			]).then(function (sources) {
				var result = compile(sources[0], sources[1], sources[2], sources[3]);
				// A later visit can retry an optional source that was briefly offline.
				if (sources.some(function (value) { return value === null; })) dataPromise = null;
				return result;
			});
		}
		return dataPromise;
	}
	function href(entity) {
		var path = entity.kind === 'experiment' ? 'misc/' + entity.id + '/' :
			entity.kind === 'post' ? '#/post/' + encodeURIComponent(entity.id) :
			'#/publications?paper=' + encodeURIComponent(entity.id);
		return new URL(path, rootUrl).href;
	}
	function sectionFor(result, from, variant) {
		var edges = result.links[from] || [];
		if (!edges.length) return null;
		var box = node('section', 'content-connections connections-' + variant);
		box.setAttribute('data-connections-for', from);
		box.setAttribute('aria-label', 'Explore further');
		box.appendChild(node(variant === 'article' ? 'h2' : 'p', 'connections-title', 'Explore further'));
		var list = node('ul', 'connections-list');
		edges.forEach(function (edge) {
			var item = node('li', 'connections-item');
			var link = node('a', 'connections-link');
			link.href = href(edge.entity);
			link.appendChild(node('span', 'connections-kind', labels[edge.entity.kind]));
			link.appendChild(node('span', 'connections-link-title', edge.entity.title));
			link.appendChild(node('span', 'connections-description', edge.description));
			item.appendChild(link);
			list.appendChild(item);
		});
		box.appendChild(list);
		return box;
	}
	function postIsCurrent(host, slug, request) {
		if (!host || !host.isConnected || host._connectionsRequest !== request) return false;
		if (host.getAttribute('data-article-slug') === slug) return true;
		if (host.getAttribute('data-rendered-slug') !== slug) return false;
		var match = /^#\/post\/([^?]+)(?:\?|$)/.exec(window.location.hash);
		try { return !!match && decodeURIComponent(match[1]) === slug; } catch (e) { return false; }
	}
	function renderPost(host, slug) {
		if (!host || !VALID_ID.test(slug || '')) return Promise.resolve();
		var request = ++serial;
		host._connectionsRequest = request;
		return load().then(function (result) {
			if (!postIsCurrent(host, slug, request)) return;
			var from = key('post', slug);
			var existing = host.querySelector('.content-connections');
			if (existing && existing.getAttribute('data-connections-for') === from) return;
			if (existing) existing.remove();
			var box = sectionFor(result, from, 'article');
			if (!box) return;
			var before = host.querySelector('[data-connections-before], .blog-reading-footer');
			if (before) before.parentNode.insertBefore(box, before);
			else host.appendChild(box);
		}).catch(function () { /* Optional discovery must never break the article. */ });
	}
	function renderPublications(result) {
		Array.prototype.forEach.call(document.querySelectorAll('#publicationsContent [data-publication-id]'), function (block) {
			if (block.querySelector('.content-connections')) return;
			var box = sectionFor(result, key('publication', block.getAttribute('data-publication-id')), 'publication');
			if (box) block.appendChild(box);
		});
	}
	function paperFromRoute() {
		var match = /^#\/publications\/?(?:\?(.*))?$/.exec(window.location.hash);
		if (!match) return '';
		var id = new URLSearchParams(match[1] || '').get('paper') || '';
		return VALID_ID.test(id) ? id : '';
	}
	function revealPaper(result) {
		var id = paperFromRoute();
		if (!id || !result.entities[key('publication', id)] || focusedPaperHash === window.location.hash) return;
		var block = null;
		Array.prototype.some.call(document.querySelectorAll('#publicationsContent [data-publication-id]'), function (candidate) {
			if (candidate.getAttribute('data-publication-id') === id) { block = candidate; return true; }
			return false;
		});
		if (!block) return;
		if (block.hidden) {
			var all = document.querySelector('.publication-filter[data-topic=""]');
			if (all) all.click();
		}
		if (!block.getClientRects().length) return;
		focusedPaperHash = window.location.hash;
		var title = block.querySelector('.lucida-console.h5') || block;
		title.setAttribute('tabindex', '-1');
		try { title.focus({ preventScroll: true }); } catch (e) { title.focus(); }
		block.scrollIntoView({ block: 'start', behavior: 'auto' });
	}
	function routeChanged() {
		var expected = window.location.hash;
		if (!/^#\/publications(?:\/|\?|$)/.test(expected)) { focusedPaperHash = ''; return; }
		if (!paperFromRoute()) focusedPaperHash = '';
		load().then(function (result) {
			renderPublications(result);
			// This listener may run before the shell's hash router. Wait for its
			// section switch before checking layout or moving focus.
			window.requestAnimationFrame(function () {
				if (window.location.hash === expected) revealPaper(result);
			});
		}).catch(function () { /* Core publication navigation remains available. */ });
	}
	function boot() {
		// The homepage does not need to download the discovery registry. Fetch it
		// only when a publication list or article actually uses these links.
		routeChanged();
		var article = document.querySelector('[data-article-slug]');
		if (article) renderPost(article, article.getAttribute('data-article-slug'));
		var post = document.querySelector('#blogPostView[data-rendered-slug]');
		if (post) renderPost(post, post.getAttribute('data-rendered-slug'));
	}
	window.Connections = { renderPost: renderPost };
	document.addEventListener('blog:render', function (event) {
		var detail = event.detail || {};
		renderPost(detail.host, detail.slug);
	});
	window.addEventListener('hashchange', routeChanged);
	window.addEventListener('popstate', routeChanged);
	if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
	else boot();
})();
