// Misc discovery: native card links, local favorites and recent openings.
// Favorite controls are siblings of links, added only when JavaScript runs.
// Shareable hash state: g (group), q (query), scope (all/favorites/recent),
// sort (grouped/newest/title/recent). Recent holds known toys; favorites retain
// valid unseen IDs so ordinary edits cannot erase older saved experiments.
(function () {
	'use strict';
	var STORE_KEY = 'misc.view', FAVORITES_KEY = 'misc.favorites.v1', RECENT_KEY = 'misc.recent.v1';
	var RECENT_LIMIT = 30, ROUTE_RE = /^#\/misc(?:[\/?]|$)/;
	var ACCENTS_RE = new RegExp('[' + String.fromCharCode(0x300) + '-' + String.fromCharCode(0x36f) + ']', 'g');
	var tools, grid, input, countEl, emptyEl, randomBtn, sortSelect, featured, statusEl;
	var chips = [], scopeBtns = [], segBtns = [], heads = [], cards = [], groupIds = {};
	var favorites = [], recent = [], storageWarned = false, favoritesCorrupt = false;
	var group = '', query = '', scope = 'all', sort = 'grouped', urlTimer = 0;

	function slice(list) { return Array.prototype.slice.call(list); }
	function textOf(el) { return el ? String(el.textContent || '') : ''; }
	function fold(value) {
		var s = String(value == null ? '' : value).toLowerCase();
		if (s.normalize) s = s.normalize('NFD').replace(ACCENTS_RE, '');
		return s.replace(/\s+/g, ' ').trim();
	}
	function setHidden(el, hide) { if (el && el.hidden !== hide) el.hidden = hide; }
	function setText(el, text) { if (el && el.textContent !== text) el.textContent = text; }
	function setPressed(el, on) { el.setAttribute('aria-pressed', on ? 'true' : 'false'); }
	function announce(text) { setText(statusEl, text); }
	function countText(n) { return n + (n === 1 ? ' toy' : ' toys'); }
	function slugOf(href) {
		var match = /(?:^|\/)misc\/(\d{2,3}-[a-z0-9-]+)\//.exec(href || '');
		return match ? match[1] : '';
	}
	function knownSlug(slug) { return cards.some(function (card) { return card.slug === slug; }); }
	function validFavoriteSlug(slug) { return typeof slug === 'string' && slug.length <= 200 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug); }
	function adoptFavorites(persistent) {
		if (window.SavedStore && typeof window.SavedStore.adoptLegacy === 'function') {
			window.SavedStore.adoptLegacy('experiment', favorites.slice(), { source: 'misc', persistent: persistent });
		}
	}
	function readList(key) {
		var raw;
		try {
			raw = window.localStorage.getItem(key);
			var value = JSON.parse(raw || '[]');
			if (!Array.isArray(value)) throw new Error('Invalid local collection');
			if (key === FAVORITES_KEY) favoritesCorrupt = false;
			return value.filter(function (slug, i) {
				return typeof slug === 'string' && (key === RECENT_KEY ? knownSlug(slug) : validFavoriteSlug(slug)) && value.indexOf(slug) === i;
			}).slice(0, key === RECENT_KEY ? RECENT_LIMIT : value.length);
		} catch (e) { if (key === FAVORITES_KEY) favoritesCorrupt = raw != null; return []; }
	}
	function saveList(key, value) {
		var persistent = true;
		if (key === FAVORITES_KEY) {
			if (favoritesCorrupt) {
				try { var raw = window.localStorage.getItem(key); if (!raw || Array.isArray(JSON.parse(raw))) favoritesCorrupt = false; }
				catch (e) { /* Keep unreadable original data untouched. */ }
			}
			var storeCorrupt = window.SavedStore && typeof window.SavedStore.status === 'function' && window.SavedStore.status().issues.some(function (issue) { return issue.provider === 'experiment' && issue.reason === 'corrupt'; });
			if (favoritesCorrupt || storeCorrupt) {
				setText(tools.querySelector('.misc-local-note'), 'Saved favorites could not be read, so the original data has been kept. Changes last for this visit; export a copy from Saved to keep them.');
				adoptFavorites(false);
				return;
			}
		}
		try { window.localStorage.setItem(key, JSON.stringify(value)); }
		catch (e) {
			persistent = false;
			if (!storageWarned) {
				storageWarned = true;
				setText(tools.querySelector('.misc-local-note'), 'Browser storage is unavailable. Favorites and recent toys will last until you reload.');
				announce('Browser storage is unavailable. Your selection is kept for this page visit.');
			}
		}
		if (key === FAVORITES_KEY) adoptFavorites(persistent);
	}
	function collect(section) {
		tools = section.querySelector('.misc-tools'); grid = section.querySelector('.misc-grid');
		if (!tools || !grid) return false;
		input = tools.querySelector('.misc-filter'); countEl = tools.querySelector('.misc-count');
		emptyEl = tools.querySelector('.misc-empty'); randomBtn = tools.querySelector('.misc-random');
		sortSelect = tools.querySelector('.misc-sort'); featured = tools.querySelector('.misc-featured');
		statusEl = tools.querySelector('.misc-discovery-status');
		if (!input || !countEl) return false;
		var children = slice(grid.children), names = {};
		heads = slice(grid.querySelectorAll('.misc-group-h[data-group]')).map(function (el) {
			var id = el.getAttribute('data-group'), num = el.querySelector('.misc-group-n'), name = '';
			for (var node = el.firstChild; node; node = node.nextSibling) if (node !== num) name += textOf(node);
			names[id] = name; groupIds[id] = true; el.style.order = children.indexOf(el);
			return { el: el, group: id, numEl: num, total: 0, order: children.indexOf(el) };
		});
		cards = slice(grid.querySelectorAll('.misc-card')).map(function (el) {
			var id = el.getAttribute('data-group') || '', title = textOf(el.querySelector('.misc-title'));
			var card = {
				el: el, group: id, title: title, slug: slugOf(el.getAttribute('href')),
				added: el.getAttribute('data-added') || '', number: +(el.getAttribute('data-n') || 0), order: children.indexOf(el),
				text: fold([title, textOf(el.querySelector('.misc-desc')), textOf(el.querySelector('.misc-note')),
					names[id] || '', el.getAttribute('data-tags') || '', textOf(el.querySelector('.misc-new'))].join(' '))
			};
			var entry = document.createElement('div'); entry.className = 'misc-entry';
			el.parentNode.insertBefore(entry, el); entry.appendChild(el);
			var button = document.createElement('button'); button.type = 'button'; button.className = 'misc-favorite';
			button.setAttribute('data-slug', card.slug); button.innerHTML = '<span aria-hidden="true">&#9734;</span>';
			entry.appendChild(button); card.entry = entry; card.button = button;
			return card;
		});
		heads.forEach(function (head) { head.total = cards.filter(function (card) { return card.group === head.group; }).length; });
		chips = slice(tools.querySelectorAll('.misc-chip[data-group]'));
		scopeBtns = slice(tools.querySelectorAll('[data-scope]')); segBtns = slice(tools.querySelectorAll('[data-density]'));
		return true;
	}
	function updateFavorites() {
		cards.forEach(function (card) {
			var saved = favorites.indexOf(card.slug) !== -1; setPressed(card.button, saved);
			card.button.setAttribute('aria-label', (saved ? 'Remove ' : 'Save ') + card.title + (saved ? ' from favorites' : ' to favorites'));
			card.button.title = saved ? 'Remove from favorites' : 'Save to favorites';
			card.button.firstChild.textContent = saved ? '\u2605' : '\u2606';
		});
		setText(tools.querySelector('.misc-saved-count'), String(cards.filter(function (card) { return favorites.indexOf(card.slug) !== -1; }).length));
	}
	// Keep visual, keyboard and screen-reader order together. Only move nodes
	// whose position changed, and retain focus when changing an opened/favorite item.
	function orderGrid(ordered, flat) {
		var nodes;
		if (flat) nodes = ordered.map(function (card) { return card.entry; }).concat(heads.map(function (head) { return head.el; }));
		else nodes = cards.map(function (card) { return { el: card.entry, order: card.order }; }).concat(heads).sort(function (a, b) { return a.order - b.order; }).map(function (item) { return item.el; });
		var active = document.activeElement, keepFocus = grid.contains(active);
		nodes.forEach(function (node, i) { if (grid.children[i] !== node) grid.insertBefore(node, grid.children[i] || null); });
		if (keepFocus && active !== document.activeElement) {
			try { active.focus({ preventScroll: true }); } catch (e) { active.focus(); }
		}
	}
	function apply() {
		var words = fold(query).split(' '), shown = 0, perGroup = {}, ordered = cards.slice(), flat = sort !== 'grouped';
		if (sort === 'newest') ordered.sort(function (a, b) { return b.added.localeCompare(a.added) || b.number - a.number; });
		else if (sort === 'title') ordered.sort(function (a, b) { return a.title.localeCompare(b.title) || a.order - b.order; });
		else if (sort === 'recent') ordered.sort(function (a, b) {
			var ai = recent.indexOf(a.slug), bi = recent.indexOf(b.slug);
			return (ai < 0 ? RECENT_LIMIT : ai) - (bi < 0 ? RECENT_LIMIT : bi) || a.order - b.order;
		});
		orderGrid(ordered, flat);
		ordered.forEach(function (card, index) {
			var ok = (!group || card.group === group) && (scope !== 'favorites' || favorites.indexOf(card.slug) !== -1) && (scope !== 'recent' || recent.indexOf(card.slug) !== -1);
			for (var i = 0; ok && i < words.length; i++) if (card.text.indexOf(words[i]) === -1) ok = false;
			setHidden(card.entry, !ok); setHidden(card.el, !ok); card.entry.style.order = flat ? index : card.order;
			if (ok) { shown++; perGroup[card.group] = (perGroup[card.group] || 0) + 1; }
		});
		heads.forEach(function (head) {
			var n = perGroup[head.group] || 0; setHidden(head.el, flat || !n);
			setText(head.numEl, n && n < head.total ? n + ' of ' + head.total : String(head.total));
		});
		chips.forEach(function (el) { setPressed(el, el.getAttribute('data-group') === group); });
		scopeBtns.forEach(function (el) { setPressed(el, el.getAttribute('data-scope') === scope); });
		if (sortSelect) sortSelect.value = sort;
		setText(countEl, shown < cards.length ? shown + ' of ' + cards.length : countText(shown)); setHidden(emptyEl, shown !== 0);
		var emptyText = 'Nothing matches these filters.';
		if (scope === 'favorites' && !favorites.length) emptyText = 'No favorites yet. Save a toy with its star button.';
		else if (scope === 'recent' && !recent.length) emptyText = 'Nothing opened yet. Your last 30 toys will appear here.';
		setText(tools.querySelector('.misc-empty-text'), emptyText);
		if (randomBtn) randomBtn.disabled = !shown;
		setHidden(featured, !!(group || query.trim() || scope !== 'all' || sort !== 'grouped')); updateFavorites();
	}
	function storedDensity() {
		try { return window.localStorage.getItem(STORE_KEY) === 'compact' ? 'compact' : 'cards'; }
		catch (e) { return 'cards'; }
	}
	function setDensity(density, save) {
		grid.classList.toggle('is-compact', density === 'compact');
		segBtns.forEach(function (el) { setPressed(el, el.getAttribute('data-density') === density); });
		if (save) { try { window.localStorage.setItem(STORE_KEY, density); } catch (e) { /* Keep this visit's choice. */ } }
	}
	function onMiscRoute() { return ROUTE_RE.test(window.location.hash || ''); }
	function readHash() {
		var want = { group: '', query: '', scope: 'all', sort: 'grouped' }, h = window.location.hash || '', at = h.indexOf('?');
		if (at === -1) return want;
		h.slice(at + 1).split('&').forEach(function (pair) {
			var eq = pair.indexOf('='), key = eq === -1 ? pair : pair.slice(0, eq), value = eq === -1 ? '' : pair.slice(eq + 1);
			try { value = decodeURIComponent(value.replace(/\+/g, ' ')); } catch (e) { /* Keep a stray percent as typed. */ }
			if (key === 'g' && Object.prototype.hasOwnProperty.call(groupIds, value)) want.group = value;
			else if (key === 'q') want.query = value;
			else if (key === 'scope' && /^(all|favorites|recent)$/.test(value)) want.scope = value;
			else if (key === 'sort' && /^(grouped|newest|title|recent)$/.test(value)) want.sort = value;
		});
		if (want.scope === 'recent' && !/[?&]sort=/.test(h)) want.sort = 'recent';
		return want;
	}
	function syncUrl() {
		urlTimer = 0; if (!onMiscRoute()) return;
		var parts = [], q = query.replace(/\s+/g, ' ').trim();
		if (group) parts.push('g=' + encodeURIComponent(group)); if (q) parts.push('q=' + encodeURIComponent(q));
		if (scope !== 'all') parts.push('scope=' + scope); if (sort !== 'grouped') parts.push('sort=' + sort);
		var h = '#/misc' + (parts.length ? '?' + parts.join('&') : '');
		if (window.location.hash !== h) { try { window.history.replaceState(null, '', h); } catch (e) { /* file:// */ } }
	}
	function changed() { apply(); clearTimeout(urlTimer); urlTimer = setTimeout(syncUrl, 200); }
	function onHashChange() {
		clearTimeout(urlTimer); urlTimer = 0; if (!onMiscRoute()) return;
		var want = readHash(); group = want.group; query = want.query; scope = want.scope; sort = want.sort; input.value = query; apply();
	}
	function recordOpen(slug) {
		if (!knownSlug(slug)) return;
		recent = [slug].concat(recent.filter(function (id) { return id !== slug; })).slice(0, RECENT_LIMIT); saveList(RECENT_KEY, recent); apply();
	}
	// Used by the palette as well as native links. Accept only actual same-site
	// grid destinations; query strings and experiment state do not create duplicates.
	function recordHref(href) {
		if (typeof href !== 'string' || !cards.length) return false;
		var link = document.createElement('a'); link.href = href;
		if (link.protocol !== window.location.protocol || link.host !== window.location.host) return false;
		var match = cards.filter(function (card) { return card.el.pathname === link.pathname; })[0];
		if (!match) return false;
		recordOpen(match.slug);
		return true;
	}
	function onOpen(ev) {
		if (ev.type === 'auxclick' ? ev.button !== 1 : ev.button !== 0) return;
		var link = ev.target && ev.target.closest ? ev.target.closest('a[href]') : null;
		if (link) recordHref(link.href);
	}
	function openRandom() {
		var showing = cards.filter(function (card) { return !card.el.hidden; }); if (!showing.length) return;
		var card = showing[Math.floor(Math.random() * showing.length)]; recordOpen(card.slug); window.open(card.el.getAttribute('href'), '_blank', 'noopener');
	}
	function onToolsClick(ev) {
		var btn = ev.target && ev.target.closest ? ev.target.closest('button') : null; if (!btn || !tools.contains(btn)) return;
		if (btn.hasAttribute('data-group')) {
			var id = btn.getAttribute('data-group'); group = id && id !== group ? id : ''; changed();
		} else if (btn.hasAttribute('data-scope')) {
			scope = btn.getAttribute('data-scope'); if (scope === 'recent') sort = 'recent'; changed();
		} else if (btn.hasAttribute('data-density')) setDensity(btn.getAttribute('data-density') === 'compact' ? 'compact' : 'cards', true);
		else if (btn === randomBtn) openRandom();
		else if (btn.classList.contains('misc-clear')) { group = ''; query = ''; scope = 'all'; sort = 'grouped'; input.value = ''; changed(); input.focus(); }
	}
	function onFavorite(ev) {
		var button = ev.target && ev.target.closest ? ev.target.closest('.misc-favorite') : null; if (!button || !grid.contains(button)) return;
		var slug = button.getAttribute('data-slug'), saved = favorites.indexOf(slug) !== -1;
		favorites = favorites.filter(function (id) { return id !== slug; }); if (!saved) favorites.push(slug);
		saveList(FAVORITES_KEY, favorites); apply(); announce((saved ? 'Removed from' : 'Saved to') + ' favorites.');
		if (scope === 'favorites' && saved) {
			var next = cards.filter(function (card) { return !card.el.hidden; })[0];
			if (next) next.button.focus(); else tools.querySelector('[data-scope="favorites"]').focus();
		}
	}
	function boot() {
		var section = document.getElementById('miscContent'); if (!section || !collect(section) || !cards.length) return;
		favorites = readList(FAVORITES_KEY); recent = readList(RECENT_KEY); setDensity(storedDensity(), false);
		if (onMiscRoute()) { var want = readHash(); group = want.group; query = want.query; scope = want.scope; sort = want.sort; }
		input.value = query; apply(); tools.hidden = false;
		window.Misc = window.Misc || {};
		window.Misc.recordOpen = recordHref;
		tools.addEventListener('click', onToolsClick); grid.addEventListener('click', onFavorite);
		document.addEventListener('click', onOpen); document.addEventListener('auxclick', onOpen);
		input.addEventListener('input', function () { query = input.value; changed(); });
		input.addEventListener('keydown', function (ev) {
			if ((ev.key === 'Escape' || ev.key === 'Esc') && input.value) { ev.preventDefault(); query = ''; input.value = ''; changed(); }
		});
		if (sortSelect) sortSelect.addEventListener('change', function () { sort = sortSelect.value; changed(); });
		window.addEventListener('hashchange', onHashChange);
		window.addEventListener('storage', function (ev) {
			if (ev.key === FAVORITES_KEY || ev.key === RECENT_KEY || ev.key === null) {
				favorites = window.SavedStore && typeof window.SavedStore.snapshot === 'function' ? window.SavedStore.snapshot().filter(function (item) { return item.kind === 'experiment' && validFavoriteSlug(item.id); }).map(function (item) { return item.id; }) : readList(FAVORITES_KEY);
				recent = readList(RECENT_KEY); apply();
			}
			else if (ev.key === STORE_KEY) setDensity(storedDensity(), false);
		});
		document.addEventListener('saved:change', function (ev) {
			var detail = ev.detail || {};
			if (detail.source === 'misc' || !Array.isArray(detail.items) || (Array.isArray(detail.changed) && !detail.changed.some(function (item) { return item.kind === 'experiment'; }))) return;
			favorites = detail.items.filter(function (item) { return item.kind === 'experiment' && validFavoriteSlug(item.id); }).map(function (item) { return item.id; });
			var active = document.activeElement, hiddenFocus = grid.contains(active);
			apply();
			var entry = hiddenFocus && active.closest('.misc-entry');
			if (entry && entry.hidden) tools.querySelector('[data-scope="favorites"]').focus();
		});
	}
	if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
