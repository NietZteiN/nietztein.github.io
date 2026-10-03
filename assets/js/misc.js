// Misc tab: the filter box, the group chips, Random and the Cards / Compact
// switch above the toy grid.
//
// scripts/build-cards.mjs writes the markup into index.html:
//   .misc-tools[hidden]             the toolbar. This file removes `hidden`, so
//                                   without JavaScript the grouped grid shows alone.
//     .misc-filter                  the filter box
//     .misc-count                   "42 toys", or "7 of 42" while filtering (aria-live)
//     .misc-chip[data-group]        one per group; data-group="" is All (aria-pressed)
//     .misc-random                  opens one of the toys showing, in a new tab
//     .misc-seg-btn[data-density]   "cards" | "compact" (aria-pressed)
//     .misc-empty[hidden]           "Nothing matches." and its .misc-clear button
//   .misc-grid                      gets the class is-compact in the compact view
//     h3.misc-group-h[data-group]   a group's heading, its count in .misc-group-n
//     a.misc-card[data-group]       a toy; data-tags holds extra words to find it by
//
// Filtering only sets the hidden attribute, on the cards that do not match and
// on the headings left with no card. Every card stays in the document, so the
// command palette and the "Surprise me" action still see all of them.
//
// A card matches when every word typed is found, case and accents aside, in its
// title, description, note, group name or tags (and "new" finds the cards that
// wear the New badge).
//
// State:
//   group and query   mirrored into the hash as #/misc?g=<group>&q=<query> with
//                     history.replaceState (which fires no hashchange, so the
//                     router in main.js never runs because of it), and read back
//                     on load and on every hashchange while the route is misc.
//                     A bare #/misc therefore shows everything.
//   density           localStorage "misc.view": "cards" | "compact"

(function () {
	'use strict';

	var STORE_KEY = 'misc.view';
	var ROUTE_RE = /^#\/misc(?:[\/?]|$)/;
	var URL_DELAY_MS = 200;
	// The combining accents, U+0300 to U+036F, that normalize('NFD') splits off.
	var ACCENTS_RE = new RegExp('[' + String.fromCharCode(0x300) + '-' + String.fromCharCode(0x36f) + ']', 'g');

	var tools = null;
	var grid = null;
	var input = null;
	var countEl = null;
	var emptyEl = null;
	var randomBtn = null;
	var chips = []; // [{ el, group }]
	var segBtns = []; // [{ el, density }]
	var heads = []; // [{ el, group, numEl, total }]
	var cards = []; // [{ el, group, text }]
	var groupIds = {}; // the ids of the groups that have a heading

	var group = ''; // '' is All
	var query = ''; // as typed
	var urlTimer = 0;

	// ---- Helpers ----------------------------------------------------------

	function slice(list) {
		return Array.prototype.slice.call(list);
	}

	function textOf(node) {
		return node ? String(node.textContent || '') : '';
	}

	// Lower case, accents off, whitespace collapsed: "seance" finds "Séance".
	function fold(s) {
		s = String(s == null ? '' : s).toLowerCase();
		if (s.normalize) s = s.normalize('NFD').replace(ACCENTS_RE, '');
		return s.replace(/\s+/g, ' ').trim();
	}

	function setHidden(el, hide) {
		if (el.hidden !== hide) el.hidden = hide;
	}

	// Leaves the node alone when it already says so (it may be a live region).
	function setText(el, text) {
		if (el.textContent !== text) el.textContent = text;
	}

	function setPressed(el, on) {
		el.setAttribute('aria-pressed', on ? 'true' : 'false');
	}

	function countText(n) {
		return n + (n === 1 ? ' toy' : ' toys');
	}

	// ---- Reading the page ---------------------------------------------------

	// Finds the toolbar and the grid and indexes the cards. False when the
	// markup is not there (an older page, or the section is missing).
	function collect(section) {
		tools = section.querySelector('.misc-tools');
		grid = section.querySelector('.misc-grid');
		if (!tools || !grid) return false;
		input = tools.querySelector('.misc-filter');
		countEl = tools.querySelector('.misc-count');
		emptyEl = tools.querySelector('.misc-empty');
		randomBtn = tools.querySelector('.misc-random');
		if (!input || !countEl) return false;

		var names = {};
		heads = slice(grid.querySelectorAll('.misc-group-h[data-group]')).map(function (el) {
			var id = el.getAttribute('data-group');
			var numEl = el.querySelector('.misc-group-n');
			// The heading's own words, without the count beside them.
			var name = '';
			for (var node = el.firstChild; node; node = node.nextSibling) {
				if (node !== numEl) name += textOf(node);
			}
			names[id] = name;
			groupIds[id] = true;
			return { el: el, group: id, numEl: numEl, total: 0 };
		});

		cards = slice(grid.querySelectorAll('.misc-card')).map(function (el) {
			var id = el.getAttribute('data-group') || '';
			var words = [
				textOf(el.querySelector('.misc-title')),
				textOf(el.querySelector('.misc-desc')),
				textOf(el.querySelector('.misc-note')),
				names[id] || '',
				el.getAttribute('data-tags') || '',
				textOf(el.querySelector('.misc-new')), // so that "new" finds the badged ones
			];
			return { el: el, group: id, text: fold(words.join(' ')) };
		});
		heads.forEach(function (head) {
			head.total = cards.filter(function (card) {
				return card.group === head.group;
			}).length;
		});

		chips = slice(tools.querySelectorAll('.misc-chip[data-group]')).map(function (el) {
			return { el: el, group: el.getAttribute('data-group') || '' };
		});
		segBtns = slice(tools.querySelectorAll('.misc-seg-btn[data-density]')).map(function (el) {
			return { el: el, density: el.getAttribute('data-density') };
		});
		return true;
	}

	// ---- Filtering ----------------------------------------------------------

	// Shows the cards that match the pressed chip and every word typed, hides
	// the others and each heading left with nothing under it, and brings the
	// chips, the counts and the "Nothing matches" line up to date.
	function apply() {
		var words = fold(query).split(' ');
		var shown = 0;
		var perGroup = {};

		cards.forEach(function (card) {
			var ok = !group || card.group === group;
			for (var i = 0; ok && i < words.length; i++) {
				if (card.text.indexOf(words[i]) === -1) ok = false;
			}
			setHidden(card.el, !ok);
			if (ok) {
				shown += 1;
				perGroup[card.group] = (perGroup[card.group] || 0) + 1;
			}
		});

		heads.forEach(function (head) {
			var n = perGroup[head.group] || 0;
			setHidden(head.el, n === 0);
			if (head.numEl) setText(head.numEl, n && n < head.total ? n + ' of ' + head.total : String(head.total));
		});

		chips.forEach(function (chip) {
			setPressed(chip.el, chip.group === group);
		});
		setText(countEl, shown < cards.length ? shown + ' of ' + cards.length : countText(cards.length));
		if (emptyEl) setHidden(emptyEl, shown !== 0);
		if (randomBtn) randomBtn.disabled = shown === 0;
	}

	// ---- Density ------------------------------------------------------------

	function storedDensity() {
		try {
			return window.localStorage.getItem(STORE_KEY) === 'compact' ? 'compact' : 'cards';
		} catch (e) {
			return 'cards';
		}
	}

	function setDensity(density, save) {
		grid.classList.toggle('is-compact', density === 'compact');
		segBtns.forEach(function (btn) {
			setPressed(btn.el, btn.density === density);
		});
		if (!save) return;
		try {
			window.localStorage.setItem(STORE_KEY, density);
		} catch (e) {
			/* private mode etc. */
		}
	}

	// ---- The hash -----------------------------------------------------------

	function onMiscRoute() {
		return ROUTE_RE.test(window.location.hash || '');
	}

	// The group and the query the hash asks for; both empty for a bare #/misc.
	// A group that has no heading on the page is ignored.
	function readHash() {
		var want = { group: '', query: '' };
		var h = window.location.hash || '';
		var at = h.indexOf('?');
		if (at === -1) return want;
		h.slice(at + 1).split('&').forEach(function (pair) {
			var eq = pair.indexOf('=');
			var key = eq === -1 ? pair : pair.slice(0, eq);
			var value = eq === -1 ? '' : pair.slice(eq + 1);
			try {
				value = decodeURIComponent(value.replace(/\+/g, ' '));
			} catch (e) {
				/* a stray %: keep it as written */
			}
			if (key === 'g' && Object.prototype.hasOwnProperty.call(groupIds, value)) want.group = value;
			else if (key === 'q') want.query = value;
		});
		return want;
	}

	// Mirrors the state into the address bar. Skipped when another section is
	// showing, so this never moves the page off the route the router chose.
	function syncUrl() {
		urlTimer = 0;
		if (!onMiscRoute()) return;
		var parts = [];
		var q = query.replace(/\s+/g, ' ').trim();
		if (group) parts.push('g=' + encodeURIComponent(group));
		if (q) parts.push('q=' + encodeURIComponent(q));
		var h = '#/misc' + (parts.length ? '?' + parts.join('&') : '');
		if (window.location.hash === h) return;
		try {
			window.history.replaceState(null, '', h);
		} catch (e) {
			/* file:// */
		}
	}

	// A pause first: a key held down must not write the URL thirty times a second.
	function syncUrlSoon() {
		clearTimeout(urlTimer);
		urlTimer = setTimeout(syncUrl, URL_DELAY_MS);
	}

	function onHashChange() {
		clearTimeout(urlTimer);
		urlTimer = 0;
		if (!onMiscRoute()) return;
		var want = readHash();
		if (want.group === group && want.query === query.replace(/\s+/g, ' ').trim()) return;
		group = want.group;
		query = want.query;
		input.value = query;
		apply();
	}

	// ---- Actions ------------------------------------------------------------

	function changed() {
		apply();
		syncUrlSoon();
	}

	// Pressing the chip that is already down lets it up again (back to All).
	function pressChip(id) {
		group = id && id !== group ? id : '';
		changed();
	}

	function clearAll() {
		group = '';
		query = '';
		input.value = '';
		changed();
		input.focus();
	}

	// Same as clicking the card: its page, in a new tab.
	function openRandom() {
		var showing = cards.filter(function (card) {
			return !card.el.hidden;
		});
		if (!showing.length) return;
		var href = showing[Math.floor(Math.random() * showing.length)].el.getAttribute('href');
		if (href) window.open(href, '_blank', 'noopener');
	}

	function onToolsClick(ev) {
		var btn = ev.target && ev.target.closest ? ev.target.closest('button') : null;
		if (!btn || !tools.contains(btn)) return;
		if (btn.hasAttribute('data-group')) pressChip(btn.getAttribute('data-group'));
		else if (btn.hasAttribute('data-density')) setDensity(btn.getAttribute('data-density') === 'compact' ? 'compact' : 'cards', true);
		else if (btn === randomBtn) openRandom();
		else if (btn.classList.contains('misc-clear')) clearAll();
	}

	function onInput() {
		query = input.value;
		changed();
	}

	function onInputKey(ev) {
		if (ev.key !== 'Escape' && ev.key !== 'Esc') return;
		if (!input.value) return;
		ev.preventDefault();
		input.value = '';
		query = '';
		changed();
	}

	// ---- Boot ---------------------------------------------------------------

	function boot() {
		var section = document.getElementById('miscContent');
		if (!section || !collect(section) || !cards.length) return;

		setDensity(storedDensity(), false);
		if (onMiscRoute()) {
			var want = readHash();
			group = want.group;
			query = want.query;
		}
		input.value = query;
		apply();
		tools.hidden = false;

		tools.addEventListener('click', onToolsClick);
		input.addEventListener('input', onInput);
		input.addEventListener('keydown', onInputKey);
		window.addEventListener('hashchange', onHashChange);
	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', boot);
	} else {
		boot();
	}
})();
