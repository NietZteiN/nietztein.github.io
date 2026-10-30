// Progressive Save controls for public writing and publications. Book and toy
// controls keep their existing interfaces and bridge through SavedStore.
(function () {
	'use strict';
	var script = document.currentScript;
	var rootUrl = script && script.src ? new URL('../../', script.src).href : new URL('./', location.href).href;
	var VALID_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
	var sources = Object.create(null), scheduled = false;
	var store = null;

	function registry(kind) {
		if (!sources[kind]) {
			var path = kind === 'post' ? 'blog/index.json' : 'assets/data/publications.json';
			sources[kind] = fetch(new URL(path, rootUrl).href, { cache: 'no-cache' }).then(function (response) {
				if (!response.ok) throw new Error('Public source unavailable');
				return response.json();
			}).then(function (rows) {
				if (!Array.isArray(rows)) throw new Error('Invalid public index');
				var result = Object.create(null);
				rows.forEach(function (row) {
					if (!row || typeof row.title !== 'string' || !row.title.trim()) return;
					var id = kind === 'post' ? row.slug : row.id;
					if (typeof id !== 'string' || !VALID_ID.test(id)) return;
					if (kind === 'post' && (typeof row.file !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.md$/.test(row.file))) return;
					result[id] = row.title.replace(/\s+/g, ' ').trim();
				});
				return result;
			}).catch(function () { sources[kind] = null; return null; });
		}
		return sources[kind];
	}
	function update(button) {
		if (!store || !button.isConnected) return;
		var saved = store.has(button.getAttribute('data-saved-kind'), button.getAttribute('data-saved-id'));
		button.textContent = saved ? 'Saved' : 'Save';
		button.setAttribute('aria-pressed', saved ? 'true' : 'false');
		button.setAttribute('aria-label', (saved ? 'Remove ' : 'Save ') + button.getAttribute('data-saved-title') + (saved ? ' from your saved items' : ' to your saved items'));
	}
	function updateAll() {
		Array.prototype.forEach.call(document.querySelectorAll('.saved-control[data-saved-id]'), update);
	}
	// Reserve card action height before the blog restores its scroll position.
	// Validation can finish later without shifting subsequent cards on the page.
	function reserveCardSlots() {
		Array.prototype.forEach.call(document.querySelectorAll('#blogListView .blog-card[data-slug]'), function (card) {
			if (card.querySelector('.saved-card-actions')) return;
			var slot = document.createElement('div'); slot.className = 'saved-card-actions'; card.appendChild(slot);
		});
	}
	function insert(host, kind, id, title, location) {
		if (!host || !host.isConnected || host.querySelector('.saved-control[data-saved-kind="' + kind + '"]')) return;
		var wrap = document.createElement('span'); wrap.className = 'saved-control-wrap';
		var button = document.createElement('button'); button.className = 'saved-control'; button.type = 'button';
		button.setAttribute('data-saved-kind', kind); button.setAttribute('data-saved-id', id); button.setAttribute('data-saved-title', title);
		var feedback = document.createElement('span'); feedback.className = 'saved-control-feedback'; feedback.setAttribute('role', 'status');
		button.addEventListener('click', function () {
			var saved = store.toggle(kind, id, { source: 'saved-controls' });
			updateAll();
			var persistent = typeof store.status !== 'function' || !store.status().issues.some(function (issue) { return issue.provider === 'site'; });
			feedback.classList.toggle('is-visible', !persistent);
			feedback.textContent = persistent ? (saved ? 'Added to your saved items on this device.' : 'Removed from your saved items.') :
				(saved ? 'Saved for this visit. Browser storage is unavailable; export a copy from Saved to keep it.' : 'Removed for this visit. Browser storage is unavailable.');
		});
		wrap.appendChild(button); wrap.appendChild(feedback);
		if (host.hasAttribute('data-article-slug')) {
			var savedLink = document.createElement('a'); savedLink.className = 'saved-hub-link';
			savedLink.href = new URL('#/saved', rootUrl).href; savedLink.textContent = 'View saved items';
			wrap.appendChild(savedLink);
		}
		if (location) location.appendChild(wrap); else host.appendChild(wrap);
		update(button);
	}
	function scanPosts() {
		reserveCardSlots();
		var candidates = Array.prototype.slice.call(document.querySelectorAll('#blogListView .blog-card[data-slug], #blogPostView[data-rendered-slug], [data-article-slug]'));
		if (!candidates.length) return;
		registry('post').then(function (valid) {
			if (!valid) return;
			candidates.forEach(function (host) {
				if (!host.isConnected) return;
				var id = host.getAttribute('data-slug') || host.getAttribute('data-rendered-slug') || host.getAttribute('data-article-slug');
				if (!valid[id]) return;
				var destination = host.classList.contains('blog-card') ? host.querySelector('.saved-card-actions') : host.querySelector('.blog-share, .article-share');
				insert(host, 'post', id, valid[id], destination);
			});
		});
	}
	function scanPublications() {
		if (!/^#\/publications(?:[/?]|$)/.test(location.hash)) return;
		var blocks = Array.prototype.slice.call(document.querySelectorAll('#publicationsContent [data-publication-id]'));
		if (!blocks.length) return;
		registry('publication').then(function (valid) {
			if (!valid) return;
			blocks.forEach(function (host) {
				var id = host.getAttribute('data-publication-id');
				if (valid[id]) insert(host, 'publication', id, valid[id], host.querySelector('.publication-actions'));
			});
		});
	}
	function scan() {
		scheduled = false;
		if (!store) return;
		scanPosts(); scanPublications();
	}
	function schedule() {
		if (scheduled) return;
		scheduled = true;
		requestAnimationFrame(scan);
	}
	function boot() {
		store = window.SavedStore;
		if (!store || typeof store.has !== 'function' || typeof store.toggle !== 'function') return;
		store.ready().then(function () {
			store.subscribe(updateAll);
			var observer = new MutationObserver(function (records) {
				if (records.some(function (record) { return record.type === 'childList' && (record.addedNodes.length || record.removedNodes.length); })) { reserveCardSlots(); schedule(); }
			});
			['blogListView', 'blogPostView'].forEach(function (id) {
				var host = document.getElementById(id);
				if (host) observer.observe(host, { childList: true, subtree: true });
			});
			document.addEventListener('blog:render', function () { reserveCardSlots(); schedule(); });
			window.addEventListener('hashchange', schedule);
			scan();
		});
	}
	if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
